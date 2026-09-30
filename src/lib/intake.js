// ---- Intake Manager: the pre-client pipeline ---------------------------------
//
// Industry pattern this module implements (see README → Intake Manager):
//   referral captured → contacted → screened → benefits verified (VOB) →
//   clinical review → waitlist or assessment scheduled → assessment done →
//   authorization → converted to a client chart.
//
// Two rules hold everywhere in this file:
//   1. A stage can only be entered when its *gate* is satisfied. Gates are
//      data, not UI conditionals, so the pipeline, the form and the report all
//      agree on what "Benefits verified" actually requires.
//   2. Nothing is invented. A missing measure reports as null and the UI says
//      "not recorded" instead of showing a fabricated zero.
//
// Pure module — no React, no store access. The reducer and the views call in.

import { addDays, isoDate, parseISO, todayISO } from './date'

// ------------------------------------------------------------------ pipeline --

/**
 * The intake pipeline. `order` drives the funnel; `terminal` stages close a
 * record; `sla` is the working-day budget before the record is "aging".
 * `branch` marks stages that are alternatives rather than a single track.
 */
export const INTAKE_STAGES = [
  { id: 'new', label: 'New referral', short: 'New', icon: 'zap', tone: 'info', sla: 1, owner: 'Intake coordinator',
    desc: 'Inquiry captured — nothing verified yet.' },
  { id: 'contacted', label: 'Contacted', short: 'Contacted', icon: 'phone', tone: 'info', sla: 2, owner: 'Intake coordinator',
    desc: 'A live conversation happened; the family knows the next step.' },
  { id: 'screened', label: 'Screened', short: 'Screened', icon: 'clipboard', tone: 'info', sla: 3, owner: 'Intake coordinator',
    desc: 'Clinical pre-screen: fit, service line, setting, urgency.' },
  { id: 'benefits', label: 'Benefits verified', short: 'VOB', icon: 'shield', tone: 'warn', sla: 2, owner: 'Benefits specialist',
    desc: 'Eligibility, cost share and prior-auth rules confirmed with the payer.' },
  { id: 'review', label: 'Clinical review', short: 'Review', icon: 'eye', tone: 'warn', sla: 3, owner: 'BCBA / clinical lead',
    desc: 'Assigned clinician confirms appropriateness and recommended hours.' },
  { id: 'waitlist', label: 'Waitlist', short: 'Waitlist', icon: 'clock', tone: 'warn', sla: 14, owner: 'Intake coordinator', branch: true,
    desc: 'Clinically ready, capacity unavailable — position and review date tracked.' },
  { id: 'scheduled', label: 'Assessment scheduled', short: 'Scheduled', icon: 'cal', tone: 'info', sla: 7, owner: 'Scheduler',
    desc: 'A dated assessment appointment exists on the calendar.' },
  { id: 'assessment', label: 'Assessment complete', short: 'Assessed', icon: 'checkCircle', tone: 'ok', sla: 5, owner: 'Assigned BCBA',
    desc: 'Assessment performed; recommended hours and setting recorded.' },
  { id: 'auth', label: 'Authorization', short: 'Auth', icon: 'file', tone: 'warn', sla: 5, owner: 'Benefits specialist',
    desc: 'Auth request submitted; the payer decision is tracked with a reference.' },
  { id: 'converted', label: 'Converted to client', short: 'Converted', icon: 'check', tone: 'ok', sla: 0, owner: 'Intake coordinator', terminal: 'won',
    desc: 'A client chart exists and is linked back to this request.' },
  { id: 'closed', label: 'Closed / not admitted', short: 'Closed', icon: 'x', tone: 'bad', sla: 0, owner: 'Intake coordinator', terminal: 'lost',
    desc: 'Final disposition recorded with a reason.' },
]

export const STAGE_BY_ID = Object.fromEntries(INTAKE_STAGES.map((s) => [s.id, s]))
export const STAGE_ORDER = INTAKE_STAGES.map((s) => s.id)
export const OPEN_STAGES = STAGE_ORDER.filter((id) => !STAGE_BY_ID[id].terminal)
export const FUNNEL_STAGES = ['new', 'contacted', 'screened', 'benefits', 'review', 'scheduled', 'assessment', 'auth', 'converted']

export const isTerminal = (stage) => Boolean(STAGE_BY_ID[stage]?.terminal)
export const isWon = (stage) => STAGE_BY_ID[stage]?.terminal === 'won'
export const isLost = (stage) => STAGE_BY_ID[stage]?.terminal === 'lost'
export const stageIndex = (stage) => Math.max(0, STAGE_ORDER.indexOf(stage))
export const stageDef = (stage) => STAGE_BY_ID[stage] || STAGE_BY_ID.new

/**
 * Allowed transitions. A pipeline that can jump anywhere is a status field, not
 * a workflow — reviewers specifically lose records when `new` can skip VOB.
 * `waitlist` and `scheduled` are the deliberate branch out of clinical review.
 */
export const NEXT_STAGES = {
  new: ['contacted', 'closed'],
  contacted: ['screened', 'closed'],
  screened: ['benefits', 'closed'],
  benefits: ['review', 'closed'],
  review: ['waitlist', 'scheduled', 'closed'],
  waitlist: ['scheduled', 'closed'],
  scheduled: ['assessment', 'closed'],
  assessment: ['auth', 'closed'],
  auth: ['converted', 'closed'],
  converted: [],
  closed: ['new'],
}

export const nextStages = (stage) => NEXT_STAGES[stage] || []
/** The single "happy path" next step, or null when a branch/terminal decides. */
export function defaultNextStage(stage) {
  const opts = nextStages(stage).filter((s) => s !== 'closed')
  return opts.length === 1 ? opts[0] : null
}

// ------------------------------------------------------------------- choices --

