import React, { useMemo } from 'react'
import { useStore } from '../../state/store'
import { Icon } from '../../ui/Icons'
import { useToast } from '../../ui/Toast'
import { StaffCell, StatusPill, money, hrs } from './PayrollCommon'

/**
 * Review Register — the exception drill-down.
 *
 * "Show n affected employees" on the review step used to dump names into a
 * toast, which is not a control — it is a shrug. This modal lists every affected
 * employee with the exact issue on their record and a one-click redirect to the
 * screen where the problem can actually be fixed (profile master data,
 * timesheet desk, run register or setup), plus the in-register escape hatch of
 * excluding someone from a draft run.
 */

/** Where each gate code is fixed, and what fixing it looks like. */
export const ISSUE_DEST = {
  'no-payroll-id': { section: 'pay-idmap', label: 'Payroll ID Mapping', icon: 'badge', open: 'profile', fix: 'Assign a payroll ID' },
  'dup-payroll-id': { section: 'pay-idmap', label: 'Payroll ID Mapping', icon: 'badge', open: 'profile', fix: 'Make the payroll ID unique' },
  'no-profile': { section: 'pay-idmap', label: 'Payroll ID Mapping', icon: 'badge', open: 'profile', fix: 'Create the pay profile' },
  'no-rate': { section: 'pay-idmap', label: 'Payroll ID Mapping', icon: 'dollar', open: 'profile', fix: 'Set an hourly rate' },
  'no-salary': { section: 'pay-idmap', label: 'Payroll ID Mapping', icon: 'dollar', open: 'profile', fix: 'Set the annual salary' },
  'below-min-wage': { section: 'pay-idmap', label: 'Payroll ID Mapping', icon: 'alert', open: 'profile', fix: 'Review rates & hours' },
  'negative-net': { section: 'pay-idmap', label: 'Payroll ID Mapping', icon: 'alert', open: 'profile', fix: 'Review deductions' },
  'exempt-unreviewed': { section: 'pay-idmap', label: 'Payroll ID Mapping', icon: 'shield', open: 'profile', fix: 'Confirm the exempt review' },
  'no-state': { section: 'pay-idmap', label: 'Payroll ID Mapping', icon: 'pin', open: 'profile', fix: 'Set the work state' },
  'sheet-not-approved': { section: 'pay-timesheets', label: 'Timesheet Submission', icon: 'clipboard', open: 'timesheet', fix: 'Open the timesheet' },
  'evv-missing': { section: 'pay-timesheets', label: 'Timesheet Submission', icon: 'pin', open: 'timesheet', fix: 'Verify the visits' },
  'zero-pay': { section: 'pay-timesheets', label: 'Timesheet Submission', icon: 'clipboard', open: 'timesheet', fix: 'Add time or exclude' },
  'duplicate-run': { section: 'pay-runs', label: 'Pay Runs', icon: 'table', open: null, fix: 'Open the existing run' },
  'ot-rate': { section: 'pay-setup', label: 'Payroll Setup', icon: 'zap', open: null, fix: 'Fix the OT multiplier' },
  'rounding': { section: 'pay-setup', label: 'Payroll Setup', icon: 'clock', open: null, fix: 'Review rounding policy' },
  'no-period': { section: 'pay-process', label: 'Process Payroll', icon: 'cal', open: null, fix: 'Select a pay period' },
  'no-employees': { section: 'pay-idmap', label: 'Payroll ID Mapping', icon: 'users', open: null, fix: 'Include employees' },
}

export const issueLabel = (code) => code.replace(/-/g, ' ')
export const issueDest = (code) => ISSUE_DEST[code] || { section: 'pay-idmap', label: 'Payroll ID Mapping', icon: 'edit', open: 'profile', fix: 'Open the record' }

const toneIcon = (tone) => (tone === 'bad' ? Icon.ban : Icon.alert)

/** One employee in the exception list, with the specific issues on their record. */
function AffectedRow({ staffId, items, tone, run, onFix, onExclude }) {
  const line = (run?.lines || []).find((l) => l.staffId === staffId) || null
  const codes = [...new Set(items.map((i) => i.code))]
  const dest = issueDest(codes[0])
  return (
    <div className={`pay-review-row ${tone === 'bad' ? 'bad' : 'warn'}`} data-testid={`pay-review-row-${staffId}`}>
      <div className="pay-review-who">
        <StaffCell staffId={staffId} size={32} sub={line ? `${line.office || '—'} · ${line.payType || ''}` : undefined} />
        <div className="pay-review-meta">
          <span className="pay-review-chip" title="Payroll ID">{Icon.badge({ size: 11 })} {line?.payrollId || 'no payroll ID'}</span>
          {line && <span className="pay-review-chip" title="Net pay this run">{Icon.dollar({ size: 11 })} {money(line.netCents)} net</span>}
          {line && <span className="pay-review-chip" title="Hours">{Icon.clock({ size: 11 })} {hrs(line.workedHours + line.otHours)}</span>}
        </div>
      </div>
      <div className="pay-review-issues">
        {items.map((i, k) => (
          <div key={k} className="pay-review-issue" data-testid={`pay-review-issue-${staffId}-${i.code}`}>
            <span className={`pay-issue-pill ${tone === 'bad' ? 'bad' : 'warn'}`}>{issueLabel(i.code)}</span>
            <span className="pay-review-why">{i.why}</span>
          </div>
        ))}
      </div>
      <div className="pay-review-actions">
        <button className="btn btn-sm btn-primary" data-testid={`pay-review-fix-${staffId}`} onClick={() => onFix(staffId, dest)}>
          {Icon[dest.icon] ? Icon[dest.icon]({ size: 12 }) : Icon.edit({ size: 12 })} {dest.fix}
        </button>
        {run && run.status === 'draft' && (
          <button className="btn btn-sm" data-testid={`pay-review-exclude-${staffId}`} title="Leave them payable in a later off-cycle run" onClick={() => onExclude(staffId)}>
            Exclude from run
          </button>
        )}
      </div>
    </div>
  )
}

