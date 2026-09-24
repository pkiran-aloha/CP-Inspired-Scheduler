// ---- Claim lifecycle engine: staging → claim assembly → submission gates → payment / denial / rebill ----
// Pure + deterministic: the same functions power the Billing workspace, the demo seed,
// the reports desk (claim registers) and the store's undoable transitions.
import { BILL_CODES, TYPES, computeBilling } from './model'
import { isoDate, parseISO } from './date'

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
export const payerPolicy = (payer) => PAYER_POLICY[payer] || { kind: 'commercial', avgDays: 25, timely: 120, coins: 0.8, copay: 0 }

export const CLAIM_STATUSES = {
  draft: { label: 'Draft', ink: 'var(--muted)', bg: 'var(--panel-3)' },
  submitted: { label: 'Submitted', ink: '#0369a1', bg: '#e0f2fe' },
  paid: { label: 'Paid', ink: '#047857', bg: '#d7f5e8' },
  denied: { label: 'Denied', ink: '#b91c1c', bg: '#fee2e2' },
  void: { label: 'Void', ink: 'var(--muted)', bg: 'var(--panel-3)' },
}

export const DENIAL_REASONS = [
  { id: 'elig', label: 'Member not eligible / no active auth on DOS', fix: 'Verify authorization window, then rebill' },
  { id: 'verif', label: 'Documentation requested — session notes missing', fix: 'Attach notes to the flagged sessions, rebill without them removed' },
  { id: 'code', label: 'Coding error — invalid code / modifier', fix: 'Correct the charge lines below, then rebill' },
  { id: 'dup', label: 'Duplicate line — already paid on prior claim', fix: 'Drop the duplicated line(s), rebill remainder' },
  { id: 'timely', label: 'Timely filing limit exceeded', fix: 'Appeal with proof of service, or write off' },
]
export const denialOf = (id) => DENIAL_REASONS.find((d) => d.id === id) || DENIAL_REASONS[0]

// ---------- deterministic pseudo-fields for members (kept out of the client schema) ----------
function hashNum(s) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) }
  return Math.abs(h)
}
export const memberIdOf = (c) => `${(c.insurer || 'SP').replace(/[^A-Z]/gi, '').slice(0, 3).toUpperCase()}${String(1000000 + (hashNum(c.id) % 8999999))}`
export const authNoOf = (c) => `AUTH-${c.authStart?.slice(0, 4) || '2026'}-${String(40000 + (hashNum(c.id) % 9999)).padStart(5, '0')}`
export const npiOf = (staffId) => {
  const base = ('1' + String(12000000 + (hashNum(staffId || 'x') % 79999999)).padStart(8, '0')).slice(0, 9)
  return base + npiCheck(base)
}

const DX_POOL = [
  [/EIBI/, ['F84.0', 'R41.82']],
  [/Day program/, ['F84.0', 'F81.0']],
  [/Home program/, ['F84.0']],
  [/Behavior reduction/, ['F84.0', 'F90.1']],
  [/Group ·/, ['F84.5', 'F83']],
  [/School-based/, ['F84.0', 'F81.0']],
  [/Adaptive/, ['F84.0', 'F82']],
  [/Speech/, ['F80.89', 'F84.0']],
  [/Assessment/, ['F84.0']],
  [/Center-based/, ['F84.0', 'F90.0']],
]
export const dxFor = (client) => {
  for (const [re, codes] of DX_POOL) if (re.test(client?.program || '')) return codes
  return ['F84.0']
}

