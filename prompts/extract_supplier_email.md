# Prompt - supplier email -> facts (Issue 1)

Used where an LLM adds value: reading free-text supplier emails. It **only extracts**; it never calculates or decides.

**System:** You extract facts from supplier emails. Return JSON only, matching the schema. Use null if a fact is not stated. Do not infer, calculate or convert dates. Copy relative expressions as written.

**Schema**
```json
{ "supplier": "string|null", "po_ref": "PO-#### | null", "po_qty": "number|null",
  "eta_delay_days": "integer|null   // only if email says 'N days later/delayed' (a RELATIVE delay)",
  "new_absolute_eta": "string|null  // only if an actual date/day-count from today is stated",
  "price_change_pct": "number|null", "price_effective": "string|null",
  "lead_time_changed": "true|false|null", "evidence_quote": "exact sentence(s) the facts come from" }
```
**Guard-rails (in code, not in the prompt):** po_ref must exist in the stock sheet; qty must equal the sheet qty; delay must be 0-60 days; otherwise route to a human. `evidence_quote` must appear verbatim in the email (else reject the extraction).

**Expected output on the two sample emails** (also what `src/issue1_reorder.py` produces - see `outputs/issue1_extracted_email_facts.json`):
```json
{"supplier":"Kaveri Nuts Pvt Ltd","po_ref":"PO-2291","po_qty":1500,"eta_delay_days":6,"price_change_pct":null}
{"supplier":"Sai Agro Traders","po_ref":null,"eta_delay_days":null,"price_change_pct":4.0,"price_effective":"1st Nov","lead_time_changed":false}
```
Key trap: "6 days later than the date we had committed" is a **delay**, so ETA = 5 + 6 = **11**, not 6.

---
# Prompt - drafting alert & supplier email (optional LLM use)
The drafts in this repo are generated from templates filled with code-computed numbers. If an LLM is used for tone, pass it the computed table and instruct: "Use only the numbers provided. Do not change or add any figure. Alert <= 100 words." A post-check verifies every number in the draft appears in the computed table and the word count.
