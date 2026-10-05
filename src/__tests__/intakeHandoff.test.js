import { describe, it, expect } from 'vitest'
import { blankState, reducer } from '../state/store'
import { gateBlockers, planConversion } from '../lib/intake'
import { handoffServices, proposeIntakeWeek, planHandoffSession } from '../lib/intakeHandoff'
import { addDays, isoDate, parseISO, startOfWeek, todayISO } from '../lib/date'
import { authorizeAction } from '../lib/security'
import { createWorkspaceBackup, readWorkspaceBackup } from '../lib/workspaceBackup'

const BASE = blankState()
const DAY = isoDate(startOfWeek(addDays(parseISO(todayISO()), 7), 1))
const REQ = Object.values(BASE.intakeRequests).find((r) => r.stage === 'auth' && !gateBlockers(r, 'converted').length)
const CONVERSION = planConversion(BASE, REQ.id, { clientId: 'handoff-client' })
const CLIENT = { ...CONVERSION.client, authStart: DAY, authEnd: isoDate(addDays(parseISO(DAY), 60)), authWeekly: 5, authUnits: { 97153: 200 } }
const STATE = { ...BASE, clients: [...BASE.clients, CLIENT], appts: {}, intakeRequests: { ...BASE.intakeRequests, [REQ.id]: CONVERSION.intake }, settings: { ...BASE.settings, weekStart: 1 } }
const SERVICE = handoffServices(STATE, CLIENT.id)[0].id
const OPTIONS = { date: DAY, days: [1, 2, 3, 4, 5], start: 540, duration: 120, service: SERVICE, location: 'Main Center' }
const proposal = (state = STATE, options = OPTIONS) => proposeIntakeWeek(state, CLIENT.id, options)
const session = () => {
  const row = proposal().rows[0]
  return { ...row.draft, id: 'booked-first-session', staffIds: [row.candidates[0].staff.id], recurrence: 'none' }
}
const clientPatch = (patch) => ({ ...STATE, clients: STATE.clients.map((c) => c.id === CLIENT.id ? { ...c, ...patch } : c) })

describe('first-week proposal', () => {
  it('fills the weekly target, shortens the last slot, ranks staff and never mutates state', () => {
    const before = JSON.stringify(STATE)
    const plan = proposal()
    expect(plan.ok).toBe(true)
    expect(plan.rows.map((r) => r.draft.end - r.draft.start)).toEqual([120, 120, 60])
    expect(plan.proposedMinutes).toBe(300)
    expect(plan.remainingMinutes).toBe(0)
    expect(plan.rows.every((r) => r.candidates.length > 0 && r.candidates.length <= 3)).toBe(true)
    expect(plan.rows[0].candidates[0].reasons.length).toBeGreaterThan(0)
    expect(plan.rows[0].candidates[0].score).toBeGreaterThanOrEqual(plan.rows[0].candidates[1].score)
    expect(JSON.stringify(STATE)).toBe(before)
  })
  it('subtracts existing clinical sessions and never proposes overlapping client slots', () => {
    const appt = session()
    const plan = proposal({ ...STATE, appts: { [appt.id]: appt } })
    expect(plan.existingMinutes).toBe(120)
    expect(plan.proposedMinutes).toBe(180)
    expect(plan.rows[0].reason).toMatch(/Client already/)
    expect(plan.rows[0].candidates).toEqual([])
    expect(plan.rows[1].candidates.length).toBeGreaterThan(0)
  })
  it('ignores cancelled sessions for occupancy and budget', () => {
    const appt = { ...session(), status: 'cancelled' }
    expect(proposal({ ...STATE, appts: { [appt.id]: appt } }).proposedMinutes).toBe(300)
  })
  it('accounts for cumulative units even with the authorization guard off', () => {
    const state = clientPatch({ authUnits: { 97153: 8 } })
    state.settings = { ...state.settings, authGuard: { ...state.settings.authGuard, mode: 'off' } }
    const plan = proposal(state)
    expect(plan.proposedMinutes).toBe(120)
    expect(plan.remainingMinutes).toBe(180)
    expect(plan.rows[1].reason).toMatch(/remaining authorized units/)
  })
  it('respects payer unit sizes rather than assuming 15-minute units', () => {
    const state = clientPatch({ authUnits: { 97153: 4 } })
    state.payers = state.payers.map((p) => p.id === CLIENT.payerId ? { ...p, svcOv: { ...p.svcOv, [SERVICE]: { ...p.svcOv?.[SERVICE], unitSize: 30, rounding: 'AMA' } } } : p)
    expect(proposal(state).proposedMinutes).toBe(120)
  })
  it('filters busy staff, reports empty capacity and carries Warn checks without turning them into Stop', () => {
    const row = proposal().rows[0]
    const busy = { ...row.draft, id: 'busy', clientIds: [], staffIds: STATE.staff.map((s) => s.id) }
    const plan = proposal({ ...STATE, appts: { busy } })
    expect(plan.rows[0].reason).toMatch(/No available staff/)
    expect(plan.rows[1].candidates.length).toBeGreaterThan(0)
    expect(row.candidates.some((c) => c.warnings.some((w) => /converted|authorization letter/i.test(w)))).toBe(true)
  })
  it('reports dates outside the auth window and never proposes a past date', () => {
    expect(proposal(clientPatch({ authEnd: isoDate(addDays(parseISO(DAY), -1)) })).ok).toBe(false)
    const plan = proposeIntakeWeek(STATE, CLIENT.id, OPTIONS, { today: isoDate(addDays(parseISO(DAY), 3)) })
    expect(plan.rows.every((r) => r.date >= isoDate(addDays(parseISO(DAY), 3)))).toBe(true)
    expect(proposal(clientPatch({ authStart: isoDate(addDays(parseISO(DAY), 7)) })).rows).toEqual([])
    expect(proposal(clientPatch({ authEnd: DAY })).rows).toHaveLength(1)
  })
  it.each([{ date: '' }, { date: '2026-02-30' }, { days: [] }, { duration: 0 }, { start: NaN }, { start: 1430 }, { service: 'missing' }, { location: '' }])('rejects invalid options %j', (patch) => {
    expect(proposal(STATE, { ...OPTIONS, ...patch }).ok).toBe(false)
  })
  it('requires a linked converted request and an active authorized service', () => {
    expect(proposal({ ...STATE, intakeRequests: {} }).ok).toBe(false)
    expect(proposal(clientPatch({ authUnits: {} })).ok).toBe(false)
    expect(proposal({ ...STATE, svcs: STATE.svcs.map((s) => s.id === SERVICE ? { ...s, status: 'inactive' } : s) }).ok).toBe(false)
  })
})

