import React, { useEffect, useMemo, useState } from 'react'
import { PersonAvatar, AVATAR_KEYS, shuffleAvatar, avatarKeyFor, AVATARS } from '../ui/avatars'
import { AvatarPicker, RemoveBtn } from './ClientsView'
import { ProfileModal } from './ProfileModal'
import { useStore } from '../state/store'
import { SectionBar } from './NavRail'
import { Icon } from '../ui/Icons'
import { useToast } from '../ui/Toast'
import { resolveRange } from '../lib/analytics'
import { fmtDayLabel, fmtTime, todayISO } from '../lib/date'
import { overlapsType, uid } from '../lib/model'

const AV_COLORS = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#14b8a6', '#ef4444']

/** Flags a scheduler/clinical director actually cares about, derived from real data. */
export function staffFlags(state, s, days) {
  const flags = []
  const list = Object.values(state.appts).filter((a) => days.includes(a.date))
  const mine = list.filter((a) => (a.staffIds || []).includes(s.id))
  if (/RBT/i.test(s.role || '')) {
    const sup = mine.filter((a) => a.type === 'supervision' && a.status !== 'cancelled')
    if (!sup.length && mine.some((a) => a.type === 'service')) flags.push({ sev: 'warn', txt: 'No supervision this window (BACB monthly cadence)' })
  }
  if (/Student|trainee/i.test((s.role || '') + (s.cert || ''))) {
    const alone = mine.filter((a) => a.type === 'service' && a.status !== 'cancelled' && !(a.staffIds || []).some((x) => x !== s.id && /BCBA|BCaBA/.test(state.staff.find((p) => p.id === x)?.role || '')))
    if (alone.length) flags.push({ sev: 'warn', txt: `${alone.length} student session(s) without supervising BCBA` })
  }
  const targetH = (s.targetWeekH || 30) * (days.length / 7)
  const bookedH = mine.filter((a) => a.status !== 'cancelled' && overlapsType(a)).reduce((t, a) => t + (a.end - a.start), 0) / 60
  if (targetH && bookedH / targetH > 1) flags.push({ sev: 'error', txt: `Over target hours (${Math.round(bookedH)}h of ${Math.round(targetH)}h)` })
  if (targetH && bookedH / targetH < 0.45 && mine.length) flags.push({ sev: 'notice', txt: 'Under 45% utilized — extra coverage available' })
  return flags
}

