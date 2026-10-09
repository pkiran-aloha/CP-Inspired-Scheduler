import React from 'react'
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { renderToStaticMarkup } from 'react-dom/server'
import App from '../App'
import { blankState, StoreProvider } from '../state/store'
import { ToastProvider } from '../ui/Toast'
import { Icon } from '../ui/Icons'
import AppealsView from '../components/AppealsView'
import ArManagerView from '../components/ArManagerView'
import BilledFilesView from '../components/BilledFilesView'
import GenerateInvoiceView from '../components/GenerateInvoiceView'
import PaymentCenterView from '../components/PaymentCenterView'
import ProviderIdView from '../components/ProviderIdView'
import SecondaryBillingView from '../components/SecondaryBillingView'
import VerificationFormsView from '../components/VerificationFormsView'

const KEY = 'aloha-aba.v3'
beforeEach(() => { localStorage.clear(); localStorage.setItem(KEY, JSON.stringify(blankState())) })
afterEach(() => cleanup())

const SCREENS = [
  ['Appeals', AppealsView, 'appeal-kpis'],
  ['A/R Manager', ArManagerView, 'ar-kpis'],
  ['Billed Files', BilledFilesView, 'bf-kpis'],
  ['Generate Invoice', GenerateInvoiceView, 'gi-kpis'],
  ['Payment Center', PaymentCenterView, 'pc-kpis'],
  ['Provider Identifier', ProviderIdView, 'pi-kpis'],
  ['Secondary Queue', SecondaryBillingView, 'sb-kpis'],
  ['Verification Forms', VerificationFormsView, 'vf-kpis'],
]

describe('Billing stat tiles', () => {
  it.each(SCREENS)('%s gives every tile its own glyph', (_name, View, stripId) => {
    render(<ToastProvider><StoreProvider><View /></StoreProvider></ToastProvider>)
    const tiles = [...screen.getByTestId(stripId).querySelectorAll('.rp-sumchip')]
    expect(tiles.length).toBeGreaterThan(2)
    const glyphs = tiles.map((tile) => {
      const svg = tile.querySelector('svg')
      expect(svg, tile.dataset.testid).toBeTruthy()
      expect(svg.getAttribute('width')).toBe('16')
      return svg.innerHTML
    })
    expect(new Set(glyphs).size).toBe(tiles.length)
  })
})

describe('Profile selector', () => {
  it('shows the account initials in the rail avatar, the one profile control (Calendar has no second chip)', () => {
    render(<App />)
    const railAvatar = document.querySelector('[data-testid="nav-demo-preview"] .nr-preview-avatar')
    expect(railAvatar.textContent).toMatch(/^[A-Z]{1,2}$/)
    fireEvent.click(screen.getByTestId('nav-calendar'))
    expect(document.querySelectorAll('.nr-preview-avatar')).toHaveLength(1)
    expect(document.querySelector('.userchip')).toBeNull()
  })

  it('centres the rail avatar initials (the rail icon class is inline-flex with no alignment)', () => {
    const css = readFileSync('src/styles.css', 'utf8')
    const rule = [...css.matchAll(/\.nr-preview-avatar\s*\{([^}]*)\}/g)].map((m) => m[1]).join(';')
    expect(rule).toMatch(/place-items:\s*center/)
    expect(rule).toMatch(/display:\s*inline-grid/)
  })

  it('honours the size prop on every icon', () => {
    for (const [name, draw] of Object.entries(Icon)) {
      expect(renderToStaticMarkup(draw({ size: 22 })), name).toContain('width="22"')
    }
  })
})
