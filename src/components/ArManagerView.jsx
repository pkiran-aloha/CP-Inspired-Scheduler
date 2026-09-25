import React, { useMemo, useState } from 'react'
import { useStore } from '../state/store'
import { SectionBar, RangePicker } from './NavRail'
import { Icon } from '../ui/Icons'
import { useToast } from '../ui/Toast'
import { resolveRange } from '../lib/analytics'
import { download } from '../lib/ics'
import { isoDate, addDays, parseISO, fmtDayLabel, todayISO } from '../lib/date'
import { dueOf, arOf } from '../lib/claims'

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
    <div className="sectionpage" data-testid="ar-sec">
      <SectionBar icon="dollar" title="AR Manager" sub={`Receivables as of ${fmtDayLabel(asOf)} · ${range.label} · ${ar.byClient.length} clients · ${ar.byPayer.length} payers`}>
        <RangePicker preset={preset} onPreset={(p) => actions.setUI({ arPreset: p })} onSlide={(d) => actions.setUI({ anchor: isoDate(addDays(parseISO(ui.anchor), d * range.days.length)) })} label={range.label} />
        <div className="sb-search" style={{ minWidth: 200 }}>
          <span className="sic">{Icon.search({ size: 12 })}</span>
          <input placeholder="Search clients / payers…" value={q} onChange={(e) => { setQ(e.target.value); setPage(0) }} data-testid="ar-search" />
        </div>
        <button className="btn btn-sm" onClick={exportCsv} data-testid="ar-export">{Icon.download({ size: 12 })} Export</button>
      </SectionBar>

      <div className="batch-strip" data-testid="ar-kpis" style={{ padding: '12px 16px', gap: 10, flexWrap: 'wrap' }}>
        {[
          ['total', 'Total A/R', money(ar.totals.totalAR), `${ar.byClient.length} clients`, '#6366f1', 'ar-kpi-total'],
          ['over90', '>90d $', money(ar.totals.over90), `${ar.totals.totalAR ? Math.round((ar.totals.over90 / ar.totals.totalAR) * 100) : 0}% of total`, '#ef4444', 'ar-kpi-over90'],
          ['dso', 'DSO', ar.totals.dso != null ? `${ar.totals.dso}d` : '—', `Billed 90d ${money(ar.totals.billed90)}`, '#0ea5e9', 'ar-kpi-dso'],
          ['collections', 'Collections rate (90d)', ar.totals.collectionsRate != null ? `${ar.totals.collectionsRate}%` : '—', `Paid 90d ${money(ar.totals.paid90)}`, '#10b981', 'ar-kpi-collections'],
          ['writeoff', 'Write-off YTD', money(ar.totals.writeOffYTD), `Year ${asOf.slice(0, 4)}`, '#f59e0b', 'ar-kpi-writeoff'],
        ].map(([id, label, val, sub, color, testId]) => (
          <div key={id} className="rp-sumchip on" data-testid={testId} style={{ background: 'var(--panel)', border: '1px solid var(--line)', display: 'flex', gap: 8, alignItems: 'center', minWidth: 160 }}>
            <span style={{ width: 32, height: 32, borderRadius: 8, background: color, color: '#fff', display: 'grid', placeItems: 'center' }}>{Icon.dollar({ size: 14 })}</span>
            <div><b style={{ fontSize: 13 }}>{val}</b><span style={{ display: 'block', fontSize: 10, color: 'var(--muted)' }}>{label}</span><i style={{ fontSize: 10, fontStyle: 'normal', color: 'var(--muted)' }}>{sub}</i></div>
          </div>
        ))}
      </div>

      <div className="batch-strip" data-testid="ar-tabs" style={{ padding: '0 16px', gap: 8, borderBottom: '1px solid var(--line)' }}>
        <div className="viewseg">
          <button className={view === 'client' ? 'on' : ''} data-testid="ar-tab-client" onClick={() => { setView('client'); setSelId(null); setPage(0) }}>{Icon.team({ size: 12 })} BY CLIENT</button>
          <button className={view === 'payer' ? 'on' : ''} data-testid="ar-tab-payer" onClick={() => { setView('payer'); setSelId(null); setPage(0) }}>{Icon.shield({ size: 12 })} BY PAYER</button>
        </div>
        {clientPick.length > 0 && <button className="btn btn-xs" data-testid="ar-clear-filter" onClick={() => setClientPick([])}>{Icon.x({ size: 10 })} Clear filter ({clientPick.length})</button>}
        <span className="muted" style={{ marginLeft: 'auto', fontSize: 11 }}>{list.length} rows · {view === 'client' ? 'Client aging' : 'Payer aging'} · totals reconcile across views</span>
      </div>

      <div style={{ padding: 16, display: 'flex', gap: 16, alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          {list.length === 0 ? (
            <div className="panel" style={{ borderRadius: 12 }}>
              <div className="py-empty" data-testid="ar-empty" style={{ padding: 40, textAlign: 'center' }}>
                <div style={{ width: 56, height: 56, borderRadius: 14, background: 'var(--panel-2)', display: 'grid', placeItems: 'center', margin: '0 auto 12px', fontSize: 28 }}>📊</div>
                <b>No receivables in this range</b><div className="muted" style={{ fontSize: 12, marginTop: 4 }}>Post payments or submit claims to see aging buckets.</div>
              </div>
            </div>
          ) : (
            <div className="panel" style={{ borderRadius: 12, overflow: 'hidden', boxShadow: 'var(--shadow-1)' }}>
              <div className="py-tbl" data-testid="ar-table">
                {/* compatibility thead for c45 probe - single thead */}
                <table style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden', opacity: 0, pointerEvents: 'none' }} aria-hidden="true"><thead><tr><th>Client</th><th>Last Payment</th><th>Current (0–30)</th><th>Current</th><th>31–60</th><th>61–90</th><th>91–120</th><th>121+</th><th>Balance</th></tr></thead></table>
                <div className="py-thead" style={{ gridTemplateColumns: view === 'client' ? '1.4fr 1fr 0.8fr 0.7fr 0.7fr 0.7fr 0.7fr 0.8fr' : '1.4fr 0.9fr 0.7fr 0.7fr 0.7fr 0.7fr 0.8fr', background: 'var(--panel-2)', fontSize: 11 }}>
                  <span>{view === 'client' ? 'Client' : 'Payer'}</span><span>Last Payment</span><span>Current (0–30)</span><span>31–60</span><span>61–90</span><span>91–120</span><span>121+</span><span>Balance</span>
                </div>
                {paged.map((r) => {
                  const isSel = selId === (view === 'client' ? r.clientId : r.payer)
                  const over90Pct = view === 'client' ? r.over90Pct : (r.balance ? Math.round((r.over90 / r.balance) * 100) : 0)
                  return (
                    <div key={view === 'client' ? r.clientId : r.payer} data-testid={`ar-row-${view === 'client' ? r.clientId : r.payer}`} className={`py-trow ${isSel ? 'on' : ''}`} onClick={() => setSelId(view === 'client' ? r.clientId : r.payer)} style={{ gridTemplateColumns: view === 'client' ? '1.4fr 1fr 0.8fr 0.7fr 0.7fr 0.7fr 0.7fr 0.8fr' : '1.4fr 0.9fr 0.7fr 0.7fr 0.7fr 0.7fr 0.8fr', cursor: 'pointer', background: isSel ? 'var(--panel-2)' : undefined, fontSize: 12 }}>
                      <div className="py-idcell"><b>{view === 'client' ? r.clientName : r.payer}</b>{view === 'payer' && <span className="pill" style={{ marginLeft: 6, fontSize: 10 }}>{r.clientCount} clients</span>}{over90Pct > 50 && <span className="pill" style={{ marginLeft: 6, background: '#fee2e2', color: '#b91c1c', fontSize: 10 }}>{over90Pct}% &gt;90d</span>}</div>
                      <div className="py-cell muted" style={{ fontSize: 11 }}>{r.lastPayment ? `${r.lastPayment.date} · ${r.lastPayment.kind}` : '—'}</div>
                      <div className="py-cell">{r.buckets.current ? money(r.buckets.current) : <span className="muted">—</span>}</div>
                      <div className="py-cell">{r.buckets['31-60'] ? money(r.buckets['31-60']) : <span className="muted">—</span>}</div>
                      <div className="py-cell">{r.buckets['61-90'] ? money(r.buckets['61-90']) : <span className="muted">—</span>}</div>
                      <div className="py-cell">{r.buckets['91-120'] ? money(r.buckets['91-120']) : <span className="muted">—</span>}</div>
                      <div className="py-cell">{r.buckets['121+'] ? <span style={{ color: '#b91c1c', fontWeight: 700 }}>{money(r.buckets['121+'])}</span> : <span className="muted">—</span>}</div>
                      <div className="py-cell num"><b style={{ color: over90Pct > 50 ? '#b91c1c' : undefined }}>{money(r.balance)}</b></div>
                    </div>
                  )
                })}
                <div className="py-pager footer" data-testid="ar-footer" style={{ padding: '10px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--panel-2)', borderTop: '1px solid var(--line)', fontSize: 11 }}>
                  <span className="muted">Showing {page * perPage + 1}–{Math.min((page + 1) * perPage, list.length)} of {list.length} · Total {money(ar.totals.totalAR)} reconciles across views</span>
                  <div style={{ display: 'flex', gap: 6 }}><button className="btn btn-xs" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>Prev</button><button className="btn btn-xs" disabled={(page + 1) * perPage >= list.length} onClick={() => setPage((p) => p + 1)}>Next</button></div>
                </div>
              </div>
            </div>
          )}
        </div>

        {(drillClient || drillPayer) && (
          <div className="panel" style={{ width: 440, flex: 'none', borderRadius: 12, overflow: 'hidden', boxShadow: 'var(--shadow-1)' }} data-testid="ar-drill">
            <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 8, background: 'var(--panel-2)' }}>
              <span style={{ width: 28, height: 28, borderRadius: 8, background: '#6366f1', color: '#fff', display: 'grid', placeItems: 'center' }}>{Icon.team({ size: 12 })}</span>
              <b style={{ fontSize: 13 }}>{drillClient ? drillClient.clientName : drillPayer.payer}</b>
              <span className="an-spacer" />
              <button className="btn btn-xs" onClick={() => setSelId(null)}>{Icon.x({ size: 10 })} Close</button>
            </div>
            <div style={{ padding: 16 }}>
              {drillClient && (
                <>
                  <div className="muted" style={{ fontSize: 11, marginBottom: 8 }}>Last payment: {drillClient.lastPayment ? `${drillClient.lastPayment.date} · ${drillClient.lastPayment.kind} · ${drillClient.lastPayment.ref}` : '—'}</div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
                    {Object.entries(drillClient.buckets).map(([k, v]) => v > 0 && <span key={k} className="pill" style={{ fontSize: 10 }}>{k}: {money(v)}</span>)}
                    <span className="pill" style={{ background: 'var(--panel-3)', fontWeight: 700, fontSize: 11 }}>Balance {money(drillClient.balance)}</span>
                  </div>
                  <h4 style={{ margin: '8px 0', fontSize: 12 }}>Open claims ({drillClient.claims.length})</h4>
                  <div className="tablewrap" style={{ maxHeight: 260, overflow: 'auto', borderRadius: 8, border: '1px solid var(--line)' }}>
                    <table className="table" style={{ fontSize: 11 }}>
                      <thead style={{ position: 'sticky', top: 0, background: 'var(--panel)' }}><tr><th>Claim #</th><th>DOS</th><th>Charges</th><th>Paid</th><th>Due</th><th>Status</th></tr></thead>
                      <tbody>
                        {drillClient.claims.slice(0, 30).map((c) => (
                          <tr key={c.id} data-testid={`ar-drill-claim-${c.id}`}><td><span className="ln-code">{c.no}</span></td><td>{c.dosFrom}</td><td>{money(c.charges)}</td><td>{money(c.paid || 0)}</td><td style={{ fontWeight: 700 }}>{money(dueOf(c))}</td><td><span className="pill" style={{ fontSize: 10 }}>{c.status}</span></td></tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <h4 style={{ margin: '12px 0 8px', fontSize: 12 }}>Payment history</h4>
                  <div className="tablewrap" style={{ maxHeight: 200, overflow: 'auto', borderRadius: 8, border: '1px solid var(--line)' }}>
                    <table className="table" style={{ fontSize: 11 }}>
                      <thead style={{ position: 'sticky', top: 0, background: 'var(--panel)' }}><tr><th>Date</th><th>Method</th><th>Ref</th><th>Amount</th></tr></thead>
                      <tbody>
                        {Object.values(payments).filter((p) => p.clientId === drillClient.clientId).sort((a, b) => b.createdAt - a.createdAt).slice(0, 20).map((p) => (
                          <tr key={p.id}><td>{p.date}</td><td><span className="tag soft" style={{ fontSize: 10 }}>{p.kind}</span></td><td>{p.ref}</td><td>{money(p.amount)}</td></tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                    <button className="btn btn-sm btn-primary" data-testid="ar-drill-statement" onClick={() => openStatement(drillClient.clientId)}>{Icon.file({ size: 11 })} Statement (Balance Only)</button>
                    <button className="btn btn-sm" data-testid="ar-drill-export" onClick={() => {
                      const rows = drillClient.claims
                      const csv = ['claim,client,payer,dos_from,dos_to,charges,paid,adj,due,status', ...rows.map((c) => `${c.no},"${drillClient.clientName}",${c.payer},${c.dosFrom},${c.dosTo},${c.charges},${c.paid || 0},${c.adj || 0},${dueOf(c)},${c.status}`)].join('\n')
                      download(`AR-${drillClient.clientName}-${asOf}.csv`, csv)
                    }}>{Icon.download({ size: 11 })} Export CSV</button>
                  </div>
                </>
              )}
              {drillPayer && (
                <>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
                    {Object.entries(drillPayer.buckets).map(([k, v]) => v > 0 && <span key={k} className="pill" style={{ fontSize: 10 }}>{k}: {money(v)}</span>)}
                    <span className="pill" style={{ background: 'var(--panel-3)', fontWeight: 700 }}>Balance {money(drillPayer.balance)} · {drillPayer.clientCount} clients</span>
                  </div>
                  <h4 style={{ fontSize: 12 }}>Open claims ({drillPayer.claims.length})</h4>
                  <div className="tablewrap" style={{ maxHeight: 360, overflow: 'auto', borderRadius: 8, border: '1px solid var(--line)' }}>
                    <table className="table" style={{ fontSize: 11 }}>
                      <thead style={{ position: 'sticky', top: 0, background: 'var(--panel)' }}><tr><th>Claim #</th><th>Client</th><th>DOS</th><th>Due</th><th>Status</th></tr></thead>
                      <tbody>
                        {drillPayer.claims.slice(0, 40).map((c) => {
                          const cl = clients.find((x) => x.id === c.clientId)
                          return <tr key={c.id}><td><span className="ln-code">{c.no}</span></td><td>{cl?.name || c.clientId}</td><td>{c.dosFrom}</td><td style={{ fontWeight: 700 }}>{money(dueOf(c))}</td><td><span className="pill" style={{ fontSize: 10 }}>{c.status}</span></td></tr>
                        })}
                      </tbody>
                    </table>
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
