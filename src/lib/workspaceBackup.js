import { normalizeSecurity, validateSecurityConfig } from './security'

// Durable workspace data. UI navigation and undo history are intentionally not backed up:
// they are transient, and serializing 25 full undo snapshots can exhaust localStorage.
export const WORKSPACE_FIELDS = [
  'appts', 'claims', 'payments', 'invoices', 'verificationForms', 'eraImports',
  'billedFiles', 'qbo', 'staff', 'clients', 'teams', 'payers', 'svcs',
  'customFields', 'settings', 'security', 'reports', 'dash', 'meta',
  // payroll: master data, timesheet decisions, pay runs and their exports
  'payProfiles', 'paySheets', 'payRuns', 'payExports',
  // intake manager: the pre-client pipeline + the referral relationships it attributes to
  'intakeRequests', 'referralSources',
  // client statements issued to families (billing)
  'statements',
  // cabinet: register of expiring documents (metadata only)
  'cabinet',
]

export const BACKUP_FORMAT = 'aloha-aba-workspace'
export const BACKUP_VERSION = 3
const PRE_SECURITY_FIELDS = WORKSPACE_FIELDS.filter((key) => key !== 'security')

const maps = ['appts', 'claims', 'payments', 'invoices', 'verificationForms', 'eraImports', 'billedFiles', 'qbo', 'paySheets', 'payRuns', 'payExports', 'intakeRequests', 'statements', 'cabinet']
const lists = ['staff', 'clients', 'teams', 'payers', 'svcs', 'customFields', 'payProfiles', 'referralSources']
const record = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

export function workspaceData(state) {
  const data = Object.fromEntries(WORKSPACE_FIELDS.map((key) => [key, state[key]]))
  // A staff removal/rebuild must never export dangling account-to-profile links.
  // Normalize against the exact staff roster that travels in this backup.
  data.security = normalizeSecurity(state.security, state.staff || [])
  return data
}

export function createWorkspaceBackup(state, exported = new Date().toISOString()) {
  return JSON.stringify({ format: BACKUP_FORMAT, version: BACKUP_VERSION, exported, data: workspaceData(state) })
}

