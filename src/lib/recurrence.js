// Recurrence rules and series edits for the calendar — pure, no React.
//
// A rule follows Google Calendar / Outlook semantics:
//   { freq: 'daily'|'weekly'|'monthly'|'yearly', interval: 1..99,
//     byDay: [0..6] (weekly), monthBy: 'day'|'nth'|'last' (monthly),
//     end: { type: 'never' } | { type: 'until', until: 'YYYY-MM-DD' } | { type: 'count', count } }
// Every occurrence of a series stores the rule as `rrule` with `dtstart` (the
// series' first date), so the series can be described, split and rebuilt.
//
// Honest limits, said in the UI too:
// - "Never" ends books at most 12 months ahead (RECURRENCE_MAX_MONTHS); the series
//   can be extended later. No rule ever creates more than that.
// - Monthly "on day 31" skips months without a 31st (Google's behaviour), and
//   yearly on Feb 29 only lands in leap years.
// - The practice has no holiday calendar; dates on closed weekdays
//   (settings.practiceDays) are named as a warning, never silently moved.
import { addMonths, addDays, daysInMonth, isoDate, parseISO, todayISO, DAY_NAMES, DAY_SHORT, MONTHS } from './date'
import { uid, timeOverlap } from './model'
import { evaluateAppointmentValidations, isCancelStatus, stopViolationsForDraft, validationFlagsForDraft } from './settingsMasters'
import { authCheckFor } from './authBudget'
import { mergeAuthChecks, unitCheckFor } from './authUnits'
import { lineApptIds } from './claims'
import { periodFor, sheetKey } from './payroll'

export const RECURRENCE_MAX_MONTHS = 12
export const FREQS = ['daily', 'weekly', 'monthly', 'yearly']
const MAX_COUNT = 400
const ORD = ['first', 'second', 'third', 'fourth', 'fifth']
const DAY = 86400000

const isISO = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && isoDate(parseISO(s)) === s
const ymd = (iso) => iso.split('-').map(Number)
const utc = (iso) => { const [y, m, d] = ymd(iso); return Date.UTC(y, m - 1, d) }
const dayDiff = (a, b) => Math.round((utc(b) - utc(a)) / DAY)
const dowOf = (iso) => new Date(utc(iso)).getUTCDay()
const shift = (iso, n) => isoDate(addDays(parseISO(iso), n))
const clampInt = (v, lo, hi, dflt) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt }
export const shortDate = (iso) => { const [y, m, d] = ymd(iso); return `${MONTHS[m - 1].slice(0, 3)} ${d}, ${y}` }

/** Last date a series starting on `startISO` may reach (12 months, inclusive). */
export const capDateOf = (startISO) => shift(isoDate(addMonths(parseISO(startISO), RECURRENCE_MAX_MONTHS)), -1)

/** Week-of-month facts for a date: 2nd Tuesday, last Friday … */
export function nthOf(iso) {
  const [y, m, d] = ymd(iso)
  return { nth: Math.ceil(d / 7), last: d + 7 > daysInMonth(y, m - 1), dow: dowOf(iso), day: d }
}

