import React from 'react'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import App from '../App'
import { blankState } from '../state/store'
import { customFieldsForScope, pcfFormatErrors, CF_TEXT_FORMAT_RULES } from '../lib/master'

// Audit CFG-07: custom-field scopes are enforced in the pickers, every declared type
// renders (textarea included), saved textFormat is validated at save time, "required"
// means required-once-added, and the payer profile copy no longer promises automatic
// appointment/export propagation.

const KEY = 'aloha-aba.v3'
const stored = () => { try { return JSON.parse(localStorage.getItem(KEY)) } catch { return null } }

beforeEach(() => { localStorage.clear(); cleanup() })
afterEach(() => cleanup())

const seed = (extraDefs = []) => {
  const s = blankState()
  s.customFields = [...(s.customFields || []), ...extraDefs]
  localStorage.setItem(KEY, JSON.stringify(s))
}

async function toMasters() {
  fireEvent.click(screen.getByTestId('nav-collapse'))
  fireEvent.click(screen.getByTestId('nav-masters'))
  await screen.findByTestId('payers-table')
}
async function openDetail(id) {
  await toMasters()
  fireEvent.click(await screen.findByTestId(`py-row-${id}`))
  await screen.findByTestId('payer-detail')
}
async function bookJustin() {
  fireEvent.click(screen.getByTestId('nav-calendar'))
  fireEvent.click(screen.getByRole('button', { name: 'Appointment' }))
  fireEvent.click(await screen.findByTestId('type-service'))
  fireEvent.click(screen.getByTestId('pick-Client Name'))
  fireEvent.click((await screen.findAllByTestId('people-item')).find((b) => b.textContent.includes('Justin Hsu')))
  fireEvent.mouseDown(document.body)
  fireEvent.click(screen.getByTestId('pick-Staff Name'))
  fireEvent.click((await screen.findAllByTestId('people-item'))[0])
  fireEvent.mouseDown(document.body)
  await screen.findByTestId('am-pcf')
}

describe('custom-field scopes (audit CFG-07)', () => {
  it('customFieldsForScope filters by scope, with the legacy default for old templates', () => {
    const s = blankState()
    s.customFields = [
      { id: 'a', label: 'A', status: 'active', assignedTo: ['client'] },
      { id: 'b', label: 'B', status: 'active', assignedTo: ['appointment'] },
      { id: 'c', label: 'C', status: 'active', assignedTo: ['payer'] },
      { id: 'd', label: 'D', status: 'active' }, // saved before scopes existed
      { id: 'e', label: 'E', status: 'inactive', assignedTo: ['appointment'] },
    ]
    expect(customFieldsForScope(s, 'appointment').map((x) => x.id)).toEqual(['b', 'd'])
    expect(customFieldsForScope(s, 'payer').map((x) => x.id)).toEqual(['c', 'd'])
    expect(customFieldsForScope(s, 'client').map((x) => x.id)).toEqual(['a'])
    expect(customFieldsForScope(s, 'provider')).toEqual([])
  })

  it('the appointment picker offers only appointment-scoped templates', async () => {
    seed([
      { id: 'cf-clientnote', label: 'Client only note', type: 'text', status: 'active', assignedTo: ['client'] },
      { id: 'cf-authnote', label: 'Auth only note', type: 'text', status: 'active', assignedTo: ['authorization'] },
      { id: 'cf-legacy', label: 'Legacy no scope', type: 'text', status: 'active' },
    ])
    render(<App />)
    await bookJustin()
    fireEvent.click(screen.getByTestId('am-pcf-add'))
    await screen.findByTestId('am-pcf-picker')
    expect(screen.queryByTestId('am-pcf-pick-cf-clientnote')).toBeNull()   // client-scoped never leaks in
    expect(screen.queryByTestId('am-pcf-pick-cf-authnote')).toBeNull()     // authorization-scoped neither
    expect(screen.getByTestId('am-pcf-pick-cf-legacy')).toBeTruthy()       // pre-scope templates keep working
    expect(screen.getByTestId('am-pcf-pick-cf-authdept')).toBeTruthy()     // appointment-scoped offered
  })

  it('the payer picker offers only payer-scoped templates (picked ones stay unlinkable)', async () => {
    seed([
      { id: 'cf-clientnote', label: 'Client only note', type: 'text', status: 'active', assignedTo: ['client'] },
      { id: 'cf-staffnote', label: 'Staff only note', type: 'text', status: 'active', assignedTo: ['provider'] },
      { id: 'cf-legacy', label: 'Legacy no scope', type: 'text', status: 'active' },
    ])
    render(<App />)
    await openDetail('py-aetna')
    fireEvent.click(screen.getByTestId('pd-cf-pick'))
    await screen.findByTestId('pd-cf-picker')
    expect(screen.queryByTestId('pd-cfpick-cf-clientnote')).toBeNull()
    expect(screen.queryByTestId('pd-cfpick-cf-staffnote')).toBeNull()
    expect(screen.getByTestId('pd-cfpick-cf-legacy')).toBeTruthy()
    expect(screen.getByTestId('pd-cfpick-cf-authdept')).toBeTruthy() // payer-scoped offered
    expect(screen.getByTestId('pd-cfpick-cf-teleconf').querySelector('input').disabled).toBe(true) // inactive stays visible but disabled
  })

  it('the payer profile copy no longer promises automatic appointment/export propagation', async () => {
    render(<App />)
    await openDetail('py-aetna')
    const note = screen.getByTestId('pd-cf').querySelector('.pd-note')
    expect(note.textContent).not.toMatch(/automatically/)
    expect(note.textContent).toMatch(/opt-in/)
    expect(note.textContent).toMatch(/no claim, CMS-1500 or export reads them yet/)
  })
})

