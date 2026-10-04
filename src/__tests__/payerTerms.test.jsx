import React from 'react'
import { beforeEach, afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import App from '../App'
import { blankState, StoreProvider, useStore } from '../state/store'
import { payerPolicy, filingDaysOf, planPayerTerms, copayOf, agingOf, quickPosts, PAYER_POLICY } from '../lib/claims'
import { cms1500Data } from '../lib/cms1500'
import { addDays, isoDate } from '../lib/date'

const KEY = 'aloha-aba.v3'
const saved = () => JSON.parse(localStorage.getItem(KEY))
beforeEach(() => { localStorage.clear(); cleanup() })
afterEach(() => cleanup())

const BASE = blankState()
const withPayer = (name, policy, ext = {}) => ({
  ...BASE,
  payers: BASE.payers.map((p) => (p.name === name ? { ...p, policy: { ...p.policy, ...policy }, ext: { ...p.ext, ...ext } } : p)),
})
const aetnaId = BASE.payers.find((p) => p.name === 'Aetna').id
const input = (o = {}) => ({ kind: 'commercial', avgDays: '24', coinsPct: '80', copay: '25', filingDays: '', ...o })

describe('payer payment terms — engine', () => {
  it('payerPolicy reads the payer record when state is given, the constant otherwise', () => {
    const st = withPayer('Aetna', { copay: 40, avgDays: 10 })
    expect(payerPolicy('Aetna').copay).toBe(PAYER_POLICY.Aetna.copay)
    expect(payerPolicy('Aetna', st)).toMatchObject({ copay: 40, avgDays: 10 })
    expect(payerPolicy('Unknown Plan', st)).toMatchObject({ kind: 'commercial', avgDays: 25 })
  })

  it('filing days: payer record, then practice default, then policy', () => {
    expect(filingDaysOf(withPayer('Aetna', {}, { filingDeadlineDays: 45 }), 'Aetna')).toBe(45)
    const def = { ...BASE, settings: { ...BASE.settings, billing: { ...BASE.settings.billing, defaultFilingDays: 100 } } }
    expect(filingDaysOf(def, 'Aetna')).toBe(100)
    const none = { ...BASE, settings: { ...BASE.settings, billing: { ...BASE.settings.billing, defaultFilingDays: undefined } } }
    expect(filingDaysOf(none, 'Aetna')).toBe(PAYER_POLICY.Aetna.timely)
  })

  it('copay, aging, quick-post presets and CMS-1500 7b follow the payer record', () => {
    const claim = Object.values(BASE.claims).find((c) => c.mode === 'insurance' && BASE.payers.some((p) => p.name === c.payer))
    expect(claim).toBeTruthy()
    const st = withPayer(claim.payer, { copay: 7, coins: 0.5, avgDays: 1 }, { filingDeadlineDays: 33 })
    expect(copayOf(claim, null, st)).toBe(Math.min(7 * claim.lines.length, claim.charges))
    const aged = { ...claim, status: 'submitted', submittedAt: addDays(new Date(), -5).getTime() }
    expect(agingOf(aged, isoDate(new Date()), st).late).toBe(true) // 5 days > 1.6 × 1
    expect(quickPosts(st, claim, null).find((q) => q.id === 'contract').label).toBe('Estimate 50%')
    const box = (d, id) => d.boxes.find((b) => b.id === id)
    expect(box(cms1500Data(st, claim), '7b').value[0]).toBe('33')
  })

  it('planPayerTerms validates and builds one patch', () => {
    const ok = planPayerTerms(BASE, aetnaId, input({ coinsPct: '72.5', copay: '12.50', filingDays: '60' }))
    expect(ok.ok).toBe(true)
    expect(ok.payer.policy).toMatchObject({ kind: 'commercial', avgDays: 24, coins: 0.725, copay: 12.5 })
    expect(ok.payer.ext.filingDeadlineDays).toBe(60)
    expect(planPayerTerms(BASE, aetnaId, input()).payer.ext.filingDeadlineDays).toBeNull()
    for (const bad of [{ kind: 'x' }, { avgDays: '0' }, { avgDays: '2.5' }, { coinsPct: '101' }, { coinsPct: '50.123' }, { copay: '-1' }, { copay: '1.005' }, { copay: 'abc' }, { filingDays: '0' }, { filingDays: '1000' }]) {
      expect(planPayerTerms(BASE, aetnaId, input(bad)).ok).toBe(false)
    }
    expect(planPayerTerms(BASE, 'nope', input()).ok).toBe(false)
  })
})

function TermsProbe({ onResult }) {
  const { actions } = useStore()
  return <>
    <button onClick={() => onResult(actions.setPayerTerms(aetnaId, input({ copay: '9' })))}>Save terms</button>
    <button onClick={() => onResult(actions.setPayerTerms(aetnaId, input({ copay: 'abc' })))}>Save bad terms</button>
    <button onClick={() => actions.undo()}>Undo once</button>
  </>
}

describe('payer payment terms — store', () => {
  it('saves in one action, refuses invalid input, and one Undo restores', async () => {
    localStorage.setItem(KEY, JSON.stringify(BASE))
    const results = []
    render(<StoreProvider><TermsProbe onResult={(r) => results.push(r)} /></StoreProvider>)
    const copay = () => saved()?.payers.find((p) => p.id === aetnaId).policy.copay
    fireEvent.click(screen.getByText('Save bad terms'))
    expect(results[0].ok).toBe(false)
    fireEvent.click(screen.getByText('Save terms'))
    expect(results[1].ok).toBe(true)
    await waitFor(() => expect(copay()).toBe(9))
    fireEvent.click(screen.getByText('Undo once'))
    await waitFor(() => expect(copay()).toBe(PAYER_POLICY.Aetna.copay))
  })
})

describe('payer payment terms — UI', () => {
  it('Billing Rules → Payment Terms edits persist to the payer record', async () => {
    localStorage.setItem(KEY, JSON.stringify(BASE))
    render(<App />)
    fireEvent.click(screen.getByTestId('nav-collapse'))
    fireEvent.click(screen.getByTestId('nav-masters'))
    const tabPayers = screen.queryByTestId('masters-tab-payers')
    if (tabPayers) fireEvent.click(tabPayers)
    fireEvent.click(await screen.findByTestId(`py-row-${aetnaId}`))
    fireEvent.click(await screen.findByTestId('pd-tab-rules'))
    fireEvent.click(await screen.findByTestId('pr-tab-terms'))
    await screen.findByTestId('pr-terms')
    expect(screen.getByTestId('terms-copay').value).toBe(String(PAYER_POLICY.Aetna.copay))
    fireEvent.change(screen.getByTestId('terms-copay'), { target: { value: '1.234' } })
    fireEvent.click(screen.getByTestId('pr-save'))
    expect(await screen.findByText(/at most 2 decimals/)).toBeTruthy()
    fireEvent.change(screen.getByTestId('terms-copay'), { target: { value: '15' } })
    fireEvent.change(screen.getByTestId('terms-filingDays'), { target: { value: '75' } })
    fireEvent.click(screen.getByTestId('pr-save'))
    await waitFor(() => {
      const p = saved().payers.find((x) => x.id === aetnaId)
      expect(p.policy.copay).toBe(15)
      expect(p.ext.filingDeadlineDays).toBe(75)
    })
  })
})
