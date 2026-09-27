import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { readFileSync } from 'fs'
import path from 'path'
import { blankState, StoreProvider, useStore } from '../state/store'
import { ToastProvider } from '../ui/Toast'
import PaymentCenterView from '../components/PaymentCenterView'

const KEY = 'aloha-aba.v3'
const full = readFileSync(path.join(__dirname, 'fixtures/835-full.txt'), 'utf8')
const correctedFifth = full.replace('CAS*PR*2*50~\nAMT*B6*50', 'CAS*PR*2*50~\nAMT*B6*250')
const saved = () => JSON.parse(localStorage.getItem(KEY) || '{}')
const claim = (id, n, amount, status) => ({
  id, no: `CLM-202609-00${n}`, charges: amount, paid: 0, adj: 0, status,
  clientId: 'c1', payer: 'Aetna', submittedAt: 100, history: [], dosFrom: '2026-09-01', dosTo: '2026-09-01', lines: [],
})
const fileOf = (text, name = 'sample.835') => {
  const file = new File([text], name, { type: 'text/plain' })
  Object.defineProperty(file, 'text', { value: async () => text })
  return file
}
const load = (file) => fireEvent.change(screen.getByTestId('pc-era-upload'), { target: { files: [file] } })

function Probe() {
  const { actions } = useStore()
  return <><button onClick={() => actions.updateClaim('c5-era', { status: 'submitted' })}>Submit claim five</button><button onClick={() => actions.undo()}>Undo once</button></>
}

beforeEach(() => {
  localStorage.clear()
  window.URL.createObjectURL = vi.fn(() => 'blob:test')
  window.URL.revokeObjectURL = vi.fn()
  const state = blankState()
  state.claims = { 'c4-era': claim('c4-era', 4, 400, 'submitted'), 'c5-era': claim('c5-era', 5, 250, 'draft') }
  state.payments = {}
  state.eraImports = {}
  state.history = []
  localStorage.setItem(KEY, JSON.stringify(state))
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })
const mount = () => render(<ToastProvider><StoreProvider><PaymentCenterView /><Probe /></StoreProvider></ToastProvider>)

