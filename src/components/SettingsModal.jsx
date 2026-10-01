import React, { useMemo, useState } from 'react'
import { useStore } from '../state/store'
import { useToast } from '../ui/Toast'
import { Icon } from '../ui/Icons'
import { DEMO_RESET_AREAS, SECURITY_AREAS } from '../lib/security'
import { SETTINGS_MODULES, settingsModule } from '../lib/settingsMasters'
import { OrganizationPanel, AppointmentStatusPanel, CustomListsPanel, QualificationPanel } from './settings/panels-practice'
import { PayrollPanel } from './settings/PayrollPanel'
import { DataImportPanel } from './settings/DataImportPanel'
import { SystemPanel } from './settings/SystemPanel'
import { ServicesPanel, CustomFieldsPanel, SecurityPanel, IntegrationsPanel, MessagingPanel, SubscriptionPanel } from './settings/panels-extras'

/**
 * chunk-42 — Settings is now the practice configuration surface.
 *
 * One modal, a module nav on the left (the Aloha settings map: Organization,
 * Appointment Status, Custom Lists, Custom Fields, Services, Qualification,
 * Payroll, Security, Text Messaging, Clinical Integrations, Data Import, System,
 * Subscription) and the module's panel on the right. Every write goes through
 * `actions.settingsOp`, which validates on the live workspace and applies the
 * change + its cascades as one Undoable transaction.
 */
