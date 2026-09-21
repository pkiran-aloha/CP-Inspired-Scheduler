import React, { useEffect } from 'react'
import { Icon } from '../ui/Icons'
import { useToast } from '../ui/Toast'
import { PersonAvatar } from '../ui/avatars'

/**
 * Read-only person profile sheet for Clients & Staff directories.
 * View → Edit is one click; every stat here is computed by the parent row,
 * so this component stays dumb and reusable.
 */
export function ProfileModal({ person, kind, kicker, chips = [], meter, tiles = [], flags = [], actionsRow = [], onEdit, onDup, onClose }) {
  const toast = useToast()
  const copy = (t) => {
    const done = () => toast({ message: `Copied ${t}`, kind: 'ok' })
    const fallback = () => {
      try {
        const ta = document.createElement('textarea')
        ta.value = String(t); ta.style.position = 'fixed'; ta.style.opacity = '0'
        document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove()
      } catch { /* clipboard-less environments keep the toast as feedback */ }
      done()
    }
    let ok = false
    try {
      const p = navigator.clipboard?.writeText(String(t))
      if (p?.then) { ok = true; p.then(done).catch(fallback) }
    } catch { ok = false }
    if (!ok) fallback()
  }
  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])
  return (
    <div className="overlay pf-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal pf-modal" role="dialog" aria-label={`${kind} profile`} data-testid="profile-modal">
        <div className="pf-head">
          <PersonAvatar p={person} size={62} className="pf-face" />
          <div className="pf-id">
            <b>{person.name}</b>
            <span>{kicker}</span>
            {flags.length > 0 ? (
              <span className={`pf-state ${flags.some((f) => f.sev === 'error') ? 'bad' : 'warn'}`}>{Icon.alert({ size: 11 })} {flags.length} flag{flags.length > 1 ? 's' : ''} need attention</span>
            ) : (
              <span className="pf-state ok">{Icon.checkCircle({ size: 11 })} All clear</span>
            )}
          </div>
          <button className="iconbtn" onClick={onClose} aria-label="Close profile" data-testid="pf-close">{Icon.x({ size: 14 })}</button>
        </div>

        <div className="pf-body">
          <div className="pf-chips">
            {chips.map((c) => {
              const inner = <><i>{Icon[c.icon]({ size: 12 })}</i><span>{c.label}</span><b>{c.value}</b>
                {c.copy ? <button type="button" className="pf-chip-copy" title="Copy to clipboard" data-testid={`pf-copy-${c.copy}`} onClick={(e) => { e.preventDefault(); e.stopPropagation(); copy(c.value) }}>{Icon.copy({ size: 11 })}</button> : c.href ? <em>↗</em> : null}</>
              return c.href ? (
                <a key={c.label} className="pf-chip link" href={c.href} title={`Open ${c.label}`} data-testid={c.testid}>{inner}</a>
              ) : (
                <span key={c.label} className="pf-chip" data-testid={c.testid}>{inner}</span>
              )
            })}
          </div>

          {meter && (
            <div className="pf-meter">
              <div className="pf-meter-top">
                <span>{meter.label}</span>
                <b style={{ color: meter.tone === 'bad' ? 'var(--danger)' : meter.tone === 'warn' ? 'var(--warn)' : 'var(--ok)' }}>{meter.pct}%</b>
              </div>
              <div className="pf-meter-bar"><i style={{ width: `${Math.min(100, meter.pct)}%`, background: meter.tone === 'bad' ? 'var(--danger)' : meter.tone === 'warn' ? 'var(--warn)' : 'linear-gradient(90deg, var(--accent), #8b5cf6)' }} /></div>
              <span className="pf-meter-cap">{meter.caption}</span>
            </div>
          )}

          {tiles.length > 0 && (
            <div className="pf-tiles">
              {tiles.map((t) => (
                <div key={t.l} className={`pf-tile ${t.tone || ''}`}><b>{t.v}</b><span>{t.l}</span></div>
              ))}
            </div>
          )}

          <div className="pf-flags">
            <h5>{Icon.shield({ size: 12 })} {flags.length ? 'Attention' : 'Compliance'}</h5>
            {flags.length ? (
              flags.map((f, i) => (
                <span className="issue-line" key={i}><span className={`sev-pill sev-${f.sev}`}>{f.sev}</span> {f.txt}</span>
              ))
            ) : (
              <span className="pf-clean">{Icon.check({ size: 12 })} Auth, cadence & documentation all check out for this window</span>
            )}
          </div>
        </div>

        <div className="pf-foot">
          {actionsRow.map((a) => (
            <button key={a.label} className="btn btn-sm" data-testid={a.id} onClick={a.run}>{Icon[a.icon]({ size: 12 })} {a.label}</button>
          ))}
          <span style={{ flex: 1 }} />
          {onDup && (
            <button className="btn btn-sm" data-testid="pf-dup" onClick={onDup}>{Icon.copy({ size: 12 })} Duplicate</button>
          )}
          {onEdit && (
            <button className="btn btn-sm btn-primary" data-testid="pf-edit" onClick={onEdit}>{Icon.edit({ size: 12 })} Edit {kind}</button>
          )}
        </div>
      </div>
    </div>
  )
}
