import { normalizeVerificationForms, seedVerificationForms } from '../lib/verificationForms'
import React, { createContext, useContext, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { uid } from '../lib/model'
import { buildSeed, buildDemoClaims, seedFamilyShares, seedPayroll, seedIntake, STAFF, CLIENTS, TEAMS, PAYERS, SVCS, defaultSettings, CF_DEFS } from '../lib/seed'
import { blankIntake, intakeNo, nextStages, gateBlockers, stageDef, normalizeIntake, planConversion, LOST_REASONS } from '../lib/intake'
import { planSheet, planRun, newRun, defaultPayrollSettings, timesheet, computeRun, runGate, periodFromId, periodFor, sheetKey } from '../lib/payroll'
import { stagedAppts, planClaims, assembleClaims, claimGate, submitPatch, denyPatch, rebillPatch, releasePatch, dropLinePatch, denialOf, paymentsFromClaims, planPayerTerms, lineApptIds } from '../lib/claims'
import { todayISO } from '../lib/date'
import { normalizePayerCf, normalizeApptPcfs, normalizeLegacyCustom, normalizeBillingV2, normalizeBillingIds, normalizeStaffEducation, normalizeAppealedClaims } from '../lib/master'
import { countsAsAbaHours, normalizeAbaHours } from '../lib/abaHours'
import { normalizeAuthUnits, normalizeUnitNorms, seedAuthUnits } from '../lib/authUnits'
import { planHandoffSession } from '../lib/intakeHandoff'
import { planStatement, planStatementSent, planStatementVoid } from '../lib/statements'
import { planCabinetDoc, planCabinetArchive } from '../lib/cabinet'
import { seedRecords } from '../lib/demoRecords'
import { planPduEntry } from '../lib/credentials'
import { planTask, planTaskDone } from '../lib/tasks'
import { planMessage, readUpdates } from '../lib/messages'
import { planSettingsOp, normalizeSettingsMasters, appendImportLog, evaluateAppointmentValidations } from '../lib/settingsMasters'
import { planImport } from '../lib/dataImport'
import { DEFAULT_DASH, WIDGETS } from '../lib/dash'
import { WORKSPACE_FIELDS, workspaceData, validateWorkspaceData } from '../lib/workspaceBackup'
import { previewEra, planEraImport, planParkedEraPost } from '../lib/eraPosting'
import { planSecondaryFiling, planSecondarySkip, planSecondaryCancel, normalizeCobLedger } from '../lib/secondaryLedger'
import { planClaimPayment, planVoidClaimPayment, planUnappliedReceipt, planPatientReceipt, planRecoupment } from '../lib/paymentLedger'
import { accessLevel, applySecurityChange, authorizeAction, canAccess, canAccessRecord, currentAccount, currentRole, defaultSecurity, normalizeSecurity, scopeWorkspaceToAccount } from '../lib/security'
import { useToast } from '../ui/Toast'

const KEY = 'aloha-aba.v3'
import { apptAutoTitle, needsRework } from '../lib/apptName'
export const STORAGE_KEY = KEY
const LEGACY_KEYS = ['pulse-aba-scheduler.v2']

// Undo lives in memory for this tab. Persisting 25 copies of the 1,000+ session
// ledger fills browser storage and silently prevents later changes from saving.
export const serializeForStorage = (state) => JSON.stringify({ ...state, history: [] })
const normalizeWorkspace = (state) => {
  const normalized = normalizeStaffEducation(normalizeAppealedClaims(normalizeUnitNorms(normalizeAuthUnits(normalizeSettingsMasters(normalizeVerificationForms(normalizeIntake(normalizeCobLedger(normalizeBillingIds(normalizeBillingV2(normalizeLegacyCustom(normalizeApptPcfs(normalizeAbaHours(normalizePayerCf(state, uid))))))))))))))
  return { ...normalized, security: normalizeSecurity(normalized.security, normalized.staff) }
}

export function blankState() {
  const appts = buildSeed(todayISO())
  const settings = defaultSettings()
  const { claims: demoClaims, appts: apptsWithClaims } = buildDemoClaims(appts, CLIENTS, settings, todayISO())
  // chunk-41: seed secondary insurance on first two clients for the COB queue
  const clientsWithSec = CLIENTS.map((c, idx) => {
    if (idx === 0 && PAYERS[0]) return { ...c, secondary: { payerId: PAYERS[0].id, memberId: `SEC-${c.id.slice(0, 4).toUpperCase()}`, authNo: 'AUTH-S-0001', relation: 'secondary', since: '2026-01-01', until: null, note: 'Seeded secondary for COB testing' } }
    if (idx === 1 && PAYERS[2]) return { ...c, secondary: { payerId: PAYERS[2].id, memberId: `SEC-${c.id.slice(0, 4).toUpperCase()}`, authNo: 'AUTH-S-0002', relation: 'secondary', since: '2026-02-01', until: null, note: '' } }
    return { ...c, secondary: null }
  })
  const claims = seedFamilyShares(demoClaims, clientsWithSec)
  const seedPay = seedPayroll(STAFF, { payroll: settings.payroll })
  settings.payroll = { ...settings.payroll, anchor: seedPay.anchor }
  // Intake Manager: the pre-client pipeline. Converted demo requests hand their
  // clients back the upstream links (intake id / referral source) so attribution
  // survives every downstream module that reads a client row.
  const seedInt = seedIntake({ appts: apptsWithClaims, clients: clientsWithSec, staff: STAFF, payers: PAYERS, today: todayISO() })
  const clientsWithIntake = clientsWithSec.map((c) => (seedInt.clientPatches[c.id] ? { ...c, ...seedInt.clientPatches[c.id] } : c))
  // chunk-42: a fresh workspace carries the full settings masters (offices, appointment
  // statuses, custom lists, qualifications, messaging & integration records).
  const ws = normalizeSettingsMasters({
    appts: apptsWithClaims,
    claims,
    payments: paymentsFromClaims(Object.values(claims), { at: Date.now() }),
    invoices: {},
    statements: {},
    cabinet: {},
    pdus: {},
    tasks: {},
    messages: {},
    verificationForms: seedVerificationForms(clientsWithIntake, PAYERS),
    eraImports: {},
    billedFiles: {},
    qbo: {},
    // ---- intake manager: pre-client pipeline + the referral relationships it attributes to
    intakeRequests: seedInt.intakeRequests,
    referralSources: seedInt.referralSources,
    // ---- payroll: profiles (master data), timesheet decisions, pay runs, exports
    payProfiles: seedPay.profiles,
    paySheets: seedPay.sheets,
    payRuns: {},
    payExports: {},
    // Fresh workspaces already use opt-in custom fields. Only old saves without
    // these flags need the one-time cleanup migrations on their first load.
    meta: { verificationFormsSeeded: true, billingV2: true, billingV2Count: 0, billingV2Seen: true, pcfCleared: true, legacyCustomCleared: true, unitNorm15: true },
    staff: STAFF,
    // per-code authorization unit pools (the payer letter), seeded from each client's weekly hours
    clients: clientsWithIntake.map((c, i) => seedAuthUnits({ svcs: SVCS, appts: apptsWithClaims, clients: clientsWithIntake, payers: PAYERS, settings }, c, i)),
    payers: PAYERS,
    svcs: SVCS,
    customFields: CF_DEFS,
    teams: TEAMS,
    history: [],
    settings,
    security: defaultSecurity(STAFF),
    reports: { saved: [] },
    dash: { widgets: DEFAULT_DASH.map((w) => ({ ...w, cfg: { ...w.cfg } })) },
    ui: {
      section: 'calendar',
      mastersTab: 'payers',
      payerSel: null,
      nav: null, // null = context-adaptive: icon rail on the calendar board, expanded elsewhere
      sb: null, // null = auto-hide filter sidebar on narrow viewports
      view: 'week',
      anchor: todayISO(),
      sidebarTab: 'staff',
      search: '',
      staffSel: [],
      clientSel: [],
      teamSel: [],
      filters: { statuses: ['active', 'confirmed', 'completed', 'no-show', 'cancelled'], abaOnly: false },
      settingsModule: 'organization', // Settings sidebar: which module is open
      settingsSub: null, // … and which sub-tab inside it
    },
  })
  // Demo Cabinet documents, CEU log, tasks and messages, built against the finished workspace.
  return { ...ws, ...seedRecords(ws, todayISO()) }
}

export function initial() {
  const base = blankState()
  try {
    let raw = localStorage.getItem(KEY)
    let legacyKey = null
    if (!raw) for (const k of LEGACY_KEYS) {
      const legacy = localStorage.getItem(k)
      if (legacy) { raw = legacy; legacyKey = k; break }
    }
    if (raw) {
      const saved = JSON.parse(raw)
      if (saved && saved.appts) {
        // merge every sub-object against defaults so older saves keep working as the schema grows
        const d = defaultSettings()
        // Older saves predate payroll: seed profiles + an approval queue from the
        // roster they carry, so the module opens usable rather than blank.
        const seededPay = seedPayroll(
          Array.isArray(saved.staff) && saved.staff.length ? saved.staff : STAFF,
          { payroll: { ...d.payroll, ...(saved.settings?.payroll || {}) } },
        )
        const mergedRaw = {
          ...base,
          ...saved,
          meta: saved.meta || {},
          claims: saved.claims || base.claims,
          svcs: Array.isArray(saved.svcs) && saved.svcs.length ? saved.svcs : base.svcs,
          customFields: Array.isArray(saved.customFields) ? saved.customFields : base.customFields,
          history: [], // older persisted undo stacks are dropped; undo is tab-local
          reports: { saved: (saved.reports && saved.reports.saved) || [] },
          payments: saved.payments || {},
          invoices: saved.invoices || {},
          statements: saved.statements || {},
          cabinet: saved.cabinet || {},
          pdus: saved.pdus || {},
          tasks: saved.tasks || {},
          messages: saved.messages || {},
          verificationForms: saved.verificationForms || {},
          eraImports: saved.eraImports || {},
          billedFiles: saved.billedFiles || {},
          qbo: saved.qbo || {},
          // Intake Manager is new in this round: workspaces saved before it exist
          // still open with the seeded demo pipeline rather than an empty module.
          intakeRequests: saved.intakeRequests || base.intakeRequests,
          referralSources: Array.isArray(saved.referralSources) && saved.referralSources.length ? saved.referralSources : base.referralSources,
          payProfiles: Array.isArray(saved.payProfiles) && saved.payProfiles.length ? saved.payProfiles : seededPay.profiles,
          paySheets: saved.paySheets || seededPay.sheets,
          payRuns: saved.payRuns || {},
          payExports: saved.payExports || {},
          settings: { ...d, ...(saved.settings || {}), smart: saved.settings?.smart || d.smart, org: { ...d.org, ...(saved.settings?.org || {}) }, billing: { ...d.billing, ...(saved.settings?.billing || {}) }, analytics: { ...d.analytics, ...(saved.settings?.analytics || {}) }, payroll: { ...d.payroll, ...(saved.settings?.payroll || {}), taxes: { ...d.payroll.taxes, ...(saved.settings?.payroll?.taxes || {}) }, cancelPolicy: { ...d.payroll.cancelPolicy, ...(saved.settings?.payroll?.cancelPolicy || {}) }, approvals: { ...d.payroll.approvals, ...(saved.settings?.payroll?.approvals || {}) }, rounding: { ...d.payroll.rounding, ...(saved.settings?.payroll?.rounding || {}) } } },
          ui: { ...base.ui, ...(saved.ui || {}), filters: { ...base.ui.filters, ...(saved.ui?.filters || {}) }, section: (saved.ui?.section || 'calendar') === 'payers' ? 'masters' : saved.ui?.section || 'calendar' },
        }
        // chunk-37: master-only migration for legacy custom-field entries — if anything was
        // promoted or dropped, write the fixed snapshot back immediately so the repair is durable
        // chunk-38: one-time clear of pre-loaded appointment pcfs (flagged in meta, idempotent)
        const merged = normalizeWorkspace(mergedRaw)
        if (merged !== mergedRaw || legacyKey || saved.history?.length) {
          try {
            localStorage.setItem(KEY, serializeForStorage(merged))
            if (legacyKey) localStorage.removeItem(legacyKey) // only retire it after a successful write
          } catch { /* keep the old save; the provider warns if writes still fail */ }
        }
        return merged
      }
    }
  } catch (e) {
    console.warn('Could not read saved state', e)
  }
  return base
}

export function reducer(state, action) {
  switch (action.type) {
    case 'upsertMany': {
      const appts = { ...state.appts }
      for (const a of action.appts) appts[a.id] = { ...appts[a.id], ...a }
      return { ...state, appts, history: pushSnap(state, ['appts']) }
    }
    case 'patch': {
      const cur = state.appts[action.id]
      if (!cur) return state
      return { ...state, appts: { ...state.appts, [action.id]: { ...cur, ...action.patch, updatedAt: Date.now() } }, history: action.noSnap ? state.history : pushSnap(state, ['appts']) }
    }
    case 'deleteMany': {
      const appts = { ...state.appts }
      for (const id of action.ids) delete appts[id]
      return { ...state, appts, history: pushSnap(state, ['appts']) }
    }
    case 'undo': {
      const hist = [...state.history]
      const snap = hist.pop()
      if (!snap) return state
      // New snapshots touch only the collections changed by their transaction.
      // Unrelated edits made since then (e.g. a theme setting) are not undone.
      if (snap.__workspaceSnapshot) return {
        ...state,
        ...Object.fromEntries(WORKSPACE_FIELDS.filter((key) => key in snap).map((key) => [key, snap[key]])),
        ...(Object.hasOwn(snap, 'billingSettings') ? { settings: { ...state.settings, billing: { ...state.settings.billing, ...snap.billingSettings } } } : {}),
        ...(Object.hasOwn(snap, 'payrollSettings') ? { settings: { ...state.settings, payroll: { ...state.settings.payroll, ...snap.payrollSettings } } } : {}),
        history: hist,
      }
      // Compatibility for pre-change snapshots kept in memory by an older bundle.
      if (!snap.appts) return { ...state, appts: snap, history: hist }
      return { ...state, ...Object.fromEntries(WORKSPACE_FIELDS.filter((key) => key in snap).map((key) => [key, snap[key]])), history: hist }
    }
    case 'secondaryFilingTx': {
      const tx = planSecondaryFiling(state, action.id, action.options)
      return tx.ok ? reducer(state, { type: 'claimsTx', claimUpserts: tx.claimUpserts }) : state
    }
    case 'secondarySkipTx': {
      const tx = planSecondarySkip(state, action.id, action.options)
      return tx.ok ? reducer(state, { type: 'claimsTx', claimUpserts: tx.claimUpserts }) : state
    }
    case 'secondaryCancelTx': {
      const tx = planSecondaryCancel(state, action.id, action.options)
      return tx.ok ? reducer(state, { type: 'claimsTx', claimUpserts: tx.claimUpserts }) : state
    }
    case 'claimPaymentTx': {
      const tx = planClaimPayment(state, action.id, action.payload, action.options)
      return tx.ok ? reducer(state, { type: 'claimsTx', claimUpserts: tx.claimUpserts, payments: tx.payments }) : state
    }
    case 'claimVoidPaymentTx': {
      const tx = planVoidClaimPayment(state, action.id, action.options)
      return tx.ok ? reducer(state, { type: 'claimsTx', claimUpserts: tx.claimUpserts, payments: tx.payments,
        ...(Object.keys(tx.invoices || {}).length ? { invoices: tx.invoices } : {}) }) : state
    }
    case 'claimRecoupTx': {
      const tx = planRecoupment(state, action.id, action.payload, action.options)
      return tx.ok ? reducer(state, { type: 'claimsTx', claimUpserts: tx.claimUpserts, payments: tx.payments,
        ...(Object.keys(tx.invoices || {}).length ? { invoices: tx.invoices } : {}) }) : state
    }
    case 'patientReceiptTx': {
      const tx = planPatientReceipt(state, action.id, action.payload, action.options)
      return tx.ok ? reducer(state, { type: 'claimsTx', claimUpserts: tx.claimUpserts, payments: tx.payments,
        ...(Object.keys(tx.invoices).length ? { invoices: tx.invoices } : {}) }) : state
    }
    case 'unappliedPaymentTx': {
      const tx = planUnappliedReceipt(state, action.payload, action.options)
      return tx.ok ? reducer(state, { type: 'claimsTx', claimUpserts: [], payments: tx.payments }) : state
    }
    case 'eraImportTx': {
      // Re-plan inside the reducer: a preview/action can be stale by the time a
      // batched dispatch is applied (including double-clicks). Invalid retries
      // and duplicate files cannot write to the ledger.
      const tx = planEraImport(state, action.parsed, action.options)
      return tx.ok ? reducer(state, { type: 'claimsTx', claimUpserts: tx.claimUpserts,
        ...(Object.keys(tx.payments).length ? { payments: tx.payments } : {}), eraImports: tx.eraImports }) : state
    }
    case 'eraRetryTx': {
      const tx = planParkedEraPost(state, action.eraId, action.selectedIds, action.options)
      return tx.ok ? reducer(state, { type: 'claimsTx', claimUpserts: tx.claimUpserts,
        ...(Object.keys(tx.payments).length ? { payments: tx.payments } : {}), eraImports: tx.eraImports }) : state
    }
    case 'claimsTx': {
      const appts = { ...state.appts }
      for (const { id, patch } of action.apptPatches || []) if (appts[id]) appts[id] = { ...appts[id], ...patch, updatedAt: Date.now() }
      const claims = { ...state.claims }
      for (const c of action.claimUpserts || []) claims[c.id] = c
      for (const id of action.claimDel || []) delete claims[id]
      const payments = action.payments ? { ...(state.payments || {}), ...action.payments } : state.payments
      const invoices = action.invoices ? { ...(state.invoices || {}), ...action.invoices } : state.invoices
      const eraImports = action.eraImports ? { ...(state.eraImports || {}), ...action.eraImports } : state.eraImports
      const billedFiles = action.billedFiles ? { ...(state.billedFiles || {}), ...action.billedFiles } : state.billedFiles
      const qbo = action.qbo ? { ...(state.qbo || {}), ...action.qbo } : state.qbo
      const verificationForms = action.verificationForms ? { ...(state.verificationForms || {}), ...action.verificationForms } : state.verificationForms
      const settings = action.billing ? { ...state.settings, billing: { ...state.settings.billing, ...action.billing } } : state.settings
      const touched = [
        ...(action.apptPatches?.length ? ['appts'] : []),
        ...(action.claimUpserts?.length || action.claimDel?.length ? ['claims'] : []),
        ...['payments', 'invoices', 'eraImports', 'billedFiles', 'qbo', 'verificationForms'].filter((key) => action[key]),
        ...(action.billing ? ['billingSettings'] : []),
      ]
      return { ...state, appts, claims, payments, invoices, eraImports, billedFiles, qbo, verificationForms, settings, history: touched.length ? pushSnap(state, touched, action.billing) : state.history }
    }
    // ---- payroll: every money-affecting change is ONE undoable transaction ----
    case 'payrollTx': {
      const payroll = state.settings?.payroll
      const period = action.periodId ? periodFromId(payroll, action.periodId, { back: 24, forward: 12 }) : null
      const sheetsNext = { ...(state.paySheets || {}) }
      const runsNext = { ...(state.payRuns || {}) }
      const exportsNext = { ...(state.payExports || {}) }
      const settingsPatch = action.settings ? { payroll: { ...(payroll || defaultPayrollSettings()), ...action.settings } } : null
      const touched = []

      if (action.scope === 'sheet') {
        const tx = planSheet(state, action.staffId, action.periodId, action.op, { ...action.options, period })
        if (!tx.ok) return state
        Object.assign(sheetsNext, tx.sheets)
        touched.push('paySheets')
      } else if (action.scope === 'profile') {
        // master-data edits (rate, payroll id, classification) are a separate
        // control from running payroll — they snapshot the profile list only
        const list = state.payProfiles || []
        let next = list
        if (action.op === 'upsert') {
          if (!action.item?.staffId) return state
          const exists = list.find((p) => p.staffId === action.item.staffId)
          next = exists ? list.map((p) => (p.staffId === action.item.staffId ? { ...p, ...action.item } : p)) : [...list, { id: `pay-${action.item.staffId}`, ...action.item }]
        } else if (action.op === 'remove') {
          next = list.filter((p) => p.staffId !== action.staffId)
        } else return state
        return { ...state, payProfiles: next, history: pushSnap(state, ['payProfiles']) }
      } else if (action.scope === 'run') {
        if (action.op === 'create') {
          if (!period) return state
          const run = newRun(state, period, action.options)
          runsNext[run.id] = run
          touched.push('payRuns')
          if (action.options?.autoApproveSheets) {
            for (const staffId of run.included) {
              const key = sheetKey(staffId, period.id)
              const cur = sheetsNext[key] || { id: key, staffId, periodId: period.id, status: 'open', adjustments: [], audit: [] }
              if (['open', 'rejected'].includes(cur.status)) sheetsNext[key] = { ...cur, status: 'approved', approvedAt: Date.now(), approvedBy: action.options?.who || 'Payroll admin', audit: [...(cur.audit || []), { at: Date.now(), who: action.options?.who || 'Payroll admin', action: 'auto-approved when the run was created' }] }
              else if (cur.status === 'submitted') sheetsNext[key] = { ...cur, status: 'approved', approvedAt: Date.now(), approvedBy: action.options?.who || 'Payroll admin', audit: [...(cur.audit || []), { at: Date.now(), who: action.options?.who || 'Payroll admin', action: 'approved for the run' }] }
            }
            touched.push('paySheets')
          }
        } else {
          const run = runsNext[action.runId]
          if (!run) return state
          const tx = planRun(state, period, action.op, { ...action.options, runId: action.runId })
          if (!tx.ok) return state
          Object.assign(runsNext, tx.runs)
          if (tx.sheets) Object.assign(sheetsNext, tx.sheets)
          touched.push('payRuns')
          if (tx.sheets) touched.push('paySheets')
        }
      } else if (action.scope === 'export') {
        const item = action.item
        if (!item?.id) return state
        exportsNext[item.id] = item
        touched.push('payExports')
      } else if (action.scope === 'settings') {
        if (!action.settings) return state
        touched.push('payrollSettings')
      } else return state

      return {
        ...state,
        ...(touched.includes('paySheets') ? { paySheets: sheetsNext } : {}),
        ...(touched.includes('payRuns') ? { payRuns: runsNext } : {}),
        ...(touched.includes('payExports') ? { payExports: exportsNext } : {}),
        ...(settingsPatch ? { settings: { ...state.settings, ...settingsPatch } } : {}),
        history: touched.length ? pushSnap(state, touched, {}, action.settings) : state.history,
      }
    }
    // ---- intake manager: one transaction per pipeline move, so a single Undo
    // steps the record back — including a conversion that also created a client
    // chart and re-pointed an appointment at it.
    case 'handoffSessionTx': {
      const plan = planHandoffSession(state, action.clientId, action.appt)
      if (!plan.ok) return state
      return { ...state, appts: { ...state.appts, [plan.appt.id]: plan.appt }, history: pushSnap(state, ['appts']) }
    }
    case 'intakeTx': {
      const intakeRequests = { ...(state.intakeRequests || {}) }
      for (const r of action.upserts || []) intakeRequests[r.id] = r
      for (const id of action.deletes || []) delete intakeRequests[id]
      const referralSources = action.sources ? (() => {
        const incoming = Array.isArray(action.sources) ? action.sources : Object.values(action.sources)
        const current = state.referralSources || []
        if (currentAccount(state)?.officeIds?.includes('*')) return incoming
        const outOfScope = current.filter((source) => !canAccessRecord(state, 'referral', source))
        return [...outOfScope, ...incoming]
      })() : state.referralSources
      // A conversion hands back a *new* client chart: patch known clients in place
      // and append the ones this transaction introduced, so the chart really lands
      // in the roster every downstream module reads.
      let clients = state.clients
      if (action.clients) {
        const patch = action.clients
        const known = new Set(state.clients.map((c) => c.id))
        clients = state.clients.map((c) => (patch[c.id] ? { ...c, ...patch[c.id] } : c))
        for (const item of Object.values(patch)) if (item?.id && !known.has(item.id)) clients = [...clients, item]
      }
      const appts = { ...state.appts }
      for (const a of action.apptUpserts || []) appts[a.id] = { ...appts[a.id], ...a }
      for (const { id, patch } of action.apptPatches || []) if (appts[id]) appts[id] = { ...appts[id], ...patch, updatedAt: Date.now() }
      const touched = [
        ...(action.upserts?.length || action.deletes?.length ? ['intakeRequests'] : []),
        ...(action.sources ? ['referralSources'] : []),
        ...(action.clients ? ['clients'] : []),
        ...(action.apptPatches?.length || action.apptUpserts?.length ? ['appts'] : []),
      ]
      return { ...state, intakeRequests, referralSources, clients, appts, history: touched.length ? pushSnap(state, touched) : state.history }
    }
    case 'record': {
      // Money must go through a guarded claim/receipt transaction, never a
      // generic document write that leaves the claim aggregate out of sync.
      const list = action.items || (action.item ? [action.item] : [])
      if (!['invoices', 'statements', 'cabinet', 'pdus', 'tasks', 'messages', 'verificationForms', 'eraImports', 'billedFiles', 'qbo', 'payExports'].includes(action.coll) || !list.length || list.some((i) => !i?.id)) return state
      const cur = state[action.coll] || {}
      // noSnap: bookkeeping such as read receipts takes no Undo slot
      return { ...state, [action.coll]: { ...cur, ...Object.fromEntries(list.map((i) => [i.id, i])) }, history: action.noSnap ? state.history : pushSnap(state, [action.coll]) }
    }
    case 'setUI': {
      const patch = { ...action.patch }
      if (patch.settings === true) {
        patch.section = 'settings'
        patch.settings = false
      }
      // Settings navigation lives only in NavRail, so reveal it for every entry
      // point (rail, profile menu, keyboard shortcut or command palette).
      if (patch.section === 'settings' && !Object.hasOwn(patch, 'nav')) patch.nav = false
      return { ...state, ui: { ...state.ui, ...patch } }
    }
    case 'setSettings':
      return { ...state, settings: { ...state.settings, ...action.patch } }
    /**
     * chunk-42 — one settings transaction.
     *
     * Re-plans against the live state (a stale dialog cannot write an invalid
     * value), applies the settings patch AND every cascade it implies — office
     * renames re-point appointments, clients, payroll profiles, intake and
     * account office scopes — in a single action, so a single Undo reverses the
     * whole change. The snapshot covers only the collections this op touched.
     */
    case 'settingsTx': {
      const plan = planSettingsOp(state, action.op, action.payload || {})
      if (!plan.ok) return state
      const settings = { ...state.settings, ...(plan.patch || {}) }
      let next = { ...state, settings }
      const touched = ['settings']
      const casc = plan.cascades
      if (casc) {
        if (casc.appts) {
          const appts = { ...next.appts }
          for (const { id, patch } of casc.appts.patches || []) if (appts[id]) appts[id] = { ...appts[id], ...patch, updatedAt: Date.now() }
          for (const a of casc.appts.creates || []) appts[a.id] = a
          if ((casc.appts.patches || []).length || (casc.appts.creates || []).length) { next = { ...next, appts }; touched.push('appts') }
        }
        if (casc.clients) {
          const clients = [...(next.clients || [])]
          for (const { id, patch } of casc.clients.patches || []) {
            const i = clients.findIndex((c) => c.id === id)
            if (i >= 0) clients[i] = { ...clients[i], ...patch }
          }
          for (const c of casc.clients.creates || []) clients.push(c)
          if ((casc.clients.patches || []).length || (casc.clients.creates || []).length) { next = { ...next, clients }; touched.push('clients') }
        }
        if (casc.staff) {
          const staff = [...(next.staff || [])]
          for (const { id, patch } of casc.staff.patches || []) {
            const i = staff.findIndex((s) => s.id === id)
            if (i >= 0) staff[i] = { ...staff[i], ...patch }
          }
          for (const s of casc.staff.creates || []) staff.push(s)
          if ((casc.staff.patches || []).length || (casc.staff.creates || []).length) { next = { ...next, staff }; touched.push('staff') }
        }
        if (casc.payProfiles) {
          const profiles = [...(next.payProfiles || [])]
          for (const { staffId, patch } of casc.payProfiles.patches || []) {
            const i = profiles.findIndex((p) => p.staffId === staffId)
            if (i >= 0) profiles[i] = { ...profiles[i], ...patch }
          }
          if ((casc.payProfiles.patches || []).length) { next = { ...next, payProfiles: profiles }; touched.push('payProfiles') }
        }
        if (casc.intakeRequests) {
          const reqs = { ...(next.intakeRequests || {}) }
          for (const { id, patch } of casc.intakeRequests.patches || []) if (reqs[id]) reqs[id] = { ...reqs[id], ...patch }
          if ((casc.intakeRequests.patches || []).length) { next = { ...next, intakeRequests: reqs }; touched.push('intakeRequests') }
        }
        if (casc.security?.accounts?.length) {
          const accounts = (next.security?.accounts || []).map((a) => {
            const hit = casc.security.accounts.find((x) => x.id === a.id)
            return hit ? { ...a, officeIds: hit.officeIds } : a
          })
          next = { ...next, security: { ...next.security, accounts } }
          touched.push('security')
        }
      }
      return { ...next, history: pushSnap(state, touched) }
    }
    /**
     * chunk-42 — Data Import commit. The planner re-runs against the live
     * workspace (rows can go stale while a preview is on screen) and the import
     * lands as one undoable transaction with a log entry on settings.
     */
    case 'importTx': {
      const plan = planImport(state, action.importType, action.matrix || [], action.mapping || {}, { mode: action.mode || 'skip' })
      if (!plan.ok) return state
      let next = state
      const touched = ['settings']
      const clients = [...(next.clients || [])]
      const staff = [...(next.staff || [])]
      const payers = [...(next.payers || [])]
      const payProfiles = [...(next.payProfiles || [])]
      const appts = { ...next.appts }
      if (plan.creates.length || plan.patches.length) {
        if (['clients', 'client-contacts', 'client-authorizations'].includes(action.importType)) {
          for (const c of plan.creates) clients.push(c)
          for (const { id, patch } of plan.patches) { const i = clients.findIndex((c) => c.id === id); if (i >= 0) clients[i] = { ...clients[i], ...patch } }
          next = { ...next, clients }; touched.push('clients')
        } else if (['staff', 'staff-qualifications', 'staff-npis', 'staff-earning-codes'].includes(action.importType)) {
          for (const s of plan.creates) staff.push(s)
          for (const { id, patch } of plan.patches) {
            const i = staff.findIndex((s) => s.id === id)
            if (i >= 0) staff[i] = { ...staff[i], ...patch }
            if (patch.payProfilePatch) {
              const pi = payProfiles.findIndex((p) => p.staffId === id)
              if (pi >= 0) payProfiles[pi] = { ...payProfiles[pi], ...patch.payProfilePatch }
              if (!touched.includes('payProfiles')) touched.push('payProfiles')
            }
          }
          next = { ...next, staff, ...(touched.includes('payProfiles') ? { payProfiles } : {}) }; touched.push('staff')
        } else if (['payers', 'payer-services'].includes(action.importType)) {
          for (const p of plan.creates) payers.push(p)
          for (const { id, patch } of plan.patches) { const i = payers.findIndex((p) => p.id === id); if (i >= 0) payers[i] = { ...payers[i], ...patch } }
          next = { ...next, payers }; touched.push('payers')
        } else {
          for (const a of plan.creates) appts[a.id] = a
          for (const { id, patch } of plan.patches) if (appts[id]) appts[id] = { ...appts[id], ...patch, updatedAt: Date.now() }
          next = { ...next, appts }; touched.push('appts')
        }
      }
      const entry = { ...plan.entry, file: action.fileName || plan.entry.file }
      return {
        ...next,
        settings: { ...next.settings, importLog: appendImportLog(next.settings, entry) },
        history: pushSnap(state, touched),
      }
    }
    case 'securityTx': {
      const result = applySecurityChange(state.security, action.operation, { ...(action.payload || {}), staff: state.staff }, action.actorId, action.at)
      return result.ok ? { ...state, security: result.security } : state
    }
    case 'meta':
      return { ...state, meta: { ...(state.meta || {}), ...action.patch } }
    case 'toggleSel': {
      const { list, id, all } = action
      const cur = state.ui[list]
      let next
      if (all === 'all') next = cur.length === state[list === 'teamSel' ? 'teams' : list === 'clientSel' ? 'clients' : 'staff'].length ? [] : state[list === 'teamSel' ? 'teams' : list === 'clientSel' ? 'clients' : 'staff'].map((x) => x.id)
      else next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]
      return { ...state, ui: { ...state.ui, [list]: next } }
    }
    case 'clearDemo': {
      // Clear the dependent financial ledgers too; leaving payments/files behind
      // creates orphaned claims. The whole operation must be a single Undo.
      return { ...state, appts: {}, claims: {}, payments: {}, invoices: {}, statements: {}, cabinet: {}, pdus: {}, tasks: {}, messages: {}, verificationForms: {}, eraImports: {}, billedFiles: {}, qbo: {}, payRuns: {}, payExports: {}, paySheets: {}, intakeRequests: {}, history: pushSnap(state, ['appts', 'claims', 'payments', 'invoices', 'verificationForms', 'eraImports', 'billedFiles', 'qbo', 'payRuns', 'payExports', 'paySheets', 'intakeRequests', 'statements', 'cabinet', 'pdus', 'tasks', 'messages']) }
    }
    case 'relabel': {
      const next = { ...state.appts }
      let n = 0
      for (const [id, a] of Object.entries(next)) {
        if (needsRework(a)) {
          next[id] = { ...a, title: apptAutoTitle({ type: a.type, clientIds: a.clientIds, staffIds: a.staffIds, start: a.start, end: a.end, serviceOverride: a.service, locationOverride: a.location, clients: state.clientsById || Object.fromEntries(state.clients.map((c) => [c.id, c])), staff: Object.fromEntries(state.staff.map((x) => [x.id, x])), settings: state.settings }) }
          n++
        }
      }
      if (!n) return state
      return { ...state, appts: next, history: pushSnap(state, ['appts']) }
    }
    case 'reseed': {
      const appts = buildSeed(todayISO())
      const { claims: demoClaims, appts: withClaims } = buildDemoClaims(appts, state.clients, state.settings, todayISO())
      const claims = seedFamilyShares(demoClaims, state.clients)
      // Rebuild seed payments from the new claims and remove documents tied to
      // the replaced ledger. Keep the user's rosters, masters and settings.
      const pay = seedPayroll(state.staff, { payroll: state.settings.payroll })
      // Rebuild the intake pipeline against the fresh calendar so converted
      // requests point at clients that still exist.
      const seedInt = seedIntake({ appts: withClaims, clients: state.clients, staff: state.staff, payers: state.payers })
      const clients = state.clients.map((c) => (seedInt.clientPatches[c.id] ? { ...c, ...seedInt.clientPatches[c.id] } : c))
      return { ...state, appts: withClaims, claims, payments: paymentsFromClaims(Object.values(claims)), invoices: {}, statements: {}, ...seedRecords({ ...state, claims, intakeRequests: seedInt.intakeRequests }, todayISO()), verificationForms: {}, eraImports: {}, billedFiles: {}, qbo: {}, paySheets: pay.sheets, payRuns: {}, payExports: {}, intakeRequests: seedInt.intakeRequests, referralSources: seedInt.referralSources, clients, history: pushSnap(state, ['appts', 'claims', 'payments', 'invoices', 'verificationForms', 'eraImports', 'billedFiles', 'qbo', 'paySheets', 'payRuns', 'payExports', 'intakeRequests', 'referralSources', 'clients', 'statements', 'cabinet', 'pdus', 'tasks', 'messages']) }
    }
    case 'roster': {
      const list = state[action.list]
      if (action.mode === 'add') return { ...state, [action.list]: [...list, action.item] }
      if (action.mode === 'patch') return { ...state, [action.list]: list.map((x) => (x.id === action.item.id ? { ...x, ...action.item } : x)) }
      // remove: also detach the person from care teams + appointment rows so nothing points at ghosts
      const rest = list.filter((x) => x.id !== action.id)
      const teams = state.teams.map((t) => ({ ...t, [action.list === 'staff' ? 'staffIds' : 'clientIds']: (t[action.list === 'staff' ? 'staffIds' : 'clientIds'] || []).filter((id) => id !== action.id) }))
      const key = action.list === 'staff' ? 'staffIds' : 'clientIds'
      const appts = { ...state.appts }
      for (const a of Object.values(appts)) {
        if ((a[key] || []).includes(action.id)) appts[a.id] = { ...a, [key]: a[key].filter((id) => id !== action.id) }
      }
      const ui = { ...state.ui, [action.list === 'staff' ? 'staffSel' : 'clientSel']: state.ui[action.list === 'staff' ? 'staffSel' : 'clientSel'].filter((id) => id !== action.id) }
      let security = state.security
      if (action.list === 'staff' && state.security?.accounts?.some((account) => account.staffId === action.id)) {
        const revoked = applySecurityChange(state.security, 'staff.remove', { staffId: action.id, staff: state.staff }, state.security.currentUserId, Date.now())
        if (revoked.ok) security = revoked.security
      }
      return { ...state, [action.list]: rest, teams, appts, ui, security }
    }
    case 'payer': {
      const list = state.payers || []
      if (action.mode === 'add') return { ...state, payers: [...list, action.item] }
      // every payer edit is one undoable transaction: the field/rules panels, the inline
      // cells and the add-payer modal all land here, and Payment Terms pushes its own too
      if (action.mode === 'patch') return { ...state, payers: list.map((p) => (p.id === action.item.id ? { ...p, ...action.item } : p)), history: action.noSnap ? state.history : pushSnap(state, ['payers']) }
      if (action.mode === 'terms') {
        const tx = planPayerTerms(state, action.id, action.input)
        return tx.ok ? { ...state, payers: list.map((p) => (p.id === tx.payer.id ? { ...p, ...tx.payer } : p)), history: pushSnap(state, ['payers']) } : state
      }
      return { ...state, payers: list.filter((p) => p.id !== action.id) }
    }
    case 'svc': {
      const list = state.svcs || []
      if (action.mode === 'add') return { ...state, svcs: [...list, action.item] }
      if (action.mode === 'patch') return { ...state, svcs: list.map((x) => (x.id === action.item.id ? { ...x, ...action.item } : x)) }
      return { ...state, svcs: list.filter((x) => x.id !== action.id) }
    }
    case 'cfdef': {
      const list = state.customFields || []
      if (action.mode === 'add') return { ...state, customFields: [...list, action.item] }
      if (action.mode === 'patch') return { ...state, customFields: list.map((x) => (x.id === action.item.id ? { ...x, ...action.item } : x)) }
      return { ...state, customFields: list.filter((x) => x.id !== action.id) }
    }
    case 'dash': {
      const cur = state.dash || { widgets: DEFAULT_DASH }
      let widgets = cur.widgets
      let boards = cur.boards || []
      if (action.mode === 'add' && WIDGETS[action.wtype]) widgets = [...widgets, { id: uid(), type: action.wtype, span: WIDGETS[action.wtype].span ?? 6, cfg: { ...WIDGETS[action.wtype].defaultCfg } }]
      else if (action.mode === 'remove') widgets = widgets.filter((w) => w.id !== action.id)
      else if (action.mode === 'move') {
        const i = widgets.findIndex((w) => w.id === action.id)
        const j = i + (action.dir || 0)
        if (i < 0 || j < 0 || j >= widgets.length) return state
        widgets = [...widgets]
        const [it] = widgets.splice(i, 1)
        widgets.splice(j, 0, it)
      } else if (action.mode === 'resize') { const span = Math.max(1, Math.min(6, Number(action.span) || 6)); widgets = widgets.map((w) => (w.id === action.id ? { ...w, span } : w)) }
      else if (action.mode === 'order') {
        const i = widgets.findIndex((w) => w.id === action.id)
        if (i < 0) return state
        widgets = [...widgets]
        const [it] = widgets.splice(i, 1)
        let j = action.index ?? i
        if (j > i) j -= 1 // index came from the pre-removal array
        j = Math.max(0, Math.min(widgets.length, j))
        widgets.splice(j, 0, it)
      }
      else if (action.mode === 'clone') { const i = widgets.findIndex((w) => w.id === action.id); if (i < 0) return state; widgets = [...widgets]; widgets.splice(i + 1, 0, { ...widgets[i], id: uid(), cfg: { ...widgets[i].cfg } }) }
      else if (action.mode === 'height') { const h = Math.max(1, Math.min(3, Number(action.h) || 1)); widgets = widgets.map((w) => (w.id === action.id ? { ...w, h } : w)) }
      else if (action.mode === 'line') widgets = widgets.map((w) => (w.id === action.id ? { ...w, nl: !!action.nl } : w))
      else if (action.mode === 'saveBoard') { const name = String(action.name ?? '').trim().slice(0, 42) || `Board ${boards.length + 1}`; boards = [...boards, { id: uid(), name, at: Date.now(), widgets: widgets.map((w) => ({ ...w, cfg: { ...w.cfg } })) }] }
      else if (action.mode === 'loadBoard') { const b = boards.find((x) => x.id === action.id); if (!b) return state; widgets = b.widgets.map((w) => ({ ...w, cfg: { ...w.cfg } })) }
      else if (action.mode === 'delBoard') boards = boards.filter((x) => x.id !== action.id)
      else if (action.mode === 'cfg') widgets = widgets.map((w) => (w.id === action.id ? { ...w, cfg: { ...w.cfg, ...action.patch } } : w))
      else if (action.mode === 'reset') widgets = DEFAULT_DASH.map((w) => ({ ...w, cfg: { ...w.cfg } }))
      else return state
      return { ...state, dash: { ...cur, widgets, boards } }
    }
    case 'replace': {
      const p = action.payload
      try { validateWorkspaceData(p) } catch { return state }
      const d = defaultSettings()
      const settings = {
        ...d, ...p.settings,
        smart: p.settings.smart || d.smart,
        authGuard: { ...d.authGuard, ...(p.settings.authGuard || {}) },
        org: { ...d.org, ...(p.settings.org || {}) },
        billing: { ...d.billing, ...(p.settings.billing || {}) },
        payroll: { ...d.payroll, ...(p.settings.payroll || {}), taxes: { ...d.payroll.taxes, ...(p.settings.payroll?.taxes || {}) }, approvals: { ...d.payroll.approvals, ...(p.settings.payroll?.approvals || {}) }, cancelPolicy: { ...d.payroll.cancelPolicy, ...(p.settings.payroll?.cancelPolicy || {}) } },
        analytics: { ...d.analytics, ...(p.settings.analytics || {}) },
      }
      // One atomic restore, including billing artifacts and all masters. Do not
      // import navigation or history from the file; Undo returns to the live tab.
      const restored = normalizeWorkspace({ ...state, ...workspaceData(p), settings, history: [] })
      return { ...restored, ui: state.ui, history: pushSnap(state) }
    }
    case 'addSavedReport':
      return { ...state, reports: { saved: [{ ...action.report }, ...(state.reports.saved || []).slice(0, 23)] } }
    case 'removeSavedReport':
      return { ...state, reports: { saved: (state.reports.saved || []).filter((r) => r.id !== action.id) } }
    default:
      return state
  }
}