export const URGENCY = {
  emergency: { label: 'Emergency', tone: 'bad', slaFactor: 0.25, hint: 'Safety risk — same business day, escalate to the clinical director' },
  urgent: { label: 'Urgent', tone: 'warn', slaFactor: 0.5, hint: 'See within a week (losing skills, school exclusion, caregiver crisis)' },
  routine: { label: 'Routine', tone: '', slaFactor: 1, hint: 'Standard access target' },
  low: { label: 'Low / exploratory', tone: '', slaFactor: 2, hint: 'Family is gathering information; keep warm without holding a slot' },
}
export const URGENCY_IDS = ['emergency', 'urgent', 'routine', 'low']

export const INTAKE_KINDS = {
  general: { label: 'General intake request', hint: 'Inquiry with no chart yet — the intake team owns it end to end' },
  client: { label: 'Client intake', hint: 'Full intake record for a family that is moving to services' },
}

export const CONTACT_CHANNELS = ['Phone', 'Email', 'Text / SMS', 'Patient portal', 'Fax', 'Walk-in', 'Web form', 'Professional referral', 'School referral', 'Payer / case manager']
export const CONTACT_OUTCOMES = [
  { id: 'reached', label: 'Reached — spoke with caregiver', counts: true },
  { id: 'voicemail', label: 'Left voicemail', counts: false },
  { id: 'no_answer', label: 'No answer / unreachable', counts: false },
  { id: 'email_sent', label: 'Message sent (email/SMS/portal)', counts: false },
  { id: 'wrong_number', label: 'Wrong / disconnected number', counts: false },
  { id: 'declined', label: 'Family declined services', counts: true },
]

/** Referral source kinds — drives the relationship metrics on the source register. */
export const SOURCE_KINDS = ['Pediatrician', 'Developmental pediatrician', 'Neurologist', 'Psychologist', 'School district', 'Regional center', 'Other provider (SLP/OT)', 'Hospital / ED', 'Payer / case manager', 'Community organisation', 'Self / family', 'Web form / marketing', 'Other']
export const SOURCE_OWNERS_HINT = 'The staff member accountable for the relationship — dormancy alerts go to them.'

/** Not-admitted reasons. Tracking these separates true demand from process loss. */
export const LOST_REASONS = [
  { id: 'unreachable', label: 'Unable to reach the family', owner: 'Intake coordinator' },
  { id: 'declined', label: 'Family declined services', owner: 'Intake coordinator' },
  { id: 'insurance', label: 'Insurance not accepted / not active', owner: 'Benefits specialist' },
  { id: 'out_of_area', label: 'Outside the service area', owner: 'Intake coordinator' },
  { id: 'age', label: 'Outside the served age range', owner: 'Clinical lead' },
  { id: 'not_indicated', label: 'Not clinically indicated for ABA here', owner: 'Clinical lead' },
  { id: 'no_capacity', label: 'No capacity — waitlist declined or too long', owner: 'Operations' },
  { id: 'moved', label: 'Family relocated', owner: 'Intake coordinator' },
  { id: 'duplicate', label: 'Duplicate of another request', owner: 'Intake coordinator' },
  { id: 'other', label: 'Other (note required)', owner: 'Intake coordinator' },
]
export const LOST_REASON_BY_ID = Object.fromEntries(LOST_REASONS.map((r) => [r.id, r]))

export const SETTING_PREFS = ['Center-based', 'Home-based', 'School-based', 'Telehealth', 'Community', 'Undecided']
export const LIVING_ARRANGEMENTS = ['Lives with parents / guardians', 'Lives with relative', 'Foster care', 'Group home', 'Residential facility', 'Other']
export const DIAGNOSIS_STATUS = {
  confirmed: { label: 'Confirmed diagnosis on file', tone: 'ok' },
  suspected: { label: 'Suspected / evaluation in progress', tone: 'warn' },
  referral_only: { label: 'Referral only — no diagnosis yet', tone: 'warn' },
  unknown: { label: 'Unknown / not yet asked', tone: '' },
}
export const LANGUAGE_OPTIONS = ['English', 'Spanish', 'Vietnamese', 'Mandarin', 'Cantonese', 'Tagalog', 'Korean', 'Arabic', 'Hindi', 'Other']

export const PHONE_TYPES = ['Mobile', 'Home', 'Work', 'Other']
export const GENDERS = { M: 'Male', F: 'Female', X: 'Another / prefer not to say' }
export const RECORD_STATUS = { active: 'Active', inactive: 'Inactive' }

// --- insurance / benefits ------------------------------------------------------

export const PLAN_TYPES = ['Commercial', 'Medicaid', 'Medicare', 'TRICARE', 'School district', 'Self-pay', 'Other']
export const VOB_STATUS = {
  pending: { label: 'Not started', tone: '' },
  in_progress: { label: 'In progress', tone: 'warn' },
  complete: { label: 'Complete', tone: 'ok' },
  ineligible: { label: 'Not eligible', tone: 'bad' },
  no_aba_benefit: { label: 'No ABA benefit', tone: 'bad' },
}
export const SUBSCRIBER_RELATIONS = ['Self (the child)', 'Parent', 'Legal guardian', 'Spouse', 'Other']

/** The verification-of-benefits snapshot a benefits specialist reads back to the family. */
export const VOB_FIELDS = [
  { id: 'inNetwork', label: 'In network', kind: 'bool', required: true },
  { id: 'abaCovered', label: 'ABA covered', kind: 'bool', required: true },
  { id: 'deductible', label: 'Deductible ($)', kind: 'money' },
  { id: 'deductibleMet', label: 'Deductible met ($)', kind: 'money' },
  { id: 'oopMax', label: 'Out-of-pocket max ($)', kind: 'money' },
  { id: 'coinsurance', label: 'Coinsurance (%)', kind: 'pct' },
  { id: 'copay', label: 'Copay per visit ($)', kind: 'money' },
  { id: 'visitLimit', label: 'Visit / hour limit', kind: 'text' },
  { id: 'priorAuthRequired', label: 'Prior authorization required', kind: 'bool', required: true },
  { id: 'telehealthCovered', label: 'Telehealth covered', kind: 'bool' },
]

