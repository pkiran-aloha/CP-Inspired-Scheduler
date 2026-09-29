import React, { useEffect, useMemo, useState } from 'react'
import { useStore } from '../../state/store'
import { SectionBar } from '../NavRail'
import { Icon } from '../../ui/Icons'
import { useToast } from '../../ui/Toast'
import { money, hrs, PayKpis, PeriodPicker, GateList, StaffCell, StatusPill, PayStepper, PhasePanel } from './PayrollCommon'
import ReviewRegisterModal from './ReviewRegisterModal'
import { RUN_STATUS_LABEL, eligibleProfiles, computeRun, periodFromId, periodFor, stubFor } from '../../lib/payroll'
import { registerCsv, registerSpec, qboCsv, glJournalRows, achFile, stubHtml, payrollCsv } from '../../lib/payrollExport'
import { specToXls, specToPdf, downloadDoc } from '../../lib/exportKit'
import { download } from '../../lib/ics'
import { todayISO } from '../../lib/date'

/** The four phases, with the iconography and one-line promise of each. */
const PHASES = [
  { label: 'Select period', sub: 'Which cycle to pay', icon: 'cal' },
  { label: 'Review register', sub: 'Price time · clear exceptions', icon: 'table' },
  { label: 'Approve', sub: 'A second person signs', icon: 'shield' },
  { label: 'Process & pay', sub: 'Lock & release files', icon: 'zap' },
]

/**
 * Process Payroll — the run wizard.
 *
 * period → review (live register + exception gates) → approve (second person) →
 * process (register locked, stubs + provider files released). Every transition is
 * one undoable reducer transaction, and the register that gets locked is re-priced
 * at the moment of processing rather than trusting a stale preview.
 */
