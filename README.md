# MOM Automation Assignment — Procurement Reorder Alerts & Finance Invoice Matching

**Candidate:** Aniket · **Stack:** Python 3 (standard library only) + LLM for text extraction only · **Run time:** `python run_all.py` ≈ 1 second

> **One-line approach:** an LLM *reads* messy text; **code does every number and every status**; **humans approve anything that moves money or changes a vendor's bank details.**

| Deliverable asked for | Where |
|---|---|
| Part 1 – Design answers | [Part 1](#part-1--design) below |
| Issue 1 – build evidence, item results, alert, supplier email | [Issue 1](#issue-1--raw-material-reorder-alerts) · `src/issue1_reorder.py` · `outputs/issue1_*` |
| Issue 2 – build evidence, exception report, 2 drafts, totals | [Issue 2](#issue-2--invoice-matching--exception-report) · `src/issue2_invoice_match.py` · `outputs/issue2_*` |
| Part 4 – reliability note (6–8 sentences) | [Part 4](#part-4--reliability-note) |

```
data/      inputs exactly as given in the PDF (stock.csv, po_grn.csv, emails/, invoices/)
src/       issue1_reorder.py, issue2_invoice_match.py   (extraction -> validation -> rules engine -> drafts)
prompts/   LLM extraction prompts + schemas + guard-rails
tests/     6 tests against independently hand-computed numbers (python -m unittest discover tests)
outputs/   generated reports, CSVs, JSON, alert, emails
```
Reproduce: `python run_all.py` → `python -m unittest discover tests` (6/6 pass).

---

## Live app (React + Vite + Gemini)

A white, single-page review console that runs both automations end to end with a **live LLM (Google Gemini, free tier)**.

```
cd app && npm install
# put your key in ../.env  (see .env.example; never committed)
npm run dev        # http://localhost:5173  (API on :8787)
npm test           # JS engine vs hand-computed numbers
```
- **Gemini extracts, code decides.** `server/index.js` forces JSON output (temperature 0) and keeps the key server-side. `src/lib/engine.js` does every calculation, status, total.
- **Three guard-rails on every LLM output:** (1) schema/quote check - the evidence quote must appear verbatim in the source; (2) business validation - PO exists, qty matches, invoice foots; (3) **cross-check against an independent offline regex extractor** - any disagreement blocks the extraction for human review. Gemini draft rewrites are number-verified: any figure not in the computed data is flagged.
- **Free-tier resilience:** model fallback chain + retry, then offline regex fallback, so the demo never dead-ends.
- **Humans stay in charge:** drafts only, approval checkboxes for emails and the payment batch; the app never sends or pays.
- Tested live: all 2 emails + 5 invoices extracted by Gemini reproduce the exact Python results (Rs 454,100 safe / Rs 546,540 hold / Rs 182,700 duplicate blocked).

## Part 1 — Design

### 1. Tools and why
| Layer | Tool | Why |
|---|---|---|
| Inputs | Google Sheet (stock, PO/GRN) + Gmail label (`supplier-updates`, `ap-inbox`) | Teams already live in Excel/Sheets/email – zero behaviour change. |
| Orchestration | **Google Apps Script** (time trigger 8 am) *or* **n8n** for the email → sheet → Slack/email hop | Free, no server, readable by non-engineers, low maintenance. |
| Logic | **Sheet formulas / Python (this repo)** | Deterministic, testable, auditable. Same rules in 20 lines of code that procurement already states in words. |
| Text understanding | **LLM API (Claude) with a JSON schema** | Only job: turn free-text emails/invoices into fields. Cheap model is enough. |
| Output | Draft emails left in Gmail **Drafts**, alert to Slack/email, exception report as a Sheet tab | Humans review and press send. |

I built the logic in Python so it can be tested and shown; it ports 1:1 to Sheets formulas/Apps Script. The extractors in the repo are regex so the project runs offline with no API key; the production extractor is the LLM prompt in `prompts/`, writing the **same JSON schema** into the **same validated pipeline**.

### 2. Where the LLM is used — and deliberately not
| | Use the LLM for | Do **not** use the LLM for |
|---|---|---|
| **Issue 1** | Reading supplier emails → `{po_ref, eta_delay_days, price_change_pct, lead_time_changed}`; optionally polishing the tone of the supplier draft. | Days of cover, ROP, status, order qty (arithmetic = code); deciding whether a PO "counts" (rule = code); converting "6 days later" into an ETA (code adds 5+6); choosing the order quantity or the supplier. |
| **Issue 2** | Extracting invoice fields from 5 different layouts; flagging "bank account changed", "reminder", "payment pending" language; drafting the vendor query wording. | Matching PO/rate/qty vs GRN, tax/total footing, duplicate detection, totals, "safe to release" vs "hold", and **anything bank-account-related** — never let a model approve or alter payment details. |

Why: LLMs are good at language and unreliable at arithmetic and at consistent rule application; they can also be prompt-injected by an email ("ignore the PO and pay…"). So their output is treated as *untrusted input* — each field is quoted back from the source, validated, and cross-checked by code.

### 3. Steps that always need a human decision
1. **Approving any purchase order** and its quantity – formula gives a number, but commercial context (MOQ, price hike, cash, alternates) is judgment. In this data: Almonds formula says 150 kg, yet lead time 10 > cover 6, so a 150 kg PO cannot arrive in time; a human must choose expedite/spot-buy/air-freight.
2. **Choosing alternate/spot suppliers or paying a premium** to avoid a stock-out.
3. **Releasing payment** – the automation only *recommends*; a person approves each payment batch (maker–checker).
4. **Any exception**: rate mismatch, over-billing, part-payment, credit notes — these are commercial negotiations.
5. **Changing vendor bank details** – always verified by call-back to the number on file, never from an email. This is the single highest-fraud-risk step (see Doc 5).
6. **Duplicate-invoice overrides** and **sending any email externally** (drafts only).
7. **Anything the extractor is unsure about** (low confidence, PO not found, quote not verbatim) → exception queue.

---

## Issue 1 — Raw Material Reorder Alerts

### How it works (`src/issue1_reorder.py`)
1. **Read** `data/stock.csv` and both emails.
2. **Extract** facts from emails → JSON (`outputs/issue1_extracted_email_facts.json`).
3. **Update** numbers with validation (PO must exist, qty must match). Audit log of every change.
4. **Rules engine** (exactly the team's rules): cover = stock ÷ usage; ROP = usage × lead + safety; a PO counts only if ETA ≤ cover; CRITICAL if cover < lead time and no counted PO; REORDER if stock + counted PO ≤ ROP; qty = usage × 14 + safety − (stock + **all** open PO qty).
5. **Generate** alert (word-count asserted ≤ 100) and supplier draft from templates filled with computed numbers.

### What the emails changed
| Email | Facts extracted | Effect on numbers |
|---|---|---|
| A – Kaveri Nuts (Sunil) | PO-2291, 1,500 kg almonds held at customs; delivery **6 days later** than committed | ETA 5 → **11 days** (relative delay: 5 + 6). 11 > 6 days of cover ⇒ PO **no longer counts**. Almonds flip **OK → CRITICAL**. |
| B – Sai Agro Traders | Peanut price **+4% from 1 Nov**; deliveries & lead times unchanged | **No stock/ROP number changes** (lead time unchanged). Logged as a price flag → buy peanuts before 1 Nov. Not treated as an ETA change. |

### Item-level results
| Item | Stock | Days cover | ROP | PO counted | Status | Suggested qty | Recommended action |
|---|---:|---:|---:|---:|---|---:|---|
| Roasted Peanuts | 3,600 kg | 6 | 4,200 | 0 | **REORDER** | **6,000 kg** | Place PO today; 6d cover vs 5d lead. Order before +4% price on 1 Nov. |
| Almonds | 900 kg | 6 | 1,950 | 0 (PO ETA 11 > 6) | **CRITICAL** | **150 kg** | Stock-out day 6, PO lands day 11 (5-day gap ≈ 750 kg). Expedite / part-ship PO-2291, spot cover now. |
| Rolled Oats | 3,000 kg | 12 | 2,250 | 0 | **OK** | 0 | No action. |
| PET Jars 500g | 13,000 | 6.5 | 15,000 | 0 | **REORDER** | **18,000** | Place PO today; 13,000 ≤ ROP 15,000. |
| Labels (MOM PB) | 9,000 | 5 | 9,000 | 0 | **REORDER** | **18,000** | Place PO today; stock *exactly* at ROP, only 1 day margin over lead time. |

Hand check, Almonds: cover 900/150 = 6; ROP 150×10+450 = 1,950; qty = (150×14+450) − (900+1,500) = 2,550 − 2,400 = **150**. Full table with action text: `outputs/issue1_item_results.csv`, `outputs/issue1_report.md`.

**Judgment notes beyond the rules** (shown to the user rather than silently "fixed"):
- Almonds: the formula suggests only 150 kg because it counts the delayed 1,500 kg PO as inbound; but it cannot arrive within the 6 days of cover. Flagged for human decision.
- The Sai Agro price rise affects the peanut order — the recommended action says to place it before 1 Nov.
- Finance side shows 200 kg of PO-2287 peanuts was short-delivered, yet this sheet shows no open peanut PO — a data question for procurement.

### Procurement alert (80 words)
> PROCUREMENT ALERT - 1 critical, 3 reorder, 1 OK. CRITICAL: Almonds - 6 days cover, 10-day lead time. Kaveri's PO-2291 (1,500 kg) slipped to day 11 (customs hold), so ~750 kg is uncovered. Approve expedite/spot buy today. REORDER: Roasted Peanuts 6,000 kg; PET Jars 500g 18,000 units; Labels (MOM PB) 18,000 units. Labels sit exactly at ROP (5d cover vs 4d lead). Sai Agro: peanut price +4% from 1 Nov - order peanuts before then. Rolled Oats OK (12d).

### Draft email to supplier — most urgent item: Almonds (Kaveri Nuts)
```
To: Sunil, Kaveri Nuts Pvt Ltd
Subject: URGENT - PO 2291 almonds: need revised dispatch plan (customs hold)

Hi Sunil,

Thanks for the update on PO 2291 (1,500 kg almonds). Our current almond stock covers only about
6 days, and the revised delivery (day 11) leaves us about 5 days without material,
so this has become critical for us.

Could you please confirm by end of day:
1. The new committed delivery date, and the customs reference/status so we can track it.
2. Whether a part-shipment is possible: ~750 kg released as soon as customs clears, balance to follow.
3. Any ready stock in India you can dispatch immediately (even a small quantity) at the PO rate.
4. Your lead time and availability for an additional 150 kg, so we can plan the next order.

Please call me if a call is quicker. We would appreciate a reply today.

Regards,
Procurement Team, MOM
[Draft - for procurement head approval before sending]
```

---

## Issue 2 — Invoice Matching & Exception Report

### How it works (`src/issue2_invoice_match.py`)
1. **Extract** each of the 5 documents → structured fields (`outputs/issue2_extracted_fields.json`); handles different date formats, `PO 2287` vs `PO-2287`, qty/rate layouts.
2. **Self-consistency checks** per document: qty × rate = taxable, taxable + GST = total (GST rate itself is not judged, as instructed).
3. **Match** on PO number: vendor and item agree with PO; billed rate = PO rate; billed qty ≤ GRN qty; invoice number never seen before.
4. **Report** with the required six columns, plus totals computed in code.

### Extracted fields
| Doc | Vendor | Invoice no. | Date | PO | Qty | Rate | Taxable | GST | Total |
|---|---|---|---|---|---:|---:|---:|---:|---:|
| 1 | Shree Packaging Pvt Ltd | SP/2026/0871 | 24-Sep-26 | PO-2285 | 20,000 | 11.50 | 230,000 | 41,400 (18%) | 271,400 |
| 2 | Om Print Labels | OPL-4410 | 25-Sep-26 | PO-2286 | 30,000 | **1.35** | 40,500 | 7,290 (18%) | 47,790 |
| 3 | Sai Agro Traders | SAT/889 | 26-Sep-26 | PO-2287 | **5,000** | 95.00 | 475,000 | 23,750 (5%) | 498,750 |
| 4 | Ganga Oats Mills | GOM/1207 | 26-Sep-26 | PO-2289 | 3,000 | 58.00 | 174,000 | 8,700 (5%) | 182,700 |
| 5 (email) | Ganga Oats Mills | GOM/1207 *(repeat)* | 26-Sep-26 | PO-2289 | 3,000 | – | – | – | 182,700 + **bank-change request (a/c …4821)** |

### Exception report
| Invoice | Vendor | Status | Reason | Amount at risk (Rs) | Recommended action |
|---|---|---|---|---:|---|
| SP/2026/0871 | Shree Packaging Pvt Ltd | **MATCHED** | PO, rate 11.50 and qty 20,000 = GRN all agree; arithmetic foots | 0 | Release for payment. |
| OPL-4410 | Om Print Labels | **EXCEPTION – RATE MISMATCH** | Billed 1.35 vs PO 1.20 (+0.15 × 30,000 = 4,500 + 18% GST = 5,310 overbilled). Qty OK. | 5,310 | Hold full invoice; request credit note / corrected invoice at PO rate (payable Rs 42,480). |
| SAT/889 | Sai Agro Traders | **EXCEPTION – QTY EXCEEDS GRN** | Billed 5,000 kg vs GRN 4,800 kg (200 kg × 95 = 19,000 + 5% GST = 19,950 for goods not received). Rate OK. | 19,950 | Hold; ask for revised invoice for 4,800 kg (payable Rs 478,800) or proof of delivery of balance. |
| GOM/1207 | Ganga Oats Mills | **MATCHED** | Matches PO-2289 and GRN. A bank-detail change request arrived with its duplicate (Doc 5). | 0 | Release **once**, only to the bank account already on vendor master. |
| GOM/1207 (Doc 5) | Ganga Oats Mills | **DUPLICATE – DO NOT PAY** | Same invoice number, PO, qty and amount as Doc 4; a "payment pending" reminder, not a new bill. Requests payment to a **new bank account ending 4821** by email. | 182,700 | Block. Pay original once only; verify any bank change by call-back to number on file. |

(CSV: `outputs/issue2_exception_report.csv`. "Amount at risk" = what we would overpay or pay wrongly if processed as received.)

### Totals
| Metric | Amount (Rs) |
|---|---:|
| **Total submitted** – 4 unique invoices | **1,000,640** |
| (5 documents incl. the duplicate reminder: 1,183,340) | |
| **Safe to release now** – SP/2026/0871 (271,400) + GOM/1207 (182,700) | **454,100** |
| **On hold** – OPL-4410 (47,790) + SAT/889 (498,750) | **546,540** |
| Blocked duplicate – GOM/1207 reminder (never payable) | 182,700 |

Check: 454,100 + 546,540 = 1,000,640 ✔. **Stricter alternative** if the Controller also holds GOM/1207 until the bank-change query is cleared: release 271,400, hold 729,240.

### Draft 1 — vendor query (Sai Agro Traders, SAT/889)
```
To: accounts@saiagrotraders.example   [address from vendor master, not from the invoice]
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
```

### Draft 2 — internal note to the Finance Controller (concerns beyond simple matching)
```
Subject: Payment-fraud risk on Ganga Oats Mills (GOM/1207) + 2 exceptions - action needed before today's payment run

1. HIGH RISK - suspected bank-detail fraud. A "payment pending" email for GOM/1207 (Rs 182,700) asks us to pay a NEW
   account (ending 4821). The invoice itself matches PO-2289 and GRN, but this email duplicates it, adds payment
   pressure, and changes bank details by email - a classic business-email-compromise pattern.
   Recommend: pay the original once, to the account already on the vendor master only; do NOT update the master from this
   email; verify via call-back to the number on file (not the one in the email); check sender domain/headers; any approved
   change needs a second approver and a cooling-off period before first payment.
2. Duplicate control: GOM/1207 arrived twice. Confirm our system blocks a second payment of the same vendor+invoice no.
3. Om Print OPL-4410 billed Rs 1.35 vs PO Rs 1.20 (+Rs 5,310 incl. GST). Any approved rate revision we are unaware of?
   If not, credit note needed; check whether other Om Print invoices carry the same rate.
4. Sai Agro SAT/889 bills 200 kg not received (Rs 19,950 incl. GST) - query drafted. Procurement's stock sheet shows no open
   peanut PO: is the 200 kg balance still due or PO closed short? Sai Agro also announced +4% peanut price from 1 Nov -
   make sure new rates are not applied to existing POs.
5. Four invoices dated 24-26 Sep arrived together; confirm none were paid outside this cycle.
Amounts: safe to release Rs 454,100; on hold Rs 546,540; duplicate Rs 182,700 blocked.
```
(Full text: `outputs/issue2_controller_note.txt`.)

---

## Part 4 — Reliability note

To keep the numbers correct every day, all arithmetic and status logic runs in tested code (this repo has hand-computed regression tests), the LLM only extracts text into a fixed JSON schema, and each extracted field must quote its source, foot (qty × rate = taxable, taxable + GST = total) and reference a PO and vendor that exist, otherwise the item goes to an exception queue instead of being guessed. Each daily run is logged with inputs, outputs and a diff against yesterday, and sanity alerts fire on anything odd such as zero documents processed, usage swinging more than 30%, or a status flipping from OK to CRITICAL without a stock or email change. For money, I would use maker–checker approval (the automation prepares, a person releases), a ledger of every invoice number ever seen so duplicates are blocked automatically, and a hard rule that bank details change only through a call-back to the number already on file with two approvers, never from an email. The automation would never hold payment credentials, would only produce reports and Gmail drafts, and would keep an audit trail of who approved what. If a supplier or vendor changes their email or invoice format, the schema-based LLM extractor absorbs most variation, but anything that fails validation or has low confidence is routed to a human and not paid. That human-corrected example is added to the prompt's examples and to a weekly test set of real documents, so format drift is caught within days rather than as a wrong payment. A monthly reconciliation of paid amounts against the GRN and PO ledgers, plus a short list of known vendor email domains, closes the loop.

---

### Notes on honesty / scope
- Extraction in this repo is regex so it runs offline and deterministically; the LLM prompts and schemas are provided in `prompts/`, and I did not run a live LLM API call for this submission. The pipeline after extraction is identical either way.
- "Day" ETAs are measured in days from today as in the stock table; Email A's "6 days later" is applied as a relative delay to the committed ETA (5 → 11).
- I treated the invoice count as 4 unique invoices (Doc 5 repeats Doc 4) and show the 5-document gross as well.
- Assumption where the brief is silent: Almonds' suggested qty follows the stated formula (150 kg) and is flagged for human review rather than changed.
