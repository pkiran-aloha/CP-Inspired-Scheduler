// ---- Claim lifecycle engine: staging → claim assembly → submission gates → payment / denial / rebill ----
// Pure + deterministic: the same functions power the Billing workspace, the demo seed,
// the reports desk (claim registers) and the store's undoable transitions.
import { BILL_CODES, CRED_MODIFIERS, DEFAULT_QM, TYPES, computeBilling, unitsFor } from './model'
import { isoDate, parseISO } from './date'
import { providerIdIssues, providerIdRule } from './providerIds' // call-time only (providerIds reads validNpi from here)

const r2 = (n) => Math.round(n * 100) / 100

// ---------- payer policy (drives aging expectations, copays, quick-post presets) ----------
export const PAYER_POLICY = {
  'Blue Shield CA': { kind: 'commercial', avgDays: 21, timely: 90, coins: 0.9, copay: 0 },
  Aetna: { kind: 'commercial', avgDays: 24, timely: 180, coins: 0.8, copay: 25 },
  'Regence BCBS': { kind: 'commercial', avgDays: 18, timely: 120, coins: 0.85, copay: 0 },
  UnitedHealthcare: { kind: 'commercial', avgDays: 30, timely: 90, coins: 0.8, copay: 20 },
  'Medicaid (CA)': { kind: 'medicaid', avgDays: 35, timely: 270, coins: 1, copay: 0 },
  'Self-pay': { kind: 'selfpay', avgDays: 14, timely: 365, coins: 1, copay: 0 },
}
const POLICY_DEFAULT = { kind: 'commercial', avgDays: 25, timely: 120, coins: 0.8, copay: 0 }
// With `state`, the payer master record's own `policy` (edited in Payer → Billing
// Rules → Payment Terms) wins; the constant is only the seed / fallback.
export const payerPolicy = (payer, state) => {
  const rec = state ? (state.payers || []).find((p) => p.name === payer) : null
  return { ...POLICY_DEFAULT, ...(PAYER_POLICY[payer] || {}), ...(rec?.policy || {}) }
}
// One answer for "how many days does this payer allow to file": payer record,
// then the practice default (Settings → Billing defaults), then the policy.
export function filingDaysOf(state, payer) {
  const rec = (state?.payers || []).find((p) => p.name === payer)
  return rec?.ext?.filingDeadlineDays ?? state?.settings?.billing?.defaultFilingDays ?? payerPolicy(payer, state).timely ?? 90
}

export const PAYER_KINDS = [
  { id: 'commercial', label: 'Commercial' },
  { id: 'medicaid', label: 'Medicaid' },
  { id: 'government', label: 'Other government' },
  { id: 'selfpay', label: 'Self-pay' },
]
const twoDp = (n) => Math.abs(Math.round(n * 100) - n * 100) < 1e-9
// Payment Terms editor → validated patch for one payer record.
export function planPayerTerms(state, payerId, input = {}) {
  const p = (state.payers || []).find((x) => x.id === payerId)
  if (!p) return { ok: false, msg: 'Payer no longer exists.' }
  const num = (v) => (v === '' || v == null ? NaN : Number(v))
  const avgDays = num(input.avgDays)
  const coinsPct = num(input.coinsPct)
  const copay = num(input.copay)
  const filing = input.filingDays === '' || input.filingDays == null ? null : Number(input.filingDays)
  if (!PAYER_KINDS.some((k) => k.id === input.kind)) return { ok: false, msg: 'Choose a payer kind.' }
  if (!Number.isInteger(avgDays) || avgDays < 1 || avgDays > 365) return { ok: false, msg: 'Expected days to pay must be a whole number from 1 to 365.' }
  if (!Number.isFinite(coinsPct) || coinsPct < 0 || coinsPct > 100 || !twoDp(coinsPct)) return { ok: false, msg: 'Estimated payer share must be 0 to 100% with at most 2 decimals.' }
  if (!Number.isFinite(copay) || copay < 0 || copay > 10000 || !twoDp(copay)) return { ok: false, msg: 'Copay must be a dollar amount from 0 to 10,000 with at most 2 decimals.' }
  if (filing != null && (!Number.isInteger(filing) || filing < 1 || filing > 999)) return { ok: false, msg: 'Filing deadline must be a whole number from 1 to 999 days, or blank for the practice default.' }
  const policy = { ...payerPolicy(p.name, state), kind: input.kind, avgDays, coins: Math.round(coinsPct * 100) / 10000, copay }
  return { ok: true, msg: `${p.name} payment terms saved`, payer: { id: p.id, policy, ext: { ...(p.ext || {}), filingDeadlineDays: filing } } }
}

export const CLAIM_STATUSES = {
  draft: { label: 'Draft', ink: 'var(--muted)', bg: 'var(--panel-3)' },
  submitted: { label: 'Submitted', ink: '#0369a1', bg: '#e0f2fe' },
  partially_paid: { label: 'Partially paid', ink: '#a16207', bg: '#fef3c7' },
  paid: { label: 'Paid', ink: '#047857', bg: '#d7f5e8' },
  denied: { label: 'Denied', ink: '#b91c1c', bg: '#fee2e2' },
  void: { label: 'Void', ink: 'var(--muted)', bg: 'var(--panel-3)' },
}

export const DENIAL_REASONS = [
  { id: 'elig', label: 'Member not eligible / no active auth on DOS', fix: 'Verify authorization window, then rebill' },
  { id: 'verif', label: 'Documentation requested: session notes missing', fix: 'Attach notes to the flagged sessions, then rebill with them included' },
  { id: 'code', label: 'Coding error: invalid code or modifier', fix: 'Correct the charge lines below, then rebill' },
  { id: 'dup', label: 'Duplicate line: already paid on a prior claim', fix: 'Drop the duplicate line(s), then rebill the rest' },
  { id: 'timely', label: 'Timely filing limit exceeded', fix: 'Appeal with proof of service, or write off' },
]
// Remittance adjustment codes (CARC, with their group) and what to do about them. The
// practice edits both lists in Settings → Billing defaults; these are the defaults.
export const CARC_HINTS = [
  { code: 'CO-4', label: 'Procedure code inconsistent with the modifier used', fix: 'Check the line modifiers (credential, place of service, payer service) against the payer rules, then correct and resubmit.' },
  { code: 'CO-16', label: 'Missing or incomplete claim information', fix: 'Review required claim fields and resubmit with corrections.' },
  { code: 'CO-18', label: 'Exact duplicate claim or service', fix: 'Check whether the service was already paid on another claim before resubmitting.' },
  { code: 'CO-22', label: 'May be covered by another payer (coordination of benefits)', fix: "Confirm the client's primary and secondary coverage, then bill the primary payer first." },
  { code: 'CO-27', label: 'Expenses incurred after coverage terminated', fix: 'Verify eligibility on the date of service; bill the active payer or the family.' },
  { code: 'CO-29', label: 'Filing limit exceeded', fix: 'Check the timely filing limit and submission proof.' },
  { code: 'CO-50', label: 'Medical necessity not established', fix: 'Review medical-necessity documentation and appeal instructions.' },
  { code: 'CO-96', label: 'Non-covered charge', fix: 'Check the member benefit and code coverage before appealing.' },
  { code: 'CO-151', label: 'Information does not support this many services or units', fix: 'Compare billed units with the authorization and MUE limits; correct units or appeal with session notes.' },
  { code: 'CO-197', label: 'Precertification/authorization/notification absent', fix: 'Verify the authorization and dates of service, then correct or appeal.' },
  { code: 'CO-252', label: 'An attachment or other documentation is required', fix: 'Send the requested documentation (session notes, treatment plan) and resubmit.' },
]
export const denialReasonsOf = (state) => {
  const list = state?.settings?.billing?.denialReasons
  return Array.isArray(list) && list.length ? list : DENIAL_REASONS
}
export const carcHintsOf = (state) => {
  const list = state?.settings?.billing?.carcHints
  return Array.isArray(list) ? list : CARC_HINTS
}
export const denialOf = (id, state) => { const list = denialReasonsOf(state); return list.find((d) => d.id === id) || list[0] }