// Snapshots hold only fields touched by their action; immutable updates make
// references safe. Full restores use all fields, but a claim Undo cannot roll
// back an unrelated setting edit. No snapshots are persisted to localStorage.
const pushSnap = (state, fields = WORKSPACE_FIELDS, billingPatch = {}, payrollPatch = {}) => [
  ...state.history.slice(-24),
  { __workspaceSnapshot: true, ...Object.fromEntries(fields.map((key) => [key,
    key === 'billingSettings' ? Object.fromEntries(Object.keys(billingPatch).map((name) => [name, state.settings.billing?.[name]]))
      : key === 'payrollSettings' ? Object.fromEntries(Object.keys(payrollPatch).map((name) => [name, state.settings.payroll?.[name]]))
      : state[key]])) },
]

const Ctx = createContext(null)
export const useStore = () => useContext(Ctx)

export function StoreProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, undefined, initial)
  const [saveError, setSaveError] = useState(false)
  const toast = useToast()
  const saveT = useRef(null)
  useEffect(() => {
    clearTimeout(saveT.current)
    saveT.current = setTimeout(() => {
      try {
        localStorage.setItem(KEY, serializeForStorage(state))
        setSaveError(false)
      } catch {
        // Never imply an edit is safe when it exists only in this tab's memory.
        setSaveError(true)
      }
    }, 250)
    return () => clearTimeout(saveT.current)
  }, [state])

  const guardedDispatch = useMemo(() => (action) => {
    const decision = authorizeAction(state, action)
    if (!decision.ok) {
      toast({ message: decision.msg, kind: 'warn' })
      return decision
    }
    let safeAction = action
    if (action.type === 'setSettings' && Array.isArray(action.patch?.providers) && !currentAccount(state)?.officeIds?.includes('*')) {
      const updatedIds = new Set(action.patch.providers.map((provider) => provider.id))
      const hiddenProviders = (state.settings?.providers || []).filter((provider) => !canAccessRecord(state, 'provider', provider) && !updatedIds.has(provider.id))
      safeAction = { ...action, patch: { ...action.patch, providers: [...hiddenProviders, ...action.patch.providers] } }
    }
    dispatch(safeAction)
    return { ok: true }
  }, [state, toast])
  const visibleState = useMemo(() => scopeWorkspaceToAccount(state), [state])
  const actions = useMemo(() => createActions(visibleState, guardedDispatch, state), [visibleState, guardedDispatch, state])
  const access = useMemo(() => ({
    currentAccount: currentAccount(state),
    currentRole: currentRole(state),
    canAccessAllOffices: !!currentAccount(state)?.officeIds?.includes('*'),
    accessLevel: (area) => accessLevel(state, area),
    canAccess: (area, minimum = 'view') => canAccess(state, area, minimum),
  }), [state])
  const value = useMemo(() => ({ ...visibleState, ...access, dispatch: guardedDispatch, actions }), [visibleState, access, guardedDispatch, actions])
  return <Ctx.Provider value={value}>
    {children}
    {saveError && <div className="storage-warning" role="alert" data-testid="storage-warning">
      Changes aren't saved in this browser (storage full or unavailable). Export a backup before closing this tab.
      <button className="btn btn-sm" type="button" onClick={() => dispatch({ type: 'setUI', patch: { settings: true, settingsModule: 'system' } })}>Open Settings</button>
    </div>}
  </Ctx.Provider>
}

