from qb_mapping_rules import classify, exclusion_reason

CASES = [
    ({"account_name":"Vehicle gas & fuel","vendor_name":"Circle K"}, "ww-gas"),
    ({"account_name":"Vehicle gas & fuel","vendor_name":"Raceway"}, "ww-gas"),
    ({"account_name":"Supplies & materials","vendor_name":"Pro Chemical Products"}, "ww-chemicals"),
    ({"account_name":"Supplies & materials","vendor_name":"Amchem Wash Supply"}, "ww-chemicals"),
    ({"account_name":"Supplies & materials","vendor_name":"Elders Ace Dallas"}, "ww-supplies"),
    ({"account_name":"Wages"}, "ww-payroll"),
    ({"account_name":"Payroll taxes"}, "ww-payroll-tax"),
    ({"account_name":"Vehicle insurance"}, "ww-veh-insurance"),
    ({"account_name":"Vehicle repairs"}, "ww-veh-maintenance"),
    ({"account_name":"Phone service"}, "ww-sw-phone"),
    ({"account_name":"Accounting fees"}, "ww-oh-admin"),
    ({"account_name":"Business insurance"}, "ww-oh-liability"),
]

for row, expected in CASES:
    result=classify(row)
    assert result and result["field_id"] == expected, (row, result, expected)

assert exclusion_reason({"account_name":"Owner draws"}) is not None
assert exclusion_reason({"account_name":"Checking 7879","transaction_type":"Transfer"}) is not None
assert classify({"account_name":"Meals","vendor_name":"Circle K"}) is None
assert classify({"account_name":"Traditional Advertising","vendor_name":""}) is None

print("QuickBooks mapping tests passed:", len(CASES)+4)
