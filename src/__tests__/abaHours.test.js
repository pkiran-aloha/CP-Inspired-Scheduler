import { describe, it, expect } from 'vitest'
import {
  ABA_ACTIVITIES, ABA_NON_QUALIFYING_ACTIVITIES, ABA_QUALIFYING_ACTIVITIES, ABA_TRACKS,
  DEFAULT_ABA_HOURS, abaActivityById, abaEntries, abaHoursCfg, abaHoursOf, abaStaffRows,
  abaTotals, abaTrackFor, countsAsAbaHours, normalizeAbaHours,
} from '../lib/abaHours'
import { isNonServiceAppt, isServiceAppt, SERVICE_TYPES } from '../lib/model'
import { evaluateAppointmentValidations, planSettingsOp, appointmentValidationsCfg } from '../lib/settingsMasters'
import { defaultPayrollSettings, lineTotals, scheduleLines, periodFor } from '../lib/payroll'
import { runReport, REPORT_BY_ID, validationIssues } from '../lib/reports'
import { consumesAuth } from '../lib/authBudget'

const MON = '2026-06-15' // a Monday
const days = ['2026-06-15', '2026-06-16', '2026-06-17', '2026-06-18', '2026-06-19', '2026-06-20', '2026-06-21']

const STAFF = [
  { id: 's1', name: 'Bea Supervisor', role: 'BCBA · Clinical Supervisor', cert: 'BCBA #5-12-0034' },
  { id: 's2', name: 'Nia Center', role: 'BCaBA · Center Lead', cert: 'BCaBA #5-23-0911' },
  { id: 's3', name: 'Sam Tech', role: 'RBT · EIBI', cert: 'RBT #24-08-1177' },
  { id: 's4', name: 'Kit Board', role: 'Behavior Technician', cert: 'BCAT #11-2233' },
  { id: 's5', name: 'Gus Student', role: 'Student Therapist', cert: 'TC-BCBA (trainee)' },
  { id: 's6', name: 'Alex Front', role: 'Scheduler & Billing Coordinator', cert: 'CPC' },
]

const appt = (id, extra = {}) => ({
  id, type: 'unavailable', date: MON, start: 540, end: 660, status: 'active',
  staffIds: ['s3'], clientIds: [], abaHr: true, abaActivity: 'group-training', ...extra,
})

const state = (appts = [], settings = {}) => ({
  appts: Object.fromEntries(appts.map((a) => [a.id, a])),
  staff: STAFF,
  clients: [],
  payProfiles: STAFF.map((s) => ({ staffId: s.id, baseRate: 25 })),
  settings: { payroll: { ...defaultPayrollSettings(), frequency: 'biweekly', anchor: MON }, ...settings },
})

describe('which appointments the ⚡ ABA Hours flag belongs to', () => {
  it('offers it on non-service types and never on service delivery', () => {
    expect(SERVICE_TYPES.sort()).toEqual(['drive', 'evaluation', 'service', 'supervision'])
    for (const t of SERVICE_TYPES) expect(isServiceAppt({ type: t })).toBe(true)
    expect(isNonServiceAppt({ type: 'break' })).toBe(true)
    expect(isNonServiceAppt({ type: 'unavailable' })).toBe(true)
    // a type this build has never heard of is non-service by default
    expect(isNonServiceAppt({ type: 'admin' })).toBe(true)
    expect(isServiceAppt({ type: 'admin' })).toBe(false)
  })

  it('counts a ticked non-service block as behavior-analytic time', () => {
    expect(countsAsAbaHours(appt('a'))).toBe(true)
    expect(abaHoursOf(appt('a'))).toBe(2)
  })

  it('never counts service appointments, however the flag was written', () => {
    for (const type of SERVICE_TYPES) {
      expect(countsAsAbaHours(appt('x', { type }))).toBe(false)
      expect(abaHoursOf(appt('x', { type }))).toBe(0)
    }
  })

  it('needs the tick, a live status, and a behavior-analytic activity', () => {
    expect(countsAsAbaHours(appt('b', { abaHr: false }))).toBe(false)
    expect(countsAsAbaHours(appt('c', { abaHr: undefined }))).toBe(false)
    expect(countsAsAbaHours(appt('d', { status: 'cancelled' }))).toBe(false)
    expect(countsAsAbaHours(appt('e', { abaActivity: 'facility' }))).toBe(false)
    expect(countsAsAbaHours(appt('f', { abaActivity: 'general-admin' }))).toBe(false)
    expect(countsAsAbaHours(appt('g', { abaActivity: '' }))).toBe(true) // legacy row: counted, reported uncategorized
    expect(countsAsAbaHours(appt('h', { type: 'break' }))).toBe(true)
  })

  it('names the practice’s non-examples in the activity list', () => {
    expect(ABA_NON_QUALIFYING_ACTIVITIES.map((a) => a.id)).toEqual(['facility', 'general-admin'])
    expect(ABA_NON_QUALIFYING_ACTIVITIES.map((a) => a.label).join(' ')).toMatch(/cleaning the clinic/i)
    expect(ABA_NON_QUALIFYING_ACTIVITIES.map((a) => a.label).join(' ')).toMatch(/stimulus preparation/i)
    expect(ABA_QUALIFYING_ACTIVITIES.length + ABA_NON_QUALIFYING_ACTIVITIES.length).toBe(ABA_ACTIVITIES.length)
    expect(ABA_QUALIFYING_ACTIVITIES.every((a) => a.qualifies)).toBe(true)
    expect(abaActivityById('nope')).toBe(null)
  })

  it('stays out of the authorization engine entirely', () => {
    // the same block: not service time, so it draws nothing on the client's authorization
    expect(consumesAuth(appt('a'))).toBe(false)
    expect(consumesAuth(appt('z', { type: 'service', clientIds: ['c1'] }))).toBe(true)
  })
})

