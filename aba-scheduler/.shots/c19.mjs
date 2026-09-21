import { chromium } from 'playwright-core'
let browser
try { browser = await chromium.launch() } catch {
  const { execSync } = await import('child_process')
  execSync('npx playwright-core install chromium-headless-shell', { stdio: 'inherit' })
  browser = await chromium.launch()
}
const pg = await browser.newPage({ viewport: { width: 1600, height: 950 }, deviceScaleFactor: 1.5 })
pg.on('pageerror', (e) => console.log('PAGEERROR', e.message))
await pg.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
await pg.evaluate(() => localStorage.clear()); await pg.reload({ waitUntil: 'networkidle' }); await pg.waitForTimeout(1100)
await pg.click('[data-testid="nav-reports"]'); await pg.waitForTimeout(700)
await pg.screenshot({ path: '.shots/c19-landing.png' })
// hover a KPI card mid-transition
await pg.hover('[data-testid="rp-kpi-errors"]'); await pg.waitForTimeout(160)
await pg.screenshot({ path: '.shots/c19-kpi-hover.png', clip: { x: 250, y: 240, width: 1330, height: 220 } })
// switch report → count-up + stagger animation; catch mid-flight
await pg.click('[data-testid="rp-def-attendance"]'); await pg.waitForTimeout(90)
await pg.screenshot({ path: '.shots/c19-stagger.png', clip: { x: 250, y: 240, width: 1330, height: 260 } })
await pg.waitForTimeout(600)
// catalog hover peek
await pg.hover('[data-testid="rp-def-quality"]'); await pg.waitForTimeout(200)
await pg.screenshot({ path: '.shots/c19-catalog-hover.png', clip: { x: 0, y: 120, width: 260, height: 500 } })
await browser.close(); console.log('ok')
