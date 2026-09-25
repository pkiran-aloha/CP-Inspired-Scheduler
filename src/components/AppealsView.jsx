import React, { useMemo, useState } from 'react'
import { useStore } from '../state/store'
import { SectionBar, RangePicker } from './NavRail'
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
      fileName: letter.fileName,
      payer: selectedClaim.payer,
      clientCount: 1,
      claimCount: 1,
      claimIds: [selectedClaim.id],
      date: todayISO(),
      sendCount: 1,
      content: letter.content,
      createdAt: Date.now(),
      format: 'appeal_letter',
    })
    toast({ message: `Appeal letter ${letter.fileName} generated for ${selectedClaim.no}`, kind: 'ok' })
  }

  const generateErrorReport = () => {
    if (!eraId) { toast({ message: 'Select an ERA import', kind: 'warn' }); return }
    const report = build835ErrorReport(state, { eraId })
    download(report.fileName, report.content)
    actions.record('billedFiles', {
      fileName: report.fileName,
      payer: 'ERA',
      clientCount: 0,
      claimCount: 0,
      claimIds: [],
      date: todayISO(),
      sendCount: 1,
      content: report.content,
      createdAt: Date.now(),
      format: '835_error_report',
    })
    toast({ message: `835 Error Report ${report.fileName} generated`, kind: 'ok' })
  }

  const clear = () => {
    setQ('')
    setSelectedClaimId(null)
    setNarrative('Please reconsider — medical necessity documented, authorization on file, notes attached.')
    setEnclosures('Progress Notes, Auth Letter, Session Notes')
    setEraId('')
    toast({ message: 'Form cleared', kind: 'info' })
  }

  return (
    <div className="sectionpage" data-testid="appeal-sec">
      <SectionBar icon="file" title="Appeals Manager" sub={`Denied claims → appeal letters + 835 error reports · ${deniedClaims.length} denied`}>
        <RangePicker preset={preset} onPreset={(p) => actions.setUI({ appealPreset: p })} onSlide={(d) => actions.setUI({ anchor: isoDate(addDays(parseISO(ui.anchor), d * range.days.length)) })} label={range.label} />
        <input className="input" placeholder="Search denied claims…" value={q} onChange={(e) => setQ(e.target.value)} data-testid="appeal-search" style={{ width: 200, height: 30 }} />
        <button className="btn btn-sm" onClick={clear} data-testid="appeal-clear">Clear</button>
        <button className="btn btn-sm btn-primary" onClick={generateAppeal} data-testid="appeal-generate">Generate Appeal</button>
      </SectionBar>

      <div style={{ padding: 16, display: 'grid', gridTemplateColumns: '380px 1fr', gap: 16 }}>
        <div className="panel" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <h4>Denied Claims</h4>
          <div className="tablewrap" data-testid="appeal-denied-table" style={{ maxHeight: 300, overflow: 'auto' }}>
            <table className="table">
              <thead><tr><th>Claim #</th><th>Client</th><th>Payer</th><th>Reason</th><th>Due</th></tr></thead>
              <tbody>
                {deniedClaims.slice(0, 50).map((c) => {
                  const cl = clients.find((x) => x.id === c.clientId)
                  return (
                    <tr key={c.id} data-testid={`appeal-row-${c.id}`} onClick={() => setSelectedClaimId(c.id)} style={{ cursor: 'pointer', background: selectedClaim?.id === c.id ? 'var(--panel-2)' : 'transparent' }}>
                      <td>{c.no}</td><td>{cl?.name || c.clientId}</td><td>{c.payer}</td><td style={{ maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.denial?.reason || '—'}</td><td>{money(dueOf(c))}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <h4>Appeal Letter</h4>
          <label>Selected Claim<input className="input" value={selectedClaim?.no || ''} readOnly data-testid="appeal-claim" /></label>
          <label>Narrative<textarea className="input" rows={4} value={narrative} onChange={(e) => setNarrative(e.target.value)} data-testid="appeal-narrative" /></label>
          <label>Enclosures (comma separated)<input className="input" value={enclosures} onChange={(e) => setEnclosures(e.target.value)} data-testid="appeal-enclosures" /></label>
          <button className="btn btn-sm btn-primary" onClick={generateAppeal} data-testid="appeal-generate-2">Generate Appeal Letter</button>

          <h4 style={{ marginTop: 16 }}>835 Error Report</h4>
          <label>ERA Import<select className="input" value={eraId} onChange={(e) => setEraId(e.target.value)} data-testid="appeal-era">
            <option value="">Select ERA…</option>
            {Object.values(state.eraImports || {}).map((era) => <option key={era.id} value={era.id}>{era.fileName} · {era.unmatched} unmatched</option>)}
          </select></label>
          <button className="btn btn-sm" onClick={generateErrorReport} data-testid="appeal-error-generate">Generate 835 Error CSV</button>

          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8 }}>
            Appeal letters use org letterhead + claim details + denial CARC + narrative + enclosures. Error reports list unmatched ERA lines with suggested match.
          </div>
        </div>

        <div>
          <h4>Appeal Letters History</h4>
          {appealFiles.length === 0 ? (
            <div className="empty" data-testid="appeal-empty"><b>No appeal letters yet</b><span>Generate from a denied claim to see history.</span></div>
          ) : (
            <div className="tablewrap" data-testid="appeal-history-table">
              <table className="table">
                <thead><tr><th>File</th><th>Payer</th><th>Claim</th><th>Date</th><th>Actions</th></tr></thead>
                <tbody>
                  {appealFiles.sort((a, b) => b.createdAt - a.createdAt).slice(0, 50).map((f) => (
                    <tr key={f.id} data-testid={`appeal-file-row-${f.id}`}>
                      <td>{f.fileName}</td><td>{f.payer}</td><td>{f.claimIds?.[0] ? claims[f.claimIds[0]]?.no || f.claimIds[0] : '—'}</td><td>{f.date}</td>
                      <td><button className="btn btn-xs" data-testid={`appeal-download-${f.id}`} onClick={() => download(f.fileName, f.content)}>Download</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <h4 style={{ marginTop: 16 }}>835 Error Reports</h4>
          {errorReports.length === 0 ? (
            <div className="empty" data-testid="appeal-error-empty"><b>No error reports yet</b></div>
          ) : (
            <div className="tablewrap" data-testid="appeal-error-table">
              <table className="table">
                <thead><tr><th>File</th><th>Date</th><th>Actions</th></tr></thead>
                <tbody>
                  {errorReports.sort((a, b) => b.createdAt - a.createdAt).slice(0, 20).map((f) => (
                    <tr key={f.id} data-testid={`appeal-error-row-${f.id}`}>
                      <td>{f.fileName}</td><td>{f.date}</td><td><button className="btn btn-xs" data-testid={`appeal-error-download-${f.id}`} onClick={() => download(f.fileName, f.content)}>Download</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {selectedClaim && (
            <div className="panel" style={{ marginTop: 16 }} data-testid="appeal-preview">
              <h4>Preview — {selectedClaim.no}</h4>
              <div style={{ fontSize: 12 }}>
                <div>Client: {clients.find((c) => c.id === selectedClaim.clientId)?.name}</div>
                <div>Payer: {selectedClaim.payer}</div>
                <div>Denial: {selectedClaim.denial?.code} — {selectedClaim.denial?.reason}</div>
                <div>Fix: {selectedClaim.denial?.fix}</div>
                <div>Charges: {money(selectedClaim.charges)} · Due: {money(dueOf(selectedClaim))}</div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
