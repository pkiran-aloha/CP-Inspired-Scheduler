import React from 'react'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within, fireEvent as fire } from '@testing-library/react'
import App from '../App'
import { blankState, reducer } from '../state/store'
import { Seg } from '../components/settings/kit'

describe('settings kit Seg', () => {
  it('ignores clicks when disabled, so read-only users cannot change a segmented setting', () => {
    const picks = []
    const opts = [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }]
    const { getByText, rerender, unmount } = render(<Seg value="a" options={opts} onChange={(v) => picks.push(v)} disabled />)
    expect(getByText('B').disabled).toBe(true)
    fireEvent.click(getByText('B'))
    expect(picks).toEqual([])
    rerender(<Seg value="a" options={opts} onChange={(v) => picks.push(v)} />)
    fireEvent.click(getByText('B'))
    expect(picks).toEqual(['b'])
    unmount()
  })
})

const KEY = 'aloha-aba.v3'
const stored = () => { try { return JSON.parse(localStorage.getItem(KEY)) } catch { return null } }
let _r = null
function cleanup() { if (_r) { _r.unmount(); _r = null } }
beforeEach(() => { localStorage.clear(); cleanup() })
afterEach(() => cleanup())
const R = (ui) => { cleanup(); _r = render(ui); return _r }

async function openModule(id) {
  R(<App />)
  fireEvent.click(await screen.findByTestId('nav-settings'))
  fireEvent.click(await screen.findByTestId(`nav-sub-set-${id}`))
  await screen.findByTestId(`settings-panel-${id}`)
}
const commit = (testid, value) => { const el = screen.getByTestId(testid); fire.change(el, { target: { value } }); fire.blur(el) }

