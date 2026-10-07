import { describe, it, expect } from 'vitest'
// ---- claim lifecycle engine: pure tests over a synthetic micro-practice ----
import {
  stagedAppts, planClaims, assembleClaims, nextClaimSeq, claimGate, submitPatch, payPatch,
  denyPatch, rebillPatch, dropLinePatch, dueOf, agingOf, claimStats, claimCsv, claimNoAt, PAYER_POLICY, arOf,
  lineFor, mileageCodeFor, normalizeMileageCode,
} from '../lib/claims'
import { addDays, addMonths, isoDate } from '../lib/date'

// Claims group by client × DOS-month, so fixture dates are pinned to a fixed anchor
// instead of "N days before today". Relative dates put last month's services in front of a
// today-based expectation on the 1st, and straddle a calendar-month boundary on the 12th
// (d(-11) is then the 1st, d(-12) the previous month's last day) — either way these
// assertions depended on the day CI happened to run.
const ANCHOR = '2026-03-15T00:00:00'
const d = (n) => isoDate(addDays(new Date(ANCHOR), n))
const appt = (id, clientId, over = {}) => ({
  id, type: 'service', title: '1:1 Discrete Trial Training', date: d(-12), start: 540, end: 600,
  status: 'completed', staffIds: ['s3'], clientIds: [clientId], notes: 'ok', documents: [], custom: {},
  verification: { verifyStatus: 'verified' }, billing: { code: '97151', units: 2, rate: 32, unitMins: 30, minutes: 60 },
  ...over,
})
const state = (appts) => ({
  appts: Object.fromEntries(appts.map((a) => [a.id, a])),
  clients: [
    { id: 'c1', name: 'Alpha Kid', insurer: 'Aetna', program: 'Center-based · 1:1', authStart: d(-120) },
    { id: 'c2', name: 'Beta Kid', insurer: 'Self-pay', program: 'Home program · NET', authStart: d(-90) },
  ],
  staff: [{ id: 's3', name: 'Rae Tech' }, { id: 's1', name: 'Boss BCBA' }],
  settings: { billing: { requireVerification: true, claimPrefix: 'CLM' }, org: { name: 'Test Co' }, mileageRate: 0.7 },
  claims: {},
})

