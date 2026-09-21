// ---- Week/range analytics: KPIs, per-staff workload, mix breakdowns ----
import { TYPES, overlapsType, computeBilling } from './model'
import { scanNeedsCover } from './smart'

/**
 * Everything the Analytics view + sidebar need, computed from `state` over `days`.
 * Pure & deterministic — no React, easy to unit-test.
 */
export function weekAnalytics(state, days) {
  const set = new Set(days)
  const list = Object.values(state.appts).filter((a) => set.has(a.date))

  let sessions = 0
  let units = 0
  let revenue = 0
  let mileage = 0
  let cancelled = 0
  let noShow = 0
  let bookedMin = 0
  const byDay = days.map((d) => ({ date: d, count: 0, minutes: 0 }))
  const dayIdx = Object.fromEntries(days.map((d, i) => [d, i]))
  const byType = {}
  const staffAgg = {}
  const codeMix = {}

  for (const a of list) {
    byType[a.type] = (byType[a.type] || 0) + 1
    if (a.status === 'cancelled') {
      cancelled++
      continue
    }
    if (a.status === 'no-show') noShow++
    const clinical = a.type === 'service' || a.type === 'evaluation'
    if (clinical) {
      sessions++
      bookedMin += a.end - a.start
      const i = dayIdx[a.date]
      if (i != null) {
        byDay[i].count++
        byDay[i].minutes += a.end - a.start
      }
    }
    if (TYPES[a.type]?.billable && a.billing) {
      const charge = computeBilling(a)
      revenue += charge
      units += Number(a.billing.units) || 0
      if (a.billing.mileage) mileage += (Number(a.billing.distance) || 0) * (Number(a.billing.mileageRate ?? 0.7))
      const key = a.billing.code || 'other'
      codeMix[key] = (codeMix[key] || 0) + charge
    }
    if (overlapsType(a) && a.status !== 'cancelled') {
      for (const s of a.staffIds || []) {
        const g = (staffAgg[s] = staffAgg[s] || { sessions: 0, minutes: 0, units: 0, revenue: 0 })
        if (clinical) {
          g.sessions++
          g.minutes += a.end - a.start
        }
        if (TYPES[a.type]?.billable && a.billing) {
          g.units += Number(a.billing.units) || 0
          g.revenue += computeBilling(a) / Math.max(1, (a.staffIds || []).length)
        }
      }
    }
  }

  const wd = state.settings?.workday || [8, 18]
  const capacityMin = Math.max(1, state.staff.length * days.length * (wd[1] - wd[0]) * 60)
  const bookedAll = list
    .filter((a) => a.status !== 'cancelled' && overlapsType(a))
    .reduce((t, a) => t + (a.end - a.start) * Math.max(1, (a.staffIds || []).length), 0)

  const staffRows = state.staff
    .map((s) => ({ staff: s, ...(staffAgg[s.id] || { sessions: 0, minutes: 0, units: 0, revenue: 0 }) }))
    .sort((a, b) => b.revenue - a.revenue || b.sessions - a.sessions)
    .map((r) => ({ ...r, util: Math.min(100, Math.round((r.minutes / Math.max(1, days.length * (wd[1] - wd[0]) * 60)) * 100)) }))

  const cover = scanNeedsCover(state, days)

  return {
    sessions,
    units: Math.round(units),
    revenue: Math.round(revenue * 100) / 100,
    mileage: Math.round(mileage * 100) / 100,
    cancelled,
    noShow,
    cancelRate: list.length ? Math.round((cancelled / list.length) * 100) : 0,
    utilization: Math.min(100, Math.round((bookedAll / capacityMin) * 100)),
    bookedMin,
    byDay,
    byType,
    staffRows,
    codeMix: Object.entries(codeMix)
      .sort((a, b) => b[1] - a[1])
      .map(([code, charge]) => ({ code, charge: Math.round(charge * 100) / 100 })),
    needsCover: cover.length,
  }
}

