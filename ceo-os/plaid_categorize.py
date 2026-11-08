"""Conservative Plaid Sandbox transaction classification and cash-flow summary.

No real-bank credentials; unknown classification is deliberately kept out of
income/spending aggregates pending review. Positive Plaid amounts are debits,
negative amounts are credits. All totals exclude pending items.
"""
from collections import defaultdict
from datetime import date
import math

TRANSFER_PRIMARY = {"TRANSFER_IN","TRANSFER_OUT","LOAN_PAYMENTS","BANK_FEES"}
TRANSFER_DETAIL = {
    "TRANSFER_IN_ACCOUNT_TRANSFER", "TRANSFER_OUT_ACCOUNT_TRANSFER",
    "TRANSFER_IN_CASH_ADVANCES_AND_LOANS", "TRANSFER_OUT_SAVINGS",
    "TRANSFER_IN_SAVINGS", "TRANSFER_OUT_CASH_ADVANCES_AND_LOANS",
    "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT", "LOAN_PAYMENTS_PERSONAL_LOAN_PAYMENT",
}
REFUNDS = {"INCOME_TAX_REFUND"}
INCOME_PRIMARY = {"INCOME"}
SPENDING_LABELS = {
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

def summarize(transactions):
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
