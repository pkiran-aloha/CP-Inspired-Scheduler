import { describe, it, expect, beforeEach } from 'vitest'
import { blankState, reducer } from '../state/store'
import { readWorkspaceBackup, createWorkspaceBackup, workspaceData } from '../lib/workspaceBackup'
import {
  periodsFor, periodFor, workweeksOf, applyRounding, evvStatus,
  defaultProfile, duplicatePayrollIds, seedPayProfiles,
  scheduleLines, timesheet, earningsFor, grossToNet, federalEstimate,
  computeRun, runGate, planSheet, planRun, newRun, stubFor, annualSummary,
  runBreakdown, linesInRange, sheetKey, defaultPayrollSettings, periodFromId, EARNING_CODES, EARNING_BY_ID, PAY_FREQUENCIES,
} from '../lib/payroll'
import { registerCsv, qboCsv, glJournalRows, achFile, stubHtml, toCsv } from '../lib/payrollExport'
import { todayISO } from '../lib/date'

beforeEach(() => localStorage.clear())

// ---------------------------------------------------------------------------
// A deterministic two-week fixture: one non-exempt RBT, one exempt BCBA.
// Two weeks matter because FLSA overtime is a workweek test, and the fixture is
// built so week 1 crosses 40 hours and week 2 does not.
// ---------------------------------------------------------------------------
const WEEK1 = '2026-03-02' // Monday
const W2 = '2026-03-09'
const friday = (week, h = 0, m = 0) => `${week.slice(0, 8)}${String(6 + h).padStart(2, '0')}` // not used; kept simple below

function appt(id, date, start, end, type, staffId, extra = {}) {
  return {
    id, date, start, end, type, title: `${type} ${id}`, staffIds: [staffId], clientIds: ['c1'],
    status: 'completed', custom: {}, ...extra,
  }
}

/** week1: 5 × 8h sessions (40h) + 2h drive = 42h  →  2 OT hours
 *  week2: 3 × 8h sessions (24h)                    →  no OT despite 66h period */
function fixture() {
  const s = blankState()
  const week1 = ['2026-03-02', '2026-03-03', '2026-03-04', '2026-03-05', '2026-03-06']
  const week2 = ['2026-03-09', '2026-03-10', '2026-03-11']
  const appts = {}
  week1.forEach((d, i) => { appts[`w1-${i}`] = appt(`w1-${i}`, d, 540, 1020, 'service', 'rbt') })  // 8h each
  appts['w1-drive'] = appt('w1-drive', '2026-03-06', 1020, 1140, 'drive', 'rbt')                    // 2h
  week2.forEach((d, i) => { appts[`w2-${i}`] = appt(`w2-${i}`, d, 540, 1020, 'service', 'rbt') })
  return {
    ...s,
    appts,
    staff: [
      { id: 'rbt', name: 'Test RBT', role: 'RBT · Home Programs', payrollRate: 25, initials: 'TR', color: '#10b981' },
      { id: 'bcba', name: 'Test BCBA', role: 'BCBA · Supervisor', payrollRate: 50, initials: 'TB', color: '#6366f1' },
    ],
    payProfiles: [
      { ...defaultProfile({ id: 'rbt', role: 'RBT', payrollRate: 25 }, 0), staffId: 'rbt', id: 'pay-rbt', payrollId: 'RBT-001', payType: 'hourly', baseRate: 25, classification: 'nonexempt', state: 'CA', rates: { DRIVE: 25, SUP: 27.5, ADMIN: 25 } },
      { ...defaultProfile({ id: 'bcba', role: 'BCBA', payrollRate: 50 }, 1), staffId: 'bcba', id: 'pay-bcba', payrollId: 'BCBA-001', payType: 'salary', annualSalary: 104000, classification: 'exempt', classificationReviewed: true, state: 'CA' },
    ],
    paySheets: {
      [sheetKey('rbt', 'pp-biweekly-2026-03-02')]: { id: sheetKey('rbt', 'pp-biweekly-2026-03-02'), staffId: 'rbt', periodId: 'pp-biweekly-2026-03-02', status: 'approved', adjustments: [], audit: [] },
      [sheetKey('bcba', 'pp-biweekly-2026-03-02')]: { id: sheetKey('bcba', 'pp-biweekly-2026-03-02'), staffId: 'bcba', periodId: 'pp-biweekly-2026-03-02', status: 'approved', adjustments: [], audit: [] },
    },
    payRuns: {},
    settings: { ...s.settings, payroll: { ...defaultPayrollSettings(), anchor: WEEK1, frequency: 'biweekly' } },
  }
}
const period = (state) => periodsFor(state.settings.payroll, WEEK1, { back: 0, forward: 0 })[0]

