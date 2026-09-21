import { parseISO } from './date'

/**
 * Dashboard widget engine — pure, store-agnostic analytics.
 * Every widget asks for its data with (appts, roster, filter, cfg);
 * nothing here renders or reads React state, so all of it unit-tests.
 */

export const DASH_METRICS = {
  sessions: { label: 'Sessions', money: false },
  hours: { label: 'Client hours', money: false },
  units: { label: 'Billable units', money: false },
  revenue: { label: 'Charge $', money: true },
}
export const DASH_DIMS = { staff: 'Staff member', client: 'Client', program: 'Program', payer: 'Payer / insurer' }
export const DONUT_COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ec4899', '#0ea5e9', '#8b5cf6', '#14b8a6', '#ef4444', '#a855f7', '#64748b']

const LIVE = { active: 1, confirmed: 1, completed: 1, 'no-show': 1 } // everything except cancelled counts as scheduled
const DELIVERED = { completed: 1 }

/** Apply the dashboard-wide (or widget) filter: { staff, client, program, payer, type, status } */
export function apptsFiltered(appts, filter = {}, clientById = {}, dimNames = null) {
  const out = []
  for (const a of Object.values(appts)) {
    if (!LIVE[a.status]) continue
    if (filter.type && a.type !== filter.type) continue
    if (filter.status && a.status !== filter.status) continue
    if (filter.staff && !(a.staffIds || []).includes(filter.staff)) continue
    if (filter.client && !(a.clientIds || []).includes(filter.client)) continue
    if (filter.program || filter.payer) {
      const ok = (a.clientIds || []).some((cid) => {
        const c = clientById[cid]
        if (!c) return false
        if (filter.program && c.program !== filter.program) return false
        if (filter.payer && (c.insurer || '—') !== filter.payer) return false
        return true
      })
      if (!ok) continue
    }
    out.push(a)
  }
  return out
}

/** The contribution of ONE appointment to a metric (cancelled never counts). */
export function unitVal(a, metric) {
  if (!LIVE[a.status]) return 0
  if (metric === 'sessions') return 1
  if (!DELIVERED[a.status]) return 0
  if (metric === 'hours') return (a.end - a.start) / 60
  if (metric === 'units') return Number(a.billing?.units) || 0
  return (Number(a.billing?.units) || 0) * (Number(a.billing?.rate) || 0)
}

export function sumMetric(list, metric) {
  let v = 0
  for (const a of list) v += unitVal(a, metric)
  if (metric === 'sessions') return v
  if (metric === 'hours') return Math.round(v * 10) / 10
  if (metric === 'units') return Math.round(v * 100) / 100
  return Math.round(v)
}

export function trendSeries(appts, days, buckets, metric, filter, clientById) {
  const rows = apptsFiltered(appts, filter, clientById)
  return buckets.map((b) => {
    const set = new Set(b.days)
    return { key: b.key, label: b.label, value: sumMetric(rows.filter((a) => set.has(a.date)), metric), count: b.days.length }
  })
}

export function topBreakdown(appts, days, { dim, metric, top = 8 }, clients, staff, filter) {
  const set = new Set(days)
  const rows = apptsFiltered(appts, filter, clients).filter((a) => set.has(a.date))
  const byKey = new Map()
  const add = (k, label, w, v) => {
    if (!k || !v) return
    const r = byKey.get(k) || { key: k, label, value: 0 }
    r.value += v * w
    byKey.set(k, r)
  }
  for (const a of rows) {
    const v = unitVal(a, metric)
    if (!v) continue
    if (dim === 'staff') {
      const ids = a.staffIds || []
      ids.forEach((id) => add(id, staff[id]?.name || id, 1 / Math.max(1, ids.length), v))
    } else if (dim === 'client') {
      const ids = a.clientIds || []
      ids.forEach((id) => add(id, clients[id]?.name || id, 1 / Math.max(1, ids.length), v))
    } else {
      const ids = a.clientIds || []
      const cnt = {}
      for (const id of ids) {
        const c = clients[id]
        const k = dim === 'program' ? c?.program : c ? c.insurer || '—' : null
        if (k) cnt[k] = (cnt[k] || 0) + 1
      }
      for (const [k, n] of Object.entries(cnt)) add(k, k, n / Math.max(1, ids.length), v)
    }
  }
  const out = [...byKey.values()].map((r) => ({
    key: r.key,
    label: r.label,
    value: metric === 'sessions' ? Math.round(r.value * 10) / 10 : metric === 'revenue' ? Math.round(r.value) : Math.round(r.value * 10) / 10,
  }))
  const max = Math.max(...out.map((r) => r.value), 0)
  return out
    .sort((a, b) => b.value - a.value)
    .slice(0, top)
    .map((r) => ({ ...r, pct: max ? Math.max(4, Math.round((r.value / max) * 100)) : 0 }))
}

