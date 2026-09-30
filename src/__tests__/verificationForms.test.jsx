import React from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import App from '../App'
import SectionBoundary from '../components/SectionBoundary'
import { blankState, initial, STORAGE_KEY } from '../state/store'
import { normalizeVerificationForms } from '../lib/verificationForms'

afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks() })

it('renders the map-backed route, searches, filters, creates and updates forms', async () => {
  const state = blankState()
  state.ui.section = 'bil-verify'
  state.verificationForms = { regression: { id: 'regression', clientName: 'Regression Client', payer: 'Test payer', status: 'pending' } }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  const view = render(<App />)
  expect(view.getByTestId('vf-row-regression')).toBeTruthy()
  fireEvent.click(view.getByTestId('vf-open-regression'))
  fireEvent.click(view.getByTestId('vf-mark-verified'))
  fireEvent.click(view.getByTestId('vf-status-pending'))
  expect(view.getByTestId('vf-empty')).toBeTruthy()
  fireEvent.click(view.getByTestId('vf-status-all'))
  fireEvent.change(view.getByTestId('vf-search'), { target: { value: 'no match' } })
  expect(view.getByTestId('vf-empty')).toBeTruthy()
  fireEvent.change(view.getByTestId('vf-search'), { target: { value: 'Regression' } })
  expect(view.getByTestId('vf-row-regression')).toBeTruthy()
  fireEvent.click(view.getByTestId('vf-new'))
  await waitFor(() => {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY))
    expect(Object.keys(saved.verificationForms)).toHaveLength(2)
    expect(saved.verificationForms.regression.status).toBe('verified')
  })
})

it('renders an intentionally empty register', () => {
  const state = blankState()
  state.ui.section = 'bil-verify'
  state.verificationForms = {}
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  expect(render(<App />).getByTestId('vf-empty')).toBeTruthy()
})

it('migrates legacy arrays without losing forms and is idempotent', () => {
  const form = { id: 'old', status: 'expired' }
  const migrated = normalizeVerificationForms({ verificationForms: [form], meta: {} })
  expect(migrated.verificationForms).toEqual({ old: form })
  expect(normalizeVerificationForms(migrated)).toBe(migrated)
})

it('backfills old saves once, persists the marker, and respects subsequent clearing', () => {
  const state = blankState()
  delete state.meta
  delete state.verificationForms
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  const migrated = initial()
  expect(Object.keys(migrated.verificationForms).length).toBeGreaterThan(0)
  expect(JSON.parse(localStorage.getItem(STORAGE_KEY)).meta.verificationFormsSeeded).toBe(true)
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...migrated, verificationForms: {} }))
  expect(initial().verificationForms).toEqual({})
})

it('shows a retry card and resets when navigating to another section', () => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  let broken = true
  function View() { if (broken) throw new Error('render failure'); return <p>Recovered</p> }
  const view = render(<SectionBoundary key="one"><View /></SectionBoundary>)
  expect(view.getByRole('alert')).toBeTruthy()
  broken = false
  fireEvent.click(view.getByText('Retry'))
  expect(view.getByText('Recovered')).toBeTruthy()
  broken = true
  view.rerender(<SectionBoundary key="two"><View /></SectionBoundary>)
  expect(view.getByRole('alert')).toBeTruthy()
  view.rerender(<SectionBoundary key="three"><p>Other section</p></SectionBoundary>)
  expect(view.getByText('Other section')).toBeTruthy()
})
