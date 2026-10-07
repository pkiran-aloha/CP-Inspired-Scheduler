import React from 'react'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import App from '../App'
import { blankState, StoreProvider, useStore } from '../state/store'
import { ToastProvider } from '../ui/Toast'
import PaymentCenterView from '../components/PaymentCenterView'
import { notificationsFor, incompleteApptsFor, lateFilingClaimsFor } from '../lib/tasks'
import { notificationsCfg, systemConfigFor, DEFAULT_NOTIFICATIONS } from '../lib/settingsMasters'
import { addDays, isoDate, todayISO } from '../lib/date'

const KEY = 'aloha-aba.v3'
const stored = () => { try { return JSON.parse(localStorage.getItem(KEY)) } catch { return null } }
const seed = (st) => localStorage.setItem(KEY, JSON.stringify(st))
const TODAY = todayISO()
const can = () => true
const ids = (feed) => feed.map((n) => n.id)

const base = () => ({
  settings: {}, tasks: {}, clients: [], staff: [], appts: {}, claims: {}, payments: {}, cabinet: {}, intakeRequests: {}, payers: [],
})
const task = (id, dueOn) => ({ id, title: `Task ${id}`, assigneeId: 's1', dueOn, status: 'open', priority: 'normal', createdAt: Date.now(), updatedAt: Date.now(), history: [] })
const doc = (id, expiresOn) => ({ id, title: `Doc ${id}`, expiresOn, archived: false, ownerKind: 'staff', ownerId: 's1' })
const appt = (id, date, status = 'active', type = 'service') => ({ id, type, date, start: 540, end: 600, clientIds: ['c1'], staffIds: ['s1'], status, title: id })
const claim = (id, over = {}) => ({
  id, no: id, clientId: 'c1', payer: 'Aetna', status: 'draft', charges: 100, paid: 0, adj: 0, patientPaid: 0,
  dosFrom: isoDate(addDays(TODAY, -300)), dosTo: isoDate(addDays(TODAY, -290)), lines: [{ code: '97151' }], history: [], ...over,
})

beforeEach(() => { localStorage.clear(); cleanup() })
afterEach(() => cleanup())

describe('notification preference schema (audit CFG-08)', () => {
  it('defaults cover exactly the wired alert sources', () => {
    expect(Object.keys(DEFAULT_NOTIFICATIONS).sort()).toEqual([
      'authExpiry', 'browserToasts', 'deniedClaims', 'intakeSla', 'parkedEra',
      'secondaryReady', 'staffIncompleteAppts', 'staffIncompleteLookbackDays', 'staffQualExpiration',
      'staffQualFrequencyDays', 'staffTasks', 'timelyFiling',
    ])
  })

  it('folds the legacy UI key names onto the canonical keys', () => {
    const cfg = notificationsCfg({ notifications: { qualificationExpiration: false, qualificationExpirationFreq: '7d', incompleteAppointments: false, incompleteLookbackDays: 14, staffBirthday: false } })
    expect(cfg.staffQualExpiration).toBe(false)
    expect(cfg.staffQualFrequencyDays).toBe(7)
    expect(cfg.staffIncompleteAppts).toBe(false)
    expect(cfg.staffIncompleteLookbackDays).toBe(14)
    expect('staffBirthday' in DEFAULT_NOTIFICATIONS).toBe(false) // no alert source — no canonical key
    expect(cfg.staffTasks).toBe(true) // default preserved
  })

  it('a canonical key always wins over a legacy one', () => {
    const cfg = notificationsCfg({ notifications: { staffQualExpiration: true, qualificationExpiration: false } })
    expect(cfg.staffQualExpiration).toBe(true)
  })
})

