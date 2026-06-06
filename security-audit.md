# Security Audit Report — Hotel Príncipe Employment Form

**Date:** 2026-06-02
**Scope:** `/home/quarkzy/hermes_projects/hotel-principe/server.py` + `/home/quarkzy/hermes_projects/hotel-principe/trabajo.html`
**Methodology:** Static code review covering all listed attack vectors.

---

## 1. CRITICAL Findings (Explotable)

### 🔴 C1: All applicant data is publicly accessible via static file server

- **Risk:** CRITICAL — Full data breach
- **Location:** `server.py` lines 21, 139-140
- **Description:** `SUBMISSIONS_DIR` is defined as `ROOT / "submissions"`. Because the server extends `SimpleHTTPRequestHandler` with `directory=str(ROOT)`, every file under `ROOT` — including `submissions/` — is served as a static file. Any unauthenticated user can browse `http://${HOST}:8080/submissions/` and read all applicant personal data: full name, phone number, email, address, all form answers, and even download the CV PDFs.
- **Proof-of-concept:** Visiting `http://100.74.213.128:8080/submissions/20260602_052704_Alejandro_Wilfredo_Mart_nez_Brice_o/datos.json` returns the applicant's full data as JSON. An attacker can enumerate directory timestamps or guess names.
- **Fix:** Move submissions outside the document root, or override `do_GET` to block paths starting with `/submissions/`:

```diff
  ROOT = Path(__file__).parent.resolve()
- SUBMISSIONS_DIR = ROOT / "submissions"
+ SUBMISSIONS_DIR = ROOT.parent / "submissions"   # outside document root
  MAX_FILE_SIZE = 5 * 1024 * 1024  # 5 MB
```

Alternatively, add this guard inside `do_GET` before calling `super().do_GET()`:

```python
def do_GET(self):
    parsed = urllib.parse.urlparse(self.path)
    path = parsed.path
    # Block access to submissions
    if path.startswith("/submissions"):
        self.send_error(403, "Forbidden")
        return
    # ... rest of routing
```

---

### 🔴 C2: No CSRF protection — any website can submit forms on behalf of users

- **Risk:** HIGH — Cross-Site Request Forgery
- **Location:** `server.py` lines 280-286 (CORS), `trabajo.html` lines 371-376 (form)
- **Description:** The form has no CSRF token. The server sets `Access-Control-Allow-Origin: *` (line 276) and `Access-Control-Allow-Methods: POST, OPTIONS` (line 284). This means **any third-party website** can issue a cross-origin POST to `/api/trabajo` with arbitrary form data, including file uploads. If an authenticated admin panel is ever built, CSRF would allow attackers to perform actions on behalf of admins.
- **Fix:**
  1. Remove wildcard CORS: only allow the hotel's own origin.
  2. Add CSRF token generation and validation:

```python
# server.py — generate token per session
import secrets

def do_GET(self):
    if self.path == "/trabajo" or self.path == "/trabajo/":
        # Generate CSRF token and inject into HTML (or pass via cookie + hidden field)
        ...
```

Frontend: add a hidden CSRF field populated by the server, and validate it server-side on POST.

```html
<!-- trabajo.html — inside <form> -->
<input type="hidden" name="csrf_token" id="csrf_token" value="">
```

```python
# server.py — validate in do_POST
csrf_token = fields.get("csrf_token", "")
if not csrf_token or csrf_token != session_tokens.get(session_id):
    self._json_response(403, {"ok": False, "error": "CSRF token inválido."})
    return
```

At minimum, constrain CORS:

```python
self.send_header("Access-Control-Allow-Origin", "https://hotel-principe.com")  # not "*"
```

---

### 🔴 C3: No rate limiting — endpoint is DoS-vulnerable

- **Risk:** HIGH — Disk exhaustion / denial of service
- **Location:** `server.py` lines 162-268 (entire `do_POST`)
- **Description:** There is no per-IP or global rate limiting on `/api/trabajo`. An attacker can send thousands of 6 MB multipart requests (the Content-Length limit), filling `submissions/` with garbage data until the disk is full. Even a single attacker with a script can crash the server host.
- **Fix:** Add per-IP rate limiting using a simple in-memory dictionary with expiry:

