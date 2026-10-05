// ---- Scheduler insights: one board a scheduler opens when the day is already full ----
//
// Four questions, answered from the same ledger and in the same place:
//   1. Where is the week actually full, and where is capacity sitting idle?      → coverage
//   2. Which sessions can be pulled into a denser same-day block?                → density
//   3. Which clients are about to run out of authorized hours or lose a renewal? → auth
//   4. Which of these sessions is most likely to evaporate?                      → risk
//
// Pure and deterministic: the panel renders it, the tests assert on it, and no number
// here is invented — every figure traces to an appointment, an authorization or staff
// availability in the workspace.
import { addDays, isoDate, parseISO, todayISO } from './date'
import { overlapsType, computeBilling, TYPES } from './model'
import { authBoard } from './authBudget'
import { densityBoard } from './density'
import { riskQueue, riskHourOf } from './risk'

const round1 = (n) => Math.round(n * 10) / 10
const HOUR_LABEL = (h) => `${String(h % 24).padStart(2, '0')}:00`

// what a scheduler means by "a session": time in front of a client
const CLINICAL = ['service', 'evaluation', 'supervision']
export const CLINICAL_LABEL = { service: 'Service', evaluation: 'Evaluation', supervision: 'Supervision' }

const overlapsHour = (a, h) => a.start < (h + 1) * 60 && h * 60 < a.end
/** Anything that takes a clinician off the market: sessions, travel and blocked-out time. */
const blockingType = (a) => overlapsType(a) || a.type === 'unavailable' || a.type === 'break'

/** Contiguous clock time where one clinician has nothing at all on their calendar. */
function idleWindows(date, staff, list, { wdStart, span, minHours = 1 }) {
  const out = []
  for (const s of staff) {
    const mine = list.filter((a) => (a.staffIds || []).includes(s.id) && blockingType(a))
    let run = null
    for (let i = 0; i <= span; i++) {
      const h = wdStart + i
      const busy = i < span && mine.some((a) => overlapsHour(a, h))
      if (busy || i === span) {
        if (run && run.to - run.from >= minHours) {
          out.push({ date, staffId: s.id, staffName: s.name, role: s.role || '', from: run.from, to: run.to, hours: run.to - run.from })
        }
        run = null
      } else {
        run = run ? { from: run.from, to: h + 1 } : { from: h, to: h + 1 }
      }
    }
  }
  return out
}

/**
 * Capacity truth for a range: staff-minutes sold vs staff-minutes that existed.
 *
 * "Available" is modelled as every active staff member's working day
 * (`settings.workday`), minus time they have explicitly blocked out. Everything else on
 * their calendar is sold time, whether or not it is billable — travel and breaks occupy
 * a clinician just as firmly as a session does.
 */
