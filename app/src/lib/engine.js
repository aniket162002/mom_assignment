// Deterministic engine. ALL maths, statuses and totals live here - never in the LLM.
// JS port of src/issue1_reorder.py and src/issue2_invoice_match.py (the Python is the tested reference).

export const inr = (x) => 'Rs ' + Number(x).toLocaleString('en-IN', { maximumFractionDigits: 2 })
export const num = (x) => Number(x).toLocaleString('en-IN')
const norm = (s) => s.replace(/\s+/g, ' ').trim()
const n = (s) => parseFloat(String(s).replace(/,/g, ''))

/* ============================ ISSUE 1 ============================ */

// Offline regex extractor (fallback + cross-check for the LLM). Same schema as the Gemini prompt.
export function regexEmailFacts(text) {
  const t = norm(text)
  const f = { supplier: null, po_ref: null, po_qty: null, eta_delay_days: null, new_absolute_eta_days: null,
    price_change_pct: null, price_effective: null, lead_time_changed: null, evidence_quote: '' }
  let m
  if ((m = t.match(/From:\s*(?:\w+,\s*)?(.+?)\s*\|/))) f.supplier = m[1].trim()
  if ((m = t.match(/\bPO[\s-]*(\d{4})/i))) f.po_ref = `PO-${m[1]}`
  if ((m = t.match(/\((\d[\d,]*)\s*kg\)/))) f.po_qty = n(m[1])
  if ((m = t.match(/(\d+)\s*days?\s*later/i))) { f.eta_delay_days = +m[1]; f.evidence_quote = (t.match(/[^.]*days? later[^.]*\./i) || [''])[0].trim() }
  if ((m = t.match(/(?:up|increase)\D{0,15}?(\d+(?:\.\d+)?)\s*%\s*from\s*(\d+\w*\s*\w+)/i))) {
    f.price_change_pct = +m[1]; f.price_effective = m[2]; f.evidence_quote = (t.match(/[^.]*%[^.]*\./) || [''])[0].trim()
  }
  if (/lead times? remain/i.test(t)) f.lead_time_changed = false
  return f
}

// Guard-rails applied to ANY extractor output (LLM or regex) before it may touch a number.
export function validateEmailFacts(facts, sourceText, stock) {
  const issues = []
  if (!facts || typeof facts !== 'object' || Array.isArray(facts)) return ['extraction is not a JSON object']
  if (facts.evidence_quote && !norm(sourceText).toLowerCase().includes(norm(facts.evidence_quote).toLowerCase()))
    issues.push('evidence quote not found verbatim in the email')
  if (facts.eta_delay_days != null) {
    if (!(facts.eta_delay_days >= 0 && facts.eta_delay_days <= 60)) issues.push('delay outside 0-60 days')
    const row = stock.find((r) => r.open_po_ref === facts.po_ref)
    if (!row) issues.push(`${facts.po_ref} is not an open PO in the stock sheet`)
    else if (facts.po_qty && facts.po_qty !== row.open_po_qty) issues.push(`email qty ${facts.po_qty} differs from sheet qty ${row.open_po_qty}`)
  }
  if (facts.price_change_pct != null && !(facts.price_change_pct > 0 && facts.price_change_pct < 50)) issues.push('price change outside 0-50%')
  return issues
}

export function applyFacts(stock, factsList) {
  const rows = stock.map((r) => ({ ...r }))
  const log = []
  for (const f of factsList) {
    if (f.eta_delay_days != null && f.po_ref) {
      const row = rows.find((r) => r.open_po_ref === f.po_ref)
      if (!row) { log.push({ type: 'warn', text: `${f.po_ref} not found in stock sheet - needs human review` }); continue }
      const old = row.open_po_eta_days
      row.open_po_eta_days = old + f.eta_delay_days // RELATIVE delay: old ETA + delay
      log.push({ type: 'change', text: `${row.item}: ${f.po_ref} ETA ${old}d -> ${row.open_po_eta_days}d (+${f.eta_delay_days}d, ${f.supplier})` })
    }
    if (f.price_change_pct != null)
      log.push({ type: 'flag', text: `${f.supplier}: price +${f.price_change_pct}% from ${f.price_effective}. Lead times unchanged -> no stock/ROP change; buy-ahead decision for procurement.` })
  }
  return { rows, log }
}