function StaffModal({ person, dup, onClose }) {
  const state = useStore()
  const { actions } = state
  const toast = useToast()
  const editing = !!person
  const src = person || dup
  const [form, setForm] = useState(() => {
    if (!src) return { name: '', role: 'RBT', cert: '', email: '', phone: '', fte: 1, targetWeekH: 32, payrollRate: 26, color: AV_COLORS[state.staff.length % AV_COLORS.length], avatar: AVATAR_KEYS[Math.floor(Math.random() * AVATAR_KEYS.length)] }
    if (dup) {
      const { id: _drop, ...rest } = src
      return { ...rest, name: `${src.name} (copy)`, avatar: src.avatar || avatarKeyFor(src) }
    }
    return { ...src, avatar: src.avatar || avatarKeyFor(src) }
  })
  const dupName = !editing && form.name.trim().length > 1 && state.staff.some((x) => x.name.trim().toLowerCase() === form.name.trim().toLowerCase())
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))
  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])
  const errs = {}
  if (!form.name.trim()) errs.name = 'Name is required'
  if (!form.cert.trim()) errs.cert = 'Credential / license number is required'
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email)) errs.email = 'Valid email required'
  if (!(form.targetWeekH >= 1 && form.targetWeekH <= 60)) errs.targetWeekH = '1–60 hours'
  if (!(form.fte > 0 && form.fte <= 1)) errs.fte = 'FTE must be 0–1'
  const save = () => {
    if (Object.keys(errs).length) return
    if (editing) {
      actions.updateRoster('staff', { ...form })
      toast({ message: `${form.name} updated everywhere — grid colors, suggestions & reports included`, kind: 'ok' })
    } else {
      actions.addRoster('staff', { id: uid(), initials: form.name.trim().split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase(), ...form })
      toast({ message: dup ? `Duplicated — ${form.name} joined the team` : `${form.name} joined the team — now selectable everywhere`, kind: 'ok' })
    }
    onClose()
  }
  const F = ({ k, label, icon, type = 'text' }) => (
    <label className="bil-fld pm-fld">
      <span>{icon ? <i className="pm-fi">{Icon[icon]({ size: 12 })} {label}</i> : label}</span>
      <input className="input" type={type} value={form[k] ?? ''} onChange={(e) => set(k, type === 'number' ? Number(e.target.value) : e.target.value)} data-testid={`sm-${k}`} />
      {errs[k] && <i className="pm-err">{errs[k]}</i>}
    </label>
  )
  return (
    <div className="overlay pm-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className="modal pm-modal"
        style={{ width: 620 }}
        role="dialog"
        aria-label={editing ? 'Edit staff' : dup ? 'Duplicate staff member' : 'Add staff'}
        onKeyDown={(e) => { if (e.key === 'Enter' && e.target.tagName === 'INPUT' && !e.repeat) { e.preventDefault(); save() } }}
      >
        <div className="modal-head pm-head">
          <PersonAvatar p={{ ...form, id: person?.id || form.name }} size={46} className="pm-face" />
          <div className="pm-head-t">
            <b>{editing ? `Edit · ${person.name}` : dup ? `Duplicate · ${dup.name}` : 'New staff member'}</b>
            <span>{editing ? 'grid colors, availability & billing rates follow this record' : dup ? 'same profile, brand-new id — tweak and save to add' : 'selectable on the grid, in suggestions & on timesheets'}</span>
          </div>
          <button className="iconbtn" onClick={onClose} aria-label="Close">{Icon.x({ size: 14 })}</button>
        </div>
        <AvatarPicker form={form} set={set} idp="sm" />
        <div className="pm-body">
          <section className="pm-sect">
            <h5>{Icon.team({ size: 12 })} Identity</h5>
            <div className="pm-grid">
              <F k="name" label="Full name" icon="edit" />
              {dupName && <div className="pm-hint warn">A team member with this exact name already exists — saving adds a second record</div>}
              <F k="role" label="Role / title" icon="star" />
              <F k="cert" label="Credential #" icon="badge" />
              <F k="email" label="Email" icon="mail" type="email" />
              <F k="phone" label="Phone" icon="phone" type="tel" />
            </div>
          </section>
          <section className="pm-sect">
            <h5>{Icon.clock({ size: 12 })} Capacity &amp; rates</h5>
            <div className="pm-grid">
              <F k="fte" label="FTE (0–1)" icon="users" type="number" />
              <F k="targetWeekH" label="Target billable h / week" icon="clock" type="number" />
              <F k="payrollRate" label="Pay rate $/h" icon="dollar" type="number" />
            </div>
          </section>
          <section className="pm-sect pm-colorrow">
            <h5>{Icon.palette({ size: 12 })} Calendar color <em>— their chips everywhere use this</em></h5>
            <div className="pm-swatches" data-testid="sm-colors">
              {AV_COLORS.map((cl) => (
                <button key={cl} type="button" title={cl} data-testid={`sm-color-${cl}`} className={`pm-sw ${form.color === cl ? 'on' : ''}`} style={{ background: cl }} onClick={() => set('color', cl)} />
              ))}
            </div>
          </section>
        </div>
        <div className="pm-foot">
          {editing && (
            <RemoveBtn idp="sm" label={`Remove ${person.name.split(' ')[0]}`} onConfirm={() => { actions.removeRoster('staff', person.id); toast({ message: `${person.name} removed — open slots appear on the grid`, kind: 'warn' }); onClose() }} />
          )}
          <button className="btn btn-sm" onClick={onClose}>Cancel</button>
          <button className="btn btn-sm btn-primary" onClick={save} disabled={!!Object.keys(errs).length} data-testid="sm-save">{Icon.check({ size: 12 })} {editing ? 'Save changes' : 'Add staff'}</button>
        </div>
      </div>
    </div>
  )
}

