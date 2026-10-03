import { describe, it, expect } from 'vitest'
import { blankState } from '../state/store'
import {
  IMPORT_TYPES, IMPORT_LIMIT, importType, parseCSV, templateCSV, guessMapping, parseDateCell, parseTimeCell,
  validateImport, planImport, previewRows, officeNameSet, statusLabelFor, importsToday,
} from '../lib/dataImport'

const fresh = () => blankState()
const office = (s) => officeNameSet(s).values().next().value
const aStaff = (s) => s.staff[0].name
const aClient = (s) => s.clients[0].name

describe('csv parsing', () => {
  it('parses quoted cells, embedded commas and CRLF line endings', () => {
    const { header, rows } = parseCSV('name,note\r\n"Reyes, Ana","loves, sand""and"" play"\r\nBo Lee,plain\r\n')
    expect(header).toEqual(['name', 'note'])
    expect(rows[0]).toEqual(['Reyes, Ana', 'loves, sand"and" play']) // "" → " inside a quoted cell
    expect(rows[1]).toEqual(['Bo Lee', 'plain'])
    expect(rows.length).toBe(2) // the trailing newline never becomes a blank row
  })

  it('returns an empty sheet for empty input', () => {
    expect(parseCSV('')).toEqual({ header: [], rows: [] })
    expect(parseCSV('a,b\n\n').rows.length).toBe(0)
  })

  it('ships a template per type whose header maps back onto the field keys', () => {
    for (const type of IMPORT_TYPES) {
      const { header } = parseCSV(templateCSV(type.id))
      const mapping = guessMapping(type.id, header)
      const mappedKeys = Object.values(mapping).filter(Boolean)
      for (const f of type.fields.filter((x) => x.required)) expect(mappedKeys).toContain(f.key)
    }
  })

  it('guesses mappings case-insensitively and leaves unknown columns unmapped', () => {
    expect(guessMapping('clients', ['Client name', 'Date of birth', 'Guardian email', 'Unrelated'])).toEqual({ 0: 'name', 1: 'dob', 2: 'guardianEmail' })
    expect(guessMapping('appointments', ['Date', 'Start', 'End', 'Client'])).toEqual({ 0: 'date', 1: 'start', 2: 'end', 3: 'client' })
  })

  it('parses both accepted date and time shapes', () => {
    expect(parseDateCell('2026-03-04')).toBe('2026-03-04')
    expect(parseDateCell('3/4/2026')).toBe('2026-03-04')
    expect(parseDateCell('not a date')).toBeNull()
    expect(parseDateCell('')).toBeNull()
    expect(parseTimeCell('9:30')).toBe(570)
    expect(parseTimeCell('9:30 AM')).toBe(570)
    expect(parseTimeCell('2:15 PM')).toBe(855)
    expect(parseTimeCell('nope')).toBeNull()
    expect(parseTimeCell('')).toBeNull()
  })
})

