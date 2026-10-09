import React, { useState } from 'react'
import { Icon } from '../../ui/Icons'
import { Section, Row, TextField, NumberField, Select, Toggle, Banner, Empty, DataTable, IconButton } from './kit'
import { svcList, cfTypeLabel, CF_SCOPES } from '../../lib/master'
import {
  integrationsCfg, INTEGRATION_STATUSES, messagesCfg, MESSAGE_CATEGORIES, MERGE_FIELDS,
  subscriptionCfg, notificationsCfg, settingsOffices, earningCodes, isCancelStatus, listOptions, telehealthRoomFor,
} from '../../lib/settingsMasters'
import { downloadDoc } from '../../lib/exportKit'
import { todayISO } from '../../lib/date'
import { buildICS, download as downloadText } from '../../lib/ics'
import { ACCESS_LABELS, SECURITY_AREAS } from '../../lib/security'
import SecurityView from '../SecurityView'
import CfDefModal from '../CfDefModal'

/* ── Services (the master lives in Masters; this is its Settings home) ─────── */

export function ServicesPanel({ state, actions, toast, readOnly }) {
  const svcs = svcList(state)
  const appts = Object.values(state.appts || {})
  const codes = earningCodes(state.settings.payroll)
  const categoryOptions = listOptions(state.settings, 'service-categories').map((o) => o.label || o)
  const [editor, setEditor] = useState(null)
  const usage = (sv) => appts.filter((a) => a.service === sv.id).length
  const contracted = (sv) => (state.payers || []).filter((p) => (p.services || []).includes(sv.id) || (p.svcOv || {})[sv.id]).length
  const saveSvc = (item) => {
    if (!String(item.label || '').trim()) { toast({ message: 'Service name is required.', kind: 'warn' }); return }
    if (!String(item.aka || '').trim()) { toast({ message: 'Service AKA is required.', kind: 'warn' }); return }
    actions.upsertSvc({
      ...item,
      label: String(item.label).trim(),
      aka: String(item.aka).trim(),
      short: String(item.aka).trim(),
    })
    toast({ message: item.id ? `Updated service “${item.label}”` : `Created service “${item.label}”`, kind: 'ok' })
    setEditor(null)
  }
  return (
    <Section
      title="Service types"
      sub={`${svcs.filter((s) => s.status !== 'inactive').length} active of ${svcs.length} · ${(state.payers || []).length} payers`}
      testId="set-services"
      actions={
        <div className="set-actions">
          <button className="btn btn-sm" disabled={readOnly} data-testid="set-svc-add" onClick={() => setEditor({ label: '', aka: '', category: categoryOptions[0] || 'Adaptive Behavior Treatment', code: '97153', unitMins: 15, rate: 65, rounding: 'AMA', defaultEarningCode: codes[0]?.id || 'ABA', trackingId: '', taxable: false, credentials: ['RBT', 'BCBA'], status: 'active' })}>
            {Icon.plus({ size: 12 })} Add service
          </button>
          <button className="btn btn-sm btn-primary" data-testid="set-services-open" onClick={() => { actions.setUI({ section: 'masters', mastersTab: 'svcs', payerSel: null, settings: false }) }}>{Icon.edit({ size: 12 })} Open the service master</button>
        </div>
      }
    >
      <DataTable
        testid="set-services-table"
        empty="No service types on file."
        columns={[
          { key: 'label', label: 'Service / AKA', width: '1.4fr' }, { key: 'cat', label: 'Category', width: '1.1fr' },
          { key: 'code', label: 'Billing code', width: '0.7fr' }, { key: 'earn', label: 'Earning code', width: '0.75fr' },
          { key: 'track', label: 'Tracking ID', width: '0.75fr' }, { key: 'tax', label: 'Taxable', width: '0.55fr' },
          { key: 'rate', label: 'Rate', width: '0.6fr', num: true }, { key: 'pay', label: 'Payers', width: '0.5fr', num: true },
          { key: 'appt', label: 'Appts', width: '0.5fr', num: true }, { key: 'st', label: 'Status', width: '0.65fr' }, { key: 'act', label: '', width: '50px' },
        ]}
        rows={svcs}
        renderRow={(sv) => (
          <div className={`set-trow ${sv.status === 'inactive' ? 'off' : ''}`} key={sv.id} data-testid={`set-service-${sv.id}`} style={{ gridTemplateColumns: '1.4fr 1.1fr 0.7fr 0.75fr 0.75fr 0.55fr 0.6fr 0.5fr 0.5fr 0.65fr 50px' }}>
            <span><b>{sv.label}</b><i className="set-sub">AKA: {sv.aka || sv.short || sv.label} · {sv.rounding || 'AMA'}</i></span>
            <span className="muted">{sv.category || 'Adaptive Behavior Treatment'}</span>
            <span className="muted">{sv.code} ({sv.unitMins || 15}m)</span>
            <span className="pay-code">{sv.defaultEarningCode || 'ABA'}</span>
            <span className="muted">{sv.trackingId || '—'}</span>
            <span>{sv.taxable ? <span className="set-pill warn">taxable</span> : <span className="set-pill">exempt</span>}</span>
            <span className="num">${Number(sv.rate || 0).toFixed(2)}</span>
            <span className="num">{contracted(sv)}</span>
            <span className="num">{usage(sv)}</span>
            <span>{sv.status === 'inactive' ? <span className="set-pill">inactive</span> : <span className="set-pill on">active</span>}</span>
            <span className="set-actions">
              <IconButton icon="edit" title={`Edit ${sv.label}`} disabled={readOnly} testid={`set-svc-edit-${sv.id}`} onClick={() => setEditor({ ...sv })} />
            </span>
          </div>
        )}
      />
      {editor && (
        <div className="set-editor" data-testid="set-svc-editor">
          <div className="set-editor-head"><b>{editor.id ? `Edit ${editor.label}` : 'Add Service'}</b><button className="iconbtn" onClick={() => setEditor(null)} aria-label="Close">{Icon.x({ size: 13 })}</button></div>
          <div className="set-grid2">
            <Row label="Service Name *"><TextField value={editor.label} onCommit={(v) => setEditor({ ...editor, label: v })} wide={240} testid="set-svc-f-label" /></Row>
            <Row label="Service AKA *"><TextField value={editor.aka || ''} onCommit={(v) => setEditor({ ...editor, aka: v })} wide={180} testid="set-svc-f-aka" /></Row>
            <Row label="Category *">
              <Select value={editor.category || categoryOptions[0] || 'Adaptive Behavior Treatment'} wide={220} testid="set-svc-f-category"
                options={(categoryOptions.length ? categoryOptions : ['Adaptive Behavior Treatment', 'Behavior Assessment', 'Family Guidance', 'Protocol Mod / Supervision']).map((c) => ({ value: c, label: c }))}
                onChange={(v) => setEditor({ ...editor, category: v })} />
            </Row>
            <Row label="Billing Code (CPT)"><TextField value={editor.code || '97153'} onCommit={(v) => setEditor({ ...editor, code: v })} wide={120} testid="set-svc-f-code" /></Row>
            <Row label="Default Earning Code">
              <Select value={editor.defaultEarningCode || 'ABA'} wide={200} testid="set-svc-f-earning"
                options={codes.map((c) => ({ value: c.id, label: `${c.id}: ${c.label}` }))}
                onChange={(v) => setEditor({ ...editor, defaultEarningCode: v })} />
            </Row>
            <Row label="Third-Party Tracking ID"><TextField value={editor.trackingId || ''} onCommit={(v) => setEditor({ ...editor, trackingId: v })} wide={180} testid="set-svc-f-tracking" placeholder="e.g. EVV-97153" /></Row>
            <Row label="Master Rate ($)"><NumberField value={editor.rate ?? 65} min={0} max={2000} step={0.5} suffix="$" testid="set-svc-f-rate" onCommit={(v) => setEditor({ ...editor, rate: v })} /></Row>
            <Row label="Unit Minutes"><NumberField value={editor.unitMins ?? 15} min={5} max={240} step={5} suffix="min" testid="set-svc-f-unit" onCommit={(v) => setEditor({ ...editor, unitMins: v })} /></Row>
            <Row label="Taxable"><Toggle on={!!editor.taxable} testid="set-svc-f-taxable" onChange={(v) => setEditor({ ...editor, taxable: v })} /></Row>
            <Row label="Active Status"><Toggle on={editor.status !== 'inactive'} testid="set-svc-f-status" onChange={(v) => setEditor({ ...editor, status: v ? 'active' : 'inactive' })} /></Row>
          </div>
          <div className="set-editor-foot">
            <button className="btn btn-sm" onClick={() => setEditor(null)}>Cancel</button>
            <button className="btn btn-sm btn-primary" disabled={readOnly} data-testid="set-svc-save" onClick={() => saveSvc(editor)}>{editor.id ? 'Save service' : 'Create service'}</button>
          </div>
        </div>
      )}
      <p className="set-hint">
        Service types feed the appointment wizard, quick-add, payroll default earning codes, rate cards and every claim line.
      </p>
    </Section>
  )
}

