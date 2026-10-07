// ---- Pick fit: what the workspace already knows about each candidate ----
//
// The pickers' verdict chips answer "what goes wrong if I add this person?". This
// module answers the next question a scheduler asks: "of the people who can, who fits
// best?" — from data the workspace already holds, never from a guess:
//
//   staff    · past sessions with this client (continuity) · hours booked this week
//              against the staff record's target hours · drive from the previous
//              appointment that day (straight-line estimate, `travel.js`) · the
//              practice's own ranking (`suggestStaff`, Settings → Smart scheduling)
//   clients  · hours booked this week against the authorized week (`authBurn`) ·
//              days to authorization expiry or share used · the client's usual
//              weekday and time band over the last 8 weeks
//   rail     · continuity and caseload-balance notes for the people picked, and
//              open slots in the next 7 practice days when the chosen slot clashes
//
// Pure and read-only: nothing here books, moves or blocks anything.

import { overlapsType, SNAP } from './model'
import { suggestStaff, smartCfg, weekLoad, isStaffFree } from './smart'
import { authBurn, authGuardCfg } from './authBudget'
import { resolveApptLocation, travelLeg, travelChecksForStaffDay } from './travel'
import { clinicianGroup, practiceDaysOf } from './ramp'
import { riskFor, riskModel, riskTimeBand, RISK_TIME_LABEL } from './risk'
import { isCancelStatus } from './settingsMasters'
import { addDays, isoDate, parseISO, startOfWeek, todayISO, DAY_SHORT, fmtTime } from './date'

export const FIT_LOOKBACK_WEEKS = 8 // history window for a client's usual slot
export const USUAL_MIN = 3 // sessions in one weekday × time band before it counts as "usual"
export const PEER_UNDER = 0.75 // a peer under this share of their target hours is "lighter"
export const SLOT_DAYS = 7
export const SLOT_LIMIT = 3
const DEFAULT_TARGET_H = 30 // same fallback the Staff screen and reports use
const CLINICAL = ['service', 'evaluation', 'supervision']

const r1 = (n) => Math.round(n * 10) / 10
const first = (name) => String(name || '').split(' ')[0]
const weekDaysOf = (date, ws = 0) => Array.from({ length: 7 }, (_, i) => isoDate(addDays(startOfWeek(parseISO(date), ws), i)))
const occupies = (a) => overlapsType(a) || a.type === 'unavailable'
const targetOf = (s) => (Number(s?.targetWeekH) > 0 ? Number(s.targetWeekH) : DEFAULT_TARGET_H)

/** Hours each staff member is booked in the draft's week (blocked-out time is not work). */
function weekHours(state, draft) {
  const id = draft.id || '__draft__'
  const wk = new Set(weekDaysOf(draft.date, state.settings?.weekStart))
  const out = {}
  for (const a of Object.values(state.appts || {})) {
    if (a.id === id || !wk.has(a.date) || !overlapsType(a) || isCancelStatus(state.settings, a.status)) continue
    for (const s of a.staffIds || []) out[s] = (out[s] || 0) + (a.end - a.start) / 60
  }
  return out
}

/** Past (delivered or booked-before-today) clinical sessions each staff member had with one client. */
function pastWith(state, clientId, today) {
  const out = {}
  for (const a of Object.values(state.appts || {})) {
    if (a.date >= today || !CLINICAL.includes(a.type) || isCancelStatus(state.settings, a.status) || a.status === 'no-show') continue
    if (!(a.clientIds || []).includes(clientId)) continue
    for (const s of a.staffIds || []) out[s] = (out[s] || 0) + 1
  }
  return out
}

/**
 * Fit for every staff member against this draft.
 * @returns { [staffId]: { score|null, facts: [{text, tone?}], reason } } — empty without a slot
 */
