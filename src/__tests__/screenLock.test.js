import { describe, it, expect, beforeEach } from 'vitest'
import { blankState } from '../state/store'
import { clearPin, hashPin, lockCfg, pinProblem, PIN_KEY, readLockSession, readPin, verifyPin, writeLockSession, writePin } from '../lib/screenLock'
import { normalizeSettingsMasters, planSettingsOp, systemConfigFor } from '../lib/settingsMasters'
import { createWorkspaceBackup, readWorkspaceBackup } from '../lib/workspaceBackup'
import { authorizeAction } from '../lib/security'

const BASE = blankState()
beforeEach(() => { localStorage.clear(); sessionStorage.clear() })

describe('screen lock PIN', () => {
  it('accepts 4 to 12 digits only', () => {
    expect(pinProblem('1234')).toBeNull()
    expect(pinProblem('123456789012')).toBeNull()
    for (const bad of ['123', '1234567890123', '12a4', '', null]) expect(pinProblem(bad)).toMatch(/4 to 12 digits/)
  })

  it('keeps only a salted hash and verifies the right PIN', async () => {
    const rec = await hashPin('4821', 1000)
    expect(JSON.stringify(rec)).not.toContain('4821')
    expect(rec.salt).toMatch(/^[0-9a-f]{32}$/)
    expect(await verifyPin('4821', rec)).toBe(true)
    expect(await verifyPin('4822', rec)).toBe(false)
    const again = await hashPin('4821', 1000)
    expect(again.hash).not.toBe(rec.hash) // fresh salt each time
  })

  it('reads only a well-formed record from its own device key', async () => {
    expect(readPin()).toBeNull()
    localStorage.setItem(PIN_KEY, '{"hash":"nope"}')
    expect(readPin()).toBeNull()
    localStorage.setItem(PIN_KEY, 'not json')
    expect(readPin()).toBeNull()
    const rec = await hashPin('9090', 1000)
    writePin(rec)
    expect(readPin()).toEqual(rec)
    clearPin()
    expect(readPin()).toBeNull()
  })

  it('never puts the PIN hash in a workspace backup', async () => {
    const rec = await hashPin('2468', 1000)
    writePin(rec)
    const json = createWorkspaceBackup(BASE)
    expect(json).not.toContain(rec.hash)
    expect(json).not.toContain(rec.salt)
    expect(json).not.toContain(PIN_KEY)
  })
})

describe('screen lock settings', () => {
  it('defaults to off, 15 minutes idle and 60 minutes to auto-logout', () => {
    expect(lockCfg(BASE.settings)).toEqual({ enabled: false, lockMinutes: 15, logoutMinutes: 60 })
    expect(lockCfg({})).toEqual({ enabled: false, lockMinutes: 15, logoutMinutes: 60 })
  })

  it('migrates older saves to an explicit off switch, idempotently', () => {
    const general = { ...BASE.settings.system.general }
    delete general.screenLockEnabled
    const old = { ...BASE, settings: { ...BASE.settings, system: { ...BASE.settings.system, general } } }
    const once = normalizeSettingsMasters(old)
    expect(once.settings.system.general.screenLockEnabled).toBe(false)
    expect(normalizeSettingsMasters(once)).toBe(once)
    expect(normalizeSettingsMasters(BASE)).toBe(BASE)
  })

  it('validates the lock fields and refuses to require MFA', () => {
    const op = (general) => planSettingsOp(BASE, 'systemConfig.patch', { patch: { general: { ...systemConfigFor(BASE.settings).general, ...general } } })
    expect(op({ screenLockEnabled: true }).ok).toBe(true)
    expect(op({ screenLockMinutes: 30, autoLogoutMinutes: 10 }).ok).toBe(true)
    expect(op({ screenLockMinutes: 0 }).msg).toMatch(/1 to 240/)
    expect(op({ screenLockMinutes: 2.5 }).ok).toBe(false)
    expect(op({ autoLogoutMinutes: 4 }).msg).toMatch(/5 to 480/)
    expect(op({ screenLockEnabled: 'yes' }).ok).toBe(false)
    expect(op({ mfaRequired: true }).msg).toMatch(/production sign-in/)
    // A legacy saved "MFA required" never blocks other General edits.
    const legacy = { ...BASE, settings: { ...BASE.settings, system: { ...BASE.settings.system, general: { ...BASE.settings.system.general, mfaRequired: true } } } }
    const res = planSettingsOp(legacy, 'systemConfig.patch', { patch: { general: { ...systemConfigFor(legacy.settings).general, screenLockMinutes: 20 } } })
    expect(res.ok).toBe(true)
  })

  it('round-trips the lock policy through a backup', () => {
    const on = { ...BASE, settings: { ...BASE.settings, system: { ...BASE.settings.system, general: { ...BASE.settings.system.general, screenLockEnabled: true, screenLockMinutes: 7 } } } }
    const { data } = readWorkspaceBackup(createWorkspaceBackup(on), BASE)
    expect(lockCfg(data.settings)).toMatchObject({ enabled: true, lockMinutes: 7 })
  })

  it('authorizes endSession for every role (it changes no records)', () => {
    expect(authorizeAction(BASE, { type: 'endSession' }).ok).toBe(true)
  })

  it('keeps the tab lock in sessionStorage', () => {
    expect(readLockSession()).toBeNull()
    writeLockSession({ lockedAt: 5, ended: false })
    expect(readLockSession()).toEqual({ lockedAt: 5, ended: false })
    writeLockSession(null)
    expect(readLockSession()).toBeNull()
  })
})
