import React, { useEffect, useMemo, useState } from 'react'
import { useStore } from '../state/store'
import { Icon } from '../ui/Icons'
import { useToast } from '../ui/Toast'
import { Dropdown, InlineSelect } from './fields'
import { CfPickRow } from './CfPick.jsx'
import CfDefModal from './CfDefModal.jsx'
import { PayerForm, RemoveArm } from './PayersView'
import { ensurePayer, svcList, localSvcs, MODIFIERS, POS_CODES, ROUNDINGS, CREDENTIALS, CF_TYPES, cfTypeLabel, payerFieldDefs } from '../lib/master'
import { BILL_CODES, uid } from '../lib/model'

/**
 * Payer deep record — opened by clicking a payer row. Three tabs mirroring how
 * payer admins work: Profile (identity, routing, typed custom fields),
 * Services (the payer's own contract sheet — master services plus payer-added
 * ones, each fully modifiable) and Billing Rules (concurrent billing, claim
 * form settings, appointment rules, qualification & POS modifiers, MUE limits).
 * Everything edits the live payer record — the scheduler and billing read the
 * rules back out of it.
 */
const RULE_SECTIONS = [
  { id: 'concurrent', label: 'Concurrent Billing', icon: 'shuffle' },
  { id: 'claims', label: 'Claims Settings', icon: 'file' },
  { id: 'appt', label: 'Appointment Settings', icon: 'cal' },
  { id: 'qual', label: 'Qualification Modifiers', icon: 'badge' },
  { id: 'pos', label: 'Place of Service Modifiers', icon: 'pin' },
  { id: 'mue', label: 'MUEs', icon: 'alert' },
]
const UNITS_OPTS = ['5 Minutes', '10 Minutes', '15 Minutes', '30 Minutes', '45 Minutes', '60 Minutes']
const MUE_LIMITS = ['No Limits', '96', '60', '45', '30', '24', '16', '8']
const money = (n) => `$${Number(n || 0).toFixed(2)}`

export default function PayerDetail({ payer, onBack }) {
  const state = useStore()
  const { actions } = state
  const toast = useToast()
  const [tab, setTab] = useState('profile')
  const [edit, setEdit] = useState(false)
  const p = ensurePayer(payer)

  const countFor = (name) => state.clients.filter((c) => (c.insurer || '') === name).length
  const removePayer = () => {
    const used = countFor(p.name)
    if (used) { toast({ message: `${p.name} still has ${used} client${used === 1 ? '' : 's'} on file — reassign them before removing`, kind: 'error' }); return false }
    actions.removePayer(p.id)
    toast({ message: `${p.name} removed from the directory`, kind: 'info' })
    onBack()
    return true
  }
  const patch = (changes, msg) => { actions.updatePayer({ id: p.id, ...changes }); if (msg) toast({ message: msg, kind: 'ok' }) }

  return (
    <div className="sectionpage pd" data-testid="payer-detail">
      <div className="pd-head">
        <button className="btn btn-sm pd-back" data-testid="pd-back" onClick={onBack}>{Icon.chevronL({ size: 12 })} Payers</button>
        <div className="pd-title">
          <b>{p.name}</b>
          {p.aka && <span className="muted">{p.aka}</span>}
          <span className={`tag${p.status === 'active' ? '' : ' off'}`}>{p.status === 'active' ? 'Active' : 'Inactive'}</span>
          {p.type && <span className="pd-chip">{p.type}</span>}
        </div>
        <div className="pd-actions">
          <button className="btn btn-sm" data-testid="pd-edit" onClick={() => setEdit(true)}>{Icon.edit({ size: 12 })} Edit record</button>
        </div>
      </div>

      <div className="pd-tabs" role="tablist">
        {[['profile', 'Profile'], ['services', 'Services'], ['rules', 'Billing Rules']].map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} className={`pd-tab${tab === id ? ' on' : ''}`} data-testid={`pd-tab-${id}`} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>

      {tab === 'profile' && <ProfileTab p={p} patch={patch} />}
      {tab === 'services' && <ServicesTab p={p} patch={patch} />}
      {tab === 'rules' && (
        <div className="pd-rules">
          <nav className="pr-nav">
            {RULE_SECTIONS.map((r) => (
              <RuleNavButton key={r.id} r={r} on={(state.ui.rulesTab || 'concurrent') === r.id} onClick={() => actions.setUI({ rulesTab: r.id })} />
            ))}
          </nav>
          <RuleEditor p={p} section={state.ui.rulesTab || 'concurrent'} patch={patch} />
        </div>
      )}

      {edit && (
        <div className="overlay pm-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) setEdit(false) }}>
          <PayerForm
            payer={payer}
            used={countFor(p.name)}
            onRemove={() => removePayer()}
            onClose={(v) => { if (v && typeof v === 'object' && !('nativeEvent' in v) && !v.target) { patch(v); toast({ message: `${v.name} updated`, kind: 'ok' }) } setEdit(false) }}
          />
        </div>
      )}
    </div>
  )
}

function RuleNavButton({ r, on, onClick }) {
  return (
    <button className={`pr-navbtn${on ? ' on' : ''}`} data-testid={`pr-tab-${r.id}`} onClick={onClick}>
      <span className="pr-nic">{Icon[r.icon]({ size: 13 })}</span>{r.label}
    </button>
  )
}

