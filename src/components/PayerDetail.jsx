import React, { useEffect, useMemo, useState } from 'react'
import { useStore } from '../state/store'
import { Icon } from '../ui/Icons'
import { useToast } from '../ui/Toast'
import { Dropdown, InlineSelect, InlineText } from './fields'
import { Banner } from './settings/kit'
import InfoTip from '../ui/InfoTip'
import { CfPickRow } from './CfPick.jsx'
import CfDefModal from './CfDefModal.jsx'
import { PayerForm, RemoveArm } from './PayersView'
import { ensurePayer, svcList, localSvcs, MODIFIERS, POS_CODES, ROUNDINGS, CREDENTIALS, CF_TYPES, cfTypeLabel, payerFieldDefs, cfScopesFor } from '../lib/master'
import { BILL_CODES, QUAL_MODIFIER_KEYS, uid } from '../lib/model'
import { PROVIDER_ID_RULES, providerIdRule, providerIdIssues } from '../lib/providerIds'
import { PAYER_KINDS, payerPolicy, normalizeMileageCode } from '../lib/claims'

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
  { id: 'ids', label: 'Provider IDs', icon: 'user' },
  { id: 'terms', label: 'Payment Terms', icon: 'dollar' },
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
    if (used) { toast({ message: `${p.name} still has ${used} client${used === 1 ? '' : 's'} on file. Reassign them before removing the payer.`, kind: 'error' }); return false }
    actions.removePayer(p.id)
    toast({ message: `${p.name} removed from the directory`, kind: 'info' })
    onBack()
    return true
  }
  const patch = (changes, msg) => { actions.updatePayer({ id: p.id, ...changes }); if (msg) toast({ message: msg, kind: 'ok', action: { label: 'Undo', onClick: () => actions.undo() } }) }

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
  // Audit CFG-07: the picker offers the templates scoped to Payer Profile (plus any
  // this payer already picked, so they can be unlinked) — client-, authorization- or
  // staff-scoped templates never appear here.
  const scopedTemplates = templates.filter((t) => (p.cf || []).includes(t.id) || cfScopesFor(t).includes('payer'))
  const phone = (p.contacts || []).find((c) => c.kind === 'Main')?.number || ''
  const fax = (p.contacts || []).find((c) => c.kind === 'Fax')?.number || ''
  const portal = (p.contacts || []).find((c) => c.kind === 'Claims portal')?.number || ''
  const addr = [p.street, [p.city, p.state].filter(Boolean).join(' '), p.zip].filter(Boolean).join(', ')

  const toast = useToast()
  const usedBy = (id) => (state.payers || []).filter((x) => (x.cf || []).includes(id)).length
  const saveCf = (v) => {
    if (!v || typeof v !== 'object' || 'nativeEvent' in v || v.target) { setCfEdit(null); return }
    if (cfEdit === 'new') { actions.addCfDef(v); toast({ message: `Template “${v.label}” created. Tick it to use it for ${p.name}.`, kind: 'ok' }) }
    else { actions.updateCfDef({ id: cfEdit.id, ...v }); toast({ message: `Template “${v.label}” updated for every payer that uses it.`, kind: 'ok' }) }
    setCfEdit(null)
  }
  const delDef = (t) => {
    const n = usedBy(t.id)
    if (n) { toast({ message: `“${t.label}” is picked by ${n} payer${n === 1 ? '' : 's'}. Unlink it there first.`, kind: 'error' }); return }
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

      <div className="an-card pd-card" data-testid="pd-billids">
        <div className="an-head">{Icon.dollar({ size: 13 })} Billing identifiers<InfoTip label="Billing identifiers" wiki="billing-and-claims" testid="pd-billids-info">These IDs feed claim routing (837P and CMS-1500 box 11) and the timely filing check. Leave a field blank to use the payer default.</InfoTip><span className="an-spacer" /></div>
        <div className="pd-kvgrid">
          <div className="pd-kv"><span>Group #</span><span><InlineText testid={`pd-ext-group-${p.id}`} value={(p.ext||{}).group||''} placeholder="—" onCommit={(v)=>patch({ ext:{ ...(p.ext||{}), group:String(v).trim() } }, 'group # saved')} /></span></div>
          <div className="pd-kv"><span>Plan #</span><span><InlineText testid={`pd-ext-plan-${p.id}`} value={(p.ext||{}).plan||''} placeholder="—" onCommit={(v)=>patch({ ext:{ ...(p.ext||{}), plan:String(v).trim() } }, 'plan # saved')} /></span></div>
          <div className="pd-kv"><span>Sub ID</span><span><InlineText testid={`pd-ext-sub-${p.id}`} value={(p.ext||{}).subId||''} placeholder="—" onCommit={(v)=>patch({ ext:{ ...(p.ext||{}), subId:String(v).trim() } }, 'sub ID saved')} /></span></div>
          <div className="pd-kv"><span>Ticare ID</span><span><InlineText testid={`pd-ext-ticare-${p.id}`} value={(p.ext||{}).ticareId||''} placeholder="—" onCommit={(v)=>patch({ ext:{ ...(p.ext||{}), ticareId:String(v).trim() } }, 'Ticare ID saved')} /></span></div>
          <div className="pd-kv"><span>Medicaid ID</span><span><InlineText testid={`pd-ext-medicaid-${p.id}`} value={(p.ext||{}).medicaidId||''} placeholder="—" onCommit={(v)=>patch({ ext:{ ...(p.ext||{}), medicaidId:String(v).trim() } }, 'Medicaid ID saved')} /></span></div>
          <div className="pd-kv"><span>BHPN ID</span><span><InlineText testid={`pd-ext-bhpn-${p.id}`} value={(p.ext||{}).bhpnId||''} placeholder="—" onCommit={(v)=>patch({ ext:{ ...(p.ext||{}), bhpnId:String(v).trim() } }, 'BHPN ID saved')} /></span></div>
          <div className="pd-kv"><span>Filing deadline (days)</span><span><InlineText testid={`pd-ext-filing-${p.id}`} value={(p.ext||{}).filingDeadlineDays??''} placeholder="payer default" onCommit={(v)=>{ const n=String(v).trim()===''?null:Number(v); patch({ ext:{ ...(p.ext||{}), filingDeadlineDays: Number.isFinite(n)?n:null } }, n?'filing window saved':'filing window cleared') }} /></span></div>
          <div className="pd-kv"><span>Secondary Box 18</span><span style={{ display:'flex', alignItems:'center', gap:8 }}><button type="button" className={`toggle ${(p.ext||{}).requiresSecondaryBox18!==false?'on':''}`} data-testid={`pd-ext-box18-${p.id}`} onClick={()=>patch({ ext:{ ...(p.ext||{}), requiresSecondaryBox18: !((p.ext||{}).requiresSecondaryBox18!==false) } }, 'Box 18 flag saved')} /><i className="muted" style={{ fontSize:11 }}>{(p.ext||{}).requiresSecondaryBox18!==false?'Require on secondary':'Skip'}</i></span></div>
        </div>
        
      </div>

      <div className="an-card pd-card" data-testid="pd-cf">
        <div className="an-head">{Icon.badge({ size: 13 })} Custom Fields{fields.length > 0 && <span className="pd-cfn">{fields.length}</span>}<span className="an-spacer" />
          <InfoTip label="Custom Fields" wiki="billing-and-claims" testid="pd-cf-info">Fields are defined once in the Custom Fields master. This payer picks which ones apply. Staff add them to a session from the booking dialog (opt-in, never pre-selected), and saved values show on the appointment detail. No claim, CMS-1500 or export reads them yet.</InfoTip>
        </div>
        
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
                {d.source === 'inline' ? <span className="tag" title="Defined on this payer before templates existed. Save it to the master to reuse it.">legacy</span> : <span className="tag soft">from master</span>}
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
          <span className="muted" style={{ fontSize: 11.5 }}>{scopedTemplates.filter((t) => t.status !== 'inactive' && !(p.cf || []).includes(t.id)).length} template(s) not yet used by this payer</span>
        </div>
      </div>

      {pick && (
        <div className="overlay pm-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) setPick(false) }}>
          <div className="modal pm-modal py-modal" data-testid="pd-cf-picker" role="dialog" aria-modal="true" aria-label="Add custom fields">
            <div className="modal-head pm-head">
              <h3>Add Custom Fields: {p.name}</h3>
              <span className="muted" style={{ fontSize: 11.5, marginLeft: 10 }}>Tick the fields this payer requires, or edit the templates here</span>
              <span className="an-spacer" />
              <span className="muted" style={{ fontSize: 11, marginRight: 8 }}>{(p.cf || []).length} picked</span>
              <button className="iconbtn modal-x" aria-label="Close" data-testid="pd-cf-picker-close" onClick={() => setPick(false)}>{Icon.x({ size: 14 })}</button>
            </div>
            <div className="modal-body">
              {scopedTemplates.length === 0 && <div className="muted pd-cfempty" style={{ padding: '18px 2px' }}>No payer templates yet. Set a template’s scope to Payer Profile on the Custom Fields master page, or use “Add template” below.</div>}
              <div className="cf-picklist">
                {scopedTemplates.map((t) => {
                  const on = (p.cf || []).includes(t.id)
                  const used = usedBy(t.id)
                  return (
                    <CfPickRow key={t.id} def={t} on={on} disabled={t.status === 'inactive' && !on} testid={`pd-cfpick-${t.id}`}
                      onToggle={(v) => setFields(v ? [...(p.cf || []), t.id] : (p.cf || []).filter((x) => x !== t.id))}>
                      <button className="iconbtn" title={`Used by ${used} payer${used === 1 ? '' : 's'}`} style={{ cursor: 'default', pointerEvents: 'none', width: 'auto', padding: '0 4px' }}><i className="muted" style={{ fontSize: 10, fontStyle: 'normal' }}>×{used}</i></button>
                      <button className="iconbtn" title="Edit this template in the full field editor" data-testid={`pd-cfm-edit-${t.id}`} onClick={(e) => { e.preventDefault(); e.stopPropagation(); setCfEdit(t) }}>{Icon.edit({ size: 12 })}</button>
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
  const LBL = { billingCode: 'Billing code', dx1: 'Dx 1', dx2: 'Dx 2', unitSize: 'Unit size', charge: 'Charge rate', rounding: 'Rounding', contract: 'Contract rate', modifier: 'Modifier', thirdParty: 'Third-party ID', effective: 'Effective date', expiration: 'Expiration date', label: 'Label' }
  // inline cell write: linked rows upsert their svcOv override, payer-only rows edit their record
  const setCell = (c, key, val) => {
    if (c.kind === 'linked') {
      const prev = (p.svcOv || {})[c.master.id] || {}
      patch({ svcOv: { ...(p.svcOv || {}), [c.master.id]: { ...prev, [key]: val } } }, `${LBL[key] || key} on ${c.master.label} saved for ${p.name}`)
    } else {
      patch({ svcs: mine.map((x) => (x.id === c.local.id ? { ...x, [key]: val } : x)) }, `${LBL[key] || key} on ${c.local.label} updated`)
    }
  }
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
        {!p.services.length && <div className="pd-note pd-allnote" data-testid="pd-svc-all">{Icon.info({ size: 12 })} No contract list, so every active service type counts as contracted. Use “Contract services” to narrow it, or add a service only for {p.name}.</div>}
        <span className="an-spacer" />
        <button className="btn btn-sm" data-testid="pd-svc-contract" onClick={() => setPicker(true)}>{Icon.clipboard({ size: 12 })} Contract services</button>
        <button className="btn btn-sm btn-primary" data-testid="pd-svc-add" onClick={() => setForm({ mode: 'new' })}>{Icon.plus({ size: 12 })} New Payer-Only Service</button>
      </div>
      <div className="svc-cards" data-testid="pd-svc-cards">
        {cards.length === 0 && <div className="muted pd-cfempty">No services on this payer yet. Use “New Payer-Only Service” to create one for this payer, or “Contract services” to attach master service types.</div>}
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
                {c.kind === 'local' && <span className="pd-chip" title="Created on this payer. Not in the master list.">payer-only</span>}
                <span className="svc-cardacts">
                  <button className="iconbtn" title="Modify this service line" data-testid={`pd-ovr-${c.id}`} onClick={() => setForm(c.kind === 'linked' ? { mode: 'linked', svc: c.master } : { mode: 'local', svc: c.local })}>{Icon.edit({ size: 12 })}</button>
                  <button className="iconbtn" title={c.kind === 'linked' ? 'Uncontract this service for this payer' : 'Delete from this payer'} data-testid={`pd-unlink-${c.id}`} onClick={() => unlink(c)}>{Icon.trash({ size: 12 })}</button>
                </span>
              </div>
              <div className="svc-dates">
                <span className={`svc-date${o.effective ? ' on' : ''}`}>{o.effective ? `Effective ${o.effective}` : 'No effective date'}</span>
                <span className={`svc-date${o.expiration ? ' exp' : ''}`}>{o.expiration ? `Expires ${o.expiration}` : 'No expiration'}</span>
                {inactive && <span className="svc-date off">Inactive, hidden in booking</span>}
              </div>
              <div className="svc-rows">
                <div><span>Billing Code</span><InlineText testid={`pd-cell-code-${c.id}`} numeric={false} value={o.billingCode || ''} placeholder={o.code || c.master?.code || 'override master'} onCommit={(v) => setCell(c, 'billingCode', String(v).trim().toUpperCase())} /></div>
                <div><span>Dx Code 1</span><InlineText testid={`pd-cell-dx1-${c.id}`} value={o.dx1 || ''} placeholder="add" onCommit={(v) => setCell(c, 'dx1', String(v).trim().toUpperCase())} /></div>
                <div><span>Dx Code 2</span><InlineText testid={`pd-cell-dx2-${c.id}`} value={o.dx2 || ''} placeholder="add" onCommit={(v) => setCell(c, 'dx2', String(v).trim().toUpperCase())} /></div>
                <div><span>Unit Size</span><InlineSelect testid={`pd-cell-unit-${c.id}`} value={o.unitSize || (c.master ? `${c.master.unitMins} Minutes` : '')} options={UNITS_OPTS.map((u) => ({ value: u, label: u }))} onCommit={(v) => setCell(c, 'unitSize', v)} /></div>
                <div><span>Charge Rate</span><InlineText testid={`pd-cell-charge-${c.id}`} value={o.charge === '' || o.charge == null ? '' : money(Number(o.charge))} placeholder={c.master ? money(c.master.rate) : '0'} onCommit={(v) => { const n = String(v).replace(/[^0-9.]/g, ''); setCell(c, 'charge', n ? Number(n) : '') }} /></div>
                <div><span>Rounding</span><InlineSelect testid={`pd-cell-round-${c.id}`} value={o.rounding || c.master?.rounding || 'AMA'} options={ROUNDINGS.map((r) => ({ value: r, label: r }))} onCommit={(v) => setCell(c, 'rounding', v)} /></div>
                <div><span>Contract Rate</span><InlineText testid={`pd-cell-contract-${c.id}`} value={o.contract == null || o.contract === '' ? '' : money(Number(o.contract))} placeholder="—" onCommit={(v) => { const n = String(v).replace(/[^0-9.]/g, ''); setCell(c, 'contract', n ? Number(n) : '') }} /></div>
                <div><span>Modifier</span><InlineSelect testid={`pd-cell-mod-${c.id}`} value={o.modifier || ''} options={[{ value: '', label: '—' }, ...MODIFIERS.map((m) => ({ value: m, label: m }))]} onCommit={(v) => setCell(c, 'modifier', v)} /></div>
                <div><span>Third Party ID</span><InlineText testid={`pd-cell-tp-${c.id}`} value={o.thirdParty || ''} placeholder="—" onCommit={(v) => setCell(c, 'thirdParty', String(v).trim())} /></div>
                <div><span>Effective</span><InlineText testid={`pd-cell-eff-${c.id}`} value={o.effective || ''} placeholder="YYYY-MM-DD" onCommit={(v) => setCell(c, 'effective', String(v).trim())} /></div>
                <div><span>Expires</span><InlineText testid={`pd-cell-exp-${c.id}`} value={o.expiration || ''} placeholder="YYYY-MM-DD" onCommit={(v) => setCell(c, 'expiration', String(v).trim())} /></div>
              </div>
              <div className="svc-creds">
                <span>Required Credentials (AND)</span>
                <div>{(c.local?.credentials || c.master?.credentials || []).length ? (c.local?.credentials || c.master?.credentials).map((x) => <span className="tag" key={x}>{x}</span>) : <i className="muted">None</i>}</div>
              </div>
              <button className="btn btn-sm svc-ovrbtn" data-testid={`pd-ovrbtn-${c.id}`} onClick={() => setForm(c.kind === 'linked' ? { mode: 'linked', svc: c.master } : { mode: 'local', svc: c.local })}>
                {Icon.edit({ size: 12 })} Edit this service line{hasOvr || c.kind === 'local' ? ' (overrides active)' : ': modifier, charge and contract rate'}
              </button>
            </div>
          )
        })}
      </div>
      <button className="svc-fab" data-testid="pd-svc-fab" title="Add a service from the master or create one for this payer" onClick={() => setPicker(true)}>{Icon.plus({ size: 16 })}</button>

      {picker && (
        <div className="overlay pm-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) setPicker(false) }}>
          <div className="modal pm-modal py-modal" data-testid="pd-svc-picker" role="dialog" aria-modal="true" aria-label="Contracted services">
            <div className="modal-head pm-head">
              <h3>Services: {p.name}</h3>
              <span className="muted" style={{ fontSize: 11.5, marginLeft: 10 }}>Tick the services this payer reimburses</span>
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
    unitSize: o.unitSize || (linked ? `${form.svc.unitMins} Minutes` : '15 Minutes'),
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
    <div className="modal pm-modal py-modal ovr-form" data-testid="ovr-modal" role="dialog" aria-modal="true" aria-label={linked ? `Service line: ${form.svc.label}` : form.mode === 'local' ? `Edit service: ${form.svc.label}` : 'Add Service'} tabIndex={-1}>
      <div className="modal-head pm-head">
        <h3>{linked || form.mode === 'local' ? `Service: ${form.svc.label}` : 'Add Service'}</h3>
        <span className="muted" style={{ fontSize: 11.5, marginLeft: 10 }}>for {payer.name}</span>
        <span className="an-spacer" />
        <button className="iconbtn modal-x" aria-label="Close" data-testid="ovr-close" onClick={onClose}>{Icon.x({ size: 14 })}</button>
      </div>
      <div className="modal-body">
        <div className="ovr-top">
          <Fld k="label" label="Service Name" req={false} hint={linked ? '' : 'e.g. Parent Coaching (Telehealth)'}>
            {linked
              ? <div className="ovr-lockname" data-testid="ovr-label-locked" title="Master service name. Change it on the Service Types master.">{form.svc.label}</div>
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
              <button key={c} type="button" className={`tag pick${f.credentials.includes(c) ? ' on' : ''}`} data-testid={`ovr-cred-${c}`} disabled={linked} title={linked ? 'Set on the Service Types master' : 'Toggle'} onClick={() => set('credentials', f.credentials.includes(c) ? f.credentials.filter((x) => x !== c) : [...f.credentials, c])}>{c}</button>
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
            <Dropdown testid="ovr-modifier" value={f.modifier} onChange={(v) => set('modifier', v)} options={[{ value: '', label: 'None' }, ...MODIFIERS.map((m) => ({ value: m, label: m }))]} />
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
  const [mue, setMue] = useState(() => ({ daily: rules.mue.daily || '', per: { ...(rules.mue.per || {}) }, weekly: { ...(rules.mue.weekly || {}) } }))
  const [idRule, setIdRule] = useState(() => providerIdRule(p).id)
  const [terms, setTerms] = useState(() => {
    const pol = payerPolicy(p.name, state)
    return { kind: pol.kind, avgDays: String(pol.avgDays), coinsPct: String(Math.round(pol.coins * 10000) / 100), copay: String(pol.copay), filingDays: p.ext?.filingDeadlineDays == null ? '' : String(p.ext.filingDeadlineDays) }
  })
  const toast = useToast()
  const svcOpts = useMemo(() => [...svcList(state).map((s) => ({ value: s.id, label: s.label, sub: s.code })), ...(state.payers || []).flatMap((x) => localSvcs(x)).map((s) => ({ value: s.id, label: `${s.label}`, sub: 'payer service' }))], [state.svcs, state.payers])

  if (section === 'ids') {
    const missing = (state.staff || []).map((s) => providerIdIssues(state, { ...p, rules: { ...rules, providerId: idRule } }, s.id)[0]).filter(Boolean)
    return (
      <div className="pr-sec" data-testid="pr-ids">
        <SecHead t="Provider IDs" s="The identifier this payer expects for the rendering provider. Claims, appointment checks and the CMS-1500 use it." />
        <div className="pr-seg" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }} role="radiogroup" aria-label="Provider identifier rule">
          {PROVIDER_ID_RULES.map((r) => (
            <button key={r.id} role="radio" aria-checked={idRule === r.id} className={`pd-opt${idRule === r.id ? ' on' : ''}`} data-testid={`ids-${r.id}`} onClick={() => setIdRule(r.id)}>
              <b>{r.label}</b><span>{r.hint}</span>
            </button>
          ))}
        </div>
        <div className={`pr-banner${missing.length ? '' : ' ok'}`} data-testid="ids-readiness" style={{ marginTop: 10 }}>
          {Icon[missing.length ? 'alert' : 'checkCircle']({ size: 12 })}{' '}
          {missing.length
            ? <>{missing.length} staff member{missing.length === 1 ? '' : 's'} can't be billed to {p.name} under this rule yet, starting with {missing[0]}. Add their identifiers in Billing → Provider IDs.</>
            : <>Every staff member has the identifiers this rule needs.</>}
        </div>
        <SaveRow onCancel={saved} onSave={() => commit('providerId', idRule, `${p.name} now bills with ${PROVIDER_ID_RULES.find((r) => r.id === idRule).label}`)} />
      </div>
    )
  }

  if (section === 'terms') {
    const fld = (k, label, hint, attrs = {}) => (
      <div className="pr-frow" data-testid={`terms-row-${k}`}>
        <span className="pr-flabel" title={hint}>{label}</span>
        <input className="input" type="number" aria-label={label} data-testid={`terms-${k}`} value={terms[k]} onChange={(e) => setTerms({ ...terms, [k]: e.target.value })} {...attrs} />
      </div>
    )
    const save = () => {
      const res = state.actions.setPayerTerms(p.id, terms)
      toast({ message: res.msg, kind: res.ok ? 'ok' : 'error' })
      if (res.ok) saved()
    }
    return (
      <div className="pr-sec" data-testid="pr-terms">
        <SecHead t="Payment Terms" s="What billing expects from this payer. Claim aging, payment presets, copay estimates, the timely filing check and CMS-1500 box 7b use these values." />
        <div className="pr-fields">
          <div className="pr-frow" data-testid="terms-row-kind">
            <span className="pr-flabel">Payer kind</span>
            <Dropdown testid="terms-kind" value={terms.kind} onChange={(v) => setTerms({ ...terms, kind: v })} options={PAYER_KINDS.map((k) => ({ value: k.id, label: k.label }))} />
          </div>
          {fld('avgDays', 'Expected days to pay', 'A submitted claim is flagged late after 1.6 × this many days.', { min: 1, max: 365, step: 1 })}
          {fld('coinsPct', 'Estimated payer share (%)', 'Used for the "Estimate" payment preset. An estimate only: post what the remittance says.', { min: 0, max: 100, step: 0.01 })}
          {fld('copay', 'Estimated copay per line ($)', 'Used for the copay estimate and the "Leave estimated copay" preset.', { min: 0, step: 0.01 })}
          {fld('filingDays', 'Filing deadline (days)', 'Days from date of service to file. Blank uses the practice default.', { min: 1, max: 999, step: 1, placeholder: `practice default (${state.settings?.billing?.defaultFilingDays ?? 90})` })}
        </div>
        <SaveRow onCancel={saved} onSave={save} />
      </div>
    )
  }

  if (section === 'concurrent') {
    const upd = (i, k, v) => setConc((c) => ({ ...c, rules: c.rules.map((r, j) => (j === i ? { ...r, [k]: v } : r)) }))
    return (
      <div className="pr-sec" data-testid="pr-concurrent">
        <SecHead t="Concurrent Billing" s="Rules for two or more service types that overlap for the same client in the same time slot." />
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
    // Audit CFG-06: options with no reader in claim assembly / CMS-1500 code are
    // disabled and labelled, so the panel never implies an effect the claim output
    // does not have.
    const NA = 'Not available in this build. Saved with the payer but not applied to the CMS-1500.'
    const sel = (k, label, list, hint, na = false) => (
      <div className="pr-frow" data-testid={`clm-row-${k}`}>
        <span className="pr-flabel" title={na ? NA : (hint || '')}>{label}{na ? ' (not available)' : ''}</span>
        <Dropdown testid={`clm-${k}`} value={clm[k] || '—'} onChange={(v) => setClm({ ...clm, [k]: v })} options={opts(list)} disabled={na} />
      </div>
    )
    const chk = (k, label, na = false) => (
      <label className="pr-check"><input type="checkbox" checked={Boolean(clm.flags[k])} disabled={na} data-testid={`clm-flag-${k}`} onChange={(e) => setClm({ ...clm, flags: { ...clm.flags, [k]: e.target.checked } })} /><span>{label}{na ? ' (not available)' : ''}</span></label>
    )
    const saveClaims = () => {
      const mileage = normalizeMileageCode(clm.mileageCode)
      if (!mileage.ok) { toast({ message: mileage.msg, kind: 'error' }); return }
      commit('claims', { ...clm, mileageCode: mileage.code })
    }
    return (
      <div className="pr-sec" data-testid="pr-claims">
        <SecHead t="Claims Settings" s="Box and routing options used when this payer’s CMS-1500 is built. Box 32, same-day merging, credential modifiers, the mileage code and the claim split keys take effect." />
        <Banner tone="info" testid="pr-claims-na-note">
          Box 17, Box 19, Box 33B, Box 33B2, file grouping, appointment time and the taxonomy and rendering
          checkboxes are saved but not yet applied to the claim, so they are disabled.
        </Banner>
        <div className="pr-fields">
          <div className="pr-frow" data-testid="clm-row-mileageCode">
            <label className="pr-flabel" htmlFor="clm-mileageCode" title="Optional 5-character CPT or HCPCS code approved by this payer. CPT 14220 is refused because it is not a mileage code.">Payer mileage code</label>
            <input
              id="clm-mileageCode"
              className="input"
              type="text"
              autoCapitalize="characters"
              pattern="[A-Za-z0-9]{5}"
              aria-label="Payer mileage code"
              data-testid="clm-mileageCode"
              value={clm.mileageCode || ''}
              onChange={(e) => setClm({ ...clm, mileageCode: e.target.value })}
            />
          </div>
          <p className="muted" style={{ gridColumn: '1 / -1', margin: '-2px 0 2px', fontSize: 11.5 }}>
            Use only a code the payer approved. Leave blank if the contract does not cover mileage; insurance mileage lines stay held until a code is set. After a change, void and rebuild existing drafts.
          </p>
          <div className="pr-frow" data-testid="clm-row-separateBy">
            <span className="pr-flabel" title="Split claims that would mix these values. A session records one clinician, so both provider options split by that clinician. Sessions record no supervisor, so there is no Supervising Provider option.">Separate Claim By</span>
            <Dropdown testid="clm-separateBy" value={clm.separateBy || '—'} onChange={(v) => setClm({ ...clm, separateBy: v })} options={[{ value: '—', label: '—' }, { value: 'Rendering Provider', label: 'Rendering Provider (the session’s clinician)' }, { value: 'Service Provider', label: 'Service Provider (also the session’s clinician)' }, { value: 'Place of Service', label: 'Place of Service' }]} />
          </div>
          {sel('box17', 'Box 17: Referring Provider', ['Display only when rendering provider is different', 'Always Display Referring Provider', 'Do not display Referring Provider', 'Always Display if a Referring Provider exists, even if same as billing provider'], undefined, true)}
          {sel('box19', 'Box 19: Continue Hospital Info', ['Display only when rendering provider is different', 'Always Display Referring Provider', 'Do not display Referring Provider'], undefined, true)}
          {sel('box32', 'Box 32: Service Facility Name & Location', ['Auto-populate if blank, leave blank if same as billing NPI', 'Always display Service Facility Name and Location', 'Never display Service Facility Name and Location'])}
          {sel('box33B', 'Box 33B: Payer ID Type', ['—', 'Medicaid Number', 'Group Number', 'Payer ID', 'NPI'], 'Only shown when it differs from Box 33A', true)}
          {sel('box33B2', 'Secondary Payer: ID Type', ['—', 'Medicaid Number', 'Group Number', 'Payer ID', 'NPI'], undefined, true)}
          {sel('file', 'Claim File Options', ['One file per claim', 'One claim per file', 'One file per payer per day'], 'How claim files are grouped for the clearing house', true)}
          {sel('apptTime', 'Include Appointment Time on Claim', ['Do not include', 'Include appointment start time', 'Include appointment start & end time'], undefined, true)}
        </div>
        <div className="pr-checks">
          {chk('renderProvider', 'Use Service Provider as Rendering Provider', true)}
          {chk('renderTaxo', 'Include Rendering Provider Taxonomy Code on Claim', true)}
          {chk('billTaxo', 'Include Billing Provider Taxonomy Code on Claim', true)}
          {chk('mergeSameDay', 'Merge appointments for same day, same client and same service provider into one charge line')}
          {chk('credentialMods', "Add the rendering provider's credential modifier to each line (HO for BCBA, HN for BCaBA, HM for RBT, HP for Psychologist). This is the Medicaid norm.")}
        </div>
        <SaveRow onCancel={saved} onSave={saveClaims} />
      </div>
    )
  }

  if (section === 'appt') {
    return (
      <div className="pr-sec" data-testid="pr-appt">
        <SecHead t="Appointment Settings" s="Rules checked when an appointment for this payer is completed." />
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
    const none = { value: '', label: 'None' }
    const noEducation = (state.staff || []).filter((s) => !s.education).length
    return (
      <div className="pr-sec" data-testid="pr-qual">
        <SecHead t="Qualification Modifiers" s="The first row that matches the rendering provider's education (or part of their role) adds its modifiers to the claim line, after the credential modifier and before the place of service modifier. Row order decides which row wins. A blank modifier adds nothing." />
        <div className={`pr-banner${noEducation ? '' : ' ok'}`} data-testid="qm-readiness">
          {Icon[noEducation ? 'alert' : 'checkCircle']({ size: 12 })}{' '}
          {noEducation
            ? <>{noEducation} staff member{noEducation === 1 ? '' : 's'} {noEducation === 1 ? 'has' : 'have'} no education level recorded, so their lines get no qualification modifier. Set it on the staff record (Staff → Edit).</>
            : <>Every staff member has an education level recorded.</>}
        </div>
        {qm.map((r, i) => (
          <div className="pr-qrow" key={i} data-testid={`qm-row-${i}`}>
            <Dropdown testid={`qm-qual-${i}`} value={r.qual} onChange={(v) => upd(i, 'qual', v)} options={QUAL_MODIFIER_KEYS.map((q) => ({ value: q, label: q }))} />
            <Dropdown testid={`qm-m1-${i}`} value={r.m1 || ''} onChange={(v) => upd(i, 'm1', v)} options={[none, ...MODIFIERS.map((m) => ({ value: m, label: m }))]} />
            <Dropdown testid={`qm-m2-${i}`} value={r.m2 || ''} onChange={(v) => upd(i, 'm2', v)} options={[none, ...MODIFIERS.map((m) => ({ value: m, label: m }))]} />
            <span className="pr-ord">
              <button className="iconbtn" title="Move up" data-testid={`qm-up-${i}`} disabled={i === 0} onClick={() => move(i, -1)}>{Icon.chevronL({ size: 12 })}</button>
              <button className="iconbtn" title="Move down" data-testid={`qm-down-${i}`} disabled={i === qm.length - 1} onClick={() => move(i, 1)}>{Icon.chevronR({ size: 12 })}</button>
              <button className="iconbtn" title="Remove" data-testid={`qm-del-${i}`} disabled={qm.length <= 1} onClick={() => setQm(qm.filter((_, j) => j !== i))}>{Icon.trash({ size: 12 })}</button>
            </span>
          </div>
        ))}
        <button className="btn btn-sm pr-addrule" data-testid="qm-add" onClick={() => setQm([...qm, { qual: 'Specialist', m1: '', m2: '' }])}>{Icon.plus({ size: 12 })} Add</button>
        <SaveRow onCancel={saved} onSave={() => commit('qualMods', qm)} />
      </div>
    )
  }

  if (section === 'pos') {
    const upd = (i, k, v) => setPos((x) => ({ ...x, rows: x.rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)) }))
    return (
      <div className="pr-sec" data-testid="pr-pos">
        <SecHead t="Place of Service Modifiers" s="Extra modifiers added based on the session's place of service code." />
        {pos.rows.map((r, i) => (
          <div className="pr-prow" key={i} data-testid={`pos-row-${i}`}>
            <Dropdown testid={`pos-code-${i}`} value={r.pos} onChange={(v) => upd(i, 'pos', v)} options={POS_CODES.map((x) => ({ value: x.id, label: x.id, sub: x.label.split(' · ')[1] }))} />
            <Dropdown testid={`pos-mod-${i}`} value={r.mod || ''} onChange={(v) => upd(i, 'mod', v)} options={[{ value: '', label: 'None' }, ...MODIFIERS.map((m) => ({ value: m, label: m }))]} />
            <button className="iconbtn" title="Remove row" data-testid={`pos-del-${i}`} onClick={() => setPos({ ...pos, rows: pos.rows.filter((_, j) => j !== i) })}>{Icon.trash({ size: 12 })}</button>
          </div>
        ))}
        <button className="btn btn-sm pr-addrule" data-testid="pos-add" onClick={() => setPos({ ...pos, rows: [...pos.rows, { pos: '99', mod: '' }] })}>{Icon.plus({ size: 12 })} Add row</button>
        <div className="pr-checks">
          <label className="pr-check"><input type="checkbox" checked={pos.hideTeleOther} disabled data-testid="pos-hide02" onChange={(e) => setPos({ ...pos, hideTeleOther: e.target.checked })} /><span>Hide POS-02 (other than patient home) in Appointment Location (not available: every video location uses POS-10, so there are no POS-02 locations to hide)</span></label>
          <label className="pr-check"><input type="checkbox" checked={pos.hideTeleHome} data-testid="pos-hide10" onChange={(e) => setPos({ ...pos, hideTeleHome: e.target.checked })} /><span>Hide POS-10 (rendered from home) in Appointment Location. Telehealth locations are removed from the booking picker for this payer’s clients.</span></label>
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
      <SecHead t="MUEs" s="Medically Unlikely Edits: the most units per code per day, and per week if the payer sets a weekly cap. The booking dialog warns when a client's sessions would go over." />
      <div className="pr-banner" data-testid="mue-banner">{Icon.alert({ size: 12 })} These MUEs are applied for all <b>Uncompleted</b> appointments for {p.name}.</div>
      <div className="pr-frow" data-testid="mue-daily-row">
        <span className="pr-flabel">Daily Limit (All Codes)</span>
        <Dropdown testid="mue-daily" value={mue.daily || ''} onChange={(v) => setMue({ ...mue, daily: v })} options={[{ value: '', label: 'None' }, ...MUE_LIMITS.map((m) => ({ value: m, label: m }))]} />
      </div>
      <div className="pr-muetable">
        <div className="pr-muehead"><span>Billing Code</span><span>Daily limit</span><span>Weekly limit</span></div>
        {codes.map((c) => (
          <div className="pr-muerow" key={c} data-testid={`mue-row-${c}`}>
            <b>{c}</b>
            <Dropdown testid={`mue-${c}`} value={mue.per[c] || ''} onChange={(v) => setMue({ ...mue, per: { ...mue.per, [c]: v } })} options={[{ value: '', label: 'No Limits' }, ...MUE_LIMITS.filter((m) => m !== 'No Limits').map((m) => ({ value: m, label: `${m} units` }))]} />
            <input className="input" type="number" min="0" placeholder="No limit" aria-label={`${c} weekly limit (units)`} data-testid={`mue-wk-${c}`} value={mue.weekly?.[c] || ''} onChange={(e) => setMue({ ...mue, weekly: { ...(mue.weekly || {}), [c]: e.target.value } })} />
          </div>
        ))}
      </div>
      <SaveRow onCancel={saved} onSave={() => commit('mue', mue)} />
    </div>
  )
}

function SecHead({ t, s }) {
  return <div className="pr-head"><b>{t}</b>{s && <InfoTip label={t} wiki="billing-and-claims" testid="pr-info">{s}</InfoTip>}</div>
}
function SaveRow({ onSave, onCancel }) {
  return (
    <div className="pr-save">
      <button className="btn btn-sm" data-testid="pr-cancel" onClick={onCancel}>Cancel</button>
      <button className="btn btn-sm btn-primary" data-testid="pr-save" onClick={onSave}>Save</button>
    </div>
  )
}
