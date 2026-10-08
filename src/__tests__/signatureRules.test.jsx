import React from 'react'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react'
import App from '../App'
import { blankState } from '../state/store'
import { systemConfigFor, staffSigRequiredToCompleteOf } from '../lib/settingsMasters'
import { addDays, isoDate, todayISO } from '../lib/date'

// The seed is dated relative to today, so on some days the picked clinician already has a
// session in the default slot and the Warn gate asks for its tick before saving. Tick it
// when shown, so these flows test what they name on any date.
const ackWarns = () => { const a = screen.queryByTestId('appt-ack-warns'); if (a && !a.classList.contains('on')) fireEvent.click(a) }


const KEY = 'aloha-aba.v3'
const stored = () => { try { return JSON.parse(localStorage.getItem(KEY)) } catch { return null } }
const seed = (st) => localStorage.setItem(KEY, JSON.stringify(st))

beforeEach(() => { localStorage.clear(); cleanup() })
afterEach(() => cleanup())

async function pickDropdown(triggerTestId, optionValue) {
  fireEvent.click(await screen.findByTestId(triggerTestId))
  fireEvent.click(await screen.findByTestId(`opt-${triggerTestId}-${optionValue}`))
}

// open the booking wizard with a client + staff picked, ready for date/status
async function openWizard(clientName) {
  fireEvent.click(screen.getByTestId('nav-calendar'))
  fireEvent.click(screen.getByRole('button', { name: 'Appointment' }))
  fireEvent.click(await screen.findByTestId('type-service'))
  fireEvent.click(screen.getByTestId('pick-Client Name'))
  const item = (await screen.findAllByTestId('people-item')).find((b) => b.textContent.includes(clientName))
  fireEvent.click(item)
  fireEvent.mouseDown(document.body)
  fireEvent.click(screen.getByTestId('pick-Staff Name'))
  fireEvent.click((await screen.findAllByTestId('people-item'))[0])
  fireEvent.mouseDown(document.body)
  await screen.findByTestId('am-pcf')
}

// SignaturePad starts in draw mode (canvas is unsupported in jsdom) — switch to Type, sign
async function captureSignature(containerTestId, name) {
  const box = await screen.findByTestId(containerTestId)
  fireEvent.click(await within(box).findByRole('button', { name: /Type/ }))
  fireEvent.change(await within(box).findByTestId('sig-type'), { target: { value: name } })
  fireEvent.click(within(box).getByTestId('sig-sign'))
  await within(box).findByText(/Signed by/)
}

async function openSystemSettings() {
  fireEvent.click(await screen.findByTestId('nav-settings'))
  await screen.findByTestId('settings-modal')
  fireEvent.click(screen.getByTestId('nav-sub-set-system'))
}

