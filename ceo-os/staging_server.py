"""Private, password-protected staging server for the CEO OS static prototype."""
import base64
import hmac
import os
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler

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

    def do_GET(self):
        if not self.authorized():
            self.send_response(401)
            self.send_header("WWW-Authenticate", 'Basic realm="CEO OS Private Preview", charset="UTF-8"')
            self.end_headers()
            self.wfile.write(b"Authentication required")
            return
        if self.path.split("?", 1)[0] not in ("/", "/index.html"):
            self.send_error(404)
            return
        self.path = "/index.html"
        super().do_GET()

    def do_HEAD(self):
        if not self.authorized():
            self.send_response(401)
            self.send_header("WWW-Authenticate", 'Basic realm="CEO OS Private Preview", charset="UTF-8"')
            self.end_headers()
            return
        if self.path.split("?", 1)[0] not in ("/", "/index.html"):
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
