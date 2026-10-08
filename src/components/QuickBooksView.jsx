import React, { useMemo, useState } from 'react'
import { useStore } from '../state/store'
import { SectionBar, RangePicker } from './NavRail'
import { Icon } from '../ui/Icons'
import { useToast } from '../ui/Toast'
import { resolveRange } from '../lib/analytics'
import { isoDate, addDays, parseISO } from '../lib/date'
import { buildQboCsv } from '../lib/billingDocs'
import { download } from '../lib/ics'

const money = (n) => `$${(Math.round(n * 100) / 100).toLocaleString(undefined, { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`

export default function QuickBooksView() {
  const state = useStore()
  const { ui, actions, settings, qbo } = state
  const toast = useToast()
  const preset = ui.qboPreset || 'last4'
  const range = useMemo(() => resolveRange(preset, ui.anchor, settings.weekStart), [preset, ui.anchor, settings.weekStart])
  const [q, setQ] = useState('')
  const [statusF, setStatusF] = useState('all')
  const records = useMemo(() => Object.values(qbo || {}), [qbo])
  const filtered = records.filter((r) => (statusF === 'all' || r.status === statusF) &&
    (!q.trim() || `${r.clientName} ${r.invoiceNo} ${r.id}`.toLowerCase().includes(q.trim().toLowerCase())))
  const counts = { reviewed: records.filter((r) => r.status === 'reviewed').length,
    pending: records.filter((r) => r.status === 'pending').length,
    legacy: records.filter((r) => r.status === 'synced').length }
  const mark = (record, status) => {
    actions.updateQbo(record.id, { status, ...(status === 'reviewed' ? { reviewedAt: new Date().toISOString() } : {}) })
    toast({ message: `${record.invoiceNo || record.id} marked ${status} locally — no QuickBooks connection`, kind: 'ok' })
  }
  const exportCsv = () => {
    const files = buildQboCsv(state, { from: range.days[0], to: range.days[range.days.length - 1] })
    for (const f of files) download(f.fileName, f.content, 'text/csv;charset=utf-8')
    const rows = files.reduce((s, f) => s + f.rows, 0)
    toast({ message: `${rows} charge rows in ${files.length} CSV file${files.length === 1 ? '' : 's'} downloaded for QuickBooks import. Nothing was sent to QuickBooks.`, kind: rows ? 'ok' : 'warn' })
  }
  return (
    <div className="sectionpage" data-testid="qbo-sec" style={{ background: 'var(--bg)' }}>
      <SectionBar icon="file" title="QuickBooks · local records" sub={`${range.label} · ${records.length} records · ${counts.reviewed} reviewed locally · ${counts.pending} pending`}>
        <RangePicker preset={preset} onPreset={(p) => actions.setUI({ qboPreset: p })} onSlide={(d) => actions.setUI({ anchor: isoDate(addDays(parseISO(ui.anchor), d * range.days.length)) })} label={range.label} />
        <div className="sb-search" style={{ minWidth: 220, borderRadius: 10 }}><span className="sic">{Icon.search({ size: 12 })}</span><input placeholder="Search client, invoice" value={q} onChange={(e) => setQ(e.target.value)} data-testid="qbo-search" /></div>
        <button className="btn btn-sm btn-primary" data-testid="qbo-export" title="Open primary claims with a date of service in this range, one invoice per client" onClick={exportCsv}>{Icon.download({ size: 11 })} Download import CSV</button>
      </SectionBar>
      <div className="batch-strip" style={{ margin: 16, padding: '12px 16px', background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 12 }}>
        <span className="muted">No QuickBooks API is connected. Local review does not confirm remote import. Download import CSV writes the open primary claims in this range as QuickBooks invoice rows (charges only; claims with an active secondary filing are left out); import the file yourself and reconcile before accounting use.</span>
      </div>
      <div className="batch-strip" data-testid="qbo-kpis" style={{ margin: 16, padding: 16, gap: 12, flexWrap: 'wrap', background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 14 }}>
        {[
          ['Total', records.length, money(records.reduce((s, r) => s + (r.amount || 0), 0)), 'qbo-kpi-total'],
          ['Reviewed', counts.reviewed, 'Local only', 'qbo-kpi-reviewed'],
          ['Pending', counts.pending, 'To review', 'qbo-kpi-pending'],
          ['Legacy synced label', counts.legacy, 'Unverified', 'qbo-kpi-synced'],
        ].map(([label, value, sub, id]) => <div key={id} className="rp-sumchip on" data-testid={id} style={{ minWidth: 140, padding: '12px 16px', borderRadius: 12, border: '1px solid var(--line)' }}><b style={{ display: 'block', fontSize: 18 }}>{value}</b><span style={{ display: 'block', fontSize: 12 }}>{label}</span><small className="muted">{sub}</small></div>)}
      </div>
      <div className="batch-strip" data-testid="qbo-status-tabs" style={{ margin: '0 16px 16px', padding: '12px 16px', background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 12 }}>
        <div className="viewseg">{[['all', 'All'], ['pending', 'Pending'], ['reviewed', 'Reviewed'], ['synced', 'Legacy synced'], ['failed', 'Failed']].map(([id, label]) => <button key={id} className={statusF === id ? 'on' : ''} data-testid={`qbo-status-${id}`} onClick={() => setStatusF(id)}>{label}</button>)}</div>
        <span className="muted" style={{ marginLeft: 12 }}>{filtered.length} local records</span>
      </div>
      <div style={{ padding: '0 16px 16px' }}><div className="panel" style={{ borderRadius: 14, border: '1px solid var(--line)', overflow: 'hidden' }}>
        <div style={{ padding: 16, borderBottom: '1px solid var(--line)' }}><b>Accounting export records</b><div className="muted" style={{ fontSize: 12 }}>No automatic sync or network confirmation</div></div>
        <div className="py-tbl" data-testid="qbo-table" style={{ overflowX: 'auto' }}>
          <div className="py-thead" style={{ gridTemplateColumns: '120px 1.4fr 120px 140px 100px 1fr' }}><span>Invoice #</span><span>Client</span><span>Amount</span><span>Local status</span><span>Reviewed</span><span>Actions</span></div>
          {filtered.slice(0, 100).map((r) => <div key={r.id} className="py-trow" data-testid={`qbo-row-${r.id}`} style={{ gridTemplateColumns: '120px 1.4fr 120px 140px 100px 1fr', minHeight: 52 }}>
            <div className="py-cell"><span className="ln-code">{r.invoiceNo || r.id.slice(0, 8)}</span></div>
            <div className="py-cell">{r.clientName || r.clientId || '—'}</div>
            <div className="py-cell">{money(r.amount || 0)}</div>
            <div className="py-cell">{r.status === 'synced' ? 'legacy (unverified)' : r.status || 'unreviewed'}</div>
            <div className="py-cell">{r.reviewedAt ? new Date(r.reviewedAt).toLocaleDateString() : '—'}</div>
            <div className="py-cell" style={{ display: 'flex', gap: 6 }}>
              {r.status !== 'reviewed' && <button className="btn btn-xs" data-testid={`qbo-review-${r.id}`} onClick={() => mark(r, 'reviewed')}>Mark reviewed locally</button>}
              {r.status !== 'pending' && <button className="btn btn-xs" data-testid={`qbo-retry-${r.id}`} onClick={() => mark(r, 'pending')}>Return to pending</button>}
            </div>
          </div>)}
          {!filtered.length && <div className="py-empty" style={{ padding: 40, textAlign: 'center' }} data-testid="qbo-empty">No local export records in this filter.</div>}
        </div>
      </div></div>
    </div>
  )
}
