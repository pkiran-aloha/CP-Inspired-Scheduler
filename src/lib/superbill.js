// ---- Superbill: an itemized statement a family submits to its own insurer ----
// For services the family paid for themselves (self-pay claims), so they can ask an
// out-of-network plan to reimburse them. Fields follow what payers ask for on member
// claims (Cigna's behavioral-health member claim form lists them: subscriber and patient,
// provider name and credentials, provider address and tax ID, dates of service, ICD-10
// diagnosis, procedure codes, charges) plus the NPI, place of service, units and
// modifiers most plans also expect. Claims already billed to an insurer are left out so
// the family cannot submit the same services twice. Nothing here is sent anywhere.
import { newPdf } from './exportKit'
import { dxFor, lineApptIds, posFor } from './claims'
import { longDate } from './statements'

const r2 = (n) => Math.round(n * 100) / 100
const usd = (n) => `$${(Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const POS_NAME = { '02': 'Telehealth', '03': 'School', '10': 'Telehealth (home)', '11': 'Office', '12': 'Home', '99': 'Other' }

/** Self-pay claims for one client with a date of service in [from, to]. */
export function superbillClaims(state, clientId, { from, to }) {
  return Object.values(state.claims || {})
    .filter((c) => c.clientId === clientId && c.mode === 'selfpay' && c.status !== 'void' && c.status !== 'draft' && c.method !== 'secondary')
    .filter((c) => (c.lines || []).some((l) => l.dos >= from && l.dos <= to))
}

/** Everything the superbill prints (pure, testable). Returns { ok: false, msg } when there is nothing to list. */
export function superbillView(state, clientId, { from, to, at = Date.now() } = {}) {
  const client = (state.clients || []).find((c) => c.id === clientId)
  if (!client) return { ok: false, msg: 'Client not found.' }
  const claims = superbillClaims(state, clientId, { from, to })
  if (!claims.length) return { ok: false, msg: `${client.name} has no self-pay services from ${longDate(from)} to ${longDate(to)}. Services billed to an insurer do not go on a superbill.` }
  const org = state.settings?.org || {}
  const providers = (state.settings?.providers || []).filter((p) => p.active !== false)
  const billing = providers.find((p) => p.id === state.settings?.billing?.defaultBilling) || providers.find((p) => p.kind === 'office') || {}
  const staffById = Object.fromEntries((state.staff || []).map((s) => [s.id, s]))
  const renderers = new Map()
  const lines = []
  for (const c of claims) {
    for (const l of c.lines || []) {
      if (l.dos < from || l.dos > to) continue
      const appt = state.appts?.[lineApptIds(l)[0]] || {}
      const sid = appt.staffIds?.[0]
      const prov = providers.find((p) => p.kind === 'staff' && p.refId === sid) || null
      const staff = staffById[sid] || {}
      if (sid && !renderers.has(sid)) {
        renderers.set(sid, { name: prov?.name || staff.name || '', credential: staff.cert || prov?.credential || '', npi: prov?.npi || '' })
      }
      lines.push({
        dos: l.dos, pos: posFor(appt), code: String(l.code || '').toUpperCase(),
        mods: String(l.mod || '').split(/\s+/).filter(Boolean).join(' '),
        units: l.units ?? '', ptr: 'A', charge: r2(l.charge || 0),
        renderer: renderers.get(sid)?.name || '', npi: renderers.get(sid)?.npi || '',
      })
    }
  }
  lines.sort((a, b) => (a.dos < b.dos ? -1 : a.dos > b.dos ? 1 : 0))
  const charges = r2(lines.reduce((t, l) => t + l.charge, 0))
  // what the family has paid on these claims, capped at the listed charges
  const paid = r2(Math.min(charges, claims.reduce((t, c) => t + Number(c.paid || 0) + Number(c.patientPaid || 0), 0)))
  const [street, ...rest] = String(org.address || '').split(',').map((s) => s.trim())
  const insured = client.insurer && !/self/i.test(client.insurer)
  return {
    ok: true,
    date: new Date(at).toISOString().slice(0, 10),
    from, to,
    provider: {
      name: org.name || 'Practice', street: street || '', cityLine: rest.join(', '), phone: org.phone || '',
      taxId: org.taxId || '', npi: billing.npi || org.npi || '',
    },
    patient: {
      name: client.name, dob: client.dob || '', address: [client.street, [client.city, [client.state, client.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ')].filter(Boolean).join(', '),
      accountNo: String(client.accountNo || client.id || '').toUpperCase(),
    },
    // only real plan data: a blank prints as a line for the family to fill in
    subscriber: { name: client.guardian || client.name, relation: client.guardian ? 'Child' : 'Self', plan: insured ? client.insurer : '', memberId: insured ? String(client.memberId || '') : '' },
    diagnoses: dxFor(client), // charted codes only; none prints a line to fill in
    lines,
    renderers: [...renderers.values()],
    totals: { charges, paid, balance: r2(charges - paid) },
    posNames: [...new Set(lines.map((l) => l.pos))].filter(Boolean).map((p) => `${p} ${POS_NAME[p] || ''}`.trim()),
  }
}

/** The superbill as a PDF (letter portrait). */
export function superbillPdf(state, clientId, range) {
  const v = superbillView(state, clientId, range)
  if (!v.ok) throw new Error(v.msg)
  const doc = newPdf({ unit: 'pt', format: 'letter' })
  doc.setProperties({ title: `Superbill ${v.patient.name} ${v.from} to ${v.to}`, author: v.provider.name })
  doc.setLanguage('en-US')
  const L = 48
  const R = 564
  const INK = [24, 28, 40]
  const MUTED = [96, 102, 118]
  const RULE = [210, 214, 224]
  const font = (size, style = 'normal', color = INK) => { doc.setFont('helvetica', style); doc.setFontSize(size); doc.setTextColor(...color) }
  const text = (t, x, y, opt) => doc.text(t, x, y, opt)
  const right = (t, x, y) => text(String(t ?? ''), x, y, { align: 'right' })
  const rule = (y, x1 = L, x2 = R) => { doc.setDrawColor(...RULE); doc.setLineWidth(0.6); doc.line(x1, y, x2, y) }
  const fillIn = (t) => t || '____________________'
  const kv = (k, val, x, y, w) => { font(7.5, 'normal', MUTED); text(k, x, y); font(9.5, 'normal'); text(doc.splitTextToSize(String(val), w)[0] || '', x, y + 12) }

  // ---- title
  font(16, 'bold'); text('SUPERBILL', L, 56)
  font(9, 'normal', MUTED); text('Itemized statement for insurance reimbursement. This is not a bill.', L, 70)
  right(`Prepared ${longDate(v.date)}`, R, 56); right(`Services ${longDate(v.from)} - ${longDate(v.to)}`, R, 68)

  // ---- provider and patient blocks
  rule(82)
  font(9, 'bold', MUTED); text('PROVIDER', L, 98); text('PATIENT AND SUBSCRIBER', 318, 98)
  font(10.5, 'bold'); text(v.provider.name, L, 113)
  font(9.5, 'normal'); [v.provider.street, v.provider.cityLine, v.provider.phone].filter(Boolean).forEach((t, i) => text(t, L, 126 + i * 12))
  kv('Tax ID (EIN)', fillIn(v.provider.taxId), L, 168, 120); kv('Billing NPI', fillIn(v.provider.npi), L + 130, 168, 120)
  kv('Account number', v.patient.accountNo, L, 196, 120)
  kv('Patient', v.patient.name, 318, 113, 120); kv('Date of birth', v.patient.dob ? longDate(v.patient.dob) : fillIn(''), 448, 113, 116)
  kv('Patient address', v.patient.address || fillIn(''), 318, 140, 246)
  kv('Subscriber (policyholder)', v.subscriber.name, 318, 168, 120); kv('Relationship to patient', v.subscriber.relation, 448, 168, 116)
  kv('Insurance plan', fillIn(v.subscriber.plan), 318, 196, 120); kv('Member ID', fillIn(v.subscriber.memberId), 448, 196, 116)

  // ---- diagnoses and rendering providers
  rule(226)
  font(9, 'bold', MUTED); text('DIAGNOSIS (ICD-10-CM)', L, 242); text('RENDERING PROVIDERS', 318, 242)
  font(9.5, 'normal'); if (!v.diagnoses.length) text(`A. ${fillIn('')}`, L, 256)
  v.diagnoses.forEach((d, i) => text(`${'ABCDEFGHIJKL'[i]}. ${d}`, L + (i % 3) * 86, 256 + Math.floor(i / 3) * 12))
  let ry = 256
  v.renderers.slice(0, 4).forEach((r) => { font(9.5, 'normal'); text(`${r.name}${r.credential ? `, ${r.credential}` : ''}`, 318, ry); font(8, 'normal', MUTED); text(`NPI ${r.npi || '__________'}`, 318, ry + 10); ry += 24 })

  // ---- service lines
  let y = Math.max(ry + 4, 290)
  rule(y - 10)
  font(9, 'bold', MUTED); text('SERVICES', L, y)
  const cols = [
    { h: 'Date of service', x: L }, { h: 'POS', x: 128 }, { h: 'CPT / HCPCS', x: 158 }, { h: 'Modifiers', x: 214 },
    { h: 'Units', x: 290, r: true }, { h: 'Dx', x: 302 }, { h: 'Rendering provider', x: 322 }, { h: 'Charge', x: R, r: true },
  ]
  const head = () => {
    font(7.5, 'bold', MUTED); cols.forEach((c) => (c.r ? right(c.h, c.x, y + 14) : text(c.h, c.x, y + 14)))
    rule(y + 19); y += 32
  }
  head()
  for (const l of v.lines) {
    if (y > 690) { doc.addPage(); y = 56; font(9, 'bold', MUTED); text(`SERVICES (continued) - ${v.patient.name}`, L, y); head() }
    font(9, 'normal')
    text(longDate(l.dos), cols[0].x, y); text(l.pos, cols[1].x, y); text(l.code, cols[2].x, y); text(l.mods, cols[3].x, y)
    right(l.units, cols[4].x, y); text(l.ptr, cols[5].x, y)
    text(doc.splitTextToSize(l.renderer, 170)[0] || '', cols[6].x, y)
    right(usd(l.charge), cols[7].x, y)
    rule(y + 6); y += 18
  }

  // ---- totals, place-of-service key, attestation and signature
  if (y > 640) { doc.addPage(); y = 64 }
  y += 6
  ;[['Total charges', usd(v.totals.charges)], ['Paid by patient', usd(v.totals.paid)], ['Balance', v.totals.balance > 0 ? usd(v.totals.balance) : 'Paid in full']].forEach(([k, val], i) => {
    font(9.5, i === 2 ? 'bold' : 'normal'); right(k, R - 100, y + i * 14); right(val, R, y + i * 14)
  })
  font(7.5, 'normal', MUTED); text(doc.splitTextToSize(`Place of service: ${v.posNames.join(' · ')}. Units are 15-minute units unless the code says otherwise.`, 300), L, y)
  y += 60
  font(8, 'normal', MUTED)
  text(doc.splitTextToSize('I certify that the services listed were provided to the patient on the dates shown and that the charges are the usual charges of this practice.', R - L), L, y)
  y += 36
  doc.setDrawColor(...INK); doc.setLineWidth(0.6); doc.line(L, y, L + 250, y); doc.line(L + 290, y, R, y)
  font(7.5, 'normal', MUTED); text('Provider signature', L, y + 11); text('Date', L + 290, y + 11)
  y += 30
  text(doc.splitTextToSize(`Submit this superbill to your insurance plan with its member claim form. Your plan decides what it reimburses. Questions about these services: ${v.provider.phone || 'contact the practice'}.`, R - L), L, y)

  const n = doc.getNumberOfPages()
  for (let p = 1; p <= n; p++) { doc.setPage(p); font(7.5, 'normal', MUTED); right(`Page ${p} of ${n}`, R, 776) }
  return doc
}
