// ---- Cancellation & no-show risk: score the book before the slot is lost ----
//
// A schedule with a 12% no-show rate is *planning at 12% capacity loss* unless someone
// works the risk. The published literature is consistent about what predicts it: the
// client's own attendance history is the strongest single signal, then lead time, the
// day/time of the session, and continuity (a new technician on the case). Alert fatigue
// is the failure mode of every reminder system, so the point of scoring is triage —
// the practice spends its phone calls on the sessions that might otherwise evaporate.
//
// What this engine is, stated plainly (the UI repeats it):
//   · a smoothed, explainable model fitted on THIS practice's own appointment ledger
//   · plus a small set of policy factors the ledger cannot learn (unconfirmed booking,
//     backfilled slot, rescheduled slot, first session with the assigned technician)
//   · a family cancellation that gave the practice more notice than its own threshold
//     (`settings.billing.lateCancelHours`) is the practice getting told in time, so it is
//     not counted against the family; an unknown notice time still is
//   · NOT machine learning, NOT a clinical judgement, and it never sends anything.
//
// Nothing leaves the browser and no message is transmitted: a "risk" here is a prompt
// for a human to phone a family, not an automated outreach.
import { parseISO, todayISO } from './date'
import { computeBilling, TYPES } from './model'
import { isCancelStatus } from './settingsMasters'
import { cancelLeadHours, cancelNoticeHoursOf, cancelSide, cancelledEarly, isPracticeCancel } from './cancelReasons'

export const RISK_DEFAULTS = {
  enabled: true,
  confirmWindowDays: 3, // "unconfirmed close to the session" counts against a booking
  watchBand: 35, // score >= this → watch
  highBand: 60, // score >= this → high
  shrinkClient: 6, // smoothing strength for a client's own history
  shrinkCohort: 10, // smoothing strength for day-of-week / time-of-day cohorts
  leadBins: [1, 3, 7], // days-out boundaries: 0–1, 2–3, 4–7, 8+
  minSupport: 24, // resolved appointments needed before a cohort rate is trusted
}

export const riskCfg = (settings) => ({ ...RISK_DEFAULTS, ...(settings?.risk || {}) })

export const RISK_BANDS = {
  high: { label: 'High', tone: 'danger', blurb: 'Call the family before the session' },
  watch: { label: 'Watch', tone: 'warn', blurb: 'Confirm ahead of the reminder window' },
  low: { label: 'Low', tone: 'ok', blurb: 'Standard reminder is enough' },
  done: { label: 'Resolved', tone: 'muted', blurb: 'The outcome is already recorded' },
}

const isResolved = (a, settings, today) =>
  a.date < today && (a.status === 'completed' || a.status === 'no-show' || a.status === 'cancelled' || isCancelStatus(settings, a.status))

const isLost = (a, settings) => a.status === 'no-show' || isCancelStatus(settings, a.status)
const logit = (p) => Math.log(p / (1 - p))
const sigmoid = (x) => 1 / (1 + Math.exp(-x))
const clamp = (v, a, b) => Math.max(a, Math.min(b, v))
const round2 = (n) => Math.round(n * 100) / 100
const daysOutOf = (dateISO, today) => Math.round((parseISO(dateISO) - parseISO(today)) / 86400000)

// A family cancellation that gave the practice more notice than its threshold is not
// evidence that the family misses sessions — the slot could be refilled — so it stops
// counting against the client's own rate and the practice-wide base alike. Practice-side
// cancellations are never a family signal, and a cancellation whose reason is missing or
// unrecorded keeps counting: the side is read, never assumed.
const gaveNotice = (a, noticeHours) => cancelSide(a?.cancelReason) === 'client' && cancelledEarly(a, noticeHours)
const badOf = (a, settings, noticeHours) => isLost(a, settings) && !gaveNotice(a, noticeHours)

/**
 * How much notice the ledger actually records, so the panel can say how far the rule
 * bites instead of implying it is applying data it does not have.
 */