/** A clean rule, or null for "does not repeat" / anything unrecognisable. */
export function normalizeRule(raw, startISO) {
  if (!raw || typeof raw !== 'object' || !FREQS.includes(raw.freq)) return null
  const start = isISO(raw.dtstart) ? raw.dtstart : startISO
  const out = { freq: raw.freq, interval: clampInt(raw.interval, 1, 99, 1) }
  if (raw.freq === 'weekly') {
    const days = [...new Set((Array.isArray(raw.byDay) ? raw.byDay : []).map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort((a, b) => a - b)
    out.byDay = days.length ? days : isISO(start) ? [dowOf(start)] : [1]
  }
  if (raw.freq === 'monthly') out.monthBy = ['day', 'nth', 'last'].includes(raw.monthBy) ? raw.monthBy : 'day'
  const e = raw.end || {}
  out.end = e.type === 'until' && isISO(e.until) ? { type: 'until', until: e.until }
    : e.type === 'count' ? { type: 'count', count: clampInt(e.count, 1, MAX_COUNT, 8) }
      : { type: 'never' }
  if (isISO(raw.dtstart)) out.dtstart = raw.dtstart
  return out
}

/** Same repeat pattern and end (dtstart ignored). */
export function sameRule(a, b) {
  if (!a || !b) return !a && !b
  const strip = ({ dtstart, ...r }) => r
  return JSON.stringify(strip(normalizeRule(a, '2000-01-01'))) === JSON.stringify(strip(normalizeRule(b, '2000-01-01')))
}

function matches(r, start, iso, weekStart) {
  const [sy, sm, sd] = ymd(start)
  const [y, m, d] = ymd(iso)
  switch (r.freq) {
    case 'daily': return dayDiff(start, iso) % r.interval === 0
    case 'weekly': {
      if (!r.byDay.includes(dowOf(iso))) return false
      const offset = (dowOf(start) - weekStart + 7) % 7
      return Math.floor((dayDiff(start, iso) + offset) / 7) % r.interval === 0
    }
    case 'monthly': {
      const months = (y - sy) * 12 + (m - sm)
      if (months % r.interval) return false
      if (r.monthBy === 'day') return d === sd
      if (dowOf(iso) !== dowOf(start)) return false
      return r.monthBy === 'last' ? d + 7 > daysInMonth(y, m - 1) : Math.ceil(d / 7) === Math.ceil(sd / 7)
    }
    case 'yearly': return (y - sy) % r.interval === 0 && m === sm && d === sd
    default: return false
  }
}

/**
 * Dates of a rule from `startISO`. The start date always counts as the first
 * occurrence (RFC 5545 DTSTART). `capped` says the 12-month ceiling cut it short.
 */
export function expandRule(rule, startISO, { weekStart = 0 } = {}) {
  const r = normalizeRule(rule, startISO)
  if (!r || !isISO(startISO)) return { dates: isISO(startISO) ? [startISO] : [], capped: false, cap: null }
  const cap = capDateOf(startISO)
  const last = r.end.type === 'until' && r.end.until < cap ? r.end.until : cap
  const max = r.end.type === 'count' ? r.end.count : Infinity
  const dates = []
  for (let iso = startISO; iso <= last && dates.length < max; iso = shift(iso, 1)) {
    if (iso === startISO || matches(r, startISO, iso, weekStart)) dates.push(iso)
  }
  const capped = r.end.type === 'never' || (r.end.type === 'until' && r.end.until > cap) || (r.end.type === 'count' && dates.length < r.end.count)
  return { dates, capped, cap }
}

/** "Weekly on Mon, Wed until Dec 31, 2026" */
export function describeRule(rule, startISO) {
  const r = normalizeRule(rule, startISO)
  if (!r) return "Doesn't repeat"
  const start = r.dtstart || startISO
  const n = r.interval
  const { nth, dow, day } = nthOf(start)
  const [, sm, sd] = ymd(start)
  let s
  if (r.freq === 'daily') s = n === 1 ? 'Daily' : `Every ${n} days`
  else if (r.freq === 'weekly') {
    s = n === 1 && r.byDay.join() === '1,2,3,4,5' ? 'Every weekday (Mon–Fri)'
      : `${n === 1 ? 'Weekly' : `Every ${n} weeks`} on ${r.byDay.map((d) => DAY_SHORT[d]).join(', ')}`
  } else if (r.freq === 'monthly') {
    const base = n === 1 ? 'Monthly' : `Every ${n} months`
    s = r.monthBy === 'day' ? `${base} on day ${day}` : `${base} on the ${r.monthBy === 'last' ? 'last' : ORD[nth - 1]} ${DAY_NAMES[dow]}`
  } else s = `${n === 1 ? 'Annually' : `Every ${n} years`} on ${MONTHS[sm - 1]} ${sd}`
  if (r.end.type === 'until') s += ` until ${shortDate(r.end.until)}`
  if (r.end.type === 'count') s += `, ${r.end.count} time${r.end.count === 1 ? '' : 's'}`
  return s
}

/** Google-style quick picks for a start date. Each `rule` carries no end. */
export function rulePresets(startISO) {
  if (!isISO(startISO)) return [{ id: 'none', label: "Doesn't repeat", rule: null }]
  const { nth, last, dow, day } = nthOf(startISO)
  const [, sm, sd] = ymd(startISO)
  return [
    { id: 'none', label: "Doesn't repeat", rule: null },
    { id: 'daily', label: 'Daily', rule: { freq: 'daily', interval: 1 } },
    { id: 'weekdays', label: 'Every weekday (Mon–Fri)', rule: { freq: 'weekly', interval: 1, byDay: [1, 2, 3, 4, 5] } },
    { id: 'weekly', label: `Weekly on ${DAY_NAMES[dow]}`, rule: { freq: 'weekly', interval: 1, byDay: [dow] } },
    { id: 'biweekly', label: `Every 2 weeks on ${DAY_NAMES[dow]}`, rule: { freq: 'weekly', interval: 2, byDay: [dow] } },
    { id: 'monthly', label: `Monthly on day ${day}`, rule: { freq: 'monthly', interval: 1, monthBy: 'day' } },
    ...(nth <= 4 ? [{ id: 'monthly-nth', label: `Monthly on the ${ORD[nth - 1]} ${DAY_NAMES[dow]}`, rule: { freq: 'monthly', interval: 1, monthBy: 'nth' } }] : []),
    ...(last ? [{ id: 'monthly-last', label: `Monthly on the last ${DAY_NAMES[dow]}`, rule: { freq: 'monthly', interval: 1, monthBy: 'last' } }] : []),
    { id: 'yearly', label: `Annually on ${MONTHS[sm - 1]} ${sd}`, rule: { freq: 'yearly', interval: 1 } },
  ]
}

/** Which quick pick a rule is (end ignored), else 'custom'. */
export function presetIdOf(rule, startISO) {
  if (!rule) return 'none'
  const pattern = (r) => { const x = normalizeRule(r, startISO); return x && JSON.stringify({ ...x, end: null, dtstart: null }) }
  const hit = rulePresets(startISO).find((p) => p.rule && pattern(p.rule) === pattern(rule))
  return hit ? hit.id : 'custom'
}

/** Coarse label kept on `recurrence` for older readers (and the legacy filter). */
export const legacyRecurrenceOf = (rule) => (!rule ? 'none' : rule.freq === 'weekly' && rule.interval === 2 ? 'biweekly' : rule.freq)

/** A weekly rule that only repeated on the old weekday follows the date to its new weekday. */
export function retargetRule(rule, oldISO, newISO) {
  if (!rule || rule.freq !== 'weekly' || !isISO(oldISO) || !isISO(newISO)) return rule
  return rule.byDay?.length === 1 && rule.byDay[0] === dowOf(oldISO) ? { ...rule, byDay: [dowOf(newISO)] } : rule
}

/** Pre-rule series stored only `recurrence: 'weekly'|'biweekly'|'monthly'` and a fixed list of dates. */
export function ruleFromLegacy(recurrence, firstISO, lastISO) {
  if (!isISO(firstISO)) return null
  const end = isISO(lastISO) ? { type: 'until', until: lastISO } : { type: 'never' }
  const base = { weekly: { freq: 'weekly', interval: 1 }, biweekly: { freq: 'weekly', interval: 2 }, monthly: { freq: 'monthly', interval: 1, monthBy: 'day' }, daily: { freq: 'daily', interval: 1 }, yearly: { freq: 'yearly', interval: 1 } }[recurrence]
  return base ? normalizeRule({ ...base, end, dtstart: firstISO }, firstISO) : null
}

const byDate = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.start || 0) - (b.start || 0))
export const seriesMembers = (appts, seriesId) => (seriesId ? Object.values(appts || {}).filter((a) => a.seriesId === seriesId).sort(byDate) : [])

