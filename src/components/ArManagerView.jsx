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
  // AR as of = last day of range
  const asOf = range.days[range.days.length - 1]

  const ar = useMemo(() => arOf(state, asOf), [state.claims, state.payments, asOf])

  const [view, setView] = useState('client') // client | payer
  const [q, setQ] = useState('')
  const [clientPick, setClientPick] = useState([])
  const [selId, setSelId] = useState(null) // clientId or payer name for drill-in
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
    // open Generate Invoice pre-filled Balance Only
    actions.setUI({ section: 'bil-invoice', invPrefill: { clientIds: [clientId], balanceOnly: true, from: range.days[0], to: asOf } })
    toast({ message: `Opening statement for ${clients.find((c) => c.id === clientId)?.name || clientId} — Balance Only`, kind: 'ok' })
  }

  return (
    <div className="sectionpage" data-testid="ar-sec">
      <SectionBar icon="dollar" title="AR Manager" sub={`Receivables as of ${fmtDayLabel(asOf)} · ${range.label}`}>
        <RangePicker preset={preset} onPreset={(p) => actions.setUI({ arPreset: p })} onSlide={(d) => actions.setUI({ anchor: isoDate(addDays(parseISO(ui.anchor), d * range.days.length)) })} label={range.label} />
        <input className="input" placeholder="Search clients / payers…" value={q} onChange={(e) => { setQ(e.target.value); setPage(0) }} data-testid="ar-search" style={{ width: 200 }} />
        <button className="btn btn-sm" onClick={exportCsv} data-testid="ar-export" title="Export AR CSV">{Icon.download({ size: 13 })} Export</button>
      </SectionBar>

      {/* KPI strip */}
      <div className="bil-kpis" data-testid="ar-kpis" style={{ display: 'flex', gap: 12, padding: '12px 16px', flexWrap: 'wrap' }}>
        <div className="bil-kpi" data-testid="ar-kpi-total"><span>Total A/R</span><b>{money(ar.totals.totalAR)}</b><i>{ar.byClient.length} clients · {ar.byPayer.length} payers</i></div>
        <div className="bil-kpi warn" data-testid="ar-kpi-over90"><span>&gt;90d $</span><b>{money(ar.totals.over90)}</b><i>{ar.totals.totalAR ? Math.round((ar.totals.over90 / ar.totals.totalAR) * 100) : 0}% of total</i></div>
        <div className="bil-kpi" data-testid="ar-kpi-dso"><span>DSO</span><b>{ar.totals.dso != null ? `${ar.totals.dso}d` : '—'}</b><i>Billed 90d {money(ar.totals.billed90)}</i></div>
        <div className="bil-kpi" data-testid="ar-kpi-collections"><span>Collections rate (90d)</span><b>{ar.totals.collectionsRate != null ? `${ar.totals.collectionsRate}%` : '—'}</b><i>Paid 90d {money(ar.totals.paid90)}</i></div>
        <div className="bil-kpi" data-testid="ar-kpi-writeoff"><span>Write-off YTD</span><b>{money(ar.totals.writeOffYTD)}</b><i>Year {asOf.slice(0, 4)}</i></div>
      </div>

      <div className="tabs" data-testid="ar-tabs" style={{ padding: '0 16px' }}>
        <button className={`tab ${view === 'client' ? 'on' : ''}`} data-testid="ar-tab-client" onClick={() => { setView('client'); setSelId(null); setPage(0) }}>BY CLIENT</button>
        <button className={`tab ${view === 'payer' ? 'on' : ''}`} data-testid="ar-tab-payer" onClick={() => { setView('payer'); setSelId(null); setPage(0) }}>BY PAYER</button>
        {clientPick.length > 0 && <button className="btn btn-xs" data-testid="ar-clear-filter" onClick={() => setClientPick([])}>Clear client filter ({clientPick.length})</button>}
      </div>

      <div style={{ padding: 16, display: 'flex', gap: 16, alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          {list.length === 0 ? (
            <div className="empty" data-testid="ar-empty">
              <div style={{ fontSize: 32 }}>📊</div>
              <b>No receivables in this range</b>
              <span>Post payments or submit claims to see aging buckets.</span>
            </div>
          ) : (
            <>
              <div className="tablewrap" data-testid="ar-table">
                <table className="table">
                  <thead>
                    <tr>
                      {view === 'client' ? <th>Client</th> : <th>Payer</th>}
                      <th>Last Payment</th>
                      <th>Current (0–30)</th>
                      <th>31–60</th>
                      <th>61–90</th>
                      <th>91–120</th>
                      <th>121+</th>
                      <th>Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paged.map((r) => {
                      const isSel = selId === (view === 'client' ? r.clientId : r.payer)
                      const over90Pct = view === 'client' ? r.over90Pct : (r.balance ? Math.round((r.over90 / r.balance) * 100) : 0)
                      return (
                        <tr key={view === 'client' ? r.clientId : r.payer} data-testid={`ar-row-${view === 'client' ? r.clientId : r.payer}`} className={isSel ? 'on' : ''} onClick={() => setSelId(view === 'client' ? r.clientId : r.payer)} style={{ cursor: 'pointer', background: isSel ? 'var(--panel-2)' : undefined }}>
                          <td>
                            {view === 'client' ? r.clientName : r.payer}
                            {view === 'payer' && <span className="pill" style={{ marginLeft: 6 }}>{r.clientCount} clients</span>}
                            {over90Pct > 50 && <span className="pill" style={{ marginLeft: 6, background: '#fee2e2', color: '#b91c1c' }}>{over90Pct}% &gt;90d</span>}
                          </td>
                          <td>{r.lastPayment ? `${r.lastPayment.date} · ${r.lastPayment.kind}` : '—'}</td>
                          <td>{r.buckets.current ? money(r.buckets.current) : '—'}</td>
                          <td>{r.buckets['31-60'] ? money(r.buckets['31-60']) : '—'}</td>
                          <td>{r.buckets['61-90'] ? money(r.buckets['61-90']) : '—'}</td>
                          <td>{r.buckets['91-120'] ? money(r.buckets['91-120']) : '—'}</td>
                          <td>{r.buckets['121+'] ? money(r.buckets['121+']) : '—'}</td>
                          <td><b style={{ color: over90Pct > 50 ? '#b91c1c' : undefined }}>{money(r.balance)}</b></td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
                <div className="footer" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>Showing {page * perPage + 1}–{Math.min((page + 1) * perPage, list.length)} of {list.length} · Total {money(ar.totals.totalAR)} reconciles across views</span>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button className="btn btn-xs" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>Prev</button>
                    <button className="btn btn-xs" disabled={(page + 1) * perPage >= list.length} onClick={() => setPage((p) => p + 1)}>Next</button>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>

        {(drillClient || drillPayer) && (
          <div className="panel" style={{ width: 420, flex: 'none' }} data-testid="ar-drill">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3>{drillClient ? drillClient.clientName : drillPayer.payer}</h3>
              <button className="btn btn-xs" onClick={() => setSelId(null)}>Close</button>
            </div>
            {drillClient && (
              <>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>Last payment: {drillClient.lastPayment ? `${drillClient.lastPayment.date} · ${drillClient.lastPayment.kind} · ${drillClient.lastPayment.ref}` : '—'}</div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
                  {Object.entries(drillClient.buckets).map(([k, v]) => v > 0 && <span key={k} className="pill">{k}: {money(v)}</span>)}
                  <span className="pill" style={{ background: 'var(--panel-3)', fontWeight: 700 }}>Balance {money(drillClient.balance)}</span>
                </div>
                <h4 style={{ margin: '8px 0' }}>Open claims ({drillClient.claims.length})</h4>
                <div className="tablewrap" style={{ maxHeight: 260, overflow: 'auto' }}>
                  <table className="table">
                    <thead><tr><th>Claim #</th><th>DOS</th><th>Charges</th><th>Paid</th><th>Due</th><th>Status</th></tr></thead>
                    <tbody>
                      {drillClient.claims.slice(0, 30).map((c) => (
                        <tr key={c.id} data-testid={`ar-drill-claim-${c.id}`}>
                          <td>{c.no}</td><td>{c.dosFrom}</td><td>{money(c.charges)}</td><td>{money(c.paid || 0)}</td><td>{money(dueOf(c))}</td><td><span className="pill">{c.status}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <h4 style={{ margin: '12px 0 8px' }}>Payment history</h4>
                <div className="tablewrap" style={{ maxHeight: 200, overflow: 'auto' }}>
                  <table className="table">
                    <thead><tr><th>Date</th><th>Method</th><th>Ref</th><th>Amount</th></tr></thead>
                    <tbody>
                      {Object.values(payments).filter((p) => p.clientId === drillClient.clientId).sort((a, b) => b.createdAt - a.createdAt).slice(0, 20).map((p) => (
                        <tr key={p.id}><td>{p.date}</td><td>{p.kind}</td><td>{p.ref}</td><td>{money(p.amount)}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                  <button className="btn btn-sm btn-primary" data-testid="ar-drill-statement" onClick={() => openStatement(drillClient.clientId)}>Statement (Balance Only)</button>
                  <button className="btn btn-sm" data-testid="ar-drill-export" onClick={() => {
                    const rows = drillClient.claims
                    const csv = ['claim,client,payer,dos_from,dos_to,charges,paid,adj,due,status', ...rows.map((c) => `${c.no},"${drillClient.clientName}",${c.payer},${c.dosFrom},${c.dosTo},${c.charges},${c.paid || 0},${c.adj || 0},${dueOf(c)},${c.status}`)].join('\n')
                    download(`AR-${drillClient.clientName}-${asOf}.csv`, csv)
                  }}>Export CSV</button>
                </div>
              </>
            )}
            {drillPayer && (
              <>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
                  {Object.entries(drillPayer.buckets).map(([k, v]) => v > 0 && <span key={k} className="pill">{k}: {money(v)}</span>)}
                  <span className="pill" style={{ background: 'var(--panel-3)', fontWeight: 700 }}>Balance {money(drillPayer.balance)} · {drillPayer.clientCount} clients</span>
                </div>
                <h4>Open claims ({drillPayer.claims.length})</h4>
                <div className="tablewrap" style={{ maxHeight: 320, overflow: 'auto' }}>
                  <table className="table">
                    <thead><tr><th>Claim #</th><th>Client</th><th>DOS</th><th>Due</th><th>Status</th></tr></thead>
                    <tbody>
                      {drillPayer.claims.slice(0, 40).map((c) => {
                        const cl = clients.find((x) => x.id === c.clientId)
                        return <tr key={c.id}><td>{c.no}</td><td>{cl?.name || c.clientId}</td><td>{c.dosFrom}</td><td>{money(dueOf(c))}</td><td>{c.status}</td></tr>
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
