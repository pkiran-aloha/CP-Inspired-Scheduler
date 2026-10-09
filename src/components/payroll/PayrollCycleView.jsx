import React, { useMemo, useState } from 'react'
import { useStore } from '../../state/store'
import { SectionBar } from '../NavRail'
import { Icon } from '../../ui/Icons'
import { useToast } from '../../ui/Toast'
import InfoTip from '../../ui/InfoTip'
import {
  money, hrs, PayKpis, PeriodPicker, StatusPill, PaySubNav,
  PAY_PHASES, runProgress, groupGate,
} from './PayrollCommon'
import ReviewRegisterModal from './ReviewRegisterModal'
import {
  PAY_FREQUENCIES, RUN_STATUS_LABEL, computeRun, duplicatePayrollIds, eligibleProfiles,
  periodFor, sheetFor, periodFromId,
} from '../../lib/payroll'
import { todayISO } from '../../lib/date'

/**
 * Payroll — the cycle overview (the landing page for the Payroll section).
 *
 * Payroll is a four-phase process, so the section opens on the process rather
 * than dropping the user into the middle of a wizard. This page answers, in one
 * screen: which cycle am I in, how far through the four phases is it, what is
 * stopping it, and what do I do next. Every phase card and every module tile is
 * a real link into the screen that owns that step.
 */

/** The live checks on the selected period, in the words the register uses. */
function CheckSummary({ gate, onShow }) {
  const blockers = gate?.blockers || []
  const warnings = gate?.warnings || []
  const blocked = blockers.length > 0
  const staffCount = new Set([...blockers, ...warnings].flatMap((g) => (g.staffIds ? g.staffIds : g.staffId ? [g.staffId] : []))).size
  const tone = blocked ? 'bad' : warnings.length ? 'warn' : 'ok'
  const icon = blocked ? Icon.ban : warnings.length ? Icon.alert : Icon.checkCircle
  const headline = blocked
    ? `${blockers.length} blocker${blockers.length === 1 ? '' : 's'} stop this cycle`
    : warnings.length
      ? `${warnings.length} exception${warnings.length === 1 ? '' : 's'} to review, none blocking`
      : 'All payroll controls passed'
  return (
    <div className={`pay-gate ${tone}`} data-testid="pay-cycle-checks">
      <span className="ic">{icon({ size: 15 })}</span>
      <div style={{ width: '100%' }}>
        <b data-testid="pay-cycle-checks-head">{headline}</b>
        {(blockers.length > 0 || warnings.length > 0) && (
          <div className="why">
            {[...blockers, ...warnings].slice(0, 3).map((g, i) => <div key={i}>· {g.why}</div>)}
            {blockers.length + warnings.length > 3 && <div>· … and {blockers.length + warnings.length - 3} more</div>}
          </div>
        )}
        {staffCount > 0 && (
          <button className="pay-link" data-testid="pay-cycle-show-affected" onClick={onShow}>
            Show {staffCount} affected employee{staffCount === 1 ? '' : 's'} →
          </button>
        )}
      </div>
    </div>
  )
}

/** One of the four phases, as a card on the landing page. */
function PhaseCard({ phase, index, state, detail, cta, onOpen }) {
  return (
    <button
      className={`pay-pcard ${state}`}
      data-testid={`pay-cycle-phase-${index}`}
      onClick={onOpen}
      title={`${phase.label}: ${phase.sub}`}
    >
      <span className={`pay-pcard-ic ${state}`}>
        {state === 'done' ? Icon.check({ size: 15 }) : Icon[phase.icon] ? Icon[phase.icon]({ size: 15 }) : Icon.spark({ size: 15 })}
      </span>
      <span className="pay-pcard-t">
        <span className="pay-pcard-n">Phase {index + 1}{state === 'done' ? ' · done' : state === 'on' ? ' · you are here' : ''}</span>
        <b>{phase.label}</b>
        <i>{detail || phase.blurb}</i>
        {cta && <span className="pay-pcard-cta">{cta} {Icon.chevronR({ size: 11 })}</span>}
      </span>
    </button>
  )
}

/** The module tiles: every other payroll screen with the live number that matters. */
function ModuleTile({ icon, label, stat, sub, testId, onOpen }) {
  return (
    <button className="pay-tile" data-testid={testId} onClick={onOpen}>
      <span className="pay-tile-ic">{Icon[icon]({ size: 15 })}</span>
      <span className="pay-tile-t">
        <b>{label}</b>
        <i>{stat}</i>
        {sub && <small>{sub}</small>}
      </span>
      {Icon.chevronR({ size: 13 })}
    </button>
  )
}

