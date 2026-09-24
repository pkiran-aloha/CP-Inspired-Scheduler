import React from 'react'
import { render, screen, fireEvent, waitFor, within, cleanup } from '@testing-library/react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import App from '../App'

const KEY = 'aloha-aba.v3'
const stored = () => JSON.parse(localStorage.getItem(KEY) || '{}')

beforeEach(() => {
  localStorage.clear()
  window.URL.createObjectURL = vi.fn(() => 'blob:test')
  window.URL.revokeObjectURL = vi.fn()
})
afterEach(() => cleanup())

describe('navigation rail', () => {
  it('switches sections and the collapse state persists', async () => {
    render(<App />)
    expect(screen.getByTestId('navrail')).toBeTruthy()
    fireEvent.click(screen.getByTestId('nav-reports'))
    expect(await screen.findByTestId('rp-table')).toBeTruthy()
    fireEvent.click(screen.getByTestId('nav-analytics'))
    expect(await screen.findByTestId('an-kpi-sessions')).toBeTruthy()
    fireEvent.click(screen.getByTestId('nav-collapse'))
    await waitFor(() => expect(stored().ui.nav).toBe(true))
    expect(document.querySelector('.navrail').classList.contains('collapsed')).toBe(true)
  })

  it('number keys jump sections (keyboard-first parity with the old calendar shortcuts)', async () => {
    render(<App />)
    fireEvent.keyDown(window, { key: '2' })
    expect(await screen.findByTestId('clients-cards')).toBeTruthy()
    fireEvent.keyDown(window, { key: '1' })
    expect(await screen.findByTestId('needs-cover')).toBeTruthy() // back on calendar chrome
  })
})

describe('default views (chunk 28)', () => {
  it('Clients opens on people cards, Staff too — table stays one click away', async () => {
    render(<App />)
    fireEvent.click(screen.getByTestId('nav-clients'))
    const cards = await screen.findByTestId('clients-cards')
    expect(cards.querySelectorAll('[data-testid^="cli-card-"]').length).toBeGreaterThan(0)
    expect(screen.queryByTestId('clients-table')).toBeNull()
    fireEvent.click(screen.getByTestId('cli-mode-table'))
    expect(screen.getByTestId('clients-table')).toBeTruthy()
    fireEvent.click(screen.getByTestId('nav-staff'))
    const scards = await screen.findByTestId('staff-cards')
    expect(scards.querySelectorAll('[data-testid^="stf-card-"]').length).toBeGreaterThan(0)
    fireEvent.click(screen.getByTestId('stf-mode-table'))
    expect(screen.getByTestId('staff-table')).toBeTruthy()
  })
})

describe('clients directory', () => {
  it('searches, opens detail rows and adds a client with live validation', async () => {
    const { container } = render(<App />)
    fireEvent.click(screen.getByTestId('nav-clients'))
    fireEvent.click(screen.getByTestId('cli-mode-table'))
    await screen.findByTestId('clients-table')
    expect(container.querySelectorAll('[data-testid^="cli-row-"]').length).toBe(16)
    fireEvent.change(screen.getByTestId('cli-search'), { target: { value: 'Justin' } })
    await waitFor(() => expect(container.querySelectorAll('[data-testid^="cli-row-"]').length).toBe(1))
    fireEvent.change(screen.getByTestId('cli-search'), { target: { value: '' } })
    // expand a row → flags + upcoming + report action
    fireEvent.click(screen.getByTestId('cli-row-c1'))
    expect(await screen.findByText(/Auth report/)).toBeTruthy()
    // add flow: required field validation blocks save, then persists
    fireEvent.click(screen.getByTestId('cli-new'))
    fireEvent.click(screen.getByTestId('cm-save')) // still the form state — name empty
    expect(screen.getByTestId('cm-name').closest('label').textContent).toMatch(/required/i)
    fireEvent.change(screen.getByTestId('cm-name'), { target: { value: 'Zoe Tester' } })
    fireEvent.change(screen.getByTestId('cm-authWeekly'), { target: { value: '14' } })
    fireEvent.click(screen.getByTestId('cm-save'))
    await waitFor(() => expect(container.querySelectorAll('[data-testid^="cli-row-"]').length).toBe(17))
    await waitFor(() => expect(stored().clients.some((c) => c.name === 'Zoe Tester')).toBe(true))
  })
})

