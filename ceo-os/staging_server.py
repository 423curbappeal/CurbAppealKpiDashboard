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

USERNAME = os.getenv("CEO_OS_USERNAME", "")
PASSWORD = os.getenv("CEO_OS_PASSWORD", "")
PORT = int(os.getenv("PORT", "8080"))

class Handler(SimpleHTTPRequestHandler):
    def send_response(self, code, message=None):
        super().send_response(code, message)
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Content-Security-Policy", "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'")

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
            if not self.require_basic_login():
                return
            self.send_response(302)
            self.send_header("Location","/")
            self.end_headers()
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
            self.respond_json(200, {"session":"passkey" if passkey_auth.session_valid(self.headers) else "password"})
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
        if route=="/api/logout":
            try:
                safe=passkey_auth.secure_request(self.headers)
            except ValueError:
                safe=False
            if not safe:
                self.respond_json(403,{"error":"Invalid request origin"})
                return
            # Only the signed passkey cookie can be cleared server-side.
            # Browsers may retain HTTP Basic credentials until the browser session ends.
            self.respond_json(200,{"ok":True},[("Set-Cookie",passkey_auth.expired_cookie())])
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
        if route.startswith("/api/passkeys/register/") and not self.basic_authorized():
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
        return self.basic_authorized()

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
