import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useStore, visibleApptsFor, weekStats } from '../state/store'
import { Icon } from '../ui/Icons'
import { useToast } from '../ui/Toast'
import { todayISO } from '../lib/date'
import { STATUS_ORDER, STATUSES } from '../lib/model'
import { apptStatusList, isCancelStatus, telehealthRoomFor } from '../lib/settingsMasters'
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
  const canSchedule = state.canAccess('calendar', 'view')
  const canScheduleEdit = state.canAccess('calendar', 'full')
  const toast = useToast()
  const [menu, setMenu] = useState(null) // 'filter'
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
    download('pulse-aba-calendar.ics', buildICS(list, staffById, clientsById, (k) => isCancelStatus(settings, k), (a) => telehealthRoomFor(settings, a)))
    toast({ message: `Exported ${list.length} events to .ics`, kind: 'ok' })
  }

  const f = ui.filters
  const toggleStatus = (s) => {
    if (STATUS_ORDER.includes(s)) {
      const has = f.statuses.includes(s)
      actions.setFilters({ statuses: has ? f.statuses.filter((x) => x !== s) : [...f.statuses, s] })
    } else {
      // custom statuses toggle through an explicit hide-list so a newly added
      // status is visible immediately without rewriting the saved filter array
      const hidden = f.hiddenStatuses || []
      actions.setFilters({ hiddenStatuses: hidden.includes(s) ? hidden.filter((x) => x !== s) : [...hidden, s] })
    }
  }
  // statuses come from Settings → Appointment Status; a key the filter array has never
  // seen (a custom status) is shown until the user deliberately hides it
  const statusList = apptStatusList(settings, { activeOnly: true })
  const statusOn = (key) => f.statuses.includes(key) || (!STATUS_ORDER.includes(key) && !(f.hiddenStatuses || []).includes(key))
  const filtersOn = statusList.some((s) => !statusOn(s.key)) || f.abaOnly

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
          <button key={v} role="tab" aria-selected={ui.view === v} className={ui.view === v ? 'on' : ''} onClick={() => actions.setUI({ view: v })} title={v === 'timeline' ? 'Timeline: time runs left to right (H)' : `${l} view`}>
            {l}
          </button>
        ))}
      </div>

      <div className="rel">
        <button data-testid="topbar-filters" className={`iconbtn ${menu === 'filter' || filtersOn ? 'active' : ''}`} onClick={() => setMenu(menu === 'filter' ? null : 'filter')} title="Filters" aria-haspopup="true">
          {Icon.filter({ size: 15 })}
        </button>
        {menu === 'filter' && (
          <div className="menu" style={{ width: 240 }}>
            <div className="menu-h">Show statuses</div>
            {statusList.map((s) => (
              <label key={s.key} className={`menu-check ${statusOn(s.key) ? 'on' : ''}`} onClick={() => toggleStatus(s.key)} data-testid={`status-filter-${s.key}`}>
                <span className="cb">{statusOn(s.key) && Icon.check({ size: 10, strokeWidth: 3 })}</span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
                  <i style={{ width: 7, height: 7, borderRadius: 9, background: s.color || STATUSES[s.key]?.dot || '#94a3b8' }} />
                  {s.label}
                </span>
              </label>
            ))}
            <div className="menu-sep" />
            <label
              className={`menu-check ${f.abaOnly ? 'on' : ''}`}
              data-testid="filter-aba-only"
              title="Only non-service blocks marked as behavior-analytic (⚡ ABA) time"
              onClick={() => actions.setFilters({ abaOnly: !f.abaOnly })}
            >
              <span className="cb">{f.abaOnly && Icon.check({ size: 10, strokeWidth: 3 })}</span>
              ⚡ ABA hours (behavior-analytic time)
            </label>
            {filtersOn && (
              <>
                <div className="menu-sep" />
                <button
                  className="menu-item"
                  onClick={() => {
                    actions.setFilters({ statuses: [...STATUS_ORDER], hiddenStatuses: [], abaOnly: false })
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

      {canSchedule && <button className="iconbtn si-open-btn" data-testid="insights-open" onClick={() => actions.setUI({ insights: true })} title="Scheduler insights: capacity, authorizations and sessions at risk (I)">
        {Icon.spark({ size: 15 })}
      </button>}

      {canSchedule && <button className={`iconbtn cover-btn ${cover ? 'alert' : ''}`} data-testid="needs-cover" onClick={() => actions.setUI({ inbox: true })} title={cover ? `${cover} cancelled session${cover > 1 ? 's' : ''} can be backfilled` : 'Needs cover: nothing to backfill'}>
        {Icon.alert({ size: 15 })}
        {cover > 0 && <span className="cov-n" data-testid="cover-count">{cover}</span>}
      </button>}

      {canSchedule && <button className="iconbtn" onClick={exportICS} title="Export current range (.ics)" aria-label="Export current range (.ics)" data-testid="export-ics">
        {Icon.download({ size: 15 })}
      </button>}

      <button className="iconbtn pal-btn" onClick={onPalette} title="Search clients, staff, reports and actions (⌘K)" data-testid="palette-open">
        <kbd>⌘K</kbd>
      </button>
      <button className="iconbtn" onClick={() => actions.setSettings({ theme: settings.theme === 'dark' ? 'light' : 'dark' })} title="Toggle theme">
        {settings.theme === 'dark' ? Icon.sun({ size: 15 }) : Icon.moon({ size: 15 })}
      </button>

      {canScheduleEdit && <button className="btn btn-primary" onClick={onNew} title="New appointment (N)">
        {Icon.plus({ size: 15, strokeWidth: 2.4 })} <span className="appt-label">Appointment</span>
      </button>}

    </header>
  )
}
