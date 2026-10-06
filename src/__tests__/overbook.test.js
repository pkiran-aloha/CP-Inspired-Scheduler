import { describe, it, expect } from 'vitest'
import { atLeast, overbookBoard, sessionsNeeded } from '../lib/overbook'
import { insightBoard } from '../lib/insights'
import { addDays, isoDate, parseISO } from '../lib/date'

const TODAY = '2026-06-15' // a Monday
const day = (n) => isoDate(addDays(parseISO(TODAY), n))
const AFTERNOON = 15 * 60

// Twelve Mondays of history in the afternoon band, twelve sessions each, each on its own
// clinician. Ten weeks lost two sessions, two weeks lost one: ~15% loss, every week lost
// at least one. Twelve more are booked today (the next Monday).
function dense({ lostStatus = 'no-show', lostExtra = {}, weeks = 12, settings = {}, officeOf = () => 'Main Center' } = {}) {
  const appts = {}
  const roster = Array.from({ length: 12 }, (_, i) => ({ id: `c${i}`, name: `Client ${i}`, office: officeOf(i) }))
  const add = (id, date, i, status, extra = {}) => {
    appts[id] = { id, date, type: 'service', status, start: AFTERNOON, end: AFTERNOON + 120, staffIds: [`s${i}`], clientIds: [roster[i].id], ...extra }
  }
  for (let w = 1; w <= weeks; w++) {
    const lost = w <= 10 ? 2 : 1
    for (let i = 0; i < 12; i++) add(`h${w}-${i}`, day(-7 * w), i, i < lost ? lostStatus : 'completed', i < lost ? lostExtra : {})
  }
  for (let i = 0; i < 12; i++) add(`t-${i}`, TODAY, i, 'active')
  return { appts, clients: roster, staff: [], teams: [], settings: { workday: [8, 18], weekStart: 0, ...settings } }
}

const mondayAfternoon = (b) => b.blocks.find((x) => x.dow === 1 && x.band === 'afternoon')

describe('overbooking guidance', () => {
  it('rates a block that lost a session in every recent week as safe for one extra booking', () => {
    const b = mondayAfternoon(overbookBoard(dense(), { today: TODAY }))
    expect(b.status).toBe('safe')
    expect(b.safeK).toBe(1)
    expect(b.weeks).toBe(12)
    expect(b.checks[0].hit).toBe(12)
    expect(b.next).toEqual({ date: TODAY, booked: 12 })
    expect(b.why).toMatch(/In 12 of the last 12 weeks at least one session was lost here/)
  })

  it('needs both checks: two lost in 10 of 12 weeks is not enough when this week’s odds of two are low', () => {
    const b = mondayAfternoon(overbookBoard(dense(), { today: TODAY }))
    expect(b.checks[1].histPct).toBeGreaterThanOrEqual(0.8)
    expect(b.checks[1].prob).toBeLessThan(0.8)
    expect(b.safeK).toBe(1)
  })

  it('leaves practice cancellations out — staff illness says nothing about families', () => {
    const board = overbookBoard(dense({ lostStatus: 'cancelled', lostExtra: { cancelReason: 'Staff illness' } }), { today: TODAY })
    const b = mondayAfternoon(board)
    expect(b.lost).toBe(0)
    expect(b.status).toBe('not')
    expect(board.summary.safe).toBe(0)
  })

  it('counts family cancellations as lost and keeps the no-show-only rate beside it', () => {
    const b = mondayAfternoon(overbookBoard(dense({ lostStatus: 'cancelled', lostExtra: { cancelReason: 'Transportation' } }), { today: TODAY }))
    expect(b.lost).toBe(22)
    expect(b.noShows).toBe(0)
    expect(b.rateNoShow).toBe(0)
    expect(b.safeK).toBe(1)
  })

  it('refuses to rate a block with too few weeks of history', () => {
    const b = mondayAfternoon(overbookBoard(dense({ weeks: 5 }), { today: TODAY }))
    expect(b.status).toBe('thin')
    expect(b.safeK).toBe(0)
    expect(b.why).toMatch(/Only 5 weeks .* needs 8/)
  })

  it('honours a stricter practice threshold', () => {
    const b = mondayAfternoon(overbookBoard(dense({ settings: { risk: { overbookSafePct: 90 } } }), { today: TODAY }))
    expect(b.status).toBe('not')
    expect(b.why).toMatch(/needs about \d+ for 90% confidence/)
  })

  it('splits by office when the practice has more than one', () => {
    const board = overbookBoard(dense({ officeOf: (i) => (i < 6 ? 'Main Center' : 'North Clinic') }), { today: TODAY })
    expect(board.split).toBe(true)
    expect(board.blocks.map((b) => b.office).sort()).toEqual(['Main Center', 'North Clinic'])
  })

  it('names standby families by authorization pace, never a client already booked in the block', () => {
    const s = dense()
    s.clients = [...s.clients, { id: 'cu', name: 'Under Paced', office: 'Main Center', authWeekly: 10, authStart: day(-30), authEnd: day(60) }]
    const b = mondayAfternoon(overbookBoard(s, { today: TODAY }))
    expect(b.standby.map((x) => x.clientId)).toEqual(['cu'])
    s.appts.booked = { id: 'booked', date: TODAY, type: 'service', status: 'active', start: AFTERNOON + 60, end: AFTERNOON + 120, staffIds: ['sx'], clientIds: ['cu'] }
    expect(mondayAfternoon(overbookBoard(s, { today: TODAY })).standby).toEqual([])
  })

  it('rides along on the insight board', () => {
    expect(insightBoard(dense(), [TODAY], { today: TODAY }).overbook.summary.safe).toBe(1)
  })
})

describe('overbooking arithmetic', () => {
  it('computes binomial tail odds', () => {
    expect(atLeast(1, 10, 0.15)).toBeCloseTo(1 - 0.85 ** 10, 6)
    expect(atLeast(2, 10, 0.15)).toBeCloseTo(1 - 0.85 ** 10 - 10 * 0.15 * 0.85 ** 9, 6)
    expect(atLeast(0, 3, 0.1)).toBe(1)
    expect(atLeast(3, 2, 0.5)).toBe(0)
    expect(atLeast(1, 5, 0)).toBe(0)
  })

  it('says how many sessions a block needs at a given loss rate', () => {
    expect(sessionsNeeded(0.15, 0.8)).toBe(10)
    expect(sessionsNeeded(0.1, 0.8)).toBe(16)
    expect(sessionsNeeded(0, 0.8)).toBe(null)
  })
})
