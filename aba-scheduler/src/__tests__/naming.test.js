import { describe, it, expect } from 'vitest'
import { apptAutoTitle, clientLabel, fmtRange, LEGACY_TITLE_RE, needsRework, titleAudit } from '../lib/apptName'
import { flagOverlaps } from '../lib/dash'
import { reducer, blankState } from '../state/store'

const CLIENTS = { c1: { id: 'c1', name: 'Ana Reyes' }, c2: { id: 'c2', name: 'John Smith' }, c3: { id: 'c3', name: 'Kai Nakamura-Lee' } }
const STAFF = { s1: { id: 's1', name: 'Dhananjay Masal', role: 'RBT · Center' }, s2: { id: 's2', name: 'Neha Peyyeti', role: 'BCBA' } }
const base = { type: 'service', start: 540, end: 600, clients: CLIENTS, staff: STAFF, settings: {} }

describe('appointment naming conventions', () => {
  it('chart style is the default: Last, First — Service · collapsed time', () => {
    expect(apptAutoTitle({ ...base, clientIds: ['c1'] })).toBe('Reyes, Ana — Service · 9–10 AM')
    expect(fmtRange(600, 690, false)).toBe('10–11:30 AM')
    expect(fmtRange(690, 840, false)).toBe('11:30 AM–2 PM')
  })
  it('all three styles + group +n + crew suffix behave', () => {
    expect(apptAutoTitle({ ...base, clientIds: ['c1'], settings: { apptNameStyle: 'plain' } })).toBe('Ana Reyes — Service · 9–10 AM')
    expect(apptAutoTitle({ ...base, clientIds: ['c1'], settings: { apptNameStyle: 'code' } })).toBe('253T · Reyes, A. · 9–10 AM')
    expect(apptAutoTitle({ ...base, clientIds: ['c1', 'c2', 'c3'] })).toBe('Reyes, Ana +2 — Service · 9–10 AM')
    expect(apptAutoTitle({ ...base, clientIds: ['c1'], staffIds: ['s1'], settings: { apptNameStaff: true } })).toBe('Reyes, Ana — Service · 9–10 AM (Dhananjay M., RBT)')
    expect(apptAutoTitle({ ...base, clientIds: ['c1'], staffIds: ['s1', 's2'], settings: { apptNameStaff: true, h24: true } })).toBe('Reyes, Ana — Service · 09:00–10:00 (Dhananjay M., RBT; Neha P., BCBA)'.replace(';', ','))
    expect(apptAutoTitle({ ...base, type: 'drive' })).toBe('Drive Time · 9–10 AM') // crew/break blocks with no client
    expect(clientLabel({ name: 'Solo' }, 'ehr')).toBe('Solo')
  })
  it('title extras compose: program, location, service line and CPT-first codes', () => {
    const settings = { apptTitleExtras: { program: true, location: true, service: true } }
    expect(apptAutoTitle({ ...base, clientIds: ['c1'], serviceOverride: 'dtt', locationOverride: 'Clinic Room 2', settings })).toBe('Reyes, Ana — 1:1 Discrete Trial Training · 9–10 AM @ Clinic Room 2')
    // c1 has no program in this fixture → the program segment is gracefully omitted (no stray separators)
    const withProg = { ...base, clients: { ...CLIENTS, c1: { ...CLIENTS.c1, program: 'EIBI · Day program' } } }
    expect(apptAutoTitle({ ...withProg, clientIds: ['c1'], serviceOverride: 'dtt', locationOverride: 'Main Center', settings })).toBe('Reyes, Ana · EIBI · Day program — 1:1 Discrete Trial Training · 9–10 AM @ Main Center')
    expect(apptAutoTitle({ ...withProg, clientIds: ['c1'], serviceOverride: 'social', settings: { ...settings, apptNameStyle: 'code' } })).toBe('97153 · Reyes, A. · EIBI · Day program · 9–10 AM')
  })
  it('title health audit flags legacy / blank / overlong and leaves the rest', () => {
    const appts = {
      t1: { id: 't1', title: '(Service) 9 AM - 10 AM' },
      t2: { id: 't2', title: '   ' },
      t3: { id: 't3', title: 'x'.repeat(73) },
      t4: { id: 't4', title: 'x'.repeat(72) },
      t5: { id: 't5', title: 'Reyes, Ana — Service · 9–10 AM' },
    }
    const audit = titleAudit(appts)
    expect(audit.total).toBe(3)
    expect(audit.legacy).toEqual(['t1'])
    expect(audit.untitled).toEqual(['t2'])
    expect(audit.long).toEqual(['t3'])
    expect(needsRework(appts.t4)).toBe(false)
    let st = { ...blankState(), appts }
    st = reducer(st, { type: 'relabel' })
    expect(st.appts.t1.title).not.toBe('(Service) 9 AM - 10 AM')
    expect(st.appts.t2.title.length).toBeGreaterThan(3)
    expect(st.appts.t3.title.length).toBeLessThanOrEqual(72)
    expect(st.appts.t4.title).toBe('x'.repeat(72)) // untouched
    expect(st.appts.t5.title).toBe('Reyes, Ana — Service · 9–10 AM') // untouched
  })
  it('flagOverlaps marks same-day shared-staff collisions in both rows', () => {
    const rows = [
      { id: 'x1', date: '2026-09-14', start: 540, end: 600, staffIds: ['s1'] },
      { id: 'x2', date: '2026-09-14', start: 570, end: 630, staffIds: ['s1', 's2'] },
      { id: 'x3', date: '2026-09-14', start: 660, end: 720, staffIds: ['s1'] },
      { id: 'x4', date: '2026-09-15', start: 540, end: 600, staffIds: ['s3'] },
      { id: 'x5', date: '2026-09-15', start: 540, end: 600, staffIds: ['s4'] },
    ]
    const bad = flagOverlaps(rows)
    expect([...bad].sort()).toEqual(['x1', 'x2'])
    expect(flagOverlaps([])).toEqual(new Set())
  })
  it('relabel rewrites only legacy auto-shaped titles, is undoable, and no-ops when clean', () => {
    let st = blankState()
    const keys = Object.keys(st.appts)
    const legacyId = keys.find((id) => LEGACY_TITLE_RE.test(st.appts[id].title || '')) // seeded titles are hand-typed → likely none
    if (!legacyId) {
      const any = keys[0]
      st = { ...st, appts: { ...st.appts, [any]: { ...st.appts[any], title: '(Service) 9 AM - 10 AM' }, [keys[1]]: { ...st.appts[keys[1]], title: 'My custom title' } } }
      const n = Object.keys(st.appts).length
      const next = reducer(st, { type: 'relabel' })
      expect(next).not.toBe(st)
      expect(next.appts[any].title).not.toBe('(Service) 9 AM - 10 AM')
      expect(next.appts[any].title).toMatch(/Service ·/)
      const withEx = { ...next, settings: { ...next.settings, apptTitleExtras: { location: true } } }
      const again = reducer({ ...withEx, appts: { ...withEx.appts, [keys[2]]: { ...withEx.appts[keys[2]], title: '(Service) 9 AM - 10 AM', location: 'Clinic Room 2' } } }, { type: 'relabel' })
      expect(again.appts[keys[2]].title).toContain('@ Clinic Room 2')
      expect(next.appts[keys[1]].title).toBe('My custom title') // untouched
      expect(Object.keys(next.appts).length).toBe(n)
      expect(next.history.length).toBe(st.history.length + 1)
      expect(reducer(next, { type: 'relabel' })).toBe(next) // idempotent no-op
      return
    }
    expect(apptAutoTitle({ ...st.appts[legacyId], clients: Object.fromEntries(st.clients.map((c) => [c.id, c])), staff: Object.fromEntries(st.staff.map((x) => [x.id, x])), settings: st.settings })).toBeTruthy()
    const next = reducer(st, { type: 'relabel' })
    expect(next.appts[legacyId].title).not.toBe(st.appts[legacyId].title)
  })
})