describe('custom-field types and formats (audit CFG-07)', () => {
  it('pcfFormatErrors validates the saved textFormat, and empty stays valid', () => {
    const defs = [
      { id: 'n', label: 'Count', type: 'text', textFormat: 'number' },
      { id: 'e', label: 'Email', type: 'text', textFormat: 'email' },
      { id: 'p', label: 'Phone', type: 'textarea', textFormat: 'phone' },
      { id: 'u', label: 'Link', type: 'text', textFormat: 'url' },
      { id: 'a', label: 'Anything', type: 'text', textFormat: 'any' },
      { id: 's', label: 'Pick', type: 'select', textFormat: 'email' }, // non-text types ignore the format
    ]
    expect(pcfFormatErrors(defs, { n: { value: '12.5' }, e: { value: 'a@b.co' }, p: { value: '(408) 555-0161' }, u: { value: 'https://x.example.com' }, a: { value: 'whatever' }, s: { value: 'nope' } })).toEqual([])
    expect(pcfFormatErrors(defs, { n: { value: 'abc' } })).toEqual(['“Count” must be a number'])
    expect(pcfFormatErrors(defs, { e: { value: 'not-an-email' } })).toEqual(['“Email” must be an email address'])
    expect(pcfFormatErrors(defs, { p: { value: '??' } })).toEqual(['“Phone” must be a phone number'])
    expect(pcfFormatErrors(defs, { u: { value: 'example.com' } })).toEqual(['“Link” must be a URL (https://…)'])
    expect(pcfFormatErrors(defs, { e: { value: '' } })).toEqual([]) // required is a separate rule
    expect(CF_TEXT_FORMAT_RULES.email.re.test('a@b.co')).toBe(true)
  })

  it('a textarea template renders a textarea, and a bad email blocks the save until fixed', async () => {
    seed([
      { id: 'cf-notes', label: 'Session notes', type: 'textarea', status: 'active', assignedTo: ['appointment'] },
      { id: 'cf-email', label: 'Contact email', type: 'text', textFormat: 'email', status: 'active', assignedTo: ['appointment'] },
    ])
    render(<App />)
    await bookJustin()
    fireEvent.click(screen.getByTestId('am-pcf-add'))
    await screen.findByTestId('am-pcf-picker')
    fireEvent.click(screen.getByTestId('am-pcf-pick-cf-notes').querySelector('input'))
    fireEvent.click(screen.getByTestId('am-pcf-pick-cf-email').querySelector('input'))
    fireEvent.click(screen.getByTestId('am-pcf-picker-done'))
    // textarea type renders an actual textarea, with the format hint on text fields
    const notes = screen.getByTestId('pcf-f-cf-notes')
    expect(notes.querySelector('textarea')).toBeTruthy()
    expect(screen.getByTestId('pcf-f-cf-email').textContent).toMatch(/must be an email address/)
    // a bad value blocks the save with the reason in the Checks rail
    fireEvent.change(screen.getByTestId('pcf-in-cf-email'), { target: { value: 'not-an-email' } })
    fireEvent.click(screen.getByTestId('save-appt'))
    expect(await screen.findByText(/“Contact email” must be an email address/)).toBeTruthy()
    expect(screen.queryByText('Appointment created')).toBeNull()
    // a good value saves, and the answer persists with the appointment
    fireEvent.change(screen.getByTestId('pcf-in-cf-email'), { target: { value: 'guardian@example.com' } })
    fireEvent.change(notes.querySelector('textarea'), { target: { value: 'Parent asked about sleep routine.' } })
    fireEvent.click(screen.getByTestId('save-appt'))
    expect(await screen.findByText('Appointment created')).toBeTruthy()
    await waitFor(() => {
      const created = Object.values(stored().appts).find((a) => a.pcfs && a.pcfs['cf-email'])
      expect(created).toBeTruthy()
      expect(created.pcfs['cf-email'].value).toBe('guardian@example.com')
      expect(created.pcfs['cf-notes'].value).toBe('Parent asked about sleep routine.')
    })
  })
})

