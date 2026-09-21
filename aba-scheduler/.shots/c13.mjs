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
await pg.evaluate(() => localStorage.clear()); await pg.reload({ waitUntil: 'networkidle' }); await pg.waitForTimeout(1000)
// palette with a typed query
await pg.keyboard.press('Control+k'); await pg.waitForTimeout(350)
await pg.fill('[data-testid="palette-input"]', 'auth')
await pg.waitForTimeout(300)
await pg.screenshot({ path: '.shots/c13-palette.png', clip: { x: 420, y: 60, width: 1160, height: 660 } })
// run a report through it
await pg.fill('[data-testid="palette-input"]', 'utilization')
await pg.waitForTimeout(250)
await pg.keyboard.press('Enter'); await pg.waitForTimeout(700)
await pg.screenshot({ path: '.shots/c13-after-run.png', clip: { x: 60, y: 0, width: 1540, height: 520 } })
// help sheet
await pg.keyboard.press('Escape')
await pg.evaluate(() => document.querySelector('.rp-hero')?.click())
await pg.keyboard.press('Shift+?'); await pg.waitForTimeout(350)
await pg.screenshot({ path: '.shots/c13-help.png', clip: { x: 380, y: 40, width: 1240, height: 870 } })
await pg.keyboard.press('Escape'); await pg.waitForTimeout(200)
// settings v2
await pg.click('[data-testid="nav-settings"]'); await pg.waitForTimeout(450)
await pg.screenshot({ path: '.shots/c13-settings.png', clip: { x: 260, y: 40, width: 1280, height: 880 } })
await pg.click('.pal-btn').catch(()=>{})
await pg.keyboard.press('Escape'); await pg.waitForTimeout(200)
// dark mode palette for contrast check
await pg.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'))
await pg.keyboard.press('Control+k'); await pg.waitForTimeout(400)
await pg.screenshot({ path: '.shots/c13-palette-dark.png', clip: { x: 420, y: 60, width: 1160, height: 620 } })
await browser.close(); console.log('ok')