const noticeCoverage = (done, settings, noticeHours) => {
  const clientCancels = done.filter((a) => a.status !== 'no-show' && isCancelStatus(settings, a.status) && !isPracticeCancel(a))
  const dated = clientCancels.filter((a) => cancelLeadHours(a) != null)
  return {
    hours: noticeHours,
    cancellations: clientCancels.length,
    dated: dated.length,
    early: dated.filter((a) => gaveNotice(a, noticeHours)).length,
  }
}

const noticeCopy = ({ hours, cancellations, dated, early }) => {
  if (!cancellations) return 'No family cancellation is on file yet, so the notice rule has nothing to weigh.'
  const n = (v) => `${v} family cancellation${v === 1 ? '' : 's'}`
  if (!dated) return `${n(cancellations)} on file, none recording how much notice it gave. An unknown time still counts as lost, never guessed.`
  const earlyPart = early
    ? `${early} gave more than ${hours}h notice and ${early === 1 ? 'is' : 'are'} not counted against the family (the slot could be refilled).`
    : `None gave more than ${hours}h notice.`
  return `${dated} of ${cancellations} family cancellations record their notice. ${earlyPart} No-shows, and cancellations with no time recorded, still count.`
}

export const riskTimeBand = (startMin) => {
  const h = Math.floor((startMin || 0) / 60)
  if (h < 9) return 'early' // 8:00–8:59, before the school run
  if (h < 12) return 'morning'
  if (h < 15) return 'midday'
  if (h < 18) return 'afternoon'
  return 'evening'
}

export const RISK_TIME_LABEL = { early: 'early morning (before 9)', morning: 'morning (9–12)', midday: 'midday (12–15)', afternoon: 'afternoon (15–18)', evening: 'evening (after 18)' }

export const riskLeadBand = (daysOut, cfg = RISK_DEFAULTS) => {
  const [a, b, c] = cfg.leadBins
  if (daysOut <= a) return 'same'
  if (daysOut <= b) return 'soon'
  if (daysOut <= c) return 'week'
  return 'far'
}

export const RISK_LEAD_LABEL = { same: 'next day', soon: '2–3 days out', week: '4–7 days out', far: 'a week or more out' }

/**
 * Fit the model on the ledger: a base event rate plus shrunk cohort rates that a
 * score can cite. Cohorts with thin support shrink hard toward the base rate, so a
 * practice with three weeks of data does not get confident nonsense.
 */
export function riskModel(state, { today = todayISO() } = {}) {
  const cfg = riskCfg(state.settings)
  const noticeHours = cancelNoticeHoursOf(state.settings)
  const isBad = (a) => badOf(a, state.settings, noticeHours)
  const done = Object.values(state.appts || {}).filter((a) => isResolved(a, state.settings, today))
  const bad = done.filter(isBad).length
  const base = clamp((bad + 1) / (done.length + 2), 0.03, 0.55)

  const cohort = (keyOf) => {
    const acc = {}
    for (const a of done) {
      const k = keyOf(a)
      if (k == null) continue
      const g = (acc[k] = acc[k] || { n: 0, bad: 0 })
      g.n++
      if (isBad(a)) g.bad++
    }
    const out = {}
    for (const [k, g] of Object.entries(acc)) out[k] = { n: g.n, rate: (g.bad + cfg.shrinkCohort * base) / (g.n + cfg.shrinkCohort) }
    return out
  }

  // per-client history, used both as a cohort and for the continuity check. A session the
  // practice cancelled (staff illness, scheduling error) says nothing about the family.
  const clientDone = done.filter((a) => !isPracticeCancel(a))
  const byClient = {}
  for (const a of clientDone) {
    for (const cid of a.clientIds || []) {
      const g = (byClient[cid] = byClient[cid] || { n: 0, bad: 0, staff: new Set(), last: '' })
      g.n++
      if (isBad(a)) g.bad++
      for (const sid of a.staffIds || []) g.staff.add(sid)
      if (!g.last || a.date > g.last) g.last = a.date
    }
  }
  const clientRate = {}
  for (const [cid, g] of Object.entries(byClient)) clientRate[cid] = { n: g.n, rate: (g.bad + cfg.shrinkClient * base) / (g.n + cfg.shrinkClient) }

  // recent behaviour: has this client missed either of their last two resolved sessions?
  const recentByClient = {}
  for (const a of clientDone) {
    for (const cid of a.clientIds || []) {
      const g = (recentByClient[cid] = recentByClient[cid] || [])
      g.push(a)
    }
  }
  const streak = {}
  for (const [cid, list] of Object.entries(recentByClient)) {
    const last2 = list.sort((x, y) => (x.date < y.date ? 1 : -1)).slice(0, 2)
    streak[cid] = { misses: last2.filter(isBad).length, seen: last2.length }
  }

  const notice = noticeCoverage(done, state.settings, noticeHours)

  return {
    base: round2(base),
    sample: done.length,
    events: bad,
    notice,
    noticeNote: noticeCopy(notice),
    cohort: { dow: cohort((a) => String(parseISO(a.date).getDay())), time: cohort((a) => riskTimeBand(a.start)) },
    clientRate,
    history: byClient,
    streak,
    cfg,
    note:
      done.length < cfg.minSupport
        ? `Only ${done.length} completed sessions on file. Scores lean on the practice-wide rate until there is more history.`
        : `Fitted on ${done.length} completed sessions in this workspace.`,
  }
}

