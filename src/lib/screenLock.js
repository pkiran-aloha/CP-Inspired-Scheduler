import { systemConfigFor } from './settingsMasters'

/**
 * Local screen lock (architecture mismatch #13). This is a privacy screen for one
 * browser tab, not a sign-in: the workspace itself stays readable in this browser's
 * storage. The PIN lives under its own device key, never in the workspace, so it
 * is never in a backup, an Undo step or another tab's adopted save.
 */
export const PIN_KEY = 'aloha-aba.lock-pin'
/** sessionStorage (this tab only): survives a reload, is never shared with other tabs. */
export const LOCK_SESSION_KEY = 'aloha-aba.lock-session'
export const PIN_ITERATIONS = 100000

export function lockCfg(settings) {
  const g = systemConfigFor(settings).general || {}
  const mins = (v, d) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d)
  return {
    enabled: g.screenLockEnabled === true,
    lockMinutes: mins(g.screenLockMinutes, 15),
    logoutMinutes: mins(g.autoLogoutMinutes, 60),
  }
}

/** Why a PIN cannot be used, or null. */
export const pinProblem = (pin) => (/^\d{4,12}$/.test(String(pin ?? '')) ? null : 'Use 4 to 12 digits.')

const toHex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
const fromHex = (hex) => new Uint8Array(hex.match(/../g).map((h) => parseInt(h, 16)))

async function derive(pin, saltHex, iterations) {
  const subtle = globalThis.crypto?.subtle
  if (!subtle) throw new Error('This browser cannot hash a PIN here (Web Crypto is unavailable).')
  const key = await subtle.importKey('raw', new TextEncoder().encode(String(pin)), 'PBKDF2', false, ['deriveBits'])
  return toHex(await subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: fromHex(saltHex), iterations }, key, 256))
}

/** A salted PBKDF2-SHA-256 record of the PIN. The PIN itself is never kept. */
export async function hashPin(pin, iterations = PIN_ITERATIONS) {
  const problem = pinProblem(pin)
  if (problem) throw new Error(problem)
  const salt = toHex(globalThis.crypto.getRandomValues(new Uint8Array(16)))
  return { v: 1, algo: 'PBKDF2-SHA-256', iterations, salt, hash: await derive(pin, salt, iterations) }
}

export async function verifyPin(pin, rec) {
  if (!validRecord(rec) || pinProblem(pin)) return false
  return (await derive(pin, rec.salt, rec.iterations)) === rec.hash
}

const validRecord = (rec) => !!rec && /^[0-9a-f]{32}$/.test(rec.salt) && /^[0-9a-f]{64}$/.test(rec.hash) && Number.isInteger(rec.iterations) && rec.iterations > 0

/** The saved PIN record for this browser, or null (missing, unreadable or malformed). */
export function readPin(storage = globalThis.localStorage) {
  try {
    const rec = JSON.parse(storage.getItem(PIN_KEY) || 'null')
    return validRecord(rec) ? rec : null
  } catch { return null }
}
export function writePin(rec, storage = globalThis.localStorage) {
  storage.setItem(PIN_KEY, JSON.stringify(rec))
}
export function clearPin(storage = globalThis.localStorage) {
  storage.removeItem(PIN_KEY)
}

/** This tab's lock: { lockedAt, ended } or null. */
export function readLockSession(storage = globalThis.sessionStorage) {
  try {
    const s = JSON.parse(storage.getItem(LOCK_SESSION_KEY) || 'null')
    return s && Number.isFinite(s.lockedAt) ? { lockedAt: s.lockedAt, ended: s.ended === true } : null
  } catch { return null }
}
export function writeLockSession(s, storage = globalThis.sessionStorage) {
  try {
    if (s) storage.setItem(LOCK_SESSION_KEY, JSON.stringify(s))
    else storage.removeItem(LOCK_SESSION_KEY)
  } catch { /* the lock still holds in memory for this tab */ }
}
