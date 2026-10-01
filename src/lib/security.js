import { OFFICES } from './payroll'

export const ACCESS_LEVELS = ['full', 'view', 'none']
export const ACCESS_LABELS = { full: 'Full access', view: 'View only', none: 'No access' }

/** Permission areas map to actual routes and reducer-backed actions in this app. */
export const SECURITY_AREAS = [
  { id: 'calendar', label: 'Schedule', description: 'Calendar, appointment details and coverage' },
  { id: 'clients', label: 'Clients', description: 'Client roster and profiles' },
  { id: 'intake', label: 'Intake', description: 'Referrals, intake pipeline and conversion' },
  { id: 'staff', label: 'Staff', description: 'Staff roster, profiles and teams' },
  { id: 'masters', label: 'Masters', description: 'Payers, services and custom fields' },
  { id: 'billing', label: 'Billing', description: 'Claims, payments, A/R and billing exports' },
  { id: 'forms', label: 'Verification forms', description: 'Eligibility and verification records' },
  { id: 'payroll', label: 'Payroll', description: 'Timesheets, pay runs and payroll setup' },
  { id: 'payrollQbo', label: 'QuickBooks Payroll', description: 'Payroll journal and provider exports' },
  { id: 'analytics', label: 'Analytics', description: 'Operational analytics' },
  { id: 'reports', label: 'Reports', description: 'Saved and exportable reports' },
  { id: 'dashboard', label: 'Dashboard', description: 'Dashboard boards and widgets' },
  { id: 'settings', label: 'Workspace settings', description: 'Practice defaults and data management' },
  { id: 'security', label: 'Security administration', description: 'Accounts, roles and access policy' },
]

export const SECURITY_OFFICES = [...OFFICES]
/**
 * chunk-42: the office master is editable in Settings → Organization. Access
 * scoping offers every active office flagged for scope, falling back to the
 * built-in list for old saves and for callers that have no state handy.
 */
export function securityOffices(settings) {
  const rows = Array.isArray(settings?.offices) ? settings.offices : []
  const list = rows.filter((o) => o && o.active !== false && o.scope !== false && o.name).map((o) => o.name)
  return list.length ? [...new Set(list)] : [...SECURITY_OFFICES]
}
export const DEMO_RESET_AREAS = ['calendar', 'clients', 'intake', 'billing', 'payroll', 'settings', 'security']

const none = () => Object.fromEntries(SECURITY_AREAS.map(({ id }) => [id, 'none']))
const makePermissions = (overrides = {}) => ({ ...none(), ...overrides })

export const ROLE_TEMPLATES = [
  {
    id: 'administrator', name: 'Administrator', description: 'Workspace administration and all practice modules.', system: true,
    permissions: makePermissions(Object.fromEntries(SECURITY_AREAS.map(({ id }) => [id, 'full']))),
  },
  {
    id: 'clinical-supervisor', name: 'Clinical Supervisor', description: 'Clinical workflow, client records and schedule oversight.',
    permissions: makePermissions({ calendar: 'full', clients: 'full', intake: 'full', staff: 'view', masters: 'view', billing: 'view', forms: 'full', analytics: 'view', reports: 'view', dashboard: 'view' }),
  },
  {
    id: 'scheduler', name: 'Scheduler', description: 'Schedule and intake coordination without financial administration.',
    permissions: makePermissions({ calendar: 'full', clients: 'view', intake: 'full', staff: 'view', masters: 'view', analytics: 'view', reports: 'view', dashboard: 'view' }),
  },
  {
    id: 'clinician', name: 'Clinician', description: 'Assigned clinical workflow with limited roster visibility.',
    permissions: makePermissions({ calendar: 'full', clients: 'view', staff: 'view', forms: 'view', dashboard: 'view' }),
  },
  {
    id: 'billing-specialist', name: 'Billing Specialist', description: 'Billing operations and payer/service master data.',
    permissions: makePermissions({ calendar: 'view', clients: 'view', intake: 'view', staff: 'view', masters: 'full', billing: 'full', forms: 'full', analytics: 'view', reports: 'full', dashboard: 'view' }),
  },
  {
    id: 'payroll-manager', name: 'Payroll Manager', description: 'Payroll, timesheets and payroll exports.',
    permissions: makePermissions({ staff: 'view', payroll: 'full', payrollQbo: 'full', reports: 'view', dashboard: 'view' }),
  },
  {
    id: 'read-only', name: 'Read Only', description: 'View access to operational areas; no changes.',
    permissions: makePermissions(Object.fromEntries(SECURITY_AREAS.filter(({ id }) => id !== 'security').map(({ id }) => [id, 'view']))),
  },
]

const validLevel = (value) => ACCESS_LEVELS.includes(value)
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const cleanText = (value, max = 80) => String(value ?? '').trim().slice(0, max)
const emailKey = (value) => String(value || '').trim().toLowerCase()
const safeNow = () => Date.now()

function accountFromStaff(staff, roleId, officeIds) {
  return {
    id: `account-${staff.id}`,
    staffId: staff.id,
    name: staff.name,
    email: staff.email || '',
    jobTitle: staff.role || 'Staff member',
    roleId,
    officeIds: [...officeIds],
    status: 'active',
    system: false,
    createdAt: 1,
    updatedAt: 1,
  }
}

export function defaultSecurity(staff = []) {
  const roles = ROLE_TEMPLATES.map((role) => ({ ...role, permissions: { ...role.permissions } }))
  const allOffices = [...SECURITY_OFFICES]
  const byId = Object.fromEntries((staff || []).map((person) => [person.id, person]))
  const accounts = [
    {
      id: 'account-demo-admin', staffId: null, name: 'Admin', email: 'admin@aloha.example.com',
      jobTitle: 'Practice Administrator', roleId: 'administrator', officeIds: ['*'],
      status: 'active', system: true, createdAt: 1, updatedAt: 1,
    },
    ...(byId.s1 ? [accountFromStaff(byId.s1, 'clinical-supervisor', ['Main Center', 'School-based'])] : []),
    ...(byId.s12 ? [accountFromStaff(byId.s12, 'scheduler', allOffices)] : []),
    ...(byId.s3 ? [accountFromStaff(byId.s3, 'clinician', ['Main Center', 'Home programs'])] : []),
  ]
  return {
    schemaVersion: 1,
    roles,
    accounts,
    currentUserId: 'account-demo-admin',
    audit: [],
  }
}

