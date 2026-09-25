import React, { useMemo, useState } from 'react'
import { useStore } from '../state/store'
import { SectionBar, RangePicker } from './NavRail'
import { Icon } from '../ui/Icons'
import { useToast } from '../ui/Toast'
import { download } from '../lib/ics'
import { todayISO, isoDate, addDays, parseISO } from '../lib/date'
import { resolveRange } from '../lib/analytics'

const PAGE_SIZE = 25

const formatMeta = {
  '837P': { icon: '🏥', color: '#6366f1', label: '837P Professional' },
  'cms1500': { icon: '📄', color: '#0ea5e9', label: 'CMS-1500' },
  'invoice_pdf': { icon: '🧾', color: '#10b981', label: 'Invoice PDF' },
  'invoice_csv': { icon: '📗', color: '#059669', label: 'Invoice CSV' },
  'qbo_csv': { icon: '💚', color: '#2ca01c', label: 'QuickBooks CSV' },
  'verification': { icon: '📋', color: '#f59e0b', label: 'Verification Form' },
  'appeal_letter': { icon: '📝', color: '#ef4444', label: 'Appeal Letter' },
  '835_error_report': { icon: '⚠️', color: '#f97316', label: '835 Error Report' },
  'remittance_csv': { icon: '💳', color: '#8b5cf6', label: 'Remittance CSV' },
}