/** Validate the practice's denial reasons and CARC hints before they are saved. */
export function planReasonLists({ denialReasons = [], carcHints = [] } = {}) {
  const txt = (v, n) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n)
  const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)
  const reasons = []
  for (const r of denialReasons) {
    const label = txt(r.label, 120)
    if (label.length < 3) return { ok: false, msg: 'Every denial reason needs a label of at least 3 characters.' }
    if (reasons.some((x) => x.label.toLowerCase() === label.toLowerCase())) return { ok: false, msg: `The denial reason “${label}” is listed twice.` }
    let id = txt(r.id, 40) || slug(label) || 'reason'
    while (reasons.some((x) => x.id === id)) id = `${id}-2`
    reasons.push({ id, label, fix: txt(r.fix, 200) })
  }
  if (!reasons.length) return { ok: false, msg: 'Keep at least one denial reason.' }
  const hints = []
  for (const h of carcHints) {
    const code = txt(h.code, 12).toUpperCase().replace(/\s+/g, '')
    if (!/^(CO|PR|OA|PI|CR)-[A-Z0-9]{1,5}$/.test(code)) return { ok: false, msg: `“${code || 'blank'}” is not a group and reason code like CO-197.` }
    if (hints.some((x) => x.code === code)) return { ok: false, msg: `${code} is listed twice.` }
    const label = txt(h.label, 120)
    if (label.length < 3) return { ok: false, msg: `${code} needs a description of at least 3 characters.` }
    hints.push({ code, label, fix: txt(h.fix, 200) })
  }
  return { ok: true, msg: 'Denial reasons and remittance hints saved', denialReasons: reasons, carcHints: hints }
}

// ---------- chart identifiers on claims (plus the seed's demo staff NPIs) ----------
function hashNum(s) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) }
  return Math.abs(h)
}
// Claim identifiers come from the chart only. A blank stays blank: the claim gate holds an
// insurance claim that lacks one, and the CMS-1500 export refuses it (`claimChartIssues`).
export const memberIdOf = (c) => String(c?.memberId || '').trim()
export const authNoOf = (c) => String(c?.authNo || '').trim()
export const npiOf = (staffId) => {
  const base = ('1' + String(12000000 + (hashNum(staffId || 'x') % 79999999)).padStart(8, '0')).slice(0, 9)
  return base + npiCheck(base)
}

// ICD-10-CM shape: letter, digit, digit-or-letter, then an optional dot and up to 4 more.
export const ICD10_RE = /^[A-Z][0-9][0-9A-Z](\.[0-9A-Z]{1,4})?$/
/** Diagnosis codes as typed (array or "F84.0, R41.82"), trimmed and upper-cased. */
export const dxCodesOf = (v) => (Array.isArray(v) ? v : String(v || '').split(/[\s,;]+/)).map((x) => String(x).trim().toUpperCase()).filter(Boolean)
/** The client's charted ICD-10 codes. Never derived from the program: none on file → []. */
export const dxFor = (client) => dxCodesOf(client?.dxCodes)

/**
 * What the chart must hold before an insurance claim can go out or print on a CMS-1500:
 * member ID (item 1a), at least one ICD-10 code (item 21), and the authorization number
 * (item 23) when strict authorization is on (Settings → System → Billing). Returns one
 * message per gap, each naming where to fill it in. Self-pay invoices need none of them.
 */
export function claimChartIssues(state, claim) {
  if (claim.mode === 'selfpay') return []
  const client = (state.clients || []).find((c) => c.id === claim.clientId) || {}
  const coverage = claim.method === 'secondary' ? client.secondary || {} : client
  const where = `Clients → ${client.name || 'client'} → Edit`
  const out = []
  if (!memberIdOf(coverage)) out.push(`Needs member ID: add the ${claim.payer} member ID in ${where}${claim.method === 'secondary' ? ' → Secondary insurance' : ' → Member ID (claims)'}.`)
  const dx = dxFor(client)
  if (!dx.length) out.push(`Needs diagnosis: add the ICD-10 code(s) in ${where} → Diagnosis codes (ICD-10).`)
  else if (dx.some((c) => !ICD10_RE.test(c))) out.push(`Diagnosis code ${dx.find((c) => !ICD10_RE.test(c))} is not an ICD-10 code: fix it in ${where} → Diagnosis codes (ICD-10).`)
  if (state.settings?.billing?.strictAuth === true && !authNoOf(coverage)) out.push(`Needs authorization number: strict authorization is on, so add it in ${where}${claim.method === 'secondary' ? ' → Secondary insurance' : ' → Authorization # (claims)'}.`)
  return out
}

// ---------- staging: everything claim-ready right now ----------
export function stagedAppts(state, days) {
  const needVer = state.settings.billing?.requireVerification !== false
  const strictAuth = state.settings.billing?.strictAuth === true
  const statusMap = Object.fromEntries((state.settings?.apptStatuses || []).map((s) => [s.key, s]))
  const isBillableStatus = (st) => {
    const cfg = statusMap[st]
    if (cfg) return cfg.billable === true
    return st === 'completed'
  }
  const clientById = Object.fromEntries((state.clients||[]).map((c)=>[c.id,c]))
  const clientIds = new Set((state.clients || []).map((c) => c.id))
  const list = Object.values(state.appts)
    .filter((a) => a.clientIds?.[0] && clientIds.has(a.clientIds[0]))
    .filter((a) => !days || days.includes(a.date))
    .filter((a) => TYPES[a.type]?.billable && isBillableStatus(a.status) && !a.billing?.status)
    .filter((a) => (a.billing?.units > 0) || (a.billing?.mileage && a.billing?.distance > 0))
    .filter((a) => !needVer || !TYPES[a.type].hasVerification || a.verification?.verifyStatus === 'verified')
    .filter((a) => {
      if (!strictAuth) return true
      const c = clientById[a.clientIds?.[0]]
      if (!c) return true
      if (c.authStart && a.date < c.authStart) return false
      if (c.authEnd && a.date > c.authEnd) return false
      if (!c.authStart || !c.authEnd) return false
      return true
    })
  return list.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.start - b.start))
}

// ---------- assembly: group staging lines into claim plans (client × DOS-month; self-pay = one invoice) ----------
export function planClaims(state, appts) {
  const clients = Object.fromEntries((state.clients || []).map((c) => [c.id, c]))
  const groups = new Map()
  for (const a of appts) {
    const c = clients[a.clientIds?.[0]]
    if (!c) continue
    const payer = c.insurer || 'Self-pay'
    const mode = payer === 'Self-pay' ? 'selfpay' : 'insurance'
    const key = `${c.id}|${mode}|${mode === 'selfpay' ? 'inv' : `${a.date.slice(0, 7)}|${separateKey(state, payer, a)}`}`
    const g = groups.get(key) || { clientId: c.id, client: c.name, payer, mode, dosFrom: a.date, dosTo: a.date, appts: [], charges: 0, units: 0 }
    g.appts.push(a.id)
    g.dosFrom = a.date < g.dosFrom ? a.date : g.dosFrom
    g.dosTo = a.date > g.dosTo ? a.date : g.dosTo
    g.charges = r2(g.charges + computeBilling(a))
    g.units += a.billing?.mileage ? 1 : a.billing?.units || 0
    groups.set(key, g)
  }
  return [...groups.values()].sort((x, y) => (x.dosFrom < y.dosFrom ? -1 : 1))
}

// CMS place-of-service code from where a session happened
export function posFor(appt) {
  const loc = String(appt?.location || '').toLowerCase()
  if (/home/.test(loc)) return '12' // home
  if (/school/.test(loc)) return '03' // school
  if (/telehealth|video/.test(loc)) return '10' // telehealth in the patient's home
  if (/community/.test(loc)) return '99' // other place of service
  return '11' // office
}

