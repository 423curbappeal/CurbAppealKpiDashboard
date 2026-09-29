import json, os, time, urllib.parse, urllib.request, urllib.error
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler

GRAPH_VERSION = os.getenv("META_GRAPH_VERSION", "v24.0")
TOKEN = os.getenv("META_ACCESS_TOKEN", "").strip()
AD_ACCOUNT = os.getenv("META_AD_ACCOUNT_ID", "").strip()
PAGE_IDS = [x.strip() for x in os.getenv("META_PAGE_IDS", "").split(",") if x.strip()]
HCP_API_KEY = os.getenv("HCP_API_KEY", "").strip()
HCP_API_BASE = "https://api.housecallpro.com"
HCP_REVIEWS_WIDGET_URL = "https://client.housecallpro.com/reviews/widget/cc375611-9a34-4c00-a095-ddf5d91cd6b6"
REVIEWS_WEBHOOK_SECRET = os.getenv("REVIEWS_WEBHOOK_SECRET", "").strip()
REVIEW_DATA_PATH = os.getenv("REVIEW_DATA_PATH", "/data/reviews.json").strip() or "/data/reviews.json"
QB_WEBHOOK_SECRET = os.getenv("QB_WEBHOOK_SECRET", REVIEWS_WEBHOOK_SECRET).strip()
QB_EXPENSE_DATA_PATH = os.getenv("QB_EXPENSE_DATA_PATH", "/data/qb_expenses.json").strip() or "/data/qb_expenses.json"
BUSINESS_TIMEZONE = os.getenv("BUSINESS_TIMEZONE", "America/New_York").strip() or "America/New_York"
BUSINESS_TZ = ZoneInfo(BUSINESS_TIMEZONE)
WEEKLY_REVENUE_GOAL = float(os.getenv("WEEKLY_REVENUE_GOAL", "6000") or 6000)
_RUNTIME_CACHE = {}

def cached_runtime(key, ttl_seconds, loader):
    now=time.time()
    item=_RUNTIME_CACHE.get(key)
    if item and (now-item.get("ts",0)) < ttl_seconds:
        return item.get("value")
    value=loader()
    _RUNTIME_CACHE[key]={"ts":now,"value":value}
    return value

def graph(path, params=None, access_token=None):
    params = dict(params or {})
    params["access_token"] = (access_token or TOKEN)
    url = "https://graph.facebook.com/" + GRAPH_VERSION + "/" + path.lstrip("/") + "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"User-Agent":"CurbAppealKPIDashboard/1.0"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode("utf-8"))

def all_pages(path, params=None, access_token=None):
    out=[]
    data=graph(path, params, access_token=access_token)
    while True:
        out.extend(data.get("data", []))
        nxt=(data.get("paging") or {}).get("next")
        if not nxt: break
        req=urllib.request.Request(nxt, headers={"User-Agent":"CurbAppealKPIDashboard/1.0"})
        with urllib.request.urlopen(req, timeout=30) as r:
            data=json.loads(r.read().decode("utf-8"))
    return out