export default function BilledFilesView() {
  const state = useStore()
  const { actions, ui } = state
  const toast = useToast()
  const preset = ui.bfPreset || 'last4'
  const range = useMemo(() => resolveRange(preset, ui.anchor, settings.weekStart), [preset, ui.anchor, state.settings.weekStart])
  const settings = state.settings

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
    const rec = { id: `bf-${Date.now().toString(36)}`, fileName, payer: openClaims[0].payer, clientCount: new Set(openClaims.map((c) => c.clientId)).size, claimCount: openClaims.length, claimIds: openClaims.map((c) => c.id), clientNames: [...new Set(openClaims.map((c) => (state.clients || []).find((cl) => cl.id === c.clientId)?.name || ''))].slice(0, 3).join(', '), date: todayISO(), sendCount: 1, content, createdAt: Date.now(), format: '837P' }
    actions.record('billedFiles', rec)
    toast({ message: `${fileName} generated — ${openClaims.length} claims filed`, kind: 'ok' })
  }

  const resend = (f) => { const next = { ...f, sendCount: (f.sendCount || 1) + 1, date: todayISO(), createdAt: Date.now() }; actions.record('billedFiles', next); toast({ message: `${f.fileName} resent — count ${next.sendCount}`, kind: 'ok' }) }
  const voidFile = (f) => { const next = { ...f, voided: true, voidedAt: Date.now(), date: todayISO() }; actions.record('billedFiles', next); toast({ message: `${f.fileName} voided`, kind: 'ok' }) }
  const downloadFile = (f) => { download(f.fileName, f.content || `File ${f.fileName} — ${f.claimCount} claims`); toast({ message: `${f.fileName} downloaded`, kind: 'ok' }) }
  const flip = (k) => setSort((x) => ({ k, d: x.k === k ? -x.d : 1 }))
  const clear = () => { setQ(''); setPayerF('all'); setFormatF('all'); setFrom(range.days[0]); setTo(range.days[range.days.length - 1]); setPage(0); setSelected(null); toast({ message: 'Filters cleared', kind: 'info' }) }

  return (
    <div className="sectionpage" data-testid="bf-sec" style={{ background: 'var(--bg)' }}>
      <SectionBar icon="file" title="Billed Files" sub={`📁 ${files.length} files · ${rows.length} filtered · 837P pipeline + invoices + QBO + verification share registry · Visual file types`}>
        <RangePicker preset={preset} onPreset={(p) => actions.setUI({ bfPreset: p })} onSlide={(d) => actions.setUI({ anchor: isoDate(addDays(parseISO(ui.anchor), d * range.days.length)) })} label={range.label} />
        <button className="btn btn-sm" onClick={clear} data-testid="bf-clear" style={{ borderRadius: 10 }}>{Icon.x({ size: 12 })} Clear</button>
        <button className="btn btn-sm btn-primary" data-testid="bf-generate" onClick={generate} style={{ borderRadius: 10, background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', border: 'none', boxShadow: '0 4px 12px #6366f140' }}>{Icon.file({ size: 12 })} Generate 837P</button>
      </SectionBar>

      <div className="batch-strip" style={{ padding: '12px 16px', gap: 10, flexWrap: 'wrap', background: 'linear-gradient(135deg,var(--panel),var(--panel-2))', borderBottom: '1px solid var(--line)' }}>
        <div className="sb-search" style={{ minWidth: 240, borderRadius: 10 }}>
          <span className="sic">{Icon.search({ size: 12 })}</span>
          <input placeholder="🔍 Search files, payers, types… 📁" value={q} onChange={(e) => setQ(e.target.value)} data-testid="bf-search" />
        </div>
        <select className="input" style={{ height: 34, borderRadius: 10 }} value={payerF} onChange={(e) => setPayerF(e.target.value)} data-testid="bf-payer-filter">
          <option value="all">🌐 All payers</option>
          {payers.map((p) => <option key={p} value={p}>🏥 {p}</option>)}
        </select>
        <select className="input" style={{ height: 34, borderRadius: 10 }} value={formatF} onChange={(e) => setFormatF(e.target.value)} data-testid="bf-format-filter">
          <option value="all">📑 All formats</option>
          {formats.map((f) => <option key={f} value={f}>{formatMeta[f]?.icon || '📄'} {f}</option>)}
        </select>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, background: 'var(--panel)', padding: '4px 10px', borderRadius: 10, border: '1px solid var(--line)' }}>📅 From<input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} data-testid="bf-from" style={{ height: 28, borderRadius: 6 }} /></label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, background: 'var(--panel)', padding: '4px 10px', borderRadius: 10, border: '1px solid var(--line)' }}>📅 To<input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} data-testid="bf-to" style={{ height: 28, borderRadius: 6 }} /></label>
        <span className="muted" style={{ marginLeft: 'auto', fontSize: 11, background: 'var(--panel-2)', padding: '6px 12px', borderRadius: 20 }}>📊 {rows.length} of {files.length} · {formats.slice(0, 3).map((f) => `${formatMeta[f]?.icon || '📄'} ${f}`).join(' · ')}{formats.length > 3 ? ` +${formats.length - 3}` : '' || 'no types yet'}</span>
      </div>

      <div style={{ padding: 16 }}>
        <div className="panel" style={{ borderRadius: 16, overflow: 'hidden', boxShadow: 'var(--shadow-1)', border: '1px solid var(--line)' }}>
          <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 10, background: 'linear-gradient(135deg,#6366f111,#8b5cf611)' }}>
            <span style={{ width: 36, height: 36, borderRadius: 12, background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: '#fff', display: 'grid', placeItems: 'center', boxShadow: '0 4px 12px #6366f140' }}>{Icon.table({ size: 14 })}</span>
            <div><b style={{ fontSize: 14, display: 'flex', alignItems: 'center', gap: 6 }}>📁 File Registry <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 20, background: '#6366f1', color: '#fff' }}>{rows.length} files</span></b><div className="muted" style={{ fontSize: 11 }}>25 per page · resend bumps count 🔄 · void keeps history · Visual type icons</div></div>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
              {formats.slice(0, 4).map((f) => (
                <span key={f} style={{ width: 28, height: 28, borderRadius: 8, background: formatMeta[f]?.color || '#6366f1', color: '#fff', display: 'grid', placeItems: 'center', fontSize: 12 }} title={f}>{formatMeta[f]?.icon || '📄'}</span>
              ))}
            </div>
          </div>

          <div className="py-tbl" data-testid="bf-table" style={{ minHeight: 200 }}>
            <div className="py-thead" style={{ gridTemplateColumns: '2fr 1fr 0.9fr 0.6fr 0.6fr 1fr 0.6fr 1.8fr', background: 'var(--panel-2)', fontSize: 11, borderBottom: '1px solid var(--line)' }}>
              <button className="sortable" data-testid="bf-sort-file" onClick={() => flip('fileName')} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>📄 File Name {sort.k === 'fileName' ? (sort.d > 0 ? '↑' : '↓') : ''}</button>
              <button className="sortable" data-testid="bf-sort-payer" onClick={() => flip('payer')} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>🏥 Payer {sort.k === 'payer' ? (sort.d > 0 ? '↑' : '↓') : ''}</button>
              <button className="sortable" data-testid="bf-sort-format" onClick={() => flip('format')} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>📑 Type {sort.k === 'format' ? (sort.d > 0 ? '↑' : '↓') : ''}</button>
              <span>👥 Clients</span><span>📄 Claims</span>
              <button className="sortable" data-testid="bf-sort-date" onClick={() => flip('date')} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>📅 Billed {sort.k === 'date' ? (sort.d > 0 ? '↑' : '↓') : ''}</button>
              <span>🔄 Sends</span><span>⚡ Actions</span>
            </div>
            {view.length === 0 && <div className="py-empty" data-testid="bf-empty" style={{ padding: 40, textAlign: 'center' }}><div style={{ width: 72, height: 72, borderRadius: 16, background: 'linear-gradient(135deg,#6366f111,#8b5cf611)', display: 'grid', placeItems: 'center', margin: '0 auto 14px', fontSize: 32 }}>📁</div><b>No billed files 📭</b><div className="muted" style={{ fontSize: 12, marginTop: 6 }}>Submit claims from Billing, then Generate here. Registry includes 837P, CMS-1500, invoices, QBO, verification, appeals, remittance.</div><div style={{ marginTop: 12, display: 'flex', gap: 6, justifyContent: 'center' }}><span className="tag soft" style={{ borderRadius: 20 }}>🏥 837P</span><span className="tag soft" style={{ borderRadius: 20 }}>📄 CMS-1500</span><span className="tag soft" style={{ borderRadius: 20 }}>🧾 Invoice</span><span className="tag soft" style={{ borderRadius: 20 }}>💚 QBO</span></div></div>}
            {view.map((f) => {
              const fm = formatMeta[f.format] || { icon: '📄', color: '#6366f1' }
              return (
                <div className={`py-trow ${f.voided ? 'is-void' : ''}`} key={f.id} data-testid={`bf-row-${f.id}`} style={{ gridTemplateColumns: '2fr 1fr 0.9fr 0.6fr 0.6fr 1fr 0.6fr 1.8fr', opacity: f.voided ? 0.55 : 1, borderLeft: `3px solid ${f.voided ? '#ef4444' : fm.color}`, transition: 'all .12s' }}>
                  <div className="py-idcell"><div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span style={{ width: 28, height: 28, borderRadius: 8, background: fm.color, color: '#fff', display: 'grid', placeItems: 'center', fontSize: 12 }}>{fm.icon}</span><div><b style={{ fontSize: 11 }}>{f.fileName}</b><span className="muted" style={{ fontSize: 10.5, display: 'block' }}>{f.clientNames || ''}{f.voided ? ' · 🚫 VOIDED' : ''}</span></div></div></div>
                  <div className="py-cell"><span className="tag soft" style={{ fontSize: 10, borderRadius: 20, display: 'inline-flex', alignItems: 'center', gap: 3 }}>🏥 {f.payer || '—'}</span></div>
                  <div className="py-cell"><span className="tag" style={{ fontSize: 10, borderRadius: 20, background: fm.color, color: '#fff', display: 'inline-flex', alignItems: 'center', gap: 3 }}>{fm.icon} {f.format || '837P'}</span></div>
                  <div className="py-cell num"><b>👥 {f.clientCount}</b></div>
                  <div className="py-cell num"><b>📄 {f.claimCount}</b></div>
                  <div className="py-cell"><span className="muted" style={{ fontSize: 11, background: 'var(--panel-2)', padding: '2px 8px', borderRadius: 20 }}>📅 {f.date}</span></div>
                  <div className="py-cell num"><span className={`py-cnt${f.sendCount > 1 ? '' : ' z'}`} style={{ fontSize: 11, background: f.sendCount > 1 ? '#fef3c7' : 'var(--panel-2)', padding: '2px 8px', borderRadius: 20, fontWeight: f.sendCount > 1 ? 700 : 400 }}>🔄 {f.sendCount || 1}</span></div>
                  <div className="py-cell" style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    <button className="btn btn-xs" data-testid={`bf-download-${f.id}`} onClick={() => downloadFile(f)} style={{ borderRadius: 8 }}>📥 DL</button>
                    <button className="btn btn-xs" data-testid={`bf-resend-${f.id}`} onClick={() => resend(f)} style={{ borderRadius: 8 }}>🔄 Resend</button>
                    <button className="btn btn-xs" data-testid={`bf-view-${f.id}`} onClick={() => setSelected(f)} style={{ borderRadius: 8, background: '#6366f1', color: '#fff' }}>👁️ View</button>
                    {!f.voided && <button className="btn btn-xs" data-testid={`bf-void-${f.id}`} onClick={() => voidFile(f)} style={{ borderRadius: 8, background: '#fef2f2', color: '#ef4444' }}>🚫 Void</button>}
                  </div>
                </div>
              )
            })}
            <div className="py-pager" data-testid="bf-pager" style={{ padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid var(--line)', background: 'linear-gradient(135deg,var(--panel-2),var(--panel))' }}>
              <span className="muted" style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 6 }}>📊 {rows.length ? `${page * PAGE_SIZE + 1}–${Math.min(rows.length, (page + 1) * PAGE_SIZE)} of ${rows.length}` : '0 files'} · Visual registry 📁</span>
              {pages > 1 && <span className="py-pages" style={{ display: 'flex', gap: 4 }}>{Array.from({ length: pages }, (_, i) => <button key={i} className={`pg-num${i === page ? ' on' : ''}`} data-testid={`bf-page-${i}`} onClick={() => setPage(i)} style={{ minWidth: 32, height: 32, borderRadius: 8, background: i === page ? '#6366f1' : 'var(--panel)', color: i === page ? '#fff' : 'var(--text)', border: '1px solid var(--line)' }}>{i + 1}</button>)}</span>}
            </div>
          </div>
        </div>

        {selected && (
          <div className="panel" style={{ marginTop: 16, borderRadius: 16, overflow: 'hidden', boxShadow: 'var(--shadow-1)', border: '1px solid var(--line)' }} data-testid="bf-detail">
            <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 10, background: `linear-gradient(135deg,${formatMeta[selected.format]?.color || '#6366f1'}11,#fff)` }}>
              <span style={{ width: 32, height: 32, borderRadius: 10, background: formatMeta[selected.format]?.color || '#6366f1', color: '#fff', display: 'grid', placeItems: 'center' }}>{formatMeta[selected.format]?.icon || '📄'}</span>
              <div><b style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>📄 File Detail — {selected.fileName} <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 20, background: formatMeta[selected.format]?.color || '#6366f1', color: '#fff' }}>{selected.format}</span></b><div className="muted" style={{ fontSize: 11 }}>{selected.payer} · {selected.clientCount} clients · {selected.claimCount} claims · 🔄 {selected.sendCount} sends</div></div>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                <button className="btn btn-xs btn-primary" onClick={() => downloadFile(selected)} data-testid="bf-detail-download" style={{ borderRadius: 8 }}>📥 Download</button>
                <button className="btn btn-xs" onClick={() => setSelected(null)} data-testid="bf-detail-close" style={{ borderRadius: 8 }}>{Icon.x({ size: 11 })} Close</button>
              </div>
            </div>
            <div style={{ padding: 16, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div style={{ fontSize: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {[
                  ['🏥 Payer', selected.payer],
                  ['📑 Format', selected.format, true],
                  ['📅 Date', selected.date],
                  ['👥 Clients / 📄 Claims', `${selected.clientCount} / ${selected.claimCount}`],
                  ['🔄 Send Count', String(selected.sendCount), true],
                  ['⏰ Created', new Date(selected.createdAt).toLocaleString()],
                ].map(([label, val, isTag]) => (
                  <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 10px', borderRadius: 8, background: 'var(--panel-2)', border: '1px solid var(--line)' }}><span className="muted">{label}</span>{isTag ? <span className="tag" style={{ borderRadius: 20 }}>{val}</span> : <b>{val}</b>}</div>
                ))}
                {selected.claimIds?.length > 0 && <div style={{ marginTop: 8, fontSize: 11, background: 'var(--panel-2)', padding: '8px 10px', borderRadius: 8 }}><span className="muted">📄 Claims:</span> <span style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>{selected.claimIds.slice(0, 10).map((id) => <span key={id} style={{ background: 'var(--panel)', padding: '1px 6px', borderRadius: 6, border: '1px solid var(--line)', fontSize: 10 }}>📄 {id.slice(0, 8)}</span>)}{selected.claimIds.length > 10 ? ` +${selected.claimIds.length - 10} more` : ''}</span></div>}
              </div>
              <div style={{ background: 'var(--panel-2)', border: '1px solid var(--line)', borderRadius: 12, padding: 14, maxHeight: 260, overflow: 'auto', fontSize: 11, whiteSpace: 'pre-wrap', fontFamily: 'monospace' }} data-testid="bf-detail-content">
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, fontFamily: 'sans-serif' }}><span style={{ width: 20, height: 20, borderRadius: 6, background: '#6366f1', color: '#fff', display: 'grid', placeItems: 'center', fontSize: 10 }}>📄</span><b>File Content Preview</b><span className="muted" style={{ fontSize: 10 }}>· {selected.content?.length || 0} chars</span></div>
                {(selected.content || '').slice(0, 5000) || 'No content 📭'}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
