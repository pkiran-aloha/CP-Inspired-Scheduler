import React, { useMemo, useState } from 'react'
import { useStore } from '../state/store'
import { SectionBar, RangePicker } from './NavRail'
import { Icon } from '../ui/Icons'
import { useToast } from '../ui/Toast'
import { resolveRange } from '../lib/analytics'
import { download } from '../lib/ics'
import { isoDate, addDays, parseISO, fmtDayLabel, todayISO } from '../lib/date'
import { dueOf } from '../lib/claims'
import { PersonAvatar } from '../ui/avatars'

const money = (n) => `$${(Math.round(n * 100) / 100).toLocaleString(undefined, { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`

export default function GenerateInvoiceView() {
  const state = useStore()
  const { ui, actions, settings, claims, clients } = state
  const toast = useToast()
  const preset = ui.invPreset || 'last4'
  const range = useMemo(() => resolveRange(preset, ui.anchor, settings.weekStart), [preset, ui.anchor, settings.weekStart])
  const [q, setQ] = useState('')
  const [clientIds, setClientIds] = useState(ui.invPrefill?.clientIds || [])
  const [balanceOnly, setBalanceOnly] = useState(ui.invPrefill?.balanceOnly || false)
  const [preview, setPreview] = useState(null)

  const filteredClients = useMemo(() => {
    let out = clients
    if (q.trim()) {
      const t = q.trim().toLowerCase()
      out = out.filter((c) => `${c.name} ${c.id}`.toLowerCase().includes(t))
    }
    return out
  }, [clients, q])

  const invoiceRows = useMemo(() => {
    const rows = []
    for (const cid of clientIds) {
      const cl = clients.find((c) => c.id === cid)
      const clClaims = Object.values(claims).filter((c) => c.clientId === cid && (balanceOnly ? dueOf(c) > 0 : true))
      rows.push({ client: cl, claims: clClaims, total: clClaims.reduce((s, c) => s + c.charges, 0), due: clClaims.reduce((s, c) => s + dueOf(c), 0) })
    }
    return rows
  }, [clientIds, claims, clients, balanceOnly])

  const kpis = {
    selected: clientIds.length,
    claims: invoiceRows.reduce((s, r) => s + r.claims.length, 0),
    total: invoiceRows.reduce((s, r) => s + r.total, 0),
    due: invoiceRows.reduce((s, r) => s + r.due, 0),
  }

  const generate = () => {
    if (!clientIds.length) { toast({ message: 'Select at least one client', kind: 'warn' }); return }
    const lines = [
      `Invoice — ${settings.org?.name || 'Practice'} — ${todayISO()}`,
      `Range ${range.days[0]} → ${range.days[range.days.length - 1]} — ${balanceOnly ? 'Balance only' : 'All charges'}`,
      '',
      ...invoiceRows.flatMap((r) => [
        `Client: ${r.client?.name || r.client?.id} — ${r.claims.length} claims — Charges ${money(r.total)} — Due ${money(r.due)}`,
        ...r.claims.map((c) => `  ${c.no} | ${c.dosFrom} | ${c.payer} | ${money(c.charges)} | Due ${money(dueOf(c))} | ${c.status}`),
        '',
      ]),
      `Total charges ${money(kpis.total)} — Total due ${money(kpis.due)}`,
    ]
    download(`Invoice-${todayISO()}.txt`, lines.join('\n'))
    toast({ message: `Invoice generated — ${kpis.selected} clients, ${money(kpis.due)} due`, kind: 'ok' })
    setPreview({ rows: invoiceRows, total: kpis.total, due: kpis.due })
  }

  return (
    <div className="sectionpage" data-testid="gi-sec" style={{ background: 'var(--bg)' }}>
      <SectionBar icon="file" title="Invoices" sub={`${range.label} · ${kpis.selected} clients selected · ${kpis.claims} claims · ${money(kpis.due)} due`}>
        <RangePicker preset={preset} onPreset={(p) => actions.setUI({ invPreset: p })} onSlide={(d) => actions.setUI({ anchor: isoDate(addDays(parseISO(ui.anchor), d * range.days.length)) })} label={range.label} />
        <div className="sb-search" style={{ minWidth: 220, borderRadius: 10 }}>
          <span className="sic">{Icon.search({ size: 12 })}</span>
          <input placeholder="Search clients" value={q} onChange={(e) => setQ(e.target.value)} data-testid="gi-search" style={{ fontSize: 13 }} />
        </div>
        <button className="btn btn-sm btn-primary" data-testid="gi-generate" onClick={generate} style={{ borderRadius: 10 }}>Generate Invoice</button>
      </SectionBar>

      <div className="batch-strip" data-testid="gi-kpis" style={{ margin: '16px', padding: '16px', gap: 12, flexWrap: 'wrap', background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 14 }}>
        {[
          ['Clients', kpis.selected, 'Selected', '#6366f1', 'gi-kpi-clients'],
          ['Claims', kpis.claims, balanceOnly ? 'Balance only' : 'All', '#0ea5e9', 'gi-kpi-claims'],
          ['Charges', money(kpis.total), 'Total', '#10b981', 'gi-kpi-charges'],
          ['Due', money(kpis.due), 'Outstanding', '#f59e0b', 'gi-kpi-due'],
        ].map(([label, val, sub, color, testId]) => (
          <div key={label} className="rp-sumchip on" data-testid={testId} style={{ background: 'var(--panel)', border: '1px solid var(--line)', display: 'flex', gap: 12, alignItems: 'center', minWidth: 140, borderRadius: 12, padding: '12px 16px' }}>
            <span style={{ width: 32, height: 32, borderRadius: 9, background: `${color}14`, color, display: 'grid', placeItems: 'center' }}>{Icon.file({ size: 14 })}</span>
            <div><b style={{ fontSize: 18, fontWeight: 800 }}>{val}</b><span style={{ display: 'block', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--muted)' }}>{label}</span><span style={{ fontSize: 12, color: 'var(--muted)' }}>{sub}</span></div>
          </div>
        ))}
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto', fontSize: 13, background: 'var(--panel-2)', padding: '8px 14px', borderRadius: 20, border: '1px solid var(--line)' }}>
          <input type="checkbox" checked={balanceOnly} onChange={(e) => setBalanceOnly(e.target.checked)} data-testid="gi-balance-only" /> Balance only
        </label>
      </div>

      <div style={{ padding: '0 16px 16px', display: 'flex', gap: 20, alignItems: 'flex-start' }}>
        <div className="panel" style={{ width: 380, flex: 'none', borderRadius: 14, overflow: 'hidden', border: '1px solid var(--line)' }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 12, background: 'var(--panel-2)' }}>
            <span style={{ width: 32, height: 32, borderRadius: 9, background: '#6366f114', color: '#6366f1', display: 'grid', placeItems: 'center' }}>{Icon.team({ size: 14 })}</span>
            <div><b style={{ fontSize: 14 }}>Clients</b><div className="muted" style={{ fontSize: 12 }}>{filteredClients.length} · select for invoice</div></div>
            <button className="btn btn-xs" onClick={() => setClientIds(filteredClients.map((c) => c.id))} style={{ marginLeft: 'auto', borderRadius: 8 }}>Select all</button>
          </div>
          <div style={{ maxHeight: 520, overflowY: 'auto' }}>
            {filteredClients.map((c) => {
              const on = clientIds.includes(c.id)
              const clClaims = Object.values(claims).filter((x) => x.clientId === c.id)
              const due = clClaims.reduce((s, x) => s + dueOf(x), 0)
              return (
                <div key={c.id} data-testid={`gi-client-${c.id}`} onClick={() => setClientIds((ids) => on ? ids.filter((x) => x !== c.id) : [...ids, c.id])} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', cursor: 'pointer', background: on ? '#f5f3ff' : undefined, borderLeft: `3px solid ${on ? '#6366f1' : 'transparent'}`, borderBottom: '1px solid var(--line)' }}>
                  <input type="checkbox" checked={on} readOnly style={{ pointerEvents: 'none' }} />
                  <PersonAvatar p={c} size={28} />
                  <div style={{ flex: 1, minWidth: 0 }}><b style={{ fontSize: 13, display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.name}</b><span style={{ fontSize: 11, color: 'var(--muted)' }}>{clClaims.length} claims · {money(due)} due</span></div>
                </div>
              )
            })}
            {!filteredClients.length && <div style={{ padding: 32, textAlign: 'center' }} className="muted">No clients</div>}
          </div>
        </div>

        <div className="panel" style={{ flex: 1, minWidth: 0, borderRadius: 14, overflow: 'hidden', border: '1px solid var(--line)' }} data-testid="gi-preview">
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 12, background: 'var(--panel-2)' }}>
            <span style={{ width: 32, height: 32, borderRadius: 9, background: '#10b98114', color: '#10b981', display: 'grid', placeItems: 'center' }}>{Icon.file({ size: 16 })}</span>
            <div><b style={{ fontSize: 14 }}>Invoice Preview</b><div className="muted" style={{ fontSize: 12 }}>{kpis.selected} clients · {kpis.claims} claims · {money(kpis.due)} due</div></div>
            <button className="btn btn-sm" data-testid="gi-clear" onClick={() => { setClientIds([]); setPreview(null) }} style={{ marginLeft: 'auto', borderRadius: 10 }}>Clear</button>
          </div>
          <div style={{ padding: 20 }}>
            {!invoiceRows.length ? (
              <div style={{ padding: 40, textAlign: 'center', border: '1px dashed var(--line)', borderRadius: 12 }}><b>Select clients to preview</b><div className="muted" style={{ fontSize: 12, marginTop: 6 }}>Charges and balances will appear here.</div></div>
            ) : (
              <>
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
                  <span style={{ fontSize: 12, background: 'var(--panel-2)', padding: '6px 12px', borderRadius: 20, border: '1px solid var(--line)' }}>{settings.org?.name || 'Practice'}</span>
                  <span style={{ fontSize: 12, background: 'var(--panel-2)', padding: '6px 12px', borderRadius: 20, border: '1px solid var(--line)' }}>{range.label}</span>
                  <span style={{ fontSize: 12, background: '#6366f1', color: '#fff', padding: '6px 12px', borderRadius: 20, fontWeight: 700 }}>{money(kpis.due)} due</span>
                </div>
                {invoiceRows.map((r) => (
                  <div key={r.client?.id} style={{ border: '1px solid var(--line)', borderRadius: 12, padding: 16, marginBottom: 12, background: 'var(--panel-2)' }} data-testid={`gi-row-${r.client?.id}`}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                      <PersonAvatar p={r.client} size={28} />
                      <b style={{ fontSize: 14 }}>{r.client?.name}</b>
                      <span style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 700 }}>{money(r.due)} due · {money(r.total)} charges</span>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {r.claims.slice(0, 10).map((c) => (
                        <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '6px 0', borderBottom: '1px dashed var(--line)' }}>
                          <span><span className="ln-code">{c.no}</span> · {c.dosFrom} · {c.payer}</span><span><b>{money(dueOf(c))}</b> <span style={{ color: 'var(--muted)' }}>/ {money(c.charges)}</span></span>
                        </div>
                      ))}
                      {r.claims.length > 10 && <span style={{ fontSize: 11, color: 'var(--muted)' }}>+ {r.claims.length - 10} more claims</span>}
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
