# Prompt - invoice / vendor email -> structured fields (Issue 2)

LLM is useful here because invoices arrive in 5 different layouts (dates `24-Sep-2026`, `25/09/2026`, `26 Sep 26`; PO as `PO-2285` / `PO 2287`; qty as `x 20,000 nos`, `qty 30000`, `5000 kg x`). It extracts only.

**System:** You are an AP data-entry assistant. Extract the fields from the document. Return JSON only. Copy numbers exactly as printed; do not recompute, correct or round. Use null if absent. Normalise dates to ISO and PO numbers to `PO-####`. Also set `doc_type` ("invoice"|"email"), and flags `bank_change_requested`, `payment_pressure`, `references_earlier_invoice`.

**Schema**
```json
{ "doc_type":"", "vendor":"", "invoice_no":"", "invoice_date":"YYYY-MM-DD", "po_no":"PO-####",
  "item":"", "qty":0, "unit":"", "rate":0, "taxable":0, "gst_pct":0, "gst_amt":0, "total":0,
  "bank_change_requested":false, "new_account_suffix":null, "payment_pressure":false, "evidence":{"field":"quote"} }
```
**Guard-rails (code):** qty x rate = taxable, taxable + GST = total (else flag "does not foot"); PO must exist; vendor must equal PO vendor; invoice no. checked against a ledger of already-received/paid numbers; any bank-detail flag -> mandatory human + call-back. Output of `src/issue2_invoice_match.py` -> `outputs/issue2_extracted_fields.json` has this shape.
