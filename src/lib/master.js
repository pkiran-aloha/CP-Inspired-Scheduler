import { claimV2Defaults } from './claims'
import { seedProviders } from './seed'
/**
 * chunk-40 (U1) — billing v2 load-time migration, exactly once (meta.billingV2):
 *   • create the new ledger collections (payments / invoices / verificationForms /
 *     eraImports / billedFiles) when a v3 save lacks them;
 *   • remap every legacy inline claim remittance into a first-class payment record;
 *   • backfill claim v2 fields (method / reject / timelyDue / secondary / lines[].provider);
 *   • seed the provider identifier master (settings.providers) when absent;
 *   • default payer.ext for payers missing it.
 * Idempotent: a second pass is a no-op.
 */
export function normalizeBillingV2(state) {
  if (state.meta && state.meta.billingV2) return state
  let changed = false
  let count = 0
  let next = state
  const collections = ['payments', 'invoices', 'verificationForms', 'eraImports', 'billedFiles']
  for (const key of collections) if (!next[key]) { next = { ...next, [key]: {} }; changed = true }
  // 1) inline remittances → payment records
  const claims = {}
  let remapped = 0
  const payments = { ...next.payments }
  for (const [id, c] of Object.entries(next.claims || {})) {
    if (c.remittance && !payments[`pay-${id}`]) { payments[`pay-${id}`] = mkPayment(c); remapped++ }
  }
  if (remapped) { next = { ...next, payments }; changed = true; count += remapped }
  // 2) claim v2 backfill
  const claims2 = {}
  let backfilled = 0
  for (const [id, c] of Object.entries(next.claims || {})) {
    const d = claimV2Defaults(c, next)
    const patched = c.method || c.reject || c.timelyDue || c.secondary || c.lines.some((l) => l.provider) ? c : { ...c, ...d }
    if (patched !== c) backfilled++
    claims2[id] = patched
  }
  if (backfilled) { next = { ...next, claims: claims2 }; changed = true }
  // 3) provider master
  if (!Array.isArray(next.settings?.providers) || !next.settings.providers.length) {
    const prov = seedProviders(next.staff || [], next.settings?.org || {})
    next = { ...next, settings: { ...next.settings, providers: prov } }
    changed = true
  }
  // 4) payer.ext defaults
  const payers = (next.payers || []).map((p) => {
    if (p.ext && typeof p.ext === 'object' && 'group' in p.ext) return p
    const old = p.ext && typeof p.ext === 'object' ? p.ext : {}
    return { ...p, ext: { group: '', plan: '', subId: '', ticareId: '', medicaidId: '', bhpnId: '', filingDeadlineDays: null, requiresSecondaryBox18: true, ...old } }
  })
  if (payers.some((p, i) => p !== (next.payers || [])[i])) { next = { ...next, payers }; changed = true }
  // 5) billing settings defaults (chunk-41 D2)
  const bDef = { invoicePrefix: 'INV', claimPrefix: 'CLM', dueDays: 30, requireVerification: true, lateCancelHours: 24, autoUnits: true, defaultBilling: 'pr-org', defaultFacility: 'pr-org', strictAuth: false, supervisionCheck: false, invoiceSeq: 1, defaultFilingDays: 90 }
  if (!next.settings?.billing || Object.keys(bDef).some((k) => !(k in (next.settings.billing || {})))) {
    next = { ...next, settings: { ...next.settings, billing: { ...bDef, ...(next.settings?.billing || {}) } } }
    changed = true
  }
  return { ...next, meta: { ...(next.meta || {}), billingV2: true, billingV2Count: count } }
}

/**
 * chunk-41 (U3+U4) — payer billing identifiers + client secondary insurance.
 * Idempotent, runs on every load (no early-return flag) so new ext fields
 * added in later chunks get backfilled even after billingV2 is set.
 */
