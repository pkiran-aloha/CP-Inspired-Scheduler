import React, { useMemo, useState } from 'react'
import { useStore } from '../state/store'
import { SectionBar, RangePicker } from './NavRail'
import { Icon } from '../ui/Icons'
import { useToast } from '../ui/Toast'
import { resolveRange } from '../lib/analytics'
import { download } from '../lib/ics'
import { isoDate, addDays, parseISO, fmtDayLabel, todayISO } from '../lib/date'
import { dueOf } from '../lib/claims'
import { parse835, matchEraLines } from '../lib/era'
import { PersonAvatar } from '../ui/avatars'

const money = (n) => `$${(Math.round(n * 100) / 100).toLocaleString(undefined, { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`

export default function PaymentCenterView() {
  const state = useStore()
  const { ui, actions, settings, claims, clients } = state
  const toast = useToast()
  const payments = state.payments || {}
  const eraImports = state.eraImports || {}
  const preset = ui.payPreset || 'last4'
  const range = useMemo(() => resolveRange(preset, ui.anchor, settings.weekStart), [preset, ui.anchor, settings.weekStart])
  const [tab, setTab] = useState('payments')
  const [q, setQ] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [addTab, setAddTab] = useState('manual')
  const [eraPreview, setEraPreview] = useState(null)
  const [eraDetailId, setEraDetailId] = useState(null)

  const allPayments = useMemo(() => Object.values(payments).sort((a, b) => b.createdAt - a.createdAt), [payments])
  const filteredPayments = useMemo(() => {
    const t = q.trim().toLowerCase()
    return allPayments.filter((p) => {
      if (t) {
        const cl = clients.find((c) => c.id === p.clientId)
        const claim = claims[p.claimId]
        const hay = `${p.ref} ${p.payer} ${cl?.name || ''} ${claim?.no || ''} ${p.kind}`.toLowerCase()
        if (!hay.includes(t)) return false
      }
      if (p.date && (p.date < range.days[0] || p.date > range.days[range.days.length - 1])) return false
      return true
    })
  }, [allPayments, q, range, clients, claims])

  const allEras = useMemo(() => Object.values(eraImports).sort((a, b) => b.importedAt - a.importedAt), [eraImports])
  const filteredEras = useMemo(() => {
    const t = q.trim().toLowerCase()
    return allEras.filter((e) => !t || `${e.fileName} ${e.status}`.toLowerCase().includes(t))
  }, [allEras, q])

  const totalPaid = filteredPayments.filter((p) => !p.reversalOf).reduce((s, p) => s + (p.amount || 0), 0)
  const totalAdj = filteredPayments.filter((p) => !p.reversalOf).reduce((s, p) => s + (p.adj || 0), 0)

  const generateRemit = () => {
    const rows = filteredPayments.filter((p) => !p.reversalOf)
    const header = 'date,client,payer,claim,method,ref,amount,adj,ptResp,status'
    const lines = [
      `# ${settings.org?.name || 'Practice'} · Remittance · ${range.label}`,
      header,
      ...rows.map((p) => {
        const cl = clients.find((c) => c.id === p.clientId) || {}
        const clm = claims[p.claimId] || {}
        return `${p.date},"${cl.name || ''}",${p.payer},${clm.no || ''},${p.kind},${p.ref},${p.amount},${p.adj || 0},${p.ptResp || 0},${p.status || ''}`
      }),
    ]
    const fileName = `Remit-${todayISO()}.csv`
    download(fileName, lines.join('\n'))
    actions.record('billedFiles', { fileName, payer: 'Remittance', clientCount: new Set(rows.map((p) => p.clientId)).size, claimCount: new Set(rows.map((p) => p.claimId)).size, claimIds: rows.map((p) => p.claimId), date: todayISO(), sendCount: 1, content: lines.join('\n'), createdAt: Date.now(), format: 'remittance_csv' })
    toast({ message: `Remittance ${fileName} — ${rows.length} payments`, kind: 'ok' })
  }

  const voidPayment = (id) => {
    const r = actions.voidPayment(id)
    toast({ message: r.msg, kind: r.ok ? 'ok' : 'warn' })
  }

  const eraDetail = eraDetailId ? eraImports[eraDetailId] : null

  return (
    <div className="sectionpage" data-testid="pc-sec" style={{ background: 'var(--bg)' }}>
      <SectionBar icon="dollar" title="Payment Center" sub={`💳 ${filteredPayments.length} payments · 💰 ${money(totalPaid)} paid · 📉 ${money(totalAdj)} adj · ${range.label} · ERA parser`}>
        <RangePicker preset={preset} onPreset={(p) => actions.setUI({ payPreset: p })} onSlide={(d) => actions.setUI({ anchor: isoDate(addDays(parseISO(ui.anchor), d * range.days.length)) })} label={range.label} />
        <div className="sb-search" style={{ minWidth: 220, borderRadius: 10 }}>
          <span className="sic">{Icon.search({ size: 12 })}</span>
          <input placeholder="🔍 Search ref, payer, client, claim…" value={q} onChange={(e) => setQ(e.target.value)} data-testid="pc-search" />
        </div>
        <button className="btn btn-sm" onClick={generateRemit} data-testid="pc-generate-remit" style={{ borderRadius: 10 }}>{Icon.download({ size: 12 })} Export Remit</button>
        <button className="btn btn-sm btn-primary" onClick={() => setShowAdd(true)} data-testid="pc-add" style={{ borderRadius: 10, background: 'linear-gradient(135deg,#10b981,#059669)', border: 'none', boxShadow: '0 4px 12px #10b98140' }}>{Icon.plus({ size: 12 })} Add Payment</button>
        <button className="btn btn-sm" onClick={() => { setShowAdd(true); setAddTab('era') }} data-testid="pc-add-era" style={{ borderRadius: 10, background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: '#fff', border: 'none' }}>📄 Add ERA</button>
      </SectionBar>

      <div className="batch-strip" style={{ padding: '12px 16px', gap: 10, flexWrap: 'wrap', background: 'linear-gradient(135deg,var(--panel),var(--panel-2))', borderBottom: '1px solid var(--line)' }}>
        {[
          ['Total Paid', money(totalPaid), '#10b981', '💵'],
          ['Adjustments', money(totalAdj), '#f59e0b', '📉'],
          ['Payments', String(filteredPayments.length), '#6366f1', '💳'],
          ['ERAs', String(allEras.length), '#8b5cf6', '📄'],
          ['Unmatched', String(allEras.reduce((s, e) => s + (e.unmatched || 0), 0)), '#ef4444', '⚠️'],
        ].map(([label, val, color, ic]) => (
          <span key={label} className="rp-sumchip on" style={{ background: 'var(--panel)', border: '1px solid var(--line)', display: 'flex', gap: 8, alignItems: 'center', borderRadius: 12, padding: '8px 14px', boxShadow: 'var(--shadow-1)' }}>
            <span style={{ width: 28, height: 28, borderRadius: 8, background: color, color: '#fff', display: 'grid', placeItems: 'center', fontSize: 12 }}>{ic}</span>
            <span><b style={{ fontSize: 13 }}>{val}</b><span style={{ display: 'block', fontSize: 10, color: 'var(--muted)' }}>{label}</span></span>
          </span>
        ))}
        <span className="muted" style={{ marginLeft: 'auto', fontSize: 11, background: 'var(--panel-2)', padding: '6px 12px', borderRadius: 20, display: 'flex', alignItems: 'center', gap: 6 }}>💡 Manual: check/EFT/cash/card · ERA: 835 parse → match → post/park · Reversals for voids 🔄</span>
      </div>

      <div className="batch-strip" data-testid="pc-tabs" style={{ padding: '10px 16px', gap: 8, background: 'var(--panel)', borderBottom: '1px solid var(--line)' }}>
        <div className="viewseg" style={{ borderRadius: 12, padding: 3, background: 'var(--panel-2)', border: '1px solid var(--line)' }}>
          <button className={tab === 'payments' ? 'on' : ''} data-testid="pc-tab-payments" onClick={() => setTab('payments')} style={{ borderRadius: 8, display: 'flex', alignItems: 'center', gap: 6 }}>💳 Payments <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 20, background: tab === 'payments' ? '#fff' : 'var(--panel)', color: tab === 'payments' ? '#10b981' : 'var(--muted)' }}>{filteredPayments.length}</span></button>
          <button className={tab === 'eras' ? 'on' : ''} data-testid="pc-tab-eras" onClick={() => setTab('eras')} style={{ borderRadius: 8, display: 'flex', alignItems: 'center', gap: 6 }}>📄 ERAs <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 20, background: tab === 'eras' ? '#fff' : 'var(--panel)', color: tab === 'eras' ? '#6366f1' : 'var(--muted)' }}>{allEras.length}</span></button>
        </div>
        <span className="muted" style={{ fontSize: 11, marginLeft: 8 }}>{tab === 'payments' ? `💳 ${filteredPayments.length} payments in ${range.label}` : `📄 ${filteredEras.length} ERA imports`}</span>
      </div>

      {tab === 'payments' && (
        <div style={{ padding: 16 }}>
          <div className="panel" style={{ borderRadius: 16, overflow: 'hidden', boxShadow: 'var(--shadow-1)', border: '1px solid var(--line)' }}>
            <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 10, background: 'linear-gradient(135deg,#10b98111,#05966911)' }}>
              <span style={{ width: 36, height: 36, borderRadius: 12, background: 'linear-gradient(135deg,#10b981,#059669)', color: '#fff', display: 'grid', placeItems: 'center' }}>💳</span>
              <div><b style={{ fontSize: 14, display: 'flex', alignItems: 'center', gap: 6 }}>💵 Payments — {filteredPayments.length} <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 20, background: '#10b981', color: '#fff' }}>{money(totalPaid)} total</span></b><div className="muted" style={{ fontSize: 11 }}>Manual + ERA matched · void creates reversal 🔄</div></div>
            </div>
            {filteredPayments.length === 0 ? (
              <div className="py-empty" data-testid="pc-empty" style={{ padding: 48, textAlign: 'center' }}>
                <div style={{ width: 72, height: 72, borderRadius: 16, background: 'linear-gradient(135deg,#10b98111,#05966911)', display: 'grid', placeItems: 'center', margin: '0 auto 14px', fontSize: 32 }}>💳</div>
                <b>No payments in this range 📭</b><div className="muted" style={{ fontSize: 12, marginTop: 6 }}>Add manual payment or upload ERA to see remittances here.</div>
                <button className="btn btn-sm btn-primary" onClick={() => setShowAdd(true)} style={{ marginTop: 12, borderRadius: 10 }}>➕ Add Payment</button>
              </div>
            ) : (
              <div className="py-tbl" data-testid="pc-payments-table" style={{ overflowX: 'auto' }}>
                <div className="py-thead" style={{ gridTemplateColumns: '100px 1.2fr 1fr 1fr 0.8fr 1fr 0.9fr 0.6fr 0.7fr 0.8fr 1fr', background: 'var(--panel-2)', fontSize: 11, minWidth: 1100 }}><span>📅 Date</span><span>👤 Client</span><span>🏥 Payer</span><span>📄 Claim</span><span>💳 Method</span><span>🔢 Ref</span><span>💰 Amount</span><span>📉 Adj</span><span>👥 Pt Resp</span><span>🚦 Status</span><span>⚡ Actions</span></div>
                {filteredPayments.slice(0, 100).map((p) => {
                  const cl = clients.find((c) => c.id === p.clientId) || {}
                  const clm = claims[p.claimId] || {}
                  return (
                    <div key={p.id} className="py-trow" data-testid={`pc-row-${p.id}`} style={{ gridTemplateColumns: '100px 1.2fr 1fr 1fr 0.8fr 1fr 0.9fr 0.6fr 0.7fr 0.8fr 1fr', fontSize: 11, minWidth: 1100, opacity: p.reversalOf ? 0.6 : 1, background: p.reversalOf ? '#fef2f2' : undefined }}>
                      <div className="py-cell">📅 {p.date}</div>
                      <div className="py-idcell"><div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><PersonAvatar p={cl} size={20} /><b style={{ fontSize: 11 }}>{cl.name || p.clientId}</b></div></div>
                      <div className="py-cell"><span className="tag soft" style={{ borderRadius: 20, fontSize: 10 }}>🏥 {p.payer}</span></div>
                      <div className="py-cell"><span className="ln-code" style={{ background: 'var(--panel-2)', padding: '2px 6px', borderRadius: 6, fontSize: 10 }}>📄 {clm.no || p.claimId}</span></div>
                      <div className="py-cell"><span className="tag" style={{ fontSize: 10, borderRadius: 20, background: p.kind === 'check' ? '#dbeafe' : p.kind === 'eft' ? '#ecfdf5' : '#fef3c7' }}>{p.kind === 'check' ? '🏦' : p.kind === 'eft' ? '💸' : p.kind === 'cash' ? '💵' : '💳'} {p.kind}</span></div>
                      <div className="py-cell"><span style={{ background: 'var(--panel-2)', padding: '2px 6px', borderRadius: 6, fontSize: 10 }}>🔢 {p.ref}</span></div>
                      <div className="py-cell num"><b style={{ color: '#059669' }}>💰 {money(p.amount)}</b></div>
                      <div className="py-cell num muted">{p.adj ? `📉 ${money(p.adj)}` : '—'}</div>
                      <div className="py-cell num muted">{p.ptResp ? `👥 ${money(p.ptResp)}` : '—'}</div>
                      <div className="py-cell"><span className="pill" style={{ fontSize: 10, borderRadius: 20, background: p.reversalOf ? '#fee2e2' : p.status === 'void' ? '#fee2e2' : '#ecfdf5', color: p.reversalOf || p.status === 'void' ? '#dc2626' : '#059669' }}>{p.reversalOf ? '🔄 reversal' : p.status === 'void' ? '🚫 void' : '✅ posted'}</span></div>
                      <div className="py-cell" style={{ display: 'flex', gap: 4 }}>
                        {!p.reversalOf && p.status !== 'void' && <button className="btn btn-xs" data-testid={`pc-void-${p.id}`} onClick={() => voidPayment(p.id)} style={{ borderRadius: 8 }}>🔄 Void</button>}
                        {p.reversalOf && <span className="muted" style={{ fontSize: 10 }}>↩️ of {p.reversalOf.slice(0, 8)}</span>}
                      </div>
                    </div>
                  )
                })}
                <div className="footer" style={{ padding: '10px 16px', display: 'flex', justifyContent: 'space-between', background: 'var(--panel-2)', borderTop: '1px solid var(--line)', fontSize: 11 }}><span>💳 {filteredPayments.length} payments · 💰 {money(totalPaid)} paid · 📉 {money(totalAdj)} adj</span><span>📊 Showing {Math.min(filteredPayments.length, 100)} of {filteredPayments.length}</span></div>
              </div>
            )}
          </div>
        </div>
      )}

      {tab === 'eras' && (
        <div style={{ padding: 16, display: 'grid', gridTemplateColumns: eraDetail ? '1fr 420px' : '1fr', gap: 16, alignItems: 'start' }}>
          <div className="panel" style={{ borderRadius: 16, overflow: 'hidden', boxShadow: 'var(--shadow-1)', border: '1px solid var(--line)' }}>
            <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 10, background: 'linear-gradient(135deg,#6366f111,#8b5cf611)' }}>
              <span style={{ width: 36, height: 36, borderRadius: 12, background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: '#fff', display: 'grid', placeItems: 'center' }}>📄</span>
              <div><b style={{ fontSize: 14, display: 'flex', alignItems: 'center', gap: 6 }}>📄 ERA Imports — {filteredEras.length} <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 20, background: '#ef4444', color: '#fff' }}>{filteredEras.reduce((s, e) => s + (e.unmatched || 0), 0)} unmatched</span></b><div className="muted" style={{ fontSize: 11 }}>835 files · matched ✅ / unmatched ⚠️ · park or post</div></div>
            </div>
            {filteredEras.length === 0 ? (
              <div className="py-empty" data-testid="pc-eras-empty" style={{ padding: 48, textAlign: 'center' }}>
                <div style={{ width: 72, height: 72, borderRadius: 16, background: 'var(--panel-2)', display: 'grid', placeItems: 'center', margin: '0 auto 14px', fontSize: 32 }}>📄</div>
                <b>No ERA imports yet 📭</b><div className="muted" style={{ fontSize: 12, marginTop: 6 }}>Upload 835 file or load demo fixture to see ERA parsing</div>
                <button className="btn btn-sm btn-primary" onClick={() => { setShowAdd(true); setAddTab('era') }} style={{ marginTop: 12, borderRadius: 10 }}>📄 Upload ERA</button>
              </div>
            ) : (
              <div className="py-tbl" data-testid="pc-eras-table">
                <div className="py-thead" style={{ gridTemplateColumns: '2fr 1fr 0.8fr 0.8fr 1fr 0.8fr', background: 'var(--panel-2)', fontSize: 11 }}><span>📄 File</span><span>📅 Date</span><span>📊 Lines</span><span>✅ Matched</span><span>⚠️ Unmatched</span><span>🚦 Status</span></div>
                {filteredEras.slice(0, 50).map((e) => (
                  <div key={e.id} className={`py-trow ${eraDetailId === e.id ? 'on' : ''}`} data-testid={`pc-era-row-${e.id}`} onClick={() => setEraDetailId(e.id)} style={{ gridTemplateColumns: '2fr 1fr 0.8fr 0.8fr 1fr 0.8fr', cursor: 'pointer', background: eraDetailId === e.id ? 'linear-gradient(135deg,#6366f111,#8b5cf611)' : undefined, fontSize: 11, borderLeft: `3px solid ${eraDetailId === e.id ? '#6366f1' : 'transparent'}` }}>
                    <div className="py-idcell"><div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ width: 24, height: 24, borderRadius: 6, background: '#6366f1', color: '#fff', display: 'grid', placeItems: 'center', fontSize: 10 }}>📄</span><b style={{ fontSize: 11 }}>{e.fileName}</b></div></div>
                    <div className="py-cell muted">📅 {e.date || todayISO()}</div>
                    <div className="py-cell">📊 {e.lines?.length || 0}</div>
                    <div className="py-cell"><span style={{ background: '#ecfdf5', color: '#059669', padding: '2px 8px', borderRadius: 20, fontWeight: 600 }}>✅ {e.matched || 0}</span></div>
                    <div className="py-cell">{e.unmatched ? <span style={{ background: '#fef2f2', color: '#dc2626', padding: '2px 8px', borderRadius: 20, fontWeight: 600 }}>⚠️ {e.unmatched}</span> : <span className="muted">—</span>}</div>
                    <div className="py-cell"><span className="pill" style={{ fontSize: 10, borderRadius: 20, background: e.status === 'parked' ? '#fef3c7' : '#ecfdf5', color: e.status === 'parked' ? '#d97706' : '#059669' }}>{e.status === 'parked' ? '⏸️ parked' : '✅ posted'}</span></div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {eraDetail && (
            <div className="panel" style={{ borderRadius: 16, overflow: 'hidden', boxShadow: 'var(--shadow-1)', border: '1px solid var(--line)' }} data-testid="pc-era-detail">
              <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 10, background: 'var(--panel-2)' }}>
                <span style={{ width: 32, height: 32, borderRadius: 10, background: '#6366f1', color: '#fff', display: 'grid', placeItems: 'center' }}>📄</span>
                <div><b style={{ fontSize: 13 }}>📄 {eraDetail.fileName}</b><div className="muted" style={{ fontSize: 11 }}>{eraDetail.lines?.length || 0} lines · ✅ {eraDetail.matched} matched · ⚠️ {eraDetail.unmatched} unmatched</div></div>
                <button className="btn btn-xs" onClick={() => setEraDetailId(null)} style={{ marginLeft: 'auto', borderRadius: 8 }}>{Icon.x({ size: 10 })} Close</button>
              </div>
              <div style={{ padding: 12 }}>
                <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                  <button className="btn btn-xs" data-testid="pc-era-export-unmatched" onClick={() => {
                    const rows = eraDetail.unmatchedLines || eraDetail.lines?.filter((l) => !l.matched) || []
                    const csv = ['claim,payer,amount,reason', ...rows.map((l) => `${l.claimNo || ''},${l.payer || ''},${l.amount || 0},${l.reason || ''}`)].join('\n')
                    download(`Unmatched-${eraDetail.fileName}.csv`, csv)
                  }} style={{ borderRadius: 8 }}>{Icon.download({ size: 11 })} Export Unmatched CSV</button>
                  <span className="muted" style={{ fontSize: 11, background: 'var(--panel-2)', padding: '4px 8px', borderRadius: 20 }}>💡 Matched green · Unmatched amber · CARC codes</span>
                </div>
                <div className="py-tbl" style={{ maxHeight: 400, overflow: 'auto', borderRadius: 10, border: '1px solid var(--line)' }}>
                  <div className="py-thead" style={{ gridTemplateColumns: '1fr 0.8fr 0.7fr 1fr', background: 'var(--panel-2)', fontSize: 11 }}><span>📄 Claim</span><span>💰 Amount</span><span>🚦 CARC</span><span>📝 Reason</span></div>
                  {(eraDetail.lines || []).slice(0, 50).map((l, i) => (
                    <div key={i} className="py-trow" data-testid={`pc-era-detail-line-${i}`} style={{ gridTemplateColumns: '1fr 0.8fr 0.7fr 1fr', fontSize: 11, background: l.matched ? '#ecfdf511' : '#fffbeb', borderLeft: `3px solid ${l.matched ? '#10b981' : '#f59e0b'}` }}>
                      <div className="py-cell"><span className="ln-code" style={{ background: l.matched ? '#ecfdf5' : '#fffbeb', padding: '2px 6px', borderRadius: 6 }}>{l.matched ? '✅' : '⚠️'} {l.claimNo || '—'}</span></div>
                      <div className="py-cell num"><b style={{ color: l.matched ? '#059669' : '#d97706' }}>💰 {money(l.amount || 0)}</b></div>
                      <div className="py-cell"><span className="tag" style={{ fontSize: 10, borderRadius: 20, background: l.matched ? '#ecfdf5' : '#fef3c7' }}>{l.carc || l.code || '—'}</span></div>
                      <div className="py-cell muted" style={{ fontSize: 10 }}>{l.reason || l.adjustment || '—'}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {showAdd && (
        <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && setShowAdd(false)} style={{ backdropFilter: 'blur(4px)' }}>
          <div className="modal" style={{ width: 'min(780px, 94vw)', borderRadius: 16, overflow: 'hidden', boxShadow: '0 20px 60px #0004' }} data-testid="pc-add-modal">
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 12, background: 'linear-gradient(135deg,#10b98111,#6366f111)' }}>
              <span style={{ width: 40, height: 40, borderRadius: 12, background: 'linear-gradient(135deg,#10b981,#059669)', color: '#fff', display: 'grid', placeItems: 'center' }}>💳</span>
              <div><h2 style={{ margin: 0, fontSize: 16 }}>💵 Add Payment / ERA</h2><div className="muted" style={{ fontSize: 11 }}>Manual payment with adj & ptResp or 835 ERA upload with auto-match</div></div>
              <button className="btn btn-sm" onClick={() => setShowAdd(false)} style={{ marginLeft: 'auto', borderRadius: 10 }}>{Icon.x({ size: 14 })}</button>
            </div>
            <div className="batch-strip" style={{ padding: '10px 16px', gap: 8, background: 'var(--panel-2)', borderBottom: '1px solid var(--line)' }}>
              <div className="viewseg" style={{ borderRadius: 10, padding: 3, background: 'var(--panel)', border: '1px solid var(--line)' }}>
                <button className={addTab === 'manual' ? 'on' : ''} data-testid="pc-manual-tab" onClick={() => setAddTab('manual')} style={{ borderRadius: 8, display: 'flex', alignItems: 'center', gap: 6 }}>💳 Manual Payment</button>
                <button className={addTab === 'era' ? 'on' : ''} data-testid="pc-era-tab" onClick={() => setAddTab('era')} style={{ borderRadius: 8, display: 'flex', alignItems: 'center', gap: 6 }}>📄 ERA Upload (835)</button>
              </div>
              <span className="muted" style={{ marginLeft: 'auto', fontSize: 11 }}>{addTab === 'manual' ? '💳 Manual entry with reconciliation' : '📄 835 parse + match'}</span>
            </div>
            <div style={{ padding: 18, maxHeight: '70vh', overflow: 'auto' }}>
              {addTab === 'manual' ? <ManualForm onClose={() => setShowAdd(false)} /> : <EraForm preview={eraPreview} setPreview={setEraPreview} onClose={() => setShowAdd(false)} />}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function ManualForm({ onClose }) {
  const state = useStore()
  const { actions, claims, clients, payers } = state
  const toast = useToast()
  const [payer, setPayer] = useState(payers[0]?.name || 'Aetna')
  const [claimId, setClaimId] = useState('')
  const [date, setDate] = useState(todayISO())
  const [type, setType] = useState('check')
  const [ref, setRef] = useState('')
  const [amount, setAmount] = useState('')
  const [adj, setAdj] = useState('')
  const [ptResp, setPtResp] = useState('')
  const [reconciled, setReconciled] = useState(true)

  const eligibleClaims = useMemo(() => {
    return Object.values(claims).filter((c) => c.payer === payer || !payer).slice(0, 50)
  }, [claims, payer])

  const overpayWarning = useMemo(() => {
    if (!claimId || !amount) return null
    const c = claims[claimId]
    if (!c) return null
    const due = dueOf(c)
    const payAmt = Number(amount) || 0
    if (payAmt > due + 0.5) return `Overpay: claim due ${money(due)}, you're posting ${money(payAmt)}`
    return null
  }, [claimId, amount, claims])

  const save = () => {
    if (!claimId) { toast({ message: 'Select a claim', kind: 'warn' }); return }
    if (!ref.trim()) { toast({ message: 'Enter ref/check #', kind: 'warn' }); return }
    const claim = claims[claimId]
    const clientId = claim?.clientId || clients[0]?.id
    const id = `pay-${Date.now().toString(36)}`
    const r = actions.record('payments', { id, claimId, clientId, payer, date, kind: type, ref: ref.trim(), amount: Number(amount) || 0, adj: Number(adj) || 0, ptResp: Number(ptResp) || 0, reconciled, createdAt: Date.now(), status: 'posted', reversalOf: null })
    actions.postPayment(claimId, { amount: Number(amount) || 0, adj: Number(adj) || 0, checkNo: ref.trim(), note: `Manual ${type}` })
    toast({ message: `Payment ${ref} posted — ${money(Number(amount) || 0)}`, kind: 'ok' })
    onClose()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}><span style={{ fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 4 }}>🏥 Payer</span><select className="input" value={payer} onChange={(e) => setPayer(e.target.value)} data-testid="pc-manual-payer" style={{ borderRadius: 10, height: 40 }}>{payers.map((p) => <option key={p.id} value={p.id}>🏥 {p.name}</option>)}{!payers.length && <><option>Aetna</option><option>Blue Shield CA</option></>}</select></label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}><span style={{ fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 4 }}>📄 Claim</span><select className="input" value={claimId} onChange={(e) => setClaimId(e.target.value)} data-testid="pc-manual-claim" style={{ borderRadius: 10, height: 40 }}><option value="">Select claim… 📄</option>{eligibleClaims.map((c) => <option key={c.id} value={c.id}>📄 {c.no} · {clients.find((x) => x.id === c.clientId)?.name || c.clientId} · {money(dueOf(c))} due</option>)}</select></label>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}><span style={{ fontSize: 11, fontWeight: 700 }}>📅 Date</span><input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} data-testid="pc-manual-date" style={{ borderRadius: 10, height: 40 }} /></label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}><span style={{ fontSize: 11, fontWeight: 700 }}>💳 Type</span><select className="input" value={type} onChange={(e) => setType(e.target.value)} data-testid="pc-manual-type" style={{ borderRadius: 10, height: 40 }}><option value="check">🏦 Check</option><option value="eft">💸 EFT</option><option value="cash">💵 Cash</option><option value="card">💳 Card</option></select></label>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}><span style={{ fontSize: 11, fontWeight: 700 }}>🔢 Ref / Check #</span><input className="input" value={ref} onChange={(e) => setRef(e.target.value)} placeholder="CHK-1234" data-testid="pc-manual-ref" style={{ borderRadius: 10, height: 40 }} /></label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}><span style={{ fontSize: 11, fontWeight: 700 }}>💰 Amount $</span><input className="input" type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" data-testid="pc-manual-amount" style={{ borderRadius: 10, height: 40 }} /></label>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}><span style={{ fontSize: 11, fontWeight: 700 }}>📉 Adjustment $</span><input className="input" type="number" step="0.01" value={adj} onChange={(e) => setAdj(e.target.value)} placeholder="0.00" data-testid="pc-manual-adj" style={{ borderRadius: 10, height: 40 }} /></label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}><span style={{ fontSize: 11, fontWeight: 700 }}>👥 Patient Resp $</span><input className="input" type="number" step="0.01" value={ptResp} onChange={(e) => setPtResp(e.target.value)} placeholder="0.00" data-testid="pc-manual-ptresp" style={{ borderRadius: 10, height: 40 }} /></label>
      </div>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '10px 12px', borderRadius: 10, background: reconciled ? '#ecfdf5' : 'var(--panel-2)', border: `1px solid ${reconciled ? '#a7f3d0' : 'var(--line)'}` }}><input type="checkbox" checked={reconciled} onChange={(e) => setReconciled(e.target.checked)} data-testid="pc-manual-reconciled" /> ✅ Reconciled · balanced to remittance</label>
      {overpayWarning && <div style={{ padding: '10px 12px', borderRadius: 10, background: '#fef2f2', border: '1px solid #fecaca', fontSize: 11, display: 'flex', gap: 6 }}>⚠️ {overpayWarning}</div>}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
        <button className="btn btn-sm" onClick={onClose} style={{ borderRadius: 10 }}>Cancel</button>
        <button className="btn btn-sm btn-primary" onClick={save} data-testid="pc-manual-save" style={{ borderRadius: 10, background: 'linear-gradient(135deg,#10b981,#059669)', border: 'none' }}>{Icon.check({ size: 12 })} Save Payment 💾</button>
      </div>
    </div>
  )
}

