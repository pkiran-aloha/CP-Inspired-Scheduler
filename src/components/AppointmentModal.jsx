import React, { useMemo, useRef, useState } from 'react'
import { PersonAvatar } from '../ui/avatars'
import { useStore } from '../state/store'
import { useToast } from '../ui/Toast'
import { Icon, TypeGlyph } from '../ui/Icons'
import { PeoplePicker, Dropdown, MultiSelect } from './fields'
import { fmtDur, fmtTime, hmToMin, minToHM, startOfWeek, addDays, isoDate, parseISO } from '../lib/date'
import {
  BILL_CODES,
  CUSTOM_FIELDS,
  MILEAGE_RATE,
  PAY_TAGS,
  RECURRENCES,
  SERVICES,
  SNAP,
  STATUSES,
  STATUS_ORDER,
  TYPES,
  VERIFY_CHECKS,
  findConflicts,
  timeOverlap,
  uid,
  seriesSiblings,
  seriesDatesFor,
  planScopedPatch,
  planSeriesRebuild,
} from '../lib/model'
import { suggestStaff, smartCfg } from '../lib/smart'
import { apptAutoTitle } from '../lib/apptName'
import { svcList, payerForAppt, ensurePayer, svcRule, concurrentNote, svcOptionsFor, svcById, payerFieldDefs, pcfsErrors, rateFor } from '../lib/master'
import { CfPickRow } from './CfPick.jsx'
import { LOCATIONS, STAFF_BY_ID } from '../lib/seed'
import SignaturePad from '../ui/SignaturePad'

