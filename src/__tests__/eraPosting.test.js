import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'
import { parse835, matchEraLines } from '../lib/era'
import { previewEra, planEraImport, planParkedEraPost } from '../lib/eraPosting'
import { build835ErrorReport } from '../lib/billingDocs'
import { reducer } from '../state/store'

const full = readFileSync(path.join(__dirname, 'fixtures/835-full.txt'), 'utf8')
const claims = Object.fromEntries([300, 200, 150, 400, 250].map((amount, i) => {
  const id = `c${i + 1}`
  return [id, {
    id, no: `CLM-202609-00${i + 1}`, charges: amount, paid: 0, adj: 0,
    status: 'submitted', submittedAt: 100, history: [], clientId: 'client-1', payer: 'Aetna',
    ...(i === 0 ? { dosFrom: '2026-09-01', dosTo: '2026-09-01' } : {}),
  }]
}))
const base = () => ({ claims: structuredClone(claims), payments: {}, eraImports: {}, history: [], settings: { billing: {} }, appts: {} })
// Two fixture CLPs double-count adjustments plus patient responsibility. Correct
// those fields only for the successful-post test; the original remains a guard case.
const balanced = full.replace('CLM-202609-001*1*300*240*60', 'CLM-202609-001*1*300*240*0')
  .replace('CLM-202609-002*4*200*0*200', 'CLM-202609-002*4*200*0*0')
  .replace('CLM-202609-003*2*150*100*0', 'CLM-202609-003*1*150*100*0')
  .replace('CAS*CO*42*60~\nAMT*B6*60', 'CAS*CO*42*60~\nAMT*B6*240')
  .replace('CAS*CO*197*200~\nAMT*B6*200', 'CAS*CO*197*200~\nAMT*B6*0')
  .replace('CAS*CO*42*50~\nAMT*B6*0', 'CAS*CO*42*50~\nAMT*B6*100')
  .replace('CAS*PR*2*50~\nAMT*B6*50', 'CAS*PR*2*50~\nAMT*B6*250')
const ids = (parsed) => parsed.lines.map((l) => l.id)
const options = (parsed, extra = {}) => ({ fileName: 'claims.835', selectedIds: ids(parsed), eraId: 'era-test', at: 1000000, makeId: (() => { let i = 0; return () => `pay-${++i}` })(), ...extra })

