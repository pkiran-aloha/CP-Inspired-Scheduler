import React from 'react'
import { Icon } from '../ui/Icons'
import { cfTypeLabel } from '../lib/master'

/**
 * chunk-36 — one picker row for custom-field templates, shared by the payer
 * profile modal and the appointment modal: checkbox · name + type + required ·
 * option preview, then optional trailing actions. A deliberate list/card row
 * (aligned three-zone grid), not the ad-hoc inline chips it used to be.
 */
export function CfPickRow({ def, on, disabled, testid, onToggle, children }) {
  const opts = (def.options || []).filter(Boolean)
  const act = (fn) => (e) => { e.preventDefault(); e.stopPropagation(); fn() }
  return (
    <label className={`cf-pickrow${on ? ' on' : ''}${disabled ? ' dim' : ''}`} data-testid={testid} title={def.note || ''}>
      <input type="checkbox" checked={on} disabled={disabled} onChange={(e) => onToggle(e.target.checked)} />
      <span className="cf-pickmain">
        <span className="cf-pickname">
          <b>{def.label}</b>
          <span className="pcf-type">{cfTypeLabel(def.type)}</span>
          {def.required ? <span className="tag warn">Required</span> : null}
          {def.status === 'inactive' ? <span className="tag">Inactive</span> : null}
        </span>
        <span className="cf-picksub">
          {def.type === 'toggle' ? <><span className="tag soft">{def.onLabel || 'Yes'}</span><span className="tag soft">{def.offLabel || 'No'}</span></> : null}
          {(def.type === 'select' || def.type === 'multi') && opts.slice(0, 4).map((o) => <span className="tag soft" key={o}>{o}</span>)}
          {opts.length > 4 ? <i className="muted">+{opts.length - 4} more</i> : null}
          {def.note ? <i className="muted cf-picknote">{def.note}</i> : null}
        </span>
      </span>
      {children ? <span className="cf-pickacts">{children}</span> : null}
    </label>
  )
}
