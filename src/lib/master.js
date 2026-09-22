// ── Masters layer ────────────────────────────────────────────────────────────
// Store-backed master lists (service types) + payer master records: contracted
// services, per-service overrides and the billing-rules suite. Old persisted
// snapshots never carried these keys, so every read funnels through
// ensurePayer()/svcList() which merge defaults — no schema migration needed.
import { BILL_CODES, SERVICES } from './model'

export const ROUNDINGS = ['AMA', 'Nearest', 'Round Up', 'Round Down', 'Truncate']
export const MODIFIERS = ['U6', 'HP', 'HO', 'HN', 'HM', 'UN', 'HC', 'U1', 'U2', 'U3']
export const POS_CODES = [
  { id: '02', label: '02 · Telehealth — other than patient home' },
  { id: '10', label: '10 · Telehealth — patient home' },
  { id: '11', label: '11 · Office' },
  { id: '03', label: '03 · School' },
  { id: '06', label: "06 · Patient's Home" },
  { id: '99', label: '99 · Other place of service' },
]
export const CMS_TYPES = ['Group Health Plan', 'Medicaid', 'Medicare', 'Commercial', 'TRICARE', 'Blue Cross/Blue Shield', 'Feeding Program', 'Other']
export const FORMATS = ['None', 'Custom Format 1', 'Custom Format 2']
export const CREDENTIALS = ['BCBA', 'BCaBA', 'BQ', 'RBT', 'LCDC', 'SLP', 'OT', 'MSW']

export const DEFAULT_QM = [
  { qual: 'Doctoral', m1: 'U6', m2: 'HP' },
  { qual: "Master's", m1: 'U6', m2: 'HO' },
  { qual: "Bachelor's", m1: 'U6', m2: 'HN' },
  { qual: 'Associate', m1: 'U6', m2: 'HM' },
  { qual: 'HS', m1: 'U6', m2: 'HM' },
]
const DEFAULT_CLAIMS = {
  separateBy: '—', box17: '—', box19: '—',
  box32: 'Auto-populate if blank, leave blank if same as billing NPI',
  box33B: '—', box33B2: '—',
  file: 'One file per claim', apptTime: 'Do not include',
  flags: { renderProvider: false, renderTaxo: false, billTaxo: false, mergeSameDay: true },
}
const DEFAULT_RULES = {
  concurrent: { allowed: true, rules: [] },
  claims: DEFAULT_CLAIMS,
  appt: { sigRequired: false },
  qualMods: DEFAULT_QM,
  posMods: [
    { pos: '02', mod: '' },
    { pos: '10', mod: '' },
  ],
  hideTeleOther: false,
  hideTeleHome: false,
  mue: { daily: '', per: {} },
}

export const CF_TYPES = [
  { id: 'text', label: 'Free text' },
  { id: 'select', label: 'Single select (radio)' },
  { id: 'multi', label: 'Multi select (checkbox)' },
  { id: 'toggle', label: 'Toggle' },
  { id: 'date', label: 'Date / time' },
  { id: 'signature', label: 'Signature' },
]
export const cfTypeLabel = (t) => CF_TYPES.find((x) => x.id === t)?.label || t
// custom-field defs may be legacy strings ("label") or plain {label,value} — migrate to typed defs
export function cfDefs(p) {
  return ((p && p.cf) || []).map((f, i) =>
    typeof f === 'string'
      ? { id: `legacy-${i}`, label: f, type: 'text', options: [], required: false, value: '' }
      : f.value !== undefined && f.type === undefined
        ? { id: `legacy-${i}`, label: f.label, type: 'text', options: [], required: false, value: f.value }
        : { options: [], required: false, ...f, id: f.id || `f${i}` }
  )
}
// required-but-empty validator for an appointment's answers; returns error strings
export function pcfsErrors(defs, vals = {}) {
  const out = []
  for (const d of defs) {
    if (!d.required) continue
    const v = (vals || {})[d.id]?.value
    const empty = d.type === 'multi' ? !(Array.isArray(v) && v.length) : d.type === 'signature' ? !v || !v.name : v === undefined || v === null || String(v).trim() === ''
    if (empty) out.push(`Payer field “${d.label}” is required before completing`)
  }
  return out
}

// every payer read goes through here — deep-enough merge so partial saves render
export function ensurePayer(p) {
  if (!p) return p
  const r = p.rules || {}
  return {
    services: [],
    svcs: [],
    svcOv: {},
    cf: [],
    cmsType: 'Group Health Plan',
    format: 'None',
    payerId: '',
    clearingHouse: 'Office Ally',
    ctList: '',
    ...p,
    rules: {
      ...DEFAULT_RULES,
      ...r,
      concurrent: { ...DEFAULT_RULES.concurrent, ...(r.concurrent || {}) },
      claims: { ...DEFAULT_CLAIMS, ...(r.claims || {}), flags: { ...DEFAULT_CLAIMS.flags, ...(r.claims?.flags || {}) } },
      appt: { ...DEFAULT_RULES.appt, ...(r.appt || {}) },
      qualMods: Array.isArray(r.qualMods) && r.qualMods.length ? r.qualMods : DEFAULT_QM,
      posMods: Array.isArray(r.posMods) ? r.posMods : DEFAULT_RULES.posMods,
      mue: { ...DEFAULT_RULES.mue, ...(r.mue || {}), per: { ...(r.mue?.per || {}) } },
    },
  }
}