describe('reviewed handoff transaction', () => {
  it('replans against live state, persists the existing intake link, round-trips and undoes in one step', () => {
    const appt = session()
    const action = { type: 'handoffSessionTx', clientId: CLIENT.id, appt }
    expect(authorizeAction(STATE, action).ok).toBe(true)
    const next = reducer(STATE, action)
    expect(next.appts[appt.id].intakeId).toBe(REQ.id)
    expect(next.history).toHaveLength(STATE.history.length + 1)
    expect(next.intakeRequests).toBe(STATE.intakeRequests)
    expect(readWorkspaceBackup(createWorkspaceBackup(next), STATE).data.appts[appt.id]).toEqual(next.appts[appt.id])
    expect(reducer(next, action)).toBe(next)
    expect(planHandoffSession(next, CLIENT.id, { ...appt, id: 'duplicate-id' }).ok).toBe(false)
    expect(reducer(next, { type: 'undo' }).appts).toEqual(STATE.appts)
  })
  it('refuses a newly introduced Stop overlap in the reducer; Warn saves with a named warning', () => {
    const appt = session()
    const busy = { ...appt, id: 'busy-now', clientIds: [], title: 'Existing session' }
    const withRule = (level) => ({ ...STATE, appts: { [busy.id]: busy }, settings: { ...STATE.settings, appointmentValidations: { ...STATE.settings.appointmentValidations, staff: { ...STATE.settings.appointmentValidations?.staff, overlap: level } } } })
    const stop = withRule('stop')
    expect(planHandoffSession(stop, CLIENT.id, appt).msg).toMatch(/Not booked.*Staff Overlap/)
    expect(reducer(stop, { type: 'handoffSessionTx', clientId: CLIENT.id, appt })).toBe(stop)
    const warning = planHandoffSession(withRule('warn'), CLIENT.id, appt)
    expect(warning.ok).toBe(true)
    expect(warning.msg).toMatch(/Review:.*Staff Overlap/)
  })
  it('rechecks changed authorization at save time with Stop versus Warn semantics', () => {
    const appt = session()
    const state = clientPatch({ authUnits: { 97153: 1 } })
    const withMode = (mode) => ({ ...state, settings: { ...state.settings, authGuard: { ...state.settings.authGuard, mode } } })
    expect(planHandoffSession(withMode('stop'), CLIENT.id, appt).ok).toBe(false)
    const warned = planHandoffSession(withMode('warn'), CLIENT.id, appt)
    expect(warned.ok).toBe(true)
    expect(warned.msg).toMatch(/over by/)
  })
  it('does not commit a removed service/location or cancelled status', () => {
    expect(planHandoffSession(STATE, CLIENT.id, { ...session(), service: 'missing' }).ok).toBe(false)
    expect(planHandoffSession(STATE, CLIENT.id, { ...session(), location: 'missing' }).ok).toBe(false)
    expect(planHandoffSession(STATE, CLIENT.id, { ...session(), status: 'cancelled' }).ok).toBe(false)
  })
  it('does not write after the intake link is removed, or for multi-client/recurring input', () => {
    expect(planHandoffSession({ ...STATE, intakeRequests: {} }, CLIENT.id, session()).ok).toBe(false)
    expect(planHandoffSession(STATE, CLIENT.id, { ...session(), recurrence: 'weekly' }).ok).toBe(false)
    expect(planHandoffSession(STATE, CLIENT.id, { ...session(), clientIds: [CLIENT.id, BASE.clients[0].id] }).ok).toBe(false)
  })
  it('requires calendar write, intake/client view, and in-scope records, even for forged actions', () => {
    const action = { type: 'handoffSessionTx', clientId: CLIENT.id, appt: session() }
    const account = { id: 'handoff-account', roleId: 'handoff-role', status: 'active', officeIds: ['*'] }
    const role = { id: 'handoff-role', permissions: { calendar: 'full', clients: 'view', intake: 'view' } }
    const withAccess = (patch = {}, officeIds = ['*']) => ({ ...STATE, security: { ...STATE.security, currentUserId: account.id, accounts: [...STATE.security.accounts, { ...account, officeIds }], roles: [...STATE.security.roles, { ...role, permissions: { ...role.permissions, ...patch } }] } })
    expect(authorizeAction(withAccess(), action).ok).toBe(true)
    expect(authorizeAction(withAccess({ calendar: 'view' }), action).ok).toBe(false)
    expect(authorizeAction(withAccess({ intake: 'none' }), action).ok).toBe(false)
    expect(authorizeAction(withAccess({ clients: 'none' }), action).ok).toBe(false)
    const restricted = withAccess({}, ['North Clinic'])
    expect(authorizeAction(restricted, action).ok).toBe(false)

  })
})
