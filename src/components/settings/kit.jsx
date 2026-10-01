import React, { useEffect, useState } from 'react'
import { Icon } from '../../ui/Icons'

/** Section card inside a settings module. */
export function Section({ title, sub, children, actions, testId }) {
  return (
    <section className="set-sec" data-testid={testId}>
      <header className="set-sec-head">
        <div>
          <b>{title}</b>
          {sub && <span>{sub}</span>}
        </div>
        <div className="set-sec-actions">{actions}</div>
      </header>
      <div className="set-sec-body">{children}</div>
    </section>
  )
}

/** Labelled row; `hint` is the tooltip, `stack` puts the control under the label. */
export function Row({ label, hint, children, stack = false }) {
  return (
    <div className={`set-row ${stack ? 'stack' : ''}`} title={hint}>
      <span>{label}</span>
      <div className="set-ctl">{children}</div>
    </div>
  )
}

/** Text input that commits on blur / Enter — settings writes are deliberate, not per-keystroke. */
export function TextField({ value, onCommit, placeholder, testid, disabled, wide = 190, type = 'text' }) {
  const [draft, setDraft] = useState(value ?? '')
  useEffect(() => setDraft(value ?? ''), [value])
  const commit = () => { if ((value ?? '') !== draft) onCommit(draft) }
  return (
    <input
      className="input" type={type} style={{ width: wide }} value={draft} placeholder={placeholder} disabled={disabled}
      data-testid={testid}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') { commit(); e.currentTarget.blur() } if (e.key === 'Escape') { setDraft(value ?? ''); e.currentTarget.blur() } }}
    />
  )
}

export function NumberField({ value, onCommit, min = 0, max = 100000, step = 1, suffix, testid, disabled, wide = 92 }) {
  const [draft, setDraft] = useState(value ?? '')
  useEffect(() => setDraft(value ?? ''), [value])
  const commit = () => {
    const n = Number(draft)
    if (!Number.isFinite(n)) { setDraft(value ?? ''); return }
    const clamped = Math.max(min, Math.min(max, n))
    if (clamped !== value) onCommit(clamped)
    setDraft(clamped)
  }
  return (
    <span className="set-num">
      <input className="input" type="number" style={{ width: wide }} min={min} max={max} step={step} value={draft} disabled={disabled}
        data-testid={testid}
        onChange={(e) => setDraft(e.target.value)} onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') commit() }} />
      {suffix && <i className="muted">{suffix}</i>}
    </span>
  )
}

export function Select({ value, onChange, options, testid, disabled, wide = 200 }) {
  return (
    <select className="input" style={{ width: wide }} value={value} disabled={disabled} data-testid={testid} onChange={(e) => onChange(e.target.value)}>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  )
}

export function Toggle({ on, onChange, disabled, testid, label }) {
  return (
    <button type="button" className={`toggle ${on ? 'on' : ''}`} aria-pressed={!!on} disabled={disabled} data-testid={testid}
      title={label} onClick={() => onChange(!on)} />
  )
}

export function Seg({ value, onChange, options, testid, ariaLabel }) {
  return (
    <div className="viewseg" role="group" aria-label={ariaLabel} data-testid={testid}>
      {options.map((o) => (
        <button key={o.value} className={value === o.value ? 'on' : ''} disabled={o.disabled} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  )
}

export function Banner({ tone = 'info', children, testid }) {
  const icon = tone === 'warn' ? 'alert' : tone === 'ok' ? 'checkCircle' : 'info'
  return (
    <div className={`set-banner ${tone}`} role={tone === 'warn' ? 'alert' : 'note'} data-testid={testid}>
      {Icon[icon]({ size: 14 })}
      <div>{children}</div>
    </div>
  )
}

export function Empty({ children, testid }) {
  return <div className="set-empty" data-testid={testid}>{children}</div>
}

/** A compact bordered table: header cells + row renderer. */
export function DataTable({ columns, rows, renderRow, testid, empty }) {
  return (
    <div className="set-table" data-testid={testid}>
      <div className="set-thead" style={{ gridTemplateColumns: columns.map((c) => c.width || '1fr').join(' ') }}>
        {columns.map((c) => <span key={c.key} className={c.num ? 'num' : ''}>{c.label}</span>)}
      </div>
      {rows.length ? rows.map(renderRow) : <div className="set-tempty">{empty || 'Nothing here yet.'}</div>}
    </div>
  )
}

export function IconButton({ icon, title, onClick, disabled, testid, tone }) {
  return (
    <button type="button" className={`iconbtn set-icon ${tone || ''}`} title={title} aria-label={title} disabled={disabled} data-testid={testid} onClick={onClick}>
      {Icon[icon]({ size: 13 })}
    </button>
  )
}
