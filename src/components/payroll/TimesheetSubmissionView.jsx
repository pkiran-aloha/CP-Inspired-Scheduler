import React, { useEffect, useMemo, useState } from 'react'
import { useStore } from '../../state/store'
import { SectionBar } from '../NavRail'
import { Icon } from '../../ui/Icons'
import { useToast } from '../../ui/Toast'
import { PaySubNav, actorName, money, hrs, PayKpis, PeriodPicker, StaffCell, StatusPill, Pager } from './PayrollCommon'
import { earningIndex, earningCodesFor, sheetFor, timesheet, periodsFor, periodFor, earningsFor } from '../../lib/payroll'
import { timesheetHtml } from '../../lib/payrollExport'
import { download } from '../../lib/ics'
import { todayISO } from '../../lib/date'

const SHEET_TABS = [
  ['all', 'All'],
  ['open', 'Open'],
  ['submitted', 'Submitted'],
  ['approved', 'Approved'],
  ['rejected', 'Returned'],
  ['processed', 'Processed'],
]

/**
 * Timesheet Submission — the approval desk.
 *
 * Rows are *derived* from the calendar for the chosen period; the stored sheet is
 * the human decision on top of it (submitted / approved / returned) plus any
 * supervisor adjustments. Bulk actions exist because a practice approves 40
 * timesheets at once, not one at a time.
 */
