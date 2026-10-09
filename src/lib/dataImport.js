/**
 * chunk-42 — Data Import.
 *
 * A real import path for the three records a practice actually migrates first:
 * clients, staff and appointments. The planner is deliberately conservative —
 * nothing is written until the whole file validates, every row is reported with
 * a line number and a reason, and the commit is one undoable transaction with a
 * log entry so the workspace remembers what came in and what was skipped.
 *
 * There is no OCR, no Excel parsing and no network fetch: the operator pastes or
 * picks a UTF-8 CSV. That is the honest seam.
 */
import { uid } from './model'
import { STATUSES } from './model'
import { apptStatusList, officeNames, settingsOffices, stopViolationsForDraft } from './settingsMasters'
import { ABA_ACTIVITIES } from './abaHours'
import { isServiceAppt } from './model'
import { parseISO, isoDate } from './date'

export const IMPORT_CATEGORIES = [
  {
    id: 'payer',
    label: 'Payer',
    blurb: 'Import payer master profiles and contracted service fee schedules.',
    types: ['payers', 'payer-services'],
  },
  {
    id: 'staff',
    label: 'Staff',
    blurb: 'Import staff profiles, credentials/qualifications, NPIs, and earning code pay rates.',
    types: ['staff', 'staff-qualifications', 'staff-npis', 'staff-earning-codes'],
  },
  {
    id: 'client',
    label: 'Client',
    blurb: 'Import client demographics, parent/guardian contacts, and authorization windows.',
    types: ['clients', 'client-contacts', 'client-authorizations'],
  },
  {
    id: 'appointments',
    label: 'Appointments',
    blurb: 'Bulk-schedule historical or upcoming sessions against existing clients and staff.',
    types: ['appointments'],
  },
]

