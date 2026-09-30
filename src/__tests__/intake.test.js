import { beforeEach, describe, expect, it } from 'vitest'
import { blankState, reducer, STORAGE_KEY } from '../state/store'
import {
  blankIntake, nextStages, defaultNextStage, stageDef, gateBlockers, gateProgress, isTerminal, isWon, isLost,
  slaDays, slaState, isStalled, nextAction, lastTouchAt, docProgress, requiredDocs, requiredConsents, consentSigned,
  intakeKpis, sourceStats, planConversion, normalizeIntake, intakeNo, fullName, ageLabel, primaryPhone,
  firstContactDays, referralToAssessmentDays, intakeMatches, INTAKE_STAGES, OPEN_STAGES, LOST_REASONS,
} from '../lib/intake'
import { REFERRAL_SOURCES, seedIntake } from '../lib/seed'

beforeEach(() => localStorage.clear())

const DAY = 86400000
const iso = (ms) => new Date(ms).toISOString().slice(0, 10)

/** A request that satisfies every conversion gate — the exit of the pipeline. */
function gatedRequest(over = {}) {
  return {
    ...blankIntake({
      id: 'iq-test', no: 'INT-9001', stage: 'auth', ownerId: 's12', urgency: 'routine',
      firstName: 'Test', lastName: 'Child', dob: '2019-01-01',
      payerId: 'py-aetna', memberId: 'M-1', planType: 'Commercial',
      guardian: { name: 'Parent', relation: 'Mother', phone: '(408) 555-0100', email: '', addressSame: true },
      settingPref: 'Center-based',
      docs: Object.fromEntries(['diagnostic_report', 'referral', 'insurance_card', 'consent_treat', 'hipaa_roi', 'financial_resp'].map((d) => [d, { status: 'received', at: Date.now() }])),
      consents: ['consent_treat', 'hipaa_roi', 'financial_resp'].map((id) => ({ id, at: Date.now() })),
      guardianVerifiedAt: Date.now(),
      auth: { submittedAt: iso(Date.now()), unitsRequested: 240, units: 240, windowStart: iso(Date.now()), windowEnd: iso(Date.now() + 84 * DAY), decision: 'approved' },
      ...over,
    }),
  }
}

describe('intake pipeline state machine', () => {
  it('only allows the documented transitions — no stage skipping', () => {
    expect(nextStages('new')).toEqual(['contacted', 'closed'])
    expect(nextStages('benefits')).toEqual(['review', 'closed'])
    expect(nextStages('review')).toEqual(['waitlist', 'scheduled', 'closed'])
    expect(nextStages('waitlist')).toEqual(['scheduled', 'closed'])
    expect(nextStages('converted')).toEqual([])
    expect(nextStages('closed')).toEqual(['new']) // reopening is deliberate, not a dead end
    // the happy path is unambiguous where there is only one option
    expect(defaultNextStage('new')).toBe('contacted')
    expect(defaultNextStage('review')).toBe(null) // a branch must be chosen by a person
  })

  it('marks the terminal stages and never lets one be re-entered accidentally', () => {
    expect(isTerminal('converted')).toBe(true)
    expect(isTerminal('closed')).toBe(true)
    expect(isTerminal('auth')).toBe(false)
    expect(isWon('converted')).toBe(true)
    expect(isLost('closed')).toBe(true)
    expect(INTAKE_STAGES.filter((s) => s.terminal)).toHaveLength(2)
    expect(OPEN_STAGES).not.toContain('converted')
  })

  it('scales the stage SLA down for urgent and emergency referrals', () => {
    expect(slaDays('new', 'routine')).toBe(1)
    expect(slaDays('screened', 'routine')).toBe(3)
    expect(slaDays('screened', 'urgent')).toBe(2)
    expect(slaDays('screened', 'low')).toBe(6)
    expect(slaDays('screened', 'emergency')).toBe(1) // never zero days
  })
})

