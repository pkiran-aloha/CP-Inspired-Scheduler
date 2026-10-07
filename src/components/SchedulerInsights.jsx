import React, { useMemo, useState } from 'react'
import { useStore } from '../state/store'
import { useToast } from '../ui/Toast'
import { Icon } from '../ui/Icons'
import { PersonAvatar } from '../ui/avatars'
import { DAY_SHORT, addDays, fmtDayLabel, fmtRange, isoDate, parseISO, todayISO } from '../lib/date'
import { insightBoard } from '../lib/insights'
import { planDensityMove } from '../lib/density'
import { OVERBOOK_SAFE_PCTS } from '../lib/overbook'
import { AUTH_BANDS } from '../lib/authBudget'
import { RISK_BANDS, RISK_TIME_LABEL } from '../lib/risk'
import { routeForDay, suggestRouteOrder } from '../lib/travel'

/** Fill shading. 85–95% is the healthy band the operations literature converges on. */
const fillTone = (p) => (p >= 95 ? 'hot' : p >= 85 ? 'full' : p >= 55 ? 'mid' : p > 0 ? 'idle' : 'none')

function Meter({ pct, tone = 'accent', height = 6 }) {
  return (
    <span className={`si-meter si-meter-${tone}`} style={{ height }} role="presentation">
      <i style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
    </span>
  )
}

function Tile({ kpi }) {
  return (
    <div className={`si-tile si-tone-${kpi.tone}`} data-testid={`si-kpi-${kpi.id}`}>
      <span className="si-tile-label">{kpi.label}</span>
      <b className="si-tile-value">{kpi.value}</b>
      <span className="si-tile-sub">{kpi.sub}</span>
    </div>
  )
}

/**
 * Scheduler Insights — the analytical surface behind the calendar.
 *
 * It answers the three questions a scheduler asks when the week is already full:
 * where the capacity is, which authorizations are about to run out, and which sessions
 * are most likely to fall through. Everything is computed from this workspace in the
 * browser; nothing is transmitted, and every number links back to the records it came
 * from. The panel is read-only apart from jumping to the calendar and confirming a
 * session, both of which go through the store's normal undoable actions.
 */
