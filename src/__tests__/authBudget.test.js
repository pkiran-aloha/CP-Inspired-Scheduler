import { describe, it, expect } from 'vitest'
import {
  AUTH_GUARD_DEFAULTS, authBoard, authBurn, authCheckFor, authGuardCfg, authHoursOf, authWeekOf,
  clientAuthWindow, consumesAuth,
} from '../lib/authBudget'

const TODAY = '2026-06-15'
const client = (extra = {}) => ({ id: 'c1', name: 'Client One', authWeekly: 10, authStart: '2026-05-01', authEnd: '2026-08-01', ...extra })
const appt = (id, extra = {}) => ({ id, type: 'service', status: 'completed', clientIds: ['c1'], staffIds: ['s1'], start: 540, end: 660, date: '2026-06-01', ...extra })
const state = (appts = {}, clients = [client()], settings = { weekStart: 0, workday: [8, 18] }) => ({ appts: Object.fromEntries(appts.map((a) => [a.id, a])), clients, settings, staff: [{ id: 's1', name: 'Sam Staff' }] })

describe('authorization window', () => {
  it('reads weekly hours across the on-file window', () => {
    const w = clientAuthWindow(client({ authStart: '2026-06-01', authEnd: '2026-06-29' }), TODAY)
    expect(Math.round(w.weeks)).toBe(4)
    expect(w.authorizedHours).toBe(40)
    expect(w.hasWindow).toBe(true)
    expect(w.live).toBe(true)
  })
  it('flags a window that has already ended and one that is missing', () => {
    expect(clientAuthWindow(client({ authEnd: '2026-05-01' }), TODAY).live).toBe(false)
    expect(clientAuthWindow({ id: 'x', name: 'X' }, TODAY)).toMatchObject({ hasWindow: false, authorizedHours: 0 })
  })
  it('finds the practice week that contains a date, honoring week start', () => {
    expect(authWeekOf('2026-06-17', 0)).toEqual({ start: '2026-06-14', end: '2026-06-20' }) // Sunday start
    expect(authWeekOf('2026-06-17', 1)).toEqual({ start: '2026-06-15', end: '2026-06-21' }) // Monday start
  })
})

describe('what draws on the authorization', () => {
  it('counts clinical sessions, not travel or breaks', () => {
    expect(consumesAuth(appt('a', { type: 'service' }))).toBe(true)
    expect(consumesAuth(appt('b', { type: 'evaluation' }))).toBe(true)
    expect(consumesAuth(appt('c', { type: 'drive' }))).toBe(false)
    expect(consumesAuth(appt('d', { type: 'break' }))).toBe(false)
    expect(consumesAuth(appt('f', { status: 'cancelled' }))).toBe(false)
  })
  it('ignores the ⚡ ABA Hours flag entirely — that flag tracks staff behavior-analytic time', () => {
    expect(consumesAuth(appt('g', { abaHr: false }))).toBe(true)
    expect(consumesAuth(appt('h', { abaHr: true }))).toBe(true)
    expect(authHoursOf(appt('i', { abaHr: false }))).toBe(2)
  })
})

describe('burn-down', () => {
  const appts = [
    appt('past1', { date: '2026-06-08' }), // 2h delivered
    appt('past2', { date: '2026-06-09' }), // 2h delivered
    appt('future1', { date: '2026-06-20', status: 'active' }), // 2h scheduled
    appt('ignored', { date: '2026-06-10', type: 'drive' }), // travel never counts
    appt('cancelled', { date: '2026-06-11', status: 'cancelled' }),
  ]
  it('separates delivered from scheduled and measures both against the window', () => {
    const b = authBurn(state(appts), 'c1', { today: TODAY })
    expect(b.deliveredHours).toBe(4)
    expect(b.scheduledHours).toBe(2)
    expect(b.committedHours).toBe(6)
    expect(b.window.authorizedHours).toBe(131.43) // 10 h/week across the 13.1 weeks on file
    expect(b.remainingHours).toBe(125.43)
    expect(b.pct).toBe(5)
  })
  it('measures the booking week against the authorized weekly hours', () => {
    const b = authBurn(state([...appts, appt('week', { date: '2026-06-17' })]), 'c1', { today: TODAY, on: '2026-06-17' })
    expect(b.week.start).toBe('2026-06-14')
    expect(b.week.hours).toBe(4) // the 6/20 booking plus the 6/17 one being checked
    expect(b.week.cap).toBe(10)
  })
  it('projects exhaustion from the booking pace and never invents one from silence', () => {
    // 6 h/week across a 4-week window = 24 h on file; 16 h of it is already booked,
    // and the recent pace is ~3.5 h/week, so the balance has weeks — not months — left
    const tight = state(Array.from({ length: 8 }, (_, i) => appt(`h${i}`, { date: `2026-06-${10 + i}` })), [client({ authWeekly: 6, authStart: '2026-06-01', authEnd: '2026-06-29' })])
    const p = authBurn(tight, 'c1', { today: TODAY, on: TODAY }).pace.projectedEmpty
    expect(p > TODAY).toBe(true)
    expect(p < '2026-09-01').toBe(true)
    expect(authBurn(state([]), 'c1', { today: TODAY }).pace.projectedEmpty).toBe(null)
  })
  it('excludes the appointment being edited so a move is not double-counted', () => {
    const b = authBurn(state(appts), 'c1', { today: TODAY, exclude: ['past1'] })
    expect(b.deliveredHours).toBe(2)
  })
})

