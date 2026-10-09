import React from 'react'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import App from '../App'
import { calendarHourPx, densityOf, DENSITIES } from '../lib/viewDensity'
import { planSettingsOp } from '../lib/settingsMasters'
import { authorizeAction } from '../lib/security'
import { blankState } from '../state/store'

const stored = () => JSON.parse(localStorage.getItem('aloha-aba.v3') || '{}')
const attr = () => document.documentElement.getAttribute('data-density')

afterEach(cleanup)
beforeEach(() => { localStorage.clear(); document.documentElement.removeAttribute('data-density') })

describe('view density logic', () => {
  it('reads normal unless a known mode is saved', () => {
    expect(densityOf(undefined)).toBe('normal')
    expect(densityOf({})).toBe('normal')
    expect(densityOf({ density: 'huge' })).toBe('normal')
    for (const d of DENSITIES) expect(densityOf({ density: d })).toBe(d)
  })

  it('normal keeps the original calendar hour height; relaxed is taller and tight shorter', () => {
    expect(calendarHourPx(0, 'normal')).toBe(56)
    expect(calendarHourPx(800, 'normal')).toBe(Math.round(792 / 13))
    expect(calendarHourPx(100, 'normal')).toBe(52)
    expect(calendarHourPx(5000, 'normal')).toBe(88)
    const h = 800
    expect(calendarHourPx(h, 'relaxed')).toBeGreaterThan(calendarHourPx(h, 'normal'))
    expect(calendarHourPx(h, 'tight')).toBeLessThan(calendarHourPx(h, 'normal'))
    // a 15-minute session in tight is still at least 11px tall
    expect(calendarHourPx(100, 'tight') / 4).toBeGreaterThanOrEqual(11)
  })

  it('the system settings plan accepts the three modes and refuses others', () => {
    const s = blankState()
    expect(planSettingsOp(s, 'system.patch', { patch: { density: 'tight' } }).ok).toBe(true)
    expect(planSettingsOp(s, 'system.patch', { patch: { density: 'huge' } }).ok).toBe(false)
  })

  it('a density switch needs no settings access, like the theme', () => {
    const s = blankState()
    const account = { id: 'density-account', roleId: 'density-role', status: 'active', officeIds: ['*'] }
    const role = { id: 'density-role', permissions: { calendar: 'view' } }
    const viewer = { ...s, security: { ...s.security, currentUserId: account.id, accounts: [...s.security.accounts, account], roles: [...s.security.roles, role] } }
    expect(authorizeAction(viewer, { type: 'setSettings', patch: { density: 'tight' } }).ok).toBe(true)
    expect(authorizeAction(viewer, { type: 'setSettings', patch: { weekStart: 1 } }).ok).toBe(false)
  })
})

describe('view density picker', () => {
  it('defaults to normal, switches from Settings, and persists across reload', async () => {
    render(<App />)
    await waitFor(() => expect(attr()).toBe('normal'))
    fireEvent.click(await screen.findByTestId('nav-settings'))
    await screen.findByTestId('settings-modal')
    fireEvent.click(screen.getByTestId('nav-sub-set-system'))
    fireEvent.click(await screen.findByTestId('set-sys-tab-general'))
    fireEvent.click(await screen.findByTestId('set-sys-density-tight'))
    await waitFor(() => expect(attr()).toBe('tight'))
    expect(screen.getByTestId('set-sys-density-tight').getAttribute('aria-pressed')).toBe('true')
    await waitFor(() => expect(stored().settings.density).toBe('tight'))
    cleanup()
    document.documentElement.removeAttribute('data-density')
    render(<App />)
    await waitFor(() => expect(attr()).toBe('tight'))
  })

  it('switches from the command palette', async () => {
    render(<App />)
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    const input = await screen.findByTestId('palette-input')
    fireEvent.change(input, { target: { value: 'View density: Relaxed' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(attr()).toBe('relaxed'))
    await waitFor(() => expect(stored().settings.density).toBe('relaxed'))
  })
})
