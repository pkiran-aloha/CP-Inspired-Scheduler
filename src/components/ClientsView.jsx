import React, { useEffect, useMemo, useState } from 'react'
import { PersonAvatar, AVATARS, AVATAR_KEYS, shuffleAvatar, avatarKeyFor } from '../ui/avatars'
import { ProfileModal } from './ProfileModal'
import { useStore } from '../state/store'
import { SectionBar } from './NavRail'
import { Icon } from '../ui/Icons'
import { useToast } from '../ui/Toast'
import { pivotRows, rangeMetrics, resolveRange } from '../lib/analytics'
import { addDays, fmtDayLabel, fmtTime, isoDate, parseISO, todayISO } from '../lib/date'
import { uid } from '../lib/model'
import { memberIdOf } from '../lib/claims'

const AV_COLORS = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#14b8a6', '#ef4444']
const PROGRAMS = ['EIBI · Day program', 'EIBI · Home program', 'Home program · NET', 'Center-based · 1:1', 'School-based · Inclusion', 'Behavior reduction', 'Group · Social skills', 'Group · Play readiness', 'Adaptive skills · Center', 'Speech co-treatment', 'Assessment / intake']
const INSURERS = ['Blue Shield CA', 'Aetna', 'Regence BCBS', 'UnitedHealthcare', 'Medicaid (CA)', 'Self-pay']

/** Per-client flags derived from real data — same rules the Reports validations use. */
export function clientFlags(state, c, days) {
  const flags = []
  const today = todayISO()
  const last7 = Array.from({ length: 7 }, (_, i) => isoDate(addDays(parseISO(today), i - 6)))
  const hrs = Object.values(state.appts)
    .filter((a) => last7.includes(a.date) && (a.clientIds || []).includes(c.id) && (a.type === 'service' || a.type === 'evaluation') && a.status !== 'cancelled')
    .reduce((t, a) => t + (a.end - a.start), 0) / 60
  if (c.authWeekly && hrs > c.authWeekly * 1.05) flags.push({ sev: 'warn', txt: `Over pace: ${Math.round(hrs)}h of ${c.authWeekly}h this week` })
  if (c.authEnd) {
    const left = Math.round((parseISO(c.authEnd) - parseISO(today)) / 86400000)
    if (left < 0) flags.push({ sev: 'error', txt: `Authorization lapsed ${-left}d ago` })
    else if (left <= 30) flags.push({ sev: 'warn', txt: `Auth expires in ${left}d` })
  }
  const next = Object.values(state.appts)
    .filter((a) => a.date >= today && (a.clientIds || []).includes(c.id) && a.status !== 'cancelled' && (a.type === 'service' || a.type === 'evaluation'))
    .sort((x, y) => (x.date === y.date ? x.start - y.start : x.date < y.date ? -1 : 1))
  if (c.authWeekly && !next.length) flags.push({ sev: 'notice', txt: 'Nothing upcoming — auth burn-down risk' })
  const hasEval = Object.values(state.appts).some((a) => a.type === 'evaluation' && (a.clientIds || []).includes(c.id) && a.status !== 'cancelled')
  if (!hasEval) flags.push({ sev: 'notice', txt: 'No baseline assessment on file' })
  return flags
}

const COLORS = AV_COLORS

function Field({ k, label, icon, type = 'text', wide, hint, form, set, errs, children }) {
  return (
    <label className={`bil-fld pm-fld ${wide ? 'pm-wide' : ''}`}>
      <span>{icon && <i className="pm-fi">{React.cloneElement(Icon[icon]({ size: 12 }), {})} {label}</i>}{!icon && label}</span>
      {children || <input className="input" type={type} value={form[k] ?? ''} onChange={(e) => set(k, type === 'number' ? Number(e.target.value) : e.target.value)} data-testid={`cm-${k}`} placeholder={type === 'tel' ? '(408) 555-0100' : ''} />}
      {errs[k] && <i className="pm-err">{errs[k]}</i>}
      {!errs[k] && hint && <i className="pm-hint">{hint}</i>}
    </label>
  )
}

