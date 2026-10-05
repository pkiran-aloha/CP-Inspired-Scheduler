import React from 'react'
import { beforeEach, afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import App from '../App'
import { blankState, StoreProvider, useStore } from '../state/store'
import { expiryState, cabinetAlerts, planCabinetDoc, planCabinetArchive } from '../lib/cabinet'
import { createWorkspaceBackup, readWorkspaceBackup } from '../lib/workspaceBackup'
import { addDays, isoDate, parseISO, todayISO } from '../lib/date'

const KEY = 'aloha-aba.v3'
const saved = () => JSON.parse(localStorage.getItem(KEY))
beforeEach(() => localStorage.clear())
afterEach(() => cleanup())

const BASE = { ...blankState(), cabinet: {} } // the demo seed's documents would muddy the counts
const today = todayISO()
const day = (n) => isoDate(addDays(parseISO(today), n))
const SID = BASE.staff[0].id
const doc = (o = {}) => ({ title: 'RBT certification', category: 'Credential / certification', ownerKind: 'staff', ownerId: SID, issuedOn: day(-300), expiresOn: day(10), ...o })

describe('cabinet — engine', () => {
  it('reads expiry as expired, due within 30 days, current or none', () => {
    expect(expiryState({ expiresOn: day(-1) }, today)).toBe('expired')
    expect(expiryState({ expiresOn: day(30) }, today)).toBe('due')
    expect(expiryState({ expiresOn: day(31) }, today)).toBe('ok')
    expect(expiryState({ expiresOn: '' }, today)).toBe('none')
  })

  it('validates a document and keeps a history of expiry changes', () => {
    const p = planCabinetDoc(BASE, doc(), { id: 'd1' })
    expect(p.ok).toBe(true)
    for (const bad of [{ title: 'ab' }, { category: 'x' }, { ownerKind: 'x' }, { ownerId: 'nope' }, { expiresOn: '' }, { expiresOn: day(-400) }]) {
      expect(planCabinetDoc(BASE, doc(bad), { id: 'd2' }).ok).toBe(false)
    }
    expect(planCabinetDoc(BASE, doc({ ownerKind: 'practice', noExpiry: true, expiresOn: '' }), { id: 'd3' }).ok).toBe(true)
    const st = { ...BASE, cabinet: { d1: p.item } }
    const edited = planCabinetDoc(st, { ...p.item, expiresOn: day(400) }, { id: 'other' }).item
    expect(edited.id).toBe('d1')
    expect(edited.history.at(-1).ev).toMatch(new RegExp(`expiry ${day(10)} → ${day(400)}`))
  })

  it('alerts on expired and due documents until they are archived', () => {
    const d1 = planCabinetDoc(BASE, doc({ expiresOn: day(-2) }), { id: 'd1' }).item
    const d2 = planCabinetDoc(BASE, doc({ expiresOn: day(200) }), { id: 'd2' }).item
    const st = { ...BASE, cabinet: { d1, d2 } }
    expect(cabinetAlerts(st, today).map((d) => d.id)).toEqual(['d1'])
    const archived = planCabinetArchive(st, 'd1').item
    expect(cabinetAlerts({ ...st, cabinet: { d1: archived, d2 } }, today)).toEqual([])
    expect(planCabinetArchive({ ...st, cabinet: { d1: archived } }, 'd1').ok).toBe(false)
  })

  it('travels in workspace backups; an older backup without a cabinet imports with none', () => {
    const d1 = planCabinetDoc(BASE, doc(), { id: 'd1' }).item
    expect(readWorkspaceBackup(createWorkspaceBackup({ ...BASE, cabinet: { d1 } }), blankState()).data.cabinet.d1.title).toBe('RBT certification')
    const older = JSON.parse(createWorkspaceBackup(BASE))
    delete older.data.cabinet
    expect(readWorkspaceBackup(JSON.stringify(older), blankState()).data.cabinet).toEqual({})
  })
})

function Probe() {
  const { actions } = useStore()
  return <>
    <button onClick={() => actions.saveCabinetDoc(doc())}>Add doc</button>
    <button onClick={() => actions.undo()}>Undo once</button>
  </>
}

describe('cabinet — store and screen', () => {
  it('adding is one action and one Undo', async () => {
    localStorage.setItem(KEY, JSON.stringify(BASE))
    render(<StoreProvider><Probe /></StoreProvider>)
    fireEvent.click(screen.getByText('Add doc'))
    await waitFor(() => expect(Object.keys(saved().cabinet)).toHaveLength(1))
    fireEvent.click(screen.getByText('Undo once'))
    await waitFor(() => expect(saved().cabinet).toEqual({}))
  })

  it('Staff → Cabinet adds an expired document, raises the alert and badge, and archives it', async () => {
    localStorage.setItem(KEY, JSON.stringify(BASE))
    render(<App />)
    fireEvent.click(screen.getByTestId('nav-staff'))
    fireEvent.click(await screen.findByTestId('nav-sub-cabinet'))
    expect((await screen.findByTestId('cab-alerts')).textContent).toMatch(/Nothing expired/)
    fireEvent.click(screen.getByTestId('cab-add'))
    fireEvent.change(screen.getByTestId('cab-f-title'), { target: { value: 'CPR card' } })
    fireEvent.change(screen.getByTestId('cab-f-category'), { target: { value: 'CPR / first aid' } })
    fireEvent.change(screen.getByTestId('cab-f-expires'), { target: { value: day(-3) } })
    fireEvent.click(screen.getByTestId('cab-f-save'))
    await waitFor(() => expect(Object.values(saved().cabinet)).toHaveLength(1))
    const d = Object.values(saved().cabinet)[0]
    expect(d).toMatchObject({ title: 'CPR card', category: 'CPR / first aid', ownerKind: 'staff', expiresOn: day(-3) })
    expect(screen.getByTestId('cab-alerts').textContent).toMatch(/1 expired/)
    expect(screen.getByTestId(`cab-state-${d.id}`).textContent).toMatch(/Expired/)
    expect(screen.getByTestId('nav-badge-staff').textContent).toBe('1')
    fireEvent.click(screen.getByTestId(`cab-archive-${d.id}`))
    await waitFor(() => expect(saved().cabinet[d.id].archived).toBe(true))
    expect(screen.queryByTestId('nav-badge-staff')).toBe(null)
  })
})
