import React, { useCallback, useMemo, useRef, useState } from 'react'
import { BookingChecks, ToneGlyph } from './BookingChecks'
import { candidateVerdicts } from '../lib/bookingChecks'
import { PersonAvatar } from '../ui/avatars'
import { useStore } from '../state/store'
import { useToast } from '../ui/Toast'
import { Icon, TypeGlyph } from '../ui/Icons'
import { PeoplePicker, Dropdown, MultiSelect } from './fields'
import { DAY_SHORT, fmtDur, fmtTime, hmToMin, minToHM, startOfWeek, addDays, isoDate, parseISO, todayISO } from '../lib/date'
import {
  BILL_CODES,
  MILEAGE_RATE,
  PAY_TAGS,
  SERVICES,
  SNAP,
  STATUSES,
  TYPES,
  VERIFY_CHECKS,
  findConflicts,
  timeOverlap,
  uid,
  seriesSiblings,
  isServiceAppt,
} from '../lib/model'
import { suggestStaff, smartCfg, weekLoad } from '../lib/smart'
import { fitNotes, openSlots, slotText } from '../lib/pickFit'
import { AUTH_BANDS, authGuardCfg, authCheckFor } from '../lib/authBudget'
import { mergeAuthChecks, unitCheckFor, unitRuleFor, unitsFor } from '../lib/authUnits'
import {
  ABA_HOURS_EXPLAIN, ABA_HOURS_EXAMPLES, ABA_HOURS_NON_EXAMPLES,
  ABA_QUALIFYING_ACTIVITIES, ABA_NON_QUALIFYING_ACTIVITIES,
  abaActivityById, abaHoursCfg, abaTrackFor,
} from '../lib/abaHours'
import { riskFor, RISK_TIME_LABEL } from '../lib/risk'
import { overbookBoard, overbookBlockFor } from '../lib/overbook'
import { apptAutoTitle } from '../lib/apptName'
import { cancelReasonOptions, reasonPatch } from '../lib/cancelReasons'
import { isCancelStatus, statusMapFor, statusOrderFor, statusFor, settingsOffices, locationOptions, evaluateAppointmentValidations, systemConfigFor, staffSigRequiredToCompleteOf, telehealthRoomFor } from '../lib/settingsMasters'
import { svcList, payerForAppt, ensurePayer, svcRule, concurrentNote, svcOptionsFor, svcById, pcfsErrors, pcfFormatErrors, customFieldsForScope, CF_TEXT_FORMAT_RULES, rateFor } from '../lib/master'
import CfDefModal from './CfDefModal.jsx'
import { CfPickRow } from './CfPick.jsx'
import { LOCATIONS, STAFF_BY_ID } from '../lib/seed'
import { posFor } from '../lib/claims'
import SignaturePad from '../ui/SignaturePad'
import RecurrenceEditor from './RecurrenceEditor'
import { expandRule, legacyRecurrenceOf, retargetRule, ruleOf, sameRule, screenOccurrences, screenNote } from '../lib/recurrence'

