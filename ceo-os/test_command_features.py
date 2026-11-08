"""Validation tests for the six CEO OS feature records. No database needed."""
import sys
import types
import unittest
sys.modules.setdefault("psycopg", types.ModuleType("psycopg"))
import cloud_storage

STAMP=1794000000000

def base():
    return {"tasks":[],"workouts":[],"posts":[]}

def item(text="Sample",**kwargs):
    return {"id":"test-123","text":text,"when":STAMP,**kwargs}

class CommandFeatureTests(unittest.TestCase):
    def validated(self,key,record):
        state=base()
        state[key]=[record]
        return cloud_storage.validate(state)[key][0]

    def test_legacy_data_remains_compatible(self):
        result=cloud_storage.validate(base())
        for name in ("time_blocks","goals","leads","bills","budgets"):
            self.assertEqual(result[name],[])

    def test_time_block_saves(self):
        saved=self.validated("time_blocks",item("Estimate",date="2026-11-09",
                                      start="09:00",end="10:30",focus="Work"))
        self.assertEqual(saved["end"],"10:30")

    def test_overlapping_time_ranges_not_accepted_when_reversed(self):
        with self.assertRaises(ValueError):
            self.validated("time_blocks",item(date="2026-11-09",start="11:00",end="10:00",focus="Work"))

    def test_goal_saves(self):
        saved=self.validated("goals",item("Annual revenue",area="Business",unit="USD",
                                        target=1000000,current=0,deadline="2027-12-31"))
        self.assertEqual(saved["target"],1000000)

    def test_goal_rejects_invalid_percent(self):
        with self.assertRaises(ValueError):
            self.validated("goals",item(area="Fitness",unit="Percent",target=110,current=0,deadline=""))

    def test_lead_status_and_follow_up(self):
        saved=self.validated("leads",item("Customer lead",service="Roof cleaning",
                                        stage="Quoted",value=800,follow_up="2026-11-10",
                                        notes="Check estimate"))
        self.assertEqual(saved["stage"],"Quoted")

    def test_lead_invalid_stage_rejected(self):
        with self.assertRaises(ValueError):
            self.validated("leads",item(stage="Paid",value=100,follow_up="",service="Other"))

    def test_bills_store_monthly_history(self):
        saved=self.validated("bills",item("Rent",amount=1570,due_day=1,
                                        paid_months=["2026-11","2026-10"]))
        self.assertEqual(saved["paid_months"],["2026-10","2026-11"])

    def test_bill_invalid_month_rejected(self):
        with self.assertRaises(ValueError):
            self.validated("bills",item(amount=500,due_day=3,paid_months=["2026-13"]))

    def test_budget_validated(self):
        saved=self.validated("budgets",item("Food limit",category="Food",limit=500))
        self.assertEqual(saved["limit"],500)

    def test_no_nan_money_values(self):
        with self.assertRaises(ValueError):
            self.validated("budgets",item(category="Food",limit=float("nan")))

    def test_sensitive_notes_bounded(self):
        with self.assertRaises(ValueError):
            self.validated("leads",item(stage="New",value=0,follow_up="",
                                        service="Other",notes="x"*501))

if __name__=="__main__":
    unittest.main()
