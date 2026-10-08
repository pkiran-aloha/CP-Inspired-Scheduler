// ---- CMS-1500 (02/12): NUCC item values, print-grid layout and PDF, over the demo ledger ----
import { describe, it, expect } from 'vitest'
import { blankState } from '../state/store'
import {
  cms1500Data, layout1500, claimTo1500, claimsTo1500, posFor, LINES_PER_PAGE,
  nameLFM, moneyParts, splitAddress, plain, compact, colX, lineY,
} from '../lib/cms1500'
import { lineFor } from '../lib/claims'

const st = blankState()
const anyClaim = (pred) => Object.values(st.claims).find(pred)
const claim = anyClaim((c) => c.mode === 'insurance' && c.lines.length >= 2)
const client = st.clients.find((c) => c.id === claim.clientId)
const withClient = (patch) => ({ ...st, clients: st.clients.map((c) => (c.id === claim.clientId ? { ...c, ...patch } : c)) })
const at = (fields, line, col) => fields.find((f) => f.line === line && f.col === col)?.text

describe('NUCC formatting rules', () => {
  it('names are LAST, FIRST, MI with commas, no periods, accents folded (items 2, 4, 9)', () => {
    expect(nameLFM('Justin Hsu')).toBe('HSU, JUSTIN')
    expect(nameLFM('Mary Ann Smith-Jones')).toBe('SMITH-JONES, MARY, A')
    expect(nameLFM('L. Hsu')).toBe('HSU, L')
    expect(nameLFM('Noah Bergström', 'Erik')).toBe('BERGSTROM, NOAH, E')
  })

  it('addresses drop punctuation; IDs drop hyphens and spaces', () => {
    expect(plain('123 N. Main Street, #101')).toBe('123 N MAIN STREET 101')
    expect(compact('AUTH-2026-41305')).toBe('AUTH202641305')
    expect(splitAddress('1140 Sunset Crest Way, San Jose, CA 95124-3301')).toEqual({ street: '1140 Sunset Crest Way', city: 'San Jose', state: 'CA', zip: '95124-3301' })
  })

  it('money splits into dollars and cents with no $ or decimal point', () => {
    expect(moneyParts(1234)).toEqual({ dollars: '1234', cents: '00' })
    expect(moneyParts(128.5)).toEqual({ dollars: '128', cents: '50' })
    expect(moneyParts(-5)).toEqual({ dollars: '0', cents: '00' }) // negatives are not allowed on the form
  })
})