describe('row validation', () => {
  it('flags missing required columns and a bad email without touching the roster', () => {
    const s = fresh()
    const matrix = [
      ['', 'x@y.com'],
      ['New Kid', 'not-an-email'],
    ]
    const res = validateImport(s, 'clients', matrix, { 0: 'name', 1: 'guardianEmail' })
    expect(res.total).toBe(2)
    expect(res.issues.length).toBe(2)
    expect(res.issues[0].errors.join(' ')).toMatch(/name is required/i)
    expect(res.issues[1].errors.join(' ')).toMatch(/email/i)
    expect(res.records[0].existingId).toBeNull()
  })

  it('rejects a future date of birth and an unknown home office, but accepts a known one', () => {
    const s = fresh()
    const matrix = [
      ['Future Kid', '2999-01-01', 'M', 'Nowhere Academy'],
      ['Home Kid', '2020-01-01', 'F', office(s)],
    ]
    const res = validateImport(s, 'clients', matrix, { 0: 'name', 1: 'dob', 2: 'sex', 3: 'home' })
    expect(res.issues.length).toBe(1)
    expect(res.issues[0].errors.join(' ')).toMatch(/future/)
    expect(res.valid).toBe(1)
  })

  it('validates staff numeric ranges and office names', () => {
    const s = fresh()
    const matrix = [
      ['Riya Kapoor', 'RBT', 'a@b.com', '0.4', '20', '40', office(s)],
      ['Sam Doe', 'RBT', 'bad-email', '0.5', '200', '9999', 'Ghost Office'],
    ]
    const res = validateImport(s, 'staff', matrix, { 0: 'name', 1: 'role', 2: 'email', 3: 'fte', 4: 'targetWeekH', 5: 'payrollRate', 6: 'office' })
    expect(res.issues.length).toBe(1)
    const errs = res.issues[0].errors.join(' ')
    expect(errs).toMatch(/Email/)
    expect(errs).toMatch(/Target hours/)
    expect(errs).toMatch(/Pay rate/)
    expect(errs).toMatch(/Office/)
  })

  it('validates appointments: known client and staff, end after start, known status by key or label', () => {
    const s = fresh()
    const day = '2026-04-06'
    const matrix = [
      [day, '9:00', '10:00', aClient(s), aStaff(s), 'service', 'Completed'],
      [day, '11:00', '10:30', aClient(s), `${aStaff(s)}; Nobody Real`, 'service', 'active'],
      [day, '12:00', '13:00', 'Not A Client', aStaff(s), 'cartwheel', 'status-that-does-not-exist'],
    ]
    const res = validateImport(s, 'appointments', matrix, { 0: 'date', 1: 'start', 2: 'end', 3: 'client', 4: 'staff', 5: 'type', 6: 'status' })
    expect(res.issues.length).toBe(2)
    const all = res.issues.map((i) => i.errors.join(' ')).join(' | ')
    expect(all).toMatch(/End time must be after/)
    expect(all).toMatch(/Nobody Real/)
    expect(all).toMatch(/is not in the roster/)
    expect(all).toMatch(/cartwheel/)
    expect(all).toMatch(/is not a schedulable type/)
    expect(all).toMatch(/status-that-does-not-exist/)
    expect(all).toMatch(/is not in the appointment status list/)
    expect(res.records[0].statusKey).toBe('completed') // resolved from the label
  })

  it('accepts ⚡ ABA hours only on non-service rows, and only for behavior-analytic activities', () => {
    const s = fresh()
    const day = '2026-04-06'
    const map = { 0: 'date', 1: 'start', 2: 'end', 3: 'client', 4: 'staff', 5: 'type', 6: 'abaHours' }
    const matrix = [
      [day, '9:00', '10:30', aClient(s), aStaff(s), 'unavailable', 'group-training'],
      [day, '11:00', '12:00', aClient(s), aStaff(s), 'break', 'coursework'],
      [day, '13:00', '14:00', aClient(s), aStaff(s), 'unavailable', 'facility'],
      [day, '15:00', '16:00', aClient(s), aStaff(s), 'service', 'group-training'],
      [day, '17:00', '18:00', aClient(s), aStaff(s), 'unavailable', 'sweeping the floor'],
    ]
    const res = validateImport(s, 'appointments', matrix, map)
    const all = res.issues.map((i) => i.errors.join(' ')).join(' | ')
    expect(all).toMatch(/not behavior-analytic time/)                 // cleaning the clinic
    expect(all).toMatch(/non-service appointments only/)              // ticked on a service row
    expect(all).toMatch(/is not known/)                               // unknown activity name
    expect(res.records[0]).toMatchObject({ abaHr: true, abaActivity: 'group-training' })
    expect(res.records[1]).toMatchObject({ abaHr: true, abaActivity: 'coursework' })
    expect(res.records[3].abaHr).toBe(false)

    const plan = planImport(s, 'appointments', matrix.slice(0, 2), map)
    expect(plan.creates[0]).toMatchObject({ type: 'unavailable', abaHr: true, abaActivity: 'group-training' })
    expect(plan.creates[1]).toMatchObject({ type: 'break', abaHr: true, abaActivity: 'coursework' })
  })

  it('detects duplicates inside the file and against the live roster', () => {
    const s = fresh()
    const existingClient = s.clients[0]
    const matrix = [
      [existingClient.name, existingClient.dob],
      [existingClient.name, existingClient.dob], // same row twice
    ]
    const res = validateImport(s, 'clients', matrix, { 0: 'name', 1: 'dob' })
    expect(res.duplicates).toBe(2)
    expect(res.records[0].existingId).toBe(existingClient.id)
  })
})

