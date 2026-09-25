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

def hcp_list_completed_jobs(start, end):
    jobs=[]
    page=1
    while True:
        data=hcp_get("jobs", {
            "page":page,
            "page_size":100,
            "work_status[]":["completed"],
            "scheduled_start_min":start.isoformat(),
            "scheduled_start_max":end.isoformat()
        })
        batch=data.get("jobs") or data.get("data") or []
        jobs.extend(batch)
        total_pages=int(data.get("total_pages") or 1)
        if page >= total_pages or not batch:
            break
        page += 1

    # HCP's list filter accepts "completed", while returned statuses may be
    # "complete rated" / "complete unrated". Keep only completed rows.
    return [
        job for job in jobs
        if str(job.get("work_status") or "").lower().startswith("complete")
    ]

def hcp_money_to_dollars(value):
    try:
        return float(value or 0) / 100.0
    except (TypeError, ValueError):
        return 0.0

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

                jobs=hcp_list_completed_jobs(start, end)
                revenue=sum(hcp_money_to_dollars(job.get("total_amount")) for job in jobs)

                return self.send_json(200,{
                    "ok":True,
                    "week_start":start.isoformat(),
                    "week_ending":end.isoformat(),
                    "revenue":round(revenue,2),
                    "jobs_completed":len(jobs),
                    "scope_note":"Housecall Pro completed jobs scheduled within the selected week."
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
