import React from 'react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import App from '../App'
import { blankState } from '../state/store'
import { staffCalendar } from '../lib/ics'
import { todayISO, addDays, parseISO, isoDate } from '../lib/date'

beforeEach(() => {
  localStorage.clear()
  window.URL.createObjectURL = vi.fn(() => 'blob:ics-test')
  window.URL.revokeObjectURL = vi.fn()
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

const BASE = blankState()
const today = todayISO()
const inDays = (n) => isoDate(addDays(parseISO(today), n))
const client = BASE.clients[0]
// s8's bookings replaced by a known set: two ahead, one past, one beyond 90 days
const notS8 = Object.fromEntries(Object.entries(BASE.appts).filter(([, a]) => !(a.staffIds || []).includes('s8')))
const mk = (id, date) => ({ id, date, start: 540, end: 600, type: 'service', title: `Session ${id}`, staffIds: ['s8'], clientIds: [client.id], status: 'confirmed', location: 'Main Center' })
const S = { ...BASE, appts: { ...notS8, ics1: mk('ics1', inDays(1)), ics2: mk('ics2', inDays(3)), old: mk('old', inDays(-2)), far: mk('far', inDays(120)) } }

describe('per-staff calendar file', () => {
  it('holds only that person’s next 90 days, in date order', () => {
    const res = staffCalendar(S, 's8', today)
    expect(res.ok).toBe(true)
    expect(res.count).toBe(2)
    expect(res.text.indexOf('UID:ics1@')).toBeLessThan(res.text.indexOf('UID:ics2@'))
    expect(res.text).not.toContain('UID:old@')
    expect(res.text).not.toContain('UID:far@')
    expect(res.text).toContain(client.name)
    expect(res.filename).toMatch(/^calendar-rohit-srivastava-\d{4}-\d{2}-\d{2}\.ics$/)
    expect(res.msg).toMatch(/does not update itself/)
  })

  it('leaves client names out for roles that cannot open Clients, and refuses an empty calendar', () => {
    expect(staffCalendar(S, 's8', today, { withClients: false }).text).not.toContain(client.name)
    const empty = staffCalendar({ ...S, appts: notS8 }, 's8', today)
    expect(empty.ok).toBe(false)
    expect(empty.msg).toMatch(/nothing booked/)
    expect(staffCalendar(S, 'nobody', today).ok).toBe(false)
  })

  it('the roster card downloads the file and says it does not sync', async () => {
    localStorage.setItem('aloha-aba.v3', JSON.stringify(S))
    render(<App />)
    fireEvent.click(screen.getByTestId('nav-staff'))
    fireEvent.click(await screen.findByTestId('stf-ics-s8'))
    expect(window.URL.createObjectURL).toHaveBeenCalledTimes(1)
    expect(await screen.findByText(/Saved 2 bookings for Rohit Srivastava/)).toBeTruthy()
  })
})