describe('gates — a stage cannot be entered without its data', () => {
  it('blocks every screening transition on a bare request', () => {
    const r = blankIntake({ id: 'x', firstName: 'A', lastName: 'B' })
    const blockers = gateBlockers(r, 'screened')
    expect(blockers.length).toBeGreaterThan(3)
    expect(blockers.map((b) => b.id)).toContain('name')
    expect(blockers.map((b) => b.id)).toContain('guardian')
    expect(gateProgress(r, 'screened').pct).toBeLessThan(100)
  })

  it('blocks benefits until the card is actually received, not just requested', () => {
    const base = blankIntake({ id: 'x', payerId: 'py-aetna', memberId: 'M1', subscriberName: 'P', subscriberDob: '1990-01-01', subscriberRelation: 'Parent', planType: 'Commercial' })
    expect(gateBlockers(base, 'benefits').map((b) => b.id)).toEqual(['card'])
    const requested = { ...base, docs: { insurance_card: { status: 'requested' } } }
    expect(gateBlockers(requested, 'benefits').map((b) => b.id)).toEqual(['card'])
    const received = { ...base, docs: { insurance_card: { status: 'received' } } }
    expect(gateBlockers(received, 'benefits')).toHaveLength(0)
  })

  it('requires a reason and (for “other”) a note before a request can be closed', () => {
    expect(gateBlockers(blankIntake(), 'closed').map((b) => b.id)).toEqual(['reason'])
    expect(gateBlockers(blankIntake({ lost: { reason: 'other' } }), 'closed').map((b) => b.id)).toEqual(['note'])
    expect(gateBlockers(blankIntake({ lost: { reason: 'unreachable' } }), 'closed')).toHaveLength(0)
  })

  it('makes the conversion gate the sum of the pipeline’s promises', () => {
    const bare = blankIntake({ id: 'x', firstName: 'A', lastName: 'B' })
    expect(gateBlockers(bare, 'converted').length).toBeGreaterThanOrEqual(5)
    expect(gateBlockers(gatedRequest(), 'converted')).toHaveLength(0)
  })

  it('treats a waived document as satisfied but a missing one as blocking', () => {
    const r = blankIntake({ id: 'x' })
    expect(docProgress(r).missing.length).toBeGreaterThan(0)
    const waived = { ...r, docs: Object.fromEntries(requiredDocs(r).map((d) => [d.id, { status: 'waived' }])) }
    expect(docProgress(waived).missing).toHaveLength(0)
  })

  it('adds the IEP requirement only for a school-based request', () => {
    const centre = blankIntake({ settingPref: 'Center-based' })
    const school = blankIntake({ settingPref: 'School-based' })
    expect(requiredDocs(centre).map((d) => d.id)).not.toContain('iep_ifsp')
    expect(requiredDocs(school).map((d) => d.id)).toContain('iep_ifsp')
  })

  it('adds a custody document only when a guardianship note exists', () => {
    expect(requiredDocs(blankIntake()).map((d) => d.id)).not.toContain('custody')
    expect(requiredDocs(blankIntake({ guardianshipNote: 'Aunt has temporary custody' })).map((d) => d.id)).toContain('custody')
  })
})

describe('SLA, stalling and next action', () => {
  it('reports overdue against the stage budget, not the request age', () => {
    const fresh = blankIntake({ stage: 'screened', stageSince: Date.now() })
    expect(slaState(fresh).key).toBe('ok')
    const late = blankIntake({ stage: 'screened', stageSince: Date.now() - 9 * DAY })
    expect(slaState(late).key).toBe('overdue')
    expect(slaState(late).label).toBe('6d over SLA')
  })

  it('flags a record with no logged touch in five days and clears it once contacted', () => {
    const stale = blankIntake({ stage: 'benefits', stageSince: Date.now() - 8 * DAY, updatedAt: Date.now() - 8 * DAY, contacts: [] })
    expect(isStalled(stale)).toBe(true)
    const touched = { ...stale, contacts: [{ id: 'c', at: Date.now() - DAY, channel: 'Phone', outcome: 'voicemail' }] }
    expect(isStalled(touched)).toBe(false)
    expect(lastTouchAt(touched)).toBe(touched.contacts[0].at)
  })

  it('names the first outstanding requirement as the next action', () => {
    const r = blankIntake({ id: 'x', stage: 'new', ownerId: 's12', contacts: [{ id: 'c', at: Date.now(), channel: 'Phone', outcome: 'reached' }] })
    const na = nextAction(r)
    expect(na.to).toBe('contacted')
    expect(na.blocked).toBe(false)
    const bare = blankIntake({ id: 'y', stage: 'new' })
    expect(nextAction(bare).blocked).toBe(true)
  })

  it('turns a fully gated request into the conversion prompt, and stops there', () => {
    const ready = nextAction(gatedRequest())
    expect(ready.to).toBe('converted')
    expect(ready.label).toMatch(/Convert to a client chart/)
    expect(ready.blocked).toBe(false)
    const done = nextAction({ ...gatedRequest(), stage: 'converted', clientId: 'c1' })
    expect(done.to).toBe(null)
    expect(done.label).toMatch(/Client chart created/)
  })
})

