import React, { useMemo, useState } from 'react'
import { useStore } from '../state/store'
import { SectionBar, RangePicker } from './NavRail'
import { Icon } from '../ui/Icons'
import { useToast } from '../ui/Toast'
import { DAY_SHORT, addDays, fmtDayLabel, isoDate, parseISO, todayISO } from '../lib/date'
import { TYPES, STATUSES } from '../lib/model'
import { METRICS, DIMS, pivotRows, heatMatrix, bucketize, resolveRange, rangeMetrics, metricOf, seriesFor, delta, priorDays } from '../lib/analytics'
import { download } from '../lib/ics'

const MIX_COLORS = ['#6366f1', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#64748b', '#a855f7', '#22c55e', '#ef4444']

function Donut({ parts, centerTop, centerSub }) {
  const total = Math.max(1e-6, parts.reduce((t, p) => t + p.value, 0))
  let acc = 0
  const stops = parts
    .map((p, i) => {
      const a = (acc / total) * 100
      acc += p.value
      const b = (acc / total) * 100
      return `${p.color} ${a.toFixed(2)}% ${b.toFixed(2)}%`
    })
    .join(', ')
  return (
    <div className="donutwrap">
      <div className="donut" style={{ background: parts.length ? `conic-gradient(${stops})` : 'var(--panel-3)' }}>
        <span className="hole">
          <b>{centerTop}</b>
          <i>{centerSub}</i>
        </span>
      </div>
      <div className="donut-legend">
        {parts.slice(0, 8).map((p) => (
          <span key={p.label}>
            <i style={{ background: p.color }} /> {p.label} <b>{p.display}</b>
          </span>
        ))}
        {!parts.length && <span className="muted">No data in range</span>}
      </div>
    </div>
  )
}

/** Mini kpi sparkline — buckets as tiny bars, colored by trend. */
function Spark({ series, on }) {
  const max = Math.max(1, ...series.map((s) => s.value))
  return (
    <span className={`spark ${on ? 'on' : 'off'}`}>
      {series.slice(-12).map((s) => (
        <i key={s.key} style={{ height: `${Math.max(8, (s.value / max) * 100)}%` }} />
      ))}
    </span>
  )
}

/** Aggregated (or per-peak / averaged) value for one bucket. */
function bucketValue(state, b, metric, agg) {
  const m = rangeMetrics(state, b.days)
  if (agg === 'peak') {
    let mx = 0
    for (const d of b.days) mx = Math.max(mx, metricOf(metric, rangeMetrics(state, [d])))
    return metric === 'revenue' || metric === 'units' ? mx : Math.round(mx)
  }
  const v = metricOf(metric, m)
  if (agg === 'avg') {
    const w = Math.max(1, b.days.length / 7)
    return metric === 'utilization' || metric === 'revenue' ? Math.round(v / w) : Math.round((v / w) * 10) / 10
  }
  return v
}

/**
 * Analytics section — slide & scroll the range, pick any metric × any dimension,
 * aggregate per bucket, compare vs prior period, drill into entities and hand
 * the selection off to the calendar, the report builder or a CSV.
 */
export default function AnalyticsView() {
  const state = useStore()
  const { ui, actions, settings } = state
  const toast = useToast()
  const [drill, setDrill] = useState(null) // {dim,key,label} — active pivot selection
  const [sortKey, setSortKey] = useState('revenue')

  const cfg = { preset: ui.anPreset || settings.analytics?.preset || 'last4', gran: settings.analytics?.gran || 'auto', metric: settings.analytics?.metric || 'sessions', dim: settings.analytics?.dim || 'staff', chart: settings.analytics?.chart || 'line', compare: settings.analytics?.compare !== false, agg: settings.analytics?.agg || 'sum' }
  const setCfg = (p) => actions.setSettings({ analytics: { ...(settings.analytics || {}), ...p } })

  const range = useMemo(() => resolveRange(cfg.preset, ui.anchor, settings.weekStart), [cfg.preset, ui.anchor, settings.weekStart])
  const days = range.days
  const buckets = useMemo(() => bucketize(days, cfg.gran, settings.weekStart), [days, cfg.gran, settings.weekStart])
  const series = useMemo(() => buckets.map((b) => ({ key: b.key, label: b.label, start: b.start, value: bucketValue(state, b, cfg.metric, cfg.agg) })), [state.appts, buckets, cfg.metric, cfg.agg])
  const prevSeries = useMemo(() => {
    if (!cfg.compare || rangeMetrics(state, priorDays(days)).appts === 0) return null // no phantom ghost vs empty windows
    const pb = bucketize(priorDays(days), cfg.gran, settings.weekStart)
    return pb.map((b, i) => ({ key: b.key, label: b.label, value: bucketValue(state, b, cfg.metric, cfg.agg), bucketLabel: buckets[i]?.label }))
  }, [cfg.compare, days, buckets, cfg.gran, cfg.metric, cfg.agg, state.appts])

  const cur = useMemo(() => rangeMetrics(state, days), [state.appts, days])
  const prev = useMemo(() => (cfg.compare ? rangeMetrics(state, priorDays(days)) : null), [cfg.compare, state.appts, days])

  // KPI cards with period-over-period deltas + sparklines
  const kpis = useMemo(() => {
    const comparable = !!prev && prev.appts > 0 // don't show a fake +100% against an empty prior window
    const mk = (id, metric, label, fmtVal, invert) => {
      const v = metricOf(metric, cur)
      const d = comparable ? delta(v, metricOf(metric, prev)) : null
      return { id, metric, label, val: fmtVal(v), d, invert, spark: buckets.map((b) => ({ key: b.key, value: metricOf(metric, rangeMetrics(state, b.days)) })) }
    }
    return [
      mk('sessions', 'sessions', 'Sessions', (v) => `${Math.round(v)}`),
      mk('hours', 'hours', 'Client hours', (v) => `${Math.round(v)}h`),
      mk('units', 'units', 'Billable units', (v) => `${Math.round(v * 4) / 4}`),
      mk('revenue', 'revenue', 'Gross revenue', (v) => `$${Math.round(v).toLocaleString()}`),
      mk('util', 'utilization', 'Utilization', (v) => `${Math.round(v)}%`),
      mk('cover', 'cover', 'Recoverable slots', (v) => `${Math.round(v)}`),
    ]
  }, [cur, prev, buckets, state.appts])

  const pivot = useMemo(() => {
    let rows = pivotRows(state, days, cfg.dim)
    if (drill) rows = rows.filter((r) => r.key === drill.key)
    else if (rows.length > 14) rows = rows.slice(0, 14)
    return rows
  }, [state.appts, days, cfg.dim, drill])
  const heat = useMemo(() => heatMatrix(state, days), [state.appts, days])
  const maxHeat = Math.max(1, ...heat.grid.flat().map((c) => c.count))

  // ---- range slider: scrub ui.anchor across the demo horizon (syncs calendar too) ----
  const hStart = addDays(parseISO(todayISO()), -140)
  const sliderVal = Math.max(0, Math.min(168, Math.round((parseISO(ui.anchor) - hStart) / 86400000)))
  const setSlider = (v) => actions.setUI({ anchor: isoDate(addDays(hStart, v)) })

  const exportCSV = () => {
    const lines = [`# Aloha ABA analytics — ${METRICS[cfg.metric].label} by ${cfg.gran}, ${range.label} (${cfg.agg})`, 'period,value']
    for (const s of series) lines.push(`${s.key},${s.value}`)
    lines.push('')
    lines.push(`# breakdown by ${DIMS[cfg.dim].label}`)
    lines.push('entity,sessions,hours,units,revenue,cancelled,noShow')
    for (const r of pivotRows(state, days, cfg.dim)) lines.push([`"${r.label.replace(/"/g, '""')}"`, r.sessions, r.hours, r.units, r.revenue, r.cancelled, r.noShow].join(','))
    download(`pulse-aba-analytics-${todayISO()}.csv`, lines.join('\n'))
    toast({ message: 'Analytics CSV exported', kind: 'ok' })
  }

  const openInCalendar = () => {
    const patch = { section: 'calendar', view: 'week', anchor: cfg.preset === 'week' ? days[0] : todayISO() }
    if (drill) {
      if (cfg.dim === 'staff') patch.staffSel = [drill.key]
      else if (cfg.dim === 'client') patch.clientSel = [drill.key]
      else if (cfg.dim === 'team') patch.teamSel = [drill.key]
    }
    actions.setUI(patch)
    toast({ message: drill ? `Calendar filtered to ${drill.label}` : 'Calendar opened for this range', kind: 'info' })
  }

  const toReports = () => {
    actions.setUI({ section: 'reports', repPreset: cfg.preset, repDim: drill ? cfg.dim : null, repKey: drill ? drill.key : null })
    toast({ message: drill ? `Report scoped to ${drill.label}` : 'Report builder opened with this range', kind: 'info' })
  }

  // ---- chart geometry ----
  const compact = series.length <= 8
  const w = Math.max(620, series.length * (compact ? 168 : 76))
  const H = 300
  const maxV = Math.max(1e-6, ...series.map((s) => s.value), ...(prevSeries || []).map((s) => s.value))
  const xOf = (i) => 28 + i * ((w - 56) / Math.max(1, series.length - 1))
  const yOf = (v) => H - 18 - (v / maxV) * (H - 42)
  const path = (ss) => ss.map((s, i) => `${i ? 'L' : 'M'}${xOf(i).toFixed(1)},${yOf(s.value).toFixed(1)}`).join(' ')

  return (
    <div className="sectionpage">
      <SectionBar icon="spark" title="Analytics" sub={`${range.label} · ${METRICS[cfg.metric].label} by ${cfg.gran === 'auto' ? 'auto' : cfg.gran} · aggregated ${cfg.agg}`}>
        <RangePicker
          preset={cfg.preset}
          onPreset={(p) => actions.setUI({ anPreset: p })}
          onSlide={(dir) => actions.setUI({ anchor: isoDate(addDays(parseISO(ui.anchor), dir * days.length)) })}
          label={range.label}
          gran={cfg.gran}
          onGran={(g) => setCfg({ gran: g })}
        />
        <button className="btn btn-sm" onClick={exportCSV} title="Download this view as CSV">
          {Icon.download({ size: 13 })} CSV
        </button>
        <button className="btn btn-sm" onClick={toReports} data-testid="an-to-reports" title="Carry this range & drill-down into the report builder">
          {Icon.file({ size: 13 })} Report this
        </button>
      </SectionBar>

      <div className="anv-body">
        {/* slider: literally slide the window across the horizon */}
        <div className="anv-slider panel">
          <span className="muted">Slide window</span>
          <input
            type="range"
            min={0}
            max={168}
            value={sliderVal}
            data-testid="an-slider"
            onChange={(e) => setSlider(Number(e.target.value))}
            aria-label="Slide the analytics window across the demo horizon"
            style={{ backgroundSize: `${(sliderVal / 168) * 100}% 100%` }}
          />
          <span className="anv-slider-lbl">{isoDate(parseISO(days[0]))} → {isoDate(parseISO(days[days.length - 1]))}</span>
          <button className="btn btn-sm btn-ghost" onClick={() => actions.setUI({ anchor: todayISO() })}>Reset</button>
        </div>

        <div className="anv-controls panel">
          <label className="anv-ctl">
            <span>Metric</span>
            <select className="input" value={cfg.metric} data-testid="an-metric" onChange={(e) => setCfg({ metric: e.target.value })}>
              {Object.entries(METRICS).map(([k, m]) => (
                <option key={k} value={k}>{m.label}</option>
              ))}
            </select>
            <i className="muted">{METRICS[cfg.metric].desc}</i>
          </label>
          <label className="anv-ctl">
            <span>Break down by</span>
            <select className="input" value={cfg.dim} data-testid="an-dim" onChange={(e) => { setCfg({ dim: e.target.value }); setDrill(null) }}>
              {Object.entries(DIMS).map(([k, d]) => (
                <option key={k} value={k}>{d.label}</option>
              ))}
            </select>
            <i className="muted">Pivot entity for the breakdown table</i>
          </label>
          <div className="anv-ctl">
            <span>Chart</span>
            <div className="viewseg" role="group" aria-label="Chart type" data-testid="an-chart">
              {[['line', 'Line'], ['bars', 'Bars'], ['heat', 'Heat'], ['donut', 'Mix'], ['table', 'Table']].map(([k, l]) => (
                <button key={k} className={cfg.chart === k ? 'on' : ''} onClick={() => setCfg({ chart: k })}>{l}</button>
              ))}
            </div>
          </div>
          <div className="anv-ctl">
            <span>Aggregate</span>
            <div className="viewseg" role="group" aria-label="Aggregation">
              {[['sum', 'Total'], ['avg', 'Per week'], ['peak', 'Peak day']].map(([k, l]) => (
                <button key={k} className={cfg.agg === k ? 'on' : ''} onClick={() => setCfg({ agg: k })}>{l}</button>
              ))}
            </div>
          </div>
          <div className="anv-ctl">
            <span>Compare</span>
            <button className={`tgl ${cfg.compare ? 'on' : ''}`} role="switch" aria-checked={cfg.compare} data-testid="an-compare" onClick={() => setCfg({ compare: !cfg.compare })}>
              <i />
            </button>
            <i className="muted">vs previous {days.length}d</i>
          </div>
          <div className="f1" />
          <button className="btn btn-sm" onClick={openInCalendar} data-testid="an-to-cal">
            {Icon.cal({ size: 13 })} Open in calendar
          </button>
        </div>

        {drill && (
          <div className="anv-drill" data-testid="an-drill">
            <span>Drilled into <b>{DIMS[cfg.dim].label}</b>: {drill.label}</span>
            <button className="chipx" onClick={() => setDrill(null)} aria-label="Clear drill-down">{Icon.x({ size: 11 })}</button>
          </div>
        )}

        <div className="an-kpis" data-testid="an-kpi-row">
          {kpis.map((k) => (
            <div key={k.id} className={`an-kpi k-${k.id} ${k.id === 'cover' && cur.needsCover ? 'hot' : ''}`} data-testid={k.id === 'sessions' ? 'an-kpi-sessions' : k.id === 'cover' ? 'an-kpi-cover' : undefined}>
              <b>{k.val}</b>
              <span>{k.label}</span>
              <div className="an-kpi-b">
                {k.d != null && (
                  <i className={`k-delta ${k.d >= 0 ? (k.invert ? 'bad' : 'up') : k.invert ? 'bad' : 'down'}`}>
                    {k.d >= 0 ? Icon.chevDown({ size: 10, className: 'flip' }) : Icon.chevDown({ size: 10 })}
                    {Math.abs(k.d)}%
                  </i>
                )}
                {k.id === 'cover' && cur.needsCover > 0 ? (
                  <button className="btn btn-sm" style={{ height: 20, padding: '0 8px' }} onClick={() => actions.setUI({ inbox: true })}>Backfill</button>
                ) : (
                  <Spark series={k.spark} on={cfg.compare} />
                )}
              </div>
            </div>
          ))}
        </div>

        <div className={`anv-main ${cfg.chart === 'heat' || cfg.chart === 'donut' ? 'wide1' : ''}`}>
          <section className="panel an-card anv-trend" data-testid="an-trend">
            <h3>
              <span className="pi">{Icon.cal({ size: 14 })}</span> {METRICS[cfg.metric].label} — per {buckets.length > 1 ? cfg.gran === 'auto' ? 'bucket' : cfg.gran : 'day'}
              <span className="an-legend muted">{buckets.length} buckets{prevSeries ? ' · ghost = prior period' : ''}</span>
            </h3>
            <div className="anv-scroll">
              {(cfg.chart === 'line' || cfg.chart === 'bars') && (
                <svg className="anv-svg" width={w} height={H + 26} role="img" aria-label={`${METRICS[cfg.metric].label} trend chart`}>
                  {[0.25, 0.5, 0.75, 1].map((g) => (
                    <g key={g}>
                      <line x1={20} x2={w - 8} y1={yOf(maxV * g)} y2={yOf(maxV * g)} stroke="var(--line)" strokeDasharray="3 4" />
                      <text x={2} y={yOf(maxV * g) + 3} fontSize={8.5} fill="var(--muted)">{METRICS[cfg.metric].fmt(maxV * g)}</text>
                    </g>
                  ))}
                  {cfg.chart === 'line' ? (
                    <>
                      {prevSeries && <path d={path(prevSeries)} fill="none" stroke="var(--muted)" strokeWidth={1.6} strokeDasharray="5 4" opacity={0.8} />}
                      <path d={`${path(series)} L${xOf(series.length - 1)},${H - 18} L${xOf(0)},${H - 18} Z`} fill="url(#agrad)" opacity={0.16} />
                      <defs>
                        <linearGradient id="agrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="var(--accent)" />
                          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
                        </linearGradient>
                      </defs>
                      <path d={path(series)} fill="none" stroke="var(--accent)" strokeWidth={2.4} strokeLinejoin="round" />
                    </>
                  ) : (
                    series.map((s, i) => {
                      const bw = Math.max(8, Math.min(60, (w - 56) / series.length - 14))
                      return (
                        <g key={s.key}>
                          {prevSeries && prevSeries[i] && <rect x={xOf(i) - bw / 2 - 3} y={yOf(prevSeries[i].value)} width={3} height={H - 18 - yOf(prevSeries[i].value)} rx={1.5} fill="var(--muted)" opacity={0.55} />}
                          <rect x={xOf(i) - bw / 2} y={yOf(s.value)} width={bw} height={Math.max(2, H - 18 - yOf(s.value))} rx={4} fill="var(--accent-2)" className="anv-hit" onClick={() => actions.setUI({ anchor: s.start, section: 'calendar', view: cfg.gran === 'day' ? 'day' : 'week' })}>
                            <title>{`${s.label}: ${METRICS[cfg.metric].fmt(s.value)} — click opens this bucket in the calendar`}</title>
                          </rect>
                        </g>
                      )
                    })
                  )}
                  {series.map((s, i) => (
                    <g key={`x${s.key}`} className="anv-hit" onClick={() => cfg.chart === 'line' && actions.setUI({ anchor: s.start, section: 'calendar', view: cfg.gran === 'day' ? 'day' : 'week' })}>
                      <circle cx={xOf(i)} cy={yOf(s.value)} r={cfg.chart === 'line' ? 3.4 : 0} fill="var(--panel)" stroke="var(--accent)" strokeWidth={2} />
                      <text x={xOf(i)} y={H + 4} fontSize={9} textAnchor="middle" fill="var(--text-2)">{s.label.split(' ')[0]}</text>
                      <text x={xOf(i)} y={yOf(s.value) - 8} fontSize={9} fontWeight={700} textAnchor="middle" fill="var(--text)" style={{ display: cfg.chart === 'line' ? 'none' : undefined }}>{METRICS[cfg.metric].fmt(s.value)}</text>
                    </g>
                  ))}
                </svg>
              )}
              {cfg.chart === 'heat' && (
                <div className="anv-heat" role="img" aria-label="Sessions heat map by weekday and hour">
                  <span />
                  {Array.from({ length: heat.hourSpan }, (_, i) => (
                    <span key={i} className="hh">{heat.hourStart + i}</span>
                  ))}
                  {[1, 2, 3, 4, 5, 6, 0].map((dow) => (
                    <React.Fragment key={dow}>
                      <span className="hd">{DAY_SHORT[dow]}</span>
                      {heat.grid[dow].map((c, hi) => (
                        <span
                          key={hi}
                          className="hc"
                          style={{ background: c.count ? `color-mix(in srgb, var(--accent) ${Math.round(18 + (c.count / maxHeat) * 78)}%, var(--panel-3))` : 'var(--panel-3)' }}
                          title={`${DAY_SHORT[dow]} ${heat.hourStart + hi}:00 — ${c.count} session(s), ${c.minutes}m`}
                        >
                          {c.count || ''}
                        </span>
                      ))}
                    </React.Fragment>
                  ))}
                </div>
              )}
              {cfg.chart === 'donut' && (
                <Donut
                  parts={pivotRows(state, days, cfg.dim)
                    .slice(0, 9)
                    .map((r, i) => ({ label: r.label, value: r[cfg.metric === 'revenue' ? 'revenue' : cfg.metric === 'units' ? 'units' : 'sessions'] || 0, color: r.color || MIX_COLORS[i % MIX_COLORS.length], display: cfg.metric === 'revenue' ? `$${Math.round(r.revenue)}` : `${cfg.metric === 'units' ? Math.round(r.units) : r.sessions}` }))}
                  centerTop={`${cur.sessions}`}
                  centerSub="sessions"
                />
              )}
              {cfg.chart === 'table' && (
                <table className="an-table anv-bucktable">
                  <thead>
                    <tr>
                      <th>Bucket</th>
                      <th className="r">Sessions</th>
                      <th className="r">Hours</th>
                      <th className="r">Units</th>
                      <th className="r">Revenue</th>
                      <th className="r">Cancels</th>
                      <th className="r">No-shows</th>
                      <th className="r">Util %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {buckets.map((b) => {
                      const m = rangeMetrics(state, b.days)
                      return (
                        <tr key={b.key} className="anv-hit" onClick={() => actions.setUI({ anchor: b.start, section: 'calendar', view: 'week' })}>
                          <td>{b.label} <span className="muted">({b.start.slice(5)}→{b.end.slice(5)})</span></td>
                          <td className="r">{m.sessions}</td>
                          <td className="r">{m.hours}</td>
                          <td className="r">{m.units}</td>
                          <td className="r money">${Math.round(m.revenue).toLocaleString()}</td>
                          <td className="r">{m.cancelled}</td>
                          <td className="r">{m.noShow}</td>
                          <td className="r">{m.utilization}%</td>
                        </tr>
                      )
                    })}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td>Range total</td>
                      <td className="r">{cur.sessions}</td>
                      <td className="r">{cur.hours}</td>
                      <td className="r">{cur.units}</td>
                      <td className="r money">${Math.round(cur.revenue).toLocaleString()}</td>
                      <td className="r">{cur.cancelled}</td>
                      <td className="r">{cur.noShow}</td>
                      <td className="r">{cur.utilization}%</td>
                    </tr>
                  </tfoot>
                </table>
              )}
            </div>
            <div className="an-foot muted">Scroll sideways for more buckets · click a {cfg.chart === 'table' ? 'row' : cfg.chart === 'heat' ? 'cell' : 'point'} to jump the calendar there · {cfg.agg === 'avg' ? 'values are per-week averages' : cfg.agg === 'peak' ? 'values are busiest-day peaks' : 'values are bucket totals'}</div>
          </section>

          {cfg.chart !== 'heat' && cfg.chart !== 'donut' && (
            <section className="panel an-card">
              <h3>
                <span className="pi">{Icon.team({ size: 14 })}</span> Breakdown — {DIMS[cfg.dim].label}
                <span className="an-legend muted">bar = revenue</span>
              </h3>
              <div className="anv-scroll">
                <table className="an-table" data-testid="an-pivot">
                  <thead>
                    <tr>
                      {[['label', DIMS[cfg.dim].label, ''], ['sessions', 'Sess', 'r'], ['hours', 'Hrs', 'r'], ['units', 'Units', 'r'], ['revenue', 'Rev', 'r'], ['cancel', 'Canc', 'r']].map(([k, l, a]) => (
                        <th key={k} className={a} onClick={() => setSortKey(k)} style={{ cursor: 'pointer' }} title="Sort by this column">
                          {l} {sortKey === k ? '↓' : ''}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {[...pivot]
                      .sort((x, y) => (sortKey === 'label' ? String(x.label).localeCompare(String(y.label)) : y[sortKey === 'cancel' ? 'cancelled' : sortKey] - x[sortKey === 'cancel' ? 'cancelled' : sortKey]))
                      .map((r) => (
                        <tr key={r.key} data-testid={`an-row-${r.key}`} className={drill?.key === r.key ? 'sel' : ''} onClick={() => setDrill({ dim: cfg.dim, key: r.key, label: r.label })}>
                          <td>
                            {r.color && <span className="avatar avatar-sm" style={{ background: r.color, width: 18, height: 18, fontSize: 8 }}>{(r.label || '?').slice(0, 2).toUpperCase()}</span>}
                            <b>{r.label}</b>
                            {r.sub && <span className="muted" style={{ fontSize: 10.5, marginLeft: 6 }}>{r.sub}</span>}
                          </td>
                          <td className="r">{r.sessions}</td>
                          <td className="r">{r.hours}</td>
                          <td className="r">{r.units}</td>
                          <td className="r money">
                            <span className="pivbar">
                              <i style={{ width: `${Math.round((r.revenue / Math.max(1, ...pivotRows(state, days, cfg.dim).map((x) => x.revenue))) * 100)}%` }} />
                            </span>
                            ${Math.round(r.revenue).toLocaleString()}
                          </td>
                          <td className="r">{r.cancelled}</td>
                        </tr>
                      ))}
                    {!pivot.length && (
                      <tr>
                        <td colSpan={6}>
                          <span className="muted">Nothing scheduled in this window for {DIMS[cfg.dim].label.toLowerCase()} — slide the range.</span>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </div>

        <div className="anv-row2">
          <section className="panel an-card">
            <h3>
              <span className="pi">{Icon.dollar({ size: 14 })}</span> Appointment mix
            </h3>
            {(() => {
              const t = pivotRows(state, days, 'type')
              const tot = Math.max(1, t.reduce((x, r) => x + r.sessions, 0))
              return (
                <>
                  <div className="mixbar">
                    {Object.values(TYPES)
                      .filter((ty) => t.find((r) => r.key === ty.key))
                      .map((ty) => {
                        const r = t.find((x) => x.key === ty.key)
                        return <div key={ty.key} style={{ width: `${((r?.sessions || 0) / tot) * 100}%`, background: ty.color }} title={`${ty.label}: ${r?.sessions || 0}`} />
                      })}
                  </div>
                  <div className="mixlegend">
                    {Object.values(TYPES).map((ty) => {
                      const r = t.find((x) => x.key === ty.key)
                      return (
                        <span key={ty.key}>
                          <i style={{ background: ty.color }} /> {ty.label} <b>{r?.sessions || 0}</b>
                          <em>{Math.round(((r?.sessions || 0) / tot) * 100)}%</em>
                        </span>
                      )
                    })}
                  </div>
                </>
              )
            })()}
          </section>
          <section className="panel an-card">
            <h3>
              <span className="pi">{Icon.alert({ size: 14 })}</span> Attendance & recovery
            </h3>
            <div className="risk-row">
              <span className="risk-pill" style={{ '--rc': STATUSES.cancelled.dot }}>
                <b>{cur.cancelled}</b> cancelled
              </span>
              <span className="risk-pill" style={{ '--rc': STATUSES['no-show'].dot }}>
                <b>{cur.noShow}</b> no-shows
              </span>
              <span className="risk-pill" style={{ '--rc': 'var(--accent)' }}>
                <b>{cur.cancelRate}%</b> cancel rate
              </span>
              <span className="risk-pill" style={{ '--rc': 'var(--ok)' }}>
                <b>{cur.verifiedPct}%</b> verified
              </span>
            </div>
            <div className="an-foot muted" style={{ marginTop: 8 }}>
              {cur.needsCover > 0 ? (
                <button className="btn btn-sm" onClick={() => actions.setUI({ inbox: true })}>
                  {cur.needsCover} recoverable — fix now {Icon.chevronR({ size: 12 })}
                </button>
              ) : (
                'Nothing recoverable in range'
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
