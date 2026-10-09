import React, { useMemo, useState } from 'react'
import { useStore } from '../state/store'
import { SectionBar } from './NavRail'
import { Icon } from '../ui/Icons'
import { useToast } from '../ui/Toast'
import { ACCESS_LABELS, SECURITY_AREAS, ROLE_TEMPLATES, resolveAccount, securityOffices } from '../lib/security'
import { uid } from '../lib/model'

const GROUPS = [
  { label: 'Clinical workflow', ids: ['calendar', 'clients', 'intake', 'staff', 'forms'] },
  { label: 'Operations & finance', ids: ['masters', 'billing', 'payroll', 'payrollQbo'] },
  { label: 'Insights & administration', ids: ['analytics', 'reports', 'dashboard', 'settings', 'security'] },
]
const ACCESS_KEYS = ['full', 'view', 'none']
const fmtWhen = (value) => {
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—'
}
const initials = (name = '') => String(name).trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'U'

function RoleEditor({ role, isNew, editable, assignedCount, onSave, onDelete, onCancel }) {
  const [draft, setDraft] = useState(() => ({ ...role, permissions: { ...role.permissions } }))
  const [template, setTemplate] = useState('')
  const [error, setError] = useState('')
  const templateRole = (id) => ROLE_TEMPLATES.find((item) => item.id === id)
  const applyTemplate = () => {
    const source = templateRole(template)
    if (!source) return
    setDraft((prev) => ({ ...prev, description: source.description, permissions: { ...source.permissions } }))
  }
  const change = (area, level) => setDraft((prev) => ({ ...prev, permissions: { ...prev.permissions, [area]: level } }))
  const save = () => {
    setError('')
    const result = onSave(draft)
    if (result?.ok) return
    setError(result?.msg || 'Could not save this role.')
  }
  const grouped = GROUPS.map((group) => ({
    ...group,
    areas: group.ids.map((id) => SECURITY_AREAS.find((area) => area.id === id)).filter(Boolean),
  }))

  return (
    <div className="sec-card sec-role-editor" data-testid="security-role-editor">
      <div className="sec-card-head">
        <div>
          <div className="sec-kicker">{isNew ? 'New role' : 'Role permissions'}</div>
          <h3>{isNew ? 'Create a role' : role.name}</h3>
        </div>
        <div className="sec-head-actions">
          {!isNew && !role.system && editable && assignedCount === 0 && (
            <button className="btn btn-sm btn-danger-soft" type="button" data-testid="security-role-delete" onClick={onDelete}>Delete role</button>
          )}
          {isNew && <button className="btn btn-sm" type="button" onClick={onCancel}>Cancel</button>}
        </div>
      </div>

      {role.system && !isNew && <div className="sec-system-note"><b>Protected role.</b> The built-in Administrator cannot be changed or removed, so there is always a way back in.</div>}

      <div className="sec-role-meta">
        <label className="sec-field"><span>Role name</span><input className="input" value={draft.name} maxLength={48} disabled={!editable || role.system} onChange={(e) => setDraft((prev) => ({ ...prev, name: e.target.value }))} data-testid="security-role-name" /></label>
        <label className="sec-field"><span>Description</span><input className="input" value={draft.description || ''} maxLength={180} disabled={!editable || role.system} onChange={(e) => setDraft((prev) => ({ ...prev, description: e.target.value }))} data-testid="security-role-description" /></label>
      </div>

      {editable && !role.system && (
        <div className="sec-template-row">
          <label className="sec-field"><span>Start from a template</span>
            <select className="input" value={template} onChange={(e) => setTemplate(e.target.value)} data-testid="security-role-template">
              <option value="">Choose a template…</option>
              {ROLE_TEMPLATES.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>
          <button className="btn btn-sm" type="button" disabled={!template} onClick={applyTemplate} data-testid="security-apply-template">Apply to draft</button>
        </div>
      )}

      <p className="sec-helper">Full access can view and change records. View only is read-only. No access hides the module and blocks its actions.</p>
      <div className="sec-perm-wrap">
        <table className="sec-perm-table" data-testid="security-permission-matrix">
          <thead><tr><th scope="col">Module</th><th scope="col">Includes</th>{ACCESS_KEYS.map((key) => <th scope="col" key={key}>{ACCESS_LABELS[key]}</th>)}</tr></thead>
          {grouped.map((group) => <tbody key={group.label}>
            <tr className="sec-group-row"><th colSpan={5} scope="rowgroup">{group.label}</th></tr>
            {group.areas.map((area) => <tr key={area.id} data-testid={`security-perm-row-${area.id}`}>
              <th scope="row">{area.label}</th><td>{area.description}</td>
              {ACCESS_KEYS.map((level) => <td key={level}>
                <label className="sec-radio-label" title={`${ACCESS_LABELS[level]} for ${area.label}`}>
                  <input type="radio" name={`permission-${role.id}-${area.id}`} value={level} checked={draft.permissions[area.id] === level} disabled={!editable || role.system} onChange={() => change(area.id, level)} data-testid={`security-perm-${area.id}-${level}`} aria-label={`${area.label}: ${ACCESS_LABELS[level]}`} />
                  <span className="sr-only">{ACCESS_LABELS[level]}</span>
                </label>
              </td>)}
            </tr>)}
          </tbody>)}
        </table>
      </div>
      {error && <div className="sec-error" role="alert" data-testid="security-role-error">{error}</div>}
      {editable && !role.system && <div className="sec-form-actions">
        <span className="muted">{isNew ? 'New roles start with no access until you grant it.' : `${assignedCount} account${assignedCount === 1 ? '' : 's'} assigned`}</span>
        <button className="btn btn-sm btn-primary" type="button" onClick={save} data-testid="security-role-save">{isNew ? 'Create role' : 'Save permissions'}</button>
      </div>}
    </div>
  )
}

function RoleTab({ state, editable }) {
  const { security, staff, actions } = state
  const toast = useToast()
  const [selectedId, setSelectedId] = useState(security.roles[0]?.id || '')
  const [newRole, setNewRole] = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const roles = security.roles
  const selected = roles.find((role) => role.id === selectedId) || roles[0]
  const assignments = useMemo(() => Object.fromEntries(roles.map((role) => [role.id, security.accounts.filter((account) => account.roleId === role.id).length])), [roles, security.accounts])

  const saveRole = (role) => {
    const operation = newRole ? 'role.create' : 'role.update'
    const result = actions.securityMutation(operation, { role: { ...role, id: newRole ? newRole.id : role.id } })
    if (result.ok) {
      setNewRole(null)
      setSelectedId(role.id)
      toast({ message: newRole ? `Role “${role.name}” created` : `Permissions for “${role.name}” saved`, kind: 'ok' })
      return result
    }
    return result
  }
  const startNew = () => {
    const role = { id: uid(), name: '', description: '', system: false, permissions: Object.fromEntries(SECURITY_AREAS.map((area) => [area.id, 'none'])) }
    setNewRole(role)
  }
  const deleteRole = () => {
    if (!selected) return
    if (!confirmDelete) { setConfirmDelete(true); return }
    const result = actions.securityMutation('role.delete', { id: selected.id })
    setConfirmDelete(false)
    if (result.ok) {
      toast({ message: `Role “${selected.name}” deleted`, kind: 'ok' })
      setSelectedId(roles.find((role) => role.id !== selected.id)?.id || '')
    } else toast({ message: result.msg, kind: 'warn' })
  }

  return (
    <div className="sec-layout sec-roles-layout">
      <aside className="sec-role-list sec-card" aria-label="User roles">
        <div className="sec-list-head"><div><b>User roles</b><span>{roles.length} configured</span></div>{editable && <button className="iconbtn" type="button" onClick={startNew} aria-label="Add user role" data-testid="security-add-role">{Icon.plus({ size: 14 })}</button>}</div>
        <div className="sec-role-items">
          {roles.map((role) => <button key={role.id} type="button" className={`sec-role-item ${!newRole && selected?.id === role.id ? 'on' : ''}`} onClick={() => { setNewRole(null); setConfirmDelete(false); setSelectedId(role.id) }} data-testid={`security-role-${role.id}`}>
            <span className="sec-role-avatar">{initials(role.name)}</span><span className="sec-role-name"><b>{role.name}</b><i>{role.description || 'Custom access profile'}</i></span><span className="sec-role-count">{assignments[role.id] || 0}</span>
          </button>)}
        </div>
        <div className="sec-list-foot"><span className="sec-dot" /> One protected Administrator role</div>
      </aside>

      <div className="sec-role-main">
        {newRole ? <RoleEditor key={newRole.id} role={newRole} isNew editable assignedCount={0} onSave={saveRole} onCancel={() => setNewRole(null)} /> : selected ? <RoleEditor key={selected.id} role={selected} isNew={false} editable={editable} assignedCount={assignments[selected.id] || 0} onSave={saveRole} onDelete={deleteRole} onCancel={() => {}} /> : <div className="sec-card sec-empty">No roles are configured.</div>}
        {confirmDelete && selected && <div className="sec-confirm" role="alertdialog" aria-label="Confirm role deletion">
          <div><b>Delete “{selected.name}”?</b><span>Only unassigned, non-system roles can be removed. This cannot be undone.</span></div>
          <button className="btn btn-sm btn-danger" type="button" onClick={deleteRole}>Confirm delete</button><button className="btn btn-sm" type="button" onClick={() => setConfirmDelete(false)}>Cancel</button>
        </div>}
      </div>
    </div>
  )
}

function AccountEditor({ account, isNew, staffOptions, roles, officeOptions = [], canEdit, onSave, onCancel }) {
  const [staffId, setStaffId] = useState(account?.staffId || '')
  const [roleId, setRoleId] = useState(account?.roleId || '')
  const [offices, setOffices] = useState(account?.officeIds?.filter((id) => id !== '*') || [])
  const [status, setStatus] = useState(account?.status || 'active')
  const [error, setError] = useState('')
  const selectedStaff = staffOptions.find((person) => person.id === staffId)
  const toggleOffice = (office) => setOffices((current) => current.includes(office) ? current.filter((value) => value !== office) : [...current, office])
  const save = () => {
    setError('')
    const payload = { id: account?.id || uid(), staffId, roleId, officeIds: offices, status }
    const result = onSave(payload)
    if (!result?.ok) setError(result?.msg || 'Could not save this account.')
  }

  return (
    <div className="sec-modal-backdrop" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="sec-modal" role="dialog" aria-modal="true" aria-labelledby="sec-account-title">
        <div className="sec-modal-head"><div><span className="sec-kicker">User account</span><h3 id="sec-account-title">{isNew ? 'Assign access to a staff member' : 'Edit account assignment'}</h3></div><button className="iconbtn" type="button" onClick={onCancel} aria-label="Close account editor">{Icon.x({ size: 14 })}</button></div>
        <div className="sec-form-grid">
          <label className="sec-field sec-field-wide"><span>Staff member</span>
            <select className="input" value={staffId} disabled={(!isNew && !!account?.staffId) || !canEdit} onChange={(e) => setStaffId(e.target.value)} data-testid="security-account-staff">
              <option value="">Choose staff…</option>{staffOptions.map((person) => <option key={person.id} value={person.id}>{person.name} · {person.role}</option>)}
            </select>
            {selectedStaff && <small>{selectedStaff.email}</small>}
          </label>
          <label className="sec-field"><span>Role</span><select className="input" value={roleId} disabled={!canEdit} onChange={(e) => setRoleId(e.target.value)} data-testid="security-account-role">
            <option value="">Choose a role…</option>{roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}
          </select></label>
          <label className="sec-field"><span>Account status</span><select className="input" value={status} disabled={!canEdit} onChange={(e) => setStatus(e.target.value)} data-testid="security-account-status"><option value="active">Active</option><option value="suspended">Suspended</option></select></label>
        </div>
        <fieldset className="sec-office-fieldset" disabled={!canEdit}>
          <legend>Office access <em>Choose at least one</em></legend>
          <div className="sec-office-grid">{officeOptions.map((office) => <label key={office} className={`sec-office-option ${offices.includes(office) ? 'on' : ''}`}>
            <input type="checkbox" checked={offices.includes(office)} onChange={() => toggleOffice(office)} data-testid={`security-office-${office.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`} />
            <span>{office}</span>
          </label>)}</div>
        </fieldset>
        {error && <div className="sec-error" role="alert" data-testid="security-account-error">{error}</div>}
        <div className="sec-modal-foot"><span className="muted">No password is stored here. This is a local demo access assignment.</span><button className="btn btn-sm" type="button" onClick={onCancel}>Cancel</button><button className="btn btn-sm btn-primary" type="button" disabled={!canEdit} onClick={save} data-testid="security-account-save">{isNew ? 'Create account' : 'Save assignment'}</button></div>
      </div>
    </div>
  )
}

function AccountTab({ state, editable }) {
  const { security, staff, actions, settings } = state
  const officeOptions = securityOffices(settings)
  const toast = useToast()
  const [query, setQuery] = useState('')
  const [editor, setEditor] = useState(null)
  const [selected, setSelected] = useState([])
  const [bulkOpen, setBulkOpen] = useState(false)
  const [bulkRole, setBulkRole] = useState('')
  const [bulkOffices, setBulkOffices] = useState([])
  const displayAccounts = useMemo(() => security.accounts.map((account) => resolveAccount(state, account)), [security.accounts, staff])
  const assignedStaff = new Set(security.accounts.map((account) => account.staffId).filter(Boolean))
  const staffOptions = staff.filter((person) => !assignedStaff.has(person.id))
  const roleById = Object.fromEntries(security.roles.map((role) => [role.id, role]))
  const userAccounts = displayAccounts.filter((account) => !query.trim() || `${account.name} ${account.email} ${account.jobTitle} ${roleById[account.roleId]?.name || ''} ${account.officeIds.join(' ')}`.toLowerCase().includes(query.trim().toLowerCase()))
  const toggleAccount = (id) => setSelected((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id])
  const visibleSelectable = userAccounts.filter((account) => !account.system && account.id !== state.currentAccount?.id).map((account) => account.id)
  const selectAll = () => setSelected(selected.length === visibleSelectable.length ? [] : visibleSelectable)
  const startCreate = () => {
    if (!staffOptions.length) { toast({ message: 'Every staff profile already has an account.', kind: 'info' }); return }
    setEditor({ account: null, isNew: true })
  }
  const saveAccount = (payload) => {
    const operation = editor?.isNew ? 'account.create' : 'account.update'
    const result = actions.securityMutation(operation, { account: payload })
    if (result.ok) {
      setEditor(null)
      toast({ message: editor?.isNew ? 'Staff account created' : 'Account assignment updated', kind: 'ok' })
    }
    return result
  }
  const preview = (account) => {
    const result = actions.switchDemoAccount(account.id)
    if (result.ok) toast({ message: `Previewing as ${account.name} · ${roleById[account.roleId]?.name || 'No role'}`, kind: 'info' })
    else toast({ message: result.msg, kind: 'warn' })
  }
  const suspend = (account) => {
    const result = actions.securityMutation('account.update', { account: { ...account, status: account.status === 'active' ? 'suspended' : 'active' } })
    if (!result.ok) toast({ message: result.msg, kind: 'warn' })
    else toast({ message: `${account.name} ${account.status === 'active' ? 'suspended' : 'reactivated'}`, kind: 'ok' })
  }
  const remove = (account) => {
    const result = actions.securityMutation('account.delete', { id: account.id })
    if (!result.ok) toast({ message: result.msg, kind: 'warn' })
    else { setSelected((current) => current.filter((id) => id !== account.id)); toast({ message: `Account for ${account.name} removed`, kind: 'ok' }) }
  }
  const assignBulk = () => {
    if (!bulkRole || !bulkOffices.length) { toast({ message: 'Choose a role and at least one office.', kind: 'warn' }); return }
    const results = selected.map((id) => {
      const account = security.accounts.find((item) => item.id === id)
      return account ? actions.securityMutation('account.update', { account: { ...account, roleId: bulkRole, officeIds: bulkOffices } }) : { ok: false }
    })
    const failures = results.filter((item) => !item.ok)
    if (failures.length) toast({ message: `${results.length - failures.length} of ${results.length} assignments saved. ${failures[0].msg || 'Review failed rows.'}`, kind: 'warn' })
    else toast({ message: `Updated role and office assignment for ${results.length} account${results.length === 1 ? '' : 's'}`, kind: 'ok' })
    setBulkOpen(false)
    setSelected([])
  }

  return (
    <>
      <div className="sec-card sec-account-card">
        <div className="sec-account-tools">
          <div><h3>User accounts</h3><p>Each account is linked to a staff profile and holds its role and office assignments.</p></div>
          <div className="sec-account-actions"><label className="sec-search"><span className="sr-only">Search accounts</span>{Icon.search({ size: 14 })}<input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search people, roles, offices…" data-testid="security-account-search" /></label>
            {editable && <button className="btn btn-sm btn-primary" type="button" onClick={startCreate} data-testid="security-add-account">{Icon.plus({ size: 12 })} Add staff account</button>}
          </div>
        </div>
        {editable && selected.length > 0 && <div className="sec-bulkbar"><b>{selected.length} selected</b><span className="muted">Apply a role and office assignment together.</span><button className="btn btn-sm" type="button" onClick={() => { setBulkRole(''); setBulkOffices([]); setBulkOpen(true) }} data-testid="security-bulk-assign">Assign office(s) &amp; role</button><button className="btn btn-sm btn-ghost" type="button" onClick={() => setSelected([])}>Clear</button></div>}
        <div className="sec-table-wrap"><table className="sec-account-table" data-testid="security-account-table">
          <thead><tr>{editable && <th className="sec-checkcol"><input type="checkbox" aria-label="Select all eligible accounts" checked={visibleSelectable.length > 0 && visibleSelectable.every((id) => selected.includes(id))} onChange={selectAll} /> </th>}<th>Account</th><th>Job title</th><th>Role</th><th>Office access</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>{userAccounts.map((account) => <tr key={account.id} data-testid={`security-account-row-${account.id}`}>
            {editable && <td className="sec-checkcol">{!account.system && account.id !== state.currentAccount?.id && <input type="checkbox" aria-label={`Select ${account.name}`} checked={selected.includes(account.id)} onChange={() => toggleAccount(account.id)} data-testid={`security-account-check-${account.id}`} />}</td>}
            <td><div className="sec-person"><span className={`sec-person-avatar ${account.status === 'suspended' ? 'off' : ''}`}>{initials(account.name)}</span><span><b>{account.name}</b><i>{account.email}</i></span></div></td>
            <td>{account.jobTitle || '—'}</td>
            <td><span className="sec-role-pill">{roleById[account.roleId]?.name || 'Role missing'}</span></td>
            <td><div className="sec-office-chips">{account.officeIds.includes('*') ? <span className="sec-chip sec-chip-all">All offices</span> : account.officeIds.map((office) => <span className="sec-chip" key={office}>{office}</span>)}</div></td>
            <td><span className={`sec-status ${account.status}`}><i />{account.status === 'active' ? 'Active' : 'Suspended'}</span></td>
            <td><div className="sec-row-actions">
              <button className="btn btn-xs" type="button" onClick={() => preview(account)} data-testid={`security-preview-${account.id}`} title="Switch the local demo preview to this role">Preview</button>
              {editable && !account.system && account.id !== state.currentAccount?.id && <>
                <button className="btn btn-xs" type="button" onClick={() => setEditor({ account, isNew: false })} data-testid={`security-edit-${account.id}`}>Edit</button>
                <button className="iconbtn sec-remove" type="button" aria-label={`Remove ${account.name}`} onClick={() => remove(account)} data-testid={`security-delete-${account.id}`}>{Icon.trash({ size: 12 })}</button>
              </>}
            </div></td>
          </tr>)}
          {!userAccounts.length && <tr><td colSpan={editable ? 7 : 6} className="sec-no-results">No accounts match this search.</td></tr>}
          </tbody>
        </table></div>
        <div className="sec-table-foot"><span>{security.accounts.length} accounts · {security.accounts.filter((account) => account.status === 'active').length} active</span><span>{staffOptions.length} staff profile{staffOptions.length === 1 ? '' : 's'} available to provision</span></div>
      </div>

      <details className="sec-audit sec-card">
        <summary><span><b>Recent access changes</b><i>Role and account assignment audit · last {security.audit.length} events</i></span>{Icon.chevronR({ size: 13 })}</summary>
        <div className="sec-audit-list">
          {security.audit.length ? security.audit.slice().reverse().slice(0, 20).map((event) => {
            const actor = displayAccounts.find((account) => account.id === event.actorId)?.name || 'System'
            return <div className="sec-audit-row" key={event.id}><span className="sec-audit-dot" /><span><b>{event.action.replaceAll('.', ' ')}</b><i>{event.detail}</i></span><small>{actor} · {fmtWhen(event.at)}</small></div>
          }) : <p className="muted">No access changes have been recorded in this workspace yet.</p>}
        </div>
      </details>

      {editor && <AccountEditor account={editor.account} isNew={editor.isNew} officeOptions={officeOptions} staffOptions={editor.isNew || !editor.account?.staffId ? staffOptions : staff} roles={security.roles} canEdit={editable} onSave={saveAccount} onCancel={() => setEditor(null)} />}
      {bulkOpen && <div className="sec-modal-backdrop" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && setBulkOpen(false)}><div className="sec-modal" role="dialog" aria-modal="true" aria-labelledby="sec-bulk-title">
        <div className="sec-modal-head"><div><span className="sec-kicker">Bulk assignment</span><h3 id="sec-bulk-title">Assign office(s) &amp; role</h3></div><button className="iconbtn" type="button" aria-label="Close" onClick={() => setBulkOpen(false)}>{Icon.x({ size: 14 })}</button></div>
        <label className="sec-field"><span>Role for {selected.length} accounts</span><select className="input" value={bulkRole} onChange={(e) => setBulkRole(e.target.value)} data-testid="security-bulk-role"><option value="">Choose a role…</option>{security.roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}</select></label>
        <fieldset className="sec-office-fieldset"><legend>Office access <em>Choose at least one</em></legend><div className="sec-office-grid">{officeOptions.map((office) => <label key={office} className={`sec-office-option ${bulkOffices.includes(office) ? 'on' : ''}`}><input type="checkbox" checked={bulkOffices.includes(office)} onChange={() => setBulkOffices((current) => current.includes(office) ? current.filter((value) => value !== office) : [...current, office])} />{office}</label>)}</div></fieldset>
        <div className="sec-modal-foot"><span className="muted">Protected administrator accounts are excluded.</span><button className="btn btn-sm" type="button" onClick={() => setBulkOpen(false)}>Cancel</button><button className="btn btn-sm btn-primary" type="button" onClick={assignBulk} data-testid="security-bulk-save">Apply assignments</button></div>
      </div></div>}
    </>
  )
}

