// ---- Reports visual kit: pick one primary chart per report from its data shape ----
// Pure: takes a report result ({columns, rows, summary}) and returns a chart spec the
// Reports screen draws. No React, no DOM. Every spec carries an `alt` sentence so the
// chart always has a text alternative next to the table.
import { seriesFor, pickDateCol } from './rpTrends'

const n = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const r1 = (v) => Math.round(v * 10) / 10

/** A severity word for a free-text status cell: 'stop' | 'warn' | 'flag' | 'ok' | null. */
export function statusTone(text) {
  const s = String(text ?? '').trim()
  if (!s || s === '—') return null
  if (/^error$|overdue|expired|over-?committed|over authorized|still open|denied|past stage|\d+d over/i.test(s)) return 'stop'
  if (/^warn$|due|below|under|to go|left unstaffed|fix flagged|start renewal/i.test(s)) return 'warn'
  if (/^notice$|no baseline|no caseload|not on auth|no sessions|verify|in progress/i.test(s)) return 'flag'
  if (/compliant|on track|scheduled ok|converted|target met|backfilled|on pace|^logged$|left$/i.test(s)) return 'ok'
  return null
}

/** Columns whose text reads as a status (rendered as pills in the table). */
export const STATUS_COLS = new Set(['status', 'pace', 'outcome', 'sla', 'renew'])

/** Leading number of a KPI value: 12, "$1,234", "45%", "12 h" → number; anything else → null. */
export function kpiNumber(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  const m = /^\s*\$?(-?[\d,]+(?:\.\d+)?)\s*(%|h|d)?\s*$/.exec(String(v ?? ''))
  return m ? Number(m[1].replace(/,/g, '')) : null
}

/** "Nice" axis maximum and ticks for a 0-based scale. */
export function niceScale(max, count = 4) {
  if (!(max > 0)) return { max: 1, ticks: [0, 1] }
  const raw = max / count
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw)
  const top = Math.ceil(max / step) * step
  const ticks = []
  for (let t = 0; t <= top + 1e-9; t += step) ticks.push(r1(t))
  return { max: top, ticks }
}

/** Keep the first `keep` parts by value, fold the rest into one "Other" part (never a 9th hue). */
export function foldParts(parts, keep = 4) {
  const sorted = [...parts].filter((p) => p.value > 0).sort((a, b) => b.value - a.value)
  if (sorted.length <= keep + 1) return sorted
  const rest = sorted.slice(keep)
  return [...sorted.slice(0, keep), { label: `Other (${rest.length})`, value: r1(rest.reduce((t, p) => t + p.value, 0)), other: true }]
}

/** Sum `metric` (or count when metric is null) by `keyOf(row)`, keeping first-seen order. */
export function groupSum(rows, keyOf, metric = null) {
  const m = new Map()
  for (const r of rows) {
    const k = keyOf(r)
    if (k == null || k === '') continue
    m.set(k, (m.get(k) || 0) + (metric ? n(r[metric]) || 0 : 1))
  }
  return [...m].map(([label, value]) => ({ label, value: r1(value) }))
}

export const AGING_BUCKETS = [
  { label: '0–30 days', max: 30 },
  { label: '31–60 days', max: 60 },
  { label: '61–90 days', max: 90 },
  { label: '91–120 days', max: 120 },
  { label: '120+ days', max: Infinity },
]

/**
 * Outstanding $ per A/R aging bucket. Rows need numeric `due`; a numeric `age` places
 * them in a 30-day bucket, no age (a draft) lands in a last "Not filed yet" part.
 * Rows whose `kind` says they are not a primary receivable (COB filings) are left out.
 */