export default function SchedulerInsights({ days, onClose }) {
  const state = useStore()
  const { actions, settings } = state
  const toast = useToast()
  const [tab, setTab] = useState('coverage')
  const [scope, setScope] = useState('action') // auth tab: 'action' | 'all'
  const key = days.join(',')
  const board = useMemo(() => insightBoard(state, days), [state.appts, state.clients, state.staff, state.teams, state.svcs, state.payers, state.payProfiles, state.settings, state.intakeRequests, key])
  const { coverage, density, auth, risk, overbook, ramp, hire } = board
  const holdout = coverage.summary.holdout
  // a scheduler's choice, saved like the other calendar-owned risk settings (one setSettings write)
  const setHoldout = (pct) => actions.setSettings({ risk: { ...(settings.risk || {}), holdoutPct: pct } })
  const setSafePct = (pct) => actions.setSettings({ risk: { ...(settings.risk || {}), overbookSafePct: pct } })

  // ---- travel routes per staff per day ----
  const travelBoard = useMemo(() => {
    const apptsByDay = {}
    for (const ap of Object.values(state.appts || {})) {
      if (!ap?.date || !days.includes(ap.date)) continue
      if (ap.status && state.settings?.apptStatuses?.find((s) => s.key === ap.status)?.isCancellation) continue
      // skip cancelled via isCancelStatus? Use settings resolver quickly: check if status is no-show/cancelled
      if (['cancelled', 'no-show'].includes(ap.status)) continue
      for (const sid of ap.staffIds || []) {
        const key = `${sid}|${ap.date}`
        if (!apptsByDay[key]) apptsByDay[key] = []
        apptsByDay[key].push(ap)
      }
    }
    const rows = []
    for (const [k, list] of Object.entries(apptsByDay)) {
      const [staffId, date] = k.split('|')
      const sorted = list.slice().sort((a, b) => a.start - b.start)
      if (sorted.length < 2) continue
      const route = routeForDay(state, sorted)
      if (!route.legs.length) continue
      const suggestion = suggestRouteOrder(state, sorted)
      const staff = (state.staff || []).find((s) => s.id === staffId)
      rows.push({ staffId, staffName: staff?.name || staffId, date, sorted, route, suggestion })
    }
    rows.sort((a, b) => a.date.localeCompare(b.date) || a.staffName.localeCompare(b.staffName))
    return rows
  }, [state.appts, state.clients, state.staff, state.settings, key])

  const goToDay = (date, staffId) => {
    actions.setUI({
      section: 'calendar',
      insights: false,
      ...(staffId ? { staffSel: [staffId], clientSel: [], teamSel: [] } : {}),
      anchor: date,
    })
  }
  const openAppt = (id) => actions.setUI({ insights: false, openAppt: id })
  const safeToday = todayISO()

  const confirm = (row) => {
    const prev = { status: row.appt.status }
    actions.update(row.appt.id, { status: 'confirmed' })
    toast({
      message: `Marked confirmed locally — no reminder was sent to the family`,
      kind: 'ok',
      action: { label: 'Undo', onClick: () => actions.update(row.appt.id, prev) },
    })
  }

  const applyDensity = (row) => {
    const plan = planDensityMove(state, row)
    if (!plan.ok) {
      toast({ message: plan.msg, kind: 'warn' })
      return
    }
    const prev = row.from
    actions.move(row.apptId, plan.patch)
    toast({
      message: `${plan.msg} Press U to undo.`,
      kind: 'ok',
      action: { label: 'Undo', onClick: () => actions.move(row.apptId, prev) },
    })
  }

  const showGrid = days.length >= 5
  const authRows = scope === 'action' ? auth.rows.filter((r) => ['lapsed', 'over', 'expiring', 'no-auth', 'watch'].includes(r.band)) : auth.rows

  const travelAlert = travelBoard.some((r) => r.route.totals.impossible > 0)
  const travelBadge = travelBoard.length ? `${travelBoard.length} route${travelBoard.length === 1 ? '' : 's'}` : 'clear'
  const densityBadge = density.summary.suggestions ? `${density.summary.suggestions} move${density.summary.suggestions === 1 ? '' : 's'}` : 'clear'
  const tabs = [
    { id: 'coverage', label: 'Coverage', icon: 'grid', badge: `${coverage.summary.openHours}h open` },
    { id: 'density', label: 'Density', icon: 'shuffle', badge: densityBadge, alert: density.summary.suggestions > 0 },
    { id: 'auth', label: 'Authorizations', icon: 'shield', badge: auth.summary.needsAction ? `${auth.summary.needsAction} to action` : 'clear', alert: auth.summary.needsAction > 0 },
    { id: 'risk', label: 'At risk', icon: 'alert', badge: risk.summary.flagged ? `${risk.summary.flagged} flagged` : 'clear', alert: risk.summary.high > 0 },
    { id: 'travel', label: 'Travel', icon: 'car', badge: travelBadge, alert: travelAlert },
    { id: 'overbook', label: 'Overbooking', icon: 'users', badge: overbook.summary.safe ? `${overbook.summary.safe} block${overbook.summary.safe === 1 ? '' : 's'}` : 'none yet' },
    { id: 'ramp', label: 'Ramp', icon: 'pulse', badge: ramp.summary.shortWeeks ? `${ramp.summary.shortWeeks} short week${ramp.summary.shortWeeks === 1 ? '' : 's'}` : 'supplied', alert: ramp.summary.shortWeeks > 0 },
  ]

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal si-modal" role="dialog" aria-modal="true" aria-label="Scheduler insights" data-testid="scheduler-insights">
        <div className="modal-head">
          <span className="si-head-ico">{Icon.spark({ size: 15 })}</span>
          <h2>Scheduler insights</h2>
          <span className="sbadge" data-testid="si-range">{days.length === 1 ? fmtDayLabel(days[0], 'full') : `${days.length} days · ${fmtDayLabel(days[0])} → ${fmtDayLabel(days[days.length - 1])}`}</span>
          <span className="spacer f1" />
          <button className="modal-x" onClick={onClose} aria-label="Close">
            {Icon.x({ size: 14 })}
          </button>
        </div>

        <div className="si-kpis">
          {board.kpis.map((k) => (
            <Tile key={k.id} kpi={k} />
          ))}
        </div>

        <div className="si-tabs" role="tablist">
          {tabs.map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'on' : ''} data-testid={`si-tab-${t.id}`} onClick={() => setTab(t.id)}>
              {Icon[t.icon]({ size: 13 })} {t.label}
              <span className={`si-tab-badge ${t.alert ? 'alert' : ''}`}>{t.badge}</span>
            </button>
          ))}
        </div>

        <div className="modal-body si-body">
          {tab === 'coverage' && (
            <>
              <div className="si-head-row">
                <div>
                  <b>Where the capacity is</b>
                  <span className="muted">
                    {' '}
                    — booked staff-hours against the working day ({coverage.hourLabel(coverage.hourStart)}–{coverage.hourLabel(coverage.hourStart + coverage.hourSpan)}), with blocked-out
                    time removed from the denominator.
                  </span>
                </div>
                <span className={`si-band si-tone-${coverage.summary.fillPct >= 95 ? 'warn' : coverage.summary.fillPct < 40 ? 'info' : 'ok'}`}>
                  {coverage.summary.fillPct}% filled · healthy band 85–95%
                </span>
              </div>

              {showGrid ? (
                <div className="si-heat" data-testid="si-heat">
                  <div className="si-heat-hours">
                    <span />
                    {Array.from({ length: coverage.hourSpan }, (_, i) => (
                      <span key={i} className={i % 2 === 0 ? '' : 'faded'}>
                        {i % 2 === 0 ? coverage.hourLabel(coverage.hourStart + i) : ''}
                      </span>
                    ))}
                  </div>
                  {coverage.grid.map((row, dow) => {
                    const day = coverage.perDay.find((d) => d.dow === dow)
                    return (
                      <div className="si-heat-row" key={dow}>
                        <span className="si-heat-dow">
                          {DAY_SHORT[dow]}
                          {day && <i>{day.fillPct}%</i>}
                        </span>
                        {row.map((cell, i) => (
                          <span
                            key={i}
                            className={`si-cell si-fill-${fillTone(cell.fillPct)}${cell.eatenHours > 0 ? ' si-cell-eaten' : ''}`}
                            data-testid={cell.eatenHours > 0 ? `si-eaten-${dow}-${coverage.hourStart + i}` : undefined}
                            title={`${DAY_SHORT[dow]} ${coverage.hourLabel(coverage.hourStart + i)} — ${cell.bookedHours}h booked of ${cell.availableHours}h available (${cell.fillPct}%), ${cell.sessions} session${cell.sessions === 1 ? '' : 's'}${cell.eatenHours > 0 ? `; ${cell.eatenHours}h of the access holdout booked` : ''}`}
                          >
                            {cell.fillPct > 0 ? cell.fillPct : ''}
                          </span>
                        ))}
                      </div>
                    )
                  })}
                  <div className="si-legend">
                    <span><i className="si-swatch si-fill-none" /> empty</span>
                    <span><i className="si-swatch si-fill-idle" /> &lt;55%</span>
                    <span><i className="si-swatch si-fill-mid" /> 55–85%</span>
                    <span><i className="si-swatch si-fill-full" /> 85–95%</span>
                    <span><i className="si-swatch si-fill-hot" /> &gt;95%</span>
                    {holdout.pct > 0 && <span><i className="si-swatch si-cell-eaten" /> holdout booked</span>}
                  </div>
                </div>
              ) : (
                <div className="si-daystrip" data-testid="si-daystrip">
                  {coverage.perDay.map((d) => (
                    <div className="si-dayrow" key={d.date}>
                      <button className="si-dayname" onClick={() => goToDay(d.date)} title="Jump the calendar to this day">
                        {fmtDayLabel(d.date, 'full')}
                      </button>
                      <Meter pct={d.fillPct} tone={fillTone(d.fillPct)} height={9} />
                      <span className="si-daynum">{d.fillPct}%</span>
                      <span className="muted">{d.sessions} sessions · {d.bookedHours}h of {d.availableHours}h</span>
                    </div>
                  ))}
                </div>
              )}

              <div className="si-head-row" data-testid="si-holdout">
                <div>
                  <b>Access holdout</b>
                  <span className="muted">
                    {' '}
                    {holdout.pct
                      ? `— ${holdout.pct}% of each hour from today on is kept for new starts and same-day needs: ${holdout.reservedHours}h in this range, ${holdout.eatenHours}h of it already booked${holdout.eatenCells ? ` across ${holdout.eatenCells} weekday-hour${holdout.eatenCells === 1 ? '' : 's'} (outlined above)` : ''}.`
                      : '— off. Every hour can be booked to the full.'}
                  </span>
                </div>
                <div className="viewseg" role="group" aria-label="Access holdout share">
                  {[0, 10, 15, 20].map((p) => (
                    <button key={p} className={holdout.pct === p ? 'on' : ''} data-testid={`si-holdout-${p}`} onClick={() => setHoldout(p)}>
                      {p ? `${p}%` : 'Off'}
                    </button>
                  ))}
                </div>
              </div>

              <div className="si-head-row">
                <b>Bookable windows</b>
                <span className="muted">The clinician is free for the whole span — the fastest place to move or add a session.</span>
              </div>
              {!coverage.gaps.length && (
                <div className="si-empty">
                  {Icon.check({ size: 16 })} Every clinician's day is fully accounted for in this range.
                </div>
              )}
              <div className="si-gaps">
                {coverage.gaps.map((g) => (
                  <button key={`${g.date}-${g.staffId}-${g.from}`} className="si-gap" data-testid={`si-gap-${g.date}-${g.staffId}`} onClick={() => goToDay(g.date, g.staffId)}>
                    <b>{g.hours}h</b>
                    <span className="si-gap-when">
                      {fmtDayLabel(g.date)} · {fmtRange(g.from * 60, g.to * 60, settings.h24)}
                    </span>
                    <span className="si-gap-who">
                      {g.staffName}
                      {g.role ? <i className="muted"> · {g.role}</i> : null}
                    </span>
                    <span className="si-gap-go">{Icon.chevronR({ size: 12 })}</span>
                  </button>
                ))}
              </div>
            </>
          )}

          {tab === 'density' && (
            <>
              <div className="si-head-row">
                <div>
                  <b>Density optimiser</b>
                  <span className="muted">
                    {' '}
                    — same-day suggestions that pull eligible future sessions into adjacent idle windows, so a clinician has a tighter block instead of a split day.
                  </span>
                </div>
                <span className="si-band si-tone-info">
                  {density.summary.suggestions ? `${density.summary.idleHours}h split time reducible` : 'No useful moves'}
                </span>
              </div>

              {!density.rows.length && (
                <div className="si-empty">
                  {Icon.checkCircle({ size: 16 })} No same-day density moves in this range clear conflicts and improve a clinician's day.
                </div>
              )}

              <div className="si-density-list">
                {density.rows.map((row) => {
                  const staff = (state.staff || []).find((s) => s.id === row.primaryStaffId)
                  return (
                    <div className="si-density" key={row.id} data-testid={`si-density-${row.apptId}`}>
                      <div className="si-density-score">
                        <b>{row.gain.idleMin ? `${Math.round(row.gain.idleMin / 60 * 10) / 10}h` : `${Math.round(row.gain.spreadMin / 60 * 10) / 10}h`}</b>
                        <i>{row.gain.idleMin ? 'split saved' : 'span saved'}</i>
                      </div>
                      <div className="si-density-main">
                        <div className="si-density-top">
                          {staff && <PersonAvatar p={staff} size={22} />}
                          <b>{row.title}</b>
                          <span className="muted">{row.clientNames || 'No client'} · {row.staffName}</span>
                        </div>
                        <div className="si-density-times">
                          <span><b>Now</b> {fmtDayLabel(row.date)} · {fmtRange(row.from.start, row.from.end, settings.h24)}</span>
                          <span className="si-density-arrow">{Icon.chevronR({ size: 12 })}</span>
                          <span><b>Move to</b> {fmtRange(row.to.start, row.to.end, settings.h24)} · {row.adjacentTo.side === 'before' ? 'before' : 'after'} {row.adjacentTo.title}</span>
                        </div>
                        <div className="si-density-why">
                          <span className="si-factor si-src-policy" title="Computed from this clinician's calendar blocks; not a routing or outreach automation.">{row.reason}</span>
                          {row.gain.halfDays > 0 && <span className="si-factor">opens {row.gain.halfDays} half-day{row.gain.halfDays === 1 ? '' : 's'}</span>}
                          {row.warnings.slice(0, 2).map((w) => <span key={w} className="si-factor si-src-policy">Review: {w}</span>)}
                          {row.driveNote && <span className="si-factor" title="Explicit Drive Time appointments are separate records.">drive blocks not moved</span>}
                        </div>
                      </div>
                      <div className="si-density-act">
                        <button className="btn btn-primary btn-sm" data-testid={`si-density-apply-${row.apptId}`} onClick={() => applyDensity(row)}>
                          {Icon.shuffle({ size: 12 })} Move here
                        </button>
                        <button className="btn btn-ghost btn-sm" onClick={() => goToDay(row.date, row.primaryStaffId)}>
                          Show day
                        </button>
                        <button className="btn btn-ghost btn-sm" onClick={() => openAppt(row.apptId)}>
                          Open
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>

              <div className="si-note">
                {Icon.info({ size: 13 })}
                <span>
                  The optimiser only moves one existing session on the same day, keeps the same staff and clients, and rechecks live conflicts plus Stop-level overlap/travel rules before writing. It does not move separate Drive Time blocks, send messages, create recurrence changes or call a map service.
                </span>
              </div>
            </>
          )}

          {tab === 'auth' && (
            <>
              <div className="si-head-row">
                <div>
                  <b>Authorization burn-down</b>
                  <span className="muted"> — committed hours against the window on file, with the weekly pace the payer audits.</span>
                </div>
                <div className="viewseg">
                  {[['action', 'Needs action'], ['all', `All ${auth.summary.tracked}`]].map(([id, label]) => (
                    <button key={id} className={scope === id ? 'on' : ''} data-testid={`si-auth-scope-${id}`} onClick={() => setScope(id)}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {!authRows.length && <div className="si-empty">{Icon.checkCircle({ size: 16 })} No client is near their authorized hours or an expiry in this view.</div>}

              <div className="si-auth-list">
                {authRows.map((r) => {
                  const band = AUTH_BANDS[r.band]
                  return (
                    <div className={`si-auth si-band-${r.band}`} key={r.clientId} data-testid={`si-auth-${r.clientId}`}>
                      <div className="si-auth-who">
                        <PersonAvatar p={r.client} size={26} />
                        <span>
                          <b>{r.name}</b>
                          <i className="muted">{r.insurer} · {r.window.weeklyHours || 0} h/week authorized</i>
                        </span>
                      </div>
                      <div className="si-auth-bar">
                        <Meter pct={r.pct} tone={band.tone} height={8} />
                        <div className="si-auth-nums">
                          <span>
                            <b>{r.committedHours}h</b> committed of <b>{r.window.authorizedHours}h</b> on file ({r.pct}%)
                          </span>
                          <span className={r.remainingHours < 0 ? 'si-neg' : 'muted'}>
                            {r.remainingHours < 0 ? `${Math.abs(r.remainingHours)}h over` : `${r.remainingHours}h left`}
                          </span>
                        </div>
                      </div>
                      <div className="si-auth-facts">
                        <span className={`si-chip si-tone-${band.tone}`}>{band.label}</span>
                        <span className="si-fact" title="Booked hours in the week that contains today, against the authorized weekly hours">
                          {r.week.hours}h this week / {r.week.cap}h
                        </span>
                        {r.window.daysToExpiry != null && (
                          <span className={`si-fact ${r.window.daysToExpiry <= 30 ? 'si-warn' : ''}`}>
                            {r.window.daysToExpiry < 0 ? `lapsed ${Math.abs(r.window.daysToExpiry)}d ago` : `${r.window.daysToExpiry}d to expiry`}
                          </span>
                        )}
                        {r.pace.projectedEmpty && <span className="si-fact" title="Extrapolated from the recent delivered pace and the hours already booked">runs out ≈{r.pace.projectedEmpty}</span>}
                        <span className="spacer f1" />
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={() => {
                            actions.setUI({ section: 'calendar', insights: false, view: 'week', clientSel: [r.clientId], staffSel: [], teamSel: [] })
                          }}
                        >
                          {Icon.cal({ size: 12 })} Show sessions
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </>
          )}

          {tab === 'risk' && (
            <>
              <div className="si-head-row">
                <div>
                  <b>Sessions most likely to fall through</b>
                  <span className="muted">
                    {' '}
                    — {risk.summary.note} Practice rate: {Math.round(risk.summary.base * 100)}%. About <b>{risk.summary.expectedLostHours}h</b> and{' '}
                    <b>${Math.round(risk.summary.chargeAtRisk).toLocaleString()}</b> of scheduled charge are exposed.
                  </span>
                </div>
              </div>

              <div className="si-note" data-testid="si-risk-notice">
                {Icon.info({ size: 13 })}
                <span>
                  {risk.summary.noticeNote} The threshold ({risk.summary.notice.hours}h) is the practice's own — Billing → Setup, Rate &amp; Numbering Policy — and it is
                  the same rule the Overbooking backtest uses.
                </span>
              </div>

              {!risk.rows.length && (
                <div className="si-empty">{Icon.checkCircle({ size: 16 })} Nothing in this range looks likely to be missed. The reminder policy alone is enough.</div>
              )}

              <div className="si-risk-list">
                {risk.rows.map((r) => {
                  const band = RISK_BANDS[r.band]
                  const a = r.appt
                  const client = state.clients.find((c) => (a.clientIds || []).includes(c.id))
                  return (
                    <div className={`si-risk si-tone-${band.tone}`} key={a.id} data-testid={`si-risk-${a.id}`}>
                      <div className="si-risk-score" title={`${r.score}% modelled chance this session does not go ahead as booked`}>
                        <b>{r.score}</b>
                        <i>{band.label}</i>
                      </div>
                      <div className="si-risk-what">
                        <div className="si-risk-top">
                          {client && <PersonAvatar p={client} size={18} />}
                          <b>{a.title || client?.name || 'Session'}</b>
                          <span className="muted">
                            {fmtDayLabel(a.date)} · {fmtRange(a.start, a.end, settings.h24)}
                          </span>
                        </div>
                        <div className="si-risk-why">
                          {r.factors.slice(0, 3).map((f) => (
                            <span key={f.id} className={`si-factor si-src-${f.source}`} title={f.detail}>
                              {f.lift > 0 ? '▲' : '▼'} {f.label}
                            </span>
                          ))}
                        </div>
                        <div className="si-risk-why">
                          {r.factors[0] && <span className="muted si-reason">{r.factors[0].detail}</span>}
                        </div>
                      </div>
                      <div className="si-risk-act">
                        <span className="si-action">{r.action}</span>
                        <div className="si-risk-btns">
                          {a.status !== 'confirmed' && a.date >= safeToday && (
                            <button className="btn btn-primary btn-sm" data-testid={`si-confirm-${a.id}`} onClick={() => confirm(r)}>
                              {Icon.check({ size: 12 })} Confirm
                            </button>
                          )}
                          <button className="btn btn-ghost btn-sm" onClick={() => openAppt(a.id)}>
                            Open
                          </button>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>

              <div className="si-note">
                {Icon.info({ size: 13 })}
                <span>
                  Scores are fitted in this browser on the workspace's own appointment history, plus a small set of documented rules the ledger cannot learn (booking lead time, an
                  unconfirmed slot, a backfilled or rescheduled session, a first session with a technician). Factors marked <i className="si-factor si-src-model">history</i> come from your
                  records; <i className="si-factor si-src-policy">policy</i> ones are the fixed rules. This is an operations prompt for a human phone call — no reminder is sent, and no
                  clinical judgement is implied.
                </span>
              </div>
            </>
          )}

          {tab === 'overbook' && (
            <>
              <div className="si-head-row" data-testid="si-ob-threshold">
                <div>
                  <b>Confidence threshold</b>
                  <span className="muted">
                    {' '}
                    — both checks below must clear {overbook.cfg.safePct}% before a block is marked.{' '}
                    {overbook.cfg.safePct === 90
                      ? 'The strictest setting: only blocks with very reliable losses qualify.'
                      : overbook.cfg.safePct === 70
                        ? 'The most sensitive setting: more blocks qualify, on weaker evidence.'
                        : 'The balanced default: turning a family away costs about four times an idle hour.'}{' '}
                    Advisory only; nothing is booked, moved or sent.
                  </span>
                </div>
                <div className="viewseg" role="group" aria-label="Overbooking confidence threshold">
                  {OVERBOOK_SAFE_PCTS.map((p) => (
                    <button key={p} className={overbook.cfg.safePct === p ? 'on' : ''} data-testid={`si-ob-threshold-${p}`} onClick={() => setSafePct(p)}>
                      {p}%
                    </button>
                  ))}
                </div>
              </div>

              <div className="si-head-row">
                <div>
                  <b>Blocks that usually lose a session</b>
                  <span className="muted">
                    {' '}
                    — {overbook.note} A block is marked when, in at least {overbook.cfg.safePct}% of its last {overbook.cfg.weeks} weeks, a session was lost there, and the sessions
                    already booked on its next day give at least {overbook.cfg.safePct}% odds of the same.
                  </span>
                </div>
              </div>

              {!overbook.summary.safe && (
                <div className="si-empty" data-testid="si-ob-empty">
                  {Icon.info({ size: 16 })} No block clears {overbook.cfg.safePct}% yet. Small blocks rarely do: each line below says how many sessions a week its block has and how many it would need.
                </div>
              )}

              <div className="si-ob-list">
                {overbook.blocks.map((b) => (
                  <div className="si-travel" key={b.key} data-testid={`si-ob-${b.office ? `${b.office}-` : ''}${b.dow}-${b.band}`}>
                    <div className="si-travel-head">
                      <b>
                        {b.office ? `${b.office} · ` : ''}
                        {DAY_SHORT[b.dow]} · {RISK_TIME_LABEL[b.band]}
                      </b>
                      <span className="muted">
                        {b.weeks} week{b.weeks === 1 ? '' : 's'} · {b.sessions} sessions · {Math.round((b.lost / Math.max(1, b.sessions)) * 100)}% lost, {Math.round(b.rateNoShow * 100)}% no-shows
                      </span>
                      <span className="spacer f1" />
                      <span className={`si-chip ${b.status === 'safe' ? 'si-tone-ok' : ''}`}>
                        {b.status === 'safe' ? (b.safeK === 1 ? 'Room for one extra' : 'Room for two extra') : b.status === 'thin' ? 'Not enough history' : 'Not yet'}
                      </span>
                      <button className="btn btn-ghost btn-sm" onClick={() => goToDay(b.next.date)}>
                        Show {fmtDayLabel(b.next.date)}
                      </button>
                    </div>
                    <span className="muted si-reason">{b.why}</span>
                    {b.standby.length > 0 && (
                      <span className="si-reason" data-testid={`si-ob-standby-${b.key}`}>
                        <b>Standby first</b> (behind their authorized pace): {b.standby.map((c) => `${c.name} (${c.weekPct}% of this week)`).join(', ')}
                      </span>
                    )}
                  </div>
                ))}
              </div>

              <div className="si-note">
                {Icon.info({ size: 13 })}
                <span>
                  Advisory only: nothing is booked, moved or sent. An extra session belongs on a clinician who is free in that block (a floater or an open hour), never as a second client on
                  the same clinician — 97153 is one client face to face, and overlapping sessions by one provider are not billable. Guidance is per block, never per family. A family
                  cancellation made more than {overbook.cfg.lateHours}h ahead is left out once its time is recorded; cancellations from before that was recorded
                  {overbook.summary.undated ? ` (${overbook.summary.undated} in this window)` : ''} still count as lost, so the no-show share is the floor.
                </span>
              </div>
            </>
          )}

          {tab === 'ramp' && (
            <>
              <div className="si-head-row">
                <div>
                  <b>Caseload ramp — next {ramp.horizonWeeks} weeks</b>
                  <span className="muted">
                    {' '}
                    — authorized hours on file plus open intake requests at their requested hours, against clinician supply (working day {ramp.workday.start}:00–{ramp.workday.end}:00 minus
                    blocked time, {ramp.cfg.openDows.map((d) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d]).join(', ')}). {ramp.summary.clients} client{ramp.summary.clients === 1 ? '' : 's'} authorized · {ramp.summary.intakeCounted} intake request
                    {ramp.summary.intakeCounted === 1 ? '' : 's'} with hours{ramp.summary.intakeNoHours ? ` · ${ramp.summary.intakeNoHours} open without hours recorded` : ''}.
                  </span>
                </div>
                <span className={`si-band ${ramp.summary.shortWeeks ? 'si-tone-warn' : 'si-tone-ok'}`} data-testid="si-ramp-summary">
                  {ramp.summary.shortWeeks
                    ? `${ramp.summary.shortWeeks} week${ramp.summary.shortWeeks === 1 ? '' : 's'} where known demand exceeds supply — first: ${fmtDayLabel(ramp.summary.firstShort)}`
                    : 'Supply covers the known demand in every week'}
                </span>
              </div>

              {hire && (
                <div
                  className={`si-hire si-hire-${hire.verdict}`}
                  data-testid="si-hire-verdict"
                  data-verdict={hire.verdict}
                >
                  <div className="si-hire-head">
                    <b data-testid="si-hire-headline">{hire.headline}</b>
                    <span className="muted">
                      {hire.utilKnown
                        ? `Fill on screen ${hire.fillPct}% (bar ${hire.highBar}%) · ${hire.bookedHours} of ${hire.availableHours} staff-h`
                        : 'Fill on screen unknown — no bookable hours in this range'}
                      {hire.shortHours ? ` · first short week ${hire.shortHours}h` : ''}
                      {hire.peakShortHours && hire.peakShortHours !== hire.shortHours ? ` · peak ${hire.peakShortHours}h` : ''}
                    </span>
                  </div>
                  <p className="si-hire-reason" data-testid="si-hire-reason">{hire.reason}</p>
                </div>
              )}

              {ramp.summary.clients === 0 && ramp.summary.intakeCounted === 0 && (
                <div className="si-empty" data-testid="si-ramp-empty">
                  {Icon.info({ size: 16 })} No active authorization or open intake request carries weekly hours yet, so there is no known demand to ramp. Add an authorization window on a
                  client chart or record recommended hours on an intake request.
                </div>
              )}

              <div className="si-ramp-list" data-testid="si-ramp-list">
                {(() => {
                  const scale = Math.max(...ramp.weeks.map((x) => Math.max(x.totalHours, x.supplyHours)), 1)
                  return ramp.weeks.map((w, i) => {
                  return (
                    <div className="si-ramp-row" key={w.start} data-testid={`si-ramp-w-${w.start}`}>
                      <span className="si-ramp-week">
                        <b>{i === 0 ? 'This week' : fmtDayLabel(w.start)}</b>
                        <i className="muted"> → {fmtDayLabel(w.end)}</i>
                      </span>
                      <div className="si-ramp-bars">
                        <span className="si-ramp-track" title={`Demand ${w.demandHours}h${w.intakeHours ? ` + ${w.intakeHours}h intake` : ''} · supply ${w.supplyHours}h`}>
                          <i className="si-ramp-seg" style={{ width: `${(w.demandHours / scale) * 100}%` }} />
                          {w.intakeHours > 0 && <i className="si-ramp-seg si-ramp-seg-intake" style={{ width: `${(w.intakeHours / scale) * 100}%` }} />}
                        </span>
                        <span className="si-ramp-track si-ramp-track-supply" title={`Clinical supply ${w.supplyHours}h (RBT ${w.supply.rbt} · BCBA ${w.supply.bcba} · other ${w.supply.other})`}>
                          <i className="si-ramp-supply" style={{ width: `${(w.supplyHours / scale) * 100}%` }} />
                        </span>
                      </div>
                      <span className="si-ramp-nums">
                        <b>{w.totalHours}h</b>
                        {w.intakeHours > 0 ? <i className="muted"> incl. {w.intakeHours}h intake</i> : null}
                        <span className="muted"> · {w.supplyHours}h supply · </span>
                        <span className={w.balanceHours < 0 ? 'si-neg' : 'muted'}>
                          {w.balanceHours < 0 ? `${Math.abs(w.balanceHours)}h short` : `${w.balanceHours}h free`}
                        </span>
                      </span>
                      <span className="si-ramp-chips">
                        {w.renewalPending && (
                          <span
                            className="si-chip si-tone-flag"
                            data-testid={`si-ramp-renewal-${w.start}`}
                            title={`Authorization ends this week and is never assumed to renew: ${w.renewals.map((r) => `${r.name} (${r.weekly}h/wk)`).join(', ')}`}
                          >
                            {w.renewals.length} renewal{w.renewals.length === 1 ? '' : 's'} pending
                          </span>
                        )}
                        {w.balanceHours < 0 && (
                          <span className="si-chip si-tone-warn" data-testid={`si-ramp-short-${w.start}`}>
                            demand &gt; supply
                          </span>
                        )}
                      </span>
                    </div>
                  )
                  })
                })()}
              </div>

              <div className="si-note">
                {Icon.info({ size: 13 })}
                <span>
                  A ramp from known work, not a forecast: demand is the authorized weekly hours on each chart for as long as its window runs, plus open intake requests at their requested
                  hours in a lighter band{ramp.summary.intakeUndated ? ` (${ramp.summary.intakeUndated} of them have no target date yet and count from this week)` : ''} — never weighted by a
                  conversion rate. An authorization that ends inside the horizon drops to zero there and the week is marked “renewal pending”; renewals are never assumed
                  {ramp.summary.lapsed ? ` (${ramp.summary.lapsed} client${ramp.summary.lapsed === 1 ? ' has' : 's have'} already lapsed and contribute nothing)` : ''}. Supply counts each
                  clinician’s working day minus blocked-out time on Mon–Fri, split RBT ({ramp.summary.staff.rbt}) vs BCBA ({ramp.summary.staff.bcba}) vs other clinical (
                  {ramp.summary.staff.other}). Nothing here is booked, moved or sent.
                </span>
              </div>
            </>
          )}

          {tab === 'travel' && (
            <>
              <div className="si-head-row">
                <div>
                  <b>Travel routes per clinician day</b>
                  <span className="muted"> — estimated from straight-line distance × 1.3 road factor at 25 mph; not a map route. Client geo + office lat/lng; unknown places skipped.</span>
                </div>
              </div>

              {!travelBoard.length && (
                <div className="si-empty">
                  {Icon.checkCircle({ size: 16 })} No clinician has 2+ sessions with resolvable locations in this range. Add client geo or office lat/lng in Settings → Organization to see travel.
                </div>
              )}

              <div className="si-travel-list">
                {travelBoard.map((row) => (
                  <div className="si-travel" key={`${row.staffId}-${row.date}`} data-testid={`si-travel-${row.staffId}-${row.date}`}>
                    <div className="si-travel-head">
                      <b>{row.staffName}</b>
                      <span className="muted">{fmtDayLabel(row.date, 'full')} · {row.sorted.length} sessions · {row.route.totals.distanceMi.toFixed(1)} mi straight · ~{row.route.totals.travelMin} min travel</span>
                      <span className="spacer f1" />
                      {row.route.totals.impossible > 0 && <span className="si-chip si-tone-warn">{row.route.totals.impossible} impossible</span>}
                      {row.route.totals.tight > 0 && <span className="si-chip si-tone-flag">{row.route.totals.tight} tight</span>}
                      <button className="btn btn-ghost btn-sm" onClick={() => goToDay(row.date, row.staffId)}>Show day</button>
                    </div>
                    <div className="si-travel-legs">
                      {row.route.legs.map((leg, i) => (
                        <div key={i} className={`si-leg si-sev-${leg.severity}`} data-testid={`si-leg-${row.staffId}-${row.date}-${i}`}>
                          <span className="si-leg-from">{leg.fromAppt.title || leg.fromLoc.label} <i className="muted">{fmtRange(leg.fromAppt.start, leg.fromAppt.end, settings.h24)}</i></span>
                          <span className="si-leg-arrow">{leg.severity === 'impossible' ? '✕' : leg.severity === 'tight' ? '⚠' : '→'}</span>
                          <span className="si-leg-to">{leg.toAppt.title || leg.toLoc.label} <i className="muted">{fmtRange(leg.toAppt.start, leg.toAppt.end, settings.h24)}</i></span>
                          <span className="si-leg-meta">{leg.distanceMi.toFixed(1)} mi · ~{leg.travelMin} min needed · gap {leg.gapMin} min{leg.severity !== 'ok' ? ` · ${leg.severity}` : ''}</span>
                        </div>
                      ))}
                    </div>
                    {row.suggestion && (
                      <div className="si-travel-suggest" data-testid={`si-suggest-${row.staffId}-${row.date}`}>
                        <b>Suggested re-order (read-only):</b>
                        <span className="muted"> saves ~{row.suggestion.savedMi.toFixed(1)} mi straight (~{Math.max(0, Math.round(row.suggestion.savedMin))} min). Nothing moves until you move it.</span>
                        <div className="si-suggest-order">
                          {row.suggestion.suggestedOrder.map((a, idx) => (
                            <span key={a.id} className="si-suggest-item">{idx + 1}. {a.title || a.location || 'Session'} <i className="muted">{fmtRange(a.start, a.end, settings.h24)}</i></span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              <div className="si-note">
                {Icon.info({ size: 13 })}
                <span>Travel is an estimate. Road factor 1.3, 25 mph, 5 min buffer, tight threshold 10 min. No map API, no traffic, no elevation. Skips telehealth and places without coordinates. This view never moves appointments.</span>
              </div>
            </>
          )}
        </div>

        <div className="si-foot">
          <span>
            {Icon.info({ size: 12 })} Computed locally from {Object.keys(state.appts).length.toLocaleString()} appointments. Nothing leaves this browser and nothing is transmitted.
          </span>
          <span className="spacer f1" />
          <span className="muted">Deltas always compare against the same-length prior window.</span>
        </div>
      </div>
    </div>
  )
}