describe('credential tracks', () => {
  it('sorts people into RBT/BCAT, graduate-student, BCaBA, BCBA and other tracks', () => {
    expect(abaTrackFor(STAFF[0]).id).toBe('bcba')
    expect(abaTrackFor(STAFF[1]).id).toBe('bcaba')
    expect(abaTrackFor(STAFF[2]).id).toBe('technician')
    expect(abaTrackFor(STAFF[3]).id).toBe('technician') // BCAT counts with the RBT track
    expect(abaTrackFor(STAFF[4]).id).toBe('student')
    expect(abaTrackFor(STAFF[5]).id).toBe('other')
    expect(ABA_TRACKS.map((t) => t.id)).toEqual(['student', 'technician', 'bcaba', 'bcba', 'other'])
  })
})

describe('the tracking roll-up', () => {
  const rows = () => abaStaffRows(state([
    appt('t1', { staffIds: ['s3'], date: '2026-06-15', start: 540, end: 660 }), // 2h group training
    appt('t2', { staffIds: ['s3'], date: '2026-06-17', start: 600, end: 690, abaActivity: 'data-analysis' }), // 1.5h
    appt('t3', { staffIds: ['s5'], date: '2026-06-16', start: 540, end: 720, abaActivity: 'intervention-design' }), // 3h student
    appt('t4', { staffIds: ['s3'], date: '2026-06-18', start: 540, end: 600, abaActivity: 'facility' }), // excluded
    appt('t5', { staffIds: ['s4'], date: '2026-06-18', start: 540, end: 600, abaHr: false }), // unticked
    appt('t6', { staffIds: ['s3'], date: '2026-06-19', start: 540, end: 600, abaActivity: '' }), // uncategorized
    appt('t7', { staffIds: ['s3'], date: '2026-07-30', start: 540, end: 600 }), // outside the range
  ]), { days })

  it('totals hours per person with the activity mix behind them', () => {
    const rbt = rows().rows.find((r) => r.staffId === 's3')
    expect(rbt.hours).toBe(4.5)
    expect(rbt.sessions).toBe(3)
    expect(rbt.byActivity).toEqual({ 'group-training': 2, 'data-analysis': 1.5, '': undefined })
    expect(rbt.activities.map((a) => [a.id, a.hours])).toEqual([['group-training', 2], ['data-analysis', 1.5]])
    expect(rbt.uncategorized).toBe(1)
    expect(rbt.excluded).toBe(1) // the cleaning block is reported, never counted
    expect(rbt.trackLabel).toBe('RBT / BCAT')
    expect(rbt.target).toBe(40)
    expect(rbt.pct).toBe(11)
    expect(rbt.atTarget).toBe(false)
  })

  it('spreads the total over the weeks in range', () => {
    const rbt = rows().rows.find((r) => r.staffId === 's3')
    expect(rbt.perWeek).toBe(4.5)
  })

  it('leaves out people with nothing to report unless asked', () => {
    expect(rows().rows.map((r) => r.staffId).sort()).toEqual(['s3', 's5'])
    const all = abaStaffRows(state([]), { days, includeEmpty: true }).rows
    expect(all.length).toBe(STAFF.length)
  })

  it('lists the blocks behind the number, oldest first', () => {
    const list = abaEntries(state([
      appt('b', { date: '2026-06-17' }),
      appt('a', { date: '2026-06-15' }),
      appt('out', { date: '2026-07-01' }),
    ]), { days })
    expect(list.map((a) => a.id)).toEqual(['a', 'b'])
  })

  it('reads the practice’s own targets from settings', () => {
    const s = state([appt('t1', { staffIds: ['s3'], start: 540, end: 660 })], { abaHours: { targets: { ...DEFAULT_ABA_HOURS.targets, technician: 2 } } })
    const rbt = abaStaffRows(s, { days }).rows.find((r) => r.staffId === 's3')
    expect(rbt.target).toBe(2)
    expect(rbt.pct).toBe(100)
    expect(rbt.atTarget).toBe(true)
  })

  it('sums the workspace for KPI strips', () => {
    const t = abaTotals(state([
      appt('t1', { staffIds: ['s3'], start: 540, end: 660, abaActivity: '' }),
      appt('t2', { staffIds: ['s5'], start: 540, end: 720, abaActivity: 'intervention-design' }),
    ]), { days })
    expect(t.hours).toBe(5)
    expect(t.staff).toBe(2)
    expect(t.sessions).toBe(2)
    expect(t.uncategorized).toBe(2) // the RBT block still needs an activity
  })

  it('accepts a from/to window as well as a day list', () => {
    const t = abaTotals(state([appt('t1', { start: 540, end: 660 })]), { from: '2026-06-15', to: '2026-06-21' })
    expect(t.hours).toBe(2)
    expect(t.range.weeks).toBe(1)
  })
})

