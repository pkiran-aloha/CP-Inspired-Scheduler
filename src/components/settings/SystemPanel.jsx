import React, { useRef, useState } from 'react'
import { blankState } from '../../state/store'
import { Icon } from '../../ui/Icons'
import { clearPin, hashPin, pinProblem, readPin, writePin } from '../../lib/screenLock'
import { smartCfg } from '../../lib/smart'
import { AUTH_GUARD_DEFAULTS, AUTH_MODES, authGuardCfg } from '../../lib/authBudget'
import { ABA_TRACKS, abaHoursCfg, abaTotals } from '../../lib/abaHours'
import { downloadDoc } from '../../lib/exportKit'
import { todayISO } from '../../lib/date'
import { NAME_STYLES, apptAutoTitle, titleAudit } from '../../lib/apptName'
import { createWorkspaceBackup, readWorkspaceBackup } from '../../lib/workspaceBackup'
import {
  notificationsCfg, SYSTEM_SETTINGS_SECTIONS, systemConfigCfg, appointmentValidationsCfg,
  VALIDATION_LEVELS, clearinghousesCfg, evvCfg, integrationsCfg, INTEGRATION_STATUSES,
} from '../../lib/settingsMasters'
import { RANGE_PRESETS, DIMS, METRICS } from '../../lib/analytics'
import { denialReasonsOf, carcHintsOf } from '../../lib/claims'
import { Section, Row, TextField, NumberField, Select, Toggle, Seg, Banner, DataTable, IconButton } from './kit'

/**
 * Screen lock (mismatch #13). The policy (on/off, minutes) is a workspace setting and
 * travels in backups; the PIN is this browser's alone: a salted PBKDF2 hash under its
 * own storage key, never in the workspace, a backup or an Undo step.
 */
function LockSection({ sysCfg, patchSysCfg, readOnly, toast }) {
  const gen = sysCfg.general || {}
  const [hasPin, setHasPin] = useState(() => !!readPin())
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const savePin = async () => {
    const problem = pinProblem(pin)
    if (problem) { toast({ message: `PIN not saved. ${problem}`, kind: 'warn' }); return }
    setBusy(true)
    try {
      writePin(await hashPin(pin))
      setHasPin(true)
      setPin('')
      toast({ message: 'Lock PIN saved in this browser as a salted hash. It unlocks the screen lock on this device only.', kind: 'ok' })
    } catch (err) {
      toast({ message: `PIN not saved: ${err.message}`, kind: 'warn' })
    }
    setBusy(false)
  }
  const removePin = () => {
    clearPin()
    setHasPin(false)
    toast({ message: 'Lock PIN removed from this browser. The lock now unlocks with “I’m back”.', kind: 'ok' })
  }
  return (
    <Section title="Screen lock" sub="A privacy screen for this browser tab. There is no sign-in in this local app" testId="lock-settings">
      <div className="set-grid2">
        <Row label="Lock When Idle" hint="Covers this tab after the idle minutes below. Lock now in the navigation locks it at any time.">
          <Toggle on={gen.screenLockEnabled === true} disabled={readOnly} testid="lock-enabled" label="Lock when idle" onChange={(v) => patchSysCfg('general', { screenLockEnabled: v })} />
        </Row>
        <Row label="Screen Lock in Minutes" hint="Minutes without pointer or keyboard activity before this tab locks">
          <NumberField value={gen.screenLockMinutes ?? 15} min={1} max={240} suffix="min" disabled={readOnly} testid="set-sys-gen-lock" onCommit={(v) => patchSysCfg('general', { screenLockMinutes: v })} />
        </Row>
        <Row label="Locked Session Auto Logout in Minutes" hint="Minutes on the lock screen before this tab's session ends">
          <NumberField value={gen.autoLogoutMinutes ?? 60} min={5} max={480} suffix="min" disabled={readOnly} testid="set-sys-gen-logout" onCommit={(v) => patchSysCfg('general', { autoLogoutMinutes: v })} />
        </Row>
        <Row label="MFA Required" hint="Needs the production sign-in; not enforced locally">
          <span className="set-inline">
            <Toggle on={gen.mfaRequired === true} disabled testid="set-sys-gen-mfa" label="MFA needs the production sign-in" onChange={() => {}} />
            <span className="muted" data-testid="lock-mfa-note">Needs the production sign-in; not enforced locally</span>
          </span>
        </Row>
        <Row label="Lock PIN (this browser)" hint="4 to 12 digits. Stored only as a salted PBKDF2-SHA-256 hash in this browser" stack>
          <span className="set-inline">
            <span className="muted" data-testid="lock-pin-status">{hasPin ? 'Set on this browser' : 'Not set'}</span>
            <input
              className="input" type="password" inputMode="numeric" autoComplete="new-password" maxLength={12} style={{ width: 120 }}
              placeholder={hasPin ? 'New PIN' : 'PIN'} aria-label="Lock PIN" value={pin} disabled={readOnly || busy} data-testid="lock-pin-input"
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
              onKeyDown={(e) => { if (e.key === 'Enter') savePin() }}
            />
            <button className="btn btn-sm" type="button" disabled={readOnly || busy || !pin} data-testid="lock-pin-save" onClick={savePin}>{hasPin ? 'Change PIN' : 'Set PIN'}</button>
            {hasPin && <button className="btn btn-sm" type="button" disabled={readOnly || busy} data-testid="lock-pin-clear" onClick={removePin}>Remove PIN</button>}
          </span>
        </Row>
      </div>
      <Banner testid="lock-settings-note">
        {hasPin
          ? 'The lock covers this tab and unlocks with the PIN. '
          : 'No PIN is set, so the lock only hides the screen: anyone at this computer can press “I’m back”. '}
        After the auto-logout minutes on the lock screen, this tab’s Undo history is cleared and open dialogs close without saving; saved work is never deleted.
        This is not a security boundary: the workspace stays readable in this browser’s storage, each tab locks on its own, and a newly opened tab starts unlocked. The PIN is never in a backup.
      </Banner>
    </Section>
  )
}