describe('staff directory', () => {
  it('lists the roster with utilization and edits persist', async () => {
    const { container } = render(<App />)
    fireEvent.click(screen.getByTestId('nav-staff'))
    fireEvent.click(screen.getByTestId('stf-mode-table'))
    await screen.findByTestId('staff-table')
    expect(container.querySelectorAll('[data-testid^="stf-row-"]').length).toBe(12)
    fireEvent.click(screen.getByTestId('stf-row-s3'))
    fireEvent.click(await screen.findByTestId('stf-edit-s3'))
    fireEvent.change(screen.getByTestId('sm-targetWeekH'), { target: { value: '40' } })
    fireEvent.click(screen.getByTestId('sm-save'))
    await waitFor(() => expect(stored().staff.find((x) => x.id === 's3').targetWeekH).toBe(40))
    expect(await screen.findByText(/Saija Kotha updated/)).toBeTruthy()
  })
})

describe('reports desk', () => {
  it('clients & staff rosters switch to a modern card layout', async () => {
    const { container } = render(<App />)
    fireEvent.click(screen.getByTestId('nav-clients'))
    fireEvent.click(screen.getByTestId('cli-mode-table'))
    await screen.findByTestId('clients-table')
    fireEvent.click(screen.getByTestId('cli-mode-cards'))
    const cards = await screen.findByTestId('clients-cards')
    expect(cards.querySelectorAll('.lk-card').length).toBe(16)
    expect(cards.textContent).toContain('Justin Hsu')
    expect(cards.textContent).toContain('auth burn')
    expect(container.querySelector('[data-testid="clients-table"]')).toBeFalsy() // modes are exclusive
    fireEvent.click(screen.getByTestId('cli-mode-table'))
    expect(await screen.findByTestId('clients-table')).toBeTruthy()
    fireEvent.click(screen.getByTestId('nav-staff'))
    fireEvent.click(screen.getByTestId('stf-mode-table'))
    await screen.findByTestId('staff-table')
    fireEvent.click(screen.getByTestId('stf-mode-cards'))
    const scards = await screen.findByTestId('staff-cards')
    expect(scards.querySelectorAll('.lk-card').length).toBe(12)
    expect(scards.textContent).toContain('utilized')
    // clicking a card filters the calendar board to that person
    fireEvent.click(scards.querySelector('[data-testid^="stf-card-"]'))
    await waitFor(() => expect(stored().ui.staffSel.length).toBe(1))
    expect(screen.getByTestId('navrail')).toBeTruthy()
  })

  it('reports landing: chart-free KPI cards with polarity deltas, zero graphing', async () => {
    const { container } = render(<App />)
    fireEvent.click(screen.getByTestId('nav-reports'))
    await screen.findByTestId('rp-table')
    expect(container.querySelector('.rp-kpi .rp-kpi-ic')).toBeTruthy()
    // delta pills exist and are polarity-colored for issue counts (Errors up = bad)
    const delta = container.querySelector('.rp-kpi .rp-kpi-delta')
    expect(delta).toBeTruthy()
    expect(['good', 'bad', 'flat'].includes(delta.classList[1])).toBe(true)
    // ALL charting/graphing is gone from the landing — bars, sparks, svg of any kind
    expect(container.querySelector('.rp-trends')).toBeFalsy()
    expect(container.querySelector('.rt-bars')).toBeFalsy()
    expect(container.querySelector('.rp-spark')).toBeFalsy()
    expect(container.querySelector('.rp-kpi svg.rp-spark')).toBeFalsy()
    expect(container.querySelector('section[data-testid="rp-trends"]')).toBeFalsy()
    // the trend numbers live on as a slim text strip (no graphics)
    const strip = screen.getByTestId('rp-deltas')
    expect(strip).toBeTruthy()
    expect(strip.textContent).toMatch(/vs previous \d+-day window/i)
    expect(screen.getByTestId('rp-delta-rows')).toBeTruthy()
    expect(strip.querySelector('.rp-spark, .rt-chart, .rt-bars')).toBeFalsy() // chips are pure type — no plots
  })

  it('agenda shows a per-day session count badge', async () => {
    const { container } = render(<App />)
    fireEvent.click(screen.getByRole('tab', { name: 'Agenda' }))
    const badge = await screen.findByTestId('ag-count-' + new Date().toISOString().slice(0, 10))
    expect(Number(badge.textContent)).toBeGreaterThan(0)
  })
  it('severity filters and inline verify work on the quality desk (chart removed)', async () => {
    const { container } = render(<App />)
    fireEvent.click(screen.getByTestId('nav-reports'))
    await screen.findByTestId('rp-table') // default template is the quality ledger
    expect(screen.getByTestId('rp-delta-rows')).toBeTruthy() // prior-window comparison strip
    const all = () => container.querySelectorAll('[data-testid^="rp-row-"]').length
    const total = all()
    // severity quick filter → only errors remain
    fireEvent.click(screen.getByTestId('rp-f-sev-error'))
    await waitFor(() => expect(all()).toBeLessThan(total))
    const sevs = [...container.querySelectorAll('[data-testid^="rp-row-"] .sev-pill')].map((e) => e.textContent)
    expect(sevs.length).toBeGreaterThan(0)
    expect(sevs.every((x) => x === 'error')).toBe(true)
    // search within the filtered results
    fireEvent.change(screen.getByTestId('rp-f-q'), { target: { value: 'meg jones' } })
    await waitFor(() => expect(all()).toBeGreaterThan(0))
    for (const el of container.querySelectorAll('[data-testid^="rp-row-"]')) expect(el.textContent.toLowerCase()).toContain('meg jones')
    fireEvent.click(screen.getByTestId('rp-f-clear'))
    await waitFor(() => expect(all()).toBe(total))
    // inline resolve: verify & sign a flagged session — the row clears on re-run
    const vbtn = container.querySelector('[data-testid^="rp-vfy-"]')
    expect(vbtn).toBeTruthy()
    fireEvent.click(vbtn)
    await waitFor(() => expect(all()).toBeLessThan(total))
    expect(await screen.findByText(/Verified & signed/)).toBeTruthy()
    fireEvent.click(await screen.findByText('Undo'))
    await waitFor(() => expect(all()).toBe(total))
  })

  it('runs a template, saves a preset, and exports CSV', async () => {
    const { container } = render(<App />)
    fireEvent.click(screen.getByTestId('nav-reports'))
    await screen.findByTestId('rp-table')
    fireEvent.change(screen.getByTestId('rp-search'), { target: { value: 'authorization burn' } })
    fireEvent.click(screen.getByTestId('rp-def-auth'))
    // catalog entry + toolbar header both show the name
    expect((await screen.findAllByText(/Authorization Burn-down/)).length).toBeGreaterThanOrEqual(2)
    expect(container.querySelectorAll('[data-testid^="rp-row-"]').length).toBe(16) // one per client
    // save as a preset → appears in the catalog and persists
    fireEvent.click(screen.getByTestId('rp-save'))
    fireEvent.change(screen.getByTestId('rp-save-name'), { target: { value: 'Weekly auth watch' } })
    fireEvent.click(screen.getByTestId('rp-save-go'))
    expect(await screen.findByText('Weekly auth watch')).toBeTruthy()
    await waitFor(() => expect(stored().reports.saved[0].reportId).toBe('auth'))
    // CSV export through the shared download util
    fireEvent.click(screen.getByTestId('rp-csv'))
    await waitFor(() => expect(window.URL.createObjectURL).toHaveBeenCalled())
    expect(await screen.findByText(/rows exported as CSV/)).toBeTruthy()
    // Excel + PDF exports use the same spec (styled workbook / letter landscape)
    fireEvent.click(screen.getByTestId('rp-xls'))
    expect(await screen.findByText(/Excel workbook exported/)).toBeTruthy()
    fireEvent.click(screen.getByTestId('rp-pdf'))
    expect(await screen.findByText(/PDF exported/)).toBeTruthy()
  })

  it('scoping by staff narrows the ledger report', async () => {
    const { container } = render(<App />)
    fireEvent.click(screen.getByTestId('nav-reports'))
    await screen.findByTestId('rp-table')
    fireEvent.click(screen.getByTestId('rp-def-attendance'))
    await waitFor(() => expect(screen.getByTestId('rp-summary').textContent).toMatch(/Ledger lines/))
    const all = container.querySelectorAll('[data-testid^="rp-row-"]').length
    fireEvent.change(screen.getByTestId('rp-scope-staff'), { target: { value: 's4' } })
    await waitFor(() => {
      const scoped = container.querySelectorAll('[data-testid^="rp-row-"]').length
      expect(scoped).toBeGreaterThan(0)
      expect(scoped).toBeLessThan(all)
    })
  })
})

