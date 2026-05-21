from http.server import BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
import urllib.request
import urllib.error
import json
import sys
import io

FIREBASE_URL = "https://watch-be6e0-default-rtdb.firebaseio.com"

def fb_get(path):
    try:
        url = f"{FIREBASE_URL}/{path}.json"
        with urllib.request.urlopen(url, timeout=10) as r:
            return json.loads(r.read())
    except:
        return None

def fb_set(path, value):
    try:
        data = json.dumps(value).encode()
        req = urllib.request.Request(f"{FIREBASE_URL}/{path}.json", data=data, method='PUT')
        urllib.request.urlopen(req, timeout=5)
    except:
        pass

def decode_key(k):
    return (k.replace('__dot__','.').replace('__hash__','#')
             .replace('__dollar__','$').replace('__slash__','/')
             .replace('__lb__','[').replace('__rb__',']'))

def html_404(slug):
    return f"""<!DOCTYPE html><html><head><title>404 — Dropify</title>
<style>*{{margin:0;padding:0;box-sizing:border-box}}
body{{font-family:'Segoe UI',sans-serif;background:#f8fafc;display:flex;align-items:center;justify-content:center;min-height:100vh}}
.b{{text-align:center;padding:40px}}.b h1{{font-size:64px;font-weight:800;color:#111}}
.b p{{color:#666;margin-top:8px}}.b a{{display:inline-block;margin-top:16px;background:#3b82f6;
color:#fff;text-decoration:none;border-radius:9px;padding:10px 22px;font-size:14px;font-weight:600}}</style>
</head><body><div class="b"><h1>404</h1><p>Python app <code>{slug}</code> not found.</p>
<a href="/">← Home</a></div></body></html>"""

def html_error(err):
    safe = str(err).replace('<','&lt;').replace('>','&gt;')
    return f"""<!DOCTYPE html><html><head><title>Error</title>
<style>*{{margin:0;padding:0;box-sizing:border-box}}
body{{font-family:'Segoe UI',sans-serif;background:#0d1117;color:#e6edf3;
display:flex;align-items:center;justify-content:center;min-height:100vh;padding:20px}}
.b{{max-width:640px;width:100%}} h2{{color:#f85149;margin-bottom:12px;font-size:18px}}
pre{{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:16px;
font-size:12px;line-height:1.6;overflow-x:auto;white-space:pre-wrap;word-break:break-word}}
a{{color:#58a6ff;font-size:13px;display:block;margin-top:12px}}</style>
</head><body><div class="b"><h2>⚠ Python Runtime Error</h2>
<pre>{safe}</pre><a href="javascript:history.back()">← Back</a></div></body></html>"""


class handler(BaseHTTPRequestHandler):

    def do_GET(self):  self.handle_req()
    def do_POST(self): self.handle_req()

    def handle_req(self):
        parsed = urlparse(self.path)
        params = parse_qs(parsed.query, keep_blank_values=True)
        slug   = params.get('slug', [''])[0]

        if not slug:
            self._send(404, html_404('unknown'), 'text/html')
            return

        # Firebase lookup
        slug_data = fb_get(f"pySlug/{slug}")
        if not slug_data:
            self._send(404, html_404(slug), 'text/html')
            return

        uid    = slug_data.get('uid', '')
        app_id = slug_data.get('appId', '')
        app    = fb_get(f"pythonApps/{uid}/{app_id}")

        if not app:
            self._send(404, html_404(slug), 'text/html')
            return

        if app.get('status') != 'active':
            self._send(503,
                '<html><body style="font-family:sans-serif;text-align:center;padding:60px"><h2>🔒 App Offline</h2></body></html>',
                'text/html')
            return

        code     = app.get('code', '')
        env_vars = app.get('envVars') or {}

        # Query params (exclude 'slug')
        query = {k: (v[0] if len(v)==1 else v) for k, v in params.items() if k != 'slug'}

        # POST body
        body = {}
        if self.command == 'POST':
            try:
                length = int(self.headers.get('Content-Length', 0))
                if length:
                    raw = self.rfile.read(length)
                    try: body = json.loads(raw)
                    except: body = raw.decode('utf-8', errors='replace')
            except: pass

        request_obj = {
            'method' : self.command,
            'path'   : parsed.path,
            'query'  : query,
            'body'   : body,
            'headers': dict(self.headers),
        }

        # Capture stdout
        buf = io.StringIO()
        old_stdout = sys.stdout
        sys.stdout = buf

        try:
            globs = {
                '__builtins__' : __builtins__,
                'request'      : request_obj,
                'env'          : env_vars,
                'urllib'       : urllib,
                'json'         : json,
                'sys'          : sys,
                'io'           : io,
            }
            # Try to import requests if available
            try:
                import requests as _req
                globs['requests'] = _req
            except ImportError:
                pass

            exec(compile(code, '<bot>', 'exec'), globs)

        except SystemExit:
            pass
        except Exception as e:
            import traceback
            tb = traceback.format_exc()
            buf.write(html_error(tb))
        finally:
            sys.stdout = old_stdout

        output = buf.getvalue()

        # Increment views (async best-effort)
        try:
            old_views = fb_get(f"pythonApps/{uid}/{app_id}/views") or 0
            fb_set(f"pythonApps/{uid}/{app_id}/views", old_views + 1)
        except: pass

        if not output:
            output = '<html><body style="font-family:sans-serif;padding:40px;color:#555"><h3>No output</h3><p>Add <code>print()</code> to your code.</p></body></html>'

        # Detect content type
        stripped = output.strip()
        low = stripped[:100].lower()
        if low.startswith('<!doctype') or low.startswith('<html') or ('<' in low and '>' in low):
            ctype = 'text/html; charset=utf-8'
        else:
            try:
                json.loads(stripped)
                ctype = 'application/json'
            except:
                ctype = 'text/plain; charset=utf-8'

        self._send(200, output, ctype)

    def _send(self, code, body, ctype='text/html'):
        enc = body.encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(enc)))
        self.end_headers()
        self.wfile.write(enc)

    def log_message(self, *a): pass  # suppress logs
