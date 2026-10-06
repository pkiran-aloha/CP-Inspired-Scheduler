// ---- Cancellation reason codes: turn "12% cancellations" into a root cause ----
//
// The reasons are the practice's own list: Settings → Custom Lists → "Cancellation
// reasons" (`cancel-reasons`). A cancellation-status appointment records the option it
// was given (`cancelReasonId` + the label at the time, `cancelReason`).
//
// Every reason has a *side* — who the lost session is on:
//   client   · the family could not or did not attend (illness, transport, holiday …)
//   practice · the practice could not deliver (staff illness, scheduling error …)
// Only client-side reasons say anything about a family's attendance, so the risk model
// leaves practice-side cancellations out of a client's own history.
//
// Pure: no React, no store, no network.

import { isCancelStatus, listOptions } from './settingsMasters'
import { parseISO } from './date'

export const CANCEL_LIST_ID = 'cancel-reasons'
export const NOT_RECORDED = 'Not recorded'
export const SIDE_LABEL = { client: 'Client / family', practice: 'Practice', unknown: '—' }

export const cancelReasonOptions = (settings) => listOptions(settings, CANCEL_LIST_ID)

// ponytail: side is read from the reason's wording; give Custom Lists a per-option side
// picker if a practice needs practice-side reasons that do not name staff or scheduling.
const PRACTICE_WORDS = /\b(staff|clinician|therapist|technician|rbt|bcba|provider|scheduling|practice|office|clinic closed)\b/i
export const cancelSide = (label) => (!label ? 'unknown' : PRACTICE_WORDS.test(label) ? 'practice' : 'client')
export const isPracticeCancel = (a) => cancelSide(a?.cancelReason) === 'practice'

// When a session was cancelled: `cancelledAt` (ISO time) is stamped by the reducer the
// moment an appointment enters a cancellation status, and dropped when it leaves one.
// A no-show is not a cancellation, so it never carries one. Sessions cancelled before
// this field existed have none: their notice is unknown, never guessed.
const isCancelled = (settings, status) => status !== 'no-show' && isCancelStatus(settings, status)

/** `next` with `cancelledAt` set, kept or cleared against `prev` (undefined for a new record). */
export function stampCancelledAt(prev, next, settings, now = new Date().toISOString()) {
  if (!isCancelled(settings, next.status)) return next.cancelledAt === undefined ? next : { ...next, cancelledAt: undefined }
  // already cancelled (a reason edit, a move): keep what was known, even when that is nothing
  if (prev && isCancelled(settings, prev.status)) return next.cancelledAt === prev.cancelledAt ? next : { ...next, cancelledAt: prev.cancelledAt }
  return next.cancelledAt ? next : { ...next, cancelledAt: now }
}

/** Hours of notice a cancellation gave (session start minus cancelledAt), or null when not recorded. */
export function cancelLeadHours(a) {
  if (!a?.cancelledAt || !a.date) return null
  const at = Date.parse(a.cancelledAt)
  if (!Number.isFinite(at)) return null
  const start = parseISO(a.date).getTime() + (a.start || 0) * 60000
  return (start - at) / 3600000
}

// ---- Notice: how long before the session the family told us ------------------------
//
// The practice's threshold is `settings.billing.lateCancelHours` (24 by default): the
// notice a cancellation needs to give before the slot could realistically be refilled.
// It is read from one place here so the risk model and the Overbooking backtest share a
// single definition of "late" instead of drifting apart. Anything that is not a sane
// 0–168 h (a week) falls back to the caller's default, so a hand-edited workspace cannot
// smuggle in an off-menu number.
export const LATE_CANCEL_HOURS = 24
export const cancelNoticeHoursOf = (settings, fallback = LATE_CANCEL_HOURS) => {
  const raw = settings?.billing?.lateCancelHours
  if (raw === null || raw === undefined || raw === '') return fallback // missing means the default, not zero
  const v = Number(raw)
  return Number.isFinite(v) && v >= 0 && v <= 168 ? v : fallback
}

/**
 * More notice than the threshold means the practice could refill the slot, so the
 * cancellation is not evidence that the session simply evaporated. A no-show never
 * counts, and neither does a cancellation with no time recorded — unknown is not guessed.
 */
export const cancelledEarly = (a, hours) => a?.status !== 'no-show' && (cancelLeadHours(a) ?? -Infinity) > hours

