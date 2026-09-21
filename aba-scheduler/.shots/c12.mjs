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
await pg.click('[data-testid="nav-reports"]'); await pg.waitForTimeout(700)
await pg.screenshot({ path: '.shots/c12-reports.png' })
// hover a row so the inline actions show, then click an error filter
await pg.hover('[data-testid="rp-row-0"]'); await pg.waitForTimeout(250)
await pg.screenshot({ path: '.shots/c12-rowactions.png', clip: { x: 300, y: 420, width: 1290, height: 340 } })
// trend focus: click 3rd bar
await pg.click('.rt-chart g:nth-child(3)'); await pg.waitForTimeout(400)
await pg.screenshot({ path: '.shots/c12-focus.png', clip: { x: 300, y: 60, width: 1290, height: 420 } })
// utilization report to show a real value trend (minutes by week)
await pg.click('[data-testid="rp-f-clear"]').catch(()=>{})
await pg.fill('[data-testid="rp-search"]', 'utilization'); await pg.waitForTimeout(200)
await pg.click('[data-testid="rp-def-utilization"]'); await pg.waitForTimeout(600)
await pg.screenshot({ path: '.shots/c12-util.png' })
// detail modal via row drill from quality report
await pg.fill('[data-testid="rp-search"]', 'quality'); await pg.waitForTimeout(200)
await pg.click('[data-testid="rp-def-quality"]'); await pg.waitForTimeout(400)
await pg.click('[data-testid="rp-row-0"]'); await pg.waitForTimeout(600)
const m = await pg.evaluate(() => {
  const el = document.querySelector('.detail')
  if (!el) return null
  const body = el.querySelector('.body')
  return { w: Math.round(el.getBoundingClientRect().width), cols: getComputedStyle(body).gridTemplateColumns.split(' ').length, vw: innerWidth }
})
console.log('detail modal:', JSON.stringify(m))
await pg.screenshot({ path: '.shots/c12-detail.png' })
// narrow laptop: still sane?
await pg.setViewportSize({ width: 1280, height: 800 }); await pg.waitForTimeout(500)
await pg.screenshot({ path: '.shots/c12-detail-1280.png' })
await browser.close(); console.log('ok')
