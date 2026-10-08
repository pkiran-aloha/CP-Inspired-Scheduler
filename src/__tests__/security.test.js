import { beforeEach, describe, expect, it } from 'vitest'
import { blankState, reducer } from '../state/store'
import {
  ACCESS_LEVELS,
  SECURITY_AREAS,
  SECURITY_OFFICES,
  ROLE_TEMPLATES,
  applySecurityChange,
  authorizeAction,
  canAccess,
  canAccessRecord,
  canAccessSection,
  currentAccount,
  firstAccessibleSection,
  defaultSecurity,
  normalizeSecurity,
  officeForValue,
  scopeWorkspaceToAccount,
  validateSecurityConfig,
} from '../lib/security'
import { BACKUP_FORMAT, readWorkspaceBackup, workspaceData } from '../lib/workspaceBackup'

beforeEach(() => localStorage.clear())

function asRole(state, roleId, accountId = 'account-s3') {
  return {
    ...state,
    security: {
      ...state.security,
      currentUserId: accountId,
      accounts: state.security.accounts.map((account) => account.id === accountId ? { ...account, roleId } : account),
    },
  }
}

describe('local demo RBAC configuration', () => {
  it('starts with least-privilege role templates and valid staff-linked demo accounts', () => {
    const state = blankState()
    expect(ACCESS_LEVELS).toEqual(['full', 'view', 'none'])
    expect(state.security.roles.map((role) => role.name)).toContain('Administrator')
    expect(state.security.roles.find((role) => role.id === 'clinician').permissions.billing).toBe('none')
    expect(state.security.accounts.some((account) => account.staffId === 's1')).toBe(true)
    expect(SECURITY_OFFICES).toEqual(expect.arrayContaining(['Main Center', 'North Clinic', 'Remote / telehealth']))
    expect(validateSecurityConfig(state.security, state.staff)).toBe(true)
  })

  it('normalizes the protected recovery account/role and falls back from invalid or suspended sessions', () => {
    const state = blankState()
    const damaged = structuredClone(state.security)
    const administrator = damaged.roles.find((role) => role.id === 'administrator')
    administrator.system = false
    administrator.name = 'renamed'
    administrator.permissions.security = 'none'
    damaged.accounts = damaged.accounts.filter((account) => account.id !== 'account-demo-admin')
    damaged.currentUserId = 'missing'

    const fixed = normalizeSecurity(damaged, state.staff)
    expect(fixed.currentUserId).toBe('account-demo-admin')
    expect(fixed.roles.find((role) => role.id === 'administrator')).toMatchObject({ name: 'Administrator', system: true })
    expect(SECURITY_AREAS.every(({ id }) => fixed.roles[0].permissions[id] === 'full')).toBe(true)
    expect(fixed.accounts[0]).toMatchObject({ id: 'account-demo-admin', name: 'Admin', status: 'active', system: true, officeIds: ['*'] })

    const suspended = { ...fixed, accounts: fixed.accounts.map((account) => account.id === 'account-demo-admin' ? { ...account, status: 'suspended' } : account) }
    expect(normalizeSecurity(suspended, state.staff).currentUserId).toBe('account-demo-admin')
  })

  it('requires full access to affected modules for reset and full-workspace restore actions', () => {
    const state = blankState()
    const permissions = Object.fromEntries(SECURITY_AREAS.map(({ id }) => [id, 'none']))
    permissions.settings = 'full'
    permissions.security = 'full'
    state.security.roles = [...state.security.roles, { id: 'workspace-operator', name: 'Workspace Operator', system: false, permissions }]
    state.security.accounts = state.security.accounts.map((account) => account.id === 'account-demo-admin' ? { ...account, roleId: 'workspace-operator' } : account)

    expect(authorizeAction(state, { type: 'clearDemo' })).toMatchObject({ ok: false, msg: expect.stringMatching(/Schedule/) })
    expect(authorizeAction(state, { type: 'reseed' })).toMatchObject({ ok: false, msg: expect.stringMatching(/Schedule/) })
    expect(authorizeAction(state, { type: 'replace', payload: {} })).toMatchObject({ ok: false, msg: expect.stringMatching(/Schedule/) })
  })

  it('lands on the Dashboard first, or the first section the role may open', () => {
    const state = blankState()
    expect(firstAccessibleSection(state)).toBe('dashboard')
    const permissions = Object.fromEntries(SECURITY_AREAS.map(({ id }) => [id, 'none']))
    permissions.clients = 'view'
    permissions.billing = 'view'
    state.security.roles = [...state.security.roles, { id: 'no-dash', name: 'No Dashboard', system: false, permissions }]
    expect(firstAccessibleSection(asRole(state, 'no-dash'))).toBe('clients')
  })

  it('checks read versus write access, denies unknown routes/actions, and protects unrelated modules', () => {
    const state = asRole(blankState(), 'read-only')
    expect(currentAccount(state).name).toBe('Saija Kotha') // account display follows the linked staff profile
    expect(canAccess(state, 'billing', 'view')).toBe(true)
    expect(canAccess(state, 'billing', 'full')).toBe(false)
    expect(canAccess(state, 'not-a-module', 'view')).toBe(false)
    expect(canAccessSection(state, 'billing')).toBe(true)
    expect(canAccessSection(state, 'not-a-route')).toBe(false)
    expect(authorizeAction(state, { type: 'setUI', patch: { section: 'billing' } }).ok).toBe(true)
    expect(authorizeAction(state, { type: 'claimsTx' })).toMatchObject({ ok: false })
    expect(authorizeAction(state, { type: 'upsertMany', appts: [] })).toMatchObject({ ok: false })
    expect(authorizeAction(state, { type: 'setUI', patch: { section: 'unmapped-route' } })).toMatchObject({ ok: false })
    expect(authorizeAction(state, { type: 'futureSensitiveMutation' })).toMatchObject({ ok: false })
  })
})