export function CustomFieldsPanel({ state, actions, toast, readOnly }) {
  const defs = state.customFields || []
  const [modalDef, setModalDef] = useState(undefined) // undefined = closed, null = new, obj = edit
  const picks = Object.values(state.appts || {}).reduce((t, a) => t + Object.keys(a.pcfs || {}).length, 0)
  const scopeLabel = (id) => CF_SCOPES.find((s) => s.id === id)?.label || id
  return (
    <Section
      title="Custom fields"
      sub={`${defs.filter((d) => d.status !== 'inactive').length} active of ${defs.length} · ${picks} values captured on appointments`}
      info={<span data-testid="set-cf-note">Custom fields are <b>opt-in</b>. Each one applies to the places you choose: Client Authorization, Client Profile, Payer Profile, Schedule Appointment or Staff Profile.</span>}
      testId="set-custom-fields"
      actions={
        <div className="set-actions">
          <button className="btn btn-sm" disabled={readOnly} data-testid="set-cf-add" onClick={() => setModalDef(null)}>
            {Icon.plus({ size: 12 })} Add custom field
          </button>
          <button className="btn btn-sm btn-primary" data-testid="set-cf-open" onClick={() => { actions.setUI({ section: 'masters', mastersTab: 'cfdefs', payerSel: null, settings: false }) }}>{Icon.edit({ size: 12 })} Open the custom-field master</button>
        </div>
      }
    >
      <DataTable
        testid="set-cf-table"
        empty="No custom fields defined."
        columns={[
          { key: 'label', label: 'Field', width: '1.3fr' }, { key: 'type', label: 'Controller', width: '0.95fr' },
          { key: 'scope', label: 'Assigned to', width: '1.3fr' }, { key: 'req', label: 'Required', width: '0.65fr' },
          { key: 'opt', label: 'Options / Format', width: '1.1fr' }, { key: 'st', label: 'Status', width: '0.65fr' }, { key: 'act', label: '', width: '50px' },
        ]}
        rows={defs}
        renderRow={(d) => {
          const scopes = Array.isArray(d.assignedTo) && d.assignedTo.length ? d.assignedTo : ['appointment', 'payer']
          return (
            <div className={`set-trow ${d.status === 'inactive' ? 'off' : ''}`} key={d.id} data-testid={`set-cf-${d.id}`} style={{ gridTemplateColumns: '1.3fr 0.95fr 1.3fr 0.65fr 1.1fr 0.65fr 50px' }}>
              <span><b>{d.label}</b>{d.note ? <i className="set-sub">{d.note}</i> : null}</span>
              <span className="muted">{cfTypeLabel ? cfTypeLabel(d.type) : d.type}</span>
              <span className="muted" style={{ fontSize: 11.5 }}>{scopes.map(scopeLabel).join(', ')}</span>
              <span>{d.required ? <span className="set-pill warn">required</span> : <span className="set-pill">optional</span>}</span>
              <span className="muted">{(d.options || []).slice(0, 4).join(', ') || (d.textFormat && d.textFormat !== 'any' ? `Format: ${d.textFormat}` : '—')}</span>
              <span>{d.status === 'inactive' ? <span className="set-pill">inactive</span> : <span className="set-pill on">active</span>}</span>
              <span className="set-actions">
                <IconButton icon="edit" title={`Edit ${d.label}`} disabled={readOnly} testid={`set-cf-edit-${d.id}`} onClick={() => setModalDef(d)} />
              </span>
            </div>
          )
        }}
      />
      {modalDef !== undefined && (
        <CfDefModal
          def={modalDef}
          onClose={(saved) => {
            if (saved && typeof saved === 'object' && saved.label) {
              actions.upsertCfDef(modalDef ? { ...modalDef, ...saved } : saved)
              toast({ message: modalDef ? `Updated field “${saved.label}”` : `Created field “${saved.label}”`, kind: 'ok' })
            }
            setModalDef(undefined)
          }}
        />
      )}
    </Section>
  )
}

