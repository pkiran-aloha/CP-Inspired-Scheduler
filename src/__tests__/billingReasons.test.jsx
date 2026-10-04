import React from 'react'
import { beforeEach, afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import App from '../App'
import { DENIAL_REASONS, CARC_HINTS, planReasonLists, denialOf, denyPatch } from '../lib/claims'
import { eraDenialInfo } from '../lib/eraPosting'

const KEY = 'aloha-aba.v3'
const stored = () => JSON.parse(localStorage.getItem(KEY))
beforeEach(() => { localStorage.clear(); cleanup() })
afterEach(() => cleanup())

const withBilling = (billing) => ({ settings: { billing } })
const line = (reason) => ({ adjustments: [{ group: 'CO', reason, amount: 10 }] })

describe('denial reasons and remittance hints — engine', () => {
  it('defaults stand until the practice saves its own lists', () => {
    expect(denialOf('timely').id).toBe('timely')
    expect(eraDenialInfo(line('151')).reason).toBe(CARC_HINTS.find((h) => h.code === 'CO-151').label)
    const st = withBilling({ denialReasons: [{ id: 'cred', label: 'Rendering provider not credentialed', fix: 'Finish payer enrollment, then rebill' }], carcHints: [{ code: 'CO-151', label: 'Units over the plan limit', fix: 'Check MUEs' }] })
    expect(denialOf('anything', st).label).toBe('Rendering provider not credentialed')
    expect(denyPatch({ history: [] }, { code: 'cred' }, st).claim.denial.fix).toBe('Finish payer enrollment, then rebill')
    expect(eraDenialInfo(line('151'), st)).toMatchObject({ code: 'carc:CO-151', reason: 'Units over the plan limit', fix: 'Check MUEs' })
    expect(eraDenialInfo(line('197'), withBilling({ carcHints: [] })).reason).toBe('Payer denial CO-197')
  })

  it('planReasonLists cleans and refuses bad lists', () => {
    const ok = planReasonLists({ denialReasons: [{ label: '  Wrong   member ID ', fix: 'Fix and rebill' }], carcHints: [{ code: 'co-16 ', label: 'Missing info' }] })
    expect(ok.ok).toBe(true)
    expect(ok.denialReasons[0]).toEqual({ id: 'wrong-member-id', label: 'Wrong member ID', fix: 'Fix and rebill' })
    expect(ok.carcHints[0].code).toBe('CO-16')
    expect(planReasonLists({ denialReasons: [], carcHints: [] }).ok).toBe(false)
    expect(planReasonLists({ denialReasons: [{ label: 'ab' }] }).ok).toBe(false)
    expect(planReasonLists({ denialReasons: [{ label: 'Same one' }, { label: 'same ONE' }] }).ok).toBe(false)
    expect(planReasonLists({ denialReasons: DENIAL_REASONS, carcHints: [{ code: '197', label: 'No group' }] }).ok).toBe(false)
    expect(planReasonLists({ denialReasons: DENIAL_REASONS, carcHints: [{ code: 'CO-4', label: 'x' }] }).ok).toBe(false)
  })
})

describe('Settings → Billing Settings: reasons and hints', () => {
  it('refuses an invalid list, then saves an added reason', async () => {
    render(<App />)
    fireEvent.click(await screen.findByTestId('nav-settings'))
    fireEvent.click(await screen.findByTestId('nav-sub-set-system'))
    fireEvent.click(await screen.findByTestId('set-sys-tab-billing'))
    await screen.findByTestId('set-bill-reasons')
    const first = screen.getByTestId('set-den-label-0')
    const original = first.value
    fireEvent.change(first, { target: { value: 'ab' } })
    fireEvent.click(screen.getByTestId('set-bill-reasons-save'))
    expect(await screen.findByText(/at least 3 characters/)).toBeTruthy()
    fireEvent.change(first, { target: { value: original } })
    fireEvent.click(screen.getByTestId('set-den-add'))
    const n = DENIAL_REASONS.length
    fireEvent.change(screen.getByTestId(`set-den-label-${n}`), { target: { value: 'Rendering provider not credentialed' } })
    fireEvent.change(screen.getByTestId(`set-den-fix-${n}`), { target: { value: 'Finish payer enrollment, then rebill' } })
    fireEvent.click(screen.getByTestId('set-bill-reasons-save'))
    await waitFor(() => {
      const list = stored().settings.billing.denialReasons
      expect(list).toHaveLength(n + 1)
      expect(list[n]).toMatchObject({ id: 'rendering-provider-not-credentialed', label: 'Rendering provider not credentialed' })
    })
    expect(stored().settings.billing.carcHints).toHaveLength(CARC_HINTS.length)
  })
})
