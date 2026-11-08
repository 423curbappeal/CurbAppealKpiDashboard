"""Read-only server-side Google Calendar private iCal feed for CEO OS.
Secret URL stays in Railway; only filtered event fields reach logged-in browsers.
"""
import os
import ssl
import threading
import time
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, date, timezone
from zoneinfo import ZoneInfo

from icalendar import Calendar
import recurring_ical_events

FEED_URL = os.getenv("GOOGLE_CALENDAR_ICAL_URL", "").strip()
LOCAL_ZONE = ZoneInfo("America/New_York")
_lock = threading.Lock()
_cached = None
_cached_at = 0.0
TTL_SECONDS = 600
MAX_BYTES = 2_000_000

def _safe_url():
    parts = urllib.parse.urlsplit(FEED_URL)
    if parts.scheme != "https" or parts.hostname != "calendar.google.com" or parts.username or parts.password or parts.port not in (None,443):
        raise ValueError("Expected a Google Calendar private HTTPS iCal URL")
    if not parts.path.startswith("/calendar/ical/") or not parts.path.endswith(".ics") or parts.query or parts.fragment:
        raise ValueError("Unexpected Google Calendar iCal URL format")
    return FEED_URL

def _download():
    request = urllib.request.Request(_safe_url(), headers={"User-Agent":"CEO-OS-Calendar/1.0","Accept":"text/calendar"})
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, request, fp, code, msg, headers, newurl):
            return None
    opener = urllib.request.build_opener(NoRedirect, urllib.request.HTTPSHandler(context=ssl.create_default_context()))
    with opener.open(request, timeout=12) as response:
        if response.status != 200:
            raise ValueError("Calendar feed unavailable")
        raw = response.read(MAX_BYTES + 1)
        if len(raw)>MAX_BYTES:
            raise ValueError("Calendar feed too large")
    return Calendar.from_ical(raw)

def _datetime(value):
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=LOCAL_ZONE)
    if isinstance(value, date):
        return datetime(value.year, value.month, value.day, tzinfo=LOCAL_ZONE)
    raise ValueError("Unsupported event date")

def _events(calendar):
    now=datetime.now(LOCAL_ZONE)
    begin=(now-timedelta(days=14)).replace(hour=0,minute=0,second=0,microsecond=0)
    end=begin+timedelta(days=135)
    result=[]
    occurrences=recurring_ical_events.of(calendar).between(begin, end)
    for event in occurrences[:1500]:
        if str(event.get("STATUS","")).upper()=="CANCELLED":
            continue
        start_prop=event.get("DTSTART")
        if not start_prop: continue
        start_raw=start_prop.dt
        start=_datetime(start_raw)
        duration=event.get("DURATION")
        end_prop=event.get("DTEND")
        if end_prop: finish=_datetime(end_prop.dt)
        elif duration: finish=start+duration.dt
        else: finish=start+(timedelta(days=1) if isinstance(start_raw,date) and not isinstance(start_raw,datetime) else timedelta())
        all_day=isinstance(start_raw,date) and not isinstance(start_raw,datetime)
        title=str(event.get("SUMMARY") or "Busy")[:180]
        location=str(event.get("LOCATION") or "")[:200]
        # Do not include attendee data, meeting URLs, notes, descriptions or the secret feed URL.
        result.append({"title":title,"start":start.astimezone(LOCAL_ZONE).isoformat(),
                       "end":finish.astimezone(LOCAL_ZONE).isoformat(),
                       "all_day":all_day,"location":location})
    result.sort(key=lambda e:e["start"])
    return result[:500]

def load():
    if not FEED_URL:
        return {"status":"not_configured","events":[]}
    global _cached,_cached_at
    with _lock:
        if _cached is not None and time.monotonic()-_cached_at<TTL_SECONDS:
            return {"status":"connected","events":_cached,"cache_seconds":TTL_SECONDS}
        calendar=_download()
        events=_events(calendar)
        _cached=events
        _cached_at=time.monotonic()
        return {"status":"connected","events":events,"cache_seconds":TTL_SECONDS}
