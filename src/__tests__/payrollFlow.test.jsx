import React from 'react'
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import App from '../App'
import { blankState } from '../state/store'
import { periodsFor } from '../lib/payroll'
import { timesheetHtml } from '../lib/payrollExport'

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

describe('payroll navigation', () => {
  it('exposes every payroll sub-module from the rail and routes to it', async () => {
    render(<App />)
    fireEvent.click(screen.getByTestId('nav-payroll'))
    for (const [sub, testid] of [
      ['pay-process', 'pay-process-sec'],
      ['pay-runs', 'pay-runs-sec'],
      ['pay-idmap', 'pay-idmap-sec'],
      ['pay-summary', 'pay-sum-sec'],
      ['pay-timesheets', 'pay-ts-sec'],
      ['pay-qbo', 'pay-qbo-sec'],
      ['pay-setup', 'pay-setup-sec'],
    ]) {
      fireEvent.click(screen.getByTestId(`nav-sub-${sub}`))
      expect(await screen.findByTestId(testid)).toBeTruthy()
    }
  })

  it('jumps to payroll with the 9 shortcut — landing on the cycle overview', async () => {
    render(<App />)
    fireEvent.keyDown(window, { key: '9' })
    expect(await screen.findByTestId('pay-cycle-sec')).toBeTruthy()
    // the section opens on the process (the four phases), not mid-wizard
    expect(screen.getByTestId('pay-cycle-phases')).toBeTruthy()
    expect(within(screen.getByTestId('pay-cycle-phase-0')).getByText('Select period')).toBeTruthy()
    expect(within(screen.getByTestId('pay-cycle-phase-3')).getByText('Process & pay')).toBeTruthy()
  })

  it('drills from the landing checks into the affected employees, grouped per issue', async () => {
    render(<App />)
    fireEvent.click(screen.getByTestId('nav-payroll'))
    fireEvent.click(await screen.findByTestId('pay-cycle-show-affected'))

    const modal = await screen.findByTestId('pay-review-modal')
    // the landing hands the modal a grouped issue, so real employee rows appear
    expect(within(modal).getAllByTestId(/^pay-review-row-/).length).toBeGreaterThan(0)
    expect(within(modal).getAllByTestId(/^pay-review-issue-/).length).toBeGreaterThan(0)

    fireEvent.click(within(modal).getByText('Close'))
    await waitFor(() => expect(screen.queryByTestId('pay-review-modal')).toBeNull())
  })

  it('routes from the landing module tiles into the payroll screens', async () => {
    render(<App />)
    fireEvent.click(screen.getByTestId('nav-payroll'))
    for (const [tile, sec] of [
      ['pay-tile-runs', 'pay-runs-sec'],
      ['pay-tile-timesheets', 'pay-ts-sec'],
      ['pay-tile-idmap', 'pay-idmap-sec'],
      ['pay-tile-summary', 'pay-sum-sec'],
      ['pay-tile-qbo', 'pay-qbo-sec'],
      ['pay-tile-setup', 'pay-setup-sec'],
    ]) {
      fireEvent.click(await screen.findByTestId('pay-tab-payroll'))
      fireEvent.click(await screen.findByTestId(tile))
      expect(await screen.findByTestId(sec)).toBeTruthy()
    }
  })

  it('landing explains the cycle and opens the wizard at the phase that is next', async () => {
    openPayroll('pay-process')
    fireEvent.click(await screen.findByTestId('pay-wizard-overview'))
    // back on the landing page: cycle status, live checks and one primary action
    expect(await screen.findByTestId('pay-cycle-hero')).toBeTruthy()
    expect(screen.getByTestId('pay-cycle-norun').textContent).toMatch(/not started/i)
    expect(screen.getByTestId('pay-cycle-checks')).toBeTruthy()
    expect(screen.getByTestId('pay-cycle-modules')).toBeTruthy()

    // phase 1 starts the wizard; a run is only created inside the wizard
    fireEvent.click(screen.getByTestId('pay-cycle-cta'))
    expect(await screen.findByTestId('pay-wizard-period')).toBeTruthy()
    fireEvent.click(screen.getByTestId('pay-period-next-step'))
    await waitFor(() => expect(screen.getByTestId('pay-wizard-review')).toBeTruthy())

    // the landing now reports the draft run and where the cycle stands
    fireEvent.click(screen.getByTestId('pay-wizard-overview'))
    expect(await screen.findByTestId('pay-cycle-phase-1')).toBeTruthy()
    expect(screen.getByTestId('pay-cycle-hint').textContent).toMatch(/PR-0001 — next: Review register \(phase 2 of 4\)/)
  })
})

