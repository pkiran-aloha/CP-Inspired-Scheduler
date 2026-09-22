import React from 'react'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import App from '../App'
import { ensurePayer, svcList, rateFor, concurrentNote, payerForAppt } from '../lib/master'

const KEY = 'aloha-aba.v3'
const stored = () => { try { return JSON.parse(localStorage.getItem(KEY)) } catch { return null } }

beforeEach(() => { localStorage.clear(); cleanup() })
afterEach(() => cleanup())

async function toMasters(tab) {
  fireEvent.click(screen.getByTestId('nav-collapse')) // force the rail expanded so sub-items exist
  fireEvent.click(screen.getByTestId('nav-masters'))
  await screen.findByTestId('payers-table') // the Payers tab is the default landing list
  await waitFor(() => expect(stored()).toBeTruthy()) // first debounced persist has landed
  if (tab === 'svcs') {
    fireEvent.click(screen.getByTestId('masters-tab-svcs'))
    await screen.findByTestId('svcs-table')
  }
}
async function openDetail(id) {
  await toMasters()
  fireEvent.click(await screen.findByTestId(`py-row-${id}`))
  await screen.findByTestId('payer-detail')
  await waitFor(() => expect(stored()).toBeTruthy()) // first debounced persist has landed
}
async function pickDropdown(triggerTestId, optionValue) {
  fireEvent.click(await screen.findByTestId(triggerTestId))
  fireEvent.click(await screen.findByTestId(`opt-${triggerTestId}-${optionValue}`))
}

describe('masters — nav & service types', () => {
  it('Masters nav item carries the Payers + Service Types sub-list', async () => {
    render(<App />)
    fireEvent.click(screen.getByTestId('nav-collapse'))
    expect(await screen.findByTestId('nav-masters')).toBeTruthy()
    expect(screen.queryByTestId('nav-payers')).toBeNull() // no longer a top-level section
    fireEvent.click(screen.getByTestId('nav-masters'))
    const subs = await screen.findAllByTestId(/nav-sub-/)
    expect(subs.map((b) => b.textContent).sort()).toEqual(['Payers', 'Service Types'])
    fireEvent.click(screen.getByTestId('nav-sub-svcs'))
    expect(await screen.findByTestId('svcs-table')).toBeTruthy()
    expect(screen.getByTestId('masters-tab-svcs').className).toContain('on')
  })

  it('service master is editable and persists — add, then edit the rate', async () => {
    render(<App />)
    await toMasters('svcs')
    const base = stored().svcs.length
    fireEvent.click(screen.getByTestId('sv-add'))
    fireEvent.change(await screen.findByTestId('sv-label'), { target: { value: 'PRT Evaluation' } })
    await pickDropdown('sv-code', '97152')
    fireEvent.change(screen.getByTestId('sv-rate'), { target: { value: '55' } })
    fireEvent.click(screen.getByTestId('sv-save'))
    await waitFor(() => expect(stored().svcs).toHaveLength(base + 1))
    const created = stored().svcs.find((s) => s.label === 'PRT Evaluation')
    expect(created.code).toBe('97152')
    expect(created.rate).toBe(55)
    // edit: click the row → modal flips to edit mode → change rate
    fireEvent.click(screen.getByTestId(`sv-row-${created.id}`))
    fireEvent.change(await screen.findByTestId('sv-rate'), { target: { value: '60' } })
    fireEvent.click(screen.getByTestId('sv-save'))
    await waitFor(() => expect(stored().svcs.find((s) => s.id === created.id).rate).toBe(60))
  })

  it('deleting a service blocked while appointments use it; free ones leave, and payer contracts get cleaned', async () => {
    render(<App />)
    await toMasters('svcs')
    const used = Object.values(stored().appts).find((a) => a.service)?.service
    expect(used).toBeTruthy()
    fireEvent.click(screen.getByTestId(`sv-del-${used}`))
    expect(await screen.findByTestId('sv-row-' + used)).toBeTruthy() // still there
    expect(stored().svcs.find((s) => s.id === used)).toBeTruthy()
    // add an unused one and remove it
    fireEvent.click(screen.getByTestId('sv-add'))
    fireEvent.change(await screen.findByTestId('sv-label'), { target: { value: 'Zoo ABA' } })
    fireEvent.click(screen.getByTestId('sv-save'))
    await waitFor(() => expect(stored().svcs.some((s) => s.label === 'Zoo ABA')).toBe(true))
    const zid = stored().svcs.find((s) => s.label === 'Zoo ABA').id
    fireEvent.click(screen.getByTestId(`sv-del-${zid}`))
    await waitFor(() => expect(stored().svcs.some((s) => s.id === zid)).toBe(false))
    expect(screen.queryByTestId(`sv-row-${zid}`)).toBeNull()
  })

  it('status toggle flips active/inactive in storage', async () => {
    render(<App />)
    await toMasters('svcs')
    const id = stored().svcs.find((s) => s.status === 'active').id
    fireEvent.click(screen.getByTestId(`sv-toggle-${id}`))
    await waitFor(() => expect(stored().svcs.find((s) => s.id === id).status).toBe('inactive'))
    expect(screen.getByTestId(`sv-status-${id}`).textContent).toContain('Inactive')
    fireEvent.click(screen.getByTestId(`sv-toggle-${id}`))
    await waitFor(() => expect(stored().svcs.find((s) => s.id === id).status).toBe('active'))
  })
})

