import { describe, it, expect } from 'vitest'
import { parse835, matchEraLines, denialByCARC } from '../lib/era.js'
import fs from 'fs'
import path from 'path'

const fullTxt = fs.readFileSync(path.join(__dirname, 'fixtures/835-full.txt'), 'utf8')
const badTxt = fs.readFileSync(path.join(__dirname, 'fixtures/835-malformed.txt'), 'utf8')

describe('U6 835 parser (chunk 44a)', () => {
  it('parses full fixture: 5 CLP lines incl denial + partial + patientResp', () => {
    const res = parse835(fullTxt)
    expect(res.errors.length).toBe(0)
    expect(res.lines.length).toBe(5)

    const l1 = res.lines[0]
    expect(l1.claimNo).toBe('CLM-202609-001')
    expect(l1.charges).toBe(300)
    expect(l1.paid).toBe(240)
    expect(l1.patientResp).toBe(60)
    expect(l1.adjustments.some((a)=>a.reason==='42')).toBe(true)

    const l2 = res.lines[1]
    expect(l2.claimNo).toBe('CLM-202609-002')
    expect(l2.status).toBe('denied')
    expect(l2.adjustments.some((a)=>a.reason==='197')).toBe(true)

    const l3 = res.lines[2]
    expect(l3.claimNo).toBe('CLM-202609-003')
    expect(l3.paid).toBe(100)
    expect(l3.charges).toBe(150)

    const l5 = res.lines[4]
    expect(l5.claimNo).toBe('CLM-202609-005')
    expect(l5.adjustments.some((a)=>a.group==='PR' && a.reason==='2')).toBe(true) // patient resp
  })

  it('malformed fixture → errors non-empty, never throws', () => {
    const res = parse835(badTxt)
    expect(res.errors.length).toBeGreaterThan(0)
    expect(Array.isArray(res.lines)).toBe(true)
  })

  it('garbage input → errors, empty lines', () => {
    const res = parse835('This is not an 835 at all')
    expect(res.errors.length).toBeGreaterThan(0)
    expect(res.lines.length).toBe(0)
  })

  it('matchEraLines: exact claim no match', () => {
    const claims = {
      'clm-1': { id:'clm-1', no:'CLM-202609-001', charges:300 },
      'clm-2': { id:'clm-2', no:'CLM-202609-002', charges:200 },
    }
    const res = parse835(fullTxt)
    const { matched, unmatched } = matchEraLines(res.lines, claims)
    expect(matched.length).toBe(2)
    expect(matched[0].method).toBe('exact-claim-no')
    expect(unmatched.length).toBe(3)
  })

  it('denialByCARC aggregates', () => {
    const res = parse835(fullTxt)
    const agg = denialByCARC(res.lines)
    expect(agg.length).toBeGreaterThan(0)
    expect(agg.find((a)=>a.reason==='197').amount).toBe(200)
  })
})
