import { describe, it, expect } from 'vitest'
import { isStaffFree, suggestStaff, weekLoad, needsCoverFor, scanNeedsCover, smartCfg } from '../lib/smart'
import { weekAnalytics } from '../lib/analytics'

const mk = (id, extra) => ({ id, date: '2026-09-14', start: 540, end: 600, type: 'service', status: 'active', staffIds: [], clientIds: [], ...extra })

describe('isStaffFree', () => {
  it('blocks overlapping bookings, ignores cancelled & unrelated types', () => {
    const appts = {
      a: mk('a', { staffIds: ['s1'] }),
      b: mk('b', { staffIds: ['s1'], status: 'cancelled' }),
      c: mk('c', { staffIds: ['s1'], type: 'break' }),
      d: mk('d', { staffIds: ['s1'], type: 'unavailable', start: 600, end: 660 }),
      e: mk('e', { staffIds: ['s9'], start: 600, end: 660 }),
    }
    expect(isStaffFree(appts, 's1', '2026-09-14', 540, 600)).toBe(false)
    expect(isStaffFree(appts, 's1', '2026-09-14', 540, 600, ['a'])).toBe(true) // ignoreIds skips the source booking
    expect(isStaffFree(appts, 's1', '2026-09-14', 630, 690)).toBe(false) // blocked by 'd' unavailable
    expect(isStaffFree(appts, 's9', '2026-09-14', 540, 600)).toBe(true) // adjacent, not overlapping
    expect(isStaffFree(appts, 's2', '2026-09-14', 540, 600)).toBe(true)
  })
})

describe('suggestStaff', () => {
  const staff = [
    { id: 'sa', name: 'Alpha One', role: 'BCBA', color: '#111', initials: 'AO' },
    { id: 'sb', name: 'Beta Two', role: 'RBT', color: '#222', initials: 'BT' },
    { id: 'sc', name: 'Busy Three', role: 'RBT', color: '#333', initials: 'BU' },
  ]
  const teams = [{ id: 't1', name: 'T', color: '#f00', staffIds: ['sa', 'sc'], clientIds: ['c1'] }]
  const clients = [{ id: 'c1', name: 'Client', program: 'EIBI · Day program' }]
  const appts = {
    past: mk('past', { staffIds: ['sa'], clientIds: ['c1'], status: 'completed', date: '2026-08-10' }),
    past2: mk('past2', { staffIds: ['sa'], clientIds: ['c1'], status: 'completed', date: '2026-08-17' }),
    busyNow: mk('busyNow', { staffIds: ['sc'] }),
  }
  it('ranks team + history first and drops busy staff', () => {
    const r = suggestStaff({ staff, teams, clients, appts, clientIds: ['c1'], date: '2026-09-14', start: 540, end: 600 })
    expect(r.map((x) => x.staff.id)).toEqual(['sa', 'sb']) // sc busy
    expect(r[0].reasons.some((t) => /care team/.test(t))).toBe(true)
    expect(r[0].reasons.some((t) => /prior session/.test(t))).toBe(true)
  })
  it('honors exclude list (current staff already assigned)', () => {
    const r = suggestStaff({ staff, teams, clients, appts, clientIds: ['c1'], date: '2026-09-14', start: 540, end: 600, exclude: ['sa'] })
    expect(r.map((x) => x.staff.id)).toEqual(['sb'])
  })
})

describe('backfill scan', () => {
  it('needsCoverFor only flags cancellations that carried a client', () => {
    expect(needsCoverFor(mk('x', { status: 'cancelled', clientIds: ['c1'] }))).toBe(true)
    expect(needsCoverFor(mk('x', { status: 'cancelled', clientIds: [] }))).toBe(false)
    expect(needsCoverFor(mk('x', { status: 'cancelled', clientIds: ['c1'], backfillIgnored: true }))).toBe(false)
    expect(needsCoverFor(mk('x', { status: 'active', clientIds: ['c1'] }))).toBe(false)
  })
  it('scanNeedsCover finds restaffable slots and weekLoad counts occupancy', () => {
    const appts = { gone: mk('gone', { status: 'cancelled', staffIds: ['s1'], clientIds: ['c1'] }), live: mk('live', { staffIds: ['s2'], clientIds: ['c2'], start: 600, end: 660 }) }
    const state = { appts, staff: [{ id: 's2', name: 'Keep', role: 'RBT', initials: 'K', color: '#333' }], teams: [], clients: [{ id: 'c1', name: 'Cl', program: '' }] }
    expect(weekLoad(appts, ['2026-09-14'])).toEqual({ s2: 1 })
    const rows = scanNeedsCover(state, ['2026-09-14'])
    expect(rows.length).toBe(1)
    expect(rows[0].candidates[0].staff.id).toBe('s2')
  })
})