/**
 * Line modifiers (box 24D, up to four), in order:
 * 1. the payer's own modifier for the service (Payer → Services);
 * 2. the rendering provider's credential (HO / HN / HM / HP) — the Medicaid norm, on unless
 *    the payer turns it off in Billing Rules → Claims Settings;
 * 3. the payer's Qualification Modifiers pair for the rendering provider's education level
 *    (Billing Rules → Qualification Modifiers; the first matching row in row order);
 * 4. the payer's place-of-service modifier for the session's POS.
 * Duplicates collapse, so a qualification code equal to the credential code adds nothing.
 * Self-pay invoices carry none.
 */
export function lineModifiers(state, a, payerName, mode) {
  if (mode === 'selfpay') return ''
  const p = (state.payers || []).find((x) => x.name === payerName) || {}
  const rules = p.rules || {}
  const svcMod = a.service ? p.svcOv?.[a.service]?.modifier || (p.svcs || []).find((s) => s.id === a.service)?.modifier || '' : ''
  const staff = (state.staff || []).find((s) => s.id === a.staffIds?.[0])
  const cred = rules.claims?.flags?.credentialMods === false || !staff ? '' : CRED_MODIFIERS[credOf(staff.role)] || ''
  const qual = qualificationModifiersFor(staff, p)
  const posMod = (rules.posMods || []).find((r) => r.pos === posFor(a))?.mod || ''
  return [...new Set([svcMod, cred, qual?.m1, qual?.m2, posMod].filter(Boolean))].slice(0, 4).join(' ')
}

/**
 * The payer's Qualification Modifiers pair for a rendering provider, or null. A row matches
 * when its `qual` equals the staff member's recorded education level, or a "·"-part of their
 * role or cert (so a "Teacher", "Therapist" or "Specialist" row still matches a job title).
 * The first matching row in row order wins — the order the payer editor lets a user set.
 */
export function qualificationModifiersFor(staff, payer) {
  const rows = payer?.rules?.qualMods?.length ? payer.rules.qualMods : DEFAULT_QM
  if (!staff) return null
  const tokens = new Set(staffQualifierTokens(staff))
  const row = rows.find((r) => r.qual && tokens.has(qualKey(r.qual)))
  return row ? { m1: row.m1 || '', m2: row.m2 || '', qual: row.qual } : null
}

// Staff rows carry free text (cert "BCBA #5-12-0034", role "BCBA · Clinical Supervisor"), so
// a value is also read as its "·" parts and each part without its "#number" — never compared raw.
export function staffQualifierTokens(staff) {
  const out = []
  for (const value of [staff.education, staff.cert, staff.role]) {
    const s = String(value || '').trim()
    if (!s) continue
    out.push(s)
    for (const part of s.split('·').map((p) => p.trim()).filter(Boolean)) out.push(part, part.split('#')[0].trim())
  }
  return [...new Set(out.filter(Boolean).map(qualKey))]
}

const qualKey = (v) => String(v).replace(/[’‘]/g, "'").trim().toLowerCase().replace(/\s+degree$/, '')

const MILEAGE_CODE_RE = /^[A-Z0-9]{5}$/

/** Normalize a payer-entered CPT/HCPCS mileage code without guessing one. */
export function normalizeMileageCode(value) {
  const code = String(value ?? '').trim().toUpperCase()
  if (!code) return { ok: true, code: '' }
  if (code === '14220') return { ok: false, code: '', msg: 'CPT 14220 is a surgery code, not a mileage code. Enter the code approved by this payer.' }
  if (!MILEAGE_CODE_RE.test(code)) return { ok: false, code: '', msg: 'A mileage billing code must be exactly 5 letters or digits.' }
  return { ok: true, code }
}

/** Payer-specific mileage code; an absent or malformed value stays blank, never guessed. */
export const mileageCodeFor = (payer) => normalizeMileageCode(payer?.rules?.claims?.mileageCode).code

/** Explain why a mileage line is not valid under the payer's current Claims Settings. */
export function mileageCodeIssue(lineCode, payer) {
  const line = normalizeMileageCode(lineCode)
  if (!line.ok) return line.msg
  const configured = normalizeMileageCode(payer?.rules?.claims?.mileageCode)
  if (!configured.ok) return `The payer's saved mileage code is invalid. ${configured.msg}`
  if (!configured.code) return 'No payer-specific mileage code is configured for this payer.'
  if (!line.code) return 'No payer-specific mileage code is on this draft.'
  if (line.code !== configured.code) return `This draft uses ${line.code}, but the payer's current mileage code is ${configured.code}. Rebuild this draft.`
  return ''
}

export function lineFor(a, state, plan = {}) {
  const staff = Object.fromEntries((state.staff || []).map((s) => [s.id, s]))
  const b = a.billing || {}
  const codeDef = BILL_CODES.find((c) => c.id === b.code)
  if (b.mileage && !b.units) {
    const payer = (state.payers || []).find((p) => p.id === plan.payerId || p.name === plan.payer)
    const code = plan.mode === 'selfpay' ? '' : mileageCodeFor(payer)
    const rate = state.settings.mileageRate ?? b.mileageRate ?? 0.7
    return { apptId: a.id, dos: a.date, t0: a.start, t1: a.end, code, desc: `Travel ${a.title || ''}`.trim(), units: b.distance || 0, rate, charge: r2((b.distance || 0) * rate), staff: names(a.staffIds, staff), kind: 'mileage' }
  }
  return { apptId: a.id, dos: a.date, t0: a.start, t1: a.end, code: b.code || '—', mod: lineModifiers(state, a, plan.payer, plan.mode), desc: a.title || codeDef?.label.split(' · ')[1] || 'Treatment', units: b.units || 0, rate: b.rate || codeDef?.rate || 0, charge: r2(computeBilling(a)), staff: names(a.staffIds, staff), kind: 'session' }
}
const names = (ids, staff) => (ids || []).map((i) => staff[i]?.name || i).join(', ')

export function nextClaimSeq(claims) {
  let max = 0
  for (const c of Object.values(claims || {})) {
    const m = /-(\d{3,4})(-R\d+)?$/.exec(c.no || '')
    if (m) max = Math.max(max, Number(m[1]))
  }
  return max + 1
}
export const claimNoAt = (prefix, seq, iso) => `${prefix}-${iso.slice(0, 4)}${iso.slice(5, 7)}-${String(seq).padStart(3, '0')}`

// Every appointment a claim line bills. A merged same-day line bills several.
export const lineApptIds = (l) => l.apptIds || [l.apptId]
const lineUnits = (lines) => lines.reduce((t, l) => t + (l.kind === 'mileage' ? 1 : l.units), 0)

/**
 * Medicaid / CPT: one code, one client, one date of service, one rendering provider is one
 * line. Minutes are added up first and rounded once under the sessions' unit rule. Sessions
 * whose unit rule or rate differ stay on separate lines.
 */
export function mergeSameDayLines(lines, apptsById) {
  const out = []
  const at = new Map()
  for (const l of lines) {
    const b = apptsById[l.apptId]?.billing || {}
    const key = l.kind === 'session' && b.unitMins > 0 ? [l.dos, l.code, l.mod, apptsById[l.apptId]?.staffIds?.[0] || '', l.rate, b.unitMins, b.rounding || 'AMA'].join('|') : null
    if (!key || !at.has(key)) { if (key) at.set(key, out.length); out.push(l); continue }
    const i = at.get(key)
    const m = out[i]
    const ids = [...lineApptIds(m), l.apptId]
    const minutes = ids.reduce((t, id) => t + (apptsById[id].billing?.minutes || apptsById[id].end - apptsById[id].start), 0)
    const units = unitsFor(minutes, b.unitMins, b.rounding || 'AMA')
    const desc = `${String(m.desc).replace(/ · \d+ sessions$/, '')} · ${ids.length} sessions`
    out[i] = { ...m, apptIds: ids, desc, t0: Math.min(m.t0, l.t0), t1: Math.max(m.t1, l.t1), minutes, units, charge: r2(units * m.rate) }
  }
  return out
}