export const fmtK = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${Math.round(n)}`)

// ================= v2 — buckets, metric registry, pivots, heat, deltas =================
// Shared by the Analytics page AND the Reports engine so both read identical numbers.

import { addDays, daysInMonth, isoDate, parseISO, startOfWeek, todayISO } from './date'
import { STATUSES, BILL_CODES, SERVICES } from './model'

const rawIn = (state, days) => {
  const set = new Set(days)
  return Object.values(state.appts).filter((a) => set.has(a.date))
}

export function autoGran(days) {
  if (days.length <= 14) return 'day'
  if (days.length <= 84) return 'week'
  if (days.length <= 380) return 'month'
  return 'quarter'
}

/** Slice a day-list into ordered buckets (day / week / month / quarter). */
export function bucketize(days, gran = 'auto', weekStart = 0) {
  const g = gran === 'auto' ? autoGran(days) : gran
  const map = new Map()
  for (const d of days) {
    const dt = parseISO(d)
    let key, label
    if (g === 'day') {
      key = d
      label = `${['S', 'M', 'T', 'W', 'T', 'F', 'S'][dt.getDay()]} ${pad2(dt.getMonth() + 1)}/${pad2(dt.getDate())}`
    } else if (g === 'week') {
      key = isoDate(startOfWeek(dt, weekStart))
      label = `${pad2(dt.getMonth() + 1)}/${pad2(dt.getDate())}`
    } else if (g === 'month') {
      key = `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}`
      label = `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][dt.getMonth()]} ${String(dt.getFullYear()).slice(2)}`
    } else {
      key = `${dt.getFullYear()}-Q${Math.floor(dt.getMonth() / 3) + 1}`
      label = `Q${Math.floor(dt.getMonth() / 3) + 1} '${String(dt.getFullYear()).slice(2)}`
    }
    if (!map.has(key)) map.set(key, { key, label, days: [] })
    map.get(key).days.push(d)
  }
  const out = [...map.values()]
  for (const b of out) {
    b.start = b.days[0]
    b.end = b.days[b.days.length - 1]
  }
  return out
}
const pad2 = (n) => String(n).padStart(2, '0')

/** One fat metrics object for a day-list — the single source of truth for KPIs & reports. */
export function rangeMetrics(state, days) {
  const list = rawIn(state, days)
  const m = {
    appts: list.length, sessions: 0, evals: 0, supervision: 0, drives: 0, breaks: 0, unavailable: 0,
    clinicalMin: 0, bookedMin: 0, units: 0, revenue: 0, mileage: 0, driveMiles: 0,
    completed: 0, cancelled: 0, noShow: 0, active: 0, confirmed: 0,
    verified: 0, unverified: 0, clients: new Set(), staffBusyMin: 0,
  }
  const cover = scanNeedsCover(state, days)
  for (const a of list) {
    m[a.type] = (m[a.type] || 0) + 1
    if (a.status === 'cancelled') {
      m.cancelled++
      continue
    }
    if (a.status === 'no-show') m.noShow++
    if (a.status === 'completed') m.completed++
    if (a.status === 'active') m.active++
    if (a.status === 'confirmed') {
      m.confirmed++
    }
    for (const c of a.clientIds || []) m.clients.add(c)
    if (a.type === 'service' || a.type === 'evaluation') {
      m.sessions++
      m.clinicalMin += a.end - a.start
    }
    if (overlapsType(a)) m.bookedMin += (a.end - a.start) * Math.max(1, (a.staffIds || []).length)
    if (a.type === 'drive' && a.billing?.mileage) m.driveMiles += Number(a.billing.distance) || 0
    if (TYPES[a.type]?.billable && a.billing) {
      const charge = computeBilling(a)
      m.revenue += charge
      m.units += Number(a.billing.units) || 0
      if (a.billing.mileage) m.mileage += (Number(a.billing.distance) || 0) * (Number(a.billing.mileageRate ?? 0.7))
      if (a.status === 'completed') {
        if (a.verification?.verifyStatus === 'verified') m.verified++
        else m.unverified++
      }
    }
  }
  const wd = state.settings?.workday || [8, 18]
  const capacityMin = Math.max(1, state.staff.length * days.length * (wd[1] - wd[0]) * 60)
  return {
    ...m,
    clients: m.clients.size,
    hours: Math.round((m.clinicalMin / 60) * 10) / 10,
    revenue: Math.round(m.revenue * 100) / 100,
    mileage: Math.round(m.mileage * 100) / 100,
    units: Math.round(m.units * 4) / 4,
    utilization: Math.min(100, Math.round((m.bookedMin / capacityMin) * 100)),
    cancelRate: list.length ? Math.round((m.cancelled / list.length) * 100) : 0,
    noShowRate: m.sessions ? Math.round((m.noShow / (m.sessions + m.cancelled + 1e-9)) * 1000) / 10 : 0,
    verifiedPct: m.completed ? Math.round((m.verified / Math.max(1, m.verified + m.unverified)) * 100) : 100,
    avgPerSession: m.sessions ? Math.round(m.revenue / m.sessions) : 0,
    needsCover: cover.length,
  }
}

