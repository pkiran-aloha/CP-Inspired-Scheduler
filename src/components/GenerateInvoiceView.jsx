import React, { useMemo, useState } from 'react'
import { useStore } from '../state/store'
import { SectionBar, RangePicker } from './NavRail'
import { Icon } from '../ui/Icons'
import { useToast } from '../ui/Toast'
import { resolveRange } from '../lib/analytics'
import { download } from '../lib/ics'
import { isoDate, addDays, parseISO, todayISO } from '../lib/date'
import { dueOf } from '../lib/claims'
import { buildInvoices } from '../lib/billingDocs'
import { PersonAvatar } from '../ui/avatars'

const money = (n) => `$${(Math.round(n * 100) / 100).toLocaleString(undefined, { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`

export default function GenerateInvoiceView() {
  const state = useStore()
  const { ui, actions, settings, claims, clients, payers } = state
  const toast = useToast()
  const preset = ui.invPreset || 'last4'
  const range = useMemo(() => resolveRange(preset, ui.anchor, settings.weekStart), [preset, ui.anchor, settings.weekStart])
  const prefill = ui.invPrefill || null

  const [forWho, setForWho] = useState(prefill?.for || 'client')
  const [payerId, setPayerId] = useState(prefill?.payerId || '')
  const [clientIds, setClientIds] = useState(prefill?.clientIds || [])
  const [from, setFrom] = useState(prefill?.from || range.days[0])
  const [to, setTo] = useState(prefill?.to || range.days[range.days.length - 1])
  const [format, setFormat] = useState(prefill?.format || 'standard')
  const [orderBy, setOrderBy] = useState('date')
  const [descAs, setDescAs] = useState('service')
  const [docFormat, setDocFormat] = useState('pdf')
  const [taxId, setTaxId] = useState(false)
  const [taxPct, setTaxPct] = useState(0)
  const [topNotes, setTopNotes] = useState('')
  const [bottomNotes, setBottomNotes] = useState('')
  const [balanceOnly, setBalanceOnly] = useState(prefill?.balanceOnly ?? true)
  const [inclTime, setInclTime] = useState(false)
  const [perClient, setPerClient] = useState(false)
  const [inclScheduled, setInclScheduled] = useState(false)

  const openClaims = useMemo(() => {
    return Object.values(claims).filter((c) => {
      if (clientIds.length && !clientIds.includes(c.clientId)) return false
      if (forWho === 'payer' && payerId) {
        const payer = payers.find((p) => p.id === payerId)
        const payerName = payer ? payer.name : payerId
        if (c.payer !== payerName && c.payer !== payerId) return false
      }
      if (c.dosFrom < from || c.dosFrom > to) return false
      const due = dueOf(c)
      if (balanceOnly && due <= 0.5) return false
      return true
    }).sort((a, b) => {
      if (orderBy === 'client') {
        const an = clients.find((x) => x.id === a.clientId)?.name || ''
        const bn = clients.find((x) => x.id === b.clientId)?.name || ''
        return an.localeCompare(bn) || a.dosFrom.localeCompare(b.dosFrom)
      }
      if (orderBy === 'payer') return a.payer.localeCompare(b.payer) || a.dosFrom.localeCompare(b.dosFrom)
      return a.dosFrom.localeCompare(b.dosFrom)
    })
  }, [claims, clientIds, from, to, balanceOnly, forWho, payerId, orderBy, clients, payers])

  const total = openClaims.reduce((s, c) => s + dueOf(c), 0)
  const totalCharges = openClaims.reduce((s, c) => s + c.charges, 0)

  const generate = () => {
    if (forWho === 'payer' && !payerId) { toast({ message: 'Select a payer for Payer invoices', kind: 'warn' }); return }
    const opts = { for: forWho, payerId, clientIds, from, to, format, orderBy, descriptionAs: descAs, doc: docFormat, taxId, taxPct: Number(taxPct) || 0, topNotes, bottomNotes, balanceOnly, inclTime, perClient, inclScheduled }
    const invoices = buildInvoices(state, opts)
    for (const inv of invoices) {
      download(inv.fileName, inv.content)
      actions.record('invoices', { no: inv.invNo, for: forWho, payerId, clientIds: inv.clientId ? [inv.clientId] : clientIds, from, to, format, orderBy, descriptionAs: descAs, doc: docFormat, taxId, taxPct: Number(taxPct) || 0, topNotes, bottomNotes, balanceOnly, inclTime, perClient, inclScheduled, total: inv.total, fileName: inv.fileName, createdAt: Date.now() })
      actions.record('billedFiles', { fileName: inv.fileName, payer: forWho === 'payer' ? payerId : 'Client', clientCount: inv.clientId ? 1 : clientIds.length || new Set(invoices.flatMap((x) => x.claims.map((c) => c.clientId))).size, claimCount: inv.claims.length, claimIds: inv.claims.map((c) => c.id), date: todayISO(), sendCount: 1, content: inv.content, createdAt: Date.now(), format: docFormat === 'pdf' ? 'invoice_pdf' : 'invoice_csv' })
    }
    const curSeq = settings.billing?.invoiceSeq || 1
    actions.setSettings({ billing: { ...(settings.billing || {}), invoiceSeq: curSeq + invoices.length } })
    toast({ message: `${invoices.length} invoice${invoices.length > 1 ? 's' : ''} generated — ${money(total)} total`, kind: 'ok' })
  }

  const clear = () => {
    setForWho('client'); setPayerId(''); setClientIds([]); setFrom(range.days[0]); setTo(range.days[range.days.length - 1])
    setFormat('standard'); setOrderBy('date'); setDescAs('service'); setDocFormat('pdf')
    setTaxId(false); setTaxPct(0); setTopNotes(''); setBottomNotes('')
    setBalanceOnly(true); setInclTime(false); setPerClient(false); setInclScheduled(false)
    actions.setUI({ invPrefill: null })
    toast({ message: 'Form cleared', kind: 'info' })
  }

  return (
    <div className="sectionpage" data-testid="gi-sec" style={{ background: 'var(--bg)' }}>
      <SectionBar icon="file" title="Generate Invoice" sub={`💳 ${openClaims.length} open dues · ${from} → ${to} · INV seq ${settings.billing?.invoiceSeq || 1} · ${perClient ? 'per-client split 📑' : 'single file'}`}>
        <RangePicker preset={preset} onPreset={(p) => actions.setUI({ invPreset: p })} onSlide={(d) => actions.setUI({ anchor: isoDate(addDays(parseISO(ui.anchor), d * range.days.length)) })} label={range.label} />
        <button className="btn btn-sm" onClick={clear} data-testid="gi-clear" style={{ borderRadius: 10 }}>{Icon.x({ size: 12 })} Clear</button>
        <button className="btn btn-sm btn-primary" data-testid="gi-generate" onClick={generate} style={{ borderRadius: 10, background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', border: 'none', boxShadow: '0 4px 16px #6366f140', fontWeight: 700 }}>{Icon.file({ size: 12 })} Generate Invoice</button>
      </SectionBar>

      {prefill && (
        <div className="batch-strip" style={{ background: 'linear-gradient(135deg,#fef3c7,#fde68a)', borderBottom: '1px solid #fcd34d', padding: '10px 16px' }} data-testid="gi-prefill">
          <span className="tag" style={{ background: 'linear-gradient(135deg,#f59e0b,#f97316)', color: '#fff', borderRadius: 20, display: 'inline-flex', alignItems: 'center', gap: 4 }}>⚡ Prefilled from AR</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>📍 {prefill.clientIds?.length ? `Client ${prefill.clientIds.join(', ')}` : ''} · Balance Only {String(prefill.balanceOnly)}</span>
          <button className="btn btn-xs" onClick={() => actions.setUI({ invPrefill: null })} style={{ borderRadius: 8, marginLeft: 'auto' }}>✕ Clear prefill</button>
        </div>
      )}

      <div className="batch-strip" style={{ padding: '12px 16px', gap: 10, flexWrap: 'wrap', background: 'linear-gradient(135deg,var(--panel),var(--panel-2))', borderBottom: '1px solid var(--line)' }}>
        {[
          ['Total Due', money(total), '#6366f1', '💰', 'total'],
          ['Claims', String(openClaims.length), '#0ea5e9', '📄', 'claims'],
          ['Charges', money(totalCharges), '#10b981', '💳', 'charges'],
          ['Format', format, '#8b5cf6', '📑', 'format'],
        ].map(([label, val, color, ic]) => (
          <span key={label} className="rp-sumchip on" style={{ background: 'var(--panel)', border: '1px solid var(--line)', display: 'flex', gap: 8, alignItems: 'center', borderRadius: 12, padding: '8px 14px', boxShadow: 'var(--shadow-1)' }}>
            <span style={{ width: 28, height: 28, borderRadius: 8, background: color, color: '#fff', display: 'grid', placeItems: 'center', fontSize: 12 }}>{ic}</span>
            <span><b style={{ fontSize: 13 }}>{val}</b><span style={{ display: 'block', fontSize: 10, color: 'var(--muted)' }}>{label}</span></span>
          </span>
        ))}
        <span className="muted" style={{ marginLeft: 'auto', fontSize: 11, background: 'var(--panel-2)', padding: '6px 12px', borderRadius: 20, display: 'flex', alignItems: 'center', gap: 6 }}>🔢 INV-YYYYMM-### seq {settings.billing?.invoiceSeq || 1} · {taxId ? `🧾 Tax ${taxPct}%` : 'No tax'} · {docFormat.toUpperCase()} 📄</span>
      </div>

      <div style={{ padding: 16, display: 'grid', gridTemplateColumns: '420px 1fr', gap: 16, alignItems: 'start' }}>
        <div className="panel" style={{ borderRadius: 16, overflow: 'hidden', boxShadow: 'var(--shadow-1)', border: '1px solid var(--line)' }}>
          <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 10, background: 'linear-gradient(135deg,#6366f111,#8b5cf611)' }}>
            <span style={{ width: 36, height: 36, borderRadius: 12, background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: '#fff', display: 'grid', placeItems: 'center', boxShadow: '0 4px 12px #6366f140' }}>{Icon.file({ size: 16 })}</span>
            <div><b style={{ fontSize: 14, display: 'flex', alignItems: 'center', gap: 6 }}>📄 Invoice Form <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 20, background: '#6366f1', color: '#fff' }}>{openClaims.length} dues</span></b><div className="muted" style={{ fontSize: 11 }}>Build statements with modern options ✨</div></div>
          </div>

          <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>
              <div className="muted" style={{ fontSize: 11, fontWeight: 700, marginBottom: 8, letterSpacing: '.06em', display: 'flex', alignItems: 'center', gap: 4 }}>👤 INVOICE FOR</div>
              <div className="viewseg" data-testid="gi-for-radio" style={{ width: 'fit-content', borderRadius: 12, padding: 3, background: 'var(--panel-2)', border: '1px solid var(--line)' }}>
                <button className={forWho === 'client' ? 'on' : ''} data-testid="gi-for-client" onClick={() => setForWho('client')} style={{ borderRadius: 8, display: 'flex', alignItems: 'center', gap: 6 }}>{Icon.user({ size: 12 })} 👤 Client</button>
                <button className={forWho === 'payer' ? 'on' : ''} data-testid="gi-for-payer" onClick={() => setForWho('payer')} style={{ borderRadius: 8, display: 'flex', alignItems: 'center', gap: 6 }}>{Icon.shield({ size: 12 })} 🏥 Payer</button>
              </div>
              <input type="radio" name="forWho" checked={forWho === 'client'} onChange={() => setForWho('client')} style={{ display: 'none' }} />
              <input type="radio" name="forWho" checked={forWho === 'payer'} onChange={() => setForWho('payer')} style={{ display: 'none' }} />
            </div>

            {forWho === 'payer' && (
              <label className="bil-fld" style={{ margin: 0 }}><span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>🏥 Payer*</span>
                <select className="input" value={payerId} onChange={(e) => setPayerId(e.target.value)} data-testid="gi-payer" style={{ borderRadius: 10, height: 40 }}>
                  <option value="">Select payer… 🏥</option>
                  {payers.map((p) => <option key={p.id} value={p.id}>🏥 {p.name}</option>)}
                </select>
              </label>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <label className="bil-fld" style={{ margin: 0 }}><span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>📑 Invoice Format</span>
                <select className="input" value={format} onChange={(e) => setFormat(e.target.value)} data-testid="gi-format" style={{ borderRadius: 10, height: 40 }}>
                  <option value="standard">📄 Standard Invoice</option>
                  <option value="statement">📊 Statement of Account</option>
                  <option value="reminder">⏰ Payment Reminder</option>
                </select>
              </label>
              <label className="bil-fld" style={{ margin: 0 }}><span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>📄 Document Format</span>
                <select className="input" value={docFormat} onChange={(e) => setDocFormat(e.target.value)} data-testid="gi-doc" style={{ borderRadius: 10, height: 40 }}>
                  <option value="pdf">📕 PDF</option>
                  <option value="csv">📗 CSV</option>
                </select>
              </label>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <label className="bil-fld" style={{ margin: 0 }}><span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>📅 From Date*</span><input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} data-testid="gi-from" style={{ borderRadius: 10, height: 40 }} /></label>
              <label className="bil-fld" style={{ margin: 0 }}><span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>📅 To Date*</span><input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} data-testid="gi-to" style={{ borderRadius: 10, height: 40 }} /></label>
            </div>

            <label className="bil-fld" style={{ margin: 0 }}><span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>👥 Client(s) (optional)</span>
              <select className="input" multiple value={clientIds} onChange={(e) => setClientIds([...e.target.selectedOptions].map((o) => o.value))} data-testid="gi-clients" style={{ height: 120, borderRadius: 12 }}>
                {clients.map((c) => <option key={c.id} value={c.id}>👤 {c.name}</option>)}
              </select>
              <i className="muted" style={{ fontSize: 11, background: 'var(--panel-2)', padding: '4px 8px', borderRadius: 6, marginTop: 4, display: 'inline-flex', alignItems: 'center', gap: 4 }}>{clientIds.length ? `✅ ${clientIds.length} selected` : '🌐 All clients in range'}</i>
            </label>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <label className="bil-fld" style={{ margin: 0 }}><span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>📊 Order By*</span>
                <select className="input" value={orderBy} onChange={(e) => setOrderBy(e.target.value)} data-testid="gi-order" style={{ borderRadius: 10, height: 40 }}>
                  <option value="date">📅 Date</option>
                  <option value="client">👤 Client</option>
                  <option value="payer">🏥 Payer</option>
                </select>
              </label>
              <label className="bil-fld" style={{ margin: 0 }}><span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>📝 Description as*</span>
                <select className="input" value={descAs} onChange={(e) => setDescAs(e.target.value)} data-testid="gi-desc" style={{ borderRadius: 10, height: 40 }}>
                  <option value="service">🧩 Service Name</option>
                  <option value="cpt">🔢 CPT + Description</option>
                  <option value="title">📝 Session Title</option>
                </select>
              </label>
            </div>

            <div style={{ padding: '14px', background: 'linear-gradient(135deg,var(--panel-2),var(--panel))', borderRadius: 12, border: '1px solid var(--line)', boxShadow: 'var(--shadow-1)' }}>
              <div className="muted" style={{ fontSize: 11, fontWeight: 700, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>🧾 TAX & NOTES</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, alignItems: 'end' }}>
                <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, cursor: 'pointer', padding: '8px 12px', borderRadius: 10, background: taxId ? '#ecfdf5' : 'var(--panel)', border: `1px solid ${taxId ? '#a7f3d0' : 'var(--line)'}` }}><input type="checkbox" checked={taxId} onChange={(e) => setTaxId(e.target.checked)} data-testid="gi-tax-id" /> 🛡️ Include Tax ID</label>
                <label className="bil-fld" style={{ margin: 0 }}><span>💲 Tax %</span><input className="input" type="number" min="0" max="100" step="0.5" value={taxPct} onChange={(e) => setTaxPct(e.target.value)} data-testid="gi-tax-pct" style={{ borderRadius: 10, height: 36 }} /></label>
              </div>
              <label className="bil-fld" style={{ margin: '12px 0 0' }}><span>📝 Top Notes</span><textarea className="input" value={topNotes} onChange={(e) => setTopNotes(e.target.value)} data-testid="gi-top" rows={2} placeholder="💬 Thank you for your business…" style={{ borderRadius: 10 }} /></label>
              <label className="bil-fld" style={{ margin: '12px 0 0' }}><span>📝 Bottom Notes</span><textarea className="input" value={bottomNotes} onChange={(e) => setBottomNotes(e.target.value)} data-testid="gi-bottom" rows={2} placeholder="⏰ Payment due within 30 days…" style={{ borderRadius: 10 }} /></label>
            </div>

            <div style={{ padding: '14px', background: 'var(--panel)', borderRadius: 12, border: '1px solid var(--line)', boxShadow: 'var(--shadow-1)' }}>
              <div className="muted" style={{ fontSize: 11, fontWeight: 700, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>⚙️ OPTIONS</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {[
                  ['gi-balance-only', balanceOnly, setBalanceOnly, '💰 Balance Only', 'Hide fully paid claims', '#10b981'],
                  ['gi-incl-time', inclTime, setInclTime, '⏰ Include Appointment Time', 'Adds time column to invoice', '#0ea5e9'],
                  ['gi-per-client', perClient, setPerClient, '👥 Separated By Client', 'N files when enabled 📑', '#6366f1'],
                  ['gi-incl-sched', inclScheduled, setInclScheduled, '📅 Include Scheduled Appointments', 'Include future scheduled', '#f59e0b'],
                ].map(([tid, val, setter, label, hint, color]) => (
                  <label key={tid} style={{ display: 'flex', gap: 12, alignItems: 'flex-start', fontSize: 12, cursor: 'pointer', padding: '10px 12px', borderRadius: 10, background: val ? `${color}11` : 'transparent', border: `1px solid ${val ? `${color}40` : 'var(--line)'}`, transition: 'all .15s' }}>
                    <input type="checkbox" checked={val} onChange={(e) => setter(e.target.checked)} data-testid={tid} style={{ marginTop: 2, accentColor: color }} />
                    <span><b style={{ display: 'flex', alignItems: 'center', gap: 4 }}>{label}</b><i style={{ display: 'block', fontSize: 10.5, color: 'var(--muted)', fontStyle: 'normal' }}>{hint}</i></span>
                    <span style={{ marginLeft: 'auto', width: 20, height: 20, borderRadius: 6, background: val ? color : 'var(--panel-2)', color: val ? '#fff' : 'var(--muted)', display: 'grid', placeItems: 'center', fontSize: 10 }}>{val ? '✓' : ''}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="panel" style={{ borderRadius: 16, overflow: 'hidden', boxShadow: 'var(--shadow-1)', border: '1px solid var(--line)' }}>
            <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 10, background: 'linear-gradient(135deg,#6366f122,#8b5cf611)' }}>
              <span style={{ width: 32, height: 32, borderRadius: 10, background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: '#fff', display: 'grid', placeItems: 'center', boxShadow: '0 4px 12px #6366f140' }}>{Icon.table({ size: 14 })}</span>
              <div><b style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>📊 Preview — {openClaims.length} claims <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 20, background: '#10b981', color: '#fff' }}>{money(total)} due</span></b><div className="muted" style={{ fontSize: 11 }}>{perClient ? '📑 Per-client split → N files' : '📄 Single file'} · {balanceOnly ? '💰 Paid hidden' : 'All lines'}</div></div>
            </div>
            <div className="tablewrap" data-testid="gi-table" style={{ maxHeight: 560, overflow: 'auto' }}>
              <table className="table" style={{ fontSize: 12 }}>
                <thead style={{ position: 'sticky', top: 0, background: 'var(--panel)', zIndex: 1 }}><tr><th>🔢 Claim #</th><th>👤 Client</th><th>🏥 Payer</th><th>📅 DOS</th>{inclTime && <th>⏰ Time</th>}<th>📝 Description</th><th>💲 Charges</th><th>💵 Paid</th><th>💰 Due</th><th>🚦 Status</th></tr></thead>
                <tbody>
                  {openClaims.slice(0, 100).map((c) => {
                    const cl = clients.find((x) => x.id === c.clientId)
                    return (
                      <tr key={c.id} data-testid={`gi-row-${c.id}`} style={{ opacity: balanceOnly && dueOf(c) <= 0.5 ? 0.5 : 1 }}>
                        <td><span className="ln-code" style={{ background: 'var(--panel-2)', padding: '2px 6px', borderRadius: 6 }}>📄 {c.no}</span></td>
                        <td><div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><PersonAvatar p={cl} size={20} />{cl?.name || c.clientId}</div></td>
                        <td><span className="tag soft" style={{ borderRadius: 20, display: 'inline-flex', alignItems: 'center', gap: 3 }}>🏥 {c.payer}</span></td>
                        <td>📅 {c.dosFrom}</td>
                        {inclTime && <td>⏰ {c.lines[0]?.t0 != null ? `${Math.floor(c.lines[0].t0 / 60)}:${String(c.lines[0].t0 % 60).padStart(2, '0')}` : '—'}</td>}
                        <td style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis' }}>{descAs === 'cpt' ? `🔢 ${c.lines[0]?.code || ''} ${c.lines[0]?.desc || ''}` : descAs === 'title' ? c.lines[0]?.desc || '' : c.lines[0]?.desc || c.lines[0]?.code || ''}</td>
                        <td className="money">{money(c.charges)}</td><td className="money muted">{money(c.paid || 0)}</td><td className="money" style={{ fontWeight: 700, color: '#059669' }}>{money(dueOf(c))}</td><td><span className="clm-status" style={{ fontSize: 10, borderRadius: 20 }}>{c.status}</span></td>
                      </tr>
                    )
                  })}
                  {!openClaims.length && <tr><td colSpan={10}><div className="py-empty" style={{ padding: 32, textAlign: 'center' }}><div style={{ width: 64, height: 64, borderRadius: 16, background: 'linear-gradient(135deg,#6366f122,#8b5cf611)', display: 'grid', placeItems: 'center', margin: '0 auto 12px', fontSize: 28 }}>📄</div><b>No dues in range 📭</b><div className="muted" style={{ fontSize: 11 }}>Adjust filters or clear Balance Only to see all claims.</div></div></td></tr>}
                </tbody>
              </table>
            </div>
            <div className="footer" style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 16px', fontSize: 11, background: 'var(--panel-2)', borderTop: '1px solid var(--line)' }}>
              <span>📊 Showing {Math.min(openClaims.length, 100)} of {openClaims.length}</span><span>💰 Total {money(total)} · {balanceOnly ? 'Paid lines hidden 🙈' : 'All lines 👀'}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
