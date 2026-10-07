import { describe, it, expect } from 'vitest'
import {
  expandRule, describeRule, normalizeRule, sameRule, rulePresets, presetIdOf, legacyRecurrenceOf, retargetRule,
  ruleFromLegacy, ruleOf, normalizeRecurrence, capDateOf, planSeriesTx, lockReason, seriesMembers, occurrenceChecks,
} from '../lib/recurrence'
import { addDays, isoDate, parseISO, todayISO } from '../lib/date'
import { blankState, reducer } from '../state/store'
import { authorizeAction } from '../lib/security'
import { createWorkspaceBackup, readWorkspaceBackup } from '../lib/workspaceBackup'
import { periodFor, sheetKey } from '../lib/payroll'

const dates = (rule, start, opts) => expandRule(rule, start, opts).dates

describe('rule engine', () => {
  it('daily, every N days, and counts', () => {
    expect(dates({ freq: 'daily', end: { type: 'count', count: 3 } }, '2026-10-05')).toEqual(['2026-10-05', '2026-10-06', '2026-10-07'])
    expect(dates({ freq: 'daily', interval: 3, end: { type: 'count', count: 3 } }, '2026-10-05')).toEqual(['2026-10-05', '2026-10-08', '2026-10-11'])
  })

  it('weekly on several weekdays, every weekday, and every 2 weeks', () => {
    expect(dates({ freq: 'weekly', byDay: [1, 3], end: { type: 'count', count: 4 } }, '2026-10-05')).toEqual(['2026-10-05', '2026-10-07', '2026-10-12', '2026-10-14'])
    expect(dates({ freq: 'weekly', byDay: [1, 2, 3, 4, 5], end: { type: 'count', count: 6 } }, '2026-10-09')).toEqual(['2026-10-09', '2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16'])
    expect(dates({ freq: 'weekly', interval: 2, byDay: [2, 4], end: { type: 'count', count: 4 } }, '2026-10-06')).toEqual(['2026-10-06', '2026-10-08', '2026-10-20', '2026-10-22'])
  })

  it('the start date always counts, even off the chosen weekdays (RFC 5545 DTSTART)', () => {
    expect(dates({ freq: 'weekly', byDay: [3], end: { type: 'count', count: 3 } }, '2026-10-05')).toEqual(['2026-10-05', '2026-10-07', '2026-10-14'])
  })

  it('every-2-weeks phase follows the practice week start', () => {
    const r = { freq: 'weekly', interval: 2, byDay: [0, 6], end: { type: 'count', count: 3 } }
    expect(dates(r, '2026-10-10', { weekStart: 0 })).toEqual(['2026-10-10', '2026-10-18', '2026-10-24'])
    expect(dates(r, '2026-10-10', { weekStart: 1 })).toEqual(['2026-10-10', '2026-10-11', '2026-10-24'])
  })

  it('monthly on day 31 skips short months (Google), nth weekday and last weekday', () => {
    expect(dates({ freq: 'monthly', monthBy: 'day', end: { type: 'count', count: 3 } }, '2027-01-31')).toEqual(['2027-01-31', '2027-03-31', '2027-05-31'])
    expect(dates({ freq: 'monthly', monthBy: 'nth', end: { type: 'count', count: 3 } }, '2026-10-13')).toEqual(['2026-10-13', '2026-11-10', '2026-12-08'])
    expect(dates({ freq: 'monthly', monthBy: 'last', end: { type: 'count', count: 3 } }, '2026-10-30')).toEqual(['2026-10-30', '2026-11-27', '2026-12-25'])
    expect(dates({ freq: 'monthly', interval: 2, monthBy: 'day', end: { type: 'count', count: 3 } }, '2026-10-15')).toEqual(['2026-10-15', '2026-12-15', '2027-02-15'])
  })

  it('ends on a date, never (12-month cap) and after N past the cap', () => {
    expect(dates({ freq: 'weekly', byDay: [1], end: { type: 'until', until: '2026-10-19' } }, '2026-10-05')).toEqual(['2026-10-05', '2026-10-12', '2026-10-19'])
    const never = expandRule({ freq: 'weekly', byDay: [1] }, '2026-10-05')
    expect(never.capped).toBe(true)
    expect(never.dates).toHaveLength(53) // 2026-10-05 … 2027-10-04 inclusive
    expect(never.dates.at(-1) <= capDateOf('2026-10-05')).toBe(true)
    expect(capDateOf('2026-10-05')).toBe('2027-10-04')
    const many = expandRule({ freq: 'weekly', byDay: [1], end: { type: 'count', count: 80 } }, '2026-10-05')
    expect(many.capped).toBe(true)
    expect(many.dates).toHaveLength(53)
    expect(expandRule({ freq: 'weekly', byDay: [1], end: { type: 'until', until: '2030-01-01' } }, '2026-10-05').capped).toBe(true)
    // yearly inside a 12-month window is the start date only — said honestly as capped
    expect(expandRule({ freq: 'yearly' }, '2026-10-07')).toMatchObject({ dates: ['2026-10-07'], capped: true })
  })

  it('describes rules in words', () => {
    expect(describeRule({ freq: 'weekly', byDay: [1, 3], end: { type: 'until', until: '2026-12-31' } }, '2026-10-05')).toBe('Weekly on Mon, Wed until Dec 31, 2026')
    expect(describeRule({ freq: 'weekly', byDay: [1, 2, 3, 4, 5] }, '2026-10-05')).toBe('Every weekday (Mon–Fri)')
    expect(describeRule({ freq: 'daily', interval: 3, end: { type: 'count', count: 10 } }, '2026-10-05')).toBe('Every 3 days, 10 times')
    expect(describeRule({ freq: 'monthly', monthBy: 'nth' }, '2026-10-13')).toBe('Monthly on the second Tuesday')
    expect(describeRule({ freq: 'monthly', monthBy: 'last', interval: 2 }, '2026-10-30')).toBe('Every 2 months on the last Friday')
    expect(describeRule({ freq: 'yearly' }, '2026-10-07')).toBe('Annually on October 7')
    expect(describeRule(null, '2026-10-07')).toBe("Doesn't repeat")
  })

  it('presets, preset matching, legacy labels, retargeting and sanitising', () => {
    const ids = rulePresets('2026-10-30').map((p) => p.id)
    expect(ids).toEqual(['none', 'daily', 'weekdays', 'weekly', 'biweekly', 'monthly', 'monthly-last', 'yearly'])
    expect(rulePresets('2026-10-13').map((p) => p.id)).toContain('monthly-nth')
    expect(presetIdOf({ freq: 'weekly', byDay: [1], end: { type: 'count', count: 3 } }, '2026-10-05')).toBe('weekly')
    expect(presetIdOf({ freq: 'weekly', byDay: [1, 4] }, '2026-10-05')).toBe('custom')
    expect(presetIdOf(null, '2026-10-05')).toBe('none')
    expect(legacyRecurrenceOf({ freq: 'weekly', interval: 2 })).toBe('biweekly')
    expect(legacyRecurrenceOf({ freq: 'monthly', interval: 1 })).toBe('monthly')
    expect(retargetRule({ freq: 'weekly', byDay: [1] }, '2026-10-05', '2026-10-07').byDay).toEqual([3])
    expect(retargetRule({ freq: 'weekly', byDay: [1, 3] }, '2026-10-05', '2026-10-06').byDay).toEqual([1, 3])
    expect(normalizeRule({ freq: 'hourly' }, '2026-10-05')).toBeNull()
    expect(normalizeRule({ freq: 'weekly', interval: -4, byDay: [9, 'x'], end: { type: 'count', count: 0 } }, '2026-10-05'))
      .toEqual({ freq: 'weekly', interval: 1, byDay: [1], end: { type: 'count', count: 1 } })
    expect(sameRule({ freq: 'weekly', byDay: [1] }, { freq: 'weekly', byDay: [1], interval: 1, end: { type: 'never' } })).toBe(true)
    expect(sameRule({ freq: 'weekly', byDay: [1] }, null)).toBe(false)
  })

  it('reads legacy series and migrates them once (idempotent, same object when done)', () => {
    expect(ruleFromLegacy('biweekly', '2026-10-05', '2026-11-02')).toMatchObject({ freq: 'weekly', interval: 2, byDay: [1], end: { type: 'until', until: '2026-11-02' } })
    const state = { appts: {
      a: { id: 'a', seriesId: 'L', recurrence: 'weekly', date: '2026-10-12' },
      b: { id: 'b', seriesId: 'L', recurrence: 'weekly', date: '2026-10-05' },
      c: { id: 'c', date: '2026-10-05' },
    } }
    const once = normalizeRecurrence(state)
    expect(once).not.toBe(state)
    expect(once.appts.a.rrule).toEqual({ freq: 'weekly', interval: 1, byDay: [1], end: { type: 'until', until: '2026-10-12' }, dtstart: '2026-10-05' })
    expect(once.appts.c).toBe(state.appts.c)
    expect(normalizeRecurrence(once)).toBe(once)
    expect(ruleOf(once.appts.a, seriesMembers(once.appts, 'L')).dtstart).toBe('2026-10-05')
    // the seeded demo series arrive with rules already
    expect(Object.values(blankState().appts).filter((x) => x.seriesId).every((x) => x.rrule)).toBe(true)
  })
})