/* ── Profile ─────────────────────────────────────────────────────────── */
function ProfileTab({ p, patch }) {
  const state = useStore()
  const { actions } = state
  const [pick, setPick] = useState(false)
  const [cfEdit, setCfEdit] = useState(null) // 'new' | def — full editor, opened from INSIDE the picker
  const fields = payerFieldDefs(state, p)
  const templates = state.customFields || []
  const phone = (p.contacts || []).find((c) => c.kind === 'Main')?.number || ''
  const fax = (p.contacts || []).find((c) => c.kind === 'Fax')?.number || ''
  const portal = (p.contacts || []).find((c) => c.kind === 'Claims portal')?.number || ''
  const addr = [p.street, [p.city, p.state].filter(Boolean).join(' '), p.zip].filter(Boolean).join(', ')

  const toast = useToast()
  const usedBy = (id) => (state.payers || []).filter((x) => (x.cf || []).includes(id)).length
  const saveCf = (v) => {
    if (!v || typeof v !== 'object' || 'nativeEvent' in v || v.target) { setCfEdit(null); return }
    if (cfEdit === 'new') { actions.addCfDef(v); toast({ message: `Template “${v.label}” created — tick it for ${p.name} to apply`, kind: 'ok' }) }
    else { actions.updateCfDef({ id: cfEdit.id, ...v }); toast({ message: `Template “${v.label}” updated — every payer using it follows`, kind: 'ok' }) }
    setCfEdit(null)
  }
  const delDef = (t) => {
    const n = usedBy(t.id)
    if (n_used) { toast({ message: `“${t.label}” is picked by ${n_used} payer${n_used === 1 ? '' : 's'} — unlink it there first`, kind: 'error' }); return }
    actions.removeCfDef(t.id)
    toast({ message: `Template “${t.label}” removed from the master`, kind: 'info' })
  }
  const setFields = (ids) => patch({ cf: ids }, 'custom fields updated from the master')
  const unlink = (d) => setFields((p.cf || []).filter((x) => x !== d.defId && !(typeof x === 'object' && x && x.id === d.id)))
  const kv = (k, v) => <div className="pd-kv"><span>{k}</span><b>{v || <i className="muted">—</i>}</b></div>
  return (
    <div className="pd-body">
      <div className="an-card pd-card" data-testid="pd-info">
        <div className="an-head">{Icon.shield({ size: 13 })} Payer Info</div>
        <div className="pd-kvgrid">
          {kv('Payer Name', p.name)}
          {kv('Payer AKA', p.aka)}
          {kv('Payer Type', p.type)}
          {kv('CMS Type', p.cmsType)}
          {kv('Customized Format', p.format)}
          {kv('Payer ID', p.payerId)}
          {kv('Clearing House', p.clearingHouse)}
          {kv('Status', p.status === 'active' ? 'Active' : 'Inactive')}
        </div>
        <div className="pd-kvgrid" style={{ marginTop: 10 }}>
          {kv('Service Address', addr)}
          {p.addressNotes && kv('Address Notes', p.addressNotes)}
          {kv('Service Type List', p.svcList)}
          {kv('Completion Requirement', p.required)}
          {kv('Phone', phone && <a href={`tel:${phone.replace(/[^\d+]/g, '')}`}>{phone}</a>)}
          {kv('Fax', fax)}
          {kv('Email', p.email && <a href={`mailto:${p.email}`}>{p.email}</a>)}
          {kv('Claims Portal', portal)}
          {kv('EVV Payer ID', p.evvId)}
          {kv('Third Party ID', p.thirdPartyId)}
        </div>
      </div>

      <div className="an-card pd-card" data-testid="pd-cf">
        <div className="an-head">{Icon.badge({ size: 13 })} Custom Fields{fields.length > 0 && <span className="pd-cfn">{fields.length}</span>}<span className="an-spacer" />
          <span className="muted" style={{ fontSize: 10.6 }}>selectable · never pre-selected</span>
        </div>
        <p className="pd-note">Fields are defined once in the Custom Fields master — this payer only picks which ones apply. They then appear on appointments and exports automatically.</p>
        {fields.length === 0 && <div className="muted pd-cfempty">No fields picked yet.</div>}
        {fields.length > 0 && (
          <div className="pcf-rows" data-testid="pd-cf-list">
            {fields.map((d, i) => (
              <div className="pcf-row" key={d.defId || `i${i}`} data-testid={`pd-cf-${d.defId || i}`}>
                <span className="pcf-type">{cfTypeLabel(d.type)}</span>
                <b className="pcf-name">{d.label}</b>
                {d.type === 'toggle' ? <span className="tag soft">{d.onLabel || 'Yes'}</span> : null}
                {d.type === 'toggle' ? <span className="tag soft">{d.offLabel || 'No'}</span> : null}
                {(d.type === 'select' || d.type === 'multi') && (d.options || []).slice(0, 3).map((o) => <span className="tag soft" key={o}>{o}</span>)}
                {(d.options || []).length > 3 && <i className="muted cf-optmore">+{d.options.length - 3}</i>}
                {d.required ? <span className="tag warn">Required</span> : <span className="muted">Optional</span>}
                {d.source === 'inline' ? <span className="tag" title="Defined inline before templates existed — promote it to the master to reuse">legacy</span> : <span className="tag soft">from master</span>}
                {d.source === 'inline' && (
                  <button className="btn btn-sm cf-upbtn" data-testid={`pcf-upgrade-${d.id}`} title="Save as a reusable template in the Custom Fields master"
                    onClick={() => {
                      const slug = 'cf-' + String(d.label).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 28)
                      actions.addCfDef({ id: slug, label: d.label, type: d.type || 'text', options: d.options || [], onLabel: d.onLabel || 'Yes', offLabel: d.offLabel || 'No', required: Boolean(d.required), note: d.note || '' })
                      setFields((p.cf || []).map((x) => (x === d.label || (typeof x === 'object' && x && x.id === d.id) ? slug : x)))
                    }}>
                    {Icon.badge({ size: 11 })} Make template
                  </button>
                )}
                <button className="iconbtn" title="Unlink from this payer" data-testid={`pcf-unlink-${d.defId || d.id}`} onClick={() => unlink(d)}>{Icon.x({ size: 12 })}</button>
              </div>
            ))}
          </div>
        )}
        <div className="pd-cfadd">
          <button className="btn btn-sm btn-primary" data-testid="pd-cf-pick" onClick={() => setPick(true)}>{Icon.plus({ size: 12 })} Add Custom Fields</button>
          <span className="muted" style={{ fontSize: 11.5 }}>{templates.filter((t) => t.status !== 'inactive' && !(p.cf || []).includes(t.id)).length} template(s) not yet used by this payer</span>
        </div>
      </div>

      {pick && (
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
                      <button className="iconbtn" title={`Used by ${used} payer${used === 1 ? '' : 's'}`} style={{ cursor: 'default', pointerEvents: 'none', width: 'auto', padding: '0 4px' }}><i className="muted" style={{ fontSize: 10, fontStyle: 'normal' }}>×{used}</i></button>
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
      )}
    </div>
  )
}

