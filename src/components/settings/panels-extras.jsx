import React, { useState } from 'react'
import { Icon } from '../../ui/Icons'
import { Section, Row, TextField, NumberField, Select, Toggle, Banner, Empty, DataTable, IconButton } from './kit'
import { svcList, cfTypeLabel } from '../../lib/master'
import {
  integrationsCfg, INTEGRATION_STATUSES, messagesCfg, MESSAGE_CATEGORIES, MERGE_FIELDS,
  subscriptionCfg, notificationsCfg, settingsOffices, earningCodes, isCancelStatus,
} from '../../lib/settingsMasters'
import { downloadDoc } from '../../lib/exportKit'
import { todayISO } from '../../lib/date'
import { buildICS, download as downloadText } from '../../lib/ics'
import { ACCESS_LABELS, SECURITY_AREAS } from '../../lib/security'
import SecurityView from '../SecurityView'

/* ── Services (the master lives in Masters; this is its Settings home) ─────── */

export function ServicesPanel({ state, actions, toast, readOnly }) {
  const svcs = svcList(state)
  const appts = Object.values(state.appts || {})
  const usage = (sv) => appts.filter((a) => a.service === sv.id).length
  const contracted = (sv) => (state.payers || []).filter((p) => (p.services || []).includes(sv.id) || (p.svcOv || {})[sv.id]).length
  return (
    <Section
      title="Service types"
      sub={`${svcs.filter((s) => s.status !== 'inactive').length} active of ${svcs.length} · ${(state.payers || []).length} payers`}
      testId="set-services"
      actions={<button className="btn btn-sm btn-primary" data-testid="set-services-open" onClick={() => { actions.setUI({ section: 'masters', mastersTab: 'svcs', payerSel: null, settings: false }) }}>{Icon.edit({ size: 12 })} Open the service master</button>}
    >
      <DataTable
        testid="set-services-table"
        empty="No service types on file."
        columns={[
          { key: 'label', label: 'Service', width: '1.6fr' }, { key: 'code', label: 'Billing code', width: '0.8fr' },
          { key: 'unit', label: 'Unit', width: '0.6fr', num: true }, { key: 'rate', label: 'Rate', width: '0.6fr', num: true },
          { key: 'cred', label: 'Credentials', width: '1fr' }, { key: 'pay', label: 'Payers', width: '0.6fr', num: true },
          { key: 'appt', label: 'Appts', width: '0.6fr', num: true }, { key: 'st', label: 'Status', width: '0.7fr' },
        ]}
        rows={svcs}
        renderRow={(sv) => (
          <div className={`set-trow ${sv.status === 'inactive' ? 'off' : ''}`} key={sv.id} data-testid={`set-service-${sv.id}`} style={{ gridTemplateColumns: '1.6fr 0.8fr 0.6fr 0.6fr 1fr 0.6fr 0.6fr 0.7fr' }}>
            <span><b>{sv.label}</b><i className="set-sub">{sv.rounding || 'AMA'} rounding</i></span>
            <span className="muted">{sv.code}</span>
            <span className="num">{sv.unitMins || 30}</span>
            <span className="num">${Number(sv.rate || 0).toFixed(2)}</span>
            <span className="muted">{(sv.credentials || []).join(', ') || '—'}</span>
            <span className="num">{contracted(sv)}</span>
            <span className="num">{usage(sv)}</span>
            <span>{sv.status === 'inactive' ? <span className="set-pill">inactive</span> : <span className="set-pill on">active</span>}</span>
          </div>
        )}
      />
      <p className="set-hint">
        Service types feed the appointment wizard, quick-add, rate cards and every claim line. Editing them here would duplicate the
        master, so the full editor lives in one place — Masters → Service Types — and this panel is its Settings entry point.
      </p>
    </Section>
  )
}