/* ── Security home ────────────────────────────────────────────────────────── */

export function SecurityPanel({ state, actions, toast, readOnly, sub }) {
  const { security } = state
  const tab = sub === 'roles' ? 'roles' : 'accounts'
  const accounts = security.accounts
  const roles = security.roles
  const inScope = roles.map((r) => ({ role: r, people: accounts.filter((a) => a.roleId === r.id).length }))
  return (
    <>
      <Section
        title={tab === 'roles' ? 'User roles' : 'User accounts'}
        sub={`${accounts.filter((a) => a.status === 'active').length} active accounts · ${roles.length} roles`}
        testId="set-security"
        actions={<span className="set-pill">{tab === 'roles' ? 'User Roles' : 'User Accounts'}</span>}
      >
        <Banner tone="warn" testid="set-security-warning">
          These are role permissions in this browser, <b>not authentication</b>. No passwords are stored. This is not server-side
          authorization or HIPAA compliance, and the accounts are local demo records.
        </Banner>
        <div className="set-inline" data-testid={tab === 'roles' ? 'set-roles-table' : 'set-accounts-table'}>
          {tab === 'roles'
            ? roles.map((role) => (
              <span key={role.id} className="set-pill" data-testid={`set-role-${role.id}`}>{role.name} · {accounts.filter((a) => a.roleId === role.id).length}</span>
            ))
            : accounts.map((account) => (
              <span key={account.id} className="set-pill" data-testid={`set-account-${account.id}`}>
                {account.name} · {roles.find((r) => r.id === account.roleId)?.name || 'no role'}
              </span>
            ))}
        </div>
        <p className="set-hint">
          {accounts.length} account{accounts.length === 1 ? '' : 's'} across {new Set(accounts.flatMap((a) => a.officeIds || [])).size} office
          scope. Use the editor below for the permission matrix, bulk assignment and the role library.
        </p>
      </Section>
      <Section title={tab === 'roles' ? 'Role editor & assignment' : 'Account editor'} sub="Permissions, assignments and the role library" testId="set-security-workspace">
        <div className="set-embed" data-testid="set-security-embed">
          <SecurityView embedded />
        </div>
      </Section>
      <Section title="Where access is enforced" sub="Role permissions checked by the app" testId="set-security-areas">
        <div className="set-areas">
          {SECURITY_AREAS.map((area) => {
            const level = state.accessLevel(area.id)
            return (
              <span key={area.id} className={`set-area ${level === 'full' ? 'on' : level === 'view' ? 'view' : 'off'}`} title={area.description}>
                {area.label}<i>{ACCESS_LABELS ? ACCESS_LABELS[level] || level : level}</i>
              </span>
            )
          })}
        </div>
      </Section>
    </>
  )
}