def hcp_get(path, params=None):
    if not HCP_API_KEY:
        raise RuntimeError("Housecall Pro is not configured. Add HCP_API_KEY in Railway Variables.")

    query = urllib.parse.urlencode(params or {}, doseq=True)
    url = HCP_API_BASE + "/" + path.lstrip("/")
    if query:
        url += "?" + query

    # Housecall Pro API keys are normally sent as Authorization: Token <key>.
    # Retry as Bearer only if the account/API variant rejects Token auth.
    last_error = None
    for scheme in ("Token", "Bearer"):
        req = urllib.request.Request(
            url,
            headers={
                "Authorization": scheme + " " + HCP_API_KEY,
                "Accept": "application/json",
                "User-Agent": "CurbAppealKPIDashboard/1.0"
            }
        )
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.loads(r.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            last_error = e
            if e.code not in (401, 403) or scheme == "Bearer":
                raise
    raise last_error

def hcp_parse_datetime(value):
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except Exception:
        return None

def hcp_list_completed_jobs(start, end):
    matched=[]
    page=1
    while True:
        data=hcp_get("jobs", {
            "page":page,
            "page_size":100,
            "work_status[]":["completed"]
        })
        batch=data.get("jobs") or data.get("data") or []
        for job in batch:
            status=str(job.get("work_status") or "").lower()
            if not status.startswith("complete"):
                continue
            if job.get("deleted_at"):
                continue
            completed_at=((job.get("work_timestamps") or {}).get("completed_at"))
            completed_dt=hcp_parse_datetime(completed_at)
            if completed_dt and start <= completed_dt.date() <= end:
                matched.append(job)

        total_pages=int(data.get("total_pages") or 1)
        if page >= total_pages or not batch:
            break
        page += 1
    return matched

def hcp_list_created_jobs(start, end):
    matched=[]
    page=1
    while True:
        data=hcp_get("jobs", {
            "page":page,
            "page_size":100,
            "sort_by":"created_at",
            "sort_direction":"desc"
        })
        batch=data.get("jobs") or data.get("data") or []
        if not batch:
            break

        saw_older=False
        for job in batch:
            created_dt=hcp_parse_datetime(job.get("created_at"))
            if not created_dt:
                continue
            created_date=created_dt.date()
            if created_date < start:
                saw_older=True
                continue
            if created_date > end:
                continue

            status=str(job.get("work_status") or "").lower()
            if "cancel" in status or job.get("deleted_at"):
                continue
            matched.append(job)

        total_pages=int(data.get("total_pages") or 1)
        if saw_older or page >= total_pages:
            break
        page += 1
    return matched

def hcp_local_date(value):
    dt=hcp_parse_datetime(value)
    if not dt:
        return None
    if dt.tzinfo is None:
        dt=dt.replace(tzinfo=BUSINESS_TZ)
    else:
        dt=dt.astimezone(BUSINESS_TZ)
    return dt.date()

def hcp_customer_name_from_obj(obj):
    if not isinstance(obj,dict):
        return None
    for key in ("display_name","name","company_name","company"):
        value=str(obj.get(key) or "").strip()
        if value:
            return value
    first=str(obj.get("first_name") or "").strip()
    last=str(obj.get("last_name") or "").strip()
    full=(first+" "+last).strip()
    return full or None

def hcp_job_customer_name(job):
    if not isinstance(job,dict):
        return "Unknown customer"
    name=hcp_customer_name_from_obj(job.get("customer"))
    if name:
        return name
    for key in ("customer_name","company_name"):
        value=str(job.get(key) or "").strip()
        if value:
            return value
    return "Job " + str(job.get("id") or "")[-8:]

def hcp_invoice_due_amount(invoice):
    if not isinstance(invoice,dict):
        return 0.0
    for key in ("due_amount","amount_due","dueAmount","balance_due","balanceDue","balance"):
        if invoice.get(key) is not None:
            return hcp_money_to_dollars(invoice.get(key))
    return 0.0

def hcp_invoice_due_date(invoice):
    if not isinstance(invoice,dict):
        return None
    for key in ("due_at","due_date","dueAt"):
        value=invoice.get(key)
        if value:
            return hcp_local_date(value)
    return None

def hcp_invoice_customer_name(invoice):
    if not isinstance(invoice,dict):
        return "Unknown customer"
    name=hcp_customer_name_from_obj(invoice.get("customer"))
    if name:
        return name
    for key in ("customer_name","display_name"):
        value=str(invoice.get(key) or "").strip()
        if value:
            return value
    number=str(invoice.get("invoice_number") or invoice.get("invoiceNumber") or invoice.get("number") or invoice.get("id") or "").strip()
    return ("Invoice " + number) if number else "Unknown customer"

def hcp_operations_brief():
    today=datetime.now(BUSINESS_TZ).date()
    next7_end=today+timedelta(days=6)
    start_iso=today.isoformat()+"T00:00:00"
    end_iso=next7_end.isoformat()+"T23:59:59"

    jobs_data=hcp_get("jobs", {
        "page":1,
        "page_size":100,
        "scheduled_start_min":start_iso,
        "scheduled_start_max":end_iso
    })
    jobs=jobs_data.get("jobs") or jobs_data.get("data") or []
    scheduled=[]
    for job in jobs:
        if not isinstance(job,dict) or job.get("deleted_at"):
            continue
        status=str(job.get("work_status") or "").strip().lower()
        if "cancel" in status:
            continue
        schedule=job.get("schedule") or {}
        scheduled_start=schedule.get("scheduled_start") or job.get("scheduled_start")
        scheduled_date=hcp_local_date(scheduled_start)
        if not scheduled_date or scheduled_date < today or scheduled_date > next7_end:
            continue
        scheduled.append({
            "id":job.get("id"),
            "customer_name":hcp_job_customer_name(job),
            "scheduled_start":scheduled_start,
            "scheduled_date":scheduled_date.isoformat(),
            "status":status or "scheduled",
            "value":round(hcp_money_to_dollars(job.get("total_amount")),2)
        })

    scheduled.sort(key=lambda j:str(j.get("scheduled_start") or ""))
    today_jobs=[j for j in scheduled if j["scheduled_date"]==today.isoformat()]

    invoices=[]
    page=1
    while page <= 4:
        data=hcp_get("invoices", {"page":page,"page_size":100})
        batch=data.get("invoices") or data.get("data") or []
        if not batch:
            break
        invoices.extend([x for x in batch if isinstance(x,dict)])
        total_pages=int(data.get("total_pages") or 1)
        if page >= total_pages:
            break
        page += 1

    outstanding=[]
    for invoice in invoices:
        due=hcp_invoice_due_amount(invoice)
        if due <= 0:
            continue
        due_date=hcp_invoice_due_date(invoice)
        outstanding.append({
            "id":invoice.get("id") or invoice.get("uuid"),
            "invoice_number":invoice.get("invoice_number") or invoice.get("invoiceNumber") or invoice.get("number"),
            "customer_name":hcp_invoice_customer_name(invoice),
            "due_date":due_date.isoformat() if due_date else None,
            "due_amount":round(due,2),
            "status":str(invoice.get("status") or "").strip().lower()
        })

    overdue=[x for x in outstanding if x.get("due_date") and datetime.strptime(x["due_date"],"%Y-%m-%d").date() < today]
    due_next7=[x for x in outstanding if x.get("due_date") and today <= datetime.strptime(x["due_date"],"%Y-%m-%d").date() <= next7_end]
    overdue.sort(key=lambda x:(x.get("due_amount") or 0),reverse=True)

    return {
        "ok":True,
        "as_of":today.isoformat(),
        "timezone":BUSINESS_TIMEZONE,
        "today_jobs":{
            "count":len(today_jobs),
            "revenue":round(sum(float(j.get("value") or 0) for j in today_jobs),2),
            "items":today_jobs[:8]
        },
        "next7":{
            "count":len(scheduled),
            "revenue":round(sum(float(j.get("value") or 0) for j in scheduled),2)
        },
        "ar":{
            "outstanding_count":len(outstanding),
            "outstanding_amount":round(sum(float(x.get("due_amount") or 0) for x in outstanding),2),
            "overdue_count":len(overdue),
            "overdue_amount":round(sum(float(x.get("due_amount") or 0) for x in overdue),2),
            "due_next7_count":len(due_next7),
            "due_next7_amount":round(sum(float(x.get("due_amount") or 0) for x in due_next7),2),
            "largest_overdue":overdue[:6]
        }
    }

def needs_attention_snapshot():
    ops=cached_runtime("hcp_operations_brief", 60, hcp_operations_brief)
    pipe=cached_runtime("hcp_estimate_pipeline", 90, hcp_estimate_pipeline_snapshot)

    alerts=[]
    ar=ops.get("ar") or {}
    next7=ops.get("next7") or {}
    open_pipe=pipe.get("open_pipeline") or {}
    aging=open_pipe.get("aging") or {}
    recent=pipe.get("recent") or {}

    overdue_amount=float(ar.get("overdue_amount") or 0)
    overdue_count=int(ar.get("overdue_count") or 0)
    if overdue_count > 0:
        alerts.append({
            "severity":"critical",
            "icon":"💸",
            "title":f"{overdue_count} overdue invoice" + ("" if overdue_count==1 else "s"),
            "detail":f"${overdue_amount:,.2f} is past due and should be collected.",
            "metric":round(overdue_amount,2),
            "key":"overdue_ar"
        })
    else:
        alerts.append({
            "severity":"good","icon":"✅","title":"No overdue invoices",
            "detail":"Accounts receivable is current.","metric":0,"key":"overdue_ar"
        })

    stale_count=sum(int((aging.get(k) or {}).get("count") or 0) for k in ("8_14","15_30","31_plus"))
    stale_value=sum(float((aging.get(k) or {}).get("value") or 0) for k in ("8_14","15_30","31_plus"))
    if stale_count > 0:
        alerts.append({
            "severity":"critical",
            "icon":"📋",
            "title":f"{stale_count} estimates open 8+ days",
            "detail":f"${stale_value:,.2f} of old pipeline needs follow-up.",
            "metric":round(stale_value,2),
            "key":"stale_estimates"
        })

    warm_count=int((aging.get("4_7") or {}).get("count") or 0)
    warm_value=float((aging.get("4_7") or {}).get("value") or 0)
    if warm_count > 0:
        alerts.append({
            "severity":"warning",
            "icon":"⏰",
            "title":f"{warm_count} estimates are 4–7 days old",
            "detail":f"${warm_value:,.2f} should be touched before it gets stale.",
            "metric":round(warm_value,2),
            "key":"warm_estimates"
        })

    booked=float(next7.get("revenue") or 0)
    goal=max(0.0,float(WEEKLY_REVENUE_GOAL or 0))
    if goal > 0:
        pct=(booked/goal)*100.0
        gap=max(0.0,goal-booked)
        if pct < 60:
            severity="critical"
            icon="📉"
            title="Next 7 days are underbooked"
            detail=f"${booked:,.2f} booked vs ${goal:,.0f} goal — ${gap:,.2f} gap."
        elif pct < 85:
            severity="warning"
            icon="📅"
            title="Booking pace needs attention"
            detail=f"${booked:,.2f} booked vs ${goal:,.0f} goal — ${gap:,.2f} gap."
        else:
            severity="good"
            icon="✅"
            title="Next 7 days are on pace"
            detail=f"${booked:,.2f} booked against the ${goal:,.0f} weekly goal."
        alerts.append({
            "severity":severity,"icon":icon,"title":title,"detail":detail,
            "metric":round(booked,2),"percent":round(pct,1),"key":"booking_pace"
        })

    close_rate=float(recent.get("close_rate") or 0)
    decided=int(recent.get("won_count") or 0)+int(recent.get("lost_count") or 0)
    if decided >= 5:
        if close_rate < 50:
            alerts.append({
                "severity":"warning","icon":"🎯","title":"Estimate close rate is below 50%",
                "detail":f"30-day close rate is {close_rate:.1f}% across {decided} decided estimates.",
                "metric":round(close_rate,1),"key":"close_rate"
            })
        elif close_rate >= 65:
            alerts.append({
                "severity":"good","icon":"✅","title":"Estimate close rate is strong",
                "detail":f"30-day close rate is {close_rate:.1f}% across {decided} decided estimates.",
                "metric":round(close_rate,1),"key":"close_rate"
            })

    order={"critical":0,"warning":1,"good":2,"info":3}
    alerts.sort(key=lambda a:order.get(a.get("severity"),9))
    critical=sum(1 for a in alerts if a.get("severity")=="critical")
    warning=sum(1 for a in alerts if a.get("severity")=="warning")

    return {
        "ok":True,
        "as_of":datetime.now(BUSINESS_TZ).isoformat(),
        "weekly_revenue_goal":round(goal,2),
        "summary":{
            "critical":critical,
            "warning":warning,
            "attention_count":critical+warning,
            "good":sum(1 for a in alerts if a.get("severity")=="good")
        },
        "alerts":alerts
    }

def hcp_estimate_status_text(estimate):
    values=[]
    for key in ("approval_status","status","estimate_status","approval_state"):
        value=estimate.get(key) if isinstance(estimate,dict) else None
        if value:
            values.append(str(value))
    return " | ".join(values)

def hcp_is_declined_status(value):
    status=hcp_normalize_status(value)
    return any(word in status for word in ("declin","reject","cancel","expired","lost"))

def hcp_estimate_pipeline_value(estimate):
    if not isinstance(estimate,dict):
        return 0.0

    top=hcp_money_to_dollars(estimate.get("total_amount"))
    if top > 0:
        return top

    options=estimate.get("options") or []
    values=[]
    for option in options:
        if not isinstance(option,dict):
            continue
        amount=hcp_money_to_dollars(option.get("total_amount"))
        if amount > 0:
            values.append(amount)

    # Estimate options are usually alternatives, so summing every option can
    # materially overstate pipeline value. Use the largest option as the best
    # available fallback when HCP omits a top-level estimate total.
    return max(values) if values else 0.0

def hcp_estimate_customer_name(estimate):
    if not isinstance(estimate,dict):
        return "Unknown customer"

    customer=estimate.get("customer")
    if isinstance(customer,dict):
        for key in ("display_name","name","company_name","company"):
            value=str(customer.get(key) or "").strip()
            if value:
                return value
        first=str(customer.get("first_name") or "").strip()
        last=str(customer.get("last_name") or "").strip()
        full=(first+" "+last).strip()
        if full:
            return full

    value=str(estimate.get("customer_name") or "").strip()
    if value:
        return value

    # Do not use estimate["name"] here; on HCP list responses that can be the
    # company/estimate label rather than the customer's name.
    estimate_id=str(estimate.get("id") or "").strip()
    return ("Estimate "+estimate_id[-8:]) if estimate_id else "Unknown customer"

def hcp_estimate_pipeline_class(estimate):
    sold_value=hcp_estimate_sold_value(estimate)
    if sold_value is not None:
        return "won", sold_value

    if not isinstance(estimate,dict):
        return "open", 0.0

    top_status=hcp_estimate_status_text(estimate)
    if hcp_is_declined_status(top_status):
        return "lost", hcp_estimate_pipeline_value(estimate)

    options=estimate.get("options") or []
    option_statuses=[]
    for option in options:
        if not isinstance(option,dict):
            continue
        status=(
            option.get("approval_status")
            or option.get("status")
            or option.get("approval_state")
        )
        if status:
            option_statuses.append(status)

    if option_statuses and all(hcp_is_declined_status(s) for s in option_statuses):
        return "lost", hcp_estimate_pipeline_value(estimate)

    return "open", hcp_estimate_pipeline_value(estimate)

def hcp_estimate_pipeline_snapshot(lookback_days=120, recent_days=30, max_pages=5):
    today=datetime.now(timezone.utc).date()
    lookback_start=today-timedelta(days=max(1,int(lookback_days)))
    recent_start=today-timedelta(days=max(1,int(recent_days))-1)

    summaries=[]
    page=1
    pages_scanned=0
    while page <= max_pages:
        data=hcp_get("estimates", {"page":page,"page_size":100})
        batch=data.get("estimates") or data.get("data") or []
        pages_scanned += 1
        if not batch:
            break

        for summary in batch:
            created_dt=hcp_parse_datetime(summary.get("created_at"))
            if created_dt and created_dt.date() >= lookback_start:
                summaries.append(summary)

        total_pages=int(data.get("total_pages") or 1)
        if page >= total_pages:
            break
        page += 1

    summaries.sort(key=lambda x: str(x.get("created_at") or ""), reverse=True)

    rows=[]
    for estimate in summaries:
        created_dt=hcp_parse_datetime(estimate.get("created_at"))
        if not created_dt:
            continue
        created_date=created_dt.date()
        age=max(0,(today-created_date).days)
        bucket,value=hcp_estimate_pipeline_class(estimate)
        rows.append({
            "id": estimate.get("id"),
            "customer_name": hcp_estimate_customer_name(estimate),
            "created_at": created_date.isoformat(),
            "age_days": age,
            "status": bucket,
            "status_text": hcp_estimate_status_text(estimate),
            "value": round(float(value or 0),2)
        })

    recent=[r for r in rows if datetime.strptime(r["created_at"],"%Y-%m-%d").date() >= recent_start]
    recent_won=[r for r in recent if r["status"]=="won"]
    recent_lost=[r for r in recent if r["status"]=="lost"]
    recent_open=[r for r in recent if r["status"]=="open"]
    open_rows=[r for r in rows if r["status"]=="open"]

    def group_age(min_age,max_age=None):
        matched=[r for r in open_rows if r["age_days"] >= min_age and (max_age is None or r["age_days"] <= max_age)]
        return {
            "count":len(matched),
            "value":round(sum(float(r.get("value") or 0) for r in matched),2)
        }

    decided=len(recent_won)+len(recent_lost)
    close_rate=(len(recent_won)/decided*100.0) if decided else 0.0
    followups=[r for r in open_rows if r["age_days"] >= 4]
    followups.sort(key=lambda r:(r["age_days"],r["value"]),reverse=True)

    incomplete=sum(1 for r in rows if not r.get("status_text") or float(r.get("value") or 0) <= 0)

    return {
        "ok":True,
        "as_of":today.isoformat(),
        "lookback_days":lookback_days,
        "recent_days":recent_days,
        "pages_scanned":pages_scanned,
        "truncated":page >= max_pages and int(data.get("total_pages") or 1) > max_pages,
        "summary_rows":len(rows),
        "incomplete_rows":incomplete,
        "recent":{
            "estimates_created":len(recent),
            "quoted_value":round(sum(float(r.get("value") or 0) for r in recent),2),
            "won_count":len(recent_won),
            "won_value":round(sum(float(r.get("value") or 0) for r in recent_won),2),
            "lost_count":len(recent_lost),
            "lost_value":round(sum(float(r.get("value") or 0) for r in recent_lost),2),
            "open_count":len(recent_open),
            "open_value":round(sum(float(r.get("value") or 0) for r in recent_open),2),
            "close_rate":round(close_rate,1)
        },
        "open_pipeline":{
            "count":len(open_rows),
            "value":round(sum(float(r.get("value") or 0) for r in open_rows),2),
            "aging":{
                "0_3":group_age(0,3),
                "4_7":group_age(4,7),
                "8_14":group_age(8,14),
                "15_30":group_age(15,30),
                "31_plus":group_age(31,None)
            }
        },
        "followups":followups[:12]
    }

def hcp_money_to_dollars(value):
    try:
        return float(value or 0) / 100.0
    except (TypeError, ValueError):
        return 0.0

def hcp_normalize_status(value):
    return str(value or "").strip().lower().replace(" ", "_").replace("-", "_")

def hcp_is_approved(value):
    status=hcp_normalize_status(value)
    return status in {"approved","pro_approved","customer_approved"} or (
        "approved" in status and "declin" not in status
    )

def hcp_estimate_sold_value(estimate):
    options=estimate.get("options") or []

    # Newer HCP estimate flows track approval per option. Prefer approved
    # option values when that information is present.
    approved_options=[]
    for option in options:
        option_status=(
            option.get("approval_status")
            or option.get("status")
            or option.get("approval_state")
        )
        if hcp_is_approved(option_status):
            approved_options.append(option)

    if approved_options:
        return sum(hcp_money_to_dollars(o.get("total_amount")) for o in approved_options)

    # Older/simpler estimates expose approval at the estimate level.
    estimate_status=(
        estimate.get("approval_status")
        or estimate.get("status")
        or estimate.get("estimate_status")
    )
    if hcp_is_approved(estimate_status):
        if len(options) == 1:
            return hcp_money_to_dollars(options[0].get("total_amount"))
        return hcp_money_to_dollars(estimate.get("total_amount"))

    return None

def hcp_list_won_estimates(start, end):
    matched=[]
    page=1

    while True:
        data=hcp_get("estimates", {
            "page":page,
            "page_size":100
        })
        batch=data.get("estimates") or data.get("data") or []
        if not batch:
            break

        for summary in batch:
            created_dt=hcp_parse_datetime(summary.get("created_at"))
            if not created_dt:
                continue
            created_date=created_dt.date()
            if created_date < start or created_date > end:
                continue

            estimate=summary
            estimate_id=summary.get("id")
            if estimate_id:
                # The list endpoint can omit approval details on some HCP
                # accounts. Fetch the single estimate before deciding.
                try:
                    detail=hcp_get("estimates/" + str(estimate_id))
                    if isinstance(detail, dict):
                        estimate=detail.get("estimate") or detail
                except Exception:
                    estimate=summary

            sold_value=hcp_estimate_sold_value(estimate)
            if sold_value is None:
                continue

            matched.append({
                "id": estimate.get("id") or estimate_id,
                "sold_value": sold_value
            })

        total_pages=int(data.get("total_pages") or 1)
        if page >= total_pages:
            break
        page += 1

    return matched

def hcp_money_to_dollars(value):
    try:
        return float(value or 0) / 100.0
    except (TypeError, ValueError):
        return 0.0

def hcp_customer_id_from_job(job):
    customer=job.get("customer") or {}
    if isinstance(customer, dict) and customer.get("id"):
        return customer.get("id")
    return job.get("customer_id")

def hcp_customer_class(customer_id):
    if not customer_id:
        return "unknown"
    data=hcp_get("customers/" + str(customer_id))
    customer=data.get("customer") if isinstance(data, dict) and isinstance(data.get("customer"), dict) else data
    if not isinstance(customer, dict):
        return "unknown"

    raw=(
        customer.get("customer_type")
        or customer.get("type")
        or customer.get("customer_kind")
    )
    kind=str(raw or "").strip().lower().replace("-", "_").replace(" ", "_")
    if kind in {"business","commercial","company"}:
        return "commercial"
    if kind in {"homeowner","residential","home_owner","consumer"}:
        return "residential"

    if customer.get("is_business") is True:
        return "commercial"
    if customer.get("is_business") is False:
        return "residential"

    return "unknown"

def hcp_classify_text(value):
    text=str(value or "").strip().lower()
    if not text:
        return None
    if "commercial" in text or text in {"business","company"}:
        return "commercial"
    if "residential" in text or text in {"homeowner","home_owner","consumer"}:
        return "residential"
    return None

def hcp_job_type_class(job):
    # Housecall Pro can expose Job Type differently across API versions.
    # Check common direct fields first.
    for key in ("job_type","job_type_name","type_name"):
        value=job.get(key)
        if isinstance(value, dict):
            value=value.get("name") or value.get("value") or value.get("label")
        bucket=hcp_classify_text(value)
        if bucket:
            return bucket

    # Then inspect structured job fields when present.
    fields=job.get("job_fields") or job.get("fields") or []
    if isinstance(fields, dict):
        iterable=fields.items()
        for key, value in iterable:
            key_text=str(key or "").lower()
            if "job type" in key_text or "job_type" in key_text or "property type" in key_text:
                if isinstance(value, dict):
                    value=value.get("name") or value.get("value") or value.get("label")
                bucket=hcp_classify_text(value)
                if bucket:
                    return bucket
    elif isinstance(fields, list):
        for field in fields:
            if not isinstance(field, dict):
                continue
            name=str(field.get("name") or field.get("label") or field.get("field_name") or "").lower()
            if "job type" not in name and "job_type" not in name and "property type" not in name:
                continue
            value=field.get("value") or field.get("selected_value") or field.get("name_value")
            if isinstance(value, dict):
                value=value.get("name") or value.get("value") or value.get("label")
            bucket=hcp_classify_text(value)
            if bucket:
                return bucket

    return None

def hcp_split_completed_revenue(jobs):
    totals={"residential":0.0,"commercial":0.0,"unknown":0.0}
    cache={}
    for job in jobs:
        # Preferred source: Job Type selected on the HCP job itself.
        bucket=hcp_job_type_class(job)

        # Fallback: customer Homeowner/Business type if it exists.
        if not bucket:
            customer_id=hcp_customer_id_from_job(job)
            if customer_id not in cache:
                try:
                    cache[customer_id]=hcp_customer_class(customer_id)
                except Exception:
                    cache[customer_id]="unknown"
            bucket=cache.get(customer_id) or "unknown"

        if bucket not in totals:
            bucket="unknown"
        totals[bucket] += hcp_money_to_dollars(job.get("total_amount"))
    return totals

def hcp_job_has_tag(job, target):
    target_norm=str(target or "").strip().lower()
    tags=job.get("tags") or job.get("job_tags") or []

    if isinstance(tags, str):
        tags=[x.strip() for x in tags.split(",") if x.strip()]

    if isinstance(tags, dict):
        tags=list(tags.values())

    if not isinstance(tags, list):
        return False

    for tag in tags:
        if isinstance(tag, dict):
            value=tag.get("name") or tag.get("label") or tag.get("value") or tag.get("tag")
        else:
            value=tag
        if str(value or "").strip().lower() == target_norm:
            return True
    return False

def hcp_callback_count(completed_jobs):
    return sum(1 for job in completed_jobs if hcp_job_has_tag(job, "Callback"))

def hcp_repeat_customer_count(completed_jobs, week_start):
    # A repeat customer is someone with at least one completed job before
    # the selected week who also has a completed job during this week.
    prior_customers=set()
    page=1

    while True:
        data=hcp_get("jobs", {
            "page":page,
            "page_size":100,
            "work_status[]":["completed"]
        })
        batch=data.get("jobs") or data.get("data") or []
        if not batch:
            break

        for job in batch:
            status=str(job.get("work_status") or "").lower()
            if not status.startswith("complete") or job.get("deleted_at"):
                continue

            completed_at=((job.get("work_timestamps") or {}).get("completed_at"))
            completed_dt=hcp_parse_datetime(completed_at)
            if not completed_dt or completed_dt.date() >= week_start:
                continue

            customer_id=hcp_customer_id_from_job(job)
            if customer_id:
                prior_customers.add(str(customer_id))

        total_pages=int(data.get("total_pages") or 1)
        if page >= total_pages:
            break
        page += 1

    repeat_customers=set()
    for job in completed_jobs:
        customer_id=hcp_customer_id_from_job(job)
        if customer_id and str(customer_id) in prior_customers:
            repeat_customers.add(str(customer_id))

    return len(repeat_customers)

def hcp_assigned_employee_ids(job):
    ids=job.get("assigned_employee_ids") or []
    if isinstance(ids, list) and ids:
        return [str(x) for x in ids if x]

    employees=job.get("assigned_employees") or []
    out=[]
    if isinstance(employees, list):
        for employee in employees:
            if isinstance(employee, dict) and employee.get("id"):
                out.append(str(employee.get("id")))
            elif employee:
                out.append(str(employee))
    return out

def hcp_employee_directory():
    key="hcp_employee_directory"
    def loader():
        data=hcp_get("employees", {"page":1,"page_size":100})
        employees=data.get("employees") or data.get("data") or []
        out={}
        for emp in employees:
            if not isinstance(emp,dict) or not emp.get("id"):
                continue
            first=str(emp.get("first_name") or emp.get("firstName") or "").strip()
            last=str(emp.get("last_name") or emp.get("lastName") or "").strip()
            name=(first+" "+last).strip()
            if not name:
                name=str(emp.get("name") or emp.get("display_name") or emp.get("displayName") or ("Employee "+str(emp.get("id"))[-6:])).strip()
            out[str(emp.get("id"))]={
                "id":str(emp.get("id")),
                "name":name,
                "role":str(emp.get("role") or emp.get("employee_type") or emp.get("employeeType") or "").strip()
            }
        return out
    try:
        return cached_runtime(key,600,loader) or {}
    except Exception:
        return {}

def hcp_job_duration_hours(job):
    if not isinstance(job,dict):
        return None,"untracked"
    timestamps=job.get("work_timestamps") or {}
    started=hcp_parse_datetime(timestamps.get("started_at"))
    completed=hcp_parse_datetime(timestamps.get("completed_at"))
    if started and completed and completed > started:
        candidate=(completed-started).total_seconds()/3600.0
        if 0 < candidate <= 24:
            return candidate,"actual"
    schedule=job.get("schedule") or {}
    scheduled_start=hcp_parse_datetime(schedule.get("scheduled_start"))
    scheduled_end=hcp_parse_datetime(schedule.get("scheduled_end"))
    if scheduled_start and scheduled_end and scheduled_end > scheduled_start:
        candidate=(scheduled_end-scheduled_start).total_seconds()/3600.0
        if 0 < candidate <= 24:
            return candidate,"scheduled"
    return None,"untracked"

def hcp_technician_scorecards(start,end):
    jobs=hcp_list_completed_jobs(start,end)
    employees=hcp_employee_directory()
    stats={}

    def tech_row(tech_id):
        tech_id=str(tech_id)
        if tech_id not in stats:
            info=employees.get(tech_id) or {}
            stats[tech_id]={
                "employee_id":tech_id,
                "name":info.get("name") or ("Employee "+tech_id[-6:]),
                "role":info.get("role") or "",
                "jobs_completed":0,
                "solo_jobs":0,
                "team_jobs":0,
                "callbacks":0,
                "hours":0.0,
                "actual_time_jobs":0,
                "scheduled_fallback_jobs":0,
                "untracked_time_jobs":0,
                "revenue_serviced":0.0,
                "allocated_revenue":0.0,
                "estimated_commission":0.0,
                "commission_unmodeled_jobs":0
            }
        return stats[tech_id]

    jobs_without_assignments=0
    for job in jobs:
        tech_ids=hcp_assigned_employee_ids(job)
        if not tech_ids:
            jobs_without_assignments += 1
            continue
        team_size=len(tech_ids)
        job_value=hcp_money_to_dollars(job.get("total_amount"))
        duration,source=hcp_job_duration_hours(job)
        is_callback=hcp_job_has_tag(job,"Callback")
        allocated=(job_value/team_size) if team_size else 0.0
        commission_rate=0.225 if team_size == 1 else (0.15 if team_size == 2 else None)

        for tech_id in tech_ids:
            row=tech_row(tech_id)
            row["jobs_completed"] += 1
            if team_size == 1:
                row["solo_jobs"] += 1
            else:
                row["team_jobs"] += 1
            if is_callback:
                row["callbacks"] += 1
            row["revenue_serviced"] += job_value
            row["allocated_revenue"] += allocated
            if commission_rate is None:
                row["commission_unmodeled_jobs"] += 1
            else:
                row["estimated_commission"] += job_value * commission_rate
            if duration is None:
                row["untracked_time_jobs"] += 1
            else:
                row["hours"] += duration
                if source == "actual":
                    row["actual_time_jobs"] += 1
                else:
                    row["scheduled_fallback_jobs"] += 1

    rows=[]
    for row in stats.values():
        jobs_count=int(row["jobs_completed"])
        hours=float(row["hours"])
        serviced=float(row["revenue_serviced"])
        allocated=float(row["allocated_revenue"])
        rows.append({
            **row,
            "hours":round(hours,2),
            "revenue_serviced":round(serviced,2),
            "allocated_revenue":round(allocated,2),
            "avg_ticket":round((serviced/jobs_count),2) if jobs_count else 0.0,
            "revenue_per_hour":round((serviced/hours),2) if hours else 0.0,
            "allocated_revenue_per_hour":round((allocated/hours),2) if hours else 0.0,
            "estimated_commission":round(float(row["estimated_commission"]),2),
            "commission_pct_of_serviced_revenue":round((float(row["estimated_commission"])/serviced*100.0),1) if serviced else 0.0
        })

    rows.sort(key=lambda r:(r.get("revenue_serviced",0),r.get("jobs_completed",0)),reverse=True)
    return {
        "ok":True,
        "week_start":start.isoformat(),
        "week_ending":end.isoformat(),
        "technicians":rows,
        "jobs_completed":len(jobs),
        "jobs_without_assignments":jobs_without_assignments,
        "commission_note":"Estimated field commission only: 22.5% on solo jobs and 15% per technician on two-tech jobs. Jobs with 3+ assigned technicians are not commission-modeled. Upsell commission is not included because HCP does not reliably identify which technician created the upsell."
    }

def hcp_job_tech_metrics(completed_jobs):
    unique_techs=set()
    total_tech_hours=0.0
    actual_time_jobs=0
    scheduled_fallback_jobs=0
    untracked_jobs=0

    for job in completed_jobs:
        tech_ids=hcp_assigned_employee_ids(job)
        for tech_id in tech_ids:
            unique_techs.add(tech_id)

        if not tech_ids:
            untracked_jobs += 1
            continue

        timestamps=job.get("work_timestamps") or {}
        started=hcp_parse_datetime(timestamps.get("started_at"))
        completed=hcp_parse_datetime(timestamps.get("completed_at"))

        duration_hours=None
        source=None

        if started and completed and completed > started:
            candidate=(completed-started).total_seconds()/3600.0
            if 0 < candidate <= 24:
                duration_hours=candidate
                source="actual"

        # If the crew did not use HCP Start/Finish, fall back to the job's
        # scheduled window so tech productivity still auto-populates.
        if duration_hours is None:
            schedule=job.get("schedule") or {}
            scheduled_start=hcp_parse_datetime(schedule.get("scheduled_start"))
            scheduled_end=hcp_parse_datetime(schedule.get("scheduled_end"))
            if scheduled_start and scheduled_end and scheduled_end > scheduled_start:
                candidate=(scheduled_end-scheduled_start).total_seconds()/3600.0
                if 0 < candidate <= 24:
                    duration_hours=candidate
                    source="scheduled"

        if duration_hours is None:
            untracked_jobs += 1
            continue

        total_tech_hours += duration_hours * len(tech_ids)
        if source == "actual":
            actual_time_jobs += 1
        else:
            scheduled_fallback_jobs += 1

    tech_count=len(unique_techs)
    avg_hours_per_tech=(total_tech_hours / tech_count) if tech_count else 0.0

    return {
        "tech_count":tech_count,
        "total_tech_hours":round(total_tech_hours,2),
        "hours_per_tech":round(avg_hours_per_tech,2),
        "actual_time_jobs":actual_time_jobs,
        "scheduled_fallback_jobs":scheduled_fallback_jobs,
        "untracked_jobs":untracked_jobs
    }

def hcp_fetch_public(url):
    req=urllib.request.Request(
        url,
        headers={
            "User-Agent":"Mozilla/5.0 CurbAppealKPIDashboard/1.0",
            "Accept":"text/html,application/xhtml+xml,application/json"
        }
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read().decode("utf-8", errors="replace")

def hcp_review_date(value):
    if not value:
        return None
    text=str(value).strip()
    dt=hcp_parse_datetime(text)
    if dt:
        return dt.date()
    for fmt in ("%b %d, %Y","%B %d, %Y","%m/%d/%Y","%Y-%m-%d"):
        try:
            return datetime.strptime(text,fmt).date()
        except Exception:
            pass
    return None

def hcp_review_rating(obj):
    if not isinstance(obj, dict):
        return None
    for key in ("rating","stars","star_rating","review_rating","score","rating_value","ratingValue"):
        value=obj.get(key)
        if isinstance(value, dict):
            value=value.get("ratingValue") or value.get("value") or value.get("rating")
        try:
            n=float(value)
            if 0 <= n <= 5:
                return n
        except Exception:
            pass
    nested=obj.get("reviewRating")
    if isinstance(nested, dict):
        try:
            n=float(nested.get("ratingValue"))
            if 0 <= n <= 5:
                return n
        except Exception:
            pass
    return None

def hcp_review_date_from_obj(obj):
    if not isinstance(obj, dict):
        return None
    for key in (
        "created_at","createdAt","date","review_date","reviewDate",
        "published_at","publishedAt","datePublished","submitted_at","submittedAt"
    ):
        if key in obj:
            d=hcp_review_date(obj.get(key))
            if d:
                return d
    return None

def hcp_collect_review_objects(value, out):
    if isinstance(value, dict):
        rating=hcp_review_rating(value)
        review_date=hcp_review_date_from_obj(value)
        if rating is not None and review_date is not None:
            ident=value.get("id") or value.get("review_id") or value.get("reviewId")
            out.append((str(ident or ""), rating, review_date))
        for child in value.values():
            hcp_collect_review_objects(child,out)
    elif isinstance(value, list):
        for child in value:
            hcp_collect_review_objects(child,out)

def hcp_reviews_for_week(start, end):
    import re
    html=hcp_fetch_public(HCP_REVIEWS_WIDGET_URL)

    candidates=[]
    json_blobs=[]

    # Parse JSON-bearing script tags used by modern React/Next.js widgets.
    for match in re.finditer(r'<script[^>]*>(.*?)</script>', html, re.I|re.S):
        body=(match.group(1) or "").strip()
        if not body:
            continue
        if body.startswith("{") or body.startswith("["):
            try:
                json_blobs.append(json.loads(body))
            except Exception:
                pass

    # Also parse common __NEXT_DATA__ assignments.
    for match in re.finditer(r'__NEXT_DATA__[^>]*>(.*?)</script>', html, re.I|re.S):
        body=(match.group(1) or "").strip()
        if body:
            try:
                json_blobs.append(json.loads(body))
            except Exception:
                pass

    for blob in json_blobs:
        hcp_collect_review_objects(blob,candidates)

    # Fallback for JSON-LD style rating/date pairs directly in HTML.
    if not candidates:
        date_rating_patterns=[
            r'"datePublished"\s*:\s*"([^"]+)".{0,1000}?"ratingValue"\s*:\s*"?([0-5](?:\.\d+)?)"?',
            r'"ratingValue"\s*:\s*"?([0-5](?:\.\d+)?)"?.{0,1000}?"datePublished"\s*:\s*"([^"]+)"'
        ]
        for idx, pattern in enumerate(date_rating_patterns):
            for m in re.finditer(pattern, html, re.I|re.S):
                if idx == 0:
                    d=hcp_review_date(m.group(1)); rating=float(m.group(2))
                else:
                    rating=float(m.group(1)); d=hcp_review_date(m.group(2))
                if d:
                    candidates.append(("",rating,d))

    dedup=set()
    normalized=[]
    for ident,rating,d in candidates:
        key=(ident or "",round(float(rating),2),d.isoformat())
        if key in dedup:
            continue
        dedup.add(key)
        normalized.append((rating,d))

    five_star=sum(1 for rating,d in normalized if rating >= 4.999 and start <= d <= end)

    return {
        "available": bool(normalized),
        "five_star_reviews": five_star,
        "review_records_found": len(normalized),
        "json_payloads_found": len(json_blobs),
        "widget_html_bytes": len(html.encode("utf-8"))
    }

def review_store_load():
    try:
        with open(REVIEW_DATA_PATH, "r", encoding="utf-8") as f:
            data=json.load(f)
        return data if isinstance(data, list) else []
    except FileNotFoundError:
        return []
    except Exception:
        return []

def review_store_save(rows):
    directory=os.path.dirname(REVIEW_DATA_PATH) or "."
    os.makedirs(directory, exist_ok=True)
    tmp=REVIEW_DATA_PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(rows, f, separators=(",",":"))
    os.replace(tmp, REVIEW_DATA_PATH)

def review_rating_number(value):
    text=str(value or "").strip().upper()
    names={"ONE":1,"TWO":2,"THREE":3,"FOUR":4,"FIVE":5}
    if text in names:
        return names[text]
    try:
        n=float(value)
        if 0 <= n <= 5:
            return n
    except Exception:
        pass
    return None

def review_count_for_week(start, end):
    rows=review_store_load()
    seen=set()
    count=0
    for row in rows:
        if not isinstance(row, dict):
            continue
        review_id=str(row.get("review_id") or "").strip()
        if review_id and review_id in seen:
            continue
        if review_id:
            seen.add(review_id)
        rating=review_rating_number(row.get("rating"))
        created=hcp_parse_datetime(row.get("create_time"))
        if rating is None or not created:
            continue
        if rating >= 4.999 and start <= created.date() <= end:
            count += 1
    return count, len(rows)

def qb_expense_store_load():
    try:
        with open(QB_EXPENSE_DATA_PATH, "r", encoding="utf-8") as f:
            data=json.load(f)
        return data if isinstance(data, list) else []
    except FileNotFoundError:
        return []
    except Exception:
        return []

def qb_expense_store_save(rows):
    directory=os.path.dirname(QB_EXPENSE_DATA_PATH) or "."
    os.makedirs(directory, exist_ok=True)
    tmp=QB_EXPENSE_DATA_PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(rows, f, separators=(",",":"))
    os.replace(tmp, QB_EXPENSE_DATA_PATH)

def qb_parse_date(value):
    if not value:
        return None
    text=str(value).strip()
    dt=hcp_parse_datetime(text)
    if dt:
        return dt.date()
    for fmt in ("%Y-%m-%d","%m/%d/%Y","%m/%d/%y"):
        try:
            return datetime.strptime(text,fmt).date()
        except Exception:
            pass
    return None

def hcp_source_text(value):
    if value is None:
        return ""
    if isinstance(value,str):
        return value.strip()
    if isinstance(value,(int,float,bool)):
        return str(value)
    if isinstance(value,dict):
        for key in ("name","label","value","source","lead_source","title"):
            if value.get(key):
                return hcp_source_text(value.get(key))
        return " ".join(hcp_source_text(v) for v in value.values() if v)
    if isinstance(value,list):
        return " ".join(hcp_source_text(v) for v in value if v)
    return str(value).strip()

def hcp_source_from_object(obj):
    if not isinstance(obj,dict):
        return ""
    direct_keys=(
        "lead_source","leadSource","source","source_name","sourceName",
        "marketing_source","marketingSource","referral_source","referralSource",
        "acquisition_source","acquisitionSource","origin","channel"
    )
    for key in direct_keys:
        value=obj.get(key)
        text=hcp_source_text(value)
        if text:
            return text
    for key in ("tags","tag_list","tagList"):
        text=hcp_source_text(obj.get(key))
        if text:
            return text
    return ""

def hcp_source_bucket(value):
    text=" ".join(str(value or "").lower().replace("_"," ").replace("-"," ").split())
    if not text:
        return "unknown"
    if any(x in text for x in ("local service ad","local services ad","google lsa","google local service"," lsa ")):
        return "lsa"
    if any(x in text for x in ("facebook","instagram","meta ads","meta lead","fb ads","fb lead")):
        return "meta"
    if any(x in text for x in ("google ads","google adwords","adwords","google ppc","paid google","google paid")):
        return "google"
    if any(x in text for x in ("yard sign","yard signs")):
        return "yardsign"
    if any(x in text for x in ("door hanger","door hangers")):
        return "doorhanger"
    if any(x in text for x in ("referral","referred","word of mouth","word-of-mouth","customer referral")):
        return "referral"
    if any(x in text for x in ("website","organic search","seo","web organic","google organic")):
        return "website"
    if any(x in text for x in ("truck wrap","vehicle wrap","magazine","television"," tv ","channel 9","news","radio","billboard","branding")):
        return "branding"
    return "unknown"

def hcp_customer_id_from_obj(obj):
    if not isinstance(obj,dict):
        return None
    customer=obj.get("customer")
    if isinstance(customer,dict) and customer.get("id"):
        return customer.get("id")
    return obj.get("customer_id") or obj.get("customerId")

def hcp_customer_source_detail(customer_id):
    if not customer_id:
        return ""
    key="hcp_customer_source:"+str(customer_id)
    def loader():
        raw=hcp_get("customers/"+str(customer_id))
        detail=raw.get("customer") if isinstance(raw,dict) and isinstance(raw.get("customer"),dict) else raw
        return hcp_source_from_object(detail) if isinstance(detail,dict) else ""
    try:
        return cached_runtime(key,600,loader) or ""
    except Exception:
        return ""

def hcp_resolve_sources(objects):
    ids=[]
    for obj in objects:
        if not isinstance(obj,dict):
            continue
        if hcp_source_from_object(obj):
            continue
        customer=obj.get("customer") if isinstance(obj.get("customer"),dict) else None
        if customer and hcp_source_from_object(customer):
            continue
        cid=hcp_customer_id_from_obj(obj)
        if cid and str(cid) not in ids:
            ids.append(str(cid))
    resolved={}
    if ids:
        with ThreadPoolExecutor(max_workers=min(6,len(ids))) as pool:
            futures={pool.submit(hcp_customer_source_detail,cid):cid for cid in ids}
            for future in as_completed(futures):
                cid=futures[future]
                try: resolved[cid]=future.result() or ""
                except Exception: resolved[cid]=""
    return resolved

def hcp_object_source(obj,resolved=None):
    if not isinstance(obj,dict):
        return ""
    text=hcp_source_from_object(obj)
    if text:
        return text
    customer=obj.get("customer") if isinstance(obj.get("customer"),dict) else None
    text=hcp_source_from_object(customer)
    if text:
        return text
    cid=hcp_customer_id_from_obj(obj)
    return (resolved or {}).get(str(cid),"") if cid else ""

def hcp_list_leads_for_week(start,end):
    matched=[]
    page=1
    while page <= 10:
        data=hcp_get("leads", {"page":page,"page_size":100})
        batch=data.get("leads") or data.get("data") or []
        if not batch:
            break
        saw_older=False
        for lead in batch:
            if not isinstance(lead,dict):
                continue
            created=hcp_parse_datetime(lead.get("created_at") or lead.get("createdAt"))
            if not created:
                continue
            d=created.date()
            if d < start:
                saw_older=True
                continue
            if d <= end:
                matched.append(lead)
        total_pages=int(data.get("total_pages") or data.get("totalPages") or 1)
        if page >= total_pages or saw_older:
            break
        page += 1
    return matched

def hcp_list_estimates_for_week(start,end):
    summaries=[]
    page=1
    while True:
        data=hcp_get("estimates", {"page":page,"page_size":100})
        batch=data.get("estimates") or data.get("data") or []
        if not batch:
            break
        for estimate in batch:
            if not isinstance(estimate,dict):
                continue
            created=hcp_parse_datetime(estimate.get("created_at"))
            if created and start <= created.date() <= end:
                summaries.append(estimate)
        total_pages=int(data.get("total_pages") or 1)
        if page >= total_pages:
            break
        page += 1

    detailed=[]
    def hydrate(summary):
        estimate_id=summary.get("id")
        if not estimate_id:
            return summary
        try:
            raw=hcp_get("estimates/"+str(estimate_id))
            detail=raw.get("estimate") if isinstance(raw,dict) and isinstance(raw.get("estimate"),dict) else raw
            if isinstance(detail,dict):
                merged=dict(summary)
                merged.update(detail)
                return merged
        except Exception:
            pass
        return summary

    if summaries:
        with ThreadPoolExecutor(max_workers=min(6,len(summaries))) as pool:
            futures=[pool.submit(hydrate,e) for e in summaries]
            for future in as_completed(futures):
                detailed.append(future.result())
    return detailed

def hcp_source_attribution_snapshot(start,end):
    leads=hcp_list_leads_for_week(start,end)
    estimates=hcp_list_estimates_for_week(start,end)
    resolved=hcp_resolve_sources(leads+estimates)

    buckets={name:{"leads":0,"estimates":0,"jobs_sold":0,"sold_revenue":0.0,"sources":set()} for name in ("meta","google","lsa","yardsign","doorhanger","referral","website","branding","unknown")}

    for lead in leads:
        raw=hcp_object_source(lead,resolved)
        bucket=hcp_source_bucket(raw)
        buckets[bucket]["leads"] += 1
        if raw: buckets[bucket]["sources"].add(raw)

    for estimate in estimates:
        raw=hcp_object_source(estimate,resolved)
        bucket=hcp_source_bucket(raw)
        buckets[bucket]["estimates"] += 1
        if raw: buckets[bucket]["sources"].add(raw)
        sold=hcp_estimate_sold_value(estimate)
        if sold is not None:
            buckets[bucket]["jobs_sold"] += 1
            buckets[bucket]["sold_revenue"] += float(sold or 0)

    rows=[]
    for name,data in buckets.items():
        rows.append({
            "bucket":name,
            "leads":int(data["leads"]),
            "estimates":int(data["estimates"]),
            "jobs_sold":int(data["jobs_sold"]),
            "sold_revenue":round(float(data["sold_revenue"]),2),
            "source_labels":sorted(data["sources"])[:12]
        })

    field_map={
        "meta":{"leads":"ww-meta-leads","estimates":"ww-meta-estimates","jobs_sold":"ww-meta-jobs-sold","sold_revenue":"ww-meta-sold-revenue"},
        "google":{"leads":"ww-google-leads","estimates":"ww-google-estimates","jobs_sold":"ww-google-jobs-sold","sold_revenue":"ww-google-sold-revenue"},
        "lsa":{"leads":"ww-lsa-leads","estimates":"ww-lsa-estimates","jobs_sold":"ww-lsa-jobs-sold","sold_revenue":"ww-lsa-sold-revenue"},
        "yardsign":{"leads":"ww-yardsign-leads","estimates":"ww-yardsign-estimates","jobs_sold":"ww-yardsign-jobs-sold","sold_revenue":"ww-yardsign-sold-revenue"},
        "doorhanger":{"leads":"ww-doorhanger-leads","estimates":"ww-doorhanger-estimates","jobs_sold":"ww-doorhanger-jobs-sold","sold_revenue":"ww-doorhanger-sold-revenue"},
        "website":{"leads":"ww-website-leads","estimates":"ww-website-estimates","jobs_sold":"ww-website-jobs-sold","sold_revenue":"ww-website-sold-revenue"},
        "branding":{"leads":"ww-branding-leads","estimates":"ww-branding-estimates","jobs_sold":"ww-branding-jobs-sold","sold_revenue":"ww-branding-sold-revenue"}
    }
    auto_fields=[]
    for row in rows:
        mapping=field_map.get(row["bucket"])
        has_evidence=bool(row.get("source_labels")) or any(float(row.get(k) or 0) != 0 for k in ("leads","estimates","jobs_sold","sold_revenue"))
        if not mapping or not has_evidence:
            continue
        for metric,field_id in mapping.items():
            auto_fields.append({"field_id":field_id,"metric":metric,"bucket":row["bucket"],"value":row[metric]})

    referral=next((r for r in rows if r["bucket"]=="referral"),None)
    if referral and (referral.get("source_labels") or referral.get("leads") or referral.get("estimates") or referral.get("jobs_sold")):
        referral_count=0
        referral_revenue=0.0
        for estimate in estimates:
            raw=hcp_object_source(estimate,resolved)
            if hcp_source_bucket(raw)!="referral":
                continue
            sold=hcp_estimate_sold_value(estimate)
            if sold is not None and float(sold or 0) >= 300:
                referral_count += 1
                referral_revenue += float(sold or 0)
        auto_fields.extend([
            {"field_id":"ww-referral-count","metric":"jobs_sold_300_plus","bucket":"referral","value":referral_count},
            {"field_id":"ww-referral-revenue","metric":"sold_revenue_300_plus","bucket":"referral","value":round(referral_revenue,2)}
        ])

    attributed_leads=sum(r["leads"] for r in rows if r["bucket"]!="unknown")
    attributed_estimates=sum(r["estimates"] for r in rows if r["bucket"]!="unknown")
    attributed_sold=sum(r["sold_revenue"] for r in rows if r["bucket"]!="unknown")
    unknown=next((r for r in rows if r["bucket"]=="unknown"),{"leads":0,"estimates":0,"jobs_sold":0,"sold_revenue":0})

    return {
        "ok":True,
        "week_start":start.isoformat(),
        "week_ending":end.isoformat(),
        "rows":rows,
        "auto_fields":auto_fields,
        "coverage":{
            "leads_total":len(leads),
            "leads_attributed":attributed_leads,
            "estimates_total":len(estimates),
            "estimates_attributed":attributed_estimates,
            "sold_revenue_attributed":round(attributed_sold,2),
            "unknown_leads":unknown["leads"],
            "unknown_estimates":unknown["estimates"],
            "unknown_sold_revenue":unknown["sold_revenue"]
        },
        "scope_note":"Uses Housecall Pro native lead source/customer lead source values. Unknown or ambiguous source names are not guessed."
    }

def qb_normalize_text(value):
    return " ".join(str(value or "").lower().replace("&"," and ").replace("/"," ").replace("-"," ").split())

def qb_classify_expense(row):
    if not isinstance(row,dict):
        return None
    account=qb_normalize_text(row.get("account_name"))
    vendor=qb_normalize_text(row.get("vendor_name"))
    memo=qb_normalize_text(row.get("memo"))
    text=" | ".join(x for x in (account,vendor,memo) if x)

    # Specific rules first. Only high-confidence matches are auto-applied.
    rules=[
        ("ww-workers-comp","Workers Comp",("workers comp","workers compensation")),
        ("ww-payroll-tax","Payroll Tax",("payroll tax","employer tax","fica","medicare tax","social security tax")),
        ("ww-subcontractors","Subcontractors",("subcontractor","sub contractor","contract labor","contractor labor")),
        ("ww-gas","Gas / Fuel",("gasoline","diesel","motor fuel","vehicle fuel","fuel expense")),
        ("ww-chemicals","Chemicals",("cleaning chemical","pressure wash chemical","soft wash chemical","sodium hypochlorite","bleach chemical")),
        ("ww-meta-spend","Meta Ad Spend",("facebook ads","facebook advertising","meta ads","meta advertising","instagram ads","instagram advertising")),
        ("ww-lsa-spend","Google LSA Spend",("local service ads","google lsa","lsa advertising","lsa ads")),
        ("ww-google-spend","Google Ad Spend",("google ads","google advertising","adwords")),
        ("ww-yardsign-spend","Yard Sign Spend",("yard sign","yard signs")),
        ("ww-doorhanger-spend","Door Hanger Spend",("door hanger","door hangers")),
        ("ww-mktg-agency","Marketing Agency",("marketing agency","advertising agency")),
        ("ww-printed","Printed Materials",("printing","printed materials","print materials","business cards","flyers","brochures")),
        ("ww-veh-insurance","Auto / Equipment Insurance",("auto insurance","vehicle insurance","commercial auto insurance","equipment insurance")),
        ("ww-veh-maintenance","Maintenance & Repair",("vehicle repair","auto repair","truck repair","vehicle maintenance","auto maintenance","truck maintenance","equipment repair","equipment maintenance")),
        ("ww-sw-crm","CRM / Scheduling",("housecall pro","go high level","gohighlevel","lead connector","crm software","scheduling software")),
        ("ww-sw-payroll","Payroll Software",("payroll software","payroll subscription")),
        ("ww-sw-bookkeeping","Bookkeeping Software",("bookkeeping software","accounting software")),
        ("ww-sw-website","Website",("website hosting","web hosting","domain registration","domain renewal","website software")),
        ("ww-oh-culligan","Culligan Water",("culligan",)),
        ("ww-oh-utilities","Utilities",("electric utility","electric bill","water utility","water bill","utility bill","utilities")),
        ("ww-oh-liability","Liability Insurance",("general liability","liability insurance")),
        ("ww-oh-warehouse","Warehouse",("warehouse rent","shop rent","warehouse lease","shop lease")),
        ("ww-oh-admin","Admin / Bookkeeping",("bookkeeping service","bookkeeper","admin service","administrative service")),
        ("ww-baddebt","Bad Debt",("bad debt","uncollectible","write off","writeoff")),
    ]
    for field_id,label,needles in rules:
        if any(n in text for n in needles):
            return {"field_id":field_id,"label":label,"confidence":"high","reason":"matched specific account/vendor text"}

    # Account-only rules where a generic vendor/memo match would be too risky.
    if account in ("payroll","payroll expense","wages","wages and salaries","employee wages","labor payroll"):
        return {"field_id":"ww-payroll","label":"Labor Payroll","confidence":"high","reason":"matched payroll account"}
    if account in ("job supplies","materials and supplies","job materials","supplies job","cost of goods sold supplies"):
        return {"field_id":"ww-supplies","label":"Job Supplies","confidence":"high","reason":"matched job-supplies account"}
    if account in ("vehicle payments","vehicle loan","truck loan","equipment loan","equipment payments"):
        return {"field_id":"ww-veh-payments","label":"Vehicle / Equipment Payments","confidence":"high","reason":"matched loan/payment account"}
    if account in ("office staff","office payroll","office wages"):
        return {"field_id":"ww-oh-office-staff","label":"Office Staff","confidence":"high","reason":"matched office-staff account"}
    if account in ("operations manager","operations manager payroll","operations payroll"):
        return {"field_id":"ww-oh-ops-manager","label":"Operations Manager","confidence":"high","reason":"matched operations-manager account"}

    return None

def qb_expense_preview(start,end):
    rows=qb_expense_store_load()
    grouped={}
    total=0.0
    count=0
    seen=set()
    mapped_by_field={}
    unmapped_by_account={}

    for row in rows:
        if not isinstance(row,dict):
            continue
        tx_date=qb_parse_date(row.get("transaction_date"))
        if not tx_date or tx_date < start or tx_date > end:
            continue

        unique_key=str(row.get("unique_key") or "")
        if unique_key and unique_key in seen:
            continue
        if unique_key:
            seen.add(unique_key)

        try:
            amount=float(row.get("amount") or 0)
        except Exception:
            amount=0.0

        account=str(row.get("account_name") or "Uncategorized").strip() or "Uncategorized"
        grouped[account]=grouped.get(account,0.0)+amount
        total += amount
        count += 1

        classification=qb_classify_expense(row)
        if classification and classification.get("confidence")=="high":
            field_id=classification["field_id"]
            bucket=mapped_by_field.setdefault(field_id,{
                "field_id":field_id,
                "label":classification["label"],
                "amount":0.0,
                "records":0,
                "sources":set()
            })
            bucket["amount"] += amount
            bucket["records"] += 1
            bucket["sources"].add(account)
        else:
            bucket=unmapped_by_account.setdefault(account,{"account_name":account,"amount":0.0,"records":0})
            bucket["amount"] += amount
            bucket["records"] += 1

    groups=[
        {"account_name":name,"amount":round(amount,2)}
        for name,amount in sorted(grouped.items(), key=lambda kv: abs(kv[1]), reverse=True)
    ]
    mapped_fields=[]
    for item in mapped_by_field.values():
        mapped_fields.append({
            "field_id":item["field_id"],
            "label":item["label"],
            "amount":round(item["amount"],2),
            "records":item["records"],
            "sources":sorted(item["sources"])
        })
    mapped_fields.sort(key=lambda x:abs(x["amount"]),reverse=True)

    unmapped=[
        {"account_name":item["account_name"],"amount":round(item["amount"],2),"records":item["records"]}
        for item in unmapped_by_account.values()
    ]
    unmapped.sort(key=lambda x:abs(x["amount"]),reverse=True)
    mapped_total=round(sum(float(x["amount"]) for x in mapped_fields),2)

    return {
        "expense_total":round(total,2),
        "expense_records":count,
        "groups":groups,
        "mapped_fields":mapped_fields,
        "mapped_total":mapped_total,
        "mapped_records":sum(int(x["records"]) for x in mapped_fields),
        "unmapped":unmapped,
        "unmapped_total":round(total-mapped_total,2),
        "unmapped_records":sum(int(x["records"]) for x in unmapped)
    }

def get_page_access_token(page_id):
    data=graph(page_id, {"fields":"id,name,access_token"})
    page_token=(data.get("access_token") or "").strip()
    if not page_token:
        raise RuntimeError("Meta did not return a Page Access Token for Page " + page_id)
    return page_token, data.get("name") or page_id

class Handler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control","no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma","no-cache")
        self.send_header("Expires","0")
        super().end_headers()

    def send_json(self, status, obj):
        body=json.dumps(obj).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type","application/json")
        self.send_header("Content-Length",str(len(body)))
        self.send_header("Cache-Control","no-store")
        self.end_headers()
        self.wfile.write(body)


    def do_POST(self):
        parsed=urllib.parse.urlparse(self.path)
        if parsed.path == "/api/quickbooks-expense":
            try:
                length=int(self.headers.get("Content-Length","0") or 0)
                if length <= 0 or length > 65536:
                    return self.send_json(400, {"ok":False,"error":"Invalid request body"})

                body=json.loads(self.rfile.read(length).decode("utf-8"))
                supplied_secret=str(body.get("secret") or "").strip()
                if not QB_WEBHOOK_SECRET or supplied_secret != QB_WEBHOOK_SECRET:
                    return self.send_json(401, {"ok":False,"error":"Unauthorized"})

                transaction_id=str(body.get("transaction_id") or "").strip()
                line_id=str(body.get("line_id") or "").strip()
                transaction_date=str(body.get("transaction_date") or "").strip()
                account_name=str(body.get("account_name") or "").strip()
                vendor_name=str(body.get("vendor_name") or "").strip()
                transaction_type=str(body.get("transaction_type") or "Expense").strip()
                memo=str(body.get("memo") or "").strip()

                try:
                    amount=float(body.get("amount"))
                except Exception:
                    return self.send_json(400, {"ok":False,"error":"amount must be numeric"})

                if not transaction_id or not qb_parse_date(transaction_date):
                    return self.send_json(400, {"ok":False,"error":"transaction_id and transaction_date are required"})

                unique_key=transaction_id + "::" + (line_id or account_name or "total")
                rows=qb_expense_store_load()
                existing_index=None
                for i,row in enumerate(rows):
                    if isinstance(row,dict) and str(row.get("unique_key") or "") == unique_key:
                        existing_index=i
                        break

                record={
                    "unique_key":unique_key,
                    "transaction_id":transaction_id,
                    "line_id":line_id,
                    "transaction_date":transaction_date,
                    "amount":amount,
                    "account_name":account_name or "Uncategorized",
                    "vendor_name":vendor_name,
                    "transaction_type":transaction_type,
                    "memo":memo
                }

                stored=existing_index is None
                if existing_index is None:
                    rows.append(record)
                else:
                    rows[existing_index]=record
                qb_expense_store_save(rows)

                return self.send_json(200,{
                    "ok":True,
                    "stored":stored,
                    "updated":not stored,
                    "records":len(rows)
                })
            except Exception as e:
                return self.send_json(400, {"ok":False,"error":str(e)})

        if parsed.path != "/api/google-review":
            return self.send_json(404, {"ok":False,"error":"Not found"})

        try:
            length=int(self.headers.get("Content-Length","0") or 0)
            if length <= 0 or length > 65536:
                return self.send_json(400, {"ok":False,"error":"Invalid request body"})

            body=json.loads(self.rfile.read(length).decode("utf-8"))

            supplied_secret=str(body.get("secret") or "").strip()
            if not REVIEWS_WEBHOOK_SECRET or supplied_secret != REVIEWS_WEBHOOK_SECRET:
                return self.send_json(401, {"ok":False,"error":"Unauthorized"})

            review_id=str(body.get("review_id") or "").strip()
            rating=body.get("rating")
            create_time=str(body.get("create_time") or "").strip()

            if not review_id or review_rating_number(rating) is None or not hcp_parse_datetime(create_time):
                return self.send_json(400, {"ok":False,"error":"review_id, rating, and create_time are required"})

            rows=review_store_load()
            existing={str(r.get("review_id") or "") for r in rows if isinstance(r,dict)}
            if review_id not in existing:
                rows.append({
                    "review_id":review_id,
                    "rating":rating,
                    "create_time":create_time
                })
                review_store_save(rows)

            return self.send_json(200, {
                "ok":True,
                "stored": review_id not in existing,
                "records": len(rows)
            })
        except Exception as e:
            return self.send_json(400, {"ok":False,"error":str(e)})

    def do_GET(self):
        parsed=urllib.parse.urlparse(self.path)
        if parsed.path == "/api/health":
            return self.send_json(200, {
                "ok":True,
                "meta_configured":bool(TOKEN and AD_ACCOUNT and PAGE_IDS),
                "hcp_configured":bool(HCP_API_KEY)
            })
        if parsed.path == "/api/qb-preview":
            try:
                q=urllib.parse.parse_qs(parsed.query)
                week_ending=(q.get("week_ending") or [""])[0]
                end=datetime.strptime(week_ending,"%Y-%m-%d").date()
                start=end-timedelta(days=6)
                preview=qb_expense_preview(start,end)
                preview.update({
                    "ok":True,
                    "week_start":start.isoformat(),
                    "week_ending":end.isoformat()
                })
                return self.send_json(200,preview)
            except Exception as e:
                return self.send_json(400,{"ok":False,"error":str(e)})
        if parsed.path == "/api/qb-health":
            try:
                rows=qb_expense_store_load()
                return self.send_json(200,{
                    "ok":True,
                    "configured":bool(QB_WEBHOOK_SECRET),
                    "records":len(rows),
                    "storage_path":QB_EXPENSE_DATA_PATH
                })
            except Exception as e:
                return self.send_json(400,{"ok":False,"error":str(e)})
        if parsed.path == "/api/reviews-health":
            try:
                rows=review_store_load()
                return self.send_json(200,{
                    "ok":True,
                    "configured":bool(REVIEWS_WEBHOOK_SECRET),
                    "records":len(rows),
                    "storage_path":REVIEW_DATA_PATH
                })
            except Exception as e:
                return self.send_json(400,{"ok":False,"error":str(e)})
        if parsed.path == "/api/hcp-health":
            try:
                if not HCP_API_KEY:
                    return self.send_json(503, {"ok":False,"error":"Housecall Pro is not configured. Add HCP_API_KEY in Railway Variables."})
                company=hcp_get("company")
                return self.send_json(200, {
                    "ok":True,
                    "connected":True,
                    "company_name":company.get("name") or company.get("company_name") or "Housecall Pro"
                })
            except urllib.error.HTTPError as e:
                try: detail=json.loads(e.read().decode("utf-8"))
                except Exception: detail={"message":str(e)}
                return self.send_json(502, {"ok":False,"error":"Housecall Pro API request failed","detail":detail})
            except Exception as e:
                return self.send_json(400, {"ok":False,"error":str(e)})
        if parsed.path == "/api/hcp-tech-scorecards":
            try:
                if not HCP_API_KEY:
                    return self.send_json(503, {"ok":False,"error":"Housecall Pro is not configured."})
                q=urllib.parse.parse_qs(parsed.query)
                week_ending=(q.get("week_ending") or [""])[0]
                end=datetime.strptime(week_ending,"%Y-%m-%d").date()
                start=end-timedelta(days=6)
                key="hcp_tech_scorecards:"+start.isoformat()+":"+end.isoformat()
                return self.send_json(200,cached_runtime(key,120,lambda: hcp_technician_scorecards(start,end)))
            except urllib.error.HTTPError as e:
                try: detail=json.loads(e.read().decode("utf-8"))
                except Exception: detail={"message":str(e)}
                return self.send_json(502,{"ok":False,"error":"Housecall Pro technician scorecard request failed","detail":detail})
            except Exception as e:
                return self.send_json(400,{"ok":False,"error":str(e)})
        if parsed.path == "/api/hcp-source-attribution":
            try:
                if not HCP_API_KEY:
                    return self.send_json(503, {"ok":False,"error":"Housecall Pro is not configured."})
                q=urllib.parse.parse_qs(parsed.query)
                week_ending=(q.get("week_ending") or [""])[0]
                end=datetime.strptime(week_ending,"%Y-%m-%d").date()
                start=end-timedelta(days=6)
                key="hcp_source_attribution:"+start.isoformat()+":"+end.isoformat()
                return self.send_json(200,cached_runtime(key,120,lambda: hcp_source_attribution_snapshot(start,end)))
            except urllib.error.HTTPError as e:
                try: detail=json.loads(e.read().decode("utf-8"))
                except Exception: detail={"message":str(e)}
                return self.send_json(502,{"ok":False,"error":"Housecall Pro attribution request failed","detail":detail})
            except Exception as e:
                return self.send_json(400,{"ok":False,"error":str(e)})
        if parsed.path == "/api/hcp-customer-debug":
            try:
                q=urllib.parse.parse_qs(parsed.query)
                week_ending=(q.get("week_ending") or [""])[0]
                end=datetime.strptime(week_ending,"%Y-%m-%d").date()
                start=end-timedelta(days=6)
                jobs=hcp_list_completed_jobs(start, end)
                samples=[]
                for job in jobs[:3]:
                    customer_obj=job.get("customer") if isinstance(job.get("customer"), dict) else {}
                    customer_id=hcp_customer_id_from_job(job)
                    detail={}
                    if customer_id:
                        try:
                            raw=hcp_get("customers/" + str(customer_id))
                            detail=raw.get("customer") if isinstance(raw, dict) and isinstance(raw.get("customer"), dict) else raw
                            if not isinstance(detail, dict):
                                detail={}
                        except Exception:
                            detail={}
                    samples.append({
                        "job_customer_keys":sorted(list(customer_obj.keys())),
                        "job_customer_type_values":{
                            "customer_type":customer_obj.get("customer_type"),
                            "type":customer_obj.get("type"),
                            "customer_kind":customer_obj.get("customer_kind"),
                            "is_business":customer_obj.get("is_business")
                        },
                        "customer_detail_keys":sorted(list(detail.keys())),
                        "customer_detail_type_values":{
                            "customer_type":detail.get("customer_type"),
                            "type":detail.get("type"),
                            "customer_kind":detail.get("customer_kind"),
                            "is_business":detail.get("is_business")
                        }
                    })
                return self.send_json(200,{"ok":True,"samples":samples})
            except Exception as e:
                return self.send_json(400,{"ok":False,"error":str(e)})
        if parsed.path == "/api/needs-attention":
            try:
                if not HCP_API_KEY:
                    return self.send_json(503, {"ok":False,"error":"Housecall Pro is not configured. Add HCP_API_KEY in Railway Variables."})
                return self.send_json(200,needs_attention_snapshot())
            except urllib.error.HTTPError as e:
                try: detail=json.loads(e.read().decode("utf-8"))
                except Exception: detail={"message":str(e)}
                return self.send_json(502, {"ok":False,"error":"Needs Attention data request failed","detail":detail})
            except Exception as e:
                return self.send_json(400, {"ok":False,"error":str(e)})
        if parsed.path == "/api/hcp-operations-brief":
            try:
                if not HCP_API_KEY:
                    return self.send_json(503, {"ok":False,"error":"Housecall Pro is not configured. Add HCP_API_KEY in Railway Variables."})
                return self.send_json(200,cached_runtime("hcp_operations_brief",60,hcp_operations_brief))
            except urllib.error.HTTPError as e:
                try: detail=json.loads(e.read().decode("utf-8"))
                except Exception: detail={"message":str(e)}
                return self.send_json(502, {"ok":False,"error":"Housecall Pro API request failed","detail":detail})
            except Exception as e:
                return self.send_json(400, {"ok":False,"error":str(e)})
        if parsed.path == "/api/hcp-estimate-pipeline":
            try:
                if not HCP_API_KEY:
                    return self.send_json(503, {"ok":False,"error":"Housecall Pro is not configured. Add HCP_API_KEY in Railway Variables."})
                snapshot=cached_runtime("hcp_estimate_pipeline",90,hcp_estimate_pipeline_snapshot)
                return self.send_json(200,snapshot)
            except urllib.error.HTTPError as e:
                try: detail=json.loads(e.read().decode("utf-8"))
                except Exception: detail={"message":str(e)}
                return self.send_json(502, {"ok":False,"error":"Housecall Pro API request failed","detail":detail})
            except Exception as e:
                return self.send_json(400, {"ok":False,"error":str(e)})
        if parsed.path == "/api/hcp-preview":
            try:
                if not HCP_API_KEY:
                    return self.send_json(503, {"ok":False,"error":"Housecall Pro is not configured. Add HCP_API_KEY in Railway Variables."})
                q=urllib.parse.parse_qs(parsed.query)
                week_ending=(q.get("week_ending") or [""])[0]
                end=datetime.strptime(week_ending,"%Y-%m-%d").date()
                start=end-timedelta(days=6)

                completed_jobs=hcp_list_completed_jobs(start, end)
                revenue=sum(hcp_money_to_dollars(job.get("total_amount")) for job in completed_jobs)
                revenue_split=hcp_split_completed_revenue(completed_jobs)
                repeat_customers=hcp_repeat_customer_count(completed_jobs, start)
                callbacks=hcp_callback_count(completed_jobs)
                tech_metrics=hcp_job_tech_metrics(completed_jobs)
                review_count, review_records_total = review_count_for_week(start,end)
                review_metrics={
                    "available":True,
                    "five_star_reviews":review_count,
                    "review_records_found":review_records_total,
                    "json_payloads_found":0,
                    "widget_html_bytes":0
                }

                won_estimates=hcp_list_won_estimates(start, end)
                sold_revenue=sum(float(est.get("sold_value") or 0) for est in won_estimates)

                return self.send_json(200,{
                    "ok":True,
                    "week_start":start.isoformat(),
                    "week_ending":end.isoformat(),
                    "revenue":round(revenue,2),
                    "jobs_completed":len(completed_jobs),
                    "revenue_residential":round(revenue_split["residential"],2),
                    "revenue_commercial":round(revenue_split["commercial"],2),
                    "revenue_unclassified":round(revenue_split["unknown"],2),
                    "repeat_customers":repeat_customers,
                    "repeat_customer_pct":round((repeat_customers / len(completed_jobs) * 100.0),1) if completed_jobs else 0.0,
                    "callbacks":callbacks,
                    "five_star_reviews":review_metrics["five_star_reviews"],
                    "reviews_available":review_metrics["available"],
                    "review_records_found":review_metrics["review_records_found"],
                    "reviews_json_payloads_found":review_metrics["json_payloads_found"],
                    "reviews_widget_html_bytes":review_metrics["widget_html_bytes"],
                    "tech_count":tech_metrics["tech_count"],
                    "total_tech_hours":tech_metrics["total_tech_hours"],
                    "hours_per_tech":tech_metrics["hours_per_tech"],
                    "tech_rev_per_hour":round((revenue / tech_metrics["total_tech_hours"]),2) if tech_metrics["total_tech_hours"] else 0.0,
                    "tech_time_actual_jobs":tech_metrics["actual_time_jobs"],
                    "tech_time_scheduled_fallback_jobs":tech_metrics["scheduled_fallback_jobs"],
                    "tech_time_untracked_jobs":tech_metrics["untracked_jobs"],
                    "sold_revenue":round(sold_revenue,2),
                    "jobs_sold":len(won_estimates),
                    "scope_note":"Revenue/jobs completed use the actual HCP completion timestamp. Residential vs commercial uses the Job Type selected on each HCP job, with customer Homeowner/Business type as a fallback. Repeat customers are customers completed this week who had at least one completed HCP job before the week began. Callbacks count completed jobs tagged Callback in HCP. Tech hours use actual HCP Start/Finish timestamps when available and fall back to the job's scheduled start/end window when technicians did not use time tracking. Sold revenue/jobs sold use approved Housecall Pro estimates created within the selected week."
                })
            except urllib.error.HTTPError as e:
                try: detail=json.loads(e.read().decode("utf-8"))
                except Exception: detail={"message":str(e)}
                return self.send_json(502, {"ok":False,"error":"Housecall Pro API request failed","detail":detail})
            except Exception as e:
                return self.send_json(400, {"ok":False,"error":str(e)})
        if parsed.path != "/api/meta-preview":
            return super().do_GET()
        try:
            if not (TOKEN and AD_ACCOUNT and PAGE_IDS):
                return self.send_json(503, {"ok":False,"error":"Meta is not configured. Add META_ACCESS_TOKEN, META_AD_ACCOUNT_ID, and META_PAGE_IDS in Railway Variables."})
            q=urllib.parse.parse_qs(parsed.query)
            week_ending=(q.get("week_ending") or [""])[0]
            end=datetime.strptime(week_ending,"%Y-%m-%d").date()
            start=end-timedelta(days=6)

            acct=AD_ACCOUNT if AD_ACCOUNT.startswith("act_") else "act_"+AD_ACCOUNT
            insights=graph(acct+"/insights",{
                "fields":"spend",
                "time_range":json.dumps({"since":start.isoformat(),"until":end.isoformat()}),
                "level":"account",
                "limit":"100"
            }).get("data",[])
            spend=sum(float(x.get("spend") or 0) for x in insights)

            start_dt=datetime.combine(start, datetime.min.time(), tzinfo=timezone.utc)
            end_dt=datetime.combine(end+timedelta(days=1), datetime.min.time(), tzinfo=timezone.utc)
            leads=0
            forms_checked=0
            page_breakdown=[]
            for page_id in PAGE_IDS:
                page_count=0

                # Meta requires Page lead-form endpoints to be called with a
                # Page Access Token. Derive it from the configured user token
                # instead of storing a second secret in Railway.
                page_token, page_name=get_page_access_token(page_id)

                forms=all_pages(
                    page_id+"/leadgen_forms",
                    {"fields":"id,name,status","limit":"100"},
                    access_token=page_token
                )
                for form in forms:
                    forms_checked += 1
                    rows=all_pages(
                        form["id"]+"/leads",
                        {
                            "fields":"id,created_time",
                            "filtering":json.dumps([
                                {"field":"time_created","operator":"GREATER_THAN_OR_EQUAL","value":int(start_dt.timestamp())},
                                {"field":"time_created","operator":"LESS_THAN","value":int(end_dt.timestamp())}
                            ]),
                            "limit":"100"
                        },
                        access_token=page_token
                    )
                    page_count += len(rows)
                leads += page_count
                page_breakdown.append({
                    "page_id":page_id,
                    "page_name":page_name,
                    "instant_form_leads":page_count
                })

            return self.send_json(200,{
                "ok":True,
                "week_start":start.isoformat(),
                "week_ending":end.isoformat(),
                "meta_spend":round(spend,2),
                "instant_form_leads":leads,
                "forms_checked":forms_checked,
                "pages":page_breakdown,
                "scope_note":"Instant Form leads only; website, Messenger, and phone leads are excluded."
            })
        except urllib.error.HTTPError as e:
            try: detail=json.loads(e.read().decode("utf-8"))
            except Exception: detail={"message":str(e)}
            return self.send_json(502, {"ok":False,"error":"Meta API request failed","detail":detail})
        except Exception as e:
            return self.send_json(400, {"ok":False,"error":str(e)})

if __name__ == "__main__":
    port=int(os.getenv("PORT","8080"))
    ThreadingHTTPServer(("0.0.0.0",port),Handler).serve_forever()