// Payer rule "Separate Claim By": the extra key that splits one client-month into claims.
function separateKey(state, payerName, a) {
  const by = (state.payers || []).find((p) => p.name === payerName)?.rules?.claims?.separateBy
  if (by === 'Rendering Provider' || by === 'Service Provider') return a.staffIds?.[0] || ''
  if (by === 'Place of Service') return posFor(a)
  return '' // 'Supervising Provider' needs a supervisor on the session, which the app does not record
}

// assemble → actual claim objects (used by the store action AND the demo seeder)
export function assembleClaims(state, plans, { seqStart, at = Date.now() } = {}) {
  let seq = seqStart ?? nextClaimSeq(state.claims)
  const prefix = state.settings.billing?.claimPrefix || 'CLM'
  const byId = Object.fromEntries(Object.values(state.appts).map((a) => [a.id, a]))
  const claims = []
  for (const p of plans) {
    const client = (state.clients || []).find((c) => c.id === p.clientId) || { id: p.clientId, name: p.client }
    const mergeDay = p.mode !== 'selfpay' && (state.payers || []).find((x) => x.name === p.payer)?.rules?.claims?.flags?.mergeSameDay !== false
    const raw = p.appts.map((id) => lineFor(byId[id], state, p))
    const lines = mergeDay ? mergeSameDayLines(raw, byId) : raw
    claims.push({
      id: `clm-${prefix.toLowerCase()}-${seq}-${at.toString(36)}`,
      no: claimNoAt(prefix, seq, p.dosFrom),
      clientId: p.clientId, payer: p.payer, mode: p.mode,
      dosFrom: p.dosFrom, dosTo: p.dosTo,
      lines,
      status: 'draft', charges: r2(lines.reduce((t, l) => t + l.charge, 0)), units: lineUnits(lines),
      adj: 0, paid: 0, patientPaid: 0, remittance: null, denial: null, parentNo: null, version: 1,
      submittedAt: null, closedAt: null, note: '',
      createdAt: at, history: [{ at, ev: `Draft assembled from staging: ${lines.length} charge line${lines.length > 1 ? 's' : ''}${lines.length < raw.length ? ` (${raw.length} sessions; same-day time per code added up)` : ''}, ${p.dosFrom} to ${p.dosTo}` }],
    })
    seq++
  }
  return { claims, apptPatch: claims.flatMap((c) => c.lines.flatMap(lineApptIds).map((id) => ({ id, patch: { claimId: c.id, billing: { ...(byId[id].billing || {}), status: 'claimed', claimNo: c.no } } }))) }
}

// ---------- submission gate (mirrors the validation rules at claim level) ----------
export function claimGate(state, claim) {
  const needVer = state.settings.billing?.requireVerification !== false
  const strictAuth = state.settings.billing?.strictAuth === true
  const supCheck = state.settings.billing?.supervisionCheck !== false
  const today = isoDate(new Date())
  const idPayer = claim.mode === 'selfpay' ? null : (state.payers || []).find((p) => p.id === claim.payerId || p.name === claim.payer) || null
  // chart gaps hold the whole claim, not one line
  const bad = claimChartIssues(state, claim).map((why) => ({ line: null, why }))
  for (const [l, apptId] of claim.lines.flatMap((x) => lineApptIds(x).map((id) => [x, id]))) {
    const a = state.appts[apptId]
    if (!a) { bad.push({ line: l, why: 'The source appointment no longer exists. Drop this line.' }); continue }
    if (a.billing?.status === 'billed') { bad.push({ line: l, why: 'Line was already billed outside a claim' }); continue }
    if (!(a.billing?.units > 0) && !(a.billing?.mileage && a.billing?.distance > 0)) bad.push({ line: l, why: `Missing billable units on ${l.dos}` })
    if (claim.mode !== 'selfpay' && l.kind === 'mileage') {
      const issue = mileageCodeIssue(l.code, idPayer)
      if (issue) bad.push({ line: l, why: `${issue} Set the code in Masters → Payer → Billing Rules → Claims Settings (or remove mileage if it is not covered), then rebuild this draft.` })
    }
    if (needVer && TYPES[a.type]?.hasVerification && a.verification?.verifyStatus !== 'verified') bad.push({ line: l, why: `Session on ${l.dos} has not passed verification. Open the session and verify it.` })
    // timely filing gate (U3)
    if (claim.timelyDue && today > claim.timelyDue) bad.push({ line: l, why: `Timely filing deadline passed on ${claim.timelyDue} (DOS ${l.dos})` })
    // strict auth gate (D2)
    if (strictAuth) {
      const client = (state.clients||[]).find((c)=>c.id===claim.clientId)
      if (client) {
        if (client.authStart && l.dos < client.authStart) bad.push({ line: l, why: `Authorization not active yet on ${l.dos}. It starts ${client.authStart}.` })
        if (client.authEnd && l.dos > client.authEnd) bad.push({ line: l, why: `Authorization lapsed on ${l.dos}. It ended ${client.authEnd}.` })
        if (!client.authStart || !client.authEnd) bad.push({ line: l, why: `No active authorization window on file for ${client.name||'client'} (DOS ${l.dos})` })
      }
    }
    // supervision check (D2)
    if (supCheck && a) {
      const staff = (state.staff||[]).filter((s)=>(a.staffIds||[]).includes(s.id))
      const hasRBT = staff.some((s)=>/RBT/.test(s.role||''))
      const hasBCBA = staff.some((s)=>/BCBA/.test(s.role||''))
      if (hasRBT && !hasBCBA) bad.push({ line: l, why: `Supervision required: RBT-only session on ${l.dos} with no BCBA` })
    }
    // provider identifiers: once a payer chooses NPI / Medicaid ID / both, every
    // rendering staff member must carry what it asks for
    if (idPayer && providerIdRule(idPayer).explicit) {
      for (const sid of a.staffIds || []) {
        const issue = providerIdIssues(state, idPayer, sid)[0]
        if (issue) bad.push({ line: l, why: `${issue} (DOS ${l.dos})` })
      }
    }
  }
  return { ok: !bad.length, bad }
}

// ---------- transitions (pure: return claim patch + appt patches) ----------
const ev = (text, at) => ({ at: at || Date.now(), ev: text })

