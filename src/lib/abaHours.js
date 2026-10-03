// ---- Behavior-analytic (⚡ ABA) hours: non-service staff time that counts toward credentials ----
//
// The ⚡ ABA Hours checkbox lives on **non-service** appointments only. Ticking it says:
// "this block of staff time is behavior-analytic work", so it is included when the
// practice totals behavior-analytic time for its RBTs / BCATs, graduate students and
// state-certification tracks.
//
// It has nothing to do with client authorizations. Service appointments draw on the
// client's authorized hours by *type* (`lib/authBudget.js`); they never carry this flag.
//
//   Counts    · group training in behavior-analytic principles, held outside client sessions
//             · graduate students designing or reviewing interventions during non-billable time
//             · data analysis, program evaluation, assessment/report writing, ABA coursework
//   Never     · cleaning the clinic
//             · general administrative tasks such as stimulus preparation
//
// This module is pure: no React, no store. Every read (calendar badge, staff roster,
// reports, payroll timesheet, validations) goes through `countsAsAbaHours` so the
// platform can never disagree with itself about what an ABA hour is.
import { isNonServiceAppt, isServiceAppt } from './model'

export const ABA_HOURS_LABEL = 'ABA Hours'
export const ABA_HOURS_BADGE = '⚡ ABA hr'

/** What the checkbox is *for* — shown verbatim in the booking dialog. */
export const ABA_HOURS_EXPLAIN =
  'Include this appointment as behavior-analytic time when tracking RBT / BCAT, graduate-student and state-certification hours.'
export const ABA_HOURS_EXAMPLES = [
  'Group trainings on behavior-analytic principles, held outside of client sessions',
  'Graduate students designing or reviewing interventions during non-billable time',
  'Data analysis, program evaluation and assessment/report writing',
]
export const ABA_HOURS_NON_EXAMPLES = [
  'Cleaning the clinic',
  'General administrative tasks such as stimulus preparation',
]

/**
 * The activity that makes a block behavior-analytic. `qualifies: false` rows exist so the
 * practice's non-examples are *named* in the picker instead of being silently mis-counted:
 * ticking ⚡ ABA Hr against one of them is a validation failure, not a rounding error.
 */
export const ABA_ACTIVITIES = [
  { id: 'group-training', label: 'Group training — behavior-analytic principles', qualifies: true, hint: 'Held outside of client sessions (staff-only)' },
  { id: 'intervention-design', label: 'Designing / reviewing interventions', qualifies: true, hint: 'Non-billable protocol design, review or revision' },
  { id: 'data-analysis', label: 'Data analysis, graphing & program evaluation', qualifies: true, hint: 'Reviewing client data to change a program' },
  { id: 'assessment-writing', label: 'Assessment / report writing', qualifies: true, hint: 'Narrative scoring, FBA and reassessment write-ups' },
  { id: 'technician-training', label: 'Training technicians on ABA procedures', qualifies: true, hint: 'Onboarding, competency checks, procedure fidelity' },
  { id: 'coursework', label: 'ABA coursework / CEUs', qualifies: true, hint: 'Graduate coursework or continuing education in behavior analysis' },
  { id: 'facility', label: 'Facility upkeep — cleaning the clinic', qualifies: false, hint: 'Not behavior-analytic time' },
  { id: 'general-admin', label: 'General admin — e.g. stimulus preparation', qualifies: false, hint: 'Not behavior-analytic time' },
]
export const ABA_ACTIVITY_BY_ID = Object.fromEntries(ABA_ACTIVITIES.map((a) => [a.id, a]))
export const ABA_QUALIFYING_ACTIVITIES = ABA_ACTIVITIES.filter((a) => a.qualifies)
export const ABA_NON_QUALIFYING_ACTIVITIES = ABA_ACTIVITIES.filter((a) => !a.qualifies)
export const abaActivityById = (id) => ABA_ACTIVITY_BY_ID[id] || null
export const abaActivityLabel = (a) => abaActivityById(a?.abaActivity)?.label || ''

/**
 * Credential tracks the hours are tallied against. `target` is the practice's own number
 * (defaults follow the usual requirement — RBT 40-hour initial training, BACB concentrated
 * fieldwork) and is editable in Settings → System → ABA Hours; nothing here claims to be a
 * board's rule, and the roster copy says so.
 */
