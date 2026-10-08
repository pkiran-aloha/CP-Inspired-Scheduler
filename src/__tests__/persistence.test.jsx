import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, act, cleanup, within } from '@testing-library/react'
import App from '../App'
import { blankState, loadWorkspace, reducer, serializeForStorage, STORAGE_KEY } from '../state/store'

const BASE = blankState()
const stored = () => JSON.parse(localStorage.getItem(STORAGE_KEY))
const wait = (ms) => act(() => new Promise((r) => setTimeout(r, ms)))
const MARK = { id: 'other-tab-appt', date: BASE.ui.anchor, start: 540, end: 600, type: 'unavailable', status: 'active', title: 'Written by another tab', clientIds: [], staffIds: ['s1'] }

beforeEach(() => { localStorage.clear(); localStorage.setItem(STORAGE_KEY, serializeForStorage(BASE)) })
afterEach(cleanup)

describe('loadWorkspace', () => {
  it('reads a saved workspace back without an error', () => {
    const { state, error } = loadWorkspace()
    expect(error).toBeNull()
    expect(Object.keys(state.appts).sort()).toEqual(Object.keys(BASE.appts).sort())
  })
  it('reports a saved workspace it cannot read instead of passing it off as fresh', () => {
    localStorage.setItem(STORAGE_KEY, '{not json')
    const { state, error } = loadWorkspace()
    expect(error).toMatch(/could not be read/i)
    expect(state.appts).toBeTruthy() // the tab still opens on a usable workspace
  })
  it('treats an empty browser as a fresh start, not an error', () => {
    localStorage.clear()
    expect(loadWorkspace().error).toBeNull()
  })
})

describe('hydrate reducer', () => {
  it('takes the other tab’s workspace, keeps this tab’s navigation and drops stale Undo', () => {
    const mine = { ...BASE, ui: { ...BASE.ui, section: 'billing' }, history: [{ __workspaceSnapshot: true, appts: {} }] }
    const theirs = { ...BASE, appts: { ...BASE.appts, [MARK.id]: MARK }, ui: { ...BASE.ui, section: 'calendar' } }
    const next = reducer(mine, { type: 'hydrate', state: theirs })
    expect(next.appts[MARK.id]).toEqual(MARK)
    expect(next.ui.section).toBe('billing')
    expect(next.history).toEqual([])
  })
})

describe('workspace persistence in the app', () => {
  it('a stale second tab no longer overwrites what another tab saved', async () => {
    render(<App />)
    await wait(300)
    // Another tab saves a new appointment.
    const theirs = serializeForStorage({ ...BASE, appts: { ...BASE.appts, [MARK.id]: MARK } })
    localStorage.setItem(STORAGE_KEY, theirs)
    await act(async () => { window.dispatchEvent(new StorageEvent('storage', { key: STORAGE_KEY, newValue: theirs, storageArea: localStorage })) })
    // This tab then makes an unrelated change, which saves its whole workspace.
    fireEvent.click(screen.getByTestId('nav-collapse'))
    await wait(400)
    expect(stored().appts[MARK.id]).toBeTruthy()
  })

  it('flushes a pending save when the page is hidden or closed', async () => {
    render(<App />)
    await wait(300)
    const before = stored().ui.nav
    fireEvent.click(screen.getByTestId('nav-collapse'))
    window.dispatchEvent(new Event('pagehide')) // reload/close inside the debounce window
    expect(stored().ui.nav).not.toBe(before)
  })

  it('leaves an unreadable saved workspace untouched and says so', async () => {
    localStorage.setItem(STORAGE_KEY, '{not json')
    render(<App />)
    const warning = await screen.findByTestId('storage-warning')
    expect(warning.textContent).toMatch(/could not be read/i)
    await wait(400)
    expect(localStorage.getItem(STORAGE_KEY)).toBe('{not json')
    // The user can choose to replace it with this tab's workspace.
    fireEvent.click(within(warning).getByTestId('storage-overwrite'))
    await wait(400)
    expect(stored().appts).toBeTruthy()
    expect(screen.queryByTestId('storage-warning')).toBeNull()
  })

  it('names the reason when browser storage is full', async () => {
    const reject = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Quota exceeded', 'QuotaExceededError') })
    try {
      render(<App />)
      const warning = await screen.findByTestId('storage-warning')
      expect(warning.textContent).toMatch(/storage is full/i)
      expect(warning.textContent).toMatch(/MB/)
    } finally {
      reject.mockRestore()
    }
  })
})
