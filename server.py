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

def hcp_split_completed_revenue(jobs):
    totals={"residential":0.0,"commercial":0.0,"unknown":0.0}
    cache={}
    for job in jobs:
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
                    "sold_revenue":round(sold_revenue,2),
                    "jobs_sold":len(won_estimates),
                    "scope_note":"Revenue/jobs completed use the actual HCP completion timestamp. Residential vs commercial uses each HCP customer's Homeowner/Business type. Sold revenue/jobs sold use approved Housecall Pro estimates created within the selected week."
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
