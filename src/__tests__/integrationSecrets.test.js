import { beforeEach, describe, expect, it } from 'vitest'
import { blankState, initial, reducer, serializeForStorage } from '../state/store'
import { createWorkspaceBackup, readWorkspaceBackup } from '../lib/workspaceBackup'
import { hasIntegrationSecrets } from '../lib/integrationSecrets'
import { integrationsCfg, normalizeSettingsMasters, planSettingsOp } from '../lib/settingsMasters'

beforeEach(() => localStorage.clear())

const BASE = blankState()
const ROW_ID = 'int-fhir'
const legacyRows = (settings) => settings.clinicalIntegrations.map((row) => row.id === ROW_ID
  ? { ...row, apiKey: 'fake-key-for-test-only', api_key: 'fake-snake-key-for-test-only', token: 'fake-token-for-test-only', oauthAccessToken: 'fake-oauth-token-for-test-only', credentials: { clientSecret: 'fake-nested-secret' } }
  : row)
const withLegacySecrets = (state = BASE) => ({
  ...state,
  settings: { ...state.settings, clinicalIntegrations: legacyRows(state.settings) },
})

describe('local integration credential safety', () => {
  it('hides and removes legacy credential fields in the integration resolver', () => {
    const state = withLegacySecrets()
    const row = integrationsCfg(state.settings).find((item) => item.id === ROW_ID)
    expect(row).toBeTruthy()
    expect(hasIntegrationSecrets(row)).toBe(false)
    expect(row).not.toHaveProperty('apiKey')
    expect(row).not.toHaveProperty('token')
  })

  it('rejects new credentials and keeps old values out of unrelated integration edits', () => {
    const rejected = planSettingsOp(BASE, 'integration.patch', {
      id: ROW_ID,
      patch: { apiKey: 'fake-key-for-test-only' },
    })
    expect(rejected.ok).toBe(false)
    expect(rejected.msg).toMatch(/cannot be stored/i)

    const changed = planSettingsOp(withLegacySecrets(), 'integration.patch', {
      id: ROW_ID,
      patch: { note: 'local reference only' },
    })
    expect(changed.ok).toBe(true)
    const saved = changed.patch.clinicalIntegrations.find((item) => item.id === ROW_ID)
    expect(saved.note).toBe('local reference only')
    expect(hasIntegrationSecrets(saved)).toBe(false)
  })

  it('scrubs credentials on workspace normalization and direct settings writes', () => {
    const normalized = normalizeSettingsMasters(withLegacySecrets())
    expect(hasIntegrationSecrets(normalized.settings.clinicalIntegrations)).toBe(false)
    const reloaded = normalizeSettingsMasters(normalized)
    expect(reloaded.settings.clinicalIntegrations).toEqual(normalized.settings.clinicalIntegrations) // no secret fields reappear

    const directWrite = reducer(BASE, {
      type: 'setSettings',
      patch: { clinicalIntegrations: legacyRows(BASE.settings) },
    })
    expect(hasIntegrationSecrets(directWrite.settings.clinicalIntegrations)).toBe(false)
    expect(hasIntegrationSecrets(JSON.parse(serializeForStorage(withLegacySecrets())).settings.clinicalIntegrations)).toBe(false)
  })

  it('scrubs an old localStorage workspace on load and rewrites the saved copy', () => {
    localStorage.setItem('aloha-aba.v3', JSON.stringify(withLegacySecrets()))
    const loaded = initial()
    expect(hasIntegrationSecrets(loaded.settings.clinicalIntegrations)).toBe(false)
    expect(hasIntegrationSecrets(JSON.parse(localStorage.getItem('aloha-aba.v3')).settings.clinicalIntegrations)).toBe(false)
  })

  it('never writes legacy credentials into a plain JSON workspace backup', () => {
    const unsafeState = withLegacySecrets()
    const backup = JSON.parse(createWorkspaceBackup(unsafeState))
    expect(hasIntegrationSecrets(backup.data.settings.clinicalIntegrations)).toBe(false)
    const incomingLegacy = {
      ...backup,
      data: {
        ...backup.data,
        settings: { ...backup.data.settings, clinicalIntegrations: legacyRows(backup.data.settings) },
      },
    }
    const restored = readWorkspaceBackup(incomingLegacy, BASE)
    expect(hasIntegrationSecrets(restored.data.settings.clinicalIntegrations)).toBe(false)

    const oldFormat = Object.fromEntries(['appts', 'claims', 'staff', 'clients', 'teams', 'reports'].map((key) => [key, backup.data[key]]))
    const oldImport = readWorkspaceBackup({
      exported: backup.exported,
      ...oldFormat,
      settings: incomingLegacy.data.settings,
    }, BASE)
    expect(hasIntegrationSecrets(oldImport.data.settings.clinicalIntegrations)).toBe(false)
  })
})