export const IMPORT_TYPES = [
  {
    id: 'clients', category: 'client', subLabel: 'Profile', label: 'Clients', icon: 'pin',
    blurb: 'One row per client: demographics, guardian contact, program and home location.',
    fields: [
      { key: 'name', label: 'Client name', required: true, sample: 'Ava Thompson' },
      { key: 'dob', label: 'Date of birth', sample: '2018-04-12', help: 'YYYY-MM-DD or M/D/YYYY' },
      { key: 'sex', label: 'Sex', sample: 'F', help: 'M / F / X' },
      { key: 'guardian', label: 'Guardian', sample: 'D. Thompson' },
      { key: 'guardianPhone', label: 'Guardian phone', sample: '(408) 555-0107' },
      { key: 'guardianEmail', label: 'Guardian email', sample: 'd.thompson@example.com' },
      { key: 'program', label: 'Program', sample: 'Center-based · 1:1' },
      { key: 'home', label: 'Home location', sample: 'Main Center', help: 'Must match an office/location in Settings → Organization' },
      { key: 'payer', label: 'Payer', sample: 'Aetna', help: 'Matched against the payer master by name or short name' },
      { key: 'referralSource', label: 'Referral source', sample: 'Pediatrician' },
      { key: 'notes', label: 'Notes', sample: '' },
    ],
  },
  {
    id: 'client-contacts', category: 'client', subLabel: 'Contacts', label: 'Client Contacts', icon: 'pin',
    blurb: 'Import parent, guardian, and emergency contacts linked to existing clients.',
    fields: [
      { key: 'client', label: 'Client name', required: true, sample: 'Ava Thompson' },
      { key: 'guardian', label: 'Contact name', required: true, sample: 'Erik Thompson' },
      { key: 'relation', label: 'Relationship', sample: 'Father' },
      { key: 'guardianPhone', label: 'Phone', sample: '(408) 555-0131' },
      { key: 'guardianEmail', label: 'Email', sample: 'erik@example.com' },
    ],
  },
  {
    id: 'client-authorizations', category: 'client', subLabel: 'Authorizations', label: 'Client Authorizations', icon: 'pin',
    blurb: 'Update client authorization numbers, weekly hours, and start/end dates.',
    fields: [
      { key: 'client', label: 'Client name', required: true, sample: 'Ava Thompson' },
      { key: 'authNo', label: 'Authorization #', required: true, sample: 'AUTH-2026-99102' },
      { key: 'authWeekly', label: 'Weekly hours', sample: '25' },
      { key: 'authStart', label: 'Start date', required: true, sample: '2026-01-01' },
      { key: 'authEnd', label: 'End date', required: true, sample: '2026-12-31' },
    ],
  },
  {
    id: 'staff', category: 'staff', subLabel: 'Profile', label: 'Staff', icon: 'team',
    blurb: 'One row per employee: role, credentials, contact details and home office.',
    fields: [
      { key: 'name', label: 'Full name', required: true, sample: 'Jordan Alvarez' },
      { key: 'role', label: 'Role', required: true, sample: 'RBT · Center' },
      { key: 'cert', label: 'Credential', sample: 'RBT #24-01-0001' },
      { key: 'email', label: 'Email', sample: 'jordan.alvarez@example.com' },
      { key: 'phone', label: 'Phone', sample: '(408) 555-0109' },
      { key: 'fte', label: 'FTE', sample: '1', help: '0–1' },
      { key: 'targetWeekH', label: 'Target hours / week', sample: '32' },
      { key: 'payrollRate', label: 'Pay rate', sample: '27', help: 'Hourly rate for payroll defaults' },
      { key: 'office', label: 'Office', sample: 'Main Center', help: 'Must match an office in Settings → Organization' },
    ],
  },
  {
    id: 'staff-qualifications', category: 'staff', subLabel: 'Qualifications', label: 'Staff Qualifications', icon: 'team',
    blurb: 'Import credential and license assignments for existing staff members.',
    fields: [
      { key: 'staff', label: 'Staff name', required: true, sample: 'Jordan Alvarez' },
      { key: 'cert', label: 'Qualification', required: true, sample: 'RBT' },
      { key: 'licenseNo', label: 'Certificate #', sample: 'RBT-24-01-0001' },
      { key: 'expiresAt', label: 'Expiration date', sample: '2027-06-30' },
    ],
  },
  {
    id: 'staff-npis', category: 'staff', subLabel: "NPI's", label: 'Staff NPIs', icon: 'team',
    blurb: 'Assign 10-digit National Provider Identifiers and taxonomy codes to staff.',
    fields: [
      { key: 'staff', label: 'Staff name', required: true, sample: 'Jordan Alvarez' },
      { key: 'npi', label: 'NPI', required: true, sample: '1234567893', help: '10-digit National Provider Identifier' },
      { key: 'taxonomy', label: 'Taxonomy code', sample: '106S00000X' },
      { key: 'medicaidId', label: 'Medicaid ID', sample: 'CA-MED-9041' },
    ],
  },
  {
    id: 'staff-earning-codes', category: 'staff', subLabel: 'Earning Codes', label: 'Staff Earning Codes', icon: 'team',
    blurb: 'Assign per-earning-code hourly pay rates to staff payroll profiles.',
    fields: [
      { key: 'staff', label: 'Staff name', required: true, sample: 'Jordan Alvarez' },
      { key: 'code', label: 'Earning code', required: true, sample: 'REG' },
      { key: 'rate', label: 'Hourly rate', required: true, sample: '27.50' },
    ],
  },
  {
    id: 'payers', category: 'payer', subLabel: 'Profile', label: 'Payer Profiles', icon: 'shield',
    blurb: 'Import insurance payers, EDI payer IDs, clearinghouse and timely filing rules.',
    fields: [
      { key: 'name', label: 'Payer name', required: true, sample: 'Cigna Behavioral Health' },
      { key: 'payerId', label: 'EDI Payer ID', sample: '62308' },
      { key: 'cmsType', label: 'CMS Program Type', sample: 'Commercial' },
      { key: 'clearingHouse', label: 'Clearinghouse', sample: 'Availity' },
      { key: 'phone', label: 'Phone', sample: '(800) 882-4462' },
    ],
  },
  {
    id: 'payer-services', category: 'payer', subLabel: 'Services', label: 'Payer Services', icon: 'shield',
    blurb: 'Import payer-specific contracted CPT codes and charge rates.',
    fields: [
      { key: 'payer', label: 'Payer name', required: true, sample: 'Aetna' },
      { key: 'code', label: 'Billing code', required: true, sample: '97153' },
      { key: 'label', label: 'Service name', sample: 'Direct ABA 1:1' },
      { key: 'charge', label: 'Contracted rate', required: true, sample: '68.00' },
    ],
  },
  {
    id: 'appointments', category: 'appointments', subLabel: 'Appointments', label: 'Appointments', icon: 'cal',
    blurb: 'One row per session. Client and staff names must already exist in the roster.',
    fields: [
      { key: 'date', label: 'Date', required: true, sample: '2026-10-06', help: 'YYYY-MM-DD or M/D/YYYY' },
      { key: 'start', label: 'Start', required: true, sample: '09:00', help: 'HH:MM (24-hour) or H:MM AM/PM' },
      { key: 'end', label: 'End', required: true, sample: '11:00' },
      { key: 'client', label: 'Client', required: true, sample: 'Ava Thompson', help: 'Matched against the client roster' },
      { key: 'staff', label: 'Staff', required: true, sample: 'Jordan Alvarez; Neha Peyyeti', help: 'Separate multiple staff with a semicolon' },
      { key: 'type', label: 'Type', sample: 'service', help: 'service / supervision / evaluation / drive / break / unavailable' },
      { key: 'location', label: 'Location', sample: 'Main Center' },
      { key: 'status', label: 'Status', sample: 'active', help: 'Status key or label from Settings → Appointment Status' },
      { key: 'title', label: 'Title (optional)', sample: '' },
      { key: 'notes', label: 'Notes', sample: '' },
      { key: 'abaHours', label: 'ABA hours (behavior-analytic)', sample: 'group-training',
        help: 'Non-service appointments only. An activity id (group-training, intervention-design, data-analysis, assessment-writing, technician-training, coursework) or yes. Cleaning the clinic and general admin never count.' },
    ],
  },
]

