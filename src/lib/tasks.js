// ---- Tasks and notifications: the in-workspace inbox ----
// Tasks are assigned to staff members, optionally linked to a client, claim or intake
// request, and closed when done. Notifications are not stored: they are read from the
// workspace (my tasks due, expiring documents and authorizations, overdue intake,
// denied claims) every time the inbox opens. Nothing is sent off this device.
// Every alert source is gated by its Settings → System → Notifications preference
// (audit CFG-08): a preference that is off suppresses its alert, and no preference
// is shown in Settings that has no alert behind it.
import { cabinetAlerts } from './cabinet'
import { intakeKpis } from './intake'
import { addDays, isoDate, parseISO } from './date'
import { notificationsCfg, isCancelStatus } from './settingsMasters'
import { filingDaysOf, secondaryEligible } from './claims'

export const TASK_PRIORITIES = [{ id: 'normal', label: 'Normal' }, { id: 'high', label: 'High' }]
export const LINK_KINDS = [
  { id: 'client', label: 'Client', coll: 'clients' },
  { id: 'claim', label: 'Claim', coll: 'claims' },
  { id: 'intake', label: 'Intake request', coll: 'intakeRequests' },
]
const iso = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''))
const daysBetween = (a, b) => Math.round((parseISO(b) - parseISO(a)) / 86400000)

const findLink = (state, link) => {
  const def = LINK_KINDS.find((k) => k.id === link?.kind)
  if (!def) return null
  const coll = state[def.coll]
  return Array.isArray(coll) ? coll.find((x) => x.id === link.id) : coll?.[link.id]
}
// The area a linked record lives in: a role that cannot open it sees no label and cannot link it.
export const LINK_AREA = { client: 'clients', claim: 'billing', intake: 'intake' }
export const linkLabel = (state, link, can = () => true) => {
  if (link && !can(LINK_AREA[link.kind])) return ''
  const rec = link ? findLink(state, link) : null
  if (!rec) return ''
  if (link.kind === 'client') return rec.name
  if (link.kind === 'claim') return `Claim ${rec.no}`
  return `Intake ${rec.no}`
}

/** 'overdue' | 'today' | 'upcoming' | 'none' (no due date) | 'done'. */
export function taskState(t, today) {
  if (t.status === 'done') return 'done'
  if (!iso(t.dueOn)) return 'none'
  const d = daysBetween(today, t.dueOn)
  return d < 0 ? 'overdue' : d === 0 ? 'today' : 'upcoming'
}

export function planTask(state, input = {}, { id, at = Date.now(), by = null, can = () => true } = {}) {
  const cur = input.id ? state.tasks?.[input.id] : null
  if (input.id && !cur) return { ok: false, msg: 'Task not found.' }
  const title = String(input.title || '').replace(/\s+/g, ' ').trim().slice(0, 140)
  if (title.length < 3) return { ok: false, msg: 'Describe the task (at least 3 characters).' }
  const assignee = (state.staff || []).find((s) => s.id === input.assigneeId)
  if (!assignee) return { ok: false, msg: 'Assign the task to a staff member.' }
  if (input.dueOn && !iso(input.dueOn)) return { ok: false, msg: 'Due date must be a date.' }
  if (!TASK_PRIORITIES.some((p) => p.id === (input.priority || 'normal'))) return { ok: false, msg: 'Choose a priority.' }
  const link = input.link?.kind && input.link?.id ? { kind: input.link.kind, id: input.link.id } : null
  if (link && !can(LINK_AREA[link.kind])) return { ok: false, msg: 'Your role cannot link a task to that kind of record.' }
  if (link && !findLink(state, link)) return { ok: false, msg: 'The linked record no longer exists.' }
  const item = {
    ...(cur || { id, status: 'open', createdAt: at, createdBy: by, doneAt: null, history: [] }),
    title, assigneeId: assignee.id, dueOn: input.dueOn || '', priority: input.priority || 'normal', link,
    notes: String(input.notes || '').trim().slice(0, 1000), updatedAt: at,
  }
  if (!item.id) return { ok: false, msg: 'Task id missing.' }
  item.history = [...(item.history || []), { at, by, ev: cur ? (cur.assigneeId !== item.assigneeId ? `Reassigned to ${assignee.name}` : 'Updated') : `Created for ${assignee.name}` }]
  return { ok: true, msg: cur ? 'Task updated.' : `Task added for ${assignee.name}. It shows in their inbox in this workspace; nothing was sent.`, item }
}

export function planTaskDone(state, id, done = true, { at = Date.now(), by = null } = {}) {
  const cur = state.tasks?.[id]
  if (!cur) return { ok: false, msg: 'Task not found.' }
  if ((cur.status === 'done') === done) return { ok: false, msg: done ? 'Already done.' : 'Already open.' }
  return { ok: true, msg: done ? `Done: ${cur.title}` : `Reopened: ${cur.title}`, item: { ...cur, status: done ? 'done' : 'open', doneAt: done ? at : null, updatedAt: at, history: [...(cur.history || []), { at, by, ev: done ? 'Marked done' : 'Reopened' }] } }
}

/** Open tasks (for one staff member, or everyone): overdue first, then by due date, undated last. */
export function openTasksFor(state, staffId, today) {
  const rank = { overdue: 0, today: 1, upcoming: 2, none: 3 }
  return Object.values(state.tasks || {})
    .filter((t) => t.status !== 'done' && (!staffId || t.assigneeId === staffId))
    .sort((a, b) => rank[taskState(a, today)] - rank[taskState(b, today)] || String(a.dueOn).localeCompare(String(b.dueOn)))
}

