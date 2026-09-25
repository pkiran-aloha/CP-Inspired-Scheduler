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
  const [format, setFormat] = useState('parental')
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
    setPayerId(''); setFormat('parental'); setFrom(range.days[0]); setTo(range.days[range.days.length - 1]); setClientIds([]); setApptState('all'); setDocFormat('pdf')
    toast({ message: 'Form cleared', kind: 'info' })
  }

  const history = Object.values(verificationForms).sort((a, b) => b.createdAt - a.createdAt).slice(0, 50)
  const selectedPayer = payers.find((p) => p.id === payerId)

  return (
    <div className="sectionpage" data-testid="vf-sec">
      <SectionBar icon="clipboard" title="Verification Forms" sub={`Coverage verification + auth docs · ${from} → ${to} · ${clientIds.length} clients · ${format}`}>
        <RangePicker preset={preset} onPreset={(p) => actions.setUI({ vfPreset: p })} onSlide={(d) => actions.setUI({ anchor: isoDate(addDays(parseISO(ui.anchor), d * range.days.length)) })} label={range.label} />
        <button className="btn btn-sm" onClick={clear} data-testid="vf-clear">{Icon.x({ size: 12 })} Clear</button>
        <button className="btn btn-sm btn-primary" onClick={generate} data-testid="vf-generate">{Icon.file({ size: 12 })} Generate</button>
      </SectionBar>

      <div className="batch-strip" style={{ padding: '10px 16px', gap: 10 }}>
        <span className="rp-sumchip on"><b>{clientIds.length}</b><span>Clients</span></span>
        <span className="rp-sumchip"><b>{format}</b><span>Format</span></span>
        <span className="rp-sumchip"><b>{apptState}</b><span>State</span></span>
        <span className="muted" style={{ marginLeft: 'auto', fontSize: 11 }}>{selectedPayer ? `Payer: ${selectedPayer.name}` : 'Select payer'} · Branded PDF with letterhead + signatures</span>
      </div>

      <div style={{ padding: 16, display: 'grid', gridTemplateColumns: '400px 1fr', gap: 16, alignItems: 'start' }}>
        <div className="panel" style={{ borderRadius: 12, overflow: 'hidden', boxShadow: 'var(--shadow-1)' }}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 8, background: 'var(--panel-2)' }}>
            <span style={{ width: 28, height: 28, borderRadius: 8, background: '#10b981', color: '#fff', display: 'grid', placeItems: 'center' }}>{Icon.clipboard({ size: 14 })}</span>
            <div><b style={{ fontSize: 13 }}>Verification Form</b><div className="muted" style={{ fontSize: 11 }}>Parental / Benefit / Prior Auth</div></div>
          </div>

          <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <label className="bil-fld" style={{ margin: 0 }}><span>{Icon.shield({ size: 11 })} Payer*</span>
              <select className="input" value={payerId} onChange={(e) => setPayerId(e.target.value)} data-testid="vf-payer">
                <option value="">Select payer…</option>
                {payers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>

            <label className="bil-fld" style={{ margin: 0 }}><span>{Icon.file({ size: 11 })} Verification Format</span>
              <select className="input" value={format} onChange={(e) => setFormat(e.target.value)} data-testid="vf-format">
                <option value="parental">Parental Verification</option>
                <option value="benefit">Benefit Verification Request</option>
                <option value="auth_request">Prior Authorization Request</option>
              </select>
              <i className="muted" style={{ fontSize: 10.5, fontStyle: 'normal' }}>
                {format === 'parental' && 'Parent attestation of sessions with signature blocks'}
                {format === 'benefit' && 'Coverage inquiry letter to payer'}
                {format === 'auth_request' && 'Includes units requested, program, auth fields'}
              </i>
            </label>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <label className="bil-fld" style={{ margin: 0 }}><span>{Icon.cal({ size: 11 })} From Date*</span><input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} data-testid="vf-from" /></label>
              <label className="bil-fld" style={{ margin: 0 }}><span>{Icon.cal({ size: 11 })} To Date*</span><input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} data-testid="vf-to" /></label>
            </div>

            <label className="bil-fld" style={{ margin: 0 }}><span>{Icon.team({ size: 11 })} Client(s)*</span>
              <select className="input" multiple value={clientIds} onChange={(e) => setClientIds([...e.target.selectedOptions].map((o) => o.value))} data-testid="vf-clients" style={{ height: 130, borderRadius: 8 }}>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <i className="muted" style={{ fontSize: 10.5 }}>{clientIds.length ? `${clientIds.length} selected → ${clientIds.length} files` : 'Select at least one'}</i>
            </label>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <label className="bil-fld" style={{ margin: 0 }}><span>{Icon.clock({ size: 11 })} Appointment State</span>
                <select className="input" value={apptState} onChange={(e) => setApptState(e.target.value)} data-testid="vf-state">
                  <option value="all">All Appointments</option>
                  <option value="completed">Completed</option>
                  <option value="scheduled">Scheduled</option>
                </select>
              </label>
              <label className="bil-fld" style={{ margin: 0 }}><span>{Icon.file({ size: 11 })} Document Format</span>
                <select className="input" value={docFormat} onChange={(e) => setDocFormat(e.target.value)} data-testid="vf-doc">
                  <option value="pdf">PDF</option>
                </select>
              </label>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="panel" style={{ borderRadius: 12, overflow: 'hidden', boxShadow: 'var(--shadow-1)' }}>
            <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 8, background: 'var(--panel-2)' }}>
              <span style={{ width: 24, height: 24, borderRadius: 6, background: '#6366f1', color: '#fff', display: 'grid', placeItems: 'center' }}>{Icon.rows({ size: 12 })}</span>
              <b style={{ fontSize: 12 }}>History Log — {history.length} forms</b>
              <span className="an-spacer" />
              <span className="muted" style={{ fontSize: 11 }}>{from} → {to}</span>
            </div>
            {history.length === 0 ? (
              <div className="py-empty" style={{ padding: 32, textAlign: 'center' }} data-testid="vf-empty">
                <div style={{ width: 48, height: 48, borderRadius: 12, background: 'var(--panel-2)', display: 'grid', placeItems: 'center', margin: '0 auto 12px', fontSize: 24 }}>📋</div>
                <b>No verification forms yet</b>
                <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>Generate a form to see it in the log with re-download.</div>
              </div>
            ) : (
              <div className="py-tbl" data-testid="vf-table" style={{ maxHeight: 420, overflow: 'auto' }}>
                <div className="py-thead" style={{ gridTemplateColumns: '2fr 1fr 1fr 0.6fr 1fr 0.8fr' }}><span>File</span><span>Payer</span><span>Format</span><span>Clients</span><span>Generated</span><span>Actions</span></div>
                {history.map((f) => (
                  <div className="py-trow" key={f.id} data-testid={`vf-row-${f.id}`} style={{ gridTemplateColumns: '2fr 1fr 1fr 0.6fr 1fr 0.8fr' }}>
                    <div className="py-idcell"><b style={{ fontSize: 11 }}>{f.fileName}</b></div>
                    <div className="py-cell"><span className="tag soft" style={{ fontSize: 10 }}>{f.payerId}</span></div>
                    <div className="py-cell"><span className="tag">{f.format}</span></div>
                    <div className="py-cell num"><b>{(f.clientIds || []).length}</b></div>
                    <div className="py-cell muted" style={{ fontSize: 11 }}>{new Date(f.createdAt).toLocaleDateString()}</div>
                    <div className="py-cell"><button className="btn btn-xs" data-testid={`vf-download-${f.id}`} onClick={() => download(f.fileName, f.content)}>{Icon.download({ size: 11 })} Download</button></div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="panel" style={{ borderRadius: 12, padding: 16, background: 'var(--panel-2)', border: '1px solid var(--line)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span style={{ width: 24, height: 24, borderRadius: 6, background: '#f59e0b', color: '#fff', display: 'grid', placeItems: 'center' }}>{Icon.info({ size: 12 })}</span>
              <b style={{ fontSize: 12 }}>Preview — {format}</b>
            </div>
            <div style={{ fontSize: 12, lineHeight: 1.5, color: 'var(--text-2)' }}>
              {format === 'parental' && 'Parental Verification: parent attestation of sessions/services, with signature blocks for parent + provider.'}
              {format === 'benefit' && 'Benefit Verification Request: coverage inquiry letter to payer, with payer address from payer.details.'}
              {format === 'auth_request' && 'Prior Authorization Request: includes units requested, program, auth fields.'}
            </div>
            <div style={{ marginTop: 10, padding: '8px 10px', background: 'var(--panel)', borderRadius: 8, border: '1px solid var(--line)', fontSize: 11 }}>
              <div>Selected: {clientIds.length} client(s), {from}→{to}, {apptState}</div>
              <div>Payer: {selectedPayer?.name || '—'} {selectedPayer?.street ? `· ${selectedPayer.street}` : ''}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
