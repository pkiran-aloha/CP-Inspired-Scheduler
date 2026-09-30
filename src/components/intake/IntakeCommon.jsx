import React, { useEffect } from 'react'
import { useStore } from '../../state/store'
import { Icon } from '../../ui/Icons'
import { PersonAvatar } from '../../ui/avatars'
import { stageDef, slaState, isStalled, fullName, ageLabel, gateItems, URGENCY } from '../../lib/intake'
import { fmtDayLabel, todayISO } from '../../lib/date'

// ---- formatting -----------------------------------------------------------------
export const fmtDate = (iso) => (iso ? fmtDayLabel(iso, 'short') : '—')
export const fmtDateLong = (iso) => (iso ? fmtDayLabel(iso, 'long') : '—')
export const money = (n) => (n === '' || n == null || !Number.isFinite(Number(n)) ? '—' : `$${Number(n).toLocaleString()}`)
export const pctText = (n) => (n == null ? '—' : `${n}%`)
export const sinceText = (ms) => {
  if (!ms) return '—'
  const d = Math.max(0, Math.round((Date.now() - ms) / 86400000))
  if (d === 0) return 'today'
  if (d === 1) return 'yesterday'
  if (d < 30) return `${d}d ago`
  return fmtDate(new Date(ms).toISOString().slice(0, 10))
}

// ---- atoms ----------------------------------------------------------------------

export const TONE_CLASS = { info: 'info', ok: 'ok', warn: 'warn', bad: 'bad', '': 'neutral', neutral: 'neutral' }

/** Pipeline stage chip — one shape everywhere so status is never ambiguous. */
export function StagePill({ stage, short = false, testid }) {
  const d = stageDef(stage)
  return (
    <span className={`iq-stage ${TONE_CLASS[d.tone] || 'neutral'}`} data-testid={testid || `iq-stage-${stage}`} title={d.desc}>
      <i>{Icon[d.icon]?.({ size: 11 })}</i>
      {short ? d.short : d.label}
    </span>
  )
}

export function UrgencyChip({ urgency, testid }) {
  const u = URGENCY[urgency] || URGENCY.routine
  if (urgency === 'routine') return null
  return <span className={`iq-pill ${TONE_CLASS[u.tone]}`} data-testid={testid || `iq-urgency-${urgency}`} title={u.hint}>{u.label}</span>
}

/** SLA + stall state in one glanceable chip (the pipeline's early-warning system). */
export function SlaChip({ req, testid }) {
  const s = slaState(req)
  if (s.key === 'closed') return null
  const stalled = isStalled(req)
  const tone = s.key === 'overdue' ? 'bad' : stalled ? 'warn' : s.key === 'due' ? 'warn' : 'ok'
  return (
    <span className={`iq-pill ${tone}`} data-testid={testid || `iq-sla-${req.id}`} title={`Stage budget ${s.budget}d · in stage ${s.days}d`}>
      {Icon.clock({ size: 10 })} {stalled && s.key !== 'overdue' ? `No touch ${Math.round((Date.now() - (req.updatedAt || req.createdAt)) / 86400000)}d` : s.label}
    </span>
  )
}

export function IntakeAvatar({ req, size = 30, ...rest }) {
  const p = { id: req.id, name: fullName(req), color: req.avatarColor || '#94a3b8', avatar: req.avatar }
  return <PersonAvatar p={p} size={size} {...rest} />
}

export function KpiStrip({ items, testid = 'iq-kpis' }) {
  return (
    <div className="iq-kpis" data-testid={testid}>
      {items.map((it) => (
        <div key={it.id} className="iq-kpi" data-testid={`iq-kpi-${it.id}`}>
          <span className="iq-kpi-ic">{Icon[it.icon]?.({ size: 14 })}</span>
          <span className="iq-kpi-t">
            <b style={it.tone ? { color: it.tone } : undefined}>{it.value}</b>
            <span>{it.label}</span>
            {it.sub && <i>{it.sub}</i>}
          </span>
        </div>
      ))}
    </div>
  )
}

