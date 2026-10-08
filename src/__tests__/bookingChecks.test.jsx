import React from 'react'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within, waitFor } from '@testing-library/react'
import App from '../App'
import { blankState } from '../state/store'
import { candidateVerdicts, authChip } from '../lib/bookingChecks'
import { todayISO } from '../lib/date'

beforeEach(() => { localStorage.clear(); cleanup() })
afterEach(() => cleanup())

const today = todayISO()

describe('candidate verdicts: know before you pick', () => {
  it('says who is already booked across the slot, and who cannot render the code', () => {
    const s = blankState()
    const busy = Object.values(s.appts).find((a) => a.type === 'service' && a.date >= today && (a.staffIds || []).length && (a.clientIds || []).length && ['active', 'confirmed'].includes(a.status))
    const draft = { date: busy.date, start: busy.start, end: busy.end, type: 'service', status: 'active', billingCode: '97155', staffIds: [], clientIds: [] }
    const staff = candidateVerdicts(s, draft, 'staff', { today })
    expect(staff[busy.staffIds[0]].tone).toBe('warn')
    expect(staff[busy.staffIds[0]].label).toMatch(/^Busy |^Unavailable/)
    const rbt = s.staff.find((x) => /RBT/.test(x.role) && !busy.staffIds.includes(x.id))
    expect(staff[rbt.id].detail).toMatch(/97155 requires a BCBA/)
    const clients = candidateVerdicts(s, draft, 'clients', { today })
    expect(clients[busy.clientIds[0]].label).toMatch(/^Busy /)
    // every person gets a verdict, so the picker never has to guess
    expect(Object.keys(staff)).toHaveLength(s.staff.length)
    expect(Object.keys(clients)).toHaveLength(s.clients.length)
  })

  it('says nothing until the slot has a date and a time', () => {
    const s = blankState()
    expect(candidateVerdicts(s, { date: '', start: 540, end: 600, type: 'service' }, 'staff')).toEqual({})
    expect(candidateVerdicts(s, { date: today, start: 600, end: 600, type: 'service' }, 'clients')).toEqual({})
  })

  it('turns authorization sentences into short chips', () => {
    expect(authChip('This date falls after the authorization ends (2026-01-01).')).toBe('Auth ended')
    expect(authChip("97156 is not on this client's authorization (units on file: 97153).")).toBe('97156 not authorized')
    expect(authChip('Aetna MUE: 6 units of 97153 on 2026-10-04 against a maximum of 4 per day.')).toBe('Payer limit')
    expect(authChip('97153: 120% … over by 2 units')).toBe('Over authorization')
  })
})

describe('the booking dialog', () => {
  const openServiceWizard = async () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Appointment' }))
    fireEvent.click(await screen.findByTestId('type-service'))
  }

  it('shows a verdict on every person in the picker before anyone is chosen', async () => {
    await openServiceWizard()
    fireEvent.click(screen.getByTestId('pick-Staff Name'))
    expect(await screen.findByTestId('pick-checked-for')).toBeTruthy()
    const items = await screen.findAllByTestId('people-item')
    expect(items.length).toBeGreaterThan(0)
    expect(items.every((el) => within(el).queryByTestId('pick-verdict'))).toBe(true)
  })

  it('keeps every check in one rail panel, with required fields as a quiet to-do first', async () => {
    await openServiceWizard()
    const panel = await screen.findByTestId('booking-checks')
    expect(within(panel).getByTestId('booking-checks-status').textContent).not.toMatch(/Ready to book/)
    const todo = within(panel).getByTestId('appt-check-todo')
    expect(todo.textContent).toMatch(/Still to fill in/)
    expect(todo.textContent).toMatch(/Add a client\./)
    // a failed save turns the to-do into a must-fix
    fireEvent.click(screen.getByTestId('save-appt'))
    expect((await within(panel).findByTestId('booking-checks-status')).textContent).toMatch(/Fix before booking/)
    expect(within(panel).getByTestId('appt-check-todo').textContent).toMatch(/Fix to save/)
  })
})

