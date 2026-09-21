// ---- CMS-1500 (02/12) claim form: field mapping + PDF rendering ----
// The mapping is a pure function (unit-testable); the renderer draws the genuine 02/12
// facsimile on letter portrait: everything pre-printed (rules, box captions, side bands,
// the PLEASE PRINT OR TYPE footer) renders in the light red "drop-out" ink of the real
// form, while data entered on the claim prints in black — exactly the convention OCR
// scanners rely on (never fill a paper 1500 in red). Boxes follow the NUCC 02/12
// numbering: 21 diagnosis A–L, 24 service grid A–J, 25 fed tax ID, 27 accept
// assignment, 28 total charge, 29 amount paid, 31/32/33 signature–facility–provider.
// The electronic standard is ANSI 837P — this PDF is the printable companion using the
// same derivations.
import { jsPDF } from 'jspdf'
import { payerPolicy, memberIdOf, authNoOf, dxFor, npiOf, dueOf } from './claims'

export const LINES_PER_PAGE = 6 // the paper grid carries six service rows

export const usDate = (iso) => (iso ? `${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(2, 4)}` : '')
export const usDateTs = (ts) => (ts ? usDate(new Date(ts).toISOString().slice(0, 10)) : '')
export const lastFirst = (name = '') => {
  const parts = String(name).trim().split(/\s+/)
  if (parts.length < 2) return String(name).toUpperCase()
  const last = parts.pop()
  return `${last.toUpperCase()}, ${parts.join(' ').toUpperCase()}`
}
export const money2 = (n) => (n == null || Number.isNaN(Number(n)) ? '' : Number(n).toFixed(2))

// place of service from where a line happened
export function posFor(appt) {
  const loc = String(appt?.location || '').toLowerCase()
  if (/home/.test(loc)) return '12' // home
  if (/school/.test(loc)) return '03' // school
  if (/community/.test(loc)) return '06' // community
  if (/telehealth|video/.test(loc)) return '10' // telehealth
  return '11' // office
}

