import { describe, expect, it } from 'vitest'
import { blankState, reducer } from '../state/store'
import { arOf, claimStats, dueOf, patientResponsibilityOf, quickPosts, secondaryEligible } from '../lib/claims'
import { buildPatientShareDraft, buildQboCsv } from '../lib/billingDocs'
import { planSecondaryFiling, planSecondaryCancel, normalizeCobLedger } from '../lib/secondaryLedger'
import { planClaimPayment, planVoidClaimPayment, planUnappliedReceipt } from '../lib/paymentLedger'
import { previewEra } from '../lib/eraPosting'

const base = blankState()
const date = Date.parse('2026-09-08T12:00:00Z')
function fixture(patch = {}) {
  const client = base.clients[0]
  const primary = {
    id: 'primary-cob', no: 'CLM-COB', clientId: client.id, payer: client.insurer,
    mode: 'insurance', charges: 100, paid: 40, adj: 0, secondary: null,
    status: 'partially_paid', dosFrom: '2026-09-01', dosTo: '2026-09-01',
    submittedAt: date - 3 * 86400000, closedAt: null, createdAt: date - 4 * 86400000,
    lines: [{ apptId: 'appt-cob', dos: '2026-09-01', code: '97153', charge: 100, units: 2, rate: 50, t0: 540, t1: 600 }],
    units: 2, history: [], ...patch,
  }
  return { ...base, claims: { [primary.id]: primary }, payments: {}, eraImports: {},
    billedFiles: {}, invoices: {}, appts: {}, history: [] }
}
const tx = (state, id, payload, paymentId = 'secondary-receipt') => reducer(state, {
  type: 'claimPaymentTx', id, payload, options: { at: date, paymentId },
})
const draftOf = (state) => reducer(state, { type: 'secondaryFilingTx', id: 'primary-cob',
  options: { at: date, newId: 'child-1' } })
const submitOf = (state, id = 'child-1') => reducer(state, { type: 'secondaryFilingTx', id,
  options: { at: date + 1, submit: true, method: 'paper_bg', newId: 'unused' } })

