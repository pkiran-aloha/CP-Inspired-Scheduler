import { describe, it, expect } from 'vitest'
import { RISK_DEFAULTS, riskCfg, riskFor, riskModel, riskQueue, riskTimeBand, riskLeadBand } from '../lib/risk'

const TODAY = '2026-06-15'
const appt = (id, date, status, extra = {}) => ({
  id, date, status, type: 'service', start: 540, end: 660, staffIds: ['s1'], clientIds: ['c1'],
  billing: { code: '97153', units: 4, rate: 18, mileage: false }, ...extra,
})
const state = (appts, extra = {}) => ({ appts: Object.fromEntries(appts.map((a) => [a.id, a])), clients: [], staff: [], settings: {}, ...extra })

/** A ledger where client c1 misses constantly and c2 never does. */
const ledger = () => {
  const rows = []
  for (let w = 1; w <= 8; w++) {
    const d = `2026-0${w <= 4 ? 4 : 5}-${String(6 + w).padStart(2, '0')}`
    rows.push(appt(`bad-${w}`, d, w % 2 === 0 ? 'no-show' : 'completed', { clientIds: ['c1'] }))
    rows.push(appt(`good-${w}`, d, 'completed', { clientIds: ['c2'] }))
  }
  return rows
}

describe('the model', () => {
  it('fits a base rate on this workspace’s resolved sessions, not on an assumption', () => {
    const m = riskModel(state(ledger()), { today: TODAY })
    expect(m.sample).toBe(16)
    expect(m.events).toBe(4)
    expect(m.base).toBeCloseTo(5 / 18, 2) // Laplace-smoothed
    expect(m.note).toMatch(/Only 16 completed sessions/)
  })
  it('shrinks a client’s own rate toward the practice rate when their history is thin', () => {
    const m = riskModel(state(ledger()), { today: TODAY })
    // c1 missed half their sessions but with only 8 on file the estimate is pulled down
    expect(m.clientRate.c1.rate).toBeLessThan(0.5)
    expect(m.clientRate.c1.rate).toBeGreaterThan(m.base)
  })
  it('trusts the note once the ledger is large enough', () => {
    const big = []
    for (let i = 0; i < 40; i++) big.push(appt(`p${i}`, `2026-05-${String(1 + (i % 28)).padStart(2, '0')}`, i % 5 === 0 ? 'cancelled' : 'completed'))
    expect(riskModel(state(big), { today: TODAY }).note).toMatch(/Fitted on 40 completed sessions/)
  })
  it('never claims a rate above the sanity ceiling', () => {
    const all = Array.from({ length: 30 }, (_, i) => appt(`x${i}`, '2026-05-01', 'no-show'))
    expect(riskModel(state(all), { today: TODAY }).base).toBeLessThanOrEqual(0.55)
  })
  it('exposes its own thresholds so a practice can retune them', () => {
    expect(riskCfg({ risk: { highBand: 80 } })).toMatchObject({ highBand: 80, watchBand: RISK_DEFAULTS.watchBand })
  })
})

