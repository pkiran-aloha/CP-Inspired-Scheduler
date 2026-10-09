import { describe, it, expect } from 'vitest'
import { hireBoard, HIRE_HIGH_UTIL } from '../lib/hire'
import { rampBoard } from '../lib/ramp'
import { coverageBoard, insightBoard } from '../lib/insights'
import { addDays, isoDate, parseISO } from '../lib/date'

const TODAY = '2026-06-15' // Monday
const day = (n) => isoDate(addDays(parseISO(TODAY), n))
const days = Array.from({ length: 7 }, (_, i) => day(i))

const client = (id, extra = {}) => ({ id, name: `Client ${id}`, status: 'active', authWeekly: 0, authStart: '', authEnd: '', ...extra })
const staffer = (id, role, cert = '') => ({ id, name: `Staff ${id}`, role, cert, status: 'active' })

function base({ clients = [], staff = [], appts = {}, intakeRequests = {}, settings = {} } = {}) {
  return {
    clients,
    staff,
    appts,
    intakeRequests,
    settings: { workday: [8, 18], weekStart: 0, ...settings },
  }
}

function boardOf(state) {
  const ramp = rampBoard(state, { today: TODAY })
  const coverage = coverageBoard(state, days, { today: TODAY })
  return hireBoard({ ramp, coverage })
}

describe('hire / contract decision (D2)', () => {
  it('says do not hire when supply covers known demand', () => {
    const state = base({
      clients: [client('c1', { authWeekly: 5, authStart: day(-3), authEnd: day(70) })],
      staff: [staffer('s1', 'RBT', 'RBT #1')],
    })
    const h = boardOf(state)
    expect(h.verdict).toBe('neither')
    expect(h.headline).toMatch(/Do not hire/)
    expect(h.shortWeeks).toBe(0)
  })

  it('calls a short week at high fill an hours gap, never a headcount', () => {
    const staff = [staffer('s1', 'RBT', 'RBT #1')]
    const appts = {}
    // Fill every weekday hour of the on-screen week so fill ≥ 85%.
    days.forEach((d, i) => {
      const dow = parseISO(d).getDay()
      if (dow === 0 || dow === 6) return
      appts[`a${i}`] = { id: `a${i}`, date: d, start: 8 * 60, end: 18 * 60, type: 'service', status: 'scheduled', staffIds: ['s1'], clientIds: ['c1'] }
    })
    const state = base({
      clients: [client('c1', { authWeekly: 200, authStart: day(-3), authEnd: day(70) })],
      staff,
      appts,
    })
    const weekdays = days.filter((d) => { const dow = parseISO(d).getDay(); return dow !== 0 && dow !== 6 })
    const h = hireBoard({ ramp: rampBoard(state, { today: TODAY }), coverage: coverageBoard(state, weekdays, { today: TODAY }) })
    expect(h.shortWeeks).toBeGreaterThan(0)
    expect(h.utilKnown).toBe(true)
    expect(h.fillPct).toBeGreaterThanOrEqual(HIRE_HIGH_UTIL)
    expect(h.verdict).toBe('hire')
    expect(h.reason).toMatch(/not a headcount|not split by credential/)
    expect(h.shortHours).toBeGreaterThan(0)
  })

  it('calls a short week at low fill a template problem', () => {
    const state = base({
      clients: [client('c1', { authWeekly: 200, authStart: day(-3), authEnd: day(70) })],
      staff: [staffer('s1', 'RBT', 'RBT #1'), staffer('s2', 'BCBA', 'BCBA #1')],
      appts: {},
    })
    const h = boardOf(state)
    expect(h.shortWeeks).toBeGreaterThan(0)
    expect(h.utilKnown).toBe(true)
    expect(h.fillPct).toBeLessThan(HIRE_HIGH_UTIL)
    expect(h.verdict).toBe('reshape')
    expect(h.reason).toMatch(/schedule-shape|template/)
  })

  it('will not invent a verdict when on-screen utilization is unknown', () => {
    const state = base({
      clients: [client('c1', { authWeekly: 80, authStart: day(-3), authEnd: day(70) })],
      staff: [staffer('s1', 'RBT', 'RBT #1')],
    })
    const ramp = rampBoard(state, { today: TODAY })
    const coverage = coverageBoard(state, [], { today: TODAY }) // empty range → no bookable hours
    const h = hireBoard({ ramp, coverage })
    expect(h.utilKnown).toBe(false)
    expect(h.verdict).toBe('thin')
    expect(h.reason).toMatch(/will not invent/)
  })

  it('treats known demand with no clinical staff as an hours gap', () => {
    const state = base({
      clients: [client('c1', { authWeekly: 10, authStart: day(-3), authEnd: day(70) })],
      staff: [staffer('x', 'Scheduler & Billing Coordinator', 'CPC')],
    })
    const h = boardOf(state)
    expect(h.verdict).toBe('hire')
    expect(h.headline).toMatch(/no clinical staff/i)
  })

  it('never weights intake by a conversion rate — it uses the ramp’s hours as-is', () => {
    const state = base({
      intakeRequests: {
        iq: { id: 'iq', stage: 'waitlist', assessment: { recommendedHoursPerWeek: 40 }, auth: {} },
      },
      staff: [staffer('s1', 'RBT', 'RBT #1')],
    })
    const ramp = rampBoard(state, { today: TODAY })
    expect(ramp.weeks[0].intakeHours).toBe(40)
    const h = hireBoard({ ramp, coverage: coverageBoard(state, days, { today: TODAY }) })
    expect(h.note).toMatch(/never weighted by a conversion rate/)
  })

  it('is wired onto insightBoard', () => {
    const state = base({
      clients: [client('c1', { authWeekly: 8, authStart: day(-3), authEnd: day(70) })],
      staff: [staffer('s1', 'RBT', 'RBT #1')],
    })
    const board = insightBoard(state, days, { today: TODAY })
    expect(board.hire.verdict).toBe('neither')
    expect(board.hire.highBar).toBe(HIRE_HIGH_UTIL)
    expect(board.hire.note).toMatch(/nothing here is hired/)
  })
})