export function staffFit(state, draft, { today = todayISO() } = {}) {
  if (!draft?.date || !(draft.end > draft.start)) return {}
  const id = draft.id || '__draft__'
  const settings = state.settings || {}
  const clinical = CLINICAL.includes(draft.type)
  const cid = clinical ? (draft.clientIds || [])[0] : null
  const client = cid ? (state.clients || []).find((c) => c.id === cid) : null
  const hours = weekHours(state, draft)
  const durH = (draft.end - draft.start) / 60
  const hist = client ? pastWith(state, cid, today) : {}

  // the practice's own ranking, so the badge agrees with "Suggested for this client"
  const ranked = client
    ? suggestStaff({
        staff: state.staff || [], teams: state.teams, clients: state.clients, appts: state.appts || {},
        clientIds: draft.clientIds, date: draft.date, start: draft.start, end: draft.end,
        ignoreIds: [id], load: weekLoad(state.appts || {}, weekDaysOf(draft.date, settings.weekStart)),
        limit: (state.staff || []).length, cfg: smartCfg(settings), code: draft.billingCode || '', sameSite: draft.location || '',
        weekDays: weekDaysOf(draft.date, settings.weekStart),
      })
    : []
  const rank = Object.fromEntries(ranked.map((r) => [r.staff.id, r]))

  // previous appointment that day per staff member, for the drive estimate
  const prev = {}
  for (const a of Object.values(state.appts || {})) {
    if (a.id === id || a.date !== draft.date || !occupies(a) || a.type === 'unavailable' || isCancelStatus(settings, a.status) || a.end > draft.start) continue
    for (const s of a.staffIds || []) if (!prev[s] || a.end > prev[s].end) prev[s] = a
  }
  const here = resolveApptLocation(state, { ...draft, id })

  const out = {}
  for (const s of state.staff || []) {
    const facts = []
    if (client) {
      const n = hist[s.id] || 0
      facts.push(n ? { text: `${n} past session${n === 1 ? '' : 's'} with ${first(client.name)}` } : { text: `New to ${first(client.name)}`, tone: 'flag' })
    }
    const booked = hours[s.id] || 0
    const after = r1(booked + durH) // the draft's own hours are excluded above, so add them once
    const target = targetOf(s)
    facts.push(after > target ? { text: `${after} of ${target} h this week`, tone: 'flag' } : { text: `${after} of ${target} h this week` })
    const p = prev[s.id]
    const from = p && here ? resolveApptLocation(state, p) : null
    if (from) {
      const leg = travelLeg([from.lat, from.lng], [here.lat, here.lng])
      if (leg && leg.straightMi > 0.1) facts.push({ text: `~${leg.travelMin} min from previous` })
    }
    const r = rank[s.id]
    out[s.id] = { score: r ? r.score : null, facts, reason: r ? [...r.reasons, ...(r.warnings || [])].join(' · ') : '' }
  }
  return out
}

/** A client's most common weekday × time band over the lookback, when it is common enough to call usual. */
function usualSlots(state, today) {
  const since = isoDate(addDays(parseISO(today), -7 * FIT_LOOKBACK_WEEKS))
  const tally = {}
  for (const a of Object.values(state.appts || {})) {
    if (a.date < since || a.date >= today || !CLINICAL.includes(a.type) || isCancelStatus(state.settings, a.status)) continue
    const key = `${parseISO(a.date).getDay()}|${riskTimeBand(a.start)}`
    for (const c of a.clientIds || []) {
      const t = (tally[c] ||= {})
      t[key] = (t[key] || 0) + 1
    }
  }
  const out = {}
  for (const [c, t] of Object.entries(tally)) {
    const [key, n] = Object.entries(t).sort((x, y) => y[1] - x[1])[0]
    if (n >= USUAL_MIN) out[c] = { dow: Number(key.split('|')[0]), band: key.split('|')[1], n }
  }
  return out
}

/**
 * Fit for every client against this (clinical) draft.
 * `score` = authorized hours still open in the draft's week (higher = more behind).
 */
