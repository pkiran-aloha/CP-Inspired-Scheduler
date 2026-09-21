// ---- Domain constants & pure helpers for the ABA scheduler ----
import { addDays, daysInMonth, isoDate, parseISO } from './date'

export const SNAP = 15 // minutes — grid granularity

export const TYPES = {
  service: {
    key: 'service', label: 'Service', color: '#6366f1', soft: '#eef0ff', ink: '#4338ca',
    desc: '1:1 therapy, assessment or group session with a client', icon: 'spark',
    billable: true, hasVerification: true, hasDocs: true,
  },
  drive: {
    key: 'drive', label: 'Drive Time', color: '#10b981', soft: '#e9faf2', ink: '#047857',
    desc: 'Travel to / from a home, school or community session', icon: 'car',
    billable: true, hasVerification: false, hasDocs: true,
  },
  break: {
    key: 'break', label: 'Break Time', color: '#ec4899', soft: '#fdeef6', ink: '#be185d',
    desc: 'Rest / reset between sessions — never double-books a client', icon: 'cup',
    billable: false, hasVerification: false, hasDocs: false,
  },
  unavailable: {
    key: 'unavailable', label: 'Unavailable', color: '#64748b', soft: '#eef1f6', ink: '#334155',
    desc: 'Blocked out — meetings, PTO, clinic closed', icon: 'ban',
    billable: false, hasVerification: false, hasDocs: false,
  },
  evaluation: {
    key: 'evaluation', label: 'Evaluation', color: '#8b5cf6', soft: '#f3effe', ink: '#6d28d9',
    desc: 'Intake, VB-MAPP / ABLLS-R reassessment, IEP observation', icon: 'clipboard',
    billable: true, hasVerification: true, hasDocs: true,
  },
  supervision: {
    key: 'supervision', label: 'Supervision', color: '#f59e0b', soft: '#fef4e2', ink: '#b45309',
    desc: 'BCBA supervision of RBTs / technicians', icon: 'eye',
    billable: true, hasVerification: false, hasDocs: true,
  },
}

export const STATUSES = {
  active: { key: 'active', label: 'Active', dot: '#6366f1' },
  confirmed: { key: 'confirmed', label: 'Confirmed', dot: '#0ea5e9' },
  completed: { key: 'completed', label: 'Completed', dot: '#10b981' },
  'no-show': { key: 'no-show', label: 'No Show', dot: '#f59e0b' },
  cancelled: { key: 'cancelled', label: 'Cancelled', dot: '#ef4444' },
}
export const STATUS_ORDER = ['active', 'confirmed', 'completed', 'no-show', 'cancelled']

export const SERVICES = [
  { id: 'dtt', label: '1:1 Discrete Trial Training', code: '97151' },
  { id: 'net', label: 'Natural Environment Teaching', code: '97151' },
  { id: 'adaptive', label: 'Adaptive / Daily Living Skills', code: '97151' },
  { id: 'behavior', label: 'Behavior Reduction Plan', code: '97151' },
  { id: 'social', label: 'Social Skills Group', code: '97153' },
  { id: 'play', label: 'Play Readiness Group', code: '97154' },
  { id: 'esdm', label: 'Early Start Denver Model (EIBI)', code: '0362T' },
  { id: 'fba', label: 'Functional Assessment (FBA)', code: '97152' },
  { id: 'sup', label: 'BCBA Supervision', code: '97152' },
  { id: 'caregiver', label: 'Parent / Caregiver Training', code: '97152' },
  { id: 'speech', label: 'Speech & Language Co-treatment', code: '97152' },
  { id: 'reassess', label: 'Re-assessment (VB-MAPP / ABLLS-R)', code: '97152' },
  { id: '253mt', label: 'Modified Treatment (clinic 253MT)', code: '253MT' },
]

// A unit = unitMins of the service. charge = units × rate (+ mileage for travel)
export const BILL_CODES = [
  { id: '97151', label: '97151 · Treatment session w/ technician', unitMins: 30, rate: 32 },
  { id: '97152', label: '97152 · Treatment session w/ supervisor', unitMins: 30, rate: 74 },
  { id: '97153', label: '97153 · Group treatment (2–5 clients)', unitMins: 30, rate: 18 },
  { id: '97154', label: '97154 · Group w/ technician', unitMins: 30, rate: 16 },
  { id: '0362T', label: '0362T · HCPS / EIBI emerging behavior', unitMins: 30, rate: 58 },
  { id: '253MT', label: '253MT · Modified treatment (clinic code)', unitMins: 30, rate: 10 },
  { id: 'H2019', label: 'H2019 · Health & rehab case mgmt', unitMins: 60, rate: 45 },
]

export const MILEAGE_RATE = 0.7 // $ / mile default for drive time
export const PAY_TAGS = ['Assessment report', 'Session note', 'IEP / IFSP', 'Consent / auth', 'Medical', 'Data export', 'Insurance']

export const RECURRENCES = [
  { id: 'none', label: "Doesn't repeat" },
  { id: 'weekly', label: 'Weekly' },
  { id: 'biweekly', label: 'Every 2 weeks' },
  { id: 'monthly', label: 'Monthly' },
]

export const VERIFY_CHECKS = [
  { id: 'data', label: 'Session data captured in EHR' },
  { id: 'safety', label: 'Safety & environment check' },
  { id: 'materials', label: 'Materials disinfected / stored' },
  { id: 'caregiver', label: 'Caregiver / school debrief done' },
]

