import React, { useMemo, useState } from 'react'
import { Icon } from '../../ui/Icons'
import { Section, Row, TextField, NumberField, Select, Toggle, Seg, Banner, Empty, DataTable, IconButton } from './kit'
import {
  settingsOffices, officeUsage, OFFICE_TYPES, US_STATES, TIMEZONES,
  apptStatusList, statusUsage, customLists, customListById, listOptions, QUALIFICATION_TYPES,
  qualificationList, qualificationCoveredBy, earningCodes, masterUsage,
} from '../../lib/settingsMasters'

const fmtWhen = (ts) => (ts ? new Date(ts).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—')
const blankOffice = { name: '', type: 'Center', isLocation: true, excludeFromLocations: false, parent: '', address: '', city: '', state: 'CA', zip: '', addressNotes: '', phone: '', fax: '', email: '', taxIdType: 'EIN', ein: '', npi: '', timezone: 'America/Los_Angeles', scope: true, active: true, note: '', lat: null, lng: null }

/* ── Organization ─────────────────────────────────────────────────────────── */

export function OrganizationPanel({ state, actions, toast, readOnly }) {
  const { settings } = state
  const org = settings.org || {}
  const offices = settingsOffices(settings)
  const usage = useMemo(() => masterUsage(state), [state])
  const [editor, setEditor] = useState(null)
  const [confirmRemove, setConfirmRemove] = useState(null)

  const saveOrg = (patch) => {
    const res = actions.settingsOp('org.patch', { patch })
    toast({ message: res.msg, kind: res.ok ? 'ok' : 'warn' })
  }
  const saveOffice = (item) => {
    const res = actions.settingsOp('office.upsert', { item })
    toast({ message: res.msg, kind: res.ok ? 'ok' : 'warn' })
    if (res.ok) setEditor(null)
  }
  const removeOffice = (office, reassignTo) => {
    const res = actions.settingsOp('office.remove', { id: office.id, reassignTo })
    toast({ message: res.msg, kind: res.ok ? 'ok' : 'warn', action: res.ok ? { label: 'Undo', onClick: () => actions.undo() } : undefined })
    if (res.ok) setConfirmRemove(null)
  }
  const toggleOffice = (office, field) => {
    const res = actions.settingsOp('office.upsert', { item: { ...office, [field]: !office[field] } })
    toast({ message: res.msg, kind: res.ok ? 'ok' : 'warn' })
  }

  return (
    <>
      <Section title="Practice identity" sub="Printed on claims, statements and generated documents" testId="set-org-identity">
        <div className="set-grid2">
          <Row label="Practice name"><TextField value={org.name} onCommit={(v) => saveOrg({ name: v })} testid="set-org-name" disabled={readOnly} /></Row>
          <Row label="Legal name" hint="If it differs from the trading name"><TextField value={org.legalName} onCommit={(v) => saveOrg({ legalName: v })} testid="set-org-legal" disabled={readOnly} /></Row>
          <Row label="Tax ID / EIN" hint="Format 12-3456789"><TextField value={org.taxId} onCommit={(v) => saveOrg({ taxId: v })} testid="set-org-taxid" disabled={readOnly} /></Row>
          <Row label="Organisation NPI" hint="10 digits, used as the billing NPI on 837/CMS-1500"><TextField value={org.npi} onCommit={(v) => saveOrg({ npi: v })} testid="set-org-npi" disabled={readOnly} /></Row>
          <Row label="Main phone"><TextField value={org.phone} onCommit={(v) => saveOrg({ phone: v })} testid="set-org-phone" disabled={readOnly} /></Row>
          <Row label="Billing email"><TextField value={org.email} onCommit={(v) => saveOrg({ email: v })} testid="set-org-email" disabled={readOnly} /></Row>
          <Row label="Website"><TextField value={org.website} onCommit={(v) => saveOrg({ website: v })} testid="set-org-web" disabled={readOnly} /></Row>
          <Row label="Fiscal year starts">
            <Select value={String(org.fiscalYearStart || 1)} disabled={readOnly} testid="set-org-fy"
              onChange={(v) => saveOrg({ fiscalYearStart: Number(v) })}
              options={Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: new Date(2000, i, 1).toLocaleString([], { month: 'long' }) }))} />
          </Row>
          <Row label="Street address" stack><TextField value={org.address} onCommit={(v) => saveOrg({ address: v })} wide={420} testid="set-org-address" disabled={readOnly} /></Row>
          <Row label="City / state / ZIP">
            <div className="set-inline">
              <TextField value={org.city} onCommit={(v) => saveOrg({ city: v })} wide={150} testid="set-org-city" disabled={readOnly} />
              <Select value={org.state || 'CA'} disabled={readOnly} wide={84} options={US_STATES.map((s) => ({ value: s, label: s }))} onChange={(v) => saveOrg({ state: v })} testid="set-org-state" />
              <TextField value={org.zip} onCommit={(v) => saveOrg({ zip: v })} wide={92} testid="set-org-zip" disabled={readOnly} />
            </div>
          </Row>
          <Row label="Timezone">
            <Select value={org.timezone || TIMEZONES[0]} disabled={readOnly} wide={220} testid="set-org-tz"
              options={TIMEZONES.map((t) => ({ value: t, label: t.replace('America/', '') }))} onChange={(v) => saveOrg({ timezone: v })} />
          </Row>
        </div>
        <Banner tone="info" testid="set-org-note">
          The NPI and tax ID here fill the billing-organization boxes on generated claims and statements. This demo has no
          payer connection — verify credentials against the enrollment records before any real filing.
        </Banner>
      </Section>

      <Section
        title="Offices & locations"
        sub={`${offices.filter((o) => o.active !== false).length} active · ${offices.filter((o) => o.isLocation).length} schedulable locations`}
        testId="set-org-offices"
        actions={<button className="btn btn-sm btn-primary" disabled={readOnly} data-testid="set-office-add" onClick={() => setEditor({ ...blankOffice })}>{Icon.plus({ size: 12 })} Add office or location</button>}
      >
        <DataTable
          testid="set-office-table"
          empty="No offices on file."
          columns={[
            { key: 'name', label: 'Name', width: '1.4fr' }, { key: 'type', label: 'Type', width: '0.9fr' },
            { key: 'addr', label: 'Address', width: '1.4fr' }, { key: 'tz', label: 'Timezone', width: '1fr' },
            { key: 'use', label: 'In use', width: '0.6fr', num: true }, { key: 'state', label: 'Location', width: '0.7fr' },
            { key: 'scope', label: 'Access scope', width: '0.7fr' }, { key: 'act', label: '', width: '90px' },
          ]}
          rows={offices}
          renderRow={(o) => (
            <div className={`set-trow ${o.active === false ? 'off' : ''}`} key={o.id} data-testid={`set-office-${o.id}`} style={{ gridTemplateColumns: '1.4fr 0.9fr 1.4fr 1fr 0.6fr 0.7fr 0.7fr 90px' }}>
              <span><b>{o.name}</b>{o.parent ? <i className="set-sub">under {o.parent}</i> : null}{o.npi ? <i className="set-sub">NPI {o.npi}</i> : null}</span>
              <span className="muted">{o.type}</span>
              <span className="muted">{[o.address, o.city, o.state].filter(Boolean).join(', ') || '—'}</span>
              <span className="muted">{o.timezone?.replace('America/', '') || '—'}</span>
              <span className="num">{usage.offices[o.name] || 0}</span>
              <span>{o.isLocation ? <span className="set-pill on">schedulable</span> : <span className="set-pill">grouping</span>}</span>
              <span>{o.scope !== false ? <span className="set-pill on">in scope</span> : <span className="set-pill">hidden</span>}</span>
              <span className="set-actions">
                <IconButton icon="edit" title={`Edit ${o.name}`} disabled={readOnly} testid={`set-office-edit-${o.id}`} onClick={() => setEditor({ ...o })} />
                <IconButton icon={o.active === false ? 'check' : 'ban'} title={o.active === false ? 'Reactivate' : 'Deactivate'} disabled={readOnly} testid={`set-office-toggle-${o.id}`} onClick={() => toggleOffice(o, 'active')} />
                <IconButton icon="trash" tone="danger" title={`Remove ${o.name}`} disabled={readOnly} testid={`set-office-del-${o.id}`} onClick={() => setConfirmRemove(o)} />
              </span>
            </div>
          )}
        />
        <p className="set-hint">
          A schedulable location appears in the appointment and intake location pickers. “Grouping” rows exist for payroll and access
          scoping (for example <em>School-based</em>). Renaming an office updates appointments, clients, payroll profiles, intake
          requests and account office scopes in the same Undo step.
        </p>

        {editor && (
          <div className="set-editor" data-testid="set-office-editor">
            <div className="set-editor-head">
              <b>{editor.id ? `Edit ${editor.name}` : 'New office or location'}</b>
              <button className="iconbtn" onClick={() => setEditor(null)} aria-label="Close editor">{Icon.x({ size: 13 })}</button>
            </div>
            <div className="set-grid2">
              <Row label="Name *"><TextField value={editor.name} onCommit={(v) => setEditor({ ...editor, name: v })} wide={220} testid="set-office-f-name" /></Row>
              <Row label="Type"><Select value={editor.type} wide={200} testid="set-office-f-type" options={OFFICE_TYPES.map((t) => ({ value: t, label: t }))} onChange={(v) => setEditor({ ...editor, type: v })} /></Row>
              <Row label="Schedulable location" hint="Off when this is only a payroll/access grouping">
                <Toggle on={editor.isLocation !== false} testid="set-office-f-loc" onChange={(v) => setEditor({ ...editor, isLocation: v, excludeFromLocations: !v })} />
              </Row>
              <Row label="Exclude from location options" hint="Hide this office from appointment location dropdowns">
                <Toggle on={editor.excludeFromLocations != null ? !!editor.excludeFromLocations : editor.isLocation === false} testid="set-office-f-exclude-loc" onChange={(v) => setEditor({ ...editor, excludeFromLocations: v, isLocation: !v })} />
              </Row>
              <Row label="Parent" hint="Optional — a room inside a center, for example"><TextField value={editor.parent} onCommit={(v) => setEditor({ ...editor, parent: v })} wide={220} testid="set-office-f-parent" /></Row>
              <Row label="Tax ID Type & EIN" hint="Optional office-level EIN override">
                <div className="set-inline">
                  <Select value={editor.taxIdType || 'EIN'} wide={84} testid="set-office-f-taxtype" options={[{ value: 'EIN', label: 'EIN' }, { value: 'SSN', label: 'SSN' }]} onChange={(v) => setEditor({ ...editor, taxIdType: v })} />
                  <TextField value={editor.ein || ''} onCommit={(v) => setEditor({ ...editor, ein: v })} wide={140} placeholder="12-3456789" testid="set-office-f-ein" />
                </div>
              </Row>
              <Row label="Street"><TextField value={editor.address} onCommit={(v) => setEditor({ ...editor, address: v })} wide={260} testid="set-office-f-address" /></Row>
              <Row label="City"><TextField value={editor.city} onCommit={(v) => setEditor({ ...editor, city: v })} wide={180} testid="set-office-f-city" /></Row>
              <Row label="State">
                <Select value={editor.state || 'CA'} wide={84} testid="set-office-f-state" options={US_STATES.map((s) => ({ value: s, label: s }))} onChange={(v) => setEditor({ ...editor, state: v })} />
              </Row>
              <Row label="ZIP"><TextField value={editor.zip} onCommit={(v) => setEditor({ ...editor, zip: v })} wide={92} testid="set-office-f-zip" /></Row>
              <Row label="Address notes"><TextField value={editor.addressNotes || ''} onCommit={(v) => setEditor({ ...editor, addressNotes: v })} wide={240} placeholder="Suite, gate code…" testid="set-office-f-addrnotes" /></Row>
              <Row label="Phone"><TextField value={editor.phone} onCommit={(v) => setEditor({ ...editor, phone: v })} wide={160} testid="set-office-f-phone" /></Row>
              <Row label="Fax"><TextField value={editor.fax || ''} onCommit={(v) => setEditor({ ...editor, fax: v })} wide={160} testid="set-office-f-fax" /></Row>
              <Row label="Email"><TextField value={editor.email || ''} onCommit={(v) => setEditor({ ...editor, email: v })} wide={220} testid="set-office-f-email" /></Row>
              <Row label="NPI" hint="Optional 10-digit NPI for this location"><TextField value={editor.npi} onCommit={(v) => setEditor({ ...editor, npi: v })} wide={160} testid="set-office-f-npi" /></Row>
              <Row label="Latitude" hint="Optional — used for travel time estimate; e.g. 37.25"><TextField value={editor.lat ?? ''} onCommit={(v) => setEditor({ ...editor, lat: v })} wide={160} placeholder="37.25" testid="set-office-f-lat" /></Row>
              <Row label="Longitude" hint="Optional — e.g. -121.94; needs latitude too"><TextField value={editor.lng ?? ''} onCommit={(v) => setEditor({ ...editor, lng: v })} wide={160} placeholder="-121.94" testid="set-office-f-lng" /></Row>
              <Row label="Timezone">
                <Select value={editor.timezone || TIMEZONES[0]} wide={220} testid="set-office-f-tz" options={TIMEZONES.map((t) => ({ value: t, label: t.replace('America/', '') }))} onChange={(v) => setEditor({ ...editor, timezone: v })} />
              </Row>
              <Row label="Available for access scoping" hint="Off keeps this location out of the Security office picker">
                <Toggle on={editor.scope !== false} testid="set-office-f-scope" onChange={(v) => setEditor({ ...editor, scope: v })} />
              </Row>
              <Row label="Note" stack><TextField value={editor.note} onCommit={(v) => setEditor({ ...editor, note: v })} wide={420} testid="set-office-f-note" /></Row>
            </div>
            <div className="set-editor-foot">
              <button className="btn btn-sm" onClick={() => setEditor(null)}>Cancel</button>
              <button className="btn btn-sm btn-primary" disabled={readOnly} data-testid="set-office-save" onClick={() => saveOffice(editor)}>{editor.id ? 'Save office' : 'Add office'}</button>
            </div>
          </div>
        )}

        {confirmRemove && (
          <RemoveOfficeConfirm
            office={confirmRemove}
            used={usage.offices[confirmRemove.name] || 0}
            options={offices.filter((o) => o.id !== confirmRemove.id).map((o) => ({ value: o.name, label: o.name }))}
            onCancel={() => setConfirmRemove(null)}
            onConfirm={(reassignTo) => removeOffice(confirmRemove, reassignTo)}
          />
        )}
      </Section>
    </>
  )
}

