// The two places that suggest auto-filling units (Blocked Claims & Fixes and the Validations
// list) must use the payer's unit rule, not the code's raw size — architecture item 18.
import { describe, it, expect, beforeEach } from 'vitest'
import { blankState } from '../state/store'
import { REPORT_BY_ID, runReport, validationIssues } from '../lib/reports'
import { unitRuleFor } from '../lib/authUnits'
import { addDays, isoDate, parseISO, startOfWeek, todayISO } from '../lib/date'

beforeEach(() => localStorage.clear())

const daysFrom = (startIso, n) => Array.from({ length: n }, (_, i) => isoDate(addDays(parseISO(startIso), i)))
const ctxFor = (n = 28) => {
  const wk = startOfWeek(parseISO(todayISO()), 0)
  return { days: daysFrom(isoDate(addDays(wk, -(n - 7))), n), gran: 'week', buckets: [], scope: {} }
}

// A completed 100-minute session, no units yet, on a payer whose contract sets a 40-minute
// unit with round-up. The code default is 15 minutes, so a wrong implementation shows 6.67.
function pendingState() {
  const base = blankState()
  const client = base.clients[0]
  const payer = base.payers.find((p) => p.id === client.payer || p.name === client.insurer)
  const appt = {
    id: 'fix-me', type: 'service', status: 'completed', date: todayISO(), start: 540, end: 640,
    clientIds: [client.id], staffIds: [base.staff[0].id], service: 'dtt',
    billing: { code: '97151', rate: 9, unitMins: 15 }, // the service's own code, so the payer override applies
  }
  return {
    ...base,
    payers: base.payers.map((p) => (p.id === payer.id ? { ...p, svcOv: { ...(p.svcOv || {}), dtt: { unitSize: 40, rounding: 'Round Up' } } } : p)),
    appts: { ...base.appts, 'fix-me': appt },
  }
}

describe('auto-fill follows the payer unit rule', () => {
  it('the unit rule itself reads the contract override', () => {
    const st = pendingState()
    expect(unitRuleFor(st, st.appts['fix-me'])).toMatchObject({ unitMins: 40, rounding: 'Round Up' })
  })

  it('Blocked Claims & Fixes names the number the Fix button will write', () => {
    const st = pendingState()
    const row = runReport(st, 'blocked', ctxFor()).rows.find((r) => r._link?.id === 'fix-me')
    expect(row.fix).toBe('Auto-fill 3 units @ 97151') // 100 min ÷ 40, rounded up — not 6.67
    expect(row.estCharge).toBe(27) // 3 units × $9, the rate on record
    expect(REPORT_BY_ID.blocked).toBeTruthy()
  })

  it('the Validations list names the same number', () => {
    const st = pendingState()
    const issue = validationIssues(st, null).find((i) => i.link?.id === 'fix-me' && /Auto-fill/.test(i.fix))
    expect(issue.fix).toBe('Auto-fill 3 units')
  })
})
