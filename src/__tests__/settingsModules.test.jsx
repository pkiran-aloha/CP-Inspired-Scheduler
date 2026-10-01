import React from 'react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import App from '../App'
import { blankState, serializeForStorage, STORAGE_KEY } from '../state/store'
import { SETTINGS_MODULES } from '../lib/settingsMasters'

const stored = () => { try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) } catch { return null } }
let _r = null
function cleanup() { if (_r) { _r.unmount(); _r = null } }
beforeEach(() => { localStorage.clear(); cleanup() })
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
const R = (ui) => { cleanup(); _r = render(ui); return _r }

function saveUI(patch) {
  const state = blankState()
  state.ui = { ...state.ui, ...patch }
  localStorage.setItem(STORAGE_KEY, serializeForStorage(state))
}

function expectSingleSettingsView() {
  expect(screen.getAllByTestId('settings-page')).toHaveLength(1)
  expect(document.querySelectorAll('[data-testid^="settings-panel-"]')).toHaveLength(1)
  expect(screen.queryByTestId('settings-nav')).toBeNull()
  expect(screen.queryByTestId('settings-subtabs')).toBeNull()
  expect(screen.getByTestId('settings-page').querySelector('.set-nav')).toBeNull()
}

async function openSettings() {
  R(<App />)
  fireEvent.click(await screen.findByTestId('nav-settings'))
  await screen.findByTestId('settings-page')
}