export function normalizeSecurity(value, staff = []) {
  const defaults = defaultSecurity(staff)
  if (!record(value)) return defaults

  const staffIds = new Set((staff || []).map((person) => person.id))
  const administratorTemplate = defaults.roles.find((role) => role.id === 'administrator')
  const rolesIn = Array.isArray(value.roles) ? value.roles : defaults.roles
  const roleIds = new Set()
  const roles = rolesIn.filter((role) => {
    if (!record(role) || typeof role.id !== 'string' || !role.id || roleIds.has(role.id)) return false
    roleIds.add(role.id)
    return true
  }).map((role) => ({
    id: role.id,
    name: role.id === 'administrator' ? administratorTemplate.name : cleanText(role.name, 48) || 'Untitled role',
    description: role.id === 'administrator' ? administratorTemplate.description : cleanText(role.description, 180),
    ...(role.id === 'administrator' ? { system: true } : (Object.prototype.hasOwnProperty.call(role, 'system') && !role.system ? { system: false } : {})),
    permissions: role.id === 'administrator' ? { ...administratorTemplate.permissions } : Object.fromEntries(SECURITY_AREAS.map(({ id }) => [id, validLevel(role.permissions?.[id]) ? role.permissions[id] : 'none'])),
  }))
  const defaultAdminRole = defaults.roles.find((role) => role.id === 'administrator')
  if (!roles.some((role) => role.id === 'administrator')) roles.unshift(defaultAdminRole)

  const roleById = new Map(roles.map((role) => [role.id, role]))
  const accountIds = new Set()
  const assignedStaff = new Set()
  const rawAccounts = Array.isArray(value.accounts) ? value.accounts : defaults.accounts
  const accounts = rawAccounts.filter((account) => {
    if (!record(account) || typeof account.id !== 'string' || !account.id || accountIds.has(account.id)) return false
    if (!roleById.has(account.roleId) || (account.staffId && !staffIds.has(account.staffId))) return false
    if (account.staffId && assignedStaff.has(account.staffId)) return false
    accountIds.add(account.id)
    if (account.staffId) assignedStaff.add(account.staffId)
    return true
  }).map((account) => ({
    id: account.id,
    staffId: account.id === 'account-demo-admin' ? null : (account.staffId || null),
    name: account.id === 'account-demo-admin' ? 'Admin' : cleanText(account.name, 90) || 'Unnamed user',
    email: account.id === 'account-demo-admin' ? 'admin@aloha.example.com' : cleanText(account.email, 160).toLowerCase(),
    jobTitle: account.id === 'account-demo-admin' ? 'Practice Administrator' : cleanText(account.jobTitle, 90),
    roleId: account.id === 'account-demo-admin' ? 'administrator' : account.roleId,
    officeIds: account.id === 'account-demo-admin' ? ['*'] : (Array.isArray(account.officeIds) ? [...new Set(account.officeIds.map((office) => cleanText(office, 80)).filter(Boolean))] : []),
    status: account.id === 'account-demo-admin' ? 'active' : (account.status === 'suspended' || !account.staffId ? 'suspended' : 'active'),
    system: account.id === 'account-demo-admin',
    createdAt: Number.isFinite(account.createdAt) ? account.createdAt : safeNow(),
    updatedAt: Number.isFinite(account.updatedAt) ? account.updatedAt : safeNow(),
  }))
  const fallbackAdmin = defaults.accounts[0]
  if (!accounts.some((account) => account.id === fallbackAdmin.id)) accounts.unshift(fallbackAdmin)
  const adminRole = roleById.get('administrator') || defaultAdminRole
  if (!roles.some((role) => role.id === 'administrator')) roles.unshift(adminRole)
  const activeAdmin = accounts.some((account) => account.status === 'active' && roleById.get(account.roleId)?.permissions?.security === 'full')
  if (!activeAdmin) {
    const currentAdmin = accounts.find((account) => account.id === 'account-demo-admin') || fallbackAdmin
    currentAdmin.roleId = 'administrator'
    currentAdmin.status = 'active'
    if (!currentAdmin.officeIds.length) currentAdmin.officeIds = ['*']
  }
  const current = accounts.find((account) => account.id === value.currentUserId && account.status === 'active')
  const audit = Array.isArray(value.audit) ? value.audit.filter((event) => record(event) && typeof event.id === 'string').slice(-200) : []
  return {
    schemaVersion: 1,
    roles,
    accounts,
    currentUserId: current ? current.id : 'account-demo-admin',
    audit,
  }
}

export function validateSecurityConfig(value, staff = [], settings = null) {
  if (!record(value) || value.schemaVersion !== 1 || !Array.isArray(value.roles) || !Array.isArray(value.accounts) || !Array.isArray(value.audit)) {
    throw new Error('Backup has invalid security settings')
  }
  if (value.roles.length < 1 || value.roles.length > 100 || value.accounts.length > 1000 || value.audit.length > 200) {
    throw new Error('Backup has invalid security settings')
  }
  const roleIds = new Set()
  const roleNames = new Set()
  for (const role of value.roles) {
    const key = cleanText(role?.name, 48).toLowerCase()
    if (!record(role) || typeof role.id !== 'string' || !role.id || roleIds.has(role.id) || key.length < 2 || roleNames.has(key) || !record(role.permissions) || (role.id === 'administrator' ? role.system !== true : !!role.system)) {
      throw new Error('Backup has invalid user roles')
    }
    roleIds.add(role.id)
    roleNames.add(key)
    for (const { id } of SECURITY_AREAS) if (!validLevel(role.permissions[id])) throw new Error('Backup has invalid role permissions')
  }
  const administrator = value.roles.find((role) => role.id === 'administrator')
  if (!administrator) throw new Error('Backup is missing the administrator role')
  if (SECURITY_AREAS.some(({ id }) => administrator.permissions[id] !== 'full')) throw new Error('Backup has an invalid protected Administrator role')

  const staffIds = new Set((staff || []).map((person) => person.id))
  const accountIds = new Set()
  const staffAssignments = new Set()
  const emailAddresses = new Set()
  for (const account of value.accounts) {
    const email = emailKey(account?.email)
    if (!record(account) || typeof account.id !== 'string' || !account.id || accountIds.has(account.id) || !roleIds.has(account.roleId) ||
        !['active', 'suspended'].includes(account.status) || !Array.isArray(account.officeIds) ||
        !account.officeIds.length || new Set(account.officeIds).size !== account.officeIds.length || account.officeIds.some((office) => typeof office !== 'string' || !office.trim() || (office !== '*' && !securityOffices(settings).includes(office))) ||
        (account.officeIds.includes('*') && (account.officeIds.length !== 1 || account.roleId !== 'administrator')) ||
        (account.id === 'account-demo-admin' && (account.roleId !== 'administrator' || account.status !== 'active' || account.system !== true || account.staffId != null || account.name !== 'Admin' || email !== 'admin@aloha.example.com' || account.officeIds.length !== 1 || account.officeIds[0] !== '*')) ||
        (account.id !== 'account-demo-admin' && (!!account.system || (account.status === 'active' && !account.staffId))) ||
        (account.staffId && (!staffIds.has(account.staffId) || staffAssignments.has(account.staffId))) ||
        !String(account.name || '').trim() || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || emailAddresses.has(email)) {
      throw new Error('Backup has invalid user accounts')
    }
    accountIds.add(account.id)
    emailAddresses.add(email)
    if (account.staffId) staffAssignments.add(account.staffId)
  }
  if (!accountIds.has('account-demo-admin') || !value.accounts.some((account) => account.id === value.currentUserId && account.status === 'active')) {
    throw new Error('Backup has an invalid current demo account')
  }
  const activeAdmin = value.accounts.some((account) => account.status === 'active' &&
    value.roles.find((role) => role.id === account.roleId)?.permissions.security === 'full')
  if (!activeAdmin) throw new Error('Backup must retain at least one active security administrator')
  if (value.audit.some((event) => !record(event) || typeof event.at !== 'number' || typeof event.action !== 'string')) {
    throw new Error('Backup has invalid security audit history')
  }
  return true
}