describe('conversion — one plan, fully referential', () => {
  it('refuses to convert while the gate is unmet and says what is missing', () => {
    const state = blankState()
    state.intakeRequests = { bare: blankIntake({ id: 'bare', firstName: 'A', lastName: 'B' }) }
    const plan = planConversion(state, 'bare', { clientId: 'new-client' })
    expect(plan.ok).toBe(false)
    expect(plan.blockers.length).toBeGreaterThan(0)
  })

  it('creates the client chart with intake, referral and authorisation links', () => {
    const state = blankState()
    const req = gatedRequest({ referralSourceId: state.referralSources[0].id })
    state.intakeRequests = { [req.id]: req }
    const plan = planConversion(state, req.id, { clientId: 'new-client', at: 1700000000000 })
    expect(plan.ok).toBe(true)
    expect(plan.client.id).toBe('new-client')
    expect(plan.client.intakeId).toBe(req.id)
    expect(plan.client.intakeNo).toBe(req.no)
    expect(plan.client.referralSourceId).toBe(req.referralSourceId)
    expect(plan.client.intakeSourceLabel).toBe(state.referralSources[0].name)
    expect(plan.client.insurer).toBe(state.payers.find((p) => p.id === req.payerId).name)
    expect(plan.client.dob).toBe(req.dob)
    expect(plan.intake.stage).toBe('converted')
    expect(plan.intake.clientId).toBe('new-client')
  })

  it('re-points a booked assessment visit at the new client chart', () => {
    const state = blankState()
    const apptId = Object.keys(state.appts)[0]
    const req = gatedRequest({ apptId, apptDate: state.appts[apptId].date })
    state.intakeRequests = { [req.id]: req }
    const plan = planConversion(state, req.id, { clientId: 'new-client' })
    expect(plan.apptPatch).toEqual({ id: apptId, patch: { clientIds: ['new-client'], intakeId: req.id, status: 'confirmed' } })
  })

  it('derives weekly authorised hours from the approved window', () => {
    const state = blankState()
    const start = Date.now()
    const req = gatedRequest({ auth: { submittedAt: iso(start), units: 240, unitsRequested: 240, windowStart: iso(start), windowEnd: iso(start + 84 * DAY), decision: 'approved' } })
    state.intakeRequests = { [req.id]: req }
    const plan = planConversion(state, req.id, { clientId: 'c' })
    expect(plan.client.authWeekly).toBe(20) // 240 h over 12 weeks
  })
})

describe('KPIs and the referral-source scorecard', () => {
  it('returns null — not zero — for a rate with no decided requests', () => {
    const k = intakeKpis({ a: blankIntake({ id: 'a', stage: 'new' }) })
    expect(k.conversionRate).toBe(null)
    expect(k.won).toBe(0)
    expect(k.open).toBe(1)
  })

  it('counts conversion over decided requests only', () => {
    const k = intakeKpis({
      a: blankIntake({ id: 'a', stage: 'converted', lost: {} }),
      b: blankIntake({ id: 'b', stage: 'closed', lost: { reason: 'unreachable' } }),
      c: blankIntake({ id: 'c', stage: 'review' }),
      d: blankIntake({ id: 'd', stage: 'converted' }),
    })
    expect(k.conversionRate).toBe(67) // 2 of 3 decided, the open one is excluded
    expect(k.won).toBe(2)
    expect(k.lost).toBe(1)
    expect(k.open).toBe(1)
  })

  it('measures time to first contact from the first *successful* outreach', () => {
    const created = Date.now() - 5 * DAY
    const r = blankIntake({ createdAt: created, contacts: [
      { id: '1', at: created + 1 * DAY, channel: 'Phone', outcome: 'voicemail' },
      { id: '2', at: created + 3 * DAY, channel: 'Phone', outcome: 'reached' },
    ] })
    expect(firstContactDays(r)).toBe(3)
  })

  it('reports the funnel so a drop-off stage is visible', () => {
    const k = intakeKpis({
      a: blankIntake({ id: 'a', stage: 'benefits' }),
      b: blankIntake({ id: 'b', stage: 'converted' }),
    })
    const byId = Object.fromEntries(k.funnel.map((f) => [f.id, f.count]))
    expect(byId.new).toBe(2)
    expect(byId.benefits).toBe(2)
    expect(byId.converted).toBe(1)
  })

  it('ranks referral sources by volume and conversion, and spots a dormant relationship', () => {
    const sources = REFERRAL_SOURCES
    const requests = {
      a: blankIntake({ id: 'a', referralSourceId: sources[0].id, stage: 'converted' }),
      b: blankIntake({ id: 'b', referralSourceId: sources[0].id, stage: 'closed', lost: { reason: 'unreachable' } }),
      c: blankIntake({ id: 'c', referralSourceId: sources[0].id, stage: 'new' }),
    }
    const stats = sourceStats(sources, requests)
    const top = stats[0]
    expect(top.source.id).toBe(sources[0].id)
    expect(top.volume).toBe(3)
    expect(top.conversionRate).toBe(50)
    expect(top.open).toBe(1)
    const never = stats.find((s) => s.source.id === sources[10].id)
    expect(never.volume).toBe(0)
  })
})

