// ---- Payroll engine: what a session-delivery practice actually has to pay ----
//
// The domain rules below are modelled on how ABA / home-and-community practices
// are paid in the field, not on a generic "hours × rate" toy:
//
//   • Every paid duty is priced separately. Direct treatment, supervision and
//     overlap, drive time between clients, documentation/admin, training and
//     cancelled-session pay are distinct earning codes, because they carry
//     different rates, different tax treatment and different FLSA weight.
//   • Overtime is a *workweek* test, never a pay-period test. Two 45-hour weeks
//     and one 30-hour week are not the same thing even though the period totals
//     look tidy.
//   • FLSA regular rate: nondiscretionary additions (drive differentials, fixed
//     bonuses) belong in the regular rate before the half-time premium is taken.
//   • Events that produce no billable service still produce payroll decisions —
//     a cancellation is a policy decision table, not a blank cell.
//
// Everything here is pure: the engine takes the workspace, a pay period and an
// employee id and returns a full gross-to-net breakdown. No React, no network.
// Amounts are carried in integer cents to keep ledgers from drifting.

import { addDays, isoDate, parseISO, todayISO } from './date'
import { countsAsAbaHours } from './abaHours'

// ---------------------------------------------------------------------------
// Earning codes
// ---------------------------------------------------------------------------
// `otEligible`  — hours count toward the 40-hour workweek and attract OT premium
// `regularRate` — the pay is part of the FLSA regular rate (drives the premium)
// `nondisc`     — a nondiscretionary addition that must be spread into the rate
export const EARNING_CODES = [
  { id: 'REG', label: 'Regular (direct treatment)', short: 'Regular', kind: 'worked', otEligible: true, regularRate: true, taxable: true, duty: 'Direct care' },
  { id: 'SUP', label: 'Supervision / overlap', short: 'Supervision', kind: 'worked', otEligible: true, regularRate: true, taxable: true, duty: 'Clinical supervision' },
  { id: 'EVAL', label: 'Assessment / evaluation', short: 'Assessment', kind: 'worked', otEligible: true, regularRate: true, taxable: true, duty: 'Assessment' },
  { id: 'DRIVE', label: 'Drive time (between clients)', short: 'Drive', kind: 'worked', otEligible: true, regularRate: true, taxable: true, duty: 'Travel between sites' },
  { id: 'ADMIN', label: 'Documentation / admin', short: 'Admin', kind: 'worked', otEligible: true, regularRate: true, taxable: true, duty: 'Non-billable admin' },
  { id: 'TRAIN', label: 'Training / meetings', short: 'Training', kind: 'worked', otEligible: true, regularRate: true, taxable: true, duty: 'Required training' },
  { id: 'CANC', label: 'Cancellation / short-notice pay', short: 'Cancellation', kind: 'cancellation', otEligible: true, regularRate: true, taxable: true, duty: 'Cancelled session pay' },
  { id: 'OT', label: 'Overtime premium (0.5× regular rate)', short: 'OT premium', kind: 'premium', otEligible: false, regularRate: false, taxable: true, duty: 'FLSA overtime' },
  { id: 'PTO', label: 'Paid time off', short: 'PTO', kind: 'leave', otEligible: false, regularRate: false, taxable: true, duty: 'Leave' },
  { id: 'HOL', label: 'Holiday pay', short: 'Holiday', kind: 'leave', otEligible: false, regularRate: false, taxable: true, duty: 'Holiday' },
  { id: 'BONUS', label: 'Bonus (nondiscretionary)', short: 'Bonus', kind: 'bonus', otEligible: false, regularRate: true, nondisc: true, taxable: true, duty: 'Bonus' },
  { id: 'BONUSX', label: 'Bonus (discretionary)', short: 'Bonus (disc.)', kind: 'bonus', otEligible: false, regularRate: false, taxable: true, duty: 'Discretionary bonus' },
  { id: 'MILE', label: 'Mileage reimbursement (non-taxable)', short: 'Mileage', kind: 'expense', otEligible: false, regularRate: false, taxable: false, duty: 'Reimbursement' },
  { id: 'EXP', label: 'Expense reimbursement (non-taxable)', short: 'Expense', kind: 'expense', otEligible: false, regularRate: false, taxable: false, duty: 'Reimbursement' },
]
export const EARNING_BY_ID = Object.fromEntries(EARNING_CODES.map((c) => [c.id, c]))
export const WORKED_CODES = EARNING_CODES.filter((c) => c.kind === 'worked').map((c) => c.id)
export const MANUAL_CODES = ['ADMIN', 'TRAIN', 'PTO', 'HOL', 'BONUS', 'BONUSX', 'MILE', 'EXP']

// chunk-42: the earning-code master is editable in Settings → Payroll → Earning Code.
// Every read goes through these resolvers so a practice can rename, deactivate or add
// a code and have payroll, the register, the stub and the exports all follow.
// `EARNING_BY_ID` remains the *default* index (used by tests and legacy callers).
export const earningCodesFor = (payroll) => (Array.isArray(payroll?.earningCodes) && payroll.earningCodes.length ? payroll.earningCodes : EARNING_CODES)
export const earningIndex = (payroll) => Object.fromEntries(earningCodesFor(payroll).map((c) => [c.id, c]))
export const earningLabel = (payroll, code) => earningIndex(payroll)[code]?.label || code

// Appointment type → earning code. Unavailable/break blocks are deliberately
// absent: they are not hours worked unless a policy explicitly pays them.
export const APPT_CODE = { service: 'REG', supervision: 'SUP', evaluation: 'EVAL', drive: 'DRIVE' }

// ---------------------------------------------------------------------------
// Pay frequencies & periods
// ---------------------------------------------------------------------------
export const PAY_FREQUENCIES = {
  weekly: { id: 'weekly', label: 'Weekly', days: 7, periods: 52 },
  biweekly: { id: 'biweekly', label: 'Bi-weekly', days: 14, periods: 26 },
  semimonthly: { id: 'semimonthly', label: 'Semi-monthly', days: 15, periods: 24 },
  monthly: { id: 'monthly', label: 'Monthly', days: 30, periods: 12 },
}

const periodIdOf = (frequency, startISO) => `pp-${frequency}-${startISO}`

/** All pay periods for a frequency, walking forward/back from an anchor start. */
export function periodsFor(payroll, anchorISO, { back = 12, forward = 12 } = {}) {
  const freq = PAY_FREQUENCIES[payroll?.frequency] || PAY_FREQUENCIES.biweekly
  const anchor = anchorISO && /^\d{4}-\d{2}-\d{2}$/.test(anchorISO) ? anchorISO : todayISO()
  const out = []
  const step = freq.id === 'semimonthly' ? null : freq.days
  if (step) {
    for (let i = -back; i <= forward; i++) {
      const start = addDays(parseISO(anchor), i * step)
      const end = addDays(start, step - 1)
      out.push(makePeriod(freq, start, end, payroll))
    }
  } else {
    // semi-monthly: 1st→15th and 16th→end of month
    const base = parseISO(anchor)
    for (let i = -back; i <= forward; i++) {
      const d = new Date(base.getFullYear(), base.getMonth() + i, 1)
      const mid = new Date(d.getFullYear(), d.getMonth(), 15)
      const eom = new Date(d.getFullYear(), d.getMonth() + 1, 0)
      out.push(makePeriod(freq, d, mid, payroll))
      out.push(makePeriod(freq, new Date(d.getFullYear(), d.getMonth(), 16), eom, payroll))
    }
  }
  return out.sort((a, b) => (a.start < b.start ? -1 : 1))
}

function makePeriod(freq, startDate, endDate, payroll) {
  const start = isoDate(startDate)
  const end = isoDate(endDate)
  const lag = Number.isFinite(payroll?.payLagDays) ? payroll.payLagDays : 5
  return {
    id: periodIdOf(freq.id, start),
    frequency: freq.id,
    start,
    end,
    payDate: isoDate(addDays(parseISO(end), lag)),
    cutoff: isoDate(addDays(parseISO(end), -1)),
    label: `${start} → ${end}`,
  }
}

/** The period containing a date (for the current period banner / defaults). */
/**
 * The period containing `dateISO`, taken from the ONE grid the practice is on.
 *
 * Everything must agree on where a period starts: (a) the pay-period picker, (b)
 * "which period am I in", and (c) any stored period id. If those use different
 * grids the wizard can display one period while processing another — so this
 * always derives from `payroll.anchor` and simply widens the window to reach
 * the requested date.
 */
