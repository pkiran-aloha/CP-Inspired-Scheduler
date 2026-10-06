import { describe, it, expect } from 'vitest'
import { rampBoard, clinicianGroup, intakeWeeklyHours, RAMP_WEEKS } from '../lib/ramp'
import { insightBoard } from '../lib/insights'
import { addDays, isoDate, parseISO } from '../lib/date'

const TODAY = '2026-06-15' // a Monday; with weekStart 0 the horizon's first bucket starts Sunday 2026-06-14
const day = (n) => isoDate(addDays(parseISO(TODAY), n))

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

describe('caseload ramp (D1)', () => {
  it('counts a client’s authorized weekly hours for as long as the window runs, and marks the expiry week', () => {
    const c = client('c1', { authWeekly: 20, authStart: day(-10), authEnd: day(20) }) // ends Wed of the bucket starting day(20)
    const board = rampBoard(base({ clients: [c] }), { today: TODAY })
    expect(board.horizonWeeks).toBe(RAMP_WEEKS)
    expect(board.weeks[0].demandHours).toBe(20)
    expect(board.weeks[3].demandHours).toBe(20)
    expect(board.weeks[3].renewalPending).toBe(true)
    expect(board.weeks[3].renewals.map((r) => r.name)).toEqual(['Client c1'])
    // the window ends inside bucket 3: nothing after it, renewal never assumed
    expect(board.weeks[4].demandHours).toBe(0)
    expect(board.weeks[4].renewalPending).toBe(false)
    expect(board.summary.clients).toBe(1)
    expect(board.summary.renewals).toBe(1)
  })

  it('never assumes a renewal: an authorization that already lapsed contributes nothing', () => {
    const c = client('c1', { authWeekly: 30, authStart: day(-90), authEnd: day(-1) })
    const board = rampBoard(base({ clients: [c] }), { today: TODAY })
    expect(board.weeks.every((w) => w.demandHours === 0)).toBe(true)
    expect(board.summary.clients).toBe(0)
    expect(board.summary.lapsed).toBe(1)
    expect(board.summary.renewals).toBe(0)
  })

  it('leaves discharged and inactive clients out of demand', () => {
    const mk = (status) => client(status, { status, authWeekly: 25, authStart: day(-5), authEnd: day(40) })
    const board = rampBoard(base({ clients: [mk('discharged'), mk('inactive')] }), { today: TODAY })
    expect(board.weeks.every((w) => w.demandHours === 0)).toBe(true)
    expect(board.summary.clients).toBe(0)
  })

  it('adds open intake requests as a separate band, from their target date, until their window ends', () => {
    const r = {
      id: 'iq-1', stage: 'auth',
      assessment: { recommendedHoursPerWeek: 20 },
      auth: { windowStart: day(9), windowEnd: day(95) }, // window runs past the 12-week horizon
    }
    const board = rampBoard(base({ intakeRequests: { [r.id]: r } }), { today: TODAY })
    expect(board.weeks[0].intakeHours).toBe(0) // target date is next week
    expect(board.weeks[1].intakeHours).toBe(20)
    expect(board.weeks[11].intakeHours).toBe(20) // window runs past the horizon
    expect(board.weeks[1].demandHours).toBe(0) // the band is kept apart from authorized demand
    expect(board.summary.intakeCounted).toBe(1)
    expect(board.summary.intakeUndated).toBe(0)
  })

  it('counts intake with no target date from this week, and says so', () => {
    const r = { id: 'iq-2', stage: 'waitlist', assessment: { recommendedHoursPerWeek: 10 }, auth: {} }
    const board = rampBoard(base({ intakeRequests: { [r.id]: r } }), { today: TODAY })
    expect(board.weeks[0].intakeHours).toBe(10)
    expect(board.summary.intakeUndated).toBe(1)
  })

  it('converts requested units to weekly hours when no recommendation is recorded', () => {
    // 240 units over a 12-week window = 5 h/week (15-minute units)
    const r = { id: 'iq-3', stage: 'auth', assessment: {}, auth: { unitsRequested: 240, windowStart: day(1), windowEnd: day(85) } }
    expect(intakeWeeklyHours(r)).toBe(5)
    const board = rampBoard(base({ intakeRequests: { [r.id]: r } }), { today: TODAY })
    expect(board.weeks[0].intakeHours).toBe(5)
    expect(board.weeks[11].intakeHours).toBe(5)
  })

  it('reports open requests without any hours instead of guessing at them', () => {
    const r = { id: 'iq-4', stage: 'new', assessment: {}, auth: {} }
    const board = rampBoard(base({ intakeRequests: { [r.id]: r } }), { today: TODAY })
    expect(board.summary.intakeNoHours).toBe(1)
    expect(board.summary.intakeCounted).toBe(0)
    expect(board.weeks.every((w) => w.intakeHours === 0)).toBe(true)
  })

  it('leaves converted and closed requests out of the intake band', () => {
    const won = { id: 'iq-5', stage: 'converted', assessment: { recommendedHoursPerWeek: 30 }, auth: {} }
    const lost = { id: 'iq-6', stage: 'closed', assessment: { recommendedHoursPerWeek: 30 }, auth: {} }
    const board = rampBoard(base({ intakeRequests: { [won.id]: won, [lost.id]: lost } }), { today: TODAY })
    expect(board.weeks.every((w) => w.intakeHours === 0)).toBe(true)
    expect(board.summary.intakeCounted).toBe(0)
  })

  it('supply is clinicians’ working days minus blocked-out time, Mon–Fri, split by tier — non-clinical staff excluded', () => {
    const staff = [
      staffer('rbt', 'RBT · EIBI', 'RBT #24-08-0001'),
      staffer('bcba', 'BCBA · Clinical Supervisor', 'BCBA #5-12-0001'),
      staffer('admin', 'Scheduler & Billing Coordinator', 'CPC'),
    ]
    const board = rampBoard(base({ staff }), { today: TODAY })
    // two clinicians × 5 weekdays × 10h workday; weekends and the coordinator contribute nothing
    expect(board.weeks[0].supplyHours).toBe(100)
    expect(board.weeks[0].supply).toEqual({ rbt: 50, bcba: 50, other: 0 })
    expect(board.summary.staff).toEqual({ rbt: 1, bcba: 1, other: 0 })
  })

  it('removes blocked-out time from supply, matching the Coverage denominator', () => {
    const staff = [staffer('rbt', 'RBT · EIBI', 'RBT #24-08-0001')]
    const appts = {
      'blk-1': { id: 'blk-1', date: day(0), type: 'unavailable', status: 'active', start: 8 * 60, end: 12 * 60, staffIds: ['rbt'] }, // Mon: 4h blocked
      'pto-cancelled': { id: 'pto-cancelled', date: day(1), type: 'unavailable', status: 'cancelled', start: 8 * 60, end: 18 * 60, staffIds: ['rbt'] },
    }
    const board = rampBoard(base({ staff, appts }), { today: TODAY })
    expect(board.weeks[0].supplyHours).toBe(46) // 50 - 4 blocked; the cancelled block is ignored
    expect(board.weeks[1].supplyHours).toBe(50)
  })

  it('buckets follow the practice week start', () => {
    const board = rampBoard(base({}), { today: TODAY, weeks: 12 })
    expect(board.weeks[0].start).toBe('2026-06-14') // Sunday
    const monFirst = rampBoard(base({ settings: { weekStart: 1 } }), { today: TODAY })
    expect(monFirst.weeks[0].start).toBe(TODAY)
  })

  it('flags the weeks where known demand exceeds supply, and never counts intake as authorized', () => {
    const c = client('c1', { authWeekly: 150, authStart: day(-10), authEnd: day(60) })
    const staff = [staffer('rbt', 'RBT · EIBI', 'RBT #1'), staffer('bcba', 'BCBA', 'BCBA #2')]
    const board = rampBoard(base({ clients: [c], staff }), { today: TODAY })
    expect(board.weeks[0].totalHours).toBe(150)
    expect(board.weeks[0].supplyHours).toBe(100)
    expect(board.weeks[0].balanceHours).toBe(-50)
    expect(board.summary.shortWeeks).toBeGreaterThan(0)
    expect(board.summary.firstShort).toBe(board.weeks[0].start)
  })

  it('is part of the unified insights board', () => {
    const state = base({ clients: [client('c1', { authWeekly: 12, authStart: day(-3), authEnd: day(70) })] })
    const days = Array.from({ length: 7 }, (_, i) => day(i))
    const board = insightBoard(state, days, { today: TODAY })
    expect(board.ramp.horizonWeeks).toBe(RAMP_WEEKS)
    expect(board.ramp.weeks[0].demandHours).toBe(12)
  })
})

describe('clinician grouping', () => {
  it('reads free-text roles and certs the tolerant way', () => {
    expect(clinicianGroup(staffer('a', 'RBT · EIBI', 'RBT #24-08-1177'))).toBe('rbt')
    expect(clinicianGroup(staffer('b', 'Lead RBT', 'RBT #21-03-0904'))).toBe('rbt')
    expect(clinicianGroup(staffer('c', 'BCBA · Clinical Supervisor', 'BCBA #5-12-0034'))).toBe('bcba')
    expect(clinicianGroup(staffer('d', 'BCaBA · Center Lead', 'BCaBA #5-23-0911'))).toBe('bcba')
    expect(clinicianGroup(staffer('e', 'Student Therapist', 'TC-BCBA (trainee)'))).toBe('bcba')
    expect(clinicianGroup(staffer('f', 'Psychologist · Assessments', 'PsyD #27655'))).toBe('other')
    expect(clinicianGroup(staffer('g', 'Speech-Language Pathologist', 'CCC-SLP #G45-0012'))).toBe('other')
    expect(clinicianGroup(staffer('h', 'Scheduler & Billing Coordinator', 'CPC'))).toBe(null)
  })
})