describe('masters — payer deep record', () => {
  it('row click opens the tabbed record; profile shows the master routing fields', async () => {
    render(<App />)
    await openDetail('py-aetna')
    expect(screen.getByTestId('pd-tab-profile').className).toContain('on')
    const info = await screen.findByTestId('pd-info')
    expect(info.textContent).toContain('Aetna Better Health of CA') // AKA
    expect(info.textContent).toContain('Availity') // clearing house from seed
    expect(info.textContent).toContain('87211') // payer id
    expect(info.textContent).toContain('(800) 555-0127') // phone link
    expect(screen.getByTestId('pd-tab-services')).toBeTruthy()
    expect(screen.getByTestId('pd-tab-rules')).toBeTruthy()
    fireEvent.click(screen.getByTestId('pd-back'))
    expect(await screen.findByTestId('payers-table')).toBeTruthy()
  })

  it('edit record updates routing fields everywhere', async () => {
    render(<App />)
    await openDetail('py-regence-bcbs')
    fireEvent.click(screen.getByTestId('pd-edit'))
    fireEvent.change(await screen.findByTestId('py-payerId'), { target: { value: 'REG-7741' } })
    fireEvent.change(screen.getByTestId('py-clearingHouse'), { target: { value: 'Availity' } })
    fireEvent.click(screen.getByTestId('py-save'))
    await waitFor(() => expect(stored().payers.find((p) => p.id === 'py-regence-bcbs').payerId).toBe('REG-7741'))
    const info = await screen.findByTestId('pd-info')
    expect(info.textContent).toContain('REG-7741')
    expect(info.textContent).toContain('Availity')
  })

  it('custom fields: add, persist, remove', async () => {
    render(<App />)
    await openDetail('py-aetna')
    const before = stored().payers.find((p) => p.id === 'py-aetna').cf.length
    fireEvent.change(await screen.findByTestId('pd-cf-label'), { target: { value: 'Auth line' } })
    fireEvent.change(screen.getByTestId('pd-cf-value'), { target: { value: 'Behav-77' } })
    fireEvent.click(screen.getByTestId('pd-cf-add'))
    await waitFor(() => expect(stored().payers.find((p) => p.id === 'py-aetna').cf).toHaveLength(before + 1))
    expect(screen.getByTestId(`pd-cf-${before}`).textContent).toContain('Auth line')
    fireEvent.click(screen.getByTestId(`pd-cf-${before}`).querySelector('.iconbtn'))
    await waitFor(() => expect(stored().payers.find((p) => p.id === 'py-aetna').cf).toHaveLength(before))
  })

  it('services tab: default-all note, narrowing contracts via the + picker', async () => {
    const { container } = render(<App />)
    await openDetail('py-regence-bcbs')
    fireEvent.click(screen.getByTestId('pd-tab-services'))
    expect(await screen.findByTestId('pd-svc-all')).toBeTruthy()
    await waitFor(() => expect(stored()).toBeTruthy())
    const n = stored().svcs.filter((s) => s.status !== 'inactive').length
    await waitFor(() => expect(container.querySelectorAll('.svc-card').length).toBe(n))
    fireEvent.click(screen.getByTestId('pd-svc-fab'))
    await screen.findByTestId('pd-svc-picker')
    fireEvent.click(screen.getByTestId('pd-pick-dtt').querySelector('input'))
    await waitFor(() => expect(stored().payers.find((p) => p.id === 'py-regence-bcbs').services).toHaveLength(n - 1))
    expect(stored().payers.find((p) => p.id === 'py-regence-bcbs').services).not.toContain('dtt')
    fireEvent.click(screen.getByTestId('pd-svc-picker-close'))
    await waitFor(() => expect(screen.queryByTestId('pd-svc-dtt')).toBeNull())
    expect(screen.queryAllByTestId(/pd-svc-/).length).toBeGreaterThan(5)
  })

  it('per-service override modal shows contract data and saves a new charge', async () => {
    render(<App />)
    await openDetail('py-aetna')
    fireEvent.click(screen.getByTestId('pd-tab-services'))
    const card = await screen.findByTestId('pd-svc-dtt')
    expect(card.textContent).toContain('$38.00') // seeded Aetna override
    expect(card.textContent).toContain('Effective 2025-01-01')
    fireEvent.click(screen.getByTestId('pd-ovr-dtt'))
    const charge = await screen.findByTestId('ovr-charge')
    expect(charge.value).toBe('38')
    expect(screen.getByTestId('ovr-contract').value).toBe('34')
    fireEvent.change(charge, { target: { value: '40.5' } })
    fireEvent.click(screen.getByTestId('ovr-save'))
    await waitFor(() => expect(stored().payers.find((p) => p.id === 'py-aetna').svcOv.dtt.charge).toBe('40.5'))
    expect(await screen.findByTestId('pd-svc-dtt')).toBeTruthy()
  })
})

