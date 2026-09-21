import React from 'react'
import { fmtTime } from '../lib/date'
import { TYPES } from '../lib/model'
import { Icon } from '../ui/Icons'

const clamp = (v, a, b) => Math.max(a, Math.min(b, v))

/**
 * Popover listing every member of a collapsed overlap cluster.
 * Shared by the vertical week/day grid and the horizontal timeline view.
 */
export default function StackPopover({ g, rect, h24, conflicts, staffById, clientsById, expanded, onOpenDetail, onToggleExpand }) {
  const W = 308
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1200
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800
  const left = clamp((rect?.right ?? 0) + 10, 8, Math.max(8, vw - W - 8))
  const top = clamp((rect?.top ?? 0) + (rect?.height || 0) / 2 - 140, 8, Math.max(8, vh - 420))
  return (
    <div className="stack-pop panel" data-testid="stack-pop" style={{ left, top }} onPointerDown={(e) => e.stopPropagation()}>
      <div className="sp-head">
        <b>{g.items.length} overlapping appointments</b>
        <span className="muted">
          {g.items[0].date} · {fmtTime(g.start, h24)}–{fmtTime(g.end, h24)}
        </span>
      </div>
      <div className="sp-list">
        {g.items.map((a) => {
          const t = TYPES[a.type] || TYPES.service
          const cl = (a.clientIds || []).map((c) => clientsById[c]?.name).filter(Boolean).join(', ')
          const st = (a.staffIds || []).map((s) => staffById[s]?.initials).filter(Boolean).join(' ')
          return (
            <button key={a.id} className={`sp-row ${a.status === 'cancelled' ? 'cx' : ''}`} onClick={() => onOpenDetail(a.id)}>
              <span className="sw" style={{ background: t.color }} />
              <span className="tm">{fmtTime(a.start, h24)}<br />{fmtTime(a.end, h24)}</span>
              <span className="tt">
                <span className="nm">{a.title}</span>
                <span className="who">{cl || t.label}{st ? ` · ${st}` : ''}</span>
              </span>
              {conflicts.has(a.id) && <span className="cf" title="Conflict">{Icon.alert({ size: 12, strokeWidth: 2.2 })}</span>}
              {a.seriesId && <span className="rp" title={a.edited ? 'Series exception' : 'Repeating series'}>{Icon.repeat({ size: 11 })}</span>}
            </button>
          )
        })}
      </div>
      <div className="sp-foot">
        <button className="btn btn-sm" onClick={onToggleExpand}>
          {expanded ? '⇤ Merge into one card' : '⇔ Show side-by-side'}
        </button>
        <span className="muted" style={{ marginLeft: 'auto', alignSelf: 'center', fontSize: 10.5, fontWeight: 650 }}>click a row to open</span>
      </div>
    </div>
  )
}
