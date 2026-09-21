// ---- reports trend kit: bucketing, shifts, deltas ----
import { describe, it, expect } from 'vitest'
import { pickDateCol, numCols, shiftDays, deltaPct, seriesFor, numericTotals } from '../lib/rpTrends'

const cols = [
  { k: 'sev', label: 'Severity' },
  { k: 'who', label: 'Entity' },
  { k: 'date', label: 'When' },
  { k: 'units', label: 'Units', align: 'r', t: 'num' },
]
const rows = [
  { sev: 'error', who: 'A', date: '2026-09-14', units: 2 },
  { sev: 'error', who: 'B', date: '2026-09-14', units: 1 },
  { sev: 'warn', who: 'C', date: '2026-09-16', units: 4 },
  { sev: 'notice', who: 'D', date: '—', units: 0 },
]

describe('rpTrends', () => {
  it('picks the first column carrying ISO dates and the numeric ones', () => {
    expect(pickDateCol(cols, rows)).toBe('date')
    expect(numCols(cols, rows).map((c) => c.k)).toEqual(['units'])
  })
  it('shifts a window back by its own length', () => {
    expect(shiftDays(['2026-09-14', '2026-09-15'], 2)).toEqual(['2026-09-12', '2026-09-13'])
  })
  it('computes signed percent deltas with sane zero handling', () => {
    expect(deltaPct(110, 100)).toBe(10)
    expect(deltaPct(90, 100)).toBe(-10)
    expect(deltaPct(5, 0)).toBe(100)
    expect(deltaPct(0, 0)).toBe(0)
    expect(deltaPct(3, null)).toBe(null)
  })
  it('day-buckets a short window and sums the chosen metric', () => {
    const days = ['2026-09-14', '2026-09-15', '2026-09-16']
    const s = seriesFor({ rows, dateCol: 'date', metric: 'units', days })
    expect(s.weekly).toBe(false)
    expect(s.buckets.length).toBe(3)
    const [d14, d15, d16] = s.buckets
    expect(d14).toMatchObject({ count: 2, value: 3 })
    expect(d15.value).toBe(0)
    expect(d16).toMatchObject({ count: 1, value: 4 })
    expect(s.outside).toBe(1) // the '—' dated notice row is honestly flagged
  })
  it('rolls to weeks for long windows (metric rows counts)', () => {
    const days = Array.from({ length: 28 }, (_, i) => shiftDays(['2026-09-20'], 27 - i)[0]).sort()
    const long = rows.map((r) => ({ ...r, date: r.date === '—' ? r.date : '2026-09-20' }))
    const s = seriesFor({ rows: long, dateCol: 'date', metric: 'rows', days })
    expect(s.weekly).toBe(true)
    expect(s.buckets.some((b) => b.count >= 2)).toBe(true)
  })
  it('totals numeric columns for delta math', () => {
    expect(numericTotals(cols, rows)).toEqual({ units: 7 })
  })
})