function createActions(state, dispatch, rawState = state) {
  const securityMutation = (operation, payload = {}) => {
    const at = Date.now()
    const actorId = currentAccount(rawState)?.id || null
    const action = { type: 'securityTx', operation, payload, actorId, at }
    const decision = authorizeAction(rawState, action)
    if (!decision.ok) return decision
    const result = applySecurityChange(rawState.security, operation, { ...payload, staff: rawState.staff, settings: rawState.settings }, actorId, at)
    if (!result.ok) return result
    const dispatched = dispatch(action)
    return dispatched?.ok === false ? dispatched : result
  }
  return {
    setUI: (patch) => dispatch({ type: 'setUI', patch }),
    /** Open the Settings modal on a specific module (and optional sub-tab). */
    openSettings: (module, sub) => dispatch({ type: 'setUI', patch: { settings: true, ...(module ? { settingsModule: module } : {}), ...(sub !== undefined ? { settingsSub: sub } : {}) } }),
    /**
     * Every Settings sub-module edit funnels through here: permissions and the
     * domain guards are checked on the live state, then one settingsTx applies
     * the change and its cascades so a single Undo reverses everything.
     */
    settingsOp: (op, payload = {}) => {
      if (!canAccess(rawState, 'settings', 'full')) return { ok: false, msg: 'Settings changes need full access to the Workspace settings module.' }
      if (String(op).startsWith('office.') && !currentAccount(rawState)?.officeIds?.includes('*')) {
        return { ok: false, msg: 'The office master is shared by every location — it needs all-office scope.' }
      }
      const plan = planSettingsOp(rawState, op, payload)
      if (!plan.ok) return plan
      const decided = dispatch({ type: 'settingsTx', op, payload })
      return decided?.ok === false ? decided : { ok: true, msg: plan.msg, detail: plan.detail || null }
    },
    /** Data Import: validate the whole file first, then commit as one transaction. */
    importRows: (importType, matrix, mapping, options = {}) => {
      const plan = planImport(rawState, importType, matrix, mapping, options)
      if (!plan.ok) return { ...plan, check: plan.check }
      const decided = dispatch({ type: 'importTx', importType, matrix, mapping, mode: options.mode, fileName: options.fileName })
      if (decided?.ok === false) return decided
      return { ok: true, msg: `${plan.counts.created} created · ${plan.counts.updated} updated · ${plan.counts.skipped} skipped`, counts: plan.counts }
    },
    securityMutation,
    switchDemoAccount: (id) => securityMutation('account.switch', { id }),
    setSettings: (patch) => dispatch({ type: 'setSettings', patch }),
    setMeta: (patch) => dispatch({ type: 'meta', patch }),
    replace: (payload) => dispatch({ type: 'replace', payload }),
    dash: (mode, payload = {}) => dispatch({ type: 'dash', mode, ...payload }),
    relabel: () => dispatch({ type: 'relabel' }),
    bookHandoffSession: (clientId, input) => {
      const appt = { ...input, createdAt: Date.now(), updatedAt: Date.now() }
      const permission = authorizeAction(rawState, { type: 'handoffSessionTx', clientId, appt })
      if (!permission.ok) return permission
      const plan = planHandoffSession(rawState, clientId, appt)
      if (!plan.ok) return plan
      const decision = dispatch({ type: 'handoffSessionTx', clientId, appt })
      return decision?.ok === false ? decision : { ok: true, msg: plan.msg }
    },
    create: (apptsIn) => {
      const appts = apptsIn.map((a) => ({ id: a.id || uid(), createdAt: Date.now(), updatedAt: Date.now(), status: 'active', custom: {}, clientIds: [], staffIds: [], notes: '', documents: [], verification: null, ...a }))
      dispatch({ type: 'upsertMany', appts })
      return appts
    },
    update: (id, patch) => dispatch({ type: 'patch', id, patch }),
    move: (id, { date, start, end }) => dispatch({ type: 'patch', id, patch: { date, start, end } }),
    remove: (ids) => dispatch({ type: 'deleteMany', ids: Array.isArray(ids) ? ids : [ids] }),
    removeSeries: (appt, scope) => {
      if (scope === 'one' || !appt.seriesId) return dispatch({ type: 'deleteMany', ids: [appt.id] })
      const ids = Object.values(state.appts)
        .filter((a) => a.seriesId === appt.seriesId)
        .filter((a) => (scope === 'following' ? a.date >= appt.date : true))
        .map((a) => a.id)
      dispatch({ type: 'deleteMany', ids })
    },
    undo: () => dispatch({ type: 'undo' }),
    clearSel: () => dispatch({ type: 'setUI', patch: { staffSel: [], clientSel: [], teamSel: [] } }),
    toggleSel: (list, id, all) => dispatch({ type: 'toggleSel', list, id, all }),
    setFilters: (patch) => dispatch({ type: 'setUI', patch: { filters: { ...state.ui.filters, ...patch } } }),
    reseed: () => dispatch({ type: 'reseed' }),
    clearDemo: () => dispatch({ type: 'clearDemo' }),
    // ---- rosters (clients / staff) — used by directory sections; appointment refs are cleaned on removal ----
    addRoster: (list, item) => dispatch({ type: 'roster', list, mode: 'add', item: { id: uid(), ...item } }),
    updateRoster: (list, item) => dispatch({ type: 'roster', list, mode: 'patch', item }),
    removeRoster: (list, id) => dispatch({ type: 'roster', list, mode: 'remove', id }),
    // ---- payer master ----
    addPayer: (item) => dispatch({ type: 'payer', mode: 'add', item: { id: uid(), ...item } }),
    // ---- masters: service type list ----
    addSvc: (item) => dispatch({ type: 'svc', mode: 'add', item: { id: uid(), status: 'active', unitMins: 15, rate: 0, rounding: 'AMA', credentials: [], note: '', ...item } }),
    updateSvc: (item) => dispatch({ type: 'svc', mode: 'patch', item }),
    removeSvc: (id) => dispatch({ type: 'svc', mode: 'remove', id }),
    addCfDef: (item) => dispatch({ type: 'cfdef', mode: 'add', item: { id: uid(), status: 'active', required: false, options: [], onLabel: 'Yes', offLabel: 'No', note: '', ...item } }),
    updateCfDef: (item) => dispatch({ type: 'cfdef', mode: 'patch', item }),
    removeCfDef: (id) => dispatch({ type: 'cfdef', mode: 'remove', id }),
    // noSnap: a caller that is part of a bigger transaction (a service delete's contract
    // cleanup) must not add a half-Undo step of its own
    updatePayer: ({ noSnap, ...item }) => dispatch({ type: 'payer', mode: 'patch', item, noSnap }),
    removePayer: (id) => dispatch({ type: 'payer', mode: 'remove', id }),
    /** Payer payment terms (kind, days to pay, payer share, copay, filing window): validated, one Undo. */
    setPayerTerms: (id, input) => {
      const plan = planPayerTerms(state, id, input)
      if (!plan.ok) return { ok: false, msg: plan.msg }
      dispatch({ type: 'payer', mode: 'terms', id, input })
      return { ok: true, msg: plan.msg }
    },
    // ---- billing pipeline: mark lines billed/paid with an undoable snapshot ----
    markBilling: (ids, status) => {
      const patch = ids.map((id) => ({ id, billing: { ...(state.appts[id]?.billing || {}), status, billedAt: Date.now() } }))
      dispatch({ type: 'upsertMany', appts: patch })
    },
    // ---- claim lifecycle: every transition is ONE undoable claimsTx ----
    generateClaims: (apptIds) => {
      const pool = apptIds && apptIds.length ? stagedAppts(state, null).filter((a) => apptIds.includes(a.id)) : stagedAppts(state, null)
      const plans = planClaims(state, pool)
      if (!plans.length) return { ok: false, msg: 'Nothing claim-ready to assemble — fix Blocked lines first' }
      const { claims, apptPatch } = assembleClaims(state, plans)
      // Self-pay invoices and their sequence are part of the SAME undoable tx.
      const invoices = {}
      let seq = state.settings?.billing?.invoiceSeq || 1
      for (const c of claims) if (c.mode === 'selfpay') {
        const invNo = `${state.settings?.billing?.invoicePrefix || 'INV'}-${String(seq).padStart(4, '0')}`
        invoices[`inv-${c.id}`] = { id: `inv-${c.id}`, claimId: c.id, no: invNo, clientId: c.clientId, amount: c.charges, due: c.charges, status: 'open', createdAt: Date.now() }
        seq++
      }
      dispatch({ type: 'claimsTx', claimUpserts: claims, apptPatches: apptPatch,
        ...(seq !== (state.settings?.billing?.invoiceSeq || 1) ? { invoices, billing: { invoiceSeq: seq } } : {}) })
      const lines = claims.reduce((t, c) => t + c.lines.length, 0)
      return { ok: true, msg: `${claims.length} claim form${claims.length > 1 ? 's' : ''} assembled — ${lines} charge lines staged → drafted`, ids: claims.map((c) => c.id) }
    },
    submitClaims: (ids, { recordFile = false } = {}) => {
      const sent = []
      const gated = []
      const claimUpserts = []
      const apptPatches = []
      for (const id of ids) {
        const c = state.claims[id]
        if (!c || c.status !== 'draft') continue
        if (c.method === 'secondary') { gated.push({ no: c.no, why: 'Use Secondary Billing to record filing manually', bad: 1 }); continue }
        const gate = claimGate(state, c)
        if (!gate.ok) { gated.push({ no: c.no, why: gate.bad[0]?.why, bad: gate.bad.length }); continue }
        const tx = submitPatch(state, c)
        claimUpserts.push(tx.claim)
        apptPatches.push(...tx.apptPatches)
        sent.push(c.no)
      }
      let billedFiles
      if (recordFile && claimUpserts.length) {
        const at = Date.now()
        const id = uid()
        billedFiles = { [id]: {
          id, fileName: `837P-${todayISO()}-${String(Object.keys(state.billedFiles || {}).length + 1).padStart(3, '0')}.txt`,
          format: '837p', status: 'sent', billedThrough: 'ch', payer: claimUpserts[0].payer,
          clientCount: new Set(claimUpserts.map((c) => c.clientId)).size, claimCount: claimUpserts.length,
          claimIds: claimUpserts.map((c) => c.id), date: todayISO(), sendCount: 1,
          content: claimUpserts.map((c) => `${c.no}|${c.payer}|${c.charges}`).join('\n'), createdAt: at,
        } }
      }
      if (claimUpserts.length) dispatch({ type: 'claimsTx', claimUpserts, apptPatches, billedFiles })
      if (!sent.length) return { ok: false, msg: gated.length ? `All ${gated.length} claim(s) held by gates — see the ⚠ on each` : 'Nothing to submit' }
      return { ok: true, msg: `${sent.length} claim${sent.length > 1 ? 's' : ''} submitted${gated.length ? ` · ${gated.length} held by validation gates` : ''}`, sent, gated, fileId: billedFiles && Object.keys(billedFiles)[0] }
    },
    postPayment: (id, payload) => {
      const options = { at: Date.now(), paymentId: uid() }
      const plan = planClaimPayment(state, id, payload, options)
      if (!plan.ok) return { ok: false, msg: plan.msg }
      dispatch({ type: 'claimPaymentTx', id, payload, options })
      return { ok: true, msg: plan.msg, id: options.paymentId }
    },
    /** Payer take-back on a paid primary claim: reopens the balance, one Undo. */
    /** Inbox messages: send (one Undo); opening a thread marks it read (no Undo slot). */
    sendMessage: (input) => {
      const plan = planMessage(state, input, { id: uid(), at: Date.now(), from: currentAccount(state)?.id || null })
      if (!plan.ok) return plan
      dispatch({ type: 'record', coll: 'messages', item: plan.item })
      return { ok: true, msg: plan.msg, id: plan.item.id, threadId: plan.item.threadId }
    },
    markThreadRead: (threadId) => {
      const items = readUpdates(state, threadId, currentAccount(state)?.id || null)
      if (items.length) dispatch({ type: 'record', coll: 'messages', items, noSnap: true })
      return { ok: true, msg: '' }
    },
    /** Inbox tasks: add / edit, mark done or reopen. One record write, one Undo. */
    saveTask: (input) => {
      const plan = planTask(state, input, { id: input.id || uid(), at: Date.now(), by: currentAccount(state)?.staffId || null, can: (area) => canAccess(state, area, 'view') })
      if (!plan.ok) return plan
      dispatch({ type: 'record', coll: 'tasks', item: plan.item })
      return { ok: true, msg: plan.msg, id: plan.item.id }
    },
    setTaskDone: (id, done = true) => {
      const plan = planTaskDone(state, id, done, { at: Date.now(), by: currentAccount(state)?.staffId || null })
      if (!plan.ok) return plan
      dispatch({ type: 'record', coll: 'tasks', item: plan.item })
      return { ok: true, msg: plan.msg }
    },
    /** CEU / PDU / competency entry for the credentials report. One record write, one Undo. */
    logPdu: (input) => {
      const plan = planPduEntry(state, input, { id: uid(), at: Date.now() })
      if (!plan.ok) return plan
      dispatch({ type: 'record', coll: 'pdus', item: plan.item })
      return { ok: true, msg: plan.msg, id: plan.item.id }
    },
    /** Cabinet documents: add / edit, archive or restore. One record write, one Undo. */
    saveCabinetDoc: (input) => {
      const plan = planCabinetDoc(state, input, { id: input.id || uid(), at: Date.now() })
      if (!plan.ok) return plan
      dispatch({ type: 'record', coll: 'cabinet', item: plan.item })
      return { ok: true, msg: plan.msg, id: plan.item.id }
    },
    archiveCabinetDoc: (id, archived = true) => {
      const plan = planCabinetArchive(state, id, { archived, at: Date.now() })
      if (!plan.ok) return plan
      dispatch({ type: 'record', coll: 'cabinet', item: plan.item })
      return { ok: true, msg: plan.msg }
    },
    /** Client statements: issue, mark how it was delivered, void. Each is one record write, one Undo. */
    issueStatement: (clientId) => {
      const plan = planStatement(state, clientId, { id: uid(), at: Date.now() })
      if (!plan.ok) return plan
      dispatch({ type: 'record', coll: 'statements', item: plan.item })
      return { ok: true, msg: plan.msg, id: plan.item.id }
    },
    markStatementSent: (id, via) => {
      const plan = planStatementSent(state, id, { via, at: Date.now() })
      if (!plan.ok) return plan
      dispatch({ type: 'record', coll: 'statements', item: plan.item })
      return { ok: true, msg: plan.msg }
    },
    voidStatement: (id, reason) => {
      const plan = planStatementVoid(state, id, { reason, at: Date.now() })
      if (!plan.ok) return plan
      dispatch({ type: 'record', coll: 'statements', item: plan.item })
      return { ok: true, msg: plan.msg }
    },
    recordRecoupment: (claimId, payload) => {
      const options = { at: Date.now(), paymentId: uid() }
      const plan = planRecoupment(state, claimId, payload, options)
      if (!plan.ok) return { ok: false, msg: plan.msg }
      dispatch({ type: 'claimRecoupTx', id: claimId, payload, options })
      return { ok: true, msg: plan.msg, id: options.paymentId }
    },
    voidPayment: (id) => {
      const options = { at: Date.now(), reversalId: uid() }
      const plan = planVoidClaimPayment(state, id, options)
      if (!plan.ok) return { ok: false, msg: plan.msg }
      dispatch({ type: 'claimVoidPaymentTx', id, options })
      return { ok: true, msg: plan.msg, id: options.reversalId }
    },
    recordPatientReceipt: (payload) => {
      const options = { at: Date.now(), paymentId: uid() }
      const plan = planPatientReceipt(state, payload.claimId, payload, options)
      if (!plan.ok) return { ok: false, msg: plan.msg }
      dispatch({ type: 'patientReceiptTx', id: payload.claimId, payload, options })
      return { ok: true, msg: plan.msg, id: options.paymentId }
    },
    // ---- provider identifier master (U2) ----
    addProvider: (row) => dispatch({ type: 'setSettings', patch: { providers: [...(state.settings.providers || []), { id: uid(), kind: 'staff', credential: 'Other', degree: '', npi: '', taxonomy: '101YP00000X', roles: { rendering: false, billing: false, facility: false }, payerIds: { ticare: '', medicaid: '', bhpn: '', referrers: '' }, active: true, createdAt: Date.now(), ...row }] } }),
    updateProvider: (id, patch) => dispatch({ type: 'setSettings', patch: { providers: (state.settings.providers || []).map((p) => (p.id === id ? { ...p, ...patch } : p)) } }),
    removeProvider: (id) => dispatch({ type: 'setSettings', patch: { providers: (state.settings.providers || []).filter((p) => p.id !== id) } }),
    deleteProvider: (id) => dispatch({ type: 'setSettings', patch: { providers: (state.settings.providers || []).filter((p) => p.id !== id) } }),
    // ---- payroll -----------------------------------------------------------------
    // Timesheet decisions (submit / approve / reject / reopen / adjust): one tx each.
    payrollSheet: (staffId, periodId, op, options = {}) => {
      const period = periodFromId(state.settings?.payroll, periodId, { back: 24, forward: 12 })
      const tx = planSheet(state, staffId, periodId, op, { ...options, period })
      if (!tx.ok) return { ok: false, msg: tx.msg }
      dispatch({ type: 'payrollTx', scope: 'sheet', staffId, periodId, op, options })
      return { ok: true, msg: tx.msg }
    },
    /** Master data: rates, payroll IDs, classification, deductions. */
    payrollProfile: (item) => {
      if (!item?.staffId) return { ok: false, msg: 'Profile needs a staff member' }
      dispatch({ type: 'payrollTx', scope: 'profile', op: 'upsert', item })
      return { ok: true, msg: 'Payroll profile saved' }
    },
    removePayrollProfile: (staffId) => dispatch({ type: 'payrollTx', scope: 'profile', op: 'remove', staffId }),
    /** Run lifecycle: create → approve → process (lock) → void. */
    createPayRun: (period, options = {}) => {
      const scopedOptions = { ...options, at: options.at || Date.now(), included: options.included || eligibleProfiles(state).map((profile) => profile.staffId) }
      const gate = runGate(state, period, scopedOptions)
      const run = newRun(rawState, period, scopedOptions)
      const decision = dispatch({ type: 'payrollTx', scope: 'run', op: 'create', periodId: period.id, options: scopedOptions })
      if (decision?.ok === false) return decision
      return { ok: true, msg: `${run.no} created — ${scopedOptions.included.length} employees · ${gate.blockers.length} blocker(s), ${gate.warnings.length} warning(s)`, id: run.id, gate }
    },
    payrollRun: (runId, op, options = {}) => {
      const run = (state.payRuns || {})[runId]
      if (!run) return { ok: false, msg: 'Pay run not found' }
      const period = periodFromId(state.settings?.payroll, run.periodId, { back: 24, forward: 12 })
      const tx = planRun(state, period, op, { ...options, runId })
      if (!tx.ok) return { ok: false, msg: tx.msg }
      dispatch({ type: 'payrollTx', scope: 'run', op, runId, options, periodId: run.periodId })
      return { ok: true, msg: tx.msg }
    },
    /** Record a downloaded provider/bank artifact so the run has an audit trail. */
    recordPayExport: (item, permissionArea = 'payroll') => {
      const rec = { id: uid(), at: Date.now(), status: 'pending', ...item, ...(permissionArea === 'payrollQbo' ? { permissionArea } : {}) }
      const result = dispatch({ type: 'payrollTx', scope: 'export', item: rec, permissionArea })
      return result?.ok === false ? result : rec
    },
    reviewPayExport: (id, status, note = '') => dispatch({
      type: 'record', coll: 'payExports',
      item: { ...(state.payExports || {})[id], id, status, reviewedAt: Date.now(), note },
    }),
    /** Pay policy: cancellation bands, overtime, rounding, approvals, tax tables. */
    payrollSettings: (patch) => {
      dispatch({ type: 'payrollTx', scope: 'settings', settings: patch })
      return { ok: true, msg: 'Payroll settings updated' }
    },
    // ---- document/artifact ledgers (billed files, invoices, verification forms, ERA imports) ----
    record: (coll, item) => dispatch({ type: 'record', coll, item: { id: uid(), ...item } }),
    resendBilledFile: (id) => {
      const file = (state.billedFiles || {})[id]
      if (!file || file.status === 'void') return { ok: false, msg: 'File is unavailable for resend' }
      dispatch({ type: 'record', coll: 'billedFiles', item: { ...file, sendCount: (file.sendCount || 1) + 1, status: 'sent', lastSentAt: Date.now() } })
      return { ok: true, msg: `${file.fileName} prepared for resend` }
    },
    // ---- v33 billing suite helpers (payment center, secondary, appeals, qbo, verification) ----
    skipSecondary: (id) => {
      const options = { at: Date.now() }
      const plan = planSecondarySkip(state, id, options)
      if (!plan.ok) return { ok: false, msg: plan.msg }
      dispatch({ type: 'secondarySkipTx', id, options })
      return { ok: true, msg: plan.msg }
    },
    submitSecondaryClaim: (id, method = 'ch') => {
      const options = { submit: true, method, at: Date.now(), newId: uid() }
      const plan = planSecondaryFiling(state, id, options)
      if (!plan.ok) return { ok: false, msg: plan.msg }
      dispatch({ type: 'secondaryFilingTx', id, options })
      return { ok: true, msg: plan.msg, newId: plan.secondaryId }
    },
    cancelSecondaryClaim: (id) => {
      const options = { at: Date.now() }
      const plan = planSecondaryCancel(state, id, options)
      if (!plan.ok) return { ok: false, msg: plan.msg }
      dispatch({ type: 'secondaryCancelTx', id, options })
      return { ok: true, msg: plan.msg }
    },
    recordPayment: (payload) => {
      const options = { at: Date.now(), paymentId: uid() }
      if (payload.claimId) {
        const linked = { ...payload, checkNo: payload.ref || payload.checkNo }
        const plan = planClaimPayment(state, payload.claimId, linked, options)
        if (!plan.ok) return { ok: false, msg: plan.msg }
        dispatch({ type: 'claimPaymentTx', id: payload.claimId, payload: linked, options })
        return { ok: true, id: options.paymentId, msg: plan.msg }
      }
      const plan = planUnappliedReceipt(state, payload, options)
      if (!plan.ok) return { ok: false, msg: plan.msg }
      dispatch({ type: 'unappliedPaymentTx', payload, options })
      return { ok: true, id: options.paymentId, msg: plan.msg }
    },
    import835: ({ fileName, parsed, selectedIds }) => {
      const options = { fileName, selectedIds, source: '835', eraId: uid(), at: Date.now() }
      const plan = planEraImport(state, parsed, options)
      if (!plan.ok) return { ok: false, msg: plan.msg }
      dispatch({ type: 'eraImportTx', parsed, options })
      return { ok: true, msg: plan.msg, id: plan.era.id }
    },
    retryEra: (eraId, selectedIds) => {
      const options = { at: Date.now() }
      const plan = planParkedEraPost(state, eraId, selectedIds, options)
      if (!plan.ok) return { ok: false, msg: plan.msg }
      dispatch({ type: 'eraRetryTx', eraId, selectedIds, options })
      return { ok: true, msg: plan.msg, id: eraId }
    },
    // Preserve typed ERA entry, but do not silently skip missing claims, post
    // negative/duplicate money, or turn an ERA denial into a payment.
    importEra: ({ fileName, lines }) => {
      if (!Array.isArray(lines) || !lines.length) return { ok: false, msg: 'Enter at least one ERA line' }
      const parsed = { fingerprint: null, errors: [], meta: { traceNo: fileName || 'Manual ERA', paymentDate: todayISO() },
        lines: lines.map((ln, i) => {
          const claim = state.claims[ln.claimId]
          return { id: `manual-${i + 1}`, claimNo: claim?.no || ln.claimId || '',
            status: ln.status || 'paid', statusCode: ln.status === 'denied' ? '4' : ln.status === 'partial' ? 'manual-partial' : '1',
            charges: claim?.charges, paid: ln.amount, patientResp: 0,
            adjustments: ln.adj ? [{ group: 'CO', reason: ln.status === 'denied' ? String(ln.carc || '') : 'manual', amount: ln.adj }] : [] }
        }) }
      const preview = previewEra(state, parsed)
      const held = preview.rows.find((r) => !r.ready)
      if (preview.errors.length || held) return { ok: false, msg: preview.errors[0] || `${held.line.claimNo || 'ERA line'}: ${held.reason}` }
      const options = { fileName: fileName || 'Manual ERA', source: 'manual', selectedIds: parsed.lines.map((ln) => ln.id), eraId: uid(), at: Date.now() }
      const plan = planEraImport(state, parsed, options)
      if (!plan.ok) return { ok: false, msg: plan.msg }
      dispatch({ type: 'eraImportTx', parsed, options })
      return { ok: true, msg: plan.msg, id: plan.era.id }
    },
    fileAppeal: (id, payload) => {
      const c = state.claims[id]
      if (!c) return { ok: false, msg: 'Claim not found' }
      const at = Date.now()
      const appeal = { date: payload.date || todayISO(), template: payload.template || 'med_necessity', note: payload.note || '', outcome: null, createdAt: at }
      // An appeal is a marker on the claim, not a status: the claim keeps its own status (a
      // denial stays denied and stays in A/R) and no money is invented here.
      const patched = { ...c, appeal, history: [...(c.history || []), { at, ev: `Appeal filed — ${appeal.template}` }] }
      dispatch({ type: 'claimsTx', claimUpserts: [patched] })
      return { ok: true, msg: `${c.no} appeal filed` }
    },
    /** Appeal outcome. A win returns the claim to awaiting payer payment so the payment can
     *  be posted (the money is never invented); a loss leaves the claim exactly where it was. */
    appealOutcome: (id, outcome) => {
      const c = state.claims[id]
      if (!c) return { ok: false, msg: 'Claim not found' }
      if (c.method === 'secondary' || c.secondary) return { ok: false, msg: 'A secondary filing is managed in the COB queue' }
      const at = Date.now()
      const appeal = { ...(c.appeal || { date: todayISO() }), outcome, outcomeAt: at }
      const won = outcome === 'won'
      const patched = {
        ...c, appeal, status: won ? 'submitted' : c.status,
        history: [...(c.history || []), { at, ev: won ? 'Appeal won — awaiting the payer payment' : 'Appeal lost — claim stays denied' }],
      }
      dispatch({ type: 'claimsTx', claimUpserts: [patched] })
      return { ok: true, msg: won ? `${c.no} marked won — post the payer payment to close it` : `${c.no} marked lost` }
    },
    updateClaim: (id, patch) => {
      const c = state.claims[id]
      if (!c) return { ok: false }
      const financial = ['charges', 'paid', 'adj', 'secondaryPaid', 'patientPaid', 'secondary', 'method', 'remittance', 'patientResp']
      if (financial.some((key) => Object.hasOwn(patch, key)) ||
          ((c.method === 'secondary' || c.secondary) && Object.hasOwn(patch, 'status'))) {
        return { ok: false, msg: 'Use a guarded remittance or COB action to change financial state' }
      }
      dispatch({ type: 'claimsTx', claimUpserts: [{ ...c, ...patch, history: [...(c.history || []), { at: Date.now(), ev: 'Claim updated' }] }] })
      return { ok: true }
    },
    addVerificationForm: (item) => {
      const id = item.id || uid()
      dispatch({ type: 'record', coll: 'verificationForms', item: { id, ...item, createdAt: Date.now() } })
      return { ok: true, id }
    },
    updateVerificationForm: (id, patch) => {
      const cur = (state.verificationForms || {})[id]
      if (!cur) return { ok: false }
      dispatch({ type: 'record', coll: 'verificationForms', item: { ...cur, ...patch, id, updatedAt: Date.now() } })
      return { ok: true }
    },
    updateQbo: (id, patch) => {
      const cur = (state.qbo || {})[id] || (state.invoices || {})[id] || { id }
      const item = { ...cur, ...patch, id, updatedAt: Date.now() }
      dispatch({ type: 'claimsTx', qbo: { [id]: item },
        ...(state.invoices?.[id] ? { invoices: { [id]: { ...state.invoices[id], ...patch, id } } } : {}) })
      return { ok: true }
    },
    denyClaim: (id, payload) => {
      const c = state.claims[id]
      if (!c || c.status !== 'submitted' || (c.method !== 'secondary' && c.secondary)) return { ok: false, msg: 'Only a submitted claim without a pending primary COB change can be denied here' }
      dispatch({ type: 'claimsTx', claimUpserts: [denyPatch(c, payload, state).claim] })
      return { ok: true, msg: `${c.no} marked denied — ${denialOf(payload.code, state).fix}` }
    },
    rebillClaim: (id, dropIds) => {
      const c = state.claims[id]
      if (!c || c.method === 'secondary' || c.secondary || c.status !== 'denied') return { ok: false, msg: 'Resolve COB before rebilling a denied primary claim' }
      if ((dropIds || []).length >= c.lines.length) return { ok: false, msg: 'Rebill needs at least one kept line — use Void to drop the whole claim' }
      const { voided, next, apptPatches } = rebillPatch(state, c, dropIds || [])
      dispatch({ type: 'claimsTx', claimUpserts: [voided, next], apptPatches })
      return { ok: true, msg: `${next.no} drafted from ${c.no}${dropIds?.length ? ` — ${dropIds.length} disputed line(s) back to staging` : ''}`, newId: next.id }
    },
    voidClaim: (id) => {
      const c = state.claims[id]
      if (!c || c.method === 'secondary' || c.secondary || !['draft', 'submitted'].includes(c.status)) return { ok: false, msg: 'Resolve or cancel secondary filings before voiding an open primary claim' }
      const tx = releasePatch(state, c)
      dispatch({ type: 'claimsTx', claimUpserts: [tx.claim], apptPatches: tx.apptPatches })
      return { ok: true, msg: `${c.no} voided — ${c.lines.length} line${c.lines.length > 1 ? 's' : ''} back in staging` }
    },
    dropClaimLine: (claimId, apptId) => {
      const c = state.claims[claimId]
      if (!c || c.method === 'secondary' || c.secondary || c.status !== 'draft' || !c.lines.some((l) => lineApptIds(l).includes(apptId))) return { ok: false, msg: 'Only an unlinked primary draft line can be released' }
      const r = dropLinePatch(state, c, apptId)
      const apptPatches = r.released.map((id) => ({ id, patch: { claimId: null, billing: { ...(state.appts[id]?.billing || {}), status: null, claimNo: null } } }))
      if (r.removeClaim) {
        dispatch({ type: 'claimsTx', claimDel: [claimId], apptPatches })
        return { ok: true, msg: `${c.no} had its last line removed — claim dissolved, line back in staging` }
      }
      dispatch({ type: 'claimsTx', claimUpserts: [r.claim], apptPatches })
      return { ok: true, msg: `Line moved back to staging — ${c.no} re-totaled` }
    },
    fileSecondaryClaim: (id) => {
      const options = { at: Date.now(), newId: uid() }
      const plan = planSecondaryFiling(state, id, options)
      if (!plan.ok) return { ok: false, msg: plan.msg }
      dispatch({ type: 'secondaryFilingTx', id, options })
      return { ok: true, msg: plan.msg, newId: plan.secondaryId }
    },
    addClaimNote: (id, text) => {
      const c = state.claims[id]
      if (!c || !text.trim()) return { ok: false }
      dispatch({ type: 'claimsTx', claimUpserts: [{ ...c, note: text.trim(), history: [...c.history, { at: Date.now(), ev: `Billing note added` }] }] })
      return { ok: true }
    },
    saveReport: (report) => dispatch({ type: 'addSavedReport', report: { id: uid(), ...report } }),
    deleteReport: (id) => dispatch({ type: 'removeSavedReport', id }),

    // ---- Intake Manager ------------------------------------------------------
    /** Create or update one intake request. Every write is a single Undo step. */
    saveIntake: (req, opts = {}) => {
      const now = Date.now()
      const existing = req.id ? state.intakeRequests?.[req.id] : null
      const record = existing
        ? { ...existing, ...req, updatedAt: now }
        : { ...blankIntake({ ...req, id: req.id || uid(), no: req.no || intakeNo(state.intakeRequests) }), createdAt: now, updatedAt: now, stageSince: now }
      if (existing && record.stage !== existing.stage) {
        // Stage changes go through `moveIntake` so gates cannot be bypassed by a
        // plain form save; a form save keeps the stage it already had.
        record.stage = existing.stage
      }
      if (!existing) record.events = [...(record.events || []), { at: now, by: opts.by || null, ev: `Intake request ${record.no} created` }]
      dispatch({ type: 'intakeTx', upserts: [record] })
      return record
    },
    /** Patch fields without touching the stage (typing in the detail sheet). */
    patchIntake: (id, patch, ev) => {
      const cur = state.intakeRequests?.[id]
      if (!cur) return { ok: false, msg: 'Request not found' }
      const now = Date.now()
      const next = { ...cur, ...patch, updatedAt: now }
      if (ev) next.events = [...(cur.events || []), { at: now, ev }]
      dispatch({ type: 'intakeTx', upserts: [next] })
      return { ok: true }
    },
    /** Log an outreach attempt — the pipeline's heartbeat metric. */
    logContact: (id, contact) => {
      const cur = state.intakeRequests?.[id]
      if (!cur) return { ok: false, msg: 'Request not found' }
      const now = Date.now()
      const at = { id: uid(), at: now, ...contact }
      const next = { ...cur, contacts: [...(cur.contacts || []), at], updatedAt: now, events: [...(cur.events || []), { at: now, by: at.by || null, ev: `Contact logged — ${at.outcome} (${at.channel})` }] }
      // A logged contact is what moves a request out of `new` — but only through
      // the same gate the pipeline rail enforces (an owner must be assigned too),
      // so the auto-advance can never do what a manual move is refused.
      const advance = cur.stage === 'new' && at.outcome && nextStages(cur.stage).includes('contacted') && gateBlockers(next, 'contacted').length === 0
      if (advance) { next.stage = 'contacted'; next.stageSince = now; next.events = [...next.events, { at: now, by: at.by || null, ev: `Moved to ${stageDef('contacted').label}` }] }
      dispatch({ type: 'intakeTx', upserts: [next] })
      return { ok: true, advanced: Boolean(advance) }
    },
    /** Pipeline move with gate enforcement. */
    moveIntake: (id, target, payload = {}) => {
      const cur = state.intakeRequests?.[id]
      if (!cur) return { ok: false, msg: 'Request not found' }
      if (!nextStages(cur.stage).includes(target)) return { ok: false, msg: `Cannot move ${stageDef(cur.stage).label} → ${stageDef(target).label}` }
      const now = Date.now()
      const { by = null, ...fields } = payload
      const patch = { ...fields, updatedAt: now, stage: target, stageSince: now }
      if (target === 'closed' && !patch.lost) return { ok: false, msg: 'A not-admitted reason is required to close a request' }
      if (target === 'closed') patch.lost = { ...patch.lost, at: now, by }
      if (target === 'converted') return { ok: false, msg: 'Use the conversion step to create the client chart' }
      if (target === 'waitlist') patch.waitlist = { ...(cur.waitlist || {}), ...(fields.waitlist || {}), since: fields.waitlist?.since || cur.waitlist?.since || now }
      if (target === 'scheduled' && !(fields.apptId || cur.apptId)) return { ok: false, msg: 'Book the assessment visit on the calendar to move to Scheduled' }
      const reopened = cur.stage === 'closed' && target === 'new'
      if (reopened) patch.lost = null // a reopened request is live again — the old disposition stays in the audit trail
      const merged = { ...cur, ...patch }
      const blockers = gateBlockers(merged, target)
      if (blockers.length) return { ok: false, msg: `${blockers.length} requirement${blockers.length > 1 ? 's' : ''} outstanding: ${blockers.map((b) => b.label).join('; ')}`, blockers }
      const ev = reopened
        ? `Reopened — back to ${stageDef(target).label}${cur.lost?.reason ? ` (was closed: ${LOST_REASONS.find((x) => x.id === cur.lost.reason)?.label || cur.lost.reason})` : ''}`
        : `Moved to ${stageDef(target).label}`
      merged.events = [...(cur.events || []), { at: now, by, ev }]
      dispatch({ type: 'intakeTx', upserts: [merged] })
      return { ok: true, msg: reopened ? 'Reopened — back in the pipeline as a new referral' : `Moved to ${stageDef(target).label}` }
    },
    deleteIntake: (id) => dispatch({ type: 'intakeTx', deletes: [id] }),
    /**
     * Convert a request into a client chart. The client, the appointment link
     * and the request are written in ONE action so a single Undo reverses all of it.
     */
    convertIntake: (id, opts = {}) => {
      const plan = planConversion(state, id, { ...opts, at: Date.now(), clientId: opts.clientId || uid(), by: opts.by || null })
      if (!plan.ok) return plan
      dispatch({ type: 'intakeTx', upserts: [plan.intake], clients: { [plan.client.id]: plan.client }, apptPatches: plan.apptPatch ? [plan.apptPatch] : [] })
      return { ok: true, msg: plan.msg, clientId: plan.client.id }
    },
    /** Waiting families are a promise: a review date keeps the promise visible. */
    reviewWaitlist: (id, payload = {}) => {
      const cur = state.intakeRequests?.[id]
      if (!cur) return { ok: false, msg: 'Request not found' }
      if (!payload.reviewBy) return { ok: false, msg: 'A next-review date is required so the family is not forgotten' }
      const now = Date.now()
      const next = {
        ...cur,
        waitlist: { ...cur.waitlist, ...payload, lastReviewAt: now },
        updatedAt: now,
        events: [...(cur.events || []), { at: now, ev: `Waitlist reviewed — next check-in ${payload.reviewBy}` }],
      }
      dispatch({ type: 'intakeTx', upserts: [next] })
      return { ok: true, msg: `Waitlist check-in recorded — next review ${payload.reviewBy}` }
    },
    /** Referral source register (upstream relationships). */
    saveReferralSource: (item) => {
      const list = state.referralSources || []
      const next = item.id && list.some((s) => s.id === item.id)
        ? list.map((s) => (s.id === item.id ? { ...s, ...item } : s))
        : [...list, { id: item.id || uid(), status: 'active', since: todayISO(), dormantDays: 90, ...item }]
      dispatch({ type: 'intakeTx', sources: next })
      return next.find((s) => s.id === (item.id || next[next.length - 1].id))
    },
    removeReferralSource: (id) => {
      // Never orphan a live request: the relationship is retired, not deleted,
      // when requests still attribute to it.
      const inUse = Object.values(state.intakeRequests || {}).some((r) => r.referralSourceId === id)
      if (inUse) {
        dispatch({ type: 'intakeTx', sources: (state.referralSources || []).map((s) => (s.id === id ? { ...s, status: 'dormant' } : s)) })
        return { ok: true, retired: true, msg: 'Source is attributed to live requests — marked dormant instead of deleted' }
      }
      dispatch({ type: 'intakeTx', sources: (state.referralSources || []).filter((s) => s.id !== id) })
      return { ok: true }
    },
    /** Book the assessment visit straight from the pipeline (calendar-linked). */
    scheduleIntakeAssessment: (id, { date, start, end, clinicianId, location, by }) => {
      const cur = state.intakeRequests?.[id]
      if (!cur) return { ok: false, msg: 'Request not found' }
      if (!date || start == null || end == null || Number.isNaN(start) || Number.isNaN(end)) return { ok: false, msg: 'Assessment needs a date and time' }
      if (end <= start) return { ok: false, msg: 'The assessment must end after it starts' }
      if (!clinicianId) return { ok: false, msg: 'Pick the assessing clinician — the visit needs an owner on the calendar' }
      if (!(state.staff || []).some((s) => s.id === clinicianId)) return { ok: false, msg: 'That clinician is not on the staff roster' }
      // the booking IS the move to Scheduled, so it obeys the same stage graph as the rail
      const rebook = cur.stage === 'scheduled' && !(cur.apptId && state.appts?.[cur.apptId])
      if (!nextStages(cur.stage).includes('scheduled') && !rebook) return { ok: false, msg: `Cannot book from ${stageDef(cur.stage).label} — the request must be in Clinical review or on the Waitlist` }
      if (cur.apptId && state.appts?.[cur.apptId]) return { ok: false, msg: 'An assessment visit is already on the calendar — change it from the calendar' }
      const apptId = uid()
      const appt = {
        id: apptId, type: 'evaluation', title: `Intake assessment · ${[cur.firstName, cur.lastName].filter(Boolean).join(' ')}`,
        date, start, end, clientIds: [], staffIds: clinicianId ? [clinicianId] : [], status: 'active',
        location: location || cur.office || '', service: 'fba', notes: `Intake assessment for ${cur.no}`,
        intakeId: cur.id, createdAt: Date.now(), updatedAt: Date.now(), custom: {}, documents: [], verification: null,
      }
      // The same practice Appointment Validations as the booking dialog. There is no client yet
      // (the family becomes one at conversion), so only staff and service checks can apply.
      const checks = evaluateAppointmentValidations(state, appt)
      if (checks.stops.length) return { ok: false, msg: `Not booked. ${checks.stops.map((i) => `${i.label}: ${i.message}`).join(' ')}` }
      const now = Date.now()
      const next = {
        ...cur, apptId, apptDate: date, clinicianId, bcbaAssignedId: cur.bcbaAssignedId || clinicianId, updatedAt: now,
        stage: 'scheduled', stageSince: rebook ? cur.stageSince : now,
        events: [...(cur.events || []), { at: now, by: by || null, ev: `Assessment booked for ${date}${rebook ? '' : ` — moved to ${stageDef('scheduled').label}`}` }],
      }
      dispatch({ type: 'intakeTx', upserts: [next], apptUpserts: [appt] })
      const review = checks.warns.length ? ` Review: ${checks.warns.map((i) => i.message).join(' ')}` : ''
      return { ok: true, apptId, msg: `Assessment booked ${date} — it is on the calendar now.${review}` }
    },
  }
}