function AvatarPicker({ form, set, idp }) {
  return (
    <div className="pm-avabar">
      <div className="pm-ava-label">{Icon.palette({ size: 12 })} Pick an avatar <em>— each person gets a cute critter; it shows across the directory</em></div>
      <div className="pm-chips" data-testid={`${idp}-avatars`} role="radiogroup" aria-label="Avatar">
        {AVATAR_KEYS.map((k) => (
          <button key={k} type="button" role="radio" aria-checked={form.avatar === k} title={AVATARS[k].label}
            className={`pm-chip ${form.avatar === k ? 'on' : ''}`} data-testid={`${idp}-avatar-${k}`} onClick={() => set('avatar', k)}>
            <svg viewBox="0 0 48 48" width="30" height="30" aria-hidden="true">{AVATARS[k].d}</svg>
          </button>
        ))}
        <button type="button" className="pm-chip pm-shuffle" title="Random avatar" data-testid={`${idp}-avatar-shuffle`} onClick={() => set('avatar', shuffleAvatar(form.avatar))}>
          {Icon.shuffle({ size: 15 })}
        </button>
      </div>
    </div>
  )
}

/** Two-step destructive button — native confirm() dialogs don't exist inside iframes. */
function RemoveBtn({ idp, label, onConfirm }) {
  const [armed, setArmed] = useState(false)
  useEffect(() => { if (!armed) return; const t = setTimeout(() => setArmed(false), 3500); return () => clearTimeout(t) }, [armed])
  return (
    <button className={`btn btn-sm ${armed ? 'btn-danger-armed' : ''}`} style={{ color: armed ? '#fff' : 'var(--danger)', marginRight: 'auto', background: armed ? 'var(--danger)' : undefined }}
      data-testid={`${idp}-remove`} onClick={() => (armed ? onConfirm() : setArmed(true))}>
      {Icon.trash({ size: 12 })} {armed ? `Click again to ${label}` : label}
    </button>
  )
}

export { AvatarPicker, RemoveBtn, COLORS }

