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

import { listOptions } from './settingsMasters'
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
