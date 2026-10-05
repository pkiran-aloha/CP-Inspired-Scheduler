// ---- Scheduling density optimiser (B2) ----
//
// The optimiser looks for same-day, same-staff moves that turn a split clinician day
// into a tighter block: move one future clinical session into a free slot immediately
// before or after another appointment. It never changes staff/client assignments, never
// creates outreach, and never guesses travel. Applying a suggestion is still a local
// calendar move, so the planner rechecks live availability and Stop-level validations
// before the UI dispatches the normal appointment move.
import { SNAP, overlapsType } from './model'
import { todayISO } from './date'
import { evaluateAppointmentValidations, isCancelStatus } from './settingsMasters'

const arr = (v) => (Array.isArray(v) ? v : [])
const round1 = (n) => Math.round(n * 10) / 10
const CLINICAL = new Set(['service', 'evaluation', 'supervision'])
const BLOCKING_TYPES = new Set(['unavailable', 'break'])
const STOP_IDS = new Set([
  'staff.overlap',
  'staff.unavailable',
  'staff.travel',
  'client.overlap',
  'client.duplicateOverlap',
])

const overlaps = (aS, aE, bS, bE) => aS < bE && bS < aE
const blocksCalendar = (a) => overlapsType(a) || BLOCKING_TYPES.has(a?.type)
const clockMinutes = () => {
  const d = new Date()
  return d.getHours() * 60 + d.getMinutes()
}
const effectiveNowMin = (today, nowMin) => Number.isFinite(nowMin) ? nowMin : (today === todayISO() ? clockMinutes() : null)
const pastClock = (date, start, today, nowMin) => date === today && Number.isFinite(nowMin) && start < nowMin
const movableStatus = (state, a) => !isCancelStatus(state.settings, a?.status) && !['completed', 'no-show', 'cancelled'].includes(a?.status)
const movableAppt = (state, a, today, nowMin = null) =>
  a?.id && a.date >= today && !pastClock(a.date, a.start, today, nowMin) && CLINICAL.has(a.type) && movableStatus(state, a) && !a.claimId && !a.billing?.status && arr(a.staffIds).length > 0 && a.end > a.start

const sameDayLive = (state, date) => Object.values(state.appts || {}).filter((a) => a?.date === date && !isCancelStatus(state.settings, a.status))

function mergeIntervals(items) {
  const sorted = items
    .filter((iv) => Number.isFinite(iv.start) && Number.isFinite(iv.end) && iv.end > iv.start)
    .sort((a, b) => a.start - b.start || a.end - b.end)
  const out = []
  for (const iv of sorted) {
    const last = out[out.length - 1]
    if (last && iv.start <= last.end) {
      last.end = Math.max(last.end, iv.end)
      last.items.push(...arr(iv.items))
    } else {
      out.push({ start: iv.start, end: iv.end, items: [...arr(iv.items)] })
    }
  }
  return out
}

function intervalsForStaffDay(state, staffId, date, move = null) {
  const intervals = []
  for (const a of sameDayLive(state, date)) {
    if (!arr(a.staffIds).includes(staffId)) continue
    if (!blocksCalendar(a)) continue
    if (move && a.id === move.apptId) {
      intervals.push({ start: move.start, end: move.end, items: [{ ...a, start: move.start, end: move.end }] })
    } else {
      intervals.push({ start: a.start, end: a.end, items: [a] })
    }
  }
  return mergeIntervals(intervals)
}

function staffDayMetrics(state, staffId, date, move = null) {
  const [wdStart = 8, wdEnd = 18] = state.settings?.workday || []
  const blocks = intervalsForStaffDay(state, staffId, date, move)
  const busyMin = blocks.reduce((sum, b) => sum + (b.end - b.start), 0)
  const spreadMin = blocks.length ? blocks[blocks.length - 1].end - blocks[0].start : 0
  const idleGapMin = Math.max(0, spreadMin - busyMin)
  const split = (wdStart * 60 + wdEnd * 60) / 2
  const halves = [[wdStart * 60, split], [split, wdEnd * 60]].filter(([s, e]) => e > s)
  const openHalfDays = halves.filter(([s, e]) => !blocks.some((b) => overlaps(s, e, b.start, b.end))).length
  return { blockCount: blocks.length, busyMin, spreadMin, idleGapMin, openHalfDays }
}

