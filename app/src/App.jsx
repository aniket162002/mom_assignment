import { useEffect, useState } from 'react'
import { health } from './lib/api.js'
import Issue1 from './components/Issue1.jsx'
import Issue2 from './components/Issue2.jsx'
import Design, { Reliability } from './components/Design.jsx'

const TABS = [
  ['design', 'Part 1 · Design'],
  ['i1', 'Issue 1 · Reorder alerts'],
  ['i2', 'Issue 2 · Invoice matching'],
  ['rel', 'Part 4 · Reliability'],
]

export default function App() {
  const [tab, setTab] = useState('i1')
  const [h, setH] = useState({ ok: false, llmConfigured: false })
  useEffect(() => { health().then(setH) }, [])
  const ready = !!h.llmConfigured

  return (
    <div className="shell">
      <header className="top">
        <div className="logo"><i>M</i> MOM Automation Console</div>
        <nav className="tabs">{TABS.map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}</nav>
        <div className="llmstate"><span className={`dot ${ready ? 'on' : ''}`} />{ready ? `Live LLM · ${h.model}` : 'LLM offline — regex mode'}</div>
      </header>
      {tab === 'design' && <Design />}
      {tab === 'i1' && <Issue1 llmReady={ready} />}
      {tab === 'i2' && <Issue2 llmReady={ready} />}
      {tab === 'rel' && <Reliability />}
    </div>
  )
}