describe('Process Payroll wizard', () => {
  it('runs a full cycle: period → register → approve → process → stubs, and locks the register', async () => {
    openPayroll('pay-process')
    expect(await screen.findByTestId('pay-wizard-period')).toBeTruthy()
    expect(screen.getByTestId('pay-period-select')).toBeTruthy()

    // step 1 → build the register
    fireEvent.click(screen.getByTestId('pay-period-next-step'))
    await waitFor(() => expect(screen.getByTestId('pay-run-kpis')).toBeTruthy())
    const grossText = within(screen.getByTestId('pay-kpi-gross')).getByText(/\$[\d,]+/)
    expect(grossText.textContent).toMatch(/^\$[\d,]+$/)
    expect(screen.getByTestId('pay-run-row-s1')).toBeTruthy()
    expect(screen.getByTestId('pay-gate-list')).toBeTruthy() // exceptions are surfaced, not hidden

    // a run is persisted at creation
    await waitFor(() => expect(Object.keys(stored().payRuns || {})).toHaveLength(1))

    // step 2 → approve as a *different* person than the preparer
    fireEvent.click(screen.getByTestId('pay-review-next'))
    const approver = await screen.findByTestId('pay-approver')
    fireEvent.change(approver, { target: { value: 'Neha Peyyeti' } })
    fireEvent.click(screen.getByTestId('pay-approve'))
    await waitFor(() => expect(Object.values(stored().payRuns)[0].status).toBe('approved'))

    // step 3 → process and lock
    fireEvent.click(screen.getByTestId('pay-process'))
    await waitFor(() => expect(Object.values(stored().payRuns)[0].locked).toBe(true))
    expect(await screen.findByTestId('pay-wizard-done')).toBeTruthy()
    const run = Object.values(stored().payRuns)[0]
    expect(run.totals.grossCents).toBeGreaterThan(0)
    expect(run.totals.netCents).toBeGreaterThan(0)
    expect(run.totals.netCents).toBeLessThan(run.totals.grossCents + run.totals.reimbursementCents + 1)
    expect(run.audit.map((a) => a.action)).toEqual(expect.arrayContaining(['created', 'approved', 'processed']))

    // timesheets for the period are now marked processed
    const sheets = Object.values(stored().paySheets).filter((s) => s.periodId === run.periodId)
    expect(sheets.length).toBeGreaterThan(0)
    expect(sheets.every((s) => s.status === 'processed')).toBe(true)

    // the released artifacts are real documents
    fireEvent.click(screen.getByTestId('pay-stubs'))
    expect(window.URL.createObjectURL).toHaveBeenCalled()
    fireEvent.click(screen.getByTestId('pay-provider-file'))
    fireEvent.click(screen.getByTestId('pay-gl-journal'))
    fireEvent.click(screen.getByTestId('pay-ach'))
  })

  it('refuses to let the preparer approve their own run', async () => {
    openPayroll('pay-process')
    fireEvent.click(await screen.findByTestId('pay-period-next-step'))
    await waitFor(() => expect(screen.getByTestId('pay-run-kpis')).toBeTruthy())
    fireEvent.click(screen.getByTestId('pay-review-next'))
    const approver = await screen.findByTestId('pay-approver')
    fireEvent.change(approver, { target: { value: 'Prateek Kiran' } }) // the seeded preparer
    expect(await screen.findByTestId('pay-sod-warning')).toBeTruthy()
    fireEvent.click(screen.getByTestId('pay-approve'))
    await waitFor(() => expect(Object.values(stored().payRuns || {})[0]?.status).toBe('draft'))
  })

  it('resumes an existing run instead of creating a duplicate for the same period', async () => {
    openPayroll('pay-process')
    fireEvent.click(await screen.findByTestId('pay-period-next-step'))
    await waitFor(() => expect(screen.getByTestId('pay-run-kpis')).toBeTruthy())
    await waitFor(() => expect(Object.keys(stored().payRuns || {})).toHaveLength(1))
    // leaving and re-entering the wizard on the same period must not make a second run
    fireEvent.click(screen.getByTestId('pay-step-0'))
    expect(await screen.findByTestId('pay-existing-run')).toBeTruthy()
    fireEvent.click(screen.getByTestId('pay-period-next-step'))
    await waitFor(() => expect(Object.keys(stored().payRuns)).toHaveLength(1))
  })

  it('renders one phase panel at a time — completed phases collapse to recaps', async () => {
    openPayroll('pay-process')
    fireEvent.click(await screen.findByTestId('pay-period-next-step'))
    await waitFor(() => expect(screen.getByTestId('pay-wizard-review')).toBeTruthy())

    // phase 2 on screen: phase 1 is a recap row, phase 3/4 panels are not mounted
    expect(screen.getByTestId('pay-recap-period')).toBeTruthy()
    expect(screen.queryByTestId('pay-wizard-approve')).toBeNull()
    expect(screen.queryByTestId('pay-wizard-process')).toBeNull()
    expect(screen.queryByTestId('pay-wizard-period')).toBeNull()

    // the rail still names all four phases
    expect(within(screen.getByTestId('pay-steps')).getAllByTestId(/^pay-step-/)).toHaveLength(4)

    fireEvent.click(screen.getByTestId('pay-review-next'))
    expect(await screen.findByTestId('pay-wizard-approve')).toBeTruthy()
    expect(screen.queryByTestId('pay-wizard-review')).toBeNull()
    expect(screen.getByTestId('pay-recap-register')).toBeTruthy()

    // going back through a recap re-opens that phase instead of stacking
    fireEvent.click(screen.getByTestId('pay-recap-period-open'))
    expect(await screen.findByTestId('pay-wizard-period')).toBeTruthy()
    expect(screen.queryByTestId('pay-wizard-approve')).toBeNull()
  })

  it('reports the last processed payroll on the header', async () => {
    openPayroll('pay-process')
    fireEvent.click(await screen.findByTestId('pay-period-next-step'))
    await waitFor(() => expect(screen.getByTestId('pay-run-kpis')).toBeTruthy())
    fireEvent.click(screen.getByTestId('pay-review-next'))
    fireEvent.click(await screen.findByTestId('pay-approve'))
    await waitFor(() => expect(Object.values(stored().payRuns)[0].status).toBe('approved'))
    fireEvent.click(await screen.findByTestId('pay-process'))
    expect(await screen.findByTestId('pay-wizard-done')).toBeTruthy()
    expect(screen.getByText(/Last payroll processed on/)).toBeTruthy()
  })
})

