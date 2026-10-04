import React from 'react'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import App from '../App'
import { blankState, StoreProvider, useStore } from '../state/store'
import { planStatement, planStatementSent, planStatementVoid, statementBalance, statementStatus, statementLines, statementDoc } from '../lib/statements'
import { createWorkspaceBackup, readWorkspaceBackup } from '../lib/workspaceBackup'

const KEY = 'aloha-aba.v3'
const saved = () => JSON.parse(localStorage.getItem(KEY))
beforeEach(() => {
  localStorage.clear()
  window.URL.createObjectURL = vi.fn(() => 'blob:statement-test')
  window.URL.revokeObjectURL = vi.fn()
})
afterEach(() => cleanup())

// A self-pay claim gives the first client a family balance of $120 (the demo seed has none).
const BASE = blankState()
const CID = BASE.clients[0].id
const SP = { id: 'sp1', no: 'CLM-SP-1', clientId: CID, payer: 'Self-pay', mode: 'selfpay', charges: 120, paid: 0, adj: 0, patientPaid: 0,
  status: 'submitted', dosFrom: '2026-09-02', dosTo: '2026-09-02', history: [], createdAt: 1, units: 8,
  lines: [{ apptId: 'sp-appt', dos: '2026-09-02', code: '97153', units: 8, rate: 15, charge: 120, kind: 'session', t0: 540, t1: 660 }] }
const WITH_SP = { ...BASE, claims: { ...BASE.claims, sp1: SP } }
const AT = Date.parse('2026-10-04T10:00:00Z')

describe('statements — engine', () => {
  it('issues a numbered statement for what the family owes, and refuses when nothing is owed', () => {
    expect(statementLines(WITH_SP, CID).map((l) => [l.claimNo, l.due])).toContainEqual(['CLM-SP-1', 120])
    const p = planStatement(WITH_SP, CID, { id: 's1', at: AT })
    expect(p.ok).toBe(true)
    expect(p.item).toMatchObject({ no: 'STM-202610-001', clientId: CID, status: 'issued', sentAt: null })
    expect(p.item.lines.find((l) => l.claimId === 'sp1').due).toBe(120)
    const nobody = BASE.clients.find((c) => !statementLines(WITH_SP, c.id).length)
    expect(planStatement(WITH_SP, nobody.id, { id: 's2' }).ok).toBe(false)
  })

  it('balance is live: sent, then paid once the claim is settled; void keeps its history', () => {
    const st0 = planStatement(WITH_SP, CID, { id: 's1', at: AT }).item
    let state = { ...WITH_SP, statements: { s1: st0 } }
    expect(statementStatus(state, st0)).toBe('issued')
    expect(planStatementSent(state, 's1', { via: 'nope' }).ok).toBe(false)
    const sent = planStatementSent(state, 's1', { via: 'mail' }).item
    state = { ...state, statements: { s1: sent } }
    expect(statementStatus(state, sent)).toBe('sent')
    const only = { ...sent, lines: sent.lines.filter((l) => l.claimId === 'sp1') }
    const settled = { ...state, claims: { ...state.claims, sp1: { ...SP, paid: 120, status: 'paid' } } }
    expect(statementBalance(state, only)).toBe(120)
    expect(statementBalance(settled, only)).toBe(0)
    expect(statementStatus(settled, only)).toBe('paid')
    expect(planStatementVoid(state, 's1', { reason: '' }).ok).toBe(false)
    const voided = planStatementVoid(state, 's1', { reason: 'Issued to the wrong family' }).item
    expect(statementStatus(state, voided)).toBe('void')
    expect(voided.history.map((h) => h.ev).join(' | ')).toMatch(/Issued .* \| Marked sent: Mailed \| Voided: Issued to the wrong family/)
    expect(statementDoc(state, voided).sections[0].rows.find((r) => r.label === 'Status').value).toBe('VOID')
  })

  it('travels in workspace backups; an older backup without statements imports with none', () => {
    const st0 = planStatement(WITH_SP, CID, { id: 's1', at: AT }).item
    const { data } = readWorkspaceBackup(createWorkspaceBackup({ ...WITH_SP, statements: { s1: st0 } }), blankState())
    expect(data.statements.s1.no).toBe(st0.no)
    const older = JSON.parse(createWorkspaceBackup(WITH_SP))
    delete older.data.statements
    expect(readWorkspaceBackup(JSON.stringify(older), blankState()).data.statements).toEqual({})
  })
})

function Probe() {
  const { actions } = useStore()
  return <>
    <button onClick={() => actions.issueStatement(CID)}>Issue</button>
    <button onClick={() => actions.undo()}>Undo once</button>
  </>
}

describe('statements — store and screen', () => {
  it('issuing is one action and one Undo', async () => {
    localStorage.setItem(KEY, JSON.stringify(WITH_SP))
    render(<StoreProvider><Probe /></StoreProvider>)
    fireEvent.click(screen.getByText('Issue'))
    await waitFor(() => expect(Object.keys(saved().statements)).toHaveLength(1))
    fireEvent.click(screen.getByText('Undo once'))
    await waitFor(() => expect(saved().statements).toEqual({}))
  })

  it('Generate Invoice issues, downloads, marks sent and voids a statement', async () => {
    localStorage.setItem(KEY, JSON.stringify({ ...WITH_SP, ui: { ...WITH_SP.ui, section: 'bil-invoice', invPrefill: { clientIds: [CID] } } }))
    render(<App />)
    expect(await screen.findByTestId('gi-statements-empty')).toBeTruthy()
    fireEvent.click(await screen.findByTestId(`gi-issue-${CID}`))
    await waitFor(() => expect(Object.values(saved().statements)).toHaveLength(1))
    const st = Object.values(saved().statements)[0]
    fireEvent.click(await screen.findByTestId(`gi-st-pdf-${st.id}`))
    expect(window.URL.createObjectURL).toHaveBeenCalledTimes(1)
    expect(window.URL.createObjectURL.mock.calls[0][0].type).toBe('application/pdf')
    fireEvent.change(screen.getByTestId(`gi-st-via-${st.id}`), { target: { value: 'hand' } })
    fireEvent.click(screen.getByTestId(`gi-st-sent-${st.id}`))
    await waitFor(() => expect(saved().statements[st.id]).toMatchObject({ sentVia: 'hand' }))
    expect(screen.getByTestId(`gi-st-status-${st.id}`).textContent).toMatch(/Sent · Handed to the family/)
    fireEvent.click(screen.getByTestId(`gi-st-void-${st.id}`))
    fireEvent.change(screen.getByTestId(`gi-st-reason-${st.id}`), { target: { value: 'Duplicate statement' } })
    fireEvent.click(screen.getByTestId(`gi-st-void-ok-${st.id}`))
    await waitFor(() => expect(saved().statements[st.id].status).toBe('void'))
  })
})
