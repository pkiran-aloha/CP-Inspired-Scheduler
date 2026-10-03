// ---- Authorization budget: schedule against the hours a payer actually approved ----
//
// ABA authorizations are a *finite, consumable pool of units tied to a date range*,
// not a per-visit approval. Two failure modes cost practices money and are entirely
// avoidable at the moment of booking:
//
//   · booking past the remaining authorized time → the payer denies the overage
//   · letting an authorization lapse (or expire) un-renewed → the same, plus a
//     renewal request built on a thin month of data
//
// This engine is the scheduling side of that ledger. It is deliberately separate from
// `claims.js` (which refuses to *bill* outside a window): here the question is what
// happens to the client's authorization if this session is added.
//
// Honest scope: the authorization on file is `client.authWeekly` hours per week across
// `authStart → authEnd`, which is the only authorization model this workspace stores.
// Nothing here contacts a payer, and the window total is explicitly an estimate
// (weekly hours × weeks on file), never a claim about units a payer has granted.
import { addDays, isoDate, parseISO, startOfWeek, todayISO } from './date'

export const AUTH_GUARD_DEFAULTS = {
  mode: 'warn', // 'off' | 'flag' | 'warn' | 'stop'
  warnAtPct: 85, // remaining budget consumed → warn
  blockAtPct: 100, // requested total over this % of the window budget → stop in 'stop' mode
  expiryWarnDays: 30, // renewal-window alert (industry guidance: start the packet at 30 days)
  expiryUrgentDays: 14,
  underPacePct: 70, // delivered pace below this share of the authorized weekly hours
  paceLookbackDays: 28, // window used to project exhaustion
}

export const AUTH_MODES = [
  { id: 'off', label: 'Off', hint: 'No authorization checks on the calendar' },
  { id: 'flag', label: 'Flag', hint: 'Record the issue quietly; the booking saves as usual' },
  { id: 'warn', label: 'Warn', hint: 'Show the issue in the booking dialog; the booking still saves' },
  { id: 'stop', label: 'Stop', hint: 'Refuse a booking that spends past the authorization or outside its window' },
]

export const authGuardCfg = (settings) => ({ ...AUTH_GUARD_DEFAULTS, ...(settings?.authGuard || {}) })

const CLINICAL_TYPES = ['service', 'evaluation', 'supervision']
const SEVERITY = ['ok', 'flag', 'warn', 'stop']
const worse = (a, b) => (SEVERITY.indexOf(a) >= SEVERITY.indexOf(b) ? a : b)

/** Sessions that draw on the client's authorized ABA time.
 *  Clinical types count; a session explicitly marked *outside* ABA hours (`abaHr === false`)
 *  does not; travel and breaks never do. Records predating the ⚡ field count (undefined ≠ false). */
export const consumesAuth = (a) =>
  Boolean(a) && CLINICAL_TYPES.includes(a.type) && a.abaHr !== false && a.status !== 'cancelled'

/** Hours a single appointment draws from the authorization. */
export const authHoursOf = (a) => (consumesAuth(a) ? Math.max(0, (a.end || 0) - (a.start || 0)) / 60 : 0)

const round2 = (n) => Math.round(n * 100) / 100
const daysBetweenISO = (a, b) => Math.round((parseISO(b) - parseISO(a)) / 86400000)

/** The week (per the practice's week start) that contains `dateISO`. */
export function authWeekOf(dateISO, weekStartsOn = 0) {
  const start = isoDate(startOfWeek(parseISO(dateISO), weekStartsOn))
  const end = isoDate(addDays(parseISO(start), 6))
  return { start, end }
}

/** The authorization on file for a client, as a set of dated facts. */
export function clientAuthWindow(client, today = todayISO()) {
  const weekly = Number(client?.authWeekly)
  const start = client?.authStart || ''
  const end = client?.authEnd || ''
  const hasWindow = Boolean(start && end)
  const weeks = hasWindow ? Math.max(0, daysBetweenISO(start, end)) / 7 : 0
  // the window may already be open-ended on the left (a client imported mid-cycle):
  // count only the part of the window that is not in the past when estimating
  const live = hasWindow && end >= today
  return {
    start,
    end,
    hasWindow,
    live,
    weeks: Math.round(weeks * 10) / 10,
    authorizedHours: hasWindow ? round2(weekly * weeks) : 0,
    weeklyHours: Number.isFinite(weekly) ? weekly : 0,
    daysToExpiry: end ? daysBetweenISO(today, end) : null,
    daysIntoTarget: start ? daysBetweenISO(start, today) : null,
    number: client?.authNo || '',
  }
}