describe('signature rules (audit CFG-04)', () => {
  it('systemConfigFor reads the legacy key, the canonical key wins, default is off', () => {
    expect(staffSigRequiredToCompleteOf({})).toBe(false)
    expect(staffSigRequiredToCompleteOf({ system: { general: { staffSignatureRequired: true } } })).toBe(true)
    expect(staffSigRequiredToCompleteOf({ system: { general: { staffSignatureRequired: true, staffSigRequiredToComplete: false } } })).toBe(false)
    expect(systemConfigFor({ system: { general: { staffSignatureRequired: true } } }).general.staffSigRequiredToComplete).toBe(true)
  })

  it('migrates a saved legacy staffSignatureRequired key onto the canonical key on load', async () => {
    const st = blankState()
    st.settings.system = { general: { staffSignatureRequired: true } }
    seed(st)
    render(<App />)
    await waitFor(() => expect(stored()?.settings?.system?.general?.staffSigRequiredToComplete).toBe(true))
    expect(stored().settings.system.general.staffSignatureRequired).toBeUndefined()
  })

  it('settings toggle writes the canonical key and defaults to off', async () => {
    render(<App />)
    await openSystemSettings()
    const t = await screen.findByTestId('set-sys-gen-sigreq')
    expect(t.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(t)
    await waitFor(() => expect(stored().settings.system.general.staffSigRequiredToComplete).toBe(true))
    expect(stored().settings.system.general.staffSignatureRequired).toBeUndefined()
  })

  it('payer client-signature rule blocks completion until the family signature is captured', async () => {
    render(<App />)
    await openWizard('Justin Hsu') // Aetna — seeded with appt.sigRequired
    const targetDate = isoDate(addDays(todayISO(), 14))
    fireEvent.change(screen.getByTestId('appt-date'), { target: { value: targetDate } })
    await pickDropdown('status-select', 'completed')
    // the seed may already hold a session for Justin that day, so count rather than look for none
    const justin = stored().clients.find((c) => c.name === 'Justin Hsu')
    const onDay = () => Object.values(stored().appts).filter((a) => (a.clientIds || []).includes(justin.id) && a.date === targetDate).length
    const before = onDay()
    ackWarns(); fireEvent.click(screen.getByTestId('save-appt'))
    expect(await screen.findByText('Aetna requires a client signature to complete this appointment.')).toBeTruthy()
    // nothing was written for this booking
    expect(onDay()).toBe(before)
    // the Verification tab offers a distinct client/guardian pad next to the staff pad
    fireEvent.click(screen.getByRole('button', { name: /Verification/ }))
    const clientBox = await screen.findByTestId('am-client-sig')
    expect(clientBox.textContent).toContain('L. Hsu')
    expect(screen.getByTestId('am-sig-note').textContent).toContain('Aetna')
    await captureSignature('am-client-sig', 'L. Hsu')
    ackWarns(); fireEvent.click(screen.getByTestId('save-appt'))
    const detail = await screen.findByTestId('detail-card')
    const a = await waitFor(() => {
      const found = Object.values(stored().appts).find((x) => x.verification?.clientSignature)
      expect(found).toBeTruthy()
      return found
    })
    expect(a.verification.clientSignature.kind).toBe('client')
    expect(a.verification.clientSignature.staffName).toBe('L. Hsu')
    expect(a.status).toBe('completed')
    expect(within(detail).getByTestId('dc-client-sig').textContent).toContain('L. Hsu')
  })

  it('system staff-signature rule blocks completion and renders safely with no payer on file', async () => {
    const st = blankState()
    st.settings.system = { general: { staffSigRequiredToComplete: true } }
    const client = st.clients.find((c) => c.insurer === 'Aetna')
    client.insurer = 'No payer on file' // payerForAppt finds no record — the old note crashed here
    seed(st)
    render(<App />)
    await openWizard(client.name)
    fireEvent.change(screen.getByTestId('appt-date'), { target: { value: isoDate(addDays(todayISO(), 14)) } })
    await pickDropdown('status-select', 'completed')
    ackWarns(); fireEvent.click(screen.getByTestId('save-appt'))
    expect((await screen.findAllByText(/practice requires a staff verification signature/)).length).toBeGreaterThan(0)
    // the verification tab renders the staff rule without touching the missing payer
    fireEvent.click(screen.getByRole('button', { name: /Verification/ }))
    expect(await screen.findByTestId('am-staffsig-note')).toBeTruthy()
    expect(screen.queryByTestId('am-sig-note')).toBeNull()
    await captureSignature('am-staff-sig', 'Verifier')
    ackWarns(); fireEvent.click(screen.getByTestId('save-appt'))
    await screen.findByTestId('detail-card')
    const a = Object.values(stored().appts).find((x) => (x.clientIds || []).includes(client.id) && x.verification?.signature)
    expect(a).toBeTruthy()
    expect(a.status).toBe('completed')
    expect(a.verification.clientSignature ?? null).toBeNull() // staff signature never satisfies the client rule slot
  })

  it('quick verify refuses to complete a session the payer requires a client signature for', async () => {
    const st = blankState()
    const payer = st.payers.find((p) => p.name === 'Aetna')
    payer.rules = { ...(payer.rules || {}), appt: { ...(payer.rules?.appt || {}), sigRequired: true } }
    const client = st.clients.find((c) => c.insurer === 'Aetna')
    const id = 'a-quickverify'
    st.appts[id] = {
      id, type: 'service', title: 'Quick verify target', date: isoDate(addDays(todayISO(), -7)),
      start: 9 * 60, end: 10 * 60, clientIds: [client.id], staffIds: [st.staff[0].id],
      status: 'active', location: 'Main Center', service: 'dtt', notes: '',
      billing: { code: '97151', unitMins: 15, rounding: 'AMA', minutes: 60, units: 4, rate: 32, mileage: false, distance: 0 },
      custom: {}, documents: [], verification: null, recurrence: 'none', abaHr: false,
    }
    seed({ ...st, ui: { ...st.ui, openAppt: id } })
    render(<App />)
    const detail = await screen.findByTestId('detail-card')
    fireEvent.click(within(detail).getByRole('button', { name: 'Verify' }))
    expect(await screen.findByText(/Aetna requires a client signature before this session can be completed/)).toBeTruthy()
    expect(stored().appts[id].status).toBe('active')
    expect(stored().appts[id].verification ?? null).toBeNull()
  })

  it('quick verify completes once the client signature is on file, recording the staff signature', async () => {
    const st = blankState()
    const payer = st.payers.find((p) => p.name === 'Aetna')
    payer.rules = { ...(payer.rules || {}), appt: { ...(payer.rules?.appt || {}), sigRequired: true } }
    const client = st.clients.find((c) => c.insurer === 'Aetna')
    const id = 'a-quickverify-ok'
    st.appts[id] = {
      id, type: 'service', title: 'Quick verify target', date: isoDate(addDays(todayISO(), -7)),
      start: 9 * 60, end: 10 * 60, clientIds: [client.id], staffIds: [st.staff[0].id],
      status: 'active', location: 'Main Center', service: 'dtt', notes: '',
      billing: { code: '97151', unitMins: 15, rounding: 'AMA', minutes: 60, units: 4, rate: 32, mileage: false, distance: 0 },
      custom: {}, documents: [], recurrence: 'none', abaHr: false,
      verification: {
        completedBy: '', checks: {}, verifyStatus: 'pending', note: '', signature: null,
        clientSignature: { mode: 'type', text: 'L. Hsu', dataUrl: null, staffId: '', staffName: 'L. Hsu', kind: 'client', certification: '', timestamp: new Date().toISOString(), geo: null },
      },
    }
    seed({ ...st, ui: { ...st.ui, openAppt: id } })
    render(<App />)
    const detail = await screen.findByTestId('detail-card')
    expect(within(detail).getByTestId('dc-client-sig').textContent).toContain('L. Hsu')
    fireEvent.click(within(detail).getByRole('button', { name: 'Verify' }))
    await waitFor(() => expect(stored().appts[id].status).toBe('completed'))
    expect(stored().appts[id].verification.signature.staffName).toBeTruthy()
    expect(stored().appts[id].verification.clientSignature.kind).toBe('client')
  })
})

describe('honest settings copy (audit CFG-10 / CFG-11)', () => {
  it('maximum appointment length is labelled as a warning, not a hard ceiling', async () => {
    render(<App />)
    await openSystemSettings()
    const row = (await screen.findByText('Maximum Appointment Length')).closest('.set-row')
    expect(row.getAttribute('title')).toContain('Warns when a single scheduled session runs longer')
    expect(row.getAttribute('title')).not.toContain('Hard ceiling')
  })

  it('clinical integrations table lists the clinical platform rows instead of an empty table', async () => {
    render(<App />)
    await openSystemSettings()
    fireEvent.click(await screen.findByTestId('set-sys-tab-clinical-integrations'))
    expect(await screen.findByTestId('set-sys-clin-int-ensora')).toBeTruthy()
    expect(screen.getByTestId('set-sys-clin-int-hirasmus')).toBeTruthy()
    expect(screen.getByTestId('set-sys-clin-int-motivity')).toBeTruthy()
    expect(screen.getByTestId('set-sys-clin-int-welina')).toBeTruthy()
    expect(screen.getByTestId('set-sys-clin-int-fhir')).toBeTruthy()
    expect(screen.queryByText('No clinical integrations configured.')).toBeNull()
  })
})