describe('claim-level COB ledger and explicitly reported patient share', () => {
  it('creates an untransmitted draft, records external filing, and keeps ONE receivable', () => {
    const start = fixture()
    expect(secondaryEligible(start, start.claims['primary-cob'])).toBe(true)
    const draft = draftOf(start)
    expect(draft.claims['child-1']).toMatchObject({ no: 'CLM-COB-S1', method: 'secondary', secondary: 'primary-cob', charges: 60, status: 'draft' })
    expect(dueOf(draft.claims['primary-cob'])).toBe(60)
    expect(arOf(draft, '2026-09-27').totals.totalAR).toBe(60)
    expect(arOf(draft, '2026-09-27').byPayer[0].payer).toBe('COB draft / review')
    expect(draft.billedFiles).toEqual({})
    expect(reducer(draft, { type: 'secondaryFilingTx', id: 'primary-cob', options: { at: date, newId: 'child-2' } })).toBe(draft)
    const filed = submitOf(draft)
    expect(filed.claims['child-1']).toMatchObject({ status: 'submitted', submitMethod: 'paper_bg', submittedAt: date + 1 })
    expect(arOf(filed, '2026-09-27').byPayer[0].payer).toBe(base.payers[0].name)
    expect(filed.billedFiles).toEqual({})
    expect(filed.history).toHaveLength(2)
    expect(reducer(filed, { type: 'undo' }).claims).toEqual(draft.claims)
    expect(planSecondaryFiling(filed, 'child-1', { submit: true }).ok).toBe(false)
  })

  it('manual secondary remittance reduces primary by payer CASH only, splits payer/PR A/R, and is reversible', () => {
    const start = submitOf(draftOf(fixture()))
    const payload = { amount: '35.00', adj: '5.00', patientResp: '20.00', checkNo: 'SEC-1', note: 'Paper remittance', method: 'eft' }
    const preview = planClaimPayment(start, 'child-1', payload, { at: date + 2, paymentId: 'secondary-receipt' })
    expect(preview.ok).toBe(true)
    const posted = tx(start, 'child-1', payload)
    expect(posted.claims['child-1']).toMatchObject({ paid: 35, adj: 5, status: 'partially_paid' })
    expect(posted.claims['primary-cob']).toMatchObject({ paid: 40, adj: 0, secondaryPaid: 35, status: 'partially_paid' })
    expect(posted.payments['secondary-receipt']).toMatchObject({ amount: 35, adj: 5, patientResp: 20, parentClaimId: 'primary-cob' })
    expect(dueOf(posted.claims['primary-cob'])).toBe(25)
    expect(dueOf(posted.claims['child-1'])).toBe(20) // filing balance is not another receivable
    expect(patientResponsibilityOf(posted, posted.claims['primary-cob'])).toBe(20)
    const ar = arOf(posted, '2026-09-27')
    expect(ar.totals).toMatchObject({ totalAR: 25, patientAR: 20, unassignedAR: 5 })
    expect(ar.byClient[0].claims).toHaveLength(1)
    expect(ar.byPayer.map((row) => row.balance).sort((a, b) => a - b)).toEqual([5, 20])
    expect(ar.byPayer.reduce((sum, row) => sum + row.balance, 0)).toBe(25)
    expect(ar.byPayer.find((row) => row.payer === base.payers[0].name).claimDueById['primary-cob']).toBe(5)
    expect(claimStats(posted, ['2026-09-01']).paid.$).toBe(0) // parent not yet closed
    const patient = buildPatientShareDraft(posted, { clientIds: [base.clients[0].id] })
    expect(patient.rows[0].claims.map((c) => c.id)).toEqual(['primary-cob'])
    expect(patient.due).toBe(20)
    expect(patient.content).not.toContain('CLM-COB-S1')
    expect(buildQboCsv(posted, { from: '2026-09-01', to: '2026-09-30' })[0].rows).toBe(0)
    expect(tx(posted, 'child-1', payload, 'duplicate')).toBe(posted)
    expect(planClaimPayment(posted, 'primary-cob', { amount: 1, checkNo: 'wrong-ledger' }, { paymentId: 'x' }).ok).toBe(false)
    expect(planVoidClaimPayment(posted, 'secondary-receipt', { at: date + 3, reversalId: 'rev-1' }).ok).toBe(true)
    const voided = reducer(posted, { type: 'claimVoidPaymentTx', id: 'secondary-receipt', options: { at: date + 3, reversalId: 'rev-1' } })
    expect(voided.claims['primary-cob'].secondaryPaid).toBe(0)
    expect(voided.claims['child-1']).toMatchObject({ paid: 0, adj: 0, status: 'submitted' })
    expect(arOf(voided, '2026-09-27').totals).toMatchObject({ totalAR: 60, patientAR: 0 })
    expect(voided.payments['rev-1']).toMatchObject({ amount: -35, adj: -5, patientResp: -20, reversalOf: 'secondary-receipt' })
    expect(reducer(voided, { type: 'claimVoidPaymentTx', id: 'secondary-receipt', options: { at: date + 4, reversalId: 'rev-2' } })).toBe(voided)
    const undone = reducer(voided, { type: 'undo' })
    expect(undone.claims).toEqual(posted.claims)
    expect(undone.payments).toEqual(posted.payments)
  })

  it('rejects stale filing, out-of-coverage, duplicate/overprecision money and unsafe cancellation; re-files as S2', () => {
    const start = fixture()
    const draft = draftOf(start)
    const wrongCoverage = { ...draft, clients: draft.clients.map((cl) => cl.id === 'c1' ? { ...cl, secondary: { ...cl.secondary, until: '2026-08-31' } } : cl) }
    expect(planSecondaryFiling(wrongCoverage, 'child-1', { submit: true }).ok).toBe(false)
    expect(secondaryEligible(wrongCoverage, start.claims['primary-cob'])).toBe(false)
    expect(planSecondaryCancel(draft, 'child-1').ok).toBe(true)
    const cancelled = reducer(draft, { type: 'secondaryCancelTx', id: 'child-1', options: { at: date + 1 } })
    expect(cancelled.claims['child-1'].status).toBe('void')
    expect(cancelled.claims['primary-cob'].secondary).toBeNull()
    const refile = reducer(cancelled, { type: 'secondaryFilingTx', id: 'primary-cob', options: { at: date + 2, newId: 'child-2' } })
    expect(refile.claims['child-2'].no).toBe('CLM-COB-S2')
    expect(reducer(refile, { type: 'undo' }).claims).toEqual(cancelled.claims)
    const filed = submitOf(draft)
    for (const payload of [
      { amount: -1, checkNo: 'NEG' }, { amount: '30.001', checkNo: 'THREE' },
      { amount: 61, checkNo: 'OVER' }, { amount: 20, adj: 41, checkNo: 'OVER-ADJ' },
      { amount: 1, checkNo: '' }, { amount: 20, patientResp: 41, checkNo: 'OVER-PR' },
    ]) expect(planClaimPayment(filed, 'child-1', payload, { paymentId: 'bad' }).ok).toBe(false)
    expect(planClaimPayment(draft, 'child-1', { amount: 10, checkNo: 'DRAFT' }, { paymentId: 'bad' }).ok).toBe(false)
    expect(planClaimPayment(filed, 'child-1', { amount: 10, checkNo: 'GOOD' }, { paymentId: 'p' }).ok).toBe(true)
    const posted = tx(filed, 'child-1', { amount: 10, checkNo: 'GOOD' }, 'p')
    expect(planClaimPayment(posted, 'child-1', { amount: 10, checkNo: 'good' }, { paymentId: 'duplicate' }).ok).toBe(false)
    expect(planSecondaryCancel(posted, 'child-1').ok).toBe(false)
  })

  it('does not turn absence of a report into PR; manual receipt can retain previous reported PR and void it', () => {
    const state = fixture({ mode: 'insurance' })
    const first = tx(state, 'primary-cob', { amount: 10, patientResp: 30, checkNo: 'PRI-1' }, 'first')
    expect(patientResponsibilityOf(first, first.claims['primary-cob'])).toBe(30)
    const second = tx(first, 'primary-cob', { amount: 5, checkNo: 'PRI-2' }, 'second')
    expect(second.payments.second.patientResp).toBeNull()
    expect(patientResponsibilityOf(second, second.claims['primary-cob'])).toBe(30)
    const voidFirst = reducer(second, { type: 'claimVoidPaymentTx', id: 'first', options: { at: date + 3, reversalId: 'rev' } })
    expect(patientResponsibilityOf(voidFirst, voidFirst.claims['primary-cob'])).toBe(0)
    expect(planUnappliedReceipt(state, { clientId: 'c1', amount: 10, ref: 'UN-1' }, { paymentId: 'un' }).ok).toBe(true)
    const unapplied = reducer(state, { type: 'unappliedPaymentTx', payload: { clientId: 'c1', amount: 10, ref: 'UN-1' }, options: { paymentId: 'un', at: date } })
    expect(unapplied.claims).toEqual(state.claims)
    expect(reducer(unapplied, { type: 'unappliedPaymentTx', payload: { clientId: 'c1', amount: 10, ref: 'UN-1' }, options: { paymentId: 'un-2', at: date } })).toBe(unapplied)
    const reversed = reducer(unapplied, { type: 'claimVoidPaymentTx', id: 'un', options: { at: date + 1, reversalId: 'un-rev' } })
    expect(reversed.payments['un-rev'].amount).toBe(-10)
    expect(reducer(reversed, { type: 'undo' }).payments).toEqual(unapplied.payments)
  })

  it('migrates a reconciled legacy pair once, but flags conflicting balances for review', () => {
    const state = submitOf(draftOf(fixture()))
    const legacy = { ...state, claims: { ...state.claims, 'child-1': { ...state.claims['child-1'], paid: 35, status: 'partially_paid' } } }
    const normalized = normalizeCobLedger(legacy)
    expect(normalized.claims['primary-cob'].secondaryPaid).toBe(35)
    expect(arOf(normalized, '2026-09-27').totals.totalAR).toBe(25)
    expect(normalizeCobLedger(normalized)).toBe(normalized)
    const impossible = { ...legacy, claims: { ...legacy.claims, 'child-1': { ...legacy.claims['child-1'], paid: 100 } } }
    const review = normalizeCobLedger(impossible)
    expect(review.claims['primary-cob']).toMatchObject({ cobReviewNeeded: true, paid: 40 })
    expect(patientResponsibilityOf(review, review.claims['primary-cob'])).toBe(0)
  })

  it('does not route linked COB to the primary 835 planner; quick-post presets use the open balance', () => {
    const state = submitOf(draftOf(fixture()))
    const line = { id: 'l', claimNo: 'CLM-COB-S1', statusCode: '1', charges: 60, paid: 60, adjustments: [], patientResp: 0 }
    expect(previewEra(state, { lines: [line], errors: [] }).rows[0].reason).toMatch(/secondary ERA/i)
    expect(previewEra(state, { lines: [{ ...line, claimNo: 'CLM-COB', charges: 100 }], errors: [] }).rows[0].reason).toMatch(/secondary filing is linked/i)
    const posts = quickPosts(state, state.claims['primary-cob'], state.clients[0])
    expect(posts.find((p) => p.id === 'full').amount).toBe(60)
    expect(posts.find((p) => p.id === 'writeoff').adj).toBe(60)
    expect(posts.every((p) => p.amount + p.adj <= 60)).toBe(true)
  })
})