/* ── Services — the payer's own contract sheet ──────────────────────────── */
function ServicesTab({ p, patch }) {
  const state = useStore()
  const toast = useToast()
  const [picker, setPicker] = useState(false)
  const [form, setForm] = useState(null) // {mode:'new'} | {mode:'local', svc} | {mode:'linked', svc(master)}
  const all = svcList(state)
  const mine = localSvcs(p)
  const linkedIds = p.services.length ? p.services : all.filter((s) => s.status !== 'inactive').map((s) => s.id)
  const linked = all.filter((s) => linkedIds.includes(s.id))
  const cards = [
    ...linked.map((s) => ({ kind: 'linked', key: `L${s.id}`, master: s, id: s.id })),
    ...mine.map((s) => ({ kind: 'local', key: `P${s.id}`, local: s, id: s.id })),
  ]
  const toggleSvc = (id, on) => {
    const set = new Set(linked.map((x) => x.id))
    if (on) set.add(id); else set.delete(id)
    patch({ services: [...set] })
  }
  const unlink = (card) => {
    if (card.kind === 'local') {
      patch({ svcs: mine.filter((x) => x.id !== card.id) }, `${card.local.label} removed from this payer`)
    } else {
      const svcId = card.master.id
      const ovs = { ...(p.svcOv || {}) }
      delete ovs[svcId]
      patch({ services: linked.map((x) => x.id).filter((x) => x !== svcId), svcOv: ovs, svcs: mine.filter((x) => x.ref !== svcId) }, `${card.master.label} uncontracted`)
    }
    setForm(null)
  }
  const saveSvc = (vals) => {
    if (!vals) { setForm(null); return }
    if (vals.__clear) {
      const ovs = { ...(p.svcOv || {}) }
      delete ovs[form.svc.id]
      patch({ svcOv: ovs }, `Override cleared for ${form.svc.label}`)
      setForm(null)
      return
    }
    if (form.mode === 'linked') {
      patch({ svcOv: { ...(p.svcOv || {}), [form.svc.id]: vals } }, `Contract line saved for ${form.svc.label}`)
    } else {
      const rec = { ref: null, status: 'active', ...vals, id: form.mode === 'local' ? form.svc.id : uid() }
      patch({ svcs: form.mode === 'local' ? mine.map((x) => (x.id === rec.id ? rec : x)) : [...mine, rec] }, `${rec.label} ${form.mode === 'local' ? 'updated on' : 'added to'} ${p.name}`)
    }
    setForm(null)
  }
  return (
    <div className="pd-body">
      <div className="pd-svctools">
        {!p.services.length && <div className="pd-note pd-allnote" data-testid="pd-svc-all">{Icon.info({ size: 12 })} No explicit contract — billing treats every active service type as contracted. “Contract services” narrows the list; “Add Service” creates one only for {p.name}.</div>}
        <span className="an-spacer" />
        <button className="btn btn-sm" data-testid="pd-svc-contract" onClick={() => setPicker(true)}>{Icon.clipboard({ size: 12 })} Contract services</button>
        <button className="btn btn-sm btn-primary" data-testid="pd-svc-add" onClick={() => setForm({ mode: 'new' })}>{Icon.plus({ size: 12 })} Add Service</button>
      </div>
      <div className="svc-cards" data-testid="pd-svc-cards">
        {cards.length === 0 && <div className="muted pd-cfempty">No services on this payer yet — use “Add Service” above to create a payer-specific one, or “Contract services” to attach service types from the master.</div>}
        {cards.map((c) => {
          const o = c.kind === 'linked' ? ((p.svcOv || {})[c.master.id] || {}) : c.local
          const label = c.kind === 'linked' ? (o.label || c.master.label) : c.local.label
          const inactive = c.kind === 'local' && c.local.status === 'inactive'
          const hasOvr = c.kind === 'linked' && Object.keys(o).length > 0
          return (
            <div className={`svc-card${inactive ? ' off' : ''}`} key={c.key} data-testid={`pd-svc-${c.id}`}>
              <div className="svc-cardhead">
                <b>{label}</b>
                <span className="tag">{o.code || c.master?.code || ''}</span>
                {c.kind === 'local' && <span className="pd-chip" title="Created on this payer — not in the global master">payer-only</span>}
                <span className="svc-cardacts">
                  <button className="iconbtn" title="Modify this service line" data-testid={`pd-ovr-${c.id}`} onClick={() => setForm(c.kind === 'linked' ? { mode: 'linked', svc: c.master } : { mode: 'local', svc: c.local })}>{Icon.edit({ size: 12 })}</button>
                  <button className="iconbtn" title={c.kind === 'linked' ? 'Uncontract this service for this payer' : 'Delete from this payer'} data-testid={`pd-unlink-${c.id}`} onClick={() => unlink(c)}>{Icon.trash({ size: 12 })}</button>
                </span>
              </div>
              <div className="svc-dates">
                <span className={`svc-date${o.effective ? ' on' : ''}`}>{o.effective ? `Effective ${o.effective}` : 'No effective date'}</span>
                <span className={`svc-date${o.expiration ? ' exp' : ''}`}>{o.expiration ? `Expires ${o.expiration}` : 'No expiration'}</span>
                {inactive && <span className="svc-date off">Inactive — hidden in booking</span>}
              </div>
              <div className="svc-rows">
                <div><span>Billing Code</span><b>{o.billingCode || o.code || c.master?.code || '—'}</b></div>
                <div><span>Dx Code 1</span><b>{o.dx1 || '—'}</b></div>
                <div><span>Dx Code 2</span><b>{o.dx2 || '—'}</b></div>
                <div><span>Unit Size</span><b>{o.unitSize || (c.master ? `${c.master.unitMins} Minutes` : '—')}</b></div>
                <div><span>Charge Rate</span><b className={hasOvr || c.kind === 'local' ? 'ovr' : ''}>{money(o.charge === '' || o.charge == null ? (c.master ? c.master.rate : 0) : o.charge)}</b></div>
                <div><span>Rounding</span><b>{o.rounding || c.master?.rounding || 'AMA'}</b></div>
                <div><span>Contract Rate</span><b>{o.contract ? money(o.contract) : '—'}</b></div>
                <div><span>Modifier</span><b>{o.modifier || '—'}</b></div>
                <div><span>Third Party ID</span><b>{o.thirdParty || '—'}</b></div>
              </div>
              <div className="svc-creds">
                <span>Required Credentials (AND)</span>
                <div>{(c.local?.credentials || c.master?.credentials || []).length ? (c.local?.credentials || c.master?.credentials).map((x) => <span className="tag" key={x}>{x}</span>) : <i className="muted">None</i>}</div>
              </div>
              <button className="btn btn-sm svc-ovrbtn" data-testid={`pd-ovrbtn-${c.id}`} onClick={() => setForm(c.kind === 'linked' ? { mode: 'linked', svc: c.master } : { mode: 'local', svc: c.local })}>
                {Icon.edit({ size: 12 })} Edit this service line{hasOvr || c.kind === 'local' ? ' — overrides active' : ' — set modifier, charge &amp; contract rate'}
              </button>
            </div>
          )
        })}
      </div>
      <button className="svc-fab" data-testid="pd-svc-fab" title="Add service — contract from the master or create a payer-only one" onClick={() => setPicker(true)}>{Icon.plus({ size: 16 })}</button>

      {picker && (
        <div className="overlay pm-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) setPicker(false) }}>
          <div className="modal pm-modal py-modal" data-testid="pd-svc-picker" role="dialog" aria-modal="true" aria-label="Contracted services">
            <div className="modal-head pm-head">
              <h3>Services — {p.name}</h3>
              <span className="muted" style={{ fontSize: 11.5, marginLeft: 10 }}>tick what this payer reimburses</span>
              <span className="an-spacer" />
              <button className="btn btn-sm btn-primary" data-testid="pd-svc-new" onClick={() => { setPicker(false); setForm({ mode: 'new' }) }}>{Icon.plus({ size: 12 })} New payer-only service</button>
              <button className="iconbtn modal-x" aria-label="Close" data-testid="pd-svc-picker-close" onClick={() => setPicker(false)}>{Icon.x({ size: 14 })}</button>
            </div>
            <div className="modal-body">
              <div className="svc-pickrows">
                {all.map((s) => {
                  const on = linkedIds.includes(s.id)
                  return (
                    <label className={`svc-pickrow${on ? ' on' : ''}`} key={s.id} data-testid={`pd-pick-${s.id}`}>
                      <input type="checkbox" checked={on} onChange={(e) => toggleSvc(s.id, e.target.checked)} />
                      <b>{s.label}</b><span className="muted">{s.code} · {money(s.rate)}/unit</span>
                    </label>
                  )
                })}
              </div>
            </div>
            <div className="modal-foot"><button className="btn btn-sm btn-primary" onClick={() => { setPicker(false); toast({ message: 'Contracted services updated', kind: 'ok' }) }}>Done</button></div>
          </div>
        </div>
      )}

      {form && <PayerSvcForm payer={p} form={form} onClose={() => setForm(null)} onSave={saveSvc} />}
    </div>
  )
}

