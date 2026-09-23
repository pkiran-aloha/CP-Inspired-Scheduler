import pathlib

# ============ C) shared: CfPickRow component + extract CfDefModal ============
pathlib.Path('src/components/CfPick.jsx').write_text('''import React from 'react'
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
''')

mv = pathlib.Path('src/components/MastersView.jsx'); s = mv.read_text()
i0 = s.index('function CfDefModal({ def, onClose })')
head = s[:i0]
body = s[i0:]
pathlib.Path('src/components/CfDefModal.jsx').write_text(
  "import React, { useEffect, useState } from 'react'\n"
  "import { Icon } from '../ui/Icons'\n"
  "import { Dropdown } from './fields'\n"
  "import { CF_TYPES } from '../lib/master'\n\n"
  "/** The full custom-field template editor — shared by Masters → Custom Fields and\n"
  " *  the payer \"Add Custom Fields\" modal so there is exactly one place that defines fields. */\n"
  "export default function CfDefModal({ def, onClose })" + body[len('function CfDefModal({ def, onClose })'):])
mv.write_text(head + "import CfDefModal from './CfDefModal.jsx'\n" if False else head + "")
# append the import properly after existing import block
s2 = mv.read_text()
s2 = s2.replace("import { Icon } from '../ui/Icons'", "import { Icon } from '../ui/Icons'\nimport CfDefModal from './CfDefModal.jsx'", 1) if 'CfDefModal' not in s2.split('\n\n')[0] else s2
if 'import CfDefModal' not in s2:
    anchor = s2.index('\n\n', s2.index('import'))
    s2 = s2[:anchor] + "\nimport CfDefModal from './CfDefModal.jsx'" + s2[anchor:]
mv.write_text(s2)
assert "import CfDefModal from './CfDefModal.jsx'" in mv.read_text(), 'import failed'
# master page: button wording per the ask
mv_s = mv.read_text()
old = '{Icon.plus({ size: 12 })} New Template</button>'
assert old in mv_s; mv_s = mv_s.replace(old, '{Icon.plus({ size: 12 })} Add Custom Field</button>', 1)
mv.write_text(mv_s)
print('C) shared picker row + CfDefModal extract OK')

# ============ D) AppointmentModal: master-picked ONLY, one “Add Custom Fields” ============
p = pathlib.Path('src/components/AppointmentModal.jsx'); s = p.read_text()
old = """  const pcfSel = payerFieldDefs(state, billPayer).filter((d) => d.label)
  // chunk-35: fields are selectable everywhere, never pre-selected — if the payer hasn't
  // picked templates yet, the appointment can still add any ACTIVE master template.
  const pcfAll = billPayer ? (state.customFields || []).filter((d) => d.label && d.status !== 'inactive') : []
  const pcfDefs = pcfSel.length ? pcfSel : pcfAll
"""
new = """  // chunk-36: appointments offer ONLY the payer's picked, master-defined templates.
  // Nothing pre-selects, nothing is addable that doesn't exist in the Custom Fields
  // master, and legacy inline entries can never reach an appointment.
  const pcfDefs = payerFieldDefs(state, billPayer).filter((d) => d.label && d.source === 'master')
"""
assert old in s; s = s.replace(old, new, 1)
old = """<i>{(pcfSel.length ? 'optional · only fields you add below are captured' : pcfDefs.length ? 'optional · pick any active master template' : 'optional · none defined on Masters → Custom Fields')}</i>"""
new = """<i>optional · nothing pre-filled · add only what {billPayer.name}’s profile picks</i>"""
assert old in s, 'head note anchor'; s = s.replace(old, new, 1)
old = '{Icon.plus({ size: 12 })} Add field</button>'
assert old in s; s = s.replace(old, '{Icon.plus({ size: 12 })} Add Custom Fields</button>', 1)
old = 'No custom fields on this appointment — pick from {pcfDefs.length} payer template{pcfDefs.length === 1 ? \'\'} with “Add field”. Nothing is enforced unless a template itself is required.'
assert old in s
s = s.replace(old, 'Nothing pre-filled — “Add Custom Fields” offers the {pcfDefs.length} field{pcfDefs.length === 1 ? \'\' : \'s\'} this payer picked on the master. Nothing is enforced unless a template itself is required.', 1)
# picker rows → CfPickRow (aligned list) — replace the whole svc-pickrows block inside am-pcf-picker
old = """                            <div className="modal-body">
                              <div className="svc-pickrows">
                                {pcfDefs.map((d) => {
                                  const on = (f.pcfs || {})[d.id] !== undefined
                                  return (
                                    <label key={d.id} className={`svc-pickrow${on ? ' on' : ''}`} data-testid={`am-pcf-pick-${d.id}`}>
                                      <input type="checkbox" checked={on} onChange={(e) => {
                                        const n = { ...(f.pcfs || {}) }
                                        if (e.target.checked) n[d.id] = { label: d.label, type: d.type, value: d.type === 'multi' ? [] : '' }
                                        else delete n[d.id]
                                        set({ pcfs: n })
                                      }} />
                                      <b>{d.label}</b>
                                      <span className="pcf-type">{cfTypeLabel(d.type)}</span>
                                      {d.required ? <span className="tag warn">Required</span> : null}
                                      {(d.options || []).length ? <span className="muted">{d.options.join(' · ')}</span> : <span className="muted">{d.note || ''}</span>}
                                    </label>
                                  )
                                })}
                              </div>
                            </div>"""
