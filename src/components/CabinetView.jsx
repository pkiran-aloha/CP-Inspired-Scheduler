import React, { useMemo, useState } from 'react'
import { useStore } from '../state/store'
import { SectionBar } from './NavRail'
import { Icon } from '../ui/Icons'
import { useToast } from '../ui/Toast'
import { todayISO } from '../lib/date'
import { CABINET_CATEGORIES, CABINET_OWNERS, expiryState, daysLeft, ownerName, cabinetAlerts } from '../lib/cabinet'

const STATE_LABEL = { expired: 'Expired', due: 'Expires soon', ok: 'Current', none: 'No expiry' }
const STATE_TONE = { expired: 'tone-stop', due: 'tone-warn', ok: 'tone-ok', none: '' }
const blank = { title: '', category: CABINET_CATEGORIES[0], ownerKind: 'staff', ownerId: '', issuedOn: '', expiresOn: '', noExpiry: false, reference: '', notes: '' }

/** Cabinet: the register of expiring documents. Metadata only; no file is stored. */
export default function CabinetView() {
  const state = useStore()
  const { actions, staff = [], clients = [] } = state
  const toast = useToast()
  const today = todayISO()
  const [filter, setFilter] = useState('attention')
  const [form, setForm] = useState(null) // null | draft
  const docs = Object.values(state.cabinet || {})
  const alerts = cabinetAlerts(state, today)
  const rows = useMemo(() => docs
    .filter((d) => (filter === 'archived' ? d.archived : !d.archived))
    .filter((d) => filter !== 'attention' || ['expired', 'due'].includes(expiryState(d, today)))
    .sort((a, b) => ((a.expiresOn || '9999') < (b.expiresOn || '9999') ? -1 : 1)), [state.cabinet, filter, today])
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))
  const save = () => {
    const res = actions.saveCabinetDoc(form)
    toast({ message: res.msg, kind: res.ok ? 'ok' : 'warn' })
    if (res.ok) setForm(null)
  }
  const owners = form?.ownerKind === 'staff' ? staff : form?.ownerKind === 'client' ? clients : []
  const expired = alerts.filter((d) => expiryState(d, today) === 'expired').length

  return (
    <div className="sectionpage" data-testid="cab-view">
      <SectionBar icon="clipboard" title="Cabinet" sub="Documents that expire: credentials, licenses, checks, insurance, consents. Details only; no files are stored.">
        <button className="btn btn-sm btn-primary" data-testid="cab-add" onClick={() => setForm({ ...blank, ownerId: staff[0]?.id || '' })}>{Icon.plus({ size: 13 })} Add document</button>
      </SectionBar>
      <div className="sec-body" style={{ padding: 16 }}>
        <div className={`warnbox ${alerts.length ? 'warn' : ''}`} data-testid="cab-alerts" style={{ marginBottom: 12 }}>
          {alerts.length
            ? <>{expired} expired and {alerts.length - expired} expiring within 30 days. Renew them, then update the expiry date here.</>
            : <>Nothing expired or expiring within 30 days.</>}
        </div>
        <div className="viewseg" role="group" aria-label="Show" style={{ marginBottom: 12 }}>
          {[['attention', 'Needs attention'], ['all', 'All current'], ['archived', 'Archived']].map(([k, l]) => (
            <button key={k} className={filter === k ? 'on' : ''} aria-pressed={filter === k} data-testid={`cab-filter-${k}`} onClick={() => setFilter(k)}>{l}</button>
          ))}
        </div>

        {form && (
          <div className="panel" data-testid="cab-form" style={{ padding: 14, marginBottom: 12, borderRadius: 12, border: '1px solid var(--line)', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
            <label className="iq-fld"><span>Document</span><input className="input" data-testid="cab-f-title" value={form.title} onChange={(e) => set('title', e.target.value)} placeholder="e.g. RBT certification" /></label>
            <label className="iq-fld"><span>Category</span><select className="input" data-testid="cab-f-category" value={form.category} onChange={(e) => set('category', e.target.value)}>{CABINET_CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select></label>
            <label className="iq-fld"><span>Belongs to</span><select className="input" data-testid="cab-f-ownerkind" value={form.ownerKind} onChange={(e) => setForm({ ...form, ownerKind: e.target.value, ownerId: e.target.value === 'staff' ? staff[0]?.id || '' : e.target.value === 'client' ? clients[0]?.id || '' : '' })}>{CABINET_OWNERS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</select></label>
            {form.ownerKind !== 'practice' && (
              <label className="iq-fld"><span>{form.ownerKind === 'staff' ? 'Staff member' : 'Client'}</span><select className="input" data-testid="cab-f-owner" value={form.ownerId} onChange={(e) => set('ownerId', e.target.value)}>{owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
            )}
            <label className="iq-fld"><span>Issued</span><input className="input" type="date" data-testid="cab-f-issued" value={form.issuedOn} onChange={(e) => set('issuedOn', e.target.value)} /></label>
            <label className="iq-fld"><span>Expires</span><input className="input" type="date" data-testid="cab-f-expires" disabled={form.noExpiry} value={form.expiresOn} onChange={(e) => set('expiresOn', e.target.value)} /></label>
            <label className="pr-check" style={{ alignSelf: 'end' }}><input type="checkbox" data-testid="cab-f-noexpiry" checked={form.noExpiry} onChange={(e) => set('noExpiry', e.target.checked)} /><span>Does not expire</span></label>
            <label className="iq-fld"><span>Reference / number</span><input className="input" data-testid="cab-f-ref" value={form.reference} onChange={(e) => set('reference', e.target.value)} /></label>
            <label className="iq-fld" style={{ gridColumn: '1 / -1' }}><span>Notes</span><input className="input" data-testid="cab-f-notes" value={form.notes} onChange={(e) => set('notes', e.target.value)} placeholder="Where the original is kept, who renews it" /></label>
            <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn btn-sm" data-testid="cab-f-cancel" onClick={() => setForm(null)}>Cancel</button>
              <button className="btn btn-sm btn-primary" data-testid="cab-f-save" onClick={save}>{form.id ? 'Save changes' : 'Add to cabinet'}</button>
            </div>
          </div>
        )}

        <div className="panel" style={{ borderRadius: 12, border: '1px solid var(--line)', overflow: 'hidden' }} data-testid="cab-list">
          {!rows.length ? (
            <div className="muted" style={{ padding: 20, fontSize: 12 }} data-testid="cab-empty">{filter === 'attention' ? 'Nothing needs attention.' : filter === 'archived' ? 'No archived documents.' : 'No documents yet. Add the first one.'}</div>
          ) : rows.map((d) => {
            const st = expiryState(d, today)
            const left = daysLeft(d, today)
            return (
              <div key={d.id} data-testid={`cab-row-${d.id}`} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '10px 14px', borderTop: '1px solid var(--line)', fontSize: 12 }}>
                <b style={{ minWidth: 180 }}>{d.title}</b>
                <span className="muted">{d.category}</span>
                <span>{ownerName(state, d)}</span>
                <span className="muted">{d.reference}</span>
                <span className={`tag ${STATE_TONE[st]}`} data-testid={`cab-state-${d.id}`}>{STATE_LABEL[st]}{d.expiresOn ? ` · ${d.expiresOn}${left != null ? ` (${left < 0 ? `${-left} days ago` : `${left} days`})` : ''}` : ''}</span>
                <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                  {!d.archived && <button className="btn btn-xs" data-testid={`cab-edit-${d.id}`} onClick={() => setForm({ ...blank, ...d, noExpiry: !d.expiresOn })}>{Icon.edit({ size: 11 })} Edit</button>}
                  <button className="btn btn-xs" data-testid={`cab-archive-${d.id}`} onClick={() => { const res = actions.archiveCabinetDoc(d.id, !d.archived); toast({ message: res.msg, kind: res.ok ? 'ok' : 'warn' }) }}>{d.archived ? 'Restore' : 'Archive'}</button>
                </span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
