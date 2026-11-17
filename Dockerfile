FROM python:3.12-slim
WORKDIR /app
COPY server.py index.html reservar.html admin.html ./
COPY css/ css/
COPY js/ js/
COPY assets/ assets/
RUN mkdir -p /app/data
ENV HOST=0.0.0.0 PORT=8080
EXPOSE 8080
CMD ["python3", "server.py"]
