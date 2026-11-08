"""Single-user CEO OS cloud snapshot storage. Requires DATABASE_URL."""
import json
import os
from contextlib import closing
import psycopg

DATABASE_URL = os.getenv("DATABASE_URL", "").strip()
KINDS = ("tasks", "workouts", "posts", "routines", "weigh_ins", "lifts", "fitness_goals", "money_entries", "balance_items", "time_blocks", "goals", "leads", "bills", "budgets")

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
            if kind in ("money_entries","balance_items"):
                from datetime import date
                day=item.get("date")
                amount=item.get("amount")
                category=item.get("category","Other")
                if not isinstance(day,str) or len(day)!=10:
                    raise ValueError("Invalid financial entry date")
                try:
                    date.fromisoformat(day)
                except ValueError:
                    raise ValueError("Invalid financial entry date")
                if type(amount) not in (int,float) or not 0<=amount<=1000000000:
                    raise ValueError("Invalid financial entry amount")
                if kind=="money_entries":
                    direction=item.get("direction")
                    if direction not in ("Income","Expense"):
                        raise ValueError("Invalid income or expense type")
                    if category not in ("Paycheck","Business owner draw","Other income","Housing","Utilities","Transportation","Food","Insurance","Debt payment","Shopping","Entertainment","Health","Savings transfer","Other"):
                        raise ValueError("Invalid transaction category")
                    clean_item.update({"direction":direction,"category":category})
                else:
                    direction=item.get("direction")
                    if direction not in ("Asset","Debt"):
                        raise ValueError("Invalid asset or liability type")
                    if category not in ("Cash","Bank","Investments","Vehicle","Property","Credit card","Vehicle loan","Equipment loan","Personal loan","Mortgage","Other"):
                        raise ValueError("Invalid balance category")
                    clean_item.update({"direction":direction,"category":category})
                clean_item.update({"date":day,"amount":round(amount,2)})
            if kind == "posts":
                from datetime import date
                platform=item.get("platform","Other")
                stage=item.get("stage","Idea")
                if platform not in ("Instagram","Facebook","TikTok","YouTube","LinkedIn","Other"):
                    raise ValueError("Invalid content platform")
                if stage not in ("Idea","Draft","Ready","Scheduled","Published"):
                    raise ValueError("Invalid pipeline stage")
                scheduled=item.get("scheduled","")
                published=item.get("published","")
                for field in (scheduled,published):
                    if not isinstance(field,str) or (field and len(field)!=10):
                        raise ValueError("Invalid content date")
                    if field:
                        try:
                            date.fromisoformat(field)
                        except ValueError:
                            raise ValueError("Invalid content date")
                if stage == "Scheduled" and not scheduled:
                    raise ValueError("A scheduled post needs a date")
                stats={}
                for metric in ("views","likes","comments","shares","followers"):
                    value=item.get("stats",{}).get(metric,0) if isinstance(item.get("stats",{}),dict) else 0
                    if type(value) is not int or not 0<=value<=1000000000:
                        raise ValueError("Invalid content analytics")
                    stats[metric]=value
                clean_item.update({"platform":platform,"stage":stage,"scheduled":scheduled,"published":published,"stats":stats})
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
            if kind in ("time_blocks","goals","leads","bills","budgets"):
                from datetime import date
                import math
                def valid_date(value,optional=False):
                    if optional and value=="":return value
                    if not isinstance(value,str) or len(value)!=10:raise ValueError("Invalid date")
                    try:date.fromisoformat(value)
                    except ValueError:raise ValueError("Invalid date")
                    return value
                def amount_value(field,maximum=1000000000):
                    value=item.get(field)
                    if type(value) not in (int,float) or not math.isfinite(value) or not 0<=value<=maximum:
                        raise ValueError("Invalid "+field)
                    return round(value,2)
                if kind=="time_blocks":
                    day=valid_date(item.get("date"))
                    start=item.get("start")
                    end=item.get("end")
                    def time_ok(value):
                        return isinstance(value,str) and len(value)==5 and value[2]==":" and value[:2].isdigit() and value[3:].isdigit() and 0<=int(value[:2])<=23 and 0<=int(value[3:])<=59
                    if not time_ok(start) or not time_ok(end) or start>=end:
                        raise ValueError("Invalid time block")
                    focus=item.get("focus","Work")
                    if focus not in ("Work","Personal","Fitness"):
                        raise ValueError("Invalid focus")
                    clean_item.update({"date":day,"start":start,"end":end,"focus":focus})
                elif kind=="goals":
                    area=item.get("area")
                    unit=item.get("unit")
                    if area not in ("Business","Personal","Fitness") or unit not in ("USD","Count","Percent"):
                        raise ValueError("Invalid goal type")
                    target=amount_value("target")
                    current=amount_value("current")
                    if target<=0 or (unit=="Percent" and (target>100 or current>100)):
                        raise ValueError("Invalid goal target")
                    clean_item.update({"area":area,"unit":unit,"target":target,"current":current,
                                      "deadline":valid_date(item.get("deadline",""),True)})
                elif kind=="leads":
                    stage=item.get("stage")
                    if stage not in ("New","Contacted","Quoted","Won","Lost"):
                        raise ValueError("Invalid lead stage")
                    notes=item.get("notes","")
                    service=item.get("service","Other")
                    if not isinstance(notes,str) or len(notes)>500 or not isinstance(service,str) or len(service)>100:
                        raise ValueError("Invalid lead details")
                    clean_item.update({"stage":stage,"value":amount_value("value"),
                                       "follow_up":valid_date(item.get("follow_up",""),True),
                                       "service":service.strip() or "Other","notes":notes.strip()})
                elif kind=="bills":
                    due_day=item.get("due_day")
                    paid=item.get("paid_months",[])
                    if type(due_day) is not int or not 1<=due_day<=31 or not isinstance(paid,list) or len(paid)>24:
                        raise ValueError("Invalid monthly bill")
                    if any(not isinstance(month,str) or len(month)!=7 or month[4]!="-" or not month[:4].isdigit() or not month[5:].isdigit() or not 1<=int(month[5:])<=12 for month in paid):
                        raise ValueError("Invalid bill month")
                    clean_item.update({"amount":amount_value("amount"),"due_day":due_day,
                                       "paid_months":sorted(set(paid))[-24:]})
                elif kind=="budgets":
                    category=item.get("category")
                    if category not in ("Housing","Utilities","Transportation","Food","Insurance","Debt payment","Shopping","Entertainment","Health","Other"):
                        raise ValueError("Invalid budget category")
                    clean_item.update({"category":category,"limit":amount_value("limit")})
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
