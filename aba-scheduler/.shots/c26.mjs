import { chromium } from 'playwright-core'
const browser = await chromium.launch()
const pg = await browser.newPage({ viewport: { width: 1600, height: 980 }, deviceScaleFactor: 1.5 })
pg.on('pageerror', (e) => console.log('PAGEERROR', e.message))
await pg.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
await pg.evaluate(() => localStorage.clear()); await pg.reload({ waitUntil: 'networkidle' }); await pg.waitForTimeout(1000)
// 1. add the ledger widget from the gallery
await pg.click('[data-testid="nav-dashboard"]'); await pg.waitForTimeout(500)
await pg.click('[data-testid="dash-add"]')
await pg.click('[data-testid="dash-add-ledger"]', { delay: 0 }); await pg.waitForTimeout(500)
const wid = await pg.evaluate(() => JSON.parse(localStorage.getItem('aloha-aba.v3')).dash.widgets.find((w) => w.type === 'ledger').id)
console.log('ledger widget id:', wid.slice(0, 8), '| rows rendered:', await pg.$$eval(`[data-testid="dash-widget-${wid}"] .wlx`, (r) => r.length))
const sample = await pg.$eval(`[data-testid="dash-widget-${wid}"] .wlx`, (el) => el.textContent.replace(/\s+/g, ' ').trim())
console.log('sample row:', JSON.stringify(sample.slice(0, 120)))
await pg.screenshot({ path: '.shots/c26-ledger.png', clip: { x: 760, y: 480, width: 830, height: 480 } })
// row → detail card
await pg.click(`[data-testid="dash-widget-${wid}"] .wlx`); await pg.waitForTimeout(350)
console.log('detail opened:', await pg.isVisible('[data-testid="detail-card"]'))
await pg.click('.detail .modal-x'); await pg.waitForTimeout(200)
// 2. title health — green state
await pg.click('[data-testid="nav-settings"]'); await pg.waitForTimeout(400)
console.log('health (clean seed):', JSON.stringify(await pg.$eval('[data-testid="set-name-clean"]', (el) => el.textContent)))
await pg.click('.set-modal .modal-x'); await pg.waitForTimeout(300)
// 3. inject flagged titles (legacy + blank + long) directly, then audit → rework
await pg.evaluate(() => {
  const st = JSON.parse(localStorage.getItem('aloha-aba.v3'))
  const ids = Object.keys(st.appts)
  st.appts[ids[0]].title = '(Service) 9 AM - 10 AM'
  st.appts[ids[1]].title = '   '
  st.appts[ids[2]].title = 'Extremely long interdisciplinary behavioral health note title that clearly exceeds any agenda column at all times'
  localStorage.setItem('aloha-aba.v3', JSON.stringify(st))
})
await pg.reload({ waitUntil: 'networkidle' }); await pg.waitForTimeout(900)
await pg.click('[data-testid="nav-settings"]'); await pg.waitForTimeout(400)
console.log('health (flagged):', JSON.stringify(await pg.$eval('[data-testid="set-name-review"]', (el) => el.textContent.trim())))
await pg.click('[data-testid="set-name-review"]'); await pg.waitForTimeout(250)
await pg.screenshot({ path: '.shots/c26-health.png', clip: { x: 320, y: 520, width: 700, height: 300 } })
console.log('review rows:', await pg.$$eval('.sh-list button', (b) => b.map((x) => x.textContent.slice(0, 26))))
// rework
await pg.click('[data-testid="set-name-apply"]'); await pg.waitForTimeout(500)
console.log('after rework:', JSON.stringify(await pg.$eval('[data-testid="set-name-clean"]', (el) => el.textContent.trim()).catch(() => 'still flagged')))
const fixed = await pg.evaluate(() => { const st = JSON.parse(localStorage.getItem('aloha-aba.v3')); const ids = Object.keys(st.appts); return [st.appts[ids[0]].title, st.appts[ids[1]].title] })
console.log('reworked titles:', JSON.stringify(fixed))
// undo restores
const undoBtn = await pg.$('button:has-text("Undo")')
if (undoBtn) { await undoBtn.click(); await pg.waitForTimeout(400); console.log('undo → flag chip back:', await pg.isVisible('[data-testid="set-name-review"]')) }
await browser.close(); console.log('DONE')
