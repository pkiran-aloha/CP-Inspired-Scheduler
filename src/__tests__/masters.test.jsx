import React from 'react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, within, cleanup } from '@testing-library/react'
import App from '../App'

const KEY = 'aloha-aba.v3'
const stored = () => { try { return JSON.parse(localStorage.getItem(KEY)) } catch { return null } }

beforeEach(() => { localStorage.clear(); cleanup() })
afterEach(() => cleanup())
afterEach(() => localStorage.clear())

describe('cute avatars on the masters', () => {
  it('every client and staff row carries a critter, seeded deterministically', async () => {
    const { container } = render(<App />)
    fireEvent.click(screen.getByTestId('nav-clients'))
    fireEvent.click(screen.getByTestId('cli-mode-table'))
    await screen.findByTestId('clients-table')
    const pav = container.querySelectorAll('[data-testid^="cli-pav-"]')
    expect(pav.length).toBe(16)
    // seeded avatars are actual critters, and the picker art is inline SVG (no network)
    expect(container.querySelector('[data-testid="cli-pav-c1"] svg')).toBeTruthy()
    // sorted view, but every row id must have exactly one face
    const ids = new Set([...pav].map((el) => el.getAttribute('data-testid')))
    expect(ids.size).toBe(16)

    fireEvent.click(screen.getByTestId('nav-staff'))
    fireEvent.click(screen.getByTestId('stf-mode-table'))
    await screen.findByTestId('staff-table')
    expect(container.querySelectorAll('[data-testid^="stf-pav-"]').length).toBe(12)
    expect(container.querySelector('[data-testid="stf-pav-s1"] svg')).toBeTruthy()
  })

  it('card mode shows the same faces', async () => {
    render(<App />)
    fireEvent.click(screen.getByTestId('nav-clients'))
    fireEvent.click(screen.getByTestId('cli-mode-table'))
    await screen.findByTestId('clients-table')
    fireEvent.click(screen.getByTestId('cli-mode-cards'))
    await screen.findByTestId('clients-cards')
    expect(document.querySelectorAll('[data-testid^="cli-pav-"]').length).toBe(16)
  })
})

describe('client modal — add with avatar & palette color', () => {
  it('opens from the header button, persists avatar + color on save', async () => {
    const { container } = render(<App />)
    fireEvent.click(screen.getByTestId('nav-clients'))
    fireEvent.click(screen.getByTestId('cli-mode-table'))
    await screen.findByTestId('clients-table')
    fireEvent.click(screen.getByTestId('cli-new'))
    fireEvent.change(screen.getByTestId('cm-name'), { target: { value: 'Poppy Wren' } })
    fireEvent.change(screen.getByTestId('cm-phone'), { target: { value: '(408) 555-0199' } })
    fireEvent.click(screen.getByTestId('cm-avatar-octopus'))
    fireEvent.click(screen.getByTestId('cm-color-#ec4899'))
    fireEvent.click(screen.getByTestId('cm-save'))
    await waitFor(() => expect(container.querySelectorAll('[data-testid^="cli-row-"]').length).toBe(17))
    await waitFor(() => {
      const c = stored().clients.find((x) => x.name === 'Poppy Wren')
      expect(c?.avatar).toBe('octopus')
      expect(c?.color).toBe('#ec4899')
      expect(c?.phone).toBe('(408) 555-0199')
    })
  })

  it('editing an existing client pre-fills everything and the picker marks the current critter', async () => {
    const { container } = render(<App />)
    fireEvent.click(screen.getByTestId('nav-clients'))
    fireEvent.click(screen.getByTestId('cli-mode-table'))
    await screen.findByTestId('clients-table')
    fireEvent.click(screen.getByTestId('cli-row-c1'))
    fireEvent.click(await screen.findByTestId('cli-edit-c1'))
    expect(screen.getByTestId('cm-name').value).toBe('Justin Hsu')
    // the picker pre-marks exactly one critter — the client's stored avatar
    const on = [...screen.getByTestId('cm-avatars').querySelectorAll('.pm-chip.on')]
    expect(on.length).toBe(1)
    expect(on[0].getAttribute('data-testid')).toMatch(/^cm-avatar-[a-z]+$/)
    expect(screen.getByTestId('cm-phone').value).toMatch(/\(408\) 555-01\d\d/)
    fireEvent.change(screen.getByTestId('cm-guardian'), { target: { value: 'L. Hsu-Moore' } })
    fireEvent.click(screen.getByTestId('cm-save'))
    await waitFor(() => expect(stored().clients.find((c) => c.id === 'c1').guardian).toBe('L. Hsu-Moore'))
    expect(container).toBeTruthy()
  })

  it('Escape closes the modal without saving', async () => {
    render(<App />)
    fireEvent.click(screen.getByTestId('nav-clients'))
    fireEvent.click(screen.getByTestId('cli-mode-table'))
    await screen.findByTestId('clients-table')
    fireEvent.click(screen.getByTestId('cli-new'))
    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByTestId('cm-save')).toBeFalsy())
  })
})

