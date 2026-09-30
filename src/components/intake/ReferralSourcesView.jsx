import React, { useMemo, useState } from 'react'
import { useStore } from '../../state/store'
import { SectionBar } from '../NavRail'
import { Icon } from '../../ui/Icons'
import { useToast } from '../../ui/Toast'
import { Dropdown } from '../fields'
import { uid } from '../../lib/model'
import { SOURCE_KINDS, sourceStats, referralToAssessmentDays, firstContactDays, isWon, isLost } from '../../lib/intake'
import { KpiStrip, fmtDate, pctText, sinceText } from './IntakeCommon'
import { todayISO } from '../../lib/date'

const BLANK = {
  name: '', kind: SOURCE_KINDS[0], contact: '', phone: '', email: '', npi: '',
  ownerId: null, status: 'active', since: todayISO(), dormantDays: 90, notes: '',
}

const STATUS_TONE = { active: 'ok', dormant: 'warn', inactive: 'neutral' }

function SourceEditor({ item, onClose }) {
  const state = useStore()
  const { actions, staff = [] } = state
  const toast = useToast()
  const [f, setF] = useState(item || BLANK)
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }))
  const save = () => {
    if (!f.name.trim()) { toast({ message: 'A referral source needs a name', kind: 'warn' }); return }
    const saved = actions.saveReferralSource({ ...f, id: f.id || uid() })
    toast({ message: `${saved.name} saved to the referral register`, kind: 'ok' })
    onClose()
  }
  return (
    <div className="overlay iq-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="iq-modal-card iq-modal-wide" role="dialog" aria-label="Referral source" data-testid="iq-src-editor">
        <header className="iq-modal-h"><b>{item ? `Edit · ${item.name}` : 'New referral source'}</b><button className="iconbtn" onClick={onClose} aria-label="Close">{Icon.x({ size: 13 })}</button></header>
        <div className="iq-tab-body">
          <div className="iq-grid2">
            <label className="iq-fld wide"><span>Organisation / source name <em className="iq-req">*</em></span>
              <input className="input" value={f.name} onChange={(e) => set('name', e.target.value)} data-testid="iq-src-name" /></label>
            <label className="iq-fld"><span>Kind</span>
              <Dropdown value={f.kind} onChange={(v) => set('kind', v)} options={SOURCE_KINDS.map((k) => ({ value: k, label: k }))} testid="iq-src-kind" searchable /></label>
            <label className="iq-fld"><span>Status</span>
              <Dropdown value={f.status} onChange={(v) => set('status', v)} options={[{ value: 'active', label: 'Active' }, { value: 'dormant', label: 'Dormant — no recent referrals' }, { value: 'inactive', label: 'Inactive — do not route' }]} testid="iq-src-status" /></label>
            <label className="iq-fld"><span>Contact person</span>
              <input className="input" value={f.contact} onChange={(e) => set('contact', e.target.value)} data-testid="iq-src-contact" /></label>
            <label className="iq-fld"><span>Relationship owner</span>
              <Dropdown value={f.ownerId || ''} onChange={(v) => set('ownerId', v || null)} options={[{ value: '', label: 'Unassigned' }, ...staff.map((s) => ({ value: s.id, label: s.name, sub: s.role }))]} testid="iq-src-owner" searchable /></label>
            <label className="iq-fld"><span>Phone</span>
              <input className="input" value={f.phone} onChange={(e) => set('phone', e.target.value)} data-testid="iq-src-phone" /></label>
            <label className="iq-fld"><span>Email</span>
              <input className="input" value={f.email} onChange={(e) => set('email', e.target.value)} data-testid="iq-src-email" /></label>
            <label className="iq-fld"><span>NPI (providers)</span>
              <input className="input" value={f.npi} onChange={(e) => set('npi', e.target.value)} data-testid="iq-src-npi" /></label>
            <label className="iq-fld"><span>Dormancy alert after (days)</span>
              <input className="input" type="number" min="7" value={f.dormantDays} onChange={(e) => set('dormantDays', Number(e.target.value) || 90)} data-testid="iq-src-dormant" /></label>
            <label className="iq-fld wide"><span>Notes</span>
              <input className="input" value={f.notes} onChange={(e) => set('notes', e.target.value)} data-testid="iq-src-notes" /></label>
          </div>
          <p className="iq-note">{Icon.info({ size: 11 })} Dormancy alerts go to the relationship owner — keeping referral relationships warm is cheaper than finding new ones.</p>
          <div className="iq-actions">
            <button className="btn btn-sm btn-primary" data-testid="iq-src-save" onClick={save}>{Icon.check({ size: 12 })} Save source</button>
            <button className="btn btn-sm" onClick={onClose}>Cancel</button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function ReferralSourcesView() {
  const state = useStore()
  const { actions, referralSources = [], intakeRequests = {}, staff = [] } = state
  const toast = useToast()
  const [editing, setEditing] = useState(null)
  const [q, setQ] = useState('')
  const [kind, setKind] = useState('all')

  const stats = useMemo(() => sourceStats(referralSources, intakeRequests), [referralSources, intakeRequests])
  const rows = stats
    .filter((s) => kind === 'all' || s.source.kind === kind)
    .filter((s) => !q || `${s.source.name} ${s.source.contact} ${s.source.kind}`.toLowerCase().includes(q.toLowerCase()))

  const totals = useMemo(() => {
    const list = Object.values(intakeRequests)
    const attributed = list.filter((r) => r.referralSourceId)
    const won = list.filter((r) => isWon(r.stage))
    const lost = list.filter((r) => isLost(r.stage))
    const assessed = list.map(referralToAssessmentDays).filter((n) => Number.isFinite(n))
    return {
      sources: referralSources.filter((s) => s.status === 'active').length,
      dormant: stats.filter((s) => s.dormant).length,
      attributed: attributed.length,
      unattributed: list.length - attributed.length,
      conversion: won.length + lost.length ? Math.round((won.length / (won.length + lost.length)) * 100) : null,
      medianToAssessment: assessed.length ? [...assessed].sort((a, b) => a - b)[Math.floor(assessed.length / 2)] : null,
    }
  }, [intakeRequests, referralSources, stats])

  const kinds = ['all', ...[...new Set(referralSources.map((s) => s.kind))].sort()]

  return (
    <div className="sectionpage">
      <SectionBar icon="zap" title="Referral Sources" sub={`${totals.sources} active relationships · ${totals.dormant} dormant · ${totals.attributed} of ${totals.attributed + totals.unattributed} requests attributed`}>
        <input className="input" style={{ width: 200, height: 30 }} placeholder="Search sources…" value={q} onChange={(e) => setQ(e.target.value)} data-testid="iq-src-search" />
        <Dropdown value={kind} onChange={setKind} options={kinds.map((k) => ({ value: k, label: k === 'all' ? 'All kinds' : k }))} testid="iq-src-kindfilter" searchable style={{ minWidth: 170 }} />
        <button className="btn btn-sm btn-primary" data-testid="iq-src-new" onClick={() => setEditing(BLANK)}>{Icon.plus({ size: 13 })} Source</button>
      </SectionBar>

      <div className="sec-body">
        <KpiStrip items={[
          { id: 'sources', icon: 'zap', value: totals.sources, label: 'Active referral sources' },
          { id: 'dormant', icon: 'alert', value: totals.dormant, label: 'Dormant relationships', sub: 'no referral in the alert window', tone: totals.dormant ? 'var(--warn)' : 'var(--ok)' },
          { id: 'conversion', icon: 'checkCircle', value: pctText(totals.conversion), label: 'Referral → client', sub: 'across all sources' },
          { id: 'speed', icon: 'cal', value: totals.medianToAssessment == null ? '—' : `${totals.medianToAssessment}d`, label: 'Median referral → assessment' },
          { id: 'unattributed', icon: 'info', value: totals.unattributed, label: 'Unattributed requests', sub: 'no source recorded', tone: totals.unattributed ? 'var(--warn)' : 'var(--ok)' },
        ]} testid="iq-src-kpis" />

        <div className="iq-tablewrap">
          <table className="iq-table" data-testid="iq-src-table">
            <thead>
              <tr>
                <th>Source</th><th>Owner</th><th>Referrals</th><th>Converted</th><th>Conversion</th>
                <th>Median → assessment</th><th>Last referral</th><th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {rows.map(({ source: s, volume, won, lost, open, conversionRate, medianToAssessment, lastReferralAt, dormant }) => {
                const owner = staff.find((x) => x.id === s.ownerId)
                return (
                  <tr key={s.id} data-testid={`iq-src-row-${s.id}`}>
                    <td>
                      <span className="iq-srcname">
                        <b>{s.name}</b>
                        <i>{s.kind}{s.contact && s.contact !== '—' ? ` · ${s.contact}` : ''}</i>
                      </span>
                    </td>
                    <td>{owner ? owner.name : <span className="muted">Unassigned</span>}</td>
                    <td><b>{volume}</b> <span className="muted">{open ? `· ${open} open` : ''}</span></td>
                    <td>{won} <span className="muted">· {lost} lost</span></td>
                    <td><b style={{ color: conversionRate == null ? undefined : conversionRate >= 40 ? 'var(--ok)' : conversionRate >= 25 ? 'var(--warn)' : 'var(--danger)' }}>{pctText(conversionRate)}</b></td>
                    <td>{medianToAssessment == null ? <span className="muted">—</span> : `${medianToAssessment}d`}</td>
                    <td>
                      {lastReferralAt ? <>{fmtDate(new Date(lastReferralAt).toISOString().slice(0, 10))} <span className="muted">· {sinceText(lastReferralAt)}</span></> : <span className="muted">Never</span>}
                      {dormant && <span className="iq-pill warn" data-testid={`iq-src-dormant-${s.id}`} style={{ marginLeft: 6 }}>{Icon.alert({ size: 10 })} Dormant</span>}
                    </td>
                    <td className="iq-td-acts">
                      <span className={`iq-pill ${STATUS_TONE[s.status] || 'neutral'}`}>{s.status}</span>
                      <button className="dir-eye" data-testid={`iq-src-edit-${s.id}`} title="Edit source" onClick={() => setEditing(s)}>{Icon.edit({ size: 13 })}</button>
                      <button className="dir-eye" data-testid={`iq-src-view-${s.id}`} title="See attributed requests" onClick={() => { actions.setUI({ section: 'intake', intakeSource: s.id }); toast({ message: `Intake pipeline opened — filter by ${s.name}`, kind: 'info' }) }}>{Icon.eye({ size: 13 })}</button>
                      <button className="dir-eye" data-testid={`iq-src-del-${s.id}`} title="Remove or retire" onClick={() => { const r = actions.removeReferralSource(s.id); toast({ message: r.retired ? r.msg : `${s.name} removed from the register`, kind: r.retired ? 'warn' : 'ok' }) }}>{Icon.trash({ size: 13 })}</button>
                    </td>
                  </tr>
                )
              })}
              {!rows.length && <tr><td colSpan={8}><div className="bil-empty">No referral sources match — add the relationship to start attributing referrals.</div></td></tr>}
            </tbody>
          </table>
        </div>

        <p className="iq-note">
          {Icon.info({ size: 11 })} Conversion is calculated only over decided requests (converted + closed), so a young pipeline is never punished with a misleading rate.
          {' '}Benchmarks used across the module: first callback within a business day, VOB within 30 minutes of capture, appointment offered within 24 hours for urgent referrals, and a 25–35% inquiry-to-admit conversion for behavioural-health pipelines.
        </p>
      </div>

      {editing && <SourceEditor item={editing === BLANK ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  )
}
