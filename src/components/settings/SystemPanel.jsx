import React, { useRef, useState } from 'react'
import { blankState } from '../../state/store'
import { Icon } from '../../ui/Icons'
import { smartCfg } from '../../lib/smart'
import { downloadDoc } from '../../lib/exportKit'
import { todayISO } from '../../lib/date'
import { NAME_STYLES, apptAutoTitle, titleAudit } from '../../lib/apptName'
import { createWorkspaceBackup, readWorkspaceBackup } from '../../lib/workspaceBackup'
import { notificationsCfg } from '../../lib/settingsMasters'
import { RANGE_PRESETS, DIMS, METRICS } from '../../lib/analytics'
import { Section, Row, NumberField, Select, Toggle, Banner } from './kit'

/**
 * System Settings — workspace preferences, appointment naming, smart scheduling,
 * notification defaults, analytics/billing defaults, the local data vault and the
 * demo-data actions. Everything here writes through the same guarded actions the
 * standalone modal used, so one Undo reverses any single change.
 */
export function SystemPanel({ state, actions, toast, readOnly, canManageWorkspace, canManageDemo, canRebuildTitles, bytes = 0 }) {
  const { settings, appts, claims, staff, clients } = state
  const fileRef = useRef(null)
  const [arm, setArm] = useState(null) // two-step confirmation instead of native confirm()
  const [pendingRestore, setPendingRestore] = useState(null)
  const [healthOpen, setHealthOpen] = useState(false)

  const sm = smartCfg(settings)
  const patchSmart = (section, v) => {
    const next = { weights: { ...sm.weights }, suggest: { ...sm.suggest }, backfill: { ...sm.backfill } }
    Object.assign(next[section], v)
    actions.setSettings({ smart: next })
  }
  const patch = (p) => !readOnly && actions.setSettings(p)

  const notify = notificationsCfg(settings)
  const setNotify = (v) => patch({ notifications: { ...notify, ...v } })

  const staffById = Object.fromEntries(staff.map((x) => [x.id, x]))
  const audit = titleAudit(appts)
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
    const result = actions.relabel()
    if (result?.ok === false) return // guarded dispatch already explains why the rebuild was denied
    toast({ message: `${audit.total} flagged title${audit.total === 1 ? '' : 's'} rebuilt to the “${NAME_STYLES[settings.apptNameStyle || 'ehr'].label}” convention`, kind: 'ok', action: { label: 'Undo', onClick: () => actions.undo() } })
    setHealthOpen(false)
  }

  // ---- local data vault ----
  const doExport = () => {
    if (!canManageWorkspace) { toast({ message: 'Workspace backups require full access to every module and all-office scope.', kind: 'warn' }); return }
    downloadDoc(`aloha-aba-backup-${todayISO()}.json`, createWorkspaceBackup(state), 'application/json')
    toast({ message: `Full workspace exported — ${Object.keys(appts).length} appointments, ${Object.keys(claims).length} claims and all billing ledgers`, kind: 'ok' })
  }
  const doImport = (file) => {
    if (!canManageWorkspace) { toast({ message: 'Workspace restore requires full access to every module and all-office scope.', kind: 'warn' }); return }
    setPendingRestore(null)
    if (file.size > 50 * 1024 * 1024) {
      toast({ message: 'Backup is too large to open here (50 MB limit)', kind: 'warn' })
      if (fileRef.current) fileRef.current.value = ''
      return
    }
    const fr = new FileReader()
    fr.onload = () => {
      try {
        setPendingRestore(readWorkspaceBackup(String(fr.result), blankState()))
      } catch (err) {
        toast({ message: err.message, kind: 'warn' })
      }
      if (fileRef.current) fileRef.current.value = ''
    }
    fr.onerror = () => { toast({ message: 'Could not read that backup file', kind: 'warn' }); if (fileRef.current) fileRef.current.value = '' }
    fr.readAsText(file)
  }
  const confirmRestore = () => {
    if (!pendingRestore) return
    const { data, counts } = pendingRestore
    const result = actions.replace(data)
    if (result?.ok === false) return // guarded dispatch already explains why restore was denied
    setPendingRestore(null)
    toast({ message: `Backup restored — ${counts.appointments} appointments, ${counts.claims} claims and ${counts.payments} payments`, kind: 'ok', action: { label: 'Undo', onClick: () => actions.undo() }, duration: 8000 })
  }

  const Slider = ({ label, value, onChange, hint, testid }) => (
    <div className="wgt-row" title={hint} data-testid={testid}>
      <span>{label}</span>
      <input type="range" min={0} max={100} value={value} disabled={readOnly} onChange={(e) => onChange(Number(e.target.value))} style={{ backgroundSize: `${value}% 100%` }} />
      <em>{value}%</em>
    </div>
  )

  return (
    <>
      <Section title="Display & workspace" sub="Theme, week start, clock and the money defaults new rows pick up" testId="set-sys-display">
        <div className="set-grid2">
          <Row label="Theme">
            <div className="viewseg">
              {['light', 'dark'].map((t) => (
                <button key={t} className={settings.theme === t ? 'on' : ''} disabled={readOnly} onClick={() => patch({ theme: t })}>{t === 'light' ? 'Light' : 'Dark'}</button>
              ))}
            </div>
          </Row>
          <Row label="Week starts on">
            <div className="viewseg">
              {[0, 1].map((d) => (
                <button key={d} className={settings.weekStart === d ? 'on' : ''} disabled={readOnly} onClick={() => patch({ weekStart: d })}>{d === 0 ? 'Sunday' : 'Monday'}</button>
              ))}
            </div>
          </Row>
          <Row label="24-hour clock"><Toggle on={!!settings.h24} disabled={readOnly} testid="set-sys-h24" onChange={(v) => patch({ h24: v })} /></Row>
          <Row label="Default rate / unit"><NumberField value={settings.defaultRate} min={0} max={1000} suffix="$" testid="set-sys-rate" onCommit={(v) => patch({ defaultRate: v })} /></Row>
          <Row label="Mileage rate / mile"><NumberField value={settings.mileageRate} min={0} max={10} step={0.05} suffix="$" testid="set-sys-mileage" onCommit={(v) => patch({ mileageRate: v })} /></Row>
          <Row label="Weekday hours"><span className="set-inline"><NumberField value={settings.workday?.[0] ?? 8} min={0} max={23} testid="set-sys-wd0" onCommit={(v) => patch({ workday: [v, settings.workday?.[1] ?? 18] })} /><span className="muted">→</span><NumberField value={settings.workday?.[1] ?? 18} min={1} max={24} testid="set-sys-wd1" onCommit={(v) => patch({ workday: [settings.workday?.[0] ?? 8, v] })} /></span></Row>
        </div>
      </Section>

      <Section title="Appointment naming" sub="The convention every auto-title follows — the preview uses your real seeded client and staff" testId="set-sys-naming">
        <Row label="Convention">
          <div className="viewseg" role="group" aria-label="Appointment naming convention" data-testid="set-naming">
            {Object.entries(NAME_STYLES).map(([k, n]) => (
              <button key={k} className={(settings.apptNameStyle || 'ehr') === k ? 'on' : ''} disabled={readOnly} data-testid={`set-name-${k}`} title={n.desc} onClick={() => patch({ apptNameStyle: k })}>{n.label}</button>
            ))}
          </div>
        </Row>
        <Row label="Title extras">
          <div className="viewseg set-extras" role="group" aria-label="Title extras" data-testid="set-extras">
            {[['program', 'Program', 'append the client’s program'], ['location', 'Location', 'append “@ where”'], ['service', 'Service', 'use the curated service line (and its CPT in code style) instead of the generic type'], ['staff', 'Staff', 'append the assigned crew, e.g. (Ana R., RBT)']].map(([k, lab, tip]) => {
              const on = k === 'staff' ? !!settings.apptNameStaff : !!(settings.apptTitleExtras || {})[k]
              return (
                <button key={k} className={on ? 'on' : ''} disabled={readOnly} data-testid={`set-extra-${k}`} title={tip} onClick={() => { if (k === 'staff') patch({ apptNameStaff: !on }); else patch({ apptTitleExtras: { ...(settings.apptTitleExtras || {}), [k]: !on } }) }}>{lab}</button>
              )
            })}
          </div>
        </Row>
        <div className="set-nam" data-testid="set-name-preview">{sampleTitle}</div>
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
                  <button key={id} type="button" data-testid={`sh-row-${id}`} onClick={() => actions.setUI({ section: 'calendar', view: 'week', anchor: appts[id].date, detail: id, settings: false })}>
                    <b>{appts[id].title?.trim() || '— no title —'}</b>
                    <i>{appts[id].date}</i>
                  </button>
                ))}
                {audit.total > 8 && <span className="sh-more">+{audit.total - 8} more flagged</span>}
              </div>
            )}
            {canRebuildTitles ? (
              <button className="btn btn-sm btn-primary" data-testid="set-name-apply" title="Rebuild only the flagged titles from their real client / service / time — every other title is untouched" onClick={restyle} disabled={readOnly}>
                {Icon.zap({ size: 12 })} Rework {audit.total} title{audit.total === 1 ? '' : 's'}
              </button>
            ) : <span className="muted">Bulk title rebuild requires full Calendar and Settings access with all-office scope.</span>}
          </div>
        )}
      </Section>

      <Section title="Smart scheduling" sub="How candidate staff are ranked for open sessions" testId="set-sys-smart">
        <div className="set-grid2">
          <Row label="Staff suggestions shown" hint="How many candidate staff the detail card offers for open sessions">
            <div className="viewseg" data-testid="set-smart-suggest">
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n} className={sm.suggest.count === n ? 'on' : ''} disabled={readOnly} onClick={() => patchSmart('suggest', { count: n })}>{n}</button>
              ))}
            </div>
          </Row>
          <Row label="Backfill candidates" hint="Ranked alternatives offered when a session needs cover">
            <div className="viewseg" data-testid="set-smart-backfill">
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n} className={sm.backfill.count === n ? 'on' : ''} disabled={readOnly} onClick={() => patchSmart('backfill', { count: n })}>{n}</button>
              ))}
            </div>
          </Row>
          <Row label="Min backfill confidence" hint="Candidates scoring below this are never suggested for re-staffing (0–100)">
            <NumberField value={sm.backfill.minScore} min={0} max={100} suffix="%" testid="set-smart-min" disabled={readOnly} onCommit={(v) => patchSmart('backfill', { minScore: v })} />
          </Row>
          <Row label="Backfill: same care team only">
            <Toggle on={!!sm.backfill.sameTeamOnly} disabled={readOnly} testid="set-smart-team" onChange={(v) => patchSmart('backfill', { sameTeamOnly: v })} />
          </Row>
          <Row label="Backfill: auto-fill button in inbox">
            <Toggle on={!!sm.backfill.autoFill} disabled={readOnly} testid="set-smart-autofill" onChange={(v) => patchSmart('backfill', { autoFill: v })} />
          </Row>
          <Row label="Backfill: flag tight turnarounds">
            <Toggle on={!!sm.backfill.turnaround} disabled={readOnly} testid="set-smart-turnaround" onChange={(v) => patchSmart('backfill', { turnaround: v })} />
          </Row>
        </div>
        <div className="set-weights">
          <div className="menu-h" style={{ padding: '4px 0 6px' }}>Ranking weights (50% = neutral)</div>
          <Slider label="Care-team affinity" value={sm.weights.team} onChange={(v) => patchSmart('weights', { team: v })} hint="How strongly to prefer staff on the client's care team" testid="set-smart-w-team" />
          <Slider label="Client history" value={sm.weights.history} onChange={(v) => patchSmart('weights', { history: v })} hint="Prior sessions with this client (continuity of care)" testid="set-smart-w-history" />
          <Slider label="Program & cert fit" value={sm.weights.fit} onChange={(v) => patchSmart('weights', { fit: v })} hint="Role ↔ program match, billing-code certifications, last-to-cover" testid="set-smart-w-fit" />
          <Slider label="Workload balance" value={sm.weights.load} onChange={(v) => patchSmart('weights', { load: v })} hint="Spread sessions across the team" testid="set-smart-w-load" />
          <button className="btn btn-ghost btn-sm" style={{ marginTop: 4, alignSelf: 'flex-start' }} disabled={readOnly} data-testid="set-smart-reset" onClick={() => patchSmart('weights', { team: 60, history: 55, fit: 55, load: 45 })}>{Icon.undo({ size: 12 })} Reset weights</button>
        </div>
      </Section>

      <Section title="Notifications" sub="Which local reminders this workspace surfaces — nothing is emailed or texted" testId="set-sys-notify">
        <div className="set-grid2">
          <Row label="Timely filing deadlines"><Toggle on={notify.timelyFiling !== false} disabled={readOnly} testid="set-sys-filing" onChange={(v) => setNotify({ timelyFiling: v })} /></Row>
          <Row label="Authorisation expiries"><Toggle on={notify.authExpiry !== false} disabled={readOnly} testid="set-sys-auth" onChange={(v) => setNotify({ authExpiry: v })} /></Row>
          <Row label="Parked ERA payments"><Toggle on={notify.parkedEra !== false} disabled={readOnly} testid="set-sys-era" onChange={(v) => setNotify({ parkedEra: v })} /></Row>
          <Row label="Secondary claims ready"><Toggle on={notify.secondaryReady !== false} disabled={readOnly} testid="set-sys-secondary" onChange={(v) => setNotify({ secondaryReady: v })} /></Row>
          <Row label="Intake SLA breaches"><Toggle on={notify.intakeSla !== false} disabled={readOnly} testid="set-sys-sla" onChange={(v) => setNotify({ intakeSla: v })} /></Row>
          <Row label="Browser toasts while the tab is open"><Toggle on={!!notify.browserToasts} disabled={readOnly} testid="set-sys-toasts" onChange={(v) => setNotify({ browserToasts: v })} /></Row>
        </div>
        <Banner tone="info">Notification preferences only change what the local workspace highlights. This demo never sends mail, SMS or push messages.</Banner>
      </Section>

      <Section title="Analytics defaults" sub="The range, metric and dimension the Analytics board opens with" testId="set-sys-an">
        <div className="set-grid2">
          <Row label="Default range"><Select value={settings.analytics?.range || '30d'} wide={150} disabled={readOnly} testid="set-an-range" options={RANGE_PRESETS.map((p) => ({ value: p.id, label: p.label }))} onChange={(v) => patch({ analytics: { ...settings.analytics, range: v } })} /></Row>
          <Row label="Metric"><Select value={settings.analytics?.metric || 'sessions'} wide={170} disabled={readOnly} testid="set-an-metric" options={Object.entries(METRICS).map(([id, m]) => ({ value: id, label: m.label }))} onChange={(v) => patch({ analytics: { ...settings.analytics, metric: v } })} /></Row>
          <Row label="Dimension"><Select value={settings.analytics?.dim || 'staff'} wide={170} disabled={readOnly} testid="set-an-dim" options={Object.entries(DIMS).map(([id, d]) => ({ value: id, label: d.label }))} onChange={(v) => patch({ analytics: { ...settings.analytics, dim: v } })} /></Row>
        </div>
      </Section>

      <Section title="Billing defaults" sub="Authorisation and filing behaviour the billing desk reads" testId="set-sys-billing">
        <Row label="Strict authorization (block billing without auth)">
          <Toggle on={!!settings.billing?.strictAuth} disabled={readOnly} testid="set-bill-strictAuth" onChange={(v) => patch({ billing: { ...settings.billing, strictAuth: v } })} />
        </Row>
        <Row label="Supervision check (require supervisor for RBT)">
          <Toggle on={settings.billing?.supervisionCheck !== false} disabled={readOnly} testid="set-bill-supervision" onChange={(v) => patch({ billing: { ...settings.billing, supervisionCheck: v } })} />
        </Row>
        <div className="set-grid2">
          <Row label="Invoice sequence"><NumberField value={settings.billing?.invoiceSeq ?? 1} min={1} max={100000} testid="set-bill-seq" disabled={readOnly} onCommit={(v) => patch({ billing: { ...settings.billing, invoiceSeq: v } })} /></Row>
          <Row label="Default filing deadline"><NumberField value={settings.billing?.defaultFilingDays ?? 90} min={0} max={365} suffix="days" testid="set-bill-filing" disabled={readOnly} onCommit={(v) => patch({ billing: { ...settings.billing, defaultFilingDays: v } })} /></Row>
        </div>
      </Section>

      <Section title="Data & backup" sub="Everything lives in this browser — export before big edits" testId="set-sys-data">
        <div className="set-vault">
          <div className="sv-stats" data-testid="set-storage-stat">
            <div><b>{Object.keys(appts).length}</b><span>appointments</span></div>
            <div><b>{Object.keys(claims).length}</b><span>claims</span></div>
            <div><b>{clients.length}</b><span>clients</span></div>
            <div><b>{Math.max(1, Math.round(bytes / 1024))} KB</b><span>local storage</span></div>
          </div>
          <div className="sv-actions">
            <button className="btn btn-sm" disabled={!canManageWorkspace} onClick={doExport} data-testid="set-export">{Icon.download({ size: 12 })} Export workspace (.json)</button>
            <button className="btn btn-sm" disabled={!canManageWorkspace} onClick={() => fileRef.current?.click()} data-testid="set-import">{Icon.copy({ size: 12 })} Restore backup…</button>
            <input ref={fileRef} type="file" disabled={!canManageWorkspace} accept="application/json,.json" data-testid="set-import-file" style={{ display: 'none' }} onChange={(e) => e.target.files?.[0] && doImport(e.target.files[0])} />
          </div>
          {!canManageWorkspace && <p className="sv-legacy">Workspace backup and restore require full access to every module plus all-office scope. Switch to an authorized administrator or contact one.</p>}
          <p className="muted" style={{ fontSize: 10.8, margin: '2px 0 0', lineHeight: 1.5 }}>
            The JSON includes appointments, billing ledgers, payers, service &amp; field masters, settings, reports and dashboards. Undo is available in this tab only.
          </p>
          {pendingRestore && (
            <div className="sv-restore-preview" data-testid="set-restore-preview" role="status">
              <b>Replace this workspace?</b>
              <span>{pendingRestore.counts.appointments} appointment{pendingRestore.counts.appointments === 1 ? '' : 's'} · {pendingRestore.counts.claims} claim{pendingRestore.counts.claims === 1 ? '' : 's'} · {pendingRestore.counts.payments} payment{pendingRestore.counts.payments === 1 ? '' : 's'} in backup. Your current data will be replaced; export it first if you need a copy.</span>
              {pendingRestore.legacy && <span className="sv-legacy">Older partial backup: payer/service/field masters and billing ledgers were not included in that format. Missing data will reset to demo defaults or empty ledgers.</span>}
              <div className="sv-actions">
                <button className="btn btn-sm btn-primary" type="button" data-testid="set-restore-confirm" onClick={confirmRestore}>Replace workspace</button>
                <button className="btn btn-sm" type="button" data-testid="set-restore-cancel" onClick={() => setPendingRestore(null)}>Cancel</button>
              </div>
            </div>
          )}
        </div>
      </Section>

      <Section title="Demo data" sub="Rebuild the fictional sample workspace, or clear the schedule while keeping masters" testId="set-sys-demo">
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <button
            className="btn btn-sm"
            data-testid="set-reseed"
            disabled={!canManageDemo}
            onClick={() => {
              if (arm !== 'reseed') return setArm('reseed')
              setArm(null)
              const result = actions.reseed()
              if (result?.ok === false) return
              toast({ message: 'Demo schedule & billing regenerated', kind: 'ok', action: { label: 'Undo', onClick: () => actions.undo() } })
            }}
          >
            {Icon.zap({ size: 13 })} {arm === 'reseed' ? 'Click again to regenerate schedule & billing' : 'Regenerate demo data'}
          </button>
          <button
            className="btn btn-sm"
            style={arm === 'clear' ? { color: '#fff', background: 'var(--danger)', borderColor: 'var(--danger)' } : { color: 'var(--danger)' }}
            data-testid="set-clear"
            disabled={!canManageDemo}
            onClick={() => {
              if (arm !== 'clear') return setArm('clear')
              setArm(null)
              const result = actions.clearDemo()
              if (result?.ok === false) return
              toast({ message: 'Schedule & billing cleared — masters and settings kept', kind: 'warn', action: { label: 'Undo', onClick: () => actions.undo() } })
            }}
          >
            {Icon.trash({ size: 13 })} {arm === 'clear' ? 'Really clear schedule & billing?' : 'Clear schedule & billing'}
          </button>
          {arm && <button className="btn btn-sm btn-ghost" onClick={() => setArm(null)}>Cancel</button>}
          {!canManageDemo && <span className="muted" style={{ fontSize: 10.5 }}>Reset actions require full access to affected modules and all-office scope.</span>}
        </div>
        <div className="set-banner info" data-testid="set-sys-about">
          {Icon.info({ size: 14 })}
          <div>
            <b>Aloha ABA · local demo build</b>
            <span>Vite + React, browser-only persistence under <code>aloha-aba.v3</code>. No server, no PHI, no payer connection — every name, claim and telephone number here is fictional.</span>
          </div>
        </div>
      </Section>
    </>
  )
}

export default SystemPanel
