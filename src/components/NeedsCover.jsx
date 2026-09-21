import React, { useMemo, useState } from 'react'
import { PersonAvatar } from '../ui/avatars'
import { useStore } from '../state/store'
import { useToast } from '../ui/Toast'
import { Icon } from '../ui/Icons'
import { fmtDayLabel, fmtRange } from '../lib/date'
import { scanNeedsCover, smartCfg } from '../lib/smart'

/**
 * Backfill inbox — every cancelled session in the visible range that a
 * qualified, available staff member could take over right now.
 */
export default function NeedsCover({ days, onClose }) {
  const state = useStore()
  const { actions, settings, clients } = state
  const toast = useToast()
  const clientById = Object.fromEntries(clients.map((c) => [c.id, c]))
  const rows = useMemo(() => scanNeedsCover(state, days), [state.appts, days])
  const [picked, setPicked] = useState({}) // apptId -> staffId
  const cfg = smartCfg(settings)
  const eligible = rows.filter((r) => r.candidates[0].score >= (cfg.backfill.minScore ?? 0))

  const assign = (row) => {
    const staffId = picked[row.appt.id] || row.candidates[0].staff.id
    const s = row.candidates.find((c) => c.staff.id === staffId)
    if (!s) return
    const prev = { status: row.appt.status, staffIds: row.appt.staffIds, backfilled: row.appt.backfilled, backfillIgnored: row.appt.backfillIgnored }
    actions.update(row.appt.id, {
      status: 'active',
      staffIds: [s.staff.id],
      backfilled: true,
      backfilledFrom: row.appt.staffIds || [],
      backfillIgnored: false,
    })
    toast({
      message: `Slot reactivated — ${s.staff.name.split(' ')[0]} covers ${fmtDayLabel(row.appt.date)} · ${s.reasons[0] || 'free at this time'}`,
      kind: 'ok',
      action: { label: 'Undo', onClick: () => actions.update(row.appt.id, prev) },
    })
  }
  const dismiss = (row) => {
    actions.update(row.appt.id, { backfillIgnored: true })
    toast({ message: 'Left cancelled — backfill hint dismissed', kind: 'info', action: { label: 'Undo', onClick: () => actions.update(row.appt.id, { backfillIgnored: false }) } })
  }

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal inbox" role="dialog" aria-modal="true" aria-label="Needs cover">
        <div className="modal-head">
          <span className="cover-badge">{Icon.alert({ size: 14 })}</span>
          <h2>Needs cover — smart backfill</h2>
          <span className="sbadge">{rows.length} recoverable</span>
          {cfg.backfill.autoFill && eligible.length > 0 && (
            <button
              className="btn btn-sm btn-primary"
              data-testid="cov-autofill"
              onClick={() => {
                for (const row of eligible) {
                  const c = row.candidates[0]
                  actions.update(row.appt.id, { status: 'active', staffIds: [c.staff.id], backfilled: true, backfilledFrom: row.appt.staffIds || [], backfillIgnored: false })
                }
                toast({ message: `Auto-filled ${eligible.length} slot${eligible.length > 1 ? 's' : ''} — review the new assignments`, kind: 'ok', action: { label: 'Undo all', onClick: () => actions.undo() } })
              }}
            >
              {Icon.spark({ size: 13 })} Auto-fill {eligible.length}
            </button>
          )}
          <span className="spacer f1" />
          <button className="modal-x" onClick={onClose} aria-label="Close">
            {Icon.x({ size: 14 })}
          </button>
        </div>
        <div className="modal-body inbox-body">
          {!rows.length && (
            <div className="inbox-empty">
              <span className="ok-ring">{Icon.check({ size: 22, strokeWidth: 2.6 })}</span>
              <b>All clear</b>
              <span className="muted">No cancelled sessions in this range could be backfilled with the current rosters.</span>
            </div>
          )}
          {rows.map((row) => (
            <div className="cov-row" key={row.appt.id} data-testid={`cov-${row.appt.id}`}>
              <div className="cov-when">
                <b>{fmtDayLabel(row.appt.date)}</b>
                <span>{fmtRange(row.appt.start, row.appt.end, settings.h24)}</span>
                {row.appt.location && <span className="muted">{Icon.pin({ size: 10 })} {row.appt.location}</span>}
              </div>
              <div className="cov-what">
                <div className="cov-clients">
                  {row.appt.clientIds.map((c) => (
                    <span key={c} className="pill">
                      <PersonAvatar p={clientById[c]} size={18} />
                      {clientById[c]?.name || c}
                    </span>
                  ))}
                </div>
                <div className="cov-from muted">
                  vacated by {(row.appt.staffIds || []).map((s) => state.staff.find((x) => x.id === s)?.name.split(' ')[0]).join(', ') || '—'} · {Math.round((row.appt.end - row.appt.start) / 6) / 10}h at stake
                </div>
                <div className="cov-cands">
                  {row.candidates.map((c, i) => {
                    const on = (picked[row.appt.id] || row.candidates[0].staff.id) === c.staff.id
                    return (
                      <button key={c.staff.id} type="button" className={`cov-cand ${on ? 'on' : ''}`} onClick={() => setPicked({ ...picked, [row.appt.id]: c.staff.id })} title={`Score ${c.score}`}>
                        <PersonAvatar p={c.staff} size={22} />
                        <span style={{ minWidth: 0 }}>
                          <b>{c.staff.name}</b>
                          <span className="cov-why">
                            {c.reasons.join(' · ') || 'Free at this time'}
                            {(c.warnings || []).length > 0 && <em className="cov-warn"> ⚠ {c.warnings[0]}</em>}
                          </span>
                        </span>
                        <span className="cov-score" title={`Match score ${c.score} · confidence floor ${cfg.backfill.minScore}`}>★ {c.score}</span>
                      </button>
                    )
                  })}
                </div>
              </div>
              <div className="cov-actions">
                <button className="btn btn-primary btn-sm" onClick={() => assign(row)} data-testid={`cov-assign-${row.appt.id}`}>
                  {Icon.check({ size: 13 })} Assign &amp; reactivate
                </button>
                <button className="btn btn-ghost btn-sm" onClick={() => dismiss(row)} title="Leave cancelled">
                  Dismiss
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
