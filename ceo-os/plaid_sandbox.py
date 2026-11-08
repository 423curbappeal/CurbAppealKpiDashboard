"""Plaid Sandbox-only personal-finance demonstration.
Never connects to production; server-held tokens encrypted at rest.
"""
import base64
import hashlib
import json
import os
from contextlib import closing
from datetime import datetime, timezone
from urllib.request import Request, urlopen
from urllib.error import HTTPError
import math
import psycopg
from cryptography.fernet import Fernet
from plaid_categorize import summarize, insights, merchant_key, USER_CATEGORIES

HOST = "https://sandbox.plaid.com"
CLIENT = os.getenv("PLAID_CLIENT_ID","").strip()
SECRET = os.getenv("PLAID_SANDBOX_SECRET","").strip()
TOKEN_KEY = os.getenv("PLAID_TOKEN_ENCRYPTION_KEY","").strip()
DATABASE_URL = os.getenv("DATABASE_URL","").strip()
# Explicit opt-in. Production credentials and environments are not supported.
ENABLED = bool(os.getenv("PLAID_ENV","").lower()=="sandbox"
               and CLIENT and SECRET and len(TOKEN_KEY)>=32 and DATABASE_URL)
def configured():
    return ENABLED
def _crypto():
    return Fernet(base64.urlsafe_b64encode(hashlib.sha256(("ceo-plaid-sandbox:"+TOKEN_KEY).encode()).digest()))
def _db():
    if not ENABLED: raise ValueError("Plaid Sandbox is not configured")
    conn=psycopg.connect(DATABASE_URL,connect_timeout=5)
    with conn.cursor() as cur:
        cur.execute("""CREATE TABLE IF NOT EXISTS ceo_plaid_sandbox (
          item_id TEXT PRIMARY KEY, token_cipher BYTEA NOT NULL,
          cursor TEXT, transactions JSONB NOT NULL DEFAULT '{}'::jsonb,
          linked_at TIMESTAMPTZ NOT NULL DEFAULT NOW())""")
    conn.commit()
    return conn
class PlaidSyncMutation(Exception):
    """Plaid requires restarting pagination from the original saved cursor."""

def _api(path,data):
    if not ENABLED:raise ValueError("Sandbox is not configured")
    payload=dict(data,client_id=CLIENT,secret=SECRET)
    req=Request(HOST+path, data=json.dumps(payload).encode("utf-8"),
                headers={"Content-Type":"application/json","Accept":"application/json"},
                method="POST")
    try:
        with urlopen(req,timeout=16) as response:
            return json.loads(response.read(2500000))
    except HTTPError as error:
        # The Plaid error is parsed server-side only, never returned to the browser.
        if path=="/transactions/sync" and error.code==400:
            try:
                details=json.loads(error.read(4096))
                if details.get("error_code")=="TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION":
                    raise PlaidSyncMutation() from None
            except (ValueError,TypeError):
                pass
        # No access tokens or sensitive Plaid request information in client errors.
        raise ValueError("Plaid Sandbox request failed ("+str(error.code)+")") from None
def link_token():
    response=_api("/link/token/create",{
        "client_name":"CEO OS Sandbox","language":"en",
        "country_codes":["US"],"products":["transactions"],
        "user":{"client_user_id":"ceo-os-single-user-sandbox"}})
    return {"link_token":response["link_token"]}
def exchange(public_token):
    if not isinstance(public_token,str) or not public_token.startswith("public-sandbox-") or len(public_token)>500:
        raise ValueError("Invalid Sandbox token")
    result=_api("/item/public_token/exchange",{"public_token":public_token})
    item_id=result["item_id"]
    encrypted=_crypto().encrypt(result["access_token"].encode())
    with closing(_db()) as conn:
        with conn.cursor() as cur:
            cur.execute("""INSERT INTO ceo_plaid_sandbox(item_id,token_cipher)
                VALUES (%s,%s) ON CONFLICT(item_id) DO UPDATE SET token_cipher=EXCLUDED.token_cipher""",
                        (item_id,encrypted))
        conn.commit()
    return {"ok":True}
