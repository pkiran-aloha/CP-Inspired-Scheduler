import { describe, expect, it } from 'vitest'
import { blankState, reducer, serializeForStorage, initial } from '../state/store'
import { arOf, claimsCsv, dueOf, patientLedgerMatches, patientResponsibilityOf, secondaryEligible } from '../lib/claims'
import { buildPatientShareDraft } from '../lib/billingDocs'
import { buildPatientReceiptAudit, planClaimPayment, planPatientReceipt, planUnappliedReceipt, planVoidClaimPayment } from '../lib/paymentLedger'
import { previewEra } from '../lib/eraPosting'
import { createWorkspaceBackup, readWorkspaceBackup } from '../lib/workspaceBackup'

const at = Date.parse('2026-09-27T12:00:00Z')
const primaryId = 'patient-primary'
function fixture({ mode = 'insurance', report = 30 } = {}) {
  const base = blankState()
  const primary = {
    id: primaryId, no: 'CLM-PATIENT', clientId: base.clients[0].id,
    payer: mode === 'selfpay' ? 'Self-pay' : base.clients[0].insurer,
    mode, status: mode === 'selfpay' ? 'submitted' : 'partially_paid', charges: 100, paid: mode === 'selfpay' ? 0 : 40,
    adj: 0, patientPaid: 0, secondary: null, createdAt: at - 86400000,
    submittedAt: at - 86400000, dosFrom: '2026-09-01', dosTo: '2026-09-01',
    lines: [{ apptId: 'a-patient', dos: '2026-09-01', charge: 100, units: 2, rate: 50, code: '97153', t0: 540, t1: 600 }],
    remittance: mode === 'selfpay' ? null : { checkNo: 'PAYER-1', patientResp: report }, history: [],
  }
  const payerPayment = { id: 'payer-1', claimId: primary.id, clientId: primary.clientId,
    payer: primary.payer, amount: 40, adj: 0, patientResp: report, kind: 'manual',
    method: 'eft', ref: 'PAYER-1', date: '2026-09-26', createdAt: at - 86400000 }
  return { ...base, claims: { [primaryId]: primary },
    payments: mode === 'selfpay' || report == null ? {} : { [payerPayment.id]: payerPayment },
    invoices: mode === 'selfpay' ? { 'inv-patient': { id: 'inv-patient', claimId: primaryId, amount: 100, due: 100, status: 'open' } } : {},
    eraImports: {}, history: [] }
}
const post = (state, id, amount, ref, extra = {}) => reducer(state, {
  type: 'patientReceiptTx', id, payload: { clientId: state.claims[id].clientId, amount, ref, method: 'card', date: '2026-09-27', ...extra },
  options: { at, paymentId: ref.toLowerCase() },
})
const reverse = (state, id, revId = 'reversal') => reducer(state, { type: 'claimVoidPaymentTx', id, options: { at: at + 1, reversalId: revId } })

