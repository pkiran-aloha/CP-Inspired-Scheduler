// ---- Authorization unit ledger + payer rule packs (ideas A2 + A4) ----
//
// `authBudget.js` guards the *hours* view of an authorization (weekly hours across a
// window). Payers audit *units per CPT code*, so this module adds the unit view:
//
//   · client.authUnits = { [code]: units approved for the window }  — the payer letter
//   · a session's minutes become units by the payer's own rule for that service: the
//     payer's per-service override (unit size + rounding) → the payer's own service →
//     the service master → the code's default unit size, rounding 'AMA' (8-minute rule)
//   · payer rule packs, configured on Masters → Payer → Billing Rules → MUEs, checked
//     at booking: per-code and all-code daily maximums, per-code weekly maximums, and
//     whether the booked staff member's credential may render the code
//
// Pure: no React, no store. It never contacts a payer; every number traces to the
// client record, the payer master or an appointment on the calendar.

import { BILL_CODES, LEGACY_UNIT_DEFAULTS, unitsFor } from './model'
import { ensurePayer, payerForAppt, svcById, svcList } from './master'
import { credOf, credentialIssue } from './claims'
import { isCancelStatus } from './settingsMasters'
import { authGuardCfg } from './authBudget'
import { addDays, isoDate, parseISO, startOfWeek } from './date'

const CLINICAL = ['service', 'evaluation', 'supervision']
const SEVERITY = ['ok', 'flag', 'warn', 'stop']
const worse = (a, b) => (SEVERITY.indexOf(a) >= SEVERITY.indexOf(b) ? a : b)
const num = (v) => {
  const n = Number(String(v ?? '').replace(/[^\d.]/g, ''))
  return Number.isFinite(n) && n > 0 ? n : 0
}

export const ROUNDING_HELP = {
  AMA: 'a unit counts once more than half of it is delivered (the 8-minute rule for 15-minute codes)',
  Nearest: 'rounded to the nearest whole unit',
  'Round Up': 'any part of a unit counts as a full unit',
  'Round Down': 'only complete units count',
  Truncate: 'only complete units count',
}

export { unitsFor } // lives in model.js so code-default billing (autoBilling) uses the same rule

const codeUnitMins = (state, code) =>
  svcList(state).find((s) => s.code === code)?.unitMins || BILL_CODES.find((c) => c.id === code)?.unitMins || 15

/** The code and the payer's unit rule that apply to one appointment (or booking draft). */
export function unitRuleFor(state, a) {
  const picked = a.service ? svcById(state, a.service) : null
  const code = a.billingCode || a.billing?.code || picked?.code || ''
  // a billing code picked by hand that differs from the service's own drops the service's unit rule
  const svc = picked && (!picked.code || picked.code === code) ? picked : null
  const payer = payerForAppt(state, a.clientIds)
  const p = payer ? ensurePayer(payer) : null
  const ov = (p && svc && p.svcOv?.[a.service]) || null
  const local = (p && svc && (p.svcs || []).find((s) => s.id === a.service)) || null
  const unitMins = num(ov?.unitSize) || num(local?.unitSize) || local?.unitMins || svc?.unitMins || codeUnitMins(state, code)
  const rounding = ov?.rounding || local?.rounding || svc?.rounding || 'AMA'
  const credentials = (ov?.credentials?.length ? ov.credentials : local?.credentials) || []
  return { code, unitMins, rounding, credentials, payer: p }
}

const consumes = (state, a) => CLINICAL.includes(a.type) && !isCancelStatus(state.settings, a.status)
export const apptUnits = (state, a) => {
  const r = unitRuleFor(state, a)
  return { code: r.code, units: unitsFor((a.end || 0) - (a.start || 0), r.unitMins, r.rounding) }
}

/** Clean a stored pool: codes → positive whole units. */
export const cleanPool = (pool) =>
  Object.fromEntries(Object.entries(pool || {}).map(([c, v]) => [String(c).trim(), Math.round(num(v))]).filter(([c, v]) => c && v > 0))

/** Units the client's calendar plans per code inside the authorization window. */
export function plannedUnits(state, client) {
  const out = {}
  for (const a of Object.values(state.appts || {})) {
    if (!(a.clientIds || []).includes(client?.id) || !consumes(state, a)) continue
    if ((client.authStart && a.date < client.authStart) || (client.authEnd && a.date > client.authEnd)) continue
    const { code, units } = apptUnits(state, a)
    if (code) out[code] = (out[code] || 0) + units
  }
  return out
}

/**
 * A pool estimated from weekly hours (weekly hours × weeks in the window), split across
 * the codes the client is actually booked under, in proportion to those bookings.
 * With nothing booked yet, the whole estimate goes to 97153.
 */
