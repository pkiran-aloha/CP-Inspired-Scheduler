// ---- D1: caseload ramp — known authorized work vs clinician capacity ----------
//
// The question: over the next 12 weeks, does the demand we already know about fit
// the clinical hours we already have?
//
// Demand is not a forecast (scheduling-intelligence-ideas.md §7 forbids selling a
// predicted demand): it is exactly the hours on file —
//   1. each active client's authorized weekly hours, for as long as the
//      authorization window on the chart runs, and
//   2. open intake requests at their requested hours, shown as a separate lighter
//      band from their target date, never weighted by a conversion rate.
// An authorization that ends inside the horizon drops to zero there and the week is
// marked "renewal pending" — a renewal is never assumed.
//
// Supply reuses the Coverage tab's denominator: each active clinician's working day
// (`settings.workday`) minus blocked-out time, split RBT vs BCBA. The practice-days
// setting controls which weekdays count toward this ramp's supply.
//
// Pure and read-only: nothing here books, moves or sends anything.

import { addDays, isoDate, parseISO, startOfWeek, todayISO } from './date'
import { overlapsType } from './model'
import { isTerminal } from './intake'

export const RAMP_WEEKS = 12
/** Default practice days: Monday–Friday. */
export const RAMP_OPEN_DOWS = [1, 2, 3, 4, 5]
const validPracticeDays = (value) => Array.isArray(value) && value.length > 0 && value.every((d) => Number.isInteger(d) && d >= 0 && d <= 6)
export const practiceDaysOf = (value) => [...new Set(validPracticeDays(value) ? value : RAMP_OPEN_DOWS)].sort((a, b) => a - b)

const round1 = (n) => Math.round(n * 10) / 10
const validDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && isoDate(parseISO(s)) === s
const daysBetweenISO = (a, b) => Math.round((parseISO(b) - parseISO(a)) / 86400000)
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0 }

/**
 * Bucket a staff member for the supply split. Free-text role/cert is matched the
 * tolerant way the rest of the app does (parts around "·", "#number" suffixes):
 * RBT-tier, analyst-tier (BCBA incl. BCaBA and trainee BCBA certs) or other
 * clinical. Returns null for staff with no clinical credential text (e.g. a
 * scheduler & billing coordinator) — they never enter the clinical supply.
 */
export function clinicianGroup(s) {
  const text = `${s.role || ''} ${s.cert || ''}`
  if (/RBT/i.test(text)) return 'rbt'
  if (/BCBA/i.test(text) || /BCaBA/.test(text)) return 'bcba'
  if (/psycholog|speech|slp|therapist|teacher|specialist|technician/i.test(text)) return 'other'
  return null
}

/**
 * Weekly hours an open intake request asks for, or 0 when nothing is recorded yet.
 * The assessment's recommended hours win; otherwise the requested units over their
 * window (15-minute units, the Medicaid norm) are converted to hours per week.
 * The same 80 h/week cap the conversion planner uses keeps a bad entry from
 * dominating the ramp.
 */
export function intakeWeeklyHours(req) {
  const rec = num(req.assessment?.recommendedHoursPerWeek)
  if (rec > 0) return Math.min(80, rec)
  const units = num(req.auth?.unitsRequested)
  const { windowStart, windowEnd } = req.auth || {}
  if (units > 0 && validDate(windowStart) && validDate(windowEnd) && windowEnd > windowStart) {
    const weeks = Math.max(1, Math.round(daysBetweenISO(windowStart, windowEnd) / 7))
    return Math.min(80, Math.max(1, Math.round((units * 15) / 60 / weeks)))
  }
  return 0
}

/**
 * The caseload ramp board.
 *
 * Returns one row per practice week (`settings.weekStart`), 12 weeks from the week
 * containing `today`: authorized demand, the intake band, clinical supply split by
 * tier, the balance, and the renewals that end in that week. `summary` carries the
 * counts and the first week where known demand exceeds supply.
 */
