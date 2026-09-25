import React, { useMemo, useState } from 'react'
import { useStore } from '../state/store'
import { SectionBar, RangePicker } from './NavRail'
import { Icon } from '../ui/Icons'
import { useToast } from '../ui/Toast'
import { resolveRange } from '../lib/analytics'
import { download } from '../lib/ics'
import { isoDate, addDays, parseISO, todayISO } from '../lib/date'
import { dueOf } from '../lib/claims'

const money = (n) => `$${(Math.round(n * 100) / 100).toLocaleString(undefined, { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`

export default function GenerateInvoiceView() {
  const state = useStore()
  const { ui, actions, settings, claims, clients } = state
  const toast = useToast()
  const preset = ui.invPreset || 'last4'
  const range = useMemo(() => resolveRange(preset, ui.anchor, settings.weekStart), [preset, ui.anchor, settings.weekStart])

  const prefill = ui.invPrefill || null

  const [clientIds, setClientIds] = useState(prefill?.clientIds || [])
  const [balanceOnly, setBalanceOnly] = useState(prefill?.balanceOnly ?? true)
  const [from, setFrom] = useState(prefill?.from || range.days[0])
  const [to, setTo] = useState(prefill?.to || range.days[range.days.length-1])
  const [format, setFormat] = useState('standard')
  const [orderBy, setOrderBy] = useState('date')
  const [descAs, setDescAs] = useState('service')
  const [docFormat, setDocFormat] = useState('pdf')

  const openClaims = useMemo(() => {
    return Object.values(claims).filter((c)=>{
      if (clientIds.length && !clientIds.includes(c.clientId)) return false
      if (c.dosFrom < from || c.dosFrom > to) return false
      const due = dueOf(c)
      if (balanceOnly && due <= 0.5) return false
      return true
    }).sort((a,b)=> a.dosFrom < b.dosFrom ? -1 : 1)
  }, [claims, clientIds, from, to, balanceOnly])

  const total = openClaims.reduce((s,c)=> s + dueOf(c), 0)

  const generate = () => {
    const invNo = `${settings.billing?.invoicePrefix||'INV'}-${new Date().toISOString().slice(0,7).replace('-','')}-${String((settings.billing?.invoiceSeq||1)).padStart(3,'0')}`
    const rows = [
      `# ${settings.org?.name||'Practice'} — Invoice ${invNo} · ${from} → ${to} · ${balanceOnly?'Balance Only':''}`,
      'claim,client,payer,dos_from,dos_to,charges,paid,adj,due,status',
      ...openClaims.map((c)=>{
        const cl = clients.find((x)=>x.id===c.clientId)
        return `${c.no},"${cl?.name||''}",${c.payer},${c.dosFrom},${c.dosTo},${c.charges},${c.paid||0},${c.adj||0},${dueOf(c)},${c.status}`
      }),
      `TOTAL,,,,,,,"${total.toFixed(2)}"`,
    ]
    const fileName = `${invNo}.csv`
    download(fileName, rows.join('\n'))
    actions.record('invoices', { no: invNo, clientIds, from, to, balanceOnly, total, fileName, createdAt: Date.now(), format, orderBy, descAs })
    actions.setSettings({ billing: { ...(settings.billing||{}), invoiceSeq: (settings.billing?.invoiceSeq||1)+1 } })
    toast({ message: `Invoice ${invNo} generated — ${openClaims.length} claims, ${money(total)}`, kind: 'ok' })
  }

  return (
    <div className="sectionpage" data-testid="gi-sec">
      <SectionBar icon="file" title="Generate Invoice" sub={`Statements · ${from} → ${to} · ${openClaims.length} open dues`}>
        <RangePicker preset={preset} onPreset={(p)=>actions.setUI({ invPreset: p })} onSlide={(d)=>actions.setUI({ anchor: isoDate(addDays(parseISO(ui.anchor), d*range.days.length)) })} label={range.label} />
        <button className="btn btn-sm btn-primary" data-testid="gi-generate" onClick={generate}>Generate</button>
      </SectionBar>

      {prefill && (
        <div style={{ padding:'8px 16px', background:'#fef3c7', fontSize:12 }} data-testid="gi-prefill">Prefilled from AR Manager — Client {prefill.clientIds?.join(', ')} · Balance Only {String(prefill.balanceOnly)} · <button className="btn btn-xs" onClick={()=>actions.setUI({ invPrefill: null })}>Clear</button></div>
      )}

      <div style={{ padding:16, display:'grid', gridTemplateColumns:'320px 1fr', gap:16 }}>
        <div className="panel">
          <h4>Invoice Options</h4>
          <label>From<input className="input" type="date" value={from} onChange={(e)=>setFrom(e.target.value)} data-testid="gi-from" /></label>
          <label>To<input className="input" type="date" value={to} onChange={(e)=>setTo(e.target.value)} data-testid="gi-to" /></label>
          <label>Client(s)<select className="input" multiple value={clientIds} onChange={(e)=>setClientIds([...e.target.selectedOptions].map((o)=>o.value))} data-testid="gi-clients" style={{ height:100 }}>
            {clients.map((c)=><option key={c.id} value={c.id}>{c.name}</option>)}
          </select></label>
          <label>Format<select className="input" value={format} onChange={(e)=>setFormat(e.target.value)} data-testid="gi-format"><option value="standard">Standard Invoice</option><option value="statement">Statement of Account</option><option value="reminder">Payment Reminder</option></select></label>
          <label>Order By<select className="input" value={orderBy} onChange={(e)=>setOrderBy(e.target.value)} data-testid="gi-order"><option value="date">Date</option><option value="client">Client</option><option value="payer">Payer</option></select></label>
          <label>Description as<select className="input" value={descAs} onChange={(e)=>setDescAs(e.target.value)} data-testid="gi-desc"><option value="service">Service Name</option><option value="cpt">CPT + Description</option><option value="title">Session Title</option></select></label>
          <label>Document Format<select className="input" value={docFormat} onChange={(e)=>setDocFormat(e.target.value)} data-testid="gi-doc"><option value="pdf">PDF</option><option value="csv">CSV</option></select></label>
          <div style={{ marginTop:12, display:'flex', flexDirection:'column', gap:6 }}>
            <label style={{ display:'flex', gap:8 }}><input type="checkbox" checked={balanceOnly} onChange={(e)=>setBalanceOnly(e.target.checked)} data-testid="gi-balance-only" /> Balance Only</label>
            <label style={{ display:'flex', gap:8 }}><input type="checkbox" defaultChecked={false} data-testid="gi-incl-time" /> Include Appointment Time</label>
            <label style={{ display:'flex', gap:8 }}><input type="checkbox" defaultChecked={false} data-testid="gi-per-client" /> Separated By Client</label>
            <label style={{ display:'flex', gap:8 }}><input type="checkbox" defaultChecked={false} data-testid="gi-incl-sched" /> Include Scheduled Appointments</label>
          </div>
          <div style={{ marginTop:12, fontSize:12, color:'var(--muted)' }}>Total open: {money(total)} · {openClaims.length} claims</div>
        </div>

        <div className="tablewrap" data-testid="gi-table">
          <table className="table">
            <thead><tr><th>Claim #</th><th>Client</th><th>Payer</th><th>DOS</th><th>Charges</th><th>Paid</th><th>Due</th><th>Status</th></tr></thead>
            <tbody>
              {openClaims.slice(0,100).map((c)=>{
                const cl = clients.find((x)=>x.id===c.clientId)
                return <tr key={c.id} data-testid={`gi-row-${c.id}`}><td>{c.no}</td><td>{cl?.name||c.clientId}</td><td>{c.payer}</td><td>{c.dosFrom}</td><td>{money(c.charges)}</td><td>{money(c.paid||0)}</td><td>{money(dueOf(c))}</td><td>{c.status}</td></tr>
              })}
            </tbody>
          </table>
          <div className="footer">Showing {Math.min(openClaims.length,100)} of {openClaims.length} · Total {money(total)}</div>
        </div>
      </div>
    </div>
  )
}
