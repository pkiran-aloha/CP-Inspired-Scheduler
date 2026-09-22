import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../state/store'
import { SectionBar } from './NavRail'
import { Icon } from '../ui/Icons'
import { useToast } from '../ui/Toast'
import { bucketize, resolveRange, priorDays, RANGE_PRESETS } from '../lib/analytics'
import { WIDGETS, DEFAULT_DASH, DASH_METRICS, DASH_DIMS, apptsFiltered, sumMetric, trendSeries, topBreakdown, mixOf, heatGrid, pulseKpis, FILTER_KEYS, fmtNum, flagOverlaps } from '../lib/dash'
import { parseISO, todayISO, fmtTime } from '../lib/date'
import { download } from '../lib/ics'
import { apptAutoTitle } from '../lib/apptName'

/* ---------- chart primitives (crisp HTML + undistorted SVG only) ---------- */

const rad = (deg) => (deg * Math.PI) / 180
function wedgePath(cx, cy, rO, rI, a0, a1) {
  const large = a1 - a0 > 180 ? 1 : 0
  const p = (r, a) => [cx + r * Math.sin(rad(a)), cy - r * Math.cos(rad(a))]
  const [x0, y0] = p(rO, a0)
  const [x1, y1] = p(rO, a1)
  const [x2, y2] = p(rI, a1)
  const [x3, y3] = p(rI, a0)
  return `M${x0.toFixed(2)},${y0.toFixed(2)} A${rO},${rO} 0 ${large} 1 ${x1.toFixed(2)},${y1.toFixed(2)} L${x2.toFixed(2)},${y2.toFixed(2)} A${rI},${rI} 0 ${large} 0 ${x3.toFixed(2)},${y3.toFixed(2)} Z`
}

function SparkChart({ series, money, onJump }) {
  const vals = series.map((s) => s.value)
  const max = Math.max(...vals, 1e-9)
  const n = vals.length
  const pts = vals.map((v, i) => [n > 1 ? (i / (n - 1)) * 100 : 50, 38 - (v / max) * 32 - (v > 0 ? 3 : 0)])
  const line = 'M' + pts.map((p) => `${p[0].toFixed(2)},${p[1].toFixed(2)}`).join(' L')
  const area = `${line} L100,41 L0,41 Z`
  const mi = vals.indexOf(Math.max(...vals))
  return (
    <div className="dw-sparkbox">
      <div className="dw-spark">
        <svg viewBox="0 0 100 41" preserveAspectRatio="none" aria-hidden="true">
          <path className="dw-spark-area" d={area} />
          <path className="dw-spark-line" d={line} vectorEffect="non-scaling-stroke" />
        </svg>
        {n > 0 && <span className="dw-spark-dot" style={{ left: `${pts[mi][0]}%`, top: `${(pts[mi][1] / 41) * 100}%` }} title={`peak ${fmtNum(vals[mi], money)}`} />}
        <div className="dw-hits">
          {series.map((s, i) => (
            <button key={s.key} className="dw-hit" data-testid={`dw-hit-${s.key}`} title={`${s.label} — ${fmtNum(s.value, money)} · click to open the calendar`} onClick={() => onJump(s.key)} />
          ))}
        </div>
      </div>
      <div className="dw-spark-x"><span>{series[0]?.label}</span><span className="dw-peak">{fmtNum(vals[mi], money)} peak</span><span>{series[n - 1]?.label}</span></div>
    </div>
  )
}

function BarsChart({ rows, money, activeKey, onPick }) {
  return (
    <div className="dw-bars" data-testid="dw-bars">
      {rows.map((r) => (
        <button key={r.key} className={`dw-bar-row ${activeKey === r.key ? 'on' : ''}`} data-testid={`dw-bar-${r.key}`} onClick={() => onPick(r)} title={`${r.label} — ${fmtNum(r.value, money)} · click to ${activeKey === r.key ? 'clear' : 'filter'} the dashboard`}>
          <span className="dw-bar-l">{r.label}</span>
          <span className="dw-bar-track"><i style={{ width: `${r.pct}%` }} /></span>
          <b>{fmtNum(r.value, money)}</b>
        </button>
      ))}
      {!rows.length && <div className="dw-none">Nothing to rank in this window.</div>}
    </div>
  )
}

function DonutChart({ slices, total, activeVal, onPick }) {
  const single = slices.length === 1
  return (
    <div className="dw-donut">
      <div className="dw-donut-plot">
        <svg viewBox="0 0 42 42" aria-label="Mix chart">
          {single ? (
            <circle cx="21" cy="21" r="16.5" fill="none" stroke={slices[0].color} strokeWidth="9" />
          ) : (
            slices.map((s) => (
              <path
                key={s.key}
                d={wedgePath(21, 21, 21, 12, s.start * 360 + 0.4, (s.start + (s.pct < 100 ? Math.max(s.pct, 2) : 100) / 100) * 360 - 0.4)}
                fill={s.color}
                className={`dw-slice ${activeVal === s.key ? 'on' : ''}`}
                data-testid={`dw-slice-${s.key}`}
                onClick={() => onPick(s)}
              >
                <title>{`${s.label} — ${s.value} (${s.pct}%) · click to ${activeVal === s.key ? 'clear' : 'filter'}`}</title>
              </path>
            ))
          )}
        </svg>
        <div className="dw-donut-c"><b>{total}</b><span>in range</span></div>
      </div>
      <div className="dw-dlegend">
        {slices.map((s) => (
          <button key={s.key} className={`dw-lg ${activeVal === s.key ? 'on' : ''}`} onClick={() => onPick(s)} data-testid={`dw-lg-${s.key}`} title={`Click to ${activeVal === s.key ? 'clear' : 'apply'} the ${s.label} filter`}>
            <i style={{ background: s.color }} />
            <span>{s.label}</span>
            <b>{s.pct}%</b>
          </button>
        ))}
        {!slices.length && <div className="dw-none">No appointments in range.</div>}
      </div>
    </div>
  )
}

