import React from 'react'
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { blankState, StoreProvider } from '../state/store'
import { ToastProvider } from '../ui/Toast'
import AppealsView from '../components/AppealsView'
import ArManagerView from '../components/ArManagerView'
import BillingView from '../components/BillingView'
import GenerateInvoiceView from '../components/GenerateInvoiceView'
import VerificationFormsView from '../components/VerificationFormsView'

// jsdom cannot lay out, so this pins the hooks the narrow-width CSS relies on: each list + detail
// split carries .bil-split (its inline px columns stack under 1100px), and the rules exist.
const KEY = 'aloha-aba.v3'
beforeEach(() => { localStorage.clear(); localStorage.setItem(KEY, JSON.stringify(blankState())) })
afterEach(() => cleanup())

const css = readFileSync('src/styles.css', 'utf8').replace(/\r\n/g, '\n')
const mediaBlock = (max) => {
  const at = css.lastIndexOf(`@media (max-width: ${max}px) {\n  .bil-split`)
  return at < 0 ? '' : css.slice(at, css.indexOf('\n}', at))
}

describe('Billing screens at narrow widths', () => {
  it.each([
    ['Billing', BillingView],
    ['A/R Manager', ArManagerView],
    ['Generate Invoice', GenerateInvoiceView],
    ['Verification Forms', VerificationFormsView],
    ['Appeals', AppealsView],
  ])('%s marks its list + detail split so it stacks', (_name, View) => {
    const { container } = render(<ToastProvider><StoreProvider><View /></StoreProvider></ToastProvider>)
    expect(container.querySelectorAll('.bil-split').length).toBeGreaterThan(0)
  })

  it('stacks the splits in one shrinkable column and lets toolbars wrap', () => {
    expect(mediaBlock(1100)).toMatch(/\.bil-split \{[^}]*grid-template-columns: minmax\(0, 1fr\) !important/)
    expect(css).toMatch(/\.sectionpage \.viewseg,\s*\.sectionpage \.batch-strip \{ flex-wrap: wrap; \}/)
  })

  // Regression: a Masters-only "card rows" block under 1180px used bare .py-thead / .py-cell:nth-child
  // selectors, so every Billing and Payroll table lost its header and 4th + 5th cells (Status and View
  // on Verification Forms). Every hiding rule there must now be scoped to a Masters table.
  it('scopes the under-1180px column hiding to the Masters card tables', () => {
    const blocks = []
    for (let at = css.indexOf('@media (max-width: 1180px) {'); at >= 0; at = css.indexOf('@media (max-width: 1180px) {', at + 1)) {
      let depth = 0, i = css.indexOf('{', at)
      for (; i < css.length; i++) { if (css[i] === '{') depth++; else if (css[i] === '}' && --depth === 0) break }
      blocks.push(css.slice(css.indexOf('{', at) + 1, i))
    }
    const hiding = blocks.flatMap((b) => [...b.matchAll(/([^{}]+)\{([^}]*)\}/g)])
      .filter(([, , body]) => /display:\s*none/.test(body))
      .flatMap(([, sel]) => sel.split(',').map((s) => s.trim()))
      .filter((s) => /\.py-(thead|trow|cell)/.test(s))
    expect(hiding.length).toBeGreaterThan(0)
    for (const s of hiding) expect(s).toMatch(/^\.(py-cards|cf-tbl|sv-tbl) /)
    // Wide inline-column tables scroll inside .py-tbl instead.
    expect(css).toMatch(/\.py-tbl:not\(\.py-cards\):has\(> \.py-thead > :nth-child\(6\)\) > :is\(\.py-thead, \.py-trow\) \{ min-width: \d+px; \}/)
  })

  it('renders Status and View on every Verification Forms row, outside the card layout', () => {
    render(<ToastProvider><StoreProvider><VerificationFormsView /></StoreProvider></ToastProvider>)
    const table = screen.getByTestId('vf-table')
    expect(table.classList.contains('py-cards')).toBe(false)
    const rows = table.querySelectorAll('.py-trow')
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) {
      expect(row.children[3].querySelector('.pill')).not.toBeNull()
      expect(row.children[4].querySelector('button').textContent).toBe('View')
    }
  })

  it('keeps the A/R header table out of layout so it cannot widen the page', () => {
    render(<ToastProvider><StoreProvider><ArManagerView /></StoreProvider></ToastProvider>)
    const hidden = screen.getByTestId('ar-table').querySelector('table[aria-hidden="true"]')
    expect(hidden.style.display).toBe('none')
  })
})
