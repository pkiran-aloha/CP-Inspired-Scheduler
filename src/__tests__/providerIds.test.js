import { describe, it, expect } from 'vitest'
import { blankState } from '../state/store'
import { providerIdRule, providerIdIssues, PROVIDER_ID_RULES } from '../lib/providerIds'
import { claimGate } from '../lib/claims'
import { cms1500Data } from '../lib/cms1500'
import { evaluateAppointmentValidations } from '../lib/settingsMasters'

/** The workspace with one insurer claim, its payer set to `rule`, and every provider's Medicaid ID set to `mcd`. */
function world(rule, mcd = '') {
  const s = blankState()
  const claim = Object.values(s.claims).find((c) => c.mode !== 'selfpay')
  const payers = s.payers.map((p) => (p.name === claim.payer && rule ? { ...p, rules: { ...(p.rules || {}), providerId: rule } } : p))
  const providers = s.settings.providers.map((x) => ({ ...x, payerIds: { ...(x.payerIds || {}), medicaid: mcd } }))
  return { s: { ...s, payers, settings: { ...s.settings, providers } }, claim }
}
const box = (d, id) => d.boxes.find((b) => b.id === id).value

describe('payer provider-ID rule: NPI, Medicaid ID or both', () => {
  it('defaults to NPI and says when a payer chose its own rule', () => {
    expect(providerIdRule(null)).toMatchObject({ id: 'npi', explicit: false })
    expect(providerIdRule({ rules: { providerId: 'both' } })).toMatchObject({ id: 'both', explicit: true })
    expect(providerIdRule({ rules: { providerId: 'nonsense' } }).id).toBe('npi')
    expect(PROVIDER_ID_RULES.map((r) => r.id)).toEqual(['npi', 'medicaid', 'both'])
  })

  it('names exactly what a staff member is missing under the rule', () => {
    const { s, claim } = world('both')
    const payer = s.payers.find((p) => p.name === claim.payer)
    const issues = providerIdIssues(s, payer, s.staff[0].id)
    expect(issues).toHaveLength(1) // the seeded NPI is valid; the Medicaid ID is blank
    expect(issues[0]).toMatch(/no Medicaid ID on file .*NPI and Medicaid ID/)
    expect(providerIdIssues(s, payer, 'nobody')[0]).toMatch(/no provider record/)
  })

  it('blocks a claim only once the payer has chosen a rule, and clears when the IDs are on file', () => {
    const base = world(null)
    const before = claimGate(base.s, base.claim).bad.length
    expect(claimGate(world('npi').s, base.claim).bad.length).toBe(before) // valid seeded NPIs: nothing new
    const strict = world('medicaid')
    expect(claimGate(strict.s, strict.claim).bad.some((b) => /no Medicaid ID on file/.test(b.why))).toBe(true)
    const filled = world('medicaid', 'MCD-123')
    expect(claimGate(filled.s, filled.claim).bad.some((b) => /Medicaid ID/.test(b.why))).toBe(false)
  })

  it('prints the identifiers the rule asks for on the CMS-1500', () => {
    const npi = world('npi', 'MCD-9')
    const d1 = cms1500Data(npi.s, npi.claim)
    expect(box(d1, '33a').some((v) => /^NPI \d{10}$/.test(v))).toBe(true)
    expect(box(d1, '33b')).toEqual(['—'])
    const mcd = world('medicaid', 'MCD-9')
    const d2 = cms1500Data(mcd.s, mcd.claim)
    expect(box(d2, '23b')).toEqual(['1D MCD-9'])
    expect(box(d2, '33a').some((v) => /^NPI/.test(v))).toBe(false)
    expect(d2.renderNpi).toBe('')
    const both = world('both', 'MCD-9')
    const d3 = cms1500Data(both.s, both.claim)
    expect(box(d3, '33a').some((v) => /^NPI/.test(v)) && box(d3, '33a').includes('1D MCD-9')).toBe(true)
    expect(box(d3, '33b')).toEqual(['1D MCD-9'])
  })

  it('stops the false "Missing NPI" flag for staff whose provider record has an NPI', () => {
    const s = blankState()
    const draft = { id: 'x', type: 'service', date: '2026-10-05', start: 540, end: 600, staffIds: [s.staff[0].id], clientIds: [s.clients[0].id], status: 'active' }
    expect(evaluateAppointmentValidations(s, draft).items.some((i) => i.id === 'staff.missingNpi')).toBe(false)
    // …but a payer asking for a Medicaid ID raises it with the reason
    const payers = s.payers.map((p) => (p.name === s.clients[0].insurer ? { ...p, rules: { ...(p.rules || {}), providerId: 'medicaid' } } : p))
    const flagged = evaluateAppointmentValidations({ ...s, payers }, draft).items.find((i) => i.id === 'staff.missingNpi')
    expect(flagged?.message).toMatch(/no Medicaid ID on file/)
  })
})
