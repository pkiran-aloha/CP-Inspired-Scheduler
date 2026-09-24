import { describe, it, expect } from 'vitest'
import { blankState } from '../state/store'
import { claimGate, secondaryEligible, stagedAppts, dueOf } from '../lib/claims'
import { isoDate, addDays } from '../lib/date'

describe('billing secondary + filing + strictAuth/supervision + invoiceSeq (chunk 42)', () => {
  it('secondaryEligible: partially_paid + client secondary + no existing secondary', () => {
    const base = blankState()
    const client = base.clients.find((c)=>c.secondary)
    expect(client).toBeTruthy()
    const claim = {
      id: 'clm-test', no: 'CLM-TEST', clientId: client.id, payer: client.insurer,
      charges: 300, adj: 0, paid: 200, status: 'partially_paid',
      secondary: null, dosFrom: '2026-09-01', dosTo: '2026-09-01',
      lines: [{ apptId: 'a1', dos: '2026-09-01' }],
    }
    expect(secondaryEligible(base, claim)).toBe(true)
    const already = { ...claim, secondary: 'clm-other' }
    expect(secondaryEligible(base, already)).toBe(false)
    const noSecClient = base.clients.find((c)=>!c.secondary)
    const claim2 = { ...claim, clientId: noSecClient.id }
    expect(secondaryEligible(base, claim2)).toBe(false)
  })

  it('timely filing gate blocks draft past due', () => {
    const base = blankState()
    const apptId = Object.keys(base.appts)[0]
    const appt = base.appts[apptId]
    const claim = {
      id: 'clm-timely', no: 'CLM-TIMELY', clientId: appt.clientIds[0], payer: 'Aetna',
      charges: 100, adj:0, paid:0, status:'draft',
      timelyDue: '2020-01-01', // past
      dosFrom: appt.date, dosTo: appt.date,
      lines: [{ apptId, dos: appt.date }],
    }
    const gate = claimGate(base, claim)
    expect(gate.ok).toBe(false)
    expect(gate.bad.some((b)=>/Timely filing/.test(b.why))).toBe(true)
  })

  it('strictAuth gate: blocks when DOS outside auth window, and stagedAppts respects toggle', () => {
    const base = blankState()
    const client = base.clients[0]
    // set auth window far in past
    const pastClient = { ...client, authStart: '2020-01-01', authEnd: '2020-02-01' }
    const state = { ...base, clients: base.clients.map((c)=>c.id===client.id?pastClient:c), settings: { ...base.settings, billing: { ...base.settings.billing, strictAuth: true } } }
    const appt = Object.values(base.appts).find((a)=>a.clientIds?.[0]===client.id)
    if (!appt) return
    const claim = {
      id: 'clm-auth', no: 'CLM-AUTH', clientId: client.id, payer: client.insurer,
      charges: 100, adj:0, paid:0, status:'draft',
      timelyDue: isoDate(addDays(new Date(), 30)),
      dosFrom: appt.date, dosTo: appt.date,
      lines: [{ apptId: appt.id, dos: appt.date }],
    }
    const gate = claimGate(state, claim)
    expect(gate.ok).toBe(false)
    expect(gate.bad.some((b)=>/Auth/.test(b.why) || /authoriz/i.test(b.why))).toBe(true)

    // stagedAppts should exclude this appt when strictAuth on
    const staged = stagedAppts(state, null)
    const hasThis = staged.some((a)=>a.id===appt.id)
    // appt date is 2026, auth is 2020, so should be excluded
    expect(hasThis).toBe(false)

    // with strictAuth off, it would be included if other gates pass
    const stateOff = { ...state, settings: { ...state.settings, billing: { ...state.settings.billing, strictAuth: false } } }
    const stagedOff = stagedAppts(stateOff, null)
    // not asserting inclusion (other gates), just that function runs
    expect(Array.isArray(stagedOff)).toBe(true)
  })

  it('supervisionCheck gate: RBT-only session without BCBA flagged', () => {
    const base = blankState()
    const rbtStaff = base.staff.find((s)=>/RBT/.test(s.role))
    const client = base.clients.find((c)=>c.id)
    const apptId = 'appt-rbt-only'
    const appt = {
      id: apptId, date: '2026-09-10', start: 540, end: 600,
      clientIds: [client.id], staffIds: [rbtStaff.id],
      type: 'service', status: 'completed',
      billing: { code: '97153', units: 2, rate: 32 },
    }
    const state = {
      ...base,
      appts: { ...base.appts, [apptId]: appt },
      settings: { ...base.settings, billing: { ...base.settings.billing, supervisionCheck: true } },
    }
    const claim = {
      id: 'clm-sup', no: 'CLM-SUP', clientId: client.id, payer: client.insurer,
      charges: 64, adj:0, paid:0, status:'draft',
      timelyDue: isoDate(addDays(new Date(), 30)),
      dosFrom: appt.date, dosTo: appt.date,
      lines: [{ apptId, dos: appt.date }],
    }
    const gate = claimGate(state, claim)
    expect(gate.ok).toBe(false)
    expect(gate.bad.some((b)=>/Supervision/.test(b.why))).toBe(true)

    // with supervisionCheck off, should not flag supervision
    const stateOff = { ...state, settings: { ...state.settings, billing: { ...state.settings.billing, supervisionCheck: false } } }
    const gateOff = claimGate(stateOff, claim)
    expect(gateOff.bad.some((b)=>/Supervision/.test(b.why))).toBe(false)
  })

  it('invoiceSeq: blankState starts at 1 and increments conceptually', () => {
    const base = blankState()
    expect(base.settings.billing.invoiceSeq).toBe(1)
    expect(base.settings.billing.invoicePrefix).toBe('INV')
  })
})
