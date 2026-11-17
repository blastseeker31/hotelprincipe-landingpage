#!/usr/bin/env python3
"""
Hotel Príncipe — servidor web + sistema de reservas.
Stdlib puro (cero dependencias). Pensado para desarrollo local y
posterior despliegue en Docker (Hetzner) detrás de Nginx Proxy Manager.

Rutas:
  GET  /                        Landing page
  GET  /reservar                Formulario de reserva
  GET  /admin-reservas          Panel de gestión (requiere ADMIN_KEY)
  GET  /api/csrf                Token CSRF de un solo uso (TTL 10 min)
  POST /api/reservas            Crear solicitud de reserva
  GET  /api/admin/reservas      Listar reservas (?key=...&estado=...)
  POST /api/admin/reservas/estado  Cambiar estado {key, codigo, estado}
  GET  /health                  Estado del servicio
"""

import hmac
import json
import mimetypes
import re
import secrets
import sqlite3
import threading
import time
import urllib.request
from datetime import date, datetime, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, parse_qs

BASE_DIR = Path(__file__).resolve().parent

# ---------------------------------------------------------------------------
# Configuración: variables de entorno > archivo .env > defaults
# ---------------------------------------------------------------------------

def _load_env_file():
    env_path = BASE_DIR / ".env"
    values = {}
    if env_path.exists():
        for line in env_path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            values[k.strip()] = v.strip().strip('"').strip("'")
    return values

_ENV_FILE = _load_env_file()

def cfg(key, default=""):
    import os
    return os.environ.get(key) or _ENV_FILE.get(key) or default

HOST = cfg("HOST", "127.0.0.1")
PORT = int(cfg("PORT", "8090"))
ADMIN_KEY = cfg("ADMIN_KEY", "")
TG_TOKEN = cfg("TELEGRAM_BOT_TOKEN", "")
TG_CHAT = cfg("TELEGRAM_CHAT_ID", "")
DATA_DIR = BASE_DIR / cfg("DATA_DIR", "data")
DB_PATH = DATA_DIR / "reservas.sqlite3"

MIN_FORM_SECONDS = 3          # time trap: menos que esto = bot
MAX_FORM_SECONDS = 2 * 3600   # formulario abierto más de 2 h = token viejo
CSRF_TTL = 600                # 10 minutos
MAX_BODY = 64 * 1024          # 64 KB
MAX_NOCHES = 30
RATE_LIMIT = 5                # reservas por IP por hora
RATE_WINDOW = 3600

ESTADOS = ("pendiente", "confirmada", "cancelada")

# ---------------------------------------------------------------------------
# Base de datos (thread-local para ThreadingHTTPServer)
# ---------------------------------------------------------------------------

_db_local = threading.local()

def get_db():
    conn = getattr(_db_local, "conn", None)
    if conn is None:
        conn = sqlite3.connect(str(DB_PATH), timeout=10)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA foreign_keys=ON")
        _db_local.conn = conn
    return conn

def init_db():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    db = get_db()
    db.execute("""
        CREATE TABLE IF NOT EXISTS reservas (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            codigo TEXT UNIQUE NOT NULL,
            nombre TEXT NOT NULL,
            telefono TEXT NOT NULL,
            email TEXT,
            fecha_llegada TEXT NOT NULL,
            fecha_salida TEXT NOT NULL,
            noches INTEGER NOT NULL,
            habitaciones INTEGER NOT NULL,
            huespedes INTEGER NOT NULL,
            mensaje TEXT,
            estado TEXT NOT NULL DEFAULT 'pendiente',
            ip TEXT,
            created_at TEXT DEFAULT (datetime('now','localtime')),
            updated_at TEXT
        )
    """)
    db.execute("CREATE INDEX IF NOT EXISTS idx_reservas_estado ON reservas(estado)")
    db.commit()

# ---------------------------------------------------------------------------
# Anti-spam: CSRF de un solo uso + rate limit por IP
# ---------------------------------------------------------------------------

_csrf_lock = threading.Lock()
_csrf_tokens = {}   # token -> expiry epoch

def issue_csrf():
    now = time.time()
    with _csrf_lock:
        for t in [t for t, exp in _csrf_tokens.items() if exp < now]:
            _csrf_tokens.pop(t, None)
        token = secrets.token_hex(32)
        _csrf_tokens[token] = now + CSRF_TTL
    return token

def consume_csrf(token):
    if not token:
        return False
    with _csrf_lock:
        expiry = _csrf_tokens.pop(token, None)
    return bool(expiry and time.time() <= expiry)

_rate_lock = threading.Lock()
_rate_hits = {}     # ip -> [timestamps]

