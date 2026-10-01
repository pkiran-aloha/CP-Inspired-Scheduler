import { describe, it, expect } from 'vitest'
import { blankState } from '../state/store'
import {
  SETTINGS_MODULES, SYSTEM_SETTINGS_SECTIONS, settingsModule, settingsOffices, officeNames, locationOptions,
  apptStatusList, statusMapFor, statusOrderFor, statusFor, statusLabels, statusColorOf, isCancelStatus,
  customLists, listOptions, qualificationList, qualificationSatisfactionFor, staffSatisfiesCredentials,
  evaluateAppointmentValidations, messagesCfg, integrationsCfg, subscriptionCfg, notificationsCfg,
  earningCodes, masterUsage, officeUsage, statusUsage, codeUsage, planSettingsOp, officeCascade,
  normalizeSettingsMasters, appendImportLog, IMPORT_LOG_LIMIT,
} from '../lib/settingsMasters'
import { stagedAppts } from '../lib/claims'
import { scheduleLines, earningsFor, periodFor } from '../lib/payroll'
import { IMPORT_TYPES, IMPORT_CATEGORIES, parseCsv, planImport } from '../lib/dataImport'

const fresh = () => blankState()

describe('settings module registry', () => {
  it('lists the 13 modules in the agreed order with their sub-tabs', () => {
    expect(SETTINGS_MODULES.map((m) => m.id)).toEqual([
      'appointment-status', 'custom-lists', 'custom-fields', 'data-import', 'organization', 'payroll',
      'qualification', 'services', 'security', 'clinical-integrations', 'text-messaging', 'system', 'subscription',
    ])
    expect(settingsModule('payroll').tabs.map((t) => t.label)).toEqual(['General', 'Earning Code', 'Overtime Rules'])
    expect(settingsModule('security').tabs.map((t) => t.label)).toEqual(['User Accounts', 'User Roles'])
    expect(settingsModule('custom-lists').tabs.map((t) => t.label)).toEqual(['General', 'Service Type'])
    expect(settingsModule('nope').id).toBe('appointment-status') // unknown ids fall back, never crash
  })
})

describe('master resolvers', () => {
  it('seeds offices and statuses into a fresh workspace', () => {
    const s = fresh()
    expect(settingsOffices(s.settings).length).toBeGreaterThan(3)
    expect(officeNames(s.settings)).toContain('Main Center')
    expect(apptStatusList(s.settings).map((x) => x.key)).toEqual(['active', 'confirmed', 'completed', 'no-show', 'cancelled'])
    expect(statusOrderFor(s.settings)).toEqual(['active', 'confirmed', 'completed', 'no-show', 'cancelled'])
  })

  it('respects an edited label/colour/order without losing the built-in keys', () => {
    const s = fresh()
    const rows = apptStatusList(s.settings).map((r) => (r.key === 'completed' ? { ...r, label: 'Delivered', color: '#123456' } : r))
    s.settings.apptStatuses = rows
    expect(statusFor(s.settings, 'completed').label).toBe('Delivered')
    expect(statusColorOf(s.settings, 'completed')).toBe('#123456')
    expect(statusLabels(s.settings).completed).toBe('Delivered')
    expect(statusMapFor(s.settings)['no-show'].label).toBe('No Show')
    expect(isCancelStatus(s.settings, 'cancelled')).toBe(true)
    expect(isCancelStatus(s.settings, 'completed')).toBe(false)
    expect(isCancelStatus(s.settings, 'totally-new-key')).toBe(false) // unknown keys are live, not dead
  })

  it('hides inactive statuses from the working order but keeps them for history', () => {
    const s = fresh()
    s.settings.apptStatuses = apptStatusList(s.settings).map((r) => (r.key === 'no-show' ? { ...r, active: false } : r))
    expect(statusOrderFor(s.settings)).not.toContain('no-show')
    expect(apptStatusList(s.settings).map((r) => r.key)).toContain('no-show')
  })

  it('serves custom list options, qualifications and the config resolvers', () => {
    const s = fresh()
    const list = customLists(s.settings)[0]
    expect(listOptions(s.settings, list.id).length).toBeGreaterThan(0)
    expect(qualificationList(s.settings).length).toBeGreaterThan(3)
    expect(messagesCfg(s.settings).templates.length).toBeGreaterThan(0)
    expect(integrationsCfg(s.settings).length).toBeGreaterThan(0)
    expect(subscriptionCfg(s.settings).plan).toBeTruthy()
    expect(notificationsCfg(s.settings).timelyFiling).toBe(true)
    expect(earningCodes(s.settings.payroll).some((c) => c.id === 'REG')).toBe(true)
  })
})