export function submitPatch(state, claim) {
  const at = Date.now()
  return {
    claim: { ...claim, status: 'submitted', submittedAt: claim.submittedAt || at, history: [...claim.history, ev(claim.mode === 'selfpay' ? `Invoice marked sent to family (${claim.payer}); the app sends nothing` : `Marked submitted to ${claim.payer}; claim file saved locally, not transmitted`, at)] },
    apptPatches: claim.lines.flatMap(lineApptIds).map((id) => ({ id, patch: { billing: { ...(state.appts[id]?.billing || {}), status: 'claimed', claimNo: claim.no, submittedAt: at } } })),
  }
}
export function payPatch(claim, { amount, checkNo, adj, note, paidAt = Date.now() }) {
  const at = paidAt
  const nextAdj = r2(Math.max(0, adj || 0))
  const due = r2(claim.charges - nextAdj - (claim.paid || 0) - (claim.secondaryPaid || 0) - (claim.patientPaid || 0) - amount)
  const rem = { checkNo, amount, adj: nextAdj, note, at }
  // chunk-40 (U5): a payment that leaves a patient-responsibility remainder keeps the claim
  // open as partially_paid — it only closes at zero due (secondary or patient invoice follows)
  const status = due <= 0 ? 'paid' : 'partially_paid'
  return { claim: { ...claim, status, paid: r2((claim.paid || 0) + amount), adj: nextAdj, remittance: rem, closedAt: due <= 0 ? at : claim.closedAt, history: [...claim.history, ev(`Payment posted: $${amount.toLocaleString()} via ${checkNo}${nextAdj ? ` (${nextAdj.toLocaleString()} adjustment)` : ''}${due > 0 ? `, $${due} still open` : ''}`, at)] } }
}
export function denyPatch(claim, { code, note }, state) {
  const at = Date.now()
  const d = denialOf(code, state)
  return { claim: { ...claim, status: 'denied', denial: { code: d.id, reason: d.label, fix: d.fix, note: note || '', at }, history: [...claim.history, ev(`Denied: ${d.label}`, at)] } }
}
export function releasePatch(state, claim, kind, extraHist) {
  const at = Date.now()
  return {
    claim: { ...claim, status: 'void', closedAt: at, history: [...claim.history, ev(extraHist || `Voided. ${claim.lines.length} line${claim.lines.length > 1 ? 's' : ''} released back to staging`, at)] },
    apptPatches: claim.lines.flatMap(lineApptIds).map((id) => ({ id, patch: { claimId: null, billing: { ...(state.appts[id]?.billing || {}), status: null, claimNo: null, submittedAt: null } } })),
    kind,
  }
}
// drop one line from a draft/void-pending claim → back to staging; claim re-totaled (or removed if empty)
export function dropLinePatch(state, claim, apptId) {
  const at = Date.now()
  // a merged same-day line goes back whole: every session it bills returns to staging
  const dropped = claim.lines.find((l) => lineApptIds(l).includes(apptId))
  const released = dropped ? lineApptIds(dropped) : [apptId]
  const lines = claim.lines.filter((l) => l !== dropped)
  const charges = r2(lines.reduce((t, l) => t + l.charge, 0))
  const units = lineUnits(lines)
  if (!lines.length) {
    return { removeClaim: true, released, claim: { ...claim, lines, charges, units, history: [...claim.history, ev(`Last line removed, claim dissolved`, at)] } }
  }
  return {
    released,
    claim: { ...claim, lines, charges, units, adj: Math.min(claim.adj, charges), history: [...claim.history, ev(`Line removed: ${dropped?.code} on ${dropped?.dos}, back to staging`, at)] },
  }
}
export function rebillPatch(state, claim, dropIds, { seqStart } = {}) {
  const at = Date.now()
  const keep = claim.lines.filter((l) => !lineApptIds(l).some((id) => dropIds.includes(id)))
  const releaseIds = claim.lines.filter((l) => !keep.includes(l)).flatMap(lineApptIds)
  const voided = { ...claim, status: 'void', closedAt: at, history: [...claim.history, ev(`Voided for rebill as ${claim.no}-R${claim.version + 1}`, at)] }
  const charges = r2(keep.reduce((t, l) => t + l.charge, 0))
  const next = {
    ...claim, id: `${claim.id}-r${claim.version + 1}`, no: claim.no.replace(/-R\d+$/, '') + `-R${claim.version + 1}`,
    version: claim.version + 1, parentNo: claim.no, status: 'draft', lines: keep, charges,
    units: lineUnits(keep),
    adj: 0, paid: 0, remittance: null, denial: null, submittedAt: null, closedAt: null, createdAt: at,
    history: [{ at, ev: `Rebill draft from ${claim.no}: ${dropIds.length ? `dropped ${dropIds.length} disputed line${dropIds.length > 1 ? 's' : ''} back to staging` : 'lines unchanged'}` }],
  }
  return { voided, next, apptPatches: [
    ...releaseIds.map((id) => ({ id, patch: { claimId: null, billing: { ...(state.appts[id]?.billing || {}), status: null, claimNo: null } } })),
    ...keep.flatMap(lineApptIds).map((id) => ({ id, patch: { claimId: next.id, billing: { ...(state.appts[id]?.billing || {}), status: 'claimed', claimNo: next.no } } })),
  ] }
}

// ---------- money helpers for the form footer ----------
// A linked secondary claim is a filing of the *same* receivable, not another
// charge. Secondary receipts live on that claim and reduce its parent exactly once.
// Only the primary carries the practice receivable. Keep patient collections
// separate from payer cash and secondary cash so a reported PR is never mistaken
// for another payer payment. Old workspaces without patientPaid read as zero.
export const dueOf = (c) => r2(c.charges - (c.adj || 0) - (c.paid || 0) -
  (c.method === 'secondary' ? 0 : (c.secondaryPaid || 0) + (c.patientPaid || 0)))
export const isPrimaryReceivable = (c) => c.method !== 'secondary' && c.status !== 'void'
export const PATIENT_AR_BUCKET = 'Patient / family (reported PR + self-pay)'

// The claim aggregate must equal active, claim-linked patient receipts. Signed
// reversals cancel their originals; an unexplained mismatch must not create a
// collectible patient balance. Unapplied receipts and payer payments are ignored.
export function patientLedgerMatches(state, primary) {
  const patientPaid = primary.patientPaid ?? 0
  if (typeof patientPaid !== 'number' || !Number.isFinite(patientPaid) || patientPaid < 0 ||
      Math.abs(patientPaid * 100 - Math.round(patientPaid * 100)) > 0.000001 ||
      patientPaid > r2(primary.charges - (primary.paid || 0) - (primary.adj || 0) - (primary.secondaryPaid || 0))) return false
  const payments = Object.values(state.payments || {})
  const originals = payments.filter((p) => p.kind === 'patient' && p.claimId === primary.id && !p.reversalOf)
  const reversals = payments.filter((p) => p.kind === 'patient' && p.claimId === primary.id && p.reversalOf)
  const reversed = new Set()
  for (const p of reversals) {
    const original = state.payments?.[p.reversalOf]
    if (!original || original.kind !== 'patient' || original.reversalOf || original.claimId !== primary.id ||
        p.clientId !== primary.clientId || reversed.has(p.reversalOf) ||
        typeof p.amount !== 'number' || !Number.isFinite(p.amount) ||
        Math.abs(p.amount * 100 - Math.round(p.amount * 100)) > 0.000001 ||
        Math.round(p.amount * 100) !== -Math.round(original.amount * 100)) return false
    reversed.add(p.reversalOf)
  }
  if (originals.some((p) => p.clientId !== primary.clientId || typeof p.amount !== 'number' || !Number.isFinite(p.amount) ||
      p.amount <= 0 || Math.abs(p.amount * 100 - Math.round(p.amount * 100)) > 0.000001 ||
      payments.some((r) => r.reversalOf === p.id && (r.kind !== 'patient' || r.claimId !== primary.id)))) return false
  return Math.round(patientPaid * 100) === originals.filter((p) => !reversed.has(p.id))
    .reduce((sum, p) => sum + Math.round(p.amount * 100), 0)
}

// A filing changes the work queue, not the underlying charge. Closed/denied
// secondary filings with a residual are a review bucket, not a new payer debt.
export function receivableBucketOf(state, primary) {
  if (primary.cobReviewNeeded || !patientLedgerMatches(state, primary)) return 'Ledger mismatch / review'
  const child = state.claims?.[primary.secondary]
  if (child?.method !== 'secondary' || child.secondary !== primary.id || child.status === 'void') return primary.payer
  if (child.status === 'draft') return 'COB draft / review'
  if (['submitted', 'partially_paid'].includes(child.status)) return child.payer
  return 'COB remainder / review'
}

