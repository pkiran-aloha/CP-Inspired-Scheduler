// ---- Smart scheduling: configurable ranking for staff suggestions & cancellation backfill ----
import { overlapsType } from './model'

export const SMART_DEFAULTS = {
  weights: { team: 60, history: 55, fit: 55, load: 45 }, // 0–100, 50 = neutral
  suggest: { count: 3 },
  backfill: { count: 3, minScore: 25, sameTeamOnly: false, autoFill: true, turnaround: true },
}

export function smartCfg(settings) {
  const s = settings?.smart || {}
  const m = (a, b) => ({ ...b, ...(a || {}) })
  const merged = { weights: m(s.weights, SMART_DEFAULTS.weights), suggest: m(s.suggest, SMART_DEFAULTS.suggest), backfill: m(s.backfill, SMART_DEFAULTS.backfill) }
  merged.weights = m(s.weights && { ...s.weights }, SMART_DEFAULTS.weights)
  merged.suggest = m(s.suggest, SMART_DEFAULTS.suggest)
  merged.backfill = m(s.backfill, SMART_DEFAULTS.backfill)
  return merged
}

const mult = (v, neutral = 50) => Math.max(0, Math.min(100, v ?? neutral)) / neutral

const occupying = (a) => (overlapsType(a) || a.type === 'unavailable') && a.status !== 'cancelled'

/** Is this staff member free for the slot? (ignoreIds skips the cancelled occurrence itself) */
export function isStaffFree(appts, staffId, date, start, end, ignoreIds = []) {
  for (const a of Object.values(appts)) {
    if (a.date !== date || ignoreIds.includes(a.id) || !occupying(a)) continue
    if (!(a.staffIds || []).includes(staffId)) continue
    if (a.start < end && start < a.end) return false
  }
  return true
}

/** How many service-type sessions each staff member has run for the given clients (history affinity). */
export function staffClientHistory(appts, clientIds) {
  const m = {}
  for (const a of Object.values(appts)) {
    if (!['service', 'evaluation', 'supervision'].includes(a.type) || a.status === 'cancelled') continue
    if (!(a.clientIds || []).some((c) => clientIds.includes(c))) continue
    for (const s of a.staffIds || []) m[s] = (m[s] || 0) + 1
  }
  return m
}

/** Most recent date per staff that they covered the clients — for continuity scoring. */
function lastCover(appts, clientIds) {
  const m = {}
  for (const a of Object.values(appts)) {
    if (!['service', 'evaluation'].includes(a.type) || a.status === 'cancelled') continue
    if (!(a.clientIds || []).some((c) => clientIds.includes(c))) continue
    for (const s of a.staffIds || []) if (!m[s] || a.date > m[s]) m[s] = a.date
  }
  return m
}

/** Sessions per staff across a range — used to spread the load. */
export function weekLoad(appts, days) {
  const set = new Set(days)
  const m = {}
  for (const a of Object.values(appts)) {
    if (!set.has(a.date) || a.status === 'cancelled' || !occupying(a)) continue
    for (const s of a.staffIds || []) m[s] = (m[s] || 0) + 1
  }
  return m
}

const teamsOf = (teams, key, id) => (teams || []).filter((t) => (t[key] || []).includes(id))

/**
 * Rank available staff for a client/slot — signals, weights & thresholds all
 * driven by `cfg` (from Settings → Smart scheduling):
 *   care-team affinity · prior-session history · continuity · program↔role &
 *   billing-code certification fit · workload balancing · tight-turnaround and
 *   caseload warnings. Returns [{staff, score, reasons, warnings, load}] best-first.
 */
