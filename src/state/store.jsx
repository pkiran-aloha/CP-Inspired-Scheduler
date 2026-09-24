import React, { createContext, useContext, useEffect, useMemo, useReducer, useRef } from 'react'
import { uid } from '../lib/model'
import { buildSeed, buildDemoClaims, STAFF, CLIENTS, TEAMS, PAYERS, SVCS, defaultSettings, CF_DEFS } from '../lib/seed'
import { stagedAppts, planClaims, assembleClaims, claimGate, submitPatch, payPatch, denyPatch, rebillPatch, releasePatch, dropLinePatch, denialOf } from '../lib/claims'
import { todayISO } from '../lib/date'
import { normalizePayerCf, normalizeApptPcfs } from '../lib/master'
import { DEFAULT_DASH, WIDGETS } from '../lib/dash'

const KEY = 'aloha-aba.v3'
import { apptAutoTitle, needsRework } from '../lib/apptName'
export const STORAGE_KEY = KEY
const LEGACY_KEYS = ['pulse-aba-scheduler.v2']

export function blankState() {
  const appts = buildSeed(todayISO())
  const settings = defaultSettings()
  const { claims, appts: apptsWithClaims } = buildDemoClaims(appts, CLIENTS, settings, todayISO())
  return {
    appts: apptsWithClaims,
    claims,
    staff: STAFF,
    clients: CLIENTS,
    payers: PAYERS,
    svcs: SVCS,
    customFields: CF_DEFS,
    teams: TEAMS,
    history: [],
    settings,
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
    },
  }
}

export function initial() {
  const base = blankState()
  try {
    let raw = localStorage.getItem(KEY)
    if (!raw) for (const k of LEGACY_KEYS) {
      const legacy = localStorage.getItem(k)
      if (legacy) { raw = legacy; localStorage.removeItem(k); break }
    }
    if (raw) localStorage.setItem(KEY, raw) // persist the migrated snapshot once
    if (raw) {
      const saved = JSON.parse(raw)
      if (saved && saved.appts) {
        // merge every sub-object against defaults so older saves keep working as the schema grows
        const d = defaultSettings()
        const mergedRaw = {
          ...base,
          ...saved,
          claims: saved.claims || base.claims,
          svcs: Array.isArray(saved.svcs) && saved.svcs.length ? saved.svcs : base.svcs,
          customFields: Array.isArray(saved.customFields) ? saved.customFields : base.customFields,
          history: saved.history || [],
          reports: { saved: (saved.reports && saved.reports.saved) || [] },
          settings: { ...d, ...(saved.settings || {}), smart: saved.settings?.smart || d.smart, org: { ...d.org, ...(saved.settings?.org || {}) }, billing: { ...d.billing, ...(saved.settings?.billing || {}) }, analytics: { ...d.analytics, ...(saved.settings?.analytics || {}) } },
          ui: { ...base.ui, ...(saved.ui || {}), filters: { ...base.ui.filters, ...(saved.ui?.filters || {}) }, section: (saved.ui?.section || 'calendar') === 'payers' ? 'masters' : saved.ui?.section || 'calendar' },
        }
        // chunk-37: master-only migration for legacy custom-field entries — if anything was
        // promoted or dropped, write the fixed snapshot back immediately so the repair is durable
        // chunk-38: one-time clear of pre-loaded appointment pcfs (flagged in meta, idempotent)
        const merged = normalizeApptPcfs(normalizePayerCf(mergedRaw, uid))
        if (merged !== mergedRaw) { try { localStorage.setItem(KEY, JSON.stringify(merged)) } catch { /* off for A/B */ } }
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
      return { ...state, appts, history: pushSnap(state) }
    }
    case 'patch': {
      const cur = state.appts[action.id]
      if (!cur) return state
      return { ...state, appts: { ...state.appts, [action.id]: { ...cur, ...action.patch, updatedAt: Date.now() } }, history: action.noSnap ? state.history : pushSnap(state) }
    }
    case 'deleteMany': {
      const appts = { ...state.appts }
      for (const id of action.ids) delete appts[id]
      return { ...state, appts, history: pushSnap(state) }
    }
    case 'undo': {
      const hist = [...state.history]
      const snap = hist.pop()
      if (!snap) return state
      // snapshots taken before the claims engine only covered appointments
      if (!snap.appts) return { ...state, appts: snap, history: hist }
      return { ...state, appts: snap.appts, claims: snap.claims || {}, history: hist }
    }
    case 'claimsTx': {
      const appts = { ...state.appts }
      for (const { id, patch } of action.apptPatches || []) if (appts[id]) appts[id] = { ...appts[id], ...patch, updatedAt: Date.now() }
      const claims = { ...state.claims }
      for (const c of action.claimUpserts || []) claims[c.id] = c
      for (const id of action.claimDel || []) delete claims[id]
      return { ...state, appts, claims, history: pushSnap(state) }
    }
    case 'setUI':
      return { ...state, ui: { ...state.ui, ...action.patch } }
    case 'setSettings':
      return { ...state, settings: { ...state.settings, ...action.patch } }
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
      localStorage.removeItem(KEY)
      return { ...state, appts: {}, claims: {} }
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
      return { ...state, appts: next, history: pushSnap(state) }
    }
    case 'reseed': {
      const appts = buildSeed(todayISO())
      const { claims, appts: withClaims } = buildDemoClaims(appts, state.clients, state.settings, todayISO())
      return { ...state, appts: withClaims, claims, history: pushSnap(state) }
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
      return { ...state, [action.list]: rest, teams, appts, ui }
    }
    case 'payer': {
      const list = state.payers || []
      if (action.mode === 'add') return { ...state, payers: [...list, action.item] }
      if (action.mode === 'patch') return { ...state, payers: list.map((p) => (p.id === action.item.id ? { ...p, ...action.item } : p)) }
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
      const p = action.payload || {}
      if (!p.appts || typeof p.appts !== 'object') return state
      return {
        ...state,
        appts: p.appts,
        claims: p.claims && typeof p.claims === 'object' ? p.claims : {},
        staff: Array.isArray(p.staff) && p.staff.length ? p.staff : state.staff,
        clients: Array.isArray(p.clients) && p.clients.length ? p.clients : state.clients,
        teams: Array.isArray(p.teams) ? p.teams : state.teams,
        settings: p.settings ? { ...state.settings, ...p.settings } : state.settings,
        reports: p.reports && Array.isArray(p.reports.saved) ? p.reports : state.reports,
        history: pushSnap(state),
      }
    }
    case 'addSavedReport':
      return { ...state, reports: { saved: [{ ...action.report }, ...(state.reports.saved || []).slice(0, 23)] } }
    case 'removeSavedReport':
      return { ...state, reports: { saved: (state.reports.saved || []).filter((r) => r.id !== action.id) } }
    default:
      return state
  }
}

