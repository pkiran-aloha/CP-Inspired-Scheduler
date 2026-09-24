import { describe, it, expect } from 'vitest'
import React from 'react'
import { render, waitFor } from '@testing-library/react'
import App from '../App'
import { validNpi, credOf, credentialIssue, resolveProviders, paymentsFromClaims, payPatch, claimV2Defaults, npiOf, TAXONOMIES, PAYER_ID_TABS } from '../lib/claims'
import { normalizeBillingV2 } from '../lib/master'
import { blankState } from '../state/store'
import { BILL_CODES } from '../lib/model'

const saved = () => JSON.parse(localStorage.getItem('aloha-aba.v3'))

describe('billing v2 foundations (chunk 40)', () => {
  it('NPI check-digit validation (mod-10)', () => {
    expect(validNpi('1234567893')).toBe(true)
    expect(validNpi('1234567890')).toBe(false)
    expect(validNpi('1720418395')).toBe(true)
    expect(validNpi(npiOf('s1'))).toBe(true) // seeded staff NPIs carry a real check digit
    expect(validNpi('1720418390')).toBe(false)
    expect(validNpi('1234')).toBe(false)
    expect(validNpi('12a4567893')).toBe(false)
    expect(validNpi('')).toBe(false)
  })

  it('credential matrix: RBT may render 97153 but not 97151/97155; BCBA may render all', () => {
    expect(credentialIssue('97153', 'RBT')).toBeNull()
    expect(credentialIssue('97154', 'BCaBA')).toBeNull()
    expect(credentialIssue('97151', 'RBT')).toMatch(/requires a BCBA/)
    expect(credentialIssue('97155', 'RBT')).toMatch(/requires a BCBA/)
    expect(credentialIssue('97151', 'BCBA')).toBeNull()
    expect(credentialIssue('97155', 'BCBA')).toBeNull()
    expect(credOf('BCBA · Clinical Supervisor')).toBe('BCBA')
    expect(credOf('BCaBA · Center Lead')).toBe('BCaBA')
    expect(credOf('RBT · Home Programs')).toBe('RBT')
    expect(credOf('Psychologist · Assessments')).toBe('Psychologist')
  })

  it('BILL_CODES v2 carries the ABA set with credential + modifier metadata', () => {
    for (const id of ['97151', '97152', '97153', '97154', '97155', '97156', '97157', '97158']) {
      const c = BILL_CODES.find((x) => x.id === id)
      expect(c).toBeTruthy()
      expect(c.cred).toBeTruthy()
      expect(c.mod).toMatch(/^(HO|HN|HP|HM)$/)
    }
    expect(BILL_CODES.find((c) => c.id === '0362T').eol).toBe('2027-01-01')
    expect(TAXONOMIES.map((t) => t.code)).toEqual(expect.arrayContaining(['101YP00000X', '363AP0207X']))
    expect(PAYER_ID_TABS.map((t) => t.id)).toEqual(['general', 'ticare', 'medicaid', 'bhpn', 'referrers'])
  })

  it('migrates hostile v3 state once: remittances → payments, claim v2 fields, provider master, payer.ext', () => {
    const base = blankState()
    // carve a hostile v3 snapshot: drop the v2 collections/providers/meta, keep inline remittances
    const v3 = {
      ...base,
      claims: base.claims,
      settings: { ...base.settings },
      meta: { pcfCleared: true },
    }
    delete v3.payments; delete v3.invoices; delete v3.verificationForms; delete v3.eraImports; delete v3.billedFiles
    delete v3.settings.providers
    v3.payers = v3.payers.map((p) => { const q = { ...p }; delete q.ext; return q }) // clone — never mutate the shared seed
    const paidClaims = Object.values(base.claims).filter((c) => c.remittance)
    expect(paidClaims.length).toBeGreaterThan(3)

    const out = normalizeBillingV2(v3)
    expect(out.meta.billingV2).toBe(true)
    expect(out.meta.billingV2Count).toBe(paidClaims.length)
    // 1) one payment record per legacy remittance, amounts preserved
    expect(Object.keys(out.payments).length).toBe(paidClaims.length)
    for (const c of paidClaims) {
      const pay = out.payments[`pay-${c.id}`]
      expect(pay).toBeTruthy()
      expect(pay.amount).toBe(c.remittance.amount)
      expect(pay.adj).toBe(c.remittance.adj)
      expect(pay.kind).toBe('check')
      expect(pay.ref).toBe(c.remittance.checkNo)
    }
    // 2) claim v2 backfill
    for (const c of Object.values(out.claims)) {
      expect(['ch', 'selfpay', null]).toContain(c.method)
      expect(c.timelyDue).toBeTruthy()
      expect(c.secondary).toBeNull()
      expect(c.reject).toBeNull()
      expect(c.lines.every((l) => l.provider !== undefined)).toBe(true)
    }
    const submittedIns = Object.values(out.claims).find((c) => c.status === 'submitted' && c.mode === 'insurance')
    expect(submittedIns.method).toBe('ch')
    // 3) provider master seeded: office row + one row per staff, office NPI = org NPI
    const prov = out.settings.providers
    expect(prov.length).toBe(1 + v3.staff.length)
    const office = prov.find((p) => p.kind === 'office')
    expect(office.npi).toBe(out.settings.org.npi)
    expect(office.roles).toEqual({ rendering: false, billing: true, facility: true })
    const rbts = prov.filter((p) => p.credential === 'RBT')
    expect(rbts.length).toBeGreaterThan(0)
    expect(rbts.every((p) => p.taxonomy === '363AP0207X')).toBe(true)
    // 4) payer.ext defaulted
    expect(out.payers.every((p) => p.ext && typeof p.ext === 'object')).toBe(true)
    // idempotent
    const again = normalizeBillingV2(out)
    expect(again).toBe(out)
    expect(Object.keys(normalizeBillingV2({ ...out }).payments).length).toBe(paidClaims.length)
  })

  it('resolveProviders: rendering from line staff, billing/facility via roles + defaults, null when NPI missing', () => {
    const s = blankState()
    const claim = {
      id: 'clm-x', no: 'CLM-X', lines: [
        { apptId: 'a1', dos: '2026-09-01', code: '97153' },
        { apptId: 'a2', dos: '2026-09-01', code: '97151' },
      ],
    }
    const staff1 = s.settings.providers.find((p) => p.kind === 'staff' && p.roles?.billing)
    const staff2 = s.settings.providers.find((p) => p.kind === 'staff' && p !== staff1)
    const office = s.settings.providers.find((p) => p.kind === 'office')
    const state = {
      appts: { a1: { staffIds: [staff1.refId] }, a2: { staffIds: [staff2.refId] } },
      staff: s.staff,
      settings: { ...s.settings, billing: { defaultBilling: office.id, defaultFacility: '' } },
    }
    const res = resolveProviders(state, claim)
    expect(res).toHaveLength(2)
    expect(res[0].renderId).toBe(staff1.id)
    expect(res[0].billId).toBe(staff1.id) // line staff carries the billing role
    expect(res[1].renderId).toBe(staff2.id)
    expect(res[1].billId).toBe(office.id) // no billing role on staff2 → office fallback
    expect(res[0].facId).toBe(office.id)
    // staff row without an NPI resolves to null rendering (gate holds the claim)
    const noNpi = { ...staff2, id: 'pr-nonpi', npi: '' }
    const state2 = { ...state, appts: { a1: { staffIds: [noNpi.refId] }, a2: { staffIds: [noNpi.refId] } }, settings: { ...state.settings, providers: [...s.settings.providers.filter((p) => p.id !== staff2.id), noNpi] } }
    const res2 = resolveProviders(state2, claim)
    expect(res2[0].renderId).toBeNull()
    expect(res2[0].billId).toBe(office.id)
  })

  it('paymentsFromClaims + payPatch v2: partial payments keep the claim open (partially_paid)', () => {
    const c = {
      id: 'clm-1', no: 'CLM-1', clientId: 'c1', payer: 'Aetna', mode: 'insurance',
      charges: 300, adj: 0, paid: 0, status: 'submitted', submittedAt: Date.now() - 5 * 86400000,
      lines: [], remittance: { checkNo: 'CHK-1', amount: 240, adj: 60, at: Date.now(), note: '' }, history: [],
    }
    const pays = paymentsFromClaims([c])
    expect(pays['pay-clm-1'].amount).toBe(240)
    expect(pays['pay-clm-1'].kind).toBe('check')
    // partial: $200 of $300
    const t1 = payPatch({ ...c, paid: 0 }, { amount: 200, checkNo: 'CHK-9', adj: 0, note: 'partial' })
    expect(t1.claim.status).toBe('partially_paid')
    expect(t1.claim.paid).toBe(200)
    expect(t1.claim.closedAt).toBeUndefined()
    // remainder closes it
    const t2 = payPatch(t1.claim, { amount: 100, checkNo: 'CHK-10', adj: 0, note: '' })
    expect(t2.claim.status).toBe('paid')
    expect(t2.claim.paid).toBe(300)
    expect(t2.claim.closedAt).toBeTruthy()
    // v2 defaults are deterministic
    const d1 = claimV2Defaults({ ...c }, blankState())
    const d2 = claimV2Defaults({ ...c }, blankState())
    expect(d1.timelyDue).toBe(d2.timelyDue)
    expect(d1.method).toBe('ch')
  })

  it('fresh state: ledger is consistent — every remittance has a payment record, providers seeded, meta flagged', async () => {
    render(<App />)
    await waitFor(() => expect(saved()).toBeTruthy())
    const st = saved()
    expect(st.meta.billingV2).toBe(true)
    const withRem = Object.values(st.claims).filter((c) => c.remittance)
    for (const c of withRem) {
      const pay = st.payments[`pay-${c.id}`]
      expect(pay).toBeTruthy()
      expect(pay.amount).toBe(c.remittance.amount)
    }
    expect(st.settings.providers.length).toBe(1 + st.staff.length)
    expect(st.payers.every((p) => p.ext)).toBe(true)
  })
})
