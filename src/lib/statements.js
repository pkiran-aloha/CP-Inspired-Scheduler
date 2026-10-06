// ---- Client statements: what a family owes, issued as a numbered record with history ----
// A statement freezes the family's share on the day it is issued (one line per claim). Its
// balance afterwards is live: patient receipts recorded in the Payment Center reduce it, and
// it reads "Paid" once nothing on its claims is still owed. Nothing is mailed or emailed:
// "mark sent" records how the practice delivered it.
import { jsPDF } from 'jspdf'
import { isPrimaryReceivable, patientResponsibilityOf } from './claims'
import { winAnsi } from './exportKit'
import { paymentLinkFor } from './settingsMasters'

const r2 = (n) => Math.round(n * 100) / 100
const money = (n) => `$${(Number(n) || 0).toFixed(2)}`
export const SEND_METHODS = [
  { id: 'mail', label: 'Mailed' },
  { id: 'hand', label: 'Handed to the family' },
  { id: 'email', label: "Emailed from the practice's own email" },
  { id: 'portal', label: "Posted to the practice's own portal" },
]

/** The family's share still owed on each primary claim (payer-reported share or self-pay). */
export function statementLines(state, clientId) {
  return Object.values(state.claims || {})
    .filter((c) => c.clientId === clientId && isPrimaryReceivable(c))
    .map((c) => ({ claimId: c.id, claimNo: c.no, dosFrom: c.dosFrom, dosTo: c.dosTo, payer: c.payer, charges: c.charges, due: r2(patientResponsibilityOf(state, c)) }))
    .filter((l) => l.due > 0)
    .sort((a, b) => (a.dosFrom < b.dosFrom ? -1 : 1))
}

/** Live balance of an issued statement: what is still owed on its claims, capped at the issued amount. */
export function statementBalance(state, st) {
  const owed = st.lines.reduce((t, l) => {
    const c = state.claims?.[l.claimId]
    return t + (c ? Math.min(l.due, patientResponsibilityOf(state, c)) : 0)
  }, 0)
  return r2(owed)
}

export function statementStatus(state, st) {
  if (st.status === 'void') return 'void'
  if (statementBalance(state, st) <= 0) return 'paid'
  return st.sentAt ? 'sent' : 'issued'
}

const nextNo = (state, at) => {
  const ym = new Date(at).toISOString().slice(0, 7).replace('-', '')
  const n = Object.values(state.statements || {}).filter((s) => String(s.no || '').startsWith(`STM-${ym}-`)).length + 1
  return `STM-${ym}-${String(n).padStart(3, '0')}`
}

export function planStatement(state, clientId, { id, at = Date.now(), by = null } = {}) {
  const client = (state.clients || []).find((c) => c.id === clientId)
  if (!client) return { ok: false, msg: 'Client not found.' }
  if (!id) return { ok: false, msg: 'Statement id missing.' }
  const lines = statementLines(state, clientId)
  if (!lines.length) return { ok: false, msg: `${client.name} owes nothing right now, so there is nothing to put on a statement.` }
  const total = r2(lines.reduce((t, l) => t + l.due, 0))
  const no = nextNo(state, at)
  const item = { id, no, clientId, at, lines, total, status: 'issued', sentAt: null, sentVia: null, history: [{ at, by, ev: `Issued for ${money(total)} across ${lines.length} claim${lines.length > 1 ? 's' : ''}` }] }
  return { ok: true, msg: `${no} issued to ${client.name} for ${money(total)}. Download the PDF to print or send it yourself.`, item }
}

export function planStatementSent(state, id, { via, at = Date.now(), by = null } = {}) {
  const st = state.statements?.[id]
  if (!st) return { ok: false, msg: 'Statement not found.' }
  if (st.status === 'void') return { ok: false, msg: `${st.no} is void.` }
  const method = SEND_METHODS.find((m) => m.id === via)
  if (!method) return { ok: false, msg: 'Choose how the statement was delivered.' }
  return { ok: true, msg: `${st.no} marked as sent (${method.label.toLowerCase()}). The app did not send anything.`, item: { ...st, sentAt: at, sentVia: via, history: [...st.history, { at, by, ev: `Marked sent: ${method.label}` }] } }
}