export const importType = (id) => IMPORT_TYPES.find((t) => t.id === id) || IMPORT_TYPES[0]
export const IMPORT_LIMIT = 500

/* ── CSV ───────────────────────────────────────────────────────────────────── */

/** RFC-4180-ish: quoted fields, escaped quotes, CRLF or LF. */
export function parseCSV(text) {
  const src = String(text || '').replace(/^\uFEFF/, '')
  const rows = []
  let row = []
  let field = ''
  let quoted = false
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i++ }
        else quoted = false
      } else field += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') { row.push(field); field = '' }
    else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = '' }
    else if (ch !== '\r') field += ch
  }
  if (field.length || row.length) { row.push(field); rows.push(row) }
  const clean = rows.filter((r) => r.some((c) => String(c).trim() !== ''))
  if (!clean.length) return { header: [], rows: [] }
  const header = clean[0].map((h) => String(h).trim())
  return { header, rows: clean.slice(1).map((r) => header.map((_, i) => String(r[i] ?? '').trim())) }
}

export const toCSV = (header, rows) => [header, ...rows]
  .map((r) => r.map((c) => (/[",\n]/.test(String(c)) ? `"${String(c).replace(/"/g, '""')}"` : String(c))).join(','))
  .join('\n')

export function templateCSV(typeId) {
  const type = importType(typeId)
  const header = type.fields.map((f) => f.label)
  const sample = type.fields.map((f) => f.sample)
  const second = type.fields.map((f) => (f.key === 'name' || f.key === 'client' ? '' : f.key === 'date' ? '2026-10-07' : ''))
  return toCSV(header, [sample, second])
}

/* ── mapping ───────────────────────────────────────────────────────────────── */

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '')
export function guessMapping(typeId, header) {
  const type = importType(typeId)
  const map = {}
  const used = new Set()
  header.forEach((col, i) => {
    const label = norm(col)
    if (!label) return
    let hit = type.fields.find((f) => norm(f.label) === label || norm(f.key) === label)
    if (!hit) hit = type.fields.find((f) => !used.has(f.key) && (norm(f.label).startsWith(label) || label.startsWith(norm(f.label)) || norm(f.label).includes(label)))
    if (hit && !used.has(hit.key)) { map[i] = hit.key; used.add(hit.key) }
  })
  return map
}

/* ── coercion + validation ─────────────────────────────────────────────────── */

const US_DATE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/
export function parseDateCell(value) {
  const s = String(value || '').trim()
  if (!s) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  const m = US_DATE.exec(s)
  if (!m) return null
  const [, a, b, y] = m
  const month = Number(a)
  const day = Number(b)
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  return `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

export function parseTimeCell(value) {
  const s = String(value || '').trim().toLowerCase()
  if (!s) return null
  const m = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/.exec(s)
  if (!m) return null
  let h = Number(m[1])
  const min = Number(m[2] || 0)
  if (m[3] === 'pm' && h < 12) h += 12
  if (m[3] === 'am' && h === 12) h = 0
  if (h > 23 || min > 59) return null
  return h * 60 + min
}

const clean = (v, max = 160) => String(v == null ? '' : v).trim().slice(0, max)
const isEmail = (v) => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)

/** Turn raw mapped rows into typed records + per-row errors. */
export function validateImport(state, typeId, matrix, mapping) {
  const type = importType(typeId)
  const required = type.fields.filter((f) => f.required).map((f) => f.key)
  const issues = []
  const records = []
  const seen = new Set()
  // appointment rows are validated against each other as well as the live calendar
  const importAppts = {}
  matrix.forEach((row, index) => {
    const raw = {}
    for (const [col, key] of Object.entries(mapping)) if (key) raw[key] = row[Number(col)] ?? ''
    const line = index + 2 // header is line 1
    const errs = []
    for (const key of required) if (!clean(raw[key])) errs.push(`${type.fields.find((f) => f.key === key).label} is required`)
    const rec = { line, raw }
    if (typeId === 'clients') {
      rec.name = clean(raw.name, 80)
      rec.dob = parseDateCell(raw.dob)
      if (raw.dob && !rec.dob) errs.push('Date of birth must be YYYY-MM-DD or M/D/YYYY')
      if (rec.dob && rec.dob > isoDate(new Date())) errs.push('Date of birth is in the future')
      rec.sex = /^(m|f|x)$/i.test(clean(raw.sex)) ? clean(raw.sex).toUpperCase() : ''
      if (raw.sex && !rec.sex) errs.push('Sex must be M, F or X')
      rec.guardian = clean(raw.guardian, 80)
      rec.guardianPhone = clean(raw.guardianPhone, 24)
      rec.guardianEmail = clean(raw.guardianEmail, 120)
      if (!isEmail(rec.guardianEmail)) errs.push('Guardian email does not look valid')
      rec.program = clean(raw.program, 80)
      rec.home = clean(raw.home, 80)
      if (rec.home && !officeNames(state.settings).includes(rec.home)) errs.push(`Home location “${rec.home}” is not an office. Add it in Settings → Organization first`)
      rec.referralSource = clean(raw.referralSource, 80)
      rec.notes = clean(raw.notes, 400)
      const dup = (state.clients || []).find((c) => c.name.toLowerCase() === rec.name.toLowerCase() && (rec.dob ? c.dob === rec.dob : true))
      rec.existingId = dup?.id || null
    } else if (typeId === 'staff') {
      rec.name = clean(raw.name, 80)
      rec.role = clean(raw.role, 80)
      rec.cert = clean(raw.cert, 80)
      rec.email = clean(raw.email, 120)
      if (!isEmail(rec.email)) errs.push('Email does not look valid')
      rec.phone = clean(raw.phone, 24)
      rec.fte = raw.fte === '' ? 1 : Number(raw.fte)
      if (!Number.isFinite(rec.fte) || rec.fte < 0 || rec.fte > 1) errs.push('FTE must be a number between 0 and 1')
      rec.targetWeekH = raw.targetWeekH === '' ? 20 : Number(raw.targetWeekH)
      if (!Number.isFinite(rec.targetWeekH) || rec.targetWeekH < 0 || rec.targetWeekH > 80) errs.push('Target hours must be between 0 and 80')
      rec.payrollRate = raw.payrollRate === '' ? 0 : Number(raw.payrollRate)
      if (!Number.isFinite(rec.payrollRate) || rec.payrollRate < 0 || rec.payrollRate > 500) errs.push('Pay rate must be between 0 and 500')
      rec.office = clean(raw.office, 80)
      if (rec.office && !officeNames(state.settings).includes(rec.office)) errs.push(`Office “${rec.office}” is not in the office master`)
      const dup = (state.staff || []).find((s) => s.name.toLowerCase() === rec.name.toLowerCase())
      rec.existingId = dup?.id || null
    } else if (typeId === 'client-contacts') {
      rec.clientName = clean(raw.client, 80)
      const client = (state.clients || []).find((c) => c.name.toLowerCase() === rec.clientName.toLowerCase())
      if (!client) errs.push(`Client “${rec.clientName}” is not in the roster`)
      rec.existingId = client?.id || null
      rec.guardian = clean(raw.guardian, 80)
      rec.relation = clean(raw.relation, 40)
      rec.guardianPhone = clean(raw.guardianPhone, 24)
      rec.guardianEmail = clean(raw.guardianEmail, 120)
      if (!isEmail(rec.guardianEmail)) errs.push('Email does not look valid')
    } else if (typeId === 'client-authorizations') {
      rec.clientName = clean(raw.client, 80)
      const client = (state.clients || []).find((c) => c.name.toLowerCase() === rec.clientName.toLowerCase())
      if (!client) errs.push(`Client “${rec.clientName}” is not in the roster`)
      rec.existingId = client?.id || null
      rec.authNo = clean(raw.authNo, 60)
      rec.authWeekly = raw.authWeekly === '' ? 20 : Number(raw.authWeekly)
      if (!Number.isFinite(rec.authWeekly) || rec.authWeekly <= 0) errs.push('Weekly hours must be a positive number')
      rec.authStart = parseDateCell(raw.authStart)
      rec.authEnd = parseDateCell(raw.authEnd)
      if (!rec.authStart) errs.push('Start date must be YYYY-MM-DD or M/D/YYYY')
      if (!rec.authEnd) errs.push('End date must be YYYY-MM-DD or M/D/YYYY')
      if (rec.authStart && rec.authEnd && rec.authEnd < rec.authStart) errs.push('End date must be on or after start date')
    } else if (typeId === 'staff-qualifications') {
      rec.staffName = clean(raw.staff, 80)
      const person = (state.staff || []).find((s) => s.name.toLowerCase() === rec.staffName.toLowerCase())
      if (!person) errs.push(`Staff “${rec.staffName}” is not in the roster`)
      rec.existingId = person?.id || null
      rec.cert = clean(raw.cert, 80)
      rec.licenseNo = clean(raw.licenseNo, 60)
      rec.expiresAt = raw.expiresAt ? parseDateCell(raw.expiresAt) : ''
      if (raw.expiresAt && !rec.expiresAt) errs.push('Expiration date must be YYYY-MM-DD or M/D/YYYY')
    } else if (typeId === 'staff-npis') {
      rec.staffName = clean(raw.staff, 80)
      const person = (state.staff || []).find((s) => s.name.toLowerCase() === rec.staffName.toLowerCase())
      if (!person) errs.push(`Staff “${rec.staffName}” is not in the roster`)
      rec.existingId = person?.id || null
      rec.npi = clean(raw.npi, 20).replace(/\D/g, '')
      if (!/^\d{10}$/.test(rec.npi)) errs.push('NPI must be a 10-digit number')
      rec.taxonomy = clean(raw.taxonomy, 30)
      rec.medicaidId = clean(raw.medicaidId, 40)
    } else if (typeId === 'staff-earning-codes') {
      rec.staffName = clean(raw.staff, 80)
      const person = (state.staff || []).find((s) => s.name.toLowerCase() === rec.staffName.toLowerCase())
      if (!person) errs.push(`Staff “${rec.staffName}” is not in the roster`)
      rec.existingId = person?.id || null
      rec.code = clean(raw.code, 20).toUpperCase()
      rec.rate = Number(raw.rate)
      if (!Number.isFinite(rec.rate) || rec.rate < 0 || rec.rate > 500) errs.push('Hourly rate must be between 0 and 500')
    } else if (typeId === 'payers') {
      rec.name = clean(raw.name, 80)
      rec.payerId = clean(raw.payerId, 30)
      rec.cmsType = clean(raw.cmsType, 60) || 'Commercial'
      rec.clearingHouse = clean(raw.clearingHouse, 60) || 'Office Ally'
      rec.phone = clean(raw.phone, 24)
      const dup = (state.payers || []).find((p) => p.name.toLowerCase() === rec.name.toLowerCase())
      rec.existingId = dup?.id || null
    } else if (typeId === 'payer-services') {
      rec.payerName = clean(raw.payer, 80)
      const payer = (state.payers || []).find((p) => p.name.toLowerCase() === rec.payerName.toLowerCase())
      if (!payer) errs.push(`Payer “${rec.payerName}” is not in the payer master`)
      rec.existingId = payer?.id || null
      rec.code = clean(raw.code, 20)
      rec.label = clean(raw.label, 80) || rec.code
      rec.charge = Number(raw.charge)
      if (!Number.isFinite(rec.charge) || rec.charge < 0) errs.push('Contracted rate must be a non-negative number')
    } else {
      rec.date = parseDateCell(raw.date)
      if (!rec.date) errs.push('Date must be YYYY-MM-DD or M/D/YYYY')
      rec.start = parseTimeCell(raw.start)
      rec.end = parseTimeCell(raw.end)
      if (rec.start == null) errs.push('Start time must be HH:MM or H:MM AM/PM')
      if (rec.end == null) errs.push('End time must be HH:MM or H:MM AM/PM')
      if (rec.start != null && rec.end != null && rec.end <= rec.start) errs.push('End time must be after the start time')
      rec.clientName = clean(raw.client, 80)
      const client = (state.clients || []).find((c) => c.name.toLowerCase() === rec.clientName.toLowerCase())
      if (!client) errs.push(`Client “${rec.clientName}” is not in the roster`)
      rec.clientId = client?.id || null
      rec.staffNames = clean(raw.staff, 200).split(/[;|]/).map((s) => s.trim()).filter(Boolean)
      rec.staffIds = []
      for (const name of rec.staffNames) {
        const person = (state.staff || []).find((s) => s.name.toLowerCase() === name.toLowerCase())
        if (!person) errs.push(`Staff “${name}” is not in the roster`)
        else rec.staffIds.push(person.id)
      }
      if (!rec.staffIds.length) errs.push('At least one known staff member is required')
      rec.type = clean(raw.type, 24).toLowerCase() || 'service'
      if (!['service', 'supervision', 'evaluation', 'drive', 'break', 'unavailable'].includes(rec.type)) errs.push(`Type “${rec.type}” is not a schedulable type`)
      rec.location = clean(raw.location, 80)
      rec.statusKey = null
      const statusRaw = clean(raw.status, 40)
      if (statusRaw) {
        const hit = apptStatusList(state.settings).find((s) => s.key === statusRaw.toLowerCase() || s.label.toLowerCase() === statusRaw.toLowerCase())
        if (!hit) errs.push(`Status “${statusRaw}” is not in the appointment status list`)
        else rec.statusKey = hit.key
      } else rec.statusKey = 'active'
      rec.title = clean(raw.title, 120)
      rec.notes = clean(raw.notes, 400)
      // ⚡ ABA Hours is a non-service flag, so an import has to say which behavior-analytic
      // activity the block is — and refuse the ones that are not behavior-analytic at all.
      rec.abaHr = false
      rec.abaActivity = ''
      const abaRaw = clean(raw.abaHours, 60).toLowerCase()
      if (abaRaw && !['no', 'n', 'false', '0'].includes(abaRaw)) {
        if (isServiceAppt({ type: rec.type })) {
          errs.push(`ABA hours applies to non-service appointments only. “${rec.type}” is service delivery`)
        } else {
          const hit = ABA_ACTIVITIES.find((a) => a.id === abaRaw || a.label.toLowerCase() === abaRaw)
          rec.abaHr = true
          if (hit) {
            rec.abaActivity = hit.id
            if (!hit.qualifies) errs.push(`“${hit.label}” is not behavior-analytic time and cannot count toward certification hours`)
          } else if (!['yes', 'y', 'true', '1'].includes(abaRaw)) {
            errs.push(`ABA activity “${abaRaw}” is not known. Use ${ABA_ACTIVITIES.filter((a) => a.qualifies).map((a) => a.id).join(', ')} or yes`)
          }
        }
      }
      const key = `${rec.clientId}|${rec.date}|${rec.start}`
      if (rec.clientId && rec.date && rec.start != null) {
        if (seen.has(key)) errs.push('Duplicate row: same client, date and start time')
        seen.add(key)
        const clash = Object.values(state.appts || {}).find((a) => (a.clientIds || []).includes(rec.clientId) && a.date === rec.date && a.start === rec.start)
        rec.existingId = clash?.id || null
      }
      // Stop-severity validation rules are a write-time invariant (audit CFG-02): an
      // import row that trips one is refused like any other booking write. Rows are
      // evaluated against the live calendar plus the rows already accepted above.
      if (rec.date && rec.start != null && rec.end != null && rec.clientId && rec.staffIds.length) {
        const wouldBe = {
          ...(rec.existingId && state.appts?.[rec.existingId] ? state.appts[rec.existingId] : {}),
          id: rec.existingId || `import-${rec.line}`,
          date: rec.date, start: rec.start, end: rec.end,
          clientIds: [rec.clientId], staffIds: rec.staffIds,
          type: rec.type, status: rec.statusKey, location: rec.location || '',
          abaHr: rec.abaHr, ...(rec.abaActivity ? { abaActivity: rec.abaActivity } : {}),
        }
        const view = { ...state, appts: { ...(state.appts || {}), ...importAppts } }
        for (const s of stopViolationsForDraft(view, wouldBe)) errs.push(`Stop rule blocks this row: ${s.label}`)
        importAppts[wouldBe.id] = wouldBe
      }
    }
    if (errs.length) issues.push({ line, errors: errs, name: rec.name || rec.clientName || '' })
    records.push(rec)
  })
  return {
    records, issues,
    valid: records.length - issues.length,
    total: records.length,
    duplicates: records.filter((r) => r.existingId).length,
  }
}

/**
 * Commit plan. `mode` decides what happens to a row that matches an existing
 * record: skip it (default, safest) or update the chart in place.
 */
export function planImport(state, typeId, matrix, mapping, { mode = 'skip', at = Date.now() } = {}) {
  const check = validateImport(state, typeId, matrix, mapping)
  if (!check.total) return { ok: false, msg: 'Nothing to import. The file has no data rows.' }
  if (check.issues.length) return { ok: false, msg: `${check.issues.length} of ${check.total} rows need fixing before anything is imported.`, check }
  if (check.total > IMPORT_LIMIT) return { ok: false, msg: `This demo imports up to ${IMPORT_LIMIT} rows at a time (file has ${check.total}).`, check }

  const creates = []
  const patches = []
  let skipped = 0
  let updated = 0
  const isChildPatchType = ['client-contacts', 'client-authorizations', 'staff-qualifications', 'staff-npis', 'staff-earning-codes', 'payer-services'].includes(typeId)
  for (const rec of check.records) {
    if (!isChildPatchType && rec.existingId && mode === 'skip') { skipped++; continue }
    if (typeId === 'clients') {
      const row = {
        id: rec.existingId || `c-${uid()}`, name: rec.name, dob: rec.dob || '', sex: rec.sex || 'X',
        guardian: rec.guardian, guardianPhone: rec.guardianPhone, guardianEmail: rec.guardianEmail,
        program: rec.program || 'Center-based · 1:1', home: rec.home || officeNames(state.settings)[0] || '',
        insurer: payerName(state, rec.raw.payer) || 'Self-pay', status: 'active', source: 'data-import',
        referralSource: rec.referralSource, notes: rec.notes, importedAt: at,
      }
      if (rec.existingId) { patches.push({ id: rec.existingId, patch: row }); updated++ } else creates.push(withCosmetics(row))
    } else if (typeId === 'client-contacts') {
      const existing = (state.clients || []).find((c) => c.id === rec.existingId)
      const contacts = [...(existing?.contacts || []), { id: `ct-${uid()}`, name: rec.guardian, relation: rec.relation || 'Guardian', phone: rec.guardianPhone, email: rec.guardianEmail }]
      patches.push({ id: rec.existingId, patch: { guardian: rec.guardian || existing?.guardian, guardianPhone: rec.guardianPhone || existing?.guardianPhone, guardianEmail: rec.guardianEmail || existing?.guardianEmail, contacts } })
      updated++
    } else if (typeId === 'client-authorizations') {
      patches.push({ id: rec.existingId, patch: { authNo: rec.authNo, authWeekly: rec.authWeekly, authStart: rec.authStart, authEnd: rec.authEnd } })
      updated++
    } else if (typeId === 'staff') {
      const row = {
        id: rec.existingId || `s-${uid()}`, name: rec.name, role: rec.role, cert: rec.cert, email: rec.email,
        phone: rec.phone, fte: rec.fte, targetWeekH: rec.targetWeekH, payrollRate: rec.payrollRate,
        office: rec.office, importedAt: at, source: 'data-import',
      }
      if (rec.existingId) { patches.push({ id: rec.existingId, patch: row }); updated++ } else creates.push(withStaffCosmetics(row))
    } else if (typeId === 'staff-qualifications') {
      const existing = (state.staff || []).find((s) => s.id === rec.existingId)
      const qualifications = [...(existing?.qualifications || []), { id: `sq-${uid()}`, name: rec.cert, licenseNo: rec.licenseNo, expiresAt: rec.expiresAt }]
      patches.push({ id: rec.existingId, patch: { cert: rec.cert || existing?.cert, qualifications } })
      updated++
    } else if (typeId === 'staff-npis') {
      patches.push({ id: rec.existingId, patch: { npi: rec.npi, taxonomy: rec.taxonomy, medicaidId: rec.medicaidId } })
      updated++
    } else if (typeId === 'staff-earning-codes') {
      patches.push({ id: rec.existingId, patch: { code: rec.code, rate: rec.rate } })
      updated++
    } else if (typeId === 'payers') {
      const row = {
        id: rec.existingId || `pay-${uid()}`, name: rec.name, payerId: rec.payerId, cmsType: rec.cmsType,
        clearingHouse: rec.clearingHouse, phone: rec.phone, status: 'active', source: 'data-import', importedAt: at,
      }
      if (rec.existingId) { patches.push({ id: rec.existingId, patch: row }); updated++ } else creates.push(row)
    } else if (typeId === 'payer-services') {
      patches.push({ id: rec.existingId, patch: { service: { id: `psvc-${uid()}`, code: rec.code, label: rec.label, charge: rec.charge, status: 'active' } } })
      updated++
    } else {
      const row = {
        id: rec.existingId || `a-${uid()}`, date: rec.date, start: rec.start, end: rec.end,
        clientIds: [rec.clientId], staffIds: rec.staffIds, type: rec.type, status: rec.statusKey,
        location: rec.location || '', title: rec.title || '', notes: rec.notes, source: 'data-import',
        abaHr: rec.abaHr, ...(rec.abaActivity ? { abaActivity: rec.abaActivity } : {}),
        billing: { status: null }, documents: [], custom: {}, pcfs: {},
      }
      if (rec.existingId) { patches.push({ id: rec.existingId, patch: row }); updated++ } else creates.push(row)
    }
  }
  const counts = { created: creates.length, updated, skipped }
  const entry = { id: `imp-${uid()}`, at, type: typeId, file: '', counts, mode, by: 'local user' }
  return { ok: true, creates, patches, counts, entry, check }
}

const payerName = (state, raw) => {
  const needle = clean(raw).toLowerCase()
  if (!needle) return ''
  const hit = (state.payers || []).find((p) => p.name.toLowerCase() === needle || (p.aka || '').toLowerCase() === needle)
  return hit?.name || ''
}

const COLORS = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444', '#14b8a6', '#f97316', '#a855f7', '#22c55e', '#e11d48', '#06b6d4']
const AVATARS = ['fox', 'panda', 'cat', 'bear', 'owl', 'penguin', 'frog', 'bunny', 'koala', 'sloth', 'octopus', 'unicorn', 'robot', 'chick']
const hashOf = (s) => [...String(s)].reduce((t, c) => (t * 31 + c.charCodeAt(0)) % 997, 7)
const initialsOf = (name) => String(name).split(/\s+/).slice(0, 2).map((p) => p[0] || '').join('').toUpperCase()

function withCosmetics(row) {
  const h = hashOf(row.name)
  return { ...row, initials: initialsOf(row.name), color: COLORS[h % COLORS.length], avatar: AVATARS[h % AVATARS.length], authWeekly: 10, program: row.program || 'Center-based · 1:1' }
}
function withStaffCosmetics(row) {
  const h = hashOf(row.name)
  return { ...row, initials: initialsOf(row.name), color: COLORS[h % COLORS.length], avatar: AVATARS[h % AVATARS.length] }
}

/** Rows the UI shows as a preview table (first N with their verdict). */
export function previewRows(typeId, matrix, mapping, check, limit = 8) {
  const type = importType(typeId)
  return matrix.slice(0, limit).map((row, i) => {
    const rec = check.records[i]
    const issue = check.issues.find((x) => x.line === i + 2)
    return {
      line: i + 2,
      cells: type.fields.map((f) => ({ key: f.key, value: mapping && Object.entries(mapping).some(([col, key]) => key === f.key && Number(col) < row.length) ? rec?.raw?.[f.key] ?? '' : '—' })),
      error: issue ? issue.errors.join('; ') : null,
      duplicate: !!rec?.existingId,
    }
  })
}

export const officeNameSet = (state) => new Set(settingsOffices(state.settings).map((o) => o.name))
export const statusLabelFor = (state, key) => apptStatusList(state.settings).find((s) => s.key === key)?.label || STATUSES[key]?.label || key || ''
export const importsToday = (state) => (state.settings?.importLog || []).filter((e) => e.at >= Date.now() - 86400000).length