/** The series' rule with its dtstart, from the stored rule or the legacy label. */
export function ruleOf(appt, members) {
  const sibs = members || [appt]
  const first = sibs[0]?.date || appt?.date
  if (appt?.rrule) return normalizeRule({ dtstart: first, ...appt.rrule }, first)
  return appt?.seriesId ? ruleFromLegacy(appt.recurrence, first, sibs[sibs.length - 1]?.date) : null
}

/**
 * Migration (idempotent): give every legacy series its rule. Returns the same
 * object when nothing changes, so a load does not rewrite localStorage.
 */
export function normalizeRecurrence(state) {
  const appts = state?.appts
  if (!appts) return state
  const groups = {}
  for (const a of Object.values(appts)) if (a?.seriesId && !a.rrule) (groups[a.seriesId] ||= []).push(a)
  const ids = Object.keys(groups)
  if (!ids.length) return state
  const next = { ...appts }
  let changed = false
  for (const sid of ids) {
    const all = seriesMembers(appts, sid)
    const rule = ruleOf(all.find((a) => a.rrule) || all[0], all)
    if (!rule) continue
    for (const a of groups[sid]) { next[a.id] = { ...a, rrule: rule }; changed = true }
  }
  return changed ? { ...state, appts: next } : state
}

// ---------- downstream locks ----------