export function periodFor(payroll, dateISO, opts = {}) {
  if (!dateISO || !/^\d{4}-\d{2}-\d{2}$/.test(dateISO)) return null
  const grid = (anchorISO, { back, forward }) => periodsFor(payroll, anchorISO, { back, forward })
  const anchor = payroll?.anchor && /^\d{4}-\d{2}-\d{2}$/.test(payroll.anchor) ? payroll.anchor : dateISO
  const freq = PAY_FREQUENCIES[payroll?.frequency] || PAY_FREQUENCIES.biweekly
  let list
  if (freq.id === 'semimonthly') {
    const a = parseISO(anchor)
    const d = parseISO(dateISO)
    const months = (d.getFullYear() - a.getFullYear()) * 12 + (d.getMonth() - a.getMonth())
    list = grid(anchor, { back: Math.max(0, months + 1), forward: Math.max(0, 1 - months) })
  } else {
    const i = Math.floor(Math.round((parseISO(dateISO) - parseISO(anchor)) / 86400000) / freq.days)
    list = grid(anchor, { back: Math.max(0, -i), forward: Math.max(0, i) })
  }
  const hit = list.find((p) => dateISO >= p.start && dateISO <= p.end)
  if (hit) return hit
  return grid(dateISO, { back: 0, forward: 0 }).find((p) => dateISO >= p.start && dateISO <= p.end) || null
}

/**
 * Resolve a period from its id.
 *
 * Period ids are self-describing (`pp-<frequency>-<start>`), so a run from last
 * year still resolves without walking a window anchored on today — a pay run
 * that can only be read while it is recent is not an audit record.
 */
export function periodFromId(payroll, periodId, opts) {
  if (!periodId) return null
  const found = periodsFor(payroll, todayISO(), opts).find((p) => p.id === periodId)
  if (found) return found
  const m = /^pp-(weekly|biweekly|semimonthly|monthly)-(\d{4}-\d{2}-\d{2})$/.exec(String(periodId))
  if (!m) return null
  const freq = PAY_FREQUENCIES[m[1]]
  const start = parseISO(m[2])
  if (isNaN(start.getTime())) return null
  const end = m[1] === 'semimonthly'
    ? (start.getDate() >= 16
      ? new Date(start.getFullYear(), start.getMonth() + 1, 0)
      : new Date(start.getFullYear(), start.getMonth(), 15))
    : addDays(start, freq.days - 1)
  return makePeriod(freq, start, end, payroll)
}

/** Workweek slices inside a pay period — the FLSA test window. Periods that
 *  start mid-week still break on the configured workweek boundary, which is why
 *  the first and last slices can be shorter than seven days. */
export function workweeksOf(period, workWeekStart = 1) {
  const out = []
  let cur = parseISO(period.start)
  const end = parseISO(period.end)
  // walk back to the workweek boundary at or before the period start
  while (cur.getDay() !== workWeekStart) cur = addDays(cur, -1)
  while (cur <= end) {
    const wEnd = addDays(cur, 6)
    out.push({ start: isoDate(cur), end: isoDate(wEnd) })
    cur = addDays(cur, 7)
  }
  return out
}

export const weekIndexOf = (iso, weeks) => weeks.findIndex((w) => iso >= w.start && iso <= w.end)

// ---------------------------------------------------------------------------
// Employee pay profiles (the master-data side of payroll)
// ---------------------------------------------------------------------------
export const CLASSIFICATIONS = [
  { id: 'nonexempt', label: 'Non-exempt (FLSA overtime applies)' },
  { id: 'exempt', label: 'Exempt (salaried, duties test reviewed)' },
]
export const PAY_TYPES = [
  { id: 'hourly', label: 'Hourly' },
  { id: 'salary', label: 'Salary' },
  { id: 'session', label: 'Per session' },
]

export const OFFICES = ['Main Center', 'North Clinic', 'School-based', 'Home programs', 'Remote / telehealth']

const annualFromHourly = (rate) => Math.round(rate * 2080)

/**
 * A defensible default profile per role. RBT/BT/student-therapist staff are
 * hourly and non-exempt (the overwhelming norm in ABA); BCBA/BCaBA and licensed
 * clinicians default to salaried, flagged exempt **for review** — never asserted.
 */
export function defaultProfile(staff, idx = 0) {
  const role = String(staff.role || '')
  const salaried = /BCBA|BCaBA|Psychologist|Speech/.test(role)
  const rate = Number(staff.payrollRate) || 25
  return {
    id: `pay-${staff.id}`,
    staffId: staff.id,
    payrollId: '',                       // set by the practice to match its payroll provider
    include: true,
    office: OFFICES[idx % OFFICES.length],
    state: 'CA',
    payType: salaried ? 'salary' : 'hourly',
    baseRate: salaried ? +(annualFromHourly(rate) / 2080).toFixed(2) : rate,
    annualSalary: salaried ? annualFromHourly(rate) : 0,
    sessionRate: +(rate * 1.25).toFixed(2),
    classification: salaried ? 'exempt' : 'nonexempt',
    classificationReviewed: false,       // compliance gate: a human must confirm exempt status
    rates: { SUP: +(rate * 1.1).toFixed(2), EVAL: +(rate * 1.15).toFixed(2), DRIVE: rate, ADMIN: rate, TRAIN: rate },
    tax: { filingStatus: 'single', dependents: 0, extraWithholding: 0, exempt: false },
    deductions: defaultDeductions(staff, idx),
    benefits: { ptoBalanceHours: salaried ? 80 : 40, ptoAccrualHoursPerPeriod: salaried ? 6.15 : 2 },
    workerCompClass: salaried ? '8810: Clerical' : '8834: Home health / therapy',
    note: '',
    createdAt: 0,
  }
}

function defaultDeductions(staff, idx) {
  const out = []
  if (idx % 3 === 0) out.push({ id: 'd-401k', code: '401K', label: '401(k) deferral', kind: 'pretax', calc: 'percent', value: 4, employerMatchPct: 50, employerMatchCapPct: 6 })
  if (idx % 2 === 0) out.push({ id: 'd-med', code: 'MED', label: 'Medical / dental / vision', kind: 'pretax', calc: 'flat', value: 78.5 })
  if (idx % 5 === 0) out.push({ id: 'd-gl', code: 'GL', label: 'Group term life', kind: 'posttax', calc: 'flat', value: 6.25 })
  return out
}

export function seedPayProfiles(staff = []) {
  return staff.map((s, i) => defaultProfile(s, i))
}

export const profileFor = (state, staffId) =>
  (state.payProfiles || []).find((p) => p.staffId === staffId) || null

/** Payroll ID uniqueness is what the payroll provider actually keys on. */
export function duplicatePayrollIds(profiles = []) {
  const seen = new Map()
  for (const p of profiles) {
    const id = String(p.payrollId || '').trim().toLowerCase()
    if (!id || !p.include) continue
    seen.set(id, [...(seen.get(id) || []), p.staffId])
  }
  return [...seen.entries()].filter(([, ids]) => ids.length > 1).map(([payrollId, staffIds]) => ({ payrollId, staffIds }))
}

// ---------------------------------------------------------------------------
// Rates
// ---------------------------------------------------------------------------
export function rateFor(profile, code, payroll) {
  const c = earningIndex(payroll)[code]
  if (!c) return 0
  if (c.kind === 'expense') return 0
  if (code === 'OT') return 0 // premium is derived, never rate-entered
  if (profile?.payType === 'session' && (code === 'REG' || code === 'EVAL')) return 0 // flat per session instead
  return Number(profile?.rates?.[code] ?? profile?.baseRate ?? 0) || 0
}

// ---------------------------------------------------------------------------
// Time capture: schedule → timesheet lines
// ---------------------------------------------------------------------------
const minutesOf = (a) => Math.max(0, (a.end || 0) - (a.start || 0))

/** Neutral-or-not rounding. 'nearest' is FLSA-safe only when it does not
 *  consistently favour the employer, so the gate warns; 'none' is exact. */
export function applyRounding(minutes, rounding) {
  const mode = rounding?.mode || 'none'
  const step = Number(rounding?.mins) || 15
  if (mode === 'none' || step <= 1) return { minutes, delta: 0 }
  const rounded = Math.round(minutes / step) * step
  return { minutes: rounded, delta: rounded - minutes }
}