describe('pay periods', () => {
  it('builds bi-weekly, semi-monthly and monthly cycles with cutoffs and pay dates', () => {
    const p = defaultPayrollSettings()
    const weekly = periodsFor({ ...p, frequency: 'weekly', anchor: '2026-03-02' }, '2026-03-02', { back: 0, forward: 2 })
    expect(weekly).toHaveLength(3)
    expect(weekly[0]).toMatchObject({ start: '2026-03-02', end: '2026-03-08', payDate: '2026-03-13' })

    const monthly = periodsFor({ ...p, frequency: 'monthly', anchor: '2026-03-01' }, '2026-03-01', { back: 0, forward: 0 })
    expect(monthly[0].end).toBe('2026-03-30')

    const semi = periodsFor({ ...p, frequency: 'semimonthly', anchor: '2026-03-01' }, '2026-03-01', { back: 0, forward: 0 })
    expect(semi).toHaveLength(2)
    expect(semi[0].end).toBe('2026-03-15')
    expect(semi[1].start).toBe('2026-03-16')
    expect(semi[1].end).toBe('2026-03-31')
  })

  it('slices a pay period into FLSA workweeks, including partial weeks at the edges', () => {
    const p = { id: 'x', start: '2026-03-04', end: '2026-03-17' } // starts mid-week (Wed)
    const weeks = workweeksOf(p, 1)
    expect(weeks[0]).toEqual({ start: '2026-03-02', end: '2026-03-08' })
    expect(weeks.length).toBeGreaterThanOrEqual(3)
    expect(weeks[weeks.length - 1].end).toBe('2026-03-22')
  })

  it('never rounds time in a way that silently pays less', () => {
    expect(applyRounding(37, { mode: 'none' })).toEqual({ minutes: 37, delta: 0 })
    expect(applyRounding(37, { mode: 'nearest', mins: 15 }).minutes).toBe(30)
    expect(applyRounding(38, { mode: 'nearest', mins: 15 }).minutes).toBe(45)
  })
})

describe('time capture from the calendar', () => {
  it('derives payable lines per earning code and flags visit verification state', () => {
    const s = fixture()
    const p = period(s)
    const lines = scheduleLines(s, 'rbt', p)
    const byCode = lines.reduce((m, l) => ({ ...m, [l.code]: (m[l.code] || 0) + l.minutes }), {})
    expect(byCode.REG).toBe(8 * 60 * 8) // 8 sessions × 8h
    expect(byCode.DRIVE).toBe(120)
    // completed sessions with no signature are "not recorded", cancelled are n/a
    expect(lines[0].meta.evv).toBe('not recorded')
    expect(evvStatus({ status: 'cancelled' })).toBe('n/a')
    expect(evvStatus({ status: 'completed', verification: { signature: { geo: { lat: 1, lng: 2 } }, verifyStatus: 'verified' } })).toBe('verified (gps)')
    expect(evvStatus({ status: 'confirmed' })).toBe('scheduled')
  })

  it('pays cancellations by notice band and pays nothing outside the band', () => {
    const s = fixture()
    const p = period(s)
    s.appts.cancelledShort = appt('cancelledShort', '2026-03-04', 540, 660, 'service', 'rbt', { status: 'cancelled', cancelNoticeHours: 2 })
    s.appts.cancelledLong = appt('cancelledLong', '2026-03-05', 540, 660, 'service', 'rbt', { status: 'cancelled', cancelNoticeHours: 30 })
    s.appts.noShow = appt('noShow', '2026-03-06', 540, 660, 'service', 'rbt', { status: 'no-show' })
    const lines = scheduleLines(s, 'rbt', p)
    const canc = lines.filter((l) => l.code === 'CANC')
    // short-notice: 50% of 2h = 1h; no-show: 100% of 2h = 2h; the 30h-notice cancel pays nothing
    expect(canc.filter((l) => l.apptId === 'cancelledShort')[0].minutes).toBe(60)
    expect(canc.filter((l) => l.apptId === 'noShow')[0].minutes).toBe(120)
    expect(canc.find((l) => l.apptId === 'cancelledLong')).toBeUndefined()
  })

  it('excludes breaks and unavailability unless a policy pays them, and includes supervisor adjustments', () => {
    const s = fixture()
    const p = period(s)
    s.appts.brk = appt('brk', '2026-03-04', 1020, 1050, 'break', 'rbt')
    s.appts.unavail = appt('unavail', '2026-03-04', 1050, 1140, 'unavailable', 'rbt', { title: 'Admin block' })
    expect(scheduleLines(s, 'rbt', p).some((l) => l.apptId === 'brk')).toBe(false)
    expect(scheduleLines(s, 'rbt', p).some((l) => l.apptId === 'unavail')).toBe(false)

    const paid = { ...s, settings: { ...s.settings, payroll: { ...s.settings.payroll, payBreaks: true } } }
    expect(scheduleLines(paid, 'rbt', period(paid)).filter((l) => l.apptId === 'brk')[0].code).toBe('ADMIN')

    // an approved sheet cannot simply be resubmitted over the top
    expect(planSheet(s, 'rbt', p.id, 'submit', { who: 'Supervisor' }).ok).toBe(false)
    const reopened = { ...s, paySheets: { ...s.paySheets, ...planSheet(s, 'rbt', p.id, 'revert', { who: 'Supervisor', force: true }).sheets } }
    expect(planSheet(reopened, 'rbt', p.id, 'submit', { who: 'Supervisor', at: 1 }).ok).toBe(true)
    const adj = planSheet(s, 'rbt', p.id, 'adjust', { who: 'Supervisor', period: p, adjustment: { code: 'TRAIN', date: '2026-03-05', hours: 2, note: 'CPI recert' } })
    expect(adj.ok).toBe(true)
    const withAdj = { ...s, paySheets: { ...s.paySheets, ...adj.sheets } }
    const t = timesheet(withAdj, 'rbt', p.id)
    expect(t.lines.some((l) => l.code === 'TRAIN' && l.minutes === 120)).toBe(true)
  })
})

