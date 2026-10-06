import React from 'react'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import App from '../App'
import { blankState } from '../state/store'
import { superbillView, superbillPdf, superbillClaims } from '../lib/superbill'
import { addDays, isoDate, parseISO, todayISO } from '../lib/date'

beforeEach(() => {
  localStorage.clear()
  window.URL.createObjectURL = vi.fn(() => 'blob:superbill-test')
  window.URL.revokeObjectURL = vi.fn()
})
afterEach(() => cleanup())

// One self-pay claim, dated a few days ago so the screen's default range (last 4 weeks) holds it.
const BASE = blankState()
const CLIENT = BASE.clients[0]
const DOS = isoDate(addDays(parseISO(todayISO()), -3))
const APPT = Object.values(BASE.appts).find((a) => a.staffIds?.length)
const SP = { id: 'sp1', no: 'CLM-SP-1', clientId: CLIENT.id, payer: 'Self-pay', mode: 'selfpay', charges: 120, paid: 50, adj: 0, patientPaid: 0,
  status: 'partially_paid', dosFrom: DOS, dosTo: DOS, history: [], createdAt: 1,
  lines: [{ apptId: APPT.id, dos: DOS, code: '97153', mod: 'HM', units: 8, rate: 15, charge: 120, kind: 'session' }] }
const WITH_SP = { ...BASE, claims: { ...BASE.claims, sp1: SP } }
const RANGE = { from: isoDate(addDays(parseISO(todayISO()), -28)), to: todayISO() }

describe('superbill: what it lists', () => {
  it('lists only self-pay services in the range, with provider, patient, subscriber, diagnosis and line detail', () => {
    const v = superbillView(WITH_SP, CLIENT.id, RANGE)
    expect(v.ok).toBe(true)
    const line = v.lines.find((l) => l.dos === DOS && l.code === '97153')
    expect(line).toMatchObject({ mods: 'HM', units: 8, ptr: 'A', charge: 120 })
    expect(v.provider).toMatchObject({ name: BASE.settings.org.name, taxId: BASE.settings.org.taxId })
    expect(v.provider.npi).toMatch(/^\d{10}$/)
    expect(v.patient.name).toBe(CLIENT.name)
    expect(v.subscriber).toMatchObject({ name: CLIENT.guardian, relation: 'Child' })
    expect(v.diagnoses[0]).toBe('F84.0')
    expect(v.renderers[0].npi).toMatch(/^\d{10}$/)
    expect(v.totals.balance).toBe(Math.round((v.totals.charges - v.totals.paid) * 100) / 100)
  })

  it('never lists services already billed to an insurer, and says so when nothing is left', () => {
    expect(superbillClaims(WITH_SP, CLIENT.id, RANGE).every((c) => c.mode === 'selfpay')).toBe(true)
    const r = superbillView(BASE, CLIENT.id, { from: '2000-01-01', to: '2000-01-31' })
    expect(r.ok).toBe(false)
    expect(r.msg).toMatch(/no self-pay services/)
  })

  it('prints a real plan and member ID only, never a made-up one', () => {
    const selfPayClient = { ...WITH_SP, clients: WITH_SP.clients.map((c) => (c.id === CLIENT.id ? { ...c, insurer: 'Self-pay', memberId: '' } : c)) }
    expect(superbillView(selfPayClient, CLIENT.id, RANGE).subscriber).toMatchObject({ plan: '', memberId: '' })
  })

  it('renders a PDF that says it is not a bill', () => {
    const raw = Buffer.from(superbillPdf(WITH_SP, CLIENT.id, RANGE).output('arraybuffer')).toString('latin1')
    expect(raw.startsWith('%PDF-')).toBe(true)
    expect(raw).toContain('This is not a bill.')
  })
})

describe('superbill: Generate Invoice screen', () => {
  it('offers Superbill for a client with self-pay services and downloads a PDF', () => {
    const state = { ...WITH_SP, ui: { ...WITH_SP.ui, section: 'bil-invoice', nav: false } }
    localStorage.setItem('aloha-aba.v3', JSON.stringify(state))
    render(<App />)
    fireEvent.click(screen.getByTestId(`gi-client-${CLIENT.id}`))
    fireEvent.click(screen.getByTestId(`gi-superbill-${CLIENT.id}`))
    expect(window.URL.createObjectURL).toHaveBeenCalledTimes(1)
    const blob = window.URL.createObjectURL.mock.calls[0][0]
    expect(blob.type).toBe('application/pdf')
    expect(screen.getByText(/Superbill for .* downloaded/)).toBeTruthy()
  })
})