/**
 * System Settings — workspace preferences, appointment naming, smart scheduling,
 * notification defaults, analytics/billing defaults, the local data vault and the
 * demo-data actions. Everything here writes through the same guarded actions the
 * standalone modal used, so one Undo reverses any single change.
 */
export function SystemPanel({ state, actions, toast, readOnly, sub, canManageWorkspace, canManageDemo, canRebuildTitles, bytes = 0 }) {
  const { settings, appts, claims, staff, clients } = state
  const activeSub = sub || 'general'
  const fileRef = useRef(null)
  const [arm, setArm] = useState(null) // two-step confirmation instead of native confirm()
  const [pendingRestore, setPendingRestore] = useState(null)
  const [healthOpen, setHealthOpen] = useState(false)
  const [chEditor, setChEditor] = useState(null)

  const sm = smartCfg(settings)
  const patchSmart = (section, v) => {
    const next = { weights: { ...sm.weights }, suggest: { ...sm.suggest }, backfill: { ...sm.backfill } }
    Object.assign(next[section], v)
    actions.setSettings({ smart: next })
  }
  const patch = (p) => !readOnly && actions.setSettings(p)

  const ag = authGuardCfg(settings)
  const patchGuard = (v) => patch({ authGuard: { ...ag, ...v } })

  const notify = notificationsCfg(settings)
  const setNotify = (v) => {
    const res = actions.settingsOp('notifications.patch', { patch: v })
    toast({ message: res.msg, kind: res.ok ? 'ok' : 'warn' })
  }

  const sysCfg = systemConfigCfg(settings)
  const patchSysCfg = (sectionKey, changes) => {
    const res = actions.settingsOp('systemConfig.patch', { patch: { [sectionKey]: { ...(sysCfg[sectionKey] || {}), ...changes } } })
    toast({ message: res.msg, kind: res.ok ? 'ok' : 'warn' })
  }

  const abaCfg = abaHoursCfg(settings)
  const patchAba = (v) => patch({ abaHours: { ...abaCfg, ...v } })

  const valCfg = appointmentValidationsCfg(settings)
  const patchVal = (group, ruleKey, level) => {
    const res = actions.settingsOp('appointmentValidations.patch', {
      patch: { [group]: { ...(valCfg[group] || {}), [ruleKey]: level } },
    })
    toast({ message: res.msg, kind: res.ok ? 'ok' : 'warn' })
  }

  const chRows = clearinghousesCfg(settings)
  const saveCh = (item) => {
    const res = actions.settingsOp('clearinghouse.upsert', { item })
    toast({ message: res.msg, kind: res.ok ? 'ok' : 'warn' })
    if (res.ok) setChEditor(null)
  }
  const removeCh = (id) => {
    const res = actions.settingsOp('clearinghouse.remove', { id })
    toast({ message: res.msg, kind: res.ok ? 'ok' : 'warn' })
  }

  const evv = evvCfg(settings)
  const patchEvv = (changes) => {
    const res = actions.settingsOp('evv.patch', { patch: changes })
    toast({ message: res.msg, kind: res.ok ? 'ok' : 'warn' })
  }

  const clinicalRows = integrationsCfg(settings).filter((r) => r.category === 'clinical')
  const patchIntegration = (id, changes) => {
    const res = actions.settingsOp('integration.patch', { id, patch: changes })
    toast({ message: res.msg, kind: res.ok ? 'ok' : 'warn' })
  }

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

  const ValidationRuleRow = ({ group, ruleKey, label, hint }) => {
    const val = (valCfg[group] || {})[ruleKey] || 'none'
    return (
      <Row label={label} hint={hint}>
        <Seg
          value={val}
          disabled={readOnly}
          testid={`set-val-${group}-${ruleKey}`}
          ariaLabel={`${label} validation level`}
          options={VALIDATION_LEVELS.map((l) => ({ value: l.id, label: l.label }))}
          onChange={(v) => patchVal(group, ruleKey, v)}
        />
      </Row>
    )
  }

  const sectionBlocks = {
    general: (
      <React.Fragment key="sys-block-general">
        <Section title="General Settings" sub="Signature policies, appointment length, cache refresh, and supervision job titles" testId="set-sys-general">
          <div className="set-grid2">
            <Row label="Staff Signature Required to Complete Appointments" hint="Requires a staff verification signature before a session can be marked Completed">
              <Toggle on={sysCfg.general?.staffSigRequiredToComplete === true} disabled={readOnly} testid="set-sys-gen-sigreq" onChange={(v) => patchSysCfg('general', { staffSigRequiredToComplete: v })} />
            </Row>
            <Row label="Maximum Appointment Length" hint="Warns when a single scheduled session runs longer than this (in minutes) — a warning, not a hard block">
              <NumberField value={sysCfg.general?.maxAppointmentLengthMins ?? 480} min={30} max={1440} step={15} suffix="min" disabled={readOnly} testid="set-sys-gen-maxlen" onCommit={(v) => patchSysCfg('general', { maxAppointmentLengthMins: v })} />
            </Row>
            <Row label="Refresh Cache in Seconds" hint="Schedule board polling / refresh interval">
              <NumberField value={sysCfg.general?.refreshCacheSeconds ?? 300} min={15} max={3600} step={15} suffix="sec" disabled={readOnly} testid="set-sys-gen-cache" onCommit={(v) => patchSysCfg('general', { refreshCacheSeconds: v })} />
            </Row>
            <Row label="Supervision Job Titles" hint="Comma-separated roles recognized as clinical supervisors" stack>
              <TextField
                value={(sysCfg.general?.supervisionJobTitles || ['BCBA', 'BCBA-D', 'BCaBA', 'Clinical Director']).join(', ')}
                disabled={readOnly}
                wide={420}
                testid="set-sys-gen-suptitles"
                onCommit={(v) => patchSysCfg('general', { supervisionJobTitles: v.split(',').map((x) => x.trim()).filter(Boolean) })}
              />
            </Row>
          </div>
        </Section>

        <LockSection sysCfg={sysCfg} patchSysCfg={patchSysCfg} readOnly={readOnly} toast={toast} />

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
            <Row label="Practice days" hint="Days per week counted as clinician supply on the caseload ramp. At least one day must remain selected." stack>
              <div className="viewseg" role="group" aria-label="Practice days" data-testid="set-sys-practice-days">
                {['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map((label, day) => {
                  const selected = (settings.practiceDays || [1, 2, 3, 4, 5]).includes(day)
                  return <button key={day} type="button" aria-pressed={selected} className={selected ? 'on' : ''} disabled={readOnly || (selected && (settings.practiceDays || [1, 2, 3, 4, 5]).length === 1)} data-testid={`set-sys-practice-day-${day}`} onClick={() => patch({ practiceDays: selected ? (settings.practiceDays || [1, 2, 3, 4, 5]).filter((d) => d !== day) : [...(settings.practiceDays || [1, 2, 3, 4, 5]), day].sort((a, b) => a - b) })}>{label.slice(0, 3)}</button>
                })}
              </div>
            </Row>
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
      </React.Fragment>
    ),

    clearinghouse: (
      <Section
        key="sys-block-clearinghouse"
        title="Clearing House Integration"
        sub="EDI 837P / 835 clearinghouse connections used by Payer profiles and claim exports"
        testId="set-sys-clearinghouse"
        actions={
          <button className="btn btn-sm btn-primary" disabled={readOnly} data-testid="set-ch-add" onClick={() => setChEditor({ name: '', vendor: 'Office Ally', receiverId: '', submitterId: '', sftpUser: '', sandbox: true, active: true, isDefault: false })}>
            {Icon.plus({ size: 12 })} Add Clearing House
          </button>
        }
      >
        <DataTable
          testid="set-ch-table"
          empty="No clearinghouses configured."
          columns={[
            { key: 'name', label: 'Clearing House', width: '1.3fr' },
            { key: 'rec', label: 'Receiver ID', width: '0.9fr' },
            { key: 'sub', label: 'Submitter ID', width: '0.9fr' },
            { key: 'sftp', label: 'SFTP / API User', width: '1fr' },
            { key: 'env', label: 'Environment', width: '0.75fr' },
            { key: 'st', label: 'Status', width: '0.7fr' },
            { key: 'act', label: '', width: '80px' },
          ]}
          rows={chRows}
          renderRow={(ch) => (
            <div className={`set-trow ${ch.active === false ? 'off' : ''}`} key={ch.id} data-testid={`set-ch-${ch.id}`} style={{ gridTemplateColumns: '1.3fr 0.9fr 0.9fr 1fr 0.75fr 0.7fr 80px' }}>
              <span><b>{ch.name}</b>{ch.isDefault ? <span className="set-pill on" style={{ marginLeft: 6 }}>default</span> : null}</span>
              <span className="muted">{ch.receiverId || '—'}</span>
              <span className="muted">{ch.submitterId || '—'}</span>
              <span className="muted">{ch.sftpUser || '—'}</span>
              <span>{ch.sandbox ? <span className="set-pill warn">sandbox</span> : <span className="set-pill on">production</span>}</span>
              <span>{ch.active === false ? <span className="set-pill">inactive</span> : <span className="set-pill on">active</span>}</span>
              <span className="set-actions">
                <IconButton icon="edit" title={`Edit ${ch.name}`} disabled={readOnly} testid={`set-ch-edit-${ch.id}`} onClick={() => setChEditor({ ...ch })} />
                {!ch.isDefault && <IconButton icon="trash" tone="danger" title={`Remove ${ch.name}`} disabled={readOnly} testid={`set-ch-del-${ch.id}`} onClick={() => removeCh(ch.id)} />}
              </span>
            </div>
          )}
        />
        {chEditor && (
          <div className="set-editor" data-testid="set-ch-editor">
            <div className="set-editor-head"><b>{chEditor.id ? `Edit ${chEditor.name}` : 'Add Clearing House'}</b><button className="iconbtn" onClick={() => setChEditor(null)} aria-label="Close">{Icon.x({ size: 13 })}</button></div>
            <div className="set-grid2">
              <Row label="Clearing House Name *"><TextField value={chEditor.name} wide={220} testid="set-ch-f-name" onCommit={(v) => setChEditor({ ...chEditor, name: v })} /></Row>
              <Row label="Receiver ID (ISA08)"><TextField value={chEditor.receiverId} wide={160} testid="set-ch-f-rec" onCommit={(v) => setChEditor({ ...chEditor, receiverId: v })} /></Row>
              <Row label="Submitter ID (ISA06)"><TextField value={chEditor.submitterId} wide={160} testid="set-ch-f-sub" onCommit={(v) => setChEditor({ ...chEditor, submitterId: v })} /></Row>
              <Row label="SFTP / API Username"><TextField value={chEditor.sftpUser} wide={180} testid="set-ch-f-sftp" onCommit={(v) => setChEditor({ ...chEditor, sftpUser: v })} /></Row>
              <Row label="Sandbox Mode"><Toggle on={!!chEditor.sandbox} testid="set-ch-f-sandbox" onChange={(v) => setChEditor({ ...chEditor, sandbox: v })} /></Row>
              <Row label="Active"><Toggle on={chEditor.active !== false} testid="set-ch-f-active" onChange={(v) => setChEditor({ ...chEditor, active: v })} /></Row>
              <Row label="Default Clearinghouse"><Toggle on={!!chEditor.isDefault} testid="set-ch-f-default" onChange={(v) => setChEditor({ ...chEditor, isDefault: v })} /></Row>
            </div>
            <div className="set-editor-foot">
              <button className="btn btn-sm" onClick={() => setChEditor(null)}>Cancel</button>
              <button className="btn btn-sm btn-primary" disabled={readOnly} data-testid="set-ch-save" onClick={() => saveCh(chEditor)}>{chEditor.id ? 'Save clearinghouse' : 'Add clearinghouse'}</button>
            </div>
          </div>
        )}
      </Section>
    ),

    billing: (
        <Section key="sys-block-billing" title="Billing defaults" sub="ERA automation, AR Manager behaviour, and authorization/filing controls" testId="set-sys-billing">
          <Banner tone="info" testid="set-bill-stub-note">
            “Enable ERA” is live — it gates 835 import in the Payment Center. The AR Manager and auto-transfer switches are saved with the workspace but not yet enforced in this build.
          </Banner>
          <div className="set-grid2">
          <Row label="Enable ERA (835 Electronic Remittance)" hint="Gates 835 ERA import in the Payment Center">
            <Toggle on={sysCfg.billing?.enableEra !== false} disabled={readOnly} testid="set-bill-era" onChange={(v) => patchSysCfg('billing', { enableEra: v })} />
          </Row>
          <Row label="AR Manager - Load Records on Generate" hint="Saved but not enforced in this build — the AR ledger always loads its records">
            <Toggle on={sysCfg.billing?.arLoadOnGenerate !== false} disabled={readOnly} testid="set-bill-arload" onChange={(v) => patchSysCfg('billing', { arLoadOnGenerate: v })} />
          </Row>
          <Row label="Auto Transfer to Secondary" hint="Saved but not enforced in this build — secondary claims are queued from the Secondary desk">
            <Toggle on={sysCfg.billing?.autoTransferSecondary !== false} disabled={readOnly} testid="set-bill-autosec" onChange={(v) => patchSysCfg('billing', { autoTransferSecondary: v })} />
          </Row>
          <Row label="New ERA Preview" hint="Saved but not enforced in this build — every 835 import shows the same line review">
            <Toggle on={sysCfg.billing?.newEraPreview !== false} disabled={readOnly} testid="set-bill-erapreview" onChange={(v) => patchSysCfg('billing', { newEraPreview: v })} />
          </Row>
          <Row label="Strict authorization (block billing without auth)">
            <Toggle on={!!settings.billing?.strictAuth} disabled={readOnly} testid="set-bill-strictAuth" onChange={(v) => patch({ billing: { ...settings.billing, strictAuth: v } })} />
          </Row>
          <Row label="Supervision check (require supervisor for RBT)">
            <Toggle on={settings.billing?.supervisionCheck !== false} disabled={readOnly} testid="set-bill-supervision" onChange={(v) => patch({ billing: { ...settings.billing, supervisionCheck: v } })} />
          </Row>
          <Row label="Invoice sequence"><NumberField value={settings.billing?.invoiceSeq ?? 1} min={1} max={100000} testid="set-bill-seq" disabled={readOnly} onCommit={(v) => patch({ billing: { ...settings.billing, invoiceSeq: v } })} /></Row>
          <Row label="Default filing deadline"><NumberField value={settings.billing?.defaultFilingDays ?? 90} min={0} max={365} suffix="days" testid="set-bill-filing" disabled={readOnly} onCommit={(v) => patch({ billing: { ...settings.billing, defaultFilingDays: v } })} /></Row>
        </div>
        <ReasonLists settings={settings} actions={actions} toast={toast} readOnly={readOnly} />
      </Section>
    ),

    appointment: (
      <React.Fragment key="sys-block-appointments">
        <Section title="Appointment Settings" sub="Clock-in/out automation, signature completion triggers, and verification time sync" testId="set-sys-appointments">
          <Banner tone="info" testid="set-appt-stub-note">
            There is no EVV clock-in/out flow in this build — the clock and time-sync switches are saved with the workspace but not enforced. The signature-completion switch is live: Quick Verify completes a session when it is on.
          </Banner>
          <div className="set-grid2">
            <Row label="Enable Clock In & Out" hint="Saved but not enforced in this build — no EVV clock-in/out flow exists yet">
              <Toggle on={sysCfg.appointment?.enableClockInOut !== false} disabled={readOnly} testid="set-appt-clockinout" onChange={(v) => patchSysCfg('appointment', { enableClockInOut: v })} />
            </Row>
            <Row label="Clock Out completes Appointment" hint="Saved but not enforced in this build — no EVV clock-in/out flow exists yet">
              <Toggle on={!!sysCfg.appointment?.clockOutCompletesAppt} disabled={readOnly} testid="set-appt-clockcomplete" onChange={(v) => patchSysCfg('appointment', { clockOutCompletesAppt: v })} />
            </Row>
            <Row label="Staff Signature Completes Appointment" hint="Automatically transitions session status to Completed when signed & verified">
              <Toggle on={sysCfg.appointment?.staffSigCompletesAppt !== false} disabled={readOnly} testid="set-appt-sigcomplete" onChange={(v) => patchSysCfg('appointment', { staffSigCompletesAppt: v })} />
            </Row>
            <Row label="Sync Verification Time to Appointment Time" hint="Saved but not enforced in this build — verified times never rewrite the schedule here">
              <Toggle on={!!sysCfg.appointment?.syncVerificationTime} disabled={readOnly} testid="set-appt-synctime" onChange={(v) => patchSysCfg('appointment', { syncVerificationTime: v })} />
            </Row>
          </div>
        </Section>

        <Section
          title="ABA Hours (behavior-analytic time)"
          sub="How non-service time marked ⚡ ABA Hours is tallied — it never touches client authorizations"
          testId="set-sys-aba"
        >
          <Banner tone="info" testid="set-aba-banner">
            ⚡ ABA Hours is offered on <b>non-service</b> appointments only. Ticking it includes the block as behavior-analytic time when tracking RBT / BCAT, graduate-student and state-certification hours — group trainings on behavior-analytic principles outside client sessions, or graduate students designing and reviewing interventions in non-billable time. Cleaning the clinic and general admin such as stimulus preparation never count. Service appointments draw on the client&rsquo;s authorization by type instead.
          </Banner>
          <div className="set-grid2">
            <Row label="Require an activity" hint="The booking dialog asks which behavior-analytic activity the block is before ⚡ ABA Hours can be saved">
              <Toggle on={abaCfg.requireActivity !== false} disabled={readOnly} testid="set-aba-require" onChange={(v) => patchAba({ requireActivity: v })} />
            </Row>
            <Row label="Show ⚡ badge on the calendar" hint="Badges behavior-analytic blocks on the time grid, agenda and detail card">
              <Toggle on={abaCfg.showOnCalendar !== false} disabled={readOnly} testid="set-aba-badge" onChange={(v) => patchAba({ showOnCalendar: v })} />
            </Row>
          </div>
          <div className="set-subcard" style={{ marginTop: 12 }}>
            <b style={{ display: 'block', marginBottom: 4 }}>Target hours per credential track</b>
            <span className="muted" style={{ display: 'block', marginBottom: 8, fontSize: 11.5 }}>
              Your practice&rsquo;s numbers, not a board&rsquo;s rule — enter the requirement you track against (0 logs the hours without a target). Workspace to date: <b>⚡ {abaTotals(state).hours}h</b> across {abaTotals(state).staff} team members.
            </span>
            <div className="set-grid2">
              {ABA_TRACKS.map((t) => (
                <Row key={t.id} label={t.label} hint={t.basis}>
                  <NumberField
                    value={Number(abaCfg.targets?.[t.id]) || 0}
                    min={0} max={5000} suffix="h"
                    testid={`set-aba-target-${t.id}`}
                    disabled={readOnly}
                    onCommit={(v) => patchAba({ targets: { ...(abaCfg.targets || {}), [t.id]: Math.max(0, Number(v) || 0) } })}
                  />
                </Row>
              ))}
            </div>
          </div>
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

        <Section title="Authorization guard" sub="What the calendar does when a booking spends past the hours on file" testId="set-sys-authguard">
          <div className="set-grid2">
            <Row label="Guard strength" hint="A booking that would spend past the authorization is flagged, warned about, or refused. Off disables the check on the calendar; claim staging still validates authorization independently.">
              <div className="viewseg" data-testid="set-auth-mode">
                {AUTH_MODES.map((m) => (
                  <button key={m.id} className={ag.mode === m.id ? 'on' : ''} disabled={readOnly} title={m.hint} onClick={() => patchGuard({ mode: m.id })}>
                    {m.label}
                  </button>
                ))}
              </div>
            </Row>
            <Row label="Warn at % of the authorization committed" hint="Industry guidance starts the renewal packet once roughly 75–85% of the authorized units are consumed">
              <NumberField value={ag.warnAtPct} min={50} max={100} suffix="%" testid="set-auth-warn" disabled={readOnly} onCommit={(v) => patchGuard({ warnAtPct: v })} />
            </Row>
            <Row label="Stop at % committed (Stop mode only)" hint="Above this share of the window, a new booking is refused while the guard is in Stop mode">
              <NumberField value={ag.blockAtPct} min={90} max={150} suffix="%" testid="set-auth-block" disabled={readOnly} onCommit={(v) => patchGuard({ blockAtPct: v })} />
            </Row>
            <Row label="Renewal alert, days before expiry" hint="Sessions after the expiry date are not payable as scheduled">
              <NumberField value={ag.expiryWarnDays} min={7} max={120} suffix="d" testid="set-auth-expiry" disabled={readOnly} onCommit={(v) => patchGuard({ expiryWarnDays: v })} />
            </Row>
            <Row label="Urgent renewal alert" hint="Escalates the expiry notice to a warning inside the booking dialog">
              <NumberField value={ag.expiryUrgentDays} min={1} max={60} suffix="d" testid="set-auth-urgent" disabled={readOnly} onCommit={(v) => patchGuard({ expiryUrgentDays: v })} />
            </Row>
            <Row label="Under-pace advisory threshold" hint="Booked hours per week below this share of the authorized week are reported as an opportunity — never as an error. Chronic under-delivery is used to justify a smaller renewal.">
              <NumberField value={ag.underPacePct} min={0} max={100} suffix="%" testid="set-auth-pace" disabled={readOnly} onCommit={(v) => patchGuard({ underPacePct: v })} />
            </Row>
            <div />
          </div>
          <div className="set-note" data-testid="set-auth-note">
            {Icon.shield({ size: 13 })} The guard reads the authorization already on file for the client (weekly hours × the window) and the sessions dated inside it. It never contacts a payer and never
            changes a claim: claim staging keeps its own authorization checks.
            <button className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }} disabled={readOnly} data-testid="set-auth-reset" onClick={() => patchGuard(AUTH_GUARD_DEFAULTS)}>
              {Icon.undo({ size: 12 })} Reset guard
            </button>
          </div>
        </Section>
      </React.Fragment>
    ),

    validations: (
      <Section
        key="sys-block-validations"
        title="Appointment Validations"
        sub="Configure rule enforcement (None, Flag, Warn, Stop) when scheduling or editing appointments"
        testId="set-sys-validations"
      >
        <Banner tone="info" testid="set-val-banner">
          <b>Stop</b> blocks saving the appointment; <b>Warn</b> requires acknowledgement in the booking modal; <b>Flag</b> badges the session; <b>None</b> disables the check. Higher credentials configured under <b>Settings → Qualification</b> (e.g., BCBA covering RBT) automatically satisfy lower-tier credential requirements.
        </Banner>
        <div className="set-subcard" style={{ marginBottom: 12 }}>
          <b style={{ display: 'block', marginBottom: 8 }}>Staff Validations</b>
          <div className="set-grid2">
            <ValidationRuleRow group="staff" ruleKey="qualification" label="Qualification" hint="Staff holds required credential (or a covering higher credential) for the service" />
            <ValidationRuleRow group="staff" ruleKey="serviceProvider" label="Service Provider" hint="Clinical appointments must have at least one assigned rendering provider" />
            <ValidationRuleRow group="staff" ruleKey="overlap" label="Overlap" hint="Staff member is double-booked on another appointment in the same window" />
            <ValidationRuleRow group="staff" ruleKey="missingNpi" label="Missing NPI / Medicaid ID" hint="Staff member has a 10-digit NPI or Medicaid ID on file" />
            <ValidationRuleRow group="staff" ruleKey="payRate" label="Pay Rate" hint="Staff member has an hourly pay rate or payroll profile configured" />
            <ValidationRuleRow group="staff" ruleKey="unavailable" label="Unavailable" hint="Staff member has an overlapping Unavailable / PTO block" />
            <ValidationRuleRow group="staff" ruleKey="travel" label="Travel Feasibility" hint="Estimated travel between same-day appointments (straight-line distance × 1.3; not a map route)" />
          </div>
        </div>
        <div className="set-subcard" style={{ marginBottom: 12 }}>
          <b style={{ display: 'block', marginBottom: 8 }}>Client Validations</b>
          <div className="set-grid2">
            <ValidationRuleRow group="client" ruleKey="overlap" label="Overlap" hint="Client is booked on another appointment in the same window" />
            <ValidationRuleRow group="client" ruleKey="assignment" label="Client Assignment" hint="Assigned staff member belongs to the client's care team" />
            <ValidationRuleRow group="client" ruleKey="duplicateOverlap" label="Duplicate Overlap" hint="Identical client, service, and time window already exists" />
          </div>
        </div>
        <div className="set-subcard" style={{ marginBottom: 12 }}>
          <b style={{ display: 'block', marginBottom: 8 }}>Payer Validations</b>
          <div className="set-grid2">
            <ValidationRuleRow group="payer" ruleKey="cancelledNoShow" label="Cancelled / No-Show Appointments" hint="Alerts when a cancelled/no-show status is marked billable" />
            <ValidationRuleRow group="payer" ruleKey="regionalCenter" label="Regional Center" hint="Verifies active authorization window for Regional Center / Medicaid payers" />
          </div>
        </div>
        <div className="set-subcard" data-testid="set-val-aba">
          <b style={{ display: 'block', marginBottom: 8 }}>ABA Hours (behavior-analytic time) Validations</b>
          <div className="set-grid2">
            <ValidationRuleRow group="aba" ruleKey="serviceAppt" label="ABA Hours on a Service Appointment" hint="⚡ ABA Hours belongs to non-service appointments — service time draws on the client's authorization" />
            <ValidationRuleRow group="aba" ruleKey="activity" label="Activity Not Behavior-Analytic" hint="Blocks marked as cleaning the clinic or general admin (e.g. stimulus preparation) cannot count" />
            <ValidationRuleRow group="aba" ruleKey="missingActivity" label="Missing Behavior-Analytic Activity" hint="⚡ ABA Hours is ticked without saying which activity the time belongs to" />
            <ValidationRuleRow group="aba" ruleKey="noStaff" label="ABA Hours Without Staff" hint="Nobody is on the block, so the hours cannot be credited to a technician or student" />
            <ValidationRuleRow group="aba" ruleKey="clientAttached" label="Client Attached to ABA Hours" hint="Behavior-analytic time is staff time spent outside client sessions" />
          </div>
        </div>
      </Section>
    ),

    notifications: (
      <Section key="sys-block-notifications" title="Notifications" sub="Inbox alerts — every switch below turns a real alert on or off" testId="set-sys-notify">
        <div className="set-subcard" style={{ marginBottom: 12 }}>
          <b style={{ display: 'block', marginBottom: 8 }}>Staff Notifications</b>
          <div className="set-grid2">
            <Row label="Task reminders" hint="Overdue and due-today tasks in the inbox">
              <Toggle on={notify.staffTasks !== false} disabled={readOnly} testid="set-notify-tasks" onChange={(v) => setNotify({ staffTasks: v })} />
            </Row>
            <Row label="Qualification Expiration" hint="Credential documents expiring in the Cabinet">
              <div className="set-inline">
                <Toggle on={notify.staffQualExpiration !== false} disabled={readOnly} testid="set-notify-qualexp" onChange={(v) => setNotify({ staffQualExpiration: v })} />
                <Select value={`${notify.staffQualFrequencyDays ?? 30}d`} wide={140} disabled={readOnly || notify.staffQualExpiration === false} testid="set-notify-qualexp-freq"
                  options={[{ value: '7d', label: '7 days prior' }, { value: '14d', label: '14 days prior' }, { value: '30d', label: '30 days prior' }, { value: '60d', label: '60 days prior' }]}
                  onChange={(v) => setNotify({ staffQualFrequencyDays: parseInt(String(v).replace(/[^\d]/g, ''), 10) || 30 })} />
              </div>
            </Row>
            <Row label="Incomplete Appointments" hint="Past sessions still awaiting a completion status">
              <div className="set-inline">
                <Toggle on={notify.staffIncompleteAppts !== false} disabled={readOnly} testid="set-notify-incomplete" onChange={(v) => setNotify({ staffIncompleteAppts: v })} />
                <NumberField value={notify.staffIncompleteLookbackDays ?? 7} min={1} max={90} suffix="days" disabled={readOnly || notify.staffIncompleteAppts === false} testid="set-notify-incomplete-days" onCommit={(v) => setNotify({ staffIncompleteLookbackDays: v })} />
              </div>
            </Row>
          </div>
        </div>
        <div className="set-grid2">
          <Row label="Timely filing deadlines" hint="Claims whose filing window has closed">
            <Toggle on={notify.timelyFiling !== false} disabled={readOnly} testid="set-sys-filing" onChange={(v) => setNotify({ timelyFiling: v })} />
          </Row>
          <Row label="Authorisation expiries"><Toggle on={notify.authExpiry !== false} disabled={readOnly} testid="set-sys-auth" onChange={(v) => setNotify({ authExpiry: v })} /></Row>
          <Row label="Parked ERA payments" hint="Unapplied payments waiting to be matched">
            <Toggle on={notify.parkedEra !== false} disabled={readOnly} testid="set-sys-era" onChange={(v) => setNotify({ parkedEra: v })} />
          </Row>
          <Row label="Secondary claims ready" hint="Primary claims with a balance ready for secondary filing">
            <Toggle on={notify.secondaryReady !== false} disabled={readOnly} testid="set-sys-secondary" onChange={(v) => setNotify({ secondaryReady: v })} />
          </Row>
          <Row label="Intake SLA breaches"><Toggle on={notify.intakeSla !== false} disabled={readOnly} testid="set-sys-sla" onChange={(v) => setNotify({ intakeSla: v })} /></Row>
          <Row label="Denied claims" hint="Denied claims to work in the billing desk">
            <Toggle on={notify.deniedClaims !== false} disabled={readOnly} testid="set-notify-denied" onChange={(v) => setNotify({ deniedClaims: v })} />
          </Row>
          <Row label="Browser toasts while the tab is open" hint="Surfaces urgent (stop-tone) inbox alerts as a toast once per session">
            <Toggle on={!!notify.browserToasts} disabled={readOnly} testid="set-sys-toasts" onChange={(v) => setNotify({ browserToasts: v })} />
          </Row>
        </div>
        <Banner tone="info">Notification preferences only change what the local workspace highlights. This demo never sends mail, SMS or push messages.</Banner>
      </Section>
    ),

    'clinical-integrations': (
      <Section key="sys-block-clinical" title="Clinical Integrations" sub="Clinical platforms and data seams (Ensora, Hi Rasmus, Motivity, Welina, EMR/FHIR hand-off)" testId="set-sys-clinical-integrations">
        <DataTable
          testid="set-sys-clinical-table"
          empty="No clinical integrations configured."
          columns={[
            { key: 'name', label: 'Partner Platform', width: '1.3fr' },
            { key: 'vendor', label: 'Vendor', width: '1fr' },
            { key: 'sync', label: 'Auto-Sync Notes', width: '0.8fr' },
            { key: 'status', label: 'Connection Mode', width: '1.2fr' },
          ]}
          rows={clinicalRows}
          renderRow={(r) => (
            <div className="set-trow" key={r.id} data-testid={`set-sys-clin-${r.id}`} style={{ gridTemplateColumns: '1.3fr 1fr 0.8fr 1.2fr' }}>
              <span><b>{r.name}</b><i className="set-sub">{r.detail}</i></span>
              <span className="muted">{r.vendor}</span>
              <span><Toggle on={!!r.syncEnabled} disabled={readOnly} testid={`set-sys-clin-sync-${r.id}`} onChange={(v) => patchIntegration(r.id, { syncEnabled: v })} /></span>
              <span>
                <Select
                  value={r.status}
                  wide={175}
                  disabled={readOnly}
                  testid={`set-sys-clin-status-${r.id}`}
                  options={Object.entries(INTEGRATION_STATUSES).map(([id, v]) => ({ value: id, label: v.label }))}
                  onChange={(v) => patchIntegration(r.id, { status: v })}
                />
              </span>
            </div>
          )}
        />
      </Section>
    ),

    evv: (
      <Section key="sys-block-evv" title="EVV Integrations" sub="Electronic Visit Verification (Sandata & state Medicaid aggregators)" testId="set-sys-evv">
        <div className="set-grid2">
          <Row label="Enable Sandata EVV"><Toggle on={!!evv.sandataEnabled} disabled={readOnly} testid="set-evv-enabled" onChange={(v) => patchEvv({ sandataEnabled: v })} /></Row>
          <Row label="Auto-Sync Completed Home Visits"><Toggle on={evv.autoSyncCompletedVisits !== false} disabled={readOnly} testid="set-evv-autosync" onChange={(v) => patchEvv({ autoSyncCompletedVisits: v })} /></Row>
          <Row label="Sandata Provider ID"><TextField value={evv.providerId || ''} wide={180} disabled={readOnly} testid="set-evv-providerid" onCommit={(v) => patchEvv({ providerId: v })} /></Row>
          <Row label="Company / Account ID"><TextField value={evv.companyId || ''} wide={180} disabled={readOnly} testid="set-evv-companyid" onCommit={(v) => patchEvv({ companyId: v })} /></Row>
          <Row label="Aggregator Username"><TextField value={evv.username || ''} wide={200} disabled={readOnly} testid="set-evv-username" onCommit={(v) => patchEvv({ username: v })} /></Row>
          <Row label="State Medicaid Program"><TextField value={evv.stateProgram || 'CA-DHCS'} wide={140} disabled={readOnly} testid="set-evv-state" onCommit={(v) => patchEvv({ stateProgram: v })} /></Row>
          <Row label="GPS Geofence Tolerance"><NumberField value={evv.gpsToleranceFeet ?? 500} min={50} max={5280} step={50} suffix="ft" disabled={readOnly} testid="set-evv-gps" onCommit={(v) => patchEvv({ gpsToleranceFeet: v })} /></Row>
        </div>
      </Section>
    ),

    other: (
      <React.Fragment key="sys-block-other">
        <Section title="Other Settings" sub="Distance units, Client Portal visible balance columns, and accepted payment gateway methods" testId="set-sys-other">
          <Banner tone="info" testid="set-other-stub-note">
            No payment gateway and no client portal ship in this build — the selections below are saved with the workspace for when they do. Distance is always shown in miles here.
          </Banner>
          <div className="set-grid2">
            <Row label="Distance Unit" hint="Saved with the workspace; distances show in miles throughout this build">
              <Seg
                value={sysCfg.other?.distanceUnit || 'miles'}
                disabled={readOnly}
                testid="set-other-distance"
                ariaLabel="Distance unit"
                options={[{ value: 'miles', label: 'Miles' }, { value: 'km', label: 'Kilometers' }]}
                onChange={(v) => patchSysCfg('other', { distanceUnit: v })}
              />
            </Row>
            <Row label="Payment Gateway Methods" stack>
              <div className="set-inline" style={{ flexWrap: 'wrap', gap: 6 }}>
                {[
                  ['creditCard', 'Credit / Debit Card'],
                  ['ach', 'ACH Bank Transfer'],
                  ['hsaFsa', 'HSA / FSA'],
                  ['appleGooglePay', 'Apple & Google Pay'],
                ].map(([id, label]) => {
                  const methods = sysCfg.other?.paymentGatewayMethods || {}
                  const on = methods[id] !== false
                  return (
                    <button
                      key={id}
                      type="button"
                      className={`checkbox ${on ? 'on' : ''}`}
                      disabled={readOnly}
                      data-testid={`set-other-pay-${id}`}
                      onClick={() => patchSysCfg('other', { paymentGatewayMethods: { ...methods, [id]: !on } })}
                    >
                      {label}
                    </button>
                  )
                })}
              </div>
            </Row>
            <Row label="Client Portal — Current Balance Columns" stack>
              <div className="set-inline" style={{ flexWrap: 'wrap', gap: 6 }}>
                {[['totalCharges', 'Total Charges'], ['insurancePaid', 'Insurance Paid'], ['patientResponsibility', 'Patient Responsibility'], ['currentBalance', 'Current Balance']].map(([id, label]) => {
                  const cols = sysCfg.other?.clientPortalColumns || {}
                  const on = cols[id] !== false
                  return (
                    <button
                      key={id}
                      type="button"
                      className={`checkbox ${on ? 'on' : ''}`}
                      disabled={readOnly}
                      data-testid={`set-other-col-${id}`}
                      onClick={() => patchSysCfg('other', { clientPortalColumns: { ...cols, [id]: !on } })}
                    >
                      {label}
                    </button>
                  )
                })}
              </div>
            </Row>
          </div>
        </Section>

        <Section title="Analytics defaults" sub="The range, metric and dimension the Analytics board opens with" testId="set-sys-an">
          <div className="set-grid2">
            <Row label="Default range"><Select value={settings.analytics?.range || '30d'} wide={150} disabled={readOnly} testid="set-an-range" options={RANGE_PRESETS.map((p) => ({ value: p.id, label: p.label }))} onChange={(v) => patch({ analytics: { ...settings.analytics, range: v } })} /></Row>
            <Row label="Metric"><Select value={settings.analytics?.metric || 'sessions'} wide={170} disabled={readOnly} testid="set-an-metric" options={Object.entries(METRICS).map(([id, m]) => ({ value: id, label: m.label }))} onChange={(v) => patch({ analytics: { ...settings.analytics, metric: v } })} /></Row>
            <Row label="Dimension"><Select value={settings.analytics?.dim || 'staff'} wide={170} disabled={readOnly} testid="set-an-dim" options={Object.entries(DIMS).map(([id, d]) => ({ value: id, label: d.label }))} onChange={(v) => patch({ analytics: { ...settings.analytics, dim: v } })} /></Row>
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
      </React.Fragment>
    ),
  }

  const orderedKeys = [
    activeSub,
    ...SYSTEM_SETTINGS_SECTIONS.map((s) => s.id).filter((id) => id !== activeSub),
  ]

  return (
    <>
      <div className="set-subnav" data-testid="set-sys-subnav" style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 4 }}>
        {SYSTEM_SETTINGS_SECTIONS.map((sec) => (
          <button
            key={sec.id}
            type="button"
            className={`set-pill ${activeSub === sec.id ? 'on' : ''}`}
            style={{ cursor: 'pointer', border: '1px solid var(--border)' }}
            data-testid={`set-sys-tab-${sec.id}`}
            onClick={() => actions.setUI({ settingsModule: 'system', settingsSub: sec.id })}
          >
            {sec.label}
          </button>
        ))}
      </div>
      {orderedKeys.map((k) => sectionBlocks[k] || null)}
    </>
  )
}