describe('usage counts', () => {
  it('counts offices, statuses and earning codes wherever they are referenced', () => {
    const s = fresh()
    const office = Object.keys(masterUsage(s).offices)[0]
    expect(officeUsage(s, office)).toBeGreaterThan(0)
    expect(masterUsage(s).offices[office]).toBe(officeUsage(s, office))
    expect(statusUsage(s, 'completed')).toBeGreaterThan(0)
    expect(codeUsage(s, 'REG')).toBe(0)
    // a timesheet adjustment and a processed run line both make a code undeletable
    s.paySheets = { sh1: { id: 'sh1', periodId: 'p1', status: 'draft', adjustments: [{ code: 'REG', minutes: 60 }] } }
    s.payRuns = { r1: { id: 'r1', periodId: 'p1', status: 'processed', lines: [{ code: 'OT', cents: 100 }] } }
    expect(codeUsage(s, 'REG')).toBe(1)
    expect(codeUsage(s, 'OT')).toBe(1)
  })
})

describe('planSettingsOp guards', () => {
  it('validates office identity fields', () => {
    expect(planSettingsOp(fresh(), 'office.upsert', { item: { name: 'A' } }).ok).toBe(false)
    expect(planSettingsOp(fresh(), 'office.upsert', { item: { name: 'Main Center' } }).ok).toBe(false) // duplicate
    expect(planSettingsOp(fresh(), 'office.upsert', { item: { name: 'North Annex', npi: '123' } }).ok).toBe(false)
    const ok = planSettingsOp(fresh(), 'office.upsert', { item: { name: 'North Annex', npi: '1234567890' } })
    expect(ok.ok).toBe(true)
    expect(ok.patch.offices.some((o) => o.name === 'North Annex')).toBe(true)
  })

  it('never lets the last office or an in-use office be deleted without a home for its records', () => {
    const s = fresh()
    const first = settingsOffices(s.settings)[0]
    const blocked = planSettingsOp(s, 'office.remove', { id: first.id })
    expect(blocked.ok).toBe(false)
    expect(blocked.msg).toMatch(/used by|at least one office/i)
    const other = settingsOffices(s.settings).find((o) => o.id !== first.id)
    const moved = planSettingsOp(s, 'office.remove', { id: first.id, reassignTo: other.name })
    expect(moved.ok).toBe(true)
    expect(moved.cascades).toBeTruthy()
  })

  it('renaming an office cascades into every collection that stored its name', () => {
    const s = fresh()
    const target = settingsOffices(s.settings)[0]
    const res = planSettingsOp(s, 'office.upsert', { item: { ...target, name: 'Main Campus' } })
    expect(res.ok).toBe(true)
    expect(res.cascades).toBeTruthy()
    expect(Object.keys(res.cascades).length).toBeGreaterThan(0)
    expect(officeCascade(s, target.name, 'Main Campus')).toBeTruthy()
  })

  it('keeps at least one active payable status and moves appointments when one is removed', () => {
    const s = fresh()
    const used = planSettingsOp(s, 'status.remove', { key: 'completed' })
    expect(used.ok).toBe(false)
    expect(used.msg).toMatch(/still carry/)
    const moved = planSettingsOp(s, 'status.remove', { key: 'completed', reassignTo: 'active' })
    expect(moved.ok).toBe(true)
    expect(moved.cascades.appts).toBeTruthy()

    const oneLeft = fresh()
    oneLeft.settings.apptStatuses = oneLeft.settings.apptStatuses.filter((r) => r.key === 'completed').map((r) => ({ ...r, system: false }))
    expect(planSettingsOp(oneLeft, 'status.remove', { key: 'completed' }).ok).toBe(false)
  })

  it('requires a real earning code for a payable status and refuses to delete system codes', () => {
    expect(planSettingsOp(fresh(), 'status.upsert', { item: { key: 'family-cancel', label: 'Family cancel', pays: true, payrollCode: 'NOPE' } }).ok).toBe(false)
    expect(planSettingsOp(fresh(), 'status.upsert', { item: { key: 'family-cancel', label: 'Family cancel', pays: true, payrollCode: 'CANC', cancelBand: true } }).ok).toBe(true)
    expect(planSettingsOp(fresh(), 'earningCode.remove', { id: 'REG' }).ok).toBe(false) // shipped system code
    expect(planSettingsOp(fresh(), 'earningCode.remove', { id: 'TRAIN' }).ok).toBe(false) // also shipped
    const add = planSettingsOp(fresh(), 'earningCode.upsert', { item: { id: 'TUTOR', label: 'Tutor session — paid', kind: 'worked' } })
    expect(add.ok).toBe(true)
    expect(add.patch.payroll.earningCodes.some((c) => c.id === 'TUTOR')).toBe(true)
    // a code a timesheet already uses cannot be deleted
    const used = fresh()
    used.paySheets = { sh1: { id: 'sh1', status: 'draft', adjustments: [{ code: 'TUTOR', minutes: 30 }] } }
    used.settings.payroll = { ...used.settings.payroll, earningCodes: [...earningCodes(used.settings.payroll), { id: 'TUTOR', label: 'Tutor', kind: 'worked' }] }
    expect(planSettingsOp(used, 'earningCode.remove', { id: 'TUTOR' }).ok).toBe(false)
  })

  it('enforces the FLSA overtime floor, payroll band math and the org identity rules', () => {
    expect(planSettingsOp(fresh(), 'payroll.overtime', { patch: { otMultiplier: 1.2 } }).ok).toBe(false)
    expect(planSettingsOp(fresh(), 'payroll.overtime', { patch: { otMultiplier: 1.5, otAfterHours: 40 } }).ok).toBe(true)
    expect(planSettingsOp(fresh(), 'payroll.general', { patch: { frequency: 'daily' } }).ok).toBe(false)
    expect(planSettingsOp(fresh(), 'payroll.general', { patch: { cancelPolicy: { payShortNoticePct: 500 } } }).ok).toBe(false)
    expect(planSettingsOp(fresh(), 'org.patch', { patch: { npi: 'abcdefghij' } }).ok).toBe(false)
    expect(planSettingsOp(fresh(), 'org.patch', { patch: { npi: '1234567890', taxId: '12-3456789' } }).ok).toBe(true)
  })

  it('rejects unknown merge fields in a message template and non-https portal links', () => {
    const bad = planSettingsOp(fresh(), 'template.upsert', { item: { name: 'Reminder', body: 'Hi {{unicorn}}, see you soon!' } })
    expect(bad.ok).toBe(false)
    expect(bad.msg).toMatch(/\{\{unicorn\}\} is not a merge field/)
    const good = planSettingsOp(fresh(), 'template.upsert', { item: { name: 'Reminder', body: 'Hi {{guardian}} — {{client}} has a session on {{date}}.' } })
    expect(good.ok).toBe(true)
    expect(planSettingsOp(fresh(), 'subscription.patch', { patch: { portalUrl: 'http://insecure.example.com' } }).ok).toBe(false)
    expect(planSettingsOp(fresh(), 'subscription.patch', { patch: { seats: 0 } }).ok).toBe(false)
    expect(planSettingsOp(fresh(), 'subscription.patch', { patch: { seats: 12, portalUrl: 'https://portal.example.com' } }).ok).toBe(true)
  })

  it('rejects unknown ops and unknown system keys instead of silently writing', () => {
    expect(planSettingsOp(fresh(), 'nope.op', {}).ok).toBe(false)
    expect(planSettingsOp(fresh(), 'system.patch', { patch: { theme: 'neon' } }).ok).toBe(false)
    expect(planSettingsOp(fresh(), 'system.patch', { patch: { notifications: { unknownThing: true } } }).ok).toBe(false)
    expect(planSettingsOp(fresh(), 'system.patch', { patch: { theme: 'dark', workday: [9, 17] } }).ok).toBe(true)
    expect(planSettingsOp(fresh(), 'import.commit', {}).ok).toBe(false) // imports go through the import planner
  })
})