// ---------- series transactions, relative to today ----------

const TODAY = todayISO()
const plus = (iso, n) => isoDate(addDays(parseISO(iso), n))
const nextMonday = (iso) => { const d = parseISO(iso); return plus(iso, (8 - d.getDay()) % 7 || 7) }
const BASE = blankState()
const S = BASE.staff[0].id
const WEEKLY = { freq: 'weekly', interval: 1, byDay: [1], end: { type: 'count', count: 6 } }

function withSeries(startISO, rule = WEEKLY, patch = {}) {
  const appts = { ...BASE.appts }
  dates(rule, startISO).forEach((d, i) => {
    appts[`r${i}`] = {
      id: `r${i}`, type: 'break', title: 'Team block', date: d, start: 540, end: 600, staffIds: [S], clientIds: [], status: 'active',
      seriesId: 'SER', rrule: { ...rule, dtstart: startISO }, recurrence: legacyRecurrenceOf(rule), notes: '', custom: {}, documents: [], verification: null,
      ...(patch[`r${i}`] || {}),
    }
  })
  return { ...BASE, appts }
}
const run = (state, input) => planSeriesTx(state, input, { today: TODAY })
const apply = (state, input) => {
  const plan = run(state, input)
  return { plan, next: reducer(state, { type: 'seriesTx', input, today: TODAY, ids: plan.newIds }) }
}
const series = (state, sid = 'SER') => seriesMembers(state.appts, sid)

