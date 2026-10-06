import { describe, it, expect } from 'vitest'
import { blankState } from '../state/store'
import { cancelLeadHours, cancelNoticeHoursOf, cancelledEarly, stampCancelledAt, cancelSide, isPracticeCancel, reasonPatch, cancelReasonOptions, cancelReasonRows, seedCancelNotice, seedCancelReason, NOT_RECORDED } from '../lib/cancelReasons'
import { parseISO } from '../lib/date'
import { runReport } from '../lib/reports'
import { riskModel } from '../lib/risk'
import { isCancelStatus } from '../lib/settingsMasters'

// fixed dates: 2026-09-18 is a Friday, 2026-09-14 a Monday, 2026-09-15 a Tuesday
const appt = (id, date, status, extra = {}) => ({
  id, date, status, type: 'service', start: 540, end: 660, staffIds: ['s1'], clientIds: ['c1'],
  billing: { code: '97153', units: 4, rate: 18, mileage: false }, ...extra,
})
const state = (appts, settings = blankState().settings) => ({ appts: Object.fromEntries(appts.map((a) => [a.id, a])), clients: [], staff: [], teams: [], settings })

describe('cancellation reasons', () => {
  it('reads the practice’s own Custom List and tells client side from practice side', () => {
    const opts = cancelReasonOptions(blankState().settings).map((o) => o.label)
    expect(opts).toEqual(expect.arrayContaining(['Client ill', 'Transportation', 'Staff illness', 'No reason given']))
    expect(cancelSide('Staff illness')).toBe('practice')
    expect(cancelSide('Clinician unavailable')).toBe('practice')
    expect(cancelSide('Transportation')).toBe('client')
    expect(cancelSide('')).toBe('unknown')
    expect(isPracticeCancel({ cancelReason: 'Staff illness' })).toBe(true)
    expect(isPracticeCancel({})).toBe(false)
    expect(reasonPatch({ id: 'x', label: 'Weather' })).toEqual({ cancelReasonId: 'x', cancelReason: 'Weather' })
    expect(reasonPatch(null)).toEqual({ cancelReasonId: undefined, cancelReason: undefined })
  })

  it('rolls cancellations up by reason, with share, side and the day they cluster on', () => {
    const rows = cancelReasonRows([
      appt('a', '2026-09-18', 'cancelled', { cancelReason: 'Transportation' }),
      appt('b', '2026-09-18', 'cancelled', { cancelReason: 'Transportation', start: 900, end: 960 }),
      appt('c', '2026-09-14', 'cancelled', { cancelReason: 'Transportation' }),
      appt('d', '2026-09-15', 'cancelled', { cancelReason: 'Staff illness' }),
      appt('e', '2026-09-15', 'no-show'),
    ])
    expect(rows.map((r) => r.reason)).toEqual(['Transportation', 'Staff illness', NOT_RECORDED])
    expect(rows[0]).toMatchObject({ sessions: 3, share: 60, side: 'Client / family', topDay: 'Fri (2 of 3)', hours: 5 })
    expect(rows[1]).toMatchObject({ sessions: 1, side: 'Practice', topDay: '—' })
    expect(rows[2].side).toBe('—')
  })

  it('ships a Cancellation Root Cause report over cancellation-status sessions only', () => {
    const s = state([
      appt('a', '2026-09-18', 'cancelled', { cancelReason: 'Transportation' }),
      appt('b', '2026-09-15', 'cancelled', { cancelReason: 'Staff illness' }),
      appt('c', '2026-09-15', 'completed'),
      appt('d', '2026-09-15', 'cancelled', { type: 'drive', cancelReason: 'Weather' }),
    ])
    const out = runReport(s, 'cancelReasons', { days: ['2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18'], scope: null })
    expect(out.rows.map((r) => r.reason).sort()).toEqual(['Staff illness', 'Transportation'])
    const kpi = Object.fromEntries(out.summary.map((x) => [x.label, x.value]))
    expect(kpi['Cancelled or missed']).toBe(2)
    expect(kpi['Client side']).toBe('50%')
    expect(kpi['Practice side']).toBe('50%')
    expect(kpi['No reason recorded']).toBe(0)
  })

  it('keeps practice-side cancellations out of a family’s attendance history', () => {
    const rows = []
    for (let i = 1; i <= 6; i++) rows.push(appt(`k${i}`, `2026-05-${String(i + 3).padStart(2, '0')}`, 'completed'))
    rows.push(appt('x1', '2026-05-11', 'cancelled', { cancelReason: 'Staff illness' }))
    rows.push(appt('x2', '2026-05-12', 'cancelled', { cancelReason: 'Staff illness' }))
    const practice = riskModel(state(rows, {}), { today: '2026-06-15' })
    expect(practice.history.c1.n).toBe(6)
    expect(practice.history.c1.bad).toBe(0)
    expect(practice.streak.c1.misses).toBe(0)
    // the same two cancellations, on the family's side, do count against them
    const family = riskModel(state(rows.map((a) => (a.cancelReason ? { ...a, cancelReason: 'Client ill' } : a)), {}), { today: '2026-06-15' })
    expect(family.history.c1.bad).toBe(2)
    expect(family.streak.c1.misses).toBe(2)
  })

  it('gives every seeded cancellation a reason, deterministically and without touching the seed RNG', () => {
    expect(seedCancelReason('no-show', 'c1', '2026-09-15').cancelReason).toBe('No reason given')
    expect(seedCancelReason('cancelled', 'c1', '2026-09-18').cancelReason).toBe('Transportation')
    expect(seedCancelReason('cancelled', 'c4', '2026-09-15')).toEqual(seedCancelReason('cancelled', 'c4', '2026-09-15'))
    const s = blankState()
    const cancelled = Object.values(s.appts).filter((a) => a.type === 'service' && isCancelStatus(s.settings, a.status))
    expect(cancelled.length).toBeGreaterThan(0)
    expect(cancelled.every((a) => a.cancelReason && a.cancelReasonId)).toBe(true)
    expect(Object.values(s.appts).some((a) => !isCancelStatus(s.settings, a.status) && a.cancelReason)).toBe(false)
  })
})

