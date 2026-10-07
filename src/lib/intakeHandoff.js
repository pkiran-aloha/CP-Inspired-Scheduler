// Reviewed first-week proposals. No writes, recurrence, or inferred family availability.
import { addDays, isoDate, parseISO, todayISO } from './date'
import { authBurn, authCheckFor, authWeekOf } from './authBudget'
import { mergeAuthChecks, unitCheckFor, unitLedger, unitRuleFor, unitsFor } from './authUnits'
import { suggestStaff, smartCfg, weekLoad } from './smart'
import { svcOptionsFor } from './master'
import { evaluateAppointmentValidations, isCancelStatus, locationOptions } from './settingsMasters'
import { findConflicts } from './model'

const validDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && isoDate(parseISO(s)) === s
const linked = (state, clientId) => {
  const client = state.clients.find((c) => c.id === clientId)
  const request = state.intakeRequests?.[client?.intakeId]
  return client && request?.stage === 'converted' && request.clientId === client.id ? { client, request } : null
}
const liveAppts = (state) => Object.fromEntries(Object.entries(state.appts || {}).filter(([, a]) => !isCancelStatus(state.settings, a.status)))
const checks = (state, client, draft, today) => {
  const rules = evaluateAppointmentValidations(state, draft)
  const auth = mergeAuthChecks(authCheckFor(state, client, draft, { today }), unitCheckFor(state, client, draft, { today }), state.settings)
  return { blocked: rules.stops.length > 0 || auth.blocked, messages: [...rules.items.map((x) => `${x.label}: ${x.message}`), ...auth.reasons, ...auth.notes] }
}
const clashes = (state, draft) => findConflicts(state.appts, draft,
  Object.fromEntries(state.staff.map((s) => [s.id, s])), Object.fromEntries(state.clients.map((c) => [c.id, c])),
  (s) => isCancelStatus(state.settings, s))

export function handoffServices(state, clientId) {
  const client = state.clients.find((c) => c.id === clientId)
  return svcOptionsFor(state, [clientId]).filter((s) => Number(client?.authUnits?.[s.code]) > 0)
}

/** One slot per selected weekday, filling only the weekly gap; ranked staff per slot.
 * Proposed earlier slots participate in subsequent authorization and load checks.
 * The chosen week follows the practice's week-start setting, not a rolling seven days.
 */
