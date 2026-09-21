import { chromium } from 'playwright-core'
const browser = await chromium.launch()
const pg = await browser.newPage({ viewport: { width: 1600, height: 950 }, deviceScaleFactor: 1.5 })
await pg.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
await pg.evaluate(() => localStorage.clear()); await pg.reload({ waitUntil: 'networkidle' }); await pg.waitForTimeout(1000)
await pg.click('[data-testid="nav-clients"]'); await pg.waitForTimeout(300)
await pg.click('[data-testid="cli-new"]'); await pg.waitForTimeout(300)
await pg.screenshot({ path: '.shots/c18-picker2.png', clip: { x: 490, y: 110, width: 620, height: 300 } })
await browser.close(); console.log('ok')
