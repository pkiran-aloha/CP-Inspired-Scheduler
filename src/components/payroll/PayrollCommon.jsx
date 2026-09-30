import React, { useMemo } from 'react'
import { useStore } from '../../state/store'
import { Icon } from '../../ui/Icons'
import { PersonAvatar } from '../../ui/avatars'
import { PAY_FREQUENCIES, RUN_STATUS_LABEL, periodsFor, periodFor } from '../../lib/payroll'
import { todayISO } from '../../lib/date'

// ---- formatting -----------------------------------------------------------------
export const money = (cents, { cents: showCents = true } = {}) => {
  const v = (Number(cents) || 0) / 100
  return `$${v.toLocaleString('en-US', { minimumFractionDigits: showCents ? 2 : 0, maximumFractionDigits: showCents ? 2 : 0 })}`
}
export const moneyR = (cents) => money(cents)
export const hrs = (h) => `${(Number(h) || 0).toFixed(2)} h`
export const pct = (n) => `${(Number(n) || 0).toFixed(1)}%`

// ---- small atoms ----------------------------------------------------------------
export function StatusPill({ status, label }) {
  const tone = {
    open: 'neutral', submitted: 'info', approved: 'ok', rejected: 'bad', processed: 'locked',
    draft: 'neutral', pending_approval: 'info', voided: 'bad',
  }[status] || 'neutral'
  return <span className={`pay-pill ${tone}`} data-testid={`pay-status-${status}`}>{label || RUN_STATUS_LABEL[status] || status.replace('_', ' ')}</span>
}

export function PayKpis({ items, testId = 'pay-kpis' }) {
  return (
    <div className="batch-strip" data-testid={testId} style={{ margin: '16px', padding: 16, gap: 12, flexWrap: 'wrap', background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 14 }}>
      {items.map(([label, value, sub, tid, tone]) => (
        <div key={tid || label} className="rp-sumchip on" data-testid={tid} style={{ background: 'var(--panel)', border: '1px solid var(--line)', display: 'flex', gap: 12, alignItems: 'center', minWidth: 148, borderRadius: 12, padding: '12px 16px' }}>
          <span style={{ minWidth: 0 }}>
            <b style={{ display: 'block', fontSize: 18, color: tone || 'inherit' }}>{value}</b>
            <span style={{ display: 'block', fontSize: 12 }}>{label}</span>
            {sub && <small className="muted">{sub}</small>}
          </span>
        </div>
      ))}
    </div>
  )
}

/** Period chooser used by every payroll screen — one vocabulary for "which cycle". */
export function PeriodPicker({ value, onChange, back = 12, forward = 12, showMeta = true, label = 'Payroll period' }) {
  const { settings } = useStore()
  const payroll = settings.payroll
  const periods = useMemo(() => periodsFor(payroll, payroll.anchor, { back, forward }), [payroll, back, forward])
  const sel = periods.find((p) => p.id === value) || null
  const move = (dir) => {
    const i = periods.findIndex((p) => p.id === (sel?.id || value))
    if (i < 0) return
    const next = periods[i + dir]
    if (next) onChange(next.id)
  }
  return (
    <div className="pay-period" data-testid="pay-period-picker">
      <button className="iconbtn" onClick={() => move(-1)} aria-label="Previous period" data-testid="pay-period-prev">{Icon.chevronL({ size: 13 })}</button>
      <select className="input" value={value || ''} onChange={(e) => onChange(e.target.value)} data-testid="pay-period-select" aria-label={label}>
        {periods.map((p) => (
          <option key={p.id} value={p.id}>{p.start} → {p.end}{p.id === periodFor(payroll, todayISO(), { back, forward })?.id ? '  (current)' : ''}</option>
        ))}
      </select>
      <button className="iconbtn" onClick={() => move(1)} aria-label="Next period" data-testid="pay-period-next">{Icon.chevronR({ size: 13 })}</button>
      {showMeta && sel && (
        <span className="pay-period-meta">
          <b>{PAY_FREQUENCIES[sel.frequency]?.label}</b> · pay date {sel.payDate} · timesheet cutoff {sel.cutoff}
        </span>
      )}
    </div>
  )
}

