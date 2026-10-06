// ---- Good Faith Estimate (No Surprises Act) for uninsured or self-pay families ----
// 45 CFR 149.610: a provider must give an uninsured or self-pay individual a written
// estimate of expected charges when care is scheduled or on request. For recurring care
// such as ABA, one estimate may cover up to 12 months if it states the scope (how often,
// over what period, how many). Content and disclaimers follow 149.610(c) and the CMS
// model notice. The estimate is a document the practice downloads and hands over or
// mails; the app sends nothing and does not keep issued estimates, so the practice
// saves the PDF with the client's record (retention: 6 years).
import { jsPDF } from 'jspdf'
import { winAnsi } from './exportKit'
import { BILL_CODES } from './model'
import { dxFor } from './claims'
import { longDate } from './statements'
import { addDays, isoDate, parseISO } from './date'

const r2 = (n) => Math.round(n * 100) / 100
const usd = (n) => `$${(Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const codeDef = (code) => BILL_CODES.find((c) => c.id === code) || null
export const codeLabel = (code) => (codeDef(code)?.label.split(' · ')[1] || code)
const cancelled = (a) => /cancel|no.?show/i.test(String(a.status || ''))

/** Weeks covered by a period of `months` starting on `start` (ISO). */
export const periodWeeks = (start, months) => {
  const s = parseISO(start)
  const e = new Date(s.getFullYear(), s.getMonth() + months, s.getDate())
  return Math.round((e - s) / (7 * 86400000))
}

/**
 * Suggested estimate rows from the calendar: the client's scheduled sessions in the four
 * weeks from `start` (or, when nothing is booked yet, the four weeks before it), as units
 * per week per billing code at the rate those sessions carry.
 */
export function suggestGfeRows(state, clientId, start) {
  const s = parseISO(start)
  const windowOf = (from) => {
    const f = isoDate(from)
    const to = isoDate(addDays(from, 27))
    return Object.values(state.appts || {}).filter((a) => (a.clientIds || []).includes(clientId) && a.date >= f && a.date <= to && a.billing?.code && !a.billing.mileage && !cancelled(a))
  }
  let appts = windowOf(s)
  if (!appts.length) appts = windowOf(addDays(s, -28))
  const by = {}
  for (const a of appts) {
    const k = a.billing.code
    by[k] = by[k] || { code: k, units: 0, charge: 0 }
    by[k].units += Number(a.billing.units) || 0
    by[k].charge += (Number(a.billing.units) || 0) * (Number(a.billing.rate) || codeDef(k)?.rate || 0)
  }
  return Object.values(by)
    .filter((r) => r.units > 0)
    .map((r) => ({ code: r.code, unitsPerWeek: r2(r.units / 4), rate: r2(r.charge / r.units) }))
    .sort((a, b) => a.code.localeCompare(b.code))
}

/** Validate inputs and compute the estimate (pure). Returns { ok, msg, ...estimate }. */
export function planGfe(state, clientId, { start, months, rows, separately = '', at = Date.now() } = {}) {
  const client = (state.clients || []).find((c) => c.id === clientId)
  if (!client) return { ok: false, msg: 'Client not found.' }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(start || ''))) return { ok: false, msg: 'Choose the date the estimated care starts.' }
  const m = Number(months)
  if (!Number.isInteger(m) || m < 1 || m > 12) return { ok: false, msg: 'An estimate can cover 1 to 12 months.' }
  const clean = (rows || []).filter((r) => r && r.code)
  if (!clean.length) return { ok: false, msg: 'Add at least one service to estimate.' }
  for (const r of clean) {
    const u = Number(r.unitsPerWeek)
    const rate = Number(r.rate)
    if (!(u > 0) || u > 400) return { ok: false, msg: `${r.code}: units per week must be more than 0.` }
    if (!(rate >= 0) || Math.round(rate * 100) / 100 !== rate) return { ok: false, msg: `${r.code}: the rate must be a dollar amount with at most two decimals.` }
  }
  const weeks = periodWeeks(start, m)
  const end = isoDate(addDays(parseISO(start), weeks * 7 - 1))
  const org = state.settings?.org || {}
  const providers = (state.settings?.providers || []).filter((p) => p.active !== false)
  const billing = providers.find((p) => p.id === state.settings?.billing?.defaultBilling) || providers.find((p) => p.kind === 'office') || {}
  const dx = dxFor(client)
  const lines = clean.map((r) => {
    const def = codeDef(r.code)
    const per = Number(r.unitsPerWeek)
    const units = r2(per * weeks)
    return {
      code: r.code, service: codeLabel(r.code), dx: dx[0] || '',
      unitsPerWeek: per, unitMins: def?.unitMins || 15,
      units, rate: Number(r.rate), total: r2(units * Number(r.rate)),
      scope: `${per} units a week (about ${r2(per * (def?.unitMins || 15) / 60)} hours) for ${weeks} weeks`,
    }
  })
  const total = r2(lines.reduce((t, l) => t + l.total, 0))
  const [street, ...rest] = String(org.address || '').split(',').map((x) => x.trim())
  const stateCode = (/\b([A-Z]{2})\b\s*\d{5}/.exec(String(org.address || '')) || [])[1] || ''
  return {
    ok: true,
    msg: `Good Faith Estimate for ${client.name}: ${usd(total)} over ${m} month${m > 1 ? 's' : ''} downloaded. The app does not keep a copy or send it; save it with the client's record.`,
    date: new Date(at).toISOString().slice(0, 10),
    start, end, months: m, weeks,
    patient: { name: client.name, dob: client.dob || '' },
    diagnoses: dx,
    primary: `Applied behavior analysis (ABA) therapy, recurring sessions from ${longDate(start)} to ${longDate(end)}`,
    provider: { name: org.name || 'Practice', npi: billing.npi || org.npi || '', tin: org.taxId || '', street: street || '', cityLine: rest.join(', '), state: stateCode, phone: org.phone || '' },
    lines, total,
    // 149.610(c)(1)(vi): items or services expected to need separate scheduling before or after this period
    separately: String(separately || '').trim() || 'None expected at the time of this estimate.',
  }
}