new = """                            <div className="modal-body">
                              <div className="cf-picklist">
                                {pcfDefs.map((d) => {
                                  const on = (f.pcfs || {})[d.id] !== undefined
                                  return (
                                    <CfPickRow key={d.id} def={d} on={on} testid={`am-pcf-pick-${d.id}`}
                                      onToggle={(v) => {
                                        const n = { ...(f.pcfs || {}) }
                                        if (v) n[d.id] = { label: d.label, type: d.type, value: d.type === 'multi' ? [] : '' }
                                        else delete n[d.id]
                                        set({ pcfs: n })
                                      }} />
                                  )
                                })}
                              </div>
                            </div>"""
assert old in s, 'am picker block anchor'; s = s.replace(old, new, 1)
s = s.replace("import { svcList, payerForAppt, ensurePayer, svcRule, concurrentNote, svcOptionsFor, svcById, payerFieldDefs, pcfsErrors, rateFor, cfTypeLabel } from '../lib/master'",
              "import { svcList, payerForAppt, ensurePayer, svcRule, concurrentNote, svcOptionsFor, svcById, payerFieldDefs, pcfsErrors, rateFor } from '../lib/master'\nimport { CfPickRow } from './CfPick.jsx'", 1)
assert 'CfPickRow' in s
p.write_text(s)
print('D) appointment modal OK')

# ============ E) PayerDetail: ONE “Add Custom Fields” button; picker modal also manages ============
p = pathlib.Path('src/components/PayerDetail.jsx'); s = p.read_text()
# card head: drop the standalone Manage button (only ONE entry point on the profile)
old = """        <div className="an-head">{Icon.badge({ size: 13 })} Custom Fields{fields.length > 0 && <span className="pd-cfn">{fields.length}</span>}<span className="an-spacer" />
          <button className="btn btn-sm" data-testid="pd-cf-gomaster" title="Define templates on the Masters → Custom Fields page" onClick={() => actions.setUI({ payerSel: null, mastersTab: 'cfdefs' })}>{Icon.clipboard({ size: 11 })} Manage templates</button>
        </div>
        <p className="pd-note">Fields are defined once in the Custom Fields master — this payer only picks which ones apply. They then appear on appointments and exports automatically.</p>"""
new = """        <div className="an-head">{Icon.badge({ size: 13 })} Custom Fields{fields.length > 0 && <span className="pd-cfn">{fields.length}</span>}<span className="an-spacer" />
          <span className="muted" style={{ fontSize: 10.6 }}>selectable · never pre-selected</span>
        </div>
        <p className="pd-note">Fields are defined once in the Custom Fields master — this payer only picks which ones apply. They then appear on appointments and exports automatically.</p>"""