export default function PayrollCycleView() {
  const state = useStore()
  const { settings, actions, payRuns, payProfiles, staff, payExports } = state
  const toast = useToast()
  const payroll = settings.payroll

  const [periodId, setPeriodId] = useState(() => periodFor(payroll, todayISO())?.id || null)
  const [issue, setIssue] = useState(null)

  const period = useMemo(() => periodFromId(payroll, periodId, { back: 24, forward: 12 }), [payroll, periodId])
  const included = useMemo(() => eligibleProfiles(state).map((p) => p.staffId), [state])
  const preview = useMemo(() => (period ? computeRun(state, period, { included }) : null), [state, period, included])

  // The run for the selected cycle, if the wizard has already started one.
  const run = useMemo(
    () => Object.values(payRuns || {}).find((r) => r.periodId === periodId && r.status !== 'voided') || null,
    [payRuns, periodId],
  )
  const progress = runProgress(run)
  // With a run on file the register — not a fresh preview — is the source of
  // truth: a preview of an already-run period would flag the run itself as a
  // duplicate and re-warn about timesheets it has already processed.
  const live = run ? { totals: run.totals, gate: run.gate } : preview
  const gate = live?.gate

  const runs = useMemo(() => Object.values(payRuns || {}).sort((a, b) => (b.periodStart < a.periodStart ? -1 : 1)), [payRuns])
  const processed = runs.filter((r) => r.locked)
  const lastProcessed = processed[0] || null

  const sheets = useMemo(() => {
    const list = (payProfiles || []).filter((p) => p.include).map((p) => sheetFor(state, p.staffId, periodId))
    return { submitted: list.filter((s) => s.status === 'submitted').length, open: list.filter((s) => s.status === 'open').length, total: list.length }
  }, [state, payProfiles, periodId])

  const idIssues = useMemo(() => {
    const missing = (payProfiles || []).filter((p) => p.include && !String(p.payrollId || '').trim()).length
    return { missing, dupes: duplicatePayrollIds(payProfiles || []).length }
  }, [payProfiles])

  const qboPending = useMemo(
    () => Object.values(payExports || {}).filter((e) => (e.kind === 'qbo_payroll' || e.kind === 'qbo_export') && e.status !== 'reviewed').length,
    [payExports],
  )

  const go = (section, patch = {}) => actions.setUI({ section, ...patch })
  // "Show n affected employees" on the landing opens the same Review Register the
  // wizard does — grouped per issue code, so the affected staff are listed, not a
  // bare run-level explanation.
  const showFirstIssue = () => {
    const b = groupGate(gate?.blockers || [], 'bad')
    const w = groupGate(gate?.warnings || [], 'warn')
    const first = b[0] || w[0]
    if (first) setIssue(first)
  }
  const openWizard = (phase) => go('pay-process', { payPhase: phase })

  // Where the cycle stands, phase by phase.
  const phaseState = (i) => {
    if (run?.status === 'processed') return 'done'
    if (i < progress.done) return 'done'
    if (i === progress.step) return 'on'
    return 'todo'
  }
  const phaseDetail = [
    period ? `${period.start} → ${period.end} · pay date ${period.payDate}` : 'No period selected',
    run ? `${run.no} · ${run.included.length} employees · ${money(run.totals.netCents, { cents: false })} net` : 'Register is built in this phase',
    run?.approvedBy ? `Signed by ${run.approvedBy}` : 'Waiting for an independent approver',
    run?.status === 'processed' ? `Locked ${new Date(run.processedAt).toLocaleDateString('en-US', { dateStyle: 'medium' })} · ${money(run.totals.netCents, { cents: false })} net` : 'Locks the register and releases the files',
  ]
  const phaseCta = ['Open phase 1', 'Open the register', 'Open approval', run?.status === 'processed' ? 'Open the locked run' : 'Open processing']

  const cta = !run
    ? { label: 'Start payroll (phase 1)', testId: 'pay-cycle-cta', phase: 0, hint: 'Select the cycle, then build the register' }
    : run.status === 'processed'
      ? { label: 'Open the locked register', testId: 'pay-cycle-cta', phase: 3, hint: `${run.no} is paid and locked. Download the files again here` }
      : {
        label: run.status === 'approved' ? 'Continue to processing' : 'Continue to the register',
        testId: 'pay-cycle-cta',
        phase: progress.step,
        hint: `${RUN_STATUS_LABEL[run.status]}, ${run.no}. Next: ${PAY_PHASES[progress.step].label} (phase ${progress.step + 1} of ${PAY_PHASES.length})`,
      }

  return (
    <div className="sectionpage" data-testid="pay-cycle-sec" style={{ background: 'var(--bg)' }}>
      <SectionBar icon="badge" title="Payroll" sub={
        lastProcessed
          ? `Last payroll processed on ${new Date(lastProcessed.processedAt).toLocaleDateString('en-US', { dateStyle: 'medium' })} · ${lastProcessed.no}`
          : 'No payroll processed yet'
      } wiki="payroll" info={<>
        Payroll runs in four phases: period, register, approval and processing. The register locks only in phase 4, after an
        independent approval. Nothing on this page moves money.
      </>}>
        <button className="btn btn-sm" data-testid="pay-cycle-runs" onClick={() => go('pay-runs')} style={{ borderRadius: 10 }}>{Icon.rows({ size: 13 })} Pay runs</button>
      </SectionBar>

      <PaySubNav />

      {/* ---- the cycle hero: status, the four phases, the next action ---- */}
      <div className="pay-hero" data-testid="pay-cycle-hero">
        <div className="pay-hero-main">
          <span className="pay-hero-eyebrow">Current pay cycle</span>
          <h3>{period ? `${period.start} → ${period.end}` : 'No pay period configured'}</h3>
          <div className="pay-hero-meta">
            <span className="pay-chipsel">{PAY_FREQUENCIES[period?.frequency]?.label || '—'}</span>
            <span>Pay date <b>{period?.payDate || '—'}</b></span>
            <span>Timesheet cutoff <b>{period?.cutoff || '—'}</b></span>
            <span><b>{gate?.included?.length ?? 0}</b> eligible employees</span>
            <span><b>{hrs(live?.totals.workedHours || 0)}</b> worked time</span>
          </div>
          <div className="pay-hero-picker">
            <PeriodPicker value={periodId} onChange={setPeriodId} label="Payroll cycle" />
          </div>
        </div>
        <div className="pay-hero-side">
          <div className="pay-hero-status">
            {run ? <StatusPill status={run.status} /> : <span className="pay-pill neutral" data-testid="pay-cycle-norun">Not started</span>}
            <span className="muted" data-testid="pay-cycle-hint">{cta.hint}</span>
          </div>
          <button className="btn btn-primary pay-next" data-testid={cta.testId} onClick={() => openWizard(cta.phase)}>
            {!run ? Icon.zap({ size: 13 }) : Icon.chevronR({ size: 13 })} {cta.label}
          </button>
          {run && run.status !== 'processed' && (
            <span className="pay-hero-note">
              Phase {progress.step + 1} of {PAY_PHASES.length} · {PAY_PHASES[progress.step].label}
            </span>
          )}
          {run?.status === 'processed' && <span className="pay-hero-note">All {PAY_PHASES.length} phases complete. Register locked.</span>}
        </div>
      </div>

      {/* ---- the four phases, always visible, always clickable ---- */}
      <div className="pay-phases-grid" data-testid="pay-cycle-phases">
        {PAY_PHASES.map((p, i) => (
          <PhaseCard
            key={p.id}
            phase={p}
            index={i}
            state={phaseState(i)}
            detail={phaseDetail[i]}
            cta={phaseCta[i]}
            onOpen={() => openWizard(i)}
          />
        ))}
      </div>

      {/* ---- live numbers for this cycle ---- */}
      <PayKpis testId="pay-cycle-kpis" items={[
        ['Employees', gate?.included?.length ?? run?.included?.length ?? 0, `${hrs(live?.totals.deliveredHours || 0)} clinical`, 'pay-cycle-kpi-staff'],
        ['Gross pay', money(live?.totals.grossCents || 0, { cents: false }), hrs((live?.totals.workedHours || 0) + (live?.totals.otHours || 0)), 'pay-cycle-kpi-gross'],
        ['Net pay', money(live?.totals.netCents || 0, { cents: false }), run ? 'on the register' : 'to disburse', 'pay-cycle-kpi-net'],
        ['Total cost', money(live?.totals.totalCostCents || 0, { cents: false }), 'gross + employer', 'pay-cycle-kpi-cost'],
      ]} />

      <div className="pay-landing-grid">
        <div className="pay-card pay-card-flat" data-testid="pay-cycle-checks-card">
          <div className="pay-card-head">
            <div>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <b>Checks on this cycle {run ? `· ${run.no}` : ''}</b>
                <InfoTip label="cycle checks" wiki="payroll" testid="pay-cycle-checks-info">
                  Blockers stop approval. Exceptions are recorded on the run for the approver. Each affected employee is listed with the fix.
                </InfoTip>
              </span>
              <div className="muted" style={{ fontSize: 12 }} data-testid="pay-cycle-checks-src">
                {run
                  ? `As recorded on ${run.no}'s register (re-checked when it was approved or processed).`
                  : 'Live from the calendar, timesheets, pay profiles and setup. Rechecked each time this page opens.'}
              </div>
            </div>
            <button className="btn btn-sm" data-testid="pay-cycle-open-register" onClick={() => openWizard(run ? progress.step : 0)}>
              {Icon.table({ size: 12 })} Open the register
            </button>
          </div>
          <CheckSummary gate={gate} onShow={showFirstIssue} />
        </div>

        <div className="pay-card pay-card-flat" data-testid="pay-cycle-recent">
          <div className="pay-card-head">
            <div>
              <b>Recent pay runs</b>
              <div className="muted" style={{ fontSize: 12 }}>{processed.length} processed on file</div>
            </div>
            <button className="btn btn-sm" data-testid="pay-cycle-all-runs" onClick={() => go('pay-runs')}>All runs</button>
          </div>
          {runs.length === 0 ? (
            <div className="py-empty" style={{ padding: 18, textAlign: 'center' }} data-testid="pay-cycle-runs-empty">
              <b>No pay runs yet</b>
              <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>Start with phase 1. The register is built from the calendar.</div>
            </div>
          ) : (
            <div className="pay-lines">
              {runs.slice(0, 4).map((r) => (
                <button key={r.id} className="pay-line pay-run-row" style={{ gridTemplateColumns: '1fr auto auto' }} data-testid={`pay-cycle-run-${r.no}`} onClick={() => go('pay-runs', { payrollFocus: { runId: r.id } })}>
                  <span><b>{r.no}</b> <span className="muted">· {r.periodStart} → {r.periodEnd}</span></span>
                  <span className="r">{money(r.totals.netCents, { cents: false })} net</span>
                  <StatusPill status={r.status} />
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ---- the rest of the payroll module ---- */}
      <h4 className="pay-h4" style={{ margin: '18px 16px 8px' }}>Payroll modules</h4>
      <div className="pay-tiles" data-testid="pay-cycle-modules">
        <ModuleTile
          icon="rows" label="Pay Runs" testId="pay-tile-runs"
          stat={processed.length ? `${processed.length} processed · last ${lastProcessed?.periodEnd}` : 'No processed runs yet'}
          sub="Read, reprint and download locked registers"
          onOpen={() => go('pay-runs')}
        />
        <ModuleTile
          icon="clipboard" label="Timesheet Submission" testId="pay-tile-timesheets"
          stat={`${sheets.submitted} submitted · ${sheets.open} open of ${sheets.total}`}
          sub="Approve time before it reaches the register"
          onOpen={() => go('pay-timesheets')}
        />
        <ModuleTile
          icon="badge" label="Payroll ID Mapping" testId="pay-tile-idmap"
          stat={idIssues.dupes ? `${idIssues.dupes} duplicate ID group(s)` : `${idIssues.missing} missing payroll ID(s)`}
          sub="Provider IDs, rates, offices and exempt reviews"
          onOpen={() => go('pay-idmap')}
        />
        <ModuleTile
          icon="file" label="Payroll Summary" testId="pay-tile-summary"
          stat={lastProcessed ? `Last locked ${lastProcessed.periodStart} → ${lastProcessed.periodEnd}` : 'Cost per delivered hour'}
          sub="Period cost, cost centres and earning codes"
          onOpen={() => go('pay-summary')}
        />
        <ModuleTile
          icon="dollar" label="QuickBooks Payroll" testId="pay-tile-qbo"
          stat={qboPending ? `${qboPending} export(s) waiting for review` : 'No exports waiting review'}
          sub="Build and hand off the provider file"
          onOpen={() => go('pay-qbo')}
        />
        <ModuleTile
          icon="shield" label="Payroll Setup" testId="pay-tile-setup"
          stat={`${PAY_FREQUENCIES[payroll.frequency]?.label || '—'} · ${payroll.approvals.separateApprover ? 'two-person approval' : 'single approver'}`}
          sub="Cycles, overtime, rounding and approval controls"
          onOpen={() => go('pay-setup')}
        />
      </div>

      {issue && <ReviewRegisterModal issue={issue} run={run} onClose={() => setIssue(null)} />}
    </div>
  )
}