export const ABA_TRACKS = [
  { id: 'student', label: 'Graduate student / trainee', match: /student|trainee|graduate|intern|practicum/i, target: 1500, basis: 'Supervised fieldwork toward BCBA / BCaBA certification' },
  { id: 'technician', label: 'RBT / BCAT', match: /RBT|BCAT|registered behavior technician|behavior technician|line therapist/i, target: 40, basis: 'RBT 40-hour initial training and ongoing competency' },
  { id: 'bcaba', label: 'BCaBA', match: /BCaBA/i, target: 100, basis: 'Supervised practice hours logged for the BCaBA' },
  { id: 'bcba', label: 'BCBA', match: /BCBA/i, target: 0, basis: 'Supervisor — hours logged, no target' },
  { id: 'other', label: 'Other / state certification', match: null, target: 0, basis: 'State certification requirement entered by the practice' },
]
export const ABA_TRACK_BY_ID = Object.fromEntries(ABA_TRACKS.map((t) => [t.id, t]))

export const DEFAULT_ABA_HOURS = {
  // per-track target hours; 0 = log the time without a target
  targets: Object.fromEntries(ABA_TRACKS.map((t) => [t.id, t.target])),
  // the booking dialog requires an activity before ⚡ ABA Hr can be saved
  requireActivity: true,
  // show the ⚡ badge on the calendar / agenda / detail card
  showOnCalendar: true,
}
export const abaHoursCfg = (settings) => ({
  ...DEFAULT_ABA_HOURS,
  ...(settings?.abaHours || {}),
  targets: { ...DEFAULT_ABA_HOURS.targets, ...(settings?.abaHours?.targets || {}) },
})

/* ── the one rule every module reads ─────────────────────────────────────── */

/**
 * Does this appointment count as behavior-analytic time?
 * Ticked ⚡ ABA Hr, on a **non-service** appointment, not cancelled, and not booked
 * against one of the practice's own non-examples. A legacy row with no activity still
 * counts (it is reported as uncategorized) so no hours are lost by the upgrade.
 */
export function countsAsAbaHours(a) {
  if (!a || a.abaHr !== true) return false
  if (!isNonServiceAppt(a)) return false
  if (a.status === 'cancelled') return false
  const act = abaActivityById(a.abaActivity)
  return act ? act.qualifies : true
}

export const abaMinutesOf = (a) => (countsAsAbaHours(a) ? Math.max(0, (a.end || 0) - (a.start || 0)) : 0)
const round2 = (n) => Math.round(n * 100) / 100
export const abaHoursOf = (a) => round2(abaMinutesOf(a) / 60)

/** Is the ⚡ flag even offered for this appointment type? (service appointments: no) */
export const abaHrEligible = (a) => isNonServiceAppt(a)
export const abaHrRefusal = (a) =>
  isServiceAppt(a)
    ? 'ABA Hours applies to non-service appointments only — service time counts against the client’s authorization instead.'
    : ''

/** Which credential track a staff member's behavior-analytic hours are tallied under. */
export function abaTrackFor(staff) {
  const hay = `${staff?.role || ''} ${staff?.cert || ''} ${(staff?.qualifications || []).join(' ')}`
  return ABA_TRACKS.find((t) => t.match && t.match.test(hay)) || ABA_TRACKS[ABA_TRACKS.length - 1]
}

/* ── roll-ups ────────────────────────────────────────────────────────────── */

const apptsOf = (state) => Object.values(state?.appts || {})

/** Normalize `{days}` or `{from,to}` into the sorted day list the roll-up sums over. */
export function abaRange({ days, from, to } = {}) {
  if (Array.isArray(days) && days.length) {
    const list = [...days].sort()
    return { days: list, from: list[0], to: list[list.length - 1], weeks: Math.max(1, Math.round(list.length / 7)) }
  }
  if (from && to) {
    const ms = Math.round((new Date(to) - new Date(from)) / 86400000) + 1
    return { days: null, from, to, weeks: Math.max(1, Math.round(ms / 7)) }
  }
  return { days: null, from: null, to: null, weeks: 1 }
}

const inRange = (a, range) => {
  if (range.days) return range.days.includes(a.date)
  if (!range.from) return true
  return a.date >= range.from && a.date <= range.to
}

/** Behavior-analytic blocks in range, oldest first — the audit trail behind every total. */
export function abaEntries(state, opts = {}) {
  const range = abaRange(opts)
  return apptsOf(state)
    .filter((a) => countsAsAbaHours(a) && inRange(a, range))
    .sort((a, b) => (a.date === b.date ? a.start - b.start : a.date < b.date ? -1 : 1))
}

/**
 * Per-person behavior-analytic hours with the track, target and activity mix — what the
 * staff roster, the report and the timesheet all render.
 */