export function poolFromWeeklyHours(state, client) {
  const weekly = Number(client?.authWeekly) || 0
  if (!weekly || !client?.authStart || !client?.authEnd) return null
  const weeks = Math.max(0, (parseISO(client.authEnd) - parseISO(client.authStart)) / 86400000) / 7
  const totalMin = weekly * weeks * 60
  const plan = plannedUnits(state, client)
  const minsByCode = Object.fromEntries(Object.entries(plan).map(([c, u]) => [c, u * codeUnitMins(state, c)]))
  const planned = Object.values(minsByCode).reduce((t, m) => t + m, 0)
  const shares = planned ? minsByCode : { '97153': 1 }
  const sum = planned || 1
  const pool = Object.fromEntries(Object.entries(shares).map(([c, m]) => [c, Math.round(((m / sum) * totalMin) / codeUnitMins(state, c))]))
  return Object.values(pool).some((u) => u > 0) ? cleanPool(pool) : null
}

/**
 * One-time migration for saved workspaces: a client with weekly hours and a window but
 * no unit pool gets one converted from those hours, marked for verification until
 * someone edits it. Idempotent; returns the same object when nothing changes.
 */
export function normalizeAuthUnits(state) {
  let changed = 0
  const clients = (state.clients || []).map((c) => {
    if (c.authUnits !== undefined) {
      const clean = cleanPool(c.authUnits)
      return JSON.stringify(clean) === JSON.stringify(c.authUnits) ? c : (changed++, { ...c, authUnits: clean })
    }
    // nothing to convert (no weekly hours or no window): leave the record exactly as it was
    const pool = poolFromWeeklyHours(state, c)
    if (!pool) return c
    changed++
    return { ...c, authUnits: pool, authUnitsConverted: true }
  })
  if (!changed) return state
  return { ...state, clients, meta: { ...(state.meta || {}), authUnitsMigrated: clients.filter((c) => c.authUnitsConverted).length } }
}

/**
 * One-time move of a saved workspace from the old 30-minute code defaults to the
 * Medicaid / CPT 15-minute norm. Only untouched defaults move: a service still on the
 * old unit length for its code. Its rate (and any payer override charge that follows it)
 * scales so the hourly charge is unchanged; authorization pools for those codes scale to
 * the new unit; appointments not yet on a claim are re-counted with the midpoint rule.
 * Claims are never touched. Runs once (meta.unitNorm15); after that it returns the same object.
 * ponytail: a pool is scaled per code, not per payer, so a client whose payer sets its own
 * unit size for that code keeps a pool in the wrong unit; fix by hand in Clients → Edit.
 */
export function normalizeUnitNorms(state) {
  if (state.meta?.unitNorm15) return state
  const r2 = (n) => Math.round(n * 100) / 100
  const factor = {} // svc id → new/old unit length
  const svcs = (state.svcs || []).map((s) => {
    const old = LEGACY_UNIT_DEFAULTS[s.code]
    const now = BILL_CODES.find((c) => c.id === s.code)
    if (!old || !now || s.unitMins !== old.unitMins || now.unitMins === old.unitMins) return s
    factor[s.id] = now.unitMins / old.unitMins
    return { ...s, unitMins: now.unitMins, rate: s.rate === old.rate ? now.rate : r2(s.rate * factor[s.id]) }
  })
  // codes whose unit length moved: a converted service, or no service at all (the code default moved)
  const codes = new Set(svcs.filter((s) => factor[s.id]).map((s) => s.code))
  // (the latter only with evidence: a session of that code still billed in the old unit)
  const oldUnitSeen = new Set(Object.values(state.appts || {}).filter((a) => a.billing && a.billing.unitMins === LEGACY_UNIT_DEFAULTS[a.billing.code]?.unitMins).map((a) => a.billing.code))
  for (const code of oldUnitSeen) if (!svcs.some((s) => s.code === code)) codes.add(code)
  const payers = (state.payers || []).map((p) => {
    const ov = p.svcOv || {}
    const ids = Object.keys(ov).filter((id) => factor[id] && !ov[id]?.unitSize)
    if (!ids.length) return p
    const scale = (v, f) => (v === '' || v == null || !Number.isFinite(Number(v)) ? v : r2(Number(v) * f))
    return { ...p, svcOv: { ...ov, ...Object.fromEntries(ids.map((id) => [id, { ...ov[id], charge: scale(ov[id].charge, factor[id]), contract: scale(ov[id].contract, factor[id]) }])) } }
  })
  const clients = (state.clients || []).map((c) => {
    const pool = c.authUnits || {}
    if (!Object.keys(pool).some((code) => codes.has(code))) return c
    const old = (code) => LEGACY_UNIT_DEFAULTS[code].unitMins / BILL_CODES.find((b) => b.id === code).unitMins
    return { ...c, authUnits: Object.fromEntries(Object.entries(pool).map(([code, u]) => [code, codes.has(code) ? Math.round(u * old(code)) : u])) }
  })
  const next = { ...state, svcs, payers, clients }
  const billed = new Set(Object.values(state.claims || {}).filter((c) => c.status !== 'void').flatMap((c) => (c.lines || []).map((l) => l.apptId)))
  let appts = state.appts
  for (const a of Object.values(state.appts || {})) {
    const b = a.billing
    const old = b && LEGACY_UNIT_DEFAULTS[b.code]
    if (!old || billed.has(a.id) || b.unitMins !== old.unitMins || a.type === 'drive') continue
    const rule = unitRuleFor(next, a)
    if (rule.unitMins === b.unitMins) continue
    const minutes = b.minutes || (a.end || 0) - (a.start || 0)
    if (appts === state.appts) appts = { ...state.appts }
    appts[a.id] = { ...a, billing: { ...b, unitMins: rule.unitMins, rounding: rule.rounding, minutes, units: unitsFor(minutes, rule.unitMins, rule.rounding), rate: r2((Number(b.rate) || 0) * (rule.unitMins / b.unitMins)) } }
  }
  return { ...next, appts, meta: { ...(state.meta || {}), unitNorm15: true } }
}