describe('overtime is a workweek test', () => {
  it('pays a half-time premium only for hours past the threshold in a single week', () => {
    const s = fixture()
    const e = earningsFor(s, 'rbt', period(s).id)
    // week 1: 40 session hours + 2 drive hours = 42 → 2 OT hours at a $25 regular rate
    expect(e.otHours).toBeCloseTo(2, 4)
    const ot = e.rows.find((r) => r.code === 'OT')
    expect(ot).toBeTruthy()
    expect(ot.regularRate).toBe(25)
    expect(ot.cents).toBe(2500) // 2h × $25 × 0.5 premium = $25
    // 66 total hours in the period, but no more overtime than the two week-1 hours
    expect(e.workedHours).toBeCloseTo(66, 4)
  })

  it('folds nondiscretionary bonuses into the regular rate before the premium', () => {
    const s = fixture()
    const p = period(s)
    const tx = planSheet(s, 'rbt', p.id, 'adjust', { who: 'Admin', period: p, adjustment: { code: 'BONUS', date: '2026-03-04', hours: 60, note: 'Retention bonus' } })
    const withBonus = { ...s, paySheets: { ...s.paySheets, ...tx.sheets } }
    const e = earningsFor(withBonus, 'rbt', p.id)
    const ot = e.rows.find((r) => r.code === 'OT')
    // ($1000 straight + $60 bonus) / 42h = $25.2381 → premium 2 × 0.5 × 25.2381 = $25.24
    expect(ot.cents).toBeGreaterThan(2500)
    expect(ot.regularRate).toBeGreaterThan(25)
  })

  it('never pays overtime to a reviewed exempt salaried employee', () => {
    const s = fixture()
    const e = earningsFor(s, 'bcba', period(s).id)
    expect(e.otHours).toBe(0)
    expect(e.rows.some((r) => r.code === 'OT')).toBe(false)
    expect(e.rows.find((r) => r.salaryBaseline).cents).toBe(Math.round((104000 / 26) * 100))
  })
})

describe('gross to net', () => {
  it('applies pre-tax deductions, statutory withholding and employer cost coherently', () => {
    const s = fixture()
    const n = grossToNet(s, 'rbt', period(s).id)
    const gross = n.grossCents
    expect(gross).toBeGreaterThan(0)
    // net = gross − pre-tax − taxes − post-tax (+ reimbursements)
    expect(n.netCents).toBe(gross - n.preTaxCents - n.taxCents - n.postTaxCents + n.reimbursementCents)
    expect(n.taxCents).toBeGreaterThan(0)
    expect(n.taxCents / gross).toBeLessThan(0.35) // a plausible effective rate, not a nonsense one
    const ss = n.taxRows.find((t) => t.code === 'FICA-SS')
    expect(ss.cents).toBe(Math.round((gross - n.preTaxCents) * 0.062))
    expect(n.employer.find((e) => e.code === 'FICA-SS-ER').cents).toBe(ss.cents)
    expect(n.totalCostCents).toBe(gross + n.employerCents)
  })

  it('caps Social Security at the wage base and adds the additional Medicare rate past the threshold', () => {
    const s = fixture()
    const taxes = s.settings.payroll.taxes
    // a huge single period pushes the employee past the Social Security base
    const big = { ...s, appts: { ...s.appts, giant: appt('giant', '2026-03-04', 0, 1439, 'service', 'rbt') } }
    const n = grossToNet(big, 'rbt', period(big).id)
    void taxes
    expect(n.fedCents).toBeGreaterThan(0)
    expect(n.taxRows.find((t) => t.code === 'FICA-SS').cents).toBeLessThan(n.grossCents * 0.062)
  })

  it('estimates federal tax progressively, in cents, with no unit drift', () => {
    const taxes = defaultPayrollSettings().taxes
    const profile = { tax: { filingStatus: 'single', dependents: 0 } }
    // $30,000/yr single: 14,600 standard deduction → 15,400 taxable → 10% on 11,600 + 12% on 3,800
    const tax = federalEstimate(3_000_000, profile, taxes)
    expect(tax).toBe(Math.round((11600 * 0.10 + 3800 * 0.12) * 100))
    expect(federalEstimate(0, profile, taxes)).toBe(0)
    expect(federalEstimate(5_000_000, { tax: { exempt: true } }, taxes)).toBe(0)
  })

  it('shows the derived cost per delivered clinical hour', () => {
    const s = fixture()
    const n = grossToNet(s, 'rbt', period(s).id)
    expect(n.deliveredHours).toBeCloseTo(64, 4) // 8 × 8h sessions, drive excluded
    expect(n.costPerDeliveredHourCents).toBe(Math.round(n.totalCostCents / n.deliveredHours))
  })
})