const client0 = (c) => c // kept for title readability
function ClientModal({ client, dup, onClose }) {
  const state = useStore()
  const { actions } = state
  const toast = useToast()
  const editing = !!client
  const src = client || dup
  const [form, setForm] = useState(() => {
    if (!src) return { name: '', guardian: '', program: PROGRAMS[0], home: '', insurer: INSURERS[0], phone: '', authWeekly: 12, authStart: todayISO(), authEnd: isoDate(addDays(new Date(), 120)), avatar: AVATAR_KEYS[Math.floor(Math.random() * AVATAR_KEYS.length)] }
    if (dup) {
      const { id: _drop, ...rest } = src
      return { ...rest, name: `${src.name} (copy)`, avatar: src.avatar || avatarKeyFor(src) }
    }
    return { ...src, avatar: src.avatar || avatarKeyFor(src) }
  })
  const dupName = !editing && form.name.trim().length > 1 && state.clients.some((x) => x.name.trim().toLowerCase() === form.name.trim().toLowerCase())
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))
  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])
  const errs = {}
  if (!form.name.trim()) errs.name = 'Name is required'
  if (!(form.authWeekly >= 1 && form.authWeekly <= 80)) errs.authWeekly = 'Authorized hours must be 1–80 per week'
  if (form.authEnd && form.authStart && form.authEnd <= form.authStart) errs.authEnd = 'End must be after start'
  const save = () => {
    if (Object.keys(errs).length) return
    if (editing) {
      actions.updateRoster('clients', { ...form })
      toast({ message: `${form.name} updated — analytics & reports pick it up instantly`, kind: 'ok' })
    } else {
      actions.addRoster('clients', { id: uid(), initials: form.name.trim().split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase(), color: AV_COLORS[state.clients.length % AV_COLORS.length], geo: [37.34, -121.97], ...form })
      toast({ message: dup ? `Duplicated — ${form.name} added to the caseload` : `${form.name} added to the caseload`, kind: 'ok' })
    }
    onClose()
  }
  const F = (props) => <Field {...props} form={form} set={set} errs={errs} />
  return (
    <div className="overlay pm-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className="modal pm-modal"
        style={{ width: 620 }}
        role="dialog"
        aria-label={editing ? 'Edit client' : dup ? 'Duplicate client' : 'Add client'}
        onKeyDown={(e) => { if (e.key === 'Enter' && e.target.tagName === 'INPUT' && !e.repeat) { e.preventDefault(); save() } }}
      >
        <div className="modal-head pm-head">
          <PersonAvatar p={{ ...form, id: client?.id || form.name }} size={46} className="pm-face" />
          <div className="pm-head-t">
            <b>{editing ? `Edit · ${client.name}` : dup ? `Duplicate · ${client0(dup).name.split(' (')[0]}` : 'New client'}</b>
            <span>{editing ? 'changes flow into the grid, billing & reports instantly' : dup ? 'same profile, brand-new id — tweak and save to add' : 'joins the caseload — scheduling, auth tracking & claims included'}</span>
          </div>
          <button className="iconbtn" onClick={onClose} aria-label="Close">{Icon.x({ size: 14 })}</button>
        </div>
        <AvatarPicker form={form} set={set} idp="cm" />
        <div className="pm-body">
          <section className="pm-sect">
            <h5>{Icon.user({ size: 12 })} Identity</h5>
            <div className="pm-grid">
              <F k="name" label="Full name" icon="edit" hint={dupName ? 'Heads up — a client with this exact name already exists; saving adds a second record' : null} />
              <F k="guardian" label="Guardian" icon="heart" />
              <F k="dob" label="Date of birth (claims)" icon="cake" type="date" />
              <F k="sex" label="Sex (claims)">
                <select className="input" value={form.sex || 'M'} onChange={(e) => set('sex', e.target.value)} data-testid="cm-sex"><option value="M">Male</option><option value="F">Female</option></select>
              </F>
              <F k="phone" label="Guardian phone" icon="phone" type="tel" />
              <F k="email" label="Family email" icon="mail" type="email" wide />
            </div>
          </section>
          <section className="pm-sect">
            <h5>{Icon.shield({ size: 12 })} Program &amp; authorization</h5>
            <div className="pm-grid">
              <F k="program" label="Program" icon="spark">
                <select className="input" value={form.program} onChange={(e) => set('program', e.target.value)} data-testid="cm-program">{PROGRAMS.map((pr) => <option key={pr}>{pr}</option>)}</select>
              </F>
              <F k="insurer" label="Payer / insurer" icon="shield">
                <select className="input" value={form.insurer} onChange={(e) => set('insurer', e.target.value)} data-testid="cm-insurer">{INSURERS.map((pr) => <option key={pr}>{pr}</option>)}</select>
              </F>
              <F k="home" label="Primary site" icon="house" />
              <F k="authWeekly" label="Authorized hrs / week" icon="clock" type="number" />
              <F k="authStart" label="Auth start" icon="cal" type="date" />
              <F k="authEnd" label="Auth end" icon="cal" type="date" />
            </div>
          </section>
          <section className="pm-sect pm-colorrow">
            <h5>{Icon.star({ size: 12 })} Roster color <em>— chips on the calendar &amp; timeline</em></h5>
            <div className="pm-swatches" data-testid="cm-colors">
              {COLORS.map((cl) => (
                <button key={cl} type="button" title={cl} data-testid={`cm-color-${cl}`} className={`pm-sw ${form.color === cl ? 'on' : ''}`} style={{ background: cl }} onClick={() => set('color', cl)} />
              ))}
            </div>
          </section>
        </div>
        <div className="pm-foot">
          {editing && (
            <RemoveBtn idp="cm" label={`Remove ${client.name.split(' ')[0]}`} onConfirm={() => { actions.removeRoster('clients', client.id); toast({ message: `${client.name} removed from the roster`, kind: 'warn' }); onClose() }} />
          )}
          <button className="btn btn-sm" onClick={onClose}>Cancel</button>
          <button className="btn btn-sm btn-primary" onClick={save} disabled={!!Object.keys(errs).length} data-testid="cm-save">{Icon.check({ size: 12 })} {editing ? 'Save changes' : 'Add client'}</button>
        </div>
      </div>
    </div>
  )
}

const SORTS = { name: (r) => r.c.name, burn: (r) => -r.burn, sessions: (r) => -r.m.sessions, revenue: (r) => -r.m.revenue, next: (r) => r.nextDate || '9999' }