/**
 * The notification feed for one person, read fresh from the workspace. `can(area)` hides
 * what their role cannot open. Each item: { id, tone: 'stop' | 'warn' | 'flag', text, go }.
 */
/** Credential-expiry window in days, from the preference (legacy saves may hold '30d'). */
const qualWarnDays = (cfg) => {
  const d = parseInt(String(cfg.staffQualFrequencyDays ?? 30).replace(/[^\d]/g, ''), 10)
  return Number.isFinite(d) && d > 0 ? d : 30
}

/** Past clinical sessions still awaiting a completion status, within the lookback window. */
export function incompleteApptsFor(state, today, lookbackDays = 7) {
  const since = isoDate(addDays(parseISO(today), -Math.max(1, Number(lookbackDays) || 7)))
  return Object.values(state?.appts || {}).filter((a) =>
    a.date && a.date < today && a.date >= since &&
    (a.type === 'service' || a.type === 'evaluation') &&
    a.status !== 'completed' && !isCancelStatus(state?.settings, a.status))
}

/** Staged claims whose date-of-service window closed past the payer's filing limit. */
export function lateFilingClaimsFor(state, today) {
  return Object.values(state?.claims || {}).filter((c) => {
    if (!c.dosTo || c.submittedAt || ['denied', 'void', 'paid', 'written_off'].includes(c.status)) return false
    const limit = isoDate(addDays(parseISO(c.dosTo), filingDaysOf(state, c.payer)))
    return limit < today
  })
}

export function notificationsFor(state, staffId, today, can = () => true) {
  const out = []
  const cfg = notificationsCfg(state?.settings)
  const on = (v) => v !== false
  const plural = (k, word) => `${k} ${word}${k === 1 ? '' : 's'}`
  // An account not linked to a staff member (the practice administrator) oversees the whole team's tasks.
  const team = !staffId
  if (on(cfg.staffTasks)) {
    const mine = openTasksFor(state, staffId || null, today)
    const overdue = mine.filter((t) => taskState(t, today) === 'overdue')
    const dueToday = mine.filter((t) => taskState(t, today) === 'today')
    const n = (k) => `${k} ${team ? 'team ' : ''}task${k > 1 ? 's' : ''}`
    if (overdue.length) out.push({ id: 'tasks-overdue', tone: 'stop', text: team ? `${n(overdue.length)} ${overdue.length > 1 ? 'are' : 'is'} overdue` : `${overdue.length} of your tasks ${overdue.length > 1 ? 'are' : 'is'} overdue`, go: { tab: 'tasks' } })
    if (dueToday.length) out.push({ id: 'tasks-today', tone: 'warn', text: `${n(dueToday.length)} due today`, go: { tab: 'tasks' } })
  }
  if (can('staff') && on(cfg.staffQualExpiration)) {
    const docs = cabinetAlerts(state, today, qualWarnDays(cfg))
    const expired = docs.filter((d) => d.expiresOn < today).length
    if (docs.length) out.push({ id: 'cabinet', tone: expired ? 'stop' : 'warn', text: `${plural(docs.length, 'document')} expired or expiring within ${qualWarnDays(cfg)} days`, go: { section: 'cabinet' } })
  }
  if (can('staff') && on(cfg.staffIncompleteAppts)) {
    const stale = incompleteApptsFor(state, today, cfg.staffIncompleteLookbackDays)
    if (stale.length) out.push({ id: 'incomplete', tone: 'warn', text: `${plural(stale.length, 'session')} from the last ${cfg.staffIncompleteLookbackDays ?? 7} days still awaiting completion`, go: { section: 'calendar' } })
  }
  if (can('clients') && on(cfg.authExpiry)) {
    const ending = (state.clients || []).filter((c) => iso(c.authEnd) && daysBetween(today, c.authEnd) <= 30)
    const lapsed = ending.filter((c) => c.authEnd < today).length
    if (ending.length) out.push({ id: 'auths', tone: lapsed ? 'stop' : 'warn', text: `${plural(ending.length, 'authorization')} lapsed or ending within 30 days`, go: { section: 'clients' } })
  }
  if (on(cfg.timelyFiling)) {
    const late = lateFilingClaimsFor(state, today)
    if (late.length) out.push({ id: 'filing', tone: 'stop', text: `${plural(late.length, 'claim')} past its filing window — file or write off`, go: { section: 'billing' } })
  }
  if (can('billing') && on(cfg.parkedEra)) {
    const parked = Object.values(state.payments || {}).filter((p) => p.kind === 'unapplied' && !p.reversalOf)
    if (parked.length) out.push({ id: 'parked', tone: 'warn', text: `${plural(parked.length, 'unapplied payment')} waiting to be matched`, go: { section: 'billing' } })
  }
  if (can('billing') && on(cfg.secondaryReady)) {
    const ready = Object.values(state.claims || {}).filter((c) => secondaryEligible(state, c))
    if (ready.length) out.push({ id: 'secondary', tone: 'flag', text: `${plural(ready.length, 'primary claim')} ready for secondary filing`, go: { section: 'billing' } })
  }
  if (can('intake') && on(cfg.intakeSla)) {
    const k = intakeKpis(state.intakeRequests || {})
    if (k.overdue.length) out.push({ id: 'intake', tone: 'warn', text: `${plural(k.overdue.length, 'intake request')} past their stage deadline`, go: { section: 'intake' } })
  }
  if (can('billing') && on(cfg.deniedClaims)) {
    const denied = Object.values(state.claims || {}).filter((c) => c.status === 'denied').length
    if (denied) out.push({ id: 'denied', tone: 'flag', text: `${plural(denied, 'denied claim')} to work`, go: { section: 'billing' } })
  }
  return out
}