/** The estimate as a PDF (letter portrait), laid out after the CMS model notice. */
export function gfePdf(est) {
  if (!est?.ok) throw new Error(est?.msg || 'Nothing to estimate.')
  const doc = winAnsi(new jsPDF({ unit: 'pt', format: 'letter' }))
  doc.setProperties({ title: `Good Faith Estimate ${est.patient.name}`, author: est.provider.name })
  doc.setLanguage('en-US')
  const L = 48
  const R = 564
  const INK = [24, 28, 40]
  const MUTED = [96, 102, 118]
  const RULE = [210, 214, 224]
  const font = (size, style = 'normal', color = INK) => { doc.setFont('helvetica', style); doc.setFontSize(size); doc.setTextColor(...color) }
  const text = (t, x, yy, opt) => doc.text(t, x, yy, opt)
  const right = (t, x, yy) => text(String(t ?? ''), x, yy, { align: 'right' })
  const rule = (yy, x1 = L, x2 = R) => { doc.setDrawColor(...RULE); doc.setLineWidth(0.6); doc.line(x1, yy, x2, yy) }
  let y = 56
  const need = (h) => { if (y + h > 740) { doc.addPage(); y = 56 } }
  const para = (t, size = 8.5, style = 'normal', color = INK, gap = 5) => { font(size, style, color); const ln = doc.splitTextToSize(t, R - L); need(ln.length * size * 1.2); text(ln, L, y); y += ln.length * size * 1.2 + gap }
  const heading = (t) => { need(30); y += 6; font(9, 'bold', MUTED); text(t.toUpperCase(), L, y); y += 6; rule(y); y += 12 }
  const kv = (k, v, x, w) => { font(7.5, 'normal', MUTED); text(k, x, y); font(9.5, 'normal'); text(doc.splitTextToSize(String(v || '-'), w)[0], x, y + 12) }

  font(16, 'bold'); text('Good Faith Estimate for Health Care Items and Services', L, y)
  y += 14; font(9, 'normal', MUTED); text(`Prepared ${longDate(est.date)} for an uninsured or self-pay patient`, L, y)
  y += 18

  heading('Patient')
  kv('Patient name', est.patient.name, L, 230); kv('Date of birth', est.patient.dob ? longDate(est.patient.dob) : '-', 300, 230); y += 30
  kv('Diagnosis codes (ICD-10-CM)', est.diagnoses.join(', '), L, 230); kv('Period of care estimated', `${longDate(est.start)} - ${longDate(est.end)} (${est.months} month${est.months > 1 ? 's' : ''})`, 300, 264); y += 30

  heading('Primary service')
  para(est.primary, 9.5)
  para(`Date of this Good Faith Estimate: ${longDate(est.date)}`, 8.5)
  para('Sessions recur over the period above. The scope of each service (how often and for how long) is listed in the estimate below.', 8.5, 'normal', MUTED)

  heading('Provider')
  kv('Provider', est.provider.name, L, 230); kv('NPI', est.provider.npi, 300, 110); kv('Tax ID (TIN)', est.provider.tin, 420, 140); y += 30
  kv('Location where services are provided', [est.provider.street, est.provider.cityLine].filter(Boolean).join(', '), L, 360); kv('State', est.provider.state, 420, 140); y += 30
  font(7.5, 'normal', MUTED); text("Sessions may also take place in the patient's home or school, as scheduled.", L, y); y += 8

  heading('Estimate')
  const cols = [{ h: 'Service', x: L }, { h: 'Service code', x: 230 }, { h: 'Dx code', x: 290 }, { h: 'Quantity (units)', x: 400, r: true }, { h: 'Rate per unit', x: 470, r: true }, { h: 'Expected cost', x: R, r: true }]
  font(7.5, 'bold', MUTED); cols.forEach((c) => (c.r ? right(c.h, c.x, y) : text(c.h, c.x, y))); y += 6; rule(y); y += 12
  for (const l of est.lines) {
    need(28)
    font(9, 'normal'); text(doc.splitTextToSize(l.service, 176)[0], L, y); text(l.code, 230, y); text(l.dx, 290, y)
    right(l.units.toLocaleString('en-US'), 400, y); right(usd(l.rate), 470, y); font(9, 'bold'); right(usd(l.total), R, y)
    font(7.5, 'normal', MUTED); text(l.scope, L, y + 10)
    rule(y + 15); y += 26
  }
  need(24); font(10.5, 'bold'); right('Total estimated cost', 470, y + 2); right(usd(est.total), R, y + 2); y += 22

  para('The estimated costs are valid for 12 months from the date of the Good Faith Estimate.', 8.5, 'normal', MUTED)

  heading('Items or services expected to be scheduled separately')
  {
    // the boxed disclaimer sits directly above the list, as the rule requires
    font(8.2, 'normal'); const ln = doc.splitTextToSize(GFE_SEPARATE_DISCLAIMER, R - L - 16)
    need(ln.length * 10 + 14); doc.setDrawColor(...RULE); doc.setLineWidth(0.6); doc.rect(L, y - 9, R - L, ln.length * 9.9 + 10)
    text(ln, L + 8, y); y += ln.length * 9.9 + 10
  }
  para(est.separately, 9)
  para(`To ask for an estimate for any of these, contact ${est.provider.name}${est.provider.phone ? ` at ${est.provider.phone}` : ''}.`, 8, 'normal', MUTED)

  heading('Disclaimer')
  for (const p of GFE_DISCLAIMER) para(p, 8.2, 'normal', INK, 6)
  para(`Questions about this estimate: ${est.provider.name}${est.provider.phone ? `, ${est.provider.phone}` : ''}.`, 8.2, 'bold')

  const n = doc.getNumberOfPages()
  for (let p = 1; p <= n; p++) { doc.setPage(p); font(7.5, 'normal', MUTED); text(`${est.patient.name} - Good Faith Estimate ${longDate(est.date)}`, L, 776); right(`Page ${p} of ${n}`, R, 776) }
  return doc
}

