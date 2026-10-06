// ---- CMS-1500 (02/12) claim form: NUCC field mapping + print-grid PDF ----
// Sources: NUCC 1500 Claim Form Reference Instruction Manual v13.0 (07/25) for what goes
// in each item and how it is formatted, and CMS Pub 100-04 ch. 26 §30 for the print
// grid: the form is laid out for 10-pitch pica type, 10 characters per inch across and
// 6 lines per inch down, so every field has a line (1-66) and a column (1-85).
//
// Three layers, each testable on its own:
//   cms1500Data  — the NUCC item values for one claim, already in NUCC format
//                  (uppercase, no punctuation, dates split MM DD YY, money in dollars
//                  and cents with no $ or decimal point, ICD-10 codes without dots)
//   layout1500   — where those values print: [{ line, col, text }] on the pica grid
//   claimTo1500  — the PDF. mode 'data' prints only the black data, to run through a
//                  printer loaded with genuine red-ink 02/12 forms (the only paper copy
//                  payers that scan claims will accept). mode 'copy' (the default) also
//                  draws the red form so the PDF reads on its own; it is marked as a
//                  review copy because a laser-printed replica is not OCR dropout ink.
// The electronic standard is ANSI 837P; nothing here transmits anything.
import { jsPDF } from 'jspdf'
import { winAnsi } from './exportKit'
import { posFor, memberIdOf, authNoOf, dxFor, lineApptIds } from './claims'
import { providerIdRule } from './providerIds'

export const LINES_PER_PAGE = 6 // the paper grid carries six service lines

export { posFor } // place of service lives in claims.js: claim-line modifiers key off it too

// ---------- NUCC formatting helpers ----------
// accents fold to plain letters first (Bergström → BERGSTROM): the form is ASCII OCR data
const up = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase()
/** Addresses and names: no punctuation or symbols, single spaces, uppercase. */
export const plain = (s) => up(s).replace(/[^A-Z0-9 \-]/g, ' ').replace(/\s+/g, ' ').trim()
/** IDs, account and authorization numbers: no hyphens or spaces. */
export const compact = (s) => up(s).replace(/[^A-Z0-9]/g, '')
/** Items 2, 4, 9: LAST, FIRST, MIDDLE INITIAL with commas and no periods. */
export function nameLFM(name, middle = '') {
  const parts = plain(String(name || '').replace(/\./g, '')).split(' ').filter(Boolean)
  if (!parts.length) return ''
  if (parts.length === 1) return parts[0]
  const last = parts.pop()
  const first = parts.shift()
  const mi = (plain(middle)[0] || parts[0]?.[0] || '')
  return [last, first, mi].filter(Boolean).join(', ')
}
/** ISO date → { mm, dd, yy, yyyy } for the dotted date sub-fields. */
export const dateParts = (iso) => (iso ? { mm: iso.slice(5, 7), dd: iso.slice(8, 10), yy: iso.slice(2, 4), yyyy: iso.slice(0, 4) } : null)
/** Money → dollars and cents strings, as items 24F, 28 and 29 print them ("1234" "00"). */
export function moneyParts(n) {
  const c = Math.max(0, Math.round(Number(n || 0) * 100))
  return { dollars: String(Math.floor(c / 100)), cents: String(c % 100).padStart(2, '0') }
}
/** ICD-10-CM codes print without the decimal point (F84.0 → F840). */
export const icdPlain = (code) => compact(code)
/** "1140 Sunset Crest Way, San Jose, CA 95124" → street / city / state / zip. */
export function splitAddress(s) {
  const parts = String(s || '').split(',').map((p) => p.trim()).filter(Boolean)
  if (parts.length < 2) return { street: parts[0] || '', city: '', state: '', zip: '' }
  const m = /^([A-Za-z]{2})\s*([\d-]*)$/.exec(parts[parts.length - 1]) || []
  return { street: parts[0], city: parts.length > 2 ? parts[parts.length - 2] : '', state: m[1] || '', zip: m[2] || '' }
}
const phoneParts = (s) => {
  const d = String(s || '').replace(/\D/g, '').slice(-10)
  return d.length === 10 ? { area: d.slice(0, 3), num: d.slice(3) } : null
}

