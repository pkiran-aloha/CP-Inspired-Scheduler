import { describe, it, expect } from 'vitest'
import { coverageBoard, forwardDays, holdoutPctOf, insightBoard } from '../lib/insights'
import { densityBoard, planDensityMove } from '../lib/density'

const TODAY = '2026-06-15' // a Monday
const MON = '2026-06-15'
const appt = (id, extra = {}) => ({
  id, date: MON, type: 'service', status: 'active', abaHr: true, start: 540, end: 600, staffIds: ['s1'], clientIds: ['c1'],
  billing: { code: '97153', units: 2, rate: 18 }, ...extra,
})
const state = (appts = [], extra = {}) => ({
  appts: Object.fromEntries(appts.map((a) => [a.id, a])),
  clients: [{ id: 'c1', name: 'Client One', authWeekly: 20, authStart: '2026-06-01', authEnd: '2026-09-01' }],
  staff: [{ id: 's1', name: 'Sam Staff' }, { id: 's2', name: 'Tess Tech' }],
  teams: [],
  settings: { workday: [8, 18], weekStart: 0 },
  ...extra,
})

describe('capacity coverage', () => {
  it('sells staff-minutes against the staff-minutes that existed', () => {
    const c = coverageBoard(state([appt('a')]), [MON], { today: TODAY })
    // two clinicians × ten hours = 20 staff-hours available, one session-hour sold
    expect(c.summary.availableHours).toBe(20)
    expect(c.summary.bookedHours).toBe(1)
    expect(c.summary.openHours).toBe(19)
    expect(c.summary.fillPct).toBe(5)
    expect(c.perDay[0]).toMatchObject({ date: MON, dow: 1, sessions: 1, bookedHours: 1 })
  })
  it('counts a session once for each attending clinician', () => {
    const c = coverageBoard(state([appt('a', { staffIds: ['s1', 's2'] })]), [MON], { today: TODAY })
    expect(c.summary.bookedHours).toBe(2)
  })
  it('removes blocked time from the denominator instead of pretending it was sellable', () => {
    const c = coverageBoard(state([appt('off', { type: 'unavailable', start: 480, end: 600, clientIds: [] })]), [MON], { today: TODAY })
    expect(c.summary.availableHours).toBe(18) // s1 is out for 8–10
    expect(c.summary.bookedHours).toBe(0)
  })
  it('treats travel and breaks as sold time even though they earn nothing', () => {
    const c = coverageBoard(state([appt('d', { type: 'drive', start: 600, end: 660, billing: null })]), [MON], { today: TODAY })
    expect(c.summary.bookedHours).toBe(1)
    expect(c.perDay[0].sessions).toBe(0) // travel is not a delivered session
  })
  it('never counts a cancelled booking as coverage', () => {
    const c = coverageBoard(state([appt('x', { status: 'cancelled' })]), [MON], { today: TODAY })
    expect(c.summary.bookedHours).toBe(0)
    expect(c.needsCover ?? null).toBe(null)
  })
  it('finds the idle windows a scheduler could actually book into, named per clinician', () => {
    const c = coverageBoard(state([appt('a', { start: 480, end: 720, staffIds: ['s1'] })]), [MON], { today: TODAY })
    expect(c.gaps.length).toBe(2)
    // the clinician who is busy until noon, and the one who is free all day
    const sam = c.gaps.find((g) => g.staffId === 's1')
    const tess = c.gaps.find((g) => g.staffId === 's2')
    expect(sam).toMatchObject({ date: MON, staffName: 'Sam Staff', from: 12, to: 18, hours: 6 })
    expect(tess).toMatchObject({ staffName: 'Tess Tech', from: 8, to: 18, hours: 10 })
    expect(c.gaps[0].hours).toBe(10) // the biggest bookable window leads the list
    expect(c.summary.idleWindows).toBe(2)
    expect(c.summary.idleStaff).toBe(2)
  })
  it('breaks a clinician’s idle time around their own travel and blocked-out time', () => {
    const c = coverageBoard(state([
      appt('a', { start: 480, end: 540, staffIds: ['s1'] }),
      appt('t', { type: 'drive', start: 540, end: 600, staffIds: ['s1'], clientIds: [], billing: null }),
    ]), [MON], { today: TODAY })
    const sam = c.gaps.filter((g) => g.staffId === 's1')
    expect(sam.length).toBe(1)
    expect(sam[0]).toMatchObject({ from: 10, to: 18, hours: 8 }) // free only after the drive
  })
  it('reads a weekday × hour grid the panel can shade', () => {
    const c = coverageBoard(state([appt('a')]), forwardDays(7, TODAY), { today: TODAY })
    expect(c.grid.length).toBe(7)
    expect(c.grid[0].length).toBe(10)
    expect(c.hourStart).toBe(8)
    expect(c.grid[1][1]).toMatchObject({ bookedHours: 1, fillPct: 50 }) // Monday 09:00, 1 of 2 clinicians
    expect(c.perDay.length).toBe(7)
  })
})