export function proposeIntakeWeek(state, clientId, options = {}, { today = todayISO() } = {}) {
  const fail = (msg) => ({ ok: false, msg, rows: [] })
  const link = linked(state, clientId)
  if (!link) return fail('A converted intake and its linked client chart are required.')
  const { client } = link
  const { date, days = [1, 2, 3, 4, 5], start = 540, duration = 120, service, location } = options
  if (!validDate(date)) return fail('Choose a valid date in the week to plan.')
  if (!Array.isArray(days) || !days.length || days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) return fail('Choose at least one weekday.')
  if (!Number.isInteger(start) || start < 0 || !Number.isInteger(duration) || duration < 15 || duration % 15 || start + duration > 1440) return fail('Use a valid start time and a session length in 15-minute steps within one day.')
  if (!validDate(client.authStart) || !validDate(client.authEnd) || client.authStart > client.authEnd || !(Number(client.authWeekly) > 0)) return fail('Record a valid authorization window and weekly hours on the client chart first.')
  const svc = handoffServices(state, clientId).find((s) => s.id === service)
  if (!svc) return fail('Choose an active service with units on this client’s authorization. Verify the code against the payer letter.')
  if (!locationOptions(state.settings).includes(location)) return fail('Choose an active service location.')
  const week = authWeekOf(date, state.settings.weekStart)
  const dates = Array.from({ length: 7 }, (_, i) => isoDate(addDays(parseISO(week.start), i)))
  const working = { ...state, appts: liveAppts(state) }
  const burn = authBurn(working, clientId, { today, on: date })
  const targetMinutes = Math.floor(Number(client.authWeekly) * 60)
  const existingMinutes = Math.round(burn.week.hours * 60)
  let remaining = Math.max(0, targetMinutes - existingMinutes)
  const rows = []
  for (const day of dates) {
    if (!days.includes(parseISO(day).getDay()) || day < today || day < client.authStart || day > client.authEnd || remaining < 15) continue
    const length = Math.min(duration, Math.floor(remaining / 15) * 15)
    const draft = { id: `handoff-${clientId}-${day}`, type: 'service', date: day, start, end: start + length,
      clientIds: [clientId], staffIds: [], status: 'active', service, billingCode: svc.code, location, repeat: 'none' }
    const row = { date: day, draft, candidates: [], reason: '' }
    if (clashes(working, draft).length) row.reason = 'Client already booked or unavailable at this time.'
    const rule = unitRuleFor(working, draft)
    const pool = unitLedger(working, client, { today }).codes.find((r) => r.code === svc.code)
    if (!row.reason && unitsFor(length, rule.unitMins, rule.rounding) > (pool?.remaining || 0)) row.reason = 'Not enough remaining authorized units for this session length.'
    if (!row.reason) {
      const ranked = suggestStaff({ staff: state.staff.filter((s) => s.status !== 'inactive' && s.active !== false),
        teams: state.teams, clients: state.clients, appts: working.appts, clientIds: [clientId], date: day, start, end: draft.end,
        code: svc.code, sameSite: location, weekDays: dates, load: weekLoad(working.appts, dates), limit: state.staff.length,
        cfg: { ...smartCfg(state.settings), backfill: { ...smartCfg(state.settings).backfill, sameTeamOnly: false } } })
      const rejected = []
      for (const candidate of ranked) {
        const check = checks(working, client, { ...draft, staffIds: [candidate.staff.id] }, today)
        if (check.blocked) { rejected.push(...check.messages); continue }
        row.candidates.push({ ...candidate, warnings: [...new Set([...candidate.warnings, ...check.messages])] })
        if (row.candidates.length === 3) break
      }
      if (!row.candidates.length) row.reason = rejected.length ? `No candidate passes Stop rules. ${[...new Set(rejected)].join(' ')}` : 'No available staff at this time.'
    }
    rows.push(row)
    if (row.candidates.length) {
      working.appts = { ...working.appts, [draft.id]: { ...draft, staffIds: [row.candidates[0].staff.id] } }
      remaining -= length
    }
  }
  return { ok: true, rows, week, targetMinutes, existingMinutes, proposedMinutes: Math.max(0, targetMinutes - existingMinutes - remaining),
    remainingMinutes: remaining, msg: rows.length ? 'Review each proposed session before booking.' : remaining < 15 ? 'The weekly target is already covered (or less than 15 minutes remain).' : 'No selected dates remain in this week within the authorization window.' }
}

/** Replanned by the transaction against live, unscoped state before saving. */
export function planHandoffSession(state, clientId, input, { today = todayISO() } = {}) {
  const fail = (msg) => ({ ok: false, msg })
  const link = linked(state, clientId)
  if (!link) return fail('The converted intake or linked client is no longer available.')
  if (!input?.id || state.appts[input.id]) return fail('This appointment was already saved. Refresh the proposal.')
  if (input.type !== 'service' || input.clientIds?.length !== 1 || input.clientIds[0] !== clientId || !input.staffIds?.length || input.staffIds.some((id) => !state.staff.some((s) => s.id === id))) return fail('Keep the linked client and select an existing clinician for this service session.')
  if (!validDate(input.date) || input.date < today || !Number.isInteger(input.start) || !Number.isInteger(input.end) || input.start < 0 || input.end > 1440 || input.end <= input.start) return fail('Choose a valid future date and time range.')
  if ((input.recurrence && input.recurrence !== 'none') || input.rrule || input.seriesId) return fail('Review one occurrence at a time for the first-week handoff.')
  if (isCancelStatus(state.settings, input.status)) return fail('Choose a non-cancelled status to book this handoff session.')
  if (!svcOptionsFor(state, [clientId]).some((s) => s.id === input.service) || !locationOptions(state.settings).includes(input.location)) return fail('Choose an active service and service location before booking.')
  const appt = { ...input, intakeId: link.request.id }
  const current = { ...state, appts: liveAppts(state) }
  if (Object.values(current.appts).some((a) => a.type === 'service' && a.clientIds?.includes(clientId) && a.date === appt.date && a.start === appt.start && a.end === appt.end)) return fail('This client already has a service session in that exact slot. Refresh the proposal.')
  const check = checks(current, link.client, appt, today)
  if (check.blocked) return fail(`Not booked. ${check.messages.join(' ')}`)
  return { ok: true, appt, msg: `Session booked locally.${check.messages.length ? ` Review: ${check.messages.join(' ')}` : ''}` }
}