export default function ProcessPayrollView() {
  const state = useStore()
  const { settings, actions, payRuns, payProfiles, staff } = state
  const toast = useToast()
  const payroll = settings.payroll
  const [step, setStep] = useState(0)
  const [periodId, setPeriodId] = useState(() => periodFor(payroll, todayISO())?.id || null)
  const [who, setWho] = useState('Prateek Kiran')
  const [reviewIssue, setReviewIssue] = useState(null) // Review Register drill-down

  const periods = useMemo(() => periodFromId(payroll, periodId, { back: 24, forward: 12 }), [payroll, periodId])
  const existing = useMemo(
    () => Object.values(payRuns || {}).filter((r) => r.periodId === periodId && r.status !== 'voided'),
    [payRuns, periodId],
  )
  const included = useMemo(() => eligibleProfiles(state).map((p) => p.staffId), [state])
  const preview = useMemo(
    () => (periods ? computeRun(state, periods, { included }) : null),
    [state, periods, included],
  )
  const lastProcessed = useMemo(() => {
    const done = Object.values(payRuns || {}).filter((r) => r.locked).sort((a, b) => (a.processedAt || 0) - (b.processedAt || 0))
    return done[done.length - 1] || null
  }, [payRuns])

  // Changing period re-opens the wizard at the stage that period's run is in —
  // an existing run is resumed, never duplicated.
  useEffect(() => {
    const found = Object.values(payRuns || {}).find((r) => r.periodId === periodId && r.status !== 'voided')
    setStep(found ? (found.status === 'processed' ? 3 : found.status === 'approved' ? 2 : 1) : 0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodId])

  const createRun = () => {
    if (!preview) return
    const res = actions.createPayRun(periods, { included, who, autoApproveSheets: true })
    if (res?.ok) {
      toast({ message: res.msg, kind: res.gate?.blockers?.length ? 'warn' : 'ok' })
      setStep(1)
    } else toast({ message: res?.msg || 'Could not create the run', kind: 'warn' })
  }

  const run = existing[0] || null

  // Default the approver to somebody other than the preparer. A segregation-of-duties
  // control is theatre if the app pre-selects the one person who cannot sign.
  useEffect(() => {
    if (!run || !payroll.approvals.separateApprover || who !== run.preparedBy) return
    const other = (staff || []).find((s) => s.name !== run.preparedBy)
    if (other) setWho(other.name)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run?.id])
  const gate = run?.gate || preview?.gate

  const approve = () => {
    const res = actions.payrollRun(run.id, 'approve', { who })
    toast({ message: res.msg, kind: res.ok ? 'ok' : 'warn' })
    if (res.ok) setStep(2)
  }
  const process = () => {
    const res = actions.payrollRun(run.id, 'process', { who })
    toast({ message: res.msg, kind: res.ok ? 'ok' : 'warn' })
    if (res.ok) setStep(3)
  }
  const voidRun = () => {
    const res = actions.payrollRun(run.id, 'void', { who, note: 'Voided from the payroll wizard before processing' })
    toast({ message: res.msg, kind: res.ok ? 'ok' : 'warn' })
    setStep(0)
  }

  const downloadStubs = () => {
    if (!run) return
    const parts = run.included.map((id) => {
      const stub = stubFor(state, run, id)
      return stub ? stubHtml(stub) : ''
    }).filter(Boolean)
    if (!parts.length) return toast({ message: 'No stubs to build for this run', kind: 'warn' })
    const html = parts.join('<div style="page-break-after:always"></div>')
    actions.recordPayExport({ runId: run.id, periodId: run.periodId, kind: 'pay_stubs', fileName: `pay-stubs-${run.no}.html`, rows: parts.length, note: 'Printable pay stubs (draft)' })
    download(`pay-stubs-${run.no}.html`, html, 'text/html;charset=utf-8')
    toast({ message: `${parts.length} pay stubs opened as a printable document — browser printing does not transmit anything`, kind: 'ok' })
  }
  const downloadRegister = (kind) => {
    if (!run) return
    if (kind === 'csv') {
      download(`payroll-register-${run.no}.csv`, registerCsv(run, state), 'text/csv;charset=utf-8')
      actions.recordPayExport({ runId: run.id, periodId: run.periodId, kind: 'register_csv', fileName: `payroll-register-${run.no}.csv`, rows: run.lines.length })
    } else if (kind === 'xls') {
      downloadDoc(`payroll-register-${run.no}.xls`, specToXls(registerSpec(run, state)), 'application/vnd.ms-excel')
      actions.recordPayExport({ runId: run.id, periodId: run.periodId, kind: 'register_xls', fileName: `payroll-register-${run.no}.xls`, rows: run.lines.length })
    } else {
      downloadDoc(`payroll-register-${run.no}.pdf`, specToPdf(registerSpec(run, state)), 'application/pdf')
      actions.recordPayExport({ runId: run.id, periodId: run.periodId, kind: 'register_pdf', fileName: `payroll-register-${run.no}.pdf`, rows: run.lines.length })
    }
    toast({ message: `Payroll register exported as ${kind.toUpperCase()}`, kind: 'ok' })
  }

  const gateTone = gate && !gate.ok ? 'bad' : gate?.warnings?.length ? 'warn' : 'ok'

  return (
    <div className="sectionpage" data-testid="pay-process-sec" style={{ background: 'var(--bg)' }}>
      <SectionBar icon="dollar" title="Process Payroll" sub={
        lastProcessed
          ? `Last payroll processed on ${new Date(lastProcessed.processedAt).toLocaleDateString('en-US', { dateStyle: 'medium' })} · ${lastProcessed.no}`
          : 'Welcome to the Payroll Wizard — no payroll has been processed yet'
      }>
        <button className="btn btn-sm" data-testid="pay-undo" onClick={() => { actions.undo(); toast({ message: 'Undid the last payroll change', kind: 'ok' }) }} style={{ borderRadius: 10 }}>{Icon.undo({ size: 13 })} Undo</button>
      </SectionBar>

      <PayStepper steps={PHASES} step={step} maxStep={run ? 3 : step} onStep={setStep} />

      {/* ---------- phase 1: period ---------- */}
      {step === 0 && (
        <PhasePanel
          testId="pay-wizard-period"
          index={1} total={4} icon="cal" tone="accent"
          title="Select the payroll period"
          sub="Timesheets are pulled straight from the calendar — you choose which cycle to pay."
          guide={[
            'Pick the pay cycle you want to process — frequency, pay date and cutoff come from Payroll Setup.',
            `This period covers ${preview ? `${preview.gate.included.length} eligible employees and ${hrs(preview.totals.workedHours)} of worked time` : 'no time yet — pick a period first'}.`,
            'If a run already exists for the cycle, you will resume it instead of creating a duplicate.',
          ]}
          footer={
            <button className="btn btn-primary pay-next" data-testid="pay-period-next-step" onClick={() => (existing.length ? setStep(existing[0].status === 'processed' ? 3 : 1) : createRun())}>
              {existing.length ? 'Open existing run' : 'Next — build the register'} {Icon.chevronR({ size: 13 })}
            </button>
          }
        >
          <PeriodPicker value={periodId} onChange={setPeriodId} />
          <div className="pay-hint">
            Timesheets for this period are pulled from the calendar — {preview ? `${preview.gate.included.length} eligible employees, ${hrs(preview.totals.workedHours)} of worked time` : 'no period selected'}.
            Historical runs: {Object.values(payRuns || {}).filter((r) => r.locked).length} processed.
          </div>
          {existing.length > 0 && (
            <div className="pay-gate warn" data-testid="pay-existing-run">
              <span className="ic">{Icon.info({ size: 15 })}</span>
              <div>
                <b>{existing[0].no} already exists for this period ({RUN_STATUS_LABEL[existing[0].status]})</b>
                <div className="why">Opening it resumes the wizard instead of creating a second run for the same cycle.</div>
              </div>
            </div>
          )}
        </PhasePanel>
      )}

      {/* ---------- phase 2: review ---------- */}
      {step >= 1 && run && (
        <>
          <PhasePanel
            testId="pay-wizard-review"
            index={2} total={4} icon="table" tone={gateTone}
            title="Review the register"
            sub={`${run.no} · ${run.periodStart} → ${run.periodEnd} · pay date ${run.payDate} · prepared by ${run.preparedBy}`}
            guide={[
              'Check gross-to-net for every employee below — the register is priced live from the ledgers.',
              'Blockers stop the run from being approved; exceptions need an approver’s eyes.',
              'Use “Show n affected employees” on any exception to open the Review Register and jump straight to the fix.',
            ]}
            footer={
              <>
                <button className="btn btn-primary pay-next" data-testid="pay-review-next" onClick={() => setStep(2)} disabled={gate && !gate.ok} title={gate && !gate.ok ? 'Clear the blockers first' : 'Continue to approval'}>
                  Continue to approval {Icon.chevronR({ size: 13 })}
                </button>
                <span className="pay-hint" style={{ marginTop: 0, borderLeftWidth: 2 }}>
                  {gate && !gate.ok
                    ? `${gate.blockers.length} blocker(s) must be cleared before approval.`
                    : gate?.warnings?.length
                      ? `${gate.warnings.length} exception(s) to review — nothing is blocking.`
                      : 'All controls passed — ready for approval.'}
                </span>
              </>
            }
          >
            <div style={{ margin: '2px -2px 0' }}>
              <GateList gate={gate} onFilter={(g) => setReviewIssue(g)} />
            </div>
          </PhasePanel>

          <PayKpis testId="pay-run-kpis" items={[
            ['Employees', run.included.length, `${run.totals.deliveredHours.toFixed(1)} delivered hours`, 'pay-kpi-staff'],
            ['Gross pay', money(run.totals.grossCents, { cents: false }), hrs(run.totals.workedHours + run.totals.otHours), 'pay-kpi-gross'],
            ['Net pay', money(run.totals.netCents, { cents: false }), 'to disburse', 'pay-kpi-net'],
            ['Taxes withheld', money(run.totals.taxCents, { cents: false }), 'employee', 'pay-kpi-tax'],
            ['Employer cost', money(run.totals.employerCents, { cents: false }), 'taxes + benefits', 'pay-kpi-employer'],
            ['Total cost', money(run.totals.totalCostCents, { cents: false }), 'gross + employer', 'pay-kpi-cost'],
          ]} />

          <div className="pay-card" data-testid="pay-register-preview" style={{ marginTop: 0 }}>
            <div className="pay-card-head">
              <div>
                <b>Register preview · {run.no}</b>
                <div className="muted" style={{ fontSize: 12 }}>
                  {run.periodStart} → {run.periodEnd} · pay date {run.payDate} · prepared by {run.preparedBy}
                </div>
              </div>
              <div className="pay-actions">
                <button className="btn btn-sm" data-testid="pay-preview-csv" onClick={() => downloadRegister('csv')}>Register CSV</button>
                <button className="btn btn-sm" data-testid="pay-preview-xls" onClick={() => downloadRegister('xls')}>Excel</button>
                <button className="btn btn-sm" data-testid="pay-preview-pdf" onClick={() => downloadRegister('pdf')}>PDF</button>
              </div>
            </div>
            <div className="py-tbl" style={{ overflowX: 'auto', border: 0, boxShadow: 'none' }}>
              <div className="py-thead" style={{ gridTemplateColumns: '2fr 100px 92px 96px 92px 96px 92px 96px 40px' }}>
                <span>Employee</span><span>Payroll ID</span><span className="num">Hours</span><span className="num">OT hrs</span>
                <span className="num">Gross</span><span className="num">Taxes</span><span className="num">Net</span><span className="num">Employer</span><span />
              </div>
              {run.lines.map((l) => (
                <div key={l.staffId} className="py-trow" data-testid={`pay-run-row-${l.staffId}`} style={{ gridTemplateColumns: '2fr 100px 92px 96px 92px 96px 92px 96px 40px', minHeight: 52, cursor: 'default' }}>
                  <StaffCell staffId={l.staffId} sub={`${l.office} · ${l.classification}${l.classification === 'exempt' ? ' (unreviewed)' : ''}`} />
                  <span className="ln-code">{l.payrollId || '—'}</span>
                  <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{hrs(l.workedHours)}</span>
                  <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: l.otHours ? 'var(--warn, #b45309)' : 'inherit' }}>{l.otHours ? hrs(l.otHours) : '—'}</span>
                  <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{money(l.grossCents)}</span>
                  <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{money(l.taxCents)}</span>
                  <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 650 }}>{money(l.netCents)}</span>
                  <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{money(l.employerCents)}</span>
                  <button className="iconbtn" title="Exclude from this run" data-testid={`pay-exclude-${l.staffId}`} onClick={() => {
                    const res = actions.payrollRun(run.id, 'exclude', { staffId: l.staffId, who })
                    toast({ message: res.msg, kind: res.ok ? 'ok' : 'warn' })
                  }}>{Icon.x({ size: 12 })}</button>
                </div>
              ))}
            </div>
            <div className="pay-hint">
              Employees can be excluded from a draft run with the ✕ — they stay payable in a later off-cycle run. Approved or
              processed runs must be reopened deliberately before their employee list can change.
              {run.excluded?.length > 0 && <> <b>{run.excluded.length} excluded from this run.</b></>}
            </div>
          </div>
        </>
      )}

      {/* ---------- phase 3: approve ---------- */}
      {step === 2 && run && (
        <PhasePanel
          testId="pay-wizard-approve"
          index={3} total={4} icon="shield" tone={run.status === 'approved' ? 'ok' : 'accent'}
          title="Independent approval"
          sub="Payroll is a sensitive control: the person who prepared the run should not be the person who approves it."
          guide={[
            `Pick an approver other than ${run.preparedBy} — approval signs the register.`,
            'Review the totals one more time: net to disburse and total cost to the practice.',
            'Processing then locks the register — after that, corrections are off-cycle adjustments only.',
          ]}
          footer={
            <>
              <button className="btn btn-sm" onClick={() => setStep(1)}>{Icon.chevronL({ size: 13 })} Back to register</button>
              <button className="btn btn-primary pay-next" data-testid="pay-approve" onClick={approve} disabled={gate && !gate.ok} title={gate && !gate.ok ? 'Resolve blockers first' : 'Approve the register'}>
                {Icon.shield({ size: 13 })} Approve payroll
              </button>
            </>
          }
        >
          <label className="pay-field">
            <span>Approver</span>
            <select className="input" value={who} onChange={(e) => setWho(e.target.value)} data-testid="pay-approver">
              {(staff || []).map((s) => <option key={s.id} value={s.name}>{s.name} — {s.role}</option>)}
              <option value="Payroll admin">Payroll admin</option>
            </select>
          </label>
          <div className="pay-summary-mini">
            <div><span>Prepared by</span><b>{run.preparedBy}</b></div>
            <div><span>Net to disburse</span><b>{money(run.totals.netCents)}</b></div>
            <div><span>Total cost to practice</span><b>{money(run.totals.totalCostCents)}</b></div>
            <div><span>Status</span><b><StatusPill status={run.status} /></b></div>
          </div>
          {run.preparedBy === who && payroll.approvals.separateApprover && (
            <div className="pay-gate warn" data-testid="pay-sod-warning">
              <span className="ic">{Icon.alert({ size: 15 })}</span>
              <div><b>Segregation of duties</b><div className="why">You are the preparer — pick a different approver, or turn the control off deliberately in Payroll Setup.</div></div>
            </div>
          )}
          {gate && !gate.ok && <div className="pay-hint bad">{gate.blockers.length} blocker(s) must be cleared before this run can be approved.</div>}
        </PhasePanel>
      )}

      {/* ---------- phase 4: process ---------- */}
      {step >= 2 && run && run.status !== 'processed' && (
        <PhasePanel
          testId="pay-wizard-process"
          index={4} total={4} icon="zap" tone={run.status === 'approved' ? 'ok' : 'warn'}
          title="Process & release"
          sub="Processing re-prices every employee from the live ledgers, locks the register, and marks the timesheets as processed."
          guide={[
            'Nothing is transmitted automatically — the provider file, bank file and stubs are downloads you hand off yourself.',
            'The register is re-priced at the moment of locking, so the locked figures match the live ledgers.',
            'After locking, download the artifacts below and hand them to your payroll provider and bank.',
          ]}
          footer={
            <>
              <button className="btn btn-primary pay-next" data-testid="pay-process" onClick={process} disabled={run.status !== 'approved'}>
                {Icon.zap({ size: 13 })} Process payroll — lock {money(run.totals.netCents)} net
              </button>
              {run.status === 'draft' && <span className="pay-hint" style={{ marginTop: 0, borderLeftWidth: 2 }}>Approval is required first — finish phase 3.</span>}
              <button className="btn btn-sm" data-testid="pay-void-run" onClick={voidRun}>Void this run</button>
            </>
          }
        >
          <div className="pay-summary-mini">
            <div><span>Status</span><b><StatusPill status={run.status} /></b></div>
            <div><span>Approved by</span><b>{run.approvedBy || '—'}</b></div>
            <div><span>Employees</span><b>{run.included.length}</b></div>
            <div><span>Net to lock</span><b>{money(run.totals.netCents)}</b></div>
          </div>
        </PhasePanel>
      )}

      {run && run.status === 'processed' && (
        <PhasePanel
          testId="pay-wizard-done"
          index={4} total={4} icon="checkCircle" tone="ok"
          title={`${run.no} processed and locked`}
          sub="Everything is paid and frozen — hand off the artifacts below to your provider and bank."
          guide={[
            'Download the pay stubs and hand them to employees — printing or sharing never transmits anything by itself.',
            'The QuickBooks payroll file and GL journal are what your accountant and provider import.',
            'The ACH file is a local draft — validate it with your bank before it goes anywhere near one.',
          ]}
        >
          <div className="pay-summary-mini">
            <div><span>Processed</span><b>{new Date(run.processedAt).toLocaleString()}</b></div>
            <div><span>Processed by</span><b>{run.processedBy || '—'}</b></div>
            <div><span>Net disbursed</span><b>{money(run.totals.netCents)}</b></div>
            <div><span>Pay date</span><b>{run.payDate}</b></div>
          </div>
          <div className="pay-actions">
            <button className="btn btn-primary pay-next" data-testid="pay-stubs" onClick={downloadStubs}>{Icon.download({ size: 13 })} Pay stubs</button>
            <button className="btn btn-sm" data-testid="pay-provider-file" onClick={() => {
              download(`quickbooks-payroll-${run.no}.csv`, qboCsv(run, state), 'text/csv;charset=utf-8')
              actions.recordPayExport({ runId: run.id, periodId: run.periodId, kind: 'qbo_payroll', fileName: `quickbooks-payroll-${run.no}.csv`, rows: run.totals.staff, totalCents: run.totals.grossCents })
              toast({ message: 'Provider export built — review it in QuickBooks Payroll before handing it over', kind: 'ok' })
            }}>{Icon.file({ size: 12 })} QuickBooks payroll file</button>
            <button className="btn btn-sm" data-testid="pay-gl-journal" onClick={() => {
              download(`payroll-journal-${run.no}.csv`, payrollCsv(glJournalRows(run, state)), 'text/csv;charset=utf-8')
              actions.recordPayExport({ runId: run.id, periodId: run.periodId, kind: 'gl_journal', fileName: `payroll-journal-${run.no}.csv`, rows: 5 })
            }}>{Icon.file({ size: 12 })} GL journal</button>
            <button className="btn btn-sm" data-testid="pay-ach" onClick={() => {
              download(`payroll-ach-${run.no}.ach`, achFile(run, state), 'text/plain;charset=utf-8')
              actions.recordPayExport({ runId: run.id, periodId: run.periodId, kind: 'ach_draft', fileName: `payroll-ach-${run.no}.ach`, rows: run.totals.staff, note: 'NACHA-shaped local draft — not bank-validated' })
              toast({ message: 'ACH draft downloaded — this file has not been validated by a bank and must not be uploaded as-is', kind: 'warn' })
            }}>{Icon.download({ size: 12 })} ACH draft (review)</button>
          </div>
          <div className="pay-hint">
            Processed registers are immutable by design. Corrections go through an off-cycle adjustment run rather than editing history —
            that is what makes the audit trail worth anything.
          </div>
        </PhasePanel>
      )}

      {/* Review Register drill-down — "Show n affected employees" */}
      {reviewIssue && (
        <ReviewRegisterModal issue={reviewIssue} run={run} onClose={() => setReviewIssue(null)} />
      )}
    </div>
  )
}