/**
 * The modal itself. `issue` is one grouped gate entry:
 * `{ code, tone, count, why: string[], staffIds: string[], items: gateItem[] }`.
 */
export default function ReviewRegisterModal({ issue, run, onClose }) {
  const state = useStore()
  const { actions, staff } = state
  const toast = useToast()

  const staffIds = issue?.staffIds || []
  const items = issue?.items || []
  const tone = issue?.tone || 'warn'
  const dest = issueDest(issue?.code)
  const isBlocker = tone === 'bad'

  // Every affected employee with just their own issues, blockers first.
  const rows = useMemo(() => {
    const map = new Map()
    for (const it of items) {
      if (!it.staffId) continue
      const cur = map.get(it.staffId) || []
      cur.push(it)
      map.set(it.staffId, cur)
    }
    const ids = staffIds.length ? staffIds : [...map.keys()]
    return ids.map((staffId) => ({ staffId, items: map.get(staffId) || items.filter((i) => !i.staffId) }))
  }, [items, staffIds])

  const onFix = (staffId, d) => {
    const name = (staff || []).find((s) => s.id === staffId)?.name || staffId
    actions.setUI({ section: d.section, payrollFocus: { staffId, name, issue: issue?.code, open: d.open } })
    toast({ message: `${name} → ${d.label}. Fix the record there, then re-check the register.`, kind: 'info' })
    onClose && onClose()
  }

  const onExclude = (staffId) => {
    if (!run) return
    const res = actions.payrollRun(run.id, 'exclude', { staffId, who: run.preparedBy || 'Payroll admin' })
    toast({ message: res.msg, kind: res.ok ? 'ok' : 'warn' })
  }

  const fixAll = () => {
    actions.setUI({ section: dest.section, payrollFocus: { issue: issue?.code, open: dest.open } })
    toast({ message: `Opened ${dest.label}. Fix the affected records, then return to the register.`, kind: 'info' })
    onClose && onClose()
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-wide pay-drawer" data-testid="pay-review-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={`Affected employees: ${issueLabel(issue?.code || 'issue')}`}>
        <div className="modal-head">
          <span className={`pay-phase-ic ${isBlocker ? 'tone-bad' : 'tone-warn'}`} style={{ width: 30, height: 30, borderRadius: 9 }}>
            {toneIcon(tone)({ size: 15 })}
          </span>
          <div style={{ minWidth: 0 }}>
            <b style={{ fontSize: 15 }}>
              {isBlocker ? 'Blocking issue' : 'Exception'} · {issueLabel(issue?.code || '')}
            </b>
            <div className="muted" style={{ fontSize: 12 }}>
              {rows.length} affected employee{rows.length === 1 ? '' : 's'}{run ? ` · run ${run.no}` : ''}. Open a record to fix it
            </div>
          </div>
          {run && <StatusPill status={run.status} />}
          <button className="modal-x" onClick={onClose} aria-label="Close">{Icon.x({ size: 15 })}</button>
        </div>

        <div className="modal-body" style={{ padding: '12px 18px 18px' }}>
          <div className={`pay-gate ${isBlocker ? 'bad' : 'warn'}`} data-testid="pay-review-guide" style={{ marginBottom: 12 }}>
            <span className="ic">{toneIcon(tone)({ size: 15 })}</span>
            <div>
              <b>{isBlocker ? 'This stops the run from being approved.' : 'This does not stop the run, but an approver must look at it.'}</b>
              {(issue?.why || []).slice(0, 4).map((w, i) => <div key={i} className="why">{w}</div>)}
              <div className="why" style={{ marginTop: 4 }}>
                Fix it in <b>{dest.label}</b> ({dest.fix}). Each row below opens the record.
              </div>
            </div>
          </div>

          <div className="pay-review-list" data-testid="pay-review-list">
            {rows.map(({ staffId, items: its }) => (
              <AffectedRow key={staffId} staffId={staffId} items={its} tone={tone} run={run} onFix={onFix} onExclude={onExclude} />
            ))}
            {!rows.length && (
              <div className="py-empty" style={{ padding: 32, textAlign: 'center' }} data-testid="pay-review-empty">
                <b>No individual records. This is a run-level issue</b>
                <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                  {(issue?.why || [])[0] || 'Fix it where the policy lives, then re-check the register.'}
                </div>
              </div>
            )}
          </div>

          {run && (run.excluded || []).length > 0 && (
            <div className="pay-hint" style={{ marginTop: 12 }}>
              <b>{run.excluded.length} excluded from this run.</b> They stay payable in a later off-cycle run.
            </div>
          )}
        </div>

        <div className="modal-foot">
          <span className="muted" style={{ fontSize: 11.5 }}>
            {rows.length ? `Open a record to fix it in ${dest.label}.` : `Policy fixes live in ${dest.label}.`}
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-sm" onClick={onClose}>Close</button>
            {rows.length > 1 && (
              <button className="btn btn-sm btn-primary" data-testid="pay-review-fix-all" onClick={fixAll}>
                {Icon[dest.icon] ? Icon[dest.icon]({ size: 12 }) : null} Fix all in {dest.label}
              </button>
            )}
            {!rows.length && (
              <button className="btn btn-sm btn-primary" data-testid="pay-review-fix-all" onClick={fixAll}>
                {Icon[dest.icon] ? Icon[dest.icon]({ size: 12 }) : null} Open {dest.label}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