const claimedIds = (state) => new Set(Object.values(state.claims || {}).flatMap((c) => (c.lines || []).flatMap(lineApptIds)))

/** Why a series edit must leave this occurrence alone, or null. */
export function lockReason(state, a, claimed = claimedIds(state)) {
  if (claimed.has(a.id) || a.claimId || a.billing?.status) return 'billed'
  if (a.status === 'completed') return 'completed'
  if (isCancelStatus(state.settings, a.status)) return 'cancelled'
  const payroll = state.settings?.payroll
  if (payroll && (a.staffIds || []).length) {
    const period = periodFor(payroll, a.date)
    if (period && (a.staffIds || []).some((s) => ['approved', 'processed'].includes(state.paySheets?.[sheetKey(s, period.id)]?.status))) return 'payroll'
  }
  return null
}
const LOCK_WORDS = { billed: 'billed or on a claim', completed: 'completed', cancelled: 'cancelled or no-show', payroll: 'in an approved pay period' }
const keptNote = (kept) => {
  if (!kept.length) return ''
  const counts = {}
  for (const k of kept) counts[k.why] = (counts[k.why] || 0) + 1
  return ` · ${kept.length} kept as ${kept.length === 1 ? 'it is' : 'they are'} (${Object.entries(counts).map(([w, n]) => `${n} ${LOCK_WORDS[w] || w}`).join(', ')})`
}

// ---------- validation across occurrences ----------

const CLINICAL = new Set(['service', 'evaluation', 'supervision'])

/** Stop reasons (refuse this date) and warnings (named in the result) for one draft. */
export function occurrenceChecks(state, draft, { today = todayISO() } = {}) {
  const reasons = []
  const warns = []
  if (isCancelStatus(state.settings, draft.status)) return { reasons, warns }
  const clash = Object.values(state.appts || {}).some((b) => b.id !== draft.id && b.date === draft.date && !isCancelStatus(state.settings, b.status) &&
    timeOverlap(draft.start, draft.end, b.start, b.end) &&
    ((draft.staffIds || []).some((s) => (b.staffIds || []).includes(s)) || (draft.clientIds || []).some((c) => (b.clientIds || []).includes(c))))
  if (clash) reasons.push('time clash with an existing booking')
  for (const s of stopViolationsForDraft(state, draft)) reasons.push(s.label)
  for (const w of evaluateAppointmentValidations(state, draft).warns || []) warns.push(w.label)
  if (CLINICAL.has(draft.type)) {
    for (const cid of draft.clientIds || []) {
      const client = (state.clients || []).find((c) => c.id === cid)
      if (!client) continue
      const merged = mergeAuthChecks(authCheckFor(state, client, draft, { today }), unitCheckFor(state, client, draft, { today }), state.settings)
      if (merged.blocked) reasons.push(`authorization for ${client.name}: ${merged.reasons[0] || 'past the hours on file'}`)
      else if (merged.severity === 'warn') warns.push(`authorization warning for ${client.name}`)
    }
  }
  const open = state.settings?.practiceDays
  if (Array.isArray(open) && open.length && !open.includes(dowOf(draft.date))) warns.push('falls on a day the practice is closed')
  return { reasons, warns }
}

