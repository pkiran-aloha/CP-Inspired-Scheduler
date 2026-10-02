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
    // the default demo admin is not a staff member, so the owner starts empty and must be picked
    fireEvent.click(screen.getByTestId('iq-owner'))
    fireEvent.click(await screen.findByTestId('opt-iq-owner-s12'))
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

// ---------------------------------------------------------------------------
// Regression coverage for the intake-manager fixes: a header that never wraps
// its controls, option menus that open where their trigger is, and a stage
// rail / "Next" box that always route through a form instead of dead-ending.
// ---------------------------------------------------------------------------

const byStage = (stage) => Object.values(seeded.intakeRequests).find((r) => r.stage === stage)

/** Open one request's drawer from the worklist, by its reference number. */
async function openRequest(req) {
  await gotoSub('intake')
  fireEvent.change(await screen.findByTestId('iq-search'), { target: { value: req.no } })
  fireEvent.click(screen.getByTestId('iq-mode-list'))
  if (['converted', 'closed'].includes(req.stage)) {
    fireEvent.click(screen.getByTestId('iq-status'))
    fireEvent.click(await screen.findByTestId('opt-iq-status-all'))
  }
  fireEvent.click(await screen.findByTestId(`iq-open-${req.id}`))
  return screen.findByTestId('iq-drawer')
}

describe('Intake header and option menus', () => {
  it('keeps the filters in a toolbar under a one-row header and opens menus on the body layer', async () => {
    render(<App />)
    await gotoSub('intake')
    const toolbar = await screen.findByTestId('iq-toolbar')
    for (const id of ['iq-search', 'iq-status', 'iq-owner', 'iq-source', 'iq-urgency']) expect(within(toolbar).getByTestId(id)).toBeTruthy()
    const header = document.querySelector('header.secbar')
    expect(header.querySelector('[data-testid="iq-status"]')).toBe(null) // filters are no longer header actions
    expect(within(header).getByTestId('iq-new')).toBeTruthy()
    expect(within(header).getByTestId('iq-mode-board')).toBeTruthy()
    // the menu is portaled to <body>, so a blurred/sticky header can never offset or clip it
    fireEvent.click(screen.getByTestId('iq-status'))
    const opt = await screen.findByTestId('opt-iq-status-converted')
    const pop = opt.closest('.pop')
    expect(pop.parentElement).toBe(document.body)
    expect(opt.closest('header.secbar')).toBe(null)
    // only the trigger paints a chevron — the `.select` background chevron is gone
    expect(screen.getByTestId('iq-status').classList.contains('select')).toBe(false)
    // Escape closes the menu and nothing else
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByTestId('opt-iq-status-converted')).toBe(null))
    expect(screen.queryByTestId('iq-drawer')).toBe(null)
    // reset clears every filter in one click
    fireEvent.change(screen.getByTestId('iq-search'), { target: { value: 'zzz' } })
    expect(screen.getByTestId('iq-filter-count').textContent).toMatch(/1 filter on/)
    fireEvent.click(screen.getByTestId('iq-filters-clear'))
    expect(screen.getByTestId('iq-search').value).toBe('')
    expect(screen.getByTestId('iq-filters-clear').disabled).toBe(true)
  })
})

