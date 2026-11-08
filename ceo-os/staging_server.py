"""Password-protected preview and same-origin CEO OS cloud API."""
import base64
import hmac
import json
import os
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
import cloud_storage
import business_kpi
import google_calendar_feed
import passkey_auth
import plaid_sandbox
import recovery_auth

USERNAME = os.getenv("CEO_OS_USERNAME", "")
PASSWORD = os.getenv("CEO_OS_PASSWORD", "")
PORT = int(os.getenv("PORT", "8080"))
# Opt-in after testing recovery form: remove browser Basic auth from regular endpoints.
FORM_RECOVERY = os.getenv("CEO_OS_RECOVERY_MODE","").strip().lower()=="form"

class Handler(SimpleHTTPRequestHandler):
    def send_response(self, code, message=None):
        super().send_response(code, message)
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Content-Security-Policy", "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline' https://cdn.plaid.com; frame-src https://*.plaid.com; connect-src 'self' https://*.plaid.com; base-uri 'none'; frame-ancestors 'none'")

    def respond_json(self, code, obj, extra_headers=None):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        for name,value in (extra_headers or []):
            self.send_header(name,value)
        self.end_headers()
        self.wfile.write(body)

    def require_basic_login(self):
        if self.basic_authorized():
            return True
        self.send_response(401)
        self.send_header("WWW-Authenticate", 'Basic realm="CEO OS Private Preview", charset="UTF-8"')
        self.end_headers()
        return False

    def require_login(self):
        if self.authorized():
            return True
        if FORM_RECOVERY:
            self.respond_json(401,{"error":"Session expired. Sign in using Face ID or account recovery."})
            return False
        self.send_response(401)
        self.send_header("WWW-Authenticate", 'Basic realm="CEO OS Private Preview", charset="UTF-8"')
        self.end_headers()
        return False

    def do_GET(self):
        route = self.path.split("?", 1)[0]
        if route == "/passkey-login" and passkey_auth.ENABLED:
            self.path="/passkey_login.html"
            super().do_GET()
            return
        if route == "/password-login" and passkey_auth.ENABLED:
            if FORM_RECOVERY:
                self.path="/recovery_login.html"
                super().do_GET()
                return
            if not self.require_basic_login():
                return
            self.send_response(302)
            self.send_header("Location","/")
            self.end_headers()
            return
        if route == "/recovery-preview" and passkey_auth.ENABLED:
            self.path="/recovery_login.html"
            super().do_GET()
            return
        if route in ("/","/index.html") and passkey_auth.ENABLED and not self.authorized():
            try:
                if passkey_auth.has_passkeys():
                    self.send_response(302)
                    self.send_header("Location","/passkey-login")
                    self.end_headers()
                    return
            except Exception:
                pass  # Existing password authentication remains the fallback.
        if not self.require_login():
            return
        if route == "/api/google-calendar":
            try:
                self.respond_json(200,google_calendar_feed.load())
            except Exception:
                self.respond_json(503,{"status":"unavailable","error":"Calendar feed unavailable. Check the private iCal variable."})
            return
        if route == "/api/business-summary":
            try:
                self.respond_json(200,business_kpi.load())
            except Exception:
                self.respond_json(503,{"status":"unavailable","error":"Business KPI source unavailable. Check your private connection settings."})
            return
        if route == "/api/auth-status":
            self.respond_json(200, {"session":passkey_auth.session_method(self.headers) or "legacy-password"})
            return
        if route == "/api/plaid/status":
            if not passkey_auth.session_valid(self.headers,method="passkey"):
                self.respond_json(403,{"error":"Face ID session required for test-bank access"})
                return
            self.respond_json(200,{"status":"ready" if plaid_sandbox.configured() else "not_configured",
                                   "environment":"sandbox","live_banking":False})
            return
        if route == "/api/plaid/overview":
            if not passkey_auth.session_valid(self.headers,method="passkey"):
                self.respond_json(403,{"error":"Face ID session required for test-bank access"})
                return
            try:
                self.respond_json(200,plaid_sandbox.overview(refresh=True))
            except Exception:
                self.respond_json(503,{"error":"Sandbox test data temporarily unavailable"})
            return
        if route == "/api/state":
            if not cloud_storage.DATABASE_URL:
                self.respond_json(503, {"error":"Cloud storage not configured"})
                return
            try:
                self.respond_json(200, cloud_storage.fetch())
            except Exception:
                self.respond_json(503, {"error":"Cloud storage temporarily unavailable"})
            return
        if route not in ("/", "/index.html"):
            self.send_error(404)
            return
        self.path = "/index.html"
        super().do_GET()

    def do_POST(self):
        route=self.path.split("?",1)[0]
        if route=="/api/recovery/login":
            try:
                if not passkey_auth.secure_request(self.headers):
                    self.respond_json(403,{"error":"Invalid request origin"})
                    return
            except ValueError:
                self.respond_json(403,{"error":"Invalid request origin"})
                return
            if not passkey_auth.ENABLED:
                self.respond_json(503,{"error":"Recovery login isn't configured"})
                return
            if self.headers.get("Content-Type","").split(";",1)[0].strip()!="application/json":
                self.respond_json(415,{"error":"JSON required"})
                return
            try:
                length=int(self.headers.get("Content-Length","0"))
                if not 2<=length<=1800:
                    self.respond_json(413,{"error":"Invalid request length"})
                    return
                body=json.loads(self.rfile.read(length))
                if not isinstance(body,dict):
                    raise ValueError("Invalid request")
                # Remote client address comes from TCP peer; do not trust forwarded IP headers.
                accepted=recovery_auth.verify(body.get("username"),body.get("password"),self.client_address[0])
                if not accepted:
                    self.respond_json(401,{"error":"Incorrect username or password"})
                    return
                ticket=passkey_auth.issue_session("password")
                self.respond_json(200,{"ok":True},[("Set-Cookie",passkey_auth.cookie_header(ticket))])
            except (ValueError,TypeError):
                self.respond_json(401,{"error":"Incorrect credentials or too many attempts"})
            except Exception:
                self.respond_json(503,{"error":"Recovery login unavailable. Use Face ID."})
            return
        if route=="/api/logout":
            try:
                safe=passkey_auth.secure_request(self.headers)
            except ValueError:
                safe=False
            if not safe:
                self.respond_json(403,{"error":"Invalid request origin"})
                return
            try:
                passkey_auth.revoke_session(self.headers)
            except Exception:
                self.respond_json(503,{"error":"Unable to revoke session. Please try again."})
                return
            # Browser-cached HTTP Basic credentials still need migration to a proper recovery login.
            self.respond_json(200,{"ok":True},[("Set-Cookie",passkey_auth.expired_cookie())])
            return
        if route.startswith("/api/plaid/"):
            if not passkey_auth.session_valid(self.headers,method="passkey"):
                self.respond_json(403,{"error":"Face ID session required for test-bank access"})
                return
            try:
                if not passkey_auth.secure_request(self.headers):
                    self.respond_json(403,{"error":"Invalid origin"})
                    return
            except ValueError:
                self.respond_json(403,{"error":"Invalid origin"})
                return
            if not plaid_sandbox.configured():
                self.respond_json(503,{"error":"Plaid Sandbox variables are not configured"})
                return
            if self.headers.get("Content-Type","").split(";",1)[0].strip()!="application/json":
                self.respond_json(415,{"error":"JSON required"})
                return
            try:
                length=int(self.headers.get("Content-Length","0"))
                if length<2 or length>2000:raise ValueError("Invalid size")
                body=json.loads(self.rfile.read(length))
                if not isinstance(body,dict):raise ValueError("Invalid input")
                if route=="/api/plaid/link-token":
                    self.respond_json(200,plaid_sandbox.link_token())
                elif route=="/api/plaid/exchange":
                    self.respond_json(200,plaid_sandbox.exchange(body.get("public_token")))
                elif route=="/api/plaid/correct":
                    self.respond_json(200,plaid_sandbox.correct_transaction(
                        body.get("transaction_id"),body.get("category"),body.get("remember_merchant",False)))
                elif route=="/api/plaid/disconnect":
                    self.respond_json(200,plaid_sandbox.disconnect_all())
                else:
                    self.send_error(404)
            except ValueError as exc:
                self.respond_json(400,{"error":str(exc)})
            except Exception:
                self.respond_json(503,{"error":"Plaid Sandbox is temporarily unavailable"})
            return
        if route not in ("/api/passkeys/register/options","/api/passkeys/register/verify",
                         "/api/passkeys/login/options","/api/passkeys/login/verify"):
            self.send_error(404)
            return
        if not passkey_auth.ENABLED:
            self.respond_json(503,{"error":"Face ID is not enabled yet. Set CEO_OS_SESSION_SECRET."})
            return
        if not passkey_auth.secure_request(self.headers):
            self.respond_json(403,{"error":"Invalid request origin"})
            return
        if route.startswith("/api/passkeys/register/") and not (passkey_auth.session_valid(self.headers) or (not FORM_RECOVERY and self.basic_authorized())):
            self.respond_json(401,{"error":"Sign in with your existing password to set up Face ID"})
            return
        if self.headers.get("Content-Type","").split(";",1)[0].strip()!="application/json":
            self.respond_json(415,{"error":"JSON required"})
            return
        try:
            length=int(self.headers.get("Content-Length","0"))
        except ValueError:
            length=0
        if length<1 or length>24000:
            self.respond_json(413,{"error":"Invalid request length"})
            return
        try:
            body=json.loads(self.rfile.read(length))
            if not isinstance(body,dict):
                raise ValueError("Invalid request")
            host=self.headers.get("Host","")
            if route.endswith("register/options"):
                result=passkey_auth.register_options(host)
            elif route.endswith("register/verify"):
                result=passkey_auth.register_verify(host,body.get("token",""),body.get("credential",{}))
            elif route.endswith("login/options"):
                result=passkey_auth.login_options(host)
            else:
                ticket=passkey_auth.login_verify(host,body.get("token",""),body.get("credential",{}))
                self.respond_json(200,{"ok":True},[("Set-Cookie",passkey_auth.cookie_header(ticket))])
                return
            self.respond_json(200,result)
        except (ValueError,TypeError,KeyError) as exc:
            self.respond_json(400,{"error":str(exc)})
        except Exception:
            self.respond_json(503,{"error":"Passkey service unavailable"})

    def do_PUT(self):
        if not self.require_login():
            return
        if self.path != "/api/state":
            self.send_error(404)
            return
        if not cloud_storage.DATABASE_URL:
            self.respond_json(503, {"error":"Cloud storage not configured"})
            return
        # Prevent cross-site browser writes with cached HTTP Basic credentials.
        host = self.headers.get("Host", "")
        origin = self.headers.get("Origin", "")
        if not origin or not host or origin != "https://" + host:
            self.respond_json(403, {"error":"Invalid request origin"})
            return
        if self.headers.get("Content-Type", "").split(";",1)[0].strip() != "application/json":
            self.respond_json(415, {"error":"JSON required"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            length = 0
        if length <= 0 or length > 180000:
            self.respond_json(413, {"error":"Invalid payload length"})
            return
        try:
            data = json.loads(self.rfile.read(length))
            result = cloud_storage.update(data.get("revision"), data.get("state"))
            if result is None:
                self.respond_json(409, {"error":"Data changed on another device. Reload before editing."})
                return
            self.respond_json(200, result)
        except (ValueError, TypeError, AttributeError) as exc:
            self.respond_json(400, {"error":str(exc)})
        except Exception:
            self.respond_json(503, {"error":"Cloud storage temporarily unavailable"})

    def do_HEAD(self):
        if not self.require_login():
            return
        if self.path.split("?",1)[0] not in ("/", "/index.html"):
            self.send_error(404)
            return
        self.path = "/index.html"
        super().do_HEAD()

    def authorized(self):
        if passkey_auth.session_valid(self.headers):
            return True
        return not FORM_RECOVERY and self.basic_authorized()

    def basic_authorized(self):
        if not USERNAME or not PASSWORD:
            return False
        value = self.headers.get("Authorization", "")
        if not value.startswith("Basic "):
            return False
        try:
            supplied = base64.b64decode(value[6:], validate=True).decode("utf-8")
        except (ValueError, UnicodeDecodeError):
            return False
        expected = USERNAME + ":" + PASSWORD
        return hmac.compare_digest(supplied.encode(), expected.encode())

if __name__ == "__main__":
    if not USERNAME or not PASSWORD:
        raise SystemExit("Set CEO_OS_USERNAME and CEO_OS_PASSWORD using Railway Variables.")
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