export function CustomFieldsPanel({ state, actions, toast, readOnly }) {
  const defs = state.customFields || []
  const picks = Object.values(state.appts || {}).reduce((t, a) => t + Object.keys(a.pcfs || {}).length, 0)
  return (
    <Section
      title="Appointment custom fields"
      sub={`${defs.filter((d) => d.status !== 'inactive').length} active of ${defs.length} · ${picks} values captured on appointments`}
      testId="set-custom-fields"
      actions={<button className="btn btn-sm btn-primary" data-testid="set-cf-open" onClick={() => { actions.setUI({ section: 'masters', mastersTab: 'cfdefs', payerSel: null, settings: false }) }}>{Icon.edit({ size: 12 })} Open the custom-field master</button>}
    >
      <DataTable
        testid="set-cf-table"
        empty="No custom fields defined."
        columns={[
          { key: 'label', label: 'Field', width: '1.5fr' }, { key: 'type', label: 'Type', width: '0.9fr' },
          { key: 'req', label: 'Required', width: '0.7fr' }, { key: 'opt', label: 'Options', width: '1.4fr' }, { key: 'st', label: 'Status', width: '0.8fr' },
        ]}
        rows={defs}
        renderRow={(d) => (
          <div className={`set-trow ${d.status === 'inactive' ? 'off' : ''}`} key={d.id} data-testid={`set-cf-${d.id}`} style={{ gridTemplateColumns: '1.5fr 0.9fr 0.7fr 1.4fr 0.8fr' }}>
            <span><b>{d.label}</b>{d.note ? <i className="set-sub">{d.note}</i> : null}</span>
            <span className="muted">{cfTypeLabel ? cfTypeLabel(d.type) : d.type}</span>
            <span>{d.required ? <span className="set-pill warn">required</span> : <span className="set-pill">optional</span>}</span>
            <span className="muted">{(d.options || []).slice(0, 4).join(', ') || '—'}</span>
            <span>{d.status === 'inactive' ? <span className="set-pill">inactive</span> : <span className="set-pill on">active</span>}</span>
          </div>
        )}
      />
      <Banner tone="info" testid="set-cf-note">
        Custom fields are <b>opt-in</b>: nothing is pre-loaded on an appointment. A payer only sees the fields its profile picked.
        The full editor (types, options, required flags, signatures) is Masters → Custom Fields.
      </Banner>
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
          This is browser-local role-based access, <b>not authentication</b>. Passwords are never stored, and nothing here is
          server-side authorization or HIPAA compliance. Accounts are local demo previews.
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
          scope. The editor below is the whole workspace: permission matrix, bulk assignment and the role library.
        </p>
      </Section>
      <Section title={tab === 'roles' ? 'Role editor & assignment' : 'Account editor'} sub="Everything the standalone Security workspace could do, in place" testId="set-security-workspace">
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
      downloadDoc(`aloha-aba-calendar-${todayISO()}.ics`, buildICS(appts, staffById, clientsById, (k) => isCancelStatus(settings, k)), 'text/calendar;charset=utf-8')
      const res = actions.settingsOp('integration.ran', { id: row.id, who: state.currentAccount?.name })
      toast({ message: res.msg || `Exported ${appts.length} upcoming events to .ics`, kind: 'ok' })
      return
    }
    if (row.id === 'int-qbo') { actions.setUI({ section: 'bil-qbo', settings: false }); return }
    if (row.id === 'int-telehealth') {
      downloadDoc(`aloha-telehealth-room-${todayISO()}.txt`, `Telehealth room link for ${state.settings.org?.name || 'the practice'}\n\n${row.roomUrl || '(set a room URL in this panel)'}\n\nThis file is a reference card only — no session is recorded.\n`, 'text/plain;charset=utf-8')
      const res = actions.settingsOp('integration.ran', { id: row.id, who: state.currentAccount?.name })
      toast({ message: res.msg || 'Reference card downloaded', kind: 'ok' })
      return
    }
    toast({ message: `${row.name} has no local artifact — it is a documented seam, not a connection.`, kind: 'warn' })
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
                    <Row label="Telehealth room URL"><TextField value={row.roomUrl} disabled={readOnly} wide={260} testid="set-integration-room" onCommit={(v) => patch(row.id, { roomUrl: v })} /></Row>
                  )}
                  <Row label="Internal note" stack><TextField value={row.note} disabled={readOnly} wide={420} testid="set-integration-note" onCommit={(v) => patch(row.id, { note: v })} /></Row>
                </div>
              </>
            ) : <Empty testid="set-integrations-none">No integrations configured.</Empty>}
          </div>
        </div>
        <Banner tone="warn" testid="set-integrations-note">
          Nothing here opens a network connection. What exists is real <b>local export</b> (ICS feed, QuickBooks CSV, backup JSON);
          EMR/FHIR, clearinghouse and eligibility rows are documented seams kept honest by their status — there is no live EDI or
          API traffic in this demo.
        </Banner>
      </Section>
    </>
  )
}