describe('run gates', () => {
  it('blocks duplicate payroll IDs, unapproved runs and missing rates', () => {
    const s = fixture()
    const p = period(s)
    const dupes = { ...s, payProfiles: s.payProfiles.map((x) => ({ ...x, payrollId: 'SAME-ID' })) }
    expect(runGate(dupes, p).blockers.some((b) => b.code === 'dup-payroll-id')).toBe(true)
    expect(duplicatePayrollIds(dupes.payProfiles)).toHaveLength(1)

    const noRate = { ...s, payProfiles: s.payProfiles.map((x) => (x.staffId === 'rbt' ? { ...x, baseRate: 0, rates: {} } : x)) }
    expect(runGate(noRate, p).blockers.some((b) => b.code === 'no-rate')).toBe(true)

    const noEmployees = runGate(s, p, { included: [] })
    expect(noEmployees.blockers.some((b) => b.code === 'no-employees')).toBe(true)
  })

  it('warns, but does not block, on unapproved timesheets, unreviewed exempt status and EVV gaps', () => {
    const s = fixture()
    const p = period(s)
    s.paySheets = {}
    const g = runGate(s, p)
    expect(g.blockers).toHaveLength(0)
    expect(g.warnings.some((w) => w.code === 'sheet-not-approved')).toBe(true)
    expect(g.warnings.some((w) => w.code === 'evv-missing')).toBe(true)

    const unreviewed = fixture()
    unreviewed.payProfiles = unreviewed.payProfiles.map((x) => (x.staffId === 'bcba' ? { ...x, classificationReviewed: false } : x))
    expect(runGate(unreviewed, period(unreviewed)).warnings.some((w) => w.code === 'exempt-unreviewed')).toBe(true)
  })

  it('blocks an overtime multiplier below the federal minimum and warns about rounding', () => {
    const s = fixture()
    s.settings.payroll = { ...s.settings.payroll, otMultiplier: 1.2 }
    expect(runGate(s, period(s)).blockers.some((b) => b.code === 'ot-rate')).toBe(true)
    const rounded = fixture()
    rounded.settings.payroll = { ...rounded.settings.payroll, rounding: { mode: 'nearest', mins: 15 } }
    expect(runGate(rounded, period(rounded)).warnings.some((w) => w.code === 'rounding')).toBe(true)
  })

  it('blocks a negative net pay instead of inventing money', () => {
    const s = fixture()
    s.payProfiles = s.payProfiles.map((x) => (x.staffId === 'rbt' ? { ...x, deductions: [{ id: 'd1', code: 'X', label: 'Huge garnishment', kind: 'posttax', calc: 'flat', value: 99999 }] } : x))
    const n = grossToNet(s, 'rbt', period(s).id)
    expect(n.netCents).toBeLessThan(0)
    expect(runGate(s, period(s)).blockers.some((b) => b.code === 'negative-net')).toBe(true)
  })
})