// --- documents -----------------------------------------------------------------

/**
 * Intake document checklist. `required` may be a function of the record —
 * a school-based case owes an IEP, a commercial plan owes the referral.
 */
export const INTAKE_DOCS = [
  { id: 'diagnostic_report', label: 'Diagnostic evaluation / autism report', required: true, hint: 'Most payers want an evaluation dated within 3 years', at: 'screened' },
  { id: 'referral', label: 'Physician referral / order', required: true, hint: 'Some plans accept a school or regional-center referral instead', at: 'review' },
  { id: 'insurance_card', label: 'Insurance card (front & back)', required: true, hint: 'Needed before the benefits check can be final', at: 'benefits' },
  { id: 'iep_ifsp', label: 'IEP / IFSP / 504 plan', required: (r) => r.settingPref === 'School-based', hint: 'Required for school-based service lines', at: 'review' },
  { id: 'custody', label: 'Custody / guardianship documents', required: (r) => Boolean(r.guardianshipNote), hint: 'Only when someone other than the parent consents', at: 'review' },
  { id: 'prior_records', label: 'Prior therapy / records release', required: false, hint: 'Speeds up the assessment; ask for a focused ROI', at: 'screened' },
  { id: 'immunisation', label: 'Immunisation / medical clearance', required: false, hint: 'Center-based programs commonly require this', at: 'scheduled' },
  { id: 'consent_treat', label: 'Consent to treat', required: true, hint: 'Signed before any billable service', at: 'scheduled' },
  { id: 'hipaa_roi', label: 'HIPAA notice + release of information', required: true, at: 'scheduled' },
  { id: 'financial_resp', label: 'Financial responsibility / assignment of benefits', required: true, at: 'auth' },
]
export const DOC_STATUS = {
  missing: { label: 'Missing', tone: 'bad' },
  requested: { label: 'Requested', tone: 'warn' },
  received: { label: 'Received', tone: 'ok' },
  waived: { label: 'Waived', tone: '' },
  expired: { label: 'Expired', tone: 'bad' },
}
export const docDef = (id) => INTAKE_DOCS.find((d) => d.id === id)

export const CONSENT_KINDS = [
  { id: 'consent_treat', label: 'Consent to treat', required: true },
  { id: 'hipaa_roi', label: 'HIPAA notice + release of information', required: true },
  { id: 'financial_resp', label: 'Financial responsibility', required: true },
  { id: 'media_release', label: 'Photo / media release', required: false },
  { id: 'telehealth', label: 'Telehealth consent', required: false },
  { id: 'records_release', label: 'Records release to school / other providers', required: false },
]

// --- clinical / assessment ------------------------------------------------------

export const ASSESSMENT_INSTRUMENTS = ['VB-MAPP', 'ABLLS-R', 'AFLS', 'Vineland-3', 'PDDBI', 'FBA / functional assessment', 'ADOS-2 (observation)', 'Other / custom battery']
export const ASSESSMENT_OUTCOMES = {
  recommended: { label: 'ABA recommended — treatment plan to follow', tone: 'ok' },
  more_data: { label: 'More data needed', tone: 'warn' },
  not_recommended: { label: 'ABA not recommended', tone: 'bad' },
  referred_out: { label: 'Referred to another service', tone: 'warn' },
}
export const AUTH_DECISIONS = {
  pending: { label: 'Submitted — decision pending', tone: 'warn' },
  approved: { label: 'Approved as requested', tone: 'ok' },
  partial: { label: 'Approved in part', tone: 'warn' },
  denied: { label: 'Denied', tone: 'bad' },
  not_required: { label: 'Not required by this plan', tone: '' },
}
export const WAITLIST_REASONS = ['No technician capacity', 'No BCBA capacity', 'No assessment slot', 'Authorisation pending', 'Family requested a later start', 'Service-area / travel limit', 'Other']

// --- service lines / programs ---------------------------------------------------

export const SERVICE_LINES = ['EIBI · Early intervention', 'Center-based 1:1', 'Home program (NET)', 'School-based inclusion', 'Group / social skills', 'Behavior reduction', 'Speech co-treatment', 'Assessment / reevaluation']
export const INTAKE_PROGRAMS = ['EIBI · Day program', 'EIBI · Home program', 'Home program · NET', 'Center-based · 1:1', 'School-based · Inclusion', 'Behavior reduction', 'Group · Social skills', 'Group · Play readiness', 'Adaptive skills · Center', 'Speech co-treatment', 'Assessment / intake']

// --- SLA / aging ----------------------------------------------------------------

export const TOUCH_SLA_DAYS = 5 // no logged touch in this many days ⇒ at risk
const DAY_MS = 86400000

/** Working-day budget for a stage, tightened by urgency. */
export function slaDays(stage, urgency = 'routine') {
  const base = stageDef(stage).sla
  const factor = URGENCY[urgency]?.slaFactor ?? 1
  return Math.max(1, Math.round(base * factor))
}

export const daysBetween = (fromIso, toIso = todayISO()) =>
  Math.round((parseISO(toIso) - parseISO(fromIso)) / DAY_MS)

export function msDays(fromMs, toMs = Date.now()) {
  return Math.round((toMs - fromMs) / DAY_MS)
}