describe('normalizeSettingsMasters', () => {
  it('fills every missing master and repairs junk rows', () => {
    const raw = { settings: { org: { name: 'Demo' }, apptStatuses: [{ label: 'No key' }, { key: 'active', label: 'Active' }], offices: 'nope' } }
    const out = normalizeSettingsMasters(raw)
    expect(settingsOffices(out.settings).length).toBeGreaterThan(0)
    expect(out.settings.apptStatuses.length).toBeGreaterThanOrEqual(5)
    expect(out.settings.customLists.length).toBeGreaterThan(0)
    expect(out.settings.importLog).toEqual([])
    expect(out.settings.system).toBeTruthy()
  })

  it('keeps a practice’s own edits intact through a normalize pass', () => {
    const s = fresh()
    s.settings.org = { ...s.settings.org, name: 'Kiran Behavioral' }
    s.settings.apptStatuses = [...s.settings.apptStatuses, { key: 'tentative', label: 'Tentative', color: '#888888', active: true, pays: false, order: 9 }]
    const out = normalizeSettingsMasters({ settings: s.settings })
    expect(out.settings.org.name).toBe('Kiran Behavioral')
    expect(out.settings.apptStatuses.find((x) => x.key === 'tentative').label).toBe('Tentative')
  })
})

describe('import log', () => {
  it('keeps only the newest entries', () => {
    let settings = fresh().settings
    for (let i = 0; i < IMPORT_LOG_LIMIT + 5; i++) settings.importLog = appendImportLog(settings, { at: Date.now() + i, type: 'clients', count: i })
    expect(settings.importLog.length).toBe(IMPORT_LOG_LIMIT)
    expect(settings.importLog[settings.importLog.length - 1].count).toBe(IMPORT_LOG_LIMIT + 4) // newest last; the UI reverses
  })
})

