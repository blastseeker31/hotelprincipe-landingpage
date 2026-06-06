FROM python:3.12-alpine
WORKDIR /app
COPY server.py .
COPY index.html trabajo.html .
COPY css/ css/
COPY js/ js/
COPY assets/ assets/
CMD ["python3", "server.py"]
