import React, { useMemo, useState } from 'react'
import { useStore } from '../state/store'
import { SectionBar, RangePicker } from './NavRail'
import { Icon } from '../ui/Icons'
import { useToast } from '../ui/Toast'
import { resolveRange } from '../lib/analytics'
import { isoDate, addDays, parseISO, fmtDayLabel, todayISO } from '../lib/date'
import { dueOf } from '../lib/claims'
import { PersonAvatar } from '../ui/avatars'

const money = (n) => `$${(Math.round(n * 100) / 100).toLocaleString(undefined, { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`

function ManualForm({ state, onSaved }) {
  const { clients, payers, actions } = state
  const [clientId, setClientId] = useState(clients[0]?.id || '')
  const [payer, setPayer] = useState(payers[0]?.name || '')
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(todayISO())
  const [method, setMethod] = useState('check')
  const [ref, setRef] = useState('')
  const [note, setNote] = useState('')
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <label className="field"><span>Client</span><select value={clientId} onChange={(e) => setClientId(e.target.value)} data-testid="pc-man-client" style={{ fontSize: 13, borderRadius: 10, padding: '10px 12px' }}><option value="">— Select —</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label className="field"><span>Payer</span><select value={payer} onChange={(e) => setPayer(e.target.value)} data-testid="pc-man-payer" style={{ fontSize: 13, borderRadius: 10, padding: '10px 12px' }}>{payers.map((p) => <option key={p.id} value={p.name}>{p.name}</option>)}</select></label>
        <label className="field"><span>Amount</span><input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" data-testid="pc-man-amount" style={{ fontSize: 13, borderRadius: 10, padding: '10px 12px' }} /></label>
        <label className="field"><span>Date</span><input type="date" value={date} onChange={(e) => setDate(e.target.value)} data-testid="pc-man-date" style={{ fontSize: 13, borderRadius: 10, padding: '10px 12px' }} /></label>
        <label className="field"><span>Method</span><select value={method} onChange={(e) => setMethod(e.target.value)} data-testid="pc-man-method" style={{ fontSize: 13, borderRadius: 10, padding: '10px 12px' }}><option value="check">Check</option><option value="eft">EFT</option><option value="cash">Cash</option><option value="card">Card</option><option value="era">ERA</option></select></label>
        <label className="field"><span>Reference #</span><input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="CHK / EFT #" data-testid="pc-man-ref" style={{ fontSize: 13, borderRadius: 10, padding: '10px 12px' }} /></label>
      </div>
      <label className="field"><span>Note</span><textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} data-testid="pc-man-note" style={{ fontSize: 13, borderRadius: 10, padding: '10px 12px' }} /></label>
      <div style={{ display: 'flex', gap: 8 }}><button className="btn btn-sm btn-primary" data-testid="pc-man-save" onClick={() => { if (!amount || !clientId) return; actions.recordPayment({ clientId, payer, amount: Number(amount), date, method, ref, note }); onSaved(); }} style={{ borderRadius: 10 }}>Save Payment</button><button className="btn btn-sm" onClick={onSaved} style={{ borderRadius: 10 }}>Cancel</button></div>
    </div>
  )
}

