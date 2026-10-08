import { describe, it, expect } from 'vitest'
import { railDecision, authMeter, loadMeter, riskChip } from '../lib/railGlance'

describe('railDecision: one line for the Checks rail', () => {
  it('reads Ready with nothing to report', () => {
    expect(railDecision([])).toMatchObject({ tone: 'ok', headline: 'Ready to book', counts: [], text: 'Ready to book' })
  })
  it('puts the worst tone first and counts each tone', () => {
    const d = railDecision([{ tone: 'flag' }, { tone: 'warn' }, { tone: 'warn' }])
    expect(d.tone).toBe('warn')
    expect(d.text).toBe('Review before booking · 2 to review · 1 noted')
  })
  it('never says clear while required fields are missing', () => {
    expect(railDecision([{ tone: 'flag' }, { tone: 'todo' }]).headline).toBe('Almost there')
    expect(railDecision([{ tone: 'flag' }]).headline).toBe('Clear to book')
    expect(railDecision([{ tone: 'stop' }, { tone: 'todo' }]).text).toBe('Fix before booking · 1 to fix · 1 to fill in')
  })
})

describe('authMeter: authorized hours as used / booked / left', () => {
  const stats = (deliveredHours, committedHours, authorizedHours, week = { hours: 6, cap: 10 }) => ({ deliveredHours, committedHours, window: { authorizedHours }, week })
  it('splits delivered from booked and shares them of the cap', () => {
    const m = authMeter(stats(10, 30, 40))
    expect(m).toMatchObject({ used: 10, booked: 20, left: 10, over: 0, usedPct: 25, bookedPct: 50, tone: 'ok' })
    expect(m.text).toBe('10 h used · 20 h booked · 10 h left of 40 h')
    expect(m.week).toMatchObject({ hours: 6, cap: 10, pct: 60 })
  })
  it('scales to the total and marks the cap when over', () => {
    const m = authMeter(stats(30, 50, 40))
    expect(m).toMatchObject({ over: 10, left: 0, usedPct: 60, bookedPct: 40, capPct: 80, tone: 'warn' })
    expect(m.text).toMatch(/10 h over of 40 h$/)
  })
  it('flags the last tenth and returns nothing without a window', () => {
    expect(authMeter(stats(20, 37, 40)).tone).toBe('flag')
    expect(authMeter(stats(0, 0, 0))).toBeNull()
    expect(authMeter(null)).toBeNull()
    expect(authMeter(stats(1, 2, 10, { hours: 0, cap: 0 })).week).toBeNull()
  })
})

describe('loadMeter and riskChip', () => {
  it('measures a week against target and caps the bar at 100%', () => {
    expect(loadMeter(18, 30)).toMatchObject({ pct: 60, over: false, tone: 'ok', text: '18 of 30 h this week' })
    expect(loadMeter(33, 30)).toMatchObject({ pct: 100, over: true, tone: 'flag', text: '33 of 30 h this week · over target' })
    expect(loadMeter(5, 0)).toBeNull()
  })
  it('names the risk band in words, not only a colour', () => {
    expect(riskChip({ score: 72, band: 'high' })).toMatchObject({ tone: 'warn', text: 'Risk 72/100 · High' })
    expect(riskChip({ score: 12, band: 'low' })).toMatchObject({ tone: 'ok', text: 'Risk 12/100 · Low' })
    expect(riskChip({ score: 0, band: 'done' })).toBeNull()
    expect(riskChip(null)).toBeNull()
  })
})
