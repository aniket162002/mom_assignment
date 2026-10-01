import { useMemo, useState } from 'react'
import { DOCS, PO_GRN } from '../lib/data.js'
import { matchInvoices, totals, crossCheck, INVOICE_KEYS, regexInvoice, validateInvoice, inr, num, vendorQuery } from '../lib/engine.js'
import { vendorQueryDraft, controllerNote } from '../lib/drafts.js'
import { llmExtract } from '../lib/api.js'
import { Card, Pill, Pipeline, ExtractCard, DraftPanel, Spinner } from './ui.jsx'

const vendors = PO_GRN.map((p) => p.vendor)
const KIND = { MATCHED: 'ok', 'DUPLICATE - DO NOT PAY': 'bad' }

export default function Issue2({ llmReady }) {
  const [docs, setDocs] = useState(DOCS)
  const [pos, setPos] = useState(PO_GRN)
  const [ext, setExt] = useState({})
  const [busy, setBusy] = useState(false)
  const [release, setRelease] = useState(false)

  async function run(mode) {
    setBusy(true); setExt({})
    await Promise.all(docs.map(async (d) => {
      let st
      if (mode === 'gemini') {
        try { const r = await llmExtract('invoice', d.text); st = { facts: r.data, source: 'gemini', ms: r.ms } }
        catch (e) { st = { facts: regexInvoice(d.text, vendors), source: 'regex', error: e.message } }
      } else st = { facts: regexInvoice(d.text, vendors), source: 'regex' }
      // ground vendor/item to the PO master (LLM may write a short name)
      const f = st.facts
      const v = vendors.find((x) => f.vendor && (x.toLowerCase() === f.vendor.toLowerCase() || x.toLowerCase().includes(f.vendor.toLowerCase()) || f.vendor.toLowerCase().includes(x.toLowerCase())))
      if (v) f.vendor = v
      st.issues = validateInvoice(f, d.text)
      if (st.source === 'gemini') st.issues.push(...crossCheck(f, regexInvoice(d.text, vendors), INVOICE_KEYS))
      setExt((p) => ({ ...p, [d.label]: st }))
    }))
    setBusy(false)
  }

  const ready = docs.every((d) => ext[d.label]?.facts)
  const extracted = ready ? docs.map((d) => ({ ...ext[d.label].facts, label: d.label, _text: d.text })) : []
  const rows = useMemo(() => (ready ? matchInvoices(extracted, pos) : []), [ext, pos, docs]) // eslint-disable-line
  const t = useMemo(() => (ready ? totals(rows) : null), [rows, ready])

  const setPo = (i, k, v) => setPos((s) => s.map((r, j) => (j === i ? { ...r, [k]: Number(v) } : r)))
  const vqPo = ready && vendorQuery(rows, pos)
  const vqInv = vqPo && extracted.find((d) => d.po_no === vqPo.po_no && d.doc_type !== 'email')

  return (
    <>
      <div className="hero">
        <h1>Invoice matching &amp; <em>exception report</em></h1>
        <p>Turns five messy invoices and vendor emails into structured data, matches them to PO and GRN, catches mismatches, duplicates and payment-fraud signals — and tells finance what is safe to release.</p>
      </div>
      <Pipeline steps={[
        { kind: 'llm', title: 'Gemini extracts fields', text: '5 different layouts → one JSON schema.' },
        { kind: 'code', title: 'Code cross-checks', text: 'qty × rate, GST, total foot; quote is verbatim.' },
        { kind: 'code', title: 'Matching engine', text: 'PO · rate = PO rate · qty ≤ GRN · no duplicate.' },
        { kind: 'human', title: 'Controller releases', text: 'Money and bank changes need a person.' },
      ]} />

      <Card title="1 · Purchase orders & GRN" sub="editable" right={<span className="row">
        <button className="btn primary" disabled={busy || !llmReady} onClick={() => run('gemini')}>{busy ? <Spinner /> : '✨ Extract with Gemini'}</button>
        <button className="btn" disabled={busy} onClick={() => run('regex')}>Offline regex</button>
        <button className="btn" onClick={() => { setDocs(DOCS); setPos(PO_GRN); setExt({}); setRelease(false) }}>Reset</button></span>}>
        <div className="tw">
          <table>
            <thead><tr><th>PO No</th><th>Vendor</th><th>Item</th><th className="r">PO qty</th><th className="r">PO rate (Rs)</th><th className="r">GRN qty</th></tr></thead>
            <tbody>{pos.map((p, i) => (
              <tr key={p.po_no}><td><b>{p.po_no}</b></td><td>{p.vendor}</td><td>{p.item}</td>
                <td className="r">{num(p.po_qty)} {p.unit}</td>
                <td className="r"><input className="cell" value={p.po_rate} onChange={(e) => setPo(i, 'po_rate', e.target.value)} /></td>
                <td className="r"><input className="cell" value={p.grn_qty} onChange={(e) => setPo(i, 'grn_qty', e.target.value)} /></td></tr>))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="2 · Finance inbox — 5 documents" sub="edit text to test other layouts">
        <div className="grid2">
          {docs.map((d, i) => (
            <ExtractCard key={d.label} label={d.label} text={d.text} state={ext[d.label]} rows={5}
              onText={(v) => setDocs((s) => s.map((x, j) => (j === i ? { ...x, text: v } : x)))} />
          ))}
        </div>
        {!ready && <div className="note">Click <b>Extract with Gemini</b> to read all five documents and build the exception report.</div>}
      </Card>

      {ready && t && (
        <>
          <div className="kpis">
            <div className="kpi"><label>Total submitted</label><div>{inr(t.submitted)}</div><small>{extracted.length - rows.filter((r) => r.dup).length} unique invoices · {inr(t.gross)} across {extracted.length} documents</small></div>
            <div className="kpi ok"><label>Safe to release now</label><div>{inr(t.safe)}</div><small>matched · bank a/c on master only</small></div>
            <div className="kpi bad"><label>On hold</label><div>{inr(t.hold)}</div><small>exceptions awaiting vendor</small></div>
            <div className="kpi warn"><label>Duplicate blocked</label><div>{inr(t.dup)}</div><small>never payable twice</small></div>
          </div>
          {!t.balanced && <div className="note bad">Totals do not reconcile — investigate before any payment.</div>}

          <Card title="3 · Exception report" sub="Invoice · Vendor · Status · Reason · Amount at risk · Recommended action">
            <div className="tw">
              <table>
                <thead><tr><th>Invoice</th><th>Vendor</th><th>Status</th><th>Reason</th><th className="r">Amount at risk (Rs)</th><th>Recommended action</th></tr></thead>
                <tbody>{rows.map((r) => (
                  <tr key={r.idx}>
                    <td><b>{r.invoice}</b>{r.dup && <div className="muted">{r.doc}</div>}</td><td>{r.vendor}</td>
                    <td><Pill kind={KIND[r.status] || 'warn'}>{r.status}</Pill></td>
                    <td style={{ minWidth: 280 }}>{r.reason}</td>
                    <td className="r"><b>{r.risk ? num(r.risk) : '0'}</b></td>
                    <td style={{ minWidth: 240 }}>{r.action}</td>
                  </tr>))}
                </tbody>
              </table>
            </div>
            <div className="note bad"><b>Fraud signal:</b> {rows.some((r) => r.dup && r.bank) ? 'a duplicate "payment pending" email also asks us to pay a NEW bank account. Treated as unverified — pay only to the account on vendor master, verify by call-back.' : 'none detected.'}</div>
            <label className="chk"><input type="checkbox" checked={release} onChange={(e) => setRelease(e.target.checked)} />
              Finance Controller approves releasing {inr(t.safe)} (matched invoices only, existing bank accounts)</label>
            {release && <div className="note" style={{ marginTop: 10 }}>Payment batch approved by a human — the app itself never initiates payment.</div>}
            <div className="note warn">Stricter option: if the Controller also holds GOM/1207 until the bank-change request is cleared → release {inr(t.strict)}, hold {inr(t.strictHold)}.</div>
          </Card>

          {vqPo && vqInv && <DraftPanel title={`4 · Draft query to vendor — ${vqPo.vendor}`} template={vendorQueryDraft(vqPo, rows, vqInv)} llmReady={llmReady}
            facts={{ vendor: vqPo.vendor, invoice: vqInv.invoice_no, po: vqPo.po_no, billed_qty: vqInv.qty, grn_qty: vqPo.grn_qty, rate: vqInv.rate, invoice_total: vqInv.total }}
            instruction="Rewrite this vendor query email to be polite and clear, under 160 words. Keep both options (revised invoice or proof of delivery)." approveLabel="Finance Controller approves this vendor query" />}

          <DraftPanel title="5 · Internal note to Finance Controller" template={controllerNote(rows, t)} llmReady={llmReady}
            facts={{ safe: t.safe, on_hold: t.hold, duplicate: t.dup, concerns: rows.filter((r) => r.status !== 'MATCHED' || r.bankWarn).map((r) => ({ invoice: r.invoice, reason: r.reason })) }}
            instruction="Rewrite as a short internal note to the Finance Controller, most serious risk first (payment fraud via bank-detail change). Under 250 words. Use only given figures."
            approveLabel="Note reviewed" />
        </>
      )}
    </>
  )
}