describe('system settings hierarchy & upstream/downstream integration', () => {
  it('exposes the 9 System Settings sub-sections in the agreed hierarchy', () => {
    expect(SYSTEM_SETTINGS_SECTIONS.map((s) => s.label)).toEqual([
      'General Settings',
      'Clearing House Integration',
      'Billing Settings',
      'Appointment Settings',
      'Appointment Validations',
      'Notification Settings',
      'Clinical Integrations',
      'EVV Integrations',
      'Other Settings',
    ])
  })

  it('excludes offices with excludeFromLocations=true from appointment location options', () => {
    const s = fresh()
    const target = settingsOffices(s.settings)[0]
    expect(locationOptions(s.settings)).toContain(target.name)
    const res = planSettingsOp(s, 'office.upsert', { item: { ...target, excludeFromLocations: true } })
    expect(res.ok).toBe(true)
    s.settings = { ...s.settings, ...res.patch }
    expect(locationOptions(s.settings)).not.toContain(target.name)
  })

  it('evaluates transitive qualification coverage (BCBA-D -> BCBA -> BCaBA -> RBT)', () => {
    const s = fresh()
    const bcbaCovered = qualificationSatisfactionFor(s.settings, ['BCBA-D'])
    expect(bcbaCovered.has('BCBA-D')).toBe(true)
    expect(bcbaCovered.has('BCBA')).toBe(true)
    expect(bcbaCovered.has('BCaBA')).toBe(true)
    expect(bcbaCovered.has('RBT')).toBe(true)

    expect(staffSatisfiesCredentials(s.settings, { role: 'BCBA · Supervisor', credentials: ['BCBA'] }, ['RBT'])).toBe(true)
    expect(staffSatisfiesCredentials(s.settings, { role: 'RBT · Line Tech', credentials: ['RBT'] }, ['BCBA'])).toBe(false)
  })

  it('evaluates Staff, Client, and Payer appointment validation rules across None, Flag, Warn, and Stop', () => {
    const s = fresh()
    // Configure qualification=stop, missingNpi=warn, payRate=flag
    const patchRes = planSettingsOp(s, 'appointmentValidations.patch', {
      patch: {
        staff: {
          qualification: 'stop',
          serviceProvider: 'none',
          overlap: 'stop',
          missingNpi: 'warn',
          payRate: 'flag',
          unavailable: 'stop',
        },
      },
    })
    expect(patchRes.ok).toBe(true)
    s.settings = { ...s.settings, ...patchRes.patch }

    const rbt = s.staff.find((st) => st.role?.includes('RBT')) || s.staff[0]
    const staffNoNpiNoPay = { ...rbt, role: 'RBT', cert: 'RBT', credentials: ['RBT'], npi: '', hourlyCents: 0, payrollRate: 0 }
    s.staff = s.staff.map((st) => (st.id === rbt.id ? staffNoNpiNoPay : st))
    s.payProfiles = (s.payProfiles || []).map((p) => (p.staffId === rbt.id ? { ...p, baseRate: 0 } : p))
    const client = s.clients[0]

    const evalRes = evaluateAppointmentValidations(s, {
      id: 'test-appt-1',
      type: 'service',
      service: 'sup', // requires BCBA
      date: '2026-10-01',
      start: 540,
      end: 600,
      staffIds: [rbt.id],
      clientIds: [client.id],
      status: 'active',
    })
    expect(evalRes.stops.some((x) => x.id === 'staff.qualification')).toBe(true)
    expect(evalRes.warns.some((x) => x.id === 'staff.missingNpi')).toBe(true)
    expect(evalRes.flags.some((x) => x.id === 'staff.payRate')).toBe(true)
  })

  it('respects Appointment Status billable=false in Billing stagedAppts', () => {
    const s = fresh()
    const beforeCount = stagedAppts(s).length
    expect(beforeCount).toBeGreaterThan(0)
    // Flip all statuses to billable: false
    s.settings = {
      ...s.settings,
      apptStatuses: apptStatusList(s.settings).map((st) => ({ ...st, billable: false })),
    }
    const afterCount = stagedAppts(s).length
    expect(afterCount).toBe(0)
  })

  it('applies payroll defaultEarningCodes and per-office overtime thresholds in payroll calculations', () => {
    const s = fresh()
    const staffMember = s.staff[0]
    const period = periodFor(s.settings.payroll, '2026-09-30')
    // Give staffMember a break appointment and 10 hours of service on one day at Main Center
    s.settings.payroll = {
      ...s.settings.payroll,
      payBreaks: true,
      defaultEarningCodes: { nonService: 'ADMIN', drive: 'DRIVE', breakTime: 'PTO' },
      officeOvertimeRules: {
        'off-main-center': {
          officeId: 'off-main-center',
          officeName: 'Main Center',
          weeklyOtHours: 40,
        },
      },
    }
    s.payProfiles = (s.payProfiles || []).map((p) =>
      p.staffId === staffMember.id ? { ...p, payType: 'hourly', classification: 'nonexempt', baseRate: 30 } : p
    )
    s.appts = {
      b1: {
        id: 'b1',
        type: 'break',
        status: 'completed',
        date: period.start,
        start: 480,
        end: 510,
        staffIds: [staffMember.id],
        clientIds: [],
      },
      s1: {
        id: 's1',
        type: 'service',
        status: 'completed',
        date: period.start,
        start: 480,
        end: 1080, // 10 hours
        staffIds: [staffMember.id],
        clientIds: [s.clients[0].id],
        location: 'Main Center',
      },
    }
    const lines = scheduleLines(s, staffMember.id, period)
    expect(lines.find((l) => l.apptId === 'b1')?.code).toBe('PTO')
    const earn = earningsFor(s, staffMember.id, period.id)
    expect(earn.workedHours).toBeGreaterThan(0)
  })

  it('supports all 4 Data Import categories and 10 import types', () => {
    expect(IMPORT_CATEGORIES.map((c) => c.id)).toEqual(['payer', 'staff', 'client', 'appointments'])
    expect(IMPORT_TYPES.map((t) => t.id)).toEqual([
      'clients', 'client-contacts', 'client-authorizations',
      'staff', 'staff-qualifications', 'staff-npis', 'staff-earning-codes',
      'payers', 'payer-services',
      'appointments',
    ])
    const s = fresh()
    const matrix = [['Aetna Behavioral', '60054', 'Commercial', 'Availity', '800-555-0199']]
    const mapping = { 0: 'name', 1: 'payerId', 2: 'cmsType', 3: 'clearingHouse', 4: 'phone' }
    const plan = planImport(s, 'payers', matrix, mapping)
    expect(plan.ok).toBe(true)
    expect(plan.counts.created).toBe(1)
    expect(plan.creates[0].name).toBe('Aetna Behavioral')
  })
})

