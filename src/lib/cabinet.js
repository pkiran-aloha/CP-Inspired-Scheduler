// ---- Cabinet: the practice's register of documents that expire ----
// Metadata only: what the document is, whose it is, its reference and when it expires.
// No file is uploaded or stored. Expiry drives the alerts on the Staff rail badge and
// the Cabinet screen. Records are archived, never deleted, so the history stays.
import { parseISO } from './date'

export const CABINET_CATEGORIES = ['Credential / certification', 'License', 'Background check', 'CPR / first aid', 'Liability insurance', 'Training', 'Client consent', 'Client authorization letter', 'Policy / contract', 'Other']
export const CABINET_OWNERS = [
  { id: 'staff', label: 'Staff member' },
  { id: 'client', label: 'Client' },
  { id: 'practice', label: 'Practice' },
]
export const DEFAULT_WARN_DAYS = 30

const iso = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''))
const daysBetween = (a, b) => Math.round((parseISO(b) - parseISO(a)) / 86400000)

/** 'expired' | 'due' (within the warning window) | 'ok' | 'none' (no expiry recorded). */
export function expiryState(doc, today, warnDays = DEFAULT_WARN_DAYS) {
  if (!iso(doc.expiresOn)) return 'none'
  const left = daysBetween(today, doc.expiresOn)
  if (left < 0) return 'expired'
  return left <= warnDays ? 'due' : 'ok'
}
export const daysLeft = (doc, today) => (iso(doc.expiresOn) ? daysBetween(today, doc.expiresOn) : null)

export function ownerName(state, doc) {
  if (doc.ownerKind === 'staff') return (state.staff || []).find((s) => s.id === doc.ownerId)?.name || 'Unknown staff member'
  if (doc.ownerKind === 'client') return (state.clients || []).find((c) => c.id === doc.ownerId)?.name || 'Unknown client'
  return state.settings?.org?.name || 'Practice'
}

/** Live (not archived) documents that are expired or inside the warning window, soonest first. */
export function cabinetAlerts(state, today, warnDays = DEFAULT_WARN_DAYS) {
  return Object.values(state?.cabinet || {})
    .filter((d) => !d.archived && ['expired', 'due'].includes(expiryState(d, today, warnDays)))
    .sort((a, b) => (a.expiresOn < b.expiresOn ? -1 : 1))
}

/** Validate a document record before it is saved (new or edited). */
export function planCabinetDoc(state, input = {}, { id, at = Date.now(), by = null } = {}) {
  const cur = input.id ? state.cabinet?.[input.id] : null
  if (input.id && !cur) return { ok: false, msg: 'Document not found.' }
  const title = String(input.title || '').replace(/\s+/g, ' ').trim().slice(0, 120)
  if (title.length < 3) return { ok: false, msg: 'Name the document (at least 3 characters).' }
  if (!CABINET_CATEGORIES.includes(input.category)) return { ok: false, msg: 'Choose a category.' }
  if (!CABINET_OWNERS.some((o) => o.id === input.ownerKind)) return { ok: false, msg: 'Choose whose document it is.' }
  if (input.ownerKind === 'staff' && !(state.staff || []).some((s) => s.id === input.ownerId)) return { ok: false, msg: 'Choose the staff member.' }
  if (input.ownerKind === 'client' && !(state.clients || []).some((c) => c.id === input.ownerId)) return { ok: false, msg: 'Choose the client.' }
  if (input.issuedOn && !iso(input.issuedOn)) return { ok: false, msg: 'Issued date must be a date.' }
  if (!iso(input.expiresOn) && !input.noExpiry) return { ok: false, msg: 'Enter the expiry date, or tick "Does not expire".' }
  if (!input.noExpiry && iso(input.issuedOn) && input.expiresOn <= input.issuedOn) return { ok: false, msg: 'Expiry must be after the issued date.' }
  const item = {
    ...(cur || { id, createdAt: at, archived: false, history: [] }),
    title, category: input.category, ownerKind: input.ownerKind, ownerId: input.ownerKind === 'practice' ? null : input.ownerId,
    issuedOn: iso(input.issuedOn) ? input.issuedOn : '', expiresOn: input.noExpiry ? '' : input.expiresOn,
    reference: String(input.reference || '').trim().slice(0, 80), notes: String(input.notes || '').trim().slice(0, 500),
    updatedAt: at,
  }
  if (!item.id) return { ok: false, msg: 'Document id missing.' }
  item.history = [...(item.history || []), { at, by, ev: cur ? `Updated${cur.expiresOn !== item.expiresOn ? `: expiry ${cur.expiresOn || 'none'} → ${item.expiresOn || 'none'}` : ''}` : `Added (expires ${item.expiresOn || 'never'})` }]
  return { ok: true, msg: `${title} ${cur ? 'updated' : 'added to the cabinet'}.`, item }
}

export function planCabinetArchive(state, id, { at = Date.now(), by = null, archived = true } = {}) {
  const cur = state.cabinet?.[id]
  if (!cur) return { ok: false, msg: 'Document not found.' }
  if (Boolean(cur.archived) === archived) return { ok: false, msg: archived ? 'Already archived.' : 'Not archived.' }
  return { ok: true, msg: `${cur.title} ${archived ? 'archived; it no longer raises alerts' : 'restored'}.`, item: { ...cur, archived, updatedAt: at, history: [...(cur.history || []), { at, by, ev: archived ? 'Archived' : 'Restored' }] } }
}
