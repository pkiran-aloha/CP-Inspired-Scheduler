import React, { useEffect, useMemo, useState } from 'react'
import { useStore } from '../state/store'
import { SectionBar } from './NavRail'
import { Icon } from '../ui/Icons'
import { useToast } from '../ui/Toast'
import { Dropdown } from './fields'
import { PayersList } from './PayersView'
import PayerDetail from './PayerDetail'
import { svcList, CREDENTIALS, ROUNDINGS } from '../lib/master'
import { BILL_CODES } from '../lib/model'

/**
 * Masters — the configuration backbone of the practice: who pays (payers, with
 * their contracted services & billing rules) and what we bill (the service type
 * master that feeds the appointment wizard, quick-add and every rate card).
 */
export default function MastersView() {
  const state = useStore()
  const { ui, actions } = state
  if (ui.payerSel) {
    const payer = (state.payers || []).find((p) => p.id === ui.payerSel)
    if (payer) return <PayerDetail payer={payer} onBack={() => actions.setUI({ payerSel: null })} />
  }
  const tab = ui.mastersTab === 'svcs' ? 'svcs' : 'payers'
  const svcs = svcList(state)
  return (
    <div className="sectionpage">
      <SectionBar icon="clipboard" title="Masters" sub={`${(state.payers || []).length} payers · ${svcs.length} service types`}>
        <div className="ms-seg" role="tablist" aria-label="Master lists">
          <button role="tab" aria-selected={tab === 'payers'} className={`ms-segb${tab === 'payers' ? ' on' : ''}`} data-testid="masters-tab-payers" onClick={() => actions.setUI({ mastersTab: 'payers', payerSel: null })}>
            {Icon.shield({ size: 12 })} Payers<span className="ms-n">{(state.payers || []).length}</span>
          </button>
          <button role="tab" aria-selected={tab === 'svcs'} className={`ms-segb${tab === 'svcs' ? ' on' : ''}`} data-testid="masters-tab-svcs" onClick={() => actions.setUI({ mastersTab: 'svcs', payerSel: null })}>
            {Icon.clipboard({ size: 12 })} Service Types<span className="ms-n">{svcs.length}</span>
          </button>
        </div>
      </SectionBar>
      {tab === 'payers' ? <PayersList /> : <ServiceTypesView />}
    </div>
  )
}

