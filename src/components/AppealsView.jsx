import React, { useMemo, useState } from 'react'
import { useStore } from '../state/store'
import { SectionBar, RangePicker } from './NavRail'
import { Icon } from '../ui/Icons'
import { useToast } from '../ui/Toast'
import { resolveRange } from '../lib/analytics'
import { download } from '../lib/ics'
import { isoDate, addDays, parseISO, todayISO } from '../lib/date'
import { dueOf } from '../lib/claims'
import { buildAppealLetter, build835ErrorReport } from '../lib/billingDocs'

const money = (n) => `$${(Math.round(n * 100) / 100).toLocaleString(undefined, { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`

export default function AppealsView() {
  const state = useStore()
  const { ui, actions, settings, claims, clients } = state
  const toast = useToast()
  const preset = ui.appealPreset || 'last4'
  const range = useMemo(() => resolveRange(preset, ui.anchor, settings.weekStart), [preset, ui.anchor, settings.weekStart])

  const [q, setQ] = useState('')
  const [selectedClaimId, setSelectedClaimId] = useState(null)
  const [narrative, setNarrative] = useState('Please reconsider — medical necessity documented, authorization on file, notes attached. Service was rendered as per POC.')
  const [enclosures, setEnclosures] = useState('Progress Notes, Auth Letter, Session Notes')
  const [eraId, setEraId] = useState('')

  const deniedClaims = useMemo(() => {
    return Object.values(claims).filter((c) => {
      if (c.status !== 'denied') return false
      if (q.trim()) {
        const cl = clients.find((x) => x.id === c.clientId)
        const hay = `${c.no} ${cl?.name || ''} ${c.payer} ${c.denial?.reason || ''}`.toLowerCase()
        if (!hay.includes(q.trim().toLowerCase())) return false
      }
      return true
    }).sort((a, b) => (b.denial?.at || b.closedAt || 0) - (a.denial?.at || a.closedAt || 0))
  }, [claims, clients, q])

  const appealFiles = useMemo(() => Object.values(state.billedFiles || {}).filter((f) => (f.format || '').includes('appeal') || f.fileName?.startsWith('Appeal-')), [state.billedFiles])
  const errorReports = useMemo(() => Object.values(state.billedFiles || {}).filter((f) => (f.format || '').includes('835') || f.fileName?.startsWith('835-Error-')), [state.billedFiles])

  const selectedClaim = selectedClaimId ? claims[selectedClaimId] : deniedClaims[0]

  const generateAppeal = () => {
    if (!selectedClaim) { toast({ message: 'Select a denied claim', kind: 'warn' }); return }
    const encList = enclosures.split(',').map((s) => s.trim()).filter(Boolean)
    const letter = buildAppealLetter(state, { claimId: selectedClaim.id, narrative, enclosures: encList })
    download(letter.fileName, letter.content)
    actions.record('billedFiles', {
      fileName: letter.fileName, payer: selectedClaim.payer, clientCount: 1, claimCount: 1, claimIds: [selectedClaim.id],
      date: todayISO(), sendCount: 1, content: letter.content, createdAt: Date.now(), format: 'appeal_letter',
    })
    toast({ message: `Appeal letter ${letter.fileName} generated for ${selectedClaim.no}`, kind: 'ok' })
  }

  const generateErrorReport = () => {
    if (!eraId) { toast({ message: 'Select an ERA import', kind: 'warn' }); return }
    const report = build835ErrorReport(state, { eraId })
    download(report.fileName, report.content)
    actions.record('billedFiles', {
      fileName: report.fileName, payer: 'ERA', clientCount: 0, claimCount: 0, claimIds: [],
      date: todayISO(), sendCount: 1, content: report.content, createdAt: Date.now(), format: '835_error_report',
    })
    toast({ message: `835 Error Report ${report.fileName} generated`, kind: 'ok' })
  }

  const clear = () => {
    setQ(''); setSelectedClaimId(null); setNarrative('Please reconsider — medical necessity documented, authorization on file, notes attached.'); setEnclosures('Progress Notes, Auth Letter, Session Notes'); setEraId('')
    toast({ message: 'Form cleared', kind: 'info' })
  }

  return (
    <div className="sectionpage" data-testid="appeal-sec">
      <SectionBar icon="file" title="Appeals Manager" sub={`${deniedClaims.length} denied · appeal letters + 835 error reports · ${range.label}`}>
        <RangePicker preset={preset} onPreset={(p) => actions.setUI({ appealPreset: p })} onSlide={(d) => actions.setUI({ anchor: isoDate(addDays(parseISO(ui.anchor), d * range.days.length)) })} label={range.label} />
        <div className="sb-search" style={{ minWidth: 200 }}>
          <span className="sic">{Icon.search({ size: 12 })}</span>
          <input placeholder="Search denied claims…" value={q} onChange={(e) => setQ(e.target.value)} data-testid="appeal-search" />
        </div>
        <button className="btn btn-sm" onClick={clear} data-testid="appeal-clear">{Icon.x({ size: 12 })} Clear</button>
        <button className="btn btn-sm btn-primary" onClick={generateAppeal} data-testid="appeal-generate">{Icon.file({ size: 12 })} Generate Appeal</button>
      </SectionBar>

      <div className="batch-strip" style={{ padding: '10px 16px', gap: 10 }}>
        <span className="rp-sumchip on" style={{ background: '#fee2e2', border: '1px solid #fecaca' }}><b>{deniedClaims.length}</b><span>Denied</span></span>
        <span className="rp-sumchip"><b>{appealFiles.length}</b><span>Appeal Letters</span></span>
        <span className="rp-sumchip"><b>{errorReports.length}</b><span>Error Reports</span></span>
        <span className="muted" style={{ marginLeft: 'auto', fontSize: 11 }}>Letters use org letterhead + denial CARC + narrative + enclosures</span>
      </div>

      <div style={{ padding: 16, display: 'grid', gridTemplateColumns: '420px 1fr', gap: 16, alignItems: 'start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="panel" style={{ borderRadius: 12, overflow: 'hidden', boxShadow: 'var(--shadow-1)' }}>
            <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 8, background: 'var(--panel-2)' }}>
              <span style={{ width: 28, height: 28, borderRadius: 8, background: '#ef4444', color: '#fff', display: 'grid', placeItems: 'center' }}>{Icon.ban({ size: 14 })}</span>
              <div><b style={{ fontSize: 13 }}>Denied Claims</b><div className="muted" style={{ fontSize: 11 }}>{deniedClaims.length} need appeal</div></div>
            </div>
            <div className="py-tbl" data-testid="appeal-denied-table" style={{ maxHeight: 320, overflow: 'auto' }}>
              <div className="py-thead" style={{ gridTemplateColumns: '1fr 1fr 0.9fr 1fr 0.6fr', background: 'var(--panel-2)', fontSize: 11 }}><span>Claim #</span><span>Client</span><span>Payer</span><span>Reason</span><span>Due</span></div>
              {deniedClaims.slice(0, 50).map((c) => {
                const cl = clients.find((x) => x.id === c.clientId)
                const isSel = selectedClaim?.id === c.id
                return (
                  <div key={c.id} className={`py-trow ${isSel ? 'on' : ''}`} data-testid={`appeal-row-${c.id}`} onClick={() => setSelectedClaimId(c.id)} style={{ gridTemplateColumns: '1fr 1fr 0.9fr 1fr 0.6fr', cursor: 'pointer', background: isSel ? 'var(--panel-2)' : undefined, fontSize: 11 }}>
                    <div className="py-cell"><span className="ln-code">{c.no}</span></div>
                    <div className="py-idcell"><b style={{ fontSize: 11 }}>{cl?.name || c.clientId}</b></div>
                    <div className="py-cell"><span className="tag soft" style={{ fontSize: 10 }}>{c.payer}</span></div>
                    <div className="py-cell muted" style={{ fontSize: 10, overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.denial?.reason || '—'}</div>
                    <div className="py-cell num"><b>{money(dueOf(c))}</b></div>
                  </div>
                )
              })}
              {!deniedClaims.length && <div className="py-empty" style={{ padding: 24, textAlign: 'center' }}><b>No denied claims</b><div className="muted" style={{ fontSize: 11 }}>Denials from Payment Center or ERA will appear here.</div></div>}
            </div>
          </div>

          <div className="panel" style={{ borderRadius: 12, overflow: 'hidden', boxShadow: 'var(--shadow-1)' }}>
            <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--line)', background: 'var(--panel-2)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 24, height: 24, borderRadius: 6, background: '#6366f1', color: '#fff', display: 'grid', placeItems: 'center' }}>{Icon.edit({ size: 11 })}</span>
              <b style={{ fontSize: 12 }}>Appeal Letter</b>
              <span className="tag soft" style={{ marginLeft: 'auto', fontSize: 10 }}>{selectedClaim?.no || 'Select claim'}</span>
            </div>
            <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <label className="bil-fld" style={{ margin: 0 }}><span>Selected Claim</span><input className="input" value={selectedClaim?.no || ''} readOnly data-testid="appeal-claim" /></label>
              <label className="bil-fld" style={{ margin: 0 }}><span>Narrative</span><textarea className="input" rows={4} value={narrative} onChange={(e) => setNarrative(e.target.value)} data-testid="appeal-narrative" style={{ borderRadius: 8 }} /></label>
              <label className="bil-fld" style={{ margin: 0 }}><span>Enclosures (comma separated)</span><input className="input" value={enclosures} onChange={(e) => setEnclosures(e.target.value)} data-testid="appeal-enclosures" /></label>
              <button className="btn btn-sm btn-primary" onClick={generateAppeal} data-testid="appeal-generate-2" style={{ width: 'fit-content' }}>{Icon.file({ size: 11 })} Generate Appeal Letter</button>
            </div>
          </div>

          <div className="panel" style={{ borderRadius: 12, overflow: 'hidden', boxShadow: 'var(--shadow-1)' }}>
            <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--line)', background: 'var(--panel-2)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 24, height: 24, borderRadius: 6, background: '#f59e0b', color: '#fff', display: 'grid', placeItems: 'center' }}>{Icon.file({ size: 11 })}</span>
              <b style={{ fontSize: 12 }}>835 Error Report</b>
            </div>
            <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <label className="bil-fld" style={{ margin: 0 }}><span>ERA Import</span>
                <select className="input" value={eraId} onChange={(e) => setEraId(e.target.value)} data-testid="appeal-era">
                  <option value="">Select ERA…</option>
                  {Object.values(state.eraImports || {}).map((era) => <option key={era.id} value={era.id}>{era.fileName} · {era.unmatched} unmatched</option>)}
                </select>
              </label>
              <button className="btn btn-sm" onClick={generateErrorReport} data-testid="appeal-error-generate" style={{ width: 'fit-content' }}>{Icon.download({ size: 11 })} Generate 835 Error CSV</button>
              <div className="muted" style={{ fontSize: 10.5, lineHeight: 1.4 }}>Lists unmatched ERA lines with suggested match. Parked ERAs with unmatched lines appear here.</div>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="panel" style={{ borderRadius: 12, overflow: 'hidden', boxShadow: 'var(--shadow-1)' }}>
            <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 8, background: 'var(--panel-2)' }}>
              <span style={{ width: 24, height: 24, borderRadius: 6, background: '#10b981', color: '#fff', display: 'grid', placeItems: 'center' }}>{Icon.file({ size: 12 })}</span>
              <b style={{ fontSize: 12 }}>Appeal Letters History — {appealFiles.length}</b>
            </div>
            {appealFiles.length === 0 ? (
              <div className="py-empty" data-testid="appeal-empty" style={{ padding: 32, textAlign: 'center' }}>
                <div style={{ width: 48, height: 48, borderRadius: 12, background: 'var(--panel-2)', display: 'grid', placeItems: 'center', margin: '0 auto 12px', fontSize: 24 }}>📝</div>
                <b>No appeal letters yet</b><div className="muted" style={{ fontSize: 12 }}>Generate from a denied claim to see history.</div>
              </div>
            ) : (
              <div className="py-tbl" data-testid="appeal-history-table" style={{ maxHeight: 280, overflow: 'auto' }}>
                <div className="py-thead" style={{ gridTemplateColumns: '2fr 1fr 1fr 1fr 0.8fr', background: 'var(--panel-2)', fontSize: 11 }}><span>File</span><span>Payer</span><span>Claim</span><span>Date</span><span>Actions</span></div>
                {appealFiles.sort((a, b) => b.createdAt - a.createdAt).slice(0, 50).map((f) => (
                  <div key={f.id} className="py-trow" data-testid={`appeal-file-row-${f.id}`} style={{ gridTemplateColumns: '2fr 1fr 1fr 1fr 0.8fr', fontSize: 11 }}>
                    <div className="py-idcell"><b style={{ fontSize: 11 }}>{f.fileName}</b></div>
                    <div className="py-cell"><span className="tag soft" style={{ fontSize: 10 }}>{f.payer}</span></div>
                    <div className="py-cell"><span className="ln-code">{f.claimIds?.[0] ? claims[f.claimIds[0]]?.no || f.claimIds[0] : '—'}</span></div>
                    <div className="py-cell muted" style={{ fontSize: 11 }}>{f.date}</div>
                    <div className="py-cell"><button className="btn btn-xs" data-testid={`appeal-download-${f.id}`} onClick={() => download(f.fileName, f.content)}>{Icon.download({ size: 10 })} Download</button></div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="panel" style={{ borderRadius: 12, overflow: 'hidden', boxShadow: 'var(--shadow-1)' }}>
            <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 8, background: 'var(--panel-2)' }}>
              <span style={{ width: 24, height: 24, borderRadius: 6, background: '#f59e0b', color: '#fff', display: 'grid', placeItems: 'center' }}>{Icon.alert({ size: 11 })}</span>
              <b style={{ fontSize: 12 }}>835 Error Reports — {errorReports.length}</b>
            </div>
            {errorReports.length === 0 ? (
              <div className="py-empty" data-testid="appeal-error-empty" style={{ padding: 24, textAlign: 'center' }}><b>No error reports yet</b></div>
            ) : (
              <div className="py-tbl" data-testid="appeal-error-table" style={{ maxHeight: 220, overflow: 'auto' }}>
                <div className="py-thead" style={{ gridTemplateColumns: '2fr 1fr 0.8fr', background: 'var(--panel-2)', fontSize: 11 }}><span>File</span><span>Date</span><span>Actions</span></div>
                {errorReports.sort((a, b) => b.createdAt - a.createdAt).slice(0, 20).map((f) => (
                  <div key={f.id} className="py-trow" data-testid={`appeal-error-row-${f.id}`} style={{ gridTemplateColumns: '2fr 1fr 0.8fr', fontSize: 11 }}>
                    <div className="py-idcell"><b style={{ fontSize: 11 }}>{f.fileName}</b></div>
                    <div className="py-cell muted">{f.date}</div>
                    <div className="py-cell"><button className="btn btn-xs" data-testid={`appeal-error-download-${f.id}`} onClick={() => download(f.fileName, f.content)}>{Icon.download({ size: 10 })} DL</button></div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {selectedClaim && (
            <div className="panel" style={{ borderRadius: 12, padding: 16, background: 'var(--panel-2)', border: '1px solid var(--line)' }} data-testid="appeal-preview">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}><span style={{ width: 24, height: 24, borderRadius: 6, background: '#6366f1', color: '#fff', display: 'grid', placeItems: 'center' }}>{Icon.info({ size: 11 })}</span><b style={{ fontSize: 12 }}>Preview — {selectedClaim.no}</b></div>
              <div style={{ fontSize: 11, display: 'grid', gap: 4 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}><span className="muted">Client</span><b>{clients.find((c) => c.id === selectedClaim.clientId)?.name}</b></div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}><span className="muted">Payer</span><span className="tag soft">{selectedClaim.payer}</span></div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}><span className="muted">Denial</span><span>{selectedClaim.denial?.code} — {selectedClaim.denial?.reason}</span></div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}><span className="muted">Fix</span><span>{selectedClaim.denial?.fix}</span></div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}><span className="muted">Charges / Due</span><span>{money(selectedClaim.charges)} / <b>{money(dueOf(selectedClaim))}</b></span></div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
