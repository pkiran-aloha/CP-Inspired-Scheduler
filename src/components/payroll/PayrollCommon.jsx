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

/** Exceptions list shared by Process Payroll, Pay Runs and Payroll Summary. */
export function GateList({ gate, onFilter }) {
  const blockers = gate?.blockers || []
  const warnings = gate?.warnings || []
  const group = (list) => {
    const m = new Map()
    for (const w of list) {
      const cur = m.get(w.code) || { code: w.code, count: 0, why: [w.why], staffIds: new Set() }
      cur.count += 1
      if (cur.why.length < 4) cur.why.push(w.why)
      if (w.staffId) cur.staffIds.add(w.staffId)
      m.set(w.code, cur)
    }
    return [...m.values()].map((g) => ({ ...g, staffIds: [...g.staffIds] }))
  }
  const b = group(blockers)
  const w = group(warnings)
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
          </div>
        </div>
      ))}
      {w.map((g) => (
        <div key={g.code} className="pay-gate warn" data-testid={`pay-warning-${g.code}`}>
          <span className="ic">{Icon.alert({ size: 15 })}</span>
          <div>
            <b>{g.count} exception{g.count > 1 ? 's' : ''} · {g.code.replace(/-/g, ' ')}</b>
            {g.why.map((x, i) => <div key={i} className="why">{x}</div>)}
            {g.staffIds.length > 1 && (
              <button className="pay-link" data-testid={`pay-gate-filter-${g.code}`} onClick={() => onFilter && onFilter(g.staffIds)}>Show {g.staffIds.length} affected employees</button>
            )}
          </div>
        </div>
      ))}
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