assert old in s; s = s.replace(old, new, 1)
# single button, exact wording
old = '<button className="btn btn-sm btn-primary" data-testid="pd-cf-pick" onClick={() => setPick(true)}>{Icon.plus({ size: 12 })} Pick fields from the master</button>'
assert old in s
s = s.replace(old, '<button className="btn btn-sm btn-primary" data-testid="pd-cf-pick" onClick={() => setPick(true)}>{Icon.plus({ size: 12 })} Add Custom Fields</button>', 1)
# state + handlers for in-modal management
old = "  const [pick, setPick] = useState(false)"
assert old in s
s = s.replace(old, old + "\n  const [cfEdit, setCfEdit] = useState(null) // 'new' | def — full editor, opened from INSIDE the picker", 1)
old = "  const setFields = (ids) => patch({ cf: ids }, 'custom fields updated from the master')"
new = """  const toast = useToast()
  const usedBy = (id) => (state.payers || []).filter((x) => (x.cf || []).includes(id)).length
  const saveCf = (v) => {
    if (!v || typeof v !== 'object' || 'nativeEvent' in v || v.target) { setCfEdit(null); return }
    if (cfEdit === 'new') { actions.addCfDef(v); toast({ message: `Template “${v.label}” created — tick it for ${p.name} to apply`, kind: 'ok' }) }
    else { actions.updateCfDef({ id: cfEdit.id, ...v }); toast({ message: `Template “${v.label}” updated — every payer using it follows`, kind: 'ok' }) }
    setCfEdit(null)
  }
  const delDef = (t) => {
    const n = usedBy(t.id)
    if (n) { toast({ message: `“${t.label}” is picked by ${n} payer${n === 1 ? '' : 's'} — unlink it there first`, kind: 'error' }); return }
    actions.removeCfDef(t.id)
    toast({ message: `Template “${t.label}” removed from the master`, kind: 'info' })
  }
  const setFields = (ids) => patch({ cf: ids }, 'custom fields updated from the master')"""
assert old in s; s = s.replace(old, new, 1)
# rebuild the picker modal: aligned list + per-row manage actions + new-template in the footer
old = """      {pick && (
        <div className="overlay pm-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) setPick(false) }}>
          <div className="modal pm-modal py-modal" data-testid="pd-cf-picker" role="dialog" aria-modal="true" aria-label="Pick custom fields">
            <div className="modal-head pm-head">
              <h3>Custom Fields — {p.name}</h3>
              <span className="muted" style={{ fontSize: 11.5, marginLeft: 10 }}>tick the templates this payer requires</span>
              <span className="an-spacer" />
              <button className="iconbtn modal-x" aria-label="Close" data-testid="pd-cf-picker-close" onClick={() => setPick(false)}>{Icon.x({ size: 14 })}</button>
            </div>
            <div className="modal-body">
              {templates.length === 0 && <div className="muted pd-cfempty">No templates defined yet — create them on Masters → Custom Fields first.</div>}
              <div className="svc-pickrows">
                {templates.map((t) => {
                  const on = (p.cf || []).includes(t.id)
                  return (
                    <label key={t.id} className={`svc-pickrow${on ? ' on' : ''}${t.status === 'inactive' && !on ? ' dim' : ''}`} data-testid={`pd-cfpick-${t.id}`}>
                      <input type="checkbox" checked={on} disabled={t.status === 'inactive' && !on} onChange={(e) => setFields(e.target.checked ? [...(p.cf || []), t.id] : (p.cf || []).filter((x) => x !== t.id))} />
                      <b>{t.label}</b>
                      <span className="pcf-type">{cfTypeLabel(t.type)}</span>
                      {t.required ? <span className="tag warn">Required</span> : null}
                      {t.status === 'inactive' ? <span className="muted">inactive</span> : <span className="muted">{t.note || ''}</span>}
                    </label>
                  )
                })}
              </div>
            </div>
            <div className="modal-foot"><button className="btn btn-sm btn-primary" onClick={() => { setPick(false) }}>Done</button></div>
          </div>
        </div>
      )}"""