/** Where a record sits against its stage SLA: ok · due · overdue. */
export function slaState(req, now = Date.now()) {
  if (isTerminal(req.stage)) return { key: 'closed', days: 0, budget: 0, label: 'Closed' }
  const budget = slaDays(req.stage, req.urgency)
  const days = Math.max(0, msDays(req.stageSince || req.createdAt, now))
  const key = days > budget ? 'overdue' : days >= budget ? 'due' : 'ok'
  return { key, days, budget, label: key === 'overdue' ? `${days - budget}d over SLA` : key === 'due' ? 'SLA due today' : `${Math.max(0, budget - days)}d left` }
}

/** No logged contact or stage change for TOUCH_SLA_DAYS ⇒ the record is stalling. */
export function lastTouchAt(req) {
  const stamps = [req.updatedAt, req.stageSince, ...(req.contacts || []).map((c) => c.at), ...(req.events || []).map((e) => e.at)].filter(Boolean)
  return stamps.length ? Math.max(...stamps) : req.createdAt || 0
}
export function isStalled(req, now = Date.now()) {
  return !isTerminal(req.stage) && msDays(lastTouchAt(req), now) >= TOUCH_SLA_DAYS
}

/** A record's whole reason to exist: the one thing to do next. */
export function nextAction(req, now = Date.now()) {
  if (req.stage === 'closed') return { label: 'Reopen the request', detail: 'Closed requests can be reopened if the family returns', to: 'new', blocked: false, outstanding: 0 }
  if (req.stage === 'converted') return { label: 'Client chart created', detail: 'Continue in the client record — schedule services and track authorisation', to: null, blocked: false, outstanding: 0 }
  const next = nextStageFor(req)
  const blockers = gateBlockers(req, next)
  // the blocker's own verb is the instruction — "Mark the insurance card received"
  if (blockers.length) return { label: blockers[0].action, detail: blockers.map((b) => b.label).join(' · '), to: next, blocked: true, outstanding: blockers.length }
  if (req.stage === 'review') return { label: 'Choose the next branch', detail: 'Waitlist the family or book the assessment', to: null, blocked: false, outstanding: 0 }
  return {
    label: next === 'converted' ? 'Convert to a client chart' : `Advance to ${stageDef(next).label}`,
    detail: next === 'converted' ? 'Every intake requirement is met — create the client record' : stageDef(next).desc,
    to: next, blocked: false, outstanding: 0,
  }
}

/** The stage a record would move to by default (waitlist branch prefers scheduling). */
export function nextStageFor(req) {
  const opts = nextStages(req.stage).filter((s) => s !== 'closed')
  if (opts.length <= 1) return opts[0] || null
  return req.stage === 'review' ? 'scheduled' : opts[0]
}

// ------------------------------------------------------------------ gates -----

const has = (v) => v !== undefined && v !== null && String(v).trim() !== ''
const money = (v) => v !== '' && v !== null && v !== undefined && Number.isFinite(Number(v))
const anyPhone = (r) => (r.phones || []).some((p) => has(p.number))

/** Document status helper — a document counts only when received or waived. */
export const docStatus = (req, id) => req.docs?.[id]?.status || 'missing'
export const docSatisfied = (req, id) => ['received', 'waived'].includes(docStatus(req, id))

/** Documents required *for this record*, honouring conditional requirements. */
export function requiredDocs(req, uptoStage = null) {
  const upto = uptoStage ? stageIndex(uptoStage) : Infinity
  return INTAKE_DOCS.filter((d) => {
    const needed = typeof d.required === 'function' ? d.required(req) : d.required
    return needed && (!uptoStage || stageIndex(d.at) <= upto)
  })
}

export function docProgress(req, uptoStage = null) {
  const required = requiredDocs(req, uptoStage)
  const done = required.filter((d) => docSatisfied(req, d.id))
  return { required: required.length, done: done.length, missing: required.filter((d) => !docSatisfied(req, d.id)), pct: required.length ? Math.round((done.length / required.length) * 100) : 100 }
}

/** Required consents for this record (same conditional idea as documents). */
export function requiredConsents(req) {
  return CONSENT_KINDS.filter((c) => (typeof c.required === 'function' ? c.required(req) : c.required))
}
export const consentSigned = (req, id) => Boolean((req.consents || []).find((c) => c.id === id))

/**
 * Gate definitions, keyed by the *target* stage. Each item:
 *   { id, label, action, ok(req) }  — `action` is the verb shown to the user.
 * A gate item is a promise the platform keeps: `benefits` really does require a
 * verification reference, so a downstream claim denial can be traced back here.
 */