export default function SettingsModal({ onClose, forcedModule = null, forcedSub = null }) {
  const state = useStore()
  const { ui, actions } = state
  const toast = useToast()
  const [query, setQuery] = useState('')

  const canManageWorkspace = state.canAccessAllOffices && SECURITY_AREAS.every(({ id }) => state.canAccess(id, 'full'))
  const canManageDemo = state.canAccessAllOffices && DEMO_RESET_AREAS.every((area) => state.canAccess(area, 'full'))
  const canRebuildTitles = state.canAccessAllOffices && state.canAccess('settings', 'full') && state.canAccess('calendar', 'full')
  const readOnly = state.accessLevel('settings') !== 'full'

  const wanted = forcedModule || ui.settingsModule
  const active = settingsModule(SETTINGS_MODULES.some((m) => m.id === wanted) ? wanted : 'organization')
  // Security's sub-tabs are the module's own tab pair; keep ui.securityTab in step so
  // the embedded SecurityView and the sub-tab bar never disagree.
  const wanted0 = forcedSub ?? ui.settingsSub ?? (active.id === 'security' ? ui.securityTab || 'accounts' : active.tabs?.[0]?.id ?? null)
  // a stale sub-tab from another module (or an old save) can never blank a panel
  const sub = active.tabs ? (active.tabs.some((t) => t.id === wanted0) ? wanted0 : active.tabs[0].id) : null
  if (active.id === 'security' && (ui.securityTab || 'accounts') !== (sub === 'roles' ? 'roles' : 'accounts')) {
    // Radically simpler than an effect: one deferred write keeps the two in sync.
    queueMicrotask(() => actions.setUI({ securityTab: sub === 'roles' ? 'roles' : 'accounts' }))
  }

  let bytes = 0
  try { bytes = (localStorage.getItem('aloha-aba.v3') || '').length } catch { /* storage is unavailable; the stats show 1 KB */ }

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase()
    const hit = (m) => !q || `${m.label} ${m.blurb} ${m.group} ${(m.tabs || []).map((t) => t.label).join(' ')}`.toLowerCase().includes(q)
    const out = []
    for (const m of SETTINGS_MODULES) {
      if (!hit(m)) continue
      let g = out.find((x) => x.label === m.group)
      if (!g) { g = { label: m.group, modules: [] }; out.push(g) }
      g.modules.push(m)
    }
    return out
  }, [query])

  const open = (mod, nextSub) => actions.setUI({
    settingsModule: mod,
    settingsSub: nextSub === undefined ? null : nextSub,
    ...(mod === 'security' ? { securityTab: nextSub === 'roles' ? 'roles' : 'accounts' } : {}),
  })

  const panel = (() => {
    const props = { state, actions, toast, readOnly }
    switch (active.id) {
      case 'organization': return <OrganizationPanel {...props} />
      case 'appointment-status': return <AppointmentStatusPanel {...props} />
      case 'custom-lists': return <CustomListsPanel {...props} sub={sub} />
      case 'services': return <ServicesPanel {...props} />
      case 'custom-fields': return <CustomFieldsPanel {...props} />
      case 'qualification': return <QualificationPanel {...props} />
      case 'payroll': return <PayrollPanel {...props} sub={sub} />
      case 'security': return <SecurityPanel {...props} sub={sub} />
      case 'clinical-integrations': return <IntegrationsPanel {...props} />
      case 'text-messaging': return <MessagingPanel {...props} />
      case 'data-import': return <DataImportPanel {...props} />
      case 'system': return <SystemPanel {...props} canManageWorkspace={canManageWorkspace} canManageDemo={canManageDemo} canRebuildTitles={canRebuildTitles} bytes={bytes} />
      case 'subscription': return <SubscriptionPanel {...props} />
      default: return null
    }
  })()

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal set-modal set-modal-lg" role="dialog" aria-label="Settings" data-testid="settings-modal">
        <div className="modal-head">
          <h2>{Icon.dots({ size: 15 })} Settings</h2>
          <span className="spacer" />
          {readOnly && <span className="set-readonly" data-testid="settings-readonly">View only — settings changes are disabled</span>}
          <span className="muted" style={{ fontSize: 11 }}>saved to this browser automatically</span>
          <button className="modal-x" onClick={onClose} aria-label="Close Settings" data-testid="settings-close">{Icon.x({ size: 14 })}</button>
        </div>
        <div className="set-shell">
          <aside className="set-nav" role="tablist" aria-label="Settings modules" data-testid="settings-nav">
            <label className="set-navsearch">
              <span className="sr-only">Search settings</span>
              {Icon.search({ size: 13 })}
              <input className="input" value={query} placeholder="Search settings…" data-testid="set-search" onChange={(e) => setQuery(e.target.value)} />
            </label>
            {groups.map((g) => (
              <div key={g.label} className="set-navgroupwrap">
                <div className="set-navgroup">{g.label}</div>
                {g.modules.map((m) => (
                  <button key={m.id} role="tab" aria-selected={active.id === m.id} className={`set-navitem ${active.id === m.id ? 'on' : ''}`}
                    data-testid={`set-mod-${m.id}`} onClick={() => open(m.id, m.tabs?.[0]?.id ?? null)}>
                    <span className="set-navic">{Icon[m.icon]?.({ size: 14 }) || Icon.dots({ size: 14 })}</span>
                    <span>{m.label}</span>
                  </button>
                ))}
              </div>
            ))}
            {!groups.length && <div className="set-navempty">No settings module matches “{query}”.</div>}
          </aside>
          <section className="set-main">
            <header className="set-head">
              <div>
                <h3 data-testid="settings-title">{active.label}</h3>
                <p>{active.blurb}</p>
              </div>
              {active.tabs && (
                <div className="viewseg" role="group" aria-label={`${active.label} tabs`} data-testid="settings-subtabs">
                  {active.tabs.map((t) => (
                    <button key={t.id} className={sub === t.id ? 'on' : ''} data-testid={`set-sub-${t.id}`} onClick={() => open(active.id, t.id)}>{t.label}</button>
                  ))}
                </div>
              )}
            </header>
            <div className="set-body" data-testid={`settings-panel-${active.id}`}>
              {panel}
            </div>
            <footer className="set-foot">
              <span>v36 · build {typeof __APP_BUILD__ !== 'undefined' ? __APP_BUILD__ : 'dev'} · {Math.max(1, Math.round(bytes / 1024))} KB local</span>
              <span className="muted">Demo data only — no PHI, no payer connection.</span>
            </footer>
          </section>
        </div>
      </div>
    </div>
  )
}