export function normalizeBillingIds(state) {
  let next = state
  let changed = false
  // billing settings backfill (strictAuth/supervisionCheck/invoiceSeq/defaultFilingDays)
  const bDef2 = { invoicePrefix: 'INV', claimPrefix: 'CLM', dueDays: 30, requireVerification: true, lateCancelHours: 24, autoUnits: true, defaultBilling: 'pr-org', defaultFacility: 'pr-org', strictAuth: false, supervisionCheck: false, invoiceSeq: 1, defaultFilingDays: 90 }
  if (!next.settings?.billing || Object.keys(bDef2).some((k) => !(k in (next.settings.billing||{})))) {
    next = { ...next, settings: { ...next.settings, billing: { ...bDef2, ...(next.settings?.billing||{}) } } }
    changed = true
  }
  // payer.ext completeness
  const payers = (next.payers || []).map((p) => {
    const ext = p.ext && typeof p.ext === 'object' ? p.ext : {}
    const need = ['group', 'plan', 'subId', 'ticareId', 'medicaidId', 'bhpnId', 'filingDeadlineDays', 'requiresSecondaryBox18']
    if (need.every((k) => k in ext)) return p
    return { ...p, ext: { group: '', plan: '', subId: '', ticareId: '', medicaidId: '', bhpnId: '', filingDeadlineDays: null, requiresSecondaryBox18: true, ...ext } }
  })
  if (payers.some((p, i) => p !== (next.payers || [])[i])) { next = { ...next, payers }; changed = true }
  // client.secondary defaults + seed two COB clients for the secondary queue (spec §4.3 / D5)
  const hadSecondaryKey = (next.clients||[]).some((c)=>('secondary' in c))
  let clients = (next.clients || []).map((c) => {
    if ('secondary' in c) return c
    return { ...c, secondary: null }
  })
  if (clients.some((c, i) => c !== (next.clients || [])[i])) changed = true
  if (!hadSecondaryKey && !(clients||[]).some((c)=>c.secondary)) {
    // legacy save: no secondary key anywhere → seed two COB clients
    clients = clients.map((c, idx) => {
      if (idx === 0 && next.payers?.[1]) return { ...c, secondary: { payerId: next.payers[1].id, memberId: `SEC-${c.id.slice(0, 4).toUpperCase()}`, authNo: `AUTH-S-0001`, relation: 'secondary', since: '2026-01-01', until: null, note: 'Seeded secondary for COB testing' } }
      if (idx === 1 && next.payers?.[2]) return { ...c, secondary: { payerId: next.payers[2].id, memberId: `SEC-${c.id.slice(0, 4).toUpperCase()}`, authNo: `AUTH-S-0002`, relation: 'secondary', since: '2026-02-01', until: null, note: '' } }
      return c
    })
    changed = true
  }
  if (changed) { next = { ...next, clients }
    changed = true
  }
  return changed ? next : state
}
const mkPayment = (c) => {
  const rem = c.remittance
  const r2 = (n) => Math.round((n || 0) * 100) / 100
  const iso = (ts) => { const d = new Date(ts); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
  return {
    id: `pay-${c.id}`, claimId: c.id, clientId: c.clientId, payer: c.payer,
    kind: rem.checkNo && /^CHK/i.test(rem.checkNo) ? 'check' : 'eob',
    amount: r2(rem.amount), adj: r2(rem.adj), patientResp: 0,
    ref: rem.checkNo || '—', date: c.closedAt ? iso(c.closedAt) : iso(Date.now()),
    reconciled: false, note: rem.note || '', attachments: [],
    source: null, reversalOf: null, createdAt: Date.now(), createdBy: 'Aloha (local)',
  }
}
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
export function cfDefs(p, defsList = []) {
  // payer.cf holds master template ids now; older saves carried inline defs or bare labels — resolve both
  const raw = (p && p.cf) || []
  const out = []
  for (let i = 0; i < raw.length; i++) {
    const f = raw[i]
    if (typeof f === 'string') {
      const byId = defsList.find((d) => d.id === f)
      if (byId) { out.push({ ...byId, source: 'master', defId: byId.id }); continue }
      out.push({ id: `legacy-${i}`, label: f, type: 'text', options: [], required: false, source: 'inline' })
      continue
    }
    if (f && f.type) { out.push({ options: [], onLabel: 'Yes', offLabel: 'No', required: false, ...f, source: 'inline' }); continue }
    if (f && f.label) { out.push({ id: `legacy-${i}`, label: f.label, type: 'text', options: [], required: false, value: f.value ?? '', source: 'inline' }); continue }
  }
  return out
}
// the fields an appointment must collect for a payer — template defs win over inline legacy entries
export function payerFieldDefs(state, payer) {
  return payer ? cfDefs(payer, state.customFields || []) : []
}
export const cfUsedBy = (defs, payers, id) => payers.filter((x) => (x.cf || []).includes(id)).length
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

/**
 * chunk-37 — THE master-only rule, enforced at load: every custom field that
 * exists anywhere must be defined in the Custom Fields master. Older saves may
 * still carry bare label strings or full inline definitions on payers. Those are
 * reconciled once, silently, at startup:
 *   • a template id already in the master            → kept as-is
 *   • a label string that matches a master template  → re-pointed at the template
 *   • a label string with no template                → dropped (cannot exist)
 *   • an inline definition object                    → promoted into the master and referenced by id
 * After this, no consumer (appointment modal, exports, detail cards) can ever
 * encounter a field that the master doesn't define — pre-population or otherwise.
 */
export function normalizePayerCf(state, mkId) {
  const defs = (state.customFields || []).slice()
  const byLabel = new Map(defs.map((d) => [String(d.label || '').toLowerCase(), d]))
  const idSet = new Set(defs.map((d) => d.id))
  let changed = false
  const payers = (state.payers || []).map((p) => {
    const cf = p.cf || []
    if (!cf.length) return p
    const out = []
    let dirty = false
    for (const entry of cf) {
      if (typeof entry === 'string' && idSet.has(entry)) { out.push(entry); continue }
      dirty = true
      if (typeof entry === 'string') {
        const m = byLabel.get(entry.toLowerCase())
        if (m) out.push(m.id) // else: dangling — a field outside the master cannot exist
      } else if (entry && typeof entry === 'object' && entry.label) {
        let m = byLabel.get(String(entry.label).toLowerCase())
        if (!m) {
          m = { id: 'cf-' + String(mkId()).replace(/[^a-z0-9]/gi, '').slice(0, 10), label: String(entry.label), type: entry.type || 'text', options: entry.options || [], onLabel: entry.onLabel || 'Yes', offLabel: entry.offLabel || 'No', required: Boolean(entry.required), note: entry.note || '', status: 'active' }
          defs.push(m); idSet.add(m.id); byLabel.set(m.label.toLowerCase(), m)
        }
        out.push(m.id)
      }
    }
    return dirty ? { ...p, cf: out } : p
  })
  return changed || payers.some((x, i) => x !== (state.payers || [])[i]) ? { ...state, payers, customFields: defs } : state
}

/**
 * chunk-38 — one-time cleanup of PRE-LOADED appointment custom fields.
 * Pre-v13 saves may hold pcfs values that the app itself captured in the old
 * auto-populate era (or that leaked in through the payer-inherited field set).
 * Appointments must carry ONLY fields their user explicitly added, so the first
 * v13 load clears every appointment's pcfs exactly once, flags it in
 * state.meta.pcfCleared (idempotent afterwards) and records pcfClearedCount so
 * the UI can announce it. Payer picks are untouched — the payer flow keeps its data.
 */
/**
 * chunk-39 — the OLD built-in appointment "Custom Fields" panel (Meg Test / My Care /
 * Yes or No / Grade / Re-eval Notes) is gone for good. Two load-time repairs:
 *   • the four meaningful legacy fields are promoted into the master as regular
 *     templates (by label, so a user's own definition always wins) — "Meg Test"
 *     (a debug leftover) is deliberately NOT promoted;
 *   • every appointment's legacy `custom` values are cleared exactly once
 *     (flagged in state.meta.legacyCustomCleared), announced via toast in App.
 */
export function normalizeLegacyCustom(state) {
  if (state.meta && state.meta.legacyCustomCleared) return state
  const defs = (state.customFields || []).slice()
  const byLabel = new Map(defs.map((d) => [String(d.label || '').toLowerCase(), d]))
  const LEGACY = [
    { id: 'cf-mycare', label: 'My Care', type: 'multi', options: ['Sensory Diet', 'Feeding Therapy', 'Sleep Protocol', 'Toileting Plan', 'Behavior Support', 'AAC Training', 'Mand Training'], onLabel: 'Yes', offLabel: 'No', required: false, note: 'Carried over from the old built-in appointment fields.', status: 'active' },
    { id: 'cf-yesno', label: 'Yes or No', type: 'toggle', onLabel: 'Yes', offLabel: 'No', required: false, note: 'Carried over from the old built-in appointment fields.', status: 'active' },
    { id: 'cf-grade', label: 'Grade', type: 'select', options: ['A', 'B', 'C', 'D', 'E', 'N/A'], required: false, note: 'Carried over from the old built-in appointment fields.', status: 'active' },
    { id: 'cf-reval', label: 'Re-eval Notes', type: 'text', required: false, note: 'Carried over from the old built-in appointment fields.', status: 'active' },
  ]
  for (const t of LEGACY) if (!byLabel.has(t.label.toLowerCase())) { defs.push(t); byLabel.set(t.label.toLowerCase(), t) }
  let cleared = 0
  let changed = false
  const appts = {}
  for (const [id, a] of Object.entries(state.appts || {})) {
    if (a && a.custom && Object.keys(a.custom).length) { cleared++; changed = true; appts[id] = { ...a, custom: {} } }
    else appts[id] = a
  }
  const meta = { ...(state.meta || {}), legacyCustomCleared: true, legacyCustomClearedCount: cleared }
  const fieldsChanged = defs.length !== (state.customFields || []).length
  return changed || fieldsChanged ? { ...state, appts, customFields: defs, meta } : { ...state, meta }
}

export function normalizeApptPcfs(state) {
  if (state.meta && state.meta.pcfCleared) return state
  let cleared = 0
  let changed = false
  const appts = {}
  for (const [id, a] of Object.entries(state.appts || {})) {
    if (a && a.pcfs && Object.keys(a.pcfs).length) { cleared++; changed = true; appts[id] = { ...a, pcfs: null } }
    else appts[id] = a
  }
  const meta = { ...(state.meta || {}), pcfCleared: true, pcfClearedCount: cleared }
  return changed ? { ...state, appts, meta } : { ...state, meta }
}