export function clientFit(state, draft, { today = todayISO() } = {}) {
  if (!draft?.date || !(draft.end > draft.start) || !CLINICAL.includes(draft.type)) return {}
  const id = draft.id || '__draft__'
  const cfg = authGuardCfg(state.settings)
  const usual = usualSlots(state, today)
  const dow = parseISO(draft.date).getDay()
  const band = riskTimeBand(draft.start)
  const out = {}
  for (const c of state.clients || []) {
    const facts = []
    let score = null
    const burn = authBurn(state, c.id, { today, on: draft.date, exclude: [id] })
    const win = burn.window
    if (win.hasWindow && win.end >= today && burn.week.cap > 0) {
      const open = r1(burn.week.cap - burn.week.hours)
      score = open
      facts.push({ text: `${r1(burn.week.hours)} of ${burn.week.cap} auth h this week`, ...(burn.week.pct < cfg.underPacePct ? { tone: 'flag' } : {}) })
      if (win.daysToExpiry != null && win.daysToExpiry <= cfg.expiryWarnDays) facts.push({ text: `Auth ends in ${win.daysToExpiry} d`, tone: 'flag' })
      else facts.push({ text: `${burn.pct}% of auth used` })
    }
    const u = usual[c.id]
    if (u) {
      const label = `${DAY_SHORT[u.dow]} ${RISK_TIME_LABEL[u.band].split(' (')[0]}`
      facts.push(u.dow === dow && u.band === band ? { text: `Usual slot (${label})`, tone: 'ok' } : { text: `Usually ${label}` })
    }
    out[c.id] = { score, facts, reason: score != null && score > 0 ? `${score} authorized h still open in this week` : '' }
  }
  return out
}

/**
 * Notes for the people already picked: continuity (a technician new to the client when
 * someone else has history) and caseload balance (over target while a same-tier peer
 * who is free then sits well under theirs). Lines read as sentences for the Checks rail.
 */
export function fitNotes(state, draft, { today = todayISO() } = {}) {
  if (!draft?.date || !(draft.end > draft.start) || !CLINICAL.includes(draft.type)) return []
  const id = draft.id || '__draft__'
  const staffById = Object.fromEntries((state.staff || []).map((s) => [s.id, s]))
  const picked = (draft.staffIds || []).map((x) => staffById[x]).filter(Boolean)
  if (!picked.length) return []
  const lines = []
  const cid = (draft.clientIds || [])[0]
  const client = cid ? (state.clients || []).find((c) => c.id === cid) : null
  if (client) {
    const hist = pastWith(state, cid, today)
    const [topId, topN] = Object.entries(hist).filter(([s]) => staffById[s] && !(draft.staffIds || []).includes(s)).sort((a, b) => b[1] - a[1])[0] || []
    for (const s of picked) {
      if (hist[s.id] || !(topN >= USUAL_MIN)) continue
      lines.push({ tone: 'flag', text: `${s.name} has no past sessions with ${client.name}; ${staffById[topId].name} has had ${topN}. A familiar clinician protects continuity.` })
    }
  }
  const hours = weekHours(state, draft)
  const durH = (draft.end - draft.start) / 60
  for (const s of picked) {
    const after = r1((hours[s.id] || 0) + durH)
    const target = targetOf(s)
    if (after <= target) continue
    const tier = clinicianGroup(s)
    const peer = (state.staff || [])
      .filter((p) => p.id !== s.id && !(draft.staffIds || []).includes(p.id) && tier && clinicianGroup(p) === tier)
      .filter((p) => (hours[p.id] || 0) / targetOf(p) < PEER_UNDER && isStaffFree(state.appts || {}, p.id, draft.date, draft.start, draft.end, [id]))
      .sort((a, b) => (hours[a.id] || 0) / targetOf(a) - (hours[b.id] || 0) / targetOf(b))[0]
    lines.push({
      tone: 'flag',
      text: `${s.name} would be at ${after} of ${target} target hours this week.${peer ? ` ${peer.name} (same tier) is free then, at ${r1(hours[peer.id] || 0)} of ${targetOf(peer)}.` : ''}`,
    })
  }
  return lines
}

/**
 * Open slots for everyone picked, in the next SLOT_DAYS from the draft's date: the same
 * length, inside the working day, on practice days, from today on, with nobody busy or
 * blocked out. Ranked by: same day first, closer to the asked time, joining an existing
 * block for the staff (no idle gap), and a high cancellation-risk band last. A slot the
 * clinician cannot reach from the neighbouring session (travel.js) is never offered.
 */
