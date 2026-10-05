import React from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { blankState, StoreProvider, useStore } from '../state/store'
import { ToastProvider } from '../ui/Toast'
import SecondaryBillingView from '../components/SecondaryBillingView'
import PaymentCenterView from '../components/PaymentCenterView'
import ArManagerView from '../components/ArManagerView'
import GenerateInvoiceView from '../components/GenerateInvoiceView'
import { arOf } from '../lib/claims'

const KEY = 'aloha-aba.v3'
const saved = () => JSON.parse(localStorage.getItem(KEY) || '{}')
const claimId = 'p-ui-cob'
function TestRouter() {
  const { ui, actions, history } = useStore()
  return <>
    <span data-testid="undo-count">{history.length}</span>
    <button data-testid="flow-undo" onClick={() => actions.undo()}>Undo</button>
    <button data-testid="flow-ar" onClick={() => actions.setUI({ section: 'bil-ar' })}>A/R</button>
    <button data-testid="flow-invoice" onClick={() => actions.setUI({ section: 'bil-invoice' })}>Draft invoice</button>
    <button data-testid="flow-secondary" onClick={() => actions.setUI({ section: 'bil-secondary' })}>COB queue</button>
    <button data-testid="flow-payments" onClick={() => actions.setUI({ section: 'bil-payments' })}>Payments</button>
    {ui.section === 'bil-secondary' ? <SecondaryBillingView /> : ui.section === 'bil-payments' ? <PaymentCenterView /> :
      ui.section === 'bil-ar' ? <ArManagerView /> : ui.section === 'bil-invoice' ? <GenerateInvoiceView /> : null}
  </>
}

beforeEach(() => {
  localStorage.clear()
  const base = blankState()
  base.claims = { [claimId]: {
    id: claimId, no: 'CLM-UI-COB', clientId: 'c1', payer: base.clients[0].insurer,
    mode: 'insurance', status: 'partially_paid', secondary: null, charges: 100, paid: 40, adj: 0,
    submittedAt: Date.now() - 86400000, createdAt: Date.now() - 172800000, history: [],
    dosFrom: '2026-09-01', dosTo: '2026-09-01', units: 2,
    lines: [{ apptId: 'a-cob', dos: '2026-09-01', charge: 100, rate: 50, units: 2, code: '97153', t0: 540, t1: 600 }],
  } }
  base.payments = {}
  base.ui.section = 'bil-secondary'
  base.history = []
  localStorage.setItem(KEY, JSON.stringify(base))
})
afterEach(() => cleanup())
const mount = () => render(<ToastProvider><StoreProvider><TestRouter /></StoreProvider></ToastProvider>)

