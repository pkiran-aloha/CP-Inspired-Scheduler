import React, { useState } from 'react'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react'
import App from '../App'
import { addDays, isoDate, parseISO, todayISO } from '../lib/date'
import { blankState, StoreProvider, useStore } from '../state/store'
import { ToastProvider } from '../ui/Toast'

beforeEach(() => localStorage.clear())
afterEach(() => cleanup())

const KEY = 'aloha-aba.v3'
const stored = () => JSON.parse(localStorage.getItem(KEY) || '{}').appts || {}
const plus = (iso, n) => isoDate(addDays(parseISO(iso), n))
const nextMonday = (iso) => plus(iso, (8 - parseISO(iso).getDay()) % 7 || 7)
const START = nextMonday(plus(todayISO(), 70))
const BASE = blankState()
const S = BASE.staff[0].id
const RULE = { freq: 'weekly', interval: 1, byDay: [1], end: { type: 'count', count: 4 }, dtstart: START }

function seedSeries(patch = {}) {
  const appts = { ...BASE.appts }
  for (let i = 0; i < 4; i++) {
    appts[`rp${i}`] = {
      id: `rp${i}`, type: 'break', title: 'Recurrence probe', date: plus(START, i * 7), start: 540, end: 600, staffIds: [S], clientIds: [], status: 'active',
      seriesId: 'SER-UI', rrule: RULE, recurrence: 'weekly', notes: '', custom: {}, documents: [], verification: null, ...(patch[`rp${i}`] || {}),
    }
  }
  localStorage.setItem(KEY, JSON.stringify({ ...BASE, appts, ui: { ...BASE.ui, anchor: START, view: 'week' } }))
}

async function pickDropdown(testid, value) {
  fireEvent.click(await screen.findByTestId(testid))
  fireEvent.click(await screen.findByTestId(`opt-${testid}-${value}`))
}

function openProbe(container) {
  const chip = [...container.querySelectorAll('.chip')].find((c) => c.textContent.includes('Recurrence probe'))
  fireEvent.pointerDown(chip, { button: 0 })
  fireEvent.pointerUp(chip)
  return screen.getByTestId('detail-card')
}

describe('recurrence editor in the booking dialog', () => {
  it('books a custom Mon + Wed series with an occurrence count and stores its rule', async () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Appointment' }))
    fireEvent.click(await screen.findByTestId('type-service'))
    fireEvent.click(screen.getByTestId('pick-Staff Name'))
    fireEvent.click((await screen.findAllByTestId('people-item'))[0])
    fireEvent.mouseDown(document.body)
    fireEvent.click(screen.getByTestId('pick-Client Name'))
    fireEvent.click((await screen.findAllByTestId('people-item'))[0])
    fireEvent.mouseDown(document.body)
    fireEvent.change(screen.getByTestId('appt-date'), { target: { value: START } })
    await pickDropdown('repeat-select', 'weekly')
    fireEvent.click(screen.getByTestId('rec-day-3'))
    fireEvent.change(screen.getByTestId('repeat-count'), { target: { value: '4' } })
    expect(screen.getByTestId('repeat-summary').textContent).toMatch(/Weekly on Mon, Wed, 4 times · 4 occurrences/)
    fireEvent.click(screen.getByTestId('save-appt'))
    expect(await screen.findByText(/^Created 4 occurrences/)).toBeTruthy()
    await waitFor(() => {
      const made = Object.values(stored()).filter((a) => a.rrule?.byDay?.join() === '1,3' && a.date >= START)
      expect(made.map((a) => a.date).sort()).toEqual([START, plus(START, 2), plus(START, 7), plus(START, 9)])
      expect(new Set(made.map((a) => a.seriesId)).size).toBe(1)
      expect(made.every((a) => a.rrule.dtstart === START && a.recurrence === 'weekly')).toBe(true)
    })
  })

  it('changing the rule of a series disables “this occurrence” and rebuilds as one Undo', async () => {
    seedSeries()
    const { container } = render(<App />)
    fireEvent.click(within(openProbe(container)).getByRole('button', { name: /Edit/ }))
    expect(screen.getByTestId('repeat-summary').textContent).toMatch(/Weekly on Mon, 4 times/)
    fireEvent.change(screen.getByTestId('rec-interval'), { target: { value: '2' } })
    expect(screen.getByTestId('scope-one').disabled).toBe(true)
    expect(screen.getByTestId('scope-note').textContent).toMatch(/rebuilt from the repeat rule/)
    fireEvent.click(screen.getByTestId('save-appt'))
    expect(await screen.findByText(/^Series rebuilt — Every 2 weeks on Mon, 4 times/)).toBeTruthy()
    await waitFor(() => {
      const mine = Object.values(stored()).filter((a) => a.seriesId === 'SER-UI')
      expect(mine.map((a) => a.date).sort()).toEqual([0, 14, 28, 42].map((n) => plus(START, n)))
      expect(mine.every((a) => a.rrule.interval === 2)).toBe(true)
    })
  })
})

