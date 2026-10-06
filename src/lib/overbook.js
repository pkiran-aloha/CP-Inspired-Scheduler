// ---- Overbooking guidance (C4): which blocks usually lose a session? ----
//
// A backtest over this practice's own ledger, per office × weekday × time band:
// "in 10 of the last 12 Tuesdays 15:00–18:00 at least one session was lost". When a
// block loses a session often enough, one extra session booked into that block (on a
// clinician who is free then, or a floater) would usually have found someone to run it.
//
// What this is NOT, and the UI says so:
//   · never two clients on one clinician. 97153 is one patient face to face; overlapping
//     sessions by one rendering provider are what payer audits recover money for.
//   · never per family. Guidance is about blocks; scoring families for overbooking tends
//     to overbook the families who already have the hardest time getting to sessions.
//   · advisory only. Nothing is booked, moved or sent.
//
// Two checks must both clear the threshold (default 80%, `settings.risk.overbookSafePct`):
//   1. backtest — share of rated weeks in which the block lost at least k sessions;
//   2. this week — binomial P(at least k lost | sessions booked on the next such day,
//      block loss rate shrunk toward the practice rate). The binomial assumes losses are
//      independent, the backtest does not, so each guards the other.
// Cancellation timing is not recorded, so family cancellations of any notice count as
// lost: the rate with them is an upper bound, and the no-show-only rate is shown beside it.
import { addDays, isoDate, parseISO, todayISO } from './date'
import { isCancelStatus } from './settingsMasters'
import { isPracticeCancel } from './cancelReasons'
import { authBurn } from './authBudget'
import { riskCfg, riskTimeBand } from './risk'

export const OVERBOOK_DEFAULTS = { overbookSafePct: 80, overbookWeeks: 12, overbookMinWeeks: 8 }
const CLINICAL = ['service', 'evaluation', 'supervision']
const BANDS = ['early', 'morning', 'midday', 'afternoon', 'evening']
const round2 = (n) => Math.round(n * 100) / 100

const isLost = (a, settings) => a.status === 'no-show' || a.status === 'cancelled' || isCancelStatus(settings, a.status)
const isResolved = (a, settings) => a.status === 'completed' || isLost(a, settings)
const isSession = (a) => CLINICAL.includes(a.type) && (a.clientIds || []).length > 0

/** P(X >= k) for X ~ Binomial(n, p). */
export function atLeast(k, n, p) {
  if (k <= 0) return 1
  if (k > n || p <= 0) return 0
  if (p >= 1) return 1
  let below = 0
  let term = Math.pow(1 - p, n) // P(X = 0)
  for (let i = 0; i < k; i++) {
    below += term
    term = (term * (n - i) * p) / ((i + 1) * (1 - p))
  }
  return Math.max(0, Math.min(1, 1 - below))
}

/** Sessions a block needs for P(at least one lost) to reach `safe` at loss rate p. */
export const sessionsNeeded = (p, safe) => (p > 0 && p < 1 ? Math.ceil(Math.log(1 - safe) / Math.log(1 - p)) : null)

/** The next date on or after `today` that falls on weekday `dow`. */
const nextOn = (dow, today) => {
  const d = parseISO(today)
  return isoDate(addDays(d, (dow - d.getDay() + 7) % 7))
}

/**
 * Overbooking guidance for the whole practice.
 * Returns `{ blocks, split, summary, cfg, note }`; each block carries its own evidence.
 */
