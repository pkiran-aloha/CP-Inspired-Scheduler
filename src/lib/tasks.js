// ---- Tasks and notifications: the in-workspace inbox ----
// Tasks are assigned to staff members, optionally linked to a client, claim or intake
// request, and closed when done. Notifications are not stored: they are read from the
// workspace (my tasks due, expiring documents and authorizations, overdue intake,
// denied claims) every time the inbox opens. Nothing is sent off this device.
import { cabinetAlerts } from './cabinet'
import { intakeKpis } from './intake'
import { parseISO } from './date'

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
export function notificationsFor(state, staffId, today, can = () => true) {
  const out = []
  const mine = staffId ? openTasksFor(state, staffId, today) : []
  const overdue = mine.filter((t) => taskState(t, today) === 'overdue')
  const dueToday = mine.filter((t) => taskState(t, today) === 'today')
  if (overdue.length) out.push({ id: 'tasks-overdue', tone: 'stop', text: `${overdue.length} of your tasks ${overdue.length > 1 ? 'are' : 'is'} overdue`, go: { tab: 'tasks' } })
  if (dueToday.length) out.push({ id: 'tasks-today', tone: 'warn', text: `${dueToday.length} task${dueToday.length > 1 ? 's' : ''} due today`, go: { tab: 'tasks' } })
  if (can('staff')) {
    const docs = cabinetAlerts(state, today)
    const expired = docs.filter((d) => d.expiresOn < today).length
    if (docs.length) out.push({ id: 'cabinet', tone: expired ? 'stop' : 'warn', text: `${docs.length} document${docs.length > 1 ? 's' : ''} expired or expiring within 30 days`, go: { section: 'cabinet' } })
  }
  if (can('clients')) {
    const ending = (state.clients || []).filter((c) => iso(c.authEnd) && daysBetween(today, c.authEnd) <= 30)
    const lapsed = ending.filter((c) => c.authEnd < today).length
    if (ending.length) out.push({ id: 'auths', tone: lapsed ? 'stop' : 'warn', text: `${ending.length} authorization${ending.length > 1 ? 's' : ''} lapsed or ending within 30 days`, go: { section: 'clients' } })
  }
  if (can('intake')) {
    const k = intakeKpis(state.intakeRequests || {})
    if (k.overdue.length) out.push({ id: 'intake', tone: 'warn', text: `${k.overdue.length} intake request${k.overdue.length > 1 ? 's' : ''} past their stage deadline`, go: { section: 'intake' } })
  }
  if (can('billing')) {
    const denied = Object.values(state.claims || {}).filter((c) => c.status === 'denied').length
    if (denied) out.push({ id: 'denied', tone: 'flag', text: `${denied} denied claim${denied > 1 ? 's' : ''} to work`, go: { section: 'billing' } })
  }
  return out
}