const roleFor = (security, roleId) => security?.roles?.find((role) => role.id === roleId) || null
const accountFor = (security, accountId) => security?.accounts?.find((account) => account.id === accountId) || null

export function resolveAccount(state, account) {
  if (!account) return null
  const person = account.staffId ? (state?.staff || []).find((staffMember) => staffMember.id === account.staffId) : null
  return person ? { ...account, name: person.name || account.name, email: person.email || account.email, jobTitle: person.role || account.jobTitle } : account
}

export function currentAccount(state) {
  const account = accountFor(state?.security, state?.security?.currentUserId)
  return account?.status === 'active' ? resolveAccount(state, account) : null
}

export function currentRole(state) {
  const account = currentAccount(state)
  return account ? roleFor(state.security, account.roleId) : null
}

export function accessLevel(state, area) {
  if (!SECURITY_AREAS.some((item) => item.id === area)) return 'none'
  const account = currentAccount(state)
  const role = account && roleFor(state?.security, account.roleId)
  return role?.permissions?.[area] || 'none'
}

export function canAccess(state, area, minimum = 'view') {
  const rank = { none: 0, view: 1, full: 2 }
  return (rank[accessLevel(state, area)] || 0) >= (rank[minimum] ?? 1)
}

const OFFICE_ALIASES = [
  ['North Clinic', /northside|north clinic/i],
  ['School-based', /school|elementary|district/i],
  ['Remote / telehealth', /telehealth|remote|video/i],
  ['Home programs', /home|community|park|en route/i],
  ['Main Center', /main center|clinic|center|assessment lab/i],
]

/** Normalize legacy schedule/client locations to the configured practice-office scope. */
export function officeForValue(value) {
  const text = cleanText(value, 120)
  if (!text) return null
  if (text === '*') return '*'
  const exact = SECURITY_OFFICES.find((office) => office.toLowerCase() === text.toLowerCase())
  if (exact) return exact
  return OFFICE_ALIASES.find(([, pattern]) => pattern.test(text))?.[0] || null
}

function directOfficeIds(item) {
  if (!record(item)) return []
  const values = [
    ...(Array.isArray(item.officeIds) ? item.officeIds : []),
    item.officeId, item.office, item.location, item.site, item.home,
  ]
  return [...new Set(values.map(officeForValue).filter(Boolean))]
}

function relatedRecord(state, collection, id) {
  const value = state?.[collection]
  return Array.isArray(value) ? value.find((item) => item.id === id) : value?.[id]
}

/** Resolve a record's office through explicit metadata or its practice relationships. */
export function officesForRecord(state, kind, item, seen = new Set()) {
  if (!record(item)) return []
  const ref = `${kind}:${item.id || item.staffId || item.clientId || item.claimId || ''}`
  if (seen.has(ref)) return []
  const nextSeen = new Set(seen).add(ref)
  const direct = directOfficeIds(item)
  if (direct.includes('*')) return [...SECURITY_OFFICES]
  if (direct.length) return direct

  const union = (entries) => [...new Set(entries.flatMap(([childKind, child]) => officesForRecord(state, childKind, child, nextSeen)))]
  const staffOffice = (staffId, preferPayroll = false) => {
    const linkedAccount = state?.security?.accounts?.find((account) => account.staffId === staffId)
    if (!preferPayroll && linkedAccount?.officeIds?.length) return linkedAccount.officeIds.flatMap((office) => office === '*' ? SECURITY_OFFICES : [officeForValue(office)]).filter(Boolean)
    const profile = (state?.payProfiles || []).find((candidate) => candidate.staffId === staffId)
    const profileOffice = officeForValue(profile?.office)
    if (profileOffice) return [profileOffice]
    const person = relatedRecord(state, 'staff', staffId)
    const staffOfficeValue = officeForValue(person?.office)
    return staffOfficeValue ? [staffOfficeValue] : []
  }

  if (kind === 'account') return (item.officeIds || []).flatMap((office) => office === '*' ? SECURITY_OFFICES : [officeForValue(office)]).filter(Boolean)
  if (kind === 'staff') return staffOffice(item.id)
  if (kind === 'payProfile' || kind === 'paySheet') return staffOffice(item.staffId, true)
  if (kind === 'payExport') {
    const run = item.runId ? relatedRecord(state, 'payRuns', item.runId) : null
    const staffIds = [...(Array.isArray(item.staffIds) ? item.staffIds : []), item.staffId].filter(Boolean)
    const runOffices = run ? officesForRecord(state, 'payRun', run, nextSeen) : []
    const staffOffices = staffIds.flatMap((staffId) => staffOffice(staffId, true))
    return [...new Set([...runOffices, ...staffOffices])]
  }
  if (kind === 'payRun') {
    const lineOffices = (item.lines || []).flatMap((line) => directOfficeIds(line).filter((office) => office !== '*'))
    const ids = lineOffices.length ? lineOffices : (item.included || []).flatMap((staffId) => staffOffice(staffId, true))
    return [...new Set(ids)]
  }
  if (kind === 'client') {
    const appts = Object.values(state?.appts || {}).filter((appt) => (appt.clientIds || []).includes(item.id))
    return union(appts.map((appt) => ['appointment', appt]))
  }
  if (kind === 'appointment') {
    const fromClients = (item.clientIds || []).map((id) => relatedRecord(state, 'clients', id)).filter(Boolean).map((client) => ['client', client])
    const fromStaff = (item.staffIds || []).flatMap((id) => staffOffice(id).map((office) => ['office', { id: `${item.id}:${office}`, office }]))
    return [...new Set([...union(fromClients), ...union(fromStaff)])]
  }
  if (kind === 'team') {
    const fromStaff = (item.staffIds || []).flatMap((id) => staffOffice(id).map((office) => ['office', { id: `${item.id}:${office}`, office }]))
    const fromClients = (item.clientIds || []).map((id) => relatedRecord(state, 'clients', id)).filter(Boolean).map((client) => ['client', client])
    return [...new Set([...union(fromStaff), ...union(fromClients)])]
  }
  if (kind === 'claim') {
    const client = relatedRecord(state, 'clients', item.clientId)
    const appts = (item.lines || []).map((line) => relatedRecord(state, 'appts', line.apptId)).filter(Boolean)
    return union([...(client ? [['client', client]] : []), ...appts.map((appt) => ['appointment', appt])])
  }
  if (kind === 'provider') return item.kind === 'office' ? [...SECURITY_OFFICES] : item.kind === 'staff' ? staffOffice(item.refId) : []
  if (kind === 'payment' || kind === 'invoice' || kind === 'form') {
    const client = relatedRecord(state, 'clients', item.clientId)
    const claim = relatedRecord(state, 'claims', item.claimId)
    return union([...(client ? [['client', client]] : []), ...(claim ? [['claim', claim]] : [])])
  }
  if (kind === 'intake' || kind === 'referral') {
    const ownerId = item.ownerId || item.staffId || item.assignedStaffId
    return ownerId ? staffOffice(ownerId).map((office) => officeForValue(office)).filter(Boolean) : []
  }
  if (kind === 'billedFile' || kind === 'era' || kind === 'qbo') {
    const detailClaimIds = kind === 'era' ? (item.detail || []).map((line) => line.claimId) : []
    const claimIds = [...(item.claimIds || []), item.claimId, ...detailClaimIds].filter(Boolean)
    const claims = claimIds.map((id) => relatedRecord(state, 'claims', id)).filter(Boolean)
    return union(claims.map((claim) => ['claim', claim]))
  }
  return []
}