export function abaStaffRows(state, opts = {}) {
  const cfg = abaHoursCfg(state?.settings)
  const range = abaRange(opts)
  const entries = abaEntries(state, opts)
  const agg = {}
  for (const a of entries) {
    for (const sid of a.staffIds || []) {
      const g = (agg[sid] = agg[sid] || { minutes: 0, sessions: 0, byActivity: {}, uncategorized: 0, nonQualifying: 0, ineligible: 0 })
      g.minutes += Math.max(0, (a.end || 0) - (a.start || 0))
      g.sessions++
      const act = abaActivityById(a.abaActivity)
      if (act) g.byActivity[act.id] = round2((g.byActivity[act.id] || 0) + (a.end - a.start) / 60)
      else g.uncategorized = round2(g.uncategorized + (a.end - a.start) / 60)
    }
  }
  // blocks that are ticked but must NOT count — surfaced so the practice can fix them
  for (const a of apptsOf(state)) {
    if (!a || a.abaHr !== true || !inRange(a, range) || countsAsAbaHours(a)) continue
    const act = abaActivityById(a.abaActivity)
    for (const sid of a.staffIds || []) {
      const g = (agg[sid] = agg[sid] || { minutes: 0, sessions: 0, byActivity: {}, uncategorized: 0, nonQualifying: 0, ineligible: 0 })
      if (act && !act.qualifies) g.nonQualifying = round2(g.nonQualifying + (a.end - a.start) / 60)
      else g.ineligible = round2(g.ineligible + (a.end - a.start) / 60)
    }
  }
  const rows = (state?.staff || [])
    .filter((s) => !opts.staffId || opts.staffId === s.id)
    .map((s) => {
      const g = agg[s.id] || { minutes: 0, sessions: 0, byActivity: {}, uncategorized: 0, nonQualifying: 0, ineligible: 0 }
      const track = abaTrackFor(s)
      const hours = round2(g.minutes / 60)
      const target = Number(cfg.targets[track.id]) || 0
      return {
        staffId: s.id,
        name: s.name,
        role: s.role || '',
        cert: s.cert || '',
        track: track.id,
        trackLabel: track.label,
        basis: track.basis,
        hours,
        sessions: g.sessions,
        perWeek: round2(hours / range.weeks),
        byActivity: g.byActivity,
        activities: Object.entries(g.byActivity)
          .map(([id, h]) => ({ id, label: abaActivityById(id)?.label || id, hours: h }))
          .sort((a, b) => b.hours - a.hours),
        uncategorized: g.uncategorized,
        excluded: round2(g.nonQualifying + g.ineligible),
        target,
        pct: target > 0 ? Math.min(999, Math.round((hours / target) * 100)) : null,
        atTarget: target > 0 && hours >= target,
      }
    })
    .filter((r) => opts.includeEmpty || r.hours > 0 || r.excluded > 0)
    .sort((a, b) => b.hours - a.hours || a.name.localeCompare(b.name))
  return { rows, range, cfg }
}

/** The one number the roster tiles, KPI strips and dashboard widgets read. */
export function abaTotals(state, opts = {}) {
  const { rows, range } = abaStaffRows(state, opts)
  return {
    hours: round2(rows.reduce((t, r) => t + r.hours, 0)),
    sessions: rows.reduce((t, r) => t + r.sessions, 0),
    staff: rows.filter((r) => r.hours > 0).length,
    uncategorized: round2(rows.reduce((t, r) => t + r.uncategorized, 0)),
    excluded: round2(rows.reduce((t, r) => t + r.excluded, 0)),
    atTarget: rows.filter((r) => r.atTarget).length,
    range,
  }
}

/* ── one-time migration ──────────────────────────────────────────────────── */

/**
 * Workspaces saved while ⚡ ABA Hr meant "count against the client's authorization" carry
 * the flag on *service* appointments, where it is meaningless under the corrected rule.
 * Strip it there (authorization burn-down reads the appointment type, so nothing is lost)
 * and leave every non-service flag exactly as it was. Idempotent, flagged in `meta`.
 */
export function normalizeAbaHours(state) {
  if (state?.meta?.abaHoursFixed) return state
  let stripped = 0
  let changed = false
  const appts = {}
  for (const [id, a] of Object.entries(state?.appts || {})) {
    if (a && a.abaHr === true && isServiceAppt(a)) {
      const next = { ...a, abaHr: false }
      delete next.abaActivity
      appts[id] = next
      stripped++
      changed = true
    } else appts[id] = a
  }
  const meta = { ...(state.meta || {}), abaHoursFixed: true, abaHoursStripped: stripped }
  return changed ? { ...state, appts, meta } : { ...state, meta }
}

/** What a fresh workspace migration did — used by the settings data-health panel. */
export const abaHoursMigrationCount = (state) => Number(state?.meta?.abaHoursStripped) || 0
