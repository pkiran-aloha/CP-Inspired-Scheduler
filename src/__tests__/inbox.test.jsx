import React from 'react'
import { beforeEach, afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import App from '../App'
import { blankState, StoreProvider, useStore } from '../state/store'
import { linkLabel, notificationsFor, openTasksFor, planTask, planTaskDone, taskState } from '../lib/tasks'
import { currentAccount } from '../lib/security'
import { createWorkspaceBackup, readWorkspaceBackup } from '../lib/workspaceBackup'
import { addDays, isoDate, parseISO, todayISO } from '../lib/date'

const KEY = 'aloha-aba.v3'
const saved = () => JSON.parse(localStorage.getItem(KEY))
beforeEach(() => localStorage.clear())
afterEach(() => cleanup())

const BASE = blankState()
const today = todayISO()
const day = (n) => isoDate(addDays(parseISO(today), n))
const ME = currentAccount(BASE)?.staffId || BASE.staff[0].id
const task = (o = {}) => ({ title: 'Call the family about the renewal', assigneeId: ME, dueOn: day(-1), link: { kind: 'client', id: BASE.clients[0].id }, ...o })

describe('inbox — tasks and notifications', () => {
  it('plans tasks, refuses bad ones, and orders open tasks overdue first', () => {
    const t1 = planTask(BASE, task(), { id: 't1' }).item
    const t2 = planTask(BASE, task({ dueOn: day(3), title: 'Send the intake packet' }), { id: 't2' }).item
    expect([taskState(t1, today), taskState(t2, today)]).toEqual(['overdue', 'upcoming'])
    for (const bad of [{ title: 'ab' }, { assigneeId: 'nope' }, { dueOn: 'soon' }, { link: { kind: 'client', id: 'nope' } }]) {
      expect(planTask(BASE, task(bad), { id: 'x' }).ok).toBe(false)
    }
    const st = { ...BASE, tasks: { t2, t1 } }
    expect(openTasksFor(st, ME, today).map((t) => t.id)).toEqual(['t1', 't2'])
    const done = planTaskDone(st, 't1').item
    expect(openTasksFor({ ...st, tasks: { t1: done, t2 } }, ME, today).map((t) => t.id)).toEqual(['t2'])
  })

  it('a role without Clients cannot link a task to a client or see the linked name', () => {
    const noClients = (area) => area !== 'clients'
    expect(planTask(BASE, task(), { id: 'x', can: noClients }).ok).toBe(false)
    const t1 = planTask(BASE, task(), { id: 't1' }).item
    expect(linkLabel(BASE, t1.link)).toBe(BASE.clients[0].name)
    expect(linkLabel(BASE, t1.link, noClients)).toBe('')
  })

  it('notifications are read from the workspace and respect what the role can open', () => {
    const st = { ...BASE, tasks: { t1: planTask(BASE, task(), { id: 't1' }).item } }
    const feed = notificationsFor(st, ME, today)
    expect(feed.find((n) => n.id === 'tasks-overdue').text).toMatch(/1 of your tasks is overdue/)
    expect(notificationsFor(st, ME, today, (area) => area !== 'billing').some((n) => n.id === 'denied')).toBe(false)
  })

  it('tasks travel in workspace backups; an older backup without them imports with none', () => {
    const t1 = planTask(BASE, task(), { id: 't1' }).item
    expect(readWorkspaceBackup(createWorkspaceBackup({ ...BASE, tasks: { t1 } }), blankState()).data.tasks.t1.title).toBe(t1.title)
    const older = JSON.parse(createWorkspaceBackup(BASE))
    delete older.data.tasks
    expect(readWorkspaceBackup(JSON.stringify(older), blankState()).data.tasks).toEqual({})
  })
})

function Probe() {
  const { actions } = useStore()
  return <>
    <button onClick={() => actions.saveTask(task())}>Add task</button>
    <button onClick={() => actions.undo()}>Undo once</button>
  </>
}

describe('inbox — store and screen', () => {
  it('adding a task is one action and one Undo', async () => {
    localStorage.setItem(KEY, JSON.stringify(BASE))
    render(<StoreProvider><Probe /></StoreProvider>)
    fireEvent.click(screen.getByText('Add task'))
    await waitFor(() => expect(Object.keys(saved().tasks)).toHaveLength(1))
    fireEvent.click(screen.getByText('Undo once'))
    await waitFor(() => expect(saved().tasks).toEqual({}))
  })

  it('the top-bar inbox adds a task for me, shows it overdue, and marks it done', async () => {
    localStorage.setItem(KEY, JSON.stringify(BASE))
    render(<App />)
    fireEvent.click(await screen.findByTestId('inbox-open'))
    const panel = await screen.findByTestId('inbox-panel')
    fireEvent.click(within(panel).getByTestId('inbox-tab-tasks'))
    fireEvent.click(within(panel).getByTestId('task-new'))
    fireEvent.change(within(panel).getByTestId('task-f-title'), { target: { value: 'Chase the signed consent' } })
    fireEvent.change(within(panel).getByTestId('task-f-due'), { target: { value: day(-2) } })
    fireEvent.click(within(panel).getByTestId('task-f-save'))
    await waitFor(() => expect(Object.values(saved().tasks)).toHaveLength(1))
    const t = Object.values(saved().tasks)[0]
    expect(t).toMatchObject({ title: 'Chase the signed consent', assigneeId: ME, dueOn: day(-2), status: 'open' })
    expect(within(panel).getByTestId(`task-state-${t.id}`).textContent).toMatch(/Overdue/)
    // "my tasks" notifications need the signed-in account to be linked to a staff member
    if (currentAccount(BASE)?.staffId) {
      fireEvent.click(within(panel).getByTestId('inbox-tab-notifications'))
      expect(within(panel).getByTestId('inbox-n-tasks-overdue')).toBeTruthy()
      fireEvent.click(within(panel).getByTestId('inbox-tab-tasks'))
    }
    fireEvent.click(within(panel).getByTestId(`task-done-${t.id}`))
    await waitFor(() => expect(saved().tasks[t.id].status).toBe('done'))
  })
})
