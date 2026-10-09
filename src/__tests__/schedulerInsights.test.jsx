import React from 'react'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import App from '../App'
import { blankState } from '../state/store'
import { AUTH_GUARD_DEFAULTS } from '../lib/authBudget'
import { addDays, isoDate, parseISO, todayISO } from '../lib/date'

const KEY = 'aloha-aba.v3'
const stored = () => { try { return JSON.parse(localStorage.getItem(KEY)) } catch { return null } }
let _r = null
const cleanup = () => { if (_r) { _r.unmount(); _r = null } }
beforeEach(() => { localStorage.clear(); cleanup() })
afterEach(() => cleanup())
const R = (ui) => { cleanup(); _r = render(ui); return _r }

const today = todayISO()
const day = (n) => isoDate(addDays(parseISO(today), n))

/**
 * A workspace built for the panel: the client at the top of the roster has an
 * authorization that already lapsed, three missed sessions in their history and one
 * unconfirmed session inside the visible range. Everything is pinned relative to today,
 * so the test does not care which weekday it runs on.
 */
function seed({ guardMode = 'warn' } = {}) {
  const s = blankState()
  const target = s.clients[0]
  const staffId = s.staff[0].id
  const appts = Object.fromEntries(Object.entries(s.appts).filter(([, a]) => !(a.clientIds || []).includes(target.id)))
  const mk = (id, date, extra = {}) => ({
    id, date, type: 'service', status: 'completed', title: 'ABA session',
    clientIds: [target.id], staffIds: [staffId], start: 540, end: 660,
    billing: { code: '97153', unitMins: 30, units: 4, rate: 18, mileage: false }, ...extra,
  })
  Object.assign(appts, {
    'si-p1': mk('si-p1', day(-9), { status: 'no-show' }),
    'si-p2': mk('si-p2', day(-7), { status: 'no-show' }),
    'si-p3': mk('si-p3', day(-4), { status: 'cancelled' }),
    'si-p4': mk('si-p4', day(-2), { status: 'completed' }),
    'si-f1': mk('si-f1', day(3), { status: 'active', title: 'ABA session — needs confirmation' }),
  })
  const clients = s.clients.map((c, i) => (i === 0 ? { ...c, authWeekly: 10, authStart: day(-63), authEnd: day(-2), authNo: 'AUTH-LAPSE-1' } : c))
  const out = {
    ...s,
    appts,
    clients,
    settings: { ...s.settings, authGuard: { ...AUTH_GUARD_DEFAULTS, mode: guardMode } },
    // a month grid always contains "today + 3 days", whatever weekday the suite runs on
    ui: { ...s.ui, section: 'calendar', view: 'month', anchor: day(2), insights: false },
    history: [],
  }
  localStorage.setItem(KEY, JSON.stringify(out))
  return out
}

const openPanel = async () => {
  R(<App />)
  fireEvent.click(await screen.findByTestId('insights-open'))
  return screen.findByTestId('scheduler-insights')
}

function seedDensity() {
  const s = blankState()
  const staffId = s.staff[0].id
  const [c1, c2] = s.clients
  const date = day(3)
  const mk = (id, client, start, end, title) => ({
    id, date, type: 'service', status: 'active', title,
    clientIds: [client.id], staffIds: [staffId], start, end, location: client.home || 'Main Center', service: 'dtt',
    notes: '', custom: {}, documents: [], verification: null,
    billing: { code: '97153', unitMins: 15, units: 4, rate: 9, mileage: false },
  })
  const out = {
    ...s,
    appts: {
      'den-early': mk('den-early', c1, 8 * 60, 9 * 60, 'Morning ABA'),
      'den-late': mk('den-late', c2, 14 * 60, 15 * 60, 'Afternoon ABA'),
    },
    ui: { ...s.ui, section: 'calendar', view: 'week', anchor: date, insights: false },
    history: [],
  }
  localStorage.setItem(KEY, JSON.stringify(out))
  return out
}

