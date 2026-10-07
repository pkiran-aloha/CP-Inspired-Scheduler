import React from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import App from '../App'
import { blankState } from '../state/store'
import { todayISO } from '../lib/date'

const KEY = 'aloha-aba.v3'

beforeEach(() => { localStorage.clear(); cleanup() })
afterEach(() => cleanup())

function workspaceWithMileage(code = '') {
  const base = blankState()
  const client = base.clients.find((c) => c.insurer && c.insurer !== 'Self-pay')
  const staff = base.staff[0]
  const appt = {
    id: 'test-mileage-appt',
    type: 'service',
    title: 'Mileage test session',
    date: todayISO(),
    start: 9 * 60,
    end: 10 * 60,
    status: 'completed',
    staffIds: [staff.id],
    clientIds: [client.id],
    service: 'dtt',
    location: 'Main Center',
    verification: { verifyStatus: 'verified' },
    billing: { code: '97153', units: 0, rate: 0, mileage: true, distance: 123.45, mileageRate: 0.7 },
  }
  const payers = base.payers.map((p) => p.name === client.insurer
    ? { ...p, rules: { ...p.rules, claims: { ...(p.rules?.claims || {}), mileageCode: code } } }
    : p)
  return {
    ...base,
    appts: { ...base.appts, [appt.id]: appt },
    payers,
    ui: { ...base.ui, section: 'billing' },
    history: [],
  }
}

describe('mileage code in the Billing staging queue', () => {
  it('shows that an insurance mileage code is missing instead of showing CPT 14220', async () => {
    localStorage.setItem(KEY, JSON.stringify(workspaceWithMileage()))
    render(<App />)
    const miles = await screen.findByText('123.45 mi')
    const row = miles.closest('[data-testid^="bil-row-"]')
    expect(row.textContent).toContain('Needs code')
    expect(row.textContent).not.toContain('14220')
  })

  it('shows the configured payer code on the mileage line', async () => {
    localStorage.setItem(KEY, JSON.stringify(workspaceWithMileage('X1234')))
    render(<App />)
    const miles = await screen.findByText('123.45 mi')
    expect(miles.closest('[data-testid^="bil-row-"]').textContent).toContain('X1234')
  })
})
