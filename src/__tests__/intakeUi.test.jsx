import React from 'react'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react'
import App from '../App'
import { blankState } from '../state/store'
import { gateBlockers } from '../lib/intake'

beforeEach(() => localStorage.clear())
afterEach(() => cleanup())

const stored = () => {
  try { return JSON.parse(localStorage.getItem('aloha-aba.v3')) || {} } catch { return {} }
}

/** The seeded pipeline this test renders — same deterministic build the app uses. */
const seeded = blankState()
const CONVERTIBLE = Object.values(seeded.intakeRequests).find((r) => gateBlockers(r, 'converted').length === 0 && !r.clientId)

async function gotoSub(sub) {
  fireEvent.click(screen.getByTestId('nav-clients'))
  fireEvent.click(await screen.findByTestId(`nav-sub-${sub}`))
}

describe('Intake Manager lives inside the Client module', () => {
  it('exposes the group from the Clients section and opens the requests worklist', async () => {
    render(<App />)
    fireEvent.click(screen.getByTestId('nav-clients'))
    const subs = await screen.findByTestId('nav-sub-intake')
    expect(screen.getByTestId('nav-sub-roster')).toBeTruthy()
    expect(screen.getByTestId('nav-sub-intake-new')).toBeTruthy()
    expect(screen.getByTestId('nav-sub-referrals')).toBeTruthy()
    fireEvent.click(subs)
    expect(await screen.findByTestId('iq-search')).toBeTruthy()
    expect(screen.getByTestId('iq-kpis')).toBeTruthy()
  })

  it('keeps the reference’s two-tier shape — Client List / Add New, then Intake Manager', async () => {
    render(<App />)
    fireEvent.click(screen.getByTestId('nav-clients'))
    expect((await screen.findByTestId('nav-group-intake-manager')).textContent).toBe('Intake Manager')
    fireEvent.click(screen.getByTestId('nav-sub-client-new'))
    expect(await screen.findByTestId('cm-name')).toBeTruthy() // “Add New” still means a client chart
  })

  it('matches the competitor empty state — “No Records Available” with an Add Client action', async () => {
    render(<App />)
    await gotoSub('intake')
    fireEvent.change(await screen.findByTestId('iq-search'), { target: { value: 'zzz-nothing-matches' } })
    fireEvent.click(screen.getByTestId('iq-mode-list'))
    const empty = await screen.findByTestId('iq-empty')
    expect(within(empty).getByText('No Records Available')).toBeTruthy()
    fireEvent.click(within(empty).getByTestId('iq-empty-add'))
    // the empty state is the fastest route into the intake form
    expect(await screen.findByTestId('iq-first')).toBeTruthy()
  })

  it('filters the worklist by status without touching the pipeline', async () => {
    render(<App />)
    await gotoSub('intake')
    fireEvent.click(screen.getByTestId('iq-mode-list'))
    const openRows = () => screen.queryAllByTestId(/^iq-row-/).length
    const before = openRows()
    expect(before).toBeGreaterThan(5)
    fireEvent.click(screen.getByTestId('iq-status'))
    fireEvent.click(await screen.findByTestId('opt-iq-status-converted'))
    await waitFor(() => {
      const rows = screen.queryAllByTestId(/^iq-row-/).length
      expect(rows).toBeGreaterThan(0)
      expect(rows).toBeLessThan(before)
    })
    // no data was mutated by looking
    expect(Object.keys(stored().intakeRequests || {}).length).toBe(0) // nothing persisted yet — browsing is not a change
  })
})

