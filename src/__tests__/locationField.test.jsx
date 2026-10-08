import React from 'react'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import App from '../App'
import { blankState } from '../state/store'
import { HOME_PREFIX } from '../lib/locationSources'
import { addDays, isoDate, parseISO, todayISO } from '../lib/date'

beforeEach(() => { localStorage.clear(); cleanup() })
afterEach(() => cleanup())

const shift = (iso, n) => isoDate(addDays(parseISO(iso), n))
let DATE = shift(todayISO(), 7)
while ([0, 6].includes(parseISO(DATE).getDay())) DATE = shift(DATE, 1)
const BASE = blankState()
const S1 = BASE.staff.find((s) => /RBT/.test(s.role))
const [C, C2] = BASE.clients
const HOME = `${HOME_PREFIX}${C.street}, ${C.city}, ${C.state} ${C.zip}`
const FREE = '77 Free Text Rd, Campbell'

const seed = () => localStorage.setItem('aloha-aba.v3', JSON.stringify({
  ...BASE,
  appts: { prev: { id: 'prev', title: 'Earlier', date: DATE, start: 540, end: 600, type: 'service', status: 'active', staffIds: [S1.id], clientIds: [C2.id], location: 'Lincoln Elementary' } },
}))

const openList = async () => {
  fireEvent.click(screen.getByTestId('location-select'))
  return screen.findByPlaceholderText('Search…')
}

describe('booking dialog Location field', () => {
  it('offers client and staff-previous suggestions by source, takes free text, links to Maps, and saves the value as typed', async () => {
    seed()
    render(<App />)
    fireEvent.click(screen.getByTestId('nav-calendar')) // the app lands on the Dashboard
    fireEvent.click(screen.getByRole('button', { name: 'Appointment' }))
    fireEvent.click(await screen.findByTestId('type-service'))
    fireEvent.change(screen.getByTestId('appt-date'), { target: { value: DATE } })
    const [start, end] = document.querySelectorAll('input[type="time"]')
    fireEvent.change(start, { target: { value: '11:00' } })
    fireEvent.change(end, { target: { value: '12:00' } })
    fireEvent.click(screen.getByTestId('pick-Client Name'))
    fireEvent.click((await screen.findAllByTestId('people-item')).find((b) => b.textContent.includes(C.name)))
    fireEvent.mouseDown(document.body)
    fireEvent.click(screen.getByTestId('pick-Staff Name'))
    fireEvent.click((await screen.findAllByTestId('people-item')).find((b) => b.textContent.includes(S1.name)))
    fireEvent.mouseDown(document.body)

    // 1) client home address, grouped under Client
    const search = await openList()
    expect(screen.getByTestId('dd-group-location-select-Client')).toBeTruthy()
    expect(screen.getByTestId('dd-group-location-select-Staff')).toBeTruthy()
    expect(screen.getByTestId('dd-group-location-select-Office')).toBeTruthy()
    fireEvent.keyDown(search, { key: 'ArrowDown' })
    expect(document.activeElement.className).toContain('pop-item')
    fireEvent.click(screen.getByTestId(`opt-location-select-${HOME}`))
    expect(screen.getByTestId('location-select').textContent).toContain(HOME)
    expect(screen.getByTestId('bk-loc-map').getAttribute('href')).toContain(encodeURIComponent(C.street))

    // 2) where the staff member was just before
    await openList()
    const prev = screen.getByTestId('opt-location-select-Lincoln Elementary')
    expect(prev.textContent).toContain(`After ${S1.name.split(' ')[0]}'s 9 AM`)
    fireEvent.click(prev)
    expect(screen.getByTestId('location-select').textContent).toContain('Lincoln Elementary')

    // 3) free text, committed with Enter; the Maps link is a plain new-tab link
    fireEvent.change(await openList(), { target: { value: FREE } })
    fireEvent.keyDown(screen.getByPlaceholderText('Search…'), { key: 'Enter' })
    expect(screen.getByTestId('location-select').textContent).toContain(FREE)
    const map = screen.getByTestId('bk-loc-map')
    expect(map.getAttribute('href')).toBe(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(FREE)}`)
    expect(map.getAttribute('target')).toBe('_blank')
    expect(map.getAttribute('rel')).toContain('noopener')
    expect(map.parentElement.textContent).toMatch(/nothing is looked up or sent/)

    fireEvent.change(screen.getByTestId('appt-title'), { target: { value: 'Free text location' } })
    const ack = screen.queryByTestId('appt-ack-warns')
    if (ack) fireEvent.click(ack)
    fireEvent.click(screen.getByTestId('save-appt'))
    await screen.findByText('Appointment created')
    await waitFor(() => {
      const saved = Object.values(JSON.parse(localStorage.getItem('aloha-aba.v3')).appts).find((a) => a.title === 'Free text location')
      expect(saved?.location).toBe(FREE)
    })
  })
})
