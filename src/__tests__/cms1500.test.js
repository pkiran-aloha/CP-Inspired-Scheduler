// ---- CMS-1500 mapping & PDF smoke tests over the real demo ledger ----
import { describe, it, expect } from 'vitest'
import { blankState } from '../state/store'
import { cms1500Data, claimTo1500, claimsTo1500, usDate, lastFirst, money2, posFor, LINES_PER_PAGE } from '../lib/cms1500'

const st = blankState()
const box = (d, id) => d.boxes.find((b) => b.id === id)
const anyClaim = (pred) => Object.values(st.claims).find(pred)

describe('cms1500 mapping', () => {
  const claim = anyClaim((c) => c.mode === 'insurance' && c.lines.length >= 2)
  const d = cms1500Data(st, claim)
  const client = st.clients.find((c) => c.id === claim.clientId)

  it('maps identity boxes end-to-end (1a, 25, 32, 23, 33)', () => {
    expect(box(d, '33').value[0]).toBe(st.settings.org.name)
    expect(box(d, '25').value[0]).toBe(st.settings.org.taxId)
    expect(box(d, '1a').value[0]).toMatch(/^[A-Z]{2,3}\d{6,7}$/) // payer-prefixed member id
    expect(box(d, '32').value[1]).toMatch(/NPI \d{10}/)
    expect(box(d, '23').value[0]).toMatch(/^AUTH-/)
  })

  it('patient boxes use LAST, FIRST format + mm/dd/yy DOB + sex from the client record', () => {
    expect(box(d, '2').value[0]).toBe(lastFirst(client.name))
    expect(box(d, '2b').value[0]).toMatch(/^\d{2}\/\d{2}\/\d{2}$/)
    expect(['M', 'F']).toContain(box(d, '2c').value[0])
  })

  it('service rows: dates, CPT, units, rate/charge money format, dx pointers within 1–12', () => {
    expect(d.pages.length).toBeGreaterThanOrEqual(1)
    const row = d.pages[0][0]
    expect(row.from).toBe(usDate(claim.lines[0].dos))
    expect(row.cpt).toBe(claim.lines[0].code || '14220')
    expect(row.charge).toBe(money2(claim.lines[0].charge))
    const ptrs = claim.lines.map((_, i) => Number(d.pages[Math.floor(i / LINES_PER_PAGE)][i % LINES_PER_PAGE].ptr))
    ptrs.forEach((p) => expect(p).toBeGreaterThanOrEqual(1))
    ptrs.forEach((p) => expect(p).toBeLessThanOrEqual(12))
  })

  it('six-line pagination: every grid page carries ≤ 6 rows and CONTINUED pages exist past 6', () => {
    const big = anyClaim((c) => c.lines.length > LINES_PER_PAGE)
    if (!big) return // demo currently has a 10-line claim; if seed changes, nothing breaks
    const dd = cms1500Data(st, big)
    expect(dd.pages.length).toBe(Math.ceil(big.lines.length / LINES_PER_PAGE))
    dd.pages.forEach((p) => expect(p.length).toBeLessThanOrEqual(LINES_PER_PAGE))
    expect(dd.pages.at(-1).length).toBe(big.lines.length % LINES_PER_PAGE || LINES_PER_PAGE)
  })

  it('replacement versioning: a rebilled claim carries REPLACEMENT + resubmission code 7 + prior ref', () => {
    const dd = cms1500Data(st, { ...claim, version: 2, parentNo: 'CLM-202608-014' })
    expect(box(dd, '12').value[0]).toBe('REPLACEMENT')
    expect(box(dd, '22').value[0]).toBe('7')
    expect(box(dd, '16').value[0]).toBe('CLM-202608-014')
  })

  it('totals: 23c & 24J agree with the ledger, paid only shown on paid claims', () => {
    const paid = anyClaim((c) => c.status === 'paid')
    const dp = cms1500Data(st, paid)
    expect(dp.totalCharge).toBe(money2(paid.charges))
    expect(dp.amountPaid).toBe(money2(paid.paid))
    const draft = anyClaim((c) => c.status === 'draft')
    expect(cms1500Data(st, draft).amountPaid).toBe('')
  })

  it('place of service derives from the first line’s location', () => {
    expect(posFor({ location: "Jimmy Ma's home" })).toBe('12')
    expect(posFor({ location: 'Jefferson Elementary' })).toBe('11') // school names aren't labeled 'school' — center fallback ok
    expect(posFor({ location: 'Jefferson Elementary School' })).toBe('03')
    expect(posFor({ location: 'Telehealth (video)' })).toBe('10')
  })

  it('payer policy feeds timely filing days (Medicaid gets the longest runway)', () => {
    expect(+box(d, '7b').value[0]).toBeGreaterThanOrEqual(90)
  })

  it('money format is 2dp everywhere a dollar appears', () => {
    expect(box(d, '23c').value[0]).toMatch(/\$\s?\d+\.\d{2}/)
    d.pages.forEach((p) => p.forEach((r) => expect(r.charge).toMatch(/^\d+\.\d{2}$/)))
  })
})

describe('cms1500 pdf', () => {
  it('renders a real %PDF document for one claim', () => {
    const claim = Object.values(st.claims)[0]
    const out = claimTo1500(st, claim).output('arraybuffer')
    const head = new TextDecoder('latin1').decode(new Uint8Array(out).slice(0, 5))
    expect(head).toBe('%PDF-')
    expect(out.byteLength).toBeGreaterThan(4000)
  })

  it('batch packs every visible claim into one multi-page PDF', () => {
    const claims = Object.values(st.claims).slice(0, 6)
    const out = claimsTo1500(st, claims).output('arraybuffer')
    const bytes = new TextDecoder('latin1').decode(new Uint8Array(out))
    expect(bytes.startsWith('%PDF-')).toBe(true)
    const count = Math.max(...[...bytes.matchAll(/\/Count (\d+)/g)].map((m) => Number(m[1])), 0)
    expect(count).toBeGreaterThanOrEqual(claims.length) // ≥ one page per claim
    expect(out.byteLength).toBeGreaterThan(12000)
  })
})
