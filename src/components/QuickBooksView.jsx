import React, { useMemo, useState } from 'react'
import { useStore } from '../state/store'
import { SectionBar, RangePicker } from './NavRail'
import { Icon } from '../ui/Icons'
import { useToast } from '../ui/Toast'
import { resolveRange } from '../lib/analytics'
import { isoDate, addDays, parseISO, fmtDayLabel } from '../lib/date'
import { dueOf } from '../lib/claims'

const money = (n) => `$${(Math.round(n * 100) / 100).toLocaleString(undefined, { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`

export default function QuickBooksView() {
  const state = useStore()
  const { ui, actions, settings, claims, clients } = state
  const toast = useToast()
  const preset = ui.qboPreset || 'last4'
  const range = useMemo(() => resolveRange(preset, ui.anchor, settings.weekStart), [preset, ui.anchor, settings.weekStart])
  const [q, setQ] = useState('')
  const [statusF, setStatusF] = useState('all')

  const qboItems = useMemo(() => (state.qbo || []), [state.qbo])
  const filtered = useMemo(() => {
    let out = qboItems
    if (statusF !== 'all') out = out.filter((r) => r.status === statusF)
    if (q.trim()) {
      const t = q.trim().toLowerCase()
      out = out.filter((r) => `${r.clientName} ${r.invoiceNo} ${r.id}`.toLowerCase().includes(t))
    }
    return out
  }, [qboItems, statusF, q])

  const kpis = {
    total: qboItems.length,
    pending: qboItems.filter((r) => r.status === 'pending').length,
    synced: qboItems.filter((r) => r.status === 'synced').length,
    failed: qboItems.filter((r) => r.status === 'failed').length,
    amount: qboItems.reduce((s, r) => s + (r.amount || 0), 0),
  }

  const syncAll = () => {
    const pend = qboItems.filter((r) => r.status === 'pending')
    for (const r of pend) actions.updateQbo(r.id, { status: 'synced', syncedAt: new Date().toISOString() })
    toast({ message: `Synced ${pend.length} invoices to QuickBooks`, kind: 'ok' })
  }

  return (
    <div className="sectionpage" data-testid="qbo-sec" style={{ background: 'var(--bg)' }}>
      <SectionBar icon="file" title="QuickBooks" sub={`${range.label} · ${kpis.total} invoices · ${kpis.synced} synced · ${kpis.pending} pending · ${money(kpis.amount)}`}>
        <RangePicker preset={preset} onPreset={(p) => actions.setUI({ qboPreset: p })} onSlide={(d) => actions.setUI({ anchor: isoDate(addDays(parseISO(ui.anchor), d * range.days.length)) })} label={range.label} />
        <div className="sb-search" style={{ minWidth: 220, borderRadius: 10 }}>
          <span className="sic">{Icon.search({ size: 12 })}</span>
          <input placeholder="Search client, invoice" value={q} onChange={(e) => setQ(e.target.value)} data-testid="qbo-search" style={{ fontSize: 13 }} />
        </div>
        <button className="btn btn-sm btn-primary" data-testid="qbo-sync-all" onClick={syncAll} style={{ borderRadius: 10, background: '#2ca01c' }}>Sync Pending</button>
      </SectionBar>

      <div className="batch-strip" data-testid="qbo-kpis" style={{ margin: '16px', padding: '16px', gap: 12, flexWrap: 'wrap', background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 14 }}>
        {[
          ['Total', kpis.total, `${money(kpis.amount)}`, '#2ca01c', 'qbo-kpi-total'],
          ['Synced', kpis.synced, 'In QBO', '#10b981', 'qbo-kpi-synced'],
          ['Pending', kpis.pending, 'To sync', '#f59e0b', 'qbo-kpi-pending'],
          ['Failed', kpis.failed, 'Needs fix', '#ef4444', 'qbo-kpi-failed'],
        ].map(([label, val, sub, color, testId]) => (
          <div key={label} className="rp-sumchip on" data-testid={testId} style={{ background: 'var(--panel)', border: '1px solid var(--line)', display: 'flex', gap: 12, alignItems: 'center', minWidth: 140, borderRadius: 12, padding: '12px 16px' }}>
            <span style={{ width: 32, height: 32, borderRadius: 9, background: `${color}14`, color, display: 'grid', placeItems: 'center' }}>{Icon.file({ size: 14 })}</span>
            <div><b style={{ fontSize: 18, fontWeight: 800 }}>{val}</b><span style={{ display: 'block', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--muted)' }}>{label}</span><span style={{ fontSize: 12, color: 'var(--muted)' }}>{sub}</span></div>
          </div>
        ))}
        <span className="muted" style={{ marginLeft: 'auto', fontSize: 12, background: 'var(--panel-2)', padding: '8px 14px', borderRadius: 20, border: '1px solid var(--line)' }}>Connected · {settings.qbo?.company || 'Demo Company'}</span>
      </div>

      <div className="batch-strip" style={{ margin: '0 16px 16px', padding: '12px 16px', gap: 12, background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 12 }}>
        <div className="viewseg" style={{ borderRadius: 10, padding: 3 }} data-testid="qbo-status-tabs">
          {[
            ['all', 'All'],
            ['pending', 'Pending'],
            ['synced', 'Synced'],
            ['failed', 'Failed'],
          ].map(([id, label]) => (
            <button key={id} className={statusF === id ? 'on' : ''} data-testid={`qbo-status-${id}`} onClick={() => setStatusF(id)} style={{ borderRadius: 8, fontSize: 13 }}>{label}</button>
          ))}
        </div>
        <span className="muted" style={{ fontSize: 12, marginLeft: 8 }}>{filtered.length} invoices</span>
      </div>

      <div style={{ padding: '0 16px 16px' }}>
        <div className="panel" style={{ borderRadius: 14, overflow: 'hidden', border: '1px solid var(--line)' }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 12, background: 'var(--panel-2)' }}>
            <span style={{ width: 32, height: 32, borderRadius: 9, background: '#2ca01c14', color: '#2ca01c', display: 'grid', placeItems: 'center' }}>{Icon.file({ size: 16 })}</span>
            <div><b style={{ fontSize: 14 }}>QuickBooks Invoices</b><div className="muted" style={{ fontSize: 12 }}>{filtered.length} invoices · sync to accounting</div></div>
          </div>
          <div className="py-tbl" data-testid="qbo-table" style={{ overflowX: 'auto' }}>
            <div className="py-thead" style={{ gridTemplateColumns: '120px 1.4fr 120px 100px 100px 1fr', background: 'var(--panel-2)', fontSize: 11, padding: '12px 16px' }}>
              <span>Invoice #</span><span>Client</span><span>Amount</span><span>Status</span><span>Synced</span><span>Actions</span>
            </div>
            {filtered.slice(0, 100).map((r) => (
              <div key={r.id} className="py-trow" data-testid={`qbo-row-${r.id}`} style={{ gridTemplateColumns: '120px 1.4fr 120px 100px 100px 1fr', minHeight: 52, padding: '10px 16px' }}>
                <div className="py-cell"><span className="ln-code" style={{ fontSize: 12 }}>{r.invoiceNo || r.id.slice(0, 8)}</span></div>
                <div className="py-cell"><b style={{ fontSize: 13 }}>{r.clientName}</b><div style={{ fontSize: 11, color: 'var(--muted)' }}>{r.clientId}</div></div>
                <div className="py-cell"><b style={{ fontSize: 13 }}>{money(r.amount || 0)}</b></div>
                <div className="py-cell"><span className="pill" style={{ fontSize: 11, borderRadius: 20, padding: '3px 10px', background: r.status === 'synced' ? '#ecfdf5' : r.status === 'failed' ? '#fef2f2' : '#fef9c3' }}>{r.status}</span></div>
                <div className="py-cell" style={{ fontSize: 11, color: 'var(--muted)' }}>{r.syncedAt ? new Date(r.syncedAt).toLocaleDateString() : '—'}</div>
                <div className="py-cell" style={{ display: 'flex', gap: 6 }}>
                  {r.status !== 'synced' && <button className="btn btn-xs btn-primary" data-testid={`qbo-sync-${r.id}`} onClick={() => { actions.updateQbo(r.id, { status: 'synced', syncedAt: new Date().toISOString() }); toast({ message: `${r.invoiceNo} synced`, kind: 'ok' }) }} style={{ borderRadius: 8, background: '#2ca01c' }}>Sync</button>}
                  <button className="btn btn-xs" data-testid={`qbo-retry-${r.id}`} onClick={() => { actions.updateQbo(r.id, { status: 'pending' }); toast({ message: `${r.invoiceNo} queued`, kind: 'ok' }) }} style={{ borderRadius: 8 }}>Retry</button>
                </div>
              </div>
            ))}
            {!filtered.length && <div className="py-empty" style={{ padding: 48, textAlign: 'center' }} data-testid="qbo-empty"><b>No QuickBooks invoices</b><div className="muted" style={{ fontSize: 12 }}>Generate invoices to sync to QuickBooks.</div></div>}
            <div className="footer" style={{ padding: '12px 20px', display: 'flex', justifyContent: 'space-between', background: 'var(--panel-2)', borderTop: '1px solid var(--line)', fontSize: 12 }}><span>{filtered.length} invoices · {money(filtered.reduce((s, r) => s + (r.amount || 0), 0))} total</span><span>{kpis.synced} synced · {kpis.pending} pending</span></div>
          </div>
        </div>
      </div>
    </div>
  )
}
