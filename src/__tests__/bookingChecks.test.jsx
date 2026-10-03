import React from 'react'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'
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