describe('billing workspace', () => {
  it('stages → assembles claim forms → submits → posts payment → full undo', async () => {
    const { container } = render(<App />)
    fireEvent.click(screen.getByTestId('nav-billing'))
    await screen.findByTestId('bil-row-0')
    await new Promise((r) => setTimeout(r, 320)) // let the debounced save flush so stored() reflects reality
    const n0 = container.querySelectorAll('[data-testid^="bil-row-"]').length
    const claimsBefore = Object.keys(stored().claims || {}).length
    expect(claimsBefore).toBeGreaterThan(0)

    // assemble every staging line into claim forms
    fireEvent.click(screen.getByTestId('bil-pickall'))
    fireEvent.click(screen.getByTestId('bil-generate'))
    expect(await screen.findByText(/claim forms? assembled/)).toBeTruthy()

    // we land on the claims desk with the new drafts on top, and the source
    // sessions are now reserved (claimId set, off the staging list)
    await screen.findByTestId('clm-row-0')
    await waitFor(() => expect(Object.values(stored().appts).some((a) => a.billing?.status === 'claimed')).toBe(true))

    // target the Aetna draft explicitly — assembly order is payer-keyed and row 0 can
    // land on the self-pay invoice depending on what else the suite did to state
    const deskCards = [...container.querySelectorAll('[data-testid^="clm-row-"]')]
    const aetnaCard = deskCards.find((el) => el.textContent.includes('Aetna'))
    expect(aetnaCard).toBeTruthy()
    fireEvent.click(aetnaCard)
    await waitFor(() => expect(screen.getByTestId('clm-form').textContent).toMatch(/Aetna/))
    // submit it → gates pass → status flips on the form
    fireEvent.click(screen.getByTestId('clm-submit'))
    expect(await screen.findByText(/submitted to Aetna/)).toBeTruthy() // status label (not the toast) — deterministic
    await waitFor(() => expect(screen.getByTestId('clm-form').textContent).toMatch(/Submitted/))

    // post the remittance with the full-charge quick preset
    fireEvent.click(screen.getByTestId('clm-pay'))
    await screen.findByTestId('pay-modal')
    fireEvent.click(screen.getByTestId('pay-quick-full'))
    fireEvent.click(screen.getByTestId('pay-post'))
    expect(await screen.findByText(/paid —/)).toBeTruthy()
    await waitFor(() => expect(screen.getByTestId('clm-form').textContent).toMatch(/Paid/))
    expect(screen.getByTestId('clm-timeline').querySelectorAll('li').length).toBeGreaterThanOrEqual(3)

    // undo pay, submit and the assembly — the staging list must return untouched
    for (let i = 0; i < 3; i++) {
      fireEvent.keyDown(window, { key: 'u' })
      await new Promise((r) => setTimeout(r, 30))
    }
    await waitFor(() => expect(Object.keys(stored().claims).length).toBe(claimsBefore), { timeout: 2000 })
    fireEvent.click(screen.getByTestId('bil-tab-stage'))
    await waitFor(() => expect(container.querySelectorAll('[data-testid^="bil-row-"]').length).toBe(n0))
  })

  it('a gate-held draft refuses submission and names the failing line', async () => {
    render(<App />)
    fireEvent.click(screen.getByTestId('nav-billing'))
    await screen.findByTestId('bil-tab-claims')
    fireEvent.click(screen.getByTestId('bil-tab-claims'))
    fireEvent.click(screen.getByTestId('clm-filter-draft'))
    // the demo seeds one draft whose line failed the verification gate → ⚠ chip
    const rows = await waitFor(() => {
      const found = [...document.querySelectorAll('[data-testid^="clm-row-"]')].filter((el) => el.textContent.includes('⚠'))
      if (!found.length) throw new Error('no gated draft found')
      return found
    })
    fireEvent.click(rows[0])
    await waitFor(() => expect(screen.getByTestId('clm-banner').textContent).toMatch(/Submission held/))
    fireEvent.click(screen.getByTestId('clm-submit'))
    expect(await screen.findByText(/held by gates/)).toBeTruthy()
    // still a draft — the gate refused it
    expect(screen.getByTestId('clm-form').textContent).toMatch(/Draft/)
  })

  it('denied claim: mark a disputed line, rebill drops it to staging as -R2', async () => {
    const { container } = render(<App />)
    fireEvent.click(screen.getByTestId('nav-billing'))
    await screen.findByTestId('bil-tab-claims')
    fireEvent.click(screen.getByTestId('bil-tab-claims'))
    fireEvent.click(screen.getByTestId('clm-filter-denied'))
    const rows = await waitFor(() => {
      const found = [...document.querySelectorAll('[data-testid^="clm-row-"]')]
      return found.length ? found : (() => { throw new Error('no denied claims') })()
    })
    fireEvent.click(rows[0])
    const form = await screen.findByTestId('clm-form')
    expect(form.textContent).toMatch(/Denied/)
    const beforeClaimed = container.querySelectorAll('.cd-lines .cb').length
    expect(beforeClaimed).toBeGreaterThanOrEqual(1)
    // mark the first line disputed → rebill
    fireEvent.click(container.querySelector('[data-testid="clm-dispute-0"]'))
    fireEvent.click(screen.getByTestId('clm-rebill'))
    expect(await screen.findByText(/drafted from/)).toBeTruthy()
    await waitFor(() => {
      const st = stored()
      const rebill = Object.values(st.claims).find((c) => /-R2$/.test(c.no))
      expect(rebill).toBeTruthy()
      expect(rebill.status).toBe('draft')
      expect(rebill.version).toBe(2)
      const parent = Object.values(st.claims).find((c) => c.no === rebill.parentNo)
      expect(parent.status).toBe('void')
      // the dropped line went home to staging
      expect(Object.values(st.appts).some((a) => a.billing?.status !== 'claimed' && a.claimId == null)).toBe(true)
    })
    // and the desk shows the R2 draft selected with its lineage chip
    expect(screen.getByTestId('clm-form').textContent).toMatch(/-R2/)
    expect(screen.getByTestId('clm-form').textContent).toMatch(/Prior claim/)
  })

  it('setup edits flow into settings (rate + verification gate)', async () => {
    render(<App />)
    fireEvent.click(screen.getByTestId('nav-billing'))
    await screen.findByTestId('bil-tab-setup')
    fireEvent.click(screen.getByTestId('bil-tab-setup'))
    fireEvent.change(screen.getByTestId('bi-mileageRate'), { target: { value: '0.8' } })
    fireEvent.click(screen.getByTestId('bi-requirever'))
    await waitFor(() => expect(stored().settings.mileageRate).toBe(0.8))
    await waitFor(() => expect(stored().settings.billing.requireVerification).toBe(false))
  })

  it('blocked lines get auto-fixed from the code table (billing completeness gate)', async () => {
    // inject a completed session with 0 units — exactly what the blocked-claims validation targets
    const { blankState } = await import('../state/store')
    const { todayISO } = await import('../lib/date')
    const st = blankState()
    st.appts.zx1 = { id: 'zx1', type: 'service', title: '1:1 Discrete Trial Training', date: todayISO(), start: 540, end: 600, status: 'completed', staffIds: ['s3'], clientIds: ['c1'], billing: { code: '97151', unitMins: 30, minutes: 60, units: 0, rate: 32 }, verification: { verifyStatus: 'verified' }, notes: 'ok', documents: [], custom: {} }
    localStorage.setItem(KEY, JSON.stringify({ ...st, history: [] }))
    const { container } = render(<App />)
    fireEvent.click(screen.getByTestId('nav-billing'))
    await screen.findByTestId('bil-tab-blocked')
    fireEvent.click(screen.getByTestId('bil-tab-blocked'))
    await waitFor(() => expect(container.querySelectorAll('[data-testid^="blk-fix-"]').length).toBeGreaterThan(0))
    const before = container.querySelectorAll('[data-testid^="blk-row-"]').length
    fireEvent.click(container.querySelector('[data-testid^="blk-fix-"]'))
    expect(await screen.findByText(/Units auto-filled/)).toBeTruthy()
    // the fixed line drops out of Blocked (it now moves to claim-ready instead)
    await waitFor(() => expect(container.querySelectorAll('[data-testid^="blk-row-"]').length).toBe(before - 1))
  })
})

