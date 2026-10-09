import { describe, it, expect, beforeEach } from 'vitest'
import { migrateEmDashData, migrateEmDashString } from '../lib/emDashMigration'
import { reducer, blankState, initial, STORAGE_KEY } from '../state/store'
import { workspaceData } from '../lib/workspaceBackup'

const BASE = blankState()

// A workspace saved before the em dash clean-up: shipped values, seed titles and
// copies of them in records, as an older browser would hold them.
const oldShape = () => ({
  ...BASE,
  payers: BASE.payers.map((p, i) => (i === 0 ? { ...p, required: 'Yes — after authorization is on file' } : p)),
  referralSources: BASE.referralSources.map((r) => (r.id === 'rs-community' ? { ...r, name: 'Autism Society — South Bay chapter' } : r)),
  clients: BASE.clients.map((c, i) => (i === 0 ? { ...c, intakeSourceLabel: 'Valley Children’s Hospital — Neurodevelopment' } : c)),
  appts: {
    ...BASE.appts,
    'old-auto': { id: 'old-auto', type: 'service', date: '2026-01-05', start: 540, end: 600, title: 'Reyes, Ana — Direct therapy · 9–10 AM', status: 'active', staffIds: [], clientIds: [] },
    'old-pto': { id: 'old-pto', type: 'unavailable', date: '2026-01-05', start: 540, end: 600, title: 'PTO — family trip', status: 'active', staffIds: [], clientIds: [] },
    'old-drive': { id: 'old-drive', type: 'drive', date: '2026-01-05', start: 520, end: 540, title: 'Drive to session — Ana', status: 'active', staffIds: [], clientIds: [] },
    'user-typed': { id: 'user-typed', type: 'service', date: '2026-01-05', start: 540, end: 600, title: 'Parent meeting — bring the IEP', status: 'active', staffIds: [], clientIds: [] },
  },
  claims: { old: { id: 'old', history: [{ at: 1, ev: 'Denied — CO-197 no authorization' }, { at: 2, ev: 'Payment posted — $120 via CHK-1' }] } },
  settings: {
    ...BASE.settings,
    customLists: BASE.settings.customLists.map((l) => (l.id === 'modifiers' ? { ...l, options: l.options.map((o, i) => (i === 0 ? { ...o, label: 'HM — group' } : o)) } : l)),
    payroll: {
      ...BASE.settings.payroll,
      earningCodes: BASE.settings.payroll.earningCodes.map((c) => (c.id === 'REG' ? { ...c, label: 'Regular — direct treatment' } : c)),
      glAccounts: { ...BASE.settings.payroll.glAccounts, wages: '6100 Payroll — clinical wages' },
    },
    importLog: [{ at: 1, msg: 'Imported “HM — group”' }],
  },
  payProfiles: BASE.payProfiles.map((p, i) => (i === 0 ? { ...p, workerCompClass: '8834 — Home health / therapy' } : p)),
  intakeRequests: { r1: { id: 'r1', priority: 'Urgent — start within 2 weeks' } },
})

describe('em dash data migration', () => {
  it('rewrites every stored old value to its plain-separator version', () => {
    const next = migrateEmDashData(oldShape())
    expect(next.payers[0].required).toBe('Yes, after authorization is on file')
    expect(next.referralSources.find((r) => r.id === 'rs-community').name).toBe('Autism Society (South Bay chapter)')
    expect(next.clients[0].intakeSourceLabel).toBe('Valley Children’s Hospital (Neurodevelopment)')
    expect(next.appts['old-auto'].title).toBe('Reyes, Ana · Direct therapy · 9–10 AM')
    expect(next.appts['old-pto'].title).toBe('PTO: family trip')
    expect(next.appts['old-drive'].title).toBe('Drive to session · Ana')
    expect(next.appts['user-typed'].title).toBe('Parent meeting — bring the IEP') // not an auto-title shape
    expect(next.claims.old.history.map((h) => h.ev)).toEqual(['Denied: CO-197 no authorization', 'Payment posted: $120 via CHK-1'])
    expect(next.settings.customLists.find((l) => l.id === 'modifiers').options[0].label).toBe('HM: group')
    expect(next.settings.payroll.earningCodes.find((c) => c.id === 'REG').label).toBe('Regular (direct treatment)')
    expect(next.settings.payroll.glAccounts.wages).toBe('6100 Payroll (clinical wages)')
    expect(next.settings.importLog[0].msg).toBe('Imported “HM — group”') // audit trail kept as recorded
    expect(next.payProfiles[0].workerCompClass).toBe('8834: Home health / therapy')
    expect(next.intakeRequests.r1.priority).toBe('Urgent: start within 2 weeks')
    expect(migrateEmDashString('Workers\' comp (8810 — Clerical)')).toBe('Workers\' comp (8810: Clerical)')
  })

  it('is idempotent and returns the same object when nothing changes', () => {
    const once = migrateEmDashData(oldShape())
    expect(migrateEmDashData(once)).toBe(once)
    expect(migrateEmDashData(BASE)).toBe(BASE) // a fresh workspace already carries the new values
  })

  it('an old backup imports with the new values (restore runs the workspace migration)', () => {
    const restored = reducer(BASE, { type: 'replace', payload: workspaceData({ ...oldShape(), claims: BASE.claims, intakeRequests: BASE.intakeRequests }) })
    expect(restored.payers[0].required).toBe('Yes, after authorization is on file')
    expect(restored.appts['old-auto'].title).toBe('Reyes, Ana · Direct therapy · 9–10 AM')
  })

  describe('a saved workspace in an older browser', () => {
    beforeEach(() => localStorage.clear())
    it('loads with the new values', () => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(oldShape()))
      const st = initial()
      expect(st.settings.customLists.find((l) => l.id === 'modifiers').options[0].label).toBe('HM: group')
      expect(st.referralSources.find((r) => r.id === 'rs-community').name).toBe('Autism Society (South Bay chapter)')
      expect(JSON.parse(localStorage.getItem(STORAGE_KEY)).payers[0].required).toBe('Yes, after authorization is on file')
    })
  })
})
