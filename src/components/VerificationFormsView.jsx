import React, { useMemo, useState } from 'react'
import { useStore } from '../state/store'
import { SectionBar, RangePicker } from './NavRail'
import { Icon } from '../ui/Icons'
import { useToast } from '../ui/Toast'
import { resolveRange } from '../lib/analytics'
import { download } from '../lib/ics'
import { isoDate, addDays, parseISO, fmtDayLabel } from '../lib/date'
import { PersonAvatar } from '../ui/avatars'

export default function VerificationFormsView() {
  const state = useStore()
  const { ui, actions, settings, clients, payers } = state
  const toast = useToast()
  const preset = ui.vfPreset || 'last4'
  const range = useMemo(() => resolveRange(preset, ui.anchor, settings.weekStart), [preset, ui.anchor, settings.weekStart])
  const [q, setQ] = useState('')
  const [statusF, setStatusF] = useState('all')
  const [selId, setSelId] = useState(null)

  const forms = useMemo(() => (state.verificationForms || []), [state.verificationForms])
  const filtered = useMemo(() => {
    let out = forms
    if (statusF !== 'all') out = out.filter((f) => f.status === statusF)
    if (q.trim()) {
      const t = q.trim().toLowerCase()
      out = out.filter((f) => `${f.clientName} ${f.payer} ${f.id}`.toLowerCase().includes(t))
    }
    return out
  }, [forms, statusF, q])

  const sel = selId ? forms.find((f) => f.id === selId) : null

  const kpis = {
    total: forms.length,
    pending: forms.filter((f) => f.status === 'pending').length,
    verified: forms.filter((f) => f.status === 'verified').length,
    expired: forms.filter((f) => f.status === 'expired').length,
  }

  return (
    <div className="sectionpage" data-testid="vf-sec" style={{ background: 'var(--bg)' }}>
      <SectionBar icon="shield" title="Verification Forms" sub={`${range.label} · ${kpis.total} forms · ${kpis.pending} pending · ${kpis.verified} verified`}>
        <RangePicker preset={preset} onPreset={(p) => actions.setUI({ vfPreset: p })} onSlide={(d) => actions.setUI({ anchor: isoDate(addDays(parseISO(ui.anchor), d * range.days.length)) })} label={range.label} />
        <div className="sb-search" style={{ minWidth: 220, borderRadius: 10 }}>
          <span className="sic">{Icon.search({ size: 12 })}</span>
          <input placeholder="Search client, payer" value={q} onChange={(e) => setQ(e.target.value)} data-testid="vf-search" style={{ fontSize: 13 }} />
        </div>
        <button className="btn btn-sm btn-primary" data-testid="vf-new" onClick={() => { const id = `vf_${Date.now()}`; actions.addVerificationForm({ id, clientId: clients[0]?.id || '', clientName: clients[0]?.name || 'New Client', payer: payers[0]?.name || '', status: 'pending', date: range.days[0] }); toast({ message: 'Verification form created', kind: 'ok' }) }} style={{ borderRadius: 10 }}>+ New Form</button>
      </SectionBar>

      <div className="batch-strip" data-testid="vf-kpis" style={{ margin: '16px', padding: '16px', gap: 12, flexWrap: 'wrap', background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 14 }}>
        {[
          ['Total', kpis.total, 'All', '#6366f1', 'vf-kpi-total'],
          ['Pending', kpis.pending, 'Needs check', '#f59e0b', 'vf-kpi-pending'],
          ['Verified', kpis.verified, 'Active', '#10b981', 'vf-kpi-verified'],
          ['Expired', kpis.expired, 'Renew', '#ef4444', 'vf-kpi-expired'],
        ].map(([label, val, sub, color, testId]) => (
          <div key={label} className="rp-sumchip on" data-testid={testId} style={{ background: 'var(--panel)', border: '1px solid var(--line)', display: 'flex', gap: 12, alignItems: 'center', minWidth: 140, borderRadius: 12, padding: '12px 16px' }}>
            <span style={{ width: 32, height: 32, borderRadius: 9, background: `${color}14`, color, display: 'grid', placeItems: 'center' }}>{Icon.shield({ size: 14 })}</span>
            <div><b style={{ fontSize: 18, fontWeight: 800 }}>{val}</b><span style={{ display: 'block', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--muted)' }}>{label}</span><span style={{ fontSize: 12, color: 'var(--muted)' }}>{sub}</span></div>
          </div>
        ))}
      </div>

      <div className="batch-strip" style={{ margin: '0 16px 16px', padding: '12px 16px', gap: 12, background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 12 }}>
        <div className="viewseg" style={{ borderRadius: 10, padding: 3 }} data-testid="vf-status-tabs">
          {[
            ['all', 'All'],
            ['pending', 'Pending'],
            ['verified', 'Verified'],
            ['expired', 'Expired'],
          ].map(([id, label]) => (
            <button key={id} className={statusF === id ? 'on' : ''} data-testid={`vf-status-${id}`} onClick={() => setStatusF(id)} style={{ borderRadius: 8, fontSize: 13 }}>{label}</button>
          ))}
        </div>
        <span className="muted" style={{ fontSize: 12, marginLeft: 8 }}>{filtered.length} forms</span>
      </div>

      <div style={{ padding: '0 16px 16px', display: 'flex', gap: 20, alignItems: 'flex-start' }}>
        <div className="panel" style={{ flex: 1, minWidth: 0, borderRadius: 14, overflow: 'hidden', border: '1px solid var(--line)' }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 12, background: 'var(--panel-2)' }}>
            <span style={{ width: 32, height: 32, borderRadius: 9, background: '#6366f114', color: '#6366f1', display: 'grid', placeItems: 'center' }}>{Icon.shield({ size: 16 })}</span>
            <div><b style={{ fontSize: 14 }}>Forms</b><div className="muted" style={{ fontSize: 12 }}>{filtered.length} verifications</div></div>
          </div>
          <div className="py-tbl" data-testid="vf-table" style={{ overflowX: 'auto' }}>
            <div className="py-thead" style={{ gridTemplateColumns: '1.4fr 1fr 100px 100px 120px', background: 'var(--panel-2)', fontSize: 11, padding: '12px 16px' }}>
              <span>Client</span><span>Payer</span><span>Date</span><span>Status</span><span>Actions</span>
            </div>
            {filtered.slice(0, 80).map((f) => {
              const cl = clients.find((c) => c.id === f.clientId)
              const isSel = selId === f.id
              return (
                <div key={f.id} className={`py-trow ${isSel ? 'on' : ''}`} data-testid={`vf-row-${f.id}`} onClick={() => setSelId(f.id)} style={{ gridTemplateColumns: '1.4fr 1fr 100px 100px 120px', minHeight: 56, padding: '12px 16px', cursor: 'pointer', background: isSel ? '#f5f3ff' : undefined, borderLeft: `3px solid ${isSel ? '#6366f1' : 'transparent'}` }}>
                  <div className="py-cell"><div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><PersonAvatar p={cl || { name: f.clientName }} size={26} /><b style={{ fontSize: 13 }}>{f.clientName || cl?.name || f.clientId}</b></div></div>
                  <div className="py-cell" style={{ fontSize: 12 }}>{f.payer}</div>
                  <div className="py-cell" style={{ fontSize: 12 }}>{f.date || '—'}</div>
                  <div className="py-cell"><span className="pill" style={{ fontSize: 11, borderRadius: 20, padding: '3px 10px', background: f.status === 'verified' ? '#ecfdf5' : f.status === 'expired' ? '#fef2f2' : '#fef9c3' }}>{f.status}</span></div>
                  <div className="py-cell"><button className="btn btn-xs btn-primary" data-testid={`vf-open-${f.id}`} onClick={(e) => { e.stopPropagation(); setSelId(f.id) }} style={{ borderRadius: 8 }}>View</button></div>
                </div>
              )
            })}
            {!filtered.length && <div className="py-empty" style={{ padding: 48, textAlign: 'center' }} data-testid="vf-empty"><b>No verification forms</b><div className="muted" style={{ fontSize: 12 }}>Create a form to verify eligibility.</div></div>}
            <div className="footer" style={{ padding: '12px 20px', display: 'flex', justifyContent: 'space-between', background: 'var(--panel-2)', borderTop: '1px solid var(--line)', fontSize: 12 }}><span>{filtered.length} forms</span><span>{kpis.pending} pending</span></div>
          </div>
        </div>

        <div className="panel" style={{ width: 440, flex: 'none', borderRadius: 14, overflow: 'hidden', border: '1px solid var(--line)', position: 'sticky', top: 64 }} data-testid="vf-detail">
          {!sel ? (
            <div style={{ padding: 48, textAlign: 'center' }}><b style={{ fontSize: 14 }}>Select a form</b><div className="muted" style={{ fontSize: 12, marginTop: 6 }}>Choose a verification from the list.</div></div>
          ) : (
            <>
              <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 12, background: 'var(--panel-2)' }}>
                <PersonAvatar p={clients.find((c) => c.id === sel.clientId) || { name: sel.clientName }} size={32} />
                <div><b style={{ fontSize: 14 }}>{sel.clientName}</b><div className="muted" style={{ fontSize: 12 }}>{sel.payer} · {sel.date}</div></div>
                <button className="btn btn-xs" onClick={() => setSelId(null)} style={{ marginLeft: 'auto', borderRadius: 8 }}>{Icon.x({ size: 10 })} Close</button>
              </div>
              <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div style={{ background: 'var(--panel-2)', border: '1px solid var(--line)', borderRadius: 10, padding: '12px 14px' }}><div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--muted)' }}>Status</div><div style={{ fontSize: 13, fontWeight: 700, marginTop: 4 }}>{sel.status}</div></div>
                  <div style={{ background: 'var(--panel-2)', border: '1px solid var(--line)', borderRadius: 10, padding: '12px 14px' }}><div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--muted)' }}>Payer</div><div style={{ fontSize: 13, marginTop: 4 }}>{sel.payer}</div></div>
                </div>
                <div style={{ background: 'var(--panel-2)', border: '1px solid var(--line)', borderRadius: 10, padding: '12px 14px' }}><div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--muted)' }}>Notes</div><div style={{ fontSize: 13, marginTop: 4 }}>{sel.notes || 'No notes'}</div></div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn btn-sm btn-primary" data-testid="vf-mark-verified" onClick={() => { actions.updateVerificationForm(sel.id, { status: 'verified' }); toast({ message: `${sel.clientName} verified`, kind: 'ok' }) }} style={{ borderRadius: 10 }}>Mark Verified</button>
                  <button className="btn btn-sm" data-testid="vf-mark-expired" onClick={() => { actions.updateVerificationForm(sel.id, { status: 'expired' }); toast({ message: `${sel.clientName} marked expired`, kind: 'ok' }) }} style={{ borderRadius: 10 }}>Mark Expired</button>
                  <button className="btn btn-sm" data-testid="vf-download" onClick={() => { download(`Verification-${sel.clientName}.txt`, `Verification Form\nClient ${sel.clientName}\nPayer ${sel.payer}\nStatus ${sel.status}\nDate ${sel.date}\nNotes ${sel.notes || ''}`); toast({ message: 'Form downloaded', kind: 'ok' }) }} style={{ borderRadius: 10 }}>Download</button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
