// ---- ⌘K palette, shortcut help sheet, settings data vault ----
import React from 'react'
import { render, screen, fireEvent, waitFor, within, cleanup } from '@testing-library/react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import App from '../App'
import { reducer, blankState } from '../state/store'
import { createWorkspaceBackup, workspaceData } from '../lib/workspaceBackup'

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
    await screen.findByTestId('settings-modal')
    fireEvent.click(screen.getByTestId('set-mod-system')) // data & backup live in System Settings
    await screen.findByTestId('set-storage-stat')
    expect(screen.getByTestId('set-storage-stat').textContent).toContain('KB')

    // export hits the shared blob-download path
    fireEvent.click(screen.getByTestId('set-export'))
    await waitFor(() => expect(window.URL.createObjectURL).toHaveBeenCalled())
    expect(await screen.findByText(/workspace exported/i)).toBeTruthy()

    // preview first: cancel makes no changes; confirm swaps all collections.
    const snap = { ...blankState(), appts: { z1: { id: 'z1', date: '2026-09-21', start: 540, end: 600, type: 'service', status: 'scheduled', clientIds: [], staffIds: [] } }, claims: {}, payments: {} }
    const file = new File([createWorkspaceBackup(snap)], 'backup.json', { type: 'application/json' })
    const input = screen.getByTestId('set-import-file')
    const upload = () => { Object.defineProperty(input, 'files', { value: [file], configurable: true }); fireEvent.change(input) }
    upload()
    expect(await screen.findByTestId('set-restore-preview')).toBeTruthy()
    // the preview shows before the debounced write lands — assert against what is
    // actually persisted, waiting for it, rather than racing the writer
    await waitFor(() => expect(Object.keys(stored().appts || {}).length).toBeGreaterThan(1))
    fireEvent.click(screen.getByTestId('set-restore-cancel'))
    expect(screen.queryByTestId('set-restore-preview')).toBeNull()
    upload()
    await screen.findByTestId('set-restore-preview')
    fireEvent.click(screen.getByTestId('set-restore-confirm'))
    expect(await screen.findByText(/Backup restored/)).toBeTruthy()
    await waitFor(() => expect(Object.keys(stored().appts || {}).length).toBe(1))

    // destructive buttons need a second confirming click (no native confirm)
    fireEvent.click(screen.getByTestId('set-reseed'))
    expect(await screen.findByText(/Click again to regenerate/)).toBeTruthy()
    expect(Object.keys(stored().appts || {}).length).toBe(1) // still untouched
    fireEvent.click(screen.getByTestId('set-reseed'))
    await waitFor(() => expect(Object.keys(stored().appts || {}).length).toBeGreaterThan(1))
  })

  it('restores billing records and masters from the UI, then Undo returns the whole workspace', async () => {
    render(<App />)
    fireEvent.click(screen.getByTestId('nav-settings'))
    await screen.findByTestId('settings-modal')
    fireEvent.click(screen.getByTestId('set-mod-system')) // data & backup live in System Settings
    await screen.findByTestId('set-storage-stat')
    const current = blankState()
    const claim = Object.values(current.claims)[0]
    const incoming = { ...current,
      appts: { z1: { id: 'z1', date: '2026-09-21', start: 540, end: 600, type: 'service', status: 'active', clientIds: [], staffIds: [] } },
      claims: { [claim.id]: claim },
      payments: { 'pay-test': { id: 'pay-test', claimId: claim.id, amount: 45 } },
      billedFiles: { 'bf-test': { id: 'bf-test', content: 'original artifact', claimIds: [claim.id] } },
      payers: [...current.payers, { ...current.payers[0], id: 'py-new', name: 'Restored payer' }],
      customFields: [...current.customFields, { id: 'cf-new', label: 'New field', type: 'text' }],
      dash: { widgets: [], boards: [{ id: 'board-new', name: 'My dashboard', widgets: [] }] },
      settings: { ...current.settings, billing: { ...current.settings.billing, invoiceSeq: 71 } },
    }
    const input = screen.getByTestId('set-import-file')
    const file = new File([createWorkspaceBackup(incoming)], 'full-backup.json', { type: 'application/json' })
    Object.defineProperty(input, 'files', { value: [file], configurable: true })
    fireEvent.change(input)
    expect((await screen.findByTestId('set-restore-preview')).textContent).toContain('1 appointment')
    fireEvent.click(screen.getByTestId('set-restore-confirm'))
    await waitFor(() => {
      const s = stored()
      expect(s.payments['pay-test'].amount).toBe(45)
      expect(s.billedFiles['bf-test'].content).toBe('original artifact')
      expect(s.payers.some((p) => p.id === 'py-new')).toBe(true)
      expect(s.customFields.some((c) => c.id === 'cf-new')).toBe(true)
      expect(s.dash.boards[0].name).toBe('My dashboard')
      expect(s.settings.billing.invoiceSeq).toBe(71)
    })
    fireEvent.click(screen.getByText('Undo'))
    await waitFor(() => {
      const s = stored()
      expect(s.payments['pay-test']).toBeUndefined()
      expect(s.billedFiles['bf-test']).toBeUndefined()
      expect(s.payers.some((p) => p.id === 'py-new')).toBe(false)
      expect(s.dash.widgets.length).toBeGreaterThan(0)
      expect(s.settings.billing.invoiceSeq).toBe(1)
    })
  })

  it('warns before restoring an older partial export', async () => {
    render(<App />)
    fireEvent.click(screen.getByTestId('nav-settings'))
    await screen.findByTestId('settings-modal')
    fireEvent.click(screen.getByTestId('set-mod-system'))
    await screen.findByTestId('set-import-file')
    const s = blankState()
    const legacy = { exported: new Date().toISOString(), appts: s.appts, claims: s.claims,
      staff: s.staff, clients: s.clients, teams: s.teams, settings: s.settings, reports: s.reports }
    const input = screen.getByTestId('set-import-file')
    Object.defineProperty(input, 'files', { value: [new File([JSON.stringify(legacy)], 'v1.json', { type: 'application/json' })], configurable: true })
    fireEvent.change(input)
    expect((await screen.findByTestId('set-restore-preview')).textContent).toMatch(/Older partial backup.*not included/)
    fireEvent.click(screen.getByTestId('set-restore-cancel'))
  })

  it('rejects files that are not an Aloha ABA backup', async () => {
    render(<App />)
    fireEvent.click(screen.getByTestId('nav-settings'))
    await screen.findByTestId('settings-modal')
    fireEvent.click(screen.getByTestId('set-mod-system')) // data & backup live in System Settings
    await screen.findByTestId('set-storage-stat')
    const file = new File(['{"nope":true}'], 'junk.json', { type: 'application/json' })
    const input = screen.getByTestId('set-import-file')
    Object.defineProperty(input, 'files', { value: [file], configurable: true })
    fireEvent.change(input)
    expect(await screen.findByText(/Not an Aloha ABA workspace backup/)).toBeTruthy()
  })
})