export const GATES = {
  contacted: [
    { id: 'owner', label: 'An intake owner is assigned', action: 'Assign an owner', ok: (r) => has(r.ownerId) },
    { id: 'contact', label: 'At least one contact attempt is logged with an outcome', action: 'Log a contact attempt', ok: (r) => (r.contacts || []).some((c) => has(c.outcome)) },
  ],
  screened: [
    { id: 'name', label: 'Child name and date of birth recorded', action: 'Capture the child’s name and DOB', ok: (r) => has(r.firstName) && has(r.lastName) && has(r.dob) },
    { id: 'guardian', label: 'Parent / guardian contact recorded', action: 'Add the guardian', ok: (r) => has(r.guardian?.name) && (has(r.guardian?.phone) || has(r.email) || anyPhone(r)) },
    { id: 'diagnosis', label: 'Diagnosis status captured', action: 'Record the diagnosis status', ok: (r) => has(r.diagnosisStatus) && r.diagnosisStatus !== 'unknown' },
    { id: 'concern', label: 'Presenting concern and goals summarised', action: 'Write the caregiver’s concerns', ok: (r) => has(r.concerns) },
    { id: 'setting', label: 'Preferred service setting recorded', action: 'Pick a preferred setting', ok: (r) => has(r.settingPref) && r.settingPref !== 'Undecided' },
    { id: 'urgency', label: 'Urgency triaged', action: 'Set the urgency', ok: (r) => URGENCY_IDS.includes(r.urgency) },
    { id: 'screen', label: 'Clinical pre-screen saved with a fit decision', action: 'Save the pre-screen', ok: (r) => has(r.screen?.fit) },
  ],
  benefits: [
    { id: 'payer', label: 'Primary payer selected', action: 'Select the payer', ok: (r) => has(r.payerId) },
    { id: 'member', label: 'Member ID and group number captured', action: 'Capture the member ID', ok: (r) => has(r.memberId) },
    { id: 'subscriber', label: 'Subscriber name, DOB and relationship captured', action: 'Capture the subscriber', ok: (r) => has(r.subscriberName) && has(r.subscriberDob) && has(r.subscriberRelation) },
    { id: 'plan', label: 'Plan type recorded', action: 'Set the plan type', ok: (r) => has(r.planType) },
    { id: 'card', label: 'Insurance card received', action: 'Mark the insurance card received', ok: (r) => docSatisfied(r, 'insurance_card') },
  ],
  review: [
    { id: 'vob', label: 'Benefits verification completed and signed off', action: 'Complete the benefits check', ok: (r) => r.vob?.status === 'complete' },
    { id: 'vobref', label: 'Payer representative, call date and reference number recorded', action: 'Record the verification reference', ok: (r) => has(r.vob?.repName) && has(r.vob?.at) && has(r.vob?.refNo) },
    { id: 'bcba', label: 'Assigned BCBA / assessing clinician', action: 'Assign a clinician', ok: (r) => has(r.bcbaAssignedId) },
    { id: 'report', label: 'Diagnostic report received', action: 'Mark the diagnostic report received', ok: (r) => docSatisfied(r, 'diagnostic_report') },
    { id: 'referraldoc', label: 'Referral / order received', action: 'Mark the referral received', ok: (r) => docSatisfied(r, 'referral') },
  ],
  waitlist: [
    { id: 'reason', label: 'Waitlist reason recorded', action: 'Pick a waitlist reason', ok: (r) => has(r.waitlist?.reason) },
    { id: 'priority', label: 'Waitlist priority assigned', action: 'Set the priority', ok: (r) => has(r.waitlist?.priority) },
    { id: 'reviewby', label: 'Next review date promised to the family', action: 'Set a review date', ok: (r) => has(r.waitlist?.reviewBy) },
  ],
  scheduled: [
    { id: 'appt', label: 'Assessment appointment booked on the calendar', action: 'Book the assessment', ok: (r) => has(r.apptId) && has(r.apptDate) },
    { id: 'clinician', label: 'Assessing clinician assigned to the visit', action: 'Assign the clinician', ok: (r) => has(r.clinicianId) },
  ],
  assessment: [
    { id: 'date', label: 'Assessment completion date', action: 'Record the assessment date', ok: (r) => has(r.assessment?.date) },
    { id: 'instrument', label: 'Assessment instrument recorded', action: 'Record the instrument', ok: (r) => has(r.assessment?.instrument) },
    { id: 'outcome', label: 'Assessment outcome recorded', action: 'Record the outcome', ok: (r) => has(r.assessment?.outcome) },
    { id: 'hours', label: 'Recommended hours per week and setting', action: 'Record the recommendation', ok: (r) => money(r.assessment?.recommendedHoursPerWeek) && has(r.assessment?.recommendedSetting) },
  ],
  auth: [
    { id: 'submitted', label: 'Authorisation request submitted with a date', action: 'Record the submission', ok: (r) => has(r.auth?.submittedAt) },
    { id: 'units', label: 'Requested units / hours window', action: 'Record the requested units', ok: (r) => money(r.auth?.unitsRequested) && has(r.auth?.windowStart) && has(r.auth?.windowEnd) },
  ],
  converted: [
    { id: 'decision', label: 'Authorisation decision recorded', action: 'Record the payer decision', ok: (r) => has(r.auth?.decision) && r.auth.decision !== 'pending' },
    { id: 'approved', label: 'Approved units and authorisation window', action: 'Record the approved units', ok: (r) => (r.auth?.decision === 'not_required' ? true : money(r.auth?.units) && has(r.auth?.windowStart) && has(r.auth?.windowEnd)) },
    { id: 'consents', label: 'All required consents signed', action: 'Capture the consents', ok: (r) => requiredConsents(r).every((c) => consentSigned(r, c.id)) },
    { id: 'docs', label: 'Every required intake document received or waived', action: 'Close out the document checklist', ok: (r) => docProgress(r, 'converted').missing.length === 0 },
    { id: 'guardian', label: 'Guardian identity and contact verified', action: 'Verify the guardian', ok: (r) => Boolean(r.guardianVerifiedAt) },
  ],
  closed: [
    { id: 'reason', label: 'Not-admitted reason recorded', action: 'Pick a reason', ok: (r) => has(r.lost?.reason) },
    { id: 'note', label: 'Disposition note (required for “Other”)', action: 'Write the disposition', ok: (r) => (r.lost?.reason === 'other' ? has(r.lost?.notes) : true) },
  ],
}

/** Gate items that are not yet satisfied for a target stage. */
export function gateBlockers(req, target) {
  if (!target || !GATES[target]) return []
  return GATES[target].filter((g) => { try { return !g.ok(req) } catch { return true } })
}
export const gateItems = (target) => GATES[target] || []
export function gateProgress(req, target) {
  const items = gateItems(target)
  const done = items.filter((g) => { try { return g.ok(req) } catch { return false } })
  return { done: done.length, total: items.length, pct: items.length ? Math.round((done.length / items.length) * 100) : 100, blockers: gateBlockers(req, target) }
}
/** Everything standing between the record and its next stage, plus the stage after. */
export function readiness(req) {
  const target = nextStageFor(req)
  return { target, ...gateProgress(req, target) }
}

// --------------------------------------------------------------- presentation --

