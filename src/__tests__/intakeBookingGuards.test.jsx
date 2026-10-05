import React from 'react'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react'
import App from '../App'
import { blankState } from '../state/store'

const KEY = 'aloha-aba.v3'
const stored = () => JSON.parse(localStorage.getItem(KEY))
beforeEach(() => localStorage.clear())
afterEach(() => cleanup())

const BASE = blankState()
const REQ = Object.values(BASE.intakeRequests).find((r) => r.stage === 'review')
const DAY = '2031-03-03'
// every clinician is already busy 10:00–12:00 that day, so any pick clashes
const busy = { id: 'busy-1', type: 'service', title: 'Existing session', date: DAY, start: 600, end: 720, staffIds: BASE.staff.map((s) => s.id), clientIds: [], status: 'active' }
const withOverlap = (level) => ({
  ...BASE,
  appts: { ...BASE.appts, [busy.id]: busy },
  settings: { ...BASE.settings, appointmentValidations: { ...(BASE.settings.appointmentValidations || {}), staff: { ...(BASE.settings.appointmentValidations?.staff || {}), overlap: level } } },
})

async function book() {
  render(<App />)
  fireEvent.click(screen.getByTestId('nav-clients'))
  fireEvent.click(await screen.findByTestId('nav-sub-intake'))
  fireEvent.change(await screen.findByTestId('iq-search'), { target: { value: REQ.no } })
  fireEvent.click(screen.getByTestId('iq-mode-list'))
  fireEvent.click(await screen.findByTestId(`iq-open-${REQ.id}`))
  fireEvent.click(screen.getByTestId('iq-rail-scheduled'))
  const form = await screen.findByTestId('iq-book-form')
  fireEvent.change(within(form).getByTestId('iq-bk-date'), { target: { value: DAY } })
  fireEvent.change(within(form).getByTestId('iq-bk-start'), { target: { value: '10:30' } })
  fireEvent.change(within(form).getByTestId('iq-bk-end'), { target: { value: '11:30' } })
  if (!within(form).getByTestId('iq-bk-clinician').textContent.trim() || /Pick/.test(within(form).getByTestId('iq-bk-clinician').textContent)) {
    fireEvent.click(within(form).getByTestId('iq-bk-clinician'))
    fireEvent.click((await screen.findAllByTestId(/^opt-iq-bk-clinician-/))[0])
  }
  fireEvent.click(within(form).getByTestId('iq-bk-save'))
}

describe('intake assessment booking runs the practice booking checks', () => {
  it('a Stop rule refuses the visit and says why', async () => {
    localStorage.setItem(KEY, JSON.stringify(withOverlap('stop')))
    await book()
    expect(await screen.findByText(/Not booked\. Staff Overlap: .*Existing session/)).toBeTruthy()
    expect(stored().intakeRequests[REQ.id].stage).toBe('review')
    expect(Object.values(stored().appts).some((a) => a.intakeId === REQ.id && a.date === DAY)).toBe(false)
  })

  it('a Warn rule books the visit and names what to review', async () => {
    localStorage.setItem(KEY, JSON.stringify(withOverlap('warn')))
    await book()
    expect(await screen.findByText(/Assessment booked .* Review: .*already booked on “Existing session”/)).toBeTruthy()
    await waitFor(() => expect(stored().intakeRequests[REQ.id].stage).toBe('scheduled'))
  })
})
