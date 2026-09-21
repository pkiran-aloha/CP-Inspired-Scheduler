import React, { useMemo } from 'react'
import { useStore, visibleApptsFor } from '../state/store'
import { DAY_SHORT, fmtTime, parseISO, todayISO } from '../lib/date'
import { TYPES } from '../lib/model'
import { Icon } from '../ui/Icons'

export default function MonthView({ days, onOpenDetail, onCreateAt, onPickSlot }) {
  const state = useStore()
  const { ui, settings } = state
  const today = todayISO()
  const centerMonth = parseISO(days[Math.floor(days.length / 2)]).getMonth()

  const byDay = useMemo(() => {
    const m = {}
    for (const d of days) m[d] = visibleApptsFor(state, d)
    return m
  }, [days, state])

  const dows = Array.from({ length: 7 }, (_, i) => DAY_SHORT[(i + settings.weekStart) % 7])

  return (
    <div className="mgrid">
      <div className="mv-scroll">
      <div className="mv-dows">
        {dows.map((d) => (
          <div key={d}>{d}</div>
        ))}
      </div>
      <div className="mv-body">
        {days.map((d) => {
          const dt = parseISO(d)
          const list = byDay[d] || []
          const wknd = dt.getDay() === 0 || dt.getDay() === 6
          const shown = list.slice(0, 3)
          const more = list.length - shown.length
          const hours = list.reduce((m, a) => (TYPES[a.type]?.billable && a.status !== 'cancelled' ? m + (a.end - a.start) / 60 : m), 0)
          return (
            <div key={d} className={`mv-cell ${dt.getMonth() === centerMonth ? '' : 'dim'} ${wknd ? 'wkend' : ''} ${d === today ? 'today' : ''}`} onDoubleClick={() => onCreateAt(d)}>
              <div className="mv-num">
                <button className="btn btn-ghost btn-sm" style={{ padding: 0, minWidth: 22 }} onClick={() => state.actions.setUI({ anchor: d })} title="Go to this day">
                  <b style={{ background: d === today ? 'var(--accent)' : 'transparent', color: d === today ? '#fff' : 'inherit', borderRadius: 8, width: 22, height: 22, display: 'grid', placeItems: 'center' }}>{dt.getDate()}</b>
                </button>
                <span style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
                  {hours > 0 && <span className="muted" style={{ fontSize: 9.5, fontWeight: 700 }}>{Math.round(hours)}h</span>}
                  <button className="mv-add" onClick={() => onCreateAt(d)} aria-label="Add appointment" title="Add appointment">
                    {Icon.plus({ size: 11, strokeWidth: 2.6 })}
                  </button>
                </span>
              </div>
              {shown.map((a) => {
                const t = TYPES[a.type] || TYPES.service
                return (
                  <button key={a.id} className="mv-chip" style={{ '--c': t.color, '--cd': t.ink }} onClick={(e) => { e.stopPropagation(); onOpenDetail(a.id) }} title={`${a.title} · ${fmtTime(a.start, settings.h24)}`}>
                    <i />
                    <time>{fmtTime(a.start, settings.h24)}</time>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.title}</span>
                  </button>
                )
              })}
              {more > 0 && (
                <button className="mv-more" onClick={() => state.actions.setUI({ anchor: d, view: 'day' })}>
                  +{more} more
                </button>
              )}
            </div>
          )
        })}
      </div>
      </div>
    </div>
  )
}
