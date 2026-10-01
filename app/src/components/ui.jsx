import { useState } from 'react'
import { checkDraftNumbers, llmDraft } from '../lib/api.js'

export const Pill = ({ kind, children }) => <span className={`pill ${kind || children}`}>{children}</span>

export function Card({ title, sub, right, children }) {
  return (
    <section className="card">
      <h3>
        <span>{title} {sub && <small>{sub}</small>}</span>
        {right}
      </h3>
      <div className="body">{children}</div>
    </section>
  )
}

export function CopyBtn({ text }) {
  const [done, setDone] = useState(false)
  return (
    <button className="btn sm" onClick={() => { navigator.clipboard?.writeText(text); setDone(true); setTimeout(() => setDone(false), 1400) }}>
      {done ? 'Copied ✓' : 'Copy'}
    </button>
  )
}

export const Spinner = () => <span className="spin" />

export function Pipeline({ steps }) {
  return (
    <div className="pipeline">
      {steps.map((s, i) => (
        <div key={i} className={`step ${s.kind}`}>
          <div className="n">{i + 1}</div>
          <b>{s.title}</b>
          <span>{s.text}</span>
        </div>
      ))}
    </div>
  )
}

// Extraction status chip for one source document.
export function ExtractCard({ label, text, onText, state, rows = 6 }) {
  const { loading, error, source, issues = [], facts, ms } = state || {}
  return (
    <div>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
        <b>{label}</b>
        <span className="row" style={{ gap: 6 }}>
          {loading && <Spinner />}
          {source === 'gemini' && <Pill kind="llm">Gemini · {ms} ms</Pill>}
          {source === 'regex' && <Pill kind="gray">offline regex</Pill>}
          {facts && (issues.length ? <Pill kind="warn">{issues.length} check(s) failed</Pill> : <Pill kind="ok">validated ✓</Pill>)}
        </span>
      </div>
      <textarea rows={rows} value={text} onChange={(e) => onText(e.target.value)} spellCheck={false} />
      {error && <div className="err">LLM error: {error} — fell back to offline extractor.</div>}
      {issues.map((i, k) => <div key={k} className="err">⚠ {i}</div>)}
      {facts && <pre className="json">{JSON.stringify(facts, null, 2)}</pre>}
    </div>
  )
}

// Code-generated draft  vs  optional Gemini rewrite whose numbers are machine-verified.
export function DraftPanel({ title, template, instruction, facts, llmReady, approveLabel }) {
  const [g, setG] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [ok, setOk] = useState(false)
  const tplText = `${template.subject ? 'Subject: ' + template.subject + '\n\n' : ''}${template.body}`

  async function rewrite() {
    setBusy(true); setErr(''); setG(null)
    try {
      const r = await llmDraft(instruction, { ...facts, template_draft: tplText })
      const text = `Subject: ${r.data.subject}\n\n${r.data.body}`
      setG({ text, ms: r.ms, bad: checkDraftNumbers(text, JSON.stringify(facts), tplText) })
    } catch (e) { setErr(e.message) }
    setBusy(false)
  }

  return (
    <Card title={title} sub="human approval required before sending" right={<Pill kind="warn">DRAFT</Pill>}>
      <div className="cmp">
        <div>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <div className="tag">Code-built (numbers from the engine)</div>
            <CopyBtn text={tplText} />
          </div>
          <div className="box">{tplText}</div>
        </div>
        <div>
          <div className="row" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
            <div className="tag" style={{ margin: 0 }}>Gemini rewrite (numbers re-verified)</div>
            <span className="row">
              {g && <CopyBtn text={g.text} />}
              <button className="btn sm primary" disabled={!llmReady || busy} onClick={rewrite}>{busy ? <Spinner /> : '✨ Draft with Gemini'}</button>
            </span>
          </div>
          {g ? (
            <>
              <div className="box">{g.text}</div>
              <div style={{ marginTop: 8 }}>
                {g.bad.length === 0
                  ? <Pill kind="ok">every figure matches computed data ✓ · {g.ms} ms</Pill>
                  : <Pill kind="bad">unverified figures: {g.bad.join(', ')} — do not use</Pill>}
              </div>
            </>
          ) : <div className="box muted">{llmReady ? 'Click to have Gemini polish the tone. It may only use the numbers above — any new figure is flagged.' : 'LLM key not configured.'}</div>}
          {err && <div className="err">{err}</div>}
        </div>
      </div>
      <label className="chk"><input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} /> {approveLabel || 'I have reviewed this draft and approve it for sending'}</label>
      {ok && <div className="note" style={{ marginTop: 10 }}>Approved by reviewer — ready to send from your mailbox. (The app never sends email by itself.)</div>}
    </Card>
  )
}
