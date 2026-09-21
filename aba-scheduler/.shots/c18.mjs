import { chromium } from 'playwright-core'
const browser = await chromium.launch()
const pg = await browser.newPage({ viewport: { width: 1600, height: 950 }, deviceScaleFactor: 1.5 })
pg.on('pageerror', (e) => console.log('PAGEERROR', e.message))
await pg.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
await pg.evaluate(() => localStorage.clear()); await pg.reload({ waitUntil: 'networkidle' }); await pg.waitForTimeout(1000)
await pg.click('[data-testid="nav-clients"]'); await pg.waitForTimeout(400)
await pg.click('[data-testid="cli-new"]'); await pg.waitForTimeout(400)
await pg.hover('[data-testid="cm-avatar-hedgehog"]'); await pg.waitForTimeout(200)
await pg.screenshot({ path: '.shots/c18-picker.png', clip: { x: 490, y: 110, width: 620, height: 330 } })
// duplicate-name hint
await pg.fill('[data-testid="cm-name"]', 'Meg Jones'); await pg.waitForTimeout(300)
await pg.screenshot({ path: '.shots/c18-namehint.png', clip: { x: 490, y: 380, width: 620, height: 200 } })
await pg.keyboard.press('Escape'); await pg.waitForTimeout(200)
// profile with copy chips → click copy → toast
await pg.click('[data-testid="cli-open-c1"]'); await pg.waitForTimeout(400)
await pg.screenshot({ path: '.shots/c18-profile-copy.png', clip: { x: 500, y: 260, width: 600, height: 220 } })
await pg.click('[data-testid="pf-copy-phone"]'); await pg.waitForTimeout(300)
await pg.screenshot({ path: '.shots/c18-toast.png', clip: { x: 950, y: 60, width: 620, height: 220 } })
// duplicate flow
await pg.click('[data-testid="pf-dup"]'); await pg.waitForTimeout(400)
await pg.screenshot({ path: '.shots/c18-dup.png', clip: { x: 490, y: 110, width: 620, height: 420 } })
await browser.close(); console.log('ok')
