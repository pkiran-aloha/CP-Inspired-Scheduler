import React, { useEffect } from 'react'
import { fmtDayLabel, fmtTime } from '../lib/date'
import { TYPES } from '../lib/model'
import { Icon } from '../ui/Icons'
import { useStore } from '../state/store'

export default function TypePicker({ slot, onPick, onClose }) {
  const { settings } = useStore()
  useEffect(() => {
    const h = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  const main = [TYPES.service, TYPES.drive, TYPES.break, TYPES.unavailable]
  const more = [TYPES.evaluation, TYPES.supervision]

  const slotLabel = slot?.start != null ? `${fmtDayLabel(slot.date, 'full')} · ${fmtTime(slot.start, settings.h24)} – ${fmtTime(slot.end, settings.h24)}` : fmtDayLabel(slot?.date || '', 'full')

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal picker" role="dialog" aria-label="Choose appointment type">
        <div className="modal-head">
          <h2>Create New Appointment</h2>
          <span className="sbadge" style={{ marginLeft: 6 }}>
            {Icon.clock({ size: 12 })} {slotLabel}
          </span>
          <span className="spacer f1" />
          <button className="modal-x" onClick={onClose} aria-label="Close">
            {Icon.x({ size: 14 })}
          </button>
        </div>
        <div style={{ padding: '6px 20px 0', color: 'var(--muted)', fontSize: 12, fontWeight: 650 }}>Choose appointment type</div>
        <div className="pick-grid">
          {main.map((t) => (
            <button key={t.key} data-testid={`type-${t.key}`} className="pick-card" style={{ '--c': t.color }} onClick={() => onPick(t.key)}>
              <span className="pi" style={{ background: t.color }}>
                {Icon[t.icon]({ size: 17 })}
              </span>
              <span>
                <b>{t.label}</b>
                <span>{t.desc}</span>
              </span>
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, padding: '0 20px 14px', alignItems: 'center' }}>
          <span className="muted" style={{ fontSize: 11, fontWeight: 700 }}>MORE</span>
          {more.map((t) => (
            <button key={t.key} className="pill" style={{ ['--c']: t.color, cursor: 'pointer', padding: '4px 10px' }} onClick={() => onPick(t.key)}>
              <i style={{ width: 7, height: 7, borderRadius: 3, background: t.color }} />
              {t.label}
            </button>
          ))}
          <span className="f1" />
          <span className="muted" style={{ fontSize: 11 }}>
            <span className="kbd">Esc</span> cancel
          </span>
        </div>
      </div>
    </div>
  )
}