describe('when a session was cancelled', () => {
  const settings = {}
  const NOW = '2026-09-14T10:00:00.000Z'
  const live = appt('a1', '2026-09-18', 'active')

  it('stamps the moment a session enters a cancellation status', () => {
    expect(stampCancelledAt(live, { ...live, status: 'cancelled' }, settings, NOW).cancelledAt).toBe(NOW)
    expect(stampCancelledAt(undefined, { ...live, status: 'cancelled' }, settings, NOW).cancelledAt).toBe(NOW)
  })

  it('keeps what was known while it stays cancelled, and never invents a time for an old cancellation', () => {
    const stamped = { ...live, status: 'cancelled', cancelledAt: NOW }
    expect(stampCancelledAt(stamped, { ...stamped, cancelReason: 'Transportation' }, settings, '2026-09-15T00:00:00.000Z').cancelledAt).toBe(NOW)
    const legacy = { ...live, status: 'cancelled' }
    expect(stampCancelledAt(legacy, { ...legacy, cancelReason: 'Transportation' }, settings, NOW).cancelledAt).toBe(undefined)
  })

  it('clears it when the session is reinstated, and never stamps a no-show', () => {
    const stamped = { ...live, status: 'cancelled', cancelledAt: NOW }
    const back = stampCancelledAt(stamped, { ...stamped, status: 'active' }, settings, NOW)
    expect(back.cancelledAt).toBe(undefined)
    expect(JSON.parse(JSON.stringify(back))).not.toHaveProperty('cancelledAt')
    expect(stampCancelledAt(live, { ...live, status: 'no-show' }, settings, NOW).cancelledAt).toBe(undefined)
  })

  it('measures the notice a cancellation gave', () => {
    const a = { ...live, start: 9 * 60, status: 'cancelled', cancelledAt: new Date(2026, 8, 17, 9, 0).toISOString() }
    expect(cancelLeadHours(a)).toBeCloseTo(24, 6)
    expect(cancelLeadHours({ ...a, cancelledAt: undefined })).toBe(null)
    expect(cancelLeadHours({ ...a, cancelledAt: 'not a date' })).toBe(null)
  })
})