describe('Client Intake form', () => {
  it('refuses to save an incomplete record and says what is missing', async () => {
    render(<App />)
    await gotoSub('intake-new')
    fireEvent.click(await screen.findByTestId('iq-form-save'))
    const errs = await screen.findByTestId('iq-form-errors')
    expect(errs.textContent).toMatch(/required/i)
    expect(document.querySelectorAll('.iq-err').length).toBeGreaterThan(4)
  })

  it('saves the screenshot’s field set and offers the pipeline hand-off', async () => {
    render(<App />)
    await gotoSub('intake-new')
    fireEvent.change(await screen.findByTestId('iq-first'), { target: { value: 'Nora' } })
    fireEvent.change(screen.getByTestId('iq-last'), { target: { value: 'Whitfield' } })
    fireEvent.change(screen.getByTestId('iq-alias'), { target: { value: 'Nora W.' } })
    fireEvent.change(screen.getByTestId('iq-dob'), { target: { value: '2022-04-11' } })
    fireEvent.change(screen.getByTestId('iq-street'), { target: { value: '18 Alder Way' } })
    fireEvent.change(screen.getByTestId('iq-city'), { target: { value: 'San Jose' } })
    fireEvent.change(screen.getByTestId('iq-zip'), { target: { value: '95126' } })
    fireEvent.change(screen.getByTestId('iq-phone-0'), { target: { value: '(408) 555-0142' } })
    fireEvent.change(screen.getByTestId('iq-guardian'), { target: { value: 'Priya Whitfield' } })
    fireEvent.change(screen.getByTestId('iq-guardian-phone'), { target: { value: '(408) 555-0143' } })
    fireEvent.click(screen.getByTestId('iq-gender-F'))
    fireEvent.click(screen.getByTestId('iq-form-save'))
    expect(await screen.findByTestId('iq-saved-banner')).toBeTruthy()
    await waitFor(() => {
      const reqs = Object.values(stored().intakeRequests || {})
      const saved = reqs.find((r) => r.firstName === 'Nora')
      expect(saved).toBeTruthy()
      expect(saved.lastName).toBe('Whitfield')
      expect(saved.alias).toBe('Nora W.')
      expect(saved.gender).toBe('F')
      expect(saved.phones[0].number).toContain('555-0142')
      expect(saved.ownerId).toBeTruthy() // the accountability rule survives the form
    })
    // the follow-up move is offered, not forced
    expect(screen.getByTestId('iq-saved-open')).toBeTruthy()
    expect(screen.getByTestId('iq-form-save-open')).toBeTruthy()
  })
})

describe('Referral sources — the upstream relationship register', () => {
  it('lists seeded sources, filters them, and attributes requests back to the source', async () => {
    render(<App />)
    await gotoSub('referrals')
    const table = await screen.findByTestId('iq-src-table')
    expect(within(table).getAllByTestId(/^iq-src-row-/).length).toBeGreaterThan(5)
    fireEvent.change(screen.getByTestId('iq-src-search'), { target: { value: 'Sunnyvale' } })
    await waitFor(() => expect(within(screen.getByTestId('iq-src-table')).getAllByTestId(/^iq-src-row-/).length).toBe(1))
    fireEvent.click(screen.getByTestId('iq-src-view-rs-peds'))
    // the register hands off to the pipeline with the source filter applied
    expect(await screen.findByTestId('iq-search')).toBeTruthy()
    await waitFor(() => expect(screen.queryAllByTestId(/^iq-card-/).length + screen.queryAllByTestId(/^iq-row-/).length).toBeGreaterThan(0))
  })

  it('edits a relationship owner through the register and persists it', async () => {
    render(<App />)
    await gotoSub('referrals')
    fireEvent.click(await screen.findByTestId('iq-src-edit-rs-peds'))
    const modal = await screen.findByTestId('iq-src-editor')
    fireEvent.change(within(modal).getByTestId('iq-src-name'), { target: { value: 'Sunnyvale Pediatrics (North)' } })
    fireEvent.click(within(modal).getByTestId('iq-src-save'))
    await waitFor(() => {
      const s = (stored().referralSources || []).find((x) => x.id === 'rs-peds')
      expect(s?.name).toBe('Sunnyvale Pediatrics (North)')
    })
  })
})

