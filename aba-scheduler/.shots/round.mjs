import { chromium } from 'playwright-core'
const errs = []
const browser = await chromium.launch()
const pg = await browser.newPage({ viewport: { width: 1600, height: 940 }, deviceScaleFactor: 1.5 })
pg.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message))
pg.on('console', (m) => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text()) })
const reset = async () => {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await pg.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
      await pg.evaluate(() => localStorage.clear())
      await pg.reload({ waitUntil: 'networkidle' })
      break
    } catch (e) { if (attempt === 1) throw e; await pg.waitForTimeout(900) } // vite dep re-optimization reload
  }
  await pg.waitForTimeout(650)
}
await pg.goto('http://localhost:5173/').catch(() => {}) // warm the vite dep cache

// ---- calendar + analytics (regression coverage of the shared anchor) ----
await reset()
await pg.screenshot({ path: '.shots/v4-calendar.png' })
await pg.getByTestId('nav-analytics').click(); await pg.waitForTimeout(700)
await pg.getByTestId('an-slider').fill('126'); await pg.waitForTimeout(500)
await pg.getByRole('button', { name: 'Bars' }).click(); await pg.waitForTimeout(250)
await pg.screenshot({ path: '.shots/v4-analytics.png' })

// ---- billing lifecycle walkthrough ----
await reset()
await pg.getByTestId('nav-billing').click(); await pg.waitForTimeout(650)
await pg.screenshot({ path: '.shots/v4-billing-stage.png' })
// assemble all staging lines into claim forms
await pg.getByTestId('bil-pickall').click(); await pg.waitForTimeout(150)
await pg.getByTestId('bil-generate').click(); await pg.waitForTimeout(600)
console.log('assembled + landed on desk:', await pg.getByTestId('clm-row-0').isVisible())
await pg.screenshot({ path: '.shots/v4-billing-desk.png' })
// submit the freshly assembled top draft
await pg.getByTestId('clm-submit').click(); await pg.waitForTimeout(450)
await pg.screenshot({ path: '.shots/v4-billing-submitted.png' })
// post payment via the quick presets
await pg.getByTestId('clm-pay').click(); await pg.waitForTimeout(300)
await pg.screenshot({ path: '.shots/v4-billing-pay-modal.png' })
await pg.getByTestId('pay-quick-full').click(); await pg.waitForTimeout(150)
await pg.getByTestId('pay-post').click(); await pg.waitForTimeout(500)
console.log('claim paid:', await pg.getByTestId('clm-form').textContent().then((t) => /Paid/.test(t)))
await pg.screenshot({ path: '.shots/v4-billing-paid.png' })
// drill a charge line to its session → detail card carries the claim chip
await pg.locator('.cd-line-acts .iconbtn').first().click(); await pg.waitForTimeout(600)
console.log('detail card claim chip:', await pg.locator('.claim-ref').first().textContent().catch(() => 'MISSING'))
await pg.screenshot({ path: '.shots/v4-detail-claimchip.png' })
await pg.getByLabel('Close').click(); await pg.waitForTimeout(250) // leave the calendar card like a human would
// denial queue: filter, open, mark a line disputed, rebill
await pg.getByTestId('nav-billing').click(); await pg.waitForTimeout(450)
await pg.getByTestId('bil-tab-claims').click(); await pg.waitForTimeout(250)
await pg.getByTestId('clm-filter-denied').click(); await pg.waitForTimeout(250)
await pg.getByTestId('clm-row-0').click(); await pg.waitForTimeout(250)
await pg.screenshot({ path: '.shots/v4-billing-denied.png' })
await pg.getByTestId('clm-dispute-0').click(); await pg.waitForTimeout(150)
await pg.getByTestId('clm-rebill').click(); await pg.waitForTimeout(600)
console.log('rebilled to R2:', await pg.getByTestId('clm-form').textContent().then((t) => /-R2/.test(t)))
await pg.screenshot({ path: '.shots/v4-billing-rebill.png' })
// CMS-1500 PDF export — single claim + batch
await pg.getByTestId('clm-cms1500').click(); await pg.waitForTimeout(500)
console.log('1500 export toast:', await pg.getByText(/CMS-1500 exported/).isVisible())
await pg.getByTestId('bil-cms1500-batch').click(); await pg.waitForTimeout(600)
console.log('1500 batch toast:', await pg.getByText(/CMS-1500 batch/).last().isVisible())
await pg.screenshot({ path: '.shots/v4-billing-1500.png' })
// client record now carries the claims demographics feeding the form
await pg.getByTestId('nav-clients').click(); await pg.waitForTimeout(500)
await pg.getByTestId('cli-row-c9').click(); await pg.waitForTimeout(300)
console.log('client claims line:', await pg.getByText(/Claims: DOB/).isVisible())
await pg.screenshot({ path: '.shots/v4-client-demographics.png' })
await pg.getByTestId('nav-billing').click(); await pg.waitForTimeout(400)
// blocked + setup
await pg.getByTestId('bil-tab-blocked').click(); await pg.waitForTimeout(300)
await pg.screenshot({ path: '.shots/v4-billing-blocked.png' })
await pg.getByTestId('bil-tab-setup').click(); await pg.waitForTimeout(250)
await pg.screenshot({ path: '.shots/v4-billing-setup.png' })
// claims register on the reports desk
await reset()
await pg.getByTestId('nav-reports').click(); await pg.waitForTimeout(500)
await pg.getByTestId('rp-search').fill('claims register'); await pg.waitForTimeout(200)
await pg.getByTestId('rp-def-claims').click(); await pg.waitForTimeout(500)
console.log('claims register rows:', await pg.locator('[data-testid^="rp-row-"]').count())
await pg.screenshot({ path: '.shots/v4-reports-claims.png' })
// quality + collapsed
await pg.getByTestId('rp-search').fill('data quality'); await pg.waitForTimeout(150)
await pg.getByTestId('rp-def-quality').click(); await pg.waitForTimeout(450)
await pg.screenshot({ path: '.shots/v4-reports-quality.png' })
await pg.getByTestId('nav-billing').click(); await pg.waitForTimeout(400)
await pg.getByTestId('nav-collapse').click(); await pg.waitForTimeout(300)
await pg.screenshot({ path: '.shots/v4-collapsed.png', clip: { x: 0, y: 0, width: 980, height: 760 } })
await browser.close()
console.log('ERRORS:', errs.length ? errs.join('\n') : 'none')
