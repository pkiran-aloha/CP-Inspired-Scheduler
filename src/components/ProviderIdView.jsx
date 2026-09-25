import React, { useMemo, useState } from 'react'
import { useStore } from '../state/store'
import { SectionBar } from './NavRail'
import { Icon } from '../ui/Icons'
import { useToast } from '../ui/Toast'
import { TAXONOMIES, PAYER_ID_TABS, validNpi } from '../lib/claims'
import { CRED_MODIFIERS } from '../lib/model'
import { PersonAvatar } from '../ui/avatars'

const ID_COL = {
  ticare: { key: 'ticare', label: 'Ticare ID', icon: '🏥' },
  medicaid: { key: 'medicaid', label: 'Medicaid ID', icon: '🩺' },
  bhpn: { key: 'bhpn', label: 'BHPN ID', icon: '🧠' },
  referrers: { key: 'referrers', label: 'Referring Provider', icon: '👨‍⚕️' },
}

const PAYER_TAB_ICON = { general: '🌐', ticare: '🏥', medicaid: '🩺', bhpn: '🧠', referrers: '👨‍⚕️' }

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
    toast({ message: v ? `${p.name} — NPI ${v} saved ✅` : `${p.name} — NPI cleared`, kind: 'ok' })
  }
  const setTax = (p, code) => { actions.updateProvider(p.id, { taxonomy: code }); toast({ message: `${p.name} — taxonomy ${code || 'cleared'} 🧬`, kind: 'ok' }) }
  const toggleRole = (p, role) => {
    const roles = { ...(p.roles || {}), [role]: !p.roles?.[role] }
    actions.updateProvider(p.id, { roles })
    toast({ message: `${p.name} — ${role} role ${roles[role] ? 'enabled ✅' : 'removed'}`, kind: 'ok' })
  }
  const setPayerId = (p, val) => { actions.updateProvider(p.id, { payerIds: { ...(p.payerIds || {}), [col.key]: val } }) }
  const toggleActive = (p) => { actions.updateProvider(p.id, { active: !p.active }); toast({ message: `${p.name} ${p.active ? 'deactivated 🚫' : 'activated ✅'}`, kind: 'ok' }) }
  const addOfficeRow = (g) => { actions.addProvider({ name: g.label, kind: 'office', refId: null, credential: 'Office' }); toast({ message: `New NPI row under ${g.label} ➕`, kind: 'ok' }) }
  const clearFilters = () => { setNpiF('all'); setShowF('active'); toast({ message: 'Filters cleared 🧹', kind: 'info' }) }

  const billOpts = providers.filter((p) => p.active && p.npi)
  const billDef = settings.billing?.defaultBilling || ''
  const facDef = settings.billing?.defaultFacility || ''
  const setDef = (field, id) => { actions.setSettings({ billing: { ...(settings.billing || {}), [field]: id } }); toast({ message: field === 'defaultBilling' ? 'Default billing provider updated 💳' : 'Default facility updated 🏢', kind: 'ok' }) }
  const staffMissing = staff.filter((s) => !providers.some((p) => p.kind === 'staff' && p.refId === s.id))

  const kpiCards = [
    { label: 'Active Providers', val: providers.filter((p) => p.active).length, sub: `${providers.length} total rows`, icon: '👨‍⚕️', color: '#6366f1' },
    { label: 'With NPI', val: billOpts.length, sub: `${providers.length - billOpts.length} missing`, icon: '🆔', color: '#10b981' },
    { label: 'Taxonomy Set', val: providers.filter((p) => p.taxonomy).length, sub: `${TAXONOMIES.length} taxonomy options`, icon: '🧬', color: '#0ea5e9' },
    { label: 'Staff Missing', val: staffMissing.length, sub: staffMissing.length ? 'needs row' : 'all mapped ✅', icon: staffMissing.length ? '⚠️' : '✅', color: staffMissing.length ? '#f59e0b' : '#10b981' },
  ]

  return (
    <div className="sectionpage" data-testid="pi-wrap" style={{ background: 'var(--bg)' }}>
      <SectionBar icon="dollar" title="Provider Identifier" sub={`🆔 NPI · 🧬 taxonomy · 👨‍⚕️ claim roles — ${providers.filter((p) => p.active).length} active · ${providers.length} total · who renders, who bills, who is facility · Visual NPI registry`}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <label className="fld-inline" style={{ fontSize: 11, display: 'flex', gap: 6, alignItems: 'center', background: 'var(--panel)', padding: '4px 10px', borderRadius: 10, border: '1px solid var(--line)' }}>
            <span className="muted">💳 Default billing</span>
            <select className="input" style={{ width: 150, height: 28, borderRadius: 8 }} value={billDef} onChange={(e) => setDef('defaultBilling', e.target.value)} data-testid="pi-def-bill">
              <option value="">— auto —</option>
              {billOpts.map((p) => <option key={p.id} value={p.id}>{p.kind === 'office' ? '🏢' : '👤'} {p.name}{p.kind === 'office' ? ' (office)' : ''} {p.npi ? `🆔 ${p.npi.slice(-4)}` : ''}</option>)}
            </select>
          </label>
          <label className="fld-inline" style={{ fontSize: 11, display: 'flex', gap: 6, alignItems: 'center', background: 'var(--panel)', padding: '4px 10px', borderRadius: 10, border: '1px solid var(--line)' }}>
            <span className="muted">🏢 Default facility</span>
            <select className="input" style={{ width: 150, height: 28, borderRadius: 8 }} value={facDef} onChange={(e) => setDef('defaultFacility', e.target.value)} data-testid="pi-def-fac">
              <option value="">— auto —</option>
              {billOpts.map((p) => <option key={p.id} value={p.id}>{p.kind === 'office' ? '🏢' : '👤'} {p.name}{p.kind === 'office' ? ' (office)' : ''} {p.npi ? `🆔 ${p.npi.slice(-4)}` : ''}</option>)}
            </select>
          </label>
        </div>
      </SectionBar>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 12, padding: 16 }}>
        {kpiCards.map((k) => (
          <div key={k.label} style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 14, padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12, boxShadow: 'var(--shadow-1)', position: 'relative', overflow: 'hidden' }}>
            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: k.color }} />
            <span style={{ width: 40, height: 40, borderRadius: 12, background: `${k.color}15`, color: k.color, display: 'grid', placeItems: 'center', fontSize: 18, boxShadow: `0 4px 12px ${k.color}30` }}>{k.icon}</span>
            <div><div style={{ fontSize: 20, fontWeight: 800 }}>{k.val}</div><div style={{ fontSize: 11, fontWeight: 700 }}>{k.label}</div><div className="muted" style={{ fontSize: 10 }}>{k.sub}</div></div>
          </div>
        ))}
      </div>

      <div className="batch-strip" data-testid="pi-tabs" style={{ padding: '12px 16px', gap: 10, flexWrap: 'wrap', background: 'linear-gradient(135deg,var(--panel),var(--panel-2))', borderBottom: '1px solid var(--line)' }}>
        <div className="viewseg" style={{ borderRadius: 12, padding: 3 }}>
          {PAYER_ID_TABS.map((t) => (
            <button key={t.id} className={tab === t.id ? 'on' : ''} data-testid={`pi-tab-${t.id}`} onClick={() => setTab(t.id)} style={{ borderRadius: 8, display: 'flex', alignItems: 'center', gap: 4 }}>{PAYER_TAB_ICON[t.id] || '🌐'} {t.label}</button>
          ))}
        </div>
        <div style={{ width: 1, height: 20, background: 'var(--line)' }} />
        <span className="muted" style={{ fontSize: 11, display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          🆔 With NPI:
          <button className={`chipbtn ${npiF === 'yes' ? 'on' : ''}`} data-testid="pi-npi-yes" onClick={() => setNpiF('yes')} style={{ borderRadius: 20 }}>✅ Yes</button>
          <button className={`chipbtn ${npiF === 'no' ? 'on' : ''}`} data-testid="pi-npi-no" onClick={() => setNpiF('no')} style={{ borderRadius: 20 }}>🚫 No</button>
          {npiF !== 'all' && <button className="chipbtn" data-testid="pi-npi-clear" onClick={() => setNpiF('all')} style={{ borderRadius: 20 }}>× all</button>}
          <span style={{ margin: '0 4px' }}>· Show:</span>
          <button className={`chipbtn ${showF === 'active' ? 'on' : ''}`} data-testid="pi-show-active" onClick={() => setShowF('active')} style={{ borderRadius: 20 }}>✅ Active</button>
          <button className={`chipbtn ${showF === 'all' ? 'on' : ''}`} data-testid="pi-show-all" onClick={() => setShowF('all')} style={{ borderRadius: 20 }}>🌐 All</button>
          {(npiF !== 'all' || showF !== 'active') && <button className="btn btn-xs" data-testid="pi-clear" onClick={clearFilters} style={{ marginLeft: 8, borderRadius: 20 }}>{Icon.x({ size: 10 })} Clear</button>}
        </span>
        <span className="muted" style={{ marginLeft: 'auto', fontSize: 11, background: 'var(--panel-2)', padding: '6px 12px', borderRadius: 20, display: 'flex', alignItems: 'center', gap: 6 }}>📊 {rows.length} rows · {billOpts.length} with NPI 🆔 · Visual registry</span>
      </div>

      {staffMissing.length > 0 && showF !== 'no' && (
        <div className="panel" style={{ margin: '12px 16px', padding: '12px 16px', borderRadius: 12, background: 'linear-gradient(135deg,#fef3c7,#fde68a)', border: '1px solid #fcd34d', display: 'flex', gap: 10, alignItems: 'center', fontSize: 12 }} data-testid="pi-missing">
          <span style={{ width: 32, height: 32, borderRadius: 10, background: '#f59e0b', color: '#fff', display: 'grid', placeItems: 'center', boxShadow: '0 4px 12px #f59e0b40' }}>{Icon.alert({ size: 14 })}</span>
          <span><b>⚠️ {staffMissing.length} staff member{staffMissing.length > 1 ? 's have' : ' has'} no identifier row yet</b> — {staffMissing.slice(0, 3).map((s) => s.name).join(', ')}{staffMissing.length > 3 ? ` +${staffMissing.length - 3} more` : ''}. Add NPI + taxonomy + roles to enable billing.</span>
        </div>
      )}

      {groups.length === 0 ? (
        <div className="panel" style={{ margin: 16, borderRadius: 16 }}>
          <div className="py-empty" data-testid="pi-empty" style={{ padding: 48, textAlign: 'center' }}>
            <div style={{ width: 72, height: 72, borderRadius: 16, background: 'linear-gradient(135deg,#6366f111,#8b5cf611)', display: 'grid', placeItems: 'center', margin: '0 auto 14px', fontSize: 32 }}>🆔</div>
            <b>No provider rows match 🔍</b><div className="muted" style={{ fontSize: 12, marginTop: 6 }}>Adjust the NPI / status filters above, or add an NPI row under an office. Each provider needs valid NPI + taxonomy + claim roles to bill.</div>
          </div>
        </div>
      ) : (
        <div style={{ padding: 16 }}>
          <div className="panel" style={{ borderRadius: 16, overflow: 'hidden', boxShadow: 'var(--shadow-1)', border: '1px solid var(--line)' }} data-testid="pi-table-wrap">
            <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 10, background: 'linear-gradient(135deg,#6366f111,#8b5cf611)' }}>
              <span style={{ width: 36, height: 36, borderRadius: 12, background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: '#fff', display: 'grid', placeItems: 'center', boxShadow: '0 4px 12px #6366f140' }}>🆔</span>
              <div><b style={{ fontSize: 14, display: 'flex', alignItems: 'center', gap: 6 }}>👨‍⚕️ Provider Registry <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 20, background: '#6366f1', color: '#fff' }}>{rows.length} rows</span></b><div className="muted" style={{ fontSize: 11 }}>{col ? `${col.icon} ${col.label} tab` : '🌐 General NPI + taxonomy + roles'} · Valid NPI required for claim submission gate</div></div>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                <span style={{ width: 28, height: 28, borderRadius: 8, background: '#10b981', color: '#fff', display: 'grid', placeItems: 'center', fontSize: 12 }} title="Rendering">🩺</span>
                <span style={{ width: 28, height: 28, borderRadius: 8, background: '#6366f1', color: '#fff', display: 'grid', placeItems: 'center', fontSize: 12 }} title="Billing">💳</span>
                <span style={{ width: 28, height: 28, borderRadius: 8, background: '#0ea5e9', color: '#fff', display: 'grid', placeItems: 'center', fontSize: 12 }} title="Facility">🏢</span>
              </div>
            </div>
            <div className="py-tbl" data-testid="pi-table" style={{ overflowX: 'auto' }}>
              <div className="py-thead" style={{ gridTemplateColumns: '1.2fr 0.9fr 1.1fr 0.6fr 0.6fr 0.6fr 1fr 0.5fr', background: 'var(--panel-2)', fontSize: 11, minWidth: 900, borderBottom: '1px solid var(--line)' }}>
                <span>🏢 Office/👤 Staff</span><span>🆔 NPI</span><span>🧬 Taxonomy Code</span><span className="ctr">🩺 Rendering</span><span className="ctr">💳 Billing</span><span className="ctr">🏢 Facility</span>{col ? <span>{col.icon} {col.label}</span> : <span>🆔 Payer ID</span>}<span className="ctr">⚡ Actions</span>
              </div>
              {groups.map((g) => (
                <React.Fragment key={g.key}>
                  {g.items.map((p, i) => (
                    <div key={p.id} className={`py-trow ${p.active ? '' : 'is-off'}`} data-testid={`pi-row-${p.id}`} style={{ gridTemplateColumns: '1.2fr 0.9fr 1.1fr 0.6fr 0.6fr 0.6fr 1fr 0.5fr', minWidth: 900, opacity: p.active ? 1 : 0.6, fontSize: 12, borderLeft: `3px solid ${p.active ? (p.npi ? '#10b981' : '#f59e0b') : '#ef4444'}`, transition: 'all .12s' }}>
                      {i === 0 && (
                        <div className="py-idcell" style={{ gridRow: `span ${g.items.length}`, display: 'flex', gap: 8, alignItems: 'center', padding: '8px 12px' }}>
                          {g.kind === 'office' ? (
                            <><span style={{ width: 32, height: 32, borderRadius: 10, background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: '#fff', display: 'grid', placeItems: 'center', fontSize: 14 }}>🏢</span><span className="prov-office" data-testid={`pi-office-${g.key}`}><b>{g.label}</b><div className="muted" style={{ fontSize: 10, display: 'flex', alignItems: 'center', gap: 4 }}>🏢 Office · {g.items.length} NPI rows · {p.active ? '✅ Active' : '🚫 Inactive'}</div></span></>
                          ) : (
                            <><PersonAvatar p={staff.find((x) => x.id === g.refId)} size={32} /><div><b style={{ display: 'flex', alignItems: 'center', gap: 4 }}>👤 {g.label} {p.active ? '' : '🚫'}</b><div className="muted" style={{ fontSize: 10, display: 'flex', alignItems: 'center', gap: 4 }}>{g.cred}{g.deg ? ` · ${g.deg}` : ''} {p.npi ? `· 🆔 ${p.npi.slice(-4)}` : '· ⚠️ no NPI'}</div></div></>
                          )}
                        </div>
                      )}
                      <div className="py-cell">
                        <input className={`input ${npiDraft[p.id] != null && npiDraft[p.id] !== '' && !validNpi(npiDraft[p.id]) ? 'is-bad' : ''}`} value={npiDraft[p.id] ?? p.npi ?? ''} placeholder="— 🆔" maxLength={10} data-testid={`pi-npi-${p.id}`} onChange={(e) => setNpiDraft((d) => ({ ...d, [p.id]: e.target.value.replace(/[^0-9]/g, '') }))} onBlur={() => saveNpi(p)} style={{ height: 32, borderRadius: 8, fontSize: 12, borderLeft: `3px solid ${p.npi ? '#10b981' : '#f59e0b'}` }} />
                        {npiDraft[p.id] != null && npiDraft[p.id] !== '' && !validNpi(npiDraft[p.id]) && <div className="field-err" style={{ fontSize: 10, color: '#ef4444', display: 'flex', alignItems: 'center', gap: 3 }}>⚠️ invalid check digit</div>}
                      </div>
                      <div className="py-cell">
                        <select className="input" value={TAXONOMIES.some((t) => t.code === p.taxonomy) ? p.taxonomy : p.taxonomy ? 'custom' : ''} data-testid={`pi-tax-${p.id}`} onChange={(e) => setTax(p, e.target.value === 'custom' ? p.taxonomy : e.target.value)} style={{ height: 32, borderRadius: 8, fontSize: 11 }}>
                          <option value="">— 🧬 taxonomy —</option>
                          {TAXONOMIES.map((t) => <option key={t.code} value={t.code}>🧬 {t.code} · {t.label}</option>)}
                          {p.taxonomy && !TAXONOMIES.some((t) => t.code === p.taxonomy) && <option value="custom">{p.taxonomy} (custom)</option>}
                        </select>
                        {CRED_MODIFIERS[p.credential] && <div className="muted" style={{ fontSize: 9, display: 'flex', alignItems: 'center', gap: 3 }}>🔖 modifier {CRED_MODIFIERS[p.credential]}</div>}
                      </div>
                      {['rendering', 'billing', 'facility'].map((role) => (
                        <div key={role} className="py-cell ctr" style={{ display: 'grid', placeItems: 'center' }}>
                          <button type="button" className={`rolebox ${p.roles?.[role] ? 'on' : ''}`} aria-label={`${role} role for ${p.name}`} data-testid={`pi-role-${p.id}-${role}`} onClick={() => toggleRole(p, role)} style={{ width: 32, height: 32, borderRadius: 10, border: `1px solid ${p.roles?.[role] ? 'var(--accent)' : 'var(--line)'}`, background: p.roles?.[role] ? 'linear-gradient(135deg,var(--accent),#6366f1)' : 'var(--panel)', color: p.roles?.[role] ? '#fff' : 'var(--muted)', display: 'grid', placeItems: 'center', boxShadow: p.roles?.[role] ? '0 2px 8px var(--accent)40' : 'none' }}>{p.roles?.[role] ? Icon.check({ size: 14 }) : <span style={{ fontSize: 10 }}>{role === 'rendering' ? '🩺' : role === 'billing' ? '💳' : '🏢'}</span>}</button>
                        </div>
                      ))}
                      {col && (
                        <div className="py-cell"><input className="input" value={(p.payerIds || {})[col.key] || ''} placeholder={`— ${col.icon}`} data-testid={`pi-id-${p.id}-${col.key}`} onChange={(e) => setPayerId(p, e.target.value)} style={{ height: 32, borderRadius: 8, fontSize: 11 }} /></div>
                      )}
                      <div className="py-cell ctr" style={{ display: 'flex', gap: 4, justifyContent: 'center' }}>
                        <button className="iconbtn" style={{ width: 32, height: 32, borderRadius: 8, background: p.active ? '#ecfdf5' : '#fef2f2', color: p.active ? '#10b981' : '#ef4444' }} title={p.active ? 'Deactivate' : 'Activate'} data-testid={`pi-active-${p.id}`} onClick={() => toggleActive(p)}>{p.active ? Icon.eye({ size: 14 }) : Icon.x({ size: 14 })}</button>
                        {g.kind === 'office' && i === g.items.length - 1 && <button className="iconbtn" style={{ width: 32, height: 32, borderRadius: 8, background: '#6366f122', color: '#6366f1' }} title="Add NPI row" data-testid={`pi-add-${g.key}`} onClick={() => addOfficeRow(g)}>{Icon.plus({ size: 14 })}</button>}
                      </div>
                    </div>
                  ))}
                </React.Fragment>
              ))}
            </div>
          </div>
          <div className="panel" style={{ marginTop: 14, padding: '12px 16px', borderRadius: 12, background: 'linear-gradient(135deg,var(--panel-2),var(--panel))', border: '1px solid var(--line)', fontSize: 11, lineHeight: 1.5, display: 'flex', gap: 10 }}>
            <span style={{ width: 28, height: 28, borderRadius: 8, background: '#6366f1', color: '#fff', display: 'grid', placeItems: 'center', flex: 'none' }}>{Icon.info({ size: 12 })}</span>
            <span className="muted"><b>🩺 Rendering</b> = who performed the line (from appointment staff) · <b>💳 Billing</b> = 24FI box · <b>🏢 Facility</b> = 24GZ box. Rows without valid NPI 🆔 hold claim at submission gate 🚧. Role defaults feed claims when line staff carries no explicit flag. Visual left border: 🟢 valid NPI, 🟡 missing NPI, 🔴 inactive.</span>
          </div>
        </div>
      )}
    </div>
  )
}
