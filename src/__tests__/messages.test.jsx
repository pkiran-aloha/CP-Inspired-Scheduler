import React from 'react'
import { beforeEach, afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import App from '../App'
import { blankState } from '../state/store'
import { planMessage, readUpdates, threadsFor, unreadCount } from '../lib/messages'
import { createWorkspaceBackup, readWorkspaceBackup } from '../lib/workspaceBackup'

const KEY = 'aloha-aba.v3'
const saved = () => JSON.parse(localStorage.getItem(KEY))
beforeEach(() => localStorage.clear())
afterEach(() => cleanup())

const BASE = blankState()
const ACTIVE = BASE.security.accounts.filter((a) => a.status === 'active')
const ME = BASE.security.currentUserId
const OTHER = ACTIVE.find((a) => a.id !== ME).id
const send = (st, input, id, from) => {
  const p = planMessage(st, input, { id, from })
  expect(p.ok).toBe(true)
  return { ...st, messages: { ...st.messages, [id]: p.item } }
}

describe('messages — engine', () => {
  it('a message reaches its recipient unread; a reply goes back to the thread', () => {
    let st = send({ ...BASE, messages: {} }, { toIds: [OTHER], subject: 'Coverage Friday', body: 'Can you take the 3pm?' }, 'm1', ME)
    expect(unreadCount(st, OTHER)).toBe(1)
    expect(unreadCount(st, ME)).toBe(0)
    st = send(st, { threadId: 'm1', body: 'Yes, I can.' }, 'm2', OTHER)
    expect(st.messages.m2).toMatchObject({ threadId: 'm1', toIds: [ME], subject: 'Coverage Friday' })
    expect(threadsFor(st, ME)[0].messages.map((m) => m.id)).toEqual(['m1', 'm2'])
    expect(readUpdates(st, 'm1', ME).map((m) => m.id)).toEqual(['m2'])
  })

  it('refuses empty, unaddressed and outsider messages', () => {
    const st = send({ ...BASE, messages: {} }, { toIds: [OTHER], subject: 'Hello', body: 'Hi' }, 'm1', ME)
    expect(planMessage(st, { toIds: [], subject: 'x', body: 'y' }, { id: 'a', from: ME }).ok).toBe(false)
    expect(planMessage(st, { toIds: [OTHER], subject: 'x', body: '' }, { id: 'b', from: ME }).ok).toBe(false)
    const outsider = ACTIVE.find((a) => a.id !== ME && a.id !== OTHER)
    if (outsider) {
      expect(planMessage(st, { threadId: 'm1', body: 'hi' }, { id: 'c', from: outsider.id }).ok).toBe(false)
      expect(threadsFor(st, outsider.id)).toEqual([])
    }
  })

  it('messages travel in workspace backups; an older backup without them imports with none', () => {
    const st = send({ ...BASE, messages: {} }, { toIds: [OTHER], subject: 'Hello', body: 'Hi' }, 'm1', ME)
    expect(readWorkspaceBackup(createWorkspaceBackup(st), blankState()).data.messages.m1.body).toBe('Hi')
    const older = JSON.parse(createWorkspaceBackup(BASE))
    delete older.data.messages
    expect(readWorkspaceBackup(JSON.stringify(older), blankState()).data.messages).toEqual({})
  })
})

describe('messages — inbox screen', () => {
  it('opens a thread (marking the reply read) and replies', async () => {
    const withReply = send(send({ ...BASE, messages: {} }, { toIds: [OTHER], subject: 'Coverage Friday', body: 'Can you take the 3pm?' }, 'm1', ME), { threadId: 'm1', body: 'Yes, I can.' }, 'm2', OTHER)
    localStorage.setItem(KEY, JSON.stringify(withReply))
    render(<App />)
    fireEvent.click(screen.getByTestId('nav-calendar')) // the app lands on the Dashboard
    fireEvent.click(await screen.findByTestId('inbox-open'))
    const panel = await screen.findByTestId('inbox-panel')
    fireEvent.click(within(panel).getByTestId('inbox-tab-messages'))
    expect(within(panel).getByTestId('msg-unread-m1').textContent).toMatch(/1 new/)
    fireEvent.click(within(panel).getByTestId('msg-thread-m1'))
    await waitFor(() => expect(saved().messages.m2.readBy).toContain(ME))
    fireEvent.change(within(panel).getByTestId('msg-reply'), { target: { value: 'Thanks!' } })
    fireEvent.click(within(panel).getByTestId('msg-reply-send'))
    await waitFor(() => expect(Object.values(saved().messages)).toHaveLength(3))
    expect(Object.values(saved().messages).find((m) => m.body === 'Thanks!')).toMatchObject({ threadId: 'm1', fromId: ME, toIds: [OTHER] })
  })
})