// ---------- pure mapping (everything the renderer prints, decided in one testable pass) ----------
// Box ids here are data keys; the renderer decides which *printed* box each feeds,
// following the 02/12 captions.
export function cms1500Data(state, claim) {
  const org = state.settings.org || {}
  const client = (state.clients || []).find((c) => c.id === claim.clientId) || {}
  const staff = Object.fromEntries((state.staff || []).map((s) => [s.id, s]))
  const pol = payerPolicy(claim.payer)
  const first = state.appts[claim.lines[0]?.apptId] || {}
  const renderStaff = staff[first.staffIds?.[0]]
  const dx = dxFor(client)
  const member = memberIdOf({ id: client.id, insurer: claim.payer })
  const today = usDateTs(Date.now())
  const posKind = (name) => {
    const p = String(name || '').toLowerCase()
    if (pol.kind === 'medicaid' || /medicaid/.test(p)) return 'MEDICAID'
    if (/self/.test(p)) return 'OTHER'
    if (/tricare|va\b/.test(p)) return 'TRICARE'
    return 'GROUP HEALTH PLAN'
  }
  const b = (id, col, label, value, span = 1) => ({ id, col, span, label, value })
  return {
    boxes: [
      b('1a', 0, "Insured's I.D. number", [member]),
      b('2', 0, "Insured's / patient's name — last, first, M.I.", [lastFirst(client.name)]),
      b('2a', 0, "Patient's address", [client.home || '—']),
      b('2b', 0, "Patient's birth date", [usDate(client.dob)]), // printed in box 3 with sex
      b('2c', 0, 'Sex', [client.sex || '—']),
      b('3', 0, "Patient's birth date · sex", [usDate(client.dob), client.sex || '—']),
      b('4', 0, "Insured's name (if other than patient)", [client.guardian ? `${lastFirst(client.guardian)} (guardian)` : 'SAME AS PATIENT']),
      b('4b', 0, 'Patient relationship to insured', [client.guardian ? '05' : '01']),
      b('5', 0, "Insured's address", [client.home || '—']),
      b('6', 0, 'Other health benefits?', ['NO']),
      b('9', 0, 'Referral · records', [dx.length > 1 ? `Records support ${dx.length} diagnoses` : 'Records not required']),
      b('10', 0, 'Insurance plan ID', [String(pol.kind === 'medicaid' ? 41 : 40)]),
      b('7a', 0, 'Group / FEIN number', [`GRP-${String(400 + (client.id ? client.id.charCodeAt(1) * 7 : 0)).slice(-4)}`]),
      b('7b', 0, 'Timely filing days', [String(pol.timely)]),
      b('10d', 0, 'Accept assignment', ['YES']),
      b('11', 0, 'Authorization number', [authNoOf(client)]),
      b('12', 0, 'Claim codes', [claim.version > 1 ? 'REPLACEMENT' : '—']),
      b('14', 0, 'Diagnosis A–L', [dx.join(' ')]), // printed in 21
      b('15', 0, 'Onset / first symptom date', [usDate(claim.dosFrom)]),
      b('16', 0, 'Original reference number', [claim.parentNo || '—']),
      b('17', 0, 'Prior auth number', [authNoOf(client)]), // printed in 23
      b('18', 0, 'Hospitalization related', ['NO']),
      b('19', 0, 'Additional claim info', [`Plan of care: ${renderStaff?.cert || 'BCBA'} · ${client.school ? `school ${client.school}` : 'clinic/home services'}`]),
      b('20', 0, 'Outside lab?', ['NO']),
      b('21', 0, 'Authorized by — signature', ['BCBA plan of care']),
      b('22', 0, 'Resubmission code', [claim.version > 1 ? '7' : '—']),
      b('23', 0, 'Prior authorization number', [authNoOf(client)]),
      b('23a', 0, 'Service dates', [`${usDate(claim.dosFrom)} – ${usDate(claim.dosTo)}`]),
      b('23b', 0, 'Rendering NPI', [npiOf(first.staffIds?.[0] || 's12')]),
      b('23c', 0, 'Total charge', [`$ ${money2(claim.charges)}`]),
      b('25', 0, 'Federal tax ID', [org.taxId || '—']),
      b('26', 0, "Patient's account number", [`PULSE-${(client.id || 'c').toUpperCase()}`]),
      b('27', 0, 'Accept assignment', ['YES']),
      b('28', 0, 'Signature date', [today]),
      b('29', 0, 'Account subdivision', [`PULSE-${(client.id || 'c').toUpperCase()}`]),
      b('30', 0, 'Balance due', [`due $ ${money2(dueOf(claim))}`]),
      b('31', 0, 'Signature on file', [`X ${today}`]),
      b('32', 0, 'Service facility — name, address, NPI', [`${org.name || 'Practice'} · ${org.address || ''}`, `NPI ${org.npi || npiOf('s12')}`], 3),
      b('33', 0, 'Billing provider — name, address, phone', [org.name || 'Practice', `${org.address || ''} · ph ${org.phone || '—'}`, `NPI ${org.npi || npiOf('s12')}`], 2),
      b('33a', 0, 'Rendering provider', [renderStaff?.name || '—', `NPI ${npiOf(first.staffIds?.[0] || 's12')}`]),
    ],
    typeOfService: posKind(claim.payer),
    claimNo: claim.no,
    mode: claim.mode,
    payer: claim.payer,
    patientName: client.name || '',
    totalCharge: money2(claim.charges),
    amountPaid: claim.status === 'paid' ? money2(claim.paid) : '',
    adjustments: claim.adj ? money2(claim.adj) : '',
    due: money2(dueOf(claim)),
    renderNpi: npiOf(first.staffIds?.[0] || 's12'),
    pages: chunkLines(claim, dx, state),
    note: `${claim.no} · ${claim.mode === 'selfpay' ? 'family invoice (courtesy copy)' : 'insurer claim'} · generated ${new Date().toISOString().slice(0, 10)} — printable companion; e-file via ANSI 837P`,
  }
}
function chunkLines(claim, dx, state) {
  const rows = claim.lines.map((l, i) => {
    const appt = state?.appts?.[l.apptId] || {}
    return {
      seq: i + 1,
      from: usDate(l.dos), through: usDate(l.dos),
      pos: posFor(appt),
      cpt: l.code || '', mod: l.mod || '',
      npi: npiOf(l.staffIds?.[0] || appt.staffIds?.[0] || 's12'),
      ptr: String((i % Math.max(1, dx.length)) + 1), // cycle through dx codes as 24E pointers
      units: String(l.units ?? ''),
      dayUnits: l.kind === 'mileage' ? 'MI' : '',
      rate: money2(l.rate), charge: money2(l.charge),
    }
  })
  const out = []
  for (let i = 0; i < Math.max(1, rows.length); i += LINES_PER_PAGE) out.push(rows.slice(i, i + LINES_PER_PAGE))
  return out
}