/* ── Clinical integrations ────────────────────────────────────────────────── */

export function IntegrationsPanel({ state, actions, toast, readOnly }) {
  const settings = state.settings
  const rows = integrationsCfg(settings)
  const [selected, setSelected] = useState(rows[0]?.id || null)
  const row = rows.find((r) => r.id === selected) || rows[0]
  const patch = (id, changes, msg) => {
    const res = actions.settingsOp('integration.patch', { id, patch: changes })
    toast({ message: msg || res.msg, kind: res.ok ? 'ok' : 'warn' })
  }
  const runExport = () => {
    // Only the exports that actually exist locally can be "run" from here.
    if (row.id === 'int-calendar') {
      const appts = Object.values(state.appts || {}).filter((a) => a.date >= todayISO()).slice(0, 750)
      const staffById = Object.fromEntries((state.staff || []).map((s) => [s.id, s]))
      const clientsById = Object.fromEntries((state.clients || []).map((c) => [c.id, c]))
      downloadDoc(`aloha-aba-calendar-${todayISO()}.ics`, buildICS(appts, staffById, clientsById, (k) => isCancelStatus(settings, k), (a) => telehealthRoomFor(settings, a)), 'text/calendar;charset=utf-8')
      const res = actions.settingsOp('integration.ran', { id: row.id, who: state.currentAccount?.name })
      toast({ message: res.msg || `Downloaded ${appts.length} upcoming events as an .ics file`, kind: 'ok' })
      return
    }
    if (row.id === 'int-qbo') { actions.setUI({ section: 'bil-qbo', settings: false }); return }
    if (row.id === 'int-telehealth') {
      downloadDoc(`aloha-telehealth-room-${todayISO()}.txt`, `Telehealth room link for ${state.settings.org?.name || 'the practice'}\n\n${row.roomUrl || '(set a room URL in this panel)'}\n\nThis file is a reference card only. No session is recorded.\n`, 'text/plain;charset=utf-8')
      const res = actions.settingsOp('integration.ran', { id: row.id, who: state.currentAccount?.name })
      toast({ message: res.msg || 'Reference card downloaded', kind: 'ok' })
      return
    }
    if (row.id === 'int-paylink') {
      toast({ message: 'Nothing to export: the payment link prints on client statements. Record what families pay in the Payment Center.', kind: 'info' })
      return
    }
    toast({ message: `${row.name} has nothing to export here. It is a placeholder, not a connection.`, kind: 'warn' })
  }
  return (
    <>
      <Section title="Integrations" sub={`${rows.filter((r) => r.status !== 'off').length} of ${rows.length} available locally`} testId="set-integrations">
        <div className="set-split">
          <div className="set-listcol">
            {rows.map((r) => (
              <button key={r.id} className={`set-listitem ${row?.id === r.id ? 'on' : ''}`} data-testid={`set-integration-${r.id}`} onClick={() => setSelected(r.id)}>
                <b>{r.name}</b>
                <i><span className={`set-pill ${r.status === 'off' ? '' : 'on'}`}>{INTEGRATION_STATUSES[r.status]?.label}</span></i>
              </button>
            ))}
          </div>
          <div className="set-listmain">
            {row ? (
              <>
                <div className="set-listhead">
                  <div>
                    <b>{row.name}</b>
                    <span className="muted">{row.vendor} · {row.direction}</span>
                  </div>
                  <div className="set-actions">
                    <Select value={row.status} wide={200} disabled={readOnly} testid="set-integration-status" options={Object.entries(INTEGRATION_STATUSES).map(([id, v]) => ({ value: id, label: v.label }))} onChange={(v) => patch(row.id, { status: v })} />
                    <button className="btn btn-sm" disabled={row.status === 'off'} data-testid="set-integration-run" onClick={runExport}>{row.id === 'int-qbo' ? 'Open QuickBooks view' : 'Run local export'}</button>
                  </div>
                </div>
                <p className="set-hint">{row.detail}</p>
                <div className="set-grid2">
                  <Row label="Last local run"><span className="muted" data-testid="set-integration-last">{row.lastRunAt ? new Date(row.lastRunAt).toLocaleString() : 'never'}{row.lastRunBy ? ` · ${row.lastRunBy}` : ''}</span></Row>
                  {row.id === 'int-telehealth' && (
                    <Row label="Telehealth room URL" hint="Your practice’s own video room (Zoom, Doxy.me, Teams). Shown on telehealth appointments. The app does not host video."><TextField value={row.roomUrl} disabled={readOnly} wide={260} testid="set-integration-room" placeholder="https://" onCommit={(v) => patch(row.id, { roomUrl: v })} /></Row>
                  )}
                  {row.id === 'int-paylink' && (
                    <Row label="Payment link URL" hint="Your practice’s own payment page, such as a Stripe Payment Link. Printed on client statements. The app never charges a card."><TextField value={row.payUrl || ''} disabled={readOnly} wide={260} testid="set-integration-paylink" placeholder="https://" onCommit={(v) => patch(row.id, { payUrl: v })} /></Row>
                  )}
                  {/* This local prototype has no server-side secret vault, so no credential input is offered. */}
                  {row.direction !== 'Reference data' && (
                    <>
                      <Row label="Client ID / Account ID"><TextField value={row.clientId || ''} disabled={readOnly} wide={200} testid="set-integration-clientid" placeholder="Partner client ID" onCommit={(v) => patch(row.id, { clientId: v })} /></Row>
                      <Row label="Sandbox mode"><Toggle on={row.sandbox !== false} disabled={readOnly} testid="set-integration-sandbox" onChange={(v) => patch(row.id, { sandbox: v })} /></Row>
                      <Row label="Auto-sync session notes"><Toggle on={!!row.syncEnabled} disabled={readOnly} testid="set-integration-sync" onChange={(v) => patch(row.id, { syncEnabled: v })} /></Row>
                    </>
                  )}
                  <Row label="Internal note" stack><TextField value={row.note} disabled={readOnly} wide={420} testid="set-integration-note" onCommit={(v) => patch(row.id, { note: v })} /></Row>
                </div>
              </>
            ) : <Empty testid="set-integrations-none">No integrations configured.</Empty>}
          </div>
        </div>
        <Banner tone="warn" testid="set-integrations-note">
          Nothing here opens a network connection. The working parts are <b>local exports</b>: the ICS file, the QuickBooks CSV and the backup file.
          The other rows (Ensora, Hi Rasmus, Motivity, Welina, EMR/FHIR, clearinghouse, eligibility) are placeholders, and their status says so.
          There is no server-side secret vault, so integration records do not accept API keys or tokens. Do not enter live credentials.
        </Banner>
      </Section>
    </>
  )
}

