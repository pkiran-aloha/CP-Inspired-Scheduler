import React, { useRef, useState } from 'react'
import { useStore } from '../state/store'
import { useToast } from '../ui/Toast'
import { Icon } from '../ui/Icons'
import { smartCfg } from '../lib/smart'
import { downloadDoc } from '../lib/exportKit'
import { todayISO } from '../lib/date'
import { NAME_STYLES, apptAutoTitle, titleAudit } from '../lib/apptName'

export default function SettingsModal({ onClose }) {
  const state = useStore()
  const { settings, actions, appts, claims, staff, clients, teams } = state
  const toast = useToast()
  const fileRef = useRef(null)
  const [arm, setArm] = useState(null) // two-step confirmation instead of native confirm()

  const sm = smartCfg(settings)
  const patch = (section, v) => {
    const next = { weights: { ...sm.weights }, suggest: { ...sm.suggest }, backfill: { ...sm.backfill } }
    Object.assign(next[section], v)
    actions.setSettings({ smart: next })
  }
  const Slider = ({ label, value, onChange, hint }) => (
    <div className="wgt-row" title={hint}>
      <span>{label}</span>
      <input type="range" min={0} max={100} value={value} onChange={(e) => onChange(Number(e.target.value))} style={{ backgroundSize: `${value}% 100%` }} />
      <em>{value}%</em>
    </div>
  )
  const Row = ({ label, children, hint }) => (
    <div className="set-row" title={hint}>
      <span>{label}</span>
      {children}
    </div>
  )
  const Num = ({ value, onChange, step = 1, suffix }) => (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <input className="input" style={{ width: 74 }} type="number" step={step} min={0} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      {suffix && <span className="muted" style={{ fontSize: 11 }}>{suffix}</span>}
    </span>
  )

  // ---- local data vault ----
  let bytes = 0
  try {
    bytes = (localStorage.getItem('aloha-aba.v3') || '').length
  } catch {}
  const doExport = () => {
    const snap = { exported: new Date().toISOString(), appts, claims, staff, clients, teams, settings, reports: state.reports }
    downloadDoc(`pulse-aba-backup-${todayISO()}.json`, JSON.stringify(snap), 'application/json')
    toast({ message: `Workspace exported — ${Object.keys(appts).length} appointments + ${Object.keys(claims).length} claims as JSON`, kind: 'ok' })
  }
  const doImport = (file) => {
    const fr = new FileReader()
    fr.onload = () => {
      try {
        const data = JSON.parse(String(fr.result))
        if (!data.appts || typeof data.appts !== 'object') throw new Error('no ledger')
        const n = Object.keys(data.appts).length
        actions.replace(data)
        toast({ message: `Backup restored — ${n} appointment${n === 1 ? '' : 's'} now in the workspace`, kind: 'ok', action: { label: 'Undo', onClick: () => actions.undo() } })
      } catch (err) {
        toast({ message: 'That file is not a Aloha ABA backup (missing an appointment ledger)', kind: 'warn' })
      }
      if (fileRef.current) fileRef.current.value = ''
    }
    fr.readAsText(file)
  }

  const clientsById = Object.fromEntries(clients.map((c) => [c.id, c]))
  const staffById = Object.fromEntries(staff.map((x) => [x.id, x]))
  const audit = titleAudit(appts)
  const [healthOpen, setHealthOpen] = useState(false)
  const sampleClient = clients[0] || { name: 'Ana Reyes' }
  const sampleStaff = staff[0] || { name: 'Dhananjay Masal', role: 'RBT · Center' }
  const sampleTitle = apptAutoTitle({
    type: 'service',
    clientIds: [sampleClient.id, clients[1]?.id].filter(Boolean),
    staffIds: [sampleStaff.id, staff[1]?.id].filter(Boolean),
    start: 540, end: 600,
    clients: { [sampleClient.id]: sampleClient, ...(clients[1] ? { [clients[1].id]: clients[1] } : {}) },
    staff: staffById, settings,
    serviceOverride: 'dtt', locationOverride: sampleClient.home || 'Main Center',
  })
  const restyle = () => {
    actions.relabel()
    toast({ message: `${audit.total} flagged title${audit.total === 1 ? '' : 's'} rebuilt to the “${NAME_STYLES[settings.apptNameStyle || 'ehr'].label}” convention`, kind: 'ok', action: { label: 'Undo', onClick: () => actions.undo() } })
    setHealthOpen(false)
  }

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal set-modal" role="dialog" aria-label="Settings">
        <div className="modal-head">
          <h2>{Icon.dots({ size: 15 })} Settings</h2>
          <span className="spacer" />
          <span className="muted" style={{ fontSize: 11 }}>saved to this browser automatically</span>
          <button className="modal-x" onClick={onClose} aria-label="Close">
            {Icon.x({ size: 14 })}
          </button>
        </div>
        <div className="modal-body set-cols">
          <div className="set-col">
            <div className="menu-h">Workspace</div>
            <Row label="Theme">
              <div className="viewseg">
                {['light', 'dark'].map((t) => (
                  <button key={t} className={settings.theme === t ? 'on' : ''} onClick={() => actions.setSettings({ theme: t })}>
                    {t === 'light' ? 'Light' : 'Dark'}
                  </button>
                ))}
              </div>
            </Row>
            <Row label="Week starts on">
              <div className="viewseg">
                {[0, 1].map((d) => (
                  <button key={d} className={settings.weekStart === d ? 'on' : ''} onClick={() => actions.setSettings({ weekStart: d })}>
                    {d === 0 ? 'Sunday' : 'Monday'}
                  </button>
                ))}
              </div>
            </Row>
            <Row label="24-hour clock">
              <button className={`toggle ${settings.h24 ? 'on' : ''}`} onClick={() => actions.setSettings({ h24: !settings.h24 })} aria-pressed={settings.h24} />
            </Row>
            <Row label="Default rate / unit">
              <Num value={settings.defaultRate} onChange={(v) => actions.setSettings({ defaultRate: v })} suffix="$" />
            </Row>
            <Row label="Mileage rate / mile">
              <Num value={settings.mileageRate} step={0.05} onChange={(v) => actions.setSettings({ mileageRate: v })} suffix="$" />
            </Row>
            <div className="menu-h" style={{ paddingTop: 14 }}>Appointment naming</div>
            <Row label="Convention">
              <div className="viewseg" role="group" aria-label="Appointment naming convention" data-testid="set-naming">
                {Object.entries(NAME_STYLES).map(([k, n]) => (
                  <button key={k} className={(settings.apptNameStyle || 'ehr') === k ? 'on' : ''} data-testid={`set-name-${k}`} title={n.desc} onClick={() => actions.setSettings({ apptNameStyle: k })}>
                    {n.label}
                  </button>
                ))}
              </div>
            </Row>
            <Row label="Title extras">
              <div className="viewseg set-extras" role="group" aria-label="Title extras" data-testid="set-extras">
                {[['program', 'Program', 'append the client’s program'], ['location', 'Location', 'append “@ where”'], ['service', 'Service', 'use the curated service line (and its CPT in code style) instead of the generic type'], ['staff', 'Staff', 'append the assigned crew, e.g. (Ana R., RBT)']].map(([k, lab, tip]) => {
                  const on = k === 'staff' ? !!settings.apptNameStaff : !!(settings.apptTitleExtras || {})[k]
                  return (
                    <button key={k} className={on ? 'on' : ''} data-testid={`set-extra-${k}`} title={tip} onClick={() => { if (k === 'staff') actions.setSettings({ apptNameStaff: !on }); else actions.setSettings({ apptTitleExtras: { ...(settings.apptTitleExtras || {}), [k]: !on } }) }}>
                      {lab}
                    </button>
                  )
                })}
              </div>
            </Row>
            <div className="set-nam" data-testid="set-name-preview">
              {sampleTitle}
            </div>
            <Row label="Title health">
              {audit.total > 0 ? (
                <button className="btn btn-sm set-flag" data-testid="set-name-review" title="List the flagged titles and rebuild them" onClick={() => setHealthOpen((v) => !v)}>
                  {Icon.alert({ size: 12 })} {audit.total} flagged
                </button>
              ) : (
                <span className="set-ok" data-testid="set-name-clean">✓ {Object.keys(appts).length} titles pass</span>
              )}
            </Row>
            {audit.total > 0 && (
              <div className="set-health" data-testid="set-health">
                <div className="sh-why">
                  {audit.legacy.length > 0 && <span>{audit.legacy.length} legacy “(Type) …” shape</span>}
                  {audit.untitled.length > 0 && <span>{audit.untitled.length} blank</span>}
                  {audit.long.length > 0 && <span>{audit.long.length} over 72 chars for agenda rows</span>}
                </div>
                {healthOpen && (
                  <div className="sh-list">
                    {[...audit.legacy, ...audit.untitled, ...audit.long].slice(0, 8).map((id) => (
                      <button key={id} type="button" data-testid={`sh-row-${id}`} onClick={() => { actions.setUI({ section: 'calendar', view: 'week', anchor: appts[id].date, detail: id }); onClose() }}>
                        <b>{appts[id].title?.trim() || '— no title —'}</b>
                        <i>{appts[id].date}</i>
                      </button>
                    ))}
                    {audit.total > 8 && <span className="sh-more">+{audit.total - 8} more flagged</span>}
                  </div>
                )}
                <button className="btn btn-sm btn-primary" data-testid="set-name-apply" title="Rebuild only the flagged titles from their real client / service / time — every other title is untouched" onClick={restyle}>
                  {Icon.zap({ size: 12 })} Rework {audit.total} title{audit.total === 1 ? '' : 's'}
                </button>
              </div>
            )}
            <div className="menu-h" style={{ paddingTop: 14 }}>Data & backup</div>
            <div className="set-vault">
              <div className="sv-stats" data-testid="set-storage-stat">
                <div><b>{Object.keys(appts).length}</b><span>appointments</span></div>
                <div><b>{Object.keys(claims).length}</b><span>claims</span></div>
                <div><b>{clients.length}</b><span>clients</span></div>
                <div><b>{Math.max(1, Math.round(bytes / 1024))} KB</b><span>local storage</span></div>
              </div>
              <div className="sv-actions">
                <button className="btn btn-sm" onClick={doExport} data-testid="set-export">{Icon.download({ size: 12 })} Export workspace (.json)</button>
                <button className="btn btn-sm" onClick={() => fileRef.current?.click()} data-testid="set-import">{Icon.copy({ size: 12 })} Restore backup…</button>
                <input ref={fileRef} type="file" accept="application/json,.json" data-testid="set-import-file" style={{ display: 'none' }} onChange={(e) => e.target.files?.[0] && doImport(e.target.files[0])} />
              </div>
              <p className="muted" style={{ fontSize: 10.8, margin: '2px 0 0', lineHeight: 1.5 }}>
                Everything lives in this browser. Export a snapshot before big edits — restoring replaces the ledger, claims, roster and settings in one step (undoable).
              </p>
            </div>
            <div style={{ padding: '10px 0 4px', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                className="btn btn-sm"
                data-testid="set-reseed"
                onClick={() => {
                  if (arm !== 'reseed') return setArm('reseed')
                  setArm(null)
                  actions.reseed()
                  toast({ message: 'Demo schedule regenerated', kind: 'ok' })
                  onClose()
                }}
              >
                {Icon.zap({ size: 13 })} {arm === 'reseed' ? 'Click again to regenerate' : 'Regenerate demo data'}
              </button>
              <button
                className="btn btn-sm"
                style={arm === 'clear' ? { color: '#fff', background: 'var(--danger)', borderColor: 'var(--danger)' } : { color: 'var(--danger)' }}
                data-testid="set-clear"
                onClick={() => {
                  if (arm !== 'clear') return setArm('clear')
                  setArm(null)
                  actions.clearDemo()
                  toast({ message: 'Workspace cleared', kind: 'warn', action: { label: 'Undo', onClick: () => actions.undo() } })
                  onClose()
                }}
              >
                {Icon.trash({ size: 13 })} {arm === 'clear' ? 'Really clear all appointments?' : 'Clear all appointments'}
              </button>
              {arm && (
                <button className="btn btn-sm btn-ghost" onClick={() => setArm(null)}>
                  Cancel
                </button>
              )}
            </div>
          </div>
          <div className="set-col">
            <div className="menu-h">Smart scheduling</div>
            <Row label="Staff suggestions shown" hint="How many candidate staff the detail card offers for open sessions">
              <div className="viewseg">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button key={n} className={sm.suggest.count === n ? 'on' : ''} onClick={() => patch('suggest', { count: n })}>{n}</button>
                ))}
              </div>
            </Row>
            <Row label="Backfill candidates" hint="Ranked alternatives offered when a session needs cover">
              <div className="viewseg">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button key={n} className={sm.backfill.count === n ? 'on' : ''} onClick={() => patch('backfill', { count: n })}>{n}</button>
                ))}
              </div>
            </Row>
            <Row label="Min backfill confidence" hint="Candidates scoring below this are never suggested for re-staffing (0–100)">
              <Num value={sm.backfill.minScore} onChange={(v) => patch('backfill', { minScore: Math.max(0, Math.min(100, v)) })} />
            </Row>
            <Row label="Backfill: same care team only">
              <button className={`toggle ${sm.backfill.sameTeamOnly ? 'on' : ''}`} onClick={() => patch('backfill', { sameTeamOnly: !sm.backfill.sameTeamOnly })} aria-pressed={sm.backfill.sameTeamOnly} />
            </Row>
            <Row label="Backfill: auto-fill button in inbox">
              <button className={`toggle ${sm.backfill.autoFill ? 'on' : ''}`} onClick={() => patch('backfill', { autoFill: !sm.backfill.autoFill })} aria-pressed={sm.backfill.autoFill} />
            </Row>
            <Row label="Backfill: flag tight turnarounds">
              <button className={`toggle ${sm.backfill.turnaround ? 'on' : ''}`} onClick={() => patch('backfill', { turnaround: !sm.backfill.turnaround })} aria-pressed={sm.backfill.turnaround} />
            </Row>
            <div style={{ paddingTop: 10 }}>
              <div className="menu-h" style={{ padding: '4px 0 6px' }}>Ranking weights (50% = neutral)</div>
              <Slider label="Care-team affinity" value={sm.weights.team} onChange={(v) => patch('weights', { team: v })} hint="How strongly to prefer staff on the client's care team" />
              <Slider label="Client history" value={sm.weights.history} onChange={(v) => patch('weights', { history: v })} hint="Prior sessions with this client (continuity of care)" />
              <Slider label="Program & cert fit" value={sm.weights.fit} onChange={(v) => patch('weights', { fit: v })} hint="Role ↔ program match, billing-code certifications, last-to-cover" />
              <Slider label="Workload balance" value={sm.weights.load} onChange={(v) => patch('weights', { load: v })} hint="Spread sessions across the team" />
              <button className="btn btn-ghost btn-sm" style={{ marginTop: 4 }} onClick={() => patch('weights', { team: 60, history: 55, fit: 55, load: 45 })}>{Icon.undo({ size: 12 })} Reset weights</button>
            </div>
            <div className="menu-h" style={{ paddingTop: 14 }}>Billing</div>
            <Row label="Strict authorization (block billing without auth)"><button className={`toggle ${settings.billing?.strictAuth ? 'on' : ''}`} data-testid="set-bill-strictAuth" onClick={()=>actions.setSettings({ billing: { ...settings.billing, strictAuth: !settings.billing?.strictAuth } })} aria-pressed={!!settings.billing?.strictAuth} /></Row>
            <Row label="Supervision check (require supervisor for RBT)"><button className={`toggle ${settings.billing?.supervisionCheck!==false ? 'on' : ''}`} data-testid="set-bill-supervision" onClick={()=>actions.setSettings({ billing: { ...settings.billing, supervisionCheck: !(settings.billing?.supervisionCheck!==false) } })} aria-pressed={settings.billing?.supervisionCheck!==false} /></Row>
            <Row label="Invoice sequence"><Num value={settings.billing?.invoiceSeq ?? 1} onChange={(v)=>actions.setSettings({ billing: { ...settings.billing, invoiceSeq: Math.max(1, Math.round(v)||1) } })} /></Row>
            <Row label="Default filing deadline"><Num value={settings.billing?.defaultFilingDays ?? 90} onChange={(v)=>actions.setSettings({ billing: { ...settings.billing, defaultFilingDays: Math.max(0, Math.round(v)||0) } })} suffix="days" /></Row>
            <p className="muted" style={{ fontSize: 11, lineHeight: 1.5, margin: '12px 0 0' }}>
              This demo persists to your browser's local storage. Connect a backend by replacing the persistence effect in <code>src/state/store.jsx</code>.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
