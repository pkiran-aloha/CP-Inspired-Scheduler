import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { Icon } from './Icons'

const ToastCtx = createContext(() => {})
export const useToast = () => useContext(ToastCtx)

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])
  const seq = useRef(0)
  const timers = useRef(new Set())

  // Clear pending auto-dismiss timers on unmount so none fire after teardown
  // (e.g. after the test DOM is gone) and call setState on an unmounted tree.
  useEffect(() => {
    const pending = timers.current
    return () => {
      pending.forEach((h) => clearTimeout(h))
      pending.clear()
    }
  }, [])

  const push = useCallback(({ message, kind = 'ok', action, duration = 3800 }) => {
    const id = ++seq.current
    setToasts((t) => [...t, { id, message, kind, action }])
    if (duration) {
      const h = setTimeout(() => {
        timers.current.delete(h)
        setToasts((t) => t.filter((x) => x.id !== id))
      }, duration)
      timers.current.add(h)
    }
  }, [])

  const dismiss = (id) => setToasts((t) => t.filter((x) => x.id !== id))

  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`}>
            <span className="toast-ic">
              {t.kind === 'ok' ? Icon.checkCircle({ size: 16 }) : t.kind === 'warn' ? Icon.alert({ size: 16 }) : Icon.info({ size: 16 })}
            </span>
            <span className="toast-msg">{t.message}</span>
            {t.action && (
              <button
                className="toast-action"
                onClick={() => {
                  t.action.onClick()
                  dismiss(t.id)
                }}
              >
                {t.action.label}
              </button>
            )}
            <button className="toast-x" onClick={() => dismiss(t.id)} aria-label="Dismiss">
              {Icon.x({ size: 12 })}
            </button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  )
}