export function coverageBoard(state, days, { today = todayISO(), minGapHours = 1, gapLimit = 12 } = {}) {
  void today
  const [wdStart, wdEnd] = state.settings?.workday || [8, 18]
  const span = Math.max(1, wdEnd - wdStart)
  const staff = (state.staff || []).filter((s) => s.status !== 'inactive')
  const byDate = {}
  for (const a of Object.values(state.appts || {})) {
    if (a.status === 'cancelled') continue
    byDate[a.date] = byDate[a.date] || []
    byDate[a.date].push(a)
  }

  const grid = Array.from({ length: 7 }, () => Array.from({ length: span }, () => ({ booked: 0, available: 0, sessions: 0 })))
  const perDay = []
  const gaps = []

  for (const date of days) {
    const list = byDate[date] || []
    const dow = parseISO(date).getDay()
    let dayBooked = 0
    let dayAvailable = 0

    for (let h = wdStart; h < wdEnd; h++) {
      const hs = h * 60
      const he = hs + 60
      let available = 0
      let booked = 0
      for (const s of staff) {
        const mine = list.filter((a) => (a.staffIds || []).includes(s.id) && a.start < he && hs < a.end)
        if (mine.some((a) => !overlapsType(a))) continue // blocked out — never sellable time
        available += 60
        const sold = mine.filter(overlapsType)
        if (sold.length) booked += Math.min(60, sold.reduce((t, a) => t + (Math.min(a.end, he) - Math.max(a.start, hs)), 0))
      }
      const cell = grid[dow][h - wdStart]
      cell.booked += booked
      cell.available += available
      cell.sessions += list.filter((a) => CLINICAL.includes(a.type) && overlapsHour(a, h)).length
      dayBooked += booked
      dayAvailable += available
    }

    const windows = idleWindows(date, staff, list, { wdStart, span, minHours: minGapHours })
    gaps.push(...windows)
    perDay.push({
      date,
      dow,
      bookedHours: round1(dayBooked / 60),
      availableHours: round1(dayAvailable / 60),
      fillPct: dayAvailable ? Math.round((dayBooked / dayAvailable) * 100) : 0,
      sessions: list.filter((a) => CLINICAL.includes(a.type)).length,
      idleStaff: new Set(windows.map((g) => g.staffId)).size,
    })
  }

  const ranked = [...gaps].sort((a, b) => b.hours - a.hours || (a.date < b.date ? -1 : a.date > b.date ? 1 : a.from - b.from))
  const totalBooked = perDay.reduce((t, d) => t + d.bookedHours, 0)
  const totalAvailable = perDay.reduce((t, d) => t + d.availableHours, 0)
  const cellFill = (c) => (c.available ? Math.round((c.booked / c.available) * 100) : 0)

  return {
    grid: grid.map((row) => row.map((c) => ({ ...c, bookedHours: round1(c.booked / 60), availableHours: round1(c.available / 60), fillPct: cellFill(c) }))),
    hourStart: wdStart,
    hourSpan: span,
    hourLabel: HOUR_LABEL,
    perDay,
    gaps: ranked.slice(0, gapLimit),
    summary: {
      bookedHours: round1(totalBooked),
      availableHours: round1(totalAvailable),
      openHours: round1(totalAvailable - totalBooked),
      fillPct: totalAvailable ? Math.round((totalBooked / totalAvailable) * 100) : 0,
      idleDays: perDay.filter((d) => d.fillPct < 40).length,
      fullDays: perDay.filter((d) => d.fillPct >= 85).length,
      idleWindows: ranked.length,
      idleStaff: new Set(ranked.map((g) => g.staffId)).size,
    },
  }
}

/**
 * Everything the Scheduler Insights panel shows, in one object.
 * `days` is the visible range, so the panel always speaks about what the user is looking at.
 */
export function insightBoard(state, days, { today = todayISO() } = {}) {
  const coverage = coverageBoard(state, days, { today })
  const density = densityBoard(state, days, { today })
  const auth = authBoard(state, { today })
  const risk = riskQueue(state, days, { today })
  const list = Object.values(state.appts || {}).filter((a) => days.includes(a.date) && a.status !== 'cancelled')
  const charge = list.filter((a) => TYPES[a.type]?.billable).reduce((t, a) => t + computeBilling(a), 0)
  const staffedHours = list.filter(overlapsType).reduce((t, a) => t + riskHourOf(a) * Math.max(1, (a.staffIds || []).length), 0)

  return {
    days,
    today,
    coverage,
    density,
    auth,
    risk,
    kpis: [
      { id: 'fill', label: 'Schedule fill', value: `${coverage.summary.fillPct}%`, sub: `${coverage.summary.bookedHours} of ${coverage.summary.availableHours} staff-hours`, tone: coverage.summary.fillPct >= 85 ? 'warn' : coverage.summary.fillPct < 40 ? 'info' : 'ok' },
      { id: 'open', label: 'Open capacity', value: `${coverage.summary.openHours}h`, sub: `${coverage.summary.idleWindows} bookable window${coverage.summary.idleWindows === 1 ? '' : 's'} across ${coverage.summary.idleStaff} staff`, tone: 'info' },
      { id: 'auth', label: 'Auth action', value: `${auth.summary.needsAction}`, sub: `${auth.summary.expiring} renewal${auth.summary.expiring === 1 ? '' : 's'} due · ${auth.summary.over + auth.summary.lapsed} over or lapsed`, tone: auth.summary.needsAction ? 'warn' : 'ok' },
      { id: 'risk', label: 'At-risk sessions', value: `${risk.summary.flagged}`, sub: `≈${risk.summary.expectedLostHours} h expected to be lost`, tone: risk.summary.high ? 'danger' : risk.summary.flagged ? 'warn' : 'ok' },
    ],
    totals: { scheduledCharge: Math.round(charge), staffedHours: round1(staffedHours), sessions: list.filter(overlapsType).length },
  }
}

/** The next N days from `today` — the panel's default range when the calendar shows one day. */
export const forwardDays = (n, today = todayISO()) => Array.from({ length: n }, (_, i) => isoDate(addDays(parseISO(today), i)))
