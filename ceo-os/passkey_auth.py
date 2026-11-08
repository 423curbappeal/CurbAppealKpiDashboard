"""Opt-in single-user passkeys for the private CEO OS staging app.
Keeps HTTP Basic available as a recovery login.
"""
import base64
import hashlib
import hmac
import json
import os
import secrets
import threading
import time
from datetime import datetime, timezone
from http.cookies import SimpleCookie
from urllib.parse import urlsplit
from contextlib import closing
import psycopg
from webauthn import (generate_registration_options, verify_registration_response,
                     generate_authentication_options, verify_authentication_response,
                     options_to_json, base64url_to_bytes)
from webauthn.helpers.structs import (AuthenticatorSelectionCriteria,
                                     ResidentKeyRequirement, UserVerificationRequirement,
                                     PublicKeyCredentialDescriptor)

USERNAME = os.getenv("CEO_OS_USERNAME", "")
SESSION_SECRET = os.getenv("CEO_OS_SESSION_SECRET","").strip()
DATABASE_URL = os.getenv("DATABASE_URL","").strip()
# Inactive unless a new secret is explicitly provisioned.
ENABLED = bool(SESSION_SECRET and len(SESSION_SECRET)>=40 and DATABASE_URL)
LIFETIME = 7*86400
CHALLENGE_AGE = 180
_challenges = {}
_guard = threading.Lock()

def b64(value):
    return base64.urlsafe_b64encode(value).decode().rstrip("=")

def digest(value):
    return hmac.new(SESSION_SECRET.encode(),value.encode(),hashlib.sha256).hexdigest()

def origin(host):
    if not host or "/" in host or "@" in host or len(host)>255:
        raise ValueError("Invalid website host")
    split=urlsplit("https://"+host)
    if not split.hostname or split.port not in (None,443):
        raise ValueError("Invalid origin")
    return "https://"+split.hostname

def secure_request(headers):
    host=headers.get("Host","")
    referer=headers.get("Origin","")
    return bool(host and referer==origin(host))

def _db():
    if not ENABLED:
        raise ValueError("Passkeys not configured")
    connection=psycopg.connect(DATABASE_URL,connect_timeout=5)
    with connection.cursor() as cur:
        cur.execute("""CREATE TABLE IF NOT EXISTS ceo_passkeys (
            credential_id TEXT PRIMARY KEY, public_key BYTEA NOT NULL,
            sign_count BIGINT NOT NULL DEFAULT 0, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())""")
        connection.commit()
    return connection

def credentials():
    with closing(_db()) as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT credential_id,public_key,sign_count FROM ceo_passkeys ORDER BY created_at")
            return cur.fetchall()

def has_passkeys():
    if not ENABLED:
        return False
    with closing(_db()) as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT EXISTS (SELECT 1 FROM ceo_passkeys)")
            return bool(cur.fetchone()[0])

def _challenge(kind, challenge):
    value=b64(challenge)
    with _guard:
        now=time.monotonic()
        for token,record in list(_challenges.items()):
            if record["expires"]<now:
                del _challenges[token]
        token=secrets.token_urlsafe(32)
        _challenges[token]={"kind":kind,"challenge":value,"expires":now+CHALLENGE_AGE}
    return token

def _consume(kind, token):
    with _guard:
        item=_challenges.pop(token,None)
    if not item or item["kind"]!=kind or item["expires"]<time.monotonic():
        raise ValueError("Sign-in expired; try again")
    return base64url_to_bytes(item["challenge"])

def register_options(host):
    if not ENABLED: raise ValueError("Set CEO_OS_SESSION_SECRET (40+ random characters)")
    current=credentials()
    if len(current)>=10:
        raise ValueError("Maximum registered passkeys reached")
    rp=origin(host).removeprefix("https://")
    opts=generate_registration_options(
        rp_id=rp,rp_name="CEO OS",user_name=USERNAME,user_display_name="CEO OS Owner",
        user_id=hashlib.sha256(("ceo-os-user:"+USERNAME).encode()).digest(),
        authenticator_selection=AuthenticatorSelectionCriteria(resident_key=ResidentKeyRequirement.PREFERRED,
                                                               user_verification=UserVerificationRequirement.REQUIRED),
        exclude_credentials=[PublicKeyCredentialDescriptor(id=base64url_to_bytes(i[0])) for i in current],
        timeout=60000
    )
    token=_challenge("register",opts.challenge)
    return {"token":token,"options":json.loads(options_to_json(opts))}

def register_verify(host, token, credential):
    expected=_consume("register",token)
    verified=verify_registration_response(
        credential=credential, expected_challenge=expected,
        expected_rp_id=origin(host).removeprefix("https://"),
        expected_origin=origin(host),require_user_verification=True)
    with closing(_db()) as conn:
        with conn.cursor() as cur:
            cur.execute("INSERT INTO ceo_passkeys(credential_id,public_key,sign_count) VALUES (%s,%s,%s) ON CONFLICT DO NOTHING",
                        (b64(verified.credential_id),verified.credential_public_key,verified.sign_count))
        conn.commit()
    return {"ok":True,"message":"Passkey registered. Keep the password login as a backup."}

