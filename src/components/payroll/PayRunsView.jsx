import React, { useMemo, useState } from 'react'
import { useStore } from '../../state/store'
import { SectionBar } from '../NavRail'
import { Icon } from '../../ui/Icons'
import { useToast } from '../../ui/Toast'
import { PaySubNav, actorName, money, hrs, PayKpis, StaffCell, StatusPill } from './PayrollCommon'
import { RUN_STATUS_LABEL, periodFromId, stubFor, annualSummary } from '../../lib/payroll'
import { registerCsv, registerSpec, qboCsv, glJournalRows, achFile, stubHtml, payrollCsv, deductionRows } from '../../lib/payrollExport'
import { specToXls, specToPdf, downloadDoc, loadPdf } from '../../lib/exportKit'
import { download } from '../../lib/ics'

/**
 * Pay Runs — the register of registers.
 *
 * A processed run is immutable: this screen is where you read it, reprint it,
 * download its stubs and hand off its files. Corrections are made by off-cycle
 * adjustments, never by editing a paid register, and the audit trail says who did
 * what and when.
 */
export default function PayRunsView() {
  const state = useStore()
  const { payRuns, actions, staff, settings } = state
  const toast = useToast()
  const [openId, setOpenId] = useState(null)
  const [statusF, setStatusF] = useState('all')
  const [yearF, setYearF] = useState('all')
  const [q, setQ] = useState('')
  const [who, setWho] = useState(() => actorName(state))

  const runs = useMemo(() => Object.values(payRuns || {}).sort((a, b) => (b.periodStart < a.periodStart ? -1 : 1)), [payRuns])
  const years = useMemo(() => [...new Set(runs.map((r) => (r.periodStart || '').slice(0, 4)))].sort(), [runs])
  const filtered = useMemo(() => runs
    .filter((r) => statusF === 'all' || r.status === statusF)
    .filter((r) => yearF === 'all' || (r.periodStart || '').startsWith(yearF))
    .filter((r) => !q.trim() || `${r.no} ${r.periodStart} ${r.periodEnd}`.toLowerCase().includes(q.trim().toLowerCase())),
  [runs, statusF, yearF, q])

  const open = openId ? (payRuns || {})[openId] : null
  const totals = useMemo(() => runs.filter((r) => r.locked).reduce((t, r) => ({
    gross: t.gross + r.totals.grossCents, net: t.net + r.totals.netCents, cost: t.cost + r.totals.totalCostCents,
  }), { gross: 0, net: 0, cost: 0 }), [runs])

  const act = (op, options = {}) => {
    const res = actions.payrollRun(open.id, op, { who, ...options })
    toast({ message: res.msg, kind: res.ok ? 'ok' : 'warn' })
  }

  const period = open ? periodFromId(settings.payroll, open.periodId, { back: 24, forward: 12 }) : null

  const dl = async (kind) => {
    if (!open) return
    if (kind === 'register-pdf' && !(await loadPdf((m) => toast({ message: m, kind: 'warn' })))) return
    if (kind === 'register-csv') { download(`payroll-register-${open.no}.csv`, registerCsv(open, state), 'text/csv;charset=utf-8'); actions.recordPayExport({ runId: open.id, periodId: open.periodId, kind: 'register_csv', fileName: `payroll-register-${open.no}.csv`, rows: open.lines.length, content: registerCsv(open, state) }) }
    if (kind === 'register-xls') { downloadDoc(`payroll-register-${open.no}.xls`, specToXls(registerSpec(open, state)), 'application/vnd.ms-excel'); actions.recordPayExport({ runId: open.id, periodId: open.periodId, kind: 'register_xls', fileName: `payroll-register-${open.no}.xls`, rows: open.lines.length }) }
    if (kind === 'register-pdf') { downloadDoc(`payroll-register-${open.no}.pdf`, specToPdf(registerSpec(open, state)), 'application/pdf'); actions.recordPayExport({ runId: open.id, periodId: open.periodId, kind: 'register_pdf', fileName: `payroll-register-${open.no}.pdf`, rows: open.lines.length }) }
    if (kind === 'qbo') { download(`quickbooks-payroll-${open.no}.csv`, qboCsv(open, state), 'text/csv;charset=utf-8'); actions.recordPayExport({ runId: open.id, periodId: open.periodId, kind: 'qbo_payroll', fileName: `quickbooks-payroll-${open.no}.csv`, rows: open.lines.length, totalCents: open.totals.grossCents, content: qboCsv(open, state) }) }
    if (kind === 'journal') { download(`payroll-journal-${open.no}.csv`, payrollCsv(glJournalRows(open, state)), 'text/csv;charset=utf-8'); actions.recordPayExport({ runId: open.id, periodId: open.periodId, kind: 'gl_journal', fileName: `payroll-journal-${open.no}.csv`, rows: 5 }) }
    if (kind === 'deductions') { download(`payroll-deductions-${open.no}.csv`, payrollCsv(deductionRows(open)), 'text/csv;charset=utf-8'); actions.recordPayExport({ runId: open.id, periodId: open.periodId, kind: 'deductions', fileName: `payroll-deductions-${open.no}.csv`, rows: open.lines.length }) }
    if (kind === 'stubs') {
      const html = open.included.map((id) => { const s = stubFor(state, open, id); return s ? stubHtml(s) : '' }).filter(Boolean).join('<div style="page-break-after:always"></div>')
      download(`pay-stubs-${open.no}.html`, html, 'text/html;charset=utf-8')
      actions.recordPayExport({ runId: open.id, periodId: open.periodId, kind: 'pay_stubs', fileName: `pay-stubs-${open.no}.html`, rows: open.included.length })
    }
    if (kind === 'ach') {
      download(`payroll-ach-${open.no}.ach`, achFile(open, state), 'text/plain;charset=utf-8')
      actions.recordPayExport({ runId: open.id, periodId: open.periodId, kind: 'ach_draft', fileName: `payroll-ach-${open.no}.ach`, rows: open.included.length, note: 'NACHA-format local draft, not bank-validated' })
      toast({ message: 'ACH draft downloaded. Validate the practice bank details before using it with a bank', kind: 'warn' })
      return
    }
    toast({ message: `${kind} downloaded and recorded`, kind: 'ok' })
  }

  return (
    <div className="sectionpage pay-hub" data-testid="pay-runs-sec" style={{ background: 'var(--bg)' }}>
      <SectionBar icon="table" title="Pay Runs" sub={`${runs.length} runs · ${runs.filter((r) => r.locked).length} processed · ${money(totals.cost, { cents: false })} lifetime cost`}>
        <div className="sb-search" style={{ minWidth: 200, borderRadius: 10 }}>
          <span className="sic">{Icon.search({ size: 12 })}</span>
          <input placeholder="Search run number or period" value={q} onChange={(e) => setQ(e.target.value)} data-testid="pay-runs-search" />
        </div>
        <select className="input" value={statusF} onChange={(e) => setStatusF(e.target.value)} data-testid="pay-runs-status" style={{ width: 160 }} aria-label="Filter by status">
          <option value="all">All statuses</option>
          {Object.entries(RUN_STATUS_LABEL).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
        </select>
        <select className="input" value={yearF} onChange={(e) => setYearF(e.target.value)} data-testid="pay-runs-year" style={{ width: 110 }} aria-label="Filter by year">
          <option value="all">All years</option>
          {years.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
      </SectionBar>

      <PaySubNav />

      <PayKpis testId="pay-runs-kpis" items={[
        ['Runs on file', runs.length, `${runs.filter((r) => r.status === 'draft').length} draft`, 'pay-runs-kpi-count'],
        ['Processed', runs.filter((r) => r.locked).length, 'locked registers', 'pay-runs-kpi-processed'],
        ['Lifetime gross', money(totals.gross, { cents: false }), 'processed only', 'pay-runs-kpi-gross'],
        ['Lifetime net paid', money(totals.net, { cents: false }), 'disbursed', 'pay-runs-kpi-net'],
        ['Lifetime cost', money(totals.cost, { cents: false }), 'wages + employer', 'pay-runs-kpi-cost'],
      ]} />

      <div style={{ padding: '0 16px 16px' }}>
        <div className="py-tbl" data-testid="pay-runs-table" style={{ overflowX: 'auto' }}>
          <div className="py-thead" style={{ gridTemplateColumns: '90px 1.3fr 110px 92px 110px 110px 110px 1.2fr 40px' }}>
            <span>Run</span><span>Period</span><span>Status</span><span className="num">Staff</span>
            <span className="num">Gross</span><span className="num">Net</span><span className="num">Cost</span><span>Prepared / approved by</span><span />
          </div>
          {filtered.map((r) => (
            <div key={r.id} className="py-trow" data-testid={`pay-runs-row-${r.id}`} style={{ gridTemplateColumns: '90px 1.3fr 110px 92px 110px 110px 110px 1.2fr 40px', minHeight: 52 }} onClick={() => setOpenId(r.id)}>
              <span className="ln-code">{r.no}</span>
              <span>{r.periodStart} → {r.periodEnd}<i className="muted" style={{ display: 'block', fontSize: 11 }}>pay date {r.payDate}</i></span>
              <span><StatusPill status={r.status} /></span>
              <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{r.included.length}</span>
              <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{money(r.totals.grossCents)}</span>
              <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 650 }}>{money(r.totals.netCents)}</span>
              <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{money(r.totals.totalCostCents)}</span>
              <span className="muted" style={{ fontSize: 11.5 }}>
                {r.preparedBy}{r.approvedBy ? ` · ${r.approvedBy}` : ''}
                {r.processedAt ? ` · processed ${new Date(r.processedAt).toLocaleDateString()}` : ''}
              </span>
              <button className="iconbtn" aria-label={`Open ${r.no}`} data-testid={`pay-runs-open-${r.id}`} onClick={(e) => { e.stopPropagation(); setOpenId(r.id) }}>{Icon.chevronR({ size: 13 })}</button>
            </div>
          ))}
          {!filtered.length && <div className="py-empty" style={{ padding: 48, textAlign: 'center' }} data-testid="pay-runs-empty">
            <b>No pay runs in this filter</b>
            <div className="muted" style={{ fontSize: 12 }}>Runs you process in Process Payroll appear here with their locked register.</div>
          </div>}
        </div>
      </div>

      {open && (
        <div className="modal-overlay" onClick={() => setOpenId(null)}>
          <div className="modal modal-wide pay-drawer" data-testid="pay-run-detail" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={`Pay run ${open.no}`}>
            <div className="modal-head">
              <b>{open.no} · {open.periodStart} → {open.periodEnd}</b>
              <StatusPill status={open.status} />
              <button className="modal-x" onClick={() => setOpenId(null)} aria-label="Close">{Icon.x({ size: 15 })}</button>
            </div>
            <div className="modal-body">
              <div className="pay-summary-mini">
                <div><span>Pay date</span><b>{open.payDate}</b></div>
                <div><span>Employees</span><b>{open.included.length}</b></div>
                <div><span>Gross</span><b>{money(open.totals.grossCents)}</b></div>
                <div><span>Net</span><b>{money(open.totals.netCents)}</b></div>
                <div><span>Employer cost</span><b>{money(open.totals.employerCents)}</b></div>
                <div><span>Total cost</span><b>{money(open.totals.totalCostCents)}</b></div>
                <div><span>Hours</span><b>{hrs(open.totals.workedHours + open.totals.otHours)}</b></div>
                <div><span>Overtime</span><b>{hrs(open.totals.otHours)}</b></div>
              </div>

              {(open.gate?.blockers?.length > 0 || open.gate?.warnings?.length > 0) && (
                <div className="pay-gate warn" data-testid="pay-run-gate">
                  <span className="ic">{Icon.alert({ size: 15 })}</span>
                  <div>
                    <b>{open.gate.blockers.length} blocker(s) · {open.gate.warnings.length} exception(s) at {open.locked ? 'processing' : 'creation'}</b>
                    <div className="why">{open.gate.warnings.slice(0, 3).map((w) => w.why).join(' · ')}</div>
                  </div>
                </div>
              )}

              <h4 className="pay-h4">Register</h4>
              <div className="py-tbl" style={{ overflowX: 'auto', border: 0, boxShadow: 'none' }}>
                <div className="py-thead" style={{ gridTemplateColumns: '2fr 110px 90px 90px 100px 100px 100px 100px' }}>
                  <span>Employee</span><span>Payroll ID</span><span className="num">Hours</span><span className="num">OT</span>
                  <span className="num">Gross</span><span className="num">Taxes</span><span className="num">Net</span><span className="num">Employer</span>
                </div>
                {open.lines.map((l) => (
                  <div key={l.staffId} className="py-trow" data-testid={`pay-run-line-${l.staffId}`} style={{ gridTemplateColumns: '2fr 110px 90px 90px 100px 100px 100px 100px', minHeight: 50, cursor: 'default' }}>
                    <StaffCell staffId={l.staffId} sub={`${l.office || '—'} · ${l.payType}`} />
                    <span className="ln-code">{l.payrollId || '—'}</span>
                    <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{hrs(l.workedHours)}</span>
                    <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{l.otHours ? hrs(l.otHours) : '—'}</span>
                    <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{money(l.grossCents)}</span>
                    <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{money(l.taxCents)}</span>
                    <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 650 }}>{money(l.netCents)}</span>
                    <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{money(l.employerCents)}</span>
                  </div>
                ))}
              </div>

              <h4 className="pay-h4">Downloads</h4>
              <div className="pay-actions">
                <button className="btn btn-sm" data-testid="pay-run-register-csv" onClick={() => dl('register-csv')}>Register CSV</button>
                <button className="btn btn-sm" data-testid="pay-run-register-xls" onClick={() => dl('register-xls')}>Register Excel</button>
                <button className="btn btn-sm" data-testid="pay-run-register-pdf" onClick={() => dl('register-pdf')}>Register PDF</button>
                <button className="btn btn-sm" data-testid="pay-run-qbo" onClick={() => dl('qbo')}>QuickBooks payroll</button>
                <button className="btn btn-sm" data-testid="pay-run-journal" onClick={() => dl('journal')}>GL journal</button>
                <button className="btn btn-sm" data-testid="pay-run-deductions" onClick={() => dl('deductions')}>Deductions</button>
                <button className="btn btn-sm" data-testid="pay-run-stubs" onClick={() => dl('stubs')}>Pay stubs</button>
                <button className="btn btn-sm" data-testid="pay-run-ach" onClick={() => dl('ach')}>ACH draft</button>
              </div>

              {open.locked && (
                <div className="pay-hint">
                  This register is locked. Corrections are made with an off-cycle run so the paid record and the correction both stay visible.
                </div>
              )}

              <h4 className="pay-h4">Audit trail</h4>
              <div className="pay-audit" data-testid="pay-run-audit">
                {(open.audit || []).slice().reverse().map((a, i) => (
                  <div key={i} className="pay-audit-row"><span>{new Date(a.at).toLocaleString()}</span><b>{a.who}</b><span>{a.action}{a.detail ? `: ${a.detail}` : ''}</span></div>
                ))}
              </div>

              {open.exports?.length > 0 && (
                <>
                  <h4 className="pay-h4">Artifacts from this run</h4>
                  <div className="pay-lines">
                    {open.exports.map((e, i) => (
                      <div key={i} className="pay-line" style={{ gridTemplateColumns: '1fr 1.4fr 90px' }}><span className="pay-code">{e.kind}</span><span>{e.fileName}</span><span className="num muted">{e.rows} rows</span></div>
                    ))}
                  </div>
                </>
              )}

              {(open.excluded || []).length > 0 && (
                <>
                  <h4 className="pay-h4">Left out of this run</h4>
                  <div className="pay-lines" data-testid="pay-run-excluded">
                    {open.excluded.map((id) => (
                      <div key={id} className="pay-line" style={{ gridTemplateColumns: '2fr 3fr' }}>
                        <span>{staff.find((x) => x.id === id)?.name || id}</span>
                        <span className="muted">eligible but not included. No money moved for them in this run</span>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {open.locked && (
                <>
                  <h4 className="pay-h4">Year to date (processed runs)</h4>
                  <div className="pay-lines">
                    {open.included.slice(0, 6).map((id) => {
                      const y = annualSummary(state, id, open.periodStart.slice(0, 4))
                      const s = staff.find((x) => x.id === id)
                      return (
                        <div key={id} className="pay-line" style={{ gridTemplateColumns: '2fr 1fr 1fr 1fr' }} data-testid={`pay-run-ytd-${id}`}>
                          <span>{s?.name || id}</span>
                          <span className="num">{money(y.grossCents)} gross</span>
                          <span className="num">{money(y.taxCents)} tax</span>
                          <span className="num">{money(y.netCents)} net</span>
                        </div>
                      )
                    })}
                  </div>
                </>
              )}
            </div>
            <div className="modal-foot">
              <select className="input" value={who} onChange={(e) => setWho(e.target.value)} data-testid="pay-run-actor" style={{ width: 170 }} aria-label="Acting as">
                {(staff || []).map((s) => <option key={s.id} value={s.name}>{s.name}</option>)}
                <option value="Payroll admin">Payroll admin</option>
              </select>
              {open.status === 'draft' && <button className="btn btn-sm btn-primary" data-testid="pay-run-approve" onClick={() => act('approve')}>Approve</button>}
              {open.status === 'draft' && open.included.length !== undefined && <button className="btn btn-sm" data-testid="pay-run-submit-approval" onClick={() => act('submit')}>Send for approval</button>}
              {open.status === 'approved' && <button className="btn btn-sm btn-primary" data-testid="pay-run-process" onClick={() => act('process')}>Process &amp; lock</button>}
              {open.status === 'pending_approval' && <button className="btn btn-sm btn-primary" data-testid="pay-run-approve-pending" onClick={() => act('approve')}>Approve</button>}
              {!['processed', 'voided'].includes(open.status) && <button className="btn btn-sm" data-testid="pay-run-reopen" onClick={() => act('reopen')}>Reopen as draft</button>}
              {open.status !== 'voided' && <button className="btn btn-sm" data-testid="pay-run-void" onClick={() => act('void', { note: 'Voided from the pay run register' })}>Void run</button>}
              <button className="btn btn-sm" onClick={() => setOpenId(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
