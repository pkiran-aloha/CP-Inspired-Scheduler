import { describe, it, expect } from 'vitest'
import { buildPatientShareDraft, patientShareRows, buildQboCsv, buildVerificationForm, buildAppealLetter, build835ErrorReport } from '../lib/billingDocs.js'
import { blankState } from '../state/store.jsx'

// The demo ledger is seeded around "today" (12 weeks back, 4 forward), so the fixture
// claims below live in a pinned month no seed can ever reach. These tests used a hardcoded
// 2026-10 window described as "a clean future month" — that stopped being true the moment
// the run date entered October 2026: seeded claims fell inside the window and every count
// below drifted with the calendar (11 claims instead of 2 on 2026-10-12).
const DOS = '2021-06-15'
const WIN = { from: '2021-06-01', to: '2021-06-30' }

describe('billingDocs builders — each is what its screen downloads', () => {
  it('buildPatientShareDraft: only reported patient share, per selected client, with the screen file name', () => {
    const state = blankState()
    const base = Object.values(state.claims)[0]
    const [a, b] = state.clients
    const claim = (id, clientId, patch) => ({ ...base, id, no: id.toUpperCase(), clientId, payer: 'Aetna', mode: 'insurance', status: 'partially_paid',
      charges: 100, paid: 40, adj: 0, patientPaid: 0, secondary: null, dosFrom: DOS, dosTo: DOS, lines: [{ ...base.lines[0], charge: 100, dos: DOS }], history: [], ...patch })
    const testState = { ...state, payments: {}, claims: {
      'clm-pr': claim('clm-pr', a.id, { remittance: { checkNo: 'P-1', patientResp: 25 } }),
      'clm-ins': claim('clm-ins', a.id, { remittance: null }), // insurer-only balance: not a patient charge
      'clm-other': claim('clm-other', b.id, { remittance: { checkNo: 'P-2', patientResp: 10 } }),
    } }
    const all = buildPatientShareDraft(testState, { clientIds: [a.id], from: '2021-06-01', to: '2021-06-30', today: '2021-07-01' })
    expect(all.fileName).toBe('Patient-share-draft-2021-07-01.txt')
    expect(all.rows).toHaveLength(1)
    expect(all.rows[0].claims.map((c) => c.id).sort()).toEqual(['clm-ins', 'clm-pr'])
    expect(all.total).toBe(200)
    expect(all.due).toBe(25)
    expect(all.content).toContain('Range 2021-06-01 → 2021-06-30 — All primary claims')
    expect(all.content).toContain(`Client: ${a.name} — 2 primary claims — Charges $200 — Reported patient share $25`)
    expect(all.content).toMatch(/CLM-PR \| 2021-06-15 \| Aetna \| \$100 \| Patient receipts \$0 \| Practice A\/R \$60 \| Remaining reported patient share \$25 \| partially_paid/)
    expect(all.content).not.toContain('CLM-OTHER')
    expect(all.content.split('\n').at(-1)).toBe('Total charges $200 — Reported patient share $25 (verify before sending)')

    const balanceOnly = buildPatientShareDraft(testState, { clientIds: [a.id, b.id], balanceOnly: true })
    expect(balanceOnly.rows.map((r) => r.claims.map((c) => c.id))).toEqual([['clm-pr'], ['clm-other']])
    expect(balanceOnly.due).toBe(35)
    expect(balanceOnly.content).toContain('Reported patient balances only')
    expect(patientShareRows(testState, [a.id], { balanceOnly: true })).toEqual(balanceOnly.rows.slice(0, 1))
    expect(buildPatientShareDraft(testState, { clientIds: [] }).due).toBe(0)
  })

  it('buildQboCsv: header matches Intuit contract, guards ≤1000 rows / ≤100 invoices', () => {
    const state = blankState()
    // create 120 claims each with 10 lines = 1200 rows → should split into 2 files
    const claims = {}
    const base = Object.values(state.claims)[0]
    for(let i=0;i<120;i++){
      const id=`clm-qbo-${i}`
      claims[id]={
        ...base,
        id, no:`CLM-QBO-${i}`, clientId: state.clients[i % state.clients.length].id,
        payer:'Aetna', status:'submitted', charges:100, paid:0, adj:0,
        dosFrom:DOS, dosTo:DOS,
        lines: Array.from({length:10}, (_,j)=>({ ...base.lines[0], code:`9715${3+j%5}`, units:1, rate:10, charge:10, dos:DOS, t0:540, t1:600 })),
        history:[]
      }
    }
    const testState = { ...state, claims: { ...state.claims, ...claims } }
    const files = buildQboCsv(testState, { ...WIN, invoiceNumberStart: 4127 })
    expect(files.length).toBeGreaterThanOrEqual(2)
    expect(files[0].content.split('\n')[0]).toBe('Invoice Number,Customer,Invoice Date,Due Date,Product/Service,Qty,Unit Price,Amount,Memo,Tax Code')
    // no negatives
    expect(files[0].content).not.toMatch(/,-/)
    // row count ≤1000 per file
    for(const f of files){
      const rows = f.content.split('\n').length -1
      expect(rows).toBeLessThanOrEqual(1000)
    }
  })

  it('buildVerificationForm: the Verification Forms record as a text file', () => {
    const doc = buildVerificationForm({ clientName: 'Sample Client', payer: 'Aetna', status: 'verified', date: '2021-06-15' })
    expect(doc.fileName).toBe('Verification-Sample Client.txt')
    expect(doc.content).toBe('Verification Form\nClient Sample Client\nPayer Aetna\nStatus verified\nDate 2021-06-15\nNotes ')
    expect(buildVerificationForm({ clientName: 'X', notes: 'Called payer' }).content).toMatch(/Notes Called payer$/)
  })

  it('buildAppealLetter: denial reason, narrative and the practice address; no invented CARC', () => {
    const state = blankState()
    const base = Object.values(state.claims)[0]
    const denied = { ...base, id: 'clm-den', no: 'CLM-DEN', status: 'denied', denial: { code: 'timely', reason: 'Timely filing limit exceeded' } }
    const testState = { ...state, claims: { ...state.claims, 'clm-den': denied } }
    const letter = buildAppealLetter(testState, { claimId: 'clm-den', narrative: 'Test appeal' })
    expect(letter.fileName).toBe('Appeal-CLM-DEN.txt')
    expect(letter.content).toContain('Test appeal')
    expect(letter.content).toContain('Denial reason: Timely filing limit exceeded')
    expect(letter.content).not.toContain('CARC')
    expect(letter.content).toContain(state.settings.org.address)
    expect(buildAppealLetter(testState, { claimId: 'missing' }).content).toBe('Claim not found')
  })

  it('build835ErrorReport', () => {
    const state = blankState()
    const eraId = Object.keys(state.eraImports||{})[0]
    if (eraId) {
      const report = build835ErrorReport(state, { eraId })
      expect(report.fileName).toContain('835-Error-')
    }
  })
})
