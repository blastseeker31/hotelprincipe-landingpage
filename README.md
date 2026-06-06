# Hotel Príncipe — Hotel Boutique en La Ceiba

Landing page y sistema de postulaciones laborales para **Hotel Príncipe**, hotel boutique en el corazón de La Ceiba, Atlántida, Honduras.

📍 **Sitio:** hotelprincipelcb.com  
🔒 **Acceso:** solo vía VPN Tailscale

## Stack

- **Frontend:** HTML5 + CSS3 + JavaScript vanilla
- **Backend:** Python 3 con `http.server`
- **Base de datos:** SQLite (solicitudes de empleo)
- **Despliegue:** Docker + Nginx Proxy Manager + Cloudflare DNS

## Características

- Página de inicio tipo landing con diseño boutique
- SEO completo: JSON-LD Hotel schema, Open Graph, Twitter Cards
- Formulario de postulación laboral con subida de documentos
- Sistema anti-spam (honeypot + time trap)
- Panel de revisión de postulaciones
- Tipografía Clash Display + Satoshi (vía Fontshare)
- Totalmente responsive, mobile-first
- Protección contra CSRF, límites de rate y validación de tipos de archivo
- SSL vía Cloudflare + NPM

## Levantar local

```bash
cd hotel-principe
python3 server.py
# Abrir http://localhost:8080
```

## Docker

```bash
docker compose up -d
```

El contenedor expone el puerto 8080 y monta el volumen de submissions para compartir las postulaciones con el sistema de revisión.

## Estructura

```
hotel-principe/
├── index.html          # Landing page principal
├── trabajo.html        # Página de ofertas laborales
├── server.py           # Servidor HTTP + API
├── css/                # Hojas de estilo
├── js/                 # Scripts frontend
├── assets/             # Imágenes, logos, favicon
├── docker/             # Configuración Docker
├── submissions/        # Postulaciones recibidas (volumen externo)
└── docker-compose.yml
```

## Notas

- El dominio `hotelprincipelcb.com` está gestionado vía Cloudflare (DNS + proxy).
- Las postulaciones se almacenan en `~/hermes_projects/hotel-principe-submissions/`.
- Para revisar postulaciones: `python3 submissions/server.py` (puerto 8086).
