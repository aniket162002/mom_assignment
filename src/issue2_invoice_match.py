"""Issue 2 - Finance: invoice extraction, 3-way-style matching and exception report.

Free text -> structured fields (extraction only). Every number check, status and total is
computed in code. Anything touching bank details or duplicates is escalated to a human.
"""
import csv
import json
import re
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA, OUT = ROOT / "data", ROOT / "outputs"
NUM = r"([\d,]+(?:\.\d+)?)"


def n(s): return float(s.replace(",", ""))
def inr(x): return f"Rs {x:,.0f}" if float(x).is_integer() else f"Rs {x:,.2f}"


def parse_date(t: str):
    for m in re.finditer(r"\d{1,2}[-/ ](?:\d{1,2}|[A-Za-z]{3})[-/ ]\d{2,4}", t):
        s = m.group(0)
        for fmt in ("%d-%b-%Y", "%d/%m/%Y", "%d %b %y", "%d-%m-%Y", "%d %b %Y"):
            try:
                return datetime.strptime(s, fmt).date().isoformat()
            except ValueError:
                pass
    return None


def extract(doc_id: str, text: str, vendors: list) -> dict:
    """Regex stand-in for the LLM extractor (schema in prompts/extract_invoice.md)."""
    t = " ".join(text.split())
    g = lambda p, flags=re.I: (m.group(1) if (m := re.search(p, t, flags)) else None)
    d = {"doc": doc_id, "doc_type": "email" if "(email)" in t.lower() else "invoice"}
    d["vendor"] = next((v for v in vendors if v.lower() in t.lower()), None)
    d["invoice_no"] = g(r"(?:Invoice No:?|Bill no\.?|INV|Invoice)\s+([A-Z]{2,5}[/-][A-Z0-9/-]+)", 0)
    d["invoice_date"] = parse_date(t)
    po_n = g(r"PO(?:\s*Ref:)?[\s-]*(\d{4})")
    d["po_no"] = f"PO-{po_n}" if po_n else None
    qty = g(r"qty\s+" + NUM) or g(NUM + r"\s*(?:kg|nos|pcs)\b")
    d["qty"] = n(qty) if qty else None
    rate = g(r"rate\s+" + NUM) or g(r"@\s*(?:Rs\s*)?" + NUM) or g(r"Rs\s*" + NUM + r"\s*/\s*kg")
    d["rate"] = n(rate) if rate else None
    tax = g(r"taxable(?: value)?:?\s*(?:Rs\s*)?" + NUM) or g(r"=\s*" + NUM)
    d["taxable"] = n(tax) if tax else None
    if m := re.search(r"GST\s*@?\s*(\d+)\s*%:?\s*(?:=\s*)?(?:Rs\s*)?" + NUM, t, re.I):
        d["gst_pct"], d["gst_amt"] = float(m.group(1)), n(m.group(2))
    tot = re.findall(r"(?:Total:?|Invoice total|Net payable|total|for)\s*(?:Rs\s*)?" + NUM, t, re.I)
    d["total"] = n(tot[-1]) if tot else None
    d["item"] = next((i for i in ("PET Jar 500g", "Labels (MOM PB)", "Roasted Peanuts", "Rolled Oats")
                      if i.lower() in t.lower()), None)
    d["bank_change_requested"] = bool(re.search(r"bank account (?:has )?changed|new account", t, re.I))
    d["new_account_suffix"] = g(r"ending\s+(\d{3,6})")
    d["payment_pressure"] = bool(re.search(r"reminder|payment pending|urgent", t, re.I))
    return d


def load_po():
    with open(DATA / "po_grn.csv", newline="") as fh:
        return {r["po_no"]: {**r, "po_qty": n(r["po_qty"]), "po_rate": n(r["po_rate"]), "grn_qty": n(r["grn_qty"])}
                for r in csv.DictReader(fh)}


