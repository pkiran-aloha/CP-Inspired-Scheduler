import React, { useEffect, useMemo, useState } from 'react'
import { StoreProvider, useStore } from './state/store'
import { ToastProvider, useToast } from './ui/Toast'
import TopBar from './components/TopBar'
import NavRail from './components/NavRail'
import Sidebar from './components/Sidebar'
import TimeGrid from './components/TimeGrid'
import TimelineView from './components/TimelineView'
import MonthView from './components/MonthView'
import AgendaView from './components/AgendaView'
import TypePicker from './components/TypePicker'
import AppointmentModal from './components/AppointmentModal'
import QuickAdd from './components/QuickAdd'
import DetailCard from './components/DetailCard'
import AnalyticsView from './components/AnalyticsView'
import ReportsView from './components/ReportsView'
import DashboardView from './components/DashboardView'
import ClientsView from './components/ClientsView'
import MastersView from './components/MastersView'
import StaffView from './components/StaffView'
import BillingView from './components/BillingView'
import BilledFilesView from './components/BilledFilesView'
import ArManagerView from './components/ArManagerView'
import GenerateInvoiceView from './components/GenerateInvoiceView'
import SecondaryBillingView from './components/SecondaryBillingView'
import VerificationFormsView from './components/VerificationFormsView'
import QuickBooksView from './components/QuickBooksView'
import PaymentCenterView from './components/PaymentCenterView'
import ProviderIdView from './components/ProviderIdView'
import NeedsCover from './components/NeedsCover'
import SettingsModal from './components/SettingsModal'
import CommandPalette from './components/CommandPalette'
import KeysHelp from './components/KeysHelp'
import { slidePreset } from './lib/analytics'
import { DAY_NAMES, addDays, addMonths, isoDate, parseISO, rangeLabel, startOfWeek, todayISO, weekNum } from './lib/date'
import { uid } from './lib/model'

export function rangeDays(view, anchor, weekStart) {
  const a = parseISO(anchor)
  if (view === 'day') return [isoDate(a)]
  if (view === 'week' || view === 'timeline' || view === 'analytics') return Array.from({ length: 7 }, (_, i) => isoDate(addDays(startOfWeek(a, weekStart), i)))
  if (view === 'agenda') {
    const s = startOfWeek(a, weekStart)
    return Array.from({ length: 14 }, (_, i) => isoDate(addDays(s, i)))
  }
  // month — 6-week grid starting at week start of the 1st
  const first = new Date(a.getFullYear(), a.getMonth(), 1)
  const s = startOfWeek(first, weekStart)
  return Array.from({ length: 42 }, (_, i) => isoDate(addDays(s, i)))
}

export function shift(view, anchor, dir, weekStart) {
  const a = parseISO(anchor)
  if (view === 'day') return isoDate(addDays(a, dir))
  if (view === 'month') return isoDate(addMonths(a, dir))
  if (view === 'agenda') return isoDate(addDays(a, dir * 14))
  return isoDate(addDays(startOfWeek(a, weekStart), dir * 7))
}

