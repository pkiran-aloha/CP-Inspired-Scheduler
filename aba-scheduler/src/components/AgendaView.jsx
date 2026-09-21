import React, { useMemo } from 'react'
import { PersonAvatar } from '../ui/avatars'
import { useStore, visibleApptsFor } from '../state/store'
import { DAY_SHORT, fmtDur, fmtRange, MONTHS, parseISO, todayISO } from '../lib/date'
import { computeBilling, STATUSES, TYPES } from '../lib/model'
import { Icon } from '../ui/Icons'

export default function AgendaView({ days, onOpenDetail, onNew }) {
  const state = useStore()
  const { settings, actions } = state
  const groups = useMemo(() => days.map((d) => ({ d, list: visibleApptsFor(state, d) })), [days, state])
  const today = todayISO()

  return (
    <div className="agenda">
      {groups.map(({ d, list }) => {
        const dt = parseISO(d)
        return (
          <React.Fragment key={d}>
            <div className="ag-day">
              <div className={`ag-date ${d === today ? 'today' : ''}`}>
                <div className="dw">{DAY_SHORT[dt.getDay()]}</div>
                <div className="dn">{dt.getDate()}</div>
                <div className="mo">{MONTHS[dt.getMonth()].slice(0, 3)}</div>
                <span className="ag-n" data-testid={`ag-count-${d}`}>{list.length}</span>
                <button className="btn btn-ghost btn-sm" style={{ marginTop: 6, padding: '2px 7px' }} onClick={() => actions.setUI({ view: 'day', anchor: d })}>
                  Open day
                </button>
              </div>
              <div className="ag-rows">
                {!list.length && (
                  <div className="ag-empty">
                    {Icon.check({ size: 13 })} No sessions scheduled — enjoy the quiet
                    <button className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }} onClick={() => actions.setUI({ view: 'week', anchor: d })}>
                      {Icon.plus({ size: 12 })} Schedule
                    </button>
                  </div>
                )}
                {list.map((a) => {
                  const t = TYPES[a.type] || TYPES.service
                  const st = STATUSES[a.status]
                  const bill = computeBilling(a)
                  return (
                    <div key={a.id} className="ag-row" onClick={() => onOpenDetail(a.id)} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onOpenDetail(a.id)}>
                      <span className="ag-type" style={{ background: t.color }} />
                      <span className="ag-time">{fmtRange(a.start, a.end, settings.h24)}</span>
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span className="ag-title">
                          {a.title} {a.abaHr && <span className="pill" style={{ padding: '0 6px', fontSize: 9.5 }}>⚡ ABA hr</span>}
                        </span>
                        <div className="ag-sub">
                          {[a.clientIds?.map((c) => state.clients.find((x) => x.id === c)?.name).filter(Boolean).join(', '), a.location, `${fmtDur(a.end - a.start)}`].filter(Boolean).join(' · ')}
                        </div>
                      </span>
                      <span className="ag-right">
                        <span className="stack" style={{ display: 'flex' }}>
                          {(a.staffIds || []).slice(0, 3).map((sid) => {
                            const s = state.staff.find((x) => x.id === sid)
                            return s ? (
                              <PersonAvatar key={sid} p={s} size={22} />
                            ) : null
                          })}
                        </span>
                        {bill > 0 && <span className="nowrap" style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--ok)' }}>${bill.toFixed(2)}</span>}
                        <span className="sbadge" title={st.label}>
                          <i style={{ background: st.dot }} />
                          {st.label}
                        </span>
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          </React.Fragment>
        )
      })}
    </div>
  )
}
