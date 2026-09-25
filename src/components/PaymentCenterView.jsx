import React, { useMemo, useState, useRef } from 'react'
import { useStore } from '../state/store'
import { SectionBar, RangePicker } from './NavRail'
import { Icon } from '../ui/Icons'
import { useToast } from '../ui/Toast'
import { resolveRange } from '../lib/analytics'
import { download } from '../lib/ics'
import { isoDate, addDays, parseISO, fmtDayLabel, todayISO } from '../lib/date'
import { dueOf, CLAIM_STATUSES } from '../lib/claims'
import { parse835, matchEraLines } from '../lib/era'

const money = (n) => `$${(Math.round(n * 100) / 100).toLocaleString(undefined, { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`

export default function PaymentCenterView() {
  const state = useStore()
  const { ui, actions, settings, claims, clients, payers } = state
  const toast = useToast()
  const payments = state.payments || {}
  const eraImports = state.eraImports || {}

  const preset = ui.payPreset || 'last4'
  const range = useMemo(() => resolveRange(preset, ui.anchor, settings.weekStart), [preset, ui.anchor, settings.weekStart])

  const [tab, setTab] = useState('payments') // payments | eras
  const [q, setQ] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [addTab, setAddTab] = useState('manual') // manual | era
  const [eraPreview, setEraPreview] = useState(null) // { fileName, parsed, matched, unmatched, text }
  const [eraDetailId, setEraDetailId] = useState(null)

  // payments list
  const allPayments = useMemo(() => Object.values(payments).sort((a,b)=>b.createdAt - a.createdAt), [payments])
  const filteredPayments = useMemo(() => {
    const t = q.trim().toLowerCase()
    return allPayments.filter((p) => {
      if (t) {
        const cl = clients.find((c)=>c.id===p.clientId)
        const claim = claims[p.claimId]
        const hay = `${p.ref} ${p.payer} ${cl?.name||''} ${claim?.no||''} ${p.kind}`.toLowerCase()
        if (!hay.includes(t)) return false
      }
      // range filter on payment date
      if (p.date) {
        if (p.date < range.days[0] || p.date > range.days[range.days.length-1]) return false
      }
      return true
    })
  }, [allPayments, q, range, clients, claims])

  // eras list
  const allEras = useMemo(() => Object.values(eraImports).sort((a,b)=>b.importedAt - a.importedAt), [eraImports])
  const filteredEras = useMemo(() => {
    const t = q.trim().toLowerCase()
    return allEras.filter((e) => {
      if (!t) return true
      return `${e.fileName} ${e.status}`.toLowerCase().includes(t)
    })
  }, [allEras, q])

  const clientOf = (id) => clients.find((c)=>c.id===id) || {}
  const claimOf = (id) => claims[id] || {}

  const handleVoid = (payId) => {
    const r = actions.voidPayment(payId)
    toast({ message: r.msg, kind: r.ok?'ok':'warn' })
  }
  const handleReconcile = (payId) => {
    const p = payments[payId]
    if (!p) return
    // toggle reconciled via record patch? We'll do direct store patch via record? Simplest: create new payment with reconciled toggle via store dispatch record
    // Since payments are immutable, we will update via a custom action: we can use store's record to overwrite? The record action just adds/overwrites by id.
    actions.record('payments', { ...p, reconciled: !p.reconciled })
    toast({ message: p.reconciled ? 'Marked open' : 'Reconciled', kind: 'ok' })
  }

  const generateRemit = () => {
    // remittance batch export: open payables in range
    const openClaims = Object.values(claims).filter((c)=> dueOf(c) > 0.5 && c.status!=='void')
    const rows = [
      `# ${settings.org?.name||'Practice'} — remittance batch · ${range.label}`,
      'claim,client,payer,dos_from,dos_to,charges,paid,adj,due,status',
      ...openClaims.map((c)=>{
        const cl = clientOf(c.clientId)
        return `${c.no},"${cl.name||''}",${c.payer},${c.dosFrom},${c.dosTo},${c.charges},${c.paid||0},${c.adj||0},${dueOf(c)},${c.status}`
      })
    ]
    const fileName = `Remittance-${range.days[0]}-to-${range.days[range.days.length-1]}.csv`
    download(fileName, rows.join('\n'))
    // record in billedFiles
    actions.record('billedFiles', { fileName, payer: 'All', clientCount: new Set(openClaims.map((c)=>c.clientId)).size, claimCount: openClaims.length, claimIds: openClaims.map((c)=>c.id), date: todayISO(), sendCount: 1, content: rows.join('\n'), createdAt: Date.now(), format: 'remittance' })
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
    // batch all claim updates + payments into ONE claimsTx for single undo
    const claimUpserts = []
    const paymentsBatch = {}
    let postedCount = 0, deniedCount = 0
    for (const m of matched) {
      const claim = state.claims[m.claim.id] || m.claim
      const era = m.era
      const isDenied = era.status === 'denied'
      if (isDenied) {
        const code = era.adjustments[0]?.reason ? `CO-${era.adjustments[0].reason}` : 'CO-197'
        // denyPatch inline
        const denial = { code: 'elig', reason: `Member not eligible / no active auth on DOS`, fix: 'Verify authorization window, then rebill', note: `ERA denial ${code} — ${era.adjustments.map((a)=>`${a.group}-${a.reason} $${a.amount}`).join(', ')}`, at }
        claimUpserts.push({ ...claim, status: 'denied', denial: { code: 'elig', reason: denial.reason, fix: denial.fix, note: denial.note, at }, history: [...claim.history, { at, ev: `Denied via ERA ${fileName} — ${code}` }] })
        deniedCount++
      } else {
        const amount = era.paid || 0
        const adj = era.adjustments.filter((a)=>a.group==='CO').reduce((s,a)=>s+a.amount,0) || 0
        const patientResp = era.patientResp || era.adjustments.filter((a)=>a.group==='PR').reduce((s,a)=>s+a.amount,0) || 0
        if (amount || adj || patientResp) {
          const r2 = (n)=>Math.round(n*100)/100
          const nextAdj = r2(Math.max(0, adj))
          const due = r2(claim.charges - nextAdj - (claim.paid||0) - amount)
          const rem = { checkNo: `ERA-${fileName.slice(0,12)}`, amount, adj: nextAdj, note: `ERA ${fileName} — ${era.claimNo}`, at }
          const status = due<=0 ? 'paid' : 'partially_paid'
          claimUpserts.push({ ...claim, status, paid: r2((claim.paid||0)+amount), adj: nextAdj, remittance: rem, closedAt: due<=0?at:claim.closedAt, history: [...claim.history, { at, ev: `ERA payment posted — $${amount.toLocaleString()} via ERA-${fileName.slice(0,12)}${nextAdj?` (${nextAdj.toLocaleString()} adj)`:''}${due>0?` · $${due} still open`:''}` }] })
          const payId = `pay-era-${at.toString(36)}-${postedCount}`
          paymentsBatch[payId] = { id: payId, claimId: claim.id, clientId: claim.clientId, payer: claim.payer, kind: 'era835', amount: r2(amount), adj: r2(adj), patientResp: r2(patientResp), ref: `ERA-${fileName.slice(0,12)}`, date: todayISO(), reconciled: false, note: `ERA ${fileName} — ${era.claimNo}`, attachments: [], source: { eraFile: fileName, line: era.claimNo }, reversalOf: null, createdAt: at, createdBy: 'Aloha (local)' }
          postedCount++
        }
      }
    }
    const eraRecord = {
      id: `era-${at.toString(36)}`,
      fileName,
      importedAt: at,
      linesTotal: parsed.lines.length,
      matched: matched.length,
      unmatched: unmatched.length,
      status: unmatched.length ? 'parked' : 'posted',
      detail: parsed.lines.map((l)=>({ claimNo: l.claimNo, status: l.status, charges: l.charges, paid: l.paid, patientResp: l.patientResp, adjustments: l.adjustments, raw: l.raw })),
      content: text,
      errors: parsed.errors,
    }
    // single dispatch for all + eraImport
    state.dispatch({ type: 'claimsTx', claimUpserts, payments: paymentsBatch, eraImports: { [eraRecord.id]: eraRecord } })
    toast({ message: `ERA ${fileName} — ${postedCount} paid, ${deniedCount} denied, ${unmatched.length} unmatched ${unmatched.length?'parked':''} — press U to undo whole import`, kind: 'ok' })
    setEraPreview(null)
    setShowAdd(false)
  }

  const parkEra = () => {
    if (!eraPreview) return
    const { fileName, text, parsed, matched, unmatched } = eraPreview
    const at = Date.now()
    const eraRecord = {
      id: `era-${at.toString(36)}`,
      fileName,
      importedAt: at,
      linesTotal: parsed.lines.length,
      matched: matched.length,
      unmatched: unmatched.length,
      status: 'parked',
      detail: parsed.lines.map((l)=>({ claimNo: l.claimNo, status: l.status, charges: l.charges, paid: l.paid, patientResp: l.patientResp, adjustments: l.adjustments, raw: l.raw })),
      content: text,
      errors: parsed.errors,
    }
    state.dispatch({ type: 'claimsTx', claimUpserts: [], payments: {}, eraImports: { [eraRecord.id]: eraRecord } })
    toast({ message: `ERA ${fileName} parked — ${unmatched.length} unmatched`, kind: 'info' })
    setEraPreview(null)
    setShowAdd(false)
  }

  const exportUnmatched = (eraId) => {
    const era = eraImports[eraId]
    if (!era) return
    const unmatched = era.detail?.filter((d)=> !Object.values(claims).some((c)=>c.no===d.claimNo)) || []
    const rows = [
      `# Unmatched ERA lines — ${era.fileName}`,
      'claim_no,status,charges,paid,patient_resp,adjustments',
      ...unmatched.map((l)=> `${l.claimNo},${l.status},${l.charges},${l.paid},${l.patientResp},"${(l.adjustments||[]).map((a)=>`${a.group}-${a.reason} $${a.amount}`).join('; ')}"`),
    ]
    download(`Unmatched-${era.fileName.replace(/[^A-Za-z0-9.-]/g,'_')}.csv`, rows.join('\n'))
    toast({ message: `Unmatched CSV — ${unmatched.length} lines`, kind: 'ok' })
  }

  const eraDetail = eraDetailId ? eraImports[eraDetailId] : null

  return (
    <div className="sectionpage" data-testid="pc-sec">
      <SectionBar icon="dollar" title="Payment Center" sub={`Money-in — manual, EOB, ERA 835 · ${range.label}`}>
        <RangePicker preset={preset} onPreset={(p)=>actions.setUI({ payPreset: p })} onSlide={(d)=>actions.setUI({ anchor: isoDate(addDays(parseISO(ui.anchor), d*range.days.length)) })} label={range.label} />
        <input className="input" placeholder="Search payments / ERAs…" value={q} onChange={(e)=>setQ(e.target.value)} data-testid="pc-search" style={{ width:220 }} />
        <button className="btn btn-sm" onClick={generateRemit} data-testid="pc-generate-remit" title="Remittance batch export of open dues">{Icon.download({ size:13 })} Remittance CSV</button>
      </SectionBar>

      <div className="tabs" data-testid="pc-tabs" style={{ padding:'0 16px' }}>
        <button className={`tab ${tab==='payments'?'on':''}`} data-testid="pc-tab-payments" onClick={()=>setTab('payments')}>Payments <span className="pill">{allPayments.length}</span></button>
        <button className={`tab ${tab==='eras'?'on':''}`} data-testid="pc-tab-eras" onClick={()=>setTab('eras')}>ERAs <span className="pill">{allEras.length}</span></button>
      </div>

      {tab==='payments' && (
        <div style={{ padding:16 }}>
          {filteredPayments.length===0 ? (
            <div className="empty" data-testid="pc-empty">
              <div style={{ fontSize:32 }}>💳</div>
              <b>No payments yet</b>
              <span>Record a manual payment or upload an ERA 835 to get started.</span>
              <button className="btn btn-primary" data-testid="pc-add-empty" onClick={()=>{ setShowAdd(true); setAddTab('manual') }}>Add Payment</button>
            </div>
          ) : (
            <div className="tablewrap" data-testid="pc-payments-table">
              <table className="table">
                <thead>
                  <tr><th>Date</th><th>Client</th><th>Payer</th><th>Claim #</th><th>Method</th><th>Ref #</th><th>Amount</th><th>Adj</th><th>Pt Resp</th><th>Status</th><th>Actions</th></tr>
                </thead>
                <tbody>
                  {filteredPayments.slice(0,100).map((p)=>{
                    const cl = clientOf(p.clientId)
                    const claim = claimOf(p.claimId)
                    return (
                      <tr key={p.id} data-testid={`pc-row-${p.id}`}>
                        <td>{p.date}</td>
                        <td>{cl.name||p.clientId}</td>
                        <td>{p.payer}</td>
                        <td>{claim.no||p.claimId?.slice(0,12)||'—'}</td>
                        <td><span className="pill">{p.kind}</span></td>
                        <td>{p.ref}</td>
                        <td data-testid={`pc-amt-${p.id}`}>{money(p.amount)}</td>
                        <td>{p.adj?money(p.adj):'—'}</td>
                        <td>{p.patientResp?money(p.patientResp):'—'}</td>
                        <td><span className={`clm-status`} style={{ background: p.reconciled?'#d7f5e8':'#fef3c7', color: p.reconciled?'#047857':'#a16207' }}>{p.reconciled?'Reconciled':'Open'}</span></td>
                        <td>
                          <button className="btn btn-xs" data-testid={`pc-recon-${p.id}`} onClick={()=>handleReconcile(p.id)}>{p.reconciled?'Unreconcile':'Reconcile'}</button>
                          <button className="btn btn-xs" data-testid={`pc-void-${p.id}`} onClick={()=>handleVoid(p.id)} disabled={!!p.reversalOf}>Void</button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              <div className="footer">Showing {Math.min(filteredPayments.length,100)} of {filteredPayments.length} payments</div>
            </div>
          )}
          <button className="fab" data-testid="pc-add" onClick={()=>{ setShowAdd(true); setAddTab('manual') }} title="Add payment">+</button>
        </div>
      )}

      {tab==='eras' && (
        <div style={{ padding:16 }}>
          {filteredEras.length===0 ? (
            <div className="empty" data-testid="pc-eras-empty">
              <div style={{ fontSize:32 }}>📄</div>
              <b>No ERA imports yet</b>
              <span>Upload an 835 file to parse and post remittances.</span>
              <button className="btn btn-primary" data-testid="pc-upload-empty" onClick={()=>{ setShowAdd(true); setAddTab('era') }}>Upload ERA</button>
            </div>
          ) : (
            <>
              <div className="tablewrap" data-testid="pc-eras-table">
                <table className="table">
                  <thead><tr><th>File</th><th>Imported</th><th>Lines</th><th>Matched</th><th>Unmatched</th><th>Status</th><th>Actions</th></tr></thead>
                  <tbody>
                    {filteredEras.map((e)=>(
                      <tr key={e.id} data-testid={`pc-era-row-${e.id}`} onClick={()=>setEraDetailId(e.id)} style={{ cursor:'pointer' }}>
                        <td>{e.fileName}</td>
                        <td>{fmtDayLabel(isoDate(new Date(e.importedAt)))}</td>
                        <td>{e.linesTotal}</td>
                        <td style={{ color:'#047857' }}>{e.matched}</td>
                        <td style={{ color: e.unmatched?'#b91c1c':'inherit' }}>{e.unmatched}</td>
                        <td><span className="pill" style={{ background: e.status==='posted'?'#d7f5e8':'#fef3c7' }}>{e.status}</span></td>
                        <td>
                          <button className="btn btn-xs" data-testid={`pc-era-view-${e.id}`} onClick={(ev)=>{ ev.stopPropagation(); setEraDetailId(e.id)}}>View</button>
                          <button className="btn btn-xs" data-testid={`pc-era-unmatched-${e.id}`} onClick={(ev)=>{ ev.stopPropagation(); exportUnmatched(e.id)}}>Export unmatched CSV</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {eraDetail && (
                <div className="panel" style={{ marginTop:16 }} data-testid="pc-era-detail">
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                    <h3>ERA Detail — {eraDetail.fileName}</h3>
                    <div style={{ display:'flex', gap:8 }}>
                      <button className="btn btn-xs" data-testid="pc-era-export-unmatched" onClick={()=>exportUnmatched(eraDetail.id)}>Export unmatched CSV</button>
                      <button className="btn btn-xs" onClick={()=>setEraDetailId(null)}>Close</button>
                    </div>
                  </div>
                  <div className="tablewrap" style={{ marginTop:12 }}>
                    <table className="table">
                      <thead><tr><th>Claim #</th><th>Status</th><th>Charged</th><th>Paid</th><th>Pt Resp</th><th>Adj</th><th>CARC</th><th>Actions</th></tr></thead>
                      <tbody>
                        {(eraDetail.detail||[]).map((l,i)=>{
                          const matched = Object.values(claims).some((c)=>c.no===l.claimNo)
                          return (
                            <tr key={i} data-testid={`pc-era-line-${i}`} style={{ background: matched?'#f0fdf4':'#fefce8' }}>
                              <td>{l.claimNo}</td>
                              <td>{l.status}</td>
                              <td>{money(l.charges)}</td>
                              <td>{money(l.paid)}</td>
                              <td>{money(l.patientResp||0)}</td>
                              <td>{money((l.adjustments||[]).reduce((s,a)=>s+a.amount,0))}</td>
                              <td>{(l.adjustments||[]).map((a)=>`${a.group}-${a.reason}`).join(', ')||'—'}</td>
                              <td>
                                {matched ? <span className="pill" style={{ background:'#d7f5e8' }}>Matched</span> : <span className="pill" style={{ background:'#fee2e2' }}>Unmatched</span>}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                  {eraDetail.errors?.length>0 && <div style={{ marginTop:8, color:'#b91c1c' }}>Parser errors: {eraDetail.errors.join('; ')}</div>}
                </div>
              )}
            </>
          )}
          <button className="fab" data-testid="pc-add-era" onClick={()=>{ setShowAdd(true); setAddTab('era') }} title="Upload ERA">+</button>
        </div>
      )}

      {showAdd && (
        <div className="modal-overlay" data-testid="pc-add-modal" onClick={()=>setShowAdd(false)}>
          <div className="modal" onClick={(e)=>e.stopPropagation()} style={{ width:720, maxWidth:'90vw' }}>
            <div className="modal-head">
              <h3>Add Payment</h3>
              <button className="iconbtn" onClick={()=>setShowAdd(false)}>✕</button>
            </div>
            <div className="tabs" style={{ padding:'0 16px' }}>
              <button className={`tab ${addTab==='manual'?'on':''}`} data-testid="pc-manual-tab" onClick={()=>setAddTab('manual')}>Manual Payment</button>
              <button className={`tab ${addTab==='era'?'on':''}`} data-testid="pc-era-tab" onClick={()=>setAddTab('era')}>Upload ERA (835)</button>
            </div>
            <div style={{ padding:16 }}>
              {addTab==='manual' && <ManualForm onClose={()=>setShowAdd(false)} />}
              {addTab==='era' && (
                <div data-testid="pc-era-upload-pane">
                  {!eraPreview ? (
                    <>
                      <div className="dropzone" style={{ border:'2px dashed var(--border)', borderRadius:12, padding:24, textAlign:'center' }}>
                        <p>Drop an 835 file here or click to browse</p>
                        <input type="file" accept=".835,.txt" data-testid="pc-era-upload" onChange={(e)=>{ const f=e.target.files?.[0]; if(f) handleEraFile(f) }} />
                        <p style={{ fontSize:12, color:'var(--muted)', marginTop:8 }}>Accepts .835 / .txt X12 ERA. Parsed by parse835 — matched green, unmatched amber.</p>
                      </div>
                      <div style={{ marginTop:12 }}>
                        <button className="btn btn-sm" data-testid="pc-era-fixture" onClick={async()=>{
                          const txt = `ISA*00*          *00*          *ZZ*SENDER         *ZZ*RECEIVER       *240925*1200*U*00401*000000001*0*P*:~
GS*HP*SENDER*RECEIVER*20240925*1200*1*X*004010X091A1~
ST*835*0001~
BPR*I*500*C*ACH*CCP*01*999988888*DA*123456789*1234567890**01*999988888*DA*123456789*20240925~
CLP*CLM-202609-001*1*300*240*60*12*CLM-202609-001*11*1~
CAS*CO*42*60~
LX*2~
CLP*CLM-202609-002*4*200*0*200*12*CLM-202609-002*11*1~
CAS*CO*197*200~
LX*3~
CLP*CLM-202609-003*2*150*100*0*12*CLM-202609-003*11*1~
CAS*CO*42*50~
LX*4~
CLP*CLM-202609-004*1*400*400*0*12*CLM-202609-004*11*1~
LX*5~
CLP*CLM-202609-005*1*250*200*50*12*CLM-202609-005*11*1~
CAS*PR*2*50~
SE*30*0001~
GE*1*1~
IEA*1*000000001~`
                          const parsed = parse835(txt)
                          const { matched, unmatched } = matchEraLines(parsed.lines, claims)
                          setEraPreview({ fileName:'835-full.txt (fixture)', text: txt, parsed, matched, unmatched })
                        }}>Load demo fixture (5 lines)</button>
                      </div>
                    </>
                  ) : (
                    <div data-testid="pc-era-preview">
                      <h4>Preview — {eraPreview.fileName}</h4>
                      <div style={{ fontSize:12, color:'var(--muted)' }}>{eraPreview.parsed.lines.length} lines · {eraPreview.matched.length} matched (green) · {eraPreview.unmatched.length} unmatched (amber) {eraPreview.parsed.errors.length?`· ${eraPreview.parsed.errors.length} parser errors`:''}</div>
                      {eraPreview.parsed.errors.length>0 && <div style={{ color:'#b91c1c', fontSize:12, marginTop:4 }}>{eraPreview.parsed.errors.join('; ')}</div>}
                      <div className="tablewrap" style={{ marginTop:12, maxHeight:260, overflow:'auto' }}>
                        <table className="table">
                          <thead><tr><th>Claim #</th><th>Status</th><th>Charged</th><th>Paid</th><th>Pt Resp</th><th>CARC</th><th>Match</th></tr></thead>
                          <tbody>
                            {eraPreview.parsed.lines.map((l,i)=>{
                              const isMatched = eraPreview.matched.some((m)=>m.era.claimNo===l.claimNo)
                              return (
                                <tr key={i} data-testid={`pc-era-prev-line-${i}`} style={{ background: isMatched?'#f0fdf4':'#fefce8' }}>
                                  <td>{l.claimNo}</td><td>{l.status}</td><td>{money(l.charges)}</td><td>{money(l.paid)}</td><td>{money(l.patientResp||0)}</td><td>{(l.adjustments||[]).map((a)=>`${a.group}-${a.reason}`).join(', ')||'—'}</td><td>{isMatched?'Matched':'Unmatched'}</td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                      <div style={{ display:'flex', gap:8, marginTop:12, justifyContent:'flex-end' }}>
                        <button className="btn btn-sm" data-testid="pc-era-park" onClick={parkEra}>Park</button>
                        <button className="btn btn-sm btn-primary" data-testid="pc-era-post" onClick={postEra}>Post {eraPreview.matched.length} lines</button>
                        <button className="btn btn-sm" onClick={()=>setEraPreview(null)}>Back</button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
            <div style={{ padding:'0 16px 16px', fontSize:11, color:'var(--muted)' }}>Please remember to save your changes</div>
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

  const payers = useMemo(()=> [...new Set(Object.values(claims).map((c)=>c.payer))], [claims])
  const openClaims = useMemo(()=> Object.values(claims).filter((c)=>{
    if (payer && c.payer!==payer) return false
    return ['submitted','partially_paid','processing','draft'].includes(c.status)
  }), [claims, payer])

  const selectedClaim = claimId ? claims[claimId] : null
  const due = selectedClaim ? dueOf(selectedClaim) : null

  const handleSave = () => {
    if (!claimId) { toast({ message:'Select a claim', kind:'warn' }); return }
    if (!ref.trim()) { toast({ message:'Reference # required', kind:'warn' }); return }
    const amt = parseFloat(amount)||0
    if (amt<=0) { toast({ message:'Amount must be > 0', kind:'warn' }); return }
    if (due!=null && amt > due+0.01) {
      toast({ message:`Overpay warning — due ${money(due)}, entered ${money(amt)} — excess will be patient credit`, kind:'warn' })
    }
    const r = actions.postPayment(claimId, { amount: amt, adj: parseFloat(adj)||0, patientResp: parseFloat(ptResp)||0, checkNo: ref, kind: type, date, reconciled, note, source: null })
    toast({ message: r.msg, kind: r.ok?'ok':'warn' })
    if (r.ok) onClose()
  }

  return (
    <div data-testid="pc-manual-form">
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
        <label>Payment Source (Payer)*<select className="input" data-testid="pc-manual-payer" value={payer} onChange={(e)=>{ setPayer(e.target.value); setClaimId('') }}><option value="">Select payer…</option>{payers.map((p)=><option key={p} value={p}>{p}</option>)}</select></label>
        <label>Claim*<select className="input" data-testid="pc-manual-claim" value={claimId} onChange={(e)=>setClaimId(e.target.value)}><option value="">Select claim…</option>{openClaims.map((c)=>{ const cl=clients.find((x)=>x.id===c.clientId); return <option key={c.id} value={c.id}>{c.no} — {cl?.name||c.clientId} — {money(dueOf(c))} due</option>})}</select></label>
        <label>Payment Date*<input className="input" type="date" data-testid="pc-manual-date" value={date} onChange={(e)=>setDate(e.target.value)} /></label>
        <label>Payment Type<select className="input" data-testid="pc-manual-type" value={type} onChange={(e)=>setType(e.target.value)}><option value="check">Check</option><option value="credit">Credit</option><option value="debit">Debit</option><option value="cash">Cash</option><option value="ach">ACH</option><option value="eob">EOB</option><option value="writeoff">Write-off</option></select></label>
        <label>Reference #*<input className="input" data-testid="pc-manual-ref" value={ref} onChange={(e)=>setRef(e.target.value)} placeholder="CHK-1042" /></label>
        <label>Amount*<input className="input" data-testid="pc-manual-amount" type="number" step="0.01" value={amount} onChange={(e)=>setAmount(e.target.value)} placeholder={due!=null?`Due ${due}`:''} /></label>
        <label>Adjustment (contractual)<input className="input" data-testid="pc-manual-adj" type="number" step="0.01" value={adj} onChange={(e)=>setAdj(e.target.value)} placeholder="0.00" /></label>
        <label>Patient Resp<input className="input" data-testid="pc-manual-ptresp" type="number" step="0.01" value={ptResp} onChange={(e)=>setPtResp(e.target.value)} placeholder="0.00" /></label>
        <label style={{ gridColumn:'1 / -1' }}>Note<input className="input" value={note} onChange={(e)=>setNote(e.target.value)} placeholder="Optional note" /></label>
        <label style={{ display:'flex', gap:8, alignItems:'center' }}><input type="checkbox" data-testid="pc-manual-reconciled" checked={reconciled} onChange={(e)=>setReconciled(e.target.checked)} /> Payment Reconciled</label>
        {selectedClaim && <div style={{ fontSize:12, color:'var(--muted)' }}>Open due: {money(due)} · Charges {money(selectedClaim.charges)} · Paid {money(selectedClaim.paid||0)} · Adj {money(selectedClaim.adj||0)}</div>}
      </div>
      <div style={{ display:'flex', gap:8, justifyContent:'flex-end', marginTop:16 }}>
        <button className="btn btn-sm" onClick={onClose}>Cancel</button>
        <button className="btn btn-sm btn-primary" data-testid="pc-manual-save" onClick={handleSave}>Save Payment</button>
      </div>
    </div>
  )
}
