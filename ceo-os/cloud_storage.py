"""Single-user CEO OS cloud snapshot storage. Requires DATABASE_URL."""
import json
import os
from contextlib import closing
import psycopg

DATABASE_URL = os.getenv("DATABASE_URL", "").strip()
KINDS = ("tasks", "workouts", "posts", "routines", "weigh_ins", "lifts", "fitness_goals")

def validate(body):
    if not isinstance(body, dict) or not set(("tasks", "workouts", "posts")).issubset(body) or set(body) - set(KINDS):
        raise ValueError("Invalid state shape")
    clean = {}
    for kind in KINDS:
        items = body.get(kind, [])
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
            clean_item={"id":item_id, "text":label.strip(), "when":when, "done":bool(item.get("done", False)) if kind == "tasks" else False}
            if kind == "tasks":
                due=item.get("due","")
                if not isinstance(due,str) or (due and (len(due)!=10 or due[4]!="-" or due[7]!="-")):
                    raise ValueError("Invalid due date")
                if due:
                    from datetime import date
                    try:
                        date.fromisoformat(due)
                    except ValueError:
                        raise ValueError("Invalid due date")
                priority=item.get("priority","normal")
                if priority not in ("top","normal"):
                    raise ValueError("Invalid priority")
                clean_item.update({"due":due,"priority":priority})
            if kind == "routines":
                days=item.get("days",[0,1,2,3,4,5,6])
                if not isinstance(days,list) or not days or len(days)>7 or any(type(d)!=int or d<0 or d>6 for d in days) or len(set(days))!=len(days):
                    raise ValueError("Invalid routine schedule")
                completed=item.get("completed",[])
                if not isinstance(completed,list) or len(completed)>180:
                    raise ValueError("Invalid routine check-in history")
                from datetime import date
                for day in completed:
                    if not isinstance(day,str) or len(day)!=10:
                        raise ValueError("Invalid check-in date")
                    try:
                        date.fromisoformat(day)
                    except ValueError:
                        raise ValueError("Invalid check-in date")
                clean_item.update({"days":days,"completed":sorted(set(completed))[-180:]})
            if kind == "workouts":
                category=item.get("category","Other")
                if category not in ("Push","Pull","Legs","Upper","Lower","Full Body","Cardio","Other"):
                    raise ValueError("Invalid workout category")
                duration=item.get("duration",0)
                if type(duration) not in (int,float) or not 0 <= duration <= 600:
                    raise ValueError("Invalid workout duration")
                clean_item.update({"category":category,"duration":int(duration)})
            if kind == "fitness_goals":
                target=item.get("target")
                if type(target) is not int or not 1 <= target <= 7:
                    raise ValueError("Invalid weekly fitness goal")
                clean_item["target"]=target
            if kind in ("weigh_ins","lifts"):
                from datetime import date
                day=item.get("date")
                if not isinstance(day,str) or len(day)!=10:
                    raise ValueError("Invalid tracking date")
                try:
                    date.fromisoformat(day)
                except ValueError:
                    raise ValueError("Invalid tracking date")
                clean_item["date"]=day
                if kind=="weigh_ins":
                    amount=item.get("pounds")
                    if type(amount) not in (int,float) or not 50 <= amount <= 800:
                        raise ValueError("Invalid body weight")
                    clean_item["pounds"]=round(amount,2)
                else:
                    amount=item.get("pounds")
                    reps=item.get("reps")
                    if type(amount) not in (int,float) or not 0 <= amount <= 1500:
                        raise ValueError("Invalid lift weight")
                    if type(reps) is not int or not 1 <= reps <= 100:
                        raise ValueError("Invalid reps")
                    clean_item.update({"pounds":round(amount,2),"reps":reps})
            result.append(clean_item)
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