describe('scheduler insights panel', () => {
  it('opens from the calendar toolbar and leads with four honest KPIs', async () => {
    seed()
    await openPanel()
    expect(screen.getByTestId('si-kpi-fill')).toBeTruthy()
    expect(screen.getByTestId('si-kpi-open')).toBeTruthy()
    expect(screen.getByTestId('si-kpi-auth')).toBeTruthy()
    expect(screen.getByTestId('si-kpi-risk')).toBeTruthy()
    expect(screen.getByTestId('si-range').textContent).toMatch(/days/)
  })

  it('lets the scheduler choose the access holdout and saves it', async () => {
    seed()
    await openPanel()
    const row = screen.getByTestId('si-holdout')
    expect(row.textContent).toMatch(/10% of each hour from today on is kept for new starts and same-day needs/)
    fireEvent.click(screen.getByTestId('si-holdout-20'))
    await waitFor(() => expect(stored().settings.risk.holdoutPct).toBe(20))
    expect(screen.getByTestId('si-holdout').textContent).toMatch(/20% of each hour/)
    fireEvent.click(screen.getByTestId('si-holdout-0'))
    await waitFor(() => expect(stored().settings.risk.holdoutPct).toBe(0))
    expect(screen.getByTestId('si-holdout').textContent).toMatch(/off/)
  })

  it('shades the week and names the clinicians who are free', async () => {
    seed()
    await openPanel()
    fireEvent.click(screen.getByTestId('si-tab-coverage'))
    expect(await screen.findByTestId('si-heat')).toBeTruthy()
    expect(document.querySelectorAll('[data-testid^="si-gap-"]').length).toBeGreaterThan(0)
    expect(screen.getByText(/Bookable windows/)).toBeTruthy()
  })

  it('suggests and applies a same-day density move as a local calendar edit', async () => {
    seedDensity()
    await openPanel()
    fireEvent.click(screen.getByTestId('si-tab-density'))
    const row = await screen.findByTestId('si-density-den-late')
    expect(row.textContent).toMatch(/split|opens/i)
    expect(row.textContent).toMatch(/Move to/)
    fireEvent.click(screen.getByTestId('si-density-apply-den-late'))
    await waitFor(() => expect(stored().appts['den-late'].start).toBe(9 * 60))
    expect(stored().appts['den-late'].end).toBe(10 * 60)
    expect(await screen.findByText(/Moved locally into a denser block/i)).toBeTruthy()
  })

  it('reports the authorization that has already lapsed, and totals it in the KPI', async () => {
    seed()
    const target = blankState().clients[0]
    await openPanel()
    expect(screen.getByTestId('si-kpi-auth').textContent).toMatch(/[1-9]/)
    fireEvent.click(screen.getByTestId('si-tab-auth'))
    const row = await screen.findByTestId(`si-auth-${target.id}`)
    expect(row.textContent).toMatch(/Authorization lapsed/)
    expect(row.textContent).toMatch(/lapsed \d+d ago/)
    expect(row.textContent).toMatch(/10 h\/week authorized/)
  })

  it('can widen the authorization list from needs-action to every client', async () => {
    seed()
    await openPanel()
    fireEvent.click(screen.getByTestId('si-tab-auth'))
    await screen.findByTestId('si-auth-scope-action')
    const actionCount = document.querySelectorAll('[data-testid^="si-auth-"]').length
    fireEvent.click(screen.getByTestId('si-auth-scope-all'))
    await waitFor(() => expect(document.querySelectorAll('[data-testid^="si-auth-"]').length).toBeGreaterThan(actionCount))
  })

  it('surfaces the session most likely to fall through, explains why, and confirms it undoably', async () => {
    seed()
    await openPanel()
    fireEvent.click(screen.getByTestId('si-tab-risk'))
    const row = await screen.findByTestId('si-risk-si-f1')
    expect(row.textContent).toMatch(/Call the caregiver|Confirm before/)
    expect(row.textContent).toMatch(/This client’s own history|Recent missed sessions/)
    expect(screen.getByText(/no reminder is sent/i)).toBeTruthy()

    fireEvent.click(screen.getByTestId('si-confirm-si-f1'))
    await waitFor(() => expect(stored().appts['si-f1'].status).toBe('confirmed'))
    expect(await screen.findByText(/no reminder was sent to the family/i)).toBeTruthy()
  })

  it('says which cancellations the score spares, and how much notice the ledger holds', async () => {
    seed()
    await openPanel()
    fireEvent.click(screen.getByTestId('si-tab-risk'))
    const line = await screen.findByTestId('si-risk-notice')
    expect(line.textContent).toMatch(/family cancellation/)
    expect(line.textContent).toMatch(/not counted against the family|None gave more than/)
    expect(line.textContent).toMatch(/24h/)
    expect(line.textContent).toMatch(/Billing → Setup/)
    expect(line.textContent).toMatch(/Overbooking backtest/)
  })

  it('states plainly that nothing is transmitted and that the score is not clinical judgement', async () => {
    seed()
    await openPanel()
    expect(screen.getByText(/Nothing leaves this browser and nothing is transmitted/)).toBeTruthy()
    fireEvent.click(screen.getByTestId('si-tab-risk'))
    expect(await screen.findByText(/not a clinical judgement/)).toBeTruthy()
  })

  it('closes back to the calendar', async () => {
    seed()
    await openPanel()
    fireEvent.click(screen.getByLabelText('Close'))
    await waitFor(() => expect(screen.queryByTestId('scheduler-insights')).toBe(null))
  })
})

