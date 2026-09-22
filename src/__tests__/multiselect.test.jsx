import { describe, expect, it, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import React, { useState } from 'react'
import { MultiSelect } from '../components/fields.jsx'

function Host({ initial = [] }) {
  const [v, setV] = useState(initial)
  return (
    <div>
      <MultiSelect testid="x" values={v} onChange={setV} options={['Alpha', 'Bravo', 'Charlie', 'Delta']} placeholder="Pick…" />
      <output data-testid="state">{JSON.stringify(v)}</output>
    </div>
  )
}
const opts = (o) => JSON.stringify(o)
afterEach(() => cleanup())

describe('MultiSelect — visible selection & deselect (chunk 28)', () => {
  it('shows placeholder when empty, chip with ✕ per pick, +n overflow and count pill', async () => {
    render(<Host />)
    expect(screen.getByTestId('x').textContent).toContain('Pick…')
    fireEvent.click(screen.getByTestId('x'))
    for (const o of ['Alpha', 'Bravo', 'Charlie']) fireEvent.click(screen.getByTestId(`opt-x-${o}`))
    expect(await screen.findByTestId('state')).toBeTruthy()
    expect(screen.getByTestId('ms-chip-x-Alpha')).toBeTruthy()
    expect(screen.getByTestId('ms-chip-x-Bravo')).toBeTruthy()
    expect(screen.queryByTestId('ms-chip-x-Charlie')).toBeNull() // third one folds into overflow
    expect(screen.getByTestId('ms-more-x').textContent).toContain('+1')
    expect(screen.getByTestId('ms-count-x').textContent).toBe('3')
    expect(screen.getByTestId('state').textContent).toBe(opts(['Alpha', 'Bravo', 'Charlie']))
  })

  it('checked rows carry .on state + filled boxes; unchecking by tapping the row works', async () => {
    render(<Host initial={['Bravo']} />)
    fireEvent.click(screen.getByTestId('x'))
    const row = screen.getByTestId('opt-x-Bravo')
    expect(row.className).toContain('on')
    expect(row.querySelector('.cb').className).toContain('on')
    expect(screen.getByTestId('opt-x-Alpha').className).not.toContain('on')
    fireEvent.click(row) // toggle off
    expect(screen.getByTestId('state').textContent).toBe('[]')
  })

  it('chip ✕ removes a single pick without opening the popover; header offers Clear all', async () => {
    render(<Host initial={['Alpha', 'Delta']} />)
    fireEvent.click(screen.getByTestId('ms-unsel-x-Delta'))
    expect(screen.getByTestId('state').textContent).toBe(opts(['Alpha']))
    fireEvent.click(screen.getByTestId('x'))
    fireEvent.click(screen.getByTestId('ms-clear-x'))
    expect(screen.getByTestId('state').textContent).toBe('[]')
    fireEvent.click(screen.getByTestId('x'))
    expect(screen.getByTestId('x').textContent).toContain('Pick…')
    expect(screen.queryByTestId('ms-clear-x')).toBeNull()
  })

  it('keyboard: Enter toggles the list, aria-pressed reflects selection, popover keeps open between picks', async () => {
    render(<Host />)
    fireEvent.keyDown(screen.getByTestId('x'), { key: 'Enter' })
    expect(screen.getByTestId('opt-x-Alpha')).toBeTruthy()
    fireEvent.click(screen.getByTestId('opt-x-Alpha'))
    expect(screen.getByTestId('opt-x-Bravo')).toBeTruthy() // stays open for multi-pick
    fireEvent.click(screen.getByTestId('opt-x-Bravo'))
    expect(screen.getByTestId('opt-x-Alpha').getAttribute('aria-pressed')).toBe('true')
    fireEvent.keyDown(screen.getByTestId('x'), { key: 'Escape' })
  })
})