export default function AppointmentModal({ mode, initial, onClose, onSaved, onBack }) {
  const state = useStore()
  const { appts, staff, clients, settings, actions } = state
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

  const fresh = (keep = {}) => {
    const x = { repeat: 'none', repeatCount: 8, status: 'active', verification: null, custom: {}, pcfs: {}, documents: [], ...initial, ...keep }
    // chunk-37: in NO way may a NEW appointment carry custom fields — even if some entry
    // point (duplicate/series/keep) tried to pass them through, the new modal starts empty.
    if (mode !== 'edit') x.pcfs = {}
    x.verification = x.verification || { completedBy: '', checks: {}, verifyStatus: 'pending', note: '', signature: null }
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
      load: Object.fromEntries(staff.map((x) => [x.id, 0])),
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
  const [scope, setScope] = useState('one') // one | following | all
  const [rebuild, setRebuild] = useState(false)
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
  const autoTitle = apptAutoTitle({ type: f.type, clientIds: f.clientIds, staffIds: f.staffIds, start: f.start, end: f.end, clients: clientsById, staff: Object.fromEntries(staff.map((x) => [x.id, x])), settings, serviceOverride: svcById(state, f.service)?.label || f.service, locationOverride: f.location })
  const title = (titleTouched ? f.title : f.title || autoTitle) || autoTitle
  const unavailTarget = f.unavailTarget || 'staff'
  const needsStaff = isUnavail ? unavailTarget === 'staff' : ['service', 'drive', 'evaluation', 'supervision'].includes(f.type)
  const needsClient = isUnavail ? unavailTarget === 'clients' : showClientPicker && ['service', 'evaluation'].includes(f.type)
  const billPayer = payerForAppt(state, f.clientIds)
  // chunk-36: appointments offer ONLY the payer's picked, master-defined templates.
  // Nothing pre-selects, nothing is addable that doesn't exist in the Custom Fields
  // master, and legacy inline entries can never reach an appointment.
  const pcfDefs = payerFieldDefs(state, billPayer).filter((d) => d.label && d.source === 'master')
  // chunk-34: custom fields are OPT-IN per appointment — nothing auto-populates.
  const pcfAdded = pcfDefs.filter((d) => (f.pcfs || {})[d.id] !== undefined)
  // switching client/payer can leave fields captured for the OLD payer — never keep those
  React.useEffect(() => {
    const cur = f.pcfs || {}
    const orphans = Object.keys(cur).filter((k) => !pcfDefs.some((d) => d.id === k))
    if (orphans.length) set({ pcfs: Object.fromEntries(Object.entries(cur).filter(([k]) => !orphans.includes(k))) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [billPayer?.id, showClinic])
  const errors = []
  if (!f.date) errors.push('Pick a date')
  if (dur < SNAP) errors.push('End time must be after start time')
  if (needsStaff && !f.staffIds.length) errors.push('Add at least one staff member')
  if (needsClient && !f.clientIds.length) errors.push('Add a client')
  if (showClinic && pcfAdded.length) errors.push(...pcfsErrors(pcfAdded, f.pcfs))

  const conflicts = useMemo(() => {
    if (dur <= 0 || !f.date) return []
    const virtual = { ...f, id: mode === 'edit' ? f.id : '__draft__', title }
    return findConflicts(appts, virtual, staffById, clientsById)
  }, [appts, f.date, f.start, f.end, JSON.stringify(f.staffIds), JSON.stringify(f.clientIds), f.id, dur])

  // ---------- billing ----------
  const code = BILL_CODES.find((c) => c.id === f.billingCode) || BILL_CODES[0]
  const derivedUnits = f.type === 'drive' ? 0 : Math.max(0, Math.round((dur / code.unitMins) * 4) / 4)
  const units = f.units ?? derivedUnits
  const billRules = billPayer ? svcRule(billPayer) : null
  const svcOvr = billPayer && f.service ? (ensurePayer(billPayer).svcOv || {})[f.service] : null
  const rateRes = f.service ? rateFor(state, billPayer, f.service, code.id) : null
  const onContract = Boolean(rateRes && /contract/.test(rateRes.source))
  const svcMod = svcOvr?.modifier || (billPayer ? (ensurePayer(billPayer).svcs || []).find((x) => x.id === f.service)?.modifier : null)
  const rate = f.rate ?? (f.type === 'drive' ? 0 : rateRes && Number.isFinite(rateRes.rate) && rateRes.rate ? rateRes.rate : code.rate)
  const sigReq = Boolean(billRules?.appt?.sigRequired)
  const concNote = useMemo(() => concurrentNote(state, { payer: billPayer, svcId: f.service, clientId: (f.clientIds || [])[0], date: f.date, start: f.start, end: f.end, excludeId: f.id === '__draft__' ? undefined : f.id }), [f.date, f.start, f.end, f.service, JSON.stringify(f.clientIds), billPayer?.id, state.appts])
  const mileage = f.type === 'drive' ? true : !!f.mileage
  const distance = Number(f.distance) || 0
  const mileRate = settings.mileageRate ?? MILEAGE_RATE
  const charge = Math.round((units * rate + (mileage ? distance * mileRate : 0)) * 100) / 100

  // ---------- verification ----------
  const checksDone = VERIFY_CHECKS.filter((c) => f.verification?.checks?.[c.id]).length
  const signed = Boolean(f.verification?.signature)

  const buildAppt = (date) => ({
    type: f.type,
    title,
    date,
    start: f.start,
    end: f.end,
    staffIds: f.staffIds,
    clientIds: f.clientIds,
    status: f.status,
    location: f.type === 'drive' ? [f.origin, f.destination].filter(Boolean).join(' → ') || f.location || '' : f.location || '',
    ...(f.type === 'drive' ? { origin: f.origin || '', destination: f.destination || '' } : {}),
    ...(f.type === 'unavailable' ? { unavailTarget } : {}),
    service: f.service || '',
    pcfs: Object.keys(f.pcfs || {}).length ? f.pcfs : null,
    notes: f.notes || '',
    abaHr: f.abaHr,
    recurrence: f.repeat,
    custom: f.custom || {},
    documents: f.documents || [],
    verification: f.verification,
    billing: isBillable ? { code: code.id, unitMins: code.unitMins, minutes: dur, units, rate, mileage, distance, mileageRate: mileRate } : null,
  })

  const clashFor = (draft, ignoreIds) =>
    Object.values(appts).some((b) => {
      if (b.date !== draft.date || b.status === 'cancelled') return false
      if (ignoreIds?.has(b.id)) return false
      if (!timeOverlap(draft.start, draft.end, b.start, b.end)) return false
      return (draft.staffIds || []).some((s) => (b.staffIds || []).includes(s)) || (draft.clientIds || []).some((c) => (b.clientIds || []).includes(c))
    })

  const save = (andNew) => {
    setShowErrs(true)
    if (errors.length) {
      setTab('info')
      toast({ message: `Fix ${errors.length} item${errors.length > 1 ? 's' : ''} on Appointment Info`, kind: 'warn' })
      return
    }
    if (sigReq && f.status === 'completed' && !signed) {
      toast({ message: `${billPayer?.name || 'This payer'} requires a client signature to complete — capture it on the Verification tab`, kind: 'warn' })
      setTab('verify')
      return
    }
    if (mode === 'edit') {
      const patch = buildAppt(f.date)
      if (isSeries && scope !== 'one') {
        const { updates } = planScopedPatch(appts, { id: f.id, seriesId: initial.seriesId, date: initial.date }, scope, patch)
        actions.create(updates.map((u) => ({ ...u, edited: false })))
        onSaved(scope === 'all' ? `Updated all ${updates.length} occurrences` : `Updated this & ${updates.length - 1} following`, { id: f.id })
        return
      }
      actions.update(f.id, { ...patch, ...(isSeries ? { edited: true } : {}) })
      // repeat-rule rebuild: regenerate future occurrences of the series
      if (isSeries && rebuild && f.repeat !== (initial.recurrence || 'none')) {
        const { deleteIds, newDates } = planSeriesRebuild(appts, initial, f.repeat, f.repeatCount)
        actions.remove(deleteIds)
        const skip = new Set(deleteIds)
        const created = newDates
          .map((date) => ({ ...buildAppt(date), id: uid(), seriesId: initial.seriesId, recurrence: f.repeat, date }))
          .filter((d) => !clashFor(d, skip))
        if (created.length) actions.create(created)
        onSaved(`Series rebuilt — ${created.length + 1} occurrences under “${RECURRENCES.find((r) => r.id === f.repeat)?.label}”`, { id: f.id })
        return
      }
      onSaved('Appointment updated', { id: f.id })
      return
    }
    // ----- create -----
    const dates = seriesDatesFor(f.date, f.repeat, f.repeatCount)
    const created = []
    let skipped = 0
    const seriesId = f.repeat === 'none' ? undefined : uid()
    for (const date of dates) {
      const draft = { ...buildAppt(date), date }
      if (dates.length > 1 && clashFor(draft)) {
        skipped++
        continue
      }
      created.push({ id: uid(), seriesId, recurrence: f.repeat, ...draft })
    }
    if (!created.length) {
      toast({ message: 'All occurrences conflict with existing bookings', kind: 'warn' })
      return
    }
    actions.create(created)
    if (andNew) {
      setF(fresh({ id: uid(), date: f.date }))
      setTitleTouched(false)
      setDirty(false)
      setTab('info')
      toast({ message: `Created${created.length > 1 ? ` ${created.length} occurrences` : ''} — ready for the next one`, kind: 'ok' })
      return
    }
    onSaved(created.length > 1 ? `Created ${created.length} occurrences${skipped ? ` · ${skipped} skipped (conflict)` : ''}` : `Appointment created${skipped ? ` · ${skipped} skipped (conflict)` : ''}`, created[0])
  }

  const requestClose = () => (dirty ? setConfirmClose(true) : onClose())

  const attach = (files) => {
    const add = Array.from(files || []).map((fl) => ({ id: uid(), name: fl.name, size: fl.size, tag: 'Session note' }))
    if (add.length) set({ documents: [...(f.documents || []), ...add] })
  }
  const inputCls = (bad) => `input ${bad ? 'bad' : ''}`
  const showE = (k) => showErrs && errors.some((e) => e.toLowerCase().includes(k))
  const locOptions = [...new Set([...LOCATIONS, ...Object.values(appts).map((a) => a.location).filter(Boolean)])].map((l) => ({ value: l, label: l }))

  const verifier = STAFF_BY_ID[f.verification?.completedBy]

  return (
    <div className="overlay" onKeyDown={(e) => e.key === 'Escape' && requestClose()} onMouseDown={(e) => e.target === e.currentTarget && requestClose()}>
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
            <i style={{ background: STATUSES[f.status]?.dot }} />
            {STATUSES[f.status]?.label}
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
                      <button key={v} type="button" data-testid={`scope-${v}`} className={`checkbox ${scope === v ? 'on' : ''}`} onClick={() => setScope(v)}>{l}</button>
                    ))}
                    {f.repeat !== (initial.recurrence || 'none') && (
                      <label className={`checkbox ${rebuild ? 'on' : ''}`} style={{ marginLeft: 'auto' }} onClick={() => setRebuild((r) => !r)}>
                        ↻ Rebuild future occurrences with “{RECURRENCES.find((r) => r.id === f.repeat)?.label}”
                      </label>
                    )}
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
                          <PeoplePicker label="Staff Name" required={needsStaff} people={staff} selected={f.staffIds} onChange={(v) => set({ staffIds: v })} />
                        )}
                        {isUnavail
                          ? unavailTarget === 'clients' && <PeoplePicker label="Client Name" required={needsClient} people={clients} selected={f.clientIds} onChange={(v) => set({ clientIds: v })} />
                          : showClientPicker && <PeoplePicker label="Client Name" required={needsClient} people={clients} selected={f.clientIds} onChange={(v) => set({ clientIds: v })} />}
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
                              {sg.warnings?.length > 0 && <i className="sug-warn">⚠ {sg.warnings[0]}</i>}
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
                          <input data-testid="appt-date" type="date" className={inputCls(showE('date'))} value={f.date} onChange={(e) => set({ date: e.target.value })} />
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
                      <div style={{ display: 'grid', gridTemplateColumns: '190px 110px 1fr auto', gap: 10, marginTop: 12, alignItems: 'end' }}>
                        <div className="field">
                          <label>Repeats</label>
                          <Dropdown
                            testid="repeat-select"
                            value={f.repeat}
                            onChange={(v) => set({ repeat: v })}
                            options={RECURRENCES.map((r) => ({ value: r.id, label: r.label }))}
                          />
                        </div>
                        {f.repeat !== 'none' ? (
                          <>
                            <div className="field">
                              <label>Occurrences</label>
                              <input data-testid="repeat-count" type="number" min={1} max={104} className="input" value={f.repeatCount} onChange={(e) => set({ repeatCount: Number(e.target.value) })} />
                            </div>
                            <div className="field">
                              <label>Through</label>
                              <div className={inputCls()} style={{ display: 'grid', placeItems: 'center', borderStyle: 'dashed' }}>
                                {seriesDatesFor(f.date, f.repeat, f.repeatCount).slice(-1)[0] || '—'}
                              </div>
                            </div>
                          </>
                        ) : (
                          <span />
                        )}
                        {showClinic ? (
                          <label data-testid="aba-hr" className={`checkbox ${f.abaHr ? 'on' : ''}`} style={{ marginBottom: 1 }} onClick={() => set({ abaHr: !f.abaHr })} title="Counts toward the client's authorized ABA hours">
                            ⚡ ABA Hr
                          </label>
                        ) : (
                          <span />
                        )}
                      </div>
                    </div>

                    {conflicts.length > 0 && (
                      <div className="warnbox danger">
                        <span>{Icon.alert({ size: 16 })}</span>
                        <div>
                          <b>Scheduling conflict</b>
                          {conflicts.slice(0, 3).map((c) => (
                            <div key={c.other.id} style={{ marginTop: 3 }}>
                              Overlaps “{c.other.title}” ({fmtTime(c.other.start, settings.h24)}–{fmtTime(c.other.end, settings.h24)}) — {c.who}
                            </div>
                          ))}
                          <span className="muted">You can still save; the booking gets flagged on the calendar.</span>
                        </div>
                      </div>
                    )}

                    <div className="panel">
                      {showClinic && (
                      <>
                      <div className="grid2">
                        <div className="field">
                          <label>Location</label>
                          <Dropdown testid="location-select" searchable creatable value={f.location || ''} onChange={(v) => set({ location: v })} options={locOptions} placeholder="Search or enter your location" />
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
                      {showClinic && pcfDefs.length > 0 && (
                        <div className="pcf-card" data-testid="am-pcf">
                          <div className="pcf-head">{Icon.badge({ size: 12 })} Custom fields — {billPayer.name}<i>optional · nothing pre-filled · add only what {billPayer.name}’s profile picks</i>
                            <button type="button" className="btn btn-sm pcf-addbtn" data-testid="am-pcf-add" onClick={() => setCfPick(true)}>{Icon.plus({ size: 12 })} Add Custom Fields</button>
                          </div>
                          {pcfAdded.length === 0 && <div className="muted pcf-empty" data-testid="am-pcf-empty">Nothing pre-filled — “Add Custom Fields” offers the {pcfDefs.length} field{pcfDefs.length === 1 ? '' : 's'} this payer picked on the master. Nothing is enforced unless a template itself is required.</div>}
                          {pcfAdded.map((d) => (
                            <div className={`pcf-f pcf-f-${d.type}${(f.pcfs || {})[d.id]?.value ? ' filled' : ''}`} key={d.id} data-testid={`pcf-f-${d.id}`}>
                              <label>{d.label}{d.required && ' *'}</label>
                              {d.type === 'text' && <input className="input" value={(f.pcfs || {})[d.id]?.value || ''} data-testid={`pcf-in-${d.id}`} onChange={(e) => set({ pcfs: { ...(f.pcfs || {}), [d.id]: { label: d.label, type: d.type, value: e.target.value } } })} />}
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
                          ))}
                        </div>
                      )}
                      {cfPick && showClinic && pcfDefs.length > 0 && (
                        <div className="overlay pm-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) setCfPick(false) }}>
                          <div className="modal pm-modal py-modal" data-testid="am-pcf-picker" role="dialog" aria-modal="true" aria-label="Add custom fields">
                            <div className="modal-head pm-head">
                              <h3>Add custom fields — {billPayer.name}</h3>
                              <span className="muted" style={{ fontSize: 11.5, marginLeft: 10 }}>tick the payer's templates to capture on this session</span>
                              <span className="an-spacer" />
                              <button className="iconbtn modal-x" aria-label="Close" data-testid="am-pcf-picker-close" onClick={() => setCfPick(false)}>{Icon.x({ size: 14 })}</button>
                            </div>
                            <div className="modal-body">
                              <div className="cf-picklist">
                                {pcfDefs.map((d) => {
                                  const on = (f.pcfs || {})[d.id] !== undefined
                                  return (
                                    <CfPickRow key={d.id} def={d} on={on} testid={`am-pcf-pick-${d.id}`}
                                      onToggle={(v) => {
                                        const n = { ...(f.pcfs || {}) }
                                        if (v) n[d.id] = { label: d.label, type: d.type, value: d.type === 'multi' ? [] : '' }
                                        else delete n[d.id]
                                        set({ pcfs: n })
                                      }} />
                                  )
                                })}
                              </div>
                            </div>
                            <div className="modal-foot"><button className="btn btn-sm btn-primary" data-testid="am-pcf-picker-done" onClick={() => setCfPick(false)}>Done</button></div>
                          </div>
                        </div>
                      )}
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

                    <div className="panel">
                      <h3>
                        <span className="pi">{Icon.spark({ size: 14 })}</span> Custom Fields
                      </h3>
                      <div className="grid2">
                        {CUSTOM_FIELDS.map((cf) => {
                          const v = f.custom?.[cf.id]
                          const upd = (nv) => set({ custom: { ...f.custom, [cf.id]: nv } })
                          if (cf.kind === 'select')
                            return (
                              <div className="field" key={cf.id}>
                                <label>{cf.label}</label>
                                <Dropdown testid={`cf-${cf.id}`} value={v || ''} onChange={upd} placeholder="—" options={[{ value: '', label: '—' }, ...cf.options.map((o) => ({ value: o, label: o }))]} />
                              </div>
                            )
                          if (cf.kind === 'multiselect')
                            return (
                              <div className="field" key={cf.id}>
                                <label>{cf.label}</label>
                                <MultiSelect testid={`cf-${cf.id}`} values={Array.isArray(v) ? v : []} onChange={upd} options={cf.options} placeholder="Pick focus areas…" />
                              </div>
                            )
                          if (cf.kind === 'toggle')
                            return (
                              <div className="field" key={cf.id}>
                                <label>{cf.label}</label>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '2px 0' }}>
                                  <button type="button" className={`toggle ${v ? 'on' : ''}`} onClick={() => upd(!v)} />
                                  <span className="muted" style={{ fontSize: 11.5 }}>{v ? 'Yes' : 'No'}</span>
                                </div>
                              </div>
                            )
                          return (
                            <div className="field" key={cf.id}>
                              <label>{cf.label}</label>
                              <input className="input" value={v || ''} placeholder="Text…" onChange={(e) => upd(e.target.value)} />
                            </div>
                          )
                        })}
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

                    {sigReq && (
                      <div className={`am-note ${signed ? 'ok' : 'warn'}`} data-testid="am-sig-note">
                        {signed ? `Signature captured — ${billPayer.name} completion requirement met.` : `${billPayer.name} requires a client signature to complete this appointment.`}
                      </div>
                    )}
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
                            <Dropdown buttonClassName="input btn-sm" style={{ padding: '5px 10px' }} value={d.tag} onChange={(v) => set({ documents: f.documents.map((x) => (x.id === d.id ? { ...x, tag: v } : x)) })} options={PAY_TAGS} />
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
                            : `${dur} min ÷ ${code.unitMins} min per unit = ${units} unit${units === 1 ? '' : 's'} × $${Number(rate).toFixed(2)}${mileage ? ` + $${(distance * mileRate).toFixed(2)} mileage` : ''}`}
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
                  <Dropdown testid="status-select" value={f.status} onChange={(v) => set({ status: v })} options={STATUS_ORDER.map((s) => ({ value: s, label: STATUSES[s].label }))} />
                  <button data-testid="save-appt" className="btn btn-primary" style={{ width: '100%', justifyContent: 'center', marginTop: 12 }} onClick={() => save(false)}>
                    {mode === 'edit' ? 'Save Changes' : 'Create Appointment'}
                  </button>
                  {mode === 'create' && (
                    <button className="btn btn-ghost btn-sm" style={{ width: '100%', justifyContent: 'center', marginTop: 6 }} onClick={() => save(true)}>
                      {Icon.plus({ size: 12 })} Save & start another
                    </button>
                  )}
                </div>
                {errors.length > 0 && showErrs && (
                  <div className="warnbox danger" style={{ flexDirection: 'column', gap: 4 }}>
                    {errors.map((e) => (
                      <span key={e}>• {e}</span>
                    ))}
                  </div>
                )}
                <div className="panel" style={{ fontSize: 12, display: 'grid', gap: 6 }}>
                  <span style={{ fontWeight: 700 }}>Summary</span>
                  <span className="muted">{title} · {fmtDur(dur)}</span>
                  <span className="muted">
                    {f.staffIds.length} staff · {f.clientIds.length} client{f.clientIds.length === 1 ? '' : 's'}
                    {f.repeat !== 'none' ? ` · ×${seriesDatesFor(f.date, f.repeat, f.repeatCount).length}` : ''}
                  </span>
                  {isBillable && <span style={{ color: 'var(--ok)', fontWeight: 700 }}>Billable ${charge.toFixed(2)}</span>}
                  {signed && <span style={{ color: 'var(--ok)', fontWeight: 700 }}>✓ Signed by {f.verification.signature.staffName}</span>}
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
