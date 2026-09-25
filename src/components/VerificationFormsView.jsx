import React, { useMemo, useState } from 'react'
import { useStore } from '../state/store'
import { SectionBar, RangePicker } from './NavRail'
import { Icon } from '../ui/Icons'
import { useToast } from '../ui/Toast'
import { resolveRange } from '../lib/analytics'
import { download } from '../lib/ics'
import { isoDate, addDays, parseISO, todayISO } from '../lib/date'
import { buildVerificationForm } from '../lib/billingDocs'

export default function VerificationFormsView() {
  const state = useStore()
  const { ui, actions, settings, clients, payers } = state
  const toast = useToast()
  const preset = ui.vfPreset || 'last4'
  const range = useMemo(() => resolveRange(preset, ui.anchor, settings.weekStart), [preset, ui.anchor, settings.weekStart])

  const [payerId, setPayerId] = useState('')
  const [format, setFormat] = useState('parental') // parental | benefit | auth_request
  const [from, setFrom] = useState(range.days[0])
  const [to, setTo] = useState(range.days[range.days.length - 1])
  const [clientIds, setClientIds] = useState([])
  const [apptState, setApptState] = useState('all')
  const [docFormat, setDocFormat] = useState('pdf')

  const verificationForms = state.verificationForms || {}

  const generate = () => {
    if (!payerId) { toast({ message: 'Select a payer', kind: 'warn' }); return }
    if (!clientIds.length) { toast({ message: 'Select at least one client', kind: 'warn' }); return }
    const opts = { payerId, format, from, to, clientIds, apptState, doc: docFormat }
    const forms = buildVerificationForm(state, opts)
    for (const f of forms) {
      download(f.fileName, f.content)
      actions.record('verificationForms', { payerId, format, from, to, clientIds: [f.clientId], apptState, doc: docFormat, fileName: f.fileName, content: f.content, createdAt: Date.now() })
      actions.record('billedFiles', { fileName: f.fileName, payer: f.payer, clientCount: 1, claimCount: f.appts.length, claimIds: [], date: todayISO(), sendCount: 1, content: f.content, createdAt: Date.now(), format: 'verification' })
    }
    toast({ message: `${forms.length} verification form(s) generated — ${format} · ${from}→${to}`, kind: 'ok' })
  }

  const clear = () => {
    setPayerId('')
    setFormat('parental')
    setFrom(range.days[0])
    setTo(range.days[range.days.length - 1])
    setClientIds([])
    setApptState('all')
    setDocFormat('pdf')
    toast({ message: 'Form cleared', kind: 'info' })
  }

  const history = Object.values(verificationForms).sort((a,b)=>b.createdAt-a.createdAt).slice(0,50)

  return (
    <div className="sectionpage" data-testid="vf-sec">
      <SectionBar icon="clipboard" title="Verification Forms" sub={`Coverage verification + auth docs · ${from} → ${to}`}>
        <RangePicker preset={preset} onPreset={(p)=>actions.setUI({ vfPreset: p })} onSlide={(d)=>actions.setUI({ anchor: isoDate(addDays(parseISO(ui.anchor), d*range.days.length)) })} label={range.label} />
        <button className="btn btn-sm" onClick={clear} data-testid="vf-clear">Clear</button>
        <button className="btn btn-sm btn-primary" onClick={generate} data-testid="vf-generate">Generate</button>
      </SectionBar>

      <div style={{ padding:16, display:'grid', gridTemplateColumns:'380px 1fr', gap:16 }}>
        <div className="panel" style={{ display:'flex', flexDirection:'column', gap:12 }}>
          <h4>Verification Form (Screenshot 8)</h4>
          <label>Payer*<select className="input" value={payerId} onChange={(e)=>setPayerId(e.target.value)} data-testid="vf-payer">
            <option value="">Select payer…</option>
            {payers.map((p)=><option key={p.id} value={p.id}>{p.name}</option>)}
          </select></label>

          <label>Verification Format<select className="input" value={format} onChange={(e)=>setFormat(e.target.value)} data-testid="vf-format">
            <option value="parental">Parental Verification</option>
            <option value="benefit">Benefit Verification Request</option>
            <option value="auth_request">Prior Authorization Request</option>
          </select></label>

          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
            <label>From Date*<input className="input" type="date" value={from} onChange={(e)=>setFrom(e.target.value)} data-testid="vf-from" /></label>
            <label>To Date*<input className="input" type="date" value={to} onChange={(e)=>setTo(e.target.value)} data-testid="vf-to" /></label>
          </div>

          <label>Client(s)*<select className="input" multiple value={clientIds} onChange={(e)=>setClientIds([...e.target.selectedOptions].map((o)=>o.value))} data-testid="vf-clients" style={{ height:120 }}>
            {clients.map((c)=><option key={c.id} value={c.id}>{c.name}</option>)}
          </select></label>

          <label>Appointment State<select className="input" value={apptState} onChange={(e)=>setApptState(e.target.value)} data-testid="vf-state">
            <option value="all">All Appointments</option>
            <option value="completed">Completed</option>
            <option value="scheduled">Scheduled</option>
          </select></label>

          <label>Document Format<select className="input" value={docFormat} onChange={(e)=>setDocFormat(e.target.value)} data-testid="vf-doc">
            <option value="pdf">PDF</option>
          </select></label>

          <div style={{ fontSize:11, color:'var(--muted)', marginTop:8 }}>
            Branded PDF uses payer letterhead from payer.details + practice header + confidentiality footer. Parental includes signature blocks, Benefit is coverage inquiry, Auth Request includes units + program.
          </div>
        </div>

        <div>
          <h4>History Log</h4>
          {history.length===0 ? (
            <div className="empty" data-testid="vf-empty">
              <div style={{ fontSize:28 }}>📋</div>
              <b>No verification forms yet</b>
              <span>Generate a form to see it in the log with re-download.</span>
            </div>
          ) : (
            <div className="tablewrap" data-testid="vf-table">
              <table className="table">
                <thead><tr><th>File</th><th>Payer</th><th>Format</th><th>Clients</th><th>Generated</th><th>Actions</th></tr></thead>
                <tbody>
                  {history.map((f)=>(
                    <tr key={f.id} data-testid={`vf-row-${f.id}`}>
                      <td>{f.fileName}</td><td>{f.payerId}</td><td>{f.format}</td><td>{(f.clientIds||[]).length}</td><td>{new Date(f.createdAt).toLocaleDateString()}</td>
                      <td><button className="btn btn-xs" data-testid={`vf-download-${f.id}`} onClick={()=>download(f.fileName, f.content)}>Download</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div style={{ marginTop:16, padding:12, border:'1px solid var(--line)', borderRadius:8, background:'var(--panel-2)' }}>
            <b>Preview</b>
            <div style={{ fontSize:12, color:'var(--muted)', marginTop:4 }}>
              {format === 'parental' && 'Parental Verification: parent attestation of sessions/services, with signature blocks for parent + provider.'}
              {format === 'benefit' && 'Benefit Verification Request: coverage inquiry letter to payer, with payer address from payer.details.'}
              {format === 'auth_request' && 'Prior Authorization Request: includes units requested, program, auth fields.'}
            </div>
            <div style={{ marginTop:8, fontSize:12 }}>
              Selected: {clientIds.length} client(s), {from}→{to}, {apptState}, payer {payers.find((p)=>p.id===payerId)?.name||payerId||'—'}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