// Custom fields support several input kinds and are seeded across appointment types.
export const CUSTOM_FIELDS = [
  { id: 'megTest', label: 'Meg Test', kind: 'select', options: ['Not started', 'Baseline', 'Pass 1', 'Pass 2', 'Complete'] },
  { id: 'myCare', label: 'My Care', kind: 'multiselect', options: ['Sensory Diet', 'Feeding Therapy', 'Sleep Protocol', 'Toileting Plan', 'Behavior Support', 'AAC Training', 'Mand Training'] },
  { id: 'yesNo', label: 'Yes or No', kind: 'toggle' },
  { id: 'grade', label: 'Grade', kind: 'select', options: ['A', 'B', 'C', 'D', 'E', 'N/A'] },
  { id: 'reEval', label: 'Re-eval Notes', kind: 'text' },
]

export const uid = () =>
  (crypto?.randomUUID ? crypto.randomUUID() : 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36))

export const durationOf = (a) => a.end - a.start
export function overlapsType(a) {
  return a.type === 'service' || a.type === 'evaluation' || a.type === 'drive' || a.type === 'supervision'
}
export const timeOverlap = (aS, aE, bS, bE) => aS < bE && bS < aE

export function computeBilling(a) {
  if (!TYPES[a.type]?.billable || !a.billing) return 0
  const { units = 0, rate = 0, distance = 0, mileage = false } = a.billing
  let charge = (Number(units) || 0) * (Number(rate) || 0)
  if (mileage) charge += (Number(distance) || 0) * (Number(a.billing.mileageRate) || MILEAGE_RATE)
  return Math.round(charge * 100) / 100
}

export function autoBilling(a, durMin) {
  const code = BILL_CODES.find((c) => c.id === a.billing?.code) || BILL_CODES[0]
  const units = Math.round((durMin / code.unitMins) * 4) / 4
  return {
    code: code.id,
    unitMins: code.unitMins,
    minutes: durMin,
    units: units > 0 ? units : 0,
    rate: code.rate,
    mileage: a.type === 'drive',
    distance: a.billing?.distance || 0,
  }
}

// double-booking detection: same staff or same client, overlapping time, both "occupying"
export function findConflicts(appts, a, allStaff = {}, allClients = {}) {
  const out = []
  for (const b of Object.values(appts)) {
    if (b.id === a.id || b.date !== a.date || b.status === 'cancelled') continue
    if (!timeOverlap(a.start, a.end, b.start, b.end)) continue
    if (!overlapsType(a) || !overlapsType(b)) {
      if (!(overlapsType(b) && !overlapsType(a))) continue
    }
    const staffClash = (a.staffIds || []).filter((s) => (b.staffIds || []).includes(s))
    const clientClash = (a.clientIds || []).filter((c) => (b.clientIds || []).includes(c))
    if (!staffClash.length && !clientClash.length) continue
    out.push({
      other: b,
      who: staffClash.length
        ? `Staff ${staffClash.map((s) => allStaff[s]?.name || s).join(', ')}`
        : `Client ${clientClash.map((c) => allClients[c]?.name || c).join(', ')}`,
      type: 'staff',
    })
  }
  return out
}

// ---------- recurrence helpers (shared by modal + detail card) ----------

export const seriesSiblings = (appts, a) =>
  a.seriesId ? Object.values(appts).filter((x) => x.seriesId === a.seriesId).sort((x, y) => (x.date < y.date ? -1 : 1)) : []

// keep each sibling's week offset, but move to the weekday of the new date
export function mapSeriesDate(sDate, anchorDate, newDate) {
  if (!newDate || newDate === anchorDate) return sDate
  const weekDelta = Math.round((parseISO(sDate) - parseISO(anchorDate)) / (7 * 86400000))
  const target = parseISO(newDate)
  target.setDate(target.getDate() + weekDelta * 7)
  return isoDate(target)
}

export function seriesDatesFor(startISO, rule, count) {
  if (rule === 'none') return [startISO]
  const base = parseISO(startISO)
  const n = Math.max(1, Math.min(104, count || 8))
  const out = []
  for (let i = 0; i < n; i++) {
    let d
    if (rule === 'monthly') {
      const y = base.getFullYear() + Math.floor((base.getMonth() + i) / 12)
      const m = (base.getMonth() + i) % 12
      d = new Date(y, m, Math.min(base.getDate(), daysInMonth(y, m)))
    } else {
      d = addDays(base, i * (rule === 'biweekly' ? 14 : 7))
    }
    out.push(isoDate(d))
  }
  return out
}

// returns { updates:[{id, ...patch}], deleteIds:[] } for a scoped edit
export function planScopedPatch(appts, appt, scope, patch) {
  const isSeries = Boolean(appt.seriesId)
  if (!isSeries || scope === 'one') {
    return { updates: [{ id: appt.id, ...patch, ...(isSeries ? { edited: true } : {}) }], deleteIds: [] }
  }
  const sibs = seriesSiblings(appts, appt).filter((s) => (scope === 'following' ? s.date >= appt.date : true))
  const updates = sibs.map((s) => ({
    ...patch,
    id: s.id,
    date: mapSeriesDate(s.date, appt.date, patch.date),
    ...(scope === 'one' ? { edited: true } : {}),
  }))
  return { updates, deleteIds: [] }
}

// rebuild future occurrences with a new repeat rule; returns { deleteIds, newDates }
export function planSeriesRebuild(appts, appt, newRule, count) {
  const sibs = seriesSiblings(appts, appt)
  const keep = sibs.filter((s) => s.date <= appt.date)
  const deleteIds = sibs.filter((s) => s.date > appt.date).map((s) => s.id)
  const dates = seriesDatesFor(appt.date, newRule, count).slice(1) // occurrence itself keeps its date
  return { keep, deleteIds, newDates: dates, seriesId: appt.seriesId }
}
