import { beforeEach, describe, expect, it } from 'vitest'
import { blankState, initial, reducer, serializeForStorage } from '../state/store'
import { BACKUP_FORMAT, BACKUP_VERSION, createWorkspaceBackup, readWorkspaceBackup, workspaceData } from '../lib/workspaceBackup'

beforeEach(() => localStorage.clear())

const tinyAppointment = { id: 'backup-a', date: '2026-09-21', start: 540, end: 600, type: 'service', status: 'completed', clientIds: ['c1'], staffIds: ['s1'] }

function completeBackup(base = blankState()) {
  const claim = Object.values(base.claims)[0]
  return {
    ...base,
    appts: { 'backup-a': tinyAppointment }, claims: { [claim.id]: claim },
    payments: { testpay: { id: 'testpay', claimId: claim.id, amount: 11 } },
    invoices: { testinv: { id: 'testinv', no: 'INV-17' } },
    verificationForms: { testform: { id: 'testform', status: 'pending' } },
    eraImports: { testera: { id: 'testera', lines: [] } },
    billedFiles: { testfile: { id: 'testfile', fileName: '837p.txt', claimIds: [claim.id], content: 'test' } },
    qbo: { testqbo: { id: 'testqbo', invoiceNo: '4177' } },
    staff: [...base.staff, { id: 'staff-custom', name: 'Custom staff' }],
    clients: [...base.clients, { id: 'client-custom', name: 'Custom client', secondary: null }],
    teams: [...base.teams, { id: 'team-custom', staffIds: [], clientIds: [] }],
    payers: [...base.payers, { ...base.payers[0], id: 'payer-custom', name: 'Custom payer' }],
    svcs: [...base.svcs, { id: 'svc-custom', label: 'Custom service' }],
    customFields: [...base.customFields, { id: 'cf-custom', label: 'Custom answer', type: 'text' }],
    settings: { ...base.settings, billing: { ...base.settings.billing, invoiceSeq: 17 } },
    reports: { saved: [{ id: 'rep-custom', name: 'My report' }] },
    dash: { widgets: [], boards: [{ id: 'board-custom', name: 'My layout', widgets: [] }] },
    meta: { ...base.meta, customFlag: 'preserved' },
    history: [{ appts: { invalid: true } }],
    ui: { ...base.ui, section: 'billing' },
  }
}

describe('complete, versioned local workspace backup', () => {
  it('round-trips every durable collection, and excludes transient navigation and undo history', () => {
    const base = blankState()
    const source = completeBackup(base)
    const raw = JSON.parse(createWorkspaceBackup(source, '2026-09-27T12:00:00.000Z'))
    expect(raw.format).toBe(BACKUP_FORMAT)
    expect(raw.version).toBe(BACKUP_VERSION)
    expect(raw.exported).toBe('2026-09-27T12:00:00.000Z')
    expect(raw.data).not.toHaveProperty('history')
    expect(raw.data).not.toHaveProperty('ui')
    const { data, counts, legacy } = readWorkspaceBackup(JSON.stringify(raw), blankState())
    expect(legacy).toBe(false)
    expect(counts).toEqual({ appointments: 1, claims: 1, payments: 1 })
    expect(data).toEqual(workspaceData(source))

    const restored = reducer(base, { type: 'replace', payload: data })
    for (const key of Object.keys(data)) expect(restored[key]).toEqual(data[key])
    expect(restored.ui).toEqual(base.ui) // do not import an old date/selection
    expect(restored.history).toHaveLength(1)
    const undone = reducer(restored, { type: 'undo' })
    for (const key of Object.keys(data)) expect(undone[key]).toEqual(base[key])
  })

  it('imports actual old-format exports without mixing old claims with new payments or artifacts', () => {
    const base = blankState()
    const paid = Object.values(base.claims).find((c) => c.remittance)
    const v1 = {
      exported: '2026-09-25T10:00:00.000Z',
      appts: { 'backup-a': tinyAppointment }, claims: { [paid.id]: paid },
      staff: base.staff, clients: base.clients, teams: base.teams,
      settings: base.settings, reports: base.reports,
    }
    const { data, legacy, counts } = readWorkspaceBackup(JSON.stringify(v1), blankState())
    expect(legacy).toBe(true)
    expect(counts.payments).toBe(0)
    expect(data.billedFiles).toEqual({})
    expect(data.payers).toEqual(base.payers) // not part of the old export; demo defaults
    const current = completeBackup(base)
    const restored = reducer(current, { type: 'replace', payload: data })
    expect(restored.billedFiles).toEqual({}) // no ghosts from the old workspace
    expect(Object.keys(restored.payments)).toEqual([`pay-${paid.id}`]) // remittance migration
    expect(restored.payments[`pay-${paid.id}`].amount).toBe(paid.remittance.amount)
    expect(reducer(restored, { type: 'undo' }).billedFiles).toEqual(current.billedFiles)
  })

  it('rejects invalid / incomplete files rather than erasing a live workspace', () => {
    const base = blankState()
    const valid = JSON.parse(createWorkspaceBackup(base))
    expect(() => readWorkspaceBackup('{', base)).toThrow(/valid JSON/)
    expect(() => readWorkspaceBackup('{"appts":{}}', base)).toThrow(/Not an Aloha/)
    expect(() => readWorkspaceBackup({ ...valid, version: 99 }, base)).toThrow(/Unsupported backup version/)
    expect(() => readWorkspaceBackup({ ...valid, data: { ...valid.data, payments: [] } }, base)).toThrow(/invalid payments/)
    expect(() => readWorkspaceBackup({ ...valid, data: { ...valid.data, appts: { a: { id: 'wrong' } } } }, base)).toThrow(/invalid appts/)
    expect(() => readWorkspaceBackup({ ...valid, data: { ...valid.data, reports: {} } }, base)).toThrow(/invalid saved reports/)
    expect(() => readWorkspaceBackup({ ...valid, data: { ...valid.data, clients: null } }, base)).toThrow(/invalid clients/)
    expect(() => readWorkspaceBackup({ ...valid, data: { ...valid.data, claims: { broken: { id: 'broken', lines: [null] } } } }, base)).toThrow(/invalid claims/)
    expect(() => readWorkspaceBackup({ ...valid, data: { ...valid.data, payments: { bad: { id: 'bad', amount: 'oops' } } } }, base)).toThrow(/invalid financial/)
    expect(reducer(base, { type: 'replace', payload: { appts: {} } })).toBe(base)
  })
})