describe('validations on the booking', () => {
  const val = (draft, cfg = {}) =>
    evaluateAppointmentValidations(state([], cfg), { id: '__draft__', status: 'active', staffIds: ['s3'], clientIds: [], ...draft })

  it('refuses ⚡ ABA Hours on a service appointment (Stop by default)', () => {
    const r = val({ type: 'service', abaHr: true, abaActivity: 'group-training' })
    expect(r.stops.some((x) => x.id === 'aba.serviceAppt')).toBe(true)
    expect(r.stops.find((x) => x.id === 'aba.serviceAppt').message).toMatch(/non-service appointments only/)
  })

  it('refuses a non-qualifying activity and names it', () => {
    const r = val({ type: 'unavailable', abaHr: true, abaActivity: 'facility' })
    const hit = r.stops.find((x) => x.id === 'aba.activity')
    expect(hit).toBeTruthy()
    expect(hit.message).toMatch(/Facility upkeep/)
    expect(val({ type: 'unavailable', abaHr: true, abaActivity: 'general-admin' }).stops.some((x) => x.id === 'aba.activity')).toBe(true)
  })

  it('warns about a missing activity, a missing staff member and an attached client', () => {
    expect(val({ type: 'unavailable', abaHr: true }).warns.some((x) => x.id === 'aba.missingActivity')).toBe(true)
    expect(val({ type: 'unavailable', abaHr: true, abaActivity: 'group-training', staffIds: [] }).warns.some((x) => x.id === 'aba.noStaff')).toBe(true)
    const withClient = val({ type: 'unavailable', abaHr: true, abaActivity: 'group-training', clientIds: ['c1'] })
    expect(withClient.flags.some((x) => x.id === 'aba.clientAttached')).toBe(true)
  })

  it('says nothing at all when the flag is off', () => {
    const r = val({ type: 'unavailable', abaHr: false, abaActivity: '' })
    expect(r.items.filter((x) => x.group === 'aba')).toEqual([])
  })

  it('clears the whole block on a clean behavior-analytic booking', () => {
    const r = val({ type: 'unavailable', abaHr: true, abaActivity: 'intervention-design' })
    expect(r.items.filter((x) => x.group === 'aba')).toEqual([])
  })

  it('is configurable, and the practice can silence or escalate each rule', () => {
    const s = state()
    const res = planSettingsOp(s, 'appointmentValidations.patch', { patch: { aba: { serviceAppt: 'warn', activity: 'none' } } })
    expect(res.ok).toBe(true)
    const next = { ...s, settings: { ...s.settings, ...res.patch } }
    expect(appointmentValidationsCfg(next.settings).aba.serviceAppt).toBe('warn')
    const r = evaluateAppointmentValidations(next, { id: 'd', type: 'service', abaHr: true, abaActivity: 'facility', status: 'active', staffIds: ['s3'] })
    expect(r.stops.some((x) => x.group === 'aba')).toBe(false)
    expect(r.warns.some((x) => x.id === 'aba.serviceAppt')).toBe(true)
    expect(r.items.some((x) => x.id === 'aba.activity')).toBe(false)
  })

  it('refuses an unknown validation group', () => {
    expect(planSettingsOp(state(), 'appointmentValidations.patch', { patch: { nope: { x: 'stop' } } }).ok).toBe(false)
  })
})