/* ── Text messaging ───────────────────────────────────────────────────────── */

export function MessagingPanel({ state, actions, toast, readOnly }) {
  const cfg = messagesCfg(state.settings)
  const rem = cfg.appointmentReminders || {
    sendToStaff: true, staffScope: 'all', sendToClient: true, clientScope: 'all', scheduleHoursBefore: 24, scheduleTime: '09:00',
  }
  const [editor, setEditor] = useState(null)
  const [optout, setOptout] = useState({ phone: '', name: '', reason: 'Replied STOP' })
  const [preview, setPreview] = useState(null)
  const patch = (changes) => {
    const res = actions.settingsOp('messaging.patch', { patch: changes })
    toast({ message: res.msg, kind: res.ok ? 'ok' : 'warn' })
    return res
  }
  const patchRem = (changes) => patch({ appointmentReminders: { ...rem, ...changes } })
  const saveTemplate = (item) => {
    const res = actions.settingsOp('template.upsert', { item })
    toast({ message: res.msg, kind: res.ok ? 'ok' : 'warn' })
    if (res.ok) setEditor(null)
  }
  const renderPreview = (body) => body
    .replaceAll('{{practice}}', state.settings.org?.name || 'Aloha ABA')
    .replaceAll('{{guardian}}', state.clients?.[0]?.guardian || 'Guardian')
    .replaceAll('{{client}}', state.clients?.[0]?.name || 'Client')
    .replaceAll('{{staff}}', state.staff?.[0]?.name || 'Staff')
    .replaceAll('{{date}}', todayISO())
    .replaceAll('{{time}}', '09:00')
    .replaceAll('{{location}}', settingsOffices(state.settings)[0]?.name || 'Main Center')
    .replaceAll('{{phone}}', state.settings.org?.phone || '(408) 555-0134')
    .replaceAll('{{balance}}', '$120.00')
    .replaceAll('{{period}}', 'this pay period')

  return (
    <>
      <Section title="Appointment Reminders" sub="SMS reminder preferences for staff and clients" testId="set-msg-reminders">
        <div className="set-grid2">
          <Row label="Send Text Messages to Staff">
            <Toggle on={rem.sendToStaff !== false} disabled={readOnly} testid="set-msg-rem-staff" onChange={(v) => patchRem({ sendToStaff: v })} />
          </Row>
          <Row label="Select Staff">
            <Select value={rem.staffScope || 'all'} wide={200} disabled={readOnly || rem.sendToStaff === false} testid="set-msg-rem-staff-scope"
              options={[{ value: 'all', label: 'All Assigned Staff' }, { value: 'rbt', label: 'Direct Therapy (RBT/BT) Only' }, { value: 'supervisors', label: 'Clinical Supervisors (BCBA)' }]}
              onChange={(v) => patchRem({ staffScope: v })} />
          </Row>
          <Row label="Send Text Messages to Client">
            <Toggle on={rem.sendToClient !== false} disabled={readOnly} testid="set-msg-rem-client" onChange={(v) => patchRem({ sendToClient: v })} />
          </Row>
          <Row label="Select Client">
            <Select value={rem.clientScope || 'all'} wide={200} disabled={readOnly || rem.sendToClient === false} testid="set-msg-rem-client-scope"
              options={[{ value: 'all', label: 'All Active Clients' }, { value: 'center', label: 'Center-Based Clients Only' }, { value: 'home', label: 'Home-Program Clients Only' }]}
              onChange={(v) => patchRem({ clientScope: v })} />
          </Row>
          <Row label="Schedule Time (Lead Window)">
            <Select value={String(rem.scheduleHoursBefore ?? 24)} wide={200} disabled={readOnly} testid="set-msg-rem-hours"
              options={[{ value: '2', label: '2 hours before session' }, { value: '24', label: '24 hours before session' }, { value: '48', label: '48 hours before session' }]}
              onChange={(v) => patchRem({ scheduleHoursBefore: Number(v) })} />
          </Row>
          <Row label="Organization Code *" hint="Short prefix at the start of every SMS reminder">
            <TextField value={cfg.orgCode || 'ALOHA'} disabled={readOnly} wide={140} testid="set-msg-orgcode" onCommit={(v) => patch({ orgCode: v.toUpperCase() })} />
          </Row>
        </div>
        <div className="set-msg-preview" data-testid="set-msg-rem-preview" style={{ marginTop: 10 }}>
          <b>Live Sample Reminder Preview ({cfg.orgCode || 'ALOHA'})</b>
          <p style={{ margin: '4px 0 0' }}>
            <b>Client SMS:</b> [{cfg.orgCode || 'ALOHA'}] Hi {state.clients?.[0]?.guardian || 'Guardian'}, reminder that {state.clients?.[0]?.name || 'Client'} has an appointment on {todayISO()} at 09:00 at {settingsOffices(state.settings)[0]?.name || 'Main Center'}. Reply C to confirm or STOP to opt out.
          </p>
          <p style={{ margin: '4px 0 0' }}>
            <b>Staff SMS:</b> [{cfg.orgCode || 'ALOHA'}] Reminder for {state.staff?.[0]?.name || 'Staff'}: Session with {state.clients?.[0]?.name || 'Client'} on {todayISO()} at 09:00 ({rem.scheduleHoursBefore ?? 24}h notice).
          </p>
        </div>
      </Section>

      <Section title="Sending identity" sub="Who the message says it is from" testId="set-msg-sender">
        <div className="set-grid2">
          <Row label="Texting enabled" hint="Off by default. This demo never sends messages."><Toggle on={!!cfg.enabled} disabled={readOnly} testid="set-msg-enabled" onChange={(v) => patch({ enabled: v })} /></Row>
          <Row label="Sender name"><TextField value={cfg.senderName} disabled={readOnly} wide={220} testid="set-msg-name" onCommit={(v) => patch({ senderName: v })} /></Row>
          <Row label="Sender number"><TextField value={cfg.senderNumber} disabled={readOnly} wide={180} testid="set-msg-number" onCommit={(v) => patch({ senderNumber: v })} /></Row>
          <Row label="Quiet hours start"><TextField value={cfg.quietStart} disabled={readOnly} wide={92} testid="set-msg-quiet-start" onCommit={(v) => patch({ quietStart: v })} /></Row>
          <Row label="Quiet hours end"><TextField value={cfg.quietEnd} disabled={readOnly} wide={92} testid="set-msg-quiet-end" onCommit={(v) => patch({ quietEnd: v })} /></Row>
          <Row label="Consent note" stack><TextField value={cfg.consentNote} disabled={readOnly} wide={420} testid="set-msg-consent" onCommit={(v) => patch({ consentNote: v })} /></Row>
        </div>
        <Banner tone="warn" testid="set-msg-warning">
          There is <b>no SMS gateway</b>. A template is filled in locally and you copy it by hand. Texting PHI needs a BAA with the
          carrier and a compliant opt-out process. This demo has neither, and the opt-out list below is a local record.
        </Banner>
      </Section>

      <Section
        title="Message templates"
        sub={`${cfg.templates.filter((t) => t.status === 'active').length} active of ${cfg.templates.length}`}
        testId="set-msg-templates"
        actions={<button className="btn btn-sm btn-primary" disabled={readOnly} data-testid="set-msg-add" onClick={() => setEditor({ name: '', category: 'appointment', body: '', status: 'draft' })}>{Icon.plus({ size: 12 })} New template</button>}
      >
        <DataTable
          testid="set-msg-table"
          empty="No templates yet."
          columns={[{ key: 'name', label: 'Template', width: '1.2fr' }, { key: 'cat', label: 'Category', width: '0.8fr' }, { key: 'body', label: 'Message', width: '2.4fr' }, { key: 'st', label: 'Status', width: '0.7fr' }, { key: 'act', label: '', width: '120px' }]}
          rows={cfg.templates}
          renderRow={(t) => (
            <div className="set-trow" key={t.id} data-testid={`set-msg-${t.id}`} style={{ gridTemplateColumns: '1.2fr 0.8fr 2.4fr 0.7fr 120px' }}>
              <span><b>{t.name}</b></span>
              <span className="muted">{MESSAGE_CATEGORIES.find((c) => c.id === t.category)?.label || t.category}</span>
              <span className="muted set-clip" title={t.body}>{t.body}</span>
              <span>{t.status === 'active' ? <span className="set-pill on">active</span> : t.status === 'draft' ? <span className="set-pill warn">draft</span> : <span className="set-pill">inactive</span>}</span>
              <span className="set-actions">
                <IconButton icon="eye" title="Preview" testid={`set-msg-preview-${t.id}`} onClick={() => setPreview(preview === t.id ? null : t.id)} />
                <IconButton icon="edit" title="Edit" disabled={readOnly} testid={`set-msg-edit-${t.id}`} onClick={() => setEditor({ ...t })} />
                <IconButton icon="copy" title="Copy rendered message" testid={`set-msg-copy-${t.id}`} onClick={() => { navigator.clipboard?.writeText(renderPreview(t.body)); toast({ message: 'Message copied to the clipboard. Nothing was sent.', kind: 'info' }) }} />
                <IconButton icon="trash" tone="danger" title="Remove" disabled={readOnly} testid={`set-msg-del-${t.id}`} onClick={() => { const res = actions.settingsOp('template.remove', { id: t.id }); toast({ message: res.msg, kind: res.ok ? 'ok' : 'warn' }) }} />
              </span>
            </div>
          )}
        />
        {preview && cfg.templates.find((t) => t.id === preview) && (
          <div className="set-msg-preview" data-testid="set-msg-preview-box">
            <b>Preview (rendered with real workspace values)</b>
            <p>{renderPreview(cfg.templates.find((t) => t.id === preview).body)}</p>
          </div>
        )}
        <p className="set-hint">Merge fields: {MERGE_FIELDS.join(' · ')}</p>
      </Section>

      <Section title="Opt-outs" sub={`${cfg.optOuts.length} number${cfg.optOuts.length === 1 ? '' : 's'} will never be messaged`} testId="set-msg-optouts">
        <DataTable
          testid="set-msg-optout-table"
          empty="No opt-outs recorded."
          columns={[{ key: 'phone', label: 'Number', width: '1fr' }, { key: 'name', label: 'Who', width: '1.2fr' }, { key: 'why', label: 'Reason', width: '1.2fr' }, { key: 'act', label: '', width: '60px' }]}
          rows={cfg.optOuts}
          renderRow={(o) => (
            <div className="set-trow" key={o.id} data-testid={`set-optout-${o.id}`} style={{ gridTemplateColumns: '1fr 1.2fr 1.2fr 60px' }}>
              <span><b>{o.phone}</b></span>
              <span className="muted">{o.name || '—'}</span>
              <span className="muted">{o.reason}</span>
              <span className="set-actions"><IconButton icon="trash" tone="danger" title="Remove opt-out" disabled={readOnly} testid={`set-optout-del-${o.id}`} onClick={() => { const res = actions.settingsOp('optout.remove', { id: o.id }); toast({ message: res.msg, kind: res.ok ? 'ok' : 'warn' }) }} /></span>
            </div>
          )}
        />
        <div className="set-inline" style={{ marginTop: 10 }}>
          <TextField value={optout.phone} onCommit={(v) => setOptout({ ...optout, phone: v })} placeholder="(408) 555-0100" wide={160} testid="set-optout-phone" />
          <TextField value={optout.name} onCommit={(v) => setOptout({ ...optout, name: v })} placeholder="Who (optional)" wide={180} testid="set-optout-name" />
          <button className="btn btn-sm" disabled={readOnly} data-testid="set-optout-add" onClick={() => {
            const res = actions.settingsOp('optout.add', optout)
            toast({ message: res.msg, kind: res.ok ? 'ok' : 'warn' })
            if (res.ok) setOptout({ phone: '', name: '', reason: 'Manually recorded' })
          }}>{Icon.plus({ size: 12 })} Add opt-out</button>
        </div>
      </Section>

      {editor && (
        <div className="set-editor" data-testid="set-msg-editor">
          <div className="set-editor-head"><b>{editor.id ? `Edit ${editor.name}` : 'New message template'}</b><button className="iconbtn" onClick={() => setEditor(null)} aria-label="Close">{Icon.x({ size: 13 })}</button></div>
          <div className="set-grid2">
            <Row label="Name *"><TextField value={editor.name} onCommit={(v) => setEditor({ ...editor, name: v })} wide={220} testid="set-msg-f-name" /></Row>
            <Row label="Category"><Select value={editor.category} wide={180} testid="set-msg-f-cat" options={MESSAGE_CATEGORIES.map((c) => ({ value: c.id, label: c.label }))} onChange={(v) => setEditor({ ...editor, category: v })} /></Row>
            <Row label="Status">
              <Select value={editor.status} wide={150} testid="set-msg-f-status" options={[{ value: 'draft', label: 'Draft' }, { value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }]} onChange={(v) => setEditor({ ...editor, status: v })} />
            </Row>
            <Row label="Message *" stack>
              <textarea className="input set-paste-area" rows={4} style={{ width: 460 }} value={editor.body} data-testid="set-msg-f-body" onChange={(e) => setEditor({ ...editor, body: e.target.value })} />
            </Row>
          </div>
          <div className="set-editor-foot">
            <button className="btn btn-sm" onClick={() => setEditor(null)}>Cancel</button>
            <button className="btn btn-sm btn-primary" disabled={readOnly} data-testid="set-msg-save" onClick={() => saveTemplate(editor)}>{editor.id ? 'Save template' : 'Add template'}</button>
          </div>
        </div>
      )}
    </>
  )
}