function RemoveOfficeConfirm({ office, used, options, onCancel, onConfirm }) {
  const [reassignTo, setReassignTo] = useState(options[0]?.value || '')
  return (
    <div className="set-banner warn" role="alert" data-testid="set-office-remove-confirm">
      {Icon.alert({ size: 14 })}
      <div>
        <b>Remove “{office.name}”?</b>
        <span>
          {used ? `${used} record${used === 1 ? '' : 's'} point at this office. Move them to:` : 'Nothing currently uses this office.'}
        </span>
        {used > 0 && (
          <Select value={reassignTo} onChange={setReassignTo} testid="set-office-reassign" options={options} />
        )}
        <div className="set-actions">
          <button className="btn btn-sm btn-danger" data-testid="set-office-remove-ok" onClick={() => onConfirm(used ? reassignTo : '')}>Remove office</button>
          <button className="btn btn-sm" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  )
}

/* ── Appointment statuses ─────────────────────────────────────────────────── */

const SWATCHES = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#14b8a6', '#ec4899', '#64748b', '#a855f7']

export function AppointmentStatusPanel({ state, actions, toast, readOnly }) {
  const { settings } = state
  const rows = apptStatusList(settings)
  const codes = earningCodes(settings.payroll)
  const [editor, setEditor] = useState(null)
  const [confirmRemove, setConfirmRemove] = useState(null)

  const save = (item) => {
    const res = actions.settingsOp('status.upsert', { item })
    toast({ message: res.msg, kind: res.ok ? 'ok' : 'warn' })
    if (res.ok) setEditor(null)
  }
  const move = (key, dir) => {
    const res = actions.settingsOp('status.move', { key, dir })
    if (!res.ok) toast({ message: res.msg, kind: 'warn' })
  }
  const remove = (row, reassignTo) => {
    const res = actions.settingsOp('status.remove', { key: row.key, reassignTo })
    toast({ message: res.msg, kind: res.ok ? 'ok' : 'warn', action: res.ok ? { label: 'Undo', onClick: () => actions.undo() } : undefined })
    if (res.ok) setConfirmRemove(null)
  }
  const patch = (row, changes) => {
    const res = actions.settingsOp('status.upsert', { item: { ...row, ...changes } })
    if (!res.ok) toast({ message: res.msg, kind: 'warn' })
  }

  return (
    <Section
      title="Appointment statuses"
      sub={`${rows.filter((s) => s.active !== false).length} active of ${rows.length}`}
      testId="set-status-list"
      actions={<button className="btn btn-sm btn-primary" disabled={readOnly} data-testid="set-status-add" onClick={() => setEditor({ key: '', label: '', aka: '', color: SWATCHES[0], active: true, pays: true, billable: true, noteRequired: false, isCancellation: false, allowToComplete: true, payrollCode: '', cancelBand: false, note: '' })}>{Icon.plus({ size: 12 })} Add status</button>}
    >
      <DataTable
        testid="set-status-table"
        empty="No statuses configured."
        columns={[
          { key: 'o', label: '', width: '50px' },
          { key: 'label', label: 'Status Name', width: '1.3fr' },
          { key: 'aka', label: 'AKA', width: '0.55fr' },
          { key: 'notereq', label: 'Note Req', width: '0.65fr' },
          { key: 'band', label: 'Cancellation', width: '0.7fr' },
          { key: 'comp', label: 'Allow Complete', width: '0.8fr' },
          { key: 'pays', label: 'Payable', width: '0.6fr' },
          { key: 'bill', label: 'Billable', width: '0.6fr' },
          { key: 'code', label: 'Payroll code', width: '0.95fr' },
          { key: 'use', label: 'Used', width: '0.45fr', num: true },
          { key: 'act', label: '', width: '96px' },
        ]}
        rows={rows}
        renderRow={(s, i) => (
          <div className={`set-trow ${s.active === false ? 'off' : ''}`} key={s.key} data-testid={`set-status-${s.key}`} style={{ gridTemplateColumns: '50px 1.3fr 0.55fr 0.65fr 0.7fr 0.8fr 0.6fr 0.6fr 0.95fr 0.45fr 96px' }}>
            <span className="set-order">
              <IconButton icon="chevDown" title="Move down" disabled={readOnly || i === rows.length - 1} testid={`set-status-down-${s.key}`} onClick={() => move(s.key, 'down')} />
              <IconButton icon="chevDown" title="Move up" disabled={readOnly || i === 0} testid={`set-status-up-${s.key}`} onClick={() => move(s.key, 'up')} />
            </span>
            <span className="set-inline">
              <i className="set-dot" style={{ background: s.color }} />
              <b>{s.label}</b>
              {s.system && <i className="set-sub">built-in</i>}
              {s.active === false && <i className="set-sub">inactive</i>}
            </span>
            <span className="muted"><code>{s.aka || s.key.slice(0, 3).toUpperCase()}</code></span>
            <span><Toggle on={!!s.noteRequired} disabled={readOnly} testid={`set-status-notereq-${s.key}`} onChange={(v) => patch(s, { noteRequired: v })} /></span>
            <span><Toggle on={!!(s.isCancellation ?? s.cancelBand)} disabled={readOnly} testid={`set-status-band-${s.key}`} onChange={(v) => patch(s, { cancelBand: v, isCancellation: v })} /></span>
            <span><Toggle on={s.allowToComplete !== false} disabled={readOnly} testid={`set-status-complete-${s.key}`} onChange={(v) => patch(s, { allowToComplete: v })} /></span>
            <span><Toggle on={s.pays !== false} disabled={readOnly} testid={`set-status-pays-${s.key}`} onChange={(v) => patch(s, { pays: v })} /></span>
            <span><Toggle on={s.billable !== false} disabled={readOnly} testid={`set-status-billable-${s.key}`} onChange={(v) => patch(s, { billable: v })} /></span>
            <span>
              <Select value={s.payrollCode || ''} disabled={readOnly} wide={120} testid={`set-status-code-${s.key}`}
                options={[{ value: '', label: 'By appointment type' }, ...codes.map((c) => ({ value: c.id, label: `${c.id} — ${c.short || c.label}` }))]}
                onChange={(v) => patch(s, { payrollCode: v })} />
            </span>
            <span className="num">{statusUsage(state, s.key)}</span>
            <span className="set-actions">
              <IconButton icon="edit" title={`Edit ${s.label}`} disabled={readOnly} testid={`set-status-edit-${s.key}`} onClick={() => setEditor({ ...s })} />
              <IconButton icon={s.active === false ? 'check' : 'ban'} title={s.active === false ? 'Reactivate' : 'Deactivate'} disabled={readOnly} testid={`set-status-toggle-${s.key}`} onClick={() => patch(s, { active: s.active === false })} />
              <IconButton icon="trash" tone="danger" title={`Remove ${s.label}`} disabled={readOnly} testid={`set-status-del-${s.key}`} onClick={() => setConfirmRemove(s)} />
            </span>
          </div>
        )}
      />
      <Banner tone="info" testid="set-status-note">
        A status with <b>Payable</b> off produces no payroll line at all. <b>Cancellation</b> applies the cancellation policy
        percentages (free-notice hours, short-notice and no-show shares from Payroll → General), <b>Note Req</b> requires a reason
        on the appointment before saving, and <b>Billable</b> controls whether completed sessions in this status stage for claims.
      </Banner>

      {editor && (
        <div className="set-editor" data-testid="set-status-editor">
          <div className="set-editor-head"><b>{editor.key ? `Edit ${editor.label}` : 'New appointment status'}</b><button className="iconbtn" onClick={() => setEditor(null)} aria-label="Close editor">{Icon.x({ size: 13 })}</button></div>
          <div className="set-grid2">
            <Row label="Label *"><TextField value={editor.label} onCommit={(v) => setEditor({ ...editor, label: v })} wide={200} testid="set-status-f-label" /></Row>
            <Row label="AKA *" hint="Short code shown on compact badges"><TextField value={editor.aka || ''} onCommit={(v) => setEditor({ ...editor, aka: v })} wide={100} placeholder="ACT" testid="set-status-f-aka" /></Row>
            <Row label="Key" hint="Lower-case identifier stored on appointments"><TextField value={editor.key} onCommit={(v) => setEditor({ ...editor, key: v })} wide={180} testid="set-status-f-key" disabled={!!editor.system} /></Row>
            <Row label="Colour">
              <div className="set-swatches" role="group" aria-label="Status colour">
                {SWATCHES.map((c) => (
                  <button key={c} type="button" className={`set-swatch ${editor.color === c ? 'on' : ''}`} style={{ background: c }} aria-label={c} data-testid={`set-status-color-${c.slice(1)}`} onClick={() => setEditor({ ...editor, color: c })} />
                ))}
              </div>
            </Row>
            <Row label="Note required" hint="Require a note when an appointment uses this status"><Toggle on={!!editor.noteRequired} testid="set-status-f-notereq" onChange={(v) => setEditor({ ...editor, noteRequired: v })} /></Row>
            <Row label="Allow to complete" hint="Allow sessions in this status to be verified/completed"><Toggle on={editor.allowToComplete !== false} testid="set-status-f-complete" onChange={(v) => setEditor({ ...editor, allowToComplete: v })} /></Row>
            <Row label="Pays payroll" hint="Off = appointments in this status never produce a payable line"><Toggle on={editor.pays !== false} testid="set-status-f-pays" onChange={(v) => setEditor({ ...editor, pays: v })} /></Row>
            <Row label="Billable" hint="Allow completed sessions in this status to stage for billing"><Toggle on={editor.billable !== false} testid="set-status-f-billable" onChange={(v) => setEditor({ ...editor, billable: v })} /></Row>
            <Row label="Earning code">
              <Select value={editor.payrollCode || ''} wide={220} testid="set-status-f-code" options={[{ value: '', label: 'By appointment type' }, ...codes.map((c) => ({ value: c.id, label: `${c.id} — ${c.short || c.label}` }))]} onChange={(v) => setEditor({ ...editor, payrollCode: v })} />
            </Row>
            <Row label="Cancellation band"><Toggle on={!!(editor.isCancellation ?? editor.cancelBand)} testid="set-status-f-band" onChange={(v) => setEditor({ ...editor, cancelBand: v, isCancellation: v })} /></Row>
            <Row label="Note" stack><TextField value={editor.note} onCommit={(v) => setEditor({ ...editor, note: v })} wide={420} testid="set-status-f-note" /></Row>
          </div>
          <div className="set-editor-foot">
            <button className="btn btn-sm" onClick={() => setEditor(null)}>Cancel</button>
            <button className="btn btn-sm btn-primary" disabled={readOnly} data-testid="set-status-save" onClick={() => save(editor)}>{editor.key ? 'Save status' : 'Add status'}</button>
          </div>
        </div>
      )}

      {confirmRemove && (
        <div className="set-banner warn" role="alert" data-testid="set-status-remove-confirm">
          {Icon.alert({ size: 14 })}
          <div>
            <b>Remove “{confirmRemove.label}”?</b>
            <span>{statusUsage(state, confirmRemove.key)} appointment{statusUsage(state, confirmRemove.key) === 1 ? '' : 's'} currently use it.</span>
            <Select value={rows.find((s) => s.key !== confirmRemove.key)?.key || ''} testid="set-status-reassign"
              options={rows.filter((s) => s.key !== confirmRemove.key).map((s) => ({ value: s.key, label: s.label }))}
              onChange={(v) => setConfirmRemove({ ...confirmRemove, reassignTo: v })} />
            <div className="set-actions">
              <button className="btn btn-sm btn-danger" data-testid="set-status-remove-ok" onClick={() => remove(confirmRemove, confirmRemove.reassignTo || rows.find((s) => s.key !== confirmRemove.key)?.key)}>Remove and move appointments</button>
              <button className="btn btn-sm" onClick={() => setConfirmRemove(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </Section>
  )
}

/* ── Custom lists ─────────────────────────────────────────────────────────── */

const LIST_NOTES = {
  'cancel-reasons': 'Offered when a session is cancelled; the choice feeds cancellation analytics.',
  'appt-sources': 'How an appointment came to be booked.',
  'contact-methods': 'Preferred contact channel recorded on families and payers.',
  'document-types': 'Document kinds tracked on the intake checklist and client chart.',
  'waitlist-priorities': 'How urgently an intake request is waiting for a slot.',
  'service-categories': 'Grouping shown on the service master and rate cards.',
  'service-settings': 'Where a service is delivered (center, home, school…).',
  'delivery-modes': 'How the service is staffed and delivered.',
  modifiers: 'Modifiers offered when a service line needs one.',
}

export function CustomListsPanel({ state, actions, toast, readOnly, sub }) {
  const { settings } = state
  const group = sub === 'service-type' ? 'service-type' : 'general'
  const lists = customLists(settings, group)
  const [selectedId, setSelectedId] = useState(lists[0]?.id || null)
  const selected = customListById(settings, selectedId) || lists[0] || null
  const [newList, setNewList] = useState(null)
  const [optionDraft, setOptionDraft] = useState('')

  const act = (op, payload, okMsg) => {
    const res = actions.settingsOp(op, payload)
    toast({ message: res.msg || okMsg, kind: res.ok ? 'ok' : 'warn' })
    return res
  }
  const options = selected ? listOptions(settings, selected.id, { activeOnly: false }) : []

  return (
    <Section
      title={group === 'general' ? 'General lists' : 'Service-type lists'}
      sub={`${lists.length} list${lists.length === 1 ? '' : 's'}`}
      testId="set-lists"
      actions={<button className="btn btn-sm btn-primary" disabled={readOnly} data-testid="set-list-add" onClick={() => setNewList({ name: '', description: '' })}>{Icon.plus({ size: 12 })} New list</button>}
    >
      <div className="set-split">
        <div className="set-listcol" role="tablist" aria-label="Custom lists">
          {lists.map((l) => (
            <button key={l.id} role="tab" aria-selected={selected?.id === l.id} className={`set-listitem ${selected?.id === l.id ? 'on' : ''}`} data-testid={`set-list-pick-${l.id}`} onClick={() => setSelectedId(l.id)}>
              <b>{l.name}</b>
              <i>{l.options.length} option{l.options.length === 1 ? '' : 's'}{l.status === 'inactive' ? ' · inactive' : ''}</i>
            </button>
          ))}
          {!lists.length && <Empty testid="set-lists-empty">No lists in this group yet.</Empty>}
        </div>
        <div className="set-listmain">
          {selected ? (
            <>
              <div className="set-listhead">
                <div>
                  <TextField value={selected.name} disabled={readOnly} wide={240} testid="set-list-name" onCommit={(v) => act('list.upsert', { item: { ...selected, name: v } })} />
                  <span className="muted">{LIST_NOTES[selected.id] || 'Pick list used across the suite.'}</span>
                </div>
                <div className="set-actions" style={{ gap: 10 }}>
                  <span className="muted" style={{ fontSize: 11 }}>Editable</span>
                  <Toggle on={selected.editable !== false} disabled={readOnly} testid="set-list-editable" onChange={(v) => act('list.upsert', { item: { ...selected, editable: v } })} />
                  <span className="muted" style={{ fontSize: 11 }}>Active</span>
                  <Toggle on={selected.status !== 'inactive'} disabled={readOnly} testid="set-list-active" onChange={(v) => act('list.upsert', { item: { ...selected, status: v ? 'active' : 'inactive' } })} />
                  {!selected.system && <IconButton icon="trash" tone="danger" title="Delete list" disabled={readOnly} testid="set-list-del" onClick={() => act('list.remove', { id: selected.id })} />}
                </div>
              </div>
              <DataTable
                testid="set-list-options"
                empty="No options yet — add the first one below."
                columns={[{ key: 'label', label: 'Option', width: '1.5fr' }, { key: 'edit', label: 'Editable', width: '0.6fr' }, { key: 'use', label: 'Active', width: '0.6fr' }, { key: 'act', label: '', width: '90px' }]}
                rows={options}
                renderRow={(o, i) => (
                  <div className={`set-trow ${o.active === false ? 'off' : ''}`} key={o.id} data-testid={`set-list-option-${o.id}`} style={{ gridTemplateColumns: '1.5fr 0.6fr 0.6fr 90px' }}>
                    <span><TextField value={o.label} disabled={readOnly || selected.editable === false || o.editable === false} wide={260} testid={`set-list-option-text-${o.id}`} onCommit={(v) => act('list.optionUpdate', { listId: selected.id, optionId: o.id, patch: { label: v } })} /></span>
                    <span><Toggle on={o.editable !== false} disabled={readOnly || selected.editable === false} testid={`set-list-option-editable-${o.id}`} onChange={(v) => act('list.optionUpdate', { listId: selected.id, optionId: o.id, patch: { editable: v } })} /></span>
                    <span><Toggle on={o.active !== false} disabled={readOnly || selected.editable === false} testid={`set-list-option-active-${o.id}`} onChange={(v) => act('list.optionUpdate', { listId: selected.id, optionId: o.id, patch: { active: v } })} /></span>
                    <span className="set-actions">
                      <IconButton icon="chevDown" title="Move down" disabled={readOnly || selected.editable === false || i === options.length - 1} testid={`set-list-option-down-${o.id}`} onClick={() => act('list.optionMove', { listId: selected.id, optionId: o.id, dir: 'down' })} />
                      <IconButton icon="chevDown" title="Move up" disabled={readOnly || selected.editable === false || i === 0} testid={`set-list-option-up-${o.id}`} onClick={() => act('list.optionMove', { listId: selected.id, optionId: o.id, dir: 'up' })} />
                      <IconButton icon="trash" tone="danger" title="Remove option" disabled={readOnly || selected.editable === false || o.editable === false} testid={`set-list-option-del-${o.id}`} onClick={() => act('list.optionRemove', { listId: selected.id, optionId: o.id })} />
                    </span>
                  </div>
                )}
              />
              <div className="set-inline" style={{ marginTop: 10 }}>
                <input className="input" style={{ width: 260 }} placeholder="Add an option…" value={optionDraft} disabled={readOnly} data-testid="set-list-option-new"
                  onChange={(e) => setOptionDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && optionDraft.trim()) { const r = act('list.optionAdd', { listId: selected.id, label: optionDraft }); if (r.ok) setOptionDraft('') } }} />
                <button className="btn btn-sm" disabled={readOnly || !optionDraft.trim()} data-testid="set-list-option-add"
                  onClick={() => { const r = act('list.optionAdd', { listId: selected.id, label: optionDraft }); if (r.ok) setOptionDraft('') }}>{Icon.plus({ size: 12 })} Add option</button>
              </div>
              <div className="set-grid2" style={{ marginTop: 12 }}>
                <Row label="Description" stack><TextField value={selected.description} disabled={readOnly} wide={420} testid="set-list-desc" onCommit={(v) => act('list.upsert', { item: { ...selected, description: v } })} /></Row>
              </div>
            </>
          ) : <Empty testid="set-lists-none">Pick a list on the left.</Empty>}
        </div>
      </div>

      {newList && (
        <div className="set-editor" data-testid="set-list-editor">
          <div className="set-editor-head"><b>New {group === 'general' ? 'general' : 'service-type'} list</b><button className="iconbtn" onClick={() => setNewList(null)} aria-label="Close">{Icon.x({ size: 13 })}</button></div>
          <div className="set-grid2">
            <Row label="List name *"><TextField value={newList.name} onCommit={(v) => setNewList({ ...newList, name: v })} wide={240} testid="set-list-f-name" /></Row>
            <Row label="Description" stack><TextField value={newList.description} onCommit={(v) => setNewList({ ...newList, description: v })} wide={360} testid="set-list-f-desc" /></Row>
          </div>
          <div className="set-editor-foot">
            <button className="btn btn-sm" onClick={() => setNewList(null)}>Cancel</button>
            <button className="btn btn-sm btn-primary" disabled={readOnly} data-testid="set-list-save"
              onClick={() => { const r = act('list.upsert', { item: { ...newList, group } }); if (r.ok) { setNewList(null); setSelectedId(null) } }}>Create list</button>
          </div>
        </div>
      )}
    </Section>
  )
}

/* ── Qualifications ───────────────────────────────────────────────────────── */

export function QualificationPanel({ state, actions, toast, readOnly }) {
  const { settings } = state
  const rows = qualificationList(settings, { activeOnly: false })
  const providers = settings.providers || []
  const [editor, setEditor] = useState(null)

  const save = (item) => {
    const res = actions.settingsOp('qualification.upsert', { item })
    toast({ message: res.msg, kind: res.ok ? 'ok' : 'warn' })
    if (res.ok) setEditor(null)
  }
  const patch = (row, changes) => {
    const res = actions.settingsOp('qualification.upsert', { item: { ...row, ...changes } })
    if (!res.ok) toast({ message: res.msg, kind: 'warn' })
  }
  const remove = (row) => {
    const res = actions.settingsOp('qualification.remove', { id: row.id })
    toast({ message: res.msg, kind: res.ok ? 'ok' : 'warn', action: res.ok ? { label: 'Undo', onClick: () => actions.undo() } : undefined })
  }
  const holders = (name) => providers.filter((p) => p.credential === name).length

  return (
    <Section
      title="Qualifications & credentials"
      sub={`${rows.filter((q) => q.status !== 'inactive').length} active of ${rows.length}`}
      testId="set-quals"
      actions={<button className="btn btn-sm btn-primary" disabled={readOnly} data-testid="set-qual-add" onClick={() => setEditor({ name: '', type: 'certification', authority: '', code: '', expires: true, lifeTime: false, covers: [], documentRequired: true, appliesTo: [], status: 'active' })}>{Icon.plus({ size: 12 })} Add qualification</button>}
    >
      <DataTable
        testid="set-qual-table"
        empty="No qualifications configured."
        columns={[
          { key: 'name', label: 'Qualification', width: '1.2fr' }, { key: 'type', label: 'Type', width: '0.8fr' },
          { key: 'auth', label: 'Issuer', width: '0.8fr' }, { key: 'code', label: 'Code', width: '0.55fr' },
          { key: 'exp', label: 'Life Time / Expiry', width: '0.75fr' }, { key: 'cov', label: 'Covers', width: '1.1fr' },
          { key: 'covby', label: 'Covered By', width: '1fr' }, { key: 'hold', label: 'Providers', width: '0.55fr', num: true }, { key: 'act', label: '', width: '90px' },
        ]}
        rows={rows}
        renderRow={(q) => {
          const coveredNames = (q.covers || []).map((cid) => rows.find((r) => r.id === cid)?.name || cid).filter(Boolean)
          const coveredByNames = qualificationCoveredBy(settings, q.id).map((r) => r.name)
          return (
            <div className={`set-trow ${q.status === 'inactive' ? 'off' : ''}`} key={q.id} data-testid={`set-qual-${q.id}`} style={{ gridTemplateColumns: '1.2fr 0.8fr 0.8fr 0.55fr 0.75fr 1.1fr 1fr 0.55fr 90px' }}>
              <span><b>{q.name}</b>{q.appliesTo?.length ? <i className="set-sub">roles: {q.appliesTo.join(', ')}</i> : null}</span>
              <span className="muted">{QUALIFICATION_TYPES.find((t) => t.id === q.type)?.label || q.type}</span>
              <span className="muted">{q.authority || '—'}</span>
              <span className="muted">{q.code || '—'}</span>
              <span>{q.lifeTime || !q.expires ? <span className="set-pill on">life time</span> : <span className="set-pill warn">expires</span>}</span>
              <span className="muted" style={{ fontSize: 11.5 }}>{coveredNames.length ? coveredNames.join(', ') : '—'}</span>
              <span className="muted" style={{ fontSize: 11.5 }}>{coveredByNames.length ? coveredByNames.join(', ') : '—'}</span>
              <span className="num">{holders(q.name)}</span>
              <span className="set-actions">
                <IconButton icon="edit" title={`Edit ${q.name}`} disabled={readOnly} testid={`set-qual-edit-${q.id}`} onClick={() => setEditor({ ...q })} />
                <IconButton icon={q.status === 'inactive' ? 'check' : 'ban'} title={q.status === 'inactive' ? 'Reactivate' : 'Deactivate'} disabled={readOnly} testid={`set-qual-toggle-${q.id}`} onClick={() => patch(q, { status: q.status === 'inactive' ? 'active' : 'inactive' })} />
                <IconButton icon="trash" tone="danger" title={`Remove ${q.name}`} disabled={readOnly} testid={`set-qual-del-${q.id}`} onClick={() => remove(q)} />
              </span>
            </div>
          )
        }}
      />
      <p className="set-hint">
        Credentials held by provider records are matched by name, and higher credentials automatically satisfy covered lower-tier
        qualifications during Appointment Validations (for example <b>BCBA</b> covers <b>BCaBA</b> and <b>RBT</b>). {providers.length} provider record{providers.length === 1 ? '' : 's'} on file.
      </p>

      {editor && (
        <div className="set-editor" data-testid="set-qual-editor">
          <div className="set-editor-head"><b>{editor.id ? `Edit ${editor.name}` : 'New qualification'}</b><button className="iconbtn" onClick={() => setEditor(null)} aria-label="Close">{Icon.x({ size: 13 })}</button></div>
          <div className="set-grid2">
            <Row label="Name *"><TextField value={editor.name} onCommit={(v) => setEditor({ ...editor, name: v })} wide={220} testid="set-qual-f-name" /></Row>
            <Row label="Type">
              <Select value={editor.type} wide={180} testid="set-qual-f-type" options={QUALIFICATION_TYPES.map((t) => ({ value: t.id, label: t.label }))} onChange={(v) => setEditor({ ...editor, type: v })} />
            </Row>
            <Row label="Issuing body"><TextField value={editor.authority} onCommit={(v) => setEditor({ ...editor, authority: v })} wide={200} testid="set-qual-f-auth" /></Row>
            <Row label="Abbreviation / code"><TextField value={editor.code} onCommit={(v) => setEditor({ ...editor, code: v })} wide={140} testid="set-qual-f-code" /></Row>
            <Row label="Life Time" hint="On = credential never expires"><Toggle on={!!editor.lifeTime || !editor.expires} testid="set-qual-f-lifetime" onChange={(v) => setEditor({ ...editor, lifeTime: v, expires: !v })} /></Row>
            <Row label="Expires"><Toggle on={!!editor.expires} testid="set-qual-f-expires" onChange={(v) => setEditor({ ...editor, expires: v, lifeTime: !v })} /></Row>
            <Row label="Document required"><Toggle on={!!editor.documentRequired} testid="set-qual-f-doc" onChange={(v) => setEditor({ ...editor, documentRequired: v })} /></Row>
            <Row label="Applies to roles" hint="Comma-separated role fragments, optional" stack>
              <TextField value={(editor.appliesTo || []).join(', ')} onCommit={(v) => setEditor({ ...editor, appliesTo: v.split(',').map((x) => x.trim()).filter(Boolean) })} wide={360} testid="set-qual-f-roles" />
            </Row>
            <Row label="Covers qualifications" hint="Staff holding this qualification satisfy the selected lower-tier qualifications" stack>
              <div className="set-inline" style={{ flexWrap: 'wrap', gap: 6 }}>
                {rows.filter((r) => r.id !== editor.id).map((other) => {
                  const on = (editor.covers || []).includes(other.id)
                  return (
                    <button
                      key={other.id}
                      type="button"
                      className={`checkbox ${on ? 'on' : ''}`}
                      data-testid={`set-qual-f-covers-${other.id}`}
                      onClick={() => {
                        const cur = editor.covers || []
                        setEditor({ ...editor, covers: on ? cur.filter((x) => x !== other.id) : [...cur, other.id] })
                      }}
                    >
                      {other.name}
                    </button>
                  )
                })}
              </div>
            </Row>
          </div>
          <div className="set-editor-foot">
            <button className="btn btn-sm" onClick={() => setEditor(null)}>Cancel</button>
            <button className="btn btn-sm btn-primary" disabled={readOnly} data-testid="set-qual-save" onClick={() => save(editor)}>{editor.id ? 'Save qualification' : 'Add qualification'}</button>
          </div>
        </div>
      )}
    </Section>
  )
}
