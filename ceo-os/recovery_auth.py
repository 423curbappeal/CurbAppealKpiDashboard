"""Rate-limited single-user password recovery for CEO OS.
Requires the existing username and password Railway variables.
"""
import hashlib
import hmac
import os
import time
from contextlib import closing
import psycopg

DATABASE_URL=os.getenv("DATABASE_URL","").strip()
USERNAME=os.getenv("CEO_OS_USERNAME","")
PASSWORD=os.getenv("CEO_OS_PASSWORD","")
WINDOW=15*60
MAX_FAILURES=6

def _db():
    c=psycopg.connect(DATABASE_URL,connect_timeout=5)
    with c.cursor() as cur:
        cur.execute("""CREATE TABLE IF NOT EXISTS ceo_recovery_attempts
            (bucket TEXT PRIMARY KEY, failures INTEGER NOT NULL,
             window_started BIGINT NOT NULL)""")
    c.commit()
    return c

def verify(username,password,ip):
    if not DATABASE_URL or not USERNAME or not PASSWORD:
        raise RuntimeError("Recovery unavailable")
    if not isinstance(username,str) or not isinstance(password,str) or not isinstance(ip,str):
        raise ValueError("Invalid credentials")
    if len(username)>160 or len(password)>500:
        raise ValueError("Invalid credentials")
    # Do not trust client-controlled forwarded headers or store full IP addresses.
    key=hashlib.sha256((ip+"|"+username.casefold()).encode()).hexdigest()
    now=int(time.time())
    with closing(_db()) as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT failures,window_started FROM ceo_recovery_attempts WHERE bucket=%s FOR UPDATE",(key,))
            current=cur.fetchone()
            if current and now-current[1]<WINDOW and current[0]>=MAX_FAILURES:
                raise ValueError("Too many attempts. Try again in 15 minutes.")
            expected=USERNAME+":"+PASSWORD
            supplied=username+":"+password
            ok=hmac.compare_digest(
                hashlib.sha256(expected.encode()).digest(),
                hashlib.sha256(supplied.encode()).digest())
            if ok:
                cur.execute("DELETE FROM ceo_recovery_attempts WHERE bucket=%s",(key,))
            else:
                count=(current[0]+1) if current and now-current[1]<WINDOW else 1
                began=current[1] if current and now-current[1]<WINDOW else now
                cur.execute("""INSERT INTO ceo_recovery_attempts(bucket,failures,window_started)
                    VALUES(%s,%s,%s) ON CONFLICT(bucket) DO UPDATE SET
                    failures=EXCLUDED.failures,window_started=EXCLUDED.window_started""",(key,count,began))
        conn.commit()
    return ok
