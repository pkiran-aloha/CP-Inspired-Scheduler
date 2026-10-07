import React from 'react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import App from '../App'
import { blankState } from '../state/store'
import { buildSpec, specToPdf, toBlob, pdfSafe } from '../lib/exportKit'
import { docToPdf } from '../lib/intakeDocs'

const latin1 = (doc) => Buffer.from(doc.output('arraybuffer')).toString('latin1')

beforeEach(() => {
  localStorage.clear()
  window.URL.createObjectURL = vi.fn(() => 'blob:pdf-test')
  window.URL.revokeObjectURL = vi.fn()
})
afterEach(() => cleanup())

describe('PDF exports — encoding and download', () => {
  it('a jsPDF document handed to the download helper becomes real PDF bytes, not "[object Object]"', () => {
    const doc = specToPdf(buildSpec({ def: { name: 'Register' }, columns: [{ k: 'a', label: 'A' }], rows: [{ a: 'x' }] }))
    const blob = toBlob(doc, 'application/pdf')
    expect(blob.type).toBe('application/pdf')
    expect(blob.size).toBe(doc.output('arraybuffer').byteLength)
  })

  it('maps glyphs the WinAnsi fonts cannot draw and keeps the ones they can', () => {
    expect(pdfSafe('2026-07-14 → 2026-07-28')).toBe('2026-07-14 -> 2026-07-28')
    expect(pdfSafe('Bergström · Mother — Dr. Ford’s ≤ 5 − 1 \u{1F600}')).toBe('Bergström · Mother — Dr. Ford’s <= 5 - 1 ')
  })

  it('a statement-style row with an arrow prints as plain text, never as UTF-16', () => {
    const raw = latin1(docToPdf({ title: 'Statement', sections: [{ heading: 'Services', rows: [{ label: 'CLM-1 · 2026-07-14 → 2026-07-28', value: 'Medicaid · your share $54.00' }] }] }))
    expect(raw.includes('þÿ')).toBe(false) // the UTF-16 byte-order mark jsPDF writes for unsupported text
    expect(raw.includes('2026-07-14 -> 2026-07-28')).toBe(true)
  })

  it('only continuation pages are labelled "continued"', () => {
    const rows = Array.from({ length: 80 }, (_, i) => ({ a: `row ${i}` }))
    const doc = specToPdf(buildSpec({ def: { name: 'Long' }, columns: [{ k: 'a', label: 'A' }], rows }))
    expect(doc.getNumberOfPages()).toBeGreaterThan(1)
    expect((latin1(doc).match(/continued/g) || []).length).toBe(doc.getNumberOfPages() - 1)
  })
})

describe('PDF exports — payroll summary download', () => {
  it('downloads a real PDF document', async () => {
    const state = blankState()
    state.ui = { ...state.ui, section: 'pay-summary', nav: false }
    localStorage.setItem('aloha-aba.v3', JSON.stringify(state))
    render(<App />)
    fireEvent.click(screen.getByTestId('pay-sum-generate'))
    fireEvent.click(screen.getByTestId('pay-sum-pdf'))
    await waitFor(() => expect(window.URL.createObjectURL).toHaveBeenCalledTimes(1)) // PDF engine loads async
    const blob = window.URL.createObjectURL.mock.calls[0][0]
    expect(blob.type).toBe('application/pdf')
    expect(blob.size).toBeGreaterThan(1000)
  })
})