/* ── Service types master list ─────────────────────────────────────────── */
function ServiceTypesView() {
  const state = useStore()
  const { actions } = state
  const toast = useToast()
  const [q, setQ] = useState('')
  const [edit, setEdit] = useState(null) // 'new' | svc
  const all = svcList(state)
  const usedBy = useMemo(() => {
    const m = {}
    const list = Array.isArray(state.appts) ? state.appts : Object.values(state.appts || {})
    for (const a of list) if (a.service) m[a.service] = (m[a.service] || 0) + 1
    return m
  }, [state.appts])
  const payerUse = useMemo(() => {
    const m = {}
    for (const p of state.payers || []) for (const id of p.services || []) m[id] = (m[id] || 0) + 1
    return m
  }, [state.payers])

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase()
    return s ? all.filter((x) => `${x.label} ${x.code}`.toLowerCase().includes(s)) : all
  }, [all, q])

  const save = (v) => {
    if (!v) { setEdit(null); return }
    if (edit === 'new') actions.addSvc(v)
    else actions.updateSvc({ id: edit.id, ...v })
    setEdit(null)
    toast({ message: `“${v.label}” ${edit === 'new' ? 'added to' : 'updated in'} the service master`, kind: 'ok' })
  }
  const remove = (s) => {
    const used = usedBy[s.id] || 0
    if (used) { toast({ message: `${s.label} is used by ${used} appointment${used === 1 ? '' : 's'} — it can’t be deleted`, kind: 'error' }); return }
    // also drop it from any payer contracts/overrides that still reference it
    for (const p of state.payers || []) {
      const had = (p.services || []).includes(s.id) || (p.svcOv && p.svcOv[s.id])
      if (had) actions.updatePayer({ id: p.id, services: (p.services || []).filter((x) => x !== s.id), svcOv: Object.fromEntries(Object.entries(p.svcOv || {}).filter(([k]) => k !== s.id)) })
    }
    actions.removeSvc(s.id)
    toast({ message: `${s.label} removed from the service master`, kind: 'info' })
  }
  const flip = (s) => {
    actions.updateSvc({ id: s.id, status: s.status === 'active' ? 'inactive' : 'active' })
    toast({ message: `${s.label} marked ${s.status === 'active' ? 'inactive' : 'active'}`, kind: 'info' })
  }

  return (
    <div className="py-list st-list">
      <div className="py-tools">
        <span className="muted py-toolcount">{all.filter((s) => s.status !== 'inactive').length} active · {all.length} total</span>
        <input className="input" style={{ width: 200, height: 30 }} placeholder="Search services or codes…" value={q} onChange={(e) => setQ(e.target.value)} data-testid="sv-search" />
        <button className="btn btn-sm btn-primary" data-testid="sv-add" onClick={() => setEdit('new')}>{Icon.plus({ size: 12 })} Add Service Type</button>
      </div>
      <div className="an-wrap" style={{ paddingTop: 10 }}>
        <div className="dir-tables">
          <table className="dir-table" data-testid="svcs-table">
            <thead>
              <tr>
                <th>Service Type</th>
                <th style={{ width: 86 }}>Code</th>
                <th style={{ width: 70, textAlign: 'right' }}>Unit</th>
                <th style={{ width: 76, textAlign: 'right' }}>Rate</th>
                <th style={{ width: 84 }}>Rounding</th>
                <th style={{ width: 128 }}>Credentials</th>
                <th style={{ width: 118 }}>Used by</th>
                <th style={{ width: 90 }}>Status</th>
                <th style={{ width: 96 }} />
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={9} className="py-empty">No service types match.</td></tr>}
              {rows.map((s) => (
                <tr key={s.id} data-testid={`sv-row-${s.id}`} onClick={() => setEdit(s)} title="Edit this service type">
                  <td><span className="py-nm"><b>{s.label}</b>{s.note && <em>{s.note}</em>}</span></td>
                  <td><span className="tag">{s.code}</span></td>
                  <td style={{ textAlign: 'right' }}>{s.unitMins}m</td>
                  <td style={{ textAlign: 'right' }}>${Number(s.rate).toFixed(2)}</td>
                  <td>{s.rounding || 'AMA'}</td>
                  <td className="st-creds">{(s.credentials || []).length ? (s.credentials || []).map((c) => <span className="tag" key={c}>{c}</span>) : <span className="muted">—</span>}</td>
                  <td className="st-use">
                    {usedBy[s.id] ? <span data-testid={`sv-use-${s.id}`}>{usedBy[s.id]} appt{usedBy[s.id] === 1 ? '' : 's'}</span> : <span className="muted">—</span>}
                    {payerUse[s.id] ? <span className="muted"> · {payerUse[s.id]} payer{payerUse[s.id] === 1 ? '' : 's'}</span> : null}
                  </td>
                  <td><span className={`tag${s.status === 'active' ? '' : ' off'}`} data-testid={`sv-status-${s.id}`}>{s.status === 'active' ? 'Active' : 'Inactive'}</span></td>
                  <td className="st-acts">
                    <button className="iconbtn" title={s.status === 'active' ? 'Deactivate' : 'Activate'} data-testid={`sv-toggle-${s.id}`} onClick={(e) => { e.stopPropagation(); flip(s) }}>{s.status === 'active' ? Icon.ban({ size: 13 }) : Icon.check({ size: 13 })}</button>
                    <button className="iconbtn" title="Delete" data-testid={`sv-del-${s.id}`} onClick={(e) => { e.stopPropagation(); remove(s) }}>{Icon.trash({ size: 13 })}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {edit && (
        <div className="overlay pm-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) setEdit(null) }}>
          <SvModal svc={edit === 'new' ? null : edit} onClose={save} />
        </div>
      )}
    </div>
  )
}

/** Add/edit one service type — mirrors the payer form field style. */
function SvModal({ svc, onClose }) {
  const [f, setF] = useState(() => ({ label: svc?.label || '', code: svc?.code || '97151', unitMins: svc?.unitMins ?? 30, rate: svc?.rate ?? 32, rounding: svc?.rounding || 'AMA', credentials: svc?.credentials || [], status: svc?.status || 'active', note: svc?.note || '' }))
  const [err, setErr] = useState({})
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  const set = (k, v) => { setF((x) => ({ ...x, [k]: v })); setErr((e) => ({ ...e, [k]: undefined })) }
  const save = () => {
    const label = f.label.trim()
    if (!label) { setErr({ label: 'Name the service type' }); return }
    onClose({ ...f, label, rate: Number(f.rate) || 0, unitMins: Number(f.unitMins) || 30 })
  }
  return (
    <div className="modal pm-modal py-modal" data-testid="sv-modal" role="dialog" aria-modal="true" aria-label={svc ? `Service type — ${svc.label}` : 'Add Service Type'} tabIndex={-1}>
      <div className="modal-head pm-head">
        <h3>{svc ? `Service Type — ${svc.label}` : 'Add Service Type'}</h3>
        <button className="iconbtn modal-x" aria-label="Close" data-testid="sv-close" onClick={() => onClose(null)}>{Icon.x({ size: 14 })}</button>
      </div>
      <div className="modal-body">
        <div className="py-sec">{Icon.clipboard({ size: 12 })} Service definition</div>
        <label className="bil-fld pm-fld">
          <span>Service Name{err.label && <i className="pm-err"> — {err.label}</i>}</span>
          <input className={`input${err.label ? ' err' : ''}`} value={f.label} data-testid="sv-label" onChange={(e) => set('label', e.target.value)} placeholder="e.g. Adaptive / Daily Living Skills" />
        </label>
        <div className="py-two">
          <label className="bil-fld pm-fld">
            <span>Billing Code</span>
            <Dropdown testid="sv-code" value={f.code} onChange={(v) => set('code', v)} options={BILL_CODES.map((c) => ({ value: c.id, label: c.id, sub: c.label.split(' · ')[1] }))} />
          </label>
          <label className="bil-fld pm-fld">
            <span>Unit Size (minutes)</span>
            <select className="input" value={f.unitMins} data-testid="sv-unit" onChange={(e) => set('unitMins', e.target.value)}>
              {[5, 10, 15, 30, 45, 60].map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </label>
        </div>
        <div className="py-two">
          <label className="bil-fld pm-fld">
            <span>Default Charge ($ / unit)</span>
            <input className="input" inputMode="decimal" value={f.rate} data-testid="sv-rate" onChange={(e) => set('rate', e.target.value)} />
          </label>
          <label className="bil-fld pm-fld">
            <span>Rounding</span>
            <Dropdown testid="sv-round" value={f.rounding} onChange={(v) => set('rounding', v)} options={ROUNDINGS.map((r) => ({ value: r, label: r }))} />
          </label>
        </div>
        <div className="py-two">
          <label className="bil-fld pm-fld">
            <span>Required Credentials</span>
            <div className="st-credchips" data-testid="sv-creds">
              {CREDENTIALS.map((c) => (
                <button key={c} type="button" className={`tag pick${f.credentials.includes(c) ? ' on' : ''}`} data-testid={`sv-cred-${c}`} onClick={() => set('credentials', f.credentials.includes(c) ? f.credentials.filter((x) => x !== c) : [...f.credentials, c])}>{c}</button>
              ))}
            </div>
          </label>
          <label className="bil-fld pm-fld">
            <span>Status</span>
            <select className="input" value={f.status} data-testid="sv-status" onChange={(e) => set('status', e.target.value)}>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </label>
        </div>
        <label className="bil-fld pm-fld">
          <span>Note (optional)</span>
          <input className="input" value={f.note} data-testid="sv-note" onChange={(e) => set('note', e.target.value)} placeholder="Shown on the master list only" />
        </label>
      </div>
      <div className="modal-foot pm-foot">
        <span className="muted">Used by the appointment wizard, Quick Add and every payer rate card.</span>
        <span className="an-spacer" />
        <button className="btn btn-sm" onClick={() => onClose(null)}>Cancel</button>
        <button className="btn btn-sm btn-primary" data-testid="sv-save" onClick={save}>{svc ? 'Save' : 'Add service'}</button>
      </div>
    </div>
  )
}