describe('commit planning', () => {
  const clientFile = (s, name) => ({
    matrix: [[name, '2019-05-06', 'M', office(s)]],
    mapping: { 0: 'name', 1: 'dob', 2: 'sex', 3: 'home' },
  })

  it('is all-or-nothing: one bad row blocks the whole file', () => {
    const s = fresh()
    const matrix = [['Good Kid', '2019-05-06', 'M', office(s)], ['', '', '', '']]
    const plan = planImport(s, 'clients', matrix, { 0: 'name', 1: 'dob', 2: 'sex', 3: 'home' })
    expect(plan.ok).toBe(false)
    expect(plan.msg).toMatch(/need fixing/)
    expect(plan.creates).toBeUndefined()
  })

  it('creates rows with stable ids and skips or updates duplicates by mode', () => {
    const s = fresh()
    const { matrix, mapping } = clientFile(s, 'Calm Kid')
    const created = planImport(s, 'clients', matrix, mapping)
    expect(created.ok).toBe(true)
    expect(created.creates.length).toBe(1)
    expect(created.creates[0].id).toBeTruthy()
    expect(created.creates[0].home).toBe(office(s))
    expect(created.creates[0].name).toBe('Calm Kid')
    expect(created.entry.counts.created).toBe(1)
    expect(created.entry.counts.skipped).toBe(0)
    expect(created.entry.type).toBe('clients')
    expect(created.entry.by).toBeTruthy()

    const existing = s.clients[0]
    const dup = { matrix: [[existing.name, existing.dob, 'F', office(s)]], mapping }
    const skip = planImport(s, 'clients', dup.matrix, dup.mapping, { mode: 'skip' })
    expect(skip.creates.length).toBe(0)
    expect(skip.counts.skipped).toBe(1)
    const update = planImport(s, 'clients', dup.matrix, dup.mapping, { mode: 'update' })
    expect(update.creates.length).toBe(0)
    expect(update.patches[0].id).toBe(existing.id)
    expect(update.patches[0].patch.sex).toBe('F')
  })

  it('refuses an empty file and one past the row limit', () => {
    expect(planImport(fresh(), 'clients', [], {}).ok).toBe(false)
    const s = fresh()
    const big = Array.from({ length: IMPORT_LIMIT + 1 }, (_, i) => [`Kid ${i}`, '2019-05-06', 'M', office(s)])
    const plan = planImport(s, 'clients', big, { 0: 'name', 1: 'dob', 2: 'sex', 3: 'home' })
    expect(plan.ok).toBe(false)
    expect(plan.msg).toMatch(/up to 500 rows/)
  })

  it('carries the appointment fields the calendar needs through a commit plan', () => {
    const s = fresh()
    const matrix = [['2026-04-06', '9:00', '10:00', aClient(s), aStaff(s), 'supervision', 'Confirmed', 'Northside Center']]
    const plan = planImport(s, 'appointments', matrix, { 0: 'date', 1: 'start', 2: 'end', 3: 'client', 4: 'staff', 5: 'type', 6: 'status', 7: 'location' })
    expect(plan.ok).toBe(true)
    const appt = plan.creates[0]
    expect(appt).toMatchObject({ date: '2026-04-06', start: 540, end: 600, type: 'supervision', status: 'confirmed' })
    expect(appt.clientIds).toEqual([s.clients[0].id])
    expect(appt.staffIds).toEqual([s.staff[0].id])
  })
})

describe('preview helpers', () => {
  it('previews the first rows in file order with their issue flags', () => {
    const s = fresh()
    const matrix = [['Reyes Kid', '2019-05-06', 'M', office(s)], ['Bad Kid', '2999-01-01', 'M', 'Ghost Office']]
    const check = validateImport(s, 'clients', matrix, { 0: 'name', 1: 'dob', 2: 'sex', 3: 'home' })
    const rows = previewRows('clients', matrix, { 0: 'name', 1: 'dob', 2: 'sex', 3: 'home' }, check)
    expect(rows.length).toBe(2)
    expect(rows[0].line).toBe(2)
    expect(rows[0].error).toBeNull()
    expect(rows[0].cells.map((c) => c.value)).toContain('Reyes Kid')
    expect(rows[1].error).toMatch(/Date of birth is in the future/)
    expect(rows[1].duplicate).toBe(false)
  })

  it('exposes the office set, a status label resolver and today’s import count', () => {
    const s = fresh()
    expect(officeNameSet(s).size).toBeGreaterThan(1)
    expect(statusLabelFor(s, 'no-show')).toBe('No Show')
    expect(statusLabelFor(s, 'whatever')).toBe('whatever')
    s.settings.importLog = [{ at: Date.now(), count: 3 }, { at: Date.now() - 90000000, count: 9 }]
    expect(importsToday(s)).toBe(1)
    expect(importType('nope').id).toBe(IMPORT_TYPES[0].id)
  })
})
