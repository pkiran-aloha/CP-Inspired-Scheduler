import React, { useEffect, useMemo, useState } from 'react'
import { PersonAvatar } from '../ui/avatars'
import { useStore } from '../state/store'
import { SectionBar, RangePicker } from './NavRail'
import { Icon } from '../ui/Icons'
import { useToast } from '../ui/Toast'
import { resolveRange } from '../lib/analytics'
import { runReport } from '../lib/reports'
import { BILL_CODES, computeBilling, TYPES } from '../lib/model'
import { download } from '../lib/ics'
import { addDays, fmtDayLabel, isoDate, parseISO, todayISO } from '../lib/date'
import {
  stagedAppts, planClaims, claimGate, claimStats, claimCsv, claimsCsv, quickPosts,
  CLAIM_STATUSES, DENIAL_REASONS, agingOf, dueOf, copayOf, memberIdOf, authNoOf, npiOf, dxFor, payerPolicy,
} from '../lib/claims'
import { claimTo1500, claimsTo1500, cms1500Data } from '../lib/cms1500'

const money = (n) => `$${(Math.round(n * 100) / 100).toLocaleString(undefined, { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`
const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
const relDay = (ts) => {
  if (!ts) return '—'
  const d = new Date(ts)
  const days = Math.round((parseISO(todayISO()) - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 86400000)
  if (days <= 0) return `Today ${hhmm(d.getHours() * 60 + d.getMinutes())}`
  if (days === 1) return `Yesterday ${hhmm(d.getHours() * 60 + d.getMinutes())}`
  return fmtDayLabel(isoDate(d))
}
const StatusChip = ({ s }) => (
  <span className="clm-status" style={{ color: CLAIM_STATUSES[s].ink, background: CLAIM_STATUSES[s].bg }}>{CLAIM_STATUSES[s].label}</span>
)

/**
 * Billing workspace — the full revenue-cycle desk.
 * Staging assembles claim-ready sessions into claim forms (charge lines, mileage,
 * dx codes); drafts pass validation gates on submit; submitted claims age against
 * the payer's cycle until payment posts or a denial demands a rebill. Everything
 * is one undo (U) away from being rewound, and every line jumps back to the
 * calendar row it came from.
 */
export default function BillingView() {
  const state = useStore()
  const { ui, actions, settings, appts, claims, clients, staff } = state
  const toast = useToast()
  const [tab, setTab] = useState('stage') // stage | claims | blocked | setup
  const [picked, setPicked] = useState(() => new Set())
  const [sel, setSel] = useState(ui.bilJump || null)
  useEffect(() => {
    if (ui.bilJump) {
      setTab('claims')
      setSel(ui.bilJump)
      actions.setUI({ bilJump: null })
    }
  }, [ui.bilJump])
  const [q, setQ] = useState('')
  const [statusF, setStatusF] = useState('all')
  const [sort, setSort] = useState('recent')
  const [payOpen, setPayOpen] = useState(false)
  const [denyOpen, setDenyOpen] = useState(false)
  const [disputed, setDisputed] = useState(() => new Set())

  const preset = ui.bilPreset || 'last4'
  const range = useMemo(() => resolveRange(preset, ui.anchor, settings.weekStart), [preset, ui.anchor, settings.weekStart])
  const ctx = useMemo(() => ({ days: range.days, gran: 'week', buckets: [], scope: {} }), [range])
  const blocked = useMemo(() => runReport(state, 'blocked', ctx).rows, [state.appts, ctx])

  const staged = useMemo(() => stagedAppts(state, range.days), [state, range])
  const plans = useMemo(() => planClaims(state, staged), [state, staged])
  const stats = useMemo(() => claimStats(state, range.days), [state, range])
  const bill = settings.billing || {}
  const setBill = (p) => actions.setSettings({ billing: { ...bill, ...p } })
  const setOrg = (p) => actions.setSettings({ org: { ...(settings.org || {}), ...p } })
  const clientOf = (id) => clients.find((c) => c.id === id) || {}
  const staffOf = (id) => staff.find((s) => s.id === id) || {}

  const gatedIds = useMemo(() => {
    const out = {}
    for (const c of Object.values(claims)) if (c.status === 'draft') { const g = claimGate(state, c); if (!g.ok) out[c.id] = g.bad.length }
    return out
  }, [claims, state])

  // ---- claim list ----
  const allClaims = useMemo(() => Object.values(claims), [claims])
  const list = useMemo(() => {
    const t = q.trim().toLowerCase()
    let out = allClaims.filter((c) => {
      if (statusF !== 'all' && c.status !== statusF) return false
      if (!t) return true
      const cl = clientOf(c.clientId)
      return `${c.no} ${cl.name} ${c.payer}`.toLowerCase().includes(t)
    })
    out = out.sort((a, b) => {
      if (sort === '$') return b.charges - a.charges
      if (sort === 'aging') return (agingOf(b)?.days || -1) - (agingOf(a)?.days || -1) || b.charges - a.charges
      return Math.max(b.closedAt || 0, b.submittedAt || 0, b.createdAt) - Math.max(a.closedAt || 0, a.submittedAt || 0, a.createdAt)
    })
    return out
  }, [allClaims, q, statusF, sort, clients])
  const claim = sel && claims[sel] ? claims[sel] : list[0]
  useEffect(() => { if (list.length && !claims[sel ?? '']) setSel(list[0].id) }, [list])

  const openCount = stats.drafts.n + stats.pending.n + stats.denied.n
  const stagedTotal = staged.reduce((t, a) => t + computeBilling(a), 0)

  // ---- staging actions ----
  const toggle = (id) => setPicked((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const generate = () => {
    const r = actions.generateClaims(picked.size ? [...picked] : null)
    toast({ message: `${r.msg} — press U to dissolve`, kind: r.ok ? 'ok' : 'warn' })
    if (r.ok) { setPicked(new Set()); setTab('claims'); setStatusF('all'); if (r.ids?.length) setSel(r.ids[0]) }
  }
  const exportStageCsv = () => {
    const inv = `${bill.invoicePrefix || 'INV'}-${range.days[0].slice(0, 7).replace('-', '')}`
    const lines = [
      `# ${settings.org?.name || 'Practice'} · staging export · ${range.label}`,
      'line,date,client,payer,code,units,rate,charge',
      ...staged.map((a, i) => { const c = clientOf(a.clientIds?.[0]); return `${i + 1},${a.date},"${c.name || ''}",${c.insurer || 'Self-pay'},${a.billing?.code},${a.billing?.units},${a.billing?.rate},${computeBilling(a)}` }),
    ]
    download(`${inv}-staging.csv`, lines.join('\n'))
    toast({ message: `Staging list exported (${staged.length} lines)`, kind: 'ok' })
  }
  const autoFix = (apptId) => {
    const a = appts[apptId]
    if (!a) return
    const code = BILL_CODES.find((c) => c.id === a.billing?.code) || BILL_CODES[0]
    const units = Math.round(((a.end - a.start) / code.unitMins) * 4) / 4
    actions.update(a.id, { billing: { ...(a.billing || {}), code: code.id, unitMins: code.unitMins, minutes: a.end - a.start, units, rate: a.billing?.rate || code.rate, mileage: a.billing?.mileage ?? a.type === 'drive' } })
    toast({ message: `Units auto-filled (${units} × ${code.id}) — re-run the batch`, kind: 'ok' })
  }

  // ---- claim actions ----
  const tx = (r) => { toast({ message: r.ok ? `${r.msg} — press U to undo` : r.msg, kind: r.ok ? 'ok' : 'warn' }); return r }
  const submit = (id) => tx(actions.submitClaims([id]))
  const submitAllDrafts = () => tx(actions.submitClaims(Object.values(claims).filter((c) => c.status === 'draft').map((c) => c.id)))
  const voidClaim = (id) => tx(actions.voidClaim(id))
  const rebill = (id) => {
    const r = tx(actions.rebillClaim(id, [...disputed]))
    setDisputed(new Set())
    if (r.ok && r.newId) { setStatusF('all'); setSel(r.newId) }
  }
  const dropLine = (cid, aid) => tx(actions.dropClaimLine(cid, aid))
  const writeOff = (id) => { const c = claims[id]; tx(actions.postPayment(id, { amount: 0, adj: c.charges, checkNo: 'N/A', note: 'Written off — uncollectible' })) }

  const Tab = ({ id, label, n, warn }) => (
    <button className={`tab ${tab === id ? 'on' : ''}`} data-testid={`bil-tab-${id}`} onClick={() => setTab(id)}>
      {label}{n > 0 && <span className={`pill ${warn ? 'warn' : ''}`}>{n}</span>}
    </button>
  )
  const Kpi = ({ id, label, value, sub, tone, onClick }) => (
    <button className={`bil-kpi ${tone || ''}`} data-testid={`bil-kpi-${id}`} onClick={onClick}><span>{label}</span><b>{value}</b><i>{sub}</i></button>
  )

  return (
    <div className="sectionpage">
      <SectionBar icon="dollar" title="Billing" sub={`Claims lifecycle — stage → form → submit → pay · ${range.label}`}>
        <RangePicker preset={preset} onPreset={(p) => actions.setUI({ bilPreset: p })} onSlide={(d) => actions.setUI({ anchor: isoDate(addDays(parseISO(ui.anchor), d * range.days.length)) })} label={range.label} />
        {tab === 'stage' && (
          <>
            <button className="btn btn-sm" onClick={exportStageCsv} data-testid="bil-export">{Icon.download({ size: 13 })} Export staging</button>
            <button className="btn btn-sm btn-primary" disabled={!staged.length} onClick={generate} data-testid="bil-generate">{Icon.file({ size: 12 })} Assemble {picked.size || staged.length} line{picked.size || staged.length > 1 ? 's' : ''} → {picked.size ? 'claims' : plans.length} claim form{plans.length === 1 ? '' : 's'}</button>
          </>
        )}
        {tab === 'claims' && (
          <>
            <button className="btn btn-sm" onClick={() => {
              const ins = list.filter((c) => c.status !== 'void')
              if (!ins.length) { toast({ message: 'No claims in view to export', kind: 'warn' }); return }
              try { claimsTo1500(state, ins).save(`CMS-1500-batch-${todayISO()}.pdf`) } catch (e) { /* headless */ }
              toast({ message: `CMS-1500 batch — ${ins.length} claims onto one print-ready PDF`, kind: 'ok' })
            }} data-testid="bil-cms1500-batch" title="One multi-page CMS-1500 PDF covering every claim currently filtered in the list">{Icon.print({ size: 13 })} CMS-1500 batch</button>
            <button className="btn btn-sm" onClick={() => { download(`${(bill.claimPrefix || 'CLM')}-ledger.csv`, claimsCsv(state, list)); toast({ message: `${list.length} claims exported`, kind: 'ok' }) }} data-testid="bil-csv-all">{Icon.download({ size: 13 })} Ledger CSV</button>
            <button className="btn btn-sm btn-primary" disabled={!stats.drafts.n} onClick={submitAllDrafts} data-testid="bil-submit-all">{Icon.check({ size: 12 })} Submit all ready drafts ({Object.keys(claims).filter((id) => claims[id].status === 'draft' && !gatedIds[id]).length})</button>
          </>
        )}
      </SectionBar>

      <div className="sec-body">
        <div className="bil-kpis" data-testid="bil-kpis">
          <Kpi id="staged" label="In staging" value={money(stagedTotal)} sub={`${staged.length} claim-ready lines`} onClick={() => setTab('stage')} />
          <Kpi id="draft" label="Drafts" value={stats.drafts.n} sub={stats.drafts.n ? `${money(stats.drafts.$)} · ${Object.keys(gatedIds).length ? `${Object.keys(gatedIds).length} gated` : 'ready to submit'}` : 'nothing pending assembly'} onClick={() => { setTab('claims'); setStatusF('draft') }} tone={Object.keys(gatedIds).length ? 'alert' : ''} />
          <Kpi id="pending" label="Awaiting payer" value={money(stats.pending.$)} sub={`${stats.pending.n} out${stats.pending.late ? ` · ${stats.pending.late} past cycle` : ''}`} onClick={() => { setTab('claims'); setStatusF('submitted') }} tone={stats.pending.late ? 'warn' : ''} />
          <Kpi id="denied" label="Denied" value={stats.denied.n} sub={stats.denied.n ? `${money(stats.denied.$)} needs action` : 'none open'} onClick={() => { setTab('claims'); setStatusF('denied') }} tone={stats.denied.n ? 'alert' : ''} />
          <Kpi id="paid" label={`Paid · ${range.label}`} value={money(stats.paid.$)} sub={`${stats.paid.n} remittances · ${stats.denialRate}% denial rate`} onClick={() => { setTab('claims'); setStatusF('paid') }} />
          <Kpi id="cycle" label="Avg days to pay" value={stats.avgDaysToPay ?? '—'} sub={stats.avgDaysToPay ? 'across paid claims' : 'no history yet'} />
        </div>

        <div className="batch-strip" style={{ alignItems: 'center' }}>
          <Tab id="stage" label="Staging" n={staged.length} />
          <Tab id="claims" label="Claim desk" n={openCount} warn={stats.denied.n > 0} />
          <Tab id="blocked" label="Blocked" n={blocked.length} warn />
          <Tab id="setup" label="Setup" />
          <span style={{ width: 1, height: 20, background: 'var(--line)' }} />
          <span>held back <b style={{ color: 'var(--danger)' }}>{money(blocked.reduce((t, r) => t + r.estCharge, 0))}</b></span>
          <span style={{ marginLeft: 'auto', display: 'flex', gap: 7, flexWrap: 'wrap' }}>
            {['0–30', '31–60', '61–90', '90+'].map((b) => (
              <span key={b} className={`rp-sumchip ${stats.pending.buckets[b] ? 'on' : ''}`} style={{ padding: '4px 10px', opacity: stats.pending.buckets[b] ? 1 : 0.45 }}>
                <b style={{ fontSize: 12 }}>{money(stats.pending.buckets[b] || 0)}</b><span>A/R {b}</span>
              </span>
            ))}
          </span>
        </div>

        {/* ================= STAGE ================= */}
        {tab === 'stage' && (
          <div className="stage-grid">
            <div className="bil-lines panel" style={{ borderRadius: 'var(--r-md)', border: '1px solid var(--line)', boxShadow: 'var(--shadow-1)' }}>
              <div style={{ padding: '7px 13px', borderBottom: '1px solid var(--line)', display: 'flex', gap: 9, alignItems: 'center', fontSize: 11.5 }}>
                <span className="muted">{picked.size ? `${picked.size} selected — forms built from selection` : `${staged.length} lines · forms group by client × payer × month (self-pay = one invoice)`}</span>
                <div className="f1" />
                <button className="btn btn-sm btn-ghost" data-testid="bil-pickall" onClick={() => setPicked(picked.size === staged.length ? new Set() : new Set(staged.map((a) => a.id)))}>
                  {picked.size === staged.length ? 'Clear' : 'Select all'} ({staged.length})
                </button>
              </div>
              {staged.map((a, i) => {
                const c = clientOf(a.clientIds?.[0])
                return (
                  <div className="bil-line" key={a.id} data-testid={`bil-row-${i}`}>
                    <span className={`cb ${picked.has(a.id) ? 'on' : ''}`} onClick={() => toggle(a.id)} role="checkbox" aria-checked={picked.has(a.id)} data-testid={`bil-pick-${i}`}>
                      {picked.has(a.id) && Icon.check({ size: 10, strokeWidth: 3 })}
                    </span>
                    <b>{fmtDayLabel(a.date)}</b>
                    <span style={{ minWidth: 110 }}>{c.name || '—'}</span>
                    <span className="muted">{c.insurer || 'Self-pay'}</span>
                    <span className="ln-code">{a.billing?.mileage && !a.billing?.units ? '14220' : a.billing?.code || '—'}</span>
                    <span className="muted">{a.billing?.mileage && !a.billing?.units ? `${a.billing?.distance} mi` : `${a.billing?.units}u × $${a.billing?.rate}`}</span>
                    <span className="r money">{money(computeBilling(a))}</span>
                    <button className="iconbtn" style={{ width: 24, height: 24 }} title="Open the source appointment" onClick={() => actions.setUI({ section: 'calendar', anchor: a.date, openAppt: a.id })}>{Icon.chevronR({ size: 12 })}</button>
                  </div>
                )
              })}
              {!staged.length && <div className="bil-empty">{plans.length ? '—' : blocked.length ? `Nothing claim-ready in this window — ${blocked.length} blocked line(s) need fixes first.` : 'Everything in this window is on a claim or paid — slide the range or check the desk.'}</div>}
            </div>
            <aside className="assemble-card panel">
              <h3>{Icon.file({ size: 13 })} Claim forms preview <span className="muted" style={{ fontWeight: 500 }}>({picked.size ? 'selection' : 'all staging'})</span></h3>
              {plans.slice(0, 8).map((p, i) => (
                <div className="ac-row" key={`${p.clientId}-${i}`} data-testid={`asm-row-${i}`}>
                    <PersonAvatar p={clientOf(p.clientId)} size={26} />
                    <span className="ac-main">
                      <b>{p.client}</b>
                      <i>{p.mode === 'selfpay' ? 'Self-pay invoice' : p.payer} · {p.dosFrom === p.dosTo ? p.dosTo : `${p.dosFrom.slice(5)} → ${p.dosTo.slice(5)}`}</i>
                    </span>
                    <span className="ac-nums">{p.appts.length} ln · {p.units}u<b className="money">{money(p.charges)}</b></span>
                  </div>
              ))}
              {plans.length > 8 && <div className="muted" style={{ fontSize: 11, padding: '4px 12px' }}>+{plans.length - 8} more forms…</div>}
              {!!plans.length && (
                <button className="btn btn-sm btn-primary" style={{ width: '100%', marginTop: 8 }} onClick={generate} data-testid="asm-generate">
                  {Icon.zap({ size: 12 })} Assemble {plans.length} form{plans.length > 1 ? 's' : ''} · {money(plans.reduce((t, p) => t + p.charges, 0))}
                </button>
              )}
              {!plans.length && <div className="bil-empty">Import-ready lines appear here as you select staging rows.</div>}
              <div className="muted" style={{ fontSize: 10.5, padding: '8px 12px 0', borderTop: '1px dashed var(--line)', marginTop: 6 }}>
                Numbers mint from the {bill.claimPrefix || 'CLM'} sequence; charge lines keep their CPT, units, rate & rendering staff. Mileage folds into each visit as code 14220.
              </div>
            </aside>
          </div>
        )}

        {/* ================= CLAIM DESK ================= */}
        {tab === 'claims' && (
          <div className="clm-wrap">
            <aside className="clm-list panel">
              <div className="clm-tools">
                <span className="clm-search">{Icon.search({ size: 12 })}<input placeholder="Search claim no, client, payer…" value={q} onChange={(e) => setQ(e.target.value)} data-testid="clm-search" /></span>
                <select className="input" style={{ width: 96, height: 28 }} value={sort} onChange={(e) => setSort(e.target.value)} data-testid="clm-sort" aria-label="Sort claims">
                  <option value="recent">Recent</option><option value="$">Value ↓</option><option value="aging">Oldest pending</option>
                </select>
              </div>
              <div className="clm-filters" role="tablist" aria-label="Claim status">
                {[['all', 'All'], ['draft', 'Draft'], ['submitted', 'Submitted'], ['denied', 'Denied'], ['paid', 'Paid'], ['void', 'Void']].map(([f, l]) => {
                  const n = f === 'all' ? allClaims.length : allClaims.filter((c) => c.status === f).length
                  return <button key={f} className={`sf-chip ${statusF === f ? 'on' : ''}`} data-testid={`clm-filter-${f}`} onClick={() => setStatusF(f)}>{l}<span>{n}</span></button>
                })}
              </div>
              {list.map((c, i) => {
                const cl = clientOf(c.clientId)
                const age = agingOf(c)
                return (
                  <button key={c.id} className={`clm-card ${claim?.id === c.id ? 'on' : ''}`} data-testid={`clm-row-${i}`} onClick={() => { setSel(c.id); setDisputed(new Set()) }}>
                    <span className="cc-top"><b>{c.no}</b><StatusChip s={c.status} />{gatedIds[c.id] ? <span className="cc-gate" title={`${gatedIds[c.id]} line(s) fail the validation gates`}>⚠ {gatedIds[c.id]}</span> : null}</span>
                    <span className="cc-client">{cl.name || '—'} <i>{c.mode === 'selfpay' ? 'family invoice' : c.payer}</i></span>
                    <span className="cc-foot">{c.dosFrom.slice(5)} → {c.dosTo.slice(5)} · {c.lines.length} ln
                      <b className={dueOf(c) > 0 ? 'due' : ''}>{money(dueOf(c))}</b>
                      {age ? <em className={age.late ? 'late' : ''}>{age.days}d out</em> : null}
                    </span>
                  </button>
                )
              })}
              {!list.length && <div className="bil-empty">No claims match{q ? ' that search' : ''} — assemble some from Staging, or clear the filter.</div>}
            </aside>

            {claim ? <ClaimForm claim={claim} gated={gatedIds[claim.id]} disputed={disputed} setDisputed={setDisputed}
              payOpen={payOpen} setPayOpen={setPayOpen} denyOpen={denyOpen} setDenyOpen={setDenyOpen}
              onSubmit={() => submit(claim.id)} onVoid={() => voidClaim(claim.id)} onRebill={() => rebill(claim.id)} onWriteOff={() => writeOff(claim.id)} onDropLine={(aid) => dropLine(claim.id, aid)}
              clientOf={clientOf} staffOf={staffOf} /> : (
              <div className="clm-empty panel">{Icon.dollar({ size: 30 })}<h3>The desk is empty</h3><p>Assemble staging lines into claim forms and they’ll queue here for submission, payment posting and denials.</p><button className="btn btn-sm btn-primary" onClick={() => setTab('stage')}>Go to staging</button></div>
            )}
          </div>
        )}

        {/* ================= BLOCKED ================= */}
        {tab === 'blocked' && (
          <div className="bil-lines panel" style={{ borderRadius: 'var(--r-md)', border: '1px solid var(--line)', boxShadow: 'var(--shadow-1)' }}>
            {blocked.map((r, i) => (
              <div className="bil-line" key={i} data-testid={`blk-row-${i}`}>
                <span className="sev-pill sev-error">{/0 billable|no billing/i.test(r.issues) ? 'billing' : 'gate'}</span>
                <b>{fmtDayLabel(r.date)}</b>
                <span style={{ minWidth: 110 }}>{r.client}</span>
                <span className="muted">{r.issues}</span>
                <span className="r" style={{ color: 'var(--danger)', fontWeight: 700 }}>{money(r.estCharge)}</span>
                {/billable units|rate is \$0|no billing/i.test(r.issues) && bill.autoUnits !== false && (
                  <button className="btn btn-sm" data-testid={`blk-fix-${i}`} onClick={() => autoFix(r._link.id)} title="Compute units from duration & code table">{Icon.zap({ size: 11 })} Auto-fix</button>
                )}
                <button className="btn btn-sm btn-ghost" onClick={() => actions.setUI({ section: 'calendar', anchor: r.date, openAppt: r._link.id })} title="Open the session to verify / correct">Open</button>
              </div>
            ))}
            {!blocked.length && <div className="bil-empty">No blocked lines in this window ✓</div>}
          </div>
        )}

        {/* ================= SETUP ================= */}
        {tab === 'setup' && (
          <div className="bil-grid">
            <div className="bil-card">
              <h3><span className="pi">{Icon.pin({ size: 12 })}</span> Practice identity</h3>
              {[['name', 'Practice name'], ['taxId', 'Tax ID'], ['npi', 'Facility / billing NPI'], ['address', 'Address'], ['phone', 'Phone']].map(([k, l]) => (
                <label className="bil-fld" key={k}>
                  <span>{l}</span>
                  <input className="input" data-testid={`bi-${k}`} value={settings.org?.[k] || ''} onChange={(e) => setOrg({ [k]: e.target.value })} />
                </label>
              ))}
              <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>Printed on claim forms, CMS-1500 exports & invoice CSVs. Reports pull it automatically.</div>
              <div className="bil-line" style={{ marginTop: 8, fontSize: 11, lineHeight: 1.5, color: 'var(--text-2)', border: '1px dashed var(--line-2)', borderRadius: 8, padding: '7px 9px' }}>
                {Icon.info({ size: 12 })} <b>CMS-1500 (02/12)</b> PDFs map boxes 1–33 from this identity + client demographics (DOB & sex on the client record). Clearinghouses expect the electronic twin — <b>ANSI 837P</b> — built from the same fields; the PDF is the print/image attachment path.
              </div>
            </div>
            <div>
              <div className="bil-card" style={{ marginBottom: 10 }}>
                <h3><span className="pi">{Icon.dollar({ size: 12 })}</span> Rate & numbering policy</h3>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10 }}>
                  {[['defaultRate', 'Default unit rate $'], ['mileageRate', 'Mileage $/mi'], ['invoicePrefix', 'Invoice prefix', true], ['dueDays', 'Net terms (days)']].map(([k, l, text]) => (
                    <label className="bil-fld" key={k}>
                      <span>{l}</span>
                      <input className="input" data-testid={`bi-${k}`} type={text ? 'text' : 'number'} step={k === 'mileageRate' ? 0.05 : 1} value={k === 'invoicePrefix' ? bill.invoicePrefix || '' : settings[k]} onChange={(e) => (k === 'invoicePrefix' ? setBill({ invoicePrefix: e.target.value }) : actions.setSettings({ [k]: Number(e.target.value) || 0 }))} />
                    </label>
                  ))}
                  <label className="bil-fld">
                    <span>Claim prefix</span>
                    <input className="input" data-testid="bi-claimPrefix" value={bill.claimPrefix || 'CLM'} onChange={(e) => setBill({ claimPrefix: e.target.value.toUpperCase() || 'CLM' })} />
                  </label>
                </div>
                <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>Claim numbers mint as <code>{bill.claimPrefix || 'CLM'}-YYYYMM-###</code>; rebills append -R2, -R3… Default rate seeds new bookings & the gaps report.</div>
              </div>
              <div className="bil-card">
                <h3><span className="pi">{Icon.checkCircle({ size: 12 })}</span> Claim gates</h3>
                <div className="bil-line" style={{ borderBottom: '1px solid var(--line)', padding: '8px 2px' }}>
                  <span className={`cb ${bill.requireVerification !== false ? 'on' : ''}`} role="checkbox" aria-checked={bill.requireVerification !== false} data-testid="bi-requirever" onClick={() => setBill({ requireVerification: bill.requireVerification === false })}>
                    {bill.requireVerification !== false && Icon.check({ size: 10, strokeWidth: 3 })}
                  </span>
                  <b>Require session verification before a line can go on a claim</b>
                  <span className="r muted">{blocked.filter((b) => /verification/i.test(b.issues)).length} lines gated right now · drafts holding gates are flagged ⚠</span>
                </div>
                <div className="bil-line" style={{ padding: '8px 2px' }}>
                  <span className={`cb ${bill.autoUnits !== false ? 'on' : ''}`} role="checkbox" aria-checked={bill.autoUnits !== false} data-testid="bi-autounits" onClick={() => setBill({ autoUnits: bill.autoUnits === false })}>
                    {bill.autoUnits !== false && Icon.check({ size: 10, strokeWidth: 3 })}
                  </span>
                  <b>Auto-fill units from duration & code</b>
                  <span className="r muted">powers the one-click fixes on Blocked</span>
                </div>
                <div style={{ marginTop: 10 }}>
                  <table className="dir-table" style={{ fontSize: 11.5 }}>
                    <thead><tr><th>Code</th><th>Description</th><th className="r">Unit</th><th className="r">Rate</th></tr></thead>
                    <tbody>
                      {BILL_CODES.map((c) => (
                        <tr key={c.id}>
                          <td><b>{c.id}</b></td>
                          <td>{c.label.split(' · ')[1]}</td>
                          <td className="r">{c.unitMins} min</td>
                          <td className="r money">${c.rate}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>The shared code table — the wizard, this page and every claim line stay in lockstep.</div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ================= claim form =================
function ClaimForm({ claim, gated, disputed, setDisputed, payOpen, setPayOpen, denyOpen, setDenyOpen, onSubmit, onVoid, onRebill, onWriteOff, onDropLine, clientOf, staffOf }) {
  const state = useStore()
  const { settings, actions, appts } = state
  const toast = useToast()
  const client = clientOf(claim.clientId)
  const org = settings.org || {}
  const gate = claim.status === 'draft' ? claimGate(state, claim) : { ok: true, bad: [] }
  const badIds = new Set(gate.bad.map((b) => b.line.apptId))
  const age = agingOf(claim)
  const due = dueOf(claim)
  const copay = copayOf(claim, client)
  const dx = dxFor(client)
  const firstAppt = appts[claim.lines[0]?.apptId]
  const facility = firstAppt?.location || client.home || org.address
  const shortPay = claim.status === 'paid' && claim.charges - (claim.adj || 0) - claim.paid > 0.5
  const [noteDraft, setNoteDraft] = useState(claim.note || '')
  useEffect(() => setNoteDraft(claim.note || ''), [claim.id, claim.note])

  const editable = claim.status === 'draft' || claim.status === 'denied'
  const toggleDispute = (aid) => setDisputed((s) => { const n = new Set(s); n.has(aid) ? n.delete(aid) : n.add(aid); return n })
  const export1500 = () => {
    const pages = cms1500Data(state, claim).pages.length
    try { claimTo1500(state, claim).save(`${claim.no}-1500.pdf`) } catch (e) { /* headless test env — mapping already validated */ }
    toast({ message: `CMS-1500 exported — ${claim.no} · ${pages} page${pages > 1 ? 's' : ''}${claim.mode === 'selfpay' ? ' (courtesy copy)' : ' · e-file via ANSI 837P'}`, kind: 'ok' })
  }

  return (
    <section className="clm-doc" data-testid="clm-form">
      <header className="cd-head">
        <div className="cd-title">
          <span className={`cd-mode ${claim.mode}`}>{claim.mode === 'selfpay' ? 'INVOICE' : 'CLAIM'}</span>
          <h2>{claim.no}{claim.version > 1 ? <em title={`Rebill of ${claim.parentNo}`}>v{claim.version}</em> : null}</h2>
          <StatusChip s={claim.status} />
          {age ? <span className={`cd-aging ${age.late ? 'late' : ''}`} data-testid="clm-aging">{age.days} days out{age.late ? ' — past cycle' : ''}</span> : null}
          {gated ? <span className="cc-gate" title="Validation gates will refuse submission until these lines are fixed">⚠ {gated} line{gated > 1 ? 's' : ''} gated</span> : null}
        </div>
        <div className="cd-actions no-print">
          {claim.status === 'draft' && (
            <button className="btn btn-sm btn-primary" data-testid="clm-submit" onClick={onSubmit} title={gate.ok ? 'Run gates & send to payer' : `${gate.bad.length} line(s) fail the gates`}>{Icon.check({ size: 12 })} Submit {claim.mode === 'selfpay' ? 'invoice' : 'to payer'}</button>
          )}
          {claim.status === 'submitted' && (
            <>
              <button className="btn btn-sm btn-primary" data-testid="clm-pay" onClick={() => setPayOpen(true)}>{Icon.dollar({ size: 12 })} Post payment</button>
              <button className="btn btn-sm" data-testid="clm-deny" onClick={() => setDenyOpen(true)}>{Icon.ban({ size: 12 })} Record denial</button>
            </>
          )}
          {claim.status === 'denied' && (
            <>
              <button className="btn btn-sm btn-primary" data-testid="clm-rebill" onClick={onRebill}>{Icon.repeat({ size: 12 })} Rebill{disputed.size ? ` (drop ${disputed.size})` : ''}</button>
              <button className="btn btn-sm" data-testid="clm-writeoff" onClick={onWriteOff} title="Close with a zero payment and full write-off">{Icon.file({ size: 12 })} Write off</button>
            </>
          )}
          {(claim.status === 'draft' || claim.status === 'submitted') && <button className="btn btn-sm" data-testid="clm-void" onClick={onVoid} title="Void & release every line back to staging">{Icon.trash({ size: 12 })} Void</button>}
          <button className="btn btn-sm" data-testid="clm-cms1500" onClick={export1500} title={claim.mode === 'selfpay' ? 'Printable CMS-1500 (courtesy copy for the family)' : 'CMS-1500 (02/12) PDF — boxes 1–33, six service rows per page'}>
            {Icon.print({ size: 12 })} CMS-1500 {claim.mode === 'selfpay' ? '· courtesy' : 'PDF'}
          </button>
          <span style={{ width: 1, height: 20, background: 'var(--line)' }} />
          <button className="btn btn-sm" onClick={() => { download(`${claim.no}.csv`, claimCsv(state, claim)); toast({ message: `${claim.no} exported`, kind: 'ok' }) }} data-testid="clm-csv">{Icon.download({ size: 12 })}</button>
          <button className="btn btn-sm" onClick={() => window.print()} data-testid="clm-print" title="Print / PDF this claim form">{Icon.print({ size: 12 })}</button>
        </div>
        <div className="cd-totals">
          <span>charges<b>{money(claim.charges)}</b></span>
          {claim.adj ? <span>adjustments<b className="neg">-{money(claim.adj)}</b></span> : null}
          {claim.status === 'paid' ? <span>paid<b className="pos">{money(claim.paid)}</b></span> : <span>due<b className={due > 0 ? 'due' : 'pos'}>{money(due)}</b></span>}
        </div>
      </header>

      <div className="hcfa">
        <div className="hbox"><i>1 · Billing provider</i><b>{org.name || 'Practice'}</b><p>{org.address} · {org.phone}<br />Tax ID {org.taxId} · NPI {npiOf('s12')}</p></div>
        <div className="hbox"><i>2 · Insured / patient</i><b>{client.name || '—'}</b><p>{client.program}{client.guardian ? ` · Guardian ${client.guardian}` : ''}<br />Member ID {memberIdOf({ id: client.id, insurer: claim.payer})}</p></div>
        <div className="hbox"><i>3 · Payer</i><b>{claim.mode === 'selfpay' ? 'Self-pay account' : claim.payer}</b><p>{claim.mode === 'selfpay' ? `Net ${settings.billing?.dueDays || 30} days` : `Policy ${claim.payer.split(' ').map((w) => w[0]).join('').toUpperCase()}${String(14000 + (client.id.charCodeAt(1) * 137) % 8999)}`}<br />Auth {authNoOf(client)} · {claim.mode === 'selfpay' ? 'family responsibility' : 'rendering NPI ' + npiOf(firstAppt?.staffIds?.[0])}</p></div>
        <div className="hbox"><i>4 · Referral / prior</i><b>BCBA plan of care</b><p>{staffOf('s1')?.name || 'Prateek Kiran'}, BCBA<br />{claim.parentNo ? `Prior claim ${claim.parentNo} (v${claim.version})` : 'No prior submission'}</p></div>
        <div className="hbox"><i>9 · Diagnosis</i><b>{dx.join(' · ')}</b><p>{dx.map((d) => <em key={d} className="dx-chip">{d}</em>)}</p></div>
        <div className="hbox"><i>6–7 · Service period</i><b>{claim.dosFrom} → {claim.dosTo}</b><p>{claim.lines.length} charge line{claim.lines.length > 1 ? 's' : ''} · {claim.units} units{claim.submittedAt ? ` · submitted ${isoDate(new Date(claim.submittedAt))}` : ' · not yet submitted'}</p></div>
        <div className="hbox"><i>32 · Facility</i><b>{facility}</b><p>{org.address} · signature on file (electronic)</p></div>
        <div className="hbox"><i>33a · Rendering</i><b>{[...new Set(claim.lines.map((l) => l.staff))].join(', ') || '—'}</b><p>NPI {npiOf(firstAppt?.staffIds?.[0])} · supervision {(staffOf('s1')?.name)} BCBA #5-12-0034</p></div>
      </div>

      <div className={`cd-banner ${claim.status === 'denied' ? 'danger' : claim.status === 'paid' ? 'ok' : gated ? 'warn' : 'info'}`} data-testid="clm-banner">
        {claim.status === 'denied' && <>{Icon.alert({ size: 13 })}<span><b>{claim.denial.reason}.</b> {claim.denial.fix}. {claim.denial.at ? `Denied ${relDay(claim.denial.at)}.` : ''} {claim.lines.length > disputed.size && disputed.size > 0 ? `${disputed.size} line(s) marked disputed — Rebill drops them to staging, keeps the rest.` : disputed.size ? 'Rebill will drop every marked line back to staging.' : 'Rebill re-drafts this claim for resubmission.'}</span></>}
        {claim.status === 'paid' && <>{Icon.checkCircle({ size: 13 })}<span><b>{money(claim.paid)}</b> via {claim.remittance?.checkNo || '—'} · deposited {relDay(claim.remittance?.at)}{claim.adj ? ` · ${money(claim.adj)} contractual adjustment` : ''}{shortPay ? ' — posting left a balance; re-review or bill the family.' : ''}</span></>}
        {claim.status === 'submitted' && <>{Icon.clock({ size: 13 })}<span>Waiting on {claim.mode === 'selfpay' ? 'family payment' : claim.payer}{age ? ` — ${age.days} days out, their median cycle is ${payerPolicy(claim.payer).avgDays} days` : ''}. Post the remittance when it lands.</span></>}
        {claim.status === 'draft' && gated ? <>{Icon.alert({ size: 13 })}<span><b>Submission held:</b> {gate.bad.map((b) => b.why).slice(0, 2).join(' · ')}. Fix on the source session (click the line below) or drop the line.</span></> : null}
        {claim.status === 'void' && <>{Icon.ban({ size: 13 })}<span>Voided — all {claim.lines.length} line(s) returned to staging for a fresh form.</span></>}
      </div>

      <table className="cd-lines" data-testid="clm-lines">
        <thead><tr>{editable && claim.status === 'denied' ? <th className="no-print" /> : null}<th>#</th><th>Date</th><th>Time</th><th>HCPCS</th><th>Description</th><th>ICD</th><th>Units</th><th>Rendered by</th><th className="r">Rate</th><th className="r">Charge</th><th className="no-print" /></tr></thead>
        <tbody>
          {claim.lines.map((l, i) => {
            const src = appts[l.apptId]
            const isBad = badIds.has(l.apptId)
            return (
              <tr key={l.apptId} className={`${isBad ? 'gated' : ''} ${disputed.has(l.apptId) ? 'disputed' : ''}`} data-testid={`clm-line-${i}`}>
                {editable && claim.status === 'denied' && (
                  <td className="no-print"><span className={`cb ${disputed.has(l.apptId) ? 'on' : ''}`} role="checkbox" aria-checked={disputed.has(l.apptId)} data-testid={`clm-dispute-${i}`} onClick={() => toggleDispute(l.apptId)}>{disputed.has(l.apptId) && Icon.check({ size: 9, strokeWidth: 3 })}</span></td>
                )}
                <td className="muted">{i + 1}</td>
                <td><b>{l.dos}</b><i>{fmtDayLabel(l.dos).split(' ')[0]}</i></td>
                <td>{l.kind === 'mileage' ? `${hhmm(l.t0)} trip` : `${hhmm(l.t0)}–${hhmm(l.t1)}`}</td>
                <td><span className="ln-code">{l.code}</span>{l.kind === 'mileage' ? <span className="ln-mod">MILEAGE</span> : null}{isBad ? <span className="ln-mod bad" title="Fails the validation gate">⚠ gate</span> : null}</td>
                <td className="cd-desc">{l.desc}</td>
                <td className="muted">{dx[i % dx.length]}</td>
                <td>{l.kind === 'mileage' ? `${l.units} mi` : l.units}</td>
                <td className="muted">{l.staff.split(', ')[0] || '—'}</td>
                <td className="r">${l.rate}</td>
                <td className="r money"><b>{money(l.charge)}</b></td>
                <td className="no-print cd-line-acts">
                  <button className="iconbtn" style={{ width: 22, height: 22 }} title="Open this session on the calendar" onClick={() => src && actions.setUI({ section: 'calendar', anchor: l.dos, openAppt: l.apptId })}>{Icon.chevronR({ size: 11 })}</button>
                  {claim.status === 'draft' && <button className="iconbtn danger" style={{ width: 22, height: 22 }} title="Remove line — back to staging" data-testid={`clm-drop-${i}`} onClick={() => onDropLine(l.apptId)}>{Icon.x({ size: 11 })}</button>}
                </td>
              </tr>
            )
          })}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={claim.status === 'denied' ? 9 : 8}>Total charges <b>{money(claim.charges)}</b>{copay ? <span className="muted"> · copay responsibility {money(copay)} ({claim.lines.length} × ${payerPolicy(claim.payer).copay})</span> : null}</td>
            <td className="r" />
            <td className="r">{claim.adj ? <span className="muted">net {money(claim.charges - claim.adj)} · </span> : null}<b className={due > 0 ? 'due' : 'pos'}>{due > 0 ? `due ${money(due)}` : 'settled'}</b></td>
            <td className="no-print" />
          </tr>
        </tfoot>
      </table>

      <div className="cd-side">
        <div className="cd-panel">
          <h4>{Icon.clock({ size: 12 })} Lifecycle <span className="muted">({claim.history.length})</span></h4>
          <ul className="clm-timeline" data-testid="clm-timeline">
            {[...claim.history].reverse().map((h, i) => (
              <li key={i} data-testid={`clm-ev-${i}`}><span className={`dot ${i === 0 ? 'now' : ''}`} /><p><b>{h.ev}</b><i>{relDay(h.at)}</i></p></li>
            ))}
          </ul>
        </div>
        <div className="cd-panel">
          <h4>{Icon.edit({ size: 12 })} Billing note</h4>
          <textarea className="input" rows={2} placeholder="Context for the next person on this claim…" value={noteDraft} onChange={(e) => setNoteDraft(e.target.value)} data-testid="clm-note" />
          {noteDraft !== (claim.note || '') && (
            <button className="btn btn-sm" style={{ marginTop: 6 }} data-testid="clm-note-save" onClick={() => { actions.addClaimNote(claim.id, noteDraft); toast({ message: 'Note saved to the claim', kind: 'ok' }) }}>Save note</button>
          )}
          {claim.remittance?.note ? <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>Remittance note: {claim.remittance.note}</div> : null}
        </div>
      </div>

      {payOpen ? <PayModal claim={claim} onClose={() => setPayOpen(false)} /> : null}
      {denyOpen ? <DenyModal claim={claim} onClose={() => setDenyOpen(false)} /> : null}
    </section>
  )
}

// ================= pay / deny modals =================
function PayModal({ claim, onClose }) {
  const state = useStore()
  const { actions, clients } = state
  const toast = useToast()
  const client = clients.find((c) => c.id === claim.clientId) || {}
  const posts = quickPosts(state, claim, client)
  const [amount, setAmount] = useState(claim.charges)
  const [adj, setAdj] = useState(0)
  const [check, setCheck] = useState(`CHK-${todayISO().slice(2, 7).replace('-', '')}-${String(claim.no).slice(-3)}`)
  const [note, setNote] = useState('')
  const due = claim.charges - Number(adj || 0) - Number(amount || 0)
  const post = () => {
    const r = actions.postPayment(claim.id, { amount: r2(Number(amount) || 0), adj: r2(Number(adj) || 0), checkNo: check.trim() || 'CHK', note: note.trim() })
    toast({ message: `${r.msg} — press U to undo`, kind: 'ok' })
    onClose()
  }
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <div className="modal" style={{ width: 'min(520px, 92vw)' }} data-testid="pay-modal">
        <div className="modal-head"><h2>Post payment — {claim.no}</h2><div className="f1" /><button className="modal-x" aria-label="Close" onClick={onClose}><Icon.x size={14} /></button></div>
        <div className="modal-body" style={{ padding: 16 }}>
          <div className="pm-quick" data-testid="pay-quick-row">
            {posts.map((p) => (
              <button key={p.id} className="q-chip" data-testid={`pay-quick-${p.id}`} onClick={() => { setAmount(p.amount); setAdj(p.adj || 0); setNote(p.note || '') }}>{p.label}</button>
            ))}
          </div>
          <div className="pm-grid">
            <label><span>Payment amount $</span><input className="input" type="number" step="0.01" value={amount} onChange={(e) => setAmount(Number(e.target.value))} data-testid="pay-amount" /></label>
            <label><span>Adjustment / write-off $</span><input className="input" type="number" step="0.01" value={adj} onChange={(e) => setAdj(Number(e.target.value))} data-testid="pay-adj" /></label>
            <label><span>Check / EFT ref</span><input className="input" value={check} onChange={(e) => setCheck(e.target.value)} data-testid="pay-check" /></label>
            <label><span>Posted on</span><input className="input" type="date" value={todayISO()} readOnly title="Demo posts as today" data-testid="pay-date" /></label>
          </div>
          <label className="pm-note"><span>Note on remittance</span><input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="optional" data-testid="pay-note" /></label>
          <div className={`pm-due ${Math.abs(due) < 0.5 ? 'ok' : 'warn'}`} data-testid="pay-due">
            {Math.abs(due) < 0.5 ? <>Balances to zero — claim will close as <b>paid</b> ({money(claim.charges)} charges − {money(adj || 0)} adjustments = {money(amount)}).</> : <>Posting leaves <b>{money(due)}</b> {due > 0 ? 'open — the claim stays flagged short-pay after posting' : 'overpaid'} — {money(claim.charges)} − {money(adj || 0)} − {money(amount)}.</>}
          </div>
        </div>
        <div className="modal-foot" style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', padding: '12px 16px', borderTop: '1px solid var(--line)' }}>
          <button className="btn btn-sm" onClick={onClose}>Cancel</button>
          <button className="btn btn-sm btn-primary" onClick={post} data-testid="pay-post">{Icon.check({ size: 12 })} Post {money(amount)}{adj ? ` · write off ${money(adj)}` : ''}</button>
        </div>
      </div>
    </div>
  )
}
const r2 = (n) => Math.round(n * 100) / 100

function DenyModal({ claim, onClose }) {
  const { actions } = useStore()
  const toast = useToast()
  const [code, setCode] = useState(DENIAL_REASONS[0].id)
  const [note, setNote] = useState('')
  const d = DENIAL_REASONS.find((x) => x.id === code)
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <div className="modal" style={{ width: 'min(460px, 92vw)' }} data-testid="deny-modal">
        <div className="modal-head"><h2>Record denial — {claim.no}</h2><div className="f1" /><button className="modal-x" aria-label="Close" onClick={onClose}><Icon.x size={14} /></button></div>
        <div className="modal-body" style={{ padding: 16 }}>
          <span className="fld-l">Payer denial code</span>
          <div className="dm-reasons">
            {DENIAL_REASONS.map((r) => (
              <button key={r.id} className={`dm-r ${code === r.id ? 'on' : ''}`} data-testid={`deny-r-${r.id}`} onClick={() => setCode(r.id)}><b>{r.label}</b><i>{r.fix}</i></button>
            ))}
          </div>
          <label className="pm-note" style={{ marginTop: 10 }}><span>Correspondence note</span><input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="letter/EOB reference…" data-testid="deny-note" /></label>
        </div>
        <div className="modal-foot" style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', padding: '12px 16px', borderTop: '1px solid var(--line)' }}>
          <button className="btn btn-sm" onClick={onClose}>Cancel</button>
          <button className="btn btn-sm btn-primary" data-testid="deny-go" onClick={() => { const r = actions.denyClaim(claim.id, { code, note }); toast({ message: `${r.msg} — U to undo`, kind: 'warn' }); onClose() }}>Mark {claim.no} denied</button>
        </div>
      </div>
    </div>
  )
}


