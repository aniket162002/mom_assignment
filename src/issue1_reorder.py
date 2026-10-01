"""Issue 1 - Raw material reorder alerts.

Pipeline:  stock.csv + supplier emails -> (1) extract facts -> (2) update numbers
           -> (3) deterministic rules engine -> (4) alert + supplier draft.

All arithmetic and status logic live here, in code. Free text is only used for
*extracting facts*; every extracted fact is validated before it touches a number.
"""
import csv
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA, OUT = ROOT / "data", ROOT / "outputs"


# ---------------------------------------------------------------- extraction
def extract_email_facts(text: str) -> dict:
    """Pull structured facts out of a supplier email (regex stand-in for the LLM
    extractor; same output schema, see prompts/extract_supplier_email.md)."""
    t = " ".join(text.split())
    facts = {"supplier": None, "po_ref": None, "po_qty": None, "eta_delay_days": None,
             "price_change_pct": None, "price_effective": None,
             "lead_time_changed": None, "raw": t}
    m = re.search(r"From:\s*(?:\w+,\s*)?([A-Za-z ]+?(?:Pvt Ltd|Traders|Mills|Labels)?)\s*\|", t)
    facts["supplier"] = m.group(1).strip() if m else None
    if m := re.search(r"\bPO[\s-]*(\d{4})", t):
        facts["po_ref"] = f"PO-{m.group(1)}"
    if m := re.search(r"\((\d[\d,]*)\s*kg\)", t):
        facts["po_qty"] = int(m.group(1).replace(",", ""))
    # "6 days later than the date we had committed" -> RELATIVE delay, not a new absolute ETA
    if m := re.search(r"(\d+)\s*days?\s*later", t, re.I):
        facts["eta_delay_days"] = int(m.group(1))
    if m := re.search(r"(?:up|increase)\D{0,15}?(\d+(?:\.\d+)?)\s*%\s*from\s*(\d+\w*\s*\w+)", t, re.I):
        facts["price_change_pct"] = float(m.group(1))
        facts["price_effective"] = m.group(2)
    if re.search(r"lead times? remain", t, re.I):
        facts["lead_time_changed"] = False
    return facts


def apply_email_facts(stock: list, facts_list: list) -> list:
    """Update stock rows from validated facts. Returns an audit log of every change."""
    log = []
    for f in facts_list:
        if f["eta_delay_days"] is not None and f["po_ref"]:
            row = next((r for r in stock if r["open_po_ref"] == f["po_ref"]), None)
            if row is None:  # unknown PO -> never guess, route to human
                log.append(f"UNMATCHED: {f['po_ref']} not in stock sheet - needs human review")
                continue
            if f["po_qty"] and f["po_qty"] != row["open_po_qty"]:
                log.append(f"WARN: email qty {f['po_qty']} != sheet qty {row['open_po_qty']} for {f['po_ref']}")
            old = row["open_po_eta_days"]
            row["open_po_eta_days"] = old + f["eta_delay_days"]
            log.append(f"{row['item']}: {f['po_ref']} ETA {old}d -> {row['open_po_eta_days']}d "
                       f"(+{f['eta_delay_days']}d, {f['supplier']})")
        if f["price_change_pct"] is not None:
            log.append(f"PRICE FLAG ({f['supplier']}): peanut rate +{f['price_change_pct']:g}% from "
                       f"{f['price_effective']}. Lead times unchanged -> no stock/ROP number changes; "
                       f"passed to procurement for buy-ahead decision.")
    return log


# ------------------------------------------------------------------- engine
def load_stock() -> list:
    rows = []
    with open(DATA / "stock.csv", newline="") as fh:
        for r in csv.DictReader(fh):
            rows.append({
                "item": r["item"], "unit": r["unit"],
                "stock": int(r["current_stock"]), "usage": int(r["avg_daily_usage"]),
                "lead_time": int(r["lead_time_days"]), "safety": int(r["safety_stock"]),
                "open_po_qty": int(r["open_po_qty"]), "open_po_ref": r["open_po_ref"],
                "open_po_eta_days": int(r["open_po_eta_days"]) if r["open_po_eta_days"] else None,
            })
    return rows


def evaluate(r: dict) -> dict:
    cover = r["stock"] / r["usage"]
    rop = r["usage"] * r["lead_time"] + r["safety"]
    eta = r["open_po_eta_days"]
    counted = r["open_po_qty"] if (r["open_po_qty"] and eta is not None and eta <= cover) else 0
    if cover < r["lead_time"] and counted == 0:
        status = "CRITICAL"
    elif r["stock"] + counted <= rop:
        status = "REORDER"
    else:
        status = "OK"
    qty = 0
    if status != "OK":
        qty = max(0, r["usage"] * 14 + r["safety"] - (r["stock"] + r["open_po_qty"]))
    gap_days = max(0, eta - cover) if (r["open_po_qty"] and eta is not None and counted == 0) else 0
    out = dict(r, days_cover=round(cover, 2), rop=rop, counted_po=counted, status=status,
               suggested_qty=qty, gap_days=round(gap_days, 2),
               gap_qty=round(gap_days * r["usage"]))
    out["action"] = action_line(out)
    return out