describe('cms1500Data: NUCC item values from the workspace', () => {
  const d = cms1500Data(withClient({ street: '42 Maple Ave.', city: 'San Jose', state: 'CA', zip: '95124-1234' }), claim)
  const items = d.items

  it('patient and insured: a child is insured under the guardian; ZIP prints without the hyphen (items 2-7)', () => {
    expect(items[2]).toBe(nameLFM(client.name))
    expect(items[3].dob.yyyy).toHaveLength(4)
    expect(['M', 'F']).toContain(items[3].sex)
    expect(items[4]).toBe(nameLFM(client.guardian))
    expect(items[6]).toBe('CHILD')
    expect(items[5]).toEqual({ street: '42 MAPLE AVE', city: 'SAN JOSE', state: 'CA', zip: '951241234' })
    expect(items[7]).toEqual(items[5])
  })

  it('diagnoses print with ICD indicator 0 and no decimal point; every line points at A', () => {
    expect(items[21].ind).toBe('0')
    items[21].codes.forEach((c) => expect(c).toMatch(/^[A-Z][0-9A-Z]{2,6}$/))
    expect(items[21].codes[0]).toBe('F840')
    d.pages.flat().forEach((r) => expect(r.ptr).toBe('A'))
  })

  it('service lines: six per page, CPT + up to four modifiers, NPI only when it differs from 33a', () => {
    const big = anyClaim((c) => c.lines.length > LINES_PER_PAGE)
    if (big) {
      const db = cms1500Data(st, big)
      expect(db.pages.length).toBe(Math.ceil(big.lines.length / LINES_PER_PAGE))
      db.pages.forEach((p) => expect(p.length).toBeLessThanOrEqual(LINES_PER_PAGE))
    }
    const row = d.pages[0][0]
    const dos = claim.lines[0].dos
    expect(row.cpt).toBe(String(claim.lines[0].code).toUpperCase())
    expect(row.mods.length).toBeLessThanOrEqual(4)
    expect(row.from.mm + row.from.dd + row.from.yy).toBe(dos.slice(5, 7) + dos.slice(8, 10) + dos.slice(2, 4))
    if (row.npi) expect(row.npi).not.toBe(items['33a'])
  })

  it('billing provider, tax ID and authorization use NUCC formats (items 23, 25, 27, 32, 33)', () => {
    expect(items[25]).toEqual({ tin: st.settings.org.taxId.replace(/\D/g, ''), ein: true })
    expect(items[33][0]).toBe(plain(st.settings.org.name))
    expect(items[33][2]).toMatch(/^[A-Z ]+ [A-Z]{2} \d{5,9}$/) // CITY ST ZIP, no comma
    expect(items['33a']).toMatch(/^\d{10}$/)
    expect(items['33phone']).toEqual({ area: '408', num: '5550134' })
    expect(items[23]).toMatch(/^[A-Z0-9]+$/)
    expect(items[27]).toBe(true)
    expect(items[32]).toBeNull() // default rule: facility = billing provider, leave 32 blank
  })

  it('other coverage fills 9 / 9a / 9d only when 11d is YES', () => {
    const withSec = cms1500Data(withClient({ secondary: { payerId: st.payers[0].id, memberId: 'SEC-1' } }), claim)
    expect(withSec.items['11d']).toBe(true)
    expect([withSec.items[9], withSec.items['9a'], withSec.items['9d']]).toEqual([nameLFM(client.guardian), 'SEC1', plain(st.payers[0].name)])
    const none = cms1500Data(withClient({ secondary: null }), claim)
    expect([none.items['11d'], none.items[9], none.items['9a'], none.items['9d']]).toEqual([false, '', '', ''])
  })

  it('a replacement claim carries frequency code 7 and the original reference (item 22)', () => {
    expect(cms1500Data(st, { ...claim, version: 1 }).items[22]).toBeNull()
    expect(cms1500Data(st, { ...claim, version: 2, parentNo: 'CLM-202608-014' }).items[22]).toEqual({ code: '7', ref: 'CLM202608014' })
  })

  it('item 1 program and items 11 / 11c come from the payer master', () => {
    const payer = st.payers.find((p) => p.name === claim.payer)
    const s2 = { ...st, payers: st.payers.map((p) => (p === payer ? { ...p, cmsType: 'Medicaid', ext: { ...payer.ext, group: 'G-77', plan: 'Plan 9' } } : p)) }
    const m = cms1500Data(s2, claim)
    expect(m.items[1]).toBe('MEDICAID')
    expect(m.items[11]).toBe('G77')
    expect(m.items['11c']).toBe('PLAN 9')
  })

  it("item 29 is what the patient or other payers paid, never this payer's own payment", () => {
    expect(cms1500Data(st, { ...claim, paid: 500, patientPaid: 0 }).items[29]).toBeNull()
    expect(cms1500Data(st, { ...claim, patientPaid: 25 }).items[29]).toBe(25)
  })

  it('place of service derives from the appointment location', () => {
    expect(posFor({ location: "Jimmy Ma's home" })).toBe('12')
    expect(posFor({ location: 'Jefferson Elementary School' })).toBe('03')
    expect(posFor({ location: 'Telehealth (video)' })).toBe('10')
  })

  it('refuses mileage codes that are missing, unconfigured, or stale for the payer', () => {
    const source = st.appts[claim.lines[0].apptId]
    const mileage = { ...source, id: 'cms-mileage-test', type: 'drive', billing: { units: 0, rate: 0, mileage: true, distance: 4.5, mileageRate: 0.7 } }
    const stateNoCode = { ...st, appts: { ...st.appts, [mileage.id]: mileage } }
    const line = lineFor(mileage, stateNoCode, { payer: claim.payer, mode: 'insurance' })
    const mileageClaim = { ...claim, mode: 'insurance', lines: [line], charges: line.charge }
    expect(line.code).toBe('')
    expect(() => cms1500Data(stateNoCode, mileageClaim)).toThrow(/No payer-specific mileage code/)
    const unconfiguredLine = { ...line, code: 'X1234' }
    expect(() => cms1500Data(stateNoCode, { ...mileageClaim, lines: [unconfiguredLine] })).toThrow(/No payer-specific mileage code is configured/)

    const stateWithCode = {
      ...stateNoCode,
      payers: stateNoCode.payers.map((p) => p.name === claim.payer
        ? { ...p, rules: { ...p.rules, claims: { ...(p.rules?.claims || {}), mileageCode: 'X1234' } } }
        : p),
    }
    const codedLine = lineFor(mileage, stateWithCode, { payer: claim.payer, mode: 'insurance' })
    const codedClaim = { ...mileageClaim, lines: [codedLine], charges: codedLine.charge }
    expect(cms1500Data(stateWithCode, codedClaim).pages[0][0].cpt).toBe('X1234')
    const staleClaim = { ...codedClaim, lines: [{ ...codedLine, code: 'Y1234' }] }
    expect(() => cms1500Data(stateWithCode, staleClaim)).toThrow(/current mileage code is X1234/)
  })
})