def _items():
    with closing(_db()) as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT item_id,token_cipher,cursor,transactions FROM ceo_plaid_sandbox ORDER BY linked_at")
            return cur.fetchall()
def _sync(item_id,token,cursor,existing):
    """Apply complete incremental batches exactly once; never persist partial pages.

    Plaid may mutate a transaction batch during pagination. In that case we
    restart at the ORIGINAL cursor, discarding the entire partial attempt.
    """
    for attempt in range(3):
        transactions=dict(existing or {})
        next_cursor=cursor
        mutated=False
        for _ in range(40):
            data={"access_token":token,"count":500}
            if next_cursor:data["cursor"]=next_cursor
            try:
                result=_api("/transactions/sync",data)
            except PlaidSyncMutation:
                mutated=True
                break
            for change in result.get("removed",[]):
                transactions.pop(change.get("transaction_id",""),None)
            for change in result.get("added",[])+result.get("modified",[]):
                tid=change.get("transaction_id")
                if not tid or len(tid)>160:continue
                amount=change.get("amount")
                if type(amount) not in (int,float) or not math.isfinite(amount):
                    continue
                if len(transactions)>=2500 and tid not in transactions:
                    # Do not silently advance the cursor while dropping records.
                    raise ValueError("Transaction retention limit reached; sync paused")
                transactions[tid]={
                    "id":tid,"account_id":change.get("account_id"),
                    "name":str(change.get("merchant_name") or change.get("name") or "Transaction")[:120],
                    "amount":amount,"date":change.get("date"),
                    "pending":bool(change.get("pending",False)),
                    "category":(change.get("personal_finance_category") or {}).get("primary","OTHER"),
                    "category_detail":(change.get("personal_finance_category") or {}).get("detailed","")}
            next_cursor=result.get("next_cursor")
            if not result.get("has_more"):
                with closing(_db()) as conn:
                    with conn.cursor() as cur:
                        cur.execute("UPDATE ceo_plaid_sandbox SET cursor=%s,transactions=%s::jsonb WHERE item_id=%s",
                                    (next_cursor,json.dumps(transactions),item_id))
                    conn.commit()
                return transactions
        if not mutated:
            raise ValueError("Sandbox sync exceeded page limit; no partial changes committed")
    raise ValueError("Sandbox sync changed repeatedly during pagination; retry later")
def _rules_table(cur):
    cur.execute("""CREATE TABLE IF NOT EXISTS ceo_plaid_sandbox_rules (
        rule_key TEXT PRIMARY KEY, choice TEXT NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())""")

def _rules():
    with closing(_db()) as conn:
        with conn.cursor() as cur:
            _rules_table(cur)
            cur.execute("SELECT rule_key,choice FROM ceo_plaid_sandbox_rules")
            rows=cur.fetchall()
        conn.commit()
    tx_rules={};merchant_rules={}
    for key,choice in rows:
        if key.startswith("tx:"):tx_rules[key[3:]]=choice
        if key.startswith("merchant:"):merchant_rules[key[9:]]=choice
    return tx_rules,merchant_rules

def correct_transaction(transaction_id, choice, remember_merchant=False):
    """Only allow correction of an existing saved Sandbox transaction."""
    if not isinstance(transaction_id,str) or not 1<=len(transaction_id)<=160:
        raise ValueError("Invalid transaction")
    if choice not in USER_CATEGORIES or type(remember_merchant) is not bool:
        raise ValueError("Invalid classification")
    match=None
    for _,_,_,saved in _items()[:5]:
        if transaction_id in (saved or {}):
            match=saved[transaction_id]
            break
    if not match:
        raise ValueError("Transaction not found; refresh the Sandbox data")
    amount=match.get("amount")
    if match.get("pending") or type(amount) not in (int,float) or amount==0:
        raise ValueError("Pending or zero-value transactions cannot be corrected")
    if (choice=="Income" and amount>=0) or (choice not in ("Income","Transfer","Needs review") and amount<=0):
        raise ValueError("Category conflicts with transaction direction")
    merchant=merchant_key(match)
    account_id=str(match.get("account_id") or "")
    if remember_merchant and (not merchant or not account_id):
        raise ValueError("Merchant cannot be identified for a rule")
    keys=["tx:"+transaction_id]
    if remember_merchant:
        keys.append("merchant:"+account_id+"|"+merchant)
    with closing(_db()) as conn:
        with conn.cursor() as cur:
            _rules_table(cur)
            for key in keys:
                cur.execute("""INSERT INTO ceo_plaid_sandbox_rules(rule_key,choice)
                  VALUES (%s,%s) ON CONFLICT(rule_key) DO UPDATE
                  SET choice=EXCLUDED.choice,updated_at=NOW()""",(key,choice))
        conn.commit()
    return {"ok":True,"remembered_merchant":remember_merchant}