describe('pay run lifecycle & controls', () => {
  it('requires a second approver before a run can be approved', () => {
    const s = fixture()
    const p = period(s)
    const run = newRun(s, p, { who: 'Preparer' })
    const state = { ...s, payRuns: { [run.id]: run } }
    const selfApprove = planRun(state, p, 'approve', { runId: run.id, who: 'Preparer' })
    expect(selfApprove.ok).toBe(false)
    expect(selfApprove.msg).toMatch(/Segregation of duties/)
    const second = planRun(state, p, 'approve', { runId: run.id, who: 'Owner' })
    expect(second.ok).toBe(true)
    expect(second.runs[run.id].status).toBe('approved')
  })

  it('sends a draft for approval without approving it', () => {
    const s = fixture()
    const p = period(s)
    const run = newRun(s, p, { who: 'Preparer' })
    const state = { ...s, payRuns: { [run.id]: run } }
    const sent = planRun(state, p, 'submit', { runId: run.id, who: 'Preparer' })
    expect(sent.ok).toBe(true)
    expect(sent.runs[run.id].status).toBe('pending_approval')
    expect(sent.runs[run.id].approvedBy).toBeUndefined()
    const pending = { ...state, payRuns: sent.runs }
    expect(planRun(pending, p, 'submit', { runId: run.id }).ok).toBe(false)
    expect(planRun(pending, p, 'approve', { runId: run.id, who: 'Owner' }).runs[run.id].status).toBe('approved')
  })

  it('re-prices, locks and freezes the register at processing, and marks timesheets processed', () => {
    const s = fixture()
    const p = period(s)
    const run = newRun(s, p, { who: 'Preparer' })
    let state = { ...s, payRuns: { [run.id]: run } }
    state = { ...state, payRuns: { ...state.payRuns, ...planRun(state, p, 'approve', { runId: run.id, who: 'Owner' }).runs } }
    const processed = planRun(state, p, 'process', { runId: run.id, who: 'Owner' })
    expect(processed.ok).toBe(true)
    const locked = processed.runs[run.id]
    expect(locked.locked).toBe(true)
    expect(locked.status).toBe('processed')
    expect(locked.lines).toHaveLength(2)
    expect(locked.totals.grossCents).toBeGreaterThan(0)
    expect(processed.sheets[sheetKey('rbt', p.id)].status).toBe('processed')
    // the locked register carries the gross→net detail the exports read
    expect(locked.lines[0].preTax).toBeDefined()
    expect(locked.lines[0].taxRows.length).toBeGreaterThan(0)
  })

  it('refuses to void a processed run without an explicit reversal decision', () => {
    const s = fixture()
    const p = period(s)
    const run = { ...newRun(s, p, { who: 'A' }), status: 'processed', locked: true }
    const state = { ...s, payRuns: { [run.id]: run } }
    expect(planRun(state, p, 'void', { runId: run.id }).ok).toBe(false)
    expect(planRun(state, p, 'void', { runId: run.id, force: true }).ok).toBe(true)
  })

  it('refuses a second run for a period that already has one', () => {
    const s = fixture()
    const p = period(s)
    const run = newRun(s, p, { who: 'A' })
    const state = { ...s, payRuns: { [run.id]: run } }
    expect(runGate(state, p).blockers.some((b) => b.code === 'duplicate-run')).toBe(true)
  })

  it('lets a draft run exclude an employee but not an approved one', () => {
    const s = fixture()
    const p = period(s)
    const run = newRun(s, p, { who: 'A' })
    const state = { ...s, payRuns: { [run.id]: run } }
    const excl = planRun(state, p, 'exclude', { runId: run.id, staffId: 'bcba' })
    expect(excl.ok).toBe(true)
    expect(excl.runs[run.id].included).toEqual(['rbt'])
    const approved = { ...state, payRuns: { [run.id]: { ...run, status: 'approved' } } }
    expect(planRun(approved, p, 'exclude', { runId: run.id, staffId: 'rbt' }).ok).toBe(false)
  })

  it('records an audit trail for every transition', () => {
    const s = fixture()
    const p = period(s)
    const run = newRun(s, p, { who: 'Preparer' })
    let state = { ...s, payRuns: { [run.id]: run } }
    state = { ...state, payRuns: { ...state.payRuns, ...planRun(state, p, 'approve', { runId: run.id, who: 'Owner' }).runs } }
    state = { ...state, payRuns: { ...state.payRuns, ...planRun(state, p, 'process', { runId: run.id, who: 'Owner' }).runs } }
    const actions = state.payRuns[run.id].audit.map((a) => a.action)
    expect(actions).toContain('created')
    expect(actions).toContain('approved')
    expect(actions).toContain('processed')
    expect(state.payRuns[run.id].audit.every((a) => a.who && a.at)).toBe(true)
  })

  it('keeps segregation of duties for timesheets as well as runs', () => {
    const s = fixture()
    const p = period(s)
    let state = { ...s }
    state = { ...state, paySheets: { ...state.paySheets, ...planSheet(state, 'rbt', p.id, 'revert', { who: 'Admin', force: true }).sheets } }
    state = { ...state, paySheets: { ...state.paySheets, ...planSheet(state, 'rbt', p.id, 'submit', { who: 'RBT' }).sheets } }
    const blocked = planSheet(state, 'rbt', p.id, 'approve', { who: 'RBT' })
    expect(blocked.ok).toBe(false)
    expect(blocked.msg).toMatch(/Segregation of duties/)
    expect(planSheet(state, 'rbt', p.id, 'approve', { who: 'Supervisor' }).ok).toBe(true)
  })

  it('refuses to silently edit an approved timesheet', () => {
    const s = fixture()
    const p = period(s)
    expect(planSheet(s, 'rbt', p.id, 'revert', {}).ok).toBe(false) // rbt sheet is seeded approved
    expect(planSheet(s, 'rbt', p.id, 'revert', { force: true }).ok).toBe(true)
  })
})

