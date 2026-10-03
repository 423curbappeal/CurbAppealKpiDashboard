"""QuickBooks expense mapping rules for Curb Appeal KPI dashboard.

This module keeps high-confidence account/vendor mapping separate from the HTTP server.
Ambiguous transactions intentionally return None so the dashboard can leave them in Needs Review.
"""

def normalize(value):
    return " ".join(str(value or "").lower().replace("&"," and ").replace("/"," ").replace("-"," ").split())

KNOWN_CHEMICAL_VENDORS = (
    "pro chemical products",
    "amchem wash supply",
)

EXACT_ACCOUNT_RULES = {
    "subcontractor expenses": ("ww-subcontractors", "Subcontractors"),
    "contract labor": ("ww-subcontractors", "Subcontractors"),
    "vehicle gas and fuel": ("ww-gas", "Gas / Fuel"),
    "vehicle insurance": ("ww-veh-insurance", "Auto / Equipment Insurance"),
    "vehicle repairs": ("ww-veh-maintenance", "Maintenance & Repair"),
    "vehicle wash and road services": ("ww-veh-maintenance", "Maintenance & Repair"),
    "payroll taxes": ("ww-payroll-tax", "Payroll Tax"),
    "wages": ("ww-payroll", "Labor Payroll"),
    "phone service": ("ww-sw-phone", "Phone"),
    "accounting fees": ("ww-oh-admin", "Admin / Bookkeeping"),
    "business insurance": ("ww-oh-liability", "Liability Insurance"),
    "building and property rent": ("ww-oh-warehouse", "Warehouse"),
    "supplies and materials": ("ww-supplies", "Job Supplies"),
}

def exclusion_reason(row):
    account=normalize(row.get("account_name"))
    tx_type=normalize(row.get("transaction_type"))
    if any(x in tx_type for x in ("transfer","credit card payment","bill payment","deposit")):
        return "non-expense transaction type"
    if account.startswith("checking ") or account.startswith("savings "):
        return "balance-sheet transfer account"
    if account in (
        "checking","savings","transfer","transfers","credit card payment",
        "owner draw","owner draws","owners draw","owners draws",
        "owner distribution","owner distributions","owner contribution",
        "owner contributions","equity","personal expense","personal expenses"
    ):
        return "transfer/owner/equity account"
    return None

def classify(row):
    account=normalize(row.get("account_name"))
    vendor=normalize(row.get("vendor_name"))
    memo=normalize(row.get("memo"))
    text=" | ".join(x for x in (account,vendor,memo) if x)

    if any(v in vendor for v in KNOWN_CHEMICAL_VENDORS):
        return {"field_id":"ww-chemicals","label":"Chemicals","confidence":"high","reason":"known chemical vendor"}

    if vendor in ("meta","facebook","instagram") or "meta platforms" in vendor:
        return {"field_id":"ww-meta-spend","label":"Meta Ad Spend","confidence":"high","reason":"Meta/Facebook/Instagram vendor"}

    exact=EXACT_ACCOUNT_RULES.get(account)
    if exact:
        return {"field_id":exact[0],"label":exact[1],"confidence":"high","reason":"exact QuickBooks account"}

    rules=[
        ("ww-workers-comp","Workers Comp",("workers comp","workers compensation")),
        ("ww-payroll-tax","Payroll Tax",("payroll tax","employer tax","fica","medicare tax","social security tax")),
        ("ww-subcontractors","Subcontractors",("subcontractor","sub contractor","contractor labor")),
        ("ww-gas","Gas / Fuel",("gasoline","diesel","motor fuel","vehicle fuel","fuel expense","gas and fuel")),
        ("ww-chemicals","Chemicals",("cleaning chemical","pressure wash chemical","soft wash chemical","sodium hypochlorite","bleach chemical")),
        ("ww-meta-spend","Meta Ad Spend",("facebook ads","facebook advertising","meta ads","meta advertising","instagram ads","instagram advertising")),
        ("ww-lsa-spend","Google LSA Spend",("local service ads","google lsa","lsa advertising","lsa ads")),
        ("ww-google-spend","Google Ad Spend",("google ads","google advertising","adwords")),
        ("ww-yardsign-spend","Yard Sign Spend",("yard sign","yard signs")),
        ("ww-doorhanger-spend","Door Hanger Spend",("door hanger","door hangers")),
        ("ww-mktg-agency","Marketing Agency",("marketing agency","advertising agency")),
        ("ww-printed","Printed Materials",("printing","printed materials","print materials","business cards","flyers","brochures")),
        ("ww-veh-insurance","Auto / Equipment Insurance",("auto insurance","commercial auto insurance","equipment insurance")),
        ("ww-veh-maintenance","Maintenance & Repair",("vehicle repair","auto repair","truck repair","vehicle maintenance","auto maintenance","truck maintenance","equipment repair","equipment maintenance")),
        ("ww-sw-crm","CRM / Scheduling",("housecall pro","go high level","gohighlevel","lead connector","crm software","scheduling software")),
        ("ww-sw-payroll","Payroll Software",("payroll software","payroll subscription")),
        ("ww-sw-bookkeeping","Bookkeeping Software",("bookkeeping software","accounting software")),
        ("ww-sw-phone","Phone",("phone bill","phone service","business phone","cell phone","mobile phone","verizon","at and t","att wireless","t mobile")),
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
            return {"field_id":field_id,"label":label,"confidence":"high","reason":"specific account/vendor/memo text"}

    return None