// item 1 program boxes, keyed by the payer master's CMS type
const PROGRAM = { Medicare: 'MEDICARE', Medicaid: 'MEDICAID', TRICARE: 'TRICARE', CHAMPVA: 'CHAMPVA', 'Group Health Plan': 'GROUP', Commercial: 'GROUP', 'Blue Cross/Blue Shield': 'GROUP', FECA: 'FECA', Other: 'OTHER', 'Feeding Program': 'OTHER' }

// ---------- 1. NUCC item values ----------
export function cms1500Data(state, claim) {
  const org = state.settings?.org || {}
  const providers = (state.settings?.providers || []).filter((p) => p.active !== false)
  const client = (state.clients || []).find((c) => c.id === claim.clientId) || {}
  const payerRec = (state.payers || []).find((p) => p.id === claim.payerId || p.name === claim.payer) || null
  const secondaryFiling = claim.method === 'secondary'
  const rule = providerIdRule(payerRec).id
  const wantNpi = rule !== 'medicaid'
  const wantMcd = rule !== 'npi'

  // item 1: the payer master's CMS type decides; a name guess only when none is set
  const program = claim.mode === 'selfpay' ? 'OTHER'
    : PROGRAM[payerRec?.cmsType] || (/medicaid/i.test(claim.payer || '') ? 'MEDICAID' : /tricare/i.test(claim.payer || '') ? 'TRICARE' : 'GROUP')

  // patient (5) and insured (4, 7): a child is insured under the guardian's policy
  const addr = { street: plain(client.street), city: plain(client.city), state: up(client.state).slice(0, 2), zip: String(client.zip || '').replace(/\D/g, '').slice(0, 9) }
  const insuredName = client.guardian ? nameLFM(client.guardian) : nameLFM(client.name, client.middleName)
  const memberFor = (insurer, memberId) => compact(memberIdOf({ id: client.id, insurer, memberId }))

  // other coverage: on a primary claim the secondary plan, on a secondary claim the primary
  const secondaryPayer = (state.payers || []).find((p) => p.id === client.secondary?.payerId) || null
  const other = secondaryFiling
    ? { name: insuredName, policy: memberFor(client.insurer, client.memberId), plan: plain(client.insurer).slice(0, 28) }
    : secondaryPayer ? { name: insuredName, policy: compact(client.secondary?.memberId), plan: plain(secondaryPayer.name).slice(0, 28) } : null

  // providers: billing (33), service facility (32), rendering per line (24J)
  const office = providers.find((p) => p.kind === 'office') || null
  const billing = providers.find((p) => p.id === state.settings?.billing?.defaultBilling) || office
  const facility = providers.find((p) => p.id === state.settings?.billing?.defaultFacility) || office
  const orgAddr = splitAddress(org.address)
  const cityLine = (a) => plain(`${a.city} ${a.state} ${String(a.zip || '').replace(/\D/g, '')}`)
  const box32Rule = String(payerRec?.rules?.claims?.box32 || 'Auto-populate')
  const billNpi = String(billing?.npi || org.npi || '')
  const billOther = wantMcd && billing?.payerIds?.medicaid ? `G2${compact(billing.payerIds.medicaid)}` : ''

  const lineRows = claim.lines.map((l) => {
    const appt = state.appts?.[lineApptIds(l)[0]] || {}
    const sid = appt.staffIds?.[0]
    const prov = providers.find((p) => p.kind === 'staff' && p.refId === sid) || null
    const npi = wantNpi ? String(prov?.npi || '') : ''
    const mcd = wantMcd ? compact(prov?.payerIds?.medicaid) : ''
    // 24I/24J only when different from 33a/33b (NUCC)
    const sameAsBilling = npi === billNpi && (!mcd || `G2${mcd}` === billOther)
    const d = dateParts(l.dos)
    return {
      from: d, to: d, pos: posFor(appt), emg: '',
      cpt: up(l.code).slice(0, 6),
      mods: String(l.mod || '').split(/\s+/).map(up).filter(Boolean).slice(0, 4),
      ptr: 'A', // primary diagnosis first; ABA lines support the primary (autism) code
      charge: Number(l.charge || 0),
      units: String(Math.round(Number(l.units || 0) * 1000) / 1000),
      qual: sameAsBilling || !mcd ? '' : 'G2', otherId: sameAsBilling ? '' : mcd.slice(0, 11),
      npi: sameAsBilling ? '' : npi,
    }
  })
  const pages = []
  for (let i = 0; i < Math.max(1, lineRows.length); i += LINES_PER_PAGE) pages.push(lineRows.slice(i, i + LINES_PER_PAGE))

  const paidByOthers = secondaryFiling
    ? Number(Object.values(state.claims || {}).find((c) => c.no === claim.parentNo)?.paid || 0)
    : Number(claim.patientPaid || 0)
  const today = new Date().toISOString().slice(0, 10)
  const authNo = authNoOf(secondaryFiling ? { ...client, authNo: client.secondary?.authNo } : client)

  return {
    claimNo: claim.no,
    mode: claim.mode,
    providerIdRule: rule,
    items: {
      carrier: payerRec ? [plain(payerRec.name), plain(payerRec.street), cityLine(payerRec)].filter(Boolean) : [plain(claim.payer)],
      1: program,
      '1a': secondaryFiling ? memberFor(claim.payer, client.secondary?.memberId) : memberFor(claim.payer, client.memberId),
      2: nameLFM(client.name, client.middleName),
      3: { dob: dateParts(client.dob), sex: client.sex === 'F' ? 'F' : client.sex === 'M' ? 'M' : '' },
      4: insuredName,
      5: addr,
      6: client.guardian ? 'CHILD' : 'SELF',
      7: addr,
      9: other?.name || '', '9a': other?.policy || '', '9d': other?.plan || '',
      '10a': false, '10b': false, '10c': false, '10d': '',
      11: compact(payerRec?.ext?.group),
      '11c': plain(payerRec?.ext?.plan || payerRec?.name || claim.payer).slice(0, 29),
      '11d': Boolean(other),
      12: 'SIGNATURE ON FILE', 13: 'SIGNATURE ON FILE',
      19: '', 20: false,
      21: { ind: '0', codes: dxFor(client).map(icdPlain).slice(0, 12) },
      22: claim.version > 1 ? { code: '7', ref: compact(claim.payerClaimCtrl || claim.parentNo).slice(0, 17) } : null,
      23: compact(authNo).slice(0, 29),
      25: { tin: String(org.taxId || '').replace(/\D/g, ''), ein: true },
      26: compact(client.accountNo || client.id).slice(0, 14),
      27: true,
      28: Number(claim.charges || 0),
      29: paidByOthers > 0 ? paidByOthers : null,
      31: { sig: 'SIGNATURE ON FILE', date: dateParts(today) },
      32: /^Always/.test(box32Rule) && facility ? [plain(facility.name || org.name), plain(orgAddr.street), cityLine(orgAddr)] : null,
      '32a': /^Always/.test(box32Rule) && facility ? String(facility.npi || '') : '',
      33: [plain(billing?.name || org.name), plain(orgAddr.street), cityLine(orgAddr)],
      '33phone': phoneParts(org.phone),
      '33a': wantNpi || !billOther ? billNpi : '',
      '33b': billOther,
    },
    pages,
  }
}