/** Deny records whose office cannot be established; multi-office payroll runs require every line in scope. */
export function canAccessRecord(state, kind, item) {
  const account = currentAccount(state)
  const scope = account?.officeIds || []
  if (!scope.length) return false
  if (scope.includes('*')) return true
  if (kind === 'payExport') {
    const staffIds = [...(Array.isArray(item?.staffIds) ? item.staffIds : []), item?.staffId].filter(Boolean)
    if (staffIds.some((id) => !(state.staff || []).some((person) => person.id === id) && !(state.payProfiles || []).some((profile) => profile.staffId === id))) return false
  }
  if (['era', 'billedFile', 'qbo'].includes(kind)) {
    if (kind === 'era' && Number(item?.unmatched || 0) > 0) return false
    const claimIds = [
      ...(Array.isArray(item?.claimIds) ? item.claimIds : []),
      ...(item?.claimId ? [item.claimId] : []),
      ...(kind === 'era' && Array.isArray(item?.detail) ? item.detail.map((line) => line.claimId) : []),
    ].filter(Boolean)
    if (claimIds.some((id) => !relatedRecord(state, 'claims', id))) return false
  }
  const offices = officesForRecord(state, kind, item)
  if (!offices.length) return false
  const allowed = new Set(scope)
  // Aggregated financial artifacts must not reveal another office's lines to a
  // user who can see only one component of the combined export/import.
  return ['team', 'payRun', 'payExport', 'era', 'billedFile', 'qbo'].includes(kind)
    ? offices.every((office) => allowed.has(office))
    : offices.some((office) => allowed.has(office))
}

/** Presentation state is office-filtered before modules, search and reports consume it. */
export function scopeWorkspaceToAccount(state) {
  const account = currentAccount(state)
  if (!account || account.officeIds?.includes('*')) return state
  const filterMap = (value, kind) => Object.fromEntries(Object.entries(value || {}).filter(([, item]) => canAccessRecord(state, kind, item)))
  const filterList = (value, kind) => (value || []).filter((item) => canAccessRecord(state, kind, item))
  const appts = filterMap(state.appts, 'appointment')
  const claims = filterMap(state.claims, 'claim')
  const staff = filterList(state.staff, 'staff')
  const clients = filterList(state.clients, 'client')
  const teams = filterList(state.teams, 'team')
  const visibleStaffIds = new Set(staff.map((item) => item.id))
  const visibleClientIds = new Set(clients.map((item) => item.id))
  const visibleTeamIds = new Set(teams.map((item) => item.id))
  const visiblePayrollStaff = new Set(filterList(state.payProfiles, 'payProfile').map((profile) => profile.staffId))
  const payRuns = Object.fromEntries(Object.entries(filterMap(state.payRuns, 'payRun')).map(([id, run]) => [id, {
    ...run,
    included: (run.included || []).filter((staffId) => visiblePayrollStaff.has(staffId)),
    excluded: (run.excluded || []).filter((staffId) => visiblePayrollStaff.has(staffId)),
    lines: (run.lines || []).filter((line) => visiblePayrollStaff.has(line.staffId)),
    gate: run.gate ? {
      ...run.gate,
      blockers: (run.gate.blockers || []).filter((item) => !item.staffId || visiblePayrollStaff.has(item.staffId)),
      warnings: (run.gate.warnings || []).filter((item) => !item.staffId || visiblePayrollStaff.has(item.staffId)),
    } : run.gate,
  }]))
  const visibleAccounts = (state.security?.accounts || []).filter((item) => canAccessRecord(state, 'account', item))
  const visibleAccountIds = new Set(visibleAccounts.map((item) => item.id))
  const visibleRoleIds = new Set(visibleAccounts.map((item) => item.roleId))
  const security = {
    ...state.security,
    accounts: visibleAccounts,
    audit: (state.security?.audit || []).filter((event) => visibleAccountIds.has(event.actorId) || visibleAccountIds.has(event.targetId) || visibleRoleIds.has(event.targetId)),
  }
  return {
    ...state,
    appts,
    claims,
    // Undo snapshots may contain records from any office. Only the guarded
    // action receives the raw history needed to authorize an undo.
    history: [],
    ui: {
      ...state.ui,
      staffSel: (Array.isArray(state.ui?.staffSel) ? state.ui.staffSel : []).filter((id) => visibleStaffIds.has(id)),
      clientSel: (Array.isArray(state.ui?.clientSel) ? state.ui.clientSel : []).filter((id) => visibleClientIds.has(id)),
      teamSel: (Array.isArray(state.ui?.teamSel) ? state.ui.teamSel : []).filter((id) => visibleTeamIds.has(id)),
    },
    payments: filterMap(state.payments, 'payment'),
    invoices: filterMap(state.invoices, 'invoice'),
    verificationForms: filterMap(state.verificationForms, 'form'),
    eraImports: filterMap(state.eraImports, 'era'),
    billedFiles: filterMap(state.billedFiles, 'billedFile'),
    qbo: filterMap(state.qbo, 'qbo'),
    staff,
    clients,
    teams,
    payProfiles: filterList(state.payProfiles, 'payProfile'),
    paySheets: filterMap(state.paySheets, 'paySheet'),
    payRuns,
    payExports: Object.fromEntries(Object.entries(filterMap(state.payExports, 'payExport')).filter(([, item]) => {
      const area = item.permissionArea === 'payrollQbo' ? 'payrollQbo' : 'payroll'
      return canAccess(state, area, 'view') || (area === 'payrollQbo' && canAccess(state, 'payroll', 'view'))
    })),
    intakeRequests: filterMap(state.intakeRequests, 'intake'),
    referralSources: filterList(state.referralSources, 'referral'),
    security,
    settings: { ...state.settings, providers: filterList(state.settings?.providers, 'provider') },
  }
}

export function areaForSection(section) {
  if (section === 'calendar') return 'calendar'
  if (section === 'clients') return 'clients'
  if (['intake', 'intake-new', 'referrals'].includes(section)) return 'intake'
  if (section === 'staff') return 'staff'
  if (section === 'masters') return 'masters'
  if (section === 'bil-verify') return 'forms'
  if (['pay-qbo'].includes(section)) return 'payrollQbo'
  if (['payroll', 'pay-process', 'pay-runs', 'pay-idmap', 'pay-summary', 'pay-timesheets', 'pay-setup'].includes(section)) return 'payroll'
  if (['billing', 'bil-files', 'bil-secondary', 'bil-payments', 'bil-ar', 'bil-invoice', 'bil-qbo', 'bil-appeals', 'bil-providers'].includes(section)) return 'billing'
  if (section === 'analytics') return 'analytics'
  if (section === 'reports') return 'reports'
  if (section === 'dashboard') return 'dashboard'
  if (section === 'security') return 'security'
  if (section === 'settings') return 'settings'
  return null
}

export function canAccessSection(state, section, minimum = 'view') {
  const area = areaForSection(section)
  return !!area && canAccess(state, area, minimum)
}