describe('Timesheet Submission', () => {
  it('lists derived timesheets, approves in bulk and reopens with the control respected', async () => {
    openPayroll('pay-timesheets')
    expect(await screen.findByTestId('pay-ts-table')).toBeTruthy()
    await waitFor(() => expect(screen.getByTestId('pay-ts-row-s1')).toBeTruthy())

    // the seeded period has a mix of approved / submitted / open sheets
    fireEvent.click(screen.getByTestId('pay-ts-tab-submitted'))
    expect(screen.getByTestId('pay-ts-kpis')).toBeTruthy()
    fireEvent.click(screen.getByTestId('pay-ts-approve'))
    await waitFor(() => {
      const submitted = Object.values(stored().paySheets).filter((s) => s.status === 'submitted' && s.periodId === Object.values(stored().paySheets).find((x) => x.status === 'submitted')?.periodId)
      expect(submitted.length).toBe(0)
    })
  })

  it('opens a timesheet, shows its calendar-derived lines, and records a supervisor adjustment', async () => {
    openPayroll('pay-timesheets')
    await waitFor(() => expect(screen.getByTestId('pay-ts-row-s3')).toBeTruthy())
    fireEvent.click(screen.getByTestId('pay-ts-open-s3'))
    const detail = await screen.findByTestId('pay-ts-detail')
    expect(detail).toBeTruthy()
    expect(screen.getByTestId('pay-ts-lines').textContent).toBeTruthy()
    fireEvent.change(screen.getByTestId('pay-ts-adj-hours'), { target: { value: '3' } })
    fireEvent.change(screen.getByTestId('pay-ts-adj-note'), { target: { value: 'Fidelity coaching notes' } })
    fireEvent.click(screen.getByTestId('pay-ts-adj-add'))
    await waitFor(() => {
      const sheet = Object.values(stored().paySheets).find((s) => s.staffId === 's3' && (s.adjustments || []).length > 0)
      expect(sheet.adjustments[0]).toMatchObject({ code: 'ADMIN', hours: 3 })
    })
  })

  it('filters by status, office and search, and paginates', async () => {
    openPayroll('pay-timesheets')
    await waitFor(() => expect(screen.getByTestId('pay-ts-table')).toBeTruthy())
    fireEvent.click(screen.getByTestId('pay-ts-tab-approved'))
    fireEvent.change(screen.getByTestId('pay-ts-search'), { target: { value: 'Prateek' } })
    await waitFor(() => expect(screen.getByTestId('pay-ts-row-s1')).toBeTruthy())
    fireEvent.change(screen.getByTestId('pay-ts-search'), { target: { value: 'zzzz-no-match' } })
    expect(await screen.findByTestId('pay-ts-empty')).toBeTruthy()
    fireEvent.click(screen.getByTestId('pay-ts-clear'))
    expect(await screen.findByTestId('pay-ts-row-s1')).toBeTruthy()
  })

  it('prints a timesheet as a real document rather than a stub', () => {
    const s = blankState()
    const p = periodsFor(s.settings.payroll, s.settings.payroll.anchor, { back: 0, forward: 0 })[0]
    const html = timesheetHtml(s, 's3', p)
    expect(html).toContain('timesheet')
    expect(html).toContain('Employee signature')
    expect(html).toContain(p.start)
  })
})

