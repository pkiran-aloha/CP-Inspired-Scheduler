import React, { useEffect, useState } from 'react'
import { Icon } from '../ui/Icons'
import { Dropdown } from './fields'
import { CF_TYPES } from '../lib/master'

/** The full custom-field template editor — shared by Masters → Custom Fields and
 *  the payer "Add Custom Fields" modal so there is exactly one place that defines fields. */
export default function CfDefModal({ def, onClose }) {
  const [f, setF] = useState(() => ({
    label: def?.label || '', type: def?.type || 'text', options: (def?.options || []).slice(),
    onLabel: def?.onLabel || 'Yes', offLabel: def?.offLabel || 'No', required: Boolean(def?.required),
    note: def?.note || '', status: def?.status || 'active',
  }))
  const [errs, setErrs] = useState({})
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  const set = (k, v, extra) => { setF((x) => ({ ...x, [k]: v, ...(extra || {}) })); setErrs((e) => ({ ...e, [k]: undefined })) }
  const listy = f.type === 'select' || f.type === 'multi'
  const save = () => {
    const E = {}
    if (!String(f.label).trim()) E.label = 'Give the field a label'
    if (listy && !f.options.filter(Boolean).length) E.options = 'Add at least one option for this list'
    if (Object.keys(E).length) { setErrs(E); return }
    onClose({ label: String(f.label).trim(), type: f.type, options: listy ? f.options.filter((o) => String(o).trim()) : [], onLabel: f.onLabel || 'Yes', offLabel: f.offLabel || 'No', required: f.required, note: f.note, status: f.status })
  }
  return (
    <div className="modal pm-modal py-modal cf-modal" data-testid="cf-modal" role="dialog" aria-modal="true" aria-label={def ? `Template — ${def.label}` : 'New field template'} tabIndex={-1}>
      <div className="modal-head pm-head">
        <h3>{def ? `Template — ${def.label}` : 'New Field Template'}</h3>
        <button className="iconbtn modal-x" aria-label="Close" data-testid="cf-close" onClick={onClose}>{Icon.x({ size: 14 })}</button>
      </div>
      <div className="modal-body">
        <div className="py-two">
          <label className="bil-fld pm-fld">
            <span>Field Label *</span>
            <input className={`input${errs.label ? ' err' : ''}`} value={f.label} data-testid="cf-label" placeholder="e.g. Prior auth dept" onChange={(e) => set('label', e.target.value)} />
            {errs.label && <i className="pm-err">{errs.label}</i>}
          </label>
          <label className="bil-fld pm-fld">
            <span>Field Type</span>
            <Dropdown testid="cf-type" value={f.type} onChange={(v) => set('type', v, ['select', 'multi'].includes(v) && !f.options.length ? { options: [''] } : {})} options={CF_TYPES.map((t) => ({ value: t.id, label: t.label }))} />
          </label>
        </div>
        {listy && (
          <div className="cf-optbox" data-testid="cf-optbox">
            <span className="cf-boxlabel">{f.type === 'select' ? 'List options — pick one (radio)' : 'List options — pick any (checkbox)'}</span>
            {f.options.map((o, i) => (
              <div className="cf-optrow" key={i} data-testid={`cf-optrow-${i}`}>
                <input className="input" value={o} data-testid={`cf-opt-${i}`} onChange={(e) => set('options', f.options.map((x, j) => (j === i ? e.target.value : x)))} placeholder={`Option ${i + 1}`} />
                <button className="iconbtn" title="Move up" data-testid={`cf-opt-up-${i}`} disabled={i === 0} onClick={() => set('options', f.options.map((x, j) => (j === i - 1 ? f.options[i] : j === i ? f.options[i - 1] : x)).slice())}>{Icon.chevronL({ size: 11 })}</button>
                <button className="iconbtn" title="Move down" data-testid={`cf-opt-down-${i}`} disabled={i === f.options.length - 1} onClick={() => set('options', f.options.map((x, j) => (j === i + 1 ? f.options[i] : j === i ? f.options[i + 1] : x)).slice())}>{Icon.chevronR({ size: 11 })}</button>
                <button className="iconbtn" title="Remove option" data-testid={`cf-opt-del-${i}`} disabled={f.options.length <= 1} onClick={() => set('options', f.options.filter((_, j) => j !== i))}>{Icon.x({ size: 11 })}</button>
              </div>
            ))}
            <button className="btn btn-sm cf-optadd" data-testid="cf-opt-add" onClick={() => set('options', [...f.options, ''])}>{Icon.plus({ size: 11 })} Add option</button>
            {errs.options && <i className="pm-err" data-testid="cf-opt-err">{errs.options}</i>}
          </div>
        )}
        {f.type === 'toggle' && (
          <div className="cf-optbox" data-testid="cf-togglebox">
            <span className="cf-boxlabel">Toggle options</span>
            <div className="py-two">
              <label className="bil-fld pm-fld"><span>On label</span><input className="input" value={f.onLabel} data-testid="cf-on-label" onChange={(e) => set('onLabel', e.target.value)} /></label>
              <label className="bil-fld pm-fld"><span>Off label</span><input className="input" value={f.offLabel} data-testid="cf-off-label" onChange={(e) => set('offLabel', e.target.value)} /></label>
            </div>
          </div>
        )}
        {f.type === 'signature' && <div className="cf-hint" data-testid="cf-sig-hint">{Icon.shield({ size: 12 })} Bookers get the full signature pad (type or draw) wherever this field is picked.</div>}
        {f.type === 'date' && <div className="cf-hint">{Icon.cal({ size: 12 })} Renders a date/time picker wherever this field is picked.</div>}
        <label className="bil-fld pm-fld">
          <span>Usage note (shown in pickers)</span>
          <textarea className="input py-ta" rows={2} value={f.note} data-testid="cf-note" placeholder="What is this field for, when to fill it…" onChange={(e) => set('note', e.target.value)} />
        </label>
        <div className="cf-flagrow">
          <label className="cf-flag"><span>Required at booking</span><button type="button" className={`toggle${f.required ? ' on' : ''}`} data-testid="cf-required" aria-pressed={f.required} onClick={() => set('required', !f.required)} /></label>
          <label className="cf-flag"><span>Template active</span><button type="button" className={`toggle${f.status === 'active' ? ' on' : ''}`} data-testid="cf-active" aria-pressed={f.status === 'active'} onClick={() => set('status', f.status === 'active' ? 'inactive' : 'active')} /></label>
        </div>
      </div>
      <div className="modal-foot pm-foot">
        <span className="an-spacer" />
        <button className="btn btn-sm" data-testid="cf-cancel" onClick={onClose}>Cancel</button>
        <button className="btn btn-sm btn-primary" data-testid="cf-save" onClick={save}>{def ? 'Save template' : 'Create template'}</button>
      </div>
    </div>
  )
}
