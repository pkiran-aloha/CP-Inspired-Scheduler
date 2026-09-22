import React, { useEffect, useMemo, useState } from 'react'
import { useStore } from '../state/store'
import { Icon } from '../ui/Icons'
import { useToast } from '../ui/Toast'
import { Dropdown } from './fields'
import { PayerForm, RemoveArm } from './PayersView'
import { ensurePayer, svcList, MODIFIERS, POS_CODES } from '../lib/master'
import { BILL_CODES } from '../lib/model'

/**
 * Payer deep record — opened by clicking a payer row. Three tabs mirroring how
 * payer admins work: Profile (identity, routing, address, custom fields),
 * Services (contracted service types with per-payer overrides) and Billing
 * Rules (concurrent billing, claim form settings, appointment rules,
 * qualification & POS modifiers, MUE limits). Everything edits the live payer
 * record — the scheduler and billing reads pick the rules up from there.
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
              <RuleNavButton key={r.id} r={r} on={state.ui.rulesTab === r.id || (!state.ui.rulesTab && r.id === 'concurrent')} onClick={() => actions.setUI({ rulesTab: r.id })} />
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
            onClose={(v) => { if (v) { patch(v); toast({ message: `${v.name} updated`, kind: 'ok' }) } setEdit(false) }}
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
  const [cf, setCf] = useState({ label: '', value: '' })
  const phone = (p.contacts || []).find((c) => c.kind === 'Main')?.number || ''
  const fax = (p.contacts || []).find((c) => c.kind === 'Fax')?.number || ''
  const portal = (p.contacts || []).find((c) => c.kind === 'Claims portal')?.number || ''
  const addr = [p.street, [p.city, p.state].filter(Boolean).join(' '), p.zip].filter(Boolean).join(', ')
  const addCf = () => {
    const label = cf.label.trim()
    if (!label) return
    patch({ cf: [...(p.cf || []), { label, value: cf.value.trim() }] }, `Custom field “${label}” added`)
    setCf({ label: '', value: '' })
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
          {kv('Phone', phone && <a href={`tel:${phone.replace(/[^\d+]/g, '')}`}>{phone}</a>)}
          {kv('Fax', fax)}
          {kv('Email', p.email && <a href={`mailto:${p.email}`}>{p.email}</a>)}
          {kv('Claims Portal', portal)}
          {kv('EVV Payer ID', p.evvId)}
          {kv('Third Party ID', p.thirdPartyId)}
        </div>
      </div>
      <div className="an-card pd-card" data-testid="pd-cf">
        <div className="an-head">{Icon.badge({ size: 13 })} Custom Fields{(p.cf || []).length > 0 && <span className="pd-cfn">{p.cf.length}</span>}</div>
        <p className="pd-note">Payer-specific fields captured on every record — shown on the client’s payer strip and exported with claims.</p>
        {(p.cf || []).length > 0 ? (
          <div className="pd-cfrows">
            {p.cf.map((f, i) => (
              <div className="pd-cfrow" key={`${f.label}-${i}`} data-testid={`pd-cf-${i}`}>
                <b>{f.label}</b><span>{f.value || '—'}</span>
                <button className="iconbtn" title="Remove field" onClick={() => patch({ cf: p.cf.filter((_, j) => j !== i) })}>{Icon.x({ size: 12 })}</button>
              </div>
            ))}
          </div>
        ) : <div className="muted pd-cfempty">No custom fields yet.</div>}
        <div className="pd-cfadd">
          <input className="input" placeholder="Field label" value={cf.label} data-testid="pd-cf-label" onChange={(e) => setCf((c) => ({ ...c, label: e.target.value }))} />
          <input className="input" placeholder="Value" value={cf.value} data-testid="pd-cf-value" onChange={(e) => setCf((c) => ({ ...c, value: e.target.value }))} onKeyDown={(e) => e.key === 'Enter' && addCf()} />
          <button className="btn btn-sm btn-primary" data-testid="pd-cf-add" onClick={addCf}>{Icon.plus({ size: 12 })} Add</button>
        </div>
      </div>
    </div>
  )
}

/* ── Services ──────────────────────────────────────────────────────────── */
function ServicesTab({ p, patch }) {
  const state = useStore()
  const toast = useToast()
  const [picker, setPicker] = useState(false)
  const [ovrFor, setOvrFor] = useState(null)
  const all = svcList(state)
  const contracted = p.services.length ? all.filter((s) => p.services.includes(s.id)) : all.filter((s) => s.status !== 'inactive')
  const toggleSvc = (id, on) => {
    const set = new Set(p.services.length ? p.services : all.filter((s) => s.status !== 'inactive').map((s) => s.id))
    if (on) set.add(id); else set.delete(id)
    patch({ services: [...set] })
  }
  return (
    <div className="pd-body">
      {!p.services.length && <div className="pd-note pd-allnote" data-testid="pd-svc-all">{Icon.info({ size: 12 })} No explicit contract — billing treats every active service type as contracted. Use “+” to narrow the list.</div>}
      <div className="svc-cards" data-testid="pd-svc-cards">
        {contracted.length === 0 && <div className="muted pd-cfempty">No service types contracted with this payer yet.</div>}
        {contracted.map((s) => {
          const o = (p.svcOv || {})[s.id] || {}
          const rate = o.charge ?? s.rate ?? 0
          return (
            <div className="svc-card" key={s.id} data-testid={`pd-svc-${s.id}`}>
              <div className="svc-cardhead"><b>{s.label}</b><span className="tag">{s.code}</span></div>
              <div className="svc-dates">
                <span className={`svc-date${o.effective ? ' on' : ''}`}>{o.effective ? `Effective ${o.effective}` : 'No effective date'}</span>
                <span className={`svc-date${o.expiration ? ' exp' : ''}`}>{o.expiration ? `Expires ${o.expiration}` : 'No expiration'}</span>
              </div>
              <div className="svc-rows">
                <div><span>Billing Code</span><b>{o.billingCode || s.code}</b></div>
                <div><span>Dx Code 1</span><b>{o.dx1 || '—'}</b></div>
                <div><span>Dx Code 2</span><b>{o.dx2 || '—'}</b></div>
                <div><span>Unit Size</span><b>{o.unitSize || `${s.unitMins} Minutes`}</b></div>
                <div><span>Charge Rate</span><b className={o.charge ? 'ovr' : ''}>{money(rate)}</b></div>
                <div><span>Rounding</span><b>{o.rounding || s.rounding || 'AMA'}</b></div>
                <div><span>Contract Rate</span><b>{o.contract ? money(o.contract) : '—'}</b></div>
                <div><span>Modifier</span><b>{o.modifier || '—'}</b></div>
              </div>
              <div className="svc-creds">
                <span>Required Credentials (AND)</span>
                <div>{(s.credentials || []).length ? s.credentials.map((c) => <span className="tag" key={c}>{c}</span>) : <i className="muted">None</i>}</div>
              </div>
              <button className="btn btn-sm svc-ovrbtn" data-testid={`pd-ovr-${s.id}`} onClick={() => setOvrFor(s)}>
                {Icon.edit({ size: 12 })} Modifier, Charge &amp; Contract Rate{o.charge ? '' : ' — none set'}
              </button>
            </div>
          )
        })}
      </div>
      <button className="svc-fab" data-testid="pd-svc-fab" title="Contract more service types" onClick={() => setPicker(true)}>{Icon.plus({ size: 16 })}</button>

      {picker && (
        <div className="overlay pm-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) setPicker(false) }}>
          <div className="modal pm-modal py-modal" data-testid="pd-svc-picker" role="dialog" aria-modal="true" aria-label="Contracted services">
            <div className="modal-head pm-head">
              <h3>Services — {p.name}</h3>
              <button className="iconbtn modal-x" aria-label="Close" data-testid="pd-svc-picker-close" onClick={() => setPicker(false)}>{Icon.x({ size: 14 })}</button>
            </div>
            <div className="modal-body">
              <p className="pd-note">Tick the service types this payer reimburses. Uncheck to drop them from this payer’s contracts — charges, rates and claims for this payer will ignore the rest.</p>
              <div className="svc-pickrows">
                {all.map((s) => {
                  const on = (p.services.length ? p.services : all.filter((x) => x.status !== 'inactive').map((x) => x.id)).includes(s.id)
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

      {ovrFor && <OvrModal payer={p} svc={ovrFor} onClose={() => setOvrFor(null)} onSave={(vals) => {
        patch({ svcOv: { ...(p.svcOv || {}), [ovrFor.id]: vals } }, vals ? `Override saved for ${ovrFor.label}` : `Override cleared for ${ovrFor.label}`)
        setOvrFor(null)
      }} />}
    </div>
  )
}

/** Per-payer override for one service: modifier + charge/contract + units & dates. */
function OvrModal({ payer, svc, onClose, onSave }) {
  const cur = (payer.svcOv || {})[svc.id] || {}
  const [f, setF] = useState({
    modifier: cur.modifier || '', charge: cur.charge ?? '', contract: cur.contract ?? '',
    dx1: cur.dx1 || '', dx2: cur.dx2 || '', unitSize: cur.unitSize || `${svc.unitMins} Minutes`,
    rounding: cur.rounding || svc.rounding || 'AMA', effective: cur.effective || '', expiration: cur.expiration || '', thirdParty: cur.thirdParty || '',
  })
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }))
  const save = () => {
    const clean = { ...f }
    for (const k of ['charge', 'contract']) if (clean[k] !== '' && !Number.isFinite(Number(clean[k]))) { clean[k] = '' }
    const empty = !Object.values(clean).some((v) => String(v).trim() !== '')
    onSave(empty ? null : clean)
  }
  const fld = (k, label, extra) => (
    <label className="bil-fld pm-fld"><span>{label}</span>{extra || <input className="input" value={f[k]} data-testid={`ovr-${k}`} onChange={(e) => set(k, e.target.value)} />}</label>
  )
  return (
    <div className="modal pm-modal py-modal" data-testid="ovr-modal" role="dialog" aria-modal="true" aria-label={`Override — ${svc.label}`} tabIndex={-1}>
      <div className="modal-head pm-head">
        <h3>Modifier, Charge &amp; Contract Rate</h3>
        <button className="iconbtn modal-x" aria-label="Close" data-testid="ovr-close" onClick={onClose}>{Icon.x({ size: 14 })}</button>
      </div>
      <div className="modal-body">
        <div className="ovr-svc">{svc.label}<span className="tag">{svc.code}</span><span className="muted">for {payer.name}</span></div>
        <div className="py-two">
          {fld('modifier', 'Modifier', <Dropdown testid="ovr-modifier" value={f.modifier} onChange={(v) => set('modifier', v)} options={[{ value: '', label: '— none —' }, ...MODIFIERS.map((m) => ({ value: m, label: m }))]} />)}
          {fld('thirdParty', 'Third Party / Payer ID', <input className="input" value={f.thirdParty} placeholder={payer.payerId || 'optional'} data-testid="ovr-thirdParty" onChange={(e) => set('thirdParty', e.target.value)} />)}
        </div>
        <div className="py-two">
          {fld('charge', 'Charge Rate ($/unit)', <input className="input" inputMode="decimal" value={f.charge} placeholder={String(svc.rate)} data-testid="ovr-charge" onChange={(e) => set('charge', e.target.value)} />)}
          {fld('contract', 'Contract Rate ($/unit)', <input className="input" inputMode="decimal" value={f.contract} data-testid="ovr-contract" onChange={(e) => set('contract', e.target.value)} />)}
        </div>
        <div className="py-two">
          {fld('dx1', 'Dx Code 1', <input className="input" value={f.dx1} placeholder="F84.0" data-testid="ovr-dx1" onChange={(e) => set('dx1', e.target.value)} />)}
          {fld('dx2', 'Dx Code 2', <input className="input" value={f.dx2} placeholder="optional" data-testid="ovr-dx2" onChange={(e) => set('dx2', e.target.value)} />)}
        </div>
        <div className="py-two">
          {fld('unitSize', 'Unit Size', <Dropdown testid="ovr-unitSize" value={f.unitSize} onChange={(v) => set('unitSize', v)} options={UNITS_OPTS.map((u) => ({ value: u, label: u }))} />)}
          {fld('rounding', 'Rounding', <Dropdown testid="ovr-rounding" value={f.rounding} onChange={(v) => set('rounding', v)} options={ROUND_OPTS.map((u) => ({ value: u, label: u }))} />)}
        </div>
        <div className="py-two">
          {fld('effective', 'Effective Date', <input className="input" type="date" value={f.effective} data-testid="ovr-effective" onChange={(e) => set('effective', e.target.value)} />)}
          {fld('expiration', 'Expiration Date', <input className="input" type="date" value={f.expiration} data-testid="ovr-expiration" onChange={(e) => set('expiration', e.target.value)} />)}
        </div>
      </div>
      <div className="modal-foot pm-foot">
        {(payer.svcOv || {})[svc.id] && <button className="btn btn-sm" data-testid="ovr-clear" onClick={() => onSave(null)}>{Icon.trash({ size: 12 })} Clear override</button>}
        <span className="an-spacer" />
        <button className="btn btn-sm" onClick={onClose}>Cancel</button>
        <button className="btn btn-sm btn-primary" data-testid="ovr-save" onClick={save}>Save</button>
      </div>
    </div>
  )
}
const ROUND_OPTS = ['AMA', 'Nearest', 'Round Up', 'Round Down', 'Truncate']

/* ── Billing rules ─────────────────────────────────────────────────────── */
function RuleEditor({ p, section, patch }) {
  // each section edits a local draft; Save commits to the payer record, Cancel discards
  const [nonce, setNonce] = useState(0)
  const draftKey = `${p.id}:${section}:${nonce}`
  return <RuleBody key={draftKey} p={p} section={section} patch={patch} saved={() => setNonce((n) => n + 1)} />
}

function RuleBody({ p, section, patch, saved }) {
  const state = useStore()
  const toast = useToast()
  const rules = p.rules
  const commit = (key, val, msg) => {
    patch({ rules: { ...rules, [key]: val } }, msg || 'Billing rules saved')
    saved()
  }

  /* Concurrent Billing */
  const [conc, setConc] = useState(() => ({ ...rules.concurrent, rules: (rules.concurrent.rules || []).map((r) => ({ ...r })) }))
  /* Claims Settings */
  const [clm, setClm] = useState(() => ({ ...rules.claims, flags: { ...rules.claims.flags } }))
  /* Appointment Settings */
  const [appt, setAppt] = useState(() => ({ ...rules.appt }))
  /* Qualification modifiers */
  const [qm, setQm] = useState(() => rules.qualMods.map((r) => ({ ...r })))
  /* POS modifiers */
  const [pos, setPos] = useState(() => ({ rows: rules.posMods.map((r) => ({ ...r })), hideTeleOther: rules.hideTeleOther, hideTeleHome: rules.hideTeleHome }))
  /* MUE */
  const [mue, setMue] = useState(() => ({ daily: rules.mue.daily || '', per: { ...(rules.mue.per || {}) } }))
  const svcOpts = useMemo(() => svcList(state).map((s) => ({ value: s.id, label: s.label, sub: s.code })), [state.svcs, state.clients])

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

  /* MUEs */
  const codes = useMemo(() => {
    const set = new Set(svcList(state).map((s) => s.code))
    for (const c of BILL_CODES) set.add(c.id)
    return [...set]
  }, [state.svcs])
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
