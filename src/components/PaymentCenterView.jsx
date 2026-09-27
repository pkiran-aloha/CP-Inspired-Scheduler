import React, { useEffect, useMemo, useState } from 'react'
import { useStore } from '../state/store'
import { SectionBar, RangePicker } from './NavRail'
import { Icon } from '../ui/Icons'
import { useToast } from '../ui/Toast'
import { resolveRange } from '../lib/analytics'
import { isoDate, addDays, parseISO, todayISO } from '../lib/date'
import { dueOf, isPrimaryReceivable, patientResponsibilityOf, PATIENT_AR_BUCKET } from '../lib/claims'
import { parse835 } from '../lib/era'
import { previewEra } from '../lib/eraPosting'
import { build835ErrorReport } from '../lib/billingDocs'
import { buildPatientReceiptAudit } from '../lib/paymentLedger'
import { download } from '../lib/ics'
import { PersonAvatar } from '../ui/avatars'

const money = (n) => `$${(Math.round(n * 100) / 100).toLocaleString(undefined, { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`
const carcOf = (line) => (line.adjustments || []).map((a) => `${a.group}-${a.reason}`).join(', ') || '—'
const adjustOf = (line) => (line.adjustments || []).filter((a) => a.group !== 'PR').reduce((n, a) => n + (Number(a.amount) || 0), 0)
const readLocalFile = (file) => typeof file.text === 'function' ? file.text() : new Promise((resolve, reject) => {
  const reader = new FileReader()
  reader.onload = () => resolve(reader.result)
  reader.onerror = () => reject(reader.error)
  reader.readAsText(file)
})