// Twelve weeks of the same weekday afternoon, twelve sessions each, at least one lost every
// week; twelve more booked today. Dates are relative to today, so any weekday works.
function seedOverbook(start = 15 * 60) {
  const s = blankState()
  const date = today
  const appts = {}
  const mk = (id, d, i, status) => ({
    id, date: d, type: 'service', status, title: 'ABA session',
    clientIds: [s.clients[i % s.clients.length].id], staffIds: [s.staff[i % s.staff.length].id], start, end: start + 120,
    location: 'Main Center', service: 'dtt', notes: '', custom: {}, documents: [], verification: null,
    billing: { code: '97153', unitMins: 15, units: 8, rate: 9, mileage: false },
  })
  for (let w = 1; w <= 12; w++) for (let i = 0; i < 12; i++) appts[`ob-${w}-${i}`] = mk(`ob-${w}-${i}`, day(-7 * w), i, i < (w <= 10 ? 2 : 1) ? 'no-show' : 'completed')
  for (let i = 0; i < 12; i++) appts[`ob-t-${i}`] = mk(`ob-t-${i}`, date, i, 'active')
  const clients = s.clients.map((c) => ({ ...c, office: 'Main Center' }))
  const out = { ...s, appts, clients, ui: { ...s.ui, section: 'calendar', view: 'week', anchor: date, insights: false }, history: [] }
  localStorage.setItem(KEY, JSON.stringify(out))
  return out
}

