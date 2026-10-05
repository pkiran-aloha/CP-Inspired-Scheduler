import React from 'react'
import { beforeEach, afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import App from '../App'
import { blankState } from '../state/store'
import { lineModifiers, posFor } from '../lib/claims'
import { posFor as cmsPosFor } from '../lib/cms1500'

const KEY = 'aloha-aba.v3'
const saved = () => JSON.parse(localStorage.getItem(KEY))
beforeEach(() => { localStorage.clear(); cleanup() })
afterEach(() => cleanup())

const BASE = blankState()
const rbt = BASE.staff.find((s) => /RBT/.test(s.role))
const bcba = BASE.staff.find((s) => /^BCBA/.test(s.role))
const appt = (o = {}) => ({ id: 'x', staffIds: [rbt.id], location: 'Clinic', ...o })
const withRules = (name, rules) => ({ ...BASE, payers: BASE.payers.map((p) => (p.name === name ? { ...p, rules: { ...(p.rules || {}), ...rules } } : p)) })

describe('claim line modifiers', () => {
  it('Medicaid norm: the rendering provider credential, then the qualification modifier, none on self-pay', () => {
    // the RBT is seeded with a bachelor's degree, so the payer's default Bachelor's row adds HN
    expect(lineModifiers(BASE, appt(), 'Blue Shield CA', 'insurance')).toBe('HM HN')
    // the BCBA's master's row carries HO — the same code as the credential, so it collapses
    expect(lineModifiers(BASE, appt({ staffIds: [bcba.id] }), 'Blue Shield CA', 'insurance')).toBe('HO')
    expect(lineModifiers(BASE, appt(), 'Self-pay', 'selfpay')).toBe('')
  })

  it("the payer's service modifier leads, its POS modifier follows, and the credential can be turned off", () => {
    expect(lineModifiers(BASE, appt({ service: 'dtt' }), 'Aetna', 'insurance')).toBe('U6 HM HN') // seeded Aetna dtt override
    const st = withRules('Blue Shield CA', { claims: { flags: { credentialMods: false } }, posMods: [{ pos: '10', mod: '95' }] })
    // the credential modifier is off, but the payer's qualification rows still apply
    expect(lineModifiers(st, appt(), 'Blue Shield CA', 'insurance')).toBe('HN')
    expect(lineModifiers(st, appt({ location: 'Telehealth (video)' }), 'Blue Shield CA', 'insurance')).toBe('HN 95')
  })

  it('a staff member with no education level gets no qualification modifier', () => {
    const st = { ...BASE, staff: BASE.staff.map((s) => (s.id === rbt.id ? { ...s, education: '' } : s)) }
    expect(lineModifiers(st, appt(), 'Blue Shield CA', 'insurance')).toBe('HM')
  })

  it('assembled demo claims carry modifiers; POS uses CMS codes (community = 99)', () => {
    const lines = Object.values(BASE.claims).filter((c) => c.mode === 'insurance').flatMap((c) => c.lines.filter((l) => l.kind === 'session'))
    expect(lines.length).toBeGreaterThan(0)
    expect(lines.some((l) => /^(HO|HN|HM|HP)\b/.test(l.mod))).toBe(true)
    expect(posFor({ location: 'Community outing' })).toBe('99')
    expect(cmsPosFor).toBe(posFor)
  })
})

describe('Claims Settings: credential modifier switch', () => {
  it('defaults on and persists when turned off', async () => {
    localStorage.setItem(KEY, JSON.stringify(BASE))
    render(<App />)
    fireEvent.click(screen.getByTestId('nav-collapse'))
    fireEvent.click(screen.getByTestId('nav-masters'))
    const tabPayers = screen.queryByTestId('masters-tab-payers')
    if (tabPayers) fireEvent.click(tabPayers)
    fireEvent.click(await screen.findByTestId('py-row-py-blue-shield-ca'))
    fireEvent.click(await screen.findByTestId('pd-tab-rules'))
    fireEvent.click(await screen.findByTestId('pr-tab-claims'))
    const box = await screen.findByTestId('clm-flag-credentialMods')
    expect(box.checked).toBe(true)
    fireEvent.click(box)
    fireEvent.click(screen.getByTestId('pr-save'))
    await waitFor(() => expect(saved().payers.find((p) => p.id === 'py-blue-shield-ca').rules.claims.flags.credentialMods).toBe(false))
  })
})
