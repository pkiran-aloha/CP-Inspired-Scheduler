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
  secondaryEligible,
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

export default function BillingView({ initialTab }) {
  const state = useStore()
  const { ui, actions, settings, appts, claims, clients, staff } = state
  const toast = useToast()
  const [tab, setTab] = useState(initialTab || 'stage')
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
  const [payerPick, setPayerPick] = useState([])
  const [statusF, setStatusF] = useState('all')
  const [sort, setSort] = useState('recent')
  const [payOpen, setPayOpen] = useState(false)
  const [denyOpen, setDenyOpen] = useState(false)
  const [disputed, setDisputed] = useState(() => new Set())

  const preset = ui.bilPreset || 'last4'
  const range = useMemo(() => resolveRange(preset, ui.anchor, settings.weekStart), [preset, ui.anchor, settings.weekStart])
  const ctx = useMemo(() => ({ days: range.days, gran: 'week', buckets: [], scope: {} }), [range])
  const blocked = useMemo(() => runReport(state, 'blocked', ctx).rows, [state.appts, ctx])

  const stagedRaw = useMemo(() => stagedAppts(state, range.days), [state, range])
  const staged = useMemo(() => {
    if (!payerPick.length) return stagedRaw
    const clientById = Object.fromEntries((clients || []).map((c) => [c.id, c]))
    return stagedRaw.filter((a) => payerPick.includes(clientById[a.clientIds?.[0]]?.insurer || 'Self-pay'))
  }, [stagedRaw, payerPick, clients])
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

  const toggle = (id) => setPicked((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const generate = () => {
    const r = actions.generateClaims(picked.size ? [...picked] : null)
    toast({ message: `${r.msg} — press U to dissolve`, kind: r.ok ? 'ok' : 'warn' })
    if (r.ok) { setPicked(new Set()); setTab('claims'); setStatusF('all'); if (r.ids?.length) setSel(r.ids[0]) }
  }
  const processBilling = () => {
    const readyIds = Object.values(claims).filter((c) => c.status === 'draft').filter((c) => { const g = claimGate(state, c); return g.ok }).map((c) => c.id)
    if (!readyIds.length) { toast({ message: 'No gate-clean drafts to process — fix gated drafts first', kind: 'warn' }); return }
    const r = actions.submitClaims(readyIds)
    if (r.ok && r.sent?.length) {
      const submittedClaims = readyIds.map((id) => claims[id] || state.claims[id]).filter(Boolean)
      const fileName = `837P-${todayISO()}-${String(Object.keys(state.billedFiles || {}).length + 1).padStart(3, '.0')}.txt`
      const content = submittedClaims.map((c) => `${c.no}|${c.payer}|${c.charges}`).join('\n')
      actions.record('billedFiles', { id: `bf-${Date.now().toString(36)}`, fileName, payer: submittedClaims[0]?.payer || 'Mixed', clientCount: new Set(submittedClaims.map((c) => c.clientId)).size, claimCount: submittedClaims.length, claimIds: submittedClaims.map((c) => c.id), date: todayISO(), sendCount: 1, content, createdAt: Date.now() })
    }
    toast({ message: `${r.msg} — billed file generated`, kind: r.ok ? 'ok' : 'warn' })
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
    toast({ message: `Units auto-filled (${units} × ${code.id}) — re-run batch`, kind: 'ok' })
  }

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

  const TabBtn = ({ id, label, n, warn }) => (
    <button className={`tab ${tab === id ? 'on' : ''}`} data-testid={`bil-tab-${id}`} onClick={() => setTab(id)} style={{ position: 'relative' }}>
      {label}{n > 0 && <span className={`pill ${warn ? 'warn' : ''}`} style={{ marginLeft: 6, background: warn ? '#fee2e2' : 'var(--panel-2)', border: '1px solid var(--line)', borderRadius: 10, padding: '1px 6px', fontSize: 11 }}>{n}</span>}
    </button>
  )

  return (
    <div className="sectionpage">
      <SectionBar icon="dollar" title="Billing" sub={`Claims lifecycle — stage → form → submit → pay · ${range.label}`}>
        <RangePicker preset={preset} onPreset={(p) => actions.setUI({ bilPreset: p })} onSlide={(d) => actions.setUI({ anchor: isoDate(addDays(parseISO(ui.anchor), d * range.days.length)) })} label={range.label} />
        {tab === 'stage' && (
          <>
            <div className="viewseg" style={{ marginRight: 8 }} data-testid="bil-payer-pick">
              {['Blue Shield CA', 'Aetna', 'Regence BCBS', 'UnitedHealthcare', 'Medicaid (CA)', 'Self-pay'].map((p) => {
                const on = payerPick.includes(p)
                return <button key={p} className={on ? 'on' : ''} data-testid={`bil-payer-${p.replace(/[^A-Za-z]/g, '')}`} onClick={() => setPayerPick((cur) => cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p])}>{p.split(' ')[0]}</button>
              })}
              {payerPick.length > 0 && <button className="btn-ghost" data-testid="bil-payer-clear" onClick={() => setPayerPick([])}>Clear</button>}
            </div>
            <button className="btn btn-sm" onClick={exportStageCsv} data-testid="bil-export">{Icon.download({ size: 13 })} Export staging</button>
            <button className="btn btn-sm btn-primary" disabled={!staged.length} onClick={generate} data-testid="bil-generate">{Icon.file({ size: 12 })} Assemble {picked.size || staged.length} → {picked.size ? 'claims' : `${plans.length} forms`}</button>
            <button className="btn btn-sm" data-testid="bil-process" onClick={processBilling} title="Submit all gate-clean drafts + generate billed file">{Icon.zap({ size: 12 })} Process Billing</button>
          </>
        )}
        {tab === 'claims' && (
          <>
            <button className="btn btn-sm" onClick={() => {
              const ins = list.filter((c) => c.status !== 'void')
              if (!ins.length) { toast({ message: 'No claims in view to export', kind: 'warn' }); return }
              try { claimsTo1500(state, ins).save(`CMS-1500-batch-${todayISO()}.pdf`) } catch (e) { }
              toast({ message: `CMS-1500 batch — ${ins.length} claims onto one print-ready PDF`, kind: 'ok' })
            }} data-testid="bil-cms1500-batch" title="One multi-page CMS-1500 PDF">{Icon.print({ size: 13 })} CMS-1500 batch</button>
            <button className="btn btn-sm" onClick={() => { download(`${(bill.claimPrefix || 'CLM')}-ledger.csv`, claimsCsv(state, list)); toast({ message: `${list.length} claims exported`, kind: 'ok' }) }} data-testid="bil-csv-all">{Icon.download({ size: 13 })} Ledger CSV</button>
            <button className="btn btn-sm btn-primary" disabled={!stats.drafts.n} onClick={submitAllDrafts} data-testid="bil-submit-all">{Icon.check({ size: 12 })} Submit ready ({Object.keys(claims).filter((id) => claims[id].status === 'draft' && !gatedIds[id]).length})</button>
          </>
        )}
      </SectionBar>

      <div className="batch-strip" data-testid="bil-kpis" style={{ padding: '10px 16px', gap: 8, flexWrap: 'wrap' }}>
        <button className={`rp-sumchip ${tab === 'stage' ? 'on' : ''}`} data-testid="bil-kpi-staged" onClick={() => setTab('stage')} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 10, border: '1px solid var(--line)', background: tab === 'stage' ? 'var(--panel-2)' : 'var(--panel)', cursor: 'pointer' }}>
          <span style={{ width: 28, height: 28, borderRadius: 8, background: '#6366f1', color: '#fff', display: 'grid', placeItems: 'center' }}>{Icon.file({ size: 12 })}</span>
          <span style={{ textAlign: 'left' }}><b style={{ display: 'block', fontSize: 13 }}>{money(stagedTotal)}</b><span className="muted" style={{ fontSize: 10 }}>{staged.length} staging lines</span></span>
        </button>
        <button className={`rp-sumchip ${Object.keys(gatedIds).length ? 'warn' : ''}`} data-testid="bil-kpi-draft" onClick={() => { setTab('claims'); setStatusF('draft') }} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 10, border: `1px solid ${Object.keys(gatedIds).length ? '#fca5a5' : 'var(--line)'}`, background: Object.keys(gatedIds).length ? '#fef2f2' : 'var(--panel)', cursor: 'pointer' }}>
          <span style={{ width: 28, height: 28, borderRadius: 8, background: Object.keys(gatedIds).length ? '#ef4444' : '#e5e7eb', color: Object.keys(gatedIds).length ? '#fff' : '#374151', display: 'grid', placeItems: 'center' }}>{Icon.edit({ size: 12 })}</span>
          <span style={{ textAlign: 'left' }}><b style={{ display: 'block', fontSize: 13 }}>{stats.drafts.n} Drafts</b><span className="muted" style={{ fontSize: 10 }}>{stats.drafts.n ? `${money(stats.drafts.$)} · ${Object.keys(gatedIds).length ? `${Object.keys(gatedIds).length} gated` : 'ready'}` : 'nothing pending'}</span></span>
        </button>
        <button className={`rp-sumchip ${stats.pending.late ? 'warn' : ''}`} data-testid="bil-kpi-pending" onClick={() => { setTab('claims'); setStatusF('submitted') }} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 10, border: `1px solid ${stats.pending.late ? '#fde68a' : 'var(--line)'}`, background: stats.pending.late ? '#fffbeb' : 'var(--panel)', cursor: 'pointer' }}>
          <span style={{ width: 28, height: 28, borderRadius: 8, background: '#f59e0b', color: '#fff', display: 'grid', placeItems: 'center' }}>{Icon.clock({ size: 12 })}</span>
          <span style={{ textAlign: 'left' }}><b style={{ display: 'block', fontSize: 13 }}>{money(stats.pending.$)} Awaiting</b><span className="muted" style={{ fontSize: 10 }}>{stats.pending.n} out{stats.pending.late ? ` · ${stats.pending.late} past cycle` : ''}</span></span>
        </button>
        <button className={`rp-sumchip ${stats.denied.n ? 'warn' : ''}`} data-testid="bil-kpi-denied" onClick={() => { setTab('claims'); setStatusF('denied') }} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 10, border: `1px solid ${stats.denied.n ? '#fca5a5' : 'var(--line)'}`, background: stats.denied.n ? '#fef2f2' : 'var(--panel)', cursor: 'pointer' }}>
          <span style={{ width: 28, height: 28, borderRadius: 8, background: stats.denied.n ? '#ef4444' : '#e5e7eb', color: stats.denied.n ? '#fff' : '#374151', display: 'grid', placeItems: 'center' }}>{Icon.ban({ size: 12 })}</span>
          <span style={{ textAlign: 'left' }}><b style={{ display: 'block', fontSize: 13 }}>{stats.denied.n} Denied</b><span className="muted" style={{ fontSize: 10 }}>{stats.denied.n ? `${money(stats.denied.$)} needs action` : 'none open'}</span></span>
        </button>
        <button className="rp-sumchip" data-testid="bil-kpi-paid" onClick={() => { setTab('claims'); setStatusF('paid') }} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 10, border: '1px solid var(--line)', background: 'var(--panel)', cursor: 'pointer' }}>
          <span style={{ width: 28, height: 28, borderRadius: 8, background: '#10b981', color: '#fff', display: 'grid', placeItems: 'center' }}>{Icon.dollar({ size: 12 })}</span>
          <span style={{ textAlign: 'left' }}><b style={{ display: 'block', fontSize: 13 }}>{money(stats.paid.$)} Paid</b><span className="muted" style={{ fontSize: 10 }}>{stats.paid.n} remittances · {stats.denialRate}% denial</span></span>
        </button>
        <span className="rp-sumchip" data-testid="bil-kpi-cycle" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 10, border: '1px solid var(--line)', background: 'var(--panel)' }}>
          <span style={{ width: 28, height: 28, borderRadius: 8, background: '#e5e7eb', color: '#374151', display: 'grid', placeItems: 'center' }}>{Icon.cal({ size: 12 })}</span>
          <span style={{ textAlign: 'left' }}><b style={{ display: 'block', fontSize: 13 }}>{stats.avgDaysToPay ?? '—'} avg days</b><span className="muted" style={{ fontSize: 10 }}>{stats.avgDaysToPay ? 'to pay' : 'no history yet'}</span></span>
        </span>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          {['0–30', '31–60', '61–90', '90+'].map((b) => (
            <span key={b} className={`rp-sumchip ${stats.pending.buckets[b] ? 'on' : ''}`} style={{ padding: '6px 10px', opacity: stats.pending.buckets[b] ? 1 : 0.45, borderRadius: 8, border: '1px solid var(--line)', background: stats.pending.buckets[b] ? 'var(--panel-2)' : 'var(--panel)', fontSize: 11 }}>
              <b>{money(stats.pending.buckets[b] || 0)}</b><span className="muted"> A/R {b}</span>
            </span>
          ))}
        </span>
      </div>

      <div className="batch-strip" style={{ padding: '8px 16px', alignItems: 'center', gap: 8 }}>
        <div className="viewseg">
          <TabBtn id="stage" label="Staging" n={staged.length} />
          <TabBtn id="claims" label="Claim desk" n={openCount} warn={stats.denied.n > 0} />
          <TabBtn id="secondary" label="Secondary" n={Object.values(claims).filter((c) => secondaryEligible(state, c)).length} />
          <TabBtn id="blocked" label="Blocked" n={blocked.length} warn />
          <TabBtn id="setup" label="Setup" />
        </div>
        <span style={{ width: 1, height: 20, background: 'var(--line)' }} />
        <span className="muted" style={{ fontSize: 11 }}>held back <b style={{ color: 'var(--danger)' }}>{money(blocked.reduce((t, r) => t + r.estCharge, 0))}</b></span>
      </div>

      {tab === 'stage' && (
        <div style={{ padding: 16, display: 'grid', gridTemplateColumns: '1fr 360px', gap: 16, alignItems: 'start' }}>
          <div className="panel" style={{ borderRadius: 12, overflow: 'hidden', boxShadow: 'var(--shadow-1)' }}>
            <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--line)', display: 'flex', gap: 10, alignItems: 'center', background: 'var(--panel-2)' }}>
              <span style={{ width: 24, height: 24, borderRadius: 6, background: '#6366f1', color: '#fff', display: 'grid', placeItems: 'center' }}>{Icon.file({ size: 11 })}</span>
              <span style={{ fontSize: 12 }}><b>Staging</b><span className="muted" style={{ marginLeft: 6 }}>{picked.size ? `${picked.size} selected` : `${staged.length} lines · group by client × payer × month`}</span></span>
              <div style={{ marginLeft: 'auto' }}>
                <button className="btn btn-xs" data-testid="bil-pickall" onClick={() => setPicked(picked.size === staged.length ? new Set() : new Set(staged.map((a) => a.id)))}>{picked.size === staged.length ? 'Clear' : `Select all (${staged.length})`}</button>
              </div>
            </div>
            <div className="py-tbl" style={{ maxHeight: 620, overflow: 'auto' }}>
              <div className="py-thead" style={{ gridTemplateColumns: '32px 80px 1fr 1fr 70px 90px 80px 80px 80px 32px 32px', background: 'var(--panel-2)', fontSize: 11, position: 'sticky', top: 0, zIndex: 1 }}>
                <span></span><span>Date</span><span>Client</span><span>Payer</span><span>Code</span><span>Units</span><span>Provider</span><span>Filing</span><span>Charge</span><span></span><span></span>
              </div>
              {staged.map((a, i) => {
                const c = clientOf(a.clientIds?.[0])
                const prov = (settings.providers || []).find((p) => p.kind === 'staff' && p.refId === a.staffIds?.[0])
                const timely = (() => { const pol = payerPolicy(c.insurer || 'Self-pay'); const filing = (state.payers || []).find((pp) => pp.name === (c.insurer || ''))?.ext?.filingDeadlineDays ?? bill.defaultFilingDays ?? pol.timely ?? 90; const due = isoDate(new Date(new Date(a.date).getTime() + filing * 86400000)); const today = todayISO(); const daysLeft = Math.round((new Date(due) - new Date(today)) / 86400000); return { due, daysLeft, amber: daysLeft <= 21 && daysLeft >= 0, over: daysLeft < 0 } })()
                return (
                  <div className="py-trow" key={a.id} data-testid={`bil-row-${i}`} style={{ gridTemplateColumns: '32px 80px 1fr 1fr 70px 90px 80px 80px 80px 32px 32px', fontSize: 11 }}>
                    <div className="py-cell"><span className={`cb ${picked.has(a.id) ? 'on' : ''}`} onClick={() => toggle(a.id)} role="checkbox" aria-checked={picked.has(a.id)} data-testid={`bil-pick-${i}`} style={{ width: 18, height: 18, borderRadius: 5, border: '1px solid var(--line)', display: 'grid', placeItems: 'center', cursor: 'pointer', background: picked.has(a.id) ? 'var(--accent)' : 'var(--panel)', color: '#fff' }}>{picked.has(a.id) && Icon.check({ size: 10, strokeWidth: 3 })}</span></div>
                    <div className="py-cell"><b>{fmtDayLabel(a.date)}</b></div>
                    <div className="py-idcell"><b style={{ fontSize: 11 }}>{c.name || '—'}</b></div>
                    <div className="py-cell muted" style={{ fontSize: 11 }}>{c.insurer || 'Self-pay'}</div>
                    <div className="py-cell"><span className="ln-code" style={{ fontSize: 10 }}>{a.billing?.mileage && !a.billing?.units ? '14220' : a.billing?.code || '—'}</span></div>
                    <div className="py-cell muted" style={{ fontSize: 11 }}>{a.billing?.mileage && !a.billing?.units ? `${a.billing?.distance} mi` : `${a.billing?.units}u × $${a.billing?.rate}`}</div>
                    <div className="py-cell muted" style={{ fontSize: 10 }} title={prov?.npi || 'No NPI'}>{prov?.name?.split(' ')[0] || a.staffIds?.[0] || '—'}<i style={{ display: 'block', fontSize: 9 }}>{prov?.npi ? `NPI …${prov.npi.slice(-4)}` : 'no NPI'}</i></div>
                    <div className={`py-cell muted ${timely.amber ? 'warn' : ''} ${timely.over ? 'danger' : ''}`} style={{ fontSize: 10, color: timely.over ? '#ef4444' : timely.amber ? '#f59e0b' : undefined }} title={`Filing due ${timely.due}`}>{timely.over ? `overdue ${-timely.daysLeft}d` : timely.amber ? `file in ${timely.daysLeft}d` : `${timely.daysLeft}d`}</div>
                    <div className="py-cell num"><b>{money(computeBilling(a))}</b></div>
                    <div className="py-cell"><button className="iconbtn" style={{ width: 24, height: 24, borderRadius: 6 }} title="Open source appointment" onClick={() => actions.setUI({ section: 'calendar', anchor: a.date, openAppt: a.id })}>{Icon.chevronR({ size: 12 })}</button></div>
                    <div className="py-cell"><button className="iconbtn" style={{ width: 24, height: 24, borderRadius: 6 }} title={prov ? `Open ${prov.name} in Provider Identifier` : 'No provider'} data-testid={`bil-npi-${i}`} onClick={() => { if (prov) actions.setUI({ section: 'bil-providers' }) }}>{Icon.badge({ size: 11 })}</button></div>
                  </div>
                )
              })}
              {!staged.length && <div className="py-empty" style={{ padding: 32, textAlign: 'center' }}><b>{blocked.length ? `Nothing claim-ready — ${blocked.length} blocked line(s) need fixes` : 'Everything in this window is on a claim or paid'}</b><div className="muted" style={{ fontSize: 11, marginTop: 4 }}>Slide the range or check the desk.</div></div>}
            </div>
          </div>
          <div className="panel" style={{ borderRadius: 12, overflow: 'hidden', boxShadow: 'var(--shadow-1)', position: 'sticky', top: 16 }}>
            <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--line)', background: 'var(--panel-2)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 24, height: 24, borderRadius: 6, background: '#10b981', color: '#fff', display: 'grid', placeItems: 'center' }}>{Icon.file({ size: 11 })}</span>
              <b style={{ fontSize: 12 }}>Claim forms preview</b><span className="muted" style={{ fontSize: 11 }}>({picked.size ? 'selection' : 'all staging'})</span>
            </div>
            <div style={{ padding: 8 }}>
              {plans.slice(0, 8).map((p, i) => (
                <div key={`${p.clientId}-${i}`} data-testid={`asm-row-${i}`} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--line)', marginBottom: 6, background: 'var(--panel)' }}>
                  <PersonAvatar p={clientOf(p.clientId)} size={28} />
                  <span style={{ minWidth: 0, flex: 1 }}><b style={{ fontSize: 11, display: 'block' }}>{p.client}</b><i style={{ fontSize: 10, color: 'var(--muted)', fontStyle: 'normal' }}>{p.mode === 'selfpay' ? 'Self-pay' : p.payer} · {p.dosFrom === p.dosTo ? p.dosTo : `${p.dosFrom.slice(5)} → ${p.dosTo.slice(5)}`}</i></span>
                  <span style={{ fontSize: 10, textAlign: 'right' }}>{p.appts.length} ln · {p.units}u<br /><b className="money">{money(p.charges)}</b></span>
                </div>
              ))}
              {plans.length > 8 && <div className="muted" style={{ fontSize: 11, padding: '4px 10px' }}>+{plans.length - 8} more forms…</div>}
              {!!plans.length && (
                <button className="btn btn-sm btn-primary" style={{ width: '100%', marginTop: 8, borderRadius: 8 }} onClick={generate} data-testid="asm-generate">
                  {Icon.zap({ size: 12 })} Assemble {plans.length} form{plans.length > 1 ? 's' : ''} · {money(plans.reduce((t, p) => t + p.charges, 0))}
                </button>
              )}
              {!plans.length && <div className="py-empty" style={{ padding: 20, textAlign: 'center', fontSize: 12 }}><b>Import-ready lines appear here as you select staging rows.</b></div>}
            </div>
            <div className="muted" style={{ fontSize: 10.5, padding: '8px 12px', borderTop: '1px dashed var(--line)', lineHeight: 1.4 }}>
              Numbers mint from the {bill.claimPrefix || 'CLM'} sequence; charge lines keep CPT, units, rate & rendering staff.
            </div>
          </div>
        </div>
      )}

      {tab === 'claims' && (
        <div style={{ padding: 16, display: 'grid', gridTemplateColumns: '360px 1fr', gap: 16, alignItems: 'start' }}>
          <div className="panel" style={{ borderRadius: 12, overflow: 'hidden', boxShadow: 'var(--shadow-1)' }}>
            <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--line)', display: 'flex', gap: 8, alignItems: 'center', background: 'var(--panel-2)' }}>
              <span className="sb-search" style={{ flex: 1, minWidth: 0 }}>
                <span className="sic">{Icon.search({ size: 11 })}</span>
                <input placeholder="Search claim no, client, payer…" value={q} onChange={(e) => setQ(e.target.value)} data-testid="clm-search" style={{ fontSize: 12 }} />
              </span>
              <select className="input" style={{ width: 90, height: 30, borderRadius: 8, fontSize: 11 }} value={sort} onChange={(e) => setSort(e.target.value)} data-testid="clm-sort" aria-label="Sort claims">
                <option value="recent">Recent</option><option value="$">Value ↓</option><option value="aging">Oldest pending</option>
              </select>
            </div>
            <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--line)', display: 'flex', gap: 6, flexWrap: 'wrap' }} role="tablist" aria-label="Claim status">
              {[['all', 'All'], ['draft', 'Draft'], ['submitted', 'Submitted'], ['denied', 'Denied'], ['paid', 'Paid'], ['void', 'Void']].map(([f, l]) => {
                const n = f === 'all' ? allClaims.length : allClaims.filter((c) => c.status === f).length
                return <button key={f} className={`sf-chip ${statusF === f ? 'on' : ''}`} data-testid={`clm-filter-${f}`} onClick={() => setStatusF(f)} style={{ borderRadius: 20, padding: '4px 10px', fontSize: 11, border: `1px solid ${statusF === f ? 'var(--accent)' : 'var(--line)'}`, background: statusF === f ? 'var(--accent)' : 'var(--panel)', color: statusF === f ? '#fff' : 'var(--text)', display: 'flex', gap: 6, alignItems: 'center' }}>{l}<span style={{ background: statusF === f ? 'rgba(255,255,255,.2)' : 'var(--panel-2)', borderRadius: 10, padding: '0 5px', fontSize: 10 }}>{n}</span></button>
              })}
            </div>
            <div style={{ maxHeight: 700, overflow: 'auto' }}>
              {list.map((c, i) => {
                const cl = clientOf(c.clientId)
                const age = agingOf(c)
                const isSel = claim?.id === c.id
                return (
                  <button key={c.id} className={`clm-card ${isSel ? 'on' : ''}`} data-testid={`clm-row-${i}`} onClick={() => { setSel(c.id); setDisputed(new Set()) }} style={{ width: '100%', textAlign: 'left', padding: '10px 12px', border: 'none', borderBottom: '1px solid var(--line)', background: isSel ? 'var(--panel-2)' : 'var(--panel)', cursor: 'pointer', display: 'block' }}>
                    <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}><b style={{ fontSize: 11 }}>{c.no}</b><StatusChip s={c.status} />{gatedIds[c.id] ? <span className="tag warn" style={{ fontSize: 9 }} title={`${gatedIds[c.id]} line(s) fail gates`}>⚠ {gatedIds[c.id]}</span> : null}</span>
                    <span style={{ display: 'block', fontSize: 11, marginTop: 4 }}>{cl.name || '—'} <i style={{ color: 'var(--muted)', fontStyle: 'normal' }}>{c.mode === 'selfpay' ? 'family invoice' : c.payer}</i></span>
                    <span style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, marginTop: 4, color: 'var(--muted)' }}>{c.dosFrom.slice(5)} → {c.dosTo.slice(5)} · {c.lines.length} ln<span style={{ color: dueOf(c) > 0 ? '#ef4444' : '#10b981', fontWeight: 700 }}>{money(dueOf(c))}</span>{age ? <em style={{ color: age.late ? '#ef4444' : undefined, fontStyle: 'normal' }}>{age.days}d out</em> : null}</span>
                  </button>
                )
              })}
              {!list.length && <div className="py-empty" style={{ padding: 32, textAlign: 'center' }}><b>No claims match{q ? ' that search' : ''}</b><div className="muted" style={{ fontSize: 11, marginTop: 4 }}>Assemble some from Staging, or clear filter.</div></div>}
            </div>
          </div>

          {claim ? <ClaimForm claim={claim} gated={gatedIds[claim.id]} disputed={disputed} setDisputed={setDisputed} payOpen={payOpen} setPayOpen={setPayOpen} denyOpen={denyOpen} setDenyOpen={setDenyOpen} onSubmit={() => submit(claim.id)} onVoid={() => voidClaim(claim.id)} onRebill={() => rebill(claim.id)} onWriteOff={() => writeOff(claim.id)} onDropLine={(aid) => dropLine(claim.id, aid)} clientOf={clientOf} staffOf={staffOf} /> : (
            <div className="panel" style={{ borderRadius: 12, padding: 40, textAlign: 'center' }}><div style={{ fontSize: 32, marginBottom: 12 }}>💲</div><h3>The desk is empty</h3><p className="muted" style={{ fontSize: 12 }}>Assemble staging lines into claim forms and they'll queue here.</p><button className="btn btn-sm btn-primary" onClick={() => setTab('stage')} style={{ marginTop: 12 }}>Go to staging</button></div>
          )}
        </div>
      )}

      {tab === 'secondary' && (
        <div style={{ padding: 16 }}>
          <div className="panel" data-testid="bil-secondary" style={{ borderRadius: 12, overflow: 'hidden', boxShadow: 'var(--shadow-1)' }}>
            <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 10, background: 'var(--panel-2)' }}>
              <span style={{ width: 28, height: 28, borderRadius: 8, background: '#6366f1', color: '#fff', display: 'grid', placeItems: 'center' }}>{Icon.shield({ size: 13 })}</span>
              <div><b style={{ fontSize: 13 }}>Secondary queue</b><div className="muted" style={{ fontSize: 11 }}>clients with secondary + partially-paid claims ready to file</div></div>
              <span className="muted" style={{ marginLeft: 'auto', fontSize: 11 }}>{(state.clients || []).filter((c) => c.secondary).length} clients have secondary · {Object.values(claims).filter((c) => secondaryEligible(state, c)).length} eligible</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, padding: 16 }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}><b style={{ fontSize: 12 }}>COB clients</b><span className="tag soft" style={{ fontSize: 10 }}>{(state.clients || []).filter((c) => c.secondary).length}</span></div>
                <div className="sec-clients-render" data-testid="sec-clients-render" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {(state.clients || []).filter((c) => c.secondary).map((c) => {
                    const sec = c.secondary; const payer = (state.payers || []).find((p) => p.id === sec.payerId)
                    return (
                      <div key={c.id} data-testid={`sec-client-${c.id}`} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '8px 12px', borderRadius: 10, border: '1px solid var(--line)', background: 'var(--panel)' }}>
                        <PersonAvatar p={c} size={28} />
                        <span style={{ minWidth: 0, flex: 1 }}><b style={{ fontSize: 11 }}>{c.name}</b><i style={{ display: 'block', fontSize: 10, color: 'var(--muted)', fontStyle: 'normal' }}>{c.insurer} → {payer?.name || sec.payerId}</i></span>
                        <span className="ln-code" style={{ fontSize: 10 }}>{sec.memberId || '—'}</span>
                        <span className="tag soft" style={{ fontSize: 10 }}>{sec.relation}</span>
                      </div>
                    )
                  })}
                  {!(state.clients || []).some((c) => c.secondary) && <div className="py-empty" style={{ padding: 20, textAlign: 'center', fontSize: 12 }}><b>No secondary clients</b><div className="muted">Add from Clients directory</div></div>}
                </div>
              </div>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}><b style={{ fontSize: 12 }}>Eligible claims</b><span className="tag soft" style={{ fontSize: 10 }}>{Object.values(claims).filter((c) => secondaryEligible(state, c)).length} ready</span></div>
                <div data-testid="sec-claims" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {Object.values(claims).filter((c) => secondaryEligible(state, c)).map((c) => {
                    const cl = clientOf(c.clientId)
                    const secClient = (state.clients || []).find((x) => x.id === c.clientId)
                    const secPayerName = secClient?.secondary ? (state.payers || []).find((p) => p.id === secClient.secondary.payerId)?.name || secClient.secondary.payerId : '—'
                    return (
                      <div key={c.id} data-testid={`sec-claim-${c.id}`} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '8px 12px', borderRadius: 10, border: '1px solid var(--line)', background: 'var(--panel)' }}>
                        <b style={{ fontSize: 11 }}>{c.no}</b><span style={{ fontSize: 11 }}>{cl.name || '—'}</span><span className="muted" style={{ fontSize: 10, flex: 1 }}>{c.payer} → {secPayerName}</span><span className="r money" style={{ fontSize: 11, fontWeight: 700 }}>{money(dueOf(c))} due</span><button className="btn btn-xs btn-primary" data-testid={`sec-file-${c.id}`} onClick={() => { const r = actions.fileSecondaryClaim(c.id); toast({ message: r.msg, kind: r.ok ? 'ok' : 'warn' }); if (r.ok && r.newId) { setTab('claims'); setSel(r.newId) } }}>{Icon.file({ size: 11 })} File secondary</button>
                      </div>
                    )
                  })}
                  {!Object.values(claims).filter((c) => secondaryEligible(state, c)).length && <div className="py-empty" style={{ padding: 20, textAlign: 'center', fontSize: 12 }}><b>No claims need secondary filing</b><div className="muted">Partially-paid claims with client secondary appear here</div></div>}
                </div>
              </div>
            </div>
            <div className="muted" style={{ fontSize: 11, padding: '10px 16px', borderTop: '1px dashed var(--line)', background: 'var(--panel-2)' }}>
              Secondary claims inherit primary's charge lines, set method=secondary, and link back via secondary field.
            </div>
          </div>
        </div>
      )}

      {tab === 'blocked' && (
        <div style={{ padding: 16 }}>
          <div className="panel" style={{ borderRadius: 12, overflow: 'hidden', boxShadow: 'var(--shadow-1)' }}>
            <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 8, background: 'var(--panel-2)' }}>
              <span style={{ width: 24, height: 24, borderRadius: 6, background: '#ef4444', color: '#fff', display: 'grid', placeItems: 'center' }}>{Icon.ban({ size: 12 })}</span>
              <b style={{ fontSize: 12 }}>Blocked lines — {blocked.length}</b><span className="muted" style={{ fontSize: 11 }}>held back · {money(blocked.reduce((t, r) => t + r.estCharge, 0))} total</span>
            </div>
            <div className="py-tbl">
              <div className="py-thead" style={{ gridTemplateColumns: '70px 90px 1.2fr 2fr 100px 90px 70px', background: 'var(--panel-2)', fontSize: 11 }}><span>Type</span><span>Date</span><span>Client</span><span>Issue</span><span>Est. Charge</span><span>Fix</span><span></span></div>
              {blocked.map((r, i) => (
                <div key={i} data-testid={`blk-row-${i}`} className="py-trow" style={{ gridTemplateColumns: '70px 90px 1.2fr 2fr 100px 90px 70px', fontSize: 11 }}>
                  <div className="py-cell"><span className={`sev-pill ${/0 billable|no billing/i.test(r.issues) ? 'sev-error' : ''}`} style={{ fontSize: 10, padding: '2px 6px', borderRadius: 6, background: /0 billable|no billing/i.test(r.issues) ? '#fee2e2' : '#fef3c7' }}>{/0 billable|no billing/i.test(r.issues) ? 'billing' : 'gate'}</span></div>
                  <div className="py-cell"><b>{fmtDayLabel(r.date)}</b></div>
                  <div className="py-cell">{r.client}</div>
                  <div className="py-cell muted" style={{ fontSize: 11 }}>{r.issues}</div>
                  <div className="py-cell num" style={{ color: '#ef4444', fontWeight: 700 }}>{money(r.estCharge)}</div>
                  <div className="py-cell">{/billable units|rate is \$0|no billing/i.test(r.issues) && bill.autoUnits !== false && <button className="btn btn-xs" data-testid={`blk-fix-${i}`} onClick={() => autoFix(r._link.id)} title="Compute units">{Icon.zap({ size: 11 })} Auto-fix</button>}</div>
                  <div className="py-cell"><button className="btn btn-xs btn-ghost" onClick={() => actions.setUI({ section: 'calendar', anchor: r.date, openAppt: r._link.id })}>Open</button></div>
                </div>
              ))}
              {!blocked.length && <div className="py-empty" style={{ padding: 32, textAlign: 'center' }}><div style={{ fontSize: 24, marginBottom: 8 }}>✓</div><b>No blocked lines in this window</b></div>}
            </div>
          </div>
        </div>
      )}

      {tab === 'setup' && (
        <div style={{ padding: 16, display: 'grid', gridTemplateColumns: '380px 1fr', gap: 16, alignItems: 'start' }}>
          <div className="panel" style={{ borderRadius: 12, padding: 16, boxShadow: 'var(--shadow-1)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <span style={{ width: 28, height: 28, borderRadius: 8, background: '#6366f1', color: '#fff', display: 'grid', placeItems: 'center' }}>{Icon.pin({ size: 12 })}</span>
              <b style={{ fontSize: 13 }}>Practice identity</b>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {[['name', 'Practice name'], ['taxId', 'Tax ID'], ['npi', 'Facility / billing NPI'], ['address', 'Address'], ['phone', 'Phone']].map(([k, l]) => (
                <label key={k} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}><span style={{ fontSize: 11, fontWeight: 600 }} className="muted">{l}</span><input className="input" style={{ borderRadius: 8, height: 34 }} data-testid={`bi-${k}`} value={settings.org?.[k] || ''} onChange={(e) => setOrg({ [k]: e.target.value })} /></label>
              ))}
            </div>
            <div className="panel" style={{ marginTop: 12, padding: 10, borderRadius: 8, background: 'var(--panel-2)', border: '1px dashed var(--line)', fontSize: 11, lineHeight: 1.4 }}>
              <b>CMS-1500 (02/12)</b> PDFs map boxes 1–33 from this identity + client demographics. Clearinghouses expect electronic twin — <b>ANSI 837P</b> — built from same fields.
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div className="panel" style={{ borderRadius: 12, padding: 16, boxShadow: 'var(--shadow-1)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <span style={{ width: 28, height: 28, borderRadius: 8, background: '#10b981', color: '#fff', display: 'grid', placeItems: 'center' }}>{Icon.dollar({ size: 12 })}</span>
                <b style={{ fontSize: 13 }}>Rate & numbering policy</b>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
                {[['defaultRate', 'Default unit rate $'], ['mileageRate', 'Mileage $/mi'], ['invoicePrefix', 'Invoice prefix', true], ['dueDays', 'Net terms (days)']].map(([k, l, text]) => (
                  <label key={k} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}><span style={{ fontSize: 11, fontWeight: 600 }} className="muted">{l}</span><input className="input" style={{ borderRadius: 8, height: 34 }} data-testid={`bi-${k}`} type={text ? 'text' : 'number'} step={k === 'mileageRate' ? 0.05 : 1} value={k === 'invoicePrefix' ? bill.invoicePrefix || '' : settings[k]} onChange={(e) => (k === 'invoicePrefix' ? setBill({ invoicePrefix: e.target.value }) : actions.setSettings({ [k]: Number(e.target.value) || 0 }))} /></label>
                ))}
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}><span style={{ fontSize: 11, fontWeight: 600 }} className="muted">Claim prefix</span><input className="input" style={{ borderRadius: 8, height: 34 }} data-testid="bi-claimPrefix" value={bill.claimPrefix || 'CLM'} onChange={(e) => setBill({ claimPrefix: e.target.value.toUpperCase() || 'CLM' })} /></label>
              </div>
              <div className="muted" style={{ fontSize: 11, marginTop: 8 }}>Claim numbers mint as <code>{bill.claimPrefix || 'CLM'}-YYYYMM-###</code>; rebills append -R2, -R3…</div>
            </div>
            <div className="panel" style={{ borderRadius: 12, padding: 16, boxShadow: 'var(--shadow-1)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <span style={{ width: 28, height: 28, borderRadius: 8, background: '#f59e0b', color: '#fff', display: 'grid', placeItems: 'center' }}>{Icon.checkCircle({ size: 12 })}</span>
                <b style={{ fontSize: 13 }}>Claim gates</b>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 8, border: '1px solid var(--line)', background: 'var(--panel)' }}>
                  <span className={`cb ${bill.requireVerification !== false ? 'on' : ''}`} role="checkbox" aria-checked={bill.requireVerification !== false} data-testid="bi-requirever" onClick={() => setBill({ requireVerification: bill.requireVerification === false })} style={{ width: 20, height: 20, borderRadius: 6, border: '1px solid var(--line)', display: 'grid', placeItems: 'center', cursor: 'pointer', background: bill.requireVerification !== false ? 'var(--accent)' : 'var(--panel)', color: '#fff' }}>{bill.requireVerification !== false && Icon.check({ size: 10, strokeWidth: 3 })}</span>
                  <b style={{ fontSize: 12 }}>Require session verification before a line can go on a claim</b>
                  <span className="muted" style={{ marginLeft: 'auto', fontSize: 11 }}>{blocked.filter((b) => /verification/i.test(b.issues)).length} gated now</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 8, border: '1px solid var(--line)', background: 'var(--panel)' }}>
                  <span className={`cb ${bill.autoUnits !== false ? 'on' : ''}`} role="checkbox" aria-checked={bill.autoUnits !== false} data-testid="bi-autounits" onClick={() => setBill({ autoUnits: bill.autoUnits === false })} style={{ width: 20, height: 20, borderRadius: 6, border: '1px solid var(--line)', display: 'grid', placeItems: 'center', cursor: 'pointer', background: bill.autoUnits !== false ? 'var(--accent)' : 'var(--panel)', color: '#fff' }}>{bill.autoUnits !== false && Icon.check({ size: 10, strokeWidth: 3 })}</span>
                  <b style={{ fontSize: 12 }}>Auto-fill units from duration & code</b>
                  <span className="muted" style={{ marginLeft: 'auto', fontSize: 11 }}>powers one-click fixes on Blocked</span>
                </div>
              </div>
              <div style={{ marginTop: 12 }}>
                <div className="py-tbl" style={{ borderRadius: 8, overflow: 'hidden', border: '1px solid var(--line)' }}>
                  <div className="py-thead" style={{ gridTemplateColumns: '80px 1fr 70px 70px', background: 'var(--panel-2)', fontSize: 11 }}><span>Code</span><span>Description</span><span className="r">Unit</span><span className="r">Rate</span></div>
                  {BILL_CODES.map((c) => (
                    <div key={c.id} className="py-trow" style={{ gridTemplateColumns: '80px 1fr 70px 70px', fontSize: 11 }}>
                      <div className="py-cell"><b>{c.id}</b></div><div className="py-cell">{c.label.split(' · ')[1]}</div><div className="py-cell r">{c.unitMins} min</div><div className="py-cell r money">${c.rate}</div>
                    </div>
                  ))}
                </div>
                <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>The shared code table — wizard, this page and every claim line stay in lockstep.</div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

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
    try { claimTo1500(state, claim).save(`${claim.no}-1500.pdf`) } catch (e) { }
    toast({ message: `CMS-1500 exported — ${claim.no} · ${pages} page${pages > 1 ? 's' : ''}${claim.mode === 'selfpay' ? ' (courtesy copy)' : ' · e-file via ANSI 837P'}`, kind: 'ok' })
  }

  return (
    <section className="clm-doc panel" data-testid="clm-form" style={{ borderRadius: 12, overflow: 'hidden', boxShadow: 'var(--shadow-1)' }}>
      <header style={{ padding: '12px 16px', borderBottom: '1px solid var(--line)', background: 'var(--panel-2)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span className={`cd-mode ${claim.mode}`} style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.6, padding: '2px 8px', borderRadius: 6, background: claim.mode === 'selfpay' ? '#fef3c7' : '#dbeafe', border: '1px solid var(--line)' }}>{claim.mode === 'selfpay' ? 'INVOICE' : 'CLAIM'}</span>
          <h2 style={{ fontSize: 15, margin: 0 }}>{claim.no}{claim.version > 1 ? <em style={{ marginLeft: 6, fontSize: 11 }} title={`Rebill of ${claim.parentNo}`}>v{claim.version}</em> : null}</h2>
          <StatusChip s={claim.status} />
          {age ? <span className={`cd-aging ${age.late ? 'late' : ''}`} data-testid="clm-aging" style={{ fontSize: 11, padding: '2px 8px', borderRadius: 6, background: age.late ? '#fee2e2' : 'var(--panel)', border: '1px solid var(--line)' }}>{age.days} days out{age.late ? ' — past cycle' : ''}</span> : null}
          {gated ? <span className="tag warn" style={{ fontSize: 10 }}>⚠ {gated} gated</span> : null}
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
          {claim.status === 'draft' && <button className="btn btn-xs btn-primary" data-testid="clm-submit" onClick={onSubmit} title={gate.ok ? 'Run gates & send to payer' : `${gate.bad.length} line(s) fail gates`}>{Icon.check({ size: 11 })} Submit {claim.mode === 'selfpay' ? 'invoice' : 'to payer'}</button>}
          {claim.status === 'submitted' && (
            <>
              <button className="btn btn-xs btn-primary" data-testid="clm-pay" onClick={() => setPayOpen(true)}>{Icon.dollar({ size: 11 })} Post payment</button>
              <button className="btn btn-xs" data-testid="clm-deny" onClick={() => setDenyOpen(true)}>{Icon.ban({ size: 11 })} Record denial</button>
            </>
          )}
          {claim.status === 'partially_paid' && client?.secondary && !claim.secondary && <button className="btn btn-xs btn-primary" data-testid="clm-file-sec" onClick={() => { const r = actions.fileSecondaryClaim(claim.id); toast({ message: r.msg, kind: r.ok ? 'ok' : 'warn' }) }}>{Icon.file({ size: 11 })} File secondary</button>}
          {claim.status === 'denied' && (
            <>
              <button className="btn btn-xs btn-primary" data-testid="clm-rebill" onClick={onRebill}>{Icon.repeat({ size: 11 })} Rebill{disputed.size ? ` (drop ${disputed.size})` : ''}</button>
              <button className="btn btn-xs" data-testid="clm-writeoff" onClick={onWriteOff} title="Close with zero payment">{Icon.file({ size: 11 })} Write off</button>
            </>
          )}
          {(claim.status === 'draft' || claim.status === 'submitted') && <button className="btn btn-xs" data-testid="clm-void" onClick={onVoid} title="Void & release lines">{Icon.trash({ size: 11 })} Void</button>}
          <button className="btn btn-xs" data-testid="clm-cms1500" onClick={export1500} title={claim.mode === 'selfpay' ? 'Printable CMS-1500 courtesy' : 'CMS-1500 PDF'}>{Icon.print({ size: 11 })} CMS-1500 {claim.mode === 'selfpay' ? '· courtesy' : 'PDF'}</button>
          <span style={{ width: 1, height: 20, background: 'var(--line)' }} />
          <button className="btn btn-xs" onClick={() => { download(`${claim.no}.csv`, claimCsv(state, claim)); toast({ message: `${claim.no} exported`, kind: 'ok' }) }} data-testid="clm-csv">{Icon.download({ size: 11 })}</button>
          <button className="btn btn-xs" onClick={() => window.print()} data-testid="clm-print">{Icon.print({ size: 11 })}</button>
        </div>
        <div style={{ display: 'flex', gap: 16, marginTop: 10, fontSize: 11 }}>
          <span>charges<b style={{ marginLeft: 6 }}>{money(claim.charges)}</b></span>
          {claim.adj ? <span>adjustments<b className="neg" style={{ marginLeft: 6 }}>-{money(claim.adj)}</b></span> : null}
          {claim.status === 'paid' ? <span>paid<b className="pos" style={{ marginLeft: 6 }}>{money(claim.paid)}</b></span> : <span>due<b className={due > 0 ? 'due' : 'pos'} style={{ marginLeft: 6, color: due > 0 ? '#ef4444' : '#10b981' }}>{money(due)}</b></span>}
        </div>
      </header>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 1, background: 'var(--line)' }}>
        <div style={{ background: 'var(--panel)', padding: '10px 12px' }}><i style={{ fontSize: 10, color: 'var(--muted)', fontStyle: 'normal', display: 'block' }}>1 · Billing provider</i><b style={{ fontSize: 11 }}>{org.name || 'Practice'}</b><p style={{ fontSize: 10, margin: '2px 0 0', color: 'var(--muted)' }}>{org.address} · {org.phone}<br />Tax ID {org.taxId} · NPI {npiOf('s12')}</p></div>
        <div style={{ background: 'var(--panel)', padding: '10px 12px' }}><i style={{ fontSize: 10, color: 'var(--muted)', fontStyle: 'normal', display: 'block' }}>2 · Insured / patient</i><b style={{ fontSize: 11 }}>{client.name || '—'}</b><p style={{ fontSize: 10, margin: '2px 0 0', color: 'var(--muted)' }}>{client.program}{client.guardian ? ` · Guardian ${client.guardian}` : ''}<br />Member ID {memberIdOf({ id: client.id, insurer: claim.payer })}</p></div>
        <div style={{ background: 'var(--panel)', padding: '10px 12px' }}><i style={{ fontSize: 10, color: 'var(--muted)', fontStyle: 'normal', display: 'block' }}>3 · Payer</i><b style={{ fontSize: 11 }}>{claim.mode === 'selfpay' ? 'Self-pay account' : claim.payer}</b><p style={{ fontSize: 10, margin: '2px 0 0', color: 'var(--muted)' }}>{claim.mode === 'selfpay' ? `Net ${settings.billing?.dueDays || 30} days` : `Policy ${claim.payer.split(' ').map((w) => w[0]).join('').toUpperCase()}${String(14000 + (client.id.charCodeAt(1) * 137) % 8999)}`}<br />Auth {authNoOf(client)} · {claim.mode === 'selfpay' ? 'family responsibility' : 'rendering NPI ' + npiOf(firstAppt?.staffIds?.[0])}</p></div>
        <div style={{ background: 'var(--panel)', padding: '10px 12px' }}><i style={{ fontSize: 10, color: 'var(--muted)', fontStyle: 'normal', display: 'block' }}>4 · Referral / prior</i><b style={{ fontSize: 11 }}>BCBA plan of care</b><p style={{ fontSize: 10, margin: '2px 0 0', color: 'var(--muted)' }}>{staffOf('s1')?.name || 'Prateek Kiran'}, BCBA<br />{claim.parentNo ? `Prior claim ${claim.parentNo} (v${claim.version})` : 'No prior submission'}</p></div>
        <div style={{ background: 'var(--panel)', padding: '10px 12px' }}><i style={{ fontSize: 10, color: 'var(--muted)', fontStyle: 'normal', display: 'block' }}>9 · Diagnosis</i><b style={{ fontSize: 11 }}>{dx.join(' · ')}</b></div>
        <div style={{ background: 'var(--panel)', padding: '10px 12px' }}><i style={{ fontSize: 10, color: 'var(--muted)', fontStyle: 'normal', display: 'block' }}>6–7 · Service period</i><b style={{ fontSize: 11 }}>{claim.dosFrom} → {claim.dosTo}</b><p style={{ fontSize: 10, margin: '2px 0 0', color: 'var(--muted)' }}>{claim.lines.length} lines · {claim.units} units{claim.submittedAt ? ` · submitted ${isoDate(new Date(claim.submittedAt))}` : ' · not yet submitted'}</p></div>
        <div style={{ background: 'var(--panel)', padding: '10px 12px' }}><i style={{ fontSize: 10, color: 'var(--muted)', fontStyle: 'normal', display: 'block' }}>32 · Facility</i><b style={{ fontSize: 11 }}>{facility}</b><p style={{ fontSize: 10, margin: '2px 0 0', color: 'var(--muted)' }}>{org.address} · signature on file</p></div>
        <div style={{ background: 'var(--panel)', padding: '10px 12px' }}><i style={{ fontSize: 10, color: 'var(--muted)', fontStyle: 'normal', display: 'block' }}>33a · Rendering</i><b style={{ fontSize: 11 }}>{[...new Set(claim.lines.map((l) => l.staff))].join(', ') || '—'}</b><p style={{ fontSize: 10, margin: '2px 0 0', color: 'var(--muted)' }}>NPI {npiOf(firstAppt?.staffIds?.[0])} · supervision {(staffOf('s1')?.name)} BCBA #5-12-0034</p></div>
      </div>

      <div className={`cd-banner ${claim.status === 'denied' ? 'danger' : claim.status === 'paid' ? 'ok' : gated ? 'warn' : 'info'}`} data-testid="clm-banner" style={{ padding: '10px 14px', display: 'flex', gap: 8, alignItems: 'flex-start', background: claim.status === 'denied' ? '#fef2f2' : claim.status === 'paid' ? '#ecfdf5' : gated ? '#fffbeb' : '#eff6ff', borderTop: '1px solid var(--line)', borderBottom: '1px solid var(--line)', fontSize: 11 }}>
        {claim.timelyDue && (() => { const today = new Date().toISOString().slice(0, 10); const overdue = today > claim.timelyDue; return overdue ? <><span className="sev-pill sev-error" style={{ fontSize: 10 }}>timely filing past due {claim.timelyDue}</span></> : <><span className="sev-pill sev-notice" style={{ fontSize: 10 }}>filing due {claim.timelyDue}</span></> })()}
        {claim.method === 'secondary' && <><span className="tag" style={{ fontSize: 10 }}>secondary of {claim.parentNo || claim.secondary || ''}</span></>}
        {claim.secondary && claim.method !== 'secondary' && <><span className="tag ok" style={{ fontSize: 10 }}>secondary filed → {typeof claim.secondary === 'string' && claim.secondary.startsWith('clm-') ? (state.claims[claim.secondary]?.no || claim.secondary) : claim.secondary}</span></>}
        {claim.status === 'denied' && <><span style={{ width: 20, height: 20, borderRadius: 6, background: '#ef4444', color: '#fff', display: 'grid', placeItems: 'center', flex: 'none' }}>{Icon.alert({ size: 10 })}</span><span><b>{claim.denial.reason}.</b> {claim.denial.fix}. {claim.denial.at ? `Denied ${relDay(claim.denial.at)}.` : ''} {claim.lines.length > disputed.size && disputed.size > 0 ? `${disputed.size} line(s) marked disputed — Rebill drops them.` : disputed.size ? 'Rebill will drop every marked line.' : 'Rebill re-drafts this claim.'}</span></>}
        {claim.status === 'paid' && <><span style={{ width: 20, height: 20, borderRadius: 6, background: '#10b981', color: '#fff', display: 'grid', placeItems: 'center' }}>{Icon.check({ size: 10 })}</span><span><b>{money(claim.paid)}</b> via {claim.remittance?.checkNo || '—'} · deposited {relDay(claim.remittance?.at)}{claim.adj ? ` · ${money(claim.adj)} adj` : ''}{shortPay ? ' — short-pay; re-review.' : ''}</span></>}
        {claim.status === 'submitted' && <><span style={{ width: 20, height: 20, borderRadius: 6, background: '#f59e0b', color: '#fff', display: 'grid', placeItems: 'center' }}>{Icon.clock({ size: 10 })}</span><span>Waiting on {claim.mode === 'selfpay' ? 'family payment' : claim.payer}{age ? ` — ${age.days} days out, median ${payerPolicy(claim.payer).avgDays} days` : ''}. Post remittance when it lands.</span></>}
        {claim.status === 'draft' && gated ? <><span style={{ width: 20, height: 20, borderRadius: 6, background: '#f59e0b', color: '#fff', display: 'grid', placeItems: 'center' }}>{Icon.alert({ size: 10 })}</span><span><b>Submission held:</b> {gate.bad.map((b) => b.why).slice(0, 2).join(' · ')}. Fix on source session or drop line.</span></> : null}
        {claim.status === 'partially_paid' && <><span style={{ width: 20, height: 20, borderRadius: 6, background: '#6366f1', color: '#fff', display: 'grid', placeItems: 'center' }}>{Icon.dollar({ size: 10 })}</span><span><b>Partially paid</b> — {money(due)} open{client?.secondary ? <> · secondary ready</> : ' · no secondary'}</span></>}
        {claim.status === 'void' && <><span style={{ width: 20, height: 20, borderRadius: 6, background: '#9ca3af', color: '#fff', display: 'grid', placeItems: 'center' }}>{Icon.ban({ size: 10 })}</span><span>Voided — all {claim.lines.length} line(s) returned to staging.</span></>}
      </div>

      <div className="py-tbl cd-lines" data-testid="clm-lines">
        <div className="py-thead" style={{ gridTemplateColumns: `${editable && claim.status === 'denied' ? '28px ' : ''}24px 70px 70px 70px 1fr 60px 40px 1fr 60px 70px 56px`, background: 'var(--panel-2)', fontSize: 11 }}>
          {editable && claim.status === 'denied' ? <span className="no-print" /> : null}<span>#</span><span>Date</span><span>Time</span><span>HCPCS</span><span>Description</span><span>ICD</span><span>Units</span><span>Rendered by</span><span className="r">Rate</span><span className="r">Charge</span><span className="no-print" />
        </div>
        {claim.lines.map((l, i) => {
          const src = appts[l.apptId]
          const isBad = badIds.has(l.apptId)
          return (
            <div key={l.apptId} className={`py-trow ${isBad ? 'gated' : ''} ${disputed.has(l.apptId) ? 'disputed' : ''}`} data-testid={`clm-line-${i}`} style={{ gridTemplateColumns: `${editable && claim.status === 'denied' ? '28px ' : ''}24px 70px 70px 70px 1fr 60px 40px 1fr 60px 70px 56px`, fontSize: 11, background: disputed.has(l.apptId) ? '#fef3c7' : isBad ? '#fef2f2' : undefined }}>
              {editable && claim.status === 'denied' && (
                <div className="py-cell no-print"><span className={`cb ${disputed.has(l.apptId) ? 'on' : ''}`} role="checkbox" aria-checked={disputed.has(l.apptId)} data-testid={`clm-dispute-${i}`} onClick={() => toggleDispute(l.apptId)} style={{ width: 18, height: 18, borderRadius: 5, border: '1px solid var(--line)', display: 'grid', placeItems: 'center', cursor: 'pointer', background: disputed.has(l.apptId) ? '#f59e0b' : 'var(--panel)', color: '#fff' }}>{disputed.has(l.apptId) && Icon.check({ size: 9, strokeWidth: 3 })}</span></div>
              )}
              <div className="py-cell muted">{i + 1}</div>
              <div className="py-cell"><b>{l.dos}</b></div>
              <div className="py-cell muted" style={{ fontSize: 10 }}>{l.kind === 'mileage' ? `${hhmm(l.t0)} trip` : `${hhmm(l.t0)}–${hhmm(l.t1)}`}</div>
              <div className="py-cell"><span className="ln-code" style={{ fontSize: 10 }}>{l.code}</span>{l.kind === 'mileage' ? <span className="ln-mod" style={{ fontSize: 8 }}>MILEAGE</span> : null}{isBad ? <span className="ln-mod bad" style={{ fontSize: 8, color: '#ef4444' }}>⚠ gate</span> : null}</div>
              <div className="py-cell" style={{ fontSize: 11 }}>{l.desc}</div>
              <div className="py-cell muted" style={{ fontSize: 10 }}>{dx[i % dx.length]}</div>
              <div className="py-cell">{l.kind === 'mileage' ? `${l.units} mi` : l.units}</div>
              <div className="py-cell muted" style={{ fontSize: 10 }}>{l.staff.split(', ')[0] || '—'}</div>
              <div className="py-cell r">${l.rate}</div>
              <div className="py-cell r money"><b>{money(l.charge)}</b></div>
              <div className="py-cell no-print" style={{ display: 'flex', gap: 4 }}>
                <button className="iconbtn" style={{ width: 22, height: 22, borderRadius: 6 }} title="Open session" onClick={() => src && actions.setUI({ section: 'calendar', anchor: l.dos, openAppt: l.apptId })}>{Icon.chevronR({ size: 11 })}</button>
                {claim.status === 'draft' && <button className="iconbtn danger" style={{ width: 22, height: 22, borderRadius: 6 }} title="Remove line" data-testid={`clm-drop-${i}`} onClick={() => onDropLine(l.apptId)}>{Icon.x({ size: 11 })}</button>}
              </div>
            </div>
          )
        })}
        <div className="py-trow" style={{ gridTemplateColumns: `${editable && claim.status === 'denied' ? '28px ' : ''}24px 70px 70px 70px 1fr 60px 40px 1fr 60px 70px 56px`, fontWeight: 700, background: 'var(--panel-2)', fontSize: 11 }}>
          <div className="py-cell" style={{ gridColumn: `span ${claim.status === 'denied' ? 9 : 8}` }}>Total charges <b>{money(claim.charges)}</b>{copay ? <span className="muted" style={{ fontWeight: 400 }}> · copay {money(copay)}</span> : null}</div>
          <div className="py-cell r" />
          <div className="py-cell r">{claim.adj ? <span className="muted" style={{ fontWeight: 400 }}>net {money(claim.charges - claim.adj)} · </span> : null}<b style={{ color: due > 0 ? '#ef4444' : '#10b981' }}>{due > 0 ? `due ${money(due)}` : 'settled'}</b></div>
          <div className="py-cell no-print" />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, padding: 12 }}>
        <div className="panel" style={{ borderRadius: 10, padding: 12, background: 'var(--panel-2)', border: '1px solid var(--line)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}><span style={{ width: 20, height: 20, borderRadius: 6, background: '#6366f1', color: '#fff', display: 'grid', placeItems: 'center' }}>{Icon.clock({ size: 10 })}</span><b style={{ fontSize: 11 }}>Lifecycle</b><span className="muted" style={{ fontSize: 10 }}>({claim.history.length})</span></div>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }} data-testid="clm-timeline">
            {[...claim.history].reverse().map((h, i) => (
              <li key={i} data-testid={`clm-ev-${i}`} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 11 }}><span style={{ width: 8, height: 8, borderRadius: 4, background: i === 0 ? '#10b981' : 'var(--line)', marginTop: 4, flex: 'none' }} /><p style={{ margin: 0 }}><b>{h.ev}</b><i style={{ display: 'block', color: 'var(--muted)', fontStyle: 'normal', fontSize: 10 }}>{relDay(h.at)}</i></p></li>
            ))}
          </ul>
        </div>
        <div className="panel" style={{ borderRadius: 10, padding: 12, border: '1px solid var(--line)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}><span style={{ width: 20, height: 20, borderRadius: 6, background: '#f59e0b', color: '#fff', display: 'grid', placeItems: 'center' }}>{Icon.edit({ size: 10 })}</span><b style={{ fontSize: 11 }}>Billing note</b></div>
          <textarea className="input" rows={2} placeholder="Context for next person on this claim…" value={noteDraft} onChange={(e) => setNoteDraft(e.target.value)} data-testid="clm-note" style={{ borderRadius: 8, fontSize: 12 }} />
          {noteDraft !== (claim.note || '') && <button className="btn btn-xs" style={{ marginTop: 6 }} data-testid="clm-note-save" onClick={() => { actions.addClaimNote(claim.id, noteDraft); toast({ message: 'Note saved', kind: 'ok' }) }}>Save note</button>}
          {claim.remittance?.note ? <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>Remittance note: {claim.remittance.note}</div> : null}
        </div>
      </div>

      {payOpen ? <PayModal claim={claim} onClose={() => setPayOpen(false)} /> : null}
      {denyOpen ? <DenyModal claim={claim} onClose={() => setDenyOpen(false)} /> : null}
    </section>
  )
}

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
      <div className="modal" style={{ width: 'min(560px, 92vw)', borderRadius: 12, overflow: 'hidden' }} data-testid="pay-modal">
        <div className="modal-head" style={{ padding: '12px 16px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 10, background: 'var(--panel-2)' }}><span style={{ width: 28, height: 28, borderRadius: 8, background: '#10b981', color: '#fff', display: 'grid', placeItems: 'center' }}>{Icon.dollar({ size: 12 })}</span><h2 style={{ fontSize: 13, margin: 0 }}>Post payment — {claim.no}</h2><div style={{ flex: 1 }} /><button className="modal-x" aria-label="Close" onClick={onClose} style={{ width: 28, height: 28, borderRadius: 8 }}>{Icon.x({ size: 14 })}</button></div>
        <div className="modal-body" style={{ padding: 16 }}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }} data-testid="pay-quick-row">
            {posts.map((p) => (
              <button key={p.id} className="q-chip" data-testid={`pay-quick-${p.id}`} onClick={() => { setAmount(p.amount); setAdj(p.adj || 0); setNote(p.note || '') }} style={{ borderRadius: 20, padding: '4px 10px', fontSize: 11, border: '1px solid var(--line)', background: 'var(--panel-2)' }}>{p.label}</button>
            ))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}><span style={{ fontSize: 11, fontWeight: 600 }} className="muted">Payment amount $</span><input className="input" style={{ borderRadius: 8, height: 36 }} type="number" step="0.01" value={amount} onChange={(e) => setAmount(Number(e.target.value))} data-testid="pay-amount" /></label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}><span style={{ fontSize: 11, fontWeight: 600 }} className="muted">Adjustment / write-off $</span><input className="input" style={{ borderRadius: 8, height: 36 }} type="number" step="0.01" value={adj} onChange={(e) => setAdj(Number(e.target.value))} data-testid="pay-adj" /></label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}><span style={{ fontSize: 11, fontWeight: 600 }} className="muted">Check / EFT ref</span><input className="input" style={{ borderRadius: 8, height: 36 }} value={check} onChange={(e) => setCheck(e.target.value)} data-testid="pay-check" /></label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}><span style={{ fontSize: 11, fontWeight: 600 }} className="muted">Posted on</span><input className="input" style={{ borderRadius: 8, height: 36 }} type="date" value={todayISO()} readOnly data-testid="pay-date" /></label>
          </div>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 12 }}><span style={{ fontSize: 11, fontWeight: 600 }} className="muted">Note on remittance</span><input className="input" style={{ borderRadius: 8, height: 36 }} value={note} onChange={(e) => setNote(e.target.value)} placeholder="optional" data-testid="pay-note" /></label>
          <div className={`pm-due ${Math.abs(due) < 0.5 ? 'ok' : 'warn'}`} data-testid="pay-due" style={{ marginTop: 12, padding: '10px 12px', borderRadius: 8, background: Math.abs(due) < 0.5 ? '#ecfdf5' : '#fffbeb', border: `1px solid ${Math.abs(due) < 0.5 ? '#a7f3d0' : '#fde68a'}`, fontSize: 11 }}>
            {Math.abs(due) < 0.5 ? <>Balances to zero — claim will close as <b>paid</b> ({money(claim.charges)} charges − {money(adj || 0)} adjustments = {money(amount)}).</> : <>Posting leaves <b>{money(due)}</b> {due > 0 ? 'open — flagged short-pay' : 'overpaid'} — {money(claim.charges)} − {money(adj || 0)} − {money(amount)}.</>}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', padding: '12px 16px', borderTop: '1px solid var(--line)', background: 'var(--panel-2)' }}>
          <button className="btn btn-sm" onClick={onClose}>Cancel</button>
          <button className="btn btn-sm btn-primary" onClick={post} data-testid="pay-post" style={{ borderRadius: 8 }}>{Icon.check({ size: 12 })} Post {money(amount)}{adj ? ` · write off ${money(adj)}` : ''}</button>
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
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <div className="modal" style={{ width: 'min(520px, 92vw)', borderRadius: 12, overflow: 'hidden' }} data-testid="deny-modal">
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 10, background: 'var(--panel-2)' }}><span style={{ width: 28, height: 28, borderRadius: 8, background: '#ef4444', color: '#fff', display: 'grid', placeItems: 'center' }}>{Icon.ban({ size: 12 })}</span><h2 style={{ fontSize: 13, margin: 0 }}>Record denial — {claim.no}</h2><div style={{ flex: 1 }} /><button className="modal-x" aria-label="Close" onClick={onClose} style={{ width: 28, height: 28, borderRadius: 8 }}>{Icon.x({ size: 14 })}</button></div>
        <div style={{ padding: 16 }}>
          <span style={{ fontSize: 11, fontWeight: 600 }} className="muted">Payer denial code</span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
            {DENIAL_REASONS.map((r) => (
              <button key={r.id} data-testid={`deny-r-${r.id}`} onClick={() => setCode(r.id)} style={{ textAlign: 'left', padding: '8px 12px', borderRadius: 8, border: `1px solid ${code === r.id ? 'var(--accent)' : 'var(--line)'}`, background: code === r.id ? 'var(--panel-2)' : 'var(--panel)', display: 'flex', flexDirection: 'column', gap: 2 }}><b style={{ fontSize: 11 }}>{r.label}</b><i style={{ fontSize: 10, color: 'var(--muted)', fontStyle: 'normal' }}>{r.fix}</i></button>
            ))}
          </div>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 12 }}><span style={{ fontSize: 11, fontWeight: 600 }} className="muted">Correspondence note</span><input className="input" style={{ borderRadius: 8, height: 36 }} value={note} onChange={(e) => setNote(e.target.value)} placeholder="letter/EOB reference…" data-testid="deny-note" /></label>
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', padding: '12px 16px', borderTop: '1px solid var(--line)', background: 'var(--panel-2)' }}>
          <button className="btn btn-sm" onClick={onClose}>Cancel</button>
          <button className="btn btn-sm btn-primary" data-testid="deny-go" onClick={() => { const r = actions.denyClaim(claim.id, { code, note }); toast({ message: `${r.msg} — U to undo`, kind: 'warn' }); onClose() }} style={{ borderRadius: 8 }}>Mark {claim.no} denied</button>
        </div>
      </div>
    </div>
  )
}
