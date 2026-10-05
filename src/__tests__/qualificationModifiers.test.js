import { describe, expect, it } from 'vitest'
import { blankState } from '../state/store'
import { lineModifiers, qualificationModifiersFor, staffQualifierTokens } from '../lib/claims'
import { DEFAULT_QM, EDUCATION_LEVELS } from '../lib/model'
import { ensurePayer, normalizeStaffEducation } from '../lib/master'
import { STAFF } from '../lib/seed'

const BASE = blankState()

const payerWith = (qualMods) => ({ id: 'p', name: 'P', rules: { qualMods } })
const apptFor = (staffId, o = {}) => ({ id: 'a', date: '2026-10-06', start: 540, end: 600, staffIds: [staffId], location: 'Clinic', ...o })
const withStaff = (staff) => ({ staff: [staff], payers: [payerWith(DEFAULT_QM)], appts: {} })

describe('staff education levels', () => {
  it('the demo staff each carry a recorded education level', () => {
    expect(STAFF.length).toBeGreaterThan(0)
    for (const s of STAFF) expect(EDUCATION_LEVELS).toContain(s.education)
  })

  it('the defaults are the education code alone — no hourly code lands on every claim', () => {
    expect(DEFAULT_QM.every((r) => EDUCATION_LEVELS.includes(r.qual))).toBe(true)
    expect(DEFAULT_QM.every((r) => r.m2 === '')).toBe(true)
    expect(ensurePayer({ id: 'x', name: 'X' }).rules.qualMods).toEqual(DEFAULT_QM)
  })
})

describe('qualificationModifiersFor', () => {
  it('matches the recorded education level, first matching row wins', () => {
    const payer = payerWith([
      { qual: 'Specialist', m1: 'U1', m2: '' },
      { qual: "Master's", m1: 'U2', m2: 'U3' },
      { qual: "Bachelor's", m1: 'HN', m2: '' },
    ])
    expect(qualificationModifiersFor({ education: "Master's", role: 'RBT' }, payer)).toEqual({ m1: 'U2', m2: 'U3', qual: "Master's" })
    expect(qualificationModifiersFor({ education: "Bachelor's", role: 'RBT' }, payer).m1).toBe('HN')
    expect(qualificationModifiersFor({ education: 'HS', role: 'RBT' }, payer)).toBeNull()
  })

  it('a role/title key still matches a "·"-part of the role or the credential', () => {
    const payer = payerWith([{ qual: 'Therapist', m1: 'U1', m2: '' }])
    expect(qualificationModifiersFor({ education: '', role: 'Therapist · Early Intervention', cert: 'RBT #24-08-1177' }, payer).m1).toBe('U1')
    expect(qualificationModifiersFor({ education: '', role: 'RBT · EIBI', cert: 'RBT #24-08-1177' }, payer)).toBeNull()
    // a "#number" credential is read as its bare credential too
    expect(qualificationModifiersFor({ cert: 'BCBA #5-12-0034' }, payerWith([{ qual: 'BCBA', m1: 'HO' }])).m1).toBe('HO')
    const tokens = staffQualifierTokens({ cert: 'BCBA #5-12-0034', role: 'BCBA · Clinical Supervisor' })
    expect(tokens).toContain('bcba')
    expect(tokens).toContain('clinical supervisor')
  })

  it('reads a curly apostrophe and a "degree" suffix the same as the picker value', () => {
    expect(qualificationModifiersFor({ education: "Master's" }, payerWith([{ qual: 'Master’s', m1: 'HO' }])).m1).toBe('HO')
    expect(qualificationModifiersFor({ education: "Master's" }, payerWith([{ qual: "Master's degree", m1: 'HO' }])).m1).toBe('HO')
  })

  it('a saved payer with its own rows does not inherit the defaults, and a blank staff row adds nothing', () => {
    const only = payerWith([{ qual: 'HS', m1: 'U9', m2: '' }])
    expect(qualificationModifiersFor({ education: "Master's", role: 'BCBA' }, only)).toBeNull()
    expect(qualificationModifiersFor({ role: 'BCBA' }, payerWith(DEFAULT_QM))).toBeNull()
  })
})

describe('line modifiers carry the qualification pair', () => {
  const rbt = { id: 'x1', role: 'RBT · EIBI', education: "Bachelor's" }

  it('service → credential → qualification pair → place of service', () => {
    const st = withStaff(rbt)
    st.payers[0].svcOv = { dtt: { modifier: 'U6' } }
    st.payers[0].rules.posMods = [{ pos: '11', mod: 'U1' }]
    expect(lineModifiers(st, apptFor('x1', { service: 'dtt' }), 'P', 'insurance')).toBe('U6 HM HN U1')
  })

  it('turning the credential modifier off leaves the qualification pair in place', () => {
    const st = withStaff(rbt)
    st.payers[0].rules.claims = { flags: { credentialMods: false } }
    expect(lineModifiers(st, apptFor('x1'), 'P', 'insurance')).toBe('HN')
  })

  it('caps the line at four modifiers, dropping the place-of-service modifier last', () => {
    const st = withStaff(rbt)
    st.payers[0].rules.claims = { flags: { credentialMods: true } }
    st.payers[0].svcOv = { dtt: { modifier: 'U6' } }
    st.payers[0].rules.qualMods = [{ qual: "Bachelor's", m1: 'HN', m2: 'U2' }]
    st.payers[0].rules.posMods = [{ pos: '11', mod: 'U1' }]
    expect(lineModifiers(st, apptFor('x1', { service: 'dtt' }), 'P', 'insurance')).toBe('U6 HM HN U2')
  })

  it('self-pay invoices carry none of it', () => {
    const st = withStaff(rbt)
    expect(lineModifiers(st, apptFor('x1'), 'P', 'selfpay')).toBe('')
  })
})

describe('normalizeStaffEducation', () => {
  it('clears a value that is not one of the levels and leaves valid or blank rows alone', () => {
    const master = { id: 'a', education: "Master's" }
    const blank = { id: 'b' }
    const junk = { id: 'c', education: 'Wizardry' }
    const state = { staff: [master, blank, junk] }
    const out = normalizeStaffEducation(state)
    expect(out.staff[0]).toBe(master)
    expect(out.staff[1]).toBe(blank)
    expect(out.staff[2].education).toBe('')
    // idempotent, and a workspace that needs nothing comes back as the very same object
    expect(normalizeStaffEducation(out)).toBe(out)
    const clean = { staff: [master, blank] }
    expect(normalizeStaffEducation(clean)).toBe(clean)
  })
})