/** Clients directory — caseload health at a glance: auth burn-down, spend, flags, next visit. */
export default function ClientsView() {
  const state = useStore()
  const { actions, ui, settings, clients } = state
  const toast = useToast()
  const [q, setQ] = useState('')
  // the ⌘K palette can hand the roster a name to find
  useEffect(() => {
    if (ui?.cliQ) { setQ(ui.cliQ); actions?.setUI({ cliQ: null }) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ui?.cliQ])
  const [filter, setFilter] = useState('all') // all | flags | expiring
  const [sort, setSort] = useState('burn')
  const [expanded, setExpanded] = useState(null)
  const [modal, setModal] = useState(null) // client | 'new'
  const [prof, setProf] = useState(null) // row object → profile sheet
  const [dup, setDup] = useState(null) // client to copy into a new record
  const [mode, setMode] = useState('table') // dir-tables ⇄ people cards
  useEffect(() => {
    if (ui?.cliAdd) { setModal('new'); actions.setUI({ cliAdd: null }) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ui?.cliAdd])

  const range = useMemo(() => resolveRange('last4', ui.anchor, settings.weekStart), [ui.anchor, settings.weekStart])
  const pivot = useMemo(() => Object.fromEntries(pivotRows(state, range.days, 'client').map((r) => [r.key, r])), [state.appts, range])

  const rows = useMemo(() => {
    const list = clients
      .map((c) => {
        const m = pivot[c.id] || { sessions: 0, hours: 0, units: 0, revenue: 0, cancelled: 0 }
        const flags = clientFlags(state, c, range.days)
        const deliveredH = m.hours
        const burn = c.authWeekly ? Math.round((deliveredH / (c.authWeekly * 4)) * 100) : 0
        const next = Object.values(state.appts)
          .filter((a) => a.date >= todayISO() && (a.clientIds || []).includes(c.id) && a.status !== 'cancelled')
          .sort((x, y) => (x.date === y.date ? x.start - y.start : x.date < y.date ? -1 : 1))[0]
        return { c, m, flags, burn, nextDate: next?.date, nextTitle: next?.title }
      })
      .filter((r) => (!q || (r.c.name + r.c.program + (r.c.insurer || '')).toLowerCase().includes(q.toLowerCase())))
      .filter((r) => (filter === 'all' ? true : filter === 'flags' ? r.flags.some((f) => f.sev !== 'notice') : r.flags.some((f) => /expires|lapsed/i.test(f.txt))))
    return rows_sorted(list, sort)
  }, [clients, pivot, q, filter, sort, state.appts, range])
  function rows_sorted(list, k) {
    const f = SORTS[k] || SORTS.name
    return [...list].sort((a, b) => {
      const av = f(a)
      const bv = f(b)
      return typeof av === 'number' ? av - bv : String(av).localeCompare(String(bv))
    })
  }

  const totals = useMemo(() => ({ sessions: rows.reduce((t, r) => t + r.m.sessions, 0), revenue: Math.round(rows.reduce((t, r) => t + r.m.revenue, 0)), flagged: rows.filter((r) => r.flags.length).length }), [rows])

  return (
    <div className="sectionpage">
      <SectionBar icon="pin" title="Clients" sub={`${clients.length} on caseload · stats for the last 4 weeks (${range.label})`}>
        <input className="input" style={{ width: 190, height: 30 }} placeholder="Search clients, programs, payers…" value={q} onChange={(e) => setQ(e.target.value)} data-testid="cli-search" />
        <div className="viewseg" role="group" aria-label="Filter">
          {[['all', 'All'], ['flags', 'With flags'], ['expiring', 'Auth expiring']].map(([k, l]) => (
            <button key={k} className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>{l}</button>
          ))}
        </div>
        <div className="viewseg lk-mode" role="group" aria-label="View mode">
          <button className={mode === 'table' ? 'on' : ''} data-testid="cli-mode-table" onClick={() => setMode('table')} title="Compact table">{Icon.rows({ size: 13 })}</button>
          <button className={mode === 'cards' ? 'on' : ''} data-testid="cli-mode-cards" onClick={() => setMode('cards')} title="People cards">{Icon.grid({ size: 13 })}</button>
        </div>
        <button className="btn btn-sm btn-primary" data-testid="cli-new" onClick={() => setModal('new')}>
          {Icon.plus({ size: 13 })} Client
        </button>
      </SectionBar>

      <div className="sec-body">
        <div className="batch-strip">
          <span><b>{rows.length}</b> clients</span>·<span><b>{totals.sessions}</b> sessions in range</span>·<span><b>${totals.revenue.toLocaleString()}</b> attributed revenue</span>·<span style={{ color: totals.flagged ? 'var(--warn)' : 'var(--ok)' }}><b>{totals.flagged}</b> need attention</span>
        </div>
        {mode === 'cards' && (
          <div className="lk-cards" data-testid="clients-cards">
            {rows.map(({ c, m, flags, burn, nextDate }) => (
              <div className="lk-card" key={c.id} data-testid={`cli-card-${c.id}`} onClick={() => { actions.setUI({ section: 'calendar', view: 'week', clientSel: [c.id], staffSel: [], teamSel: [], anchor: todayISO() }); toast({ message: `Calendar filtered to ${c.name} — click any session for detail`, kind: 'info' }) }}>
                <div className="lk-h">
                  <PersonAvatar p={c} size={40} data-testid={`cli-pav-${c.id}`} />
                  <div className="lk-nm"><b>{c.name}</b><span>{c.program} · {c.insurer}</span></div>
                  {flags.length ? <span className={`sev-pill sev-${flags.some((f) => f.sev === 'error') ? 'error' : 'warn'}`}>{flags.length} flag{flags.length > 1 ? 's' : ''}</span> : <span className="lk-clear">✓ clear</span>}
                </div>
                <div className="lk-barwrap" title={`${m.hours}h delivered vs ${(c.authWeekly || 0) * 4}h authorized in 4 weeks`}>
                  <div className="lk-bar"><i style={{ width: `${Math.min(100, burn)}%`, background: burn > 105 ? 'var(--danger)' : burn >= 80 ? 'var(--ok)' : 'var(--warn)' }} /></div>
                  <b>{burn}%</b><span>auth burn</span>
                </div>
                <div className="lk-tiles">
                  <div><b>{m.sessions}</b><span>sessions 4w</span></div>
                  <div><b>{m.hours}h</b><span>delivered</span></div>
                  <div><b className="ok">${Math.round(m.revenue).toLocaleString()}</b><span>revenue</span></div>
                </div>
                {flags.length > 0 && (
                  <div className="lk-flags">
                    {flags.slice(0, 2).map((f, i) => (
                      <span className="issue-line" key={i}><span className={`sev-pill sev-${f.sev}`}>{f.sev}</span> {f.txt}</span>
                    ))}
                    {flags.length > 2 && <em>+{flags.length - 2} more in the expanded row</em>}
                  </div>
                )}
                <div className="lk-foot">
                  <span className="lk-next">{nextDate ? `Next ${fmtDayLabel(nextDate)}` : 'Nothing booked ahead'}</span>
                  <button className="btn btn-sm" data-testid={`cli-open-${c.id}`} onClick={(e) => { e.stopPropagation(); setProf({ c, m, flags, burn, nextDate }) }}>{Icon.eye({ size: 12 })} Profile</button>
                  <button className="btn btn-sm" data-testid={`cli-edit-${c.id}`} onClick={(e) => { e.stopPropagation(); setModal(c) }}>{Icon.edit({ size: 12 })} Edit</button>
                </div>
              </div>
            ))}
            {!rows.length && <div className="lk-none">No clients match — adjust search or filters.</div>}
          </div>
        )}
        {mode === 'table' && (
        <div className="dir-tables">
          <table className="dir-table" data-testid="clients-table">
            <thead>
              <tr>
                {[['name', 'Client'], ['burn', 'Auth burn-down'], ['sessions', 'Sess. 4w'], ['revenue', 'Revenue 4w'], ['next', 'Next session'], ['', 'Flags']].map(([k, l]) => (
                  <th key={l} className={k && ['burn', 'sessions', 'revenue'].includes(k) ? 'r' : ''} onClick={() => k && setSort(k)} data-testid={`cli-sort-${k || 'x'}`}>
                    {l} {sort === k ? '↓' : ''}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ c, m, flags, burn, nextDate, nextTitle }) => (
                <React.Fragment key={c.id}>
                  <tr className={`main-row ${expanded === c.id ? 'expanded' : ''}`} data-testid={`cli-row-${c.id}`} onClick={() => setExpanded(expanded === c.id ? null : c.id)}>
                    <td>
                      <span className="dir-name">
                        <PersonAvatar p={c} size={26} data-testid={`cli-pav-${c.id}`} />
                        <span>{c.name}<span className="dir-sub" style={{ display: 'block' }}>{c.program} · {c.home}</span></span>
                      </span>
                    </td>
                    <td className="r">
                      <span className="authbar" title={`${m.hours}h delivered vs ${c.authWeekly * 4}h authorized`}>
                        <i style={{ width: `${Math.min(100, burn)}%`, background: burn > 105 ? 'var(--danger)' : burn >= 80 ? 'var(--ok)' : 'var(--warn)' }} />
                      </span>
                      <b style={{ color: burn > 105 ? 'var(--danger)' : undefined }}>{burn}%</b>
                    </td>
                    <td className="r">{m.sessions}</td>
                    <td className="r money" style={{ color: 'var(--ok)', fontWeight: 700 }}>${Math.round(m.revenue).toLocaleString()}</td>
                    <td>{nextDate ? <>{fmtDayLabel(nextDate)} <span className="dir-sub">{nextTitle}</span></> : <span className="muted">—</span>}</td>
                    <td className="r">
                      <button className="dir-eye" data-testid={`cli-open-${c.id}`} title={`Open ${c.name}'s profile`} onClick={(e) => { e.stopPropagation(); setProf({ c, m, flags, burn, nextDate }) }}>{Icon.eye({ size: 13 })}</button>
                      {flags.length ? <span className={`sev-pill sev-${flags.some((f) => f.sev === 'error') ? 'error' : 'warn'}`}>{flags.length} flag{flags.length > 1 ? 's' : ''}</span> : <span className="muted">clear ✓</span>}
                    </td>
                  </tr>
                  {expanded === c.id && (
                    <tr className="dir-detail">
                      <td colSpan={6}>
                        <div className="dir-detail-in">
                          <div>
                            <h4>Upcoming (next 5)</h4>
                            <div className="dir-min">
                              {Object.values(state.appts)
                                .filter((a) => a.date >= todayISO() && (a.clientIds || []).includes(c.id) && a.status !== 'cancelled')
                                .sort((x, y) => (x.date === y.date ? x.start - y.start : x.date < y.date ? -1 : 1))
                                .slice(0, 5)
                                .map((a) => (
                                  <button key={a.id} data-testid={`cli-next-${a.id}`} onClick={() => actions.setUI({ section: 'calendar', view: 'week', anchor: a.date, openAppt: a.id })}>
                                    <span className={`tdot t-${a.type}`} style={{ background: a.type === 'service' ? '#6366f1' : '#8b5cf6', width: 7, height: 7, borderRadius: 9 }} />
                                    {a.title || 'Session'}
                                    <span className="when">{fmtDayLabel(a.date)} · {fmtTime(a.start, settings.h24)}</span>
                                  </button>
                                ))}
                              {!Object.values(state.appts).some((a) => a.date >= todayISO() && (a.clientIds || []).includes(c.id)) && <span className="muted" style={{ fontSize: 11.5 }}>No upcoming bookings — risk of auth burn-down. <button className="btn btn-sm" style={{ height: 22, marginLeft: 6 }} onClick={() => { actions.setUI({ section: 'calendar', clientSel: [c.id], view: 'week', anchor: todayISO() }); toast({ message: 'Calendar opened with this client selected — drag onto a slot to book', kind: 'info' }) }}>Find slots</button></span>}
                            </div>
                            <div className="dir-actions">
                              <button className="btn btn-sm" onClick={() => { actions.setUI({ section: 'reports', repPreset: 'last4', repDim: 'client', repKey: c.id }); toast({ message: `Reports opened, scoped to ${c.name}`, kind: 'info' }) }}>
                                {Icon.file({ size: 12 })} Auth report
                              </button>
                              <button className="btn btn-sm" onClick={() => actions.setUI({ section: 'calendar', clientSel: [c.id], staffSel: [], view: 'week', anchor: todayISO() })}>{Icon.cal({ size: 12 })} In calendar</button>
                            </div>
                          </div>
                          <div>
                            <h4>Last 4 weeks</h4>
                            <div className="mini-metrics">
                              <div className="mini-metric"><b>{m.sessions}</b><span>Sessions</span></div>
                              <div className="mini-metric"><b>{m.hours}h</b><span>Delivered</span></div>
                              <div className="mini-metric"><b>{Math.round(m.units)}</b><span>Units</span></div>
                              <div className="mini-metric"><b>${Math.round(m.revenue).toLocaleString()}</b><span>Revenue</span></div>
                              <div className="mini-metric"><b>{m.cancelled}</b><span>Cancelled</span></div>
                              <div className="mini-metric"><b>{c.authWeekly}h</b><span>Auth / week</span></div>
                            </div>
                            <div style={{ marginTop: 8, fontSize: 11.3 }} className="muted">
                              Payer: <b style={{ color: 'var(--text)' }}>{c.insurer}</b> · Guardian: {c.guardian} · Auth {c.authStart?.slice(5)} → {c.authEnd?.slice(5)}
                              <br />
                              {Icon.dollar({ size: 11 })} Claims: DOB <b style={{ color: 'var(--text)' }}>{c.dob || 'missing'}</b> · Sex <b style={{ color: 'var(--text)' }}>{c.sex || '—'}</b> · Member <span className="ln-code">{memberIdOf(c)}</span>{(!c.dob || !c.sex) && <span style={{ color: 'var(--danger)', fontWeight: 700 }}> — add both before CMS-1500 filing</span>}
                            </div>
                          </div>
                          <div>
                            <h4>Validation flags</h4>
                            <div className="dir-min">
                              {flags.length ? flags.map((f, i) => (
                                <span className="issue-line" key={i}>
                                  <span className={`sev-pill sev-${f.sev}`}>{f.sev}</span> {f.txt}
                                </span>
                              )) : <span className="muted" style={{ fontSize: 11.5 }}>All clean — auth, cadence & baseline ok</span>}
                            </div>
                            <div className="dir-actions">
                              <button className="btn btn-sm" data-testid={`cli-edit-${c.id}`} onClick={() => setModal(c)}>{Icon.edit({ size: 12 })} Edit</button>
                            </div>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
              {!rows.length && (
                <tr><td colSpan={6}><div className="bil-empty">No clients match — adjust search or filters.</div></td></tr>
              )}
            </tbody>
          </table>
        </div>
        )}
      </div>
      {prof && (() => {
        const { c, m, flags, burn } = prof
        return (
          <ProfileModal
            person={c} kind="client"
            kicker={`${c.program} · ${c.home || 'site TBD'}`}
            chips={[
              { icon: 'heart', label: 'Guardian', value: c.guardian || '—' },
              { icon: 'phone', label: 'Phone', value: c.phone || '—', href: c.phone ? `tel:${c.phone.replace(/\D/g, '')}` : null, copy: c.phone ? 'phone' : null },
              { icon: 'mail', label: 'Email', value: c.email || '—', href: c.email ? `mailto:${c.email}` : null, copy: c.email ? 'email' : null },
              { icon: 'shield', label: 'Payer', value: c.insurer || '—' },
              { icon: 'cake', label: 'DOB', value: c.dob || 'missing' },
              { icon: 'badge', label: 'Claims member', value: memberIdOf(c) },
            ]}
            meter={{ label: 'Auth burn-down · last 4 weeks', pct: burn, tone: burn > 105 ? 'bad' : burn >= 80 ? 'ok' : 'warn', caption: `${m.hours}h delivered of ${(c.authWeekly || 0) * 4}h authorized — ${c.authStart ? c.authStart.slice(0, 10) : '—'} → ${c.authEnd ? c.authEnd.slice(0, 10) : '—'}` }}
            tiles={[
              { v: m.sessions, l: 'sessions 4w' },
              { v: `${m.hours}h`, l: 'delivered' },
              { v: `$${Math.round(m.revenue).toLocaleString()}`, l: 'revenue', tone: 'ok' },
              { v: `${m.cancelled}`, l: 'cancelled', tone: m.cancelled ? 'bad' : '' },
              { v: `${c.authWeekly}h`, l: 'auth / week' },
            ]}
            flags={flags}
            actionsRow={[
              { id: 'pf-cal', icon: 'cal', label: 'In calendar', run: () => { actions.setUI({ section: 'calendar', view: 'week', clientSel: [c.id], staffSel: [], teamSel: [], anchor: todayISO() }); setProf(null) } },
              { id: 'pf-report', icon: 'file', label: 'Auth report', run: () => { actions.setUI({ section: 'reports', repPreset: 'last4', repDim: 'client', repKey: c.id }); setProf(null) } },
            ]}
            onDup={() => { setDup(prof.c); setProf(null) }}
            onEdit={() => { setModal(c); setProf(null) }}
            onClose={() => setProf(null)}
          />
        )
      })()}
      {(modal || dup) && <ClientModal client={modal === 'new' ? null : modal} dup={dup} onClose={() => { setModal(null); setDup(null) }} />}
    </div>
  )
}
