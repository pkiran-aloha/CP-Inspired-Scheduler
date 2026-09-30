import React, { useEffect, useMemo, useState } from 'react'
import { useStore } from '../state/store'
import { Icon } from '../ui/Icons'
import { useToast } from '../ui/Toast'
import { scanNeedsCover } from '../lib/smart'
import { intakeKpis } from '../lib/intake'
import { stagedAppts } from '../lib/claims'
import { RANGE_PRESETS } from '../lib/analytics'
import { useMedia } from '../lib/useMedia'
import { canAccessSection, resolveAccount } from '../lib/security'
import { addDays, isoDate, parseISO, todayISO } from '../lib/date'

const RANGE_PRESET_OPTS = RANGE_PRESETS
// (billing badge = completed billable lines with units that are not marked billed yet)

export const SECTIONS = [
  { id: 'calendar', label: 'Calendar', icon: 'cal', kbd: '1', desc: 'Scheduling board, timeline & agenda' },
  { id: 'clients', label: 'Clients', icon: 'pin', kbd: '2', desc: 'Caseloads, authorizations & programs', subs: [
    { id: 'roster', to: 'clients', label: 'Client List' },
    { id: 'client-new', to: 'clients', label: 'Add New', patch: { cliNew: true } },
    { group: 'Intake Manager' },
    { id: 'intake', to: 'intake', label: 'General Intake Requests' },
    { id: 'intake-new', to: 'intake-new', label: 'Client Intake' },
    { id: 'referrals', to: 'referrals', label: 'Referral Sources' },
  ] },
  { id: 'masters', label: 'Masters', icon: 'clipboard', kbd: '8', desc: 'Payers, service types & billing masters', subs: [{ id: 'payers', label: 'Payers' }, { id: 'svcs', label: 'Service Types' }, { id: 'cfdefs', label: 'Custom Fields' }] },
  { id: 'staff', label: 'Staff', icon: 'team', kbd: '3', desc: 'Roster, credentials & workload' },
  { id: 'billing', label: 'Billing', icon: 'dollar', kbd: '4', desc: 'Claim lifecycle — stage, submit, collect', subs: [{ id: 'desk', to: 'billing', label: 'Billing' }, { id: 'ar', to: 'bil-ar', label: 'AR Manager' }, { id: 'payments', to: 'bil-payments', label: 'Payment Center' }, { id: 'invoice', to: 'bil-invoice', label: 'Generate Invoice' }, { id: 'verify', to: 'bil-verify', label: 'Verification Forms' }, { id: 'qbo', to: 'bil-qbo', label: 'QuickBooks' }, { id: 'secondary', to: 'bil-secondary', label: 'Secondary Queue' }, { id: 'appeals', to: 'bil-appeals', label: 'Appeals' }, { id: 'files', to: 'bil-files', label: 'Billed Files' }, { id: 'providers', to: 'bil-providers', label: 'Provider Identifier' }] },
  { id: 'analytics', label: 'Analytics', icon: 'spark', kbd: '5', desc: 'Trends, utilization & outcomes' },
  { id: 'reports', label: 'Reports', icon: 'file', kbd: '6', desc: 'Exportable PMS reports & validations' },
  { id: 'payroll', label: 'Payroll', icon: 'badge', kbd: '9', desc: 'Timesheets, pay runs & provider export', subs: [
    { id: 'pay-cycle', to: 'payroll', label: 'Cycle Overview' },
    { id: 'pay-process', to: 'pay-process', label: 'Process Payroll' },
    { id: 'pay-runs', to: 'pay-runs', label: 'Pay Runs' },
    { id: 'pay-idmap', to: 'pay-idmap', label: 'Payroll ID Mapping' },
    { id: 'pay-summary', to: 'pay-summary', label: 'Payroll Summary' },
    { id: 'pay-timesheets', to: 'pay-timesheets', label: 'Timesheet Submission' },
    { id: 'pay-qbo', to: 'pay-qbo', label: 'QuickBooks Payroll' },
    { id: 'pay-setup', to: 'pay-setup', label: 'Payroll Setup' },
  ] },
  { id: 'dashboard', label: 'Dashboard', icon: 'dashboard', kbd: '7', desc: 'Widget analytics board — build your own' },
  { id: 'security', label: 'Security', icon: 'shield', kbd: 'S', desc: 'User accounts and role-based access', subs: [
    { id: 'security-accounts', to: 'security', label: 'User Accounts', patch: { securityTab: 'accounts' } },
    { id: 'security-roles', to: 'security', label: 'User Roles', patch: { securityTab: 'roles' } },
  ] },
]