describe('claim-linked local patient receipts', () => {
  it('reduces only documented PR and primary A/R, remains distinct from payer cash, and is undoable', () => {
    const start = fixture()
    expect(patientResponsibilityOf(start, start.claims[primaryId])).toBe(30)
    expect(arOf(start, '2026-09-27').totals).toMatchObject({ totalAR: 60, patientAR: 30, unassignedAR: 30 })
    const once = post(start, primaryId, '10.00', 'PAT-1')
    const claim = once.claims[primaryId]
    expect(once.history).toHaveLength(1)
    expect(claim).toMatchObject({ paid: 40, patientPaid: 10, adj: 0, status: 'partially_paid' })
    expect(once.payments['pat-1']).toMatchObject({ kind: 'patient', claimId: primaryId,
      patientSourceClaimId: primaryId, amount: 10, patientResp: null, ref: 'PAT-1', method: 'card' })
    expect(dueOf(claim)).toBe(50)
    expect(patientLedgerMatches(once, claim)).toBe(true)
    expect(patientResponsibilityOf(once, claim)).toBe(20)
    const ar = arOf(once, '2026-09-27')
    expect(ar.totals).toMatchObject({ totalAR: 50, patientAR: 20, unassignedAR: 30 })
    expect(ar.byPayer.reduce((s, row) => s + row.balance, 0)).toBe(50)
    expect(buildPatientShareDraft(once, { clientIds: [claim.clientId] }).due).toBe(20)
    expect(claimsCsv(once, [claim])).toMatch(/patient_received,balance,remaining_reported_patient_share/)
    expect(reducer(once, { type: 'undo' }).claims).toEqual(start.claims)
    expect(reducer(once, { type: 'undo' }).payments).toEqual(start.payments)

    const fullPR = post(once, primaryId, 20, 'PAT-2')
    expect(fullPR.claims[primaryId].patientPaid).toBe(30)
    expect(arOf(fullPR, '2026-09-27').totals).toMatchObject({ totalAR: 30, patientAR: 0, unassignedAR: 30 })
    expect(planPatientReceipt(fullPR, primaryId, { amount: 1, ref: 'PAT-3' }, { paymentId: 'x' }).ok).toBe(false)
  })

  it('rejects unknown PR, invalid cents, duplicate references, stale state and ledger mismatches', () => {
    const start = fixture()
    const opts = { at, paymentId: 'new' }
    for (const payload of [
      { amount: 0, ref: 'Z' }, { amount: -1, ref: 'N' }, { amount: '0.001', ref: 'M' },
      { amount: 31, ref: 'OVER' }, { amount: 1, ref: '' },
      { amount: 1, ref: 'DATE', date: '2026-02-30' }, { amount: 1, ref: 'ERA', method: 'era' },
      { amount: 1, ref: 'X', clientId: 'wrong-client' }, { amount: 1, ref: 'PAYER-1' },
    ]) expect(planPatientReceipt(start, primaryId, payload, opts).ok).toBe(false)
    const unreported = fixture({ report: null })
    expect(planPatientReceipt(unreported, primaryId, { amount: 1, ref: 'NO-REPORT' }, opts).ok).toBe(false)
    expect(planPatientReceipt(start, 'missing', { amount: 1, ref: 'X' }, opts).ok).toBe(false)
    const received = post(start, primaryId, 10, 'PAT-1')
    expect(post(received, primaryId, 10, 'PAT-1')).toBe(received) // re-plan in reducer, no second Undo
    expect(planPatientReceipt(received, primaryId, { amount: 1, ref: 'pat-1' }, { paymentId: 'other' }).ok).toBe(false)
    expect(planPatientReceipt(received, primaryId, { amount: 1, ref: 'PAT-2' }, { paymentId: 'pat-1' }).ok).toBe(false)
    expect(planUnappliedReceipt(received, { clientId: 'c1', amount: 10, ref: 'pat-1' }, { paymentId: 'un' }).ok).toBe(false)
    expect(planClaimPayment(received, primaryId, { amount: 5, checkNo: 'SECOND-PAYER' }, { paymentId: 'payer-2' }).ok).toBe(false)
    expect(planClaimPayment(start, primaryId, { amount: 5, checkNo: 'BAD-KIND', kind: 'patient' }, { paymentId: 'wrong-kind' }).ok).toBe(false)
    expect(reducer(start, { type: 'record', coll: 'payments', item: { id: 'unplanned', kind: 'patient', amount: 5 } })).toBe(start)
    expect(planVoidClaimPayment(received, 'payer-1', { reversalId: 'payer-rev' }).ok).toBe(false)
    expect(previewEra(received, { lines: [{ id: 'l', claimNo: 'CLM-PATIENT', charges: 100, paid: 5, patientResp: 0 }], errors: [] }).rows[0].reason).toMatch(/Patient cash/i)
    expect(secondaryEligible(received, received.claims[primaryId])).toBe(false)
    const mismatched = { ...received, claims: { ...received.claims, [primaryId]: { ...received.claims[primaryId], patientPaid: 9 } } }
    expect(patientLedgerMatches(mismatched, mismatched.claims[primaryId])).toBe(false)
    expect(patientResponsibilityOf(mismatched, mismatched.claims[primaryId])).toBe(0)
    const imprecise = { ...received, payments: { ...received.payments,
      'pat-1': { ...received.payments['pat-1'], amount: 10.001 } } }
    expect(patientLedgerMatches(imprecise, imprecise.claims[primaryId])).toBe(false)
    expect(planPatientReceipt(mismatched, primaryId, { amount: 1, ref: 'PAT-3' }, { paymentId: 'bad' }).ok).toBe(false)
    expect(arOf(mismatched, '2026-09-27').byPayer[0].payer).toMatch(/review/i)
  })

  it('keeps signed local reversals and an exportable audit, without pretending to refund or re-post', () => {
    const start = post(fixture(), primaryId, 10, 'PAT-1', { note: '=formula' })
    const voided = reverse(start, 'pat-1')
    expect(voided.claims[primaryId]).toMatchObject({ patientPaid: 0, paid: 40 })
    expect(arOf(voided, '2026-09-27').totals).toMatchObject({ totalAR: 60, patientAR: 30 })
    expect(voided.payments.reversal).toMatchObject({ amount: -10, reversalOf: 'pat-1', kind: 'patient' })
    expect(planVoidClaimPayment(voided, 'pat-1', { reversalId: 'twice' }).ok).toBe(false)
    expect(planVoidClaimPayment(voided, 'reversal', { reversalId: 'third' }).ok).toBe(false)
    const audit = buildPatientReceiptAudit(voided)
    expect(audit).toMatch(/PAT-1/)
    expect(audit).toMatch(/reversed_locally/)
    expect(audit).toContain(',-10.00,')
    const injected = { ...voided, payments: { ...voided.payments, 'pat-1': { ...voided.payments['pat-1'], ref: '=formula' } } }
    expect(buildPatientReceiptAudit(injected)).toContain('"\'=formula"')
    const firstRow = audit.split('\n')[2]
    expect(firstRow).toMatch(/reversed"$/)
    expect(reducer(voided, { type: 'undo' }).claims).toEqual(start.claims)
    expect(reducer(voided, { type: 'undo' }).payments).toEqual(start.payments)
  })

  it('supports adjudicated COB: collect against primary, leave child payer remittance untouched', () => {
    const start = fixture()
    const drafted = reducer(start, { type: 'secondaryFilingTx', id: primaryId, options: { at, newId: 'secondary-1' } })
    expect(patientResponsibilityOf(drafted, drafted.claims[primaryId])).toBe(0)
    expect(planPatientReceipt(drafted, primaryId, { amount: 1, ref: 'PREMATURE' }, { paymentId: 'bad' }).ok).toBe(false)
    const filed = reducer(drafted, { type: 'secondaryFilingTx', id: 'secondary-1', options: { at, submit: true, method: 'paper_bg' } })
    expect(patientResponsibilityOf(filed, filed.claims[primaryId])).toBe(0)
    const remitted = reducer(filed, { type: 'claimPaymentTx', id: 'secondary-1',
      payload: { amount: 35, adj: 5, patientResp: 20, checkNo: 'SEC-REM-1' }, options: { at, paymentId: 'sec-pay' } })
    expect(patientResponsibilityOf(remitted, remitted.claims[primaryId])).toBe(20)
    const receipt = post(remitted, primaryId, 10, 'PAT-COB')
    expect(receipt.claims[primaryId]).toMatchObject({ paid: 40, secondaryPaid: 35, patientPaid: 10, adj: 0 })
    expect(receipt.claims['secondary-1']).toEqual(remitted.claims['secondary-1'])
    expect(receipt.payments['pat-cob'].patientSourceClaimId).toBe('secondary-1')
    expect(dueOf(receipt.claims[primaryId])).toBe(15)
    const ar = arOf(receipt, '2026-09-27')
    expect(ar.totals).toMatchObject({ totalAR: 15, patientAR: 10, unassignedAR: 5 })
    expect(ar.byPayer.reduce((s, row) => s + row.balance, 0)).toBe(15)
    expect(buildPatientShareDraft(receipt, { clientIds: [receipt.claims[primaryId].clientId] }).due).toBe(10)
    expect(planPatientReceipt(receipt, 'secondary-1', { amount: 1, ref: 'WRONG' }, { paymentId: 'bad' }).ok).toBe(false)
    expect(planVoidClaimPayment(receipt, 'sec-pay', { reversalId: 'rev-sec' }).ok).toBe(false)
    const reversed = reverse(receipt, 'pat-cob')
    expect(reversed.claims[primaryId].secondaryPaid).toBe(35)
    expect(reversed.claims[primaryId].patientPaid).toBe(0)
    expect(planVoidClaimPayment(reversed, 'sec-pay', { reversalId: 'rev-sec' }).ok).toBe(true)
  })

  it('updates self-pay invoice with the claim and receipt, preserves backup/reload, and rejects torn exports', () => {
    const start = fixture({ mode: 'selfpay' })
    expect(patientResponsibilityOf(start, start.claims[primaryId])).toBe(100)
    const paid = post(start, primaryId, '100.00', 'SELF-1')
    expect(paid.claims[primaryId]).toMatchObject({ paid: 0, patientPaid: 100, status: 'paid' })
    expect(paid.invoices['inv-patient']).toMatchObject({ due: 0, status: 'paid' })
    expect(dueOf(paid.claims[primaryId])).toBe(0)
    expect(reducer(paid, { type: 'undo' }).invoices).toEqual(start.invoices)
    const reverted = reverse(paid, 'self-1')
    expect(reverted.invoices['inv-patient']).toMatchObject({ due: 100, status: 'open' })
    expect(reverted.claims[primaryId]).toMatchObject({ patientPaid: 0, status: 'submitted' })
    expect(reducer(reverted, { type: 'undo' }).invoices).toEqual(paid.invoices)
    const cancelledInvoice = { ...start, invoices: { 'inv-patient': { ...start.invoices['inv-patient'], status: 'void' } } }
    expect(post(cancelledInvoice, primaryId, 10, 'SELF-VOID').invoices['inv-patient'].status).toBe('void')
    // Keeping a reversed receipt as audit history does not prevent a later
    // unremitted claim from being voided and backed up.
    const voided = reducer(reverted, { type: 'claimsTx', claimUpserts: [{ ...reverted.claims[primaryId], status: 'void' }] })
    expect(readWorkspaceBackup(createWorkspaceBackup(voided), blankState()).data.claims[primaryId].status).toBe('void')

    const backup = createWorkspaceBackup(paid)
    const { data } = readWorkspaceBackup(backup, blankState())
    expect(data.payments['self-1'].kind).toBe('patient')
    expect(data.claims[primaryId].patientPaid).toBe(100)
    const restored = reducer(start, { type: 'replace', payload: data })
    expect(restored.claims[primaryId].patientPaid).toBe(100)
    expect(reducer(restored, { type: 'undo' }).claims).toEqual(start.claims)
    localStorage.setItem('aloha-aba.v3', serializeForStorage(paid))
    expect(initial().claims[primaryId].patientPaid).toBe(100)
    expect(initial().payments['self-1']).toMatchObject({ kind: 'patient', amount: 100 })
    const torn = JSON.parse(backup)
    torn.data.claims[primaryId].patientPaid = 99
    expect(() => readWorkspaceBackup(torn, blankState())).toThrow(/unreconciled patient/i)
    expect(reducer(start, { type: 'replace', payload: torn.data })).toBe(start)
    const overpaid = JSON.parse(backup)
    overpaid.data.claims[primaryId].paid = 1
    expect(() => readWorkspaceBackup(overpaid, blankState())).toThrow(/unreconciled patient/i)
  })
})