describe('weekAnalytics', () => {
  it('summarizes sessions, money, cancellations & utilization for a range', () => {
    const appts = {
      s1: mk('s1', { staffIds: ['a'], clientIds: ['c1'], billing: { code: '97151', units: 2, rate: 32, unitMins: 30 } }),
      s2: mk('s2', { status: 'cancelled', clientIds: ['c1'] }),
      dr: mk('dr', { type: 'drive', staffIds: ['a'], billing: { code: 'H2019', units: 0, rate: 0, mileage: true, distance: 10, mileageRate: 0.7 } }),
    }
    const state = { appts, staff: [{ id: 'a' }, { id: 'b' }], clients: [], teams: [], settings: { workday: [8, 18] } }
    const an = weekAnalytics(state, ['2026-09-14'])
    expect(an.sessions).toBe(1)
    expect(an.revenue).toBeCloseTo(64 + 7, 2)
    expect(an.cancelled).toBe(1)
    expect(an.cancelRate).toBe(33)
    expect(an.utilization).toBe(10) // 120 booked min over 2 staff × 10h
    expect(an.codeMix[0]).toMatchObject({ code: '97151' })
  })
})

describe('smart config (customization)', () => {
  it('weights reshape ranking and backfill gates filter candidates', () => {
    const staff = [
      { id: 'team', name: 'Team Guy', role: 'RBT', color: '#111', initials: 'TG' },
      { id: 'hist', name: 'History Hero', role: 'BCBA', color: '#222', initials: 'HH' },
    ]
    const teams = [{ id: 't1', staffIds: ['team'], clientIds: ['c1'] }]
    const clients = [{ id: 'c1', name: 'Kid', program: 'Center 1:1' }]
    const appts = { h1: mk('h1', { staffIds: ['hist'], clientIds: ['c1'], status: 'completed', date: '2026-08-10' }) }
    const base = { staff, teams, clients, appts, clientIds: ['c1'], date: '2026-09-14', start: 540, end: 600 }
    // team affinity maxed, history zeroed → team guy wins
    const favTeam = suggestStaff({ ...base, cfg: { weights: { team: 100, history: 0, fit: 0, load: 0 }, suggest: { count: 2 }, backfill: { minScore: 0, turnaround: false } } })
    expect(favTeam[0].staff.id).toBe('team')
    // history maxed, team zeroed → history hero wins
    const favHist = suggestStaff({ ...base, cfg: { weights: { team: 0, history: 100, fit: 0, load: 0 }, suggest: { count: 2 }, backfill: { minScore: 0, turnaround: false } } })
    expect(favHist[0].staff.id).toBe('hist')
    // same-team-only gate drops everyone else
    const onlyTeam = suggestStaff({ ...base, sameTeamOnly: true, cfg: { weights: { team: 0, history: 0, fit: 0, load: 0 }, backfill: { minScore: 0, turnaround: false, sameTeamOnly: true } } })
    expect(onlyTeam.map((x) => x.staff.id)).toEqual(['team'])
    // minScore floor (backfill mode) filters weak matches
    const strict = suggestStaff({ ...base, cfg: { weights: { team: 0, history: 0, fit: 0, load: 0 }, backfill: { minScore: 100, turnaround: false }, __isBackfill: true } })
    expect(strict.length).toBe(0) // baseline 40 < 100
  })
  it('smartCfg fills defaults & clamps', () => {
    const cfg = smartCfg({})
    expect(cfg.suggest.count).toBe(3)
    expect(cfg.backfill.minScore).toBe(25)
    const over = smartCfg({ settings: {} })
    expect(over.weights.team).toBe(60)
    const custom = smartCfg({ smart: { weights: { team: 12, history: 55, fit: 55, load: 45 }, suggest: { count: 5 }, backfill: { count: 1 } } })
    expect(custom.weights.team).toBe(12)
    expect(custom.suggest.count).toBe(5)
    expect(custom.backfill.minScore).toBe(25)
  })
})