describe('series edits (Google semantics)', () => {
  const START = nextMonday(plus(TODAY, 60))

  it('"all" copies changed fields, keeps exceptions’ own changes, never touches locked sessions; one Undo', () => {
    const state = withSeries(START, WEEKLY, { r1: { edited: true, notes: 'own note' }, r2: { status: 'completed' } })
    const { plan, next } = apply(state, { op: 'edit', id: 'r0', scope: 'all', draft: { ...state.appts.r0, title: 'Renamed' } })
    expect(plan.ok).toBe(true)
    expect(plan.msg).toMatch(/Updated all 5 occurrences · 1 kept as it is \(1 completed\)/)
    expect(next.appts.r1).toMatchObject({ title: 'Renamed', notes: 'own note', edited: true })
    expect(next.appts.r2.title).toBe('Team block')
    expect(series(next).filter((a) => a.title === 'Renamed')).toHaveLength(5)
    const undone = reducer(next, { type: 'undo' })
    expect(undone.appts).toBe(state.appts)
  })

  it('a series edit never copies status, verification or documents to other sessions', () => {
    const state = withSeries(START)
    const { next } = apply(state, { op: 'edit', id: 'r0', scope: 'all', draft: { ...state.appts.r0, status: 'confirmed', notes: 'n', documents: [{ id: 'd' }] } })
    expect(next.appts.r0.status).toBe('confirmed')
    expect(next.appts.r1).toMatchObject({ status: 'active', notes: 'n', documents: [] })
  })

  it('"this and following" splits the series; earlier sessions end the day before', () => {
    const state = withSeries(START)
    const { plan, next } = apply(state, { op: 'edit', id: 'r3', scope: 'following', draft: { ...state.appts.r3, title: 'Later' } })
    expect(plan.msg).toBe('Updated this & 2 following')
    const head = ['r0', 'r1', 'r2'].map((id) => next.appts[id])
    expect(head.every((a) => a.seriesId === 'SER' && a.title === 'Team block' && a.rrule.end.until === plus(state.appts.r3.date, -1))).toBe(true)
    const tail = ['r3', 'r4', 'r5'].map((id) => next.appts[id])
    expect(new Set(tail.map((a) => a.seriesId)).size).toBe(1)
    expect(tail[0].seriesId).not.toBe('SER')
    expect(tail.every((a) => a.title === 'Later' && a.rrule.dtstart === state.appts.r3.date)).toBe(true)
  })

  it('a new rule rebuilds upcoming sessions; locked ones stay and their slot is not doubled', () => {
    const state = withSeries(START, WEEKLY, { r4: { status: 'completed' } })
    const rule = { freq: 'weekly', byDay: [1, 3], end: { type: 'count', count: 6 } }
    const { plan, next } = apply(state, { op: 'edit', id: 'r2', scope: 'following', draft: state.appts.r2, rule })
    expect(plan.ok).toBe(true)
    const tail = Object.values(next.appts).filter((a) => a.seriesId && a.seriesId !== 'SER' && a.rrule?.byDay?.join() === '1,3')
    const ds = tail.map((a) => a.date).sort()
    expect(ds).toEqual(dates(rule, state.appts.r2.date))
    expect(next.appts.r4.status).toBe('completed') // kept, now on the new series
    expect(tail.filter((a) => a.date === state.appts.r4.date)).toHaveLength(1)
    expect(next.appts.r5).toBeUndefined() // past the 6-count, replaced
    expect(plan.msg).toMatch(/Series rebuilt — Weekly on Mon, Wed, 6 times/)
    expect(plan.msg).toMatch(/1 kept as it is \(1 completed\)/)
    // regression: a rebuild used to be three dispatches (update, remove, create) = three Undo steps
    expect(reducer(next, { type: 'undo' }).appts).toBe(state.appts)
  })

  it('a no-show in the same slot is not a clash (it used to block like a live booking)', () => {
    const state = withSeries(START)
    const ghost = { id: 'ghost', type: 'break', date: START, start: 540, end: 600, staffIds: [S], clientIds: [], status: 'no-show' }
    const { r0, ...rest } = state.appts
    const draft = { ...r0, id: 'new' }
    expect(occurrenceChecks({ ...state, appts: { ...rest, ghost } }, draft).reasons).toEqual([])
    expect(occurrenceChecks({ ...state, appts: { ...rest, ghost: { ...ghost, status: 'active' } } }, draft).reasons[0]).toMatch(/time clash/)
  })

  it('moving the date for all sessions moves the weekday of the whole series', () => {
    const state = withSeries(START)
    const { next } = apply(state, { op: 'edit', id: 'r0', scope: 'all', draft: { ...state.appts.r0, date: plus(START, 1) } })
    const all = series(next)
    expect(all).toHaveLength(6)
    expect(all.every((a) => parseISO(a.date).getDay() === 2)).toBe(true)
    expect(all[0].rrule.byDay).toEqual([2])
  })

  it('rebuilds reject a clashing date and name it; a Stop on the edited session refuses the whole change', () => {
    const state = withSeries(START)
    const clashDay = plus(START, 15) // the Tuesday two weeks on
    state.appts.block = { id: 'block', type: 'break', title: 'Busy', date: clashDay, start: 540, end: 600, staffIds: [S], clientIds: [], status: 'active' }
    const rule = { freq: 'weekly', byDay: [1, 2], end: { type: 'count', count: 6 } }
    const { plan } = apply(state, { op: 'edit', id: 'r0', scope: 'all', draft: state.appts.r0, rule })
    expect(plan.msg).toMatch(new RegExp(`1 rejected \\(${clashDay}: time clash`))
    const moved = { ...state, appts: { ...state.appts, block: { ...state.appts.block, date: START } } }
    expect(run(moved, { op: 'edit', id: 'r0', scope: 'all', draft: moved.appts.r0, rule }).ok).toBe(false)
  })

  it('"does not repeat" on this and following ends the series here', () => {
    const state = withSeries(START)
    const { next } = apply(state, { op: 'edit', id: 'r2', scope: 'following', draft: state.appts.r2, rule: null })
    expect(next.appts.r2.seriesId).toBeUndefined()
    expect(next.appts.r3).toBeUndefined()
    expect(series(next).map((a) => a.id)).toEqual(['r0', 'r1'])
  })

  it('turns a single session into a series', () => {
    const state = { ...BASE, appts: { ...BASE.appts, solo: { id: 'solo', type: 'break', title: 'Solo', date: START, start: 540, end: 600, staffIds: [S], clientIds: [], status: 'active' } } }
    const { plan, next } = apply(state, { op: 'edit', id: 'solo', scope: 'all', draft: state.appts.solo, rule: { freq: 'daily', end: { type: 'count', count: 3 } } })
    expect(plan.ok).toBe(true)
    expect(seriesMembers(next.appts, next.appts.solo.seriesId).map((a) => a.date)).toEqual([START, plus(START, 1), plus(START, 2)])
  })

  it('a series edit cannot be scoped to one occurrence, and a non-series needs a rule', () => {
    const state = withSeries(START)
    expect(run(state, { op: 'edit', id: 'r1', scope: 'one', draft: state.appts.r1 }).ok).toBe(false)
    expect(run(BASE, { op: 'edit', id: Object.keys(BASE.appts).find((k) => !BASE.appts[k].seriesId), scope: 'all', draft: {} }).ok).toBe(false)
  })
})

