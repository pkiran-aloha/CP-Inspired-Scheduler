// Durable workspace data. UI navigation and undo history are intentionally not backed up:
// they are transient, and serializing 25 full undo snapshots can exhaust localStorage.
export const WORKSPACE_FIELDS = [
  'appts', 'claims', 'payments', 'invoices', 'verificationForms', 'eraImports',
  'billedFiles', 'qbo', 'staff', 'clients', 'teams', 'payers', 'svcs',
  'customFields', 'settings', 'reports', 'dash', 'meta',
]

export const BACKUP_FORMAT = 'aloha-aba-workspace'
export const BACKUP_VERSION = 2

const maps = ['appts', 'claims', 'payments', 'invoices', 'verificationForms', 'eraImports', 'billedFiles', 'qbo']
const lists = ['staff', 'clients', 'teams', 'payers', 'svcs', 'customFields']
const record = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

export function workspaceData(state) {
  return Object.fromEntries(WORKSPACE_FIELDS.map((key) => [key, state[key]]))
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
  if (Object.values(data.appts).some((a) => typeof a.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(a.date) ||
      !Number.isFinite(a.start) || !Number.isFinite(a.end) || !Array.isArray(a.clientIds) || !Array.isArray(a.staffIds) ||
      typeof a.type !== 'string' || typeof a.status !== 'string')) {
    throw new Error('Backup has invalid appointments')
  }
  if (Object.values(data.claims).some((c) => !Array.isArray(c.lines) || c.lines.some((l) => !record(l) || typeof l.apptId !== 'string') ||
      typeof c.clientId !== 'string' || typeof c.no !== 'string' || typeof c.status !== 'string' || !Number.isFinite(c.charges))) {
    throw new Error('Backup has invalid claims')
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
    if (file.version !== BACKUP_VERSION) throw new Error(`Unsupported backup version ${file.version}`)
    data = file.data
    if (!record(data)) throw new Error('Backup is missing workspace data')
    validate(data, WORKSPACE_FIELDS)
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
      payments: {}, invoices: {}, verificationForms: {}, eraImports: {}, billedFiles: {}, qbo: {},
      // Preserve any captured appointment fields rather than rerunning old cleanup
      // migrations on data restored from a backup.
      meta: { pcfCleared: true, legacyCustomCleared: true },
    }
    validate(data, WORKSPACE_FIELDS)
  } else {
    throw new Error('Not an Aloha ABA workspace backup')
  }

  return { data, legacy, counts: { appointments: Object.keys(data.appts).length, claims: Object.keys(data.claims).length, payments: Object.keys(data.payments).length } }
}
