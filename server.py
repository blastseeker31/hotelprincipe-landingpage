#!/usr/bin/env python3
"""
Hotel Príncipe — Servidor HTTP con soporte para formulario de empleo.
Sirve archivos estáticos y procesa POST multipart en /api/trabajo.
v3 — SQLite backend, anti-spam, security-hardened.
"""

import http.server
import json
import re
import time
import secrets
import sqlite3
import threading
import urllib.parse
import urllib.request
from pathlib import Path
from collections import defaultdict

HOST = "0.0.0.0"
PORT = 8080
ROOT = Path(__file__).parent.resolve()
SUBMISSIONS_DIR = ROOT.parent / "hotel-principe-submissions"
DB_PATH = SUBMISSIONS_DIR / "solicitudes.db"
PDF_DIR = SUBMISSIONS_DIR / "pdfs"
MAX_FILE_SIZE = 5 * 1024 * 1024
MAX_BODY_SIZE = 6 * 1024 * 1024

# ── Telegram notification config ──
TG_TOKEN = "8876113209:AAHpVE4IxtPBfOxke9tvBXFK0Nz5FVVojjg"
TG_CHAT_ID = "8205920091"

RATE_LIMIT_WINDOW = 60
RATE_LIMIT_MAX = 5
rate_limit_store: dict[str, list[float]] = defaultdict(list)

csrf_tokens: dict[str, float] = {}
CSRF_TOKEN_TTL = 600
MIN_FORM_TIME = 3

MAX_FIELD_LENGTHS = {
    "nombre": 120, "area_estudio": 100, "telefono": 9,
    "email": 100, "residencia": 150, "pregunta_situacional": 1500,
    "detalle_exp_atencion": 500, "detalle_idiomas": 150,
    "sexo": 20, "nivel_academico": 30, "manejo_ofimatica": 20,
    "exp_atencion": 5, "exp_cuadre_caja": 5,
    "disponibilidad_rotativa": 5, "idiomas": 5,
}

EMAIL_RE = re.compile(
    r'^[a-zA-Z0-9.!#$%&\'*+/=?^_`{|}~-]+@'
    r'[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?'
    r'(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$'
)

_db_local = threading.local()


# ── FS helpers ──────────────────────────────────────────────

def ensure_dir(path: Path):
    path.mkdir(parents=True, exist_ok=True)


# ── Database ────────────────────────────────────────────────

def init_db():
    ensure_dir(SUBMISSIONS_DIR)
    ensure_dir(PDF_DIR)
    conn = sqlite3.connect(str(DB_PATH))
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    conn.execute("""
        CREATE TABLE IF NOT EXISTS solicitudes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
            ip TEXT,
            nombre TEXT NOT NULL,
            sexo TEXT,
            edad INTEGER,
            nivel_academico TEXT,
            area_estudio TEXT,
            manejo_ofimatica TEXT,
            exp_atencion TEXT,
            detalle_exp_atencion TEXT,
            exp_cuadre_caja TEXT,
            disponibilidad_rotativa TEXT,
            idiomas TEXT,
            detalle_idiomas TEXT,
            pregunta_situacional TEXT,
            telefono TEXT,
            email TEXT,
            residencia TEXT,
            cv_path TEXT,
            revisado INTEGER DEFAULT 0
        )
    """)
    conn.commit()
    conn.close()
    count = sqlite3.connect(str(DB_PATH)).execute(
        "SELECT COUNT(*) FROM solicitudes").fetchone()[0]
    print(f"DB ready: {count} solicitudes en {DB_PATH}")


def get_db() -> sqlite3.Connection:
    if not hasattr(_db_local, "conn") or _db_local.conn is None:
        _db_local.conn = sqlite3.connect(str(DB_PATH))
        _db_local.conn.row_factory = sqlite3.Row
    return _db_local.conn


