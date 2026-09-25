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
  <span className="clm-status" style={{ color: CLAIM_STATUSES[s].ink, background: CLAIM_STATUSES[s].bg, display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700 }}>
    <span style={{ width: 6, height: 6, borderRadius: 3, background: CLAIM_STATUSES[s].ink }} />
    {CLAIM_STATUSES[s].label}
  </span>
)

const KpiCard = ({ icon, color, label, value, sub, onClick, testId, alert }) => (
  <button data-testid={testId} onClick={onClick} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '16px 18px', borderRadius: 14, border: `1px solid ${alert ? '#fecaca' : 'var(--line)'}`, background: alert ? '#fff8f8' : 'var(--panel)', cursor: onClick ? 'pointer' : 'default', minWidth: 200, textAlign: 'left', boxShadow: 'var(--shadow-1)', transition: 'all .15s' }}>
    <span style={{ width: 36, height: 36, borderRadius: 10, background: `${color}14`, color, display: 'grid', placeItems: 'center', flex: 'none' }}>{icon}</span>
    <span style={{ minWidth: 0, flex: 1 }}><b style={{ display: 'block', fontSize: 20, lineHeight: 1.1, fontWeight: 800 }}>{value}</b><span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--muted)' }}>{label}</span><span style={{ display: 'block', fontSize: 12, color: 'var(--text-2)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sub}</span></span>
  </button>
)

