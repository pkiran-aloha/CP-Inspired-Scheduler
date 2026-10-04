import React from 'react'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within, cleanup } from '@testing-library/react'
import App from '../App'
import { blankState } from '../state/store'
import { authCheckFor } from '../lib/authBudget'
import {
  unitsFor, unitRuleFor, unitLedger, unitCheckFor, mergeAuthChecks, normalizeAuthUnits, cleanPool, poolFromWeeklyHours,
} from '../lib/authUnits'
import { addDays, isoDate, parseISO, todayISO } from '../lib/date'

const KEY = 'aloha-aba.v3'
const stored = () => { try { return JSON.parse(localStorage.getItem(KEY)) } catch { return null } }
beforeEach(() => { localStorage.clear(); cleanup() })
afterEach(() => cleanup())

const today = todayISO()
const day = (n) => isoDate(addDays(parseISO(today), n))

/**
 * One client on Aetna with a fresh 12-week window and a known unit pool, two delivered
 * 97153 sessions and nothing else on their calendar. Dates are relative to today.
 */
function world({ pool = { '97153': 20, '97155': 4 }, mue, guard = 'warn' } = {}) {
  const s = blankState()
  const c = { ...s.clients[0], insurer: 'Aetna', authWeekly: 10, authStart: day(-14), authEnd: day(70), authUnits: pool, authUnitsConverted: false }
  const mk = (id, date, extra = {}) => ({
    id, date, type: 'service', status: 'completed', clientIds: [c.id], staffIds: [], start: 540, end: 660,
    billing: { code: '97153', unitMins: 30, units: 4, rate: 18, mileage: false }, ...extra,
  })
  const appts = Object.fromEntries(Object.entries(s.appts).filter(([, a]) => !(a.clientIds || []).includes(c.id)))
  appts.u1 = mk('u1', day(-7))
  appts.u2 = mk('u2', day(-3))
  const payers = s.payers.map((p) => (p.name === 'Aetna' && mue ? { ...p, rules: { ...(p.rules || {}), mue } } : p))
  return { ...s, appts, payers, clients: s.clients.map((x, i) => (i === 0 ? c : x)), settings: { ...s.settings, authGuard: { ...(s.settings.authGuard || {}), mode: guard } } }
}
const draft = (c, extra = {}) => ({ date: day(2), start: 600, end: 720, type: 'service', billingCode: '97153', staffIds: [], clientIds: [c.id], ...extra })

describe('units: minutes to billable units', () => {
  it('applies the 8-minute rule (AMA) by default and the payer’s own rounding when set', () => {
    expect([unitsFor(53, 15), unitsFor(52, 15), unitsFor(60, 15)]).toEqual([4, 3, 4])
    expect([unitsFor(53, 15, 'Round Down'), unitsFor(46, 15, 'Round Up'), unitsFor(52, 15, 'Nearest'), unitsFor(52, 15, 'Truncate')]).toEqual([3, 4, 3, 3])
    expect([unitsFor(76, 30), unitsFor(75, 30)]).toEqual([3, 2])
  })

  it('reads unit size and rounding from the payer’s per-service override first', () => {
    const s = world()
    const svc = s.svcs.find((x) => x.code === '97153')
    const c = s.clients[0]
    const payers = s.payers.map((p) => (p.name === 'Aetna' ? { ...p, svcOv: { ...(p.svcOv || {}), [svc.id]: { unitSize: '15 Minutes', rounding: 'Round Down' } } } : p))
    const r = unitRuleFor({ ...s, payers }, { service: svc.id, clientIds: [c.id] })
    expect(r).toMatchObject({ code: '97153', unitMins: 15, rounding: 'Round Down' })
  })
})