/**
 * App-level navigation rail. Sections stay in sync through the shared
 * ui.anchor + filters, so drilling from a report lands on a live calendar view.
 */
export default function NavRail() {
  const state = useStore()
  const { ui, actions, appts } = state
  const toast = useToast()
  const [previewOpen, setPreviewOpen] = useState(false)
  const section = ui.section || 'calendar'
  // context-adaptive: the scheduling board gets the extra width, so the rail rests
  // as an icon strip there by default (tooltips carry the labels). Any explicit
  // collapse/expand click wins and persists across sections and reloads.
  const narrow = useMedia('(max-width: 1279px)')
  const collapsed = ui.nav ?? (section === 'calendar' || narrow)
  useEffect(() => setPreviewOpen(false), [state.currentAccount?.id])

  // live badges — coverage pressure on Calendar, work-in-the-desk on Billing
  const badges = useMemo(() => {
    const week = Array.from({ length: 7 }, (_, i) => isoDate(addDays(parseISO(todayISO()), i)))
    const cover = scanNeedsCover(state, week).length
    const staged = stagedAppts(state, null).length
    const denied = Object.values(state.claims || {}).filter((c) => c.status === 'denied').length
    // Intake badges: anything past its stage SLA or with no logged touch is a
    // family waiting on us — surface it on the rail, not just inside the module.
    const iq = intakeKpis(state.intakeRequests || {})
    return { calendar: cover, billing: staged + denied, billingHot: denied > 0, clients: iq.overdue.length + iq.stalled.filter((r) => !iq.overdue.includes(r)).length, clientsHot: iq.overdue.length > 0 }
  }, [appts, state.claims, state.clients, state.intakeRequests])

  return (
    <nav className={`navrail ${collapsed ? 'collapsed' : ''} no-print`} data-testid="navrail" aria-label="Sections">
      <div className="nr-brand" title="Aloha ABA · ABA Practice Suite">
        <span className="logo">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2 7.5c2.3-2.1 4.4-2.1 6.7 0s4.4 2.1 6.7 0 4.2-1.9 6.4-.2" />
            <path d="M2 12.5c2.3-2.1 4.4-2.1 6.7 0s4.4 2.1 6.7 0 4.2-1.9 6.4-.2" />
            <path d="M2 17.5c2.3-2.1 4.4-2.1 6.7 0s4.4 2.1 6.7 0" opacity=".45" />
          </svg>
        </span>
        {!collapsed && (
          <span className="nr-brandtxt">
            <b>Aloha ABA</b>
            <i>Practice Suite</i>
          </span>
        )}
      </div>

      <div className="nr-items">
        {SECTIONS.filter((s) => canAccessSection(state, s.id, 'view') || (s.subs || []).some((sub) => sub.to && canAccessSection(state, sub.to, 'view'))).map((s) => {
          const n = badges[s.id] || 0
          const canOpenParent = canAccessSection(state, s.id, 'view')
          const fallbackSub = (s.subs || []).find((sub) => sub.to && canAccessSection(state, sub.to, 'view'))
          const target = canOpenParent ? s.id : fallbackSub?.to
          const active = section === s.id || (s.subs || []).some((x) => x.to === section)
          return (
          <React.Fragment key={s.id}>
            <button
              className={`nr-item ${active ? 'on' : ''}`}
              data-testid={`nav-${s.id}`}
              onClick={() => target && actions.setUI({ section: target })}
              title={`${s.label}${collapsed ? ` — ${s.desc}` : ''}  (${s.kbd})`}
              aria-current={active ? 'page' : undefined}
            >
              <span className="nr-ic">
                {Icon[s.icon]({ size: 16 })}
                {n > 0 && <span className={`nr-badge ${s.id === 'calendar' || (s.id === 'billing' && badges.billingHot) ? 'hot' : ''}`} data-testid={`nav-badge-${s.id}`}>{n > 99 ? '99+' : n}</span>}
              </span>
              {!collapsed && <span className="nr-label">{s.label}</span>}
              {!collapsed && n > 0 && <span className="nr-count">{n}</span>}
            </button>
            {/* section sub-list (Masters → Payers / Service Types · Billing → desk / provider ids) */}
            {s.subs && active && !collapsed && (
              <div className="nr-sub" role="group" aria-label={`${s.label} lists`}>
                {s.subs.map((sub) => sub.group ? (
                  // a named sub-module inside the section (Clients → Intake Manager), matching
                  // how the practice talks about the work rather than how the routes are cut
                  <div className="nr-subgroup" key={sub.group} data-testid={`nav-group-${sub.group.toLowerCase().replace(/\s+/g, '-')}`}>{sub.group}</div>
                ) : sub.to && !canAccessSection(state, sub.to, 'view') ? null : (
                  <button
                    key={sub.id}
                    className={`nr-subitem ${sub.to ? sub.to === section && (!sub.patch?.securityTab || ui.securityTab === sub.patch.securityTab) ? 'on' : '' : (section === s.id && ui.mastersTab === sub.id) ? 'on' : ''}`}
                    data-testid={`nav-sub-${sub.id}`}
                    onClick={() => actions.setUI({ section: sub.to || s.id, mastersTab: sub.id, payerSel: null, ...(sub.patch || {}) })}
                  >
                    <span className="nr-subdot" />
                    {sub.label}
                  </button>
                ))}
              </div>
            )}
          </React.Fragment>
          )
        })}
      </div>

      <div className="nr-foot">
        <div className={`nr-preview ${previewOpen ? 'open' : ''}`} data-testid="nav-demo-preview">
          <button className="nr-item nr-preview-trigger" type="button" onClick={() => setPreviewOpen((open) => !open)} aria-expanded={previewOpen} aria-label={`Local demo account preview: ${state.currentAccount?.name || 'No active user'}`} title="Switch local demo account preview">
            <span className="nr-ic nr-preview-avatar">{String(state.currentAccount?.name || 'User').trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase()}</span>
            {!collapsed && <span className="nr-preview-label"><b>{state.currentAccount?.name || 'No active user'}</b><i>{state.currentRole?.name || 'No role'} · demo</i></span>}
          </button>
          {previewOpen && <div className="nr-preview-popover" role="group" aria-label="Local demo account switcher">
            <b>Local demo preview</b>
            <span>{state.currentRole?.name || 'No role'} · not a sign-in session</span>
            <select aria-label="Preview demo account from navigation" value={state.currentAccount?.id || ''} onChange={(event) => {
              const id = event.target.value
              const account = resolveAccount(state, state.security.accounts.find((item) => item.id === id))
              const result = actions.switchDemoAccount(id)
              if (result?.ok) toast({ message: `Previewing as ${account?.name || 'selected account'}`, kind: 'info' })
              else if (result?.msg) toast({ message: result.msg, kind: 'warn' })
            }} data-testid="nav-demo-account-switch">
              {state.security.accounts.filter((account) => account.status === 'active').map((stored) => {
                const account = resolveAccount(state, stored)
                const role = state.security.roles.find((item) => item.id === account.roleId)
                return <option key={account.id} value={account.id}>{account.name} · {role?.name || 'No role'}</option>
              })}
            </select>
          </div>}
        </div>
        {!collapsed && (
          <div className="nr-card">
            <b>{state.settings?.org?.name || 'Aloha ABA Center'}</b>
            <span>{state.clients.length} clients · {state.staff.length} staff</span>
            <span className="muted">{Object.keys(appts).length} appointments on file</span>
          </div>
        )}
        <button className="nr-item" onClick={() => actions.setSettings({ theme: state.settings.theme === 'dark' ? 'light' : 'dark' })} title="Toggle light / dark theme">
          <span className="nr-ic">{state.settings.theme === 'dark' ? Icon.sun({ size: 15 }) : Icon.moon({ size: 15 })}</span>
          {!collapsed && <span className="nr-label">Theme</span>}
        </button>
        {state.canAccess('settings', 'view') && <button className="nr-item" onClick={() => actions.setUI({ settings: true })} data-testid="nav-settings" title="Application settings">
          <span className="nr-ic">{Icon.dots({ size: 15 })}</span>
          {!collapsed && <span className="nr-label">Settings</span>}
        </button>}
        <div className="nr-build" data-testid="app-build" title={"Build running in this tab — if a newer one is deployed, you’ll be offered a refresh"}>
          {collapsed ? 'v36' : `v36 · build ${typeof __APP_BUILD__ !== 'undefined' ? __APP_BUILD__ : 'dev'}`}
        </div>
        <button className="nr-item" onClick={() => actions.setUI({ nav: !collapsed })} data-testid="nav-collapse" title={collapsed ? 'Expand navigation' : 'Collapse navigation'}>
          <span className="nr-ic">{collapsed ? Icon.chevronR({ size: 14 }) : Icon.chevronL({ size: 14 })}</span>
          {!collapsed && <span className="nr-label">Collapse</span>}
        </button>
      </div>
    </nav>
  )
}