/**
 * Screen drafts in date order against the live calendar plus the drafts already
 * accepted (audit CFG-03). `removeIds` leave the calendar first. A rejected draft
 * of an existing appointment keeps its old version on the calendar.
 */
export function screenOccurrences(state, drafts, { removeIds = [], today = todayISO() } = {}) {
  const view = { ...(state.appts || {}) }
  for (const id of removeIds) delete view[id]
  for (const d of drafts) delete view[d.id]
  const accepted = []
  const rejected = []
  const warnCount = {}
  for (const d of [...drafts].sort(byDate)) {
    const s = { ...state, appts: view }
    const { reasons, warns } = occurrenceChecks(s, d, { today })
    if (reasons.length) {
      rejected.push({ id: d.id, date: d.date, reasons })
      if (state.appts?.[d.id] && !removeIds.includes(d.id)) view[d.id] = state.appts[d.id]
      continue
    }
    for (const w of new Set(warns)) warnCount[w] = (warnCount[w] || 0) + 1
    const ok = { ...d, validationFlags: validationFlagsForDraft(s, d) }
    accepted.push(ok)
    view[ok.id] = ok
  }
  return { accepted, rejected, warns: warnCount }
}

export function screenNote({ rejected = [], warns = {} }) {
  let s = ''
  if (rejected.length) s += ` · ${rejected.length} rejected (${rejected.slice(0, 3).map((r) => `${r.date}: ${r.reasons[0]}`).join('; ')})`
  const w = Object.entries(warns)
  if (w.length) s += ` · warnings: ${w.map(([label, n]) => `${label} (${n})`).join('; ')}`
  return s
}

// ---------- series transactions ----------

// What a series-wide edit copies to the other occurrences. Status, verification,
// signatures, documents, cancellation and billing state belong to one session.
export const SERIES_FIELDS = ['type', 'title', 'start', 'end', 'staffIds', 'clientIds', 'location', 'origin', 'destination', 'unavailTarget', 'service', 'pcfs', 'notes', 'abaHr', 'abaActivity', 'custom', 'billing']
const PER_SESSION_BILLING = ['status', 'claimNo', 'billedAt', 'submittedAt']
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => Object.hasOwn(o, k)).map((k) => [k, o[k]]))
const cleanBilling = (b) => (b ? Object.fromEntries(Object.entries(b).filter(([k]) => !PER_SESSION_BILLING.includes(k))) : b)

/**
 * Plan one series change. input:
 *   { op: 'edit',   id, scope: 'following'|'all', draft, rule? }   rule: object | null (stop repeating); omitted = unchanged
 *   { op: 'remove', id, scope: 'one'|'following'|'all' }
 *   { op: 'cancel', id, scope: 'one'|'following'|'all', status?, cancelReasonId?, cancelReason? }
 * Returns { ok, msg, upserts, deleteIds, newIds, firstId }. Pure: the reducer
 * re-plans against live state with the same `ids`, so the result is the same.
 *
 * Semantics (Google Calendar):
 * - "This and following" splits the series: earlier occurrences keep the old
 *   series and now end the day before; this one and later ones form a new series.
 * - Field-only edits copy the changed fields to every occurrence in scope and
 *   keep each occurrence's own differences (exceptions survive).
 * - A new date or rule rebuilds upcoming occurrences from the rule; single-
 *   occurrence changes in that range are replaced, as in Google.
 * - Never touched: completed, cancelled/no-show, billed or claimed sessions, and
 *   sessions in an approved pay period — they are kept and counted. Rebuilds never
 *   create or delete sessions dated before today.
 */
