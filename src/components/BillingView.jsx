import React, { useEffect, useMemo, useState } from 'react'
import { PersonAvatar } from '../ui/avatars'
import { useStore } from '../state/store'
import { SectionBar, RangePicker } from './NavRail'
import { Icon } from '../ui/Icons'
import { useToast } from '../ui/Toast'
import { resolveRange } from '../lib/analytics'
import { runReport } from '../lib/reports'
import { BILL_CODES, computeBilling } from '../lib/model'
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
  <span className="clm-status" style={{ color: CLAIM_STATUSES[s].ink, background: CLAIM_STATUSES[s].bg, display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 20, fontSize: 10, fontWeight: 700 }}>
    <span style={{ width: 6, height: 6, borderRadius: 3, background: CLAIM_STATUSES[s].ink }} />
    {CLAIM_STATUSES[s].label}
  </span>
)

const KpiCard = ({ icon, color, grad, label, value, sub, onClick, testId, alert }) => (
  <button data-testid={testId} onClick={onClick} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 14, border: `1px solid ${alert ? '#fecaca' : 'var(--line)'}`, background: alert ? '#fff5f5' : 'var(--panel)', cursor: onClick ? 'pointer' : 'default', minWidth: 168, textAlign: 'left', boxShadow: 'var(--shadow-1)', transition: 'transform .15s', position: 'relative', overflow: 'hidden' }}>
    <span style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: grad || color }} />
    <span style={{ width: 40, height: 40, borderRadius: 12, background: grad ? `linear-gradient(135deg, ${color}, ${grad})` : color, color: '#fff', display: 'grid', placeItems: 'center', boxShadow: `0 4px 12px ${color}40`, flex: 'none' }}>{icon}</span>
    <span style={{ minWidth: 0 }}><b style={{ display: 'block', fontSize: 14, lineHeight: 1.1 }}>{value}</b><span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text)' }}>{label}</span><i style={{ display: 'block', fontSize: 10, color: 'var(--muted)', fontStyle: 'normal', marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sub}</i></span>
  </button>
)

