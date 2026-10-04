// ---- Messages between signed-in accounts, stored in this workspace only ----
// A message belongs to a thread (the first message's id), has a sender account and one or
// more recipient accounts, and records who has read it. Nothing is emailed or texted: the
// recipient sees it in their Inbox when they use this workspace. Threads are listed only
// to their participants; on a shared device the data itself is in the browser's storage.
export const threadOf = (m) => m.threadId || m.id

const accountsOf = (state) => (state.security?.accounts || []).filter((a) => a.status === 'active')
export const accountName = (state, id) => {
  const a = (state.security?.accounts || []).find((x) => x.id === id)
  if (!a) return 'Unknown user'
  const person = a.staffId ? (state.staff || []).find((s) => s.id === a.staffId) : null
  return person?.name || a.name || a.email || 'User'
}
export const recipientsFor = (state, me) => accountsOf(state).filter((a) => a.id !== me)

export function planMessage(state, input = {}, { id, at = Date.now(), from } = {}) {
  if (!from || !accountsOf(state).some((a) => a.id === from)) return { ok: false, msg: 'Sign in as an active user to send messages.' }
  const prior = input.threadId ? Object.values(state.messages || {}).filter((m) => threadOf(m) === input.threadId) : []
  if (input.threadId && !prior.length) return { ok: false, msg: 'Conversation not found.' }
  if (prior.length && !prior.some((m) => m.fromId === from || m.toIds.includes(from))) return { ok: false, msg: 'You are not part of this conversation.' }
  // a reply goes to everyone else in the thread
  const toIds = prior.length
    ? [...new Set(prior.flatMap((m) => [m.fromId, ...m.toIds]))].filter((x) => x !== from)
    : [...new Set(input.toIds || [])].filter((x) => x && x !== from)
  if (!toIds.length) return { ok: false, msg: 'Choose who the message is for.' }
  if (toIds.some((x) => !accountsOf(state).some((a) => a.id === x))) return { ok: false, msg: 'A recipient is not an active user.' }
  const subject = prior.length ? prior[0].subject : String(input.subject || '').replace(/\s+/g, ' ').trim().slice(0, 120)
  if (subject.length < 2) return { ok: false, msg: 'Give the message a subject.' }
  const body = String(input.body || '').trim().slice(0, 4000)
  if (!body) return { ok: false, msg: 'Write a message.' }
  if (!id) return { ok: false, msg: 'Message id missing.' }
  const item = { id, threadId: prior.length ? input.threadId : id, fromId: from, toIds, subject, body, at, readBy: [from] }
  return { ok: true, msg: `Message sent to ${toIds.map((x) => accountName(state, x)).join(', ')} in this workspace. Nothing was emailed.`, item }
}

/** Conversations I am part of, newest first, with my unread count. */
export function threadsFor(state, me) {
  const byThread = {}
  for (const m of Object.values(state.messages || {})) {
    if (m.fromId !== me && !(m.toIds || []).includes(me)) continue
    ;(byThread[threadOf(m)] ||= []).push(m)
  }
  return Object.entries(byThread).map(([threadId, list]) => {
    list.sort((a, b) => a.at - b.at)
    const last = list[list.length - 1]
    const people = [...new Set(list.flatMap((m) => [m.fromId, ...m.toIds]))].filter((x) => x !== me)
    return { threadId, subject: list[0].subject, messages: list, last, people, unread: list.filter((m) => !(m.readBy || []).includes(me)).length }
  }).sort((a, b) => b.last.at - a.last.at)
}
export const unreadCount = (state, me) => (me ? threadsFor(state, me).reduce((t, th) => t + th.unread, 0) : 0)

/** The messages in a thread that `me` has not read yet, marked read. */
export const readUpdates = (state, threadId, me) => Object.values(state.messages || {})
  .filter((m) => threadOf(m) === threadId && (m.toIds || []).includes(me) && !(m.readBy || []).includes(me))
  .map((m) => ({ ...m, readBy: [...(m.readBy || []), me] }))
