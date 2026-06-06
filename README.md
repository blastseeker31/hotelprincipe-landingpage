# Hotel Príncipe

Landing page y sistema de postulaciones laborales para Hotel Príncipe, hotel boutique en La Ceiba, Atlántida, Honduras.

## Stack

- **Frontend:** HTML5, CSS3, JavaScript vanilla
- **Backend:** Python 3 (`http.server`)
- **Base de datos:** SQLite (postulaciones)
- **Despliegue:** Docker

## Características

- Landing page con diseño boutique
- SEO completo con datos estructurados
- Formulario de postulación laboral con subida de archivos
- Protección anti-spam integrada
- Diseño responsive, mobile-first

## Instalación

```bash
git clone git@github.com:blastseeker31/hotel-principe.git
cd hotel-principe
python3 server.py
```

Abrir `http://localhost:8080` en el navegador.

## Docker

```bash
docker compose up -d
```

## Estructura

```
hotel-principe/
├── index.html          # Landing page principal
├── trabajo.html        # Página de ofertas laborales
├── server.py           # Servidor HTTP + API de postulaciones
├── css/                # Hojas de estilo
├── js/                 # JavaScript frontend
├── assets/             # Imágenes, logos, favicon
├── docker/             # Configuración Docker
└── docker-compose.yml
```