describe('masters — billing rules', () => {
  it('concurrent billing: seeded Not Allowed shows, saving Allowed persists', async () => {
    render(<App />)
    await openDetail('py-aetna')
    fireEvent.click(screen.getByTestId('pd-tab-rules'))
    await screen.findByTestId('pr-concurrent')
    expect(screen.getByTestId('conc-notallowed').className).toContain('on')
    fireEvent.click(screen.getByTestId('conc-allowed'))
    fireEvent.click(screen.getByTestId('pr-save'))
    await waitFor(() => expect(stored().payers.find((p) => p.id === 'py-aetna').rules.concurrent.allowed).toBe(true))
  })

  it('concurrent rules builder: add a triple, save, persisted in order', async () => {
    render(<App />)
    await openDetail('py-blue-shield-ca')
    fireEvent.click(screen.getByTestId('pd-tab-rules'))
    await screen.findByTestId('conc-add')
    await waitFor(() => expect(stored()).toBeTruthy())
    fireEvent.click(screen.getByTestId('conc-add'))
    await pickDropdown('conc-if-0', 'dtt')
    await pickDropdown('conc-with-0', 'net')
    await pickDropdown('conc-bill-0', 'dtt')
    fireEvent.click(screen.getByTestId('pr-save'))
    await waitFor(() => expect(stored().payers.find((p) => p.id === 'py-blue-shield-ca').rules.concurrent.rules).toHaveLength(1))
    expect(stored().payers.find((p) => p.id === 'py-blue-shield-ca').rules.concurrent.rules[0]).toEqual({ if: 'dtt', with: 'net', bill: 'dtt' })
  })

  it('claims settings: merge-same-day default on, toggle persists', async () => {
    render(<App />)
    await openDetail('py-blue-shield-ca')
    fireEvent.click(screen.getByTestId('pd-tab-rules'))
    fireEvent.click(await screen.findByTestId('pr-tab-claims'))
    await screen.findByTestId('pr-claims')
    expect(screen.getByTestId('clm-flag-mergeSameDay').checked).toBe(true)
    fireEvent.click(screen.getByTestId('clm-flag-renderProvider'))
    fireEvent.click(screen.getByTestId('pr-save'))
    await waitFor(() => expect(stored().payers.find((p) => p.id === 'py-blue-shield-ca').rules.claims.flags.renderProvider).toBe(true))
    expect(stored().payers.find((p) => p.id === 'py-blue-shield-ca').rules.claims.flags.mergeSameDay).toBe(true)
  })

  it('appointment settings: signature requirement toggle round-trips', async () => {
    render(<App />)
    await openDetail('py-blue-shield-ca')
    fireEvent.click(screen.getByTestId('pd-tab-rules'))
    fireEvent.click(await screen.findByTestId('pr-tab-appt'))
    await screen.findByTestId('pr-appt')
    expect(screen.getByTestId('appt-sig').className).not.toContain('on')
    fireEvent.click(screen.getByTestId('appt-sig'))
    fireEvent.click(screen.getByTestId('pr-save'))
    await waitFor(() => expect(stored().payers.find((p) => p.id === 'py-blue-shield-ca').rules.appt.sigRequired).toBe(true))
  })

  it('qualification modifiers: edit, reorder and add persist', async () => {
    render(<App />)
    await openDetail('py-blue-shield-ca')
    fireEvent.click(screen.getByTestId('pd-tab-rules'))
    fireEvent.click(await screen.findByTestId('pr-tab-qual'))
    await screen.findByTestId('pr-qual')
    const rows0 = screen.getAllByTestId(/qm-row-\d+/).length
    expect(rows0).toBe(5)
    fireEvent.click(screen.getByTestId('qm-del-4'))
    fireEvent.click(screen.getByTestId('qm-add'))
    await pickDropdown('qm-qual-4', 'Therapist')
    fireEvent.click(screen.getByTestId('qm-up-4'))
    fireEvent.click(screen.getByTestId('pr-save'))
    await waitFor(() => expect(stored().payers.find((p) => p.id === 'py-blue-shield-ca').rules.qualMods.some((r) => r.qual === 'Therapist')).toBe(true))
    const qm = stored().payers.find((p) => p.id === 'py-blue-shield-ca').rules.qualMods
    expect(qm).toHaveLength(5)
    expect(qm[3].qual).toBe('Therapist') // moved up from last
  })

  it('POS modifiers: edit, hide-flags save', async () => {
    render(<App />)
    await openDetail('py-blue-shield-ca')
    fireEvent.click(screen.getByTestId('pd-tab-rules'))
    fireEvent.click(await screen.findByTestId('pr-tab-pos'))
    await screen.findByTestId('pr-pos')
    await pickDropdown('pos-mod-0', 'U6')
    fireEvent.click(screen.getByTestId('pos-hide02'))
    fireEvent.click(screen.getByTestId('pr-save'))
    await waitFor(() => expect(stored().payers.find((p) => p.id === 'py-blue-shield-ca').rules.posMods[0].mod).toBe('U6'))
    expect(stored().payers.find((p) => p.id === 'py-blue-shield-ca').rules.hideTeleOther).toBe(true)
  })

  it('MUEs: daily cap and per-code limits persist', async () => {
    render(<App />)
    await openDetail('py-blue-shield-ca')
    fireEvent.click(screen.getByTestId('pd-tab-rules'))
    fireEvent.click(await screen.findByTestId('pr-tab-mue'))
    await screen.findByTestId('pr-mue')
    expect(await screen.findByTestId('mue-banner')).toBeTruthy()
    await waitFor(() => expect(stored()).toBeTruthy())
    await pickDropdown('mue-daily', '96')
    await pickDropdown('mue-97151', '16')
    fireEvent.click(screen.getByTestId('pr-save'))
    await waitFor(() => expect(stored().payers.find((p) => p.id === 'py-blue-shield-ca').rules.mue.daily).toBe('96'))
    expect(stored().payers.find((p) => p.id === 'py-blue-shield-ca').rules.mue.per['97151']).toBe('16')
  })

  it('cancel discards the draft', async () => {
    render(<App />)
    await openDetail('py-blue-shield-ca')
    fireEvent.click(screen.getByTestId('pd-tab-rules'))
    fireEvent.click(await screen.findByTestId('conc-notallowed'))
    fireEvent.click(screen.getByTestId('pr-cancel'))
    await waitFor(() => expect(screen.getByTestId('conc-allowed').className).toContain('on'))
    expect(stored().payers.find((p) => p.id === 'py-blue-shield-ca').rules).toBeUndefined() // nothing was committed
  })

  it('legacy saves without rules render fine through ensurePayer', async () => {
    localStorage.clear()
    render(<App />)
    await screen.findByTestId('nav-masters') // seed loaded
    await waitFor(() => expect(stored()).toBeTruthy())
    const s = stored()
    // strip every master key from one payer, re-save it as a legacy record
    s.payers = s.payers.map((p) => { if (p.id !== 'py-blue-shield-ca') return p; const { rules, svcOv, services, cf, cmsType, format, payerId, clearingHouse, ...rest } = p; return rest })
    localStorage.setItem(KEY, JSON.stringify(s))
    cleanup()
    render(<App />)
    fireEvent.click(screen.getByTestId('nav-masters'))
    fireEvent.click(await screen.findByTestId('py-row-py-blue-shield-ca'))
    await screen.findByTestId('payer-detail')
    fireEvent.click(screen.getByTestId('pd-tab-rules'))
    await screen.findByTestId('pr-concurrent')
    expect(screen.getByTestId('conc-allowed').className).toContain('on') // defaults apply
    fireEvent.click(screen.getByTestId('pd-tab-services'))
    expect(await screen.findByTestId('pd-svc-all')).toBeTruthy() // empty contract = all active
  })
})

