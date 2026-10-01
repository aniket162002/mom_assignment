import { chromium } from 'playwright-core'
import path from 'path'
const dir = path.resolve(import.meta.dirname, '../../docs')
const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
const p = await b.newPage()
await p.goto('file:///' + dir.split(path.sep).join('/') + '/submission.html', { waitUntil: 'networkidle' })
await p.pdf({ path: dir + '/MOM_Automation_Assignment_Submission.pdf', format: 'A4', printBackground: true, preferCSSPageSize: true,
  displayHeaderFooter: true, headerTemplate: '<span></span>',
  footerTemplate: '<div style="font:8px Arial;color:#64748b;width:100%;text-align:center">MOM Automation Assignment · <span class="pageNumber"></span> / <span class="totalPages"></span></div>' })
await b.close(); console.log('pdf ok')
