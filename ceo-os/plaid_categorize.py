"""Conservative Plaid Sandbox transaction classification and cash-flow summary.

No real-bank credentials; unknown classification is deliberately kept out of
income/spending aggregates pending review. Positive Plaid amounts are debits,
negative amounts are credits. All totals exclude pending items.
"""
from collections import defaultdict
from datetime import date
from statistics import median
import re
import math

TRANSFER_PRIMARY = {"TRANSFER_IN","TRANSFER_OUT","LOAN_PAYMENTS"}
TRANSFER_DETAIL = {
    "TRANSFER_IN_ACCOUNT_TRANSFER", "TRANSFER_OUT_ACCOUNT_TRANSFER",
    "TRANSFER_IN_CASH_ADVANCES_AND_LOANS", "TRANSFER_OUT_SAVINGS",
    "TRANSFER_IN_SAVINGS", "TRANSFER_OUT_CASH_ADVANCES_AND_LOANS",
    "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT", "LOAN_PAYMENTS_PERSONAL_LOAN_PAYMENT",
}
REFUNDS = {"INCOME_TAX_REFUND"}
INCOME_PRIMARY = {"INCOME"}
SPENDING_LABELS = {
    "BANK_FEES":"Bank fees",
    "FOOD_AND_DRINK":"Food & drink",
    "TRANSPORTATION":"Transportation",
    "RENT_AND_UTILITIES":"Housing & utilities",
    "GENERAL_MERCHANDISE":"Shopping",
    "HOME_IMPROVEMENT":"Home improvement",
    "PERSONAL_CARE":"Personal care",
    "ENTERTAINMENT":"Entertainment",
    "TRAVEL":"Travel",
    "MEDICAL":"Health",
    "GOVERNMENT_AND_NON_PROFIT":"Government & giving",
    "GENERAL_SERVICES":"Services",
}
TRANSFER_TERMS = (
    "TRANSFER", "AUTOPAY PAYMENT", "CREDIT CARD PAYMENT",
    "CARD PAYMENT", "PAYMENT TO CARD", "ONLINE PAYMENT THANK YOU",
    "INTERNAL XFER", "LOAN PAYMENT", "SAVINGS TRANSFER"
)
PAYROLL_TERMS = ("PAYROLL", "DIRECT DEPOSIT", "SALARY", "PAYCHECK")
def classify(transaction):
    amount=transaction.get("amount")
    if type(amount) not in (int,float) or not math.isfinite(amount):
        return {"kind":"review","category":"Needs review","reason":"Invalid transaction amount"}
    primary=str(transaction.get("category") or "OTHER").upper()
    detail=str(transaction.get("category_detail") or "").upper()
    name=str(transaction.get("name") or "").upper()
    pending=bool(transaction.get("pending"))
    if pending:
        return {"kind":"pending","category":"Pending","reason":"Not yet settled"}
    if primary in TRANSFER_PRIMARY or detail in TRANSFER_DETAIL or any(term in name for term in TRANSFER_TERMS):
        return {"kind":"transfer","category":"Transfer or debt payment","reason":"Excluded to avoid double-counting"}
    if primary in INCOME_PRIMARY or detail in REFUNDS or (amount<0 and any(term in name for term in PAYROLL_TERMS)):
        if amount<0:
            return {"kind":"income","category":"Income","reason":"Income category"}
        return {"kind":"review","category":"Needs review","reason":"Income label contradicts debit direction"}
    if amount<0:
        # Credits can be refunds, reimbursements or earned income.
        # Neither is inferred without evidence.
        return {"kind":"review","category":"Credit to review","reason":"Credit may be refund or income"}
    if amount==0:
        return {"kind":"review","category":"Needs review","reason":"Zero amount"}
    if primary in SPENDING_LABELS:
        return {"kind":"expense","category":SPENDING_LABELS[primary],"reason":"Plaid category"}
    return {"kind":"review","category":"Needs review","reason":"Unknown category"}

USER_CATEGORIES = tuple(sorted(set(SPENDING_LABELS.values()))) + ("Income","Transfer","Needs review")

def merchant_key(transaction):
    name=str(transaction.get("name") or "").upper()
    cleaned=re.sub(r"\\s+"," ",re.sub(r"\\b\\d{3,}\\b","",name)).strip(" -#")
    return cleaned[:120] if len(cleaned)>=3 else ""

def selected_classification(tx, choice):
    amount=tx.get("amount")
    if tx.get("pending") or type(amount) not in (int,float) or not math.isfinite(amount) or amount==0:
        return None
    if choice=="Income" and amount<0:
        return {"kind":"income","category":"Income","reason":"User correction"}
    if choice=="Transfer":
        return {"kind":"transfer","category":"Transfer or debt payment","reason":"User correction"}
    if choice=="Needs review":
        return {"kind":"review","category":"Needs review","reason":"User correction"}
    if choice in SPENDING_LABELS.values() and amount>0:
        return {"kind":"expense","category":choice,"reason":"User correction"}
    return None

