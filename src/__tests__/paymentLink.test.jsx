import React from 'react'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within, waitFor } from '@testing-library/react'
import App from '../App'
import { blankState } from '../state/store'
import { paymentLinkFor, integrationsCfg, DEFAULT_INTEGRATIONS } from '../lib/settingsMasters'
import { planStatement, planStatementVoid, statementView } from '../lib/statements'

const KEY = 'aloha-aba.v3'
const saved = () => JSON.parse(localStorage.getItem(KEY))
beforeEach(() => localStorage.clear())
afterEach(() => cleanup())

const BASE = blankState()
const PAY = 'https://buy.stripe.com/test_aloha'
const CID = BASE.clients[0].id
const SP = { id: 'sp1', no: 'CLM-SP-1', clientId: CID, payer: 'Self-pay', mode: 'selfpay', charges: 120, paid: 0, adj: 0, patientPaid: 0,
  status: 'submitted', dosFrom: '2026-09-02', dosTo: '2026-09-02', history: [], createdAt: 1, units: 8,
  lines: [{ apptId: 'sp-appt', dos: '2026-09-02', code: '97153', units: 8, rate: 15, charge: 120, kind: 'session', t0: 540, t1: 660 }] }
// An older workspace saved its integration list before the payment-link row existed.
const OLD_ROWS = DEFAULT_INTEGRATIONS.filter((r) => r.id !== 'int-paylink')
const withLink = (payUrl = PAY, status = 'local-export') => ({
  ...BASE,
  claims: { ...BASE.claims, sp1: SP },
  settings: { ...BASE.settings, clinicalIntegrations: [...OLD_ROWS, { ...DEFAULT_INTEGRATIONS.find((r) => r.id === 'int-paylink'), payUrl, status }] },
})
const payLink = (S, st) => statementView(S, st).payLink

describe('online payment link', () => {
  it('an older saved integration list still offers the payment-link row', () => {
    const rows = integrationsCfg({ ...BASE.settings, clinicalIntegrations: OLD_ROWS })
    expect(rows.map((r) => r.id)).toContain('int-paylink')
    expect(rows.length).toBe(OLD_ROWS.length + 1)
  })

  it('prints on a statement with a balance, not on a void one, and not when off or unset', () => {
    const S = withLink()
    expect(paymentLinkFor(S.settings)).toBe(PAY)
    const st = planStatement(S, CID, { id: 's1' }).item
    expect(payLink(S, st)).toBe(PAY)
    const voided = planStatementVoid({ ...S, statements: { s1: st } }, 's1', { reason: 'Issued in error' }).item
    expect(payLink(S, voided)).toBe('')
    expect(payLink(withLink(PAY, 'off'), st)).toBe('')
    expect(payLink(withLink(''), st)).toBe('')
  })

  it('Settings saves the link, refuses a non-https one, and shows no API key field for it', async () => {
    localStorage.setItem(KEY, JSON.stringify(BASE))
    render(<App />)
    fireEvent.click(await screen.findByTestId('nav-settings'))
    await screen.findByTestId('settings-page')
    fireEvent.click(within(screen.getByRole('group', { name: 'Settings lists' })).getByRole('button', { name: 'Clinical Integrations', exact: true }))
    fireEvent.click(await screen.findByTestId('set-integration-int-paylink'))
    expect(screen.queryByTestId('set-integration-apikey')).toBeNull()
    const input = screen.getByTestId('set-integration-paylink')
    fireEvent.change(input, { target: { value: 'buy.stripe.com/x' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(await screen.findByText('Enter the link as a full https:// address.')).toBeTruthy()
    fireEvent.change(input, { target: { value: PAY } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(saved().settings.clinicalIntegrations.find((r) => r.id === 'int-paylink').payUrl).toBe(PAY))
  })
})
