import React from 'react'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import App from '../App'
import { blankState } from '../state/store'
import { claimGate } from '../lib/claims'

const KEY = 'aloha-aba.v3'
const saved = () => JSON.parse(localStorage.getItem(KEY))

beforeEach(() => {
  localStorage.clear()
  window.URL.createObjectURL = vi.fn(() => 'blob:billing-test')
  window.URL.revokeObjectURL = vi.fn()
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('billing file integrity', () => {
  it('Process Billing records its file with submitted claims in one undoable action', async () => {
    const base = blankState()
    expect(Object.values(base.claims).some((c) => c.status === 'draft' && claimGate(base, c).ok)).toBe(true)
    localStorage.setItem(KEY, JSON.stringify({ ...base, ui: { ...base.ui, section: 'billing' }, history: [] }))
    render(<App />)
    fireEvent.click(await screen.findByTestId('bil-process'))
    const file = await waitFor(() => {
      const data = saved()
      const files = Object.values(data.billedFiles || {})
      expect(files).toHaveLength(1)
      expect(files[0].claimIds.length).toBeGreaterThan(0)
      return files[0]
    })
    expect(file.format).toBe('837p')
    expect(file.sendCount).toBe(1)
    expect(file.fileName).toMatch(/^837P-\d{4}-\d{2}-\d{2}-001\.txt$/)
    for (const id of file.claimIds) expect(saved().claims[id].status).toBe('submitted')
    fireEvent.click(screen.getByTestId('nav-sub-files'))
    const row = await screen.findByTestId(`bf-row-${file.id}`)
    expect(row.textContent).toContain(file.fileName)
    expect(row.textContent).toContain('1 send')
    // stored status stays `sent`, but the screen never claims a delivery
    expect(file.status).toBe('sent')
    expect(row.textContent).toContain('Exported')
    expect(screen.getByTestId('bf-kpi-sent').textContent).not.toMatch(/Delivered|Sent/)
    expect(screen.getByTestId('bf-kpi-sent').textContent).toContain('Saved locally')

    fireEvent.keyDown(window, { key: 'u' })
    await waitFor(() => expect(Object.keys(saved().billedFiles)).toHaveLength(0))
    for (const id of file.claimIds) expect(saved().claims[id].status).toBe('draft')
  })

  it('downloads the stored artifact, prepares a manual resend, and Undo restores the send count', async () => {
    const base = blankState()
    const claim = Object.values(base.claims)[0]
    const content = 'ORIGINAL FILE CONTENT\nCLM|100.00'
    const file = { id: 'file-1', fileName: 'claim-original.txt', format: '837p', status: 'sent',
      date: '2026-09-27', payer: claim.payer, claimIds: [claim.id], sendCount: 1, content }
    localStorage.setItem(KEY, JSON.stringify({ ...base, ui: { ...base.ui, section: 'bil-files' }, billedFiles: { [file.id]: file }, history: [] }))
    render(<App />)
    const row = await screen.findByTestId('bf-row-file-1')
    fireEvent.click(screen.getByTestId('bf-download-file-1'))
    expect(window.URL.createObjectURL).toHaveBeenCalledTimes(1)
    const blob = window.URL.createObjectURL.mock.calls[0][0]
    const text = await new Promise((resolve) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.readAsText(blob) })
    expect(text).toBe(content)
    fireEvent.click(screen.getByTestId('bf-resend-file-1'))
    await waitFor(() => expect(saved().billedFiles[file.id].sendCount).toBe(2))
    expect(row.textContent).toContain('2 sends')
    expect(window.URL.createObjectURL).toHaveBeenCalledTimes(2)
    fireEvent.keyDown(window, { key: 'u' })
    await waitFor(() => expect(saved().billedFiles[file.id].sendCount).toBe(1))
    expect(saved().billedFiles[file.id].content).toBe(content)
  })
})