function aggregateMetrics(state, staffIds, date, move = null) {
  const rows = arr(staffIds).map((sid) => staffDayMetrics(state, sid, date, move))
  return rows.reduce((out, r) => ({
    blockCount: out.blockCount + r.blockCount,
    busyMin: out.busyMin + r.busyMin,
    spreadMin: out.spreadMin + r.spreadMin,
    idleGapMin: out.idleGapMin + r.idleGapMin,
    openHalfDays: out.openHalfDays + r.openHalfDays,
  }), { blockCount: 0, busyMin: 0, spreadMin: 0, idleGapMin: 0, openHalfDays: 0 })
}

function conflictsForPlacement(state, appt, target) {
  const staffIds = new Set(arr(appt.staffIds))
  const clientIds = new Set(arr(appt.clientIds))
  const out = []
  for (const other of sameDayLive(state, target.date)) {
    if (!other || other.id === appt.id) continue
    if (!overlaps(target.start, target.end, other.start, other.end)) continue
    const staffClash = arr(other.staffIds).filter((sid) => staffIds.has(sid))
    const clientClash = arr(other.clientIds).filter((cid) => clientIds.has(cid))
    if (!staffClash.length && !clientClash.length) continue
    if (staffClash.length && blocksCalendar(other)) out.push({ kind: 'staff', other, ids: staffClash })
    if (clientClash.length && (blocksCalendar(other) || CLINICAL.has(other.type))) out.push({ kind: 'client', other, ids: clientClash })
  }
  return out
}

function bestName(list, id) {
  return arr(list).find((x) => x.id === id)?.name || id
}

function namesFor(list, ids) {
  return arr(ids).map((id) => bestName(list, id)).filter(Boolean).join(', ')
}

function hasTouchingDrive(state, appt) {
  return sameDayLive(state, appt.date).some((a) => a.id !== appt.id && a.type === 'drive' && arr(a.staffIds).some((sid) => arr(appt.staffIds).includes(sid)) && (Math.abs(a.end - appt.start) <= SNAP || Math.abs(a.start - appt.end) <= SNAP))
}

function validationResult(state, appt, target) {
  const draft = { ...appt, date: target.date, start: target.start, end: target.end }
  const result = evaluateAppointmentValidations(state, draft)
  // Density moves only refuse Stop findings that this time move can introduce. Existing
  // chart/billing setup Stops (for example missing provider identifiers) still belong in
  // the full booking dialog; hiding every otherwise useful density hint behind them would
  // make the optimiser a configuration audit instead of a scheduling aid.
  const blockingStops = arr(result.stops).filter((item) => STOP_IDS.has(item.id))
  return { ...result, blockingStops }
}

