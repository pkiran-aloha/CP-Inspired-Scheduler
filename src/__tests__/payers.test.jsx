import React from 'react'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import App from '../App'

const KEY = 'aloha-aba.v3'
const stored = () => JSON.parse(localStorage.getItem(KEY) || '{}')

beforeEach(() => { localStorage.clear() })
afterEach(() => cleanup())

describe('payer master', () => {
  it('seed directory covers every insurer used by clients, with unique ids', async () => {
    const { PAYERS } = await import('../lib/seed.js')
    const names = PAYERS.map((p) => p.name)
    expect(new Set(names).size).toBe(names.length)
    for (const n of ['Blue Shield CA', 'Aetna', 'Regence BCBS', 'UnitedHealthcare', 'Medicaid (CA)', 'Self-pay']) expect(names).toContain(n)
    expect(PAYERS.every((p) => p.id && p.type && p.status)).toBe(true)
    expect(PAYERS.find((p) => p.name === 'Self-pay').policy.kind).toBe('selfpay')
  })

  it('navigates from the rail and the keyboard, renders the directory with real counts', async () => {
    render(<App />)
    fireEvent.keyDown(window, { key: '8' })
    const table = await screen.findByTestId('payers-table')
    expect(table).toBeTruthy()
    expect(screen.getByTestId('py-row-py-aetna')).toBeTruthy()
    // Aetna has seeded clients — the Clients column is derived, not hard-coded
    await waitFor(() => expect(Number(screen.getByTestId('py-ct-py-aetna').textContent)).toBeGreaterThan(0))
    expect(screen.getByTestId('py-row-py-valley-children-s-services')).toBeTruthy() // inactive rows show too
    expect(screen.getByTestId('py-pager').textContent).toMatch(/of 12/)
  })

  it('adds a payer through the form — required fields block, then save lands it in storage', async () => {
    render(<App />)
    fireEvent.click(screen.getByTestId('nav-payers'))
    await screen.findByTestId('payers-table')
    await waitFor(() => expect(stored().payers).toHaveLength(12))
    fireEvent.click(screen.getByTestId('py-add'))
    // blocked: nothing filled
    fireEvent.click(screen.getByTestId('py-save'))
    expect(await screen.findByText('Payer name is required')).toBeTruthy()
    expect(screen.getByText('Choose a payer type')).toBeTruthy()
    expect(screen.getByText('Street is required')).toBeTruthy()
    // fill
    fireEvent.change(screen.getByTestId('py-name'), { target: { value: 'Summit Care Partners' } })
    expect(screen.getByTestId('py-count').textContent).toBe('20/60')
    fireEvent.change(screen.getByTestId('py-type'), { target: { value: 'Insurance' } })
    fireEvent.change(screen.getByTestId('py-street'), { target: { value: '900 Summit Way' } })
    fireEvent.change(screen.getByTestId('py-city'), { target: { value: 'Reno' } })
    fireEvent.change(screen.getByTestId('py-zip'), { target: { value: '89501' } })
    fireEvent.change(screen.getByTestId('py-c-val-0'), { target: { value: '(775) 555-0188' } })
    fireEvent.click(screen.getByTestId('py-save'))
    await waitFor(() => expect(stored().payers).toHaveLength(13))
    const row = await screen.findByTestId('py-row-' + stored().payers[12].id)
    expect(row.textContent).toContain('Summit Care Partners')
    expect(row.textContent).toContain('(775) 555-0188')
  })

  it('duplicate names are rejected with an inline error', async () => {
    render(<App />)
    fireEvent.click(screen.getByTestId('nav-payers'))
    fireEvent.click(screen.getByTestId('py-add'))
    fireEvent.change(screen.getByTestId('py-name'), { target: { value: 'aetna' } }) // case-insensitive clash
    fireEvent.change(screen.getByTestId('py-type'), { target: { value: 'Insurance' } })
    fireEvent.change(screen.getByTestId('py-street'), { target: { value: '1 A St' } })
    fireEvent.change(screen.getByTestId('py-city'), { target: { value: 'X' } })
    fireEvent.change(screen.getByTestId('py-zip'), { target: { value: '90001' } })
    fireEvent.click(screen.getByTestId('py-save'))
    expect(await screen.findByText('Another payer already uses this name')).toBeTruthy()
    await waitFor(() => expect(Object.keys(stored()).length).toBeGreaterThan(0))
    expect(stored().payers).toHaveLength(12)
  })

  it('edits an existing payer: phone change persists to the row', async () => {
    render(<App />)
    fireEvent.click(screen.getByTestId('nav-payers'))
    await waitFor(() => expect(stored().payers).toHaveLength(12))
    fireEvent.click(await screen.findByTestId('py-row-py-regence-bcbs'))
    const phone = await screen.findByTestId('py-c-val-0')
    fireEvent.change(phone, { target: { value: '(503) 555-9911' } })
    fireEvent.click(screen.getByTestId('py-save'))
    await waitFor(() => expect(screen.getByTestId('py-row-py-regence-bcbs').textContent).toContain('(503) 555-9911'))
    await waitFor(() => expect(stored().payers.find((p) => p.id === 'py-regence-bcbs').contacts[0].number).toBe('(503) 555-9911'))
  })

  it('delete is blocked while clients reference the payer, works once free (two-step)', async () => {
    render(<App />)
    fireEvent.click(screen.getByTestId('nav-payers'))
    await waitFor(() => expect(stored().payers).toHaveLength(12))
    // in use: Aetna
    fireEvent.click(await screen.findByTestId('py-row-py-aetna'))
    fireEvent.click(await screen.findByTestId('py-remove-py-aetna'))
    fireEvent.click(await screen.findByTestId('py-remove-py-aetna')) // second arm → blocked by usage
    expect(await screen.findByText(/still has \d+ clients? on file/)).toBeTruthy()
    expect(stored().payers.find((p) => p.id === 'py-aetna')).toBeTruthy()
    expect(stored().payers.find((p) => p.id === 'py-aetna')).toBeTruthy() // still there, blocked
    fireEvent.keyDown(window, { key: 'Escape' })
    // not in use: Riverside Behavioral Trust (no clients, inactive)
    fireEvent.click(await screen.findByTestId('py-row-py-riverside-behavioral-trust'))
    fireEvent.click(await screen.findByTestId('py-remove-py-riverside-behavioral-trust'))
    fireEvent.click(await screen.findByTestId('py-remove-py-riverside-behavioral-trust'))
    await waitFor(() => expect(stored().payers.find((p) => p.id === 'py-riverside-behavioral-trust')).toBeUndefined())
    expect(stored().payers).toHaveLength(11)
  })

  it('search + Active filter behave like the screenshot (chips, clear-all, counts)', async () => {
    render(<App />)
    fireEvent.click(screen.getByTestId('nav-payers'))
    fireEvent.click(screen.getByTestId('py-active-filter'))
    expect(await screen.findByTestId('py-f-active')).toBeTruthy()
    fireEvent.keyDown(screen.getByTestId('py-search'), { key: 'a' })
    fireEvent.change(screen.getByTestId('py-search'), { target: { value: 'fusd' } })
    const rows = await screen.findAllByText(/Fremont Unified School District/)
    expect(rows.length).toBeGreaterThanOrEqual(1)
    fireEvent.click(screen.getByTestId('py-clear'))
    await waitFor(() => expect(screen.queryByTestId('py-frow')).toBeNull())
  })

  it('client form payer dropdown is fed by the master (active only)', async () => {
    render(<App />)
    fireEvent.click(screen.getByTestId('nav-clients'))
    fireEvent.click(screen.getByTestId('cli-mode-table'))
    fireEvent.click(screen.getByTestId('cli-new'))
    const sel = await screen.findByTestId('cm-insurer')
    const opts = [...sel.querySelectorAll('option')].map((o) => o.textContent)
    const { PAYERS } = await import('../lib/seed.js')
    const active = PAYERS.filter((x) => x.status === 'active').map((x) => x.name)
    const inactive = PAYERS.filter((x) => x.status !== 'active').map((x) => x.name)
    expect(opts).toEqual(expect.arrayContaining(active)) // the whole active master
    for (const n of inactive) expect(opts).not.toContain(n) // inactive stays out of new picks
    fireEvent.keyDown(window, { key: 'Escape' })
  })

  it('sorting by Clients puts the busy payers on top', async () => {
    render(<App />)
    fireEvent.click(screen.getByTestId('nav-payers'))
    await screen.findByTestId('payers-table')
    fireEvent.click(screen.getByTestId('py-sort-clients')) // asc first: zeros on top
    const firstAsc = screen.getAllByTestId(/py-row-/)[0]
    expect(Number(firstAsc.querySelector('[data-testid^="py-ct-"]').textContent)).toBe(0)
    fireEvent.click(screen.getByTestId('py-sort-clients')) // desc: busiest first
    const firstDesc = screen.getAllByTestId(/py-row-/)[0]
    expect(Number(firstDesc.querySelector('[data-testid^="py-ct-"]').textContent)).toBeGreaterThan(0)
  })
})