def rate_limited(ip):
    now = time.time()
    with _rate_lock:
        hits = [t for t in _rate_hits.get(ip, []) if now - t < RATE_WINDOW]
        if len(hits) >= RATE_LIMIT:
            _rate_hits[ip] = hits
            return True
        hits.append(now)
        _rate_hits[ip] = hits
    return False

# ---------------------------------------------------------------------------
# Validación de la reserva
# ---------------------------------------------------------------------------

NOMBRE_RE = re.compile(r"^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ'\-\. ]{3,100}$")
TEL_RE = re.compile(r"^\d{4}-\d{4}$")
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]{2,}$")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")

def _clean_text(value, limit):
    if value is None:
        return ""
    value = str(value)
    value = "".join(ch for ch in value if ch >= " " or ch in "\n")
    value = re.sub(r"[ \t]+", " ", value).strip()
    return value[:limit]

def validar_reserva(f):
    """Devuelve (datos_limpios, error). error es None si todo es válido."""
    nombre = _clean_text(f.get("nombre"), 100)
    nombre = re.sub(r"\s{2,}", " ", nombre)
    if not NOMBRE_RE.match(nombre):
        return None, "Ingrese su nombre completo (solo letras, entre 3 y 100 caracteres)."

    telefono = _clean_text(f.get("telefono"), 20)
    if not TEL_RE.match(telefono):
        return None, "Ingrese un teléfono válido de Honduras con formato 0000-0000."

    email = _clean_text(f.get("email"), 100)
    if email and not EMAIL_RE.match(email):
        return None, "El correo electrónico no tiene un formato válido."

    llegada_s = _clean_text(f.get("fecha_llegada"), 10)
    salida_s = _clean_text(f.get("fecha_salida"), 10)
    if not DATE_RE.match(llegada_s) or not DATE_RE.match(salida_s):
        return None, "Seleccione fechas de llegada y salida válidas."
    try:
        llegada = date.fromisoformat(llegada_s)
        salida = date.fromisoformat(salida_s)
    except ValueError:
        return None, "Seleccione fechas de llegada y salida válidas."
    hoy = date.today()
    if llegada < hoy:
        return None, "La fecha de llegada no puede ser anterior a hoy."
    if salida <= llegada:
        return None, "La fecha de salida debe ser posterior a la fecha de llegada."
    noches = (salida - llegada).days
    if noches > MAX_NOCHES:
        return None, f"La estadía máxima es de {MAX_NOCHES} noches. Para estadías más largas, contáctenos directamente."

    try:
        habitaciones = int(f.get("habitaciones"))
        huespedes = int(f.get("huespedes"))
    except (TypeError, ValueError):
        return None, "Indique el número de habitaciones y de huéspedes."
    if not 1 <= habitaciones <= 4:
        return None, "El número de habitaciones debe estar entre 1 y 4."
    if not 1 <= huespedes <= 12:
        return None, "El número de huéspedes debe estar entre 1 y 12."

    mensaje = _clean_text(f.get("mensaje"), 500)

    return {
        "nombre": nombre,
        "telefono": "+504 " + telefono,
        "email": email,
        "fecha_llegada": llegada_s,
        "fecha_salida": salida_s,
        "noches": noches,
        "habitaciones": habitaciones,
        "huespedes": huespedes,
        "mensaje": mensaje,
    }, None

_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # sin 0/O/1/I

def generar_codigo(db):
    for _ in range(10):
        codigo = "HP-" + "".join(secrets.choice(_CODE_ALPHABET) for _ in range(6))
        if not db.execute("SELECT 1 FROM reservas WHERE codigo=?", (codigo,)).fetchone():
            return codigo
    raise RuntimeError("No se pudo generar un código único")

# ---------------------------------------------------------------------------
# Notificación Telegram (opcional; hilo en background, nunca bloquea la respuesta)
# ---------------------------------------------------------------------------

def notificar_telegram(datos, codigo):
    if not TG_TOKEN or not TG_CHAT:
        print(f"[TG] no configurado — reserva {codigo} guardada solo en SQLite", flush=True)
        return
    lineas = [
        "NUEVA RESERVA — Hotel Príncipe",
        f"Código: {codigo}",
        f"Nombre: {datos['nombre']}",
        f"Teléfono: {datos['telefono']}",
    ]
    if datos["email"]:
        lineas.append(f"Correo: {datos['email']}")
    lineas += [
        f"Llegada: {datos['fecha_llegada']}  |  Salida: {datos['fecha_salida']}  ({datos['noches']} noches)",
        f"Habitaciones: {datos['habitaciones']}  |  Huéspedes: {datos['huespedes']}",
    ]
    if datos["mensaje"]:
        lineas.append(f"Mensaje: {datos['mensaje']}")
    texto = "\n".join(lineas)
    try:
        payload = json.dumps({"chat_id": TG_CHAT, "text": texto}).encode("utf-8")
        req = urllib.request.Request(
            f"https://api.telegram.org/bot{TG_TOKEN}/sendMessage",
            data=payload,
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=15) as resp:
            resp.read()
        print(f"[TG] notificación enviada para {codigo}", flush=True)
    except Exception as exc:
        print(f"[TG] error enviando {codigo}: {exc}", flush=True)

