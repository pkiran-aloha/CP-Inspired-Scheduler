import React from 'react'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import App from '../App'
import { blankState } from '../state/store'
import { suggestGfeRows, planGfe, gfePdf, periodWeeks, GFE_DISCLAIMER, GFE_SEPARATE_DISCLAIMER } from '../lib/gfe'
import { todayISO } from '../lib/date'

beforeEach(() => {
  localStorage.clear()
  window.URL.createObjectURL = vi.fn(() => 'blob:gfe-test')
  window.URL.revokeObjectURL = vi.fn()
})
afterEach(() => cleanup())

const BASE = blankState()
const CLIENT = BASE.clients[0]
const ROWS = [{ code: '97153', unitsPerWeek: 40, rate: 9 }, { code: '97155', unitsPerWeek: 4, rate: 44 }]

describe('Good Faith Estimate: the estimate', () => {
  it('covers 1 to 12 months and states the scope of each recurring service (45 CFR 149.610)', () => {
    expect(planGfe(BASE, CLIENT.id, { start: '2026-10-05', months: 13, rows: ROWS }).ok).toBe(false)
    expect(planGfe(BASE, CLIENT.id, { start: '2026-10-05', months: 6, rows: [] }).ok).toBe(false)
    expect(planGfe(BASE, CLIENT.id, { start: '2026-10-05', months: 6, rows: [{ code: '97153', unitsPerWeek: 4, rate: 9.555 }] }).ok).toBe(false)
    const est = planGfe(BASE, CLIENT.id, { start: '2026-10-05', months: 6, rows: ROWS })
    expect(est.ok).toBe(true)
    expect(est.weeks).toBe(periodWeeks('2026-10-05', 6))
    const tech = est.lines.find((l) => l.code === '97153')
    expect(tech.units).toBe(40 * est.weeks)
    expect(tech.total).toBe(40 * est.weeks * 9)
    expect(tech.scope).toMatch(/40 units a week \(about 10 hours\) for \d+ weeks/)
    expect(est.total).toBeCloseTo(est.lines.reduce((t, l) => t + l.total, 0))
  })

  it('carries every element the rule requires: patient, diagnosis, provider NPI / TIN / state, separately scheduled list', () => {
    const est = planGfe(BASE, CLIENT.id, { start: '2026-10-05', months: 3, rows: ROWS })
    expect(est.patient).toEqual({ name: CLIENT.name, dob: CLIENT.dob || '' })
    expect(est.diagnoses[0]).toBe('F84.0')
    expect(est.provider.npi).toMatch(/^\d{10}$/)
    expect(est.provider.tin).toBe(BASE.settings.org.taxId)
    expect(est.provider.state).toBe('CA')
    expect(est.separately).toMatch(/None expected/)
    expect(planGfe(BASE, CLIENT.id, { start: '2026-10-05', months: 3, rows: ROWS, separately: 'Reassessment in 6 months' }).separately).toBe('Reassessment in 6 months')
  })

  it("prints the CMS model notice disclaimer and the rule's own statements", () => {
    const all = GFE_DISCLAIMER.join(' ')
    for (const s of ['$400 or more', '120 calendar days', 'not a contract', '1-800-985-3059', 'will not adversely affect the quality', 'must be scheduled or requested separately', 'Keep a copy']) expect(all).toContain(s)
    expect(GFE_SEPARATE_DISCLAIMER).toMatch(/separate good faith estimates will be issued upon scheduling or upon request/)
    const raw = Buffer.from(gfePdf(planGfe(BASE, CLIENT.id, { start: '2026-10-05', months: 6, rows: ROWS })).output('arraybuffer')).toString('latin1')
    expect(raw.startsWith('%PDF-')).toBe(true)
    expect(raw).toContain('Good Faith Estimate for Health Care Items and Services')
  })

  it('suggests rows from the calendar as units per week per code', () => {
    const rows = suggestGfeRows(BASE, CLIENT.id, todayISO())
    rows.forEach((r) => { expect(r.unitsPerWeek).toBeGreaterThan(0); expect(r.rate).toBeGreaterThanOrEqual(0) })
  })
})

describe('Good Faith Estimate: client profile', () => {
  it('opens from the profile, totals live and downloads a PDF', async () => {
    localStorage.setItem('aloha-aba.v3', JSON.stringify({ ...BASE, history: [] }))
    render(<App />)
    fireEvent.click(screen.getByTestId('nav-clients'))
    fireEvent.click(screen.getByTestId('cli-mode-table'))
    await screen.findByTestId('clients-table')
    fireEvent.click(screen.getByTestId(`cli-open-${CLIENT.id}`))
    fireEvent.click(within(await screen.findByTestId('profile-modal')).getByTestId('pf-gfe'))
    const dlg = await screen.findByTestId('gfe-dialog')
    fireEvent.change(within(dlg).getByTestId('gfe-units-0'), { target: { value: '0' } })
    expect(within(dlg).getByTestId('gfe-error').textContent).toMatch(/units per week must be more than 0/)
    fireEvent.change(within(dlg).getByTestId('gfe-units-0'), { target: { value: '20' } })
    expect(within(dlg).getByTestId('gfe-total').textContent).toMatch(/^\$[\d,]+\.\d{2}$/)
    fireEvent.click(within(dlg).getByTestId('gfe-download'))
    await waitFor(() => expect(window.URL.createObjectURL).toHaveBeenCalledTimes(1)) // PDF engine loads async
    expect(window.URL.createObjectURL.mock.calls[0][0].type).toBe('application/pdf')
    expect(screen.queryByTestId('gfe-dialog')).toBeNull()
  })
})