/**
 * Demo pools for a fresh workspace, as if typed from a payer letter: each code the
 * client is booked under, with headroom that varies by client so the demo shows a mix
 * of comfortable, tight and over-committed authorizations. `index` keeps it deterministic.
 */
const SEED_HEADROOM = [1.2, 1.08, 0.96, 1.3, 1.12]
export function seedAuthUnits(state, client, index = 0) {
  const plan = plannedUnits(state, client)
  const f = SEED_HEADROOM[index % SEED_HEADROOM.length]
  return { ...client, authUnits: cleanPool(Object.fromEntries(Object.entries(plan).map(([c, u]) => [c, Math.max(2, Math.ceil(u * f))]))) }
}

/** Per-code burn for one client's authorization window. */
export function unitLedger(state, client, { today, exclude = [], extra = [] } = {}) {
  const pool = cleanPool(client?.authUnits)
  const start = client?.authStart || ''
  const end = client?.authEnd || ''
  const codes = {}
  for (const [code, authorized] of Object.entries(pool)) codes[code] = { code, authorized, delivered: 0, scheduled: 0 }
  const list = [...Object.values(state.appts || {}).filter((a) => !exclude.includes(a.id)), ...extra]
  for (const a of list) {
    if (!(a.clientIds || []).includes(client?.id) || !consumes(state, a)) continue
    if (start && a.date < start) continue
    if (end && a.date > end) continue
    const { code, units } = apptUnits(state, a)
    if (!code) continue
    const g = (codes[code] = codes[code] || { code, authorized: 0, delivered: 0, scheduled: 0 })
    if (today && a.date < today) g.delivered += units
    else g.scheduled += units
  }
  return {
    start, end, converted: Boolean(client?.authUnitsConverted),
    codes: Object.values(codes).map((g) => {
      const committed = g.delivered + g.scheduled
      return { ...g, committed, remaining: g.authorized - committed, pct: g.authorized ? Math.round((committed / g.authorized) * 100) : null }
    }).sort((a, b) => (a.code < b.code ? -1 : 1)),
  }
}

const unitsOn = (state, clientId, list, pred) =>
  list.filter((a) => (a.clientIds || []).includes(clientId) && consumes(state, a) && pred(a)).reduce((t, a) => t + apptUnits(state, a).units, 0)

/**
 * The unit and payer-rule checks for one booking. `mergeAuthChecks` folds the result
 * into the hours result from `authCheckFor`.
 */