/**
 * Collapse raw gate entries into one row per issue code, carrying the distinct
 * employees and up to four sample explanations. Shared with the landing page so
 * its drill-down lists the same employees the register does.
 */
export function groupGate(list = [], tone = 'warn') {
  const m = new Map()
  for (const w of list) {
    const cur = m.get(w.code) || { code: w.code, tone, count: 0, why: [], items: [], staffIds: new Set() }
    cur.count += 1
    if (cur.why.length < 4 && !cur.why.includes(w.why)) cur.why.push(w.why)
    if (w.staffId) cur.staffIds.add(w.staffId)
    cur.items.push(w)
    m.set(w.code, cur)
  }
  return [...m.values()].map((g) => ({ ...g, staffIds: [...g.staffIds] }))
}

/** Exceptions list shared by Process Payroll, Pay Runs and Payroll Summary. */
export function GateList({ gate, onFilter }) {
  const blockers = gate?.blockers || []
  const warnings = gate?.warnings || []
  const group = groupGate
  const b = group(blockers, 'bad')
  const w = group(warnings, 'warn')
  const drill = (g) => onFilter && onFilter(g)
  const AffectedLink = ({ g }) => (
    g.staffIds.length > 0 ? (
      <button className="pay-link" data-testid={`pay-gate-filter-${g.code}`} onClick={() => drill(g)}>
        Show {g.staffIds.length} affected employee{g.staffIds.length === 1 ? '' : 's'} →
      </button>
    ) : null
  )
  if (!b.length && !w.length) {
    return <div className="pay-gate ok" data-testid="pay-gate-clear">
      <span className="ic">{Icon.checkCircle({ size: 15 })}</span>
      <span><b>All controls passed.</b> No blockers and no exceptions on this period.</span>
    </div>
  }
  return (
    <div className="pay-gates" data-testid="pay-gate-list">
      {b.map((g) => (
        <div key={g.code} className="pay-gate bad" data-testid={`pay-blocker-${g.code}`}>
          <span className="ic">{Icon.ban({ size: 15 })}</span>
          <div>
            <b>{g.count} blocker{g.count > 1 ? 's' : ''} · {g.code.replace(/-/g, ' ')}</b>
            {g.why.map((x, i) => <div key={i} className="why">{x}</div>)}
            <AffectedLink g={g} />
          </div>
        </div>
      ))}
      {w.map((g) => (
        <div key={g.code} className="pay-gate warn" data-testid={`pay-warning-${g.code}`}>
          <span className="ic">{Icon.alert({ size: 15 })}</span>
          <div>
            <b>{g.count} exception{g.count > 1 ? 's' : ''} · {g.code.replace(/-/g, ' ')}</b>
            {g.why.map((x, i) => <div key={i} className="why">{x}</div>)}
            <AffectedLink g={g} />
          </div>
        </div>
      ))}
    </div>
  )
}

// ---- phased wizard design ---------------------------------------------------
/**
 * The four payroll phases, defined once and shared by the landing page, the
 * wizard rail and the phase panels — one vocabulary for the whole module.
 */
export const PAY_PHASES = [
  { id: 'period', label: 'Select period', sub: 'Which cycle to pay', icon: 'cal', blurb: 'Choose the pay cycle; eligible employees and worked hours come straight from the calendar.', promise: 'Pick the cycle' },
  { id: 'review', label: 'Review register', sub: 'Price time · clear exceptions', icon: 'table', blurb: 'Check gross-to-net for every employee, then clear the blockers and work the exceptions.', promise: 'Check the numbers' },
  { id: 'approve', label: 'Approve', sub: 'A second person signs', icon: 'shield', blurb: 'An independent approver signs the register before any money is locked.', promise: 'Get it signed' },
  { id: 'process', label: 'Process & pay', sub: 'Lock & release files', icon: 'zap', blurb: 'Re-price from the live ledgers, lock the register and release stubs, provider and bank files.', promise: 'Lock & release' },
]

