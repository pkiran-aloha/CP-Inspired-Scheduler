import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { blankState, StoreProvider, useStore } from '../state/store'
import { ToastProvider } from '../ui/Toast'
import QuickBooksView from '../components/QuickBooksView'

// jsdom Blob has no text(); FileReader reads what the download saved.
const readBlob = (blob) => new Promise((resolve) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.readAsText(blob) })
const KEY = 'aloha-aba.v3'
function LocalRecords() {
  const { actions } = useStore()
  return <><button onClick={() => actions.undo()}>Undo</button><QuickBooksView /></>
}

beforeEach(() => {
  localStorage.clear()
  window.URL.createObjectURL = vi.fn(() => 'blob:qbo-test')
  window.URL.revokeObjectURL = vi.fn()
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

  it('downloads the QuickBooks import CSV from the tested builder and says nothing was sent', async () => {
    render(<ToastProvider><StoreProvider><LocalRecords /></StoreProvider></ToastProvider>)
    fireEvent.click(screen.getByTestId('qbo-export'))
    const blob = window.URL.createObjectURL.mock.calls[0][0]
    expect(blob.type).toMatch(/text\/csv/)
    expect((await readBlob(blob)).split('\n')[0]).toBe('Invoice Number,Customer,Invoice Date,Due Date,Product/Service,Qty,Unit Price,Amount,Memo,Tax Code')
    expect(await screen.findByText(/downloaded for QuickBooks import\. Nothing was sent to QuickBooks\./)).toBeTruthy()
  })
})