describe('scoring one appointment', () => {
  const s = state(ledger())
  const m = riskModel(s, { today: TODAY })
  const slot = { date: TODAY, start: 540, end: 660, type: 'service', staffIds: ['s1'], status: 'confirmed' }

  it('scores a client with a history of missed sessions above a reliable one', () => {
    const bad = riskFor(s, { ...slot, id: 'f1', clientIds: ['c1'] }, m, { today: TODAY })
    const good = riskFor(s, { ...slot, id: 'f2', clientIds: ['c2'] }, m, { today: TODAY })
    expect(bad.score).toBeGreaterThan(good.score)
    expect(bad.factors.some((f) => f.id === 'client' && f.source === 'model')).toBe(true)
  })
  it('separates what the ledger taught it from documented policy', () => {
    const r = riskFor(s, { ...slot, id: 'f1', clientIds: ['c1'], backfilled: true, edited: true }, m, { today: TODAY })
    const ids = r.factors.map((f) => f.id)
    expect(ids).toContain('backfilled')
    expect(ids).toContain('rescheduled')
    expect(r.factors.find((f) => f.id === 'backfilled').source).toBe('policy')
    expect(r.factors.every((f) => Number.isFinite(f.lift) && f.label && f.detail)).toBe(true)
  })
  it('rates a session a week out above the same session tomorrow', () => {
    const far = riskFor(s, { ...slot, id: 'far', clientIds: ['c2'], date: '2026-06-28' }, m, { today: TODAY })
    const near = riskFor(s, { ...slot, id: 'near', clientIds: ['c2'], date: '2026-06-16' }, m, { today: TODAY })
    expect(far.score).toBeGreaterThan(near.score)
    expect(far.factors.find((f) => f.id === 'lead').detail).toMatch(/a week or more out/)
  })
  it('adds an unconfirmed flag close to the session and drops it once confirmed', () => {
    const open = riskFor(s, { ...slot, id: 'u', clientIds: ['c2'], status: 'active', date: '2026-06-17' }, m, { today: TODAY })
    const done = riskFor(s, { ...slot, id: 'u2', clientIds: ['c2'], status: 'confirmed', date: '2026-06-17' }, m, { today: TODAY })
    expect(open.factors.some((f) => f.id === 'unconfirmed')).toBe(true)
    expect(done.factors.some((f) => f.id === 'unconfirmed')).toBe(false)
    expect(open.score).toBeGreaterThan(done.score)
  })
  it('notes a first session with the assigned technician, and stays quiet after continuity exists', () => {
    const fresh = riskFor(s, { ...slot, id: 'n', clientIds: ['c2'], staffIds: ['s9'] }, m, { today: TODAY })
    const known = riskFor(s, { ...slot, id: 'k', clientIds: ['c2'], staffIds: ['s1'] }, m, { today: TODAY })
    expect(fresh.factors.some((f) => f.id === 'continuity')).toBe(true)
    expect(known.factors.some((f) => f.id === 'continuity')).toBe(false)
  })
  it('flags a client the practice has never seen', () => {
    const r = riskFor(s, { ...slot, id: 'new', clientIds: ['c99'] }, m, { today: TODAY })
    expect(r.factors.some((f) => f.id === 'new-client')).toBe(true)
  })
  it('will not score an outcome that is already recorded', () => {
    const r = riskFor(s, { ...slot, id: 'c', clientIds: ['c1'], date: '2026-06-01', status: 'completed' }, m, { today: TODAY })
    expect(r.band).toBe('done')
  })
  it('books a band and a plain-language next step', () => {
    const r = riskFor(s, { ...slot, id: 'f1', clientIds: ['c1'], status: 'active', backfilled: true, date: '2026-06-30' }, m, { today: TODAY })
    expect(['high', 'watch']).toContain(r.band)
    expect(r.action).toMatch(/[Cc]onfirm/)
    expect(r.probability).toBeGreaterThan(0)
    expect(r.probability).toBeLessThan(1)
  })
  it('returns nothing to act on when a practice switches scoring off', () => {
    const off = state(ledger(), { settings: { risk: { enabled: false } } })
    const r = riskFor(off, { ...slot, id: 'f1', clientIds: ['c1'] }, null, { today: TODAY })
    expect(r).toMatchObject({ score: 0, band: 'low', factors: [] })
  })
})

describe('cohort helpers', () => {
  it('bands the time of day and the booking lead time the way the factors describe them', () => {
    expect(riskTimeBand(8 * 60)).toBe('early')
    expect(riskTimeBand(10 * 60)).toBe('morning')
    expect(riskTimeBand(13 * 60)).toBe('midday')
    expect(riskTimeBand(16 * 60)).toBe('afternoon')
    expect(riskTimeBand(19 * 60)).toBe('evening')
    expect(riskLeadBand(0)).toBe('same')
    expect(riskLeadBand(2)).toBe('soon')
    expect(riskLeadBand(6)).toBe('week')
    expect(riskLeadBand(30)).toBe('far')
  })
})

describe('the worklist', () => {
  const s = state([
    ...ledger(),
    appt('risk1', '2026-06-16', 'active', { clientIds: ['c1'] }),
    appt('risk2', '2026-06-22', 'active', { clientIds: ['c1'] }),
    appt('calm', '2026-06-17', 'confirmed', { clientIds: ['c2'] }),
    appt('outside', '2026-08-01', 'active', { clientIds: ['c1'] }),
    appt('gone', '2026-06-16', 'cancelled', { clientIds: ['c1'] }),
  ])
  it('lists only upcoming flagged sessions, worst first, inside the range asked for', () => {
    const q = riskQueue(s, ['2026-06-16', '2026-06-17', '2026-06-22'], { today: TODAY })
    const ids = q.rows.map((r) => r.appt.id)
    expect(ids).toContain('risk1')
    expect(ids).not.toContain('outside')
    expect(ids).not.toContain('gone')
    for (let i = 1; i < q.rows.length; i++) expect(q.rows[i - 1].score).toBeGreaterThanOrEqual(q.rows[i].score)
  })
  it('quantifies what the risk is worth in hours and charge', () => {
    const q = riskQueue(s, ['2026-06-16', '2026-06-22'], { today: TODAY })
    expect(q.summary.scored).toBe(2)
    expect(q.summary.flagged).toBeGreaterThan(0)
    expect(q.summary.expectedLostHours).toBeGreaterThan(0)
    expect(q.summary.expectedLostHours).toBeLessThan(4 * q.summary.flagged) // probability-weighted, not the worst case
    expect(q.summary.chargeAtRisk).toBeGreaterThan(0)
  })
  it('reports the baseline it scored against, so the number is never a black box', () => {
    const q = riskQueue(s, ['2026-06-16'], { today: TODAY })
    expect(q.summary.base).toBeGreaterThan(0)
    expect(q.summary.sample).toBe(16)
    expect(q.summary.note).toMatch(/sessions/)
  })
})
