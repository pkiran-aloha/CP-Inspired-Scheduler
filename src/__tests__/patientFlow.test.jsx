import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { blankState, StoreProvider, useStore } from '../state/store'
import { ToastProvider } from '../ui/Toast'
import ArManagerView from '../components/ArManagerView'
import PaymentCenterView from '../components/PaymentCenterView'
import GenerateInvoiceView from '../components/GenerateInvoiceView'
import SecondaryBillingView from '../components/SecondaryBillingView'
import { arOf } from '../lib/claims'

// jsdom Blob has no text(); FileReader reads what the download saved.
const readBlob = (blob) => new Promise((resolve) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.readAsText(blob) })
const KEY = 'aloha-aba.v3'
const saved = () => JSON.parse(localStorage.getItem(KEY))
const primaryId = 'patient-ui-primary'
const childId = 'patient-ui-secondary'
function Router() {
  const { ui, actions, history } = useStore()
  return <>
    <span data-testid="history-length">{history.length}</span>
    <button onClick={() => actions.undo()}>Undo</button>
    <button onClick={() => actions.setUI({ section: 'bil-ar' })}>A/R</button>
    <button onClick={() => actions.setUI({ section: 'bil-invoice' })}>Statements</button>
    <button onClick={() => actions.setUI({ section: 'bil-secondary' })}>Secondary</button>
    {ui.section === 'bil-ar' ? <ArManagerView /> :
      ui.section === 'bil-payments' ? <PaymentCenterView /> :
        ui.section === 'bil-secondary' ? <SecondaryBillingView /> : <GenerateInvoiceView />}
  </>
}
const mount = () => render(<ToastProvider><StoreProvider><Router /></StoreProvider></ToastProvider>)

beforeEach(() => {
  localStorage.clear()
  const base = blankState()
  const parent = { id: primaryId, no: 'CLM-UI-PATIENT', clientId: 'c1', payer: base.clients[0].insurer,
    mode: 'insurance', charges: 100, paid: 40, adj: 0, secondaryPaid: 35, patientPaid: 0,
    secondary: childId, status: 'partially_paid', createdAt: Date.now() - 86400000, submittedAt: Date.now() - 86400000,
    dosFrom: '2026-09-01', dosTo: '2026-09-01', history: [],
    lines: [{ apptId: 'appt-ui-patient', dos: '2026-09-01', charge: 100, units: 2, code: '97153', rate: 50, t0: 540, t1: 600 }] }
  const child = { ...parent, id: childId, no: 'CLM-UI-PATIENT-S1', payer: base.payers[0].name,
    method: 'secondary', secondary: primaryId, parentNo: parent.no, charges: 60, paid: 35, adj: 5,
    secondaryPaid: undefined, patientPaid: undefined, remittance: { checkNo: 'SEC-UI', patientResp: 20 } }
  base.claims = { [primaryId]: parent, [childId]: child }
  base.payments = { 'sec-ui': { id: 'sec-ui', claimId: childId, parentClaimId: primaryId,
    clientId: 'c1', payer: child.payer, kind: 'manual', amount: 35, adj: 5, patientResp: 20,
    ref: 'SEC-UI', method: 'eft', date: '2026-09-26', createdAt: Date.now() - 86400000 } }
  base.ui.section = 'bil-ar'
  base.history = []
  localStorage.setItem(KEY, JSON.stringify(base))
})
afterEach(() => cleanup())