describe('claim-level 835 safety planner', () => {
  it('parses metadata/DOS; treats PLB as provider-level; never guesses via payer control', () => {
    const parsed = parse835(full)
    expect(parsed.errors).toEqual([])
    expect(parsed.meta).toMatchObject({ traceNo: '12345', paymentDate: '2024-09-25', bprAmount: 500, payerName: 'AETNA', hasPLB: true })
    expect(parsed.lines[0]).toMatchObject({ dosFrom: '2026-09-01', dosTo: '2026-09-01', patientResp: 60, allowed: 60, plb: null })
    expect(parsed.lines[4].plb).toBeNull()
    expect(parsed.fingerprint).toBe(parse835(full).fingerprint)
    const withWrongCtrl = [{ claimNo: 'unrelated', payerClaimCtrl: claims.c4.no }]
    expect(matchEraLines(withWrongCtrl, claims).matched).toHaveLength(0)
    expect(matchEraLines([{ claimNo: claims.c4.no }], { ...claims, duplicate: { ...claims.c4, id: 'duplicate' } }).matched).toHaveLength(0)
  })

  it('parks financially inconsistent fixture lines instead of double-counting them', () => {
    const state = base()
    const parsed = parse835(full)
    const preview = previewEra(state, parsed)
    expect(preview.errors).toEqual([])
    expect(preview.ready).toBe(1)
    expect(preview.rows[0].reason).toMatch(/exceed charges/i)
    expect(preview.rows[1].reason).toMatch(/exceed charges/i)
    expect(preview.rows[2].reason).toMatch(/Secondary\/tertiary ERA claim/i)
    expect(preview.rows[4].reason).toMatch(/allowed amount/i)
    const plan = planEraImport(state, parsed, options(parsed, { selectedIds: preview.rows.filter((r) => r.ready).map((r) => r.id) }))
    expect(plan.ok).toBe(true)
    expect(plan.era).toMatchObject({ posted: 1, parked: 4, status: 'partial', hasPLB: true })
    expect(plan.era.warnings[0]).toMatch(/BPR total.*CLP payer payments/i)
    expect(plan.payments).toHaveProperty('pay-1')
    expect(plan.claimUpserts.find((c) => c.id === 'c1')).toBeUndefined()
    expect(plan.era.detail[0].reason).toMatch(/exceed charges/i)
    expect(JSON.stringify(plan.era)).not.toContain('NM1*') // do not persist source identifiers
    const noSelection = planEraImport(state, parsed, { fileName: 'unselected.835', eraId: 'all-parked', at: 1000000 })
    expect(noSelection.era).toMatchObject({ posted: 0, parked: 5, status: 'parked' })
    expect(noSelection.payments).toEqual({})
    const applied = reducer(state, { type: 'eraImportTx', parsed, options: { fileName: 'unselected.835', eraId: 'all-parked', at: 1000000 } })
    expect(applied.history[0]).not.toHaveProperty('payments')
    expect(reducer(applied, { type: 'undo' }).eraImports).toEqual(state.eraImports)
  })

  it('posts selected reconciled payments and true CARC denials atomically; Undo restores all ledgers', () => {
    const state = base(), parsed = parse835(balanced)
    const preview = previewEra(state, parsed)
    expect(preview.ready).toBe(5)
    const tx = planEraImport(state, parsed, options(parsed))
    expect(tx.ok).toBe(true)
    expect(tx.era).toMatchObject({ status: 'posted', posted: 5, parked: 0, traceNo: '12345' })
    expect(Object.values(tx.payments)).toHaveLength(4) // denial never creates a fake $0 payment
    expect(tx.claimUpserts.find((c) => c.id === 'c1')).toMatchObject({ paid: 240, adj: 60, status: 'paid' })
    expect(tx.claimUpserts.find((c) => c.id === 'c2')).toMatchObject({ status: 'denied', denial: { code: 'carc:CO-197' } })
    expect(tx.claimUpserts.find((c) => c.id === 'c2').denial.fix).toMatch(/authorization/i)
    expect(tx.claimUpserts.find((c) => c.id === 'c2').history.at(-1).ev).toMatch(/CO-197/)
    expect(tx.claimUpserts.find((c) => c.id === 'c5')).toMatchObject({ paid: 200, status: 'partially_paid', remittance: { patientResp: 50 } })
    expect(Object.values(tx.payments).find((p) => p.claimId === 'c5')).toMatchObject({ kind: 'era835', amount: 200, adj: 0, patientResp: 50, eraId: 'era-test' })
    expect(Object.values(tx.payments).find((p) => p.claimId === 'c1').adj).toBe(60)
    const applied = reducer(state, { type: 'eraImportTx', parsed, options: options(parsed) })
    expect(applied.history).toHaveLength(1)
    expect(applied.claims.c5.status).toBe('partially_paid')
    expect(Object.values(applied.payments)).toHaveLength(4)
    const undone = reducer(applied, { type: 'undo' })
    expect(undone.claims).toEqual(state.claims)
    expect(undone.payments).toEqual(state.payments)
    expect(undone.eraImports).toEqual(state.eraImports)
    expect(reducer(undone, { type: 'eraImportTx', parsed, options: options(parsed) }).eraImports['era-test'].posted).toBe(5)
    expect(planEraImport(state, parsed, options(parsed, { makeId: () => 'same-payment' })).msg).toMatch(/Payment identifier already exists/)
    expect(planEraImport({ ...state, eraImports: { 'era-test': { id: 'era-test' } } }, parsed, options(parsed)).msg).toMatch(/ERA import ID already exists/)
  })

  it('blocks duplicate file dispatches, duplicate CLPs and trace replay even if whitespace changed', () => {
    const state = base(), parsed = parse835(balanced)
    const once = reducer(state, { type: 'eraImportTx', parsed, options: options(parsed) })
    expect(reducer(once, { type: 'eraImportTx', parsed, options: options(parsed, { eraId: 'second-import' }) })).toBe(once)
    expect(planEraImport(once, parsed, options(parsed)).msg).toMatch(/already been imported/i)
    const remixed = parse835(balanced.replace('TRN*1*12345', 'TRN*1*12345 '))
    expect(remixed.fingerprint).not.toBe(parsed.fingerprint)
    expect(previewEra(once, remixed).rows[0].reason).toMatch(/already been posted|only submitted/i)
    const partly = reducer(state, { type: 'eraImportTx', parsed, options: options(parsed, { selectedIds: ['era-line-5'] }) })
    expect(partly.claims.c5.status).toBe('partially_paid')
    const newEnvelope = parse835(balanced.replace('TRN*1*12345', 'TRN*1*new-trace'))
    expect(previewEra(partly, newEnvelope).rows[4].reason).toMatch(/line has already been posted/i)
    const doubleClp = parse835(balanced.replace('LX*2~', 'CLP*CLM-202609-001*1*300*240*0~LX*2~'))
    expect(previewEra(state, doubleClp).rows[0].reason).toMatch(/multiple ERA lines/i)
  })

  it('holds malformed/negative/more-than-two-decimal amounts, unsupported statuses, overpay and non-open claims', () => {
    const parsed = parse835(balanced)
    const bad = parse835(balanced.replace('CLM-202609-001*1*300*240*0', 'CLM-202609-001*1*300*NOPE*0')
      .replace('CAS*CO*42*60', 'CAS*CO*42*-60'))
    expect(bad.errors.join(' ')).toMatch(/invalid amount|negative\/reversal/i)
    expect(planEraImport(base(), bad, options(bad)).ok).toBe(false)
    const withoutTrailer = parse835(balanced.replace('SE*30*0001~', ''))
    expect(withoutTrailer.errors.join(' ')).toMatch(/Missing SE trailer/)
    const wrongControl = parse835(balanced.replace('SE*30*0001', 'SE*30*wrong'))
    expect(wrongControl.errors.join(' ')).toMatch(/control numbers do not match/)
    const missingEnvelope = parse835(balanced.replace('GE*1*1~', '').replace('IEA*1*000000001~', ''))
    expect(missingEnvelope.errors.join(' ')).toMatch(/Missing GE trailer.*Missing IEA trailer/)
    expect(parse835(balanced.replace('GE*1*1', 'GE*1*other')).errors.join(' ')).toMatch(/GS\/GE.*do not match/)
    const missingReason = parse835(balanced.replace('CAS*CO*42*60', 'CAS*CO**60'))
    expect(missingReason.errors.join(' ')).toMatch(/missing adjustment reason/)
    const huge = parse835(balanced.replace('CLM-202609-001*1*300*240*0', 'CLM-202609-001*1*999999999999999999999*240*0'))
    expect(huge.errors.join(' ')).toMatch(/supported cent range/)
    const missingTrace = parse835(balanced.replace('TRN*1*12345*1234567890~', ''))
    expect(missingTrace.errors.join(' ')).toMatch(/Missing TRN/)
    const serviceLines = parse835(balanced.replace('LX*2~', 'SVC*HC:97153*300*240~CAS*CO*42*60~LX*2~'))
    expect(serviceLines.meta.hasSVC).toBe(true)
    expect(previewEra(base(), serviceLines).rows[0].reason).toMatch(/Service-line SVC/i)
    const state = base()
    state.claims.c2.status = 'draft'
    state.claims.c3.status = 'paid'
    state.claims.c4.status = 'void'
    expect(previewEra(state, parsed).rows.slice(1, 4).map((r) => r.ready)).toEqual([false, false, false])
    const over = base()
    over.claims.c1.paid = 100
    expect(previewEra(over, parsed).rows[0].reason).toMatch(/outstanding claim balance/i)
    const badStatus = parse835(balanced.replace('CLM-202609-001*1*', 'CLM-202609-001*22*'))
    expect(previewEra(base(), badStatus).rows[0].reason).toMatch(/unsupported claim status/i)
    const secondary = parse835(balanced.replace('CLM-202609-003*1*', 'CLM-202609-003*2*'))
    expect(previewEra(base(), secondary).rows[2].reason).toMatch(/Secondary\/tertiary/i)
    const synthetic = { ...parsed, lines: [{ ...parsed.lines[0], paid: 240.001 }] }
    expect(previewEra(base(), synthetic).rows[0].reason).toMatch(/invalid or negative/i)
    const wrongDOS = { ...parsed, lines: [{ ...parsed.lines[0], dosFrom: '2026-09-02' }] }
    expect(previewEra(base(), wrongDOS).rows[0].reason).toMatch(/dates of service/i)
    const wrongPayer = base()
    wrongPayer.claims.c1.payer = 'Different Insurance'
    expect(previewEra(wrongPayer, parsed).rows[0].reason).toMatch(/payer.*differs/i)
  })

  it('parks unmatched lines, exports reasons safely, retries only when exact claim appears', () => {
    const state = base()
    delete state.claims.c5
    const parsed = parse835(balanced)
    const initial = planEraImport(state, parsed, options(parsed, { selectedIds: ids(parsed).slice(0, 4) }))
    expect(initial.ok).toBe(true)
    expect(initial.era).toMatchObject({ posted: 4, parked: 1 })
    expect(initial.era.detail[4]).toMatchObject({ decision: 'parked', reason: 'No exact claim number match' })
    const withEra = { ...state, eraImports: initial.eraImports, claims: { ...state.claims, c5: claims.c5 } }
    const retry = planParkedEraPost(withEra, 'era-test', ['era-line-5'], { at: 1000001, makeId: () => 'pay-retry' })
    expect(retry.ok).toBe(true)
    expect(retry.era).toMatchObject({ status: 'posted', posted: 5, parked: 0 })
    expect(retry.payments['pay-retry']).toMatchObject({ amount: 200, patientResp: 50 })
    expect(planParkedEraPost(withEra, 'era-test', ['era-line-1']).ok).toBe(false)
    const applied = reducer(withEra, { type: 'eraRetryTx', eraId: 'era-test', selectedIds: ['era-line-5'], options: { at: 1000001 } })
    expect(applied.history).toHaveLength(1)
    expect(reducer(applied, { type: 'undo' }).eraImports).toEqual(withEra.eraImports)
    expect(reducer(applied, { type: 'undo' }).claims).toEqual(withEra.claims)
    const report = build835ErrorReport(withEra, { eraId: 'era-test' })
    expect(report.content).toMatch(/No exact claim number match/)
    expect(report.content).toContain('CLM-202609-005')
    expect(build835ErrorReport(applied, { eraId: 'era-test' }).content).not.toContain('CLM-202609-005')
    const injection = { ...withEra, eraImports: { 'era-test': { ...initial.era, detail: [{ ...initial.era.detail[4], claimNo: '=1+2', reason: '="evil"' }] } } }
    expect(build835ErrorReport(injection, { eraId: 'era-test' }).content).toContain('"\'=1+2"')
    expect(build835ErrorReport(injection, { eraId: 'era-test' }).content).toContain('"\'=\"\"evil\"\""')
  })

  it('records the incremental adjustment when a claim already has an adjustment', () => {
    const state = base()
    state.claims.c1.adj = 20
    state.claims.c1.paid = 10
    const parsed = parse835(balanced.replace('CLM-202609-001*1*300*240*0', 'CLM-202609-001*1*300*100*0')
      .replace('CAS*CO*42*60', 'CAS*CO*42*40'))
    parsed.lines[0].statusCode = 'manual-partial'
    parsed.lines[0].status = 'partial'
    const row = previewEra(state, parsed).rows[0]
    expect(row).toMatchObject({ ready: true, adj: 60, newAdj: 40, paid: 100 })
    const tx = planEraImport(state, parsed, options(parsed, { selectedIds: [row.id] }))
    expect(tx.claimUpserts[0].adj).toBe(60)
    expect(Object.values(tx.payments)[0].adj).toBe(40)
  })
})
