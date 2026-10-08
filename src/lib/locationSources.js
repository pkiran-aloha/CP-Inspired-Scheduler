// ---- Appointment location suggestions ----
// Pure, no React. The booking dialog's Location field offers these, grouped by where
// each one came from; anything typed is kept as typed. Nothing here calls a map
// service: `mapsUrlFor` only builds a Google Maps search link the user opens
// themselves. Add a source by appending a provider to SOURCES.

import { fmtTime } from './date'
import { isCancelStatus, settingsOffices } from './settingsMasters'

// The saved value for a client's street address. The "Home · " prefix is load-bearing:
// place of service (`posFor`) reads "home" as POS 12, and travel uses the client's geo.
export const HOME_PREFIX = 'Home · '
const NOT_A_STOP = new Set(['drive', 'break', 'unavailable'])
const TELE = /telehealth|video|remote/i

const addressOf = (r) => [r?.street || r?.address, [r?.city, [r?.state, r?.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ')].filter(Boolean).join(', ')
const firstName = (n) => String(n || '').split(' ')[0] || 'Staff'

/** The client's usual site and street address on file. */
function clientSources(state, draft) {
  const out = []
  for (const cid of draft.clientIds || []) {
    const c = (state.clients || []).find((x) => x.id === cid)
    if (!c) continue
    const who = (draft.clientIds || []).length > 1 ? `${firstName(c.name)}: ` : ''
    if (c.home) out.push({ value: c.home, sub: `${who}Client's usual site`, group: 'Client', source: 'client-site' })
    if (c.street) out.push({ value: HOME_PREFIX + addressOf(c), sub: `${who}Client home address`, group: 'Client', source: 'client-home' })
  }
  return out
}

/**
 * Where each picked staff member was just before this slot: their latest session that
 * ends by the draft's start (the same day when there is one, else the most recent
 * earlier day). Cancelled sessions and drive/break/unavailable blocks are skipped.
 */
function staffPreviousSources(state, draft) {
  if (!draft.date || !Number.isFinite(draft.start)) return []
  const settings = state.settings || {}
  const before = (a) => a.date < draft.date || (a.date === draft.date && a.end <= draft.start)
  const later = (a, b) => a.date > b.date || (a.date === b.date && a.end > b.end)
  const out = []
  for (const sid of draft.staffIds || []) {
    let best = null // ponytail: scans every appointment per staff; index by staff if workspaces grow large
    for (const a of Object.values(state.appts || {})) {
      if (a.id === draft.id || !a.location || !Number.isFinite(a.end) || NOT_A_STOP.has(a.type) || !(a.staffIds || []).includes(sid)) continue
      if (isCancelStatus(settings, a.status) || !before(a)) continue
      if (!best || later(a, best)) best = a
    }
    if (!best) continue
    const s = (state.staff || []).find((x) => x.id === sid)
    const at = fmtTime(best.start, !!settings.h24)
    const sub = best.date === draft.date ? `After ${firstName(s?.name)}'s ${at}` : `${firstName(s?.name)}'s last stop, ${best.date} ${at}`
    out.push({ value: best.location, sub, group: 'Staff', source: 'staff-prev' })
  }
  return out
}

/** Active practice offices marked as locations; the telehealth row gets its own group. */
function officeSources(state) {
  return settingsOffices(state.settings)
    .filter((o) => o.name && o.active !== false && o.isLocation !== false && !o.excludeFromLocations)
    .map((o) => (/telehealth/i.test(o.type) || TELE.test(o.name)
      ? { value: o.name, sub: 'Telehealth', group: 'Telehealth', source: 'telehealth' }
      : { value: o.name, sub: addressOf(o) || o.type || 'Office', group: 'Office', source: 'office' }))
}

export const SOURCES = [clientSources, staffPreviousSources, officeSources]

/**
 * Suggestions for a draft `{ id, date, start (minutes), clientIds, staffIds }`, in source order,
 * each `{ value, label, sub, group, source }`. A value offered by an earlier source is
 * not repeated by a later one.
 */
export function locationSuggestions(state, draft = {}) {
  const seen = new Set()
  const out = []
  for (const source of SOURCES) {
    for (const s of source(state, draft)) {
      if (!s.value || seen.has(s.value)) continue
      seen.add(s.value)
      out.push({ ...s, label: s.value })
    }
  }
  return out
}

/**
 * A Google Maps search link for a location value, or '' when there is nothing to map
 * (empty, telehealth, an office with no street address). Offices map to their address;
 * a client's usual site maps to the client's address when one is on file.
 */
export function mapsUrlFor(state, value, clientIds = []) {
  const v = String(value || '').trim()
  if (!v || TELE.test(v)) return ''
  const office = settingsOffices(state.settings).find((o) => o.name === v)
  let q = v.startsWith(HOME_PREFIX) ? v.slice(HOME_PREFIX.length) : v
  if (office) q = office.address ? addressOf(office) : ''
  else {
    const c = (state.clients || []).find((x) => clientIds.includes(x.id) && x.home === v && x.street)
    if (c) q = addressOf(c)
  }
  return q ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}` : ''
}