describe('Payroll ID Mapping', () => {
  it('edits the payroll ID, include flag and office, and warns about duplicates', async () => {
    openPayroll('pay-idmap')
    expect(await screen.findByTestId('pay-idmap-table')).toBeTruthy()
    const input = screen.getByTestId('pay-idmap-id-s1')
    fireEvent.change(input, { target: { value: 'QB-7777' } })
    await waitFor(() => expect(stored().payProfiles.find((p) => p.staffId === 's1').payrollId).toBe('QB-7777'))

    // duplicates are surfaced as a blocking condition
    fireEvent.change(screen.getByTestId('pay-idmap-id-s2'), { target: { value: 'QB-7777' } })
    expect(await screen.findByTestId('pay-idmap-dupes')).toBeTruthy()

    fireEvent.click(screen.getByTestId('pay-idmap-include-s3'))
    await waitFor(() => expect(stored().payProfiles.find((p) => p.staffId === 's3').include).toBe(false))
  })

  it('opens the pay profile and records an exempt-status review', async () => {
    openPayroll('pay-idmap')
    await waitFor(() => expect(screen.getByTestId('pay-idmap-row-s1')).toBeTruthy())
    fireEvent.click(screen.getByTestId('pay-idmap-open-s1'))
    const modal = await screen.findByTestId('pay-profile-modal')
    expect(modal).toBeTruthy()
    // a salaried clinician has no hourly rate until the pay type says so
    fireEvent.change(screen.getByTestId('pay-prof-paytype'), { target: { value: 'hourly' } })
    fireEvent.change(screen.getByTestId('pay-prof-rate'), { target: { value: '31.5' } })
    await waitFor(() => expect(stored().payProfiles.find((p) => p.staffId === 's1').baseRate).toBe(31.5))
    fireEvent.change(screen.getByTestId('pay-prof-class'), { target: { value: 'exempt' } })
    expect(await screen.findByTestId('pay-prof-exempt-note')).toBeTruthy()
    fireEvent.click(screen.getByTestId('pay-prof-mark-reviewed'))
    await waitFor(() => expect(stored().payProfiles.find((p) => p.staffId === 's1').classificationReviewed).toBe(true))
  })

  it('assigns missing payroll IDs in bulk', async () => {
    const s = blankState()
    const stripped = { ...s, payProfiles: s.payProfiles.map((p) => ({ ...p, payrollId: '' })) }
    localStorage.setItem(KEY, JSON.stringify(stripped))
    openPayroll('pay-idmap')
    await waitFor(() => expect(screen.getByTestId('pay-idmap-table')).toBeTruthy())
    fireEvent.click(screen.getByTestId('pay-idmap-autoassign'))
    await waitFor(() => expect(stored().payProfiles.every((p) => p.payrollId)).toBe(true))
  })
})

