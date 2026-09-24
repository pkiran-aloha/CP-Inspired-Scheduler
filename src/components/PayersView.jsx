import React, { useEffect, useMemo, useState } from 'react'
import { useStore } from '../state/store'
import { CMS_TYPES, FORMATS } from '../lib/master'
import { InlineText, InlineSelect } from './fields'
import { Icon } from '../ui/Icons'
import { useToast } from '../ui/Toast'

/**
 * Payer master — directory list + full add/edit form mirroring the payer-record
 * layout practices already know: identity & routing on the left, service address,
 * contacts (Main/Fax/portal) and payer IDs on the right. Status gates where a
 * payer can still be picked on client files.
 */
const PY_TYPES = ['Insurance', 'Government', 'School district', 'Self-pay', 'Employer plan']
const SVC_LISTS = ['None', 'ABA Standard', 'ABA + related services', 'School-based', 'Telehealth']
const REQ_OPTS = ['No', 'Yes', 'Yes — after authorization is on file']
const US_STATES = ['CA', 'OR', 'WA', 'NV', 'AZ', 'TX', 'NY', 'FL', 'Other']
const CONTACT_KINDS = ['Main', 'Fax', 'Email', 'Claims portal']
const PAGE_SIZE = 12
const COLORS = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#14b8a6', '#ef4444']
const initialsOf = (n) => { const w = String(n || '').replace(/[^A-Za-z ]/g, '').trim().split(/\s+/); return ((w[0]?.[0] || '?') + (w[1]?.[0] || '')).toUpperCase() }
const colorFor = (n) => COLORS[[...String(n || '')].reduce((a, c) => a + c.charCodeAt(0), 0) % COLORS.length]
const blank = () => ({ name: '', aka: '', type: '', svcList: 'None', required: 'No', status: 'active', street: '', city: '', state: 'CA', zip: '', addressNotes: '', contacts: [{ kind: 'Main', number: '' }], evvId: '', email: '', thirdPartyId: '', cmsType: 'Group Health Plan', format: 'None', payerId: '', clearingHouse: 'Office Ally', ext: { group: '', plan: '', subId: '', ticareId: '', medicaidId: '', bhpnId: '', filingDeadlineDays: null, requiresSecondaryBox18: true } })
const phoneOf = (p) => (p.contacts || []).find((c) => c.kind === 'Main')?.number || p.contacts?.[0]?.number || ''