export function unitCheckFor(state, client, draft = {}, { today } = {}) {
  const cfg = authGuardCfg(state.settings)
  const none = { severity: 'ok', reasons: [], notes: [], units: null }
  if (cfg.mode === 'off' || !client || !draft.date || !CLINICAL.includes(draft.type)) return none
  const probe = {
    id: draft.id || '__draft__', date: draft.date, start: draft.start, end: draft.end, type: draft.type,
    status: draft.status || 'active', clientIds: [client.id], service: draft.service, billingCode: draft.billingCode,
    billing: draft.billing, staffIds: draft.staffIds || [],
  }
  if (isCancelStatus(state.settings, probe.status)) return none
  const rule = unitRuleFor(state, probe)
  if (!rule.code) return none
  const units = unitsFor((probe.end || 0) - (probe.start || 0), rule.unitMins, rule.rounding)
  const reasons = []
  const notes = []
  let severity = 'ok'
  const add = (sev, text) => { reasons.push(text); severity = worse(severity, sev) }
  const exclude = probe.id === '__draft__' ? [] : [probe.id]
  const withProbe = [...Object.values(state.appts || {}).filter((a) => !exclude.includes(a.id)), probe]

  // ---- the unit pool on the authorization (A2)
  const pool = cleanPool(client.authUnits)
  const inWindow = (!client.authStart || probe.date >= client.authStart) && (!client.authEnd || probe.date <= client.authEnd)
  const ledger = Object.keys(pool).length ? unitLedger(state, client, { today, exclude, extra: [probe] }) : null
  if (ledger && inWindow) {
    const row = ledger.codes.find((g) => g.code === rule.code)
    if (!pool[rule.code]) {
      add('warn', `${rule.code} is not on this client's authorization (units on file: ${Object.keys(pool).join(', ')}). The payer can deny every ${rule.code} unit.`)
    } else if (row.remaining < 0) {
      add(row.pct >= cfg.blockAtPct ? 'stop' : 'warn', `${rule.code}: ${row.committed} units committed against ${row.authorized} authorized — over by ${-row.remaining} units (${row.pct}%).`)
    } else if (row.pct >= cfg.warnAtPct) {
      add('warn', `${rule.code}: ${row.pct}% of the authorized units are committed — ${row.remaining} units left.`)
    }
    if (ledger.converted) notes.push('These units were converted from weekly hours. Check them against the payer’s authorization letter and save the client to confirm.')
  }

  // ---- the payer's rule pack (A4)
  const p = rule.payer
  if (p) {
    const mue = p.rules.mue || {}
    const sameDay = (a) => a.date === probe.date
    const dayCap = num(mue.per?.[rule.code])
    if (dayCap) {
      const day = unitsOn(state, client.id, withProbe, (a) => sameDay(a) && apptUnits(state, a).code === rule.code)
      if (day > dayCap) add('warn', `${p.name} MUE: ${day} units of ${rule.code} on ${probe.date} against a maximum of ${dayCap} per day.`)
    }
    const allCap = num(mue.daily)
    if (allCap) {
      const day = unitsOn(state, client.id, withProbe, sameDay)
      if (day > allCap) add('warn', `${p.name} MUE: ${day} units across all codes on ${probe.date} against a daily maximum of ${allCap}.`)
    }
    const weekCap = num(mue.weekly?.[rule.code])
    if (weekCap) {
      const ws = isoDate(startOfWeek(parseISO(probe.date), Number(state.settings?.weekStart) || 0))
      const we = isoDate(addDays(parseISO(ws), 6))
      const wk = unitsOn(state, client.id, withProbe, (a) => a.date >= ws && a.date <= we && apptUnits(state, a).code === rule.code)
      if (wk > weekCap) add('warn', `${p.name} weekly limit: ${wk} units of ${rule.code} in the week of ${ws} against a maximum of ${weekCap}.`)
    }
  }

  // ---- may the booked staff render this code?
  for (const sid of probe.staffIds) {
    const st = (state.staff || []).find((s) => s.id === sid)
    if (!st) continue
    const cred = credOf(st.role)
    const issue = credentialIssue(rule.code, cred)
    if (issue) add('warn', `${st.name}: ${issue}. The line will not be payable as booked.`)
    else if (rule.credentials.length && !rule.credentials.includes(cred)) add('warn', `${st.name} (${cred}) is not a credential ${p?.name || 'this payer'} accepts for this service (${rule.credentials.join(', ')}).`)
  }

  return { severity, reasons, notes, units: { code: rule.code, units, unitMins: rule.unitMins, rounding: rule.rounding, ledger } }
}

/** Fold the unit/payer result into an `authCheckFor` (hours) result, honouring the practice's guard mode. */
export function mergeAuthChecks(hours, units, settings) {
  if (!units || (!units.reasons.length && !units.notes.length)) return { ...hours, units: units?.units || null }
  const cfg = authGuardCfg(settings)
  const s = units.severity
  const capped = cfg.mode === 'stop' ? s : cfg.mode === 'warn' ? (s === 'stop' ? 'warn' : s) : s === 'ok' ? 'ok' : 'flag'
  const severity = worse(hours.severity, capped)
  const headline = { stop: 'Authorization would be exceeded', warn: 'Authorization warning', flag: 'Authorization flagged', ok: hours.headline || 'Within the authorized hours' }[severity]
  return {
    ...hours,
    severity,
    blocked: severity === 'stop',
    headline,
    reasons: [...hours.reasons, ...units.reasons],
    notes: [...hours.notes, ...units.notes],
    units: units.units,
  }
}
