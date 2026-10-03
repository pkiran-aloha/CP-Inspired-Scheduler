// ---- Booking checks per candidate: know before you pick ----
//
// The booking dialog used to judge a session only after a staff member or client was
// added, so a scheduler could pick three people in a row who were each already busy,
// not credentialed for the code, or out of authorization. This module answers, for
// every person in a picker, "what happens if I add them to this slot?" — using the same
// engines the dialog already trusts:
//
//   staff   · calendar clash (findConflicts) · credential vs code (claims) · practice
//             validation rules that the person would newly trigger
//   clients · calendar clash · authorization hours + units + payer rules
//             (authCheckFor + unitCheckFor) · newly triggered practice rules
//
// Pure: no React, no store. Nothing here blocks a booking; the dialog's guard decides.

import { findConflicts } from './model'
import { credOf, credentialIssue } from './claims'
import { authCheckFor } from './authBudget'
import { mergeAuthChecks, unitCheckFor } from './authUnits'
import { evaluateAppointmentValidations, isCancelStatus } from './settingsMasters'
import { fmtTime } from './date'

export const TONE_RANK = { ok: 0, flag: 1, warn: 2, stop: 3 }
const CLINICAL = ['service', 'evaluation', 'supervision']
const worst = (list) => list.reduce((w, x) => (!w || TONE_RANK[x.tone] > TONE_RANK[w.tone] ? x : w), null)

/** A two-or-three word chip for an authorization reason; the full sentence stays in `detail`. */
export function authChip(text) {
  const t = String(text || '')
  if (/after the authorization ends/.test(t)) return 'Auth ended'
  if (/before the authorization starts/.test(t)) return 'Before auth start'
  if (/No authorization window/.test(t)) return 'No auth on file'
  if (/is not on this client's authorization/.test(t)) return `${t.split(' ')[0]} not authorized`
  if (/over by|Spends past/.test(t)) return 'Over authorization'
  if (/MUE|weekly limit/.test(t)) return 'Payer limit'
  if (/requires a|not a credential/.test(t)) return 'Credential'
  if (/expires/.test(t)) return 'Auth expiring'
  if (/% of the authoriz/.test(t)) return 'Auth nearly used'
  if (/h booked in the week/.test(t)) return 'Over weekly hours'
  return 'Authorization'
}

const clashChip = (c, h24) => (c.other.type === 'unavailable' ? 'Unavailable' : `Busy ${fmtTime(c.other.start, h24)}–${fmtTime(c.other.end, h24)}`)

/**
 * Verdicts for every candidate in one picker.
 * @param kind 'staff' | 'clients'
 * @returns { [personId]: { tone, label, detail, count } } — empty when the slot has no date/time yet
 */
export function candidateVerdicts(state, draft, kind, { today, h24 = false } = {}) {
  if (!draft?.date || !(draft.end > draft.start)) return {}
  const people = kind === 'staff' ? state.staff || [] : state.clients || []
  const staffById = Object.fromEntries((state.staff || []).map((s) => [s.id, s]))
  const clientsById = Object.fromEntries((state.clients || []).map((c) => [c.id, c]))
  const dead = (k) => isCancelStatus(state.settings, k)
  if (dead(draft.status)) return {}
  const id = draft.id || '__draft__'
  const clinical = CLINICAL.includes(draft.type)
  const code = clinical ? draft.billingCode || draft.billing?.code || '' : ''
  const baseRules = new Set(evaluateAppointmentValidations(state, { ...draft, id }).items.map((i) => `${i.id}|${i.message}`))
  const out = {}

  for (const p of people) {
    const issues = []
    // 1 · the calendar: is this person already booked across the slot?
    const solo = kind === 'staff' ? { ...draft, id, staffIds: [p.id], clientIds: [] } : { ...draft, id, staffIds: [], clientIds: [p.id] }
    const clash = findConflicts(state.appts || {}, solo, staffById, clientsById, dead)[0]
    if (clash) issues.push({ tone: 'warn', label: clashChip(clash, h24), detail: `Already on “${clash.other.title || 'another appointment'}” ${fmtTime(clash.other.start, h24)}–${fmtTime(clash.other.end, h24)}.` })

    // 2 · who may render the code (staff) / the authorization (clients)
    if (kind === 'staff' && code) {
      const issue = credentialIssue(code, credOf(p.role))
      if (issue) issues.push({ tone: 'warn', label: `Can't render ${code}`, detail: `${issue}.` })
    }
    if (kind === 'clients' && clinical) {
      const d = { ...draft, id, clientIds: [p.id] }
      const auth = mergeAuthChecks(authCheckFor(state, p, d, { today }), unitCheckFor(state, p, d, { today }), state.settings)
      if (auth.severity !== 'ok' && auth.reasons.length) {
        issues.push({ tone: auth.severity, label: authChip(auth.reasons[0]), detail: auth.reasons.join(' ') })
      }
    }

    // 3 · practice rules this person would newly trigger
    const withP = kind === 'staff'
      ? { ...draft, id, staffIds: [...(draft.staffIds || []).filter((x) => x !== p.id), p.id] }
      : { ...draft, id, clientIds: [...(draft.clientIds || []).filter((x) => x !== p.id), p.id] }
    for (const it of evaluateAppointmentValidations(state, withP).items) {
      if (baseRules.has(`${it.id}|${it.message}`)) continue
      issues.push({ tone: it.severity === 'stop' ? 'stop' : it.severity === 'warn' ? 'warn' : 'flag', label: it.label, detail: it.message })
    }

    const w = worst(issues)
    out[p.id] = w
      ? { tone: w.tone, label: w.label, detail: issues.map((x) => x.detail).join(' '), count: issues.length }
      : { tone: 'ok', label: kind === 'staff' ? 'Free' : 'Clear', detail: 'Nothing on the calendar, authorization or practice rules stands in the way.', count: 0 }
  }
  return out
}