export function firstAccessibleSection(state) {
  const order = ['calendar', 'clients', 'intake', 'staff', 'masters', 'billing', 'payroll', 'pay-qbo', 'analytics', 'reports', 'dashboard', 'settings', 'security']
  return order.find((section) => canAccessSection(state, section, 'view')) || null
}

function areasForUndo(state) {
  const snapshot = state?.history?.[state.history.length - 1]
  if (!snapshot) return []
  const map = {
    appts: 'calendar', claims: 'billing', payments: 'billing', invoices: 'billing', verificationForms: 'forms',
    eraImports: 'billing', billedFiles: 'billing', qbo: 'billing', staff: 'staff', clients: 'clients', teams: 'staff',
    payers: 'masters', svcs: 'masters', customFields: 'masters', payProfiles: 'payroll', paySheets: 'payroll',
    payRuns: 'payroll', payExports: 'payroll', payrollSettings: 'payroll', billingSettings: 'billing',
    intakeRequests: 'intake', referralSources: 'intake', settings: 'settings', dash: 'dashboard', reports: 'reports', security: 'security',
  }
  return Object.keys(snapshot).filter((key) => key !== '__workspaceSnapshot').map((key) => map[key] || 'settings')
}

function actionAreas(state, action) {
  switch (action.type) {
    case 'upsertMany': case 'patch': case 'deleteMany': case 'relabel': return ['calendar']
    case 'claimsTx': case 'secondaryFilingTx': case 'secondarySkipTx': case 'secondaryCancelTx':
    case 'claimPaymentTx': case 'claimVoidPaymentTx': case 'patientReceiptTx': case 'unappliedPaymentTx':
    case 'eraImportTx': case 'eraRetryTx': return ['billing']
    case 'payrollTx': return action.scope === 'export' && action.permissionArea === 'payrollQbo' ? ['payrollQbo'] : ['payroll']
    case 'intakeTx': {
      const areas = ['intake']
      if (action.clients) areas.push('clients')
      if (action.apptUpserts?.length || action.apptPatches?.length) areas.push('calendar')
      return areas
    }
    case 'record':
      if (action.coll === 'payExports') return action.item?.permissionArea === 'payrollQbo' ? ['payrollQbo'] : ['payroll']
      if (action.coll === 'verificationForms') return ['forms']
      if (['invoices', 'eraImports', 'billedFiles', 'qbo'].includes(action.coll)) return ['billing']
      return null
    case 'roster':
      if (action.list === 'staff') {
        const areas = ['staff']
        if (action.mode === 'remove' && state.security?.accounts?.some((account) => account.staffId === action.id)) areas.push('security')
        return areas
      }
      if (action.list === 'clients') return ['clients']
      return null
    case 'payer': case 'svc': case 'cfdef': return ['masters']
    case 'dash': return ['dashboard']
    case 'addSavedReport': case 'removeSavedReport': return ['reports']
    case 'securityTx': return action.operation === 'account.switch' ? [] : ['security']
    // chunk-42: settings sub-module edits. Payroll-owned settings stay behind the
    // payroll area; everything else is Workspace settings.
    case 'settingsTx': {
      const op = String(action.op || '')
      const areas = ['settings']
      if (op.startsWith('payroll.') || op.startsWith('earningCode.')) areas.push('payroll')
      return areas
    }
    case 'importTx': {
      if (action.importType === 'clients') return ['settings', 'clients']
      if (action.importType === 'staff') return ['settings', 'staff']
      return ['settings', 'calendar']
    }
    case 'clearDemo': case 'reseed': return DEMO_RESET_AREAS
    case 'replace': return SECURITY_AREAS.map(({ id }) => id)
    case 'meta': return [] // migration/read-state bookkeeping; contains no user records
    case 'undo': return areasForUndo(state)
    case 'setSettings': {
      const patch = action.patch || {}
      const keys = Object.keys(patch)
      if (!keys.length || keys.every((key) => key === 'theme')) return []
      const areas = []
      if (keys.includes('billing') || keys.includes('providers')) areas.push('billing')
      if (keys.includes('payroll')) areas.push('payroll')
      if (keys.includes('smart')) areas.push('calendar')
      if (keys.includes('analytics')) areas.push('analytics')
      if (keys.some((key) => !['theme', 'billing', 'providers', 'payroll', 'smart', 'analytics'].includes(key))) areas.push('settings')
      return [...new Set(areas)]
    }
    case 'setUI': {
      const patch = action.patch || {}
      const areas = []
      if (patch.settings === true) areas.push('settings')
      if (patch.inbox === true || patch.openAppt) areas.push('calendar')
      if (Object.prototype.hasOwnProperty.call(patch, 'section')) {
        const area = areaForSection(patch.section)
        if (!area) return null
        areas.push(area)
      }
      return [...new Set(areas)]
    }
    case 'toggleSel':
      if (action.list === 'staffSel') return ['staff']
      if (action.list === 'clientSel') return ['clients']
      if (action.list === 'teamSel') return ['staff']
      return null
    default: return null
  }
}

function recordById(state, collection, id) {
  const value = state?.[collection]
  return Array.isArray(value) ? value.find((item) => item.id === id) : value?.[id]
}

function withinOffice(state, kind, collection, item) {
  if (!record(item)) return false
  const existing = item.id ? recordById(state, collection, item.id) : null
  return canAccessRecord(state, kind, existing ? { ...existing, ...item } : item)
}

