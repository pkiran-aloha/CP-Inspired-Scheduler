// Medicaid / CPT unit norms: 15-minute units, midpoint rule, one-time migration, same-day check.
import { describe, it, expect } from 'vitest'
import { blankState } from '../state/store'
import { autoBilling, unitsFor, LEGACY_UNIT_DEFAULTS, BILL_CODES } from '../lib/model'
import { normalizeUnitNorms, unitRuleFor } from '../lib/authUnits'
import { validationIssues } from '../lib/reports'
import { todayISO } from '../lib/date'

const BASE = blankState()
const today = todayISO()

describe('code defaults', () => {
  it('ABA codes and H2019 bill per 15 minutes, counted by the midpoint rule', () => {
    for (const id of ['97151', '97152', '97153', '97154', '97155', '97156', '97157', '97158', '0362T', '0373T', 'H2019']) {
      expect(BILL_CODES.find((c) => c.id === id).unitMins).toBe(15)
    }
    expect([unitsFor(7, 15), unitsFor(8, 15), unitsFor(37, 15), unitsFor(38, 15)]).toEqual([0, 1, 2, 3])
    expect(autoBilling({ billing: { code: '97153' } }, 60)).toMatchObject({ unitMins: 15, units: 4, rate: 9 })
  })

  it('the per-hour charge did not change when units halved', () => {
    for (const [id, old] of Object.entries(LEGACY_UNIT_DEFAULTS)) {
      const now = BILL_CODES.find((c) => c.id === id)
      expect((now.rate * 60) / now.unitMins).toBeCloseTo((old.rate * 60) / old.unitMins, 2)
    }
  })
})

describe('unit rule for a hand-picked code', () => {
  it('a billing code other than the service’s own drops the service’s unit rule', () => {
    const c = BASE.clients.find((x) => x.insurer === 'Aetna')
    expect(unitRuleFor(BASE, { service: 'dtt', billingCode: '253MT', clientIds: [c.id] }).unitMins).toBe(30)
    expect(unitRuleFor(BASE, { service: 'dtt', clientIds: [c.id] }).rounding).toBe('Nearest') // Aetna's dtt override still applies
  })
})

describe('normalizeUnitNorms (saved workspaces)', () => {
  const billed = new Set(Object.values(BASE.claims).flatMap((c) => c.lines.flatMap((l) => l.apptIds || [l.apptId])))
  const unbilled = Object.values(BASE.appts).find((a) => !billed.has(a.id) && a.billing?.code === '97153' && a.type !== 'drive')
  const billedAppt = Object.values(BASE.appts).find((a) => billed.has(a.id) && a.billing?.code)
  const legacy = {
    ...BASE,
    meta: { ...BASE.meta, unitNorm15: undefined },
    svcs: BASE.svcs.map((s) => (LEGACY_UNIT_DEFAULTS[s.code] ? { ...s, ...LEGACY_UNIT_DEFAULTS[s.code] } : s)),
    appts: { ...BASE.appts, [unbilled.id]: { ...unbilled, end: unbilled.start + 60, billing: { ...unbilled.billing, unitMins: 30, units: 2, rate: 18, minutes: 60 } } },
    payers: BASE.payers.map((p) => (p.name === 'Aetna' ? { ...p, svcOv: { ...p.svcOv, dtt: { ...p.svcOv.dtt, charge: 38, contract: 34 } } } : p)),
    clients: BASE.clients.map((c, i) => (i === 0 ? { ...c, authUnits: { 97153: 100 } } : c)),
  }

  it('moves untouched defaults, scales rates, pools and unbilled sessions; never claims', () => {
    const m = normalizeUnitNorms(legacy)
    expect(m.meta.unitNorm15).toBe(true)
    expect(m.svcs.find((s) => s.code === '97153')).toMatchObject({ unitMins: 15, rate: 9 })
    expect(m.payers.find((p) => p.name === 'Aetna').svcOv.dtt).toMatchObject({ charge: 19, contract: 17 })
    expect(m.clients[0].authUnits['97153']).toBe(200)
    expect(m.appts[unbilled.id].billing.unitMins).not.toBe(30)
    expect(m.appts[billedAppt.id]).toBe(legacy.appts[billedAppt.id])
    expect(m.claims).toBe(legacy.claims)
  })

  it('runs once, and a fresh workspace is left alone', () => {
    const m = normalizeUnitNorms(legacy)
    expect(normalizeUnitNorms(m)).toBe(m)
    expect(normalizeUnitNorms(BASE)).toBe(BASE)
  })
})

describe('same-day aggregation check', () => {
  const c0 = BASE.clients[0]
  const mk = (id, start, units) => ({
    id, date: today, type: 'service', status: 'completed', clientIds: [c0.id], staffIds: [BASE.staff[0].id], start, end: start + 37, notes: 'ok',
    verification: { verifyStatus: 'verified' }, billing: { code: '97153', unitMins: 15, minutes: 37, units, rate: 9 },
  })
  const noMerge = { ...BASE, payers: BASE.payers.map((p) => (p.name === c0.insurer ? { ...p, rules: { ...(p.rules || {}), claims: { flags: { mergeSameDay: false } } } } : p)) }
  const flags = (appts, base = noMerge) => validationIssues({ ...base, appts }, [today]).filter((i) => /counting the day/.test(i.msg))

  it('warns, for a payer that does not merge same-day lines, when per-session rounding bills differently', () => {
    const f = flags({ x1: mk('x1', 540, 2), x2: mk('x2', 700, 2) }) // 74 min once = 5 units, billed 4
    expect(f).toHaveLength(1)
    expect(f[0].msg).toMatch(/2 sessions of 97153 on one day bill 4 units; counting the day's 74 minutes once gives 5/)
    expect(flags({ x1: mk('x1', 540, 3), x2: mk('x2', 700, 2) })).toHaveLength(0)
    expect(flags({ x1: mk('x1', 540, 2), x2: mk('x2', 700, 2) }, BASE)).toHaveLength(0) // default: the claim merges them
  })
})