// ---------- selectors ----------

export function visibleApptsFor(state, dayIso) {
  const { appts, ui } = state
  const staffFilter = ui.staffSel
  return Object.values(appts)
    .filter((a) => a.date === dayIso)
    .filter((a) => ui.filters.statuses.includes(a.status))
    .filter((a) => !ui.filters.abaOnly || countsAsAbaHours(a))
    .filter((a) => {
      if (!staffFilter.length) return true
      return (a.staffIds || []).some((s) => staffFilter.includes(s))
    })
    .filter((a) => {
      if (!ui.clientSel.length) return true
      return (a.clientIds || []).some((c) => ui.clientSel.includes(c))
    })
    .filter((a) => {
      if (!ui.teamSel.length) return true
      const teams = ui.teamSel.map((tid) => state.teams.find((t) => t.id === tid)).filter(Boolean)
      const tS = new Set(teams.flatMap((t) => t.staffIds || []))
      const tC = new Set(teams.flatMap((t) => t.clientIds || []))
      // appointment belongs to a care team if it involves one of its staff OR one of its clients
      return (a.staffIds || []).some((s) => tS.has(s)) || (a.clientIds || []).some((c) => tC.has(c))
    })
    .sort((x, y) => x.start - y.start || x.end - y.end)
}

// overlap lanes for absolute positioning in a day column
export function layoutLanes(list) {
  const items = [...list].sort((a, b) => a.start - b.start || b.end - a.end)
  const lanes = []
  const placed = []
  for (const a of items) {
    let lane = lanes.findIndex((lastEnd, i) => lastEnd <= a.start)
    if (lane === -1) {
      lane = lanes.length
      lanes.push(a.end)
    } else lanes[lane] = a.end
    placed.push({ ...a, lane })
  }
  // group clusters so widths look natural
  const clusters = []
  let cur = []
  let curEnd = -1
  for (const p of placed) {
    if (cur.length && p.start >= curEnd) {
      clusters.push(cur)
      cur = []
      curEnd = -1
    }
    cur.push(p)
    curEnd = Math.max(curEnd, p.end)
  }
  if (cur.length) clusters.push(cur)
  const out = []
  const byId = new Map(placed.map((p) => [p.id, p]))
  for (const cl of clusters) {
    const maxLane = Math.max(...cl.map((p) => p.lane)) + 1
    for (const p of cl) out.push({ ...byId.get(p.id), cols: maxLane })
  }
  return out
}

