import React, { useEffect, useMemo, useState } from 'react'
import { PersonAvatar } from '../ui/avatars'
import { useStore, visibleApptsFor, weekStats } from '../state/store'
import { weekAnalytics } from '../lib/analytics'
import { Icon } from '../ui/Icons'
import { useMedia } from '../lib/useMedia'
import { DAY_MINI, isoDate, monthLabel, parseISO, startOfWeek, todayISO, addDays, addMonths } from '../lib/date'
import { TYPES } from '../lib/model'

function MiniCalendar({ days }) {
  const { appts, actions, ui, settings } = useStore()
  const anchor = parseISO(ui.anchor)
  const [viewDate, setVD] = useState(new Date(anchor.getFullYear(), anchor.getMonth(), 1))
  useEffect(() => setVD(new Date(anchor.getFullYear(), anchor.getMonth(), 1)), [ui.anchor])

  const y = viewDate.getFullYear()
  const m = viewDate.getMonth()
  const gridStart = startOfWeek(new Date(y, m, 1), settings.weekStart)
  const cells = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i))
  const countByDay = useMemo(() => {
    const map = {}
    for (const a of Object.values(appts)) if (a.status !== 'cancelled' && (a.type === 'service' || a.type === 'evaluation')) map[a.date] = (map[a.date] || 0) + 1
    return map
  }, [appts])

  return (
    <div className="sb-mini no-print">
      <div className="mini-head">
        <button className="iconbtn" style={{ width: 24, height: 24 }} onClick={() => setVD(addMonths(viewDate, -1))} aria-label="Previous month">
          {Icon.chevronL({ size: 13 })}
        </button>
        <button className="mini-title" onClick={() => actions.setUI({ view: 'month', anchor: isoDate(new Date(y, m, 1)) })} title="Open month view">
          {monthLabel(y, m)}
        </button>
        <button className="iconbtn" style={{ width: 24, height: 24 }} onClick={() => setVD(addMonths(viewDate, 1))} aria-label="Next month">
          {Icon.chevronR({ size: 13 })}
        </button>
      </div>
      <div className="mini-grid">
        {DAY_MINI.map((d) => (
          <span className="mini-dow" key={d}>
            {d}
          </span>
        ))}
        {cells.map((d) => {
          const iso = isoDate(d)
          const inMonth = d.getMonth() === m
          const n = countByDay[iso] || 0
          return (
            <button
              key={iso}
              className={`mini-day ${inMonth ? '' : 'dim'} ${iso === ui.anchor ? 'sel' : ''} ${iso === todayISO() ? 'today' : ''}`}
              onClick={() => actions.setUI({ anchor: iso })}
              onDoubleClick={() => actions.setUI({ anchor: iso, view: 'day' })}
              title={`${n} session${n === 1 ? '' : 's'} — double-click opens Day view`}
            >
              {d.getDate()}
              {n > 0 && (
                <span className="dots">
                  {Array.from({ length: Math.min(n, 3) }, (_, i) => (
                    <i key={i} />
                  ))}
                </span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function RosterList({ tab, search, days }) {
  const state = useStore()
  const { actions, ui, staff, clients, teams } = state
  const weekCounts = useMemo(() => {
    const m = {}
    for (const d of days) for (const a of Object.values(state.appts)) {
      if (a.date !== d || a.status === 'cancelled') continue
      for (const s of a.staffIds || []) m['s:' + s] = (m['s:' + s] || 0) + 1
      for (const c of a.clientIds || []) m['c:' + c] = (m['c:' + c] || 0) + 1
    }
    return m
  }, [days, state.appts])

  if (tab === 'teams') {
    const items = teams.filter((t) => !search || t.name.toLowerCase().includes(search))
    return (
      <>
        {items.map((t) => {
          const on = ui.teamSel.includes(t.id)
          return (
            <button key={t.id} className={`roster-item ${on ? 'on' : ''}`} onClick={() => actions.toggleSel('teamSel', t.id)}>
              <span className={`cb`}>{on && Icon.check({ size: 10, strokeWidth: 3 })}</span>
              <span className="avatar avatar-sm" style={{ background: t.color }}>
                {t.name.slice(0, 2).toUpperCase()}
              </span>
              <span className="meta">
                <span className="name">{t.name}</span>
                <span className="sub"><span className="role">{(t.staffIds || []).map((id) => state.staff.find((x) => x.id === id)?.name.split(' ')[0]).join(' · ') || 'no staff'} — {(t.clientIds || []).length} clients</span></span>
              </span>
            </button>
          )
        })}
      </>
    )
  }
  const items = (tab === 'staff' ? staff : clients).filter((p) => !search || (p.name + ' ' + (p.role || p.program || '')).toLowerCase().includes(search))
  const list = tab === 'staff' ? 'staffSel' : 'clientSel'
  const teamOf = (id, kind) => state.teams.find((tm) => (tm[kind] || []).includes(id)) || null
  return (
    <>
      {items.map((p) => {
        const on = ui[list].includes(p.id)
        return (
          <button key={p.id} className={`roster-item ${on ? 'on' : ''}`} onClick={() => actions.toggleSel(list, p.id)} title={`${p.name} — ${tab === 'staff' ? p.role : p.program}${teamOf(p.id, tab === 'staff' ? 'staffIds' : 'clientIds') ? ' · ' + teamOf(p.id, tab === 'staff' ? 'staffIds' : 'clientIds').name : ''}`}>
            <span className={`cb`}>{on && Icon.check({ size: 10, strokeWidth: 3 })}</span>
            <PersonAvatar p={p} size={24} />
            <span className="meta">
              <span className="row1">
                <span className="name">{p.name}</span>
                <span className="cnt" title={`${weekCounts[(tab === 'staff' ? 's:' : 'c:') + p.id] || 0} sessions this range`}>
                  {weekCounts[(tab === 'staff' ? 's:' : 'c:') + p.id] || 0}
                </span>
              </span>
              <span className="sub">
                <span className="role" title={tab === 'staff' ? p.role : p.program}>{tab === 'staff' ? p.role : p.program}</span>
                {(() => {
                  const t = teamOf(p.id, tab === 'staff' ? 'staffIds' : 'clientIds')
                  return t ? (
                    <span className="ttag" style={{ '--tc': t.color }} title={t.name}>
                      {t.name.replace('Care Team · ', '')}
                    </span>
                  ) : null
                })()}
              </span>
            </span>
          </button>
        )
      })}
      {!items.length && <div className="empty" style={{ padding: 20 }}><span className="muted">No matches</span></div>}
    </>
  )
}

export default function Sidebar({ days }) {
  const state = useStore()
  const { ui, actions, appts } = state
  const [search, setSearch] = useState('')
  const tab = ui.sidebarTab
  const selList = tab === 'staff' ? 'staffSel' : tab === 'teams' ? 'teamSel' : 'clientSel'
  const pool = tab === 'staff' ? state.staff : tab === 'teams' ? state.teams : state.clients
  const sel = ui[selList]
  const stats = weekStats(state, days)
  const an = weekAnalytics(state, days)

  // context-adaptive: below laptop width the filter rail yields to the board.
  // The Hide/expand buttons record an explicit preference that then sticks.
  const narrow = useMedia('(max-width: 1119px)')
  const open = ui.sb ?? !narrow
  const nSel = ui.staffSel.length + ui.clientSel.length + ui.teamSel.length

  const typeCounts = useMemo(() => {
    const m = {}
    for (const d of days) for (const a of visibleApptsFor(state, d)) m[a.type] = (m[a.type] || 0) + 1
    return m
  }, [days, appts, ui.filters, ui.staffSel, ui.clientSel, ui.teamSel])

  if (!open) {
    return (
      <aside className="sb-ghost no-print">
        <button className="sbg-btn" data-testid="sb-expand" title="Show staff · client · team filters" aria-label="Show filters" onClick={() => actions.setUI({ sb: true })}>
          {Icon.team({ size: 15 })}
          {nSel > 0 && <span className="sbg-n">{nSel}</span>}
        </button>
        <span className="sbg-label" onClick={() => actions.setUI({ sb: true })}>Filters</span>
      </aside>
    )
  }

  return (
    <aside className="sidebar no-print">
      <MiniCalendar days={days} />
      <div className="sb-tabs">
        {[
          ['staff', 'Staff', 'user'],
          ['clients', 'Clients', 'spark'],
          ['teams', 'Teams', 'team'],
        ].map(([t, l, ic]) => (
          <button key={t} className={`sb-tab ${tab === t ? 'on' : ''}`} onClick={() => actions.setUI({ sidebarTab: t })}>
            {l}
          </button>
        ))}
      </div>
      <div className="sb-search">
        <span className="sic">{Icon.search({ size: 13 })}</span>
        <input placeholder="Search here…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search staff, clients or teams" />
      </div>
      <div className="sb-tools">
        <span>{sel.length} selected</span>
        <span className="sb-tools-r">
          <button onClick={() => actions.toggleSel(selList, null, 'all')}>{sel.length === pool.length ? 'Clear all' : 'Select all'}</button>
          <button className="sb-hide" data-testid="sb-collapse" title="Hide filters — give the board the full width" onClick={() => actions.setUI({ sb: false })}>{Icon.chevronL({ size: 11 })} Hide</button>
        </span>
      </div>
      <div className="sb-list" role="list">
        <RosterList tab={tab} search={search.trim().toLowerCase()} days={days} />
      </div>
      <div className="sb-foot">
        <div className="legend">
          {Object.values(TYPES).map((t) => (
            <span key={t.key} title={`${typeCounts[t.key] || 0} this range`}>
              <i style={{ background: t.color }} /> {t.label}
              {typeCounts[t.key] ? <b style={{ color: 'var(--muted)' }}>{typeCounts[t.key]}</b> : null}
            </span>
          ))}
        </div>
        <div className="wkstats">
          <div className="wkstat">
            <b>{stats.sessions}</b>
            <span>Sessions</span>
          </div>
          <div className="wkstat">
            <b>{stats.units}</b>
            <span>Units</span>
          </div>
          <div className="wkstat">
            <b>${(stats.revenue / 1000 >= 1 ? (stats.revenue / 1000).toFixed(1) + 'k' : stats.revenue)}</b>
            <span>Billed</span>
          </div>
        </div>
        <div className="wkstats">
          <div className="wkstat">
            <b>{an.cancelled}</b>
            <span>Cancelled</span>
          </div>
          <div className="wkstat">
            <b>{an.noShow}</b>
            <span>No-shows</span>
          </div>
          <div className="wkstat" title="Booked staff-hours ÷ scheduled capacity">
            <b>{an.utilization}%</b>
            <span>Utilized</span>
          </div>
        </div>
        <button className="btn btn-ghost btn-sm sb-analytics" data-testid="open-analytics" onClick={() => actions.setUI({ section: 'analytics', anchor: days[3] || todayISO() })}>
          {Icon.clipboard({ size: 12 })} Full analytics for this range
        </button>
        <button className="btn btn-ghost btn-sm" data-testid="open-reports" onClick={() => actions.setUI({ section: 'reports', anchor: days[3] || todayISO() })}>
          {Icon.file({ size: 12 })} Reports for this range
        </button>
      </div>
    </aside>
  )
}