function suggestionFromMove(state, appt, primaryStaffId, target, adjacent, { minGainMin = 30 } = {}) {
  if (target.start === appt.start && target.end === appt.end && target.date === appt.date) return null
  if (target.start < 0 || target.end > 24 * 60 || target.end - target.start !== appt.end - appt.start) return null
  const conflicts = conflictsForPlacement(state, appt, target)
  if (conflicts.length) return null
  const verdict = validationResult(state, appt, target)
  if (verdict.blockingStops.length) return null

  const before = aggregateMetrics(state, appt.staffIds, appt.date)
  const after = aggregateMetrics(state, appt.staffIds, appt.date, { apptId: appt.id, start: target.start, end: target.end })
  const primaryBefore = staffDayMetrics(state, primaryStaffId, appt.date)
  const primaryAfter = staffDayMetrics(state, primaryStaffId, appt.date, { apptId: appt.id, start: target.start, end: target.end })
  const gain = {
    idleMin: Math.max(0, before.idleGapMin - after.idleGapMin),
    spreadMin: Math.max(0, before.spreadMin - after.spreadMin),
    blocks: Math.max(0, before.blockCount - after.blockCount),
    halfDays: Math.max(0, after.openHalfDays - before.openHalfDays),
    primaryIdleMin: Math.max(0, primaryBefore.idleGapMin - primaryAfter.idleGapMin),
    primarySpreadMin: Math.max(0, primaryBefore.spreadMin - primaryAfter.spreadMin),
  }
  if (gain.idleMin < minGainMin && gain.spreadMin < minGainMin && gain.blocks <= 0 && gain.halfDays <= 0) return null
  const staffName = bestName(state.staff, primaryStaffId)
  const clientNames = namesFor(state.clients, appt.clientIds)
  const title = appt.title || clientNames || 'Session'
  const moveMin = Math.abs(target.start - appt.start)
  const score = gain.idleMin + gain.spreadMin * 0.6 + gain.blocks * 45 + gain.halfDays * 90 - Math.round(moveMin / 60)
  const warnLabels = arr(verdict.warns).map((i) => i.label)
  const flagLabels = arr(verdict.flags).map((i) => i.label)
  return {
    id: `den-${appt.id}-${target.date}-${target.start}-${target.end}`,
    apptId: appt.id,
    appt,
    date: appt.date,
    title,
    clientNames,
    staffIds: arr(appt.staffIds),
    staffName,
    primaryStaffId,
    durationMin: appt.end - appt.start,
    from: { date: appt.date, start: appt.start, end: appt.end },
    to: { date: target.date, start: target.start, end: target.end },
    adjacentTo: adjacent,
    gain,
    score: Math.round(score),
    warnings: [...new Set([...warnLabels, ...flagLabels])],
    driveNote: hasTouchingDrive(state, appt),
    reason: gain.halfDays > 0
      ? `${staffName} opens ${gain.halfDays} half-day${gain.halfDays === 1 ? '' : 's'} by tightening the block.`
      : gain.idleMin > 0
        ? `${staffName} has ${round1(gain.idleMin / 60)}h less split idle time.`
        : `${staffName}'s scheduled span shrinks by ${round1(gain.spreadMin / 60)}h.`,
  }
}

/**
 * Return ranked same-day density moves for the visible calendar range.
 * Suggestions are advisory until a user applies one; no appointments are changed here.
 */
export function densityBoard(state, days, { today = todayISO(), nowMin, limit = 10, minGainMin = 30 } = {}) {
  const daySet = new Set(arr(days))
  const now = effectiveNowMin(today, nowMin)
  const [wdStart = 8, wdEnd = 18] = state.settings?.workday || []
  const workStart = wdStart * 60
  const workEnd = wdEnd * 60
  const activeStaff = arr(state.staff).filter((s) => s.status !== 'inactive')
  const rows = new Map()

  for (const date of daySet) {
    if (date < today) continue
    for (const staff of activeStaff) {
      const staffBlocks = sameDayLive(state, date)
        .filter((a) => arr(a.staffIds).includes(staff.id) && blocksCalendar(a))
        .sort((a, b) => a.start - b.start || a.end - b.end)
      const movable = staffBlocks.filter((a) => movableAppt(state, a, today, now))
      if (!movable.length || staffBlocks.length < 2) continue

      for (const appt of movable) {
        const dur = appt.end - appt.start
        const others = staffBlocks.filter((a) => a.id !== appt.id)
        const blocks = mergeIntervals(others.map((a) => ({ start: a.start, end: a.end, items: [a] })))
        for (const block of blocks) {
          const adjacentTitle = block.items.map((a) => a.title || a.type || 'appointment').slice(0, 2).join(' + ')
          const candidates = [
            { start: block.start - dur, end: block.start, side: 'before' },
            { start: block.end, end: block.end + dur, side: 'after' },
          ]
          for (const cand of candidates) {
            if (cand.start < workStart || cand.end > workEnd || pastClock(date, cand.start, today, now)) continue
            const row = suggestionFromMove(state, appt, staff.id, { date, start: cand.start, end: cand.end }, {
              side: cand.side,
              start: block.start,
              end: block.end,
              title: adjacentTitle,
            }, { minGainMin })
            if (!row) continue
            const key = `${row.apptId}|${row.to.date}|${row.to.start}|${row.to.end}`
            const prev = rows.get(key)
            if (!prev || row.score > prev.score || row.gain.primaryIdleMin > prev.gain.primaryIdleMin) rows.set(key, row)
          }
        }
      }
    }
  }

  const ranked = [...rows.values()].sort((a, b) =>
    b.score - a.score || b.gain.idleMin - a.gain.idleMin || a.date.localeCompare(b.date) || a.from.start - b.from.start || a.title.localeCompare(b.title))
  const visible = ranked.slice(0, limit)
  return {
    rows: visible,
    allRows: ranked,
    summary: {
      suggestions: ranked.length,
      shown: visible.length,
      idleHours: round1(ranked.reduce((sum, r) => sum + r.gain.idleMin, 0) / 60),
      spreadHours: round1(ranked.reduce((sum, r) => sum + r.gain.spreadMin, 0) / 60),
      halfDays: ranked.reduce((sum, r) => sum + r.gain.halfDays, 0),
    },
  }
}