// Group appointments whose times overlap into clusters so the grid can
// render one stack card (+n) instead of pushing every chip into sliver lanes.
// Chaining: A∩B and B∩C ⇒ one group. Touching (end === start) is NOT overlap.
export function groupOverlaps(list) {
  const items = [...list].sort((a, b) => a.start - b.start || b.end - a.end)
  const groups = []
  let cur = null
  for (const a of items) {
    if (cur && a.start < cur.end) {
      cur.items.push(a)
      cur.end = Math.max(cur.end, a.end)
    } else {
      cur = { start: a.start, end: a.end, items: [a] }
      groups.push(cur)
    }
  }
  for (const g of groups) g.gid = `${g.items[0].date}#${g.items.map((i) => i.id).sort().join('~')}`
  return groups
}

/**
 * Layout plan for a time-overlap cluster (calendar best practice):
 * events that merely chain through a long anchor are NOT mushed together —
 * they get side-by-side lanes; only beyond MAX slots does the rightmost slot
 * collapse into a “+n more” overflow card (progressive disclosure).
 */
export function planCluster(items, maxSlots) {
  const laned = layoutLanes(items)
  const L = laned.reduce((m, x) => Math.max(m, x.lane), 0) + 1
  if (L <= maxSlots) return { lanes: laned, overflow: null }
  // With one slot, sequentially-stacked items (lane 0) still render as full-width
  // chips; only the truly simultaneous ones fold into the "+n more" card.
  const keep = maxSlots === 1 ? (x) => x.lane === 0 : (x) => x.lane < maxSlots - 1
  const lanes = laned.filter(keep).map((x) => ({ ...x, cols: maxSlots }))
  const over = laned.filter((x) => !keep(x))
  if (!over.length) return { lanes, overflow: null }
  return { lanes, overflow: { items: over, start: Math.min(...over.map((a) => a.start)), end: Math.max(...over.map((a) => a.end)) } }
}

