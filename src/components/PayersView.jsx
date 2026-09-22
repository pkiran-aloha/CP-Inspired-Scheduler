import React, { useEffect, useMemo, useState } from 'react'
import { useStore } from '../state/store'
import { SectionBar } from './NavRail'
import { CMS_TYPES, FORMATS } from '../lib/master'
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
const blank = () => ({ name: '', aka: '', type: '', svcList: 'None', required: 'No', status: 'active', street: '', city: '', state: 'CA', zip: '', addressNotes: '', contacts: [{ kind: 'Main', number: '' }], evvId: '', email: '', thirdPartyId: '', cmsType: 'Group Health Plan', format: 'None', payerId: '', clearingHouse: 'Office Ally' })
const phoneOf = (p) => (p.contacts || []).find((c) => c.kind === 'Main')?.number || p.contacts?.[0]?.number || ''

export function PayerForm({ payer, onClose, used = 0, onRemove }) {
  const state = useStore()
  const [form, setForm] = useState(() => (payer ? { ...blank(), ...payer, contacts: (payer.contacts || []).length ? payer.contacts.map((c) => ({ ...c })) : [{ kind: 'Main', number: '' }] } : blank()))
  const [errs, setErrs] = useState({})
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  const set = (k, v) => { setForm((f) => ({ ...f, [k]: v })); setErrs((e) => ({ ...e, [k]: undefined })) }
  const setContact = (i, k, v) => set('contacts', form.contacts.map((c, j) => (j === i ? { ...c, [k]: v } : c)))

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
    if (Object.keys(E).length) { setErrs(E); return }
    return { ...(payer || {}), ...form, id: payer?.id || form.id, name, contacts: form.contacts.filter((c) => c.number.trim()) }
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
        <button className="iconbtn modal-x" aria-label="Close" data-testid="py-close" onClick={onClose}>{Icon.x({ size: 14 })}</button>
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
          </div>
        </div>
      </div>
      <div className="py-foot">
        {onRemove && <RemoveArm name={form.name || payer?.name || 'payer'} used={used} onRemove={onRemove} idp={payer?.id} />}
        <span className="py-remember">Please remember to save your changes</span>
        <button className="btn btn-sm btn-primary" data-testid="py-save" onClick={() => { const v = save(); if (v) onClose(v) }}>Save</button>
        <button className="btn btn-sm" data-testid="py-cancel" onClick={onClose}>Cancel</button>
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
  const [modal, setModal] = useState(null) // 'new' | payer
  const payers = useMemo(() => state.payers || [], [state.payers])
  const countFor = (name) => state.clients.filter((c) => (c.insurer || '') === name).length

  const rows = useMemo(() => {
    let r = payers.map((p) => ({ ...p, clients: countFor(p.name) }))
    if (activeOnly) r = r.filter((p) => p.status === 'active')
    const s = q.trim().toLowerCase()
    if (s) r = r.filter((p) => `${p.name} ${p.aka || ''} ${p.email || ''} ${p.city || ''} ${p.evvId || ''}`.toLowerCase().includes(s))
    r.sort((a, b) => (sort.k === 'clients' ? a.clients - b.clients : String(a[sort.k] || '').localeCompare(String(b[sort.k] || ''), undefined, { numeric: true })) * sort.d)
    return r
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payers, q, activeOnly, sort, state.clients])

  useEffect(() => setPage(0), [q, activeOnly, sort])
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE))
  const view = rows.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE)
  const flip = (k) => setSort((s) => ({ k, d: s.k === k ? -s.d : 1 }))
  const arrow = (k) => (sort.k === k ? (sort.d === 1 ? ' ▲' : ' ▼') : '')

  const save = (v) => {
    if (!v) { setModal(null); return }
    actions.addPayer({ policy: { kind: v.type === 'Self-pay' ? 'selfpay' : v.type === 'Government' ? 'medicaid' : 'commercial', avgDays: 25, timely: 120, coins: 0.8, copay: 0 }, ...v })
    setModal(null)
    toast({ message: `${v.name} added to the payer directory`, kind: 'ok' })
  }

  const filtersOn = activeOnly || q.trim()
  return (
    <div className="py-list">
      <div className="py-tools">
        <span className="muted py-toolcount">{payers.length} payer{payers.length === 1 ? '' : 's'} · {activeOnly ? 'active only' : 'all statuses'}</span>
        <input className="input" style={{ width: 200, height: 30 }} placeholder="Search payers, IDs, cities…" value={q} onChange={(e) => setQ(e.target.value)} data-testid="py-search" />
        <button className={`btn btn-sm${activeOnly ? ' btn-primary' : ''}`} data-testid="py-active-filter" onClick={() => setActiveOnly((v) => !v)} title="Show active payers only">{Icon.check({ size: 12 })} Active</button>
        <button className="btn btn-sm btn-primary" data-testid="py-add" onClick={() => setModal('new')}>{Icon.plus({ size: 12 })} Add Payer</button>
      </div>

      {filtersOn && (
        <div className="py-frow" data-testid="py-frow">
          <span className="py-flabel">Show:</span>
          {activeOnly && <button className="dsh-fchip" data-testid="py-f-active" onClick={() => setActiveOnly(false)}>Active <i>✕</i></button>}
          {q.trim() && <button className="dsh-fchip" data-testid="py-f-q" onClick={() => setQ('')}>“{q.trim()}” <i>✕</i></button>}
          <button className="dsh-fclear" data-testid="py-clear" onClick={() => { setQ(''); setActiveOnly(false) }}>Clear All Filters</button>
        </div>
      )}

      <div className="an-wrap" style={{ paddingTop: 10 }}>
        <div className="dir-tables">
          <table className="dir-table" data-testid="payers-table">
            <thead>
              <tr>
                <th className="sortable" data-testid="py-sort-name" onClick={() => flip('name')} style={{ cursor: 'pointer' }}>Payer Name{arrow('name')}</th>
                <th className="sortable" data-testid="py-sort-type" onClick={() => flip('type')} style={{ cursor: 'pointer', width: 130 }}>Payer Type{arrow('type')}</th>
                <th style={{ width: 165 }}>Service Type List</th>
                <th style={{ width: 205 }}>Required to complete the Appointment</th>
                <th className="sortable" data-testid="py-sort-clients" onClick={() => flip('clients')} style={{ cursor: 'pointer', width: 78, textAlign: 'right' }}>Clients{arrow('clients')}</th>
                <th style={{ width: 140 }}>Phone Number</th>
              </tr>
            </thead>
            <tbody>
              {view.length === 0 && <tr><td colSpan={6} className="py-empty">No payers match — clear the filters or add one.</td></tr>}
              {view.map((p) => (
                <tr key={p.id} data-testid={`py-row-${p.id}`} onClick={() => actions.setUI({ payerSel: p.id })} title="Open the payer record — profile, services & billing rules">
                  <td>
                    <span className="py-name">
                      <span className="py-av" style={{ background: colorFor(p.name) }}>{initialsOf(p.name)}<i className={`py-dot${p.status === 'active' ? '' : ' off'}`} /></span>
                      <span className="py-nm"><b>{p.name}</b>{p.aka && <em>{p.aka}</em>}</span>
                    </span>
                  </td>
                  <td>{p.type || '—'}</td>
                  <td>{p.svcList === 'None' ? <span className="muted">None</span> : p.svcList}</td>
                  <td>{p.required === 'No' ? <span className="muted">No</span> : <span className="tag">{p.required === 'Yes' ? 'Required' : p.required.replace('Yes — after authorization is on file', 'Required after auth')}</span>}</td>
                  <td style={{ textAlign: 'right' }}><span className={`py-cnt${p.clients ? '' : ' z'}`} data-testid={`py-ct-${p.id}`}>{p.clients}</span></td>
                  <td className="py-phone">{phoneOf(p) || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="py-pager" data-testid="py-pager">
            <span className="muted">{rows.length ? `${page * PAGE_SIZE + 1}–${Math.min(rows.length, (page + 1) * PAGE_SIZE)} of ${rows.length}` : '0 payers'}</span>
            {pages > 1 && (
              <span className="py-pages">
                {Array.from({ length: pages }, (_, i) => (
                  <button key={i} className={`pg-num${i === page ? ' on' : ''}`} data-testid={`py-page-${i}`} onClick={() => setPage(i)}>{i + 1}</button>
                ))}
              </span>
            )}
          </div>
        </div>
      </div>

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