/**
 * Denial reasons (offered when a claim is marked denied) and remittance code hints (what an
 * ERA adjustment code means and what to do). Edited as a draft, saved in one settings op.
 */
function ReasonLists({ settings, actions, toast, readOnly }) {
  const [draft, setDraft] = useState(() => ({ denialReasons: denialReasonsOf({ settings }).map((r) => ({ ...r })), carcHints: carcHintsOf({ settings }).map((h) => ({ ...h })) }))
  const upd = (list, i, k, v) => setDraft((d) => ({ ...d, [list]: d[list].map((r, j) => (j === i ? { ...r, [k]: v } : r)) }))
  const del = (list, i) => setDraft((d) => ({ ...d, [list]: d[list].filter((_, j) => j !== i) }))
  const add = (list, row) => setDraft((d) => ({ ...d, [list]: [...d[list], row] }))
  const save = () => {
    const res = actions.settingsOp('billing.reasons', draft)
    toast({ message: res.msg, kind: res.ok ? 'ok' : 'error' })
  }
  const input = (list, i, k, label, width) => (
    <input className="input" aria-label={label} placeholder={label} disabled={readOnly} data-testid={`set-${list === 'denialReasons' ? 'den' : 'carc'}-${k}-${i}`} value={draft[list][i][k] || ''} onChange={(e) => upd(list, i, k, e.target.value)} style={width ? { width } : undefined} />
  )
  return (
    <div data-testid="set-bill-reasons" style={{ marginTop: 14 }}>
      <Row label="Denial reasons" hint="Offered when a claim is marked denied, each with the next step" stack>
        <div className="set-table">
          {draft.denialReasons.map((r, i) => (
            <div className="set-trow" key={i} style={{ gridTemplateColumns: '1.2fr 1.4fr 32px' }}>
              {input('denialReasons', i, 'label', 'Reason')}
              {input('denialReasons', i, 'fix', 'Next step')}
              <IconButton icon="trash" title="Remove reason" disabled={readOnly} testid={`set-den-del-${i}`} onClick={() => del('denialReasons', i)} />
            </div>
          ))}
        </div>
        <button type="button" className="btn btn-sm" disabled={readOnly} data-testid="set-den-add" onClick={() => add('denialReasons', { label: '', fix: '' })}>{Icon.plus({ size: 12 })} Add reason</button>
      </Row>
      <Row label="Remittance code hints" hint="What an ERA adjustment code (group-reason, e.g. CO-197) means and what to do about it" stack>
        <div className="set-table">
          {draft.carcHints.map((h, i) => (
            <div className="set-trow" key={i} style={{ gridTemplateColumns: '90px 1.2fr 1.4fr 32px' }}>
              {input('carcHints', i, 'code', 'Code')}
              {input('carcHints', i, 'label', 'Meaning')}
              {input('carcHints', i, 'fix', 'Next step')}
              <IconButton icon="trash" title="Remove hint" disabled={readOnly} testid={`set-carc-del-${i}`} onClick={() => del('carcHints', i)} />
            </div>
          ))}
        </div>
        <button type="button" className="btn btn-sm" disabled={readOnly} data-testid="set-carc-add" onClick={() => add('carcHints', { code: '', label: '', fix: '' })}>{Icon.plus({ size: 12 })} Add code</button>
      </Row>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
        <button type="button" className="btn btn-sm btn-primary" disabled={readOnly} data-testid="set-bill-reasons-save" onClick={save}>Save reasons and hints</button>
      </div>
    </div>
  )
}

export default SystemPanel