describe('patient receipt workflow — manual and local only', () => {
  it('prefills from A/R, validates PR, posts one atomic receipt, updates statement, reverses and undoes', async () => {
    mount()
    expect(screen.getByTestId('ar-kpi-total').textContent).toMatch(/25/)
    expect(screen.getByTestId('ar-kpi-patient').textContent).toMatch(/20/)
    fireEvent.click(screen.getByTestId('ar-row-c1'))
    fireEvent.click(screen.getByTestId(`ar-patient-${primaryId}`))
    await screen.findByTestId('pc-man-modal')
    expect(screen.getByTestId('pc-man-apply').value).toBe('patient')
    expect(screen.getByTestId('pc-man-client').value).toBe('c1')
    expect(screen.getByTestId('pc-man-claim').value).toBe(primaryId)
    expect(screen.getByTestId('pc-man-payer').value).toMatch(/Patient \/ family/)
    expect(screen.getByTestId('pc-man-patient-limit').textContent).toMatch(/\$20/)
    fireEvent.change(screen.getByTestId('pc-man-amount'), { target: { value: '21.00' } })
    fireEvent.change(screen.getByTestId('pc-man-ref'), { target: { value: 'PAT-UI-1' } })
    fireEvent.click(screen.getByTestId('pc-man-save'))
    expect(screen.getByTestId('pc-man-error').textContent).toMatch(/exceeds.*patient/i)
    expect(saved().claims[primaryId].patientPaid).toBe(0)

    const childBefore = saved().claims[childId]
    fireEvent.change(screen.getByTestId('pc-man-amount'), { target: { value: '10.00' } })
    fireEvent.change(screen.getByTestId('pc-man-method'), { target: { value: 'card' } })
    fireEvent.click(screen.getByTestId('pc-man-save'))
    await waitFor(() => expect(saved().claims[primaryId].patientPaid).toBe(10))
    const posted = saved()
    const patient = Object.values(posted.payments).find((p) => p.kind === 'patient')
    expect(patient).toMatchObject({ claimId: primaryId, patientSourceClaimId: childId, amount: 10, method: 'card' })
    expect(posted.claims[childId]).toEqual(childBefore)
    expect(arOf(posted, '2026-09-27').totals).toMatchObject({ totalAR: 15, patientAR: 10, unassignedAR: 5 })
    expect(screen.getByTestId('pc-kpi-patient').textContent).toMatch(/10/)
    expect(screen.getByTestId('history-length').textContent).toBe('1')
    fireEvent.click(screen.getByTestId('pc-filter-patient'))
    expect(screen.getByTestId(`pc-pay-row-${patient.id}`).textContent).toMatch(/Patient receipt/)
    expect(screen.queryByTestId('pc-pay-row-sec-ui')).toBeNull()
    fireEvent.click(screen.getByText('Secondary'))
    expect(screen.getByTestId(`sb-row-${childId}`).textContent).toMatch(/Primary A\/R \$15.*Patient received \$10/)

    fireEvent.click(screen.getByText('Statements'))
    fireEvent.click(screen.getByTestId('gi-client-c1'))
    expect(screen.getByTestId('gi-row-c1').textContent).toMatch(/\$10.*reported share remaining/)
    expect(screen.getByTestId('gi-row-c1').textContent).not.toContain('CLM-UI-PATIENT-S1')
    window.URL.createObjectURL = vi.fn(() => 'blob:gi-test')
    window.URL.revokeObjectURL = vi.fn()
    fireEvent.click(screen.getByTestId('gi-generate'))
    const draft = await readBlob(window.URL.createObjectURL.mock.calls[0][0])
    expect(draft).toMatch(/Remaining reported patient share \$10/)
    expect(draft).not.toContain('CLM-UI-PATIENT-S1')
    fireEvent.click(screen.getByTestId(`gi-patient-${primaryId}`))
    await screen.findByTestId('pc-man-modal')
    expect(screen.getByTestId('pc-man-claim').value).toBe(primaryId)
    fireEvent.click(screen.getByLabelText('Close'))
    fireEvent.click(screen.getByTestId(`pc-void-${patient.id}`))
    await waitFor(() => expect(saved().claims[primaryId].patientPaid).toBe(0))
    const reverted = saved()
    expect(reverted.payments[patient.id]).toEqual(posted.payments[patient.id])
    expect(Object.values(reverted.payments).find((p) => p.reversalOf === patient.id)).toMatchObject({ amount: -10, kind: 'patient' })
    expect(reverted.claims[childId]).toEqual(posted.claims[childId])
    expect(screen.getByTestId('history-length').textContent).toBe('2')
    fireEvent.click(screen.getByText('Undo'))
    await waitFor(() => expect(saved().claims[primaryId].patientPaid).toBe(10))
    expect(saved().payments).toEqual(posted.payments)
    fireEvent.click(screen.getByText('Undo'))
    await waitFor(() => expect(saved().claims[primaryId].patientPaid).toBe(0))
    expect(Object.keys(saved().payments)).toEqual(['sec-ui'])
  })

  it('requires an explicit primary-claim selection when started from Payment Center', async () => {
    const start = saved()
    start.claims = { [primaryId]: { ...start.claims[primaryId], secondary: null, secondaryPaid: 0,
      remittance: { checkNo: 'PRI-UI', patientResp: 15 } } }
    start.payments = { 'pri-ui': { id: 'pri-ui', claimId: primaryId, clientId: 'c1', kind: 'manual',
      amount: 40, patientResp: 15, method: 'eft', ref: 'PRI-UI', date: '2026-09-26', createdAt: Date.now() - 86400000 } }
    start.ui.section = 'bil-payments'
    localStorage.setItem(KEY, JSON.stringify(start))
    mount()
    fireEvent.click(screen.getByTestId('pc-open-patient'))
    expect(screen.getByTestId('pc-man-claim').value).toBe('')
    fireEvent.change(screen.getByTestId('pc-man-amount'), { target: { value: '5.00' } })
    fireEvent.change(screen.getByTestId('pc-man-ref'), { target: { value: 'PAT-SELECT' } })
    fireEvent.click(screen.getByTestId('pc-man-save'))
    expect(screen.getByTestId('pc-man-error').textContent).toMatch(/Select a primary claim/)
    expect(saved().claims[primaryId].patientPaid).toBe(0)
    fireEvent.change(screen.getByTestId('pc-man-claim'), { target: { value: primaryId } })
    fireEvent.click(screen.getByTestId('pc-man-save'))
    await waitFor(() => expect(saved().claims[primaryId].patientPaid).toBe(5))
    expect(Object.values(saved().payments).find((p) => p.kind === 'patient').claimId).toBe(primaryId)
  })

  it('does not let an unreported insurance remainder be collected as patient cash', async () => {
    const start = saved()
    const claim = start.claims[primaryId]
    start.claims = { [primaryId]: { ...claim, secondary: null, secondaryPaid: 0 } }
    start.payments = {}
    start.ui.section = 'bil-payments'
    localStorage.setItem(KEY, JSON.stringify(start))
    mount()
    fireEvent.click(screen.getByTestId('pc-open-patient'))
    expect(screen.getByTestId('pc-man-apply').value).toBe('patient')
    expect(screen.getByTestId('pc-man-patient-limit').textContent).toMatch(/No eligible claim/)
    fireEvent.change(screen.getByTestId('pc-man-amount'), { target: { value: '5.00' } })
    fireEvent.change(screen.getByTestId('pc-man-ref'), { target: { value: 'PAT-NO-PR' } })
    fireEvent.click(screen.getByTestId('pc-man-save'))
    expect(screen.getByTestId('pc-man-error').textContent).toMatch(/No documented patient share/)
    expect(saved().payments).toEqual({})
  })
})