describe('analytics ↔ other sections', () => {
  it('“Report this” hands the drilled entity to the report desk', async () => {
    render(<App />)
    fireEvent.click(screen.getByTestId('nav-analytics'))
    await screen.findByTestId('an-trend')
    fireEvent.click(screen.getByTestId('an-row-s1'))
    expect(await screen.findByTestId('an-drill')).toBeTruthy()
    fireEvent.click(screen.getByTestId('an-to-reports'))
    expect(await screen.findByTestId('rp-table')).toBeTruthy()
    expect(screen.getByTestId('rp-clearscope').textContent).toMatch(/Scoped from Analytics/)
    fireEvent.click(screen.getByTestId('rp-clearscope'))
    await waitFor(() => expect(screen.queryByTestId('rp-clearscope')).toBeNull())
  })

  it('Open in calendar applies the drill as a live calendar filter', async () => {
    render(<App />)
    fireEvent.click(screen.getByTestId('nav-analytics'))
    await screen.findByTestId('an-trend')
    fireEvent.click(screen.getByTestId('an-row-s1'))
    fireEvent.click(screen.getByTestId('an-to-cal'))
    await waitFor(() => expect(stored().ui.section).toBe('calendar'))
    await waitFor(() => expect(stored().ui.staffSel).toEqual(['s1']))
  })
})