// A reported PR is only the payer-identified portion of an open primary balance,
// never an inference from the remainder. A linked secondary supersedes the
// primary's PR report; an unadjudicated secondary has no patient amount yet.
// Patient cash reduces both the primary A/R and the *remaining* reported PR.
export function patientResponsibilityOf(state, primary) {
  if (!isPrimaryReceivable(primary) || primary.status === 'draft' || primary.cobReviewNeeded ||
      !patientLedgerMatches(state, primary)) return 0
  const remaining = Math.max(0, dueOf(primary))
  if (primary.mode === 'selfpay') return remaining
  const linked = state.claims?.[primary.secondary]
  const source = linked?.method === 'secondary' && linked.secondary === primary.id && linked.status !== 'void' ? linked : primary
  if (source === linked && ['draft', 'submitted'].includes(linked.status)) return 0
  const payments = Object.values(state.payments || {})
  const reversed = new Set(payments.map((p) => p.reversalOf).filter(Boolean))
  const documented = payments.filter((p) => p.claimId === source.id && !p.reversalOf && p.patientResp != null)
  const latest = documented.filter((p) => !reversed.has(p.id))
    .reduce((last, p) => !last || (p.createdAt || 0) >= (last.createdAt || 0) ? p : last, null)
  // A reversed report cannot reappear via the claim's last-remittance cache.
  const reported = latest ? latest.patientResp : documented.length ? 0 : source.remittance?.patientResp || 0
  return r2(Math.min(remaining, Math.max(0, (Number(reported) || 0) - (primary.patientPaid || 0))))
}

export const copayOf = (c, client, state) => (c.mode === 'insurance' ? Math.min(payerPolicy(c.payer, state).copay * c.lines.length, c.charges) : 0)

// ---------- one aging engine ----------
// The AR Manager (arOf), the Billing desk (claimStats), the Claims Register and
// the claim drawer all age claims the same way: an open primary receivable ages
// from when it opened (submittedAt, else dosTo, else createdAt) into one shared
// five-bucket scheme. Draft, void, closed and zero-balance claims have no age.
export const AGING_BUCKETS = ['current', '31-60', '61-90', '91-120', '121+']
export const AGING_BUCKET_LABELS = { current: '0–30', '31-60': '31–60', '61-90': '61–90', '91-120': '91–120', '121+': '121+' }
export function agingBucketFor(days) {
  if (days <= 30) return 'current'
  if (days <= 60) return '31-60'
  if (days <= 90) return '61-90'
  if (days <= 120) return '91-120'
  return '121+'
}
export const agingSince = (c) => (c.submittedAt ? new Date(c.submittedAt) : c.dosTo ? parseISO(c.dosTo) : new Date(c.createdAt))

export function agingOf(c, today = isoDate(new Date()), state) {
  if (!c || !isPrimaryReceivable(c) || c.status === 'draft') return null
  if (dueOf(c) <= 0.005) return null
  const days = Math.max(0, Math.round((parseISO(today) - agingSince(c)) / 86400000))
  const avg = payerPolicy(c.payer, state).avgDays
  return { days, late: days > avg * 1.6, bucket: agingBucketFor(days) }
}

// ---------- portfolio stats for the KPI band ----------
export function claimStats(state, days) {
  const claims = Object.values(state.claims || {}).filter(isPrimaryReceivable)
  const inWin = claims.filter((c) => c.lines.some((l) => !days || days.includes(l.dos)))
  const staged = stagedAppts(state, days)
  const money = (arr, f) => Math.round(arr.reduce((t, c) => t + f(c), 0))
  const paid = inWin.filter((c) => c.status === 'paid')
  const denied = inWin.filter((c) => c.status === 'denied')
  const pending = inWin.filter((c) => c.status === 'submitted')
  const drafts = inWin.filter((c) => c.status === 'draft')
  const d2p = paid.filter((c) => c.submittedAt).map((c) => Math.max(0, Math.round((c.closedAt - c.submittedAt) / 86400000)))
  const buckets = Object.fromEntries(AGING_BUCKETS.map((b) => [b, 0]))
  let lateCount = 0
  for (const c of pending) { const a = agingOf(c, undefined, state);if (a) { buckets[a.bucket] += Math.round(Math.max(0, dueOf(c))); if (a.late) lateCount++ } }
  return {
    staged: { n: staged.length, $: Math.round(staged.reduce((t, a) => t + computeBilling(a), 0)) },
    drafts: { n: drafts.length, $: money(drafts, (c) => c.charges) },
    pending: { n: pending.length, $: money(pending, (c) => dueOf(c)), late: lateCount, buckets },
    denied: { n: denied.length, $: money(denied, (c) => Math.max(0, dueOf(c))) },
    paid: { n: paid.length, $: money(paid, (c) => (c.paid || 0) + (c.secondaryPaid || 0) + (c.patientPaid || 0)) },
    denialRate: paid.length + denied.length ? Math.round((denied.length / (paid.length + denied.length)) * 100) : 0,
    avgDaysToPay: d2p.length ? Math.round(d2p.reduce((t, x) => t + x, 0) / d2p.length) : null,
    closed: inWin.filter((c) => c.status === 'paid' || c.status === 'void' || c.status === 'denied').length,
  }
}


// ---------- AR engine (U5 / C4) ----------
export function arOf(state, asOfISO = isoDate(new Date())) {
  const asOf = parseISO(asOfISO)
  const claims = Object.values(state.claims || {})
  const payments = Object.values(state.payments || {})
  const clients = state.clients || []
  const clientById = Object.fromEntries(clients.map((c)=>[c.id,c]))

  const openClaims = claims.filter((c)=>{
    if (!isPrimaryReceivable(c) || c.status === 'draft') return false
    const due = dueOf(c)
    return due > 0.005
  })

  const byClientMap = {}
  const byPayerMap = {}
  const totals = { current:0, '31-60':0, '61-90':0, '91-120':0, '121+':0, totalAR:0, patientAR:0, over90:0 }

  // last active receipt per client (voided originals are not current activity).
  const lastPayByClient = {}
  const reversed = new Set(payments.map((p) => p.reversalOf).filter(Boolean))
  for (const p of payments) {
    if (p.reversalOf || reversed.has(p.id)) continue
    if (p.amount <=0 && p.kind!=='writeoff') continue
    const d = p.date
    if (!d) continue
    if (!lastPayByClient[p.clientId] || d > lastPayByClient[p.clientId].date) {
      lastPayByClient[p.clientId] = { date: d, kind: p.kind, ref: p.ref }
    }
  }

  for (const c of openClaims) {
    const due = dueOf(c)
    const patient = patientResponsibilityOf(state, c)
    const days = Math.max(0, Math.round((asOf - agingSince(c))/86400000))
    const bucket = agingBucketFor(days)

    // byClient
    if (!byClientMap[c.clientId]) {
      const cl = clientById[c.clientId] || { id:c.clientId, name:c.clientId }
      byClientMap[c.clientId] = { clientId:c.clientId, clientName: cl.name||c.clientId, buckets:{ current:0,'31-60':0,'61-90':0,'91-120':0,'121+':0 }, balance:0, patientAR:0, claims:[], lastPayment: lastPayByClient[c.clientId]||null }
    }
    byClientMap[c.clientId].buckets[bucket] = r2((byClientMap[c.clientId].buckets[bucket]||0)+due)
    byClientMap[c.clientId].balance = r2(byClientMap[c.clientId].balance+due)
    byClientMap[c.clientId].patientAR = r2(byClientMap[c.clientId].patientAR+patient)
    byClientMap[c.clientId].claims.push(c)

    // By active filing, with explicitly reported patient share kept in a
    // separate bucket. These are disjoint slices of ONE primary receivable.
    const addPayerSlice = (name, amount, patientSlice = false) => {
      if (amount <= 0) return
      if (!byPayerMap[name]) {
        byPayerMap[name] = { payer: name, buckets: { current:0, '31-60':0, '61-90':0, '91-120':0, '121+':0 },
          balance: 0, patientAR: 0, clientIds: new Set(), claims: [], claimDueById: {} }
      }
      const row = byPayerMap[name]
      row.buckets[bucket] = r2(row.buckets[bucket] + amount)
      row.balance = r2(row.balance + amount)
      if (patientSlice) row.patientAR = r2(row.patientAR + amount)
      row.clientIds.add(c.clientId)
      row.claims.push(c)
      row.claimDueById[c.id] = amount
    }
    addPayerSlice(receivableBucketOf(state, c), r2(due - patient))
    addPayerSlice(PATIENT_AR_BUCKET, patient, true)

    // totals
    totals[bucket] = r2((totals[bucket]||0)+due)
    totals.totalAR = r2(totals.totalAR+due)
    totals.patientAR = r2(totals.patientAR+patient)
    if (bucket==='91-120' || bucket==='121+') totals.over90 = r2(totals.over90+due)
  }

  const byClient = Object.values(byClientMap).map((row)=>{
    const over90 = r2((row.buckets['91-120']||0)+(row.buckets['121+']||0))
    const over90Pct = row.balance>0 ? Math.round((over90/row.balance)*100) : 0
    return { ...row, over90, over90Pct }
  }).sort((a,b)=>b.balance-a.balance)

  const byPayer = Object.values(byPayerMap).map((row)=>{
    const over90 = r2((row.buckets['91-120']||0)+(row.buckets['121+']||0))
    return { ...row, clientCount: row.clientIds.size, over90, claims: row.claims }
  }).sort((a,b)=>b.balance-a.balance)

  // DSO + collections rate + writeoff YTD
  const ninetyAgo = new Date(asOf.getTime() - 90*86400000)
  const yearStart = `${asOfISO.slice(0,4)}-01-01`
  let billed90 = 0, paid90 = 0, writeOffYTD = 0
  for (const c of claims) {
    if (isPrimaryReceivable(c) && c.dosFrom && c.dosFrom >= isoDate(ninetyAgo)) billed90 += c.charges
  }
  for (const p of payments) {
    if (p.date && p.date >= isoDate(ninetyAgo) && p.claimId) paid90 += Number(p.amount) || 0
    if (p.kind === 'writeoff' && p.date && p.date >= yearStart) writeOffYTD += Number(p.adj) || 0
  }
  paid90 = Math.max(0, r2(paid90))
  const dso = billed90>0 ? Math.round((totals.totalAR / (billed90/90))) : null
  const collectionsRate = (paid90+totals.totalAR)>0 ? Math.round((paid90/(paid90+totals.totalAR))*100) : null

  return { byClient, byPayer, totals: { ...totals, unassignedAR: r2(totals.totalAR - totals.patientAR), dso, collectionsRate, writeOffYTD: r2(writeOffYTD), billed90: r2(billed90), paid90: r2(paid90) }, asOf: asOfISO }
}

