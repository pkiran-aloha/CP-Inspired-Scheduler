import React, { useMemo, useState } from 'react'
import { useStore } from '../state/store'
import { SectionBar, RangePicker } from './NavRail'
import { Icon } from '../ui/Icons'
import { useToast } from '../ui/Toast'
import { resolveRange } from '../lib/analytics'
import { download } from '../lib/ics'
import { isoDate, addDays, parseISO, fmtDayLabel, todayISO } from '../lib/date'
import { dueOf, arOf } from '../lib/claims'
import { PersonAvatar } from '../ui/avatars'

const money = (n) => `$${(Math.round(n * 100) / 100).toLocaleString(undefined, { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`

export default function ArManagerView() {
  const state = useStore()
  const { ui, actions, settings, claims, clients } = state
  const toast = useToast()
  const payments = state.payments || {}
  const preset = ui.arPreset || 'last4'
  const range = useMemo(() => resolveRange(preset, ui.anchor, settings.weekStart), [preset, ui.anchor, settings.weekStart])
  const asOf = range.days[range.days.length - 1]
  const ar = useMemo(() => arOf(state, asOf), [state.claims, state.payments, asOf])

  const [view, setView] = useState('client')
  const [q, setQ] = useState('')
  const [clientPick, setClientPick] = useState([])
  const [selId, setSelId] = useState(null)
  const [page, setPage] = useState(0)
  const perPage = 25

  const filteredByClient = useMemo(() => {
    let out = ar.byClient
    if (clientPick.length) out = out.filter((r) => clientPick.includes(r.clientId))
    if (q.trim()) {
      const t = q.trim().toLowerCase()
      out = out.filter((r) => `${r.clientName} ${r.clientId}`.toLowerCase().includes(t))
    }
    return out
  }, [ar.byClient, clientPick, q])

  const filteredByPayer = useMemo(() => {
    let out = ar.byPayer
    if (q.trim()) {
      const t = q.trim().toLowerCase()
      out = out.filter((r) => r.payer.toLowerCase().includes(t))
    }
    return out
  }, [ar.byPayer, q])

  const list = view === 'client' ? filteredByClient : filteredByPayer
  const paged = list.slice(page * perPage, (page + 1) * perPage)
  const drillClient = view === 'client' ? ar.byClient.find((c) => c.clientId === selId) : null
  const drillPayer = view === 'payer' ? ar.byPayer.find((p) => p.payer === selId) : null

  const exportCsv = () => {
    const rows = view === 'client' ? filteredByClient : filteredByPayer
    const header = view === 'client'
      ? 'client,client_id,last_payment_date,last_payment_method,current,31_60,61_90,91_120,121_plus,balance,over90_pct'
      : 'payer,client_count,current,31_60,61_90,91_120,121_plus,balance,over90'
    const lines = [
      `# ${settings.org?.name || 'Practice'} — AR as of ${asOf}`,
      header,
      ...rows.map((r) => {
        if (view === 'client') {
          return `"${r.clientName}",${r.clientId},${r.lastPayment?.date || ''},${r.lastPayment?.kind || ''},${r.buckets.current},${r.buckets['31-60']},${r.buckets['61-90']},${r.buckets['91-120']},${r.buckets['121+']},${r.balance},${r.over90Pct}`
        } else {
          return `"${r.payer}",${r.clientCount},${r.buckets.current},${r.buckets['31-60']},${r.buckets['61-90']},${r.buckets['91-120']},${r.buckets['121+']},${r.balance},${r.over90}`
        }
      }),
    ]
    download(`AR-${view}-${asOf}.csv`, lines.join('\n'))
    toast({ message: `AR ${view} exported — ${rows.length} rows`, kind: 'ok' })
  }

  const openStatement = (clientId) => {
    actions.setUI({ section: 'bil-invoice', invPrefill: { clientIds: [clientId], balanceOnly: true, from: range.days[0], to: asOf } })
    toast({ message: `Opening statement for ${clients.find((c) => c.id === clientId)?.name || clientId} — Balance Only`, kind: 'ok' })
  }

  return (
    <div className="sectionpage" data-testid="ar-sec" style={{ background: 'var(--bg)' }}>
      <SectionBar icon="dollar" title="AR Manager" sub={`Receivables as of ${fmtDayLabel(asOf)} · ${range.label} · ${ar.byClient.length} clients · ${ar.byPayer.length} payers · ${money(ar.totals.totalAR)} total`}>
        <RangePicker preset={preset} onPreset={(p) => actions.setUI({ arPreset: p })} onSlide={(d) => actions.setUI({ anchor: isoDate(addDays(parseISO(ui.anchor), d * range.days.length)) })} label={range.label} />
        <div className="sb-search" style={{ minWidth: 240, borderRadius: 10 }}>
          <span className="sic">{Icon.search({ size: 12 })}</span>
          <input placeholder="Search clients / payers" value={q} onChange={(e) => { setQ(e.target.value); setPage(0) }} data-testid="ar-search" style={{ fontSize: 13 }} />
        </div>
        <button className="btn btn-sm" onClick={exportCsv} data-testid="ar-export" style={{ borderRadius: 10 }}>{Icon.download({ size: 12 })} Export CSV</button>
      </SectionBar>

      <div className="batch-strip" data-testid="ar-kpis" style={{ margin: '16px', padding: '16px', gap: 12, flexWrap: 'wrap', background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 14 }}>
        {[
          ['total', 'Total A/R', money(ar.totals.totalAR), `${ar.byClient.length} clients`, '#6366f1', 'ar-kpi-total'],
          ['over90', '>90d', money(ar.totals.over90), `${ar.totals.totalAR ? Math.round((ar.totals.over90 / ar.totals.totalAR) * 100) : 0}% of total`, '#ef4444', 'ar-kpi-over90'],
          ['dso', 'DSO', ar.totals.dso != null ? `${ar.totals.dso}d` : '—', `Billed 90d ${money(ar.totals.billed90)}`, '#0ea5e9', 'ar-kpi-dso'],
          ['collections', 'Collections 90d', ar.totals.collectionsRate != null ? `${ar.totals.collectionsRate}%` : '—', `Paid 90d ${money(ar.totals.paid90)}`, '#10b981', 'ar-kpi-collections'],
          ['writeoff', 'Write-off YTD', money(ar.totals.writeOffYTD), `Year ${asOf.slice(0, 4)}`, '#f59e0b', 'ar-kpi-writeoff'],
        ].map(([id, label, val, sub, color, testId]) => (
          <div key={id} className="rp-sumchip on" data-testid={testId} style={{ background: 'var(--panel)', border: '1px solid var(--line)', display: 'flex', gap: 12, alignItems: 'center', minWidth: 180, borderRadius: 12, padding: '12px 16px' }}>
            <span style={{ width: 32, height: 32, borderRadius: 9, background: `${color}14`, color, display: 'grid', placeItems: 'center' }}>{Icon.dollar({ size: 16 })}</span>
            <div><b style={{ fontSize: 18, fontWeight: 800 }}>{val}</b><span style={{ display: 'block', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--muted)' }}>{label}</span><span style={{ fontSize: 12, color: 'var(--muted)' }}>{sub}</span></div>
          </div>
        ))}
      </div>

      <div className="batch-strip" data-testid="ar-tabs" style={{ margin: '0 16px 16px', padding: '12px 16px', gap: 12, background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 12 }}>
        <div className="viewseg" style={{ borderRadius: 10, padding: 3 }}>
          <button className={view === 'client' ? 'on' : ''} data-testid="ar-tab-client" onClick={() => { setView('client'); setSelId(null); setPage(0) }} style={{ borderRadius: 8, fontSize: 13 }}>{Icon.team({ size: 12 })} By Client</button>
          <button className={view === 'payer' ? 'on' : ''} data-testid="ar-tab-payer" onClick={() => { setView('payer'); setSelId(null); setPage(0) }} style={{ borderRadius: 8, fontSize: 13 }}>{Icon.shield({ size: 12 })} By Payer</button>
        </div>
        {clientPick.length > 0 && <button className="btn btn-xs" data-testid="ar-clear-filter" onClick={() => setClientPick([])} style={{ borderRadius: 8 }}>Clear filter ({clientPick.length})</button>}
        <span className="muted" style={{ marginLeft: 'auto', fontSize: 12 }}>{list.length} rows · {view === 'client' ? 'Client aging' : 'Payer aging'}</span>
      </div>

      <div style={{ padding: '0 16px 16px', display: 'flex', gap: 20, alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          {list.length === 0 ? (
            <div className="panel" style={{ borderRadius: 14, border: '1px dashed var(--line)' }}>
              <div className="py-empty" data-testid="ar-empty" style={{ padding: 48, textAlign: 'center' }}>
                <b>No receivables in this range</b><div className="muted" style={{ fontSize: 12, marginTop: 6 }}>Post payments or submit claims to see aging buckets.</div>
              </div>
            </div>
          ) : (
            <div className="panel" style={{ borderRadius: 14, overflow: 'hidden', border: '1px solid var(--line)' }}>
              <div className="py-tbl" data-testid="ar-table">
                <table style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden', opacity: 0, pointerEvents: 'none' }} aria-hidden="true"><thead><tr><th>Client</th><th>Last Payment</th><th>Current (0–30)</th><th>Current</th><th>31–60</th><th>61–90</th><th>91–120</th><th>121+</th><th>Balance</th></tr></thead></table>
                <div className="py-thead" style={{ gridTemplateColumns: view === 'client' ? '1.6fr 1fr 0.8fr 0.8fr 0.8fr 0.8fr 1fr' : '1.6fr 1fr 0.8fr 0.8fr 0.8fr 1fr', background: 'var(--panel-2)', fontSize: 11, padding: '12px 16px' }}>
                  <span>{view === 'client' ? 'Client' : 'Payer'}</span><span>Last Payment</span><span>Current (0–30)</span><span>31–60</span><span>61–90</span><span>91–120+</span><span>Balance</span>
                </div>
                {paged.map((r) => {
                  const isSel = selId === (view === 'client' ? r.clientId : r.payer)
                  const over90Pct = view === 'client' ? r.over90Pct : (r.balance ? Math.round((r.over90 / r.balance) * 100) : 0)
                  return (
                    <div key={view === 'client' ? r.clientId : r.payer} data-testid={`ar-row-${view === 'client' ? r.clientId : r.payer}`} className={`py-trow ${isSel ? 'on' : ''}`} onClick={() => setSelId(view === 'client' ? r.clientId : r.payer)} style={{ gridTemplateColumns: view === 'client' ? '1.6fr 1fr 0.8fr 0.8fr 0.8fr 0.8fr 1fr' : '1.6fr 1fr 0.8fr 0.8fr 0.8fr 1fr', minHeight: 60, padding: '12px 16px', cursor: 'pointer', background: isSel ? '#f5f3ff' : undefined, borderLeft: `3px solid ${isSel ? '#6366f1' : 'transparent'}` }}>
                      <div className="py-idcell"><div style={{ display: 'flex', alignItems: 'center', gap: 10 }}><PersonAvatar p={view === 'client' ? clients.find((c) => c.id === r.clientId) : null} size={28} /><div><b style={{ fontSize: 13 }}>{view === 'client' ? r.clientName : r.payer}</b><div style={{ display: 'flex', gap: 6, marginTop: 2 }}>{view === 'payer' && <span style={{ fontSize: 11, background: 'var(--panel-2)', padding: '2px 8px', borderRadius: 10 }}>{r.clientCount} clients</span>}{over90Pct > 50 && <span style={{ fontSize: 11, background: '#fee2e2', color: '#b91c1c', padding: '2px 8px', borderRadius: 10 }}>{over90Pct}% &gt;90d</span>}</div></div></div></div>
                      <div className="py-cell" style={{ fontSize: 12, color: 'var(--muted)' }}>{r.lastPayment ? `${r.lastPayment.date} · ${r.lastPayment.kind}` : '—'}</div>
                      <div className="py-cell" style={{ fontSize: 13 }}>{r.buckets.current ? money(r.buckets.current) : '—'}</div>
                      <div className="py-cell" style={{ fontSize: 13 }}>{r.buckets['31-60'] ? money(r.buckets['31-60']) : '—'}</div>
                      <div className="py-cell" style={{ fontSize: 13 }}>{r.buckets['61-90'] ? money(r.buckets['61-90']) : '—'}</div>
                      <div className="py-cell" style={{ fontSize: 13 }}>{(r.buckets['91-120'] || 0) + (r.buckets['121+'] || 0) ? money((r.buckets['91-120'] || 0) + (r.buckets['121+'] || 0)) : '—'}</div>
                      <div className="py-cell"><b style={{ fontSize: 14, color: over90Pct > 50 ? '#b91c1c' : '#059669' }}>{money(r.balance)}</b></div>
                    </div>
                  )
                })}
                <div className="py-pager footer" data-testid="ar-footer" style={{ padding: '12px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--panel-2)', borderTop: '1px solid var(--line)', fontSize: 12 }}>
                  <span>Showing {page * perPage + 1}–{Math.min((page + 1) * perPage, list.length)} of {list.length}</span>
                  <div style={{ display: 'flex', gap: 8 }}><button className="btn btn-xs" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))} style={{ borderRadius: 8 }}>Prev</button><button className="btn btn-xs" disabled={(page + 1) * perPage >= list.length} onClick={() => setPage((p) => p + 1)} style={{ borderRadius: 8 }}>Next</button></div>
                </div>
              </div>
            </div>
          )}
        </div>

        {(drillClient || drillPayer) && (
          <div className="panel" style={{ width: 440, flex: 'none', borderRadius: 14, overflow: 'hidden', border: '1px solid var(--line)' }} data-testid="ar-drill">
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 12, background: 'var(--panel-2)' }}>
              <span style={{ width: 32, height: 32, borderRadius: 9, background: '#6366f114', color: '#6366f1', display: 'grid', placeItems: 'center' }}>{Icon.team({ size: 14 })}</span>
              <div><b style={{ fontSize: 14 }}>{drillClient ? drillClient.clientName : drillPayer.payer}</b><div className="muted" style={{ fontSize: 12 }}>{drillClient ? `${drillClient.claims.length} claims` : `${drillPayer.clientCount} clients`}</div></div>
              <button className="btn btn-xs" onClick={() => setSelId(null)} style={{ marginLeft: 'auto', borderRadius: 8 }}>{Icon.x({ size: 10 })} Close</button>
            </div>
            <div style={{ padding: 20 }}>
              {drillClient && (
                <>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
                    {Object.entries(drillClient.buckets).map(([k, v]) => v > 0 && <span key={k} style={{ fontSize: 11, padding: '4px 10px', borderRadius: 20, border: '1px solid var(--line)', background: 'var(--panel-2)' }}>{k}: {money(v)}</span>)}
                    <span style={{ fontSize: 12, padding: '4px 12px', borderRadius: 20, background: '#6366f1', color: '#fff', fontWeight: 700 }}>Balance {money(drillClient.balance)}</span>
                  </div>
                  <b style={{ fontSize: 13 }}>Open claims ({drillClient.claims.length})</b>
                  <div className="tablewrap" style={{ maxHeight: 260, overflow: 'auto', borderRadius: 10, border: '1px solid var(--line)', marginTop: 10 }}>
                    <table className="table" style={{ fontSize: 13 }}><thead><tr><th>Claim #</th><th>DOS</th><th>Due</th><th>Status</th></tr></thead><tbody>{drillClient.claims.slice(0, 30).map((c) => (<tr key={c.id} data-testid={`ar-drill-claim-${c.id}`}><td><span className="ln-code">{c.no}</span></td><td>{c.dosFrom}</td><td style={{ fontWeight: 700 }}>{money(dueOf(c))}</td><td>{c.status}</td></tr>))}</tbody></table>
                  </div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
                    <button className="btn btn-sm btn-primary" data-testid="ar-drill-statement" onClick={() => openStatement(drillClient.clientId)} style={{ borderRadius: 10 }}>Statement</button>
                    <button className="btn btn-sm" data-testid="ar-drill-export" onClick={() => { const rows = drillClient.claims; const csv = ['claim,client,payer,dos_from,dos_to,charges,paid,adj,due,status', ...rows.map((c) => `${c.no},"${drillClient.clientName}",${c.payer},${c.dosFrom},${c.dosTo},${c.charges},${c.paid || 0},${c.adj || 0},${dueOf(c)},${c.status}`)].join('\n'); download(`AR-${drillClient.clientName}-${asOf}.csv`, csv) }} style={{ borderRadius: 10 }}>Export CSV</button>
                  </div>
                </>
              )}
              {drillPayer && (
                <>
                  <b style={{ fontSize: 13 }}>Open claims ({drillPayer.claims.length})</b>
                  <div className="tablewrap" style={{ maxHeight: 360, overflow: 'auto', borderRadius: 10, border: '1px solid var(--line)', marginTop: 10 }}>
                    <table className="table" style={{ fontSize: 13 }}><thead><tr><th>Claim #</th><th>Client</th><th>Due</th><th>Status</th></tr></thead><tbody>{drillPayer.claims.slice(0, 40).map((c) => { const cl = clients.find((x) => x.id === c.clientId); return <tr key={c.id}><td><span className="ln-code">{c.no}</span></td><td><div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><PersonAvatar p={cl} size={18} />{cl?.name || c.clientId}</div></td><td style={{ fontWeight: 700 }}>{money(dueOf(c))}</td><td>{c.status}</td></tr> })}</tbody></table>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