/**
 * Gate checklist. A pipeline move is only allowed when every item is true —
 * rendering the same `GATES` data the reducer enforces keeps them in sync.
 */
export function GateList({ req, target, testid = 'iq-gates' }) {
  const items = gateItems(target)
  if (!items.length) return <div className="muted" style={{ fontSize: 12 }}>No requirements recorded for this step.</div>
  return (
    <div className="iq-gates" data-testid={testid}>
      {items.map((g) => {
        const ok = (() => { try { return g.ok(req) } catch { return false } })()
        return (
          <div key={g.id} className={`iq-gate ${ok ? 'ok' : 'bad'}`} data-testid={`iq-gate-${target}-${g.id}`} data-ok={ok ? '1' : '0'}>
            <span className="ic">{ok ? Icon.check({ size: 12 }) : Icon.alert({ size: 12 })}</span>
            <span>
              <b>{g.label}</b>
              {!ok && <span className="why">Next: {g.action}</span>}
            </span>
          </div>
        )
      })}
    </div>
  )
}

// re-export so views import gate data from one place
export { gateItems, gateBlockers, gateProgress, readiness } from '../../lib/intake'

export function Field({ label, icon, wide, hint, err, testid, children }) {
  return (
    <label className={`iq-fld ${wide ? 'wide' : ''} ${err ? 'bad' : ''}`}>
      <span>{icon && <i className="iq-fi">{Icon[icon]({ size: 11 })}</i>}{label}</span>
      {children}
      {err && <i className="iq-err">{err}</i>}
      {!err && hint && <i className="iq-hint">{hint}</i>}
    </label>
  )
}

export function Toggle({ on, onClick, label, testid }) {
  return (
    <button type="button" className={`iq-toggle ${on ? 'on' : ''}`} data-testid={testid} aria-pressed={on} onClick={onClick}>
      <span>{label}</span><i />
    </button>
  )
}

/** Right-hand record drawer. Escape closes it; the page behind stays mounted. */
export function Drawer({ onClose, children, width = 720, testid = 'iq-drawer', label }) {
  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])
  return (
    <div className="overlay iq-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="iq-drawer" style={{ width }} role="dialog" aria-label={label || 'Intake request'} data-testid={testid}>{children}</aside>
    </div>
  )
}

export function DrawerHead({ req, onClose, children }) {
  const state = useStore()
  const source = (state.referralSources || []).find((s) => s.id === req.referralSourceId)
  const owner = (state.staff || []).find((s) => s.id === req.ownerId)
  return (
    <header className="iq-dhead">
      <IntakeAvatar req={req} size={44} />
      <div className="iq-dhead-t">
        <div className="iq-dhead-row">
          <b>{fullName(req)}</b>
          <StagePill stage={req.stage} />
          <UrgencyChip urgency={req.urgency} />
        </div>
        <span className="iq-dhead-sub">
          <span className="ln-code">{req.no}</span>
          {req.dob ? ` · ${ageLabel(req.dob)}` : ''}
          {source ? ` · ${source.name}` : ''}
          {owner ? ` · Owner ${owner.name}` : ' · No owner'}
        </span>
      </div>
      <div className="iq-dhead-actions">{children}</div>
      <button className="iconbtn" onClick={onClose} aria-label="Close" data-testid="iq-close">{Icon.x({ size: 14 })}</button>
    </header>
  )
}

/** Small inline definition list. */
export function KV({ k, v, tone, testid }) {
  return (
    <div className="iq-kv" data-testid={testid}>
      <span>{k}</span>
      <b style={tone ? { color: tone } : undefined}>{v === '' || v == null ? <span className="muted">—</span> : v}</b>
    </div>
  )
}

export const todayLabel = () => fmtDayLabel(todayISO(), 'short')
