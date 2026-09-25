import React, { useMemo, useState } from 'react'
import { useStore } from '../state/store'
import { SectionBar, RangePicker } from './NavRail'
import { Icon } from '../ui/Icons'
import { useToast } from '../ui/Toast'
import { resolveRange } from '../lib/analytics'
import { download } from '../lib/ics'
import { isoDate, addDays, parseISO, fmtDayLabel } from '../lib/date'
import { dueOf } from '../lib/claims'

const money = (n) => `$${(Math.round(n * 100) / 100).toLocaleString(undefined, { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`

export default function BilledFilesView() {
  const state = useStore()
  const { ui, actions, settings, claims, clients } = state
  const toast = useToast()
  const preset = ui.bfPreset || 'last4'
  const range = useMemo(() => resolveRange(preset, ui.anchor, settings.weekStart), [preset, ui.anchor, settings.weekStart])
  const [q, setQ] = useState('')
  const [formatF, setFormatF] = useState('all')
  const [statusF, setStatusF] = useState('all')

  const files = useMemo(() => {
    const out = []
    for (const c of Object.values(claims)) {
      if (!c.billedFiles) continue
      for (const f of c.billedFiles) out.push({ ...f, claim: c, client: clients.find((x) => x.id === c.clientId) })
    }
    return out.sort((a, b) => (b.date || '').localeCompare(a.date || ''))
  }, [claims, clients])

  const filtered = useMemo(() => {
    let out = files
    if (formatF !== 'all') out = out.filter((f) => f.format === formatF)
    if (statusF !== 'all') out = out.filter((f) => f.status === statusF)
    if (q.trim()) {
      const t = q.trim().toLowerCase()
      out = out.filter((f) => `${f.claim.no} ${f.client?.name} ${f.fileName} ${f.format}`.toLowerCase().includes(t))
    }
    return out
  }, [files, formatF, statusF, q])

  const kpis = useMemo(() => {
    const last30 = files.filter((f) => f.date >= range.days[0])
    const byFmt = {}
    for (const f of last30) byFmt[f.format] = (byFmt[f.format] || 0) + 1
    return { total: last30.length, byFmt, pending: files.filter((f) => f.status === 'pending').length, sent: files.filter((f) => f.status === 'sent').length }
  }, [files, range])

  return (
    <div className="sectionpage" data-testid="bf-sec" style={{ background: 'var(--bg)' }}>
      <SectionBar icon="file" title="Billed Files" sub={`${range.label} · ${kpis.total} files in range · ${kpis.sent} sent · ${kpis.pending} pending`}>
        <RangePicker preset={preset} onPreset={(p) => actions.setUI({ bfPreset: p })} onSlide={(d) => actions.setUI({ anchor: isoDate(addDays(parseISO(ui.anchor), d * range.days.length)) })} label={range.label} />
        <div className="sb-search" style={{ minWidth: 220, borderRadius: 10 }}>
          <span className="sic">{Icon.search({ size: 12 })}</span>
          <input placeholder="Search claim, client, file" value={q} onChange={(e) => setQ(e.target.value)} data-testid="bf-search" style={{ fontSize: 13 }} />
        </div>
      </SectionBar>

      <div className="batch-strip" data-testid="bf-kpis" style={{ margin: '16px', padding: '16px', gap: 12, flexWrap: 'wrap', background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 14 }}>
        {[
          ['Total', kpis.total, `${range.label}`, '#6366f1', 'bf-kpi-total'],
          ['Sent', kpis.sent, 'Delivered', '#10b981', 'bf-kpi-sent'],
          ['Pending', kpis.pending, 'Queued', '#f59e0b', 'bf-kpi-pending'],
          ['837P', kpis.byFmt['837p'] || 0, 'EDI', '#0ea5e9', 'bf-kpi-837'],
        ].map(([label, val, sub, color, testId]) => (
          <div key={label} className="rp-sumchip on" data-testid={testId} style={{ background: 'var(--panel)', border: '1px solid var(--line)', display: 'flex', gap: 12, alignItems: 'center', minWidth: 140, borderRadius: 12, padding: '12px 16px' }}>
            <span style={{ width: 32, height: 32, borderRadius: 9, background: `${color}14`, color, display: 'grid', placeItems: 'center' }}>{Icon.file({ size: 14 })}</span>
            <div><b style={{ fontSize: 18, fontWeight: 800 }}>{val}</b><span style={{ display: 'block', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--muted)' }}>{label}</span><span style={{ fontSize: 12, color: 'var(--muted)' }}>{sub}</span></div>
          </div>
        ))}
      </div>

      <div className="batch-strip" style={{ margin: '0 16px 16px', padding: '12px 16px', gap: 12, background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 12, flexWrap: 'wrap' }}>
        <div className="viewseg" style={{ borderRadius: 10, padding: 3 }} data-testid="bf-format-tabs">
          {[
            ['all', 'All formats'],
            ['837p', '837P'],
            ['cms1500', 'CMS-1500'],
            ['invoice', 'Invoice'],
          ].map(([id, label]) => (
            <button key={id} className={formatF === id ? 'on' : ''} data-testid={`bf-format-${id}`} onClick={() => setFormatF(id)} style={{ borderRadius: 8, fontSize: 13 }}>{label}</button>
          ))}
        </div>
        <div className="viewseg" style={{ borderRadius: 10, padding: 3 }} data-testid="bf-status-tabs">
          {[
            ['all', 'All'],
            ['sent', 'Sent'],
            ['pending', 'Pending'],
            ['failed', 'Failed'],
          ].map(([id, label]) => (
            <button key={id} className={statusF === id ? 'on' : ''} data-testid={`bf-status-${id}`} onClick={() => setStatusF(id)} style={{ borderRadius: 8, fontSize: 13 }}>{label}</button>
          ))}
        </div>
        <span className="muted" style={{ marginLeft: 'auto', fontSize: 12 }}>{filtered.length} files</span>
      </div>

      <div style={{ padding: '0 16px 16px' }}>
        <div className="panel" style={{ borderRadius: 14, overflow: 'hidden', border: '1px solid var(--line)' }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 12, background: 'var(--panel-2)' }}>
            <span style={{ width: 32, height: 32, borderRadius: 9, background: '#6366f114', color: '#6366f1', display: 'grid', placeItems: 'center' }}>{Icon.file({ size: 16 })}</span>
            <div><b style={{ fontSize: 14 }}>File History</b><div className="muted" style={{ fontSize: 12 }}>{filtered.length} files · clearinghouse + paper + invoice exports</div></div>
          </div>
          <div className="py-tbl" data-testid="bf-table" style={{ overflowX: 'auto' }}>
            <div className="py-thead" style={{ gridTemplateColumns: '120px 1.4fr 1fr 90px 100px 120px 1fr', background: 'var(--panel-2)', fontSize: 11, padding: '12px 16px' }}>
              <span>Date</span><span>Client / Claim</span><span>File</span><span>Format</span><span>Status</span><span>Amount</span><span>Actions</span>
            </div>
            {filtered.slice(0, 100).map((f, idx) => (
              <div key={`${f.claim.id}-${idx}`} className="py-trow" data-testid={`bf-row-${f.claim.id}-${idx}`} style={{ gridTemplateColumns: '120px 1.4fr 1fr 90px 100px 120px 1fr', minHeight: 56, padding: '12px 16px' }}>
                <div className="py-cell" style={{ fontSize: 12 }}>{f.date || f.claim.dosFrom}</div>
                <div className="py-cell"><div><b style={{ fontSize: 13 }}>{f.client?.name || f.claim.clientId}</b><div style={{ fontSize: 11, color: 'var(--muted)' }}><span className="ln-code">{f.claim.no}</span> · {f.claim.payer}</div></div></div>
                <div className="py-cell" style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.fileName || `${f.claim.no}.${f.format}`}</div>
                <div className="py-cell"><span className="pill" style={{ fontSize: 11, borderRadius: 20, padding: '3px 10px', background: 'var(--panel-2)' }}>{f.format}</span></div>
                <div className="py-cell"><span className="pill" style={{ fontSize: 11, borderRadius: 20, padding: '3px 10px', background: f.status === 'sent' ? '#ecfdf5' : f.status === 'failed' ? '#fef2f2' : '#fef9c3' }}>{f.status}</span></div>
                <div className="py-cell"><b style={{ fontSize: 13 }}>{money(f.claim.charges)}</b></div>
                <div className="py-cell" style={{ display: 'flex', gap: 6 }}>
                  <button className="btn btn-xs" data-testid={`bf-download-${f.claim.id}-${idx}`} onClick={() => { const content = `Claim ${f.claim.no} — ${f.format} — ${f.fileName || ''}\nCharges ${money(f.claim.charges)}`; download(f.fileName || `${f.claim.no}.${f.format}.txt`, content); toast({ message: `Downloaded ${f.fileName || f.claim.no}`, kind: 'ok' }) }} style={{ borderRadius: 8 }}>Download</button>
                  <button className="btn btn-xs" data-testid={`bf-resend-${f.claim.id}-${idx}`} onClick={() => toast({ message: `Re-queued ${f.claim.no}`, kind: 'ok' })} style={{ borderRadius: 8 }}>Resend</button>
                </div>
              </div>
            ))}
            {!filtered.length && <div className="py-empty" style={{ padding: 48, textAlign: 'center' }} data-testid="bf-empty"><b>No billed files</b><div className="muted" style={{ fontSize: 12 }}>Submit claims to generate 837P / CMS-1500 files.</div></div>}
            <div className="footer" style={{ padding: '12px 20px', display: 'flex', justifyContent: 'space-between', background: 'var(--panel-2)', borderTop: '1px solid var(--line)', fontSize: 12 }}><span>{filtered.length} files</span><span>{kpis.sent} sent · {kpis.pending} pending</span></div>
          </div>
        </div>
      </div>
    </div>
  )
}
