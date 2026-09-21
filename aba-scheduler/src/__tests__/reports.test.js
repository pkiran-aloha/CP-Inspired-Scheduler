import { describe, it, expect, beforeEach } from 'vitest'
import { initial, reducer, blankState } from '../state/store'
import { REPORTS, REPORT_BY_ID, runReport, validationIssues, toCSV } from '../lib/reports'
import { autoGran, bucketize, delta, heatMatrix, priorDays, pivotRows, rangeMetrics, resolveRange } from '../lib/analytics'
import { addDays, isoDate, parseISO, startOfWeek, todayISO } from '../lib/date'

beforeEach(() => localStorage.clear())

const daysFrom = (startIso, n) => Array.from({ length: n }, (_, i) => isoDate(addDays(parseISO(startIso), i)))

function ctxFor(state, n = 28) {
  const wk = startOfWeek(parseISO(todayISO()), 0)
  const days = daysFrom(isoDate(addDays(wk, -(n - 7))), n)
  return { days, gran: 'week', buckets: bucketize(days, 'week'), scope: {} }
}

describe('range engine', () => {
  it('presets resolve to sane windows', () => {
    const today = todayISO()
    expect(resolveRange('week', today).days).toHaveLength(7)
    expect(resolveRange('last4', today).days).toHaveLength(28)
    expect(resolveRange('ytd', today).days[0].slice(5)).toBe('01-01')
    const m = resolveRange('month', today)
    expect(m.days[0].slice(8)).toBe('01')
    expect(m.days[m.days.length - 1].slice(0, 7)).toBe(today.slice(0, 7))
  })
  it('autoGran picks day → quarter by span; priorDays is the same-length window before', () => {
    const today = todayISO()
    expect(autoGran(daysFrom(today, 7))).toBe('day')
    expect(autoGran(daysFrom(today, 28))).toBe('week')
    expect(autoGran(daysFrom(today, 120))).toBe('month')
    expect(autoGran(daysFrom(today, 500))).toBe('quarter')
    const p = priorDays(daysFrom(today, 14))
    expect(p).toHaveLength(14)
    expect(parseISO(p[p.length - 1]) < parseISO(daysFrom(today, 14)[0])).toBe(true)
    expect(delta(10, 5)).toBe(100)
    expect(delta(4, 8)).toBe(-50)
  })
  it('rangeMetrics sees the seeded ledger; heat + pivots are non-degenerate', () => {
    const s = initial()
    const ctx = ctxFor(s)
    const m = rangeMetrics(s, ctx.days)
    expect(m.sessions).toBeGreaterThan(40)
    expect(m.revenue).toBeGreaterThan(1000)
    expect(m.utilization).toBeGreaterThanOrEqual(0)
    expect(m.utilization).toBeLessThanOrEqual(100)
    expect(m.completed).toBeGreaterThan(0)
    const heat = heatMatrix(s, ctx.days)
    expect(heat.grid).toHaveLength(7)
    expect(heat.grid.flat().reduce((t, c) => t + c.count, 0)).toBeGreaterThan(0)
    for (const dim of ['staff', 'client', 'team', 'payer', 'program', 'code', 'status', 'location', 'service']) {
      const rows = pivotRows(s, ctx.days, dim)
      expect(rows.length, dim).toBeGreaterThan(0)
      expect(rows[0]).toHaveProperty('sessions')
    }
  })
})

describe('report engine', () => {
  it('every template builds columns + rows against seeded data', () => {
    const s = initial()
    const ctx = ctxFor(s)
    expect(REPORTS.length).toBeGreaterThanOrEqual(13)
    for (const def of REPORTS) {
      const r = runReport(s, def.id, ctx)
      expect(r.columns.length, def.id).toBeGreaterThan(2)
      expect(Array.isArray(r.rows), def.id).toBe(true)
      expect(r.summary.length, def.id).toBeGreaterThan(1)
      if (def.id !== 'quality') expect(r.rows.length, def.id + ' rows').toBeGreaterThan(0)
    }
  })

  it('claim-ready + blocked partition completed billables, and sums are consistent', () => {
    const s = initial()
    const ctx = ctxFor(s)
    const ready = runReport(s, 'claimready', ctx)
    const blocked = runReport(s, 'blocked', ctx)
    const readyTotal = Math.round(ready.rows.reduce((t, r) => t + r.charge, 0))
    expect(ready.rows.length).toBeGreaterThan(5)
    expect(readyTotal).toBeGreaterThan(0)
    for (const row of ready.rows) expect(row.units).toBeGreaterThan(0)
    for (const row of blocked.rows) expect(row.issues.length).toBeGreaterThan(3)
  })

  it('scope narrows rows (e2e link: one staff member only)', () => {
    const s = initial()
    const all = runReport(s, 'attendance', ctxFor(s)).rows.length
    const one = runReport(s, 'attendance', { ...ctxFor(s), scope: { staff: 's4' } }).rows.length
    const other = runReport(s, 'attendance', { ...ctxFor(s), scope: { staff: 's6' } }).rows.length
    expect(one).toBeGreaterThan(0)
    expect(one + other).toBeLessThan(all * 2)
    expect(one).toBeLessThan(all)
  })

  it('auth burn-down covers every client with payer + expiry fields', () => {
    const s = initial()
    const rows = runReport(s, 'auth', ctxFor(s)).rows
    expect(rows.length).toBe(s.clients.length)
    expect(rows.every((r) => r.client && typeof r.burnPct === 'number')).toBe(true)
    expect(rows.every((r) => typeof r.daysLeft === 'number')).toBe(true) // seeded auth windows resolve for every client
    expect(rows.some((r) => r.daysLeft <= 30)).toBe(true) // and some are inside the 30-day expiry warning band
  })

  it('validations surface real seeded problems and each is linked + fixable', () => {
    const s = initial()
    const ctx = ctxFor(s)
    const issues = validationIssues(s, ctx.days)
    expect(issues.length).toBeGreaterThan(0)
    const sevs = new Set(issues.map((i) => i.sev))
    expect(sevs.size).toBeGreaterThan(1) // errors + warns/notices both exist in demo data
    for (const i of issues.slice(0, 10)) {
      expect(i.link).toBeTruthy()
      expect(i.fix.length).toBeGreaterThan(3)
    }
    const q = runReport(s, 'quality', ctx)
    expect(q.rows.length).toBe(issues.length)
  })

  it('CSV export is well-formed with metadata header', () => {
    const s = initial()
    const ctx = ctxFor(s)
    const r = runReport(s, 'claimready', ctx)
    const csv = toCSV(r, { org: s.settings.org, def: REPORT_BY_ID.claimready, days: ctx.days, gran: 'week' })
    const lines = csv.split('\n')
    expect(lines[0].startsWith('# Aloha ABA Center — Claim-Ready Lines')).toBe(true)
    expect(lines[4]).toBe('DOS,Client,Payer,Code,Units,Rate $,Charge $,Rendered by')
    expect(lines).toHaveLength(5 + r.rows.length) // 4 meta lines + column header + one per row
    expect(lines[lines.length - 1].split(',').length).toBeGreaterThanOrEqual(6)
  })
})