export function overbookBoard(state, { today = todayISO() } = {}) {
  const settings = state.settings
  const cfg = { ...OVERBOOK_DEFAULTS, ...riskCfg(settings) }
  const safe = cfg.overbookSafePct / 100
  const from = isoDate(addDays(parseISO(today), -7 * cfg.overbookWeeks))
  const clientOffice = Object.fromEntries((state.clients || []).map((c) => [c.id, c.office || '']))
  const officeOf = (a) => clientOffice[(a.clientIds || [])[0]] || ''
  const appts = Object.values(state.appts || {})

  // practice cancellations (staff illness, scheduling error) say nothing about how often families miss
  const history = appts.filter((a) => a.date >= from && a.date < today && isSession(a) && isResolved(a, settings) && !isPracticeCancel(a))
  const split = new Set(history.map(officeOf)).size > 1
  const lostAll = history.filter((a) => isLost(a, settings)).length
  const base = (lostAll + 1) / (history.length + 2)

  const groups = {}
  for (const a of history) {
    const office = split ? officeOf(a) : ''
    const dow = parseISO(a.date).getDay()
    const band = riskTimeBand(a.start)
    const g = (groups[`${office}|${dow}|${band}`] ||= { office, dow, band, days: {} })
    const d = (g.days[a.date] ||= { n: 0, lost: 0, noShow: 0 })
    d.n++
    if (isLost(a, settings)) d.lost++
    if (a.status === 'no-show') d.noShow++
  }

  const blocks = Object.entries(groups).map(([key, g]) => {
    const days = Object.values(g.days)
    const sessions = days.reduce((t, d) => t + d.n, 0)
    const lost = days.reduce((t, d) => t + d.lost, 0)
    const noShows = days.reduce((t, d) => t + d.noShow, 0)
    const rate = (lost + cfg.shrinkCohort * base) / (sessions + cfg.shrinkCohort)
    const date = nextOn(g.dow, today)
    const booked = appts.filter(
      (a) => a.date === date && isSession(a) && !isLost(a, settings) && riskTimeBand(a.start) === g.band && (!split || officeOf(a) === g.office),
    ).length
    const checks = [1, 2].map((k) => {
      const hit = days.filter((d) => d.lost >= k).length
      return { k, hit, histPct: days.length ? hit / days.length : 0, prob: atLeast(k, booked, rate) }
    })
    const rated = days.length >= cfg.overbookMinWeeks
    const safeK = rated ? checks.filter((c) => c.histPct >= safe && c.prob >= safe).reduce((m, c) => Math.max(m, c.k), 0) : 0
    const perWeek = Math.round((sessions / Math.max(1, days.length)) * 10) / 10
    const need = sessionsNeeded(rate, safe)
    const best = checks[Math.max(0, safeK - 1)]
    const why = !rated
      ? `Only ${days.length} week${days.length === 1 ? '' : 's'} with sessions here in the last ${cfg.overbookWeeks}; needs ${cfg.overbookMinWeeks}.`
      : safeK
        ? `In ${best.hit} of the last ${days.length} weeks at least ${safeK === 1 ? 'one session was' : 'two sessions were'} lost here. With ${booked} booked on ${date}, the chance of ${safeK === 1 ? 'one' : 'two'} or more lost is ${Math.round(best.prob * 100)}%.`
        : `A session was lost in ${checks[0].hit} of ${days.length} weeks. About ${perWeek} session${perWeek === 1 ? '' : 's'} a week here${need ? `; at this loss rate a block needs about ${need} for ${cfg.overbookSafePct}% confidence` : ''} (${booked} booked on ${date}).`
    return {
      key,
      office: g.office,
      dow: g.dow,
      band: g.band,
      rated,
      weeks: days.length,
      sessions,
      lost,
      noShows,
      rate: round2(rate),
      rateNoShow: round2(sessions ? noShows / sessions : 0),
      perWeek,
      need,
      next: { date, booked },
      checks: checks.map((c) => ({ ...c, histPct: round2(c.histPct), prob: round2(c.prob) })),
      safeK,
      status: !rated ? 'thin' : safeK ? 'safe' : 'not',
      why,
      standby: [],
    }
  })

  // standby (block-level, never a family score): clients behind their authorized pace with
  // nothing booked in that block on its next day — the families to offer an extra session first
  const safeBlocks = blocks.filter((b) => b.safeK)
  if (safeBlocks.length) {
    const behind = (state.clients || [])
      .filter((c) => c.status !== 'inactive' && c.status !== 'discharged')
      .map((c) => ({ c, burn: authBurn(state, c.id, { today }) }))
      .filter((r) => r.burn.band === 'under')
      .sort((x, y) => x.burn.week.pct - y.burn.week.pct)
    for (const b of safeBlocks) {
      b.standby = behind
        .filter(({ c }) => !split || (c.office || '') === b.office)
        .filter(({ c }) => !appts.some((a) => a.date === b.next.date && (a.clientIds || []).includes(c.id) && riskTimeBand(a.start) === b.band && !isLost(a, settings)))
        .slice(0, 3)
        .map(({ c, burn }) => ({ clientId: c.id, name: c.name, weekPct: burn.week.pct }))
    }
  }

  blocks.sort((x, y) => y.safeK - x.safeK || (x.status === 'thin') - (y.status === 'thin') || x.dow - y.dow || BANDS.indexOf(x.band) - BANDS.indexOf(y.band) || x.office.localeCompare(y.office))
  return {
    blocks,
    split,
    summary: { safe: safeBlocks.length, rated: blocks.filter((b) => b.rated).length, thin: blocks.filter((b) => !b.rated).length, sessions: history.length, lost: lostAll, base: round2(base) },
    cfg: { safePct: cfg.overbookSafePct, weeks: cfg.overbookWeeks, minWeeks: cfg.overbookMinWeeks },
    note: `Backtest over ${history.length} resolved sessions in the last ${cfg.overbookWeeks} weeks (practice cancellations left out).`,
  }
}
