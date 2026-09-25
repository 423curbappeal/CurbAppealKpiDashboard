FROM python:3.13-alpine
WORKDIR /app
COPY index.html /app/index.html
COPY server.py /app/server.py
EXPOSE 8080
CMD ["python", "server.py"]
