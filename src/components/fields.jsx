import React, { useEffect, useRef, useState } from 'react'
import { PersonAvatar } from '../ui/avatars'
import { Icon } from '../ui/Icons'

export function Popover({ anchorRect, onClose, children, width = 280 }) {
  const ref = useRef(null)
  useEffect(() => {
    const h = (e) => {
      if (ref.current && !ref.current.contains(e.target) && !e.target.closest?.('[data-pop-anchor]')) onClose()
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [onClose])
  if (!anchorRect) return null
  const top = Math.min(anchorRect.bottom + 6, window.innerHeight - 350)
  const left = Math.min(anchorRect.left, window.innerWidth - width - 12)
  return (
    <div className="pop" ref={ref} style={{ top, left, width }}>
      {children}
    </div>
  )
}

/**
 * Unified in-app dropdown used for EVERY option list in the session forms —
 * consistent styling, search, and optional free-text creation (no native <select>s).
 */
export function Dropdown({ value, onChange, options = [], placeholder = 'Select…', searchable = false, creatable = false, disabled = false, testid, style, buttonClassName = 'input' }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const anchor = useRef(null)
  const norm = options.map((o) => (typeof o === 'string' ? { value: o, label: o } : o))
  const current = norm.find((o) => o.value === value)
  const filtered = searchable && q ? norm.filter((o) => (o.label + ' ' + (o.sub || '')).toLowerCase().includes(q.toLowerCase())) : norm
  const exact = q && norm.some((o) => o.label.toLowerCase() === q.toLowerCase())

  const commit = (v) => {
    onChange(v)
    setOpen(false)
    setQ('')
  }

  return (
    <div className="rel" ref={anchor}>
      <button
        type="button"
        data-testid={testid}
        className={`${buttonClassName} select ${disabled ? '' : ''}`}
        disabled={disabled}
        onClick={() => !disabled && (setOpen((o) => !o), setQ(current ? '' : ''))}
        style={{ textAlign: 'left', display: 'flex', alignItems: 'center', gap: 6, cursor: disabled ? 'default' : 'pointer' }}
      >
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: current || value ? 'inherit' : 'var(--muted)', fontWeight: current || value ? 600 : 500 }}>
          {current ? current.label : value || placeholder}
        </span>
        {Icon.chevDown({ size: 12 })}
      </button>
      {open && (
        <Popover anchorRect={anchor.current.getBoundingClientRect()} onClose={() => setOpen(false)} width={Math.max(240, anchor.current.offsetWidth)}>
          {searchable && (
            <div className="pop-search">
              <input className="input" autoFocus placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && filtered[0]) commit(filtered[0].value) }} />
            </div>
          )}
          {filtered.map((o) => (
            <button type="button" key={o.value} data-testid={`opt-${testid || 'dd'}-${String(o.value)}`} className={`pop-item ${o.value === value ? 'on' : ''}`} onClick={() => commit(o.value)}>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span className="nm" style={{ display: 'block' }}>{o.label}</span>
                {o.sub && <span className="rl">{o.sub}</span>}
              </span>
              <span className="ck">{Icon.check({ size: 14, strokeWidth: 2.6 })}</span>
            </button>
          ))}
          {creatable && q && !exact && (
            <button type="button" data-testid="dd-create" className="pop-item" style={{ color: 'var(--accent)' }} onClick={() => commit(q)}>
              {Icon.plus({ size: 13 })} Use “{q}”
            </button>
          )}
          {!filtered.length && !creatable && <div className="rl" style={{ padding: 10, textAlign: 'center' }}>No matches</div>}
        </Popover>
      )}
    </div>
  )
}

/**
 * Multi-select with honest selection state: every picked option becomes a removable
 * chip on the trigger (2 visible + a +n overflow chip), rows carry a filled checkbox,
 * and the header offers a live count with Clear-all. Deselect via chip ✕, by tapping
 * a checked row, or Clear all.
 */
