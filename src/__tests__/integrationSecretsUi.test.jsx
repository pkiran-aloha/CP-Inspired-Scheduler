import React from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import App from '../App'
import { blankState } from '../state/store'

const KEY = 'aloha-aba.v3'
const BASE = blankState()
beforeEach(() => localStorage.clear())
afterEach(() => cleanup())

describe('integration credential safety UI', () => {
  it('does not offer key/token entry and explains why to users', async () => {
    const oldRows = BASE.settings.clinicalIntegrations.map((row) => row.id === 'int-fhir'
      ? { ...row, apiKey: 'fake-key-for-test-only', token: 'fake-token-for-test-only' }
      : row)
    localStorage.setItem(KEY, JSON.stringify({
      ...BASE,
      settings: { ...BASE.settings, clinicalIntegrations: oldRows },
    }))

    render(<App />)
    fireEvent.click(await screen.findByTestId('nav-settings'))
    await screen.findByTestId('settings-page')
    const settingsLists = screen.getByRole('group', { name: 'Settings lists' })
    fireEvent.click(within(settingsLists).getByRole('button', { name: 'Clinical Integrations', exact: true }))
    fireEvent.click(await screen.findByTestId('set-integration-int-fhir'))

    expect(screen.queryByTestId('set-integration-apikey')).toBeNull()
    expect(screen.getByTestId('set-integrations-note').textContent).toMatch(/no server-side secret vault/i)
    expect(screen.getByTestId('set-integrations-note').textContent).toMatch(/do not enter live credentials/i)
    await waitFor(() => {
      const cleaned = JSON.parse(localStorage.getItem(KEY)).settings.clinicalIntegrations.find((row) => row.id === 'int-fhir')
      expect(cleaned).not.toHaveProperty('apiKey')
      expect(cleaned).not.toHaveProperty('token')
    })
  })
})