/* ── Subscription ─────────────────────────────────────────────────────────── */

export function SubscriptionPanel({ state, actions, toast, readOnly }) {
  const cfg = subscriptionCfg(state.settings)
  const [invoice, setInvoice] = useState({ date: todayISO(), amount: '', note: '' })
  const patch = (changes) => {
    const res = actions.settingsOp('subscription.patch', { patch: changes })
    toast({ message: res.msg, kind: res.ok ? 'ok' : 'warn' })
    return res
  }
  const addInvoice = () => {
    const amount = Number(invoice.amount)
    if (!(amount > 0)) { toast({ message: 'Enter a positive invoice amount', kind: 'warn' }); return }
    const next = [...(cfg.invoices || []), { id: `inv-${Date.now()}`, date: invoice.date, amount, note: invoice.note, recordedBy: state.currentAccount?.name || 'local user' }]
    const res = patch({ invoices: next })
    if (res.ok) { toast({ message: `Recorded a local invoice for $${amount.toFixed(2)}. Nothing was charged.`, kind: 'ok' }); setInvoice({ date: todayISO(), amount: '', note: '' }) }
  }
  const seatsUsed = (state.security?.accounts || []).filter((a) => a.status === 'active').length
  return (
    <>
      <Section
        title="Plan & seats"
        sub={`${seatsUsed} active account${seatsUsed === 1 ? '' : 's'} in this workspace`}
        testId="set-subscription"
        actions={<a className="btn btn-sm btn-primary" href={cfg.portalUrl} target="_blank" rel="noreferrer" data-testid="set-sub-portal">{Icon.expand({ size: 12 })} Open subscription portal</a>}
      >
        <div className="set-grid2">
          <Row label="Plan"><TextField value={cfg.plan} disabled={readOnly} wide={260} testid="set-sub-plan" onCommit={(v) => patch({ plan: v })} /></Row>
          <Row label="Status"><Select value={cfg.status} wide={150} disabled={readOnly} testid="set-sub-status" options={[{ value: 'active', label: 'Active' }, { value: 'trial', label: 'Trial' }, { value: 'past-due', label: 'Past due' }, { value: 'cancelled', label: 'Cancelled' }]} onChange={(v) => patch({ status: v })} /></Row>
          <Row label="Licensed seats"><NumberField value={cfg.seats} min={1} max={5000} disabled={readOnly} testid="set-sub-seats" onCommit={(v) => patch({ seats: v })} /></Row>
          <Row label="Billing cycle"><Select value={cfg.billingCycle} wide={150} disabled={readOnly} testid="set-sub-cycle" options={[{ value: 'monthly', label: 'Monthly' }, { value: 'annual', label: 'Annual' }, { value: 'quarterly', label: 'Quarterly' }]} onChange={(v) => patch({ billingCycle: v })} /></Row>
          <Row label="Renews on"><TextField value={cfg.renewsOn} disabled={readOnly} wide={130} testid="set-sub-renews" onCommit={(v) => patch({ renewsOn: v })} /></Row>
          <Row label="Billing contact"><TextField value={cfg.billingContact} disabled={readOnly} wide={260} testid="set-sub-contact" onCommit={(v) => patch({ billingContact: v })} /></Row>
          <Row label="Seat price (display only)"><NumberField value={cfg.monthly} min={0} max={100000} step={0.01} suffix="$/seat/mo" disabled={readOnly} testid="set-sub-price" onCommit={(v) => patch({ monthly: v })} /></Row>
        </div>
        <Banner tone="warn" testid="set-sub-note">
          Subscription billing is handled in Aloha’s portal, not here. This record is a <b>local note</b>. No card is charged and no
          invoice is issued. The portal link opens the real service in a new tab.
        </Banner>
      </Section>

      <Section title="Local invoice record" sub="Notes for reconciliation, not a billing document" testId="set-sub-invoices">
        <DataTable
          testid="set-sub-invoice-table"
          empty="No invoices recorded locally."
          columns={[{ key: 'date', label: 'Date', width: '0.8fr' }, { key: 'amount', label: 'Amount', width: '0.7fr', num: true }, { key: 'note', label: 'Note', width: '1.6fr' }, { key: 'who', label: 'Recorded by', width: '1fr' }, { key: 'act', label: '', width: '60px' }]}
          rows={(cfg.invoices || []).slice().reverse()}
          renderRow={(i) => (
            <div className="set-trow" key={i.id} data-testid={`set-sub-invoice-${i.id}`} style={{ gridTemplateColumns: '0.8fr 0.7fr 1.6fr 1fr 60px' }}>
              <span>{i.date}</span>
              <span className="num">${Number(i.amount).toFixed(2)}</span>
              <span className="muted">{i.note || '—'}</span>
              <span className="muted">{i.recordedBy}</span>
              <span className="set-actions"><IconButton icon="trash" tone="danger" title="Remove record" disabled={readOnly} testid={`set-sub-invoice-del-${i.id}`} onClick={() => patch({ invoices: cfg.invoices.filter((x) => x.id !== i.id) })} /></span>
            </div>
          )}
        />
        <div className="set-inline" style={{ marginTop: 10 }}>
          <TextField value={invoice.date} onCommit={(v) => setInvoice({ ...invoice, date: v })} wide={120} testid="set-sub-inv-date" />
          <TextField value={invoice.amount} onCommit={(v) => setInvoice({ ...invoice, amount: v })} placeholder="Amount" wide={110} testid="set-sub-inv-amount" />
          <TextField value={invoice.note} onCommit={(v) => setInvoice({ ...invoice, note: v })} placeholder="Note (period, PO…)" wide={220} testid="set-sub-inv-note" />
          <button className="btn btn-sm" disabled={readOnly} data-testid="set-sub-inv-add" onClick={addInvoice}>{Icon.plus({ size: 12 })} Record invoice</button>
        </div>
      </Section>
    </>
  )
}