describe('the unit ledger and booking checks', () => {
  it('burns each code’s own pool, delivered and scheduled', () => {
    const s = world()
    const L = unitLedger(s, s.clients[0], { today })
    expect(L.codes.find((g) => g.code === '97153')).toMatchObject({ authorized: 20, delivered: 16, scheduled: 0, remaining: 4 })
    expect(L.codes.find((g) => g.code === '97155')).toMatchObject({ authorized: 4, committed: 0 })
  })

  it('warns near the pool, stops past it (capped to a warning in the shipped Warn mode)', () => {
    const s = world()
    const c = s.clients[0]
    const near = unitCheckFor(s, c, draft(c, { end: 630 })) // 30 min = 2 units → 18 of 20
    expect(near.severity).toBe('warn')
    expect(near.reasons[0]).toMatch(/90% of the authorized units/)
    const over = unitCheckFor(s, c, draft(c)) // 2 h = 8 units → 24 of 20
    expect(over.severity).toBe('stop')
    expect(over.reasons[0]).toMatch(/over by 4 units/)
    const merged = mergeAuthChecks(authCheckFor(s, c, draft(c)), over, s.settings)
    expect(merged.severity).toBe('warn')
    expect(merged.blocked).toBe(false)
    const strict = world({ guard: 'stop' })
    expect(mergeAuthChecks(authCheckFor(strict, strict.clients[0], draft(c)), unitCheckFor(strict, strict.clients[0], draft(c)), strict.settings).blocked).toBe(true)
  })

  it('flags a code that is not on the authorization at all', () => {
    const s = world()
    const c = s.clients[0]
    const r = unitCheckFor(s, c, draft(c, { billingCode: '97156' }))
    expect(r.reasons[0]).toMatch(/97156 is not on this client's authorization/)
  })

  it('applies the payer’s MUE daily caps and weekly cap at booking', () => {
    const s = world({ pool: { '97153': 500 }, mue: { daily: '3', per: { '97153': '2' }, weekly: { '97153': '3' } } })
    const c = s.clients[0]
    const r = unitCheckFor(s, c, draft(c))
    expect(r.reasons.some((t) => /MUE: 8 units of 97153 .* maximum of 2 per day/.test(t))).toBe(true)
    expect(r.reasons.some((t) => /MUE: 8 units across all codes .* daily maximum of 3/.test(t))).toBe(true)
    expect(r.reasons.some((t) => /weekly limit: \d+ units of 97153 .* maximum of 3/.test(t))).toBe(true)
  })

  it('warns when the booked staff member’s credential cannot render the code', () => {
    const s = world({ pool: { '97155': 50 } })
    const c = s.clients[0]
    const rbt = s.staff.find((x) => /RBT/.test(x.role))
    const bcba = s.staff.find((x) => /^BCBA/.test(x.role))
    expect(unitCheckFor(s, c, draft(c, { billingCode: '97155', staffIds: [rbt.id] })).reasons.join(' ')).toMatch(/97155 requires a BCBA/)
    expect(unitCheckFor(s, c, draft(c, { billingCode: '97155', staffIds: [bcba.id] })).reasons).toEqual([])
  })

  it('ignores travel, cancellations and the guard switched off', () => {
    const s = world()
    const c = s.clients[0]
    expect(unitCheckFor(s, c, draft(c, { type: 'drive' })).reasons).toEqual([])
    expect(unitCheckFor(s, c, draft(c, { status: 'cancelled' })).reasons).toEqual([])
    const off = world({ guard: 'off' })
    expect(unitCheckFor(off, off.clients[0], draft(c)).reasons).toEqual([])
  })
})

describe('migration and seed', () => {
  it('converts weekly hours into a pool split by the client’s booked codes, once, and marks it for verification', () => {
    const s = blankState()
    const legacy = { ...s, clients: s.clients.map(({ authUnits, authUnitsConverted, ...c }) => c) }
    const m = normalizeAuthUnits(legacy)
    const withWindow = m.clients.filter((c) => c.authWeekly && c.authStart && c.authEnd)
    expect(withWindow.length).toBeGreaterThan(0)
    expect(withWindow.every((c) => c.authUnitsConverted && Object.keys(c.authUnits).length > 0)).toBe(true)
    expect(m.meta.authUnitsMigrated).toBe(withWindow.length)
    expect(normalizeAuthUnits(m)).toBe(m)
    // nothing booked: the whole estimate goes to 97153 (15-minute units → 4 per hour)
    const bare = { ...s, appts: {} }
    expect(poolFromWeeklyHours(bare, { id: 'z', authWeekly: 10, authStart: '2026-01-04', authEnd: '2026-01-18' })).toEqual({ '97153': 80 })
    expect(cleanPool({ 97153: '12', 97155: 0, '': 3, bad: 'x' })).toEqual({ 97153: 12 })
  })

  it('seeds every client with a pool covering each code they are booked under', () => {
    const s = blankState()
    for (const c of s.clients) {
      const L = unitLedger(s, c, { today })
      expect(L.codes.every((g) => g.authorized > 0)).toBe(true)
    }
  })
})

describe('the client form', () => {
  it('shows a converted pool for verification, edits it, and saving confirms it', async () => {
    const s = blankState()
    const clients = s.clients.map((c, i) => (i === 0 ? { ...c, authUnits: { 97153: 120 }, authUnitsConverted: true } : c))
    localStorage.setItem(KEY, JSON.stringify({ ...s, clients, history: [] }))
    render(<App />)
    fireEvent.click(screen.getByTestId('nav-clients'))
    fireEvent.click(screen.getByTestId('cli-mode-table'))
    await screen.findByTestId('clients-table')
    fireEvent.click(screen.getByTestId(`cli-open-${clients[0].id}`))
    fireEvent.click(within(await screen.findByTestId('profile-modal')).getByTestId('pf-edit'))
    expect(await screen.findByTestId('cm-units-converted')).toBeTruthy()
    expect(screen.getByTestId('cm-unit-units-0').value).toBe('120')
    fireEvent.change(screen.getByTestId('cm-unit-units-0'), { target: { value: '96' } })
    fireEvent.click(screen.getByTestId('cm-unit-add'))
    fireEvent.change(screen.getByTestId('cm-unit-code-1'), { target: { value: '97155' } })
    fireEvent.click(screen.getByTestId('cm-save'))
    expect(await screen.findByTestId('cm-units-err')).toBeTruthy() // the new row has no units yet
    fireEvent.change(screen.getByTestId('cm-unit-units-1'), { target: { value: '12' } })
    fireEvent.click(screen.getByTestId('cm-save'))
    await waitFor(() => {
      const c = stored().clients.find((x) => x.id === clients[0].id)
      expect(c.authUnits).toEqual({ 97153: 96, 97155: 12 })
      expect(c.authUnitsConverted).toBe(false)
    })
  })
})
