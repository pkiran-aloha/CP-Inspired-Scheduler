import { chromium } from 'playwright-core'
const browser = await chromium.launch()
const pg = await browser.newPage({ viewport: { width: 1600, height: 980 }, deviceScaleFactor: 1.5 })
pg.on('pageerror', (e) => console.log('PAGEERROR', e.message))
await pg.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
await pg.evaluate(() => localStorage.clear()); await pg.reload({ waitUntil: 'networkidle' }); await pg.waitForTimeout(1000)
// 1. quick-add → convention placeholder
const cols = await pg.$$('.tg-col')
if (cols.length) { const b = await cols[2].boundingBox(); await pg.mouse.click(b.x + b.width / 2, b.y + 200) }
await pg.waitForTimeout(400)
await pg.click('[data-testid="type-service"]').catch(() => {})
await pg.waitForTimeout(400)
console.log('placeholder:', JSON.stringify(await pg.$eval('[data-testid="appt-title"]', (el) => el.placeholder).catch(() => 'no modal')))
await pg.click('.modal .modal-x').catch(() => pg.keyboard.press('Escape'))
await pg.waitForTimeout(300)
// 2. settings naming block previews
await pg.click('[data-testid="nav-settings"]').catch(() => {})
await pg.waitForTimeout(400)
if (await pg.isVisible('[data-testid="set-naming"]').catch(() => false)) {
  for (const k of ['ehr', 'plain', 'code']) { await pg.click(`[data-testid="set-name-${k}"]`); await pg.waitForTimeout(120); console.log('preview', k, ':', JSON.stringify(await pg.$eval('[data-testid="set-name-preview"]', (el) => el.textContent.trim()))) }
  await pg.click('[data-testid="set-name-ehr"]')
  await pg.screenshot({ path: '.shots/c24-settings.png', clip: { x: 320, y: 130, width: 980, height: 480 } })
}
await pg.click('.set-modal .modal-x').catch(() => {})
await pg.waitForTimeout(300)
// 3. drawer from trend menu
await pg.click('[data-testid="nav-dashboard"]'); await pg.waitForTimeout(500)
await pg.hover('[data-testid="dash-widget-w-trend"]')
await pg.click('[data-testid="dw-more-w-trend"]'); await pg.waitForTimeout(200)
console.log('menu data item:', JSON.stringify(await pg.$eval('[data-testid="dw-data-w-trend"]', (el) => el.textContent.trim())))
await pg.click('[data-testid="dw-data-w-trend"]'); await pg.waitForTimeout(450)
console.log('rows:', await pg.$$eval('.dd-row', (r) => r.length), '| sample:', JSON.stringify(await pg.$eval('.dd-row b', (el) => el.textContent)))
await pg.screenshot({ path: '.shots/c24-drawer.png' })
await pg.click('.dd-row'); await pg.waitForTimeout(500)
console.log('jumped — title of view area has week? section now:', await pg.$eval('.sb-title, h1', (el) => el.textContent).catch(() => 'n/a'))
// 4. KPI no-show drawer pills
await pg.click('[data-testid="nav-dashboard"]'); await pg.waitForTimeout(400)
await pg.click('[data-testid="dw-kpi-noshow"]'); await pg.waitForTimeout(350)
const pills = await pg.$$eval('.dd-st', (els) => els.slice(0, 4).map((e) => e.textContent + ':' + getComputedStyle(e).color))
console.log('noshow pills:', JSON.stringify(pills))
await pg.screenshot({ path: '.shots/c24-kpi.png', clip: { x: 1110, y: 0, width: 490, height: 640 } })
await pg.keyboard.press('Escape'); await pg.waitForTimeout(200)
// 5. narrow viewport sanity
await pg.setViewportSize({ width: 760, height: 900 }); await pg.waitForTimeout(400)
await pg.click('[data-testid="dw-kpi-sessions"]'); await pg.waitForTimeout(300)
console.log('drawer width at 760px:', await pg.$eval('.dsh-drawer', (el) => Math.round(el.getBoundingClientRect().width)))
await browser.close(); console.log('DONE')