// ---------- renderer ----------
const PW = 612
const PH = 792
const L = 24 // left margin of the form
const R = 584 // right margin (band occupies 586..600)
const CW = R - L
// the print colors of the real form: light red "drop-out" ink on white bond
const RED = [197, 113, 124] // rules + pre-printed captions
const BAND = [201, 101, 115] // solid side bands / footer band
const TINT = [238, 214, 218] // shaded service rows
const WASH = [247, 239, 241] // very light cell wash
const BLACK = [26, 26, 26] // what a provider would type on the form

const newDoc = () => new jsPDF({ unit: 'pt', format: 'letter', compress: true })

export function claimTo1500(state, claim) {
  const doc = newDoc()
  const d = cms1500Data(state, claim)
  d.pages.forEach((pageLines, pi) => {
    if (pi > 0) doc.addPage()
    drawPage(doc, state, claim, d, pageLines, pi)
  })
  return doc
}
export function claimsTo1500(state, claims) {
  const doc = newDoc()
  let started = false
  for (const claim of claims) {
    const d = cms1500Data(state, claim)
    for (let pi = 0; pi < d.pages.length; pi++) {
      if (started) doc.addPage()
      started = true
      drawPage(doc, state, claim, d, d.pages[pi], pi)
    }
  }
  return doc
}

const clip = (s, wPt, size) => {
  s = String(s ?? '')
  const max = Math.max(6, Math.floor(wPt / (size * 0.5)))
  return s.length > max ? s.slice(0, max - 1) + '…' : s
}
const val = (d, id) => d.boxes.find((b) => b.id === id)?.value || []

// one pre-printed cell: red rule + red caption strip + black entered values
function cell(doc, x, y, w, h, { num = '', label = '', sub = '', lines = [], tint = null, ticks = 0 } = {}) {
  if (tint) { doc.setFillColor(...tint); doc.rect(x, y, w, h, 'F') }
  doc.setDrawColor(...RED); doc.setLineWidth(0.5)
  doc.setFillColor(255, 255, 255)
  doc.rect(x, y, w, h, 'S')
  let ty = y + 5.2
  if (num || label) {
    doc.setTextColor(...RED)
    doc.setFont('helvetica', 'bold'); doc.setFontSize(4.4)
    doc.text(num, x + 2.6, ty)
    const nw = doc.getTextWidth(num)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(3.9)
    doc.text(clip(String(label).toUpperCase(), w - nw - 10, 3.9), x + 3.4 + nw + 2.2, ty)
    if (sub) { doc.setFontSize(3.4); doc.text(clip(sub, w - 8, 3.4), x + 2.6, ty + 4.6) }
    ty += sub ? 9.8 : 5.6
  }
  doc.setTextColor(...BLACK)
  for (const v of lines) {
    if (ty > y + h - 1.5) break
    if (!v || !v.text) continue
    doc.setTextColor(...(v.red ? RED : BLACK))
    doc.setFont('helvetica', v.style === 'i' ? 'italic' : v.style === 'n' ? 'normal' : 'bold')
    const size = v.size || 6.4
    let s = String(v.text)
    doc.setFontSize(size)
    while (doc.getTextWidth(s) > w - 5.2 && doc.getFontSize() > 3.4) doc.setFontSize(doc.getFontSize() - 0.4)
    const ax = v.align === 'right' ? x + w - 2.6 : x + 2.6
    doc.text(clip(s, w - 5.2, doc.getFontSize()), ax, ty + size * 0.86, v.align === 'right' ? { align: 'right' } : undefined)
    ty += v.gap ?? Math.max(6.4, size * 1.16)
    doc.setTextColor(...BLACK)
  }
  if (ticks > 0) {
    // MM/DD/YY tick marks along the bottom of a date cell
    const tw = w - 8; const step = tw / 3
    doc.setLineWidth(0.4)
    for (let i = 1; i < 3; i++) doc.line(x + 4 + step * i - 4 * i / 3, y + h - 5.5, x + 4 + step * i - 4 * i / 3, y + h - 2.5)
    doc.setFontSize(3); doc.setTextColor(...RED)
    doc.text('MM      DD      YY', x + w / 2, y + h - 6.4, { align: 'center' })
    doc.setTextColor(...BLACK)
  }
}
function opts(doc, x, y, items, size = 3.9) {
  let ox = x
  doc.setTextColor(...RED)
  for (const [t, on] of items) {
    doc.setLineWidth(0.5); doc.rect(ox, y - 3.3, 4.2, 4.2, 'S')
    if (on) {
      doc.setTextColor(...BLACK); doc.setFont('helvetica', 'bold'); doc.setFontSize(3.8)
      doc.text('X', ox + 0.75, y); doc.setTextColor(...RED)
    }
    ox += 5.6
    doc.setFont('helvetica', 'normal'); doc.setFontSize(size)
    const parts = t.split('\n')
    parts.forEach((p, i) => doc.text(p, ox, y + i * (size + 0.6)))
    ox += Math.max(...parts.map((p) => doc.getTextWidth(p))) + 4.4
  }
  doc.setTextColor(...BLACK)
  return ox
}