// Lead time cannot be learned from this ledger: it is only meaningful against the date a
// booking was *made*, and the workspace stores no booked-at stamp. Rather than fit a
// cohort on a number that does not exist, lead time is applied as an explicit policy
// band (`source: 'policy'` in the factor list), citing the published relationship.

/**
 * Score one appointment.
 *
 * Every contribution is returned with its own label and provenance (`model` = learned
 * from this workspace, `policy` = a documented rule the ledger cannot learn), so the
 * panel can show a scheduler *why* a session is flagged instead of a bare number.
 */
export function riskFor(state, appt, model = null, { today = todayISO() } = {}) {
  const cfg = riskCfg(state.settings)
  const m = model || riskModel(state, { today })
  if (!cfg.enabled) return { appt, score: 0, band: 'low', factors: [], probability: 0, action: '', model: m }

  const closed = appt.status === 'completed' || appt.status === 'no-show' || isCancelStatus(state.settings, appt.status)
  const clientId = (appt.clientIds || [])[0]
  const factors = []
  const add = (id, label, lift, detail, source) => {
    if (!lift) return
    factors.push({ id, label, lift: Math.round(lift * 100) / 100, detail, source })
  }

  const base = m.base
  const lg = logit(base)

  if (clientId) {
    const c = m.clientRate[clientId]
    if (c && c.n > 0) {
      const lift = clamp(Math.log(c.rate / base) * 0.9, -0.9, 1.0)
      if (Math.abs(lift) > 0.12) {
        add('client', 'This client’s own history', lift, `${c.n} resolved session${c.n === 1 ? '' : 's'}; ${Math.round((c.rate * 100))}% did not go ahead as booked (practice average ${Math.round(base * 100)}%).`, 'model')
      }
    } else {
      add('new-client', 'No session history yet', 0.3, 'First sessions with a family carry more uncertainty than an established routine.', 'policy')
    }
    const st = m.streak[clientId]
    if (st && st.misses >= 1 && st.seen > 1) {
      add('streak', 'Recent missed sessions', st.misses === 2 ? 0.55 : 0.3, `${st.misses} of the last ${st.seen} resolved sessions were missed or cancelled late.`, 'model')
    }
    const h = m.history[clientId]
    if (h && (appt.staffIds || []).length && !(appt.staffIds || []).some((s) => h.staff.has(s))) {
      add('continuity', 'New technician on the case', 0.35, 'No prior session with the assigned staff member. Continuity matters most for keeping families in ABA.', 'policy')
    }
  }

  const daysOut = daysOutOf(appt.date, today)
  if (daysOut >= 0) {
    const lead = riskLeadBand(daysOut, cfg)
    const leadLift = { same: -0.25, soon: -0.05, week: 0.2, far: 0.45 }[lead]
    add('lead', 'Booking lead time', leadLift, `Scheduled ${RISK_LEAD_LABEL[lead]}; longer lead times are missed more often.`, 'policy')
    if (appt.status !== 'confirmed' && daysOut <= cfg.confirmWindowDays) {
      add('unconfirmed', 'Still unconfirmed', 0.4, `Unconfirmed with ${daysOut <= 0 ? 'the session today' : `${daysOut} day${daysOut === 1 ? '' : 's'} to go`}. Call this one first.`, 'policy')
    }
  }

  const dow = String(parseISO(appt.date).getDay())
  const dowC = m.cohort.dow[dow]
  if (dowC && dowC.n >= cfg.minSupport) {
    const lift = clamp(Math.log(dowC.rate / base) * 0.7, -0.5, 0.6)
    if (Math.abs(lift) > 0.12) add('dow', 'Day of week', lift, `${['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'][Number(dow)]} are missed ${Math.round(dowC.rate * 100)}% of the time here.`, 'model')
  }
  const tb = riskTimeBand(appt.start)
  const tC = m.cohort.time[tb]
  if (tC && tC.n >= cfg.minSupport) {
    const lift = clamp(Math.log(tC.rate / base) * 0.7, -0.5, 0.6)
    if (Math.abs(lift) > 0.12) add('time', 'Time of day', lift, `${RISK_TIME_LABEL[tb].replace(/^./, (ch) => ch.toUpperCase())} sessions are missed ${Math.round(tC.rate * 100)}% of the time here.`, 'model')
  }
  if (appt.backfilled) add('backfilled', 'Backfilled slot', 0.3, 'Filled in after a cancellation, often without the family confirming the new time.', 'policy')
  if (appt.edited) add('rescheduled', 'Already rescheduled', 0.2, 'This occurrence has been moved at least once.', 'policy')

  const totalLift = factors.reduce((t, f) => t + f.lift, 0)
  const probability = clamp(sigmoid(lg + totalLift), 0.02, 0.97)
  const score = Math.round(probability * 100)
  const band = closed ? 'done' : score >= cfg.highBand ? 'high' : score >= cfg.watchBand ? 'watch' : 'low'
  const action = {
    high: 'Call the caregiver to confirm this session',
    watch: 'Confirm before the reminder window',
    low: 'Standard reminder',
    done: 'Outcome recorded',
  }[band]

  return {
    appt,
    score,
    band,
    probability,
    factors: factors.sort((x, y) => Math.abs(y.lift) - Math.abs(x.lift)),
    action,
    model: { base: m.base, sample: m.sample, note: m.note },
  }
}