// ---------- staging: everything claim-ready right now ----------
export function stagedAppts(state, days) {
  const needVer = state.settings.billing?.requireVerification !== false
  const clientIds = new Set((state.clients || []).map((c) => c.id))
  const list = Object.values(state.appts)
    .filter((a) => a.clientIds?.[0] && clientIds.has(a.clientIds[0]))
    .filter((a) => !days || days.includes(a.date))
    .filter((a) => TYPES[a.type]?.billable && a.status === 'completed' && !a.billing?.status)
    .filter((a) => (a.billing?.units > 0) || (a.billing?.mileage && a.billing?.distance > 0))
    .filter((a) => !needVer || !TYPES[a.type].hasVerification || a.verification?.verifyStatus === 'verified')
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
    const key = `${c.id}|${mode}|${mode === 'selfpay' ? 'inv' : a.date.slice(0, 7)}`
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

export function lineFor(a, state) {
  const staff = Object.fromEntries((state.staff || []).map((s) => [s.id, s]))
  const b = a.billing || {}
  const codeDef = BILL_CODES.find((c) => c.id === b.code)
  if (b.mileage && !b.units) {
    const rate = state.settings.mileageRate ?? b.mileageRate ?? 0.7
    return { apptId: a.id, dos: a.date, t0: a.start, t1: a.end, code: '14220', desc: `Travel ${a.title || ''}`.trim(), units: b.distance || 0, rate, charge: r2((b.distance || 0) * rate), staff: names(a.staffIds, staff), kind: 'mileage' }
  }
  return { apptId: a.id, dos: a.date, t0: a.start, t1: a.end, code: b.code || '—', mod: '', desc: a.title || codeDef?.label.split(' · ')[1] || 'Treatment', units: b.units || 0, rate: b.rate || codeDef?.rate || 0, charge: r2(computeBilling(a)), staff: names(a.staffIds, staff), kind: 'session' }
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

// assemble → actual claim objects (used by the store action AND the demo seeder)
export function assembleClaims(state, plans, { seqStart, at = Date.now() } = {}) {
  let seq = seqStart ?? nextClaimSeq(state.claims)
  const prefix = state.settings.billing?.claimPrefix || 'CLM'
  const byId = Object.fromEntries(Object.values(state.appts).map((a) => [a.id, a]))
  const claims = []
  for (const p of plans) {
    const client = (state.clients || []).find((c) => c.id === p.clientId) || { id: p.clientId, name: p.client }
    claims.push({
      id: `clm-${prefix.toLowerCase()}-${seq}-${at.toString(36)}`,
      no: claimNoAt(prefix, seq, p.dosFrom),
      clientId: p.clientId, payer: p.payer, mode: p.mode,
      dosFrom: p.dosFrom, dosTo: p.dosTo,
      lines: p.appts.map((id) => lineFor(byId[id], state)),
      status: 'draft', charges: p.charges, units: p.units,
      adj: 0, paid: 0, remittance: null, denial: null, parentNo: null, version: 1,
      submittedAt: null, closedAt: null, note: '',
      createdAt: at, history: [{ at, ev: `Draft assembled from staging — ${p.appts.length} charge line${p.appts.length > 1 ? 's' : ''}, ${p.dosFrom} → ${p.dosTo}` }],
    })
    seq++
  }
  return { claims, apptPatch: claims.flatMap((c) => c.lines.map((l) => ({ id: l.apptId, patch: { claimId: c.id, billing: { ...(byId[l.apptId].billing || {}), status: 'claimed', claimNo: c.no } } }))) }
}

// ---------- submission gate (mirrors the validation rules at claim level) ----------
export function claimGate(state, claim) {
  const needVer = state.settings.billing?.requireVerification !== false
  const bad = []
  for (const l of claim.lines) {
    const a = state.appts[l.apptId]
    if (!a) { bad.push({ line: l, why: 'Source appointment no longer exists — drop this line' }); continue }
    if (a.billing?.status === 'billed') { bad.push({ line: l, why: 'Line was already billed outside a claim' }); continue }
    if (!(a.billing?.units > 0) && !(a.billing?.mileage && a.billing?.distance > 0)) bad.push({ line: l, why: `Missing billable units on ${l.dos}` })
    if (needVer && TYPES[a.type]?.hasVerification && a.verification?.verifyStatus !== 'verified') bad.push({ line: l, why: `Verification flag not cleared on ${l.dos} — open the session & verify` })
  }
  return { ok: !bad.length, bad }
}

// ---------- transitions (pure: return claim patch + appt patches) ----------
const ev = (text, at) => ({ at: at || Date.now(), ev: text })

export function submitPatch(state, claim) {
  const at = Date.now()
  return {
    claim: { ...claim, status: 'submitted', submittedAt: claim.submittedAt || at, history: [...claim.history, ev(claim.mode === 'selfpay' ? `Invoice sent to family (${claim.payer})` : `Claim submitted to ${claim.payer}`, at)] },
    apptPatches: claim.lines.map((l) => ({ id: l.apptId, patch: { billing: { ...(state.appts[l.apptId]?.billing || {}), status: 'claimed', claimNo: claim.no, submittedAt: at } } })),
  }
}
export function payPatch(claim, { amount, checkNo, adj, note, paidAt = Date.now() }) {
  const at = paidAt
  const nextAdj = r2(Math.max(0, adj || 0))
  const due = r2(claim.charges - nextAdj - (claim.paid || 0) - amount)
  const rem = { checkNo, amount, adj: nextAdj, note, at }
  // chunk-40 (U5): a payment that leaves a patient-responsibility remainder keeps the claim
  // open as partially_paid — it only closes at zero due (secondary or patient invoice follows)
  const status = due <= 0 ? 'paid' : 'partially_paid'
  return { claim: { ...claim, status, paid: r2((claim.paid || 0) + amount), adj: nextAdj, remittance: rem, closedAt: due <= 0 ? at : claim.closedAt, history: [...claim.history, ev(`Payment posted — $${amount.toLocaleString()} via ${checkNo}${nextAdj ? ` (${nextAdj.toLocaleString()} adjustment)` : ''}${due > 0 ? ` · $${due} still open` : ''}`, at)] } }
}
export function denyPatch(claim, { code, note }) {
  const at = Date.now()
  const d = denialOf(code)
  return { claim: { ...claim, status: 'denied', denial: { code: d.id, reason: d.label, fix: d.fix, note: note || '', at }, history: [...claim.history, ev(`Denied — ${d.label}`, at)] } }
}
export function releasePatch(state, claim, kind, extraHist) {
  const at = Date.now()
  return {
    claim: { ...claim, status: 'void', closedAt: at, history: [...claim.history, ev(extraHist || `Voided — ${claim.lines.length} line${claim.lines.length > 1 ? 's' : ''} released back to staging`, at)] },
    apptPatches: claim.lines.map((l) => ({ id: l.apptId, patch: { claimId: null, billing: { ...(state.appts[l.apptId]?.billing || {}), status: null, claimNo: null, submittedAt: null } } })),
    kind,
  }
}
// drop one line from a draft/void-pending claim → back to staging; claim re-totaled (or removed if empty)
export function dropLinePatch(state, claim, apptId) {
  const at = Date.now()
  const lines = claim.lines.filter((l) => l.apptId !== apptId)
  const charges = r2(lines.reduce((t, l) => t + l.charge, 0))
  const units = lines.reduce((t, l) => t + (l.kind === 'mileage' ? 1 : l.units), 0)
  if (!lines.length) {
    return { removeClaim: true, claim: { ...claim, lines, charges, units, history: [...claim.history, ev(`Last line removed — claim dissolved`, at)] } }
  }
  const dropped = claim.lines.find((l) => l.apptId === apptId)
  return {
    claim: { ...claim, lines, charges, units, adj: Math.min(claim.adj, charges), history: [...claim.history, ev(`Line removed: ${dropped?.code} · ${dropped?.dos} → back to staging`, at)] },
  }
}
export function rebillPatch(state, claim, dropIds, { seqStart } = {}) {
  const at = Date.now()
  const keep = claim.lines.filter((l) => !dropIds.includes(l.apptId))
  const voided = { ...claim, status: 'void', closedAt: at, history: [...claim.history, ev(`Voided for rebill → ${claim.no}-R${claim.version + 1}`, at)] }
  const charges = r2(keep.reduce((t, l) => t + l.charge, 0))
  const next = {
    ...claim, id: `${claim.id}-r${claim.version + 1}`, no: claim.no.replace(/-R\d+$/, '') + `-R${claim.version + 1}`,
    version: claim.version + 1, parentNo: claim.no, status: 'draft', lines: keep, charges,
    units: keep.reduce((t, l) => t + (l.kind === 'mileage' ? 1 : l.units), 0),
    adj: 0, paid: 0, remittance: null, denial: null, submittedAt: null, closedAt: null, createdAt: at,
    history: [{ at, ev: `Rebill draft from ${claim.no} — ${dropIds.length ? `dropped ${dropIds.length} disputed line${dropIds.length > 1 ? 's' : ''} back to staging` : 'lines unchanged'}` }],
  }
  return { voided, next, apptPatches: [
    ...dropIds.map((id) => ({ id, patch: { claimId: null, billing: { ...(state.appts[id]?.billing || {}), status: null, claimNo: null } } })),
    ...keep.map((l) => ({ id: l.apptId, patch: { claimId: next.id, billing: { ...(state.appts[l.apptId]?.billing || {}), status: 'claimed', claimNo: next.no } } })),
  ] }
}

// ---------- money helpers for the form footer ----------
export const dueOf = (c) => r2(c.charges - (c.adj || 0) - (c.paid || 0))
export const copayOf = (c, client) => (c.mode === 'insurance' ? Math.min(payerPolicy(c.payer).copay * c.lines.length, c.charges) : 0)

export function agingOf(c, today = isoDate(new Date())) {
  if (!c.submittedAt || c.status !== 'submitted') return null
  const days = Math.max(0, Math.round((parseISO(today) - new Date(c.submittedAt)) / 86400000))
  const avg = payerPolicy(c.payer).avgDays
  return { days, late: days > avg * 1.6, bucket: days <= 30 ? '0–30' : days <= 60 ? '31–60' : days <= 90 ? '61–90' : '90+' }
}

// ---------- portfolio stats for the KPI band ----------
export function claimStats(state, days) {
  const claims = Object.values(state.claims || {})
  const inWin = claims.filter((c) => c.lines.some((l) => !days || days.includes(l.dos)))
  const staged = stagedAppts(state, days)
  const money = (arr, f) => Math.round(arr.reduce((t, c) => t + f(c), 0))
  const paid = inWin.filter((c) => c.status === 'paid')
  const denied = inWin.filter((c) => c.status === 'denied')
  const pending = inWin.filter((c) => c.status === 'submitted')
  const drafts = inWin.filter((c) => c.status === 'draft')
  const d2p = paid.filter((c) => c.submittedAt).map((c) => Math.max(0, Math.round((c.closedAt - c.submittedAt) / 86400000)))
  const buckets = { '0–30': 0, '31–60': 0, '61–90': 0, '90+': 0 }
  let lateCount = 0
  for (const c of pending) { const a = agingOf(c); if (a) { buckets[a.bucket] += Math.round(c.charges); if (a.late) lateCount++ } }
  return {
    staged: { n: staged.length, $: Math.round(staged.reduce((t, a) => t + computeBilling(a), 0)) },
    drafts: { n: drafts.length, $: money(drafts, (c) => c.charges) },
    pending: { n: pending.length, $: money(pending, (c) => dueOf(c)), late: lateCount, buckets },
    denied: { n: denied.length, $: money(denied, (c) => c.charges) },
    paid: { n: paid.length, $: money(paid, (c) => c.paid) },
    denialRate: paid.length + denied.length ? Math.round((denied.length / (paid.length + denied.length)) * 100) : 0,
    avgDaysToPay: d2p.length ? Math.round(d2p.reduce((t, x) => t + x, 0) / d2p.length) : null,
    closed: inWin.filter((c) => c.status === 'paid' || c.status === 'void' || c.status === 'denied').length,
  }
}

// ---------- exports (CSV for payers / accountants) ----------
export function claimCsv(state, claim) {
  const org = state.settings.org || {}
  const client = (state.clients || []).find((c) => c.id === claim.clientId) || {}
  const L = [
    `# ${org.name || 'Practice'} — Claim ${claim.no} (${claim.status}) · ${claim.mode === 'selfpay' ? 'Self-pay invoice' : claim.payer}`,
    `# Client ${client.name || claim.clientId} · member ${memberIdOf({ id: claim.clientId, insurer: claim.payer })} · DOS ${claim.dosFrom} → ${claim.dosTo} · Auth ${authNoOf(client)}`,
    `# Charges ${claim.charges.toFixed(2)} · Adjustments ${(claim.adj || 0).toFixed(2)} · Paid ${(claim.paid || 0).toFixed(2)} · Due ${dueOf(claim).toFixed(2)}`,
    'line,date_of_service,hcpcs,mod,description,units,rate,charge,rendered_by',
    ...claim.lines.map((l, i) => `${i + 1},${l.dos},${l.code}${l.mod ? ',' + l.mod : ','},"${l.desc}",${l.units},${l.rate},${l.charge},"${l.staff}"`),
  ]
  return L.join('\n')
}
export function claimsCsv(state, claims) {
  const org = state.settings.org || {}
  const L = [
    `# ${org.name || 'Practice'} — claims register · ${claims.length} claim${claims.length > 1 ? 's' : ''}`,
    'claim,client,payer,mode,dos_from,dos_to,lines,units,charges,adj,paid,due,status,submitted,paid_on',
    ...claims.map((c) => {
      const client = (state.clients || []).find((x) => x.id === c.clientId) || {}
      return `${c.no},"${client.name || ''}",${c.payer},${c.mode},${c.dosFrom},${c.dosTo},${c.lines.length},${c.units},${c.charges},${c.adj || 0},${c.paid || 0},${dueOf(c)},${c.status},${c.submittedAt ? isoDate(new Date(c.submittedAt)) : ''},${c.closedAt && c.status === 'paid' ? isoDate(new Date(c.closedAt)) : ''}`
    }),
  ]
  return L.join('\n')
}

// quick "post payment" presets, computed per claim
export function quickPosts(state, claim, client) {
  const pol = payerPolicy(claim.payer)
  const cp = claim.mode === 'insurance' ? Math.min(pol.copay * claim.lines.length, claim.charges) : 0
  const coins = r2(claim.charges * pol.coins)
  const out = [{ id: 'full', label: 'Full charge', amount: claim.charges, adj: 0 }]
  if (claim.mode === 'insurance') out.push({ id: 'contract', label: `Contract ${Math.round(pol.coins * 100)}%`, amount: r2(coins - cp), adj: r2(claim.charges - coins), note: 'Contractual adjustment' })
  if (cp) out.push({ id: 'copay', label: 'After copay', amount: r2(claim.charges - cp), adj: 0, note: `Copays collected: $${cp}` })
  out.push({ id: 'writeoff', label: 'Write off', amount: 0, adj: claim.charges, note: 'Uncollectible' })
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
  return `${code} requires ${need} — rendered by ${staffCred || 'unknown'}`
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

// ---------- claim v2 backfill (idempotent defaults; used by migration + new assembly) ----------
export function claimV2Defaults(c, state) {
  const pol = payerPolicy(c.payer)
  const maxDos = c.lines.reduce((m, l) => (l.dos > m ? l.dos : m), c.dosTo || '')
  const filing = state.payers?.find?.((p) => p.name === c.payer)?.ext?.filingDeadlineDays || pol.timely || 120
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
      kind, amount: r2(rem.amount || 0), adj: r2(rem.adj || 0), patientResp: 0,
      ref: rem.checkNo || '—', date: c.closedAt ? isoDate(new Date(c.closedAt)) : isoDate(new Date(at)),
      reconciled: false, note: rem.note || '', attachments: [],
      source: null, reversalOf: null, createdAt: at, createdBy: 'Aloha (local)',
    }
  }
  return out
}