export default function SecurityView({ embedded = false }) {
  const state = useStore()
  const { ui, actions, security, settings } = state
  const officeOptions = securityOffices(settings)
  const tab = ['accounts', 'roles'].includes(ui.securityTab) ? ui.securityTab : 'accounts'
  const editable = state.canAccess('security', 'full')
  const setTab = (value) => actions.setUI({ securityTab: value })
  const activeAccounts = security.accounts.filter((account) => account.status === 'active').length

  return (
    <div className={embedded ? 'sec-page sec-embed' : 'sectionpage sec-page'} data-testid="security-page">
      {!embedded && (
        <SectionBar icon="shield" title="Security" sub="Roles and staff account assignments">
          <span className="sec-current-role"><i /> Previewing: <b>{state.currentAccount?.name || 'No active account'}</b><span>· {state.currentRole?.name || 'No role'}</span></span>
        </SectionBar>
      )}
      <div className="sec-demo-banner" role="note" data-testid="security-demo-warning">
        <span className="sec-demo-icon">{Icon.alert({ size: 14 })}</span><span><b>Local demo access controls, not authentication.</b> Permissions apply only in this browser. There are no passwords and no server-side identity checks. Do not use this for real client data.</span>
      </div>
      <div className="sec-tabs" role="tablist" aria-label="Security settings">
        {!embedded && (
          <>
            <button type="button" role="tab" aria-selected={tab === 'accounts'} className={tab === 'accounts' ? 'on' : ''} onClick={() => setTab('accounts')} data-testid="security-tab-accounts">User Accounts <span>{activeAccounts}</span></button>
            <button type="button" role="tab" aria-selected={tab === 'roles'} className={tab === 'roles' ? 'on' : ''} onClick={() => setTab('roles')} data-testid="security-tab-roles">User Roles <span>{security.roles.length}</span></button>
          </>
        )}
        <span className="sec-current-role" style={{ marginLeft: embedded ? 0 : 'auto' }}><i /> Previewing: <b>{state.currentAccount?.name || 'No active account'}</b><span>· {state.currentRole?.name || 'No role'}</span></span>
        {!editable && <span className="sec-view-pill">View only</span>}
      </div>
      <div className="sec-content" role="tabpanel">
        {tab === 'accounts' ? <AccountTab state={state} editable={editable} /> : <RoleTab state={state} editable={editable} />}
      </div>
    </div>
  )
}
