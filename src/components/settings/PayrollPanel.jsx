import React, { useState } from 'react'
import { Icon } from '../../ui/Icons'
import { Section, Row, TextField, NumberField, Select, Toggle, Banner, DataTable, IconButton, Seg } from './kit'
import { earningCodes, payrollGeneral, codeUsage, US_STATES } from '../../lib/settingsMasters'
import { PAY_FREQUENCIES } from '../../lib/payroll'
import { DAY_NAMES as WEEKDAYS } from '../../lib/date'

const KINDS = [
  { value: 'worked', label: 'Worked' },
  { value: 'cancellation', label: 'Cancellation' },
  { value: 'premium', label: 'Premium' },
  { value: 'leave', label: 'Leave' },
  { value: 'bonus', label: 'Bonus' },
  { value: 'expense', label: 'Reimbursement' },
]

export function PayrollPanel({ state, actions, toast, readOnly, sub }) {
  const { settings } = state
  const payroll = payrollGeneral(settings)
  if (sub === 'earning-codes') return <EarningCodes state={state} actions={actions} toast={toast} readOnly={readOnly} />
  if (sub === 'overtime') return <OvertimeRules state={state} actions={actions} toast={toast} readOnly={readOnly} payroll={payroll} />
  return <PayrollGeneral state={state} actions={actions} toast={toast} readOnly={readOnly} payroll={payroll} />
}

function savePatch(actions, toast, op, patch) {
  const res = actions.settingsOp(op, { patch })
  toast({ message: res.msg, kind: res.ok ? 'ok' : 'warn' })
  return res
}

