"""Read-only bridge to the existing Curb Appeal weekly KPI state.
Only a small allowlisted summary crosses into CEO OS. Credentials stay server-side.
"""
import base64
import json
import os
import ssl
import urllib.error
import urllib.parse
import urllib.request
from datetime import date
from ipaddress import ip_address

SOURCE_URL = os.getenv("KPI_SOURCE_URL","").strip()
SOURCE_USERNAME = os.getenv("KPI_SOURCE_USERNAME","").strip()
SOURCE_PASSWORD = os.getenv("KPI_SOURCE_PASSWORD","").strip()
EXPENSE_FIELDS = {
    "labor":["ww-payroll","ww-workers-comp","ww-payroll-tax","ww-subcontractors"],
    "direct":["ww-gas","ww-chemicals","ww-supplies"],
    "marketing":["ww-meta-spend","ww-google-spend","ww-lsa-spend","ww-yardsign-spend","ww-yardsign-labor","ww-yardsign-labor-tax","ww-doorhanger-spend","ww-doorhanger-labor","ww-doorhanger-labor-tax","ww-referral-giftcard-cost","ww-mktg-agency","ww-printed"],
    "vehicles":["ww-veh-payments","ww-veh-insurance","ww-veh-maintenance"],
    "software":["ww-sw-payroll","ww-sw-crm","ww-sw-phone","ww-sw-bookkeeping","ww-sw-website"],
    "overhead":["ww-oh-office-staff","ww-oh-ops-manager","ww-oh-warehouse","ww-oh-admin","ww-oh-culligan","ww-oh-utilities","ww-oh-liability"],
    "baddebt":["ww-baddebt"]
}

def configured():
    return bool(SOURCE_URL and SOURCE_USERNAME and SOURCE_PASSWORD)

def _safe_url():
    parsed = urllib.parse.urlsplit(SOURCE_URL)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password or parsed.port not in (None,443):
        raise ValueError("KPI_SOURCE_URL must be a public HTTPS dashboard URL")
    if parsed.path not in ("","/") or parsed.query or parsed.fragment:
        raise ValueError("KPI_SOURCE_URL must be a bare domain, without path or query")
    host = parsed.hostname.lower().rstrip(".")
    if host in ("localhost",) or host.endswith((".local",".internal")):
        raise ValueError("Local addresses are disallowed")
    try:
        ip_address(host)
        raise ValueError("Direct IP address not allowed")
    except ValueError as error:
        if str(error) == "Direct IP address not allowed":
            raise
    return "https://" + host + "/api/kpi-state"

def number(obj, key):
    try:
        return float(obj.get(key) or 0)
    except (TypeError,ValueError):
        return 0.0

def _round(value):
    return round(value,2)

def summarize(entry):
    w=entry.get("ww") if isinstance(entry.get("ww"),dict) else {}
    revenue=number(w,"revenue")
    expense_breakdown={}
    for group, keys in EXPENSE_FIELDS.items():
        fixed=sum(number(w,k) for k in keys)
        custom=w.get("_custom_"+group)
        extra=sum(number(i,"value") for i in custom if isinstance(i,dict)) if isinstance(custom,list) else 0
        expense_breakdown[group]=_round(fixed+extra)
    total_exp=sum(expense_breakdown.values())
    gross=revenue-expense_breakdown["labor"]-expense_breakdown["direct"]
    net=revenue-total_exp
    jobs=int(number(w,"jobsCompleted"))
    total_hours=number(w,"techCount")*number(w,"techHours")
    tech_rev=number(w,"techRevenue") or revenue
    return {"week_ending":entry["date"],"revenue":_round(revenue),"jobs_completed":jobs,
        "jobs_sold":int(number(w,"jobsSold")),"sold_revenue":_round(number(w,"soldRevenue")),
        "gross_profit":_round(gross),"net_profit":_round(net),
        "gross_margin_pct":_round(gross/revenue*100) if revenue else None,
        "net_margin_pct":_round(net/revenue*100) if revenue else None,
        "average_ticket":_round(revenue/jobs) if jobs else None,
        "revenue_per_tech_hour":_round(tech_rev/total_hours) if total_hours else None,
        "expenses":_round(total_exp)}

def load():
    if not configured():
        return {"status":"not_configured","weeks":[]}
    url=_safe_url()
    token=base64.b64encode((SOURCE_USERNAME+":"+SOURCE_PASSWORD).encode()).decode()
    request=urllib.request.Request(url, headers={"Authorization":"Basic "+token,"Accept":"application/json","User-Agent":"CEO-OS-ReadOnly/1.0"})
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self,req,fp,code,msg,headers,newurl):
            return None
    opener=urllib.request.build_opener(NoRedirect,urllib.request.HTTPSHandler(context=ssl.create_default_context()))
    with opener.open(request,timeout=9) as response:
        if response.status!=200:
            raise ValueError("KPI data unavailable")
        length=response.headers.get("Content-Length")
        if length and int(length)>3_000_000:
            raise ValueError("KPI response too large")
        payload=response.read(3_000_001)
        if len(payload)>3_000_000:
            raise ValueError("KPI response too large")
        data=json.loads(payload)
    if not isinstance(data,dict) or not data.get("ok") or not isinstance(data.get("entries"),list):
        raise ValueError("Unexpected KPI source response")
    today=date.today().isoformat()
    entries=[e for e in data["entries"] if isinstance(e,dict) and isinstance(e.get("date"),str)
        and len(e["date"])==10 and e["date"]<=today and isinstance(e.get("ww"),dict)]
    entries.sort(key=lambda x:x["date"],reverse=True)
    weeks=[summarize(e) for e in entries[:6]]
    return {"status":"connected" if weeks else "no_saved_weeks","source":"Curb Appeal KPI saved weekly dashboard",
        "weeks":weeks,"latest":weeks[0] if weeks else None}