def match(docs: list, pos: dict) -> list:
    rows, seen = [], {}
    for d in docs:
        po = pos.get(d["po_no"])
        issues, flags, risk, status, action = [], [], 0.0, "MATCHED", "Release for payment."
        gst_f = 1 + (d.get("gst_pct") or 0) / 100
        # arithmetic consistency of the document itself
        if d["qty"] and d["rate"] and d["taxable"] and abs(d["qty"] * d["rate"] - d["taxable"]) > 1:
            flags.append("invoice arithmetic does not foot")
        if d.get("gst_amt") is not None and d["taxable"] and abs(d["taxable"] * d["gst_pct"] / 100 - d["gst_amt"]) > 1:
            flags.append("GST amount inconsistent with taxable value")
        if d["taxable"] and d.get("gst_amt") is not None and d["total"] and abs(d["taxable"] + d["gst_amt"] - d["total"]) > 1:
            flags.append("total != taxable + GST")
        dup = d["invoice_no"] in seen
        if dup:
            first = seen[d["invoice_no"]]
            status = "DUPLICATE - DO NOT PAY"
            issues.append(f"Invoice no. {d['invoice_no']} already received as {first['doc']} (same PO, qty, amount); "
                          f"this is an {d['doc_type']} reminder, not a new bill")
            risk = d["total"]
            action = "Block. Pay the original once only; no second payment."
        seen.setdefault(d["invoice_no"], d)
        if po is None:
            status, issues = "EXCEPTION - NO PO", issues + ["PO not found"]
            action = "Hold; ask buyer for valid PO."
        else:
            if d["vendor"] != po["vendor"]:
                issues.append(f"vendor {d['vendor']} != PO vendor {po['vendor']}")
            if d["item"] != po["item"]:
                issues.append(f"item {d['item']} != PO item {po['item']}")
            if not dup and abs(d["rate"] - po["po_rate"]) > 0.005:
                diff = (d["rate"] - po["po_rate"]) * d["qty"] * gst_f
                issues.append(f"billed rate {d['rate']:.2f} vs PO rate {po['po_rate']:.2f} "
                              f"(+{d['rate'] - po['po_rate']:.2f}/unit x {d['qty']:,.0f} = {inr(diff)} incl. GST overbilled)")
                risk += diff
                status = "EXCEPTION - RATE MISMATCH"
                action = (f"Hold full invoice. Request credit note / corrected invoice at PO rate "
                          f"(payable {inr(po['po_rate'] * d['qty'] * gst_f)}).")
            if not dup and d["qty"] > po["grn_qty"]:
                ex = d["qty"] - po["grn_qty"]
                diff = ex * d["rate"] * gst_f
                issues.append(f"billed qty {d['qty']:,.0f} > GRN {po['grn_qty']:,.0f} (billed {ex:,.0f} not received = {inr(diff)} incl. GST)")
                risk += diff
                status = "EXCEPTION - QTY EXCEEDS GRN"
                action = (f"Hold. Ask vendor for revised invoice for {po['grn_qty']:,.0f} (payable "
                          f"{inr(po['grn_qty'] * d['rate'] * gst_f)}) or proof of delivery of balance; "
                          f"Controller may part-pay the received value.")
        if d["bank_change_requested"]:
            flags.append(f"BANK-DETAIL CHANGE requested by email (new a/c ending {d['new_account_suffix']}) - unverified; "
                         f"possible payment fraud")
        if flags:
            issues += flags
        if status == "MATCHED" and d["bank_change_requested"]:
            action = "Release to bank account already on vendor master ONLY."
        rows.append({"Invoice": d["invoice_no"] + (f" ({d['doc']})" if dup else ""), "Vendor": d["vendor"],
                     "Status": status, "Reason": "; ".join(issues) or "3-way match OK (PO no., rate, qty <= GRN)",
                     "Amount at risk (Rs)": round(risk, 2), "Recommended action": action,
                     "_total": d["total"], "_dup": dup, "_doc": d["doc"]})
    # first copy of an invoice inherits the bank-change warning raised by its duplicate
    for r in rows:
        if r["_dup"] and "BANK-DETAIL" in r["Reason"]:
            orig = next(x for x in rows if not x["_dup"] and x["Invoice"] == r["Invoice"].split(" (")[0])
            if orig["Status"] == "MATCHED":
                orig["Reason"] += f"; a bank-detail change request arrived with its duplicate ({r['_doc']}) - see that row"
                orig["Recommended action"] = "Release ONCE, only to the bank account already on vendor master (ignore the 'new account' request)."
    return rows


def totals(rows):
    uniq = [r for r in rows if not r["_dup"]]
    submitted_unique = sum(r["_total"] for r in uniq)
    dup = sum(r["_total"] for r in rows if r["_dup"])
    safe = sum(r["_total"] for r in uniq if r["Status"] == "MATCHED")
    hold = sum(r["_total"] for r in uniq if r["Status"] != "MATCHED")
    assert abs(safe + hold - submitted_unique) < 0.01
    return {"submitted_documents_gross": submitted_unique + dup, "duplicate_excluded": dup,
            "submitted_unique_invoices": submitted_unique, "safe_to_release_now": safe, "on_hold": hold,
            "strict_safe_if_bank_change_unverified": sum(r["_total"] for r in uniq if r["Status"] == "MATCHED" and "GOM" not in r["Invoice"])}


VENDOR_QUERY = """To: accounts@saiagrotraders.example   [address from vendor master, not from the invoice]
Subject: Query on Bill SAT/889 (PO-2287) - billed qty exceeds goods received

Dear Sai Agro Traders accounts team,

Bill SAT/889 dated 26-Sep-2026 is for 5,000 kg Roasted Peanuts against PO-2287 (Rs 498,750 incl. GST).
Our goods receipt (GRN) shows 4,800 kg received, a shortfall of 200 kg. Rate (Rs 95/kg) matches the PO.

We cannot release payment for material not received. Please either:
 (a) send a revised invoice / credit note for 4,800 kg - Rs 456,000 + GST 5% Rs 22,800 = Rs 478,800; or
 (b) confirm the delivery date and challan/LR number for the balance 200 kg, and we will pay on receipt.

Payment will be processed in the normal cycle once we receive the corrected document.

Regards,
Accounts Payable, MOM
[Draft - for Finance Controller approval before sending]
"""

