import { describe, it, expect } from 'vitest'
import { blankState } from '../state/store'
import { runReport, REPORT_BY_ID } from '../lib/reports'
import { addDays, isoDate, parseISO, todayISO } from '../lib/date'

const today = todayISO()
const day = (n) => isoDate(addDays(parseISO(today), n))
const BASE = blankState()

/** One client with a 100-day window, 40 days in, a 97153 pool of 100 units and 30-min sessions. */
function world({ pool = { 97153: 100 }, delivered = 10, scheduled = 0 } = {}) {
  const c = { ...BASE.clients[0], authStart: day(-40), authEnd: day(60), authNo: 'AUTH-77', authUnits: pool, authUnitsConverted: false }
  const mk = (id, date) => ({ id, date, type: 'service', status: date < today ? 'completed' : 'active', clientIds: [c.id], staffIds: [], start: 540, end: 570, billing: { code: '97153', unitMins: 15, units: 2, rate: 9 } })
  const appts = {}
  for (let i = 0; i < delivered; i++) appts[`d${i}`] = mk(`d${i}`, day(-30 + i))
  for (let i = 0; i < scheduled; i++) appts[`s${i}`] = mk(`s${i}`, day(1 + i))
  return { ...BASE, appts, clients: [c] }
}
const run = (s) => runReport(s, 'authUtil', { days: [today], scope: null })

describe('Authorization Utilization report', () => {
  it('measures each code across the authorization window, not the report range', () => {
    const out = run(world({ delivered: 10, scheduled: 5 })) // 2 fifteen-minute units per 30-min session
    const r = out.rows[0]
    expect(r).toMatchObject({ code: '97153', authNo: 'AUTH-77', authorized: 100, used: 20, scheduled: 10, remaining: 70, usedPct: 20, expectedPct: 40, projectedPct: 30 })
    expect(r.status).toBe('Under-utilized') // 20% used where 40% of the window has passed
    expect(REPORT_BY_ID.authUtil.cat).toBe('clinical')
  })

  it('flags over-commitment and starts the renewal at 75% committed', () => {
    const r = run(world({ pool: { 97153: 40 }, delivered: 15, scheduled: 10 })).rows[0]
    expect(r.projectedPct).toBe(125)
    expect(r.status).toBe('Over-committed')
    expect(r.renew).toBe('Start renewal')
  })

  it('lists a booked code that is not on the authorization at all', () => {
    const s = world({ pool: { 97155: 20 } })
    const rows = run(s).rows
    expect(rows.find((r) => r.code === '97153').status).toBe('Not on authorization')
    expect(run(s).summary.find((x) => x.label === 'Codes not authorized').value).toBe(1)
  })

  it('reports utilization only for live authorizations and marks unverified converted units', () => {
    const s = world({ delivered: 25 })
    s.clients = [{ ...s.clients[0], authUnitsConverted: true }]
    const out = run(s)
    expect(out.summary.find((x) => x.label === 'Utilization (live auths)').value).toBe('50%')
    expect(out.rows[0].converted).toBe('Verify')
  })
})
