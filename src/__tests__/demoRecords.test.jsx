import React from 'react'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import App from '../App'
import { blankState, reducer } from '../state/store'
import { cabinetAlerts } from '../lib/cabinet'
import { credentialRow } from '../lib/credentials'
import { openTasksFor, taskState } from '../lib/tasks'
import { unreadCount } from '../lib/messages'
import { createWorkspaceBackup, readWorkspaceBackup } from '../lib/workspaceBackup'
import { todayISO } from '../lib/date'

const KEY = 'aloha-aba.v3'
beforeEach(() => localStorage.clear())
afterEach(() => cleanup())

const BASE = blankState()
const today = todayISO()

describe('demo records in a fresh workspace', () => {
  it('seeds Cabinet documents, a CEU log, tasks and messages that drive the alerts', () => {
    expect(Object.keys(BASE.cabinet)).toHaveLength(8)
    expect(Object.keys(BASE.pdus)).toHaveLength(8)
    expect(Object.keys(BASE.tasks)).toHaveLength(5)
    expect(Object.keys(BASE.messages)).toHaveLength(3)
    // one expired RBT certificate, one BCBA renewal and one CPR card inside 30 days
    expect(cabinetAlerts(BASE, today)).toHaveLength(3)
    expect(credentialRow(BASE, BASE.staff.find((s) => s.id === 's1'), today)).toMatchObject({ logged: 12, remaining: 20 })
    expect(openTasksFor(BASE, 's12', today).map((t) => taskState(t, today))).toEqual(['overdue', 'today'])
    expect(unreadCount(BASE, 'account-demo-admin')).toBe(2)
  })

  it('round-trips through a backup, and Demo data reset seeds them again', () => {
    const back = readWorkspaceBackup(createWorkspaceBackup(BASE), blankState()).data
    expect(back.tasks).toEqual(BASE.tasks)
    expect(back.cabinet).toEqual(BASE.cabinet)
    const reseeded = reducer({ ...BASE, cabinet: {}, pdus: {}, tasks: {}, messages: {} }, { type: 'reseed' })
    expect(Object.keys(reseeded.cabinet)).toHaveLength(8)
    expect(Object.keys(reseeded.messages)).toHaveLength(3)
  })

  it('the Staff badge counts the demo documents that need attention', async () => {
    localStorage.setItem(KEY, JSON.stringify(BASE))
    render(<App />)
    fireEvent.click(await screen.findByTestId('nav-staff'))
    expect((await screen.findByTestId('nav-badge-staff')).textContent).toBe('3')
    fireEvent.click(await screen.findByTestId('nav-sub-cabinet'))
    expect((await screen.findByTestId('cab-alerts')).textContent).toMatch(/1 expired/)
  })
})