describe('downstream systems', () => {
  it('carries the flag onto the payroll line and totals it without changing pay', () => {
    const s = state([
      appt('p1', { staffIds: ['s3'], date: '2026-06-16', start: 540, end: 660, title: 'ABA group training' }),
      appt('p2', { staffIds: ['s3'], date: '2026-06-17', start: 540, end: 600, abaHr: false, title: 'Unavail — medical appt' }),
    ])
    const period = periodFor(s.settings.payroll, '2026-06-16')
    const lines = scheduleLines(s, 's3', period)
    const aba = lines.find((l) => l.apptId === 'p1')
    expect(aba.meta.abaHr).toBe(true)
    expect(aba.meta.abaActivity).toBe('group-training')
    const ts = lineTotals(lines)
    expect(ts.abaHours).toBe(2)
    expect(ts.hours).toBe(2) // only the training block pays here; the flag changed no earning code
  })

  it('reports the ledger per person and per activity', () => {
    const s = state([
      appt('r1', { staffIds: ['s3'], start: 540, end: 660 }),
      appt('r2', { staffIds: ['s5'], start: 540, end: 720, abaActivity: 'intervention-design' }),
    ])
    const out = runReport(s, 'abahours', { days })
    expect(REPORT_BY_ID.abahours.cat).toBe('people')
    const rbt = out.rows.find((r) => r.staff === 'Sam Tech')
    expect(rbt.hours).toBe(2)
    expect(rbt.track).toBe('RBT / BCAT')
    expect(rbt.activities).toMatch(/Group training/)
    expect(out.rows.find((r) => r.staff === 'Gus Student').activities).toMatch(/intervention/i)
    expect(out.summary[0].value).toBe('5 h')
  })

  it('flags a bad ⚡ flag in the data-quality sweep', () => {
    const s = state([
      appt('q1', { type: 'service', clientIds: ['c1'], start: 540, end: 600 }),
      appt('q2', { start: 660, end: 720, abaActivity: 'general-admin' }),
      appt('q3', { start: 780, end: 840, abaActivity: '' }),
    ])
    const issues = validationIssues(s, days, null)
    const aba = issues.filter((i) => i.cat === 'ABA Hours')
    expect(aba.some((i) => /service appointment/.test(i.msg) && i.sev === 'error')).toBe(true)
    expect(aba.some((i) => /not behavior-analytic time/.test(i.msg) && i.sev === 'error')).toBe(true)
    expect(aba.some((i) => /without an activity/.test(i.msg) && i.sev === 'warn')).toBe(true)
  })
})

describe('the one-time migration', () => {
  const legacy = () => ({
    appts: {
      a: { id: 'a', type: 'service', abaHr: true, clientIds: ['c1'], date: MON, start: 540, end: 660 },
      b: { id: 'b', type: 'evaluation', abaHr: true, clientIds: ['c1'], date: MON, start: 540, end: 660 },
      c: { id: 'c', type: 'unavailable', abaHr: true, abaActivity: 'group-training', date: MON, start: 540, end: 660 },
      d: { id: 'd', type: 'break', abaHr: false, date: MON, start: 540, end: 600 },
    },
    staff: STAFF,
    clients: [],
    settings: {},
    meta: {},
  })

  it('strips the flag from service appointments and keeps every non-service one', () => {
    const out = normalizeAbaHours(legacy())
    expect(out.appts.a.abaHr).toBe(false)
    expect(out.appts.b.abaHr).toBe(false)
    expect('abaActivity' in out.appts.a).toBe(false)
    expect(out.appts.c.abaHr).toBe(true)
    expect(out.appts.c.abaActivity).toBe('group-training')
    expect(out.meta.abaHoursStripped).toBe(2)
  })

  it('is idempotent and reports what it did', () => {
    const once = normalizeAbaHours(legacy())
    const twice = normalizeAbaHours(once)
    expect(twice).toBe(once)
    expect(twice.appts.c.abaHr).toBe(true)
  })

  it('keeps a fresh workspace untouched', () => {
    const fresh = { appts: { a: { id: 'a', type: 'unavailable', abaHr: true, abaActivity: 'coursework' } }, meta: {} }
    const out = normalizeAbaHours(fresh)
    expect(out.appts.a).toBe(fresh.appts.a)
    expect(out.meta.abaHoursStripped).toBe(0)
  })
})