function drawPage(doc, state, claim, d, lines, pageNo) {
  doc.setFont('helvetica', 'normal')
  // ================= header =================
  doc.setTextColor(...BLACK)
  const qr = [[1,1,1,1,1],[1,0,1,0,1],[1,1,1,0,1],[0,1,0,0,0],[1,1,1,0,1]]
  for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) if (qr[i][j]) { doc.rect(L + j * 3.4, 18 + i * 3.4, 2.6, 2.6, 'F') }
  doc.setLineWidth(0.4); doc.rect(L, 16.5, 17.4, 17.4)
  doc.setTextColor(...RED)
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5)
  doc.text('HEALTH INSURANCE CLAIM FORM', L + 22, 26)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(4.6)
  doc.text('APPROVED BY NATIONAL UNIFORM CLAIM COMMITTEE (NUCC) 02/12', L + 22, 32)
  doc.setFontSize(3.9)
  doc.text('TYPE IN 2D BAR CODE', L, 38.5)
  doc.setLineWidth(0.5); doc.setDrawColor(...RED); doc.rect(R - 112, 14, 112, 27)
  doc.setFontSize(4); doc.text('FORM APPROVED', R - 56, 20, { align: 'center' })
  doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.text('1500', R - 78, 33, { align: 'center' })
  doc.setFont('helvetica', 'normal'); doc.setFontSize(3.8)
  doc.text('OMB No. 0938-1197   Exp. Date 04-30-2015', R - 40, 28, { align: 'center' })
  doc.text('PICA   [  ]  [  ]  [  ]', R - 40, 37, { align: 'center' })
  if (d.pages.length > 1) {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8)
    doc.text(pageNo === 0 ? '· S U B S T I T U T E ·' : '· C O N T I N U E D ·', (L + R) / 2, 26, { align: 'center' })
    doc.setFont('helvetica', 'normal'); doc.setFontSize(4.2)
    doc.text(`page ${pageNo + 1} of ${d.pages.length} for ${d.claimNo}`, (L + R) / 2, 32, { align: 'center' })
  }
  doc.setTextColor(...BLACK)

  // ================= box grid (stretched to fill the sheet like the paper form) =================
  const FF = 1.6 // row-height fill factor
  const y0 = 44
  const rows = [
    { h: 22, cells: [
      { f: 0.615, num: '1.', label: 'Type of service', optsRow: 1 },
      { f: 0.385, num: '1a.', label: "Insured's I.D. number", sub: '(For Program in Item 1)', lines: [{ text: val(d, '1a')[0] }] },
    ] },
    { h: 22, cells: [
      { f: 0.40, num: '2.', label: "Insured's or patient's name — last, first, middle initial", lines: [{ text: val(d, '2')[0], size: 7 }] },
      { f: 0.235, num: '3.', label: "Patient's birth date · sex", dobSex: 1, lines: [{ text: val(d, '3')[0], size: 6.4 }] },
      { f: 0.365, num: '4.', label: "Insured's name (last, first, middle initial)", lines: [{ text: val(d, '4')[0], size: 6.4 }] },
    ] },
    { h: 22, cells: [
      { f: 0.265, num: '2a.', label: "Patient's address (No., Street)", lines: [{ text: val(d, '2a')[0], style: 'n', size: 6 }] },
      { f: 0.145, num: '6.', label: 'Patient relationship to insured', relBox: 1 },
      { f: 0.265, num: '5.', label: "Insured's address", lines: [{ text: val(d, '5')[0], style: 'n', size: 6 }] },
      { f: 0.325, num: '1b.', label: "Insured's policy number or social security number", lines: [{ text: val(d, '1a')[0] }] },
    ] },
    { h: 21, cells: [
      { f: 0.41, num: '2b.', label: "Patient's city, state, ZIP code", lines: [] },
      { f: 0.24, num: '8.', label: 'Reserved for NUCC use', blank: 1 },
      { f: 0.12, num: '2c.', label: 'Patient phone', phoneBox: 1 },
      { f: 0.22, num: '1c.', label: 'Group or FEIN number', lines: [{ text: val(d, '7a')[0] }] },
    ] },
    { h: 26, cells: [
      { f: 0.47, num: '9.', label: "Is the patient's condition related to?", condRow: 1 },
      { f: 0.30, num: '10.', label: 'Insurance plan ID', sub: '10d. Claim codes (Designated by NUCC)', lines: [{ text: `${val(d, '10')[0]}   ·   ${val(d, '7b')[0]}-day timely filing`, size: 5.8 }, { text: val(d, '12')[0], red: true }] },
      { f: 0.23, num: '11.', label: 'Authorization number', lines: [{ text: val(d, '11')[0], size: 6.4 }, { text: `referral: ${val(d, '9')[0]}`, style: 'i', size: 4 }] },
    ] },
    { h: 26, cells: [
      { f: 0.60, num: '12.', label: "Patient's or authorized person's signature", readback: 1, lines: [{ text: 'ON FILE · electronic signature retained in the practice record', style: 'i', size: 4.4 }, { text: `SIGNED  X          DATE  ${val(d, '28')[0]}`, size: 5.6 }] },
      { f: 0.40, num: '13.', label: "Insured's or authorized person's signature", lines: [{ text: 'ON FILE · assignment of benefits accepted', style: 'i', size: 4.4 }, { text: `SIGNED  X          DATE  ${val(d, '28')[0]}`, size: 5.6 }] },
    ] },
    { h: 21, cells: [
      { f: 0.36, num: '14.', label: 'Date of current illness, injury, or pregnancy (LMP)', lines: [{ text: val(d, '15')[0], size: 6.4 }], ticks: 1 },
      { f: 0.20, num: '15.', label: 'Other date · qual.', lines: [{ text: '—   25 (onset)', size: 6 }], ticks: 1 },
      { f: 0.44, num: '16.', label: 'Dates patient unable to work in current occupation', lines: [{ text: `${val(d, '23a')[0]}`, size: 6 }], ticks: 1 },
    ] },
    { h: 21, cells: [
      { f: 0.47, num: '17.', label: 'Name of referring provider or other source', lines: [{ text: '17a. NPI  —        17b.  —', size: 5.6 }] },
      { f: 0.53, num: '18.', label: 'Hospitalization dates related to current services', lines: [{ text: `${val(d, '18')[0]} — outpatient ABA services`, style: 'n', size: 5.8 }], ticks: 1 },
    ] },
    { h: 23, cells: [
      { f: 0.44, num: '19.', label: 'Additional claim information (Designated by NUCC)', lines: [{ text: val(d, '19')[0], style: 'n', size: 4.8 }] },
      { f: 0.30, num: '20.', label: 'Outside lab?', outsideLab: 1 },
      { f: 0.26, num: '21.', label: 'Diagnosis or nature of illness or injury', dxStrip: 1 },
    ] },
    { h: 20, cells: [
      { f: 0.42, num: '22.', label: 'Resubmission code', sub: 'original reference number', lines: [{ text: `${val(d, '22')[0] || '—'}   ·   ${val(d, '16')[0]}`, size: 5.6 }] },
      { f: 0.34, num: '23.', label: 'Prior authorization number', lines: [{ text: val(d, '23')[0], size: 6.2 }] },
      { f: 0.24, num: '10e.', label: 'Clinical trial?', trialBox: 1 },
    ] },
  ]
  let y = y0
  for (const row of rows) {
    const H = row.h * FF
    let x = L
    for (const c of row.cells) {
      const w = c.f * CW
      const spec = { num: c.num, label: c.label, sub: c.sub, lines: c.lines }
      if (c.blank) spec.lines = [{ text: ' ', size: 1 }]
      cell(doc, x, y, w, H, spec)
      if (c.optsRow) {
        opts(doc, x + 13, y + H * 0.52, [['MEDICARE\n(Medicare #)', d.typeOfService === 'MEDICAID'], ['MEDICAID\n(Medicaid #)', d.typeOfService === 'MEDICAID'], ['TRICARE\n(ID#/DoD#)', d.typeOfService === 'TRICARE'], ['CHAMPVA\n(Member ID#)', false], ['GROUP HEALTH PLAN\n(ID#)', d.typeOfService === 'GROUP HEALTH PLAN'], ['FECA', false], ['BLK LUNG', false], ['OTHER\n(ID#)', d.typeOfService === 'OTHER']])
      }
      if (c.dobSex) {
        opts(doc, x + w - 40, y + H * 0.62, [['M', val(d, '3')[1] === 'M'], ['F', val(d, '3')[1] === 'F']])
        doc.setTextColor(...RED); doc.setFontSize(3.4); doc.text('SEX', x + w - 42, y + H * 0.35)
        doc.setTextColor(...BLACK)
      }
      if (c.relBox) {
        const rel = val(d, '4b')[0] === '05' ? 'OTHER' : 'SELF'
        opts(doc, x + 4, y + H - 8, rel === 'SELF' ? [['SELF', true], ['SPOUSE', false], ['CHILD', false], ['OTHER', false]] : [['SELF', false], ['SPOUSE', false], ['CHILD', false], ['OTHER', true]], 3.4)
        doc.setFont('helvetica', 'bold'); doc.setFontSize(6.4); doc.setTextColor(...BLACK)
        doc.text(rel === 'SELF' ? 'SELF (01)' : 'OTHER — guardian (05)', x + w - 3, y + 16, { align: 'right' })
        doc.setFont('helvetica', 'normal')
      }
      if (c.phoneBox) {
        doc.setTextColor(...RED); doc.setLineWidth(0.5)
        doc.rect(x + 4, y + H * 0.45, 34, 9); doc.rect(x + 41, y + H * 0.45, 18, 9); doc.rect(x + 62, y + H * 0.45, 12, 9)
        doc.setFontSize(3.2); doc.text('(   )  —  [   ]', x + 4, y + H * 0.45 - 1.5)
        doc.setTextColor(...BLACK)
      }
      if (c.condRow) {
        opts(doc, x + 4, y + H * 0.38, [['a. EMPLOYMENT?', false], ['Y', false], ['N', true]])
        opts(doc, x + 4, y + H * 0.82, [['b. AUTO ACCIDENT?', false], ['Y', false], ['N', true]])
        opts(doc, x + w * 0.60, y + H * 0.38, [['c. OTHER ACCIDENT?', false], ['N', true]])
        doc.setFontSize(3.6); doc.setTextColor(...RED)
        doc.text('PLACE (STATE) ____        PLACE (STATE) ____', x + w - 3, y + H * 0.62, { align: 'right' })
        doc.setTextColor(...BLACK)
      }
      if (c.readback) {
        doc.setFont('helvetica', 'bold'); doc.setFontSize(5.6); doc.setTextColor(...RED)
        doc.text('READ BACK OF FORM BEFORE COMPLETING & SIGNING THIS FORM.', x + 3, y + 11)
        doc.setTextColor(...BLACK); doc.setFont('helvetica', 'normal')
      }
      if (c.outsideLab) opts(doc, x + 4, y + H * 0.62, [['YES', false], ['NO', true]])
      if (c.trialBox) opts(doc, x + 4, y + H * 0.62, [['YES', false], ['NO', false]])
      if (c.dxStrip) {
        const dxl = val(d, '14')[0].split(/\s+/).filter(Boolean)
        doc.setFontSize(5.8); doc.setTextColor(...BLACK); doc.setFont('helvetica', 'bold')
        dxl.slice(0, 4).forEach((v, i) => doc.text(`${'ABCDEFGHIJKL'[i]}. ${v}`, x + 4 + i * ((w - 8) / 4), y + H * 0.72))
        doc.setFont('helvetica', 'normal')
      }
      x += w
    }
    y += H
  }

  // ================= service block (box 24) + right column 25/26/27 =================
  const tW = CW * 0.655
  const rX = L + tW
  const cols = [
    { k: 'seq', w: 0.042, h1: '24', h2: '' },
    { k: 'from', w: 0.148, h1: 'A. DATE(S) OF SERVICE', h2: 'MM  DD  YY' },
    { k: 'pos', w: 0.058, h1: 'B. PLACE OF SERVICE', h2: '' },
    { k: 'emg', w: 0.044, h1: 'C. EMG', h2: '' },
    { k: 'cpt', w: 0.238, h1: 'D. PROCEDURES, SERVICES, OR SUPPLIES', h2: 'CPT/HCPCS   MODIFIER' },
    { k: 'ptr', w: 0.07, h1: 'E. DX POINTER', h2: '' },
    { k: 'charge', w: 0.104, h1: 'F. $ CHARGES', h2: '' },
    { k: 'units', w: 0.08, h1: 'G. DAYS OR UNITS', h2: '' },
    { k: 'epsdt', w: 0.055, h1: 'H. EPSDT', h2: '' },
    { k: 'qual', w: 0.052, h1: 'I. ID QUAL', h2: '' },
    { k: 'npi', w: 0.109, h1: 'J. RENDERING NPI', h2: '' },
  ]
  const hh = 21
  doc.setFillColor(...WASH); doc.rect(L, y, tW, hh, 'F')
  doc.setDrawColor(...RED); doc.setLineWidth(0.5)
  let cx = L
  for (const c of cols) {
    const w = c.w * tW
    doc.rect(cx, y, w, hh)
    doc.setTextColor(...RED); doc.setFont('helvetica', 'bold'); doc.setFontSize(3.8)
    const label = c.k === 'seq' ? '24' : c.h1
    doc.text(clip(label, w - 3, 3.8), cx + 2, y + 5.4)
    if (c.h2) { doc.setFont('helvetica', 'normal'); doc.setFontSize(3.2); doc.text(clip(c.h2, w - 3, 3.2), cx + 2, y + 10) }
    doc.setTextColor(...BLACK)
    cx += w
  }
  const RH = 16.5
  const rH = (hh + 6 * RH) / 3
  const rh = y
  cell(doc, rX, rh, CW - tW, rH, { num: '25.', label: 'Federal tax I.D. number', sub: 'SSN / EIN', lines: [{ text: val(d, '25')[0], size: 7.4 }] })
  cell(doc, rX, rh + rH, CW - tW, rH, { num: '26.', label: "Patient's account number", lines: [{ text: val(d, '26')[0], size: 7.4 }] })
  cell(doc, rX, rh + 2 * rH, CW - tW, rH, { num: '27.', label: 'Accept assignment?', sub: '(For govt. claims, see back)', lines: [] })
  opts(doc, rX + 6, rh + 2 * rH + rH - 11, [['YES', val(d, '27')[0] === 'YES'], ['NO', val(d, '27')[0] !== 'YES']], 4.4)
  y += hh
  for (let i = 0; i < LINES_PER_PAGE; i++) {
    const ln = lines[i]
    if (i % 2 === 0) { doc.setFillColor(...TINT); doc.rect(L, y, tW, RH, 'F') }
    doc.setDrawColor(...RED); doc.setLineWidth(0.5)
    cx = L
    for (const c of cols) {
      const w = c.w * tW
      doc.rect(cx, y, w, RH)
      if (ln) {
        let v = ln[c.k]
        if (c.k === 'seq') v = String(ln.seq)
        if (c.k === 'from' && ln.through && ln.through !== ln.from) v = `${ln.from}–${ln.through}`
        if (c.k === 'cpt') v = `${ln.cpt}${ln.mod ? `  ${ln.mod}` : ''}`
        if (c.k === 'units') v = ln.dayUnits ? `${ln.units} ${ln.dayUnits}` : ln.units
        if (c.k === 'epsdt' || c.k === 'qual' || c.k === 'emg') v = ''
        if (v) {
          const right = c.k === 'charge'
          doc.setTextColor(...BLACK)
          doc.setFont('helvetica', c.k === 'charge' || c.k === 'seq' ? 'bold' : 'normal')
          const size = c.k === 'npi' ? 5 : 6
          doc.setFontSize(size)
          const s = clip(String(v), w - 3.5, size)
          doc.text(s, right ? cx + w - 2 : cx + 2, y + RH - 5, right ? { align: 'right' } : undefined)
        }
      }
      cx += w
    }
    y += RH
  }
  // ================= totals band: 28 / 29 / 30 =================
  doc.setFillColor(...WASH); doc.rect(L, y, CW, 20, 'F')
  doc.setDrawColor(...RED)
  doc.rect(L, y, CW, 20)
  doc.rect(rX, y, CW - tW, 20)
  doc.rect(rX + (CW - tW) * 0.62, y, (CW - tW) * 0.38, 20)
  doc.setFont('helvetica', 'bold'); doc.setFontSize(4.6); doc.setTextColor(...RED)
  doc.text('28. TOTAL CHARGE $', L + 3, y + 7)
  doc.text('29. AMOUNT PAID $', rX + 3, y + 7)
  doc.setFontSize(4)
  doc.text('30. RESERVED FOR NUCC USE', rX + (CW - tW) * 0.62 + 3, y + 7)
  doc.setTextColor(...BLACK); doc.setFont('helvetica', 'bold'); doc.setFontSize(7.6)
  doc.text(clip(d.totalCharge, (rX - L) / 2, 7.6), rX - 4, y + 15, { align: 'right' })
  doc.setFont('helvetica', 'normal'); doc.setFontSize(5)
  doc.text(`due $ ${d.due}${d.adjustments ? ` · adjustment $ ${d.adjustments}` : ''}`, L + 3, y + 15)
  doc.setFont('helvetica', 'bold'); doc.setFontSize(7.6)
  doc.text(clip(d.amountPaid || '—', (CW - tW) * 0.5, 7.6), rX + (CW - tW) * 0.62 - 4, y + 15, { align: 'right' })
  y += 20

  // ================= signature / facility / provider =================
  const sigH = 62
  cell(doc, L, y, CW * 0.40, sigH, {
    num: '31.', label: 'Signature of physician or supplier',
    sub: '(I certify that the statements on the reverse apply to this bill and are made a part thereof.)',
    lines: [{ text: `${val(d, '33a')[0]} · ${val(d, '21')[0]}`, style: 'i', size: 4.6 }, { text: `SIGNED  X        DATE  ${val(d, '28')[0]}`, size: 6 }],
  })
  const f32 = val(d, '32')
  cell(doc, L + CW * 0.40, y, CW * 0.30, sigH, {
    num: '32.', label: 'Service facility location information',
    lines: [{ text: f32[0], style: 'n', size: 4.8 }, { text: f32[1] || '', size: 6 }],
  })
  doc.setFontSize(3.4); doc.setTextColor(...RED)
  doc.text('32a. NPI', L + CW * 0.40 + 3, y + sigH - 5)
  doc.setTextColor(...BLACK)
  const f33 = val(d, '33')
  cell(doc, L + CW * 0.70, y, CW * 0.30, sigH, {
    num: '33.', label: 'Billing provider info & ph. #',
    lines: [{ text: f33[0], style: 'n', size: 4.8 }, { text: f33[1] || '', size: 4.4 }, { text: f33[2] || '', size: 5.6 }],
  })
  doc.setFontSize(3.4); doc.setTextColor(...RED)
  doc.text('33a. NPI', L + CW * 0.70 + 3, y + sigH - 5)
  doc.setTextColor(...BLACK)
  y += sigH

  // ================= solid footer band =================
  doc.setFillColor(...BAND); doc.rect(L, y, CW, 13, 'F')
  doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(6.8)
  doc.text('PLEASE PRINT OR TYPE', (L + R) / 2, y + 8.8, { align: 'center' })
  const formBottom = y + 13
  doc.setTextColor(...RED); doc.setFont('helvetica', 'normal'); doc.setFontSize(3.8)
  doc.text('NUCC Instruction Manual available at: www.nucc.org', L, formBottom + 6)
  doc.text('WCMS-1500CS-12', (L + R) / 2, formBottom + 6, { align: 'center' })
  doc.text('APPROVED OMB 0938-1197  FORM 1500 (02-12)', R, formBottom + 6, { align: 'right' })
  let ny = formBottom + 13
  if (claim.mode === 'selfpay') {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.setTextColor(...RED)
    doc.text('COURTESY COPY — family invoice; payer boxes reflect the self-pay account.', (L + R) / 2, ny + 7, { align: 'center' })
    doc.setTextColor(...BLACK); doc.setFont('helvetica', 'normal')
    ny += 12
  }
  doc.setFontSize(4.4); doc.setTextColor(...RED)
  doc.text(d.note, L, ny + 7)
  doc.text(`Page ${pageNo + 1} of ${d.pages.length} for ${d.claimNo} · Aloha ABA`, R, ny + 7, { align: 'right' })
  doc.setTextColor(...BLACK)

  // ================= right side bands (drawn last, sized to the real form bottom) =================
  const bandX = R + 2
  const midY = 44 + (formBottom - 44) * 0.55
  doc.setFillColor(...BAND); doc.setDrawColor(...BAND)
  doc.rect(bandX, 44, 14, midY - 46, 'F')
  doc.rect(bandX, midY, 14, formBottom - midY - 2, 'F')
  doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(5)
  doc.text('C A R R I E R', bandX + 10, (44 + midY) / 2, { angle: 90, align: 'center' })
  doc.text('PATIENT AND INSURANCE INFORMATION', bandX + 10, (midY + formBottom) / 2, { angle: 90, align: 'center' })
  // small fold arrows like the paper stock
  doc.setFillColor(255, 255, 255)
  const ay = (44 + midY) / 2 + 52
  doc.triangle(bandX + 5, ay, bandX + 9, ay, bandX + 7, ay + 4, 'F')
  doc.triangle(bandX + 5, formBottom - 10, bandX + 9, formBottom - 10, bandX + 7, formBottom - 14, 'F')
  doc.setTextColor(...BLACK)
}
