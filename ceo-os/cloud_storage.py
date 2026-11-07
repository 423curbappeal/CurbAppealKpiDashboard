"""Single-user CEO OS cloud snapshot storage. Requires DATABASE_URL."""
import json
import os
from contextlib import closing
import psycopg

DATABASE_URL = os.getenv("DATABASE_URL", "").strip()
KINDS = ("tasks", "workouts", "posts")

def validate(body):
    if not isinstance(body, dict) or set(body) != set(KINDS):
        raise ValueError("Invalid state shape")
    clean = {}
    for kind in KINDS:
        items = body[kind]
        if not isinstance(items, list) or len(items) > 250:
            raise ValueError("Invalid item count")
        result = []
        seen = set()
        for item in items:
            if not isinstance(item, dict):
                raise ValueError("Invalid item")
            item_id, label, when = item.get("id"), item.get("text"), item.get("when")
            if not isinstance(item_id, str) or not 1 <= len(item_id) <= 100 or item_id in seen:
                raise ValueError("Invalid or duplicate ID")
            if not isinstance(label, str) or not 1 <= len(label.strip()) <= (350 if kind == "posts" else 160):
                raise ValueError("Invalid entry text")
            if not isinstance(when, (int, float)) or not 0 < when < 1e14:
                raise ValueError("Invalid entry date")
            seen.add(item_id)
            result.append({"id":item_id, "text":label.strip(), "when":when, "done":bool(item.get("done", False)) if kind == "tasks" else False})
        clean[kind] = result
    return clean

def fetch():
    with closing(psycopg.connect(DATABASE_URL, connect_timeout=5)) as connection:
        with connection.cursor() as cur:
            cur.execute("CREATE TABLE IF NOT EXISTS ceo_os_state (id INTEGER PRIMARY KEY CHECK (id=1), revision BIGINT NOT NULL, payload JSONB NOT NULL)")
            cur.execute("INSERT INTO ceo_os_state(id, revision, payload) VALUES (1, 0, %s::jsonb) ON CONFLICT (id) DO NOTHING", (json.dumps({k: [] for k in KINDS}),))
            cur.execute("SELECT revision, payload FROM ceo_os_state WHERE id=1")
            revision, payload = cur.fetchone()
        connection.commit()
    return {"revision":revision, "state":payload}

def update(revision, state):
    state = validate(state)
    if type(revision) is not int or revision < 0:
        raise ValueError("Invalid revision")
    with closing(psycopg.connect(DATABASE_URL, connect_timeout=5)) as connection:
        with connection.cursor() as cur:
            cur.execute("UPDATE ceo_os_state SET revision=revision+1, payload=%s::jsonb WHERE id=1 AND revision=%s RETURNING revision", (json.dumps(state), revision))
            row = cur.fetchone()
            connection.commit()
    if not row:
        return None
    return {"revision":row[0], "state":state}