def overview(refresh=False):
    """Return partial test data when Sandbox sync/balances are temporarily unavailable.

    Never invent current balances: fallback accounts/get snapshots carry an explicit
    freshness warning and are NOT labeled as recently refreshed balances.
    """
    if not ENABLED:
        return {"status":"not_configured","environment":"sandbox"}
    items=_items()
    if not items:
        return {"status":"not_linked","environment":"sandbox","accounts":[],"transactions":[],"monthly":{}}
    accounts=[]
    transactions=[]
    warnings=[]
    for item_id,encrypted,cursor,saved in items[:5]:
        token=_crypto().decrypt(bytes(encrypted)).decode()
        if refresh:
            try:
                saved=_sync(item_id,token,cursor,saved)
            except (ValueError,HTTPError,OSError,KeyError,TypeError,TimeoutError,PlaidSyncMutation) as exc:
                # Retain previously imported transactions; do not reset the sync cursor.
                warnings.append("Transaction sync temporarily unavailable; showing last saved sample transactions.")
        try:
            response=_api("/accounts/balance/get",{"access_token":token})
        except (ValueError,HTTPError,OSError,KeyError,TypeError,TimeoutError):
            warnings.append("Live Sandbox balances unavailable; attempting account metadata fallback.")
            try:
                response=_api("/accounts/get",{"access_token":token})
                warnings.append("Balances from account metadata may be stale.")
            except (ValueError,HTTPError,OSError,KeyError,TypeError,TimeoutError):
                response={"accounts":[]}
                warnings.append("Account metadata unavailable; linked test accounts retained.")
        for a in response.get("accounts",[]):
            balance=a.get("balances") or {}
            accounts.append({"id":a.get("account_id"),"name":str(a.get("name","Account"))[:80],
                             "type":a.get("type"),"subtype":a.get("subtype"),
                             "current":balance.get("current"),"available":balance.get("available"),
                             "currency":balance.get("iso_currency_code") or "USD"})
        transactions.extend(list((saved or {}).values()))
    transactions.sort(key=lambda a:a.get("date") or "",reverse=True)
    tx_rules,merchant_rules=_rules()
    insight_data={}
    try:
        transactions,monthly=summarize(transactions,tx_rules,merchant_rules)
        insight_data=insights(transactions,monthly)
    except (ValueError,TypeError,KeyError,OverflowError,AttributeError):
        # Bad historical transaction metadata should not hide all saved account data.
        monthly={}
        warnings.append("Some saved sample transactions could not be categorized.")
    return {"status":"connected","environment":"sandbox",
            "sample_data":True,"accounts":accounts[:50],
            "transactions":transactions[:350],
            "monthly":monthly,
            "insights":insight_data,
            "warnings":list(dict.fromkeys(warnings)),
            "classification_version":"conservative-v2-user-corrections",
            "available_categories":list(USER_CATEGORIES),
            "retrieved_at":datetime.now(timezone.utc).isoformat()}
def disconnect_all():
    # Explicitly disconnects Sandbox test items and discards all token material.
    for item_id,encrypted,_,_ in _items():
        token=_crypto().decrypt(bytes(encrypted)).decode()
        _api("/item/remove",{"access_token":token})
    with closing(_db()) as conn:
        with conn.cursor() as cur:
            _rules_table(cur)
            cur.execute("DELETE FROM ceo_plaid_sandbox_rules")
            cur.execute("DELETE FROM ceo_plaid_sandbox")
        conn.commit()
    return {"ok":True}
