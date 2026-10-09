import React from 'react'
import { afterEach, describe, it, expect } from 'vitest'
import { cleanup, render, screen, fireEvent } from '@testing-library/react'
import InfoTip from '../ui/InfoTip'

const setup = () =>
  render(
    <div>
      <InfoTip label="Claims">Claims are built from completed sessions.</InfoTip>
      <button type="button">Elsewhere</button>
    </div>,
  )

afterEach(cleanup)

describe('InfoTip', () => {
  it('has an accessible name and keeps its text hidden until opened', () => {
    setup()
    const btn = screen.getByRole('button', { name: 'About Claims' })
    expect(btn.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByText('Claims are built from completed sessions.')).toBeNull()
  })

  it('opens on click into a live region and closes on a second click', () => {
    setup()
    const btn = screen.getByRole('button', { name: 'About Claims' })
    fireEvent.click(btn)
    expect(btn.getAttribute('aria-expanded')).toBe('true')
    const panel = screen.getByTestId('infotip-panel')
    expect(panel.textContent).toContain('Claims are built from completed sessions.')
    expect(panel.closest('[role="status"]').id).toBe(btn.getAttribute('aria-controls'))
    fireEvent.click(btn)
    expect(screen.queryByTestId('infotip-panel')).toBeNull()
  })

  it('opens with the keyboard and closes on Escape, returning focus', () => {
    setup()
    const btn = screen.getByRole('button', { name: 'About Claims' })
    btn.focus()
    // a native button turns Enter into a click; jsdom needs the click fired explicitly
    fireEvent.keyDown(btn, { key: 'Enter' })
    fireEvent.click(btn)
    expect(screen.getByTestId('infotip-panel')).toBeTruthy()
    fireEvent.keyDown(document.activeElement, { key: 'Escape' })
    expect(screen.queryByTestId('infotip-panel')).toBeNull()
    expect(document.activeElement).toBe(btn)
  })

  it('closes on a click outside', () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: 'About Claims' }))
    fireEvent.mouseDown(screen.getByRole('button', { name: 'Elsewhere' }))
    expect(screen.queryByTestId('infotip-panel')).toBeNull()
  })
})