describe('account and role validation', () => {
  it('creates roles/accounts with audited assignments and validates unique staff/email/office links', () => {
    const state = blankState()
    const role = { id: 'custom-ops', name: 'Operations', description: 'Operations access', permissions: Object.fromEntries(SECURITY_AREAS.map(({ id }) => [id, 'none'])) }
    role.permissions.payroll = 'view'
    const roleResult = applySecurityChange(state.security, 'role.create', { role, staff: state.staff }, state.security.currentUserId, 100)
    expect(roleResult.ok).toBe(true)
    expect(roleResult.security.audit.at(-1)).toMatchObject({ action: 'role.created', targetId: 'custom-ops', at: 100 })

    const account = { id: 'custom-account', staffId: 's2', roleId: role.id, officeIds: ['North Clinic'], status: 'active' }
    const accountResult = applySecurityChange(roleResult.security, 'account.create', { account, staff: state.staff }, state.security.currentUserId, 101)
    expect(accountResult.ok).toBe(true)
    expect(accountResult.security.accounts.find((item) => item.id === account.id)).toMatchObject({ name: state.staff.find((person) => person.id === 's2').name, officeIds: ['North Clinic'] })
    expect(accountResult.security.audit.at(-1).action).toBe('account.created')
    expect(validateSecurityConfig(accountResult.security, state.staff)).toBe(true)

    expect(applySecurityChange(roleResult.security, 'account.create', { account: { ...account, id: 'duplicate-staff', staffId: 's1' }, staff: state.staff }).msg).toMatch(/already has an account/)
    expect(applySecurityChange(roleResult.security, 'account.create', { account: { ...account, id: 'unknown-office', officeIds: ['Mars'] }, staff: state.staff }).msg).toMatch(/configured office/)
    expect(applySecurityChange(roleResult.security, 'role.create', { role: { ...role, id: 'duplicate-role', name: 'operations' }, staff: state.staff }).msg).toMatch(/already exists/)
  })

  it('protects the Administrator role/account and disables staff-linked accounts when a staff profile is removed', () => {
    const state = blankState()
    expect(applySecurityChange(state.security, 'role.update', { role: state.security.roles[0], staff: state.staff }).msg).toMatch(/protected/)
    expect(applySecurityChange(state.security, 'account.update', { account: { ...state.security.accounts[0], name: 'Changed' }, staff: state.staff }).msg).toMatch(/protected/)
    expect(applySecurityChange(state.security, 'account.update', { account: { ...state.security.accounts.find((item) => item.id === 'account-s3') }, staff: state.staff }, 'account-s3').msg).toMatch(/another Security administrator/)
    expect(applySecurityChange(state.security, 'account.delete', { id: 'account-s3', staff: state.staff }, 'account-s3').msg).toMatch(/own access account/)

    const activeClinician = { ...state, security: { ...state.security, currentUserId: 'account-s3' } }
    const removed = reducer(activeClinician, { type: 'roster', list: 'staff', mode: 'remove', id: 's3' })
    const revoked = removed.security.accounts.find((account) => account.id === 'account-s3')
    expect(removed.staff.some((person) => person.id === 's3')).toBe(false)
    expect(revoked).toMatchObject({ staffId: null, status: 'suspended' })
    expect(removed.security.currentUserId).toBe('account-demo-admin')
    expect(removed.security.audit.at(-1).action).toBe('account.suspended.staff-removed')
    expect(validateSecurityConfig(removed.security, removed.staff)).toBe(true)
  })
})

