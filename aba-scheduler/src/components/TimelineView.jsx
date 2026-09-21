import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useStore, visibleApptsFor, layoutLanes, planCluster, groupOverlaps } from '../state/store'
import { DAY_SHORT, fmtDur, fmtTime, parseISO, snap, todayISO, weekNum } from '../lib/date'
import { SNAP, TYPES, findConflicts } from '../lib/model'
import { Icon, TypeGlyph } from '../ui/Icons'
import { useToast } from '../ui/Toast'
import StackPopover from './StackPopover'

/**
 * Horizontal week/day view: time flows LEFT → RIGHT, one row per day.
 * Same semantics as the vertical grid — 15-min snapping, drag to move/resize,
 * drag on empty track to block + quick-book, and overlapping appointments are
 * grouped into one stack card with a “+n more” indicator (expandable).
 */
const PPHX = 96 // px per hour horizontally
const DAYW = 132 // day-label gutter width
const clamp = (v, a, b) => Math.max(a, Math.min(b, v))

export default function TimelineView({ days, onPickSlot, onQuickCreate, onOpenDetail, selectedId, setSelectedId }) {
  const state = useStore()
  const { appts, staff, clients, settings, actions } = state
  const toast = useToast()
  const scrollRef = useRef(null)
  const dragRef = useRef(null)
  const [drag, setDrag] = useState(null)
  const [hover, setHover] = useState(null)
  const [expanded, setExpanded] = useState(() => new Set())
  const [stack, setStack] = useState(null)

  const rowH = days.length === 1 ? 140 : 78
  const trackW = 24 * PPHX
  const h24 = settings.h24
  const today = todayISO()

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollLeft = 7 * PPHX - DAYW * 0 // land at 7:00
  }, [days[0]])
  useEffect(() => {
    if (!stack) return
    const onKey = (e) => e.key === 'Escape' && setStack(null)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [stack])

  const staffById = useMemo(() => Object.fromEntries(staff.map((s) => [s.id, s])), [staff])
  const clientsById = useMemo(() => Object.fromEntries(clients.map((c) => [c.id, c])), [clients])

  const dayData = useMemo(
    () =>
      days.map((d) => {
        const list = visibleApptsFor(state, d)
        return { d, list, groups: groupOverlaps(list) }
      }),
    [days, state]
  )

  const conflicts = useMemo(() => {
    const s = new Set()
    for (const dd of dayData)
      for (const a of dd.list) {
        if (a.status === 'cancelled' || s.has(a.id)) continue
        const hit = findConflicts(appts, a, staffById, clientsById)
        if (hit.length) {
          s.add(a.id)
          s.add(hit[0].other.id)
        }
      }
    return s
  }, [dayData, appts, staffById, clientsById])

  const MAXLT = 3
  const stackGroup = useMemo(() => {
    if (!stack) return null
    for (const dd of dayData)
      for (const g of dd.groups) {
        if (g.gid === stack.gid) return g
        if (stack.gid === `${g.gid}~ov`) {
          const p = planCluster(g.items, MAXLT)
          if (p.overflow) return { ...g, gid: stack.gid, items: p.overflow.items, start: p.overflow.start, end: p.overflow.end, overflow: true }
        }
      }
    return null
  }, [stack, dayData])

  // ---------- geometry ----------
  const minsFromX = (e, trackEl) => {
    const rect = trackEl.getBoundingClientRect()
    const v = rect.width > 0 ? ((e.clientX - rect.left) / rect.width) * 1440 : 540
    return isFinite(v) ? v : 540
  }

  // ---------- create drag ----------
  const onRowDown = (e, dayIdx) => {
    if (e.button > 0 || dragRef.current) return
    const track = e.currentTarget
    const m0 = snap(minsFromX(e, track), SNAP)
    dragRef.current = { mode: 'create', dayIdx, m0, x0: e.clientX, y0: e.clientY, moved: false, s: m0, e: m0 + 60, track }
    try { track.setPointerCapture?.(e.pointerId) } catch {}
    setDrag(dragRef.current)
  }
  // ---------- move / resize drag ----------
  const onChipDown = (e, a, dayIdx, edge) => {
    if (e.button > 0 || dragRef.current) return
    e.stopPropagation()
    const el = e.currentTarget
    const track = el.closest('.th-track')
    dragRef.current = {
      mode: edge ? 'resize' : 'move',
      edge,
      id: a.id,
      a,
      dayIdx,
      x0: e.clientX,
      y0: e.clientY,
      trackW: track ? track.clientWidth : trackW,
      rowH,
      moved: false,
      live: { date: a.date, start: a.start, end: a.end },
    }
    try { el.setPointerCapture?.(e.pointerId) } catch {}
    setDrag(dragRef.current)
    setSelectedId(a.id)
  }

  const onPointerMove = (e) => {
    const d = dragRef.current
    if (!d) return
    const dist = Math.abs(e.clientX - d.x0) + Math.abs(e.clientY - (d.y0 || 0))
    if (dist > 3) d.moved = true
    const minPerPx = 1440 / d.trackW
    if (d.mode === 'create') {
      const m = snap(minsFromX(e, d.track), SNAP)
      const s = Math.min(d.m0, m)
      const en = Math.max(d.m0, m)
      d.s = s
      d.e = Math.max(en, s + SNAP)
    } else if (d.mode === 'move') {
      const dur = d.a.end - d.a.start
      const dm = Math.round(((e.clientX - d.x0) * minPerPx) / SNAP) * SNAP
      const dr = Math.round((e.clientY - d.y0) / d.rowH)
      const ns = clamp(d.a.start + dm, 0, 1440 - dur)
      const nd = clamp(d.dayIdx + dr, 0, days.length - 1)
      d.live = { date: days[nd], start: ns, end: ns + dur }
    } else if (d.mode === 'resize') {
      const dm = Math.round(((e.clientX - d.x0) * minPerPx) / SNAP) * SNAP
      if (d.edge === 'r') d.live = { ...d.live, end: clamp(d.a.end + dm, d.a.start + SNAP, 1440) }
      else d.live = { ...d.live, start: clamp(d.a.start + dm, 0, d.a.end - SNAP) }
    }
    if (d.moved) setDrag({ ...d })
  }

  const onPointerUp = () => {
    const d = dragRef.current
    dragRef.current = null
    setDrag(null)
    if (!d) return
    if (d.mode === 'create') {
      if (!d.moved) {
        onPickSlot({ date: days[d.dayIdx], start: d.s === d.m0 ? d.m0 : d.s, end: (d.s === d.m0 ? d.m0 : d.s) + 60 })
        return
      }
      if (d.e - d.s >= SNAP) onQuickCreate({ date: days[d.dayIdx], start: d.s, end: d.e })
      return
    }
    if (!d.moved) {
      onOpenDetail(d.id)
      return
    }
    const { date, start, end } = d.live
    const changed = date !== d.a.date || start !== d.a.start || end !== d.a.end
    if (!changed) return
    const dur = end - start
    if (dur < 15) {
      toast({ message: 'Minimum duration is 15 minutes', kind: 'warn' })
      return
    }
    const prev = { id: d.id, date: d.a.date, start: d.a.start, end: d.a.end }
    actions.move(d.id, { date, start, end })
    const a2 = { ...d.a, date, start, end }
    const clash = findConflicts(appts, a2, staffById, clientsById)
    toast({
      message: d.mode === 'resize' ? `Resized to ${fmtDur(dur)}` : `Moved to ${date} · ${fmtTime(start, h24)}`,
      kind: clash.length ? 'warn' : 'ok',
      ...(clash.length ? { message: `Moved — overlaps ${clash[0].other.title} (${clash[0].who})` } : {}),
      action: { label: 'Undo', onClick: () => actions.move(prev.id, { date: prev.date, start: prev.start, end: prev.end }) },
    })
  }

  return (
    <div className="tgrid tgrid-h" onMouseLeave={() => setHover(null)}>
      <div className="th-scroll" ref={scrollRef}>
        <div className="th-inner" style={{ width: DAYW + trackW }}>
          <div className="th-head">
            <div className="th-corner" title="ISO week">
              WK {weekNum(days[0])}
            </div>
            <div className="th-hours" style={{ width: trackW }}>
              {Array.from({ length: 24 }, (_, h) => (
                <span className="th-tick" key={h}>
                  <b>{fmtTime(h * 60, h24).replace(':00', '')}</b>
                </span>
              ))}
            </div>
          </div>

          {dayData.map(({ d, list, groups }, dayIdx) => {
            const dt = parseISO(d)
            const wknd = dt.getDay() === 0 || dt.getDay() === 6
            const booked = list.reduce((m, a) => (a.status !== 'cancelled' && TYPES[a.type]?.billable ? m + (a.end - a.start) : m), 0)
            const isDragDay = drag && (drag.mode === 'create' ? drag.dayIdx === dayIdx : drag.live?.date === d)
            return (
              <div key={d} className={`th-rowwrap ${d === today ? 'today' : ''} ${wknd ? 'wkend' : ''}`}>
                <button className="th-daylabel" onClick={() => actions.setUI({ anchor: d })} onDoubleClick={() => actions.setUI({ anchor: d, view: 'day' })} title="Open this day">
                  <span className="dw">{DAY_SHORT[dt.getDay()]} {d.slice(5).replace('-', '/')}</span>
                  <span className="dn">{dt.getDate()}</span>
                  <span className="load">{booked ? `${Math.round((booked / 60) * 10) / 10}h · ${list.length}` : '·'}</span>
                </button>
                <div className="th-track" style={{ height: rowH }} onPointerDown={(e) => onRowDown(e, dayIdx)} onPointerMove={(e) => { if (!dragRef.current) setHover({ dayIdx, m: snap(minsFromX(e, e.currentTarget), SNAP) }) }} onPointerUp={onPointerUp}>
                  {hover && hover.dayIdx === dayIdx && !drag && <div className="th-hoverline" style={{ left: `${(hover.m / 1440) * 100}%` }} />}
                  {d === today && <div className="th-now" style={{ left: `${((new Date().getHours() * 60 + new Date().getMinutes()) / 1440) * 100}%` }} />}
                  {groups.map((g) => {
                    if (g.items.length === 1) {
                      const a = { ...g.items[0], lane: 0, cols: 1 }
                      return <ChipH key={a.id} a={a} h24={h24} conflict={conflicts.has(a.id)} selected={selectedId === a.id} staffById={staffById} clientsById={clientsById} onDown={onChipDown} dayIdx={dayIdx} drag={drag} days={days} />
                    }
                    if (expanded.has(g.gid) || expanded.has(`${g.gid}~ov`)) {
                      const laned = layoutLanes(g.items)
                      return (
                        <React.Fragment key={g.gid}>
                          {laned.map((a) => (
                            <ChipH key={a.id} a={a} h24={h24} conflict={conflicts.has(a.id)} selected={selectedId === a.id} staffById={staffById} clientsById={clientsById} onDown={onChipDown} dayIdx={dayIdx} drag={drag} days={days} />
                          ))}
                          <button
                            className="tg-merge th-merge"
                            style={{ left: `${(g.end / 1440) * 100}%`, transform: 'translateX(-100%)', top: 3 }}
                            title="Group these back into one card"
                            onPointerDown={(e) => e.stopPropagation()}
                            onClick={(e) => {
                              e.stopPropagation()
                              setExpanded((s) => {
                                const n = new Set(s)
                                n.delete(g.gid)
                                return n
                              })
                            }}
                          >
                            ⇤ merge
                          </button>
                        </React.Fragment>
                      )
                    }
                    const { lanes, overflow } = planCluster(g.items, 3)
                    if (!overflow) {
                      return (
                        <React.Fragment key={g.gid}>
                          {lanes.map((a) => (
                            <ChipH key={a.id} a={a} h24={h24} conflict={conflicts.has(a.id)} selected={selectedId === a.id} staffById={staffById} clientsById={clientsById} onDown={onChipDown} dayIdx={dayIdx} drag={drag} days={days} />
                          ))}
                        </React.Fragment>
                      )
                    }
                    return (
                      <React.Fragment key={g.gid}>
                        {lanes.map((a) => (
                          <ChipH key={a.id} a={a} h24={h24} conflict={conflicts.has(a.id)} selected={selectedId === a.id} staffById={staffById} clientsById={clientsById} onDown={onChipDown} dayIdx={dayIdx} drag={drag} days={days} />
                        ))}
                        <StackCardH key={`${g.gid}~ov`} g={{ ...g, gid: `${g.gid}~ov`, items: overflow.items, start: overflow.start, end: overflow.end, overflow: true }} h24={h24} conflict={overflow.items.some((a) => conflicts.has(a.id))} onOpen={(rect) => setStack({ gid: `${g.gid}~ov`, rect })} />
                      </React.Fragment>
                    )
                  })}
                  {isDragDay && drag.mode === 'create' && (
                    <div className="tg-ghost th-ghost" style={{ left: `${(drag.s / 1440) * 100}%`, width: `${((drag.e - drag.s) / 1440) * 100}%` }}>
                      <span>{fmtTime(drag.s, h24)} – {fmtTime(drag.e, h24)} · {fmtDur(drag.e - drag.s)}</span>
                      <span style={{ marginLeft: 'auto', fontSize: 9.5, opacity: 0.8 }}>release to quick-book ⚡</span>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {stack && stackGroup && (
        <>
          <div className="sp-backdrop" onPointerDown={() => setStack(null)} />
          <StackPopover
            g={stackGroup}
            rect={stack.rect}
            h24={h24}
            conflicts={conflicts}
            staffById={staffById}
            clientsById={clientsById}
            expanded={expanded.has(stackGroup.gid)}
            onOpenDetail={(id) => {
              setStack(null)
              onOpenDetail(id)
            }}
            onToggleExpand={() => {
              const gid = stackGroup.gid.replace(/~ov$/, '')
              setStack(null)
              setExpanded((s) => {
                const n = new Set(s)
                if (n.has(gid)) n.delete(gid)
                else n.add(gid)
                return n
              })
            }}
          />
        </>
      )}
    </div>
  )
}

// ---------- horizontal stack card ----------
function StackCardH({ g, h24, conflict, onOpen }) {
  const primary = g.items[0]
  const t = TYPES[primary.type] || TYPES.service
  const left = (g.start / 1440) * 100
  const width = ((g.end - g.start) / 1440) * 100
  const wpx = ((g.end - g.start) / 60) * PPHX
  const badge = wpx < 86 // too narrow for words → “×N” badge style
  const rows = badge || wpx < 130 ? 0 : wpx < 250 ? 1 : wpx < 400 ? 2 : 3
  const shown = badge ? [] : g.items.slice(0, rows)
  const hidden = g.items.length - shown.length
  return (
    <div
      className={`chip stack stack-h ${conflict ? 'conflict' : ''} ${rows === 0 ? 'compact' : ''} ${badge ? 'badge' : ''}`}
      data-testid="stack-card"
      style={{ '--c': t.color, '--cd': t.ink, left: `calc(${left}% + 1px)`, width: `calc(${width}% - 2px)`, top: 3, bottom: 3, height: 'auto', minWidth: 40, background: `color-mix(in srgb, ${t.color} ${badge ? 20 : 9}%, var(--panel))` }}
      role="button"
      tabIndex={0}
      title={`${g.items.length} overlapping appointments · ${fmtTime(g.start, h24)}–${fmtTime(g.end, h24)} — click to expand`}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => onOpen(e.currentTarget.getBoundingClientRect())}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onOpen(e.currentTarget.getBoundingClientRect())
        }
      }}
    >
      {badge ? (
        <span className="badge-n">{conflict ? '⚠ ' : ''}×{g.items.length}</span>
      ) : (
        <>
          <div className="stack-head">
            <TypeGlyph type={primary.type} size={11} />
            <b>{g.items.length} overlapping</b>
            {conflict && <span className="warnic">{Icon.alert({ size: 11, strokeWidth: 2.2 })}</span>}
          </div>
          {shown.map((a) => (
            <div key={a.id} className={`stack-row ${a.status === 'cancelled' ? 'cx' : ''}`}>
              <i style={{ background: TYPES[a.type]?.color }} />
              <b>{fmtTime(a.start, h24)}</b>
              <span>{a.title}</span>
            </div>
          ))}
          {rows > 0 && hidden > 0 && <div className="stack-more">+{hidden} more</div>}
        </>
      )}
    </div>
  )
}

// ---------- one appointment, horizontal ----------
function ChipH({ a, h24, conflict, selected, staffById, clientsById, onDown, dayIdx, drag, days }) {
  const t = TYPES[a.type] || TYPES.service
  const isDrag = drag && drag.mode !== 'create' && drag.id === a.id
  const live = isDrag ? drag.live : null
  const dayDelta = live ? days.indexOf(live.date) - dayIdx : 0
  const start = live ? live.start : a.start
  const end = live ? live.end : a.end
  const dur = end - start
  const cols = a.cols || 1
  const left = (start / 1440) * 100
  const width = (dur / 1440) * 100
  const wpx = (dur / 60) * PPHX
  const single = wpx < 110
  const clientsTxt = (a.clientIds || []).map((c) => clientsById[c]?.name).filter(Boolean).join(', ')
  const staffTxt = (a.staffIds || []).map((s) => staffById[s]?.initials).filter(Boolean).join(' ')

  return (
    <div
      className={`chip chip-h ${a.type === 'unavailable' ? 'unav' : ''} ${a.status === 'cancelled' ? 'cancelled' : ''} ${conflict ? 'conflict' : ''} ${selected ? 'sel' : ''} ${single ? 'one-line' : ''} ${live ? 'dragging' : ''}`}
      style={{
        '--c': t.color,
        '--cd': t.ink,
        left: `calc(${left}% + 1px)`,
        width: `calc(${width}% - 2px)`,
        top: `calc(${((a.lane || 0) * 100) / cols}% + 3px)`,
        height: `calc(${100 / cols}% - 6px)`,
        transform: dayDelta ? `translateY(${dayDelta * ((days.length > 1 ? 78 : 140) + 1)}px)` : undefined,
        zIndex: dayDelta ? 12 : undefined,
      }}
      onPointerDown={(e) => onDown(e, a, dayIdx, null)}
      title={`${a.title} · ${fmtTime(start, h24)}–${fmtTime(end, h24)}${conflict ? ' — has a conflict' : ''}`}
      role="button"
      tabIndex={0}
    >
      <span className="stripe-v" />
      <span className="rz l" onPointerDown={(e) => { e.stopPropagation(); onDown(e, a, dayIdx, 'l') }} />
      <span className="rz r" onPointerDown={(e) => { e.stopPropagation(); onDown(e, a, dayIdx, 'r') }} />
      <div className="cline">
        <TypeGlyph type={a.type} size={11} />
        <span className="t">{a.title}</span>
        <span className="tm">{fmtTime(start, h24)}</span>
      </div>
      {!single && (
        <div className="s">
          {fmtTime(start, h24)}–{fmtTime(end, h24)}
          {clientsTxt ? <> · <b>{clientsTxt}</b></> : null}
          {staffTxt ? <span style={{ marginLeft: 'auto', opacity: 0.75 }}>{staffTxt}</span> : null}
        </div>
      )}
      {wpx > 150 && conflict && <span className="flag">{Icon.alert({ size: 12, strokeWidth: 2.2 })}</span>}
      {wpx > 190 && a.seriesId && (
        <span className="flag" style={{ right: conflict ? 20 : 4, color: a.edited ? 'var(--accent)' : 'var(--text-2)' }} title={a.edited ? 'Series exception — differs from the repeating default' : 'Part of a repeating series'}>
          {Icon.repeat({ size: 11 })}
          {a.edited ? <b style={{ fontSize: 9, marginLeft: 1 }}>✎</b> : null}
        </span>
      )}
    </div>
  )
}