export default function TimesheetSubmissionView() {
  const state = useStore()
  const { actions, settings, staff, payProfiles, paySheets } = state
  const toast = useToast()
  const payroll = settings.payroll
  const [periodId, setPeriodId] = useState(() => periodFor(payroll, todayISO(), { back: 12, forward: 12 })?.id)
  const [tab, setTab] = useState('all')
  const [q, setQ] = useState('')
  const [officeF, setOfficeF] = useState('all')
  const [sel, setSel] = useState([])
  const [page, setPage] = useState(1)
  const [detail, setDetail] = useState(null)
  const [who, setWho] = useState(() => actorName(state))
  const [adj, setAdj] = useState({ code: 'ADMIN', date: '', hours: 1, note: '' })

  // Deep link from the Review Register modal ("Fix this issue"): pre-filter the
  // desk to the affected employee and open their timesheet so the sheet can be
  // approved, adjusted or its visits verified on the spot.
  const focus = state.ui?.payrollFocus
  useEffect(() => {
    if (!focus) return
    if (focus.name) setQ(focus.name)
    setPage(1)
    setTab('all')
    if (focus.open === 'timesheet' && focus.staffId) setDetail({ staffId: focus.staffId })
    actions.setUI({ payrollFocus: null })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus])

  const period = useMemo(() => periodsFor(payroll, payroll.anchor, { back: 24, forward: 12 }).find((p) => p.id === periodId) || periodFor(payroll, todayISO(), {}), [payroll, periodId])
  const profiles = useMemo(() => (payProfiles || []).filter((p) => p.include), [payProfiles])
  const offices = useMemo(() => [...new Set((payProfiles || []).map((p) => p.office).filter(Boolean))], [payProfiles])

  const rows = useMemo(() => {
    return profiles.map((p) => {
      const s = (staff || []).find((x) => x.id === p.staffId)
      const sheet = sheetFor(state, p.staffId, period.id)
      const t = timesheet(state, p.staffId, period.id)
      const evvIssues = t.lines.filter((l) => l.meta?.billable && l.date <= todayISO() && !/^verified/.test(l.meta?.evv || '')).length
      const e = earningsFor(state, p.staffId, period.id)
      const futureLines = t.lines.filter((l) => l.date > todayISO()).length
      return {
        staffId: p.staffId, name: s?.name || p.staffId, role: s?.role || '', office: p.office || '—', payrollId: p.payrollId,
        sheet, totals: t.totals, lines: t.lines, evvIssues, futureLines,
        otHours: e.otHours, grossCents: e.grossCents,
        submittedAt: sheet.submittedAt, approvedAt: sheet.approvedAt,
      }
    }).sort((a, b) => a.name.localeCompare(b.name))
  }, [state, profiles, staff, period])

  const filtered = useMemo(() => rows
    .filter((r) => tab === 'all' || r.sheet.status === tab)
    .filter((r) => officeF === 'all' || r.office === officeF)
    .filter((r) => !q.trim() || `${r.name} ${r.role} ${r.payrollId} ${r.office}`.toLowerCase().includes(q.trim().toLowerCase())),
  [rows, tab, officeF, q])

  const counts = useMemo(() => {
    const c = { open: 0, submitted: 0, approved: 0, rejected: 0, processed: 0 }
    for (const r of rows) c[r.sheet.status] = (c[r.sheet.status] || 0) + 1
    return c
  }, [rows])

  const totals = useMemo(() => filtered.reduce((acc, r) => ({
    hours: acc.hours + r.totals.hours + r.otHours,
    ot: acc.ot + r.otHours,
    amount: acc.amount + r.grossCents,
    evv: acc.evv + r.evvIssues,
  }), { hours: 0, ot: 0, amount: 0, evv: 0 }), [filtered])

  const pageRows = filtered.slice((page - 1) * 25, page * 25)
  const toggle = (id) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))
  const targetIds = sel.length ? sel : []

  const bulk = (op) => {
    const ids = targetIds.length ? targetIds : filtered.map((r) => r.staffId)
    let ok = 0
    const firstMsg = []
    for (const id of ids) {
      const res = actions.payrollSheet(id, period.id, op, { who })
      if (res.ok) ok += 1
      else if (firstMsg.length < 2) firstMsg.push(res.msg)
    }
    toast({
      message: ok
        ? `${op === 'submit' ? 'Submitted' : op === 'approve' ? 'Approved' : op === 'reject' ? 'Returned' : 'Reopened'} ${ok} timesheet${ok > 1 ? 's' : ''}${firstMsg.length ? ` · ${ids.length - ok} held: ${firstMsg[0]}` : ''}`
        : (firstMsg[0] || 'Nothing to update'),
      kind: ok ? 'ok' : 'warn',
    })
    setSel([])
  }

  const printSheets = () => {
    const ids = targetIds.length ? targetIds : filtered.map((r) => r.staffId)
    const html = ids.map((id) => timesheetHtml(state, id, period)).join('<div style="page-break-after:always"></div>')
    download(`timesheets-${period.start}.html`, html, 'text/html;charset=utf-8')
    toast({ message: `${ids.length} timesheet${ids.length > 1 ? 's' : ''} opened as a printable document`, kind: 'ok' })
  }

  const detailTs = detail ? timesheet(state, detail.staffId, period.id) : null

  return (
    <div className="sectionpage pay-hub" data-testid="pay-ts-sec" style={{ background: 'var(--bg)' }}>
      <SectionBar icon="clipboard" title="Timesheet Submission" sub={`${period.start} → ${period.end} · cutoff ${period.cutoff} · ${counts.submitted} waiting on approval`}>
        <div className="sb-search" style={{ minWidth: 220, borderRadius: 10 }}>
          <span className="sic">{Icon.search({ size: 12 })}</span>
          <input placeholder="Search staff, payroll ID, office" value={q} onChange={(e) => { setQ(e.target.value); setPage(1) }} data-testid="pay-ts-search" />
        </div>
        <select className="input" value={who} onChange={(e) => setWho(e.target.value)} data-testid="pay-ts-actor" style={{ width: 180 }} aria-label="Acting as">
          {(staff || []).map((s) => <option key={s.id} value={s.name}>{s.name}</option>)}
          <option value="Payroll admin">Payroll admin</option>
        </select>
        <button className="btn btn-sm" data-testid="pay-ts-print" onClick={printSheets}>{Icon.print({ size: 13 })} Print</button>
        <button className="btn btn-sm btn-primary" data-testid="pay-ts-submit" onClick={() => bulk('submit')}>Submit</button>
        <button className="btn btn-sm" data-testid="pay-ts-approve" onClick={() => bulk('approve')}>Approve</button>
        <button className="btn btn-sm" data-testid="pay-ts-revert" onClick={() => bulk('revert')}>Revert</button>
      </SectionBar>

      <PaySubNav />

      <div className="pay-filterbar">
        <span className="muted">Show</span>
        <div className="viewseg" data-testid="pay-ts-tabs">
          {SHEET_TABS.map(([id, label]) => (
            <button key={id} className={tab === id ? 'on' : ''} data-testid={`pay-ts-tab-${id}`} onClick={() => { setTab(id); setPage(1) }}>
              {label}{counts[id] ? ` (${counts[id]})` : ''}
            </button>
          ))}
        </div>
        {officeF !== 'all' && <span className="pay-chipsel">Office: {officeF} <button className="pay-link" onClick={() => setOfficeF('all')}>clear</button></span>}
        <select className="input" value={officeF} onChange={(e) => { setOfficeF(e.target.value); setPage(1) }} data-testid="pay-ts-office" style={{ width: 170, marginLeft: 'auto' }} aria-label="Filter by office">
          <option value="all">All offices</option>
          {offices.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
        {(tab !== 'all' || officeF !== 'all' || q) && (
          <button className="pay-link" data-testid="pay-ts-clear" onClick={() => { setTab('all'); setOfficeF('all'); setQ('') }}>Clear all filters</button>
        )}
      </div>

      <PayKpis testId="pay-ts-kpis" items={[
        ['Timesheets in view', filtered.length, `${rows.length} total on the roster`, 'pay-ts-kpi-count'],
        ['Hours', hrs(totals.hours), 'worked + OT', 'pay-ts-kpi-hours'],
        ['Gross value', money(totals.amount, { cents: false }), `${hrs(totals.ot)} overtime included`, 'pay-ts-kpi-value'],
        ['Awaiting approval', counts.submitted, 'submitted, not signed off', 'pay-ts-kpi-pending'],
        ['Visit (EVV) gaps', totals.evv, 'delivered visits lacking verification', 'pay-ts-kpi-evv', totals.evv ? 'var(--danger)' : undefined],
      ]} />

      <div style={{ padding: '0 16px 16px' }}>
        <div className="py-tbl" data-testid="pay-ts-table" style={{ overflowX: 'auto' }}>
          <div className="py-thead" style={{ gridTemplateColumns: '34px 2fr 1.1fr 1fr 110px 96px 96px 110px 40px' }}>
            <span><input type="checkbox" className="checkbox" aria-label="Select all" data-testid="pay-ts-selall"
              checked={pageRows.length > 0 && pageRows.every((r) => sel.includes(r.staffId))}
              onChange={(e) => setSel(e.target.checked ? [...new Set([...sel, ...pageRows.map((r) => r.staffId)])] : sel.filter((x) => !pageRows.some((r) => r.staffId === x)))} /></span>
            <span>Staff</span><span>Office</span><span>Payroll ID</span>
            <span className="num">Hours</span><span className="num">Value</span><span>EVV</span><span>Status</span><span />
          </div>
          {pageRows.map((r) => (
            <div key={r.staffId} className="py-trow" data-testid={`pay-ts-row-${r.staffId}`} style={{ gridTemplateColumns: '34px 2fr 1.1fr 1fr 110px 96px 96px 110px 40px', minHeight: 54 }}>
              <span><input type="checkbox" className="checkbox" aria-label={`Select ${r.name}`} data-testid={`pay-ts-sel-${r.staffId}`} checked={sel.includes(r.staffId)} onChange={() => toggle(r.staffId)} onClick={(e) => e.stopPropagation()} /></span>
              <StaffCell staffId={r.staffId} sub={r.role} />
              <span className="muted">{r.office}</span>
              <span className="ln-code">{r.payrollId || '—'}</span>
              <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{hrs(r.totals.hours)}</span>
              <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{money(r.totals.straightCents)}</span>
              <span className={r.evvIssues ? 'pay-flag bad' : 'pay-flag ok'} data-testid={`pay-ts-evv-${r.staffId}`}>
                {r.evvIssues ? `${r.evvIssues} gap${r.evvIssues > 1 ? 's' : ''}` : 'verified'}
              </span>
              <span><StatusPill status={r.sheet.status} label={r.sheet.status === 'processed' ? 'Processed' : undefined} /></span>
              <button className="iconbtn" title="Open timesheet" data-testid={`pay-ts-open-${r.staffId}`} onClick={() => setDetail({ staffId: r.staffId })}>{Icon.chevronR({ size: 13 })}</button>
            </div>
          ))}
          {!filtered.length && <div className="py-empty" data-testid="pay-ts-empty" style={{ padding: 44, textAlign: 'center' }}>
            <b>No timesheets match this filter</b>
            <div className="muted" style={{ fontSize: 12 }}>Try another status tab, office or period.</div>
          </div>}
        </div>
        <Pager page={page} setPage={setPage} total={filtered.length} testId="pay-ts-pager" />
      </div>

      {detail && detailTs && (
        <div className="modal-overlay" onClick={() => setDetail(null)}>
          <div className="modal pay-drawer" data-testid="pay-ts-detail" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Timesheet detail">
            <div className="modal-head">
              <b>Timesheet · {period.start} → {period.end}</b>
              <button className="modal-x" onClick={() => setDetail(null)} aria-label="Close">{Icon.x({ size: 15 })}</button>
            </div>
            <div className="modal-body">
              <div className="pay-detail-top">
                <StaffCell staffId={detail.staffId} size={34} />
                <StatusPill status={detailTs.sheet.status} />
              </div>
              <div className="pay-summary-mini">
                <div><span>Hours</span><b>{hrs(detailTs.totals.hours)}</b></div>
                <div><span>Straight-time value</span><b>{money(detailTs.totals.straightCents)}</b></div>
                <div><span>Lines</span><b>{detailTs.totals.lines}</b></div>
                <div><span>Adjustments</span><b>{(detailTs.sheet.adjustments || []).length}</b></div>
                {/* ⚡ behavior-analytic time on the same sheet — certification currency,
                    not a different pay rate */}
                <div data-testid="pay-ts-aba" title="Non-service blocks marked as behavior-analytic (⚡ ABA) time — tracked for RBT / BCAT, graduate-student and state-certification hours">
                  <span>⚡ ABA hours</span><b>{hrs(detailTs.totals.abaHours)}</b>
                </div>
              </div>

              <h4 className="pay-h4">Earned lines (from the calendar)</h4>
              <div className="pay-lines" data-testid="pay-ts-lines">
                <div className="pay-line head"><span>Date</span><span>Code</span><span className="num">Hours</span><span className="num">Rate</span><span className="num">Amount</span><span>Source</span></div>
                {detailTs.lines.map((l) => (
                  <div key={l.id} className="pay-line" data-testid={`pay-ts-line-${l.id}`}>
                    <span>{l.date}</span>
                    <span><span className="pay-code">{l.code}</span> {earningIndex(payroll)[l.code]?.short}</span>
                    <span className="num">{hrs(l.hours)}</span>
                    <span className="num">{l.rate ? `$${Number(l.rate).toFixed(2)}` : '—'}</span>
                    <span className="num">{money(l.amount != null ? l.amount : Math.round(l.hours * l.rate * 100))}</span>
                    <span className="muted">{l.meta?.abaHr ? `⚡ ABA${l.meta?.abaActivity ? ` · ${l.meta.abaActivity}` : ''}` : l.source === 'adjustment' ? `manual — ${l.note || 'adjustment'}` : (l.note || l.meta?.evv || 'schedule')}</span>
                  </div>
                ))}
                {!detailTs.lines.length && <div className="pay-line empty">No payable time in this period.</div>}
              </div>

              <h4 className="pay-h4">Add a supervisor adjustment</h4>
              <div className="pay-adjform">
                <label className="pay-field"><span>Earning code</span>
                  <select className="input" value={adj.code} onChange={(e) => setAdj({ ...adj, code: e.target.value })} data-testid="pay-ts-adj-code">
                    {earningCodesFor(payroll).filter((c) => c.kind !== 'worked').map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                  </select>
                </label>
                <label className="pay-field"><span>Date in period</span>
                  <input className="input" type="date" min={period.start} max={period.end} value={adj.date || period.end} onChange={(e) => setAdj({ ...adj, date: e.target.value })} data-testid="pay-ts-adj-date" />
                </label>
                <label className="pay-field"><span>{['BONUS', 'BONUSX', 'MILE', 'EXP'].includes(adj.code) ? 'Amount ($)' : 'Hours'}</span>
                  <input className="input" type="number" min="0" step="0.25" value={adj.hours} onChange={(e) => setAdj({ ...adj, hours: e.target.value })} data-testid="pay-ts-adj-hours" />
                </label>
                <label className="pay-field"><span>Note</span>
                  <input className="input" value={adj.note} onChange={(e) => setAdj({ ...adj, note: e.target.value })} data-testid="pay-ts-adj-note" placeholder="Why this adjustment" />
                </label>
                <button className="btn btn-sm btn-primary" data-testid="pay-ts-adj-add" onClick={() => {
                  const res = actions.payrollSheet(detail.staffId, period.id, 'adjust', { adjustment: { ...adj, date: adj.date || period.end, hours: Number(adj.hours) }, who, period })
                  toast({ message: res.msg, kind: res.ok ? 'ok' : 'warn' })
                  if (res.ok) setAdj({ ...adj, hours: 1, note: '' })
                }}>Add adjustment</button>
              </div>
              {(detailTs.sheet.adjustments || []).length > 0 && (
                <div className="pay-lines" style={{ marginTop: 10 }}>
                  {detailTs.sheet.adjustments.map((a) => (
                    <div key={a.id} className="pay-line">
                      <span>{a.date}</span>
                      <span><span className="pay-code">{a.code}</span> {earningIndex(payroll)[a.code]?.short}</span>
                      <span className="num">{['BONUS', 'BONUSX', 'MILE', 'EXP'].includes(a.code) ? '—' : hrs(a.hours)}</span>
                      <span className="num">{['BONUS', 'BONUSX', 'MILE', 'EXP'].includes(a.code) ? `$${a.hours.toFixed(2)}` : ''}</span>
                      <span />
                      <span className="muted">{a.note} · {a.by}</span>
                    </div>
                  ))}
                </div>
              )}

              <h4 className="pay-h4">Decision trail</h4>
              <div className="pay-audit" data-testid="pay-ts-audit">
                {(detailTs.sheet.audit || []).slice().reverse().map((a, i) => (
                  <div key={i} className="pay-audit-row"><span>{new Date(a.at).toLocaleString()}</span><b>{a.who}</b><span>{a.action}{a.detail ? ` — ${a.detail}` : ''}</span></div>
                ))}
              </div>
            </div>
            <div className="modal-foot">
              <button className="btn btn-sm" data-testid="pay-ts-detail-submit" onClick={() => { const r = actions.payrollSheet(detail.staffId, period.id, 'submit', { who }); toast({ message: r.msg, kind: r.ok ? 'ok' : 'warn' }) }}>Submit</button>
              <button className="btn btn-sm btn-primary" data-testid="pay-ts-detail-approve" onClick={() => { const r = actions.payrollSheet(detail.staffId, period.id, 'approve', { who }); toast({ message: r.msg, kind: r.ok ? 'ok' : 'warn' }) }}>Approve</button>
              <button className="btn btn-sm" data-testid="pay-ts-detail-reject" onClick={() => { const r = actions.payrollSheet(detail.staffId, period.id, 'reject', { who, note: 'Returned to the supervisor for correction' }); toast({ message: r.msg, kind: r.ok ? 'ok' : 'warn' }) }}>Return</button>
              <button className="btn btn-sm" data-testid="pay-ts-detail-revert" onClick={() => { const r = actions.payrollSheet(detail.staffId, period.id, 'revert', { who, force: true }); toast({ message: r.msg, kind: r.ok ? 'ok' : 'warn' }) }}>Reopen</button>
              <button className="btn btn-sm" data-testid="pay-ts-detail-print" onClick={() => { download(`timesheet-${detail.staffId}-${period.start}.html`, timesheetHtml(state, detail.staffId, period), 'text/html;charset=utf-8'); toast({ message: 'Timesheet opened as a printable document', kind: 'ok' }) }}>{Icon.print({ size: 13 })} Print</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
