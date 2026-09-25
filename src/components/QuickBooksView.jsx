import React, { useMemo, useState } from 'react'
import { useStore } from '../state/store'
import { SectionBar, RangePicker } from './NavRail'
import { useToast } from '../ui/Toast'
import { resolveRange } from '../lib/analytics'
import { download } from '../lib/ics'
import { isoDate, addDays, parseISO, todayISO } from '../lib/date'
import { dueOf } from '../lib/claims'
import { buildQboCsv } from '../lib/billingDocs'

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
        // prefer saved rate
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
    const opts = {
      from, to, clientIds, invoiceDate, dueDate, invoiceNumberStart: Number(invoiceStart) || 4127,
    }
    const files = buildQboCsv(state, opts)
    for (const f of files) {
      download(f.fileName, f.content)
      actions.record('billedFiles', {
        fileName: f.fileName,
        payer: 'QuickBooks',
        clientCount: new Set(filteredClaims.map((c) => c.clientId)).size,
        claimCount: filteredClaims.length,
        claimIds: filteredClaims.map((c) => c.id),
        date: todayISO(),
        sendCount: 1,
        content: f.content,
        createdAt: Date.now(),
        format: 'qbo_csv',
        invoiceDate, dueDate, invoiceNumberStart: invoiceStart, nameFormat,
      })
    }
    // bump start
    const nextStart = (Number(invoiceStart) || 4127) + totalInvoices
    setInvoiceStart(nextStart)
    actions.setSettings({ billing: { ...(settings.billing || {}), qboInvoiceStart: nextStart } })
    toast({ message: `${files.length} QBO file(s) generated — ${totalRows} rows, ${totalInvoices} invoices → next start ${nextStart}`, kind: 'ok' })
  }

  const clear = () => {
    setInvoiceDate(todayISO())
    setDueDate(isoDate(addDays(parseISO(todayISO()), 30)))
    setFrom(range.days[0])
    setTo(range.days[range.days.length - 1])
    setClientIds([])
    setBalanceOnly(true)
    setInvoiceStart(settings.billing?.qboInvoiceStart || 4127)
    setNameFormat('client')
    toast({ message: 'Form cleared', kind: 'info' })
  }

  return (
    <div className="sectionpage" data-testid="qbo-sec">
      <SectionBar icon="dollar" title="QuickBooks" sub={`QBO CSV export · ${from} → ${to} · ${filteredClaims.length} claims · ${totalRows} rows → ${estimatedFiles} file(s) · header: Invoice Number,Customer,Invoice Date,Due Date,Product/Service,Qty,Unit Price,Amount,Memo,Tax Code`}>
        <RangePicker preset={preset} onPreset={(p) => actions.setUI({ qboPreset: p })} onSlide={(d) => actions.setUI({ anchor: isoDate(addDays(parseISO(ui.anchor), d * range.days.length)) })} label={range.label} />
        <button className="btn btn-sm" onClick={clear} data-testid="qbo-clear">Clear</button>
        <button className="btn btn-sm btn-primary" onClick={generate} data-testid="qbo-generate">Generate QBO</button>
      </SectionBar>

      <div style={{ padding: 16, display: 'grid', gridTemplateColumns: '400px 1fr', gap: 16 }}>
        <div className="panel" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <h4>QuickBooks Export (Screenshot 7)</h4>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <label>Invoice Date*<input className="input" type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} data-testid="qbo-inv-date" /></label>
            <label>Due Date*<input className="input" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} data-testid="qbo-due-date" /></label>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <label>From*<input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} data-testid="qbo-from" /></label>
            <label>To*<input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} data-testid="qbo-to" /></label>
          </div>

          <label>Client(s)<select className="input" multiple value={clientIds} onChange={(e) => setClientIds([...e.target.selectedOptions].map((o) => o.value))} data-testid="qbo-clients" style={{ height: 100 }}>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select></label>

          <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" checked={balanceOnly} onChange={(e) => setBalanceOnly(e.target.checked)} data-testid="qbo-balance-only" /> Balance Only</label>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <label>Invoice # Start<input className="input" type="number" value={invoiceStart} onChange={(e) => setInvoiceStart(e.target.value)} data-testid="qbo-start" /></label>
            <label>QBO Name Format<select className="input" value={nameFormat} onChange={(e) => setNameFormat(e.target.value)} data-testid="qbo-name-format">
              <option value="client">Client Name</option>
              <option value="last_first">Last, First</option>
              <option value="client_dos">Client Name + DOS</option>
            </select></label>
          </div>

          <div style={{ marginTop: 8 }}>
            <b>Unit Rates — $ editable + Save</b>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6 }}>Edit per CPT rate, Save persists to settings.billing.qboRates. QBO uses rate for Unit Price.</div>
            <div className="tablewrap" data-testid="qbo-rates-table" style={{ maxHeight: 240, overflow: 'auto' }}>
              <table className="table">
                <thead><tr><th>Code</th><th>Description</th><th>Units</th><th>Rate $</th></tr></thead>
                <tbody>
                  {uniqueCodes.map((r) => (
                    <tr key={r.code} data-testid={`qbo-rate-row-${r.code}`}>
                      <td>{r.code}</td><td style={{ maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.desc}</td><td>{r.count}</td>
                      <td><input className="input" type="number" step="0.5" value={rates[r.code] ?? r.rate} onChange={(e) => setRates((prev) => ({ ...prev, [r.code]: Number(e.target.value) }))} data-testid={`qbo-rate-${r.code}`} style={{ width: 90 }} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button className="btn btn-sm" onClick={saveRates} data-testid="qbo-save-rates" style={{ marginTop: 8 }}>Save Rates</button>
          </div>

          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8 }}>
            QBO guard: ≤1000 rows / ≤100 invoices per file → {estimatedFiles} file(s) estimated. Header matches Intuit contract, no negatives, header: Invoice Number,Customer,Invoice Date,Due Date,Product/Service,Qty,Unit Price,Amount,Memo,Tax Code
          </div>
        </div>

        <div>
          <div className="tablewrap" data-testid="qbo-table">
            <table className="table">
              <thead><tr><th>Claim #</th><th>Client</th><th>Payer</th><th>DOS</th><th>Lines</th><th>Due</th></tr></thead>
              <tbody>
                {filteredClaims.slice(0, 100).map((c) => {
                  const cl = clients.find((x) => x.id === c.clientId)
                  return <tr key={c.id} data-testid={`qbo-row-${c.id}`}><td>{c.no}</td><td>{cl?.name || c.clientId}</td><td>{c.payer}</td><td>{c.dosFrom}</td><td>{c.lines.length}</td><td>{money(dueOf(c))}</td></tr>
                })}
              </tbody>
            </table>
            <div className="footer">Showing {Math.min(filteredClaims.length, 100)} of {filteredClaims.length} · {totalRows} rows · {totalInvoices} invoices · {estimatedFiles} file(s) · Start {invoiceStart} → Next {Number(invoiceStart) + totalInvoices}</div>
          </div>
        </div>
      </div>
    </div>
  )
}