def summarize(transactions, transaction_rules=None, merchant_rules=None):
    transaction_rules=transaction_rules or {}
    merchant_rules=merchant_rules or {}
    months=defaultdict(lambda:{
        "income":0.0,"expenses":0.0,"transfers":0.0,"review":0,"pending":0,
        "count":0,"categories":defaultdict(float)
    })
    enriched=[]
    for tx in transactions:
        day=tx.get("date")
        try:
            if not isinstance(day,str):continue
            date.fromisoformat(day)
        except ValueError:
            continue
        category=classify(tx)
        own=transaction_rules.get(str(tx.get("id") or ""))
        key=merchant_key(tx)
        merchant_choice=merchant_rules.get(str(tx.get("account_id") or "")+"|"+key) if key else None
        choice=own or merchant_choice
        override=selected_classification(tx,choice) if choice else None
        if override:category=override
        tagged={**tx,"classification":category["kind"],
                "display_category":category["category"],
                "classification_reason":category["reason"]}
        enriched.append(tagged)
        month=months[day[:7]]
        month["count"]+=1
        amount=tx.get("amount")
        kind=category["kind"]
        if kind=="income":month["income"]+=abs(amount)
        elif kind=="expense":
            month["expenses"]+=abs(amount)
            month["categories"][category["category"]]+=abs(amount)
        elif kind=="transfer":month["transfers"]+=abs(amount)
        elif kind=="pending":month["pending"]+=1
        else:month["review"]+=1
    report={}
    for month,row in sorted(months.items(),reverse=True):
        report[month]={
            "income":round(row["income"],2),"expenses":round(row["expenses"],2),
            "net":round(row["income"]-row["expenses"],2),
            "excluded_transfer_volume":round(row["transfers"],2),
            "review_count":row["review"],"pending_count":row["pending"],
            "transaction_count":row["count"],
            "categories":dict(sorted(((k,round(v,2)) for k,v in row["categories"].items()),
                                   key=lambda x:-x[1]))
        }
    return enriched,report


def insights(enriched, monthly):
    """Conservative insights from already classified *posted* sample entries.

    A recurring item is a historical pattern, never a guaranteed subscription,
    next charge date, or an upcoming bill. Partial history limits conclusions.
    """
    trend=[
        {"month":month,"income":data["income"],"expenses":data["expenses"],
         "net":data["net"],"review_count":data["review_count"]}
        for month,data in sorted(monthly.items())[-6:]
    ]
    by_month={}
    for month,data in monthly.items():
        if not isinstance(data,dict):
            continue
        by_month[month]=[
            {"category":name,"amount":round(value,2),
             "share_percent":round(value/data["expenses"]*100,1) if data["expenses"]>0 else 0}
            for name,value in sorted(data.get("categories",{}).items(),key=lambda p:-p[1])[:5]
        ]
    groups=defaultdict(list)
    for tx in enriched:
        if tx.get("classification")!="expense":continue
        amount=tx.get("amount")
        if type(amount) not in (int,float) or not math.isfinite(amount) or amount<=0:continue
        name=str(tx.get("name") or "").strip()
        # Normalize bank-generated IDs/dates without merging unrelated merchants.
        canonical=re.sub(r"\\s+"," ",re.sub(r"\\b\\d{3,}\\b","",name.upper())).strip(" -#")
        if len(canonical)<3:continue
        try:day=date.fromisoformat(tx["date"])
        except (KeyError,TypeError,ValueError):continue
        account=str(tx.get("account_id") or "unknown")
        groups[(account,canonical)].append((day,float(amount),name))
    candidates=[]
    for (_,canonical),records in groups.items():
        records.sort(key=lambda r:r[0])
        # Repeated same-date entries are not evidence of a recurring bill.
        distinct=[]
        for record in records:
            if not distinct or distinct[-1][0]!=record[0]:
                distinct.append(record)
        if len(distinct)<2:continue
        amounts=[r[1] for r in distinct]
        typical=median(amounts)
        if typical<=0 or max(abs(a-typical)/typical for a in amounts)>.2:
            continue
        gaps=[(later[0]-prior[0]).days for prior,later in zip(distinct,distinct[1:])]
        if all(25<=gap<=40 for gap in gaps) and len({r[0].strftime("%Y-%m") for r in distinct})>=2:
            cadence="Monthly-looking"
        elif len(distinct)>=3 and all(6<=gap<=8 for gap in gaps):
            cadence="Weekly-looking"
        else:
            continue
        candidates.append({
            "merchant":distinct[-1][2][:80],
            "typical_amount":round(typical,2),
            "cadence":cadence,
            "observations":len(distinct),
            "last_seen":distinct[-1][0].isoformat()
        })
    candidates.sort(key=lambda c:(-c["observations"],-c["typical_amount"],c["merchant"]))
    return {"trend":trend,"top_categories_by_month":by_month,
            "recurring_candidates":candidates[:10],
            "note":"Historical Sandbox patterns only. Not a complete list of bills or future charges. Incomplete bank history and uncertain categories can change totals."}
