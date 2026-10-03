FROM python:3.13-alpine
WORKDIR /app
COPY index.html /app/index.html
COPY server.py /app/server.py
COPY qb_mapping_rules.py /app/qb_mapping_rules.py
COPY server_entry.py /app/server_entry.py
EXPOSE 8080
CMD ["python", "server_entry.py"]