```python
import time
from collections import defaultdict

RATE_LIMIT_WINDOW = 60      # seconds
RATE_LIMIT_MAX = 5          # max submissions per window
rate_limit_store = defaultdict(list)  # IP -> list of timestamps

def check_rate_limit(client_ip: str) -> bool:
    now = time.time()
    timestamps = rate_limit_store[client_ip]
    # Remove old entries
    timestamps = [t for t in timestamps if now - t < RATE_LIMIT_WINDOW]
    rate_limit_store[client_ip] = timestamps
    if len(timestamps) >= RATE_LIMIT_MAX:
        return False
    timestamps.append(now)
    return True
```

Call it at the top of `do_POST`:

```python
client_ip = self.client_address[0]
if not check_rate_limit(client_ip):
    self._json_response(429, {"ok": False, "error": "Demasiadas solicitudes. Intente más tarde."})
    return
```

---

## 2. MEDIUM Findings (Best Practices)

### 🟡 M1: Missing security headers

- **Risk:** MEDIUM — Reduced defense-in-depth
- **Location:** `server.py` lines 270-278 (`_json_response`), and `do_GET` (no custom headers at all)
- **Description:** The server does not set any of the following critical security headers:
  - `Content-Security-Policy` — missing; XSS mitigation not available
  - `X-Content-Type-Options: nosniff` — missing; MIME sniffing attacks possible
  - `X-Frame-Options: DENY` — missing; clickjacking possible
  - `Referrer-Policy: strict-origin-when-cross-origin` — missing; referrer leakage
- **Fix:** Create a helper to add security headers to all responses:

```python
def _add_security_headers(self):
    self.send_header("X-Content-Type-Options", "nosniff")
    self.send_header("X-Frame-Options", "DENY")
    self.send_header("Referrer-Policy", "strict-origin-when-cross-origin")
    # Only allow same-origin scripts and styles; block inline:
    self.send_header("Content-Security-Policy",
        "default-src 'self'; "
        "script-src 'self'; "
        "style-src 'self' https://fonts.googleapis.com https://cdnjs.cloudflare.com; "
        "font-src 'self' https://fonts.gstatic.com https://cdnjs.cloudflare.com; "
        "img-src 'self' data:; "
        "form-action 'self'; "
        "frame-ancestors 'none';")
```

Call it in every response method (`_json_response`, `do_GET`, `do_OPTIONS`).

---

### 🟡 M2: Submissions directory under document root

- **Risk:** MEDIUM — Information disclosure (overlaps with C1 but framed as architectural)
- **Location:** `server.py` line 21
- **Description:** By keeping `submissions/` inside `ROOT`, any future misconfiguration, regression, or missing path guard exposes all data. The directory should be physically outside the document root.
- **Fix:** Move `SUBMISSIONS_DIR` above the project root:

```python
SUBMISSIONS_DIR = ROOT.parent / "submissions"
```

---

### 🟡 M3: Memory DoS via large concurrent uploads

- **Risk:** MEDIUM
- **Location:** `server.py` line 181
- **Description:** The server reads the entire request body into memory: `body = self.rfile.read(content_length)`. With the 6 MB per-request limit, a single request consumes up to 6 MB of RAM. An attacker sending 50 concurrent 6 MB requests would consume ~300 MB. The `http.server.HTTPServer` is single-threaded by default, so requests queue up, but the data is read eagerly. Use `ThreadingHTTPServer` or a reverse proxy with connection limits.
- **Fix:** Switch to `http.server.ThreadingHTTPServer` with a maximum pool size:

```python
from http.server import ThreadingHTTPServer

def main():
    server = ThreadingHTTPServer((HOST, PORT), HotelHandler)
    server.daemon_threads = True
    # ...rest
```

Or place nginx/Caddy in front with `client_max_body_size 6m` and connection limits.

---

### 🟡 M4: Debug logging leaks internal paths