export function planSeriesTx(state, input, { today = todayISO(), ids = [], weekStart = state?.settings?.weekStart || 0 } = {}) {
  const fail = (msg) => ({ ok: false, msg })
  const anchor = state?.appts?.[input?.id]
  if (!anchor) return fail('Appointment not found.')
  let k = 0
  const newIds = []
  const nextId = () => { const id = ids[k++] || uid(); newIds.push(id); return id }
  const claimed = claimedIds(state)
  const lock = (a) => lockReason(state, a, claimed)
  const sibs = anchor.seriesId ? seriesMembers(state.appts, anchor.seriesId) : [anchor]
  const scope = ['one', 'following', 'all'].includes(input.scope) ? input.scope : 'one'
  const inScope = !anchor.seriesId || scope === 'one' ? [anchor] : scope === 'following' ? sibs.filter((s) => s.date >= anchor.date) : sibs
  const earlier = scope === 'following' ? sibs.filter((s) => s.date < anchor.date) : []
  const rule = ruleOf(anchor, sibs)
  const endBefore = (date) => (rule ? { ...rule, end: { type: 'until', until: shift(date, -1) } } : undefined)
  const capEarlier = () => earlier.map((e) => ({ ...e, rrule: endBefore(anchor.date) }))

  if (input.op === 'remove') {
    if (scope === 'one' || !anchor.seriesId) {
      const why = lock(anchor)
      if (why) return fail(`This session is ${LOCK_WORDS[why]} — it cannot be deleted.`)
      return { ok: true, msg: 'Appointment deleted', upserts: [], deleteIds: [anchor.id], newIds, firstId: null }
    }
    const kept = []
    const deleteIds = []
    for (const t of inScope) { const why = lock(t); if (why) kept.push({ id: t.id, why }); else deleteIds.push(t.id) }
    if (!deleteIds.length) return fail(`Nothing deleted${keptNote(kept)}.`)
    return { ok: true, msg: `Deleted ${deleteIds.length} occurrence${deleteIds.length === 1 ? '' : 's'}${keptNote(kept)}`, upserts: capEarlier(), deleteIds, newIds, firstId: null }
  }

  if (input.op === 'cancel') {
    const status = input.status && isCancelStatus(state.settings, input.status) ? input.status : 'cancelled'
    const reason = { cancelReasonId: input.cancelReasonId || null, cancelReason: input.cancelReason || null }
    // a past session is not cancelled in bulk: its notice time would be invented
    const targets = scope === 'one' ? [anchor] : inScope.filter((s) => s.id === anchor.id || s.date >= today)
    const kept = []
    const upserts = []
    for (const t of targets) {
      const why = lock(t)
      if (why) { if (why !== 'cancelled') kept.push({ id: t.id, why }); continue }
      upserts.push({ ...t, status, ...reason, ...(scope === 'one' && t.seriesId ? { edited: true } : {}) })
    }
    if (!upserts.length) return fail(`Nothing to cancel${keptNote(kept)}.`)
    return { ok: true, msg: `Cancelled ${upserts.length} occurrence${upserts.length === 1 ? '' : 's'}${keptNote(kept)}`, upserts, deleteIds: [], newIds, firstId: anchor.id }
  }

  if (input.op !== 'edit') return fail('Unknown series change.')
  const draft = input.draft || {}
  const ruleGiven = Object.hasOwn(input, 'rule')
  const newDate = isISO(draft.date) ? draft.date : anchor.date
  const dateChanged = newDate !== anchor.date
  let newRule = ruleGiven ? normalizeRule(input.rule, newDate) : rule
  const ruleChanged = ruleGiven && !sameRule(newRule, rule)
  if (!anchor.seriesId && !newRule) return fail('This appointment does not repeat.')
  if (anchor.seriesId && scope === 'one') return fail('A change to one occurrence is saved as a single-session edit.')
  if (dateChanged && !ruleChanged) newRule = retargetRule(newRule, anchor.date, newDate)
  const split = earlier.length > 0
  const seriesId = !newRule ? undefined : split || !anchor.seriesId ? nextId() : anchor.seriesId
  const changed = SERIES_FIELDS.filter((key) => Object.hasOwn(draft, key) && !same(draft[key], anchor[key]))
  const anchorNext = { ...anchor, ...draft, id: anchor.id, date: newDate }
  const kept = []
  const upserts = [...capEarlier()]
  const drafts = []
  const deleteIds = []
  const meta = (a, rr) => ({ ...a, seriesId, rrule: newRule ? { ...newRule, dtstart: rr } : undefined, recurrence: legacyRecurrenceOf(newRule) })

  if (!ruleChanged && !dateChanged) {
    const dtstart = split ? anchor.date : rule?.dtstart || sibs[0].date
    for (const t of inScope) {
      if (t.id === anchor.id) { drafts.push(meta(anchorNext, dtstart)); continue }
      const why = lock(t)
      if (why) { kept.push({ id: t.id, why }); upserts.push(meta(t, dtstart)); continue }
      if (!changed.length) { upserts.push(meta(t, dtstart)); continue }
      drafts.push(meta({ ...t, ...pick(draft, changed) }, dtstart))
    }
  } else {
    // rebuild from the rule: "all" keeps the series start, moved by the same days as this occurrence
    const dtstart = scope === 'all' && anchor.seriesId ? shift(sibs[0].date, dayDiff(anchor.date, newDate)) : newDate
    const occupied = new Set()
    for (const t of inScope) {
      if (t.id === anchor.id) continue
      const why = lock(t) || (t.date < today ? 'past' : null)
      if (!why) { deleteIds.push(t.id); continue }
      occupied.add(t.originalDate || t.date)
      if (why === 'past') {
        // history keeps its date; plain field changes still apply, as in a field-only edit
        drafts.push(meta(changed.length ? { ...t, ...pick(draft, changed.filter((f) => f !== 'start' && f !== 'end')) } : t, dtstart))
      } else { kept.push({ id: t.id, why }); upserts.push(meta(t, dtstart)) }
    }
    const dates = newRule ? expandRule(newRule, dtstart, { weekStart }).dates : [newDate]
    const anchorKeeps = lock(anchor) || newDate < today || dates.includes(newDate)
    if (anchorKeeps) { drafts.push(meta(anchorNext, dtstart)); occupied.add(newDate) } else deleteIds.push(anchor.id)
    const template = {
      ...pick({ ...anchor, ...draft }, SERIES_FIELDS),
      billing: cleanBilling(draft.billing ?? anchor.billing),
      status: 'active', verification: null, documents: [], notes: draft.notes ?? anchor.notes ?? '',
    }
    for (const d of dates) {
      if (d < today || occupied.has(d)) continue
      drafts.push(meta({ ...template, id: nextId(), date: d, createdAt: Date.now() }, dtstart))
    }
  }

  const screened = screenOccurrences(state, drafts, { removeIds: deleteIds, today })
  const anchorRejected = screened.rejected.find((r) => r.id === anchor.id)
  if (anchorRejected) return fail(`This occurrence cannot be saved — ${anchorRejected.reasons[0]}`)
  const all = [...upserts, ...screened.accepted]
  const rebuilt = ruleChanged || dateChanged
  const touched = screened.accepted.length
  const head = rebuilt
    ? `Series ${newRule ? `rebuilt — ${describeRule(newRule, newDate)}` : 'ended — this session no longer repeats'} · ${touched} occurrence${touched === 1 ? '' : 's'} saved${deleteIds.length ? ` · ${deleteIds.length} replaced` : ''}`
    : scope === 'all' ? `Updated all ${touched} occurrence${touched === 1 ? '' : 's'}` : `Updated this & ${Math.max(0, touched - 1)} following`
  return {
    ok: true,
    msg: `${head}${keptNote(kept)}${screenNote(screened)}`,
    upserts: all,
    deleteIds,
    newIds,
    firstId: all.some((a) => a.id === anchor.id) ? anchor.id : screened.accepted.find((a) => a.date >= newDate)?.id || null,
  }
}
