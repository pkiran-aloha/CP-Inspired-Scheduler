import { describe, it, expect } from 'vitest'
// ---- claim lifecycle engine: pure tests over a synthetic micro-practice ----
import {
  stagedAppts, planClaims, assembleClaims, nextClaimSeq, claimGate, submitPatch, payPatch,
  denyPatch, rebillPatch, dropLinePatch, dueOf, agingOf, claimStats, claimCsv, PAYER_POLICY,
} from '../lib/claims'
import { todayISO, addDays, isoDate } from '../lib/date'

const d = (n) => isoDate(addDays(new Date(todayISO() + 'T00:00:00'), n))
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

  it('plans group by client × payer × DOS-month and fold self-pay into one invoice', () => {
    const st = state([appt('a1', 'c1'), appt('a2', 'c1', { date: d(-11) }), appt('b1', 'c1', { date: d(-45) }), appt('s1', 'c2'), appt('s2', 'c2', { date: d(-40) })])
    const plans = planClaims(st, stagedAppts(st, null))
    const c1Plans = plans.filter((p) => p.clientId === 'c1')
    expect(c1Plans.length).toBe(2) // Sep (a1+a2) vs Aug (b1) — one form per client × month
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
    expect(c.no).toBe('CLM-' + todayISO().slice(0, 4) + todayISO().slice(5, 7) + '-007')
    expect(c.lines.length).toBe(2)
    expect(c.charges).toBe(Math.round(c.lines.reduce((t, l) => t + l.charge, 0) * 100) / 100)
    expect(apptPatch.length).toBe(2)
    expect(apptPatch[0].patch.billing.status).toBe('claimed')
    expect(nextClaimSeq({ [c.id]: c })).toBe(8)
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
    expect(agingOf(aged).bucket).toBe('31–60')
    expect(agingOf(aged).late).toBe(true) // > Aetna's 24d median
    const paid = payPatch({ ...c, submittedAt: old }, { amount: c.charges, checkNo: 'X', adj: 0, paidAt: old + 10 * 86400000 }).claim
    const s = claimStats({ ...st, claims: { aged: aged, paid: paid, denied: { ...c, id: 'zz', status: 'denied' } } }, null)
    expect(s.pending.n).toBe(1)
    expect(s.paid.n).toBe(1)
    expect(s.denialRate).toBe(50)
    expect(s.avgDaysToPay).toBe(10)
    expect(s.staged.n).toBe(1) // a1 itself was never marked claimed in this synthetic state
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
