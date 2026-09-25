import React, { useMemo, useState } from 'react'
import { useStore } from '../state/store'
import { SectionBar, RangePicker } from './NavRail'
import { Icon } from '../ui/Icons'
import { useToast } from '../ui/Toast'
import { resolveRange } from '../lib/analytics'
import { isoDate, addDays, parseISO, fmtDayLabel, todayISO } from '../lib/date'
import { dueOf } from '../lib/claims'
import { PersonAvatar } from '../ui/avatars'

const money = (n) => `$${(Math.round(n * 100) / 100).toLocaleString(undefined, { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`

const APPEAL_TEMPLATES = [
  { id: 'med_necessity', label: 'Medical necessity', body: 'The service meets medical necessity criteria per payer policy. Documentation attached shows functional impairment and treatment plan.' },
  { id: 'auth_denied', label: 'Auth not found', body: 'Authorization was obtained on file. Auth number and dates attached. Request reprocessing.' },
  { id: 'timely', label: 'Timely filing', body: 'Claim was submitted within timely filing limits. Proof of submission attached.' },
]

export default function AppealsView() {
  const state = useStore()
  const { ui, actions, settings, claims, clients } = state
  const toast = useToast()
  const preset = ui.appealPreset || 'last4'
  const range = useMemo(() => resolveRange(preset, ui.anchor, settings.weekStart), [preset, ui.anchor, settings.weekStart])
  const [q, setQ] = useState('')
  const [statusF, setStatusF] = useState('all')
  const [selId, setSelId] = useState(null)
  const [tplId, setTplId] = useState(APPEAL_TEMPLATES[0].id)
  const [note, setNote] = useState('')

  const denied = useMemo(() => Object.values(claims).filter((c) => c.status === 'denied' || (c.denials && c.denials.length)), [claims])
  const filtered = useMemo(() => {
    let out = denied
    if (statusF !== 'all') out = out.filter((c) => c.status === statusF || (statusF === 'appeal' && c.appeal))
    if (q.trim()) {
      const t = q.trim().toLowerCase()
      out = out.filter((c) => `${c.no} ${c.payer} ${c.clientId}`.toLowerCase().includes(t))
    }
    return out
  }, [denied, statusF, q])

  const sel = selId ? claims[selId] : null
  const selClient = sel ? clients.find((c) => c.id === sel.clientId) : null
  const tpl = APPEAL_TEMPLATES.find((t) => t.id === tplId)

  const kpis = useMemo(() => {
    const inRange = denied.filter((c) => (c.dosFrom || '') >= range.days[0])
    return {
      total: denied.length,
      inRange: inRange.length,
      amount: denied.reduce((s, c) => s + dueOf(c), 0),
      appealed: Object.values(claims).filter((c) => c.appeal).length,
    }
  }, [denied, range, claims])

  return (
    <div className="sectionpage" data-testid="appeal-sec" style={{ background: 'var(--bg)' }}>
      <SectionBar icon="shield" title="Appeals & Denials" sub={`${range.label} · ${kpis.total} denials · ${money(kpis.amount)} · ${kpis.appealed} appealed`}>
        <RangePicker preset={preset} onPreset={(p) => actions.setUI({ appealPreset: p })} onSlide={(d) => actions.setUI({ anchor: isoDate(addDays(parseISO(ui.anchor), d * range.days.length)) })} label={range.label} />
        <div className="sb-search" style={{ minWidth: 220, borderRadius: 10 }}>
          <span className="sic">{Icon.search({ size: 12 })}</span>
          <input placeholder="Search claim, payer" value={q} onChange={(e) => setQ(e.target.value)} data-testid="appeal-search" style={{ fontSize: 13 }} />
        </div>
      </SectionBar>

      <div className="batch-strip" data-testid="appeal-kpis" style={{ margin: '16px', padding: '16px', gap: 12, flexWrap: 'wrap', background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 14 }}>
        {[
          ['Denials', kpis.total, `${kpis.inRange} in range`, '#ef4444', 'appeal-kpi-total'],
          ['Amount', money(kpis.amount), 'At risk', '#f59e0b', 'appeal-kpi-amount'],
          ['Appealed', kpis.appealed, 'In progress', '#6366f1', 'appeal-kpi-appealed'],
          ['Win Rate', kpis.appealed ? `${Math.round((Object.values(claims).filter((c) => c.appeal?.outcome === 'won').length / kpis.appealed) * 100)}%` : '—', 'Won / appealed', '#10b981', 'appeal-kpi-win'],
        ].map(([label, val, sub, color, testId]) => (
          <div key={label} className="rp-sumchip on" data-testid={testId} style={{ background: 'var(--panel)', border: '1px solid var(--line)', display: 'flex', gap: 12, alignItems: 'center', minWidth: 140, borderRadius: 12, padding: '12px 16px' }}>
            <span style={{ width: 32, height: 32, borderRadius: 9, background: `${color}14`, color, display: 'grid', placeItems: 'center' }}>{Icon.shield({ size: 14 })}</span>
            <div><b style={{ fontSize: 18, fontWeight: 800 }}>{val}</b><span style={{ display: 'block', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--muted)' }}>{label}</span><span style={{ fontSize: 12, color: 'var(--muted)' }}>{sub}</span></div>
          </div>
        ))}
      </div>

      <div className="batch-strip" style={{ margin: '0 16px 16px', padding: '12px 16px', gap: 12, background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 12 }}>
        <div className="viewseg" style={{ borderRadius: 10, padding: 3 }} data-testid="appeal-filter">
          {[
            ['all', 'All denials'],
            ['denied', 'Denied'],
            ['appeal', 'Appealed'],
            ['won', 'Won'],
          ].map(([id, label]) => (
            <button key={id} className={statusF === id ? 'on' : ''} data-testid={`appeal-filter-${id}`} onClick={() => setStatusF(id)} style={{ borderRadius: 8, fontSize: 13 }}>{label}</button>
          ))}
        </div>
        <span className="muted" style={{ fontSize: 12, marginLeft: 8 }}>{filtered.length} denials</span>
      </div>

      <div style={{ padding: '0 16px 16px', display: 'flex', gap: 20, alignItems: 'flex-start' }}>
        <div className="panel" style={{ flex: 1, minWidth: 0, borderRadius: 14, overflow: 'hidden', border: '1px solid var(--line)' }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 12, background: 'var(--panel-2)' }}>
            <span style={{ width: 32, height: 32, borderRadius: 9, background: '#ef444414', color: '#ef4444', display: 'grid', placeItems: 'center' }}>{Icon.shield({ size: 16 })}</span>
            <div><b style={{ fontSize: 14 }}>Denials Queue</b><div className="muted" style={{ fontSize: 12 }}>{filtered.length} claims need attention</div></div>
          </div>
          <div className="py-tbl" data-testid="appeal-table" style={{ overflowX: 'auto' }}>
            <div className="py-thead" style={{ gridTemplateColumns: '1.2fr 1fr 100px 120px 1fr', background: 'var(--panel-2)', fontSize: 11, padding: '12px 16px' }}>
              <span>Client / Claim</span><span>Payer / Reason</span><span>Amount</span><span>Status</span><span>Actions</span>
            </div>
            {filtered.slice(0, 80).map((c) => {
              const cl = clients.find((x) => x.id === c.clientId)
              const isSel = selId === c.id
              return (
                <div key={c.id} className={`py-trow ${isSel ? 'on' : ''}`} data-testid={`appeal-row-${c.id}`} onClick={() => setSelId(c.id)} style={{ gridTemplateColumns: '1.2fr 1fr 100px 120px 1fr', minHeight: 56, padding: '12px 16px', cursor: 'pointer', background: isSel ? '#fef2f2' : undefined, borderLeft: `3px solid ${isSel ? '#ef4444' : 'transparent'}` }}>
                  <div className="py-cell"><div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><PersonAvatar p={cl} size={26} /><div><b style={{ fontSize: 13 }}>{cl?.name || c.clientId}</b><div style={{ fontSize: 11, color: 'var(--muted)' }}><span className="ln-code">{c.no}</span> · {c.dosFrom}</div></div></div></div>
                  <div className="py-cell"><div><div style={{ fontSize: 12 }}>{c.payer}</div><div style={{ fontSize: 11, color: '#b91c1c' }}>{c.denials?.[0]?.reason || c.denialReason || 'Denied'}</div></div></div>
                  <div className="py-cell"><b style={{ fontSize: 13, color: '#b91c1c' }}>{money(dueOf(c))}</b></div>
                  <div className="py-cell"><span className="pill" style={{ fontSize: 11, borderRadius: 20, padding: '3px 10px', background: c.appeal ? '#eff6ff' : '#fef2f2' }}>{c.appeal ? `Appealed ${c.appeal.date || ''}` : c.status}</span></div>
                  <div className="py-cell"><button className="btn btn-xs btn-primary" data-testid={`appeal-open-${c.id}`} onClick={(e) => { e.stopPropagation(); setSelId(c.id) }} style={{ borderRadius: 8 }}>Work</button></div>
                </div>
              )
            })}
            {!filtered.length && <div className="py-empty" style={{ padding: 48, textAlign: 'center' }} data-testid="appeal-empty"><b>No denials</b><div className="muted" style={{ fontSize: 12 }}>Denied claims will appear here for appeal.</div></div>}
            <div className="footer" style={{ padding: '12px 20px', display: 'flex', justifyContent: 'space-between', background: 'var(--panel-2)', borderTop: '1px solid var(--line)', fontSize: 12 }}><span>{filtered.length} denials</span><span>{money(filtered.reduce((s, c) => s + dueOf(c), 0))} at risk</span></div>
          </div>
        </div>

        <div className="panel" style={{ width: 460, flex: 'none', borderRadius: 14, overflow: 'hidden', border: '1px solid var(--line)', position: 'sticky', top: 64 }} data-testid="appeal-detail">
          {!sel ? (
            <div style={{ padding: 48, textAlign: 'center' }}><b style={{ fontSize: 14 }}>Select a denial</b><div className="muted" style={{ fontSize: 12, marginTop: 6 }}>Choose a claim from the queue to draft an appeal.</div></div>
          ) : (
            <>
              <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 12, background: 'var(--panel-2)' }}>
                <PersonAvatar p={selClient} size={32} />
                <div><b style={{ fontSize: 14 }}>{selClient?.name || sel.clientId}</b><div className="muted" style={{ fontSize: 12 }}><span className="ln-code">{sel.no}</span> · {sel.payer} · {money(dueOf(sel))}</div></div>
                <button className="btn btn-xs" onClick={() => setSelId(null)} style={{ marginLeft: 'auto', borderRadius: 8 }}>{Icon.x({ size: 10 })} Close</button>
              </div>
              <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, padding: '12px 14px' }}>
                  <b style={{ fontSize: 12, color: '#991b1b' }}>Denial reason</b><div style={{ fontSize: 13, marginTop: 4 }}>{sel.denials?.[0]?.reason || sel.denialReason || '—'} {sel.denials?.[0]?.code ? `(${sel.denials[0].code})` : ''}</div>
                </div>
                <label className="field"><span style={{ fontSize: 12, fontWeight: 700 }}>Template</span><select value={tplId} onChange={(e) => setTplId(e.target.value)} data-testid="appeal-template" style={{ fontSize: 13, borderRadius: 10, padding: '10px 12px' }}>{APPEAL_TEMPLATES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</select></label>
                <div style={{ background: 'var(--panel-2)', border: '1px solid var(--line)', borderRadius: 10, padding: '12px 14px', fontSize: 13, lineHeight: 1.5 }}>{tpl?.body}</div>
                <label className="field"><span style={{ fontSize: 12, fontWeight: 700 }}>Additional notes</span><textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder="Add clinical justification, auth numbers, dates..." data-testid="appeal-note" style={{ fontSize: 13, borderRadius: 10, padding: '10px 12px' }} /></label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn btn-sm btn-primary" data-testid="appeal-submit" onClick={() => { actions.fileAppeal(sel.id, { template: tplId, note, date: todayISO() }); toast({ message: `Appeal filed for ${sel.no}`, kind: 'ok' }); setNote('') }} style={{ borderRadius: 10 }}>File Appeal</button>
                  <button className="btn btn-sm" data-testid="appeal-mark-won" onClick={() => { actions.updateClaim(sel.id, { appeal: { ...(sel.appeal || {}), outcome: 'won', date: todayISO() }, status: 'paid' }); toast({ message: `${sel.no} marked won`, kind: 'ok' }) }} style={{ borderRadius: 10 }}>Mark Won</button>
                  <button className="btn btn-sm" data-testid="appeal-mark-lost" onClick={() => { actions.updateClaim(sel.id, { appeal: { ...(sel.appeal || {}), outcome: 'lost', date: todayISO() } }); toast({ message: `${sel.no} marked lost`, kind: 'ok' }) }} style={{ borderRadius: 10 }}>Mark Lost</button>
                </div>
                {sel.appeal && <div style={{ fontSize: 12, color: 'var(--muted)', background: 'var(--panel-2)', padding: '10px 12px', borderRadius: 10 }}>Last appeal: {sel.appeal.date} · {sel.appeal.template} · {sel.appeal.outcome || 'pending'}</div>}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
