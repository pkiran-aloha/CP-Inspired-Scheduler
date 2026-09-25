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

const money = (n) => `$${(Math.round(n * 100) / 100).toLocaleString(undefined, { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`

export default function GenerateInvoiceView() {
  const state = useStore()
  const { ui, actions, settings, claims, clients, payers } = state
  const toast = useToast()
  const preset = ui.invPreset || 'last4'
  const range = useMemo(() => resolveRange(preset, ui.anchor, settings.weekStart), [preset, ui.anchor, settings.weekStart])

  const prefill = ui.invPrefill || null

  const [forWho, setForWho] = useState(prefill?.for || 'client') // client | payer
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

  const generate = () => {
    if (forWho === 'payer' && !payerId) {
      toast({ message: 'Select a payer for Payer invoices', kind: 'warn' })
      return
    }
    const opts = {
      for: forWho,
      payerId,
      clientIds,
      from,
      to,
      format,
      orderBy,
      descriptionAs: descAs,
      doc: docFormat,
      taxId,
      taxPct: Number(taxPct) || 0,
      topNotes,
      bottomNotes,
      balanceOnly,
      inclTime,
      perClient,
      inclScheduled,
    }
    const invoices = buildInvoices(state, opts)
    // download each
    for (const inv of invoices) {
      download(inv.fileName, inv.content)
      actions.record('invoices', {
        no: inv.invNo,
        for: forWho,
        payerId,
        clientIds: inv.clientId ? [inv.clientId] : clientIds,
        from,
        to,
        format,
        orderBy,
        descriptionAs: descAs,
        doc: docFormat,
        taxId,
        taxPct: Number(taxPct) || 0,
        topNotes,
        bottomNotes,
        balanceOnly,
        inclTime,
        perClient,
        inclScheduled,
        total: inv.total,
        fileName: inv.fileName,
        createdAt: Date.now(),
      })
      actions.record('billedFiles', {
        fileName: inv.fileName,
        payer: forWho === 'payer' ? payerId : 'Client',
        clientCount: inv.clientId ? 1 : clientIds.length || new Set(invoices.flatMap((x) => x.claims.map((c) => c.clientId))).size,
        claimCount: inv.claims.length,
        claimIds: inv.claims.map((c) => c.id),
        date: todayISO(),
        sendCount: 1,
        content: inv.content,
        createdAt: Date.now(),
        format: docFormat === 'pdf' ? 'invoice_pdf' : 'invoice_csv',
      })
    }
    // bump seq by number of invoices generated
    const curSeq = settings.billing?.invoiceSeq || 1
    actions.setSettings({ billing: { ...(settings.billing || {}), invoiceSeq: curSeq + invoices.length } })
    toast({ message: `${invoices.length} invoice${invoices.length > 1 ? 's' : ''} generated — ${money(total)} total — numbering increments`, kind: 'ok' })
  }

  const clear = () => {
    setForWho('client')
    setPayerId('')
    setClientIds([])
    setFrom(range.days[0])
    setTo(range.days[range.days.length - 1])
    setFormat('standard')
    setOrderBy('date')
    setDescAs('service')
    setDocFormat('pdf')
    setTaxId(false)
    setTaxPct(0)
    setTopNotes('')
    setBottomNotes('')
    setBalanceOnly(true)
    setInclTime(false)
    setPerClient(false)
    setInclScheduled(false)
    actions.setUI({ invPrefill: null })
    toast({ message: 'Form cleared', kind: 'info' })
  }

  return (
    <div className="sectionpage" data-testid="gi-sec">
      <SectionBar icon="file" title="Generate Invoice" sub={`Statements · ${from} → ${to} · ${openClaims.length} open dues · INV seq ${settings.billing?.invoiceSeq || 1}`}>
        <RangePicker preset={preset} onPreset={(p) => actions.setUI({ invPreset: p })} onSlide={(d) => actions.setUI({ anchor: isoDate(addDays(parseISO(ui.anchor), d * range.days.length)) })} label={range.label} />
        <button className="btn btn-sm" onClick={clear} data-testid="gi-clear">Clear</button>
        <button className="btn btn-sm btn-primary" data-testid="gi-generate" onClick={generate}>Generate</button>
      </SectionBar>

      {prefill && (
        <div style={{ padding: '8px 16px', background: '#fef3c7', fontSize: 12 }} data-testid="gi-prefill">
          Prefilled from AR Manager — {prefill.clientIds?.length ? `Client ${prefill.clientIds.join(', ')}` : ''} · Balance Only {String(prefill.balanceOnly)} · <button className="btn btn-xs" onClick={() => actions.setUI({ invPrefill: null })}>Clear prefill</button>
        </div>
      )}

      <div style={{ padding: 16, display: 'grid', gridTemplateColumns: '380px 1fr', gap: 16 }}>
        <div className="panel" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <h4>Invoice Form (Screenshot 6)</h4>

          <div data-testid="gi-for-radio" style={{ display: 'flex', gap: 8 }}>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="radio" name="forWho" checked={forWho === 'client'} onChange={() => setForWho('client')} data-testid="gi-for-client" /> Client</label>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="radio" name="forWho" checked={forWho === 'payer'} onChange={() => setForWho('payer')} data-testid="gi-for-payer" /> Payer</label>
          </div>

          {forWho === 'payer' && (
            <label>Payer*<select className="input" value={payerId} onChange={(e) => setPayerId(e.target.value)} data-testid="gi-payer">
              <option value="">Select payer…</option>
              {payers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select></label>
          )}

          <label>Invoice Format<select className="input" value={format} onChange={(e) => setFormat(e.target.value)} data-testid="gi-format">
            <option value="standard">Standard Invoice</option>
            <option value="statement">Statement of Account</option>
            <option value="reminder">Payment Reminder</option>
          </select></label>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <label>From Date*<input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} data-testid="gi-from" /></label>
            <label>To Date*<input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} data-testid="gi-to" /></label>
          </div>

          <label>Client(s) (optional)<select className="input" multiple value={clientIds} onChange={(e) => setClientIds([...e.target.selectedOptions].map((o) => o.value))} data-testid="gi-clients" style={{ height: 100 }}>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select></label>

          <label>Order By*<select className="input" value={orderBy} onChange={(e) => setOrderBy(e.target.value)} data-testid="gi-order">
            <option value="date">Date</option>
            <option value="client">Client</option>
            <option value="payer">Payer</option>
          </select></label>

          <label>Description as*<select className="input" value={descAs} onChange={(e) => setDescAs(e.target.value)} data-testid="gi-desc">
            <option value="service">Service Name</option>
            <option value="cpt">CPT + Description</option>
            <option value="title">Session Title</option>
          </select></label>

          <label>Document Format<select className="input" value={docFormat} onChange={(e) => setDocFormat(e.target.value)} data-testid="gi-doc">
            <option value="pdf">PDF</option>
            <option value="csv">CSV</option>
          </select></label>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" checked={taxId} onChange={(e) => setTaxId(e.target.checked)} data-testid="gi-tax-id" /> Include Tax ID</label>
            <label>Tax %<input className="input" type="number" min="0" max="100" step="0.5" value={taxPct} onChange={(e) => setTaxPct(e.target.value)} data-testid="gi-tax-pct" /></label>
          </div>

          <label>Top Notes<textarea className="input" value={topNotes} onChange={(e) => setTopNotes(e.target.value)} data-testid="gi-top" rows={2} placeholder="Top notes…" /></label>
          <label>Bottom Notes<textarea className="input" value={bottomNotes} onChange={(e) => setBottomNotes(e.target.value)} data-testid="gi-bottom" rows={2} placeholder="Bottom notes…" /></label>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
            <label style={{ display: 'flex', gap: 8 }}><input type="checkbox" checked={balanceOnly} onChange={(e) => setBalanceOnly(e.target.checked)} data-testid="gi-balance-only" /> Balance Only</label>
            <label style={{ display: 'flex', gap: 8 }}><input type="checkbox" checked={inclTime} onChange={(e) => setInclTime(e.target.checked)} data-testid="gi-incl-time" /> Include Appointment Time</label>
            <label style={{ display: 'flex', gap: 8 }}><input type="checkbox" checked={perClient} onChange={(e) => setPerClient(e.target.checked)} data-testid="gi-per-client" /> Separated By Client</label>
            <label style={{ display: 'flex', gap: 8 }}><input type="checkbox" checked={inclScheduled} onChange={(e) => setInclScheduled(e.target.checked)} data-testid="gi-incl-sched" /> Include Scheduled Appointments</label>
          </div>

          <div style={{ marginTop: 12, fontSize: 12, color: 'var(--muted)' }}>Total open: {money(total)} · {openClaims.length} claims · {perClient ? 'N files when per-client' : '1 file'}</div>
        </div>

        <div>
          <div className="tablewrap" data-testid="gi-table">
            <table className="table">
              <thead><tr><th>Claim #</th><th>Client</th><th>Payer</th><th>DOS</th>{inclTime && <th>Time</th>}<th>Description</th><th>Charges</th><th>Paid</th><th>Due</th><th>Status</th></tr></thead>
              <tbody>
                {openClaims.slice(0, 100).map((c) => {
                  const cl = clients.find((x) => x.id === c.clientId)
                  return (
                    <tr key={c.id} data-testid={`gi-row-${c.id}`} style={{ opacity: balanceOnly && dueOf(c) <= 0.5 ? 0.4 : 1 }}>
                      <td>{c.no}</td><td>{cl?.name || c.clientId}</td><td>{c.payer}</td><td>{c.dosFrom}</td>
                      {inclTime && <td>{c.lines[0]?.t0 != null ? `${Math.floor(c.lines[0].t0 / 60)}:${String(c.lines[0].t0 % 60).padStart(2, '0')}` : '—'}</td>}
                      <td>{descAs === 'cpt' ? `${c.lines[0]?.code || ''} ${c.lines[0]?.desc || ''}` : descAs === 'title' ? c.lines[0]?.desc || '' : c.lines[0]?.desc || c.lines[0]?.code || ''}</td>
                      <td>{money(c.charges)}</td><td>{money(c.paid || 0)}</td><td>{money(dueOf(c))}</td><td>{c.status}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            <div className="footer">Showing {Math.min(openClaims.length, 100)} of {openClaims.length} · Total {money(total)} · {balanceOnly ? 'Paid lines hidden' : 'All lines'} · {perClient ? 'Per-client split → N files' : 'Single file'}</div>
          </div>

          <div style={{ marginTop: 12, fontSize: 11, color: 'var(--muted)' }}>
            Invoice #s increment across runs from settings.billing.invoiceSeq ({settings.billing?.invoiceSeq || 1}) · Format: {format} · Tax {taxPct}% {taxId ? 'with Tax ID' : 'no Tax ID'} · Notes top/bottom included
          </div>
        </div>
      </div>
    </div>
  )
}
