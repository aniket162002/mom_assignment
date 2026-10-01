import test from 'node:test'
import assert from 'node:assert/strict'
import { regexEmailFacts, applyFacts, evaluate, buildAlert, regexInvoice, matchInvoices, totals } from './engine.js'
import { STOCK, EMAILS, PO_GRN, DOCS } from './data.js'

test('Issue 1 matches hand-computed values', () => {
  const { rows } = applyFacts(STOCK, EMAILS.map((e) => regexEmailFacts(e.text)))
  const r = Object.fromEntries(rows.map(evaluate).map((x) => [x.item, x]))
  const exp = { 'Roasted Peanuts': [6, 4200, 'REORDER', 6000], Almonds: [6, 1950, 'CRITICAL', 150], 'Rolled Oats': [12, 2250, 'OK', 0], 'PET Jars 500g': [6.5, 15000, 'REORDER', 18000], 'Labels (MOM PB)': [5, 9000, 'REORDER', 18000] }
  for (const [k, [c, rop, s, q]] of Object.entries(exp)) assert.deepEqual([r[k].cover, r[k].rop, r[k].status, r[k].qty], [c, rop, s, q], k)
  assert.equal(r.Almonds.open_po_eta_days, 11)
  assert.ok(buildAlert(Object.values(r), 'x').split(/\s+/).length <= 100)
})

test('Issue 2 matches hand-computed values', () => {
  const vendors = PO_GRN.map((p) => p.vendor)
  const docs = DOCS.map((d) => ({ ...regexInvoice(d.text, vendors), label: d.label, _text: d.text }))
  const rows = matchInvoices(docs, PO_GRN)
  assert.deepEqual(rows.map((r) => r.status), ['MATCHED', 'EXCEPTION - RATE MISMATCH', 'EXCEPTION - QTY EXCEEDS GRN', 'MATCHED', 'DUPLICATE - DO NOT PAY'])
  assert.deepEqual(rows.map((r) => r.risk), [0, 5310, 19950, 0, 182700])
  const t = totals(rows)
  assert.deepEqual([t.submitted, t.safe, t.hold, t.dup], [1000640, 454100, 546540, 182700])
})
