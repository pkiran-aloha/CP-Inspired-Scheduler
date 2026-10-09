import React, { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from './Icons'
import { useStore } from '../state/store'

const W = 320 // panel width in px; clamped to the viewport

/**
 * Toggletip: an info button that shows guidance on click or Enter, not on hover.
 * The text lives in a live region, so screen readers read it when it opens.
 * Esc or a click outside closes it. `wiki` (a docs/wiki slug) adds a link into Help.
 */
export default function InfoTip({ label, children, wiki, testid = 'infotip' }) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState(null)
  const id = useId()
  const btn = useRef(null)
  const root = useRef(null)
  const live = useRef(null)
  const actions = useStore()?.actions

  const place = useCallback(() => {
    const r = btn.current?.getBoundingClientRect?.()
    if (!r) return
    const vw = window.innerWidth || 1024
    const vh = window.innerHeight || 768
    const width = Math.min(W, vw - 16)
    const left = Math.max(8, Math.min(r.left, vw - width - 8))
    const below = r.bottom + 6
    setPos(below + 160 > vh && r.top > 200 ? { left, width, bottom: vh - r.top + 6 } : { left, width, top: below })
  }, [])

  useLayoutEffect(() => {
    if (open) place()
  }, [open, place])

  useEffect(() => {
    if (!open) return
    const onDown = (e) => {
      if (!root.current?.contains(e.target) && !live.current?.contains(e.target)) setOpen(false)
    }
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        setOpen(false)
        btn.current?.focus()
      }
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey, true)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey, true)
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open, place])

  const learnMore = () => {
    setOpen(false)
    actions?.setUI({ settings: false, inbox: false, section: 'help', helpPage: wiki })
  }

  return (
    <span className="infotip" ref={root}>
      <button
        ref={btn}
        type="button"
        className="infotip-btn"
        aria-label={`About ${label}`}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          // the panel lives at the end of <body>, so Tab hands focus to its link explicitly
          if (e.key === 'Tab' && !e.shiftKey && open && wiki && actions) {
            e.preventDefault()
            live.current?.querySelector('.infotip-more')?.focus()
          }
        }}
        data-testid={`${testid}-btn`}
      >
        {Icon.info({ size: 15 })}
      </button>
      {/* Portalled to <body>: a fixed panel inside a transformed or blurred header would be
          positioned and clipped by that header instead of the viewport. */}
      {createPortal(
      <span role="status" id={id} className="infotip-live" ref={live}>
        {open && (
          <span className="infotip-panel" style={pos || undefined} data-testid={`${testid}-panel`}>
            <span className="infotip-body">{children}</span>
            {wiki && actions && (
              <button type="button" className="infotip-more" onClick={learnMore}
                onKeyDown={(e) => {
                  if (e.key === 'Tab') {
                    e.preventDefault()
                    setOpen(false)
                    btn.current?.focus()
                  }
                }}
                data-testid={`${testid}-more`}
              >
                Learn more in Help
              </button>
            )}
          </span>
        )}
      </span>,
      document.body,
      )}
    </span>
  )
}
