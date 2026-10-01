"""Independent hand-computed expectations (run: python -m unittest discover tests)."""
import sys, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))
import issue1_reorder as i1, issue2_invoice_match as i2


class Issue1(unittest.TestCase):
    def setUp(self):
        stock = i1.load_stock()
        facts = [i1.extract_email_facts((i1.DATA / "emails" / f).read_text()) for f in ("email_a.txt", "email_b.txt")]
        i1.apply_email_facts(stock, facts)
        self.r = {x["item"]: i1.evaluate(x) for x in stock}

    def test_values(self):
        exp = {"Roasted Peanuts": (6, 4200, "REORDER", 6000), "Almonds": (6, 1950, "CRITICAL", 150),
               "Rolled Oats": (12, 2250, "OK", 0), "PET Jars 500g": (6.5, 15000, "REORDER", 18000),
               "Labels (MOM PB)": (5, 9000, "REORDER", 18000)}
        for k, (c, rop, st, q) in exp.items():
            x = self.r[k]
            self.assertEqual((x["days_cover"], x["rop"], x["status"], x["suggested_qty"]), (c, rop, st, q), k)

    def test_email_a_is_relative_delay(self):
        self.assertEqual(self.r["Almonds"]["open_po_eta_days"], 11)  # 5 + 6, not 6

    def test_alert_limit(self):
        crit = self.r["Almonds"]
        self.assertLessEqual(len(i1.build_alert(list(self.r.values()), "x").split()), 100)


class Issue2(unittest.TestCase):
    def setUp(self):
        pos = i2.load_po()
        v = [p["vendor"] for p in pos.values()]
        docs = [i2.extract(f"Doc {i}", (i2.DATA / "invoices" / f"doc{i}.txt").read_text(), v) for i in range(1, 6)]
        self.rows = i2.match(docs, pos)

    def test_status(self):
        self.assertEqual([r["Status"] for r in self.rows],
                         ["MATCHED", "EXCEPTION - RATE MISMATCH", "EXCEPTION - QTY EXCEEDS GRN", "MATCHED", "DUPLICATE - DO NOT PAY"])

    def test_risk(self):
        self.assertEqual([r["Amount at risk (Rs)"] for r in self.rows], [0, 5310, 19950, 0, 182700])

    def test_totals(self):
        t = i2.totals(self.rows)
        self.assertEqual((t["submitted_unique_invoices"], t["safe_to_release_now"], t["on_hold"]), (1000640, 454100, 546540))


if __name__ == "__main__":
    unittest.main()
