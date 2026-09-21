import { chromium } from 'playwright-core'
const browser = await chromium.launch()
const pg = await browser.newPage({ viewport: { width: 1600, height: 1180 }, deviceScaleFactor: 1.5 })
await pg.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
await pg.evaluate(() => localStorage.clear()); await pg.reload({ waitUntil: 'networkidle' }); await pg.waitForTimeout(1000)
await pg.click('[data-testid="nav-dashboard"]'); await pg.click('[data-testid="dash-add"]')
await pg.click('[data-testid="dash-add-ledger"]'); await pg.waitForTimeout(800)
await pg.screenshot({ path: '.shots/c26-board.png' })
await browser.close(); console.log('ok')
