import { chromium } from 'playwright-core'
let browser
try { browser = await chromium.launch() } catch {
  const { execSync } = await import('child_process')
  execSync('npx playwright-core install chromium-headless-shell', { stdio: 'inherit' })
  browser = await chromium.launch()
}
const pg = await browser.newPage({ viewport: { width: 1600, height: 980 }, deviceScaleFactor: 1.5 })
pg.on('pageerror', (e) => console.log('PAGEERROR', e.message))
await pg.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
await pg.evaluate(() => localStorage.clear()); await pg.reload({ waitUntil: 'networkidle' }); await pg.waitForTimeout(1100)
await pg.click('[data-testid="nav-dashboard"]'); await pg.waitForTimeout(800)
await pg.screenshot({ path: '.shots/c20-board.png' })
await pg.click('[data-testid="dash-add"]'); await pg.waitForTimeout(300)
await pg.screenshot({ path: '.shots/c20-gallery.png', clip: { x: 1100, y: 20, width: 500, height: 560 } })
await pg.keyboard.press('Escape')
await pg.click('[data-testid="dash-add"]').catch(()=>{}) // close
// filter interaction: click service slice
await pg.click('[data-testid="dw-lg-service"]'); await pg.waitForTimeout(500)
await pg.screenshot({ path: '.shots/c20-filtered.png' })
await pg.click('[data-testid="dash-filter-type"]'); await pg.waitForTimeout(300)
// hover a bar row + heat cell
await pg.hover('.dw-bar-row'); await pg.waitForTimeout(200)
await pg.screenshot({ path: '.shots/c20-hover.png', clip: { x: 760, y: 480, width: 830, height: 460 } })
// mobile-ish reflow
await pg.setViewportSize({ width: 900, height: 900 }); await pg.waitForTimeout(500)
await pg.screenshot({ path: '.shots/c20-narrow.png' })
await browser.close(); console.log('ok')
