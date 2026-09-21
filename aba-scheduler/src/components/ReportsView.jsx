import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../state/store'
import { RangePicker } from './NavRail'
import { Icon } from '../ui/Icons'
import { useToast } from '../ui/Toast'
import { REPORTS, REPORT_CATS, REPORT_BY_ID, runReport, toCSV, validationIssues } from '../lib/reports'
import { numCols, priorResult, numericTotals, deltaPct } from '../lib/rpTrends'
import { fmtVal } from '../lib/exportKit'
import { VERIFY_CHECKS } from '../lib/model'
import { bucketize, resolveRange } from '../lib/analytics'
import { download } from '../lib/ics'
import { buildSpec, specToXls, specToPdf, downloadDoc } from '../lib/exportKit'
import { addDays, isoDate, parseISO, todayISO } from '../lib/date'

const fmtCell = (v, t) => {
  if (v == null || v === '') return <span className="muted">—</span>
  if (typeof v === 'number' && t === 'money') return `$${v.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
  if (typeof v === 'number' && t === 'pct') return `${v}%`
  if (typeof v === 'number' && t === 'hrs') return `${v}h`
  if (typeof v === 'number' && t === 'num') return v.toLocaleString()
  return String(v)
}

const CAT_ICON = { operations: 'cal', clinical: 'clipboard', billing: 'dollar', people: 'team', quality: 'checkCircle' }
const KPI_ICON = [
  [/error|block|denied|fail/i, 'alert'], [/warn|expir|flag|overdue|due/i, 'info'], [/notice|pending/i, 'eye'],
  [/fix|auto/i, 'zap'], [/revenue|charge|dollar|\$|paid|billed/i, 'dollar'], [/rate|%|attend|complet|clean/i, 'checkCircle'],
  [/no-show|cancel|miss/i, 'ban'], [/session|row|visit|line|occurrence/i, 'cal'], [/hour|util|pace|target|mins|h\b/i, 'clock'],
  [/auth|verif|sign|doc/i, 'clipboard'], [/staff|people|team|caseload/i, 'team'],
]
const kpiIcon = (label) => (KPI_ICON.find(([re]) => re.test(label)) || [, 'spark'])[1]
const BAD_RISING = /error|warn|no-show|denied|cancel|flag|overdue|gap|expir|lapse/i
/** Counts roll to their new value instead of snapping — small but it makes switching reports feel alive */
function CountNum({ v }) {
  const num = typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null
  const [shown, setShown] = useState(num ?? v)
  const from = useRef(num)
  useEffect(() => {
    if (num == null || from.current === num) { if (num != null) from.current = num; setShown(v); return }
    const a = from.current ?? 0
    const t0 = performance.now()
    let raf
    const tick = (t) => {
      const pr = Math.min(1, (t - t0) / 380)
      setShown(Math.round(a + (num - a) * (1 - Math.pow(1 - pr, 3))))
      if (pr < 1) raf = requestAnimationFrame(tick)
      else from.current = num
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [num])
  return <>{shown}</>
}

/**
 * Reports desk — every report is derived live from the PMS ledger.
 * Trends panel (bucketed chart + prior-window deltas), severity / fixable /
 * within-results filters, inline resolve actions on issue rows, and exports
 * (Excel / PDF / CSV) that carry exactly the rows currently on screen.
 */
export default function ReportsView() {
  const state = useStore()
  const { ui, actions, settings } = state
  const toast = useToast()
  const sel = ui.repSel || 'quality'
  const [search, setSearch] = useState('')
  const [cat, setCat] = useState(null)
  const [sort, setSort] = useState(null) // {k, dir}
  const [saveOpen, setSaveOpen] = useState(false)
  const [saveName, setSaveName] = useState('')
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
  const prior = useMemo(() => priorResult(state, sel, ctx, settings.weekStart), [state, sel, ctx, settings.weekStart])
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
    const unitMins = a.billing?.unitMins || 30
    const units = Math.round(((a.end - a.start) / unitMins) * 100) / 100
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
  const exportPdf = () => {
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
  return (
    <div className="sectionpage">
      <header className="rp-hero no-print">
        <span className="rph-ic">{Icon.spark({ size: 20 })}</span>
        <div className="rph-t">
          <h1>Reports</h1>
          <p>
            Live from the ledger · {rows.length} rows in view{anyFilter ? ` of ${result.rows.length}` : ''} · {range.label} · {prior ? 'deltas compare to the previous ' + ctx.days.length + ' days' : 'exports carry the same totals'}
          </p>
        </div>
        {errors > 0 && (
          <button className="rph-err" data-testid="rp-errors" onClick={() => pick('quality')} title="Open the data-quality report">
            {Icon.alert({ size: 13 })} {errors} validation {errors === 1 ? 'error' : 'errors'}
          </button>
        )}
        <div className="rph-actions">
          <div className="rp-exports" role="group" aria-label="Export current report">
            <button className="exp-btn xl" data-testid="rp-xls" onClick={exportXls} title="Excel workbook — brand header, zebra rows, number formats, totals footer">{Icon.table({ size: 13 })} Excel</button>
            <button className="exp-btn pdf" data-testid="rp-pdf" onClick={exportPdf} title="Formatted PDF — letter landscape, repeating header, page numbers">{Icon.file({ size: 13 })} PDF</button>
            <button className="exp-btn csv" data-testid="rp-csv" onClick={exportCSV} title="Raw CSV with metadata preamble">{Icon.copy({ size: 13 })} CSV</button>
            <button className="exp-btn prn" onClick={() => window.print()} title="Print this page" aria-label="Print">{Icon.print({ size: 13 })}</button>
          </div>
          <button className="btn btn-sm" data-testid="rp-save" onClick={() => setSaveOpen(true)} title="Save this report + window as a preset">
            {Icon.check({ size: 12 })} Save preset
          </button>
        </div>
      </header>

      <div className="rp-desk">
        <aside className="rp-catalog no-print">
          <div className="rp-cat-search">
            <div className="sb-search">
              <span className="sic">{Icon.search({ size: 13 })}</span>
              <input placeholder="Search report templates…" value={search} onChange={(e) => setSearch(e.target.value)} data-testid="rp-search" />
            </div>
          </div>
          <div className="rp-cats" role="group" aria-label="Categories">
            {REPORT_CATS.map((c) => (
              <button key={c.id} className={`rp-cat-pill ${cat === c.id ? 'on' : ''}`} data-testid={`rp-cat-${c.id}`} onClick={() => setCat(cat === c.id ? null : c.id)}>
                <span className="rc-ic">{Icon[CAT_ICON[c.id]]({ size: 12 })}</span>
                <b>{c.label.split(' ')[0]}</b> <i>{c.label.split(' ').slice(1).join(' ')}</i>
                <span>{REPORTS.filter((r) => (!search || (r.name + ' ' + r.blurb).toLowerCase().includes(search.toLowerCase())) && r.cat === c.id).length}</span>
              </button>
            ))}
          </div>
          <div className="rp-cat-list">
            {REPORT_CATS.filter((c) => !cat || c.id === cat).map((catDef) => {
              const items = REPORTS.filter((r) => (!search || (r.name + ' ' + r.blurb).toLowerCase().includes(search.toLowerCase())) && (!cat || r.cat === cat)).filter((r) => r.cat === catDef.id)
              if (!items.length) return null
              return (
                <div key={catDef.id}>
                  <div className="rp-cat-h">{catDef.label}</div>
                  {items.map((r) => (
                    <button key={r.id} className={`rp-def ${sel === r.id ? 'on' : ''}`} data-testid={`rp-def-${r.id}`} onClick={() => pick(r.id)}>
                      <span className="pi">{Icon[r.icon]?.({ size: 13 }) || Icon.file({ size: 13 })}</span>
                      <span>
                        <b>{r.name}</b>
                        <span>{r.blurb}</span>
                      </span>
                    </button>
                  ))}
                </div>
              )
            })}
            {(state.reports.saved || []).length > 0 && (
              <div className="rp-saved">
                <div className="rp-cat-h">Saved reports</div>
                {state.reports.saved.map((sv) => (
                  <div key={sv.id} className="rp-saved-item" data-testid={`rp-saved-${sv.id}`}>
                    <button style={{ all: 'unset', cursor: 'pointer', flex: 1, fontWeight: 700 }} onClick={() => { pick(sv.reportId); actions.setUI({ repPreset: sv.preset, repDim: sv.dim || null, repKey: sv.key || null, anchor: todayISO() }) }} title={`Run “${sv.name}” — ${sv.note || ''}`}>
                      {Icon.checkCircle({ size: 12 })} {sv.name}
                    </button>
                    <em>{REPORT_BY_ID[sv.reportId]?.name.slice(0, 14)}</em>
                    <button onClick={() => actions.deleteReport(sv.id)} aria-label="Delete saved report">{Icon.trash({ size: 12 })}</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </aside>

        <div className="rp-main">
          <div className="sec-toolbar" style={{ borderRadius: 0, border: 0, borderBottom: '1px solid var(--line)', boxShadow: 'none', background: 'var(--panel)' }}>
            <div className="fld" style={{ maxWidth: 340 }}>
              <span>{def.name}</span>
              <span style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.35 }}>{def.blurb}</span>
            </div>
            <RangePicker
              preset={preset}
              onPreset={(p) => actions.setUI({ repPreset: p })}
              onSlide={(dir) => actions.setUI({ anchor: isoDate(addDays(parseISO(ui.anchor), dir * range.days.length)) })}
              label={range.label}
            />
            {(scope.staff || scope.client || scope.team) && (
              <button className="btn btn-sm" data-testid="rp-clearscope" onClick={() => actions.setUI({ repDim: null, repKey: null })}>
                Scoped from Analytics {Icon.x({ size: 11 })}
              </button>
            )}
            {[
              ['staff', 'Staff', state.staff],
              ['client', 'Client', state.clients],
              ['team', 'Team', state.teams],
            ].map(([k, label, pool]) => (
              <label className="fld" key={k}>
                <span>{label}</span>
                <select
                  className="input"
                  data-testid={`rp-scope-${k}`}
                  value={scope[k] || ''}
                  onChange={(e) => actions.setUI({ repDim: e.target.value ? k : null, repKey: e.target.value || null })}
                >
                  <option value="">All</option>
                  {pool.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </label>
            ))}
            <div className="f1" />
            <button className="btn btn-sm" onClick={() => { toast({ message: 'Re-run against the live ledger', kind: 'info' }) }} title="Recompute from current data">
              {Icon.repeat({ size: 12 })} Run
            </button>
          </div>

          <div style={{ padding: '11px 14px 18px', display: 'flex', flexDirection: 'column', gap: 10, overflow: 'auto', flex: 1 }}>
            <div className="rp-summary" data-testid="rp-summary" key={sel}>
              {result.summary.map((s, si) => {
                const ps = prior?.summary?.find((p) => p.label === s.label)
                const d = typeof s.value === 'number' && typeof ps?.value === 'number' ? deltaPct(s.value, ps.value) : null
                const cls = d == null || d === 0 ? 'flat' : (d > 0) !== BAD_RISING.test(s.label) ? 'good' : 'bad'
                const KIcon = Icon[kpiIcon(s.label)] || Icon.spark
                return (
                  <div className={`rp-kpi ${d != null && cls !== 'flat' ? `is-${cls}` : ''}`} style={{ '--i': si }} key={s.label} data-testid={`rp-kpi-${s.label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`} title={d != null ? `${s.label}: ${d > 0 ? '+' : ''}${d}% vs the previous ${ctx.days.length}-day window` : s.label}>
                    <div className="rp-kpi-top">
                      <span className="rp-kpi-ic">{KIcon({ size: 14 })}</span>
                      {d != null && <i className={`rp-kpi-delta ${cls}`}>{d > 0 ? '▲' : d < 0 ? '▼' : '•'} {Math.abs(d)}%</i>}
                    </div>
                    <b><CountNum v={s.value} /></b>
                    <div className="rp-kpi-foot">
                      <span>{s.label}</span>
                    </div>
                  </div>
                )
              })}
              {fixable > 0 && (
                <button className={`rp-kpi act ${fixOnly ? 'on' : ''}`} style={{ '--i': result.summary.length }} data-testid="rp-fixable-jump" onClick={() => setFixOnly((v) => !v)} title="Show only the rows one click can fix">
                  <div className="rp-kpi-top"><span className="rp-kpi-ic zap">{Icon.zap({ size: 14 })}</span></div>
                  <b>{fixOnly ? 'showing all' : fixable}</b>
                  <div className="rp-kpi-foot"><span>{fixOnly ? 'clear auto-fix filter' : 'auto-fixable now'}</span></div>
                </button>
              )}
              <span className="rp-runmeta" style={{ marginLeft: 'auto' }}>
                <span className="ok">●</span> ran in {result.ms}ms
              </span>
            </div>

            <div className="rp-deltaslim no-print" data-testid="rp-deltas">
              <span className="rpd-label">{Icon.repeat({ size: 11 })} vs previous {ctx.days.length}-day window</span>
              <span className="rpd-chip" data-testid="rp-delta-rows"><em>Rows</em><b>{result.rows.length}</b>{prior && <DeltaChip d={deltaPct(result.rows.length, prior.rows.length)} />}</span>
              {nCols.map((c) => (
                <span className="rpd-chip" key={c.k} data-testid={`rp-delta-${c.k}`}>
                  <em>{c.label}</em>
                  <b>{curTot[c.k] != null ? fmtVal(curTot[c.k], c.t) : '—'}</b>
                  {prior && <DeltaChip d={curTot[c.k] != null && prevTot?.[c.k] != null ? deltaPct(curTot[c.k], prevTot[c.k]) : null} />}
                </span>
              ))}
            </div>

            <div className="rp-filters no-print" role="search">
              <span className="rp-fi">{Icon.filter({ size: 12 })}</span>
              <input className="rp-fq" placeholder="Search within results…" value={fq} onChange={(e) => setFq(e.target.value)} data-testid="rp-f-q" aria-label="Search within results" />
              {hasSev && (
                <div className="rp-sevset" role="group" aria-label="Severity">
                  {['all', 'error', 'warn', 'notice'].map((s) => (
                    <button key={s} className={`rp-fpill ${s !== 'all' ? `sev-${s}` : ''} ${fsev === s ? 'on' : ''}`} data-testid={s === 'all' ? 'rp-f-sev-all' : `rp-f-sev-${s}`} onClick={() => setFsev(s)}>
                      {s === 'all' ? 'All' : s === 'error' ? `Errors ${sevCounts.error}` : s === 'warn' ? `Warnings ${sevCounts.warn}` : `Notices ${sevCounts.notice}`}
                    </button>
                  ))}
                </div>
              )}
              {fixable > 0 && (
                <button className={`rp-fpill fix ${fixOnly ? 'on' : ''}`} data-testid="rp-f-fixable" onClick={() => setFixOnly((v) => !v)}>
                  ⚡ {fixable} auto-fixable
                </button>
              )}
              {anyFilter && (
                <button className="rp-fclear" data-testid="rp-f-clear" onClick={() => { setFsev('all'); setFq(''); setFixOnly(false) }}>
                  Clear filters
                </button>
              )}
              {anyFilter && <span className="rp-fcount">{rows.length} / {result.rows.length} rows</span>}
            </div>

            <div className="rp-tablewrap">
              <table className="rp-table" data-testid="rp-table">
                <thead>
                  <tr>
                    {cols.map((c) => (
                      <th
                        key={c.k}
                        className={`${c.align === 'r' ? 'r' : ''} ${sort?.k === c.k ? 'sorted' : ''}`}
                        onClick={c.k === '_act' ? undefined : () => setSort((s) => (s?.k === c.k ? (s.dir === 'asc' ? { k: c.k, dir: 'desc' } : null) : { k: c.k, dir: 'desc' }))}
                        title={c.k === '_act' ? undefined : 'Sort'}
                      >
                        {c.label} {sort?.k === c.k ? (sort.dir === 'asc' ? '↑' : '↓') : ''}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i} className={r._link ? 'anv-hit' : undefined} onClick={() => drill(r)} data-testid={`rp-row-${i}`}>
                      {cols.map((c) => (
                        <td key={c.k} className={`${c.align === 'r' ? 'r' : ''}${c.k === '_act' ? ' rp-actcell' : ''}`}>
                          {c.k === '_act' ? (
                            r._link?.kind === 'appt' && (
                              <>
                                {fixOf(r).startsWith('Auto') && (
                                  <button data-testid={`rp-fix-${i}`} onClick={(e) => { e.stopPropagation(); autoFill(r) }} title={fixOf(r)}>⚡ Fix</button>
                                )}
                                {/verify/i.test(fixOf(r)) && r.sev !== 'notice' && (
                                  <button data-testid={`rp-vfy-${i}`} onClick={(e) => { e.stopPropagation(); verify(r) }} title="Mark verified & signed (undoable)">✓ Verify & sign</button>
                                )}
                              </>
                            )
                          ) : c.k === 'sev' ? (
                            <span className={`sev-pill sev-${r.sev}`}>{r.sev}</span>
                          ) : (
                            fmtCell(r[c.k], c.t)
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                  {!rows.length && (
                    <tr>
                      <td colSpan={cols.length} style={{ textAlign: 'center', padding: 28 }}>
                        <span className="muted">{anyFilter ? 'No rows match the filters — ' : 'No rows for this window — try a longer range or clear the scope. '}</span>
                        {anyFilter && (
                          <button className="rp-fclear" onClick={() => { setFsev('all'); setFq(''); setFixOnly(false) }}>
                            clear filters
                          </button>
                        )}
                      </td>
                    </tr>
                  )}
                </tbody>
                {Object.keys(totals).length > 0 && (
                  <tfoot>
                    <tr>
                      {cols.map((c, ci) => (
                        <td key={c.k} className={c.align === 'r' ? 'r' : ''}>
                          {ci === 0 ? 'Total' : totals[c.k] != null ? fmtCell(Math.round(totals[c.k] * 100) / 100, c.t) : ''}
                        </td>
                      ))}
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
            {(result.note || def.note) && <div className="rp-note">{Icon.info({ size: 12 })} {result.note || def.note}</div>}
          </div>

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

function DeltaChip({ d }) {
  if (d == null) return <span className="rt-delta flat">—</span>
  const dir = d > 0 ? 'up' : d < 0 ? 'down' : 'flat'
  return (
    <span className={`rt-delta ${dir}`} title="Change vs the previous window">
      {d > 0 ? '▲' : d < 0 ? '▼' : '='} {Math.abs(d)}%
    </span>
  )
}
