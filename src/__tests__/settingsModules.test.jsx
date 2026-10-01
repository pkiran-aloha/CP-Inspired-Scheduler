import React from 'react'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import App from '../App'
import { SETTINGS_MODULES } from '../lib/settingsMasters'

const KEY = 'aloha-aba.v3'
const stored = () => { try { return JSON.parse(localStorage.getItem(KEY)) } catch { return null } }
let _r = null
function cleanup() { if (_r) { _r.unmount(); _r = null } }
beforeEach(() => { localStorage.clear(); cleanup() })
afterEach(() => cleanup())
const R = (ui) => { cleanup(); _r = render(ui); return _r }

async function openSettings() {
  R(<App />)
  fireEvent.click(await screen.findByTestId('nav-settings'))
  await screen.findByTestId('settings-modal')
}

describe('settings shell — every module and sub-tab renders', () => {
  it('renders the module nav with the 13 modules in the reference order', async () => {
    await openSettings()
    const nav = screen.getByTestId('settings-nav')
    expect(nav.querySelectorAll('.set-navitem').length).toBe(SETTINGS_MODULES.length)
    expect(SETTINGS_MODULES.map((m) => m.label)).toEqual([
      'Appointment Status', 'Custom Lists', 'Custom Fields', 'Data Import', 'Organization', 'Payroll',
      'Qualification', 'Services', 'Security', 'Clinical Integrations', 'Text Messaging Services',
      'System Settings', 'Subscription Portal',
    ])
  })

  it('opens every module without a crash and remembers the selection', { timeout: 60000 }, async () => {
    await openSettings()
    for (const m of SETTINGS_MODULES) {
      fireEvent.click(screen.getByTestId(`set-mod-${m.id}`))
      await screen.findByTestId(`settings-panel-${m.id}`)
      expect(screen.getByTestId('settings-title').textContent).toBe(m.label)
      await waitFor(() => expect(stored().ui.settingsModule).toBe(m.id))
      for (const t of m.tabs || []) {
        fireEvent.click(screen.getByTestId(`set-sub-${t.id}`))
        await waitFor(() => expect(stored().ui.settingsSub).toBe(t.id))
      }
    }
  })

  it('renders no raw testid text and no undefined labels in any panel', async () => {
    await openSettings()
    for (const m of SETTINGS_MODULES) {
      fireEvent.click(screen.getByTestId(`set-mod-${m.id}`))
      const body = (await screen.findByTestId(`settings-panel-${m.id}`)).textContent
      expect(body).not.toMatch(/undefined|NaN|\[object Object\]/)
    }
  })
})