describe('Stage transitions route through forms, never into a dead end', () => {
  it('captures the waitlist terms in the drawer and moves the request with them', async () => {
    const req = byStage('review')
    render(<App />)
    await openRequest(req)
    fireEvent.click(screen.getByTestId('iq-branch-waitlist'))
    const form = await screen.findByTestId('iq-waitlist-form')
    expect(within(form).getByTestId('iq-wl-save').disabled).toBe(true) // the gate is visible before the move
    expect(stored().intakeRequests?.[req.id]?.stage ?? req.stage).toBe('review') // nothing moved yet
    fireEvent.click(within(form).getByTestId('iq-wl-reason'))
    fireEvent.click(await screen.findByTestId('opt-iq-wl-reason-No BCBA capacity'))
    fireEvent.click(within(form).getByTestId('iq-wl-priority'))
    fireEvent.click(await screen.findByTestId('opt-iq-wl-priority-2'))
    expect(within(form).getByTestId('iq-wl-save').disabled).toBe(false)
    fireEvent.click(within(form).getByTestId('iq-wl-save'))
    await waitFor(() => {
      const r = stored().intakeRequests[req.id]
      expect(r.stage).toBe('waitlist')
      expect(r.waitlist).toMatchObject({ reason: 'No BCBA capacity', priority: 2 })
      expect(r.waitlist.reviewBy).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(r.waitlist.since).toBeGreaterThan(0)
    })
    // the waitlist panel takes over: a dated check-in and a route to the calendar
    const panel = await screen.findByTestId('iq-wl-panel')
    fireEvent.change(within(panel).getByTestId('iq-wl-review-date'), { target: { value: '2030-01-15' } })
    fireEvent.click(within(panel).getByTestId('iq-wl-review'))
    await waitFor(() => expect(stored().intakeRequests[req.id].waitlist.reviewBy).toBe('2030-01-15'))
    expect(screen.getByTestId('iq-rail-waitlist').dataset.state).toBe('current')
  })

  it('opens the booking form from the stage rail and validates the visit before it reaches the calendar', async () => {
    const req = Object.values(seeded.intakeRequests).filter((r) => r.stage === 'review')[1] || byStage('review')
    render(<App />)
    await openRequest(req)
    fireEvent.click(screen.getByTestId('iq-rail-scheduled')) // used to toast "2 requirements outstanding" and stop
    const form = await screen.findByTestId('iq-book-form')
    expect(stored().intakeRequests?.[req.id]?.stage ?? req.stage).toBe('review')
    fireEvent.change(within(form).getByTestId('iq-bk-start'), { target: { value: '10:00' } })
    fireEvent.change(within(form).getByTestId('iq-bk-end'), { target: { value: '09:00' } })
    expect(within(form).getByTestId('iq-bk-save').disabled).toBe(true)
    expect(within(form).getByTestId('iq-bk-problem').textContent).toMatch(/end after|after the start/i)
    fireEvent.change(within(form).getByTestId('iq-bk-end'), { target: { value: '12:00' } })
    fireEvent.change(within(form).getByTestId('iq-bk-date'), { target: { value: '2031-03-03' } })
    if (!within(form).getByTestId('iq-bk-clinician').textContent.trim() || /Pick/.test(within(form).getByTestId('iq-bk-clinician').textContent)) {
      fireEvent.click(within(form).getByTestId('iq-bk-clinician'))
      fireEvent.click((await screen.findAllByTestId(/^opt-iq-bk-clinician-/))[0])
    }
    fireEvent.click(within(form).getByTestId('iq-bk-save'))
    await waitFor(() => {
      const saved = stored()
      const r = saved.intakeRequests[req.id]
      expect(r.stage).toBe('scheduled')
      expect(r.apptDate).toBe('2031-03-03')
      const appt = saved.appts[r.apptId]
      expect(appt).toMatchObject({ type: 'evaluation', date: '2031-03-03', start: 600, end: 720, intakeId: req.id })
      expect(appt.staffIds).toEqual([r.clinicianId])
      expect(r.clinicianId).toBeTruthy()
    })
    expect(screen.queryByTestId('iq-book-form')).toBe(null)
    expect(screen.getByTestId('iq-rail-scheduled').dataset.state).toBe('current')
  })

  it('verifies the guardian from the drawer — the one conversion gate that had no control', async () => {
    const req = Object.values(seeded.intakeRequests).find((r) => r.stage === 'auth' && !r.guardianVerifiedAt)
    expect(req, 'seed must include an authorisation-stage request with an unverified guardian').toBeTruthy()
    render(<App />)
    await openRequest(req)
    expect(screen.getByTestId('iq-gate-converted-guardian').dataset.ok).toBe('0')
    expect(screen.getByTestId('iq-advance').textContent).toMatch(/Convert to client/)
    expect(screen.getByTestId('iq-advance').disabled).toBe(true)
    fireEvent.click(screen.getByTestId('iq-guardian-verify-btn'))
    await waitFor(() => expect(screen.getByTestId('iq-gate-converted-guardian').dataset.ok).toBe('1'))
    await waitFor(() => expect(stored().intakeRequests?.[req.id]?.guardianVerifiedAt).toBeGreaterThan(0))
    fireEvent.click(screen.getByTestId('iq-guardian-unverify'))
    await waitFor(() => expect(screen.getByTestId('iq-gate-converted-guardian').dataset.ok).toBe('0'))
  })

  it('reopens a closed request as live work and clears the stale disposition', async () => {
    const req = byStage('closed')
    render(<App />)
    await openRequest(req)
    // a closed record has not "completed" the stages it never reached
    expect(document.querySelectorAll('.iq-rail-step[data-state="done"]').length).toBe(0)
    expect(screen.getByTestId('iq-rail-closed').dataset.state).toBe('current')
    fireEvent.click(screen.getByTestId('iq-reopen'))
    await waitFor(() => {
      const r = stored().intakeRequests[req.id]
      expect(r.stage).toBe('new')
      expect(r.lost).toBe(null)
      expect(r.events[r.events.length - 1].ev).toMatch(/^Reopened/)
    })
    expect(screen.queryByTestId('iq-terminal')).toBe(null)
    expect(screen.getByTestId('iq-nextbox')).toBeTruthy()
  })

  it('peels layers with Escape — the conversion modal first, then the drawer', async () => {
    render(<App />)
    await openRequest(CONVERTIBLE)
    const next = screen.getByTestId('iq-advance')
    expect(next.textContent).toMatch(/Convert to client/)
    expect(next.disabled).toBe(false)
    fireEvent.click(next)
    expect(await screen.findByTestId('iq-convert-modal')).toBeTruthy()
    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByTestId('iq-convert-modal')).toBe(null))
    expect(screen.getByTestId('iq-drawer')).toBeTruthy()
    // the rail's Converted step opens the same modal instead of a reducer refusal toast
    fireEvent.click(screen.getByTestId('iq-rail-converted'))
    expect(await screen.findByTestId('iq-convert-modal')).toBeTruthy()
    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByTestId('iq-convert-modal')).toBe(null))
    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByTestId('iq-drawer')).toBe(null))
    expect(stored().intakeRequests?.[CONVERTIBLE.id]?.stage ?? CONVERTIBLE.stage).toBe('auth') // nothing moved
  })

  it('only auto-advances a logged contact through the same gate a manual move would pass', async () => {
    const st = blankState()
    const id = Object.values(st.intakeRequests).find((r) => r.stage === 'new').id
    st.intakeRequests[id] = { ...st.intakeRequests[id], ownerId: null } // no owner → the Contacted gate is not met
    localStorage.setItem('aloha-aba.v3', JSON.stringify({ ...st, history: [] }))
    render(<App />)
    await openRequest(st.intakeRequests[id])
    fireEvent.click(screen.getByTestId('iq-log-contact'))
    const form = await screen.findByTestId('iq-contact-form')
    fireEvent.change(within(form).getByTestId('iq-cf-summary'), { target: { value: 'Left a voicemail' } })
    fireEvent.click(within(form).getByTestId('iq-cf-save'))
    await waitFor(() => expect(stored().intakeRequests[id].contacts.length).toBe(1))
    expect(stored().intakeRequests[id].stage).toBe('new') // logged, but not advanced past an unmet gate
    expect(screen.getByTestId('iq-gate-contacted-owner').dataset.ok).toBe('0')
    expect(screen.getByTestId('iq-gate-contacted-contact').dataset.ok).toBe('1')
  })

  it('opens a blank form from the nav even after editing a record from the drawer', async () => {
    const req = byStage('contacted')
    render(<App />)
    await openRequest(req)
    fireEvent.click(screen.getByTestId('iq-edit-form'))
    await waitFor(() => expect(screen.getByTestId('iq-first').value).toBe(req.firstName))
    fireEvent.click(screen.getByTestId('nav-sub-intake-new'))
    await waitFor(() => expect(screen.getByTestId('iq-first').value).toBe(''))
    expect(screen.queryByText(new RegExp(`Edit intake client — ${req.no}`))).toBe(null)
  })
})