describe('custom-field required semantics (audit CFG-07)', () => {
  it('the template editor labels the toggle “Required once added” and explains it', async () => {
    render(<App />)
    await toMasters()
    fireEvent.click(screen.getByTestId('masters-tab-cfdefs'))
    await screen.findByTestId('cfdefs-table')
    fireEvent.click(screen.getByTestId('cf-add'))
    await screen.findByTestId('cf-modal')
    const flag = await screen.findByText('Required once added')
    expect(flag.closest('.cf-flag').getAttribute('title')).toMatch(/never added to new appointments automatically/)
    expect(screen.queryByText('Required at booking')).toBeNull()
    // the toggle still saves
    fireEvent.click(screen.getByTestId('cf-required'))
    fireEvent.change(screen.getByTestId('cf-label'), { target: { value: 'Intake note' } })
    fireEvent.click(screen.getByTestId('cf-save'))
    await waitFor(() => expect(stored().customFields.some((d) => d.label === 'Intake note' && d.required)).toBe(true))
  })

  it('a required template blocks the save only once it is added to the session', async () => {
    seed([{ id: 'cf-must', label: 'Must capture', type: 'text', required: true, status: 'active', assignedTo: ['appointment'] }])
    render(<App />)
    await bookJustin()
    // not added → the save is not blocked by it
    fireEvent.click(screen.getByTestId('save-appt'))
    expect(await screen.findByText('Appointment created')).toBeTruthy()
    // added but empty → blocked; filled → saves
    await bookJustin()
    fireEvent.click(screen.getByTestId('am-pcf-add'))
    await screen.findByTestId('am-pcf-picker')
    fireEvent.click(screen.getByTestId('am-pcf-pick-cf-must').querySelector('input'))
    fireEvent.click(screen.getByTestId('am-pcf-picker-done'))
    fireEvent.click(screen.getByTestId('save-appt'))
    expect(await screen.findByText(/Payer field “Must capture” is required/)).toBeTruthy()
    fireEvent.change(screen.getByTestId('pcf-in-cf-must'), { target: { value: 'captured' } })
    fireEvent.click(screen.getByTestId('save-appt'))
    expect(await screen.findByText('Appointment created')).toBeTruthy()
  })
})