/* ── Text messaging ───────────────────────────────────────────────────────── */

export function MessagingPanel({ state, actions, toast, readOnly }) {
  const cfg = messagesCfg(state.settings)
  const [editor, setEditor] = useState(null)
  const [optout, setOptout] = useState({ phone: '', name: '', reason: 'Replied STOP' })
  const [preview, setPreview] = useState(null)
  const patch = (changes) => {
    const res = actions.settingsOp('messaging.patch', { patch: changes })
    toast({ message: res.msg, kind: res.ok ? 'ok' : 'warn' })
    return res
  }
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
      <Section title="Sending identity" sub="Who the message says it is from" testId="set-msg-sender">
        <div className="set-grid2">
          <Row label="Texting enabled" hint="Off by default — this demo never transmits messages"><Toggle on={!!cfg.enabled} disabled={readOnly} testid="set-msg-enabled" onChange={(v) => patch({ enabled: v })} /></Row>
          <Row label="Sender name"><TextField value={cfg.senderName} disabled={readOnly} wide={220} testid="set-msg-name" onCommit={(v) => patch({ senderName: v })} /></Row>
          <Row label="Sender number"><TextField value={cfg.senderNumber} disabled={readOnly} wide={180} testid="set-msg-number" onCommit={(v) => patch({ senderNumber: v })} /></Row>
          <Row label="Quiet hours start"><TextField value={cfg.quietStart} disabled={readOnly} wide={92} testid="set-msg-quiet-start" onCommit={(v) => patch({ quietStart: v })} /></Row>
          <Row label="Quiet hours end"><TextField value={cfg.quietEnd} disabled={readOnly} wide={92} testid="set-msg-quiet-end" onCommit={(v) => patch({ quietEnd: v })} /></Row>
          <Row label="Consent note" stack><TextField value={cfg.consentNote} disabled={readOnly} wide={420} testid="set-msg-consent" onCommit={(v) => patch({ consentNote: v })} /></Row>
        </div>
        <Banner tone="warn" testid="set-msg-warning">
          There is <b>no SMS gateway</b> here: a template renders locally and is copied by hand. Sending PHI by text requires a BAA
          with the carrier and a compliant opt-out process — this demo does neither, and the opt-out list below is a local record.
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
                <IconButton icon="copy" title="Copy rendered message" testid={`set-msg-copy-${t.id}`} onClick={() => { navigator.clipboard?.writeText(renderPreview(t.body)); toast({ message: 'Rendered message copied — nothing was sent', kind: 'info' }) }} />
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
    if (res.ok) { toast({ message: `Recorded a local invoice for $${amount.toFixed(2)} — nothing was charged`, kind: 'ok' }); setInvoice({ date: todayISO(), amount: '', note: '' }) }
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
          Subscription billing lives in Aloha’s portal, not in this workspace. The record here is a <b>local note</b> — no card is
          charged, no invoice is issued, and the portal link opens the real service in a new tab.
        </Banner>
      </Section>

      <Section title="Local invoice record" sub="Notes for reconciliation — not a billing document" testId="set-sub-invoices">
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