// ---------- exports (CSV for payers / accountants) ----------
export function claimCsv(state, claim) {
  const org = state.settings.org || {}
  const client = (state.clients || []).find((c) => c.id === claim.clientId) || {}
  const L = [
    `# ${org.name || 'Practice'}: Claim ${claim.no} (${claim.status}) · ${claim.mode === 'selfpay' ? 'Self-pay invoice' : claim.payer}`,
    `# Client ${client.name || claim.clientId} · member ${memberIdOf(claim.method === 'secondary' ? client.secondary : client) || 'not on file'} · DOS ${claim.dosFrom} → ${claim.dosTo} · Auth ${authNoOf(claim.method === 'secondary' ? client.secondary : client) || 'not on file'}`,
    `# Charges ${claim.charges.toFixed(2)} · Adjustments ${(claim.adj || 0).toFixed(2)} · Primary payer paid ${(claim.paid || 0).toFixed(2)} · Secondary received ${(claim.secondaryPaid || 0).toFixed(2)} · Patient received ${(claim.patientPaid || 0).toFixed(2)} · ${claim.method === 'secondary' ? 'Filing balance (not additional A/R)' : 'Primary A/R'} ${dueOf(claim).toFixed(2)}`,
    'line,date_of_service,hcpcs,mod,description,units,rate,charge,rendered_by',
    ...claim.lines.map((l, i) => `${i + 1},${l.dos},${l.code}${l.mod ? ',' + l.mod : ','},"${l.desc}",${l.units},${l.rate},${l.charge},"${l.staff}"`),
  ]
  return L.join('\n')
}
export function claimsCsv(state, claims) {
  const org = state.settings.org || {}
  const L = [
    `# ${org.name || 'Practice'}: claims register · ${claims.length} claim${claims.length > 1 ? 's' : ''}`,
    'claim,ledger_role,client,payer,mode,dos_from,dos_to,lines,units,charges,adj,payer_paid,secondary_received,patient_received,balance,remaining_reported_patient_share,status,submitted,paid_on',
    ...claims.map((c) => {
      const client = (state.clients || []).find((x) => x.id === c.clientId) || {}
      return `${c.no},${c.method === 'secondary' ? 'filing_not_ar' : 'primary_ar'},"${client.name || ''}",${c.payer},${c.mode},${c.dosFrom},${c.dosTo},${c.lines.length},${c.units},${c.charges},${c.adj || 0},${c.paid || 0},${c.secondaryPaid || 0},${c.patientPaid || 0},${dueOf(c)},${patientResponsibilityOf(state, c)},${c.status},${c.submittedAt ? isoDate(new Date(c.submittedAt)) : ''},${c.closedAt && c.status === 'paid' ? isoDate(new Date(c.closedAt)) : ''}`
    }),
  ]
  return L.join('\n')
}

// quick "post payment" presets, computed per claim
export function quickPosts(state, claim, client) {
  const pol = payerPolicy(claim.payer, state)
  const open = Math.max(0, dueOf(claim))
  const cp = claim.mode === 'insurance' ? Math.min(pol.copay * claim.lines.length, open) : 0
  const coins = r2(open * pol.coins)
  const out = [{ id: 'full', label: 'Full open balance', amount: open, adj: 0 }]
  if (claim.mode === 'insurance') out.push({ id: 'contract', label: `Estimate ${Math.round(pol.coins * 100)}%`, amount: Math.max(0, r2(coins - cp)), adj: r2(open - coins), note: 'Estimated contract adjustment. Check the remittance.' })
  if (cp) out.push({ id: 'copay', label: 'Leave estimated copay', amount: r2(open - cp), adj: 0, note: `Estimated copay $${cp}, not reported patient responsibility` })
  out.push({ id: 'writeoff', label: 'Write off open balance', amount: 0, adj: open, note: 'Uncollectible' })
  return out
}

// =====================================================================
// chunk-40 — Billing v2 foundations (U1 state v4 + U2 provider master)
// =====================================================================

// ---------- provider identifier reference ----------
export const TAXONOMIES = [
  { code: '101YP00000X', label: 'Behavior Analyst, BCBA (clinical)' },
  { code: '101Y01000X', label: 'Behavior Analyst (non-clinical)' },
  { code: '363AP0207X', label: 'Registered Behavior Technician (RBT)' },
  { code: '207Q00000X', label: 'Psychologist' },
  { code: '261QM0800X', label: 'Physical Therapist (referring)' },
]
export const PAYER_ID_TABS = [
  { id: 'general', label: 'General' },
  { id: 'ticare', label: 'Ticare ID' },
  { id: 'medicaid', label: 'Medicaid ID' },
  { id: 'bhpn', label: 'BHPN ID' },
  { id: 'referrers', label: 'Referring Provider' },
]

// NPI check digit — Luhn mod-10 exactly as CMS specifies it: computed as if the
// 80840 card-issuer prefix were present (hence the +24 constant), doubling from the
// rightmost digit of the 9-digit base.
export function npiCheck(base9) {
  let sum = 24
  for (let i = 0; i < 9; i++) { const d = Number(base9[i]) * (i % 2 === 0 ? 2 : 1); sum += d > 9 ? d - 9 : d }
  return String((10 - (sum % 10)) % 10)
}
export function validNpi(npi) {
  const n = String(npi || '').replace(/[^0-9]/g, '')
  return n.length === 10 && npiCheck(n.slice(0, 9)) === n[9]
}