function validate(data, fields) {
  if (!record(data)) throw new Error('Backup is missing workspace data')
  for (const key of fields) {
    const value = data[key]
    if (maps.includes(key)) {
      if (!record(value) || Object.entries(value).some(([id, item]) => !record(item) || item.id !== id)) {
        throw new Error(`Backup has an invalid ${key} ledger`)
      }
    } else if (lists.includes(key)) {
      if (!Array.isArray(value) || value.some((item) => !record(item) || typeof item.id !== 'string' || !item.id)) {
        throw new Error(`Backup has an invalid ${key} list`)
      }
    } else if (!record(value)) {
      throw new Error(`Backup is missing ${key}`)
    }
  }
  if (!Array.isArray(data.reports.saved) || data.reports.saved.some((r) => !record(r) || typeof r.id !== 'string') ||
      !Array.isArray(data.dash.widgets) || data.dash.widgets.some((w) => !record(w) || typeof w.id !== 'string' || typeof w.type !== 'string') ||
      (data.dash.boards !== undefined && (!Array.isArray(data.dash.boards) || data.dash.boards.some((b) => !record(b) || !Array.isArray(b.widgets))))) {
    throw new Error('Backup has invalid saved reports or dashboards')
  }
  if (fields.includes('security')) validateSecurityConfig(data.security, data.staff, data.settings)
  if (Object.values(data.appts).some((a) => typeof a.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(a.date) ||
      !Number.isFinite(a.start) || !Number.isFinite(a.end) || !Array.isArray(a.clientIds) || !Array.isArray(a.staffIds) ||
      typeof a.type !== 'string' || typeof a.status !== 'string')) {
    throw new Error('Backup has invalid appointments')
  }
  if (Object.values(data.claims).some((c) => !Array.isArray(c.lines) || c.lines.some((l) => !record(l) || typeof l.apptId !== 'string') ||
      typeof c.clientId !== 'string' || typeof c.no !== 'string' || typeof c.status !== 'string' || !Number.isFinite(c.charges))) {
    throw new Error('Backup has invalid claims')
  }
  // Payroll: a restored backup must not invent wages or an inconsistent register.
  // Every profile needs a real staff member, every processed run must carry the
  // register it locked (so YTD and stubs can be rebuilt), and no run may sit in
  // an unknown status.
  const staffIds = new Set(data.staff.map((s) => s.id))
  const clientIds = new Set(data.clients.map((c) => c.id))
  const RUN_STATES = ['draft', 'pending_approval', 'approved', 'processed', 'voided']
  if (data.payProfiles.some((p) => !staffIds.has(p.staffId) || typeof p.staffId !== 'string' ||
      !['hourly', 'salary', 'session'].includes(p.payType) ||
      (p.payType === 'hourly' && !Number.isFinite(p.baseRate)) ||
      (p.payType === 'salary' && !Number.isFinite(p.annualSalary)) ||
      !Array.isArray(p.deductions))) {
    throw new Error('Backup has invalid payroll profiles')
  }
  if (Object.values(data.paySheets).some((s) => ![ 'open', 'submitted', 'approved', 'rejected', 'processed' ].includes(s.status) ||
      !Array.isArray(s.adjustments) || !String(s.staffId || '').length)) {
    throw new Error('Backup has invalid timesheet records')
  }
  if (Object.values(data.payRuns).some((r) => !RUN_STATES.includes(r.status) ||
      (r.locked && (!Array.isArray(r.lines) || r.lines.some((l) => !Number.isFinite(l.grossCents) || !Number.isFinite(l.netCents) || !Number.isFinite(l.taxCents)))))) {
    throw new Error('Backup has invalid pay runs')
  }
  if (Object.values(data.payExports).some((e) => !String(e.kind || '').length)) {
    throw new Error('Backup has invalid payroll export records')
  }
  // Intake: a restored pipeline must not invent a chart link. A converted
  // request has to point at a client the file actually carries, and every
  // non-converted request must not claim one.
  const INTAKE_STAGE_IDS = ['new', 'contacted', 'screened', 'benefits', 'review', 'waitlist', 'scheduled', 'assessment', 'auth', 'converted', 'closed']
  const intakeSourceIds = new Set(data.referralSources.map((s) => s.id))
  if (data.referralSources.some((s) => typeof s.name !== 'string' || !String(s.name).trim() ||
      (s.status !== undefined && !['active', 'dormant', 'inactive'].includes(s.status)))) {
    throw new Error('Backup has invalid referral sources')
  }
  if (Object.values(data.intakeRequests).some((r) => !INTAKE_STAGE_IDS.includes(r.stage) ||
      typeof r.firstName !== 'string' || typeof r.lastName !== 'string' || !Number.isFinite(r.createdAt) ||
      !Array.isArray(r.contacts) || !Array.isArray(r.consents) || !Array.isArray(r.events) ||
      (r.contacts || []).some((c) => !record(c) || typeof c.channel !== 'string') ||
      (r.referralSourceId && !intakeSourceIds.has(r.referralSourceId)) ||
      (r.stage === 'converted' ? !r.clientId || !clientIds.has(r.clientId) : Boolean(r.clientId)) ||
      (r.stage === 'closed' && !r.lost?.reason))) {
    throw new Error('Backup has invalid intake requests')
  }
  if (Object.values(data.payments).some((p) => !Number.isFinite(p.amount)) ||
      data.clients.some((c) => typeof c.name !== 'string') || data.staff.some((s) => typeof s.name !== 'string') ||
      data.payers.some((p) => typeof p.name !== 'string')) {
    throw new Error('Backup has invalid financial or roster records')
  }
  // The new patient cash aggregate is stored on the primary for dueOf(), but
  // every cent must also have one active receipt in the existing payment ledger.
  // Reject a partial/corrupt import instead of inventing patient A/R or cash.
  const cents = (value) => typeof value === 'number' && Number.isFinite(value) &&
    value >= 0 && Math.abs(value * 100 - Math.round(value * 100)) < 0.000001 ? Math.round(value * 100) : null
  const patientPayments = Object.values(data.payments).filter((p) => p.kind === 'patient')
  const reversals = new Set()
  for (const p of patientPayments) {
    const claim = data.claims[p.claimId]
    if (!claim || claim.method === 'secondary' || p.clientId !== claim.clientId ||
        !['check', 'eft', 'cash', 'card'].includes(p.method) || !String(p.ref || '').trim() ||
        (p.patientSourceClaimId && !data.claims[p.patientSourceClaimId])) throw new Error('Backup has an invalid patient receipt')
    if (p.reversalOf) {
      const original = data.payments[p.reversalOf]
      if (!original || original.kind !== 'patient' || original.reversalOf || original.claimId !== p.claimId ||
          original.clientId !== p.clientId || cents(-p.amount) !== cents(original.amount) || reversals.has(original.id)) {
        throw new Error('Backup has an invalid patient receipt reversal')
      }
      reversals.add(original.id)
    } else if (!cents(p.amount)) throw new Error('Backup has an invalid patient receipt amount')
  }
  for (const claim of Object.values(data.claims)) {
    const total = cents(claim.patientPaid ?? 0)
    const beforePatient = claim.charges - (claim.paid || 0) - (claim.adj || 0) - (claim.secondaryPaid || 0)
    if (total === null || (total > 0 && (!Number.isFinite(beforePatient) || total > Math.round(beforePatient * 100))) ||
        ((claim.method === 'secondary' || claim.status === 'void') && total) ||
        total !== patientPayments.filter((p) => p.claimId === claim.id && !p.reversalOf && !reversals.has(p.id))
          .reduce((sum, p) => sum + cents(p.amount), 0)) {
      throw new Error('Backup has an unreconciled patient receipt ledger')
    }
  }
}

