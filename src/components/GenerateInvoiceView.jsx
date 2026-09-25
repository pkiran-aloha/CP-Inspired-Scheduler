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
    if (forWho === 'payer' && !payerId) {
      toast({ message: 'Select a payer for Payer invoices', kind: 'warn' })
      return
    }
    const opts = {
      for: forWho, payerId, clientIds, from, to, format, orderBy,
      descriptionAs: descAs, doc: docFormat, taxId, taxPct: Number(taxPct) || 0,
      topNotes, bottomNotes, balanceOnly, inclTime, perClient, inclScheduled,
    }
    const invoices = buildInvoices(state, opts)
    for (const inv of invoices) {
      download(inv.fileName, inv.content)
      actions.record('invoices', {
        no: inv.invNo, for: forWho, payerId,
        clientIds: inv.clientId ? [inv.clientId] : clientIds,
        from, to, format, orderBy, descriptionAs: descAs, doc: docFormat,
        taxId, taxPct: Number(taxPct) || 0, topNotes, bottomNotes,
        balanceOnly, inclTime, perClient, inclScheduled,
        total: inv.total, fileName: inv.fileName, createdAt: Date.now(),
      })
      actions.record('billedFiles', {
        fileName: inv.fileName,
        payer: forWho === 'payer' ? payerId : 'Client',
        clientCount: inv.clientId ? 1 : clientIds.length || new Set(invoices.flatMap((x) => x.claims.map((c) => c.clientId))).size,
        claimCount: inv.claims.length,
        claimIds: inv.claims.map((c) => c.id),
        date: todayISO(), sendCount: 1, content: inv.content, createdAt: Date.now(),
        format: docFormat === 'pdf' ? 'invoice_pdf' : 'invoice_csv',
      })
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
    <div className="sectionpage" data-testid="gi-sec">
      <SectionBar icon="file" title="Generate Invoice" sub={`${openClaims.length} open dues · ${from} → ${to} · INV seq ${settings.billing?.invoiceSeq || 1} · ${perClient ? 'per-client split' : 'single file'}`}>
        <RangePicker preset={preset} onPreset={(p) => actions.setUI({ invPreset: p })} onSlide={(d) => actions.setUI({ anchor: isoDate(addDays(parseISO(ui.anchor), d * range.days.length)) })} label={range.label} />
        <button className="btn btn-sm" onClick={clear} data-testid="gi-clear">{Icon.x({ size: 12 })} Clear</button>
        <button className="btn btn-sm btn-primary" data-testid="gi-generate" onClick={generate}>{Icon.file({ size: 12 })} Generate</button>
      </SectionBar>

      {prefill && (
        <div className="batch-strip" style={{ background: '#fef3c7', borderBottom: '1px solid #fde68a' }} data-testid="gi-prefill">
          <span className="tag" style={{ background: '#f59e0b', color: '#fff' }}>{Icon.spark({ size: 11 })} Prefilled from AR</span>
          <span>{prefill.clientIds?.length ? `Client ${prefill.clientIds.join(', ')}` : ''} · Balance Only {String(prefill.balanceOnly)}</span>
          <button className="btn btn-xs" onClick={() => actions.setUI({ invPrefill: null })}>Clear prefill</button>
        </div>
      )}

      <div className="batch-strip" style={{ padding: '10px 16px', gap: 12, flexWrap: 'wrap' }}>
        <span className="rp-sumchip on" style={{ background: 'var(--panel)', border: '1px solid var(--line)' }}><b>{money(total)}</b><span>Total Due</span></span>
        <span className="rp-sumchip" style={{ background: 'var(--panel)', border: '1px solid var(--line)' }}><b>{openClaims.length}</b><span>Claims</span></span>
        <span className="rp-sumchip" style={{ background: 'var(--panel)', border: '1px solid var(--line)' }}><b>{money(totalCharges)}</b><span>Charges</span></span>
        <span className="rp-sumchip" style={{ background: 'var(--panel)', border: '1px solid var(--line)' }}><b>{format}</b><span>Format</span></span>
        <span className="muted" style={{ marginLeft: 'auto', fontSize: 11 }}>INV-YYYYMM-### from seq {settings.billing?.invoiceSeq || 1} · {taxId ? `Tax ${taxPct}% with ID` : 'No tax'} · {docFormat.toUpperCase()}</span>
      </div>

      <div style={{ padding: 16, display: 'grid', gridTemplateColumns: '400px 1fr', gap: 16, alignItems: 'start' }}>
        <div className="panel" style={{ borderRadius: 12, overflow: 'hidden', boxShadow: 'var(--shadow-1)' }}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 8, background: 'var(--panel-2)' }}>
            <span style={{ width: 28, height: 28, borderRadius: 8, background: 'var(--accent)', color: '#fff', display: 'grid', placeItems: 'center' }}>{Icon.file({ size: 14 })}</span>
            <div><b style={{ fontSize: 13 }}>Invoice Form</b><div className="muted" style={{ fontSize: 11 }}>Build statements with modern options</div></div>
            <span className="an-spacer" />
            <span className="tag soft" style={{ fontSize: 10 }}>{openClaims.length} dues</span>
          </div>

          <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <div className="muted" style={{ fontSize: 11, fontWeight: 600, marginBottom: 6, letterSpacing: '.04em' }}>INVOICE FOR</div>
              <div className="viewseg" data-testid="gi-for-radio" style={{ width: 'fit-content' }}>
                <button className={forWho === 'client' ? 'on' : ''} data-testid="gi-for-client" onClick={() => setForWho('client')}>{Icon.user({ size: 12 })} Client</button>
                <button className={forWho === 'payer' ? 'on' : ''} data-testid="gi-for-payer" onClick={() => setForWho('payer')}>{Icon.shield({ size: 12 })} Payer</button>
              </div>
              <input type="radio" name="forWho" checked={forWho === 'client'} onChange={() => setForWho('client')} style={{ display: 'none' }} />
              <input type="radio" name="forWho" checked={forWho === 'payer'} onChange={() => setForWho('payer')} style={{ display: 'none' }} />
            </div>

            {forWho === 'payer' && (
              <label className="bil-fld" style={{ margin: 0 }}><span>{Icon.shield({ size: 11 })} Payer*</span>
                <select className="input" value={payerId} onChange={(e) => setPayerId(e.target.value)} data-testid="gi-payer">
                  <option value="">Select payer…</option>
                  {payers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </label>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <label className="bil-fld" style={{ margin: 0 }}><span>{Icon.file({ size: 11 })} Invoice Format</span>
                <select className="input" value={format} onChange={(e) => setFormat(e.target.value)} data-testid="gi-format">
                  <option value="standard">Standard Invoice</option>
                  <option value="statement">Statement of Account</option>
                  <option value="reminder">Payment Reminder</option>
                </select>
              </label>
              <label className="bil-fld" style={{ margin: 0 }}><span>{Icon.file({ size: 11 })} Document Format</span>
                <select className="input" value={docFormat} onChange={(e) => setDocFormat(e.target.value)} data-testid="gi-doc">
                  <option value="pdf">PDF</option>
                  <option value="csv">CSV</option>
                </select>
              </label>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <label className="bil-fld" style={{ margin: 0 }}><span>{Icon.cal({ size: 11 })} From Date*</span><input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} data-testid="gi-from" /></label>
              <label className="bil-fld" style={{ margin: 0 }}><span>{Icon.cal({ size: 11 })} To Date*</span><input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} data-testid="gi-to" /></label>
            </div>

            <label className="bil-fld" style={{ margin: 0 }}><span>{Icon.team({ size: 11 })} Client(s) (optional)</span>
              <select className="input" multiple value={clientIds} onChange={(e) => setClientIds([...e.target.selectedOptions].map((o) => o.value))} data-testid="gi-clients" style={{ height: 110, borderRadius: 8 }}>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <i className="muted" style={{ fontSize: 10.5 }}>{clientIds.length ? `${clientIds.length} selected` : 'All clients in range'}</i>
            </label>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <label className="bil-fld" style={{ margin: 0 }}><span>{Icon.rows({ size: 11 })} Order By*</span>
                <select className="input" value={orderBy} onChange={(e) => setOrderBy(e.target.value)} data-testid="gi-order">
                  <option value="date">Date</option>
                  <option value="client">Client</option>
                  <option value="payer">Payer</option>
                </select>
              </label>
              <label className="bil-fld" style={{ margin: 0 }}><span>{Icon.edit({ size: 11 })} Description as*</span>
                <select className="input" value={descAs} onChange={(e) => setDescAs(e.target.value)} data-testid="gi-desc">
                  <option value="service">Service Name</option>
                  <option value="cpt">CPT + Description</option>
                  <option value="title">Session Title</option>
                </select>
              </label>
            </div>

            <div style={{ padding: '10px 12px', background: 'var(--panel-2)', borderRadius: 8, border: '1px solid var(--line)' }}>
              <div className="muted" style={{ fontSize: 11, fontWeight: 600, marginBottom: 8 }}>TAX & NOTES</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, alignItems: 'end' }}>
                <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, cursor: 'pointer' }}><input type="checkbox" checked={taxId} onChange={(e) => setTaxId(e.target.checked)} data-testid="gi-tax-id" /> {Icon.shield({ size: 11 })} Include Tax ID</label>
                <label className="bil-fld" style={{ margin: 0 }}><span>Tax %</span><input className="input" type="number" min="0" max="100" step="0.5" value={taxPct} onChange={(e) => setTaxPct(e.target.value)} data-testid="gi-tax-pct" /></label>
              </div>
              <label className="bil-fld" style={{ margin: '10px 0 0' }}><span>Top Notes</span><textarea className="input" value={topNotes} onChange={(e) => setTopNotes(e.target.value)} data-testid="gi-top" rows={2} placeholder="Thank you for your business…" style={{ borderRadius: 8 }} /></label>
              <label className="bil-fld" style={{ margin: '10px 0 0' }}><span>Bottom Notes</span><textarea className="input" value={bottomNotes} onChange={(e) => setBottomNotes(e.target.value)} data-testid="gi-bottom" rows={2} placeholder="Payment due within 30 days…" style={{ borderRadius: 8 }} /></label>
            </div>

            <div style={{ padding: '10px 12px', background: 'var(--panel)', borderRadius: 8, border: '1px solid var(--line)' }}>
              <div className="muted" style={{ fontSize: 11, fontWeight: 600, marginBottom: 8 }}>OPTIONS</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {[
                  ['gi-balance-only', balanceOnly, setBalanceOnly, 'Balance Only', 'Hide fully paid claims'],
                  ['gi-incl-time', inclTime, setInclTime, 'Include Appointment Time', 'Adds time column to invoice'],
                  ['gi-per-client', perClient, setPerClient, 'Separated By Client', 'N files when enabled'],
                  ['gi-incl-sched', inclScheduled, setInclScheduled, 'Include Scheduled Appointments', 'Include future scheduled'],
                ].map(([tid, val, setter, label, hint]) => (
                  <label key={tid} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 12, cursor: 'pointer', padding: '6px 8px', borderRadius: 6, background: val ? 'var(--panel-2)' : 'transparent', border: `1px solid ${val ? 'var(--line)' : 'transparent'}` }}>
                    <input type="checkbox" checked={val} onChange={(e) => setter(e.target.checked)} data-testid={tid} style={{ marginTop: 2 }} />
                    <span><b>{label}</b><i style={{ display: 'block', fontSize: 10.5, color: 'var(--muted)', fontStyle: 'normal' }}>{hint}</i></span>
                  </label>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="panel" style={{ borderRadius: 12, overflow: 'hidden', boxShadow: 'var(--shadow-1)' }}>
            <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 8, background: 'var(--panel-2)' }}>
              <span style={{ width: 24, height: 24, borderRadius: 6, background: '#6366f1', color: '#fff', display: 'grid', placeItems: 'center' }}>{Icon.table({ size: 12 })}</span>
              <b style={{ fontSize: 12 }}>Preview — {openClaims.length} claims</b>
              <span className="tag soft" style={{ marginLeft: 8 }}>{money(total)} due</span>
              <span className="an-spacer" />
              <span className="muted" style={{ fontSize: 11 }}>{perClient ? 'Per-client split → N files' : 'Single file'} · {balanceOnly ? 'Paid hidden' : 'All lines'}</span>
            </div>
            <div className="tablewrap" data-testid="gi-table" style={{ maxHeight: 520, overflow: 'auto' }}>
              <table className="table" style={{ fontSize: 12 }}>
                <thead style={{ position: 'sticky', top: 0, background: 'var(--panel)', zIndex: 1 }}><tr><th>Claim #</th><th>Client</th><th>Payer</th><th>DOS</th>{inclTime && <th>Time</th>}<th>Description</th><th>Charges</th><th>Paid</th><th>Due</th><th>Status</th></tr></thead>
                <tbody>
                  {openClaims.slice(0, 100).map((c) => {
                    const cl = clients.find((x) => x.id === c.clientId)
                    return (
                      <tr key={c.id} data-testid={`gi-row-${c.id}`} style={{ opacity: balanceOnly && dueOf(c) <= 0.5 ? 0.5 : 1 }}>
                        <td><span className="ln-code">{c.no}</span></td><td>{cl?.name || c.clientId}</td><td><span className="tag soft">{c.payer}</span></td><td>{c.dosFrom}</td>
                        {inclTime && <td>{c.lines[0]?.t0 != null ? `${Math.floor(c.lines[0].t0 / 60)}:${String(c.lines[0].t0 % 60).padStart(2, '0')}` : '—'}</td>}
                        <td style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis' }}>{descAs === 'cpt' ? `${c.lines[0]?.code || ''} ${c.lines[0]?.desc || ''}` : descAs === 'title' ? c.lines[0]?.desc || '' : c.lines[0]?.desc || c.lines[0]?.code || ''}</td>
                        <td className="money">{money(c.charges)}</td><td className="money muted">{money(c.paid || 0)}</td><td className="money" style={{ fontWeight: 700 }}>{money(dueOf(c))}</td><td><span className="clm-status" style={{ fontSize: 10 }}>{c.status}</span></td>
                      </tr>
                    )
                  })}
                  {!openClaims.length && <tr><td colSpan={10}><div className="py-empty" style={{ padding: 24, textAlign: 'center' }}><div style={{ fontSize: 20 }}>📄</div><b>No dues in range</b><div className="muted" style={{ fontSize: 11 }}>Adjust filters or clear Balance Only to see all claims.</div></div></td></tr>}
                </tbody>
              </table>
            </div>
            <div className="footer" style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 14px', fontSize: 11 }}>
              <span>Showing {Math.min(openClaims.length, 100)} of {openClaims.length}</span><span>Total {money(total)} · {balanceOnly ? 'Paid lines hidden' : 'All lines'}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