export const fullName = (r) => [r?.firstName, r?.middleName, r?.lastName].filter((x) => has(x)).join(' ').trim() || 'Unnamed request'
export const shortName = (r) => [r?.firstName, r?.lastName].filter((x) => has(x)).join(' ').trim() || 'Unnamed'
export const initialsOf = (r) => fullName(r).split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase()

export function ageOf(dob, onIso = todayISO()) {
  if (!has(dob)) return null
  const b = parseISO(dob)
  const on = parseISO(onIso)
  if (!b || Number.isNaN(b.getTime())) return null
  let years = on.getFullYear() - b.getFullYear()
  const m = on.getMonth() - b.getMonth()
  if (m < 0 || (m === 0 && on.getDate() < b.getDate())) years -= 1
  return years < 0 ? null : years
}
/** Age that reads correctly for infants — ABA intake skews young. */
export function ageLabel(dob, onIso = todayISO()) {
  if (!has(dob)) return 'DOB missing'
  const y = ageOf(dob, onIso)
  if (y === null) return 'DOB invalid'
  if (y >= 2) return `${y} yrs`
  const months = Math.max(0, Math.round((parseISO(onIso) - parseISO(dob)) / (DAY_MS * 30.4375)))
  return months <= 1 ? `${Math.max(0, Math.round((parseISO(onIso) - parseISO(dob)) / DAY_MS))} days` : `${months} mo`
}

/** Prefer the child's mobile, then the guardian's, then anything reachable. */
export function primaryPhone(r) {
  const own = (r.phones || []).find((p) => p.primary) || (r.phones || [])[0]
  return own?.number || r.guardian?.phone || ''
}
export function contactLine(r) {
  return [primaryPhone(r), r.email || r.guardian?.email].filter(has).join(' · ')
}

/** One-line housing/school context for list rows. */
export const siteOf = (r) => r.office || 'Unassigned office'

export function referralLabel(r, sources = []) {
  if (r.referralSourceId) {
    const s = sources.find((x) => x.id === r.referralSourceId)
    if (s) return s.name
  }
  return has(r.referredByOrg) ? r.referredByOrg : has(r.referredByName) ? r.referredByName : 'Source not recorded'
}

export function searchText(r) {
  return [r.no, fullName(r), r.alias, r.city, r.zip, r.memberId, r.email, r.notes, r.concerns,
    ...(r.phones || []).map((p) => p.number), r.guardian?.name].filter(has).join(' ').toLowerCase()
}
export const intakeMatches = (r, q) => !q || searchText(r).includes(String(q).trim().toLowerCase())

// --------------------------------------------------------------------- KPIs ----

const median = (xs) => {
  const v = xs.filter((n) => Number.isFinite(n)).sort((a, b) => a - b)
  if (!v.length) return null
  const mid = Math.floor(v.length / 2)
  return v.length % 2 ? v[mid] : Math.round((v[mid - 1] + v[mid]) / 2)
}
const pct = (num, den) => (den > 0 ? Math.round((num / den) * 100) : null)

/** Time from referral to the first *successful* contact, in days. */
export function firstContactDays(r) {
  const hit = (r.contacts || []).filter((c) => c.outcome === 'reached' || c.outcome === 'declined').sort((a, b) => a.at - b.at)[0]
  return hit ? msDays(r.createdAt, hit.at) : null
}

/** Referral → assessment (the access measure payers and families feel). */
export function referralToAssessmentDays(r) {
  return r.assessment?.date ? daysBetween(isoDate(new Date(r.createdAt)), r.assessment.date) : null
}
/** Referral → first billable service (only real once converted and scheduled). */
export function referralToServiceDays(r) {
  return r.firstServiceDate ? daysBetween(isoDate(new Date(r.createdAt)), r.firstServiceDate) : null
}

/**
 * Pipeline KPIs. Every rate returns null (not 0) when the denominator is empty,
 * so the UI can render "not enough data" instead of a misleading zero.
 */
export function intakeKpis(requests, opts = {}) {
  const now = opts.now ?? Date.now()
  const list = Object.values(requests || {})
  const open = list.filter((r) => !isTerminal(r.stage))
  const won = list.filter((r) => isWon(r.stage))
  const lost = list.filter((r) => isLost(r.stage))
  const decided = won.length + lost.length
  const stalled = open.filter((r) => isStalled(r, now))
  const overdue = open.filter((r) => slaState(r, now).key === 'overdue')

  const byStage = Object.fromEntries(STAGE_ORDER.map((s) => [s, list.filter((r) => r.stage === s)]))
  const funnel = FUNNEL_STAGES.map((s) => ({
    id: s, label: stageDef(s).short, count: list.filter((r) => isWon(r.stage) ? FUNNEL_STAGES.indexOf(r.stage) >= FUNNEL_STAGES.indexOf(s) : (!isLost(r.stage) && stageIndex(r.stage) >= stageIndex(s))).length,
  }))

  const lostReasons = LOST_REASONS
    .map((reason) => ({ ...reason, count: lost.filter((r) => r.lost?.reason === reason.id).length }))
    .filter((r) => r.count > 0)
    .sort((a, b) => b.count - a.count)

  const payerMix = [...new Set(list.map((r) => r.payerId).filter(Boolean))]
    .map((id) => ({ id, count: list.filter((r) => r.payerId === id).length }))
    .sort((a, b) => b.count - a.count)

  return {
    total: list.length,
    open: open.length,
    won: won.length,
    lost: lost.length,
    conversionRate: pct(won.length, decided),
    medianFirstContact: median(list.map(firstContactDays)),
    medianToAssessment: median(list.map(referralToAssessmentDays)),
    stalled,
    overdue,
    byStage,
    funnel,
    lostReasons,
    payerMix,
    waitlisted: byStage.waitlist || [],
    waitingFamilies: (byStage.waitlist || []).length,
    atRisk: [...new Set([...stalled, ...overdue])].sort((a, b) => a.createdAt - b.createdAt),
    byUrgency: Object.fromEntries(URGENCY_IDS.map((u) => [u, open.filter((r) => r.urgency === u).length])),
    newThisWeek: list.filter((r) => msDays(r.createdAt, now) <= 7).length,
  }
}

