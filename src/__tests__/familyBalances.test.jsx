import React from 'react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import App from '../App'
import { blankState, reducer } from '../state/store'
import { dueOf, patientResponsibilityOf, secondaryEligible } from '../lib/claims'
import { statementLines } from '../lib/statements'

const KEY = 'aloha-aba.v3'
const saved = () => JSON.parse(localStorage.getItem(KEY))
beforeEach(() => {
  localStorage.clear()
  window.URL.createObjectURL = vi.fn(() => 'blob:family-test')
  window.URL.revokeObjectURL = vi.fn()
})
afterEach(() => cleanup())

const BASE = blankState()
// families owing a coinsurance share on an insurance claim; an open self-pay invoice also
// owes, and whether one is open depends on today's weekday, so it is not counted here
const owing = (state) => state.clients.filter((c) => statementLines(state, c.id).some((l) => state.claims[l.claimId].mode === 'insurance'))

describe('demo family balances', () => {
  it('three families owe a payer-reported coinsurance share; the COB clients are left alone', () => {
    const fams = owing(BASE)
    expect(fams).toHaveLength(3)
    expect(fams.every((c) => !c.secondary)).toBe(true)
    const shared = Object.values(BASE.claims).filter((c) => c.remittance?.patientResp)
    expect(shared).toHaveLength(3)
    for (const c of shared) {
      expect(c.status).toBe('partially_paid')
      expect(dueOf(c)).toBe(c.remittance.patientResp)
      expect(patientResponsibilityOf(BASE, c)).toBe(c.remittance.patientResp)
      expect(BASE.payments[`pay-${c.id}`]).toMatchObject({ amount: c.paid, patientResp: c.remittance.patientResp })
      expect(secondaryEligible(BASE, c)).toBe(false)
    }
  })

  it('Demo data reset seeds the balances again', () => {
    expect(owing(reducer(BASE, { type: 'reseed' }))).toHaveLength(3)
  })

  it('Generate Invoice can issue a statement for a demo family straight away', async () => {
    const fam = owing(BASE)[0]
    localStorage.setItem(KEY, JSON.stringify({ ...BASE, ui: { ...BASE.ui, section: 'bil-invoice', invPrefill: { clientIds: [fam.id] } } }))
    render(<App />)
    fireEvent.click(await screen.findByTestId(`gi-issue-${fam.id}`))
    await waitFor(() => expect(Object.values(saved().statements)).toHaveLength(1))
    expect(Object.values(saved().statements)[0]).toMatchObject({ clientId: fam.id, status: 'issued' })
  })
})
