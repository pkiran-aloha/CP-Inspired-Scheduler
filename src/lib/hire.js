// ---- D2: hire / contract decision support ---------------------------------
//
// The question: before you hire, is the gap demand (too few clinical hours) or
// schedule shape (the week is idle while known work does not fit)?
// Utilization-dashboard literature: low fill plus a wait is a template problem,
// not a capacity problem.
//
// Inputs already in the workspace, never a forecast:
//   • the D1 ramp (authorized demand + intake band vs Mon–Fri supply)
//   • Coverage fill of the range on screen (booked / working day minus blocked)
//
// Demand is not split by RBT vs BCBA, so this never invents a headcount or a
// tier to hire. Advisory and read-only: nothing is hired, contracted, booked
// or sent.
//
// When the week on screen has no bookable hours, utilization is unknown and
// the panel says so instead of guessing.

export const HIRE_HIGH_UTIL = 85

const round1 = (n) => Math.round(n * 10) / 10

/**
 * @param {{ ramp: object, coverage: object }} boards
 */
export function hireBoard({ ramp, coverage } = {}) {
  const r = ramp || { weeks: [], summary: { shortWeeks: 0, firstShort: null, staff: { rbt: 0, bcba: 0, other: 0 }, clients: 0, intakeCounted: 0 } }
  const cov = coverage?.summary || { fillPct: 0, availableHours: 0, bookedHours: 0 }
  const fillPct = Number(cov.fillPct) || 0
  const availableHours = Number(cov.availableHours) || 0
  const bookedHours = Number(cov.bookedHours) || 0
  const utilKnown = availableHours > 0
  const highUtil = utilKnown && fillPct >= HIRE_HIGH_UTIL
  const staff = r.summary?.staff || { rbt: 0, bcba: 0, other: 0 }
  const staffTotal = (staff.rbt || 0) + (staff.bcba || 0) + (staff.other || 0)
  const shortWeeks = r.summary?.shortWeeks || 0
  const weeks = Array.isArray(r.weeks) ? r.weeks : []
  const firstShort = weeks.find((w) => w.start === r.summary?.firstShort) || weeks.find((w) => w.balanceHours < 0) || null
  const shortHours = firstShort && firstShort.balanceHours < 0 ? round1(-firstShort.balanceHours) : 0
  const peakShort = weeks.reduce((m, w) => (w.balanceHours < (m?.balanceHours ?? 0) ? w : m), null)
  const peakShortHours = peakShort && peakShort.balanceHours < 0 ? round1(-peakShort.balanceHours) : 0
  const knownDemand = (r.summary?.clients || 0) + (r.summary?.intakeCounted || 0) > 0

  let verdict = 'neither'
  let headline = 'Do not hire on this number'
  let reason = 'Supply covers the known demand in every week of the ramp.'

  if (staffTotal === 0 && knownDemand) {
    verdict = 'hire'
    headline = 'Hours gap: no clinical staff'
    reason = 'There are no clinical staff and known demand is on the books, so this is an hours gap. The hours short are from the ramp’s first short week. Demand is not split by RBT and BCBA, so this is not a headcount.'
  } else if (shortWeeks > 0 && !utilKnown && staffTotal > 0) {
    verdict = 'thin'
    headline = 'Not enough on-screen hours to tell'
    reason = 'The week on screen has no bookable staff hours, so utilization is unknown. This panel cannot tell a demand gap from a schedule-shape problem, and it will not invent one.'
  } else if (shortWeeks === 0) {
    verdict = 'neither'
    headline = 'Do not hire on this number'
    reason = knownDemand
      ? 'Supply covers the known demand in every week of the ramp. A hire is not what this number asks for.'
      : 'There is no known demand on the ramp yet, so there is no hours gap to hire against.'
  } else if (highUtil) {
    verdict = 'hire'
    headline = 'Hours gap: hire or contract'
    reason = `Known demand exceeds supply in ${shortWeeks} week${shortWeeks === 1 ? '' : 's'} and the range on screen is already ${fillPct}% full (≥ ${HIRE_HIGH_UTIL}%). That is an hours gap. Demand is not split by credential, so this names hours, not people.`
  } else {
    verdict = 'reshape'
    headline = 'Template problem: do not hire yet'
    reason = `Known demand exceeds supply in ${shortWeeks} week${shortWeeks === 1 ? '' : 's'}, but the range on screen is only ${fillPct}% full (below ${HIRE_HIGH_UTIL}%). Low utilization with a wait points to a template problem, not a capacity problem. Reshape the week (Density, idle windows) before hiring.`
  }

  const note =
    'Before you hire, check whether the gap is demand or schedule shape. Fill is booked staff time over the Coverage denominator (working day minus blocked time) for the range on screen. ' +
    'Demand is the ramp’s known work: authorized weekly hours plus open intake at recorded hours, never weighted by a conversion rate. Renewals are never assumed. ' +
    'Supply on the ramp is Mon–Fri. Advisory only: nothing here is hired, contracted, booked or sent.'

  return {
    verdict,
    headline,
    reason,
    fillPct,
    utilKnown,
    highUtil,
    highBar: HIRE_HIGH_UTIL,
    shortWeeks,
    firstShort: r.summary?.firstShort || null,
    shortHours,
    peakShortHours,
    peakShortStart: peakShortHours ? peakShort.start : null,
    supply: staff,
    availableHours,
    bookedHours,
    note,
  }
}
