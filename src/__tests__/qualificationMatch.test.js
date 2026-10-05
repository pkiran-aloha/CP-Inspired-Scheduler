import { describe, it, expect } from 'vitest'
import { blankState } from '../state/store'
import { staffSatisfiesQualification, evaluateAppointmentValidations } from '../lib/settingsMasters'
import { BILL_CODES } from '../lib/model'

const BASE = blankState()
const staff = (id) => BASE.staff.find((s) => s.id === id)
const can = (id, code) => BILL_CODES.find((c) => c.id === code).cred.some((r) => staffSatisfiesQualification(BASE.settings, staff(id), r))

describe('staff qualification matching', () => {
  // Regression: held values were compared whole, so "BCBA #5-12-0034" / "BCBA · Clinical Supervisor"
  // never matched the BCBA qualification and every BCBA but one was flagged on BCBA-only codes.
  it('reads the credential out of a cert number or a "Credential · title" role', () => {
    expect(can('s1', '97151')).toBe(true) // BCBA · Clinical Supervisor
    expect(can('s9', '97155')).toBe(true) // BCBA · Field Coordinator
    expect(can('s1', '97153')).toBe(true) // a BCBA covers RBT work
    expect(can('s2', '97153')).toBe(true) // BCaBA · Center Lead
    expect(can('s3', '97153')).toBe(true) // RBT · EIBI
  })

  it('maps job titles through the qualification "Applies to" list', () => {
    expect(can('s10', '97153')).toBe(true) // Lead RBT
    expect(can('s6', '97151')).toBe(true) // Psychologist covers BCBA
  })

  it('still flags people who do not hold the credential', () => {
    expect(can('s3', '97151')).toBe(false) // RBT on a BCBA code
    expect(can('s2', '97151')).toBe(false) // BCaBA on a BCBA-only code
    expect(can('s11', '97153')).toBe(false) // speech-language pathologist
    expect(can('s12', '97153')).toBe(false) // scheduler
  })

  it('the booking check no longer flags a BCBA on 97151', () => {
    const r = evaluateAppointmentValidations(BASE, { id: 'q1', type: 'service', service: 'dtt', staffIds: ['s1'], clientIds: [], status: 'active', date: '2026-10-01', start: 540, end: 600 })
    expect(r.items.some((i) => i.id === 'staff.qualification')).toBe(false)
    const rbt = evaluateAppointmentValidations(BASE, { id: 'q2', type: 'service', service: 'dtt', staffIds: ['s3'], clientIds: [], status: 'active', date: '2026-10-01', start: 540, end: 600 })
    expect(rbt.items.some((i) => i.id === 'staff.qualification')).toBe(true)
  })
})