describe('the guard', () => {
  const draft = (extra = {}) => ({ date: '2026-06-18', start: 540, end: 660, type: 'service', status: 'active', id: '__draft__', ...extra })

  it('stays quiet when the session fits inside the authorization', () => {
    const r = authCheckFor(state([appt('a', { date: '2026-06-08' })]), client(), draft(), { today: TODAY })
    expect(r.severity).toBe('ok')
    expect(r.blocked).toBe(false)
    expect(r.reasons).toEqual([])
  })
  it('keeps under-delivery coaching out of the escalation path', () => {
    // a client on the first day of a 10 h/week authorization has almost nothing booked:
    // useful colour for the panel, but not a reason to warn about a specific booking
    const fresh = state([], [client({ authWeekly: 10, authStart: '2026-06-01', authEnd: '2026-09-01' })])
    const r = authCheckFor(fresh, fresh.clients[0], draft({ date: '2026-06-18' }), { today: TODAY })
    expect(r.severity).toBe('ok')
    expect(r.reasons).toEqual([])
    expect(r.notes.length).toBeGreaterThan(0)
    expect(r.notes.join(' ')).toMatch(/Under-authorized pacing/)
  })
  it('never spends one authorization on a session that belongs to another window', () => {
    const outside = state([appt('old', { date: '2026-04-05' }), appt('older', { date: '2026-04-06' })])
    const b = authBurn(outside, 'c1', { today: TODAY })
    expect(b.deliveredHours).toBe(0) // both sessions predate the window that starts 2026-05-01
    expect(b.window.start).toBe('2026-05-01')
    const inWindow = state([appt('in', { date: '2026-06-08' })])
    expect(authBurn(inWindow, 'c1', { today: TODAY }).deliveredHours).toBe(2)
  })
  it('refuses a session dated after the authorization ends, and says when it ends', () => {
    const s = state([], [client()], { weekStart: 0, authGuard: { mode: 'stop' } })
    const r = authCheckFor(s, client(), draft({ date: '2026-08-05' }), { today: TODAY })
    expect(r.severity).toBe('stop')
    expect(r.blocked).toBe(true)
    expect(r.reasons[0]).toMatch(/after the authorization ends \(2026-08-01\)/)
  })
  it('warns instead of blocking when the practice runs the guard in warn mode', () => {
    const s = state([], [client()], { weekStart: 0, authGuard: { mode: 'warn' } })
    const r = authCheckFor(s, client(), draft({ date: '2026-08-05' }), { today: TODAY })
    expect(r.severity).toBe('warn')
    expect(r.blocked).toBe(false)
  })
  it('catches a booking that spends past the remaining authorized hours', () => {
    // 10 h/week across the 30 days on file = 42.86 h; 44 h is already committed
    const heavy = state(
      Array.from({ length: 22 }, (_, i) => appt(`h${i}`, { date: `2026-06-${String(1 + (i % 10)).padStart(2, '0')}` })),
      [client({ authWeekly: 10, authStart: '2026-06-01', authEnd: '2026-07-01' })],
    )
    const r = authCheckFor(heavy, heavy.clients[0], draft({ date: '2026-06-14' }), { today: TODAY })
    expect(['warn', 'stop']).toContain(r.severity)
    expect(r.reasons.join(' ')).toMatch(/committed against 42.86 h on file/)
    expect(r.stats.remainingHours).toBeLessThan(0)
  })
  it('catches a week booked past the authorized weekly hours', () => {
    const week = state([
      appt('w1', { date: '2026-06-15' }), appt('w2', { date: '2026-06-16' }), appt('w3', { date: '2026-06-17' }),
      appt('w4', { date: '2026-06-17', start: 900, end: 1080 }),
    ])
    const r = authCheckFor(week, week.clients[0], draft({ date: '2026-06-18' }), { today: TODAY }) // +2 h = 10 h in the week of 6/14
    expect(r.reasons.join(' ')).toMatch(/booked in the week of 2026-06-14 against 10 h\/week authorized/)
  })
  it('raises the renewal window as an authorization approaches expiry', () => {
    const soon = state([], [client({ authEnd: '2026-06-25' })])
    const r = authCheckFor(soon, soon.clients[0], draft({ date: '2026-06-18' }), { today: TODAY })
    expect(r.reasons.join(' ')).toMatch(/expires in 10 days \(2026-06-25\)/)
    expect(r.severity).toBe('warn')
  })
  it('records the problem quietly in flag mode and does nothing at all when off', () => {
    const s = state([], [client({ authEnd: '2026-06-25' })], { weekStart: 0, authGuard: { mode: 'flag' } })
    expect(authCheckFor(s, s.clients[0], draft({ date: '2026-06-18' }), { today: TODAY }).severity).toBe('flag')
    const off = state([], [client({ authEnd: '2026-06-25' })], { weekStart: 0, authGuard: { mode: 'off' } })
    expect(authCheckFor(off, off.clients[0], draft({ date: '2026-06-18' }), { today: TODAY })).toMatchObject({ severity: 'ok', blocked: false, reasons: [] })
  })
  it('ignores appointments that are not clinical care at all', () => {
    const s = state([], [client()], { weekStart: 0, authGuard: { mode: 'stop' } })
    expect(authCheckFor(s, client(), draft({ type: 'drive', date: '2026-12-01' }), { today: TODAY }).severity).toBe('ok')
    expect(authCheckFor(s, client(), draft({ type: 'break', date: '2026-12-01' }), { today: TODAY }).severity).toBe('ok')
  })
  it('draws on the authorization whether or not the ⚡ ABA Hours flag is present', () => {
    // the flag belongs to non-service behavior-analytic time; it must never be able to
    // quietly take a clinical session out of the client's authorization burn-down
    const off = authCheckFor(state([]), client(), draft({ abaHr: false, date: '2026-08-05' }), { today: TODAY })
    const on = authCheckFor(state([]), client(), draft({ abaHr: true, date: '2026-08-05' }), { today: TODAY })
    expect(on).toEqual(off)
    expect(on.reasons.join(' ')).toMatch(/after the authorization ends/)
    expect(on.skipped).toBeUndefined()
  })
  it('says so when the client has no authorization window at all', () => {
    const s = state([])
    const r = authCheckFor(s, { id: 'c9', name: 'No Window' }, draft(), { today: TODAY })
    expect(r.severity).toBe('flag')
    expect(r.reasons[0]).toMatch(/No authorization window on file/)
  })
  it('merges practice overrides over the shipped defaults', () => {
    expect(authGuardCfg({ authGuard: { mode: 'stop' } })).toMatchObject({ mode: 'stop', warnAtPct: AUTH_GUARD_DEFAULTS.warnAtPct })
    expect(authGuardCfg(undefined)).toEqual(AUTH_GUARD_DEFAULTS)
  })
})

describe('auth board', () => {
  it('ranks the clients who need action first and totals the practice position', () => {
    const clients = [
      client({ id: 'ok1', name: 'Fine', authWeekly: 20, authStart: '2026-01-01', authEnd: '2026-12-01' }),
      client({ id: 'lapsed1', name: 'Lapsed', authEnd: '2026-06-01' }),
      client({ id: 'exp1', name: 'Renewal', authEnd: '2026-06-20' }),
    ]
    const appts = [appt('a', { clientIds: ['ok1'], date: '2026-06-01' }), appt('b', { clientIds: ['lapsed1'], date: '2026-06-01' }), appt('c', { clientIds: ['exp1'], date: '2026-06-01' })]
    const board = authBoard(state(appts, clients), { today: TODAY })
    expect(board.rows[0].band).toBe('lapsed')
    expect(board.summary.lapsed).toBe(1)
    expect(board.summary.expiring).toBe(1)
    expect(board.summary.needsAction).toBe(2)
    expect(board.summary.committedHours).toBe(6)
    expect(board.summary.authorizedHours).toBeGreaterThan(0)
  })
})
