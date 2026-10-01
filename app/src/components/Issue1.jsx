import { useMemo, useState } from 'react'
import { STOCK, EMAILS } from '../lib/data.js'
import { applyFacts, evaluate, crossCheck, EMAIL_KEYS, buildAlert, regexEmailFacts, validateEmailFacts, supplierEmail, supplierFacts, num } from '../lib/engine.js'
import { llmExtract } from '../lib/api.js'
import { Card, Pill, Pipeline, ExtractCard, DraftPanel, CopyBtn, Spinner } from './ui.jsx'

const NUMERIC = ['stock', 'usage', 'lead_time', 'safety', 'open_po_qty', 'open_po_eta_days']

export default function Issue1({ llmReady }) {
  const [stock, setStock] = useState(STOCK)
  const [emails, setEmails] = useState(EMAILS)
  const [ext, setExt] = useState({})
  const [busy, setBusy] = useState(false)

  const factsList = emails.map((e) => ext[e.id]?.facts).filter(Boolean)
  const accepted = emails.map((e) => ext[e.id]).filter((s) => s?.facts && s.issues.length === 0).map((s) => s.facts)
  const before = useMemo(() => stock.map(evaluate), [stock])
  const { rows: updated, log } = useMemo(() => applyFacts(stock, accepted), [stock, ext]) // eslint-disable-line
  const after = useMemo(() => updated.map(evaluate), [updated])

  const priceFlag = (() => {
    const p = accepted.find((f) => f.price_change_pct != null)
    return p ? `${p.supplier}: price +${p.price_change_pct}% from ${p.price_effective} - order before then.` : ''
  })()
  const alert = buildAlert(after, priceFlag)
  const words = alert.split(/\s+/).length
  const crit = after.find((r) => r.status === 'CRITICAL') || [...after].sort((a, b) => a.cover - b.cover)[0]
  const draft = supplierEmail(crit)

  async function run(mode) {
    setBusy(true)
    setExt({})
    await Promise.all(emails.map(async (e) => {
      let state
      if (mode === 'gemini') {
        try {
          const r = await llmExtract('supplier_email', e.text)
          state = { facts: r.data, source: 'gemini', ms: r.ms }
        } catch (err) {
          state = { facts: regexEmailFacts(e.text), source: 'regex', error: err.message }
        }
      } else state = { facts: regexEmailFacts(e.text), source: 'regex' }
      state.issues = validateEmailFacts(state.facts, e.text, stock)
      if (state.source === 'gemini' && state.issues.length === 0) state.issues.push(...crossCheck(state.facts, regexEmailFacts(e.text), EMAIL_KEYS))
      setExt((p) => ({ ...p, [e.id]: state }))
    }))
    setBusy(false)
  }

  const setCell = (i, k, v) => setStock((s) => s.map((r, j) => (j === i ? { ...r, [k]: v === '' ? null : Number(v) } : r)))
  const almondsB = before.find((r) => r.open_po_ref === 'PO-2291')
  const almondsA = after.find((r) => r.open_po_ref === 'PO-2291')
  const changed = almondsB && almondsA && almondsB.status !== almondsA.status

  return (
    <>
      <div className="hero">
        <h1>Raw-material <em>reorder alerts</em></h1>
        <p>Reads today's stock table and supplier emails, extracts the facts, updates the numbers and tells procurement what to order — with every figure computed in code.</p>
      </div>
      <Pipeline steps={[
        { kind: 'llm', title: 'Gemini reads the emails', text: 'Free text → JSON facts only. No maths.' },
        { kind: 'code', title: 'Code validates', text: 'PO exists, qty matches, quote is verbatim.' },
        { kind: 'code', title: 'Rules engine calculates', text: 'Cover, ROP, status, order qty — exact team rules.' },
        { kind: 'human', title: 'Human approves', text: 'Procurement head approves every PO and email.' },
      ]} />

      <Card title="1 · Inputs" sub="edit any cell or email — everything recalculates" right={
        <span className="row">
          <button className="btn primary" disabled={busy || !llmReady} onClick={() => run('gemini')}>{busy ? <Spinner /> : '✨ Extract with Gemini'}</button>
          <button className="btn" disabled={busy} onClick={() => run('regex')}>Offline regex</button>
          <button className="btn" onClick={() => { setStock(STOCK); setEmails(EMAILS); setExt({}) }}>Reset</button>
        </span>}>
        <div className="tw">
          <table>
            <thead><tr><th>Item</th><th>Unit</th><th className="r">Stock</th><th className="r">Avg daily usage</th><th className="r">Lead time (d)</th><th className="r">Safety stock</th><th className="r">Open PO qty</th><th>PO</th><th className="r">PO ETA (d)</th></tr></thead>
            <tbody>
              {stock.map((r, i) => (
                <tr key={r.item}>
                  <td><b>{r.item}</b></td><td className="muted">{r.unit}</td>
                  {NUMERIC.map((k) => <td key={k} className="r"><input className="cell" value={r[k] ?? ''} onChange={(e) => setCell(i, k, e.target.value)} /></td>)}
                  <td className="muted">{r.open_po_ref || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="grid2" style={{ marginTop: 18 }}>
          {emails.map((e, i) => (
            <ExtractCard key={e.id} label={`Supplier email ${e.id}`} text={e.text} state={ext[e.id]} rows={6}
              onText={(v) => setEmails((s) => s.map((x, j) => (j === i ? { ...x, text: v } : x)))} />
          ))}
        </div>
        {!Object.keys(ext).length && <div className="note">Click <b>Extract with Gemini</b> to read the two emails. Until then the table below shows the position <i>before</i> email updates.</div>}
      </Card>

      {(log.length > 0 || factsList.length > 0) && (
        <Card title="2 · What the emails changed" sub="audit log — every update is traceable">
          <ul className="log">
            {log.map((l, i) => <li key={i}>{l.type === 'change' ? <Pill kind="warn">UPDATE</Pill> : <Pill kind="info">FLAG</Pill>} {l.text}</li>)}
            {factsList.length > accepted.length && <li><Pill kind="bad">REJECTED</Pill> an extraction failed validation and was NOT applied — needs human review.</li>}
          </ul>
          {changed && <div className="note warn"><b>{almondsB.item}</b> flipped <Pill kind={almondsB.status}>{almondsB.status}</Pill> → <Pill kind={almondsA.status}>{almondsA.status}</Pill>. The PO's ETA moved from day {almondsB.open_po_eta_days} to day {almondsA.open_po_eta_days}, past the {almondsA.cover} days of cover, so it no longer counts as available stock.</div>}
        </Card>
      )}

      <Card title="3 · Item-level results" sub="days of cover · ROP · status · suggested qty · action">
        <div className="tw">
          <table>
            <thead><tr><th>Item</th><th className="r">Stock</th><th className="r">Days of cover</th><th className="r">ROP</th><th className="r">PO counted</th><th>Status</th><th className="r">Suggested qty</th><th>Recommended action</th></tr></thead>
            <tbody>
              {after.map((r) => (
                <tr key={r.item}>
                  <td><b>{r.item}</b></td>
                  <td className="r">{num(r.stock)}</td><td className="r">{r.cover}</td><td className="r">{num(r.rop)}</td><td className="r">{num(r.counted)}</td>
                  <td><Pill kind={r.status}>{r.status}</Pill></td>
                  <td className="r"><b>{r.status === 'OK' ? '—' : `${num(r.qty)} ${r.unit}`}</b></td>
                  <td style={{ minWidth: 300 }}>{r.action}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="note warn">Judgement flag: Almonds' formula quantity is small because the delayed PO is still counted as inbound for the order formula; but it cannot land within the {almondsA?.cover} days of cover — a human must choose expedite / part-ship / spot-buy.</div>
      </Card>

      <Card title="4 · Procurement alert" sub="for the procurement head" right={<span className="row"><Pill kind={words <= 100 ? 'ok' : 'bad'}>{words} / 100 words</Pill><CopyBtn text={alert} /></span>}>
        <div className="box alert">{alert}</div>
      </Card>

      <DraftPanel
        title={`5 · Draft email to supplier — most urgent: ${crit.item}`}
        template={draft}
        llmReady={llmReady}
        facts={supplierFacts(crit)}
        instruction={`Rewrite this urgent email to the almond supplier so it is polite, firm and under 170 words. Keep all requests (new date, part-shipment, ready stock, additional order). Use only given figures.`}
        approveLabel="Procurement head has reviewed and approves this email"
      />
    </>
  )
}
