import { chromium } from 'playwright-core'
const browser = await chromium.launch()
const pg = await browser.newPage({ viewport: { width: 1600, height: 950 }, deviceScaleFactor: 1.5 })
await pg.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
await pg.evaluate(() => localStorage.clear()); await pg.reload({ waitUntil: 'networkidle' }); await pg.waitForTimeout(900)
await pg.click('[data-testid="nav-reports"]'); await pg.waitForTimeout(700)
await pg.screenshot({ path: '.shots/c12-reports-final.png' })
await browser.close(); console.log('ok')
