p = 'src/components/PayerDetail.jsx'
s = open(p).read()

# imports: drop cfDefs, add resolver
s = s.replace("import { ensurePayer, svcList, localSvcs, MODIFIERS, POS_CODES, ROUNDINGS, CREDENTIALS, CF_TYPES, cfDefs } from '../lib/master'",
              "import { ensurePayer, svcList, localSvcs, MODIFIERS, POS_CODES, ROUNDINGS, CREDENTIALS, CF_TYPES, cfTypeLabel, payerFieldDefs } from '../lib/master'")

# ── ProfileTab: replace the inline designer with a template-picker card ─────
start = s.index('/* ── Profile ───')
end = s.index('/* ── Services — the payer\'s own contract sheet')
new_profile = """/* ── Profile ─────────────────────────────────────────────────────────── */
function ProfileTab({ p, patch }) {
  const state = useStore()
  const { actions } = state
  const [pick, setPick] = useState(false)
  const fields = payerFieldDefs(state, p)
  const templates = state.customFields || []
  const phone = (p.contacts || []).find((c) => c.kind === 'Main')?.number || ''
  const fax = (p.contacts || []).find((c) => c.kind === 'Fax')?.number || ''
  const portal = (p.contacts || []).find((c) => c.kind === 'Claims portal')?.number || ''
  const addr = [p.street, [p.city, p.state].filter(Boolean).join(' '), p.zip].filter(Boolean).join(', ')

  const setFields = (ids) => patch({ cf: ids }, 'custom fields updated from the master')
  const unlink = (d) => setFields((p.cf || []).filter((x) => x !== d.defId && !(typeof x === 'object' && x && x.id === d.id)))
  const upgrade = (d) => {
    actions.addCfDef({ label: d.label, type: d.type || 'text', options: d.options || [], onLabel: d.onLabel || 'Yes', offLabel: d.offLabel || 'No', required: Boolean(d.required), note: d.note || '' })
    const created = (state.customFields || []).length
    // the reducer is async — write the ref in after the def lands via effect ordering: replace inline with newest-id match
    setTimeout(() => {
      const fresh = (actions && state) || null
      const cur = JSON.parse(JSON.stringify(p.cf || []))
      setFields(cur.map((x) => (typeof x === 'object' && x.id === d.id ? `__pending__` : x)).filter((x) => x !== `__pending__`).concat([`cf-${d.label.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 24)}`]))
      void fresh; void created
    }, 0)
  }

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
          {kv('Phone', phone && <a href={`tel:${phone.replace(/[^\\d+]/g, '')}`}>{phone}</a>)}
          {kv('Fax', fax)}
          {kv('Email', p.email && <a href={`mailto:${p.email}`}>{p.email}</a>)}
          {kv('Claims Portal', portal)}
          {kv('EVV Payer ID', p.evvId)}
          {kv('Third Party ID', p.thirdPartyId)}
        </div>
      </div>

      <div className="an-card pd-card" data-testid="pd-cf">
        <div className="an-head">{Icon.badge({ size: 13 })} Custom Fields{fields.length > 0 && <span className="pd-cfn">{fields.length}</span>}<span className="an-spacer" />
          <button className="btn btn-sm" data-testid="pd-cf-gomaster" title="Define templates on the Masters → Custom Fields page" onClick={() => actions.setUI({ payerSel: null, mastersTab: 'cfdefs' })}>{Icon.clipboard({ size: 11 })} Manage templates</button>
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
                    onClick={() => { const id = uid(); actions.addCfDef({ id, label: d.label, type: d.type || 'text', options: d.options || [], onLabel: d.onLabel || 'Yes', offLabel: d.offLabel || 'No', required: Boolean(d.required), note: d.note || '' }); setFields([id]) }}>
                    {Icon.badge({ size: 11 })} Make template
                  </button>
                )}
                <button className="iconbtn" title="Unlink from this payer" data-testid={`pcf-unlink-${d.defId || d.id}`} onClick={() => unlink(d)}>{Icon.x({ size: 12 })}</button>
              </div>
            ))}
          </div>
        )}
        <div className="pd-cfadd">
          <button className="btn btn-sm btn-primary" data-testid="pd-cf-pick" onClick={() => setPick(true)}>{Icon.plus({ size: 12 })} Pick fields from the master</button>
          <span className="muted" style={{ fontSize: 11.5 }}>{templates.filter((t) => t.status !== 'inactive' && !(p.cf || []).includes(t.id)).length} template(s) not yet used by this payer</span>
        </div>
      </div>

      {pick && (
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
      )}
    </div>
  )
}

"""
s = s[:start] + new_profile + s[end:]

# ── Services: explicit toolbar Add button + validation split + error scroll ──
s = s.replace("""    <div className="pd-body">
      {!p.services.length && <div className="pd-note pd-allnote" data-testid="pd-svc-all"><Icon.info({ size: 12 })} No explicit contract — billing treats every active service type as contracted. Use “+” to narrow the list or add payer-only services.</div>}""",
"""    <div className="pd-body">
      <div className="pd-svctools">
        {!p.services.length ? <div className="pd-note pd-allnote" data-testid="pd-svc-all"><Icon.info({ size: 12 })} No explicit contract — billing treats every active service type as contracted. “Contract services” narrows the list; “Add Service” creates one only for {p.name}.</div> : null}
        <span className="an-spacer" />
        <button className="btn btn-sm" data-testid="pd-svc-contract" onClick={() => setPicker(true)}>{Icon.clipboard({ size: 12 })} Contract services</button>
        <button className="btn btn-sm btn-primary" data-testid="pd-svc-add" onClick={() => setForm({ mode: 'new' })}>{Icon.plus({ size: 12 })} Add Service</button>
      </div>""")

# PayerSvcForm: toast + scroll on validation; validation only blocks on CREATE
s = s.replace("""/** The Add/Edit Service modal — payer-scoped contract line, per the practice's service form. */
function PayerSvcForm({ payer, form, onClose, onSave }) {
  const linked = form.mode === 'linked'""",
"""/** The Add/Edit Service modal — payer-scoped contract line, per the practice's service form. */
function PayerSvcForm({ payer, form, onClose, onSave }) {
  const toast = useToast()
  const linked = form.mode === 'linked'""")
s = s.replace("""  const save = () => {
    const E = {}
    if (!linked && !String(f.label).trim()) E.label = 'Name the service'
    if (f.charge === '' || f.charge == null || !Number.isFinite(Number(f.charge))) E.charge = 'Charge rate is required (use 0 for none)'
    if (!f.unitSize) E.unitSize = 'Unit size is required'
    if (!f.code) E.code = 'Pick a billing code'
    if (!String(f.dx1).trim()) E.dx1 = 'Primary Dx code is required'
    if (Object.keys(E).length) { setErrs(E); return }
    onSave({ ...f, label: String(f.label).trim(), charge: Number(f.charge) })
  }""",
"""  const creating = form.mode === 'new'
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
      setTimeout(() => document.querySelector('.ovr-form .pm-err')?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 30)
      return
    }
    const num = (v) => (String(v).trim() === '' ? '' : Number(v))
    onSave({ ...f, label: String(f.label).trim(), charge: creating ? Number(f.charge || 0) : num(f.charge), contract: num(f.contract) })
  }""")
open(p, 'w').write(s)
t = open(p).read()
print('PayerDetail ok', 'pd-svc-add' in t, 'pd-cf-pick' in t, 'creating ?' in t)
