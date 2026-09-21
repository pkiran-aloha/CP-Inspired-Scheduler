import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../state/store'
import { Icon } from '../ui/Icons'
import { REPORTS } from '../lib/reports'
import { todayISO } from '../lib/date'

/**
 * ⌘K command palette — one box for the whole platform: jump to a section or
 * calendar view, run any report template, find a client or staff member, and
 * fire common actions. Token-matched, keyboard-first (↑↓ ⏎ esc).
 */
export default function CommandPalette({ onClose, onNew, onHelp }) {
  const state = useStore()
  const { actions, settings, staff, clients } = state
  const [q, setQ] = useState('')
  const [cur, setCur] = useState(0)
  const listRef = useRef(null)

  const items = useMemo(() => {
    const out = []
    const go = (patch) => () => {
      actions.setUI(patch)
      onClose()
    }
    out.push({ g: 'Actions', k: 'N', icon: 'plus', t: 'New appointment / block time', hint: 'opens the booking picker', run: () => { onClose(); onNew() } })
    out.push({ g: 'Actions', icon: 'dots', t: 'Needs-cover inbox', hint: 'backfill cancelled sessions', run: go({ inbox: true }) })
    out.push({ g: 'Actions', icon: 'spark', t: 'Today', hint: 'jump the calendar to today (T)', run: go({ section: 'calendar', anchor: todayISO() }) })
    out.push({ g: 'Actions', icon: 'moon', t: `Switch to ${settings.theme === 'dark' ? 'light' : 'dark'} mode`, hint: 'appearance', run: () => { actions.setSettings({ theme: settings.theme === 'dark' ? 'light' : 'dark' }); onClose() } })
    out.push({ g: 'Actions', icon: 'x', t: 'Clear calendar filters', hint: 'reset staff/client/team selection', run: go({ staffSel: [], clientSel: [], teamSel: [], search: '' }) })
    out.push({ g: 'Actions', k: '?', icon: 'info', t: 'Keyboard shortcuts', hint: 'everything is a keystroke away', run: () => { onClose(); onHelp() } })
    const secs = [['calendar', 'Cal', 'Calendar board'], ['clients', 'Cli', 'Clients roster'], ['staff', 'Stf', 'Staff directory'], ['billing', 'Bil', 'Billing & claims desk'], ['analytics', 'An', 'Analytics'], ['reports', 'Rep', 'Reports desk']]
    secs.forEach(([id, , label], i) => out.push({ g: 'Jump to', k: String(i + 1), icon: id === 'calendar' ? 'cal' : id === 'clients' ? 'user' : id === 'staff' ? 'team' : id === 'billing' ? 'dollar' : id === 'analytics' ? 'spark' : 'clipboard', t: label, hint: 'section', run: go({ section: id }) }))
    const views = [['week', 'W'], ['day', 'D'], ['month', 'M'], ['timeline', 'H'], ['agenda', 'G']]
    views.forEach(([v, k]) => out.push({ g: 'Jump to', k, icon: 'cal', t: `Calendar · ${v} view`, hint: 'switch view', run: go({ section: 'calendar', view: v }) }))
    for (const r of REPORTS) out.push({ g: 'Reports', icon: r.icon || 'clipboard', t: r.name, hint: r.blurb.slice(0, 46) + '…', run: go({ section: 'reports', repSel: r.id }) })
    out.push({ g: 'Roster', icon: 'plus', t: 'Add client', hint: 'open the new-client form', run: go({ section: 'clients', cliAdd: 1 }) })
    out.push({ g: 'Roster', icon: 'plus', t: 'Add staff member', hint: 'open the new-staff form', run: go({ section: 'staff', stfAdd: 1 }) })
    out.push({ g: 'Navigate', icon: 'dashboard', t: 'Open Dashboard', hint: 'widget analytics board', run: go({ section: 'dashboard' }) })
    for (const c of clients) out.push({ g: 'Clients', icon: 'user', t: c.name, hint: [c.program, c.authWeekly ? `${c.authWeekly}h auth/wk` : null].filter(Boolean).join(' · ') || 'client', run: go({ section: 'clients', cliQ: c.name }) })
    for (const s of staff)
      out.push({
        g: 'Staff',
        icon: 'team',
        t: s.name,
        hint: `${s.role}${s.cert ? ` · ${s.cert}` : ''} — show their week`,
        run: () => {
          actions.setUI({ section: 'calendar', view: 'week', anchor: todayISO(), staffSel: [s.id], clientSel: [], teamSel: [] })
          onClose()
        },
      })
    return out
  }, [actions, settings.theme, staff, clients, onClose, onNew, onHelp])

  const results = useMemo(() => {
    const query = q.trim().toLowerCase()
    const order = ['Actions', 'Jump to', 'Reports', 'Clients', 'Staff']
    let hits = items
    if (query) {
      const toks = query.split(/\s+/)
      hits = items
        .map((it) => {
          const hay = `${it.t} ${it.g} ${it.hint}`.toLowerCase()
          if (!toks.every((t) => hay.includes(t))) return null
          const first = hay.indexOf(toks[0])
          return { ...it, _s: (it.t.toLowerCase().startsWith(toks[0]) ? -100 : 0) + (first < 0 ? 999 : first) + (order.indexOf(it.g) - 9) * 2 }
        })
        .filter(Boolean)
        .sort((a, b) => a._s - b._s)
    }
    const top = hits.slice(0, 14)
    const groups = []
    for (const it of top) {
      const g = groups.find((x) => x.g === it.g)
      if (g) g.items.push(it)
      else groups.push({ g: it.g, items: [it] })
    }
    return { flat: top, groups }
  }, [q, items])

  useEffect(() => setCur(0), [q])
  useEffect(() => {
    listRef.current?.querySelector('[data-i="' + cur + '"]')?.scrollIntoView?.({ block: 'nearest' })
  }, [cur])

  const onKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setCur((c) => Math.min(c + 1, results.flat.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setCur((c) => Math.max(c - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); results.flat[cur]?.run() }
    else if (e.key === 'Escape') { e.preventDefault(); onClose() }
  }

  let idx = -1
  return (
    <div className="overlay pal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()} data-testid="palette">
      <div className="palette" role="dialog" aria-modal="true" aria-label="Command palette">
        <div className="pal-in">
          {Icon.search({ size: 15 })}
          <input
            ref={(el) => { if (el) el.focus() }}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKey}
            placeholder="Search clients, staff, reports, actions…"
            aria-label="Command search"
            data-testid="palette-input"
          />
          <kbd className="pal-esc" onClick={onClose} title="Close (Esc)">esc</kbd>
        </div>
        <div className="pal-list" ref={listRef}>
          {results.groups.map((g) => (
            <div key={g.g}>
              <div className="pal-gh">{g.g}</div>
              {g.items.map((it) => {
                idx++
                const i = idx
                return (
                  <button
                    key={it.g + it.t}
                    data-i={i}
                    data-testid={`pal-item-${i}`}
                    className={`pal-row ${i === cur ? 'on' : ''}`}
                    onMouseEnter={() => setCur(i)}
                    onClick={() => it.run()}
                  >
                    <span className="pal-ic">{Icon[it.icon]?.({ size: 13 }) || Icon.clipboard({ size: 13 })}</span>
                    <span className="pal-t">{it.t}</span>
                    <span className="pal-hint">{it.hint}</span>
                    {it.k && <kbd>{it.k}</kbd>}
                  </button>
                )
              })}
            </div>
          ))}
          {!results.flat.length && (
            <div className="pal-none">
              {Icon.search({ size: 14 })} No match for “{q}” — try a client name, a report, or “dark”.
            </div>
          )}
        </div>
        <div className="pal-foot">
          <span><kbd>↑↓</kbd> navigate</span>
          <span><kbd>⏎</kbd> run</span>
          <span><kbd>esc</kbd> close</span>
          <span className="f1" />
          <span>Aloha ABA · <b>⌘K</b> anywhere</span>
        </div>
      </div>
    </div>
  )
}