/** How far a run has travelled: `done` phases complete, `step` the active phase. */
const RUN_PHASE_DONE = { draft: 1, pending_approval: 1, approved: 3, processed: 4, voided: 0 }
export function runProgress(run) {
  if (!run) return { step: 0, done: 0, complete: false }
  const done = RUN_PHASE_DONE[run.status] ?? 0
  return { step: Math.min(done, PAY_PHASES.length - 1), done, complete: run.status === 'processed' }
}

/**
 * The phase rail: iconography, state colouring and one line of guidance per
 * phase so the wizard reads like a guided path rather than a row of tabs.
 * States: done (green check), on (accent), upcoming (neutral), locked (disabled).
 * `meta[i]` prints the one number/date that phase produced (e.g. the period).
 */
export function PayStepper({ steps, step, maxStep, onStep, meta = {} }) {
  return (
    <div className="pay-stepper" data-testid="pay-steps" role="group" aria-label="Payroll phases">
      {steps.map((s, i) => {
        const done = i < step
        const on = i === step
        const reachable = i <= (maxStep ?? step)
        return (
          <React.Fragment key={s.label}>
            {i > 0 && <span className={`pay-sconn ${i <= step ? 'fill' : ''}`} aria-hidden="true" />}
            <button
              className={`pay-step ${on ? 'on' : ''} ${done ? 'done' : ''} ${!reachable ? 'locked' : ''}`}
              data-testid={`pay-step-${i}`}
              onClick={() => reachable && onStep && onStep(i)}
              disabled={!reachable}
              aria-current={on ? 'step' : undefined}
              title={reachable ? `${s.label} — ${s.sub}` : 'Finish the earlier phases first'}
            >
              <span className="n">{done ? Icon.check({ size: 12 }) : Icon[s.icon] ? Icon[s.icon]({ size: 13 }) : i + 1}</span>
              <span className="tx">
                <span className="p">Phase {i + 1}</span>
                <span className="t">{s.label}</span>
                <span className="s">{s.sub}</span>
              </span>
              {meta[i] && <span className="m" title={meta[i]}>{meta[i]}</span>}
            </button>
          </React.Fragment>
        )
      })}
    </div>
  )
}

/**
 * A completed phase, collapsed to one readable row. The wizard shows the active
 * phase in full and everything behind it as a recap, so nothing is ever clipped
 * and the current decision is always the first thing on screen.
 */
export function PhaseRecap({ index, icon, title, detail, onOpen, testId }) {
  return (
    <div className="pay-recap" data-testid={testId}>
      <span className="pay-recap-ic">{Icon.check({ size: 12 })}</span>
      <div className="pay-recap-t">
        <span className="pay-recap-eyebrow">Phase {index} complete</span>
        <b>{title}</b>
        {detail && <span className="pay-recap-d">{detail}</span>}
      </div>
      {onOpen && (
        <button className="btn btn-sm" data-testid={`${testId}-open`} onClick={onOpen} title={`Go back to ${title}`}>
          {Icon[icon] ? Icon[icon]({ size: 12 }) : Icon.edit({ size: 12 })} Change
        </button>
      )}
    </div>
  )
}

/**
 * The phase shell: coloured icon tile + "Phase n of N" eyebrow + the guide that
 * tells the user what this phase does and what moves them ahead. The panel never
 * clips and never shrinks — the phase content is the page.
 */
