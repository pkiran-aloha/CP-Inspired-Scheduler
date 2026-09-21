/* ============================================================================
 * Appointment naming conventions — Aloha ABA
 * ----------------------------------------------------------------------------
 * Schedules are only as good as their scannability. The industry convention
 * across EHR and ABA scheduling platforms (chart-first, sortable, code-aware)
 * is: CLIENT — SERVICE · TIME, with optional assigned-crew suffix.
 *
 * Three supported styles, chosen in Settings → Appointment naming:
 *   ehr   Chart style     “Reyes, Ana — Service · 9–10 AM”     (default; alphabetical scanning)
 *   plain Display style   “Ana Reyes — Service · 9–10 AM”      (front-desk friendly)
 *   code  Code-first      “253T · Reyes, A. · 9–10 AM”         (billing-oriented)
 *
 * Multi-client groups follow the standard “+n” suffix (e.g. “Reyes, Ana +2”).
 * The auto-title is a STARTING point — user-entered titles are never rewritten.
 * `LEGACY_TITLE_RE` matches the old “(Type) 9 AM - 10 AM” generator so Settings
 * can offer a one-click restyle of auto-titles only.
 * ==========================================================================*/

import { fmtTime } from './date'
import { TYPES } from './model'
import { SVC_LABEL, SVC_CODE } from './seed'

export const NAME_STYLES = {
  ehr: { label: 'Chart', desc: 'Last, First — Service · Time — the EHR scanning convention, sorts alphabetically' },
  plain: { label: 'Display', desc: 'First Last — Service · Time — friendlier for shared staff calendars' },
  code: { label: 'Code-first', desc: 'CPT/category · Last, F. · Time — billing-oriented boards' },
}

/* category codes: real CPT for billable 1:1 service time; short labels otherwise */
const CODE = { service: '253T', evaluation: 'Assess', supervision: 'Supv', drive: 'Drive', break: 'Break', unavailable: 'Block', blocked: 'Block', reminder: 'Remind' }

export const LEGACY_TITLE_RE = /^\([^)]*\)\s?\d/

export function clientLabel(client, style = 'ehr') {
  if (!client) return ''
  const name = String(client.name || '').trim()
  if (style === 'plain' || !name) return name
  const parts = name.split(/\s+/)
  const first = parts[0]
  const last = parts.length > 1 ? parts[parts.length - 1] : ''
  if (!last) return first
  return style === 'code' ? `${last}, ${first[0]}.` : `${last}, ${first}`
}

/* "9 AM–10 AM" collapses to "9–10 AM" when the meridiem matches */
export function fmtRange(start, end, h24 = false) {
  const a = fmtTime(start, h24)
  const b = fmtTime(end, h24)
  if (h24) return `${a}–${b}`
  const am = (s) => s.replace(/ [AP]M$/, '')
  const suf = (s) => s.slice(-2)
  return suf(a) === suf(b) ? `${am(a)}–${am(b)} ${suf(a)}` : `${a}–${b}`
}

function crewLabel(s) {
  if (!s) return ''
  const parts = String(s.name || '').trim().split(/\s+/)
  const first = parts[0] || ''
  const lastInit = parts.length > 1 ? ` ${parts[parts.length - 1][0]}.` : ''
  const role = s.role ? String(s.role).split(' · ')[0].trim() : ''
  return `${first}${lastInit}${role ? `, ${role}` : ''}`
}

/**
 * Canonical auto-title for an appointment-shaped record.
 * Extra `clients` / `staff` are id→entity maps (state shape).
 */
export function apptAutoTitle({ type, clientIds = [], staffIds = [], start = 0, end = 0, clients = {}, staff = {}, settings = {}, styleOverride, includeStaffOverride, serviceOverride, locationOverride } = {}) {
  const style = styleOverride || settings.apptNameStyle || 'ehr'
  const includeStaff = includeStaffOverride ?? settings.apptNameStaff ?? false
  const ex = settings.apptTitleExtras || {}
  const svcKey = serviceOverride || ''
  const svc = TYPES[type]?.label || (type ? type[0].toUpperCase() + type.slice(1) : 'Appointment')
  // with the Service extra on, a curated service line replaces the generic type label
  const svcText = ex.service && svcKey ? SVC_LABEL[svcKey] || svcKey : svc
  const cs = (clientIds || []).map((id) => clients[id]).filter(Boolean)
  const who = cs.length ? `${clientLabel(cs[0], style)}${cs.length > 1 ? ` +${cs.length - 1}` : ''}` : ''
  const prog = ex.program ? cs[0]?.program || '' : ''
  const head = [who, prog].filter(Boolean).join(' · ')
  const time = fmtRange(start, end, settings.h24)
  const loc = ex.location && locationOverride ? ` @ ${locationOverride}` : ''
  let crew = ''
  if (includeStaff && staffIds?.length) {
    const names = (staffIds || []).map((id) => crewLabel(staff[id])).filter(Boolean)
    if (names.length) crew = ` (${names.slice(0, 2).join(', ')}${names.length > 2 ? ` +${names.length - 2}` : ''})`
  }
  if (style === 'code') {
    const code = (ex.service && svcKey && SVC_CODE[svcKey]) || CODE[type] || svc
    return `${code}${head ? ` · ${head}` : ''} · ${time}${loc}${crew}`
  }
  return `${head ? `${head} — ` : ''}${svcText} · ${time}${loc}${crew}`
}

/* ---------- title health ---------- */
/* a title needs rework when it is legacy-shaped, blank, or too long for agenda rows */
export function needsRework(a) {
  const t = String(a?.title ?? '').trim()
  return LEGACY_TITLE_RE.test(String(a?.title ?? '')) || !t || t.length > 72
}

export function titleAudit(appts) {
  const legacy = [], untitled = [], long = []
  for (const a of Object.values(appts)) {
    const raw = String(a.title ?? '')
    const t = raw.trim()
    if (LEGACY_TITLE_RE.test(raw)) legacy.push(a.id)
    else if (!t) untitled.push(a.id)
    else if (t.length > 72) long.push(a.id)
  }
  return { legacy, untitled, long, total: legacy.length + untitled.length + long.length }
}