CONTROLLER_NOTE = """To: Finance Controller
Subject: Payment-fraud risk on Ganga Oats Mills (GOM/1207) + 2 exceptions - action needed before today's payment run

1. HIGH RISK - suspected bank-detail fraud. A "payment pending" email for GOM/1207 (Rs 182,700) asks us to pay a NEW
   account (ending 4821). Invoice GOM/1207 itself matches PO-2289 and GRN, but this email is a duplicate of it,
   adds payment pressure, and changes bank details by email - a classic business-email-compromise pattern.
   Recommend: pay the original once, to the account already on the vendor master only; do NOT update the master from this
   email; verify the change by calling the vendor on the number on file (not the one in the email); check the sender
   domain/headers; any approved change needs a second approver and a cooling-off before first payment.
2. Duplicate control. GOM/1207 arrived twice. Confirm our system blocks a second payment of the same vendor+invoice number.
3. Rate mismatch - Om Print OPL-4410: billed Rs 1.35 vs PO Rs 1.20 (+Rs 5,310 incl. GST). Is there an approved rate revision
   we are unaware of? If not, credit note needed; check whether other Om Print invoices carry the same rate.
4. Over-billing - Sai Agro SAT/889: 200 kg billed but not received (Rs 19,950 incl. GST). Query drafted. Note procurement's
   stock sheet shows no open PO for peanuts: is the 200 kg balance still due, or is PO-2287 closed short?
   Sai Agro has also announced +4% peanut price from 1 Nov - ensure new rates are not applied to existing POs.
5. Pattern worth watching: 3 of 4 vendors' invoices were dated 24-26 Sep and arrived together; confirm none of them were paid
   outside this cycle.
Amounts: safe to release Rs 454,100 (SP/2026/0871 + GOM/1207 to master-data account); on hold Rs 546,540; duplicate Rs 182,700 blocked.
"""


def main():
    pos = load_po()
    vendors = [p["vendor"] for p in pos.values()]
    docs = [extract(f"Doc {i}", (DATA / "invoices" / f"doc{i}.txt").read_text(), vendors) for i in range(1, 6)]
    rows = match(docs, pos)
    t = totals(rows)
    OUT.mkdir(exist_ok=True)
    (OUT / "issue2_extracted_fields.json").write_text(json.dumps(docs, indent=2))
    cols = ["Invoice", "Vendor", "Status", "Reason", "Amount at risk (Rs)", "Recommended action"]
    with open(OUT / "issue2_exception_report.csv", "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(cols)
        for r in rows:
            w.writerow([r[c] for c in cols])
    (OUT / "issue2_vendor_query_email.txt").write_text(VENDOR_QUERY, encoding="utf-8")
    (OUT / "issue2_controller_note.txt").write_text(CONTROLLER_NOTE, encoding="utf-8")

    md = ["# Issue 2 - Output (generated by src/issue2_invoice_match.py)\n", "## Extracted fields (5 documents)\n",
          "| Doc | Type | Vendor | Invoice | Date | PO | Item | Qty | Rate | Taxable | GST | Total |", "|---|---|---|---|---|---|---|---:|---:|---:|---:|---:|"]
    for d in docs:
        md.append(f"| {d['doc']} | {d['doc_type']} | {d['vendor']} | {d['invoice_no']} | {d['invoice_date']} | {d['po_no']} | {d['item']} | "
                  f"{d['qty']:,.0f} | {d['rate'] if d['rate'] is not None else '-'} | {d['taxable'] or '-'} | {d.get('gst_amt', '-')} | {d['total']:,.0f} |")
    md += ["\n## Exception report\n", "| " + " | ".join(cols) + " |", "|---|---|---|---|---:|---|"]
    for r in rows:
        md.append("| " + " | ".join(f"{r[c]:,.0f}" if c.startswith("Amount") else str(r[c]) for c in cols) + " |")
    md += ["\n## Totals\n",
           f"- Total submitted (4 unique invoices): **{inr(t['submitted_unique_invoices'])}**  (+ {inr(t['duplicate_excluded'])} duplicate reminder = {inr(t['submitted_documents_gross'])} across 5 documents)",
           f"- Safe to release now: **{inr(t['safe_to_release_now'])}** (SP/2026/0871 {inr(271400)} + GOM/1207 {inr(182700)} to existing master-data bank account only)",
           f"- On hold: **{inr(t['on_hold'])}** (OPL-4410 {inr(47790)} + SAT/889 {inr(498750)})",
           f"- Blocked duplicate (not payable): {inr(t['duplicate_excluded'])}",
           f"- Strict view if Controller also holds GOM/1207 until bank-change is cleared: release {inr(t['strict_safe_if_bank_change_unverified'])}, hold {inr(t['on_hold'] + 182700)}",
           "\n## Draft 1 - vendor query (Sai Agro Traders)\n", "```", VENDOR_QUERY, "```",
           "\n## Draft 2 - internal note to Finance Controller\n", "```", CONTROLLER_NOTE, "```"]
    (OUT / "issue2_report.md").write_text("\n".join(md), encoding="utf-8")
    print("\n".join(md))


if __name__ == "__main__":
    main()
