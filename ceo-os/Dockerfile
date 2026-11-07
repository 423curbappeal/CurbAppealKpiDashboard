FROM python:3.13-alpine
WORKDIR /app
RUN pip install --no-cache-dir 'psycopg[binary]>=3.2,<4'
COPY index.html staging_server.py cloud_storage.py ./
EXPOSE 8080
CMD ["python", "staging_server.py"]