// ---------- 2. where each value prints (line 1-66, column 1-85) ----------
// Positions measured from the CMS 02/12 sample and cross-checked with the CMS print-file
// table; `end` right-justifies a value so it finishes in that column.
const PROGRAM_COL = { MEDICARE: 1, MEDICAID: 8, TRICARE: 15, CHAMPVA: 24, GROUP: 31, FECA: 39, OTHER: 45 }

export function layout1500(d, pageIndex = 0) {
  const it = d.items
  const out = []
  const at = (line, col, text, len) => { const t = String(text ?? ''); if (t) out.push({ line, col, text: len ? t.slice(0, len) : t }) }
  const end = (line, endCol, text) => { const t = String(text ?? ''); if (t) out.push({ line, col: endCol - t.length + 1, text: t }) }
  const X = (line, col) => out.push({ line, col, text: 'X' })
  const date8 = (line, c, p) => { if (p) { at(line, c, p.mm); at(line, c + 3, p.dd); at(line, c + 6, p.yyyy) } }
  const date6 = (line, c, p) => { if (p) { at(line, c, p.mm); at(line, c + 3, p.dd); at(line, c + 6, p.yy) } }
  const pages = d.pages.length
  const last = pageIndex === pages - 1

  // carrier block, lines 4-7 (3-line address: line 6 stays blank)
  const [cn, cs, cc] = it.carrier
  at(4, 38, cn, 41); at(5, 38, cs, 41); at(7, 38, cc, 41)
  if (pages > 1) at(8, 32, `PAGE ${pageIndex + 1} OF ${pages}`)

  X(10, PROGRAM_COL[it[1]] || PROGRAM_COL.OTHER)
  at(10, 50, it['1a'], 29)
  at(12, 1, it[2], 28)
  date8(12, 31, it[3].dob)
  if (it[3].sex) X(12, it[3].sex === 'M' ? 42 : 47)
  at(12, 50, it[4], 29)
  at(14, 1, it[5].street, 28)
  X(14, { SELF: 33, SPOUSE: 38, CHILD: 42, OTHER: 47 }[it[6]])
  at(14, 50, it[7].street, 29)
  at(16, 1, it[5].city, 24); at(16, 26, it[5].state, 3)
  at(16, 50, it[7].city, 23); at(16, 74, it[7].state, 4)
  at(18, 1, it[5].zip, 12)
  at(18, 50, it[7].zip, 12)
  at(20, 1, it[9], 28)
  at(20, 50, it[11], 29)
  at(22, 1, it['9a'], 28)
  X(22, it['10a'] ? 35 : 41)
  X(24, it['10b'] ? 35 : 41)
  X(26, it['10c'] ? 35 : 41)
  at(26, 50, it['11c'], 29)
  at(28, 1, it['9d'], 28)
  at(28, 30, it['10d'], 19)
  X(28, it['11d'] ? 52 : 57)
  at(32, 7, it[12], 25)
  at(32, 56, it[13], 23)

  at(38, 1, it[19], 48)
  X(38, it[20] ? 52 : 57)
  at(39, 42, it[21].ind)
  it[21].codes.forEach((code, i) => at(40 + Math.floor(i / 4), [3, 16, 29, 42][i % 4], code, 7))
  if (it[22]) { at(40, 50, it[22].code, 11); at(40, 62, it[22].ref, 17) }
  at(42, 50, it[23], 29)

  ;(d.pages[pageIndex] || []).forEach((r, k) => {
    const shaded = 45 + 2 * k
    const line = 46 + 2 * k
    if (r.qual) at(shaded, 65, r.qual)
    at(shaded, 68, r.otherId, 11)
    date6(line, 1, r.from); date6(line, 10, r.to)
    at(line, 19, r.pos, 2)
    at(line, 22, r.emg, 2)
    at(line, 25, r.cpt, 6)
    r.mods.forEach((m, i) => at(line, [33, 36, 39, 42][i], m, 2))
    at(line, 45, r.ptr, 4)
    const m = moneyParts(r.charge)
    end(line, 55, m.dollars); at(line, 56, m.cents)
    at(line, 59, r.units, 3)
    at(line, 68, r.npi, 10)
  })

  at(58, 1, it[25].tin, 15)
  X(58, it[25].ein ? 19 : 17)
  at(58, 23, it[26], 14)
  X(58, it[27] ? 38 : 43)
  // multi-page claims: the total goes on the last page only, so the pages read as one claim
  if (last) {
    const t = moneyParts(it[28]); end(58, 57, t.dollars); at(58, 58, t.cents)
    if (it[29] != null) { const p = moneyParts(it[29]); end(58, 67, p.dollars); at(58, 68, p.cents) }
  }
  if (it['33phone']) { at(59, 66, it['33phone'].area); at(59, 70, it['33phone'].num, 9) }
  ;(it[32] || []).forEach((t, i) => at(60 + i, 23, t, 26))
  it[33].forEach((t, i) => at(60 + i, 50, t, 29))
  at(62, 1, it[31].sig, 22)
  date6(63, 6, it[31].date)
  at(63, 24, it['32a'], 10)
  at(63, 51, it['33a'], 10)
  at(63, 62, it['33b'], 17)
  return out
}