function ManualForm({ state, onSaved, initialApply = 'unapplied' }) {
  const { clients, payers, claims, actions } = state
  const prefill = claims[initialApply === 'patient' ? state.ui.patientClaimId : state.ui.paymentClaimId]
  const [clientId, setClientId] = useState(prefill?.clientId || clients[0]?.id || '')
  const [apply, setApply] = useState(initialApply)
  const [claimId, setClaimId] = useState(prefill?.id || '')
  const [payer, setPayer] = useState(payers[0]?.name || '')
  const [amount, setAmount] = useState('')
  const [adj, setAdj] = useState('0')
  const [patientResp, setPatientResp] = useState('')
  const [date, setDate] = useState(todayISO())
  const [method, setMethod] = useState('check')
  const [ref, setRef] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const eligible = Object.values(claims).filter((c) => c.clientId === clientId && ['submitted', 'partially_paid'].includes(c.status) &&
    (apply === 'patient' ? isPrimaryReceivable(c) && patientResponsibilityOf(state, c) > 0 :
      c.method === 'secondary' ? claims[c.secondary]?.secondary === c.id : !c.secondary))
  // A patient receipt must name a primary explicitly. Do not silently allocate
  // money to the first eligible claim when opened from the Payment Center.
  const selected = eligible.find((c) => c.id === claimId) || (apply === 'patient' ? null : eligible[0])
  const save = () => {
    setError('')
    if (apply !== 'unapplied' && !selected) {
      setError(apply === 'patient' ? eligible.length ? 'Select a primary claim with documented patient share.' : 'No documented patient share is available for this client.' : 'No open, unlinked claim is available for this client.')
      return
    }
    const result = apply === 'patient'
      ? actions.recordPatientReceipt({ clientId, claimId: selected.id, amount, date, method, ref, note })
      : actions.recordPayment({ clientId, payer: apply === 'claim' ? selected.payer : payer,
        claimId: apply === 'claim' ? selected.id : null, amount, adj: apply === 'claim' ? adj : 0,
        patientResp: apply === 'claim' ? patientResp : 0, date, method, ref, note })
    if (result.ok) onSaved(result)
    else setError(result.msg || 'Receipt was not recorded')
  }
  return (
    <div className="pc-form">
      <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>Record money already received elsewhere. Payer remittances, claim-linked patient receipts and unapplied receipts have different ledger effects. No payment processing, refund or bank reconciliation occurs here.</p>
      <label className="field"><span>Apply to</span><select value={apply} onChange={(e) => { setApply(e.target.value); setClaimId(''); setMethod('check'); setError('') }} data-testid="pc-man-apply"><option value="unapplied">Unapplied receipt (no claim change)</option><option value="claim">Payer remittance on open claim</option><option value="patient">Patient share on primary claim</option></select></label>
      <div className="pc-form-grid">
        <label className="field"><span>Client</span><select value={clientId} onChange={(e) => { setClientId(e.target.value); setClaimId(''); setError('') }} data-testid="pc-man-client"><option value="">— Select —</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        {apply !== 'unapplied' ? <label className="field"><span>{apply === 'patient' ? 'Primary claim with patient share' : 'Open claim'}</span><select value={selected?.id || ''} onChange={(e) => setClaimId(e.target.value)} data-testid="pc-man-claim"><option value="">— Select —</option>{eligible.map((c) => <option key={c.id} value={c.id}>{c.no} {c.method === 'secondary' ? '(secondary)' : ''} — {money(apply === 'patient' ? patientResponsibilityOf(state, c) : dueOf(c))} {apply === 'patient' ? 'patient share' : 'open'}</option>)}</select></label> : null}
        <label className="field"><span>{apply === 'patient' ? 'Receipt from' : 'Payer'}</span>{apply !== 'unapplied' ? <input value={apply === 'patient' ? PATIENT_AR_BUCKET : selected?.payer || ''} readOnly data-testid="pc-man-payer" /> : <select value={payer} onChange={(e) => setPayer(e.target.value)} data-testid="pc-man-payer">{payers.map((p) => <option key={p.id} value={p.name}>{p.name}</option>)}</select>}</label>
        <label className="field"><span>Amount</span><input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" data-testid="pc-man-amount" /></label>
        {apply === 'claim' && <>
          <label className="field"><span>Payer adjustment (not a primary write-off for secondary)</span><input type="number" min="0" step="0.01" value={adj} onChange={(e) => setAdj(e.target.value)} data-testid="pc-man-adj" /></label>
          <label className="field"><span>Reported patient responsibility (leave blank if unknown)</span><input type="number" min="0" step="0.01" value={patientResp} onChange={(e) => setPatientResp(e.target.value)} data-testid="pc-man-patient" /></label>
        </>}
        <label className="field"><span>Date</span><input type="date" value={date} onChange={(e) => setDate(e.target.value)} data-testid="pc-man-date" /></label>
        <label className="field"><span>Method</span><select value={method} onChange={(e) => setMethod(e.target.value)} data-testid="pc-man-method"><option value="check">Check</option><option value="eft">EFT</option>{apply !== 'patient' && <option value="era">Manually keyed ERA</option>}{(apply !== 'claim' || selected?.mode === 'selfpay') && <><option value="cash">Cash</option><option value="card">Card</option></>}</select></label>
        <label className="field"><span>Reference # (required)</span><input value={ref} onChange={(e) => setRef(e.target.value)} placeholder={apply === 'patient' ? 'External receipt / check reference' : 'CHK / EFT #'} data-testid="pc-man-ref" /></label>
      </div>
      {selected && apply === 'claim' && <p className="muted" style={{ fontSize: 12 }}>Applying to {selected.no} · {money(dueOf(selected))} open. {selected.method === 'secondary' ? `Linked primary ${claims[selected.secondary]?.no || 'missing'} holds the sole receivable; only payer money reduces it.` : 'If COB is filed, use the linked secondary instead.'}</p>}
      {apply === 'patient' && <p className="muted" data-testid="pc-man-patient-limit" style={{ fontSize: 12 }}>Only documented patient responsibility or self-pay can be collected. {selected ? `${selected.no} has ${money(patientResponsibilityOf(state, selected))} remaining patient share; the payer and secondary cash ledgers will not change.` : eligible.length ? 'Select a primary claim to allocate the receipt.' : 'No eligible claim for this client.'} A reversal here does not issue a refund.</p>}
      <label className="field"><span>Note</span><textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} data-testid="pc-man-note" /></label>
      {error && <div className="pc-era-error" role="alert" data-testid="pc-man-error">{error}</div>}
      <div className="pc-form-actions"><button className="btn btn-sm btn-primary" data-testid="pc-man-save" onClick={save}>Save {apply === 'patient' ? 'patient receipt' : apply === 'claim' ? 'claim remittance' : 'unapplied receipt'}</button><button className="btn btn-sm" onClick={() => onSaved(null)}>Cancel</button></div>
    </div>
  )
}

