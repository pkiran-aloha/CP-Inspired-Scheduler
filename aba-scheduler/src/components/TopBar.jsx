import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useStore, visibleApptsFor, weekStats } from '../state/store'
import { Icon } from '../ui/Icons'
import { useToast } from '../ui/Toast'
import { todayISO } from '../lib/date'
import { STATUS_ORDER, STATUSES } from '../lib/model'
import { buildICS, download } from '../lib/ics'
import { scanNeedsCover } from '../lib/smart'

function useOutside(ref, cb, on) {
  useEffect(() => {
    if (!on) return
    const h = (e) => {
      if (!ref.current?.contains(e.target)) cb()
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [on, cb, ref])
}

export default function TopBar({ onPalette,  onNew, onNav, days, label, sub }) {
  const state = useStore()
  const { ui, settings, actions } = state
  const toast = useToast()
  const [menu, setMenu] = useState(null) // 'filter' | 'user'
  const wrapRef = useRef(null)
  useOutside(wrapRef, () => setMenu(null), !!menu)

  const stats = weekStats(state, days)
  const cover = useMemo(() => scanNeedsCover(state, days).length, [state.appts, days])
  const goToday = () => actions.setUI({ anchor: todayISO() })

  const exportICS = () => {
    const list = days.flatMap((d) => visibleApptsFor(state, d))
    if (!list.length) {
      toast({ message: 'Nothing to export in this range', kind: 'warn' })
      return
    }
    const staffById = Object.fromEntries(state.staff.map((s) => [s.id, s]))
    const clientsById = Object.fromEntries(state.clients.map((c) => [c.id, c]))
    download('pulse-aba-calendar.ics', buildICS(list, staffById, clientsById))
    toast({ message: `Exported ${list.length} events to .ics`, kind: 'ok' })
  }

  const f = ui.filters
  const toggleStatus = (s) => {
    const has = f.statuses.includes(s)
    actions.setFilters({ statuses: has ? f.statuses.filter((x) => x !== s) : [...f.statuses, s] })
  }
  const filtersOn = f.statuses.length < STATUS_ORDER.length || f.abaOnly

  return (
    <header className="topbar no-print" ref={wrapRef}>
      <div className="brand">
        <span className="logo">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2 7.5c2.3-2.1 4.4-2.1 6.7 0s4.4 2.1 6.7 0 4.2-1.9 6.4-.2" />
            <path d="M2 12.5c2.3-2.1 4.4-2.1 6.7 0s4.4 2.1 6.7 0 4.2-1.9 6.4-.2" />
            <path d="M2 17.5c2.3-2.1 4.4-2.1 6.7 0s4.4 2.1 6.7 0" opacity=".45" />
          </svg>
        </span>
        <b className="bt">Aloha ABA</b> <small>Scheduling</small>
      </div>

      <div className="nav-group">
        <button className="btn btn-ghost btn-sm" onClick={goToday} title="Jump to today (T)">
          Today
        </button>
        <div className="viewseg" style={{ padding: 2 }}>
          <button className="iconbtn" style={{ width: 24, height: 24 }} onClick={() => onNav(-1)} aria-label="Previous range">
            {Icon.chevronL({ size: 14 })}
          </button>
          <button className="iconbtn" style={{ width: 24, height: 24 }} onClick={() => onNav(1)} aria-label="Next range">
            {Icon.chevronR({ size: 14 })}
          </button>
        </div>
        <div>
          <div className="range-label">{label}</div>
          <div className="range-sub">
            {sub} · {stats.sessions} sessions · {stats.units} units · {Math.round(stats.minutes / 60)}h
            {stats.cancelled > 0 && <span className="rsub-warn"> · {stats.cancelled} cancelled</span>}
          </div>
        </div>
      </div>

      <div className="spacer" />

      <div className="viewseg" role="tablist" aria-label="Calendar view">
        {[
          ['day', 'Day'],
          ['week', 'Week'],
          ['timeline', 'Timeline'],
          ['month', 'Month'],
          ['agenda', 'Agenda'],
        ].map(([v, l]) => (
          <button key={v} role="tab" aria-selected={ui.view === v} className={ui.view === v ? 'on' : ''} onClick={() => actions.setUI({ view: v })} title={v === 'timeline' ? 'Horizontal timeline — time flows left to right (H)' : `${l} view`}>
            {l}
          </button>
        ))}
      </div>

      <div className="rel">
        <button className={`iconbtn ${menu === 'filter' || filtersOn ? 'active' : ''}`} onClick={() => setMenu(menu === 'filter' ? null : 'filter')} title="Filters" aria-haspopup="true">
          {Icon.filter({ size: 15 })}
        </button>
        {menu === 'filter' && (
          <div className="menu" style={{ width: 240 }}>
            <div className="menu-h">Show statuses</div>
            {STATUS_ORDER.map((s) => (
              <label key={s} className={`menu-check ${f.statuses.includes(s) ? 'on' : ''}`} onClick={() => toggleStatus(s)}>
                <span className="cb">{f.statuses.includes(s) && Icon.check({ size: 10, strokeWidth: 3 })}</span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
                  <i style={{ width: 7, height: 7, borderRadius: 9, background: STATUSES[s].dot }} />
                  {STATUSES[s].label}
                </span>
              </label>
            ))}
            <div className="menu-sep" />
            <label className={`menu-check ${f.abaOnly ? 'on' : ''}`} onClick={() => actions.setFilters({ abaOnly: !f.abaOnly })}>
              <span className="cb">{f.abaOnly && Icon.check({ size: 10, strokeWidth: 3 })}</span>
              ABA hours only (billable)
            </label>
            {filtersOn && (
              <>
                <div className="menu-sep" />
                <button
                  className="menu-item"
                  onClick={() => {
                    actions.setFilters({ statuses: [...STATUS_ORDER], abaOnly: false })
                    setMenu(null)
                  }}
                >
                  {Icon.undo({ size: 14 })} Reset filters
                </button>
              </>
            )}
          </div>
        )}
      </div>

      <button className={`iconbtn cover-btn ${cover ? 'alert' : ''}`} data-testid="needs-cover" onClick={() => actions.setUI({ inbox: true })} title={cover ? `${cover} cancelled session${cover > 1 ? 's' : ''} can be backfilled` : 'Needs cover — all clear'}>
        {Icon.alert({ size: 15 })}
        {cover > 0 && <span className="cov-n" data-testid="cover-count">{cover}</span>}
      </button>

      <button className="iconbtn pal-btn" onClick={onPalette} title="Search everything — clients, staff, reports, actions (⌘K)" data-testid="palette-open">
        <kbd>⌘K</kbd>
      </button>
      <button className="iconbtn" onClick={() => actions.setSettings({ theme: settings.theme === 'dark' ? 'light' : 'dark' })} title="Toggle theme">
        {settings.theme === 'dark' ? Icon.sun({ size: 15 }) : Icon.moon({ size: 15 })}
      </button>

      <button className="btn btn-primary" onClick={onNew} title="New appointment (N)">
        {Icon.plus({ size: 15, strokeWidth: 2.4 })} <span className="appt-label">Appointment</span>
      </button>

      <div className="rel">
        <button className="userchip" onClick={() => setMenu(menu === 'user' ? null : 'user')} aria-haspopup="true">
          <span className="avatar" style={{ background: 'linear-gradient(135deg,#6366f1,#8b5cf6)' }}>
            AD
          </span>
          <span className="uc-name">Admin · {(settings.org?.name || 'Aloha ABA Center').split(' ')[0]}</span> {Icon.chevDown({ size: 12 })}
        </button>
        {menu === 'user' && (
          <div className="menu">
            <button
              className="menu-item"
              onClick={() => {
                exportICS()
                setMenu(null)
              }}
            >
              {Icon.download({ size: 14 })} Export current range (.ics)
            </button>
            <button
              className="menu-item"
              onClick={() => {
                window.print()
                setMenu(null)
              }}
            >
              {Icon.print({ size: 14 })} Print / save as PDF
            </button>
            <button
              className="menu-item"
              onClick={() => {
                actions.setUI({ settings: true })
                setMenu(null)
              }}
            >
              {Icon.dots({ size: 14 })} Settings
            </button>
            <div className="menu-sep" />
            <button
              className="menu-item"
              onClick={() => {
                actions.undo()
                toast({ message: 'Undone', kind: 'info' })
                setMenu(null)
              }}
            >
              {Icon.undo({ size: 14 })} Undo last change
            </button>
            <div className="menu-sep" />
            <button
              className="menu-item"
              onClick={() => {
                actions.reseed()
                toast({ message: 'Demo schedule regenerated', kind: 'ok' })
                setMenu(null)
              }}
            >
              {Icon.zap({ size: 14 })} Regenerate demo data
            </button>
          </div>
        )}
      </div>

    </header>
  )
}