/**
 * EVV / visit verification state for a completed visit. The workspace already
 * captures a geo-stamped, time-stamped clinician signature on completed
 * sessions — that is the visit evidence; we surface it rather than inventing a
 * second record.
 */
export function evvStatus(a) {
  if (!a) return 'none'
  if (a.status === 'cancelled' || a.status === 'no-show') return 'n/a'
  const v = a.verification
  const sig = v?.signature
  if (sig) {
    const geo = sig.geo ? 'gps' : 'no-gps'
    return v.verifyStatus === 'flagged' ? 'flagged' : `verified (${geo})`
  }
  if (a.status === 'completed') return v ? 'pending' : 'not recorded'
  return 'scheduled'
}

export const isEvvVerified = (a) => /^verified/.test(evvStatus(a))

/**
 * Turn a staff member's calendar into payable lines for one pay period.
 * Cancellation pay follows the practice's decision table: notice at or above
 * the free-notice band pays nothing, short-notice pays the configured share,
 * and a door/no-show cancellation pays the configured higher share.
 */
export function scheduleLines(state, staffId, period) {
  const payroll = state.settings?.payroll || defaultPayrollSettings()
  const codes = earningIndex(payroll)
  // chunk-42: appointment statuses are configured in Settings and can change what a
  // session pays — or stop it paying at all. Read from the live workspace.
  const statusMap = Object.fromEntries((state.settings?.apptStatuses || []).map((s) => [s.key, s]))
  const profile = profileFor(state, staffId)
  const lines = []
  for (const a of Object.values(state.appts || {})) {
    if (a.date < period.start || a.date > period.end) continue
    if (!(a.staffIds || []).includes(staffId)) continue
    const liveMins = minutesOf(a)
    if (!liveMins) continue

    const statusCfg = statusMap[a.status]
    if (statusCfg && statusCfg.pays === false) continue
    const cancelish = statusCfg ? !!statusCfg.cancelBand : (a.status === 'cancelled' || a.status === 'no-show')
    if (cancelish) {
      const code = statusCfg?.payrollCode || 'CANC'
      const notice = Number.isFinite(a.cancelNoticeHours) ? a.cancelNoticeHours : null
      const door = !!a.cancelAtDoor || a.status === 'no-show'
      const policy = payroll.cancelPolicy
      let pct = 0
      let why = ''
      if (door) { pct = policy.payNoShowPct; why = 'no-show / cancelled at the door' }
      else if (notice == null) { pct = policy.payUnknownNoticePct; why = 'notice hours not recorded' }
      else if (notice >= policy.freeNoticeHours) { pct = 0; why = `cancelled with ${notice}h notice (≥ ${policy.freeNoticeHours}h free band)` }
      else { pct = policy.payShortNoticePct; why = `cancelled with ${notice}h notice (< ${policy.freeNoticeHours}h band)` }
      if (pct <= 0) continue
      const mins = Math.round(liveMins * (pct / 100))
      const code0 = codes[code] || { kind: 'cancellation' }
      lines.push({
        id: `l-${a.id}-canc`, apptId: a.id, date: a.date, code, minutes: mins, hours: +(mins / 60).toFixed(4),
        rate: rateFor(profile, 'REG', payroll), kind: code0.kind, source: 'schedule', note: why,
        meta: { scheduledMinutes: liveMins, payPct: pct, evv: 'n/a', clientIds: a.clientIds || [] },
      })
      continue
    }

    const defCodes = payroll.defaultEarningCodes || {}
    let code = APPT_CODE[a.type]
    if (a.type === 'drive' && defCodes.drive && codes[defCodes.drive]) code = defCodes.drive
    else if ((a.type === 'admin' || a.type === 'meeting' || a.type === 'supervision') && defCodes.nonService && codes[defCodes.nonService] && a.type === 'admin') code = defCodes.nonService
    // if appointment has a service with an explicit defaultEarningCode in the active earning codes, honour it
    if ((a.type === 'service' || a.type === 'evaluation') && a.service && Array.isArray(state.svcs)) {
      const svcRec = state.svcs.find((s) => s.id === a.service)
      if (svcRec?.defaultEarningCode && codes[svcRec.defaultEarningCode]) code = svcRec.defaultEarningCode
    }
    // a configured status may name the earning code a session in that state earns
    if (statusCfg?.payrollCode && codes[statusCfg.payrollCode]) code = statusCfg.payrollCode
    let unpaid = false
    if (a.type === 'unavailable') {
      // PTO/Holiday blocks are the only 'unavailable' blocks that pay
      if (/^PTO/i.test(a.title || '')) code = 'PTO'
      else if (/holiday/i.test(a.title || '')) code = 'HOL'
      else if (/training|CEU|conference/i.test(a.title || '')) code = payroll.payTraining ? 'TRAIN' : null
      else unpaid = true
    }
    if (a.type === 'break') { if (!payroll.payBreaks) unpaid = true; else code = (defCodes.breakTime && codes[defCodes.breakTime]) ? defCodes.breakTime : 'ADMIN' }
    if ((code === 'DRIVE' || a.type === 'drive') && !payroll.payDrive) unpaid = true
    if ((code === 'ADMIN' || a.type === 'admin') && !payroll.payAdmin) unpaid = true
    if (code === 'TRAIN' && !payroll.payTraining) unpaid = true
    if (!code || unpaid) continue

    // A leave/bonus code pays at the profile rate; worked codes use their rate.
    const { minutes, delta } = applyRounding(liveMins, payroll.rounding)
    if (minutes <= 0) continue
    const c = codes[code]
    lines.push({
      id: `l-${a.id}`, apptId: a.id, date: a.date, code, minutes, hours: +(minutes / 60).toFixed(4),
      rate: rateFor(profile, code, payroll), kind: c?.kind || 'worked', source: 'schedule',
      note: delta ? `rounded ${delta > 0 ? '+' : ''}${delta} min` : '',
      // ⚡ ABA Hours ride along on the line so a timesheet can show behavior-analytic
      // (non-service) time next to what it pays — the hours are certification currency,
      // not a pay category, so they never change the earning code.
      meta: {
        scheduledMinutes: liveMins, evv: evvStatus(a), type: a.type, clientIds: a.clientIds || [],
        billable: a.type === 'service' || a.type === 'evaluation',
        abaHr: countsAsAbaHours(a), abaActivity: countsAsAbaHours(a) ? a.abaActivity || '' : '',
      },
    })
  }
  return lines.sort((x, y) => (x.date === y.date ? 0 : x.date < y.date ? -1 : 1))
}

/** Manual timesheet entries a supervisor adds (adjustment, admin, bonus, PTO). */
export function adjustmentLines(state, staffId, period) {
  const sheet = sheetFor(state, staffId, period.id)
  const profile = profileFor(state, staffId)
  const payroll = state.settings?.payroll || defaultPayrollSettings()
  const codes = earningIndex(payroll)
  return (sheet.adjustments || [])
    .filter((adj) => adj.date >= period.start && adj.date <= period.end)
    .map((adj) => {
      const c = codes[adj.code]
      const isFlat = adj.code === 'BONUS' || adj.code === 'BONUSX' || adj.code === 'MILE' || adj.code === 'EXP'
      const minutes = isFlat ? 0 : Math.max(0, Math.round((Number(adj.hours) || 0) * 60))
      const hours = isFlat ? 0 : +(minutes / 60).toFixed(4)
      return {
        id: adj.id, date: adj.date, code: adj.code, minutes, hours,
        rate: isFlat ? 0 : rateFor(profile, adj.code, payroll),
        amount: isFlat ? Math.round((Number(adj.hours) || 0) * 100) : null,
        kind: c?.kind || 'worked', source: 'adjustment', note: adj.note || '',
        meta: { evv: 'manual', manual: true, paidBy: adj.by || '' },
      }
    })
}

export const sheetKey = (staffId, periodId) => `${staffId}|${periodId}`

export function sheetFor(state, staffId, periodId) {
  return (state.paySheets || {})[sheetKey(staffId, periodId)] || {
    id: sheetKey(staffId, periodId), staffId, periodId, status: 'open', adjustments: [], audit: [],
  }
}

/** Merged timesheet: system-derived schedule lines + supervisor adjustments. */
export function timesheet(state, staffId, periodId) {
  const period = periodFromId(state.settings?.payroll, periodId) || { id: periodId, start: '0000-01-01', end: '9999-12-31' }
  const lines = [...scheduleLines(state, staffId, period), ...adjustmentLines(state, staffId, period)]
  return { period, staffId, sheet: sheetFor(state, staffId, periodId), lines, totals: lineTotals(lines) }
}