// Typed entry remains available for older workflows, but now uses the same
// validated/atomic ERA transaction as file imports instead of silently skipping.
function TypedEraForm({ state, onSaved }) {
  const { claims, actions } = state
  const eligible = Object.values(claims).filter((c) => ['submitted', 'partially_paid'].includes(c.status))
  const [fileName, setFileName] = useState(`Manual-ERA-${todayISO()}`)
  const [lines, setLines] = useState([{ claimId: eligible[0]?.id || '', amount: '', adj: '', status: 'paid', carc: '' }])
  const [error, setError] = useState('')
  const addLine = () => setLines((ls) => [...ls, { claimId: eligible[0]?.id || '', amount: '', adj: '', status: 'paid', carc: '' }])
  const change = (i, patch) => setLines((ls) => ls.map((x, j) => j === i ? { ...x, ...patch } : x))
  const submit = () => {
    setError('')
    if (!lines.length || lines.some((l) => !l.claimId || (l.amount === '' && l.status !== 'denied'))) { setError('Enter a claim and amount for every payment line.'); return }
    if (lines.some((l) => l.status === 'denied' && (!/^(?:\d+|[A-Z]\d+)$/i.test(l.carc.trim()) || !Number(l.adj)))) { setError('A typed denial needs a payer CARC code and adjustment amount.'); return }
    const result = actions.importEra({ fileName, lines: lines.map((l) => ({
      claimId: l.claimId, amount: l.status === 'denied' ? 0 : Number(l.amount), adj: Number(l.adj || 0), status: l.status, carc: l.carc.trim(),
    })) })
    if (result.ok) onSaved(result)
    else setError(result.msg)
  }
  return (
    <div className="pc-form" data-testid="pc-typed-era">
      <p className="muted" style={{ margin: 0, fontSize: 12 }}>Typed entries must match an open claim and reconcile exactly. No lines are silently skipped; use a real 835 file to preserve payer CARC codes.</p>
      <label className="field"><span>Reference / file name</span><input value={fileName} onChange={(e) => setFileName(e.target.value)} data-testid="pc-era-file" /></label>
      {lines.map((ln, i) => (
        <div key={i} className="pc-typed-row">
          <label className="field"><span>Claim</span><select value={ln.claimId} onChange={(e) => change(i, { claimId: e.target.value })} data-testid={`pc-era-line-claim-${i}`}>{eligible.map((c) => <option key={c.id} value={c.id}>{c.no} — {money(dueOf(c))} due</option>)}</select></label>
          <label className="field"><span>Paid</span><input type="number" min="0" step="0.01" value={ln.amount} onChange={(e) => change(i, { amount: e.target.value })} data-testid={`pc-era-line-amt-${i}`} /></label>
          <label className="field"><span>Adj</span><input type="number" min="0" step="0.01" value={ln.adj} onChange={(e) => change(i, { adj: e.target.value })} data-testid={`pc-era-line-adj-${i}`} /></label>
          <label className="field"><span>Status{ln.status === 'denied' ? ' / CARC' : ''}</span><select value={ln.status} onChange={(e) => change(i, { status: e.target.value })} data-testid={`pc-era-line-status-${i}`}><option value="paid">Paid</option><option value="denied">Denied</option><option value="partial">Partial</option></select>{ln.status === 'denied' && <input aria-label={`CARC code for line ${i + 1}`} value={ln.carc} onChange={(e) => change(i, { carc: e.target.value })} placeholder="197" />}</label>
          <button className="btn btn-xs" type="button" aria-label={`Remove line ${i + 1}`} onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}>✕</button>
        </div>
      ))}
      {error && <div className="pc-era-error" role="alert">{error}</div>}
      <div className="pc-form-actions"><button className="btn btn-xs" onClick={addLine}>+ Line</button><button className="btn btn-sm btn-primary" data-testid="pc-era-save" onClick={submit} style={{ marginLeft: 'auto' }}>Post typed ERA</button><button className="btn btn-sm" onClick={() => onSaved(null)}>Cancel</button></div>
    </div>
  )
}

function EraLinesTable({ rows, selected, onToggle, limit = 50, testId }) {
  return <div className="pc-era-scroll" data-testid={testId}>
    <table className="pc-era-table">
      <thead><tr><th scope="col">Post</th><th scope="col">ERA claim / matched claim</th><th scope="col">Status / CARC</th><th scope="col">Charges</th><th scope="col">Allowed</th><th scope="col">Payer pay</th><th scope="col">Adj</th><th scope="col">Patient</th><th scope="col">Decision</th></tr></thead>
      <tbody>{rows.slice(0, limit).map((row) => {
        const l = row.line
        return <tr key={row.id} className={row.ready ? 'pc-era-ready' : 'pc-era-held'} data-testid={`pc-era-line-${row.id}`}>
          <td><input type="checkbox" aria-label={`Post ${l.claimNo}`} checked={selected.includes(row.id)} disabled={!row.ready} onChange={() => onToggle(row.id)} /></td>
          <td><b>{l.claimNo || 'Missing claim #'}</b><small>{row.claim ? `Exact → ${row.claim.no}` : 'Unmatched'}{l.dosFrom ? ` · DOS ${l.dosFrom}${l.dosTo && l.dosTo !== l.dosFrom ? `–${l.dosTo}` : ''}` : ''}</small></td>
          <td>{l.status || l.statusCode || '—'}<small>{carcOf(l)}</small></td>
          <td>{money(Number(l.charges) || 0)}</td><td>{l.allowed == null ? '—' : money(Number(l.allowed) || 0)}</td><td>{money(Number(l.paid) || 0)}</td><td>{money(adjustOf(l))}</td><td>{money(Number(l.patientResp) || 0)}</td>
          <td><span className={`pc-era-state ${row.ready ? 'safe' : 'hold'}`}>{row.ready ? 'Eligible' : 'Park'}</span>{!row.ready && <small>{row.reason}</small>}</td>
        </tr>
      })}</tbody>
    </table>
  </div>
}