// The Disclaimer section of the CMS model notice (standard form, OMB 0938-1433), verbatim,
// plus the two statements 45 CFR 149.610 requires that the standard form's page leaves out:
// additional separately scheduled services, (c)(1)(viii), and that starting a dispute does not
// affect care, (c)(1)(x). The $25 fee is CMS's latest published PPDR administrative fee.
export const GFE_DISCLAIMER = [
  'This Good Faith Estimate shows the costs of items and services that are reasonably expected for your health care needs for an item or service. The estimate is based on information known at the time the estimate was created.',
  'The Good Faith Estimate does not include any unknown or unexpected costs that may arise during treatment. You could be charged more if complications or special circumstances occur. If this happens, and your bill is $400 or more for any provider or facility than your Good Faith Estimate for that provider or facility, federal law allows you to dispute the bill.',
  'There may be additional items or services the provider recommends as part of the course of care that must be scheduled or requested separately and are not reflected in this Good Faith Estimate. This Good Faith Estimate is only an estimate; actual items, services, or charges may differ.',
  'The Good Faith Estimate is not a contract and does not require the uninsured (or self-pay) individual to obtain the items or services from any of the providers or facilities identified in the Good Faith Estimate.',
  'If you are billed for more than this Good Faith Estimate, you may have the right to dispute the bill.',
  'You may contact the health care provider or facility listed to let them know the billed charges are higher than the Good Faith Estimate. You can ask them to update the bill to match the Good Faith Estimate, ask to negotiate the bill, or ask if there is financial assistance available.',
  'You may also start a dispute resolution process with the U.S. Department of Health and Human Services (HHS). If you choose to use the dispute resolution process, you must start the dispute process within 120 calendar days (about 4 months) of the date on the original bill. Starting the dispute process will not adversely affect the quality of the health care services furnished to you.',
  'If you dispute your bill, the provider or facility cannot move the bill for the disputed item or service into collection or threaten to do so, or if the bill has already moved into collection, the provider or facility has to cease collection efforts. The provider or facility must also suspend the accrual of any late fees on unpaid bill amounts until after the dispute resolution process has concluded. The provider or facility cannot take or threaten to take any retributive action against you for disputing your bill.',
  'There is a $25 fee to use the dispute process. If the Selected Dispute Resolution (SDR) entity reviewing your dispute agrees with you, you will have to pay the price on this Good Faith Estimate, reduced by the $25 fee. If the SDR entity disagrees with you and agrees with the health care provider or facility, you will have to pay the higher amount.',
  'To learn more and get a form to start the process, go to www.cms.gov/nosurprises/consumers or call 1-800-985-3059. For questions or more information about your right to a Good Faith Estimate or the dispute process, visit www.cms.gov/nosurprises/consumers, email FederalPPDRQuestions@cms.hhs.gov, or call 1-800-985-3059.',
  'Keep a copy of this Good Faith Estimate in a safe place or take pictures of it. You may need it if you are billed a higher amount.',
]
// The model notice's boxed disclaimer above the separately scheduled list, (c)(1)(vi)
export const GFE_SEPARATE_DISCLAIMER = 'For health care items/services listed below, separate good faith estimates will be issued upon scheduling or upon request. Specific information such as the names and identifiers for the providers or facilities that may furnish the services, diagnosis codes (if required for the calculation of the GFE), service codes, and expected charges will be provided in separate good faith estimates once these items or services are scheduled (or upon request).'