/**
 * Timesheet lines for an arbitrary date window, gathered through the pay periods
 * that overlap it. Going via periods (rather than filtering raw appointments)
 * means supervisor adjustments are included, which is what a provider export has
 * to reflect.
 */
export function linesInRange(state, staffId, start, end) {
  const payroll = state.settings?.payroll || defaultPayrollSettings()
  const freq = PAY_FREQUENCIES[payroll.frequency] || PAY_FREQUENCIES.biweekly
  const spanDays = Math.max(0, Math.round((parseISO(end) - parseISO(start)) / 86400000))
  const forward = Math.min(120, Math.ceil(spanDays / freq.days) + 2)
  const periods = periodsFor(payroll, start, { back: 1, forward }).filter((p) => p.end >= start && p.start <= end)
  const out = []
  for (const period of periods) {
    for (const l of timesheet(state, staffId, period.id).lines) {
      if (l.date >= start && l.date <= end) out.push({ ...l, periodId: period.id })
    }
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
}

export function lineTotals(lines = [], payroll = null) {
  const cents = (l) => (l.amount != null ? l.amount : Math.round(l.hours * l.rate * 100))
  const codes = earningIndex(payroll)
  const byCode = {}
  let minutes = 0
  let straight = 0
  for (const l of lines) {
    const c = codes[l.code]
    if (l.kind === 'worked' || l.kind === 'cancellation' || l.kind === 'leave' || l.kind === 'premium') minutes += l.minutes || 0
    const v = cents(l)
    straight += c?.taxable === false ? 0 : v
    byCode[l.code] = byCode[l.code] || { code: l.code, minutes: 0, hours: 0, cents: 0 }
    byCode[l.code].minutes += l.minutes || 0
    byCode[l.code].hours = +(byCode[l.code].minutes / 60).toFixed(4)
    byCode[l.code].cents += v
  }
  // behavior-analytic (⚡ ABA) hours inside these lines — tracked, never paid differently
  const abaMinutes = lines.reduce((t, l) => t + (l.meta?.abaHr ? l.minutes || 0 : 0), 0)
  return {
    lines: lines.length,
    minutes,
    hours: +(minutes / 60).toFixed(4),
    abaHours: +(abaMinutes / 60).toFixed(4),
    straightCents: straight,
    byCode: Object.values(byCode).sort((a, b) => b.cents - a.cents),
  }
}

// ---------------------------------------------------------------------------
// Period earnings: workweek overtime, regular rate, gross
// ---------------------------------------------------------------------------
/**
 * Builds the priced earning rows for one employee for one period.
 *
 * Overtime is derived, never entered: worked hours are bucketed by FLSA
 * workweek, the hours past the threshold become an OT premium at half the
 * *regular rate* — where the regular rate includes straight-time pay plus any
 * nondiscretionary additions earned in that week, divided by hours worked.
 */
export function earningsFor(state, staffId, periodId) {
  const payroll = state.settings?.payroll || defaultPayrollSettings()
  const codes = earningIndex(payroll)
  const profile = profileFor(state, staffId)
  const period = periodFromId(payroll, periodId) || { id: periodId }
  const { lines } = timesheet(state, staffId, periodId)
  const cents = (l) => (l.amount != null ? l.amount : Math.round((l.hours || 0) * (l.rate || 0) * 100))

  const rows = []
  const weeks = workweeksOf(period, payroll.workWeekStart)

  // 1) salary baseline for salaried staff (paid per period, not per hour)
  if (profile?.payType === 'salary') {
    const perPeriod = Math.round(((profile.annualSalary || 0) / (PAY_FREQUENCIES[payroll.frequency] || PAY_FREQUENCIES.biweekly).periods) * 100)
    if (perPeriod > 0) rows.push({ code: 'REG', label: 'Salary, period base', hours: 0, minutes: 0, rate: 0, cents: perPeriod, salaryBaseline: true, source: 'salary' })
  }

  // 2) session-rate staff are paid per delivered session, not per hour
  if (profile?.payType === 'session') {
    const sessions = lines.filter((l) => (l.meta?.type === 'service' || l.meta?.type === 'evaluation') && l.code !== 'CANC')
    if (sessions.length) rows.push({ code: 'REG', label: `Per session × ${sessions.length}`, hours: 0, minutes: 0, rate: profile.sessionRate || 0, cents: Math.round(sessions.length * (profile.sessionRate || 0) * 100), perSession: true, sessions: sessions.length, source: 'session' })
  } else if (profile?.payType === 'hourly') {
    // 3) straight-time worked rows, grouped by code, valued per line
    const groups = new Map()
    for (const l of lines) {
      const c = codes[l.code]
      if (!c || c.kind === 'expense') continue
      const g = groups.get(l.code) || { code: l.code, label: c.label, minutes: 0, rates: [], cents: 0 }
      // accumulate whole minutes, derive hours once — summing pre-rounded hours
      // is how registers drift by a hundredth of an hour per period
      g.minutes += l.minutes || 0
      if (l.rate) g.rates.push(l.rate)
      g.cents += cents(l)
      groups.set(l.code, g)
    }
    for (const g of groups.values()) {
      const rates = [...new Set(g.rates)]
      rows.push({
        code: g.code, label: g.label, minutes: g.minutes, hours: +(g.minutes / 60).toFixed(4),
        rate: rates.length === 1 ? rates[0] : null, blendedRate: rates.length > 1 && g.minutes ? +(g.cents / 100 / (g.minutes / 60)).toFixed(2) : null,
        cents: g.cents, source: 'hours',
      })
    }
  }

  // 3b) non-taxable reimbursements are paid with payroll but never taxed, and they
  //     apply to every pay type — a salaried clinician still gets mileage back
  for (const l of lines) {
    const c = codes[l.code]
    if (!c || c.kind !== 'expense') continue
    rows.push({
      code: l.code, label: c.label, hours: 0, minutes: 0, rate: 0,
      cents: l.amount != null ? l.amount : Math.round((l.hours || 0) * (l.rate || 0) * 100),
      source: 'reimbursement', note: l.note || '',
    })
  }

  // 4) overtime premium — exempt staff are excluded, and only worked/premium-eligible
  //    hours count toward the workweek threshold
  const otRows = []
  const staffRec = (state.staff || []).find((s) => s.id === staffId)
  const officeOtRule = staffRec?.officeId && payroll.officeOvertimeRules?.[staffRec.officeId]
  const effectiveWeeklyOt = Number(officeOtRule?.weeklyOtHours || payroll.otAfterHours) || 40
  if (profile?.classification === 'nonexempt' && profile?.payType !== 'salary' ? true : profile?.classification === 'nonexempt') {
    for (const w of weeks) {
      const inWeek = lines.filter((l) => l.date >= w.start && l.date <= w.end)
      const worked = inWeek.filter((l) => codes[l.code]?.otEligible && codes[l.code]?.kind !== 'leave')
      const workedHours = worked.reduce((t, l) => t + (l.hours || 0), 0)
      if (workedHours <= effectiveWeeklyOt) continue
      const straight = worked.reduce((t, l) => t + cents(l), 0)
      // nondiscretionary additions earned this week spread into the regular rate
      const nondisc = inWeek.filter((l) => codes[l.code]?.nondisc).reduce((t, l) => t + cents(l), 0)
      const regularRateCents = Math.round((straight + nondisc) / workedHours) // per hour, in cents
      const otHours = +(workedHours - effectiveWeeklyOt).toFixed(4)
      const premium = Math.round(otHours * regularRateCents * (payroll.otMultiplier - 1))
      otRows.push({
        code: 'OT', label: `Overtime premium, week of ${w.start}`, hours: otHours, minutes: Math.round(otHours * 60),
        rate: +(regularRateCents / 100).toFixed(2), cents: premium, source: 'derived', week: w.start,
        regularRate: +(regularRateCents / 100).toFixed(2), basis: `straight ${(straight / 100).toFixed(2)} + nondisc ${(nondisc / 100).toFixed(2)} ÷ ${workedHours.toFixed(2)}h`,
      })
    }
  }
  rows.push(...otRows)

  const grossCents = rows.filter((r) => codes[r.code]?.taxable !== false).reduce((t, r) => t + r.cents, 0)
  const reimbursementCents = rows.filter((r) => codes[r.code]?.taxable === false).reduce((t, r) => t + r.cents, 0)
  const taxableCents = grossCents
  const workedHours = rows.filter((r) => r.code !== 'OT' && (codes[r.code]?.kind === 'worked' || codes[r.code]?.kind === 'cancellation')).reduce((t, r) => t + (r.hours || 0), 0)
  const otHours = otRows.reduce((t, r) => t + r.hours, 0)
  // delivered clinical hours drive the cost-per-hour KPI practices track
  const deliveredMinutes = lines.filter((l) => l.meta?.type === 'service' || l.meta?.type === 'evaluation').reduce((t, l) => t + (l.minutes || 0), 0)
  return {
    staffId, periodId, profile, rows, lines,
    grossCents, taxableCents, reimbursementCents, netPayableCents: grossCents + reimbursementCents,
    workedHours: +workedHours.toFixed(4), otHours: +otHours.toFixed(4),
    deliveredHours: +(deliveredMinutes / 60).toFixed(4),
    weeks,
  }
}

// ---------------------------------------------------------------------------
// Gross to net (estimates — the UI states this plainly)
// ---------------------------------------------------------------------------
export const defaultPayrollSettings = () => ({
  frequency: 'biweekly',
  anchor: '2026-01-05',
  processor: 'ADP',
  mileageRate: 0.67,
  payLagDays: 5,
  workWeekStart: 1,             // Monday — FLSA workweek, not the calendar's week start
  otAfterHours: 40,
  otMultiplier: 1.5,
  rounding: { mode: 'none', mins: 15 },
  payDrive: true,
  payBreaks: false,
  payAdmin: true,
  payTraining: true,
  evvRequired: true,
  defaultEarningCodes: { nonService: 'ADMIN', drive: 'DRIVE', breakTime: 'ADMIN' },
  officeOvertimeRules: {},
  cancelPolicy: { freeNoticeHours: 24, payShortNoticePct: 50, payNoShowPct: 100, payUnknownNoticePct: 0 },
  approvals: { requireTimesheet: true, requireApproval: true, separateApprover: true, lockAfterProcess: true },
  defaultState: 'CA',
  taxes: {
    mode: 'estimate',
    federal: { annualize: true, brackets: [
      { upTo: 11600, rate: 0.10 }, { upTo: 47150, rate: 0.12 }, { upTo: 100525, rate: 0.22 },
      { upTo: 191950, rate: 0.24 }, { upTo: 243725, rate: 0.32 }, { upTo: 609350, rate: 0.35 }, { upTo: null, rate: 0.37 },
    ], standardDeduction: 14600 },
    fica: { ssRate: 0.062, ssWageBase: 184500, medicareRate: 0.0145, addlMedicareRate: 0.009, addlThreshold: 200000 },
    state: { defaultRate: 0.06, byState: { CA: 0.06, OR: 0.08, WA: 0.07, TX: 0, FL: 0, NY: 0.055 } },
    futa: { rate: 0.006, wageBase: 7000 },
    suta: { rate: 0.027, wageBase: 7000 },
    workersComp: { defaultRate: 0.012 },
  },
  glAccounts: { wages: '6100 Payroll (clinical wages)', taxes: '6150 Payroll taxes', benefits: '6160 Benefits', net: '2100 Payroll clearing' },
})

const applyBrackets = (annual, brackets) => {
  let tax = 0
  let last = 0
  for (const b of brackets) {
    const cap = b.upTo == null ? Infinity : b.upTo
    if (annual > last) tax += (Math.min(annual, cap) - last) * b.rate
    last = cap
    if (annual <= cap) break
  }
  return tax
}

/**
 * Progressive federal estimate on annualised wages, in CENTS — the bracket table
 * itself stays in dollars so it is readable, and is converted once here.
 * This is an editable demo table, not tax advice and not a filing engine.
 */
export function federalEstimate(annualTaxableCents, profile, taxes) {
  if (profile?.tax?.exempt) return 0
  const stdCents = taxes.federal.standardDeduction * 100 * (profile?.tax?.filingStatus === 'married' ? 2 : 1)
  const annualDollars = Math.max(0, annualTaxableCents - stdCents) / 100
  const grossCents = Math.round(applyBrackets(annualDollars, taxes.federal.brackets) * 100)
  const dependentsCents = Math.max(0, Number(profile?.tax?.dependents) || 0) * 200000 // credit placeholder
  return Math.max(0, grossCents - dependentsCents)
}

/**
 * Full gross-to-net for one employee in one period.
 * `perYear` lets statutory caps (Social Security, FUTA/SUTA) see prior wages.
 */
export function grossToNet(state, staffId, periodId) {
  const payroll = state.settings?.payroll || defaultPayrollSettings()
  const taxes = payroll.taxes
  const e = earningsFor(state, staffId, periodId)
  const profile = e.profile || defaultProfile({ id: staffId, payrollRate: 0 })
  const prior = ytdCents(state, staffId, e.period)
  const periodsPerYear = (PAY_FREQUENCIES[payroll.frequency] || PAY_FREQUENCIES.biweekly).periods
  const gross = e.taxableCents

  // ---- pre-tax deductions reduce taxable wages
  const preTax = []
  let preTaxCents = 0
  for (const d of profile.deductions || []) {
    if (d.kind !== 'pretax') continue
    const amt = d.calc === 'percent' ? Math.round(gross * ((Number(d.value) || 0) / 100)) : Math.round((Number(d.value) || 0) * 100)
    if (amt <= 0) continue
    preTax.push({ ...d, cents: amt })
    preTaxCents += amt
  }
  const taxableNow = Math.max(0, gross - preTaxCents)

  // ---- statutory withholding
  const fica = taxes.fica
  const ytdTaxable = prior.taxableCents
  const ssRemaining = Math.max(0, fica.ssWageBase - prior.ssWages)
  const ssWagesNow = Math.min(taxableNow, ssRemaining)
  const ss = Math.round(ssWagesNow * fica.ssRate)
  const medicareBase = Math.round(taxableNow * fica.medicareRate)
  const ytdMedicareWages = prior.medicareWages + taxableNow
  const addlMedicare = ytdMedicareWages > fica.addlThreshold
    ? Math.round(Math.max(0, ytdMedicareWages - Math.max(fica.addlThreshold, prior.medicareWages)) * fica.addlMedicareRate)
    : 0
  const medicare = medicareBase + addlMedicare
  const annualTaxable = taxableNow * periodsPerYear + prior.taxableCents
  // Annualising *this period's* taxable wage plus what was already paid this year
  // keeps the estimate self-correcting as periods accumulate — no separate catch-up.
  const federalAnnual = federalEstimate(annualTaxable, profile, taxes)
  const federal = profile?.tax?.exempt ? 0 : Math.round(federalAnnual / periodsPerYear)
  const stateRate = taxes.state.byState?.[profile.state] ?? taxes.state.defaultRate
  const stateTax = profile?.tax?.exempt ? 0 : Math.round(taxableNow * stateRate)
  const extra = Math.round((Number(profile?.tax?.extraWithholding) || 0) * 100)
  const taxRows = [
    { id: 't-ss', code: 'FICA-SS', label: 'Social Security (6.2%)', cents: ss, kind: 'statutory' },
    { id: 't-med', code: 'FICA-MED', label: 'Medicare (1.45%)', cents: medicare, kind: 'statutory' },
    { id: 't-fed', code: 'FED', label: 'Federal income tax (estimated)', cents: federal + extra, kind: 'statutory' },
    { id: 't-st', code: `ST-${profile.state || ''}`, label: `State income tax (${Math.round(stateRate * 1000) / 10}%)`, cents: stateTax, kind: 'statutory' },
  ]
  const taxCents = taxRows.reduce((t, r) => t + r.cents, 0)

  // ---- post-tax deductions
  const postTax = []
  let postTaxCents = 0
  for (const d of profile.deductions || []) {
    if (d.kind !== 'posttax') continue
    const amt = d.calc === 'percent' ? Math.round(gross * ((Number(d.value) || 0) / 100)) : Math.round((Number(d.value) || 0) * 100)
    if (amt <= 0) continue
    postTax.push({ ...d, cents: amt })
    postTaxCents += amt
  }

  const netCents = gross - preTaxCents - taxCents - postTaxCents + e.reimbursementCents

  // ---- employer cost (what the practice actually budgets)
  const employer = [
    { id: 'e-ss', code: 'FICA-SS-ER', label: 'Employer Social Security match', cents: ss },
    { id: 'e-med', code: 'FICA-MED-ER', label: 'Employer Medicare match', cents: medicareBase },
    { id: 'e-futa', code: 'FUTA', label: 'FUTA (0.6% to $7,000)', cents: Math.round(Math.min(taxableNow, Math.max(0, taxes.futa.wageBase - prior.futaWages)) * taxes.futa.rate) },
    { id: 'e-suta', code: 'SUTA', label: `SUTA (${profile.state || 'CA'})`, cents: Math.round(Math.min(taxableNow, Math.max(0, taxes.suta.wageBase - prior.sutaWages)) * taxes.suta.rate) },
    { id: 'e-wc', code: 'WC', label: `Workers' comp (${profile.workerCompClass})`, cents: Math.round(taxableNow * taxes.workersComp.defaultRate) },
  ]
  const matchCents = (profile.deductions || []).filter((d) => d.kind === 'pretax' && d.employerMatchPct).reduce((t, d) => {
    const deferral = preTax.find((p) => p.id === d.id)?.cents || 0
    const cap = gross * ((d.employerMatchCapPct || 0) / 100)
    return t + Math.round(Math.min(deferral, cap) * (d.employerMatchPct / 100))
  }, 0)
  if (matchCents) employer.push({ id: 'e-match', code: 'MATCH', label: 'Employer retirement match', cents: matchCents })
  const employerCents = employer.reduce((t, r) => t + r.cents, 0)
  const totalCostCents = gross + employerCents

  return {
    staffId, periodId, period: e.period, profile, rows: e.rows, lines: e.lines,
    grossCents: gross, preTax, preTaxCents, taxRows, taxCents, postTax, postTaxCents,
    ssCents: ss, medicareCents: medicare, fedCents: federal + extra, stateTaxCents: stateTax,
    ssWagesCents: ssWagesNow, federalTaxableCents: taxableNow,
    netCents, reimbursementCents: e.reimbursementCents, employer, employerCents, totalCostCents,
    workedHours: e.workedHours, otHours: e.otHours, deliveredHours: e.deliveredHours,
    costPerDeliveredHourCents: e.deliveredHours > 0 ? Math.round(totalCostCents / e.deliveredHours) : null,
    ytd: prior,
  }
}

/** Year-to-date memory for statutory caps: processed runs first, then live. */
export function ytdCents(state, staffId, period) {
  const payroll = state.settings?.payroll || defaultPayrollSettings()
  const year = (period?.start || todayISO()).slice(0, 4)
  const out = { grossCents: 0, taxableCents: 0, ssWages: 0, medicareWages: 0, futaWages: 0, sutaWages: 0, federalTax: 0, netCents: 0, periods: 0 }
  for (const run of Object.values(state.payRuns || {})) {
    if (!run?.locked) continue
    if ((run.periodStart || '').slice(0, 4) !== year) continue
    if (period && run.periodStart >= period.start) continue
    const line = (run.lines || []).find((l) => l.staffId === staffId)
    if (!line) continue
    out.grossCents += line.grossCents || 0
    out.taxableCents += line.grossCents || 0
    out.ssWages += line.ssWages || line.grossCents || 0
    out.medicareWages += line.grossCents || 0
    out.futaWages += line.grossCents || 0
    out.sutaWages += line.grossCents || 0
    out.federalTax += line.taxCents || 0
    out.netCents += line.netCents || 0
    out.periods += 1
  }
  void payroll
  return out
}

// ---------------------------------------------------------------------------
// Pay run planning & validation gates
// ---------------------------------------------------------------------------
export const RUN_STATUSES = ['draft', 'pending_approval', 'approved', 'processed', 'voided']
export const RUN_STATUS_LABEL = {
  draft: 'Draft', pending_approval: 'Pending approval', approved: 'Approved',
  processed: 'Processed (locked)', voided: 'Voided',
}

export function eligibleProfiles(state) {
  return (state.payProfiles || []).filter((p) => p.include)
}

/**
 * Everything that must be true before money moves. Blockers stop processing;
 * warnings are surfaced to the approver and recorded on the run.
 */
export function runGate(state, period, opts = {}) {
  const payroll = state.settings?.payroll || defaultPayrollSettings()
  const profiles = eligibleProfiles(state)
  const blockers = []
  const warnings = []
  const included = opts.included || profiles.map((p) => p.staffId)

  if (!period) { blockers.push({ code: 'no-period', why: 'No pay period selected' }); return { ok: false, blockers, warnings } }

  const dupes = duplicatePayrollIds(state.payProfiles || [])
  for (const d of dupes) blockers.push({ code: 'dup-payroll-id', why: `Payroll ID "${d.payrollId}" is used by ${d.staffIds.length} staff records. The provider cannot tell them apart`, staffIds: d.staffIds })

  // A run being approved or processed is not a duplicate of itself.
  const samePeriod = Object.values(state.payRuns || {})
    .filter((r) => r.periodId === period.id && r.status !== 'voided' && r.id !== opts.runId)
  if (samePeriod.length) blockers.push({ code: 'duplicate-run', why: `Pay period ${period.start} → ${period.end} already has run ${samePeriod.map((r) => r.no).join(', ')}` })

  for (const staffId of included) {
    const profile = profileFor(state, staffId)
    const staff = (state.staff || []).find((s) => s.id === staffId)
    if (!profile) { blockers.push({ code: 'no-profile', why: `${staff?.name || staffId} has no payroll profile`, staffId }); continue }
    if (!String(profile.payrollId || '').trim()) warnings.push({ code: 'no-payroll-id', why: `${staff?.name || staffId} has no payroll ID. The provider export needs one`, staffId })
    if (profile.payType === 'hourly' && !(Number(profile.baseRate) > 0)) blockers.push({ code: 'no-rate', why: `${staff?.name || staffId} has no hourly rate`, staffId })
    if (profile.payType === 'salary' && !(Number(profile.annualSalary) > 0)) blockers.push({ code: 'no-salary', why: `${staff?.name || staffId} has no annual salary`, staffId })
    if (profile.classification === 'exempt' && !profile.classificationReviewed) warnings.push({ code: 'exempt-unreviewed', why: `${staff?.name || staffId} is flagged exempt. Confirm the salary-basis and duties tests before paying without overtime`, staffId })
    if (profile.state === undefined || profile.state === '') warnings.push({ code: 'no-state', why: `${staff?.name || staffId} has no work state, so state tax cannot be estimated`, staffId })

    const sheet = sheetFor(state, staffId, period.id)
    if (payroll.approvals.requireTimesheet && !['approved'].includes(sheet.status)) {
      warnings.push({ code: 'sheet-not-approved', why: `${staff?.name || staffId}: timesheet is ${sheet.status.replace('_', ' ')}. Approve it or exclude the employee`, staffId, sheetStatus: sheet.status })
    }

    const e = earningsFor(state, staffId, period.id)
    if (e.grossCents <= 0) warnings.push({ code: 'zero-pay', why: `${staff?.name || staffId} has no payable time in this period`, staffId })
    if (payroll.evvRequired && profile.classification === 'nonexempt') {
      // Only visits that have already occurred can owe visit verification;
      // flagging future appointments would train approvers to ignore the gate.
      const today = todayISO()
      const unverified = e.lines.filter((l) => l.meta?.billable && l.date <= today && !/^verified/.test(l.meta?.evv || ''))
      if (unverified.length) warnings.push({ code: 'evv-missing', why: `${unverified.length} visit${unverified.length > 1 ? 's' : ''} for ${staff?.name || staffId} have no visit verification (EVV). Confirm they were delivered before paying`, staffId, count: unverified.length, apptIds: unverified.map((l) => l.apptId) })
    }
    const net = grossToNet(state, staffId, period.id)
    if (net.netCents < 0) blockers.push({ code: 'negative-net', why: `${staff?.name || staffId} would take home ${(net.netCents / 100).toFixed(2)}. Deductions exceed pay`, staffId })
    if (profile.payType === 'hourly' && e.workedHours > 0 && net.netCents >= 0) {
      const eff = net.grossCents / e.workedHours
      if (eff < 16) warnings.push({ code: 'below-min-wage', why: `${staff?.name || staffId} averages ${(eff / 100).toFixed(2)}/hour for hours worked, below the federal minimum wage`, staffId })
    }
  }

  if (!included.length) blockers.push({ code: 'no-employees', why: 'No employees are selected for this run' })
  if (payroll.otMultiplier < 1.5) blockers.push({ code: 'ot-rate', why: `Overtime multiplier ${payroll.otMultiplier}× is below the 1.5× federal minimum` })
  if (payroll.rounding.mode !== 'none') warnings.push({ code: 'rounding', why: `Time rounding is on (${payroll.rounding.mode}, ${payroll.rounding.mins} min). Rounding must not favor the employer over time. Spot-check the register each period.` })

  return { ok: blockers.length === 0, blockers, warnings, included }
}

/** A run preview: the register as it would be paid right now. */
export function computeRun(state, period, opts = {}) {
  const profiles = eligibleProfiles(state)
  const included = (opts.included || profiles.map((p) => p.staffId))
  const lines = included.map((staffId) => {
    const net = grossToNet(state, staffId, period.id)
    const staff = (state.staff || []).find((s) => s.id === staffId)
    return {
      staffId, name: staff?.name || staffId, initials: staff?.initials, color: staff?.color, role: staff?.role,
      payrollId: net.profile.payrollId, office: net.profile.office, payType: net.profile.payType,
      classification: net.profile.classification, periodId: period.id,
      earnings: net.rows, grossCents: net.grossCents, netCents: net.netCents,
      preTaxCents: net.preTaxCents, taxCents: net.taxCents, postTaxCents: net.postTaxCents,
      employerCents: net.employerCents, totalCostCents: net.totalCostCents,
      preTax: net.preTax, postTax: net.postTax, taxRows: net.taxRows, employer: net.employer,
      reimbursementCents: net.reimbursementCents, ytd: net.ytd,
      workedHours: net.workedHours, otHours: net.otHours, deliveredHours: net.deliveredHours,
      costPerDeliveredHourCents: net.costPerDeliveredHourCents,
      ssWages: net.grossCents, deliveryMethod: 'direct_deposit',
    }
  })
  return { lines, totals: runTotals(lines), gate: runGate(state, period, { included }) }
}

export function runTotals(lines = []) {
  const sum = (k) => lines.reduce((t, l) => t + (l[k] || 0), 0)
  return {
    staff: lines.length,
    grossCents: sum('grossCents'), netCents: sum('netCents'), taxCents: sum('taxCents'),
    preTaxCents: sum('preTaxCents'), postTaxCents: sum('postTaxCents'), employerCents: sum('employerCents'),
    totalCostCents: sum('totalCostCents'), reimbursementCents: sum('reimbursementCents'),
    workedHours: +sum('workedHours').toFixed(2), otHours: +sum('otHours').toFixed(2), deliveredHours: +sum('deliveredHours').toFixed(2),
  }
}

/** Aggregate a run (or preview) by office and by earning code for summaries. */
export function runBreakdown(run, state) {
  const codes = earningIndex(state?.settings?.payroll)
  const byOffice = {}
  const byCode = {}
  for (const l of run.lines || []) {
    const off = l.office || 'Unassigned'
    byOffice[off] = byOffice[off] || { office: off, staff: 0, grossCents: 0, hours: 0, deliveredHours: 0, employerCents: 0 }
    byOffice[off].staff += 1
    byOffice[off].grossCents += l.grossCents
    byOffice[off].hours += l.workedHours + l.otHours
    byOffice[off].deliveredHours += l.deliveredHours || 0
    byOffice[off].employerCents += l.employerCents || 0
    for (const r of l.earnings || []) {
      byCode[r.code] = byCode[r.code] || { code: r.code, label: codes[r.code]?.label || r.label, minutes: 0, cents: 0, staff: new Set() }
      byCode[r.code].minutes += r.minutes || 0
      byCode[r.code].cents += r.cents
      byCode[r.code].staff.add(l.staffId)
    }
  }
  void state
  return {
    byOffice: Object.values(byOffice).sort((a, b) => b.grossCents - a.grossCents),
    byCode: Object.values(byCode).map((c) => ({ ...c, staff: c.staff.size })).sort((a, b) => b.cents - a.cents),
  }
}

// ---------------------------------------------------------------------------
// Transactions (returned to the reducer as one undoable write)
// ---------------------------------------------------------------------------
const nowAudit = (opts, action, detail) => ({
  at: opts.at || Date.now(), who: opts.who || 'Payroll admin', action, detail: detail || '', src: opts.src || 'payroll',
})

/** Timesheet lifecycle: submit → approve / reject, or revert to open. */
export function planSheet(state, staffId, periodId, action, opts = {}) {
  const key = sheetKey(staffId, periodId)
  const cur = (state.paySheets || {})[key] || { id: key, staffId, periodId, status: 'open', adjustments: [], audit: [] }
  const at = opts.at || Date.now()
  const who = opts.who || 'Payroll admin'
  const payroll = state.settings?.payroll || defaultPayrollSettings()
  let next = { ...cur, audit: [...(cur.audit || []), { at, who, action: `sheet ${action}` }] }
  if (action === 'submit') {
    if (!['open', 'rejected'].includes(cur.status)) {
      return { ok: false, msg: `A ${cur.status} timesheet cannot be resubmitted. Reopen it first` }
    }
    const t = timesheet(state, staffId, periodId)
    if (!t.lines.length) return { ok: false, msg: 'Nothing to submit. There is no payable time in this period' }
    next = { ...next, status: 'submitted', submittedAt: at, submittedBy: who }
  } else if (action === 'approve') {
    if (cur.status !== 'submitted') return { ok: false, msg: 'Only a submitted timesheet can be approved' }
    // segregation of duties: the person who submitted should not approve
    const payroll = state.settings?.payroll || defaultPayrollSettings()
    if (payroll.approvals.separateApprover && cur.submittedBy && cur.submittedBy === who) {
      return { ok: false, msg: `Segregation of duties: ${who} submitted this timesheet. A different person must approve it` }
    }
    next = { ...next, status: 'approved', approvedAt: at, approvedBy: who }
  } else if (action === 'reject') {
    if (cur.status !== 'submitted') return { ok: false, msg: 'Only a submitted timesheet can be returned' }
    next = { ...next, status: 'rejected', rejectedAt: at, rejectedBy: who, note: opts.note || '' }
  } else if (action === 'revert') {
    if (['approved'].includes(cur.status) && !opts.force) return { ok: false, msg: 'An approved timesheet must be reopened deliberately (this is the control that keeps payroll honest)' }
    next = { ...next, status: 'open', revertedAt: at, revertedBy: who }
  } else if (action === 'adjust') {
    const adj = opts.adjustment
    if (!adj || !adj.code || !earningIndex(payroll)[adj.code]) return { ok: false, msg: 'Pick a valid earning code for the adjustment' }
    if (adj.date < (opts.period?.start || '') || adj.date > (opts.period?.end || '')) return { ok: false, msg: 'Adjustment date falls outside this pay period' }
    const isFlat = ['BONUS', 'BONUSX', 'MILE', 'EXP'].includes(adj.code)
    const hours = Number(adj.hours)
    if (!(hours > 0)) return { ok: false, msg: isFlat ? 'Enter a positive amount' : 'Enter positive hours' }
    if (!isFlat && hours > 24) return { ok: false, msg: 'An adjustment above 24 hours looks wrong. Split it or fix the entry' }
    const entry = { id: `adj-${at}-${(cur.adjustments || []).length}`, code: adj.code, date: adj.date, hours, note: adj.note || '', by: who, at }
    next = { ...next, adjustments: [...(cur.adjustments || []), entry], audit: [...next.audit, { at, who, action: 'sheet adjustment', detail: `${adj.code} ${hours}${isFlat ? ' ($)' : 'h'} ${adj.date}` }] }
  } else if (action === 'removeAdjustment') {
    if (['approved', 'processed'].includes(cur.status)) return { ok: false, msg: 'Reopen the timesheet before changing an approved adjustment' }
    next = { ...next, adjustments: (cur.adjustments || []).filter((a) => a.id !== opts.adjustmentId), audit: [...next.audit, { at, who, action: 'adjustment removed' }] }
  } else return { ok: false, msg: `Unknown timesheet action ${action}` }
  return { ok: true, msg: `Timesheet ${action === 'adjust' ? 'adjustment recorded' : action + 'ed'}: ${key}`, sheets: { [key]: next } }
}

/**
 * Pay-run lifecycle. Creating a run freezes nothing; approving signs the
 * register; processing locks it and is the only path that writes YTD history.
 */
export function planRun(state, period, action, opts = {}) {
  const payroll = state.settings?.payroll || defaultPayrollSettings()
  const at = opts.at || Date.now()
  const who = opts.who || 'Payroll admin'
  const runs = state.payRuns || {}

  if (action === 'create' || action === 'preview') {
    const preview = computeRun(state, period, opts)
    return { ok: preview.gate.ok, msg: preview.gate.ok ? 'Preview ready' : `Held by ${preview.gate.blockers.length} blocker(s)`, preview }
  }

  const run = runs[opts.runId]
  if (!run) return { ok: false, msg: 'Pay run not found' }
  if (run.status === 'voided') return { ok: false, msg: 'This run is voided. Create a new one' }

  if (action === 'submit') {
    if (run.status !== 'draft') return { ok: false, msg: 'Only a draft run can be sent for approval' }
    return { ok: true, msg: `${run.no} sent for approval`, runs: { [run.id]: { ...run, status: 'pending_approval', submittedAt: at, submittedBy: who, audit: [...(run.audit || []), nowAudit(opts, 'sent for approval')] } } }
  }

  if (action === 'approve') {
    if (!['draft', 'pending_approval'].includes(run.status)) return { ok: false, msg: `A ${RUN_STATUS_LABEL[run.status]} run cannot be approved` }
    if (payroll.approvals.requireApproval && run.preparedBy && run.preparedBy === who && payroll.approvals.separateApprover) {
      return { ok: false, msg: `Segregation of duties: ${who} prepared this run. A second person must approve it` }
    }
    const gate = runGate(state, period, { included: run.included, runId: run.id })
    if (!gate.ok) return { ok: false, msg: `Cannot approve. ${gate.blockers.length} blocker(s): ${gate.blockers[0].why}`, gate }
    return { ok: true, msg: `${run.no} approved and ready to process`, runs: { [run.id]: { ...run, status: 'approved', approvedAt: at, approvedBy: who, gate, audit: [...(run.audit || []), nowAudit(opts, 'approved')] } } }
  }

  if (action === 'process') {
    if (run.status !== 'approved') return { ok: false, msg: 'Only an approved run can be processed' }
    const gate = runGate(state, period, { included: run.included, runId: run.id })
    if (!gate.ok) return { ok: false, msg: `Processing blocked: ${gate.blockers[0].why}`, gate }
    const fresh = computeRun(state, period, { included: run.included })
    // Re-price at processing time: the register that gets locked is the one paid.
    const processed = {
      ...run, status: 'processed', processedAt: at, processedBy: who, locked: true,
      lines: fresh.lines, totals: fresh.totals, gate,
      audit: [...(run.audit || []), nowAudit(opts, 'processed', `gross ${(fresh.totals.grossCents / 100).toFixed(2)} net ${(fresh.totals.netCents / 100).toFixed(2)}`)],
    }
    const sheets = {}
    for (const staffId of run.included) {
      const key = sheetKey(staffId, period.id)
      const cur = (state.paySheets || {})[key] || { id: key, staffId, periodId: period.id, status: 'open', adjustments: [], audit: [] }
      sheets[key] = { ...cur, status: 'processed', processedAt: at, runId: run.id, audit: [...(cur.audit || []), { at, who, action: 'processed in pay run', detail: run.no }] }
    }
    return { ok: true, msg: `${run.no} processed: ${fresh.totals.staff} staff, net ${(fresh.totals.netCents / 100).toLocaleString()}. Register locked`, runs: { [run.id]: processed }, sheets }
  }

  if (action === 'void') {
    if (run.locked && !opts.force) return { ok: false, msg: 'A processed run is locked. Voiding a processed run needs an explicit reversal decision.' }
    return {
      ok: true, msg: `${run.no} voided. No money moved`,
      runs: { [run.id]: { ...run, status: 'voided', voidedAt: at, voidedBy: who, note: opts.note || '', audit: [...(run.audit || []), nowAudit(opts, 'voided', opts.note)] } },
    }
  }

  if (action === 'exclude' || action === 'include') {
    if (run.status !== 'draft') return { ok: false, msg: 'Only a draft run can change its employee list. Reopen it first' }
    const set = new Set(run.included)
    if (action === 'exclude') set.delete(opts.staffId); else set.add(opts.staffId)
    const included = [...set]
    if (!included.length) return { ok: false, msg: 'A pay run needs at least one employee' }
    const fresh = computeRun(state, period, { included })
    const eligible = eligibleProfiles(state).map((p) => p.staffId)
    const excluded = eligible.filter((id) => !included.includes(id))
    return {
      ok: true, msg: `${action === 'exclude' ? 'Removed from' : 'Added to'} ${run.no}`,
      runs: { [run.id]: { ...run, included, excluded, lines: fresh.lines, totals: fresh.totals, gate: fresh.gate,
        audit: [...(run.audit || []), nowAudit(opts, action === 'exclude' ? 'employee excluded' : 'employee included', opts.staffId)] } },
    }
  }

  if (action === 'reopen') {
    if (run.status === 'processed') return { ok: false, msg: 'A processed register cannot be changed. Post an off-cycle adjustment instead' }
    return { ok: true, msg: `${run.no} reopened for edits`, runs: { [run.id]: { ...run, status: 'draft', audit: [...(run.audit || []), nowAudit(opts, 'reopened')] } } }
  }
  return { ok: false, msg: `Unknown pay run action ${action}` }
}

export function nextRunNo(state) {
  const n = Object.keys(state.payRuns || {}).length + 1
  return `PR-${String(n).padStart(4, '0')}`
}

export function newRun(state, period, opts = {}) {
  const at = opts.at || Date.now()
  const who = opts.who || 'Payroll admin'
  const eligible = eligibleProfiles(state).map((p) => p.staffId)
  const included = opts.included || eligible
  const excluded = eligible.filter((id) => !included.includes(id))
  const preview = computeRun(state, period, { included })
  const id = `run-${period.id}-${at}`
  return {
    id, no: nextRunNo(state), periodId: period.id, periodStart: period.start, periodEnd: period.end,
    payDate: period.payDate, frequency: period.frequency, scope: opts.scope || 'regular',
    status: 'draft', included, excluded, preparedBy: who, preparedAt: at,
    lines: preview.lines, totals: preview.totals, gate: preview.gate,
    audit: [nowAudit(opts, 'created', `${included.length} employees · ${period.start} → ${period.end}`)],
    exports: [], note: opts.note || '',
  }
}

// ---------------------------------------------------------------------------
// Pay stubs & reports
// ---------------------------------------------------------------------------
export function stubFor(state, run, staffId) {
  const line = (run.lines || []).find((l) => l.staffId === staffId)
  if (!line) return null
  const staff = (state.staff || []).find((s) => s.id === staffId) || {}
  const profile = profileFor(state, staffId) || {}
  const org = state.settings?.org || {}
  const net = grossToNet(state, staffId, run.periodId)
  return { run, line, staff, profile, org, net, period: { start: run.periodStart, end: run.periodEnd, payDate: run.payDate } }
}

/** YTD box totals for a W-2 style summary, from locked runs only. */
export function annualSummary(state, staffId, year) {
  const runs = Object.values(state.payRuns || {}).filter((r) => r.locked && (r.periodStart || '').slice(0, 4) === String(year))
  const out = { year, staffId, runs: 0, grossCents: 0, taxCents: 0, preTaxCents: 0, netCents: 0, employerCents: 0, otHours: 0, workedHours: 0, byCode: {} }
  for (const run of runs) {
    const l = (run.lines || []).find((x) => x.staffId === staffId)
    if (!l) continue
    out.runs += 1
    out.grossCents += l.grossCents
    out.taxCents += l.taxCents
    out.preTaxCents += l.preTaxCents || 0
    out.netCents += l.netCents
    out.employerCents += l.employerCents || 0
    out.otHours += l.otHours || 0
    out.workedHours += l.workedHours || 0
    for (const e of l.earnings || []) out.byCode[e.code] = (out.byCode[e.code] || 0) + (e.cents || 0)
  }
  return out
}

/** Draft 1099-NEC review list — contractors paid through payroll must be split
 *  out of W-2 reporting. We only flag; classification is a counsel decision. */
export function contractorReview(state, year) {
  const profiles = (state.payProfiles || []).filter((p) => p.classification === 'contractor')
  return profiles.map((p) => {
    const s = annualSummary(state, p.staffId, year)
    return { staffId: p.staffId, payrollId: p.payrollId, paidCents: s.grossCents, runs: s.runs }
  }).filter((r) => r.paidCents > 0)
}