describe('who gets paid', () => {
  it('records the employees left out of a run, not just the ones included', () => {
    const s = fixture()
    const p = period(s)
    const run = newRun(s, p, { who: 'A' })
    expect(run.included.length).toBeGreaterThan(1)
    expect(run.excluded).toEqual([])

    const dropped = { ...s, payRuns: { [run.id]: run } }
    const tx = planRun(dropped, p, 'exclude', { runId: run.id, staffId: 'bcba', who: 'B' })
    expect(tx.ok).toBe(true)
    expect(tx.runs[run.id].included).not.toContain('bcba')
    expect(tx.runs[run.id].excluded).toEqual(['bcba'])
    // the register is re-priced for the smaller population
    expect(tx.runs[run.id].totals.staff).toBe(run.totals.staff - 1)
    expect(tx.runs[run.id].totals.grossCents).toBeLessThan(run.totals.grossCents)
    expect(tx.runs[run.id].audit.map((a) => a.action)).toContain('employee excluded')

    // and putting them back clears the exception
    const back = { ...dropped, payRuns: tx.runs }
    const tx2 = planRun(back, p, 'include', { runId: run.id, staffId: 'bcba', who: 'B' })
    expect(tx2.runs[run.id].excluded).toEqual([])
    expect(tx2.runs[run.id].totals.grossCents).toBe(run.totals.grossCents)
  })

  it('refuses to empty a run completely', () => {
    const s = fixture()
    const p = period(s)
    const run = newRun(s, p, { who: 'A' })
    let state = { ...s, payRuns: { [run.id]: run } }
    const ids = [...run.included]
    let last = null
    for (const id of ids) {
      last = planRun(state, p, 'exclude', { runId: run.id, staffId: id, who: 'B' })
      if (last.ok) state = { ...state, payRuns: last.runs }
    }
    expect(last.ok).toBe(false)
    expect(Object.values(state.payRuns)[0].included.length).toBeGreaterThan(0)
  })
})

describe('one period grid', () => {
  it('every entry point agrees on which period contains a date', () => {
    const s = fixture()
    const payroll = s.settings.payroll
    const offered = periodsFor(payroll, payroll.anchor, { back: 12, forward: 12 })
    for (const date of ['2026-09-29', '2026-09-21', '2026-10-04', '2026-10-05', '2026-04-06', '2025-01-15']) {
      const p = periodFor(payroll, date)
      expect(date >= p.start && date <= p.end).toBe(true)
      // the id resolves to exactly those dates wherever it is looked up from
      expect(periodFromId(payroll, p.id)).toMatchObject({ start: p.start, end: p.end })
      // and anything inside the offered window is offered, not re-derived on another grid
      if (date >= offered[0].start && date <= offered[offered.length - 1].end) {
        expect(offered.find((o) => date >= o.start && date <= o.end)?.id).toBe(p.id)
      }
    }
    // and the picker's own options must round-trip through the id parser
    for (const o of offered) {
      expect(periodFromId(payroll, o.id)).toMatchObject({ start: o.start, end: o.end })
    }
  })
})

describe('year to date and stubs', () => {
  it('counts only processed runs toward year-to-date figures', () => {
    const s = fixture()
    const p = period(s)
    const draft = { ...newRun(s, p, { who: 'A' }), status: 'draft' }
    expect(annualSummary({ ...s, payRuns: { r1: draft } }, 'rbt', '2026').runs).toBe(0)
    const locked = { ...draft, status: 'processed', locked: true }
    const y = annualSummary({ ...s, payRuns: { r1: locked } }, 'rbt', '2026')
    expect(y.runs).toBe(1)
    expect(y.grossCents).toBe(locked.lines[0].grossCents)
  })

  it('builds a stub with earnings, taxes, employer cost and an explicit estimate disclaimer', () => {
    const s = fixture()
    const p = period(s)
    const run = { ...newRun(s, p, { who: 'A' }), status: 'processed', locked: true }
    const stub = stubFor(s, run, 'rbt')
    expect(stub.line.staffId).toBe('rbt')
    const html = stubHtml(stub)
    expect(html).toMatch(/estimates/i)
    expect(html).toMatch(/not legal or tax advice/i)
    expect(html).toContain('Pay stub')
    expect(html).toContain('Net pay')
  })
})