function EraForm({ state, onSaved }) {
  const { claims, actions } = state
  const [fileName, setFileName] = useState('ERA-2026-03-15.835')
  const [lines, setLines] = useState([{ claimId: claims[0]?.id || '', amount: '', adj: '', status: 'paid' }])
  const addLine = () => setLines((ls) => [...ls, { claimId: claims[0]?.id || '', amount: '', adj: '', status: 'paid' }])
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <label className="field"><span>File name</span><input value={fileName} onChange={(e) => setFileName(e.target.value)} data-testid="pc-era-file" style={{ fontSize: 13, borderRadius: 10, padding: '10px 12px' }} /></label>
      {lines.map((ln, i) => (
        <div key={i} style={{ display: 'grid', gridTemplateColumns: '1.4fr 100px 100px 120px 32px', gap: 8, alignItems: 'end' }}>
          <label className="field"><span>Claim</span><select value={ln.claimId} onChange={(e) => setLines((ls) => ls.map((x, j) => j === i ? { ...x, claimId: e.target.value } : x))} data-testid={`pc-era-line-claim-${i}`} style={{ fontSize: 12, borderRadius: 10, padding: '8px 10px' }}>{claims.map((c) => <option key={c.id} value={c.id}>{c.no} — {c.clientId} — {money(dueOf(c))}</option>)}</select></label>
          <label className="field"><span>Paid</span><input type="number" value={ln.amount} onChange={(e) => setLines((ls) => ls.map((x, j) => j === i ? { ...x, amount: e.target.value } : x))} data-testid={`pc-era-line-amt-${i}`} style={{ fontSize: 12, borderRadius: 10, padding: '8px 10px' }} /></label>
          <label className="field"><span>Adj</span><input type="number" value={ln.adj} onChange={(e) => setLines((ls) => ls.map((x, j) => j === i ? { ...x, adj: e.target.value } : x))} data-testid={`pc-era-line-adj-${i}`} style={{ fontSize: 12, borderRadius: 10, padding: '8px 10px' }} /></label>
          <label className="field"><span>Status</span><select value={ln.status} onChange={(e) => setLines((ls) => ls.map((x, j) => j === i ? { ...x, status: e.target.value } : x))} data-testid={`pc-era-line-status-${i}`} style={{ fontSize: 12, borderRadius: 10, padding: '8px 10px' }}><option value="paid">Paid</option><option value="denied">Denied</option><option value="partial">Partial</option></select></label>
          <button className="btn btn-xs" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} style={{ borderRadius: 8 }}>✕</button>
        </div>
      ))}
      <div style={{ display: 'flex', gap: 8 }}><button className="btn btn-xs" onClick={addLine} style={{ borderRadius: 8 }}>+ Line</button><button className="btn btn-sm btn-primary" data-testid="pc-era-save" onClick={() => { actions.importEra({ fileName, lines: lines.filter((l) => l.claimId && l.amount).map((l) => ({ claimId: l.claimId, amount: Number(l.amount), adj: Number(l.adj || 0), status: l.status })) }); onSaved() }} style={{ borderRadius: 10, marginLeft: 'auto' }}>Post ERA</button><button className="btn btn-sm" onClick={onSaved} style={{ borderRadius: 10 }}>Cancel</button></div>
    </div>
  )
}