describe('notificationsFor gates every alert source by its preference', () => {
  it('task reminders: overdue/due-today alerts follow staffTasks', () => {
    const st = base()
    st.tasks = { t1: task('t1', isoDate(addDays(TODAY, -1))), t2: task('t2', TODAY) }
    expect(ids(notificationsFor(st, 's1', TODAY, can))).toEqual(expect.arrayContaining(['tasks-overdue', 'tasks-today']))
    st.settings = { notifications: { staffTasks: false } }
    expect(ids(notificationsFor(st, 's1', TODAY, can))).toEqual([])
  })

  it('credential expiry: the cabinet alert follows staffQualExpiration and its window', () => {
    const st = base()
    st.cabinet = { d1: doc('d1', isoDate(addDays(TODAY, 10))) }
    const on = notificationsFor(st, 's1', TODAY, can)
    expect(on.find((n) => n.id === 'cabinet').text).toContain('within 30 days')
    st.settings = { notifications: { staffQualFrequencyDays: 7 } }
    expect(ids(notificationsFor(st, 's1', TODAY, can))).not.toContain('cabinet') // 10 days out is outside a 7-day window
    st.settings = { notifications: { staffQualFrequencyDays: 30, staffQualExpiration: false } }
    expect(ids(notificationsFor(st, 's1', TODAY, can))).not.toContain('cabinet')
    // legacy '30d' style value still parses
    st.settings = { notifications: { staffQualFrequencyDays: '60d' } }
    expect(notificationsFor(st, 's1', TODAY, can).find((n) => n.id === 'cabinet').text).toContain('within 60 days')
  })

  it('incomplete appointments: past sessions still awaiting completion follow staffIncompleteAppts', () => {
    const st = base()
    st.appts = { a1: appt('a1', isoDate(addDays(TODAY, -3))), a2: appt('a2', isoDate(addDays(TODAY, -2)), 'completed'), a3: appt('a3', isoDate(addDays(TODAY, -2)), 'cancelled'), a4: appt('a4', isoDate(addDays(TODAY, 3))) }
    expect(incompleteApptsFor(st, TODAY).map((a) => a.id)).toEqual(['a1'])
    expect(ids(notificationsFor(st, 's1', TODAY, can))).toContain('incomplete')
    st.settings = { notifications: { staffIncompleteAppts: false } }
    expect(ids(notificationsFor(st, 's1', TODAY, can))).not.toContain('incomplete')
    // lookback window respected
    st.settings = { notifications: { staffIncompleteLookbackDays: 2 } }
    expect(ids(notificationsFor(st, 's1', TODAY, can))).not.toContain('incomplete')
  })

  it('timely filing: staged claims past the filing window follow timelyFiling', () => {
    const st = base()
    st.claims = { c1: claim('c1'), c2: claim('c2', { submittedAt: Date.now() }), c3: claim('c3', { status: 'paid' }) }
    expect(lateFilingClaimsFor(st, TODAY).map((c) => c.id)).toEqual(['c1'])
    expect(ids(notificationsFor(st, 's1', TODAY, can))).toContain('filing')
    st.settings = { notifications: { timelyFiling: false } }
    expect(ids(notificationsFor(st, 's1', TODAY, can))).not.toContain('filing')
  })

  it('parked ERA: unapplied payments follow parkedEra', () => {
    const st = base()
    st.payments = { p1: { id: 'p1', kind: 'unapplied', claimId: null, amount: 50, reversalOf: null } }
    expect(ids(notificationsFor(st, 's1', TODAY, can))).toContain('parked')
    st.settings = { notifications: { parkedEra: false } }
    expect(ids(notificationsFor(st, 's1', TODAY, can))).not.toContain('parked')
  })

  it('secondary ready: eligible primary claims follow secondaryReady', () => {
    const st = base()
    st.payers = [{ id: 'py-sec', name: 'Regence BCBS', status: 'active' }]
    st.clients = [{ id: 'c1', name: 'Client One', secondary: { payerId: 'py-sec', memberId: 'M-1' } }]
    st.claims = { c1: claim('c1', { status: 'partially_paid', payer: 'Aetna' }) }
    expect(ids(notificationsFor(st, 's1', TODAY, can))).toContain('secondary')
    st.settings = { notifications: { secondaryReady: false } }
    expect(ids(notificationsFor(st, 's1', TODAY, can))).not.toContain('secondary')
  })

  it('denied claims: the alert follows deniedClaims', () => {
    const st = base()
    st.claims = { c1: claim('c1', { status: 'denied' }) }
    expect(ids(notificationsFor(st, 's1', TODAY, can))).toContain('denied')
    st.settings = { notifications: { deniedClaims: false } }
    expect(ids(notificationsFor(st, 's1', TODAY, can))).not.toContain('denied')
  })

  it('authorisation expiries: the alert follows authExpiry', () => {
    const st = base()
    st.clients = [{ id: 'c1', name: 'Client One', authEnd: isoDate(addDays(TODAY, 10)) }]
    expect(ids(notificationsFor(st, 's1', TODAY, can))).toContain('auths')
    st.settings = { notifications: { authExpiry: false } }
    expect(ids(notificationsFor(st, 's1', TODAY, can))).not.toContain('auths')
  })

  it('intake SLA: overdue requests follow intakeSla', () => {
    const st = base()
    const old = Date.now() - 40 * 86400000
    st.intakeRequests = { iq1: { id: 'iq1', no: 'INT-1', stage: 'new', urgency: 'routine', createdAt: old, stageSince: old, contacts: [], events: [] } }
    expect(ids(notificationsFor(st, 's1', TODAY, can))).toContain('intake')
    st.settings = { notifications: { intakeSla: false } }
    expect(ids(notificationsFor(st, 's1', TODAY, can))).not.toContain('intake')
  })

  it('role gating still applies on top of preferences', () => {
    const st = base()
    st.claims = { c1: claim('c1', { status: 'denied' }) }
    expect(ids(notificationsFor(st, 's1', TODAY, () => false))).toEqual([])
  })
})