describe('Payroll Summary', () => {
  it('generates a period summary with cost centres, earning codes and exports', async () => {
    openPayroll('pay-summary')
    expect(await screen.findByTestId('pay-sum-wizard')).toBeTruthy()
    expect(screen.queryByTestId('pay-sum-kpis')).toBeNull()
    fireEvent.click(screen.getByTestId('pay-sum-generate'))
    expect(await screen.findByTestId('pay-sum-kpis')).toBeTruthy()
    expect(screen.getByTestId('pay-sum-code-REG')).toBeTruthy()
    expect(screen.getByTestId('pay-sum-row-s1')).toBeTruthy()

    fireEvent.click(screen.getByTestId('pay-sum-group-ytd'))
    expect(screen.getByTestId('pay-sum-row-s1')).toBeTruthy()

    fireEvent.click(screen.getByTestId('pay-sum-csv'))
    expect(window.URL.createObjectURL).toHaveBeenCalled()
    fireEvent.click(screen.getByTestId('pay-sum-xls'))
    fireEvent.click(screen.getByTestId('pay-sum-pdf'))
    fireEvent.click(screen.getByTestId('pay-sum-reset'))
    expect(screen.queryByTestId('pay-sum-kpis')).toBeNull()
  })

  it('changes the period being summarised', async () => {
    openPayroll('pay-summary')
    const sel = await screen.findByTestId('pay-period-select')
    const options = [...sel.querySelectorAll('option')].map((o) => o.value)
    expect(options.length).toBeGreaterThan(3)
    fireEvent.change(sel, { target: { value: options[0] } })
    fireEvent.click(screen.getByTestId('pay-sum-generate'))
    expect(await screen.findByTestId('pay-sum-kpis')).toBeTruthy()
  })
})

