import React, { useEffect, useMemo, useState } from 'react'
import { useStore } from '../state/store'
import { Icon } from '../ui/Icons'
import { useToast } from '../ui/Toast'
import { BILL_CODES } from '../lib/model'
import { todayISO } from '../lib/date'
import { downloadDoc, loadPdf } from '../lib/exportKit'
import { suggestGfeRows, planGfe, gfePdf, codeLabel } from '../lib/gfe'

const money = (n) => `$${(Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const rateOf = (code) => BILL_CODES.find((c) => c.id === code)?.rate || 0

/** Good Faith Estimate for an uninsured or self-pay family: prefilled from the calendar, edited, downloaded. */
export default function GfeDialog({ client, onClose }) {
  const state = useStore()
  const toast = useToast()
  const [start, setStart] = useState(todayISO())
  const [months, setMonths] = useState(6)
  const [rows, setRows] = useState(() => {
    const s = suggestGfeRows(state, client.id, todayISO())
    return s.length ? s : [{ code: '97153', unitsPerWeek: 40, rate: rateOf('97153') }]
  })
  const [separately, setSeparately] = useState('')
  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])
  const est = useMemo(() => planGfe(state, client.id, {
    start, months: Number(months), separately,
    rows: rows.map((r) => ({ ...r, unitsPerWeek: Number(r.unitsPerWeek), rate: Number(r.rate) })),
  }), [state, client.id, start, months, rows, separately])
  const setRow = (i, patch) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  const download = async () => {
    if (!est.ok) { toast({ message: est.msg, kind: 'warn' }); return }
    if (!(await loadPdf((m) => toast({ message: m, kind: 'warn' })))) return
    downloadDoc(`Good-Faith-Estimate-${client.name.replace(/[^A-Za-z0-9]+/g, '_')}-${start}.pdf`, gfePdf(est), 'application/pdf')
    toast({ message: est.msg, kind: 'ok' })
    onClose()
  }
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-label="Good Faith Estimate" data-testid="gfe-dialog" style={{ width: 'min(760px, calc(100vw - 32px))' }}>
        <div className="modal-head">
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2>Good Faith Estimate · {client.name}</h2>
            <div className="muted" style={{ fontSize: 12 }}>For an uninsured or self-pay family (No Surprises Act). Prefilled from the calendar; adjust it to the care you expect.</div>
          </div>
          <button className="modal-x" onClick={onClose} aria-label="Close">{Icon.x({ size: 13 })}</button>
        </div>
        <div className="modal-body" style={{ padding: 18, display: 'grid', gap: 14 }}>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <label className="bil-fld"><span>Care starts</span><input className="input" type="date" value={start} onChange={(e) => setStart(e.target.value)} data-testid="gfe-start" /></label>
            <label className="bil-fld"><span>Period (up to 12 months)</span>
              <select className="input" value={months} onChange={(e) => setMonths(Number(e.target.value))} data-testid="gfe-months">
                {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => <option key={m} value={m}>{m} month{m > 1 ? 's' : ''}</option>)}
              </select>
            </label>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table className="table" style={{ width: '100%', fontSize: 12.5 }}>
              <thead><tr><th style={{ textAlign: 'left' }}>Service</th><th style={{ textAlign: 'right' }}>Units / week</th><th style={{ textAlign: 'right' }}>Rate / unit</th><th style={{ textAlign: 'right' }}>Expected cost</th><th aria-label="Remove" /></tr></thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i}>
                    <td><select className="input" value={r.code} onChange={(e) => setRow(i, { code: e.target.value, rate: rateOf(e.target.value) })} data-testid={`gfe-code-${i}`} aria-label="Service code">
                      {BILL_CODES.map((c) => <option key={c.id} value={c.id}>{c.id} · {codeLabel(c.id)}</option>)}
                    </select></td>
                    <td style={{ textAlign: 'right' }}><input className="input" type="number" min="0" step="1" value={r.unitsPerWeek} onChange={(e) => setRow(i, { unitsPerWeek: e.target.value })} data-testid={`gfe-units-${i}`} aria-label="Units per week" style={{ width: 80, textAlign: 'right' }} /></td>
                    <td style={{ textAlign: 'right' }}><input className="input" type="number" min="0" step="0.01" value={r.rate} onChange={(e) => setRow(i, { rate: e.target.value })} data-testid={`gfe-rate-${i}`} aria-label="Rate per unit" style={{ width: 90, textAlign: 'right' }} /></td>
                    <td style={{ textAlign: 'right', fontWeight: 700 }}>{est.ok ? money(est.lines[i]?.total) : '—'}</td>
                    <td><button className="iconbtn" aria-label={`Remove ${r.code}`} data-testid={`gfe-remove-${i}`} onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}>{Icon.trash({ size: 12 })}</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <button className="btn btn-sm" data-testid="gfe-add" onClick={() => setRows((rs) => [...rs, { code: '97155', unitsPerWeek: 4, rate: rateOf('97155') }])}>{Icon.plus({ size: 12 })} Add service</button>
            <span style={{ marginLeft: 'auto', fontSize: 13 }}>{est.ok ? <>Total estimated cost <b data-testid="gfe-total">{money(est.total)}</b> over {est.weeks} weeks</> : <span className="muted" data-testid="gfe-error">{est.msg}</span>}</span>
          </div>
          <label className="bil-fld"><span>Items or services expected to be scheduled separately (optional)</span>
            <input className="input" value={separately} onChange={(e) => setSeparately(e.target.value)} placeholder="For example: reassessment (97151) in 6 months" data-testid="gfe-separately" />
          </label>
          <p className="muted" style={{ fontSize: 11.5, margin: 0 }}>The PDF carries the CMS model notice disclaimer, including the right to dispute a bill $400 or more above the estimate within 120 days. The app does not send the estimate or keep a copy: give it to the family and save it with the client's record (kept for 6 years).</p>
        </div>
        <div className="modal-foot">
          <span />
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-sm" onClick={onClose}>Cancel</button>
            <button className="btn btn-sm btn-primary" data-testid="gfe-download" disabled={!est.ok} onClick={download}>{Icon.download({ size: 12 })} Download estimate</button>
          </div>
        </div>
      </div>
    </div>
  )
}
