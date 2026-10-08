// ---- Booking rail at a glance: the numbers the Checks rail draws ----
//
// The booking dialog already works out every check (clashes, authorization, risk,
// practice rules, schedule fit). This module turns those results into the few
// numbers the rail shows as a decision line, meters and chips. Pure: no React, no
// state writes, and nothing new is estimated here.

import { RISK_BANDS } from './risk'

const r1 = (n) => Math.round((Number(n) || 0) * 10) / 10
const ORDER = ['stop', 'warn', 'todo', 'flag']
const COUNT_WORD = { stop: 'to fix', warn: 'to review', todo: 'to fill in', flag: 'noted' }

/**
 * One decision line for a list of check groups (`{tone}` each).
 * Missing required fields never read as "clear", even beside a mere note.
 * @returns {{ tone, headline, counts: [{tone, n, text}], text }}
 */
export function railDecision(groups = []) {
  const n = Object.fromEntries(ORDER.map((t) => [t, groups.filter((g) => g.tone === t).length]))
  const tone = ORDER.find((t) => n[t]) || 'ok'
  const headline = n.stop ? 'Fix before booking' : n.warn ? 'Review before booking' : n.todo ? 'Almost there' : n.flag ? 'Clear to book' : 'Ready to book'
  const counts = ORDER.filter((t) => n[t]).map((t) => ({ tone: t, n: n[t], text: `${n[t]} ${COUNT_WORD[t]}` }))
  return { tone, headline, counts, text: [headline, ...counts.map((c) => c.text)].join(' · ') }
}

/**
 * Authorization hours as a stacked bar: delivered, booked (incl. this session), left.
 * `stats` is `authBurn`'s result. Shares are of the larger of the cap and the total.
 */
export function authMeter(stats) {
  const cap = Number(stats?.window?.authorizedHours) || 0
  if (!(cap > 0)) return null
  const committed = Number(stats.committedHours) || 0
  const used = r1(stats.deliveredHours)
  const booked = r1(Math.max(0, committed - (Number(stats.deliveredHours) || 0)))
  const over = r1(Math.max(0, committed - cap))
  const left = r1(Math.max(0, cap - committed))
  const scale = Math.max(cap, committed)
  const share = (h) => Math.round((h / scale) * 1000) / 10
  const wk = stats.week
  const week = wk && wk.cap > 0
    ? { hours: r1(wk.hours), cap: wk.cap, pct: Math.min(100, Math.round((wk.hours / wk.cap) * 100)), text: `${r1(wk.hours)} of ${wk.cap} h booked this auth week` }
    : null
  return {
    cap: r1(cap), used, booked, left, over,
    usedPct: share(used), bookedPct: share(booked), capPct: share(cap),
    tone: over > 0 ? 'warn' : left < cap * 0.1 ? 'flag' : 'ok',
    text: `${used} h used · ${booked} h booked · ${over > 0 ? `${over} h over` : `${left} h left`} of ${r1(cap)} h`,
    week,
  }
}

/** A staff member's week after this booking, against their target hours. */
export function loadMeter(hours, target) {
  const h = r1(hours)
  const t = Number(target) || 0
  if (!(t > 0)) return null
  const over = h > t
  return { hours: h, target: t, over, pct: Math.min(100, Math.round((h / t) * 100)), tone: over ? 'flag' : 'ok', text: `${h} of ${t} h this week${over ? ' · over target' : ''}` }
}

/** The modelled cancellation risk as a chip; null when there is nothing to model. */
export function riskChip(v) {
  if (!v || v.band === 'done' || !RISK_BANDS[v.band]) return null
  return { score: v.score, tone: v.band === 'high' ? 'warn' : v.band === 'watch' ? 'flag' : 'ok', text: `Risk ${v.score}/100 · ${RISK_BANDS[v.band].label}` }
}