/** Shared page header for non-calendar sections. */
export function SectionBar({ icon, title, sub, children }) {
  const state = useStore()
  const { actions } = state
  return (
    <header className="secbar no-print">
      <span className="secbar-ic">{Icon[icon]({ size: 17 })}</span>
      <div className="secbar-t">
        <h2>{title}</h2>
        {sub && <span>{sub}</span>}
      </div>
      <div className="secbar-actions">{children}</div>
    </header>
  )
}

/** Range chooser shared by Analytics / Reports / Billing — same slide mechanics everywhere. */
export function RangePicker({ preset, onPreset, onSlide, label, gran, onGran, extra }) {
  return (
    <div className="rangepicker" data-testid="range-picker">
      <div className="viewseg rp-seg" role="group" aria-label="Range preset">
        <button className="iconbtn" style={{ width: 24, height: 24 }} onClick={() => onSlide(-1)} aria-label="Slide range back">{Icon.chevronL({ size: 13 })}</button>
        <select className="input rp-sel" value={preset} onChange={(e) => onPreset(e.target.value)} aria-label="Preset range">
          {RANGE_PRESET_OPTS.map((p) => (
            <option key={p.id} value={p.id}>{p.label}</option>
          ))}
        </select>
        <button className="iconbtn" style={{ width: 24, height: 24 }} onClick={() => onSlide(1)} aria-label="Slide range forward">{Icon.chevronR({ size: 13 })}</button>
      </div>
      <span className="rp-label">{label}</span>
      {gran != null && (
        <div className="viewseg" role="group" aria-label="Aggregation">
          {['auto', 'day', 'week', 'month', 'quarter'].map((g) => (
            <button key={g} className={gran === g ? 'on' : ''} onClick={() => onGran(g)}>{g === 'auto' ? 'Auto' : g[0].toUpperCase() + g.slice(1)}</button>
          ))}
        </div>
      )}
      {extra}
    </div>
  )
}
