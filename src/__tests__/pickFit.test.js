import { describe, it, expect } from 'vitest'
import { blankState } from '../state/store'
import { staffFit, clientFit, fitNotes, openSlots, slotText } from '../lib/pickFit'
import { candidateVerdicts } from '../lib/bookingChecks'
import { findConflicts } from '../lib/model'
import { addDays, isoDate, parseISO, todayISO } from '../lib/date'

const today = todayISO()
const shift = (iso, n) => isoDate(addDays(parseISO(iso), n))
// a Mon–Fri date at least a week out, so the week, its past and its future are all ours
let DATE = shift(today, 7)
while ([0, 6].includes(parseISO(DATE).getDay())) DATE = shift(DATE, 1)

const BASE = blankState()
const [S1, S2, S3] = BASE.staff.filter((s) => /RBT/.test(s.role)) // same tier
const C = BASE.clients[0]
const C2 = BASE.clients[1]
const mk = (id, x) => ({ id, date: DATE, start: 600, end: 720, type: 'service', status: 'completed', staffIds: [], clientIds: [], location: '', ...x })
const stateWith = (appts, extra = {}) => ({
  ...BASE,
  teams: [],
  appts: Object.fromEntries(appts.map((a) => [a.id, a])),
  clients: BASE.clients.map((c) => ({ ...c, authStart: shift(today, -60), authEnd: shift(today, 120), authWeekly: 10 })),
  ...extra,
})
const draft = (x = {}) => ({ id: '__draft__', date: DATE, start: 600, end: 720, type: 'service', status: 'active', staffIds: [], clientIds: [C.id], location: '', ...x })

// S1 has three past sessions with C on the draft's weekday and time band
const history = [21, 28, 35].map((d, i) => mk(`h${i}`, { date: shift(DATE, -d), staffIds: [S1.id], clientIds: [C.id] }))

describe('staffFit: what the workspace knows about each staff candidate', () => {
  it('counts past sessions with the client and names a stranger as new', () => {
    const fit = staffFit(stateWith(history), draft(), { today })
    expect(fit[S1.id].facts[0].text).toBe(`3 past sessions with ${C.name.split(' ')[0]}`)
    expect(fit[S2.id].facts[0]).toEqual({ text: `New to ${C.name.split(' ')[0]}`, tone: 'flag' })
  })

  it('shows hours this week after the booking against the staff target, flagged when over', () => {
    const s = stateWith([mk('w1', { start: 480, end: 590, staffIds: [S2.id], clientIds: [C2.id], status: 'active' })], {
      staff: BASE.staff.map((x) => (x.id === S2.id ? { ...x, targetWeekH: 3 } : x)),
    })
    const fit = staffFit(s, draft(), { today })
    const hrs = fit[S2.id].facts.find((f) => /h this week/.test(f.text))
    expect(hrs).toEqual({ text: `${Math.round((110 / 60 + 2) * 10) / 10} of 3 h this week`, tone: 'flag' })
    expect(fit[S3.id].facts.find((f) => /h this week/.test(f.text)).tone).toBeUndefined()
  })

  it('estimates the drive from the previous appointment that day', () => {
    const prev = mk('p', { start: 480, end: 570, staffIds: [S2.id], clientIds: [C2.id], status: 'active' })
    const fit = staffFit(stateWith([prev]), draft(), { today })
    expect(fit[S2.id].facts.some((f) => /^~\d+ min from previous$/.test(f.text))).toBe(true)
    expect(fit[S3.id].facts.some((f) => /from previous/.test(f.text))).toBe(false)
  })

  it('marks one best fit, never someone busy across the slot', () => {
    const busy = mk('b', { start: 600, end: 720, staffIds: [S1.id], clientIds: [C2.id], status: 'active' })
    const free = candidateVerdicts(stateWith(history), draft(), 'staff', { today })
    expect(free[S1.id].best).toBe('Best fit')
    expect(Object.values(free).filter((v) => v.best)).toHaveLength(1)
    const v = candidateVerdicts(stateWith([...history, busy]), draft(), 'staff', { today })
    expect(v[S1.id].tone).toBe('warn')
    expect(v[S1.id].best).toBeUndefined()
    expect(Object.values(v).filter((x) => x.best)).toHaveLength(1)
  })
})