const sumHours = (list) => round2(list.reduce((t, a) => t + authHoursOf(a), 0))
const clientList = (appts, clientId, excludeIds) =>
  Object.values(appts).filter((a) => (a.clientIds || []).includes(clientId) && !excludeIds.includes(a.id))

/**
 * Burn-down for one client.
 *
 * `delivered` is time already rendered (past dates, not cancelled); `scheduled` is the
 * future bookings on the calendar. Both draw on the same pool. `pace` compares the
 * *booking week* that contains `on` against the authorized weekly hours, which is the
 * number a payer actually audits month to month.
 */
export function authBurn(state, clientId, { today = todayISO(), exclude = [], extra = [], on = null, weekStartsOn } = {}) {
  const client = (state.clients || []).find((c) => c.id === clientId)
  const win = clientAuthWindow(client, today)
  const ws = weekStartsOn ?? state.settings?.weekStart ?? 0
  // ONLY sessions dated inside the on-file window draw on this authorization. A session
  // booked before the window opened (or after it closes) belongs to another authorization
  // — counting it here would double-spend hours the payer never attached to this one.
  const inWindow = (a) => Boolean(a.date) && a.date >= win.start && a.date <= win.end
  const rows = clientList(apptsOf(state), clientId, exclude).filter(inWindow)
  const extraRows = extra.filter(inWindow)
  const delivered = sumHours(rows.filter((a) => a.date < today))
  const scheduled = sumHours(rows.filter((a) => a.date >= today))
  const extraHours = sumHours(extraRows)

  const weekDate = on || today
  const { start: weekStart, end: weekEnd } = authWeekOf(weekDate, ws)
  const weekRows = rows.filter((a) => a.date >= weekStart && a.date <= weekEnd)
  const weekHours = round2(sumHours(weekRows) + sumHours(extraRows.filter((a) => a.date >= weekStart && a.date <= weekEnd)))

  const committed = round2(delivered + scheduled + extraHours)
  const remaining = round2(win.authorizedHours - committed)
  const pct = win.authorizedHours > 0 ? Math.round((committed / win.authorizedHours) * 100) : 0

  // projection: which date does the authorization run dry at the recent booking pace?
  const lookback = authGuardCfg(state.settings).paceLookbackDays
  const from = isoDate(addDays(parseISO(today), -lookback))
  const recent = sumHours(rows.filter((a) => a.date >= from && a.date < today))
  const futureHours = rows
    .filter((a) => a.date >= today)
    .reduce((t, a) => t + authHoursOf(a), 0)
  const recentRate = recent / (lookback / 7) // hours per week, delivered
  // hours already on the calendar, spread over the booking horizon they actually cover
  const lastFuture = rows.filter((a) => a.date >= today && authHoursOf(a) > 0).reduce((mx, a) => (a.date > mx ? a.date : mx), today)
  const horizonWeeks = Math.max(1, Math.min(26, Math.round((parseISO(lastFuture) - parseISO(today)) / (7 * 86400000))))
  const bookedRate = futureHours / horizonWeeks
  const paceRate = Math.max(recentRate, bookedRate)
  const weeksLeft = paceRate > 0 ? remaining / paceRate : null
  const projectedEmpty = remaining > 0 && weeksLeft != null && weeksLeft < 260 ? isoDate(addDays(parseISO(today), Math.round(weeksLeft * 7))) : null

  const weeklyPct = win.weeklyHours > 0 ? Math.round((weekHours / win.weeklyHours) * 100) : 0
  const band = authBand({ win, remaining, pct, weeklyPct, today, cfg: authGuardCfg(state.settings) })

  return {
    client,
    clientId,
    window: win,
    deliveredHours: delivered,
    scheduledHours: scheduled,
    committedHours: committed,
    remainingHours: remaining,
    pct,
    week: { start: weekStart, end: weekEnd, hours: weekHours, cap: win.weeklyHours, pct: weeklyPct },
    weeklyPct,
    pace: { recentWeekly: round2(recentRate), bookedWeekly: round2(bookedRate), effectiveWeekly: round2(paceRate), projectedEmpty },
    band,
    sessions: rows.length,
  }
}

const apptsOf = (state) => state.appts || {}

/**
 * The single classification the calendar, the panel and the booking dialog all read,
 * so a client is never "at risk" in one place and "fine" in another.
 */