export function MultiSelect({ values = [], onChange, options = [], placeholder = 'Select…', testid }) {
  const [open, setOpen] = useState(false)
  const anchor = useRef(null)
  const norm = options.map((o) => (typeof o === 'string' ? { value: o, label: o } : o))
  const chosen = norm.filter((o) => values.includes(o.value))
  const toggle = (v) => onChange(values.includes(v) ? values.filter((x) => x !== v) : [...values, v])
  const remove = (e, v) => { e.stopPropagation(); onChange(values.filter((x) => x !== v)) }
  return (
    <div className="rel ms" ref={anchor}>
      <div
        data-testid={testid}
        className="input select ms-btn"
        role="button"
        tabIndex={0}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen((o) => !o) } if (e.key === 'Escape') setOpen(false) }}
      >
        {!chosen.length && <span className="ms-ph">{placeholder}</span>}
        {chosen.slice(0, 2).map((o) => (
          <span key={o.value} className="ms-chip" data-testid={`ms-chip-${testid || 'ms'}-${o.value}`}>
            <span className="t">{o.label}</span>
            <button type="button" aria-label={`Remove ${o.label}`} title={`Remove ${o.label}`} data-testid={`ms-unsel-${testid || 'ms'}-${o.value}`} onClick={(e) => remove(e, o.value)}>{Icon.x({ size: 10, strokeWidth: 2.6 })}</button>
          </span>
        ))}
        {chosen.length > 2 && (
          <span className="ms-chip more" title={chosen.slice(2).map((o) => o.label).join(', ')} data-testid={`ms-more-${testid || 'ms'}`}>+{chosen.length - 2}</span>
        )}
        <span className="ms-trail">
          {chosen.length > 1 && <span className="cnt ms-n" data-testid={`ms-count-${testid || 'ms'}`}>{chosen.length}</span>}
          <span className="ms-chev">{Icon.chevDown({ size: 12 })}</span>
        </span>
      </div>
      {open && (
        <Popover anchorRect={anchor.current.getBoundingClientRect()} onClose={() => setOpen(false)} width={Math.max(240, anchor.current.offsetWidth)}>
          <div className="ms-head">
            <b>{chosen.length ? `${chosen.length} selected` : 'Select all that apply'}</b>
            {chosen.length > 0 && <button type="button" data-testid={`ms-clear-${testid || 'ms'}`} onClick={() => onChange([])}>Clear all</button>}
          </div>
          {norm.map((o) => {
            const on = values.includes(o.value)
            return (
              <button type="button" key={o.value} className={`pop-item ms-item${on ? ' on' : ''}`} aria-pressed={on} data-testid={`opt-${testid || 'ms'}-${o.value}`} onClick={() => toggle(o.value)}>
                <span className={`cb${on ? ' on' : ''}`}>{on && Icon.check({ size: 11, strokeWidth: 3 })}</span>
                <span className="nm" style={{ flex: 1 }}>{o.label}</span>
              </button>
            )
          })}
        </Popover>
      )}
    </div>
  )
}

export function PeoplePicker({ label, required, people, selected, onChange, placeholder = 'Add', multi = true }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [rect, setRect] = useState(null)
  const anchor = useRef(null)
  const list = people.filter((p) => !q || (p.name + ' ' + (p.role || p.program || '')).toLowerCase().includes(q.toLowerCase()))
  const byId = Object.fromEntries(people.map((p) => [p.id, p]))

  const toggle = (id) => {
    if (!selected.includes(id)) onChange(multi ? [...selected, id] : [id])
    else if (multi) onChange(selected.filter((x) => x !== id))
    if (!multi) setOpen(false)
  }

  return (
    <div className="field" ref={anchor}>
      <label>
        {label} {required && <em>*</em>}
      </label>
      <div data-testid={`pick-${label}`} className="person-pick" data-pop-anchor onClick={() => { setRect(anchor.current.getBoundingClientRect()); setOpen((o) => !o) }}>
        {selected.map((id) => {
          const p = byId[id]
          if (!p) return null
          return (
            <span key={id} className="pill">
              <PersonAvatar p={p} size={18} />
              {p.name}
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onChange(selected.filter((x) => x !== id))
                }}
                aria-label={`Remove ${p.name}`}
              >
                {Icon.x({ size: 10 })}
              </button>
            </span>
          )
        })}
        {!selected.length && (
          <span className="pp-hint">
            {Icon.plus({ size: 12 })} {placeholder}
          </span>
        )}
      </div>
      {open && (
        <Popover anchorRect={rect} onClose={() => setOpen(false)} width={300}>
          <div className="pop-search">
            <input className="input" autoFocus placeholder="Search people…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          {list.map((p) => (
            <button key={p.id} data-testid="people-item" className={`pop-item ${selected.includes(p.id) ? 'on' : ''}`} onClick={() => toggle(p.id)}>
              <PersonAvatar p={p} size={24} />
              <span style={{ flex: 1, minWidth: 0 }}>
                <span className="nm">{p.name}</span>
                <div className="rl">{p.role || p.program}</div>
              </span>
              <span className="ck">{Icon.check({ size: 14, strokeWidth: 2.6 })}</span>
            </button>
          ))}
          {!list.length && <div className="rl" style={{ padding: 10, textAlign: 'center' }}>No matches</div>}
        </Popover>
      )}
    </div>
  )
}

export function Toggle({ on, onChange, label, hint }) {
  return (
    <div className="togglerow" onClick={() => onChange(!on)} style={{ cursor: 'pointer' }}>
      <span>
        {label}
        {hint && <div className="muted" style={{ fontSize: 10.5 }}>{hint}</div>}
      </span>
      <button type="button" className={`toggle ${on ? 'on' : ''}`} role="switch" aria-checked={on} onClick={(e) => { e.preventDefault(); onChange(!on) }} />
    </div>
  )
}

export function TagInput({ items = [], onChange, placeholder = 'Add' }) {
  const [v, setV] = useState('')
  const commit = () => {
    const t = v.trim()
    if (t && !items.includes(t)) onChange([...items, t])
    setV('')
  }
  return (
    <div className="field">
      <div className="person-pick" onClick={(e) => e.target.closest('.tag') || e.currentTarget.querySelector('input')?.focus()}>
        {items.map((t) => (
          <span key={t} className="tag">
            {t}
            <button onClick={() => onChange(items.filter((x) => x !== t))}>{Icon.x({ size: 9 })}</button>
          </span>
        ))}
        <input
          style={{ border: 0, background: 'none', outline: 'none', flex: 1, minWidth: 60, fontSize: 12.5 }}
          value={v}
          onChange={(e) => setV(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              commit()
            }
          }}
          onBlur={commit}
          placeholder={placeholder}
        />
      </div>
    </div>
  )
}