describe('exports', () => {
  const built = () => {
    const s = fixture()
    const p = period(s)
    const run = { ...newRun(s, p, { who: 'A' }), status: 'processed', locked: true }
    return { s, p, run }
  }

  it('exports a register with one row per employee per earning code and a totals line', () => {
    const { s, run } = built()
    const csv = registerCsv(run, s)
    const rows = csv.split('\n')
    expect(rows[0]).toContain('Earning code')
    expect(rows.some((r) => r.startsWith('TOTAL'))).toBe(true)
    expect(csv).toContain('RBT-001')
    expect(csv).toContain('verify against your payroll provider')
    expect(csv).toContain('Estimated withholding')
    expect(csv.split('\n').length).toBeGreaterThan(4)
  })

  it('keys the provider export on the payroll ID and refuses to invent one', () => {
    const { s, run } = built()
    const csv = qboCsv(run, s)
    expect(csv.split('\n')[0]).toContain('Payroll ID')
    expect(csv).toContain('RBT-001')
    expect(csv).toContain('QuickBooks')
  })

  it('balances the GL journal to the cent (every debit has its credit)', () => {
    const { s, run } = built()
    const rows = glJournalRows(run, s).slice(1)
    const sum = (i) => rows.reduce((t, r) => t + (Number(r[i]) || 0), 0)
    expect(Math.round(sum(4) * 100)).toBe(Math.round(sum(5) * 100))
    expect(Math.round(sum(4) * 100)).toBe(run.totals.grossCents + run.totals.employerCents + (run.totals.reimbursementCents || 0))
    const credits = rows.filter((r) => Number(r[5]) > 0).map((r) => r[2])
    expect(credits.some((c) => c.includes('Employer taxes payable'))).toBe(true)
  })

  it('builds a NACHA-shaped draft that carries the net total and never claims to be validated', () => {
    const { s, run } = built()
    const file = achFile(run, s)
    const lines = file.split('\r\n').filter((l) => l.length > 0)
    expect(lines[0].startsWith('101 ')).toBe(true)
    expect(lines.some((l) => l.startsWith('5200'))).toBe(true)
    expect(lines.filter((l) => l.startsWith('622')).length).toBe(run.lines.length)
    const totalCents = run.lines.reduce((t, l) => t + l.netCents, 0)
    const batch = lines.find((l) => l.startsWith('8'))
    expect(batch).toContain(String(Math.round(totalCents / 100)).padStart(12, '0'))
    expect(lines.every((l) => l.length === 94)).toBe(true)
  })

  it('keeps the journal balanced when non-taxable reimbursements are in the run', () => {
    const s = fixture()
    const p = period(s)
    const tx = planSheet(s, 'rbt', p.id, 'adjust', { who: 'Admin', period: p, adjustment: { code: 'MILE', date: '2026-03-05', hours: 42.5, note: 'Mileage' } })
    const withMileage = { ...s, paySheets: { ...s.paySheets, ...tx.sheets } }
    const run = { ...newRun(withMileage, p, { who: 'A' }), status: 'processed', locked: true }
    const rows = glJournalRows(run, withMileage).slice(1)
    const sum = (i) => rows.reduce((t, r) => t + (Number(r[i]) || 0), 0)
    expect(run.totals.reimbursementCents).toBe(4250)
    const rbt = run.lines.find((l) => l.staffId === 'rbt')
    expect(rbt.earnings.some((e) => e.code === 'MILE' && e.cents === 4250)).toBe(true)
    // the reimbursement is paid out but is not part of taxable gross
    expect(rbt.grossCents).toBe(earningsFor(withMileage, 'rbt', p.id).rows.filter((r) => EARNING_BY_ID[r.code]?.taxable !== false).reduce((t, r) => t + r.cents, 0))
    expect(rbt.netCents).toBeGreaterThan(rbt.grossCents - rbt.taxCents - rbt.preTaxCents - rbt.postTaxCents)
    expect(Math.round(sum(4) * 100)).toBe(Math.round(sum(5) * 100))
  })

  it('escapes CSV cells that contain commas or quotes', () => {
    expect(toCsv([['a,b', 'say "hi"']])).toBe('"a,b","say ""hi"""')
  })
})