- **Risk:** MEDIUM — Information disclosure
- **Location:** `server.py` lines 184, 191, 258, 260
- **Description:** The server prints full filesystem paths to stdout:
  - Line 184: prints Content-Type and Content-Length (low sensitivity)
  - Line 258: `print(f"Submission saved: {result['folder']}")` — exposes absolute path like `/home/quarkzy/hermes_projects/hotel-principe/submissions/20260602_xxx`
  - Line 260: `print(f"Save error: {e}")` — may include exception with paths

  If logs are ever captured, shipped, or the console is accessible, this reveals internal server paths.
- **Fix:** Use relative paths or IDs in logs:

```python
print(f"[{time.strftime('%H:%M:%S')}] Submission saved: {Path(result['folder']).name}")
```

---

### 🟡 M5: Multipart parser typo — `boundary` vs `boundary`

- **Risk:** MEDIUM — Functional breakage (form may fail with standard browsers)
- **Location:** `server.py` line 37
- **Description:** The code checks for the parameter `"boundary="` (with an extra 'a'). The HTTP standard parameter is `"boundary="` (correct spelling). Standard browsers send `Content-Type: multipart/form-data; boundary=----WebKitFormBoundary...`. Because the code looks for `boundary=`, not `boundary=`, the parser will never find the boundary string sent by a real browser and will raise `ValueError("No boundary found in Content-Type")`.
  - **Note:** The existing submission in `submissions/` suggests this was tested with a client that sends the non-standard `boundary` parameter, or was created manually. Real user submissions from browsers would fail silently.
- **Fix:** Correct the typo:

```diff
- if part.startswith("boundary="):
-     boundary = part[len("boundary="):].strip('"')
+ if part.startswith("boundary="):
+     boundary = part[len("boundary="):].strip('"')
```

---

## 3. LOW Findings (Recommendations)

### 🟢 L1: HTML sanitization is regex-based and potentially bypassable

- **Risk:** LOW (data is JSON-stored, not rendered as HTML)
- **Location:** `server.py` line 250
- **Description:** Input sanitization uses a regex `<[^>]*>` to strip HTML tags. This is a blacklist approach that can be bypassed in edge cases (e.g., double-angle brackets, malformed tags). Since the data is stored in JSON and currently not rendered back as HTML, the risk is minimal. However, if an admin dashboard ever reads and renders these JSON files without proper output encoding, stored XSS becomes possible.
- **Fix:** Replace strip approach with proper output encoding at render time. For storage, use a well-tested library like `bleach`:

```python
# pip install bleach
import bleach

v = bleach.clean(v, tags=[], strip=True)
```

Or simply store raw data and encode on output with `html.escape()`.

---

### 🟢 L2: Weak email validation regex