function actionWithinOfficeScope(state, action) {
  const account = currentAccount(state)
  if (!account) return false
  if (account.officeIds?.includes('*')) return true
  const all = (items, kind, collection) => Array.isArray(items) && items.every((item) => withinOffice(state, kind, collection, item))
  const one = (item, kind, collection) => withinOffice(state, kind, collection, item)
  const ids = (values, kind, collection) => Array.isArray(values) && values.every((id) => {
    const existing = recordById(state, collection, id)
    return !!existing && canAccessRecord(state, kind, existing)
  })
  const fullyInScope = (kind, item) => {
    const offices = officesForRecord(state, kind, item)
    return offices.length > 0 && offices.every((office) => account.officeIds.includes(office))
  }
  const accountFullyInScope = (target) => {
    const offices = target?.officeIds || []
    return offices.length > 0 && !offices.includes('*') && offices.every((office) => account.officeIds.includes(office))
  }

  if (action.type === 'securityTx') {
    const operation = action.operation
    const payload = action.payload || {}
    if (operation === 'account.switch') {
      const target = state.security.accounts.find((item) => item.id === payload.id)
      return !!target && target.status === 'active' && canAccessRecord(state, 'account', target)
    }
    if (operation === 'account.delete') {
      const target = state.security.accounts.find((item) => item.id === payload.id)
      return !!target && target.id !== account.id && accountFullyInScope(target)
    }
    if (operation === 'account.create') {
      const person = (state.staff || []).find((item) => item.id === payload.account?.staffId)
      const assigned = payload.account?.officeIds || []
      return !!person && canAccessRecord(state, 'staff', person) && assigned.length > 0 && assigned.every((office) => account.officeIds.includes(office))
    }
    if (operation === 'account.update') {
      const target = state.security.accounts.find((item) => item.id === payload.account?.id)
      const assigned = payload.account?.officeIds || []
      return !!target && target.id !== account.id && accountFullyInScope(target) && assigned.length > 0 && assigned.every((office) => account.officeIds.includes(office))
    }
    if (operation === 'role.update' || operation === 'role.delete') {
      const roleId = operation === 'role.update' ? payload.role?.id : payload.id
      return state.security.accounts.filter((item) => item.roleId === roleId).every((item) => accountFullyInScope(item))
    }
    return ['role.create'].includes(operation)
  }

  switch (action.type) {
    case 'upsertMany': return all(action.appts, 'appointment', 'appts')
    case 'patch': {
      const existing = state.appts?.[action.id]
      return !!existing && canAccessRecord(state, 'appointment', { ...existing, ...(action.patch || {}) })
    }
    case 'deleteMany': return ids(action.ids, 'appointment', 'appts')
    case 'relabel': return all(Object.values(state.appts || {}), 'appointment', 'appts')
    case 'claimsTx': {
      if ((action.claimUpserts != null && !Array.isArray(action.claimUpserts)) ||
          (action.apptPatches != null && !Array.isArray(action.apptPatches)) ||
          (action.claimDel != null && !Array.isArray(action.claimDel)) ||
          (action.billing != null && !record(action.billing))) return false
      const claimUpserts = action.claimUpserts || []
      const apptPatches = (action.apptPatches || []).map((entry) => entry?.patch ? { ...entry.patch, id: entry.id } : entry)
      const invoices = Object.values(action.invoices || {})
      const payments = Object.values(action.payments || {})
      const eras = Object.values(action.eraImports || {})
      const billedFiles = Object.values(action.billedFiles || {})
      const qbo = Object.values(action.qbo || {})
      const forms = Object.values(action.verificationForms || {})
      return ids(action.claimDel ?? [], 'claim', 'claims') && all(claimUpserts, 'claim', 'claims') &&
        all(apptPatches, 'appointment', 'appts') && all(invoices, 'invoice', 'invoices') &&
        all(payments, 'payment', 'payments') && all(eras, 'era', 'eraImports') &&
        all(billedFiles, 'billedFile', 'billedFiles') && all(qbo, 'qbo', 'qbo') &&
        all(forms, 'form', 'verificationForms')
    }
    case 'secondaryFilingTx': case 'secondarySkipTx': case 'secondaryCancelTx':
    case 'claimPaymentTx': case 'claimVoidPaymentTx': case 'patientReceiptTx': {
      const claim = state.claims?.[action.id]
      return !!claim && canAccessRecord(state, 'claim', claim)
    }
    case 'unappliedPaymentTx': {
      const payload = action.payload || {}
      if (payload.claimId) return canAccessRecord(state, 'claim', state.claims?.[payload.claimId])
      if (payload.clientId) return canAccessRecord(state, 'client', recordById(state, 'clients', payload.clientId))
      return false
    }
    case 'eraImportTx': {
      const lines = action.parsed?.lines
      if (!Array.isArray(lines) || !lines.length) return false
      const selectedIds = action.options?.selectedIds
      if (selectedIds != null && (!Array.isArray(selectedIds) || selectedIds.some((id) => !lines.some((line) => line.id === id)))) return false
      return lines.every((line) => {
        const matches = Object.values(state.claims || {}).filter((claim) => claim.no === line.claimNo)
        return matches.length === 1 && canAccessRecord(state, 'claim', matches[0])
      })
    }
    case 'eraRetryTx': {
      const era = state.eraImports?.[action.eraId]
      const ids = action.selectedIds
      return !!era && canAccessRecord(state, 'era', era) && Array.isArray(ids) && ids.length > 0 && ids.every((id) => {
        const line = (era.detail || []).find((item) => item.id === id && item.decision === 'parked')
        const claim = line?.claimId ? state.claims?.[line.claimId] : null
        return !!claim && canAccessRecord(state, 'claim', claim)
      })
    }
    case 'record': {
      const map = { payExports: ['payExport', 'payExports'], verificationForms: ['form', 'verificationForms'], invoices: ['invoice', 'invoices'], eraImports: ['era', 'eraImports'], billedFiles: ['billedFile', 'billedFiles'], qbo: ['qbo', 'qbo'] }
      const entry = map[action.coll]
      if (!entry) return false
      const [kind, collection] = entry
      if (action.item) return withinOffice(state, kind, collection, action.item)
      if (action.items) return all(action.items, kind, collection)
      const existing = recordById(state, collection, action.id)
      return !!existing && canAccessRecord(state, kind, existing)
    }
    case 'roster': {
      const target = action.list === 'staff' ? ['staff', 'staff'] : action.list === 'clients' ? ['client', 'clients'] : null
      if (!target) return false
      const [kind, collection] = target
      if (action.mode === 'add') return one(action.item, kind, collection)
      if (action.mode === 'patch') return one(action.item, kind, collection)
      if (action.mode !== 'remove') return false
      const existing = recordById(state, collection, action.id)
      if (!existing || !canAccessRecord(state, kind, existing)) return false

      // Removing a roster record also detaches it from every related appointment
      // and care team. Do not let an office-scoped user cascade into another office.
      const referenceKey = action.list === 'staff' ? 'staffIds' : 'clientIds'
      const relatedAppts = Object.values(state.appts || {}).filter((item) => (item[referenceKey] || []).includes(action.id))
      const relatedTeams = (state.teams || []).filter((item) => (item[referenceKey] || []).includes(action.id))
      if (relatedAppts.some((item) => !fullyInScope('appointment', item)) || relatedTeams.some((item) => !fullyInScope('team', item))) return false
      if (action.list === 'staff') {
        const linkedAccounts = (state.security?.accounts || []).filter((item) => item.staffId === action.id)
        if (linkedAccounts.some((item) => item.id === account.id || !accountFullyInScope(item))) return false
      }
      return true
    }
    case 'payrollTx': {
      if (action.scope === 'settings' && !record(action.settings)) return false
      const directStaffIds = [action.staffId, action.item?.staffId, action.options?.staffId, ...(Array.isArray(action.item?.staffIds) ? action.item.staffIds : [])].filter(Boolean)
      const staffInScope = (id) => {
        const profile = (state.payProfiles || []).find((item) => item.staffId === id)
        if (profile) return canAccessRecord(state, 'payProfile', profile)
        const person = (state.staff || []).find((item) => item.id === id)
        return !!person && canAccessRecord(state, 'staff', person)
      }
      if (directStaffIds.length && !directStaffIds.every(staffInScope)) return false
      const run = action.runId ? state.payRuns?.[action.runId] : null
      if (action.runId && (!run || !canAccessRecord(state, 'payRun', run))) return false
      const includedIds = action.options?.included
      if (includedIds != null && (!Array.isArray(includedIds) || !includedIds.every((id) => {
        const profile = (state.payProfiles || []).find((item) => item.staffId === id)
        return profile ? canAccessRecord(state, 'payProfile', profile) : false
      }))) return false
      if (action.scope === 'run' && action.op === 'create') {
        const idsInRun = action.options?.included || (state.payProfiles || []).filter((item) => item.include).map((item) => item.staffId)
        return idsInRun.length > 0 && idsInRun.every((id) => {
          const profile = (state.payProfiles || []).find((item) => item.staffId === id)
          return profile && canAccessRecord(state, 'payProfile', profile)
        })
      }
      if (action.scope === 'settings') return (state.payProfiles || []).every((profile) => canAccessRecord(state, 'payProfile', profile))
      if (action.scope === 'export') {
        const exportStaffIds = [...(Array.isArray(action.item?.staffIds) ? action.item.staffIds : []), action.item?.staffId].filter(Boolean)
        if (exportStaffIds.length && !exportStaffIds.every((id) => {
          const profile = (state.payProfiles || []).find((item) => item.staffId === id)
          const person = (state.staff || []).find((item) => item.id === id)
          return profile ? fullyInScope('payProfile', profile) : !!person && fullyInScope('staff', person)
        })) return false
        if (action.item?.runId) {
          const source = state.payRuns?.[action.item.runId]
          return !!source && canAccessRecord(state, 'payRun', source)
        }
        return exportStaffIds.length > 0
      }
      return directStaffIds.length > 0 || !!run || action.scope === 'settings'
    }
    case 'intakeTx': {
      const requests = action.upserts != null ? action.upserts : action.requestUpserts != null ? action.requestUpserts : (action.request ? [action.request] : [])
      const upsertAppts = action.apptUpserts ?? []
      const apptPatchEntries = action.apptPatches ?? []
      const deletes = action.deletes ?? []
      if (!Array.isArray(requests) || !Array.isArray(upsertAppts) || !Array.isArray(apptPatchEntries) || !Array.isArray(deletes)) return false
      const clients = Object.values(action.clients || {})
      const appts = [...upsertAppts, ...apptPatchEntries.map((entry) => entry?.patch ? { ...entry.patch, id: entry.id } : entry)]
      const sources = Array.isArray(action.sources) ? action.sources : Object.values(action.sources || {})
      if (deletes.some((id) => !canAccessRecord(state, 'intake', state.intakeRequests?.[id]))) return false
      return all(requests, 'intake', 'intakeRequests') && all(clients, 'client', 'clients') && all(appts, 'appointment', 'appts') && all(sources, 'referral', 'referralSources')
    }
    case 'setSettings': {
      if (!record(action.patch)) return false
      const providers = action.patch.providers
      if (providers === undefined) return true
      if (!Array.isArray(providers)) return false
      return providers.every((provider) => {
        const prior = (state.settings?.providers || []).find((item) => item.id === provider.id)
        if (prior && !canAccessRecord(state, 'provider', prior)) return JSON.stringify(prior) === JSON.stringify(provider)
        return canAccessRecord(state, 'provider', provider)
      })
    }
    case 'clearDemo': case 'reseed': case 'replace': return false
    case 'undo': {
      const snapshot = state.history?.[state.history.length - 1]
      if (!snapshot) return true
      const recordKinds = { appts: ['appointment', 'appts'], claims: ['claim', 'claims'], payments: ['payment', 'payments'], invoices: ['invoice', 'invoices'], verificationForms: ['form', 'verificationForms'], eraImports: ['era', 'eraImports'], billedFiles: ['billedFile', 'billedFiles'], qbo: ['qbo', 'qbo'], staff: ['staff', 'staff'], clients: ['client', 'clients'], teams: ['team', 'teams'], payProfiles: ['payProfile', 'payProfiles'], paySheets: ['paySheet', 'paySheets'], payRuns: ['payRun', 'payRuns'], payExports: ['payExport', 'payExports'], intakeRequests: ['intake', 'intakeRequests'], referralSources: ['referral', 'referralSources'] }
      for (const key of Object.keys(snapshot)) {
        if (key === '__workspaceSnapshot') continue
        const descriptor = recordKinds[key]
        if (!descriptor) continue // module-level settings are separately permission-gated
        const [kind, collection] = descriptor
        const current = state[key]
        const prior = snapshot[key]
        const rows = (value) => Array.isArray(value) ? value : Object.values(value || {})
        const byId = (value) => new Map(rows(value).filter((item) => item?.id).map((item) => [item.id, item]))
        const before = byId(prior)
        const after = byId(current)
        for (const id of new Set([...before.keys(), ...after.keys()])) {
          const oldItem = before.get(id)
          const newItem = after.get(id)
          if (JSON.stringify(oldItem) === JSON.stringify(newItem)) continue
          if ((oldItem && !canAccessRecord(state, kind, oldItem)) || (newItem && !canAccessRecord(state, kind, newItem))) return false
        }
      }
      return true
    }
    default: return true
  }
}