# ---------------------------------------------------------------------------
# Handler HTTP
# ---------------------------------------------------------------------------

PAGES = {
    "/": "index.html",
    "/reservar": "reservar.html",
    "/admin-reservas": "admin.html",
}
STATIC_PREFIXES = ("css/", "js/", "assets/")
BLOCKED_PARTS = {"data", "submissions", "__pycache__", ".git"}

class Handler(BaseHTTPRequestHandler):
    server_version = "HotelPrincipe/1.0"
    protocol_version = "HTTP/1.1"

    # -- headers de seguridad en TODAS las respuestas -----------------------
    def end_headers(self):
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "strict-origin-when-cross-origin")
        self.send_header(
            "Content-Security-Policy",
            "default-src 'self'; "
            "script-src 'self'; "
            "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
            "font-src https://fonts.gstatic.com; "
            "img-src 'self' data:; "
            "frame-src https://www.google.com; "
            "connect-src 'self'; "
            "base-uri 'self'; form-action 'self'"
        )
        super().end_headers()

    def log_message(self, fmt, *args):
        print(f"[{self.log_date_time_string()}] {self.client_address[0]} {fmt % args}", flush=True)

    # -- helpers de respuesta -----------------------------------------------
    def _send(self, status, body, ctype="application/json; charset=utf-8", extra=None):
        if isinstance(body, str):
            body = body.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def json_ok(self, data, status=200):
        self._send(status, json.dumps(data, ensure_ascii=False))

    def json_error(self, status, message):
        self.json_ok({"ok": False, "error": message}, status=status)

    def silent_reject(self):
        """Anti-spam: 200 genérico para que el bot no aprenda qué lo detuvo."""
        self.json_ok({"ok": True, "message": "Solicitud recibida. El hotel le contactará para confirmar."})

    # -- GET -----------------------------------------------------------------
    def do_HEAD(self):
        path = urlparse(self.path).path
        if path in PAGES or path == "/health":
            self._send(200, b"", "text/html; charset=utf-8")
        else:
            self._send(404, b"", "text/plain; charset=utf-8")

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        query = parse_qs(parsed.query)

        if path == "/health":
            try:
                n = get_db().execute("SELECT COUNT(*) FROM reservas").fetchone()[0]
            except Exception:
                n = -1
            return self.json_ok({"ok": True, "servicio": "hotel-principe", "reservas": n})

        if path == "/api/csrf":
            return self.json_ok({"ok": True, "token": issue_csrf()})

        if path == "/api/admin/reservas":
            return self.admin_list(query)

        if path in PAGES:
            return self.serve_file(BASE_DIR / PAGES[path], "text/html; charset=utf-8")

        rel = path.lstrip("/")
        if rel.startswith(STATIC_PREFIXES):
            target = (BASE_DIR / rel).resolve()
            if (
                target.is_relative_to(BASE_DIR)
                and target.parts[len(BASE_DIR.parts)] not in BLOCKED_PARTS
                and not any(p.startswith(".") for p in target.relative_to(BASE_DIR).parts)
                and target.is_file()
            ):
                ctype = mimetypes.guess_type(str(target))[0] or "application/octet-stream"
                return self.serve_file(target, ctype)

        self._send(404, "Página no encontrada.", "text/plain; charset=utf-8")

    def serve_file(self, target, ctype):
        try:
            body = target.read_bytes()
        except OSError:
            return self._send(404, "Página no encontrada.", "text/plain; charset=utf-8")
        extra = {}
        if ctype.startswith("text/html"):
            extra["Cache-Control"] = "no-cache"
        else:
            extra["Cache-Control"] = "public, max-age=3600"
        self._send(200, body, ctype, extra)

    # -- POST ----------------------------------------------------------------
    def do_POST(self):
        path = urlparse(self.path).path
        try:
            length = int(self.headers.get("Content-Length", 0))
        except ValueError:
            length = 0
        if length <= 0 or length > MAX_BODY:
            return self.json_error(400, "Solicitud inválida.")
        raw = self.rfile.read(length)
        try:
            fields = json.loads(raw.decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            return self.json_error(400, "Solicitud inválida.")
        if not isinstance(fields, dict):
            return self.json_error(400, "Solicitud inválida.")

        if path == "/api/reservas":
            return self.crear_reserva(fields)
        if path == "/api/admin/reservas/estado":
            return self.admin_estado(fields)
        self.json_error(404, "Ruta no encontrada.")

    # -- lógica de reservas ---------------------------------------------------
    def crear_reserva(self, f):
        ip = self.client_address[0]

        # Capa 1: honeypot
        if _clean_text(f.get("website"), 200):
            return self.silent_reject()

        # Capa 2: time trap
        load_ts = f.get("_load_time")
        try:
            elapsed = time.time() - float(load_ts)
        except (TypeError, ValueError):
            return self.silent_reject()
        if elapsed < MIN_FORM_SECONDS or elapsed > MAX_FORM_SECONDS:
            return self.silent_reject()

        # Capa 3: CSRF de un solo uso
        if not consume_csrf(f.get("csrf_token")):
            return self.silent_reject()

        # Rate limit explícito (este sí devuelve 429)
        if rate_limited(ip):
            return self.json_error(429, "Ha enviado varias solicitudes en poco tiempo. Espere unos minutos o contáctenos por teléfono.")

        datos, error = validar_reserva(f)
        if error:
            return self.json_error(422, error)

        db = get_db()
        codigo = generar_codigo(db)
        db.execute(
            """INSERT INTO reservas
               (codigo, nombre, telefono, email, fecha_llegada, fecha_salida,
                noches, habitaciones, huespedes, mensaje, ip)
               VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
            (codigo, datos["nombre"], datos["telefono"], datos["email"],
             datos["fecha_llegada"], datos["fecha_salida"], datos["noches"],
             datos["habitaciones"], datos["huespedes"], datos["mensaje"], ip),
        )
        db.commit()
        print(f"[RESERVA] {codigo} {datos['nombre']} {datos['fecha_llegada']}→{datos['fecha_salida']}", flush=True)

        threading.Thread(target=notificar_telegram, args=(datos, codigo), daemon=True).start()

        self.json_ok({
            "ok": True,
            "codigo": codigo,
            "nombre": datos["nombre"],
            "fecha_llegada": datos["fecha_llegada"],
            "fecha_salida": datos["fecha_salida"],
            "noches": datos["noches"],
            "habitaciones": datos["habitaciones"],
            "huespedes": datos["huespedes"],
            "message": "Solicitud de reserva recibida. El hotel le contactará para confirmar disponibilidad.",
        })

    # -- administración -------------------------------------------------------
    def _check_admin_key(self, key):
        if not ADMIN_KEY:
            self.json_error(503, "La administración no está configurada en este servidor.")
            return False
        if not key or not hmac.compare_digest(str(key), ADMIN_KEY):
            self.json_error(401, "Llave de administración incorrecta.")
            return False
        return True

    def admin_list(self, query):
        if not self._check_admin_key((query.get("key") or [""])[0]):
            return
        estado = (query.get("estado") or [""])[0]
        db = get_db()
        if estado in ESTADOS:
            rows = db.execute(
                "SELECT * FROM reservas WHERE estado=? ORDER BY id DESC LIMIT 200", (estado,)
            ).fetchall()
        else:
            rows = db.execute("SELECT * FROM reservas ORDER BY id DESC LIMIT 200").fetchall()
        conteo = {e: db.execute("SELECT COUNT(*) FROM reservas WHERE estado=?", (e,)).fetchone()[0] for e in ESTADOS}
        self.json_ok({"ok": True, "reservas": [dict(r) for r in rows], "conteo": conteo})

    def admin_estado(self, f):
        if not self._check_admin_key(f.get("key")):
            return
        codigo = _clean_text(f.get("codigo"), 20)
        estado = _clean_text(f.get("estado"), 20)
        if estado not in ESTADOS:
            return self.json_error(422, "Estado inválido.")
        db = get_db()
        cur = db.execute(
            "UPDATE reservas SET estado=?, updated_at=datetime('now','localtime') WHERE codigo=?",
            (estado, codigo),
        )
        db.commit()
        if cur.rowcount == 0:
            return self.json_error(404, "No existe una reserva con ese código.")
        self.json_ok({"ok": True, "codigo": codigo, "estado": estado})

# ---------------------------------------------------------------------------

def main():
    init_db()
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    server.daemon_threads = True
    print(f"Hotel Príncipe escuchando en http://{HOST}:{PORT}", flush=True)
    print(f"  Telegram: {'configurado' if TG_TOKEN and TG_CHAT else 'NO configurado (solo SQLite)'}", flush=True)
    print(f"  Admin:    {'habilitado' if ADMIN_KEY else 'deshabilitado (falta ADMIN_KEY)'}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("Apagando…", flush=True)
        server.shutdown()

if __name__ == "__main__":
    main()