describe('overbooking guidance', () => {
  it('marks the block that loses a session every week, explains why, and writes nothing', async () => {
    seedOverbook()
    const before = JSON.stringify(stored().appts)
    await openPanel()
    fireEvent.click(screen.getByTestId('si-tab-overbook'))
    const row = await screen.findByTestId(`si-ob-${parseISO(today).getDay()}-afternoon`)
    expect(row.textContent).toMatch(/Room for one extra/)
    expect(row.textContent).toMatch(/In 12 of the last 12 weeks at least one session was lost here/)
    expect(screen.getByText(/never as a second client on the same clinician/)).toBeTruthy()
    expect(screen.queryByTestId('si-ob-empty')).toBe(null)
    expect(JSON.stringify(stored().appts)).toBe(before)
  })

  it('says why nothing qualifies when the history is thin', async () => {
    seed()
    await openPanel()
    fireEvent.click(screen.getByTestId('si-tab-overbook'))
    expect(await screen.findByTestId('si-ob-empty')).toBeTruthy()
  })

  it('flags a new clinical booking that lands in a marked block, in the booking dialog', async () => {
    seedOverbook(9 * 60) // the new-appointment dialog starts at 09:00 on the calendar's day
    R(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Appointment' }))
    fireEvent.click(await screen.findByTestId('type-service'))
    const box = await screen.findByTestId('appt-overbook')
    expect(box.textContent).toMatch(/In 12 of the last 12 weeks at least one session was lost here/)
    expect(box.textContent).toMatch(/never as a second client on the same clinician/)
  })

  it('stays quiet in the booking dialog when no block is marked', async () => {
    seed()
    R(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Appointment' }))
    fireEvent.click(await screen.findByTestId('type-service'))
    await screen.findByTestId('booking-checks')
    expect(screen.queryByTestId('appt-overbook')).toBe(null)
  })

  it('jumps to the block’s next day on the calendar', async () => {
    seedOverbook()
    await openPanel()
    fireEvent.click(screen.getByTestId('si-tab-overbook'))
    const row = await screen.findByTestId(`si-ob-${parseISO(today).getDay()}-afternoon`)
    fireEvent.click(within(row).getByRole('button', { name: /Show/ }))
    await waitFor(() => expect(screen.queryByTestId('scheduler-insights')).toBe(null))
  })

  it('lets the scheduler choose the confidence threshold and saves it', async () => {
    seedOverbook()
    await openPanel()
    fireEvent.click(screen.getByTestId('si-tab-overbook'))
    const row = await screen.findByTestId('si-ob-threshold')
    expect(row.textContent).toMatch(/must clear 80%/)
    expect(screen.getByTestId('si-ob-threshold-80').className).toBe('on')
    fireEvent.click(screen.getByTestId('si-ob-threshold-70'))
    await waitFor(() => expect(stored().settings.risk.overbookSafePct).toBe(70))
    expect(screen.getByTestId('si-ob-threshold').textContent).toMatch(/must clear 70%/)
    expect(screen.getByTestId('si-ob-threshold-70').className).toBe('on')
    expect(screen.getByTestId('si-ob-threshold-80').className).toBe('')
  })
})

describe('caseload ramp (D1)', () => {
  it('shows the 12-week ramp of known demand against supply, read-only', async () => {
    seed()
    const before = JSON.stringify(stored().appts)
    await openPanel()
    fireEvent.click(screen.getByTestId('si-tab-ramp'))
    const list = await screen.findByTestId('si-ramp-list')
    expect(within(list).getAllByTestId(/^si-ramp-w-/).length).toBe(12)
    expect(screen.getByTestId('si-ramp-summary')).toBeTruthy()
    // honest copy: a ramp from known work, never a forecast, renewals never assumed
    expect(list.parentElement.textContent).toMatch(/not a forecast/)
    expect(list.parentElement.textContent).toMatch(/never assumed/)
    expect(list.parentElement.textContent).toMatch(/Nothing here is booked, moved or sent/)
    expect(JSON.stringify(stored().appts)).toBe(before)
    const hire = screen.getByTestId('si-hire-verdict')
    expect(hire).toBeTruthy()
    expect(hire.getAttribute('data-verdict')).toMatch(/neither|hire|reshape|thin/)
    expect(screen.getByTestId('si-hire-reason').textContent.length).toBeGreaterThan(20)
    expect(list.parentElement.textContent).toMatch(/Before you hire|Do not hire|template|hours gap|not enough/i)
  })

  it('says when there is no known demand to ramp', async () => {
    const s = blankState()
    localStorage.setItem(KEY, JSON.stringify({
      ...s,
      clients: [],
      intakeRequests: {},
      ui: { ...s.ui, section: 'calendar', view: 'month', anchor: day(2), insights: false },
      history: [],
    }))
    await openPanel()
    fireEvent.click(screen.getByTestId('si-tab-ramp'))
    expect(await screen.findByTestId('si-ramp-empty')).toBeTruthy()
  })
})

describe('the authorization guard inside the booking dialog', () => {
  /** Book a service session for the client whose authorization has already lapsed. */
  const bookForLapsedClient = async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Appointment' }))
    fireEvent.click(await screen.findByTestId('type-service'))
    for (const picker of ['pick-Staff Name', 'pick-Client Name']) {
      fireEvent.click(screen.getByTestId(picker))
      fireEvent.click((await screen.findAllByTestId('people-item'))[0])
      fireEvent.mouseDown(document.body)
    }
    return screen.findByTestId('appt-auth-guard')
  }

  it('judges a clinical session against the authorization the moment a client is picked', async () => {
    seed()
    R(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Appointment' }))
    fireEvent.click(await screen.findByTestId('type-service'))
    fireEvent.click(screen.getByTestId('pick-Staff Name'))
    fireEvent.click((await screen.findAllByTestId('people-item'))[0])
    fireEvent.mouseDown(document.body)
    fireEvent.click(screen.getByTestId('pick-Client Name'))
    fireEvent.click((await screen.findAllByTestId('people-item'))[0])
    fireEvent.mouseDown(document.body)
    const box = await screen.findByTestId('appt-auth-guard')
    expect(box.textContent).toMatch(/after the authorization ends/)
    // the ⚡ ABA Hours flag is staff behavior-analytic time and is not part of this verdict
    expect(box.textContent).not.toMatch(/ABA Hr/)
    expect(screen.queryByTestId('am-count-aba')).toBe(null)
  })

  it('shows the burn-down once the session is counted', async () => {
    seed({ guardMode: 'warn' })
    R(<App />)
    const box = await bookForLapsedClient()
    expect(box.textContent).toMatch(/after the authorization ends/)
    expect(box.textContent).toMatch(/committed ·/)
  })

  it('refuses the booking entirely when the practice runs the guard in Stop mode', async () => {
    seed({ guardMode: 'stop' })
    R(<App />)
    await bookForLapsedClient()
    const before = Object.keys(stored().appts).length
    fireEvent.click(screen.getByTestId('save-appt'))
    expect(await screen.findByText(/is past the authorization on file/)).toBeTruthy()
    expect(Object.keys(stored().appts).length).toBe(before)
  })

  it('lets the booking through in the shipped Warn mode, with the reason on screen', async () => {
    seed({ guardMode: 'warn' })
    R(<App />)
    await bookForLapsedClient()
    const before = Object.keys(stored().appts).length
    fireEvent.click(screen.getByTestId('save-appt'))
    await waitFor(() => expect(Object.keys(stored().appts).length).toBe(before + 1))
  })
})

describe('the authorization guard in Settings', () => {
  it('exposes the guard strength and thresholds, and persists a change', async () => {
    seed()
    R(<App />)
    fireEvent.click(await screen.findByTestId('nav-settings'))
    fireEvent.click(await screen.findByTestId('nav-sub-set-system'))
    await screen.findByTestId('set-sys-authguard')
    const seg = await screen.findByTestId('set-auth-mode')
    expect(seg.textContent).toMatch(/Stop/)
    fireEvent.click(within(seg).getByRole('button', { name: 'Stop' }))
    await waitFor(() => expect(stored().settings.authGuard.mode).toBe('stop'))
    expect(screen.getByTestId('set-auth-note').textContent).toMatch(/never contacts a payer/)
  })
})