export function authorizeAction(state, action) {
  if (!record(action) || typeof action.type !== 'string') return { ok: false, msg: 'This action is not authorized.' }
  const areas = actionAreas(state, action)
  if (!Array.isArray(areas)) return { ok: false, msg: 'This action is not authorized.' }
  const needsFull = !['setUI', 'toggleSel'].includes(action.type)
  const denied = areas.find((area) => !canAccess(state, area, needsFull ? 'full' : 'view'))
  if (denied) {
    const label = SECURITY_AREAS.find((area) => area.id === denied)?.label || denied
    return { ok: false, msg: `Your current role does not have ${needsFull ? 'full' : 'view'} access to ${label}.` }
  }
  if (areas.length && !actionWithinOfficeScope(state, action)) return { ok: false, msg: 'The selected record is outside your assigned office scope.' }
  return { ok: true }
}

const activeAdminCount = (security) => security.accounts.filter((account) => account.status === 'active' && roleFor(security, account.roleId)?.permissions.security === 'full').length
const auditEntry = (action, actorId, targetId, at, detail = '') => ({
  id: `audit-${at.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
  at, actorId: actorId || null, targetId: targetId || null, action, detail: cleanText(detail, 180),
})

/** Apply a validated security change. All mutations preserve an active admin and write an audit event. */
export function applySecurityChange(current, operation, payload = {}, actorId = null, at = safeNow()) {
  const security = normalizeSecurity(current, payload.staff || [])
  const roles = security.roles.map((role) => ({ ...role, permissions: { ...role.permissions } }))
  const accounts = security.accounts.map((account) => ({ ...account, officeIds: [...account.officeIds] }))
  let result = { roles, accounts, currentUserId: security.currentUserId }
  let auditAction = operation
  let targetId = payload.id || payload.account?.id || payload.role?.id || null
  let detail = ''

  if (operation === 'role.create') {
    const source = payload.role || {}
    const name = cleanText(source.name, 48)
    if (name.length < 2) return { ok: false, msg: 'Role name must be at least 2 characters.' }
    if (roles.some((role) => role.name.toLowerCase() === name.toLowerCase())) return { ok: false, msg: 'A role with that name already exists.' }
    if (!source.id || roles.some((role) => role.id === source.id)) return { ok: false, msg: 'Role identifier is missing or already in use.' }
    if (!record(source.permissions) || SECURITY_AREAS.some(({ id }) => !validLevel(source.permissions[id]))) return { ok: false, msg: 'Choose an access level for every module.' }
    result.roles = [...roles, { id: source.id, name, description: cleanText(source.description, 180), system: false, permissions: { ...source.permissions } }]
    auditAction = 'role.created'
    targetId = source.id
    detail = `Created role ${name}`
  } else if (operation === 'role.update') {
    const source = payload.role || {}
    const index = roles.findIndex((role) => role.id === source.id)
    if (index < 0) return { ok: false, msg: 'Role no longer exists.' }
    if (roles[index].system) return { ok: false, msg: 'The built-in Administrator role is protected.' }
    const name = cleanText(source.name, 48)
    if (name.length < 2) return { ok: false, msg: 'Role name must be at least 2 characters.' }
    if (roles.some((role) => role.id !== source.id && role.name.toLowerCase() === name.toLowerCase())) return { ok: false, msg: 'A role with that name already exists.' }
    if (!record(source.permissions) || SECURITY_AREAS.some(({ id }) => !validLevel(source.permissions[id]))) return { ok: false, msg: 'Choose an access level for every module.' }
    result.roles = roles.map((role) => role.id === source.id ? { ...role, name, description: cleanText(source.description, 180), permissions: { ...source.permissions } } : role)
    if (!result.accounts.some((account) => account.status === 'active' && roleFor({ ...security, roles: result.roles }, account.roleId)?.permissions.security === 'full')) {
      return { ok: false, msg: 'At least one active user must retain full Security access.' }
    }
    auditAction = 'role.updated'
    targetId = source.id
    detail = `Updated role ${name}`
  } else if (operation === 'role.delete') {
    const role = roles.find((candidate) => candidate.id === payload.id)
    if (!role) return { ok: false, msg: 'Role no longer exists.' }
    if (role.system) return { ok: false, msg: 'The built-in Administrator role cannot be deleted.' }
    if (accounts.some((account) => account.roleId === role.id)) return { ok: false, msg: 'Reassign or suspend every account using this role before deleting it.' }
    result.roles = roles.filter((candidate) => candidate.id !== role.id)
    auditAction = 'role.deleted'
    detail = `Deleted role ${role.name}`
  } else if (operation === 'account.create' || operation === 'account.update') {
    const source = payload.account || {}
    const existingIndex = accounts.findIndex((account) => account.id === source.id)
    if (operation === 'account.create' && existingIndex >= 0) return { ok: false, msg: 'That account already exists.' }
    if (operation === 'account.update' && existingIndex < 0) return { ok: false, msg: 'Account no longer exists.' }
    if (operation === 'account.update' && accounts[existingIndex].system) return { ok: false, msg: 'The built-in demo administrator account is protected.' }
    if (operation === 'account.update' && actorId === source.id) return { ok: false, msg: 'Ask another Security administrator to change your own access assignment.' }
    const staff = (payload.staff || []).find((person) => person.id === source.staffId)
    if (!staff) return { ok: false, msg: 'Choose an existing staff member for this account.' }
    if (!roleFor(security, source.roleId)) return { ok: false, msg: 'Choose an existing user role.' }
    if (accounts.some((account) => account.staffId === source.staffId && account.id !== source.id)) return { ok: false, msg: 'This staff member already has an account.' }
    const officeIds = [...new Set((source.officeIds || []).map((office) => cleanText(office, 80)).filter(Boolean))]
    if (!officeIds.length) return { ok: false, msg: 'Assign at least one office.' }
    if (officeIds.some((office) => office !== '*' && !securityOffices(payload.settings).includes(office))) return { ok: false, msg: 'Choose an office from the configured office list.' }
    if (officeIds.includes('*') && (source.roleId !== 'administrator' || officeIds.length !== 1)) return { ok: false, msg: 'All-office access is reserved for an Administrator account.' }
    const email = emailKey(staff.email)
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, msg: 'The staff profile needs a valid email before it can receive an account.' }
    if (accounts.some((account) => emailKey(account.email) === email && account.id !== source.id)) return { ok: false, msg: 'That email address is already assigned to an account.' }
    const account = {
      id: source.id || payload.newId,
      staffId: staff.id,
      name: cleanText(staff.name, 90),
      email,
      jobTitle: cleanText(staff.role, 90),
      roleId: source.roleId,
      officeIds,
      status: source.status === 'suspended' ? 'suspended' : 'active',
      system: false,
      createdAt: existingIndex >= 0 ? accounts[existingIndex].createdAt : at,
      updatedAt: at,
    }
    if (!account.id) return { ok: false, msg: 'Account identifier is missing.' }
    result.accounts = existingIndex >= 0 ? accounts.map((item) => item.id === account.id ? account : item) : [...accounts, account]
    if (!result.accounts.some((candidate) => candidate.status === 'active' && roleFor({ ...security, roles }, candidate.roleId)?.permissions.security === 'full')) {
      return { ok: false, msg: 'At least one active user must retain full Security access.' }
    }
    if (result.currentUserId === account.id && account.status !== 'active') result.currentUserId = 'account-demo-admin'
    auditAction = operation === 'account.create' ? 'account.created' : 'account.updated'
    targetId = account.id
    detail = `${operation === 'account.create' ? 'Created' : 'Updated'} account for ${account.name}`
  } else if (operation === 'account.delete') {
    const account = accounts.find((candidate) => candidate.id === payload.id)
    if (!account) return { ok: false, msg: 'Account no longer exists.' }
    if (account.system) return { ok: false, msg: 'The built-in demo administrator account is protected.' }
    if (actorId === account.id) return { ok: false, msg: 'You cannot remove your own access account.' }
    if (account.status === 'active' && roleFor(security, account.roleId)?.permissions.security === 'full' && activeAdminCount(security) <= 1) {
      return { ok: false, msg: 'You cannot remove the last active security administrator.' }
    }
    result.accounts = accounts.filter((candidate) => candidate.id !== account.id)
    if (result.currentUserId === account.id) result.currentUserId = 'account-demo-admin'
    auditAction = 'account.deleted'
    targetId = account.id
    detail = `Deleted account for ${account.name}`
  } else if (operation === 'staff.remove') {
    const linked = accounts.find((account) => account.staffId === payload.staffId)
    if (!linked) return { ok: true, security, msg: 'No linked account needed revoking.' }
    result.accounts = accounts.map((account) => account.staffId === payload.staffId
      ? { ...account, staffId: null, status: 'suspended', updatedAt: at }
      : account)
    if (result.currentUserId === linked.id) result.currentUserId = 'account-demo-admin'
    auditAction = 'account.suspended.staff-removed'
    targetId = linked.id
    detail = `Suspended ${linked.name}'s account because the staff profile was removed`
  } else if (operation === 'account.switch') {
    const account = accounts.find((candidate) => candidate.id === payload.id)
    if (!account || account.status !== 'active') return { ok: false, msg: 'That account is not active and cannot be previewed.' }
    result.currentUserId = account.id
    auditAction = 'demo.account.previewed'
    targetId = account.id
    detail = `Switched local demo preview to ${account.name}`
  } else {
    return { ok: false, msg: 'Unknown security change.' }
  }

  if (!result.accounts.some((account) => account.status === 'active' && roleFor({ ...security, roles: result.roles }, account.roleId)?.permissions.security === 'full')) {
    return { ok: false, msg: 'At least one active user must retain full Security access.' }
  }
  const audit = [...security.audit, auditEntry(auditAction, actorId, targetId, at, detail)].slice(-200)
  return { ok: true, security: { schemaVersion: 1, ...result, audit }, msg: 'Security settings saved.' }
}