// ---------- 3. PDF ----------
export const colX = (c) => 25.2 + (c - 1) * 7.2 // left edge of print column c
export const lineY = (n) => 12 * n - 2.5 // text baseline of print line n
const INK = [0, 0, 0] // data prints in true black
const RED = [205, 72, 82] // the form's red, as close as a screen gets to OCR dropout ink
const TINT = [248, 225, 227] // the shaded half of each service line

const newDoc = () => winAnsi(new jsPDF({ unit: 'pt', format: 'letter', compress: true }))

/** One claim → one PDF. opts.mode: 'copy' (form + data, the default) or 'data' (data only, for red stock). */
export function claimTo1500(state, claim, opts = {}) {
  return claimsTo1500(state, [claim], opts)
}
export function claimsTo1500(state, claims, { mode = 'copy' } = {}) {
  const doc = newDoc()
  let started = false
  for (const claim of claims) {
    const d = cms1500Data(state, claim)
    d.pages.forEach((_, pi) => {
      if (started) doc.addPage()
      started = true
      if (mode !== 'data') drawForm(doc, d, pi)
      printData(doc, layout1500(d, pi))
    })
  }
  return doc
}

function printData(doc, fields) {
  doc.setTextColor(...INK)
  doc.setFont('courier', 'normal')
  doc.setFontSize(10) // NUCC's recommended size; 1.2pt character spacing keeps it on the 10-cpi grid
  for (const f of fields) doc.text(f.text, colX(f.col) + 0.6, lineY(f.line), { charSpace: 1.2 })
}