describe('staff modal — capacity edit & two-step remove', () => {
  it('edits utilization target and calendar color from the modal', async () => {
    render(<App />)
    fireEvent.click(screen.getByTestId('nav-staff'))
    fireEvent.click(screen.getByTestId('stf-mode-table'))
    await screen.findByTestId('staff-table')
    fireEvent.click(screen.getByTestId('stf-row-s8'))
    fireEvent.click(await screen.findByTestId('stf-edit-s8'))
    fireEvent.change(screen.getByTestId('sm-targetWeekH'), { target: { value: '36' } })
    fireEvent.click(screen.getByTestId('sm-color-#ef4444'))
    fireEvent.click(screen.getByTestId('sm-save'))
    await waitFor(() => {
      const s = stored().staff.find((x) => x.id === 's8')
      expect(s.targetWeekH).toBe(36)
      expect(s.color).toBe('#ef4444')
    })
    expect(await screen.findByText(/Rohit Srivastava updated/)).toBeTruthy()
  })

  it('remove arms first, confirms on the second click, then the row disappears', async () => {
    const { container } = render(<App />)
    fireEvent.click(screen.getByTestId('nav-staff'))
    fireEvent.click(screen.getByTestId('stf-mode-table'))
    await screen.findByTestId('staff-table')
    fireEvent.click(screen.getByTestId('stf-row-s9'))
    fireEvent.click(await screen.findByTestId('stf-edit-s9'))
    fireEvent.click(screen.getByTestId('sm-remove'))
    // still open, nothing deleted yet — the button just changed its label
    expect(screen.getByTestId('sm-remove').textContent).toMatch(/click again/i)
    expect(container.querySelectorAll('[data-testid^="stf-row-"]').length).toBe(12)
    fireEvent.click(screen.getByTestId('sm-remove'))
    await waitFor(() => expect(container.querySelectorAll('[data-testid^="stf-row-"]').length).toBe(11))
    await waitFor(() => expect(stored().staff.find((x) => x.id === 's9')).toBeFalsy())
  })
})

describe('palette hooks into the new forms', () => {
  it('"Add staff member" routes to the staff section and opens the form', async () => {
    render(<App />)
    fireEvent.keyDown(window, { key: 'k', metaKey: true })
    fireEvent.change(screen.getByTestId('palette-input'), { target: { value: 'Add staff member' } })
    fireEvent.click(await screen.findByTestId('pal-item-0'))
    await screen.findByTestId('sm-save') // the modal is up
    expect(screen.getByTestId('sm-name').value).toBe('')
    fireEvent.click(screen.getByTestId('sm-avatar-robot'))
    fireEvent.change(screen.getByTestId('sm-name'), { target: { value: 'Ada Nyx' } })
    fireEvent.change(screen.getByTestId('sm-cert'), { target: { value: 'RBT #26-01-4411' } })
    fireEvent.change(screen.getByTestId('sm-email'), { target: { value: 'ada.nyx@alohaaba.com' } })
    fireEvent.click(screen.getByTestId('sm-save'))
    await waitFor(() => expect(stored().staff.some((s) => s.name === 'Ada Nyx' && s.avatar === 'robot')).toBe(true))
  })
})

describe('profile sheets & faces everywhere', () => {
  it('client row eye opens the profile sheet, and Edit switches into the form', async () => {
    render(<App />)
    fireEvent.click(screen.getByTestId('nav-clients'))
    fireEvent.click(screen.getByTestId('cli-mode-table'))
    await screen.findByTestId('clients-table')
    fireEvent.click(screen.getByTestId('cli-open-c1'))
    const pf = await screen.findByTestId('profile-modal')
    expect(within(pf).getByText('Justin Hsu')).toBeTruthy()
    expect(within(pf).getByText(/EIBI · Day program/)).toBeTruthy()
    expect(within(pf).getByText('L. Hsu')).toBeTruthy()
    expect(within(pf).getByText(/authorized/)).toBeTruthy()
    expect(pf.querySelector('.pf-face svg')).toBeTruthy() // same critter, big
    // one click to the editor
    fireEvent.click(within(pf).getByTestId('pf-edit'))
    expect(await screen.findByTestId('cm-save')).toBeTruthy()
    expect(screen.getByTestId('cm-name').value).toBe('Justin Hsu')
    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByTestId('cm-save')).toBeFalsy())
  })

  it('staff profile shows utilization, and the calendar action routes + closes', async () => {
    render(<App />)
    fireEvent.click(screen.getByTestId('nav-staff'))
    fireEvent.click(screen.getByTestId('stf-mode-table'))
    await screen.findByTestId('staff-table')
    fireEvent.click(screen.getByTestId('stf-open-s3'))
    const pf = await screen.findByTestId('profile-modal')
    expect(within(pf).getByText('Saija Kotha')).toBeTruthy()
    expect(within(pf).getByText(/booked of/)).toBeTruthy()
    fireEvent.click(within(pf).getByTestId('pf-cal'))
    await waitFor(() => expect(screen.queryByTestId('profile-modal')).toBeFalsy())
    expect(screen.getByTestId('nav-calendar').className).toMatch(/on/)
  })

  it('faces ride along everywhere people appear — sidebar roster included', async () => {
    const { container } = render(<App />)
    // landing view is the calendar; its sidebar roster lists staff with critters
    await waitFor(() => expect(container.querySelectorAll('.pav').length).toBeGreaterThan(4))
    fireEvent.click(screen.getByTestId('nav-clients'))
    fireEvent.click(screen.getByTestId('cli-mode-table'))
    await screen.findByTestId('clients-table')
    expect(container.querySelectorAll('[data-testid^="cli-pav-"]').length).toBe(16)
  })
})