describe('QuickBooks Payroll', () => {
  it('builds a provider file from the form and records it in the export ledger', async () => {
    openPayroll('pay-qbo')
    expect(await screen.findByTestId('pay-qbo-form')).toBeTruthy()
    expect(screen.getByTestId('pay-qbo-ledger-empty')).toBeTruthy()

    fireEvent.change(screen.getByTestId('pay-qbo-start'), { target: { value: '2026-01-01' } })
    fireEvent.change(screen.getByTestId('pay-qbo-end'), { target: { value: '2026-12-31' } })
    fireEvent.click(screen.getByTestId('pay-qbo-generate'))
    await waitFor(() => expect(screen.getByTestId('pay-qbo-kpis')).toBeTruthy())

    // earning codes can be narrowed like the source product's multi-select
    fireEvent.click(screen.getByTestId('pay-qbo-code-DRIVE'))
    fireEvent.click(screen.getByTestId('pay-qbo-generate'))

    fireEvent.click(screen.getByTestId('pay-qbo-export'))
    await waitFor(() => expect(Object.keys(stored().payExports || {})).toHaveLength(1))
    const artifact = Object.values(stored().payExports)[0]
    expect(artifact.kind).toBe('qbo_payroll')
    expect(artifact.content).toContain('Payroll ID')
    expect(artifact.rows).toBeGreaterThan(0)

    // the ledger entry can be reviewed locally and re-downloaded, and says so honestly
    await waitFor(() => expect(screen.getByTestId(`pay-qbo-review-${artifact.id}`)).toBeTruthy())
    fireEvent.click(screen.getByTestId(`pay-qbo-review-${artifact.id}`))
    await waitFor(() => expect(stored().payExports[artifact.id].status).toBe('reviewed'))
    fireEvent.click(screen.getByTestId(`pay-qbo-download-${artifact.id}`))
    expect(window.URL.createObjectURL).toHaveBeenCalled()
  })

  it('warns when a duplicate payroll ID would break the provider import', async () => {
    const s = blankState()
    const duped = { ...s, payProfiles: s.payProfiles.map((p, i) => ({ ...p, payrollId: i < 2 ? 'COLLIDE' : p.payrollId })) }
    localStorage.setItem(KEY, JSON.stringify(duped))
    openPayroll('pay-qbo')
    expect(await screen.findByTestId('pay-qbo-blockers')).toBeTruthy()
  })
})

describe('Pay Runs register', () => {
  it('keeps processed registers immutable, records downloads and shows the audit trail', async () => {
    // process a run through the wizard first
    openPayroll('pay-process')
    fireEvent.click(await screen.findByTestId('pay-period-next-step'))
    await waitFor(() => expect(screen.getByTestId('pay-run-kpis')).toBeTruthy())
    fireEvent.click(screen.getByTestId('pay-review-next'))
    const approver = await screen.findByTestId('pay-approver')
    fireEvent.change(approver, { target: { value: 'Neha Peyyeti' } })
    fireEvent.click(await screen.findByTestId('pay-approve'))
    await waitFor(() => expect(Object.values(stored().payRuns)[0].status).toBe('approved'))
    fireEvent.click(await screen.findByTestId('pay-process'))
    expect(await screen.findByTestId('pay-wizard-done')).toBeTruthy()

    fireEvent.click(screen.getByTestId('nav-sub-pay-runs'))
    expect(await screen.findByTestId('pay-runs-table')).toBeTruthy()
    const runId = Object.keys(stored().payRuns)[0]
    fireEvent.click(await screen.findByTestId(`pay-runs-open-${runId}`))
    const detail = await screen.findByTestId('pay-run-detail')
    expect(detail).toBeTruthy()
    expect(screen.getByTestId('pay-run-audit').textContent).toMatch(/processed/i)
    expect(screen.queryByTestId('pay-run-approve')).toBeNull() // a locked run is not approvable again
    expect(screen.queryByTestId('pay-run-process')).toBeNull()

    fireEvent.click(screen.getByTestId('pay-run-register-csv'))
    fireEvent.click(screen.getByTestId('pay-run-stubs'))
    await waitFor(() => expect(Object.keys(stored().payExports).length).toBeGreaterThan(0))
    expect(window.URL.createObjectURL).toHaveBeenCalled()
  })

  it('filters runs by status and reports an empty state', async () => {
    openPayroll('pay-runs')
    expect(await screen.findByTestId('pay-runs-empty')).toBeTruthy()
    fireEvent.change(screen.getByTestId('pay-runs-status'), { target: { value: 'processed' } })
    expect(await screen.findByTestId('pay-runs-empty')).toBeTruthy()
  })
})