describe('Payment Center — local 835 workflow', () => {
  it('previews safe vs held, posts one, exports parked, retries after correction and undoes retry', async () => {
    mount()
    fireEvent.click(screen.getByTestId('pc-open-era'))
    load(fileOf(correctedFifth))
    const preview = await screen.findByTestId('pc-era-preview')
    expect(preview.textContent).toMatch(/5 claim lines · 1 eligible · 4 held/)
    expect(preview.textContent).toMatch(/PLB present/)
    const table = screen.getByTestId('pc-era-preview-lines')
    expect(within(table).getByRole('checkbox', { name: 'Post CLM-202609-001' }).disabled).toBe(true)
    expect(within(table).getByRole('checkbox', { name: 'Post CLM-202609-005' }).disabled).toBe(true)
    fireEvent.click(within(table).getByRole('checkbox', { name: 'Post CLM-202609-004' }))
    fireEvent.click(screen.getByTestId('pc-era-post'))
    await waitFor(() => {
      const s = saved()
      expect(s.claims['c4-era'].paid).toBe(400)
      expect(s.payments && Object.keys(s.payments)).toHaveLength(1)
      expect(Object.values(s.eraImports)).toHaveLength(1)
    })
    const record = Object.values(saved().eraImports)[0]
    expect(record).toMatchObject({ posted: 1, parked: 4, status: 'partial', hasPLB: true })
    expect(screen.getByTestId('pc-eras')).toBeTruthy()
    fireEvent.click(screen.getByTestId(`pc-era-export-${record.id}`))
    expect(window.URL.createObjectURL).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByTestId(`pc-era-history-${record.id}`))
    expect(screen.getByTestId('pc-era-detail')).toBeTruthy()
    expect(screen.getByTestId('pc-era-retry').disabled).toBe(true)
    fireEvent.click(screen.getByText('Submit claim five'))
    await waitFor(() => expect(saved().claims['c5-era'].status).toBe('submitted'))
    const retryTable = screen.getByTestId('pc-era-retry-lines')
    await waitFor(() => expect(within(retryTable).getByRole('checkbox', { name: 'Post CLM-202609-005' }).disabled).toBe(false))
    fireEvent.click(within(retryTable).getByRole('checkbox', { name: 'Post CLM-202609-005' }))
    fireEvent.click(screen.getByTestId('pc-era-retry'))
    await waitFor(() => {
      expect(saved().claims['c5-era'].paid).toBe(200)
      expect(saved().claims['c5-era'].status).toBe('partially_paid')
      expect(saved().eraImports[record.id]).toMatchObject({ posted: 2, parked: 3 })
    })
    fireEvent.click(screen.getByText('Undo once'))
    await waitFor(() => {
      expect(saved().claims['c5-era'].status).toBe('submitted')
      expect(saved().claims['c5-era'].paid).toBe(0)
      expect(saved().eraImports[record.id]).toMatchObject({ posted: 1, parked: 4 })
      expect(Object.values(saved().payments)).toHaveLength(1)
    })
  })

  it('requires a monetary CARC adjustment for typed denials and does not invent a payment', async () => {
    mount()
    fireEvent.click(screen.getByTestId('pc-open-era'))
    fireEvent.click(screen.getByTestId('pc-era-mode-typed'))
    fireEvent.change(screen.getByTestId('pc-era-line-status-0'), { target: { value: 'denied' } })
    fireEvent.change(screen.getByTestId('pc-era-line-adj-0'), { target: { value: '400' } })
    fireEvent.click(screen.getByTestId('pc-era-save'))
    expect(screen.getByRole('alert').textContent).toMatch(/CARC code/i)
    expect(saved().claims['c4-era'].status).toBe('submitted')
    fireEvent.change(screen.getByLabelText('CARC code for line 1'), { target: { value: '197' } })
    fireEvent.click(screen.getByTestId('pc-era-save'))
    await waitFor(() => expect(saved().claims['c4-era'].denial?.code).toBe('carc:CO-197'))
    expect(Object.values(saved().payments)).toHaveLength(0)
    fireEvent.click(screen.getByText('Undo once'))
    await waitFor(() => expect(saved().claims['c4-era'].status).toBe('submitted'))
    expect(saved().eraImports).toEqual({})
  })

  it('rejects malformed/duplicate uploads and typed overpayments instead of mutating the ledger', async () => {
    mount()
    fireEvent.click(screen.getByTestId('pc-open-era'))
    load(fileOf(full, 'not-edi.pdf'))
    expect(screen.getByRole('alert').textContent).toMatch(/.835 or .txt/)
    load(fileOf('bad content', 'broken.txt'))
    await screen.findByTestId('pc-era-preview')
    expect(screen.getByTestId('pc-era-post').disabled).toBe(true)
    fireEvent.click(screen.getByTestId('pc-era-mode-typed'))
    fireEvent.change(screen.getByTestId('pc-era-line-amt-0'), { target: { value: '500' } })
    fireEvent.click(screen.getByTestId('pc-era-save'))
    expect(screen.getByRole('alert').textContent).toMatch(/exceed|reconcile/i)
    expect(saved().claims['c4-era'].paid).toBe(0)
    fireEvent.change(screen.getByTestId('pc-era-line-amt-0'), { target: { value: '400' } })
    fireEvent.click(screen.getByTestId('pc-era-save'))
    await waitFor(() => expect(Object.keys(saved().eraImports)).toHaveLength(1))
    expect(saved().claims['c4-era'].paid).toBe(400)
    const count = Object.keys(saved().payments).length
    fireEvent.click(screen.getByTestId('pc-open-era'))
    load(fileOf(full))
    await screen.findByTestId('pc-era-preview')
    expect(screen.getByTestId('pc-era-preview').textContent).toMatch(/0 eligible/)
    expect(Object.keys(saved().payments)).toHaveLength(count)
  })
})