describe('normalisation keeps the ledger referentially honest', () => {
  it('drops a dangling client link and re-flags the record instead of inventing a chart', () => {
    const state = blankState()
    state.intakeRequests = { x: { ...blankIntake({ id: 'x' }), stage: 'converted', clientId: 'ghost-client' } }
    const out = normalizeIntake(state)
    expect(out.intakeRequests.x.clientId).toBe(null)
    expect(out.intakeRequests.x.convertedClientMissing).toBe(true)
  })

  it('drops references to deleted staff, payers, sources and appointments', () => {
    const state = blankState()
    state.intakeRequests = { x: blankIntake({ id: 'x', ownerId: 'ghost', bcbaAssignedId: 'ghost', payerId: 'ghost-payer', referralSourceId: 'ghost-source', apptId: 'ghost-appt', apptDate: '2026-01-01' }) }
    const out = normalizeIntake(state)
    const r = out.intakeRequests.x
    expect([r.ownerId, r.bcbaAssignedId, r.payerId, r.referralSourceId, r.apptId]).toEqual([null, null, null, null, null])
    expect(r.apptDate).toBe('')
  })

  it('keeps a valid conversion intact', () => {
    const state = blankState()
    const clientId = state.clients[0].id
    state.intakeRequests = { x: { ...blankIntake({ id: 'x' }), stage: 'converted', clientId } }
    const out = normalizeIntake(state)
    expect(out.intakeRequests.x.clientId).toBe(clientId)
  })

  it('backfills a human reference number', () => {
    const state = blankState()
    state.intakeRequests = { x: blankIntake({ id: 'x', no: null }) }
    expect(normalizeIntake(state).intakeRequests.x.no).toMatch(/^INT-\d+$/)
  })

  it('never reuses a reference number', () => {
    const existing = { a: { no: 'INT-1001' }, b: { no: 'INT-1002' } }
    expect(intakeNo(existing, 1001)).toBe('INT-1003')
  })
})

describe('presentation helpers', () => {
  it('renders names, ages and contact lines defensively', () => {
    expect(fullName(blankIntake({ firstName: 'Ana', middleName: 'M', lastName: 'Ruiz' }))).toBe('Ana M Ruiz')
    expect(fullName(blankIntake({}))).toBe('Unnamed request')
    expect(ageLabel('', '2026-01-01')).toBe('DOB missing')
    expect(ageLabel('2020-01-01', '2026-01-01')).toBe('6 yrs')
    expect(ageLabel('2025-07-01', '2026-01-01')).toMatch(/mo$/)
    expect(primaryPhone(blankIntake({ phones: [{ id: 'p', number: '111', primary: false }, { id: 'q', number: '222', primary: true }] }))).toBe('222')
  })

  it('searches across the fields a coordinator actually has to hand', () => {
    const r = blankIntake({ firstName: 'Maya', lastName: 'Ellison', no: 'INT-1001', memberId: 'BSC-8841207', city: 'Santa Clara' })
    expect(intakeMatches(r, 'maya')).toBe(true)
    expect(intakeMatches(r, '8841207')).toBe(true)
    expect(intakeMatches(r, 'zzzz')).toBe(false)
    expect(intakeMatches(r, '')).toBe(true)
  })
})