function UploadEraForm({ state, onSaved }) {
  const [fileName, setFileName] = useState('')
  const [parsed, setParsed] = useState(null)
  const [selected, setSelected] = useState([])
  const [shown, setShown] = useState(50)
  const [error, setError] = useState('')
  const preview = useMemo(() => parsed ? previewEra(state, parsed) : null, [parsed, state.claims, state.payments, state.eraImports])
  const onFile = async (e) => {
    const file = e.target.files?.[0]
    setParsed(null); setSelected([]); setShown(50); setError('')
    if (!file) return
    setFileName(file.name)
    if (!/\.(835|txt)$/i.test(file.name)) { setError('Select a .835 or .txt file.'); return }
    if (file.size > 2 * 1024 * 1024) { setError('File is too large (2 MB maximum).'); return }
    try { setParsed(parse835(await readLocalFile(file))) }
    catch { setError('The file could not be read locally. Please choose it again.') }
  }
  const toggle = (id) => setSelected((ids) => ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id])
  const submit = () => {
    if (!parsed || preview.errors.length) return
    const result = state.actions.import835({ fileName, parsed, selectedIds: selected })
    if (result.ok) onSaved(result)
    else setError(result.msg)
  }
  return <div className="pc-form" data-testid="pc-upload-era">
    <p className="muted" style={{ margin: 0, fontSize: 12 }}>Local-only claim-level 835 review. No file is sent anywhere. Select lines to post; all others are parked. Service-line SVC and provider-level PLB are <b>not</b> applied automatically.</p>
    <label className="field"><span>835 file (.835 or .txt, max 2 MB)</span><input type="file" accept=".835,.txt,text/plain" data-testid="pc-era-upload" onChange={onFile} /></label>
    {error && <div className="pc-era-error" role="alert">{error}</div>}
    {preview && <>
      <div className="pc-era-summary" data-testid="pc-era-preview">
        <b>{fileName}</b><span>{preview.rows.length} claim lines · {preview.ready} eligible · {preview.parked} held</span>
        <span>Payer {parsed.meta?.payerName || 'not supplied'} · Trace {parsed.meta?.traceNo || '—'} · Payment date {parsed.meta?.paymentDate || 'not supplied'} · BPR {parsed.meta?.bprAmount == null ? '—' : money(parsed.meta.bprAmount)}</span>
        {parsed.meta?.hasPLB && <span className="pc-era-warning">Provider-level PLB present — excluded from all claim payments.</span>}
        {preview.warnings.map((warning) => <span className="pc-era-warning" key={warning}>{warning}</span>)}
      </div>
      {!!preview.errors.length && <div className="pc-era-error" role="alert">Cannot import: {preview.errors.join(' · ')}</div>}
      <EraLinesTable rows={preview.rows} selected={selected} onToggle={toggle} limit={shown} testId="pc-era-preview-lines" />
      {shown < preview.rows.length && <button className="btn btn-xs" onClick={() => setShown((n) => n + 50)}>Show next 50 lines</button>}
      <div className="pc-form-actions">
        <button className="btn btn-xs" onClick={() => setSelected(preview.rows.slice(0, shown).filter((r) => r.ready).map((r) => r.id))} disabled={!!preview.errors.length}>Select visible eligible</button>
        <button className="btn btn-xs" onClick={() => setSelected([])}>Clear selection</button>
        <span className="muted" style={{ marginLeft: 'auto', fontSize: 12 }}>{selected.length} selected · {preview.rows.length - selected.length} will park</span>
        <button className="btn btn-sm btn-primary" data-testid="pc-era-post" disabled={!!preview.errors.length || selected.some((id) => !preview.rows.some((r) => r.id === id && r.ready))} onClick={submit}>{selected.length ? 'Post selected & park rest' : 'Save all as parked'}</button>
      </div>
    </>}
    <div className="pc-form-actions"><button className="btn btn-sm" onClick={() => onSaved(null)}>Cancel</button></div>
  </div>
}

