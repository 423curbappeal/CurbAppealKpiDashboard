"""Run with python -m unittest ceo-os/test_plaid_categorize.py (no credentials needed)."""
import unittest
from plaid_categorize import classify,summarize

class CategorizationTests(unittest.TestCase):
    def tx(self,amount,primary,name="Sample",pending=False,day="2026-11-07"):
        return {"id":name,"date":day,"amount":amount,"name":name,
                "category":primary,"pending":pending}
    def test_income_and_expense(self):
        rows,months=summarize([
            self.tx(-2000,"INCOME","PAYROLL"),
            self.tx(100,"FOOD_AND_DRINK","Lunch"),
        ])
        self.assertEqual(months["2026-11"]["income"],2000)
        self.assertEqual(months["2026-11"]["expenses"],100)
        self.assertEqual(months["2026-11"]["net"],1900)
    def test_credit_card_payment_excluded(self):
        rows,months=summarize([
            self.tx(250,"LOAN_PAYMENTS","Credit Card Payment"),
            self.tx(50,"GENERAL_MERCHANDISE","Store"),
        ])
        self.assertEqual(months["2026-11"]["expenses"],50)
        self.assertEqual(months["2026-11"]["excluded_transfer_volume"],250)
    def test_ambiguous_credits_not_income(self):
        rows,months=summarize([self.tx(-25,"FOOD_AND_DRINK","Refund")])
        self.assertEqual(months["2026-11"]["income"],0)
        self.assertEqual(months["2026-11"]["review_count"],1)
    def test_pending_excluded(self):
        rows,months=summarize([self.tx(100,"GENERAL_MERCHANDISE","Pending",True)])
        self.assertEqual(months["2026-11"]["expenses"],0)
        self.assertEqual(months["2026-11"]["pending_count"],1)
    def test_unknown_debit_review(self):
        rows,months=summarize([self.tx(70,"OTHER")])
        self.assertEqual(months["2026-11"]["expenses"],0)
        self.assertEqual(months["2026-11"]["review_count"],1)
    def test_bank_fees_count_as_spending(self):
        rows,months=summarize([self.tx(15,"BANK_FEES")])
        self.assertEqual(months["2026-11"]["expenses"],15)
    def test_months_separate(self):
        _,months=summarize([
            self.tx(-200,"INCOME",day="2026-11-01"),
            self.tx(20,"FOOD_AND_DRINK",day="2026-10-31"),
        ])
        self.assertEqual(months["2026-11"]["income"],200)
        self.assertEqual(months["2026-10"]["expenses"],20)

if __name__=="__main__":unittest.main()