const SORTS = { name: (r) => r.s.name, util: (r) => -r.util, sessions: (r) => -r.booked.sessions, revenue: (r) => -r.booked.revenue, caseload: (r) => -r.caseload }

/** Staff directory — workload, credentials & compliance posture per person. */
export default function StaffView() {
  const state = useStore()
  const { actions, ui, settings, staff } = state
  const toast = useToast()
  const [q, setQ] = useState('')
  const [sort, setSort] = useState('util')
  const [expanded, setExpanded] = useState(null)
  const [modal, setModal] = useState(null)
  const [prof, setProf] = useState(null)
  const [dup, setDup] = useState(null)
  const [mode, setMode] = useState('table')
  useEffect(() => {
    if (ui?.stfAdd) { setModal('new'); actions.setUI({ stfAdd: null }) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ui?.stfAdd])

  const range = useMemo(() => resolveRange('last4', ui.anchor, settings.weekStart), [ui.anchor, settings.weekStart])
  const days = range.days
  const rows = useMemo(() => {
    const today = todayISO()
    const list = staff
      .map((s) => {
        const mine = Object.values(state.appts).filter((a) => days.includes(a.date) && (a.staffIds || []).includes(s.id))
        const busy = mine.filter((a) => a.status !== 'cancelled' && overlapsType(a))
        const targetH = (s.targetWeekH || 30) * (days.length / 7)
        const bookedH = busy.reduce((t, a) => t + (a.end - a.start), 0) / 60
        const clinical = mine.filter((a) => (a.type === 'service' || a.type === 'evaluation') && a.status !== 'cancelled')
        const caseload = new Set(clinical.flatMap((a) => a.clientIds || [])).size
        const revenue = clinical.concat(mine.filter((a) => a.type === 'supervision' || a.type === 'drive')).reduce((t, a) => t + ((Number(a.billing?.units) || 0) * (Number(a.billing?.rate) || 0)) / Math.max(1, (a.staffIds || []).length), 0)
        const pto = mine.filter((a) => a.type === 'unavailable').length
        const next = Object.values(state.appts)
          .filter((a) => a.date >= today && (a.staffIds || []).includes(s.id) && a.status !== 'cancelled' && overlapsType(a))
          .sort((x, y) => (x.date === y.date ? x.start - y.start : x.date < y.date ? -1 : 1))[0]
        const onLeaveToday = Object.values(state.appts).some((a) => a.date === today && (a.staffIds || []).includes(s.id) && a.type === 'unavailable')
        return { s, util: targetH ? Math.round((bookedH / targetH) * 100) : 0, booked: { sessions: clinical.length, revenue: Math.round(revenue) }, bookedH: Math.round(bookedH * 10) / 10, targetH: Math.round(targetH), caseload, pto, flags: staffFlags(state, s, days), next, onLeaveToday }
      })
      .filter((r) => !q || (r.s.name + r.s.role + r.s.cert).toLowerCase().includes(q.toLowerCase()))
    const f = SORTS[sort]
    return [...list].sort((a, b) => {
      const av = f(a)
      const bv = f(b)
      return typeof av === 'number' ? av - bv : String(av).localeCompare(String(bv))
    })
  }, [staff, state.appts, days, q, sort])

  const totals = useMemo(() => ({ util: Math.round(rows.reduce((t, r) => t + r.util, 0) / Math.max(1, rows.length)), flagged: rows.filter((r) => r.flags.length).length }), [rows])

  return (
    <div className="sectionpage">
      <SectionBar icon="team" title="Staff" sub={`${staff.length} team members · workload over the last 4 weeks (${range.label})`}>
        <input className="input" style={{ width: 190, height: 30 }} placeholder="Search people, roles, credentials…" value={q} onChange={(e) => setQ(e.target.value)} data-testid="stf-search" />
        <div className="viewseg lk-mode" role="group" aria-label="View mode">
          <button className={mode === 'table' ? 'on' : ''} data-testid="stf-mode-table" onClick={() => setMode('table')} title="Compact table">{Icon.rows({ size: 13 })}</button>
          <button className={mode === 'cards' ? 'on' : ''} data-testid="stf-mode-cards" onClick={() => setMode('cards')} title="People cards">{Icon.grid({ size: 13 })}</button>
        </div>
        <button className="btn btn-sm btn-primary" data-testid="stf-new" onClick={() => setModal('new')}>
          {Icon.plus({ size: 13 })} Staff
        </button>
      </SectionBar>

      <div className="sec-body">
        <div className="batch-strip">
          <span><b>{rows.length}</b> shown</span>·<span>avg utilization <b style={{ color: totals.util > 90 ? 'var(--danger)' : totals.util > 60 ? 'var(--ok)' : 'var(--warn)' }}>{totals.util}%</b></span>·<span><b>{totals.flagged}</b> with compliance flags</span>
        </div>
        {mode === 'cards' && (
          <div className="lk-cards" data-testid="staff-cards">
            {rows.map((r) => (
              <div className="lk-card" key={r.s.id} data-testid={`stf-card-${r.s.id}`} onClick={() => { actions.setUI({ section: 'calendar', view: 'week', staffSel: [r.s.id], clientSel: [], teamSel: [], anchor: todayISO() }) }}>
                <div className="lk-h">
                  <PersonAvatar p={r.s} size={40} data-testid={`stf-pav-${r.s.id}`} />
                  <div className="lk-nm"><b>{r.s.name}</b><span>{r.s.role} · {r.s.cert}</span></div>
                  {r.onLeaveToday ? <span className="sev-pill sev-error">PTO today</span> : r.flags.length ? <span className={`sev-pill sev-${r.flags[0].sev}`}>{r.flags.length} flag{r.flags.length > 1 ? 's' : ''}</span> : <span className="lk-clear">available</span>}
                </div>
                <div className="lk-barwrap" title={`${r.bookedH}h booked of ${r.targetH}h target`}>
                  <div className="lk-bar"><i style={{ width: `${Math.min(100, r.util)}%`, background: r.util > 100 ? 'var(--danger)' : r.util > 60 ? 'var(--ok)' : 'var(--warn)' }} /></div>
                  <b>{r.util}%</b><span>utilized</span>
                </div>
                <div className="lk-tiles">
                  <div><b>{r.booked.sessions}</b><span>sessions 4w</span></div>
                  <div><b>{r.caseload}</b><span>caseload</span></div>
                  <div><b className="ok">${r.booked.revenue.toLocaleString()}</b><span>attributed</span></div>
                </div>
                {r.flags.length > 0 && (
                  <div className="lk-flags">
                    {r.flags.slice(0, 2).map((f, i) => (
                      <span className="issue-line" key={i}><span className={`sev-pill sev-${f.sev}`}>{f.sev}</span> {f.txt}</span>
                    ))}
                    {r.flags.length > 2 && <em>+{r.flags.length - 2} more</em>}
                  </div>
                )}
                <div className="lk-foot">
                  <span className="lk-next">{r.next ? `Next ${fmtDayLabel(r.next.date)}` : 'Free for cover shifts'}</span>
                  <button className="btn btn-sm" data-testid={`stf-open-${r.s.id}`} onClick={(e) => { e.stopPropagation(); setProf(r) }}>{Icon.eye({ size: 12 })} Profile</button>
                  <button className="btn btn-sm" data-testid={`stf-edit-${r.s.id}`} onClick={(e) => { e.stopPropagation(); setModal(r.s) }}>{Icon.edit({ size: 12 })} Edit</button>
                </div>
              </div>
            ))}
            {!rows.length && <div className="lk-none">No team members match the search.</div>}
          </div>
        )}
        {mode === 'table' && (
        <div className="dir-tables">
          <table className="dir-table" data-testid="staff-table">
            <thead>
              <tr>
                {[['name', 'Team member'], ['util', 'Utilization vs target'], ['sessions', 'Sessions 4w'], ['caseload', 'Caseload'], ['revenue', 'Attributed $'], ['', 'Status']].map(([k, l]) => (
                  <th key={l} className={k && ['util', 'sessions', 'revenue', 'caseload'].includes(k) ? 'r' : ''} onClick={() => k && setSort(k)}>{l} {sort === k ? '↓' : ''}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <React.Fragment key={r.s.id}>
                  <tr className={`main-row ${expanded === r.s.id ? 'expanded' : ''}`} data-testid={`stf-row-${r.s.id}`} onClick={() => setExpanded(expanded === r.s.id ? null : r.s.id)}>
                    <td>
                      <span className="dir-name">
                        <PersonAvatar p={r.s} size={26} data-testid={`stf-pav-${r.s.id}`} />
                        <span>{r.s.name}<span className="dir-sub" style={{ display: 'block' }}>{r.s.role} · {r.s.cert}</span></span>
                      </span>
                    </td>
                    <td className="r">
                      <span className="authbar" title={`${r.bookedH}h booked of ${r.targetH}h target`}>
                        <i style={{ width: `${Math.min(100, r.util)}%`, background: r.util > 100 ? 'var(--danger)' : r.util > 60 ? 'var(--ok)' : 'var(--warn)' }} />
                      </span>
                      <b>{r.util}%</b>
                    </td>
                    <td className="r">{r.booked.sessions}</td>
                    <td className="r">{r.caseload}</td>
                    <td className="r money" style={{ color: 'var(--ok)', fontWeight: 700 }}>${r.booked.revenue.toLocaleString()}</td>
                    <td className="r">
                      <button className="dir-eye" data-testid={`stf-open-${r.s.id}`} title={`Open ${r.s.name}'s profile`} onClick={(e) => { e.stopPropagation(); setProf(r) }}>{Icon.eye({ size: 13 })}</button>
                      {r.onLeaveToday ? <span className="sev-pill sev-error">PTO today</span> : r.flags.length ? <span className={`sev-pill sev-${r.flags[0].sev}`}>{r.flags.length} flag{r.flags.length > 1 ? 's' : ''}</span> : <span className="muted">available</span>}
                    </td>
                  </tr>
                  {expanded === r.s.id && (
                    <tr className="dir-detail">
                      <td colSpan={6}>
                        <div className="dir-detail-in">
                          <div>
                            <h4>Next up</h4>
                            <div className="dir-min">
                              {r.next ? (
                                <button data-testid={`stf-next-${r.s.id}`} onClick={() => actions.setUI({ section: 'calendar', view: 'week', anchor: r.next.date, staffSel: [r.s.id], openAppt: r.next.id })}>
                                  {r.next.title || 'Appointment'} <span className="when">{fmtDayLabel(r.next.date)} · {fmtTime(r.next.start, settings.h24)}</span>
                                </button>
                              ) : (
                                <span className="muted" style={{ fontSize: 11.5 }}>Nothing booked ahead — free for cover shifts.</span>
                              )}
                            </div>
                            <div className="dir-actions">
                              <button className="btn btn-sm" onClick={() => { actions.setUI({ section: 'reports', repPreset: 'last4', repDim: 'staff', repKey: r.s.id }); toast({ message: `Reports scoped to ${r.s.name}`, kind: 'info' }) }}>{Icon.file({ size: 12 })} Utilization report</button>
                              <button className="btn btn-sm" onClick={() => actions.setUI({ section: 'calendar', view: 'week', staffSel: [r.s.id], clientSel: [], anchor: todayISO() })}>{Icon.cal({ size: 12 })} In calendar</button>
                              <button className="btn btn-sm" data-testid={`stf-edit-${r.s.id}`} onClick={() => setModal(r.s)}>{Icon.edit({ size: 12 })} Edit</button>
                            </div>
                          </div>
                          <div>
                            <h4>Last 4 weeks</h4>
                            <div className="mini-metrics">
                              <div className="mini-metric"><b>{r.bookedH}h</b><span>Booked</span></div>
                              <div className="mini-metric"><b>{r.targetH}h</b><span>Target</span></div>
                              <div className="mini-metric"><b>{r.util}%</b><span>Utilized</span></div>
                              <div className="mini-metric"><b>{r.caseload}</b><span>Clients</span></div>
                              <div className="mini-metric"><b>{r.pto}</b><span>Blocks</span></div>
                              <div className="mini-metric"><b>${(r.s.payrollRate || 0)}</b><span>$/hour</span></div>
                            </div>
                            <div style={{ marginTop: 8, fontSize: 11.3 }} className="muted">FTE {r.s.fte} · {r.s.email}</div>
                          </div>
                          <div>
                            <h4>Compliance flags</h4>
                            <div className="dir-min">
                              {r.flags.length ? r.flags.map((f, i) => (
                                <span className="issue-line" key={i}><span className={`sev-pill sev-${f.sev}`}>{f.sev}</span> {f.txt}</span>
                              )) : <span className="muted" style={{ fontSize: 11.5 }}>No gaps detected this window ✓</span>}
                            </div>
                            {/RBT|Student/i.test(r.s.role || '') && (
                              <div className="dir-actions">
                                <button className="btn btn-sm" onClick={() => { actions.setUI({ section: 'billing', anchor: r.next?.date || todayISO() }); toast({ message: 'Billing workspace — supervision lines bill under 97152', kind: 'info' }) }}>
                                  {Icon.dollar({ size: 12 })} Billing view
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
        )}
      </div>
      {prof && (
        <ProfileModal
          person={prof.s} kind="staff"
          kicker={`${prof.s.role} · ${prof.s.cert}`}
          chips={[
            { icon: 'mail', label: 'Email', value: prof.s.email || '—', href: prof.s.email ? `mailto:${prof.s.email}` : null, copy: prof.s.email ? 'email' : null },
            { icon: 'phone', label: 'Phone', value: prof.s.phone || '—', href: prof.s.phone ? `tel:${(prof.s.phone || '').replace(/\D/g, '')}` : null, copy: prof.s.phone ? 'phone' : null },
            { icon: 'badge', label: 'Credential', value: prof.s.cert || '—' },
            { icon: 'users', label: 'FTE', value: String(prof.s.fte ?? 1) },
            { icon: 'dollar', label: 'Pay rate', value: `$${prof.s.payrollRate}/h` },
          ]}
          meter={{ label: 'Utilization · last 4 weeks', pct: prof.util, tone: prof.util > 100 ? 'bad' : prof.util > 60 ? 'ok' : 'warn', caption: `${prof.bookedH}h booked of ${prof.targetH}h target${prof.onLeaveToday ? ' · on leave today' : ''}` }}
          tiles={[
            { v: prof.booked.sessions, l: 'sessions 4w' },
            { v: prof.caseload, l: 'caseload' },
            { v: `$${prof.booked.revenue.toLocaleString()}`, l: 'attributed', tone: 'ok' },
            { v: prof.pto, l: 'PTO blocks' },
          ]}
          flags={prof.flags}
          actionsRow={[
            { id: 'pf-cal', icon: 'cal', label: 'In calendar', run: () => { actions.setUI({ section: 'calendar', view: 'week', staffSel: [prof.s.id], clientSel: [], anchor: todayISO() }); setProf(null) } },
            { id: 'pf-report', icon: 'file', label: 'Utilization report', run: () => { actions.setUI({ section: 'reports', repPreset: 'last4', repDim: 'staff', repKey: prof.s.id }); setProf(null) } },
          ]}
          onDup={() => { setDup(prof.s); setProf(null) }}
          onEdit={() => { setModal(prof.s); setProf(null) }}
          onClose={() => setProf(null)}
        />
      )}
      {(modal || dup) && <StaffModal person={modal === 'new' ? null : modal} dup={dup} onClose={() => { setModal(null); setDup(null) }} />}
    </div>
  )
}
