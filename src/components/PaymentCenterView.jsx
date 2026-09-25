import React, { useMemo, useState } from 'react'
import { useStore } from '../state/store'
import { SectionBar, RangePicker } from './NavRail'
import { Icon } from '../ui/Icons'
import { useToast } from '../ui/Toast'
import { resolveRange } from '../lib/analytics'
import { download } from '../lib/ics'
import { isoDate, addDays, parseISO, fmtDayLabel, todayISO } from '../lib/date'
import { dueOf } from '../lib/claims'
import { parse835, matchEraLines } from '../lib/era'

const money = (n) => `$${(Math.round(n * 100) / 100).toLocaleString(undefined, { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`

export default function PaymentCenterView() {
  const state = useStore()
  const { ui, actions, settings, claims, clients } = state
  const toast = useToast()
  const payments = state.payments || {}
  const eraImports = state.eraImports || {}
  const preset = ui.payPreset || 'last4'
  const range = useMemo(() => resolveRange(preset, ui.anchor, settings.weekStart), [preset, ui.anchor, settings.weekStart])
  const [tab, setTab] = useState('payments')
  const [q, setQ] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [addTab, setAddTab] = useState('manual')
  const [eraPreview, setEraPreview] = useState(null)
  const [eraDetailId, setEraDetailId] = useState(null)

  const allPayments = useMemo(() => Object.values(payments).sort((a, b) => b.createdAt - a.createdAt), [payments])
  const filteredPayments = useMemo(() => {
    const t = q.trim().toLowerCase()
    return allPayments.filter((p) => {
      if (t) {
        const cl = clients.find((c) => c.id === p.clientId)
        const claim = claims[p.claimId]
        const hay = `${p.ref} ${p.payer} ${cl?.name || ''} ${claim?.no || ''} ${p.kind}`.toLowerCase()
        if (!hay.includes(t)) return false
      }
      if (p.date && (p.date < range.days[0] || p.date > range.days[range.days.length - 1])) return false
      return true
    })
  }, [allPayments, q, range, clients, claims])

  const allEras = useMemo(() => Object.values(eraImports).sort((a, b) => b.importedAt - a.importedAt), [eraImports])
  const filteredEras = useMemo(() => {
    const t = q.trim().toLowerCase()
    return allEras.filter((e) => !t || `${e.fileName} ${e.status}`.toLowerCase().includes(t))
  }, [allEras, q])

  const clientOf = (id) => clients.find((c) => c.id === id) || {}
  const claimOf = (id) => claims[id] || {}

  const handleVoid = (payId) => {
    const r = actions.voidPayment(payId)
    toast({ message: r.msg, kind: r.ok ? 'ok' : 'warn' })
  }
  const handleReconcile = (payId) => {
    const p = payments[payId]
    if (!p) return
    actions.record('payments', { ...p, reconciled: !p.reconciled })
    toast({ message: p.reconciled ? 'Marked open' : 'Reconciled', kind: 'ok' })
  }

  const generateRemit = () => {
    const openClaims = Object.values(claims).filter((c) => dueOf(c) > 0.5 && c.status !== 'void')
    const rows = [
      `# ${settings.org?.name || 'Practice'} — remittance batch · ${range.label}`,
      'claim,client,payer,dos_from,dos_to,charges,paid,adj,due,status',
      ...openClaims.map((c) => {
        const cl = clientOf(c.clientId)
        return `${c.no},"${cl.name || ''}",${c.payer},${c.dosFrom},${c.dosTo},${c.charges},${c.paid || 0},${c.adj || 0},${dueOf(c)},${c.status}`
      }),
    ]
    const fileName = `Remittance-${range.days[0]}-to-${range.days[range.days.length - 1]}.csv`
    download(fileName, rows.join('\n'))
    actions.record('billedFiles', { fileName, payer: 'All', clientCount: new Set(openClaims.map((c) => c.clientId)).size, claimCount: openClaims.length, claimIds: openClaims.map((c) => c.id), date: todayISO(), sendCount: 1, content: rows.join('\n'), createdAt: Date.now(), format: 'remittance' })
    toast({ message: `Remittance export — ${openClaims.length} open claims`, kind: 'ok' })
  }

  const handleEraFile = async (file) => {
    if (!file) return
    const text = await file.text()
    const parsed = parse835(text)
    const { matched, unmatched } = matchEraLines(parsed.lines, claims)
    setEraPreview({ fileName: file.name, text, parsed, matched, unmatched })
    setAddTab('era')
  }

  const postEra = () => {
    if (!eraPreview) return
    const { fileName, text, parsed, matched, unmatched } = eraPreview
    const at = Date.now()
    const claimUpserts = []
    const paymentsBatch = {}
    let postedCount = 0, deniedCount = 0
    for (const m of matched) {
      const claim = state.claims[m.claim.id] || m.claim
      const era = m.era
      const isDenied = era.status === 'denied'
      if (isDenied) {
        const code = era.adjustments[0]?.reason ? `CO-${era.adjustments[0].reason}` : 'CO-197'
        claimUpserts.push({ ...claim, status: 'denied', denial: { code: 'elig', reason: `Member not eligible / no active auth on DOS`, fix: 'Verify authorization window, then rebill', note: `ERA denial ${code} — ${era.adjustments.map((a) => `${a.group}-${a.reason} $${a.amount}`).join(', ')}`, at }, history: [...claim.history, { at, ev: `Denied via ERA ${fileName} — ${code}` }] })
        deniedCount++
      } else {
        const amount = era.paid || 0
        const adj = era.adjustments.filter((a) => a.group === 'CO').reduce((s, a) => s + a.amount, 0) || 0
        const patientResp = era.patientResp || era.adjustments.filter((a) => a.group === 'PR').reduce((s, a) => s + a.amount, 0) || 0
        if (amount || adj || patientResp) {
          const r2 = (n) => Math.round(n * 100) / 100
          const nextAdj = r2(Math.max(0, adj))
          const due = r2(claim.charges - nextAdj - (claim.paid || 0) - amount)
          const rem = { checkNo: `ERA-${fileName.slice(0, 12)}`, amount, adj: nextAdj, note: `ERA ${fileName} — ${era.claimNo}`, at }
          const status = due <= 0 ? 'paid' : 'partially_paid'
          claimUpserts.push({ ...claim, status, paid: r2((claim.paid || 0) + amount), adj: nextAdj, remittance: rem, closedAt: due <= 0 ? at : claim.closedAt, history: [...claim.history, { at, ev: `ERA payment posted — $${amount.toLocaleString()} via ERA-${fileName.slice(0, 12)}` }] })
          const payId = `pay-era-${at.toString(36)}-${postedCount}`
          paymentsBatch[payId] = { id: payId, claimId: claim.id, clientId: claim.clientId, payer: claim.payer, kind: 'era835', amount: r2(amount), adj: r2(adj), patientResp: r2(patientResp), ref: `ERA-${fileName.slice(0, 12)}`, date: todayISO(), reconciled: false, note: `ERA ${fileName} — ${era.claimNo}`, attachments: [], source: { eraFile: fileName, line: era.claimNo }, reversalOf: null, createdAt: at, createdBy: 'Aloha (local)' }
          postedCount++
        }
      }
    }
    const eraRecord = {
      id: `era-${at.toString(36)}`, fileName, importedAt: at, linesTotal: parsed.lines.length, matched: matched.length, unmatched: unmatched.length,
      status: unmatched.length ? 'parked' : 'posted',
      detail: parsed.lines.map((l) => ({ claimNo: l.claimNo, status: l.status, charges: l.charges, paid: l.paid, patientResp: l.patientResp, adjustments: l.adjustments, raw: l.raw })),
      content: text, errors: parsed.errors,
    }
    state.dispatch({ type: 'claimsTx', claimUpserts, payments: paymentsBatch, eraImports: { [eraRecord.id]: eraRecord } })
    toast({ message: `ERA ${fileName} — ${postedCount} paid, ${deniedCount} denied, ${unmatched.length} unmatched — U to undo`, kind: 'ok' })
    setEraPreview(null); setShowAdd(false)
  }

  const parkEra = () => {
    if (!eraPreview) return
    const { fileName, text, parsed, matched, unmatched } = eraPreview
    const at = Date.now()
    const eraRecord = { id: `era-${at.toString(36)}`, fileName, importedAt: at, linesTotal: parsed.lines.length, matched: matched.length, unmatched: unmatched.length, status: 'parked', detail: parsed.lines.map((l) => ({ claimNo: l.claimNo, status: l.status, charges: l.charges, paid: l.paid, patientResp: l.patientResp, adjustments: l.adjustments, raw: l.raw })), content: text, errors: parsed.errors }
    state.dispatch({ type: 'claimsTx', claimUpserts: [], payments: {}, eraImports: { [eraRecord.id]: eraRecord } })
    toast({ message: `ERA ${fileName} parked — ${unmatched.length} unmatched`, kind: 'info' })
    setEraPreview(null); setShowAdd(false)
  }

  const exportUnmatched = (eraId) => {
    const era = eraImports[eraId]
    if (!era) return
    const unmatched = era.detail?.filter((d) => !Object.values(claims).some((c) => c.no === d.claimNo)) || []
    const rows = [`# Unmatched ERA lines — ${era.fileName}`, 'claim_no,status,charges,paid,patient_resp,adjustments', ...unmatched.map((l) => `${l.claimNo},${l.status},${l.charges},${l.paid},${l.patientResp},"${(l.adjustments || []).map((a) => `${a.group}-${a.reason} $${a.amount}`).join('; ')}"`)]
    download(`Unmatched-${era.fileName.replace(/[^A-Za-z0-9.-]/g, '_')}.csv`, rows.join('\n'))
    toast({ message: `Unmatched CSV — ${unmatched.length} lines`, kind: 'ok' })
  }

  const eraDetail = eraDetailId ? eraImports[eraDetailId] : null

  return (
    <div className="sectionpage" data-testid="pc-sec">
      <SectionBar icon="dollar" title="Payment Center" sub={`Money-in — manual, EOB, ERA 835 · ${range.label} · ${allPayments.length} payments · ${allEras.length} ERAs`}>
        <RangePicker preset={preset} onPreset={(p) => actions.setUI({ payPreset: p })} onSlide={(d) => actions.setUI({ anchor: isoDate(addDays(parseISO(ui.anchor), d * range.days.length)) })} label={range.label} />
        <div className="sb-search" style={{ minWidth: 220 }}>
          <span className="sic">{Icon.search({ size: 12 })}</span>
          <input placeholder="Search payments / ERAs…" value={q} onChange={(e) => setQ(e.target.value)} data-testid="pc-search" />
        </div>
        <button className="btn btn-sm" onClick={generateRemit} data-testid="pc-generate-remit">{Icon.download({ size: 12 })} Remittance CSV</button>
        <button className="btn btn-sm btn-primary" data-testid="pc-add" onClick={() => { setShowAdd(true); setAddTab('manual') }}>{Icon.plus({ size: 12 })} Add Payment</button>
      </SectionBar>

      <div className="batch-strip" style={{ padding: '10px 16px', gap: 8 }}>
        <div className="viewseg" data-testid="pc-tabs">
          <button className={tab === 'payments' ? 'on' : ''} data-testid="pc-tab-payments" onClick={() => setTab('payments')}>{Icon.dollar({ size: 12 })} Payments <span className="pill" style={{ marginLeft: 6 }}>{allPayments.length}</span></button>
          <button className={tab === 'eras' ? 'on' : ''} data-testid="pc-tab-eras" onClick={() => setTab('eras')}>{Icon.file({ size: 12 })} ERAs <span className="pill" style={{ marginLeft: 6 }}>{allEras.length}</span></button>
        </div>
        <span className="muted" style={{ marginLeft: 'auto', fontSize: 11 }}>{tab === 'payments' ? `${filteredPayments.length} filtered payments` : `${filteredEras.length} ERA imports`} · {range.label}</span>
      </div>

      {tab === 'payments' && (
        <div style={{ padding: 16 }}>
          {filteredPayments.length === 0 ? (
            <div className="panel" style={{ borderRadius: 12 }}>
              <div className="py-empty" data-testid="pc-empty" style={{ padding: 40, textAlign: 'center' }}>
                <div style={{ width: 56, height: 56, borderRadius: 14, background: 'var(--panel-2)', display: 'grid', placeItems: 'center', margin: '0 auto 12px', fontSize: 28 }}>💳</div>
                <b>No payments yet</b><div className="muted" style={{ fontSize: 12, marginTop: 4 }}>Record a manual payment or upload an ERA 835 to get started.</div>
                <button className="btn btn-sm btn-primary" style={{ marginTop: 12 }} data-testid="pc-add-empty" onClick={() => { setShowAdd(true); setAddTab('manual') }}>{Icon.plus({ size: 12 })} Add Payment</button>
              </div>
            </div>
          ) : (
            <div className="panel" style={{ borderRadius: 12, overflow: 'hidden', boxShadow: 'var(--shadow-1)' }}>
              <div className="py-tbl" data-testid="pc-payments-table">
                <div className="py-thead" style={{ gridTemplateColumns: '0.8fr 1fr 1fr 1fr 0.8fr 0.9fr 0.7fr 0.6fr 0.7fr 0.8fr 1fr', background: 'var(--panel-2)', fontSize: 11 }}>
                  <span>Date</span><span>Client</span><span>Payer</span><span>Claim #</span><span>Method</span><span>Ref #</span><span>Amount</span><span>Adj</span><span>Pt Resp</span><span>Status</span><span>Actions</span>
                </div>
                {filteredPayments.slice(0, 100).map((p) => {
                  const cl = clientOf(p.clientId)
                  const claim = claimOf(p.claimId)
                  return (
                    <div key={p.id} className="py-trow" data-testid={`pc-row-${p.id}`} style={{ gridTemplateColumns: '0.8fr 1fr 1fr 1fr 0.8fr 0.9fr 0.7fr 0.6fr 0.7fr 0.8fr 1fr', fontSize: 12 }}>
                      <div className="py-cell muted" style={{ fontSize: 11 }}>{p.date}</div>
                      <div className="py-idcell"><b style={{ fontSize: 11 }}>{cl.name || p.clientId}</b></div>
                      <div className="py-cell"><span className="tag soft" style={{ fontSize: 10 }}>{p.payer}</span></div>
                      <div className="py-cell"><span className="ln-code">{claim.no || p.claimId?.slice(0, 12) || '—'}</span></div>
                      <div className="py-cell"><span className="pill" style={{ fontSize: 10 }}>{p.kind}</span></div>
                      <div className="py-cell" style={{ fontSize: 11 }}>{p.ref}</div>
                      <div className="py-cell num" data-testid={`pc-amt-${p.id}`}><b>{money(p.amount)}</b></div>
                      <div className="py-cell num">{p.adj ? money(p.adj) : <span className="muted">—</span>}</div>
                      <div className="py-cell num">{p.patientResp ? money(p.patientResp) : <span className="muted">—</span>}</div>
                      <div className="py-cell"><span className="pill" style={{ background: p.reconciled ? '#d7f5e8' : '#fef3c7', color: p.reconciled ? '#047857' : '#a16207', fontSize: 10 }}>{p.reconciled ? 'Reconciled' : 'Open'}</span></div>
                      <div className="py-cell" style={{ display: 'flex', gap: 4 }}>
                        <button className="btn btn-xs" data-testid={`pc-recon-${p.id}`} onClick={() => handleReconcile(p.id)}>{p.reconciled ? 'Unreconcile' : 'Reconcile'}</button>
                        <button className="btn btn-xs" data-testid={`pc-void-${p.id}`} onClick={() => handleVoid(p.id)} disabled={!!p.reversalOf}>{Icon.x({ size: 10 })} Void</button>
                      </div>
                    </div>
                  )
                })}
                <div className="py-pager" style={{ padding: '10px 14px', background: 'var(--panel-2)', borderTop: '1px solid var(--line)', fontSize: 11, display: 'flex', justifyContent: 'space-between' }}>
                  <span className="muted">Showing {Math.min(filteredPayments.length, 100)} of {filteredPayments.length} payments</span>
                  <span className="muted">Total {money(filteredPayments.reduce((s, p) => s + (p.amount || 0), 0))} collected</span>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'eras' && (
        <div style={{ padding: 16 }}>
          {filteredEras.length === 0 ? (
            <div className="panel" style={{ borderRadius: 12 }}>
              <div className="py-empty" data-testid="pc-eras-empty" style={{ padding: 40, textAlign: 'center' }}>
                <div style={{ width: 56, height: 56, borderRadius: 14, background: 'var(--panel-2)', display: 'grid', placeItems: 'center', margin: '0 auto 12px', fontSize: 28 }}>📄</div>
                <b>No ERA imports yet</b><div className="muted" style={{ fontSize: 12, marginTop: 4 }}>Upload an 835 file to parse and post remittances.</div>
                <button className="btn btn-sm btn-primary" style={{ marginTop: 12 }} data-testid="pc-upload-empty" onClick={() => { setShowAdd(true); setAddTab('era') }}>{Icon.plus({ size: 12 })} Upload ERA</button>
              </div>
            </div>
          ) : (
            <>
              <div className="panel" style={{ borderRadius: 12, overflow: 'hidden', boxShadow: 'var(--shadow-1)' }}>
                <div className="py-tbl" data-testid="pc-eras-table">
                  <div className="py-thead" style={{ gridTemplateColumns: '2fr 1fr 0.6fr 0.6fr 0.7fr 0.8fr 1.2fr', background: 'var(--panel-2)', fontSize: 11 }}>
                    <span>File</span><span>Imported</span><span>Lines</span><span>Matched</span><span>Unmatched</span><span>Status</span><span>Actions</span>
                  </div>
                  {filteredEras.map((e) => (
                    <div key={e.id} className="py-trow" data-testid={`pc-era-row-${e.id}`} onClick={() => setEraDetailId(e.id)} style={{ gridTemplateColumns: '2fr 1fr 0.6fr 0.6fr 0.7fr 0.8fr 1.2fr', cursor: 'pointer', fontSize: 12 }}>
                      <div className="py-idcell"><b style={{ fontSize: 11 }}>{e.fileName}</b></div>
                      <div className="py-cell muted" style={{ fontSize: 11 }}>{fmtDayLabel(isoDate(new Date(e.importedAt)))}</div>
                      <div className="py-cell num">{e.linesTotal}</div>
                      <div className="py-cell num" style={{ color: '#047857', fontWeight: 700 }}>{e.matched}</div>
                      <div className="py-cell num" style={{ color: e.unmatched ? '#b91c1c' : undefined, fontWeight: e.unmatched ? 700 : 400 }}>{e.unmatched}</div>
                      <div className="py-cell"><span className="pill" style={{ background: e.status === 'posted' ? '#d7f5e8' : '#fef3c7', fontSize: 10 }}>{e.status}</span></div>
                      <div className="py-cell" style={{ display: 'flex', gap: 4 }}>
                        <button className="btn btn-xs" data-testid={`pc-era-view-${e.id}`} onClick={(ev) => { ev.stopPropagation(); setEraDetailId(e.id) }}>{Icon.eye({ size: 10 })} View</button>
                        <button className="btn btn-xs" data-testid={`pc-era-unmatched-${e.id}`} onClick={(ev) => { ev.stopPropagation(); exportUnmatched(e.id) }}>{Icon.download({ size: 10 })} Unmatched CSV</button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              {eraDetail && (
                <div className="panel" style={{ marginTop: 16, borderRadius: 12, overflow: 'hidden', boxShadow: 'var(--shadow-1)' }} data-testid="pc-era-detail">
                  <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 8, background: 'var(--panel-2)' }}>
                    <span style={{ width: 24, height: 24, borderRadius: 6, background: '#0ea5e9', color: '#fff', display: 'grid', placeItems: 'center' }}>{Icon.file({ size: 12 })}</span>
                    <b style={{ fontSize: 12 }}>ERA Detail — {eraDetail.fileName}</b>
                    <span className="an-spacer" />
                    <button className="btn btn-xs" data-testid="pc-era-export-unmatched" onClick={() => exportUnmatched(eraDetail.id)}>{Icon.download({ size: 10 })} Export unmatched CSV</button>
                    <button className="btn btn-xs" onClick={() => setEraDetailId(null)}>{Icon.x({ size: 10 })} Close</button>
                  </div>
                  <div className="py-tbl" style={{ maxHeight: 380, overflow: 'auto' }}>
                    <div className="py-thead" style={{ gridTemplateColumns: '1.2fr 0.7fr 0.7fr 0.7fr 0.7fr 0.6fr 0.8fr 0.6fr', background: 'var(--panel-2)', fontSize: 11 }}>
                      <span>Claim #</span><span>Status</span><span>Charged</span><span>Paid</span><span>Pt Resp</span><span>Adj</span><span>CARC</span><span>Actions</span>
                    </div>
                    {(eraDetail.detail || []).map((l, i) => {
                      const matched = Object.values(claims).some((c) => c.no === l.claimNo)
                      return (
                        <div key={i} className="py-trow" data-testid={`pc-era-line-${i}`} style={{ gridTemplateColumns: '1.2fr 0.7fr 0.7fr 0.7fr 0.7fr 0.6fr 0.8fr 0.6fr', background: matched ? '#f0fdf4' : '#fefce8', fontSize: 11 }}>
                          <div className="py-cell"><span className="ln-code">{l.claimNo}</span></div>
                          <div className="py-cell"><span className="pill" style={{ fontSize: 10 }}>{l.status}</span></div>
                          <div className="py-cell num">{money(l.charges)}</div>
                          <div className="py-cell num"><b>{money(l.paid)}</b></div>
                          <div className="py-cell num">{money(l.patientResp || 0)}</div>
                          <div className="py-cell num">{money((l.adjustments || []).reduce((s, a) => s + a.amount, 0))}</div>
                          <div className="py-cell muted" style={{ fontSize: 10 }}>{(l.adjustments || []).map((a) => `${a.group}-${a.reason}`).join(', ') || '—'}</div>
                          <div className="py-cell">{matched ? <span className="pill" style={{ background: '#d7f5e8', fontSize: 10 }}>Matched</span> : <span className="pill" style={{ background: '#fee2e2', fontSize: 10 }}>Unmatched</span>}</div>
                        </div>
                      )
                    })}
                  </div>
                  {eraDetail.errors?.length > 0 && <div style={{ padding: '8px 14px', color: '#b91c1c', fontSize: 11, background: '#fef2f2' }}>Parser errors: {eraDetail.errors.join('; ')}</div>}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {showAdd && (
        <div className="overlay" data-testid="pc-add-modal" onClick={() => setShowAdd(false)} style={{ backdropFilter: 'blur(6px)' }}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 760, maxWidth: '92vw', borderRadius: 16, overflow: 'hidden', boxShadow: 'var(--shadow-3)' }}>
            <div className="modal-head" style={{ padding: '14px 18px', background: 'var(--panel-2)', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ width: 28, height: 28, borderRadius: 8, background: '#6366f1', color: '#fff', display: 'grid', placeItems: 'center' }}>{Icon.dollar({ size: 14 })}</span>
              <b>Add Payment</b>
              <span className="an-spacer" />
              <button className="iconbtn" onClick={() => setShowAdd(false)} style={{ width: 28, height: 28, borderRadius: 8 }}>{Icon.x({ size: 14 })}</button>
            </div>
            <div className="viewseg" style={{ margin: '12px 16px' }}>
              <button className={addTab === 'manual' ? 'on' : ''} data-testid="pc-manual-tab" onClick={() => setAddTab('manual')}>{Icon.edit({ size: 12 })} Manual Payment</button>
              <button className={addTab === 'era' ? 'on' : ''} data-testid="pc-era-tab" onClick={() => setAddTab('era')}>{Icon.file({ size: 12 })} Upload ERA (835)</button>
            </div>
            <div style={{ padding: '0 18px 18px' }}>
              {addTab === 'manual' && <ManualForm onClose={() => setShowAdd(false)} />}
              {addTab === 'era' && (
                <div data-testid="pc-era-upload-pane">
                  {!eraPreview ? (
                    <>
                      <div className="panel" style={{ border: '2px dashed var(--line)', borderRadius: 12, padding: 32, textAlign: 'center', background: 'var(--panel-2)' }}>
                        <div style={{ width: 48, height: 48, borderRadius: 12, background: 'var(--panel)', display: 'grid', placeItems: 'center', margin: '0 auto 12px', fontSize: 24 }}>📄</div>
                        <b>Drop an 835 file here or click to browse</b>
                        <div style={{ marginTop: 12 }}><input type="file" accept=".835,.txt" data-testid="pc-era-upload" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleEraFile(f) }} /></div>
                        <div className="muted" style={{ fontSize: 11, marginTop: 12 }}>Accepts .835 / .txt X12 ERA. Parsed by parse835 — matched green, unmatched amber.</div>
                      </div>
                      <div style={{ marginTop: 12 }}><button className="btn btn-sm" data-testid="pc-era-fixture" onClick={async () => {
                        const txt = `ISA*00*          *00*          *ZZ*SENDER         *ZZ*RECEIVER       *240925*1200*U*00401*000000001*0*P*:~\nGS*HP*SENDER*RECEIVER*20240925*1200*1*X*004010X091A1~\nST*835*0001~\nBPR*I*500*C*ACH*CCP*01*999988888*DA*123456789*1234567890**01*999988888*DA*123456789*20240925~\nCLP*CLM-202609-001*1*300*240*60*12*CLM-202609-001*11*1~\nCAS*CO*42*60~\nLX*2~\nCLP*CLM-202609-002*4*200*0*200*12*CLM-202609-002*11*1~\nCAS*CO*197*200~\nLX*3~\nCLP*CLM-202609-003*2*150*100*0*12*CLM-202609-003*11*1~\nCAS*CO*42*50~\nLX*4~\nCLP*CLM-202609-004*1*400*400*0*12*CLM-202609-004*11*1~\nLX*5~\nCLP*CLM-202609-005*1*250*200*50*12*CLM-202609-005*11*1~\nCAS*PR*2*50~\nSE*30*0001~\nGE*1*1~\nIEA*1*000000001~`
                        const parsed = parse835(txt)
                        const { matched, unmatched } = matchEraLines(parsed.lines, claims)
                        setEraPreview({ fileName: '835-full.txt (fixture)', text: txt, parsed, matched, unmatched })
                      }}>{Icon.zap({ size: 11 })} Load demo fixture (5 lines)</button></div>
                    </>
                  ) : (
                    <div data-testid="pc-era-preview">
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}><span style={{ width: 24, height: 24, borderRadius: 6, background: '#10b981', color: '#fff', display: 'grid', placeItems: 'center' }}>{Icon.checkCircle({ size: 12 })}</span><b>Preview — {eraPreview.fileName}</b><span className="tag soft">{eraPreview.parsed.lines.length} lines · {eraPreview.matched.length} matched · {eraPreview.unmatched.length} unmatched</span></div>
                      <div className="tablewrap" style={{ maxHeight: 260, overflow: 'auto', borderRadius: 8, border: '1px solid var(--line)' }}>
                        <table className="table" style={{ fontSize: 11 }}>
                          <thead style={{ position: 'sticky', top: 0, background: 'var(--panel)' }}><tr><th>Claim #</th><th>Status</th><th>Charged</th><th>Paid</th><th>Pt Resp</th><th>CARC</th><th>Match</th></tr></thead>
                          <tbody>
                            {eraPreview.parsed.lines.map((l, i) => {
                              const isMatched = eraPreview.matched.some((m) => m.era.claimNo === l.claimNo)
                              return <tr key={i} data-testid={`pc-era-prev-line-${i}`} style={{ background: isMatched ? '#f0fdf4' : '#fefce8' }}><td><span className="ln-code">{l.claimNo}</span></td><td><span className="pill" style={{ fontSize: 10 }}>{l.status}</span></td><td>{money(l.charges)}</td><td><b>{money(l.paid)}</b></td><td>{money(l.patientResp || 0)}</td><td>{(l.adjustments || []).map((a) => `${a.group}-${a.reason}`).join(', ') || '—'}</td><td>{isMatched ? <span className="tag" style={{ background: '#d7f5e8', fontSize: 10 }}>Matched</span> : <span className="tag" style={{ background: '#fee2e2', fontSize: 10 }}>Unmatched</span>}</td></tr>
                            })}
                          </tbody>
                        </table>
                      </div>
                      <div style={{ display: 'flex', gap: 8, marginTop: 14, justifyContent: 'flex-end' }}>
                        <button className="btn btn-sm" data-testid="pc-era-park" onClick={parkEra}>Park</button>
                        <button className="btn btn-sm btn-primary" data-testid="pc-era-post" onClick={postEra}>{Icon.check({ size: 11 })} Post {eraPreview.matched.length} lines</button>
                        <button className="btn btn-sm" onClick={() => setEraPreview(null)}>Back</button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function ManualForm({ onClose }) {
  const state = useStore()
  const { actions, claims, clients } = state
  const toast = useToast()
  const [payer, setPayer] = useState('')
  const [claimId, setClaimId] = useState('')
  const [date, setDate] = useState(todayISO())
  const [type, setType] = useState('check')
  const [ref, setRef] = useState('')
  const [amount, setAmount] = useState('')
  const [adj, setAdj] = useState('')
  const [ptResp, setPtResp] = useState('')
  const [reconciled, setReconciled] = useState(false)
  const [note, setNote] = useState('')

  const payers = useMemo(() => [...new Set(Object.values(claims).map((c) => c.payer))], [claims])
  const openClaims = useMemo(() => Object.values(claims).filter((c) => {
    if (payer && c.payer !== payer) return false
    return ['submitted', 'partially_paid', 'processing', 'draft'].includes(c.status)
  }), [claims, payer])

  const selectedClaim = claimId ? claims[claimId] : null
  const due = selectedClaim ? dueOf(selectedClaim) : null

  const handleSave = () => {
    if (!claimId) { toast({ message: 'Select a claim', kind: 'warn' }); return }
    if (!ref.trim()) { toast({ message: 'Reference # required', kind: 'warn' }); return }
    const amt = parseFloat(amount) || 0
    if (amt <= 0) { toast({ message: 'Amount must be > 0', kind: 'warn' }); return }
    if (due != null && amt > due + 0.01) {
      toast({ message: `Overpay warning — due ${money(due)}, entered ${money(amt)}`, kind: 'warn' })
    }
    const r = actions.postPayment(claimId, { amount: amt, adj: parseFloat(adj) || 0, patientResp: parseFloat(ptResp) || 0, checkNo: ref, kind: type, date, reconciled, note, source: null })
    toast({ message: r.msg, kind: r.ok ? 'ok' : 'warn' })
    if (r.ok) onClose()
  }

  return (
    <div data-testid="pc-manual-form" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <label className="bil-fld" style={{ margin: 0 }}><span>Payer*</span><select className="input" data-testid="pc-manual-payer" value={payer} onChange={(e) => { setPayer(e.target.value); setClaimId('') }}><option value="">Select payer…</option>{payers.map((p) => <option key={p} value={p}>{p}</option>)}</select></label>
        <label className="bil-fld" style={{ margin: 0 }}><span>Claim*</span><select className="input" data-testid="pc-manual-claim" value={claimId} onChange={(e) => setClaimId(e.target.value)}><option value="">Select claim…</option>{openClaims.map((c) => { const cl = clients.find((x) => x.id === c.clientId); return <option key={c.id} value={c.id}>{c.no} — {cl?.name || c.clientId} — {money(dueOf(c))} due</option> })}</select></label>
        <label className="bil-fld" style={{ margin: 0 }}><span>Payment Date*</span><input className="input" type="date" data-testid="pc-manual-date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <label className="bil-fld" style={{ margin: 0 }}><span>Payment Type</span><select className="input" data-testid="pc-manual-type" value={type} onChange={(e) => setType(e.target.value)}><option value="check">Check</option><option value="credit">Credit</option><option value="debit">Debit</option><option value="cash">Cash</option><option value="ach">ACH</option><option value="eob">EOB</option><option value="writeoff">Write-off</option></select></label>
        <label className="bil-fld" style={{ margin: 0 }}><span>Reference #*</span><input className="input" data-testid="pc-manual-ref" value={ref} onChange={(e) => setRef(e.target.value)} placeholder="CHK-1042" /></label>
        <label className="bil-fld" style={{ margin: 0 }}><span>Amount*</span><input className="input" data-testid="pc-manual-amount" type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={due != null ? `Due ${due}` : ''} /></label>
        <label className="bil-fld" style={{ margin: 0 }}><span>Adjustment (contractual)</span><input className="input" data-testid="pc-manual-adj" type="number" step="0.01" value={adj} onChange={(e) => setAdj(e.target.value)} placeholder="0.00" /></label>
        <label className="bil-fld" style={{ margin: 0 }}><span>Patient Resp</span><input className="input" data-testid="pc-manual-ptresp" type="number" step="0.01" value={ptResp} onChange={(e) => setPtResp(e.target.value)} placeholder="0.00" /></label>
        <label className="bil-fld" style={{ margin: 0, gridColumn: '1 / -1' }}><span>Note</span><input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional note" /></label>
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '10px 12px', background: 'var(--panel-2)', borderRadius: 8, border: '1px solid var(--line)' }}>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, cursor: 'pointer' }}><input type="checkbox" data-testid="pc-manual-reconciled" checked={reconciled} onChange={(e) => setReconciled(e.target.checked)} /> Payment Reconciled</label>
        {selectedClaim && <span className="muted" style={{ marginLeft: 'auto', fontSize: 11 }}>Open due: {money(due)} · Charges {money(selectedClaim.charges)} · Paid {money(selectedClaim.paid || 0)}</span>}
      </div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button className="btn btn-sm" onClick={onClose}>Cancel</button>
        <button className="btn btn-sm btn-primary" data-testid="pc-manual-save" onClick={handleSave}>{Icon.check({ size: 11 })} Save Payment</button>
      </div>
    </div>
  )
}