// The red form, drawn from the CMS 02/12 geometry (points from the top-left of the sheet).
const LX = 24.6
const RX = 593.05
const M1 = 230.9 // left | middle column, items 2-11
const M2 = 375.6 // middle | right column
function drawForm(doc, d, pageIndex) {
  const line = (x1, y1, x2, y2, w = 0.5) => { doc.setLineWidth(w); doc.line(x1, y1, x2, y2) }
  const cap = (x, y, t, size = 4.6, style = 'normal') => { doc.setFont('helvetica', style); doc.setFontSize(size); doc.text(t, x, y) }
  const box = (line_, col, label) => {
    const cx = colX(col) + 3.6
    const cy = 12 * line_ - 6
    doc.setLineWidth(0.6); doc.rect(cx - 4.5, cy - 4.5, 9, 9)
    if (label) cap(cx + 6, cy + 2, label, 4.4)
  }
  // text colour and fill colour share one PDF operator, so every fill sets its tint again
  const shade = (x, y, w, h) => { doc.setFillColor(...TINT); doc.rect(x, y, w, h, 'F') }
  doc.setDrawColor(...RED); doc.setTextColor(...RED)

  // header
  cap(colX(1), 30, 'HEALTH INSURANCE CLAIM FORM', 11, 'bold')
  doc.setTextColor(...INK)
  cap(colX(1), 40, 'APPROVED BY NATIONAL UNIFORM CLAIM COMMITTEE (NUCC) 02/12', 5.2)
  doc.setTextColor(...RED)
  cap(colX(1), 92, 'PICA', 5); cap(colX(74), 92, 'PICA', 5)
  doc.setLineWidth(0.6); doc.rect(colX(4) + 4, 86.7, 7, 7); doc.rect(colX(79) - 2, 86.7, 7, 7)

  // frame and section bars
  line(LX, 96.5, RX, 96.5, 2); line(LX, 384.5, RX, 384.5, 2); line(LX, 756.5, RX, 756.5, 2)
  line(LX, 96.5, LX, 756.5); line(RX, 96.5, RX, 756.5)

  // patient and insured section (items 1-13)
  for (const y of [121.3, 143.8, 168.8, 217.3, 239.8, 263.2, 288.8, 312.8, 336.8]) line(LX, y, RX, y)
  line(LX, 191.8, M1, 191.8); line(M2, 191.8, RX, 191.8)
  line(M1, 121.3, M1, 336.8); line(M2, 96.5, M2, 384.5)
  cap(LX + 2, 102, '1.')
  ;[[1, 'MEDICARE'], [8, 'MEDICAID'], [15, 'TRICARE'], [24, 'CHAMPVA'], [31, 'GROUP HEALTH PLAN'], [39, 'FECA BLK LUNG'], [45, 'OTHER']].forEach(([c, l]) => box(10, c, l))
  cap(M2 + 2, 102, "1a. INSURED'S I.D. NUMBER                    (For Program in Item 1)")
  cap(LX + 2, 126.5, "2. PATIENT'S NAME (Last Name, First Name, Middle Initial)")
  cap(M1 + 2, 126.5, "3. PATIENT'S BIRTH DATE           SEX"); cap(M1 + 18, 133, 'MM     DD     YY', 3.8)
  box(12, 42, 'M'); box(12, 47, 'F')
  cap(M2 + 2, 126.5, "4. INSURED'S NAME (Last Name, First Name, Middle Initial)")
  cap(LX + 2, 149, "5. PATIENT'S ADDRESS (No., Street)")
  cap(M1 + 2, 149, '6. PATIENT RELATIONSHIP TO INSURED')
  box(14, 33, 'Self'); box(14, 38, 'Spouse'); box(14, 42, 'Child'); box(14, 47, 'Other')
  cap(M2 + 2, 149, "7. INSURED'S ADDRESS (No., Street)")
  cap(LX + 2, 174, 'CITY'); cap(colX(25), 174, 'STATE'); line(colX(25) - 2, 168.8, colX(25) - 2, 191.8)
  cap(M1 + 2, 174, '8. RESERVED FOR NUCC USE')
  cap(M2 + 2, 174, 'CITY'); cap(colX(73), 174, 'STATE'); line(colX(73) - 2, 168.8, colX(73) - 2, 191.8)
  cap(LX + 2, 197, 'ZIP CODE'); cap(colX(14), 197, 'TELEPHONE (Include Area Code)'); line(colX(14) - 2, 191.8, colX(14) - 2, 217.3)
  cap(M2 + 2, 197, 'ZIP CODE'); cap(colX(64), 197, 'TELEPHONE (Include Area Code)'); line(colX(64) - 2, 191.8, colX(64) - 2, 217.3)
  cap(LX + 2, 222.5, "9. OTHER INSURED'S NAME (Last Name, First Name, Middle Initial)")
  cap(M1 + 2, 222.5, "10. IS PATIENT'S CONDITION RELATED TO:")
  cap(M2 + 2, 222.5, "11. INSURED'S POLICY GROUP OR FECA NUMBER")
  cap(LX + 2, 245, "a. OTHER INSURED'S POLICY OR GROUP NUMBER")
  cap(M1 + 2, 245, 'a. EMPLOYMENT? (Current or Previous)'); box(22, 35, 'YES'); box(22, 41, 'NO')
  cap(M2 + 2, 245, "a. INSURED'S DATE OF BIRTH                      SEX"); box(22, 68, 'M'); box(22, 75, 'F')
  cap(LX + 2, 268.5, 'b. RESERVED FOR NUCC USE')
  cap(M1 + 2, 268.5, 'b. AUTO ACCIDENT?                PLACE (State)'); box(24, 35, 'YES'); box(24, 41, 'NO')
  cap(M2 + 2, 268.5, 'b. OTHER CLAIM ID (Designated by NUCC)')
  cap(LX + 2, 294, 'c. RESERVED FOR NUCC USE')
  cap(M1 + 2, 294, 'c. OTHER ACCIDENT?'); box(26, 35, 'YES'); box(26, 41, 'NO')
  cap(M2 + 2, 294, 'c. INSURANCE PLAN NAME OR PROGRAM NAME')
  cap(LX + 2, 318, 'd. INSURANCE PLAN NAME OR PROGRAM NAME')
  cap(M1 + 2, 318, '10d. CLAIM CODES (Designated by NUCC)')
  cap(M2 + 2, 318, 'd. IS THERE ANOTHER HEALTH BENEFIT PLAN?'); box(28, 52, 'YES'); box(28, 57, 'NO')
  cap(LX + 2, 343, "READ BACK OF FORM BEFORE COMPLETING & SIGNING THIS FORM.", 5, 'bold')
  cap(LX + 2, 350, "12. PATIENT'S OR AUTHORIZED PERSON'S SIGNATURE I authorize the release of any medical or other information necessary", 4.2)
  cap(LX + 2, 355, 'to process this claim. I also request payment of government benefits either to myself or to the party who accepts assignment below.', 4.2)
  cap(M2 + 2, 343, "13. INSURED'S OR AUTHORIZED PERSON'S SIGNATURE I authorize", 4.2)
  cap(M2 + 2, 348, 'payment of medical benefits to the undersigned physician or supplier for', 4.2)
  cap(M2 + 2, 353, 'services described below.', 4.2)
  cap(LX + 2, 380, 'SIGNED', 5); cap(colX(33), 380, 'DATE', 5); cap(M2 + 2, 380, 'SIGNED', 5)
  line(60.75, 381, 240.75, 381); line(276.75, 381, M2, 381); line(417.15, 381, RX - 0.4, 381)

  // physician or supplier section (items 14-23)
  const P1 = 216.99
  for (const y of [407.8, 431.8, 456.3, 504.8]) line(LX, y, RX, y)
  line(M2, 480.1, RX, 480.1)
  line(P1, 384.5, P1, 431.8); line(M2, 384.5, M2, 504.8)
  shade(P1, 407.83, M2 - P1, 11.9); line(P1, 419.75, M2, 419.75); line(233.4, 407.8, 233.4, 419.75); line(248.9, 407.8, 248.9, 431.8)
  cap(LX + 2, 389.5, '14. DATE OF CURRENT ILLNESS, INJURY, or PREGNANCY (LMP)'); cap(colX(13), 404, 'QUAL.', 3.8)
  cap(P1 + 2, 389.5, '15. OTHER DATE'); cap(P1 + 2, 404, 'QUAL.', 3.8)
  cap(M2 + 2, 389.5, '16. DATES PATIENT UNABLE TO WORK IN CURRENT OCCUPATION')
  cap(LX + 2, 413, '17. NAME OF REFERRING PROVIDER OR OTHER SOURCE')
  cap(P1 + 2, 416, '17a.', 4.4); cap(P1 + 2, 428, '17b.  NPI', 4.4)
  cap(M2 + 2, 413, '18. HOSPITALIZATION DATES RELATED TO CURRENT SERVICES')
  cap(LX + 2, 437, '19. ADDITIONAL CLAIM INFORMATION (Designated by NUCC)')
  cap(M2 + 2, 437, '20. OUTSIDE LAB?                    $ CHARGES'); box(38, 52, 'YES'); box(38, 57, 'NO')
  cap(LX + 2, 461.5, '21. DIAGNOSIS OR NATURE OF ILLNESS OR INJURY  Relate A-L to service line below (24E)'); cap(colX(38), 467, 'ICD Ind.', 4)
  ;['A.', 'B.', 'C.', 'D.', 'E.', 'F.', 'G.', 'H.', 'I.', 'J.', 'K.', 'L.'].forEach((l, i) => cap(colX([3, 16, 29, 42][i % 4]) - 8, lineY(40 + Math.floor(i / 4)), l, 5))
  cap(M2 + 2, 461.5, '22. RESUBMISSION CODE                 ORIGINAL REF. NO.'); line(colX(61) + 4, 466, colX(61) + 4, 480.1)
  cap(M2 + 2, 485, '23. PRIOR AUTHORIZATION NUMBER')

  // item 24: header, six shaded / unshaded service lines
  const top24 = 527.2
  const rows = [527.2, 551.2, 575.8, 599.2, 623.8, 647.2, 671.2]
  for (let k = 0; k < 6; k++) shade(LX, rows[k], RX - LX, 12)
  for (const y of rows) line(LX, y, RX, y)
  const inner = [86.96, 151.38, 174.39, 195.99, 248.41, 338.91, 375.77, 421.3, 439.38]
  for (const x of inner) { line(x, 504.8, x, top24); for (let k = 0; k < 6; k++) line(x, rows[k] + 12, x, rows[k + 1]) }
  for (const x of [468.32, 483.27, 504.27]) line(x, 504.8, x, 671.2)
  cap(LX + 2, 510, '24. A.      DATE(S) OF SERVICE'); cap(LX + 6, 517, 'From                       To', 4.2); cap(LX + 4, 524, 'MM    DD    YY    MM    DD    YY', 3.8)
  cap(152.5, 514, 'B.', 4.4); cap(152.5, 520, 'PLACE OF', 3.6); cap(152.5, 524.5, 'SERVICE', 3.6)
  cap(176, 514, 'C.', 4.4); cap(176, 524.5, 'EMG', 3.6)
  cap(197.5, 510, 'D. PROCEDURES, SERVICES, OR SUPPLIES'); cap(197.5, 516, '(Explain Unusual Circumstances)', 3.8); cap(197.5, 524.5, 'CPT/HCPCS                       MODIFIER', 3.8)
  cap(340.5, 514, 'E.', 4.4); cap(340.5, 520, 'DIAGNOSIS', 3.6); cap(340.5, 524.5, 'POINTER', 3.6)
  cap(377.5, 514, 'F.', 4.4); cap(377.5, 524.5, '$ CHARGES', 4)
  cap(441, 514, 'G.', 4.4); cap(441, 520, 'DAYS OR', 3.6); cap(441, 524.5, 'UNITS', 3.6)
  cap(469.5, 514, 'H.', 4.4); cap(469.5, 520, 'EPSDT', 3.6); cap(469.5, 524.5, 'Family Plan', 3)
  cap(484.5, 514, 'I.', 4.4); cap(484.5, 520, 'ID.', 3.6); cap(484.5, 524.5, 'QUAL.', 3.6)
  cap(506, 514, 'J.', 4.4); cap(506, 520, 'RENDERING', 3.6); cap(506, 524.5, 'PROVIDER ID. #', 3.6)
  for (let k = 0; k < 6; k++) { cap(LX - 8, lineY(46 + 2 * k), String(k + 1), 6, 'bold'); cap(484.5, rows[k] + 22, 'NPI', 4.4) }

  // items 25-33
  line(LX, 695.5, RX, 695.5); line(264.44, 742.3, M2, 742.3); line(458.68, 742.3, RX, 742.3)
  for (const x of [180.87, 286.35, 375.63, 456.4, 524.79]) line(x, 671.2, x, 695.5)
  for (const c of [58, 68]) line(colX(c), 685, colX(c), 695.5) // dollars | cents in 28 and 29
  line(180.87, 695.5, 180.87, 756.5); line(M2, 695.5, M2, 756.5); line(264.44, 742.3, 264.44, 756.5); line(458.68, 742.3, 458.68, 756.5)
  shade(264.44, 742.39, M2 - 264.44, 13.3); shade(458.68, 742.34, RX - 458.68, 13.8)
  cap(LX + 2, 676.5, '25. FEDERAL TAX I.D. NUMBER          SSN   EIN'); box(58, 17); box(58, 19)
  cap(182.5, 676.5, "26. PATIENT'S ACCOUNT NO.")
  cap(288, 676.5, '27. ACCEPT ASSIGNMENT?'); cap(288, 681.5, '(For govt. claims, see back)', 3.4); box(58, 38, 'YES'); box(58, 43, 'NO')
  cap(377, 676.5, '28. TOTAL CHARGE'); cap(458, 676.5, '29. AMOUNT PAID'); cap(526.5, 676.5, '30. Rsvd for NUCC Use', 4.2)
  cap(LX + 2, 701, '31. SIGNATURE OF PHYSICIAN OR SUPPLIER', 4.4); cap(LX + 2, 706, 'INCLUDING DEGREES OR CREDENTIALS', 4.2)
  cap(LX + 2, 711, '(I certify that the statements on the reverse', 3.8); cap(LX + 2, 715.5, 'apply to this bill and are made a part thereof.)', 3.8)
  cap(LX + 2, 754, 'SIGNED', 4.4); cap(colX(16) + 2, 754, 'DATE', 4.4)
  cap(182.5, 701, '32. SERVICE FACILITY LOCATION INFORMATION')
  cap(182.5, 752, 'a.', 4.4); cap(266, 752, 'b.', 4.4)
  cap(377, 701, '33. BILLING PROVIDER INFO & PH #')
  cap(colX(65) + 2, lineY(59), '(', 8); cap(colX(69), lineY(59), ')', 8)
  cap(377, 752, 'a.', 4.4); cap(460, 752, 'b.', 4.4)

  // footer
  cap(LX, 766, 'NUCC Instruction Manual available at: www.nucc.org', 4.6)
  cap(250, 766, 'PLEASE PRINT OR TYPE', 6, 'bold')
  cap(452, 766, 'APPROVED OMB-0938-1197 FORM 1500 (02-12)', 4.6)
  // right-hand side bands
  doc.setFont('helvetica', 'bold'); doc.setFontSize(5)
  // rotated text reads upward from its start point; centre it on the band by hand
  const band = (t, yMid) => doc.text(t, 604, yMid + doc.getTextWidth(t) / 2, { angle: 90 })
  band('CARRIER', 60); band('PATIENT AND INSURED INFORMATION', 240); band('PHYSICIAN OR SUPPLIER INFORMATION', 570)

  // this PDF is a review copy: the paper claim is the data mode on genuine red stock
  doc.setTextColor(...INK)
  cap(colX(38), 14, 'REVIEW COPY - NOT FOR OCR SUBMISSION. For a paper claim, print the', 5.4, 'bold')
  cap(colX(38), 20.5, '"data only" version onto genuine red-ink CMS-1500 (02/12) forms.', 5.4, 'bold')
  if (d.mode === 'selfpay') cap(colX(38), 27, 'COURTESY COPY - self-pay account; this is not an insurance claim.', 5.4, 'bold')
  if (d.pages.length > 1 && pageIndex < d.pages.length - 1) cap(377, 694, 'CONTINUED ON NEXT PAGE - total on last page', 3.8)
  doc.setTextColor(...INK)
}
