import React, { useMemo, useState } from 'react'
import { useStore } from '../../state/store'
import { SectionBar } from '../NavRail'
import { Icon } from '../../ui/Icons'
import { useToast } from '../../ui/Toast'
import { money, hrs, PayKpis, PeriodPicker, StaffCell, StatusPill, Pager } from './PayrollCommon'
import { EARNING_BY_ID, computeRun, runBreakdown, annualSummary, periodFromId, periodsFor, grossToNet } from '../../lib/payroll'
import { registerSpec, registerCsv, payrollCsv } from '../../lib/payrollExport'
import { specToXls, specToPdf, downloadDoc } from '../../lib/exportKit'
import { download } from '../../lib/ics'
import { todayISO } from '../../lib/date'

/**
 * Payroll Summary Wizard — the "what did this period actually cost" screen.
 *
 * Read-only by design: it prices the live ledgers for the chosen period and
 * breaks the total down by cost centre, earning code and employee, plus the
 * cost-per-delivered-clinical-hour figure that tells a practice whether its
 * wage base is drifting.
 */
export default function PayrollSummaryView() {
  const state = useStore()
  const { settings, staff, payProfiles } = state
  const toast = useToast()
  const payroll = settings.payroll
  const [periodId, setPeriodId] = useState(() => periodsFor(payroll, payroll.anchor, { back: 12, forward: 12 }).find((p) => p.start <= todayISO() && todayISO() <= p.end)?.id || payroll.anchor)
  const [generated, setGenerated] = useState(false)
  const [groupBy, setGroupBy] = useState('employee')
  const [page, setPage] = useState(1)
  const [q, setQ] = useState('')

  const period = useMemo(() => periodFromId(payroll, periodId, { back: 12, forward: 12 }), [payroll, periodId])
  const included = useMemo(() => (payProfiles || []).filter((p) => p.include).map((p) => p.staffId), [payProfiles])
  const result = useMemo(() => (generated && period ? computeRun(state, period, { included }) : null), [generated, state, period, included])
  const breakdown = useMemo(() => (result ? runBreakdown(result, state) : null), [result, state])

  const ytd = useMemo(() => {
    if (!result) return {}
    const year = (period?.start || '').slice(0, 4)
    return Object.fromEntries(result.lines.map((l) => [l.staffId, annualSummary(state, l.staffId, year)]))
  }, [result, state, period])

  const rows = useMemo(() => (result?.lines || [])
    .filter((l) => !q.trim() || `${l.name} ${l.payrollId} ${l.office}`.toLowerCase().includes(q.trim().toLowerCase())),
  [result, q])
  const pageRows = rows.slice((page - 1) * 25, page * 25)
  const costPerHour = result && result.totals.deliveredHours > 0
    ? Math.round(result.totals.totalCostCents / result.totals.deliveredHours) : null
  const wageShareOfDelivered = result && result.totals.deliveredHours > 0
    ? Math.round(result.totals.grossCents / result.totals.deliveredHours) : null

  const exportSummary = (kind) => {
    if (!result) return
    const spec = registerSpec({ ...result, no: `SUMMARY-${period.start}`, periodStart: period.start, periodEnd: period.end, payDate: period.payDate, status: 'draft' }, state)
    spec.title = `Payroll summary ${period.start} → ${period.end}`
    spec.blurb = `Cost summary for ${result.totals.staff} employees · ${hrs(result.totals.workedHours + result.totals.otHours)} paid · ${hrs(result.totals.deliveredHours)} delivered clinically`
    if (kind === 'csv') {
      download(`payroll-summary-${period.start}.csv`, payrollCsv([
        ['Employee', 'Payroll ID', 'Office', 'Pay type', 'Hours', 'OT hours', 'Delivered hours', 'Gross', 'Pre-tax', 'Taxes', 'Post-tax', 'Net', 'Employer cost', 'Total cost', 'Cost / delivered hour'],
        ...rows.map((l) => [
          l.name, l.payrollId || '', l.office || '', l.payType, l.workedHours.toFixed(2), l.otHours.toFixed(2), (l.deliveredHours || 0).toFixed(2),
          (l.grossCents / 100).toFixed(2), (l.preTaxCents / 100).toFixed(2), (l.taxCents / 100).toFixed(2), (l.postTaxCents / 100).toFixed(2),
          (l.netCents / 100).toFixed(2), (l.employerCents / 100).toFixed(2), (l.totalCostCents / 100).toFixed(2),
          l.costPerDeliveredHourCents != null ? (l.costPerDeliveredHourCents / 100).toFixed(2) : '',
        ]),
        ['TOTAL', '', '', '', result.totals.workedHours.toFixed(2), result.totals.otHours.toFixed(2), result.totals.deliveredHours.toFixed(2),
          (result.totals.grossCents / 100).toFixed(2), (result.totals.preTaxCents / 100).toFixed(2), (result.totals.taxCents / 100).toFixed(2),
          (result.totals.postTaxCents / 100).toFixed(2), (result.totals.netCents / 100).toFixed(2), (result.totals.employerCents / 100).toFixed(2),
          (result.totals.totalCostCents / 100).toFixed(2), costPerHour != null ? (costPerHour / 100).toFixed(2) : ''],
      ]), 'text/csv;charset=utf-8')
    } else if (kind === 'xls') downloadDoc(`payroll-summary-${period.start}.xls`, specToXls(spec), 'application/vnd.ms-excel')
    else downloadDoc(`payroll-summary-${period.start}.pdf`, specToPdf(spec), 'application/pdf')
    toast({ message: `Payroll summary exported as ${kind.toUpperCase()}`, kind: 'ok' })
  }

  return (
    <div className="sectionpage" data-testid="pay-sum-sec" style={{ background: 'var(--bg)' }}>
      <SectionBar icon="rows" title="Payroll Summary" sub={generated ? `${period.start} → ${period.end} · ${result.totals.staff} employees · ${money(result.totals.totalCostCents, { cents: false })} total cost` : 'Please select the payroll period you would like to see'}>
        {generated && (
          <>
            <button className="btn btn-sm" data-testid="pay-sum-csv" onClick={() => exportSummary('csv')}>CSV</button>
            <button className="btn btn-sm" data-testid="pay-sum-xls" onClick={() => exportSummary('xls')}>Excel</button>
            <button className="btn btn-sm" data-testid="pay-sum-pdf" onClick={() => exportSummary('pdf')}>PDF</button>
          </>
        )}
      </SectionBar>

      <div className="pay-card" data-testid="pay-sum-wizard">
        <h3>Please select the payroll period you would like to see</h3>
        <PeriodPicker value={periodId} onChange={(id) => { setPeriodId(id); setGenerated(false) }} />
        <div className="pay-actions">
          <button className="btn btn-primary" data-testid="pay-sum-generate" onClick={() => { setGenerated(true); setPage(1) }}>Generate</button>
          {generated && <button className="btn btn-sm" data-testid="pay-sum-reset" onClick={() => setGenerated(false)}>Reset</button>}
        </div>
      </div>

      {generated && result && (
        <>
          <PayKpis testId="pay-sum-kpis" items={[
            ['Employees', result.totals.staff, `${included.length} eligible`, 'pay-sum-kpi-staff'],
            ['Hours paid', hrs(result.totals.workedHours + result.totals.otHours), `OT ${hrs(result.totals.otHours)}`, 'pay-sum-kpi-hours'],
            ['Delivered clinical hours', hrs(result.totals.deliveredHours), 'face-to-face time', 'pay-sum-kpi-delivered'],
            ['Gross wages', money(result.totals.grossCents, { cents: false }), 'before deductions', 'pay-sum-kpi-gross'],
            ['Total cost to practice', money(result.totals.totalCostCents, { cents: false }), `employer taxes & benefits ${money(result.totals.employerCents, { cents: false })}`, 'pay-sum-kpi-cost'],
            ['Cost / delivered hour', costPerHour != null ? money(costPerHour) : '—', wageShareOfDelivered != null ? `wages alone ${money(wageShareOfDelivered)}` : 'no deliveries', 'pay-sum-kpi-unit'],
          ]} />

          <div className="pay-cols">
            <div className="pay-card">
              <div className="pay-card-head"><b>By earning code</b><span className="muted">where the money went</span></div>
              <div className="pay-lines">
                <div className="pay-line head" style={{ gridTemplateColumns: '1.6fr 92px 110px 92px' }}><span>Code</span><span className="num">Hours</span><span className="num">Amount</span><span className="num">Staff</span></div>
                {breakdown.byCode.map((c) => (
                  <div key={c.code} className="pay-line" style={{ gridTemplateColumns: '1.6fr 92px 110px 92px' }} data-testid={`pay-sum-code-${c.code}`}>
                    <span><span className="pay-code">{c.code}</span> {EARNING_BY_ID[c.code]?.short || c.label}</span>
                    <span className="num">{hrs(c.minutes / 60)}</span>
                    <span className="num">{money(c.cents)}</span>
                    <span className="num muted">{c.staff}</span>
                  </div>
                ))}
                {!breakdown.byCode.length && <div className="pay-line empty">No payable earnings in this period.</div>}
              </div>
            </div>

            <div className="pay-card">
              <div className="pay-card-head"><b>By office / cost centre</b><span className="muted">labour cost allocation</span></div>
              <div className="pay-lines">
                <div className="pay-line head" style={{ gridTemplateColumns: '1.5fr 70px 100px 100px 96px' }}><span>Office</span><span className="num">Staff</span><span className="num">Gross</span><span className="num">Employer</span><span className="num">$/delivered hr</span></div>
                {breakdown.byOffice.map((o) => (
                  <div key={o.office} className="pay-line" style={{ gridTemplateColumns: '1.5fr 70px 100px 100px 96px' }} data-testid={`pay-sum-office-${o.office.replace(/\s+/g, '-').toLowerCase()}`}>
                    <span>{o.office}</span>
                    <span className="num">{o.staff}</span>
                    <span className="num">{money(o.grossCents)}</span>
                    <span className="num">{money(o.employerCents)}</span>
                    <span className="num">{o.deliveredHours > 0 ? money(Math.round((o.grossCents + o.employerCents) / o.deliveredHours)) : '—'}</span>
                  </div>
                ))}
                {!breakdown.byOffice.length && <div className="pay-line empty">No offices to summarise.</div>}
              </div>
              <div className="pay-hint">
                Cost per delivered clinical hour is the number to watch: a rise can mean extra admin/travel time or a shift in the pay mix,
                not necessarily a raise.
              </div>
            </div>
          </div>

          <div className="pay-card">
            <div className="pay-card-head">
              <b>Employee detail</b>
              <div className="pay-actions">
                <div className="viewseg" data-testid="pay-sum-groupby">
                  {[['employee', 'By employee'], ['ytd', 'Year to date']].map(([id, label]) => (
                    <button key={id} className={groupBy === id ? 'on' : ''} data-testid={`pay-sum-group-${id}`} onClick={() => setGroupBy(id)}>{label}</button>
                  ))}
                </div>
                <div className="sb-search" style={{ minWidth: 190, borderRadius: 10, margin: 0 }}>
                  <span className="sic">{Icon.search({ size: 12 })}</span>
                  <input placeholder="Search employee" value={q} onChange={(e) => { setQ(e.target.value); setPage(1) }} data-testid="pay-sum-search" />
                </div>
              </div>
            </div>
            <div className="py-tbl" style={{ overflowX: 'auto', border: 0, boxShadow: 'none' }}>
              <div className="py-thead" style={{ gridTemplateColumns: '2fr 110px 92px 92px 100px 100px 100px 100px 110px' }}>
                <span>Employee</span><span>Office</span><span className="num">{groupBy === 'ytd' ? 'YTD gross' : 'Hours'}</span><span className="num">{groupBy === 'ytd' ? 'YTD net' : 'OT'}</span>
                <span className="num">{groupBy === 'ytd' ? 'YTD taxes' : 'Gross'}</span><span className="num">Taxes</span><span className="num">Net</span><span className="num">Employer</span><span className="num">Total cost</span>
              </div>
              {pageRows.map((l) => {
                const y = ytd[l.staffId]
                return (
                  <div key={l.staffId} className="py-trow" data-testid={`pay-sum-row-${l.staffId}`} style={{ gridTemplateColumns: '2fr 110px 92px 92px 100px 100px 100px 100px 110px', minHeight: 52, cursor: 'default' }}>
                    <StaffCell staffId={l.staffId} sub={`${l.payrollId || 'no payroll ID'} · ${l.payType}`} />
                    <span className="muted">{l.office}</span>
                    <span className="num" style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{groupBy === 'ytd' ? money(y?.grossCents || 0) : hrs(l.workedHours)}</span>
                    <span className="num" style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{groupBy === 'ytd' ? money(y?.netCents || 0) : (l.otHours ? hrs(l.otHours) : '—')}</span>
                    <span className="num" style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{groupBy === 'ytd' ? money(y?.taxCents || 0) : money(l.grossCents)}</span>
                    <span className="num" style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{money(l.taxCents)}</span>
                    <span className="num" style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 650 }}>{money(l.netCents)}</span>
                    <span className="num" style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{money(l.employerCents)}</span>
                    <span className="num" style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{money(l.totalCostCents)}</span>
                  </div>
                )
              })}
            </div>
            <Pager page={page} setPage={setPage} total={rows.length} testId="pay-sum-pager" />
            {groupBy === 'ytd' && (
              <div className="pay-hint">Year-to-date figures come from <b>processed</b> runs only — a draft or approved run has not been paid yet, so it is not in YTD.</div>
            )}
          </div>

          <div className="pay-card">
            <div className="pay-card-head"><b>Control checks</b><span className="muted">what an approver should look at</span></div>
            <div className="pay-lines">
              <div className="pay-line" style={{ gridTemplateColumns: '2fr 1fr 1fr' }}>
                <span>Runs already processed for this period</span>
                <span className="num">{Object.values(state.payRuns || {}).filter((r) => r.periodId === periodId && r.locked).length}</span>
                <span className="muted">a second run for a paid period is an off-cycle decision</span>
              </div>
              <div className="pay-line" style={{ gridTemplateColumns: '2fr 1fr 1fr' }}>
                <span>Timesheets not yet approved</span>
                <span className="num">{Object.values(state.paySheets || {}).filter((s) => s.periodId === periodId && !['approved', 'processed'].includes(s.status)).length}</span>
                <span className="muted">preview only — the run gate blocks on these</span>
              </div>
              <div className="pay-line" style={{ gridTemplateColumns: '2fr 1fr 1fr' }}>
                <span>Employees without a payroll ID</span>
                <span className="num">{(payProfiles || []).filter((p) => p.include && !String(p.payrollId || '').trim()).length}</span>
                <span className="muted">blocks the provider export</span>
              </div>
              <div className="pay-line" style={{ gridTemplateColumns: '2fr 1fr 1fr' }}>
                <span>Latest period price (this view)</span>
                <span className="num">{money(result.totals.totalCostCents, { cents: false })}</span>
                <span className="muted">compare to the previous period before approving</span>
              </div>
            </div>
          </div>
        </>
      )}

      {!generated && (
        <div className="pay-card muted" data-testid="pay-sum-empty">
          Generate a period to see gross-to-net, cost by office and earning code, and the cost per delivered clinical hour.
        </div>
      )}
    </div>
  )
}