/** Metric registry — the Analytics toolbar, sparklines, CSV export and reports all share it. */
export const METRICS = {
  sessions: { label: 'Sessions', desc: '1:1 + group + evaluation appointments', zero: 'sessions', fmt: (v) => `${Math.round(v)}` },
  hours: { label: 'Client hours', desc: 'delivered clinical time', zero: 'h', fmt: (v) => `${Math.round(v * 10) / 10}h` },
  units: { label: 'Billable units', desc: 'CPT units authorized for claim', zero: 'units', fmt: (v) => `${Math.round(v * 4) / 4}` },
  revenue: { label: 'Gross revenue', desc: 'units × rate + mileage', zero: '$0', money: true, fmt: (v) => `$${fmtK(v)}` },
  utilization: { label: 'Utilization', desc: 'booked staff-minutes ÷ scheduled capacity', pct: true, zero: '0%', fmt: (v) => `${Math.round(v)}%` },
  cancelled: { label: 'Cancellations', desc: 'cancelled appointments in range', zero: 'cancel', fmt: (v) => `${Math.round(v)}` },
  noShow: { label: 'No-shows', desc: 'missed sessions', zero: 'no-shows', fmt: (v) => `${Math.round(v)}` },
  cover: { label: 'Recoverable slots', desc: 'open cancellations backfill can refill', zero: 'open', fmt: (v) => `${Math.round(v)}` },
  driveMiles: { label: 'Travel miles', desc: 'reimbursable drive distance', zero: 'mi', fmt: (v) => `${Math.round(v)} mi` },
}
export const metricOf = (key, mm) => (mm == null ? 0 : key === 'revenue' ? mm.revenue : key === 'utilization' ? mm.utilization : key === 'cover' ? mm.needsCover : key === 'hours' ? mm.hours : Number(mm[key] || 0))

/** Series value for one metric across buckets. */
export function seriesFor(state, buckets, metricKey) {
  return buckets.map((b) => ({ key: b.key, label: b.label, value: metricOf(metricKey, rangeMetrics(state, b.days)) }))
}

export const DIMS = {
  staff: { label: 'Staff member' },
  team: { label: 'Care team' },
  client: { label: 'Client' },
  program: { label: 'Program / service model' },
  type: { label: 'Appointment type' },
  code: { label: 'Billing code' },
  status: { label: 'Status' },
  location: { label: 'Site / location' },
  payer: { label: 'Payer / insurer' },
  service: { label: 'Service line' },
}

/** Pivot the range by an entity dimension. Returns rows sorted by revenue desc. */
export function pivotRows(state, days, dim) {
  const list = rawIn(state, days)
  const byId = (k) => Object.fromEntries(state[k].map((x) => [x.id, x]))
  const staff = byId('staff')
  const clients = byId('clients')
  const teams = Object.values(state.teams)
  const acc = new Map()
  const touch = (key, label, sub, color, a, charge) => {
    if (!key) return
    const r = acc.get(key) || acc.set(key, { key, label, sub: sub || '', color: color || null, sessions: 0, minutes: 0, units: 0, revenue: 0, cancelled: 0, noShow: 0, appts: 0, ids: new Set() }).get(key)
    r.appts++
    if (a.status === 'cancelled') {
      r.cancelled++
      return
    }
    if (a.status === 'no-show') r.noShow++
    if (a.type === 'service' || a.type === 'evaluation') {
      r.sessions++
      r.minutes += a.end - a.start
    }
    r.units += Number(a.billing?.units) || 0
    r.revenue += charge
    if (a.clientIds?.length) r.ids.add(a.clientIds[0])
  }
  for (const a of list) {
    const charge = TYPES[a.type]?.billable && a.billing ? computeBilling(a) / Math.max(1, (a.staffIds || []).length || 1) : 0
    if (dim === 'staff') for (const s of a.staffIds || []) { const p = staff[s]; touch(s, p?.name || s, p?.role, p?.color, a, charge) }
    else if (dim === 'client') for (const c of a.clientIds || []) { const p = clients[c]; touch(c, p?.name || c, p?.program, p?.color, a, charge) }
    else if (dim === 'team') for (const t of teams) { if ((t.staffIds || []).some((s) => (a.staffIds || []).includes(s)) || (t.clientIds || []).some((c) => (a.clientIds || []).includes(c))) touch(t.id, t.name.replace('Care Team · ', ''), `${(t.staffIds || []).length} staff · ${(t.clientIds || []).length} clients`, t.color, a, charge / Math.max(1, teams.length)) }
    else if (dim === 'program') for (const c of a.clientIds || []) { const p = clients[c]; touch(p?.program || 'Unassigned', p?.program || 'Unassigned', '', p?.color, a, charge / Math.max(1, (a.clientIds || []).length)) }
    else if (dim === 'type') touch(a.type, TYPES[a.type]?.label || a.type, '', TYPES[a.type]?.color, a, charge)
    else if (dim === 'status') touch(a.status, STATUSES[a.status]?.label || a.status, '', STATUSES[a.status]?.dot, a, charge)
    else if (dim === 'code') { if (TYPES[a.type]?.billable && a.billing?.code) touch(a.billing.code, a.billing.code, BILL_CODES.find((b) => b.id === a.billing.code)?.label.split(' · ')[1] || '', null, a, charge) }
    else if (dim === 'location') { const loc = a.location || 'Unspecified'; touch(loc, loc, '', null, a, charge) }
    else if (dim === 'payer') { for (const c of a.clientIds || []) { const ins = clients[c]?.insurer || 'Self-pay'; touch(ins, ins, '', null, a, charge / Math.max(1, (a.clientIds || []).length)) } }
    else if (dim === 'service') { const svc = SERVICES.find((s) => s.id === a.service); touch(svc?.id || 'other', svc?.label || 'Other', svc?.code, null, a, charge) }
  }
  return [...acc.values()]
    .map((r) => ({ ...r, hours: Math.round((r.minutes / 60) * 10) / 10, revenue: Math.round(r.revenue), units: Math.round(r.units * 4) / 4, ids: undefined }))
    .sort((x, y) => y.revenue - x.revenue || y.sessions - x.sessions)
}