function Shell() {
  const state = useStore()
  const { ui, settings, actions } = state
  const toast = useToast()
  const [picking, setPicking] = useState(null) // {date,start,end}
  const [quickAdd, setQuickAdd] = useState(null) // {date,start,end} from grid drag
  const [modal, setModal] = useState(null) // {mode:'create'|'edit', appt}
  const [detailId, setDetailId] = useState(null)
  const [palette, setPalette] = useState(false)
  const [kbHelp, setKbHelp] = useState(false)

  const section = ui.section || 'calendar'
  const days = useMemo(() => rangeDays(ui.view, ui.anchor, settings.weekStart), [ui.view, ui.anchor, settings.weekStart])

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', settings.theme)
  }, [settings.theme])

  // older saves stored analytics as a calendar view — migrate it to the section
  useEffect(() => {
    if (ui.view === 'analytics') actions.setUI({ view: 'week', section: 'analytics' })
  }, [ui.view, actions])

  // chunk-38: announce the one-time cleanup of pre-loaded appointment custom fields
  useEffect(() => {
    const m = state.meta
    if (m?.pcfCleared && !m.pcfClearedSeen && (m.pcfClearedCount || 0) > 0) {
      toast({ message: `v13 cleanup — cleared ${m.pcfClearedCount} pre-loaded custom-field value${m.pcfClearedCount === 1 ? '' : 's'} from earlier appointments; new appointments start with none`, kind: 'info' })
      actions.setMeta({ pcfClearedSeen: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.meta?.pcfCleared, state.meta?.pcfClearedSeen])

  // chunk-39: announce the one-time removal of the old built-in custom fields
  useEffect(() => {
    const m = state.meta
    if (m?.legacyCustomCleared && !m.legacyCustomClearedSeen && (m.legacyCustomClearedCount || 0) > 0) {
      toast({ message: `v14 cleanup — removed pre-loaded legacy custom fields from ${m.legacyCustomClearedCount} appointment${m.legacyCustomClearedCount === 1 ? '' : 's'} (My Care, Yes or No, Grade, Re-eval Notes); they're now add-on-demand fields under “Add Custom Fields”`, kind: 'info' })
      actions.setMeta({ legacyCustomClearedSeen: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.meta?.legacyCustomCleared, state.meta?.legacyCustomClearedSeen])

  // chunk-40: announce the one-time billing v2 migration
  useEffect(() => {
    const m = state.meta
    if (m?.billingV2 && !m.billingV2Seen && (m.billingV2Count || 0) > 0) {
      toast({ message: `Billing v2 — payments & provider IDs now tracked on their own ledgers (${m.billingV2Count} records migrated)`, kind: 'info' })
      actions.setMeta({ billingV2Seen: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.meta?.billingV2, state.meta?.billingV2Seen])

  // ---- global keyboard shortcuts ----
  useEffect(() => {
    const onKey = (e) => {
      if (modal || picking || quickAdd) return
      const k = e.key.toLowerCase()
      if ((e.metaKey || e.ctrlKey) && k === 'k') { e.preventDefault(); setPalette((v) => !v); return }
      if (e.key === 'Escape' && (palette || kbHelp)) { setPalette(false); setKbHelp(false); return }
      if (detailId && (section === 'calendar' || section === 'dashboard')) return
      const tag = (e.target.tagName || '').toLowerCase()
      if (['input', 'textarea', 'select'].includes(tag) || e.metaKey || e.ctrlKey) return
      if (e.key === '?') { e.preventDefault(); setKbHelp(true); return }
      if (/^[1-8]$/.test(k)) actions.setUI({ section: ['calendar', 'clients', 'staff', 'billing', 'analytics', 'reports', 'dashboard', 'masters'][Number(k) - 1] })
      else if (k === 't') actions.setUI({ anchor: todayISO() })
      else if ((k === 'n' || k === 'a') && section === 'calendar') setPicking({ date: todayISO(), start: 9 * 60, end: 10 * 60 })
      else if (['d', 'w', 'm', 'g', 'h'].includes(k)) actions.setUI({ section: 'calendar', view: { d: 'day', w: 'week', m: 'month', g: 'agenda', h: 'timeline' }[k] })
      else if (k === 'arrowleft' || k === 'arrowright') {
        const dir = k === 'arrowleft' ? -1 : 1
        if (section === 'calendar') actions.setUI({ anchor: shift(ui.view, ui.anchor, dir, settings.weekStart) })
        else if (section === 'analytics' || section === 'reports') {
          const preset = section === 'analytics' ? ui.anPreset || settings.analytics?.preset : ui.repPreset || 'last4'
          actions.setUI({ anchor: slidePreset(preset, ui.anchor, dir, settings.weekStart) })
        }
      } else if (k === 'u') {
        actions.undo()
        toast({ message: 'Undone', kind: 'info' })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    }, [modal, picking, quickAdd, detailId, section, ui.view, ui.anchor, ui.anPreset, ui.repPreset, settings.weekStart, settings.analytics, actions, toast, palette, kbHelp])

  const openCreate = (type, preset = {}) => {
    const firstStaff = preset.staffIds ?? (ui.staffSel.length === 1 ? ui.staffSel : ui.staffSel.slice(0, 3))
    const firstClient = preset.clientIds ?? (ui.clientSel.length === 1 ? ui.clientSel : [])
    setModal({
      mode: 'create',
      appt: {
        id: uid(),
        type,
        title: preset.title || '',
        date: preset.date || ui.anchor,
        start: preset.start ?? 9 * 60,
        end: preset.end ?? 10 * 60,
        staffIds: firstStaff,
        clientIds: firstClient,
        status: 'active',
        location: preset.location || '',
        service: preset.service || (type === 'service' ? 'dtt' : ''),
        notes: '',
        abaHr: false,
        repeat: 'none',
        repeatCount: 8,
        recurrence: 'none',
        billing: null,
        custom: {},
        documents: [],
        verification: null,
      },
    })
  }

  const detailAppt = detailId ? state.appts[detailId] : null

  // cross-section deep links (reports → a specific appointment) route through ui.openAppt
  useEffect(() => {
    if (ui.openAppt && state.appts[ui.openAppt]) {
      setDetailId(ui.openAppt)
      actions.setUI({ openAppt: null })
    }
  }, [ui.openAppt, state.appts, actions])

  const label = rangeLabel(ui.view, days, settings.weekStart)
  const first = parseISO(days[0])
  const sub =
    ui.view === 'week'
      ? `Week ${weekNum(days[0])}`
      : ui.view === 'day'
      ? DAY_NAMES[first.getDay()]
      : ui.view === 'agenda'
      ? '14-day outlook'
      : `${first.getFullYear()}`

  return (
    <div className="applayout">
      <NavRail />
      <div className="appbody">
        {section === 'calendar' && (
          <>
            <TopBar
              days={days}
              onPalette={() => setPalette(true)}
              label={label}
              sub={sub}
              onNew={() => setPicking({ date: ui.anchor, start: null, end: null })}
              onNav={(dir) => actions.setUI({ anchor: shift(ui.view, ui.anchor, dir, settings.weekStart) })}
            />
            <div className="main">
              <Sidebar days={days} />
              <div className="calwrap">
                {(ui.view === 'week' || ui.view === 'day') && (
                  <TimeGrid
                    days={days}
                    onPickSlot={(slot) => setPicking(slot)}
                    onQuickCreate={(slot) => setQuickAdd(slot)}
                    onOpenDetail={setDetailId}
                    selectedId={detailId}
                    setSelectedId={setDetailId}
                  />
                )}
                {ui.view === 'timeline' && (
                  <TimelineView
                    days={days}
                    onPickSlot={(slot) => setPicking(slot)}
                    onQuickCreate={(slot) => setQuickAdd(slot)}
                    onOpenDetail={setDetailId}
                    selectedId={detailId}
                    setSelectedId={setDetailId}
                  />
                )}
                {ui.view === 'month' && <MonthView days={days} onOpenDetail={setDetailId} onCreateAt={(date) => setPicking({ date, start: null, end: null })} />}
                {ui.view === 'agenda' && <AgendaView days={days} onOpenDetail={setDetailId} onNew={() => setPicking({ date: ui.anchor, start: null, end: null })} />}
              </div>
            </div>
          </>
        )}
        {section === 'analytics' && <AnalyticsView />}
        {section === 'reports' && <ReportsView />}
        {section === 'dashboard' && <DashboardView onOpenDetail={setDetailId} />}
        {section === 'clients' && <ClientsView />}
        {section === 'masters' && <MastersView />}
        {section === 'staff' && <StaffView />}
        {section === 'billing' && <BillingView />}
        {section === 'bil-files' && <BilledFilesView />}
        {section === 'bil-secondary' && <SecondaryBillingView />}
        {section === 'bil-payments' && <PaymentCenterView />}
        {section === 'bil-ar' && <ArManagerView />}
        {section === 'bil-invoice' && <GenerateInvoiceView />}
        {section === 'bil-verify' && <VerificationFormsView />}
        {section === 'bil-qbo' && <QuickBooksView />}
        {section === 'bil-providers' && <ProviderIdView />}
      </div>

      {picking && (
        <TypePicker
          slot={picking}
          onClose={() => setPicking(null)}
          onPick={(type) => {
            const slot = picking
            setPicking(null)
            if (type === 'service' && slot?.start != null) setQuickAdd({ date: slot.date, start: slot.start, end: slot.end })
            else openCreate(type, slot)
          }}
        />
      )}
      {modal && (
        <AppointmentModal
          key={modal.appt.id}
          mode={modal.mode}
          initial={modal.appt}
          onBack={
            modal.mode === 'create'
              ? () => {
                  const { date, start, end } = modal.appt
                  setModal(null)
                  setPicking({ date, start, end })
                }
              : undefined
          }
          onClose={() => setModal(null)}
          onSaved={(msg, apptsOut) => {
            setModal(null)
            if (apptsOut?.id) setDetailId(apptsOut.id)
            toast({ message: msg, kind: 'ok' })
          }}
        />
      )}
      {quickAdd && (
        <QuickAdd
          slot={quickAdd}
          onClose={() => setQuickAdd(null)}
          onBooked={(appt) => {
            setQuickAdd(null)
            setDetailId(appt.id)
            toast({ message: 'Session booked — open to verify, or edit any field', kind: 'ok' })
          }}
          onFullForm={(pre) => {
            setQuickAdd(null)
            openCreate('service', pre)
          }}
        />
      )}
      {ui.settings && <SettingsModal onClose={() => actions.setUI({ settings: false })} />}
      {palette && (
        <CommandPalette
          onClose={() => setPalette(false)}
          onNew={() => setPicking({ date: ui.anchor && section === 'calendar' ? ui.anchor : todayISO(), start: 9 * 60, end: 10 * 60 })}
          onHelp={() => setKbHelp(true)}
        />
      )}
      {kbHelp && <KeysHelp onClose={() => setKbHelp(false)} />}
      {ui.inbox && <NeedsCover days={days} onClose={() => actions.setUI({ inbox: false })} />}
      {detailAppt && (section === 'calendar' || section === 'dashboard') && (
        <DetailCard
          appt={detailAppt}
          onClose={() => setDetailId(null)}
          onEdit={() => {
            setDetailId(null)
            setModal({ mode: 'edit', appt: { ...detailAppt, repeat: detailAppt.recurrence || 'none' } })
          }}
        />
      )}
    </div>
  )
}

import BuildWatcher from './components/BuildWatcher.jsx'

export default function App() {
  return (
    <ToastProvider>
      <StoreProvider>
        <Shell />
        <BuildWatcher />
      </StoreProvider>
    </ToastProvider>
  )
}