describe('manual COB UI, receipts, A/R and Undo', () => {
  it('draft → record external filing → apply payer remittance → review split A/R → reverse/undo atomically', async () => {
    mount()
    expect(screen.getByTestId('sb-sec').textContent).not.toContain('Secondary Billing') // title matches the nav: Secondary Queue
    fireEvent.click(screen.getByTestId(`sb-release-${claimId}`))
    await waitFor(() => expect(saved().claims[claimId].secondary).toBeTruthy())
    const childId = saved().claims[claimId].secondary
    expect(saved().claims[childId]).toMatchObject({ status: 'draft', charges: 60, no: 'CLM-UI-COB-S1' })
    expect(saved().billedFiles).toEqual({})
    expect(screen.getByTestId('undo-count').textContent).toBe('1')

    fireEvent.click(screen.getByTestId(`sb-submit-${childId}`))
    fireEvent.click(screen.getByTestId(`sb-submit-paper-bg-${childId}`))
    await waitFor(() => expect(saved().claims[childId]).toMatchObject({ status: 'submitted', submitMethod: 'paper_bg' }))
    expect(saved().claims[childId].history.at(-1).ev).toMatch(/not transmitted/i)
    expect(screen.getByTestId('undo-count').textContent).toBe('2')

    fireEvent.click(screen.getByTestId(`sb-pay-${childId}`))
    await screen.findByTestId('pc-man-modal')
    expect(screen.getByTestId('pc-man-apply').value).toBe('claim')
    expect(screen.getByTestId('pc-man-claim').value).toBe(childId)
    expect(screen.getByTestId('pc-man-payer').value).toBe(saved().claims[childId].payer)
    fireEvent.change(screen.getByTestId('pc-man-amount'), { target: { value: '35.00' } })
    fireEvent.change(screen.getByTestId('pc-man-adj'), { target: { value: '5.00' } })
    fireEvent.change(screen.getByTestId('pc-man-patient'), { target: { value: '20.00' } })
    fireEvent.change(screen.getByTestId('pc-man-ref'), { target: { value: 'SEC-UI-1' } })
    fireEvent.click(screen.getByTestId('pc-man-save'))
    await waitFor(() => expect(saved().claims[claimId]).toMatchObject({ paid: 40, adj: 0, secondaryPaid: 35 }))
    const posted = saved()
    expect(posted.claims[childId]).toMatchObject({ paid: 35, adj: 5, status: 'partially_paid' })
    const payment = Object.values(posted.payments).find((p) => p.claimId === childId)
    expect(payment).toMatchObject({ amount: 35, adj: 5, patientResp: 20, parentClaimId: claimId })
    expect(arOf(posted, '2026-09-27').totals).toMatchObject({ totalAR: 25, patientAR: 20, unassignedAR: 5 })
    expect(screen.queryByTestId('pc-man-modal')).toBeNull()
    expect(screen.getByTestId('pc-table')).toBeTruthy() // manual save did not jump to ERA history
    expect(screen.getByTestId('undo-count').textContent).toBe('3')

    fireEvent.click(screen.getByTestId('flow-ar'))
    expect(screen.getByTestId('ar-kpi-total').textContent).toMatch(/25/)
    expect(screen.getByTestId('ar-kpi-patient').textContent).toMatch(/20/)
    fireEvent.click(screen.getByTestId('ar-tab-payer'))
    expect(screen.getByTestId('ar-sec').textContent).toMatch(/Patient \/ family/)

    fireEvent.click(screen.getByTestId('flow-invoice'))
    fireEvent.click(screen.getByTestId('gi-client-c1'))
    expect(screen.getByTestId('gi-row-c1').textContent).toMatch(/20.*reported/)
    expect(screen.getByTestId('gi-row-c1').textContent).not.toContain('CLM-UI-COB-S1')
    fireEvent.click(screen.getByTestId('flow-payments'))
    fireEvent.click(screen.getByTestId(`pc-void-${payment.id}`))
    await waitFor(() => expect(saved().claims[claimId].secondaryPaid).toBe(0))
    expect(saved().payments[Object.keys(saved().payments).find((id) => id !== payment.id)].reversalOf).toBe(payment.id)
    expect(arOf(saved(), '2026-09-27').totals).toMatchObject({ totalAR: 60, patientAR: 0 })
    expect(screen.getByTestId('undo-count').textContent).toBe('4')
    fireEvent.click(screen.getByTestId('flow-undo'))
    await waitFor(() => expect(saved().claims[claimId].secondaryPaid).toBe(35))
    expect(saved().payments).toEqual(posted.payments)
    fireEvent.click(screen.getByTestId('flow-undo'))
    await waitFor(() => expect(saved().claims[claimId].secondaryPaid).toBeUndefined())
    expect(saved().claims[childId].status).toBe('submitted')
    expect(saved().payments).toEqual({})
  })

  it('can skip without transferring an unknown patient balance, and can undo the skip', async () => {
    mount()
    fireEvent.click(screen.getByTestId(`sb-skip-${claimId}`))
    await waitFor(() => expect(saved().claims[claimId].secondarySkipped).toBe(true))
    expect(saved().claims[claimId].secondary).toBeNull()
    expect(arOf(saved(), '2026-09-27').totals).toMatchObject({ totalAR: 60, patientAR: 0 })
    expect(screen.queryByTestId(`sb-release-${claimId}`)).toBeNull()
    fireEvent.click(screen.getByTestId('flow-undo'))
    await waitFor(() => expect(saved().claims[claimId].secondarySkipped).toBeUndefined())
    expect(screen.getByTestId(`sb-release-${claimId}`)).toBeTruthy()
  })

  it('validates an unapplied receipt, keeps it off claims, and records an auditable reversal', async () => {
    mount()
    fireEvent.click(screen.getByTestId('flow-payments'))
    fireEvent.click(screen.getByTestId('pc-open-man'))
    fireEvent.change(screen.getByTestId('pc-man-amount'), { target: { value: '15.00' } })
    fireEvent.click(screen.getByTestId('pc-man-save'))
    expect(screen.getByTestId('pc-man-error').textContent).toMatch(/reference/i)
    fireEvent.change(screen.getByTestId('pc-man-ref'), { target: { value: 'UN-UI' } })
    fireEvent.click(screen.getByTestId('pc-man-save'))
    await waitFor(() => expect(Object.values(saved().payments)).toHaveLength(1))
    const payment = Object.values(saved().payments)[0]
    expect(payment).toMatchObject({ claimId: null, amount: 15, kind: 'unapplied' })
    expect(saved().claims[claimId].paid).toBe(40)
    expect(screen.getByTestId('pc-table')).toBeTruthy()
    expect(screen.getByTestId('pc-kpi-unapplied').textContent).toMatch(/15/)
    fireEvent.click(screen.getByTestId(`pc-void-${payment.id}`))
    await waitFor(() => expect(Object.values(saved().payments)).toHaveLength(2))
    expect(screen.getByTestId('pc-kpi-unapplied').textContent).toMatch(/\$0/)
    expect(saved().claims[claimId].paid).toBe(40)
  })
})
