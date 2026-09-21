import { chromium } from 'playwright-core'
const browser = await chromium.launch()
const pg = await browser.newPage({ viewport: { width: 1600, height: 980 }, deviceScaleFactor: 1.5 })
pg.on('pageerror', (e) => console.log('PAGEERROR', e.message))
await pg.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
await pg.evaluate(() => localStorage.clear()); await pg.reload({ waitUntil: 'networkidle' }); await pg.waitForTimeout(1000)
// 1. quick-add flow → auto-title placeholder per convention
const newBtn = await pg.$('[data-testid="top-new"]').catch(() => null)
if (newBtn) await newBtn.click(); else { const c = await pg.$('.tb-actions .btn-primary, [data-testid="tb-new"]'); if (c) await c.click() }
await pg.waitForTimeout(500)
const modalTitlePh = await pg.$eval('[data-testid="appt-title"]', (el) => el.placeholder).catch(() => 'no modal')
console.log('new-appt auto-title placeholder:', JSON.stringify(modalTitlePh))
if (modalTitlePh !== 'no modal') {
  await pg.click('.modal-x').catch(() => {}); await pg.waitForTimeout(200)
}
// 2. Settings → naming block + live preview across styles
await pg.click('[data-testid="nav-settings"]').catch(() => {})
const settingsOpen = await pg.isVisible('[data-testid="set-naming"]').catch(() => false)
if (settingsOpen) {
  console.log('preview (ehr):', await pg.$eval('[data-testid="set-name-preview"]', (el) => el.textContent.trim()))
  await pg.click('[data-testid="set-name-plain"]')
  console.log('preview (plain):', await pg.$eval('[data-testid="set-name-preview"]', (el) => el.textContent.trim()))
  await pg.click('[data-testid="set-name-staff"]')
  console.log('preview (+staff):', await pg.$eval('[data-testid="set-name-preview"]', (el) => el.textContent.trim()))
  await pg.click('[data-testid="set-name-code"]')
  const codePrev = await pg.$eval('[data-testid="set-name-preview"]', (el) => el.textContent.trim())
  console.log('preview (code):', JSON.stringify(codePrev))
  await pg.screenshot({ path: '.shots/c24-settings.png', clip: { x: 300, y: 120, width: 1000, height: 520 } })
  await pg.click('[data-testid="set-name-ehr"]').catch(() => {})
  await pg.keyboard.press('Escape')
}
await pg.waitForTimeout(300)
// 3. Dashboard drawer: open from trend menu, screenshot, click a row → calendar
await pg.click('[data-testid="nav-dashboard"]'); await pg.waitForTimeout(600)
await pg.hover('[data-testid="dash-widget-w-trend"]')
await pg.click('[data-testid="dw-more-w-trend"]'); await pg.waitForTimeout(200)
await pg.click('[data-testid="dw-data-w-trend"]'); await pg.waitForTimeout(400)
await pg.screenshot({ path: '.shots/c24-drawer.png' })
const rowsN = await pg.$$eval('.dd-row', (r) => r.length)
const sampleTitle = await pg.$eval('.dd-row b', (el) => el.textContent)
console.log('drawer rows:', rowsN, '| sample row title:', JSON.stringify(sampleTitle))
await pg.click('.dd-row'); await pg.waitForTimeout(500)
console.log('section after row click:', await pg.$eval('.sectionpage h1, .sb-title, [data-testid="section-title"]', (el) => el.textContent).catch(async () => await pg.title()))
// 4. KPI no-show tile → drawer with amber pills
await pg.click('[data-testid="nav-dashboard"]'); await pg.waitForTimeout(400)
await pg.click('[data-testid="dw-kpi-noshow"]'); await pg.waitForTimeout(300)
await pg.screenshot({ path: '.shots/c24-kpi-drawer.png', clip: { x: 1100, y: 0, width: 500, height: 700 } })
const pill = await pg.$eval('.dd-st', (el) => el.textContent + '|' + getComputedStyle(el).color)
console.log('kpi drawer pill:', pill)
await browser.close(); console.log('DONE')