export function evaluate(r) {
  const cover = r.stock / r.usage
  const rop = r.usage * r.lead_time + r.safety
  const eta = r.open_po_eta_days
  const hasPO = r.open_po_qty > 0 && eta != null
  const counted = hasPO && eta <= cover ? r.open_po_qty : 0
  let status = 'OK'
  if (cover < r.lead_time && counted === 0) status = 'CRITICAL'
  else if (r.stock + counted <= rop) status = 'REORDER'
  const qty = status === 'OK' ? 0 : Math.max(0, r.usage * 14 + r.safety - (r.stock + r.open_po_qty))
  const gapDays = hasPO && counted === 0 ? Math.max(0, eta - cover) : 0
  const x = { ...r, cover: +cover.toFixed(2), rop, counted, status, qty, gapDays: +gapDays.toFixed(2), gapQty: Math.round(gapDays * r.usage) }
  x.action = actionLine(x)
  return x
}

function actionLine(x) {
  if (x.status === 'CRITICAL')
    return `Stock-out in ${x.cover}d vs ${x.lead_time}d lead time; ${x.open_po_ref} lands day ${x.open_po_eta_days} (gap ${x.gapDays}d = ~${num(x.gapQty)} ${x.unit}). Expedite / part-ship the PO and source spot cover now; formula qty ${num(x.qty)} ${x.unit} - human to confirm size.`
  if (x.status === 'REORDER')
    return `Place PO for ${num(x.qty)} ${x.unit} today; ${x.cover}d cover vs ${x.lead_time}d lead time (stock ${num(x.stock)} <= ROP ${num(x.rop)}).`
  return `No action; ${x.cover}d cover, stock ${num(x.stock)} above ROP ${num(x.rop)}.`
}

export function buildAlert(res, priceFlag) {
  const crit = res.filter((r) => r.status === 'CRITICAL')
  const reo = res.filter((r) => r.status === 'REORDER')
  const ok = res.length - crit.length - reo.length
  const c = crit[0]
  const parts = [`PROCUREMENT ALERT - ${crit.length} critical, ${reo.length} reorder, ${ok} OK.`]
  if (c) parts.push(`CRITICAL: ${c.item} - ${c.cover} days cover, ${c.lead_time}-day lead time. ${c.open_po_ref} (${num(c.open_po_qty)} ${c.unit}) now lands day ${c.open_po_eta_days}, so ~${num(c.gapQty)} ${c.unit} is uncovered. Approve expedite/spot buy today.`)
  if (reo.length) parts.push('REORDER: ' + reo.map((r) => `${r.item} ${num(r.qty)} ${r.unit}`).join('; ') + '.')
  const atRop = res.filter((r) => r.status === 'REORDER' && r.stock === r.rop)
  if (atRop.length) parts.push(`${atRop.map((r) => r.item).join(', ')} sit exactly at ROP.`)
  if (priceFlag) parts.push(priceFlag)
  parts.push(res.filter((r) => r.status === 'OK').map((r) => `${r.item} OK (${r.cover}d)`).join(', ') + '.')
  return parts.join(' ')
}

export const supplierFacts = (c) => ({
  supplier_contact: 'Sunil, Kaveri Nuts Pvt Ltd', po: c.open_po_ref, po_qty_kg: c.open_po_qty, days_of_cover: c.cover,
  revised_delivery_day: c.open_po_eta_days, gap_days: c.gapDays, uncovered_qty_kg: c.gapQty, extra_order_qty_kg: c.qty,
})

export function supplierEmail(c) {
  return {
    subject: `URGENT - ${c.open_po_ref} almonds: need revised dispatch plan (customs hold)`,
    body: `Hi Sunil,

Thanks for the update on ${c.open_po_ref} (${num(c.open_po_qty)} kg almonds). Our current almond stock covers only about ${c.cover} days, and the revised delivery (day ${c.open_po_eta_days}) leaves us about ${c.gapDays} days without material, so this has become critical for us.

Could you please confirm by end of day:
1. The new committed delivery date, and the customs reference/status so we can track it.
2. Whether a part-shipment is possible: ~${num(c.gapQty)} kg released as soon as customs clears, balance to follow.
3. Any ready stock in India you can dispatch immediately (even a small quantity) at the PO rate.
4. Your lead time and availability for an additional ${num(c.qty)} kg, so we can plan the next order.

We would appreciate a reply today.

Regards,
Procurement Team, MOM`,
  }
}

// Independent second opinion: if the LLM and the offline regex disagree on a key field, a human must look.
export function crossCheck(llm, rx, keys) {
  return keys.filter((k) => rx[k] != null && String(llm[k] ?? null) !== String(rx[k]))
    .map((k) => `LLM and offline extractor disagree on ${k}: LLM=${llm[k] ?? 'null'} vs regex=${rx[k]}`)
}
export const EMAIL_KEYS = ['po_ref', 'eta_delay_days', 'price_change_pct']
export const INVOICE_KEYS = ['invoice_no', 'po_no', 'qty', 'rate', 'taxable', 'total']

