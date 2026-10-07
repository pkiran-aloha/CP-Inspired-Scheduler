import { describe, it, expect, beforeEach } from 'vitest'
import { initial, reducer, visibleApptsFor, layoutLanes, weekStats, groupOverlaps } from '../state/store'
import { computeBilling, findConflicts, seriesSiblings } from '../lib/model'
import { fmtTime, snap, minToHM, hmToMin, fmtDur, startOfWeek, addDays, isoDate, todayISO } from '../lib/date'

beforeEach(() => localStorage.clear())

describe('payer edits', () => {
  it('a generic payer edit is one undoable transaction that touches only the payers', () => {
    const s = initial()
    const target = s.payers[0]
    const next = reducer(s, { type: 'payer', mode: 'patch', item: { id: target.id, name: `${target.name} (renamed)` } })
    expect(next.payers.find((p) => p.id === target.id).name).toBe(`${target.name} (renamed)`)
    expect(next.history.length).toBe(s.history.length + 1)
    expect(next.clients).toBe(s.clients) // the snapshot restores payers only
    const back = reducer(next, { type: 'undo' })
    expect(back.payers.find((p) => p.id === target.id).name).toBe(target.name)
    expect(back.history.length).toBe(s.history.length)
    // noSnap: the service-delete contract cleanup must not add a step of its own
    const quiet = reducer(s, { type: 'payer', mode: 'patch', item: { id: target.id, name: 'Quiet' }, noSnap: true })
    expect(quiet.history.length).toBe(s.history.length)
    expect(quiet.payers.find((p) => p.id === target.id).name).toBe('Quiet')
  })
})

describe('initial state', () => {
  it('seeds the master rosters', () => {
    const s = initial()
    expect(s.staff.map((x) => x.name)).toEqual([
      'Prateek Kiran', 'Neha Peyyeti', 'Saija Kotha', 'Saumya Chitranshi', 'Munna Sala', 'Chandan Gupta',
      'Dhananjay Masal', 'Rohit Srivastava', 'Shishir Sharma', 'Brook Joyce', 'Michael McDonald', 'Anik Gajjar',
    ])
    expect(s.clients.length).toBe(16)
    expect(s.clients.find((c) => c.name === 'Justin Hsu')).toBeTruthy()
    expect(s.clients.find((c) => c.name === 'Bharath Reddy')).toBeTruthy()
    expect(s.teams.length).toBe(5)
    expect(s.ui.view).toBe('week')
    expect(s.ui.anchor).toBe(todayISO())
  })

  it('care teams randomly distribute every staff & client, none left out', () => {
    const s = initial()
    const clientsCovered = s.teams.flatMap((t) => t.clientIds)
    const staffCovered = s.teams.flatMap((t) => t.staffIds)
    expect(new Set(clientsCovered).size).toBe(16) // every client exactly once
    expect(s.teams.reduce((m, t) => Math.max(m, t.clientIds.length), 0)).toBeGreaterThan(2)
    expect(new Set(staffCovered).size).toBe(12) // every staff member on at least one team
  })

  it('seed data is rich across every field', () => {
    const vals = Object.values(initial().appts)
    expect(vals.length).toBeGreaterThan(300)
    expect(vals.filter((a) => a.notes).length).toBeGreaterThan(50)
    expect(vals.some((a) => a.documents?.length >= 2 && a.documents[0].tag)).toBe(true)
    expect(vals.some((a) => a.verification?.signature?.certification && a.verification.signature.geo)).toBe(true)
    expect(vals.some((a) => a.verification?.verifyStatus === 'flagged')).toBe(true)
    // chunk-39: NO pre-loaded custom field values anywhere in the seed data
    expect(vals.every((a) => !a.custom || Object.keys(a.custom).length === 0)).toBe(true)
    expect(vals.some((a) => a.recurrence === 'weekly' && a.seriesId)).toBe(true)
    expect(vals.some((a) => a.edited)).toBe(true) // seeded series exceptions
    expect(vals.some((a) => a.type === 'drive' && a.billing?.mileage && a.billing.distance > 0)).toBe(true)
    expect(vals.some((a) => a.type === 'break')).toBe(true)
    expect(vals.some((a) => a.type === 'supervision')).toBe(true)
    expect(vals.some((a) => a.type === 'evaluation' && a.billing?.units)).toBe(true)
    expect(vals.some((a) => a.status === 'no-show')).toBe(true)
    expect(vals.some((a) => a.location === 'Telehealth (video)')).toBe(true)
  })
})