describe('series delete and cancel', () => {
  const START = nextMonday(plus(TODAY, 60))

  it('delete following keeps billed and completed sessions and caps the earlier series', () => {
    const state = withSeries(START, WEEKLY, { r3: { billing: { status: 'billed' } }, r4: { status: 'completed' } })
    const { plan, next } = apply(state, { op: 'remove', id: 'r2', scope: 'following' })
    expect(plan.msg).toBe('Deleted 2 occurrences · 2 kept as they are (1 billed or on a claim, 1 completed)')
    expect(Object.keys(next.appts).filter((k) => k.startsWith('r')).sort()).toEqual(['r0', 'r1', 'r3', 'r4'])
    expect(next.appts.r0.rrule.end).toEqual({ type: 'until', until: plus(state.appts.r2.date, -1) })
    expect(reducer(next, { type: 'undo' }).appts).toBe(state.appts)
  })

  it('delete one refuses a session on a claim', () => {
    const state = withSeries(START, WEEKLY, { r1: { claimId: 'clm-x' } })
    expect(run(state, { op: 'remove', id: 'r1', scope: 'one' })).toMatchObject({ ok: false })
    expect(run(state, { op: 'remove', id: 'r0', scope: 'one' }).deleteIds).toEqual(['r0'])
  })

  it('cancel all upcoming: reason and cancellation time stamped, past sessions left alone', () => {
    const start = plus(nextMonday(TODAY), -21)
    const state = withSeries(start)
    const { plan, next } = apply(state, { op: 'cancel', id: 'r4', scope: 'all', status: 'cancelled', cancelReasonId: 'opt-x', cancelReason: 'Weather' })
    expect(plan.ok).toBe(true)
    const all = series(next)
    for (const a of all) {
      if (a.date >= TODAY) expect(a).toMatchObject({ status: 'cancelled', cancelReason: 'Weather' })
      else expect(a.status).toBe('active')
    }
    expect(all.filter((a) => a.status === 'cancelled').every((a) => a.cancelledAt)).toBe(true)
  })

  it('locks: payroll-approved periods count as locked', () => {
    const state = withSeries(nextMonday(plus(TODAY, 60)))
    const a = state.appts.r0
    const period = periodFor(state.settings.payroll, a.date)
    const locked = { ...state, paySheets: { ...state.paySheets, [sheetKey(S, period.id)]: { status: 'approved' } } }
    expect(lockReason(state, a)).toBeNull()
    expect(lockReason(locked, a)).toBe('payroll')
  })
})

describe('series plumbing', () => {
  it('seriesTx is authorized for calendar users and its rule survives a backup round-trip', () => {
    const state = withSeries(nextMonday(plus(TODAY, 60)))
    expect(authorizeAction(state, { type: 'seriesTx', input: { op: 'remove', id: 'r0', scope: 'all' } }).ok).toBe(true)
    const { data } = readWorkspaceBackup(createWorkspaceBackup(state), blankState())
    expect(data.appts.r0.rrule).toEqual(state.appts.r0.rrule)
    const bad = { ...state, appts: { ...state.appts, r0: { ...state.appts.r0, rrule: { freq: 'hourly' } } } }
    expect(() => readWorkspaceBackup(createWorkspaceBackup(bad), blankState())).toThrow(/invalid appointments/)
  })
})