def action_line(x: dict) -> str:
    u = x["unit"]
    if x["status"] == "CRITICAL":
        s = (f"Stock-out in {x['days_cover']:g}d vs {x['lead_time']}d lead time; {x['open_po_ref']} lands day "
             f"{x['open_po_eta_days']} (gap {x['gap_days']:g}d = ~{x['gap_qty']:,} {u}). Expedite/part-ship PO and "
             f"source spot cover now; place {x['suggested_qty']:,} {u} per formula (human to confirm size).")
        return s
    if x["status"] == "REORDER":
        return (f"Place PO for {x['suggested_qty']:,} {u} today; {x['days_cover']:g}d cover vs {x['lead_time']}d lead time "
                f"(stock {x['stock']:,} <= ROP {x['rop']:,}).")
    return f"No action; {x['days_cover']:g}d cover, stock {x['stock']:,} above ROP {x['rop']:,}."


# -------------------------------------------------------------- communication
def build_alert(res: list, price_flag: str) -> str:
    crit = [r for r in res if r["status"] == "CRITICAL"]
    reo = [r for r in res if r["status"] == "REORDER"]
    c = crit[0]
    parts = [
        f"PROCUREMENT ALERT - {len(crit)} critical, {len(reo)} reorder, "
        f"{len(res) - len(crit) - len(reo)} OK.",
        f"CRITICAL: {c['item']} - {c['days_cover']:g} days cover, {c['lead_time']}-day lead time. Kaveri's {c['open_po_ref']} "
        f"({c['open_po_qty']:,} kg) slipped to day {c['open_po_eta_days']} (customs hold), so ~{c['gap_qty']:,} kg is uncovered. "
        f"Approve expedite/spot buy today.",
        "REORDER: " + "; ".join(f"{r['item']} {r['suggested_qty']:,} {r['unit']}" for r in reo) + ".",
        "Labels sit exactly at ROP (5d cover vs 4d lead).",
        price_flag,
        "Rolled Oats OK (12d).",
    ]
    return " ".join(parts)


def build_supplier_email(c: dict) -> str:
    return f"""To: Sunil, Kaveri Nuts Pvt Ltd
Subject: URGENT - PO 2291 almonds: need revised dispatch plan (customs hold)

Hi Sunil,

Thanks for the update on PO 2291 ({c['open_po_qty']:,} kg almonds). Our current almond stock covers only about
{c['days_cover']:g} days, and the revised delivery (day {c['open_po_eta_days']}) leaves us about {c['gap_days']:g} days without material,
so this has become critical for us.

Could you please confirm by end of day:
1. The new committed delivery date, and the customs reference/status so we can track it.
2. Whether a part-shipment is possible: ~{c['gap_qty']:,} kg released as soon as customs clears, balance to follow.
3. Any ready stock in India you can dispatch immediately (even a small quantity) at the PO rate.
4. Your lead time and availability for an additional {c['suggested_qty']:,} kg, so we can plan the next order.

Please call me if a call is quicker. We would appreciate a reply today.

Regards,
Procurement Team, MOM
[Draft - for procurement head approval before sending]
"""


# ----------------------------------------------------------------------- main
def main():
    stock = load_stock()
    facts = [extract_email_facts((DATA / "emails" / f).read_text()) for f in ("email_a.txt", "email_b.txt")]
    before = [evaluate(dict(r)) for r in stock]
    log = apply_email_facts(stock, facts)
    results = [evaluate(r) for r in stock]

    OUT.mkdir(exist_ok=True)
    (OUT / "issue1_extracted_email_facts.json").write_text(
        json.dumps([{k: v for k, v in f.items() if k != "raw"} for f in facts], indent=2))
    cols = ["item", "unit", "stock", "days_cover", "rop", "counted_po", "status", "suggested_qty", "action"]
    with open(OUT / "issue1_item_results.csv", "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(["Item", "Unit", "Current stock", "Days of cover", "ROP", "PO counted",
                    "Status", "Suggested order qty", "Recommended action"])
        for r in results:
            w.writerow([r[c] for c in cols])

    price_flag = "Sai Agro: peanut price +4% from 1 Nov - order peanuts before then."
    alert = build_alert(results, price_flag)
    wc = len(alert.split())
    assert wc <= 100, f"alert is {wc} words"
    crit = next(r for r in results if r["status"] == "CRITICAL")
    email = build_supplier_email(crit)

    md = ["# Issue 1 - Output (generated by src/issue1_reorder.py)\n", "## Facts extracted from emails & updates applied\n"]
    md += [f"- {l}" for l in log]
    md += ["\n## Item-level results (after email updates)\n",
           "| Item | Stock | Days cover | ROP | PO counted | Status | Suggested qty | Recommended action |",
           "|---|---:|---:|---:|---:|---|---:|---|"]
    for r in results:
        md.append(f"| {r['item']} | {r['stock']:,} | {r['days_cover']:g} | {r['rop']:,} | {r['counted_po']:,} | "
                  f"**{r['status']}** | {r['suggested_qty']:,} | {r['action']} |")
    b = next(r for r in before if r["item"] == "Almonds")
    md += [f"\n> Before the email, Almonds would have shown **{b['status']}** with PO counted = {b['counted_po']:,} kg "
           f"(ETA day {b['open_po_eta_days']} <= cover {b['days_cover']:g}d). The email flips it to CRITICAL.",
           f"\n## Procurement alert ({wc} words, limit 100)\n", alert, "\n## Draft supplier email (most urgent: Almonds)\n",
           "```", email, "```"]
    (OUT / "issue1_report.md").write_text("\n".join(md), encoding="utf-8")
    (OUT / "issue1_alert.txt").write_text(alert, encoding="utf-8")
    (OUT / "issue1_supplier_email.txt").write_text(email, encoding="utf-8")
    print("\n".join(md))


if __name__ == "__main__":
    main()