def save_submission(fields: dict, cv_data: bytes, cv_filename: str,
                    client_ip: str) -> dict:
    ts = time.strftime("%Y%m%d_%H%M%S")
    safe_name = re.sub(r'[^a-zA-Z0-9_]', '_',
                       fields.get("nombre", "sin_nombre"))
    pdf_name = f"{ts}_{safe_name}.pdf"
    pdf_path = PDF_DIR / pdf_name
    pdf_path.write_bytes(cv_data)

    db = get_db()
    db.execute("""
        INSERT INTO solicitudes (
            ip, nombre, sexo, edad, nivel_academico, area_estudio,
            manejo_ofimatica, exp_atencion, detalle_exp_atencion,
            exp_cuadre_caja, disponibilidad_rotativa, idiomas,
            detalle_idiomas, pregunta_situacional,
            telefono, email, residencia, cv_path
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        client_ip,
        fields.get("nombre", ""),
        fields.get("sexo", ""),
        int(fields.get("edad", 0)),
        fields.get("nivel_academico", ""),
        fields.get("area_estudio", ""),
        fields.get("manejo_ofimatica", ""),
        fields.get("exp_atencion", ""),
        fields.get("detalle_exp_atencion", ""),
        fields.get("exp_cuadre_caja", ""),
        fields.get("disponibilidad_rotativa", ""),
        fields.get("idiomas", ""),
        fields.get("detalle_idiomas", ""),
        fields.get("pregunta_situacional", ""),
        "+504 " + fields.get("telefono", ""),
        fields.get("email", ""),
        fields.get("residencia", ""),
        str(pdf_path),
    ))
    db.commit()
    row_id = db.execute("SELECT last_insert_rowid()").fetchone()[0]
    return {"id": row_id, "pdf": str(pdf_path)}


def send_notification(fields: dict, pdf_path: str, submission_id: int):
    """Send Telegram notification with complete applicant profile + CV."""
    nombre = fields.get("nombre", "Sin nombre")

    text = (
        f"📋 <b>Solicitud #{submission_id}</b> — Recepcionista\n\n"
        f"<b>👤 DATOS PERSONALES</b>\n"
        f"Nombre: {nombre}\n"
        f"Sexo: {fields.get('sexo', '')}\n"
        f"Edad: {fields.get('edad', '')} años\n"
        f"Residencia: {fields.get('residencia', '')}\n\n"
        f"<b>🎓 FORMACIÓN</b>\n"
        f"Nivel: {fields.get('nivel_academico', '')}\n"
        f"Área: {fields.get('area_estudio', '')}\n"
        f"Ofimática: {fields.get('manejo_ofimatica', '')}\n\n"
        f"<b>💼 EXPERIENCIA</b>\n"
        f"Atención/Hotelería: {fields.get('exp_atencion', '')}"
    )
    if fields.get('detalle_exp_atencion'):
        text += f"\n  ↳ {fields['detalle_exp_atencion']}"
    text += (
        f"\nCuadre de caja: {fields.get('exp_cuadre_caja', '')}\n"
        f"Turnos rotativos: {fields.get('disponibilidad_rotativa', '')}\n"
        f"Idiomas: {fields.get('idiomas', '')}"
    )
    if fields.get('detalle_idiomas'):
        text += f"\n  ↳ {fields['detalle_idiomas']}"

    pregunta = fields.get('pregunta_situacional', '')
    text += (
        f"\n\n<b>💬 VOCACIÓN DE SERVICIO</b>\n"
        f"{pregunta[:400]}"
        f"{'...' if len(pregunta) > 400 else ''}\n\n"
        f"<b>📞 CONTACTO</b>\n"
        f"Tel: {fields.get('telefono', '')}\n"
        f"Email: {fields.get('email', '')}"
    )

    base_url = f"https://api.telegram.org/bot{TG_TOKEN}"

    # Send text message
    try:
        data = json.dumps({
            "chat_id": TG_CHAT_ID,
            "text": text,
            "parse_mode": "HTML",
            "disable_web_page_preview": True,
        }).encode()
        req = urllib.request.Request(f"{base_url}/sendMessage", data=data,
            headers={"Content-Type": "application/json"})
        urllib.request.urlopen(req, timeout=10)
        print(f"[{time.strftime('%H:%M:%S')}] "
              f"TG text sent: #{submission_id}")
    except Exception as e:
        print(f"[{time.strftime('%H:%M:%S')}] "
              f"TG text ERROR: {e}")

    # Send CV as document
    try:
        import io, uuid
        boundary = uuid.uuid4().hex
        with open(pdf_path, "rb") as f:
            pdf_data = f.read()

        body = (
            f"--{boundary}\r\n"
            f'Content-Disposition: form-data; name="chat_id"\r\n\r\n'
            f"{TG_CHAT_ID}\r\n"
            f"--{boundary}\r\n"
            f'Content-Disposition: form-data; name="document"; '
            f'filename="CV_{submission_id}.pdf"\r\n'
            f"Content-Type: application/pdf\r\n\r\n"
        ).encode() + pdf_data + f"\r\n--{boundary}--\r\n".encode()

        req = urllib.request.Request(f"{base_url}/sendDocument", data=body,
            headers={"Content-Type": f"multipart/form-data; boundary={boundary}"})
        urllib.request.urlopen(req, timeout=15)
        print(f"[{time.strftime('%H:%M:%S')}] "
              f"TG CV sent: #{submission_id}")
    except Exception as e:
        print(f"[{time.strftime('%H:%M:%S')}] "
              f"TG CV ERROR: {e}")


# ── Security helpers ────────────────────────────────────────

def cleanup_csrf_tokens():
    now = time.time()
    expired = [t for t, exp in csrf_tokens.items() if now > exp]
    for t in expired:
        del csrf_tokens[t]


def generate_csrf_token() -> str:
    cleanup_csrf_tokens()
    token = secrets.token_hex(32)
    csrf_tokens[token] = time.time() + CSRF_TOKEN_TTL
    return token


def check_rate_limit(client_ip: str) -> bool:
    now = time.time()
    timestamps = rate_limit_store[client_ip]
    timestamps = [t for t in timestamps if now - t < RATE_LIMIT_WINDOW]
    rate_limit_store[client_ip] = timestamps
    if len(timestamps) >= RATE_LIMIT_MAX:
        return False
    timestamps.append(now)
    return True


# ── Multipart parser ────────────────────────────────────────

def parse_multipart(body: bytes, content_type: str) -> dict:
    boundary = None
    for part in content_type.split(";"):
        part = part.strip()
        if part.startswith("boundary="):
            boundary = part[len("boundary="):].strip('"')
            break
    if not boundary:
        raise ValueError("No boundary found in Content-Type")

    boundary_bytes = boundary.encode("utf-8")
    delimiter = b"--" + boundary_bytes
    close_delimiter = b"--" + boundary_bytes + b"--"

    parts = body.split(delimiter)[1:]
    if parts and parts[-1].startswith(b"--"):
        parts[-1] = parts[-1].split(close_delimiter)[0]

    fields = {}
    files = []

    for part in parts:
        if not part or part == b"--\r\n" or part == b"--":
            continue

        if b"\r\n\r\n" in part:
            header_section, body_section = part.split(b"\r\n\r\n", 1)
        elif b"\n\n" in part:
            header_section, body_section = part.split(b"\n\n", 1)
        else:
            continue

        body_section = body_section.rstrip(b"\r\n")
        headers_text = header_section.decode("utf-8", errors="replace")

        disp_match = re.search(
            r'Content-Disposition:\s*form-data;\s*(.*)',
            headers_text, re.IGNORECASE)
        if not disp_match:
            continue

        disp_params = {}
        for pair in disp_match.group(1).split(";"):
            pair = pair.strip()
            if "=" in pair:
                k, v = pair.split("=", 1)
                disp_params[k.strip()] = v.strip().strip('"')

        name = disp_params.get("name", "")
        filename = disp_params.get("filename", None)

        if filename:
            ct_match = re.search(
                r'Content-Type:\s*(.*)', headers_text, re.IGNORECASE)
            file_ct = (ct_match.group(1).strip()
                       if ct_match else "application/octet-stream")
            files.append({
                "name": name,
                "filename": filename,
                "content_type": file_ct,
                "data": body_section,
            })
        else:
            value = body_section.decode("utf-8", errors="replace")
            fields[name] = value

    return {"fields": fields, "files": files}


# ── Silver data cleaning ───────────────────────────────────

def title_case_sp(text: str) -> str:
    """Title case preserving Spanish accented chars (ñ, á, é, í, ó, ú, ü)."""
    if not text:
        return text
    return " ".join(
        w[0].upper() + w[1:].lower() if w else ""
        for w in text.split()
    )

def silver_clean(fields: dict) -> dict:
    """Apply Silver-quality standardization to form fields."""
    # Proper case: names, locations, areas
    for key in ("nombre", "residencia", "area_estudio", "detalle_exp_atencion"):
        if key in fields and fields[key]:
            fields[key] = title_case_sp(fields[key])

    # Standardize: sexo
    sexo = fields.get("sexo", "").lower()
    if sexo in ("masculino", "m", "hombre", "varón", "varon"):
        fields["sexo"] = "Masculino"
    elif sexo in ("femenino", "f", "mujer"):
        fields["sexo"] = "Femenino"

    # Standardize: si/no → Sí/No
    for key in ("exp_atencion", "exp_cuadre_caja", "disponibilidad_rotativa", "idiomas"):
        val = fields.get(key, "").lower().strip()
        if val in ("si", "sí", "yes"):
            fields[key] = "Sí"
        elif val in ("no"):
            fields[key] = "No"

    # Standardize: nivel_academico
    nivel = fields.get("nivel_academico", "").lower()
    nivel_map = {
        "bachillerato": "Bachillerato",
        "pasante": "Pasante Universitario",
        "pasante universitario": "Pasante Universitario",
        "licenciatura": "Licenciatura o Ingeniería",
        "licenciatura o ingeniería": "Licenciatura o Ingeniería",
        "ingeniería": "Licenciatura o Ingeniería",
        "ingenieria": "Licenciatura o Ingeniería",
    }
    if nivel in nivel_map:
        fields["nivel_academico"] = nivel_map[nivel]

    # Standardize: manejo_ofimatica
    ofim = fields.get("manejo_ofimatica", "").lower()
    ofim_map = {"basico": "Básico", "básico": "Básico",
                "intermedio": "Intermedio", "avanzado": "Avanzado"}
    if ofim in ofim_map:
        fields["manejo_ofimatica"] = ofim_map[ofim]

    # Lowercase: email
    if "email" in fields:
        fields["email"] = fields["email"].lower().strip()

    # Capitalize: detalle_idiomas (free text but first letter caps)
    if fields.get("detalle_idiomas"):
        fields["detalle_idiomas"] = fields["detalle_idiomas"][0].upper() + fields["detalle_idiomas"][1:]

    # Keep pregunta_situacional as-is (free text, raw voice)

    return fields

class HotelHandler(http.server.SimpleHTTPRequestHandler):

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    ACCESS_LOG = ROOT.parent / "hotel-stats" / "access.log"

    def log_request(self, code='-', size='-'):
        """Log request with IP, timestamp, method, path, status."""
        ts = time.strftime('%Y-%m-%dT%H:%M:%S')
        client_ip = self.client_address[0]
        msg = f"{ts} | {client_ip} | {self.command} | {self.path} | {code}"
        print(msg)
        try:
            with open(self.ACCESS_LOG, "a") as f:
                f.write(msg + "\n")
        except Exception:
            pass

    def end_headers(self):
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy",
                         "strict-origin-when-cross-origin")
        self.send_header("Content-Security-Policy",
            "default-src 'self'; "
            "script-src 'self' 'unsafe-inline'; "
            "style-src 'self' 'unsafe-inline' "
            "https://fonts.googleapis.com https://cdnjs.cloudflare.com; "
            "font-src 'self' https://fonts.gstatic.com "
            "https://cdnjs.cloudflare.com; "
            "img-src 'self' data: https:; "
            "form-action 'self'; "
            "frame-ancestors 'none';")
        super().end_headers()

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        if path.startswith("/submissions"):
            self.send_error(403, "Forbidden")
            return

        if path == "/api/csrf":
            token = generate_csrf_token()
            body = json.dumps({"token": token}).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type",
                             "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return

        if path in ("/trabajo", "/trabajo/"):
            path = "/trabajo.html"
        elif path == "/":
            path = "/index.html"

        self.path = path
        return super().do_GET()

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)

        if parsed.path != "/api/trabajo":
            self.send_error(404, "Not found")
            return

        client_ip = self.client_address[0]

        if not check_rate_limit(client_ip):
            self._json_response(429, {
                "ok": False,
                "error": "Demasiadas solicitudes. Intente más tarde."})
            return

        content_type = self.headers.get("Content-Type", "")
        content_length = int(self.headers.get("Content-Length", 0))

        if content_length > MAX_BODY_SIZE:
            self._json_response(400, {
                "ok": False,
                "error": "La solicitud excede el tamaño máximo permitido."})
            return
        if content_length == 0:
            self._json_response(400, {
                "ok": False,
                "error": "No se recibieron datos."})
            return

        body = self.rfile.read(content_length)

        print(f"[{time.strftime('%H:%M:%S')}] "
              f"POST /api/trabajo — {content_length}B from {client_ip}")

        try:
            parsed_data = parse_multipart(body, content_type)
            fields = parsed_data["fields"]
            files = parsed_data["files"]
        except Exception as e:
            print(f"[{time.strftime('%H:%M:%S')}] "
                  f"Multipart parse error: {e}")
            self._json_response(400, {
                "ok": False,
                "error": "Error al procesar los datos del formulario."})
            return

        # ── Anti-spam ──

        if fields.get("website", ""):
            print(f"[{time.strftime('%H:%M:%S')}] "
                  f"Spam blocked (honeypot) from {client_ip}")
            self._json_response(200, {
                "ok": True,
                "message": "Solicitud recibida correctamente."})
            return

        load_ts = fields.get("_load_time", "")
        if load_ts:
            try:
                elapsed = time.time() - float(load_ts)
                if elapsed < MIN_FORM_TIME:
                    print(f"[{time.strftime('%H:%M:%S')}] "
                          f"Spam blocked (time: {elapsed:.1f}s)")
                    self._json_response(200, {
                        "ok": True,
                        "message": "Solicitud recibida correctamente."})
                    return
            except (ValueError, TypeError):
                pass
        else:
            print(f"[{time.strftime('%H:%M:%S')}] "
                  f"Spam blocked (no timestamp) from {client_ip}")
            self._json_response(200, {
                "ok": True,
                "message": "Solicitud recibida correctamente."})
            return

        csrf = fields.get("csrf_token", "")
        now = time.time()
        csrf_expiry = csrf_tokens.get(csrf)
        if not csrf_expiry or now > csrf_expiry:
            print(f"[{time.strftime('%H:%M:%S')}] "
                  f"Spam blocked (invalid CSRF) from {client_ip}")
            self._json_response(200, {
                "ok": True,
                "message": "Solicitud recibida correctamente."})
            return
        del csrf_tokens[csrf]

        # ── Validation ──

        required_fields = [
            "nombre", "sexo", "edad", "nivel_academico", "area_estudio",
            "manejo_ofimatica", "exp_atencion", "exp_cuadre_caja",
            "disponibilidad_rotativa", "idiomas", "pregunta_situacional",
            "telefono", "email", "residencia"
        ]

        for field in required_fields:
            if not fields.get(field, "").strip():
                self._json_response(400, {
                    "ok": False,
                    "error": f"El campo '{field}' es obligatorio."})
                return

        for field, max_len in MAX_FIELD_LENGTHS.items():
            if field in fields and len(fields[field]) > max_len:
                self._json_response(400, {
                    "ok": False,
                    "error": f"El campo '{field}' excede la longitud "
                             f"máxima permitida."})
                return
        # Email validation (L2 fix — robust regex)
        email = fields.get("email", "").strip()
        if not EMAIL_RE.match(email):
            self._json_response(400, {
                "ok": False,
                "error": "El correo electrónico no es válido."})
            return

        # Phone validation: +504 XXXX-XXXX
        if not re.match(r'^\d{4}-\d{4}$', fields.get("telefono", "")):
            self._json_response(400, {
                "ok": False,
                "error": "El número de teléfono debe tener 8 dígitos "
                         "(formato: +504 XXXX-XXXX)."})
            return

        try:
            edad = int(fields.get("edad", "0"))
            if edad < 18 or edad > 99:
                self._json_response(400, {
                    "ok": False,
                    "error": "La edad debe estar entre 18 y 99 años."})
                return
        except ValueError:
            self._json_response(400, {
                "ok": False,
                "error": "La edad ingresada no es válida."})
            return

        cv_files = [f for f in files if f["name"] == "cv"]
        if not cv_files:
            self._json_response(400, {
                "ok": False,
                "error": "Debe adjuntar su Currículum Vitae en "
                         "formato PDF."})
            return

        for f in cv_files:
            if len(f["data"]) > MAX_FILE_SIZE:
                self._json_response(400, {
                    "ok": False,
                    "error": "El archivo PDF excede el tamaño máximo "
                             "de 5 MB."})
                return
            if not f["data"].startswith(b"%PDF"):
                self._json_response(400, {
                    "ok": False,
                    "error": "El archivo adjunto no es un PDF válido."})
                return
            if not f["filename"].lower().endswith(".pdf"):
                self._json_response(400, {
                    "ok": False,
                    "error": "Solamente se admiten archivos PDF."})
                return

        # ── Sanitize & Silver cleaning ──
        sanitized = {}
        for k, v in fields.items():
            v = re.sub(r'<[^>]*>', '', v).strip()
            sanitized[k] = v

        # Silver transformations
        sanitized = silver_clean(sanitized)

        # ── Save ──
        try:
            result = save_submission(
                sanitized, cv_files[0]["data"],
                cv_files[0]["filename"], client_ip)
            print(f"[{time.strftime('%H:%M:%S')}] "
                  f"Submission saved: id={result['id']}")
            # Send email notification in background thread
            threading.Thread(
                target=send_notification,
                args=(sanitized, result["pdf"], result["id"]),
                daemon=True
            ).start()
        except Exception as e:
            print(f"[{time.strftime('%H:%M:%S')}] Save error: {e}")
            self._json_response(500, {
                "ok": False,
                "error": "Error interno al guardar la solicitud."})
            return

        self._json_response(200, {
            "ok": True,
            "message": "Solicitud recibida correctamente.",
            "id": result["id"],
        })

    def _json_response(self, status: int, data: dict):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()


# ── Main ────────────────────────────────────────────────────

def main():
    init_db()
    server = http.server.ThreadingHTTPServer((HOST, PORT), HotelHandler)
    server.daemon_threads = True
    print(f"Hotel Príncipe — server: http://{HOST}:{PORT}")
    print(f"Document root: {ROOT}")
    print(f"DB: {DB_PATH}")
    print(f"PDFs: {PDF_DIR}")
    print(f"Formulario de empleo: http://{HOST}:{PORT}/trabajo")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down.")
        server.server_close()


if __name__ == "__main__":
    main()