export function suggestStaff({ staff, teams = [], clients = [], appts, clientIds = [], date, start, end, exclude = [], ignoreIds = [], load = {}, limit = 3, cfg = SMART_DEFAULTS, code = '', sameSite = '', weekDays = [] }) {
  const w = cfg?.weights || SMART_DEFAULTS.weights
  const mTeam = mult(w.team)
  const mHist = mult(w.history)
  const mFit = mult(w.fit)
  const mLoad = mult(w.load)
  const hist = clientIds.length ? staffClientHistory(appts, clientIds) : {}
  const last = clientIds.length ? lastCover(appts, clientIds) : {}
  const latestCoverDate = Object.values(last).sort().pop() || ''
  const clientTeams = new Set(clientIds.flatMap((c) => teamsOf(teams, 'clientIds', c).map((t) => t.id)))
  const teamStaff = new Set([...clientTeams].flatMap((tid) => (teams || []).find((t) => t.id === tid)?.staffIds || []))
  const byId = Object.fromEntries((clients || []).map((c) => [c.id, c]))
  const progs = clientIds.map((c) => byId[c]?.program || '').join(' ').toLowerCase()
  const dayAppts = date ? Object.values(appts).filter((a) => a.date === date) : []

  const out = []
  for (const s of staff) {
    if (exclude.includes(s.id)) continue
    if (cfg?.backfill?.sameTeamOnly && clientIds.length && !teamStaff.has(s.id)) continue
    if (!isStaffFree(appts, s.id, date || '', start, end, ignoreIds)) continue
    let score = 40 // baseline: free at this exact time
    const reasons = []
    const warnings = []
    if (clientIds.length && teamStaff.has(s.id)) {
      score += 34 * mTeam
      reasons.push('Same care team')
    }
    const h = hist[s.id] || 0
    if (h) {
      score += Math.min(26, h * 5) * mHist
      reasons.push(`${h} prior session${h > 1 ? 's' : ''} with client`)
    }
    if (latestCoverDate && last[s.id] === latestCoverDate) {
      score += 15 * mFit
      reasons.push('Last to cover')
    }
    const role = (s.role || '').toLowerCase()
    let fitHit = false
    if (progs.includes('speech') && role.includes('speech')) {
      score += 30 * mFit
      reasons.push('SLP for co-treatment')
      fitHit = true
    } else if ((progs.includes('assessment') || progs.includes('intake')) && role.includes('psychologist')) {
      score += 30 * mFit
      reasons.push('Assessment specialist')
      fitHit = true
    } else if (progs.includes('home program') && role.includes('home programs')) {
      score += 18 * mFit
      reasons.push('Home-visit RBT')
      fitHit = true
    } else if (progs.includes('school') && role.includes('school')) {
      score += 18 * mFit
      reasons.push('School-based experience')
      fitHit = true
    }
    if (!fitHit && (progs.includes('eibi') || /esdm/i.test(progs)) && role.includes('eibi')) {
      score += 12 * mFit
      reasons.push('EIBI trained')
    }
    if (code === '97152' && /bcba|bcaba|psychologist/.test(role)) {
      score += 16 * mFit
      reasons.push('Supervisor-certified')
    }
    if (role.includes('student')) {
      score -= 12
      warnings.push('Trainee — co-sign needed')
    }
    const wl = load[s.id] || 0
    score += (14 - wl * 2) * mLoad
    if (wl <= 3) reasons.push(`Light week · ${wl} session${wl === 1 ? '' : 's'}`)
    if (wl >= 9) {
      score -= 10 * mLoad
      warnings.push(`Heavy week · ${wl} booked`)
    }
    // caseload guard: already many sessions with this client in the range
    if (h && weekDays.length) {
      const wkSet = new Set(weekDays)
      let mine = 0
      for (const a of Object.values(appts)) {
        if (!wkSet.has(a.date) || a.status === 'cancelled' || a.id === ignoreIds[0]) continue
        if (a.staffIds?.includes(s.id) && (a.clientIds || []).some((c) => clientIds.includes(c))) mine++
      }
      if (mine >= 5) {
        score -= 16
        warnings.push(`${mine} sessions with client this week`)
      }
    }
    // turnaround check vs the staff member's neighbouring bookings
    if (cfg?.backfill?.turnaround !== false && date) {
      const mine = dayAppts
        .filter((a) => a.staffIds?.includes(s.id) && a.status !== 'cancelled' && !ignoreIds.includes(a.id) && occupying(a))
        .sort((x, y) => x.start - y.start)
      const prev = [...mine].reverse().find((a) => a.end <= start)
      const next = mine.find((a) => a.start >= end)
      const gapPrev = prev ? start - prev.end : Infinity
      const gapNext = next ? next.start - end : Infinity
      const near = Math.min(gapPrev, gapNext)
      const other = near === gapPrev ? prev : next
      if (near <= 30) {
        if (sameSite && other?.location && other.location === sameSite) {
          score += 6 * mFit
          reasons.push('Same site before')
        } else {
          score -= 12
          warnings.push(`Tight turnaround · ${near} min`)
        }
      }
    }
    if (!reasons.length) reasons.push('Free at this time')
    out.push({ staff: s, score: Math.max(0, Math.round(score)), reasons: reasons.slice(0, 2), warnings, load: wl })
  }
  const min = cfg?.backfill?.minScore ?? 0
  return out
    .filter((x) => !cfg?.__isBackfill || x.score >= min)
    .sort((a, b) => b.score - a.score || a.load - b.load)
    .slice(0, limit)
}

/** A cancelled 1:1 with a client is a recovery target. */
export const needsCoverFor = (a) =>
  a.status === 'cancelled' && !a.backfillIgnored && (a.type === 'service' || a.type === 'evaluation') && (a.clientIds || []).length > 0

/** Scan a date range for cancelled sessions that could be re-staffed right now. */
export function scanNeedsCover(state, days) {
  const cfg = { ...smartCfg(state.settings), backfill: { ...smartCfg(state.settings).backfill }, __isBackfill: true }
  const set = new Set(days)
  const load = weekLoad(state.appts, days)
  const out = []
  for (const a of Object.values(state.appts)) {
    if (!set.has(a.date) || !needsCoverFor(a)) continue
    const candidates = suggestStaff({
      staff: state.staff,
      teams: state.teams,
      clients: state.clients,
      appts: state.appts,
      clientIds: a.clientIds,
      date: a.date,
      start: a.start,
      end: a.end,
      exclude: a.staffIds || [],
      ignoreIds: [a.id],
      load,
      limit: cfg.backfill.count,
      cfg,
      code: a.billing?.code || '',
      sameSite: a.location || '',
      weekDays: days,
    })
    if (candidates.length) out.push({ appt: a, candidates })
  }
  return out.sort((x, y) => (x.appt.date === y.appt.date ? x.appt.start - y.appt.start : x.appt.date < y.appt.date ? -1 : 1))
}

/** Candidates for re-staffing one specific (cancelled) appointment. */
export function backfillFor(state, appt, days) {
  const cfg = smartCfg(state.settings)
  const wk = days || [appt.date]
  return suggestStaff({
    staff: state.staff,
    teams: state.teams,
    clients: state.clients,
    appts: state.appts,
    clientIds: appt.clientIds || [],
    date: appt.date,
    start: appt.start,
    end: appt.end,
    exclude: appt.staffIds || [],
    ignoreIds: [appt.id],
    load: weekLoad(state.appts, wk),
    limit: cfg.backfill.count,
    cfg: { ...cfg, __isBackfill: true },
    code: appt.billing?.code || '',
    sameSite: appt.location || '',
    weekDays: wk,
  })
}