/**
 * 30-minute slot rhythm for the vertical grid: an overlap cluster is sliced into
 * predictable half-hour blocks instead of one chained mega-card. Members are keyed
 * by their start slot (floor to :00/:30); block boundaries snap to the same grid,
 * so a block is exactly one 30-min window (the last one runs to cluster end).
 * A single member renders as a normal chip; 2+ concurrent as a stack card.
 */
export function slotBlocks(items, bucket = 30) {
  if (items.length < 2) return items.map((a) => ({ start: a.start, end: a.end, items: [a] }))
  const byS = [...items].sort((a, b) => a.start - b.start || b.end - a.end)
  const clusterEnd = byS.reduce((m, a) => Math.max(m, a.end), 0)
  const keys = [...new Set(byS.map((a) => Math.floor(a.start / bucket)))].sort((a, b) => a - b)
  return keys.map((k, i) => {
    const start = i === 0 ? Math.max(k * bucket, byS[0].start) : k * bucket
    const end = i + 1 < keys.length ? keys[i + 1] * bucket : clusterEnd
    return { start, end: Math.max(end, start + 5), items: byS.filter((a) => Math.floor(a.start / bucket) === k) }
  })
}

export function dayCount(state, dayIso) {
  return visibleApptsFor(state, dayIso).filter((a) => a.type === 'service' || a.type === 'evaluation').length
}

