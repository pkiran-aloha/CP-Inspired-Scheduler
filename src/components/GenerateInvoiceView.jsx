import React, { useMemo, useState } from 'react'
import { useStore } from '../state/store'
import { SectionBar, RangePicker } from './NavRail'
import { Icon } from '../ui/Icons'
import { useToast } from '../ui/Toast'
import { resolveRange } from '../lib/analytics'
import { download } from '../lib/ics'
import { isoDate, addDays, parseISO, fmtDayLabel } from '../lib/date'
import { dueOf, isPrimaryReceivable, patientResponsibilityOf } from '../lib/claims'
import { PersonAvatar } from '../ui/avatars'
import { downloadDoc, loadPdf } from '../lib/exportKit'
import { SEND_METHODS, statementBalance, statementStatus, statementPdf } from '../lib/statements'
import { superbillClaims, superbillPdf } from '../lib/superbill'
import { buildPatientShareDraft, patientShareRows } from '../lib/billingDocs'
// One glyph per metric (no two tiles on a screen share one).
const TILE_ICON = { 'gi-kpi-clients': 'users', 'gi-kpi-claims': 'file', 'gi-kpi-charges': 'dollar', 'gi-kpi-due': 'user' }

const money = (n) => `$${(Math.round(n * 100) / 100).toLocaleString(undefined, { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`