// One notice rule, read by the risk model and the Overbooking backtest alike:
// `settings.billing.lateCancelHours`, 24 h by default.
describe('the practice’s late-cancel notice threshold', () => {
  it('takes the stored setting, and refuses an off-menu number', () => {
    expect(cancelNoticeHoursOf({})).toBe(24)
    expect(cancelNoticeHoursOf({ billing: { lateCancelHours: 12 } })).toBe(12)
    expect(cancelNoticeHoursOf({ billing: { lateCancelHours: 0 } })).toBe(0)
    for (const bad of [-5, 169, 999, 'soon', null, '', NaN]) expect(cancelNoticeHoursOf({ billing: { lateCancelHours: bad } })).toBe(24)
    // a caller with its own fallback keeps it when the setting is unusable
    expect(cancelNoticeHoursOf({ billing: { lateCancelHours: 999 } }, 48)).toBe(48)
  })

  it('calls only a recorded, refillable cancellation early', () => {
    const a = { date: '2026-09-18', start: 540, end: 660, status: 'cancelled' }
    const at = (h) => new Date(parseISO('2026-09-18').getTime() + (540 - h * 60) * 60000).toISOString()
    expect(cancelledEarly({ ...a, cancelledAt: at(30) }, 24)).toBe(true)
    expect(cancelledEarly({ ...a, cancelledAt: at(24) }, 24)).toBe(false) // exactly the threshold is not more
    expect(cancelledEarly({ ...a }, 24)).toBe(false) // no time recorded: never guessed
    expect(cancelledEarly({ ...a, cancelledAt: 'not a date' }, 24)).toBe(false)
    expect(cancelledEarly({ ...a, status: 'no-show', cancelledAt: at(48) }, 24)).toBe(false)
  })

  it('gives the demo a deterministic spread of notice, and leaves some of it unknown', () => {
    expect(seedCancelNotice('no-show', 'c1', '2026-09-18', 540)).toBe(undefined)
    expect(seedCancelNotice('cancelled', 'c1', '2026-09-18', 540)).toBe(seedCancelNotice('cancelled', 'c1', '2026-09-18', 540))
    const notices = Array.from({ length: 40 }, (_, i) => seedCancelNotice('cancelled', `c${i}`, '2026-09-18', 540))
    expect(notices.filter(Boolean).length).toBeGreaterThan(0)
    expect(notices.some((n) => n === undefined)).toBe(true)
    const leads = notices.filter(Boolean).map((n) => cancelLeadHours({ date: '2026-09-18', start: 540, cancelledAt: n }))
    expect(leads.some((h) => h > 24)).toBe(true) // refillable
    expect(leads.some((h) => h < 24)).toBe(true) // too late to refill
    // and the seeded workspace carries both, with the honest unknown case kept
    const s = blankState()
    const cancelled = Object.values(s.appts).filter((a) => a.type === 'service' && a.status === 'cancelled')
    const withTime = cancelled.filter((a) => a.cancelledAt)
    expect(withTime.length).toBeGreaterThan(0)
    expect(cancelled.some((a) => !a.cancelledAt)).toBe(true)
    expect(withTime.some((a) => cancelLeadHours(a) > 24)).toBe(true)
    expect(withTime.some((a) => cancelLeadHours(a) < 24)).toBe(true)
    expect(Object.values(s.appts).some((a) => a.status !== 'cancelled' && a.cancelledAt)).toBe(false)
  })
})
