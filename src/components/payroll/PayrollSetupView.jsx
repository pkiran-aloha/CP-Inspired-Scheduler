import React, { useState } from 'react'
import { useStore } from '../../state/store'
import { SectionBar } from '../NavRail'
import { Icon } from '../../ui/Icons'
import { useToast } from '../../ui/Toast'
import { money } from './PayrollCommon'
import { EARNING_CODES, PAY_FREQUENCIES, WORKED_CODES, defaultPayrollSettings } from '../../lib/payroll'
import { periodsFor } from '../../lib/payroll'

const FREQ = ['weekly', 'biweekly', 'semimonthly', 'monthly']
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

function Section({ title, sub, children, testId }) {
  return (
    <div className="pay-card" data-testid={testId}>
      <div className="pay-card-head"><div><b>{title}</b>{sub && <div className="muted" style={{ fontSize: 12 }}>{sub}</div>}</div></div>
      {children}
    </div>
  )
}

/**
 * Payroll Setup — the policy screen.
 *
 * The controls here are the ones an auditor asks about: the workweek definition,
 * overtime rule, rounding policy, cancellation decision table, who must approve
 * what, and the withholding tables behind the estimates. Nothing here is a
 * compliance guarantee — the screen says so, because it should.
 */
export default function PayrollSetupView() {
  const { settings, actions, staff } = useStore()
  const toast = useToast()
  const payroll = settings.payroll || defaultPayrollSettings()
  const [tax, setTax] = useState(payroll.taxes)
  const [stateRate, setStateRate] = useState('CA')

  const set = (patch, msg) => {
    actions.payrollSettings(patch)
    if (msg) toast({ message: msg, kind: 'ok' })
  }

  const nextPeriods = periodsFor(payroll, payroll.anchor, { back: 0, forward: 3 })

  return (
    <div className="sectionpage" data-testid="pay-setup-sec" style={{ background: 'var(--bg)' }}>
      <SectionBar icon="clipboard" title="Payroll Setup" sub={`${PAY_FREQUENCIES[payroll.frequency].label} cycles · workweek starts ${DAYS[payroll.workWeekStart]} · overtime after ${payroll.otAfterHours} h at ${payroll.otMultiplier}×`}>
        <button className="btn btn-sm" data-testid="pay-setup-reset" onClick={() => { set(defaultPayrollSettings(), 'Payroll policy reset to the shipped defaults'); setTax(defaultPayrollSettings().taxes) }}>Reset to defaults</button>
      </SectionBar>

      <div className="batch-strip" style={{ margin: 16, padding: '12px 16px', background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 12 }}>
        <span className="muted">
          This workspace computes payroll locally. Tax and withholding tables are <b>editable estimates</b>, not a filing engine, and nothing
          here is transmitted to a bank, a provider or a tax authority. Have the policy below reviewed by your accountant or payroll provider.
        </span>
      </div>

      <div className="pay-cols">
        <Section title="Pay cycle" sub="The cycle drives periods, cutoffs and pay dates" testId="pay-setup-cycle">
          <div className="pay-form-grid">
            <label className="pay-field"><span>Frequency</span>
              <select className="input" value={payroll.frequency} data-testid="pay-setup-frequency" onChange={(e) => set({ frequency: e.target.value, anchor: undefined }, 'Pay frequency updated — periods re-cut from the anchor')}>
                {FREQ.map((f) => <option key={f} value={f}>{PAY_FREQUENCIES[f].label} ({PAY_FREQUENCIES[f].periods}/yr)</option>)}
              </select>
            </label>
            <label className="pay-field"><span>Anchor period start</span>
              <input className="input" type="date" value={payroll.anchor} data-testid="pay-setup-anchor" onChange={(e) => set({ anchor: e.target.value })} />
            </label>
            <label className="pay-field"><span>Days from period end to pay date</span>
              <input className="input" type="number" min="0" max="30" value={payroll.payLagDays} data-testid="pay-setup-lag" onChange={(e) => set({ payLagDays: Number(e.target.value) })} />
            </label>
          </div>
          <div className="pay-lines" style={{ marginTop: 10 }}>
            <div className="pay-line head" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}><span>Period</span><span>Timesheet cutoff</span><span>Pay date</span></div>
            {nextPeriods.map((p) => (
              <div key={p.id} className="pay-line" style={{ gridTemplateColumns: '1fr 1fr 1fr' }} data-testid={`pay-setup-period-${p.id}`}>
                <span>{p.start} → {p.end}</span><span className="muted">{p.cutoff}</span><span>{p.payDate}</span>
              </div>
            ))}
          </div>
        </Section>

        <Section title="Overtime & timekeeping" sub="FLSA is a workweek test, so the workweek is a policy decision" testId="pay-setup-ot">
          <div className="pay-form-grid">
            <label className="pay-field"><span>Workweek starts</span>
              <select className="input" value={payroll.workWeekStart} data-testid="pay-setup-workweek" onChange={(e) => set({ workWeekStart: Number(e.target.value) }, 'Workweek redefined — overtime is recalculated per week')}>
                {DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
              </select>
            </label>
            <label className="pay-field"><span>Overtime after (hours)</span>
              <input className="input" type="number" min="1" max="60" value={payroll.otAfterHours} data-testid="pay-setup-otafter" onChange={(e) => set({ otAfterHours: Number(e.target.value) })} />
            </label>
            <label className="pay-field"><span>Overtime multiplier</span>
              <input className="input" type="number" min="1" step="0.1" value={payroll.otMultiplier} data-testid="pay-setup-otmult" onChange={(e) => set({ otMultiplier: Number(e.target.value) })} />
            </label>
            <label className="pay-field"><span>Time rounding</span>
              <select className="input" value={payroll.rounding.mode} data-testid="pay-setup-rounding" onChange={(e) => set({ rounding: { ...payroll.rounding, mode: e.target.value } }, e.target.value === 'none' ? 'Rounding disabled — time is paid exactly as recorded' : 'Rounding enabled — the run gate will warn on every payroll')}>
                <option value="none">None — pay exact minutes</option>
                <option value="nearest">Nearest 15 minutes</option>
              </select>
            </label>
          </div>
          <div className="pay-hint">
            Federal overtime is owed after {payroll.otAfterHours} hours in a single workweek, not per pay period. A multiplier below 1.5× is
            blocked outright, and rounding is surfaced as an exception on every run because rounding that consistently favours the employer
            is where wage claims start.
          </div>
        </Section>
      </div>

      <div className="pay-cols">
        <Section title="Paid-duty policy" sub="Which non-treatment time the practice pays for" testId="pay-setup-duties">
          <div className="pay-toggles">
            {[
              ['payDrive', 'Drive time between clients', 'Compensable travel between work sites'],
              ['payAdmin', 'Documentation / admin', 'Notes, coordination and non-billable admin time'],
              ['payTraining', 'Training & meetings', 'Required training is generally hours worked'],
              ['payBreaks', 'Paid breaks', 'Short breaks are usually compensable; meal periods usually are not'],
            ].map(([key, label, why]) => (
              <label key={key} className="pay-toggle" data-testid={`pay-setup-${key}`}>
                <input type="checkbox" className="checkbox" checked={!!payroll[key]} onChange={(e) => set({ [key]: e.target.checked })} />
                <span><b>{label}</b><i>{why}</i></span>
              </label>
            ))}
          </div>
          <h4 className="pay-h4">Cancellation decision table</h4>
          <div className="pay-form-grid">
            <label className="pay-field"><span>Free-notice band (hours)</span>
              <input className="input" type="number" min="0" value={payroll.cancelPolicy.freeNoticeHours} data-testid="pay-setup-cancel-notice"
                onChange={(e) => set({ cancelPolicy: { ...payroll.cancelPolicy, freeNoticeHours: Number(e.target.value) } })} />
            </label>
            <label className="pay-field"><span>Pay inside the band (%)</span>
              <input className="input" type="number" min="0" max="100" value={payroll.cancelPolicy.payShortNoticePct} data-testid="pay-setup-cancel-pct"
                onChange={(e) => set({ cancelPolicy: { ...payroll.cancelPolicy, payShortNoticePct: Number(e.target.value) } })} />
            </label>
            <label className="pay-field"><span>No-show / at the door (%)</span>
              <input className="input" type="number" min="0" max="100" value={payroll.cancelPolicy.payNoShowPct} data-testid="pay-setup-cancel-noshow"
                onChange={(e) => set({ cancelPolicy: { ...payroll.cancelPolicy, payNoShowPct: Number(e.target.value) } })} />
            </label>
            <label className="pay-field"><span>Notice not recorded (%)</span>
              <input className="input" type="number" min="0" max="100" value={payroll.cancelPolicy.payUnknownNoticePct} data-testid="pay-setup-cancel-unknown"
                onChange={(e) => set({ cancelPolicy: { ...payroll.cancelPolicy, payUnknownNoticePct: Number(e.target.value) } })} />
            </label>
          </div>
          <div className="pay-hint">
            Cancellations are the single biggest source of disputes in session-based practices. Writing the bands down — and paying the same way
            every period — is what makes them defensible. Some states also require reporting-time pay; check yours.
          </div>
        </Section>

        <Section title="Controls & approval" sub="Segregation of duties is the point" testId="pay-setup-controls">
          <div className="pay-toggles">
            {[
              ['requireTimesheet', 'Require approved timesheets', 'Payroll flags employees whose timesheet is not approved'],
              ['requireApproval', 'Require an approval step', 'A run must be approved before it can be processed'],
              ['separateApprover', 'Approver must differ from preparer', 'Prevents one person from preparing and paying a run alone'],
              ['lockAfterProcess', 'Lock processed registers', 'Corrections go through off-cycle runs instead of edits'],
            ].map(([key, label, why]) => (
              <label key={key} className="pay-toggle" data-testid={`pay-setup-${key}`}>
                <input type="checkbox" className="checkbox" checked={!!payroll.approvals[key]} onChange={(e) => set({ approvals: { ...payroll.approvals, [key]: e.target.checked } })} />
                <span><b>{label}</b><i>{why}</i></span>
              </label>
            ))}
          </div>
          <div className="pay-toggles" style={{ marginTop: 6 }}>
            <label className="pay-toggle" data-testid="pay-setup-evv">
              <input type="checkbox" className="checkbox" checked={!!payroll.evvRequired} onChange={(e) => set({ evvRequired: e.target.checked })} />
              <span><b>Flag visits without verification (EVV)</b><i>Delivered visits lacking a signed, geo-stamped record raise an exception on the run</i></span>
            </label>
          </div>
        </Section>
      </div>

      <Section title="Earning codes" sub="Every paid duty is priced separately so the wage mix stays visible" testId="pay-setup-codes">
        <div className="py-tbl" style={{ overflowX: 'auto', border: 0, boxShadow: 'none' }}>
          <div className="py-thead" style={{ gridTemplateColumns: '90px 2fr 1.2fr 130px 120px 120px' }}>
            <span>Code</span><span>Description</span><span>Duty</span><span>Counts to OT</span><span>In regular rate</span><span>Taxable</span>
          </div>
          {EARNING_CODES.map((c) => (
            <div key={c.id} className="py-trow" data-testid={`pay-setup-code-${c.id}`} style={{ gridTemplateColumns: '90px 2fr 1.2fr 130px 120px 120px', minHeight: 48, cursor: 'default' }}>
              <span className="pay-code">{c.id}</span>
              <span>{c.label}</span>
              <span className="muted">{c.duty}</span>
              <span className={c.otEligible ? 'pay-flag ok' : 'pay-flag neutral'}>{c.otEligible ? 'yes — FLSA hours' : 'no'}</span>
              <span className={c.regularRate ? 'pay-flag ok' : 'pay-flag neutral'}>{c.regularRate ? 'yes' : 'no'}</span>
              <span className="muted">{c.taxable === false ? 'no (reimbursement)' : 'yes'}</span>
            </div>
          ))}
        </div>
        <div className="pay-hint">
          {WORKED_CODES.length} worked codes count toward the workweek. Nondiscretionary bonuses are spread into the regular rate before the
          overtime premium is calculated — that is the rule most manual payrolls get wrong.
        </div>
      </Section>

      <div className="pay-cols">
        <Section title="Withholding tables (estimates)" sub="Editable demo tables — verify with your provider" testId="pay-setup-taxes">
          <div className="pay-form-grid">
            <label className="pay-field"><span>Federal standard deduction</span>
              <input className="input" type="number" value={tax.federal.standardDeduction} data-testid="pay-setup-stdded"
                onChange={(e) => { const next = { ...tax, federal: { ...tax.federal, standardDeduction: Number(e.target.value) } }; setTax(next); set({ taxes: next }) }} />
            </label>
            <label className="pay-field"><span>Social Security rate</span>
              <input className="input" type="number" step="0.001" value={tax.fica.ssRate} data-testid="pay-setup-ssrate"
                onChange={(e) => { const next = { ...tax, fica: { ...tax.fica, ssRate: Number(e.target.value) } }; setTax(next); set({ taxes: next }) }} />
            </label>
            <label className="pay-field"><span>Social Security wage base</span>
              <input className="input" type="number" value={tax.fica.ssWageBase} data-testid="pay-setup-ssbase"
                onChange={(e) => { const next = { ...tax, fica: { ...tax.fica, ssWageBase: Number(e.target.value) } }; setTax(next); set({ taxes: next }) }} />
            </label>
            <label className="pay-field"><span>Medicare rate</span>
              <input className="input" type="number" step="0.0001" value={tax.fica.medicareRate} data-testid="pay-setup-medrate"
                onChange={(e) => { const next = { ...tax, fica: { ...tax.fica, medicareRate: Number(e.target.value) } }; setTax(next); set({ taxes: next }) }} />
            </label>
            <label className="pay-field"><span>SUTA rate</span>
              <input className="input" type="number" step="0.001" value={tax.suta.rate} data-testid="pay-setup-suta"
                onChange={(e) => { const next = { ...tax, suta: { ...tax.suta, rate: Number(e.target.value) } }; setTax(next); set({ taxes: next }) }} />
            </label>
            <label className="pay-field"><span>Workers' comp rate (of wages)</span>
              <input className="input" type="number" step="0.001" value={tax.workersComp.defaultRate} data-testid="pay-setup-wc"
                onChange={(e) => { const next = { ...tax, workersComp: { defaultRate: Number(e.target.value) } }; setTax(next); set({ taxes: next }) }} />
            </label>
          </div>
          <h4 className="pay-h4">State rate</h4>
          <div className="pay-form-grid">
            <label className="pay-field"><span>State</span>
              <select className="input" value={stateRate} onChange={(e) => setStateRate(e.target.value)} data-testid="pay-setup-state">
                {Object.keys(tax.state.byState).map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
            <label className="pay-field"><span>Flat rate</span>
              <input className="input" type="number" step="0.001" value={tax.state.byState[stateRate] ?? tax.state.defaultRate} data-testid="pay-setup-staterate"
                onChange={(e) => { const next = { ...tax, state: { ...tax.state, byState: { ...tax.state.byState, [stateRate]: Number(e.target.value) } } }; setTax(next); set({ taxes: next }) }} />
            </label>
          </div>
          <div className="pay-hint">
            Real payroll uses per-employee W-4 elections, state-specific schedules and reciprocal agreements. These flat tables produce a
            plausible <b>estimate</b> to keep the gross-to-net workflow honest; they are not a substitute for a payroll provider's calculation.
          </div>
        </Section>

        <Section title="General ledger mapping" sub="Where the journal exports land" testId="pay-setup-gl">
          <div className="pay-form-grid">
            {[['wages', 'Wage expense account'], ['taxes', 'Payroll tax expense'], ['benefits', 'Benefits expense'], ['net', 'Payroll clearing / cash']].map(([key, label]) => (
              <label key={key} className="pay-field"><span>{label}</span>
                <input className="input" value={payroll.glAccounts[key]} data-testid={`pay-setup-gl-${key}`}
                  onChange={(e) => set({ glAccounts: { ...payroll.glAccounts, [key]: e.target.value } })} />
              </label>
            ))}
          </div>
          <div className="pay-hint">
            The journal posts gross wages and employer taxes to expense, net pay to a clearing account, and withheld tax to a liability —
            the shape an accountant expects, with no bank or GL connection behind it.
          </div>
        </Section>
      </div>

      <Section title="Bank file identity" sub="Used by the ACH draft this workspace builds" testId="pay-setup-ach">
        <div className="pay-form-grid">
          <label className="pay-field"><span>Company name (16 chars)</span>
            <input className="input" value={payroll.ach?.companyName || ''} data-testid="pay-setup-ach-name" onChange={(e) => set({ ach: { ...(payroll.ach || {}), companyName: e.target.value.slice(0, 16) } })} />
          </label>
          <label className="pay-field"><span>Company ID</span>
            <input className="input" value={payroll.ach?.companyId || ''} data-testid="pay-setup-ach-id" onChange={(e) => set({ ach: { ...(payroll.ach || {}), companyId: e.target.value.slice(0, 10) } })} />
          </label>
          <label className="pay-field"><span>Originating bank routing</span>
            <input className="input" value={payroll.ach?.originatingBank || ''} data-testid="pay-setup-ach-bank" onChange={(e) => set({ ach: { ...(payroll.ach || {}), originatingBank: e.target.value.slice(0, 10) } })} />
          </label>
          <label className="pay-field"><span>Destination bank name</span>
            <input className="input" value={payroll.ach?.destinationBank || ''} data-testid="pay-setup-ach-dest" onChange={(e) => set({ ach: { ...(payroll.ach || {}), destinationBank: e.target.value.slice(0, 23) } })} />
          </label>
        </div>
      </Section>

      <div className="pay-card muted" data-testid="pay-setup-footer">
        Payroll policy affects real people's pay. This demo uses fictional staff data; before using any of these rules in production, have them
        reviewed by employment counsel and a payroll provider — especially overtime classification, cancellation pay and multi-state withholding.
        Payroll records must be retained for at least three years under the FLSA ({staff.length} staff profiles are on file here).
        <span className="pay-hint">Average base rate on file: {money(Math.round(((staff.reduce((t, s) => t + (s.payrollRate || 0), 0)) / Math.max(1, staff.length)) * 100))}/hour</span>
      </div>
    </div>
  )
}