describe('access holdout', () => {
  // both clinicians booked 9–10 on Monday: that hour has no room left for a same-day need
  const full = () => state([appt('a', { staffIds: ['s1', 's2'] })])

  it('keeps 10% of each hour back by default and says how much of it is already booked', () => {
    const c = coverageBoard(full(), [MON], { today: TODAY })
    expect(c.summary.holdout).toMatchObject({ pct: 10, reservedHours: 2, eatenHours: 0.2, keptPct: 90, eatenCells: 1 })
    expect(c.grid[1][1].eatenHours).toBe(0.2) // Monday, 09:00 (the working day starts at 8)
    expect(c.grid[1][2].eatenHours).toBe(0)
  })

  it('follows the practice’s share and can be turned off', () => {
    const s = full()
    expect(coverageBoard({ ...s, settings: { ...s.settings, risk: { holdoutPct: 20 } } }, [MON], { today: TODAY }).summary.holdout).toMatchObject({ pct: 20, eatenHours: 0.4 })
    expect(coverageBoard({ ...s, settings: { ...s.settings, risk: { holdoutPct: 0 } } }, [MON], { today: TODAY }).summary.holdout).toMatchObject({ pct: 0, eatenHours: 0, eatenCells: 0 })
    expect(holdoutPctOf({ risk: { holdoutPct: 'lots' } })).toBe(10)
    expect(holdoutPctOf({ risk: { holdoutPct: 90 } })).toBe(10)
  })

  it('does not count hours that have already passed', () => {
    const c = coverageBoard(full(), [MON], { today: '2026-06-16' })
    expect(c.summary.holdout).toMatchObject({ reservedHours: 0, eatenHours: 0, keptPct: 100 })
  })
})

