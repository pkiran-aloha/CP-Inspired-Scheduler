// Appeals: filing an appeal marks the claim (it does not invent a status), and a win
// returns the claim to awaiting payer payment so the money can be posted — item 13.
import React from 'react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import App from '../App'
import { CLAIM_STATUSES } from '../lib/claims'
import { normalizeAppealedClaims } from '../lib/master'

// jsdom Blob has no text(); FileReader reads what the download saved.
const readBlob = (blob) => new Promise((resolve) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.readAsText(blob) })
const KEY = 'aloha-aba.v3'
const stored = () => JSON.parse(localStorage.getItem(KEY))

beforeEach(() => { localStorage.clear(); cleanup() })
afterEach(() => cleanup())

async function openAppeals() {
  const { container } = render(<App />)
  fireEvent.click(screen.getByTestId('nav-billing')) // sub-items render for the active section
  fireEvent.click(await screen.findByTestId('nav-sub-appeals'))
  await screen.findByTestId('appeal-table')
  const row = container.querySelector('[data-testid^="appeal-row-"]')
  expect(row).toBeTruthy()
  const id = row.getAttribute('data-testid').replace('appeal-row-', '')
  fireEvent.click(row)
  await screen.findByTestId('appeal-submit')
  await waitFor(() => expect(stored()).toBeTruthy()) // the first debounced persist has landed
  return { id }
}

describe('appeals', () => {
  it('filing an appeal keeps the claim in a real status and a win makes the money postable', async () => {
    const { id } = await openAppeals()
    const before = stored().claims[id]
    expect(before.status).toBe('denied')

    fireEvent.click(screen.getByTestId('appeal-submit'))
    await waitFor(() => expect(stored().claims[id].appeal).toBeTruthy())
    // the claim is marked, not moved to a status the rest of the app does not know
    expect(stored().claims[id].status).toBe('denied')
    expect(stored().claims[id].appeal.template).toBeTruthy()
    expect(stored().claims[id].paid || 0).toBe(before.paid || 0)
    for (const c of Object.values(stored().claims)) expect(CLAIM_STATUSES[c.status]).toBeTruthy()

    fireEvent.click(screen.getByTestId('appeal-mark-won'))
    await waitFor(() => expect(stored().claims[id].appeal.outcome).toBe('won'))
    const won = stored().claims[id]
    // awaiting the payer's payment (an open status), not Paid, and no money invented
    expect(won.status).toBe('submitted')
    expect(won.paid || 0).toBe(before.paid || 0)
    expect(won.history.some((h) => /Appeal won/.test(h.ev))).toBe(true)
  })

  it('a saved workspace that still holds the retired `appealed` status is healed on load', () => {
    const base = { claims: { a: { id: 'a', status: 'appealed', appeal: { outcome: null } }, b: { id: 'b', status: 'paid' } } }
    const healed = normalizeAppealedClaims(base)
    expect(healed).not.toBe(base)
    expect(healed.claims.a.status).toBe('denied') // the status it had before the appeal
    expect(healed.claims.a.appeal).toEqual({ outcome: null }) // the marker survives
    expect(healed.claims.b).toBe(base.claims.b)
    // a recorded win re-opens it for the payment instead
    const won = normalizeAppealedClaims({ claims: { a: { status: 'appealed', appeal: { outcome: 'won' } } } })
    expect(won.claims.a.status).toBe('submitted')
    // idempotent: a second pass returns the very same object
    expect(normalizeAppealedClaims(healed)).toBe(healed)
    expect(normalizeAppealedClaims({})).toEqual({})
  })

  it('downloads the appeal letter from the tested builder with the recorded denial reason', async () => {
    window.URL.createObjectURL = vi.fn(() => 'blob:appeal-test')
    window.URL.revokeObjectURL = vi.fn()
    const { id } = await openAppeals()
    const claim = stored().claims[id]
    expect(claim.denial.reason).toBeTruthy()
    // the queue and the detail read the claim's real denial record
    expect(screen.getByTestId(`appeal-row-${id}`).textContent).toContain(claim.denial.reason)
    expect(screen.getByTestId('appeal-detail').textContent).toContain(claim.denial.reason)
    fireEvent.change(screen.getByTestId('appeal-note'), { target: { value: 'Session notes attached.' } })
    fireEvent.click(screen.getByTestId('appeal-letter'))
    const text = await readBlob(window.URL.createObjectURL.mock.calls[0][0])
    expect(text).toContain(`Re: Appeal · Claim ${claim.no}`)
    expect(text).toContain(`Denial reason: ${claim.denial.reason}`)
    expect(text).toContain('meets medical necessity criteria')
    expect(text).toContain('Session notes attached.')
    expect(await screen.findByText(`Appeal-${claim.no}.txt downloaded. Nothing was sent to ${claim.payer}.`)).toBeTruthy()
    expect(stored().claims[id].appeal).toBeFalsy() // downloading is not filing
  })

  it('a lost appeal leaves the claim denied', async () => {
    const { id } = await openAppeals()
    fireEvent.click(screen.getByTestId('appeal-mark-lost'))
    await waitFor(() => expect(stored().claims[id].appeal?.outcome).toBe('lost'))
    expect(stored().claims[id].status).toBe('denied')
  })
})