/* ============================ ISSUE 2 ============================ */

export const ITEMS = ['PET Jar 500g', 'Labels (MOM PB)', 'Roasted Peanuts', 'Rolled Oats']

function parseDate(t) {
  const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 }
  const re = /(\d{1,2})[-/ ](\d{1,2}|[A-Za-z]{3})[-/ ](\d{2,4})/g
  let m
  while ((m = re.exec(t))) {
    const mon = /^\d+$/.test(m[2]) ? +m[2] : MON[m[2].toLowerCase()]
    if (!mon || mon > 12) continue
    const y = m[3].length === 2 ? 2000 + +m[3] : +m[3]
    return `${y}-${String(mon).padStart(2, '0')}-${String(+m[1]).padStart(2, '0')}`
  }
  return null
}

export function regexInvoice(text, vendors) {
  const t = norm(text)
  const g = (re) => { const m = t.match(re); return m ? m[1] : null }
  const NUM = '([\\d,]+(?:\\.\\d+)?)'
  const d = { doc_type: /\(email\)/i.test(t) ? 'email' : 'invoice' }
  d.vendor = vendors.find((v) => t.toLowerCase().includes(v.toLowerCase())) || null
  d.invoice_no = g(/(?:Invoice No:?|Bill no\.?|INV|Invoice)\s+([A-Z]{2,5}[/-][A-Z0-9/-]+)/)
  d.invoice_date = parseDate(t)
  const po = g(/\bPO(?:\s*Ref:)?[\s-]*(\d{4})/i); d.po_no = po ? `PO-${po}` : null
  const q = g(new RegExp('qty\\s+' + NUM, 'i')) || g(new RegExp(NUM + '\\s*(?:kg|nos|pcs)\\b', 'i'))
  d.qty = q ? n(q) : null
  const r = g(new RegExp('rate\\s+' + NUM, 'i')) || g(new RegExp('@\\s*(?:Rs\\s*)?' + NUM, 'i')) || g(new RegExp('Rs\\s*' + NUM + '\\s*/\\s*kg', 'i'))
  d.rate = r ? n(r) : null
  const tx = g(new RegExp('taxable(?: value)?:?\\s*(?:Rs\\s*)?' + NUM, 'i')) || g(new RegExp('=\\s*' + NUM))
  d.taxable = tx ? n(tx) : null
  const gm = t.match(new RegExp('GST\\s*@?\\s*(\\d+)\\s*%:?\\s*(?:=\\s*)?(?:Rs\\s*)?' + NUM, 'i'))
  d.gst_pct = gm ? +gm[1] : null; d.gst_amt = gm ? n(gm[2]) : null
  const tot = [...t.matchAll(new RegExp('(?:Total:?|Invoice total|Net payable|total|for)\\s*(?:Rs\\s*)?' + NUM, 'gi'))]
  d.total = tot.length ? n(tot[tot.length - 1][1]) : null
  d.item = ITEMS.find((i) => t.toLowerCase().includes(i.toLowerCase())) || null
  d.bank_change_requested = /bank account (?:has )?changed|new account/i.test(t)
  d.new_account_suffix = g(/ending\s+(\d{3,6})/i)
  d.payment_pressure = /reminder|payment pending|urgent/i.test(t)
  d.unit = null
  d.evidence_quote = ''
  return d
}

// Cross-checks on extractor output: does the document foot, is it grounded in the source?
export function validateInvoice(d, sourceText) {
  const issues = []
  if (d.qty && d.rate && d.taxable && Math.abs(d.qty * d.rate - d.taxable) > 1) issues.push('qty x rate != taxable')
  if (d.taxable && d.gst_amt != null && d.gst_pct != null && Math.abs((d.taxable * d.gst_pct) / 100 - d.gst_amt) > 1) issues.push('GST amount != taxable x GST%')
  if (d.taxable && d.gst_amt != null && d.total && Math.abs(d.taxable + d.gst_amt - d.total) > 1) issues.push('total != taxable + GST')
  if (d.evidence_quote && !norm(sourceText).toLowerCase().includes(norm(d.evidence_quote).toLowerCase())) issues.push('evidence quote not verbatim in source')
  if (d.total && !norm(sourceText).replace(/,/g, '').includes(String(Math.round(d.total)))) issues.push('total not found in source text')
  return issues
}