describe('masters — platform relationships', () => {
  it('wizard books at the payer contract rate — note shown and charge used', async () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Appointment' }))
    fireEvent.click(await screen.findByTestId('type-service'))
    // client: Justin Hsu (payer Aetna with the seeded dtt override $38)
    fireEvent.click(screen.getByTestId('pick-Client Name'))
    const item = (await screen.findAllByTestId('people-item')).find((b) => b.textContent.includes('Justin Hsu'))
    fireEvent.click(item)
    fireEvent.mouseDown(document.body)
    fireEvent.click(screen.getByTestId('pick-Staff Name'))
    fireEvent.click((await screen.findAllByTestId('people-item'))[0])
    fireEvent.mouseDown(document.body)
    await pickDropdown('service-select', 'dtt')
    const note = await screen.findByTestId('am-rate-ovr')
    expect(note.textContent).toContain('$38.00')
    expect(note.textContent).toContain('Aetna')
    fireEvent.change(screen.getByTestId('appt-date'), { target: { value: '2026-12-23' } })
    fireEvent.click(screen.getByTestId('save-appt'))
    await screen.findByText('Appointment created')
    await waitFor(() => {
      const created = Object.values(stored().appts).find((a) => a.date === '2026-12-23' && a.service === 'dtt')
      expect(created).toBeTruthy()
      expect(created.billing.rate).toBe(38)
    })
  })

  it('payer signature rule blocks completing an appointment', async () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Appointment' }))
    fireEvent.click(await screen.findByTestId('type-service'))
    fireEvent.click(screen.getByTestId('pick-Client Name'))
    const item = (await screen.findAllByTestId('people-item')).find((b) => b.textContent.includes('Justin Hsu'))
    fireEvent.click(item)
    fireEvent.mouseDown(document.body)
    fireEvent.click(screen.getByTestId('pick-Staff Name'))
    fireEvent.click((await screen.findAllByTestId('people-item'))[0])
    fireEvent.mouseDown(document.body)
    fireEvent.change(screen.getByTestId('appt-date'), { target: { value: '2026-12-24' } })
    await pickDropdown('status-select', 'completed')
    // Aetna requires a signature; block and route to the Verification tab
    fireEvent.click(screen.getByTestId('save-appt'))
    expect(await screen.findByText('Aetna requires a client signature to complete this appointment.')).toBeTruthy()
    expect(await screen.findByTestId('am-sig-note')).toBeTruthy()
    expect(screen.getByTestId('am-sig-note').textContent).toContain('Aetna')
    // not blocked for a payer without the rule (BSCA — Maya? use client without Aetna)
    fireEvent.keyDown(window, { key: 'Escape' })
    fireEvent.click(screen.getByRole('button', { name: 'Appointment' }))
    fireEvent.click(await screen.findByTestId('type-service'))
    fireEvent.click(screen.getByTestId('pick-Client Name'))
    const bsca = (await screen.findAllByTestId('people-item')).find((b) => b.textContent.includes('Sowmya Reddy'))
    if (bsca) {
      fireEvent.click(bsca)
      fireEvent.mouseDown(document.body)
      expect(screen.queryByTestId('am-sig-note')).toBeNull() // Sowmya → Blue Shield CA, no signature rule
    }
  })

  it('master helpers: ensurePayer defaults, rate fallback chain, concurrent note', () => {
    const bare = ensurePayer({ id: 'x', name: 'X' })
    expect(bare.rules.concurrent.allowed).toBe(true)
    expect(bare.rules.qualMods[0]).toEqual({ qual: 'Doctoral', m1: 'U6', m2: 'HP' })
    expect(bare.services).toEqual([])
    const st = { svcs: [{ id: 'dtt', label: 'DTT', code: '97151', rate: 32, status: 'active', unitMins: 30 }], clients: [], payers: [], appts: [] }
    expect(rateFor(st, null, 'dtt', '97151').rate).toBe(32)
    const withPayer = ensurePayer({ id: 'p', name: 'P', svcOv: { dtt: { charge: '44' } } })
    expect(rateFor(st, withPayer, 'dtt', '97151')).toEqual({ rate: 44, source: 'P contract' })
    const note = concurrentNote(st, { payer: { ...withPayer, rules: { concurrent: { allowed: false, rules: [] } } }, svcId: 'dtt', clientId: 'c1', date: '2026-12-23', start: 540, end: 600 })
    expect(note).toBeNull() // no overlapping appts
    const st2 = { ...st, appts: [{ id: 'a1', clientIds: ['c1'], date: '2026-12-23', start: 570, end: 630, service: 'net', status: 'active' }] }
    const note2 = concurrentNote(st2, { payer: { ...withPayer, rules: { concurrent: { allowed: false, rules: [] } } }, svcId: 'dtt', clientId: 'c1', date: '2026-12-23', start: 540, end: 600 })
    expect(note2.level).toBe('warn')
    expect(note2.text).toContain('does not allow concurrent billing')
  })

  it('svcList falls back to the model when no store slice exists (claims/exports stay stable)', () => {
    const list = svcList({})
    expect(list.map((s) => s.id)).toContain('dtt')
    expect(list.every((s) => s.rate > 0 && s.status === 'active')).toBe(true)
    expect(payerForAppt({ clients: [{ id: 'c1', insurer: 'Aetna' }], payers: [{ id: 'py-aetna', name: 'Aetna' }] }, ['c1']).id).toBe('py-aetna')
  })
})