describe('round 18 — critter set, Enter-to-save, duplicate & copy', () => {
  it('the picker now offers 18 critters + shuffle', async () => {
    render(<App />)
    fireEvent.click(screen.getByTestId('nav-clients'))
    fireEvent.click(screen.getByTestId('cli-mode-table'))
    await screen.findByTestId('clients-table')
    fireEvent.click(screen.getByTestId('cli-new'))
    const strip = screen.getByTestId('cm-avatars')
    expect(strip.querySelectorAll('.pm-chip').length).toBe(19)
    expect(screen.getByTestId('cm-avatar-dino')).toBeTruthy()
    expect(screen.getByTestId('cm-avatar-tiger')).toBeTruthy()
    expect(screen.getByTestId('cm-avatar-hedgehog')).toBeTruthy()
    expect(screen.getByTestId('cm-avatar-sheep')).toBeTruthy()
    fireEvent.click(screen.getByTestId('cm-avatar-dino'))
    expect(screen.getByTestId('cm-avatar-dino').className).toMatch(/on/)
  })

  it('Enter in any field saves the form', async () => {
    const { container } = render(<App />)
    fireEvent.click(screen.getByTestId('nav-clients'))
    fireEvent.click(screen.getByTestId('cli-mode-table'))
    await screen.findByTestId('clients-table')
    fireEvent.click(screen.getByTestId('cli-new'))
    fireEvent.change(screen.getByTestId('cm-name'), { target: { value: 'Rowan Quill' } })
    fireEvent.keyDown(screen.getByTestId('cm-phone'), { key: 'Enter' })
    await waitFor(() => expect(container.querySelectorAll('[data-testid^="cli-row-"]').length).toBe(17))
    await waitFor(() => expect(stored().clients.some((c) => c.name === 'Rowan Quill')).toBe(true))
  })

  it('duplicate from the profile prefills a (copy) record with a fresh id', async () => {
    const { container } = render(<App />)
    fireEvent.click(screen.getByTestId('nav-clients'))
    fireEvent.click(screen.getByTestId('cli-mode-table'))
    await screen.findByTestId('clients-table')
    fireEvent.click(screen.getByTestId('cli-open-c1'))
    const pf = await screen.findByTestId('profile-modal')
    fireEvent.click(within(pf).getByTestId('pf-dup'))
    expect(screen.getByTestId('cm-name').value).toBe('Justin Hsu (copy)')
    fireEvent.click(screen.getByTestId('cm-save'))
    await waitFor(() => expect(container.querySelectorAll('[data-testid^="cli-row-"]').length).toBe(17))
    let copy
    await waitFor(() => { copy = (stored()?.clients || []).find((c) => c.name === 'Justin Hsu (copy)'); expect(copy).toBeTruthy() })
    expect(copy.id !== 'c1').toBe(true)
    expect(copy.avatar).toBe('bunny') // the critter rides along too
  })

  it('same-name heads-up shows (non-blocking) on both masters', async () => {
    const { container } = render(<App />)
    fireEvent.click(screen.getByTestId('nav-clients'))
    fireEvent.click(screen.getByTestId('cli-mode-table'))
    await screen.findByTestId('clients-table')
    fireEvent.click(screen.getByTestId('cli-new'))
    fireEvent.change(screen.getByTestId('cm-name'), { target: { value: 'Meg Jones' } })
    expect(await screen.findByText(/already exists/)).toBeTruthy()
    // and it still saves — the hint warns, it does not block
    fireEvent.click(screen.getByTestId('cm-save'))
    await waitFor(() => expect(container.querySelectorAll('[data-testid^="cli-row-"]').length).toBe(17))

    fireEvent.click(screen.getByTestId('nav-staff'))
    fireEvent.click(screen.getByTestId('stf-mode-table'))
    await screen.findByTestId('staff-table')
    fireEvent.click(screen.getByTestId('stf-new'))
    fireEvent.change(screen.getByTestId('sm-name'), { target: { value: 'Neha Peyyeti' } })
    expect(await screen.findByText(/already exists/)).toBeTruthy()
  })

  it('profile chips copy to clipboard with a toast', async () => {
    render(<App />)
    fireEvent.click(screen.getByTestId('nav-clients'))
    fireEvent.click(screen.getByTestId('cli-mode-table'))
    await screen.findByTestId('clients-table')
    fireEvent.click(screen.getByTestId('cli-open-c1'))
    await screen.findByTestId('profile-modal')
    fireEvent.click(screen.getByTestId('pf-copy-phone'))
    expect(await screen.findByText(/Copied \(408\)/)).toBeTruthy()
  })
})
