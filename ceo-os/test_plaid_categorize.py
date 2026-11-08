"""Run with python -m unittest ceo-os/test_plaid_categorize.py (no credentials needed)."""
import unittest
from plaid_categorize import classify,summarize,insights,merchant_key

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

    def test_monthly_recurring_candidate(self):
        rows,monthly=summarize([
            {**self.tx(59.99,"ENTERTAINMENT","Streaming Plan",day="2026-09-10"),"account_id":"test-1"},
            {**self.tx(59.99,"ENTERTAINMENT","Streaming Plan",day="2026-10-10"),"account_id":"test-1"},
            {**self.tx(59.99,"ENTERTAINMENT","Streaming Plan",day="2026-11-10"),"account_id":"test-1"},
        ])
        insight=insights(rows,monthly)
        self.assertEqual(insight["recurring_candidates"][0]["cadence"],"Monthly-looking")
        self.assertEqual(insight["recurring_candidates"][0]["observations"],3)
        self.assertEqual(len(insight["trend"]),3)
    def test_single_transaction_not_recurring(self):
        rows,monthly=summarize([self.tx(80,"RENT_AND_UTILITIES","Utility Bill")])
        self.assertEqual(insights(rows,monthly)["recurring_candidates"],[])
    def test_transfer_not_recurring(self):
        rows,monthly=summarize([
            self.tx(100,"TRANSFER_OUT","Transfer",day="2026-09-10"),
            self.tx(100,"TRANSFER_OUT","Transfer",day="2026-10-10"),
        ])
        self.assertEqual(insights(rows,monthly)["recurring_candidates"],[])
    def test_top_spending_share(self):
        rows,monthly=summarize([
            self.tx(80,"FOOD_AND_DRINK","Food"),
            self.tx(20,"TRANSPORTATION","Gas")
        ])
        top=insights(rows,monthly)["top_categories_by_month"]["2026-11"]
        self.assertEqual(top[0]["category"],"Food & drink")
        self.assertEqual(top[0]["share_percent"],80)
    def test_irregular_amounts_not_recurring(self):
        rows,monthly=summarize([
            self.tx(30,"GENERAL_SERVICES","Subscription",day="2026-09-10"),
            self.tx(100,"GENERAL_SERVICES","Subscription",day="2026-10-10")
        ])
        self.assertEqual(insights(rows,monthly)["recurring_candidates"],[])

    def test_manual_transaction_correction_recalculates_expense(self):
        sample=self.tx(100,"OTHER","Corner Grocery")
        rows,monthly=summarize([sample],{"Corner Grocery":"Food & drink"})
        self.assertEqual(monthly["2026-11"]["expenses"],100)
        self.assertEqual(monthly["2026-11"]["review_count"],0)
        self.assertEqual(rows[0]["classification_reason"],"User correction")
    def test_merchant_rule_applies_to_same_account_only(self):
        first={**self.tx(40,"OTHER","Market 12345"),"id":"id1","account_id":"account-1"}
        second={**self.tx(60,"OTHER","Market 67890"),"id":"id2","account_id":"account-1"}
        third={**self.tx(80,"OTHER","Market 55555"),"id":"id3","account_id":"account-2"}
        key="account-1|"+merchant_key(first)
        rows,monthly=summarize([first,second,third],{}, {key:"Food & drink"})
        self.assertEqual(monthly["2026-11"]["expenses"],100)
        self.assertEqual(monthly["2026-11"]["review_count"],1)
    def test_negative_credit_cannot_be_forced_to_expense(self):
        tx=self.tx(-75,"OTHER","Reimbursement")
        rows,monthly=summarize([tx],{"Reimbursement":"Shopping"})
        self.assertEqual(monthly["2026-11"]["expenses"],0)
        self.assertEqual(monthly["2026-11"]["review_count"],1)
    def test_pending_cannot_be_forced_to_income(self):
        tx=self.tx(-300,"OTHER","PAYROLL",True)
        rows,monthly=summarize([tx],{"PAYROLL":"Income"})
        self.assertEqual(monthly["2026-11"]["income"],0)
        self.assertEqual(monthly["2026-11"]["pending_count"],1)
    def test_transaction_correction_precedes_merchant_rule(self):
        tx={**self.tx(50,"OTHER","Corner Store"),"id":"purchase-a","account_id":"account-1"}
        key="account-1|"+merchant_key(tx)
        rows,monthly=summarize([tx],{"purchase-a":"Transportation"},{key:"Shopping"})
        self.assertEqual(monthly["2026-11"]["categories"]["Transportation"],50)

if __name__=="__main__":unittest.main()
