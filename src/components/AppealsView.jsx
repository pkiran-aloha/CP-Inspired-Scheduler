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
import { PersonAvatar } from '../ui/avatars'

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
    actions.record('billedFiles', { fileName: letter.fileName, payer: selectedClaim.payer, clientCount: 1, claimCount: 1, claimIds: [selectedClaim.id], date: todayISO(), sendCount: 1, content: letter.content, createdAt: Date.now(), format: 'appeal_letter' })
    toast({ message: `Appeal letter ${letter.fileName} generated for ${selectedClaim.no}`, kind: 'ok' })
  }

  const generateErrorReport = () => {
    if (!eraId) { toast({ message: 'Select an ERA import', kind: 'warn' }); return }
    const report = build835ErrorReport(state, { eraId })
    download(report.fileName, report.content)
    actions.record('billedFiles', { fileName: report.fileName, payer: 'ERA', clientCount: 0, claimCount: 0, claimIds: [], date: todayISO(), sendCount: 1, content: report.content, createdAt: Date.now(), format: '835_error_report' })
    toast({ message: `835 Error Report ${report.fileName} generated`, kind: 'ok' })
  }

  const clear = () => {
    setQ(''); setSelectedClaimId(null); setNarrative('Please reconsider — medical necessity documented, authorization on file, notes attached.'); setEnclosures('Progress Notes, Auth Letter, Session Notes'); setEraId('')
    toast({ message: 'Form cleared', kind: 'info' })
  }

  return (
    <div className="sectionpage" data-testid="appeal-sec" style={{ background: 'var(--bg)' }}>
      <SectionBar icon="file" title="Appeals Manager" sub={`🚫 ${deniedClaims.length} denied · 📝 appeal letters + ⚠️ 835 error reports · ${range.label} · Visual denial management`}>
        <RangePicker preset={preset} onPreset={(p) => actions.setUI({ appealPreset: p })} onSlide={(d) => actions.setUI({ anchor: isoDate(addDays(parseISO(ui.anchor), d * range.days.length)) })} label={range.label} />
        <div className="sb-search" style={{ minWidth: 220, borderRadius: 10 }}>
          <span className="sic">{Icon.search({ size: 12 })}</span>
          <input placeholder="🔍 Search denied claims… 🚫" value={q} onChange={(e) => setQ(e.target.value)} data-testid="appeal-search" />
        </div>
        <button className="btn btn-sm" onClick={clear} data-testid="appeal-clear" style={{ borderRadius: 10 }}>{Icon.x({ size: 12 })} Clear</button>
        <button className="btn btn-sm btn-primary" onClick={generateAppeal} data-testid="appeal-generate" style={{ borderRadius: 10, background: 'linear-gradient(135deg,#ef4444,#dc2626)', border: 'none', boxShadow: '0 4px 12px #ef444440' }}>{Icon.file({ size: 12 })} Generate Appeal</button>
      </SectionBar>

      <div className="batch-strip" style={{ padding: '12px 16px', gap: 10, background: 'linear-gradient(135deg,#fef2f2,#fee2e2)', borderBottom: '1px solid #fecaca' }}>
        {[
          ['Denied', String(deniedClaims.length), '#ef4444', '🚫'],
          ['Appeal Letters', String(appealFiles.length), '#6366f1', '📝'],
          ['Error Reports', String(errorReports.length), '#f59e0b', '⚠️'],
        ].map(([label, val, color, ic]) => (
          <span key={label} className="rp-sumchip on" style={{ background: 'var(--panel)', border: `1px solid ${label === 'Denied' ? '#fecaca' : 'var(--line)'}`, display: 'flex', gap: 8, alignItems: 'center', borderRadius: 12, padding: '8px 14px', boxShadow: 'var(--shadow-1)' }}>
            <span style={{ width: 28, height: 28, borderRadius: 8, background: color, color: '#fff', display: 'grid', placeItems: 'center', fontSize: 12 }}>{ic}</span>
            <span><b style={{ fontSize: 13 }}>{val}</b><span style={{ display: 'block', fontSize: 10, color: 'var(--muted)' }}>{label}</span></span>
          </span>
        ))}
        <span className="muted" style={{ marginLeft: 'auto', fontSize: 11, background: 'var(--panel)', padding: '6px 12px', borderRadius: 20, display: 'flex', alignItems: 'center', gap: 6 }}>💡 Letters use org letterhead + denial CARC + narrative + enclosures · Visual appeal workflow 📝</span>
      </div>

      <div style={{ padding: 16, display: 'grid', gridTemplateColumns: '440px 1fr', gap: 16, alignItems: 'start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="panel" style={{ borderRadius: 16, overflow: 'hidden', boxShadow: 'var(--shadow-1)', border: '1px solid var(--line)' }}>
            <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 10, background: 'linear-gradient(135deg,#ef444411,#dc262611)' }}>
              <span style={{ width: 36, height: 36, borderRadius: 12, background: 'linear-gradient(135deg,#ef4444,#dc2626)', color: '#fff', display: 'grid', placeItems: 'center', boxShadow: '0 4px 12px #ef444440' }}>{Icon.ban({ size: 16 })}</span>
              <div><b style={{ fontSize: 14, display: 'flex', alignItems: 'center', gap: 6 }}>🚫 Denied Claims <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 20, background: '#ef4444', color: '#fff' }}>{deniedClaims.length} need appeal</span></b><div className="muted" style={{ fontSize: 11 }}>Click to select for appeal letter 📝</div></div>
            </div>
            <div className="py-tbl" data-testid="appeal-denied-table" style={{ maxHeight: 360, overflow: 'auto' }}>
              <div className="py-thead" style={{ gridTemplateColumns: '1fr 1fr 0.9fr 1fr 0.6fr', background: 'var(--panel-2)', fontSize: 11, borderBottom: '1px solid var(--line)' }}><span>🔢 Claim #</span><span>👤 Client</span><span>🏥 Payer</span><span>📝 Reason</span><span>💰 Due</span></div>
              {deniedClaims.slice(0, 50).map((c) => {
                const cl = clients.find((x) => x.id === c.clientId)
                const isSel = selectedClaim?.id === c.id
                return (
                  <div key={c.id} className={`py-trow ${isSel ? 'on' : ''}`} data-testid={`appeal-row-${c.id}`} onClick={() => setSelectedClaimId(c.id)} style={{ gridTemplateColumns: '1fr 1fr 0.9fr 1fr 0.6fr', cursor: 'pointer', background: isSel ? 'linear-gradient(135deg,#fef2f2,#fff)' : undefined, fontSize: 11, borderLeft: `3px solid ${isSel ? '#ef4444' : 'transparent'}`, transition: 'all .12s' }}>
                    <div className="py-cell"><span className="ln-code" style={{ background: isSel ? '#fee2e2' : 'var(--panel-2)', padding: '2px 6px', borderRadius: 6 }}>🚫 {c.no}</span></div>
                    <div className="py-idcell"><div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><PersonAvatar p={cl} size={20} /><b style={{ fontSize: 11 }}>{cl?.name || c.clientId}</b></div></div>
                    <div className="py-cell"><span className="tag soft" style={{ fontSize: 10, borderRadius: 20 }}>🏥 {c.payer}</span></div>
                    <div className="py-cell muted" style={{ fontSize: 10, overflow: 'hidden', textOverflow: 'ellipsis', display: 'flex', alignItems: 'center', gap: 3 }}>📝 {c.denial?.reason || '—'}</div>
                    <div className="py-cell num"><b style={{ color: '#dc2626', background: '#fef2f2', padding: '2px 8px', borderRadius: 20 }}>💰 {money(dueOf(c))}</b></div>
                  </div>
                )
              })}
              {!deniedClaims.length && <div className="py-empty" style={{ padding: 32, textAlign: 'center' }}><div style={{ width: 64, height: 64, borderRadius: 16, background: 'linear-gradient(135deg,#10b98111,#05966911)', display: 'grid', placeItems: 'center', margin: '0 auto 12px', fontSize: 32 }}>✅</div><b>No denied claims 🎉</b><div className="muted" style={{ fontSize: 11 }}>Denials from Payment Center or ERA will appear here. All clear!</div></div>}
            </div>
          </div>

          <div className="panel" style={{ borderRadius: 16, overflow: 'hidden', boxShadow: 'var(--shadow-1)', border: '1px solid var(--line)' }}>
            <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--line)', background: 'linear-gradient(135deg,#6366f111,#8b5cf611)', display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ width: 32, height: 32, borderRadius: 10, background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: '#fff', display: 'grid', placeItems: 'center' }}>{Icon.edit({ size: 14 })}</span>
              <div><b style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>📝 Appeal Letter <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 20, background: '#6366f1', color: '#fff' }}>{selectedClaim?.no || 'Select claim'}</span></b><div className="muted" style={{ fontSize: 11 }}>Medical necessity + auth + narrative ✍️</div></div>
            </div>
            <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
              <label className="bil-fld" style={{ margin: 0 }}><span style={{ display: 'flex', alignItems: 'center', gap: 4, fontWeight: 700 }}>🔢 Selected Claim</span><input className="input" value={selectedClaim?.no || ''} readOnly data-testid="appeal-claim" style={{ borderRadius: 10, height: 40, background: 'var(--panel-2)' }} /></label>
              <label className="bil-fld" style={{ margin: 0 }}><span style={{ display: 'flex', alignItems: 'center', gap: 4, fontWeight: 700 }}>📝 Narrative</span><textarea className="input" rows={4} value={narrative} onChange={(e) => setNarrative(e.target.value)} data-testid="appeal-narrative" style={{ borderRadius: 12 }} placeholder="💬 Please reconsider — medical necessity documented…" /></label>
              <label className="bil-fld" style={{ margin: 0 }}><span style={{ display: 'flex', alignItems: 'center', gap: 4, fontWeight: 700 }}>📎 Enclosures (comma separated)</span><input className="input" value={enclosures} onChange={(e) => setEnclosures(e.target.value)} data-testid="appeal-enclosures" style={{ borderRadius: 10, height: 40 }} placeholder="📎 Progress Notes, Auth Letter…" /></label>
              <button className="btn btn-sm btn-primary" onClick={generateAppeal} data-testid="appeal-generate-2" style={{ width: 'fit-content', borderRadius: 10, background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', border: 'none', boxShadow: '0 4px 12px #6366f140', height: 36 }}>{Icon.file({ size: 12 })} 📝 Generate Appeal Letter</button>
            </div>
          </div>

          <div className="panel" style={{ borderRadius: 16, overflow: 'hidden', boxShadow: 'var(--shadow-1)', border: '1px solid var(--line)' }}>
            <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--line)', background: 'linear-gradient(135deg,#f59e0b11,#f9731611)', display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ width: 32, height: 32, borderRadius: 10, background: 'linear-gradient(135deg,#f59e0b,#f97316)', color: '#fff', display: 'grid', placeItems: 'center' }}>{Icon.file({ size: 14 })}</span>
              <div><b style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>⚠️ 835 Error Report</b><div className="muted" style={{ fontSize: 11 }}>Unmatched ERA lines with suggested match 🔍</div></div>
            </div>
            <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <label className="bil-fld" style={{ margin: 0 }}><span style={{ display: 'flex', alignItems: 'center', gap: 4, fontWeight: 700 }}>📄 ERA Import</span>
                <select className="input" value={eraId} onChange={(e) => setEraId(e.target.value)} data-testid="appeal-era" style={{ borderRadius: 10, height: 40 }}>
                  <option value="">Select ERA… 📄</option>
                  {Object.values(state.eraImports || {}).map((era) => <option key={era.id} value={era.id}>📄 {era.fileName} · ⚠️ {era.unmatched} unmatched</option>)}
                </select>
              </label>
              <button className="btn btn-sm" onClick={generateErrorReport} data-testid="appeal-error-generate" style={{ width: 'fit-content', borderRadius: 10, background: '#f59e0b', color: '#fff', border: 'none' }}>{Icon.download({ size: 11 })} 📊 Generate 835 Error CSV</button>
              <div className="muted" style={{ fontSize: 11, lineHeight: 1.5, background: 'var(--panel-2)', padding: '8px 12px', borderRadius: 8, display: 'flex', gap: 6 }}><span>💡</span>Lists unmatched ERA lines with suggested match. Parked ERAs with unmatched lines appear here for resolution.</div>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="panel" style={{ borderRadius: 16, overflow: 'hidden', boxShadow: 'var(--shadow-1)', border: '1px solid var(--line)' }}>
            <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 10, background: 'linear-gradient(135deg,#10b98111,#05966911)' }}>
              <span style={{ width: 32, height: 32, borderRadius: 10, background: 'linear-gradient(135deg,#10b981,#059669)', color: '#fff', display: 'grid', placeItems: 'center' }}>{Icon.file({ size: 14 })}</span>
              <div><b style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>📝 Appeal Letters History — {appealFiles.length} <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 20, background: '#10b981', color: '#fff' }}>Generated</span></b><div className="muted" style={{ fontSize: 11 }}>Branded letters with letterhead + signatures ✍️</div></div>
            </div>
            {appealFiles.length === 0 ? (
              <div className="py-empty" data-testid="appeal-empty" style={{ padding: 40, textAlign: 'center' }}>
                <div style={{ width: 72, height: 72, borderRadius: 16, background: 'linear-gradient(135deg,#6366f111,#8b5cf611)', display: 'grid', placeItems: 'center', margin: '0 auto 14px', fontSize: 32 }}>📝</div>
                <b>No appeal letters yet 📭</b><div className="muted" style={{ fontSize: 12, marginTop: 6 }}>Generate from a denied claim to see history. Each letter uses org letterhead + denial CARC + narrative + enclosures.</div>
              </div>
            ) : (
              <div className="py-tbl" data-testid="appeal-history-table" style={{ maxHeight: 320, overflow: 'auto' }}>
                <div className="py-thead" style={{ gridTemplateColumns: '2fr 1fr 1fr 1fr 0.8fr', background: 'var(--panel-2)', fontSize: 11 }}><span>📄 File</span><span>🏥 Payer</span><span>🔢 Claim</span><span>📅 Date</span><span>⚡ Actions</span></div>
                {appealFiles.sort((a, b) => b.createdAt - a.createdAt).slice(0, 50).map((f) => (
                  <div key={f.id} className="py-trow" data-testid={`appeal-file-row-${f.id}`} style={{ gridTemplateColumns: '2fr 1fr 1fr 1fr 0.8fr', fontSize: 11 }}>
                    <div className="py-idcell"><div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ width: 24, height: 24, borderRadius: 6, background: '#6366f1', color: '#fff', display: 'grid', placeItems: 'center', fontSize: 10 }}>📝</span><b style={{ fontSize: 11 }}>{f.fileName}</b></div></div>
                    <div className="py-cell"><span className="tag soft" style={{ fontSize: 10, borderRadius: 20 }}>🏥 {f.payer}</span></div>
                    <div className="py-cell"><span className="ln-code" style={{ background: 'var(--panel-2)', padding: '2px 6px', borderRadius: 6 }}>📄 {f.claimIds?.[0] ? claims[f.claimIds[0]]?.no || f.claimIds[0] : '—'}</span></div>
                    <div className="py-cell muted" style={{ fontSize: 11 }}>📅 {f.date}</div>
                    <div className="py-cell"><button className="btn btn-xs" data-testid={`appeal-download-${f.id}`} onClick={() => download(f.fileName, f.content)} style={{ borderRadius: 8 }}>{Icon.download({ size: 10 })} Download</button></div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="panel" style={{ borderRadius: 16, overflow: 'hidden', boxShadow: 'var(--shadow-1)', border: '1px solid var(--line)' }}>
            <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 10, background: 'linear-gradient(135deg,#f59e0b11,#f9731611)' }}>
              <span style={{ width: 32, height: 32, borderRadius: 10, background: 'linear-gradient(135deg,#f59e0b,#f97316)', color: '#fff', display: 'grid', placeItems: 'center' }}>{Icon.alert({ size: 14 })}</span>
              <div><b style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>⚠️ 835 Error Reports — {errorReports.length}</b><div className="muted" style={{ fontSize: 11 }}>Unmatched ERA lines with suggested matches 🔍</div></div>
            </div>
            {errorReports.length === 0 ? (
              <div className="py-empty" data-testid="appeal-error-empty" style={{ padding: 32, textAlign: 'center' }}><div style={{ width: 48, height: 48, borderRadius: 12, background: 'var(--panel-2)', display: 'grid', placeItems: 'center', margin: '0 auto 10px', fontSize: 24 }}>📊</div><b>No error reports yet 📭</b><div className="muted" style={{ fontSize: 11 }}>Generate from ERA import with unmatched lines</div></div>
            ) : (
              <div className="py-tbl" data-testid="appeal-error-table" style={{ maxHeight: 240, overflow: 'auto' }}>
                <div className="py-thead" style={{ gridTemplateColumns: '2fr 1fr 0.8fr', background: 'var(--panel-2)', fontSize: 11 }}><span>📄 File</span><span>📅 Date</span><span>⚡ Actions</span></div>
                {errorReports.sort((a, b) => b.createdAt - a.createdAt).slice(0, 20).map((f) => (
                  <div key={f.id} className="py-trow" data-testid={`appeal-error-row-${f.id}`} style={{ gridTemplateColumns: '2fr 1fr 0.8fr', fontSize: 11 }}>
                    <div className="py-idcell"><div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ width: 24, height: 24, borderRadius: 6, background: '#f59e0b', color: '#fff', display: 'grid', placeItems: 'center', fontSize: 10 }}>⚠️</span><b style={{ fontSize: 11 }}>{f.fileName}</b></div></div>
                    <div className="py-cell muted">📅 {f.date}</div>
                    <div className="py-cell"><button className="btn btn-xs" data-testid={`appeal-error-download-${f.id}`} onClick={() => download(f.fileName, f.content)} style={{ borderRadius: 8 }}>{Icon.download({ size: 10 })} DL</button></div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {selectedClaim && (
            <div className="panel" style={{ borderRadius: 16, padding: 18, background: 'linear-gradient(135deg,var(--panel-2),var(--panel))', border: '1px solid var(--line)', boxShadow: 'var(--shadow-1)' }} data-testid="appeal-preview">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}><span style={{ width: 32, height: 32, borderRadius: 10, background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: '#fff', display: 'grid', placeItems: 'center' }}>{Icon.info({ size: 14 })}</span><div><b style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>👁️ Preview — {selectedClaim.no} <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 20, background: '#ef4444', color: '#fff' }}>Denied</span></b><div className="muted" style={{ fontSize: 11 }}>Denial details + fix suggestion + appeal preview 📝</div></div></div>
              <div style={{ fontSize: 11, display: 'grid', gap: 8 }}>
                {[
                  ['👤 Client', clients.find((c) => c.id === selectedClaim.clientId)?.name, true],
                  ['🏥 Payer', selectedClaim.payer, false, true],
                  ['🚫 Denial', `${selectedClaim.denial?.code} — ${selectedClaim.denial?.reason}`, false],
                  ['💡 Fix', selectedClaim.denial?.fix, false],
                  ['💰 Charges / Due', `${money(selectedClaim.charges)} / ${money(dueOf(selectedClaim))}`, true],
                ].map(([label, val, bold, isTag]) => (
                  <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 12px', borderRadius: 10, background: 'var(--panel)', border: '1px solid var(--line)' }}><span className="muted">{label}</span>{isTag ? <span className="tag soft" style={{ borderRadius: 20 }}>{val}</span> : bold ? <b>{val}</b> : <span>{val}</span>}</div>
                ))}
              </div>
              <div style={{ marginTop: 12, padding: '10px 12px', borderRadius: 10, background: '#fef3c7', border: '1px solid #fde68a', fontSize: 11, display: 'flex', gap: 8 }}><span>💡</span><span><b>Appeal strategy:</b> Include {enclosures || 'enclosures'} with letterhead, reference denial CARC {selectedClaim.denial?.code}, and narrative: "{narrative.slice(0, 80)}..."</span></div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