export function mixOf(appts, days, { field = 'type' }, filter) {
  const set = new Set(days)
  const rows = apptsFiltered(appts, filter).filter((a) => set.has(a.date))
  const by = new Map()
  for (const a of rows) {
    const k = field === 'type' ? a.type : a.status
    by.set(k, (by.get(k) || 0) + 1)
  }
  const total = rows.length || 1
  const labels = { service: 'Service', evaluation: 'Evaluation', supervision: 'Supervision', drive: 'Drive time', break: 'Break', unavailable: 'Blocked', team: 'Team', active: 'Active', confirmed: 'Confirmed', completed: 'Completed', 'no-show': 'No-show', cancelled: 'Cancelled' }
  let acc = 0
  return [...by.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([k, v], i) => {
      const frac = v / total
      const seg = { key: k, label: labels[k] || k, value: v, pct: Math.round(frac * 100), color: DONUT_COLORS[i % DONUT_COLORS.length], start: acc }
      acc += frac
      return seg
    })
}

/** Weekday × hour minutes grid, honoring the shared filter. */
export function heatGrid(appts, days, filter, workday = [8, 18]) {
  const set = new Set(days)
  const rows = apptsFiltered(appts, filter).filter((a) => set.has(a.date))
  const H = workday[1] - workday[0]
  const grid = Array.from({ length: 7 }, () => Array.from({ length: H }, () => ({ count: 0, minutes: 0 })))
  const datesByDow = Array.from({ length: 7 }, () => null)
  for (const a of rows) {
    if (a.type !== 'service' && a.type !== 'evaluation') continue
    const dow = parseISO(a.date).getDay()
    if (!datesByDow[dow]) datesByDow[dow] = a.date
    for (let h = workday[0]; h < workday[1]; h++) {
      const ov = Math.min(a.end / 60, h + 1) - Math.max(a.start / 60, h)
      if (ov > 0) {
        grid[dow][h - workday[0]].count++
        grid[dow][h - workday[0]].minutes += Math.round(ov * 60)
      }
    }
  }
  const max = Math.max(1, ...grid.flat().map((c) => c.minutes))
  return { grid, hourStart: workday[0], hourSpan: H, max, firstDateByDow: datesByDow }
}

/** Four pulse KPIs with honest prior-window deltas. */
export function pulseKpis(appts, days, prior, filter, clients) {
  const cur = new Set(days), prev = new Set(prior)
  const A = Object.values(appts)
  const slice = (dset, f) => A.filter((a) => dset.has(a.date) && LIVE[a.status] && (!f || Object.entries(f).every(([k, v]) => {
    if (k === 'staff') return (a.staffIds || []).includes(v)
    if (k === 'client') return (a.clientIds || []).includes(v)
    if (k === 'type') return a.type === v
    if (k === 'status') return a.status === v
    if (k === 'program' || k === 'payer') return (a.clientIds || []).some((cid) => {
      const c = clients[cid]
      return c && (k === 'program' ? c.program === v : (c.insurer || '—') === v)
    })
    return true
  })))
  const live = slice(cur, filter)
  const livePrev = slice(prev, filter)
  const d = (c, p) => (p ? Math.round(((c - p) / Math.abs(p)) * 100) : c ? 100 : 0)
  const att = (list) => {
    const done = list.filter((a) => a.status === 'completed').length
    const miss = list.filter((a) => a.status === 'no-show').length
    return done + miss ? Math.round((done / (done + miss)) * 100) : 100
  }
  return [
    { k: 'sessions', label: 'Sessions', value: live.length, delta: d(live.length, livePrev.length), badRising: false },
    { k: 'revenue', label: 'Charge', value: sumMetric(live, 'revenue'), fmt: 'money', delta: d(sumMetric(live, 'revenue'), sumMetric(livePrev, 'revenue')), badRising: false },
    { k: 'attendance', label: 'Attendance', value: att(live), fmt: 'pct', delta: d(att(live), att(livePrev)), badRising: false, invert: true },
    { k: 'noshow', label: 'No-shows', value: live.filter((a) => a.status === 'no-show').length, delta: d(live.filter((a) => a.status === 'no-show').length, livePrev.filter((a) => a.status === 'no-show').length), badRising: true },
  ]
}