describe('density optimisation', () => {
  const splitState = () => state([
    appt('early', { start: 480, end: 540, title: 'Morning ABA', clientIds: ['c1'], staffIds: ['s1'] }),
    appt('late', { start: 840, end: 900, title: 'Afternoon ABA', clientIds: ['c2'], staffIds: ['s1'] }),
  ], { clients: [
    { id: 'c1', name: 'Client One', authWeekly: 20, authStart: '2026-06-01', authEnd: '2026-09-01' },
    { id: 'c2', name: 'Client Two', authWeekly: 20, authStart: '2026-06-01', authEnd: '2026-09-01' },
  ] })

  it('suggests pulling a split-day session next to an existing block', () => {
    const board = densityBoard(splitState(), [MON], { today: TODAY })
    const row = board.allRows.find((r) => r.apptId === 'late' && r.to.start === 540)
    expect(row).toBeTruthy()
    expect(row).toMatchObject({ staffName: 'Sam Staff', reason: expect.stringMatching(/less split idle|opens/) })
    expect(row.gain.idleMin).toBeGreaterThanOrEqual(300)
    expect(board.summary.suggestions).toBeGreaterThan(0)
  })

  it('rechecks a density move before it is applied', () => {
    const s = splitState()
    const plan = planDensityMove(s, { apptId: 'late', to: { date: MON, start: 540, end: 600 } }, { today: TODAY })
    expect(plan.ok).toBe(true)
    expect(plan.patch).toEqual({ date: MON, start: 540, end: 600 })
  })

  it('refuses a stale move when the client is no longer free', () => {
    const s = splitState()
    const busyClient = appt('client-busy', { start: 540, end: 600, clientIds: ['c2'], staffIds: ['s2'], title: 'School make-up' })
    const blocked = { ...s, appts: { ...s.appts, [busyClient.id]: busyClient } }
    const plan = planDensityMove(blocked, { apptId: 'late', to: { date: MON, start: 540, end: 600 } }, { today: TODAY })
    expect(plan.ok).toBe(false)
    expect(plan.msg).toMatch(/client overlaps/i)
  })

  it('does not move today’s work into a slot that has already started', () => {
    const board = densityBoard(splitState(), [MON], { today: TODAY, nowMin: 10 * 60 })
    expect(board.allRows.some((r) => r.apptId === 'late' && r.to.start === 540)).toBe(false)
    const plan = planDensityMove(splitState(), { apptId: 'late', to: { date: MON, start: 540, end: 600 } }, { today: TODAY, nowMin: 10 * 60 })
    expect(plan.ok).toBe(false)
    expect(plan.msg).toMatch(/already started/i)
  })

  it('does not suggest completed or claimed sessions as movable work', () => {
    const s = state([
      appt('early', { start: 480, end: 540, title: 'Morning ABA', clientIds: ['c1'], staffIds: ['s1'] }),
      appt('done', { start: 840, end: 900, title: 'Completed ABA', clientIds: ['c2'], staffIds: ['s1'], status: 'completed' }),
      appt('claimed', { start: 960, end: 1020, title: 'Claimed ABA', clientIds: ['c3'], staffIds: ['s1'], claimId: 'clm-1', billing: { code: '97153', units: 4, rate: 18, status: 'claimed' } }),
    ])
    const board = densityBoard(s, [MON], { today: TODAY })
    expect(board.allRows.some((r) => ['done', 'claimed'].includes(r.apptId))).toBe(false)
  })
})

describe('the insight board', () => {
  const s = state([
    appt('a'),
    appt('late', { date: '2026-06-16', status: 'active', clientIds: ['c1'] }),
  ], { clients: [{ id: 'c1', name: 'Client One', authWeekly: 4, authStart: '2026-05-01', authEnd: '2026-09-01' }] })

  it('answers fill, capacity, authorization and risk in one pass', () => {
    const b = insightBoard(s, forwardDays(7, TODAY), { today: TODAY })
    expect(b.kpis.map((k) => k.id)).toEqual(['fill', 'open', 'auth', 'risk'])
    expect(b.totals.sessions).toBe(2)
    expect(b.totals.staffedHours).toBe(2)
    expect(b.totals.scheduledCharge).toBe(72)
    expect(b.coverage.summary.availableHours).toBe(140)
    expect(b.auth.rows.length).toBe(1)
    expect(b.auth.rows[0]).toMatchObject({ clientId: 'c1', name: 'Client One' })
  })
  it('gives every KPI a tone and a plain-language sub-line rather than a bare number', () => {
    const b = insightBoard(s, forwardDays(7, TODAY), { today: TODAY })
    for (const k of b.kpis) {
      expect(['ok', 'info', 'warn', 'danger']).toContain(k.tone)
      expect(k.label.length).toBeGreaterThan(2)
      expect(k.sub.length).toBeGreaterThan(2)
    }
  })
  it('keeps the risk list to the range on screen', () => {
    const b = insightBoard(s, [MON], { today: TODAY })
    expect(b.risk.rows.every((r) => r.appt.date === MON)).toBe(true)
  })
})

describe('forward range helper', () => {
  it('walks forward from today without touching the clock', () => {
    const d = forwardDays(4, TODAY)
    expect(d).toEqual(['2026-06-15', '2026-06-16', '2026-06-17', '2026-06-18'])
  })
})