/** The Add/Edit Service modal — payer-scoped contract line, per the practice's service form. */
function PayerSvcForm({ payer, form, onClose, onSave }) {
  const toast = useToast()
  const linked = form.mode === 'linked'
  const o = linked ? ((payer.svcOv || {})[form.svc.id] || {}) : (form.svc || {})
  const [f, setF] = useState(() => ({
    label: linked ? (o.label || form.svc.label) : (form.svc?.label || ''),
    status: form.mode === 'local' ? (form.svc.status || 'active') : 'active',
    charge: o.charge ?? (linked ? form.svc.rate : '') ?? '',
    contract: o.contract ?? '',
    unitSize: o.unitSize || (linked ? `${form.svc.unitMins} Minutes` : '30 Minutes'),
    rounding: o.rounding || (linked ? form.svc.rounding : 'AMA') || 'AMA',
    credentials: o.credentials || (linked ? form.svc.credentials : []) || [],
    dx1: o.dx1 || '', dx2: o.dx2 || '',
    code: o.code || o.billingCode || (linked ? form.svc.code : '97151'),
    modifier: o.modifier || '', thirdParty: o.thirdParty || '',
    effective: o.effective || '', expiration: o.expiration || '',
  }))
  const [errs, setErrs] = useState({})
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  const set = (k, v) => { setF((x) => ({ ...x, [k]: v })); setErrs((e) => ({ ...e, [k]: undefined })) }
  const creating = form.mode === 'new'
  const save = () => {
    const E = {}
    // Creating a payer-only service mirrors the intake form: the starred fields must be filled.
    // Editing an existing line (linked or local) never blocks — blank rates simply inherit.
    if (creating) {
      if (!String(f.label).trim()) E.label = 'Name the service'
      if (f.charge === '' || f.charge == null || !Number.isFinite(Number(f.charge))) E.charge = 'Charge rate is required (use 0 for none)'
      if (!f.unitSize) E.unitSize = 'Unit size is required'
      if (!f.code) E.code = 'Pick a billing code'
      if (!String(f.dx1).trim()) E.dx1 = 'Primary Dx code is required'
    } else {
      if (String(f.charge).trim() !== '' && !Number.isFinite(Number(f.charge))) E.charge = 'Charge rate must be a number'
      if (String(f.contract).trim() !== '' && !Number.isFinite(Number(f.contract))) E.contract = 'Contract rate must be a number'
    }
    if (Object.keys(E).length) {
      setErrs(E)
      toast({ message: `Check ${Object.keys(E).length} highlighted field${Object.keys(E).length === 1 ? '' : 's'} before saving`, kind: 'error' })
      setTimeout(() => document.querySelector('.ovr-form .pm-err')?.scrollIntoView?.({ block: 'center', behavior: 'smooth' }), 30)
      return
    }
    const num = (v) => (String(v).trim() === '' ? '' : Number(v))
    onSave({ ...f, label: String(f.label).trim(), charge: creating ? Number(f.charge || 0) : num(f.charge), contract: num(f.contract) })
  }
  const Fld = ({ k, label, req, children, hint, half }) => (
    <label className={`bil-fld pm-fld${half ? '' : ' pcf-full'}`}>
      <span>{label}{req && ' *'}</span>
      {children || <input className={`input${errs[k] ? ' err' : ''}`} value={f[k] ?? ''} placeholder={errs[k] ? '' : hint || ''} data-testid={`ovr-${k}`} onChange={(e) => set(k, e.target.value)} />}
      {errs[k] && <i className="pm-err">{errs[k]}</i>}
    </label>
  )
  return (
    <div className="modal pm-modal py-modal ovr-form" data-testid="ovr-modal" role="dialog" aria-modal="true" aria-label={linked ? `Service line — ${form.svc.label}` : form.mode === 'local' ? `Edit service — ${form.svc.label}` : 'Add Service'} tabIndex={-1}>
      <div className="modal-head pm-head">
        <h3>{linked ? `Service — ${form.svc.label}` : form.mode === 'local' ? `Service — ${form.svc.label}` : 'Add Service'}</h3>
        <span className="muted" style={{ fontSize: 11.5, marginLeft: 10 }}>for {payer.name}</span>
        <span className="an-spacer" />
        <button className="iconbtn modal-x" aria-label="Close" data-testid="ovr-close" onClick={onClose}>{Icon.x({ size: 14 })}</button>
      </div>
      <div className="modal-body">
        <div className="ovr-top">
          <Fld k="label" label="Service Name" req={false} hint={linked ? '' : 'e.g. Parent Coaching — Telehealth'}>
            {linked
              ? <div className="ovr-lockname" data-testid="ovr-label-locked" title="Master service name — change it on the Service Types master">{form.svc.label}</div>
              : <input className={`input${errs.label ? ' err' : ''}`} value={f.label} data-testid="ovr-label" placeholder="New payer-only service" onChange={(e) => set('label', e.target.value)} />}
          </Fld>
          {!linked && (
            <div className="pcf-status">
              <span>Status</span>
              <button type="button" className={`toggle${f.status === 'active' ? ' on' : ''}`} data-testid="ovr-status" aria-pressed={f.status === 'active'} onClick={() => set('status', f.status === 'active' ? 'inactive' : 'active')} />
              <i>{f.status === 'active' ? 'Active' : 'Inactive'}</i>
            </div>
          )}
        </div>
        <div className="py-two">
          <Fld k="charge" label="Charge Rate ($/unit)" req hint={linked ? String(form.svc.rate) : '0.00'}><input className={`input${errs.charge ? ' err' : ''}`} inputMode="decimal" value={f.charge} data-testid="ovr-charge" onChange={(e) => set('charge', e.target.value)} /></Fld>
          <Fld k="contract" label="Contract Rate ($/unit)" hint="negotiated net" />
        </div>
        <div className="py-two">
          <Fld k="unitSize" label="Unit Size" req>
            <Dropdown testid="ovr-unitSize" value={f.unitSize} onChange={(v) => set('unitSize', v)} options={UNITS_OPTS.map((u) => ({ value: u, label: u }))} />
          </Fld>
          <Fld k="rounding" label="Rounding">
            <Dropdown testid="ovr-rounding" value={f.rounding} onChange={(v) => set('rounding', v)} options={ROUNDINGS.map((u) => ({ value: u, label: u }))} />
          </Fld>
        </div>
        <Fld k="credentials" label={`Required Credentials (AND, not OR)`} half>
          <div className="st-credchips" data-testid="ovr-creds">
            {CREDENTIALS.map((c) => (
              <button key={c} type="button" className={`tag pick${f.credentials.includes(c) ? ' on' : ''}`} data-testid={`ovr-cred-${c}`} disabled={linked} title={linked ? 'Master-level — change on the Service Types list' : 'Toggle'} onClick={() => set('credentials', f.credentials.includes(c) ? f.credentials.filter((x) => x !== c) : [...f.credentials, c])}>{c}</button>
            ))}
          </div>
        </Fld>
        <div className="py-two">
          <Fld k="dx1" label="Dx Code 1" req><input className={`input${errs.dx1 ? ' err' : ''}`} value={f.dx1} placeholder="F84.0" data-testid="ovr-dx1" onChange={(e) => set('dx1', e.target.value)} /></Fld>
          <Fld k="dx2" label="Dx Code 2" hint="optional" />
        </div>
        <div className="py-two">
          <Fld k="code" label="Billing Code" req>
            <Dropdown testid="ovr-code" value={f.code} onChange={(v) => set('code', v)} options={BILL_CODES.map((c) => ({ value: c.id, label: c.id, sub: c.label.split(' · ')[1] }))} />
          </Fld>
          <Fld k="modifier" label="Add Modifier">
            <Dropdown testid="ovr-modifier" value={f.modifier} onChange={(v) => set('modifier', v)} options={[{ value: '', label: '— none —' }, ...MODIFIERS.map((m) => ({ value: m, label: m }))]} />
          </Fld>
        </div>
        <div className="py-two">
          <Fld k="thirdParty" label="Third party ID" hint={payer.payerId || 'optional'} />
        </div>
        <div className="py-two">
          <Fld k="effective" label="Effective Date" half><input className="input" type="date" value={f.effective} data-testid="ovr-effective" onChange={(e) => set('effective', e.target.value)} /></Fld>
          <Fld k="expiration" label="Expiration Date" half><input className="input" type="date" value={f.expiration} data-testid="ovr-expiration" onChange={(e) => set('expiration', e.target.value)} /></Fld>
        </div>
      </div>
      <div className="modal-foot pm-foot">
        {linked && (payer.svcOv || {})[form.svc.id] && <button className="btn btn-sm" data-testid="ovr-clear" onClick={() => onSave({ __clear: true })}>{Icon.trash({ size: 12 })} Clear override</button>}
        <span className="an-spacer" />
        <button className="btn btn-sm" onClick={onClose}>Cancel</button>
        <button className="btn btn-sm btn-primary" data-testid="ovr-save" onClick={save}>Save</button>
      </div>
    </div>
  )
}