export function authBand({ win, remaining, pct, weeklyPct, today, cfg = AUTH_GUARD_DEFAULTS }) {
  if (!win.hasWindow) return 'no-auth'
  if (win.end < today) return 'lapsed'
  if (remaining < 0 || pct > 100) return 'over'
  if (win.daysToExpiry != null && win.daysToExpiry <= cfg.expiryUrgentDays) return 'expiring'
  if ((remaining === 0 && pct >= 100) || pct >= cfg.warnAtPct) return 'watch'
  if (weeklyPct > 100) return 'over'
  if (win.daysToExpiry != null && win.daysToExpiry <= cfg.expiryWarnDays) return 'expiring'
  if (weeklyPct < cfg.underPacePct && win.daysIntoTarget > 7) return 'under'
  return 'ok'
}

export const AUTH_BANDS = {
  over: { label: 'Over authorization', tone: 'danger', blurb: 'Booked time exceeds the hours on file' },
  lapsed: { label: 'Authorization lapsed', tone: 'danger', blurb: 'The window has ended — new sessions will deny' },
  expiring: { label: 'Renewal due', tone: 'warn', blurb: 'Expires soon; start the re-authorization packet' },
  watch: { label: 'Near the cap', tone: 'warn', blurb: 'Most of the authorized time is already committed' },
  under: { label: 'Under-scheduled', tone: 'info', blurb: 'Delivering well below the authorized week' },
  ok: { label: 'On track', tone: 'ok', blurb: 'Within the authorized hours' },
  'no-auth': { label: 'No window on file', tone: 'warn', blurb: 'Cannot verify hours without an authorization window' },
}

/**
 * Would this draft draw the client past their authorization?
 *
 * Returns a decision the dialog can render verbatim:
 *   { severity: 'ok'|'flag'|'warn'|'stop', blocked, headline, reasons[], stats }
 * `cfg.mode` caps how loud the answer may get — the practice decides whether the
 * scheduler is told, warned, or actually stopped.
 */
