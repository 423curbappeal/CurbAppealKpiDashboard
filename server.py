import json, os, urllib.parse, urllib.request, urllib.error
from datetime import datetime, timedelta, timezone
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler

GRAPH_VERSION = os.getenv("META_GRAPH_VERSION", "v24.0")
TOKEN = os.getenv("META_ACCESS_TOKEN", "").strip()
AD_ACCOUNT = os.getenv("META_AD_ACCOUNT_ID", "").strip()
PAGE_IDS = [x.strip() for x in os.getenv("META_PAGE_IDS", "").split(",") if x.strip()]
HCP_API_KEY = os.getenv("HCP_API_KEY", "").strip()
HCP_API_BASE = "https://api.housecallpro.com"

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

    def do_GET(self):
        parsed=urllib.parse.urlparse(self.path)
        if parsed.path == "/api/health":
            return self.send_json(200, {
                "ok":True,
                "meta_configured":bool(TOKEN and AD_ACCOUNT and PAGE_IDS),
                "hcp_configured":bool(HCP_API_KEY)
            })
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