// Raw appointments for a date set — reports & analytics deliberately ignore
// the calendar's cosmetic filters so numbers always reflect the full ledger.
export function apptsInRange(state, days) {
  const set = new Set(days)
  return Object.values(state.appts)
    .filter((a) => set.has(a.date))
    .sort((x, y) => (x.date === y.date ? x.start - y.start : x.date < y.date ? -1 : 1))
}

export function weekStats(state, days) {
  let sessions = 0
  let units = 0
  let minutes = 0
  let revenue = 0
  let cancelled = 0
  let noShow = 0
  const seen = new Set()
  for (const d of days) {
    for (const a of visibleApptsFor(state, d)) {
      if (a.status === 'cancelled') {
        if (a.type === 'service' || a.type === 'evaluation') cancelled++
        continue
      }
      if (a.status === 'no-show' && (a.type === 'service' || a.type === 'evaluation')) noShow++
      if (a.type === 'service' || a.type === 'evaluation') {
        sessions++
        minutes += a.end - a.start
        units += Number(a.billing?.units) || 0
        revenue += (Number(a.billing?.units) || 0) * (Number(a.billing?.rate) || 0) + (a.billing?.mileage ? (Number(a.billing?.distance) || 0) * 0.7 : 0)
      }
    }
  }
  return { sessions, units: Math.round(units), minutes, revenue: Math.round(revenue), cancelled, noShow }
}
