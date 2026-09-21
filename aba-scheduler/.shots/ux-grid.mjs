import { chromium } from 'playwright-core'
let browser
try { browser = await chromium.launch() } catch {
  const { execSync } = await import('child_process')
  execSync('npx playwright-core install chromium-headless-shell', { stdio: 'inherit' })
  browser = await chromium.launch()
}
const errs = []
async function probe(w, h, name, capture) {
  const pg = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1.5 })
  pg.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message))
  await pg.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
  await pg.evaluate(() => localStorage.clear())
  await pg.reload({ waitUntil: 'networkidle' }); await pg.waitForTimeout(900)
  const m = await pg.evaluate(() => {
    const head = document.querySelector('.tg-dayhead')
    const sc = document.querySelector('.tg-scroll')
    const ts = [...document.querySelectorAll('.chip .t')]
    const clipped = ts.filter((el) => el.scrollWidth > el.clientWidth + 1).length
    const lanes = new Set([...document.querySelectorAll('.chip')].map((c) => c.style.left)).size
    return { colW: head ? Math.round(head.getBoundingClientRect().width) : 0, xScroll: sc ? sc.scrollWidth > sc.clientWidth + 2 : false, chips: ts.length, clipped, lanes, pph: parseFloat(getComputedStyle(document.querySelector('.tgrid')).getPropertyValue('--pph')) }
  })
  console.log(`${name} ${w}×${h}:`, 'colW', m.colW, '| pph', m.pph, '| chips', m.chips, '| clipped titles', m.clipped, '| distinct lane offsets', m.lanes, '| x-scroll', m.xScroll)
  if (capture) await pg.screenshot({ path: `.shots/ug-${name}.png` })
  await pg.close()
}
await probe(1920, 1080, 'desktop-xl', true)
await probe(1440, 860, 'laptop', true)
await probe(1024, 768, 'small', true)
await probe(820, 1180, 'tablet', true)
console.log('ERRORS:', errs.length ? errs.join('; ') : 'none')
await browser.close()