export function matchInvoices(docs, pos) {
  const poMap = Object.fromEntries(pos.map((p) => [p.po_no, p]))
  const rows = [], seen = {}
  docs.forEach((d, idx) => {
    const po = poMap[d.po_no]
    const issues = [], flags = []
    let risk = 0, status = 'MATCHED', action = 'Release for payment.'
    const gst = 1 + (d.gst_pct || 0) / 100
    flags.push(...validateInvoice(d, d._text || ''))
    const dup = d.invoice_no in seen
    if (dup) {
      status = 'DUPLICATE - DO NOT PAY'
      issues.push(`Invoice no. ${d.invoice_no} already received as ${seen[d.invoice_no].label}; this is ${d.doc_type === 'email' ? 'an email reminder' : 'a repeat'}, not a new bill`)
      risk = d.total
      action = 'Block. Pay the original once only; no second payment.'
    } else seen[d.invoice_no] = { label: d.label }
    if (!po) { status = 'EXCEPTION - NO PO'; issues.push('PO not found'); action = 'Hold; ask buyer for a valid PO.' }
    else {
      if (d.vendor !== po.vendor) issues.push(`vendor ${d.vendor} != PO vendor ${po.vendor}`)
      if (d.item !== po.item) issues.push(`item ${d.item} != PO item ${po.item}`)
      if (!dup && d.rate != null && Math.abs(d.rate - po.po_rate) > 0.005) {
        const diff = (d.rate - po.po_rate) * d.qty * gst
        issues.push(`billed rate ${d.rate.toFixed(2)} vs PO rate ${po.po_rate.toFixed(2)} (+${(d.rate - po.po_rate).toFixed(2)}/unit x ${num(d.qty)} = ${inr(diff)} incl. GST overbilled)`)
        risk += diff; status = 'EXCEPTION - RATE MISMATCH'
        action = `Hold full invoice. Request credit note / corrected invoice at PO rate (payable ${inr(po.po_rate * d.qty * gst)}).`
      }
      if (!dup && d.qty > po.grn_qty) {
        const ex = d.qty - po.grn_qty, diff = ex * d.rate * gst
        issues.push(`billed qty ${num(d.qty)} > GRN ${num(po.grn_qty)} (${num(ex)} billed but not received = ${inr(diff)} incl. GST)`)
        risk += diff; status = 'EXCEPTION - QTY EXCEEDS GRN'
        action = `Hold. Ask vendor for revised invoice for ${num(po.grn_qty)} (payable ${inr(po.grn_qty * d.rate * gst)}) or proof of delivery of balance; Controller may part-pay the received value.`
      }
    }
    if (d.bank_change_requested) flags.push(`BANK-DETAIL CHANGE requested by email (new a/c ending ${d.new_account_suffix}) - unverified; possible payment fraud`)
    rows.push({ idx, doc: d.label, invoice: d.invoice_no, vendor: d.vendor, status, reason: [...issues, ...flags].join('; ') || '3-way match OK (PO no., rate, qty <= GRN)', risk: Math.round(risk * 100) / 100, action, total: d.total, dup, bank: d.bank_change_requested })
  })
  // first copy inherits the bank-change warning raised by its duplicate
  rows.filter((r) => r.dup && r.bank).forEach((r) => {
    const o = rows.find((x) => !x.dup && x.invoice === r.invoice)
    if (o && o.status === 'MATCHED') {
      o.reason += `; a bank-detail change request arrived with its duplicate (${r.doc}) - see that row`
      o.action = "Release ONCE, only to the bank account already on vendor master (ignore the 'new account' request)."
      o.bankWarn = true
    }
  })
  return rows
}

export function totals(rows) {
  const uniq = rows.filter((r) => !r.dup)
  const sum = (a) => a.reduce((s, r) => s + r.total, 0)
  const dup = sum(rows.filter((r) => r.dup))
  const submitted = sum(uniq)
  const safe = sum(uniq.filter((r) => r.status === 'MATCHED'))
  const hold = sum(uniq.filter((r) => r.status !== 'MATCHED'))
  const strict = sum(uniq.filter((r) => r.status === 'MATCHED' && !r.bankWarn))
  return { submitted, dup, gross: submitted + dup, safe, hold, strict, strictHold: submitted - strict, balanced: Math.abs(safe + hold - submitted) < 0.01 }
}

export const vendorQuery = (rows, pos) => {
  const r = rows.find((x) => x.status === 'EXCEPTION - QTY EXCEEDS GRN')
  return r && pos.find((p) => p.vendor === r.vendor)
}

export const controllerFacts = (rows, t) => ({
  safe_to_release: t.safe, on_hold: t.hold, duplicate_blocked: t.dup,
  exceptions: rows.filter((r) => r.status !== 'MATCHED').map((r) => ({ invoice: r.invoice, status: r.status, reason: r.reason, amount_at_risk: r.risk })),
})
