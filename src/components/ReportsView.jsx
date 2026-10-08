import React, { useMemo, useRef, useState } from 'react'
import { useStore } from '../state/store'
import { RangePicker } from './NavRail'
import { Icon } from '../ui/Icons'
import { useToast } from '../ui/Toast'
import { REPORTS, REPORT_CATS, REPORT_BY_ID, runReport, toCSV, validationIssues } from '../lib/reports'
import { numCols, priorResults, numericTotals, deltaPct } from '../lib/rpTrends'
import { vizFor, VIZ_KIND, statusTone, STATUS_COLS, kpiNumber } from '../lib/reportViz'
import { ReportChart, Sparkline } from './reports/Charts'
import { ToneGlyph } from './BookingChecks'
import { fmtVal } from '../lib/exportKit'
import { VERIFY_CHECKS, unitsFor } from '../lib/model'
import { unitRuleFor } from '../lib/authUnits'
import { bucketize, resolveRange } from '../lib/analytics'
import { download } from '../lib/ics'
import { buildSpec, specToXls, specToPdf, downloadDoc, loadPdf } from '../lib/exportKit'
import { addDays, isoDate, parseISO, todayISO } from '../lib/date'

const fmtCell = (v, t) => {
  if (v == null || v === '') return <span className="muted">—</span>
  if (typeof v === 'number' && t === 'money') return `$${v.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
  if (typeof v === 'number' && t === 'pct') return `${v}%`
  if (typeof v === 'number' && t === 'hrs') return `${v}h`
  if (typeof v === 'number' && t === 'num') return v.toLocaleString()
  return String(v)
}

// a rise in these counts is bad news, so their delta reads red when it goes up
const BAD_RISING = /error|warn|no-show|denied|cancel|flag|overdue|gap|expir|lapse/i
// stat tiles shown before "more" — the rest of the summary is one click away
const KPI_FIRST = 4
const signed = (d) => `${d > 0 ? '+' : d < 0 ? '−' : ''}${Math.abs(d)}%`
const KIND_ICON = { bars: 'chartBars', columns: 'chartCols', stack: 'chartStack', heat: 'chartHeat' }
const KIND_WORD = { bars: 'Ranked bars', columns: 'Columns over time', stack: 'Share of total', heat: 'Weekday by hour heatmap' }
// a KPI tile's icon follows what the number is: an issue count, money, a rate, hours or a count
const kpiIcon = (label, value) => (BAD_RISING.test(label) ? 'caution' : /\$/.test(String(value)) || /revenue|charge|cost/i.test(label) ? 'dollar' : /%$/.test(String(value)) ? 'pie' : /h$/.test(String(value)) || /hour/i.test(label) ? 'clock' : 'pulse')

/**
 * Reports desk — every report is derived live from the workspace ledger.
 * Catalogue (grouped, searchable) on the left; the selected report gets a sticky
 * toolbar (window + scope), a short stat strip, an optional prior-window
 * comparison, result filters, a sortable table and inline fixes. Exports
 * (Excel / PDF / CSV) carry exactly the rows on screen.
 */
export default function ReportsView() {
  const state = useStore()
  const { ui, actions, settings } = state
  const toast = useToast()
  const sel = ui.repSel || 'quality'
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState(null) // {k, dir}
  const [saveOpen, setSaveOpen] = useState(false)
  const [saveName, setSaveName] = useState('')
  const [kpiAll, setKpiAll] = useState(false)
  const exportRef = useRef(null)
  const [fsev, setFsev] = useState('all') // quality-style severity filter
  const [fq, setFq] = useState('') // search within results
  const [fixOnly, setFixOnly] = useState(false)

  const preset = ui.repPreset || 'last4'
  const range = useMemo(() => resolveRange(preset, ui.anchor, settings.weekStart), [preset, ui.anchor, settings.weekStart])
  const gran = settings.analytics?.gran || 'auto'
  const scope = useMemo(() => {
    const s = {}
    if (ui.repDim === 'staff' && ui.repKey) s.staff = ui.repKey
    if (ui.repDim === 'client' && ui.repKey) s.client = ui.repKey
    if (ui.repDim === 'team' && ui.repKey) s.team = ui.repKey
    return s
  }, [ui.repDim, ui.repKey])

  const ctx = useMemo(() => ({ days: range.days, gran, buckets: bucketize(range.days, gran, settings.weekStart), scope }), [range, gran, settings.weekStart, scope])
  const result = useMemo(() => runReport(state, sel, ctx), [state.appts, state.clients, state.staff, state.teams, sel, ctx])
  const errors = useMemo(() => validationIssues(state).filter((i) => i.sev === 'error').length, [state.appts, state.clients, state.staff])
  const def = REPORT_BY_ID[sel]

  const nCols = useMemo(() => numCols(result.columns, result.rows), [result])
  const hasSev = result.columns.some((c) => c.k === 'sev')
  const fixOf = (r) => String(r.fix || r.action || '')
  const fixable = useMemo(() => result.rows.filter((r) => fixOf(r).startsWith('Auto') && r._link?.kind === 'appt').length, [result])
  const [view, setView] = useState('chart') // chart + table, or table only
  const history = useMemo(() => priorResults(state, sel, ctx, settings.weekStart, 5), [state, sel, ctx, settings.weekStart])
  const prior = history[history.length - 1] || null
  const curTot = useMemo(() => numericTotals(result.columns, result.rows), [result])
  const prevTot = useMemo(() => (prior ? numericTotals(prior.columns, prior.rows) : null), [prior])

  const filtered = useMemo(() => {
    let out = result.rows
    if (fsev !== 'all') out = out.filter((r) => r.sev === fsev)
    if (fixOnly) out = out.filter((r) => fixOf(r).startsWith('Auto') && r._link?.kind === 'appt')
    const q = fq.trim().toLowerCase()
    if (q) out = out.filter((r) => result.columns.some((c) => String(r[c.k] ?? '').toLowerCase().includes(q)))
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result.rows, fsev, fixOnly, fq])

  // the chart draws the rows the table shows (filters apply to both)
  const viz = useMemo(() => vizFor(sel, { ...result, rows: filtered }, { days: ctx.days, weekStart: settings.weekStart }), [sel, result, filtered, ctx.days, settings.weekStart])
  const colMax = useMemo(() => {
    const out = {}
    for (const c of result.columns) if (c.t === 'money') out[c.k] = Math.max(0, ...filtered.map((r) => (typeof r[c.k] === 'number' ? r[c.k] : 0)))
    return out
  }, [result.columns, filtered])

  const rows = useMemo(() => {
    if (!sort) return filtered
    const k = sort.k
    return [...filtered].sort((a, b) => {
      const av = a[k]
      const bv = b[k]
      const n = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av ?? '').localeCompare(String(bv ?? ''))
      return sort.dir === 'asc' ? n : -n
    })
  }, [filtered, sort])

  const totals = useMemo(() => {
    const out = {}
    for (const c of nCols) {
      const vals = rows.map((r) => r[c.k]).filter((v) => typeof v === 'number')
      if (vals.length) out[c.k] = Math.round((vals.reduce((t, v) => t + v, 0) * 100)) / 100
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, nCols])

  const anyFilter = fsev !== 'all' || fixOnly || fq.trim()
  const sevCounts = useMemo(() => {
    const o = { error: 0, warn: 0, notice: 0 }
    for (const r of result.rows) if (o[r.sev] != null) o[r.sev]++
    return o
  }, [result.rows])

  const pick = (id) => {
    actions.setUI({ repSel: id })
    setSort(null)
    setFsev('all')
    setFq('')
    setFixOnly(false)
    setKpiAll(false)
  }

  const drill = (r) => {
    const link = r._link
    if (!link) return
    if (link.kind === 'appt') {
      actions.setUI({ section: 'calendar', anchor: link.date || ui.anchor, openAppt: link.id })
      toast({ message: 'Opened the source appointment', kind: 'info' })
    } else if (link.kind === 'staff') {
      actions.setUI({ section: 'calendar', view: 'week', staffSel: [link.id], clientSel: [], teamSel: [], anchor: link.date || ui.anchor })
      toast({ message: 'Calendar filtered to this staff member', kind: 'info' })
    } else if (link.kind === 'client') {
      actions.setUI({ section: 'calendar', view: 'week', clientSel: [link.id], staffSel: [], teamSel: [] })
      toast({ message: 'Calendar filtered to this client', kind: 'info' })
    }
  }

  // ---- inline resolutions (undoable; the report re-runs off the store) ----
  const autoFill = (r) => {
    const a = state.appts[r._link?.id]
    if (!a) return
    // the payer's unit rule (payer override, payer service, service master, code) and its
    // rounding — the same numbers the booking dialog and the Billing desk write
    const { unitMins, rounding } = unitRuleFor(state, a)
    const units = unitsFor(a.end - a.start, unitMins, rounding)
    const prev = { billing: a.billing }
    actions.update(a.id, { billing: { ...(a.billing || {}), units } })
    toast({ message: `Auto-filled ${units} billable units — table re-ran`, kind: 'ok', action: { label: 'Undo', onClick: () => actions.update(a.id, prev) } })
  }
  const verify = (r) => {
    const a = state.appts[r._link?.id]
    if (!a) return
    const who = state.staff.find((s) => s.id === (a.verification?.completedBy || a.staffIds?.[0])) || state.staff[0]
    const prev = { verification: a.verification, status: a.status }
    const checks = {}
    for (const c of VERIFY_CHECKS) checks[c.id] = true
    actions.update(a.id, {
      status: 'completed',
      verification: {
        ...(a.verification || {}),
        completedBy: who?.id || null,
        checks,
        verifyStatus: 'verified',
        note: a.verification?.note || 'Verified from the reports desk',
        signature: { mode: 'type', text: who?.name || 'Admin', staffId: who?.id || null, staffName: who?.name || 'Admin', certification: who?.cert || null, timestamp: new Date().toISOString(), geo: null },
      },
    })
    toast({ message: 'Verified & signed — the row clears on the next run', kind: 'ok', action: { label: 'Undo', onClick: () => actions.update(a.id, prev) } })
  }

  const scopeLabel = scope.staff || scope.client || scope.team ? `scope ${Object.entries(scope).map(([k, v]) => `${k}=${v}`).join(' ')}` : ''
  const fileBase = `aloha-aba-${sel}-${todayISO()}`
  const spec = () => buildSpec({ org: settings.org, def, columns: result.columns, rows, totals, days: ctx.days, scopeLabel: `${scopeLabel || 'All records'}${anyFilter ? ' · filtered view' : ''}`, note: result.note || def.note })

  const exportCSV = () => {
    download(`${fileBase}.csv`, toCSV({ ...result, rows }, { org: settings.org, def, days: ctx.days, gran, scopeLabel }))
    toast({ message: `${rows.length} rows exported as CSV${anyFilter ? ' (current filters applied)' : ''}`, kind: 'ok' })
  }
  const exportXls = () => {
    downloadDoc(`${fileBase}.xls`, specToXls(spec()), 'application/vnd.ms-excel')
    toast({ message: `Excel workbook exported — ${rows.length} styled rows${Object.keys(totals).length ? ' + totals' : ''}`, kind: 'ok' })
  }
  const exportPdf = async () => {
    if (!(await loadPdf((m) => toast({ message: m, kind: 'warn' })))) return
    downloadDoc(`${fileBase}.pdf`, specToPdf(spec()).output('blob'), 'application/pdf')
    toast({ message: `PDF exported — ${rows.length} rows, letter landscape, totals included`, kind: 'ok' })
  }

  const doSave = () => {
    const name = saveName.trim() || def.name
    actions.saveReport({ name, reportId: sel, preset, note: range.label, dim: scope.staff ? 'staff' : scope.client ? 'client' : scope.team ? 'team' : null, key: scope.staff || scope.client || scope.team || null })
    setSaveOpen(false)
    setSaveName('')
    toast({ message: `Saved “${name}” — reuse it any time from this panel`, kind: 'ok' })
  }

  const hasRowActions = result.rows.some((r) => r._link?.kind === 'appt')
  const cols = hasRowActions ? [...result.columns, { k: '_act', label: '' }] : result.columns
  const clearFilters = () => { setFsev('all'); setFq(''); setFixOnly(false) }
  const q = search.trim().toLowerCase()
  const matches = REPORTS.filter((r) => !q || `${r.name} ${r.blurb}`.toLowerCase().includes(q))
  const saved = (state.reports.saved || []).filter((sv) => !q || `${sv.name} ${REPORT_BY_ID[sv.reportId]?.name || ''}`.toLowerCase().includes(q))
  const kpis = kpiAll ? result.summary : result.summary.slice(0, KPI_FIRST)
  const kpiMore = result.summary.length - KPI_FIRST
  const runExport = (fn) => () => { if (exportRef.current) exportRef.current.open = false; fn() }
  // desc first, then asc, then back to the report's own order
  const sortBy = (k) => setSort((s) => (s?.k !== k ? { k, dir: 'desc' } : s.dir === 'desc' ? { k, dir: 'asc' } : null))
  const ariaSort = (k) => (sort?.k !== k ? 'none' : sort.dir === 'asc' ? 'ascending' : 'descending')

  return (
    <div className="sectionpage rpv">
      <header className="rpv-head no-print">
        <div className="rpv-title">
          <h1>Reports</h1>
          <p>Built in this browser from the workspace ledger · {range.label}</p>
        </div>
        <div className="rpv-head-actions">
          {errors > 0 && (
            <button className="rpv-errlink" data-testid="rp-errors" onClick={() => pick('quality')} title="Open the data-quality report">
              {Icon.alert({ size: 13 })} {errors} validation {errors === 1 ? 'error' : 'errors'}
            </button>
          )}
          <button className="btn btn-sm" data-testid="rp-save" onClick={() => setSaveOpen(true)} title="Save this report and window as a preset">
            Save preset
          </button>
          <details className="rpv-menu" ref={exportRef}>
            <summary className="btn btn-sm btn-primary" data-testid="rp-export">
              {Icon.download({ size: 13 })} Export {Icon.chevDown({ size: 12 })}
            </summary>
            <div className="rpv-menu-list" role="menu" aria-label="Export current report">
              <button role="menuitem" data-testid="rp-xls" onClick={runExport(exportXls)}>{Icon.table({ size: 13 })}<span>Excel workbook<small>Number formats and a totals row</small></span></button>
              <button role="menuitem" data-testid="rp-pdf" onClick={runExport(exportPdf)}>{Icon.file({ size: 13 })}<span>PDF<small>Letter landscape, page numbers</small></span></button>
              <button role="menuitem" data-testid="rp-csv" onClick={runExport(exportCSV)}>{Icon.copy({ size: 13 })}<span>CSV<small>Raw rows with a metadata preamble</small></span></button>
              <button role="menuitem" onClick={runExport(() => window.print())}>{Icon.print({ size: 13 })}<span>Print this page</span></button>
            </div>
          </details>
        </div>
      </header>

      <div className="rpv-desk">
        <nav className="rpv-cat no-print" aria-label="Report catalogue">
          <div className="rpv-cat-search">
            <span aria-hidden="true">{Icon.search({ size: 13 })}</span>
            <input type="search" placeholder="Find a report" aria-label="Find a report" value={search} onChange={(e) => setSearch(e.target.value)} data-testid="rp-search" />
          </div>
          {saved.length > 0 && (
            <section className="rpv-group">
              <h3>Saved</h3>
              {saved.map((sv) => (
                <div key={sv.id} className="rpv-saved" data-testid={`rp-saved-${sv.id}`}>
                  <button className="rpv-item" onClick={() => { pick(sv.reportId); actions.setUI({ repPreset: sv.preset, repDim: sv.dim || null, repKey: sv.key || null, anchor: todayISO() }) }} title={`Run “${sv.name}”${sv.note ? ` (${sv.note})` : ''}`}>
                    <b>{sv.name}</b>
                    <span>{REPORT_BY_ID[sv.reportId]?.name}</span>
                  </button>
                  <button className="iconbtn" onClick={() => actions.deleteReport(sv.id)} aria-label={`Delete saved report ${sv.name}`}>{Icon.trash({ size: 12 })}</button>
                </div>
              ))}
            </section>
          )}
          {REPORT_CATS.map((c) => {
            const items = matches.filter((r) => r.cat === c.id)
            if (!items.length) return null
            return (
              <section className="rpv-group" key={c.id} data-testid={`rp-cat-${c.id}`}>
                <h3><span aria-hidden="true">{Icon[c.icon]({ size: 13 })}</span>{c.label}</h3>
                {items.map((r) => (
                  <button key={r.id} className={`rpv-item rpv-item-ic ${sel === r.id ? 'on' : ''}`} aria-current={sel === r.id ? 'true' : undefined} data-testid={`rp-def-${r.id}`} onClick={() => pick(r.id)} title={r.blurb}>
                    <span className={`rpv-ic cat-${r.cat}`} aria-hidden="true">{Icon[r.icon]({ size: 15 })}</span>
                    <span className="rpv-item-t">
                      <b>{r.name}</b>
                      <span>{r.blurb}</span>
                    </span>
                    {VIZ_KIND[r.id] && <span className="rpv-kind" title={KIND_WORD[VIZ_KIND[r.id]]}>{Icon[KIND_ICON[VIZ_KIND[r.id]]]({ size: 13 })}</span>}
                  </button>
                ))}
              </section>
            )
          })}
          {!matches.length && !saved.length && (
            <div className="rpv-cat-empty" data-testid="rp-cat-empty">
              <span>No report matches “{search.trim()}”.</span>
              <button className="rpv-link" onClick={() => setSearch('')}>Show all reports</button>
            </div>
          )}
        </nav>

        <div className="rpv-main">
          <div className="rpv-report-h">
            <span className={`rpv-ic rpv-ic-lg cat-${def.cat}`} aria-hidden="true">{Icon[def.icon]({ size: 20 })}</span>
            <div>
              <h2>{def.name}</h2>
              <p>{def.blurb}</p>
            </div>
          </div>

          <div className="rpv-toolbar no-print" data-testid="rp-toolbar">
            <RangePicker
              preset={preset}
              onPreset={(p) => actions.setUI({ repPreset: p })}
              onSlide={(dir) => actions.setUI({ anchor: isoDate(addDays(parseISO(ui.anchor), dir * range.days.length)) })}
              label={range.label}
            />
            <div className="rpv-scope" role="group" aria-label="Scope">
              {[
                ['staff', 'All staff', state.staff],
                ['client', 'All clients', state.clients],
                ['team', 'All teams', state.teams],
              ].map(([k, all, pool]) => (
                <select key={k} className={`input ${scope[k] ? 'on' : ''}`} aria-label={`Scope by ${k}`} data-testid={`rp-scope-${k}`} value={scope[k] || ''} onChange={(e) => actions.setUI({ repDim: e.target.value ? k : null, repKey: e.target.value || null })}>
                  <option value="">{all}</option>
                  {pool.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              ))}
              {(scope.staff || scope.client || scope.team) && (
                <button className="rpv-link" data-testid="rp-clearscope" onClick={() => actions.setUI({ repDim: null, repKey: null })}>
                  Scoped from Analytics · clear
                </button>
              )}
            </div>
          </div>

          {result.summary.length > 0 && (
            <div className="rpv-kpis" data-testid="rp-summary">
              {kpis.map((s) => {
                const ps = prior?.summary?.find((p) => p.label === s.label)
                const d = typeof s.value === 'number' && typeof ps?.value === 'number' ? deltaPct(s.value, ps.value) : null
                const cls = d == null || d === 0 ? 'flat' : (d > 0) !== BAD_RISING.test(s.label) ? 'good' : 'bad'
                const cur = kpiNumber(s.value)
                const trend = cur == null ? [] : [...history.map((h) => kpiNumber(h?.summary?.find((p) => p.label === s.label)?.value)), cur]
                return (
                  <div className="rp-kpi" key={s.label} data-testid={`rp-kpi-${s.label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}>
                    <span className="rp-kpi-label"><span className="rp-kpi-ic" aria-hidden="true">{Icon[kpiIcon(s.label, s.value)]({ size: 13 })}</span>{s.label}</span>
                    <span className="rp-kpi-row">
                      <b>{typeof s.value === 'number' ? s.value.toLocaleString() : s.value}</b>
                      <Sparkline values={trend} label={`${s.label} over the last ${trend.length} windows of ${ctx.days.length} days: ${trend.join(', ')}`} />
                    </span>
                    {d != null && (
                      <span className={`rp-kpi-delta ${cls}`} title={`Compared with the previous ${ctx.days.length} days`}>
                        {d !== 0 && Icon[d > 0 ? 'arrowUp' : 'arrowDown']({ size: 11, strokeWidth: 2.4 })}
                        {d === 0 ? 'No change' : signed(d)} <i>vs prior</i>
                      </span>
                    )}
                  </div>
                )
              })}
              {kpiMore > 0 && (
                <button className="rpv-link rpv-kpi-more" data-testid="rp-kpi-more" aria-expanded={kpiAll} onClick={() => setKpiAll((v) => !v)}>
                  {kpiAll ? 'Fewer' : `${kpiMore} more`}
                </button>
              )}
            </div>
          )}

          <details className="rpv-compare no-print" data-testid="rp-deltas">
            <summary>{Icon.chevronR({ size: 12 })} Totals vs previous {ctx.days.length}-day window</summary>
            <dl>
              <div data-testid="rp-delta-rows"><dt>Rows</dt><dd>{result.rows.length}</dd>{prior && <DeltaText d={deltaPct(result.rows.length, prior.rows.length)} />}</div>
              {nCols.map((c) => (
                <div key={c.k} data-testid={`rp-delta-${c.k}`}>
                  <dt>{c.label}</dt>
                  <dd>{curTot[c.k] != null ? fmtVal(curTot[c.k], c.t) : '—'}</dd>
                  {prior && <DeltaText d={curTot[c.k] != null && prevTot?.[c.k] != null ? deltaPct(curTot[c.k], prevTot[c.k]) : null} />}
                </div>
              ))}
            </dl>
          </details>

          <div className="rpv-filters no-print" role="search">
            <div className="rpv-fq">
              <span aria-hidden="true">{Icon.filter({ size: 12 })}</span>
              <input type="search" placeholder="Filter rows" value={fq} onChange={(e) => setFq(e.target.value)} data-testid="rp-f-q" aria-label="Filter rows in this report" />
            </div>
            {hasSev && (
              <div className="viewseg" role="group" aria-label="Severity">
                {[['all', 'All'], ['error', `Errors ${sevCounts.error}`], ['warn', `Warnings ${sevCounts.warn}`], ['notice', `Notices ${sevCounts.notice}`]].map(([s, label]) => (
                  <button key={s} className={fsev === s ? 'on' : ''} aria-pressed={fsev === s} data-testid={`rp-f-sev-${s}`} onClick={() => setFsev(s)}>{label}</button>
                ))}
              </div>
            )}
            {fixable > 0 && (
              <button className={`rpv-chip ${fixOnly ? 'on' : ''}`} aria-pressed={fixOnly} data-testid="rp-f-fixable" onClick={() => setFixOnly((v) => !v)}>
                {Icon.zap({ size: 12 })} {fixable} fixable in one click
              </button>
            )}
            {anyFilter && <button className="rpv-link" data-testid="rp-f-clear" onClick={clearFilters}>Clear filters</button>}
            {viz && (
              <div className="viewseg rpv-viewseg" role="group" aria-label="Show">
                <button className={view === 'chart' ? 'on' : ''} aria-pressed={view === 'chart'} data-testid="rp-view-chart" onClick={() => setView('chart')}>{Icon[KIND_ICON[viz.kind]]({ size: 12 })} Chart</button>
                <button className={view === 'table' ? 'on' : ''} aria-pressed={view === 'table'} data-testid="rp-view-table" onClick={() => setView('table')}>{Icon.table({ size: 12 })} Table only</button>
              </div>
            )}
            <span className="rpv-count" data-testid="rp-count">{anyFilter ? `${rows.length} of ${result.rows.length} rows` : `${rows.length} rows`}</span>
          </div>

          {viz && view === 'chart' && <ReportChart spec={viz} />}

          <div className="rpv-tablewrap">
            <table className="rpv-table" data-testid="rp-table">
              <thead>
                <tr>
                  {cols.map((c) => (
                    <th key={c.k} className={c.align === 'r' ? 'r' : undefined} aria-sort={c.k === '_act' ? undefined : ariaSort(c.k)} scope="col">
                      {c.k === '_act' ? <span className="rpv-sr">Actions</span> : (
                        <button className={`rpv-sort ${sort?.k === c.k ? `on ${sort.dir}` : ''}`} data-testid={`rp-sort-${c.k}`} onClick={() => sortBy(c.k)}>
                          {c.label}
                          <span className="rpv-sort-ic" aria-hidden="true">{Icon.chevDown({ size: 11 })}</span>
                        </button>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className={r._link ? 'is-link' : undefined} onClick={() => drill(r)} data-testid={`rp-row-${i}`}>
                    {cols.map((c) => (
                      <td key={c.k} className={`${c.align === 'r' ? 'r' : ''}${c.k === '_act' ? ' rpv-act' : ''}`}>
                        {c.k === '_act' ? (
                          r._link?.kind === 'appt' && (
                            <>
                              {fixOf(r).startsWith('Auto') && (
                                <button data-testid={`rp-fix-${i}`} onClick={(e) => { e.stopPropagation(); autoFill(r) }} title={fixOf(r)}>{Icon.zap({ size: 11 })} Fix</button>
                              )}
                              {/verify/i.test(fixOf(r)) && r.sev !== 'notice' && (
                                <button data-testid={`rp-vfy-${i}`} onClick={(e) => { e.stopPropagation(); verify(r) }} title="Mark verified and signed (undoable)">{Icon.check({ size: 11 })} Verify &amp; sign</button>
                              )}
                            </>
                          )
                        ) : c.k === 'sev' ? (
                          <span className={`sev-pill sev-${r.sev}`}>{r.sev}</span>
                        ) : STATUS_COLS.has(c.k) && statusTone(r[c.k]) ? (
                          <span className={`rpv-pill tone-${statusTone(r[c.k])}`}><ToneGlyph tone={statusTone(r[c.k])} size={11} />{r[c.k]}</span>
                        ) : c.t === 'pct' && typeof r[c.k] === 'number' ? (
                          <span className={`rpv-meter ${r[c.k] > 100 ? 'over' : ''}`}><span className="rpv-meter-t" aria-hidden="true"><i style={{ width: `${Math.min(100, Math.max(0, r[c.k]))}%` }} /></span>{fmtCell(r[c.k], c.t)}</span>
                        ) : c.t === 'money' && colMax[c.k] > 0 && typeof r[c.k] === 'number' && r[c.k] > 0 ? (
                          <span className="rpv-dbar" style={{ '--w': `${Math.round((r[c.k] / colMax[c.k]) * 100)}%` }}>{fmtCell(r[c.k], c.t)}</span>
                        ) : (
                          fmtCell(r[c.k], c.t)
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
                {!rows.length && (
                  <tr className="rpv-empty-row">
                    <td colSpan={cols.length}>
                      <div className="rpv-empty" data-testid="rp-empty">
                        <b>{anyFilter ? 'No rows match these filters' : 'Nothing to report for this window'}</b>
                        <span>{anyFilter ? 'Loosen the filters to see the full report.' : 'Try a longer range or clear the scope.'}</span>
                        {anyFilter && <button className="btn btn-sm" onClick={clearFilters}>Clear filters</button>}
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
              {rows.length > 0 && Object.keys(totals).length > 0 && (
                <tfoot>
                  <tr>
                    {cols.map((c, ci) => (
                      <td key={c.k} className={c.align === 'r' ? 'r' : undefined}>
                        {ci === 0 ? 'Total' : totals[c.k] != null ? fmtCell(Math.round(totals[c.k] * 100) / 100, c.t) : ''}
                      </td>
                    ))}
                  </tr>
                </tfoot>
              )}
            </table>
          </div>

          <footer className="rpv-foot">
            {(result.note || def.note) && <p className="rp-note">{result.note || def.note}</p>}
            <p className="rpv-meta">Computed locally in {result.ms}ms{prior ? ` · comparisons use the previous ${ctx.days.length} days` : ''}</p>
          </footer>

          {saveOpen && (
            <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && setSaveOpen(false)}>
              <div className="modal" style={{ width: 380 }} role="dialog" aria-label="Save report">
                <div className="modal-head">
                  <b>Save report preset</b>
                  <button className="iconbtn" onClick={() => setSaveOpen(false)} aria-label="Close">{Icon.x({ size: 14 })}</button>
                </div>
                <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <label className="bil-fld">
                    <span>Name</span>
                    <input className="input" autoFocus value={saveName} onChange={(e) => setSaveName(e.target.value)} placeholder={`${def.name} · ${range.label}`} onKeyDown={(e) => e.key === 'Enter' && doSave()} data-testid="rp-save-name" />
                  </label>
                  <div className="muted" style={{ fontSize: 11.3 }}>Stores the report, window preset and drill scope. Roster or schedule changes flow through on every run.</div>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                    <button className="btn btn-sm" onClick={() => setSaveOpen(false)}>Cancel</button>
                    <button className="btn btn-sm btn-primary" onClick={doSave} data-testid="rp-save-go">Save</button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function DeltaText({ d }) {
  if (d == null) return <span className="rpv-delta flat">—</span>
  return <span className={`rpv-delta ${d > 0 ? 'up' : d < 0 ? 'down' : 'flat'}`} title="Change vs the previous window">{d === 0 ? 'no change' : signed(d)}</span>
}
