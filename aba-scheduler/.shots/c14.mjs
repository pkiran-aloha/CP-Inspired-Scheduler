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
await pg.screenshot({ path: '.shots/c14-calendar.png', clip: { x: 0, y: 0, width: 1600, height: 220 } })
await pg.click('[data-testid="nav-reports"]'); await pg.waitForTimeout(700)
await pg.screenshot({ path: '.shots/c14-reports.png' })
await pg.click('[data-testid="nav-clients"]'); await pg.waitForTimeout(400)
await pg.click('[data-testid="cli-mode-cards"]'); await pg.waitForTimeout(400)
await pg.screenshot({ path: '.shots/c14-clients.png' })
await pg.click('[data-testid="nav-staff"]'); await pg.waitForTimeout(400)
await pg.click('[data-testid="stf-mode-cards"]'); await pg.waitForTimeout(400)
await pg.screenshot({ path: '.shots/c14-staff.png' })
await pg.click('[data-testid="nav-calendar"]'); await pg.waitForTimeout(300)
await pg.click('[role="tab"]:has-text("Agenda")'); await pg.waitForTimeout(500)
await pg.screenshot({ path: '.shots/c14-agenda.png' })
await browser.close(); console.log('ok')