export default function AppointmentModal({ mode, initial, onClose, onSaved, onBack, onCreate }) {
  const state = useStore()
  const { appts, staff, clients, settings, actions } = state
  // chunk-42: the status list (and its colours) is configured in Settings → Appointment Status
  const statusMap = statusMapFor(settings)
  const deadStatus = (k) => isCancelStatus(settings, k)
  const statusOrder = statusOrderFor(settings)
  const toast = useToast()
  const staffById = useMemo(() => Object.fromEntries(staff.map((s) => [s.id, s])), [staff])
  const clientsById = useMemo(() => Object.fromEntries(clients.map((c) => [c.id, c])), [clients])
  const T = TYPES[initial.type] || TYPES.service
  const isBillable = Boolean(T.billable) && initial.type !== 'break' && initial.type !== 'unavailable'
  // ---- type-aware form: each appointment type shows only its relevant fields & tabs ----
  const isDrive = initial.type === 'drive'
  const isBreak = initial.type === 'break'
  const isUnavail = initial.type === 'unavailable'
  const showClinic = ['service', 'evaluation', 'supervision'].includes(initial.type)
  // payer master hooks: service list from the master, contract rate overrides,
  // concurrent-billing & signature rules read live off the first client's payer
  const svcsAll = useMemo(() => svcList(state), [state.svcs])
  const svcsActive = useMemo(() => svcsAll.filter((x) => x.status !== 'inactive'), [svcsAll])
  const showClientPicker = showClinic
  const isSeries = Boolean(initial.seriesId)
  const siblings = useMemo(() => (initial.seriesId ? seriesSiblings(appts, initial) : []), [appts, initial.id])
  // the repeat rule being edited (null = doesn't repeat); a legacy series reads its old label
  const origRule = useMemo(() => (initial.seriesId ? ruleOf(initial, seriesSiblings(appts, initial)) : null), [initial.id])
  const [rule, setRuleState] = useState(origRule)
  const setRule = (r) => { setRuleState(r); setDirty(true) }
  const ruleChanged = !sameRule(rule, origRule)

  const fresh = (keep = {}) => {
    const x = { repeat: 'none', repeatCount: 8, status: 'active', verification: null, custom: {}, pcfs: {}, documents: [], ...initial, ...keep }
    // chunk-37: in NO way may a NEW appointment carry custom fields — even if some entry
    // point (duplicate/series/keep) tried to pass them through, the new modal starts empty.
    if (mode !== 'edit') x.pcfs = {}
    // Two distinct signatures: `signature` is the STAFF verification signature (who
    // verified the session); `clientSignature` is the client/guardian signature a
    // payer's rule asks for. One boolean never satisfied both — see audit CFG-04.
    x.verification = x.verification || { completedBy: '', checks: {}, verifyStatus: 'pending', note: '', signature: null, clientSignature: null }
    x.billingCode = x.billingCode || x.billing?.code || (x.type === 'drive' ? 'H2019' : svcById(state, x.service)?.code || '97151')
    x.units = x.billing ? x.billing.units : null
    x.rate = x.billing ? x.billing.rate : null
    x.distance = x.billing?.distance || 0
    x.mileage = x.type === 'drive' ? true : !!x.billing?.mileage
    const arrow = x.type === 'drive' && typeof x.location === 'string' && x.location.includes('→') ? x.location.split('→').map((t) => t.trim()) : []
    x.origin = x.origin ?? arrow[0] ?? ''
    x.destination = x.destination ?? arrow[1] ?? ''
    x.unavailTarget = x.unavailTarget || 'staff'
    const { billing, ...rest } = x
    return rest
  }

  const [f, setF] = useState(fresh)

  // smart staff suggestions for the selected client(s) — team affinity, history, role fit & free at this slot
  const suggestions = useMemo(() => {
    if (!showClinic || !f.clientIds.length) return []
    const cfg = smartCfg(settings)
    const wk = Array.from({ length: 7 }, (_, i) => isoDate(addDays(startOfWeek(parseISO(f.date), settings.weekStart), i)))
    return suggestStaff({
      staff,
      teams: state.teams,
      clients,
      appts,
      clientIds: f.clientIds,
      date: f.date,
      start: f.start,
      end: f.end,
      exclude: f.staffIds,
      ignoreIds: initial.id ? [initial.id] : [],
      load: weekLoad(appts, wk),
      limit: cfg.suggest.count,
      cfg,
      code: svcById(state, f.service)?.code || '',
      sameSite: f.location || '',
      weekDays: wk,
    })
  }, [f.type, f.clientIds, f.date, f.start, f.end, f.staffIds, f.service, f.location, appts, settings])
  const [tab, setTab] = useState('info')
  const [showErrs, setShowErrs] = useState(false)
  const [titleTouched, setTitleTouched] = useState(Boolean(initial.title))
  const [cfPick, setCfPick] = useState(false) // chunk-34: opt-in custom-field picker
  const [dirty, setDirty] = useState(false)
  const [confirmClose, setConfirmClose] = useState(false)
  const [scopePick, setScope] = useState('one') // one | following | all
  // a new repeat rule never applies to one occurrence alone (Google offers this & following, or all)
  const scope = ruleChanged && scopePick === 'one' ? 'following' : scopePick
  // Warn acknowledgement (audit CFG-02): a Warn-severity rule never blocks on its
  // own, but saving with warnings outstanding requires an explicit tick in the
  // Checks rail. The tick is bound to the exact warnings it acknowledged, so editing
  // the slot re-arms the gate.
  const [warnAckSig, setWarnAckSig] = useState(null)
  const fileRef = useRef(null)

  const set = (patch) => {
    setF((x) => ({ ...x, ...patch }))
    setDirty(true)
  }
  const setTime = (patch) => set({ ...patch, units: null })

  const tabs = [
    { id: 'info', label: 'Appointment Info', sub: 'Basic appointment details', icon: 'clipboard' },
    ...(T.hasVerification ? [{ id: 'verify', label: 'Verification', sub: 'Verify · checklist · signature', icon: 'checkCircle' }] : []),
    ...(T.hasDocs && !isDrive ? [{ id: 'docs', label: 'Documents', sub: 'Attach relevant documents', icon: 'file' }] : []),
    ...(isBillable && !isDrive ? [{ id: 'billing', label: 'Billing', sub: 'Units · rate · charge', icon: 'dollar' }] : []),
  ]

  // ---------- derived ----------
  const dur = Math.max(0, f.end - f.start)
  const telehealthRoom = telehealthRoomFor(settings, { location: f.location })
  const autoTitle = apptAutoTitle({ type: f.type, clientIds: f.clientIds, staffIds: f.staffIds, start: f.start, end: f.end, clients: clientsById, staff: Object.fromEntries(staff.map((x) => [x.id, x])), settings, serviceOverride: svcById(state, f.service)?.label || f.service, locationOverride: f.location })
  const title = (titleTouched ? f.title : f.title || autoTitle) || autoTitle
  const unavailTarget = f.unavailTarget || 'staff'
  const needsStaff = isUnavail ? unavailTarget === 'staff' : ['service', 'drive', 'evaluation', 'supervision'].includes(f.type)
  const needsClient = isUnavail ? unavailTarget === 'clients' : showClientPicker && ['service', 'evaluation'].includes(f.type)
  const billPayer = payerForAppt(state, f.clientIds)
  // chunk-38: an appointment's custom fields are ITS OWN picks — ids captured on this
  // appointment, resolved live against the Custom Fields master. The payer's profile
  // picks no longer leak in: a new appointment shows ZERO fields until the user
  // explicitly adds some (or defines a new template right there in the picker).
  // chunk-34: custom fields stay OPT-IN — nothing auto-populates, ever.
  const masterDefs = state.customFields || []
  const apptPcfDefs = Object.keys(f.pcfs || {}).map((id) => {
    const m = masterDefs.find((d) => d.id === id)
    if (m) return m
    const saved = (f.pcfs || {})[id]
    // template deleted from the master AFTER the value was captured — keep the value
    // readable (stored label/type) so nothing a user typed is ever destroyed
    return saved ? { id, label: saved.label || id, type: saved.type || 'text', options: saved.options || [], required: false, _stale: true } : null
  }).filter(Boolean)
  // the picker offers the templates scoped to Schedule Appointment (audit CFG-07) —
  // plus anything already captured here, so it can be removed — not the payer's picks
  const appointmentDefs = customFieldsForScope(state, 'appointment')
  const pickerDefs = masterDefs.filter((d) => (f.pcfs || {})[d.id] !== undefined || appointmentDefs.some((x) => x.id === d.id))
  const [cfEdit, setCfEdit] = useState(null) // 'new' | def — template editor, opened from INSIDE the picker
  const saveCf = (v) => {
    if (!v || typeof v !== 'object' || 'nativeEvent' in v || v.target) { setCfEdit(null); return }
    if (cfEdit === 'new') { actions.addCfDef(v); toast({ message: `Template “${v.label}” created — tick it to capture on this session`, kind: 'ok' }) }
    else { actions.updateCfDef({ id: cfEdit.id, ...v }); toast({ message: `Template “${v.label}” updated`, kind: 'ok' }) }
    setCfEdit(null)
  }
  const delDef = (t) => {
    actions.removeCfDef(t.id)
    const n = { ...(f.pcfs || {}) }
    delete n[t.id]
    set({ pcfs: n })
    toast({ message: `Template “${t.label}” removed from the master — a value already captured on this session is kept as saved`, kind: 'info' })
  }
  const statusCfg = statusFor(settings, f.status)
  const sysCfg = systemConfigFor(settings)
  // ⚡ ABA Hours — behavior-analytic staff time (non-service appointments only)
  const abaCfg = abaHoursCfg(settings)
  const abaAct = abaActivityById(f.abaActivity)
  const valReport = useMemo(
    () => evaluateAppointmentValidations(state, { ...f, id: mode === 'edit' ? f.id : '__draft__' }),
    [state, f.type, f.date, f.start, f.end, f.service, f.status, JSON.stringify(f.staffIds), JSON.stringify(f.clientIds), f.id, f.abaHr, f.abaActivity],
  )
  // Warn acknowledgement (audit CFG-02): the tick in the Checks rail is bound to the
  // exact warnings it acknowledged, so editing the slot re-arms the gate.
  const warnSig = JSON.stringify((valReport.warns || []).map((w) => w.id))
  const warnsAcked = Boolean(valReport.warns.length) && warnAckSig === warnSig
  const errors = []
  if (!f.date) errors.push('Pick a date')
  if (dur < SNAP) errors.push('End time must be after start time')
  if (needsStaff && !f.staffIds.length) errors.push('Add at least one staff member')
  if (needsClient && !f.clientIds.length) errors.push('Add a client')
  if (showClinic) {
    const live = apptPcfDefs.filter((d) => !d._stale)
    errors.push(...pcfsErrors(live, f.pcfs))
    errors.push(...pcfFormatErrors(live, f.pcfs)) // saved textFormat is enforced at save time
  }
  if (statusCfg?.noteRequired && !String(f.notes || '').trim()) {
    errors.push(`Status “${statusCfg.label}” requires a note`)
  }
  if (deadStatus(f.status) && !f.cancelReasonId) errors.push(`Pick why this session is “${statusCfg?.label || f.status}”`)
  if (f.status === 'completed' && statusCfg?.allowToComplete === false) {
    errors.push(`Status “${statusCfg.label}” cannot be completed`)
  }
  for (const stop of valReport.stops || []) {
    errors.push(`STOP · ${stop.label}: ${stop.message}`)
  }

  const conflicts = useMemo(() => {
    if (dur <= 0 || !f.date) return []
    const virtual = { ...f, id: mode === 'edit' ? f.id : '__draft__', title }
    return findConflicts(appts, virtual, staffById, clientsById, deadStatus)
  }, [appts, f.date, f.start, f.end, JSON.stringify(f.staffIds), JSON.stringify(f.clientIds), f.id, dur])

  // ---------- authorization guard + modelled risk (draft, not yet saved) ----------
  // The guard is evaluated against live state for every client on the booking, worst
  // first — a group session issues an authorization verdict for each family. `stop` is
  // the only outcome that refuses the save; warn/flag are recorded and shown.
  const authGuardCfgNow = authGuardCfg(settings)
  const authChecks = useMemo(() => {
    if (!showClinic || !f.clientIds.length) return []
    return f.clientIds
      .map((cid) => {
        const client = clientsById[cid]
        if (!client) return null
        const draft = { ...f, id: mode === 'edit' ? f.id : '__draft__' }
        // hours view (authBudget) + per-code units and the payer's rule pack (authUnits)
        return { client, ...mergeAuthChecks(authCheckFor(state, client, draft), unitCheckFor(state, client, draft, { today: todayISO() }), settings) }
      })
      .filter(Boolean)
      .sort((a, b) => ['ok', 'flag', 'warn', 'stop'].indexOf(b.severity) - ['ok', 'flag', 'warn', 'stop'].indexOf(a.severity))
  }, [state, f.clientIds, f.date, f.start, f.end, f.type, f.status, f.id, f.service, f.billingCode, JSON.stringify(f.staffIds), mode, showClinic, settings])
  const authBlock = authChecks.find((c) => c.blocked) || null
  const authWorst = authChecks[0] || null

  // ---------- know before you pick: a verdict for every person in each picker ----------
  // Worked out by the pickers only while their list is open, against this exact slot.
  const verdictDeps = [state, f.date, f.start, f.end, f.type, f.status, f.billingCode, f.service, JSON.stringify(f.staffIds), JSON.stringify(f.clientIds), f.id, mode]
  const staffVerdicts = useCallback(() => candidateVerdicts(state, { ...f, id: mode === 'edit' ? f.id : '__draft__' }, 'staff', { today: todayISO(), h24: settings.h24 }), verdictDeps)
  const clientVerdicts = useCallback(() => candidateVerdicts(state, { ...f, id: mode === 'edit' ? f.id : '__draft__' }, 'clients', { today: todayISO(), h24: settings.h24 }), verdictDeps)
  const checkedFor = f.date && dur > 0
    ? `${parseISO(f.date).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })} · ${fmtTime(f.start, settings.h24)}–${fmtTime(f.end, settings.h24)}`
    : ''

  const riskVerdict = useMemo(() => {
    if (!showClinic || !f.clientIds.length || !f.date) return null
    return riskFor(state, { ...f, id: mode === 'edit' ? f.id : '__draft__' })
  }, [state, f.clientIds, f.date, f.start, f.end, f.status, f.type, f.id, mode, showClinic])

  // C4: a new clinical booking that lands in a block which usually loses a session
  const obBoard = useMemo(() => (showClinic && mode !== 'edit' ? overbookBoard(state) : null), [state.appts, state.clients, state.settings, showClinic, mode])
  const obBlock = overbookBlockFor(obBoard, f, clientsById[(f.clientIds || [])[0]]?.office || '')

  // ---------- the rail's Checks panel: one calm list instead of stacked banners ----------
  // Required fields read as a quiet to-do until a save is attempted, then as must-fix.
  const toneOf = (sev) => (sev === 'stop' ? 'stop' : sev === 'warn' ? 'warn' : 'flag')
  const checkGroups = []
  const todo = errors.filter((e) => !e.startsWith('STOP · '))
  if (todo.length) {
    checkGroups.push({
      key: 'todo', tone: showErrs ? 'stop' : 'todo', icon: 'edit', testid: 'appt-check-todo',
      title: showErrs ? 'Fix to save' : 'Still to fill in', sub: `${todo.length} item${todo.length === 1 ? '' : 's'}`,
      lines: todo.map((e) => ({ text: `${e.replace(/\.$/, '')}.` })),
    })
  }
  if (conflicts.length) {
    checkGroups.push({
      key: 'clash', tone: 'warn', icon: 'clash', testid: 'appt-check-clash',
      title: 'Time clash', sub: `${conflicts.length} overlap${conflicts.length === 1 ? '' : 's'} on the calendar`,
      lines: conflicts.map((c) => ({ text: `${c.who} — “${c.other.title}” ${fmtTime(c.other.start, settings.h24)}–${fmtTime(c.other.end, settings.h24)}` })),
      foot: 'You can still save; the booking is flagged on the calendar.',
    })
  }
  if (authWorst && (authWorst.reasons.length > 0 || authWorst.notes.length > 0)) {
    const others = authChecks.filter((c) => c.severity !== 'ok' && c !== authWorst).map((c) => c.client.name)
    const unitRow = authWorst.units?.ledger?.codes.find((g) => g.code === authWorst.units.code)
    checkGroups.push({
      key: 'auth', tone: authWorst.severity === 'ok' ? 'flag' : toneOf(authWorst.severity), icon: 'shield', testid: 'appt-auth-guard',
      title: authWorst.headline, sub: authWorst.client.name,
      lines: authWorst.reasons.map((r) => ({ text: r })),
      notes: [...(others.length ? [`Also flagged: ${others.join(', ')}`] : []), ...authWorst.notes],
      extra: (
        <>
          {authWorst.stats && (
            <div className="am-authmeter">
              <span className="am-authmeter-track">
                <i className={`am-authmeter-fill tone-${AUTH_BANDS[authWorst.stats.band]?.tone || 'warn'}`} style={{ width: `${Math.max(2, Math.min(100, authWorst.stats.pct))}%` }} />
              </span>
              <span className="am-authmeter-nums">
                {authWorst.stats.committedHours}h committed · {authWorst.stats.remainingHours < 0 ? `${Math.abs(authWorst.stats.remainingHours)}h over` : `${authWorst.stats.remainingHours}h left`} of {authWorst.stats.window.authorizedHours}h
                {authWorst.stats.window.daysToExpiry != null ? ` · ${authWorst.stats.window.daysToExpiry < 0 ? 'window ended' : `${authWorst.stats.window.daysToExpiry}d to expiry`}` : ''}
              </span>
            </div>
          )}
          {authWorst.units && (
            <p className="bk-note" data-testid="appt-auth-units">
              This session: {authWorst.units.units} unit{authWorst.units.units === 1 ? '' : 's'} of {authWorst.units.code} ({authWorst.units.unitMins}-min units, {authWorst.units.rounding} rounding).
              {unitRow?.authorized ? ` ${unitRow.committed} of ${unitRow.authorized} authorized units committed.` : ''}
            </p>
          )}
        </>
      ),
      foot: authGuardCfgNow.mode === 'stop' && authWorst.severity === 'stop'
        ? 'Refused while Settings keeps the authorization guard in Stop mode.'
        : `You can still save — the practice's guard is set to ${authGuardCfgNow.mode}.`,
    })
  }
  if (riskVerdict && riskVerdict.band !== 'low' && riskVerdict.band !== 'done') {
    checkGroups.push({
      key: 'risk', tone: riskVerdict.band === 'high' ? 'warn' : 'flag', icon: 'pulse', testid: 'appt-risk',
      title: `Cancellation risk ${riskVerdict.score}/100`, sub: riskVerdict.action,
      lines: riskVerdict.factors.slice(0, 3).map((x) => ({ text: x.detail })),
      foot: `Modelled locally from this workspace's own history (practice rate ${Math.round(riskVerdict.model.base * 100)}%) — a prompt to confirm, never a reminder sent for you.`,
    })
  }
  if (obBlock) {
    const c = obBlock.checks[obBlock.safeK - 1]
    checkGroups.push({
      key: 'overbook', tone: 'flag', icon: 'users', testid: 'appt-overbook',
      title: 'This block usually loses a session', sub: `${DAY_SHORT[obBlock.dow]} · ${RISK_TIME_LABEL[obBlock.band]}`,
      lines: [{ text: `In ${c.hit} of the last ${obBlock.weeks} weeks at least ${obBlock.safeK === 1 ? 'one session was' : 'two sessions were'} lost here (${Math.round((obBlock.lost / Math.max(1, obBlock.sessions)) * 100)}% lost, ${Math.round(obBlock.rateNoShow * 100)}% no-shows).` }],
      foot: 'An extra session here belongs on a clinician who is free then, never as a second client on the same clinician. Advisory only; see Scheduler Insights → Overbooking.',
    })
  }
  // Schedule fit: continuity + caseload balance for the people picked, and open slots
  // when this one clashes. Advisory; a slot button only fills the form.
  const fitLines = useMemo(() => (showClinic ? fitNotes(state, { ...f, id: mode === 'edit' ? f.id : '__draft__' }) : []), verdictDeps)
  const slotsFor = useMemo(() => (conflicts.length ? openSlots(state, { ...f, id: mode === 'edit' ? f.id : '__draft__' }) : []), [...verdictDeps, conflicts.length])
  if (fitLines.length || slotsFor.length) {
    checkGroups.push({
      key: 'fit', tone: 'flag', icon: 'spark', testid: 'bk-fit',
      title: 'Schedule fit', sub: slotsFor.length ? 'Open slots for everyone picked' : 'Continuity and caseload',
      lines: fitLines,
      extra: slotsFor.length ? (
        <div className="bk-slots" data-testid="bk-slots">
          {slotsFor.map((sl, k) => (
            <button key={k} type="button" className="bk-slot" data-testid={`bk-slot-${k}`} onClick={() => setTime({ date: sl.date, start: sl.start, end: sl.end })}>
              {Icon.cal({ size: 12 })}<span>{slotText(sl, settings.h24)}</span>
            </button>
          ))}
        </div>
      ) : null,
      foot: `From this workspace's calendar, staff target hours and past sessions${slotsFor.length ? `; slots are inside the working day on practice days, with nobody picked busy or blocked out` : ''}. Nothing is booked until you save.`,
    })
  }
  if (valReport.items.length) {
    const top = valReport.stops.length ? 'stop' : valReport.warns.length ? 'warn' : 'flag'
    checkGroups.push({
      key: 'rules', tone: top, icon: 'clipboard', testid: 'appt-validation-banner',
      title: 'Practice rules', sub: top === 'stop' ? 'A stop rule blocks this booking' : top === 'warn' ? 'Warnings from Settings → Validations' : 'Flags from Settings → Validations',
      lines: valReport.items.map((item) => ({ tone: toneOf(item.severity), text: `${item.label}: ${item.message}` })),
      extra: valReport.warns.length ? (
        <label
          className={`checkrow ${warnsAcked ? 'on' : ''}`}
          data-testid="appt-ack-warns"
          style={{ marginTop: 6, cursor: 'pointer', alignItems: 'center' }}
          onClick={() => setWarnAckSig(warnsAcked ? null : warnSig)}
        >
          <span className="cb">{warnsAcked && Icon.check({ size: 10, strokeWidth: 3 })}</span>
          <span style={{ fontSize: 12, fontWeight: 600 }}>
            {warnsAcked
              ? `Warnings reviewed — saving is allowed`
              : `I've reviewed these ${valReport.warns.length} warning${valReport.warns.length === 1 ? '' : 's'} — save anyway`}
          </span>
        </label>
      ) : null,
    })
  }
  const checksHint = !f.staffIds.length || !f.clientIds.length
    ? 'Nothing stands in the way yet. Open the staff or client list to see who fits this slot before you pick.'
    : 'No clashes, authorization or practice-rule issues for this slot.'

  // ---------- billing ----------
  const code = BILL_CODES.find((c) => c.id === f.billingCode) || BILL_CODES[0]
  // payer override → payer service → service master → code (15-min, midpoint rule by default)
  const unitRule = unitRuleFor(state, { ...f, billingCode: code.id })
  const derivedUnits = f.type === 'drive' ? 0 : unitsFor(dur, unitRule.unitMins, unitRule.rounding)
  const units = f.units ?? derivedUnits
  const billRules = billPayer ? svcRule(billPayer) : null
  const svcOvr = billPayer && f.service ? (ensurePayer(billPayer).svcOv || {})[f.service] : null
  const rateRes = f.service ? rateFor(state, billPayer, f.service, code.id) : null
  const onContract = Boolean(rateRes && /contract/.test(rateRes.source))
  const svcMod = svcOvr?.modifier || (billPayer ? (ensurePayer(billPayer).svcs || []).find((x) => x.id === f.service)?.modifier : null)
  const rate = f.rate ?? (f.type === 'drive' ? 0 : rateRes && Number.isFinite(rateRes.rate) && rateRes.rate ? rateRes.rate : code.rate)
  // Two separate completion rules: the payer asks for a client/guardian signature,
  // the practice asks for a staff verification signature. They are checked apart.
  const payerSigRequired = Boolean(billRules?.appt?.sigRequired)
  const staffSigRequired = staffSigRequiredToCompleteOf(settings)
  const concNote = useMemo(() => concurrentNote(state, { payer: billPayer, svcId: f.service, clientId: (f.clientIds || [])[0], date: f.date, start: f.start, end: f.end, excludeId: f.id === '__draft__' ? undefined : f.id }), [f.date, f.start, f.end, f.service, JSON.stringify(f.clientIds), billPayer?.id, state.appts])
  const mileage = f.type === 'drive' ? true : !!f.mileage
  const distance = Number(f.distance) || 0
  const mileRate = settings.mileageRate ?? MILEAGE_RATE
  const charge = Math.round((units * rate + (mileage ? distance * mileRate : 0)) * 100) / 100

  // ---------- verification ----------
  const checksDone = VERIFY_CHECKS.filter((c) => f.verification?.checks?.[c.id]).length
  const signed = Boolean(f.verification?.signature)
  const clientSigned = Boolean(f.verification?.clientSignature)
  const guardianName = (f.clientIds || []).map((cid) => clientsById[cid]?.guardian).find(Boolean) || clientsById[(f.clientIds || [])[0]]?.name || 'client/guardian'

  const buildAppt = (date) => ({
    type: f.type,
    title,
    date,
    start: f.start,
    end: f.end,
    staffIds: f.staffIds,
    clientIds: f.clientIds,
    status: f.status,
    // a reason only travels with a cancellation status; un-cancelling clears it
    ...(deadStatus(f.status) ? { cancelReasonId: f.cancelReasonId, cancelReason: f.cancelReason } : reasonPatch(null)),
    location: f.type === 'drive' ? [f.origin, f.destination].filter(Boolean).join(' → ') || f.location || '' : f.location || '',
    ...(f.type === 'drive' ? { origin: f.origin || '', destination: f.destination || '' } : {}),
    ...(f.type === 'unavailable' ? { unavailTarget } : {}),
    service: f.service || '',
    pcfs: Object.keys(f.pcfs || {}).length ? f.pcfs : null,
    notes: f.notes || '',
    // ⚡ ABA Hr is a non-service flag: a service appointment never carries it (or an
    // activity), so switching type cannot smuggle behavior-analytic hours onto a session.
    abaHr: isServiceAppt(f) ? false : Boolean(f.abaHr),
    abaActivity: isServiceAppt(f) || !f.abaHr ? undefined : f.abaActivity || undefined,
    custom: f.custom || {},
    documents: f.documents || [],
    verification: f.verification,
    // the warn acknowledgement is recorded so the audit trail shows it was seen
    ...(valReport.warns.length && warnsAcked ? { warnsAcked: { n: valReport.warns.length, at: new Date().toISOString() } } : {}),
    billing: isBillable ? { code: code.id, unitMins: unitRule.unitMins, rounding: unitRule.rounding, minutes: dur, units, rate, mileage, distance, mileageRate: mileRate } : null,
  })

  const save = (andNew) => {
    setShowErrs(true)
    if (errors.length) {
      setTab('info')
      toast({ message: `Fix ${errors.length} item${errors.length > 1 ? 's' : ''} on Appointment Info`, kind: 'warn' })
      return
    }
    if (authBlock) {
      setTab('info')
      toast({
        message: `${authBlock.client.name} is past the authorization on file — ${authBlock.reasons[0] || ''} Change the guard in Settings → System → Authorization to save anyway.`,
        kind: 'warn',
      })
      return
    }
    if (payerSigRequired && f.status === 'completed' && !clientSigned) {
      toast({ message: `${billPayer?.name || 'This payer'} requires a client signature to complete — capture it on the Verification tab`, kind: 'warn' })
      setTab('verify')
      return
    }
    if (staffSigRequired && f.status === 'completed' && !signed) {
      toast({ message: 'The practice requires a staff verification signature before a session can be completed — capture it on the Verification tab', kind: 'warn' })
      setTab('verify')
      return
    }
    if (valReport.warns.length && !warnsAcked) {
      toast({ message: `Review the ${valReport.warns.length} warning${valReport.warns.length === 1 ? '' : 's'} from Settings → Validations, then tick “I've reviewed these warnings” in the Checks rail to save`, kind: 'warn' })
      return
    }
    if (mode === 'edit') {
      const patch = buildAppt(f.date)
      // series-wide edits, rule changes, and turning a single session into a series
      // are one scoped transaction (planSeriesTx): one Undo, locked sessions kept
      if ((isSeries && scope !== 'one') || ruleChanged) {
        const res = actions.seriesTx({ op: 'edit', id: f.id, scope: isSeries ? scope : 'all', draft: patch, ...(ruleChanged ? { rule } : {}) })
        if (!res.ok) { toast({ message: res.msg, kind: 'warn' }); return }
        onSaved(res.msg, res.firstId ? { id: res.firstId } : null)
        return
      }
      // one occurrence of a series: an exception that remembers its original slot
      const exception = isSeries ? { edited: true, ...(f.date !== initial.date ? { originalDate: initial.originalDate || initial.date } : {}) } : {}
      const res = actions.update(f.id, { ...patch, ...exception })
      if (res && res.ok === false) { toast({ message: res.msg, kind: 'warn' }); return }
      onSaved('Appointment updated', { id: f.id })
      return
    }
    // ----- create -----
    const repeating = Boolean(rule) && !onCreate
    const { dates, capped } = repeating ? expandRule(rule, f.date, { weekStart: settings.weekStart || 0 }) : { dates: [f.date], capped: false }
    const seriesId = dates.length > 1 ? uid() : undefined
    const drafts = dates.map((date) => ({
      id: uid(), ...buildAppt(date), date,
      recurrence: seriesId ? legacyRecurrenceOf(rule) : 'none',
      ...(seriesId ? { seriesId, rrule: { ...rule, dtstart: f.date } } : {}),
    }))
    // every occurrence is screened against the calendar plus those already accepted
    // (audit CFG-03): Stop rules, clashes and the authorization guard refuse a date,
    // warnings are named in the result; the dialog's own checks cover a single booking
    const screened = dates.length > 1 ? screenOccurrences(state, drafts) : { accepted: drafts, rejected: [], warns: {} }
    const created = screened.accepted.map(({ validationFlags, ...a }) => a)
    const rejected = screened.rejected
    if (!created.length) {
      const why = rejected[0] ? ` — ${rejected[0].date}: ${rejected[0].reasons[0]}` : ''
      toast({ message: `No occurrence can be booked${why}`, kind: 'warn' })
      return
    }
    if (onCreate) {
      const result = onCreate(created)
      if (!result.ok) { toast({ message: result.msg, kind: 'warn' }); return }
      onSaved(result.msg, created[0])
      return
    }
    const res = actions.create(created)
    if (!res.ok) { toast({ message: res.msg, kind: 'warn' }); return }
    const rejectedNote = `${screenNote(screened)}${capped ? ' · capped at 12 months ahead' : ''}`
    if (andNew) {
      setF(fresh({ id: uid(), date: f.date }))
      setTitleTouched(false)
      setDirty(false)
      setTab('info')
      toast({ message: `Created${created.length > 1 ? ` ${created.length} occurrences` : ''}${rejectedNote} — ready for the next one`, kind: 'ok' })
      return
    }
    onSaved(created.length > 1 ? `Created ${created.length} occurrences${rejectedNote}` : `Appointment created${rejectedNote}`, created[0])
  }

  const requestClose = () => (dirty ? setConfirmClose(true) : onClose())

  const attach = (files) => {
    const add = Array.from(files || []).map((fl) => ({ id: uid(), name: fl.name, size: fl.size, tag: 'Session note' }))
    if (add.length) set({ documents: [...(f.documents || []), ...add] })
  }
  const inputCls = (bad) => `input ${bad ? 'bad' : ''}`
  const showE = (k) => showErrs && errors.some((e) => e.toLowerCase().includes(k))
  const excludedOfficeNames = new Set(
    settingsOffices(settings)
      .filter((o) => o.excludeFromLocations || o.isLocation === false || o.active === false)
      .map((o) => o.name),
  )
  // POS rule (audit CFG-06): a payer that does not cover telehealth rendered from the
  // patient's home (POS-10) hides those locations from the picker for its clients.
  // The session's current location always stays pickable, so editing an existing
  // telehealth booking never blanks the field.
  const hideTeleHome = Boolean(billPayer?.rules?.hideTeleHome)
  const locOptions = [
    ...new Set([
      ...locationOptions(settings),
      ...LOCATIONS.filter((l) => !excludedOfficeNames.has(l)),
      ...Object.values(appts).map((a) => a.location).filter((l) => l && !excludedOfficeNames.has(l)),
      ...(f.location ? [f.location] : []),
    ]),
  ].filter((l) => !hideTeleHome || posFor({ location: l }) !== '10')
    .map((l) => ({ value: l, label: l }))

  const verifier = STAFF_BY_ID[f.verification?.completedBy]

  return (
    <div className="overlay" onKeyDown={(e) => { if (e.key === 'Escape' && !cfPick && cfEdit === null) requestClose() }} onMouseDown={(e) => e.target === e.currentTarget && requestClose()}>
      <div className="modal wizard" style={{ width: 'min(1320px, calc(100vw - 24px))', maxHeight: 'calc(100vh - 20px)' }} onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); save(false) } }} role="dialog" aria-modal="true" aria-label={`${mode === 'edit' ? 'Edit' : 'Create'} ${T.label} appointment`} tabIndex={-1} ref={(el) => el?.focus({ preventScroll: true })}>
        <div className="modal-head">
          {mode === 'create' && onBack && (
            <button className="iconbtn" onClick={onBack} title="Back to type picker" aria-label="Back">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M19 12H5M11 18l-6-6 6-6" />
              </svg>
            </button>
          )}
          <span style={{ background: T.color, width: 30, height: 30, borderRadius: 10, display: 'grid', placeItems: 'center', color: '#fff' }}>
            <TypeGlyph type={f.type} size={15} />
          </span>
          <h2>
            {mode === 'edit' ? 'Edit' : 'Create'} {T.label} Appointment
          </h2>
          <span className="sbadge">
            <i style={{ background: (statusMap[f.status] || STATUSES[f.status] || {}).color || (statusMap[f.status] || STATUSES[f.status] || {}).dot }} />
            {(statusMap[f.status] || STATUSES[f.status] || {}).label || f.status}
          </span>
          {isSeries && <span className="sbadge" title={`${siblings.length} occurrences in this series`}>{Icon.repeat({ size: 11 })} Series · {siblings.length}</span>}
          <span className="f1" />
          <button className="modal-x" onClick={requestClose} aria-label="Close">
            {Icon.x({ size: 14 })}
          </button>
        </div>

        <div className="modal-body">
          <div className="wiz">
            <nav className="steprail" aria-label="Appointment sections">
              {tabs.map((t) => {
                let badge = null
                if (t.id === 'info') badge = errors.length ? { cls: 'err', n: errors.length } : { cls: 'ok', n: '✓' }
                else if (t.id === 'verify') badge = signed ? { cls: 'ok', n: '✓' } : checksDone < VERIFY_CHECKS.length ? { cls: '', n: VERIFY_CHECKS.length - checksDone } : { cls: 'ok', n: '✓' }
                else if (t.id === 'docs') badge = f.documents?.length ? { cls: 'ok', n: '✓' } : null
                else if (t.id === 'billing') badge = charge <= 0 && f.type !== 'drive' ? { cls: '', n: '!' } : { cls: 'ok', n: '✓' }
                return (
                  <button key={t.id} className={`step ${tab === t.id ? 'on' : ''}`} onClick={() => setTab(t.id)}>
                    <span className="si">
                      {Icon[t.icon]({ size: 15 })}
                      {badge && (
                        <span className={`badge ${badge.cls}`}>
                          {badge.n === '✓' ? <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round"><path d="M4.5 12.5l5 5 10-11" /></svg> : badge.n}
                        </span>
                      )}
                    </span>
                    <span>
                      <b>{t.label}</b>
                      <span>{t.sub}</span>
                    </span>
                  </button>
                )
              })}
              <div className="rail-hint">
                <span className="kbd">Esc</span> close · <em style={{ color: 'var(--danger)', fontStyle: 'normal' }}>*</em> required
              </div>
            </nav>

            <div className="wiz-cols">
              <div className="wiz-main">
                {mode === 'edit' && isSeries && (
                  <div className="panel" style={{ borderColor: 'color-mix(in srgb, var(--accent) 40%, var(--line))', background: 'var(--accent-soft)', padding: '9px 12px', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 700, fontSize: 12 }}>{Icon.repeat({ size: 13 })} Repeating series — apply changes to:</span>
                    {[['one', 'This occurrence'], ['following', 'This & following'], ['all', `All ${siblings.length}`]].map(([v, l]) => (
                      <button key={v} type="button" data-testid={`scope-${v}`} className={`checkbox ${scope === v ? 'on' : ''}`} disabled={v === 'one' && ruleChanged} aria-pressed={scope === v} onClick={() => setScope(v)}>{l}</button>
                    ))}
                    <span className="rec-scope-note" data-testid="scope-note">
                      {scope === 'one'
                        ? 'Only this session changes; it becomes an exception to the series.'
                        : `${scope === 'following' && siblings[0]?.id !== initial.id ? 'Splits the series here: earlier sessions keep the old pattern. ' : ''}${ruleChanged || f.date !== initial.date ? 'Upcoming sessions are rebuilt from the repeat rule and single-session changes in that range are replaced. ' : 'Changed fields are copied; each session keeps its own other changes. '}Completed, cancelled, billed and payroll-approved sessions are never changed${ruleChanged || f.date !== initial.date ? ', and nothing dated before today is created or deleted' : ''}.`}
                    </span>
                  </div>
                )}

                {tab === 'info' && (
                  <>
                    <div className="panel">
                      <div className={`people${isUnavail || isDrive || isBreak ? ' single' : ''}`}>
                        {isUnavail && (
                          <div className="field" style={{ marginBottom: 12, gridColumn: '1 / -1' }}>
                            <label>Unavailable For</label>
                            <div className="seg-ctl" data-testid="unavail-target" role="group" aria-label="Who is being blocked out">
                              <button type="button" className={unavailTarget === 'staff' ? 'on' : ''} onClick={() => set({ unavailTarget: 'staff', clientIds: [] })}>
                                {Icon.user({ size: 13 })} Staff Members
                              </button>
                              <button type="button" className={unavailTarget === 'clients' ? 'on' : ''} onClick={() => set({ unavailTarget: 'clients', staffIds: [] })}>
                                {Icon.team({ size: 13 })} Clients
                              </button>
                            </div>
                          </div>
                        )}
                        {(!isUnavail || unavailTarget === 'staff') && (
                          <PeoplePicker label="Staff Name" required={needsStaff} people={staff} selected={f.staffIds} onChange={(v) => set({ staffIds: v })} verdicts={staffVerdicts} checkedFor={checkedFor} />
                        )}
                        {isUnavail
                          ? unavailTarget === 'clients' && <PeoplePicker label="Client Name" required={needsClient} people={clients} selected={f.clientIds} onChange={(v) => set({ clientIds: v })} verdicts={clientVerdicts} checkedFor={checkedFor} />
                          : showClientPicker && <PeoplePicker label="Client Name" required={needsClient} people={clients} selected={f.clientIds} onChange={(v) => set({ clientIds: v })} verdicts={clientVerdicts} checkedFor={checkedFor} />}
                      </div>
                      {showE('staff') && <div className="err" style={{ marginTop: 6 }}>Add at least one staff member</div>}
                      {showE('client') && <div className="err" style={{ marginTop: 6 }}>Add a client</div>}
                      {suggestions.length > 0 && (
                        <div className="sugrow" data-testid="staff-suggestions">
                          <span className="sug-l">{Icon.spark({ size: 12 })} Suggested for this client</span>
                          {suggestions.map((sg) => (
                            <button key={sg.staff.id} type="button" className="sug" data-testid={`sug-${sg.staff.id}`} onClick={() => set({ staffIds: [...f.staffIds, sg.staff.id] })} title={`Match ${sg.score} · ${[...sg.reasons, ...(sg.warnings || [])].join(' · ')}`}>
                              <PersonAvatar p={sg.staff} size={20} />
                              <b>{sg.staff.name.split(' ')[0]}</b>
                              <i>{sg.reasons[0]}</i>
                              {sg.warnings?.length > 0 && <i className="sug-warn"><ToneGlyph tone="warn" size={11} label={sg.warnings[0]} /> {sg.warnings[0]}</i>}
                            </button>
                          ))}
                        </div>
                      )}
                      <div className="field" style={{ marginTop: 12 }}>
                        <label>
                          Title <em>*</em>
                        </label>
                        <input data-testid="appt-title" className={inputCls()} value={title} placeholder={autoTitle} onChange={(e) => { setTitleTouched(true); set({ title: e.target.value }) }} />
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr 1fr', gap: '10px 12px', marginTop: 12 }}>
                        <div className="field">
                          <label>
                            Date <em>*</em>
                          </label>
                          <input data-testid="appt-date" type="date" className={inputCls(showE('date'))} value={f.date} onChange={(e) => { if (mode !== 'edit' && rule && e.target.value) setRuleState(retargetRule(rule, f.date, e.target.value)); set({ date: e.target.value }) }} />
                        </div>
                        <div className="field">
                          <label>
                            Start <em>*</em>
                          </label>
                          <input type="time" step={900} className={inputCls()} value={minToHM(f.start)} onChange={(e) => { const s = hmToMin(e.target.value || '09:00'); set({ start: s, end: Math.max(f.end, s + SNAP), units: null }) }} />
                        </div>
                        <div className="field">
                          <label>
                            End <em>*</em>
                          </label>
                          <input type="time" step={900} className={inputCls(showE('end'))} value={minToHM(f.end)} onChange={(e) => setTime({ end: Math.max(hmToMin(e.target.value || '10:00'), f.start + SNAP) })} />
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                        <span className="muted" style={{ fontSize: 12, fontWeight: 650 }}>Duration {fmtDur(dur)} · quick</span>
                        {[30, 45, 60, 90, 120, 150].map((m) => (
                          <button key={m} type="button" className={`checkbox ${dur === m ? 'on' : ''}`} onClick={() => setTime({ end: Math.min(f.start + m, 1440) })}>
                            {m < 60 ? `${m}m` : `${m / 60}h`}
                          </button>
                        ))}
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 10, marginTop: 12, alignItems: 'start' }}>
                        {onCreate ? <span /> : <RecurrenceEditor date={f.date} rule={rule} onChange={setRule} weekStart={settings.weekStart || 0} />}
                        {isServiceAppt(f) ? (
                          <span />
                        ) : (
                          <label
                            data-testid="aba-hr"
                            className={`checkbox ${f.abaHr ? 'on' : ''}`}
                            style={{ marginBottom: 1 }}
                            onClick={() => set({ abaHr: !f.abaHr, ...(f.abaHr ? { abaActivity: '' } : {}) })}
                            title={ABA_HOURS_EXPLAIN}
                          >
                            ⚡ ABA Hr
                          </label>
                        )}
                      </div>
                      {f.abaHr && !isServiceAppt(f) && (
                        <div className="am-ababox" data-testid="aba-hours-panel">
                          <div className="am-abahead">
                            <span>{Icon.zap({ size: 13 })}</span>
                            <div>
                              <b>ABA Hours — behavior-analytic time</b>
                              <span className="muted">{ABA_HOURS_EXPLAIN} It is not billed and does not touch any client authorization.</span>
                            </div>
                          </div>
                          <div className="field" style={{ marginTop: 8 }}>
                            <label>
                              Behavior-analytic activity <em>{abaCfg.requireActivity ? '*' : ''}</em>
                            </label>
                            <Dropdown
                              testid="aba-activity"
                              value={f.abaActivity || ''}
                              onChange={(v) => set({ abaActivity: v })}
                              options={[
                                { value: '', label: '— choose the activity —' },
                                ...ABA_QUALIFYING_ACTIVITIES.map((a) => ({ value: a.id, label: a.label, sub: a.hint })),
                                ...ABA_NON_QUALIFYING_ACTIVITIES.map((a) => ({ value: a.id, label: `✗ ${a.label}`, sub: a.hint })),
                              ]}
                            />
                            <div className="muted" style={{ fontSize: 11.5, marginTop: 4 }}>
                              {abaAct ? abaAct.hint : 'Counts: group training in behavior-analytic principles outside client sessions; graduate students designing or reviewing interventions in non-billable time. Never counts: cleaning the clinic, general admin such as stimulus preparation.'}
                            </div>
                          </div>
                          <div className="am-abaexamples">
                            <span className="am-abaok">Counts</span>
                            <ul>{ABA_HOURS_EXAMPLES.map((x) => <li key={x}>{x}</li>)}</ul>
                            <span className="am-abano">Never counts</span>
                            <ul>{ABA_HOURS_NON_EXAMPLES.map((x) => <li key={x}>{x}</li>)}</ul>
                          </div>
                          <div className="muted" data-testid="aba-hours-credit" style={{ marginTop: 6, fontSize: 11.5 }}>
                            {f.staffIds.length
                              ? `Credited to ${f.staffIds.map((id) => `${staffById[id]?.name || id} (${abaTrackFor(staffById[id]).label})`).join(', ')} — ${fmtDur(dur)} each.`
                              : 'Add a staff member so these hours can be credited to someone.'}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* clashes, authorization, risk and practice rules live in the rail's Checks panel */}

                    <div className="panel">
                      {showClinic && (
                      <>
                      <div className="grid2">
                        <div className="field">
                          <label>Location</label>
                          <Dropdown testid="location-select" searchable creatable value={f.location || ''} onChange={(v) => set({ location: v })} options={locOptions} placeholder="Search or enter your location" />
                          {telehealthRoom && (
                            <div className="muted" data-testid="am-telehealth-room" style={{ fontSize: 11.5, marginTop: 4 }}>
                              Video room: <a href={telehealthRoom} target="_blank" rel="noopener noreferrer">{telehealthRoom}</a> · your practice’s own link; this app does not host video
                            </div>
                          )}
                        </div>
                        <div className="field">
                          <label>Service</label>
                          <Dropdown
                            testid="service-select"
                            value={f.service || ''}
                            onChange={(v) => {
                              const sv = svcById(state, v)
                              set({ service: v, billingCode: sv ? sv.code : f.billingCode, units: null, rate: null })
                            }}
                            placeholder="Select Service"
                            options={[{ value: '', label: 'Select Service' }, ...svcOptionsFor(state, f.clientIds).map((s) => ({ value: s.id, label: s.label, sub: s.payerLocal ? `${s.code} · ${s.payerName} only` : `bills under ${s.code}` }))]}
                          />
                        </div>
                      </div>
                      {(concNote || onContract) && (
                        <div className="am-notes">
                          {concNote && <div className={`am-note ${concNote.level}`} data-testid="am-conc">{concNote.text}</div>}
                          {onContract && <div className="am-note info" data-testid="am-rate-ovr">Charge rate ${Number(rateRes.rate).toFixed(2)} comes from the {rateRes.source} for this service{svcMod ? ` · modifier ${svcMod}` : ''}.</div>}
                        </div>
                      )}
                      {showClinic && (
                        <div className="pcf-card" data-testid="am-pcf">
                          <div className="pcf-head">{Icon.badge({ size: 12 })} Custom fields<i>optional · nothing pre-filled · add only what you capture</i>
                            <button type="button" className="btn btn-sm pcf-addbtn" data-testid="am-pcf-add" onClick={() => setCfPick(true)}>{Icon.plus({ size: 12 })} Add Custom Fields</button>
                          </div>
                          {apptPcfDefs.length === 0 && <div className="muted pcf-empty" data-testid="am-pcf-empty">No custom fields on this appointment yet — “Add Custom Fields” lists the templates scoped to Schedule Appointment, and you can define a new one right there.</div>}
                          {apptPcfDefs.map((d) => (
                            d._stale ? (
                              <div className="pcf-f pcf-stale" key={d.id} data-testid={`pcf-f-${d.id}`}>
                                <label>{d.label}<i className="muted"> · template removed from master — kept as saved</i></label>
                                <div className="muted" style={{ fontSize: 12.5 }}>
                                  {Array.isArray((f.pcfs || {})[d.id]?.value) ? ((f.pcfs || {})[d.id].value.join(', ') || '—') : ((f.pcfs || {})[d.id]?.value === '' || (f.pcfs || {})[d.id]?.value == null ? '—' : String((f.pcfs || {})[d.id].value))}
                                </div>
                                <button type="button" className="iconbtn pcf-x" aria-label="Remove custom field" data-testid={`pcf-del-${d.id}`}
                                  onClick={() => { const n = { ...(f.pcfs || {}) }; delete n[d.id]; set({ pcfs: n }) }}>{Icon.x({ size: 12 })}</button>
                              </div>
                            ) : (
                            <div className={`pcf-f pcf-f-${d.type}${(f.pcfs || {})[d.id]?.value ? ' filled' : ''}`} key={d.id} data-testid={`pcf-f-${d.id}`}>
                              <label>{d.label}{d.required && ' *'}{['text', 'textarea'].includes(d.type) && d.textFormat && d.textFormat !== 'any' && CF_TEXT_FORMAT_RULES[d.textFormat] ? <i className="muted"> · must be {CF_TEXT_FORMAT_RULES[d.textFormat].label}</i> : null}</label>
                              {d.type === 'text' && <input className="input" value={(f.pcfs || {})[d.id]?.value || ''} data-testid={`pcf-in-${d.id}`} onChange={(e) => set({ pcfs: { ...(f.pcfs || {}), [d.id]: { label: d.label, type: d.type, value: e.target.value } } })} />}
                              {d.type === 'textarea' && <textarea className="input py-ta" rows={3} value={(f.pcfs || {})[d.id]?.value || ''} data-testid={`pcf-in-${d.id}`} onChange={(e) => set({ pcfs: { ...(f.pcfs || {}), [d.id]: { label: d.label, type: d.type, value: e.target.value } } })} />}
                              {d.type === 'date' && <input className="input" type="datetime-local" value={(f.pcfs || {})[d.id]?.value || ''} data-testid={`pcf-in-${d.id}`} onChange={(e) => set({ pcfs: { ...(f.pcfs || {}), [d.id]: { label: d.label, type: d.type, value: e.target.value } } })} />}
                              {(d.type === 'select' || d.type === 'multi') && (
                                <div className="pcf-chips" data-testid={`pcf-chips-${d.id}`}>
                                  {(d.options || []).map((op) => {
                                    const cur = (f.pcfs || {})[d.id]?.value
                                    const on = d.type === 'select' ? cur === op : Array.isArray(cur) && cur.includes(op)
                                    return (
                                      <button key={op} type="button" className={`tag pick${on ? ' on' : ''}`} data-testid={`pcf-opt-${d.id}-${op}`}
                                        onClick={() => set({ pcfs: { ...(f.pcfs || {}), [d.id]: { label: d.label, type: d.type, value: d.type === 'select' ? (on ? '' : op) : (on ? cur.filter((x) => x !== op) : [...(cur || []), op]) } } })}>
                                        {op}
                                      </button>
                                    )
                                  })}
                                </div>
                              )}
                              {d.type === 'toggle' && (
                                <div className="pcf-chips" data-testid={`pcf-tog-${d.id}`}>
                                  {[d.offLabel || 'No', d.onLabel || 'Yes'].map((lb, ix) => (
                                    <button key={lb + ix} type="button" className={`tag pick${(f.pcfs || {})[d.id]?.value === lb ? ' on' : ''}`} data-testid={`pcf-toption-${d.id}-${ix}`}
                                      onClick={() => set({ pcfs: { ...(f.pcfs || {}), [d.id]: { label: d.label, type: d.type, value: lb } } })}>{lb}</button>
                                  ))}
                                </div>
                              )}
                              {d.type === 'signature' && (
                                <div className="pcf-sigbox" data-testid={`pcf-sig-${d.id}`}>
                                  <SignaturePad
                                    value={(f.pcfs || {})[d.id]?.value}
                                    staffName={staffById[f.staffIds?.[0]]?.name || ''}
                                    staffId={f.staffIds?.[0] || ''}
                                    certification={staffById[f.staffIds?.[0]]?.cert}
                                    onChange={(sig) => set({ pcfs: { ...(f.pcfs || {}), [d.id]: { label: d.label, type: d.type, value: sig } } })}
                                  />
                                </div>
                              )}
                              <button type="button" className="iconbtn pcf-x" aria-label="Remove custom field" data-testid={`pcf-del-${d.id}`}
                                onClick={() => { const n = { ...(f.pcfs || {}) }; delete n[d.id]; set({ pcfs: n }) }}>{Icon.x({ size: 12 })}</button>
                            </div>
                            )
                          ))}
                        </div>
                      )}
                      {cfPick && showClinic && (
                        <div className="overlay pm-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) setCfPick(false) }}>
                          <div className="modal pm-modal py-modal" data-testid="am-pcf-picker" role="dialog" aria-modal="true" aria-label="Add custom fields">
                            <div className="modal-head pm-head">
                              <h3>Add custom fields</h3>
                              <span className="muted" style={{ fontSize: 11.5, marginLeft: 10 }}>templates scoped to Schedule Appointment in the Custom Fields master — or define a new one below</span>
                              <span className="an-spacer" />
                              <button className="iconbtn modal-x" aria-label="Close" data-testid="am-pcf-picker-close" onClick={() => setCfPick(false)}>{Icon.x({ size: 14 })}</button>
                            </div>
                            <div className="modal-body">
                              <div className="cf-picklist">
                                {pickerDefs.length === 0 && <div className="muted pd-cfempty" style={{ padding: '18px 2px' }}>No appointment-scoped templates yet — scope one to Schedule Appointment on the master page, or create one with “Add template” below.</div>}
                                {pickerDefs.map((d) => {
                                  const on = (f.pcfs || {})[d.id] !== undefined
                                  return (
                                    <CfPickRow key={d.id} def={d} on={on} disabled={d.status === 'inactive' && !on} testid={`am-pcf-pick-${d.id}`}
                                      onToggle={(v) => {
                                        const n = { ...(f.pcfs || {}) }
                                        if (v) n[d.id] = { label: d.label, type: d.type, value: d.type === 'multi' ? [] : '' }
                                        else delete n[d.id]
                                        set({ pcfs: n })
                                      }}>
                                      <button className="iconbtn" title="Edit this template — opens the full field editor" data-testid={`am-cfm-edit-${d.id}`} onClick={(e) => { e.preventDefault(); e.stopPropagation(); setCfEdit(d) }}>{Icon.edit({ size: 12 })}</button>
                                      <button className="iconbtn" title="Delete this template from the master" data-testid={`am-cfm-del-${d.id}`} onClick={(e) => { e.preventDefault(); e.stopPropagation(); delDef(d) }}>{Icon.trash({ size: 12 })}</button>
                                    </CfPickRow>
                                  )
                                })}
                              </div>
                            </div>
                            <div className="modal-foot">
                              <button className="btn btn-sm" data-testid="am-cfm-new" onClick={() => setCfEdit('new')}>{Icon.plus({ size: 12 })} Add template</button>
                              <span className="an-spacer" />
                              <button className="btn btn-sm btn-primary" data-testid="am-pcf-picker-done" onClick={() => setCfPick(false)}>Done</button>
                            </div>
                          </div>
                        </div>
                      )}
                      {cfPick && cfEdit !== null && <CfDefModal def={cfEdit === 'new' ? null : cfEdit} onClose={saveCf} />}
                      </>
                    )}
                    {isDrive && (
                      <div className="grid2" style={{ marginTop: 12 }}>
                        <div className="field">
                          <label>Starting Point</label>
                          <Dropdown testid="drive-origin" searchable creatable value={f.origin || ''} onChange={(v) => set({ origin: v })} options={locOptions} placeholder="Search or enter your location" />
                        </div>
                        <div className="field">
                          <label>Destination</label>
                          <Dropdown testid="drive-destination" searchable creatable value={f.destination || ''} onChange={(v) => set({ destination: v })} options={locOptions} placeholder="Search or enter your location" />
                        </div>
                      </div>
                    )}
                    {isDrive && (
                      <div className="grid2" style={{ marginTop: 12 }}>
                        <div className="field">
                          <label>Total Distance (miles)</label>
                          <input data-testid="drive-distance" type="number" min={0} step={0.5} className="input" value={f.distance || ''} placeholder="0" onChange={(e) => set({ distance: Number(e.target.value) || 0 })} />
                        </div>
                        <div className="field">
                          <label>Mileage charge</label>
                          <div className="input" style={{ borderStyle: 'dashed', fontWeight: 750, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                            <span>${(distance * mileRate).toFixed(2)}</span>
                            <span className="muted" style={{ fontWeight: 600, textAlign: 'right' }}>{distance || 0} mi × ${mileRate.toFixed(2)}/mi · auto-billed under H2019</span>
                          </div>
                        </div>
                      </div>
                    )}
                    
                      <div className="field" style={{ marginTop: 12 }}>
                        <label>{isBreak || isUnavail ? 'Add Any Comments' : 'Notes'}</label>
                        <textarea className="input" placeholder={isBreak || isUnavail ? 'Write your comments…' : 'Write your notes…'} value={f.notes || ''} onChange={(e) => set({ notes: e.target.value })} />
                      </div>
                    </div>


                  </>
                )}

                {tab === 'verify' && (
                  <>
                    <div className="panel">
                      <h3>
                        <span className="pi">{Icon.checkCircle({ size: 14 })}</span> Verify Appointment Completion
                      </h3>
                      <div className="grid2">
                        <div className="field">
                          <label>Completed by</label>
                          <Dropdown
                            testid="verifier-select"
                            searchable
                            value={f.verification?.completedBy || ''}
                            onChange={(v) => set({ verification: { ...f.verification, completedBy: v } })}
                            placeholder="Select verifier"
                            options={[{ value: '', label: '—' }, ...staff.map((s) => ({ value: s.id, label: s.name, sub: `${s.role} · ${s.cert}` }))]}
                          />
                        </div>
                        <div className="field">
                          <label>Verification status</label>
                          <Dropdown
                            testid="verifystatus-select"
                            value={f.verification?.verifyStatus || 'pending'}
                            onChange={(v) => set({ verification: { ...f.verification, verifyStatus: v } })}
                            options={[
                              { value: 'pending', label: 'Pending' },
                              { value: 'verified', label: 'Verified' },
                              { value: 'flagged', label: 'Flagged for review' },
                            ]}
                          />
                        </div>
                      </div>
                      <div style={{ marginTop: 10 }}>
                        {VERIFY_CHECKS.map((c) => {
                          const on = !!f.verification?.checks?.[c.id]
                          return (
                            <div key={c.id} className={`checkrow ${on ? 'on' : ''}`} onClick={() => set({ verification: { ...f.verification, checks: { ...f.verification?.checks, [c.id]: !on } } })}>
                              <span className="cb">{on && Icon.check({ size: 10, strokeWidth: 3 })}</span>
                              <span style={{ fontSize: 12.5, fontWeight: 600 }}>{c.label}</span>
                            </div>
                          )
                        })}
                      </div>
                      <div className="field" style={{ marginTop: 10 }}>
                        <label>Verifier notes</label>
                        <textarea className="input" style={{ minHeight: 54 }} placeholder="Anything a supervisor should know…" value={f.verification?.note || ''} onChange={(e) => set({ verification: { ...f.verification, note: e.target.value } })} />
                      </div>
                    </div>

                    {payerSigRequired && (
                      <div className={`am-note ${clientSigned ? 'ok' : 'warn'}`} data-testid="am-sig-note">
                        {clientSigned ? `Client/guardian signature captured — ${billPayer?.name || 'this payer'} completion requirement met.` : `${billPayer?.name || 'This payer'} requires a client signature to complete this appointment.`}
                      </div>
                    )}
                    {staffSigRequired && (
                      <div className={`am-note ${signed ? 'ok' : 'warn'}`} data-testid="am-staffsig-note">
                        {signed ? 'Staff verification signature captured — the practice completion requirement is met.' : 'The practice requires a staff verification signature before this appointment can be completed.'}
                      </div>
                    )}
                    <div data-testid="am-staff-sig">
                      <div className="muted" style={{ fontSize: 11.5, marginBottom: 4 }}>Staff verification signature — who verified this session</div>
                      <SignaturePad
                        value={f.verification?.signature}
                        staffName={(verifier || staffById[f.staffIds?.[0]] || {}).name}
                        staffId={verifier?.id || f.staffIds?.[0] || ''}
                        certification={(verifier || staffById[f.staffIds?.[0]] || {}).cert}
                        onChange={(sig) =>
                          set({
                            verification: { ...f.verification, signature: sig, completedBy: f.verification?.completedBy || sig?.staffId || '', verifyStatus: sig ? 'verified' : f.verification?.verifyStatus },
                          })
                        }
                      />
                    </div>
                    {payerSigRequired && (
                      <div style={{ marginTop: 10 }} data-testid="am-client-sig">
                        <div className="muted" style={{ fontSize: 11.5, marginBottom: 4 }}>{billPayer?.name} requires a client/guardian signature — {guardianName}</div>
                        <SignaturePad
                          value={f.verification?.clientSignature}
                          staffName={guardianName}
                          staffId=""
                          certification=""
                          onChange={(sig) => set({ verification: { ...f.verification, clientSignature: sig ? { ...sig, kind: 'client' } : null } })}
                        />
                      </div>
                    )}
                  </>
                )}

                {tab === 'docs' && (
                  <div className="panel">
                    <h3>
                      <span className="pi">{Icon.file({ size: 14 })}</span> Attach Relevant Documents
                    </h3>
                    <div
                      className="dropzone"
                      onClick={() => fileRef.current?.click()}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => {
                        e.preventDefault()
                        attach(e.dataTransfer.files)
                      }}
                    >
                      {Icon.download({ size: 18 })}
                      <div style={{ marginTop: 6 }}>
                        Drop files here or <b style={{ color: 'var(--accent)' }}>browse</b>
                      </div>
                      <div style={{ fontSize: 10.5, marginTop: 3 }}>Consents, reports, IEPs — file names are kept in this demo</div>
                    </div>
                    <input ref={fileRef} type="file" multiple hidden onChange={(e) => attach(e.target.files)} />
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
                      {(f.documents || []).map((d) => (
                        <div key={d.id} className="doc-row">
                          <span className="di">{Icon.file({ size: 15 })}</span>
                          <span style={{ flex: 1, minWidth: 0 }}>
                            <div className="dn">{d.name}</div>
                            <div className="dsz">{d.size ? `${Math.max(1, Math.round(d.size / 1024))} KB` : 'file'}</div>
                          </span>
                          <div style={{ width: 170 }}>
                            <Dropdown buttonClassName="input btn-sm" value={d.tag} onChange={(v) => set({ documents: f.documents.map((x) => (x.id === d.id ? { ...x, tag: v } : x)) })} options={PAY_TAGS} />
                          </div>
                          <button className="iconbtn" onClick={() => set({ documents: f.documents.filter((x) => x.id !== d.id) })} aria-label="Remove document">
                            {Icon.trash({ size: 14 })}
                          </button>
                        </div>
                      ))}
                      {!f.documents?.length && <span className="muted" style={{ fontSize: 12 }}>No documents yet.</span>}
                    </div>
                  </div>
                )}

                {tab === 'billing' && isBillable && (
                  <>
                    <div className="panel" style={{ paddingBottom: 10 }}>
                      <h3 style={{ margin: 0 }}>
                        <span className="pi">{Icon.user({ size: 14 })}</span> {f.clientIds.map((c) => clientsById[c]?.name).filter(Boolean).join(', ') || (f.type === 'drive' ? 'Travel billing' : 'Billing')}
                      </h3>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1.7fr 1fr', gap: 12, alignItems: 'start' }}>
                      <div className="panel">
                        <div className="billgrid">
                          <div className="field">
                            <label>Billing Minutes</label>
                            <input type="number" step={15} min={15} className={inputCls()} value={dur} onChange={(e) => setTime({ end: Math.min(f.start + Math.max(15, Number(e.target.value) || 0), 1440) })} />
                          </div>
                          <div className="field">
                            <label>Units</label>
                            <input type="number" step={0.25} min={0} className={inputCls()} value={units} disabled={f.type === 'drive'} onChange={(e) => set({ units: Number(e.target.value) })} />
                          </div>
                          <div className="field">
                            <label>Billing Code</label>
                            <Dropdown testid="billing-code" value={code.id} onChange={(v) => set({ billingCode: v, units: null, rate: null })} options={BILL_CODES.map((c) => ({ value: c.id, label: c.id, sub: c.label.split(' · ')[1] }))} />
                          </div>
                        </div>
                        <div className="grid2" style={{ marginTop: 12 }}>
                          <div className="field">
                            <label>Distance (miles)</label>
                            <input type="number" step={0.5} min={0} className={inputCls()} placeholder="Enter distance" value={f.distance || ''} onChange={(e) => set({ distance: Number(e.target.value), mileage: true })} />
                          </div>
                          <div className="field">
                            <label>Code description</label>
                            <input className="input" value={code.label} disabled style={{ opacity: 0.75 }} />
                          </div>
                        </div>
                        {f.type !== 'drive' && (
                          <label className={`checkbox ${f.mileage ? 'on' : ''}`} style={{ marginTop: 10 }} onClick={() => set({ mileage: !f.mileage })}>
                            + Reimburse travel ({distance || 0} mi × ${mileRate.toFixed(2)})
                          </label>
                        )}
                        <p className="muted" style={{ fontSize: 11, margin: '10px 0 2px' }}>
                          {f.type === 'drive'
                            ? `Drive time billed as mileage: ${distance || 0} mi × $${mileRate.toFixed(2)}/mi = $${(distance * mileRate).toFixed(2)}`
                            : `${dur} min in ${unitRule.unitMins}-min units (${unitRule.rounding} rounding) = ${units} unit${units === 1 ? '' : 's'} × $${Number(rate).toFixed(2)}${mileage ? ` + $${(distance * mileRate).toFixed(2)} mileage` : ''}`}
                        </p>
                      </div>
                      <div className="panel billpreview">
                        <h3 style={{ color: 'var(--accent)' }}>
                          <span className="pi">{Icon.file({ size: 14 })}</span> Billing Preview
                        </h3>
                        <div className="field" style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 10, padding: '8px 10px' }}>
                          <label>Rate Per Unit{svcOvr?.charge ? ' · contract' : ''}</label>
                          <input
                            type="number"
                            step={0.5}
                            min={0}
                            className="input"
                            style={{ border: 0, padding: 0, background: 'transparent', fontWeight: 700 }}
                            value={f.type === 'drive' ? mileRate : rate}
                            disabled={f.type === 'drive'}
                            onChange={(e) => set({ rate: Number(e.target.value) })}
                          />
                        </div>
                        <div className={`chargebar ${charge <= 0 ? 'zero' : ''}`} style={{ marginTop: 10 }}>
                          <span>Charge</span>
                          <span>${charge.toFixed(2)}</span>
                        </div>
                      </div>
                    </div>
                  </>
                )}
              </div>

              <aside className="wiz-rail no-print">
                <div className="panel">
                  <h3>
                    <span className="pi">{Icon.checkCircle({ size: 14 })}</span> Status
                  </h3>
                  <Dropdown testid="status-select" value={f.status} onChange={(v) => set({ status: v })} options={statusOrder.map((s) => ({ value: s, label: statusMap[s]?.label || s }))} />
                  {deadStatus(f.status) && (
                    <label className="fld" style={{ display: 'block', marginTop: 8 }}>
                      <span className="muted" style={{ fontSize: 12 }}>Cancellation reason</span>
                      <Dropdown
                        testid="cancel-reason-select"
                        value={f.cancelReasonId || ''}
                        placeholder="Why was it cancelled?"
                        onChange={(v) => set(reasonPatch(cancelReasonOptions(settings).find((o) => o.id === v)))}
                        options={cancelReasonOptions(settings).map((o) => ({ value: o.id, label: o.label }))}
                      />
                    </label>
                  )}
                  <button data-testid="save-appt" className="btn btn-primary" style={{ width: '100%', justifyContent: 'center', marginTop: 12 }} onClick={() => save(false)}>
                    {mode === 'edit' ? 'Save Changes' : 'Create Appointment'}
                  </button>
                  {mode === 'create' && !onCreate && (
                    <button className="btn btn-ghost btn-sm" style={{ width: '100%', justifyContent: 'center', marginTop: 6 }} onClick={() => save(true)}>
                      {Icon.plus({ size: 12 })} Save & start another
                    </button>
                  )}
                </div>
                <BookingChecks groups={checkGroups} hint={checksHint} />
                <div className="panel" style={{ fontSize: 12, display: 'grid', gap: 6 }}>
                  <span style={{ fontWeight: 700 }}>Summary</span>
                  <span className="muted">{title} · {fmtDur(dur)}</span>
                  <span className="muted">
                    {f.staffIds.length} staff · {f.clientIds.length} client{f.clientIds.length === 1 ? '' : 's'}
                    {rule && mode !== 'edit' && !onCreate ? ` · ×${expandRule(rule, f.date, { weekStart: settings.weekStart || 0 }).dates.length}` : ''}
                  </span>
                  {isBillable && <span style={{ color: 'var(--ok)', fontWeight: 700 }}>Billable ${charge.toFixed(2)}</span>}
                  {signed && <span style={{ color: 'var(--ok)', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 4 }}>{Icon.check({ size: 12, strokeWidth: 2.4 })} Signed by {f.verification.signature.staffName}</span>}
                  {conflicts.length > 0 && (
                    <span style={{ color: 'var(--danger)', fontWeight: 700 }}>
                      {conflicts.length} conflict{conflicts.length > 1 ? 's' : ''}
                    </span>
                  )}
                </div>
              </aside>
            </div>
          </div>
        </div>
      </div>

      {confirmClose && (
        <div className="overlay" style={{ zIndex: 220 }}>
          <div className="modal" style={{ width: 'min(360px, 90vw)' }} role="alertdialog" aria-label="Discard changes">
            <div className="modal-body" style={{ padding: 18 }}>
              <b style={{ fontSize: 14 }}>Discard unsaved changes?</b>
              <p className="muted" style={{ margin: '6px 0 14px', fontSize: 12.5 }}>Your edits to this appointment have not been saved.</p>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button className="btn btn-sm" onClick={() => setConfirmClose(false)}>
                  Keep editing
                </button>
                <button className="btn btn-sm" style={{ color: '#fff', background: 'var(--danger)', borderColor: 'var(--danger)' }} onClick={onClose}>
                  Discard
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