describe('local storage safety', () => {
  it('warns when browser storage refuses a save, and offers the backup screen', async () => {
    const reject = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Quota exceeded', 'QuotaExceededError') })
    try {
      render(<App />)
      const warning = await screen.findByTestId('storage-warning')
      expect(warning.textContent).toMatch(/Changes aren't saved/)
      fireEvent.click(within(warning).getByText('Open Settings'))
      expect(await screen.findByTestId('set-export')).toBeTruthy()
    } finally {
      reject.mockRestore()
    }
  })
})

describe('store replace reducer', () => {
  it('swaps the whole workspace and keeps an undo snapshot', () => {
    const base = blankState()
    const payload = { ...workspaceData(base), appts: { a: { id: 'a', date: '2026-09-21', start: 540, end: 600, type: 'service', status: 'active', clientIds: [], staffIds: [] } }, claims: {}, payments: {} }
    const next = reducer(base, { type: 'replace', payload })
    expect(Object.keys(next.appts)).toEqual(['a'])
    expect(Object.keys(next.payments)).toHaveLength(0)
    expect(next.history.length).toBe(base.history.length + 1)
    const undo = reducer(next, { type: 'undo' })
    expect(Object.keys(undo.appts).length).toBe(Object.keys(base.appts).length)
    expect(undo.payments).toEqual(base.payments)
    expect(reducer(base, { type: 'replace', payload: { junk: true } })).toBe(base)
  })
})
