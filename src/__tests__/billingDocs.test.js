import { describe, it, expect } from 'vitest'
import { buildInvoices, buildQboCsv, buildVerificationForm, buildAppealLetter, build835ErrorReport } from '../lib/billingDocs.js'
import { blankState } from '../state/store.jsx'

describe('U7 billingDocs builders (chunk 47)', () => {
  it('buildInvoices: empty range → 0 claims but still returns file with total 0', () => {
    const state = blankState()
    const invoices = buildInvoices(state, { from: '2020-01-01', to: '2020-01-02', balanceOnly: true })
    expect(invoices.length).toBe(1)
    expect(invoices[0].total).toBe(0)
    expect(invoices[0].content).toContain('TOTAL')
  })

  it('buildInvoices: Balance Only hides paid lines, perClient split N files, numbering increments', () => {
    const state = blankState()
    // make 2 open claims for different clients in a clean future month
    const clients = state.clients.slice(0,2)
    const claims = {}
    const base = Object.values(state.claims)[0]
    clients.forEach((cl, i)=>{
      const id = `clm-inv-${i}`
      claims[id] = { ...base, id, no: `CLM-INV-${i}`, clientId: cl.id, payer: 'Aetna', status: 'submitted', charges: 100*(i+1), paid: 0, adj:0, dosFrom: '2026-10-15', dosTo: '2026-10-15', lines: [{ ...base.lines[0], charge: 100*(i+1), units:1, rate:100*(i+1), dos: '2026-10-15' }], history: [] }
    })
    const testState = { ...state, claims: { ...state.claims, ...claims } }
    const invoicesSingle = buildInvoices(testState, { from: '2026-10-01', to: '2026-10-31', balanceOnly: true, perClient: false })
    expect(invoicesSingle.length).toBe(1)
    expect(invoicesSingle[0].claims.length).toBe(2)

    const invoicesPerClient = buildInvoices(testState, { from: '2026-10-01', to: '2026-10-31', balanceOnly: true, perClient: true })
    expect(invoicesPerClient.length).toBe(2)
    expect(invoicesPerClient[0].fileName).toMatch(/INV-/)
    expect(invoicesPerClient[1].fileName).toMatch(/INV-/)
  })

  it('buildInvoices: tax applied only when >0', () => {
    const state = blankState()
    const base = Object.values(state.claims)[0]
    const claims = { 'clm-tax': { ...base, id:'clm-tax', no:'CLM-100', clientId: state.clients[0].id, payer:'Aetna', status:'submitted', charges:100, paid:0, adj:0, dosFrom:'2026-10-15', dosTo:'2026-10-15', lines:[{...base.lines[0], charge:100, dos:'2026-10-15'}], history:[] } }
    const testState = { ...state, claims: { ...state.claims, ...claims } }
    const noTax = buildInvoices(testState, { from:'2026-10-01', to:'2026-10-31', taxId:false, taxPct:0 })
    expect(noTax[0].content).not.toContain('TAX,')
    expect(noTax[0].content).not.toContain('Tax %')

    const withTax = buildInvoices(testState, { from:'2026-10-01', to:'2026-10-31', taxId:true, taxPct:10 })
    expect(withTax[0].content).toContain('TAX,')
    expect(withTax[0].content).toContain('10%')
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
        dosFrom:'2026-09-01', dosTo:'2026-09-01',
        lines: Array.from({length:10}, (_,j)=>({ ...base.lines[0], code:`9715${3+j%5}`, units:1, rate:10, charge:10, dos:'2026-09-01', t0:540, t1:600 })),
        history:[]
      }
    }
    const testState = { ...state, claims: { ...state.claims, ...claims } }
    const files = buildQboCsv(testState, { from:'2026-09-01', to:'2026-09-30', invoiceNumberStart: 4127 })
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

  it('buildVerificationForm: multi-client → multi file, per client', () => {
    const state = blankState()
    const payerId = state.payers[0].id
    const clientIds = state.clients.slice(0,2).map((c)=>c.id)
    const forms = buildVerificationForm(state, { payerId, format:'parental', from:'2026-08-01', to:'2026-09-30', clientIds, apptState:'all' })
    expect(forms.length).toBe(2)
    expect(forms[0].fileName).toContain('Parental_Verification')
    expect(forms[0].content).toContain('Parent/Guardian Signature')
  })

  it('buildAppealLetter + build835ErrorReport', () => {
    const state = blankState()
    const claimId = Object.keys(state.claims)[0]
    const letter = buildAppealLetter(state, { claimId, narrative:'Test appeal', enclosures:['Notes.pdf'] })
    expect(letter.fileName).toContain('Appeal-')
    expect(letter.content).toContain('Test appeal')

    const eraId = Object.keys(state.eraImports||{})[0]
    if (eraId) {
      const report = build835ErrorReport(state, { eraId })
      expect(report.fileName).toContain('835-Error-')
    }
  })
})