describe('reducer', () => {
  it.each([{ section: 'settings' }, { settings: true, settingsModule: 'payroll', settingsSub: 'overtime' }])('reveals the sidebar for settings navigation %j', (patch) => {
    const state = { ui: { section: 'calendar', nav: true } }
    const next = reducer(state, { type: 'setUI', patch })
    expect(next.ui.section).toBe('settings')
    expect(next.ui.nav).toBe(false)
    if (patch.settings) {
      expect(next.ui.settings).toBe(false)
      expect(next.ui.settingsModule).toBe('payroll')
      expect(next.ui.settingsSub).toBe('overtime')
    }
    expect(state.ui.nav).toBe(true) // navigation does not mutate the previous state
  })

  it('preserves explicit collapse choices and leaves other section navigation alone', () => {
    const state = { ui: { section: 'settings', nav: false } }
    const collapsed = reducer(state, { type: 'setUI', patch: { nav: true } })
    expect(collapsed.ui.nav).toBe(true)
    const other = reducer(collapsed, { type: 'setUI', patch: { section: 'clients' } })
    expect(other.ui.nav).toBe(true)
    const explicit = reducer(other, { type: 'setUI', patch: { section: 'settings', nav: true } })
    expect(explicit.ui.nav).toBe(true)
  })

  it('creates, updates and deletes appointments, with undo', () => {
    let s = initial()
    const n0 = Object.keys(s.appts).length
    s = reducer(s, { type: 'upsertMany', appts: [{ id: 'x1', date: '2099-01-01', type: 'service', start: 540, end: 600, title: 'T', staffIds: [], clientIds: [], status: 'active' }] })
    expect(s.appts.x1).toBeTruthy()
    s = reducer(s, { type: 'patch', id: 'x1', patch: { title: 'T2' } })
    expect(s.appts.x1.title).toBe('T2')
    s = reducer(s, { type: 'deleteMany', ids: ['x1'] })
    expect(s.appts.x1).toBeFalsy()
    expect(Object.keys(s.appts).length).toBe(n0)
    s = reducer(s, { type: 'undo' })
    expect(s.appts.x1?.title).toBe('T2')
  })

  it('toggles staff selection for filtering', () => {
    let s = initial()
    s = reducer(s, { type: 'toggleSel', list: 'staffSel', id: 's1' })
    expect(s.ui.staffSel).toEqual(['s1'])
    s = reducer(s, { type: 'toggleSel', list: 'staffSel', id: 's1' })
    expect(s.ui.staffSel).toEqual([])
  })
})

describe('selectors & filters', () => {
  it('filters by staff selection', () => {
    const s = initial()
    const day = Object.values(s.appts).find((a) => a.type === 'service' && a.staffIds.length === 1)?.date
    const all = visibleApptsFor(s, day)
    const one = all.find((a) => a.staffIds.length === 1)
    const s2 = { ...s, ui: { ...s.ui, staffSel: [one.staffIds[0]] } }
    const filtered = visibleApptsFor(s2, day)
    expect(filtered.length).toBeLessThan(all.length)
    expect(filtered.every((a) => a.staffIds.includes(one.staffIds[0]))).toBe(true)
  })

  it('team selection keeps only the team’s staff or clients', () => {
    const s = initial()
    const team = s.teams.find((t) => t.staffIds.length && t.clientIds.length)
    const day = [...new Set(Object.values(s.appts).map((a) => a.date))].sort().find((d) => {
      const list = Object.values(s.appts).filter((a) => a.date === d)
      return list.some((a) => a.staffIds?.some((x) => team.staffIds.includes(x))) && list.some((a) => !a.staffIds?.some((x) => team.staffIds.includes(x)) && !a.clientIds?.some((x) => team.clientIds.includes(x)))
    })
    const s2 = { ...s, ui: { ...s.ui, teamSel: [team.id] } }
    const shown = visibleApptsFor(s2, day)
    const all = visibleApptsFor(s, day)
    expect(shown.length).toBeLessThan(all.length)
    const tS = new Set(team.staffIds)
    const tC = new Set(team.clientIds)
    expect(shown.every((a) => a.staffIds?.some((x) => tS.has(x)) || a.clientIds?.some((x) => tC.has(x)))).toBe(true)
  })

  it('assigns overlap lanes and cluster widths', () => {
    const day = [
      { id: 'a', start: 540, end: 600 },
      { id: 'b', start: 570, end: 630 },
      { id: 'c', start: 700, end: 760 },
    ]
    const laid = layoutLanes(day)
    const byId = Object.fromEntries(laid.map((x) => [x.id, x]))
    expect(byId.a.lane).toBe(0)
    expect(byId.b.lane).toBe(1)
    expect(byId.a.cols).toBe(2)
    expect(byId.c.cols).toBe(1)
  })

  it('groups time-overlapping appointments into one cluster, chaining transitively', () => {
    const day = [
      { id: 'a', date: '2026-09-09', start: 540, end: 600 },
      { id: 'b', date: '2026-09-09', start: 570, end: 630 }, // overlaps a
      { id: 'c', date: '2026-09-09', start: 615, end: 700 }, // overlaps b only → joins via chain
      { id: 'd', date: '2026-09-09', start: 720, end: 780 }, // separate
      { id: 'e', date: '2026-09-09', start: 780, end: 840 }, // touching d's end → separate
    ]
    const gs = groupOverlaps(day)
    expect(gs.length).toBe(3)
    expect(gs[0].items.map((x) => x.id)).toEqual(['a', 'b', 'c'])
    expect(gs[0].start).toBe(540)
    expect(gs[0].end).toBe(700)
    expect(gs[1].items.map((x) => x.id)).toEqual(['d'])
    expect(gs[2].items.map((x) => x.id)).toEqual(['e'])
    // stable gid so a cluster can be expanded/merged independently
    expect(gs[0].gid).toBe(gs[0].gid)
    expect(new Set(gs.map((g) => g.gid)).size).toBe(3)
  })

  it('week stats sum sessions/units/minutes', () => {
    const s = initial()
    const days = Array.from({ length: 7 }, (_, i) => isoDate(addDays(startOfWeek(new Date(), 0), i)))
    const st = weekStats(s, days)
    expect(st.sessions).toBeGreaterThan(0)
    expect(st.revenue).toBeGreaterThan(0)
  })
})