function HeatChart({ data, onJump }) {
  const DOW = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']
  return (
    <div className="dw-heat" data-testid="dw-heat" style={{ '--hspan': data.hourSpan }}>
      <div className="dw-heat-row dw-heat-head" style={{ gridTemplateColumns: '22px repeat(' + data.hourSpan + ', 1fr)' }}>
        <span />
        {Array.from({ length: data.hourSpan }, (_, h) => <span key={h}>{(data.hourStart + h) % 3 === 0 ? `${data.hourStart + h}h` : ''}</span>)}
      </div>
      {data.grid.map((row, d) => (
        <div key={d} className="dw-heat-row" style={{ gridTemplateColumns: '22px repeat(' + data.hourSpan + ', 1fr)' }}>
          <span className="dw-heat-d">{DOW[d]}</span>
          {row.map((cell, h) => {
            const alpha = cell.minutes ? 18 + Math.round((cell.minutes / data.max) * 80) : 0
            return (
              <button
                key={h}
                className={`dw-heat-cell ${cell.minutes ? 'lit' : ''}`}
                style={cell.minutes ? { background: `color-mix(in srgb, var(--accent) ${alpha}%, var(--panel))`, borderColor: 'color-mix(in srgb, var(--accent) 45%, transparent)' } : undefined}
                data-testid={`dw-heat-${d}-${data.hourStart + h}`}
                title={`${DOW[d]} ${data.hourStart + h}:00 — ${cell.minutes} min · ${cell.count} session${cell.count === 1 ? '' : 's'}${data.firstDateByDow[d] ? ' · click to jump' : ''}`}
                onClick={() => cell.minutes && data.firstDateByDow[d] && onJump(d, data.hourStart + h)}
              />
            )
          })}
        </div>
      ))}
      <div className="dw-heat-note">delivered minutes · weekday × hour</div>
    </div>
  )
}

function KpiRow({ kpis, onPick }) {
  return (
    <div className="dw-kpis">
      {kpis.map((k) => {
        const rising = k.delta > 0
        const good = k.badRising ? !rising : rising
        const cls = !k.delta ? 'flat' : k.invert ? (rising ? 'bad' : 'good') : good ? 'good' : 'bad'
        return (
          <button key={k.k} type="button" className={`dw-kpi ${cls}${onPick ? ' pk' : ''}`} data-testid={`dw-kpi-${k.k}`} title={`${k.label} vs previous equal window${onPick ? ' · click to see the appointments behind it' : ''}`} onClick={() => onPick?.(k.k)}>
            <b>{fmtNum(k.value, k.fmt === 'money', k.fmt === 'pct')}</b>
            <span>{k.label}</span>
            {k.delta != null && <i>{k.delta > 0 ? '▲' : k.delta < 0 ? '▼' : '•'} {Math.abs(k.delta)}%</i>}
          </button>
        )
      })}
    </div>
  )
}

/* ---------- widget body dispatcher ---------- */

