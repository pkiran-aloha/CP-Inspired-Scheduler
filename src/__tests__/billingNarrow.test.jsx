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

  it('keeps the A/R header table out of layout so it cannot widen the page', () => {
    render(<ToastProvider><StoreProvider><ArManagerView /></StoreProvider></ToastProvider>)
    const hidden = screen.getByTestId('ar-table').querySelector('table[aria-hidden="true"]')
    expect(hidden.style.display).toBe('none')
  })
})
