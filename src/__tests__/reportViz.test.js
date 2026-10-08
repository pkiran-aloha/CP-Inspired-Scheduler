// ---- reports visual kit: chart choice per report, scales, buckets, sparklines ----
import { describe, it, expect } from 'vitest'
import { vizFor, VIZ_KIND, statusTone, kpiNumber, niceScale, foldParts, groupSum, agingBuckets, heatGrid, heatStep, sparkPoints } from '../lib/reportViz'
import { priorResults } from '../lib/rpTrends'
import { REPORTS, runReport } from '../lib/reports'
import { blankState } from '../state/store'
import { bucketize } from '../lib/analytics'
import { addDays, isoDate, parseISO, todayISO } from '../lib/date'

const SEED = blankState()
const days = Array.from({ length: 28 }, (_, i) => isoDate(addDays(parseISO(todayISO()), i - 27)))
const ctx = { days, gran: 'auto', buckets: bucketize(days, 'auto', 0), scope: {} }

describe('reportViz', () => {
  it('every report has a chart kind, and each spec has the shape and a text alternative', () => {
    for (const def of REPORTS) {
      expect(VIZ_KIND[def.id]).toBeTruthy()
      const spec = vizFor(def.id, runReport(SEED, def.id, ctx), { days, weekStart: 0 })
      if (!spec) continue // nothing to draw in this window is allowed
      expect(spec.kind).toBe(VIZ_KIND[def.id])
      expect(spec.title).toBeTruthy()
      expect(spec.alt.length).toBeGreaterThan(20)
    }
  })

  it('returns no chart for an empty result or an unknown report', () => {
    expect(vizFor('quality', { columns: [], rows: [] })).toBeNull()
    expect(vizFor('nope', { columns: [], rows: [{ a: 1 }] })).toBeNull()
  })

  it('bullet bars keep a target and cap the list; stacks fold small parts into Other', () => {
    const rows = Array.from({ length: 15 }, (_, i) => ({ staff: `S${i}`, utilPct: 100 - i }))
    const spec = vizFor('utilization', { rows })
    expect(spec.items).toHaveLength(12)
    expect(spec.total).toBe(15)
    expect(spec.items[0]).toMatchObject({ label: 'S0', value: 100, target: 100 })
    const payer = vizFor('payer', { rows: [10, 9, 8, 7, 6, 5].map((v, i) => ({ payer: `P${i}`, charge: v })) })
    expect(payer.parts.map((p) => p.label)).toEqual(['P0', 'P1', 'P2', 'P3', 'Other (2)'])
    expect(payer.parts[4].value).toBe(11)
  })

  it('maps free-text statuses to severity tones', () => {
    expect(statusTone('OVERDUE')).toBe('stop')
    expect(statusTone('Over-committed')).toBe('stop')
    expect(statusTone('3d over')).toBe('stop')
    expect(statusTone('Due soon')).toBe('warn')
    expect(statusTone('Under-utilized')).toBe('warn')
    expect(statusTone('No baseline on file')).toBe('flag')
    expect(statusTone('Compliant')).toBe('ok')
    expect(statusTone('4d left')).toBe('ok')
    expect(statusTone('')).toBeNull()
    expect(statusTone('submitted')).toBeNull()
  })

  it('reads the number out of a KPI value', () => {
    expect(kpiNumber(12)).toBe(12)
    expect(kpiNumber('$1,234')).toBe(1234)
    expect(kpiNumber('45%')).toBe(45)
    expect(kpiNumber('12 h')).toBe(12)
    expect(kpiNumber('3 / 2')).toBeNull()
    expect(kpiNumber('not enough data')).toBeNull()
  })

  it('niceScale rounds up to a readable top with even ticks', () => {
    expect(niceScale(87)).toEqual({ max: 100, ticks: [0, 25, 50, 75, 100] })
    expect(niceScale(0)).toEqual({ max: 1, ticks: [0, 1] })
    expect(niceScale(1234).max).toBeGreaterThanOrEqual(1234)
  })

  it('groups, folds and buckets', () => {
    expect(groupSum([{ k: 'a', v: 1 }, { k: 'b', v: 2 }, { k: 'a', v: 3 }], (r) => r.k, 'v')).toEqual([{ label: 'a', value: 4 }, { label: 'b', value: 2 }])
    expect(foldParts([{ label: 'x', value: 0 }, { label: 'y', value: 2 }])).toEqual([{ label: 'y', value: 2 }])
    const aging = agingBuckets([{ age: 10, due: 100 }, { age: 45, due: 50 }, { age: 200, due: 25 }, { age: 5, due: 0 }, { age: null, due: 9 }, { age: 3, due: 70, kind: 'COB filing (not A/R)' }])
    expect(aging.map((b) => b.value)).toEqual([100, 50, 0, 0, 25, 9])
    expect(aging[5].label).toBe('Not filed yet')
    expect(aging[0].count).toBe(1)
  })

  it('builds a weekday by hour grid Monday-first and steps intensity', () => {
    // 2026-10-05 is a Monday, 2026-10-04 a Sunday — fixed dates, the grid only reads weekday
    const g = heatGrid([{ date: '2026-10-05', time: '09:00' }, { date: '2026-10-05', time: '09:30' }, { date: '2026-10-04', time: '11:00' }, { date: '—', time: '10:00' }])
    expect(g.rows.map((r) => r.label)).toEqual(['Mon', 'Sun'])
    expect(g.hours).toEqual([9, 10, 11])
    expect(g.rows[0].cells).toEqual([2, 0, 0])
    expect(g.max).toBe(2)
    expect([heatStep(0, 2), heatStep(1, 2), heatStep(2, 2)]).toEqual([0, 2, 4])
  })

  it('sparkPoints draws only a moving, complete series', () => {
    expect(sparkPoints([1, 2, 3], 64, 20)).toBe('2,18 32,10 62,2')
    expect(sparkPoints([5, 5, 5])).toBeNull()
    expect(sparkPoints([1, null, 3])).toBeNull()
    expect(sparkPoints([1])).toBeNull()
  })

  it('priorResults runs the report over the windows before this one, oldest first', () => {
    const hist = priorResults(SEED, 'attendance', ctx, 0, 3)
    expect(hist).toHaveLength(3)
    const lastDay = (r) => r.rows.map((x) => x.date).sort().pop()
    const before = days[0]
    for (const r of hist) if (r.rows.length) expect(lastDay(r) < before).toBe(true)
    expect(priorResults(SEED, 'attendance', { ...ctx, days: [] }, 0)).toEqual([])
  })
})