describe('pick fit in the booking dialog', () => {
  // a weekday at least a week out; one clinician booked 10:00–12:00 with another client
  const shift = (iso, n) => { const d = new Date(`${iso}T00:00:00`); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
  let DATE = shift(today, 7)
  while ([0, 6].includes(new Date(`${DATE}T00:00:00`).getDay())) DATE = shift(DATE, 1)
  const BASE = blankState()
  const S1 = BASE.staff.find((s) => /RBT/.test(s.role))
  const [C, C2] = BASE.clients
  const seed = () => {
    const state = {
      ...BASE,
      appts: { blk: { id: 'blk', title: 'Busy block', date: DATE, start: 600, end: 720, type: 'service', status: 'active', staffIds: [S1.id], clientIds: [C2.id], location: '' } },
    }
    localStorage.setItem('aloha-aba.v3', JSON.stringify(state))
  }
  const openAt = async () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Appointment' }))
    fireEvent.click(await screen.findByTestId('type-service'))
    fireEvent.change(screen.getByTestId('appt-date'), { target: { value: DATE } })
    const [start, end] = document.querySelectorAll('input[type="time"]')
    fireEvent.change(start, { target: { value: '10:00' } })
    fireEvent.change(end, { target: { value: '12:00' } })
    fireEvent.click(screen.getByTestId('pick-Client Name'))
    fireEvent.click((await screen.findAllByTestId('people-item')).find((b) => b.textContent.includes(C.name)))
    fireEvent.mouseDown(document.body)
  }

  it('shows facts on each staff row, one best fit, and can rank the list', async () => {
    seed()
    await openAt()
    fireEvent.click(screen.getByTestId('pick-Staff Name'))
    const items = await screen.findAllByTestId('people-item')
    expect(items.every((el) => within(el).queryByTestId('bk-pick-facts'))).toBe(true)
    expect(screen.getAllByTestId('bk-best-fit')).toHaveLength(1)
    const busyRow = items.find((b) => b.textContent.includes(S1.name))
    expect(within(busyRow).queryByTestId('bk-best-fit')).toBeNull()
    fireEvent.click(screen.getByTestId('bk-pick-sort'))
    expect(screen.getByTestId('bk-pick-sort').textContent).toBe('Ranked')
    const ranked = screen.getAllByTestId('people-item')
    expect(within(ranked[0]).queryByTestId('bk-best-fit')).toBeTruthy()
  })

  it('offers open slots when the pick clashes, and a slot only fills the form until saved', async () => {
    seed()
    await openAt()
    fireEvent.click(screen.getByTestId('pick-Staff Name'))
    fireEvent.click((await screen.findAllByTestId('people-item')).find((b) => b.textContent.includes(S1.name)))
    fireEvent.mouseDown(document.body)
    const fit = await screen.findByTestId('bk-fit')
    expect(within(fit).getByTestId('bk-slot-0').textContent).toMatch(/· \d/)
    expect(Object.keys(JSON.parse(localStorage.getItem('aloha-aba.v3')).appts)).toEqual(['blk'])
    fireEvent.click(within(fit).getByTestId('bk-slot-0'))
    const picked = document.querySelectorAll('input[type="time"]')[0].value
    expect(picked).not.toBe('10:00')
    expect(screen.queryByTestId('appt-check-clash')).toBeNull()
    fireEvent.change(screen.getByTestId('appt-title'), { target: { value: 'Moved to open slot' } })
    const ack = screen.queryByTestId('appt-ack-warns') // the RBT-renders-97151 rule still warns
    if (ack) fireEvent.click(ack)
    fireEvent.click(screen.getByTestId('save-appt'))
    await screen.findByText('Appointment created')
    const savedOf = () => Object.values(JSON.parse(localStorage.getItem('aloha-aba.v3')).appts).find((a) => a.title === 'Moved to open slot')
    await waitFor(() => expect(savedOf()).toBeTruthy())
    const saved = savedOf()
    const [h, m] = picked.split(':').map(Number)
    expect(saved).toMatchObject({ start: h * 60 + m, end: h * 60 + m + 120 })
  })
})

describe('the Checks rail at a glance', () => {
  const shift = (iso, n) => { const d = new Date(`${iso}T00:00:00`); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
  let DATE = shift(today, 7)
  while ([0, 6].includes(new Date(`${DATE}T00:00:00`).getDay())) DATE = shift(DATE, 1)
  const BASE = blankState()
  const S1 = BASE.staff.find((s) => /RBT/.test(s.role))
  const [C, C2] = BASE.clients

  it('leads with one decision line, draws the week load as a meter, and keeps detail behind a disclosure', async () => {
    localStorage.setItem('aloha-aba.v3', JSON.stringify({
      ...BASE,
      appts: { blk: { id: 'blk', title: 'Busy block', date: DATE, start: 600, end: 720, type: 'service', status: 'active', staffIds: [S1.id], clientIds: [C2.id], location: '' } },
    }))
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Appointment' }))
    fireEvent.click(await screen.findByTestId('type-service'))
    fireEvent.change(screen.getByTestId('appt-date'), { target: { value: DATE } })
    const [start, end] = document.querySelectorAll('input[type="time"]')
    fireEvent.change(start, { target: { value: '10:00' } })
    fireEvent.change(end, { target: { value: '12:00' } })
    for (const [picker, name] of [['pick-Client Name', C.name], ['pick-Staff Name', S1.name]]) {
      fireEvent.click(screen.getByTestId(picker))
      fireEvent.click((await screen.findAllByTestId('people-item')).find((b) => b.textContent.includes(name)))
      fireEvent.mouseDown(document.body)
    }
    const panel = await screen.findByTestId('booking-checks')
    // the clash is a warn: review, not clear
    expect(within(panel).getByTestId('booking-checks-status').textContent).toBe('Review before booking')
    expect(within(panel).getByLabelText('Summary of checks').textContent).toMatch(/\d+ to review/)
    // the clinician's week after this booking (2 h busy + 2 h here), as a meter with its numbers in text
    const load = within(panel).getByRole('meter', { name: `Week load for ${S1.name}` })
    expect(load.getAttribute('aria-valuetext')).toMatch(/^4 of \d+ h this week/)
    expect(within(panel).getByTestId('bk-glance-load').textContent).toMatch(/4 of \d+ h this week/)
    expect(within(panel).getByTestId(`bk-chip-cont-${S1.id}`).textContent).toMatch(/together/)
    // the clash shows its first line; the explanation waits behind Details
    const clash = within(panel).getByTestId('appt-check-clash')
    const more = within(clash).getByRole('button', { name: /Details/ })
    expect(more.getAttribute('aria-expanded')).toBe('false')
    expect(within(clash).getByText(/You can still save/).closest('[hidden]')).toBeTruthy()
    fireEvent.click(more)
    expect(more.getAttribute('aria-expanded')).toBe('true')
    expect(within(clash).getByText(/You can still save/).closest('[hidden]')).toBeNull()
    // nothing was saved by looking
    expect(Object.keys(JSON.parse(localStorage.getItem('aloha-aba.v3')).appts)).toEqual(['blk'])
  })
})