export const svcRule = (p) => ensurePayer(p).rules

// payer whose rules apply to this appointment: first client's payer
export function payerForAppt(state, clientIds) {
  const id = (clientIds || [])[0]
  const c = state.clients.find((x) => x.id === id)
  const key = c?.payer || c?.insurer
  if (!key) return null
  return (state.payers || []).find((p) => p.id === key || p.name === key) || null
}

// master service list: store slice when seeded (editable), static model otherwise
export function svcList(state) {
  return state.svcs && state.svcs.length ? state.svcs : SERVICES.map((s) => ({ ...s, status: 'active', unitMins: BILL_CODES.find((c) => c.id === s.code)?.unitMins || 30, rate: BILL_CODES.find((c) => c.id === s.code)?.rate || 0, rounding: 'AMA' }))
}
export const activeSvcs = (state) => svcList(state).filter((s) => s.status !== 'inactive')

// payer-owned services (added straight on the payer's Services tab — full records)
export const localSvcs = (payer) => (payer ? ensurePayer(payer).svcs || [] : [])
export function payerLocalSvcs(state, clientIds) {
  const p = payerForAppt(state, clientIds)
  return localSvcs(p).filter((sv) => sv.status !== 'inactive')
}
// any service id (master or payer-local) resolved for labels/codes
export function svcById(state, id) {
  if (!id) return null
  return svcList(state).find((s) => s.id === id) || (state.payers || []).flatMap((p) => localSvcs(p)).find((s) => s.id === id) || null
}
// the picker list for an appointment: active master services + the clients' payer's own active services
export function svcOptionsFor(state, clientIds) {
  const p = payerForAppt(state, clientIds)
  const mine = localSvcs(p).filter((s) => s.status !== 'inactive')
  return [...activeSvcs(state), ...mine.map((s) => ({ ...s, code: s.code || '97151', unitMins: parseInt(s.unitSize, 10) || (BILL_CODES.find((c) => c.id === s.code) || {}).unitMins || 30, payerLocal: true, payerName: p.name }))]
}
// charge rate for an appt service under a payer — only when the encounter actually bills
// the contracted code: payer-local record → contract override → master rate → code table.
// (If the user re-picks a different CPT on the appointment, the code table rate governs.)
export function rateFor(state, payer, svcId, codeId) {
  const svc = svcList(state).find((s) => s.id === svcId)
  const local = payer ? (ensurePayer(payer).svcs || []).find((s) => s.id === svcId) : null
  const contractedCode = local ? local.code : svc?.code
  if (codeId && contractedCode && contractedCode !== codeId) {
    const c = BILL_CODES.find((x) => x.id === codeId)
    return { rate: c ? c.rate : 0, source: 'code table' }
  }
  if (local) return { rate: Number(local.charge) || 0, source: `${payer.name} contract` }
  const ovr = payer ? (ensurePayer(payer).svcOv || {})[svcId] : null
  if (ovr && ovr.charge) return { rate: Number(ovr.charge), source: `${payer.name} contract` }
  if (svc && svc.rate) return { rate: Number(svc.rate), source: `${svc.label} master rate` }
  const c = BILL_CODES.find((x) => x.id === codeId)
  return { rate: c ? c.rate : 0, source: 'code table' }
}

// concurrent-billing note for a candidate slot: returns { level, text } | null
export function concurrentNote(state, { payer, svcId, clientId, date, start, end, excludeId }) {
  if (!payer || !clientId) return null
  const rules = svcRule(payer)
  if (rules.concurrent.allowed && !(rules.concurrent.rules || []).length) return null
  const apptList = Array.isArray(state.appts) ? state.appts : Object.values(state.appts || {})
  const same = apptList.filter((a) => a.id !== excludeId && a.date === date && (a.clientIds || []).includes(clientId) && a.status !== 'cancelled' && a.start < end && a.end > start)
  if (!same.length) return null
  const label = (id) => (svcList(state).find((s) => s.id === id) || localSvcs(payer).find((s) => s.id === id))?.label || id
  if (!rules.concurrent.allowed) return { level: 'warn', text: `${payer.name} does not allow concurrent billing — this slot overlaps ${same.length} other booked service hour${same.length > 1 ? 's' : ''} for this client.` }
  for (const r of rules.concurrent.rules || []) {
    for (const a of same) {
      if ((r.with === a.service && r.if === svcId) || (r.if === a.service && r.with === svcId)) {
        return { level: 'info', text: `${payer.name} concurrent rule: when ${label(r.if)} overlaps ${label(r.with)}, only ${label(r.bill)} will be billed.` }
      }
    }
  }
  return null
}
