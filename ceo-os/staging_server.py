"""Password-protected preview and same-origin CEO OS cloud API."""
import base64
import hmac
import json
import os
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
import cloud_storage

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

    def respond_json(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def require_login(self):
        if self.authorized():
            return True
        self.send_response(401)
        self.send_header("WWW-Authenticate", 'Basic realm="CEO OS Private Preview", charset="UTF-8"')
        self.end_headers()
        return False

    def do_GET(self):
        if not self.require_login():
            return
        route = self.path.split("?", 1)[0]
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
