import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useStore, visibleApptsFor, layoutLanes, slotBlocks, groupOverlaps } from '../state/store'
import { DAY_SHORT, fmtDur, fmtTime, parseISO, snap, todayISO } from '../lib/date'
import { SNAP, TYPES, findConflicts } from '../lib/model'
import { Icon, TypeGlyph } from '../ui/Icons'
import { useToast } from '../ui/Toast'
import StackPopover from './StackPopover'

const clamp = (v, a, b) => Math.max(a, Math.min(b, v))

export default function TimeGrid({ days, onPickSlot, onQuickCreate, onOpenDetail, selectedId, setSelectedId }) {
  const state = useStore()
  const { appts, staff, clients, settings, ui, actions } = state
  const toast = useToast()
  const scrollRef = useRef(null)
  const dragRef = useRef(null)
  const [drag, setDrag] = useState(null)
  const [hover, setHover] = useState(null)
  const [expanded, setExpanded] = useState(() => new Set()) // cluster gids shown side-by-side instead of stacked
  const [stack, setStack] = useState(null) // { gid, rect } — popover of a merged group
  const [nowMin, setNowMin] = useState(() => {
    const n = new Date()
    return n.getHours() * 60 + n.getMinutes()
  })
  const [hint, setHint] = useState(() => {
    try {
      return !localStorage.getItem('pulse-aba-hint')
    } catch {
      return false
    }
  })
  useEffect(() => {
    if (!hint) return
    const t = setTimeout(() => {
      setHint(false)
      try {
        localStorage.setItem('pulse-aba-hint', '1')
      } catch {}
    }, 8000)
    return () => clearTimeout(t)
  }, [hint])

  useEffect(() => {
    const t = setInterval(() => {
      const n = new Date()
      setNowMin(n.getHours() * 60 + n.getMinutes())
    }, 30000)
    return () => clearInterval(t)
  }, [])
  useEffect(() => {
    if (!stack) return
    const onKey = (e) => e.key === 'Escape' && setStack(null)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [stack])

  // ---- dynamic canvas sizing ----
  // measure the scroller, then derive everything from it: hour height stretches to
  // fill the viewport (never smaller than a readable 52px), and side-by-side lanes
  // only exist when a day column is actually wide enough to carry them — otherwise
  // overlaps stack into full-width cards instead of squishing into 40px slivers.
  const [geom, setGeom] = useState({ w: 0, h: 0 })
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const measure = () => setGeom({ w: el.clientWidth, h: el.clientHeight })
    measure()
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure)
      return () => window.removeEventListener('resize', measure)
    }
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const pph = geom.h ? clamp(Math.round((geom.h - 8) / 13), 52, 88) : 56
  const minPerPx = 1440 / (24 * pph)
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 7.4 * pph
  }, [ui.view, days[0], pph])

  const staffById = useMemo(() => Object.fromEntries(staff.map((s) => [s.id, s])), [staff])
  const clientsById = useMemo(() => Object.fromEntries(clients.map((c) => [c.id, c])), [clients])

  // Each day → time-overlap clusters. Size-1 clusters render as normal chips;
  // larger ones become a single stack card with a “+n more” indicator.
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

  const stackGroup = useMemo(() => {
    if (!stack) return null
    for (const dd of dayData)
      for (const g of dd.groups)
        if (g.items.length > 1) for (const b of slotBlocks(g.items))
          if (`${g.gid}#${b.start}` === stack.gid) return { ...b, gid: stack.gid }
    return null
  }, [stack, dayData])

  // ---------- geometry helpers ----------
  const minsFromY = (e, colEl) => {
    const rect = colEl.getBoundingClientRect()
    const v = rect.height > 0 ? ((e.clientY - rect.top) / rect.height) * 1440 : 540
    return isFinite(v) ? v : 540
  }

  // ---------- create drag ----------
  const onColDown = (e, dayIdx) => {
    if (e.button > 0 || dragRef.current) return
    const col = e.currentTarget
    const a0 = snap(minsFromY(e, col), SNAP)
    dragRef.current = { mode: 'create', dayIdx, a0, y0: e.clientY, x0: e.clientX, moved: false, s: a0, e: a0 + 60, col }
    try {
      col.setPointerCapture?.(e.pointerId)
    } catch {}
    setDrag(dragRef.current)
  }
  // ---------- move / resize drag ----------
  const onChipDown = (e, a, dayIdx, edge) => {
    if (e.button > 0 || dragRef.current) return
    e.stopPropagation()
    const chipEl = e.currentTarget
    const dayCol = chipEl.closest('.tg-colwrap') || chipEl.closest('.tg-col')
    dragRef.current = {
      mode: edge ? 'resize' : 'move',
      edge,
      id: a.id,
      a,
      dayIdx,
      y0: e.clientY,
      x0: e.clientX,
      colW: dayCol ? dayCol.clientWidth : 200,
      moved: false,
      live: { date: a.date, start: a.start, end: a.end },
    }
    try { chipEl.setPointerCapture?.(e.pointerId) } catch {}
    setDrag(dragRef.current)
    setSelectedId(a.id)
  }

  const onPointerMove = (e) => {
    const d = dragRef.current
    if (!d) {
      return
    }
    const dist = Math.abs(e.clientY - d.y0) + Math.abs(e.clientX - (d.x0 || 0))
    if (dist > 3) d.moved = true
    if (d.mode === 'create') {
      const m = snap(minsFromY(e, d.col), SNAP)
      const s = Math.min(d.a0, m)
      const en = Math.max(d.a0, m)
      d.s = s
      d.e = Math.max(en, s + SNAP)
    } else if (d.mode === 'move') {
      const dur = d.a.end - d.a.start
      const dm = Math.round(((e.clientY - d.y0) * minPerPx) / SNAP) * SNAP
      const dd = Math.round((e.clientX - d.x0) / d.colW)
      const ns = clamp(d.a.start + dm, 0, 1440 - dur)
      const nd = clamp(d.dayIdx + dd, 0, days.length - 1)
      d.live = { date: days[nd], start: ns, end: ns + dur }
    } else if (d.mode === 'resize') {
      const dm = Math.round(((e.clientY - d.y0) * minPerPx) / SNAP) * SNAP
      if (d.edge === 'b') d.live = { ...d.live, end: clamp(d.a.end + dm, d.a.start + SNAP, 1440) }
      else d.live = { ...d.live, start: clamp(d.a.start + dm, 0, d.a.end - SNAP) }
    }
    if (d.moved) setDrag({ ...d })
  }

  const onPointerUp = (e) => {
    const d = dragRef.current
    dragRef.current = null
    setDrag(null)
    if (!d) return
    if (d.mode === 'create') {
      if (!d.moved) {
        onPickSlot({ date: days[d.dayIdx], start: d.s === d.a0 ? d.a0 : d.s, end: (d.s === d.a0 ? d.a0 : d.s) + 60 })
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
      message:
        d.mode === 'resize'
          ? `Resized to ${fmtDur(dur)}`
          : `Moved to ${date} · ${fmtTime(start, settings.h24)}`,
      kind: clash.length ? 'warn' : 'ok',
      ...(clash.length ? { message: `Moved — overlaps ${clash[0].other.title} (${clash[0].who})` } : {}),
      action: { label: 'Undo', onClick: () => actions.move(prev.id, { date: prev.date, start: prev.start, end: prev.end }) },
    })
  }

  const h24 = settings.h24
  const today = todayISO()
  const colMin = days.length === 1 ? 320 : 152
  const colTemplate = `var(--gutter) repeat(${days.length}, minmax(${colMin}px, 1fr))`

  return (
    <div className="tgrid" onMouseLeave={() => setHover(null)} style={{ '--pph': `${pph}px` }}>
      <div className="tg-scroll" ref={scrollRef}>
        <div className="tg-head" style={{ gridTemplateColumns: colTemplate }}>
          <div className="tg-corner" title="ISO week">
            <span style={{ fontSize: 9.5, fontWeight: 800, color: 'var(--muted)', letterSpacing: '0.06em' }}>WK {isoWeek(days[0])}</span>
          </div>
          {dayData.map(({ d, list }, i) => {
            const dt = parseISO(d)
            const wknd = dt.getDay() === 0 || dt.getDay() === 6
            const booked = list.reduce((m, a) => (a.status !== 'cancelled' && TYPES[a.type]?.billable ? m + (a.end - a.start) : m), 0)
            return (
              <div key={d} className={`tg-dayhead ${d === today ? 'today' : ''} ${wknd ? 'wkend' : ''}`} onClick={() => actions.setUI({ anchor: d })} onDoubleClick={() => actions.setUI({ anchor: d, view: 'day' })}>
                <span className="dw">
                  {DAY_SHORT[dt.getDay()]} {d.slice(5).replace('-', '/')}
                </span>
                <span className="dn" style={{ background: d === today ? '' : 'transparent' }}>
                  {dt.getDate()}
                </span>
                <span className="load">{booked ? `${Math.round((booked / 60) * 10) / 10}h · ${list.length}` : '·'}</span>
              </div>
            )
          })}
        </div>

        <div className="tg" style={{ gridTemplateColumns: colTemplate }}>
          <div className="tg-gutter">
            {Array.from({ length: 24 }, (_, h) => (
              <div className="hr" key={h}>
                {h > 0 && h < 24 && <span>{fmtTime(h * 60, h24).replace(':00', '')}</span>}
              </div>
            ))}
          </div>

          {dayData.map(({ d, groups }, dayIdx) => {
            const dt = parseISO(d)
            const wknd = dt.getDay() === 0 || dt.getDay() === 6
            const isDragDay = drag && (drag.mode === 'create' ? drag.dayIdx === dayIdx : drag.live?.date === d)
            return (
              <div key={d} className={`tg-colwrap ${wknd ? 'wkend' : ''}`}>
                <div
                  className="tg-col"
                  onPointerDown={(e) => onColDown(e, dayIdx)}
                  onPointerMove={(e) => {
                    if (!dragRef.current) {
                      const m = snap(minsFromY(e, e.currentTarget), SNAP)
                      setHover({ dayIdx, m })
                    } else onPointerMove(e)
                  }}
                  onPointerUp={onPointerUp}
                >
                  {hover && hover.dayIdx === dayIdx && !drag && <div className="tg-hoverline" style={{ top: `${(hover.m / 1440) * 100}%` }} />}
                  {d === today && (
                    <div className="tg-now" style={{ top: `${(nowMin / 1440) * 100}%` }}>
                      <i />
                    </div>
                  )}
                  {groups.map((g) => {
                    if (g.items.length === 1) {
                      const a = { ...g.items[0], lane: 0, cols: 1 }
                      return <Chip key={a.id} a={a} h24={h24} conflict={conflicts.has(a.id)} selected={selectedId === a.id} staffById={staffById} clientsById={clientsById} onDown={onChipDown} dayIdx={dayIdx} drag={drag} days={days} />
                    }
                    if (expanded.has(g.gid)) {
                      const laned = layoutLanes(g.items)
                      return (
                        <React.Fragment key={g.gid}>
                          {laned.map((a) => (
                            <Chip key={a.id} a={a} h24={h24} conflict={conflicts.has(a.id)} selected={selectedId === a.id} staffById={staffById} clientsById={clientsById} onDown={onChipDown} dayIdx={dayIdx} drag={drag} days={days} />
                          ))}
                          <button
                            className="tg-merge"
                            style={{ top: `calc(${(g.start / 1440) * 100}% + 2px)` }}
                            title="Back to 30-minute slot cards"
                            onPointerDown={(e) => e.stopPropagation()}
                            onClick={(e) => {
                              e.stopPropagation()
                              setExpanded((prev) => {
                                const n = new Set(prev)
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
                    // 30-min slot rhythm: one block per occupied start slot, snapped to :00/:30
                    const blocks = slotBlocks(g.items)
                    return (
                      <React.Fragment key={g.gid}>
                        {blocks.map((b) => {
                          const bgid = `${g.gid}#${b.start}`
                          if (b.items.length === 1) {
                            const a = { ...b.items[0], lane: 0, cols: 1 }
                            return <Chip key={bgid} a={a} box={b} pph={pph} h24={h24} conflict={conflicts.has(a.id)} selected={selectedId === a.id} staffById={staffById} clientsById={clientsById} onDown={onChipDown} dayIdx={dayIdx} drag={drag} days={days} />
                          }
                          return <StackCard key={bgid} pph={pph} g={{ gid: bgid, items: b.items, start: b.start, end: b.end }} h24={h24} conflict={b.items.some((x) => conflicts.has(x.id))} staffById={staffById} clientsById={clientsById} onOpen={(rect) => setStack({ gid: bgid, rect })} />
                        })}
                      </React.Fragment>
                    )
                  })}
                  {isDragDay && drag.mode === 'create' && (
                    <div className="tg-ghost" style={{ top: `${(drag.s / 1440) * 100}%`, height: `${((drag.e - drag.s) / 1440) * 100}%` }}>
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
              const gid = stackGroup.gid.replace(/#\d+$/, '')
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

      {hint && (
        <div className="panel tg-hint" style={{ position: 'absolute', bottom: 26, left: '50%', transform: 'translateX(-50%)' }}>
          {Icon.info({ size: 15 })}
          <span>
            Tip: <span className="kbd">drag</span> on the grid to block time, <span className="kbd">click</span> a slot to book, <span className="kbd">N</span> new appointment. Overlaps are grouped — click a stack to expand.
          </span>
          <button className="iconbtn" style={{ width: 20, height: 20 }} onClick={() => setHint(false)}>
            {Icon.x({ size: 11 })}
          </button>
        </div>
      )}
    </div>
  )
}

function isoWeek(iso) {
  const d = parseISO(iso)
  const t = new Date(d.getFullYear(), 0, 1)
  return Math.ceil(((d - t) / 86400000 + t.getDay() + 1) / 7)
}

// ---------- one overlapping cluster collapsed into a single card ----------
function StackCard({ g, h24, conflict, onOpen, pph = 56 }) {
  const primary = g.items[0]
  const t = TYPES[primary.type] || TYPES.service
  const top = (g.start / 1440) * 100
  const height = ((g.end - g.start) / 1440) * 100
  const bandPx = ((g.end - g.start) / 1440) * (pph * 24)
  // header ≈17px, each member row ≈18px, “+n more” ≈17px; grow the card past the
  // band (minHeight) when needed so the +n indicator never gets clipped
  const rows = bandPx < 46 ? 0 : clamp(Math.floor((bandPx - 28) / 18), 1, 3)
  const shown = g.items.slice(0, rows)
  const hidden = g.items.length - shown.length
  const contentH = 18 + 17 + rows * 20 + (rows > 0 && hidden > 0 ? 18 : 0) // +8 = padding, +10 = inner sheet edges
  const minH = rows === 0 ? 0 : Math.max(42, contentH)
  const stripe = `linear-gradient(to bottom, ${g.items.map((a, i) => `${TYPES[a.type]?.color || t.color} ${((i / g.items.length) * 100).toFixed(1)}%, ${TYPES[a.type]?.color || t.color} ${((((i + 1) / g.items.length) * 100).toFixed(1))}%`).join(', ')})`
  return (
    <div
      className={`chip stack ${conflict ? 'conflict' : ''} ${rows === 0 ? 'compact' : ''}`}
      data-testid="stack-card"
      style={{ '--c': t.color, '--cd': t.ink, top: `calc(${top}% + 1px)`, height: `calc(${height}% - 2px)`, minHeight: minH, left: g.slot != null ? `calc(${(g.slot * 100) / (g.slots || 1)}% + 2px)` : 2, right: 2, width: 'auto', background: `color-mix(in srgb, ${t.color} 9%, var(--panel))` }}
      role="button"
      tabIndex={0}
      title={`${g.overflow ? `${g.items.length} more appointments in this window` : `${g.items.length} overlapping appointments`} · ${fmtTime(g.start, h24)}–${fmtTime(g.end, h24)} — click to expand`} 
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => onOpen(e.currentTarget.getBoundingClientRect())}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onOpen(e.currentTarget.getBoundingClientRect())
        }
      }}
    >
      <span className="stripe" style={{ background: stripe }} />
      <div className="stack-head">
        <TypeGlyph type={primary.type} size={11} />
        <b>{g.overflow ? `+${g.items.length} more` : `${g.items.length} overlapping`}</b>
        <span className="rng">{fmtTime(g.start, h24)}–{fmtTime(g.end, h24)}</span>
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
      {rows > 0 && <><span className="edge e1" /><span className="edge e2" /></>}
    </div>
  )
}

function Chip({ a, h24, conflict, selected, staffById, clientsById, onDown, dayIdx, drag, days, box, pph = 56 }) {
  const t = TYPES[a.type] || TYPES.service
  const isDrag = drag && drag.mode !== 'create' && drag.id === a.id
  const live = isDrag ? drag.live : null
  const dayDelta = live ? days.indexOf(live.date) - dayIdx : 0
  const start = live ? live.start : a.start
  const end = live ? live.end : a.end
  const useBox = box && !live
  const dur = end - start
  const top = ((useBox ? box.start : start) / 1440) * 100
  const height = (((useBox ? box.end : end) - (useBox ? box.start : start)) / 1440) * 100
  const w = 100 / (a.cols || 1)
  const left = (a.lane || 0) * w
  const tiny = dur <= 30 || (useBox && ((box.end - box.start) / 60) * pph < 40)
  // slot block shorter than the event: say so — "→ 12:00 PM" continuation hint
  const shownEnd = useBox ? Math.min(end, box.end) : end
  const cont = useBox && a.end > box.end ? ` → ${fmtTime(a.end, h24)}` : ''
  const clientsTxt = (a.clientIds || []).map((c) => clientsById[c]?.name).filter(Boolean).join(', ')
  const staffTxt = (a.staffIds || []).map((s) => staffById[s]?.initials).filter(Boolean).join(' ')

  return (
    <div
      className={`chip ${a.type === 'unavailable' ? 'unav' : ''} ${a.status === 'cancelled' ? 'cancelled' : ''} ${conflict ? 'conflict' : ''} ${selected ? 'sel' : ''} ${tiny ? 'tiny' : ''} ${live ? 'dragging' : ''} ${!tiny && dur >= 60 ? 'wrap' : ''}`}
      style={{
        '--c': t.color,
        '--cd': t.ink,
        top: `calc(${top}% + 1px)`,
        height: `calc(${height}% - 2px)`,
        left: `calc(${left}% + 2px)`,
        width: `calc(${w}% - 5px)`,
        transform: dayDelta ? `translateX(${dayDelta * 100}%)` : undefined,
        zIndex: dayDelta ? 12 : undefined,
      }}
      onPointerDown={(e) => onDown(e, a, dayIdx, null)}
      title={`${a.title} · ${fmtTime(start, h24)}–${fmtTime(end, h24)}${conflict ? ' — has a conflict' : ''}`}
      role="button"
      tabIndex={0}
    >
      <span className="stripe" />
      <span className="rz t" onPointerDown={(e) => { e.stopPropagation(); onDown(e, a, dayIdx, 't') }} />
      {tiny ? (
        <div className="row1">
          <TypeGlyph type={a.type} size={11} />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.title}</span>
          <span className="muted" style={{ fontWeight: 600, flex: 'none' }}>
            {fmtTime(start, h24)}
          </span>
        </div>
      ) : (
        <>
          <div className="t">{a.title}</div>
          <div className="s">
            <TypeGlyph type={a.type} size={11} />
            {fmtTime(useBox ? Math.max(start, box.start) : start, h24)}–{fmtTime(shownEnd, h24)}{cont}
            {clientsTxt ? <> · <b>{clientsTxt}</b></> : null}
            {staffTxt ? <span style={{ marginLeft: 'auto', opacity: 0.75 }}>{staffTxt}</span> : null}
          </div>
          {a.abaHr && !tiny ? (
            <div className="s" style={{ marginTop: 1 }}>
              <span className="pill" style={{ padding: '0 5px', fontSize: 9, background: 'transparent' }}>⚡ ABA hr</span>
            </div>
          ) : null}
        </>
      )}
      {conflict && <span className="flag">{Icon.alert({ size: 12, strokeWidth: 2.2 })}</span>}
      {a.seriesId && (
        <span className="flag" style={{ right: conflict ? 20 : 4, color: a.edited ? 'var(--accent)' : 'var(--text-2)' }} title={a.edited ? 'Series exception — differs from the repeating default' : 'Part of a repeating series'}>
          {Icon.repeat({ size: 11 })}
          {a.edited ? <b style={{ fontSize: 9, marginLeft: 1 }}>✎</b> : null}
        </span>
      )}
      <span className="rz b" onPointerDown={(e) => { e.stopPropagation(); onDown(e, a, dayIdx, 'b') }} />
    </div>
  )
}