export const validateWorkspaceData = (data) => validate(data, WORKSPACE_FIELDS)

// Earlier releases exported just seven fields at the top level. Do not silently
// mix their claims with today's payments/files: missing collections start empty.
// The caller supplies a fresh blankState as defaults for masters not in that format.
export function readWorkspaceBackup(text, defaults) {
  let file
  try { file = typeof text === 'string' ? JSON.parse(text) : text } catch { throw new Error('Backup is not valid JSON') }
  if (!record(file)) throw new Error('Not an Aloha ABA workspace backup')

  let data
  let legacy = false
  if (file.format === BACKUP_FORMAT) {
    if (![2, BACKUP_VERSION].includes(file.version)) throw new Error(`Unsupported backup version ${file.version}`)
    data = file.data
    if (!record(data)) throw new Error('Backup is missing workspace data')
    if (file.version === 2) {
      // Version 2 predates local role/account metadata. Add the current workspace's
      // demo security defaults, linked only to staff rows present in the backup.
      validate(data, PRE_SECURITY_FIELDS)
      data = { ...workspaceData(defaults), ...data, security: normalizeSecurity(defaults.security, data.staff) }
    } else {
      // statements arrived after version 3 shipped: an older v3 file simply has none yet
      data = { ...data, statements: data.statements ?? {}, cabinet: data.cabinet ?? {} }
      validate(data, WORKSPACE_FIELDS)
    }
    data = { ...workspaceData(data), meta: { ...data.meta, pcfCleared: true, legacyCustomCleared: true } } // ignore history; never erase captured answers on restore
  } else if (!file.format && typeof file.exported === 'string') {
    legacy = true
    const oldFields = ['appts', 'claims', 'staff', 'clients', 'teams', 'settings', 'reports']
    // Validate the real (v1) export shape; an arbitrary JSON with an `appts` key
    // is not a backup and must not replace the user's live workspace.
    for (const key of oldFields) {
      if (!(key in file)) throw new Error(`Older backup is missing ${key}`)
    }
    data = {
      ...workspaceData(defaults),
      ...Object.fromEntries(oldFields.map((key) => [key, file[key]])),
      security: normalizeSecurity(defaults.security, file.staff),
      payments: {}, invoices: {}, verificationForms: {}, eraImports: {}, billedFiles: {}, qbo: {},
      payProfiles: defaults.payProfiles || [], paySheets: {}, payRuns: {}, payExports: {},
      intakeRequests: {}, referralSources: defaults.referralSources || [], statements: {}, cabinet: {},
      // Preserve any captured appointment fields rather than rerunning old cleanup
      // migrations on data restored from a backup.
      meta: { pcfCleared: true, legacyCustomCleared: true },
    }
    validate(data, WORKSPACE_FIELDS)
  } else {
    throw new Error('Not an Aloha ABA workspace backup')
  }

  return { data, legacy, counts: { appointments: Object.keys(data.appts).length, claims: Object.keys(data.claims).length, payments: Object.keys(data.payments).length, intakeRequests: Object.keys(data.intakeRequests).length, referralSources: data.referralSources.length } }
}
