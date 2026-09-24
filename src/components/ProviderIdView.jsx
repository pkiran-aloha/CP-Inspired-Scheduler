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

/**
 * chunk-40 (U2) — Provider Identifier Management (spec §5.9, screenshot 9).
 * One row per NPI: offices may carry several, staff carry one each. Each row carries a
 * taxonomy code, the claim-role matrix (rendering / billing / service facility) and the
 * payer-specific identifiers (Ticare / Medicaid / BHPN / referring) shown per tab.
 * These rows feed `resolveProviders` — the Rendering / Billing Provider columns of the
 * Billing Manager and the 24FI/24JA/24GZ boxes of the CMS-1500 resolve from here.
 */
export default function ProviderIdView() {
  const state = useStore()
  const { actions, settings, staff } = state
  const toast = useToast()
  const [tab, setTab] = useState('general')
  const [npiF, setNpiF] = useState('all') // all | yes | no
  const [showF, setShowF] = useState('active') // active | all
  const [npiDraft, setNpiDraft] = useState({}) // id -> in-progress NPI text

  const providers = settings.providers || []
  const col = ID_COL[tab]

  const rows = useMemo(() => providers.filter((p) => {
    if (showF === 'active' && !p.active) return false
    if (npiF === 'yes' && !p.npi) return false
    if (npiF === 'no' && p.npi) return false
    // the payer-id tabs (Ticare/Medicaid/BHPN/Referring) show every row with that id
    // column open for editing — filtering to rows that already have the id would make
    // it impossible to SET one
    return true
  }), [providers, showF, npiF])

  // group consecutive rows by provider (office rows share one name block, like the reference)
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
    if (v && !validNpi(v)) { toast({ message: `“${v}” is not a valid NPI — 10 digits with a correct check digit`, kind: 'warn' }); return }
    actions.updateProvider(p.id, { npi: v })
    toast({ message: v ? `${p.name} — NPI ${v} saved` : `${p.name} — NPI cleared (row will hold claim gates)`, kind: 'ok' })
  }
  const setTax = (p, code) => { actions.updateProvider(p.id, { taxonomy: code }); toast({ message: `${p.name} — taxonomy ${code || 'cleared'}`, kind: 'ok' }) }
  const toggleRole = (p, role) => {
    const roles = { ...(p.roles || {}), [role]: !p.roles?.[role] }
    actions.updateProvider(p.id, { roles })
    toast({ message: `${p.name} — ${role} role ${roles[role] ? 'enabled' : 'removed'} on claims`, kind: 'ok' })
  }
  const setPayerId = (p, val) => {
    actions.updateProvider(p.id, { payerIds: { ...(p.payerIds || {}), [col.key]: val } })
  }
  const toggleActive = (p) => { actions.updateProvider(p.id, { active: !p.active }); toast({ message: `${p.name} ${p.active ? 'deactivated (history kept)' : 'activated'}`, kind: 'ok' }) }
  const addOfficeRow = (g) => {
    actions.addProvider({ name: g.label, kind: 'office', refId: null, credential: 'Office' })
    toast({ message: `New NPI row added under ${g.label} — enter the NPI + taxonomy`, kind: 'ok' })
  }
  const clearFilters = () => { setNpiF('all'); setShowF('active'); toast({ message: 'Filters cleared', kind: 'info' }) }

  const billOpts = providers.filter((p) => p.active && p.npi)
  const billDef = settings.billing?.defaultBilling || ''
  const facDef = settings.billing?.defaultFacility || ''
  const setDef = (field, id) => { actions.setSettings({ billing: { ...(settings.billing || {}), [field]: id } }); toast({ message: field === 'defaultBilling' ? 'Default billing provider updated' : 'Default service facility updated', kind: 'ok' }) }

  const staffMissing = staff.filter((s) => !providers.some((p) => p.kind === 'staff' && p.refId === s.id))

  return (
    <div className="sectionpage">
      <SectionBar icon="dollar" title="Provider Identifier" sub="NPI · taxonomy · claim roles — who renders, who bills, who is the facility">
        <label className="fld-inline" style={{ fontSize: 12 }}>
          Default billing
          <select className="input" style={{ width: 150, padding: '3px 6px', fontSize: 12 }} value={billDef} onChange={(e) => setDef('defaultBilling', e.target.value)} data-testid="pi-def-bill">
            <option value="">— auto —</option>
            {billOpts.map((p) => <option key={p.id} value={p.id}>{p.name}{p.kind === 'office' ? ' (office)' : ''}</option>)}
          </select>
        </label>
        <label className="fld-inline" style={{ fontSize: 12 }}>
          Default facility
          <select className="input" style={{ width: 150, padding: '3px 6px', fontSize: 12 }} value={facDef} onChange={(e) => setDef('defaultFacility', e.target.value)} data-testid="pi-def-fac">
            <option value="">— auto —</option>
            {billOpts.map((p) => <option key={p.id} value={p.id}>{p.name}{p.kind === 'office' ? ' (office)' : ''}</option>)}
          </select>
        </label>
      </SectionBar>

      <div className="sec-body">
        <div className="batch-strip" data-testid="pi-tabs">
          {PAYER_ID_TABS.map((t) => (
            <button key={t.id} className={`tab ${tab === t.id ? 'on' : ''}`} data-testid={`pi-tab-${t.id}`} onClick={() => setTab(t.id)}>{t.label}</button>
          ))}
          <span style={{ width: 1, height: 20, background: 'var(--line)' }} />
          <span className="muted" style={{ fontSize: 12 }}>
            Office/Staff With NPI :{' '}
            <button className={`chipbtn ${npiF === 'yes' ? 'on' : ''}`} data-testid="pi-npi-yes" onClick={() => setNpiF('yes')}>Yes</button>{' '}
            <button className={`chipbtn ${npiF === 'no' ? 'on' : ''}`} data-testid="pi-npi-no" onClick={() => setNpiF('no')}>No</button>
            {npiF !== 'all' && <button className="chipbtn" data-testid="pi-npi-clear" onClick={() => setNpiF('all')} aria-label="Clear NPI filter">× all</button>}
            {' · Show : '}
            <button className={`chipbtn ${showF === 'active' ? 'on' : ''}`} data-testid="pi-show-active" onClick={() => setShowF('active')}>Active</button>{' '}
            <button className={`chipbtn ${showF === 'all' ? 'on' : ''}`} data-testid="pi-show-all" onClick={() => setShowF('all')}>All</button>
            {(npiF !== 'all' || showF !== 'active') && (
              <a className="link" style={{ marginLeft: 8, fontSize: 12 }} data-testid="pi-clear" onClick={clearFilters}>Clear All Filters</a>
            )}
          </span>
        </div>

        {staffMissing.length > 0 && showF !== 'no' && (
          <div className="warnstrip" data-testid="pi-missing" style={{ fontSize: 12.5 }}>
            {Icon.alert({ size: 13 })} {staffMissing.length} staff member{staffMissing.length > 1 ? 's have' : ' has'} no identifier row yet — {staffMissing.slice(0, 3).map((s) => s.name).join(', ')}{staffMissing.length > 3 ? ` +${staffMissing.length - 3} more` : ''}. Rows are seeded for existing staff; re-run the billing migration or add one here for staff added after v15.
          </div>
        )}

        {groups.length === 0 ? (
          <div className="empty" data-testid="pi-empty">
            <div className="empty-ic">{Icon.clipboard({ size: 26 })}</div>
            <b>No provider rows match</b>
            <p className="muted">Adjust the NPI / status filters above, or add an NPI row under an office.</p>
          </div>
        ) : (
          <div className="tbl-wrap" style={{ overflowX: 'auto' }} data-testid="pi-wrap">
          <table className="prov-tbl" data-testid="pi-table">
            <thead>
              <tr>
                <th style={{ width: '16%' }}>Office/Staff ⇅</th>
                <th style={{ width: '11%' }}>NPI</th>
                <th style={{ width: '12%' }}>Taxonomy Code</th>
                <th className="ctr">Rendering Provider</th>
                <th className="ctr">Billing Provider</th>
                <th className="ctr">Service Facility</th>
                {col && <th style={{ width: '14%' }}>{col.label}</th>}
                <th className="ctr" style={{ width: 90 }}>{Icon.more({ size: 12 })} <span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <React.Fragment key={g.key}>
                  {g.items.map((p, i) => (
                    <tr key={p.id} className={p.active ? '' : 'is-off'} data-testid={`pi-row-${p.id}`}>
                      {i === 0 && (
                        <td rowSpan={g.items.length} className="prov-name">
                          {g.kind === 'office'
                            ? <span className="prov-office" data-testid={`pi-office-${g.key}`}>{g.label}</span>
                            : <><PersonAvatar p={staff.find((x) => x.id === g.refId)} size={24} /><div><b>{g.label}</b><div className="muted" style={{ fontSize: 11 }}>{g.cred}{g.deg ? ` · ${g.deg}` : ''}</div></div></>}
                        </td>
                      )}
                      <td>
                        <input
                          className={`input prov-npi ${npiDraft[p.id] != null && npiDraft[p.id] !== '' && !validNpi(npiDraft[p.id]) ? 'is-bad' : ''}`}
                          value={npiDraft[p.id] ?? p.npi ?? ''}
                          placeholder="—"
                          maxLength={10}
                          data-testid={`pi-npi-${p.id}`}
                          onChange={(e) => setNpiDraft((d) => ({ ...d, [p.id]: e.target.value.replace(/[^0-9]/g, '') }))}
                          onBlur={() => saveNpi(p)}
                        />
                        {npiDraft[p.id] != null && npiDraft[p.id] !== '' && !validNpi(npiDraft[p.id]) && (
                          <div className="field-err" style={{ fontSize: 10.5 }}>invalid check digit</div>
                        )}
                      </td>
                      <td>
                        <select className="input prov-tax" value={TAXONOMIES.some((t) => t.code === p.taxonomy) ? p.taxonomy : p.taxonomy ? 'custom' : ''} data-testid={`pi-tax-${p.id}`} onChange={(e) => setTax(p, e.target.value === 'custom' ? p.taxonomy : e.target.value)}>
                          <option value="">—</option>
                          {TAXONOMIES.map((t) => <option key={t.code} value={t.code}>{t.code} · {t.label}</option>)}
                          {p.taxonomy && !TAXONOMIES.some((t) => t.code === p.taxonomy) && <option value="custom">{p.taxonomy} (custom)</option>}
                        </select>
                        {CRED_MODIFIERS[p.credential] && <div className="muted" style={{ fontSize: 10 }}>modifier {CRED_MODIFIERS[p.credential]}</div>}
                      </td>
                      {['rendering', 'billing', 'facility'].map((role) => (
                        <td key={role} className="ctr">
                          <button
                            type="button"
                            className={`rolebox ${p.roles?.[role] ? 'on' : ''}`}
                            aria-label={`${role} role for ${p.name}`}
                            data-testid={`pi-role-${p.id}-${role}`}
                            onClick={() => toggleRole(p, role)}
                          >{p.roles?.[role] ? Icon.check({ size: 13 }) : null}</button>
                        </td>
                      ))}
                      {col && (
                        <td>
                          <input className="input" value={(p.payerIds || {})[col.key] || ''} placeholder="—" data-testid={`pi-id-${p.id}-${col.key}`} onChange={(e) => setPayerId(p, e.target.value)} />
                        </td>
                      )}
                      <td className="ctr" style={{ whiteSpace: 'nowrap' }}>
                        <button className="iconbtn" title={p.active ? 'Deactivate (keep history)' : 'Activate'} data-testid={`pi-active-${p.id}`} onClick={() => toggleActive(p)}>{p.active ? Icon.eye({ size: 13 }) : Icon.x({ size: 13 })}</button>
                        {g.kind === 'office' && i === g.items.length - 1 && (
                          <button className="iconbtn" title="Add NPI row for this office" data-testid={`pi-add-${g.key}`} onClick={() => addOfficeRow(g)}>{Icon.plus({ size: 13 })}</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </React.Fragment>
              ))}
            </tbody>
          </table>
          </div>
        )}

        <p className="muted" style={{ fontSize: 11.5, marginTop: 10 }}>
          Rendering = who performed the line (from the appointment’s staff) · Billing = 24FI box · Facility = 24GZ box.
          Rows without a valid NPI hold the claim at the submission gate. Role defaults feed claims when a line’s staff
          carries no explicit flag.
        </p>
      </div>
    </div>
  )
}