/** Referral-source scorecard: volume, conversion, response speed, dormancy. */
export function sourceStats(sources, requests, now = Date.now()) {
  const list = Object.values(requests || {})
  return (sources || []).map((s) => {
    const mine = list.filter((r) => r.referralSourceId === s.id)
    const won = mine.filter((r) => isWon(r.stage))
    const lost = mine.filter((r) => isLost(r.stage))
    const last = mine.reduce((m, r) => Math.max(m, r.referralDate ? parseISO(r.referralDate).getTime() : r.createdAt), 0)
    return {
      source: s,
      volume: mine.length,
      won: won.length,
      lost: lost.length,
      open: mine.filter((r) => !isTerminal(r.stage)).length,
      conversionRate: pct(won.length, won.length + lost.length),
      medianToAssessment: median(mine.map(referralToAssessmentDays)),
      lastReferralAt: last || null,
      daysSinceReferral: last ? msDays(last, now) : null,
      dormant: s.status === 'active' && (!last || msDays(last, now) > (s.dormantDays || 90)),
    }
  }).sort((a, b) => b.volume - a.volume || String(a.source.name).localeCompare(String(b.source.name)))
}

// ------------------------------------------------------------------ defaults ---

export function blankIntake(overrides = {}) {
  return {
    id: null,
    no: null,
    kind: 'general',
    stage: 'new',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    stageSince: Date.now(),
    createdBy: null,
    ownerId: null,
    urgency: 'routine',
    tags: [],
    // demographics (mirrors the Client Intake form)
    firstName: '', middleName: '', lastName: '', alias: '', office: '',
    dob: '', gender: 'M', status: 'active',
    street: '', city: '', state: 'CA', zip: '', addressNotes: '',
    phones: [{ id: 'ph-1', type: 'Mobile', number: '', ext: '', primary: true }],
    email: '', preferredLanguage: 'English', interpreter: false,
    livingArrangement: '', schoolName: '', iep: false,
    photo: null,
    // guardian + referral
    guardian: { name: '', relation: '', phone: '', email: '', addressSame: true },
    emergency: { name: '', relation: '', phone: '' },
    guardianshipNote: '',
    referralSourceId: null, referredByName: '', referredByOrg: '', referringNpi: '', referralDate: todayISO(), referralChannel: 'Phone', referralNotes: '',
    // clinical
    diagnosisStatus: 'unknown', diagnosis: '', diagnosedBy: '', diagnosedOn: '',
    concerns: '', priorTherapy: false, priorTherapyNotes: '', medications: '', allergies: '', safetyRisks: '',
    settingPref: 'Undecided', serviceLine: '', program: '', preferredDays: '', preferredTimes: '', availabilityNotes: '',
    bcbaAssignedId: null,
    screen: { fit: '', at: null, by: null, notes: '' },
    // insurance / benefits
    payerId: null, secondaryPayerId: null, memberId: '', groupNumber: '', subscriberName: '', subscriberDob: '', subscriberRelation: 'Parent', planType: 'Commercial', policyStatus: 'active',
    vob: { status: 'pending', at: null, by: null, repName: '', refNo: '', callPhone: '', effectiveFrom: '', deductible: '', deductibleMet: '', oopMax: '', coinsurance: '', copay: '', visitLimit: '', abaCovered: null, inNetwork: null, priorAuthRequired: null, telehealthCovered: null, notes: '' },
    // waitlist / scheduling / assessment / auth
    waitlist: { reason: '', priority: '', since: null, reviewBy: '', position: null, notes: '' },
    apptId: null, apptDate: '', clinicianId: null,
    assessment: { date: '', instrument: '', outcome: '', recommendedHoursPerWeek: '', recommendedSetting: '', completedBy: null, reportDueBy: '' },
    auth: { submittedAt: '', requestRef: '', unitsRequested: '', units: '', windowStart: '', windowEnd: '', decision: '', decisionAt: '', authNo: '', notes: '' },
    // documents, consents, pipeline hygiene
    docs: {},
    consents: [],
    contacts: [],
    tasks: [],
    events: [],
    lost: { reason: '', notes: '', at: null, by: null },
    convertedAt: null, clientId: null, firstServiceDate: '',
    notes: '',
    ...overrides,
  }
}

// ------------------------------------------------------------ normalisation ---

/**
 * Keep the intake ledger referentially honest on every load/restore:
 * ids are keyed by their own id, dangling client/source/staff/payer links are
 * dropped (never silently re-pointed), and the collections exist.
 */
export function normalizeIntake(state) {
  const list = state.intakeRequests
  const sources = Array.isArray(state.referralSources) ? state.referralSources : []
  if (!list && !sources.length) return state

  const clientIds = new Set((state.clients || []).map((c) => c.id))
  const staffIds = new Set((state.staff || []).map((s) => s.id))
  const payerIds = new Set((state.payers || []).map((p) => p.id))
  const sourceIds = new Set(sources.map((s) => s.id))
  const apptIds = new Set(Object.keys(state.appts || {}))

  const next = {}
  let changed = !list || !Array.isArray(state.referralSources)
  for (const [id, raw] of Object.entries(list || {})) {
    if (!raw || typeof raw !== 'object') { changed = true; continue }
    const r = { ...blankIntake(), ...raw }
    if (r.id !== id) { r.id = id; changed = true }
    const drop = (key, set, keepKey) => { if (r[key] && !set.has(r[key])) { r[key] = null; if (keepKey) r[keepKey] = null; changed = true } }
    drop('clientId', clientIds)
    drop('referralSourceId', sourceIds)
    drop('ownerId', staffIds)
    drop('bcbaAssignedId', staffIds)
    drop('clinicianId', staffIds)
    drop('payerId', payerIds)
    drop('secondaryPayerId', payerIds)
    if (r.apptId && !apptIds.has(r.apptId)) { r.apptId = null; r.apptDate = ''; changed = true }
    if (r.clientId && !isWon(r.stage)) { r.stage = 'converted'; changed = true }
    if (isWon(r.stage) && !r.clientId && !r.convertedClientMissing) { r.convertedClientMissing = true; changed = true }
    if (!r.no) { r.no = `INT-${String(Object.keys(list).indexOf(id) + 1001)}`; changed = true }
    next[id] = r
  }
  if (!changed) return state
  return { ...state, intakeRequests: next, referralSources: sources }
}

