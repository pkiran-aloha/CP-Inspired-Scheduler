import React from 'react'
import { beforeEach, afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import App from '../App'
import { blankState } from '../state/store'

const KEY = 'aloha-aba.v3'

beforeEach(() => localStorage.clear())
afterEach(cleanup)

describe('Billing guidance behind the info button', () => {
  it('the revenue cycle explainer is hidden until About Billing is opened, and keeps its honesty line', async () => {
    const base = blankState()
    localStorage.setItem(KEY, JSON.stringify({ ...base, ui: { ...base.ui, section: 'billing' }, history: [] }))
    render(<App />)
    await screen.findByTestId('bil-generate')
    expect(screen.queryByText(/Billing has four steps/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'About Billing' }))
    const panel = screen.getByTestId('secbar-info-panel')
    expect(panel.textContent).toMatch(/Billing has four steps/)
    expect(panel.textContent).toMatch(/Nothing is sent to a payer or clearinghouse/)
  })

  it('Learn more opens the matching Help page', async () => {
    const base = blankState()
    localStorage.setItem(KEY, JSON.stringify({ ...base, ui: { ...base.ui, section: 'billing' }, history: [] }))
    render(<App />)
    await screen.findByTestId('bil-generate')
    fireEvent.click(screen.getByRole('button', { name: 'About Billing' }))
    fireEvent.click(screen.getByTestId('secbar-info-more'))
    const article = await screen.findByTestId('help-article')
    expect(article.querySelector('h1').textContent).toMatch(/Billing/)
    expect(screen.queryByTestId('secbar-info-panel')).toBeNull()
  })
})
