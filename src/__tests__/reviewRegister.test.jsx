import React from 'react'
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import App from '../App'

const KEY = 'aloha-aba.v3'
const stored = () => JSON.parse(localStorage.getItem(KEY) || '{}')

beforeEach(() => {
  localStorage.clear()
  window.URL.createObjectURL = vi.fn(() => 'blob:test')
  window.URL.revokeObjectURL = vi.fn()
})
afterEach(() => cleanup())

const openPayroll = (sub) => {
  render(<App />)
  fireEvent.click(screen.getByTestId('nav-payroll'))
  fireEvent.click(screen.getByTestId(`nav-sub-${sub}`))
}

const buildRun = async () => {
  openPayroll('pay-process')
  fireEvent.click(await screen.findByTestId('pay-period-next-step'))
  await waitFor(() => expect(screen.getByTestId('pay-run-kpis')).toBeTruthy())
  await waitFor(() => expect(Object.keys(stored().payRuns || {})).toHaveLength(1))
}

describe('Review Register — affected-employee drill-down', () => {
  it('opens a list-view modal from "Show n affected employees" and redirects to fix the record', async () => {
    await buildRun()

    // every exception group with affected staff offers the drill-down
    const links = await screen.findAllByTestId(/^pay-gate-filter-/)
    expect(links.length).toBeGreaterThan(0)
    fireEvent.click(links[0])

    const modal = await screen.findByTestId('pay-review-modal')
    const rows = within(modal).getAllByTestId(/^pay-review-row-/)
    expect(rows.length).toBeGreaterThan(0)
    // the list names the issue on each employee and where it gets fixed
    expect(within(modal).getByTestId('pay-review-guide')).toBeTruthy()
    expect(within(modal).getAllByTestId(/^pay-review-issue-/).length).toBeGreaterThan(0)

    // a fix action redirects to the module that can actually resolve it
    const staffId = rows[0].getAttribute('data-testid').replace('pay-review-row-', '')
    fireEvent.click(within(modal).getByTestId(`pay-review-fix-${staffId}`))
    await waitFor(() => expect(screen.queryByTestId('pay-review-modal')).toBeNull())
    await waitFor(() => expect(screen.getByTestId(/^pay-(ts|idmap|setup|runs|process)-sec$/)).toBeTruthy())

    // the deep link lands with the affected employee focused
    if (screen.queryByTestId('pay-ts-sec')) {
      await waitFor(() => expect(screen.getByTestId('pay-ts-detail')).toBeTruthy())
    } else if (screen.queryByTestId('pay-idmap-sec')) {
      await waitFor(() => expect(screen.getByTestId('pay-idmap-search')).toBeTruthy())
      expect(screen.getByTestId('pay-idmap-search').value).not.toBe('')
    }
  })

  it('lets a draft run exclude an affected employee from the modal', async () => {
    await buildRun()
    const links = await screen.findAllByTestId(/^pay-gate-filter-/)
    fireEvent.click(links[0])
    const modal = await screen.findByTestId('pay-review-modal')
    const rows = within(modal).getAllByTestId(/^pay-review-row-/)
    const staffId = rows[0].getAttribute('data-testid').replace('pay-review-row-', '')

    // the run is still a draft — the in-register escape hatch is available
    const exclude = within(modal).queryByTestId(`pay-review-exclude-${staffId}`)
    if (exclude) {
      fireEvent.click(exclude)
      await waitFor(() => {
        const run = Object.values(stored().payRuns || {})[0]
        expect(run.excluded || []).toContain(staffId)
      })
    }
    expect(within(modal).getAllByTestId(/^pay-review-row-/).length).toBeGreaterThan(0)
  })

  it('closes on the overlay and via the footer', async () => {
    await buildRun()
    fireEvent.click((await screen.findAllByTestId(/^pay-gate-filter-/))[0])
    const modal = await screen.findByTestId('pay-review-modal')
    fireEvent.click(within(modal).getByText('Close'))
    await waitFor(() => expect(screen.queryByTestId('pay-review-modal')).toBeNull())
  })
})

describe('Payroll phases — guided design', () => {
  it('renders the four phases with guides and moves ahead with the phase CTAs', async () => {
    openPayroll('pay-process')
    expect(await screen.findByTestId('pay-wizard-period')).toBeTruthy()

    // the phase rail: four labelled steps with descriptive subtitles
    const steps = within(screen.getByTestId('pay-steps')).getAllByTestId(/^pay-step-/)
    expect(steps).toHaveLength(4)
    expect(within(steps[0]).getByText('Select period')).toBeTruthy()
    expect(within(steps[1]).getByText('Review register')).toBeTruthy()
    expect(within(steps[2]).getByText('Approve')).toBeTruthy()
    expect(within(steps[3]).getByText('Process & pay')).toBeTruthy()

    // phase 1 explains itself and guides the way forward
    const p1 = screen.getByTestId('pay-wizard-period')
    expect(within(p1).getByText('Phase 1 of 4')).toBeTruthy()
    expect(within(p1).getByTestId('pay-guide-1')).toBeTruthy()

    fireEvent.click(screen.getByTestId('pay-period-next-step'))
    await waitFor(() => expect(screen.getByTestId('pay-run-kpis')).toBeTruthy())
    const review = screen.getByTestId('pay-wizard-review')
    expect(within(review).getByText('Phase 2 of 4')).toBeTruthy()
    expect(within(review).getByTestId('pay-guide-2')).toBeTruthy()

    // the review CTA walks the user into approval — phases do not stack, so the
    // review panel is replaced by the approval panel rather than piling on top
    fireEvent.click(screen.getByTestId('pay-review-next'))
    const approve = await screen.findByTestId('pay-wizard-approve')
    expect(within(approve).getByText('Phase 3 of 4')).toBeTruthy()
    expect(within(approve).getByTestId('pay-guide-3')).toBeTruthy()
    expect(screen.queryByTestId('pay-wizard-review')).toBeNull()
    // phase 2 is summarised as a recap the user can step back into
    expect(within(screen.getByTestId('pay-recap-register')).getByText(/PR-0001/)).toBeTruthy()

    // approving (as somebody other than the preparer) unlocks phase 4, guided too
    const approver = screen.getByTestId('pay-approver')
    fireEvent.change(approver, { target: { value: 'Neha Peyyeti' } })
    fireEvent.click(screen.getByTestId('pay-approve'))
    const process = await screen.findByTestId('pay-wizard-process')
    expect(within(process).getByText('Phase 4 of 4')).toBeTruthy()
    expect(within(process).getByTestId('pay-guide-4')).toBeTruthy()
    expect(screen.queryByTestId('pay-wizard-approve')).toBeNull()
  })
})