export function rampBoard(state, { today = todayISO(), weeks = RAMP_WEEKS } = {}) {
  const settings = state.settings || {}
  const ws = Number.isInteger(settings.weekStart) ? settings.weekStart : 0
  const [wdStart, wdEnd] = Array.isArray(settings.workday) && settings.workday.length === 2 ? settings.workday : [8, 18]
  const openDows = practiceDaysOf(settings.practiceDays)
  const span = Math.max(1, wdEnd - wdStart)
  const week0 = startOfWeek(parseISO(today), ws)

  const buckets = Array.from({ length: Math.max(1, weeks) }, (_, i) => {
    const start = isoDate(addDays(week0, i * 7))
    const end = isoDate(addDays(week0, i * 7 + 6))
    return { start, end, demandHours: 0, intakeHours: 0, supplyHours: 0, supply: { rbt: 0, bcba: 0, other: 0 }, clients: 0, renewals: [] }
  })
  const weekIndexOf = (dateISO) => buckets.findIndex((b) => dateISO >= b.start && dateISO <= b.end)

  // ---- demand: authorized weekly hours for as long as each window runs ----
  let clientsCounted = 0
  let clientsLapsed = 0
  for (const c of state.clients || []) {
    if (c.status === 'inactive' || c.status === 'discharged') continue
    const weekly = num(c.authWeekly)
    if (!(weekly > 0) || !validDate(c.authStart) || !validDate(c.authEnd) || c.authEnd < c.authStart) continue
    if (c.authEnd < today) { clientsLapsed += 1; continue } // already lapsed: no forward demand, never invent a renewal
    let touched = false
    for (const b of buckets) {
      if (c.authStart <= b.end && c.authEnd >= b.start) {
        b.demandHours += weekly
        b.clients += 1
        touched = true
      }
    }
    if (touched) {
      clientsCounted += 1
      const wi = weekIndexOf(c.authEnd)
      if (wi >= 0) buckets[wi].renewals.push({ id: c.id, name: c.name, weekly })
    }
  }

  // ---- intake band: open requests at their requested hours, from their target date ----
  // Requests without recorded hours are counted, never guessed at.
  let intakeCounted = 0
  let intakeNoHours = 0
  let intakeUndated = 0
  const horizonEnd = buckets[buckets.length - 1].end
  for (const r of Object.values(state.intakeRequests || {})) {
    if (!r || isTerminal(r.stage)) continue
    const weekly = intakeWeeklyHours(r)
    if (!(weekly > 0)) { intakeNoHours += 1; continue }
    const winStart = validDate(r.auth?.windowStart) ? r.auth.windowStart : ''
    const dated = Boolean(winStart && winStart >= today)
    const from = dated ? winStart : today // a window already underway could start any day; no date at all counts from now
    if (!dated) intakeUndated += 1
    const winEnd = validDate(r.auth?.windowEnd) && r.auth.windowEnd >= from ? r.auth.windowEnd : horizonEnd
    let touched = false
    for (const b of buckets) {
      if (from <= b.end && winEnd >= b.start) {
        b.intakeHours += weekly
        touched = true
      }
    }
    if (touched) intakeCounted += 1
  }

  // ---- supply: clinicians' working days minus blocked-out time (Coverage's denominator) ----
  const staff = (state.staff || []).filter((s) => s.status !== 'inactive' && clinicianGroup(s))
  // Per staff per day, the working-day hours taken off the market by blocked-out time.
  const blockedHours = new Map() // `${date}|${staffId}` -> Set of hour-of-day
  for (const a of Object.values(state.appts || {})) {
    if (a.status === 'cancelled' || overlapsType(a)) continue
    for (const sid of a.staffIds || []) {
      const k = `${a.date}|${sid}`
      let set = blockedHours.get(k)
      if (!set) { set = new Set(); blockedHours.set(k, set) }
      for (let h = wdStart; h < wdEnd; h++) if (a.start < (h + 1) * 60 && h * 60 < a.end) set.add(h)
    }
  }
  for (const b of buckets) {
    for (let d = 0; d < 7; d++) {
      const dateObj = addDays(parseISO(b.start), d)
      const dow = dateObj.getDay()
      if (!openDows.includes(dow)) continue
      const date = isoDate(dateObj)
      for (const s of staff) {
        const blocked = blockedHours.get(`${date}|${s.id}`)
        const open = blocked ? span - blocked.size : span
        if (open <= 0) continue
        b.supplyHours += open
        b.supply[clinicianGroup(s)] += open
      }
    }
  }

  // ---- roll up ----
  for (const b of buckets) {
    b.demandHours = round1(b.demandHours)
    b.intakeHours = round1(b.intakeHours)
    b.totalHours = round1(b.demandHours + b.intakeHours)
    b.balanceHours = round1(b.supplyHours - b.totalHours)
    b.renewalPending = b.renewals.length > 0
  }
  const shortWeeks = buckets.filter((b) => b.balanceHours < 0)
  const peak = buckets.reduce((m, b) => (b.totalHours > (m?.totalHours ?? -1) ? b : m), null)
  const staffCounts = { rbt: 0, bcba: 0, other: 0 }
  for (const s of staff) staffCounts[clinicianGroup(s)] += 1
  const renewalsTotal = buckets.reduce((t, b) => t + b.renewals.length, 0)

  const note =
    'Demand is the authorized weekly hours on file plus open intake requests at their requested hours. This is a ramp from known work, ' +
    'not a forecast of referrals, and intake is never weighted by a conversion rate. Renewals are never assumed: an authorization ' +
    'ending inside the horizon drops to zero and the week is marked. Supply is each clinician\u2019s working day minus blocked-out ' +
    `time, ${openDows.map((d) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d]).join(', ')}, split RBT and BCBA. Read-only: nothing here is booked, moved or sent.`

  return {
    weeks: buckets,
    horizonWeeks: buckets.length,
    workday: { start: wdStart, end: wdEnd, span },
    cfg: { weeks: buckets.length, weekStart: ws, openDows },
    summary: {
      clients: clientsCounted,
      lapsed: clientsLapsed,
      intakeCounted,
      intakeNoHours,
      intakeUndated,
      staff: staffCounts,
      shortWeeks: shortWeeks.length,
      firstShort: shortWeeks[0]?.start || null,
      renewals: renewalsTotal,
      peak: peak ? { start: peak.start, totalHours: peak.totalHours } : null,
    },
    note,
  }
}