/** Day-of-week × hour density matrix for the heat view. */
export function heatMatrix(state, days) {
  const wd = state.settings?.workday || [8, 18]
  const H = wd[1] - wd[0]
  const grid = Array.from({ length: 7 }, () => Array.from({ length: H }, () => ({ count: 0, minutes: 0 })))
  for (const a of rawIn(state, days)) {
    if (a.status === 'cancelled' || (a.type !== 'service' && a.type !== 'evaluation')) continue
    const dow = parseISO(a.date).getDay()
    for (let h = wd[0]; h < wd[1]; h++) {
      const s0 = a.start / 60
      const s1 = a.end / 60
      const ov = Math.min(s1, h + 1) - Math.max(s0, h)
      if (ov > 0) {
        grid[dow][h - wd[0]].count++
        grid[dow][h - wd[0]].minutes += Math.round(ov * 60)
      }
    }
  }
  return { grid, hourStart: wd[0], hourSpan: H }
}

/** Same-length previous window for period-over-period deltas. */
export function priorDays(days) {
  const first = parseISO(days[0])
  return Array.from({ length: days.length }, (_, i) => isoDate(addDays(first, i - days.length)))
}
export function delta(cur, prev) {
  if (!prev) return cur ? 100 : 0
  return Math.round(((cur - prev) / Math.abs(prev)) * 100)
}

/** Range presets shared by Analytics, Reports and Billing so every section slides together. */
export const RANGE_PRESETS = [
  { id: 'week', label: 'This week' },
  { id: 'lastWeek', label: 'Last week' },
  { id: 'last4', label: 'Last 4 weeks' },
  { id: 'last8', label: 'Last 8 weeks' },
  { id: 'last13', label: 'Last 13 weeks (quarter)' },
  { id: 'month', label: 'This month' },
  { id: 'lastMonth', label: 'Last month' },
  { id: 'ytd', label: 'Year to date' },
  { id: 'horizon', label: 'Full demo horizon' },
]

export function resolveRange(preset, anchor, weekStart = 0) {
  const a = parseISO(anchor)
  const sow = startOfWeek(a, weekStart)
  const list = (s, n) => Array.from({ length: n }, (_, i) => isoDate(addDays(s, i)))
  let start = sow
  let n = 7
  if (preset === 'lastWeek') {
    start = addDays(sow, -7)
  } else if (preset === 'last4') {
    start = addDays(sow, -21)
    n = 28
  } else if (preset === 'last8') {
    start = addDays(sow, -49)
    n = 56
  } else if (preset === 'last13') {
    start = addDays(sow, -84)
    n = 91
  } else if (preset === 'month') {
    start = new Date(a.getFullYear(), a.getMonth(), 1)
    n = daysInMonth(a.getFullYear(), a.getMonth())
  } else if (preset === 'lastMonth') {
    start = new Date(a.getFullYear(), a.getMonth() - 1, 1)
    n = daysInMonth(a.getFullYear(), a.getMonth() - 1)
  } else if (preset === 'ytd') {
    start = new Date(a.getFullYear(), 0, 1)
    const end = new Date(a.getFullYear(), a.getMonth() + 1, 0)
    n = Math.round((end - start) / 86400000) + 1
  } else if (preset === 'horizon') {
    start = addDays(parseISO(todayISO()), -21)
    n = 49
  }
  const days = list(start, n)
  const sh = (iso) => `${pad2(parseISO(iso).getMonth() + 1)}/${pad2(parseISO(iso).getDate())}`
  return { days, label: `${sh(days[0])} – ${sh(days[days.length - 1])}, ${parseISO(days[days.length - 1]).getFullYear()}`, preset }
}

/** Shift the whole window by `dir` bucket-counts (the ‹ / › slide buttons). */
export function slidePreset(preset, anchor, dir, weekStart = 0) {
  const { days } = resolveRange(preset, anchor, weekStart)
  const step = days.length
  return isoDate(addDays(parseISO(days[0]), dir * step))
}
