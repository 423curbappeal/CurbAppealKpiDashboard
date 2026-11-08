FROM python:3.13-alpine
WORKDIR /app
RUN pip install --no-cache-dir 'psycopg[binary]>=3.2,<4' 'icalendar>=6,<7' 'recurring-ical-events>=3,<4' 'webauthn>=2.2,<3' 'cryptography>=44,<48'
COPY index.html staging_server.py cloud_storage.py business_kpi.py google_calendar_feed.py passkey_auth.py passkey_login.html plaid_sandbox.py plaid_categorize.py recovery_auth.py recovery_login.html ./
EXPOSE 8080
CMD ["python", "staging_server.py"]
