import React from 'react'
import { beforeEach, afterEach, describe, it, expect } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react'
import App from '../App'
import { blankState } from '../state/store'
import { gateBlockers, planConversion } from '../lib/intake'
import { addDays, isoDate, parseISO, startOfWeek, todayISO } from '../lib/date'

const KEY = 'aloha-aba.v3'
const stored = () => JSON.parse(localStorage.getItem(KEY))
const BASE = blankState()
const DAY = isoDate(startOfWeek(addDays(parseISO(todayISO()), 7), 1))
const REQ = Object.values(BASE.intakeRequests).find((r) => r.stage === 'auth' && !gateBlockers(r, 'converted').length)
const CONVERSION = planConversion(BASE, REQ.id, { clientId: 'handoff-client' })
const CLIENT = { ...CONVERSION.client, home: 'Main Center', authStart: DAY, authEnd: isoDate(addDays(parseISO(DAY), 60)), authWeekly: 5, authUnits: { 97153: 200 } }
const STATE = { ...BASE, appts: {}, clients: [...BASE.clients, CLIENT], intakeRequests: { ...BASE.intakeRequests, [REQ.id]: { ...CONVERSION.intake, preferredDays: 'Family to confirm', preferredTimes: 'After breakfast' } }, settings: { ...BASE.settings, weekStart: 1 }, ui: { ...BASE.ui, section: 'clients', cliOpen: CLIENT.id } }
beforeEach(() => localStorage.clear())
afterEach(() => cleanup())

async function open(state = STATE) {
  localStorage.setItem(KEY, JSON.stringify(state))
  render(<App />)
  fireEvent.click(await screen.findByTestId('iq-handoff-open'))
  await screen.findByTestId('iq-handoff')
}
function generate() { fireEvent.click(screen.getByTestId('iq-handoff-generate')) }

describe('intake → first-week handoff', () => {
  it('opens from the converted chart, proposes without writing, and books only the reviewed session', async () => {
    await open()
    expect(screen.getByText(/Family to confirm/)).toBeTruthy()
    expect(screen.getByTestId('iq-handoff-verify')).toBeTruthy()
    generate()
    expect(screen.getAllByTestId(/^iq-handoff-review-/)).toHaveLength(3)
    expect(screen.getByTestId('iq-handoff-summary').textContent).toMatch(/5h.*proposed/)
    expect(Object.values(stored().appts)).toHaveLength(0)
    const select = screen.getByTestId(`iq-handoff-staff-${DAY}`)
    const chosen = select.options[1].value
    fireEvent.change(select, { target: { value: chosen } })
    fireEvent.click(screen.getByTestId(`iq-handoff-review-${DAY}`))
    expect(await screen.findByTestId('save-appt')).toBeTruthy()
    expect(screen.getByTestId('appt-date').value).toBe(DAY)
    expect(Object.values(stored().appts)).toHaveLength(0)
    fireEvent.click(screen.getByTestId('save-appt'))
    await screen.findByTestId('iq-handoff')
    await waitFor(() => expect(Object.values(stored().appts)).toHaveLength(1))
    const appt = Object.values(stored().appts)[0]
    expect(appt).toMatchObject({ type: 'service', date: DAY, start: 540, end: 660, clientIds: [CLIENT.id], staffIds: [chosen], intakeId: REQ.id, recurrence: 'none' })
    expect(appt.billing.code).toBe('97153')
    expect(screen.getByTestId('iq-handoff-first').textContent).toMatch(/First service on calendar:/)
    expect(screen.queryByTestId(`iq-handoff-review-${DAY}`)).toBeNull()
    expect(screen.getAllByTestId(/^iq-handoff-review-/)).toHaveLength(2)
    // A proposal and the booking review add no extra Undo slots.
    fireEvent.click(screen.getByTestId('iq-handoff-close'))
    fireEvent.keyDown(window, { key: 'u' })
    await waitFor(() => expect(Object.values(stored().appts)).toHaveLength(0))
    expect(stored().clients.some((c) => c.id === CLIENT.id)).toBe(true)
    expect(stored().intakeRequests[REQ.id].stage).toBe('converted')
  })
  it('cancelling the booking dialog creates nothing; changing options invalidates the proposal', async () => {
    await open()
    generate()
    fireEvent.click(screen.getByTestId(`iq-handoff-review-${DAY}`))
    const dialog = await screen.findByRole('dialog', { name: /Create .* appointment/i })
    fireEvent.keyDown(dialog, { key: 'Escape' })
    await screen.findByTestId('iq-handoff')
    expect(Object.values(stored().appts)).toHaveLength(0)
    fireEvent.change(screen.getByTestId('iq-handoff-duration'), { target: { value: '60' } })
    expect(screen.queryByTestId('iq-handoff-results')).toBeNull()
    generate()
    expect(screen.getAllByTestId(/^iq-handoff-review-/)).toHaveLength(5)
  })
  it('has an entry on the converted intake, including older converted charts', async () => {
    localStorage.setItem(KEY, JSON.stringify({ ...STATE, ui: { ...BASE.ui, section: 'intake', intakeSel: REQ.id } }))
    render(<App />)
    fireEvent.click(await screen.findByTestId('iq-plan-first-week'))
    expect(await screen.findByTestId('iq-handoff')).toBeTruthy()
    expect(screen.getByTestId('iq-handoff-first').textContent).toMatch(/No service session/)
  })
  it('new conversion keeps the profile landing and offers the handoff immediately', async () => {
    const req = { ...REQ, auth: { ...REQ.auth, windowStart: DAY, windowEnd: isoDate(addDays(parseISO(DAY), 60)) } }
    localStorage.setItem(KEY, JSON.stringify({ ...BASE, appts: {}, intakeRequests: { ...BASE.intakeRequests, [req.id]: req }, ui: { ...BASE.ui, section: 'intake', intakeSel: req.id } }))
    render(<App />)
    fireEvent.click(await screen.findByTestId('iq-advance'))
    fireEvent.click(await screen.findByTestId('iq-convert-confirm'))
    fireEvent.click(await screen.findByTestId('iq-handoff-open'))
    expect(await screen.findByTestId('iq-handoff')).toBeTruthy()
    await waitFor(() => expect(stored().intakeRequests[req.id].stage).toBe('converted'))
    expect(Object.keys(stored().appts)).toHaveLength(0)
  })
  it('shows clear invalid/empty states without saving anything', async () => {
    await open()
    fireEvent.change(screen.getByTestId('iq-handoff-location'), { target: { value: '' } })
    generate()
    expect(within(screen.getByTestId('iq-handoff-results')).getByRole('alert').textContent).toMatch(/location/)
    expect(screen.queryAllByTestId(/^iq-handoff-review-/)).toHaveLength(0)
    expect(Object.values(stored().appts)).toHaveLength(0)
  })
  it('does not offer the handoff to calendar view-only roles, even via a deep link', async () => {
    const security = { ...STATE.security, currentUserId: 'account-s3',
      accounts: STATE.security.accounts.map((a) => a.id === 'account-s3' ? { ...a, officeIds: ['*'] } : a),
      roles: STATE.security.roles.map((r) => r.id === 'clinician' ? { ...r, permissions: { clients: 'view', calendar: 'view', intake: 'view' } } : r) }
    localStorage.setItem(KEY, JSON.stringify({ ...STATE, security, ui: { ...STATE.ui, cliHandoff: CLIENT.id } }))
    render(<App />)
    await screen.findByTestId('profile-modal')
    expect(screen.queryByTestId('iq-handoff-open')).toBeNull()
    expect(screen.queryByTestId('iq-handoff')).toBeNull()
  })
})