export function agingBuckets(rows) {
  const out = [...AGING_BUCKETS, { label: 'Not filed yet' }].map((b) => ({ label: b.label, value: 0, count: 0 }))
  for (const r of rows) {
    const age = n(r.age)
    const due = n(r.due)
    if (!(due > 0) || (r.kind && r.kind !== 'Primary receivable')) continue
    const i = age == null ? AGING_BUCKETS.length : AGING_BUCKETS.findIndex((b) => age <= b.max)
    out[i].value = Math.round((out[i].value + due) * 100) / 100
    out[i].count++
  }
  return out
}

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
/** Weekday × start-hour grid of session counts from rows with ISO `date` and "HH:MM" `time`. */
export function heatGrid(rows, dateKey = 'date', timeKey = 'time') {
  const cells = new Map()
  let lo = 24
  let hi = -1
  const days = new Set()
  for (const r of rows) {
    const d = r[dateKey]
    const t = /^(\d{1,2}):/.exec(String(r[timeKey] ?? ''))
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(d)) || !t) continue
    const [y, mo, da] = d.split('-').map(Number)
    const dow = new Date(y, mo - 1, da).getDay()
    const h = Number(t[1])
    lo = Math.min(lo, h)
    hi = Math.max(hi, h)
    days.add(dow)
    cells.set(`${dow}|${h}`, (cells.get(`${dow}|${h}`) || 0) + 1)
  }
  if (hi < 0) return { rows: [], hours: [], max: 0 }
  const hours = []
  for (let h = lo; h <= hi; h++) hours.push(h)
  const order = [1, 2, 3, 4, 5, 6, 0].filter((d) => days.has(d))
  const grid = order.map((d) => ({ label: DOW[d], cells: hours.map((h) => cells.get(`${d}|${h}`) || 0) }))
  return { rows: grid, hours, max: Math.max(0, ...grid.flatMap((g) => g.cells)) }
}

/** 0–4 intensity step for a heat value (0 stays empty). */
export const heatStep = (v, max) => (!(v > 0) || !(max > 0) ? 0 : Math.min(4, Math.ceil((v / max) * 4)))

/** SVG polyline points for a sparkline; null when there is nothing to draw. */
export function sparkPoints(values, w = 64, h = 20, pad = 2) {
  const vals = values.filter((v) => n(v) != null)
  if (vals.length < 2 || vals.length !== values.length) return null
  const lo = Math.min(...vals)
  const hi = Math.max(...vals)
  if (lo === hi) return null // a flat line says nothing a number does not
  const step = (w - pad * 2) / (vals.length - 1)
  return vals.map((v, i) => `${r1(pad + i * step)},${r1(h - pad - ((v - lo) / (hi - lo)) * (h - pad * 2))}`).join(' ')
}

const TOP = 12
const bars = (items, opts) => {
  const all = items.filter((it) => n(it.value) != null)
  return { kind: 'bars', ...opts, items: all.slice(0, TOP), total: all.length }
}
const stack = (parts, opts) => ({ kind: 'stack', ...opts, parts: parts.filter((p) => p.value > 0) })
const tonedParts = (rows, key, metric = null, norm = (s) => s) =>
  groupSum(rows, (r) => norm(String(r[key] ?? '')), metric).map((p) => ({ ...p, tone: statusTone(p.label) || 'flag' }))

/**
 * The one primary visual for a report. Returns null when the report has no visual
 * (or no data to draw). ctx = { days, weekStart } for time-bucketed reports.
 */
export function vizFor(id, result, ctx = {}) {
  const rows = result?.rows || []
  if (!rows.length) return null
  const spec = SPECS[id]?.(rows, ctx)
  if (!spec) return null
  const empty = spec.kind === 'stack' ? !spec.parts.length : spec.kind === 'bars' ? !spec.items.length : spec.kind === 'columns' ? !spec.buckets.some((b) => b.total > 0) : spec.kind === 'heat' ? !spec.rows.length : false
  return empty ? null : spec
}

