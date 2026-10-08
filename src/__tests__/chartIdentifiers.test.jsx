// Architecture mismatch #10: claims carry only the chart's member ID, diagnosis and
// authorization number. A gap holds the draft and the CMS-1500 export refuses it.
import React from 'react'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import App from '../App'
import { blankState } from '../state/store'
import { claimGate } from '../lib/claims'

const KEY = 'aloha-aba.v3'
const stored = () => JSON.parse(localStorage.getItem(KEY) || '{}')

const BASE = blankState()
const DRAFT = Object.values(BASE.claims).find((c) => c.status === 'draft' && c.mode === 'insurance' && c.method !== 'secondary' && claimGate(BASE, c).ok)
const GAPS = { ...BASE, clients: BASE.clients.map((c) => (c.id === DRAFT.clientId ? { ...c, memberId: '', dxCodes: [] } : c)) }

beforeEach(() => { localStorage.clear(); cleanup() })
afterEach(() => { cleanup(); localStorage.clear() })

describe('chart identifiers on claims', () => {
  it('the demo seed charts a member ID, ICD-10 codes and an auth number for insured clients', () => {
    const insured = BASE.clients.filter((c) => c.insurer && c.insurer !== 'Self-pay')
    expect(insured.length).toBeGreaterThan(0)
    for (const c of insured) {
      expect(c.memberId).toMatch(/^[A-Z]{2,3}-\d{7}$/)
      expect(c.authNo).toMatch(/^PA-26-\d{4}$/)
      expect(c.dxCodes[0]).toMatch(/^F\d\d/)
    }
    expect(DRAFT).toBeTruthy()
  })

  it('a draft whose client lacks a member ID and diagnosis is held, the CMS-1500 refuses, and filling the chart clears it', async () => {
    localStorage.setItem(KEY, JSON.stringify(GAPS))
    render(<App />)
    fireEvent.click(screen.getByTestId('nav-billing'))
    fireEvent.click(await screen.findByTestId('bil-tab-claims'))
    fireEvent.click(screen.getByTestId('clm-filter-draft'))
    const row = await waitFor(() => {
      const r = [...document.querySelectorAll('[data-testid^="clm-row-"]')].find((el) => el.textContent.includes(DRAFT.no))
      if (!r) throw new Error('draft not listed')
      return r
    })
    fireEvent.click(row)
    await waitFor(() => expect(screen.getByTestId('clm-banner').textContent).toMatch(/Submission held:.*Needs member ID.*Needs diagnosis/))
    expect(screen.getByTestId('clm-member').textContent).toBe('Needs member ID')

    fireEvent.click(screen.getByTestId('clm-cms1500'))
    await waitFor(() => expect(document.body.textContent).toMatch(new RegExp(`${DRAFT.no} cannot print on a CMS-1500 yet`)), { timeout: 5000 })
    expect(stored().claims[DRAFT.id].status).toBe('draft')

    // fill the chart in the client editor
    fireEvent.click(screen.getByTestId('nav-clients'))
    fireEvent.click(screen.getByTestId('cli-mode-table'))
    await screen.findByTestId('clients-table')
    fireEvent.click(screen.getByTestId(`cli-row-${DRAFT.clientId}`))
    fireEvent.click(await screen.findByTestId(`cli-edit-${DRAFT.clientId}`))
    fireEvent.change(screen.getByTestId('cm-dxCodes'), { target: { value: 'autism' } })
    expect(screen.getByText(/AUTISM is not an ICD-10 code/)).toBeTruthy()
    fireEvent.change(screen.getByTestId('cm-memberId'), { target: { value: 'AE-7710223' } })
    fireEvent.change(screen.getByTestId('cm-dxCodes'), { target: { value: 'f84.0, R41.82' } })
    fireEvent.click(screen.getByTestId('cm-save'))
    await waitFor(() => expect(stored().clients.find((c) => c.id === DRAFT.clientId)).toMatchObject({ memberId: 'AE-7710223', dxCodes: ['F84.0', 'R41.82'] }))
    expect(claimGate(stored(), stored().claims[DRAFT.id]).ok).toBe(true)
  })
})
