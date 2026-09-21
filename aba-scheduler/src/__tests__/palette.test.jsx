// ---- ⌘K palette, shortcut help sheet, settings data vault ----
import React from 'react'
import { render, screen, fireEvent, waitFor, within, cleanup } from '@testing-library/react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import App from '../App'
import { reducer, blankState } from '../state/store'

const KEY = 'aloha-aba.v3'
const stored = () => JSON.parse(localStorage.getItem(KEY) || '{}')

beforeEach(() => {
  localStorage.clear()
  window.URL.createObjectURL = vi.fn(() => 'blob:test')
  window.URL.revokeObjectURL = vi.fn()
})
afterEach(() => cleanup())

describe('command palette', () => {
  it('opens with Ctrl+K, finds a client and jumps the roster to their name', async () => {
    render(<App />)
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    const input = await screen.findByTestId('palette-input')
    fireEvent.change(input, { target: { value: 'justin' } })
    await waitFor(() => expect(within(screen.getByTestId('palette')).getByText('Justin Hsu')).toBeTruthy())
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(screen.queryByTestId('palette')).toBeFalsy())
    await waitFor(() => expect(screen.getByTestId('cli-search').value).toBe('Justin Hsu'))
  })

  it('runs a report template straight from the palette (and Esc closes)', async () => {
    render(<App />)
    fireEvent.click(screen.getByTestId('palette-open'))
    const input = screen.getByTestId('palette-input')
    fireEvent.change(input, { target: { value: 'attendance' } })
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'ArrowUp' })
    fireEvent.keyDown(input, { key: 'Enter' })
    await screen.findByTestId('rp-table')
    expect((await screen.findAllByText('Attendance & Session Ledger')).length).toBeGreaterThanOrEqual(1)
    await waitFor(() => expect(stored().ui.repSel).toBe('attendance'))
    // palette again → escape dismisses it
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    expect(screen.getByTestId('palette')).toBeTruthy()
    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByTestId('palette')).toBeFalsy())
  })

  it('staff result filters the calendar week to that person', async () => {
    render(<App />)
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    const input = await screen.findByTestId('palette-input')
    fireEvent.change(input, { target: { value: 'neha' } })
    await waitFor(() => expect(within(screen.getByTestId('palette')).getByText(/Neha Peyyeti/)).toBeTruthy())
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => {
      const id = stored().staff.find((x) => x.name.startsWith('Neha')).id
      expect(stored().ui.staffSel).toEqual([id])
    })
    expect(stored().ui.view).toBe('week')
  })
})

describe('shortcut help sheet', () => {
  it('opens with ? and lists the palette', async () => {
    render(<App />)
    fireEvent.keyDown(window, { key: '?' })
    expect(await screen.findByTestId('kb-help')).toBeTruthy()
    expect(screen.getByText(/command palette/)).toBeTruthy()
    fireEvent.click(screen.getByText('Got it'))
    await waitFor(() => expect(screen.queryByTestId('kb-help')).toBeFalsy())
  })
})

describe('settings data vault', () => {
  it('exports a backup, restores one, and arms destructive actions before they fire', async () => {
    render(<App />)
    fireEvent.click(screen.getByTestId('nav-settings'))
    await screen.findByTestId('set-storage-stat')
    expect(screen.getByTestId('set-storage-stat').textContent).toContain('KB')

    // export hits the shared blob-download path
    fireEvent.click(screen.getByTestId('set-export'))
    await waitFor(() => expect(window.URL.createObjectURL).toHaveBeenCalled())
    expect(await screen.findByText(/Workspace exported/)).toBeTruthy()

    // restore a tiny snapshot — the ledger swaps in one step (undoable)
    const snap = { appts: { z1: { id: 'z1', date: '2026-09-21', start: 540, end: 600, type: 'service', status: 'scheduled', clientIds: [], staffIds: [] } } }
    const file = new File([JSON.stringify(snap)], 'backup.json', { type: 'application/json' })
    const input = screen.getByTestId('set-import-file')
    Object.defineProperty(input, 'files', { value: [file], configurable: true })
    fireEvent.change(input)
    expect(await screen.findByText(/Backup restored/)).toBeTruthy()
    await waitFor(() => expect(Object.keys(stored().appts || {}).length).toBe(1))

    // destructive buttons need a second confirming click (no native confirm)
    fireEvent.click(screen.getByTestId('set-reseed'))
    expect(await screen.findByText('Click again to regenerate')).toBeTruthy()
    expect(Object.keys(stored().appts || {}).length).toBe(1) // still untouched
    fireEvent.click(screen.getByTestId('set-reseed'))
    await waitFor(() => expect(Object.keys(stored().appts || {}).length).toBeGreaterThan(1))
  })

  it('rejects files that are not a Aloha ABA backup', async () => {
    render(<App />)
    fireEvent.click(screen.getByTestId('nav-settings'))
    await screen.findByTestId('set-storage-stat')
    const file = new File(['{"nope":true}'], 'junk.json', { type: 'application/json' })
    const input = screen.getByTestId('set-import-file')
    Object.defineProperty(input, 'files', { value: [file], configurable: true })
    fireEvent.change(input)
    expect(await screen.findByText(/not a Aloha ABA backup/)).toBeTruthy()
  })
})

describe('store replace reducer', () => {
  it('swaps the whole workspace and keeps an undo snapshot', () => {
    const base = blankState()
    const next = reducer(base, { type: 'replace', payload: { appts: { a: { id: 'a' } }, claims: {} } })
    expect(Object.keys(next.appts)).toEqual(['a'])
    expect(next.history.length).toBe(base.history.length + 1)
    const undo = reducer(next, { type: 'undo' })
    expect(Object.keys(undo.appts).length).toBe(Object.keys(base.appts).length)
    expect(reducer(base, { type: 'replace', payload: { junk: true } })).toBe(base)
  })
})
