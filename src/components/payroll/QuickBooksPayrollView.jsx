import React, { useMemo, useState } from 'react'
import { useStore } from '../../state/store'
import { SectionBar } from '../NavRail'
import { Icon } from '../../ui/Icons'
import { useToast } from '../../ui/Toast'
import { PaySubNav, money, hrs, PayKpis, StaffCell, Pager, StatusPill } from './PayrollCommon'
import { earningCodesFor, earningIndex, profileFor, linesInRange, periodsFor, periodFromId, eligibleProfiles, duplicatePayrollIds, OFFICES } from '../../lib/payroll'
import { payrollCsv } from '../../lib/payrollExport'
import { download } from '../../lib/ics'
import { todayISO } from '../../lib/date'

const fmtD = (iso) => (iso || '').slice(0, 10)

/**
 * QuickBooks Payroll — the provider handoff.
 *
 * There is no QuickBooks connection: this builds the file a practice would hand
 * its payroll provider, keyed on the payroll ID, and keeps a reviewable ledger of
 * every artifact that left the building. It refuses to build a file for staff who
 * have no payroll ID, because that is exactly how an import silently drops a
 * person (or pays the wrong one).
 */
export default function QuickBooksPayrollView() {
  const state = useStore()
  const { settings, staff, actions, payExports, payProfiles } = state
  const toast = useToast()
  const payroll = settings.payroll
  const canExport = state.canAccess('payrollQbo', 'full')
  const currentPeriod = useMemo(() => periodsFor(payroll, payroll.anchor, { back: 12, forward: 12 }).find((p) => todayISO() >= p.start && todayISO() <= p.end) || periodFromId(payroll, payroll.anchor, {}), [payroll])

  const [staffSel, setStaffSel] = useState([])
  const [office, setOffice] = useState('all')
  const [start, setStart] = useState(currentPeriod?.start || todayISO())
  const [end, setEnd] = useState(currentPeriod?.end || todayISO())
  const [codes, setCodes] = useState(['REG', 'OT', 'SUP', 'EVAL', 'DRIVE'])
  const [q, setQ] = useState('')
  const [rows, setRows] = useState(null)
  const [selRows, setSelRows] = useState([])
  const [page, setPage] = useState(1)

  const eligible = useMemo(() => eligibleProfiles(state).filter((p) => office === 'all' || p.office === office), [state, office])
  const dupes = useMemo(() => duplicatePayrollIds(payProfiles || []), [payProfiles])
  const missingIds = useMemo(() => eligible.filter((p) => !String(p.payrollId || '').trim()), [eligible])
  const ledger = useMemo(() => Object.values(payExports || {}).sort((a, b) => (b.at || 0) - (a.at || 0)), [payExports])

  const targets = staffSel.length ? eligible.filter((p) => staffSel.includes(p.staffId)) : eligible
  void dupes

  const generate = () => {
    if (start > end) return toast({ message: 'The start date must be on or before the end date', kind: 'warn' })
    if (!codes.length) return toast({ message: 'Pick at least one earning code — that is the wage item the provider books', kind: 'warn' })
    const out = []
    for (const p of targets) {
      const s = (staff || []).find((x) => x.id === p.staffId)
      const lines = linesInRange(state, p.staffId, start, end)
      for (const l of lines) {
        if (!codes.includes(l.code)) continue
        const code = earningIndex(payroll)[l.code]
        out.push({
          id: `${p.staffId}-${l.id}`, staffId: p.staffId, name: s?.name || p.staffId, role: s?.role || '',
          payrollId: p.payrollId || '', office: p.office || '', payType: p.payType,
          date: l.date, code: l.code, label: code?.label || l.code, item: code?.short || l.code,
          account: l.code === 'REG' || l.code === 'SUP' || l.code === 'EVAL' ? payroll.glAccounts.wages : payroll.glAccounts.wages,
          hours: l.hours || 0, rate: l.rate || 0,
          amountCents: l.amount != null ? l.amount : Math.round((l.hours || 0) * (l.rate || 0) * 100),
        })
      }
    }
    setRows(out)
    setSelRows(out.map((r) => r.id))
    setPage(1)
    if (!out.length) toast({ message: 'No payable lines matched that window and code selection', kind: 'warn' })
    else toast({ message: `${out.length} provider rows built across ${new Set(out.map((r) => r.staffId)).size} employees`, kind: 'ok' })
  }

  const reset = () => { setStaffSel([]); setOffice('all'); setCodes(['REG', 'OT', 'SUP', 'EVAL', 'DRIVE']); setRows(null); setSelRows([]); setQ('') }

  const exportCsv = () => {
    if (!canExport) return toast({ message: 'Exporting provider files requires full QuickBooks Payroll access.', kind: 'warn' })
    if (!rows) return
    const chosen = rows.filter((r) => selRows.includes(r.id))
    if (!chosen.length) return toast({ message: 'Select at least one row to export', kind: 'warn' })
    const header = ['Payroll ID', 'Employee', 'Pay period start', 'Pay period end', 'Pay date', 'Pay type', 'Item type', 'Item name', 'Payroll item', 'Hours', 'Rate', 'Amount', 'Account']
    const lines = chosen.map((r) => [
      r.payrollId, r.name, start, end, end, r.payType, 'Earning', r.item, r.label,
      r.hours ? r.hours.toFixed(2) : '', r.rate ? Number(r.rate).toFixed(2) : '', (r.amountCents / 100).toFixed(2), r.account,
    ])
    const total = chosen.reduce((t, r) => t + r.amountCents, 0)
    lines.push(['TOTAL', `${new Set(chosen.map((r) => r.staffId)).size} employees`, '', '', '', '', '', '', '', '', '', (total / 100).toFixed(2), ''])
    const content = payrollCsv([header, ...lines])
    const fileName = `quickbooks-payroll-${start}_${end}.csv`
    const staffIds = [...new Set(chosen.map((row) => row.staffId))]
    const recorded = actions.recordPayExport({
      kind: 'qbo_payroll', fileName, rows: chosen.length, totalCents: total, staffIds,
      periodStart: start, periodEnd: end, staffCount: staffIds.length,
      content, note: `Earning codes: ${codes.join(', ')}${office !== 'all' ? ` · office ${office}` : ''}`,
    }, 'payrollQbo')
    if (recorded?.ok === false) return
    download(fileName, content, 'text/csv;charset=utf-8')
    toast({ message: `${fileName} built and recorded — review it before handing it to QuickBooks`, kind: 'ok' })
  }

  const pageRows = (rows || []).slice((page - 1) * 25, page * 25)
  const chosen = (rows || []).filter((r) => selRows.includes(r.id))
  const totalCents = chosen.reduce((t, r) => t + r.amountCents, 0)

  return (
    <div className="sectionpage pay-hub" data-testid="pay-qbo-sec" style={{ background: 'var(--bg)' }}>
      <SectionBar icon="file" title="QuickBooks Payroll" sub={`Local export builder · ${ledger.length} artifact${ledger.length === 1 ? '' : 's'} recorded · no QuickBooks connection`}>
        <button className="btn btn-sm" data-testid="pay-qbo-reset-top" onClick={reset}>Reset</button>
      </SectionBar>

      <PaySubNav />

      <div className="batch-strip" style={{ margin: 16, padding: '12px 16px', background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 12 }}>
        <span className="muted">
          This workspace does not talk to QuickBooks. It builds the earnings file you would import there, keyed on the payroll ID
          maintained in Payroll ID Mapping, and records each artifact so the handoff is auditable.
        </span>
      </div>

      {(missingIds.length > 0 || dupes.length > 0) && (
        <div className="batch-strip" style={{ margin: '0 16px 16px', padding: '12px 16px', background: 'var(--panel)', border: '1px solid var(--danger, #ef4444)', borderRadius: 12 }} data-testid="pay-qbo-blockers">
          <b style={{ color: 'var(--danger, #ef4444)' }}>{Icon.ban({ size: 13 })} The export cannot be trusted yet</b>
          <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
            {missingIds.length ? `${missingIds.length} employee(s) in scope have no payroll ID — an import would drop or mis-match them. ` : ''}
            {dupes.length ? `${dupes.length} duplicate payroll ID group(s) exist. ` : ''}
            Fix these in Payroll ID Mapping first.
          </div>
        </div>
      )}

      <div className="pay-card" data-testid="pay-qbo-form">
        <div className="pay-form-grid">
          <div className="pay-field" style={{ gridColumn: 'span 2' }}>
            <span>Staff name *</span>
            <div className="pay-picker" data-testid="pay-qbo-staff">
              <div className="pay-picker-head">
                <div className="sb-search" style={{ margin: 0, borderRadius: 10 }}>
                  <span className="sic">{Icon.search({ size: 12 })}</span>
                  <input placeholder="Search staff" value={q} onChange={(e) => setQ(e.target.value)} data-testid="pay-qbo-staff-search" />
                </div>
                <button className="pay-link" data-testid="pay-qbo-staff-all" onClick={() => setStaffSel([])}>All eligible ({eligible.length})</button>
              </div>
              <div className="pay-picker-list">
                {eligible
                  .filter((p) => { const s = staff.find((x) => x.id === p.staffId); return !q.trim() || `${s?.name} ${p.payrollId} ${p.office}`.toLowerCase().includes(q.trim().toLowerCase()) })
                  .map((p) => {
                    const s = staff.find((x) => x.id === p.staffId)
                    const on = !staffSel.length || staffSel.includes(p.staffId)
                    return (
                      <label key={p.staffId} className={`pay-picker-row ${on ? 'on' : ''}`} data-testid={`pay-qbo-staff-${p.staffId}`}>
                        <input type="checkbox" className="checkbox" checked={on}
                          onChange={(e) => {
                            const base = staffSel.length ? [...staffSel] : eligible.map((x) => x.staffId)
                            setStaffSel(e.target.checked ? [...new Set([...base, p.staffId])] : base.filter((id) => id !== p.staffId))
                          }} />
                        <span className="pay-picker-name">{s?.name || p.staffId}<i>{p.office} · {p.payrollId || 'no payroll ID'}</i></span>
                      </label>
                    )
                  })}
              </div>
            </div>
          </div>

          <label className="pay-field"><span>Office *</span>
            <select className="input" value={office} onChange={(e) => { setOffice(e.target.value); setStaffSel([]) }} data-testid="pay-qbo-office">
              <option value="all">All offices</option>
              {[...new Set([...OFFICES, ...(payProfiles || []).map((p) => p.office)])].filter(Boolean).map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </label>
          <label className="pay-field"><span>Start date *</span>
            <input className="input" type="date" value={fmtD(start)} onChange={(e) => setStart(e.target.value)} data-testid="pay-qbo-start" />
          </label>
          <label className="pay-field"><span>End date *</span>
            <input className="input" type="date" value={fmtD(end)} onChange={(e) => setEnd(e.target.value)} data-testid="pay-qbo-end" />
          </label>

          <div className="pay-field" style={{ gridColumn: 'span 3' }}>
            <span>Earning code * <i className="muted">— the wage items the provider books</i></span>
            <div className="pay-chips" data-testid="pay-qbo-codes">
              {earningCodesFor(payroll).filter((c) => c.kind !== 'expense').map((c) => {
                const on = codes.includes(c.id)
                return (
                  <button key={c.id} className={`pay-chip ${on ? 'on' : ''}`} data-testid={`pay-qbo-code-${c.id}`}
                    onClick={() => setCodes((x) => (on ? x.filter((y) => y !== c.id) : [...x, c.id]))}>
                    {c.short}<i>{c.id}</i>
                  </button>
                )
              })}
              <button className="pay-link" data-testid="pay-qbo-codes-all" onClick={() => setCodes(earningCodesFor(payroll).filter((c) => c.kind !== 'expense').map((c) => c.id))}>select all</button>
            </div>
          </div>
        </div>

        <div className="pay-actions">
          <button className="btn btn-primary" data-testid="pay-qbo-generate" onClick={generate}>Generate</button>
          <button className="btn btn-sm" data-testid="pay-qbo-reset" onClick={reset}>Reset</button>
          {rows && <span className="muted">{rows.length} rows · {new Set(rows.map((r) => r.staffId)).size} employees · {codes.length} earning codes</span>}
        </div>
      </div>

      {rows && (
        <>
          <PayKpis testId="pay-qbo-kpis" items={[
            ['Rows', rows.length, 'provider line items', 'pay-qbo-kpi-rows'],
            ['Employees', new Set(rows.map((r) => r.staffId)).size, `${eligible.length} in scope`, 'pay-qbo-kpi-staff'],
            ['Selected amount', money(totalCents, { cents: false }), `${chosen.length} of ${rows.length} rows`, 'pay-qbo-kpi-total'],
            ['Window', `${start} → ${end}`, `${codes.length} earning codes`, 'pay-qbo-kpi-window'],
          ]} />

          <div className="pay-card">
            <div className="pay-card-head">
              <div>
                <b>Provider rows</b>
                <div className="muted" style={{ fontSize: 12 }}>Grouped exactly as the import expects: one row per employee per wage item.</div>
              </div>
              <div className="pay-actions">
                <button className="btn btn-sm" data-testid="pay-qbo-selall" onClick={() => setSelRows(selRows.length === rows.length ? [] : rows.map((r) => r.id))}>
                  {selRows.length === rows.length ? 'Clear selection' : 'Select all'}
                </button>
                <button className="btn btn-sm btn-primary" data-testid="pay-qbo-export" disabled={!canExport} onClick={exportCsv}>Export CSV</button>
              </div>
            </div>
            <div className="py-tbl" style={{ overflowX: 'auto', border: 0, boxShadow: 'none' }}>
              <div className="py-thead" style={{ gridTemplateColumns: '34px 2fr 120px 130px 90px 90px 100px 1.2fr' }}>
                <span /><span>Employee</span><span>Payroll ID</span><span>Wage item</span>
                <span className="num">Hours</span><span className="num">Rate</span><span className="num">Amount</span><span>Account</span>
              </div>
              {pageRows.map((r) => (
                <div key={r.id} className="py-trow" data-testid={`pay-qbo-row-${r.id}`} style={{ gridTemplateColumns: '34px 2fr 120px 130px 90px 90px 100px 1.2fr', minHeight: 50 }}>
                  <span><input type="checkbox" className="checkbox" checked={selRows.includes(r.id)} data-testid={`pay-qbo-sel-${r.id}`}
                    onChange={() => setSelRows((x) => (x.includes(r.id) ? x.filter((y) => y !== r.id) : [...x, r.id]))} /></span>
                  <StaffCell staffId={r.staffId} sub={`${r.office}${r.date ? ` · ${r.date}` : ''}`} />
                  <span className="ln-code">{r.payrollId || <i className="muted">missing</i>}</span>
                  <span><span className="pay-code">{r.code}</span> {r.item}</span>
                  <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{r.hours ? hrs(r.hours) : '—'}</span>
                  <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{r.rate ? `$${Number(r.rate).toFixed(2)}` : '—'}</span>
                  <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{money(r.amountCents)}</span>
                  <span className="muted" style={{ fontSize: 11.5 }}>{r.account}</span>
                </div>
              ))}
            </div>
            <Pager page={page} setPage={setPage} total={rows.length} testId="pay-qbo-pager" />
          </div>
        </>
      )}

      <div className="pay-card">
        <div className="pay-card-head">
          <div><b>Export ledger</b><div className="muted" style={{ fontSize: 12 }}>Every payroll artifact built in this workspace</div></div>
          <span className="muted">{ledger.filter((l) => l.status === 'reviewed').length} reviewed locally · {ledger.filter((l) => l.status !== 'reviewed').length} pending</span>
        </div>
        <div className="py-tbl" style={{ overflowX: 'auto', border: 0, boxShadow: 'none' }} data-testid="pay-qbo-ledger">
          <div className="py-thead" style={{ gridTemplateColumns: '110px 1.5fr 1fr 90px 110px 110px 1.4fr' }}>
            <span>Kind</span><span>File</span><span>Period / run</span><span className="num">Rows</span><span>Built</span><span>Review</span><span>Actions</span>
          </div>
          {ledger.map((l) => (
            <div key={l.id} className="py-trow" data-testid={`pay-qbo-artifact-${l.id}`} style={{ gridTemplateColumns: '110px 1.5fr 1fr 90px 110px 110px 1.4fr', minHeight: 50, cursor: 'default' }}>
              <span className="pay-code">{l.kind}</span>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={l.fileName}>{l.fileName || '—'}</span>
              <span className="muted" style={{ fontSize: 11.5 }}>{l.runId ? l.runId.slice(0, 18) : `${l.periodStart || ''}${l.periodStart ? ' → ' : ''}${l.periodEnd || ''}`}</span>
              <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{l.rows ?? '—'}</span>
              <span className="muted" style={{ fontSize: 11.5 }}>{l.at ? new Date(l.at).toLocaleString() : '—'}</span>
              <span>{l.status === 'reviewed' ? <StatusPill status="approved" label="Reviewed" /> : <StatusPill status="pending_approval" label="Pending" />}</span>
              <span style={{ display: 'flex', gap: 6 }}>
                {l.content && <button className="btn btn-xs" data-testid={`pay-qbo-download-${l.id}`} onClick={() => { download(l.fileName, l.content, 'text/csv;charset=utf-8'); toast({ message: `Re-downloaded ${l.fileName}`, kind: 'ok' }) }}>Download</button>}
                {l.status !== 'reviewed'
                  ? <button className="btn btn-xs" data-testid={`pay-qbo-review-${l.id}`} disabled={!canExport} onClick={() => { actions.reviewPayExport(l.id, 'reviewed'); toast({ message: `${l.fileName} marked reviewed locally — this does not import anything`, kind: 'ok' }) }}>Mark reviewed locally</button>
                  : <button className="btn btn-xs" data-testid={`pay-qbo-unreview-${l.id}`} disabled={!canExport} onClick={() => { actions.reviewPayExport(l.id, 'pending'); toast({ message: `${l.fileName} returned to pending`, kind: 'info' }) }}>Return to pending</button>}
                {l.note && <span className="muted" style={{ fontSize: 11, alignSelf: 'center' }}>{l.note}</span>}
              </span>
            </div>
          ))}
          {!ledger.length && <div className="py-empty" style={{ padding: 40, textAlign: 'center' }} data-testid="pay-qbo-ledger-empty">
            <b>No payroll artifacts yet</b>
            <div className="muted" style={{ fontSize: 12 }}>Generate an export, process a run, or download pay stubs and they will be recorded here.</div>
          </div>}
        </div>
      </div>
    </div>
  )
}