const PipelineStep = ({ icon, label, count, active, done, color }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 10, opacity: active ? 1 : 0.6 }}>
    <span style={{ width: 32, height: 32, borderRadius: 10, background: done ? color : active ? 'var(--panel-2)' : 'var(--panel)', border: `2px solid ${done ? color : active ? color : 'var(--line)'}`, color: done ? '#fff' : active ? color : 'var(--muted)', display: 'grid', placeItems: 'center', backgroundColor: done ? color : undefined }}>{icon}</span>
    <span style={{ fontSize: 11 }}><b style={{ display: 'block', fontSize: 11 }}>{label}</b><span className="muted" style={{ fontSize: 10 }}>{count}</span></span>
  </div>
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

  const TabBtn = ({ id, label, n, warn, icon }) => (
    <button className={`tab ${tab === id ? 'on' : ''}`} data-testid={`bil-tab-${id}`} onClick={() => setTab(id)} style={{ display: 'flex', alignItems: 'center', gap: 6, position: 'relative' }}>
      <span style={{ width: 20, height: 20, borderRadius: 6, background: tab === id ? 'var(--accent)' : 'var(--panel-2)', color: tab === id ? '#fff' : 'var(--muted)', display: 'grid', placeItems: 'center' }}>{icon}</span>
      {label}{n > 0 && <span className={`pill ${warn ? 'warn' : ''}`} style={{ marginLeft: 2, background: warn ? '#fee2e2' : tab === id ? '#fff' : 'var(--panel-2)', color: warn ? '#b91c1c' : tab === id ? 'var(--accent)' : 'var(--text)', border: '1px solid var(--line)', borderRadius: 10, padding: '1px 6px', fontSize: 11, fontWeight: 700 }}>{n}</span>}
    </button>
  )

  return (
    <div className="sectionpage" style={{ background: 'var(--bg)' }}>
      <SectionBar icon="dollar" title="Billing" sub={`Revenue cycle — stage → form → submit → pay · ${range.label} · ${stats.drafts.n + stats.pending.n + stats.denied.n + stats.paid.n} claims`}>
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
            <button className="btn btn-sm" onClick={exportStageCsv} data-testid="bil-export" style={{ borderRadius: 8 }}>{Icon.download({ size: 13 })} Export</button>
            <button className="btn btn-sm btn-primary" disabled={!staged.length} onClick={generate} data-testid="bil-generate" style={{ borderRadius: 8, boxShadow: '0 4px 12px #6366f140' }}>{Icon.file({ size: 12 })} Assemble {picked.size || staged.length} → {plans.length} forms</button>
            <button className="btn btn-sm" data-testid="bil-process" onClick={processBilling} title="Submit all gate-clean drafts + generate billed file" style={{ borderRadius: 8, background: 'linear-gradient(135deg,#10b981,#059669)', color: '#fff', border: 'none' }}>{Icon.zap({ size: 12 })} Process</button>
          </>
        )}
        {tab === 'claims' && (
          <>
            <button className="btn btn-sm" onClick={() => {
              const ins = list.filter((c) => c.status !== 'void')
              if (!ins.length) { toast({ message: 'No claims in view to export', kind: 'warn' }); return }
              try { claimsTo1500(state, ins).save(`CMS-1500-batch-${todayISO()}.pdf`) } catch (e) { }
              toast({ message: `CMS-1500 batch — ${ins.length} claims onto one print-ready PDF`, kind: 'ok' })
            }} data-testid="bil-cms1500-batch" style={{ borderRadius: 8 }}>{Icon.print({ size: 13 })} 1500 Batch</button>
            <button className="btn btn-sm" onClick={() => { download(`${(bill.claimPrefix || 'CLM')}-ledger.csv`, claimsCsv(state, list)); toast({ message: `${list.length} claims exported`, kind: 'ok' }) }} data-testid="bil-csv-all" style={{ borderRadius: 8 }}>{Icon.download({ size: 13 })} Ledger</button>
            <button className="btn btn-sm btn-primary" disabled={!stats.drafts.n} onClick={submitAllDrafts} data-testid="bil-submit-all" style={{ borderRadius: 8 }}>{Icon.check({ size: 12 })} Submit {Object.keys(claims).filter((id) => claims[id].status === 'draft' && !gatedIds[id]).length} ready</button>
          </>
        )}
      </SectionBar>

      {/* Revenue cycle pipeline visual */}
      <div style={{ margin: '12px 16px', padding: '14px 18px', borderRadius: 16, background: 'linear-gradient(135deg,var(--panel),var(--panel-2))', border: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 12, boxShadow: 'var(--shadow-1)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1 }}>
          <PipelineStep icon={Icon.file({ size: 12 })} label="Staging" count={`${staged.length} lines · ${money(stagedTotal)}`} active={tab === 'stage'} done={staged.length === 0} color="#6366f1" />
          <span style={{ flex: 1, height: 2, background: `linear-gradient(90deg,#6366f1,#f59e0b)`, borderRadius: 1, opacity: 0.5 }} />
          <PipelineStep icon={Icon.edit({ size: 12 })} label="Drafts" count={`${stats.drafts.n} · ${money(stats.drafts.$)}${Object.keys(gatedIds).length ? ` · ${Object.keys(gatedIds).length} gated` : ''}`} active={tab === 'claims' && statusF === 'draft'} done={false} color="#f59e0b" />
          <span style={{ flex: 1, height: 2, background: `linear-gradient(90deg,#f59e0b,#0ea5e9)`, borderRadius: 1, opacity: 0.5 }} />
          <PipelineStep icon={Icon.clock({ size: 12 })} label="Awaiting" count={`${stats.pending.n} · ${money(stats.pending.$)}${stats.pending.late ? ` · ${stats.pending.late} late` : ''}`} active={tab === 'claims' && statusF === 'submitted'} done={false} color="#0ea5e9" />
          <span style={{ flex: 1, height: 2, background: `linear-gradient(90deg,#0ea5e9,#10b981)`, borderRadius: 1, opacity: 0.5 }} />
          <PipelineStep icon={Icon.dollar({ size: 12 })} label="Paid" count={`${stats.paid.n} · ${money(stats.paid.$)} · ${stats.denialRate}% denial`} active={tab === 'claims' && statusF === 'paid'} done={stats.paid.n > 0} color="#10b981" />
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {['0–30', '31–60', '61–90', '90+'].map((b) => (
            <span key={b} className={`rp-sumchip ${stats.pending.buckets[b] ? 'on' : ''}`} style={{ padding: '6px 10px', opacity: stats.pending.buckets[b] ? 1 : 0.4, borderRadius: 10, border: '1px solid var(--line)', background: stats.pending.buckets[b] ? 'var(--panel)' : 'transparent', fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ width: 8, height: 8, borderRadius: 4, background: b === '0–30' ? '#10b981' : b === '31–60' ? '#f59e0b' : b === '61–90' ? '#f97316' : '#ef4444' }} />
              <b>{money(stats.pending.buckets[b] || 0)}</b><span className="muted">{b}</span>
            </span>
          ))}
        </div>
      </div>

      <div className="batch-strip" data-testid="bil-kpis" style={{ padding: '0 16px 12px', gap: 10, flexWrap: 'wrap', background: 'transparent', border: 'none' }}>
        <KpiCard testId="bil-kpi-staged" icon={Icon.file({ size: 16 })} color="#6366f1" grad="#8b5cf6" label="In Staging" value={money(stagedTotal)} sub={`${staged.length} claim-ready lines`} onClick={() => setTab('stage')} />
        <KpiCard testId="bil-kpi-draft" icon={Icon.edit({ size: 16 })} color={Object.keys(gatedIds).length ? '#ef4444' : '#f59e0b'} grad={Object.keys(gatedIds).length ? '#dc2626' : '#f97316'} label="Drafts" value={`${stats.drafts.n}`} sub={stats.drafts.n ? `${money(stats.drafts.$)} · ${Object.keys(gatedIds).length ? `${Object.keys(gatedIds).length} gated ⚠` : 'ready to submit ✓'}` : 'nothing pending'} onClick={() => { setTab('claims'); setStatusF('draft') }} alert={Object.keys(gatedIds).length} />
        <KpiCard testId="bil-kpi-pending" icon={Icon.clock({ size: 16 })} color="#0ea5e9" grad="#0284c7" label="Awaiting Payer" value={money(stats.pending.$)} sub={`${stats.pending.n} out${stats.pending.late ? ` · ${stats.pending.late} past cycle ⏰` : ''}`} onClick={() => { setTab('claims'); setStatusF('submitted') }} alert={stats.pending.late} />
        <KpiCard testId="bil-kpi-denied" icon={Icon.ban({ size: 16 })} color={stats.denied.n ? '#ef4444' : '#9ca3af'} grad={stats.denied.n ? '#dc2626' : '#6b7280'} label="Denied" value={`${stats.denied.n}`} sub={stats.denied.n ? `${money(stats.denied.$)} needs action 🚨` : 'none open ✓'} onClick={() => { setTab('claims'); setStatusF('denied') }} alert={stats.denied.n} />
        <KpiCard testId="bil-kpi-paid" icon={Icon.dollar({ size: 16 })} color="#10b981" grad="#059669" label={`Paid · ${range.label}`} value={money(stats.paid.$)} sub={`${stats.paid.n} remittances · ${stats.denialRate}% denial`} onClick={() => { setTab('claims'); setStatusF('paid') }} />
        <KpiCard testId="bil-kpi-cycle" icon={Icon.cal({ size: 16 })} color="#6b7280" grad="#4b5563" label="Avg Days to Pay" value={stats.avgDaysToPay ?? '—'} sub={stats.avgDaysToPay ? 'across paid claims 📈' : 'no history yet'} />
        <span className="muted" style={{ marginLeft: 'auto', fontSize: 11, display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ width: 20, height: 20, borderRadius: 6, background: '#fee2e2', color: '#ef4444', display: 'grid', placeItems: 'center' }}>{Icon.ban({ size: 10 })}</span> held back <b style={{ color: '#ef4444' }}>{money(blocked.reduce((t, r) => t + r.estCharge, 0))}</b></span>
      </div>

      <div className="batch-strip" style={{ padding: '8px 16px', alignItems: 'center', gap: 8, background: 'var(--panel)', borderTop: '1px solid var(--line)', borderBottom: '1px solid var(--line)' }}>
        <div className="viewseg" style={{ borderRadius: 12, padding: 3, background: 'var(--panel-2)', border: '1px solid var(--line)' }}>
          <TabBtn id="stage" label="Staging" n={staged.length} icon={Icon.file({ size: 11 })} />
          <TabBtn id="claims" label="Claim Desk" n={openCount} warn={stats.denied.n > 0} icon={Icon.clipboard({ size: 11 })} />
          <TabBtn id="secondary" label="Secondary" n={Object.values(claims).filter((c) => secondaryEligible(state, c)).length} icon={Icon.shield({ size: 11 })} />
          <TabBtn id="blocked" label="Blocked" n={blocked.length} warn icon={Icon.ban({ size: 11 })} />
          <TabBtn id="setup" label="Setup" icon={Icon.dashboard({ size: 11 })} />
        </div>
      </div>

      {tab === 'stage' && (
        <div style={{ padding: 16, display: 'grid', gridTemplateColumns: '1fr 380px', gap: 16, alignItems: 'start' }}>
          <div className="panel" style={{ borderRadius: 16, overflow: 'hidden', boxShadow: 'var(--shadow-1)', border: '1px solid var(--line)' }}>
            <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--line)', display: 'flex', gap: 10, alignItems: 'center', background: 'linear-gradient(135deg,#6366f122,#8b5cf611)' }}>
              <span style={{ width: 36, height: 36, borderRadius: 10, background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: '#fff', display: 'grid', placeItems: 'center', boxShadow: '0 4px 12px #6366f140' }}>{Icon.file({ size: 16 })}</span>
              <div><b style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>Staging Queue <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 20, background: '#6366f1', color: '#fff' }}>{staged.length}</span></b><span className="muted" style={{ fontSize: 11 }}>{picked.size ? `${picked.size} selected — forms built from selection 🎯` : `${staged.length} lines · forms group by client × payer × month · self-pay = one invoice`}</span></div>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                <button className="btn btn-xs" data-testid="bil-pickall" onClick={() => setPicked(picked.size === staged.length ? new Set() : new Set(staged.map((a) => a.id)))} style={{ borderRadius: 8 }}>{picked.size === staged.length ? '✕ Clear' : `✓ Select all (${staged.length})`}</button>
              </div>
            </div>
            <div className="py-tbl" style={{ maxHeight: 640, overflow: 'auto' }}>
              <div className="py-thead" style={{ gridTemplateColumns: '32px 80px 1fr 1fr 70px 90px 80px 80px 80px 32px 32px', background: 'var(--panel-2)', fontSize: 11, position: 'sticky', top: 0, zIndex: 1, borderBottom: '1px solid var(--line)' }}>
                <span></span><span>📅 Date</span><span>👤 Client</span><span>🏥 Payer</span><span>Code</span><span>Units</span><span>Provider</span><span>Filing</span><span>💲 Charge</span><span></span><span></span>
              </div>
              {staged.map((a, i) => {
                const c = clientOf(a.clientIds?.[0])
                const prov = (settings.providers || []).find((p) => p.kind === 'staff' && p.refId === a.staffIds?.[0])
                const timely = (() => { const pol = payerPolicy(c.insurer || 'Self-pay'); const filing = (state.payers || []).find((pp) => pp.name === (c.insurer || ''))?.ext?.filingDeadlineDays ?? bill.defaultFilingDays ?? pol.timely ?? 90; const due = isoDate(new Date(new Date(a.date).getTime() + filing * 86400000)); const today = todayISO(); const daysLeft = Math.round((new Date(due) - new Date(today)) / 86400000); return { due, daysLeft, amber: daysLeft <= 21 && daysLeft >= 0, over: daysLeft < 0 } })()
                return (
                  <div className="py-trow" key={a.id} data-testid={`bil-row-${i}`} style={{ gridTemplateColumns: '32px 80px 1fr 1fr 70px 90px 80px 80px 80px 32px 32px', fontSize: 11, transition: 'background .12s', background: picked.has(a.id) ? '#6366f111' : undefined }}>
                    <div className="py-cell"><span className={`cb ${picked.has(a.id) ? 'on' : ''}`} onClick={() => toggle(a.id)} role="checkbox" aria-checked={picked.has(a.id)} data-testid={`bil-pick-${i}`} style={{ width: 20, height: 20, borderRadius: 6, border: '2px solid var(--line)', display: 'grid', placeItems: 'center', cursor: 'pointer', background: picked.has(a.id) ? '#6366f1' : 'var(--panel)', color: '#fff', transition: 'all .15s' }}>{picked.has(a.id) && Icon.check({ size: 10, strokeWidth: 3 })}</span></div>
                    <div className="py-cell"><b style={{ display: 'flex', alignItems: 'center', gap: 4 }}>🗓️ {fmtDayLabel(a.date)}</b></div>
                    <div className="py-idcell"><div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><PersonAvatar p={clientOf(a.clientIds?.[0])} size={20} /><b style={{ fontSize: 11 }}>{c.name || '—'}</b></div></div>
                    <div className="py-cell"><span className="tag soft" style={{ fontSize: 10, display: 'inline-flex', alignItems: 'center', gap: 3 }}>🏥 {c.insurer || 'Self-pay'}</span></div>
                    <div className="py-cell"><span className="ln-code" style={{ fontSize: 10, padding: '2px 6px', borderRadius: 6, background: 'var(--panel-2)', border: '1px solid var(--line)' }}>{a.billing?.mileage && !a.billing?.units ? '14220' : a.billing?.code || '—'}</span></div>
                    <div className="py-cell muted" style={{ fontSize: 11 }}>{a.billing?.mileage && !a.billing?.units ? `🚗 ${a.billing?.distance} mi` : `${a.billing?.units}u × $${a.billing?.rate}`}</div>
                    <div className="py-cell muted" style={{ fontSize: 10 }} title={prov?.npi || 'No NPI'}>{prov?.name?.split(' ')[0] || a.staffIds?.[0] || '—'}<i style={{ display: 'block', fontSize: 9, color: prov?.npi ? '#10b981' : '#ef4444' }}>{prov?.npi ? `✓ NPI …${prov.npi.slice(-4)}` : '⚠ no NPI'}</i></div>
                    <div className={`py-cell muted ${timely.amber ? 'warn' : ''} ${timely.over ? 'danger' : ''}`} style={{ fontSize: 10, color: timely.over ? '#ef4444' : timely.amber ? '#f59e0b' : undefined, fontWeight: timely.over ? 700 : 400 }} title={`Filing due ${timely.due}`}>{timely.over ? `🚨 ${-timely.daysLeft}d overdue` : timely.amber ? `⏰ ${timely.daysLeft}d left` : `✓ ${timely.daysLeft}d`}</div>
                    <div className="py-cell num"><b style={{ color: '#059669' }}>{money(computeBilling(a))}</b></div>
                    <div className="py-cell"><button className="iconbtn" style={{ width: 28, height: 28, borderRadius: 8, background: 'var(--panel-2)' }} title="Open source appointment" onClick={() => actions.setUI({ section: 'calendar', anchor: a.date, openAppt: a.id })}>{Icon.chevronR({ size: 12 })}</button></div>
                    <div className="py-cell"><button className="iconbtn" style={{ width: 28, height: 28, borderRadius: 8, background: prov?.npi ? '#ecfdf5' : '#fef2f2' }} title={prov ? `Open ${prov.name} in Provider Identifier` : 'No provider'} data-testid={`bil-npi-${i}`} onClick={() => { if (prov) actions.setUI({ section: 'bil-providers' }) }}>{Icon.badge({ size: 11 })}</button></div>
                  </div>
                )
              })}
              {!staged.length && <div className="py-empty" style={{ padding: 40, textAlign: 'center' }}><div style={{ width: 64, height: 64, borderRadius: 16, background: 'linear-gradient(135deg,#6366f122,#8b5cf611)', display: 'grid', placeItems: 'center', margin: '0 auto 12px', fontSize: 28 }}>📭</div><b>{blocked.length ? `Nothing claim-ready — ${blocked.length} blocked line(s) need fixes 🔧` : 'Everything in this window is on a claim or paid ✓'}</b><div className="muted" style={{ fontSize: 11, marginTop: 4 }}>Slide the range or check the desk.</div></div>}
            </div>
          </div>
          <div className="panel" style={{ borderRadius: 16, overflow: 'hidden', boxShadow: 'var(--shadow-1)', position: 'sticky', top: 16, border: '1px solid var(--line)' }}>
            <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--line)', background: 'linear-gradient(135deg,#10b98122,#05966911)', display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ width: 36, height: 36, borderRadius: 10, background: 'linear-gradient(135deg,#10b981,#059669)', color: '#fff', display: 'grid', placeItems: 'center', boxShadow: '0 4px 12px #10b98140' }}>{Icon.file({ size: 16 })}</span>
              <div><b style={{ fontSize: 13 }}>Claim Forms Preview</b><div className="muted" style={{ fontSize: 11 }}>{picked.size ? 'selection 🎯' : 'all staging'} · {plans.length} forms · {money(plans.reduce((t, p) => t + p.charges, 0))}</div></div>
            </div>
            <div style={{ padding: 12 }}>
              {plans.slice(0, 8).map((p, i) => (
                <div key={`${p.clientId}-${i}`} data-testid={`asm-row-${i}`} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '10px 12px', borderRadius: 12, border: '1px solid var(--line)', marginBottom: 8, background: 'var(--panel)', transition: 'transform .12s', cursor: 'default' }}>
                  <PersonAvatar p={clientOf(p.clientId)} size={32} />
                  <span style={{ minWidth: 0, flex: 1 }}><b style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }}>{p.client} {p.mode === 'selfpay' ? '💳' : '🏥'}</b><i style={{ fontSize: 10, color: 'var(--muted)', fontStyle: 'normal', display: 'flex', alignItems: 'center', gap: 4 }}>{p.mode === 'selfpay' ? 'Self-pay invoice' : p.payer} · {p.dosFrom === p.dosTo ? p.dosTo : `${p.dosFrom.slice(5)} → ${p.dosTo.slice(5)}`}</i></span>
                  <span style={{ fontSize: 10, textAlign: 'right', background: 'var(--panel-2)', padding: '4px 8px', borderRadius: 8 }}><span style={{ display: 'block' }}>{p.appts.length} ln · {p.units}u</span><b className="money" style={{ fontSize: 12, color: '#059669' }}>{money(p.charges)}</b></span>
                </div>
              ))}
              {plans.length > 8 && <div className="muted" style={{ fontSize: 11, padding: '4px 10px', textAlign: 'center' }}>+{plans.length - 8} more forms… 📄</div>}
              {!!plans.length && (
                <button className="btn btn-sm btn-primary" style={{ width: '100%', marginTop: 8, borderRadius: 10, height: 40, background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', border: 'none', boxShadow: '0 4px 16px #6366f140', fontWeight: 700 }} onClick={generate} data-testid="asm-generate">
                  {Icon.zap({ size: 14 })} Assemble {plans.length} form{plans.length > 1 ? 's' : ''} · {money(plans.reduce((t, p) => t + p.charges, 0))}
                </button>
              )}
              {!plans.length && <div className="py-empty" style={{ padding: 32, textAlign: 'center' }}><div style={{ fontSize: 32 }}>📄</div><b style={{ fontSize: 12 }}>Import-ready lines appear here as you select staging rows.</b><div className="muted" style={{ fontSize: 11, marginTop: 4 }}>Pick sessions to see claim grouping ✨</div></div>}
            </div>
            <div className="muted" style={{ fontSize: 10.5, padding: '10px 14px', borderTop: '1px dashed var(--line)', lineHeight: 1.5, background: 'var(--panel-2)', display: 'flex', gap: 6 }}>
              <span>💡</span><span>Numbers mint from the {bill.claimPrefix || 'CLM'} sequence; charge lines keep CPT, units, rate & rendering staff. Mileage folds into each visit as 14220.</span>
            </div>
          </div>
        </div>
      )}

      {tab === 'claims' && (
        <div style={{ padding: 16, display: 'grid', gridTemplateColumns: '380px 1fr', gap: 16, alignItems: 'start' }}>
          <div className="panel" style={{ borderRadius: 16, overflow: 'hidden', boxShadow: 'var(--shadow-1)', border: '1px solid var(--line)' }}>
            <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--line)', display: 'flex', gap: 8, alignItems: 'center', background: 'linear-gradient(135deg,#6366f111,#8b5cf611)' }}>
              <span className="sb-search" style={{ flex: 1, minWidth: 0, borderRadius: 10 }}>
                <span className="sic">{Icon.search({ size: 11 })}</span>
                <input placeholder="🔍 Search claim no, client, payer…" value={q} onChange={(e) => setQ(e.target.value)} data-testid="clm-search" style={{ fontSize: 12 }} />
              </span>
              <select className="input" style={{ width: 100, height: 32, borderRadius: 10, fontSize: 11 }} value={sort} onChange={(e) => setSort(e.target.value)} data-testid="clm-sort" aria-label="Sort claims">
                <option value="recent">🕒 Recent</option><option value="$">💲 Value ↓</option><option value="aging">⏰ Oldest</option>
              </select>
            </div>
            <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--line)', display: 'flex', gap: 6, flexWrap: 'wrap', background: 'var(--panel-2)' }} role="tablist" aria-label="Claim status">
              {[['all', 'All', '📋'], ['draft', 'Draft', '📝'], ['submitted', 'Submitted', '📤'], ['denied', 'Denied', '🚫'], ['paid', 'Paid', '✅'], ['void', 'Void', '🗑️']].map(([f, l, ic]) => {
                const n = f === 'all' ? allClaims.length : allClaims.filter((c) => c.status === f).length
                return <button key={f} className={`sf-chip ${statusF === f ? 'on' : ''}`} data-testid={`clm-filter-${f}`} onClick={() => setStatusF(f)} style={{ borderRadius: 20, padding: '5px 12px', fontSize: 11, border: `1px solid ${statusF === f ? 'var(--accent)' : 'var(--line)'}`, background: statusF === f ? 'var(--accent)' : 'var(--panel)', color: statusF === f ? '#fff' : 'var(--text)', display: 'flex', gap: 6, alignItems: 'center', fontWeight: statusF === f ? 700 : 400 }}>{ic} {l}<span style={{ background: statusF === f ? 'rgba(255,255,255,.25)' : 'var(--panel-2)', borderRadius: 10, padding: '1px 6px', fontSize: 10, fontWeight: 700 }}>{n}</span></button>
              })}
            </div>
            <div style={{ maxHeight: 720, overflow: 'auto' }}>
              {list.map((c, i) => {
                const cl = clientOf(c.clientId)
                const age = agingOf(c)
                const isSel = claim?.id === c.id
                return (
                  <button key={c.id} className={`clm-card ${isSel ? 'on' : ''}`} data-testid={`clm-row-${i}`} onClick={() => { setSel(c.id); setDisputed(new Set()) }} style={{ width: '100%', textAlign: 'left', padding: '12px 14px', border: 'none', borderBottom: '1px solid var(--line)', background: isSel ? 'linear-gradient(135deg,#6366f111,#8b5cf611)' : 'var(--panel)', cursor: 'pointer', display: 'block', borderLeft: `3px solid ${isSel ? '#6366f1' : 'transparent'}`, transition: 'all .12s' }}>
                    <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}><b style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }}>📄 {c.no}</b><StatusChip s={c.status} />{gatedIds[c.id] ? <span className="tag warn" style={{ fontSize: 9, display: 'inline-flex', alignItems: 'center', gap: 2 }}>⚠️ {gatedIds[c.id]} gated</span> : null}</span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, marginTop: 6 }}><PersonAvatar p={cl} size={20} />{cl.name || '—'} <i style={{ color: 'var(--muted)', fontStyle: 'normal', background: 'var(--panel-2)', padding: '1px 6px', borderRadius: 6, fontSize: 10 }}>{c.mode === 'selfpay' ? '💳 family invoice' : `🏥 ${c.payer}`}</i></span>
                    <span style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, marginTop: 6, color: 'var(--muted)', background: 'var(--panel-2)', padding: '4px 8px', borderRadius: 6 }}><span>📅 {c.dosFrom.slice(5)} → {c.dosTo.slice(5)} · {c.lines.length} ln</span><span style={{ color: dueOf(c) > 0 ? '#ef4444' : '#10b981', fontWeight: 700 }}>💲 {money(dueOf(c))}</span>{age ? <em style={{ color: age.late ? '#ef4444' : undefined, fontStyle: 'normal', fontWeight: age.late ? 700 : 400 }}>{age.late ? '🚨' : '⏰'} {age.days}d</em> : null}</span>
                  </button>
                )
              })}
              {!list.length && <div className="py-empty" style={{ padding: 40, textAlign: 'center' }}><div style={{ width: 64, height: 64, borderRadius: 16, background: 'var(--panel-2)', display: 'grid', placeItems: 'center', margin: '0 auto 12px', fontSize: 28 }}>📭</div><b>No claims match{q ? ' that search' : ''}</b><div className="muted" style={{ fontSize: 11, marginTop: 4 }}>Assemble some from Staging, or clear filter.</div></div>}
            </div>
          </div>

          {claim ? <ClaimForm claim={claim} gated={gatedIds[claim.id]} disputed={disputed} setDisputed={setDisputed} payOpen={payOpen} setPayOpen={setPayOpen} denyOpen={denyOpen} setDenyOpen={setDenyOpen} onSubmit={() => submit(claim.id)} onVoid={() => voidClaim(claim.id)} onRebill={() => rebill(claim.id)} onWriteOff={() => writeOff(claim.id)} onDropLine={(aid) => dropLine(claim.id, aid)} clientOf={clientOf} staffOf={staffOf} /> : (
            <div className="panel" style={{ borderRadius: 16, padding: 40, textAlign: 'center', border: '1px dashed var(--line)' }}><div style={{ width: 80, height: 80, borderRadius: 20, background: 'linear-gradient(135deg,#6366f122,#8b5cf611)', display: 'grid', placeItems: 'center', margin: '0 auto 16px', fontSize: 36 }}>💲</div><h3 style={{ margin: '0 0 8px' }}>The desk is empty</h3><p className="muted" style={{ fontSize: 12 }}>Assemble staging lines into claim forms and they'll queue here for submission, payment posting and denials.</p><button className="btn btn-sm btn-primary" onClick={() => setTab('stage')} style={{ marginTop: 16, borderRadius: 10, height: 36 }}>📋 Go to staging</button></div>
          )}
        </div>
      )}

      {tab === 'secondary' && (
        <div style={{ padding: 16 }}>
          <div className="panel" data-testid="bil-secondary" style={{ borderRadius: 16, overflow: 'hidden', boxShadow: 'var(--shadow-1)', border: '1px solid var(--line)' }}>
            <div style={{ padding: '16px 18px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 12, background: 'linear-gradient(135deg,#6366f111,#8b5cf611)' }}>
              <span style={{ width: 40, height: 40, borderRadius: 12, background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: '#fff', display: 'grid', placeItems: 'center', boxShadow: '0 4px 12px #6366f140' }}>{Icon.shield({ size: 18 })}</span>
              <div><b style={{ fontSize: 14, display: 'flex', alignItems: 'center', gap: 6 }}>🔗 Secondary Queue <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 20, background: '#6366f1', color: '#fff' }}>{Object.values(claims).filter((c) => secondaryEligible(state, c)).length} eligible</span></b><div className="muted" style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 6 }}>Clients with secondary + partially-paid claims ready to file 🏥→🏥</div></div>
              <span className="muted" style={{ marginLeft: 'auto', fontSize: 11, background: 'var(--panel-2)', padding: '6px 12px', borderRadius: 20 }}>{(state.clients || []).filter((c) => c.secondary).length} clients have secondary</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, padding: 16 }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}><span style={{ width: 24, height: 24, borderRadius: 6, background: '#6366f1', color: '#fff', display: 'grid', placeItems: 'center' }}>👥</span><b style={{ fontSize: 12 }}>COB Clients</b><span className="tag soft" style={{ fontSize: 10, borderRadius: 20 }}>{(state.clients || []).filter((c) => c.secondary).length} with secondary</span></div>
                <div className="sec-clients-render" data-testid="sec-clients-render" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {(state.clients || []).filter((c) => c.secondary).map((c) => {
                    const sec = c.secondary; const payer = (state.payers || []).find((p) => p.id === sec.payerId)
                    return (
                      <div key={c.id} data-testid={`sec-client-${c.id}`} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '10px 14px', borderRadius: 12, border: '1px solid var(--line)', background: 'var(--panel)', boxShadow: 'var(--shadow-1)' }}>
                        <PersonAvatar p={c} size={32} />
                        <span style={{ minWidth: 0, flex: 1 }}><b style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }}>{c.name} <span style={{ fontSize: 9, color: '#6366f1' }}>🔗</span></b><i style={{ display: 'block', fontSize: 10, color: 'var(--muted)', fontStyle: 'normal' }}>🏥 {c.insurer} → {payer?.name || sec.payerId}</i></span>
                        <span className="ln-code" style={{ fontSize: 10, background: 'var(--panel-2)', padding: '2px 6px', borderRadius: 6 }}>{sec.memberId || '—'}</span>
                        <span className="tag soft" style={{ fontSize: 10, borderRadius: 20 }}>{sec.relation}</span>
                      </div>
                    )
                  })}
                  {!(state.clients || []).some((c) => c.secondary) && <div className="py-empty" style={{ padding: 32, textAlign: 'center', borderRadius: 12, border: '1px dashed var(--line)' }}><div style={{ fontSize: 32 }}>👥</div><b>No secondary clients</b><div className="muted" style={{ fontSize: 11 }}>Add from Clients directory → secondary insurance</div></div>}
                </div>
              </div>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}><span style={{ width: 24, height: 24, borderRadius: 6, background: '#10b981', color: '#fff', display: 'grid', placeItems: 'center' }}>💲</span><b style={{ fontSize: 12 }}>Eligible Claims</b><span className="tag soft" style={{ fontSize: 10, borderRadius: 20, background: '#ecfdf5', color: '#059669' }}>{Object.values(claims).filter((c) => secondaryEligible(state, c)).length} ready to file</span></div>
                <div data-testid="sec-claims" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {Object.values(claims).filter((c) => secondaryEligible(state, c)).map((c) => {
                    const cl = clientOf(c.clientId)
                    const secClient = (state.clients || []).find((x) => x.id === c.clientId)
                    const secPayerName = secClient?.secondary ? (state.payers || []).find((p) => p.id === secClient.secondary.payerId)?.name || secClient.secondary.payerId : '—'
                    return (
                      <div key={c.id} data-testid={`sec-claim-${c.id}`} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '10px 14px', borderRadius: 12, border: '1px solid #10b98130', background: 'linear-gradient(135deg,#ecfdf511,#fff)', boxShadow: 'var(--shadow-1)' }}>
                        <span style={{ width: 28, height: 28, borderRadius: 8, background: '#10b981', color: '#fff', display: 'grid', placeItems: 'center', fontSize: 12 }}>💳</span><b style={{ fontSize: 11 }}>{c.no}</b><span style={{ fontSize: 11 }}>{cl.name || '—'}</span><span className="muted" style={{ fontSize: 10, flex: 1, background: 'var(--panel-2)', padding: '2px 8px', borderRadius: 20 }}>{c.payer} → {secPayerName}</span><span className="r money" style={{ fontSize: 11, fontWeight: 700, color: '#059669' }}>{money(dueOf(c))} due</span><button className="btn btn-xs btn-primary" data-testid={`sec-file-${c.id}`} onClick={() => { const r = actions.fileSecondaryClaim(c.id); toast({ message: r.msg, kind: r.ok ? 'ok' : 'warn' }); if (r.ok && r.newId) { setTab('claims'); setSel(r.newId) } }} style={{ borderRadius: 8 }}>{Icon.file({ size: 11 })} File secondary</button>
                      </div>
                    )
                  })}
                  {!Object.values(claims).filter((c) => secondaryEligible(state, c)).length && <div className="py-empty" style={{ padding: 32, textAlign: 'center', borderRadius: 12, border: '1px dashed var(--line)' }}><div style={{ fontSize: 32 }}>✅</div><b>No claims need secondary filing</b><div className="muted" style={{ fontSize: 11 }}>Partially-paid claims with client secondary appear here</div></div>}
                </div>
              </div>
            </div>
            <div className="muted" style={{ fontSize: 11, padding: '12px 16px', borderTop: '1px dashed var(--line)', background: 'var(--panel-2)', display: 'flex', gap: 8, alignItems: 'center' }}>
              <span style={{ width: 20, height: 20, borderRadius: 6, background: '#6366f1', color: '#fff', display: 'grid', placeItems: 'center', fontSize: 10 }}>💡</span> Secondary claims inherit primary's charge lines, set method=secondary, and link back via secondary field. Filing deadline uses secondary payer's ext.filingDeadlineDays or global default.
            </div>
          </div>
        </div>
      )}

      {tab === 'blocked' && (
        <div style={{ padding: 16 }}>
          <div className="panel" style={{ borderRadius: 16, overflow: 'hidden', boxShadow: 'var(--shadow-1)', border: '1px solid var(--line)' }}>
            <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 10, background: 'linear-gradient(135deg,#ef444411,#f8717111)' }}>
              <span style={{ width: 36, height: 36, borderRadius: 10, background: 'linear-gradient(135deg,#ef4444,#dc2626)', color: '#fff', display: 'grid', placeItems: 'center', boxShadow: '0 4px 12px #ef444440' }}>{Icon.ban({ size: 16 })}</span>
              <div><b style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>🚫 Blocked Lines — {blocked.length} <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 20, background: '#ef4444', color: '#fff' }}>{money(blocked.reduce((t, r) => t + r.estCharge, 0))} held</span></b><span className="muted" style={{ fontSize: 11 }}>Fix billing completeness or verification gates to release to staging 🔧</span></div>
            </div>
            <div className="py-tbl">
              <div className="py-thead" style={{ gridTemplateColumns: '70px 90px 1.2fr 2fr 100px 90px 70px', background: 'var(--panel-2)', fontSize: 11 }}><span>🚦 Type</span><span>📅 Date</span><span>👤 Client</span><span>📝 Issue</span><span>Est. Charge</span><span>Fix</span><span></span></div>
              {blocked.map((r, i) => (
                <div key={i} data-testid={`blk-row-${i}`} className="py-trow" style={{ gridTemplateColumns: '70px 90px 1.2fr 2fr 100px 90px 70px', fontSize: 11 }}>
                  <div className="py-cell"><span className={`sev-pill ${/0 billable|no billing/i.test(r.issues) ? 'sev-error' : ''}`} style={{ fontSize: 10, padding: '3px 8px', borderRadius: 20, background: /0 billable|no billing/i.test(r.issues) ? '#fee2e2' : '#fef3c7', display: 'inline-flex', alignItems: 'center', gap: 3 }}>{/0 billable|no billing/i.test(r.issues) ? '💲 billing' : '🚧 gate'}</span></div>
                  <div className="py-cell"><b>📅 {fmtDayLabel(r.date)}</b></div>
                  <div className="py-cell" style={{ display: 'flex', alignItems: 'center', gap: 6 }}><PersonAvatar p={clients.find((c) => c.name === r.client)} size={20} />{r.client}</div>
                  <div className="py-cell muted" style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }}>⚠️ {r.issues}</div>
                  <div className="py-cell num" style={{ color: '#ef4444', fontWeight: 700 }}>{money(r.estCharge)}</div>
                  <div className="py-cell">{/billable units|rate is \$0|no billing/i.test(r.issues) && bill.autoUnits !== false && <button className="btn btn-xs" data-testid={`blk-fix-${i}`} onClick={() => autoFix(r._link.id)} title="Compute units" style={{ borderRadius: 8, background: '#10b981', color: '#fff' }}>{Icon.zap({ size: 11 })} Auto-fix</button>}</div>
                  <div className="py-cell"><button className="btn btn-xs btn-ghost" onClick={() => actions.setUI({ section: 'calendar', anchor: r.date, openAppt: r._link.id })} style={{ borderRadius: 8 }}>Open 📅</button></div>
                </div>
              ))}
              {!blocked.length && <div className="py-empty" style={{ padding: 48, textAlign: 'center' }}><div style={{ width: 80, height: 80, borderRadius: 20, background: 'linear-gradient(135deg,#10b98122,#05966911)', display: 'grid', placeItems: 'center', margin: '0 auto 12px', fontSize: 32 }}>✅</div><b>No blocked lines in this window ✓</b><div className="muted" style={{ fontSize: 11 }}>All sessions are claim-ready or already claimed</div></div>}
            </div>
          </div>
        </div>
      )}

      {tab === 'setup' && (
        <div style={{ padding: 16, display: 'grid', gridTemplateColumns: '400px 1fr', gap: 16, alignItems: 'start' }}>
          <div className="panel" style={{ borderRadius: 16, padding: 18, boxShadow: 'var(--shadow-1)', border: '1px solid var(--line)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
              <span style={{ width: 40, height: 40, borderRadius: 12, background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: '#fff', display: 'grid', placeItems: 'center', boxShadow: '0 4px 12px #6366f140' }}>{Icon.pin({ size: 16 })}</span>
              <div><b style={{ fontSize: 14 }}>🏢 Practice Identity</b><div className="muted" style={{ fontSize: 11 }}>Printed on claim forms, CMS-1500 & invoices</div></div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {[['name', 'Practice name', '🏢'], ['taxId', 'Tax ID', '🆔'], ['npi', 'Facility / billing NPI', '🏥'], ['address', 'Address', '📍'], ['phone', 'Phone', '📞']].map(([k, l, ic]) => (
                <label key={k} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}><span style={{ fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 4 }} className="muted">{ic} {l}</span><input className="input" style={{ borderRadius: 10, height: 38 }} data-testid={`bi-${k}`} value={settings.org?.[k] || ''} onChange={(e) => setOrg({ [k]: e.target.value })} /></label>
              ))}
            </div>
            <div className="panel" style={{ marginTop: 16, padding: 12, borderRadius: 12, background: 'linear-gradient(135deg,#6366f111,#8b5cf611)', border: '1px dashed #6366f140', fontSize: 11, lineHeight: 1.5, display: 'flex', gap: 8 }}>
              <span style={{ fontSize: 16 }}>📄</span><span><b>CMS-1500 (02/12)</b> PDFs map boxes 1–33 from this identity + client demographics. Clearinghouses expect electronic twin — <b>ANSI 837P</b> — built from same fields.</span>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="panel" style={{ borderRadius: 16, padding: 18, boxShadow: 'var(--shadow-1)', border: '1px solid var(--line)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
                <span style={{ width: 40, height: 40, borderRadius: 12, background: 'linear-gradient(135deg,#10b981,#059669)', color: '#fff', display: 'grid', placeItems: 'center', boxShadow: '0 4px 12px #10b98140' }}>{Icon.dollar({ size: 16 })}</span>
                <div><b style={{ fontSize: 14 }}>💲 Rate & Numbering Policy</b><div className="muted" style={{ fontSize: 11 }}>Claim numbers & billing rates</div></div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
                {[['defaultRate', 'Default unit rate $', '💵'], ['mileageRate', 'Mileage $/mi', '🚗'], ['invoicePrefix', 'Invoice prefix', '📄', true], ['dueDays', 'Net terms (days)', '📅']].map(([k, l, ic, text]) => (
                  <label key={k} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}><span style={{ fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 4 }} className="muted">{ic} {l}</span><input className="input" style={{ borderRadius: 10, height: 38 }} data-testid={`bi-${k}`} type={text ? 'text' : 'number'} step={k === 'mileageRate' ? 0.05 : 1} value={k === 'invoicePrefix' ? bill.invoicePrefix || '' : settings[k]} onChange={(e) => (k === 'invoicePrefix' ? setBill({ invoicePrefix: e.target.value }) : actions.setSettings({ [k]: Number(e.target.value) || 0 }))} /></label>
                ))}
                <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}><span style={{ fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 4 }} className="muted">🔢 Claim prefix</span><input className="input" style={{ borderRadius: 10, height: 38 }} data-testid="bi-claimPrefix" value={bill.claimPrefix || 'CLM'} onChange={(e) => setBill({ claimPrefix: e.target.value.toUpperCase() || 'CLM' })} /></label>
              </div>
              <div className="muted" style={{ fontSize: 11, marginTop: 10, display: 'flex', gap: 6, background: 'var(--panel-2)', padding: '8px 12px', borderRadius: 8 }}><span>💡</span>Claim numbers mint as <code style={{ background: 'var(--panel)', padding: '2px 6px', borderRadius: 4 }}>{bill.claimPrefix || 'CLM'}-YYYYMM-###</code>; rebills append -R2, -R3…</div>
            </div>
            <div className="panel" style={{ borderRadius: 16, padding: 18, boxShadow: 'var(--shadow-1)', border: '1px solid var(--line)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
                <span style={{ width: 40, height: 40, borderRadius: 12, background: 'linear-gradient(135deg,#f59e0b,#f97316)', color: '#fff', display: 'grid', placeItems: 'center', boxShadow: '0 4px 12px #f59e0b40' }}>{Icon.checkCircle({ size: 16 })}</span>
                <div><b style={{ fontSize: 14 }}>🚦 Claim Gates</b><div className="muted" style={{ fontSize: 11 }}>Validation before submission</div></div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 12, border: '1px solid var(--line)', background: bill.requireVerification !== false ? 'linear-gradient(135deg,#ecfdf5,#fff)' : 'var(--panel)', boxShadow: 'var(--shadow-1)' }}>
                  <span className={`cb ${bill.requireVerification !== false ? 'on' : ''}`} role="checkbox" aria-checked={bill.requireVerification !== false} data-testid="bi-requirever" onClick={() => setBill({ requireVerification: bill.requireVerification === false })} style={{ width: 24, height: 24, borderRadius: 8, border: '2px solid var(--line)', display: 'grid', placeItems: 'center', cursor: 'pointer', background: bill.requireVerification !== false ? '#10b981' : 'var(--panel)', color: '#fff' }}>{bill.requireVerification !== false && Icon.check({ size: 12, strokeWidth: 3 })}</span>
                  <div><b style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>✅ Require session verification before a line can go on a claim</b><span className="muted" style={{ fontSize: 11 }}>🔒 {blocked.filter((b) => /verification/i.test(b.issues)).length} lines gated right now · drafts holding gates are flagged ⚠️</span></div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 12, border: '1px solid var(--line)', background: bill.autoUnits !== false ? 'linear-gradient(135deg,#eff6ff,#fff)' : 'var(--panel)', boxShadow: 'var(--shadow-1)' }}>
                  <span className={`cb ${bill.autoUnits !== false ? 'on' : ''}`} role="checkbox" aria-checked={bill.autoUnits !== false} data-testid="bi-autounits" onClick={() => setBill({ autoUnits: bill.autoUnits === false })} style={{ width: 24, height: 24, borderRadius: 8, border: '2px solid var(--line)', display: 'grid', placeItems: 'center', cursor: 'pointer', background: bill.autoUnits !== false ? '#6366f1' : 'var(--panel)', color: '#fff' }}>{bill.autoUnits !== false && Icon.check({ size: 12, strokeWidth: 3 })}</span>
                  <div><b style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>⚡ Auto-fill units from duration & code</b><span className="muted" style={{ fontSize: 11 }}>Powers the one-click fixes on Blocked 🔧</span></div>
                </div>
              </div>
              <div style={{ marginTop: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}><span style={{ width: 24, height: 24, borderRadius: 6, background: '#6366f1', color: '#fff', display: 'grid', placeItems: 'center' }}>📋</span><b style={{ fontSize: 12 }}>CPT Code Table — Shared Reference</b></div>
                <div className="py-tbl" style={{ borderRadius: 12, overflow: 'hidden', border: '1px solid var(--line)', boxShadow: 'var(--shadow-1)' }}>
                  <div className="py-thead" style={{ gridTemplateColumns: '90px 1fr 80px 80px', background: 'var(--panel-2)', fontSize: 11 }}><span>🔢 Code</span><span>📝 Description</span><span className="r">⏱️ Unit</span><span className="r">💲 Rate</span></div>
                  {BILL_CODES.map((c) => (
                    <div key={c.id} className="py-trow" style={{ gridTemplateColumns: '90px 1fr 80px 80px', fontSize: 11 }}>
                      <div className="py-cell"><b style={{ background: 'var(--panel-2)', padding: '2px 6px', borderRadius: 6 }}>{c.id}</b></div><div className="py-cell">{c.label.split(' · ')[1]}</div><div className="py-cell r">{c.unitMins} min</div><div className="py-cell r money" style={{ fontWeight: 700, color: '#059669' }}>${c.rate}</div>
                    </div>
                  ))}
                </div>
                <div className="muted" style={{ fontSize: 11, marginTop: 8, display: 'flex', gap: 6 }}><span>💡</span>The shared code table — wizard, this page and every claim line stay in lockstep.</div>
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
    <section className="clm-doc panel" data-testid="clm-form" style={{ borderRadius: 16, overflow: 'hidden', boxShadow: 'var(--shadow-1)', border: '1px solid var(--line)' }}>
      <header style={{ padding: '14px 18px', borderBottom: '1px solid var(--line)', background: 'linear-gradient(135deg,var(--panel-2),var(--panel))' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span className={`cd-mode ${claim.mode}`} style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.6, padding: '3px 10px', borderRadius: 20, background: claim.mode === 'selfpay' ? 'linear-gradient(135deg,#fef3c7,#fde68a)' : 'linear-gradient(135deg,#dbeafe,#bfdbfe)', border: '1px solid var(--line)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>{claim.mode === 'selfpay' ? '💳 INVOICE' : '📄 CLAIM'}</span>
          <h2 style={{ fontSize: 16, margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>{claim.no}{claim.version > 1 ? <em style={{ fontSize: 11, background: '#6366f1', color: '#fff', padding: '2px 8px', borderRadius: 20 }} title={`Rebill of ${claim.parentNo}`}>v{claim.version}</em> : null}</h2>
          <StatusChip s={claim.status} />
          {age ? <span className={`cd-aging ${age.late ? 'late' : ''}`} data-testid="clm-aging" style={{ fontSize: 11, padding: '3px 10px', borderRadius: 20, background: age.late ? '#fee2e2' : '#ecfdf5', border: `1px solid ${age.late ? '#fecaca' : '#a7f3d0'}`, display: 'inline-flex', alignItems: 'center', gap: 4 }}>{age.late ? '🚨' : '⏰'} {age.days} days out{age.late ? ' — past cycle' : ''}</span> : null}
          {gated ? <span className="tag warn" style={{ fontSize: 10, borderRadius: 20, display: 'inline-flex', alignItems: 'center', gap: 3 }}>⚠️ {gated} gated</span> : null}
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 12 }}>
          {claim.status === 'draft' && <button className="btn btn-xs btn-primary" data-testid="clm-submit" onClick={onSubmit} title={gate.ok ? 'Run gates & send to payer' : `${gate.bad.length} line(s) fail gates`} style={{ borderRadius: 8, background: 'linear-gradient(135deg,#10b981,#059669)', border: 'none' }}>{Icon.check({ size: 11 })} Submit {claim.mode === 'selfpay' ? 'invoice' : 'to payer'} 📤</button>}
          {claim.status === 'submitted' && (
            <>
              <button className="btn btn-xs btn-primary" data-testid="clm-pay" onClick={() => setPayOpen(true)} style={{ borderRadius: 8, background: 'linear-gradient(135deg,#10b981,#059669)', border: 'none' }}>{Icon.dollar({ size: 11 })} Post payment 💵</button>
              <button className="btn btn-xs" data-testid="clm-deny" onClick={() => setDenyOpen(true)} style={{ borderRadius: 8 }}>{Icon.ban({ size: 11 })} Record denial 🚫</button>
            </>
          )}
          {claim.status === 'partially_paid' && client?.secondary && !claim.secondary && <button className="btn btn-xs btn-primary" data-testid="clm-file-sec" onClick={() => { const r = actions.fileSecondaryClaim(claim.id); toast({ message: r.msg, kind: r.ok ? 'ok' : 'warn' }) }} style={{ borderRadius: 8 }}>{Icon.file({ size: 11 })} File secondary 🔗</button>}
          {claim.status === 'denied' && (
            <>
              <button className="btn btn-xs btn-primary" data-testid="clm-rebill" onClick={onRebill} style={{ borderRadius: 8, background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', border: 'none' }}>{Icon.repeat({ size: 11 })} Rebill{disputed.size ? ` (drop ${disputed.size})` : ''} 🔄</button>
              <button className="btn btn-xs" data-testid="clm-writeoff" onClick={onWriteOff} title="Close with zero payment" style={{ borderRadius: 8 }}>{Icon.file({ size: 11 })} Write off 🗑️</button>
            </>
          )}
          {(claim.status === 'draft' || claim.status === 'submitted') && <button className="btn btn-xs" data-testid="clm-void" onClick={onVoid} title="Void & release lines" style={{ borderRadius: 8 }}>{Icon.trash({ size: 11 })} Void</button>}
          <button className="btn btn-xs" data-testid="clm-cms1500" onClick={export1500} title={claim.mode === 'selfpay' ? 'Printable CMS-1500 courtesy' : 'CMS-1500 PDF'} style={{ borderRadius: 8, background: 'var(--panel-2)' }}>{Icon.print({ size: 11 })} CMS-1500 {claim.mode === 'selfpay' ? '· courtesy 📄' : 'PDF 📄'}</button>
          <span style={{ width: 1, height: 20, background: 'var(--line)' }} />
          <button className="btn btn-xs" onClick={() => { download(`${claim.no}.csv`, claimCsv(state, claim)); toast({ message: `${claim.no} exported`, kind: 'ok' }) }} data-testid="clm-csv" style={{ borderRadius: 8 }}>{Icon.download({ size: 11 })} CSV</button>
          <button className="btn btn-xs" onClick={() => window.print()} data-testid="clm-print" style={{ borderRadius: 8 }}>{Icon.print({ size: 11 })} Print</button>
        </div>
        <div style={{ display: 'flex', gap: 16, marginTop: 12, fontSize: 11, background: 'var(--panel)', padding: '8px 12px', borderRadius: 10, border: '1px solid var(--line)' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>💰 charges<b style={{ marginLeft: 4 }}>{money(claim.charges)}</b></span>
          {claim.adj ? <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>📉 adjustments<b className="neg" style={{ marginLeft: 4, color: '#ef4444' }}>-{money(claim.adj)}</b></span> : null}
          {claim.status === 'paid' ? <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>✅ paid<b className="pos" style={{ marginLeft: 4, color: '#10b981' }}>{money(claim.paid)}</b></span> : <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>💳 due<b className={due > 0 ? 'due' : 'pos'} style={{ marginLeft: 4, color: due > 0 ? '#ef4444' : '#10b981' }}>{money(due)}</b></span>}
        </div>
      </header>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 1, background: 'var(--line)' }}>
        <div style={{ background: 'var(--panel)', padding: '12px 14px' }}><i style={{ fontSize: 10, color: 'var(--muted)', fontStyle: 'normal', display: 'flex', alignItems: 'center', gap: 4 }}>🏢 1 · Billing provider</i><b style={{ fontSize: 11 }}>{org.name || 'Practice'}</b><p style={{ fontSize: 10, margin: '4px 0 0', color: 'var(--muted)' }}>{org.address} · {org.phone}<br />Tax ID {org.taxId} · NPI {npiOf('s12')}</p></div>
        <div style={{ background: 'var(--panel)', padding: '12px 14px' }}><i style={{ fontSize: 10, color: 'var(--muted)', fontStyle: 'normal', display: 'flex', alignItems: 'center', gap: 4 }}>👤 2 · Insured / patient</i><b style={{ fontSize: 11 }}>{client.name || '—'}</b><p style={{ fontSize: 10, margin: '4px 0 0', color: 'var(--muted)' }}>{client.program}{client.guardian ? ` · Guardian ${client.guardian}` : ''}<br />Member ID {memberIdOf({ id: client.id, insurer: claim.payer })}</p></div>
        <div style={{ background: 'var(--panel)', padding: '12px 14px' }}><i style={{ fontSize: 10, color: 'var(--muted)', fontStyle: 'normal', display: 'flex', alignItems: 'center', gap: 4 }}>🏥 3 · Payer</i><b style={{ fontSize: 11 }}>{claim.mode === 'selfpay' ? 'Self-pay account 💳' : claim.payer}</b><p style={{ fontSize: 10, margin: '4px 0 0', color: 'var(--muted)' }}>{claim.mode === 'selfpay' ? `Net ${settings.billing?.dueDays || 30} days` : `Policy ${claim.payer.split(' ').map((w) => w[0]).join('').toUpperCase()}${String(14000 + (client.id.charCodeAt(1) * 137) % 8999)}`}<br />Auth {authNoOf(client)} · {claim.mode === 'selfpay' ? 'family responsibility' : 'rendering NPI ' + npiOf(firstAppt?.staffIds?.[0])}</p></div>
        <div style={{ background: 'var(--panel)', padding: '12px 14px' }}><i style={{ fontSize: 10, color: 'var(--muted)', fontStyle: 'normal', display: 'flex', alignItems: 'center', gap: 4 }}>📋 4 · Referral / prior</i><b style={{ fontSize: 11 }}>BCBA plan of care</b><p style={{ fontSize: 10, margin: '4px 0 0', color: 'var(--muted)' }}>{staffOf('s1')?.name || 'Prateek Kiran'}, BCBA<br />{claim.parentNo ? `Prior claim ${claim.parentNo} (v${claim.version})` : 'No prior submission'}</p></div>
        <div style={{ background: 'var(--panel)', padding: '12px 14px' }}><i style={{ fontSize: 10, color: 'var(--muted)', fontStyle: 'normal', display: 'flex', alignItems: 'center', gap: 4 }}>🩺 9 · Diagnosis</i><b style={{ fontSize: 11 }}>{dx.join(' · ')}</b></div>
        <div style={{ background: 'var(--panel)', padding: '12px 14px' }}><i style={{ fontSize: 10, color: 'var(--muted)', fontStyle: 'normal', display: 'flex', alignItems: 'center', gap: 4 }}>📅 6–7 · Service period</i><b style={{ fontSize: 11 }}>{claim.dosFrom} → {claim.dosTo}</b><p style={{ fontSize: 10, margin: '4px 0 0', color: 'var(--muted)' }}>{claim.lines.length} lines · {claim.units} units{claim.submittedAt ? ` · submitted ${isoDate(new Date(claim.submittedAt))}` : ' · not yet submitted'}</p></div>
        <div style={{ background: 'var(--panel)', padding: '12px 14px' }}><i style={{ fontSize: 10, color: 'var(--muted)', fontStyle: 'normal', display: 'flex', alignItems: 'center', gap: 4 }}>🏥 32 · Facility</i><b style={{ fontSize: 11 }}>{facility}</b><p style={{ fontSize: 10, margin: '4px 0 0', color: 'var(--muted)' }}>{org.address} · signature on file ✍️</p></div>
        <div style={{ background: 'var(--panel)', padding: '12px 14px' }}><i style={{ fontSize: 10, color: 'var(--muted)', fontStyle: 'normal', display: 'flex', alignItems: 'center', gap: 4 }}>👨‍⚕️ 33a · Rendering</i><b style={{ fontSize: 11 }}>{[...new Set(claim.lines.map((l) => l.staff))].join(', ') || '—'}</b><p style={{ fontSize: 10, margin: '4px 0 0', color: 'var(--muted)' }}>NPI {npiOf(firstAppt?.staffIds?.[0])} · supervision {(staffOf('s1')?.name)} BCBA #5-12-0034</p></div>
      </div>

      <div className={`cd-banner ${claim.status === 'denied' ? 'danger' : claim.status === 'paid' ? 'ok' : gated ? 'warn' : 'info'}`} data-testid="clm-banner" style={{ padding: '12px 16px', display: 'flex', gap: 10, alignItems: 'flex-start', background: claim.status === 'denied' ? 'linear-gradient(135deg,#fef2f2,#fee2e2)' : claim.status === 'paid' ? 'linear-gradient(135deg,#ecfdf5,#d1fae5)' : gated ? 'linear-gradient(135deg,#fffbeb,#fef3c7)' : 'linear-gradient(135deg,#eff6ff,#dbeafe)', borderTop: '1px solid var(--line)', borderBottom: '1px solid var(--line)', fontSize: 11, borderLeft: `4px solid ${claim.status === 'denied' ? '#ef4444' : claim.status === 'paid' ? '#10b981' : gated ? '#f59e0b' : '#3b82f6'}` }}>
        {claim.timelyDue && (() => { const today = new Date().toISOString().slice(0, 10); const overdue = today > claim.timelyDue; return overdue ? <><span className="sev-pill sev-error" style={{ fontSize: 10, borderRadius: 20 }}>🚨 timely filing past due {claim.timelyDue}</span></> : <><span className="sev-pill sev-notice" style={{ fontSize: 10, borderRadius: 20 }}>⏰ filing due {claim.timelyDue}</span></> })()}
        {claim.method === 'secondary' && <><span className="tag" style={{ fontSize: 10, borderRadius: 20 }}>🔗 secondary of {claim.parentNo || claim.secondary || ''}</span></>}
        {claim.secondary && claim.method !== 'secondary' && <><span className="tag ok" style={{ fontSize: 10, borderRadius: 20 }}>✅ secondary filed → {typeof claim.secondary === 'string' && claim.secondary.startsWith('clm-') ? (state.claims[claim.secondary]?.no || claim.secondary) : claim.secondary}</span></>}
        {claim.status === 'denied' && <><span style={{ width: 24, height: 24, borderRadius: 8, background: '#ef4444', color: '#fff', display: 'grid', placeItems: 'center', flex: 'none' }}>{Icon.alert({ size: 12 })}</span><span><b>🚫 {claim.denial.reason}.</b> {claim.denial.fix}. {claim.denial.at ? `Denied ${relDay(claim.denial.at)}.` : ''} {claim.lines.length > disputed.size && disputed.size > 0 ? `${disputed.size} line(s) marked disputed — Rebill drops them.` : disputed.size ? 'Rebill will drop every marked line.' : 'Rebill re-drafts this claim.'}</span></>}
        {claim.status === 'paid' && <><span style={{ width: 24, height: 24, borderRadius: 8, background: '#10b981', color: '#fff', display: 'grid', placeItems: 'center' }}>{Icon.check({ size: 12 })}</span><span>✅ <b>{money(claim.paid)}</b> via {claim.remittance?.checkNo || '—'} · deposited {relDay(claim.remittance?.at)}{claim.adj ? ` · ${money(claim.adj)} adj` : ''}{shortPay ? ' — short-pay; re-review.' : ''}</span></>}
        {claim.status === 'submitted' && <><span style={{ width: 24, height: 24, borderRadius: 8, background: '#f59e0b', color: '#fff', display: 'grid', placeItems: 'center' }}>{Icon.clock({ size: 12 })}</span><span>⏳ Waiting on {claim.mode === 'selfpay' ? 'family payment' : claim.payer}{age ? ` — ${age.days} days out, median ${payerPolicy(claim.payer).avgDays} days` : ''}. Post remittance when it lands.</span></>}
        {claim.status === 'draft' && gated ? <><span style={{ width: 24, height: 24, borderRadius: 8, background: '#f59e0b', color: '#fff', display: 'grid', placeItems: 'center' }}>{Icon.alert({ size: 12 })}</span><span><b>⚠️ Submission held:</b> {gate.bad.map((b) => b.why).slice(0, 2).join(' · ')}. Fix on source session or drop line.</span></> : null}
        {claim.status === 'partially_paid' && <><span style={{ width: 24, height: 24, borderRadius: 8, background: '#6366f1', color: '#fff', display: 'grid', placeItems: 'center' }}>{Icon.dollar({ size: 12 })}</span><span>💳 <b>Partially paid</b> — {money(due)} open{client?.secondary ? <> · secondary ready 🔗</> : ' · no secondary'}</span></>}
        {claim.status === 'void' && <><span style={{ width: 24, height: 24, borderRadius: 8, background: '#9ca3af', color: '#fff', display: 'grid', placeItems: 'center' }}>{Icon.ban({ size: 12 })}</span><span>Voided — all {claim.lines.length} line(s) returned to staging.</span></>}
      </div>

      <div className="py-tbl cd-lines" data-testid="clm-lines">
        <div className="py-thead" style={{ gridTemplateColumns: `${editable && claim.status === 'denied' ? '28px ' : ''}24px 70px 70px 70px 1fr 60px 40px 1fr 60px 70px 56px`, background: 'var(--panel-2)', fontSize: 11 }}>
          {editable && claim.status === 'denied' ? <span className="no-print" /> : null}<span>#</span><span>📅 Date</span><span>⏰ Time</span><span>🔢 HCPCS</span><span>📝 Description</span><span>🩺 ICD</span><span>⏱️ Units</span><span>👨‍⚕️ Rendered by</span><span className="r">💲 Rate</span><span className="r">💰 Charge</span><span className="no-print" />
        </div>
        {claim.lines.map((l, i) => {
          const src = appts[l.apptId]
          const isBad = badIds.has(l.apptId)
          return (
            <div key={l.apptId} className={`py-trow ${isBad ? 'gated' : ''} ${disputed.has(l.apptId) ? 'disputed' : ''}`} data-testid={`clm-line-${i}`} style={{ gridTemplateColumns: `${editable && claim.status === 'denied' ? '28px ' : ''}24px 70px 70px 70px 1fr 60px 40px 1fr 60px 70px 56px`, fontSize: 11, background: disputed.has(l.apptId) ? '#fef3c7' : isBad ? '#fef2f2' : undefined }}>
              {editable && claim.status === 'denied' && (
                <div className="py-cell no-print"><span className={`cb ${disputed.has(l.apptId) ? 'on' : ''}`} role="checkbox" aria-checked={disputed.has(l.apptId)} data-testid={`clm-dispute-${i}`} onClick={() => toggleDispute(l.apptId)} style={{ width: 20, height: 20, borderRadius: 6, border: '2px solid var(--line)', display: 'grid', placeItems: 'center', cursor: 'pointer', background: disputed.has(l.apptId) ? '#f59e0b' : 'var(--panel)', color: '#fff' }}>{disputed.has(l.apptId) && Icon.check({ size: 10, strokeWidth: 3 })}</span></div>
              )}
              <div className="py-cell muted">{i + 1}</div>
              <div className="py-cell"><b>📅 {l.dos}</b></div>
              <div className="py-cell muted" style={{ fontSize: 10 }}>{l.kind === 'mileage' ? `🚗 ${hhmm(l.t0)} trip` : `⏰ ${hhmm(l.t0)}–${hhmm(l.t1)}`}</div>
              <div className="py-cell"><span className="ln-code" style={{ fontSize: 10, padding: '2px 6px', borderRadius: 6, background: 'var(--panel-2)' }}>{l.code}</span>{l.kind === 'mileage' ? <span className="ln-mod" style={{ fontSize: 8 }}>MILEAGE 🚗</span> : null}{isBad ? <span className="ln-mod bad" style={{ fontSize: 8, color: '#ef4444' }}>⚠ gate</span> : null}</div>
              <div className="py-cell" style={{ fontSize: 11 }}>{l.desc}</div>
              <div className="py-cell muted" style={{ fontSize: 10 }}>{dx[i % dx.length]}</div>
              <div className="py-cell">{l.kind === 'mileage' ? `🚗 ${l.units} mi` : `⏱️ ${l.units}`}</div>
              <div className="py-cell muted" style={{ fontSize: 10 }}>{l.staff.split(', ')[0] || '—'}</div>
              <div className="py-cell r">${l.rate}</div>
              <div className="py-cell r money"><b style={{ color: '#059669' }}>{money(l.charge)}</b></div>
              <div className="py-cell no-print" style={{ display: 'flex', gap: 4 }}>
                <button className="iconbtn" style={{ width: 24, height: 24, borderRadius: 8, background: 'var(--panel-2)' }} title="Open session" onClick={() => src && actions.setUI({ section: 'calendar', anchor: l.dos, openAppt: l.apptId })}>{Icon.chevronR({ size: 11 })}</button>
                {claim.status === 'draft' && <button className="iconbtn danger" style={{ width: 24, height: 24, borderRadius: 8, background: '#fef2f2' }} title="Remove line" data-testid={`clm-drop-${i}`} onClick={() => onDropLine(l.apptId)}>{Icon.x({ size: 11 })}</button>}
              </div>
            </div>
          )
        })}
        <div className="py-trow" style={{ gridTemplateColumns: `${editable && claim.status === 'denied' ? '28px ' : ''}24px 70px 70px 70px 1fr 60px 40px 1fr 60px 70px 56px`, fontWeight: 700, background: 'linear-gradient(135deg,var(--panel-2),var(--panel))', fontSize: 11, borderTop: '2px solid var(--line)' }}>
          <div className="py-cell" style={{ gridColumn: `span ${claim.status === 'denied' ? 9 : 8}`, display: 'flex', alignItems: 'center', gap: 6 }}>💰 Total charges <b>{money(claim.charges)}</b>{copay ? <span className="muted" style={{ fontWeight: 400 }}> · copay {money(copay)}</span> : null}</div>
          <div className="py-cell r" />
          <div className="py-cell r">{claim.adj ? <span className="muted" style={{ fontWeight: 400 }}>net {money(claim.charges - claim.adj)} · </span> : null}<b style={{ color: due > 0 ? '#ef4444' : '#10b981', background: due > 0 ? '#fef2f2' : '#ecfdf5', padding: '2px 8px', borderRadius: 20 }}>{due > 0 ? `💳 due ${money(due)}` : '✅ settled'}</b></div>
          <div className="py-cell no-print" />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, padding: 14 }}>
        <div className="panel" style={{ borderRadius: 12, padding: 14, background: 'linear-gradient(135deg,var(--panel-2),var(--panel))', border: '1px solid var(--line)', boxShadow: 'var(--shadow-1)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}><span style={{ width: 28, height: 28, borderRadius: 8, background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: '#fff', display: 'grid', placeItems: 'center' }}>{Icon.clock({ size: 12 })}</span><b style={{ fontSize: 11 }}>📜 Lifecycle</b><span className="muted" style={{ fontSize: 10, background: 'var(--panel)', padding: '2px 8px', borderRadius: 20 }}>{claim.history.length} events</span></div>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }} data-testid="clm-timeline">
            {[...claim.history].reverse().map((h, i) => (
              <li key={i} data-testid={`clm-ev-${i}`} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 11, padding: '6px 8px', borderRadius: 8, background: i === 0 ? '#ecfdf5' : 'transparent', border: `1px solid ${i === 0 ? '#a7f3d0' : 'transparent'}` }}><span style={{ width: 10, height: 10, borderRadius: 5, background: i === 0 ? '#10b981' : 'var(--line)', marginTop: 3, flex: 'none', boxShadow: i === 0 ? '0 0 0 3px #10b98130' : 'none' }} /><p style={{ margin: 0 }}><b style={{ display: 'flex', alignItems: 'center', gap: 4 }}>{i === 0 ? '✅' : '📍'} {h.ev}</b><i style={{ display: 'block', color: 'var(--muted)', fontStyle: 'normal', fontSize: 10 }}>{relDay(h.at)}</i></p></li>
            ))}
          </ul>
        </div>
        <div className="panel" style={{ borderRadius: 12, padding: 14, border: '1px solid var(--line)', boxShadow: 'var(--shadow-1)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}><span style={{ width: 28, height: 28, borderRadius: 8, background: 'linear-gradient(135deg,#f59e0b,#f97316)', color: '#fff', display: 'grid', placeItems: 'center' }}>{Icon.edit({ size: 12 })}</span><b style={{ fontSize: 11 }}>📝 Billing Note</b></div>
          <textarea className="input" rows={2} placeholder="💬 Context for next person on this claim…" value={noteDraft} onChange={(e) => setNoteDraft(e.target.value)} data-testid="clm-note" style={{ borderRadius: 10, fontSize: 12 }} />
          {noteDraft !== (claim.note || '') && <button className="btn btn-xs" style={{ marginTop: 8, borderRadius: 8, background: '#6366f1', color: '#fff' }} data-testid="clm-note-save" onClick={() => { actions.addClaimNote(claim.id, noteDraft); toast({ message: 'Note saved 💾', kind: 'ok' }) }}>💾 Save note</button>}
          {claim.remittance?.note ? <div className="muted" style={{ fontSize: 11, marginTop: 8, background: 'var(--panel-2)', padding: '6px 10px', borderRadius: 8 }}>📝 Remittance note: {claim.remittance.note}</div> : null}
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
      <div className="modal" style={{ width: 'min(600px, 92vw)', borderRadius: 16, overflow: 'hidden', boxShadow: '0 20px 60px #0003' }} data-testid="pay-modal">
        <div className="modal-head" style={{ padding: '14px 18px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 12, background: 'linear-gradient(135deg,#10b98122,#05966911)' }}><span style={{ width: 36, height: 36, borderRadius: 10, background: 'linear-gradient(135deg,#10b981,#059669)', color: '#fff', display: 'grid', placeItems: 'center' }}>{Icon.dollar({ size: 16 })}</span><div><h2 style={{ fontSize: 14, margin: 0 }}>💵 Post Payment — {claim.no}</h2><div className="muted" style={{ fontSize: 11 }}>Record remittance, adjustments & patient responsibility</div></div><div style={{ flex: 1 }} /><button className="modal-x" aria-label="Close" onClick={onClose} style={{ width: 32, height: 32, borderRadius: 10, background: 'var(--panel-2)' }}>{Icon.x({ size: 14 })}</button></div>
        <div className="modal-body" style={{ padding: 18 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }} data-testid="pay-quick-row">
            {posts.map((p) => (
              <button key={p.id} className="q-chip" data-testid={`pay-quick-${p.id}`} onClick={() => { setAmount(p.amount); setAdj(p.adj || 0); setNote(p.note || '') }} style={{ borderRadius: 20, padding: '6px 14px', fontSize: 11, border: '1px solid var(--line)', background: 'var(--panel-2)', display: 'flex', alignItems: 'center', gap: 4 }}>⚡ {p.label}</button>
            ))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}><span style={{ fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 4 }} className="muted">💵 Payment amount $</span><input className="input" style={{ borderRadius: 10, height: 40 }} type="number" step="0.01" value={amount} onChange={(e) => setAmount(Number(e.target.value))} data-testid="pay-amount" /></label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}><span style={{ fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 4 }} className="muted">📉 Adjustment / write-off $</span><input className="input" style={{ borderRadius: 10, height: 40 }} type="number" step="0.01" value={adj} onChange={(e) => setAdj(Number(e.target.value))} data-testid="pay-adj" /></label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}><span style={{ fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 4 }} className="muted">🏦 Check / EFT ref</span><input className="input" style={{ borderRadius: 10, height: 40 }} value={check} onChange={(e) => setCheck(e.target.value)} data-testid="pay-check" /></label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}><span style={{ fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 4 }} className="muted">📅 Posted on</span><input className="input" style={{ borderRadius: 10, height: 40 }} type="date" value={todayISO()} readOnly data-testid="pay-date" /></label>
          </div>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 14 }}><span style={{ fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 4 }} className="muted">📝 Note on remittance</span><input className="input" style={{ borderRadius: 10, height: 40 }} value={note} onChange={(e) => setNote(e.target.value)} placeholder="optional 💬" data-testid="pay-note" /></label>
          <div className={`pm-due ${Math.abs(due) < 0.5 ? 'ok' : 'warn'}`} data-testid="pay-due" style={{ marginTop: 14, padding: '12px 14px', borderRadius: 12, background: Math.abs(due) < 0.5 ? 'linear-gradient(135deg,#ecfdf5,#d1fae5)' : 'linear-gradient(135deg,#fffbeb,#fef3c7)', border: `1px solid ${Math.abs(due) < 0.5 ? '#a7f3d0' : '#fde68a'}`, fontSize: 11, display: 'flex', gap: 8 }}>
            <span style={{ fontSize: 16 }}>{Math.abs(due) < 0.5 ? '✅' : '⚠️'}</span>
            <span>{Math.abs(due) < 0.5 ? <>Balances to zero — claim will close as <b>paid</b> ({money(claim.charges)} charges − {money(adj || 0)} adjustments = {money(amount)}).</> : <>Posting leaves <b>{money(due)}</b> {due > 0 ? 'open — flagged short-pay' : 'overpaid'} — {money(claim.charges)} − {money(adj || 0)} − {money(amount)}.</>}</span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', padding: '14px 18px', borderTop: '1px solid var(--line)', background: 'var(--panel-2)' }}>
          <button className="btn btn-sm" onClick={onClose} style={{ borderRadius: 10 }}>Cancel</button>
          <button className="btn btn-sm btn-primary" onClick={post} data-testid="pay-post" style={{ borderRadius: 10, background: 'linear-gradient(135deg,#10b981,#059669)', border: 'none', boxShadow: '0 4px 12px #10b98140' }}>{Icon.check({ size: 12 })} Post {money(amount)}{adj ? ` · write off ${money(adj)}` : ''} 💾</button>
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
      <div className="modal" style={{ width: 'min(560px, 92vw)', borderRadius: 16, overflow: 'hidden', boxShadow: '0 20px 60px #0003' }} data-testid="deny-modal">
        <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 12, background: 'linear-gradient(135deg,#fef2f2,#fee2e2)' }}><span style={{ width: 36, height: 36, borderRadius: 10, background: 'linear-gradient(135deg,#ef4444,#dc2626)', color: '#fff', display: 'grid', placeItems: 'center' }}>{Icon.ban({ size: 16 })}</span><div><h2 style={{ fontSize: 14, margin: 0 }}>🚫 Record Denial — {claim.no}</h2><div className="muted" style={{ fontSize: 11 }}>Document payer denial reason & fix</div></div><div style={{ flex: 1 }} /><button className="modal-x" aria-label="Close" onClick={onClose} style={{ width: 32, height: 32, borderRadius: 10 }}>{Icon.x({ size: 14 })}</button></div>
        <div style={{ padding: 18 }}>
          <span style={{ fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 4 }} className="muted">🚫 Payer denial code</span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
            {DENIAL_REASONS.map((r) => (
              <button key={r.id} data-testid={`deny-r-${r.id}`} onClick={() => setCode(r.id)} style={{ textAlign: 'left', padding: '10px 14px', borderRadius: 12, border: `2px solid ${code === r.id ? '#ef4444' : 'var(--line)'}`, background: code === r.id ? 'linear-gradient(135deg,#fef2f2,#fff)' : 'var(--panel)', display: 'flex', flexDirection: 'column', gap: 3, boxShadow: code === r.id ? '0 4px 12px #ef444420' : 'none' }}><b style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 6 }}>{code === r.id ? '🔴' : '⚪'} {r.label}</b><i style={{ fontSize: 10, color: 'var(--muted)', fontStyle: 'normal' }}>💡 {r.fix}</i></button>
            ))}
          </div>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 14 }}><span style={{ fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 4 }} className="muted">📝 Correspondence note</span><input className="input" style={{ borderRadius: 10, height: 40 }} value={note} onChange={(e) => setNote(e.target.value)} placeholder="letter/EOB reference… 📄" data-testid="deny-note" /></label>
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', padding: '14px 18px', borderTop: '1px solid var(--line)', background: 'var(--panel-2)' }}>
          <button className="btn btn-sm" onClick={onClose} style={{ borderRadius: 10 }}>Cancel</button>
          <button className="btn btn-sm btn-primary" data-testid="deny-go" onClick={() => { const r = actions.denyClaim(claim.id, { code, note }); toast({ message: `${r.msg} — U to undo`, kind: 'warn' }); onClose() }} style={{ borderRadius: 10, background: 'linear-gradient(135deg,#ef4444,#dc2626)', border: 'none' }}>🚫 Mark {claim.no} denied</button>
        </div>
      </div>
    </div>
  )
}