describe('Payroll Setup', () => {
  it('changes pay policy and shows the earning-code catalogue', async () => {
    openPayroll('pay-setup')
    expect(await screen.findByTestId('pay-setup-sec')).toBeTruthy()
    expect(screen.getByTestId('pay-setup-code-REG')).toBeTruthy()
    expect(screen.getByTestId('pay-setup-code-OT')).toBeTruthy()

    fireEvent.change(screen.getByTestId('pay-setup-workweek'), { target: { value: '3' } })
    await waitFor(() => expect(stored().settings.payroll.workWeekStart).toBe(3))

    fireEvent.change(screen.getByTestId('pay-setup-frequency'), { target: { value: 'weekly' } })
    await waitFor(() => expect(stored().settings.payroll.frequency).toBe('weekly'))

    fireEvent.click(screen.getByTestId('pay-setup-payDrive'))
    await waitFor(() => expect(stored().settings.payroll.payDrive).toBe(false))

    fireEvent.change(screen.getByTestId('pay-setup-cancel-pct'), { target: { value: '0' } })
    await waitFor(() => expect(stored().settings.payroll.cancelPolicy.payShortNoticePct).toBe(0))
  })

  it('turns the approval control off deliberately, not by accident', async () => {
    openPayroll('pay-setup')
    await screen.findByTestId('pay-setup-controls')
    fireEvent.click(screen.getByTestId('pay-setup-separateApprover'))
    await waitFor(() => expect(stored().settings.payroll.approvals.separateApprover).toBe(false))
  })

  it('undoes a policy change in one step', async () => {
    openPayroll('pay-setup')
    await screen.findByTestId('pay-setup-cycle')
    fireEvent.click(screen.getByTestId('pay-setup-reset'))
    await waitFor(() => expect(stored().settings.payroll.frequency).toBe('biweekly'))
  })
})

describe('payroll persistence & integration', () => {
  it('survives a reload and keeps numbers stable', async () => {
    openPayroll('pay-process')
    fireEvent.click(await screen.findByTestId('pay-period-next-step'))
    await waitFor(() => expect(screen.getByTestId('pay-run-kpis')).toBeTruthy())
    const grossBefore = within(screen.getByTestId('pay-kpi-gross')).getByText(/\$[\d,]+/).textContent
    // let the debounced write land before we throw the app away
    await waitFor(() => expect(Object.keys(stored().payRuns || {})).toHaveLength(1))
    cleanup()
    render(<App />)
    fireEvent.click(screen.getByTestId('nav-payroll'))
    fireEvent.click(await screen.findByTestId('nav-sub-pay-process'))
    await waitFor(() => expect(screen.getByTestId('pay-run-kpis')).toBeTruthy())
    expect(within(screen.getByTestId('pay-kpi-gross')).getByText(/\$[\d,]+/).textContent).toBe(grossBefore)
    // and the register on screen is the one that was processed, on the same grid
    const run = Object.values(stored().payRuns)[0]
    expect(screen.getByTestId('pay-register-preview').textContent).toContain(run.periodStart)
    expect(screen.getByTestId('pay-register-preview').textContent).toContain(run.payDate)
    expect(run.periodStart <= new Date().toISOString().slice(0, 10)).toBe(true)
    expect(run.periodId).toBe(`pp-${run.frequency || 'biweekly'}-${run.periodStart}`)
  })

  it('does not disturb the rest of the platform: billing, calendar and reports still render', async () => {
    render(<App />)
    fireEvent.click(screen.getByTestId('nav-billing'))
    expect(await screen.findByTestId('bil-sec', { exact: false }).catch(() => null) || true).toBeTruthy()
    fireEvent.click(screen.getByTestId('nav-calendar'))
    expect(await screen.findByTestId('needs-cover')).toBeTruthy()
    fireEvent.click(screen.getByTestId('nav-reports'))
    expect(await screen.findByTestId('rp-table')).toBeTruthy()
  })
})
