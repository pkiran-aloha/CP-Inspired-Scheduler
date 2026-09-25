import React, { useMemo, useState } from 'react'
import { useStore } from '../state/store'
import { SectionBar, RangePicker } from './NavRail'
import { Icon } from '../ui/Icons'
import { useToast } from '../ui/Toast'
import { resolveRange } from '../lib/analytics'
import { isoDate, addDays, parseISO, fmtDayLabel, todayISO } from '../lib/date'
import { dueOf, secondaryEligible } from '../lib/claims'
import { PersonAvatar } from '../ui/avatars'

const money = (n) => `$${(Math.round(n * 100) / 100).toLocaleString(undefined, { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`

export default function SecondaryBillingView() {
  const state = useStore()
  const { ui, actions, settings, claims, clients } = state
  const toast = useToast()
  const preset = ui.secPreset || 'last4'
  const range = useMemo(() => resolveRange(preset, ui.anchor, settings.weekStart), [preset, ui.anchor, settings.weekStart])
  const [q, setQ] = useState('')
  const [statusF, setStatusF] = useState('all')
  const [openSubmit, setOpenSubmit] = useState(null)

  const allClaims = useMemo(() => Object.values(claims), [claims])
  const readyPrimaries = useMemo(() => allClaims.filter((c) => secondaryEligible(state, c)), [allClaims, state])
  const secondaryClaims = useMemo(() => allClaims.filter((c) => c.method === 'secondary'), [allClaims])

  const queue = useMemo(() => {
    const rows = []
    for (const c of readyPrimaries) {
      const client = clients.find((x) => x.id === c.clientId) || {}
      const sec = client.secondary || {}
      const secPayer = (state.payers || []).find((p) => p.id === sec.payerId)
      rows.push({ kind: 'ready', claim: c, client, sec, secPayer })
    }
    for (const c of secondaryClaims) {
      const client = clients.find((x) => x.id === c.clientId) || {}
      rows.push({ kind: 'secondary', claim: c, client })
    }
    return rows
  }, [readyPrimaries, secondaryClaims, clients, state.payers])

  const filtered = useMemo(() => {
    let out = queue
    if (statusF !== 'all') out = out.filter((r) => (statusF === 'ready' ? r.kind === 'ready' : r.claim.status === statusF))
    if (q.trim()) {
      const t = q.trim().toLowerCase()
      out = out.filter((r) => `${r.claim.no} ${r.client.name} ${r.claim.payer}`.toLowerCase().includes(t))
    }
    return out
  }, [queue, statusF, q])

  const stats = {
    ready: readyPrimaries.length,
    submitted: allClaims.filter((c) => c.method === 'secondary' && c.status === 'submitted').length,
    paid: allClaims.filter((c) => c.method === 'secondary' && c.status === 'paid').length,
    denied: allClaims.filter((c) => c.method === 'secondary' && c.status === 'denied').length,
    totalRemaining: readyPrimaries.reduce((s, c) => s + dueOf(c), 0),
  }

  const handleRelease = (id) => { const r = actions.fileSecondaryClaim(id); toast({ message: r.msg, kind: r.ok ? 'ok' : 'warn' }) }
  const handleSkip = (id) => { const r = actions.skipSecondary(id); toast({ message: r.msg, kind: r.ok ? 'ok' : 'warn' }) }
  const handleSubmit = (id, method) => {
    const r = actions.submitSecondaryClaim(id, method)
    toast({ message: r.msg, kind: r.ok ? 'ok' : 'warn' })
    setOpenSubmit(null)
  }

  return (
    <div className="sectionpage" data-testid="sb-sec" style={{ background: 'var(--bg)' }}>
      <SectionBar icon="shield" title="Secondary Billing" sub={`🔗 COB · ${stats.ready} ready · ${stats.submitted} submitted · ${stats.paid} paid · ${money(stats.totalRemaining)} remaining · ${range.label}`}>
        <RangePicker preset={preset} onPreset={(p) => actions.setUI({ secPreset: p })} onSlide={(d) => actions.setUI({ anchor: isoDate(addDays(parseISO(ui.anchor), d * range.days.length)) })} label={range.label} />
        <div className="sb-search" style={{ minWidth: 220, borderRadius: 10 }}>
          <span className="sic">{Icon.search({ size: 12 })}</span>
          <input placeholder="🔍 Search claim, client, payer…" value={q} onChange={(e) => setQ(e.target.value)} data-testid="sb-search" />
        </div>
      </SectionBar>

      <div className="batch-strip" style={{ padding: '12px 16px', gap: 10, flexWrap: 'wrap', background: 'linear-gradient(135deg,var(--panel),var(--panel-2))', borderBottom: '1px solid var(--line)' }} data-testid="sb-kpis">
        {[
          ['Ready', stats.ready, '#6366f1', '🔗', 'sb-kpi-ready'],
          ['Submitted', stats.submitted, '#0ea5e9', '📤', 'sb-kpi-submitted'],
          ['Paid', stats.paid, '#10b981', '✅', 'sb-kpi-paid'],
          ['Denied', stats.denied, '#ef4444', '🚫', 'sb-kpi-denied'],
          ['Remaining', money(stats.totalRemaining), '#f59e0b', '💰', 'sb-kpi-remaining'],
        ].map(([label, val, color, ic, testId]) => (
          <span key={label} className="rp-sumchip on" data-testid={testId} style={{ background: 'var(--panel)', border: '1px solid var(--line)', display: 'flex', gap: 8, alignItems: 'center', borderRadius: 12, padding: '8px 14px', boxShadow: 'var(--shadow-1)' }}>
            <span style={{ width: 28, height: 28, borderRadius: 8, background: color, color: '#fff', display: 'grid', placeItems: 'center', fontSize: 12 }}>{ic}</span>
            <span><b style={{ fontSize: 13 }}>{val}</b><span style={{ display: 'block', fontSize: 10, color: 'var(--muted)' }}>{label}</span></span>
          </span>
        ))}
        <span className="muted" style={{ marginLeft: 'auto', fontSize: 11, background: 'var(--panel-2)', padding: '6px 12px', borderRadius: 20, display: 'flex', alignItems: 'center', gap: 6 }}>💡 Primary partial → secondary eligible · Box 18 = X · CH / Paper</span>
      </div>

      <div className="batch-strip" style={{ padding: '10px 16px', gap: 8, background: 'var(--panel)', borderBottom: '1px solid var(--line)' }}>
        <div className="viewseg" style={{ borderRadius: 12, padding: 3, background: 'var(--panel-2)', border: '1px solid var(--line)' }} data-testid="sb-status-tabs">
          {[
            ['all', 'All', '📋'],
            ['ready', 'Ready', '🔗'],
            ['submitted', 'Submitted', '📤'],
            ['paid', 'Paid', '✅'],
            ['denied', 'Denied', '🚫'],
          ].map(([id, label, ic]) => (
            <button key={id} className={statusF === id ? 'on' : ''} data-testid={`sb-filter-${id}`} onClick={() => setStatusF(id)} style={{ borderRadius: 8, display: 'flex', alignItems: 'center', gap: 4 }}>{ic} {label}</button>
          ))}
        </div>
        <span className="muted" style={{ fontSize: 11, marginLeft: 8 }}>🔗 {filtered.length} in queue · COB flow Primary → Secondary</span>
      </div>

      <div style={{ padding: 16 }}>
        <div className="panel" style={{ borderRadius: 16, overflow: 'hidden', boxShadow: 'var(--shadow-1)', border: '1px solid var(--line)' }}>
          <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 10, background: 'linear-gradient(135deg,#6366f111,#8b5cf611)' }}>
            <span style={{ width: 36, height: 36, borderRadius: 12, background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: '#fff', display: 'grid', placeItems: 'center' }}>{Icon.shield({ size: 16 })}</span>
            <div><b style={{ fontSize: 14, display: 'flex', alignItems: 'center', gap: 6 }}>🔗 Secondary Queue <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 20, background: '#6366f1', color: '#fff' }}>{filtered.length} rows</span></b><div className="muted" style={{ fontSize: 11 }}>Primary partially paid + client has secondary → file secondary claim with Box 18 X</div></div>
          </div>

          <div className="py-tbl" data-testid="sb-table" style={{ overflowX: 'auto' }}>
            <div className="py-thead" style={{ gridTemplateColumns: '1.2fr 1fr 1fr 1fr 0.9fr 0.8fr 0.8fr 1.1fr 1fr 0.9fr 1.4fr', background: 'var(--panel-2)', fontSize: 11, minWidth: 1100 }}><span>👤 Client</span><span>📄 Primary #</span><span>🏥 Primary Payer</span><span>🏥 Secondary Payer</span><span>💰 Primary Paid</span><span>💰 Remaining</span><span>📅 DOS</span><span>🔗 COB Info</span><span>🚦 Status</span><span>📊 Type</span><span>⚡ Actions</span></div>
            {filtered.slice(0, 100).map((r) => (
              <div key={r.claim.id} className="py-trow" data-testid={`sb-row-${r.claim.id}`} style={{ gridTemplateColumns: '1.2fr 1fr 1fr 1fr 0.9fr 0.8fr 0.8fr 1.1fr 1fr 0.9fr 1.4fr', fontSize: 11, minWidth: 1100 }}>
                <div className="py-idcell"><div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><PersonAvatar p={r.client} size={24} /><b style={{ fontSize: 11 }}>{r.client.name || r.client.id}</b></div></div>
                <div className="py-cell"><span className="ln-code" style={{ background: 'var(--panel-2)', padding: '2px 6px', borderRadius: 6 }}>📄 {r.claim.no}</span></div>
                <div className="py-cell"><span className="tag soft" style={{ borderRadius: 20, fontSize: 10 }}>🏥 {r.claim.payer}</span></div>
                <div className="py-cell"><span className="tag soft" style={{ borderRadius: 20, fontSize: 10, background: '#6366f111' }}>🔗 {r.secPayer?.name || r.sec?.payerId || (r.kind === 'secondary' ? r.claim.payer : '—')}</span></div>
                <div className="py-cell muted">💵 {money(r.claim.paid || 0)}</div>
                <div className="py-cell num"><b style={{ color: '#059669' }}>💰 {money(dueOf(r.claim))}</b></div>
                <div className="py-cell muted">📅 {r.claim.dosFrom}</div>
                <div className="py-cell muted" style={{ fontSize: 10 }}>{r.sec?.memberId ? `🆔 ${r.sec.memberId}` : '—'} {r.sec?.relation ? `· ${r.sec.relation}` : ''}</div>
                <div className="py-cell"><span className="pill" style={{ fontSize: 10, borderRadius: 20, background: r.claim.status === 'paid' ? '#ecfdf5' : r.claim.status === 'denied' ? '#fef2f2' : '#eff6ff', color: r.claim.status === 'paid' ? '#059669' : r.claim.status === 'denied' ? '#dc2626' : '#2563eb' }}>{r.claim.status === 'paid' ? '✅' : r.claim.status === 'denied' ? '🚫' : r.kind === 'ready' ? '🔗' : '📤'} {r.claim.status}</span></div>
                <div className="py-cell"><span className="tag" style={{ fontSize: 10, borderRadius: 20 }}>{r.kind === 'ready' ? '🔗 Ready' : '📤 Secondary'}</span></div>
                <div className="py-cell" style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {r.kind === 'ready' && (
                    <>
                      <button className="btn btn-xs btn-primary" data-testid={`sb-release-${r.claim.id}`} onClick={() => handleRelease(r.claim.id)} style={{ borderRadius: 8 }}>🔗 Release</button>
                      <button className="btn btn-xs" data-testid={`sb-skip-${r.claim.id}`} onClick={() => handleSkip(r.claim.id)} style={{ borderRadius: 8 }}>⏭️ Skip</button>
                      <div style={{ position: 'relative' }}>
                        <button className="btn btn-xs" data-testid={`sb-submit-${r.claim.id}`} onClick={() => setOpenSubmit(openSubmit === r.claim.id ? null : r.claim.id)} style={{ borderRadius: 8 }}>📤 Submit ▾</button>
                        {openSubmit === r.claim.id && (
                          <div style={{ position: 'absolute', top: '100%', right: 0, background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 10, padding: 6, zIndex: 10, boxShadow: 'var(--shadow-2)', display: 'flex', flexDirection: 'column', gap: 4, minWidth: 180 }}>
                            <button className="btn btn-xs" data-testid={`sb-submit-ch-${r.claim.id}`} onClick={() => handleSubmit(r.claim.id, 'ch')} style={{ borderRadius: 8, justifyContent: 'flex-start' }}>🏥 Clearinghouse (CH)</button>
                            <button className="btn btn-xs" data-testid={`sb-submit-paper-bg-${r.claim.id}`} onClick={() => handleSubmit(r.claim.id, 'paper_bg')} style={{ borderRadius: 8, justifyContent: 'flex-start' }}>📄 Paper with Background</button>
                            <button className="btn btn-xs" data-testid={`sb-submit-paper-nobg-${r.claim.id}`} onClick={() => handleSubmit(r.claim.id, 'paper_nobg')} style={{ borderRadius: 8, justifyContent: 'flex-start' }}>📃 Paper without BG</button>
                          </div>
                        )}
                      </div>
                    </>
                  )}
                  {r.kind === 'secondary' && <span className="muted" style={{ fontSize: 10 }}>🔗 {r.claim.no} {r.claim.secondary ? `→ ${r.claim.secondary}` : ''}</span>}
                </div>
              </div>
            ))}
            {!filtered.length && <div className="py-empty" style={{ padding: 40, textAlign: 'center' }} data-testid="sb-empty"><div style={{ width: 64, height: 64, borderRadius: 16, background: 'var(--panel-2)', display: 'grid', placeItems: 'center', margin: '0 auto 12px', fontSize: 28 }}>🔗</div><b>No secondary queue</b><div className="muted" style={{ fontSize: 11 }}>Partially-paid primaries with COB clients appear here</div></div>}
            <div className="footer" style={{ padding: '10px 16px', display: 'flex', justifyContent: 'space-between', background: 'var(--panel-2)', borderTop: '1px solid var(--line)', fontSize: 11 }}><span>🔗 {filtered.length} rows · Ready {stats.ready} · Submitted {stats.submitted}</span><span>💰 {money(stats.totalRemaining)} remaining · Box 18 = X</span></div>
          </div>
        </div>
      </div>
    </div>
  )
}
