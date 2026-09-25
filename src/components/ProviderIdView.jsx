import React, { useMemo, useState } from 'react'
import { useStore } from '../state/store'
import { SectionBar } from './NavRail'
import { Icon } from '../ui/Icons'
import { useToast } from '../ui/Toast'
import { TAXONOMIES, PAYER_ID_TABS, validNpi } from '../lib/claims'
import { CRED_MODIFIERS } from '../lib/model'
import { PersonAvatar } from '../ui/avatars'

const ID_COL = {
  ticare: { key: 'ticare', label: 'Ticare ID' },
  medicaid: { key: 'medicaid', label: 'Medicaid ID' },
  bhpn: { key: 'bhpn', label: 'BHPN ID' },
  referrers: { key: 'referrers', label: 'Referring Provider' },
}

export default function ProviderIdView() {
  const state = useStore()
  const { actions, settings, staff } = state
  const toast = useToast()
  const [tab, setTab] = useState('general')
  const [npiF, setNpiF] = useState('all')
  const [showF, setShowF] = useState('active')
  const [npiDraft, setNpiDraft] = useState({})

  const providers = settings.providers || []
  const col = ID_COL[tab]

  const rows = useMemo(() => providers.filter((p) => {
    if (showF === 'active' && !p.active) return false
    if (npiF === 'yes' && !p.npi) return false
    if (npiF === 'no' && p.npi) return false
    return true
  }), [providers, showF, npiF])

  const groups = useMemo(() => {
    const out = []
    for (const p of rows) {
      const key = p.kind === 'office' ? 'office' : `st-${p.refId}`
      const last = out[out.length - 1]
      if (last && last.key === key) last.items.push(p)
      else out.push({ key, label: p.name, kind: p.kind, cred: p.credential, deg: p.degree, refId: p.refId, items: [p] })
    }
    return out
  }, [rows])

  const saveNpi = (p) => {
    const v = String(npiDraft[p.id] ?? p.npi ?? '').trim()
    delete npiDraft[p.id]
    setNpiDraft({ ...npiDraft })
    if (v === (p.npi || '')) return
    if (v && !validNpi(v)) { toast({ message: `“${v}” is not a valid NPI — 10 digits with correct check digit`, kind: 'warn' }); return }
    actions.updateProvider(p.id, { npi: v })
    toast({ message: v ? `${p.name} — NPI ${v} saved` : `${p.name} — NPI cleared`, kind: 'ok' })
  }
  const setTax = (p, code) => { actions.updateProvider(p.id, { taxonomy: code }); toast({ message: `${p.name} — taxonomy ${code || 'cleared'}`, kind: 'ok' }) }
  const toggleRole = (p, role) => {
    const roles = { ...(p.roles || {}), [role]: !p.roles?.[role] }
    actions.updateProvider(p.id, { roles })
    toast({ message: `${p.name} — ${role} role ${roles[role] ? 'enabled' : 'removed'}`, kind: 'ok' })
  }
  const setPayerId = (p, val) => { actions.updateProvider(p.id, { payerIds: { ...(p.payerIds || {}), [col.key]: val } }) }
  const toggleActive = (p) => { actions.updateProvider(p.id, { active: !p.active }); toast({ message: `${p.name} ${p.active ? 'deactivated' : 'activated'}`, kind: 'ok' }) }
  const addOfficeRow = (g) => { actions.addProvider({ name: g.label, kind: 'office', refId: null, credential: 'Office' }); toast({ message: `New NPI row under ${g.label}`, kind: 'ok' }) }
  const clearFilters = () => { setNpiF('all'); setShowF('active'); toast({ message: 'Filters cleared', kind: 'info' }) }

  const billOpts = providers.filter((p) => p.active && p.npi)
  const billDef = settings.billing?.defaultBilling || ''
  const facDef = settings.billing?.defaultFacility || ''
  const setDef = (field, id) => { actions.setSettings({ billing: { ...(settings.billing || {}), [field]: id } }); toast({ message: field === 'defaultBilling' ? 'Default billing provider updated' : 'Default facility updated', kind: 'ok' }) }
  const staffMissing = staff.filter((s) => !providers.some((p) => p.kind === 'staff' && p.refId === s.id))

  return (
    <div className="sectionpage">
      <SectionBar icon="dollar" title="Provider Identifier" sub={`NPI · taxonomy · claim roles — ${providers.filter((p) => p.active).length} active · ${providers.length} total · who renders, who bills, who is facility`}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <label className="fld-inline" style={{ fontSize: 11, display: 'flex', gap: 6, alignItems: 'center' }}>
            <span className="muted">Default billing</span>
            <select className="input" style={{ width: 150, height: 28, borderRadius: 8 }} value={billDef} onChange={(e) => setDef('defaultBilling', e.target.value)} data-testid="pi-def-bill">
              <option value="">— auto —</option>
              {billOpts.map((p) => <option key={p.id} value={p.id}>{p.name}{p.kind === 'office' ? ' (office)' : ''}</option>)}
            </select>
          </label>
          <label className="fld-inline" style={{ fontSize: 11, display: 'flex', gap: 6, alignItems: 'center' }}>
            <span className="muted">Default facility</span>
            <select className="input" style={{ width: 150, height: 28, borderRadius: 8 }} value={facDef} onChange={(e) => setDef('defaultFacility', e.target.value)} data-testid="pi-def-fac">
              <option value="">— auto —</option>
              {billOpts.map((p) => <option key={p.id} value={p.id}>{p.name}{p.kind === 'office' ? ' (office)' : ''}</option>)}
            </select>
          </label>
        </div>
      </SectionBar>

      <div className="batch-strip" data-testid="pi-tabs" style={{ padding: '10px 16px', gap: 8, flexWrap: 'wrap' }}>
        <div className="viewseg">
          {PAYER_ID_TABS.map((t) => (
            <button key={t.id} className={tab === t.id ? 'on' : ''} data-testid={`pi-tab-${t.id}`} onClick={() => setTab(t.id)}>{t.label}</button>
          ))}
        </div>
        <div style={{ width: 1, height: 20, background: 'var(--line)' }} />
        <span className="muted" style={{ fontSize: 11, display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          With NPI:
          <button className={`chipbtn ${npiF === 'yes' ? 'on' : ''}`} data-testid="pi-npi-yes" onClick={() => setNpiF('yes')}>Yes</button>
          <button className={`chipbtn ${npiF === 'no' ? 'on' : ''}`} data-testid="pi-npi-no" onClick={() => setNpiF('no')}>No</button>
          {npiF !== 'all' && <button className="chipbtn" data-testid="pi-npi-clear" onClick={() => setNpiF('all')}>× all</button>}
          <span style={{ margin: '0 4px' }}>· Show:</span>
          <button className={`chipbtn ${showF === 'active' ? 'on' : ''}`} data-testid="pi-show-active" onClick={() => setShowF('active')}>Active</button>
          <button className={`chipbtn ${showF === 'all' ? 'on' : ''}`} data-testid="pi-show-all" onClick={() => setShowF('all')}>All</button>
          {(npiF !== 'all' || showF !== 'active') && <button className="btn btn-xs" data-testid="pi-clear" onClick={clearFilters} style={{ marginLeft: 8 }}>{Icon.x({ size: 10 })} Clear</button>}
        </span>
        <span className="muted" style={{ marginLeft: 'auto', fontSize: 11 }}>{rows.length} rows · {billOpts.length} with NPI</span>
      </div>

      {staffMissing.length > 0 && showF !== 'no' && (
        <div className="panel" style={{ margin: '12px 16px', padding: '10px 14px', borderRadius: 10, background: '#fef3c7', border: '1px solid #fde68a', display: 'flex', gap: 8, alignItems: 'center', fontSize: 12 }} data-testid="pi-missing">
          <span style={{ width: 24, height: 24, borderRadius: 6, background: '#f59e0b', color: '#fff', display: 'grid', placeItems: 'center' }}>{Icon.alert({ size: 12 })}</span>
          <span>{staffMissing.length} staff member{staffMissing.length > 1 ? 's have' : ' has'} no identifier row yet — {staffMissing.slice(0, 3).map((s) => s.name).join(', ')}{staffMissing.length > 3 ? ` +${staffMissing.length - 3} more` : ''}.</span>
        </div>
      )}

      {groups.length === 0 ? (
        <div className="panel" style={{ margin: 16, borderRadius: 12 }}>
          <div className="py-empty" data-testid="pi-empty" style={{ padding: 40, textAlign: 'center' }}>
            <div style={{ width: 56, height: 56, borderRadius: 14, background: 'var(--panel-2)', display: 'grid', placeItems: 'center', margin: '0 auto 12px' }}>{Icon.clipboard({ size: 24 })}</div>
            <b>No provider rows match</b><div className="muted" style={{ fontSize: 12, marginTop: 4 }}>Adjust the NPI / status filters above, or add an NPI row under an office.</div>
          </div>
        </div>
      ) : (
        <div style={{ padding: 16 }}>
          <div className="panel" style={{ borderRadius: 12, overflow: 'hidden', boxShadow: 'var(--shadow-1)' }} data-testid="pi-wrap">
            <div className="py-tbl" data-testid="pi-table" style={{ overflowX: 'auto' }}>
              <div className="py-thead" style={{ gridTemplateColumns: '1.2fr 0.9fr 1.1fr 0.6fr 0.6fr 0.6fr 1fr 0.5fr', background: 'var(--panel-2)', fontSize: 11, minWidth: 900 }}>
                <span>Office/Staff</span><span>NPI</span><span>Taxonomy Code</span><span className="ctr">Rendering</span><span className="ctr">Billing</span><span className="ctr">Facility</span>{col ? <span>{col.label}</span> : <span>Payer ID</span>}<span className="ctr">Actions</span>
              </div>
              {groups.map((g) => (
                <React.Fragment key={g.key}>
                  {g.items.map((p, i) => (
                    <div key={p.id} className={`py-trow ${p.active ? '' : 'is-off'}`} data-testid={`pi-row-${p.id}`} style={{ gridTemplateColumns: '1.2fr 0.9fr 1.1fr 0.6fr 0.6fr 0.6fr 1fr 0.5fr', minWidth: 900, opacity: p.active ? 1 : 0.6, fontSize: 12 }}>
                      {i === 0 && (
                        <div className="py-idcell" style={{ gridRow: `span ${g.items.length}`, display: 'flex', gap: 8, alignItems: 'center', padding: '8px 12px' }}>
                          {g.kind === 'office' ? (
                            <><span style={{ width: 28, height: 28, borderRadius: 8, background: '#6366f1', color: '#fff', display: 'grid', placeItems: 'center', fontSize: 12 }}>🏢</span><span className="prov-office" data-testid={`pi-office-${g.key}`}><b>{g.label}</b><div className="muted" style={{ fontSize: 10 }}>Office · {g.items.length} NPI rows</div></span></>
                          ) : (
                            <><PersonAvatar p={staff.find((x) => x.id === g.refId)} size={28} /><div><b>{g.label}</b><div className="muted" style={{ fontSize: 10 }}>{g.cred}{g.deg ? ` · ${g.deg}` : ''}</div></div></>
                          )}
                        </div>
                      )}
                      <div className="py-cell">
                        <input className={`input ${npiDraft[p.id] != null && npiDraft[p.id] !== '' && !validNpi(npiDraft[p.id]) ? 'is-bad' : ''}`} value={npiDraft[p.id] ?? p.npi ?? ''} placeholder="—" maxLength={10} data-testid={`pi-npi-${p.id}`} onChange={(e) => setNpiDraft((d) => ({ ...d, [p.id]: e.target.value.replace(/[^0-9]/g, '') }))} onBlur={() => saveNpi(p)} style={{ height: 30, borderRadius: 6, fontSize: 12 }} />
                        {npiDraft[p.id] != null && npiDraft[p.id] !== '' && !validNpi(npiDraft[p.id]) && <div className="field-err" style={{ fontSize: 10, color: '#ef4444' }}>invalid check digit</div>}
                      </div>
                      <div className="py-cell">
                        <select className="input" value={TAXONOMIES.some((t) => t.code === p.taxonomy) ? p.taxonomy : p.taxonomy ? 'custom' : ''} data-testid={`pi-tax-${p.id}`} onChange={(e) => setTax(p, e.target.value === 'custom' ? p.taxonomy : e.target.value)} style={{ height: 30, borderRadius: 6, fontSize: 11 }}>
                          <option value="">—</option>
                          {TAXONOMIES.map((t) => <option key={t.code} value={t.code}>{t.code} · {t.label}</option>)}
                          {p.taxonomy && !TAXONOMIES.some((t) => t.code === p.taxonomy) && <option value="custom">{p.taxonomy} (custom)</option>}
                        </select>
                        {CRED_MODIFIERS[p.credential] && <div className="muted" style={{ fontSize: 9 }}>modifier {CRED_MODIFIERS[p.credential]}</div>}
                      </div>
                      {['rendering', 'billing', 'facility'].map((role) => (
                        <div key={role} className="py-cell ctr" style={{ display: 'grid', placeItems: 'center' }}>
                          <button type="button" className={`rolebox ${p.roles?.[role] ? 'on' : ''}`} aria-label={`${role} role for ${p.name}`} data-testid={`pi-role-${p.id}-${role}`} onClick={() => toggleRole(p, role)} style={{ width: 28, height: 28, borderRadius: 8, border: `1px solid ${p.roles?.[role] ? 'var(--accent)' : 'var(--line)'}`, background: p.roles?.[role] ? 'var(--accent)' : 'var(--panel)', color: p.roles?.[role] ? '#fff' : 'var(--muted)', display: 'grid', placeItems: 'center' }}>{p.roles?.[role] ? Icon.check({ size: 13 }) : null}</button>
                        </div>
                      ))}
                      {col && (
                        <div className="py-cell"><input className="input" value={(p.payerIds || {})[col.key] || ''} placeholder="—" data-testid={`pi-id-${p.id}-${col.key}`} onChange={(e) => setPayerId(p, e.target.value)} style={{ height: 30, borderRadius: 6, fontSize: 11 }} /></div>
                      )}
                      <div className="py-cell ctr" style={{ display: 'flex', gap: 4, justifyContent: 'center' }}>
                        <button className="iconbtn" style={{ width: 28, height: 28, borderRadius: 6 }} title={p.active ? 'Deactivate' : 'Activate'} data-testid={`pi-active-${p.id}`} onClick={() => toggleActive(p)}>{p.active ? Icon.eye({ size: 13 }) : Icon.x({ size: 13 })}</button>
                        {g.kind === 'office' && i === g.items.length - 1 && <button className="iconbtn" style={{ width: 28, height: 28, borderRadius: 6 }} title="Add NPI row" data-testid={`pi-add-${g.key}`} onClick={() => addOfficeRow(g)}>{Icon.plus({ size: 13 })}</button>}
                      </div>
                    </div>
                  ))}
                </React.Fragment>
              ))}
            </div>
          </div>
          <div className="panel" style={{ marginTop: 12, padding: '10px 14px', borderRadius: 10, background: 'var(--panel-2)', border: '1px solid var(--line)', fontSize: 11, lineHeight: 1.5 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <span style={{ width: 20, height: 20, borderRadius: 6, background: '#6366f1', color: '#fff', display: 'grid', placeItems: 'center', flex: 'none' }}>{Icon.info({ size: 10 })}</span>
              <span className="muted">Rendering = who performed the line (from appointment staff) · Billing = 24FI box · Facility = 24GZ box. Rows without valid NPI hold claim at submission gate. Role defaults feed claims when line staff carries no explicit flag.</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
