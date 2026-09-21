import { chromium } from 'playwright-core'
let browser
try { browser = await chromium.launch() } catch {
  const { execSync } = await import('child_process')
  execSync('npx playwright-core install chromium-headless-shell', { stdio: 'inherit' })
  browser = await chromium.launch()
}
const pg = await browser.newPage({ viewport: { width: 1600, height: 950 }, deviceScaleFactor: 2 })
pg.on('pageerror', (e) => console.log('PAGEERROR', e.message))
await pg.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
await pg.evaluate(() => localStorage.clear()); await pg.reload({ waitUntil: 'networkidle' }); await pg.waitForTimeout(1000)
await pg.click('[data-testid="nav-reports"]'); await pg.waitForTimeout(700)
await pg.screenshot({ path: '.shots/c15-trend-weekly.png', clip: { x: 440, y: 210, width: 1140, height: 260 } })
// hover a bar for the lift state
await pg.hover('.rt-bars .rt-col:nth-child(2)'); await pg.waitForTimeout(250)
await pg.screenshot({ path: '.shots/c15-trend-hover.png', clip: { x: 440, y: 210, width: 1140, height: 260 } })
// daily mode on attendance (28 buckets) + a value metric
await pg.click('[data-testid="rp-f-sev-all"]').catch(()=>{})
await pg.fill('[data-testid="rp-search"]', 'attendance'); await pg.waitForTimeout(200)
await pg.click('[data-testid="rp-def-attendance"]'); await pg.waitForTimeout(400)
await pg.click('[data-testid="rp-metric-charge"]'); await pg.waitForTimeout(400)
// force a daily window (last 7 days) to prove crisp small bars
await pg.click('text=Last 7 days').catch(async () => { const btns = await pg.$$('[data-testid="rp-desk"] , .viewseg button'); });
await pg.waitForTimeout(400)
await pg.screenshot({ path: '.shots/c15-trend-attend.png', clip: { x: 440, y: 180, width: 1140, height: 300 } })
// full desk for context
await pg.screenshot({ path: '.shots/c15-reports.png' })
await browser.close(); console.log('ok')