describe('settings sidebar — every module and sub-tab renders once', () => {
  it('renders all 13 modules only in the main sidebar, in the reference order', async () => {
    await openSettings()
    const nav = screen.getByRole('group', { name: 'Settings lists' })
    expect(nav.closest('nav')).toBe(screen.getByTestId('navrail'))
    expect([...nav.querySelectorAll('.nr-subitem:not(.nr-subchild)')].map((el) => el.textContent)).toEqual(SETTINGS_MODULES.map((m) => m.label))
    expect(SETTINGS_MODULES.map((m) => m.label)).toEqual([
      'Appointment Status', 'Custom Lists', 'Custom Fields', 'Data Import', 'Organization', 'Payroll',
      'Qualification', 'Services', 'Security', 'Clinical Integrations', 'Text Messaging Services',
      'System Settings', 'Subscription Portal',
    ])
    for (const m of SETTINGS_MODULES) {
      expect(within(nav).getAllByRole('button', { name: m.label, exact: true })).toHaveLength(1)
    }
    expectSingleSettingsView()
  })

  it('opens every module and sub-tab through the sidebar and remembers the selection', { timeout: 60000 }, async () => {
    await openSettings()
    for (const m of SETTINGS_MODULES) {
      const moduleButton = screen.getByTestId(`nav-sub-set-${m.id}`)
      fireEvent.click(moduleButton)
      await screen.findByTestId(`settings-panel-${m.id}`)
      expect(screen.getByTestId('settings-title').textContent).toBe(m.label)
      expect(moduleButton.classList.contains('on')).toBe(true)
      expectSingleSettingsView()
      await waitFor(() => expect(stored().ui.settingsModule).toBe(m.id))
      for (const t of m.tabs || []) {
        const tabButton = screen.getByTestId(`nav-sub-set-${m.id}-${t.id}`)
        fireEvent.click(tabButton)
        expect(tabButton.classList.contains('on')).toBe(true)
        expectSingleSettingsView()
        await waitFor(() => expect(stored().ui.settingsSub).toBe(t.id))
      }
    }
  })

  it('renders no raw testid text and no undefined labels in any panel', async () => {
    await openSettings()
    for (const m of SETTINGS_MODULES) {
      fireEvent.click(screen.getByTestId(`nav-sub-set-${m.id}`))
      const body = (await screen.findByTestId(`settings-panel-${m.id}`)).textContent
      expect(body).not.toMatch(/undefined|NaN|\[object Object\]/)
    }
  })

  it('navigates the nested hierarchy without another settings menu or sub-tab strip', async () => {
    await openSettings()
    fireEvent.click(screen.getByTestId('nav-sub-set-payroll'))
    await screen.findByTestId('settings-panel-payroll')
    await waitFor(() => expect(stored().ui.settingsModule).toBe('payroll'))

    fireEvent.click(screen.getByTestId('nav-sub-set-payroll-earning-codes'))
    await waitFor(() => expect(stored().ui.settingsSub).toBe('earning-codes'))
    expect(screen.getByTestId('set-codes')).toBeTruthy()
    expectSingleSettingsView()

    fireEvent.click(screen.getByTestId('nav-sub-set-system'))
    await screen.findByTestId('settings-panel-system')
    expect(screen.getByTestId('set-sys-tab-general')).toBeTruthy()
    expect(screen.getByTestId('set-sys-tab-clearinghouse')).toBeTruthy()
    expect(screen.getByTestId('set-sys-tab-validations')).toBeTruthy()
    fireEvent.click(screen.getByTestId('set-sys-tab-validations'))
    expect(await screen.findByTestId('set-sys-validations')).toBeTruthy()
  })

  it.each(['rail', 'keyboard shortcut', 'profile menu', 'command palette'])('expands a saved collapsed sidebar when Settings opens from the %s', async (entry) => {
    saveUI({ nav: true })
    R(<App />)
    expect(screen.getByTestId('navrail').classList.contains('collapsed')).toBe(true)

    if (entry === 'rail') fireEvent.click(screen.getByTestId('nav-settings'))
    else if (entry === 'keyboard shortcut') fireEvent.keyDown(window, { key: '0' })
    else if (entry === 'profile menu') {
      fireEvent.click(screen.getByText(/Admin · Aloha/))
      fireEvent.click(screen.getByText('Settings', { selector: '.menu *' }))
    } else {
      fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
      const input = await screen.findByTestId('palette-input')
      fireEvent.change(input, { target: { value: 'Overtime rules' } })
      fireEvent.keyDown(input, { key: 'Enter' })
      expect(screen.getByTestId('nav-sub-set-payroll-overtime').classList.contains('on')).toBe(true)
    }

    await screen.findByTestId('settings-page')
    expect(screen.getByTestId('navrail').classList.contains('collapsed')).toBe(false)
    expect(screen.getByTestId('nav-sub-set-organization')).toBeTruthy()
    expectSingleSettingsView()
    await waitFor(() => expect(stored().ui.nav).toBe(false))

    // The explicit Collapse control still works; opening Settings reveals it again.
    fireEvent.click(screen.getByTestId('nav-collapse'))
    expect(screen.getByTestId('navrail').classList.contains('collapsed')).toBe(true)
    fireEvent.click(screen.getByTestId('nav-settings'))
    expect(screen.getByTestId('navrail').classList.contains('collapsed')).toBe(false)
    expectSingleSettingsView()
  })

  it('reveals the settings hierarchy on a narrow viewport instead of relying on an in-page menu', async () => {
    vi.stubGlobal('matchMedia', vi.fn((query) => ({
      matches: query === '(max-width: 1279px)',
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })))
    await openSettings()
    expect(screen.getByTestId('navrail').classList.contains('collapsed')).toBe(false)
    fireEvent.click(screen.getByTestId('nav-sub-set-payroll'))
    fireEvent.click(screen.getByTestId('nav-sub-set-payroll-overtime'))
    expect(screen.getByTestId('set-ot-mult')).toBeTruthy()
    expectSingleSettingsView()
  })

  it('keeps the selected module and sub-tab when reopening Settings or reloading', async () => {
    await openSettings()
    fireEvent.click(screen.getByTestId('nav-sub-set-payroll'))
    fireEvent.click(screen.getByTestId('nav-sub-set-payroll-overtime'))
    await waitFor(() => expect(stored().ui.settingsSub).toBe('overtime'))
    fireEvent.click(screen.getByTestId('nav-calendar'))
    expect(screen.queryByTestId('settings-page')).toBeNull()
    fireEvent.click(screen.getByTestId('nav-settings'))
    await waitFor(() => expect(stored().ui.section).toBe('settings'))
    R(<App />)
    expect(screen.getByTestId('nav-sub-set-payroll-overtime').classList.contains('on')).toBe(true)
    expect(screen.getByTestId('set-ot-mult')).toBeTruthy()
    expectSingleSettingsView()
  })

  it.each([
    ['retired-module', 'roles', 'organization', null],
    ['payroll', 'roles', 'payroll', 'general'],
  ])('keeps the sidebar and panel in sync for stale saved selection %s / %s', async (module, sub, activeModule, activeSub) => {
    saveUI({ section: 'settings', nav: false, settingsModule: module, settingsSub: sub })
    R(<App />)
    expect(screen.getByTestId(`nav-sub-set-${activeModule}`).classList.contains('on')).toBe(true)
    expect(await screen.findByTestId(`settings-panel-${activeModule}`)).toBeTruthy()
    if (activeSub) expect(screen.getByTestId(`nav-sub-set-${activeModule}-${activeSub}`).classList.contains('on')).toBe(true)
    expectSingleSettingsView()
  })
})
