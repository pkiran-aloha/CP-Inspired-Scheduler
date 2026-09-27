import React from 'react'
import { beforeEach, afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { blankState, StoreProvider, useStore } from '../state/store'
import { stagedAppts } from '../lib/claims'

const KEY = 'aloha-aba.v3'
const saved = () => JSON.parse(localStorage.getItem(KEY))
beforeEach(() => localStorage.clear())
afterEach(() => cleanup())

function PaymentProbe({ claimId }) {
  const { actions } = useStore()
  return <>
    <button onClick={() => actions.recordPayment({ claimId, clientId: 'c1', payer: 'Aetna', amount: 25, ref: 'CHK-TEST' })}>Post manual payment</button>
    <button onClick={() => actions.undo()}>Undo once</button>
  </>
}

function InvoiceProbe({ apptId }) {
  const { actions } = useStore()
  return <>
    <button onClick={() => actions.generateClaims([apptId])}>Assemble self-pay claim</button>
    <button onClick={() => actions.undo()}>Undo once</button>
  </>
}

function VoidProbe({ paymentId, onResult }) {
  const { actions } = useStore()
  return <>
    <button onClick={() => onResult(actions.voidPayment(paymentId))}>Void payment</button>
    <button onClick={() => actions.undo()}>Undo once</button>
  </>
}

describe('action-level financial Undo', () => {
  it('a manual claim payment and its claim change are one transaction', async () => {
    const base = blankState()
    const claim = Object.values(base.claims).find((c) => c.status === 'submitted')
    expect(claim).toBeTruthy()
    localStorage.setItem(KEY, JSON.stringify(base))
    render(<StoreProvider><PaymentProbe claimId={claim.id} /></StoreProvider>)
    fireEvent.click(screen.getByText('Post manual payment'))
    await waitFor(() => {
      expect(saved().claims[claim.id].paid).toBe(claim.paid + 25)
      expect(Object.keys(saved().payments).length).toBe(Object.keys(base.payments).length + 1)
    })
    fireEvent.click(screen.getByText('Undo once'))
    await waitFor(() => {
      expect(saved().claims[claim.id]).toEqual(claim)
      expect(saved().payments).toEqual(base.payments)
    })
  })

  it('voiding a payment adds one reversal, prevents double void, and Undo restores the paid claim', async () => {
    const base = blankState()
    const claim = Object.values(base.claims).find((c) => c.status === 'paid' && base.payments[`pay-${c.id}`])
    const paymentId = `pay-${claim.id}`
    const results = []
    localStorage.setItem(KEY, JSON.stringify(base))
    render(<StoreProvider><VoidProbe paymentId={paymentId} onResult={(r) => results.push(r)} /></StoreProvider>)
    fireEvent.click(screen.getByText('Void payment'))
    await waitFor(() => {
      expect(saved().claims[claim.id].status).toBe('submitted')
      expect(saved().claims[claim.id].paid).toBe(0)
      expect(Object.values(saved().payments).filter((p) => p.reversalOf === paymentId)).toHaveLength(1)
    })
    fireEvent.click(screen.getByText('Void payment'))
    expect(results.map((r) => r.ok)).toEqual([true, false])
    expect(Object.values(saved().payments).filter((p) => p.reversalOf === paymentId)).toHaveLength(1)
    fireEvent.click(screen.getByText('Undo once'))
    await waitFor(() => {
      expect(saved().claims[claim.id]).toEqual(claim)
      expect(saved().payments).toEqual(base.payments)
    })
  })

  it('a self-pay claim, its invoice and invoice sequence undo together', async () => {
    const base = blankState()
    const appt = stagedAppts(base).find((a) => base.clients.find((c) => c.id === a.clientIds?.[0])?.insurer === 'Self-pay')
    expect(appt).toBeTruthy()
    localStorage.setItem(KEY, JSON.stringify(base))
    render(<StoreProvider><InvoiceProbe apptId={appt.id} /></StoreProvider>)
    fireEvent.click(screen.getByText('Assemble self-pay claim'))
    await waitFor(() => {
      expect(Object.keys(saved().invoices).length).toBe(1)
      expect(saved().settings.billing.invoiceSeq).toBe(base.settings.billing.invoiceSeq + 1)
      expect(saved().appts[appt.id].claimId).toBeTruthy()
    })
    fireEvent.click(screen.getByText('Undo once'))
    await waitFor(() => {
      expect(saved().invoices).toEqual(base.invoices)
      expect(saved().settings.billing.invoiceSeq).toBe(base.settings.billing.invoiceSeq)
      expect(saved().appts[appt.id]).toEqual(appt)
    })
  })
})