/** The appointment patch for a picked reason (or the clearing patch when there is none). */
// (undefined, not null, so a cleared reason vanishes from storage instead of lingering as a key)
export const reasonPatch = (opt) => (opt ? { cancelReasonId: opt.id, cancelReason: opt.label } : { cancelReasonId: undefined, cancelReason: undefined })

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const timeBand = (start) => (start < 12 * 60 ? 'Morning' : start < 16 * 60 ? 'Afternoon' : 'Late afternoon')
const top = (counts, n) => {
  const [k, v] = Object.entries(counts).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0] || []
  return k && v >= 2 ? `${k} (${v} of ${n})` : '—'
}

/**
 * Roll cancelled / missed appointments up by reason. `list` must already be the
 * cancellation-status appointments in scope; rows sort by volume, "Not recorded" last.
 */
export function cancelReasonRows(list) {
  const groups = {}
  for (const a of list) {
    const reason = a.cancelReason || NOT_RECORDED
    const g = (groups[reason] = groups[reason] || { reason, n: 0, min: 0, dow: {}, time: {} })
    g.n++
    g.min += Math.max(0, (a.end || 0) - (a.start || 0))
    const d = DOW[parseISO(a.date).getDay()]
    g.dow[d] = (g.dow[d] || 0) + 1
    const t = timeBand(a.start || 0)
    g.time[t] = (g.time[t] || 0) + 1
  }
  const total = list.length
  return Object.values(groups)
    .map((g) => ({
      reason: g.reason,
      side: SIDE_LABEL[g.reason === NOT_RECORDED ? 'unknown' : cancelSide(g.reason)],
      sessions: g.n,
      hours: Math.round((g.min / 60) * 10) / 10,
      share: total ? Math.round((g.n / total) * 100) : 0,
      topDay: top(g.dow, g.n),
      topTime: top(g.time, g.n),
    }))
    .sort((a, b) => (a.reason === NOT_RECORDED) - (b.reason === NOT_RECORDED) || b.sessions - a.sessions || (a.reason < b.reason ? -1 : 1))
}

/** Deterministic demo reason for seeded cancellations (no RNG, so the seed stream is untouched). */
export function seedCancelReason(status, clientId, dateISO) {
  if (status === 'no-show') return { cancelReasonId: 'opt-cancel-reasons-7', cancelReason: 'No reason given' }
  const pool = [
    ['opt-cancel-reasons-1', 'Client ill'], ['opt-cancel-reasons-1', 'Client ill'], ['opt-cancel-reasons-6', 'Transportation'],
    ['opt-cancel-reasons-2', 'Family emergency'], ['opt-cancel-reasons-3', 'School holiday'], ['opt-cancel-reasons-4', 'Staff illness'],
    ['opt-cancel-reasons-6', 'Transportation'], ['opt-cancel-reasons-5', 'Weather'],
  ]
  // Fridays skew to transport, the pattern the root-cause report is built to surface
  if (parseISO(dateISO).getDay() === 5) return { cancelReasonId: 'opt-cancel-reasons-6', cancelReason: 'Transportation' }
  let h = 0
  for (const ch of `${clientId}|${dateISO}`) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  const [id, label] = pool[h % pool.length]
  return { cancelReasonId: id, cancelReason: label }
}

// Demo notice spreads across both sides of the default 24 h line — some refillable, some
// too late — and leaves roughly one cancellation in ten with no time at all, because a
// saved workspace can hold those and the model must not guess for them either.
const SEED_EARLY_NOTICE_H = [30, 48, 72, 120]
const SEED_LATE_NOTICE_H = [1, 3, 8, 20]

/**
 * Deterministic demo notice for a seeded cancellation: the same `cancelledAt` instant
 * `stampCancelledAt` writes, set `hours` before the session. No RNG, so the seed stream is
 * untouched (the reason helper above relies on the same property). Returns undefined for
 * the sessions that carry no recorded time.
 */
export function seedCancelNotice(status, clientId, dateISO, startMin) {
  if (status !== 'cancelled') return undefined
  let h = 0
  for (const ch of `${clientId}|${dateISO}|notice`) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  const bucket = h % 10
  if (bucket === 0) return undefined
  const hours = bucket <= 4 ? SEED_EARLY_NOTICE_H[h % 4] : SEED_LATE_NOTICE_H[h % 4]
  return new Date(parseISO(dateISO).getTime() + (startMin - hours * 60) * 60000).toISOString()
}