export function openSlots(state, draft, { today = todayISO(), days = SLOT_DAYS, limit = SLOT_LIMIT } = {}) {
  const people = [...(draft?.staffIds || []), ...(draft?.clientIds || [])]
  const dur = (draft?.end || 0) - (draft?.start || 0)
  if (!draft?.date || dur <= 0 || !people.length) return []
  const id = draft.id || '__draft__'
  const settings = state.settings || {}
  const [wdS, wdE] = Array.isArray(settings.workday) && settings.workday.length === 2 ? settings.workday.map((h) => h * 60) : [480, 1080]
  const openDows = practiceDaysOf(settings.practiceDays)
  const dates = []
  for (let i = 0; i < days; i++) {
    const d = addDays(parseISO(draft.date), i)
    if (isoDate(d) >= today && openDows.includes(d.getDay())) dates.push({ iso: isoDate(d), i })
  }
  const dateSet = new Set(dates.map((d) => d.iso))
  const busy = {}
  for (const a of Object.values(state.appts || {})) {
    if (a.id === id || !dateSet.has(a.date) || !occupies(a) || isCancelStatus(settings, a.status)) continue
    if (!people.some((p) => (a.staffIds || []).includes(p) || (a.clientIds || []).includes(p))) continue
    ;(busy[a.date] ||= []).push({ ...a, staff: (draft.staffIds || []).some((s) => (a.staffIds || []).includes(s)) })
  }
  // a slot next to another booking is only good if the clinician can get there (travel.js)
  const travelBad = (c) => {
    let tight = false
    for (const sid of draft.staffIds || []) {
      const mine = (busy[c.date] || []).filter((a) => a.type !== 'unavailable' && (a.staffIds || []).includes(sid)).sort((x, y) => x.start - y.start)
      for (const t of travelChecksForStaffDay(state, sid, { ...draft, id, date: c.date, start: c.start, end: c.end }, mine)) {
        if (t.severity === 'impossible') return 'impossible'
        tight = true
      }
    }
    return tight ? 'tight' : ''
  }
  const cands = []
  for (const { iso, i } of dates) {
    const b = busy[iso] || []
    for (let t = wdS; t + dur <= wdE; t += SNAP) {
      if (iso === draft.date && t === draft.start) continue
      if (b.some((x) => x.start < t + dur && t < x.end)) continue
      const joins = b.some((x) => x.staff && (x.end === t || x.start === t + dur))
      cands.push({ date: iso, start: t, end: t + dur, joins, cost: i * 240 + Math.abs(t - draft.start) / 2 - (joins ? 60 : 0) })
    }
  }
  cands.sort((a, b) => a.cost - b.cost)
  // keep them meaningfully different: an hour apart on the same day
  const pool = []
  for (const c of cands) {
    if (pool.some((p) => p.date === c.date && Math.abs(p.start - c.start) < 60)) continue
    const travel = travelBad(c)
    if (travel === 'impossible') continue
    if (travel === 'tight') { c.tight = true; c.cost += 60; c.joins = false }
    pool.push(c)
    if (pool.length >= limit * 2) break
  }
  const model = pool.length ? riskModel(state, { today }) : null
  const clinical = CLINICAL.includes(draft.type) && (draft.clientIds || []).length
  for (const c of pool) {
    c.band = clinical ? riskFor(state, { ...draft, id, date: c.date, start: c.start, end: c.end }, model, { today }).band : 'low'
    if (c.band === 'high') c.cost += 600
  }
  return pool.sort((a, b) => a.cost - b.cost).slice(0, limit).map(({ cost, ...c }) => c)
}

/** Words for a slot row: "Tue Oct 13 · 9:00 AM–10:00 AM · joins an existing block". */
export function slotText(slot, h24 = false) {
  const d = parseISO(slot.date)
  const day = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
  const bits = [`${day} · ${fmtTime(slot.start, h24)}–${fmtTime(slot.end, h24)}`]
  if (slot.joins) bits.push('joins an existing block')
  if (slot.tight) bits.push('tight drive from the neighbouring session')
  if (slot.band === 'high' || slot.band === 'watch') bits.push(`${slot.band === 'high' ? 'high' : 'watch'} cancellation risk`)
  return bits.join(' · ')
}
