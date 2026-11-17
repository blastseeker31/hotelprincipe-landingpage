# Hotel Príncipe — sitio web + sistema de reservas

Desarrollo local (AcerSwiftX). Migración pendiente a Hetzner vía Docker + NPM.

## Correr en local

Paso 1:
cd ~/hermes_projects/hotel-principe

Paso 2:
python3 server.py

Sitio: http://127.0.0.1:8090
Reservas: http://127.0.0.1:8090/reservar
Admin: http://127.0.0.1:8090/admin-reservas (llave en .env → ADMIN_KEY)
Salud: http://127.0.0.1:8090/health

## Configuración (.env, no subir a git)

- HOST / PORT — bind local por defecto 127.0.0.1:8090
- ADMIN_KEY — llave del panel de reservas (generada aleatoriamente)
- TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID — opcionales; sin ellos las reservas
  se guardan en SQLite y se registran en el log, sin notificación push.
- DATA_DIR — carpeta de la base SQLite (fuera del document root)

## Flujo de reserva

1. Huésped envía solicitud en /reservar (fechas, habitaciones, huéspedes, contacto).
2. Anti-spam triple: honeypot + time trap (≥3 s) + CSRF de un solo uso.
   Los rechazos anti-spam devuelven 200 genérico; el rate limit (5/IP/h) devuelve 429.
3. Se guarda en data/reservas.sqlite3 con código único HP-XXXXXX y estado "pendiente".
4. Notificación Telegram al hotel (si está configurado), en hilo aparte.
5. El hotel confirma disponibilidad por teléfono/WhatsApp y marca la reserva
   como confirmada o cancelada desde /admin-reservas.

No se muestran precios ni se cobra en línea: la confirmación es manual,
como opera el hotel actualmente.

## Migración a Hetzner

Paso 1: copiar el proyecto al servidor (rsync/git), incluyendo .env con claves nuevas.

Paso 2:
docker compose up -d --build

Paso 3: en NPM, proxy host hotelprincipelcb.com → hotel-principe:8080 con SSL Let's Encrypt.

Paso 4: apuntar DNS del dominio a la IP de Hetzner.

Los archivos HTML/CSS/JS se COPIAN en el build (no van montados): cualquier
cambio requiere `docker compose up -d --build`. Solo data/ es volumen persistente.

## Migración a Hetzner (pendiente)

- El sistema de postulaciones de empleo de producción (`/trabajo`, `POST /api/trabajo` multipart) quedó preservado en `server_legacy_empleo.py` + `css/style-legacy.css` + `trabajo.html`. **Portar ese endpoint al nuevo `server.py` antes de desplegar en Hetzner** para no perder la funcionalidad existente.
- `main` conserva el sitio de producción actual (DigitalOcean, caído al 2026-11-17). La rama `feat/reservas-web` es el desarrollo local del nuevo sitio con reservas.
- Despliegue: `docker compose up -d --build` en Hetzner (red externa `proyectitos`), Nginx Proxy Manager + SSL hacia `hotel-principe:8080`. Secretos en `.env` (no versionado).
- Fotos reales de habitaciones/fachada: pendientes de conseguir (no hay assets utilizables en el equipo; las de `hotel-cumpleanos` son privadas de huéspedes).