function PayrollGeneral({ state, actions, toast, readOnly, payroll }) {
  const set = (patch) => savePatch(actions, toast, 'payroll.general', patch)
  const rounding = payroll.rounding || { mode: 'none', mins: 15 }
  const cancel = payroll.cancelPolicy || {}
  const approvals = payroll.approvals || {}
  return (
    <>
      <Section title="Pay cycle" sub="Where each pay period starts and when it pays out" testId="set-pay-cycle">
        <div className="set-grid2">
          <Row label="Pay frequency" hint="Changing the frequency rewrites the period grid from the anchor">
            <Select value={payroll.frequency} disabled={readOnly} testid="set-pay-frequency" wide={180}
              options={Object.values(PAY_FREQUENCIES).map((f) => ({ value: f.id, label: f.label }))} onChange={(v) => set({ frequency: v })} />
          </Row>
          <Row label="Workweek starts" hint="The FLSA workweek boundary used for the 40-hour test — usually Monday, not the calendar week start">
            <Select value={String(payroll.workWeekStart)} disabled={readOnly} testid="set-pay-weekstart" wide={180}
              options={WEEKDAYS.map((d, i) => ({ value: String(i), label: d }))} onChange={(v) => set({ workWeekStart: Number(v) })} />
          </Row>
          <Row label="Pay-date lag" hint="Days between the end of the period and the pay date">
            <NumberField value={payroll.payLagDays} min={0} max={30} suffix="days" disabled={readOnly} testid="set-pay-lag" onCommit={(v) => set({ payLagDays: v })} />
          </Row>
          <Row label="Default work state" hint="Used for state tax estimates and the SUTA table">
            <Select value={payroll.defaultState || 'CA'} disabled={readOnly} testid="set-pay-state" wide={110}
              options={US_STATES.map((s) => ({ value: s, label: s }))} onChange={(v) => set({ defaultState: v })} />
          </Row>
        </div>
        <Banner tone="info" testid="set-pay-note">
          Gross-to-net here is an <b>estimate</b> for the local demo — it is not a filing engine, and no tax is remitted. Rates and
          the tax tables live in Payroll → Setup.
        </Banner>
      </Section>

      <Section title="Time capture" sub="Rounding and what counts as paid time" testId="set-pay-time">
        <div className="set-grid2">
          <Row label="Rounding">
            <div className="set-inline">
              <Seg value={rounding.mode} disabled={readOnly} testid="set-pay-rounding" ariaLabel="Rounding mode"
                options={[{ value: 'none', label: 'Exact' }, { value: 'nearest', label: 'Nearest' }, { value: 'up', label: 'Up' }, { value: 'down', label: 'Down' }]}
                onChange={(v) => set({ rounding: { ...rounding, mode: v } })} />
              <NumberField value={rounding.mins} min={1} max={60} suffix="min" disabled={readOnly || rounding.mode === 'none'} testid="set-pay-rounding-mins" onCommit={(v) => set({ rounding: { ...rounding, mins: v } })} />
            </div>
          </Row>
          <Row label="Drive time between clients"><Toggle on={payroll.payDrive !== false} disabled={readOnly} testid="set-pay-drive" onChange={(v) => set({ payDrive: v })} /></Row>
          <Row label="Unpaid breaks"><Toggle on={!!payroll.payBreaks} disabled={readOnly} testid="set-pay-breaks" onChange={(v) => set({ payBreaks: v })} /></Row>
          <Row label="Documentation / admin time"><Toggle on={payroll.payAdmin !== false} disabled={readOnly} testid="set-pay-admin" onChange={(v) => set({ payAdmin: v })} /></Row>
          <Row label="Training & meetings"><Toggle on={payroll.payTraining !== false} disabled={readOnly} testid="set-pay-training" onChange={(v) => set({ payTraining: v })} /></Row>
          <Row label="EVV verification required" hint="Flags sessions without an EVV check on the register instead of paying them silently">
            <Toggle on={payroll.evvRequired !== false} disabled={readOnly} testid="set-pay-evv" onChange={(v) => set({ evvRequired: v })} />
          </Row>
        </div>
      </Section>

      <Section title="Cancellation policy" sub="The bands applied to sessions a status marks as cancellation / no-show" testId="set-pay-cancel">
        <div className="set-grid2">
          <Row label="Free-notice window"><NumberField value={cancel.freeNoticeHours} min={0} max={168} suffix="hours" disabled={readOnly} testid="set-pay-free" onCommit={(v) => set({ cancelPolicy: { ...cancel, freeNoticeHours: v } })} /></Row>
          <Row label="Short-notice pay"><NumberField value={cancel.payShortNoticePct} min={0} max={100} suffix="%" disabled={readOnly} testid="set-pay-short" onCommit={(v) => set({ cancelPolicy: { ...cancel, payShortNoticePct: v } })} /></Row>
          <Row label="No-show / at-the-door pay"><NumberField value={cancel.payNoShowPct} min={0} max={100} suffix="%" disabled={readOnly} testid="set-pay-noshow" onCommit={(v) => set({ cancelPolicy: { ...cancel, payNoShowPct: v } })} /></Row>
          <Row label="Notice not recorded"><NumberField value={cancel.payUnknownNoticePct} min={0} max={100} suffix="%" disabled={readOnly} testid="set-pay-unknown" onCommit={(v) => set({ cancelPolicy: { ...cancel, payUnknownNoticePct: v } })} /></Row>
        </div>
        <p className="set-hint">
          A cancellation with notice at or above the free window pays nothing; inside the window it pays the short-notice share; a
          no-show or a cancellation at the door pays the no-show share. Which statuses trigger this is set in
          {' '}<a href="#" onClick={(e) => { e.preventDefault(); actions.setUI({ settingsModule: 'appointment-status', settingsSub: null }) }}>Settings → Appointment Status</a>.
        </p>
      </Section>

      <Section title="Approval workflow" sub="The controls that keep payroll honest" testId="set-pay-approvals">
        <div className="set-grid2">
          <Row label="Timesheets must be submitted"><Toggle on={approvals.requireTimesheet !== false} disabled={readOnly} testid="set-pay-reqsheet" onChange={(v) => set({ approvals: { ...approvals, requireTimesheet: v } })} /></Row>
          <Row label="Run requires approval before processing"><Toggle on={approvals.requireApproval !== false} disabled={readOnly} testid="set-pay-reqapprove" onChange={(v) => set({ approvals: { ...approvals, requireApproval: v } })} /></Row>
          <Row label="Approver must differ from submitter" hint="Segregation of duties"><Toggle on={approvals.separateApprover !== false} disabled={readOnly} testid="set-pay-separate" onChange={(v) => set({ approvals: { ...approvals, separateApprover: v } })} /></Row>
          <Row label="Lock the register after processing"><Toggle on={approvals.lockAfterProcess !== false} disabled={readOnly} testid="set-pay-lock" onChange={(v) => set({ approvals: { ...approvals, lockAfterProcess: v } })} /></Row>
        </div>
      </Section>
    </>
  )
}

