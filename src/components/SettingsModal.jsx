import React from 'react'
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
 * Settings renders the selected configuration panel. NavRail owns the module
 * and sub-tab navigation so the settings hierarchy appears only in the sidebar.
 * Every write goes through `actions.settingsOp`, which validates on the live
 * workspace and applies the change + its cascades as one Undoable transaction.
 */
export default function SettingsModal({ onClose, forcedModule = null, forcedSub = null }) {
  const state = useStore()
  const { ui, actions } = state
  const toast = useToast()

  const canManageWorkspace = state.canAccessAllOffices && SECURITY_AREAS.every(({ id }) => state.canAccess(id, 'full'))
  const canManageDemo = state.canAccessAllOffices && DEMO_RESET_AREAS.every((area) => state.canAccess(area, 'full'))
  const canRebuildTitles = state.canAccessAllOffices && state.canAccess('settings', 'full') && state.canAccess('calendar', 'full')
  const readOnly = state.accessLevel('settings') !== 'full'

  const wanted = forcedModule || ui.settingsModule
  const defaultMod = state.canAccess('settings', 'view') ? 'organization' : 'security'
  const active = settingsModule(SETTINGS_MODULES.some((m) => m.id === wanted) ? wanted : defaultMod)
  // Security's sub-tabs are the module's own tab pair; keep ui.securityTab in step so
  // the embedded SecurityView and the sidebar never disagree.
  const wanted0 = forcedSub ?? ui.settingsSub ?? (active.id === 'security' ? ui.securityTab || 'accounts' : active.tabs?.[0]?.id ?? null)
  // a stale sub-tab from another module (or an old save) can never blank a panel
  const sub = active.tabs?.length ? (active.tabs.some((t) => t.id === wanted0) ? wanted0 : active.tabs[0].id) : null
  if (active.id === 'security' && (ui.securityTab || 'accounts') !== (sub === 'roles' ? 'roles' : 'accounts')) {
    // Radically simpler than an effect: one deferred write keeps the two in sync.
    queueMicrotask(() => actions.setUI({ securityTab: sub === 'roles' ? 'roles' : 'accounts' }))
  }

  let bytes = 0
  try { bytes = (localStorage.getItem('aloha-aba.v3') || '').length } catch { /* storage is unavailable; the stats show 1 KB */ }

  const handleClose = () => {
    if (onClose) onClose()
    else actions.setUI({ section: 'calendar', settings: false })
  }

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
    <div className="sectionpage set-page" data-testid="settings-page">
      <div className="set-workspace" role="dialog" aria-label="Settings" data-testid="settings-modal" style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
        <header className="secbar no-print" style={{ borderBottom: '1px solid var(--line)' }}>
          <span className="secbar-ic">{Icon.dots({ size: 17 })}</span>
          <div className="secbar-t">
            <h2>Settings · {active.label}</h2>
            <span>{active.blurb}</span>
          </div>
          <div className="secbar-actions" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {readOnly && <span className="set-readonly" data-testid="settings-readonly">View only. Settings cannot be changed.</span>}
            <span className="muted" style={{ fontSize: 11 }}>Saved to this browser automatically</span>
            <button className="btn btn-sm" onClick={handleClose} aria-label="Close Settings" data-testid="settings-close">
              {Icon.chevronL({ size: 13 })} Back to Calendar
            </button>
          </div>
        </header>
        <div className="set-shell" style={{ flex: 1, minHeight: 0 }}>
          <section className="set-main">
            <header className="set-head">
              <div>
                <h3 data-testid="settings-title">{active.label}</h3>
                <p>{active.blurb}</p>
              </div>
            </header>
            <div className="set-body" data-testid={`settings-panel-${active.id}`}>
              <div data-testid={`panel-${active.id}`}>
                {panel}
              </div>
            </div>
            <footer className="set-foot">
              <span>v36 · build {typeof __APP_BUILD__ !== 'undefined' ? __APP_BUILD__ : 'dev'} · {Math.max(1, Math.round(bytes / 1024))} KB local</span>
              <span className="muted">Demo data only. No PHI and no payer connection.</span>
            </footer>
          </section>
        </div>
      </div>
    </div>
  )
}
