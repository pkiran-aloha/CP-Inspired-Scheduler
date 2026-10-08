import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useStore } from '../state/store'
import { Icon } from '../ui/Icons'
import { lockCfg, readLockSession, readPin, verifyPin, writeLockSession } from '../lib/screenLock'

const LOCK_EVENT = 'aloha:lock'
/** Lock this tab now (the shell's "Lock now" control). */
export const requestLock = () => window.dispatchEvent(new Event(LOCK_EVENT))

const ACTIVITY = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart']
const CHECK_MS = 15000

/**
 * Local screen lock (mismatch #13). After the idle minutes in Settings → System it
 * covers this tab with an opaque screen and hides everything behind it; it unlocks
 * with this browser's PIN, or with "I'm back" when none is set. After the auto-logout
 * minutes on the lock screen the tab's session ends: Undo history is cleared and the
 * shell remounts (open dialogs close, unsaved drafts are dropped). Saved data stays.
 * The lock is tab-local (sessionStorage), so another tab's save never unlocks it.
 */
export default function ScreenLock({ onSessionEnd }) {
  const { settings, actions } = useStore()
  const cfg = lockCfg(settings)
  const [session, setSession] = useState(() => readLockSession())
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [hasPin, setHasPin] = useState(false)
  const last = useRef(Date.now())
  const rootRef = useRef(null)
  const locked = !!session

  const lockNow = () => setSession((s) => s || { lockedAt: Date.now(), ended: false })

  useEffect(() => { writeLockSession(session) }, [session])

  useEffect(() => {
    window.addEventListener(LOCK_EVENT, lockNow)
    return () => window.removeEventListener(LOCK_EVENT, lockNow)
  }, [])

  // Idle tracking. A handler only stamps a time, so it is cheap enough to run on every event.
  useEffect(() => {
    if (locked || !cfg.enabled) return
    last.current = Date.now()
    const mark = () => { last.current = Date.now() }
    const check = () => { if (Date.now() - last.current >= cfg.lockMinutes * 60000) lockNow() }
    // Coming back to the tab is activity, but only after checking how long it sat idle.
    const onVisible = () => { if (document.visibilityState === 'visible') { check(); mark() } }
    ACTIVITY.forEach((t) => window.addEventListener(t, mark, { passive: true, capture: true }))
    document.addEventListener('visibilitychange', onVisible)
    const timer = setInterval(check, CHECK_MS)
    return () => {
      ACTIVITY.forEach((t) => window.removeEventListener(t, mark, { capture: true }))
      document.removeEventListener('visibilitychange', onVisible)
      clearInterval(timer)
    }
  }, [locked, cfg.enabled, cfg.lockMinutes])

  // Auto-logout: time on the lock screen, counted from when it locked (survives a reload).
  useEffect(() => {
    if (!session || session.ended) return
    const check = () => {
      if (Date.now() - session.lockedAt < cfg.logoutMinutes * 60000) return
      actions.endSession()
      onSessionEnd?.()
      setSession({ ...session, ended: true })
    }
    check()
    const timer = setInterval(check, CHECK_MS)
    return () => clearInterval(timer)
  }, [session, cfg.logoutMinutes])

  // While locked: hide everything else on the page (before paint), keep keys away from it, trap focus here.
  useLayoutEffect(() => {
    if (!locked) return
    setHasPin(!!readPin())
    setPin('')
    setError('')
    document.body.classList.add('is-locked')
    document.activeElement?.blur?.()
    const root = rootRef.current
    const focusables = () => [...root.querySelectorAll('input, button')].filter((el) => !el.disabled)
    focusables()[0]?.focus()
    const outside = (e) => {
      if (e.target instanceof Node && root.contains(e.target)) return
      e.stopImmediatePropagation()
      e.preventDefault()
      focusables()[0]?.focus()
    }
    const inside = (e) => {
      if (e.key === 'Tab') {
        const els = focusables()
        const i = els.indexOf(document.activeElement)
        const next = e.shiftKey ? (i <= 0 ? els.length - 1 : i - 1) : (i === els.length - 1 ? 0 : i + 1)
        e.preventDefault()
        els[next]?.focus()
      }
      e.stopPropagation() // the app's own shortcuts (Undo, arrows, Escape) never see a key typed here
    }
    window.addEventListener('keydown', outside, true)
    root.addEventListener('keydown', inside)
    return () => {
      document.body.classList.remove('is-locked')
      window.removeEventListener('keydown', outside, true)
      root.removeEventListener('keydown', inside)
    }
  }, [locked])

  const unlock = async (e) => {
    e.preventDefault()
    const rec = readPin()
    if (rec) {
      setBusy(true)
      let ok = false
      try { ok = await verifyPin(pin, rec) } catch (err) { setError(err.message); setBusy(false); return }
      setBusy(false)
      if (!ok) { setError('That PIN does not match. Try again.'); setPin(''); return }
    }
    last.current = Date.now()
    setSession(null)
  }

  if (!locked) return null
  return createPortal(
    <div className="lock-root" ref={rootRef} role="dialog" aria-modal="true" aria-labelledby="lock-title" data-testid="lock-screen">
      <form className="lock-card" onSubmit={unlock}>
        <span className="lock-ic">{Icon.lock({ size: 22 })}</span>
        <h2 id="lock-title">Screen locked</h2>
        <p className="lock-sub">The workspace is hidden on this tab. Nothing was signed out or sent, and saved work stays in this browser.</p>
        {session.ended && (
          <p className="lock-ended" role="status" data-testid="lock-ended">
            Session ended after {cfg.logoutMinutes} minutes locked: Undo history was cleared and any open dialog closed without saving. Saved work is unchanged.
          </p>
        )}
        {hasPin ? (
          <>
            <label className="lock-label" htmlFor="lock-pin">Workspace PIN</label>
            <input
              id="lock-pin" data-testid="lock-pin" type="password" inputMode="numeric" autoComplete="off"
              maxLength={12} value={pin} onChange={(ev) => { setPin(ev.target.value.replace(/\D/g, '')); setError('') }}
              aria-invalid={!!error} aria-describedby={error ? 'lock-error' : undefined}
            />
            {error && <p id="lock-error" className="lock-error" role="alert" data-testid="lock-error">{error}</p>}
            <button className="btn btn-primary" type="submit" disabled={busy || !pin} data-testid="lock-unlock">{busy ? 'Checking…' : 'Unlock'}</button>
            <p className="lock-note">Forgot the PIN? Close this tab and reopen the app. This lock is a privacy screen for this tab, not a sign-in.</p>
          </>
        ) : (
          <button className="btn btn-primary" type="submit" data-testid="lock-unlock">I’m back</button>
        )}
      </form>
    </div>,
    document.body,
  )
}
