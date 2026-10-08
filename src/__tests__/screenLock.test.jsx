import React from 'react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import App from '../App'
import { blankState } from '../state/store'
import { hashPin, writePin } from '../lib/screenLock'

const KEY = 'aloha-aba.v3'
const BASE = blankState()
const stored = () => JSON.parse(localStorage.getItem(KEY))
const seed = (general = {}, ui = {}) => localStorage.setItem(KEY, JSON.stringify({
  ...BASE,
  settings: { ...BASE.settings, system: { ...BASE.settings.system, general: { ...BASE.settings.system.general, ...general } } },
  ui: { ...BASE.ui, ...ui },
}))
const onSystemSettings = { section: 'settings', settingsModule: 'system', settingsSub: 'general' }

let view = null
beforeEach(() => { localStorage.clear(); sessionStorage.clear() })
afterEach(() => { view?.unmount(); view = null; vi.useRealTimers(); sessionStorage.clear() })

describe('local screen lock', () => {
  it('locks after the idle minutes, hides the workspace, and "I’m back" unlocks without a PIN', async () => {
    vi.useFakeTimers()
    seed({ screenLockEnabled: true, screenLockMinutes: 1 })
    view = render(<App />)
    expect(screen.queryByTestId('lock-screen')).toBeNull()
    act(() => { vi.advanceTimersByTime(45000) })
    expect(screen.queryByTestId('lock-screen')).toBeNull()
    act(() => { vi.advanceTimersByTime(30000) })
    const lock = screen.getByTestId('lock-screen')
    expect(lock.getAttribute('aria-modal')).toBe('true')
    expect(document.body.classList.contains('is-locked')).toBe(true)
    expect(document.activeElement).toBe(screen.getByTestId('lock-unlock'))
    expect(lock.textContent).not.toMatch(/appointment/i) // the lock card carries no workspace content
    fireEvent.submit(screen.getByTestId('lock-unlock').closest('form'))
    await act(async () => {})
    expect(screen.queryByTestId('lock-screen')).toBeNull()
    expect(document.body.classList.contains('is-locked')).toBe(false)
  })

  it('stays unlocked with the lock off (the default)', () => {
    vi.useFakeTimers()
    seed()
    view = render(<App />)
    act(() => { vi.advanceTimersByTime(3 * 60 * 60000) })
    expect(screen.queryByTestId('lock-screen')).toBeNull()
  })

  it('Lock now needs the PIN: a wrong one is refused, the right one unlocks; another tab’s save does not unlock', async () => {
    writePin(await hashPin('4821', 1000))
    seed()
    view = render(<App />)
    fireEvent.click(screen.getByTestId('lock-now'))
    expect(screen.getByTestId('lock-screen')).toBeTruthy()
    // another tab saving the workspace leaves this tab locked
    act(() => { window.dispatchEvent(new StorageEvent('storage', { key: KEY, newValue: localStorage.getItem(KEY) })) })
    expect(screen.getByTestId('lock-screen')).toBeTruthy()
    fireEvent.change(screen.getByTestId('lock-pin'), { target: { value: '1111' } })
    fireEvent.click(screen.getByTestId('lock-unlock'))
    expect(await screen.findByTestId('lock-error')).toBeTruthy()
    expect(screen.getByTestId('lock-screen')).toBeTruthy()
    fireEvent.change(screen.getByTestId('lock-pin'), { target: { value: '4821' } })
    fireEvent.click(screen.getByTestId('lock-unlock'))
    await waitFor(() => expect(screen.queryByTestId('lock-screen')).toBeNull())
  })

  it('auto-logout clears Undo and drops unsaved drafts but keeps saved data', async () => {
    vi.useFakeTimers()
    seed({ autoLogoutMinutes: 5 }, onSystemSettings)
    view = render(<App />)
    // a saved, undoable settings change
    fireEvent.click(screen.getByTestId('lock-enabled'))
    act(() => { vi.advanceTimersByTime(300) })
    expect(stored().settings.system.general.screenLockEnabled).toBe(true)
    // an unsaved draft in the PIN field
    fireEvent.change(screen.getByTestId('lock-pin-input'), { target: { value: '12' } })
    fireEvent.click(screen.getByTestId('lock-now'))
    act(() => { vi.advanceTimersByTime(5 * 60000 + 15000) })
    expect(screen.getByTestId('lock-ended').textContent).toMatch(/Undo history was cleared/)
    fireEvent.submit(screen.getByTestId('lock-unlock').closest('form'))
    await act(async () => {})
    expect(screen.queryByTestId('lock-screen')).toBeNull()
    expect(screen.getByTestId('lock-pin-input').value).toBe('') // the draft was discarded
    // Undo has nothing left to reverse: the saved change stays
    act(() => { fireEvent.keyDown(window, { key: 'u' }) })
    act(() => { vi.advanceTimersByTime(300) })
    expect(screen.getByTestId('lock-enabled').getAttribute('aria-pressed')).toBe('true')
    expect(stored().settings.system.general.screenLockEnabled).toBe(true)
    expect(Object.keys(stored().appts).length).toBe(Object.keys(BASE.appts).length)
  })

  it('sets a PIN from Settings as a hash only, and says MFA is not enforced', async () => {
    seed({}, onSystemSettings)
    view = render(<App />)
    expect(screen.getByTestId('set-sys-gen-mfa').disabled).toBe(true)
    expect(screen.getByTestId('lock-mfa-note').textContent).toMatch(/not enforced locally/)
    expect(screen.getByTestId('lock-settings-note').textContent).toMatch(/only hides the screen/)
    fireEvent.change(screen.getByTestId('lock-pin-input'), { target: { value: '12' } })
    fireEvent.click(screen.getByTestId('lock-pin-save'))
    expect(screen.getByTestId('lock-pin-status').textContent).toBe('Not set')
    fireEvent.change(screen.getByTestId('lock-pin-input'), { target: { value: '135790' } })
    fireEvent.click(screen.getByTestId('lock-pin-save'))
    await waitFor(() => expect(screen.getByTestId('lock-pin-status').textContent).toBe('Set on this browser'))
    for (let i = 0; i < localStorage.length; i++) expect(localStorage.getItem(localStorage.key(i))).not.toContain('135790')
    expect(localStorage.getItem(KEY)).not.toContain('PBKDF2')
    fireEvent.click(screen.getByTestId('lock-pin-clear'))
    expect(screen.getByTestId('lock-pin-status').textContent).toBe('Not set')
  })
})