describe('office-scoped data access', () => {
  it('filters related schedule/client/staff data and denies cross-office writes by default', () => {
    const state = asRole(blankState(), 'clinician')
    expect(officeForValue('Northside Center')).toBe('North Clinic')
    const main = state.clients.find((client) => client.id === 'c1')
    const north = state.clients.find((client) => client.id === 'c3')
    expect(canAccessRecord(state, 'client', main)).toBe(true)
    expect(canAccessRecord(state, 'client', north)).toBe(false)
    expect(canAccessRecord(state, 'client', { id: 'unassigned-client', home: 'Unknown office' })).toBe(false)

    const crossOfficeAppt = { id: 'cross-office', location: 'North Clinic', clientIds: ['c3'], staffIds: ['s3'] }
    state.appts[crossOfficeAppt.id] = crossOfficeAppt
    expect(canAccessRecord(state, 'appointment', crossOfficeAppt)).toBe(false)
    expect(authorizeAction(state, { type: 'upsertMany', appts: [crossOfficeAppt] })).toMatchObject({ ok: false, msg: expect.stringMatching(/office scope/) })
    const northStaff = { id: 'staff-north-only', name: 'North Staff', office: 'North Clinic' }
    state.staff.push(northStaff)
    state.teams.push({ id: 'team-north-only', office: 'North Clinic', staffIds: [northStaff.id], clientIds: ['c3'] })
    state.ui = { ...state.ui, staffSel: ['s3', northStaff.id], clientSel: ['c1', 'c3'], teamSel: ['team-north-only'] }
    state.history = [{ __workspaceSnapshot: true, clients: state.clients }]
    const visible = scopeWorkspaceToAccount(state)
    expect(visible.clients.some((client) => client.id === 'c1')).toBe(true)
    expect(visible.clients.some((client) => client.id === 'c3')).toBe(false)
    expect(visible.appts[crossOfficeAppt.id]).toBeUndefined()
    expect(visible.history).toEqual([])
    expect(visible.ui.staffSel).toEqual(['s3'])
    expect(visible.ui.clientSel).toEqual(['c1'])
    expect(visible.ui.teamSel).toEqual([])

    const inOfficeAppt = { id: 'inside-office', location: 'Main Center', staffIds: ['s3'], clientIds: ['c1'] }
    state.appts[inOfficeAppt.id] = { ...inOfficeAppt, title: 'Updated title' }
    state.history = [{ __workspaceSnapshot: true, appts: { ...state.appts, [inOfficeAppt.id]: { ...inOfficeAppt, title: 'Original title' } } }]
    expect(authorizeAction(state, { type: 'undo' }).ok).toBe(true)
    state.history = [{ __workspaceSnapshot: true, appts: { ...state.appts, [crossOfficeAppt.id]: { ...crossOfficeAppt, title: 'Hidden edit' } } }]
    expect(authorizeAction(state, { type: 'undo' }).ok).toBe(false)
  })

  it('keeps QuickBooks payroll exports inside both their module and office authorization', () => {
    const state = asRole(blankState(), 'clinician')
    const role = state.security.roles.find((item) => item.id === 'clinician')
    role.permissions.payrollQbo = 'full'
    const localId = 'staff-payroll-local'
    const northId = 'staff-payroll-north'
    state.staff = [...state.staff, { id: localId, name: 'Local Payroll Staff', office: 'Main Center' }]
    state.payProfiles = [
      ...state.payProfiles,
      { id: 'pay-local', staffId: localId, office: 'Main Center' },
      { id: 'pay-north', staffId: northId, office: 'North Clinic' },
    ]
    state.payRuns = { ...state.payRuns, 'run-mixed': { id: 'run-mixed', included: [localId, northId], lines: [] } }

    const localExport = { id: 'qbo-local', kind: 'qbo_payroll', staffIds: [localId], permissionArea: 'payrollQbo' }
    const localWrite = authorizeAction(state, { type: 'payrollTx', scope: 'export', item: localExport, permissionArea: 'payrollQbo' })
    expect(localWrite).toMatchObject({ ok: true })
    expect(canAccessRecord(state, 'payExport', { id: 'qbo-mixed', kind: 'qbo_payroll', runId: 'run-mixed' })).toBe(false)
    expect(authorizeAction(state, {
      type: 'payrollTx', scope: 'export', permissionArea: 'payrollQbo',
      item: { id: 'qbo-mixed', kind: 'qbo_payroll', staffIds: [localId, northId] },
    })).toMatchObject({ ok: false, msg: expect.stringMatching(/office scope/) })

    state.payExports = {
      'qbo-local': localExport,
      'payroll-local': { id: 'payroll-local', kind: 'register_csv', staffIds: [localId] },
    }
    expect(Object.keys(scopeWorkspaceToAccount(state).payExports)).toEqual(['qbo-local'])
  })

  it('keeps payroll profile office scope independent from the account office assignment', () => {
    const state = asRole(blankState(), 'payroll-manager')
    const account = currentAccount(state)
    const profile = state.payProfiles.find((item) => item.staffId === 's3')
    expect(profile.office).toBe('School-based')
    expect(account.officeIds).not.toContain(profile.office)
    expect(canAccessRecord(state, 'payProfile', profile)).toBe(false)
    expect(scopeWorkspaceToAccount(state).payProfiles.some((item) => item.staffId === 's3')).toBe(false)
    expect(authorizeAction(state, {
      type: 'payrollTx', scope: 'profile', op: 'upsert', item: profile,
    })).toMatchObject({ ok: false, msg: expect.stringMatching(/office scope/) })
  })

  it('allows payroll profile setup only for staff in the assigned office scope', () => {
    const state = asRole(blankState(), 'payroll-manager')
    state.staff = [
      ...state.staff,
      { id: 'staff-payroll-local', name: 'Local Payroll Hire', office: 'Main Center' },
      { id: 'staff-payroll-north', name: 'North Payroll Hire', office: 'North Clinic' },
    ]
    const local = authorizeAction(state, {
      type: 'payrollTx', scope: 'profile', op: 'upsert', item: { staffId: 'staff-payroll-local' },
    })
    expect(local.ok).toBe(true)
    expect(authorizeAction(state, {
      type: 'payrollTx', scope: 'profile', op: 'upsert', item: { staffId: 'staff-payroll-north' },
    })).toMatchObject({ ok: false, msg: expect.stringMatching(/office scope/) })
  })

  it('authorizes provider identifier writes as Billing while preserving office scoping', () => {
    const state = asRole(blankState(), 'billing-specialist')
    const visible = scopeWorkspaceToAccount(state)
    expect(authorizeAction(state, { type: 'setSettings', patch: { providers: visible.settings.providers } }).ok).toBe(true)

    const hiddenProvider = state.settings.providers.find((provider) => !canAccessRecord(state, 'provider', provider))
    expect(hiddenProvider).toBeTruthy()
    const attempted = authorizeAction(state, {
      type: 'setSettings',
      patch: { providers: [...visible.settings.providers, { ...hiddenProvider, npi: '0000000000' }] },
    })
    expect(attempted).toMatchObject({ ok: false, msg: expect.stringMatching(/office scope/) })
  })

  it('maps ERA selections to their claims and keeps cross-office imports aggregate-only', () => {
    const state = asRole(blankState(), 'billing-specialist')
    const main = { id: 'claim-main-office', no: 'MAIN-001', clientId: 'c1', lines: [] }
    const north = { id: 'claim-north-office', no: 'NORTH-001', clientId: 'c3', lines: [] }
    state.claims = { ...state.claims, [main.id]: main, [north.id]: north }

    const mainLine = { id: 'line-main', claimNo: main.no }
    expect(authorizeAction(state, {
      type: 'eraImportTx', parsed: { lines: [mainLine] }, options: { selectedIds: [mainLine.id] },
    }).ok).toBe(true)
    expect(authorizeAction(state, {
      type: 'eraImportTx', parsed: { lines: [mainLine, { id: 'line-north', claimNo: north.no }] }, options: { selectedIds: [mainLine.id] },
    })).toMatchObject({ ok: false, msg: expect.stringMatching(/office scope/) })

    const singleOfficeEra = { id: 'era-main', unmatched: 0, detail: [{ id: mainLine.id, claimId: main.id, decision: 'parked' }] }
    state.eraImports = { 'era-main': singleOfficeEra }
    expect(authorizeAction(state, { type: 'eraRetryTx', eraId: 'era-main', selectedIds: [mainLine.id] }).ok).toBe(true)

    const mixedEra = { id: 'era-mixed', unmatched: 0, detail: [
      { id: 'line-main', claimId: main.id, decision: 'parked' },
      { id: 'line-north', claimId: north.id, decision: 'parked' },
    ] }
    expect(canAccessRecord(state, 'era', mixedEra)).toBe(false)
    expect(canAccessRecord(state, 'billedFile', { id: 'file-mixed', claimIds: [main.id, north.id] })).toBe(false)
  })

  it('guards every financial-ledger branch in aggregate claims transactions by office', () => {
    const state = asRole(blankState(), 'clinician')
    state.security.roles.find((role) => role.id === 'clinician').permissions.billing = 'full'
    const hiddenClaimId = 'claim-north-office'
    state.claims = { ...state.claims, [hiddenClaimId]: { id: hiddenClaimId, no: 'NORTH-001', clientId: 'c3', lines: [] } }

    const childWrites = [
      { claimDel: [hiddenClaimId] },
      { invoices: { 'invoice-north': { id: 'invoice-north', clientId: 'c3' } } },
      { payments: { 'payment-north': { id: 'payment-north', clientId: 'c3' } } },
      { eraImports: { 'era-north': { id: 'era-north', detail: [{ claimId: hiddenClaimId }] } } },
      { billedFiles: { 'file-north': { id: 'file-north', claimIds: [hiddenClaimId] } } },
      { qbo: { 'qbo-north': { id: 'qbo-north', claimId: hiddenClaimId } } },
      { verificationForms: { 'form-north': { id: 'form-north', clientId: 'c3' } } },
    ]
    for (const patch of childWrites) {
      expect(authorizeAction(state, { type: 'claimsTx', ...patch })).toMatchObject({ ok: false, msg: expect.stringMatching(/office scope/) })
    }
  })

  it('blocks cross-office roster removal cascades and account-wide role mutations', () => {
    const state = asRole(blankState(), 'clinician')
    const role = state.security.roles.find((item) => item.id === 'clinician')
    role.permissions.staff = 'full'
    role.permissions.clients = 'full'
    role.permissions.security = 'full'

    const localStaff = { id: 'staff-local', name: 'Local Staff', office: 'Main Center' }
    state.staff = [...state.staff, localStaff]
    const rosterUpdate = { ...localStaff, name: 'Updated Local Staff' }
    expect(authorizeAction(state, { type: 'roster', list: 'staff', mode: 'patch', item: rosterUpdate }).ok).toBe(true)
    const updatedRoster = reducer(state, { type: 'roster', list: 'staff', mode: 'patch', item: rosterUpdate })
    expect(updatedRoster.staff.find((person) => person.id === localStaff.id).name).toBe('Updated Local Staff')

    state.appts['north-appt-for-local-staff'] = { id: 'north-appt-for-local-staff', location: 'North Clinic', clientIds: [], staffIds: [localStaff.id] }
    expect(authorizeAction(state, { type: 'roster', list: 'staff', mode: 'remove', id: localStaff.id })).toMatchObject({ ok: false, msg: expect.stringMatching(/office scope/) })

    const targetAccount = state.security.accounts.find((account) => account.id === 'account-s1')
    expect(authorizeAction(state, {
      type: 'securityTx', operation: 'account.delete', payload: { id: targetAccount.id },
    })).toMatchObject({ ok: false, msg: expect.stringMatching(/office scope/) })
    const targetRole = state.security.roles.find((item) => item.id === targetAccount.roleId)
    expect(authorizeAction(state, {
      type: 'securityTx', operation: 'role.update', payload: { role: targetRole },
    })).toMatchObject({ ok: false, msg: expect.stringMatching(/office scope/) })
    expect(authorizeAction(state, { type: 'roster', list: 'staff', mode: 'remove', id: 's3' })).toMatchObject({ ok: false, msg: expect.stringMatching(/office scope/) })
  })

  it('allows office-local referral changes without replacing another office’s records', () => {
    const state = asRole(blankState(), 'clinician')
    state.security.roles.find((role) => role.id === 'clinician').permissions.intake = 'full'
    state.referralSources = [
      { id: 'source-main', name: 'Main referral', office: 'Main Center', status: 'active' },
      { id: 'source-north', name: 'North referral', office: 'North Clinic', status: 'active' },
    ]
    const visibleSources = scopeWorkspaceToAccount(state).referralSources
    expect(visibleSources.map((source) => source.id)).toEqual(['source-main'])
    const updates = visibleSources.map((source) => ({ ...source, status: 'dormant' }))
    expect(authorizeAction(state, { type: 'intakeTx', sources: updates }).ok).toBe(true)
    const next = reducer(state, { type: 'intakeTx', sources: updates })
    expect(next.referralSources.find((source) => source.id === 'source-main').status).toBe('dormant')
    expect(next.referralSources.find((source) => source.id === 'source-north').status).toBe('active')
  })

  it('prevents an office administrator from provisioning or granting access outside their own office scope', () => {
    const state = asRole(blankState(), 'clinician')
    const role = state.security.roles.find((item) => item.id === 'clinician')
    role.permissions.security = 'full'
    const target = state.security.accounts.find((account) => account.id === 'account-s1')
    const denied = authorizeAction(state, {
      type: 'securityTx', operation: 'account.update',
      payload: { account: { ...target, officeIds: ['North Clinic'] } },
    })
    expect(denied).toMatchObject({ ok: false, msg: expect.stringMatching(/office scope/) })
  })
})

