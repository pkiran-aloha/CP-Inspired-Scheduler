import React, { useMemo, useState } from 'react'
import { useStore } from '../state/store'
import { SectionBar, RangePicker } from './NavRail'
import { Icon } from '../ui/Icons'
import { useToast } from '../ui/Toast'
import { resolveRange } from '../lib/analytics'
import { download } from '../lib/ics'
import { isoDate, addDays, parseISO } from '../lib/date'
// One glyph per metric (no two tiles on a screen share one).
const TILE_ICON = { 'bf-kpi-total': 'folder', 'bf-kpi-sent': 'download', 'bf-kpi-pending': 'clock', 'bf-kpi-837': 'file' }

// Stored status `sent` only means the file was recorded here; nothing is transmitted.
const STATUS_LABEL = { sent: 'Exported', pending: 'Pending', failed: 'Failed', void: 'Void' }
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
    // Current submissions live in the first-class billedFiles ledger. Also read
    // older claim-embedded files so restoring a legacy workspace doesn't hide them.
    const out = Object.values(state.billedFiles || {}).map((f) => {
      const related = (f.claimIds || []).map((id) => claims[id]).filter(Boolean)
      const claim = related[0] || null
      return { ...f, format: f.format || '837p', status: f.status || 'sent', related, claim,
        client: clients.find((c) => c.id === claim?.clientId), source: 'ledger' }
    })
    for (const c of Object.values(claims)) {
      for (const [index, f] of (c.billedFiles || []).entries()) {
        out.push({ ...f, id: f.id || `${c.id}-${index}`, format: f.format || '837p', status: f.status || 'sent',
          related: [c], claim: c, client: clients.find((x) => x.id === c.clientId), source: 'claim', legacyIndex: index })
      }
    }
    return out.sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.createdAt || 0) - (a.createdAt || 0))
  }, [state.billedFiles, claims, clients])

  // Never fabricate an old artifact from today's claim data: it may have changed.
  const contentOf = (f) => typeof f.content === 'string' && f.content.length ? f.content : null
  const downloadFile = (f) => {
    const content = contentOf(f)
    if (!content) { toast({ message: 'No downloadable content is stored for this file', kind: 'warn' }); return false }
    download(f.fileName || `${f.claim?.no || f.id}.txt`, content, f.format?.includes('csv') ? 'text/csv' : 'text/plain')
    return true
  }
  const resend = (f) => {
    if (f.status === 'void') return
    const content = contentOf(f)
    if (!content) { toast({ message: 'No artifact available to resend', kind: 'warn' }); return }
    if (f.source === 'claim') {
      const updated = f.claim.billedFiles.map((old, i) => i === f.legacyIndex
        ? { ...old, sendCount: (old.sendCount || 1) + 1, status: 'sent', lastSentAt: Date.now() } : old)
      actions.updateClaim(f.claim.id, { billedFiles: updated })
    } else {
      const result = actions.resendBilledFile(f.id)
      if (!result.ok) { toast({ message: result.msg, kind: 'warn' }); return }
    }
    downloadFile(f)
    toast({ message: `${f.fileName || f.id} prepared for manual resend — file downloaded`, kind: 'ok' })
  }

  const filtered = useMemo(() => {
    let out = files
    if (formatF !== 'all') out = out.filter((f) => f.format === formatF)
    if (statusF !== 'all') out = out.filter((f) => f.status === statusF)
    if (q.trim()) {
      const t = q.trim().toLowerCase()
      out = out.filter((f) => `${f.related.map((c) => c.no).join(' ')} ${f.client?.name || ''} ${f.payer || ''} ${f.fileName || ''} ${f.format}`.toLowerCase().includes(t))
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
      <SectionBar icon="file" title="Billed Files" sub={`${range.label} · ${kpis.total} files in range · ${kpis.sent} exported · ${kpis.pending} pending · nothing transmitted`}>
        <RangePicker preset={preset} onPreset={(p) => actions.setUI({ bfPreset: p })} onSlide={(d) => actions.setUI({ anchor: isoDate(addDays(parseISO(ui.anchor), d * range.days.length)) })} label={range.label} />
        <div className="sb-search" style={{ minWidth: 220, borderRadius: 10 }}>
          <span className="sic">{Icon.search({ size: 12 })}</span>
          <input placeholder="Search claim, client, file" value={q} onChange={(e) => setQ(e.target.value)} data-testid="bf-search" style={{ fontSize: 13 }} />
        </div>
      </SectionBar>

      <div className="batch-strip" data-testid="bf-kpis" style={{ margin: '16px', padding: '16px', gap: 12, flexWrap: 'wrap', background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 14 }}>
        {[
          ['Total', kpis.total, `${range.label}`, '#6366f1', 'bf-kpi-total'],
          ['Exported', kpis.sent, 'Saved locally', '#10b981', 'bf-kpi-sent'],
          ['Pending', kpis.pending, 'Queued', '#f59e0b', 'bf-kpi-pending'],
          ['837P', kpis.byFmt['837p'] || 0, 'Summary, not X12', '#0ea5e9', 'bf-kpi-837'],
        ].map(([label, val, sub, color, testId]) => (
          <div key={label} className="rp-sumchip on" data-testid={testId} style={{ background: 'var(--panel)', border: '1px solid var(--line)', display: 'flex', gap: 12, alignItems: 'center', minWidth: 140, borderRadius: 12, padding: '12px 16px' }}>
            <span style={{ width: 32, height: 32, borderRadius: 9, background: `${color}14`, color, display: 'grid', placeItems: 'center' }}>{Icon[TILE_ICON[testId]]({ size: 16 })}</span>
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
            ['sent', 'Exported'],
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
            <div><b style={{ fontSize: 14 }}>File History</b><div className="muted" style={{ fontSize: 12 }}>{filtered.length} files · claim, paper and invoice exports saved in this browser; upload or mail them yourself</div></div>
          </div>
          <div className="py-tbl" data-testid="bf-table" style={{ overflowX: 'auto' }}>
            <div className="py-thead" style={{ gridTemplateColumns: '120px 1.4fr 1fr 90px 100px 120px 1fr', background: 'var(--panel-2)', fontSize: 11, padding: '12px 16px' }}>
              <span>Date</span><span>Client / Claim</span><span>File</span><span>Format</span><span>Status</span><span>Amount</span><span>Actions</span>
            </div>
            {filtered.slice(0, 100).map((f) => (
              <div key={`${f.source}-${f.id}`} className="py-trow" data-testid={`bf-row-${f.id}`} style={{ gridTemplateColumns: '120px 1.4fr 1fr 90px 100px 120px 1fr', minHeight: 56, padding: '12px 16px' }}>
                <div className="py-cell" style={{ fontSize: 12 }}>{f.date || f.claim?.dosFrom || '—'}</div>
                <div className="py-cell"><div><b style={{ fontSize: 13 }}>{f.clientCount > 1 ? `${f.clientCount} clients` : f.client?.name || f.payer || 'File'}</b><div style={{ fontSize: 11, color: 'var(--muted)' }}><span className="ln-code">{f.claim?.no || '—'}</span>{f.related.length > 1 ? ` + ${f.related.length - 1} more` : ''} · {f.payer || f.claim?.payer || '—'}</div></div></div>
                <div className="py-cell" style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={f.fileName}>{f.fileName || `${f.claim?.no || f.id}.${f.format}`}<small style={{ display: 'block', color: 'var(--muted)' }}>{f.sendCount || 1} send{(f.sendCount || 1) === 1 ? '' : 's'}</small></div>
                <div className="py-cell"><span className="pill" style={{ fontSize: 11, borderRadius: 20, padding: '3px 10px', background: 'var(--panel-2)' }}>{f.format}</span></div>
                <div className="py-cell"><span className="pill" style={{ fontSize: 11, borderRadius: 20, padding: '3px 10px', background: f.status === 'sent' ? '#ecfdf5' : f.status === 'failed' ? '#fef2f2' : '#fef9c3' }}>{STATUS_LABEL[f.status] || f.status}</span></div>
                <div className="py-cell"><b style={{ fontSize: 13 }}>{money(f.related.reduce((sum, c) => sum + (c.charges || 0), 0))}</b></div>
                <div className="py-cell" style={{ display: 'flex', gap: 6 }}>
                  <button className="btn btn-xs" data-testid={`bf-download-${f.id}`} disabled={!contentOf(f)} title={contentOf(f) ? 'Download the stored artifact' : 'Original file content was not stored'} onClick={() => { if (downloadFile(f)) toast({ message: `Downloaded ${f.fileName || f.id}`, kind: 'ok' }) }} style={{ borderRadius: 8 }}>Download</button>
                  <button className="btn btn-xs" data-testid={`bf-resend-${f.id}`} disabled={f.status === 'void' || !contentOf(f)} title={!contentOf(f) ? 'Original file content was not stored' : 'Download a copy for manual delivery (no network send)'} onClick={() => resend(f)} style={{ borderRadius: 8 }}>Prepare resend</button>
                </div>
              </div>
            ))}
            {!filtered.length && <div className="py-empty" style={{ padding: 48, textAlign: 'center' }} data-testid="bf-empty"><b>No billed files</b><div className="muted" style={{ fontSize: 12 }}>Submit claims to generate 837P / CMS-1500 files.</div></div>}
            <div className="footer" style={{ padding: '12px 20px', display: 'flex', justifyContent: 'space-between', background: 'var(--panel-2)', borderTop: '1px solid var(--line)', fontSize: 12 }}><span>{filtered.length} files</span><span>{kpis.sent} exported · {kpis.pending} pending</span></div>
          </div>
        </div>
      </div>
    </div>
  )
}
