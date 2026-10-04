// ---- Credentials & PDUs: what each clinician owes the BACB (and the practice) to renew ----
// BACB baseline: BCBA 32 CEUs and BCaBA 20 CEUs per 2-year certification cycle; RBTs renew
// every year with a competency assessment and are supervised for at least 5% of their
// service hours each month. On top, the practice sets an annual PDU target for RBTs
// (settings.credentials.rbtPduHours, default 12). The renewal date comes from the staff
// member's credential in the Cabinet; without one, a rolling window up to today is used.
import { addDays, isoDate, parseISO } from './date'
import { credOf } from './claims'

export const PDU_KINDS = [
  { id: 'ceu', label: 'BACB CEU' },
  { id: 'pdu', label: 'Practice PDU / training' },
  { id: 'competency', label: 'RBT competency assessment' },
]
export const DEFAULT_RBT_PDU_HOURS = 12
export const BACB = { BCBA: { hours: 32, months: 24 }, BCaBA: { hours: 20, months: 24 }, RBT: { months: 12 } }

const iso = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''))
const shiftMonths = (d, m) => { const x = parseISO(d); x.setMonth(x.getMonth() + m); return isoDate(x) }
const r1 = (n) => Math.round(n * 10) / 10

export const rbtPduTarget = (state) => {
  const n = Number(state?.settings?.credentials?.rbtPduHours)
  return Number.isFinite(n) && n >= 0 && state?.settings?.credentials?.rbtPduHours !== '' && state?.settings?.credentials?.rbtPduHours != null ? n : DEFAULT_RBT_PDU_HOURS
}

/** The staff member's credential renewal date from the Cabinet (latest live credential document). */
export function renewalOf(state, staffId) {
  const docs = Object.values(state.cabinet || {}).filter((d) => !d.archived && d.ownerKind === 'staff' && d.ownerId === staffId && d.category === 'Credential / certification' && iso(d.expiresOn))
  return docs.sort((a, b) => (a.expiresOn < b.expiresOn ? 1 : -1))[0]?.expiresOn || ''
}

/** Supervised share of an RBT's service time over the 30 days up to today (BACB minimum 5%). */
export function supervisionPct(state, staffId, today) {
  const from = isoDate(addDays(parseISO(today), -30))
  const appts = Object.values(state.appts || {}).filter((a) => a.date > from && a.date <= today && a.status !== 'cancelled' && (a.staffIds || []).includes(staffId))
  const svc = appts.filter((a) => a.type === 'service' || a.type === 'evaluation').reduce((t, a) => t + (a.end - a.start), 0)
  const sup = appts.filter((a) => a.type === 'supervision').reduce((t, a) => t + (a.end - a.start), 0)
  return svc ? Math.round((sup / svc) * 1000) / 10 : null
}

/** One clinician's renewal position. Returns null for staff without a BACB credential. */
export function credentialRow(state, staff, today) {
  const cred = credOf(staff.role)
  const rule = BACB[cred]
  if (!rule) return null
  const renewal = renewalOf(state, staff.id)
  const end = renewal && renewal > today ? renewal : today
  const start = shiftMonths(renewal || today, -rule.months)
  const mine = Object.values(state.pdus || {}).filter((p) => p.staffId === staff.id && p.date > start && p.date <= end)
  const kind = cred === 'RBT' ? 'pdu' : 'ceu'
  const required = cred === 'RBT' ? rbtPduTarget(state) : rule.hours
  const logged = r1(mine.filter((p) => p.kind === kind).reduce((t, p) => t + (Number(p.hours) || 0), 0))
  const competency = cred === 'RBT' ? mine.filter((p) => p.kind === 'competency').sort((a, b) => (a.date < b.date ? 1 : -1))[0]?.date || '' : ''
  const supPct = cred === 'RBT' ? supervisionPct(state, staff.id, today) : null
  const remaining = r1(Math.max(0, required - logged))
  const status = renewal && renewal < today ? 'Renewal overdue'
    : cred === 'RBT' && !competency ? 'Competency assessment due'
      : remaining > 0 ? `${remaining} h to go`
        : cred === 'RBT' && supPct != null && supPct < 5 ? 'Supervision under 5%'
          : 'On track'
  return { staffId: staff.id, name: staff.name, credential: cred, renewal: renewal || '—', windowStart: start, unit: cred === 'RBT' ? 'PDU h' : 'CEU', required, logged, remaining, competency: competency || (cred === 'RBT' ? '—' : 'n/a'), supPct: supPct ?? '', status }
}

export function planPduEntry(state, input = {}, { id, at = Date.now() } = {}) {
  const staff = (state.staff || []).find((s) => s.id === input.staffId)
  if (!staff) return { ok: false, msg: 'Choose the staff member.' }
  if (!PDU_KINDS.some((k) => k.id === input.kind)) return { ok: false, msg: 'Choose what kind of entry this is.' }
  if (!iso(input.date)) return { ok: false, msg: 'Enter the date it was completed.' }
  const hours = input.kind === 'competency' ? 0 : Number(input.hours)
  if (input.kind !== 'competency' && (!Number.isFinite(hours) || hours <= 0 || hours > 100 || Math.round(hours * 4) !== hours * 4)) return { ok: false, msg: 'Hours must be between 0.25 and 100, in quarter hours.' }
  const title = String(input.title || '').replace(/\s+/g, ' ').trim().slice(0, 120)
  if (title.length < 3) return { ok: false, msg: 'Name the course or assessment (at least 3 characters).' }
  if (!id) return { ok: false, msg: 'Entry id missing.' }
  const item = { id, staffId: staff.id, kind: input.kind, date: input.date, hours, title, provider: String(input.provider || '').trim().slice(0, 80), ref: String(input.ref || '').trim().slice(0, 60), createdAt: at }
  return { ok: true, msg: `${title} logged for ${staff.name}.`, item }
}
