import React from 'react'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import App from '../App'
import { blankState } from '../state/store'
import { CONSENT_KINDS, INTAKE_DOCS, fullName } from '../lib/intake'
import { intakeSummaryDoc, intakePacketDoc, docToPdf } from '../lib/intakeDocs'

const BASE = blankState()
const open = Object.values(BASE.intakeRequests).filter((r) => !['converted', 'closed'].includes(r.stage))
const REQ = open.find((r) => r.memberId && r.payerId) || open[0]
const rowsOf = (doc, heading) => doc.sections.find((s) => s.heading === heading).rows
const valueOf = (doc, heading, label) => rowsOf(doc, heading).find((r) => r.label === label)?.value

beforeEach(() => {
  localStorage.clear()
  window.URL.createObjectURL = vi.fn(() => 'blob:intake-test')
  window.URL.revokeObjectURL = vi.fn()
})
afterEach(() => cleanup())

describe('intake documents — content', () => {
  it('the summary carries the request as recorded, with a dash for anything blank', () => {
    const doc = intakeSummaryDoc(BASE, REQ)
    expect(doc.title).toContain(fullName(REQ))
    expect(doc.note).toMatch(/Nothing was sent/)
    expect(valueOf(doc, 'Insurance and benefits', 'Member ID')).toBe(REQ.memberId || '—')
    expect(valueOf(doc, 'Insurance and benefits', 'Payer')).toBe(BASE.payers.find((p) => p.id === REQ.payerId)?.name || '—')
    expect(rowsOf(doc, 'Documents')).toHaveLength(INTAKE_DOCS.length)
    expect(rowsOf(doc, 'Consents').map((r) => r.value).every((x) => x === 'Signed' || x === 'Not signed')).toBe(true)
    const empty = intakeSummaryDoc(BASE, { ...REQ, memberId: '', allergies: '' })
    expect(valueOf(empty, 'Insurance and benefits', 'Member ID')).toBe('—')
    expect(valueOf(empty, 'Clinical', 'Allergies')).toBe('—')
  })

  it('the blank packet has fill-in fields, the documents to bring and every consent to sign', () => {
    const doc = intakePacketDoc(BASE)
    expect(doc.title).toContain(BASE.settings.org.name)
    expect(rowsOf(doc, 'About the child').every((r) => r.value === null)).toBe(true)
    expect(rowsOf(doc, 'Consents').map((r) => r.label)).toEqual(CONSENT_KINDS.map((c) => c.label))
    expect(doc.sections.find((s) => s.heading === 'Documents to bring').kind).toBe('checklist')
  })

  it('both render as real PDF documents', () => {
    for (const doc of [intakeSummaryDoc(BASE, REQ), intakePacketDoc(BASE)]) {
      const bytes = new Uint8Array(docToPdf(doc).output('arraybuffer'))
      expect(String.fromCharCode(...bytes.slice(0, 5))).toBe('%PDF-')
    }
  })
})

describe('intake documents — downloads', () => {
  it('the worklist downloads the blank packet and the drawer downloads a request summary', async () => {
    localStorage.setItem('aloha-aba.v3', JSON.stringify(BASE))
    render(<App />)
    fireEvent.click(screen.getByTestId('nav-clients'))
    fireEvent.click(await screen.findByTestId('nav-sub-intake'))
    fireEvent.click(await screen.findByTestId('iq-dl-packet'))
    expect(await screen.findByText(/Blank intake packet downloaded/)).toBeTruthy()
    expect(window.URL.createObjectURL).toHaveBeenCalledTimes(1)
    expect(window.URL.createObjectURL.mock.calls[0][0].type).toBe('application/pdf')

    fireEvent.change(screen.getByTestId('iq-search'), { target: { value: REQ.no } })
    fireEvent.click(screen.getByTestId('iq-mode-list'))
    fireEvent.click(await screen.findByTestId(`iq-open-${REQ.id}`))
    const drawer = await screen.findByTestId('iq-drawer')
    fireEvent.click(within(drawer).getByTestId('iq-dl-summary'))
    expect(await screen.findByText(new RegExp(`${REQ.no} summary downloaded`))).toBeTruthy()
    expect(window.URL.createObjectURL).toHaveBeenCalledTimes(2)
  })
})
