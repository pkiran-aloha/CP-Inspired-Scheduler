import { chromium } from 'playwright-core'
const browser = await chromium.launch()
const pg = await browser.newPage({ viewport: { width: 1600, height: 980 } })
await pg.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
await pg.evaluate(() => localStorage.clear()); await pg.reload({ waitUntil: 'networkidle' }); await pg.waitForTimeout(1600)
await pg.click('[data-testid="nav-dashboard"]'); await pg.waitForTimeout(1400)
await pg.click('[data-testid="dash-add"]'); await pg.waitForTimeout(400)
const info = await pg.evaluate(() => {
  const item = document.querySelector('[data-testid="dash-add-ledger"]')
  const r = item.getBoundingClientRect()
  const at = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
  const chain = []
  let el = item
  while (el && el !== document.body) {
    const cs = getComputedStyle(el)
    chain.push(`${el.className.toString().split(' ')[0] || el.tagName}|z:${cs.zIndex}|pos:${cs.position}|tf:${cs.transform !== 'none'}|flt:${cs.filter}|opa:${cs.opacity}`)
    el = el.parentElement
  }
  const grid = document.querySelector('.dsh-grid')
  const gcs = getComputedStyle(grid)
  const w1 = grid.querySelector('.dsh-w')
  const wcs = getComputedStyle(w1)
  return { hit: at?.className?.toString().slice(0, 40) || at?.tagName, chain, gridZ: gcs.zIndex, gridPos: gcs.position, wZ: wcs.zIndex, wPos: wcs.position, wTf: wcs.transform, galZ: getComputedStyle(document.querySelector('.dsh-gallery')).zIndex }
})
console.log(JSON.stringify(info, null, 1))
await browser.close()
