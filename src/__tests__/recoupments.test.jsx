import React from 'react'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import App from '../App'
import { blankState, reducer } from '../state/store'
import { planRecoupment } from '../lib/paymentLedger'
import { dueOf } from '../lib/claims'
import { todayISO } from '../lib/date'

const KEY = 'aloha-aba.v3'
const stored = () => { try { return JSON.parse(localStorage.getItem(KEY)) } catch { return null } }
beforeEach(() => { localStorage.clear(); cleanup() })
afterEach(() => cleanup())

// one seed for the whole file: appointment and claim ids are generated per seed
const BASE = blankState()
const paidPrimary = (s) => Object.values(s.claims).find((c) => c.mode !== 'selfpay' && c.method !== 'secondary' && c.status !== 'void' && c.paid > 0 &&
  !(c.secondary && s.claims[c.secondary] && s.claims[c.secondary].status !== 'void'))
const today = todayISO()
const good = { amount: '25.00', date: today, reason: 'overpayment', method: 'offset', ref: 'PLB-WO-1' }

describe('recoupments: a payer takes money back', () => {
  it('reduces what the payer paid, reopens the balance and writes a negative ledger line', () => {
    const c = paidPrimary(BASE)
    const plan = planRecoupment(BASE, c.id, good, { at: Date.now(), paymentId: 'r1' })
    expect(plan.ok).toBe(true)
    const updated = plan.claimUpserts[0]
    expect(updated.paid).toBe(Math.round((c.paid - 25) * 100) / 100)
    expect(updated.recouped).toBe(25)
    expect(dueOf(updated)).toBeCloseTo(dueOf(c) + 25, 2)
    expect(updated.status).toBe('partially_paid')
    expect(updated.history.at(-1).ev).toMatch(/Recouped by .* \$25\.00 .*PLB-WO-1/)
    expect(plan.payments.r1).toMatchObject({ kind: 'recoupment', claimId: c.id, amount: -25, ref: 'PLB-WO-1', reason: 'overpayment', method: 'offset' })
  })

  it('refuses what would corrupt the ledger, and says how to fix it', () => {
    const c = paidPrimary(BASE)
    const plan = (o) => planRecoupment(BASE, c.id, { ...good, ...o }, { at: Date.now(), paymentId: 'r1' })
    expect(plan({ amount: String(c.paid + 1) }).msg).toMatch(/cannot exceed/)
    expect(plan({ amount: '0' }).ok).toBe(false)
    expect(plan({ amount: '1.234' }).ok).toBe(false)
    expect(plan({ ref: '' }).msg).toMatch(/payer’s reference/)
    expect(plan({ date: '2999-01-01' }).msg).toMatch(/future/)
    expect(plan({ reason: 'nope' }).ok).toBe(false)
    expect(plan({ method: 'nope' }).ok).toBe(false)
    const selfpay = Object.values(BASE.claims).find((x) => x.mode === 'selfpay')
    if (selfpay) expect(planRecoupment(BASE, selfpay.id, good, { paymentId: 'r2' }).msg).toMatch(/Self-pay/)
  })

  it('is one Undo step through the reducer', () => {
    const c = paidPrimary(BASE)
    const s = { ...BASE, history: [] }
    const after = reducer(s, { type: 'claimRecoupTx', id: c.id, payload: good, options: { at: Date.now(), paymentId: 'rX' } })
    expect(after.claims[c.id].recouped).toBe(25)
    expect(after.payments.rX.amount).toBe(-25)
    const undone = reducer(after, { type: 'undo' })
    expect(undone.claims[c.id].paid).toBe(c.paid)
    expect(undone.payments.rX).toBeUndefined()
  })

  it('is recorded from Payment Center and shows as a red take-back', async () => {
    localStorage.setItem(KEY, JSON.stringify({ ...BASE, ui: { ...BASE.ui, section: 'bil-payments' }, history: [] }))
    render(<App />)
    fireEvent.click(await screen.findByTestId('pc-open-recoup'))
    const claimId = screen.getByTestId('pc-recoup-claim').value
    fireEvent.change(screen.getByTestId('pc-recoup-amount'), { target: { value: '40' } })
    fireEvent.click(screen.getByTestId('pc-recoup-save'))
    expect((await screen.findByTestId('pc-recoup-error')).textContent).toMatch(/reference/)
    fireEvent.change(screen.getByTestId('pc-recoup-ref'), { target: { value: 'REFUND-LTR-88' } })
    fireEvent.click(screen.getByTestId('pc-recoup-save'))
    await waitFor(() => expect(stored().claims[claimId].recouped).toBe(40))
    const entry = Object.values(stored().payments).find((p) => p.kind === 'recoupment')
    expect(entry).toMatchObject({ claimId, amount: -40, ref: 'REFUND-LTR-88' })
    fireEvent.click(screen.getByTestId('pc-filter-recoupment'))
    expect((await screen.findByTestId(`pc-pay-row-${entry.id}`)).textContent).toMatch(/Recoupment/)
  })
})