def login_options(host):
    if not ENABLED:
        raise ValueError("Passkeys not enabled")
    records=credentials()
    if not records:
        raise ValueError("No passkey registered yet; sign in using your password")
    opts=generate_authentication_options(
        rp_id=origin(host).removeprefix("https://"),
        allow_credentials=[PublicKeyCredentialDescriptor(id=base64url_to_bytes(record[0])) for record in records],
        user_verification=UserVerificationRequirement.REQUIRED,timeout=60000
    )
    token=_challenge("login",opts.challenge)
    return {"token":token,"options":json.loads(options_to_json(opts))}

def login_verify(host,token,credential):
    expected=_consume("login",token)
    ident=credential.get("id","")
    records={record[0]:record for record in credentials()}
    record=records.get(ident)
    if not record:
        raise ValueError("Unknown passkey")
    checked=verify_authentication_response(
        credential=credential,expected_challenge=expected,
        expected_rp_id=origin(host).removeprefix("https://"),
        expected_origin=origin(host),credential_public_key=bytes(record[1]),
        credential_current_sign_count=record[2],require_user_verification=True
    )
    with closing(_db()) as conn:
        with conn.cursor() as cur:
            cur.execute("UPDATE ceo_passkeys SET sign_count=GREATEST(sign_count,%s) WHERE credential_id=%s",
                        (checked.new_sign_count,ident))
        conn.commit()
    return issue_session("passkey")

def _sessions_table(cur):
    cur.execute("""CREATE TABLE IF NOT EXISTS ceo_sessions
        (token_hash TEXT PRIMARY KEY, expires_at BIGINT NOT NULL,
         auth_method TEXT NOT NULL DEFAULT 'passkey')""")
    # Existing sessions created before this migration must remain valid.
    cur.execute("""ALTER TABLE ceo_sessions ADD COLUMN IF NOT EXISTS
        auth_method TEXT NOT NULL DEFAULT 'passkey'""")

def issue_session(method):
    if not ENABLED or method not in ("passkey","password"):
        raise ValueError("Invalid authentication method")
    expiry=int(time.time())+LIFETIME
    nonce=secrets.token_urlsafe(32)
    with closing(_db()) as conn:
        with conn.cursor() as cur:
            _sessions_table(cur)
            cur.execute("DELETE FROM ceo_sessions WHERE expires_at < %s",(int(time.time()),))
            cur.execute("""INSERT INTO ceo_sessions(token_hash,expires_at,auth_method)
                           VALUES (%s,%s,%s)""",
                        (hashlib.sha256(nonce.encode()).hexdigest(),expiry,method))
        conn.commit()
    payload=f"v2.{expiry}.{nonce}"
    return b64(payload.encode())+"."+digest(payload)

def _session_payload(headers):
    raw=headers.get("Cookie","")
    cookie=SimpleCookie()
    cookie.load(raw)
    ticket=cookie["ceo_session"].value
    encoded,mac=ticket.rsplit(".",1)
    payload=base64.urlsafe_b64decode(encoded+"="*(-len(encoded)%4)).decode()
    pieces=payload.split(".")
    if (len(pieces)!=3 or pieces[0]!="v2" or
        not hmac.compare_digest(mac,digest(payload)) or
        int(pieces[1])<=int(time.time()) or
        int(pieces[1])>int(time.time())+LIFETIME or
        len(pieces[2])<30):
        return None
    return int(pieces[1]),hashlib.sha256(pieces[2].encode()).hexdigest()

def session_method(headers):
    if not ENABLED:return None
    try:
        record=_session_payload(headers)
        if not record:return None
        expiry,token_hash=record
        with closing(_db()) as conn:
            with conn.cursor() as cur:
                _sessions_table(cur)
                cur.execute("""SELECT expires_at,auth_method
                    FROM ceo_sessions WHERE token_hash=%s""",(token_hash,))
                row=cur.fetchone()
            conn.commit()
        return row[1] if row and row[0]==expiry else None
    except Exception:
        return None

def session_valid(headers,method=None):
    value=session_method(headers)
    return bool(value and (method is None or value==method))

def revoke_session(headers):
    if not ENABLED:return
    try:
        record=_session_payload(headers)
        if record:
            with closing(_db()) as conn:
                with conn.cursor() as cur:
                    cur.execute("DELETE FROM ceo_sessions WHERE token_hash=%s",(record[1],))
                conn.commit()
    except Exception:
        # Failing a logout must not report success.
        raise

def cookie_header(ticket):
    return f"ceo_session={ticket}; Path=/; Max-Age={LIFETIME}; Secure; HttpOnly; SameSite=Strict"

def expired_cookie():
    return "ceo_session=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Strict"