/* ── Billing rules ─────────────────────────────────────────────────────── */
function RuleEditor({ p, section, patch }) {
  const [nonce, setNonce] = useState(0)
  const draftKey = `${p.id}:${section}:${nonce}`
  return <RuleBody key={draftKey} p={p} section={section} patch={patch} saved={() => setNonce((n) => n + 1)} />
}

function RuleBody({ p, section, patch, saved }) {
  const state = useStore()
  const rules = p.rules
  const commit = (key, val, msg) => {
    patch({ rules: { ...rules, [key]: val } }, msg || 'Billing rules saved')
    saved()
  }

  const [conc, setConc] = useState(() => ({ ...rules.concurrent, rules: (rules.concurrent.rules || []).map((r) => ({ ...r })) }))
  const [clm, setClm] = useState(() => ({ ...rules.claims, flags: { ...rules.claims.flags } }))
  const [appt, setAppt] = useState(() => ({ ...rules.appt }))
  const [qm, setQm] = useState(() => rules.qualMods.map((r) => ({ ...r })))
  const [pos, setPos] = useState(() => ({ rows: rules.posMods.map((r) => ({ ...r })), hideTeleOther: rules.hideTeleOther, hideTeleHome: rules.hideTeleHome }))
  const [mue, setMue] = useState(() => ({ daily: rules.mue.daily || '', per: { ...(rules.mue.per || {}) } }))
  const svcOpts = useMemo(() => [...svcList(state).map((s) => ({ value: s.id, label: s.label, sub: s.code })), ...(state.payers || []).flatMap((x) => localSvcs(x)).map((s) => ({ value: s.id, label: `${s.label}`, sub: 'payer service' }))], [state.svcs, state.payers])

  if (section === 'concurrent') {
    const upd = (i, k, v) => setConc((c) => ({ ...c, rules: c.rules.map((r, j) => (j === i ? { ...r, [k]: v } : r)) }))
    return (
      <div className="pr-sec" data-testid="pr-concurrent">
        <SecHead t="Concurrent Billing" s="Two or more overlapping service types for the same client on the same slot." />
        <div className="pr-seg">
          <button className={`pd-opt${conc.allowed ? ' on' : ''}`} data-testid="conc-allowed" onClick={() => setConc({ ...conc, allowed: true })}><b>Allowed</b><span>Overlapping codes may be billed together.</span></button>
          <button className={`pd-opt${!conc.allowed ? ' on' : ''}`} data-testid="conc-notallowed" onClick={() => setConc({ ...conc, allowed: false })}><b>Not Allowed</b><span>Overlapping service hours are flagged and merged before the claim is built.</span></button>
        </div>
        <div className="pr-rulebox">
          <div className="pr-rulehead">Rules<span>if an appointment for one service overlaps another, bill only the winner</span></div>
          {(conc.rules || []).map((r, i) => (
            <div className="pr-rulerow" key={i} data-testid={`conc-rule-${i}`}>
              <em>If</em><Dropdown testid={`conc-if-${i}`} value={r.if || ''} onChange={(v) => upd(i, 'if', v)} options={svcOpts} placeholder="select service" />
              <em>overlaps with</em><Dropdown testid={`conc-with-${i}`} value={r.with || ''} onChange={(v) => upd(i, 'with', v)} options={svcOpts} placeholder="select service" />
              <em>then bill</em><Dropdown testid={`conc-bill-${i}`} value={r.bill || ''} onChange={(v) => upd(i, 'bill', v)} options={svcOpts} placeholder="select service" />
              <button className="iconbtn" title="Remove rule" data-testid={`conc-del-${i}`} onClick={() => setConc({ ...conc, rules: conc.rules.filter((_, j) => j !== i) })}>{Icon.trash({ size: 12 })}</button>
            </div>
          ))}
          <button className="btn btn-sm pr-addrule" data-testid="conc-add" onClick={() => setConc({ ...conc, rules: [...(conc.rules || []), { if: '', with: '', bill: '' }] })}>{Icon.plus({ size: 12 })} Add rule</button>
        </div>
        <SaveRow onSave={() => {
          const clean = { ...conc, rules: (conc.rules || []).filter((r) => r.if && r.with && r.bill) }
          commit('concurrent', clean, clean.allowed ? 'Concurrent billing allowed' : 'Concurrent billing restricted')
        }} onCancel={saved} />
      </div>
    )
  }

  if (section === 'claims') {
    const opts = (arr) => [{ value: '—', label: '—' }, ...arr.map((x) => ({ value: x, label: x }))]
    const sel = (k, label, list, hint) => (
      <div className="pr-frow" data-testid={`clm-row-${k}`}>
        <span className="pr-flabel" title={hint || ''}>{label}</span>
        <Dropdown testid={`clm-${k}`} value={clm[k] || '—'} onChange={(v) => setClm({ ...clm, [k]: v })} options={opts(list)} />
      </div>
    )
    const chk = (k, label) => (
      <label className="pr-check"><input type="checkbox" checked={Boolean(clm.flags[k])} data-testid={`clm-flag-${k}`} onChange={(e) => setClm({ ...clm, flags: { ...clm.flags, [k]: e.target.checked } })} /><span>{label}</span></label>
    )
    return (
      <div className="pr-sec" data-testid="pr-claims">
        <SecHead t="Claims Settings" s="Boxes and routing options applied when this payer’s CMS-1500 is assembled." />
        <div className="pr-fields">
          {sel('separateBy', 'Separate Claim By', ['Rendering Provider', 'Service Provider', 'Supervising Provider', 'Place of Service'], 'Split claims that would otherwise mix these values')}
          {sel('box17', 'Box 17 — Referring Provider', ['Display only when rendering provider is different', 'Always Display Referring Provider', 'Do not display Referring Provider', 'Always Display if a Referring Provider exists, even if same as billing provider'])}
          {sel('box19', 'Box 19 — Continue Hospital Info', ['Display only when rendering provider is different', 'Always Display Referring Provider', 'Do not display Referring Provider'])}
          {sel('box32', 'Box 32 — Service Facility Name & Location', ['Auto-populate if blank, leave blank if same as billing NPI', 'Always display Service Facility Name and Location', 'Never display Service Facility Name and Location'])}
          {sel('box33B', 'Box 33B — Payer ID Type', ['—', 'Medicaid Number', 'Group Number', 'Payer ID', 'NPI'], 'Only shown when it differs from Box 33A')}
          {sel('box33B2', 'Secondary Payer — ID Type', ['—', 'Medicaid Number', 'Group Number', 'Payer ID', 'NPI'])}
          {sel('file', 'Claim File Options', ['One file per claim', 'One claim per file', 'One file per payer per day'], 'How claim files are grouped for the clearing house')}
          {sel('apptTime', 'Include Appointment Time on Claim', ['Do not include', 'Include appointment start time', 'Include appointment start & end time'])}
        </div>
        <div className="pr-checks">
          {chk('renderProvider', 'Use Service Provider as Rendering Provider')}
          {chk('renderTaxo', 'Include Rendering Provider Taxonomy Code on Claim')}
          {chk('billTaxo', 'Include Billing Provider Taxonomy Code on Claim')}
          {chk('mergeSameDay', 'Merge appointments for same day, same client and same service provider into one charge line')}
        </div>
        <SaveRow onCancel={saved} onSave={() => commit('claims', clm)} />
      </div>
    )
  }

  if (section === 'appt') {
    return (
      <div className="pr-sec" data-testid="pr-appt">
        <SecHead t="Appointment Settings" s="Rules enforced while completing an appointment for this payer." />
        <div className="pr-togrow" data-testid="appt-sig-row">
          <div><b>Client Signature required to complete appointment</b><span className="muted">Verification tab of the appointment will block “Complete” until a signature is captured.</span></div>
          <button role="switch" aria-checked={Boolean(appt.sigRequired)} className={`pd-switch${appt.sigRequired ? ' on' : ''}`} data-testid="appt-sig" onClick={() => setAppt({ ...appt, sigRequired: !appt.sigRequired })}><i /></button>
        </div>
        <SaveRow onCancel={saved} onSave={() => commit('appt', appt, appt.sigRequired ? 'Signature requirement turned on' : 'Signature requirement turned off')} />
      </div>
    )
  }

  if (section === 'qual') {
    const upd = (i, k, v) => setQm((x) => x.map((r, j) => (j === i ? { ...r, [k]: v } : r)))
    const move = (i, d) => setQm((x) => { const y = [...x]; const j = i + d; if (y[j]) [y[i], y[j]] = [y[j], y[i]]; return y })
    return (
      <div className="pr-sec" data-testid="pr-qual">
        <SecHead t="Qualification Modifiers" s="Modifier pair appended per rendering-provider credential — order decides which wins when staff holds several." />
        {qm.map((r, i) => (
          <div className="pr-qrow" key={i} data-testid={`qm-row-${i}`}>
            <Dropdown testid={`qm-qual-${i}`} value={r.qual} onChange={(v) => upd(i, 'qual', v)} options={['Doctoral', "Master's", "Bachelor's", 'Associate', 'HS', 'Teacher', 'Therapist', 'Specialist'].map((q) => ({ value: q, label: q }))} />
            <Dropdown testid={`qm-m1-${i}`} value={r.m1} onChange={(v) => upd(i, 'm1', v)} options={MODIFIERS.map((m) => ({ value: m, label: m }))} />
            <Dropdown testid={`qm-m2-${i}`} value={r.m2} onChange={(v) => upd(i, 'm2', v)} options={MODIFIERS.map((m) => ({ value: m, label: m }))} />
            <span className="pr-ord">
              <button className="iconbtn" title="Move up" data-testid={`qm-up-${i}`} disabled={i === 0} onClick={() => move(i, -1)}>{Icon.chevronL({ size: 12 })}</button>
              <button className="iconbtn" title="Move down" data-testid={`qm-down-${i}`} disabled={i === qm.length - 1} onClick={() => move(i, 1)}>{Icon.chevronR({ size: 12 })}</button>
              <button className="iconbtn" title="Remove" data-testid={`qm-del-${i}`} disabled={qm.length <= 1} onClick={() => setQm(qm.filter((_, j) => j !== i))}>{Icon.trash({ size: 12 })}</button>
            </span>
          </div>
        ))}
        <button className="btn btn-sm pr-addrule" data-testid="qm-add" onClick={() => setQm([...qm, { qual: 'Specialist', m1: 'U6', m2: 'UN' }])}>{Icon.plus({ size: 12 })} Add</button>
        <SaveRow onCancel={saved} onSave={() => commit('qualMods', qm)} />
      </div>
    )
  }

  if (section === 'pos') {
    const upd = (i, k, v) => setPos((x) => ({ ...x, rows: x.rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)) }))
    return (
      <div className="pr-sec" data-testid="pr-pos">
        <SecHead t="Place of Service Modifiers" s="Extra modifiers keyed to the place-of-service code on the encounter." />
        {pos.rows.map((r, i) => (
          <div className="pr-prow" key={i} data-testid={`pos-row-${i}`}>
            <Dropdown testid={`pos-code-${i}`} value={r.pos} onChange={(v) => upd(i, 'pos', v)} options={POS_CODES.map((x) => ({ value: x.id, label: x.id, sub: x.label.split(' · ')[1] }))} />
            <Dropdown testid={`pos-mod-${i}`} value={r.mod || ''} onChange={(v) => upd(i, 'mod', v)} options={[{ value: '', label: '— none —' }, ...MODIFIERS.map((m) => ({ value: m, label: m }))]} />
            <button className="iconbtn" title="Remove row" data-testid={`pos-del-${i}`} onClick={() => setPos({ ...pos, rows: pos.rows.filter((_, j) => j !== i) })}>{Icon.trash({ size: 12 })}</button>
          </div>
        ))}
        <button className="btn btn-sm pr-addrule" data-testid="pos-add" onClick={() => setPos({ ...pos, rows: [...pos.rows, { pos: '99', mod: '' }] })}>{Icon.plus({ size: 12 })} Add row</button>
        <div className="pr-checks">
          <label className="pr-check"><input type="checkbox" checked={pos.hideTeleOther} data-testid="pos-hide02" onChange={(e) => setPos({ ...pos, hideTeleOther: e.target.checked })} /><span>Hide POS-02 (other than patient home) in Appointment Location</span></label>
          <label className="pr-check"><input type="checkbox" checked={pos.hideTeleHome} data-testid="pos-hide10" onChange={(e) => setPos({ ...pos, hideTeleHome: e.target.checked })} /><span>Hide POS-10 (rendered from home) in Appointment Location</span></label>
        </div>
        <SaveRow onCancel={saved} onSave={() => { patch({ rules: { ...rules, posMods: pos.rows, hideTeleOther: pos.hideTeleOther, hideTeleHome: pos.hideTeleHome } }, 'POS modifiers saved'); saved() }} />
      </div>
    )
  }

  const codes = useMemo(() => {
    const set = new Set(svcList(state).map((s) => s.code))
    for (const c of BILL_CODES) set.add(c.id)
    for (const pay of state.payers || []) for (const sv of localSvcs(pay)) if (sv.code) set.add(sv.code)
    return [...set]
  }, [state.svcs, state.payers])
  return (
    <div className="pr-sec" data-testid="pr-mue">
      <SecHead t="MUEs" s="Medically Unlikely Edits — maximum units per code per day for this payer." />
      <div className="pr-banner" data-testid="mue-banner">{Icon.alert({ size: 12 })} These MUEs are applied for all <b>Uncompleted</b> appointments for {p.name}.</div>
      <div className="pr-frow" data-testid="mue-daily-row">
        <span className="pr-flabel">Daily Limit (All Codes)</span>
        <Dropdown testid="mue-daily" value={mue.daily || ''} onChange={(v) => setMue({ ...mue, daily: v })} options={[{ value: '', label: '— none —' }, ...MUE_LIMITS.map((m) => ({ value: m, label: m }))]} />
      </div>
      <div className="pr-muetable">
        <div className="pr-muehead"><span>Billing Code</span><span>Limit</span></div>
        {codes.map((c) => (
          <div className="pr-muerow" key={c} data-testid={`mue-row-${c}`}>
            <b>{c}</b>
            <Dropdown testid={`mue-${c}`} value={mue.per[c] || ''} onChange={(v) => setMue({ ...mue, per: { ...mue.per, [c]: v } })} options={[{ value: '', label: 'No Limits' }, ...MUE_LIMITS.filter((m) => m !== 'No Limits').map((m) => ({ value: m, label: `${m} units` }))]} />
          </div>
        ))}
      </div>
      <SaveRow onCancel={saved} onSave={() => commit('mue', mue)} />
    </div>
  )
}

function SecHead({ t, s }) {
  return <div className="pr-head"><b>{t}</b><span>{s}</span></div>
}
function SaveRow({ onSave, onCancel }) {
  return (
    <div className="pr-save">
      <button className="btn btn-sm" data-testid="pr-cancel" onClick={onCancel}>Cancel</button>
      <button className="btn btn-sm btn-primary" data-testid="pr-save" onClick={onSave}>Save</button>
    </div>
  )
}