function EraHistory({ state, query, range, onImport }) {
  const toast = useToast()
  const [selectedId, setSelectedId] = useState(null)
  const [retryIds, setRetryIds] = useState([])
  const [shown, setShown] = useState(50)
  const [error, setError] = useState('')
  const eras = useMemo(() => Object.values(state.eraImports || {}).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)), [state.eraImports])
  const visible = eras.filter((era) => {
    const date = new Date(era.createdAt || Date.now())
    const imported = isoDate(date)
    const inRange = imported >= range.days[0] && imported <= range.days[range.days.length - 1]
    return inRange && (!query.trim() || `${era.fileName || ''} ${era.traceNo || ''} ${era.status || ''}`.toLowerCase().includes(query.trim().toLowerCase()))
  })
  const era = selectedId ? state.eraImports?.[selectedId] : null
  const parked = (era?.detail || []).filter((d) => d.decision === 'parked')
  const retry = useMemo(() => era && parked.length ? previewEra(state,
    { lines: parked, errors: [], fingerprint: era.fingerprint, meta: { traceNo: era.traceNo, paymentDate: era.paymentDate, payerName: era.payerName } },
    { ignoreEraId: era.id }) : null,
  [state.claims, state.payments, state.eraImports, era])
  const exportParked = (record) => {
    const report = build835ErrorReport(state, { eraId: record.id })
    download(report.fileName, report.content, 'text/csv;charset=utf-8')
    toast({ message: `${record.parked} parked lines exported`, kind: 'ok' })
  }
  const postRetry = () => {
    const result = state.actions.retryEra(era.id, retryIds)
    if (!result.ok) { setError(result.msg); return }
    setError(''); setRetryIds([])
    toast({ message: result.msg, kind: 'ok' })
  }
  return <div className="pc-era-history" data-testid="pc-eras">
    <div className="pc-era-history-head"><div><b>ERA imports</b><small>{visible.length} in range · imports are local to this workspace</small></div><button className="btn btn-sm btn-primary" onClick={onImport}>+ Upload 835</button></div>
    {!visible.length && <div className="py-empty" style={{ padding: 48, textAlign: 'center' }}>No ERA imports in this range. Upload an 835 to review before posting.</div>}
    {visible.map((record) => <div className="pc-era-history-row" key={record.id}>
      <button type="button" data-testid={`pc-era-history-${record.id}`} onClick={() => { setSelectedId(selectedId === record.id ? null : record.id); setRetryIds([]); setShown(50); setError('') }}>
        <b>{record.fileName || 'Untitled ERA'}</b><span>{isoDate(new Date(record.createdAt || Date.now()))} · {record.traceNo || 'No trace'}</span>
        <span>{Array.isArray(record.lines) ? record.lines.length : record.lines || 0} lines · {record.posted ?? '—'} posted · {record.parked ?? '—'} parked</span>
        <span className={`pc-era-state ${(record.parked || 0) > 0 ? 'hold' : 'safe'}`}>{record.status || 'legacy'}</span>
      </button>
      {(record.parked || 0) > 0 && <button className="btn btn-xs" data-testid={`pc-era-export-${record.id}`} onClick={() => exportParked(record)}>Export parked CSV</button>}
    </div>)}
    {era && <section className="pc-era-detail" data-testid="pc-era-detail">
      <div className="pc-era-history-head"><div><b>{era.fileName} — line review</b><small>{era.posted ?? '—'} posted · {era.parked ?? '—'} parked · payment date {era.paymentDate || '—'}</small></div><button className="btn btn-xs" onClick={() => setSelectedId(null)}>Close</button></div>
      {era.hasPLB && <div className="pc-era-warning">Provider-level PLB was not applied.</div>}
      {(era.warnings || []).map((warning) => <div className="pc-era-warning" key={warning}>{warning}</div>)}
      {(era.detail || []).length ? <div className="pc-era-scroll"><table className="pc-era-table"><thead><tr><th>Claim #</th><th>DOS</th><th>Status / CARC</th><th>Charged</th><th>Allowed</th><th>Paid</th><th>Patient</th><th>Decision</th></tr></thead><tbody>{era.detail.map((l, i) => <tr key={l.id || i}>
        <td>{l.claimNo}</td><td>{l.dosFrom || '—'}</td><td>{l.status || l.statusCode}<small>{carcOf(l)}</small></td><td>{money(Number(l.charges) || 0)}</td><td>{l.allowed == null ? '—' : money(Number(l.allowed) || 0)}</td><td>{money(Number(l.paid) || 0)}</td><td>{money(Number(l.patientResp) || 0)}</td><td><span className={`pc-era-state ${l.decision === 'posted' ? 'safe' : 'hold'}`}>{l.decision || 'legacy'}</span>{l.reason && <small>{l.reason}</small>}</td>
      </tr>)}</tbody></table></div> : <p className="muted">This older import has no stored line-level decisions.</p>}
      {!!retry?.rows.length && <div className="pc-era-retry">
        <b>Retry parked lines</b><p className="muted" style={{ margin: '4px 0 12px', fontSize: 12 }}>After correcting a claim, recheck its current balance. Only selected eligible lines can post; previously posted lines cannot post again.</p>
        <EraLinesTable rows={retry.rows} selected={retryIds} onToggle={(id) => setRetryIds((ids) => ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id])} limit={shown} testId="pc-era-retry-lines" />
        {shown < retry.rows.length && <button className="btn btn-xs" onClick={() => setShown((n) => n + 50)}>Show next 50 lines</button>}
        {error && <div className="pc-era-error" role="alert">{error}</div>}
        <div className="pc-form-actions"><button className="btn btn-sm btn-primary" data-testid="pc-era-retry" onClick={postRetry} disabled={!retryIds.length || !!retry.errors.length}>Post selected parked lines</button><span className="muted">{retry.ready} now eligible · {retry.parked} still held</span></div>
      </div>}
    </section>}
  </div>
}