describe('claims engine', () => {
  it('staging admits only complete, billable, unit-correct, gate-cleared lines with a client', () => {
    const st = state([
      appt('ok', 'c1'),
      appt('unverified', 'c1', { verification: { verifyStatus: 'flagged' } }),
      appt('zerounits', 'c1', { billing: { code: '97151', units: 0, rate: 32 } }),
      appt('noclient', null, { clientIds: [] }),
      appt('open', 'c1', { status: 'active' }),
      appt('mileage', 'c1', { type: 'drive', billing: { units: 0, rate: 0, mileage: true, distance: 12 } }),
    ])
    const staged = stagedAppts(st, null).map((a) => a.id).sort()
    expect(staged).toEqual(['mileage', 'ok'])
  })

  it('mileage lines use a payer-approved code and never guess 14220', () => {
    const mileage = appt('mileage', 'c1', {
      type: 'drive',
      billing: { units: 0, rate: 0, mileage: true, distance: 12, mileageRate: 0.7 },
    })
    const base = state([mileage])
    const plan = planClaims(base, [mileage])[0]
    const draft = assembleClaims(base, [plan]).claims[0]
    expect(draft.lines[0].kind).toBe('mileage')
    expect(draft.lines[0].code).toBe('')
    const missing = claimGate(base, draft).bad.find((b) => b.line.kind === 'mileage')
    expect(missing.why).toMatch(/No payer-specific mileage code/)
    expect(missing.why).toMatch(/rebuild this draft/)

    const payer = { id: 'payer-aetna', name: 'Aetna', rules: { claims: { mileageCode: ' x1234 ' } } }
    const configured = { ...base, payers: [payer] }
    expect(mileageCodeFor(payer)).toBe('X1234')
    expect(lineFor(mileage, configured, plan).code).toBe('X1234')
    const codedDraft = { ...draft, lines: [{ ...draft.lines[0], code: 'X1234' }] }
    expect(claimGate(configured, codedDraft).bad.some((b) => b.line.kind === 'mileage')).toBe(false)
    const unconfiguredCode = { ...draft, lines: [{ ...draft.lines[0], code: 'X1234' }] }
    expect(claimGate(base, unconfiguredCode).bad.find((b) => b.line.kind === 'mileage').why).toMatch(/No payer-specific mileage code is configured/)
    const changedSetting = { ...configured, payers: [{ ...payer, rules: { claims: { mileageCode: 'Y1234' } } }] }
    expect(claimGate(changedSetting, codedDraft).bad.find((b) => b.line.kind === 'mileage').why).toMatch(/current mileage code is Y1234/)

    expect(normalizeMileageCode('14220').ok).toBe(false)
    expect(normalizeMileageCode('x123').ok).toBe(false)
    expect(normalizeMileageCode('x12345').ok).toBe(false)
    expect(mileageCodeFor({ rules: { claims: { mileageCode: '14220' } } })).toBe('')
    const legacy = { ...draft, lines: [{ ...draft.lines[0], code: '14220' }] }
    expect(claimGate(base, legacy).bad.find((b) => b.line.kind === 'mileage').why).toMatch(/surgery code, not a mileage code/)

    const selfPayTrip = appt('selfpay-trip', 'c2', { type: 'drive', billing: { units: 0, rate: 0, mileage: true, distance: 12 } })
    const selfPayState = state([selfPayTrip])
    const selfPayPlan = planClaims(selfPayState, [selfPayTrip])[0]
    const selfPayDraft = assembleClaims(selfPayState, [selfPayPlan]).claims[0]
    expect(selfPayDraft.lines[0].code).toBe('')
    expect(claimGate(selfPayState, selfPayDraft).bad.some((b) => b.line.kind === 'mileage')).toBe(false)
  })

  it('plans group by client × payer × DOS-month and fold self-pay into one invoice', () => {
    const st = state([appt('a1', 'c1'), appt('a2', 'c1', { date: d(-11) }), appt('b1', 'c1', { date: d(-45) }), appt('s1', 'c2'), appt('s2', 'c2', { date: d(-40) })])
    const plans = planClaims(st, stagedAppts(st, null))
    const c1Plans = plans.filter((p) => p.clientId === 'c1')
    expect(c1Plans.length).toBe(2) // Mar (a1+a2) vs Jan (b1) — one form per client × month
    expect([...c1Plans.find((p) => p.appts.length === 2).appts].sort()).toEqual(['a1', 'a2'])
    const selfPay = plans.find((p) => p.mode === 'selfpay')
    expect(selfPay.appts.length).toBe(2) // both self-pay months ride ONE invoice
    expect(selfPay.dosFrom <= selfPay.dosTo).toBe(true)
  })

  it('assembles numbered claims whose lines, totals and appt reservations reconcile', () => {
    const st = state([appt('a1', 'c1'), appt('a2', 'c1', { date: d(-11) })])
    const { claims, apptPatch } = assembleClaims(st, planClaims(st, stagedAppts(st, null)), { seqStart: 7 })
    expect(claims.length).toBe(1)
    const c = claims[0]
    // numbered off the DOS of the services billed (both lines land in 2026-03), never off the
    // month the claim happened to be assembled in
    expect(c.no).toBe('CLM-202603-007')
    expect(c.no).toBe(claimNoAt('CLM', 7, c.dosFrom))
    expect(c.lines.length).toBe(2)
    expect(c.charges).toBe(Math.round(c.lines.reduce((t, l) => t + l.charge, 0) * 100) / 100)
    expect(apptPatch.length).toBe(2)
    expect(apptPatch[0].patch.billing.status).toBe('claimed')
    expect(nextClaimSeq({ [c.id]: c })).toBe(8)
  })

  it('keeps the DOS month in the claim number when the services predate the assembly month', () => {
    // CI regression (2026-10-01): sessions 11–12 days old land in September on the 1st of
    // October, so assembly produced CLM-202609-007 while the expectation was built from
    // today's month. planClaims groups by client × DOS-month, so the number must follow the
    // services billed — a month-of-assembly stamp would label two DOS months alike.
    const prior = isoDate(addMonths(new Date(), -1))
    const st = state([appt('a1', 'c1', { date: prior })])
    const { claims } = assembleClaims(st, planClaims(st, stagedAppts(st, null)), { seqStart: 7 })
    expect(claims[0].dosFrom).toBe(prior)
    expect(claims[0].no).toBe(claimNoAt('CLM', 7, prior))
    expect(claims[0].no.slice(4, 10)).toBe(prior.slice(0, 7).replace('-', ''))
  })

  it('submission gate holds any claim carrying a line that fell out of verification', () => {
    const st = state([appt('a1', 'c1'), appt('a2', 'c1', { date: d(-11) })])
    const { claims } = assembleClaims(st, planClaims(st, stagedAppts(st, null)), { seqStart: 1 })
    const c = claims[0]
    expect(claimGate(st, c).ok).toBe(true)
    // flip one line's verification flag after assembly — the claim must refuse to go out
    st.appts.a2.verification = { verifyStatus: 'flagged' }
    const gate = claimGate(st, c)
    expect(gate.ok).toBe(false)
    expect(gate.bad[0].line.apptId).toBe('a2')
    expect(/verification/i.test(gate.bad[0].why)).toBe(true)
    // and once verified, submitPatch stamps history + flips status
    st.appts.a2.verification = { verifyStatus: 'verified' }
    const tx = submitPatch(st, c)
    expect(tx.claim.status).toBe('submitted')
    expect(tx.claim.history.length).toBe(2)
    // honest wording: a local status change, never a transmission
    expect(tx.claim.history[1].ev).toMatch(/^(Marked submitted to .+; claim file saved locally, not transmitted|Invoice marked sent to family .+; the app sends nothing)$/)
    expect(tx.apptPatches.every((p) => p.patch.billing.submittedAt)).toBe(true)
  })

  it('payment posting balances to zero, tracks adjustments and due; short-pay stays visible', () => {
    const st = state([appt('a1', 'c1')])
    const { claims } = assembleClaims(st, planClaims(st, stagedAppts(st, null)), { seqStart: 1 })
    const c = submitPatch(st, claims[0]).claim
    const full = payPatch(c, { amount: c.charges, checkNo: 'CHK-1', adj: 0 }).claim
    expect(full.status).toBe('paid')
    expect(dueOf(full)).toBe(0)
    const short = payPatch(c, { amount: 50, checkNo: 'CHK-2', adj: c.charges - 50 - 3 }).claim
    expect(dueOf(short)).toBe(3) // charges − adj − paid, one dollar out of line
    expect(short.remittance.amount).toBe(50)
  })

  it('denial → rebill versions the claim and walks disputed lines back to staging', () => {
    const st = state([appt('a1', 'c1'), appt('a2', 'c1', { date: d(-11) })])
    const { claims } = assembleClaims(st, planClaims(st, stagedAppts(st, null)), { seqStart: 1 })
    let c = submitPatch(st, claims[0]).claim
    c = denyPatch(c, { code: 'dup' }).claim
    expect(c.denial.reason).toMatch(/Duplicate/i)
    const { voided, next, apptPatches } = rebillPatch(st, c, ['a2'])
    expect(voided.status).toBe('void')
    expect(next.no).toMatch(/-R2$/)
    expect(next.lines.map((l) => l.apptId)).toEqual(['a1'])
    const dropped = apptPatches.find((p) => p.id === 'a2')
    expect(dropped.patch.claimId).toBe(null)
    expect(dropped.patch.billing.status).toBe(null)
  })

  it('Medicaid same-day rule: one code, one day, one provider is one line, minutes rounded once', () => {
    const s37 = (id, start, o = {}) => appt(id, 'c1', { start, end: start + 37, billing: { code: '97151', units: 2, rate: 16, unitMins: 15, minutes: 37, rounding: 'AMA' }, ...o })
    const st = state([s37('m1', 540), s37('m2', 700)])
    const { claims, apptPatch } = assembleClaims(st, planClaims(st, stagedAppts(st, null)), { seqStart: 1 })
    const c = claims[0]
    expect(c.lines).toHaveLength(1)
    expect(c.lines[0]).toMatchObject({ apptIds: ['m1', 'm2'], minutes: 74, units: 5, charge: 80 }) // 2 + 2 billed separately
    expect(c.charges).toBe(80)
    expect(apptPatch.map((p) => p.id).sort()).toEqual(['m1', 'm2'])
    expect(submitPatch(st, c).apptPatches.map((p) => p.id).sort()).toEqual(['m1', 'm2'])
    expect(dropLinePatch(st, c, 'm2').released).toEqual(['m1', 'm2'])
    // a payer that switched "Merge same day" off keeps one line per session
    const off = { ...st, payers: [{ name: 'Aetna', rules: { claims: { flags: { mergeSameDay: false } } } }] }
    expect(assembleClaims(off, planClaims(off, stagedAppts(off, null)), { seqStart: 1 }).claims[0].lines).toHaveLength(2)
    // different rendering providers stay on separate lines
    const two = state([s37('m1', 540), s37('m2', 700, { staffIds: ['s1'] })])
    expect(assembleClaims(two, planClaims(two, stagedAppts(two, null)), { seqStart: 1 }).claims[0].lines).toHaveLength(2)
  })

  it('"Separate claim by" splits a client-month by rendering provider or place of service', () => {
    const st = (by) => ({ ...state([appt('p1', 'c1'), appt('p2', 'c1', { date: d(-11), staffIds: ['s1'], location: "Kid's home" })]), payers: [{ name: 'Aetna', rules: { claims: { separateBy: by } } }] })
    expect(planClaims(st('—'), stagedAppts(st('—'), null))).toHaveLength(1)
    expect(planClaims(st('Rendering Provider'), stagedAppts(st('Rendering Provider'), null))).toHaveLength(2)
    expect(planClaims(st('Place of Service'), stagedAppts(st('Place of Service'), null))).toHaveLength(2)
  })

  it('dropping the last line dissolves the draft claim', () => {
    const st = state([appt('a1', 'c1')])
    const { claims } = assembleClaims(st, planClaims(st, stagedAppts(st, null)), { seqStart: 1 })
    const r = dropLinePatch(st, claims[0], 'a1')
    expect(r.removeClaim).toBe(true)
  })

  it('aging & stats roll up: buckets, denial rate, average days-to-pay', () => {
    const st = state([appt('a1', 'c1')])
    const { claims } = assembleClaims(st, planClaims(st, stagedAppts(st, null)), { seqStart: 1 })
    const c = claims[0]
    const old = Date.now() - 40 * 86400000
    const aged = { ...c, status: 'submitted', submittedAt: old }
    expect(agingOf(aged).bucket).toBe('31-60')
    expect(agingOf(aged).late).toBe(true) // > Aetna's 24d median
    const paid = payPatch({ ...c, submittedAt: old }, { amount: c.charges, checkNo: 'X', adj: 0, paidAt: old + 10 * 86400000 }).claim
    const s = claimStats({ ...st, claims: { aged: aged, paid: paid, denied: { ...c, id: 'zz', status: 'denied' } } }, null)
    expect(s.pending.n).toBe(1)
    expect(s.paid.n).toBe(1)
    expect(s.denialRate).toBe(50)
    expect(s.avgDaysToPay).toBe(10)
    expect(s.staged.n).toBe(1) // a1 itself was never marked claimed in this synthetic state
  })

  it('one aging engine: desk, register and AR Manager share one clock and five buckets', () => {
    const st = state([appt('a1', 'c1')])
    const { claims } = assembleClaims(st, planClaims(st, stagedAppts(st, null)), { seqStart: 1 })
    const c = claims[0]
    const mk = (id, daysAgo, over = {}) => ({
      ...c, id, no: `CLM-${id}`, status: 'submitted', paid: 0, adj: 0,
      submittedAt: Date.now() - daysAgo * 86400000, ...over,
    })
    // one claim per bucket; ages stay clear of the 30/60/90/120 edges
    const five = { a: mk('a', 5), b: mk('b', 35), cc: mk('cc', 65), d: mk('d', 95), e: mk('e', 130) }
    const s = claimStats({ ...st, claims: five }, null)
    expect(Object.keys(s.pending.buckets)).toEqual(['current', '31-60', '61-90', '91-120', '121+'])
    expect(Object.values(s.pending.buckets).every((v) => v > 0)).toBe(true)
    // the desk buckets reconcile with the AR Manager's for the same claims
    const ar = arOf({ ...st, claims: five }, isoDate(new Date()))
    for (const b of ['current', '31-60', '61-90', '91-120', '121+']) {
      expect(s.pending.buckets[b]).toBe(Math.round(ar.totals[b]))
    }
    // a denied claim keeps aging (it stays in A/R); closed and draft claims have no age
    const denied = { ...c, id: 'den', status: 'denied', denial: { code: 'x' }, submittedAt: Date.now() - 40 * 86400000 }
    expect(agingOf(denied).bucket).toBe('31-60')
    expect(agingOf({ ...c, id: 'done', status: 'paid', paid: c.charges })).toBe(null)
    expect(agingOf({ ...c, id: 'drft', status: 'draft', submittedAt: null })).toBe(null)
    // with nothing submitted yet, an open claim ages from its date of service — the arOf clock
    const dos = isoDate(addDays(new Date(), -50))
    expect(agingOf({ ...denied, id: 'dos', submittedAt: null, dosFrom: dos, dosTo: dos }).bucket).toBe('31-60')
  })

  it('CSV export carries the practice header and one line per charge', () => {
    const st = state([appt('a1', 'c1'), appt('a2', 'c1', { date: d(-11) })])
    const { claims } = assembleClaims(st, planClaims(st, stagedAppts(st, null)), { seqStart: 1 })
    const csv = claimCsv(st, claims[0])
    expect(csv).toContain('# Test Co — Claim CLM-')
    expect(csv).toContain('line,date_of_service,hcpcs')
    expect(csv.split('\n').length).toBe(6) // 3 meta + header + 2 lines
    expect(csv).toContain(',97151,')
  })

  it('payer policies drive the numbers behind quick posts', () => {
    expect(PAYER_POLICY['Self-pay'].kind).toBe('selfpay')
    expect(PAYER_POLICY['Aetna'].copay).toBe(25)
  })
})