describe('domain logic', () => {
  const mk = (over = {}) => ({ id: 'n1', type: 'service', date: '2026-09-09', start: 540, end: 600, staffIds: ['s1'], clientIds: ['c1'], status: 'active', ...over })

  it('flags staff/client double-bookings, ignores gaps & cancellations', () => {
    const appts = { a: mk({ id: 'a' }), b: mk({ id: 'b', start: 555, end: 615, staffIds: ['s1'], clientIds: ['c9'] }) }
    const hits = findConflicts(appts, mk({ start: 560, end: 620 }), { s1: { name: 'Prateek Kiran' } }, {})
    expect(hits.length).toBe(2)
    expect(hits.every((h) => h.who.includes('Prateek Kiran'))).toBe(true)
    expect(findConflicts(appts, mk({ start: 615, end: 660 }), {}, {}).length).toBe(0)
    expect(findConflicts({ a: mk({ id: 'a', status: 'cancelled' }) }, mk({ start: 545, end: 550 }), {}, {}).length).toBe(0)
  })

  it('computes charges from units × rate + mileage', () => {
    expect(computeBilling({ type: 'service', billing: { units: 2, rate: 10 } })).toBe(20)
    expect(computeBilling({ type: 'drive', billing: { units: 0, rate: 0, mileage: true, distance: 10, mileageRate: 0.7 } })).toBe(7)
    expect(computeBilling({ type: 'break', billing: { units: 4, rate: 40 } })).toBe(0)
  })

  describe('recurrence workflows', () => {
    const mkSeries = () => {
      const appts = {}
      for (let i = 0; i < 5; i++) {
        const d = isoDate(addDays(parse('2026-10-05'), i * 7))
        appts['a' + i] = { id: 'a' + i, seriesId: 'S', date: d, type: 'service', start: 540, end: 660, staffIds: ['s3'], clientIds: ['c1'], status: 'active', recurrence: 'weekly' }
      }
      return appts
    }
    const parse = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d) }

    it('seriesSiblings sorted by date', () => {
      const appts = mkSeries()
      const sibs = seriesSiblings(appts, appts.a2)
      expect(sibs.map((x) => x.id)).toEqual(['a0', 'a1', 'a2', 'a3', 'a4'])
    })
  })
})

describe('date utils', () => {
  it('formats + snaps correctly', () => {
    expect(fmtTime(540)).toBe('9 AM')
    expect(fmtTime(787)).toBe('1:07 PM')
    expect(fmtTime(540, true)).toBe('09:00')
    expect(snap(547, 15)).toBe(540)
    expect(snap(548, 15)).toBe(555)
    expect(minToHM(660)).toBe('11:00')
    expect(hmToMin('05:30')).toBe(330)
    expect(fmtDur(95)).toBe('1h 35m')
  })
})

describe('cancellation time', () => {
  it('the reducer stamps cancelledAt on cancel and drops it on reinstatement, in one Undo step', () => {
    const s = initial()
    const a = Object.values(s.appts).find((x) => x.status !== 'cancelled' && x.status !== 'no-show')
    const cancelled = reducer(s, { type: 'patch', id: a.id, patch: { status: 'cancelled' } })
    expect(Number.isFinite(Date.parse(cancelled.appts[a.id].cancelledAt))).toBe(true)
    expect(reducer(cancelled, { type: 'undo' }).appts[a.id].cancelledAt).toBe(undefined)
    const back = reducer(cancelled, { type: 'upsertMany', appts: [{ ...cancelled.appts[a.id], status: 'active' }] })
    expect(back.appts[a.id].cancelledAt).toBe(undefined)
  })
})