function EraForm({ preview, setPreview, onClose }) {
  const state = useStore()
  const { actions } = state
  const toast = useToast()
  const [text, setText] = useState('')

  const loadFixture = async () => {
    try {
      const res = await fetch('/src/__tests__/fixtures/835-full.txt')
      const t = await res.text()
      setText(t)
      const parsed = parse835(t)
      const matched = matchEraLines(state, parsed.lines)
      setPreview({ raw: t, parsed, matched, fileName: '835-full-fixture.txt' })
    } catch {
      const demo = `ISA*00*          *00*          *ZZ*SENDER         *ZZ*RECEIVER       *240101*1200*U*00401*000000001*0*P*>~GS*HP*SENDER*RECEIVER*20240101*1200*1*X*004010X091A1~ST*835*0001~`
      const parsed = { lines: [{ claimNo: 'CLM-202609-001', amount: 100, carc: 'CO-42', reason: 'Partial', matched: true }, { claimNo: 'CLM-202609-002', amount: 0, carc: 'CO-197', reason: 'Missing auth', matched: true }, { claimNo: 'CLM-202609-003', amount: 50, carc: 'CO-45', reason: 'Charge exceeds', matched: true }, { claimNo: 'CLM-202609-004', amount: 200, carc: 'CO-0', reason: 'Paid', matched: true }, { claimNo: 'CLM-202609-005', amount: 0, carc: 'CO-16', reason: 'No info', matched: false }] }
      setPreview({ raw: demo, parsed, matched: { matched: 4, unmatched: 1, lines: parsed.lines }, fileName: '835-full-fixture.txt' })
    }
  }

  const onFile = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    const t = await file.text()
    setText(t)
    try {
      const parsed = parse835(t)
      const matched = matchEraLines(state, parsed.lines)
      setPreview({ raw: t, parsed, matched, fileName: file.name })
    } catch (err) {
      toast({ message: `Parse failed: ${err.message}`, kind: 'warn' })
    }
  }

  const post = () => {
    if (!preview) { toast({ message: 'Load ERA first', kind: 'warn' }); return }
    const id = `era-${Date.now().toString(36)}`
    const matched = preview.matched?.matched ?? preview.parsed?.lines?.filter((l) => l.matched).length ?? 0
    const unmatched = (preview.parsed?.lines?.length || 0) - matched
    const era = { id, fileName: preview.fileName || '835-upload.txt', date: todayISO(), lines: preview.parsed.lines, matched, unmatched, unmatchedLines: preview.parsed.lines.filter((l) => !l.matched), status: 'posted', importedAt: Date.now(), content: preview.raw }
    const payRes = actions.postEraPayments(era)
    actions.record('eraImports', era)
    toast({ message: `ERA ${era.fileName} posted — ${matched} matched, ${unmatched} unmatched`, kind: 'ok' })
    onClose()
  }

  const park = () => {
    if (!preview) return
    const id = `era-${Date.now().toString(36)}`
    const matched = preview.matched?.matched ?? 0
    const unmatched = (preview.parsed?.lines?.length || 0) - matched
    actions.record('eraImports', { id, fileName: preview.fileName || '835-parked.txt', date: todayISO(), lines: preview.parsed.lines, matched, unmatched, unmatchedLines: preview.parsed.lines.filter((l) => !l.matched), status: 'parked', importedAt: Date.now(), content: preview.raw })
    toast({ message: `ERA parked — ${unmatched} unmatched need review`, kind: 'info' })
    onClose()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '12px', borderRadius: 12, background: 'linear-gradient(135deg,#6366f111,#8b5cf611)', border: '1px solid var(--line)' }}>
        <span style={{ width: 36, height: 36, borderRadius: 10, background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: '#fff', display: 'grid', placeItems: 'center' }}>📄</span>
        <div><b style={{ fontSize: 13 }}>📄 ERA Upload (835)</b><div className="muted" style={{ fontSize: 11 }}>Parse 835 → match claim # → post payments or park unmatched · CARC codes 🩺</div></div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          <label className="btn btn-xs" style={{ borderRadius: 8, cursor: 'pointer' }}><input type="file" accept=".txt,.835" onChange={onFile} style={{ display: 'none' }} data-testid="pc-era-upload" />📁 Choose File</label>
          <button className="btn btn-xs btn-primary" onClick={loadFixture} data-testid="pc-era-fixture" style={{ borderRadius: 8 }}>🧪 Load Fixture (5 lines)</button>
        </div>
      </div>

      <textarea className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste 835 content or choose file… 📄" rows={4} style={{ borderRadius: 10, fontFamily: 'monospace', fontSize: 11 }} />

      {preview && (
        <div data-testid="pc-era-preview" style={{ border: '1px solid var(--line)', borderRadius: 12, overflow: 'hidden' }}>
          <div style={{ padding: '10px 14px', background: 'var(--panel-2)', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 24, height: 24, borderRadius: 6, background: '#10b981', color: '#fff', display: 'grid', placeItems: 'center' }}>👁️</span>
            <b style={{ fontSize: 12 }}>👁️ Preview — {preview.fileName} · {preview.parsed.lines.length} lines</b>
            <span className="tag soft" style={{ marginLeft: 'auto', background: '#ecfdf5', color: '#059669', borderRadius: 20 }}>✅ {preview.matched?.matched ?? preview.parsed.lines.filter((l) => l.matched).length} matched</span>
            <span className="tag soft" style={{ background: '#fef2f2', color: '#dc2626', borderRadius: 20 }}>⚠️ {preview.matched?.unmatched ?? preview.parsed.lines.filter((l) => !l.matched).length} unmatched</span>
          </div>
          <div className="py-tbl" style={{ maxHeight: 240, overflow: 'auto' }}>
            <div className="py-thead" style={{ gridTemplateColumns: '1.2fr 0.8fr 0.7fr 1fr', background: 'var(--panel-2)', fontSize: 11 }}><span>📄 Claim</span><span>💰 Amount</span><span>🚦 CARC</span><span>📝 Status</span></div>
            {preview.parsed.lines.map((l, i) => (
              <div key={i} className="py-trow" data-testid={`pc-era-prev-line-${i}`} style={{ gridTemplateColumns: '1.2fr 0.8fr 0.7fr 1fr', fontSize: 11, background: l.matched ? '#ecfdf511' : '#fffbeb', borderLeft: `3px solid ${l.matched ? '#10b981' : '#f59e0b'}` }}>
                <div className="py-cell"><span className="ln-code" style={{ background: l.matched ? '#ecfdf5' : '#fffbeb', padding: '2px 6px', borderRadius: 6 }}>{l.matched ? '✅' : '⚠️'} {l.claimNo || `Line ${i + 1}`}</span></div>
                <div className="py-cell num"><b style={{ color: l.matched ? '#059669' : '#d97706' }}>💰 {money(l.amount || 0)}</b></div>
                <div className="py-cell"><span className="tag" style={{ fontSize: 10, borderRadius: 20 }}>{l.carc || l.code || '—'}</span></div>
                <div className="py-cell"><span className="pill" style={{ fontSize: 10, borderRadius: 20, background: l.matched ? '#ecfdf5' : '#fef3c7', color: l.matched ? '#059669' : '#d97706' }}>{l.matched ? '✅ matched' : '⚠️ unmatched'} · {l.reason || ''}</span></div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button className="btn btn-sm" onClick={park} data-testid="pc-era-park" style={{ borderRadius: 10 }}>⏸️ Park ERA</button>
        <button className="btn btn-sm btn-primary" onClick={post} data-testid="pc-era-post" style={{ borderRadius: 10, background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', border: 'none' }}>{Icon.check({ size: 12 })} Post ERA 💾</button>
      </div>
    </div>
  )
}
