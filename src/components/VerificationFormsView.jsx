import React, { useMemo, useState } from 'react'
import { useStore } from '../state/store'
import { SectionBar, RangePicker } from './NavRail'
import { Icon } from '../ui/Icons'
import { useToast } from '../ui/Toast'
import { resolveRange } from '../lib/analytics'
import { download } from '../lib/ics'
import { isoDate, addDays, parseISO, todayISO } from '../lib/date'
import { buildVerificationForm } from '../lib/billingDocs'
import { PersonAvatar } from '../ui/avatars'

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

  const formatMeta = {
    parental: { icon: '👨‍👩‍👧', color: '#10b981', grad: '#059669', label: 'Parental Verification', desc: 'Parent attestation of sessions with signature blocks ✍️' },
    benefit: { icon: '🏥', color: '#0ea5e9', grad: '#0284c7', label: 'Benefit Verification', desc: 'Coverage inquiry letter to payer 📨' },
    auth_request: { icon: '📝', color: '#f59e0b', grad: '#d97706', label: 'Prior Auth Request', desc: 'Includes units requested, program, auth fields 📊' },
  }
  const fm = formatMeta[format] || formatMeta.parental

  return (
    <div className="sectionpage" data-testid="vf-sec" style={{ background: 'var(--bg)' }}>
      <SectionBar icon="clipboard" title="Verification Forms" sub={`✅ Coverage verification + auth docs · ${from} → ${to} · ${clientIds.length} clients · ${format} 📋`}>
        <RangePicker preset={preset} onPreset={(p) => actions.setUI({ vfPreset: p })} onSlide={(d) => actions.setUI({ anchor: isoDate(addDays(parseISO(ui.anchor), d * range.days.length)) })} label={range.label} />
        <button className="btn btn-sm" onClick={clear} data-testid="vf-clear" style={{ borderRadius: 10 }}>{Icon.x({ size: 12 })} Clear</button>
        <button className="btn btn-sm btn-primary" onClick={generate} data-testid="vf-generate" style={{ borderRadius: 10, background: 'linear-gradient(135deg,#10b981,#059669)', border: 'none', boxShadow: '0 4px 12px #10b98140', fontWeight: 700 }}>{Icon.file({ size: 12 })} Generate Form</button>
      </SectionBar>

      <div className="batch-strip" style={{ padding: '12px 16px', gap: 10, background: 'linear-gradient(135deg,var(--panel),var(--panel-2))', borderBottom: '1px solid var(--line)' }}>
        {[
          ['Clients', String(clientIds.length), '#6366f1', '👥'],
          ['Format', format, fm.color, fm.icon],
          ['State', apptState, '#0ea5e9', '📊'],
          ['History', String(history.length), '#8b5cf6', '📚'],
        ].map(([label, val, color, ic]) => (
          <span key={label} className="rp-sumchip on" style={{ background: 'var(--panel)', border: '1px solid var(--line)', display: 'flex', gap: 8, alignItems: 'center', borderRadius: 12, padding: '8px 14px', boxShadow: 'var(--shadow-1)' }}>
            <span style={{ width: 28, height: 28, borderRadius: 8, background: color, color: '#fff', display: 'grid', placeItems: 'center', fontSize: 12 }}>{ic}</span>
            <span><b style={{ fontSize: 13 }}>{val}</b><span style={{ display: 'block', fontSize: 10, color: 'var(--muted)' }}>{label}</span></span>
          </span>
        ))}
        <span className="muted" style={{ marginLeft: 'auto', fontSize: 11, background: 'var(--panel-2)', padding: '6px 12px', borderRadius: 20, display: 'flex', alignItems: 'center', gap: 6 }}>{selectedPayer ? `🏥 Payer: ${selectedPayer.name}` : '👉 Select payer'} · Branded PDF with letterhead + signatures ✍️</span>
      </div>

      <div style={{ padding: 16, display: 'grid', gridTemplateColumns: '420px 1fr', gap: 16, alignItems: 'start' }}>
        <div className="panel" style={{ borderRadius: 16, overflow: 'hidden', boxShadow: 'var(--shadow-1)', border: '1px solid var(--line)' }}>
          <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 10, background: `linear-gradient(135deg,${fm.color}11,${fm.grad}11)` }}>
            <span style={{ width: 36, height: 36, borderRadius: 12, background: `linear-gradient(135deg,${fm.color},${fm.grad})`, color: '#fff', display: 'grid', placeItems: 'center', boxShadow: `0 4px 12px ${fm.color}40`, fontSize: 18 }}>{fm.icon}</span>
            <div><b style={{ fontSize: 14, display: 'flex', alignItems: 'center', gap: 6 }}>📋 Verification Form <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 20, background: fm.color, color: '#fff' }}>{format}</span></b><div className="muted" style={{ fontSize: 11 }}>{fm.label} · {fm.desc}</div></div>
          </div>

          <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <label className="bil-fld" style={{ margin: 0 }}><span style={{ display: 'flex', alignItems: 'center', gap: 4, fontWeight: 700 }}>🏥 Payer* {selectedPayer ? `· ${selectedPayer.name}` : ''}</span>
              <select className="input" value={payerId} onChange={(e) => setPayerId(e.target.value)} data-testid="vf-payer" style={{ borderRadius: 10, height: 42 }}>
                <option value="">Select payer… 🏥</option>
                {payers.map((p) => <option key={p.id} value={p.id}>🏥 {p.name}</option>)}
              </select>
              {selectedPayer?.street && <span style={{ fontSize: 10, color: 'var(--muted)', background: 'var(--panel-2)', padding: '3px 8px', borderRadius: 6, marginTop: 4, display: 'inline-flex' }}>📍 {selectedPayer.street}</span>}
            </label>

            <label className="bil-fld" style={{ margin: 0 }}><span style={{ display: 'flex', alignItems: 'center', gap: 4, fontWeight: 700 }}>📄 Verification Format</span>
              <select className="input" value={format} onChange={(e) => setFormat(e.target.value)} data-testid="vf-format" style={{ borderRadius: 10, height: 42 }}>
                <option value="parental">👨‍👩‍👧 Parental Verification</option>
                <option value="benefit">🏥 Benefit Verification Request</option>
                <option value="auth_request">📝 Prior Authorization Request</option>
              </select>
              <span style={{ fontSize: 11, background: `${fm.color}11`, border: `1px solid ${fm.color}30`, padding: '6px 10px', borderRadius: 8, marginTop: 6, display: 'flex', gap: 6 }}><span>{fm.icon}</span><span>{fm.desc}</span></span>
            </label>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <label className="bil-fld" style={{ margin: 0 }}><span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>📅 From Date*</span><input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} data-testid="vf-from" style={{ borderRadius: 10, height: 40 }} /></label>
              <label className="bil-fld" style={{ margin: 0 }}><span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>📅 To Date*</span><input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} data-testid="vf-to" style={{ borderRadius: 10, height: 40 }} /></label>
            </div>

            <label className="bil-fld" style={{ margin: 0 }}><span style={{ display: 'flex', alignItems: 'center', gap: 4, fontWeight: 700 }}>👥 Client(s)* {clientIds.length ? `· ${clientIds.length} selected` : ''}</span>
              <select className="input" multiple value={clientIds} onChange={(e) => setClientIds([...e.target.selectedOptions].map((o) => o.value))} data-testid="vf-clients" style={{ height: 140, borderRadius: 12 }}>
                {clients.map((c) => <option key={c.id} value={c.id}>👤 {c.name} · {c.program || 'ABA'}</option>)}
              </select>
              <span style={{ fontSize: 11, background: clientIds.length ? '#ecfdf5' : 'var(--panel-2)', border: `1px solid ${clientIds.length ? '#a7f3d0' : 'var(--line)'}`, padding: '4px 10px', borderRadius: 8, marginTop: 6, display: 'inline-flex', alignItems: 'center', gap: 4 }}>{clientIds.length ? `✅ ${clientIds.length} selected → ${clientIds.length} files` : '👉 Select at least one client'}</span>
            </label>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <label className="bil-fld" style={{ margin: 0 }}><span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>📊 Appointment State</span>
                <select className="input" value={apptState} onChange={(e) => setApptState(e.target.value)} data-testid="vf-state" style={{ borderRadius: 10, height: 40 }}>
                  <option value="all">🌐 All Appointments</option>
                  <option value="completed">✅ Completed</option>
                  <option value="scheduled">📅 Scheduled</option>
                </select>
              </label>
              <label className="bil-fld" style={{ margin: 0 }}><span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>📄 Document Format</span>
                <select className="input" value={docFormat} onChange={(e) => setDocFormat(e.target.value)} data-testid="vf-doc" style={{ borderRadius: 10, height: 40 }}>
                  <option value="pdf">📕 PDF</option>
                </select>
              </label>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="panel" style={{ borderRadius: 16, overflow: 'hidden', boxShadow: 'var(--shadow-1)', border: '1px solid var(--line)' }}>
            <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 10, background: 'linear-gradient(135deg,#6366f111,#8b5cf611)' }}>
              <span style={{ width: 32, height: 32, borderRadius: 10, background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: '#fff', display: 'grid', placeItems: 'center' }}>{Icon.rows({ size: 14 })}</span>
              <div><b style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>📚 History Log — {history.length} forms <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 20, background: '#6366f1', color: '#fff' }}>{from} → {to}</span></b><div className="muted" style={{ fontSize: 11 }}>Branded PDFs with org letterhead + signatures ✍️</div></div>
            </div>
            {history.length === 0 ? (
              <div className="py-empty" style={{ padding: 40, textAlign: 'center' }} data-testid="vf-empty">
                <div style={{ width: 72, height: 72, borderRadius: 16, background: 'linear-gradient(135deg,#6366f111,#8b5cf611)', display: 'grid', placeItems: 'center', margin: '0 auto 14px', fontSize: 32 }}>📋</div>
                <b>No verification forms yet 📭</b>
                <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>Generate a form to see it in the log with re-download. Each file is branded with your practice letterhead.</div>
                <div style={{ marginTop: 12, display: 'flex', gap: 8, justifyContent: 'center' }}>
                  <span className="tag soft" style={{ borderRadius: 20 }}>👨‍👩‍👧 Parental</span><span className="tag soft" style={{ borderRadius: 20 }}>🏥 Benefit</span><span className="tag soft" style={{ borderRadius: 20 }}>📝 Auth Request</span>
                </div>
              </div>
            ) : (
              <div className="py-tbl" data-testid="vf-table" style={{ maxHeight: 460, overflow: 'auto' }}>
                <div className="py-thead" style={{ gridTemplateColumns: '2fr 1fr 1fr 0.6fr 1fr 0.8fr', background: 'var(--panel-2)', fontSize: 11 }}><span>📄 File</span><span>🏥 Payer</span><span>📑 Format</span><span>👥 Clients</span><span>📅 Generated</span><span>⚡ Actions</span></div>
                {history.map((f) => (
                  <div className="py-trow" key={f.id} data-testid={`vf-row-${f.id}`} style={{ gridTemplateColumns: '2fr 1fr 1fr 0.6fr 1fr 0.8fr', fontSize: 11 }}>
                    <div className="py-idcell"><div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ width: 24, height: 24, borderRadius: 6, background: '#10b981', color: '#fff', display: 'grid', placeItems: 'center', fontSize: 10 }}>📄</span><b style={{ fontSize: 11 }}>{f.fileName}</b></div></div>
                    <div className="py-cell"><span className="tag soft" style={{ fontSize: 10, borderRadius: 20 }}>🏥 {f.payerId}</span></div>
                    <div className="py-cell"><span className="tag" style={{ borderRadius: 20, background: formatMeta[f.format]?.color || '#6366f1', color: '#fff', fontSize: 10 }}>{formatMeta[f.format]?.icon} {f.format}</span></div>
                    <div className="py-cell num"><b>👥 {(f.clientIds || []).length}</b></div>
                    <div className="py-cell muted" style={{ fontSize: 11 }}>📅 {new Date(f.createdAt).toLocaleDateString()}</div>
                    <div className="py-cell"><button className="btn btn-xs" data-testid={`vf-download-${f.id}`} onClick={() => download(f.fileName, f.content)} style={{ borderRadius: 8 }}>{Icon.download({ size: 11 })} Download</button></div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="panel" style={{ borderRadius: 16, padding: 18, background: `linear-gradient(135deg,${fm.color}11,${fm.grad}11)`, border: `1px solid ${fm.color}30`, boxShadow: 'var(--shadow-1)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <span style={{ width: 36, height: 36, borderRadius: 10, background: `linear-gradient(135deg,${fm.color},${fm.grad})`, color: '#fff', display: 'grid', placeItems: 'center', fontSize: 18 }}>{fm.icon}</span>
              <div><b style={{ fontSize: 13 }}>Preview — {fm.label}</b><div className="muted" style={{ fontSize: 11 }}>{fm.desc}</div></div>
            </div>
            <div style={{ fontSize: 12, lineHeight: 1.6, color: 'var(--text)', background: 'var(--panel)', padding: '12px 14px', borderRadius: 10, border: '1px solid var(--line)' }}>
              {format === 'parental' && '👨‍👩‍👧 Parental Verification: parent attestation of sessions/services, with signature blocks for parent + provider. Includes session dates, client name, and service verification checklist.'}
              {format === 'benefit' && '🏥 Benefit Verification Request: coverage inquiry letter to payer, with payer address from payer.details. Verifies eligibility, deductibles, and authorization requirements.'}
              {format === 'auth_request' && '📝 Prior Authorization Request: includes units requested, program, auth fields, medical necessity, and plan of care summary.'}
            </div>
            <div style={{ marginTop: 12, padding: '10px 14px', background: 'var(--panel)', borderRadius: 10, border: '1px solid var(--line)', fontSize: 11, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>👥 Selected: <b>{clientIds.length} client(s)</b>, 📅 {from} → {to}, 📊 {apptState}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>🏥 Payer: <b>{selectedPayer?.name || '—'}</b> {selectedPayer?.street ? `· 📍 ${selectedPayer.street}` : ''}</div>
              <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                {clientIds.slice(0, 3).map((cid) => {
                  const cl = clients.find((x) => x.id === cid)
                  return <span key={cid} style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'var(--panel-2)', padding: '2px 8px', borderRadius: 20, fontSize: 10 }}><PersonAvatar p={cl} size={16} />{cl?.name}</span>
                })}
                {clientIds.length > 3 && <span style={{ fontSize: 10, background: '#6366f1', color: '#fff', padding: '2px 8px', borderRadius: 20 }}>+{clientIds.length - 3} more</span>}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