export function planStatementVoid(state, id, { at = Date.now(), by = null, reason = '' } = {}) {
  const st = state.statements?.[id]
  if (!st) return { ok: false, msg: 'Statement not found.' }
  if (st.status === 'void') return { ok: false, msg: `${st.no} is already void.` }
  const why = String(reason || '').trim()
  if (why.length < 3) return { ok: false, msg: 'Give a reason for voiding the statement.' }
  return { ok: true, msg: `${st.no} voided. Its claims are unchanged.`, item: { ...st, status: 'void', history: [...st.history, { at, by, ev: `Voided: ${why}` }] } }
}

// ---------- the printed statement ----------
// Laid out the way HFMA's patient-friendly billing guidance asks: plain language, what is
// owed and by when at a glance, proof that insurance paid its part, whom to call, and a
// remittance stub. It prints only what a family needs to pay: no diagnosis, member ID or
// birth date, and only the guarantor's name and address sit where an envelope window shows.
const DAY = 86400000
const isoOf = (ts) => new Date(ts).toISOString().slice(0, 10)
const usd = (n) => `$${(Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
/** "Oct 4, 2026" from an ISO date or a timestamp, read in UTC so the date never shifts. */
export const longDate = (d) => (d ? new Date(typeof d === 'number' ? d : `${d}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : '')
const AGING = [['current', 'Current', 30], ['d31', '31-60 days', 60], ['d61', '61-90 days', 90], ['d91', 'Over 90 days', Infinity]]

/** Everything the printed statement shows, computed once (pure, testable). */
export function statementView(state, st) {
  const org = state.settings?.org || {}
  const client = (state.clients || []).find((c) => c.id === st.clientId) || {}
  const isVoid = st.status === 'void'
  const [orgStreet, ...orgRest] = String(org.address || '').split(',').map((s) => s.trim())
  const lines = st.lines.map((l) => {
    const c = state.claims?.[l.claimId] || {}
    const selfPay = c.mode === 'selfpay'
    const owe = isVoid ? 0 : r2(c.id ? Math.min(l.due, patientResponsibilityOf(state, c)) : 0)
    const visits = (c.lines || []).length || 1
    const days = Math.floor((st.at - Date.parse(`${l.dosTo || l.dosFrom}T00:00:00Z`)) / DAY)
    return {
      claimNo: l.claimNo,
      dates: l.dosTo && l.dosTo !== l.dosFrom ? `${longDate(l.dosFrom)} -` : longDate(l.dosFrom),
      datesTo: l.dosTo && l.dosTo !== l.dosFrom ? longDate(l.dosTo) : '',
      service: `Therapy services, ${visits} visit${visits > 1 ? 's' : ''}`,
      codes: [...new Set((c.lines || []).map((x) => x.code).filter((x) => x && x !== '—'))].join(', '),
      billedTo: selfPay ? 'Self-pay' : l.payer,
      selfPay,
      charges: r2(l.charges),
      insPaid: selfPay ? 0 : r2(c.paid || 0),
      adj: selfPay ? 0 : r2(c.adj || 0),
      share: r2(l.due),
      paid: isVoid ? 0 : r2(l.due - owe),
      owe,
      bucket: AGING.find(([, , max]) => days <= max)[0],
    }
  })
  const due = isVoid ? 0 : r2(lines.reduce((t, l) => t + l.owe, 0))
  const aging = Object.fromEntries(AGING.map(([k]) => [k, isVoid ? 0 : r2(lines.filter((l) => l.bucket === k).reduce((t, l) => t + l.owe, 0))]))
  const payLink = paymentLinkFor(state.settings)
  const selfPay = lines.some((l) => l.selfPay)
  return {
    no: st.no,
    void: isVoid,
    date: isoOf(st.at),
    dueDate: isoOf(st.at + (Number(state.settings?.billing?.dueDays) || 30) * DAY),
    accountNo: String(client.accountNo || client.id || '').toUpperCase(),
    org: { name: org.name || 'Practice', street: orgStreet || '', cityLine: orgRest.join(', '), phone: org.phone || '', email: org.email || '' },
    guarantor: {
      name: client.guardian || client.name || '',
      street: client.street || '',
      cityLine: [client.city, [client.state, client.zip].filter(Boolean).join(' ')].filter(Boolean).join(', '),
    },
    patient: client.name || '',
    lines,
    summary: { share: r2(st.total), paid: r2(isVoid ? 0 : st.total - due), due },
    aging,
    payLink: payLink && !isVoid && due > 0 ? payLink : '',
    questions: [org.phone, org.email].filter(Boolean).join(' or ') || 'the practice',
    notices: selfPay ? ['If you are uninsured or not using insurance, you have the right to a Good Faith Estimate of expected charges. If this bill is $400 or more above your Good Faith Estimate, you may dispute it within 120 days of the date on this bill. Learn more at www.cms.gov/nosurprises.'] : [],
  }
}

