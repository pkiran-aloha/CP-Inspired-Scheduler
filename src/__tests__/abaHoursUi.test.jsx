import React from 'react'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import App from '../App'
import { blankState, initial, STORAGE_KEY } from '../state/store'

// The seed is dated relative to today, so on some days the picked clinician already has a
// session in the default slot and the Warn gate asks for its tick before saving. Tick it
// when shown, so these flows test what they name on any date.
const ackWarns = () => { const a = screen.queryByTestId('appt-ack-warns'); if (a && !a.classList.contains('on')) fireEvent.click(a) }


const stored = () => { try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) } catch { return null } }
let _r = null
const cleanup = () => { if (_r) { _r.unmount(); _r = null } }
beforeEach(() => { localStorage.clear(); cleanup() })
afterEach(() => cleanup())
const R = (ui) => { cleanup(); _r = render(ui); fireEvent.click(screen.getByTestId('nav-calendar')); return _r } // the app lands on the Dashboard

const seed = () => {
  const s = blankState()
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...s, history: [] }))
  return s
}

/** Open the booking dialog for one appointment type. */
const openModal = async (type) => {
  fireEvent.click(screen.getByRole('button', { name: 'Appointment' }))
  fireEvent.click(await screen.findByTestId(`type-${type}`))
  return screen.findByTestId('appt-title')
}

const pickStaff = async () => {
  fireEvent.click(screen.getByTestId('pick-Staff Name'))
  fireEvent.click((await screen.findAllByTestId('people-item'))[0])
  fireEvent.mouseDown(document.body)
}

describe('⚡ ABA Hours in the booking dialog', () => {
  it('is offered on a non-service block and says what the hours are for', async () => {
    seed()
    R(<App />)
    await openModal('unavailable')
    const box = await screen.findByTestId('aba-hr')
    expect(box.textContent).toMatch(/ABA Hr/)
    fireEvent.click(box)
    const panel = await screen.findByTestId('aba-hours-panel')
    expect(panel.textContent).toMatch(/behavior-analytic time/i)
    expect(panel.textContent).toMatch(/RBT \/ BCAT, graduate-student and state-certification hours/)
    // the practice's own examples and non-examples are on screen, not in a manual
    expect(panel.textContent).toMatch(/Group trainings on behavior-analytic principles/)
    expect(panel.textContent).toMatch(/graduate students designing or reviewing interventions/i)
    expect(panel.textContent).toMatch(/Cleaning the clinic/)
    expect(panel.textContent).toMatch(/stimulus preparation/)
    // it is not a billing control and not an authorization control
    expect(panel.textContent).toMatch(/not billed and does not touch any client authorization/)
  })

  it('is never offered on a service appointment', async () => {
    seed()
    R(<App />)
    await openModal('service')
    await screen.findByTestId('appt-title')
    expect(screen.queryByTestId('aba-hr')).toBe(null)
    expect(screen.queryByTestId('aba-hours-panel')).toBe(null)
  })

  it('refuses a non-qualifying activity, then saves the real thing', async () => {
    seed()
    R(<App />)
    await openModal('unavailable')
    await pickStaff()
    fireEvent.click(await screen.findByTestId('aba-hr'))
    await screen.findByTestId('aba-hours-panel')

    fireEvent.click(screen.getByTestId('aba-activity'))
    fireEvent.click(await screen.findByTestId('opt-aba-activity-facility'))
    const banner = await screen.findByTestId('appt-validation-banner')
    expect(banner.textContent).toMatch(/not behavior-analytic time/)

    const before = Object.keys(stored().appts)
    ackWarns(); fireEvent.click(screen.getByTestId('save-appt'))
    expect(await screen.findByText(/Fix \d+ item/)).toBeTruthy()
    expect(Object.keys(stored().appts).length).toBe(before.length)

    // the same block, marked as real behavior-analytic work, saves
    fireEvent.click(screen.getByTestId('aba-activity'))
    fireEvent.click(await screen.findByTestId('opt-aba-activity-group-training'))
    ackWarns(); fireEvent.click(screen.getByTestId('save-appt'))
    await waitFor(() => expect(Object.keys(stored().appts).length).toBe(before.length + 1))
    const newId = Object.keys(stored().appts).find((id) => !before.includes(id))
    const saved = stored().appts[newId]
    expect(saved.type).toBe('unavailable')
    expect(saved.abaActivity).toBe('group-training')
    expect(saved.staffIds.length).toBe(1)
    expect(saved.clientIds).toEqual([])
  })

  it('warns that nobody is credited until a staff member is on the block', async () => {
    seed()
    R(<App />)
    await openModal('unavailable')
    fireEvent.click(await screen.findByTestId('aba-hr'))
    const panel = await screen.findByTestId('aba-hours-panel')
    expect(panel.textContent).toMatch(/Add a staff member so these hours can be credited/)
    await pickStaff()
    expect((await screen.findByTestId('aba-hours-credit')).textContent).toMatch(/Credited to/)
  })

  it('persists a service session without the flag, whatever was in the draft', async () => {
    seed()
    R(<App />)
    await openModal('service')
    fireEvent.click(screen.getByTestId('pick-Client Name'))
    fireEvent.click((await screen.findAllByTestId('people-item'))[0])
    fireEvent.mouseDown(document.body)
    await pickStaff()
    const before = Object.keys(stored().appts)
    ackWarns(); fireEvent.click(screen.getByTestId('save-appt'))
    await waitFor(() => expect(Object.keys(stored().appts).length).toBe(before.length + 1))
    const newId = Object.keys(stored().appts).find((id) => !before.includes(id))
    const saved = stored().appts[newId]
    expect(saved.type).toBe('service')
    expect(saved.abaHr).toBe(false)
    expect(saved.abaActivity).toBeUndefined()
  })
})

