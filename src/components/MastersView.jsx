import React, { useEffect, useMemo, useState } from 'react'
import { useStore } from '../state/store'
import { SectionBar } from './NavRail'
import { Icon } from '../ui/Icons'
import { useToast } from '../ui/Toast'
import { Dropdown } from './fields'
import { PayersList } from './PayersView'
import PayerDetail from './PayerDetail'
import { svcList, CREDENTIALS, ROUNDINGS, CF_TYPES, cfTypeLabel } from '../lib/master'
import { InlineText, InlineSelect } from './fields'
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
  const tab = ['svcs', 'cfdefs'].includes(ui.mastersTab) ? ui.mastersTab : 'payers'
  const svcs = svcList(state)
  return (
    <div className="sectionpage">
      <SectionBar icon="clipboard" title="Masters" sub={`${(state.payers || []).length} payers · ${svcs.length} service types · ${(state.customFields || []).length} custom fields`}>
        <div className="ms-seg" role="tablist" aria-label="Master lists">
          <button role="tab" aria-selected={tab === 'payers'} className={`ms-segb${tab === 'payers' ? ' on' : ''}`} data-testid="masters-tab-payers" onClick={() => actions.setUI({ mastersTab: 'payers', payerSel: null })}>
            {Icon.shield({ size: 12 })} Payers<span className="ms-n">{(state.payers || []).length}</span>
          </button>
          <button role="tab" aria-selected={tab === 'svcs'} className={`ms-segb${tab === 'svcs' ? ' on' : ''}`} data-testid="masters-tab-svcs" onClick={() => actions.setUI({ mastersTab: 'svcs', payerSel: null })}>
            {Icon.clipboard({ size: 12 })} Service Types<span className="ms-n">{svcs.length}</span>
          </button>
          <button role="tab" aria-selected={tab === 'cfdefs'} className={`ms-segb${tab === 'cfdefs' ? ' on' : ''}`} data-testid="masters-tab-cfdefs" onClick={() => actions.setUI({ mastersTab: 'cfdefs', payerSel: null })}>
            {Icon.badge({ size: 12 })} Custom Fields<span className="ms-n">{(state.customFields || []).length}</span>
          </button>
        </div>
      </SectionBar>
      {tab === 'payers' ? <PayersList /> : tab === 'svcs' ? <ServiceTypesView /> : <CfDefsView />}
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
    for (const p of state.payers || []) {
      for (const id of p.services || []) m[id] = (m[id] || 0) + 1
      for (const id of Object.keys(p.svcOv || {})) m[id] = (m[id] || 0) + 1
      for (const sv of p.svcs || []) if (sv.ref) m[sv.ref] = (m[sv.ref] || 0) + 1
    }
    return m
  }, [state.payers])

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase()
    return s ? all.filter((x) => `${x.label} ${x.code}`.toLowerCase().includes(s)) : all
  }, [all, q])

  const save = (v) => {
    if (!v || typeof v !== 'object' || 'nativeEvent' in v || v.target) { setEdit(null); return }
    if (edit === 'new') actions.addSvc(v)
    else actions.updateSvc({ id: edit.id, ...v })
    setEdit(null)
    toast({ message: `“${v.label}” ${edit === 'new' ? 'added to' : 'updated in'} the service master`, kind: 'ok' })
  }
  const patch = (sv, changes, what) => { actions.updateSvc({ id: sv.id, ...changes }); if (what) toast({ message: `${sv.label} — ${what}`, kind: 'ok' }) }
  const remove = (sv) => {
    const used = usedBy[sv.id] || 0
    if (used) { toast({ message: `${sv.label} is used by ${used} appointment${used === 1 ? '' : 's'} — it can’t be deleted`, kind: 'error' }); return }
    // also drop it from any payer contracts/overrides/local copies that still reference it
    for (const p of state.payers || []) {
      const had = (p.services || []).includes(sv.id) || (p.svcOv && p.svcOv[sv.id]) || (p.svcs || []).some((x) => x.ref === sv.id)
      if (had) actions.updatePayer({ id: p.id, services: (p.services || []).filter((x) => x !== sv.id), svcOv: Object.fromEntries(Object.entries(p.svcOv || {}).filter(([k]) => k !== sv.id)), svcs: (p.svcs || []).filter((x) => x.ref !== sv.id) })
    }
    actions.removeSvc(sv.id)
    toast({ message: `${sv.label} removed from the service master`, kind: 'info' })
  }
  const flip = (sv) => {
    patch(sv, { status: sv.status === 'active' ? 'inactive' : 'active' }, 'status updated')
  }

  return (
    <div className="py-list st-list">
      <div className="py-tools">
        <span className="muted py-toolcount">{all.filter((x) => x.status !== 'active').length ? `${all.filter((x) => x.status !== 'inactive').length} active · ` : ''}{all.length} service types · click a cell to edit inline</span>
        <input className="input" style={{ width: 200, height: 30 }} placeholder="Search services or codes…" value={q} onChange={(e) => setQ(e.target.value)} data-testid="sv-search" />
        <button className="btn btn-sm btn-primary" data-testid="sv-add" onClick={() => setEdit('new')}>{Icon.plus({ size: 12 })} Add Service Type</button>
      </div>
      <div className="an-wrap" style={{ paddingTop: 10 }}>
        <div className="py-tbl sv-tbl" data-testid="svcs-table">
          <div className="py-thead sv-head">
            <span>Service Type</span>
            <span>Billing Code</span>
            <span className="num">Unit</span>
            <span className="num">Rate</span>
            <span>Rounding</span>
            <span>Credentials</span>
            <span>Used by</span>
            <span>Status</span>
            <span />
          </div>
          {rows.length === 0 && <div className="py-empty py-tempty">No service types match.</div>}
          {rows.map((sv) => (
            <div className="py-trow" key={sv.id} data-testid={`sv-row-${sv.id}`} onClick={() => setEdit(sv)} title="Open the full service form">
              <div className="py-idcell sv-idcell">
                <span className="sv-glyph">{Icon.clipboard({ size: 13 })}</span>
                <span className="py-idtxt">
                  <b>{sv.label}</b>
                  <InlineText testid={`sv-note-${sv.id}`} value={sv.note || ''} placeholder="add note" onCommit={(v) => patch(sv, { note: String(v).trim() })} />
                </span>
              </div>
              <div className="py-cell">
                <InlineSelect testid={`sv-code-${sv.id}`} value={sv.code} options={BILL_CODES.map((c) => ({ value: c.id, label: c.id, sub: c.label.split(' · ')[1] }))} onCommit={(v) => patch(sv, { code: v }, 'billing code updated')} render={(v) => <span className="tag">{v}</span>} />
              </div>
              <div className="py-cell num">
                <InlineSelect testid={`sv-unit-${sv.id}`} value={String(sv.unitMins)} options={[5, 10, 15, 30, 45, 60].map((m) => ({ value: String(m), label: `${m} min` }))} onCommit={(v) => patch(sv, { unitMins: Number(v) }, 'unit size updated')} />
              </div>
              <div className="py-cell num"><InlineText numeric testid={`sv-rate-${sv.id}`} value={sv.rate} onCommit={(v) => patch(sv, { rate: Number(v) || 0 }, 'charge rate updated')} /></div>
              <div className="py-cell">
                <InlineSelect testid={`sv-round-${sv.id}`} value={sv.rounding || 'AMA'} options={ROUNDINGS.map((r) => ({ value: r, label: r }))} onCommit={(v) => patch(sv, { rounding: v }, 'rounding updated')} />
              </div>
              <div className="py-cell st-creds">
                <button className="ie-cell" data-testid={`sv-crededit-${sv.id}`} title="Edit required credentials" onClick={(e) => { e.stopPropagation(); setEdit(sv) }}>
                  {(sv.credentials || []).length ? sv.credentials.map((c) => <span className="tag" key={c}>{c}</span>) : <i className="ie-empty">none</i>}
                  {Icon.edit({ size: 10 })}
                </button>
              </div>
              <div className="py-cell st-use">
                {usedBy[sv.id] ? <span data-testid={`sv-use-${sv.id}`}>{usedBy[sv.id]} appt{usedBy[sv.id] === 1 ? '' : 's'}</span> : <span className="muted">—</span>}
                {payerUse[sv.id] ? <span className="muted"> · {payerUse[sv.id]} payer{payerUse[sv.id] === 1 ? '' : 's'}</span> : null}
              </div>
              <div className="py-cell">
                <button className={`py-statustog${sv.status !== 'inactive' ? ' on' : ''}`} data-testid={`sv-status-${sv.id}`} title="Toggle active / inactive" onClick={(e) => { e.stopPropagation(); flip(sv) }}>
                  <i />{sv.status === 'inactive' ? 'Inactive' : 'Active'}
                </button>
              </div>
              <span className="py-tgo">
                <button className="iconbtn" title="Delete" data-testid={`sv-del-${sv.id}`} onClick={(e) => { e.stopPropagation(); remove(sv) }}>{Icon.trash({ size: 13 })}</button>
              </span>
            </div>
          ))}
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


/* ── Custom Fields master — typed templates every payer picks from ─────── */
function CfDefsView() {
  const state = useStore()
  const { actions } = state
  const toast = useToast()
  const [q, setQ] = useState('')
  const [edit, setEdit] = useState(null) // 'new' | def
  const defs = state.customFields || []
  const usedBy = (id) => (state.payers || []).filter((x) => (x.cf || []).includes(id)).length
  const rows = useMemo(() => {
    const s = q.trim().toLowerCase()
    return s ? defs.filter((d) => `${d.label} ${(d.options || []).join(' ')} ${d.note || ''}`.toLowerCase().includes(s)) : defs
  }, [defs, q])

  const save = (v) => {
    if (!v || typeof v !== 'object' || 'nativeEvent' in v || v.target) { setEdit(null); return }
    if (edit === 'new') actions.addCfDef(v)
    else actions.updateCfDef({ id: edit.id, ...v })
    setEdit(null)
    toast({ message: `Template “${v.label}” ${edit === 'new' ? 'created' : 'updated'} — payers pick it from the master`, kind: 'ok' })
  }
  const patch = (d, changes, what) => { actions.updateCfDef({ id: d.id, ...changes }); if (what) toast({ message: `${d.label} — ${what}`, kind: 'ok' }) }
  const remove = (d) => {
    const n = usedBy(d.id)
    if (n) { toast({ message: `“${d.label}” is picked by ${n} payer${n === 1 ? '' : 's'} — unlink it on their profile first`, kind: 'error' }); return }
    actions.removeCfDef(d.id)
    toast({ message: `Template “${d.label}” removed`, kind: 'info' })
  }

  return (
    <div className="py-list cf-list">
      <div className="py-tools">
        <span className="muted py-toolcount">{defs.filter((d) => d.status !== 'inactive').length} active of {defs.length} templates · define a field once, reuse it on every payer</span>
        <input className="input" style={{ width: 200, height: 30 }} placeholder="Search templates…" value={q} onChange={(e) => setQ(e.target.value)} data-testid="cf-search" />
        <button className="btn btn-sm btn-primary" data-testid="cf-add" onClick={() => setEdit('new')}>{Icon.plus({ size: 12 })} New Template</button>
      </div>
      <div className="an-wrap" style={{ paddingTop: 10 }}>
        <div className="py-tbl cf-tbl" data-testid="cfdefs-table">
          <div className="py-thead">
            <span>Field Template</span>
            <span>Type</span>
            <span>Options</span>
            <span className="num">Required</span>
            <span className="num">Used by</span>
            <span>Status</span>
            <span />
          </div>
          {rows.length === 0 && <div className="py-empty py-tempty">{defs.length ? 'No templates match.' : 'No templates yet — create the first one.'}</div>}
          {rows.map((d) => {
            const n = usedBy(d.id)
            return (
              <div className="py-trow" key={d.id} data-testid={`cf-row-${d.id}`} onClick={() => setEdit(d)} title="Edit this template">
                <div className="py-idcell">
                  <span className="cf-glyph">{Icon.badge({ size: 13 })}</span>
                  <span className="py-idtxt">
                    <b>{d.label}</b>
                    <i className="cf-note">{d.note || ''}</i>
                  </span>
                </div>
                <div className="py-cell"><span className="pcf-type">{cfTypeLabel(d.type)}</span></div>
                <div className="py-cell cf-opts">
                  {d.type === 'toggle' ? <span className="tag soft">{d.onLabel || 'Yes'}</span> : null}
                  {d.type === 'toggle' ? <span className="tag soft">{d.offLabel || 'No'}</span> : null}
                  {(d.type === 'select' || d.type === 'multi') && (d.options || []).slice(0, 3).map((o) => <span className="tag soft" key={o}>{o}</span>)}
                  {(d.options || []).length > 3 ? <i className="muted cf-optmore">+{d.options.length - 3}</i> : null}
                  {(d.type === 'text' || d.type === 'date' || d.type === 'signature') && <i className="muted">—</i>}
                </div>
                <div className="py-cell num">
                  <button className={`cf-reqchip${d.required ? ' on' : ''}`} data-testid={`cf-req-${d.id}`} title="Toggle required" onClick={(e) => { e.stopPropagation(); patch(d, { required: !d.required }, d.required ? 'no longer required' : 'required on every booking') }}>{d.required ? 'Required' : 'Optional'}</button>
                </div>
                <div className="py-cell num"><span className={`py-cnt${n ? '' : ' z'}`} data-testid={`cf-usedby-${d.id}`}>{n}</span></div>
                <div className="py-cell">
                  <button className={`py-statustog${d.status !== 'inactive' ? ' on' : ''}`} data-testid={`cf-status-${d.id}`} title="Inactive templates stay hidden in payer pickers" onClick={(e) => { e.stopPropagation(); patch(d, { status: d.status === 'inactive' ? 'active' : 'inactive' }, 'status updated') }}>
                    <i />{d.status === 'inactive' ? 'Inactive' : 'Active'}
                  </button>
                </div>
                <span className="py-tgo">
                  <button className="iconbtn" title="Delete template" data-testid={`cf-del-${d.id}`} onClick={(e) => { e.stopPropagation(); remove(d) }}>{Icon.trash({ size: 13 })}</button>
                </span>
              </div>
            )
          })}
        </div>
      </div>
      {edit && (
        <div className="overlay pm-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) setEdit(null) }}>
          <CfDefModal def={edit === 'new' ? null : edit} onClose={save} />
        </div>
      )}
    </div>
  )
}

function CfDefModal({ def, onClose }) {
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