describe('layout1500: the 10-cpi by 6-lpi print grid', () => {
  const d = cms1500Data(st, claim)
  const f = layout1500(d, 0)

  it('places fields on their CMS lines and columns', () => {
    expect(at(f, 10, 50)).toBe(d.items['1a'])
    expect(at(f, 12, 1)).toBe(d.items[2])
    expect(at(f, 12, 31)).toBe(d.items[3].dob.mm)
    expect(at(f, 12, 37)).toBe(d.items[3].dob.yyyy)
    expect(at(f, 39, 42)).toBe('0')
    expect(at(f, 40, 3)).toBe('F840')
    expect(at(f, 46, 25)).toBe(d.pages[0][0].cpt)
    expect(at(f, 58, 23)).toBe(d.items[26])
    expect(at(f, 63, 51)).toBe(d.items['33a'])
    expect(at(f, 14, 42)).toBe('X') // item 6: Child
    expect(at(f, 58, 19)).toBe('X') // item 25: EIN
  })

  it('right-justifies dollars so the cents sit after the dotted line (24F)', () => {
    const m = moneyParts(d.pages[0][0].charge)
    expect(at(f, 46, 55 - m.dollars.length + 1)).toBe(m.dollars)
    expect(at(f, 46, 56)).toBe(m.cents)
  })

  it('keeps every field inside the 79-column form body', () => {
    for (const x of f) expect(x.col + x.text.length - 1).toBeLessThanOrEqual(79)
  })

  it('prints the claim total on the last page only, with page numbers on line 8', () => {
    const big = anyClaim((c) => c.lines.length > LINES_PER_PAGE)
    if (!big) return
    const db = cms1500Data(st, big)
    const first = layout1500(db, 0)
    const last = layout1500(db, db.pages.length - 1)
    const t = moneyParts(big.charges)
    expect(at(first, 58, 57 - t.dollars.length + 1)).toBeUndefined()
    expect(at(last, 58, 57 - t.dollars.length + 1)).toBe(t.dollars)
    expect(at(first, 8, 32)).toBe(`PAGE 1 OF ${db.pages.length}`)
  })

  it('grid maths: column 1 starts 0.35in from the edge, 10 characters and 6 lines per inch', () => {
    expect(colX(1)).toBeCloseTo(25.2)
    expect(colX(11) - colX(1)).toBeCloseTo(72)
    expect(lineY(7) - lineY(1)).toBeCloseTo(72)
  })
})

describe('cms1500 pdf', () => {
  const head = (doc) => new TextDecoder('latin1').decode(new Uint8Array(doc.output('arraybuffer')).slice(0, 5))
  it('renders the review copy and the data-only red-form print as real PDFs', () => {
    const copy = claimTo1500(st, claim)
    const data = claimTo1500(st, claim, { mode: 'data' })
    expect(head(copy)).toBe('%PDF-')
    expect(head(data)).toBe('%PDF-')
    // the data-only print carries no form artwork, so it is much smaller than the copy
    expect(data.output('arraybuffer').byteLength).toBeLessThan(copy.output('arraybuffer').byteLength)
  })

  it('batch packs every claim page into one PDF', () => {
    const claims = Object.values(st.claims).slice(0, 6)
    const doc = claimsTo1500(st, claims)
    const pages = claims.reduce((n, c) => n + cms1500Data(st, c).pages.length, 0)
    expect(doc.getNumberOfPages()).toBe(pages)
  })
})

describe('cms1500Data: chart values only', () => {
  it('refuses to print a claim whose chart lacks a member ID or diagnosis, naming what to fill in and where', () => {
    const gaps = withClient({ memberId: '', dxCodes: [] })
    expect(() => cms1500Data(gaps, claim)).toThrow(/Needs member ID: .*Member ID \(claims\).*Needs diagnosis: .*Diagnosis codes \(ICD-10\)/)
    expect(() => claimsTo1500(gaps, [claim])).toThrow(new RegExp(`^${claim.no} cannot print on a CMS-1500 yet`))
  })

  it('prints the charted member ID, diagnosis and auth number; leaves item 23 blank when no auth number is on file', () => {
    const d = cms1500Data(withClient({ memberId: 'AE-7710223', dxCodes: ['F84.0', 'F90.1'], authNo: 'PA-26-4100' }), claim)
    expect(d.items['1a']).toBe('AE7710223')
    expect(d.items[21].codes).toEqual(['F840', 'F901'])
    expect(d.items[23]).toBe('PA264100')
    expect(cms1500Data(withClient({ authNo: '' }), claim).items[23]).toBe('')
  })

  it('refuses a missing auth number when strict authorization is on', () => {
    const strict = { ...withClient({ authNo: '' }), settings: { ...st.settings, billing: { ...st.settings.billing, strictAuth: true } } }
    expect(() => cms1500Data(strict, claim)).toThrow(/Needs authorization number/)
  })

  it('item 26 is the practice-assigned patient account number (the client id)', () => {
    expect(cms1500Data(st, claim).items[26]).toBe(compact(client.id).slice(0, 14))
  })
})
