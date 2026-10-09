import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../../state/store'
import { useToast } from '../../ui/Toast'
import { Icon } from '../../ui/Icons'
import InfoTip from '../../ui/InfoTip'
import { DAY_SHORT, fmtDayLabel, fmtDur, fmtTime, hmToMin, todayISO } from '../../lib/date'
import { handoffServices, proposeIntakeWeek } from '../../lib/intakeHandoff'
import { isCancelStatus, locationOptions } from '../../lib/settingsMasters'
import { uid } from '../../lib/model'
import AppointmentModal from '../AppointmentModal'

export default function IntakeHandoff({ clientId, onClose }) {
  const state = useStore()
  const toast = useToast()
  const client = state.clients.find((c) => c.id === clientId)
  const request = state.intakeRequests?.[client?.intakeId]
  const services = handoffServices(state, clientId)
  const locations = locationOptions(state.settings)
  const [form, setForm] = useState(() => ({ date: client?.authStart > todayISO() ? client.authStart : todayISO(), days: [1, 2, 3, 4, 5],
    time: '09:00', duration: 120, service: services[0]?.id || '', location: locations.includes(client?.home) ? client.home : '' }))
  const [options, setOptions] = useState(null)
  const [picks, setPicks] = useState({})
  const [draft, setDraft] = useState(null)
  const dialogRef = useRef(null)
  useEffect(() => { if (!draft) dialogRef.current?.focus() }, [draft])
  const allowed = state.canAccess('calendar', 'full') && state.canAccess('clients', 'view') && state.canAccess('intake', 'view')
  const plan = useMemo(() => options ? proposeIntakeWeek(state, clientId, options) : null, [state, clientId, options])
  useEffect(() => {
    const escape = (e) => { if (e.key === 'Escape' && !draft) onClose() }
    window.addEventListener('keydown', escape)
    return () => window.removeEventListener('keydown', escape)
  }, [onClose, draft])
  const set = (key, value) => { setForm((f) => ({ ...f, [key]: value })); setOptions(null); setPicks({}) }
  if (!allowed || !client || !request || request.stage !== 'converted' || request.clientId !== clientId) return null
  const first = Object.values(state.appts).filter((a) => a.type === 'service' && a.clientIds?.includes(clientId) && !isCancelStatus(state.settings, a.status)).sort((a, b) => a.date.localeCompare(b.date) || a.start - b.start)[0]
  if (draft) return <AppointmentModal mode="create" initial={draft} onClose={() => setDraft(null)}
    onCreate={(appts) => appts.length !== 1 ? { ok: false, msg: 'Review one session at a time.' } : state.actions.bookHandoffSession(clientId, appts[0])}
    onSaved={(msg) => { setDraft(null); setPicks({}); toast({ message: msg, kind: 'ok' }) }} />
  return <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
    <section className="modal iq-handoff" role="dialog" tabIndex={-1} ref={dialogRef} aria-modal="true" aria-labelledby="iq-handoff-title" data-testid="iq-handoff">
      <header className="iq-handoff-head">
        <div><span className="muted">INTAKE TO SCHEDULING · {request.no}</span><h2 id="iq-handoff-title">Plan the first week</h2><p>{client.name} · {client.authWeekly || 0}h weekly target · {client.authStart || 'No start'} – {client.authEnd || 'No end'}</p></div>
        <button className="iconbtn" aria-label="Close first-week plan" data-testid="iq-handoff-close" onClick={onClose}>{Icon.x({ size: 16 })}</button>
      </header>
      <div className="iq-handoff-body">
        <p className="iq-handoff-note">A local proposal, not a booking or a recurring series. Confirm family availability, choose staff, then review each session in the booking dialog. Nothing is sent to the family.</p>
        {client.authUnitsConverted && <p className="iq-handoff-note" data-testid="iq-handoff-verify">Verify the authorization letter: intake units were assigned to 97153 during conversion; the code and weekly target need confirmation on the client chart.</p>}
        <div className="iq-handoff-context">
          <p><b>Family preferences</b><br />{request.preferredDays || 'Days not recorded'} · {request.preferredTimes || 'Times not recorded'}<br />{request.availabilityNotes || 'No availability notes'}</p>
          <p><b>Recommended setting</b><br />{request.assessment?.recommendedSetting || request.settingPref || 'Not recorded'}<br /><span className="muted">Free-text preferences are shown for review, not parsed as availability.</span></p>
        </div>
        <p data-testid="iq-handoff-first">{first ? `First service on calendar: ${fmtDayLabel(first.date)} at ${fmtTime(first.start, state.settings.h24)}. Existing sessions count toward the weekly target.` : 'No service session on the calendar yet. The intake assessment is not a first treatment session.'}</p>
        <div className="iq-handoff-fields">
          <label>Week containing<input className="input" type="date" data-testid="iq-handoff-date" value={form.date} onChange={(e) => set('date', e.target.value)} /></label>
          <label>Start time<input className="input" type="time" data-testid="iq-handoff-time" value={form.time} onChange={(e) => set('time', e.target.value)} /></label>
          <label>Minutes per session<input className="input" type="number" min="15" max="1440" step="15" data-testid="iq-handoff-duration" value={form.duration} onChange={(e) => set('duration', Number(e.target.value))} /></label>
          <label>Authorized service<select className="input" data-testid="iq-handoff-service" value={form.service} onChange={(e) => set('service', e.target.value)}><option value="">Choose service</option>{services.map((s) => <option key={s.id} value={s.id}>{s.label} · {s.code}</option>)}</select></label>
          <label>Service location<select className="input" data-testid="iq-handoff-location" value={form.location} onChange={(e) => set('location', e.target.value)}><option value="">Choose location</option>{locations.map((l) => <option key={l}>{l}</option>)}</select></label>
        </div>
        <fieldset className="iq-handoff-days"><legend>Days to propose · one session per selected day</legend>{DAY_SHORT.map((name, day) => <label key={day}><input type="checkbox" data-testid={`iq-handoff-day-${day}`} checked={form.days.includes(day)} onChange={() => set('days', form.days.includes(day) ? form.days.filter((d) => d !== day) : [...form.days, day])} />{name}</label>)}</fieldset>
        <button className="btn btn-primary" data-testid="iq-handoff-generate" onClick={() => { setOptions({ ...form, start: hmToMin(form.time) }); setPicks({}) }}>{Icon.cal({ size: 14 })} Propose week</button>
        {plan && <section className="iq-handoff-results" aria-live="polite" data-testid="iq-handoff-results">
          {!plan.ok ? <p role="alert">{plan.msg}</p> : <>
            <h3>{fmtDayLabel(plan.week.start)} – {fmtDayLabel(plan.week.end)}</h3>
            <p data-testid="iq-handoff-summary"><b>{fmtDur(plan.existingMinutes)}</b> already on calendar · <b>{fmtDur(plan.proposedMinutes)}</b> proposed · <b>{fmtDur(plan.remainingMinutes)}</b> still unfilled</p>
            <p className="muted">{plan.msg} <InfoTip label="staff suggestions" wiki="intake" testid="iq-handoff-info">Suggestions weigh the care team, history, fit and workload. An open calendar slot does not confirm working hours. Later slots account for earlier proposals and their top-ranked staff.</InfoTip></p>
            {plan.rows.map((row) => {
              const candidate = row.candidates.find((c) => c.staff.id === picks[row.date]) || row.candidates[0]
              return <article className="iq-handoff-slot" key={row.date} data-testid={`iq-handoff-slot-${row.date}`}>
                <div><b>{fmtDayLabel(row.date, 'full')}</b><p>{fmtTime(row.draft.start, state.settings.h24)} – {fmtTime(row.draft.end, state.settings.h24)} · {fmtDur(row.draft.end - row.draft.start)}</p></div>
                {!candidate ? <p>{row.reason}</p> : <div className="iq-handoff-candidate">
                  <label>Ranked staff<select className="input" aria-label={`Staff for ${row.date}`} data-testid={`iq-handoff-staff-${row.date}`} value={candidate.staff.id} onChange={(e) => setPicks({ ...picks, [row.date]: e.target.value })}>{row.candidates.map((c, i) => <option key={c.staff.id} value={c.staff.id}>{i + 1}. {c.staff.name} · score {c.score}</option>)}</select></label>
                  <p className="muted">{candidate.reasons.join(' · ')}</p>
                  {candidate.warnings.length > 0 && <details><summary>Review {candidate.warnings.length} checks</summary><ul>{candidate.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul></details>}
                  <button className="btn btn-sm" data-testid={`iq-handoff-review-${row.date}`} onClick={() => setDraft({ ...row.draft, id: uid(), staffIds: [candidate.staff.id], notes: '', custom: {}, documents: [], recurrence: 'none' })}>Review & book</button>
                </div>}
              </article>
            })}
          </>}
        </section>}
      </div>
      <footer className="iq-handoff-foot"><span className="muted">Proposals are not saved. Each confirmed session has one Undo.</span><button className="btn btn-sm" onClick={onClose}>Done</button></footer>
    </section>
  </div>
}
