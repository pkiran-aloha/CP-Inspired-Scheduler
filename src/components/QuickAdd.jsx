import React, { useMemo, useState } from 'react'
import { useStore } from '../state/store'
import { Icon } from '../ui/Icons'
import { Dropdown } from './fields'
import { fmtDur, fmtTime } from '../lib/date'
import { SERVICES, TYPES, autoBilling, findConflicts, uid } from '../lib/model'

/**
 * Drag-on-grid quick booking: ask WHO the client is and WHAT service, then book.
 * "More options" hands off to the full wizard; booked sessions open the detail card to edit.
 */
export default function QuickAdd({ slot, onClose, onFullForm, onBooked }) {
  const state = useStore()
  const { clients, staff, settings, appts, ui, actions } = state
  const T = TYPES.service
  const [clientId, setClientId] = useState(ui.clientSel.length === 1 ? ui.clientSel[0] : '')
  const [serviceId, setServiceId] = useState('')
  const [staffId, setStaffId] = useState(ui.staffSel.length === 1 ? ui.staffSel[0] : '')

  const client = clients.find((c) => c.id === clientId)
  const service = SERVICES.find((s) => s.id === serviceId)
  const dur = slot.end - slot.start
  const title = service ? service.label : 'Session'

  const staffById = useMemo(() => Object.fromEntries(staff.map((s) => [s.id, s])), [staff])
  const clientsById = useMemo(() => Object.fromEntries(clients.map((c) => [c.id, c])), [clients])

  // suggest staff from the client's other bookings if not chosen yet
  const suggestions = useMemo(() => {
    if (!client) return []
    const seen = {}
    for (const a of Object.values(appts)) {
      if (!(a.clientIds || []).includes(client.id)) continue
      for (const s of a.staffIds || []) seen[s] = (seen[s] || 0) + 1
    }
    return Object.entries(seen).sort((a, b) => b[1] - a[1]).map(([id, n]) => ({ id, n }))
  }, [client, appts])
  const effStaffId = staffId || suggestions[0]?.id || ''

  const draft = { id: '__q__', date: slot.date, start: slot.start, end: slot.end, staffIds: effStaffId ? [effStaffId] : [], clientIds: clientId ? [clientId] : [], status: 'active' }
  const conflicts = useMemo(() => (clientId ? findConflicts(appts, draft, staffById, clientsById) : []), [clientId, effStaffId, slot.date, slot.start, slot.end])

  const book = () => {
    if (!clientId) return
    const code = service?.code || '97151'
    const billing = autoBilling({ type: 'service', billing: { code } }, dur)
    const appt = {
      id: uid(),
      type: 'service',
      title,
      date: slot.date,
      start: slot.start,
      end: slot.end,
      staffIds: effStaffId ? [effStaffId] : [],
      clientIds: [clientId],
      status: 'active',
      location: client?.home || 'Main Center',
      service: service?.id || 'dtt',
      notes: '',
      abaHr: dur >= 90,
      recurrence: 'none',
      billing,
      custom: {},
      documents: [],
      verification: null,
    }
    actions.create([appt])
    onBooked(appt)
  }

  return (
    <div className="overlay" style={{ background: 'color-mix(in srgb, #0b1020 34%, transparent)' }} onMouseDown={(e) => e.target === e.currentTarget && onClose()} onKeyDown={(e) => e.key === 'Escape' && onClose()} tabIndex={-1} ref={(el) => el?.focus({ preventScroll: true })}>
      <div className="modal" style={{ width: 'min(420px, 94vw)' }} role="dialog" aria-label="Quick book session">
        <div className="modal-head" style={{ padding: '12px 16px' }}>
          <span style={{ background: T.color, width: 26, height: 26, borderRadius: 8, display: 'grid', placeItems: 'center', color: '#fff' }}>{Icon.spark({ size: 13 })}</span>
          <h2 style={{ fontSize: 15 }}>Quick book a session</h2>
          <span className="f1" />
          <button className="modal-x" onClick={onClose} aria-label="Close" style={{ width: 26, height: 26 }}>{Icon.x({ size: 12 })}</button>
        </div>
        <div style={{ padding: '12px 16px 16px', display: 'grid', gap: 10 }}>
          <div className="sbadge" style={{ alignSelf: 'flex-start', padding: '5px 10px', fontSize: 12 }}>
            {Icon.clock({ size: 12 })}
            <b>
              {new Date(slot.date + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })} · {fmtTime(slot.start, settings.h24)} – {fmtTime(slot.end, settings.h24)}
            </b>
            · {fmtDur(dur)}
          </div>
          <div className="field">
            <label>
              Who is the client? <em>*</em>
            </label>
            <Dropdown
              testid="qa-client"
              searchable
              value={clientId}
              onChange={setClientId}
              placeholder="Choose client…"
              options={clients.map((c) => ({ value: c.id, label: c.name, sub: `${c.program} · ${c.authWeekly}h/wk authorized` }))}
            />
          </div>
          <div className="field">
            <label>What service?</label>
            <Dropdown
              testid="qa-service"
              value={serviceId}
              onChange={setServiceId}
              placeholder="Defaults to client program"
              options={[{ value: '', label: 'Auto (from program)' }, ...SERVICES.map((s) => ({ value: s.id, label: s.label, sub: `bills under ${s.code}` }))]}
            />
          </div>
          {client && (
            <div className="field">
              <label>Staff</label>
              <Dropdown
                testid="qa-staff"
                searchable
                value={effStaffId}
                onChange={setStaffId}
                placeholder="Pick staff…"
                options={[...suggestions.map((s) => ({ value: s.id, label: `${staffById[s.id]?.name} — their usual`, sub: staffById[s.id]?.role })), ...staff.filter((x) => !suggestions.some((sg) => sg.id === x.id)).map((x) => ({ value: x.id, label: x.name, sub: x.role }))]}
              />
            </div>
          )}
          <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>
            Billing auto-fills: <b>{dur} min ÷ 30 = {Math.round((dur / 30) * 4) / 4} units</b> under {service?.code || 'program default'}
          </div>
          {conflicts.length > 0 && (
            <div className="warnbox danger" style={{ fontSize: 11.5 }}>
              {Icon.alert({ size: 14 })}
              <span>
                <b>Clash:</b> {conflicts[0].other.title} ({conflicts[0].who}) — booking anyway will flag it.
              </span>
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, marginTop: 2 }}>
            <button className="btn btn-ghost" onClick={() => onFullForm({ date: slot.date, start: slot.start, end: slot.end, clientIds: clientId ? [clientId] : [], staffIds: effStaffId ? [effStaffId] : [], service: service?.id || '' })}>
              More options →
            </button>
            <span className="f1" />
            <button data-testid="qa-book" className="btn btn-primary" style={{ opacity: clientId ? 1 : 0.5 }} disabled={!clientId} onClick={book}>
              {Icon.check({ size: 14, strokeWidth: 2.4 })} Book it
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