describe('the ⚡ ABA Hours filter', () => {
  it('shows only non-service blocks that count as behavior-analytic time', async () => {
    const s = seed()
    // one qualifying block and one service session that must never show up under the filter
    const training = {
      id: 'aba-1', type: 'unavailable', date: s.ui.anchor, start: 480, end: 570, title: 'ABA group training',
      staffIds: [s.staff[2].id], clientIds: [], status: 'active', abaHr: true, abaActivity: 'group-training',
    }
    const service = {
      id: 'aba-2', type: 'service', date: s.ui.anchor, start: 600, end: 660, title: 'Session that is not ABA hours',
      staffIds: [s.staff[2].id], clientIds: [s.clients[0].id], status: 'active', abaHr: false,
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...s, appts: { ...s.appts, 'aba-1': training, 'aba-2': service }, history: [] }))
    R(<App />)
    fireEvent.click(await screen.findByTestId('nav-calendar'))
    fireEvent.click(await screen.findByTestId('topbar-filters'))
    fireEvent.click(await screen.findByTestId('filter-aba-only'))
    await waitFor(() => expect(stored().ui.filters.abaOnly).toBe(true))
    // the calendar shows the qualifying block and hides the service session
    expect(screen.queryByText('Session that is not ABA hours')).toBe(null)
  })
})

describe('upgrading a workspace saved under the old meaning', () => {
  it('strips the flag from service appointments and keeps non-service hours', () => {
    const s = blankState()
    const svc = Object.values(s.appts).find((a) => a.type === 'service')
    const ev = Object.values(s.appts).find((a) => a.type === 'evaluation')
    const appts = {
      ...s.appts,
      [svc.id]: { ...svc, abaHr: true },
      [ev.id]: { ...ev, abaHr: true },
      'legacy-aba': { id: 'legacy-aba', type: 'unavailable', date: s.ui.anchor, start: 480, end: 570, title: 'Old ABA training block', staffIds: [s.staff[0].id], clientIds: [], status: 'active', abaHr: true },
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...s, appts, meta: {}, history: [] }))
    const out = initial()
    expect(out.appts[svc.id].abaHr).toBe(false)
    expect(out.appts[ev.id].abaHr).toBe(false)
    expect(out.appts['legacy-aba'].abaHr).toBe(true)
    expect(out.meta.abaHoursFixed).toBe(true)
    expect(out.meta.abaHoursStripped).toBe(2)
    // the repaired snapshot is what gets written back, so the migration is durable
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)).appts[svc.id].abaHr).toBe(false)
  })
})
