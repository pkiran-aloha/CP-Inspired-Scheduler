// ---- Reports trend kit: bucket a result by its date column, compare vs the prior period ----
import { addDays, isoDate, parseISO, startOfWeek } from './date'
import { runReport } from './reports'
import { bucketize } from './analytics'

const isISO = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)

/** First column whose rows carry ISO dates (what the chart will bucket on). */
export function pickDateCol(columns, rows) {
  if (!rows.length) return null
  for (const c of columns) if (rows.some((r) => isISO(r[c.k]))) return c.k
  return null
}

/** Columns with numeric content — usable as chart metrics / delta sources. */
export function numCols(columns, rows) {
  return columns.filter((c) => rows.some((r) => typeof r[c.k] === 'number'))
}

export function shiftDays(days, n) {
  return days.map((d) => isoDate(addDays(parseISO(d), -n)))
}

/** Run the same report over the immediately-preceding window of equal length. */
export function priorResult(state, sel, ctx, weekStart) {
  if (!ctx.days?.length) return null
  const days = shiftDays(ctx.days, ctx.days.length)
  try {
    return runReport(state, sel, { ...ctx, days, buckets: bucketize(days, ctx.gran, weekStart) })
  } catch {
    return null
  }
}

/** Sum every numeric column — one totals object per run, for delta chips. */
export function numericTotals(columns, rows) {
  const out = {}
  for (const c of columns) {
    const vals = rows.map((r) => r[c.k]).filter((v) => typeof v === 'number')
    if (vals.length) out[c.k] = Math.round(vals.reduce((t, v) => t + v, 0) * 100) / 100
  }
  return out
}

export function deltaPct(cur, prev) {
  if (prev == null) return null
  if (prev === 0) return cur === 0 ? 0 : 100
  return Math.round(((cur - prev) / Math.abs(prev)) * 1000) / 10
}

/**
 * Bucket rows along the window: daily spans stay day-by-day, longer windows
 * roll up to weeks. metric='rows' counts; any numeric column key sums.
 * Returns { buckets:[{key,label,count,value}], weekly, outside }.
 */
export function seriesFor({ rows, dateCol, metric = 'rows', days, weekStart = 0 }) {
  const weekly = days.length > 10
  const norm = (iso) => (weekly ? isoDate(startOfWeek(parseISO(iso), weekStart)) : iso)
  const keys = [...new Set(days.map(norm))].sort()
  const m = new Map(
    keys.map((k) => [
      k,
      {
        key: k,
        label: new Date(parseISO(k)).toLocaleDateString('en-US', weekly ? { month: 'short', day: 'numeric' } : { weekday: 'short', month: 'short', day: 'numeric' }),
        count: 0,
        value: 0,
      },
    ])
  )
  let outside = 0
  for (const r of rows) {
    const d = r[dateCol]
    if (!isISO(d)) { outside++; continue }
    const b = m.get(norm(d))
    if (!b) { outside++; continue }
    b.count++
    if (metric !== 'rows') {
      const v = r[metric]
      b.value += typeof v === 'number' ? v : 0
    }
  }
  if (metric === 'rows') for (const b of m.values()) b.value = b.count
  return { buckets: [...m.values()], weekly, outside }
}