- **Risk:** LOW (functional, not security)
- **Location:** `server.py` line 210, `trabajo.html` line 685
- **Description:** The regex `^[^\s@]+@[^\s@]+\.[^\s@]+$` accepts structurally invalid emails:
  - `user@sub..domain.com` (double dot)
  - `user@domain` (email without dot in domain passes because `.` matches any character, including `.` itself, but doesn't require the dot to actually be there... wait: `[^\s@]+\.[^\s@]+` — the `\.` matches literal dot, so domain part needs at least one dot. But `user@domain.` passes because the TLD can be empty? No: `domain.` — `[^\s@]+` matches `domain`, `\.` matches `.`, `[^\s@]+` needs at least one char after dot. So `user@domain.` would fail. But `user@domain.c` passes, which is arguably invalid.
  - `user@[192.168.1.1]` (IP literal — rejected, no dot-atom)
- **Fix:** Use Python's standard library or a more robust approach:

```python
import re

# RFC 5322 simplified but practical:
EMAIL_RE = re.compile(
    r'^[a-zA-Z0-9.!#$%&\'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?'
    r'(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$'
)
if not EMAIL_RE.match(email):
    ...
```

Or, if adding dependencies is acceptable, use the `email-validator` package.

---

### 🟢 L3: File extension validation only for display — magic bytes check is sufficient but polyglot possible

- **Risk:** LOW
- **Location:** `server.py` lines 237-243
- **Description:** The server validates PDFs by checking `data.startswith(b"%PDF")`, which is correct. However, the filename extension check (line 242) is redundant and can be misleading. A file named `resume.exe` that starts with `%PDF-1.4...` would pass the magic bytes check but fail the extension check — causing a rejection even though the content is PDF. Conversely, `malicious.pdf` with `%PDF` header would be accepted. Both behaviors are acceptable. However, PDFs can contain JavaScript, and the server does not strip dangerous PDF content.
- **Fix:** If PDF sanitization is desired (e.g., for an internal HR tool that previews PDFs), use a PDF sanitizer like `pdfid` or `pypdf` to detect/remove JavaScript. For this use case (storage only), the current check is acceptable.

---

### 🟢 L4: No HTTPS — plaintext transport

- **Risk:** LOW (internal/development server)
- **Location:** `server.py` line 18-19 (HOST, PORT)
- **Description:** The server binds to plain HTTP on port 8080. All data (including CV PDFs and personal information) travels unencrypted. On a production deployment, this should be behind a TLS-terminating reverse proxy (nginx, Caddy) or use Python's `ssl` module.
- **Fix:** Deploy behind nginx with Let's Encrypt, or use `ssl.wrap_socket`:

```python
import ssl
context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
context.load_cert_chain('/etc/letsencrypt/live/hotel-principe.com/fullchain.pem',
                        '/etc/letsencrypt/live/hotel-principe.com/privkey.pem')
server = http.server.HTTPServer((HOST, 8443), HotelHandler)
server.socket = context.wrap_socket(server.socket, server_side=True)
```

---

### 🟢 L5: Custom multipart parser has edge-case risks

- **Risk:** LOW
- **Location:** `server.py` lines 29-102
- **Description:** The custom `parse_multipart` function is hand-rolled rather than using Python's built-in `cgi` module or `multipart` library. Potential issues:
  - The boundary string could appear inside file content, causing premature splitting (line 48: `body.split(delimiter)`).
  - `cgi` is imported (line 11) but unused — the built-in `cgi.FieldStorage` could handle multipart parsing more robustly.
- **Fix:** Use the standard library:

```python
import cgi
import io

def parse_multipart(body: bytes, content_type: str) -> dict:
    fp = io.BytesIO(body)
    environ = {
        'REQUEST_METHOD': 'POST',
        'CONTENT_TYPE': content_type,
        'CONTENT_LENGTH': str(len(body)),
    }
    form = cgi.FieldStorage(fp=fp, environ=environ, keep_blank_values=True)

    fields = {}
    files = []
    for key in form.keys():
        item = form[key]
        if item.filename:
            files.append({
                "name": key,
                "filename": item.filename,
                "content_type": item.type or "application/octet-stream",
                "data": item.file.read(),
            })
        else:
            fields[key] = item.value
    return {"fields": fields, "files": files}
```

---

### 🟢 L6: No input length limits on text fields (server-side)

- **Risk:** LOW
- **Location:** `server.py` lines 247-253 (sanitization)
- **Description:** While the HTML sets `maxlength` attributes (e.g., `maxlength="120"`, `maxlength="1500"`), the server does not enforce these limits. A client can bypass HTML validation and send excessively long strings, bloating the `datos.json` file and wasting disk space. The multipart body limit (6 MB) provides an upper bound, but per-field limits are missing.
- **Fix:** Add per-field length checks in server-side validation:

```python
MAX_FIELD_LENGTHS = {
    "nombre": 120,
    "area_estudio": 100,
    "telefono": 20,
    "email": 100,
    "residencia": 150,
    "pregunta_situacional": 1500,
    "detalle_exp_atencion": 500,
    "detalle_idiomas": 150,
}

for field, max_len in MAX_FIELD_LENGTHS.items():
    if field in fields and len(fields[field]) > max_len:
        self._json_response(400, {"ok": False, "error": f"El campo '{field}' excede la longitud máxima."})
        return
```

---

### 🟢 L7: Age field accepts negative values via direct POST

- **Risk:** LOW (caught by range check, but extra defensive check missing)
- **Location:** `server.py` lines 215-222
- **Description:** The server parses `edad` as `int` and checks `edad < 18 or edad > 99`. This correctly rejects negatives because `-5 < 18` is True. However, `int("0")` passes (0 < 18 is True, rejected), `int("99999")` passes (rejected), and `int("abc")` raises `ValueError` (caught). The logic is correct. No exploitable issue.
- **Fix:** (Optional) Add an explicit `if edad < 0:` check for clarity, though the current logic already handles it.

---

### 🟢 L8: Toast message uses user-controlled filename (escaped, but still)

- **Risk:** LOW (properly escaped)
- **Location:** `trabajo.html` line 652
- **Description:** The filename from the file input is rendered via `innerHTML`:
  ```js
  fileHint.innerHTML = `<span class="file-name">${esc(file.name)}</span><br>...`
  ```
  The `esc()` function (lines 752-759) properly escapes `& < > " '`, so this is safe. This is noted for completeness — no fix needed, but future maintainers must preserve the `esc()` call.

---

## 4. Summary and Priorities

| Priority | Finding                                          | Severity |
|----------|--------------------------------------------------|----------|
| 🔴 P0    | C1: Publicly accessible submissions via static server | CRITICAL |
| 🔴 P1    | C2: No CSRF protection + wildcard CORS           | HIGH     |
| 🔴 P1    | C3: No rate limiting (DoS/disk exhaustion)       | HIGH     |
| 🟡 P2    | M1: Missing security headers (CSP, XFO, etc.)    | MEDIUM   |
| 🟡 P2    | M2: Submissions directory under document root    | MEDIUM   |
| 🟡 P2    | M3: Memory DoS via concurrent large uploads      | MEDIUM   |
| 🟡 P2    | M4: Debug logging leaks internal paths           | MEDIUM   |
| 🟡 P2    | M5: `boundary` typo — multipart parser broken    | MEDIUM   |
| 🟢 P3    | L1: Regex-based HTML sanitization                | LOW      |
| 🟢 P3    | L2: Weak email validation regex                  | LOW      |
| 🟢 P3    | L3: No PDF content sanitization                  | LOW      |
| 🟢 P3    | L4: No HTTPS                                     | LOW      |
| 🟢 P3    | L5: Custom multipart parser                      | LOW      |
| 🟢 P3    | L6: No server-side field length limits           | LOW      |
| 🟢 P3    | L7: Age negative check (already safe)            | LOW      |
| 🟢 P3    | L8: File name in innerHTML (properly escaped)    | LOW      |

### What's done well

- PDF validation uses **magic bytes** (`%PDF`), not just extension — correct approach
- Server-side validation **duplicates all client-side checks** (required fields, email format, age range, file presence)
- Frontend uses `textContent` for toast messages (not `innerHTML`)
- File size limited both client-side (5 MB) and server-side (`MAX_FILE_SIZE`)
- Overall body size limited (6 MB)
- Generic Spanish error messages — no stack traces leaked to client
- Filename stored as `cv.pdf`/`cv{ext}` — no path traversal from upload filename
- `esc()` function properly escapes HTML entities when rendering filename

### Recommended action plan

1. **Immediate (today):** Move `submissions/` outside the document root (C1, M2). This is a one-line change.
2. **Immediate (today):** Add rate limiting (C3). ~30 lines of code.
3. **Short-term (this week):** Add CSRF token + constrain CORS (C2). Requires both backend and frontend changes.
4. **Short-term (this week):** Add security headers (M1).
5. **Short-term (this week):** Fix the `boundary` → `boundary` typo in the multipart parser (M5).
6. **Medium-term:** Switch to `ThreadingHTTPServer` or deploy behind nginx/Caddy (M3, L4).
7. **Medium-term:** Replace custom multipart parser with `cgi.FieldStorage` (L5).
8. **Low priority:** Improve email validation, add per-field length limits, switch to `bleach` for HTML sanitization.