export default function PaymentCenterView() {
  const state = useStore()
  const { ui, actions, settings, claims, clients } = state
  const toast = useToast()
  const payments = state.payments || {}
  const preset = ui.payPreset || 'last4'
  const range = useMemo(() => resolveRange(preset, ui.anchor, settings.weekStart), [preset, ui.anchor, settings.weekStart])
  const [q, setQ] = useState('')
  const [statusF, setStatusF] = useState('all')
  const [openMan, setOpenMan] = useState(false)
  const [openEra, setOpenEra] = useState(false)

  const allPayments = useMemo(() => Object.values(payments).sort((a, b) => (b.date || '').localeCompare(a.date || '')), [payments])
  const filtered = useMemo(() => {
    let out = allPayments
    if (statusF !== 'all') out = out.filter((p) => p.kind === statusF || p.method === statusF)
    if (q.trim()) {
      const t = q.trim().toLowerCase()
      out = out.filter((p) => `${p.clientId} ${p.payer} ${p.ref || ''} ${p.note || ''}`.toLowerCase().includes(t))
    }
    return out
  }, [allPayments, statusF, q])

  const kpis = useMemo(() => {
    const last30 = allPayments.filter((p) => p.date >= range.days[0])
    const total = last30.reduce((s, p) => s + (p.amount || 0), 0)
    const check = last30.filter((p) => p.method === 'check').reduce((s, p) => s + p.amount, 0)
    const eft = last30.filter((p) => p.method === 'eft' || p.method === 'era').reduce((s, p) => s + p.amount, 0)
    const unapplied = Object.values(claims).filter((c) => (c.paid || 0) === 0).reduce((s, c) => s + dueOf(c), 0)
    return { total, check, eft, unapplied, count: last30.length }
  }, [allPayments, range, claims])

  return (
    <div className="sectionpage" data-testid="pc-sec" style={{ background: 'var(--bg)' }}>
      <SectionBar icon="dollar" title="Payment Center" sub={`${range.label} · ${kpis.count} payments · ${money(kpis.total)} · ${money(kpis.unapplied)} unapplied`}>
        <RangePicker preset={preset} onPreset={(p) => actions.setUI({ payPreset: p })} onSlide={(d) => actions.setUI({ anchor: isoDate(addDays(parseISO(ui.anchor), d * range.days.length)) })} label={range.label} />
        <div className="sb-search" style={{ minWidth: 220, borderRadius: 10 }}>
          <span className="sic">{Icon.search({ size: 12 })}</span>
          <input placeholder="Search payer, client, ref" value={q} onChange={(e) => setQ(e.target.value)} data-testid="pc-search" style={{ fontSize: 13 }} />
        </div>
        <button className="btn btn-sm btn-primary" data-testid="pc-open-man" onClick={() => setOpenMan(true)} style={{ borderRadius: 10 }}>+ Manual Payment</button>
        <button className="btn btn-sm" data-testid="pc-open-era" onClick={() => setOpenEra(true)} style={{ borderRadius: 10 }}>ERA Import</button>
      </SectionBar>

      <div className="batch-strip" data-testid="pc-kpis" style={{ margin: '16px', padding: '16px', gap: 12, flexWrap: 'wrap', background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 14 }}>
        {[
          ['Total', money(kpis.total), `${kpis.count} in range`, '#6366f1', 'pc-kpi-total'],
          ['Check', money(kpis.check), 'Paper', '#0ea5e9', 'pc-kpi-check'],
          ['EFT / ERA', money(kpis.eft), 'Electronic', '#10b981', 'pc-kpi-eft'],
          ['Unapplied', money(kpis.unapplied), 'Open claims', '#f59e0b', 'pc-kpi-unapplied'],
        ].map(([label, val, sub, color, testId]) => (
          <div key={label} className="rp-sumchip on" data-testid={testId} style={{ background: 'var(--panel)', border: '1px solid var(--line)', display: 'flex', gap: 12, alignItems: 'center', minWidth: 160, borderRadius: 12, padding: '12px 16px' }}>
            <span style={{ width: 32, height: 32, borderRadius: 9, background: `${color}14`, color, display: 'grid', placeItems: 'center' }}>{Icon.dollar({ size: 14 })}</span>
            <div><b style={{ fontSize: 18, fontWeight: 800 }}>{val}</b><span style={{ display: 'block', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--muted)' }}>{label}</span><span style={{ fontSize: 12, color: 'var(--muted)' }}>{sub}</span></div>
          </div>
        ))}
      </div>

      <div className="batch-strip" style={{ margin: '0 16px 16px', padding: '12px 16px', gap: 12, background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 12 }}>
        <div className="viewseg" style={{ borderRadius: 10, padding: 3 }} data-testid="pc-filter">
          {[
            ['all', 'All'],
            ['check', 'Check'],
            ['eft', 'EFT'],
            ['era', 'ERA'],
            ['cash', 'Cash'],
          ].map(([id, label]) => (
            <button key={id} className={statusF === id ? 'on' : ''} data-testid={`pc-filter-${id}`} onClick={() => setStatusF(id)} style={{ borderRadius: 8, fontSize: 13 }}>{label}</button>
          ))}
        </div>
        <span className="muted" style={{ fontSize: 12, marginLeft: 8 }}>{filtered.length} payments</span>
      </div>

      <div style={{ padding: '0 16px 16px' }}>
        <div className="panel" style={{ borderRadius: 14, overflow: 'hidden', border: '1px solid var(--line)' }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 12, background: 'var(--panel-2)' }}>
            <span style={{ width: 32, height: 32, borderRadius: 9, background: '#10b98114', color: '#10b981', display: 'grid', placeItems: 'center' }}>{Icon.dollar({ size: 16 })}</span>
            <div><b style={{ fontSize: 14 }}>Payments</b><div className="muted" style={{ fontSize: 12 }}>{filtered.length} rows</div></div>
          </div>
          <div className="py-tbl" data-testid="pc-table" style={{ overflowX: 'auto' }}>
            <div className="py-thead" style={{ gridTemplateColumns: '110px 1.4fr 1fr 100px 100px 1fr 100px', background: 'var(--panel-2)', fontSize: 11, padding: '12px 16px' }}>
              <span>Date</span><span>Client</span><span>Payer</span><span>Amount</span><span>Method</span><span>Ref / Note</span><span>Claim</span>
            </div>
            {filtered.slice(0, 100).map((p) => {
              const cl = clients.find((c) => c.id === p.clientId)
              return (
                <div key={p.id} className="py-trow" data-testid={`pc-pay-row-${p.id}`} style={{ gridTemplateColumns: '110px 1.4fr 1fr 100px 100px 1fr 100px', minHeight: 52, padding: '10px 16px' }}>
                  <div className="py-cell" style={{ fontSize: 12 }}>{p.date}</div>
                  <div className="py-cell"><div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><PersonAvatar p={cl} size={24} /><b style={{ fontSize: 13 }}>{cl?.name || p.clientId}</b></div></div>
                  <div className="py-cell" style={{ fontSize: 12 }}>{p.payer}</div>
                  <div className="py-cell"><b style={{ fontSize: 13, color: '#059669' }}>{money(p.amount)}</b></div>
                  <div className="py-cell"><span className="pill" style={{ fontSize: 11, borderRadius: 20, padding: '3px 10px', background: 'var(--panel-2)' }}>{p.method || p.kind}</span></div>
                  <div className="py-cell" style={{ fontSize: 12, color: 'var(--muted)' }}>{p.ref || ''} {p.note ? `· ${p.note}` : ''}</div>
                  <div className="py-cell" style={{ fontSize: 11 }}>{p.claimId ? <span className="ln-code">{claims[p.claimId]?.no || p.claimId.slice(0, 8)}</span> : '—'}</div>
                </div>
              )
            })}
            {!filtered.length && <div className="py-empty" style={{ padding: 48, textAlign: 'center' }} data-testid="pc-empty"><b>No payments</b><div className="muted" style={{ fontSize: 12 }}>Record a manual payment or import an ERA.</div></div>}
            <div className="footer" style={{ padding: '12px 20px', display: 'flex', justifyContent: 'space-between', background: 'var(--panel-2)', borderTop: '1px solid var(--line)', fontSize: 12 }}><span>{filtered.length} payments · {money(filtered.reduce((s, p) => s + p.amount, 0))} total</span><span>Unapplied {money(kpis.unapplied)}</span></div>
          </div>
        </div>
      </div>

      {openMan && <div className="modal-backdrop" data-testid="pc-man-modal"><div className="modal" style={{ width: 560, borderRadius: 14, border: '1px solid var(--line)' }}><div className="modal-hd" style={{ padding: '16px 20px', borderBottom: '1px solid var(--line)' }}><b style={{ fontSize: 15 }}>Manual Payment</b><button className="iconbtn" onClick={() => setOpenMan(false)} style={{ marginLeft: 'auto' }}>{Icon.x({ size: 12 })}</button></div><div style={{ padding: 20 }}><ManualForm state={state} onSaved={() => { setOpenMan(false); toast({ message: 'Payment recorded', kind: 'ok' }) }} /></div></div></div>}
      {openEra && <div className="modal-backdrop" data-testid="pc-era-modal"><div className="modal" style={{ width: 720, borderRadius: 14, border: '1px solid var(--line)' }}><div className="modal-hd" style={{ padding: '16px 20px', borderBottom: '1px solid var(--line)' }}><b style={{ fontSize: 15 }}>ERA Import (835)</b><button className="iconbtn" onClick={() => setOpenEra(false)} style={{ marginLeft: 'auto' }}>{Icon.x({ size: 12 })}</button></div><div style={{ padding: 20 }}><EraForm state={state} onSaved={() => { setOpenEra(false); toast({ message: 'ERA posted', kind: 'ok' }) }} /></div></div></div>}
    </div>
  )
}