export function PayerForm({ payer, onClose, used = 0, onRemove }) {
  const state = useStore()
  const [form, setForm] = useState(() => (payer ? { ...blank(), ...payer, ext: { ...blank().ext, ...(payer.ext||{}) }, contacts: (payer.contacts || []).length ? payer.contacts.map((c) => ({ ...c })) : [{ kind: 'Main', number: '' }] } : blank()))
  const [errs, setErrs] = useState({})
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  const set = (k, v) => { setForm((f) => ({ ...f, [k]: v })); setErrs((e) => ({ ...e, [k]: undefined })) }
  const setContact = (i, k, v) => set('contacts', form.contacts.map((c, j) => (j === i ? { ...c, [k]: v } : c)))
  const setExt = (k, v) => set('ext', { ...(form.ext||{}), [k]: v })

  const save = () => {
    const E = {}
    const name = form.name.trim()
    if (!name) E.name = 'Payer name is required'
    else if (name.length > 60) E.name = 'Keep the payer name under 60 characters'
    if (name && (state.payers || []).some((p) => p.id !== payer?.id && p.name.toLowerCase() === name.toLowerCase())) E.name = 'Another payer already uses this name'
    if (!form.type) E.type = 'Choose a payer type'
    if (!form.street.trim()) E.street = 'Street is required'
    if (!form.city.trim()) E.city = 'City is required'
    if (!form.state) E.state = 'State is required'
    if (!/^\d{5}(-\d{4})?$/.test(form.zip.trim())) E.zip = 'Enter a 5-digit ZIP'
    const fd = form.ext?.filingDeadlineDays
    if (fd != null && fd !== '') { const n = Number(fd); if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0 || n > 999) E.filingDeadlineDays = '0–999 integer days' }
    if (Object.keys(E).length) { setErrs(E); return }
    const extClean = { group: String(form.ext?.group||'').trim(), plan: String(form.ext?.plan||'').trim(), subId: String(form.ext?.subId||'').trim(), ticareId: String(form.ext?.ticareId||'').trim(), medicaidId: String(form.ext?.medicaidId||'').trim(), bhpnId: String(form.ext?.bhpnId||'').trim(), filingDeadlineDays: form.ext?.filingDeadlineDays===''||form.ext?.filingDeadlineDays==null?null:Number(form.ext?.filingDeadlineDays), requiresSecondaryBox18: form.ext?.requiresSecondaryBox18!==false }
    if (extClean.filingDeadlineDays!=null && (!Number.isFinite(extClean.filingDeadlineDays) || extClean.filingDeadlineDays<0)) extClean.filingDeadlineDays=null
    return { ...(payer || {}), ...form, ext: extClean, id: payer?.id || form.id, name, contacts: form.contacts.filter((c) => c.number.trim()) }
  }
  const Fld = ({ k, label, req, children, hint }) => (
    <label className="bil-fld pm-fld">
      <span>{label}{req && ' *'}</span>
      {children || <input className={`input${errs[k] ? ' err' : ''}`} value={form[k] ?? ''} placeholder={errs[k] ? '' : hint || ''} data-testid={`py-${k}`} onChange={(e) => set(k, e.target.value)} />}
      {errs[k] && <i className="pm-err">{errs[k]}</i>}
    </label>
  )
  return (
    <div className="modal pm-modal py-modal" role="dialog" aria-modal="true" aria-label={payer ? `Edit payer — ${payer.name}` : 'Add Payer'} data-testid="payer-form" tabIndex={-1}>
      <div className="modal-head pm-head">
        <h3>{payer ? `Payer — ${payer.name}` : 'Add Payer'}</h3>
        <button className="iconbtn modal-x" aria-label="Close" data-testid="py-close" onClick={() => onClose()}>{Icon.x({ size: 14 })}</button>
      </div>
      <div className="modal-body">
        <div className="py-cols">
          <div className="py-col">
            <div className="py-sec">{Icon.shield({ size: 12 })} Payer identity</div>
            <Fld k="name" label="Payer Name" req />
            <div className="py-countwrap"><span className="py-count" data-testid="py-count">{form.name.length}/60</span></div>
            <Fld k="aka" label="Payer AKA" hint="Also known as — appears in searches" />
            <Fld k="type" label="Payer Type" req>
              <select className={`input${errs.type ? ' err' : ''}`} value={form.type} data-testid="py-type" onChange={(e) => set('type', e.target.value)}>
                <option value="">— choose —</option>
                {PY_TYPES.map((t) => <option key={t}>{t}</option>)}
              </select>
            </Fld>
            <div className="py-two">
              <Fld k="cmsType" label="CMS Type">
                <select className="input" value={form.cmsType} data-testid="py-cms" onChange={(e) => set('cmsType', e.target.value)}>{CMS_TYPES.map((t) => <option key={t}>{t}</option>)}</select>
              </Fld>
              <Fld k="format" label="Customized Format">
                <select className="input" value={form.format} data-testid="py-format" onChange={(e) => set('format', e.target.value)}>{FORMATS.map((t) => <option key={t}>{t}</option>)}</select>
              </Fld>
            </div>
            <div className="py-two">
              <Fld k="payerId" label="Payer ID" hint="Primary identifier for claim routing" />
              <Fld k="clearingHouse" label="Clearing House" hint="Where claims route from" />
            </div>
            <Fld k="svcList" label="Service Type List">
              <select className="input" value={form.svcList} data-testid="py-svc" onChange={(e) => set('svcList', e.target.value)}>{SVC_LISTS.map((t) => <option key={t}>{t}</option>)}</select>
            </Fld>
            <label className="bil-fld pm-fld">
              <span>Status</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <button type="button" className={`toggle ${form.status === 'active' ? 'on' : ''}`} data-testid="py-status" aria-pressed={form.status === 'active'} onClick={() => set('status', form.status === 'active' ? 'inactive' : 'active')} />
                <span className="muted" style={{ fontSize: 11.5, textTransform: 'capitalize' }}>{form.status}</span>
              </div>
            </label>
            <Fld k="required" label="Required to complete the Appointment">
              <select className="input" value={form.required} data-testid="py-required" onChange={(e) => set('required', e.target.value)}>{REQ_OPTS.map((t) => <option key={t}>{t}</option>)}</select>
            </Fld>
          </div>
          <div className="py-col">
            <div className="py-sec">{Icon.pin({ size: 12 })} Service address</div>
            <div className="py-two">
              <Fld k="street" label="Street" req hint="1200 Example Way, Ste 300" />
              <Fld k="city" label="City" req />
              <Fld k="state" label="State" req>
                <select className={`input${errs.state ? ' err' : ''}`} value={form.state} data-testid="py-state" onChange={(e) => set('state', e.target.value)}>{US_STATES.map((t) => <option key={t}>{t}</option>)}</select>
              </Fld>
              <Fld k="zip" label="Zip Code" req hint="94105" />
            </div>
            <Fld k="addressNotes" label="Address Notes"><textarea className="input py-ta" rows={2} value={form.addressNotes} data-testid="py-addressNotes" placeholder="Remittance quirks, portal logins, routing caveats…" onChange={(e) => set('addressNotes', e.target.value)} /></Fld>
            <div className="py-sec py-sec-contacts">
              {Icon.phone({ size: 12 })} Contacts
              <button type="button" className="btn btn-sm btn-ghost" data-testid="py-c-add" onClick={() => set('contacts', [...form.contacts, { kind: 'Main', number: '' }])}>{Icon.plus({ size: 11 })} Add</button>
            </div>
            {form.contacts.map((c, i) => (
              <div className="py-contact" key={i} data-testid={`py-contact-${i}`}>
                <select className="input" value={c.kind} data-testid={`py-c-kind-${i}`} onChange={(e) => setContact(i, 'kind', e.target.value)}>{CONTACT_KINDS.map((t) => <option key={t}>{t}</option>)}</select>
                <input className="input" value={c.number} placeholder={c.kind === 'Claims portal' ? 'portal.example.com/aba' : '(800) 555-0100'} data-testid={`py-c-val-${i}`} onChange={(e) => setContact(i, 'number', e.target.value)} />
                <button type="button" className="iconbtn" aria-label="Remove contact" data-testid={`py-c-del-${i}`} disabled={form.contacts.length === 1} onClick={() => set('contacts', form.contacts.filter((_, j) => j !== i))}>{Icon.x({ size: 11 })}</button>
              </div>
            ))}
            <div className="py-sec py-sec-ids">{Icon.clipboard({ size: 12 })} Payer IDs & billing contact</div>
            <div className="py-two">
              <Fld k="evvId" label="EVV Payer ID" hint="EVV-0000" />
              <Fld k="email" label="Email Address" hint="provider.relations@payer.example.com" />
              <Fld k="thirdPartyId" label="Third party ID" hint="TPA-0000" />
            </div>
            <div className="py-sec py-sec-billids">{Icon.dollar({ size: 12 })} Billing identifiers</div>
            <div className="py-two">
              <Fld k="ext-group" label="Group #"><input className="input" value={form.ext?.group||''} placeholder="GRP-…" data-testid="py-ext-group" onChange={(e)=>setExt('group', e.target.value)} /></Fld>
              <Fld k="ext-plan" label="Plan #"><input className="input" value={form.ext?.plan||''} placeholder="PLAN-…" data-testid="py-ext-plan" onChange={(e)=>setExt('plan', e.target.value)} /></Fld>
              <Fld k="ext-subId" label="Sub ID"><input className="input" value={form.ext?.subId||''} placeholder="SUB-…" data-testid="py-ext-sub" onChange={(e)=>setExt('subId', e.target.value)} /></Fld>
              <Fld k="ext-ticare" label="Ticare ID"><input className="input" value={form.ext?.ticareId||''} placeholder="TICARE-…" data-testid="py-ext-ticare" onChange={(e)=>setExt('ticareId', e.target.value)} /></Fld>
              <Fld k="ext-medicaid" label="Medicaid ID"><input className="input" value={form.ext?.medicaidId||''} placeholder="MED-…" data-testid="py-ext-medicaid" onChange={(e)=>setExt('medicaidId', e.target.value)} /></Fld>
              <Fld k="ext-bhpn" label="BHPN ID"><input className="input" value={form.ext?.bhpnId||''} placeholder="BHPN-…" data-testid="py-ext-bhpn" onChange={(e)=>setExt('bhpnId', e.target.value)} /></Fld>
              <Fld k="filingDeadlineDays" label="Filing deadline (days)"><input className={`input${errs.filingDeadlineDays?' err':''}`} type="number" min={0} max={999} value={form.ext?.filingDeadlineDays??''} placeholder="payer default" data-testid="py-ext-filing" onChange={(e)=>{ const v=e.target.value.trim()===''?null:Number(e.target.value); setExt('filingDeadlineDays', Number.isFinite(v)?v:null) }} />{errs.filingDeadlineDays&&<i className="pm-err">{errs.filingDeadlineDays}</i>}</Fld>
              <label className="bil-fld pm-fld"><span>Requires Secondary Box 18</span><div style={{ display:'flex', alignItems:'center', gap:8 }}><button type="button" className={`toggle ${form.ext?.requiresSecondaryBox18!==false?'on':''}`} data-testid="py-ext-box18" onClick={()=>setExt('requiresSecondaryBox18', !(form.ext?.requiresSecondaryBox18!==false))} /><span className="muted" style={{ fontSize:11 }}>{form.ext?.requiresSecondaryBox18!==false?'Require on secondary':'Skip'}</span></div></label>
            </div>
          </div>
        </div>
      </div>
      <div className="py-foot">
        {onRemove && <RemoveArm name={form.name || payer?.name || 'payer'} used={used} onRemove={onRemove} idp={payer?.id} />}
        <span className="py-remember">Please remember to save your changes</span>
        <button className="btn btn-sm btn-primary" data-testid="py-save" onClick={() => { const v = save(); if (v) onClose(v) }}>Save</button>
        <button className="btn btn-sm" data-testid="py-cancel" onClick={() => onClose()}>Cancel</button>
      </div>
    </div>
  )
}