const PipelineStep = ({ icon, label, count, active, done, color }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 12, opacity: active ? 1 : 0.7 }}>
    <span style={{ width: 36, height: 36, borderRadius: 10, background: done ? color : `${color}14`, border: `1.5px solid ${done ? color : `${color}40`}`, color: done ? '#fff' : color, display: 'grid', placeItems: 'center' }}>{icon}</span>
    <span><b style={{ display: 'block', fontSize: 13, fontWeight: 700 }}>{label}</b><span style={{ fontSize: 11, color: 'var(--muted)' }}>{count}</span></span>
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
    <button className={`tab ${tab === id ? 'on' : ''}`} data-testid={`bil-tab-${id}`} onClick={() => setTab(id)} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', borderRadius: 10, fontSize: 13, fontWeight: 600 }}>
      <span style={{ width: 22, height: 22, borderRadius: 7, background: tab === id ? 'var(--accent)' : 'var(--panel-2)', color: tab === id ? '#fff' : 'var(--muted)', display: 'grid', placeItems: 'center' }}>{icon}</span>
      {label}{n > 0 && <span className={`pill ${warn ? 'warn' : ''}`} style={{ marginLeft: 2, fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 10 }}>{n}</span>}
    </button>
  )

  return (
    <div className="sectionpage" style={{ background: 'var(--bg)' }}>
      <SectionBar icon="dollar" title="Billing" sub={`Revenue cycle — stage → form → submit → pay · ${range.label} · ${stats.drafts.n + stats.pending.n + stats.denied.n + stats.paid.n} claims`}>
        <RangePicker preset={preset} onPreset={(p) => actions.setUI({ bilPreset: p })} onSlide={(d) => actions.setUI({ anchor: isoDate(addDays(parseISO(ui.anchor), d * range.days.length)) })} label={range.label} />
        {tab === 'stage' && (
          <>
            <div className="viewseg" style={{ marginRight: 8, borderRadius: 10, padding: 3 }} data-testid="bil-payer-pick">
              {['Blue Shield CA', 'Aetna', 'Regence BCBS', 'UnitedHealthcare', 'Medicaid (CA)', 'Self-pay'].map((p) => {
                const on = payerPick.includes(p)
                return <button key={p} className={on ? 'on' : ''} data-testid={`bil-payer-${p.replace(/[^A-Za-z]/g, '')}`} onClick={() => setPayerPick((cur) => cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p])}>{p.split(' ')[0]}</button>
              })}
              {payerPick.length > 0 && <button className="btn-ghost" data-testid="bil-payer-clear" onClick={() => setPayerPick([])}>Clear</button>}
            </div>
            <button className="btn btn-sm" onClick={exportStageCsv} data-testid="bil-export" style={{ borderRadius: 10 }}>{Icon.download({ size: 13 })} Export</button>
            <button className="btn btn-sm btn-primary" disabled={!staged.length} onClick={generate} data-testid="bil-generate" style={{ borderRadius: 10 }}>{Icon.file({ size: 12 })} Assemble {picked.size || staged.length} → {plans.length} forms</button>
            <button className="btn btn-sm" data-testid="bil-process" onClick={processBilling} title="Submit all gate-clean drafts + generate billed file" style={{ borderRadius: 10, background: '#10b981', color: '#fff', border: 'none' }}>{Icon.zap({ size: 12 })} Process</button>
          </>
        )}
        {tab === 'claims' && (
          <>
            <button className="btn btn-sm" onClick={() => {
              const ins = list.filter((c) => c.status !== 'void')
              if (!ins.length) { toast({ message: 'No claims in view to export', kind: 'warn' }); return }
              try { claimsTo1500(state, ins).save(`CMS-1500-batch-${todayISO()}.pdf`) } catch (e) { }
              toast({ message: `CMS-1500 batch — ${ins.length} claims onto one print-ready PDF`, kind: 'ok' })
            }} data-testid="bil-cms1500-batch" style={{ borderRadius: 10 }}>{Icon.print({ size: 13 })} 1500 Batch</button>
            <button className="btn btn-sm" onClick={() => { download(`${(bill.claimPrefix || 'CLM')}-ledger.csv`, claimsCsv(state, list)); toast({ message: `${list.length} claims exported`, kind: 'ok' }) }} data-testid="bil-csv-all" style={{ borderRadius: 10 }}>{Icon.download({ size: 13 })} Ledger</button>
            <button className="btn btn-sm btn-primary" disabled={!stats.drafts.n} onClick={submitAllDrafts} data-testid="bil-submit-all" style={{ borderRadius: 10 }}>{Icon.check({ size: 12 })} Submit {Object.keys(claims).filter((id) => claims[id].status === 'draft' && !gatedIds[id]).length} ready</button>
          </>
        )}
      </SectionBar>

      <div style={{ margin: '16px', padding: '20px', borderRadius: 14, background: 'var(--panel)', border: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 20, boxShadow: 'var(--shadow-1)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flex: 1, flexWrap: 'wrap' }}>
          <PipelineStep icon={Icon.file({ size: 14 })} label="Staging" count={`${staged.length} lines · ${money(stagedTotal)}`} active={tab === 'stage'} done={staged.length === 0} color="#6366f1" />
          <span style={{ width: 40, height: 1, background: 'var(--line)', flex: '0 0 40px' }} />
          <PipelineStep icon={Icon.edit({ size: 14 })} label="Drafts" count={`${stats.drafts.n} · ${money(stats.drafts.$)}${Object.keys(gatedIds).length ? ` · ${Object.keys(gatedIds).length} gated` : ''}`} active={tab === 'claims' && statusF === 'draft'} done={false} color="#f59e0b" />
          <span style={{ width: 40, height: 1, background: 'var(--line)', flex: '0 0 40px' }} />
          <PipelineStep icon={Icon.clock({ size: 14 })} label="Awaiting" count={`${stats.pending.n} · ${money(stats.pending.$)}${stats.pending.late ? ` · ${stats.pending.late} late` : ''}`} active={tab === 'claims' && statusF === 'submitted'} done={false} color="#0ea5e9" />
          <span style={{ width: 40, height: 1, background: 'var(--line)', flex: '0 0 40px' }} />
          <PipelineStep icon={Icon.dollar({ size: 14 })} label="Paid" count={`${stats.paid.n} · ${money(stats.paid.$)} · ${stats.denialRate}% denial`} active={tab === 'claims' && statusF === 'paid'} done={stats.paid.n > 0} color="#10b981" />
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {['0–30', '31–60', '61–90', '90+'].map((b) => (
            <span key={b} className={`rp-sumchip ${stats.pending.buckets[b] ? 'on' : ''}`} style={{ padding: '8px 12px', opacity: stats.pending.buckets[b] ? 1 : 0.4, borderRadius: 10, border: '1px solid var(--line)', background: 'var(--panel)', fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 8, height: 8, borderRadius: 4, background: b === '0–30' ? '#10b981' : b === '31–60' ? '#f59e0b' : b === '61–90' ? '#f97316' : '#ef4444' }} />
              <b>{money(stats.pending.buckets[b] || 0)}</b><span style={{ fontSize: 11, color: 'var(--muted)' }}>{b}</span>
            </span>
          ))}
        </div>
      </div>

      <div className="batch-strip" data-testid="bil-kpis" style={{ margin: '0 16px', padding: '16px', gap: 12, flexWrap: 'wrap', background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 14, boxShadow: 'var(--shadow-1)' }}>
        <KpiCard testId="bil-kpi-staged" icon={Icon.file({ size: 18 })} color="#6366f1" label="In Staging" value={money(stagedTotal)} sub={`${staged.length} claim-ready lines`} onClick={() => setTab('stage')} />
        <KpiCard testId="bil-kpi-draft" icon={Icon.edit({ size: 18 })} color={Object.keys(gatedIds).length ? '#ef4444' : '#f59e0b'} label="Drafts" value={`${stats.drafts.n}`} sub={stats.drafts.n ? `${money(stats.drafts.$)} · ${Object.keys(gatedIds).length ? `${Object.keys(gatedIds).length} gated` : 'ready to submit'}` : 'nothing pending'} onClick={() => { setTab('claims'); setStatusF('draft') }} alert={Object.keys(gatedIds).length} />
        <KpiCard testId="bil-kpi-pending" icon={Icon.clock({ size: 18 })} color="#0ea5e9" label="Awaiting Payer" value={money(stats.pending.$)} sub={`${stats.pending.n} out${stats.pending.late ? ` · ${stats.pending.late} past cycle` : ''}`} onClick={() => { setTab('claims'); setStatusF('submitted') }} alert={stats.pending.late} />
        <KpiCard testId="bil-kpi-denied" icon={Icon.ban({ size: 18 })} color={stats.denied.n ? '#ef4444' : '#9ca3af'} label="Denied" value={`${stats.denied.n}`} sub={stats.denied.n ? `${money(stats.denied.$)} needs action` : 'none open'} onClick={() => { setTab('claims'); setStatusF('denied') }} alert={stats.denied.n} />
        <KpiCard testId="bil-kpi-paid" icon={Icon.dollar({ size: 18 })} color="#10b981" label={`Paid · ${range.label}`} value={money(stats.paid.$)} sub={`${stats.paid.n} remittances · ${stats.denialRate}% denial`} onClick={() => { setTab('claims'); setStatusF('paid') }} />
        <KpiCard testId="bil-kpi-cycle" icon={Icon.cal({ size: 18 })} color="#6b7280" label="Avg Days to Pay" value={stats.avgDaysToPay ?? '—'} sub={stats.avgDaysToPay ? 'across paid claims' : 'no history yet'} />
        <span className="muted" style={{ marginLeft: 'auto', fontSize: 12, display: 'flex', alignItems: 'center', gap: 8 }}><span style={{ width: 22, height: 22, borderRadius: 7, background: '#fee2e2', color: '#ef4444', display: 'grid', placeItems: 'center' }}>{Icon.ban({ size: 11 })}</span> held back <b style={{ color: '#ef4444' }}>{money(blocked.reduce((t, r) => t + r.estCharge, 0))}</b></span>
      </div>

      <div className="batch-strip" style={{ margin: '12px 16px', padding: '12px 16px', gap: 12, background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 12 }}>
        <div className="viewseg" style={{ borderRadius: 10, padding: 3 }} data-testid="bil-payer-pick">
          <TabBtn id="stage" label="Staging" n={staged.length} icon={Icon.file({ size: 12 })} />
          <TabBtn id="claims" label="Claim Desk" n={openCount} warn={stats.denied.n > 0} icon={Icon.clipboard({ size: 12 })} />
          <TabBtn id="secondary" label="Secondary" n={Object.values(claims).filter((c) => secondaryEligible(state, c)).length} icon={Icon.shield({ size: 12 })} />
          <TabBtn id="blocked" label="Blocked" n={blocked.length} warn icon={Icon.ban({ size: 12 })} />
          <TabBtn id="setup" label="Setup" icon={Icon.dashboard({ size: 12 })} />
        </div>
      </div>

      {tab === 'stage' && (
        <div style={{ padding: '0 16px 16px', display: 'grid', gridTemplateColumns: '1fr 380px', gap: 20, alignItems: 'start' }}>
          <div className="panel" style={{ borderRadius: 14, overflow: 'hidden', boxShadow: 'var(--shadow-1)', border: '1px solid var(--line)' }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--line)', display: 'flex', gap: 12, alignItems: 'center', background: 'var(--panel-2)' }}>
              <span style={{ width: 32, height: 32, borderRadius: 9, background: '#6366f114', color: '#6366f1', display: 'grid', placeItems: 'center' }}>{Icon.file({ size: 16 })}</span>
              <div><b style={{ fontSize: 14 }}>Staging Queue</b><span className="muted" style={{ fontSize: 12, marginLeft: 8 }}>{staged.length} lines · {picked.size ? `${picked.size} selected` : 'forms group by client × payer × month'}</span></div>
              <div style={{ marginLeft: 'auto' }}>
                <button className="btn btn-sm" data-testid="bil-pickall" onClick={() => setPicked(picked.size === staged.length ? new Set() : new Set(staged.map((a) => a.id)))} style={{ borderRadius: 9 }}>{picked.size === staged.length ? 'Clear' : `Select all (${staged.length})`}</button>
              </div>
            </div>
            <div className="py-tbl" style={{ maxHeight: 680, overflow: 'auto' }}>
              <div className="py-thead" style={{ gridTemplateColumns: '40px 1.4fr 1fr 110px 1fr 100px 110px', background: 'var(--panel-2)', fontSize: 11, position: 'sticky', top: 0, zIndex: 1 }}>
                <span></span><span>Client</span><span>Payer</span><span>Code & Units</span><span>Provider & Filing</span><span>Charge</span><span>Actions</span>
              </div>
              {staged.map((a, i) => {
                const c = clientOf(a.clientIds?.[0])
                const prov = (settings.providers || []).find((p) => p.kind === 'staff' && p.refId === a.staffIds?.[0])
                const timely = (() => { const pol = payerPolicy(c.insurer || 'Self-pay'); const filing = (state.payers || []).find((pp) => pp.name === (c.insurer || ''))?.ext?.filingDeadlineDays ?? bill.defaultFilingDays ?? pol.timely ?? 90; const due = isoDate(new Date(new Date(a.date).getTime() + filing * 86400000)); const today = todayISO(); const daysLeft = Math.round((new Date(due) - new Date(today)) / 86400000); return { due, daysLeft, amber: daysLeft <= 21 && daysLeft >= 0, over: daysLeft < 0 } })()
                return (
                  <div className="py-trow" key={a.id} data-testid={`bil-row-${i}`} style={{ gridTemplateColumns: '40px 1.4fr 1fr 110px 1fr 100px 110px', minHeight: 56, transition: 'background .12s', background: picked.has(a.id) ? '#f5f3ff' : undefined }}>
                    <div className="py-cell"><span className={`cb ${picked.has(a.id) ? 'on' : ''}`} onClick={() => toggle(a.id)} role="checkbox" aria-checked={picked.has(a.id)} data-testid={`bil-pick-${i}`} style={{ width: 20, height: 20, borderRadius: 6 }}>{picked.has(a.id) && Icon.check({ size: 12 })}</span></div>
                    <div className="py-idcell"><div style={{ display: 'flex', alignItems: 'center', gap: 10 }}><PersonAvatar p={clientOf(a.clientIds?.[0])} size={28} /><div><b style={{ fontSize: 13 }}>{c.name || '—'}</b><div style={{ fontSize: 11, color: 'var(--muted)' }}>{fmtDayLabel(a.date)}</div></div></div></div>
                    <div className="py-cell"><span className="tag soft" style={{ fontSize: 12, padding: '4px 10px', borderRadius: 20 }}>{c.insurer || 'Self-pay'}</span></div>
                    <div className="py-cell"><div><span className="ln-code" style={{ fontSize: 12 }}>{a.billing?.mileage && !a.billing?.units ? '14220' : a.billing?.code || '—'}</span><div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{a.billing?.mileage && !a.billing?.units ? `${a.billing?.distance} mi` : `${a.billing?.units}u × $${a.billing?.rate}`}</div></div></div>
                    <div className="py-cell"><div><div style={{ fontSize: 13 }}>{prov?.name?.split(' ')[0] || a.staffIds?.[0] || '—'}</div><div style={{ fontSize: 11, color: timely.over ? '#ef4444' : timely.amber ? '#d97706' : 'var(--muted)' }}>{timely.over ? `${-timely.daysLeft}d overdue` : timely.amber ? `${timely.daysLeft}d left` : `${timely.daysLeft}d · ${prov?.npi ? 'NPI ok' : 'no NPI'}`}</div></div></div>
                    <div className="py-cell"><b style={{ fontSize: 14, color: '#059669' }}>{money(computeBilling(a))}</b></div>
                    <div className="py-cell" style={{ display: 'flex', gap: 6 }}>
                      <button className="iconbtn" style={{ width: 32, height: 32, borderRadius: 8 }} title="Open source appointment" onClick={() => actions.setUI({ section: 'calendar', anchor: a.date, openAppt: a.id })}>{Icon.chevronR({ size: 14 })}</button>
                      <button className="iconbtn" style={{ width: 32, height: 32, borderRadius: 8 }} title={prov ? `Open ${prov.name} in Provider Identifier` : 'No provider'} data-testid={`bil-npi-${i}`} onClick={() => { if (prov) actions.setUI({ section: 'bil-providers' }) }}>{Icon.badge({ size: 12 })}</button>
                    </div>
                  </div>
                )
              })}
              {!staged.length && <div className="py-empty" style={{ padding: 48, textAlign: 'center' }}><b>{blocked.length ? `Nothing claim-ready — ${blocked.length} blocked line(s) need fixes` : 'Everything in this window is on a claim or paid'}</b><div className="muted" style={{ fontSize: 12, marginTop: 6 }}>Slide the range or check the desk.</div></div>}
            </div>
          </div>
          <div className="panel" style={{ borderRadius: 14, overflow: 'hidden', boxShadow: 'var(--shadow-1)', position: 'sticky', top: 16, border: '1px solid var(--line)' }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--line)', background: 'var(--panel-2)', display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ width: 32, height: 32, borderRadius: 9, background: '#10b98114', color: '#10b981', display: 'grid', placeItems: 'center' }}>{Icon.file({ size: 16 })}</span>
              <div><b style={{ fontSize: 14 }}>Claim Forms Preview</b><div className="muted" style={{ fontSize: 12 }}>{picked.size ? 'selection' : 'all staging'} · {plans.length} forms · {money(plans.reduce((t, p) => t + p.charges, 0))}</div></div>
            </div>
            <div style={{ padding: 16 }}>
              {plans.slice(0, 8).map((p, i) => (
                <div key={`${p.clientId}-${i}`} data-testid={`asm-row-${i}`} style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '12px 14px', borderRadius: 12, border: '1px solid var(--line)', marginBottom: 10, background: 'var(--panel)' }}>
                  <PersonAvatar p={clientOf(p.clientId)} size={32} />
                  <span style={{ minWidth: 0, flex: 1 }}><b style={{ fontSize: 13 }}>{p.client}</b><span style={{ display: 'block', fontSize: 11, color: 'var(--muted)' }}>{p.mode === 'selfpay' ? 'Self-pay invoice' : p.payer} · {p.dosFrom === p.dosTo ? p.dosTo : `${p.dosFrom.slice(5)} → ${p.dosTo.slice(5)}`}</span></span>
                  <span style={{ fontSize: 11, textAlign: 'right' }}><span style={{ display: 'block', color: 'var(--muted)' }}>{p.appts.length} lines · {p.units}u</span><b style={{ fontSize: 14, color: '#059669' }}>{money(p.charges)}</b></span>
                </div>
              ))}
              {plans.length > 8 && <div className="muted" style={{ fontSize: 12, padding: '8px', textAlign: 'center' }}>+{plans.length - 8} more forms</div>}
              {!!plans.length && (
                <button className="btn btn-sm btn-primary" style={{ width: '100%', marginTop: 8, borderRadius: 10, height: 42, fontWeight: 700 }} onClick={generate} data-testid="asm-generate">
                  {Icon.zap({ size: 14 })} Assemble {plans.length} forms · {money(plans.reduce((t, p) => t + p.charges, 0))}
                </button>
              )}
              {!plans.length && <div className="py-empty" style={{ padding: 32, textAlign: 'center' }}><b style={{ fontSize: 13 }}>Import-ready lines appear here as you select staging rows.</b><div className="muted" style={{ fontSize: 12, marginTop: 4 }}>Pick sessions to see claim grouping</div></div>}
            </div>
          </div>
        </div>
      )}

      {tab === 'claims' && (
        <div style={{ padding: '0 16px 16px', display: 'grid', gridTemplateColumns: '400px 1fr', gap: 20, alignItems: 'start' }}>
          <div className="panel" style={{ borderRadius: 14, overflow: 'hidden', boxShadow: 'var(--shadow-1)', border: '1px solid var(--line)' }}>
            <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--line)', display: 'flex', gap: 10, alignItems: 'center', background: 'var(--panel-2)' }}>
              <span className="sb-search" style={{ flex: 1, minWidth: 0, borderRadius: 10 }}>
                <span className="sic">{Icon.search({ size: 12 })}</span>
                <input placeholder="Search claim no, client, payer" value={q} onChange={(e) => setQ(e.target.value)} data-testid="clm-search" style={{ fontSize: 13 }} />
              </span>
              <select className="input" style={{ width: 110, height: 36, borderRadius: 10, fontSize: 12 }} value={sort} onChange={(e) => setSort(e.target.value)} data-testid="clm-sort" aria-label="Sort claims">
                <option value="recent">Recent</option><option value="$">Value ↓</option><option value="aging">Oldest</option>
              </select>
            </div>
            <div style={{ padding: '12px', borderBottom: '1px solid var(--line)', display: 'flex', gap: 6, flexWrap: 'wrap', background: 'var(--panel)' }} role="tablist" aria-label="Claim status">
              {[['all', 'All'], ['draft', 'Draft'], ['submitted', 'Submitted'], ['denied', 'Denied'], ['paid', 'Paid'], ['void', 'Void']].map(([f, l]) => {
                const n = f === 'all' ? allClaims.length : allClaims.filter((c) => c.status === f).length
                return <button key={f} className={`sf-chip ${statusF === f ? 'on' : ''}`} data-testid={`clm-filter-${f}`} onClick={() => setStatusF(f)} style={{ borderRadius: 20, padding: '6px 12px', fontSize: 12 }}>{l}<span style={{ marginLeft: 6, fontSize: 11, padding: '1px 6px', borderRadius: 10, background: statusF === f ? 'rgba(255,255,255,.25)' : 'var(--panel-2)' }}>{n}</span></button>
              })}
            </div>
            <div style={{ maxHeight: 720, overflow: 'auto' }}>
              {list.map((c, i) => {
                const cl = clientOf(c.clientId)
                const age = agingOf(c)
                const isSel = claim?.id === c.id
                return (
                  <button key={c.id} className={`clm-card ${isSel ? 'on' : ''}`} data-testid={`clm-row-${i}`} onClick={() => { setSel(c.id); setDisputed(new Set()) }} style={{ width: '100%', textAlign: 'left', padding: '14px 16px', border: 'none', borderBottom: '1px solid var(--line)', background: isSel ? '#f5f3ff' : 'var(--panel)', cursor: 'pointer', display: 'block', borderLeft: `3px solid ${isSel ? '#6366f1' : 'transparent'}` }}>
                    <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}><b style={{ fontSize: 12 }}>{c.no}</b><StatusChip s={c.status} />{gatedIds[c.id] ? <><span style={{ fontSize: 12 }}>⚠</span><span className="tag warn" style={{ fontSize: 10 }}>{gatedIds[c.id]} gated</span></> : null}</span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, marginTop: 8 }}><PersonAvatar p={cl} size={24} />{cl.name || '—'} <span style={{ fontSize: 11, color: 'var(--muted)' }}>{c.mode === 'selfpay' ? 'family invoice' : c.payer}</span></span>
                    <span style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginTop: 8, color: 'var(--muted)' }}><span>{c.dosFrom.slice(5)} → {c.dosTo.slice(5)} · {c.lines.length} lines</span><span style={{ color: dueOf(c) > 0 ? '#ef4444' : '#10b981', fontWeight: 700 }}>{money(dueOf(c))}</span>{age ? <span>{age.days}d</span> : null}</span>
                  </button>
                )
              })}
              {!list.length && <div className="py-empty" style={{ padding: 40, textAlign: 'center' }}><b>No claims match</b><div className="muted" style={{ fontSize: 12, marginTop: 4 }}>Assemble some from Staging, or clear filter.</div></div>}
            </div>
          </div>

          {claim ? <ClaimForm claim={claim} gated={gatedIds[claim.id]} disputed={disputed} setDisputed={setDisputed} payOpen={payOpen} setPayOpen={setPayOpen} denyOpen={denyOpen} setDenyOpen={setDenyOpen} onSubmit={() => submit(claim.id)} onVoid={() => voidClaim(claim.id)} onRebill={() => rebill(claim.id)} onWriteOff={() => writeOff(claim.id)} onDropLine={(aid) => dropLine(claim.id, aid)} clientOf={clientOf} staffOf={staffOf} /> : (
            <div className="panel" style={{ borderRadius: 14, padding: 40, textAlign: 'center', border: '1px dashed var(--line)' }}><h3 style={{ margin: '0 0 8px' }}>The desk is empty</h3><p className="muted" style={{ fontSize: 13 }}>Assemble staging lines into claim forms and they'll queue here.</p><button className="btn btn-sm btn-primary" onClick={() => setTab('stage')} style={{ marginTop: 16, borderRadius: 10 }}>Go to staging</button></div>
          )}
        </div>
      )}

      {tab === 'secondary' && (
        <div style={{ padding: '0 16px 16px' }}>
          <div className="panel" data-testid="bil-secondary" style={{ borderRadius: 14, overflow: 'hidden', border: '1px solid var(--line)' }}>
            <div style={{ padding: '18px 20px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 12, background: 'var(--panel-2)' }}>
              <span style={{ width: 32, height: 32, borderRadius: 9, background: '#6366f114', color: '#6366f1', display: 'grid', placeItems: 'center' }}>{Icon.shield({ size: 16 })}</span>
              <div><b style={{ fontSize: 14 }}>Secondary Queue</b><div className="muted" style={{ fontSize: 12 }}>{Object.values(claims).filter((c) => secondaryEligible(state, c)).length} eligible · Clients with secondary insurance</div></div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, padding: 20 }}>
              <div>
                <b style={{ fontSize: 13 }}>COB Clients</b>
                <div className="sec-clients-render" data-testid="sec-clients-render" style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12 }}>
                  {(state.clients || []).filter((c) => c.secondary).map((c) => {
                    const sec = c.secondary; const payer = (state.payers || []).find((p) => p.id === sec.payerId)
                    return (
                      <div key={c.id} data-testid={`sec-client-${c.id}`} style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '12px 14px', borderRadius: 12, border: '1px solid var(--line)', background: 'var(--panel)' }}>
                        <PersonAvatar p={c} size={32} />
                        <span style={{ minWidth: 0, flex: 1 }}><b style={{ fontSize: 13 }}>{c.name}</b><span style={{ display: 'block', fontSize: 11, color: 'var(--muted)' }}>{c.insurer} → {payer?.name || sec.payerId}</span></span>
                        <span className="ln-code" style={{ fontSize: 11 }}>{sec.memberId || '—'}</span>
                      </div>
                    )
                  })}
                </div>
              </div>
              <div>
                <b style={{ fontSize: 13 }}>Eligible Claims</b>
                <div data-testid="sec-claims" style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12 }}>
                  {Object.values(claims).filter((c) => secondaryEligible(state, c)).map((c) => {
                    const cl = clientOf(c.clientId)
                    return (
                      <div key={c.id} data-testid={`sec-claim-${c.id}`} style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '12px 14px', borderRadius: 12, border: '1px solid var(--line)', background: 'var(--panel)' }}>
                        <b style={{ fontSize: 12 }}>{c.no}</b><span style={{ fontSize: 13 }}>{cl.name || '—'}</span><span className="muted" style={{ fontSize: 11, flex: 1 }}>{c.payer}</span><span style={{ fontSize: 12, fontWeight: 700 }}>{money(dueOf(c))} due</span><button className="btn btn-xs btn-primary" data-testid={`sec-file-${c.id}`} onClick={() => { const r = actions.fileSecondaryClaim(c.id); toast({ message: r.msg, kind: r.ok ? 'ok' : 'warn' }); if (r.ok && r.newId) { setTab('claims'); setSel(r.newId) } }} style={{ borderRadius: 8 }}>File secondary</button>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {tab === 'blocked' && (
        <div style={{ padding: '0 16px 16px' }}>
          <div className="panel" style={{ borderRadius: 14, overflow: 'hidden', border: '1px solid var(--line)' }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 12, background: 'var(--panel-2)' }}>
              <span style={{ width: 32, height: 32, borderRadius: 9, background: '#fee2e2', color: '#ef4444', display: 'grid', placeItems: 'center' }}>{Icon.ban({ size: 16 })}</span>
              <div><b style={{ fontSize: 14 }}>Blocked Lines — {blocked.length}</b><span className="muted" style={{ fontSize: 12, marginLeft: 8 }}>{money(blocked.reduce((t, r) => t + r.estCharge, 0))} held</span></div>
            </div>
            <div className="py-tbl">
              <div className="py-thead" style={{ gridTemplateColumns: '80px 100px 1.4fr 1.8fr 100px 120px', background: 'var(--panel-2)', fontSize: 11 }}><span>Type</span><span>Date</span><span>Client</span><span>Issue</span><span>Charge</span><span>Actions</span></div>
              {blocked.map((r, i) => (
                <div key={i} data-testid={`blk-row-${i}`} className="py-trow" style={{ gridTemplateColumns: '80px 100px 1.4fr 1.8fr 100px 120px', minHeight: 52 }}>
                  <div className="py-cell"><span className={`sev-pill ${/0 billable|no billing/i.test(r.issues) ? 'sev-error' : ''}`} style={{ fontSize: 11 }}>{/0 billable|no billing/i.test(r.issues) ? 'billing' : 'gate'}</span></div>
                  <div className="py-cell"><b style={{ fontSize: 13 }}>{fmtDayLabel(r.date)}</b></div>
                  <div className="py-cell" style={{ display: 'flex', alignItems: 'center', gap: 8 }}><PersonAvatar p={clients.find((c) => c.name === r.client)} size={24} /><span style={{ fontSize: 13 }}>{r.client}</span></div>
                  <div className="py-cell muted" style={{ fontSize: 12 }}>{r.issues}</div>
                  <div className="py-cell"><b style={{ fontSize: 13, color: '#ef4444' }}>{money(r.estCharge)}</b></div>
                  <div className="py-cell" style={{ display: 'flex', gap: 6 }}>
                    {/billable units|rate is \$0|no billing/i.test(r.issues) && bill.autoUnits !== false && <button className="btn btn-xs" data-testid={`blk-fix-${i}`} onClick={() => autoFix(r._link.id)} style={{ borderRadius: 8 }}>Auto-fix</button>}
                    <button className="btn btn-xs btn-ghost" onClick={() => actions.setUI({ section: 'calendar', anchor: r.date, openAppt: r._link.id })} style={{ borderRadius: 8 }}>Open</button>
                  </div>
                </div>
              ))}
              {!blocked.length && <div className="py-empty" style={{ padding: 48, textAlign: 'center' }}><b>No blocked lines in this window</b><div className="muted" style={{ fontSize: 12 }}>All sessions are claim-ready or already claimed</div></div>}
            </div>
          </div>
        </div>
      )}

      {tab === 'setup' && (
        <div style={{ padding: '0 16px 16px', display: 'grid', gridTemplateColumns: '380px 1fr', gap: 20, alignItems: 'start' }}>
          <div className="panel" style={{ borderRadius: 14, padding: 20, border: '1px solid var(--line)' }}>
            <b style={{ fontSize: 14 }}>Practice Identity</b><div className="muted" style={{ fontSize: 12, marginBottom: 16 }}>Printed on claim forms and invoices</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {[['name', 'Practice name'], ['taxId', 'Tax ID'], ['npi', 'Facility / billing NPI'], ['address', 'Address'], ['phone', 'Phone']].map(([k, l]) => (
                <label key={k} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}><span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--muted)' }}>{l}</span><input className="input" style={{ borderRadius: 10, height: 40 }} data-testid={`bi-${k}`} value={settings.org?.[k] || ''} onChange={(e) => setOrg({ [k]: e.target.value })} /></label>
              ))}
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div className="panel" style={{ borderRadius: 14, padding: 20, border: '1px solid var(--line)' }}>
              <b style={{ fontSize: 14 }}>Rate & Numbering Policy</b>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, marginTop: 16 }}>
                {[['defaultRate', 'Default unit rate $'], ['mileageRate', 'Mileage $/mi'], ['invoicePrefix', 'Invoice prefix', true], ['dueDays', 'Net terms (days)']].map(([k, l, text]) => (
                  <label key={k} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}><span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--muted)' }}>{l}</span><input className="input" style={{ borderRadius: 10, height: 40 }} data-testid={`bi-${k}`} type={text ? 'text' : 'number'} step={k === 'mileageRate' ? 0.05 : 1} value={k === 'invoicePrefix' ? bill.invoicePrefix || '' : settings[k]} onChange={(e) => (k === 'invoicePrefix' ? setBill({ invoicePrefix: e.target.value }) : actions.setSettings({ [k]: Number(e.target.value) || 0 }))} /></label>
                ))}
                <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}><span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--muted)' }}>Claim prefix</span><input className="input" style={{ borderRadius: 10, height: 40 }} data-testid="bi-claimPrefix" value={bill.claimPrefix || 'CLM'} onChange={(e) => setBill({ claimPrefix: e.target.value.toUpperCase() || 'CLM' })} /></label>
              </div>
            </div>
            <div className="panel" style={{ borderRadius: 14, padding: 20, border: '1px solid var(--line)' }}>
              <b style={{ fontSize: 14 }}>Claim Gates</b>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 16 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px', borderRadius: 12, border: '1px solid var(--line)', background: bill.requireVerification !== false ? '#f0fdf4' : 'var(--panel)', cursor: 'pointer' }}>
                  <input type="checkbox" checked={bill.requireVerification !== false} onChange={() => setBill({ requireVerification: bill.requireVerification === false })} data-testid="bi-requirever" />
                  <span><b style={{ fontSize: 13 }}>Require session verification before a line can go on a claim</b><span className="muted" style={{ display: 'block', fontSize: 12 }}>{blocked.filter((b) => /verification/i.test(b.issues)).length} lines gated right now</span></span>
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px', borderRadius: 12, border: '1px solid var(--line)', background: bill.autoUnits !== false ? '#eff6ff' : 'var(--panel)', cursor: 'pointer' }}>
                  <input type="checkbox" checked={bill.autoUnits !== false} onChange={() => setBill({ autoUnits: bill.autoUnits === false })} data-testid="bi-autounits" />
                  <span><b style={{ fontSize: 13 }}>Auto-fill units from duration & code</b><span className="muted" style={{ display: 'block', fontSize: 12 }}>Powers the one-click fixes on Blocked</span></span>
                </label>
              </div>
              <div style={{ marginTop: 20 }}>
                <b style={{ fontSize: 13 }}>CPT Code Table</b>
                <div className="py-tbl" style={{ marginTop: 12, borderRadius: 12, border: '1px solid var(--line)' }}>
                  <div className="py-thead" style={{ gridTemplateColumns: '90px 1fr 80px 80px', background: 'var(--panel-2)' }}><span>Code</span><span>Description</span><span>Unit</span><span>Rate</span></div>
                  {BILL_CODES.map((c) => (
                    <div key={c.id} className="py-trow" style={{ gridTemplateColumns: '90px 1fr 80px 80px', minHeight: 44 }}><div className="py-cell"><b>{c.id}</b></div><div className="py-cell">{c.label.split(' · ')[1]}</div><div className="py-cell">{c.unitMins} min</div><div className="py-cell" style={{ fontWeight: 700 }}>${c.rate}</div></div>
                  ))}
                </div>
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
    try { claimTo1500(state, claim).save(`${claim.no}-1500.pdf`) } catch (e) { }
    toast({ message: `CMS-1500 exported — ${claim.no}`, kind: 'ok' })
  }

  return (
    <section className="clm-doc panel" data-testid="clm-form" style={{ borderRadius: 14, border: '1px solid var(--line)' }}>
      <header style={{ padding: '18px 20px', borderBottom: '1px solid var(--line)', background: 'var(--panel-2)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span className={`cd-mode ${claim.mode}`} style={{ fontSize: 10, fontWeight: 800, padding: '4px 10px', borderRadius: 20, background: claim.mode === 'selfpay' ? '#fef3c7' : '#dbeafe', border: '1px solid var(--line)' }}>{claim.mode === 'selfpay' ? 'INVOICE' : 'CLAIM'}</span>
          <h2 style={{ fontSize: 18, margin: 0 }}>{claim.no}{claim.version > 1 ? <em style={{ fontSize: 11, background: '#6366f1', color: '#fff', padding: '2px 8px', borderRadius: 20, marginLeft: 8 }}>v{claim.version}</em> : null}</h2>
          <StatusChip s={claim.status} />
          {age ? <span className={`cd-aging ${age.late ? 'late' : ''}`} data-testid="clm-aging" style={{ fontSize: 11, padding: '4px 10px', borderRadius: 20, background: age.late ? '#fee2e2' : '#ecfdf5', border: '1px solid var(--line)' }}>{age.days} days out</span> : null}
          {gated ? <span className="tag warn" style={{ fontSize: 11 }}>{gated} gated</span> : null}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 16 }}>
          {claim.status === 'draft' && <button className="btn btn-sm btn-primary" data-testid="clm-submit" onClick={onSubmit} style={{ borderRadius: 9 }}>{Icon.check({ size: 12 })} Submit</button>}
          {claim.status === 'submitted' && (<><button className="btn btn-sm btn-primary" data-testid="clm-pay" onClick={() => setPayOpen(true)} style={{ borderRadius: 9 }}>{Icon.dollar({ size: 12 })} Post payment</button><button className="btn btn-sm" data-testid="clm-deny" onClick={() => setDenyOpen(true)} style={{ borderRadius: 9 }}>{Icon.ban({ size: 12 })} Record denial</button></>)}
          {claim.status === 'partially_paid' && client?.secondary && !claim.secondary && <button className="btn btn-sm btn-primary" data-testid="clm-file-sec" onClick={() => { const r = actions.fileSecondaryClaim(claim.id); toast({ message: r.msg, kind: r.ok ? 'ok' : 'warn' }) }} style={{ borderRadius: 9 }}>{Icon.file({ size: 12 })} File secondary</button>}
          {claim.status === 'denied' && (<><button className="btn btn-sm btn-primary" data-testid="clm-rebill" onClick={onRebill} style={{ borderRadius: 9 }}>{Icon.repeat({ size: 12 })} Rebill{disputed.size ? ` (${disputed.size})` : ''}</button><button className="btn btn-sm" data-testid="clm-writeoff" onClick={onWriteOff} style={{ borderRadius: 9 }}>Write off</button></>)}
          {(claim.status === 'draft' || claim.status === 'submitted') && <button className="btn btn-sm" data-testid="clm-void" onClick={onVoid} style={{ borderRadius: 9 }}>{Icon.trash({ size: 12 })} Void</button>}
          <button className="btn btn-sm" data-testid="clm-cms1500" onClick={export1500} style={{ borderRadius: 9 }}>{Icon.print({ size: 12 })} CMS-1500</button>
          <span style={{ width: 1, height: 20, background: 'var(--line)', margin: '0 4px' }} />
          <button className="btn btn-sm" onClick={() => { download(`${claim.no}.csv`, claimCsv(state, claim)); toast({ message: `${claim.no} exported`, kind: 'ok' }) }} data-testid="clm-csv" style={{ borderRadius: 9 }}>{Icon.download({ size: 12 })} CSV</button>
          <button className="btn btn-sm" onClick={() => window.print()} data-testid="clm-print" style={{ borderRadius: 9 }}>{Icon.print({ size: 12 })} Print</button>
        </div>
        <div style={{ display: 'flex', gap: 20, marginTop: 16, fontSize: 13 }}><span>charges <b>{money(claim.charges)}</b></span>{claim.adj ? <span>adj <b style={{ color: '#ef4444' }}>-{money(claim.adj)}</b></span> : null}<span>due <b style={{ color: due > 0 ? '#ef4444' : '#10b981' }}>{money(due)}</b></span>{claim.parentNo ? <span>Prior claim <b>{claim.parentNo}</b></span> : null}</div>
      </header>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 1, background: 'var(--line)' }}>
        <div style={{ background: 'var(--panel)', padding: '14px 16px' }}><span style={{ fontSize: 10, textTransform: 'uppercase', color: 'var(--muted)', fontWeight: 700 }}>Billing provider</span><b style={{ display: 'block', fontSize: 13, marginTop: 4 }}>{org.name || 'Practice'}</b><span style={{ fontSize: 11, color: 'var(--muted)' }}>{org.address} · {org.phone}</span></div>
        <div style={{ background: 'var(--panel)', padding: '14px 16px' }}><span style={{ fontSize: 10, textTransform: 'uppercase', color: 'var(--muted)', fontWeight: 700 }}>Patient</span><b style={{ display: 'block', fontSize: 13, marginTop: 4 }}>{client.name || '—'}</b><span style={{ fontSize: 11, color: 'var(--muted)' }}>Member {memberIdOf({ id: client.id, insurer: claim.payer })}</span></div>
        <div style={{ background: 'var(--panel)', padding: '14px 16px' }}><span style={{ fontSize: 10, textTransform: 'uppercase', color: 'var(--muted)', fontWeight: 700 }}>Payer</span><b style={{ display: 'block', fontSize: 13, marginTop: 4 }}>{claim.mode === 'selfpay' ? 'Self-pay' : claim.payer}</b><span style={{ fontSize: 11, color: 'var(--muted)' }}>Auth {authNoOf(client)}</span></div>
        <div style={{ background: 'var(--panel)', padding: '14px 16px' }}><span style={{ fontSize: 10, textTransform: 'uppercase', color: 'var(--muted)', fontWeight: 700 }}>Service period</span><b style={{ display: 'block', fontSize: 13, marginTop: 4 }}>{claim.dosFrom} → {claim.dosTo}</b><span style={{ fontSize: 11, color: 'var(--muted)' }}>{claim.lines.length} lines · {claim.units} units</span></div>
      </div>

      <div className={`cd-banner ${claim.status === 'denied' ? 'danger' : claim.status === 'paid' ? 'ok' : gated ? 'warn' : 'info'}`} data-testid="clm-banner" style={{ padding: '14px 20px', borderTop: '1px solid var(--line)', borderBottom: '1px solid var(--line)', fontSize: 13, background: claim.status === 'denied' ? '#fef2f2' : claim.status === 'paid' ? '#f0fdf4' : gated ? '#fffbeb' : '#eff6ff' }}>
        {claim.timelyDue && (() => { const today = new Date().toISOString().slice(0, 10); const overdue = today > claim.timelyDue; return overdue ? <span className="sev-pill sev-error">timely filing past due {claim.timelyDue}</span> : <span className="sev-pill sev-notice">filing due {claim.timelyDue}</span> })()}
        {claim.status === 'denied' && <span><b>{claim.denial.reason}.</b> {claim.denial.fix}.</span>}
        {claim.status === 'paid' && <span>Paid {money(claim.paid)} via {claim.remittance?.checkNo || '—'} · {relDay(claim.remittance?.at)}</span>}
        {claim.status === 'submitted' && <span>Waiting on {claim.mode === 'selfpay' ? 'family payment' : claim.payer}{age ? ` — ${age.days} days out` : ''}</span>}
        {claim.status === 'draft' && gated ? <span><b>Submission held:</b> {gate.bad.map((b) => b.why).slice(0, 2).join(' · ')}</span> : null}
        {claim.status === 'partially_paid' && <span>Partially paid — {money(due)} open</span>}
        {claim.status === 'void' && <span>Voided — {claim.lines.length} lines returned to staging.</span>}
      </div>

      <div className="py-tbl cd-lines" data-testid="clm-lines">
        <div className="py-thead" style={{ gridTemplateColumns: `${editable && claim.status === 'denied' ? '36px ' : ''}40px 110px 90px 1fr 100px 70px 100px`, background: 'var(--panel-2)', fontSize: 11, padding: '12px 16px' }}>
          {editable && claim.status === 'denied' ? <span /> : null}<span>#</span><span>Date</span><span>Code</span><span>Description</span><span>Provider</span><span>Units</span><span>Charge</span>
        </div>
        {claim.lines.map((l, i) => {
          const src = appts[l.apptId]
          const isBad = badIds.has(l.apptId)
          return (
            <div key={l.apptId} className={`py-trow ${isBad ? 'gated' : ''} ${disputed.has(l.apptId) ? 'disputed' : ''}`} data-testid={`clm-line-${i}`} style={{ gridTemplateColumns: `${editable && claim.status === 'denied' ? '36px ' : ''}40px 110px 90px 1fr 100px 70px 100px`, minHeight: 52, background: disputed.has(l.apptId) ? '#fffbeb' : isBad ? '#fef2f2' : undefined }}>
              {editable && claim.status === 'denied' && (<div className="py-cell"><button className="iconbtn" style={{ width: 28, height: 28, border: '1px solid var(--line)', borderRadius: 6 }} onClick={() => toggleDispute(l.apptId)} data-testid={`clm-dispute-${i}`}><span className={`cb ${disputed.has(l.apptId) ? 'on' : ''}`} style={{ width: 14, height: 14, borderRadius: 4, border: '1.5px solid var(--line)', display: 'grid', placeItems: 'center', background: disputed.has(l.apptId) ? 'var(--accent)' : 'var(--panel)', color: '#fff' }}>{disputed.has(l.apptId) ? '✓' : ''}</span></button></div>)}
              <div className="py-cell muted" style={{ fontSize: 12 }}>{i + 1}</div>
              <div className="py-cell"><b style={{ fontSize: 13 }}>{l.dos}</b><div style={{ fontSize: 11, color: 'var(--muted)' }}>{l.kind === 'mileage' ? 'trip' : `${hhmm(l.t0)}–${hhmm(l.t1)}`}</div></div>
              <div className="py-cell"><span className="ln-code" style={{ fontSize: 12 }}>{l.code}</span></div>
              <div className="py-cell" style={{ fontSize: 13 }}>{l.desc}<div style={{ fontSize: 11, color: 'var(--muted)' }}>{dx[i % dx.length]}</div></div>
              <div className="py-cell" style={{ fontSize: 12 }}>{l.staff.split(', ')[0] || '—'}</div>
              <div className="py-cell" style={{ fontSize: 12 }}>{l.kind === 'mileage' ? `${l.units} mi` : `${l.units}u`}</div>
              <div className="py-cell" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><b style={{ fontSize: 14, color: '#059669' }}>{money(l.charge)}</b><div style={{ display: 'flex', gap: 4 }}>{src && <button className="iconbtn" style={{ width: 28, height: 28 }} onClick={() => actions.setUI({ section: 'calendar', anchor: l.dos, openAppt: l.apptId })}>{Icon.chevronR({ size: 12 })}</button>}{claim.status === 'draft' && <button className="iconbtn" style={{ width: 28, height: 28 }} data-testid={`clm-drop-${i}`} onClick={() => onDropLine(l.apptId)}>{Icon.x({ size: 12 })}</button>}</div></div>
            </div>
          )
        })}
        <div className="py-trow" style={{ gridTemplateColumns: `${editable && claim.status === 'denied' ? '36px ' : ''}40px 110px 90px 1fr 100px 70px 100px`, fontWeight: 700, background: 'var(--panel-2)', minHeight: 52, borderTop: '2px solid var(--line)' }}>
          <div className="py-cell" style={{ gridColumn: `span ${claim.status === 'denied' ? 6 : 5}`, fontSize: 13 }}>Total charges {money(claim.charges)}{copay ? <span style={{ fontWeight: 400, color: 'var(--muted)', marginLeft: 8 }}>copay {money(copay)}</span> : null}</div>
          <div className="py-cell" style={{ fontSize: 14, textAlign: 'right' }}>{due > 0 ? `due ${money(due)}` : 'settled'}</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, padding: 20 }}>
        <div className="panel" style={{ borderRadius: 12, padding: 16, background: 'var(--panel-2)', border: '1px solid var(--line)' }}>
          <b style={{ fontSize: 12, textTransform: 'uppercase', color: 'var(--muted)' }}>Lifecycle</b>
          <ul style={{ listStyle: 'none', padding: 0, margin: '12px 0 0', display: 'flex', flexDirection: 'column', gap: 10 }} data-testid="clm-timeline">
            {[...claim.history].reverse().map((h, i) => (
              <li key={i} data-testid={`clm-ev-${i}`} style={{ display: 'flex', gap: 12, fontSize: 13 }}><span style={{ width: 8, height: 8, borderRadius: 4, background: i === 0 ? '#10b981' : 'var(--line)', marginTop: 6, flex: 'none' }} /><span><b>{h.ev}</b><span style={{ display: 'block', fontSize: 11, color: 'var(--muted)' }}>{relDay(h.at)}</span></span></li>
            ))}
          </ul>
        </div>
        <div className="panel" style={{ borderRadius: 12, padding: 16, border: '1px solid var(--line)' }}>
          <b style={{ fontSize: 12, textTransform: 'uppercase', color: 'var(--muted)' }}>Billing Note</b>
          <textarea className="input" rows={3} placeholder="Context for next person on this claim" value={noteDraft} onChange={(e) => setNoteDraft(e.target.value)} data-testid="clm-note" style={{ marginTop: 12, borderRadius: 10, fontSize: 13 }} />
          {noteDraft !== (claim.note || '') && <button className="btn btn-sm" style={{ marginTop: 10, borderRadius: 9 }} data-testid="clm-note-save" onClick={() => { actions.addClaimNote(claim.id, noteDraft); toast({ message: 'Note saved', kind: 'ok' }) }}>Save note</button>}
          {claim.remittance?.note ? <div style={{ fontSize: 12, marginTop: 10, color: 'var(--muted)' }}>Remittance note: {claim.remittance.note}</div> : null}
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
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ width: 'min(560px, 92vw)', borderRadius: 14 }} data-testid="pay-modal">
        <div className="modal-head" style={{ padding: '16px 20px' }}><h2 style={{ fontSize: 16, margin: 0 }}>Post Payment — {claim.no}</h2><button className="modal-x" aria-label="Close" onClick={onClose} style={{ marginLeft: 'auto' }}>{Icon.x({ size: 14 })}</button></div>
        <div className="modal-body" style={{ padding: 20 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }} data-testid="pay-quick-row">
            {posts.map((p) => (<button key={p.id} className="btn btn-xs" data-testid={`pay-quick-${p.id}`} onClick={() => { setAmount(p.amount); setAdj(p.adj || 0); setNote(p.note || '') }} style={{ borderRadius: 20 }}>{p.label}</button>))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}><span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--muted)' }}>Payment amount $</span><input className="input" style={{ height: 40 }} type="number" step="0.01" value={amount} onChange={(e) => setAmount(Number(e.target.value))} data-testid="pay-amount" /></label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}><span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--muted)' }}>Adjustment $</span><input className="input" style={{ height: 40 }} type="number" step="0.01" value={adj} onChange={(e) => setAdj(Number(e.target.value))} data-testid="pay-adj" /></label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}><span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--muted)' }}>Check / EFT ref</span><input className="input" style={{ height: 40 }} value={check} onChange={(e) => setCheck(e.target.value)} data-testid="pay-check" /></label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}><span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--muted)' }}>Posted on</span><input className="input" style={{ height: 40 }} type="date" value={todayISO()} readOnly data-testid="pay-date" /></label>
          </div>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 16 }}><span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--muted)' }}>Note</span><input className="input" style={{ height: 40 }} value={note} onChange={(e) => setNote(e.target.value)} placeholder="optional" data-testid="pay-note" /></label>
          <div className={`pm-due ${Math.abs(due) < 0.5 ? 'ok' : 'warn'}`} data-testid="pay-due" style={{ marginTop: 16, padding: '12px 14px', borderRadius: 10, background: Math.abs(due) < 0.5 ? '#f0fdf4' : '#fffbeb', border: '1px solid var(--line)', fontSize: 13 }}>{Math.abs(due) < 0.5 ? `Balances to zero — claim will close as paid` : `Posting leaves ${money(due)} open`}</div>
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', padding: '14px 20px', borderTop: '1px solid var(--line)', background: 'var(--panel-2)' }}>
          <button className="btn btn-sm" onClick={onClose} style={{ borderRadius: 10 }}>Cancel</button>
          <button className="btn btn-sm btn-primary" onClick={post} data-testid="pay-post" style={{ borderRadius: 10 }}>Post {money(amount)}</button>
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
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ width: 'min(540px, 92vw)', borderRadius: 14 }} data-testid="deny-modal">
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 12, background: 'var(--panel-2)' }}><span style={{ width: 32, height: 32, borderRadius: 9, background: '#fee2e2', color: '#ef4444', display: 'grid', placeItems: 'center' }}>{Icon.ban({ size: 16 })}</span><h2 style={{ fontSize: 16, margin: 0 }}>Record Denial — {claim.no}</h2><button className="modal-x" aria-label="Close" onClick={onClose} style={{ marginLeft: 'auto' }}>{Icon.x({ size: 14 })}</button></div>
        <div style={{ padding: 20 }}>
          <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--muted)' }}>Denial reason</span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
            {DENIAL_REASONS.map((r) => (
              <button key={r.id} data-testid={`deny-r-${r.id}`} onClick={() => setCode(r.id)} style={{ textAlign: 'left', padding: '12px 14px', borderRadius: 10, border: `1.5px solid ${code === r.id ? '#ef4444' : 'var(--line)'}`, background: code === r.id ? '#fff5f5' : 'var(--panel)' }}><b style={{ fontSize: 13 }}>{r.label}</b><span style={{ display: 'block', fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{r.fix}</span></button>
            ))}
          </div>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 16 }}><span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--muted)' }}>Note</span><input className="input" style={{ height: 40 }} value={note} onChange={(e) => setNote(e.target.value)} placeholder="letter/EOB reference" data-testid="deny-note" /></label>
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', padding: '14px 20px', borderTop: '1px solid var(--line)', background: 'var(--panel-2)' }}>
          <button className="btn btn-sm" onClick={onClose} style={{ borderRadius: 10 }}>Cancel</button>
          <button className="btn btn-sm btn-primary" data-testid="deny-go" onClick={() => { const r = actions.denyClaim(claim.id, { code, note }); toast({ message: `${r.msg} — U to undo`, kind: 'warn' }); onClose() }} style={{ borderRadius: 10, background: '#ef4444', border: 'none' }}>Mark denied</button>
        </div>
      </div>
    </div>
  )
}
