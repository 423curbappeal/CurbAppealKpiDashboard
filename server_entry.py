import json
import os
from http.server import ThreadingHTTPServer

import server
from qb_mapping_rules import classify as audited_classify, exclusion_reason as audited_exclusion_reason

def audited_qb_expense_preview(start, end):
    rows=server.qb_expense_store_load()
    grouped={}
    total=0.0
    count=0
    seen=set()
    mapped_by_field={}
    unmapped_by_account={}
    excluded_by_reason={}

    for row in rows:
        if not isinstance(row,dict):
            continue
        tx_date=server.qb_parse_date(row.get("transaction_date"))
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

        exclusion=audited_exclusion_reason(row)
        if exclusion:
            bucket=excluded_by_reason.setdefault(exclusion,{"reason":exclusion,"amount":0.0,"records":0})
            bucket["amount"] += amount
            bucket["records"] += 1
            continue

        account=str(row.get("account_name") or "Uncategorized").strip() or "Uncategorized"
        grouped[account]=grouped.get(account,0.0)+amount
        total += amount
        count += 1

        classification=audited_classify(row)
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

    excluded=[
        {"reason":item["reason"],"amount":round(item["amount"],2),"records":item["records"]}
        for item in excluded_by_reason.values()
    ]
    excluded.sort(key=lambda x:abs(x["amount"]),reverse=True)

    mapped_total=round(sum(float(x["amount"]) for x in mapped_fields),2)

    return {
        "expense_total":round(total,2),
        "expense_records":count,
        "supported_field_ids":[
            "ww-payroll","ww-workers-comp","ww-payroll-tax","ww-subcontractors",
            "ww-gas","ww-chemicals","ww-supplies","ww-meta-spend","ww-google-spend",
            "ww-lsa-spend","ww-yardsign-spend","ww-doorhanger-spend","ww-mktg-agency",
            "ww-printed","ww-veh-payments","ww-veh-insurance","ww-veh-maintenance",
            "ww-sw-crm","ww-sw-payroll","ww-sw-bookkeeping","ww-sw-phone","ww-sw-website",
            "ww-oh-office-staff","ww-oh-ops-manager","ww-oh-warehouse","ww-oh-admin",
            "ww-oh-culligan","ww-oh-utilities","ww-oh-liability","ww-baddebt"
        ],
        "groups":groups,
        "mapped_fields":mapped_fields,
        "mapped_total":mapped_total,
        "mapped_records":sum(int(x["records"]) for x in mapped_fields),
        "unmapped":unmapped,
        "unmapped_total":round(total-mapped_total,2),
        "unmapped_records":sum(int(x["records"]) for x in unmapped),
        "excluded":excluded,
        "excluded_total":round(sum(float(x["amount"]) for x in excluded),2),
        "excluded_records":sum(int(x["records"]) for x in excluded)
    }

server.qb_classify_expense=audited_classify
server.qb_expense_preview=audited_qb_expense_preview

if __name__ == "__main__":
    port=int(os.getenv("PORT","8080"))
    ThreadingHTTPServer(("0.0.0.0",port),server.Handler).serve_forever()