const SPECS = {
  attendance: (rows) => {
    const g = heatGrid(rows)
    return { kind: 'heat', title: 'Sessions by weekday and start hour', unit: 'sessions', ...g, alt: `Heatmap of ${rows.length} sessions by weekday and start hour; the busiest cell has ${g.max}.` }
  },
  utilization: (rows) => bars(rows.map((r) => ({ label: r.staff, value: r.utilPct, target: 100 })), { title: 'Utilization against each person’s target', t: 'pct', targetLabel: 'Target 100%', alt: 'Bars of booked hours as a percent of each person’s target week; the marker is 100%.' }),
  cover: (rows) => stack(tonedParts(rows, 'outcome', null, (s) => (s.startsWith('Backfilled') ? 'Backfilled' : s)), { title: 'What happened to cancelled sessions', t: 'num', alt: 'Share of cancelled sessions by outcome.' }),
  cancelReasons: (rows) => bars(rows.map((r) => ({ label: r.reason, value: r.sessions, note: r.side })), { title: 'Cancelled or missed sessions by reason', t: 'num', alt: 'Bars of cancelled or missed sessions per recorded reason.' }),
  gaps: (rows) => bars(groupSum(rows, (r) => r.staff, 'freeH').sort((a, b) => b.value - a.value), { title: 'Open hours per person', t: 'hrs', alt: 'Bars of open, unbooked hours per staff member across the window.' }),
  auth: (rows) => bars(rows.map((r) => ({ label: r.client, value: r.burnPct, target: 100, tone: statusTone(r.pace) })), { title: 'Authorization burn by client', t: 'pct', targetLabel: 'Authorized 100%', alt: 'Bars of delivered hours as a percent of authorized hours per client; the marker is 100%.' }),
  authUtil: (rows) => bars(rows.filter((r) => n(r.usedPct) != null).map((r) => ({ label: `${r.client} · ${r.code}`, value: r.usedPct, target: n(r.expectedPct), tone: statusTone(r.status) })), { title: 'Units used against where the window should be', t: 'pct', targetLabel: 'Expected by today', alt: 'Bars of authorized units used per client and code; each marker shows how far through its window the authorization is.' }),
  reassess: (rows) => stack(tonedParts(rows, 'status'), { title: 'Re-assessment status', t: 'num', alt: 'Share of clients by re-assessment status.' }),
  supervision: (rows) => stack(tonedParts(rows, 'status'), { title: 'Supervision status', t: 'num', alt: 'Share of technicians by supervision status.' }),
  credentials: (rows) => stack(tonedParts(rows, 'status', null, (s) => (/to go$/.test(s) ? 'Hours to go' : s)), { title: 'Credential status', t: 'num', alt: 'Share of clinicians by credential status.' }),
  documentation: (rows) => bars(rows.map((r) => ({ label: r.staff, value: r.verifiedPct, target: 100 })), { title: 'Completed sessions verified, per person', t: 'pct', targetLabel: 'All verified', alt: 'Bars of the percent of completed sessions verified per staff member.' }),
  claimready: (rows, ctx) => columns(rows, ctx, 'charge', 'Claim-ready charges by date of service'),
  blocked: (rows) => stack(groupSum(rows, (r) => (String(r.fix).startsWith('Auto') ? 'Missing units (auto-fill)' : /verify/i.test(r.fix) ? 'Needs verification' : 'Rate missing'), 'estCharge').map((p) => ({ ...p, tone: /verif/i.test(p.label) ? 'warn' : 'stop' })), { title: 'Value held back, by fix', t: 'money', alt: 'Share of blocked claim value by the fix it needs.' }),
  revenueCode: (rows) => {
    const codes = foldParts(groupSum(rows, (r) => r.code, 'charge'), 3)
    const keep = new Set(codes.filter((c) => !c.other).map((c) => c.label))
    const keys = codes.map((c) => c.label)
    const otherKey = codes.find((c) => c.other)?.label
    const order = [...new Set(rows.map((r) => r.bucket))]
    const buckets = order.map((label) => {
      const segs = Object.fromEntries(keys.map((k) => [k, 0]))
      for (const r of rows) if (r.bucket === label) segs[keep.has(r.code) ? r.code : otherKey] += n(r.charge) || 0
      return { label, segs: keys.map((k) => ({ key: k, value: Math.round(segs[k]) })), total: Math.round(Object.values(segs).reduce((t, v) => t + v, 0)) }
    })
    return { kind: 'columns', title: 'Revenue by period, split by code', t: 'money', keys, buckets, alt: `Stacked columns of revenue per period for ${keys.join(', ')}.` }
  },
  claims: (rows) => {
    const parts = agingBuckets(rows).map((b, i) => (i < AGING_BUCKETS.length ? { ...b, seq: i + 1 } : { ...b, other: true }))
    return { kind: 'stack', title: 'Outstanding by days since filing', t: 'money', ordinal: true, parts: parts.filter((p) => p.value > 0), alt: 'Outstanding primary claim balance split into 30-day aging buckets, with drafts not yet filed shown last.' }
  },
  payer: (rows) => stack(foldParts(rows.map((r) => ({ label: r.payer, value: r.charge }))), { title: 'Charges by payer', t: 'money', alt: 'Share of charges by payer; small payers fold into Other.' }),
  payroll: (rows) => ({
    kind: 'bars', title: 'Hours by category, per person', t: 'hrs', keys: ['Session', 'Supervision', 'Drive'], total: rows.filter((r) => r.hours > 0).length,
    items: rows.filter((r) => r.hours > 0).slice(0, TOP).map((r) => ({ label: r.staff, value: r.hours, segs: [r.sessH, r.supH, r.driveH] })),
    alt: 'Stacked bars of session, supervision and drive hours per staff member.',
  }),
  abahours: (rows) => bars(rows.map((r) => ({ label: r.staff, value: r.hours, target: n(r.target) })), { title: 'Behavior-analytic hours per person', t: 'hrs', targetLabel: 'Practice target', alt: 'Bars of behavior-analytic hours per person; a marker shows the practice target where one is set.' }),
  quality: (rows) => stack(['error', 'warn', 'notice'].map((s) => ({ label: s === 'error' ? 'Errors' : s === 'warn' ? 'Warnings' : 'Notices', value: rows.filter((r) => r.sev === s).length, tone: s === 'error' ? 'stop' : s === 'warn' ? 'warn' : 'flag' })), { title: 'Open validations by severity', t: 'num', alt: 'Share of open validations by severity.' }),
  intake: (rows) => bars(groupSum(rows, (r) => r.stage), { title: 'Requests by stage', t: 'num', alt: 'Bars of intake requests per pipeline stage.' }),
}

