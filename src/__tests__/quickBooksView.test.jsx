import React from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { blankState, StoreProvider, useStore } from '../state/store'
import { ToastProvider } from '../ui/Toast'
import QuickBooksView from '../components/QuickBooksView'

const KEY = 'aloha-aba.v3'
function LocalRecords() {
  const { actions } = useStore()
  return <><button onClick={() => actions.undo()}>Undo</button><QuickBooksView /></>
}

beforeEach(() => {
  localStorage.clear()
  const state = blankState()
  state.qbo = {
    'export-1': { id: 'export-1', invoiceNo: 'INV-1', clientName: 'Sample Client', amount: 42, status: 'pending' },
    'export-2': { id: 'export-2', invoiceNo: 'INV-2', clientName: 'Other Client', amount: 24, status: 'synced' },
  }
  localStorage.setItem(KEY, JSON.stringify(state))
})
afterEach(() => cleanup())

describe('QuickBooks local records', () => {
  it('renders object-backed records, treats legacy synced as unverified, and only marks a local review', async () => {
    render(<ToastProvider><StoreProvider><LocalRecords /></StoreProvider></ToastProvider>)
    expect(screen.getByTestId('qbo-sec').textContent).toMatch(/No QuickBooks API is connected/)
    expect(screen.getByTestId('qbo-row-export-2').textContent).toMatch(/legacy \(unverified\)/)
    expect(screen.queryByTestId('qbo-sync-all')).toBeNull()
    expect(screen.queryByTestId('qbo-sync-export-1')).toBeNull()

    fireEvent.click(screen.getByTestId('qbo-review-export-1'))
    await waitFor(() => expect(JSON.parse(localStorage.getItem(KEY)).qbo['export-1'].status).toBe('reviewed'))
    expect(screen.getByTestId('qbo-kpi-reviewed').textContent).toMatch(/Reviewed/)
    expect(screen.getByTestId('qbo-row-export-1').textContent).toMatch(/reviewed/)

    fireEvent.click(screen.getByText('Undo'))
    await waitFor(() => expect(JSON.parse(localStorage.getItem(KEY)).qbo['export-1'].status).toBe('pending'))
    expect(screen.getByTestId('qbo-row-export-2').textContent).toMatch(/legacy \(unverified\)/)
  })
})
