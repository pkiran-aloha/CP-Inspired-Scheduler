import { chromium } from 'playwright-core'
const browser = await chromium.launch()
const pg = await browser.newPage({ viewport: { width: 1600, height: 980 }, deviceScaleFactor: 1.5 })
await pg.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
await pg.evaluate(() => localStorage.clear()); await pg.reload({ waitUntil: 'networkidle' }); await pg.waitForTimeout(900)
await pg.click('[data-testid="nav-dashboard"]'); await pg.waitForTimeout(500)
// computed color of the range select + its options
console.log('range select css:', await pg.evaluate(() => {
  const s = document.querySelector('[data-testid="dash-range"]')
  const o = s.querySelector('option')
  const cs = getComputedStyle(s), oc = getComputedStyle(o)
  return { selectColor: cs.color, selectBg: cs.backgroundColor, optionColor: oc.color, optionBg: oc.backgroundColor, w: s.getBoundingClientRect().width }
}))
await pg.screenshot({ path: '.shots/c21-range.png', clip: { x: 1240, y: 8, width: 350, height: 52 } })
await pg.click('[data-testid="nav-analytics"]'); await pg.waitForTimeout(600)
console.log('an select css:', await pg.evaluate(() => {
  const s = document.querySelector('[data-testid="an-metric"]')
  const r = s.getBoundingClientRect()
  return { color: getComputedStyle(s).color, bg: getComputedStyle(s).backgroundColor, w: r.width, h: r.height, fontSize: getComputedStyle(s).fontSize, overflow: getComputedStyle(s).textOverflow }
}))
await pg.screenshot({ path: '.shots/c21-analytics.png', clip: { x: 210, y: 150, width: 1180, height: 170 } })
await browser.close(); console.log('ok')
