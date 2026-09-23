p = 'src/components/MastersView.jsx'
s = open(p).read()

# tab logic + header + third tab button
s = s.replace("  const tab = ui.mastersTab === 'svcs' ? 'svcs' : 'payers'",
"  const tab = ['svcs', 'cfdefs'].includes(ui.mastersTab) ? ui.mastersTab : 'payers'")
s = s.replace('title="Masters" sub={`${(state.payers || []).length} payers · ${svcs.length} service types`}',
'title="Masters" sub={`${(state.payers || []).length} payers · ${svcs.length} service types · ${(state.customFields || []).length} custom fields`}')
s = s.replace("""          </button>
        </div>
      </SectionBar>
      {tab === 'payers' ? <PayersList /> : <ServiceTypesView />}""",
"""          </button>
          <button role="tab" aria-selected={tab === 'cfdefs'} className={`ms-segb${tab === 'cfdefs' ? ' on' : ''}`} data-testid="masters-tab-cfdefs" onClick={() => actions.setUI({ mastersTab: 'cfdefs', payerSel: null })}>
            {Icon.badge({ size: 12 })} Custom Fields<span className="ms-n">{(state.customFields || []).length}</span>
          </button>
        </div>
      </SectionBar>
      {tab === 'payers' ? <PayersList /> : tab === 'svcs' ? <ServiceTypesView /> : <CfDefsView />}""")

# append the Custom Fields master view + template editor modal
s += """

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
  const set = (k, v) => { setF((x) => ({ ...x, [k]: v })); setErrs((e) => ({ ...e, [k]: undefined })) }
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
            <Dropdown testid="cf-type" value={f.type} onChange={(v) => set('type', v)} options={CF_TYPES.map((t) => ({ value: t.id, label: t.label }))} />
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
        {f.type === 'signature' && <div className="cf-hint" data-testid="cf-sig-hint"><Icon.shield({ size: 12 })} Bookers get the full signature pad (type or draw) wherever this field is picked.</div>}
        {f.type === 'date' && <div className="cf-hint"><Icon.cal({ size: 12 })} Renders a date/time picker wherever this field is picked.</div>}
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
"""
open(p, 'w').write(s)

# imports needed by the new views
imp = "import { svcList, CREDENTIALS, ROUNDINGS } from '../lib/master'"
if imp in s:
    s = s.replace(imp, "import { svcList, CREDENTIALS, ROUNDINGS, CF_TYPES, cfTypeLabel } from '../lib/master'")
else:
    import re
    m = re.search(r"import \{([^}]*)\} from '\.\./lib/master'", s)
    assert m
    names = [x.strip() for x in m.group(1).split(',') if x.strip()]
    for add in ('CF_TYPES', 'cfTypeLabel'):
        if add not in names:
            names.append(add)
    s = s[:m.start()] + "import { " + ', '.join(names) + " } from '../lib/master'" + s[m.end():]
open(p, 'w').write(s)
t = open(p).read()
print('MastersView ok', 'CfDefsView' in t, 'CfDefModal' in t, "CF_TYPES" in t.split('\n')[6] or 'CF_TYPES' in t[:1200])

# NavRail: third sub entry
p2 = 'src/components/NavRail.jsx'
s2 = open(p2).read()
s2 = s2.replace("subs: [{ id: 'payers', label: 'Payers' }, { id: 'svcs', label: 'Service Types' }]",
                "subs: [{ id: 'payers', label: 'Payers' }, { id: 'svcs', label: 'Service Types' }, { id: 'cfdefs', label: 'Custom Fields' }]")
open(p2, 'w').write(s2)
print('nav subs ok', "cfdefs" in open(p2).read())