/** The worklist: upcoming appointments in `days`, riskiest first, with the money at stake. */
export function riskQueue(state, days, { today = todayISO(), limit = 25 } = {}) {
  const cfg = riskCfg(state.settings)
  const model = riskModel(state, { today })
  const set = new Set(days)
  const upcoming = Object.values(state.appts || {}).filter((a) => set.has(a.date) && a.status !== 'completed' && !isCancelStatus(state.settings, a.status))
  const rows = upcoming
    .map((a) => riskFor(state, a, model, { today }))
    .filter((r) => r.band === 'high' || r.band === 'watch')
    .sort((a, b) => b.score - a.score || (a.appt.date < b.appt.date ? -1 : 1))

  const hours = (r) => ((r.appt.end || 0) - (r.appt.start || 0)) / 60
  const charge = (r) => (TYPES[r.appt.type]?.billable ? computeBilling(r.appt) : 0)
  const expectedLostHours = round2(rows.reduce((t, r) => t + r.probability * hours(r), 0))
  const chargeAtRisk = round2(rows.reduce((t, r) => t + r.probability * charge(r), 0))

  return {
    rows: rows.slice(0, limit),
    summary: {
      scored: upcoming.length,
      flagged: rows.length,
      high: rows.filter((r) => r.band === 'high').length,
      watch: rows.filter((r) => r.band === 'watch').length,
      expectedLostHours,
      chargeAtRisk,
      base: model.base,
      sample: model.sample,
      note: model.note,
      notice: model.notice,
      noticeNote: model.noticeNote,
    },
    model,
  }
}

/** Risk for one appointment, cheap enough for a calendar card. */
export function riskOf(state, appt, { today = todayISO() } = {}) {
  if (!riskCfg(state.settings).enabled) return null
  return riskFor(state, appt, null, { today })
}

export const riskHourOf = (a) => Math.max(0, ((a?.end || 0) - (a?.start || 0)) / 60)