/**
 * Re-check one proposed density move against the current workspace before dispatching.
 * The reducer action is still the normal appointment move (`patch`); this planner is the
 * guardrail the Insights panel calls immediately before it writes.
 */
export function planDensityMove(state, move, { today = todayISO(), nowMin } = {}) {
  const now = effectiveNowMin(today, nowMin)
  const apptId = move?.apptId || move?.appt?.id
  const target = move?.to || move
  const appt = state.appts?.[apptId]
  if (!appt) return { ok: false, msg: 'That appointment no longer exists.' }
  if (!movableAppt(state, appt, today, now)) return { ok: false, msg: 'That session is no longer eligible for a density move.' }
  if (!target?.date || !Number.isFinite(target.start) || !Number.isFinite(target.end) || target.end <= target.start) return { ok: false, msg: 'Choose a valid target time.' }
  if (target.date !== appt.date) return { ok: false, msg: 'Density moves are same-day only; use the booking dialog to change the date.' }
  if (pastClock(target.date, target.start, today, now)) return { ok: false, msg: 'Density moves cannot move a session into a time that has already started.' }
  if (target.end - target.start !== appt.end - appt.start) return { ok: false, msg: 'Density moves keep the session length unchanged.' }
  const conflicts = conflictsForPlacement(state, appt, target)
  if (conflicts.length) {
    const first = conflicts[0]
    return { ok: false, msg: `Not moved — ${first.kind === 'staff' ? 'staff' : 'client'} overlaps “${first.other.title || 'another appointment'}”.` }
  }
  const verdict = validationResult(state, appt, target)
  if (verdict.blockingStops.length) return { ok: false, msg: `Not moved — ${verdict.blockingStops[0].label}: ${verdict.blockingStops[0].message}` }
  const fresh = densityBoard(state, [appt.date], { today, nowMin: now, limit: 200 }).allRows.find((r) => r.apptId === appt.id && r.to.date === target.date && r.to.start === target.start && r.to.end === target.end)
  if (!fresh) return { ok: false, msg: 'That density suggestion is stale. Reopen Insights to refresh the list.' }
  const warnCount = arr(verdict.warns).length + arr(verdict.flags).length
  return {
    ok: true,
    msg: `Moved locally into a denser block${warnCount ? ` · review ${warnCount} warning${warnCount === 1 ? '' : 's'}` : ''}.`,
    appt,
    patch: { date: target.date, start: target.start, end: target.end },
    suggestion: fresh,
    warnings: [...arr(verdict.warns), ...arr(verdict.flags)],
  }
}
