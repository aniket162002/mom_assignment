// Drives the real running app (live Gemini) and saves screenshots to ../docs/screenshots
import { chromium } from 'playwright-core'
import fs from 'fs'

const OUT = new URL('../../docs/screenshots/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
fs.mkdirSync(OUT, { recursive: true })
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })).newPage()
const log = []
page.on('console', (m) => m.type() === 'error' && log.push(m.text()))
page.on('pageerror', (e) => log.push('PAGEERROR ' + e.message))

const shot = (name, loc) => (loc || page).screenshot({ path: OUT + name + '.png', ...(loc ? {} : { fullPage: true }) }).then(() => console.log('saved', name))
const card = (title) => page.locator('section.card', { has: page.locator('h3', { hasText: title }) }).first()
const tab = async (label) => { await page.getByRole('button', { name: label }).click(); await page.waitForTimeout(400) }
const waitExtract = async (n) => {
  await page.waitForFunction((k) => document.querySelectorAll('.pill.ok, .pill.warn').length >= 0 && document.querySelectorAll('pre.json').length >= k && !document.querySelector('.spin'), n, { timeout: 150000 })
}

await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' })
await page.waitForSelector('.dot.on')
await page.addStyleTag({ content: 'header.top{position:static !important}' })

// ---------- Issue 1 ----------
await shot('01-issue1-before-extraction', null)
await page.getByRole('button', { name: /Extract with Gemini/ }).click()
await waitExtract(2)
await page.waitForTimeout(800)
await shot('02-issue1-full-after-gemini', null)
await shot('03-issue1-inputs-and-gemini-extraction', card('1 · Inputs'))
await shot('04-issue1-email-changes-audit-log', card('2 · What the emails changed'))
await shot('05-issue1-item-level-results', card('3 · Item-level results'))
await shot('06-issue1-procurement-alert', card('4 · Procurement alert'))
await page.getByRole('button', { name: /Draft with Gemini/ }).click()
await page.waitForFunction(() => document.body.innerText.includes('every figure matches') || document.body.innerText.includes('unverified figures'), null, { timeout: 150000 })
await card('5 · Draft email').getByRole('checkbox').check()
await shot('07-issue1-supplier-email-draft', card('5 · Draft email'))

// ---------- Issue 2 ----------
await tab('Issue 2')
await page.addStyleTag({ content: 'header.top{position:static !important}' })
await page.waitForTimeout(20000) // respect free-tier rate limit
await shot('08-issue2-before-extraction', null)
await page.getByRole('button', { name: /Extract with Gemini/ }).click()
await waitExtract(5)
await page.waitForTimeout(800)
await page.locator('.kpis').waitFor()
await shot('09-issue2-full-after-gemini', null)
await shot('10-issue2-documents-gemini-extraction', card('2 · Finance inbox'))
await shot('11-issue2-totals-kpis', page.locator('.kpis'))
await card('3 · Exception report').getByRole('checkbox').check()
await shot('12-issue2-exception-report', card('3 · Exception report'))
await page.getByRole('button', { name: /Draft with Gemini/ }).first().click()
await page.waitForFunction(() => document.body.innerText.includes('every figure matches') || document.body.innerText.includes('unverified figures'), null, { timeout: 150000 })
await shot('13-issue2-vendor-query-draft', card('4 · Draft query'))
await shot('14-issue2-controller-note', card('5 · Internal note'))

// ---------- Design / Reliability ----------
await tab('Part 1')
await shot('15-part1-design', null)
await tab('Part 4')
await shot('16-part4-reliability', null)

fs.writeFileSync(OUT + 'console-errors.txt', log.join('\n') || 'none')
console.log('console errors:', log.length ? log : 'none')
await browser.close()
