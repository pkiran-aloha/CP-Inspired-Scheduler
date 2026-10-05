import { describe, it, expect } from 'vitest'
import { arOf } from '../lib/claims.js'
import { billingKpis } from '../lib/billingKpis.js'
import { blankState } from '../state/store.jsx'

const BASE = blankState()
const AS_OF = '2026-10-05'
const CLIENT_ID = BASE.clients[0].id
const submittedAt = (date) => Date.parse(`${date}T12:00:00.000Z`)

const claim = (id, status, dosFrom, dosTo, charges) => ({
  id, no: id, clientId: CLIENT_ID, payer: 'Aetna', mode: 'insurance', method: 'primary',
  status, dosFrom, dosTo, charges, adj: 0, paid: 0, secondaryPaid: 0, patientPaid: 0,
  submittedAt: status === 'draft' ? null : submittedAt(AS_OF),
  createdAt: submittedAt(AS_OF), lines: [], history: [],
})

const dsoOf = (state) => billingKpis(state, [AS_OF], ['2026-10-04'], { today: AS_OF })
  .find((kpi) => kpi.k === 'dso')

describe('Billing Health DSO', () => {
  it('uses the AR Manager formula, including draft charges in its lookback', () => {
    const state = {
      ...BASE,
      claims: {
        recent: claim('recent', 'submitted', '2026-09-15', '2026-09-15', 900),
        crossesWindow: claim('crosses-window', 'submitted', '2026-07-06', '2026-07-08', 300),
        draft: claim('draft', 'draft', '2026-09-20', '2026-09-20', 1800),
      },
      payments: {},
    }

    const arDso = arOf(state, AS_OF).totals.dso
    const dashboardDso = dsoOf(state)

    expect(arDso).toBe(40) // $1,200 open A/R ÷ ($2,700 / 90 daily charges)
    expect(dashboardDso.value).toBe(arDso)
    expect(dashboardDso.help).toContain('Same DSO as AR Manager')
    expect(dashboardDso.help).toContain('drafts are included')
  })

  it('has no DSO value when the shared 90-day charge lookback is empty', () => {
    const state = { ...BASE, claims: {}, payments: {} }
    expect(arOf(state, AS_OF).totals.dso).toBeNull()
    expect(dsoOf(state).value).toBeNull()
  })
})