describe('settings modules actually write', () => {
  it('edits the practice identity through Organization', async () => {
    await openModule('organization')
    commit('set-org-name', 'Kiran Behavioral Health')
    await waitFor(() => expect(stored().settings.org.name).toBe('Kiran Behavioral Health'))
    commit('set-org-npi', '123')
    await waitFor(() => expect(stored().settings.org.npi).not.toBe('123')) // guarded op keeps the last good value
  })

  it('adds an appointment status and reverses it with one Undo at the reducer', async () => {
    await openModule('appointment-status')
    fireEvent.click(screen.getByTestId('set-status-add'))
    await screen.findByTestId('set-status-editor')
    commit('set-status-f-label', 'Family cancelled')
    commit('set-status-f-key', 'family-cancel')
    fireEvent.click(screen.getByTestId('set-status-f-band'))
    fireEvent.click(screen.getByTestId('set-status-save'))
    await waitFor(() => expect((stored().settings.apptStatuses || []).some((s) => s.key === 'family-cancel')).toBe(true))
    const row = stored().settings.apptStatuses.find((s) => s.key === 'family-cancel')
    expect(row.label).toBe('Family cancelled')
    expect(row.cancelBand).toBe(true)

    // one durable transition → exactly one Undo restores the previous status list
    const before = blankState()
    const next = reducer(before, { type: 'settingsTx', op: 'status.upsert', payload: { item: { key: 'tentative', label: 'Tentative' } } })
    expect(next.settings.apptStatuses.some((s) => s.key === 'tentative')).toBe(true)
    const back = reducer(next, { type: 'undo' })
    expect(back.settings.apptStatuses.some((s) => s.key === 'tentative')).toBe(false)
  })

  it('changes the pay cycle, workweek and overtime rules in Payroll', async () => {
    await openModule('payroll')
    fireEvent.change(screen.getByTestId('set-pay-weekstart'), { target: { value: '3' } })
    await waitFor(() => expect(stored().settings.payroll.workWeekStart).toBe(3))
    fireEvent.click(screen.getByTestId('nav-sub-set-payroll-overtime'))
    const mult = screen.getByTestId('set-ot-mult')
    fire.change(mult, { target: { value: '1.2' } })
    fire.blur(mult)
    await waitFor(() => expect(stored().settings.payroll.otMultiplier).toBeGreaterThanOrEqual(1.5)) // FLSA floor holds
  })

  it('labels daily, double-time and seventh-day overtime controls as informational — not priced (audit CFG-05)', async () => {
    await openModule('payroll')
    fireEvent.click(await screen.findByTestId('nav-sub-set-payroll-overtime'))
    const note = await screen.findByTestId('set-ot-daily-note')
    expect(note.textContent).toMatch(/policy note only/i)
    expect(note.textContent).toMatch(/never change a calculated wage/i)
    const offices = screen.getByTestId('set-ot-offices-note')
    expect(offices.textContent).toMatch(/Weekly OT/)
    expect(offices.textContent).toMatch(/informational policy notes/i)
    // the controls themselves carry the hint on their rows
    const dailyHours = screen.getByTestId('set-ot-daily-hours').closest('.set-row')
    expect(dailyHours.getAttribute('title')).toMatch(/not priced/i)
  })

  it('a raw setSettings write is one undoable transaction (audit CFG-12)', async () => {
    // reducer: one write → exactly one Undo restores the previous settings, nothing else
    const before = blankState()
    const next = reducer(before, { type: 'setSettings', patch: { h24: true, mileageRate: 0.75 } })
    expect(next.settings.h24).toBe(true)
    expect(next.settings.mileageRate).toBe(0.75)
    expect(next.history.length).toBe(before.history.length + 1)
    const back = reducer(next, { type: 'undo' })
    expect(back.settings.h24).toBe(false)
    expect(back.settings.mileageRate).toBe(before.settings.mileageRate)
    expect(back.appts).toBe(next.appts) // unrelated collections are untouched
    expect(back.history.length).toBe(before.history.length)

    // UI: a System panel write persists, and one Undo (the global shortcut) reverses it
    await openModule('system')
    fireEvent.click(screen.getByTestId('set-sys-h24'))
    await waitFor(() => expect(stored().settings.h24).toBe(true))
    fireEvent.keyDown(window, { key: 'u' })
    await waitFor(() => expect(stored().settings.h24).toBe(false))
  })

  it('adds a service-type custom list with an option', async () => {
    await openModule('custom-lists')
    fireEvent.click(screen.getByTestId('nav-sub-set-custom-lists-service-type'))
    fireEvent.click(screen.getByTestId('set-list-add'))
    await screen.findByTestId('set-list-editor')
    commit('set-list-f-name', 'Group size')
    fireEvent.click(screen.getByTestId('set-list-save'))
    await waitFor(() => expect((stored().settings.customLists || []).some((l) => l.name === 'Group size' && l.group === 'service-type')).toBe(true))
  })

  it('adds a qualification that staff records can pick up', async () => {
    await openModule('qualification')
    fireEvent.click(screen.getByTestId('set-qual-add'))
    await screen.findByTestId('set-qual-editor')
    commit('set-qual-f-name', 'BCBA Supervision Certificate')
    fireEvent.click(screen.getByTestId('set-qual-save'))
    await waitFor(() => expect((stored().settings.qualifications || []).some((q) => q.name === 'BCBA Supervision Certificate')).toBe(true))
  })

  it('keeps messaging off until switched on, and refuses an unknown merge field', async () => {
    await openModule('text-messaging')
    await waitFor(() => expect(stored()).toBeTruthy())
    expect(stored().settings.textMessaging.enabled).toBe(false)
    // the guard refuses to switch texting on with no sender identity
    fireEvent.click(screen.getByTestId('set-msg-enabled'))
    await waitFor(() => expect(screen.getByTestId('set-msg-enabled').getAttribute('aria-pressed')).toBe('false'))
    commit('set-msg-number', '(408) 555-0199')
    fireEvent.click(screen.getByTestId('set-msg-enabled'))
    await waitFor(() => expect(stored().settings.textMessaging.enabled).toBe(true))
    fireEvent.click(screen.getByTestId('set-msg-add'))
    await screen.findByTestId('set-msg-editor')
    commit('set-msg-f-name', 'Reminder')
    commit('set-msg-f-body', 'Hi {{unicorn}} — see you soon at the clinic!')
    fireEvent.click(screen.getByTestId('set-msg-save'))
    await waitFor(() => expect((stored().settings.textMessaging.templates || []).some((t) => t.name === 'Reminder')).toBe(false))
  })

  it('records subscription changes and keeps the portal link external-only', async () => {
    await openModule('subscription')
    const seats = screen.getByTestId('set-sub-seats')
    fire.change(seats, { target: { value: '14' } })
    fire.blur(seats)
    await waitFor(() => expect(stored().settings.subscription.seats).toBe(14))
    fireEvent.change(screen.getByTestId('set-sub-cycle'), { target: { value: 'monthly' } })
    await waitFor(() => expect(stored().settings.subscription.billingCycle).toBe('monthly'))
    const portal = screen.getByTestId('set-sub-portal')
    expect(portal.getAttribute('href')).toMatch(/^https:\/\//)
    expect(portal.getAttribute('target')).toBe('_blank')
  })

  it('toggles the real notification keys the guard accepts', async () => {
    await openModule('system')
    fireEvent.click(screen.getByTestId('set-sys-filing'))
    await waitFor(() => expect(stored().settings.notifications.timelyFiling).toBe(false))
    fireEvent.click(screen.getByTestId('set-sys-toasts'))
    await waitFor(() => expect(stored().settings.notifications.browserToasts).toBe(true))
  })

  it('persists the ⚡ ABA Hours targets and validation severities', async () => {
    await openModule('system')
    fireEvent.click(screen.getByTestId('set-sys-tab-appointment'))
    await screen.findByTestId('set-sys-aba')
    expect(screen.getByTestId('set-aba-banner').textContent).toMatch(/non-service/i)
    commit('set-aba-target-technician', '60')
    await waitFor(() => expect(stored().settings.abaHours.targets.technician).toBe(60))
    fireEvent.click(screen.getByTestId('set-aba-require'))
    await waitFor(() => expect(stored().settings.abaHours.requireActivity).toBe(false))

    fireEvent.click(screen.getByTestId('set-sys-tab-validations'))
    const seg = await screen.findByTestId('set-val-aba-serviceAppt')
    fireEvent.click(within(seg).getByRole('button', { name: 'Warn' }))
    await waitFor(() => expect(stored().settings.appointmentValidations.aba.serviceAppt).toBe('warn'))
    // the rule hints name the practice's non-examples (rendered as the row tooltip)
    const hints = [...screen.getByTestId('set-val-aba').querySelectorAll('.set-row')].map((r) => r.getAttribute('title')).join(' ')
    expect(hints).toMatch(/cleaning the clinic/i)
    expect(hints).toMatch(/stimulus preparation/i)
  })

  it('exposes and persists the evaluator-backed travel and client-assignment validation controls', async () => {
    await openModule('system')
    fireEvent.click(screen.getByTestId('set-sys-tab-validations'))

    const travel = await screen.findByTestId('set-val-staff-travel')
    fireEvent.click(within(travel).getByRole('button', { name: 'Stop' }))
    await waitFor(() => expect(stored().settings.appointmentValidations.staff.travel).toBe('stop'))

    const assignment = screen.getByTestId('set-val-client-assignment')
    fireEvent.click(within(assignment).getByRole('button', { name: 'Warn' }))
    await waitFor(() => expect(stored().settings.appointmentValidations.client.assignment).toBe('warn'))
    expect(stored().settings.appointmentValidations.client).not.toHaveProperty('clientAssignment')
    expect(screen.queryByTestId('set-val-client-clientAssignment')).toBeNull()
  })

  it('imports a pasted CSV, logs it, and shows the new client in the roster', async () => {
    const { unmount } = R(<App />)
    fireEvent.click(await screen.findByTestId('nav-settings'))
    fireEvent.click(await screen.findByTestId('nav-sub-set-data-import'))
    await screen.findByTestId('settings-panel-data-import')
    await waitFor(() => expect(stored()).toBeTruthy())
    fireEvent.click(screen.getByTestId('set-import-type-clients'))
    fireEvent.click(screen.getByTestId('set-import-paste-toggle'))
    const office = stored().settings.offices.find((o) => o.active !== false).name
    fireEvent.change(screen.getByTestId('set-import-paste'), { target: { value: `Client name,Date of birth,Sex,Home location\nUmi Sato,2019-02-03,F,${office}` } })
    fireEvent.click(screen.getByTestId('set-import-paste-load'))
    await screen.findByTestId('set-import-preview')
    fireEvent.click(screen.getByTestId('set-import-commit'))
    await waitFor(() => expect((stored().clients || []).some((c) => c.name === 'Umi Sato')).toBe(true))
    const log = stored().settings.importLog || []
    expect(log.length).toBeGreaterThan(0)
    expect(log[log.length - 1].counts.created).toBe(1)
    expect(log[log.length - 1].type).toBe('clients')
    expect(document.querySelector('[data-testid^="set-import-log-"]')).toBeTruthy()
    unmount()
  })
})