function WidgetBody({ w, ctx }) {
  const { state, days: gDays, filter, ui, settings, clientById, staffById, actions } = ctx
  const days = w.cfg?.range ? resolveRange(w.cfg.range, ui.anchor || todayISO(), settings.weekStart).days : gDays
  const meta = WIDGETS[w.type]
  if (w.type === 'trend') {
    const money = DASH_METRICS[w.cfg.metric]?.money
    const buckets = bucketize(days, w.cfg.bucket || 'auto', settings.weekStart)
    const series = trendSeries(state.appts, days, buckets, w.cfg.metric, filter, clientById)
    const jump = (key) => { actions.setUI({ section: 'calendar', view: 'week', anchor: key }); ctx.toast({ message: 'Calendar opened on that bucket', kind: 'info' }) }
    return (
      <div className="dw-plot">
        <div className="dw-plot-top">
          <b>{fmtNum(series.reduce((t, s) => t + s.value, 0), money)}</b><span>{DASH_METRICS[w.cfg.metric]?.label} · {buckets.length === 1 ? '1 bucket' : `${buckets.length} ${buckets[0]?.days.length === 1 ? 'days' : buckets[0]?.days.length <= 7 ? 'weeks' : 'months'}`}</span>
        </div>
        <SparkChart series={series} money={money} onJump={jump} />
      </div>
    )
  }
  if (w.type === 'bars') {
    const money = DASH_METRICS[w.cfg.metric]?.money
    const rows = topBreakdown(state.appts, days, w.cfg, clientById, staffById, filter)
    const active = filter[w.cfg.dim]
    return <BarsChart rows={rows} money={money} activeKey={active} onPick={(r) => ctx.setFilter(active === r.key ? { [w.cfg.dim]: null } : { [w.cfg.dim]: r.key })} />
  }
  if (w.type === 'donut') {
    const field = w.cfg.field || 'type'
    const slices = mixOf(state.appts, days, { field }, filter)
    const total = slices.reduce((t, s) => t + s.value, 0)
    const active = filter[field]
    return <DonutChart slices={slices} total={total} activeVal={active} onPick={(s) => ctx.setFilter(active === s.key ? { [field]: null } : { [field]: s.key })} />
  }
  if (w.type === 'heat') {
    const data = heatGrid(state.appts, days, filter, settings.workday)
    const jump = (d) => {
      const iso = data.firstDateByDow[d]
      if (!iso) return
      actions.setUI({ section: 'calendar', view: 'week', anchor: iso })
      ctx.toast({ message: `Calendar opened on ${iso} — that weekday has live load`, kind: 'info' })
    }
    return <HeatChart data={data} onJump={jump} />
  }
  if (w.type === 'ledger') {
    const all = ctx.rowsFor(w)
    const rows = w.cfg.order === 'desc' ? [...all].reverse() : all
    const n = Number(w.cfg.rows) || 12
    const conf = ctx.confSet(rows.slice(0, n))
    return (
      <div className="dw-ledwrap">
        <div className="dw-led">
          {rows.length === 0 && <p className="dd-more">Nothing matches the current range and filters.</p>}
          {rows.slice(0, n).map((a) => (
            <button key={a.id} type="button" className="wlx" data-testid={`wl-${w.id}-${a.id}`} onClick={() => (ctx.openDetail ? ctx.openDetail(a.id) : actions.setUI({ section: 'calendar', view: 'week', anchor: a.date }))}>
              <time>{parseISO(a.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} · {fmtTime(a.start, settings.h24)}–{fmtTime(a.end, settings.h24)}</time>
              <b>{a.title || apptAutoTitle({ ...a, clients: clientById, staff: staffById, settings })}</b>
              <span className="wlx-meta">{(a.clientIds || []).map((id) => clientById[id]?.name).filter(Boolean).join(', ') || (a.staffIds || []).map((id) => staffById[id]?.name).filter(Boolean).join(', ')}</span>
              {conf.has(a.id) && <em className="dd-conf">⚠ overlap</em>}
              <span className={`dd-st st-${a.status}`}>{a.status}</span>
            </button>
          ))}
        </div>
        <div className="wlx-foot">
          <span>{rows.length} appointment{rows.length === 1 ? '' : 's'} · respects filters{w.cfg.range ? ' + own range' : ''}</span>
          <button type="button" className="btn btn-sm btn-ghost" data-testid={`wlx-csv-${w.id}`} onClick={() => ctx.exportCsv({ ...w, type: 'ledger' }, all)}>CSV</button>
          <button type="button" className="btn btn-sm btn-ghost" data-testid={`wlx-all-${w.id}`} onClick={() => ctx.openData(w)}>See all →</button>
        </div>
      </div>
    )
  }
  // kpis
  const prior = priorDays(days)
  const kpis = pulseKpis(state.appts, days, prior, filter, clientById)
  return <KpiRow kpis={kpis} onPick={ctx.openData ? (k) => ctx.openData(w, { kpi: k }) : null} />
}

/* ---------- widget shell: title, live controls, reorder & remove ---------- */

function CfgSelect({ w, field, options, cfg, onChange }) {
  return (
    <select className="dw-sel" data-testid={`dw-cfg-${w.id}-${field}`} value={String(cfg[field] ?? '')} onChange={(e) => onChange({ [field]: e.target.value === 'auto' || /^\d+$/.test(e.target.value) ? (e.target.value === 'auto' ? 'auto' : Number(e.target.value)) : e.target.value })} title={field}>
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  )
}

function Widget({ w, ctx, idx, count }) {
  const meta = WIDGETS[w.type]
  const base = w.span ?? meta.span ?? 6
  const d = ctx.drag
  const resizing = d?.kind === 'size' && d.id === w.id
  const span = resizing && d.span ? d.span : base
  const h = resizing && d.h ? d.h : w.h ?? 1
  const cls = ['dsh-w']
  if (d?.kind === 'move' && d.id === w.id) cls.push('is-drag')
  if (d?.target?.id === w.id) cls.push(d.target.after ? 'drop-r' : 'drop-l')
  if (resizing) cls.push('is-size')
  if (ctx.menuOpen === w.id) cls.push('menu-open')
  return (
    <section className={cls.join(' ')} style={{ '--span': span, ...(w.nl ? { gridColumn: `1 / span ${span}` } : null) }} data-testid={`dash-widget-${w.id}`} data-type={w.type} data-wid={w.id} data-span={base} data-h={h}>
      <header className="dsh-w-head" onPointerDown={(e) => ctx.startMove(e, w)}>
        <span className="dw-grip" data-testid={`dw-drag-${w.id}`} title="Drag to move this widget" aria-hidden="true">{Icon.grip({ size: 13 })}</span>
        <span className="dsh-w-ic">{Icon[meta.icon]?.({ size: 12 }) || Icon.grid({ size: 12 })}</span>
        <b>{meta.name}</b>
        {w.type === 'trend' && (
          <>
            <CfgSelect w={w} field="metric" cfg={w.cfg} onChange={ctx.cfg(w.id)} options={Object.entries(DASH_METRICS).map(([k, m]) => [k, m.label])} />
            <CfgSelect w={w} field="bucket" cfg={w.cfg} onChange={ctx.cfg(w.id)} options={[['auto', 'auto'], ['day', 'by day'], ['week', 'by week'], ['month', 'by month']]} />
          </>
        )}
        {w.type === 'bars' && (
          <>
            <CfgSelect w={w} field="dim" cfg={w.cfg} onChange={ctx.cfg(w.id)} options={Object.entries(DASH_DIMS).map(([k, l]) => [k, l])} />
            <CfgSelect w={w} field="metric" cfg={w.cfg} onChange={ctx.cfg(w.id)} options={Object.entries(DASH_METRICS).map(([k, m]) => [k, m.label])} />
            <CfgSelect w={w} field="top" cfg={w.cfg} onChange={ctx.cfg(w.id)} options={[[5, 'top 5'], [8, 'top 8'], [12, 'top 12']]} />
          </>
        )}
        {w.type === 'ledger' && (
          <>
            <CfgSelect w={w} field="rows" cfg={w.cfg} onChange={ctx.cfg(w.id)} options={[[8, '8 rows'], [12, '12 rows'], [24, '24 rows'], [50, '50 rows']]} />
            <CfgSelect w={w} field="order" cfg={w.cfg} onChange={ctx.cfg(w.id)} options={[['asc', 'oldest first'], ['desc', 'newest first']]} />
          </>
        )}
        {w.type === 'donut' && (
          <span className="dw-seg" role="group">
            {['type', 'status'].map((f) => (
              <button key={f} className={(w.cfg.field || 'type') === f ? 'on' : ''} data-testid={`dw-cfg-${w.id}-field-${f}`} onClick={() => ctx.cfg(w.id)({ field: f })}>{f === 'type' ? 'Type' : 'Status'}</button>
            ))}
          </span>
        )}
        {w.cfg.range && (
          <button className="dw-rpill" data-testid={`dw-rpill-${w.id}`} title="Custom range on this widget — click to follow the global range again" onClick={() => ctx.actions.dash('cfg', { id: w.id, patch: { range: '' } })}>
            {RANGE_PRESETS.find((p) => p.id === w.cfg.range)?.label || w.cfg.range} ✕
          </button>
        )}
        <span className="dsh-w-sp" />
        <span className="dsh-w-tools">
          <button className="iconbtn" data-testid={`dw-mv-${w.id}-l`} aria-label="Move left" disabled={idx === 0} onClick={() => ctx.move(w.id, -1)}>{Icon.chevronL({ size: 12 })}</button>
          <button className="iconbtn" data-testid={`dw-mv-${w.id}-r`} aria-label="Move right" disabled={idx === count - 1} onClick={() => ctx.move(w.id, 1)}>{Icon.chevronR({ size: 12 })}</button>
          <button className="iconbtn dw-more" data-testid={`dw-more-${w.id}`} aria-label="Layout options" title="Width, height, clone" onClick={() => ctx.toggleMenu(w.id)}>{Icon.more({ size: 12 })}</button>
          <button className="iconbtn dw-rm" data-testid={`dw-rm-${w.id}`} aria-label={`Remove ${meta.name}`} title="Remove widget" onClick={() => ctx.remove(w.id)}>{Icon.x({ size: 12 })}</button>
        </span>
      </header>
      <div className="dsh-w-body"><WidgetBody w={w} ctx={ctx} /></div>
      <span className="dw-rz" data-testid={`dw-resize-${w.id}`} title="Drag to resize — snaps to thirds, halves or full width" onPointerDown={(e) => ctx.startResize(e, w)}>
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M9 3.4L3.4 9M9 6.6L6.6 9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
      </span>
      {resizing && <span className="dw-szbadge">{span} / 6 · {['auto', 'tall', 'full height'][h - 1]}</span>}
      {ctx.menuOpen === w.id && (
        <div className="dw-menu" role="menu" data-testid={`dw-menu-${w.id}`}>
          <b>Width</b>
          <div className="dw-menu-opts">
            {[[2, 'One-third'], [3, 'Half'], [4, 'Two-thirds'], [6, 'Full']].map(([sp, lab]) => (
              <button key={sp} className={base === sp ? 'on' : ''} data-testid={`dw-size-${w.id}-${sp}`} onClick={() => { ctx.actions.dash('resize', { id: w.id, span: sp }); ctx.closeMenu() }}>{lab}</button>
            ))}
          </div>
          <b>Height</b>
          <div className="dw-menu-opts">
            {[[1, 'Auto'], [2, 'Tall'], [3, 'Full height']].map(([hh, lab]) => (
              <button key={hh} className={h === hh ? 'on' : ''} data-testid={`dw-h-${w.id}-${hh}`} onClick={() => { ctx.actions.dash('height', { id: w.id, h: hh }); ctx.closeMenu() }}>{lab}</button>
            ))}
          </div>
          <b>Time range</b>
          <select className="dw-sel dw-menu-range" data-testid={`dw-range-${w.id}`} value={w.cfg.range || 'inherit'} onChange={(e) => { ctx.actions.dash('cfg', { id: w.id, patch: { range: e.target.value === 'inherit' ? '' : e.target.value } }); ctx.closeMenu() }}>
            <option value="inherit">Inherit global range</option>
            {RANGE_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
          <div className="dw-menu-acts">
            <button className={w.nl ? 'on' : ''} data-testid={`dw-newline-${w.id}`} onClick={() => { ctx.actions.dash('line', { id: w.id, nl: !w.nl }); ctx.closeMenu() }}>⤶ Start on a new row <i>{w.nl ? '✓' : ''}</i></button>
            <button data-testid={`dw-clone-${w.id}`} onClick={() => { ctx.actions.dash('clone', { id: w.id }); ctx.closeMenu(); ctx.toast({ message: `${meta.name} cloned — configure the copy independently`, kind: 'ok' }) }}>{Icon.plus({ size: 11 })} Clone widget</button>
            <button data-testid={`dw-data-${w.id}`} onClick={() => { ctx.closeMenu(); ctx.openData(w) }}>{Icon.rows({ size: 11 })} Underlying data ({ctx.dataCount(w)})</button>
            <button data-testid={`dw-csv-${w.id}`} onClick={() => { ctx.closeMenu(); ctx.exportCsv(w) }}>{Icon.download({ size: 11 })} Export CSV (chart data)</button>
          </div>
        </div>
      )}
    </section>
  )
}

/* ---------- the page ---------- */

export default function DashboardView({ onOpenDetail = null }) {
  const state = useStore()
  const { actions, ui, settings } = state
  const toast = useToast()
  const [gallery, setGallery] = useState(false)
  const widgets = state.dash?.widgets ?? DEFAULT_DASH
  const preset = ui.dashPreset || 'last4'
  const range = useMemo(() => resolveRange(preset, ui.anchor || todayISO(), settings.weekStart), [preset, ui.anchor, settings.weekStart])
  const days = range.days
  const filter = ui.dashFilter || {}
  const clientById = useMemo(() => Object.fromEntries(state.clients.map((c) => [c.id, c])), [state.clients])
  const staffById = useMemo(() => Object.fromEntries(state.staff.map((s) => [s.id, s])), [state.staff])

  const setFilter = (patch) => {
    const f = { ...filter }
    for (const [k, v] of Object.entries(patch)) { if (v == null) delete f[k]; else f[k] = v }
    actions.setUI({ dashFilter: Object.keys(f).length ? f : null })
  }
  const filterLabel = (k, v) => (k === 'staff' ? staffById[v]?.name : k === 'client' ? clientById[v]?.name : k === 'type' ? v : v)

  const cfg = (id) => (patch) => actions.dash('cfg', { id, patch })
  const [menuOpen, setMenuOpen] = useState(null)
  useEffect(() => {
    if (!menuOpen) return
    const off = (e) => { if (!e.target.closest('.dw-menu, .dw-more')) setMenuOpen(null) }
    const key = (e) => { if (e.key === 'Escape') setMenuOpen(null) }
    window.addEventListener('pointerdown', off)
    window.addEventListener('keydown', key)
    return () => { window.removeEventListener('pointerdown', off); window.removeEventListener('keydown', key) }
  }, [menuOpen])

  const boards = state.dash?.boards || []
  const [bSave, setBSave] = useState(false)
  const [bName, setBName] = useState('')
  const [delArm, setDelArm] = useState(null)
  useEffect(() => {
    if (!bSave) return
    const off = (e) => { if (!e.target.closest('.dsh-bpop, [data-testid="dash-board-save"]')) setBSave(false) }
    const key = (e) => { if (e.key === 'Escape') setBSave(false) }
    window.addEventListener('pointerdown', off)
    window.addEventListener('keydown', key)
    return () => { window.removeEventListener('pointerdown', off); window.removeEventListener('keydown', key) }
  }, [bSave])
  const saveBoard = () => {
    const name = bName.trim().slice(0, 42) || `Board ${boards.length + 1}`
    actions.dash('saveBoard', { name })
    setBSave(false); setBName('')
    toast({ message: `Layout saved as “${name}” — ${widgets.length} widgets`, kind: 'ok' })
  }

  /* ---- the appointments behind a widget's aggregation (drill-down source) ---- */
  const KPI_SUBS = { sessions: 'All scheduled sessions', revenue: 'Billable (completed) sessions', attendance: 'Attendance window (completed + no-show)', noshow: 'No-show appointments' }
  const widgetRows = (w, opts = {}) => {
    const cfg = w.cfg || {}
    const dd = cfg.range ? resolveRange(cfg.range, ui.anchor || todayISO(), settings.weekStart).days : days
    const dset = new Set(dd)
    let list = apptsFiltered(state.appts, filter, clientById).filter((a) => dset.has(a.date))
    if (w.type === 'heat') list = list.filter((a) => a.status === 'completed')
    if (opts.kpi === 'noshow') list = list.filter((a) => a.status === 'no-show')
    else if (opts.kpi === 'revenue' || opts.kpi === 'attendance' || w.type === 'heat') list = list.filter((a) => a.status === 'completed' || (opts.kpi === 'attendance' && a.status === 'no-show'))
    if (opts.kpi === 'attendance') list = list.filter((a) => a.status === 'completed' || a.status === 'no-show')
    if (w.type === 'bars' && cfg.dim) {
      const rows = topBreakdown(state.appts, dd, { ...cfg, top: 99 }, clientById, staffById, filter)
      const keys = new Set(rows.map((r) => r.key))
      const dim = cfg.dim
      list = list.filter((a) => {
        if (dim === 'staff') return (a.staffIds || []).some((id) => keys.has(id))
        if (dim === 'client') return (a.clientIds || []).some((id) => keys.has(id))
        if (dim === 'program') return (a.clientIds || []).some((cid) => keys.has(clientById[cid]?.program))
        if (dim === 'payer') return (a.clientIds || []).some((cid) => keys.has(clientById[cid]?.insurer || '—'))
        return true
      })
    }
    return [...list].sort((x, y) => (x.date === y.date ? x.start - y.start : x.date < y.date ? -1 : 1))
  }
  const [drawer, setDrawer] = useState(null) // { title, sub, ids }
  const dataCount = (w) => widgetRows(w).length
  const openData = (w, opts = {}) => {
    const list = widgetRows(w, opts)
    const dd = w.cfg?.range ? resolveRange(w.cfg.range, ui.anchor || todayISO(), settings.weekStart).days : days
    setDrawer({
      title: opts.kpi ? KPI_SUBS[opts.kpi] : `${WIDGETS[w.type]?.name || 'Widget'} — the data behind it`,
      sub: `${list.length} appointment${list.length === 1 ? '' : 's'} · ${dd[0]} → ${dd[dd.length - 1]} · ${Object.keys(filter).length ? `${Object.keys(filter).length} filter${Object.keys(filter).length > 1 ? 's' : ''} on` : 'no filters'}${w.cfg?.range ? ' · own range' : ''}`,
      ids: list.map((a) => a.id),
    })
  }
  useEffect(() => {
    if (!drawer) return
    const k = (e) => { if (e.key === 'Escape') setDrawer(null) }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [drawer])
  const drawerRows = drawer ? drawer.ids.map((id) => state.appts[id]).filter(Boolean) : []
  const drawerConflicts = useMemo(() => (drawer ? flagOverlaps(drawerRows) : new Set()), [drawer]) // eslint-disable-line react-hooks/exhaustive-deps
  const drawerExport = () => {
    if (!drawerRows.length) return
    const esc = (c) => { const t = String(c ?? ''); return /[",\r\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t }
    const head = ['date', 'time', 'appointment', 'type', 'status', 'clients', 'staff', 'units', 'charge']
    const rows = drawerRows.map((a) => [a.date, `${fmtTime(a.start, settings.h24)}–${fmtTime(a.end, settings.h24)}`, a.title || apptAutoTitle({ ...a, clients: clientById, staff: staffById, settings }), a.type, a.status, (a.clientIds || []).map((id) => clientById[id]?.name).filter(Boolean).join('; '), (a.staffIds || []).map((id) => staffById[id]?.name).filter(Boolean).join('; '), a.billing?.units ?? '', a.billing?.units && a.billing?.rate ? (a.billing.units * a.billing.rate).toFixed(2) : ''])
    download('aloha-dashboard-data.csv', '\ufeff' + [head, ...rows].map((r) => r.map(esc).join(',')).join('\r\n') + '\r\n', 'text/csv;charset=utf-8')
    toast({ message: `${rows.length} appointments exported`, kind: 'ok' })
  }

  /* ---- CSV export of the exact data behind a widget (respects its own range) ---- */
  const exportCsv = (w, explicitRows) => {
    const cfg = w.cfg || {}
    const dd = cfg.range ? resolveRange(cfg.range, ui.anchor || todayISO(), settings.weekStart).days : days
    const esc = (c) => { const t = String(c ?? ''); return /[",\r\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t }
    let head, rows = []
    if (w.type === 'trend') {
      const buckets = bucketize(dd, cfg.bucket || 'auto', settings.weekStart)
      const series = trendSeries(state.appts, dd, buckets, cfg.metric || 'sessions', filter, clientById)
      head = ['bucket', DASH_METRICS[cfg.metric || 'sessions']?.label || cfg.metric]
      rows = series.map((x) => [x.label, x.value])
    } else if (w.type === 'bars') {
      const br = topBreakdown(state.appts, dd, { dim: cfg.dim, metric: cfg.metric, top: 99 }, clientById, staffById, filter)
      head = ['rank', DASH_DIMS[cfg.dim] || 'entity', DASH_METRICS[cfg.metric || 'revenue']?.label || 'value']
      rows = br.map((r, i) => [i + 1, r.label, r.value])
    } else if (w.type === 'donut') {
      const field = cfg.field || 'type'
      const slices = mixOf(state.appts, dd, { field }, filter)
      const total = slices.reduce((t, x) => t + x.value, 0) || 1
      head = [field, 'sessions', 'share %']
      rows = slices.map((x) => [x.key, x.value, `${((x.value / total) * 100).toFixed(1)}%`])
    } else if (w.type === 'heat') {
      const g = heatGrid(state.appts, dd, filter, settings.workday)
      head = ['weekday', ...Array.from({ length: g.hourSpan }, (_, i) => `${g.hourStart + i}:00`), 'total minutes']
      rows = g.grid.map((row, d) => [['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][d], ...row.map((c) => c.minutes), row.reduce((t, c) => t + c.minutes, 0)])
    } else if (w.type === 'ledger') {
      head = ['date', 'time', 'appointment', 'type', 'status', 'clients', 'staff', 'units', 'charge']
      rows = (explicitRows || widgetRows(w)).map((a) => [a.date, `${fmtTime(a.start, settings.h24)}–${fmtTime(a.end, settings.h24)}`, a.title || apptAutoTitle({ ...a, clients: clientById, staff: staffById, settings }), a.type, a.status, (a.clientIds || []).map((id) => clientById[id]?.name).filter(Boolean).join('; '), (a.staffIds || []).map((id) => staffById[id]?.name).filter(Boolean).join('; '), a.billing?.units ?? '', a.billing?.units && a.billing?.rate ? (a.billing.units * a.billing.rate).toFixed(2) : ''])
    } else {
      const kp = pulseKpis(state.appts, dd, priorDays(dd), filter, clientById)
      head = ['metric', 'current', 'vs prior %']
      rows = kp.map((x) => [x.label, x.value, `${x.delta > 0 ? '+' : ''}${x.delta}%`])
    }
    const csv = [head, ...rows].map((r) => r.map(esc).join(',')).join('\r\n')
    const slug = (WIDGETS[w.type]?.name || w.type).toLowerCase().replace(/[^a-z0-9]+/g, '-')
    download(`aloha-dashboard-${slug}.csv`, '\ufeff' + csv + '\r\n', 'text/csv;charset=utf-8')
    toast({ message: `${rows.length} rows exported — the data behind ${WIDGETS[w.type]?.name}${cfg.range ? ' (its own range)' : ''}`, kind: 'ok' })
  }

  /* ---- drag-to-move & drag-to-resize board engine (pointer events, no deps) ---- */
  const boardRef = useRef(null)
  const dragRef = useRef(null)
  const [drag, setDrag] = useState(null) // {id, kind:'move'|'size', span?, target?:{id,after}, to?}
  useEffect(() => {
    if (!drag) return
    const board0 = boardRef.current
    const autoScroll = (clientY) => { // edge auto-scroll so tall boards stay draggable end-to-end
      if (!board0 || typeof clientY !== 'number') return
      if (board0.scrollHeight <= board0.clientHeight + 4) return
      const r = board0.getBoundingClientRect()
      if (clientY <= r.top || clientY >= r.bottom) return
      const EDGE = 64
      const dBot = r.bottom - clientY, dTop = clientY - r.top
      if (dBot < EDGE) board0.scrollTop += Math.ceil((EDGE - dBot) / 3)
      else if (dTop < EDGE) board0.scrollTop -= Math.ceil((EDGE - dTop) / 3)
    }
    // keep pushing even when the pointer rests at the edge — the last known y drives a 40ms ticker
    const ticker = setInterval(() => autoScroll(dragRef.current?.lastY), 40)
    const onMove = (e) => {
      const d = dragRef.current
      if (!d) return
      d.lastY = e.clientY
      autoScroll(e.clientY)
      if (d.kind === 'size') {
        const span = Math.max(1, Math.min(6, d.span0 + Math.round((e.clientX - d.x0) / d.cell)))
        const h = Math.max(1, Math.min(3, d.h0 + Math.round((e.clientY - d.y0) / 130)))
        if (span !== d.span || h !== d.h) { d.span = span; d.h = h; setDrag((v) => ({ ...v, span, h })) }
        return
      }
      const board = boardRef.current
      if (!board) return
      const order = widgets.map((w) => w.id)
      let best = null
      for (const el of board.querySelectorAll('.dsh-w')) {
        const id = el.dataset.wid
        if (id === d.id) continue
        const r = el.getBoundingClientRect()
        if (!r.width) continue
        const cx = r.left + r.width / 2
        const inside = e.clientX >= r.left - 10 && e.clientX <= r.right + 10 && e.clientY >= r.top - 14 && e.clientY <= r.bottom + 14
        const score = inside ? 0 : Math.hypot(e.clientX - cx, (e.clientY - (r.top + r.height / 2)) / 4)
        if (!best || score < best.score) best = { score, id, after: e.clientX > cx }
      }
      const at = best ? `${best.id}:${best.after ? 'r' : 'l'}` : ''
      if (at !== d.at) {
        d.at = at
        d.target = best || null
        if (best) { const ti = order.indexOf(best.id); d.to = Math.max(0, Math.min(order.length - 1, ti + (best.after ? 1 : 0))) }
        setDrag((v) => ({ ...v, target: best ? { id: best.id, after: best.after } : null }))
      }
    }
    const finish = (commit) => {
      const d = dragRef.current
      dragRef.current = null
      document.body.classList.remove('dsh-moving')
      if (commit && d) {
        if (d.kind === 'size') {
          const changed = []
          if (d.span && d.span !== d.span0) { actions.dash('resize', { id: d.id, span: d.span }); changed.push(`${d.span} / 6 cols`) }
          if (d.h && d.h !== d.h0) { actions.dash('height', { id: d.id, h: d.h }); changed.push(['auto', 'tall', 'full height'][d.h - 1]) }
          if (changed.length) { const src = widgets.find((w) => w.id === d.id); toast({ message: `${WIDGETS[src?.type]?.name ?? 'Widget'} — ${changed.join(' · ')}`, kind: 'ok' }) }
        }
        else if (d.kind === 'move' && d.target) actions.dash('order', { id: d.id, index: d.to })
      }
      setDrag(null)
    }
    const onUp = () => finish(true)
    const onKey = (e) => { if (e.key === 'Escape') finish(false) }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    window.addEventListener('keydown', onKey)
    return () => { clearInterval(ticker); window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); window.removeEventListener('pointercancel', onUp); window.removeEventListener('keydown', onKey) }
  }, [drag?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const startMove = (e, w) => {
    if (e.button || widgets.length < 2) return
    if (e.target.closest('button, select, input, a, .dw-seg')) return
    e.preventDefault()
    dragRef.current = { kind: 'move', id: w.id, at: '', target: null }
    document.body.classList.add('dsh-moving')
    setDrag({ kind: 'move', id: w.id })
  }
  const startResize = (e, w) => {
    if (e.button) return
    e.preventDefault(); e.stopPropagation()
    const board = boardRef.current
    const cell = board ? (board.clientWidth - 28 + 12) / 6 : 190
    const span0 = w.span ?? WIDGETS[w.type]?.span ?? 6
    dragRef.current = { kind: 'size', id: w.id, x0: e.clientX, y0: e.clientY, cell, span0, span: null, h0: w.h ?? 1, h: w.h ?? 1 }
    document.body.classList.add('dsh-moving')
    setDrag({ kind: 'size', id: w.id, span0, h: w.h ?? 1 })
  }


  const ctx = {
    state, days, filter, ui, settings, clientById, staffById, actions, toast, setFilter, cfg,
    remove: (id) => { actions.dash('remove', { id }); toast({ message: 'Widget removed — ↺ restores the standard board', kind: 'info' }) },
    move: (id, dir) => actions.dash('move', { id, dir }),
    startMove, startResize, drag,
    menuOpen, toggleMenu: (id) => setMenuOpen((v) => (v === id ? null : id)), closeMenu: () => setMenuOpen(null),
    exportCsv, openData, dataCount, rowsFor: widgetRows, confSet: flagOverlaps, openDetail: onOpenDetail,
  }

  const activeFilters = Object.entries(filter)
  return (
    <div className="sectionpage">
      <SectionBar icon="grid" title="Dashboard" sub={`${widgets.length} widget${widgets.length === 1 ? '' : 's'} · ${range.label}${activeFilters.length ? ` · ${activeFilters.length} filter${activeFilters.length > 1 ? 's' : ''} on` : ''}`}>
        <label className="fld" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <select className="input dsh-rsel" data-testid="dash-range" value={preset} onChange={(e) => actions.setUI({ dashPreset: e.target.value })}>
            {RANGE_PRESETS.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
          </select>
        </label>
        {widgets.length > 0 && (
          <button className="btn btn-sm" data-testid="dash-reset" onClick={() => { actions.dash('reset'); toast({ message: 'Layout reset to the standard five', kind: 'info' }) }} title="Restore the default widget layout">{Icon.undo({ size: 12 })}</button>
        )}
        <span style={{ position: 'relative' }}>
          <button className="btn btn-sm btn-primary" data-testid="dash-add" onClick={() => setGallery((v) => !v)}>{Icon.plus({ size: 13 })} Widget</button>
          {gallery && (
            <div className="dsh-gallery" data-testid="dash-gallery" role="menu">
              <b>Add a widget</b>
              {Object.entries(WIDGETS).map(([k, m]) => {
                const used = widgets.filter((w) => w.type === k).length
                return (
                  <button key={k} className="dsh-g-item" role="menuitem" data-testid={`dash-add-${k}`} onClick={() => { actions.dash('add', { wtype: k }); setGallery(false); toast({ message: `${m.name} added — configure it from its header`, kind: 'ok' }) }}>
                    <span className="gg-ic">{Icon[m.icon]?.({ size: 13 }) || Icon.grid({ size: 13 })}</span>
                    <span><b>{m.name}</b><i>{m.blurb}</i></span>
                    {used > 0 && <em>{used} on board</em>}
                  </button>
                )
              })}
            </div>
          )}
        </span>
      </SectionBar>

      <div className="dsh-boards" data-testid="dsh-boards">
        <span className="dsh-blabel">{Icon.grid({ size: 11 })} boards</span>
        {boards.length === 0 && <em className="dsh-bnone">save the current layout to switch views like “Morning huddle” and “Billing review” in one click</em>}
        {boards.map((b) => (
          <span key={b.id} className="dsh-bchip" title={`Saved ${new Date(b.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} · ${b.widgets.length} widgets`}>
            <button data-testid={`dash-board-${b.id}`} onClick={() => { actions.dash('loadBoard', { id: b.id }); setDelArm(null); toast({ message: `Board “${b.name}” loaded`, kind: 'ok' }) }}>{b.name}</button>
            <button className={`dsh-bdel${delArm === b.id ? ' armed' : ''}`} data-testid={`dash-board-del-${b.id}`} aria-label={`Delete ${b.name}`} title={delArm === b.id ? 'Click again to delete for real' : 'Delete board'}
              onClick={() => { if (delArm === b.id) { actions.dash('delBoard', { id: b.id }); setDelArm(null); toast({ message: `Board “${b.name}” deleted`, kind: 'info' }) } else { setDelArm(b.id); setTimeout(() => setDelArm((v) => (v === b.id ? null : v)), 2600) } }}>✕</button>
          </span>
        ))}
        <span className="dsh-b-sp" />
        <span className="dsh-bsave">
          <button className="btn btn-sm btn-ghost" data-testid="dash-board-save" onClick={() => { setBSave((v) => !v); setBName('') }}>{Icon.bookmark ? Icon.bookmark({ size: 12 }) : Icon.plus({ size: 12 })} Save layout</button>
          {bSave && (
            <div className="dsh-bpop" data-testid="dsh-bpop">
              <b>Name this board</b>
              <input className="input" data-testid="dash-bname" autoFocus value={bName} placeholder="e.g. Morning huddle" onChange={(e) => setBName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') saveBoard(); if (e.key === 'Escape') setBSave(false) }} />
              <button className="btn btn-sm btn-primary" data-testid="dash-bpop-save" onClick={saveBoard}>Save</button>
            </div>
          )}
        </span>
      </div>

      {activeFilters.length > 0 && (
        <div className="dsh-fchips" data-testid="dash-filters">
          <span className="dfc-l">{Icon.filter({ size: 11 })} dashboard filter</span>
          {activeFilters.map(([k, v]) => (
            <button key={k} className="dsh-fchip" data-testid={`dash-filter-${k}`} onClick={() => setFilter({ [k]: null })} title={`Clear the ${k} filter`}>
              {FILTER_KEYS[k]}: {filterLabel(k, v)} <i>✕</i>
            </button>
          ))}
          <button className="dsh-fclear" data-testid="dash-filter-clear" onClick={() => setFilter({ staff: null, client: null, program: null, payer: null, type: null, status: null })}>clear all</button>
        </div>
      )}

      {drawer && (
        <div className="dsh-drawerwrap" data-testid="dash-drawer-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) setDrawer(null) }}>
          <aside className="dsh-drawer" role="dialog" aria-modal="false" aria-label="Underlying appointments" data-testid="dsh-drawer">
            <header>
              <div className="dd-head">
                <b>{drawer.title}</b>
                <span>{drawer.sub}</span>
              </div>
              <button className="iconbtn" data-testid="dd-export" title="Export these rows as CSV" onClick={drawerExport} disabled={!drawerRows.length}>{Icon.download({ size: 13 })}</button>
              <button className="iconbtn" data-testid="dd-close" aria-label="Close" onClick={() => setDrawer(null)}>{Icon.x({ size: 13 })}</button>
            </header>
            <div className="dd-list">
              {drawerRows.length === 0 && <p className="dd-more">Nothing matches this slice — widen the range or clear filters.</p>}
              {drawerRows.slice(0, 240).map((a) => (
                <div key={a.id} className="dd-roww">
                  <button type="button" className="dd-row" data-testid={`dd-row-${a.id}`} onClick={() => { actions.setUI({ section: 'calendar', view: 'week', anchor: a.date }); setDrawer(null); toast({ message: 'Calendar opened on that day', kind: 'info' }) }}>
                  <time>{parseISO(a.date).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })} · {fmtTime(a.start, settings.h24)}–{fmtTime(a.end, settings.h24)}{drawerConflicts.has(a.id) && <em className="dd-conf" title="This time overlaps another appointment sharing assigned staff">⚠ overlap</em>}</time>
                  <b>{a.title || apptAutoTitle({ ...a, clients: clientById, staff: staffById, settings })}</b>
                  <span className="dd-meta">{(a.clientIds || []).map((id) => clientById[id]?.name).filter(Boolean).join(', ') || (a.staffIds || []).map((id) => staffById[id]?.name).filter(Boolean).join(', ')}</span>
                  <span className={`dd-st st-${a.status}`}>{a.status}</span>
                  </button>
                  {onOpenDetail && (
                    <button type="button" className="dd-open" data-testid={`dd-open-${a.id}`} title="Open the full record" onClick={() => { onOpenDetail(a.id); setDrawer(null) }}>{Icon.expand({ size: 12 })}</button>
                  )}
                </div>
              ))}
              {drawerRows.length > 240 && <p className="dd-more">Showing first 240 of {drawerRows.length} — the CSV export contains all rows.</p>}
            </div>
          </aside>
        </div>
      )}

      {widgets.length ? (
        <div className="dsh-grid" ref={boardRef}>
          {widgets.map((w, i) => (
            <Widget key={w.id} w={w} ctx={ctx} idx={i} count={widgets.length} />
          ))}
        </div>
      ) : (
        <div className="dsh-empty" data-testid="dash-empty">
          <span>{Icon.grid({ size: 22 })}</span>
          <b>A blank board. Build your analytics.</b>
          <p>Pick the views you actually read every morning — trends, mix, leaders, heat — each one filters and aggregates live.</p>
          <button className="btn btn-sm btn-primary" data-testid="dash-empty-add" onClick={() => setGallery(true)}>{Icon.plus({ size: 13 })} Add a widget</button>
        </div>
      )}
    </div>
  )
}
