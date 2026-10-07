import React, { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { blankState, StoreProvider, useStore } from '../state/store'
import { ToastProvider } from '../ui/Toast'
import {
  stopViolationsForDraft, validationFlagsForDraft, touchesSchedule, SCHEDULE_PATCH_FIELDS,
} from '../lib/settingsMasters'
import { validateImport, planImport } from '../lib/dataImport'

// Audit CFG-02/CFG-03: Stop-severity validation rules are a write-time invariant on
// every booking path, and flag-severity items persist as the session badge. These
// tests pin the pure helpers, the store-level guard (create / update / move) and
// the CSV import path.

const KEY = 'aloha-aba.v3'
const DAY = '2026-04-06'
const stored = () => JSON.parse(localStorage.getItem(KEY) || '{}')

const cleanState = () => {
  const s = blankState()
  s.appts = {} // an empty calendar keeps every overlap deterministic
  s.history = []
  return s
}

const appt = (id, start, end, extra = {}) => ({
  id, title: `Row ${id}`, date: DAY, start, end, type: 'service', status: 'active',
  clientIds: ['c1'], staffIds: ['s1'], ...extra,
})

beforeEach(() => localStorage.clear())
afterEach(() => cleanup())

describe('write guard — pure helpers', () => {
  it('touchesSchedule recognises scheduling fields only', () => {
    for (const k of SCHEDULE_PATCH_FIELDS) expect(touchesSchedule({ [k]: 1 })).toBe(true)
    expect(touchesSchedule({ status: 'completed' })).toBe(false)
    expect(touchesSchedule({ notes: 'x', billed: true, verification: {}, custom: {} })).toBe(false)
    expect(touchesSchedule({})).toBe(false)
    expect(touchesSchedule(null)).toBe(false)
    expect(touchesSchedule(undefined)).toBe(false)
  })

  it('stopViolationsForDraft returns the Stop items a draft would trip', () => {
    const s = cleanState()
    // ⚡ ABA Hr ticked on a service appointment trips the default aba.serviceAppt Stop
    const stops = stopViolationsForDraft(s, appt('d1', 540, 600, { abaHr: true }))
    expect(stops.map((x) => x.id)).toContain('aba.serviceAppt')
    expect(stops.every((x) => x.severity === 'stop')).toBe(true)
    expect(stopViolationsForDraft(s, null)).toEqual([])
    expect(stopViolationsForDraft(s, appt('d2', 540, 600))).toEqual([]) // clean draft
  })

  it('stopViolationsForDraft never blocks a cancellation-status draft', () => {
    const s = cleanState()
    const cancelled = appt('d1', 540, 600, { abaHr: true, status: 'cancelled' })
    expect(stopViolationsForDraft(s, cancelled)).toEqual([])
    const noShow = appt('d2', 540, 600, { abaHr: true, status: 'no-show' })
    expect(stopViolationsForDraft(s, noShow)).toEqual([])
  })

  it('validationFlagsForDraft maps flag items to badge rows and skips cancellations', () => {
    const s = cleanState()
    s.staff = s.staff.map((x) => (x.id === 's1' ? { ...x, npi: '' } : x)) // explicitly blanked NPI
    const flags = validationFlagsForDraft(s, appt('d1', 540, 600))
    expect(flags).toContainEqual({ id: 'staff.missingNpi', label: 'Missing NPI / Medicaid ID' })
    expect(flags.every((f) => f.id && f.label)).toBe(true)
    expect(validationFlagsForDraft(s, appt('d1', 540, 600, { status: 'cancelled' }))).toEqual([])
  })
})

describe('write guard — CSV import', () => {
  const aClient = (s, i = 0) => s.clients[i].name
  const aStaff = (s, i = 0) => s.staff[i].name

  it('refuses an appointment row that trips a Stop rule against the live calendar — nothing imports', () => {
    const s = cleanState()
    s.settings.appointmentValidations = { staff: { overlap: 'stop' } }
    s.appts = { existing: { id: 'existing', title: 'On the calendar', date: DAY, start: 540, end: 600, type: 'service', status: 'active', clientIds: ['c2'], staffIds: ['s1'] } }
    const map = { 0: 'date', 1: 'start', 2: 'end', 3: 'client', 4: 'staff', 5: 'type' }
    const matrix = [
      [DAY, '9:30', '10:30', aClient(s), aStaff(s), 'service'],  // overlaps the live calendar → Stop
      [DAY, '11:00', '12:00', aClient(s), aStaff(s), 'service'],  // clean row
    ]
    const res = validateImport(s, 'appointments', matrix, map)
    expect(res.issues.length).toBe(1)
    expect(res.issues[0].errors.join(' ')).toMatch(/Stop rule blocks this row: Staff Overlap/)
    const plan = planImport(s, 'appointments', matrix, map)
    expect(plan.ok).toBe(false)
    expect(plan.msg).toMatch(/1 of 2 rows need fixing/)
  })

  it('evaluates each row against the rows already accepted above (intra-file overlap)', () => {
    const s = cleanState()
    s.settings.appointmentValidations = { staff: { overlap: 'stop' } }
    const map = { 0: 'date', 1: 'start', 2: 'end', 3: 'client', 4: 'staff', 5: 'type' }
    const matrix = [
      [DAY, '9:00', '10:00', aClient(s, 0), aStaff(s), 'service'],
      [DAY, '9:30', '10:30', aClient(s, 1), aStaff(s), 'service'], // same staff, overlapping the row above
    ]
    const res = validateImport(s, 'appointments', matrix, map)
    expect(res.issues.length).toBe(1)
    expect(res.issues[0].errors.join(' ')).toMatch(/Stop rule blocks this row: Staff Overlap/)
    // with the rule back at its default (warn) the same file imports cleanly
    const s2 = cleanState()
    const ok = planImport(s2, 'appointments', matrix, map)
    expect(ok.ok).toBe(true)
    expect(ok.creates.length).toBe(2)
  })
})

/* ── store-level guard, driven through the real actions ──────────────────── */

function Probe() {
  const store = useStore() // the context spreads the visible state at the top level
  const { actions } = store
  const [out, setOut] = useState('')
  const rows = Object.values(store.appts || {}).map((a) => ({
    id: a.id, start: a.start, end: a.end, status: a.status, abaHr: !!a.abaHr, flags: a.validationFlags || null,
  }))
  return (
    <div>
      <div data-testid="probe-out">{out}</div>
      <div data-testid="probe-appts">{JSON.stringify(rows)}</div>
      <button data-testid="pb-create-stop" onClick={() => setOut(JSON.stringify(actions.create(appt('x-stop', 540, 600, { abaHr: true }))))}>create stop</button>
      <button data-testid="pb-create-flag" onClick={() => setOut(JSON.stringify(actions.create(appt('x-flag', 660, 720))))}>create flag</button>
      <button data-testid="pb-update-aba" onClick={() => setOut(JSON.stringify(actions.update('x-flag', { abaHr: true })))}>update aba</button>
      <button data-testid="pb-update-status" onClick={() => setOut(JSON.stringify(actions.update('x-flag', { status: 'completed', notes: 'done' })))}>update status</button>
      <button data-testid="pb-cancel" onClick={() => setOut(JSON.stringify(actions.update('x-flag', { status: 'cancelled' })))}>cancel</button>
      <button data-testid="pb-reactivate" onClick={() => setOut(JSON.stringify(actions.update('x-flag', { status: 'active' })))}>reactivate</button>
      <button data-testid="pb-move-stop" onClick={() => setOut(JSON.stringify(actions.move('x-flag', { date: DAY, start: 570, end: 630 })))}>move stop</button>
      <button data-testid="pb-move-ok" onClick={() => setOut(JSON.stringify(actions.move('x-flag', { date: DAY, start: 780, end: 840 })))}>move ok</button>
    </div>
  )
}

const mount = () => render(<ToastProvider><StoreProvider><Probe /></StoreProvider></ToastProvider>)
const seed = (mutate) => {
  const s = cleanState()
  if (mutate) mutate(s)
  localStorage.setItem(KEY, JSON.stringify(s))
}
const out = () => JSON.parse(screen.getByTestId('probe-out').textContent || 'null')
const rows = () => JSON.parse(screen.getByTestId('probe-appts').textContent || '[]')

describe('write guard — store actions', () => {
  it('create refuses a Stop draft and stores nothing', () => {
    seed()
    mount()
    fireEvent.click(screen.getByTestId('pb-create-stop'))
    expect(out().ok).toBe(false)
    expect(out().msg).toMatch(/blocked by a Stop rule/)
    expect(out().msg).toMatch(/ABA Hours on a Service Appointment/)
    expect(rows()).toEqual([])
    expect(Object.keys(stored().appts || {})).toEqual([])
  })

  it('create derives and persists the flag badge on the saved session', async () => {
    seed((s) => { s.staff = s.staff.map((x) => (x.id === 's1' ? { ...x, npi: '' } : x)) })
    mount()
    fireEvent.click(screen.getByTestId('pb-create-flag'))
    expect(out().ok).toBe(true)
    const row = rows().find((r) => r.id === 'x-flag')
    expect(row.flags).toContainEqual({ id: 'staff.missingNpi', label: 'Missing NPI / Medicaid ID' })
    await waitFor(() => {
      const saved = Object.values(stored().appts || {}).find((a) => a.id === 'x-flag')
      expect(saved.validationFlags).toContainEqual({ id: 'staff.missingNpi', label: 'Missing NPI / Medicaid ID' })
    })
  })

  it('update guards scheduling writes only — completing a flagged session still works', () => {
    seed((s) => {
      s.staff = s.staff.map((x) => (x.id === 's1' ? { ...x, npi: '' } : x))
      s.appts = { 'x-flag': appt('x-flag', 660, 720) }
    })
    mount()
    // a scheduling patch that trips a Stop rule is refused
    fireEvent.click(screen.getByTestId('pb-update-aba'))
    expect(out().ok).toBe(false)
    expect(out().msg).toMatch(/blocked by a Stop rule/)
    expect(rows().find((r) => r.id === 'x-flag').abaHr).toBe(false)
    // a status/billing-style patch on the same flagged session is not scheduling — allowed
    fireEvent.click(screen.getByTestId('pb-update-status'))
    expect(out().ok).toBe(true)
    expect(rows().find((r) => r.id === 'x-flag').status).toBe('completed')
  })

  it('move refuses a Stop slot and lands on a clean one', () => {
    seed((s) => {
      s.settings.appointmentValidations = { staff: { overlap: 'stop' } }
      s.appts = { blocker: appt('blocker', 540, 600), 'x-flag': appt('x-flag', 660, 720) }
    })
    mount()
    fireEvent.click(screen.getByTestId('pb-move-stop')) // 9:30–10:30 overlaps the blocker at 9:00–10:00
    expect(out().ok).toBe(false)
    expect(out().msg).toMatch(/Stop rule blocks that slot/)
    expect(out().msg).toMatch(/Staff Overlap/)
    expect(rows().find((r) => r.id === 'x-flag').start).toBe(660) // untouched
    fireEvent.click(screen.getByTestId('pb-move-ok')) // 13:00–14:00 is free
    expect(out().ok).toBe(true)
    expect(rows().find((r) => r.id === 'x-flag').start).toBe(780)
  })

  it('cancelling a session is never blocked; re-activating into a Stop slot is', () => {
    seed((s) => {
      s.settings.appointmentValidations = { staff: { overlap: 'stop' } }
      // seeded directly past the guard: an active session overlapping a blocker
      s.appts = { blocker: appt('blocker', 540, 600), 'x-flag': appt('x-flag', 570, 630) }
    })
    mount()
    fireEvent.click(screen.getByTestId('pb-cancel'))
    expect(out().ok).toBe(true)
    expect(rows().find((r) => r.id === 'x-flag').status).toBe('cancelled')
    fireEvent.click(screen.getByTestId('pb-reactivate')) // back to active → overlaps the blocker again
    expect(out().ok).toBe(false)
    expect(out().msg).toMatch(/blocked by a Stop rule/)
    expect(rows().find((r) => r.id === 'x-flag').status).toBe('cancelled') // refusal stored nothing
  })
})