// one undo step snapshots BOTH the ledger (appts) and the claim desk (claims)
const pushSnap = (state) => [...state.history.slice(-24), { appts: { ...state.appts }, claims: { ...state.claims } }]

const Ctx = createContext(null)
export const useStore = () => useContext(Ctx)

export function StoreProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, undefined, initial)
  const saveT = useRef(null)
  useEffect(() => {
    clearTimeout(saveT.current)
    saveT.current = setTimeout(() => {
      try {
        localStorage.setItem(KEY, JSON.stringify(state))
      } catch (e) {
        /* storage full / disabled — app still works in-memory */
      }
    }, 250)
    return () => clearTimeout(saveT.current)
  }, [state])

  const actions = useMemo(() => createActions(state, dispatch), [state])
  const value = useMemo(() => ({ ...state, dispatch, actions }), [state, actions])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

function createActions(state, dispatch) {
  return {
    setUI: (patch) => dispatch({ type: 'setUI', patch }),
    setSettings: (patch) => dispatch({ type: 'setSettings', patch }),
    setMeta: (patch) => dispatch({ type: 'meta', patch }),
    replace: (payload) => dispatch({ type: 'replace', payload }),
    dash: (mode, payload = {}) => dispatch({ type: 'dash', mode, ...payload }),
    relabel: () => dispatch({ type: 'relabel' }),
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
    addSvc: (item) => dispatch({ type: 'svc', mode: 'add', item: { id: uid(), status: 'active', unitMins: 30, rate: 0, rounding: 'AMA', credentials: [], note: '', ...item } }),
    updateSvc: (item) => dispatch({ type: 'svc', mode: 'patch', item }),
    removeSvc: (id) => dispatch({ type: 'svc', mode: 'remove', id }),
    addCfDef: (item) => dispatch({ type: 'cfdef', mode: 'add', item: { id: uid(), status: 'active', required: false, options: [], onLabel: 'Yes', offLabel: 'No', note: '', ...item } }),
    updateCfDef: (item) => dispatch({ type: 'cfdef', mode: 'patch', item }),
    removeCfDef: (id) => dispatch({ type: 'cfdef', mode: 'remove', id }),
    updatePayer: (item) => dispatch({ type: 'payer', mode: 'patch', item }),
    removePayer: (id) => dispatch({ type: 'payer', mode: 'remove', id }),
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
      dispatch({ type: 'claimsTx', claimUpserts: claims, apptPatches: apptPatch })
      const lines = claims.reduce((t, c) => t + c.lines.length, 0)
      return { ok: true, msg: `${claims.length} claim form${claims.length > 1 ? 's' : ''} assembled — ${lines} charge lines staged → drafted`, ids: claims.map((c) => c.id) }
    },
    submitClaims: (ids) => {
      const sent = []
      const gated = []
      const claimUpserts = []
      const apptPatches = []
      for (const id of ids) {
        const c = state.claims[id]
        if (!c || c.status !== 'draft') continue
        const gate = claimGate(state, c)
        if (!gate.ok) { gated.push({ no: c.no, why: gate.bad[0]?.why, bad: gate.bad.length }); continue }
        const tx = submitPatch(state, c)
        claimUpserts.push(tx.claim)
        apptPatches.push(...tx.apptPatches)
        sent.push(c.no)
      }
      if (claimUpserts.length) dispatch({ type: 'claimsTx', claimUpserts, apptPatches })
      if (!sent.length) return { ok: false, msg: gated.length ? `All ${gated.length} claim(s) held by gates — see the ⚠ on each` : 'Nothing to submit' }
      return { ok: true, msg: `${sent.length} claim${sent.length > 1 ? 's' : ''} submitted${gated.length ? ` · ${gated.length} held by validation gates` : ''}`, sent, gated }
    },
    postPayment: (id, payload) => {
      const c = state.claims[id]
      if (!c) return { ok: false, msg: 'Claim not found' }
      dispatch({ type: 'claimsTx', claimUpserts: [payPatch(c, payload).claim] })
      return { ok: true, msg: `${c.no} paid — $${payload.amount.toLocaleString()} posted${payload.adj ? ` (+$${Math.round(payload.adj).toLocaleString()} adjustment)` : ''}` }
    },
    denyClaim: (id, payload) => {
      const c = state.claims[id]
      if (!c) return { ok: false, msg: 'Claim not found' }
      dispatch({ type: 'claimsTx', claimUpserts: [denyPatch(c, payload).claim] })
      return { ok: true, msg: `${c.no} marked denied — ${denialOf(payload.code).fix}` }
    },
    rebillClaim: (id, dropIds) => {
      const c = state.claims[id]
      if (!c) return { ok: false, msg: 'Claim not found' }
      if ((dropIds || []).length >= c.lines.length) return { ok: false, msg: 'Rebill needs at least one kept line — use Void to drop the whole claim' }
      const { voided, next, apptPatches } = rebillPatch(state, c, dropIds || [])
      dispatch({ type: 'claimsTx', claimUpserts: [voided, next], apptPatches })
      return { ok: true, msg: `${next.no} drafted from ${c.no}${dropIds?.length ? ` — ${dropIds.length} disputed line(s) back to staging` : ''}`, newId: next.id }
    },
    voidClaim: (id) => {
      const c = state.claims[id]
      if (!c) return { ok: false, msg: 'Claim not found' }
      const tx = releasePatch(state, c)
      dispatch({ type: 'claimsTx', claimUpserts: [tx.claim], apptPatches: tx.apptPatches })
      return { ok: true, msg: `${c.no} voided — ${c.lines.length} line${c.lines.length > 1 ? 's' : ''} back in staging` }
    },
    dropClaimLine: (claimId, apptId) => {
      const c = state.claims[claimId]
      if (!c) return { ok: false, msg: 'Claim not found' }
      const r = dropLinePatch(state, c, apptId)
      const apptPatches = [{ id: apptId, patch: { claimId: null, billing: { ...(state.appts[apptId]?.billing || {}), status: null, claimNo: null } } }]
      if (r.removeClaim) {
        dispatch({ type: 'claimsTx', claimDel: [claimId], apptPatches })
        return { ok: true, msg: `${c.no} had its last line removed — claim dissolved, line back in staging` }
      }
      dispatch({ type: 'claimsTx', claimUpserts: [r.claim], apptPatches })
      return { ok: true, msg: `Line moved back to staging — ${c.no} re-totaled` }
    },
    addClaimNote: (id, text) => {
      const c = state.claims[id]
      if (!c || !text.trim()) return { ok: false }
      dispatch({ type: 'claimsTx', claimUpserts: [{ ...c, note: text.trim(), history: [...c.history, { at: Date.now(), ev: `Billing note added` }] }] })
      return { ok: true }
    },
    saveReport: (report) => dispatch({ type: 'addSavedReport', report: { id: uid(), ...report } }),
    deleteReport: (id) => dispatch({ type: 'removeSavedReport', id }),
  }
}

// ---------- selectors ----------

export function visibleApptsFor(state, dayIso) {
  const { appts, ui } = state
  const staffFilter = ui.staffSel
  return Object.values(appts)
    .filter((a) => a.date === dayIso)
    .filter((a) => ui.filters.statuses.includes(a.status))
    .filter((a) => !ui.filters.abaOnly || a.abaHr)
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