new = """      {pick && (
        <div className="overlay pm-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) setPick(false) }}>
          <div className="modal pm-modal py-modal" data-testid="pd-cf-picker" role="dialog" aria-modal="true" aria-label="Add custom fields">
            <div className="modal-head pm-head">
              <h3>Add Custom Fields — {p.name}</h3>
              <span className="muted" style={{ fontSize: 11.5, marginLeft: 10 }}>tick what this payer requires — or manage the definitions right here</span>
              <span className="an-spacer" />
              <span className="muted" style={{ fontSize: 11, marginRight: 8 }}>{(p.cf || []).length} picked</span>
              <button className="iconbtn modal-x" aria-label="Close" data-testid="pd-cf-picker-close" onClick={() => setPick(false)}>{Icon.x({ size: 14 })}</button>
            </div>
            <div className="modal-body">
              {templates.length === 0 && <div className="muted pd-cfempty" style={{ padding: '18px 2px' }}>No templates defined yet — create the first one with “Add template” below.</div>}
              <div className="cf-picklist">
                {templates.map((t) => {
                  const on = (p.cf || []).includes(t.id)
                  const used = usedBy(t.id)
                  return (
                    <CfPickRow key={t.id} def={t} on={on} disabled={t.status === 'inactive' && !on} testid={`pd-cfpick-${t.id}`}
                      onToggle={(v) => setFields(v ? [...(p.cf || []), t.id] : (p.cf || []).filter((x) => x !== t.id))}>
                      <button className="iconbtn" title={`Used by ${used} payer${used === 1 ? '' : 's'}`} style={{ cursor: 'default', pointerEvents: 'none' }}><i className="muted" style={{ fontSize: 10, fontStyle: 'normal' }}>×{used}</i></button>
                      <button className="iconbtn" title="Edit this template — opens the full field editor" data-testid={`pd-cfm-edit-${t.id}`} onClick={(e) => { e.preventDefault(); e.stopPropagation(); setCfEdit(t) }}>{Icon.edit({ size: 12 })}</button>
                      <button className="iconbtn" title={used ? 'Unlink from every payer before deleting' : 'Delete this template from the master'} data-testid={`pd-cfm-del-${t.id}`} disabled={!!used} onClick={(e) => { e.preventDefault(); e.stopPropagation(); delDef(t) }}>{Icon.trash({ size: 12 })}</button>
                    </CfPickRow>
                  )
                })}
              </div>
            </div>
            <div className="modal-foot pm-foot">
              <button className="btn btn-sm" data-testid="pd-cfm-new" onClick={() => setCfEdit('new')}>{Icon.plus({ size: 12 })} Add template</button>
              <button className="btn btn-sm" data-testid="pd-cf-gomaster" title="Open the full Custom Fields master page" onClick={() => { setPick(false); actions.setUI({ payerSel: null, mastersTab: 'cfdefs' }) }}>{Icon.clipboard({ size: 11 })} Full master page</button>
              <span className="an-spacer" />
              <button className="btn btn-sm btn-primary" data-testid="pd-cf-picker-done" onClick={() => setPick(false)}>Done</button>
            </div>
          </div>
        </div>
      )}
      {cfEdit && (
        <div className="overlay pm-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) setCfEdit(null) }}>
          <CfDefModal def={cfEdit === 'new' ? null : cfEdit} onClose={saveCf} />
        </div>
      )}"""
assert old in s, 'picker modal anchor'; s = s.replace(old, new, 1)
s = s.replace("import { Dropdown, InlineSelect } from './fields'", "import { Dropdown, InlineSelect } from './fields'\nimport { CfPickRow } from './CfPick.jsx'\nimport CfDefModal from './CfDefModal.jsx'", 1)
p.write_text(s)
print('E) payer detail OK')