export default function PaymentCenterView() {
  const state = useStore()
  const { ui, actions, settings, claims, clients } = state
  const toast = useToast()
  const payments = state.payments || {}
  const preset = ui.payPreset || 'last4'
  const range = useMemo(() => resolveRange(preset, ui.anchor, settings.weekStart), [preset, ui.anchor, settings.weekStart])
  const [tab, setTab] = useState('payments')
  const [q, setQ] = useState('')
  const [statusF, setStatusF] = useState('all')
  const [openMan, setOpenMan] = useState(false)
  const [manualApply, setManualApply] = useState('unapplied')
  const [openEra, setOpenEra] = useState(false)
  useEffect(() => {
    if (ui.paymentClaimId || ui.patientClaimId) {
      setManualApply(ui.patientClaimId ? 'patient' : 'claim')
      setOpenMan(true)
    }
  }, [ui.paymentClaimId, ui.patientClaimId])
  const [entryMode, setEntryMode] = useState('upload')

  const allPayments = useMemo(() => Object.values(payments).sort((a, b) => (b.date || '').localeCompare(a.date || '')), [payments])
  const filtered = useMemo(() => {
    let out = allPayments.filter((p) => (p.date || '') >= range.days[0] && (p.date || '') <= range.days[range.days.length - 1])
    if (statusF !== 'all') out = out.filter((p) => p.kind === statusF || p.method === statusF || (statusF === 'era' && p.kind === 'era835'))
    if (q.trim()) {
      const t = q.trim().toLowerCase()
      out = out.filter((p) => `${p.clientId} ${p.payer} ${p.ref || ''} ${p.note || ''}`.toLowerCase().includes(t))
    }
    return out
  }, [allPayments, statusF, q, range])
  const kpis = useMemo(() => {
    const inRange = allPayments.filter((p) => (p.date || '') >= range.days[0] && (p.date || '') <= range.days[range.days.length - 1])
    const total = inRange.reduce((s, p) => s + (p.amount || 0), 0)
    const check = inRange.filter((p) => p.method === 'check').reduce((s, p) => s + p.amount, 0)
    const eft = inRange.filter((p) => p.method === 'eft' || p.method === 'era').reduce((s, p) => s + p.amount, 0)
    const unapplied = Math.max(0, allPayments.filter((p) => !p.claimId && p.kind === 'unapplied').reduce((s, p) => s + (p.amount || 0), 0))
    const patient = inRange.filter((p) => p.kind === 'patient').reduce((s, p) => s + p.amount, 0)
    return { total, check, eft, unapplied, patient, count: inRange.length }
  }, [allPayments, range])
  const closeManual = () => {
    setOpenMan(false)
    if (ui.paymentClaimId || ui.patientClaimId) actions.setUI({ paymentClaimId: null, patientClaimId: null })
  }
  const done = (result) => {
    if (!result) { closeManual(); setOpenEra(false); return }
    if (result.ok) {
      if (openEra && result.id) setTab('eras')
      closeManual(); setOpenEra(false)
      toast({ message: result.msg, kind: 'ok' })
    } else toast({ message: result.msg || 'Payment not saved', kind: 'warn' })
  }
  return <div className="sectionpage" data-testid="pc-sec" style={{ background: 'var(--bg)' }}>
    <SectionBar icon="dollar" title="Payment Center" sub={`${range.label} · ${kpis.count} payments · ${money(kpis.total)} · ${money(kpis.unapplied)} unapplied`}>
      <RangePicker preset={preset} onPreset={(p) => actions.setUI({ payPreset: p })} onSlide={(d) => actions.setUI({ anchor: isoDate(addDays(parseISO(ui.anchor), d * range.days.length)) })} label={range.label} />
      <div className="sb-search" style={{ minWidth: 220, borderRadius: 10 }}><span className="sic">{Icon.search({ size: 12 })}</span><input placeholder={tab === 'eras' ? 'Search ERA file or trace' : 'Search payer, client, ref'} value={q} onChange={(e) => setQ(e.target.value)} data-testid="pc-search" style={{ fontSize: 13 }} /></div>
      <button className="btn btn-sm btn-primary" data-testid="pc-open-man" onClick={() => { setManualApply('unapplied'); setOpenMan(true) }} style={{ borderRadius: 10 }}>+ Manual Payment</button>
      <button className="btn btn-sm" data-testid="pc-open-patient" onClick={() => { setManualApply('patient'); setOpenMan(true) }} style={{ borderRadius: 10 }}>+ Patient receipt</button>
      <button className="btn btn-sm" data-testid="pc-export-patient" onClick={() => { download(`Patient-receipts-${todayISO()}.csv`, buildPatientReceiptAudit(state), 'text/csv'); toast({ message: 'Local patient receipt audit downloaded — verify against external deposits', kind: 'ok' }) }} style={{ borderRadius: 10 }}>Patient audit CSV</button>
      <button className="btn btn-sm" data-testid="pc-open-era" onClick={() => { setEntryMode('upload'); setOpenEra(true) }} style={{ borderRadius: 10 }}>Upload ERA (835)</button>
    </SectionBar>
    <div className="batch-strip pc-tabs" data-testid="pc-tabs"><button className={tab === 'payments' ? 'on' : ''} data-testid="pc-tab-payments" onClick={() => setTab('payments')}>Payments</button><button className={tab === 'eras' ? 'on' : ''} data-testid="pc-tab-eras" onClick={() => setTab('eras')}>ERAs ({Object.keys(state.eraImports || {}).length})</button></div>
    {tab === 'payments' ? <>
      <div className="batch-strip" data-testid="pc-kpis" style={{ margin: '16px', padding: '16px', gap: 12, flexWrap: 'wrap', background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 14 }}>
        {[
          ['Total', money(kpis.total), `${kpis.count} in range`, '#6366f1', 'pc-kpi-total'],
          ['Check', money(kpis.check), 'Paper', '#0ea5e9', 'pc-kpi-check'],
          ['EFT / ERA', money(kpis.eft), 'Electronic', '#10b981', 'pc-kpi-eft'],
          ['Unapplied receipts', money(kpis.unapplied), 'Not allocated to claims', '#f59e0b', 'pc-kpi-unapplied'],
          ['Patient cash', money(kpis.patient), 'Net local receipts in range', '#0d9488', 'pc-kpi-patient'],
        ].map(([label, val, sub, color, testId]) => <div key={label} className="rp-sumchip on" data-testid={testId} style={{ background: 'var(--panel)', border: '1px solid var(--line)', display: 'flex', gap: 12, alignItems: 'center', minWidth: 160, borderRadius: 12, padding: '12px 16px' }}><span style={{ width: 32, height: 32, borderRadius: 9, background: `${color}14`, color, display: 'grid', placeItems: 'center' }}>{Icon.dollar({ size: 14 })}</span><div><b style={{ fontSize: 18, fontWeight: 800 }}>{val}</b><span style={{ display: 'block', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--muted)' }}>{label}</span><span style={{ fontSize: 12, color: 'var(--muted)' }}>{sub}</span></div></div>)}
      </div>
      <div className="batch-strip" style={{ margin: '0 16px 16px', padding: '12px 16px', gap: 12, background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 12 }}><div className="viewseg" style={{ borderRadius: 10, padding: 3 }} data-testid="pc-filter">{[['all', 'All'], ['patient', 'Patient'], ['check', 'Check'], ['eft', 'EFT'], ['era', 'ERA'], ['cash', 'Cash']].map(([id, label]) => <button key={id} className={statusF === id ? 'on' : ''} data-testid={`pc-filter-${id}`} onClick={() => setStatusF(id)} style={{ borderRadius: 8, fontSize: 13 }}>{label}</button>)}</div><span className="muted" style={{ fontSize: 12, marginLeft: 8 }}>{filtered.length} payments</span></div>
      <div style={{ padding: '0 16px 16px' }}><div className="panel" style={{ borderRadius: 14, overflow: 'hidden', border: '1px solid var(--line)' }}><div style={{ padding: '16px 20px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 12, background: 'var(--panel-2)' }}><span style={{ width: 32, height: 32, borderRadius: 9, background: '#10b98114', color: '#10b981', display: 'grid', placeItems: 'center' }}>{Icon.dollar({ size: 16 })}</span><div><b style={{ fontSize: 14 }}>Payments</b><div className="muted" style={{ fontSize: 12 }}>{filtered.length} rows</div></div></div>
        <div className="py-tbl" data-testid="pc-table" style={{ overflowX: 'auto' }}><div className="py-thead" style={{ gridTemplateColumns: '110px 1.4fr 1fr 100px 100px 1fr 100px', background: 'var(--panel-2)', fontSize: 11, padding: '12px 16px' }}><span>Date</span><span>Client</span><span>Payer</span><span>Amount</span><span>Method</span><span>Ref / Note</span><span>Claim</span></div>
          {filtered.slice(0, 100).map((p) => { const cl = clients.find((c) => c.id === p.clientId); return <div key={p.id} className="py-trow" data-testid={`pc-pay-row-${p.id}`} style={{ gridTemplateColumns: '110px 1.4fr 1fr 100px 100px 1fr 100px', minHeight: 52, padding: '10px 16px' }}><div className="py-cell" style={{ fontSize: 12 }}>{p.date}</div><div className="py-cell"><div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><PersonAvatar p={cl} size={24} /><b style={{ fontSize: 13 }}>{cl?.name || p.clientId}</b></div></div><div className="py-cell" style={{ fontSize: 12 }}>{p.payer}</div><div className="py-cell"><b style={{ fontSize: 13, color: '#059669' }}>{money(p.amount)}</b></div><div className="py-cell"><span className="pill" style={{ fontSize: 11, borderRadius: 20, padding: '3px 10px', background: 'var(--panel-2)' }}>{p.kind === 'patient' ? p.reversalOf ? 'Patient reversal' : 'Patient receipt' : p.method || p.kind}</span></div><div className="py-cell" style={{ fontSize: 12, color: 'var(--muted)' }}>{p.ref || ''} {p.note ? `· ${p.note}` : ''}</div><div className="py-cell" style={{ fontSize: 11, display: 'flex', flexWrap: 'wrap', gap: 4 }}>{p.claimId ? <span className="ln-code">{claims[p.claimId]?.no || p.claimId.slice(0, 8)}</span> : <span>Unapplied</span>}{!p.reversalOf && !p.eraId && (p.claimId || p.kind === 'unapplied') && !Object.values(payments).some((r) => r.reversalOf === p.id) && <button className="btn btn-xs" data-testid={`pc-void-${p.id}`} onClick={() => { const r = actions.voidPayment(p.id); toast({ message: r.ok ? `${r.msg} — press U to undo` : r.msg, kind: r.ok ? 'ok' : 'warn' }) }}>{p.kind === 'patient' ? 'Reverse locally' : 'Void'}</button>}</div></div> })}
          {!filtered.length && <div className="py-empty" style={{ padding: 48, textAlign: 'center' }} data-testid="pc-empty"><b>No payments</b><div className="muted" style={{ fontSize: 12 }}>Record a manual payment or import an ERA.</div></div>}
          <div className="footer" style={{ padding: '12px 20px', display: 'flex', justifyContent: 'space-between', background: 'var(--panel-2)', borderTop: '1px solid var(--line)', fontSize: 12 }}><span>{filtered.length} payments · {money(filtered.reduce((s, p) => s + p.amount, 0))} total</span><span>Unapplied {money(kpis.unapplied)}</span></div></div>
      </div></div>
    </> : <EraHistory state={state} query={q} range={range} onImport={() => { setEntryMode('upload'); setOpenEra(true) }} />}
    {openMan && <div className="pc-dialog-backdrop" data-testid="pc-man-modal"><div className="pc-dialog" role="dialog" aria-modal="true" aria-label="Manual Payment"><div className="pc-dialog-head"><b>{manualApply === 'patient' ? 'Record patient receipt' : 'Manual Payment'}</b><button className="iconbtn" aria-label="Close" onClick={closeManual}>{Icon.x({ size: 12 })}</button></div><div className="pc-dialog-body"><ManualForm key={`${manualApply}:${ui.paymentClaimId || ui.patientClaimId || ''}`} state={state} initialApply={manualApply} onSaved={done} /></div></div></div>}
    {openEra && <div className="pc-dialog-backdrop" data-testid="pc-era-modal"><div className="pc-dialog pc-dialog-wide" role="dialog" aria-modal="true" aria-label="ERA Import (835)"><div className="pc-dialog-head"><b>ERA Import (835)</b><button className="iconbtn" aria-label="Close" onClick={() => setOpenEra(false)}>{Icon.x({ size: 12 })}</button></div><div className="pc-entry-toggle"><button className={entryMode === 'upload' ? 'on' : ''} data-testid="pc-era-mode-upload" onClick={() => setEntryMode('upload')}>Upload 835</button><button className={entryMode === 'typed' ? 'on' : ''} data-testid="pc-era-mode-typed" onClick={() => setEntryMode('typed')}>Type ERA lines</button></div><div className="pc-dialog-body">{entryMode === 'upload' ? <UploadEraForm state={state} onSaved={done} /> : <TypedEraForm state={state} onSaved={done} />}</div></div></div>}
  </div>
}