describe('undo and browser persistence', () => {
  it('never serializes snapshots, but retains all data and preserves new custom answers across reload', () => {
    const base = blankState()
    expect(base.meta.pcfCleared).toBe(true)
    expect(base.meta.legacyCustomCleared).toBe(true)
    const id = Object.keys(base.appts)[0]
    const saved = { ...base, appts: { ...base.appts, [id]: { ...base.appts[id], pcfs: { 'cf-custom': { label: 'Own answer', value: 'Yes' } }, custom: { own: 'saved' } } } }
    const withUndo = reducer(saved, { type: 'record', coll: 'invoices', item: { id: 'i1' } })
    expect(withUndo.history).toHaveLength(1)
    const disk = JSON.parse(serializeForStorage(withUndo))
    expect(disk.history).toEqual([])
    expect(disk.invoices.i1.id).toBe('i1')
    localStorage.setItem('aloha-aba.v3', serializeForStorage(withUndo))
    const reloaded = initial()
    expect(reloaded.appts[id].pcfs['cf-custom'].value).toBe('Yes')
    expect(reloaded.appts[id].custom.own).toBe('saved')
    expect(reloaded.history).toEqual([])
  })

  it('undoes one billing transaction across payments, files, documents and invoice sequence', () => {
    const base = blankState()
    const claim = Object.values(base.claims)[0]
    const tx = reducer(base, { type: 'claimsTx',
      claimUpserts: [{ ...claim, paid: 90 }],
      payments: { x: { id: 'x', amount: 90 } },
      billedFiles: { f: { id: 'f', content: 'claim' } },
      eraImports: { e: { id: 'e' } }, invoices: { i: { id: 'i' } },
      verificationForms: { v: { id: 'v' } }, qbo: { q: { id: 'q' } },
      billing: { invoiceSeq: 99 },
    })
    expect(tx.history).toHaveLength(1)
    expect(tx.settings.billing.invoiceSeq).toBe(99)
    const undone = reducer(tx, { type: 'undo' })
    for (const key of ['claims', 'payments', 'billedFiles', 'eraImports', 'invoices', 'verificationForms', 'qbo', 'settings']) expect(undone[key]).toEqual(base[key])
    // A separate setting edit after the claim transaction is not part of that Undo.
    const withTheme = reducer(tx, { type: 'setSettings', patch: { theme: 'dark', billing: { ...tx.settings.billing, strictAuth: true } } })
    const undoWithTheme = reducer(withTheme, { type: 'undo' })
    expect(undoWithTheme.settings.theme).toBe('dark')
    expect(undoWithTheme.settings.billing.strictAuth).toBe(true)
    expect(undoWithTheme.settings.billing.invoiceSeq).toBe(base.settings.billing.invoiceSeq)
  })

  it('clears/reseeds related ledgers atomically, and an Undo restores every collection', () => {
    const source = completeBackup()
    const cleared = reducer(source, { type: 'clearDemo' })
    for (const key of ['appts', 'claims', 'payments', 'invoices', 'verificationForms', 'eraImports', 'billedFiles', 'qbo']) expect(cleared[key]).toEqual({})
    expect(cleared.staff).toEqual(source.staff)
    const undoClear = reducer(cleared, { type: 'undo' })
    for (const key of ['appts', 'claims', 'payments', 'invoices', 'verificationForms', 'eraImports', 'billedFiles', 'qbo']) expect(undoClear[key]).toEqual(source[key])

    const reseeded = reducer(source, { type: 'reseed' })
    expect(Object.keys(reseeded.appts).length).toBeGreaterThan(300)
    for (const key of ['invoices', 'verificationForms', 'eraImports', 'billedFiles', 'qbo']) expect(reseeded[key]).toEqual({})
    for (const c of Object.values(reseeded.claims).filter((c) => c.remittance)) expect(reseeded.payments[`pay-${c.id}`]).toBeTruthy()
    expect(reducer(reseeded, { type: 'undo' }).billedFiles).toEqual(source.billedFiles)
  })

  it('a file resend creates one undoable send-count change without modifying content', () => {
    const base = blankState()
    const file = { id: 'f', sendCount: 1, content: 'important claim data' }
    const recorded = reducer(base, { type: 'record', coll: 'billedFiles', item: file })
    const sent = reducer(recorded, { type: 'record', coll: 'billedFiles', item: { ...file, sendCount: 2 } })
    expect(sent.billedFiles.f.sendCount).toBe(2)
    expect(reducer(sent, { type: 'undo' }).billedFiles.f).toEqual(file)
    expect(reducer(recorded, { type: 'undo' }).billedFiles.f).toBeUndefined()
  })
})