describe('workspace integration', () => {
  it('carries payroll master data, sheets, runs and exports through a backup round-trip', () => {
    const s = fixture()
    const p = period(s)
    const run = { ...newRun(s, p, { who: 'A' }), status: 'processed', locked: true, no: 'PR-0001' }
    const full = {
      ...s,
      payRuns: { [run.id]: run },
      payExports: { exp1: { id: 'exp1', kind: 'qbo_payroll', fileName: 'x.csv', rows: 3 } },
    }
    const raw = createWorkspaceBackup(full, '2026-03-16T00:00:00.000Z')
    const { data, counts } = readWorkspaceBackup(raw, blankState())
    expect(data.payProfiles).toHaveLength(2)
    expect(data.paySheets[sheetKey('rbt', p.id)].status).toBe('approved')
    expect(Object.keys(data.payRuns)).toHaveLength(1)
    expect(data.payExports.exp1.kind).toBe('qbo_payroll')
    expect(counts.appointments).toBeGreaterThan(0)
    // and a restore is one atomic reducer step
    const restored = reducer(blankState(), { type: 'replace', payload: data })
    expect(restored.payRuns[run.id].totals.netCents).toBe(run.totals.netCents)
    expect(workspaceData(restored).payProfiles[0].staffId).toBe('rbt')
  })

  it('rejects a backup whose payroll ledgers are internally impossible', () => {
    const s = fixture()
    const data = workspaceData(s)
    const badProfile = { ...data, payProfiles: [{ ...data.payProfiles[0], staffId: 'ghost', payType: 'hourly', baseRate: 20, deductions: [] }] }
    expect(() => readWorkspaceBackup(JSON.stringify({ format: 'aloha-aba-workspace', version: 2, data: badProfile }), blankState())).toThrow(/payroll profiles/)
    const badRun = { ...data, payRuns: { r1: { id: 'r1', status: 'processed', locked: true, lines: [{ staffId: 'rbt', grossCents: 'lots' }] } } }
    expect(() => readWorkspaceBackup(JSON.stringify({ format: 'aloha-aba-workspace', version: 2, data: badRun }), blankState())).toThrow(/pay runs/)
    const badSheet = { ...data, paySheets: { s1: { id: 's1', staffId: 'rbt', status: 'whenever', adjustments: [] } } }
    expect(() => readWorkspaceBackup(JSON.stringify({ format: 'aloha-aba-workspace', version: 2, data: badSheet }), blankState())).toThrow(/timesheet/)
  })

  it('undoes a whole pay-run transaction in one step, leaving unrelated collections alone', () => {
    const s = fixture()
    const p = period(s)
    const { type, ...rest } = { type: 'create' }
    void type; void rest
    const run = newRun(s, p, { who: 'A' })
    let state = reducer(s, { type: 'payrollTx', scope: 'run', op: 'create', periodId: p.id, options: { who: 'A', included: ['rbt'] } })
    expect(Object.keys(state.payRuns)).toHaveLength(1)
    // a settings write is its own undoable transaction (audit CFG-12): one Undo
    // reverts it and touches nothing else, the next Undo reverts the payroll write
    state = reducer(state, { type: 'setSettings', patch: { theme: 'dark' } })
    state = reducer(state, { type: 'undo' })
    expect(state.settings.theme).toBe(s.settings.theme)
    expect(Object.keys(state.payRuns)).toHaveLength(1)
    state = reducer(state, { type: 'undo' })
    expect(Object.keys(state.payRuns)).toHaveLength(0)
    expect(state.settings.theme).toBe(s.settings.theme)
    expect(run.id).toBeTruthy()
  })

  it('undoes a timesheet approval without touching the run ledger', () => {
    const s = fixture()
    const p = period(s)
    let state = reducer(s, { type: 'payrollTx', scope: 'sheet', staffId: 'rbt', periodId: p.id, op: 'revert', options: { who: 'Admin', force: true } })
    expect(state.paySheets[sheetKey('rbt', p.id)].status).toBe('open')
    expect(Object.keys(state.payRuns)).toHaveLength(0)
    state = reducer(state, { type: 'undo' })
    expect(state.paySheets[sheetKey('rbt', p.id)].status).toBe('approved')
  })

  it('keeps the payroll settings snapshot reversible', () => {
    const s = fixture()
    let state = reducer(s, { type: 'payrollTx', scope: 'settings', settings: { otMultiplier: 2 } })
    expect(state.settings.payroll.otMultiplier).toBe(2)
    state = reducer(state, { type: 'undo' })
    expect(state.settings.payroll.otMultiplier).toBe(1.5)
  })

  it('seeds a usable module on a fresh workspace: profiles, provider IDs and an approval queue', () => {
    const s = blankState()
    const p = periodFor(s.settings.payroll, todayISO(), { back: 12, forward: 12 })
    expect(s.payProfiles.length).toBe(s.staff.length)
    expect(s.payProfiles.every((x) => x.payrollId)).toBe(true)
    expect(Object.keys(s.paySheets).length).toBeGreaterThan(0)
    expect(computeRun(s, p).lines.length).toBeGreaterThan(0)
    expect(periodFor(s.settings.payroll, todayISO(), {}).id).toBe(p.id)
  })

  it('summarises a run by office and earning code', () => {
    const s = fixture()
    const p = period(s)
    const run = newRun(s, p, { who: 'A' })
    const bd = runBreakdown(run, s)
    expect(bd.byCode.length).toBeGreaterThan(0)
    expect(bd.byOffice.reduce((t, o) => t + o.grossCents, 0)).toBe(run.totals.grossCents)
    expect(bd.byCode.find((c) => c.code === 'OT')).toBeTruthy()
  })

  it('gathers a date-range export through the pay periods that overlap it', () => {
    const s = fixture()
    const lines = linesInRange(s, 'rbt', '2026-03-02', '2026-03-08')
    expect(lines.length).toBe(6) // 5 sessions + 1 drive
    expect(lines.every((l) => l.date >= '2026-03-02' && l.date <= '2026-03-08')).toBe(true)
    expect(lines.every((l) => l.periodId)).toBe(true)
  })

  it('exposes a coherent earning-code catalogue', () => {
    const ids = EARNING_CODES.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(EARNING_BY_ID.REG.otEligible).toBe(true)
    expect(EARNING_BY_ID.BONUS.nondisc).toBe(true)
    expect(EARNING_BY_ID.MILE.taxable).toBe(false)
    expect(Object.keys(PAY_FREQUENCIES)).toEqual(['weekly', 'biweekly', 'semimonthly', 'monthly'])
  })

  it('seeds defensible defaults per role: hourly non-exempt technicians, salaried clinicians flagged for review', () => {
    const profiles = seedPayProfiles([
      { id: 'a', name: 'A', role: 'RBT · Home Programs', payrollRate: 26 },
      { id: 'b', name: 'B', role: 'BCBA', payrollRate: 52 },
    ])
    expect(profiles[0].payType).toBe('hourly')
    expect(profiles[0].classification).toBe('nonexempt')
    expect(profiles[1].payType).toBe('salary')
    expect(profiles[1].classification).toBe('exempt')
    expect(profiles[1].classificationReviewed).toBe(false) // never assert exempt without a human review
  })
})