describe('security-aware backup migration', () => {
  it('upgrades version 2 backups with safe security defaults and validates version 3 policy', () => {
    const state = blankState()
    const v2data = workspaceData(state)
    delete v2data.security
    const migrated = readWorkspaceBackup({ format: BACKUP_FORMAT, version: 2, data: v2data }, blankState())
    expect(migrated.data.security.currentUserId).toBe('account-demo-admin')
    expect(migrated.data.security.accounts.some((account) => account.staffId === 's1')).toBe(true)

    const invalid = workspaceData(state)
    invalid.security.accounts[0].officeIds = ['Mars']
    expect(() => readWorkspaceBackup({ format: BACKUP_FORMAT, version: 3, data: invalid }, blankState())).toThrow(/invalid user accounts/)

    const unlinkedAccount = workspaceData(state)
    const activeStaffAccount = unlinkedAccount.security.accounts.find((account) => account.id === 'account-s3')
    activeStaffAccount.staffId = null
    expect(() => readWorkspaceBackup({ format: BACKUP_FORMAT, version: 3, data: unlinkedAccount }, blankState())).toThrow(/invalid user accounts/)

    const weakenedAdmin = workspaceData(state)
    weakenedAdmin.security.roles[0].permissions.security = 'none'
    expect(() => readWorkspaceBackup({ format: BACKUP_FORMAT, version: 3, data: weakenedAdmin }, blankState())).toThrow(/protected Administrator/)
  })
})