function columns(rows, ctx, metric, title) {
  const dateCol = pickDateCol([{ k: 'date' }], rows)
  if (!dateCol || !ctx.days?.length) return null
  const s = seriesFor({ rows, dateCol, metric, days: ctx.days, weekStart: ctx.weekStart || 0 })
  const buckets = s.buckets.map((b) => ({ label: b.label, segs: [{ key: 'value', value: Math.round(b.value) }], total: Math.round(b.value) }))
  return { kind: 'columns', title: `${title}${s.weekly ? ' (weekly)' : ''}`, t: 'money', keys: null, buckets, alt: `Columns of ${title.toLowerCase()} across the window, ${s.weekly ? 'week' : 'day'} by ${s.weekly ? 'week' : 'day'}.` }
}

/** Which kind of visual each report draws — for catalogue glyphs. */
export const VIZ_KIND = {
  attendance: 'heat', utilization: 'bars', cover: 'stack', cancelReasons: 'bars', gaps: 'bars', auth: 'bars', authUtil: 'bars',
  reassess: 'stack', supervision: 'stack', credentials: 'stack', documentation: 'bars', claimready: 'columns', blocked: 'stack',
  revenueCode: 'columns', claims: 'stack', payer: 'stack', payroll: 'bars', abahours: 'bars', quality: 'stack', intake: 'bars',
}