// credential bucket from a staff role string ('BCBA · Clinical Supervisor' → 'BCBA')
export function credOf(role) {
  const r = String(role || '')
  if (/BCaBA/.test(r)) return 'BCaBA'
  if (/BCBA|Behavior Analyst/.test(r)) return 'BCBA'
  if (/RBT|Technician|Student/.test(r)) return 'RBT'
  if (/Psycholog/.test(r)) return 'Psychologist'
  return 'Other'
}

// ---------- credential matrix: who may render a code (spec §7.1) ----------
// seniority ladder — a higher credential may perform work a lower one is listed for
// (a BCBA always may render an RBT-level line; an RBT may NOT bill 97151/97155).
const CRED_RANK = { RBT: 1, BCaBA: 2, BCBA: 3, Psychologist: 3, Other: 0 }
export function credentialIssue(code, staffCred) {
  const def = BILL_CODES.find((c) => c.id === code)
  if (!def || !def.cred) return null
  const minRank = Math.min(...def.cred.map((c) => CRED_RANK[c] || 0))
  if ((CRED_RANK[staffCred] || 0) >= minRank) return null
  const need = def.cred.map((c) => ({ BCBA: 'a BCBA', BCaBA: 'a BCaBA', RBT: 'an RBT/technician', Psychologist: 'a Psychologist' }[c])).join(' or ')
  return `${code} requires ${need}, but was rendered by ${staffCred || 'unknown'}`
}

// ---------- provider resolution (spec §4.1 / §6.2) ----------
// rendering = the line's staff member (staff row w/ NPI, else null → gate);
// billing = a staff row flagged roles.billing (in line-staff order) → default billing
// provider (settings.billing.defaultBilling) → the office row;
// facility = a row flagged roles.facility → default facility (settings.billing.defaultFacility) → office.
export function resolveProviders(state, claim) {
  const prov = (state.settings?.providers || []).filter((p) => p.active)
  const office = prov.find((p) => p.kind === 'office' && p.npi)
  const staffOf = Object.fromEntries((state.staff || []).map((x) => [x.id, x]))
  const billDefault = prov.find((p) => p.id === state.settings?.billing?.defaultBilling) || prov.find((p) => p.kind === 'staff' && p.roles?.billing && p.npi)
  const facDefault = prov.find((p) => p.id === state.settings?.billing?.defaultFacility) || prov.find((p) => p.roles?.facility && p.npi) || office
  return claim.lines.map((l) => {
    const a = state.appts[l.apptId]
    const lineStaff = (a?.staffIds || []).map((id) => prov.find((p) => p.kind === 'staff' && p.refId === id && p.npi)).filter(Boolean)
    const render = lineStaff[0] || null
    const bill = lineStaff.find((p) => p.roles?.billing) || billDefault || office || null
    const fac = facDefault || office || null
    return { renderId: render?.id || null, billId: bill?.id || null, facId: fac?.id || null, staff: names(a?.staffIds || [], staffOf) }
  })
}

// ---------- secondary claim (COB) creation ----------
export function secondaryEligible(state, claim) {
  // A secondary is a transfer of an existing unpaid primary balance. A cloned
  // secondary must never become eligible for a third, recursively cloned claim.
  if (!claim || claim.method === 'secondary' || claim.status !== 'partially_paid' ||
      claim.secondary || claim.secondarySkipped || claim.cobReviewNeeded || !patientLedgerMatches(state, claim) ||
      (claim.patientPaid || 0) > 0 || dueOf(claim) <= 0 ||
      !claim.dosFrom || !claim.dosTo || claim.dosFrom > claim.dosTo || !(claim.lines || []).length) return false
  const client = (state.clients || []).find((c) => c.id === claim.clientId)
  const coverage = client?.secondary
  const payer = (state.payers || []).find((p) => p.id === coverage?.payerId)
  if (!payer || (payer.status && payer.status !== 'active') || !coverage?.memberId?.trim() || payer.name === claim.payer) return false
  if (coverage.since && claim.dosFrom && claim.dosFrom < coverage.since) return false
  if (coverage.until && claim.dosTo && claim.dosTo > coverage.until) return false
  return true
}
export function secondaryClaimPatch(state, primary, { id, at = Date.now(), sequence = 1 } = {}) {
  if (!secondaryEligible(state, primary)) return null
  const client = (state.clients || []).find((c) => c.id === primary.clientId)
  const secPayer = (state.payers || []).find((p) => p.id === client.secondary.payerId)
  const due = dueOf(primary)
  const filingDays = filingDaysOf(state, secPayer.name)
  const maxDos = (primary.lines || []).reduce((m, l) => l.dos > m ? l.dos : m, primary.dosTo || '')
  const timelyDue = maxDos ? isoDate(new Date(parseISO(maxDos).getTime() + filingDays * 86400000)) : null
  const secondary = {
    id: id || `${primary.id}-sec-${at.toString(36)}`, no: `${primary.no}-S${sequence}`,
    clientId: primary.clientId, payer: secPayer.name, mode: 'insurance', method: 'secondary',
    secondary: primary.id, parentNo: primary.no,
    dosFrom: primary.dosFrom, dosTo: primary.dosTo,
    // Original lines remain for reference only; the remaining dollars have NOT
    // been allocated to individual service lines or an 837P/CMS-1500 artifact.
    lines: (primary.lines || []).map((l) => ({ ...l, provider: l.provider || null })),
    status: 'draft', charges: due, units: primary.units, adj: 0, paid: 0,
    remittance: null, denial: null, version: 1, timelyDue,
    submittedAt: null, closedAt: null, createdAt: at,
    note: `Claim-level COB draft from ${primary.no}; verify service allocation and file manually`,
    history: [{ at, ev: `Secondary draft from ${primary.no}: $${due.toFixed(2)} remaining. Not transmitted.` }],
  }
  const primaryPatched = { ...primary, secondary: secondary.id,
    history: [...(primary.history || []), { at, ev: `Secondary draft created: ${secondary.no} (${secPayer.name})` }] }
  return { primary: primaryPatched, secondary }
}

// ---------- claim v2 backfill (idempotent defaults; used by migration + new assembly) ----------
export function claimV2Defaults(c, state) {
  const maxDos = c.lines.reduce((m, l) => (l.dos > m ? l.dos : m), c.dosTo || '')
  const filing = filingDaysOf(state, c.payer)
  const timelyDue = maxDos ? isoDate(new Date(parseISO(maxDos).getTime() + filing * 86400000)) : null
  return {
    method: c.method || (c.status === 'draft' ? null : c.mode === 'selfpay' ? 'selfpay' : 'ch'),
    reject: c.reject || null,
    timelyDue: c.timelyDue || timelyDue,
    secondary: c.secondary || null,
    lines: c.lines.map((l) => ({ ...l, provider: l.provider || null })),
  }
}

// ---------- payment records: derive from legacy inline remittances (migration + fresh seed) ----------
export function paymentsFromClaims(claims, { at = Date.now() } = {}) {
  const out = {}
  for (const c of claims) {
    if (!c.remittance) continue
    const rem = c.remittance
    const kind = rem.checkNo && /^CHK/i.test(rem.checkNo) ? 'check' : rem.kind || 'eob'
    out[`pay-${c.id}`] = {
      id: `pay-${c.id}`, claimId: c.id, clientId: c.clientId, payer: c.payer,
      kind, amount: r2(rem.amount || 0), adj: r2(rem.adj || 0), patientResp: r2(rem.patientResp || 0),
      ref: rem.checkNo || '—', date: isoDate(new Date(c.closedAt || rem.at || at)),
      reconciled: false, note: rem.note || '', attachments: [],
      source: null, reversalOf: null, createdAt: at, createdBy: 'Aloha (local)',
    }
  }
  return out
}