export function authCheckFor(state, client, draft = {}, { today = todayISO() } = {}) {
  const cfg = authGuardCfg(state.settings)
  const probe = {
    id: draft.id || '__draft__',
    date: draft.date,
    start: draft.start,
    end: draft.end,
    type: draft.type,
    abaHr: draft.abaHr,
    status: draft.status || 'active',
    clientIds: [client?.id || draft.clientId],
  }
  const idle = { severity: 'ok', blocked: false, headline: '', reasons: [], notes: [], stats: null, mode: cfg.mode, skipped: false }
  if (cfg.mode === 'off' || !client || !draft.date) return idle
  if (!CLINICAL_TYPES.includes(probe.type)) return idle

  // A clinical session explicitly marked as *outside* the client's ABA hours does not draw
  // on the authorization — but a scheduler placing clinical time inside a live window
  // should be told that, because untracked hours are the quiet half of an overrun. This is
  // a one-click fix (tick ⚡ ABA Hr), never a refusal.
  if (!consumesAuth(probe)) {
    const burn = authBurn(state, client.id, { today, exclude: probe.id === '__draft__' ? [] : [probe.id], on: probe.date })
    if (!burn.window.hasWindow) return idle
    return {
      severity: 'flag',
      blocked: false,
      skipped: true,
      headline: 'Not drawn against the authorization',
      reasons: [
        `This session is not marked as ABA hours, so it will not count against ${client.name}'s authorization (${burn.window.authorizedHours} h on file, ending ${burn.window.end}). Tick ⚡ ABA Hr if the payer should be billed for it.`,
      ],
      notes: [`${burn.committedHours} h of the authorization is committed by sessions that are marked as ABA hours.`],
      stats: burn,
      mode: cfg.mode,
    }
  }

  const burn = authBurn(state, client.id, {
    today,
    exclude: probe.id === '__draft__' ? [] : [probe.id],
    extra: [probe],
    on: probe.date,
  })
  const win = burn.window
  // `reasons` escalate the severity — they are problems with *this* booking.
  // `notes` are advisory colour (pacing, projections) and never change the outcome.
  const reasons = []
  const notes = []
  let severity = 'ok'

  if (!win.hasWindow) {
    reasons.push('No authorization window on file for this client — hours cannot be verified. Record the window before the session is billed.')
    severity = worse(severity, 'flag')
  } else {
    if (probe.date > win.end) {
      reasons.push(`This date falls after the authorization ends (${win.end}). The session would not be payable as scheduled.`)
      severity = worse(severity, 'stop')
    }
    if (probe.date < win.start) {
      reasons.push(`This date falls before the authorization starts (${win.start}).`)
      severity = worse(severity, 'flag')
    }
    if (burn.remainingHours < 0) {
      const over = Math.abs(burn.remainingHours)
      reasons.push(`Spends past the authorization by ${round2(over)} h — ${burn.committedHours} h committed against ${win.authorizedHours} h on file (${burn.pct}%).`)
      severity = worse(severity, burn.pct >= cfg.blockAtPct ? 'stop' : 'warn')
    } else if (burn.pct >= cfg.warnAtPct) {
      reasons.push(`${burn.pct}% of the authorization is committed — ${burn.remainingHours} h left before it is exhausted.`)
      severity = worse(severity, 'warn')
    }
    if (burn.week.cap > 0 && burn.week.hours > burn.week.cap) {
      reasons.push(`${round2(burn.week.hours)} h booked in the week of ${burn.week.start} against ${burn.week.cap} h/week authorized.`)
      severity = worse(severity, 'warn')
    }
    if (win.daysToExpiry != null && win.daysToExpiry >= 0 && win.daysToExpiry <= cfg.expiryUrgentDays) {
      reasons.push(`Authorization expires in ${win.daysToExpiry} day${win.daysToExpiry === 1 ? '' : 's'} (${win.end}) — sessions after that date deny.`)
      severity = worse(severity, 'warn')
    } else if (win.daysToExpiry != null && win.daysToExpiry > 0 && win.daysToExpiry <= cfg.expiryWarnDays) {
      reasons.push(`Authorization expires ${win.end} — ${win.daysToExpiry} days away. Start the renewal packet.`)
      severity = worse(severity, 'flag')
    }
    if (burn.pace.projectedEmpty && burn.remainingHours > 0 && burn.pace.effectiveWeekly > 0) {
      notes.push(`At the current pace (${burn.pace.effectiveWeekly} h/week) the authorized hours run out around ${burn.pace.projectedEmpty}.`)
    }
    if (burn.week.pct < cfg.underPacePct && win.daysIntoTarget > 7 && burn.remainingHours > 0 && !reasons.length) {
      notes.push(`Under-authorized pacing: ${burn.week.hours} h booked this week against ${win.weeklyHours} h/week authorized. Chronic under-delivery is used to justify a smaller renewal.`)
    }
  }

  if (!reasons.length && !notes.length) return { ...idle, headline: 'Within the authorized hours', stats: burn }

  // the practice's mode caps the loudest answer the guard may give
  const capped = cfg.mode === 'stop' ? severity : cfg.mode === 'warn' ? (severity === 'stop' ? 'warn' : severity) : severity === 'ok' ? 'ok' : 'flag'
  const headline = {
    stop: 'Authorization would be exceeded',
    warn: 'Authorization warning',
    flag: 'Authorization flagged',
    ok: 'Within the authorized hours',
  }[capped]
  return { severity: capped, blocked: capped === 'stop', headline, reasons, notes, stats: burn, mode: cfg.mode }
}

/** Every client's authorization position, most urgent first — the panel's table. */
export function authBoard(state, { today = todayISO(), limit = 200 } = {}) {
  const rank = { lapsed: 0, over: 1, expiring: 2, 'no-auth': 3, watch: 4, under: 5, ok: 6 }
  const rows = (state.clients || [])
    .map((c) => ({ ...authBurn(state, c.id, { today }), name: c.name, insurer: c.insurer || '—', avatar: c.avatar, color: c.color, initials: c.initials }))
    .filter((r) => r.sessions > 0 || r.window.hasWindow)
    .sort((a, b) => rank[a.band] - rank[b.band] || a.remainingHours - b.remainingHours || (a.window.daysToExpiry ?? 999) - (b.window.daysToExpiry ?? 999))
  const count = (band) => rows.filter((r) => r.band === band).length
  return {
    rows: rows.slice(0, limit),
    summary: {
      tracked: rows.length,
      lapsed: count('lapsed'),
      over: count('over'),
      expiring: count('expiring'),
      watch: count('watch'),
      under: count('under'),
      noAuth: count('no-auth'),
      needsAction: rows.filter((r) => ['lapsed', 'over', 'expiring', 'no-auth'].includes(r.band)).length,
      authorizedHours: round2(rows.reduce((t, r) => t + r.window.authorizedHours, 0)),
      committedHours: round2(rows.reduce((t, r) => t + r.committedHours, 0)),
    },
  }
}
