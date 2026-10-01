export async function health() {
  try {
    return await (await fetch('/api/health')).json()
  } catch {
    return { ok: false, llmConfigured: false }
  }
}

async function post(url, body) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const j = await r.json().catch(() => ({ ok: false, error: 'Bad response from server' }))
  if (!j.ok) throw new Error(j.error || `HTTP ${r.status}`)
  return j
}

export const llmExtract = (kind, text) => post('/api/extract', { kind, text })
export const llmDraft = (instruction, facts) => post('/api/draft', { instruction, facts })

// Any number with 3+ digits in an LLM draft must already exist in our computed facts/template.
export function checkDraftNumbers(draftText, ...sources) {
  const grab = (s) => (String(s).replace(/,/g, '').match(/\d+(?:\.\d+)?/g) || []).filter((x) => x.replace('.', '').length >= 3)
  const allowed = new Set(sources.flatMap(grab))
  return [...new Set(grab(draftText))].filter((x) => !allowed.has(x))
}