function EarningCodes({ state, actions, toast, readOnly }) {
  const { settings } = state
  const codes = earningCodes(settings.payroll)
  const [editor, setEditor] = useState(null)
  const save = (item) => {
    const res = actions.settingsOp('earningCode.upsert', { item })
    toast({ message: res.msg, kind: res.ok ? 'ok' : 'warn' })
    if (res.ok) setEditor(null)
  }
  const remove = (row) => {
    const res = actions.settingsOp('earningCode.remove', { id: row.id })
    toast({ message: res.msg, kind: res.ok ? 'ok' : 'warn', action: res.ok ? { label: 'Undo', onClick: () => actions.undo() } : undefined })
  }
  const patch = (row, changes) => {
    const res = actions.settingsOp('earningCode.upsert', { item: { ...row, ...changes } })
    if (!res.ok) toast({ message: res.msg, kind: 'warn' })
  }
  return (
    <Section
      title="Earning codes"
      sub={`${codes.filter((c) => c.kind === 'worked').length} worked · ${codes.length} total`}
      testId="set-codes"
      actions={<button className="btn btn-sm btn-primary" disabled={readOnly} data-testid="set-code-add" onClick={() => setEditor({ id: '', label: '', short: '', kind: 'worked', otEligible: true, regularRate: true, taxable: true, nondisc: false, duty: '' })}>{Icon.plus({ size: 12 })} Add earning code</button>}
    >
      <DataTable
        testid="set-code-table"
        empty="No earning codes configured."
        columns={[
          { key: 'id', label: 'Code', width: '0.7fr' }, { key: 'label', label: 'Description', width: '1.6fr' },
          { key: 'kind', label: 'Kind', width: '0.9fr' }, { key: 'ot', label: 'Counts to OT', width: '0.8fr' },
          { key: 'rr', label: 'Regular rate', width: '0.8fr' }, { key: 'tax', label: 'Taxable', width: '0.7fr' },
          { key: 'use', label: 'Used', width: '0.5fr', num: true }, { key: 'act', label: '', width: '90px' },
        ]}
        rows={codes}
        renderRow={(c) => (
          <div className="set-trow" key={c.id} data-testid={`set-code-${c.id}`} style={{ gridTemplateColumns: '0.7fr 1.6fr 0.9fr 0.8fr 0.8fr 0.7fr 0.5fr 90px' }}>
            <span className="pay-code">{c.id}</span>
            <span><b>{c.label}</b><i className="set-sub">{c.duty || c.short}</i></span>
            <span className="muted">{KINDS.find((k) => k.value === c.kind)?.label || c.kind}</span>
            <span><Toggle on={c.otEligible !== false} disabled={readOnly} testid={`set-code-ot-${c.id}`} onChange={(v) => patch(c, { otEligible: v })} /></span>
            <span><Toggle on={c.regularRate !== false} disabled={readOnly} testid={`set-code-rr-${c.id}`} onChange={(v) => patch(c, { regularRate: v })} /></span>
            <span><Toggle on={c.taxable !== false} disabled={readOnly} testid={`set-code-tax-${c.id}`} onChange={(v) => patch(c, { taxable: v })} /></span>
            <span className="num">{codeUsage(state, c.id)}</span>
            <span className="set-actions">
              <IconButton icon="edit" title={`Edit ${c.id}`} disabled={readOnly} testid={`set-code-edit-${c.id}`} onClick={() => setEditor({ ...c })} />
              <IconButton icon="trash" tone="danger" title={`Remove ${c.id}`} disabled={readOnly || c.system} testid={`set-code-del-${c.id}`} onClick={() => remove(c)} />
            </span>
          </div>
        )}
      />
      <Banner tone="info" testid="set-code-note">
        Built-in codes are read by the payroll engine, the register, the stub and the QuickBooks export — rename them freely, but the
        engine keeps its behaviour. A <b>regular-rate</b> code must be taxable: the FLSA regular rate is built from taxable wages.
        Codes in use by a timesheet, run or claim line cannot be deleted.
      </Banner>

      {editor && (
        <div className="set-editor" data-testid="set-code-editor">
          <div className="set-editor-head"><b>{editor.id ? `Edit ${editor.id}` : 'New earning code'}</b><button className="iconbtn" onClick={() => setEditor(null)} aria-label="Close">{Icon.x({ size: 13 })}</button></div>
          <div className="set-grid2">
            <Row label="Code *" hint="2–12 letters or digits"><TextField value={editor.id} onCommit={(v) => setEditor({ ...editor, id: v.toUpperCase() })} wide={120} testid="set-code-f-id" /></Row>
            <Row label="Description *"><TextField value={editor.label} onCommit={(v) => setEditor({ ...editor, label: v })} wide={280} testid="set-code-f-label" /></Row>
            <Row label="Short label" hint="Shown in tight register columns"><TextField value={editor.short} onCommit={(v) => setEditor({ ...editor, short: v })} wide={160} testid="set-code-f-short" /></Row>
            <Row label="Kind"><Select value={editor.kind} wide={180} testid="set-code-f-kind" options={KINDS} onChange={(v) => setEditor({ ...editor, kind: v })} /></Row>
            <Row label="Duty description"><TextField value={editor.duty} onCommit={(v) => setEditor({ ...editor, duty: v })} wide={240} testid="set-code-f-duty" /></Row>
            <Row label="Counts toward the 40-hour week"><Toggle on={editor.otEligible !== false} testid="set-code-f-ot" onChange={(v) => setEditor({ ...editor, otEligible: v })} /></Row>
            <Row label="Part of the regular rate"><Toggle on={editor.regularRate !== false} testid="set-code-f-rr" onChange={(v) => setEditor({ ...editor, regularRate: v })} /></Row>
            <Row label="Taxable wages"><Toggle on={editor.taxable !== false} testid="set-code-f-tax" onChange={(v) => setEditor({ ...editor, taxable: v })} /></Row>
            <Row label="Nondiscretionary bonus" hint="Spread into the regular rate before the OT premium"><Toggle on={!!editor.nondisc} testid="set-code-f-nondisc" onChange={(v) => setEditor({ ...editor, nondisc: v })} /></Row>
          </div>
          <div className="set-editor-foot">
            <button className="btn btn-sm" onClick={() => setEditor(null)}>Cancel</button>
            <button className="btn btn-sm btn-primary" disabled={readOnly} data-testid="set-code-save" onClick={() => save(editor)}>{editor.id && !editor.system ? 'Save code' : 'Save code'}</button>
          </div>
        </div>
      )}
    </Section>
  )
}