/* ---------------- widget registry ---------------- */

export const WIDGETS = {
  kpis: { name: 'Practice Pulse', icon: 'checkCircle', blurb: 'Sessions, charge, attendance & no-shows with period deltas', span: 6, defaultCfg: {} },
  trend: { name: 'Volume Trend', icon: 'spark', blurb: 'Any metric bucketed by day, week or month', span: 4, defaultCfg: { metric: 'sessions', bucket: 'auto' } },
  donut: { name: 'Mix', icon: 'pie', blurb: 'Appointment type or status share — click a slice to filter everything', span: 2, defaultCfg: { field: 'type' } },
  bars: { name: 'Top Breakdown', icon: 'rows', blurb: 'Leaders by staff, client, program or payer', span: 3, defaultCfg: { dim: 'staff', metric: 'revenue', top: 8 } },
  ledger: { name: 'Appointment Ledger', icon: 'clipboard', blurb: 'The filtered appointments themselves — convention titles, crew, overlap flags, one click into the record', span: 3, defaultCfg: { rows: 12, order: 'asc' } },
  heat: { name: 'Week Heatmap', icon: 'table', blurb: 'Delivered minutes per weekday × hour — click a cell to jump', span: 3, defaultCfg: {} },
}

export const DEFAULT_DASH = [
  { id: 'w-pulse', type: 'kpis', cfg: {}, span: 6 },
  { id: 'w-trend', type: 'trend', cfg: { ...WIDGETS.trend.defaultCfg }, span: 4 },
  { id: 'w-mix', type: 'donut', cfg: { ...WIDGETS.donut.defaultCfg }, span: 2 },
  { id: 'w-bars', type: 'bars', cfg: { ...WIDGETS.bars.defaultCfg }, span: 3 },
  { id: 'w-heat', type: 'heat', cfg: {}, span: 3 },
]

export const FILTER_KEYS = { staff: 'Staff', client: 'Client', program: 'Program', payer: 'Payer', type: 'Type', status: 'Status' }

export const fmtNum = (v, money, pct) => (pct ? `${v}%` : money ? (Math.abs(v) >= 10000 ? `$${(v / 1000).toFixed(1)}k` : `$${v.toLocaleString()}`) : Number.isInteger(v) ? v.toLocaleString() : `${Math.round(v * 10) / 10}`)

/* ids of appointments that overlap another row (same day, shared staff) — drawer conflict awareness */
export function flagOverlaps(rows) {
  const byDay = new Map()
  for (const a of rows) { if (!byDay.has(a.date)) byDay.set(a.date, []); byDay.get(a.date).push(a) }
  const out = new Set()
  for (const list of byDay.values()) {
    const sorted = [...list].sort((x, y) => (x.start || 0) - (y.start || 0))
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        if ((sorted[j].start || 0) >= (sorted[i].end || 0)) break
        if ((sorted[i].staffIds || []).some((id) => (sorted[j].staffIds || []).includes(id))) { out.add(sorted[i].id); out.add(sorted[j].id) }
      }
    }
  }
  return out
}