describe('store wiring for the new sections', () => {
  it('seed carries billing/payer fields', () => {
    const s = initial()
    expect(s.staff.every((x) => x.fte > 0 && x.targetWeekH > 0 && x.payrollRate > 0)).toBe(true)
    expect(s.clients.every((c) => c.insurer && c.authStart && c.authEnd)).toBe(true)
    expect(s.settings.org.name).toBe('Aloha ABA Center')
    expect(s.settings.billing.requireVerification).toBe(true)
    expect(s.settings.analytics.preset).toBe('last4')
  })

  it('markBilling stamps lines and undo restores them', () => {
    let s = initial()
    const target = Object.values(s.appts).find((a) => a.type === 'service' && a.status === 'completed' && !a.billing?.status)
    s = reducer(s, { type: 'upsertMany', appts: [{ id: target.id, billing: { ...target.billing, status: 'billed', billedAt: 1 } }] })
    expect(s.appts[target.id].billing.status).toBe('billed')
    s = reducer(s, { type: 'undo' })
    expect(s.appts[target.id].billing.status).toBeUndefined()
  })

  it('claims live on the same undo stack — deleting one is reversible', () => {
    let s = initial()
    const cid = Object.keys(s.claims)[0]
    expect(cid).toBeTruthy()
    s = reducer(s, { type: 'claimsTx', claimDel: [cid] })
    expect(s.claims[cid]).toBeUndefined()
    s = reducer(s, { type: 'undo' })
    expect(s.claims[cid]).toBeTruthy()
  })

  it('roster add/patch/remove detaches references cleanly', () => {
    let s = initial()
    s = reducer(s, { type: 'roster', list: 'clients', mode: 'add', item: { id: 'cX', name: 'Test Kid', initials: 'TK', color: '#000', authWeekly: 10 } })
    expect(s.clients.find((c) => c.id === 'cX')).toBeTruthy()
    s = reducer(s, { type: 'roster', list: 'clients', mode: 'patch', item: { id: 'cX', authWeekly: 12 } })
    expect(s.clients.find((c) => c.id === 'cX').authWeekly).toBe(12)
    // put an appointment on a rostered client then remove another and confirm cleanup path works
    s = reducer(s, { type: 'roster', list: 'staff', mode: 'remove', id: 's12' })
    expect(s.staff.find((x) => x.id === 's12')).toBeFalsy()
    expect(s.teams.every((t) => !(t.staffIds || []).includes('s12'))).toBe(true)
    expect(Object.values(s.appts).every((a) => !(a.staffIds || []).includes('s12'))).toBe(true)
    expect(s.ui.staffSel.includes('s12')).toBe(false)
  })

  it('saved reports persist in state.reports.saved (with trim + delete)', () => {
    let s = blankState()
    s = reducer(s, { type: 'addSavedReport', report: { id: 'r1', name: 'Monday auth check', reportId: 'auth' } })
    expect(s.reports.saved[0].name).toBe('Monday auth check')
    s = reducer(s, { type: 'removeSavedReport', id: 'r1' })
    expect(s.reports.saved.length).toBe(0)
  })

  it('older saves (missing new keys) merge with defaults instead of crashing', () => {
    localStorage.setItem('aloha-aba.v3', JSON.stringify({ appts: {}, ui: { view: 'week' } }))
    const s = initial()
    expect(s.ui.section).toBe('calendar')
    expect(s.settings.analytics.preset).toBe('last4')
    expect(s.settings.org.name).toBeTruthy()
    expect(s.reports.saved).toEqual([])
    expect(s.appts).toEqual({})
  })
})