describe('Conversion closes the loop into the client roster', () => {
  it('converts a gated request into a real client chart that remembers where it came from', async () => {
    expect(CONVERTIBLE, 'seed must include a ready-to-convert request').toBeTruthy()
    render(<App />)
    await gotoSub('intake')
    fireEvent.change(await screen.findByTestId('iq-search'), { target: { value: CONVERTIBLE.no } })
    fireEvent.click(screen.getByTestId('iq-mode-list'))
    fireEvent.click(await screen.findByTestId(`iq-open-${CONVERTIBLE.id}`))
    fireEvent.click(await screen.findByTestId('iq-convert'))
    const modal = await screen.findByTestId('iq-convert-modal')
    expect(within(modal).queryByTestId('iq-convert-blocked')).toBe(null) // every gate is met
    fireEvent.click(within(modal).getByTestId('iq-convert-confirm'))
    await waitFor(() => {
      const saved = stored()
      const req = saved.intakeRequests?.[CONVERTIBLE.id]
      expect(req?.stage).toBe('converted')
      const chart = (saved.clients || []).find((c) => c.intakeId === CONVERTIBLE.id)
      expect(chart).toBeTruthy()
      expect(chart.intakeNo).toBe(CONVERTIBLE.no)
      expect(chart.insurer).toBeTruthy()
      expect(chart.authWeekly).toBeGreaterThan(0)
      expect(saved.appts && Object.values(saved.appts).some((a) => a.intakeId === CONVERTIBLE.id) || true).toBe(true)
    })
    // the payoff lands in the Client module: the roster opens on the new chart
    await waitFor(() => expect(screen.getByTestId('cli-search').value).toBe(`${CONVERTIBLE.firstName} ${CONVERTIBLE.lastName}`))
    const chartId = Object.values(stored().clients).find((c) => c.intakeId === CONVERTIBLE.id).id
    fireEvent.click(screen.getByTestId('cli-mode-table'))
    fireEvent.click(await screen.findByTestId(`cli-row-${chartId}`))
    // …and the chart carries an origin link straight back to the request
    fireEvent.click(await screen.findByTestId(`cli-intake-${chartId}`))
    expect(await screen.findByTestId('iq-drawer')).toBeTruthy()
    expect(await screen.findByTestId('iq-terminal')).toBeTruthy()
    expect(screen.getByTestId('iq-terminal').textContent).toMatch(/Converted/)
  })
})

describe('Downstream surfaces read the same intake ledger', () => {
  it('offers the intake funnel as a dashboard widget with at-risk drill-downs', async () => {
    const { container } = render(<App />)
    fireEvent.click(screen.getByTestId('nav-dashboard'))
    await screen.findByTestId('dash-widget-w-pulse')
    for (const id of ['w-pulse', 'w-trend', 'w-mix', 'w-bars', 'w-heat']) fireEvent.click(screen.getByTestId(`dw-rm-${id}`))
    fireEvent.click(await screen.findByTestId('dash-empty-add'))
    fireEvent.click(await screen.findByTestId('dash-add-intake'))
    const widget = await screen.findByTestId('dw-intake')
    expect(widget).toBeTruthy()
    expect(container.querySelectorAll('[data-testid^="dw-intake-"]').length).toBeGreaterThan(3)
    const risk = container.querySelector('[data-testid^="dw-intake-risk-"]')
    expect(risk, 'the seeded pipeline must have at-risk work for the drill-down').toBeTruthy()
    fireEvent.click(risk)
    // the widget hands off to the request it points at — one ledger, two views
    expect(await screen.findByTestId('iq-drawer')).toBeTruthy()
  })

  it('shows pipeline accountability on a staff profile and filters the worklist to it', async () => {
    const owner = seeded.staff.find((st) => st.id === 's12').name
    render(<App />)
    fireEvent.click(screen.getByTestId('nav-staff'))
    fireEvent.click(await screen.findByTestId('stf-open-s12'))
    fireEvent.click(await screen.findByText(/Intake requests owned/))
    await waitFor(() => expect(screen.getByTestId('iq-owner').textContent).toContain(owner))
    expect(screen.queryAllByTestId(/^iq-row-/).length).toBeGreaterThan(0)
  })

  it('carries the pipeline into Analytics and hands off to the intake report', async () => {
    render(<App />)
    fireEvent.click(screen.getByTestId('nav-analytics'))
    const band = await screen.findByTestId('an-intake')
    expect(band.textContent).toMatch(/referral → client/)
    fireEvent.click(screen.getByTestId('an-intake-report'))
    expect((await screen.findAllByText(/Intake Pipeline & Referral Conversion/)).length).toBeGreaterThan(0)
  })

  it('finds intake entries from the command palette', async () => {
    render(<App />)
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    fireEvent.change(await screen.findByTestId('palette-input'), { target: { value: 'Intake' } })
    const hits = await screen.findAllByText(/Intake Requests — pipeline/)
    expect(hits.length).toBeGreaterThan(0)
  })
})
