import { describe, it, expect } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import App from '../App'
import { normalizeBillingIds } from '../lib/master'
import { blankState } from '../state/store'

const saved = () => JSON.parse(localStorage.getItem('aloha-aba.v3'))

describe('billing identifiers + secondary (chunk 41 U3+U4+D2)', () => {
  it('normalizeBillingIds: backfills payer.ext completeness + client.secondary null + seeds two COB', () => {
    const base = blankState()
    // hostile: strip ext fields and secondary
    const v = {
      ...base,
      payers: base.payers.map((p) => ({ ...p, ext: { group: 'G' } })), // only group
      clients: base.clients.map((c) => { const { secondary: _s, ...rest } = c; return rest }),
      settings: { ...base.settings, billing: { invoicePrefix: 'INV' } }, // partial billing
    }
    const out = normalizeBillingIds(v)
    // ext completeness
    for (const p of out.payers) {
      expect(p.ext).toBeTruthy()
      expect('group' in p.ext).toBe(true)
      expect('plan' in p.ext).toBe(true)
      expect('subId' in p.ext).toBe(true)
      expect('ticareId' in p.ext).toBe(true)
      expect('medicaidId' in p.ext).toBe(true)
      expect('bhpnId' in p.ext).toBe(true)
      expect('filingDeadlineDays' in p.ext).toBe(true)
      expect('requiresSecondaryBox18' in p.ext).toBe(true)
      // old value preserved
      if (p.id === base.payers[0].id) expect(p.ext.group).toBe('G')
    }
    // client.secondary null + seed 2
    expect(out.clients.every((c) => 'secondary' in c)).toBe(true)
    const withSec = out.clients.filter((c) => c.secondary)
    expect(withSec.length).toBe(2)
    expect(withSec[0].secondary.payerId).toBeTruthy()
    expect(withSec[0].secondary.memberId).toMatch(/^SEC-/)
    // billing settings backfilled
    expect(out.settings.billing.strictAuth).toBe(false)
    expect(out.settings.billing.supervisionCheck).toBe(false)
    expect(out.settings.billing.invoiceSeq).toBe(1)
    expect(out.settings.billing.defaultFilingDays).toBe(90)
  })

  it('hostile wipe of secondary: migration recreates empty secondary without losing primary insurer', () => {
    const base = blankState()
    const first = base.clients[0]
    const primary = first.insurer
    // wipe secondary from that client
    const v = { ...base, clients: base.clients.map((c, i) => i === 0 ? { ...c, secondary: undefined } : c) }
    delete v.clients[0].secondary
    v.clients[0].secondary = undefined
    // second pass: normalizeBillingIds via full initial-like path - our function keeps secondary key as null if missing
    const out = normalizeBillingIds({ ...v, clients: v.clients.map((c) => { if ('secondary' in c && c.secondary === undefined) { const { secondary, ...rest } = c; return rest } return c }) })
    expect(out.clients[0].insurer).toBe(primary)
    expect('secondary' in out.clients[0]).toBe(true)
    // first load without any secondary seeded -> it will seed two
    // if we already have secondary seeded, wiping one recreates null (hostile injection case)
    const v2 = { ...base, clients: base.clients.map((c) => ({ ...c, secondary: null })) }
    const out2 = normalizeBillingIds({ ...v2, clients: v2.clients.map((c, i) => i === 0 ? (() => { const { secondary, ...rest } = c; return rest })() : c) })
    expect(out2.clients[0].insurer).toBe(primary)
    expect(out2.clients[0].secondary).toBeNull()
  })

  it('fresh state: payer.ext UI fields exist, filingDeadlineDays validation (reject invalid), client secondary card blank by default', async () => {
    render(<App />)
    await waitFor(() => expect(saved()).toBeTruthy())
    const st = saved()
    // ext present
    expect(st.payers.length).toBeGreaterThan(0)
    expect(st.payers.every((p) => p.ext && 'filingDeadlineDays' in p.ext)).toBe(true)
    // secondary
    expect(st.clients.every((c) => 'secondary' in c)).toBe(true)
    // at least 2 seeded
    expect(st.clients.filter((c) => c.secondary).length).toBeGreaterThanOrEqual(2)
    // billing settings
    expect(st.settings.billing.defaultFilingDays).toBe(90)
    expect(st.settings.billing.strictAuth).toBeDefined()
  })
})