export function PayersList() {
  const state = useStore()
  const { actions } = state
  const toast = useToast()
  const [q, setQ] = useState('')
  const [activeOnly, setActiveOnly] = useState(false)
  const [sort, setSort] = useState({ k: 'name', d: 1 })
  const [page, setPage] = useState(0)
  const [modal, setModal] = useState(null) // 'new'
  const payers = useMemo(() => state.payers || [], [state.payers])
  const countFor = (name) => state.clients.filter((c) => (c.insurer || '') === name).length

  const rows = useMemo(() => {
    let r = payers.map((p) => ({ ...p, clients: countFor(p.name) }))
    if (activeOnly) r = r.filter((p) => p.status === 'active')
    const s = q.trim().toLowerCase()
    if (s) r = r.filter((p) => `${p.name} ${p.aka || ''} ${p.email || ''} ${p.city || ''} ${p.evvId || ''} ${p.payerId || ''}`.toLowerCase().includes(s))
    r.sort((a, b) => (sort.k === 'clients' ? a.clients - b.clients : String(a[sort.k] || '').localeCompare(String(b[sort.k] || ''), undefined, { numeric: true })) * sort.d)
    return r
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payers, q, activeOnly, sort, state.clients])

  useEffect(() => setPage(0), [q, activeOnly, sort])
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE))
  const view = rows.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE)
  const flip = (k) => setSort((x) => ({ k, d: x.k === k ? -x.d : 1 }))
  const arrow = (k) => (sort.k === k ? (sort.d === 1 ? ' ▲' : ' ▼') : '')

  const save = (v) => {
    // close buttons call onClose() with no payload; ignore anything that isn't a plain record (e.g. leaked click events)
    if (!v || typeof v !== 'object' || 'nativeEvent' in v || v.target) { setModal(null); return }
    actions.addPayer({ policy: { kind: v.type === 'Self-pay' ? 'selfpay' : v.type === 'Government' ? 'medicaid' : 'commercial', avgDays: 25, timely: 120, coins: 0.8, copay: 0 }, ...v })
    setModal(null)
    toast({ message: `${v.name} added to the payer directory`, kind: 'ok' })
  }
  // inline edits write straight to the payer record — no modal round-trip
  const patch = (p, changes, what) => { actions.updatePayer({ id: p.id, ...changes }); if (what) toast({ message: `${p.name} — ${what}`, kind: 'ok' }) }
  const patchPhone = (p, phone) => {
    const list = (p.contacts || []).slice()
    const i = list.findIndex((c) => c.kind === 'Main')
    if (i >= 0) list[i] = { ...list[i], number: phone }
    else list.unshift({ kind: 'Main', number: phone })
    patch(p, { contacts: list.filter((c) => c.number.trim()) }, 'phone updated')
  }

  const filtersOn = activeOnly || q.trim()
  // structural overview for the page band (chunk-36)
  const nActive = payers.filter((x) => x.status !== 'inactive').length
  const nUsed = payers.filter((x) => countFor(x.name) > 0).length
  const nFields = payers.filter((x) => (x.cf || []).length > 0).length
  const nContract = payers.filter((x) => (x.services || []).length > 0).length
  return (
    <div className="py-list">
      <div className="py-band" data-testid="py-band">
        <span className="py-band-ic">{Icon.users({ size: 17 })}</span>
        <div className="py-band-t">
          <h2>Payer directory</h2>
          <p>Every contract the front desk books against. Click a row for the full record — profile, services & billing rules; edit any cell in place.</p>
        </div>
        <span className="an-spacer" />
        <button className="btn btn-sm btn-primary" data-testid="py-add" onClick={() => setModal('new')}>{Icon.plus({ size: 12 })} Add Payer</button>
      </div>
      <div className="py-stats" data-testid="py-stats">
        <button className={`py-stat${!filtersOn ? ' hot' : ''}`} data-testid="py-stat-all" onClick={() => { setQ(''); setActiveOnly(false) }} title="Show all payers"><b>{payers.length}</b> payers</button>
        <button className={`py-stat${activeOnly ? ' hot' : ''}`} data-testid="py-stat-active" onClick={() => setActiveOnly((v) => !v)} title="Toggle active-only"><b>{nActive}</b> active</button>
        <span className="py-stat"><b>{nUsed}</b> in use by clients</span>
        <span className="py-stat"><b>{nFields}</b> with custom fields</span>
        <span className="py-stat"><b>{nContract}</b> with narrowed contracts</span>
      </div>
      <section className="py-dirsec" data-testid="py-sec">
        <header className="py-sech">
          <span className="py-sech-ic">{Icon.table({ size: 13 })}</span>
          <b>Master list</b>
          <i>sortable · inline-editable</i>
          <span className="an-spacer" />
          <input className="input" style={{ width: 200, height: 29 }} placeholder="Search payers, IDs, cities…" value={q} onChange={(e) => setQ(e.target.value)} data-testid="py-search" />
          <button className={`btn btn-sm${activeOnly ? ' btn-primary' : ''}`} data-testid="py-active-filter" onClick={() => setActiveOnly((v) => !v)} title="Show active payers only">{Icon.check({ size: 12 })} Active</button>
          <span className="muted py-toolcount">{rows.length} of {payers.length}</span>
        </header>

      {filtersOn && (
        <div className="py-frow" data-testid="py-frow">
          <span className="py-flabel">Show:</span>
          {activeOnly && <button className="dsh-fchip" data-testid="py-f-active" onClick={() => setActiveOnly(false)}>Active <i>✕</i></button>}
          {q.trim() && <button className="dsh-fchip" data-testid="py-f-q" onClick={() => setQ('')}>“{q.trim()}” <i>✕</i></button>}
          <button className="dsh-fclear" data-testid="py-clear" onClick={() => { setQ(''); setActiveOnly(false) }}>Clear All Filters</button>
        </div>
      )}

        <div className="py-tbl" data-testid="payers-table">
          <div className="py-thead">
            <button className="sortable" data-testid="py-sort-name" onClick={() => flip('name')}>Payer Name{arrow('name')}</button>
            <button className="sortable" data-testid="py-sort-type" onClick={() => flip('type')}>Type{arrow('type')}</button>
            <span>Service Type List</span>
            <span>Completion Requirement</span>
            <button className="sortable num" data-testid="py-sort-clients" onClick={() => flip('clients')}>Clients{arrow('clients')}</button>
            <span>Phone</span>
            <span>Status</span>
            <span />
          </div>
          {view.length === 0 && <div className="py-empty py-tempty">No payers match — clear the filters or add one from the top of the page.</div>}
          {view.map((p) => (
            <div className="py-trow" key={p.id} data-testid={`py-row-${p.id}`} onClick={() => actions.setUI({ payerSel: p.id })} title="Open the payer record — profile, services & billing rules">
              <div className="py-idcell">
                <span className="py-av" style={{ background: colorFor(p.name) }}>{initialsOf(p.name)}<i className={`py-dot${p.status === 'active' ? '' : ' off'}`} /></span>
                <span className="py-idtxt">
                  <b>{p.name}</b>
                  <InlineText testid={`py-aka-${p.id}`} value={p.aka || ''} placeholder="add also-known-as" onCommit={(v) => patch(p, { aka: String(v).trim() }, 'aka updated')} />
                </span>
              </div>
              <div className="py-cell">
                <InlineSelect testid={`py-type-${p.id}`} value={p.type || ''} options={[{ value: '', label: '—' }, ...PY_TYPES.map((t) => ({ value: t, label: t }))]} onCommit={(v) => patch(p, { type: v }, 'type updated')} />
              </div>
              <div className="py-cell">
                <InlineSelect testid={`py-svclist-${p.id}`} value={p.svcList || 'None'} options={SVC_LISTS.map((t) => ({ value: t, label: t }))} onCommit={(v) => patch(p, { svcList: v }, 'service type list updated')} render={(v) => (v === 'None' || !v ? <span className="muted">None</span> : <span className="tag soft">{v}</span>)} />
              </div>
              <div className="py-cell">
                <InlineSelect testid={`py-req-${p.id}`} value={p.required || 'No'} options={REQ_OPTS.map((t) => ({ value: t, label: t }))} onCommit={(v) => patch(p, { required: v }, 'completion requirement updated')} render={(v) => (v === 'No' ? <span className="muted">No</span> : <span className="tag">{v === 'Yes' ? 'Required' : 'Required after auth'}</span>)} />
              </div>
              <div className="py-cell num"><span className={`py-cnt${p.clients ? '' : ' z'}`} data-testid={`py-ct-${p.id}`}>{p.clients}</span></div>
              <div className="py-cell"><InlineText testid={`py-phone-${p.id}`} value={phoneOf(p)} placeholder="add phone" onCommit={(v) => patchPhone(p, String(v).trim())} /></div>
              <div className="py-cell">
                <button className={`py-statustog${p.status === 'active' ? ' on' : ''}`} data-testid={`py-status-${p.id}`} title="Toggle active / inactive"
                  onClick={(e) => { e.stopPropagation(); patch(p, { status: p.status === 'active' ? 'inactive' : 'active' }, p.status === 'active' ? 'marked inactive — hidden from client files' : 'marked active') }}>
                  <i />{p.status === 'active' ? 'Active' : 'Inactive'}
                </button>
              </div>
              <span className="py-tgo">{Icon.chevronR({ size: 13 })}</span>
            </div>
          ))}
          <div className="py-pager" data-testid="py-pager">
            <span className="muted">{rows.length ? `${page * PAGE_SIZE + 1}–${Math.min(rows.length, (page + 1) * PAGE_SIZE)} of ${rows.length}` : '0 payers'}</span>
            {pages > 1 && (
              <span className="py-pages">
                {Array.from({ length: pages }, (_, i) => (
                  <button key={i} className={`pg-num${i === page ? ' on' : ''}`} data-testid={`py-page-${i}`} onClick={(e) => { e.stopPropagation(); setPage(i) }}>{i + 1}</button>
                ))}
              </span>
            )}
          </div>
        </div>
      </section>

      {modal && (
        <div className="overlay pm-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) setModal(null) }}>
          <PayerForm payer={null} onClose={save} />
        </div>
      )}
    </div>
  )
}

/** Delete lives in the footer of the open record — armed twice, blocked while clients reference it. */
export function RemoveArm({ name, used, onRemove, idp }) {
  const [armed, setArmed] = useState(false)
  useEffect(() => { if (!armed) return; const t = setTimeout(() => setArmed(false), 3500); return () => clearTimeout(t) }, [armed])
  return (
    <button className={`btn btn-sm${armed ? ' btn-danger-armed' : ''}`} data-testid={`py-remove${idp ? `-${idp}` : ''}`}
      title={used ? 'Clients still reference this payer — reassign them first' : 'Remove this payer from the directory'}
      onClick={() => (armed ? onRemove() : setArmed(true))}>
      {Icon.trash({ size: 12 })} {armed ? 'Click again to remove' : used ? `In use by ${used}` : 'Remove payer'}
    </button>
  )
}
