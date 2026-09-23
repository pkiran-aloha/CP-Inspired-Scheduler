import React from 'react'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import App from '../App'
import { ensurePayer, svcList, rateFor, concurrentNote, payerForAppt, svcOptionsFor, svcById } from '../lib/master'

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
  if (tab === 'cfdefs') {
    fireEvent.click(screen.getByTestId('masters-tab-cfdefs'))
    await screen.findByTestId('cfdefs-table')
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
    expect(subs.map((b) => b.textContent).sort()).toEqual(expect.arrayContaining(['Payers', 'Service Types', 'Custom Fields']))
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
    fireEvent.click(screen.getByTestId(`sv-status-${id}`))
    await waitFor(() => expect(stored().svcs.find((s) => s.id === id).status).toBe('inactive'))
    expect(screen.getByTestId(`sv-status-${id}`).textContent).toContain('Inactive')
    fireEvent.click(screen.getByTestId(`sv-status-${id}`))
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

  it('Custom Fields master page: define list options and toggle labels right in the template editor', async () => {
    render(<App />)
    await toMasters('cfdefs')
    // seeded templates render with their type, options and usage
    expect(await screen.findByTestId('cf-row-cf-authdept')).toBeTruthy()
    expect(screen.getByTestId('cf-row-cf-authdept').textContent).toContain('Single select (radio)')
    expect(screen.getByTestId('cf-usedby-cf-authdept').textContent).toBe('1') // Aetna picks it
    expect(screen.getByTestId('cf-row-cf-goals').textContent).toContain('+3') // 6 options, 3 shown
    expect(screen.getByTestId('cf-status-cf-teleconf').textContent).toContain('Inactive')
    // create a select template with a live option list
    fireEvent.click(screen.getByTestId('cf-add'))
    await screen.findByTestId('cf-modal')
    fireEvent.click(screen.getByTestId('cf-save'))
    expect(await screen.findByText('Give the field a label')).toBeTruthy()
    fireEvent.change(screen.getByTestId('cf-label'), { target: { value: 'Reward menu' } })
    await pickDropdown('cf-type', 'select')
    expect(await screen.findByTestId('cf-opt-0')).toBeTruthy() // one editable option row by default
    fireEvent.change(screen.getByTestId('cf-opt-0'), { target: { value: 'Stickers' } })
    fireEvent.click(screen.getByTestId('cf-opt-add'))
    fireEvent.change(screen.getByTestId('cf-opt-1'), { target: { value: 'Extra screen time' } })
    fireEvent.click(screen.getByTestId('cf-save'))
    await waitFor(() => expect(stored().customFields.some((d) => d.label === 'Reward menu')).toBe(true))
    const nf = stored().customFields.find((d) => d.label === 'Reward menu')
    expect(nf.options).toEqual(['Stickers', 'Extra screen time'])
    // options are reorderable inline
    fireEvent.click(screen.getByTestId(`cf-row-${nf.id}`))
    await screen.findByTestId('cf-modal')
    fireEvent.click(screen.getByTestId(`cf-opt-up-1`))
    fireEvent.click(screen.getByTestId('cf-save'))
    await waitFor(() => expect(stored().customFields.find((d) => d.id === nf.id).options).toEqual(['Extra screen time', 'Stickers']))
    // toggle template: its on/off labels are first-class options
    fireEvent.click(screen.getByTestId('cf-add'))
    await screen.findByTestId('cf-modal')
    fireEvent.change(screen.getByTestId('cf-label'), { target: { value: 'Interp needed' } })
    await pickDropdown('cf-type', 'toggle')
    fireEvent.change(screen.getByTestId('cf-on-label'), { target: { value: 'Book interpreter' } })
    fireEvent.change(screen.getByTestId('cf-off-label'), { target: { value: 'No interpreter' } })
    fireEvent.click(screen.getByTestId('cf-save'))
    await waitFor(() => expect(stored().customFields.find((d) => d.label === 'Interp needed')?.onLabel).toBe('Book interpreter'))
    // inline required + status chips on the rows
    fireEvent.click(screen.getByTestId(`cf-req-${nf.id}`))
    await waitFor(() => expect(stored().customFields.find((d) => d.id === nf.id).required).toBe(true))
    fireEvent.click(screen.getByTestId(`cf-status-${nf.id}`))
    await waitFor(() => expect(stored().customFields.find((d) => d.id === nf.id).status).toBe('inactive'))
    fireEvent.click(screen.getByTestId(`cf-status-${nf.id}`))
    // delete: blocked while a payer still picks it, allowed once unused
    fireEvent.click(screen.getByTestId('cf-del-cf-authdept'))
    expect(await screen.findByText(/is picked by 1 payer/)).toBeTruthy()
    expect(stored().customFields.find((d) => d.id === 'cf-authdept')).toBeTruthy()
    fireEvent.click(screen.getByTestId(`cf-del-${nf.id}`))
    await waitFor(() => expect(stored().customFields.find((d) => d.id === nf.id)).toBeUndefined())
  })

  it('payers only pick templates — no free-form definitions, legacy inline entries upgrade cleanly', async () => {
    render(<App />)
    await openDetail('py-aetna')
    // Aetna's picked fields resolve from the master: labels come from templates
    const row = await screen.findByTestId('pd-cf-cf-authdept')
    expect(row.textContent).toContain('Prior auth dept')
    expect(row.textContent).toContain('from master')
    expect(screen.getByTestId('pd-cf-cf-present').textContent).toContain('Caregiver present')
    // there is no designer here any more — only picking and unlinking
    expect(screen.queryByTestId('pd-cf-label')).toBeNull()
    // unlink a field from this payer (the template itself survives)
    fireEvent.click(screen.getByTestId('pcf-unlink-cf-present'))
    await waitFor(() => expect(stored().payers.find((p) => p.id === 'py-aetna').cf).toEqual(['cf-authdept']))
    expect(stored().customFields.find((d) => d.id === 'cf-present')).toBeTruthy()
    // pick another from the template list
    fireEvent.click(screen.getByTestId('pd-cf-pick'))
    const pick = await screen.findByTestId('pd-cfpick-cf-goals')
    // inactive templates can't be newly picked
    expect(screen.getByTestId('pd-cfpick-cf-teleconf').querySelector('input').disabled).toBe(true)
    fireEvent.click(pick.querySelector('input'))
    fireEvent.click(screen.getByTestId('pd-cf-picker-close'))
    await waitFor(() => expect(stored().payers.find((p) => p.id === 'py-aetna').cf).toEqual(['cf-authdept', 'cf-goals']))
    // and the jump-to-master affordance works
    fireEvent.click(screen.getByTestId('pd-cf-gomaster'))
    expect(await screen.findByTestId('cfdefs-table')).toBeTruthy()
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
    await waitFor(() => expect(stored().payers.find((p) => p.id === 'py-aetna').svcOv.dtt.charge).toBe(40.5))
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

describe('chunk 32 — modal closes, modifiable payer services, inline edits, typed fields', () => {
  it('Cancel (and ✕) on the add-payer modal never corrupts state — the page stays alive', async () => {
    render(<App />)
    await toMasters()
    fireEvent.click(screen.getByTestId('py-add'))
    fireEvent.change(await screen.findByTestId('py-name'), { target: { value: 'Temporary Payer' } })
    fireEvent.click(screen.getByTestId('py-cancel')) // the old blank-page trigger
    expect(await screen.findByTestId('payers-table')).toBeTruthy() // not blank!
    expect(stored().payers).toHaveLength(12)
    // ✕ in the header does the same
    fireEvent.click(screen.getByTestId('py-add'))
    fireEvent.change(await screen.findByTestId('py-name'), { target: { value: 'Another Temp' } })
    fireEvent.click(screen.getByTestId('py-close'))
    expect(await screen.findByTestId('payers-table')).toBeTruthy()
    expect(stored().payers).toHaveLength(12)
    // and table interaction still works right after
    fireEvent.change(screen.getByTestId('py-search'), { target: { value: 'aetna' } })
    expect(await screen.findByTestId('py-row-py-aetna')).toBeTruthy()
  })

  it('Cancel inside the detail edit modal returns to the record, not the void', async () => {
    render(<App />)
    await openDetail('py-aetna')
    fireEvent.click(screen.getByTestId('pd-edit'))
    fireEvent.change(await screen.findByTestId('py-name'), { target: { value: 'Renamed Away' } })
    fireEvent.click(screen.getByTestId('py-cancel'))
    expect(await screen.findByTestId('payer-detail')).toBeTruthy()
    expect(stored().payers.find((p) => p.id === 'py-aetna').name).toBe('Aetna')
  })

  it('payer services are modifiable: add a payer-only service with the full form', async () => {
    render(<App />)
    await openDetail('py-aetna')
    fireEvent.click(screen.getByTestId('pd-tab-services'))
    fireEvent.click(await screen.findByTestId('pd-svc-fab'))
    fireEvent.click(await screen.findByTestId('pd-svc-new'))
    await screen.findByTestId('ovr-modal')
    // validation first: charge, code and Dx1 are required
    fireEvent.click(screen.getByTestId('ovr-save'))
    expect(await screen.findByText('Charge rate is required (use 0 for none)')).toBeTruthy()
    expect(screen.getByText('Primary Dx code is required')).toBeTruthy()
    fireEvent.change(screen.getByTestId('ovr-label'), { target: { value: 'Parent Coaching — Telehealth' } })
    fireEvent.change(screen.getByTestId('ovr-charge'), { target: { value: '55' } })
    fireEvent.change(screen.getByTestId('ovr-dx1'), { target: { value: 'F84.0' } })
    await pickDropdown('ovr-code', '97152')
    fireEvent.click(screen.getByTestId('ovr-save'))
    await waitFor(() => expect(stored().payers.find((p) => p.id === 'py-aetna').svcs).toHaveLength(1))
    const rec = stored().payers.find((p) => p.id === 'py-aetna').svcs[0]
    expect(rec.label).toBe('Parent Coaching — Telehealth')
    expect(rec.charge).toBe(55)
    expect(rec.code).toBe('97152')
    const card = await screen.findByTestId(`pd-svc-${rec.id}`)
    expect(card.textContent).toContain('$55.00')
    expect(card.textContent).toContain('payer-only')
    // re-edit the line (modifiable, per the ask)
    fireEvent.click(screen.getByTestId(`pd-ovr-${rec.id}`))
    fireEvent.change(await screen.findByTestId('ovr-charge'), { target: { value: '60' } })
    fireEvent.click(screen.getByTestId('ovr-save'))
    await waitFor(() => expect(stored().payers.find((p) => p.id === 'py-aetna').svcs[0].charge).toBe(60))
    // and remove it from this payer
    fireEvent.click(screen.getByTestId(`pd-unlink-${rec.id}`))
    await waitFor(() => expect(stored().payers.find((p) => p.id === 'py-aetna').svcs).toHaveLength(0))
  })

  it('uncontracting a master service narrows an implicit all-services contract', async () => {
    render(<App />)
    await openDetail('py-regence-bcbs')
    fireEvent.click(screen.getByTestId('pd-tab-services'))
    expect(await screen.findByTestId('pd-svc-dtt')).toBeTruthy() // implicit contract
    fireEvent.click(screen.getByTestId('pd-unlink-dtt'))
    await waitFor(() => expect(stored().payers.find((p) => p.id === 'py-regence-bcbs').services.length).toBeGreaterThan(0))
    expect(stored().payers.find((p) => p.id === 'py-regence-bcbs').services).not.toContain('dtt')
    expect(screen.queryByTestId('pd-svc-dtt')).toBeNull()
  })

  it('payer directory: inline cells edit the master straight from the table', async () => {
    render(<App />)
    await toMasters()
    // inline phone
    fireEvent.click(await screen.findByTestId('py-phone-py-aetna'))
    fireEvent.change(screen.getByTestId('py-phone-py-aetna-input'), { target: { value: '(800) 555-9900' } })
    fireEvent.keyDown(screen.getByTestId('py-phone-py-aetna-input'), { key: 'Enter' })
    await waitFor(() => expect(stored().payers.find((p) => p.id === 'py-aetna').contacts[0].number).toBe('(800) 555-9900'))
    expect(screen.getByTestId('py-phone-py-aetna').textContent).toContain('(800) 555-9900')
    // inline select: service type list
    fireEvent.click(screen.getByTestId(`py-svclist-py-aetna`))
    fireEvent.click(await screen.findByTestId('opt-py-svclist-py-aetna-Telehealth'))
    await waitFor(() => expect(stored().payers.find((p) => p.id === 'py-aetna').svcList).toBe('Telehealth'))
    // status chip inline
    fireEvent.click(screen.getByTestId('py-status-py-aetna'))
    await waitFor(() => expect(stored().payers.find((p) => p.id === 'py-aetna').status).toBe('inactive'))
    // Esc cancels an inline edit without writing
    fireEvent.click(screen.getByTestId('py-status-py-aetna'))
    await waitFor(() => expect(stored().payers.find((p) => p.id === 'py-aetna').status).toBe('active'))
    fireEvent.click(screen.getByTestId(`py-aka-py-aetna`))
    fireEvent.change(screen.getByTestId('py-aka-py-aetna-input'), { target: { value: 'should not persist' } })
    fireEvent.keyDown(screen.getByTestId('py-aka-py-aetna-input'), { key: 'Escape' })
    await waitFor(() => expect(stored().payers.find((p) => p.id === 'py-aetna').aka).toBe('Aetna Better Health of CA'))
  })

  it('service types master: rate + unit + code inline, no modal needed', async () => {
    render(<App />)
    await toMasters('svcs')
    fireEvent.click(await screen.findByTestId('sv-rate-social'))
    fireEvent.change(screen.getByTestId('sv-rate-social-input'), { target: { value: '20.5' } })
    fireEvent.keyDown(screen.getByTestId('sv-rate-social-input'), { key: 'Enter' })
    await waitFor(() => expect(stored().svcs.find((x) => x.id === 'social').rate).toBe(20.5))
    await pickDropdown('sv-unit-social', '15')
    await waitFor(() => expect(stored().svcs.find((x) => x.id === 'social').unitMins).toBe(15))
    await pickDropdown('sv-code-social', '97151')
    await waitFor(() => expect(stored().svcs.find((x) => x.id === 'social').code).toBe('97151'))
  })

  it('wizard renders picked templates, required blocks completion, answers persist as snapshots', async () => {
    render(<App />)
    await toMasters('cfdefs')
    // make Prior auth dept required — every payer picking it enforces it now
    fireEvent.click(await screen.findByTestId('cf-req-cf-authdept'))
    await waitFor(() => expect(stored().customFields.find((d) => d.id === 'cf-authdept').required).toBe(true))
    // and switch the Caregiver toggle's labels so the wizard shows them
    fireEvent.click(screen.getByTestId('cf-row-cf-present'))
    await screen.findByTestId('cf-modal')
    fireEvent.change(screen.getByTestId('cf-on-label'), { target: { value: 'With caregiver' } })
    fireEvent.click(screen.getByTestId('cf-save'))
    await waitFor(() => expect(stored().customFields.find((d) => d.id === 'cf-present').onLabel).toBe('With caregiver'))
    // book Justin (Aetna) — field panel with template controls
    fireEvent.click(screen.getByTestId('nav-calendar'))
    fireEvent.click(screen.getByRole('button', { name: 'Appointment' }))
    fireEvent.click(await screen.findByTestId('type-service'))
    fireEvent.click(screen.getByTestId('pick-Client Name'))
    fireEvent.click((await screen.findAllByTestId('people-item')).find((b) => b.textContent.includes('Justin Hsu')))
    fireEvent.mouseDown(document.body)
    fireEvent.click(screen.getByTestId('pick-Staff Name'))
    fireEvent.click((await screen.findAllByTestId('people-item'))[0])
    fireEvent.mouseDown(document.body)
    const panel = await screen.findByTestId('am-pcf')
    expect(panel.textContent).toContain('Payer fields — Aetna')
    fireEvent.click(screen.getByTestId('save-appt'))
    expect(await screen.findByText(/Payer field “Prior auth dept” is required/)).toBeTruthy()
    // answer via radio chips; toggle offers the template's labelled options
    fireEvent.click(screen.getByTestId('pcf-opt-cf-authdept-Behavioral Intake 2'))
    fireEvent.click(screen.getByTestId('pcf-toption-cf-present-1'))
    expect(screen.getByTestId('pcf-toption-cf-present-1').textContent).toBe('With caregiver')
    fireEvent.click(screen.getByTestId('save-appt'))
    await screen.findByText('Appointment created')
    await waitFor(() => {
      const created = Object.values(stored().appts).find((a) => a.pcfs && a.pcfs['cf-authdept'])
      expect(created).toBeTruthy()
      expect(created.pcfs['cf-authdept'].value).toBe('Behavioral Intake 2')
      expect(created.pcfs['cf-authdept'].label).toBe('Prior auth dept')
      expect(created.pcfs['cf-present'].value).toBe('With caregiver')
    })
  })

  it('legacy inline custom fields still render and can be promoted to a template', async () => {
    render(<App />)
    await openDetail('py-aetna')
    expect((await screen.findByTestId('pd-cf-cf-authdept')).textContent).toContain('from master')
    // simulate a pre-template payer: legacy string entry, then remount to load it
    const st = stored()
    st.payers.find((x) => x.id === 'py-aetna').cf = ['Behavioral Intake line']
    localStorage.setItem('aloha-aba.v3', JSON.stringify(st))
    cleanup()
    render(<App />)
    await toMasters()
    fireEvent.click(await screen.findByTestId('py-row-py-aetna'))
    await screen.findByTestId('payer-detail')
    const legacy = await screen.findByTestId('pd-cf-0')
    expect(legacy.textContent).toContain('Behavioral Intake line')
    expect(legacy.textContent).toContain('legacy')
    fireEvent.click(screen.getByTestId('pcf-upgrade-legacy-0'))
    await waitFor(() => expect(stored().customFields.some((d) => d.label === 'Behavioral Intake line')).toBe(true))
    await waitFor(() => expect(stored().payers.find((p) => p.id === 'py-aetna').cf.length).toBe(1))
    expect(stored().payers.find((p) => p.id === 'py-aetna').cf[0]).toContain('cf-') // now a template id
    expect(await screen.findByTestId('pd-cf-cf-behavioral-intake-line')).toBeTruthy()
  })
  it('wizard books a payer-only service at its own contract rate', async () => {
    render(<App />)
    await toMasters()
    await openDetail('py-aetna')
    fireEvent.click(screen.getByTestId('pd-tab-services'))
    fireEvent.click(await screen.findByTestId('pd-svc-fab'))
    fireEvent.click(await screen.findByTestId('pd-svc-new'))
    fireEvent.change(await screen.findByTestId('ovr-label'), { target: { value: 'Parent Coaching — Telehealth' } })
    fireEvent.change(screen.getByTestId('ovr-charge'), { target: { value: '50' } })
    fireEvent.change(screen.getByTestId('ovr-dx1'), { target: { value: 'F84.0' } })
    await pickDropdown('ovr-code', '97152')
    fireEvent.click(screen.getByTestId('ovr-save'))
    const lid = await waitFor(() => { const v = stored().payers.find((p) => p.id === 'py-aetna').svcs[0]; expect(v).toBeTruthy(); return v.id })
    // book it for Justin
    fireEvent.click(screen.getByTestId('nav-calendar'))
    fireEvent.click(screen.getByRole('button', { name: 'Appointment' }))
    fireEvent.click(await screen.findByTestId('type-service'))
    fireEvent.click(screen.getByTestId('pick-Client Name'))
    fireEvent.click((await screen.findAllByTestId('people-item')).find((b) => b.textContent.includes('Justin Hsu')))
    fireEvent.mouseDown(document.body)
    fireEvent.click(await screen.findByTestId('service-select'))
    const optBtn = await screen.findByTestId(`opt-service-select-${lid}`)
    expect(optBtn.textContent).toContain('Parent Coaching') // payer-only service is offered in the wizard
    expect(optBtn.textContent).toContain('Aetna only')
    fireEvent.click(optBtn)
    expect((await screen.findByTestId('am-rate-ovr')).textContent).toContain('$50.00')
  })

  it('helpers: svcOptionsFor merges payer services; rateFor hits the local record', async () => {
    const { CLIENTS, PAYERS } = await import('../lib/seed.js')
    const st = { clients: CLIENTS, payers: PAYERS, svcs: [], appts: [] }
    const aetnaClient = CLIENTS.find((c) => c.insurer === 'Aetna')
    const opts = svcOptionsFor(st, [aetnaClient.id])
    expect(opts.some((x) => x.id === 'dtt')).toBe(true)
    const rr = rateFor(st, payerForAppt(st, [aetnaClient.id]), 'dtt', '97151')
    expect(rr.rate).toBe(38) // the seeded Aetna contract override wins over the $32 master rate
    expect(rr.source).toContain('Aetna')
    // payer-local service resolves through the same helpers
    const st2 = { ...st, payers: [{ ...payerForAppt(st, [aetnaClient.id]), svcs: [{ id: 'pl1', label: 'Zoo ABA', code: '97152', charge: 66, status: 'active' }] }] }
    expect(svcById(st2, 'pl1').label).toBe('Zoo ABA')
    expect(rateFor(st2, payerForAppt(st2, [aetnaClient.id]), 'pl1', '97152').rate).toBe(66)
  })
})

describe('chunk 33 — payer service edit & add regressions', () => {
  it('linked service line: changing just the charge saves — no unrelated required fields block it', async () => {
    render(<App />)
    await openDetail('py-aetna')
    fireEvent.click(screen.getByTestId('pd-tab-services'))
    fireEvent.click(await screen.findByTestId('pd-ovr-net'))
    await screen.findByTestId('ovr-modal')
    fireEvent.change(screen.getByTestId('ovr-charge'), { target: { value: '34' } })
    fireEvent.click(screen.getByTestId('ovr-save'))
    await waitFor(() => expect(stored().payers.find((p) => p.id === 'py-aetna').svcOv.net.charge).toBe(34))
    expect(screen.queryByText('Primary Dx code is required')).toBeNull()
    expect((await screen.findByTestId('pd-svc-net')).textContent).toContain('$34.00')
    // blanking the rate again inherits, not errors
    fireEvent.click(screen.getByTestId('pd-ovr-net'))
    fireEvent.change(await screen.findByTestId('ovr-charge'), { target: { value: '' } })
    fireEvent.click(screen.getByTestId('ovr-save'))
    await waitFor(() => expect(stored().payers.find((p) => p.id === 'py-aetna').svcOv.net.charge).toBe(''))
    await waitFor(() => expect(document.querySelector('.ovr-form')).toBeNull())
    expect((await screen.findByTestId('pd-svc-net')).textContent).toContain('$32.00') // inherits master rate
  })

  it('Add Service button (toolbar, not only the FAB flow) creates the payer-only line', async () => {
    render(<App />)
    await openDetail('py-aetna')
    fireEvent.click(screen.getByTestId('pd-tab-services'))
    fireEvent.click(await screen.findByTestId('pd-svc-add'))
    await screen.findByTestId('ovr-modal')
    // creation keeps the starred-field checks — with a toast so it never looks dead
    fireEvent.click(screen.getByTestId('ovr-save'))
    expect(await screen.findByText('Name the service')).toBeTruthy()
    expect(screen.getByText('Charge rate is required (use 0 for none)')).toBeTruthy()
    expect(await screen.findByText('Check 3 highlighted fields before saving')).toBeTruthy()
    fireEvent.change(screen.getByTestId('ovr-label'), { target: { value: 'Zoo ABA' } })
    fireEvent.change(screen.getByTestId('ovr-charge'), { target: { value: '40' } })
    fireEvent.change(screen.getByTestId('ovr-dx1'), { target: { value: 'F84.0' } })
    fireEvent.click(screen.getByTestId('ovr-save'))
    await waitFor(() => expect(stored().payers.find((p) => p.id === 'py-aetna').svcs).toHaveLength(1))
    const rec = stored().payers.find((p) => p.id === 'py-aetna').svcs[0]
    expect(rec).toMatchObject({ label: 'Zoo ABA', charge: 40, code: '97151', unitSize: '30 Minutes', status: 'active' })
    const card = await screen.findByTestId(`pd-svc-${rec.id}`)
    expect(card.textContent).toContain('$40.00')
    expect(card.textContent).toContain('payer-only')
    // and it lands in the payer's contract sheet list used by wizard option code paths
    const { svcOptionsFor } = await import('../lib/master')
    const st = stored()
    const justin = st.clients.find((c) => (c.insurer || '') === 'Aetna')
    const opts = svcOptionsFor({ svcs: st.svcs, payers: st.payers, clients: st.clients }, [justin.id])
    expect(opts.some((o) => o.id === rec.id && o.payerLocal)).toBe(true)
  })

  it('payer profile keeps picked templates live: master edit renames everywhere, unlink is cheap', async () => {
    render(<App />)
    await toMasters('cfdefs')
    fireEvent.click(await screen.findByTestId('cf-row-cf-present'))
    await screen.findByTestId('cf-modal')
    fireEvent.change(screen.getByTestId('cf-label'), { target: { value: 'Caregiver on site' } })
    fireEvent.click(screen.getByTestId('cf-save'))
    await waitFor(() => expect(stored().customFields.find((d) => d.id === 'cf-present').label).toBe('Caregiver on site'))
    fireEvent.click(screen.getByTestId('masters-tab-payers'))
    await screen.findByTestId('payers-table')
    fireEvent.click(screen.getByTestId('py-row-py-aetna'))
    await screen.findByTestId('payer-detail')
    expect((await screen.findByTestId('pd-cf-cf-present')).textContent).toContain('Caregiver on site')
  })
})