export function PhasePanel({ index, total, icon, tone = 'accent', title, sub, guide = [], meta, children, footer, testId }) {
  return (
    <div className="pay-card pay-phase" data-testid={testId}>
      <div className={`pay-phase-head tone-${tone}`}>
        <span className={`pay-phase-ic tone-${tone}`}>{Icon[icon] ? Icon[icon]({ size: 17 }) : Icon.spark({ size: 17 })}</span>
        <div className="pay-phase-titles">
          <span className="pay-phase-eyebrow">Phase {index} of {total}</span>
          <h3>{title}</h3>
          {sub && <div className="pay-phase-sub">{sub}</div>}
        </div>
        {meta && meta.length > 0 && (
          <div className="pay-phase-meta">
            {meta.map(([label, value]) => (
              <div key={label}><span>{label}</span><b>{value}</b></div>
            ))}
          </div>
        )}
      </div>
      {guide.length > 0 && (
        <ol className="pay-guide" data-testid={`pay-guide-${index}`}>
          {guide.map((g, i) => (
            <li key={i}><span className="pay-guide-n">{i + 1}</span><span>{g}</span></li>
          ))}
        </ol>
      )}
      {children}
      {footer && <div className="pay-actions pay-phase-foot">{footer}</div>}
    </div>
  )
}

/**
 * Payroll module tabs — the same chrome on the landing page and every payroll
 * screen, so "where am I in payroll" never depends on the nav rail alone.
 */
export const PAY_MODULES = [
  { id: 'payroll', label: 'Cycle overview' },
  { id: 'pay-process', label: 'Process Payroll' },
  { id: 'pay-runs', label: 'Pay Runs' },
  { id: 'pay-timesheets', label: 'Timesheets' },
  { id: 'pay-idmap', label: 'ID Mapping' },
  { id: 'pay-summary', label: 'Summary' },
  { id: 'pay-qbo', label: 'QuickBooks' },
  { id: 'pay-setup', label: 'Setup' },
]

export function PaySubNav() {
  const { ui, actions } = useStore()
  const section = ui.section || 'payroll'
  return (
    <div className="pay-subnav no-print" data-testid="pay-subnav" role="tablist" aria-label="Payroll modules">
      {PAY_MODULES.map((m) => {
        const on = m.id === section
        return (
          <button
            key={m.id}
            role="tab"
            aria-selected={on}
            className={`pay-subtab ${on ? 'on' : ''}`}
            data-testid={`pay-tab-${m.id}`}
            onClick={() => { if (!on) actions.setUI({ section: m.id, payrollFocus: null, payPhase: null }) }}
          >{m.label}</button>
        )
      })}
    </div>
  )
}

export function StaffCell({ staffId, size = 26, sub }) {
  const { staff } = useStore()
  const s = (staff || []).find((x) => x.id === staffId)
  return (
    <div className="pay-who">
      <PersonAvatar p={s} size={size} />
      <span className="pay-who-t">
        <b>{s?.name || staffId}</b>
        {(sub ?? s?.role) && <i>{sub ?? s?.role}</i>}
      </span>
    </div>
  )
}

/** Pagination footer (25/page) shared by the directory-style payroll tables. */
export function Pager({ page, setPage, total, per = 25, testId = 'pay-pager' }) {
  const pages = Math.max(1, Math.ceil(total / per))
  return (
    <div className="pay-pager" data-testid={testId}>
      <span className="muted">{total ? `${(page - 1) * per + 1}-${Math.min(total, page * per)} of ${total}` : '0 of 0'}</span>
      <div className="pay-pages">
        {Array.from({ length: pages }, (_, i) => i + 1).slice(0, 8).map((p) => (
          <button key={p} className={`pay-page ${p === page ? 'on' : ''}`} onClick={() => setPage(p)} data-testid={`${testId}-${p}`}>{p}</button>
        ))}
        {pages > 8 && <span className="muted">…</span>}
        {pages > 1 && <button className="pay-page" disabled={page >= pages} onClick={() => setPage(page + 1)} aria-label="Next page">{Icon.chevronR({ size: 12 })}</button>}
      </div>
    </div>
  )
}

export const officeOf = (state, staffId) => (state.payProfiles || []).find((p) => p.staffId === staffId)?.office || '—'
