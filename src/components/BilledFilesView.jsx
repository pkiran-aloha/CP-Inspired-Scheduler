import React, { useMemo, useState } from 'react'
import { useStore } from '../state/store'
import { SectionBar, RangePicker } from './NavRail'
import { Icon } from '../ui/Icons'
import { useToast } from '../ui/Toast'
import { download } from '../lib/ics'
import { todayISO, isoDate, addDays, parseISO } from '../lib/date'
import { resolveRange } from '../lib/analytics'

const PAGE_SIZE = 25

export default function BilledFilesView() {
  const state = useStore()
  const { actions, ui, settings } = state
  const toast = useToast()
  const preset = ui.bfPreset || 'last4'
  const range = useMemo(() => resolveRange(preset, ui.anchor, settings.weekStart), [preset, ui.anchor, settings.weekStart])

  const [q, setQ] = useState('')
  const [payerF, setPayerF] = useState('all')
  const [formatF, setFormatF] = useState('all')
  const [from, setFrom] = useState(range.days[0])
  const [to, setTo] = useState(range.days[range.days.length - 1])
  const [sort, setSort] = useState({ k: 'createdAt', d: -1 })
  const [page, setPage] = useState(0)
  const [selected, setSelected] = useState(null)

  const files = useMemo(() => Object.values(state.billedFiles || {}), [state.billedFiles])
  const claimsById = state.claims || {}

  const payers = useMemo(() => [...new Set(files.map((f) => f.payer).filter(Boolean))].sort(), [files])
  const formats = useMemo(() => [...new Set(files.map((f) => f.format || '837P').filter(Boolean))].sort(), [files])

  const rows = useMemo(() => {
    let r = [...files]
    const s = q.trim().toLowerCase()
    if (s) r = r.filter((f) => `${f.fileName} ${f.payer} ${f.clientNames || ''} ${f.format || ''}`.toLowerCase().includes(s))
    if (payerF !== 'all') r = r.filter((f) => f.payer === payerF)
    if (formatF !== 'all') r = r.filter((f) => (f.format || '837P') === formatF)
    if (from) r = r.filter((f) => !f.date || f.date >= from)
    if (to) r = r.filter((f) => !f.date || f.date <= to)
    r.sort((a, b) => {
      if (sort.k === 'createdAt' || sort.k === 'date') {
        const at = sort.k === 'createdAt' ? (a.createdAt || 0) : new Date(a.date || 0).getTime()
        const bt = sort.k === 'createdAt' ? (b.createdAt || 0) : new Date(b.date || 0).getTime()
        return (bt - at) * (sort.d > 0 ? 1 : -1)
      }
      return String(a[sort.k] ?? '').localeCompare(String(b[sort.k] ?? '')) * sort.d
    })
    return r
  }, [files, q, payerF, formatF, from, to, sort])

  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE))
  const view = rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  const generate = () => {
    const openClaims = Object.values(claimsById).filter((c) => c.status === 'submitted')
    if (!openClaims.length) { toast({ message: 'No submitted claims to file — submit drafts first', kind: 'warn' }); return }
    const fileName = `837P-${todayISO()}-${String(Object.keys(state.billedFiles || {}).length + 1).padStart(3, '0')}.txt`
    const content = openClaims.map((c) => `${c.no}|${c.payer}|${c.charges}|${c.dosFrom}->${c.dosTo}`).join('\n')
    const rec = {
      id: `bf-${Date.now().toString(36)}`, fileName, payer: openClaims[0].payer,
      clientCount: new Set(openClaims.map((c) => c.clientId)).size, claimCount: openClaims.length,
      claimIds: openClaims.map((c) => c.id),
      clientNames: [...new Set(openClaims.map((c) => (state.clients || []).find((cl) => cl.id === c.clientId)?.name || ''))].slice(0, 3).join(', '),
      date: todayISO(), sendCount: 1, content, createdAt: Date.now(), format: '837P',
    }
    actions.record('billedFiles', rec)
    toast({ message: `${fileName} generated — ${openClaims.length} claims filed`, kind: 'ok' })
  }

  const resend = (f) => {
    const next = { ...f, sendCount: (f.sendCount || 1) + 1, date: todayISO(), createdAt: Date.now() }
    actions.record('billedFiles', next)
    toast({ message: `${f.fileName} resent — count ${next.sendCount}`, kind: 'ok' })
  }
  const voidFile = (f) => {
    const next = { ...f, voided: true, voidedAt: Date.now(), date: todayISO() }
    actions.record('billedFiles', next)
    toast({ message: `${f.fileName} voided`, kind: 'ok' })
  }
  const downloadFile = (f) => {
    download(f.fileName, f.content || `File ${f.fileName} — ${f.claimCount} claims`)
    toast({ message: `${f.fileName} downloaded`, kind: 'ok' })
  }
  const flip = (k) => setSort((x) => ({ k, d: x.k === k ? -x.d : 1 }))
  const clear = () => {
    setQ(''); setPayerF('all'); setFormatF('all'); setFrom(range.days[0]); setTo(range.days[range.days.length - 1]); setPage(0); setSelected(null)
    toast({ message: 'Filters cleared', kind: 'info' })
  }

  return (
    <div className="sectionpage" data-testid="bf-sec">
      <SectionBar icon="file" title="Billed Files" sub={`${files.length} files · ${rows.length} filtered · 837P pipeline + invoices + QBO + verification share registry`}>
        <RangePicker preset={preset} onPreset={(p) => actions.setUI({ bfPreset: p })} onSlide={(d) => actions.setUI({ anchor: isoDate(addDays(parseISO(ui.anchor), d * range.days.length)) })} label={range.label} />
        <button className="btn btn-sm" onClick={clear} data-testid="bf-clear">{Icon.x({ size: 12 })} Clear</button>
        <button className="btn btn-sm btn-primary" data-testid="bf-generate" onClick={generate}>{Icon.file({ size: 12 })} Generate 837P</button>
      </SectionBar>

      <div className="batch-strip" style={{ padding: '10px 16px', gap: 10, flexWrap: 'wrap' }}>
        <div className="sb-search" style={{ minWidth: 220 }}>
          <span className="sic">{Icon.search({ size: 12 })}</span>
          <input placeholder="Search files, payers, types…" value={q} onChange={(e) => setQ(e.target.value)} data-testid="bf-search" />
        </div>
        <select className="input" style={{ height: 30, borderRadius: 8 }} value={payerF} onChange={(e) => setPayerF(e.target.value)} data-testid="bf-payer-filter">
          <option value="all">All payers</option>
          {payers.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <select className="input" style={{ height: 30, borderRadius: 8 }} value={formatF} onChange={(e) => setFormatF(e.target.value)} data-testid="bf-format-filter">
          <option value="all">All formats</option>
          {formats.map((f) => <option key={f} value={f}>{f}</option>)}
        </select>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>From<input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} data-testid="bf-from" style={{ height: 28, borderRadius: 6 }} /></label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>To<input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} data-testid="bf-to" style={{ height: 28, borderRadius: 6 }} /></label>
        <span className="muted" style={{ marginLeft: 'auto', fontSize: 11 }}>{rows.length} of {files.length} · {formats.join(', ') || 'no types yet'}</span>
      </div>

      <div style={{ padding: 16 }}>
        <div className="panel" style={{ borderRadius: 12, overflow: 'hidden', boxShadow: 'var(--shadow-1)' }}>
          <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 8, background: 'var(--panel-2)' }}>
            <span style={{ width: 24, height: 24, borderRadius: 6, background: '#6366f1', color: '#fff', display: 'grid', placeItems: 'center' }}>{Icon.table({ size: 12 })}</span>
            <b style={{ fontSize: 12 }}>File registry</b>
            <span className="muted" style={{ fontSize: 11, marginLeft: 8 }}>25 per page · resend bumps count · void keeps history</span>
            <span className="an-spacer" />
            <span className="tag soft">{rows.length} files</span>
          </div>

          <div className="py-tbl" data-testid="bf-table" style={{ minHeight: 200 }}>
            <div className="py-thead" style={{ gridTemplateColumns: '2fr 1fr 0.9fr 0.6fr 0.6fr 1fr 0.6fr 1.8fr', background: 'var(--panel-2)' }}>
              <button className="sortable" data-testid="bf-sort-file" onClick={() => flip('fileName')}>File Name {sort.k === 'fileName' ? (sort.d > 0 ? '↑' : '↓') : ''}</button>
              <button className="sortable" data-testid="bf-sort-payer" onClick={() => flip('payer')}>Payer {sort.k === 'payer' ? (sort.d > 0 ? '↑' : '↓') : ''}</button>
              <button className="sortable" data-testid="bf-sort-format" onClick={() => flip('format')}>Type {sort.k === 'format' ? (sort.d > 0 ? '↑' : '↓') : ''}</button>
              <span>Clients</span><span>Claims</span>
              <button className="sortable" data-testid="bf-sort-date" onClick={() => flip('date')}>Billed Through {sort.k === 'date' ? (sort.d > 0 ? '↑' : '↓') : ''}</button>
              <span>Send Count</span><span>Actions</span>
            </div>
            {view.length === 0 && <div className="py-empty" data-testid="bf-empty" style={{ padding: 32, textAlign: 'center' }}><div style={{ width: 48, height: 48, borderRadius: 12, background: 'var(--panel-2)', display: 'grid', placeItems: 'center', margin: '0 auto 12px', fontSize: 20 }}>📁</div><b>No billed files</b><div className="muted" style={{ fontSize: 12 }}>Submit claims from Billing, then Generate here. Registry includes 837P, CMS-1500, invoices, QBO, verification.</div></div>}
            {view.map((f) => (
              <div className={`py-trow ${f.voided ? 'is-void' : ''}`} key={f.id} data-testid={`bf-row-${f.id}`} style={{ gridTemplateColumns: '2fr 1fr 0.9fr 0.6fr 0.6fr 1fr 0.6fr 1.8fr', opacity: f.voided ? 0.55 : 1 }}>
                <div className="py-idcell"><b style={{ fontSize: 11 }}>{f.fileName}</b><span className="muted" style={{ fontSize: 10.5 }}>{f.clientNames || ''}{f.voided ? ' · VOIDED' : ''}</span></div>
                <div className="py-cell"><span className="tag soft" style={{ fontSize: 10 }}>{f.payer || '—'}</span></div>
                <div className="py-cell"><span className="tag" style={{ fontSize: 10 }}>{f.format || '837P'}</span></div>
                <div className="py-cell num"><b>{f.clientCount}</b></div>
                <div className="py-cell num"><b>{f.claimCount}</b></div>
                <div className="py-cell"><span className="muted" style={{ fontSize: 11 }}>{f.date}</span></div>
                <div className="py-cell num"><span className={`py-cnt${f.sendCount > 1 ? '' : ' z'}`} style={{ fontSize: 11 }}>{f.sendCount || 1}</span></div>
                <div className="py-cell" style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  <button className="btn btn-xs" data-testid={`bf-download-${f.id}`} onClick={() => downloadFile(f)}>{Icon.download({ size: 11 })} DL</button>
                  <button className="btn btn-xs" data-testid={`bf-resend-${f.id}`} onClick={() => resend(f)}>{Icon.repeat({ size: 11 })} Resend</button>
                  <button className="btn btn-xs" data-testid={`bf-view-${f.id}`} onClick={() => setSelected(f)}>{Icon.eye({ size: 11 })} View</button>
                  {!f.voided && <button className="btn btn-xs" data-testid={`bf-void-${f.id}`} onClick={() => voidFile(f)}>{Icon.x({ size: 11 })} Void</button>}
                </div>
              </div>
            ))}
            <div className="py-pager" data-testid="bf-pager" style={{ padding: '10px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid var(--line)', background: 'var(--panel-2)' }}>
              <span className="muted" style={{ fontSize: 11 }}>{rows.length ? `${page * PAGE_SIZE + 1}–${Math.min(rows.length, (page + 1) * PAGE_SIZE)} of ${rows.length}` : '0 files'}</span>
              {pages > 1 && <span className="py-pages" style={{ display: 'flex', gap: 4 }}>{Array.from({ length: pages }, (_, i) => <button key={i} className={`pg-num${i === page ? ' on' : ''}`} data-testid={`bf-page-${i}`} onClick={() => setPage(i)} style={{ minWidth: 28, height: 28, borderRadius: 6 }}>{i + 1}</button>)}</span>}
            </div>
          </div>
        </div>

        {selected && (
          <div className="panel" style={{ marginTop: 16, borderRadius: 12, overflow: 'hidden', boxShadow: 'var(--shadow-1)' }} data-testid="bf-detail">
            <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 8, background: 'var(--panel-2)' }}>
              <span style={{ width: 24, height: 24, borderRadius: 6, background: '#10b981', color: '#fff', display: 'grid', placeItems: 'center' }}>{Icon.file({ size: 12 })}</span>
              <b style={{ fontSize: 12 }}>File Detail — {selected.fileName}</b>
              <span className="an-spacer" />
              <button className="btn btn-xs" onClick={() => downloadFile(selected)} data-testid="bf-detail-download">{Icon.download({ size: 11 })} Download</button>
              <button className="btn btn-xs" onClick={() => setSelected(null)} data-testid="bf-detail-close">{Icon.x({ size: 11 })} Close</button>
            </div>
            <div style={{ padding: 16, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div style={{ fontSize: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}><span className="muted">Payer</span><b>{selected.payer}</b></div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}><span className="muted">Format</span><span className="tag">{selected.format}</span></div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}><span className="muted">Date</span><span>{selected.date}</span></div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}><span className="muted">Clients / Claims</span><span>{selected.clientCount} / {selected.claimCount}</span></div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}><span className="muted">Send Count</span><b>{selected.sendCount}</b></div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}><span className="muted">Created</span><span style={{ fontSize: 11 }}>{new Date(selected.createdAt).toLocaleString()}</span></div>
                {selected.claimIds?.length > 0 && <div style={{ marginTop: 8, fontSize: 11 }}><span className="muted">Claims:</span> {selected.claimIds.slice(0, 10).join(', ')}{selected.claimIds.length > 10 ? ` +${selected.claimIds.length - 10} more` : ''}</div>}
              </div>
              <div style={{ background: 'var(--panel-2)', border: '1px solid var(--line)', borderRadius: 8, padding: 12, maxHeight: 220, overflow: 'auto', fontSize: 11, whiteSpace: 'pre-wrap', fontFamily: 'monospace' }} data-testid="bf-detail-content">
                {(selected.content || '').slice(0, 5000) || 'No content'}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