describe('clientFit: authorization pace and the usual slot', () => {
  it('reports authorized hours booked this week, flags under pace, and the usual slot', () => {
    const fit = clientFit(stateWith(history), draft(), { today })
    expect(fit[C.id].facts[0]).toEqual({ text: '0 of 10 auth h this week', tone: 'flag' })
    expect(fit[C.id].score).toBe(10)
    expect(fit[C.id].facts.some((f) => /^Usual slot \(/.test(f.text) && f.tone === 'ok')).toBe(true)
    const other = clientFit(stateWith(history), draft({ start: 960, end: 1020 }), { today })
    expect(other[C.id].facts.some((f) => /^Usually /.test(f.text))).toBe(true)
  })

  it('says nothing for non-clinical bookings or without a slot', () => {
    expect(clientFit(stateWith(history), draft({ type: 'break' }), { today })).toEqual({})
    expect(staffFit(stateWith(history), draft({ date: '' }), { today })).toEqual({})
  })
})

describe('fitNotes: continuity and caseload balance for the people picked', () => {
  it('names a familiar clinician when the pick is new to the client', () => {
    const lines = fitNotes(stateWith(history), draft({ staffIds: [S2.id] }), { today })
    expect(lines[0].text).toMatch(new RegExp(`${S2.name} has no past sessions with ${C.name}; ${S1.name} has had 3`))
  })

  it('names a lighter same-tier peer who is free when the pick goes over target', () => {
    const s = stateWith(history, { staff: BASE.staff.map((x) => (x.id === S1.id ? { ...x, targetWeekH: 1 } : x)) })
    const lines = fitNotes(s, draft({ staffIds: [S1.id] }), { today })
    expect(lines).toHaveLength(1)
    expect(lines[0].text).toMatch(new RegExp(`${S1.name} would be at 2 of 1 target hours this week\\. .+ \\(same tier\\) is free then`))
  })
})

describe('openSlots: where everyone picked is free', () => {
  it('suggests clash-free slots inside the working day on practice days, joining a block first', () => {
    const tele = { location: 'Telehealth' } // no travel between sessions
    const block = mk('blk', { start: 480, end: 600, staffIds: [S1.id], clientIds: [C2.id], status: 'active', ...tele })
    const clash = mk('cl', { start: 600, end: 720, staffIds: [S1.id], clientIds: [C2.id], status: 'active', ...tele })
    const s = stateWith([block, clash])
    const d = draft({ staffIds: [S1.id], ...tele })
    const slots = openSlots(s, d, { today })
    expect(slots.length).toBe(3)
    for (const sl of slots) {
      expect(findConflicts(s.appts, { ...d, ...sl }, {}, {})).toHaveLength(0)
      expect(sl.start).toBeGreaterThanOrEqual(480)
      expect(sl.end).toBeLessThanOrEqual(1080)
      expect([1, 2, 3, 4, 5]).toContain(parseISO(sl.date).getDay())
      expect(sl.date >= today).toBe(true)
    }
    expect(slots[0]).toMatchObject({ date: DATE, start: 720, joins: true })
    expect(slotText(slots[0])).toMatch(/joins an existing block/)
  })

  it('never offers a slot the clinician cannot reach from the neighbouring session', () => {
    // in-home sessions at two client homes about 16 minutes apart (straight-line estimate)
    const clash = mk('cl', { start: 600, end: 720, staffIds: [S1.id], clientIds: [C2.id], status: 'active' })
    const slots = openSlots(stateWith([clash]), draft({ staffIds: [S1.id] }), { today, limit: 6 })
    expect(slots.length).toBeGreaterThan(0)
    for (const sl of slots.filter((x) => x.date === DATE)) {
      expect(sl.start >= 720 && sl.start < 735).toBe(false)
      expect(sl.end > 585 && sl.end <= 600).toBe(false)
    }
  })

  it('needs people and a duration', () => {
    expect(openSlots(stateWith([]), draft({ clientIds: [] }), { today })).toEqual([])
    expect(openSlots(stateWith([]), draft({ end: 600 }), { today })).toEqual([])
  })
})
