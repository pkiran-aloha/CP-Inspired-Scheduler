import React from 'react'
import { beforeEach, afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import App from '../App'
import { blankState } from '../state/store'
import { credentialRow, planPduEntry, rbtPduTarget } from '../lib/credentials'
import { runReport } from '../lib/reports'
import { planSettingsOp } from '../lib/settingsMasters'
import { createWorkspaceBackup, readWorkspaceBackup } from '../lib/workspaceBackup'
import { addDays, isoDate, parseISO, todayISO } from '../lib/date'

const KEY = 'aloha-aba.v3'
const saved = () => JSON.parse(localStorage.getItem(KEY))
beforeEach(() => localStorage.clear())
afterEach(() => cleanup())

const BASE = { ...blankState(), cabinet: {}, pdus: {} } // start from no demo credentials or log entries
const today = todayISO()
const day = (n) => isoDate(addDays(parseISO(today), n))
const RBT = BASE.staff.find((s) => /RBT/.test(s.role))
const BCBA = BASE.staff.find((s) => /^BCBA/.test(s.role))
const withPdus = (state, entries) => entries.reduce((st, [id, input]) => ({ ...st, pdus: { ...st.pdus, [id]: planPduEntry(st, input, { id }).item } }), { ...state, pdus: {} })

describe('credentials — BACB baseline + practice PDUs', () => {
  it('an RBT needs a competency assessment and the practice PDU target; a BCBA needs 32 CEUs', () => {
    expect(credentialRow(BASE, RBT, today)).toMatchObject({ credential: 'RBT', required: 12, logged: 0, status: 'Competency assessment due' })
    expect(credentialRow(BASE, BCBA, today)).toMatchObject({ credential: 'BCBA', required: 32, unit: 'CEU', status: '32 h to go' })
    const st = withPdus(BASE, [
      ['p1', { staffId: RBT.id, kind: 'competency', date: day(-60), title: 'Annual competency' }],
      ['p2', { staffId: RBT.id, kind: 'pdu', date: day(-30), hours: 12, title: 'Ethics refresher' }],
      ['p3', { staffId: BCBA.id, kind: 'ceu', date: day(-90), hours: 8, title: 'Supervision CEU' }],
    ])
    expect(['On track', 'Supervision under 5%']).toContain(credentialRow(st, RBT, today).status)
    expect(credentialRow(st, BCBA, today)).toMatchObject({ logged: 8, remaining: 24 })
  })

  it('the practice target is a validated setting, and the renewal date comes from the Cabinet', () => {
    expect(rbtPduTarget(BASE)).toBe(12)
    const op = planSettingsOp(BASE, 'credentials.patch', { patch: { rbtPduHours: '20' } })
    expect(op.ok).toBe(true)
    expect(rbtPduTarget({ settings: { ...BASE.settings, ...op.patch } })).toBe(20)
    expect(planSettingsOp(BASE, 'credentials.patch', { patch: { rbtPduHours: '-1' } }).ok).toBe(false)
    const cab = { c1: { id: 'c1', title: 'BCBA certification', ownerKind: 'staff', ownerId: BCBA.id, category: 'Credential / certification', expiresOn: day(-5), archived: false } }
    expect(credentialRow({ ...BASE, cabinet: cab }, BCBA, today)).toMatchObject({ renewal: day(-5), status: 'Renewal overdue' })
  })

  it('refuses incomplete entries and reports every clinician', () => {
    expect(planPduEntry(BASE, { staffId: RBT.id, kind: 'pdu', date: today, hours: 0.3, title: 'Course' }, { id: 'x' }).ok).toBe(false)
    expect(planPduEntry(BASE, { staffId: 'nope', kind: 'pdu', date: today, hours: 1, title: 'Course' }, { id: 'x' }).ok).toBe(false)
    expect(planPduEntry(BASE, { staffId: RBT.id, kind: 'pdu', date: '', hours: 1, title: 'Course' }, { id: 'x' }).ok).toBe(false)
    const out = runReport(BASE, 'credentials', { days: [today], scope: null })
    expect(out.rows.some((r) => r.name === RBT.name)).toBe(true)
    expect(out.rows.some((r) => r.name === BCBA.name)).toBe(true)
    expect(out.note).toMatch(/BCBA 32 and BCaBA 20 CEUs/)
  })

  it('the log travels in workspace backups; an older backup without it imports with none', () => {
    const st = withPdus(BASE, [['p1', { staffId: RBT.id, kind: 'pdu', date: today, hours: 2, title: 'Ethics refresher' }]])
    expect(readWorkspaceBackup(createWorkspaceBackup(st), blankState()).data.pdus.p1.hours).toBe(2)
    const older = JSON.parse(createWorkspaceBackup(BASE))
    delete older.data.pdus
    expect(readWorkspaceBackup(JSON.stringify(older), blankState()).data.pdus).toEqual({})
  })
})

describe('credentials — Cabinet screen', () => {
  it('logs a PDU entry and saves the practice target', async () => {
    localStorage.setItem(KEY, JSON.stringify(BASE))
    render(<App />)
    fireEvent.click(screen.getByTestId('nav-staff'))
    fireEvent.click(await screen.findByTestId('nav-sub-cabinet'))
    await screen.findByTestId('ceu-log')
    fireEvent.change(screen.getByTestId('ceu-staff'), { target: { value: RBT.id } })
    fireEvent.change(screen.getByTestId('ceu-hours'), { target: { value: '1.5' } })
    fireEvent.change(screen.getByTestId('ceu-title'), { target: { value: 'Ethics refresher' } })
    fireEvent.click(screen.getByTestId('ceu-add'))
    await waitFor(() => expect(Object.values(saved().pdus)).toHaveLength(1))
    expect(Object.values(saved().pdus)[0]).toMatchObject({ staffId: RBT.id, kind: 'pdu', hours: 1.5, title: 'Ethics refresher' })
    fireEvent.change(screen.getByTestId('ceu-target'), { target: { value: '16' } })
    fireEvent.click(screen.getByTestId('ceu-target-save'))
    await waitFor(() => expect(saved().settings.credentials.rbtPduHours).toBe(16))
  })
})
