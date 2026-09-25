import { describe, it, expect } from 'vitest'
import { arOf, dueOf } from '../lib/claims.js'
import { blankState } from '../state/store.jsx'

describe('C4 AR Manager (chunk 45)', () => {
  it('arOf produces 5 buckets and totals reconcile', () => {
    const state = blankState()
    // make some claims open with different ages
    const now = new Date()
    const iso = (d) => d.toISOString().slice(0,10)
    const daysAgo = (n) => {
      const d = new Date(now.getTime() - n*86400000)
      return iso(d)
    }
    // inject open claims with varying submittedAt
    const base = Object.values(state.claims)[0]
    const clientId = state.clients[0].id
    const claims = {}
    const buckets = [5, 35, 65, 95, 130] // should hit all 5 buckets
    buckets.forEach((days, i)=>{
      const id = `clm-ar-test-${i}`
      claims[id] = {
        ...base,
        id,
        no: `CLM-AR-${i}`,
        clientId,
        payer: i%2===0 ? 'Aetna' : 'Blue Shield CA',
        status: 'submitted',
        charges: 100*(i+1),
        paid: 0,
        adj: 0,
        dosFrom: daysAgo(days+10),
        dosTo: daysAgo(days+10),
        submittedAt: new Date(now.getTime() - days*86400000).getTime(),
        createdAt: new Date(now.getTime() - days*86400000).getTime(),
        history: [],
      }
    })
    const testState = { ...state, claims: { ...state.claims, ...claims }, payments: {} }
    const asOf = iso(now)
    const ar = arOf(testState, asOf)
    expect(ar.byClient.length).toBeGreaterThan(0)
    expect(ar.byPayer.length).toBeGreaterThan(0)
    // totals should equal sum of byClient balances
    const sumByClient = ar.byClient.reduce((s,r)=>s+r.balance,0)
    expect(Math.abs(sumByClient - ar.totals.totalAR)).toBeLessThan(0.01)
    const sumByPayer = ar.byPayer.reduce((s,r)=>s+r.balance,0)
    expect(Math.abs(sumByPayer - ar.totals.totalAR)).toBeLessThan(0.01)
    // should have at least 4 buckets non-zero
    const nonZeroBuckets = Object.values(ar.totals).filter((v)=>typeof v==='number' && v>0).length
    expect(nonZeroBuckets).toBeGreaterThanOrEqual(4)
    // over90 should be sum of 91-120 + 121+
    const over90Calc = (ar.totals['91-120']||0)+(ar.totals['121+']||0)
    expect(Math.abs(over90Calc - ar.totals.over90)).toBeLessThan(0.01)
  })

  it('byClient and byPayer view totals reconcile', () => {
    const state = blankState()
    const ar = arOf(state, new Date().toISOString().slice(0,10))
    const totalByClient = ar.byClient.reduce((s,c)=>s+c.balance,0)
    const totalByPayer = ar.byPayer.reduce((s,p)=>s+p.balance,0)
    expect(Math.abs(totalByClient - totalByPayer)).toBeLessThan(0.02)
    expect(Math.abs(totalByClient - ar.totals.totalAR)).toBeLessThan(0.02)
  })
})
