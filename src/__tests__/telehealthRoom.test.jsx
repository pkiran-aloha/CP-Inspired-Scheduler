import React from 'react'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import App from '../App'
import { blankState } from '../state/store'
import { telehealthRoomFor, isWebUrl, planSettingsOp, integrationsCfg } from '../lib/settingsMasters'
import { buildICS } from '../lib/ics'
import { todayISO } from '../lib/date'

beforeEach(() => localStorage.clear())
afterEach(() => cleanup())

const BASE = blankState()
const ROOM = 'https://video.example.com/aloha-room'
const withRoom = (patch = {}) => ({
  ...BASE,
  settings: {
    ...BASE.settings,
    clinicalIntegrations: integrationsCfg(BASE.settings).map((r) => (r.id === 'int-telehealth' ? { ...r, status: 'local-export', roomUrl: ROOM, ...patch } : r)),
  },
})

describe('telehealth room link', () => {
  it('only telehealth sessions get the room, and only when it is set and the integration is on', () => {
    const s = withRoom()
    expect(telehealthRoomFor(s.settings, { location: 'Telehealth (video)' })).toBe(ROOM)
    expect(telehealthRoomFor(s.settings, { location: 'Main Center' })).toBe('')
    expect(telehealthRoomFor(withRoom({ status: 'off' }).settings, { location: 'Telehealth (video)' })).toBe('')
    expect(telehealthRoomFor(withRoom({ roomUrl: '' }).settings, { location: 'Telehealth (video)' })).toBe('')
  })

  it('refuses a room link that is not a full https address, and trims a good one', () => {
    expect(isWebUrl('zoom.us/j/1')).toBe(false)
    expect(isWebUrl('http://zoom.us/j/1')).toBe(false)
    expect(planSettingsOp(BASE, 'integration.patch', { id: 'int-telehealth', patch: { roomUrl: 'zoom room 4' } }).ok).toBe(false)
    const ok = planSettingsOp(BASE, 'integration.patch', { id: 'int-telehealth', patch: { roomUrl: `  ${ROOM} ` } })
    expect(ok.ok).toBe(true)
    expect(ok.patch.clinicalIntegrations.find((r) => r.id === 'int-telehealth').roomUrl).toBe(ROOM)
    expect(planSettingsOp(BASE, 'integration.patch', { id: 'int-telehealth', patch: { roomUrl: '' } }).ok).toBe(true)
  })

  it('.ics events for telehealth sessions carry the room link; others do not', () => {
    const s = withRoom()
    const appts = [
      { id: 'a1', date: todayISO(), start: 540, end: 600, title: 'Video', location: 'Telehealth (video)', status: 'confirmed' },
      { id: 'a2', date: todayISO(), start: 600, end: 660, title: 'Clinic', location: 'Main Center', status: 'confirmed' },
    ]
    const ics = buildICS(appts, {}, {}, undefined, (a) => telehealthRoomFor(s.settings, a))
    expect(ics).toContain(`URL:${ROOM}`)
    expect(ics.split('URL:').length).toBe(2)
    expect(buildICS(appts, {}, {})).not.toContain('URL:')
  })

  it('the booking dialog shows the room link once a telehealth location is picked', async () => {
    localStorage.setItem('aloha-aba.v3', JSON.stringify(withRoom()))
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Appointment' }))
    fireEvent.click(await screen.findByTestId('type-service'))
    expect(screen.queryByTestId('am-telehealth-room')).toBeNull()
    fireEvent.click(screen.getByTestId('location-select'))
    fireEvent.click(await screen.findByTestId('opt-location-select-Telehealth (video)'))
    const room = await screen.findByTestId('am-telehealth-room')
    expect(room.querySelector('a').getAttribute('href')).toBe(ROOM)
    expect(room.textContent).toMatch(/does not host video/)
  })

  it('a payer that hides POS-10 removes telehealth locations from the booking picker for its clients (audit CFG-06)', async () => {
    const pickJustin = async () => {
      fireEvent.click(screen.getByTestId('pick-Client Name'))
      fireEvent.click((await screen.findAllByTestId('people-item')).find((b) => b.textContent.includes('Justin Hsu')))
      fireEvent.mouseDown(document.body)
    }
    // control: without the rule the telehealth location is offered
    localStorage.setItem('aloha-aba.v3', JSON.stringify(blankState()))
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Appointment' }))
    fireEvent.click(await screen.findByTestId('type-service'))
    await pickJustin()
    fireEvent.click(screen.getByTestId('location-select'))
    expect(await screen.findByTestId('opt-location-select-Telehealth (video)')).toBeTruthy()
    fireEvent.mouseDown(document.body)
    cleanup()

    // with the rule: POS-10 locations leave the picker, other locations stay
    const s = blankState()
    const aetna = s.payers.find((x) => x.id === 'py-aetna') // Justin Hsu's insurer
    aetna.rules = { ...(aetna.rules || {}), hideTeleHome: true }
    localStorage.setItem('aloha-aba.v3', JSON.stringify(s))
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Appointment' }))
    fireEvent.click(await screen.findByTestId('type-service'))
    await pickJustin()
    fireEvent.click(screen.getByTestId('location-select'))
    expect(await screen.findByTestId('opt-location-select-Main Center')).toBeTruthy()
    expect(screen.queryByTestId('opt-location-select-Telehealth (video)')).toBeNull()
  })
})
