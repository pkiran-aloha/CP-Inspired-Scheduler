import React from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import App from '../App'
import { blankState, serializeForStorage, STORAGE_KEY } from '../state/store'
import { SECURITY_AREAS } from '../lib/security'

beforeEach(() => localStorage.clear())
afterEach(() => cleanup())

describe('Security workspace UI', () => {
  it('opens the accounts/roles workspace and validates a least-privilege role before saving', async () => {
    render(<App />)
    // Security now lives inside Settings → Security (User Accounts / User Roles).
    fireEvent.click(screen.getByTestId('nav-settings'))
    fireEvent.click(await screen.findByTestId('set-mod-security'))
    expect(await screen.findByTestId('security-page')).toBeTruthy()
    expect(screen.getByTestId('security-demo-warning').textContent).toContain('not authentication')
    expect(screen.getByTestId('security-account-row-account-demo-admin')).toBeTruthy()
    expect(screen.getByTestId('security-account-row-account-s1').textContent).toContain('Prateek Kiran')

    fireEvent.click(screen.getByTestId('set-sub-roles'))
    expect(screen.getByTestId('security-permission-matrix')).toBeTruthy()
    fireEvent.click(screen.getByTestId('security-add-role'))
    expect(screen.getByTestId('security-role-editor').textContent).toContain('Create a role')
    expect(screen.getByTestId('security-role-name').value).toBe('')
    fireEvent.click(screen.getByTestId('security-role-save'))
    expect((await screen.findByTestId('security-role-error')).textContent).toContain('at least 2 characters')

    fireEvent.change(screen.getByTestId('security-role-name'), { target: { value: 'Care Coordinator' } })
    fireEvent.change(screen.getByTestId('security-role-description'), { target: { value: 'Referral intake and client coordination.' } })
    // New roles start with no access; explicitly grant only Intake view.
    fireEvent.click(screen.getByTestId('security-perm-intake-view'))
    fireEvent.click(screen.getByTestId('security-role-save'))
    expect((await screen.findAllByText('Care Coordinator')).length).toBe(2)
    expect(screen.getByTestId('security-role-editor')).toBeTruthy()
    expect(screen.getByTestId('security-perm-intake-view').checked).toBe(true)

    fireEvent.click(screen.getByTestId('set-sub-accounts'))
    fireEvent.click(screen.getByTestId('security-add-account'))
    expect(screen.getByTestId('security-account-role').value).toBe('')
    fireEvent.change(screen.getByTestId('security-account-staff'), { target: { value: 's2' } })
    fireEvent.click(screen.getByTestId('security-account-save'))
    expect((await screen.findByTestId('security-account-error')).textContent).toMatch(/Choose an existing user role/)
    const careRole = [...screen.getByTestId('security-account-role').options].find((option) => option.textContent === 'Care Coordinator')
    fireEvent.change(screen.getByTestId('security-account-role'), { target: { value: careRole.value } })
    fireEvent.click(screen.getByTestId('security-office-main-center'))
    fireEvent.click(screen.getByTestId('security-account-save'))
    await waitFor(() => expect(screen.queryByTestId('security-account-save')).toBeNull())
    expect(screen.getByTestId('security-account-table').textContent).toContain('Neha Peyyeti')
    expect(screen.getByTestId('security-account-table').textContent).toContain('Care Coordinator')
    expect(SECURITY_AREAS.length).toBeGreaterThan(10)
  })

  it('renders Calendar as read-only, hiding create/edit/delete controls for a view-only role', async () => {
    const state = blankState()
    const clinician = state.security.roles.find((role) => role.id === 'clinician')
    clinician.permissions = Object.fromEntries(SECURITY_AREAS.map(({ id }) => [id, 'none']))
    clinician.permissions.calendar = 'view'
    state.security.currentUserId = 'account-s3'
    state.ui.section = 'calendar'
    localStorage.setItem(STORAGE_KEY, serializeForStorage(state))

    const { container } = render(<App />)
    await waitFor(() => expect(container.querySelector('.tgrid.readonly')).toBeTruthy())
    expect(screen.queryByRole('button', { name: /Appointment/ })).toBeNull()
    const chip = container.querySelector('.chip:not(.stack)')
    expect(chip).toBeTruthy()
    fireEvent.pointerDown(chip, { button: 0 })
    fireEvent.pointerUp(chip)
    expect(await screen.findByTestId('detail-card')).toBeTruthy()
    expect(screen.getByText('View only')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Edit/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Delete/ })).toBeNull()
  })

  it('reports a rejected out-of-scope provider write instead of showing false success', async () => {
    const state = blankState()
    state.security.currentUserId = 'account-s3'
    state.security.accounts = state.security.accounts.map((account) => account.id === 'account-s3'
      ? { ...account, roleId: 'billing-specialist' }
      : account)
    state.ui.section = 'bil-providers'
    localStorage.setItem(STORAGE_KEY, serializeForStorage(state))

    render(<App />)
    expect(await screen.findByTestId('pi-sec')).toBeTruthy()
    fireEvent.click(screen.getByTestId('pi-add'))
    fireEvent.change(screen.getByTestId('pi-f-name'), { target: { value: 'New Provider' } })
    fireEvent.change(screen.getByTestId('pi-f-npi'), { target: { value: '1234567890' } })
    fireEvent.click(screen.getByTestId('pi-save'))
    expect(await screen.findByText(/outside your assigned office scope/i)).toBeTruthy()
    expect(screen.getByTestId('pi-modal')).toBeTruthy()
  })

  it('keeps a preview-account switcher in the rail on a non-calendar route and redirects denied routes', async () => {
    const state = blankState()
    const clinician = state.security.roles.find((role) => role.id === 'clinician')
    clinician.permissions = Object.fromEntries(SECURITY_AREAS.map(({ id }) => [id, 'none']))
    clinician.permissions.payroll = 'full'
    clinician.permissions.payrollQbo = 'view'
    state.security.currentUserId = 'account-s3'
    state.ui.section = 'billing'
    localStorage.setItem(STORAGE_KEY, serializeForStorage(state))

    render(<App />)
    await waitFor(() => expect(screen.getAllByTestId('nav-payroll').length).toBeGreaterThan(0))
    expect(screen.queryByTestId('nav-billing')).toBeNull()
    expect(screen.getByTestId('nav-demo-preview')).toBeTruthy()
    expect(screen.queryByTestId('needs-cover')).toBeNull()

    const preview = screen.getByTestId('nav-demo-preview')
    fireEvent.click(within(preview).getByRole('button'))
    const switcher = screen.getByLabelText('Preview demo account from navigation')
    fireEvent.change(switcher, { target: { value: 'account-demo-admin' } })
    await waitFor(() => expect(within(preview).getByText('Admin')).toBeTruthy())
    expect(screen.getByTestId('nav-billing')).toBeTruthy()
  })
})