// --------------------------------------------------------------- conversion ----

const AV_COLORS = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#14b8a6', '#ef4444']
const AVATAR_KEYS = ['fox', 'panda', 'cat', 'bear', 'owl', 'penguin', 'frog', 'bunny', 'koala', 'sloth', 'octopus', 'unicorn', 'robot', 'chick']

/**
 * Plan the conversion transaction. One reducer action applies all of it, so a
 * single Undo reverses the client chart, the appointment link and the request.
 *
 * Referential mapping created here:
 *   intake.clientId            ↔ client.id
 *   client.intakeId            ↔ intake.id           (upstream trace)
 *   client.referralSourceId    ↔ referralSources.id  (downstream attribution)
 *   appt.clientIds             += client.id          (calendar)
 *   intake.apptId              → evaluating visit
 *
 * @returns {{ok:boolean, msg?:string, client?:object, intake?:object, apptPatch?:object}}
 */
export function planConversion(state, id, opts = {}) {
  const req = state.intakeRequests?.[id]
  if (!req) return { ok: false, msg: 'Intake request not found' }
  if (isWon(req.stage) && req.clientId) return { ok: false, msg: 'This request is already converted' }
  const blockers = gateBlockers(req, 'converted')
  if (blockers.length) return { ok: false, msg: `Cannot convert yet — ${blockers.length} requirement${blockers.length > 1 ? 's' : ''} outstanding`, blockers }

  const at = opts.at ?? Date.now()
  const clientId = opts.clientId
  const payerName = (state.payers || []).find((p) => p.id === req.payerId)?.name || req.payerName || ''
  const secondaryName = (state.payers || []).find((p) => p.id === req.secondaryPayerId)
  const hours = Number(req.auth?.units) ? Number(req.auth.units) : Number(req.assessment?.recommendedHoursPerWeek) || 15
  // audited-hours-per-week: the practice tracks weekly authorised hours, and the
  // request only ever recorded units for the whole window.
  const weeks = req.auth?.windowStart && req.auth?.windowEnd ? Math.max(1, Math.round(daysBetween(req.auth.windowStart, req.auth.windowEnd) / 7)) : 12
  const authWeekly = req.auth?.decision === 'approved' || req.auth?.decision === 'partial' ? Math.max(1, Math.round(hours / weeks)) : Math.max(1, Math.round(hours / weeks))

  const client = {
    id: clientId,
    name: fullName(req),
    initials: initialsOf(req),
    color: AV_COLORS[(state.clients || []).length % AV_COLORS.length],
    program: opts.program || req.program || req.serviceLine || 'Assessment / intake',
    home: req.office || 'Main Center',
    insurer: payerName || 'Self-pay',
    status: req.status || 'active',
    guardian: req.guardian?.name || '',
    phone: primaryPhone(req) || req.guardian?.phone || '',
    email: req.email || req.guardian?.email || '',
    dob: req.dob || '',
    sex: req.gender || 'M',
    authWeekly,
    authStart: req.auth?.windowStart || todayISO(),
    authEnd: req.auth?.windowEnd || isoDate(addDays(parseISO(todayISO()), 180)),
    geo: [37.34, -121.97],
    avatar: AVATAR_KEYS[(state.clients || []).length % AVATAR_KEYS.length],
    // --- the links that make this a platform, not a form ---
    intakeId: req.id,
    intakeNo: req.no,
    referralSourceId: req.referralSourceId || null,
    intakeSourceLabel: referralLabel(req, state.referralSources),
    intakeConvertedAt: at,
    preferredLanguage: req.preferredLanguage || 'English',
    alias: req.alias || '',
    middleName: req.middleName || '',
    street: req.street || '', city: req.city || '', state: req.state || '', zip: req.zip || '',
    secondary: secondaryName ? { payerId: secondaryName.id, memberId: req.secondaryMemberId || '', authNo: '', relation: 'secondary', since: req.auth?.windowStart || null, until: req.auth?.windowEnd || null, note: 'Captured during intake (COB)' } : null,
  }

  const intake = {
    ...req,
    stage: 'converted',
    convertedAt: at,
    clientId,
    stageSince: at,
    updatedAt: at,
    events: [...(req.events || []), { at, by: opts.by || null, ev: `Converted to client chart ${req.no} → ${client.name}` }],
  }

  const apptPatch = req.apptId ? { id: req.apptId, patch: { clientIds: [clientId], intakeId: req.id, status: 'confirmed' } } : null
  return { ok: true, client, intake, apptPatch, msg: `${client.name} converted — chart, authorisation and referral attribution created` }
}

// ------------------------------------------------------------------ seeding ----

/** Deterministic-ish reference number for a new request. */
export function intakeNo(existing = {}, seed = 1001) {
  const used = new Set(Object.values(existing).map((r) => r.no))
  let n = seed
  while (used.has(`INT-${n}`)) n += 1
  return `INT-${n}`
}

export const emptyDocState = () => ({})
