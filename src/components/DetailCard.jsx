import React, { useMemo, useState } from 'react'
import { PersonAvatar } from '../ui/avatars'
import { useStore } from '../state/store'
import { useToast } from '../ui/Toast'
import { Icon } from '../ui/Icons'
import { addDays, fmtDayLabel, fmtDur, fmtRange, isoDate, parseISO, startOfWeek, todayISO } from '../lib/date'
import { needsCoverFor, backfillFor } from '../lib/smart'
import { computeBilling, RECURRENCES, STATUSES, TYPES, VERIFY_CHECKS, findConflicts, seriesSiblings, uid } from '../lib/model'

export default function DetailCard({ appt, onClose, onEdit }) {
  const state = useStore()
  const { appts, staff, clients, settings, actions } = state
  const claimOfAppt = appt.claimId ? state.claims?.[appt.claimId] : null
  const toast = useToast()
  const [confirmDel, setConfirmDel] = useState(false)
  const t = TYPES[appt.type] || TYPES.service
  const staffById = Object.fromEntries(staff.map((s) => [s.id, s]))
  const clientById = Object.fromEntries(clients.map((c) => [c.id, c]))
  const bill = computeBilling(appt)
  const conflicts = useMemo(() => findConflicts(appts, appt, staffById, clientById), [appts, appt.id, appt.date, appt.start, appt.end])
  const series = useMemo(() => (appt.seriesId ? seriesSiblings(appts, appt) : []), [appts, appt.seriesId, appt.id])
  const nowIso = todayISO()
  const nextOcc = series.find((s) => s.date > appt.date && s.date >= nowIso) || series.find((s) => s.date > appt.date)
  const isPast = appt.date < nowIso || (appt.date === nowIso && appt.end <= new Date().getHours() * 60 + new Date().getMinutes())
  const ver = appt.verification
  const signed = ver?.signature

  const cover = useMemo(() => {
    if (!needsCoverFor(appt)) return []
    const wk = Array.from({ length: 7 }, (_, i) => isoDate(addDays(startOfWeek(parseISO(appt.date), settings.weekStart), i)))
    return backfillFor(state, appt, wk)
  }, [appts, appt.id, appt.status, settings.smart])
  const assignCover = (c) => {
    const prev = { status: appt.status, staffIds: appt.staffIds, backfilled: appt.backfilled, backfillIgnored: appt.backfillIgnored }
    actions.update(appt.id, { status: 'active', staffIds: [c.staff.id], backfilled: true, backfilledFrom: appt.staffIds || [], backfillIgnored: false })
    toast({ message: `Backfilled — ${c.staff.name.split(' ')[0]} now covers this session`, kind: 'ok', action: { label: 'Undo', onClick: () => actions.update(appt.id, prev) } })
  }
  const authOf = (cid) => {
    const cl = clientById[cid]
    if (!cl?.authWeekly) return null
    const wk = new Set(Array.from({ length: 7 }, (_, i) => isoDate(addDays(startOfWeek(parseISO(appt.date), settings.weekStart), i))))
    const mins = Object.values(appts)
      .filter((a) => a.id !== appt.id && wk.has(a.date) && a.status !== 'cancelled' && (a.type === 'service' || a.type === 'evaluation') && (a.clientIds || []).includes(cid))
      .reduce((t, a) => t + (a.end - a.start), 0)
    return { booked: Math.round(mins / 6) / 10, auth: cl.authWeekly }
  }
  const setStatus = (s, extra = {}) => {
    const prev = { status: appt.status, edited: appt.edited }
    actions.update(appt.id, { status: s, ...extra })
    toast({ message: `Marked ${STATUSES[s].label}${extra.edited ? ' (exception on this occurrence)' : ''}`, kind: 'ok', action: { label: 'Undo', onClick: () => actions.update(appt.id, prev) } })
  }
  const quickVerify = () => {
    const sigStaff = staffById[ver?.completedBy || appt.staffIds?.[0]] || staff[0]
    actions.update(appt.id, {
      status: 'completed',
      verification: {
        completedBy: sigStaff.id,
        checks: Object.fromEntries(VERIFY_CHECKS.map((c) => [c.id, true])),
        verifyStatus: 'verified',
        note: 'Quick-verified from calendar',
        signature: { mode: 'type', text: sigStaff.name, staffId: sigStaff.id, staffName: sigStaff.name, certification: sigStaff.cert, timestamp: new Date().toISOString(), geo: null },
      },
    })
    toast({ message: 'Session completed & signed ✓', kind: 'ok', action: { label: 'Undo', onClick: () => actions.undo() } })
  }
  const revert = () => {
    const pattern = series.find((s) => s.id !== appt.id && !s.edited)
    if (!pattern) {
      toast({ message: 'No unedited sibling to revert to', kind: 'warn' })
      return
    }
    actions.update(appt.id, {
      start: pattern.start,
      end: pattern.end,
      title: pattern.title,
      location: pattern.location,
      service: pattern.service,
      notes: pattern.notes,
      abaHr: pattern.abaHr,
      billing: pattern.billing,
      status: pattern.status,
      edited: false,
    })
    toast({ message: 'Occurrence reverted to series default', kind: 'ok', action: { label: 'Undo', onClick: () => actions.undo() } })
  }
  const duplicate = () => {
    const copy = { ...appt, id: uid(), title: `${appt.title} (copy)`, status: 'active', seriesId: undefined, recurrence: 'none', createdAt: Date.now() }
    actions.create([copy])
    toast({ message: 'Duplicated on same day', kind: 'ok' })
    onClose()
  }
  const del = (scope) => {
    if (scope === 'one' || !appt.seriesId) actions.remove([appt.id])
    else {
      const ids = series.filter((a) => (scope === 'following' ? a.date >= appt.date : true)).map((a) => a.id)
      actions.remove(ids)
    }
    onClose()
    const n = scope === 'all' ? series.length : scope === 'following' ? series.filter((a) => a.date >= appt.date).length : 1
    toast({ message: n > 1 ? `Deleted ${n} occurrences` : 'Appointment deleted', kind: 'warn', action: { label: 'Undo', onClick: () => actions.undo() } })
  }

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()} onKeyDown={(e) => e.key === 'Escape' && onClose()} tabIndex={-1} ref={(el) => el?.focus({ preventScroll: true })}>
      <div className="modal detail" data-testid="detail-card" role="dialog" aria-modal="true" aria-label={appt.title} style={{ '--c': t.color }}>
        <div className="dh">
          <div className="row">
            <span style={{ background: t.color, color: '#fff', width: 26, height: 26, borderRadius: 9, display: 'grid', placeItems: 'center' }}>
              {Icon[t.icon]({ size: 14 })}
            </span>
            <span className="sbadge">{t.label}</span>
            <span className="sbadge">
              <i style={{ background: STATUSES[appt.status]?.dot }} />
              {STATUSES[appt.status]?.label}
            </span>
            {appt.abaHr && <span className="sbadge" title="Counts toward authorized ABA hours">⚡ ABA hr</span>}
            {appt.edited && appt.seriesId && <span className="sbadge" title="This occurrence was changed independently from the series">✎ exception</span>}
            {appt.backfilled && <span className="sbadge backfilled" data-testid="backfilled-badge" title="Reassigned from a cancelled booking via smart backfill">↩ backfilled</span>}
            <span className="f1" />
            <button className="modal-x" onClick={onClose} aria-label="Close">{Icon.x({ size: 13 })}</button>
          </div>
          <h2>{appt.title}</h2>
          <div style={{ color: 'var(--text-2)', fontSize: 12.5, fontWeight: 600 }}>
            {fmtDayLabel(appt.date, 'full')} · {fmtRange(appt.start, appt.end, settings.h24)} · {fmtDur(appt.end - appt.start)}
          </div>
        </div>

        <div className="body">
          {conflicts.length > 0 && (
            <div className="warnbox danger">
              {Icon.alert({ size: 15 })}
              <span>
                <b>Overlaps:</b> {conflicts.map((c) => `${c.other.title} (${c.who})`).join('; ')}
              </span>
            </div>
          )}
          {cover.length > 0 && (
            <div className="backfill" data-testid="backfill-panel">
              <div className="bf-h">
                {Icon.spark({ size: 13 })} <b>Smart backfill</b>
                <span className="muted">{cover.length} qualified staff free at this exact time · ranked in Settings</span>
              </div>
              {cover.map((c) => (
                <div className="bf-row" key={c.staff.id} data-testid={`bf-${c.staff.id}`}>
                  <PersonAvatar p={c.staff} size={22} />
                  <span className="bf-who">
                    <b>{c.staff.name}</b>
                    <span className="muted">{c.staff.role}</span>
                  </span>
                  <span className="bf-why">
                    {c.reasons.map((r) => <span key={r} className="tag">{r}</span>)}
                    {(c.warnings || []).map((w) => <span key={w} className="tag warn">⚠ {w}</span>)}
                  </span>
                  <span className="bf-score" title={`Match score ${c.score} — tune weights in Settings`}>★ {c.score}</span>
                  <button className="btn btn-sm btn-primary" onClick={() => assignCover(c)}>Assign</button>
                </div>
              ))}
            </div>
          )}
          <div className="kv">
            <span className="k">Client</span>
            <span className="v">
              {(appt.clientIds || []).length ? (
                <span style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap' }}>
                  {appt.clientIds.map((c) => (
                    <span key={c} className="pill">
                      <PersonAvatar p={clientById[c]} size={18} />
                      {clientById[c]?.name || c}
                      {clientById[c]?.program && <span className="muted" style={{ fontSize: 10.5, fontWeight: 500 }}>· {clientById[c].program}</span>}
                      {authOf(c) && (
                        <span className={`authbar ${authOf(c).booked > authOf(c).auth ? 'over' : ''}`} title={`${authOf(c).booked}h booked this week of ${authOf(c).auth}h authorized`}>
                          <i style={{ width: `${Math.min(100, (authOf(c).booked / authOf(c).auth) * 100)}%` }} />
                          <em>{authOf(c).booked}/{authOf(c).auth}h</em>
                        </span>
                      )}
                    </span>
                  ))}
                </span>
              ) : (
                <span className="muted">—</span>
              )}
            </span>
          </div>
          <div className="kv">
            <span className="k">Staff</span>
            <span className="v">
              <span style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap' }}>
                {(appt.staffIds || []).map((s) => (
                  <span key={s} className="pill">
                    <PersonAvatar p={staffById[s]} size={18} />
                    {staffById[s]?.name || s}
                    <span className="muted" style={{ fontSize: 10.5, fontWeight: 500 }}>· {staffById[s]?.cert || staffById[s]?.role}</span>
                  </span>
                ))}
                {!appt.staffIds?.length && <span className="muted">—</span>}
              </span>
            </span>
          </div>
          {appt.location && (
            <div className="kv">
              <span className="k">Location</span>
              <span className="v">{Icon.pin({ size: 12 })} {appt.location}</span>
            </div>
          )}
          {appt.service && (
            <div className="kv">
              <span className="k">Service</span>
              <span className="v">{appt.service}</span>
            </div>
          )}
          {appt.billing && TYPES[appt.type]?.billable && (
            <div className="kv">
              <span className="k">Billing</span>
              <span className="v">
                {appt.billing.units} units × ${Number(appt.billing.rate).toFixed(2)} ({appt.billing.code})
                {appt.billing.mileage ? ` · ${appt.billing.distance} mi travel × $${(appt.billing.mileageRate ?? 0.7).toFixed(2)}` : ''} · <b style={{ color: 'var(--ok)' }}>${bill.toFixed(2)}</b>
                {claimOfAppt && (
                  <button
                    className="claim-ref"
                    title="Open this claim in the billing desk"
                    onClick={() => actions.setUI({ section: 'billing', bilJump: claimOfAppt.id })}
                  >
                    {claimOfAppt.no} · {claimOfAppt.status}
                  </button>
                )}
                {!claimOfAppt && appt.billing.status === 'billed' && <em className="claim-ref muted">billed outside claims</em>}
              </span>
            </div>
          )}
          {TYPES[appt.type]?.hasVerification && (
            <div className="kv" style={{ display: 'block' }}>
              <span className="k">Verification</span>
              <div className="v" style={{ marginTop: 4 }}>
                {signed ? (
                  <div className="sig-meta-row">
                    {signed.dataUrl && String(signed.dataUrl).startsWith('data:') ? (
                      <img src={signed.dataUrl} alt={`signature of ${signed.staffName}`} style={{ maxHeight: 46, alignSelf: 'center' }} />
                    ) : (
                      <span className="sig-typed" style={{ fontSize: 16 }}>{signed.text}</span>
                    )}
                    <span className="muted" style={{ fontSize: 11 }}>
                      {signed.certification ? `${signed.certification} · ` : ''}
                      {new Date(signed.timestamp).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
                      {signed.geo && !signed.geo.error ? ` · 📍 ${signed.geo.lat}, ${signed.geo.lng}` : ''}
                    </span>
                  </div>
                ) : ver?.verifyStatus === 'flagged' ? (
                  <span style={{ color: 'var(--warn)', fontWeight: 700, fontSize: 12 }}>⚑ Flagged for review</span>
                ) : (
                  <>
                    <span className="muted" style={{ fontSize: 12 }}>Verification pending</span>
                    {isPast && <button className="btn btn-sm" style={{ marginLeft: 8 }} onClick={quickVerify}>Quick verify + sign</button>}
                  </>
                )}
              </div>
            </div>
          )}
          {appt.documents?.length > 0 && (
            <div className="kv">
              <span className="k">Documents</span>
              <span className="v">{appt.documents.map((d) => `${d.name} (${d.tag})`).join(', ')}</span>
            </div>
          )}
          {appt.custom && (appt.custom.megTest || appt.custom.grade || appt.custom.myCare?.length || appt.custom.reEval || appt.custom.yesNo != null) && (
            <div className="kv">
              <span className="k">Custom</span>
              <span className="v">
                {appt.custom.megTest && <span className="tag" style={{ marginRight: 5 }}>Meg Test: {appt.custom.megTest}</span>}
                {appt.custom.grade && <span className="tag" style={{ marginRight: 5 }}>Grade: {appt.custom.grade}</span>}
                {appt.custom.yesNo != null && <span className="tag" style={{ marginRight: 5 }}>Yes/No: {appt.custom.yesNo ? 'Yes' : 'No'}</span>}
                {(appt.custom.myCare || []).map((tag) => (
                  <span key={tag} className="tag" style={{ marginRight: 5 }}>{tag}</span>
                ))}
                {appt.custom.reEval && <span className="muted" style={{ fontSize: 11.5 }}>“{appt.custom.reEval}”</span>}
              </span>
            </div>
          )}
          {appt.pcfs && Object.keys(appt.pcfs).length > 0 && (
            <div className="kv" data-testid="dc-pcf">
              <span className="k">Payer fields</span>
              <span className="v pcf-readout">
                {Object.entries(appt.pcfs).map(([id, f]) => (
                  <span className="pcf-chip" key={id}>
                    <b>{f.label}</b>
                    <i>{f.type === 'multi' ? ((f.value || []).join(', ') || '—') : f.type === 'signature' ? (f.value ? `Signed — ${f.value.staffName || f.value.name || 'captured'}` : '—') : (f.value === '' || f.value == null || f.value === false ? '—' : String(f.value === true ? 'Yes' : f.value))}</i>
                  </span>
                ))}
              </span>
            </div>
          )}
          {appt.notes && (
            <div className="kv">
              <span className="k">Notes</span>
              <span className="v" style={{ whiteSpace: 'pre-wrap' }}>{appt.notes}</span>
            </div>
          )}
          {series.length > 1 && (
            <div className="kv">
              <span className="k">Series</span>
              <span className="v" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                {Icon.repeat({ size: 12 })} {RECURRENCES.find((r) => r.id === appt.recurrence)?.label || 'Repeating'} · {series.length} occurrences
                {nextOcc && (
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => {
                      state.actions.setUI({ anchor: nextOcc.date })
                      onClose()
                    }}
                  >
                    Jump to next ({fmtDayLabel(nextOcc.date)})
                  </button>
                )}
                {appt.edited && (
                  <button className="btn btn-ghost btn-sm" onClick={revert}>
                    {Icon.undo({ size: 12 })} Revert to series default
                  </button>
                )}
              </span>
            </div>
          )}
        </div>

        {confirmDel ? (
          <div className="dactions" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 700 }}>Delete “{appt.title}”?</span>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <button className="btn btn-sm" onClick={() => setConfirmDel(false)}>Cancel</button>
              <span className="f1" />
              <button className="btn btn-sm" style={{ color: '#fff', background: 'var(--danger)', borderColor: 'var(--danger)' }} onClick={() => del('one')}>
                This only
              </button>
              {series.length > 1 && (
                <>
                  <button className="btn btn-sm" style={{ color: '#fff', background: 'var(--danger)', borderColor: 'var(--danger)' }} onClick={() => del('following')}>
                    This &amp; following
                  </button>
                  <button className="btn btn-sm" style={{ color: '#fff', background: 'var(--danger)', borderColor: 'var(--danger)' }} onClick={() => del('all')}>
                    All {series.length}
                  </button>
                </>
              )}
            </div>
          </div>
        ) : (
          <div className="dactions">
            <button className="btn btn-sm" onClick={onEdit}>
              {Icon.edit({ size: 13 })} Edit
            </button>
            <button className="btn btn-sm" onClick={duplicate} title="Duplicate on the same day">
              {Icon.copy({ size: 13 })} Duplicate
            </button>
            {appt.status !== 'cancelled' && (
              <button
                className="btn btn-sm"
                onClick={() => (appt.seriesId ? setStatus('cancelled', { edited: true }) : setStatus('cancelled'))}
                title={appt.seriesId ? 'Skips this occurrence only — series continues' : 'Keep on calendar, greyed out'}
              >
                {Icon.ban({ size: 13 })} {appt.seriesId ? 'Skip occurrence' : 'Cancel'}
              </button>
            )}
            {isPast && TYPES[appt.type]?.hasVerification && !signed && (
              <button className="btn btn-sm" style={{ color: 'var(--ok)', borderColor: 'color-mix(in srgb, var(--ok) 45%, transparent)' }} onClick={quickVerify}>
                {Icon.check({ size: 13 })} Verify
              </button>
            )}
            <span className="f1" />
            <button className="btn btn-sm" style={{ color: 'var(--danger)' }} onClick={() => setConfirmDel(true)}>
              {Icon.trash({ size: 13 })} Delete
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