/** The statement as a PDF: letter portrait, page 1 ends with the remittance stub. */
export function statementPdf(state, st) {
  const v = statementView(state, st)
  const doc = winAnsi(new jsPDF({ unit: 'pt', format: 'letter' }))
  doc.setProperties({ title: `Statement ${v.no}`, subject: `Statement for ${v.patient}`, author: v.org.name })
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
  // fill and text colour share one PDF operator, so each box sets its fill right before drawing
  const box = (x, y, w, h, fill) => { doc.setFillColor(...fill); doc.setDrawColor(...RULE); doc.setLineWidth(0.6); doc.roundedRect(x, y, w, h, 4, 4, 'FD') }

  // ---- header: return address left, statement facts right
  font(14, 'bold'); text(v.org.name, L, 56)
  font(9, 'normal', MUTED); [v.org.street, v.org.cityLine, v.org.phone].filter(Boolean).forEach((t, i) => text(t, L, 70 + i * 11))
  font(16, 'bold'); right(v.void ? 'STATEMENT - VOID' : 'STATEMENT', R, 56)
  ;[['Statement date', longDate(v.date)], ['Account number', v.accountNo], ['Statement number', v.no]].forEach(([k, val], i) => {
    font(9, 'normal', MUTED); right(k, R - 92, 72 + i * 12); font(9, 'bold'); right(val, R, 72 + i * 12)
  })

  // ---- address block, placed for a #10 window envelope: only the guarantor's name and address
  font(10.5, 'normal'); [v.guarantor.name, v.guarantor.street, v.guarantor.cityLine].filter(Boolean).forEach((t, i) => text(t, 63, 152 + i * 13))

  // ---- amount due panel
  box(330, 128, R - 330, 92, [244, 246, 251])
  font(9, 'bold', MUTED); text('AMOUNT DUE', 344, 146)
  font(24, 'bold'); text(usd(v.summary.due), 344, 174)
  font(9.5, 'normal'); text(v.void ? 'This statement was voided. Nothing is due on it.' : v.summary.due > 0 ? `Please pay by ${longDate(v.dueDate)}` : 'Paid in full. Thank you.', 344, 192)
  font(8.5, 'normal', MUTED)
  if (v.payLink) text(doc.splitTextToSize(`Pay online: ${v.payLink}`, R - 356)[0], 344, 206)
  else if (v.summary.due > 0) text('Mail a check with the stub at the bottom of this page.', 344, 206)

  // ---- patient and questions
  font(10, 'bold'); text(`Patient: ${v.patient}`, L, 244)
  font(9, 'normal', MUTED); text(`Questions about this bill? Contact ${v.questions}.`, L, 257)

  // ---- account summary
  rule(270)
  font(9, 'bold', MUTED); text('ACCOUNT SUMMARY', L, 285)
  const sum = [['Your share of these services', usd(v.summary.share)], ['Payments and credits since this statement', v.summary.paid ? `-${usd(v.summary.paid)}` : usd(0)], ['Amount due', usd(v.summary.due)]]
  sum.forEach(([k, val], i) => { font(9.5, i === 2 ? 'bold' : 'normal'); text(k, L, 300 + i * 14); right(val, 330, 300 + i * 14) })
  rule(318, L, 330)

  // ---- activity, one row per claim
  const cols = [
    { h: 'Dates of service', x: L }, { h: 'Service', x: 146 }, { h: 'Billed to', x: 250 },
    { h: 'Charges', x: 350, r: true }, { h: 'Insurance paid', x: 412, r: true }, { h: 'Adjustments', x: 464, r: true },
    { h: 'Your share', x: 514, r: true }, { h: 'You owe', x: R, r: true },
  ]
  const head = (y0) => {
    font(9, 'bold', MUTED); text('ACTIVITY', L, y0)
    font(7.5, 'bold', MUTED); cols.forEach((c) => (c.r ? right(c.h, c.x, y0 + 14) : text(c.h, c.x, y0 + 14)))
    rule(y0 + 19)
    return y0 + 31
  }
  const ROW = 24
  const STUB = 606
  const tailH = 74 + v.notices.length * 32 // aging + messages
  let y = head(344)
  const room = STUB - 16 - y
  const page1 = v.lines.length * ROW + tailH <= room ? v.lines.length : Math.max(1, Math.floor((room - 14) / ROW))
  const drawRow = (l) => {
    font(8.5, 'normal'); text(l.dates, cols[0].x, y); if (l.datesTo) text(l.datesTo, cols[0].x, y + 9.5)
    text(l.service, cols[1].x, y); font(7, 'normal', MUTED); text(`${l.claimNo}${l.codes ? ` · CPT ${l.codes}` : ''}`, cols[1].x, y + 9.5)
    font(8.5, 'normal'); text(doc.splitTextToSize(l.billedTo, 50)[0], cols[2].x, y)
    right(usd(l.charges), cols[3].x, y); right(l.selfPay ? '-' : usd(l.insPaid), cols[4].x, y); right(l.selfPay ? '-' : usd(l.adj), cols[5].x, y)
    right(usd(l.share), cols[6].x, y); font(8.5, 'bold'); right(usd(l.owe), cols[7].x, y)
    rule(y + 14)
    y += ROW
  }
  const tail = () => {
    y += 4
    font(9, 'bold', MUTED); text('HOW LONG THIS HAS BEEN OWED', L, y)
    AGING.forEach(([k, label], i) => { const x = L + i * 129; font(7.5, 'normal', MUTED); text(label, x, y + 13); font(9.5, 'bold'); text(usd(v.aging[k]), x, y + 26) })
    y += 44
    font(8, 'normal', MUTED)
    const msgs = ['"Your share" is the amount your insurance plan reported as yours after processing these services (for example coinsurance, a copay or a deductible), or the full charge for self-pay services.', ...v.notices]
    msgs.forEach((m) => { const ln = doc.splitTextToSize(m, R - L); text(ln, L, y); y += ln.length * 10 + 4 })
  }
  v.lines.slice(0, page1).forEach(drawRow)
  const rest = v.lines.slice(page1)
  if (rest.length) { font(8, 'normal', MUTED); text('Activity continues on the next page.', L, y + 2) } else tail()

  // ---- remittance stub at the foot of page 1
  doc.setLineDashPattern([3, 3], 0); rule(STUB); doc.setLineDashPattern([], 0)
  font(7.5, 'normal', MUTED); text('Please detach and return this portion with your payment.', L, STUB + 12)
  font(9, 'bold'); text(v.org.name, L, STUB + 34)
  font(9, 'normal'); [v.org.street, v.org.cityLine].filter(Boolean).forEach((t, i) => text(t, L, STUB + 46 + i * 12))
  font(8, 'normal', MUTED); text(`Make checks payable to ${v.org.name}.`, L, STUB + 76)
  font(9, 'normal'); [v.guarantor.name, v.guarantor.street, v.guarantor.cityLine].filter(Boolean).forEach((t, i) => text(t, L, STUB + 104 + i * 12))
  const stub = [['Account number', v.accountNo], ['Statement date', longDate(v.date)], ['Due date', v.summary.due > 0 ? longDate(v.dueDate) : '-'], ['Amount due', usd(v.summary.due)]]
  stub.forEach(([k, val], i) => { font(8.5, 'normal', MUTED); text(k, 330, STUB + 34 + i * 15); font(9, 'bold'); right(val, R, STUB + 34 + i * 15) })
  font(8.5, 'normal', MUTED); text('Amount enclosed', 330, STUB + 104)
  box(430, STUB + 92, R - 430, 18, [255, 255, 255]); font(9, 'normal'); text('$', 436, STUB + 104)

  // ---- continuation pages
  if (rest.length) {
    doc.addPage()
    font(11, 'bold'); text(`${v.org.name} - Statement ${v.no} (continued)`, L, 56)
    y = head(80)
    rest.forEach((l) => { if (y > 716) { doc.addPage(); y = head(56) } drawRow(l) })
    if (y + tailH > 744) { doc.addPage(); y = 64 }
    tail()
  }
  // page numbers once the page count is known
  const n = doc.getNumberOfPages()
  for (let p = 1; p <= n; p++) { doc.setPage(p); font(7.5, 'normal', MUTED); right(`Page ${p} of ${n}`, R, p === 1 ? 108 : 40) }
  if (v.void) { doc.setPage(1); font(64, 'bold', [214, 72, 72]); text('VOID', 230, 500, { angle: 20 }) }
  return doc
}