describe('series delete and cancel from the detail card', () => {
  it('delete all keeps a completed session, names it, and Undo brings the series back', async () => {
    seedSeries({ rp2: { status: 'completed' } })
    const { container } = render(<App />)
    const card = openProbe(container)
    expect(within(card).getByTestId('dc-series-rule').textContent).toMatch(/Weekly on Mon, 4 times · 4 occurrences/)
    fireEvent.click(within(card).getByRole('button', { name: /Delete/ }))
    fireEvent.click(screen.getByTestId('dc-del-all'))
    expect(await screen.findByText('Deleted 3 occurrences · 1 kept as it is (1 completed)')).toBeTruthy()
    await waitFor(() => expect(Object.keys(stored()).filter((k) => k.startsWith('rp'))).toEqual(['rp2']))
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(Object.keys(stored()).filter((k) => k.startsWith('rp')).length).toBe(4))
  })

  it('cancel this & following asks for a reason, then a scope, and stores both', async () => {
    seedSeries()
    const { container } = render(<App />)
    const card = openProbe(container)
    fireEvent.click(within(card).getByTestId('dc-cancel'))
    fireEvent.click(within(card).getByTestId('cx-reason-opt-cancel-reasons-5')) // Weather
    fireEvent.click(within(card).getByTestId('dc-cx-scope-following'))
    expect(await screen.findByText(/^Cancelled 4 occurrences/)).toBeTruthy()
    await waitFor(() => {
      const mine = Object.values(stored()).filter((a) => a.seriesId === 'SER-UI')
      expect(mine.every((a) => a.status === 'cancelled' && a.cancelReason === 'Weather' && a.cancelledAt)).toBe(true)
    })
  })
})

function Probe() {
  const { actions, appts } = useStore()
  const [out, setOut] = useState('')
  return (
    <div>
      <div data-testid="rp-out">{out}</div>
      <div data-testid="rp-a">{JSON.stringify(appts.rp1 || null)}</div>
      <button data-testid="rp-move" onClick={() => setOut(JSON.stringify(actions.move('rp1', { date: plus(START, 8), start: 600, end: 660 })))}>move</button>
    </div>
  )
}

describe('dragging one occurrence', () => {
  it('makes it an exception that remembers its original date', async () => {
    seedSeries()
    render(<ToastProvider><StoreProvider><Probe /></StoreProvider></ToastProvider>)
    fireEvent.click(screen.getByTestId('rp-move'))
    expect(JSON.parse(screen.getByTestId('rp-out').textContent).ok).toBe(true)
    const a = JSON.parse(screen.getByTestId('rp-a').textContent)
    expect(a).toMatchObject({ edited: true, originalDate: plus(START, 7), date: plus(START, 8) })
    await waitFor(() => expect(stored().rp1).toMatchObject({ edited: true, originalDate: plus(START, 7) }))
  })
})