function OvertimeRules({ state, actions, toast, readOnly, payroll }) {
  const set = (patch) => savePatch(actions, toast, 'payroll.overtime', patch)
  const weeklyOt = Number(payroll.otAfterHours) || 40
  const mult = Number(payroll.otMultiplier) || 1.5
  return (
    <>
      <Section title="Weekly overtime (FLSA)" sub="The 40-hour workweek test that drives the premium" testId="set-ot-weekly">
        <div className="set-grid2">
          <Row label="Overtime starts after"><NumberField value={weeklyOt} min={1} max={168} suffix="hours / week" disabled={readOnly} testid="set-ot-after" onCommit={(v) => set({ otAfterHours: v })} /></Row>
          <Row label="Overtime multiplier" hint="Federal minimum is 1.5×; the run gate blocks anything lower">
            <NumberField value={mult} min={1.5} max={3} step={0.1} suffix="×" disabled={readOnly} testid="set-ot-mult" onCommit={(v) => set({ otMultiplier: v })} />
          </Row>
          <Row label="Workweek starts">
            <Select value={String(payroll.workWeekStart)} disabled={readOnly} wide={180} testid="set-ot-weekstart"
              options={WEEKDAYS.map((d, i) => ({ value: String(i), label: d }))} onChange={(v) => set({ workWeekStart: Number(v) })} />
          </Row>
        </div>
        <Banner tone="info" testid="set-ot-explain">
          The premium is <b>derived</b>, never entered: hours above the threshold in a workweek are multiplied by the straight-time
          regular rate. Nondiscretionary bonuses are spread into the regular rate first — the rule most manual payrolls miss.
          {mult === 1.5 ? ' At 1.5× the premium is half the regular rate, the federal standard.' : ` At ${mult}× the premium is ${(mult - 1).toFixed(2)}× the regular rate.`}
        </Banner>
      </Section>
      <Section title="Daily overtime (state rules)" sub="Only needed for states that require it — off by default" testId="set-ot-daily">
        <div className="set-grid2">
          <Row label="Apply daily overtime"><Toggle on={!!payroll.dailyOt} disabled={readOnly} testid="set-ot-daily-on" onChange={(v) => set({ dailyOt: v, ...(v && !payroll.dailyOtHours ? { dailyOtHours: 8, dailyOtMultiplier: 1.5 } : {}) })} /></Row>
          <Row label="Daily overtime after"><NumberField value={payroll.dailyOtHours ?? 8} min={1} max={24} step={0.5} suffix="hours" disabled={readOnly || !payroll.dailyOt} testid="set-ot-daily-hours" onCommit={(v) => set({ dailyOtHours: v })} /></Row>
          <Row label="Daily multiplier"><NumberField value={payroll.dailyOtMultiplier ?? 1.5} min={1.5} max={3} step={0.1} suffix="×" disabled={readOnly || !payroll.dailyOt} testid="set-ot-daily-mult" onCommit={(v) => set({ dailyOtMultiplier: v })} /></Row>
          <Row label="Double time after"><NumberField value={payroll.doubleTimeHours ?? 12} min={1} max={24} step={0.5} suffix="hours" disabled={readOnly || !payroll.dailyOt} testid="set-ot-double-hours" onCommit={(v) => set({ doubleTimeHours: v })} /></Row>
        </div>
        <p className="set-hint">
          Daily rules are stored with the workspace and shown on the register as a policy note. The engine prices weekly overtime
          only — a real practice would have its payroll provider apply state daily rules.
        </p>
      </Section>
    </>
  )
}