describe('system config schema (audit CFG-09)', () => {
  it('reads the legacy sync key onto the canonical one', () => {
    expect(systemConfigFor({ system: { appointment: { syncVerifTimeToAppt: true } } }).appointment.syncVerificationTime).toBe(true)
    expect(systemConfigFor({ system: { appointment: { syncVerificationTime: false, syncVerifTimeToAppt: true } } }).appointment.syncVerificationTime).toBe(false)
    expect(systemConfigFor({}).appointment.syncVerificationTime).toBe(false)
  })

  it('normalizes a legacy gateway-methods array onto the object', () => {
    const cfg = systemConfigFor({ system: { other: { paymentGatewayMethods: ['card', 'ach'] } } })
    expect(cfg.other.paymentGatewayMethods).toEqual({ creditCard: true, ach: true, hsaFsa: true, appleGooglePay: false })
    expect(systemConfigFor({}).other.paymentGatewayMethods.creditCard).toBe(true)
  })

  it('normalizes a legacy portal-columns array onto the canonical object', () => {
    const cfg = systemConfigFor({ system: { other: { portalBalanceColumns: ['totalCharges', 'currentBalance'] } } })
    expect(cfg.other.clientPortalColumns).toEqual({ totalCharges: true, insurancePaid: true, patientResponsibility: true, currentBalance: true })
    const off = systemConfigFor({ system: { other: { clientPortalColumns: { currentBalance: false } } } })
    expect(off.other.clientPortalColumns.currentBalance).toBe(false)
  })
})

describe('notification & system settings UI (audit CFG-08 / CFG-09)', () => {
  async function openNotifications() {
    fireEvent.click(await screen.findByTestId('nav-settings'))
    await screen.findByTestId('settings-modal')
    fireEvent.click(screen.getByTestId('nav-sub-set-system'))
    fireEvent.click(await screen.findByTestId('set-sys-tab-notifications'))
    await screen.findByTestId('set-sys-notify')
  }

  it('toggles write the canonical keys and the no-source switches are gone', async () => {
    render(<App />)
    await openNotifications()
    // every visible switch gates a real alert
    for (const gone of ['set-notify-birthday', 'set-notify-team', 'set-notify-subordinate', 'set-notify-supervisor', 'set-notify-timesheet', 'set-notify-assignment']) {
      expect(screen.queryByTestId(gone)).toBeNull()
    }
    fireEvent.click(screen.getByTestId('set-notify-tasks'))
    await waitFor(() => expect(stored().settings.notifications.staffTasks).toBe(false))
    fireEvent.click(screen.getByTestId('set-notify-qualexp'))
    await waitFor(() => expect(stored().settings.notifications.staffQualExpiration).toBe(false))
    fireEvent.click(screen.getByTestId('set-notify-denied'))
    await waitFor(() => expect(stored().settings.notifications.deniedClaims).toBe(false))
    fireEvent.click(screen.getByTestId('set-notify-qualexp'))
    await waitFor(() => expect(stored().settings.notifications.staffQualExpiration).toBe(true))
    fireEvent.change(screen.getByTestId('set-notify-qualexp-freq'), { target: { value: '7d' } })
    await waitFor(() => expect(stored().settings.notifications.staffQualFrequencyDays).toBe(7))
  })

  it('gateway methods and portal columns round-trip through the canonical object', async () => {
    render(<App />)
    fireEvent.click(await screen.findByTestId('nav-settings'))
    await screen.findByTestId('settings-modal')
    fireEvent.click(screen.getByTestId('nav-sub-set-system'))
    fireEvent.click(await screen.findByTestId('set-sys-tab-other'))
    fireEvent.click(await screen.findByTestId('set-other-pay-appleGooglePay'))
    await waitFor(() => expect(stored().settings.system.other.paymentGatewayMethods.appleGooglePay).toBe(true))
    expect(screen.getByTestId('set-other-pay-appleGooglePay').className).toContain('on') // reflects after save
    fireEvent.click(screen.getByTestId('set-other-col-currentBalance'))
    await waitFor(() => expect(stored().settings.system.other.clientPortalColumns.currentBalance).toBe(false))
    expect(screen.getByTestId('set-other-col-currentBalance').className).not.toContain('on')
    // no legacy array keys are written
    expect(stored().settings.system.other.portalBalanceColumns).toBeUndefined()
    expect(Array.isArray(stored().settings.system.other.paymentGatewayMethods)).toBe(false)
  })

  it('the Enable ERA switch gates 835 import in the Payment Center', async () => {
    const st = blankState()
    st.settings.system = { ...(st.settings.system || {}), billing: { enableEra: false } }
    seed(st)
    render(<ToastProvider><StoreProvider><PaymentCenterView /></StoreProvider></ToastProvider>)
    expect((await screen.findByTestId('pc-open-era')).disabled).toBe(true)
  })

  it('browser toasts surface stop-tone inbox alerts once per session when enabled', async () => {
    const st = blankState()
    const yesterday = isoDate(addDays(TODAY, -1))
    st.tasks = { 't-overdue': task('t-overdue', yesterday) }
    st.settings = { ...st.settings, notifications: { ...(st.settings.notifications || {}), browserToasts: true } }
    seed(st)
    render(<App />)
    expect((await screen.findAllByText(/Inbox: /)).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/overdue/).length).toBeGreaterThan(0)
  })

  it('browser toasts stay silent when the preference is off', async () => {
    const st = blankState()
    st.tasks = { 't-overdue': task('t-overdue', isoDate(addDays(TODAY, -1))) }
    seed(st)
    render(<App />)
    await screen.findByTestId('navrail')
    expect(screen.queryByText(/^Inbox: /)).toBeNull()
  })
})
