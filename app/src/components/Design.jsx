import { Card, Pill } from './ui.jsx'

const LLM_TABLE = [
  ['Issue 1 — Reorder', 'Read supplier emails → {po_ref, eta_delay_days, price_change_pct, lead_time_changed}; polish the supplier email wording.',
    'Days of cover, ROP, status, order qty; deciding if a PO "counts"; turning "6 days later" into an ETA (code adds 5 + 6); choosing the order size or supplier.'],
  ['Issue 2 — Invoices', 'Extract fields from 5 different layouts; spot "bank account changed", "reminder", "payment pending" language; polish vendor/controller wording.',
    'PO / rate / GRN matching, tax & total footing, duplicate detection, totals, "safe to release" vs "hold", and anything about bank accounts.'],
]

const HUMAN = [
  ['Approve any purchase order and its quantity', 'The formula gives a number; MOQ, price rises, cash and alternates are judgment. Almonds: formula says 150 kg but lead time (10 d) exceeds cover (6 d), so size alone cannot fix it.'],
  ['Alternate / spot suppliers, premium or air-freight', 'A commercial trade-off between cost and stock-out.'],
  ['Release of every payment batch', 'Maker–checker: automation prepares, a person releases.'],
  ['Every exception (rate, over-billing, part-pay, credit note)', 'Negotiation with a vendor, not arithmetic.'],
  ['Changing a vendor bank account', 'Highest-fraud step. Verify by call-back to the number on file, two approvers, cooling-off. Never from an email.'],
  ['Duplicate overrides and sending external email', 'App creates drafts only.'],
  ['Anything the extractor is unsure about', 'Failed validation, PO not found, quote not verbatim → exception queue.'],
]

export default function Design() {
  return (
    <>
      <div className="hero">
        <h1>Design <em>decisions</em></h1>
        <p>Part 1 of the brief: which tools, where the LLM is (and is not) used, and which steps always need a human.</p>
      </div>

      <Card title="1 · Tools and why" sub="low-maintenance, free tier">
        <table className="dtable">
          <tbody>
            <tr><td>Inputs</td><td>Google Sheet (stock, PO/GRN) + Gmail labels for supplier and AP emails — teams keep working as they do today.</td></tr>
            <tr><td>Orchestration</td><td>Apps Script time trigger (or n8n) for the daily email → sheet → alert hop; this React console is the review UI.</td></tr>
            <tr><td>Logic</td><td>Plain code / sheet formulas — deterministic, testable, auditable (<code>engine.js</code> + Python reference with identical tests).</td></tr>
            <tr><td>Text understanding</td><td>Gemini (free tier) behind a thin server, forced to JSON, temperature 0. Key stays server-side.</td></tr>
            <tr><td>Output</td><td>Drafts only (never auto-send), alert, exception report, audit log.</td></tr>
          </tbody>
        </table>
      </Card>

      <Card title="2 · Where the LLM is used — and deliberately not">
        <div className="tw"><table>
          <thead><tr><th></th><th><Pill kind="llm">Use the LLM for</Pill></th><th><Pill kind="bad">Never use it for</Pill></th></tr></thead>
          <tbody>{LLM_TABLE.map(([a, b, c]) => <tr key={a}><td><b>{a}</b></td><td>{b}</td><td>{c}</td></tr>)}</tbody>
        </table></div>
        <div className="note">LLM output is treated as <b>untrusted input</b>: each field must quote its source verbatim, the document must foot, the PO and vendor must exist — otherwise it is rejected and shown to a human. This also blunts prompt-injection inside emails.</div>
      </Card>

      <Card title="3 · Steps that always need a human decision">
        <div className="tw"><table>
          <thead><tr><th>Step</th><th>Why</th></tr></thead>
          <tbody>{HUMAN.map(([a, b]) => <tr key={a}><td><b>{a}</b></td><td>{b}</td></tr>)}</tbody>
        </table></div>
      </Card>
    </>
  )
}

export function Reliability() {
  return (
    <>
      <div className="hero">
        <h1>Reliability <em>note</em></h1>
        <p>Part 4: correct numbers every day, controls around money, and surviving format changes.</p>
      </div>
      <Card title="How we keep it correct" sub="7 sentences">
        <div style={{ fontSize: 15, lineHeight: 1.75 }}>
          To keep the numbers correct every day, all arithmetic and status logic runs in tested code (hand-computed regression tests in both Python and JavaScript), the LLM only extracts text into a fixed JSON schema, and each extracted field must quote its source, foot (qty × rate = taxable, taxable + GST = total) and reference a PO and vendor that exist, otherwise the item goes to an exception queue instead of being guessed. Each daily run is logged with inputs, outputs and a diff against yesterday, and sanity alerts fire on anything odd such as zero documents processed, usage swinging more than 30%, or a status flipping from OK to CRITICAL without a stock or email change. For money, I would use maker–checker approval (the automation prepares, a person releases), a ledger of every invoice number ever seen so duplicates are blocked automatically, and a hard rule that bank details change only through a call-back to the number already on file with two approvers, never from an email. The automation would never hold payment credentials, would only produce reports and drafts, and would keep an audit trail of who approved what. If a supplier or vendor changes their email or invoice format, the schema-based LLM extractor absorbs most variation, but anything that fails validation or has low confidence is routed to a human and not paid. That human-corrected example is added to the prompt's examples and to a weekly test set of real documents, so format drift is caught within days rather than as a wrong payment. A monthly reconciliation of paid amounts against the GRN and PO ledgers, plus a short list of known vendor email domains, closes the loop.
        </div>
      </Card>
      <div className="grid2">
        <Card title="Controls around money">
          <ul className="log"><li>Maker–checker on every payment batch</li><li>Invoice-number ledger blocks duplicates</li><li>Bank changes: call-back + 2 approvers + cooling-off</li><li>No payment credentials in the automation</li></ul>
        </Card>
        <Card title="When a vendor changes format">
          <ul className="log"><li>Schema-based extraction absorbs variation</li><li>Validation failure → human queue, never auto-paid</li><li>Corrected sample joins weekly regression set</li><li>Known-sender domain allow-list</li></ul>
        </Card>
      </div>
    </>
  )
}