export default function GenerateInvoiceView() {
  const state = useStore()
  const { ui, actions, settings, claims, clients } = state
  const toast = useToast()
  const preset = ui.invPreset || 'last4'
  const range = useMemo(() => resolveRange(preset, ui.anchor, settings.weekStart), [preset, ui.anchor, settings.weekStart])
  const sbRange = { from: range.days[0], to: range.days[range.days.length - 1] }
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

  const invoiceRows = useMemo(() => patientShareRows(state, clientIds, { balanceOnly }), [clientIds, claims, clients, state.payments, balanceOnly])

  const kpis = {
    selected: clientIds.length,
    claims: invoiceRows.reduce((s, r) => s + r.claims.length, 0),
    total: invoiceRows.reduce((s, r) => s + r.total, 0),
    due: invoiceRows.reduce((s, r) => s + r.due, 0),
  }

  const generate = () => {
    if (!clientIds.length) { toast({ message: 'Select at least one client', kind: 'warn' }); return }
    const draft = buildPatientShareDraft(state, { clientIds, balanceOnly, from: range.days[0], to: range.days[range.days.length - 1] })
    download(draft.fileName, draft.content, 'text/plain;charset=utf-8')
    toast({ message: `Draft statement created for ${kpis.selected} clients, ${money(kpis.due)} reported patient share`, kind: 'ok' })
    setPreview({ rows: invoiceRows, total: kpis.total, due: kpis.due })
  }

  return (
    <div className="sectionpage" data-testid="gi-sec" style={{ background: 'var(--bg)' }}>
      <SectionBar icon="file" title="Invoices" sub={`${range.label} · ${kpis.selected} clients selected · ${money(kpis.due)} reported patient share`} wiki="accounts-receivable" info={<><span>Draft patient statements. Patient share comes only from responsibility reported on a remittance, or from self-pay claims. Open insurance balances and linked secondary drafts are not patient charges.</span><span>The app does not mail or email statements. Download the PDF, deliver it yourself, then mark how it went out.</span></>}>
        <RangePicker preset={preset} onPreset={(p) => actions.setUI({ invPreset: p })} onSlide={(d) => actions.setUI({ anchor: isoDate(addDays(parseISO(ui.anchor), d * range.days.length)) })} label={range.label} />
        <div className="sb-search" style={{ minWidth: 220, borderRadius: 10 }}>
          <span className="sic">{Icon.search({ size: 12 })}</span>
          <input placeholder="Search clients" value={q} onChange={(e) => setQ(e.target.value)} data-testid="gi-search" style={{ fontSize: 13 }} />
        </div>
        <button className="btn btn-sm btn-primary" data-testid="gi-generate" onClick={generate} style={{ borderRadius: 10 }}>Download draft statement</button>
      </SectionBar>

      <div className="batch-strip" data-testid="gi-kpis" style={{ margin: '16px', padding: '16px', gap: 12, flexWrap: 'wrap', background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 14 }}>
        {[
          ['Clients', kpis.selected, 'Selected', '#6366f1', 'gi-kpi-clients'],
          ['Claims', kpis.claims, balanceOnly ? 'Balance only' : 'All', '#0ea5e9', 'gi-kpi-claims'],
          ['Charges', money(kpis.total), 'Total', '#10b981', 'gi-kpi-charges'],
          ['Reported patient share', money(kpis.due), 'Verify COB', '#f59e0b', 'gi-kpi-due'],
        ].map(([label, val, sub, color, testId]) => (
          <div key={label} className="rp-sumchip on" data-testid={testId} style={{ background: 'var(--panel)', border: '1px solid var(--line)', display: 'flex', gap: 12, alignItems: 'center', minWidth: 140, borderRadius: 12, padding: '12px 16px' }}>
            <span style={{ width: 32, height: 32, borderRadius: 9, background: `${color}14`, color, display: 'grid', placeItems: 'center' }}>{Icon[TILE_ICON[testId]]({ size: 16 })}</span>
            <div><b style={{ fontSize: 18, fontWeight: 800 }}>{val}</b><span style={{ display: 'block', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--muted)' }}>{label}</span><span style={{ fontSize: 12, color: 'var(--muted)' }}>{sub}</span></div>
          </div>
        ))}
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto', fontSize: 13, background: 'var(--panel-2)', padding: '8px 14px', borderRadius: 20, border: '1px solid var(--line)' }}>
          <input type="checkbox" checked={balanceOnly} onChange={(e) => setBalanceOnly(e.target.checked)} data-testid="gi-balance-only" /> Patient share only
        </label>
      </div>

      <div style={{ padding: '0 16px 16px', display: 'flex', gap: 20, alignItems: 'flex-start' }}>
        <div className="panel" style={{ width: 380, flex: 'none', borderRadius: 14, overflow: 'hidden', border: '1px solid var(--line)' }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 12, background: 'var(--panel-2)' }}>
            <span style={{ width: 32, height: 32, borderRadius: 9, background: '#6366f114', color: '#6366f1', display: 'grid', placeItems: 'center' }}>{Icon.team({ size: 14 })}</span>
            <div><b style={{ fontSize: 14 }}>Clients</b><div className="muted" style={{ fontSize: 12 }}>{filteredClients.length} clients. Select to invoice.</div></div>
            <button className="btn btn-xs" onClick={() => setClientIds(filteredClients.map((c) => c.id))} style={{ marginLeft: 'auto', borderRadius: 8 }}>Select all</button>
          </div>
          <div style={{ maxHeight: 520, overflowY: 'auto' }}>
            {filteredClients.map((c) => {
              const on = clientIds.includes(c.id)
              const clClaims = Object.values(claims).filter((x) => x.clientId === c.id && isPrimaryReceivable(x))
              const due = clClaims.reduce((s, x) => s + patientResponsibilityOf(state, x), 0)
              return (
                <div key={c.id} data-testid={`gi-client-${c.id}`} onClick={() => setClientIds((ids) => on ? ids.filter((x) => x !== c.id) : [...ids, c.id])} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', cursor: 'pointer', background: on ? 'var(--accent-soft)' : undefined, borderBottom: '1px solid var(--line)' }}>
                  <input type="checkbox" checked={on} readOnly style={{ pointerEvents: 'none' }} />
                  <PersonAvatar p={c} size={28} />
                  <div style={{ flex: 1, minWidth: 0 }}><b style={{ fontSize: 13, display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.name}</b><span style={{ fontSize: 11, color: 'var(--muted)' }}>{clClaims.length} primary claims · {money(due)} reported patient share</span></div>
                </div>
              )
            })}
            {!filteredClients.length && <div style={{ padding: 32, textAlign: 'center' }} className="muted">No clients</div>}
          </div>
        </div>

        <div className="panel" style={{ flex: 1, minWidth: 0, borderRadius: 14, overflow: 'hidden', border: '1px solid var(--line)' }} data-testid="gi-preview">
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 12, background: 'var(--panel-2)' }}>
            <span style={{ width: 32, height: 32, borderRadius: 9, background: '#10b98114', color: '#10b981', display: 'grid', placeItems: 'center' }}>{Icon.file({ size: 16 })}</span>
            <div><b style={{ fontSize: 14 }}>Draft statement preview</b><div className="muted" style={{ fontSize: 12 }}>{kpis.selected} clients · {kpis.claims} claims · {money(kpis.due)} reported patient share</div></div>
            <button className="btn btn-sm" data-testid="gi-clear" onClick={() => { setClientIds([]); setPreview(null) }} style={{ marginLeft: 'auto', borderRadius: 10 }}>Clear</button>
          </div>
          <div style={{ padding: 20 }}>
            <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>Draft only. Check coverage and COB before you send it.</p>
            {!invoiceRows.length ? (
              <div style={{ padding: 40, textAlign: 'center', border: '1px dashed var(--line)', borderRadius: 12 }}><b>Select clients to preview</b><div className="muted" style={{ fontSize: 12, marginTop: 6 }}>Charges and balances will appear here.</div></div>
            ) : (
              <>
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
                  <span style={{ fontSize: 12, background: 'var(--panel-2)', padding: '6px 12px', borderRadius: 20, border: '1px solid var(--line)' }}>{settings.org?.name || 'Practice'}</span>
                  <span style={{ fontSize: 12, background: 'var(--panel-2)', padding: '6px 12px', borderRadius: 20, border: '1px solid var(--line)' }}>{range.label}</span>
                  <span style={{ fontSize: 12, background: '#6366f1', color: '#fff', padding: '6px 12px', borderRadius: 20, fontWeight: 700 }}>{money(kpis.due)} reported share</span>
                </div>
                {invoiceRows.map((r) => (
                  <div key={r.client?.id} style={{ border: '1px solid var(--line)', borderRadius: 12, padding: 16, marginBottom: 12, background: 'var(--panel-2)' }} data-testid={`gi-row-${r.client?.id}`}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                      <PersonAvatar p={r.client} size={28} />
                      <b style={{ fontSize: 14 }}>{r.client?.name}</b>
                      <span style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 700 }}>{money(r.due)} reported share · {money(r.total)} charges</span>
                      {superbillClaims(state, r.client.id, sbRange).length > 0 && <button className="btn btn-xs" data-testid={`gi-superbill-${r.client.id}`} title="Itemized self-pay services for the family to send to their own insurer" onClick={async () => {
                        if (!(await loadPdf((m) => toast({ message: m, kind: 'warn' })))) return
                        try { downloadDoc(`Superbill-${r.client.name.replace(/[^A-Za-z0-9]+/g, '_')}-${sbRange.from}-to-${sbRange.to}.pdf`, superbillPdf(state, r.client.id, sbRange), 'application/pdf') } catch (e) { toast({ message: e.message, kind: 'warn' }); return }
                        toast({ message: `Superbill for ${r.client.name} downloaded (self-pay services ${sbRange.from} to ${sbRange.to}). Nothing was sent.`, kind: 'ok' })
                      }}>{Icon.download({ size: 11 })} Superbill</button>}
                      {r.due > 0 && <button className="btn btn-xs btn-primary" data-testid={`gi-issue-${r.client?.id}`} onClick={() => { const res = actions.issueStatement(r.client.id); toast({ message: res.msg, kind: res.ok ? 'ok' : 'warn' }) }}>Issue statement</button>}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {r.claims.slice(0, 10).map((c) => (
                        <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '6px 0', borderBottom: '1px dashed var(--line)' }}>
                          <span><span className="ln-code">{c.no}</span> · {c.dosFrom} · {c.payer}</span><span><b>{money(patientResponsibilityOf(state, c))}</b> <span style={{ color: 'var(--muted)' }}>reported share remaining · {money(c.patientPaid || 0)} patient received · {money(Math.max(0, dueOf(c)))} practice A/R</span> {patientResponsibilityOf(state, c) > 0 && <button className="btn btn-xs" data-testid={`gi-patient-${c.id}`} onClick={() => actions.setUI({ section: 'bil-payments', patientClaimId: c.id })}>Record receipt</button>}</span>
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
      <StatementHistory />
    </div>
  )
}

const STATUS_LABEL = { issued: 'Issued', sent: 'Sent', paid: 'Paid', void: 'Void' }

/** Every statement issued, newest first: download, record how it was delivered, or void it. */
function StatementHistory() {
  const state = useStore()
  const { actions, clients } = state
  const toast = useToast()
  const [via, setVia] = useState({})
  const [voiding, setVoiding] = useState(null)
  const [reason, setReason] = useState('')
  const list = Object.values(state.statements || {}).sort((a, b) => b.at - a.at)
  const say = (res) => toast({ message: res.msg, kind: res.ok ? 'ok' : 'warn' })
  return (
    <div className="panel" data-testid="gi-statements" style={{ margin: '0 16px 16px', borderRadius: 14, border: '1px solid var(--line)', overflow: 'hidden' }}>
      <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--line)', background: 'var(--panel-2)' }}>
        <b style={{ fontSize: 14 }}>Statements</b>
        <div className="muted" style={{ fontSize: 12 }}>Issued statements and their open balance. The app does not mail or email them.</div>
      </div>
      {!list.length ? (
        <div className="muted" style={{ padding: 20, fontSize: 12 }} data-testid="gi-statements-empty">No statements yet. Select a client with a reported share above and press Issue statement.</div>
      ) : list.map((st) => {
        const status = statementStatus(state, st)
        const client = clients.find((c) => c.id === st.clientId)
        return (
          <div key={st.id} data-testid={`gi-st-${st.id}`} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '10px 20px', borderBottom: '1px solid var(--line)', fontSize: 12 }}>
            <span className="ln-code">{st.no}</span>
            <b>{client?.name || st.clientId}</b>
            <span className="muted">{new Date(st.at).toISOString().slice(0, 10)}</span>
            <span>{money(st.total)} issued · <b>{money(statementBalance(state, st))}</b> open</span>
            <span className="tag" data-testid={`gi-st-status-${st.id}`}>{STATUS_LABEL[status]}{st.sentAt && status !== 'void' ? ` · ${SEND_METHODS.find((m) => m.id === st.sentVia)?.label || 'sent'}` : ''}</span>
            <span style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
              <button className="btn btn-xs" data-testid={`gi-st-pdf-${st.id}`} onClick={async () => { if (!(await loadPdf((m) => toast({ message: m, kind: 'warn' })))) return; downloadDoc(`${st.no}.pdf`, statementPdf(state, st).output('blob'), 'application/pdf'); toast({ message: `${st.no} downloaded as a PDF. Nothing was sent.`, kind: 'ok' }) }}>{Icon.download({ size: 11 })} PDF</button>
              {status !== 'void' && !st.sentAt && (
                <>
                  <select className="input" style={{ height: 26, fontSize: 11 }} aria-label="How it was delivered" data-testid={`gi-st-via-${st.id}`} value={via[st.id] || ''} onChange={(e) => setVia({ ...via, [st.id]: e.target.value })}>
                    <option value="">How was it delivered?</option>
                    {SEND_METHODS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                  </select>
                  <button className="btn btn-xs" data-testid={`gi-st-sent-${st.id}`} onClick={() => say(actions.markStatementSent(st.id, via[st.id]))}>Mark sent</button>
                </>
              )}
              {status !== 'void' && (voiding === st.id ? (
                <>
                  <input className="input" style={{ height: 26, fontSize: 11 }} placeholder="Reason" aria-label="Reason for voiding" data-testid={`gi-st-reason-${st.id}`} value={reason} onChange={(e) => setReason(e.target.value)} />
                  <button className="btn btn-xs" data-testid={`gi-st-void-ok-${st.id}`} onClick={() => { const res = actions.voidStatement(st.id, reason); say(res); if (res.ok) { setVoiding(null); setReason('') } }}>Void</button>
                </>
              ) : <button className="btn btn-xs" data-testid={`gi-st-void-${st.id}`} onClick={() => { setVoiding(st.id); setReason('') }}>Void…</button>)}
            </span>
          </div>
        )
      })}
    </div>
  )
}