describe('seeded pipeline', () => {
  const seeded = () => {
    const base = blankState()
    return { base, requests: base.intakeRequests, sources: base.referralSources }
  }

  it('covers every open stage so the board, gates and KPIs all have real data', () => {
    const { requests } = seeded()
    const stages = new Set(Object.values(requests).map((r) => r.stage))
    for (const s of OPEN_STAGES) expect(stages.has(s), `no seeded request in ${s}`).toBe(true)
    expect(stages.has('converted')).toBe(true)
    expect(stages.has('closed')).toBe(true)
  })

  it('gives every converted request a client chart that points back', () => {
    const { base, requests } = seeded()
    const converted = Object.values(requests).filter((r) => isWon(r.stage))
    expect(converted.length).toBeGreaterThan(0)
    for (const r of converted) {
      const client = base.clients.find((c) => c.id === r.clientId)
      expect(client, `${r.no} has no client`).toBeTruthy()
      expect(client.intakeId).toBe(r.id)
      expect(client.intakeNo).toBe(r.no)
    }
  })

  it('never ships a request that fails the backup validator', () => {
    // the seed must already be consistent: normalising it changes nothing
    const { base } = seeded()
    expect(normalizeIntake(base).intakeRequests).toBe(base.intakeRequests)
  })

  it('counts a genuinely stalled record so the attention strip is not decorative', () => {
    const { requests } = seeded()
    const k = intakeKpis(requests)
    expect(k.stalled.length).toBeGreaterThan(0)
    expect(k.overdue.length).toBeGreaterThan(0)
    expect(k.atRisk.length).toBeGreaterThan(0)
  })

  it('has at least one referral source with a live relationship owner', () => {
    const { sources, base } = seeded()
    expect(sources.length).toBeGreaterThan(5)
    const staffIds = new Set(base.staff.map((s) => s.id))
    expect(sources.filter((s) => s.ownerId && staffIds.has(s.ownerId)).length).toBeGreaterThan(5)
  })

  it('seeds a waitlist record with a promised review date on at least one request', () => {
    const { requests } = seeded()
    const wl = Object.values(requests).filter((r) => r.stage === 'waitlist')
    expect(wl.length).toBeGreaterThan(0)
    expect(wl.some((r) => r.waitlist.reviewBy)).toBe(true)
  })
})

describe('store transactions — pipeline moves are undoable', () => {
  it('advances a request and reverses it with one undo, touching only intakeRequests', () => {
    const base = blankState()
    const id = 'iq-1004' // seeded at `contacted`
    const before = base.intakeRequests[id]
    const advanced = reducer(base, { type: 'intakeTx', upserts: [{ ...before, stage: 'screened', stageSince: Date.now() }] })
    expect(advanced.intakeRequests[id].stage).toBe('screened')
    const undone = reducer(advanced, { type: 'undo' })
    expect(undone.intakeRequests[id].stage).toBe(before.stage)
    expect(undone.appts).toEqual(base.appts) // unrelated collections untouched
    expect(undone.clients).toBe(base.clients) // identity preserved — nothing rebuilt
  })

  it('applies a conversion as one transaction across intake, clients and the calendar', () => {
    const base = blankState()
    const req = gatedRequest({ id: 'iq-conv' })
    base.intakeRequests = { ...base.intakeRequests, 'iq-conv': req }
    const plan = planConversion(base, 'iq-conv', { clientId: 'client-new' })
    const next = reducer(base, { type: 'intakeTx', upserts: [plan.intake], clients: { 'client-new': plan.client } })
    expect(next.intakeRequests['iq-conv'].stage).toBe('converted')
    expect(next.clients.find((c) => c.id === 'client-new')).toBeTruthy()
    const undone = reducer(next, { type: 'undo' })
    // undo returns the request to the state it was in before the conversion …
    expect(undone.intakeRequests['iq-conv'].stage).toBe('auth')
    // … and removes the chart the conversion created

    expect(undone.clients.find((c) => c.id === 'client-new')).toBeUndefined()
  })

  it('replaces the source register wholesale so edits cannot half-apply', () => {
    const base = blankState()
    const sources = base.referralSources.map((s) => (s.id === 'rs-peds' ? { ...s, status: 'dormant' } : s))
    const next = reducer(base, { type: 'intakeTx', sources })
    expect(next.referralSources.find((s) => s.id === 'rs-peds').status).toBe('dormant')
    expect(reducer(next, { type: 'undo' }).referralSources.find((s) => s.id === 'rs-peds').status).toBe('active')
  })

  it('clears the pipeline with the demo ledger and restores it on undo', () => {
    const base = blankState()
    const cleared = reducer(base, { type: 'clearDemo' })
    expect(Object.keys(cleared.intakeRequests)).toHaveLength(0)
    expect(reducer(cleared, { type: 'undo' }).intakeRequests).toEqual(base.intakeRequests)
  })
})
