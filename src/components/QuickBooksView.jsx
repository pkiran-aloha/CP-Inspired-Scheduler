import React, { useMemo, useState } from 'react'
import { useStore } from '../state/store'
import { SectionBar, RangePicker } from './NavRail'
import { Icon } from '../ui/Icons'
import { useToast } from '../ui/Toast'
import { resolveRange } from '../lib/analytics'
import { download } from '../lib/ics'
import { isoDate, addDays, parseISO, todayISO } from '../lib/date'
import { dueOf } from '../lib/claims'
import { buildQboCsv } from '../lib/billingDocs'
import { PersonAvatar } from '../ui/avatars'

const money = (n) => `$${(Math.round(n * 100) / 100).toLocaleString(undefined, { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`

export default function QuickBooksView() {
  const state = useStore()
  const { ui, actions, settings, claims, clients } = state
  const toast = useToast()
  const preset = ui.qboPreset || 'last4'
  const range = useMemo(() => resolveRange(preset, ui.anchor, settings.weekStart), [preset, ui.anchor, settings.weekStart])

  const [invoiceDate, setInvoiceDate] = useState(todayISO())
  const [dueDate, setDueDate] = useState(isoDate(addDays(parseISO(todayISO()), 30)))
  const [from, setFrom] = useState(range.days[0])
  const [to, setTo] = useState(range.days[range.days.length - 1])
  const [clientIds, setClientIds] = useState([])
  const [balanceOnly, setBalanceOnly] = useState(true)
  const [invoiceStart, setInvoiceStart] = useState(settings.billing?.qboInvoiceStart || 4127)
  const [nameFormat, setNameFormat] = useState(settings.billing?.qboNameFormat || 'client')
  const [rates, setRates] = useState(settings.billing?.qboRates || {})

  const filteredClaims = useMemo(() => {
    return Object.values(claims).filter((c) => {
      if (c.dosFrom < from || c.dosFrom > to) return false
      if (clientIds.length && !clientIds.includes(c.clientId)) return false
      const due = dueOf(c)
      if (balanceOnly && due <= 0.5) return false
      return true
    })
  }, [claims, from, to, clientIds, balanceOnly])

  const uniqueCodes = useMemo(() => {
    const map = {}
    for (const c of filteredClaims) {
      for (const l of c.lines) {
        if (!map[l.code]) map[l.code] = { code: l.code, desc: l.desc || '', rate: l.rate, count: 0 }
        map[l.code].count += l.units
        if (rates[l.code] != null) map[l.code].rate = rates[l.code]
      }
    }
    return Object.values(map).sort((a, b) => a.code.localeCompare(b.code))
  }, [filteredClaims, rates])

  const totalRows = filteredClaims.reduce((s, c) => s + c.lines.length, 0)
  const totalInvoices = new Set(filteredClaims.map((c) => c.clientId)).size
  const estimatedFiles = Math.max(1, Math.ceil(totalRows / 1000), Math.ceil(totalInvoices / 100))

  const saveRates = () => {
    actions.setSettings({ billing: { ...(settings.billing || {}), qboRates: rates, qboInvoiceStart: Number(invoiceStart) || 4127, qboNameFormat: nameFormat } })
    toast({ message: `QBO rates saved — ${Object.keys(rates).length} codes, start ${invoiceStart}`, kind: 'ok' })
  }

  const generate = () => {
    if (!invoiceDate || !dueDate) { toast({ message: 'Invoice Date and Due Date required', kind: 'warn' }); return }
    const opts = { from, to, clientIds, invoiceDate, dueDate, invoiceNumberStart: Number(invoiceStart) || 4127 }
    const files = buildQboCsv(state, opts)
    for (const f of files) {
      download(f.fileName, f.content)
      actions.record('billedFiles', { fileName: f.fileName, payer: 'QuickBooks', clientCount: new Set(filteredClaims.map((c) => c.clientId)).size, claimCount: filteredClaims.length, claimIds: filteredClaims.map((c) => c.id), date: todayISO(), sendCount: 1, content: f.content, createdAt: Date.now(), format: 'qbo_csv', invoiceDate, dueDate, invoiceNumberStart: invoiceStart, nameFormat })
    }
    const nextStart = (Number(invoiceStart) || 4127) + totalInvoices
    setInvoiceStart(nextStart)
    actions.setSettings({ billing: { ...(settings.billing || {}), qboInvoiceStart: nextStart } })
    toast({ message: `${files.length} QBO file(s) — ${totalRows} rows, ${totalInvoices} invoices → next ${nextStart}`, kind: 'ok' })
  }

  const clear = () => {
    setInvoiceDate(todayISO()); setDueDate(isoDate(addDays(parseISO(todayISO()), 30))); setFrom(range.days[0]); setTo(range.days[range.days.length - 1]); setClientIds([]); setBalanceOnly(true)
    setInvoiceStart(settings.billing?.qboInvoiceStart || 4127); setNameFormat('client')
    toast({ message: 'Form cleared', kind: 'info' })
  }

  return (
    <div className="sectionpage" data-testid="qbo-sec" style={{ background: 'var(--bg)' }}>
      <SectionBar icon="dollar" title="QuickBooks" sub={`💚 ${filteredClaims.length} claims · ${totalRows} rows → ${estimatedFiles} file(s) · Invoice Number,Customer,Invoice Date,Due Date,Product/Service,Qty,Unit Price,Amount,Memo,Tax Code`}>
        <RangePicker preset={preset} onPreset={(p) => actions.setUI({ qboPreset: p })} onSlide={(d) => actions.setUI({ anchor: isoDate(addDays(parseISO(ui.anchor), d * range.days.length)) })} label={range.label} />
        <button className="btn btn-sm" onClick={clear} data-testid="qbo-clear" style={{ borderRadius: 10 }}>{Icon.x({ size: 12 })} Clear</button>
        <button className="btn btn-sm btn-primary" onClick={generate} data-testid="qbo-generate" style={{ borderRadius: 10, background: 'linear-gradient(135deg,#2ca01c,#1e7a12)', border: 'none', boxShadow: '0 4px 16px #2ca01c40', fontWeight: 700 }}>📗 Generate QBO</button>
      </SectionBar>

      <div className="batch-strip" style={{ padding: '12px 16px', gap: 10, flexWrap: 'wrap', background: 'linear-gradient(135deg,#2ca01c11,#1e7a1211)', borderBottom: '1px solid #2ca01c30' }}>
        {[
          ['Rows', String(totalRows), '#2ca01c', '📊'],
          ['Invoices', String(totalInvoices), '#0ea5e9', '🧾'],
          ['Files', String(estimatedFiles), '#6366f1', '📁'],
          ['Start #', String(invoiceStart), '#f59e0b', '🔢'],
        ].map(([label, val, color, ic]) => (
          <span key={label} className="rp-sumchip on" style={{ background: 'var(--panel)', border: '1px solid var(--line)', display: 'flex', gap: 8, alignItems: 'center', borderRadius: 12, padding: '8px 14px', boxShadow: 'var(--shadow-1)' }}>
            <span style={{ width: 28, height: 28, borderRadius: 8, background: color, color: '#fff', display: 'grid', placeItems: 'center', fontSize: 12 }}>{ic}</span>
            <span><b style={{ fontSize: 13 }}>{val}</b><span style={{ display: 'block', fontSize: 10, color: 'var(--muted)' }}>{label}</span></span>
          </span>
        ))}
        <span className="muted" style={{ marginLeft: 'auto', fontSize: 11, background: 'var(--panel)', padding: '6px 12px', borderRadius: 20, border: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 6 }}>📏 ≤1000 rows / ≤100 invoices per file · 🚫 No negatives · 📅 MM/DD/YYYY · 💚 QBO Certified</span>
      </div>

      <div style={{ padding: 16, display: 'grid', gridTemplateColumns: '440px 1fr', gap: 16, alignItems: 'start' }}>
        <div className="panel" style={{ borderRadius: 16, overflow: 'hidden', boxShadow: 'var(--shadow-1)', border: '1px solid var(--line)' }}>
          <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 10, background: 'linear-gradient(135deg,#2ca01c22,#1e7a1211)' }}>
            <span style={{ width: 40, height: 40, borderRadius: 12, background: 'linear-gradient(135deg,#2ca01c,#1e7a12)', color: '#fff', display: 'grid', placeItems: 'center', boxShadow: '0 4px 12px #2ca01c40', fontSize: 18 }}>💚</span>
            <div><b style={{ fontSize: 14, display: 'flex', alignItems: 'center', gap: 6 }}>QuickBooks Export <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 20, background: '#2ca01c', color: '#fff' }}>Intuit Certified</span></b><div className="muted" style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }}>📗 QBO CSV · Invoice Number,Customer,Product/Service… · No negatives guard 🛡️</div></div>
          </div>

          <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <label className="bil-fld" style={{ margin: 0 }}><span style={{ display: 'flex', alignItems: 'center', gap: 4, fontWeight: 700 }}>📅 Invoice Date*</span><input className="input" type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} data-testid="qbo-inv-date" style={{ borderRadius: 10, height: 40 }} /></label>
              <label className="bil-fld" style={{ margin: 0 }}><span style={{ display: 'flex', alignItems: 'center', gap: 4, fontWeight: 700 }}>⏰ Due Date*</span><input className="input" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} data-testid="qbo-due-date" style={{ borderRadius: 10, height: 40 }} /></label>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <label className="bil-fld" style={{ margin: 0 }}><span>📅 From*</span><input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} data-testid="qbo-from" style={{ borderRadius: 10, height: 40 }} /></label>
              <label className="bil-fld" style={{ margin: 0 }}><span>📅 To*</span><input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} data-testid="qbo-to" style={{ borderRadius: 10, height: 40 }} /></label>
            </div>

            <label className="bil-fld" style={{ margin: 0 }}><span style={{ display: 'flex', alignItems: 'center', gap: 4, fontWeight: 700 }}>👥 Client(s) {clientIds.length ? `· ${clientIds.length} selected` : ''}</span>
              <select className="input" multiple value={clientIds} onChange={(e) => setClientIds([...e.target.selectedOptions].map((o) => o.value))} data-testid="qbo-clients" style={{ height: 120, borderRadius: 12 }}>
                {clients.map((c) => <option key={c.id} value={c.id}>👤 {c.name} · {c.insurer || 'Self-pay'}</option>)}
              </select>
              <span style={{ fontSize: 11, background: 'var(--panel-2)', padding: '4px 10px', borderRadius: 8, marginTop: 6, display: 'inline-flex', gap: 4 }}>{clientIds.length ? `✅ ${clientIds.length} clients` : '🌐 All clients'} · {filteredClaims.length} claims in view</span>
            </label>

            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', padding: '10px 12px', borderRadius: 12, background: balanceOnly ? '#ecfdf5' : 'var(--panel-2)', border: `1px solid ${balanceOnly ? '#a7f3d0' : 'var(--line)'}` }}>
              <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, cursor: 'pointer', fontWeight: 600 }}><input type="checkbox" checked={balanceOnly} onChange={(e) => setBalanceOnly(e.target.checked)} data-testid="qbo-balance-only" /> 💰 Balance Only</label>
              <span className="muted" style={{ fontSize: 11, marginLeft: 'auto' }}>{filteredClaims.length} claims · {totalRows} rows</span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <label className="bil-fld" style={{ margin: 0 }}><span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>🔢 Invoice # Start</span><input className="input" type="number" value={invoiceStart} onChange={(e) => setInvoiceStart(e.target.value)} data-testid="qbo-start" style={{ borderRadius: 10, height: 40 }} /></label>
              <label className="bil-fld" style={{ margin: 0 }}><span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>🏷️ QBO Name Format</span>
                <select className="input" value={nameFormat} onChange={(e) => setNameFormat(e.target.value)} data-testid="qbo-name-format" style={{ borderRadius: 10, height: 40 }}>
                  <option value="client">👤 Client Name</option>
                  <option value="last_first">🔤 Last, First</option>
                  <option value="client_dos">📅 Client Name + DOS</option>
                </select>
              </label>
            </div>

            <div style={{ padding: '14px', background: 'linear-gradient(135deg,var(--panel-2),var(--panel))', borderRadius: 12, border: '1px solid var(--line)', boxShadow: 'var(--shadow-1)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <b style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ width: 24, height: 24, borderRadius: 6, background: '#6366f1', color: '#fff', display: 'grid', placeItems: 'center' }}>💲</span> Unit Rates — $ editable + Save</b>
                <button className="btn btn-xs btn-primary" onClick={saveRates} data-testid="qbo-save-rates" style={{ borderRadius: 8, background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', border: 'none' }}>{Icon.check({ size: 11 })} Save Rates</button>
              </div>
              <div className="muted" style={{ fontSize: 11, marginBottom: 10, display: 'flex', gap: 6, background: 'var(--panel)', padding: '6px 10px', borderRadius: 8 }}><span>💡</span>Edit per CPT rate, Save persists to settings.billing.qboRates. QBO uses rate for Unit Price.</div>
              <div className="tablewrap" data-testid="qbo-rates-table" style={{ maxHeight: 280, overflow: 'auto', borderRadius: 10, border: '1px solid var(--line)' }}>
                <table className="table" style={{ fontSize: 11 }}>
                  <thead style={{ position: 'sticky', top: 0, background: 'var(--panel)', zIndex: 1 }}><tr><th>🔢 Code</th><th>📝 Description</th><th>📊 Units</th><th>💲 Rate $</th></tr></thead>
                  <tbody>
                    {uniqueCodes.map((r) => (
                      <tr key={r.code} data-testid={`qbo-rate-row-${r.code}`}>
                        <td><span className="ln-code" style={{ background: '#6366f122', padding: '2px 6px', borderRadius: 6 }}>🔢 {r.code}</span></td><td style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.desc}</td><td>📊 {r.count}</td>
                        <td><input className="input" type="number" step="0.5" value={rates[r.code] ?? r.rate} onChange={(e) => setRates((prev) => ({ ...prev, [r.code]: Number(e.target.value) }))} data-testid={`qbo-rate-${r.code}`} style={{ width: 90, height: 30, borderRadius: 8 }} /></td>
                      </tr>
                    ))}
                    {!uniqueCodes.length && <tr><td colSpan={4}><div className="py-empty" style={{ padding: 20, textAlign: 'center' }}><div style={{ fontSize: 24 }}>📭</div>No codes in range — adjust filters.</div></td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>

        <div className="panel" style={{ borderRadius: 16, overflow: 'hidden', boxShadow: 'var(--shadow-1)', border: '1px solid var(--line)' }}>
          <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 10, background: 'linear-gradient(135deg,#6366f111,#8b5cf611)' }}>
            <span style={{ width: 32, height: 32, borderRadius: 10, background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: '#fff', display: 'grid', placeItems: 'center' }}>{Icon.table({ size: 14 })}</span>
            <div><b style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>📊 Preview — {filteredClaims.length} claims · {totalRows} rows <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 20, background: '#2ca01c', color: '#fff' }}>QBO Ready</span></b><div className="muted" style={{ fontSize: 11 }}>Start {invoiceStart} → {Number(invoiceStart) + totalInvoices} · {estimatedFiles} file(s) · No negatives guard 🛡️</div></div>
          </div>
          <div data-testid="qbo-table" style={{ display: 'flex', flexDirection: 'column', maxHeight: 640 }}>
            <div className="tablewrap" style={{ flex: 1, overflow: 'auto' }}>
              <table className="table" style={{ fontSize: 12 }}>
                <thead style={{ position: 'sticky', top: 0, background: 'var(--panel)', zIndex: 1 }}><tr><th>🔢 Claim #</th><th>👤 Client</th><th>🏥 Payer</th><th>📅 DOS</th><th>📄 Lines</th><th>💰 Due</th></tr></thead>
                <tbody>
                  {filteredClaims.slice(0, 100).map((c) => {
                    const cl = clients.find((x) => x.id === c.clientId)
                    return <tr key={c.id} data-testid={`qbo-row-${c.id}`}><td><span className="ln-code" style={{ background: 'var(--panel-2)', padding: '2px 6px', borderRadius: 6 }}>📄 {c.no}</span></td><td><div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><PersonAvatar p={cl} size={20} />{cl?.name || c.clientId}</div></td><td><span className="tag soft" style={{ borderRadius: 20 }}>🏥 {c.payer}</span></td><td>📅 {c.dosFrom}</td><td>📄 {c.lines.length}</td><td className="money" style={{ fontWeight: 700, color: '#059669' }}>💰 {money(dueOf(c))}</td></tr>
                  })}
                  {!filteredClaims.length && <tr><td colSpan={6}><div className="py-empty" style={{ padding: 32, textAlign: 'center' }}><div style={{ width: 64, height: 64, borderRadius: 16, background: 'var(--panel-2)', display: 'grid', placeItems: 'center', margin: '0 auto 12px', fontSize: 28 }}>📭</div><b>No claims match filters</b><div className="muted" style={{ fontSize: 11 }}>Clear Balance Only or widen dates</div></div></td></tr>}
                </tbody>
              </table>
            </div>
            <div className="footer" style={{ padding: '10px 16px', fontSize: 11, display: 'flex', justifyContent: 'space-between', background: 'linear-gradient(135deg,var(--panel-2),var(--panel))', borderTop: '1px solid var(--line)' }}>
              <span>📊 Showing {Math.min(filteredClaims.length, 100)} of {filteredClaims.length}</span><span>📄 {totalRows} rows · 🧾 {totalInvoices} invoices · 📁 {estimatedFiles} file(s)</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
