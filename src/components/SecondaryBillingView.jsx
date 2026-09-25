import React, { useMemo, useState } from 'react'
import { useStore } from '../state/store'
import { SectionBar, RangePicker } from './NavRail'
import { Icon } from '../ui/Icons'
import { useToast } from '../ui/Toast'
import { resolveRange } from '../lib/analytics'
import { download } from '../lib/ics'
import { isoDate, addDays, parseISO, fmtDayLabel, todayISO } from '../lib/date'
import { dueOf, secondaryEligible } from '../lib/claims'

const money = (n) => `$${(Math.round(n * 100) / 100).toLocaleString(undefined, { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`

export default function SecondaryBillingView() {
  const state = useStore()
  const { ui, actions, settings, claims, clients, payers } = state
  const toast = useToast()
  const preset = ui.secPreset || 'last4'
  const range = useMemo(() => resolveRange(preset, ui.anchor, settings.weekStart), [preset, ui.anchor, settings.weekStart])
  const [q, setQ] = useState('')
  const [statusF, setStatusF] = useState('all')
  const [openSubmit, setOpenSubmit] = useState(null)

  const allClaims = useMemo(() => Object.values(claims), [claims])
  const readyPrimaries = useMemo(() => allClaims.filter((c) => secondaryEligible(state, c)), [allClaims, state])
  const secondaryClaims = useMemo(() => allClaims.filter((c) => c.method === 'secondary'), [allClaims])

  const queue = useMemo(() => {
    const rows = []
    for (const c of readyPrimaries) {
      const client = clients.find((x) => x.id === c.clientId) || {}
      const sec = client.secondary
      const secPayer = sec ? payers.find((p) => p.id === sec.payerId) : null
      rows.push({ id: c.id, kind: 'ready', primary: c, secondary: null, client, sec, secPayer, remaining: dueOf(c), status: 'ready' })
    }
    for (const c of secondaryClaims) {
      const primary = claims[c.secondary] || allClaims.find((x) => x.no === c.parentNo) || null
      const client = clients.find((x) => x.id === c.clientId) || {}
      const sec = client.secondary
      const secPayer = sec ? payers.find((p) => p.id === sec.payerId) : payers.find((p) => p.name === c.payer) || null
      rows.push({ id: c.id, kind: 'secondary', primary: primary || c, secondary: c, client, sec, secPayer, remaining: dueOf(c), status: c.status })
    }
    return rows
  }, [readyPrimaries, secondaryClaims, clients, payers, claims, allClaims])

  const filtered = useMemo(() => {
    let out = queue
    if (statusF !== 'all') out = out.filter((r) => r.status === statusF)
    if (q.trim()) {
      const t = q.trim().toLowerCase()
      out = out.filter((r) => `${r.client?.name || ''} ${r.primary?.no || ''} ${r.secondary?.no || ''} ${r.secPayer?.name || ''} ${r.primary?.payer || ''}`.toLowerCase().includes(t))
    }
    out = out.filter((r) => {
      const dos = r.primary?.dosFrom
      if (!dos) return true
      return dos >= range.days[0] && dos <= range.days[range.days.length - 1]
    })
    return out.sort((a, b) => (a.primary?.dosFrom || '') < (b.primary?.dosFrom || '') ? -1 : 1)
  }, [queue, statusF, q, range])

  const stats = useMemo(() => {
    const ready = queue.filter((r) => r.status === 'ready').length
    const submitted = queue.filter((r) => r.status === 'submitted').length
    const paid = queue.filter((r) => r.status === 'paid').length
    const denied = queue.filter((r) => r.status === 'denied').length
    const totalRemaining = queue.reduce((s, r) => s + r.remaining, 0)
    return { ready, submitted, paid, denied, total: queue.length, totalRemaining }
  }, [queue])

  const handleRelease = (row) => {
    if (row.kind === 'ready') {
      const r = actions.voidClaim(row.primary.id)
      toast({ message: r.msg, kind: r.ok ? 'ok' : 'warn' })
    } else {
      const sec = row.secondary
      const primary = row.primary
      const r = actions.voidClaim(sec.id)
      if (primary && primary.secondary === sec.id) {
        const patched = { ...primary, secondary: null, history: [...primary.history, { at: Date.now(), ev: `Secondary ${sec.no} released — back to staging` }] }
        state.dispatch({ type: 'claimsTx', claimUpserts: [patched] })
      }
      toast({ message: r.msg + ' — secondary chain released', kind: r.ok ? 'ok' : 'warn' })
    }
  }
  const handleSkip = (row) => {
    const primary = row.primary
    const at = Date.now()
    const patched = { ...primary, secondary: 'skipped', history: [...primary.history, { at, ev: `Secondary skipped — ${money(row.remaining)} to patient balance` }] }
    state.dispatch({ type: 'claimsTx', claimUpserts: [patched] })
    toast({ message: `${primary.no} secondary skipped — ${money(row.remaining)} to patient balance`, kind: 'info' })
  }
  const handleSubmit = (row, method) => {
    const primary = row.primary
    const client = row.client
    const sec = row.sec
    const secPayer = row.secPayer
    const at = Date.now()
    const existingSecs = allClaims.filter((c) => c.parentNo === primary.no || c.secondary === primary.id || (c.no && c.no.startsWith(primary.no + '-S')))
    let nextNum = 1
    if (existingSecs.length) {
      const nums = existingSecs.map((c) => { const m = /-S(\d+)$/.exec(c.no || ''); return m ? Number(m[1]) : 0 })
      nextNum = Math.max(0, ...nums) + 1
    }
    const secNo = `${primary.no}-S${nextNum}`
    const secondary = {
      id: `${primary.id}-sec-${at.toString(36)}-${nextNum}`, no: secNo, clientId: primary.clientId, payer: secPayer?.name || sec?.payerId || 'Secondary',
      mode: 'insurance', method: 'secondary', secondary: primary.id, dosFrom: primary.dosFrom, dosTo: primary.dosTo,
      lines: primary.lines.map((l) => ({ ...l })), status: 'submitted', charges: row.remaining > 0 ? row.remaining : primary.charges, units: primary.units,
      adj: 0, paid: 0, remittance: null, denial: null, parentNo: primary.no, version: 1, timelyDue: primary.timelyDue, submittedAt: at, closedAt: null, createdAt: at,
      submitMethod: method, note: `Secondary from ${primary.no} via ${method}`, history: [{ at, ev: `Secondary ${secNo} submitted via ${method} — $${(row.remaining > 0 ? row.remaining : primary.charges).toFixed(2)} remaining` }],
    }
    const primaryPatched = { ...primary, secondary: secondary.id, history: [...primary.history, { at, ev: `Secondary filing ${secNo} via ${method} → ${secPayer?.name || sec?.payerId || ''}` }] }
    const fileBase = secNo
    let artifacts = []
    if (method === 'ch') {
      const csv = `claim,payer,client,dos_from,dos_to,charges,method,secondary_no,Box 18\n${secondary.no},${secondary.payer},"${client.name || ''}",${secondary.dosFrom},${secondary.dosTo},${secondary.charges},${method},${secNo},X — Box 18 = X`
      artifacts.push({ fileName: `${fileBase}-837P.csv`, content: csv, format: '837p' })
      artifacts.push({ fileName: `${fileBase}-CMS1500.pdf`, content: `CMS-1500 Secondary ${secNo} Box 18 X Box 11B ${secondary.payer} Method ${method}`, format: 'cms1500' })
    } else if (method === 'paper_bg') {
      const bg = `Primary remittance snapshot for ${primary.no} — paid $${(primary.paid || 0).toFixed(2)}`
      artifacts.push({ fileName: `${fileBase}-CMS1500-bg.pdf`, content: `CMS-1500 Secondary ${secNo} Box 18 X Background Attached\n${bg}`, format: 'cms1500' })
      artifacts.push({ fileName: `${fileBase}-remit-bg.txt`, content: bg, format: 'remit_bg' })
    } else {
      artifacts.push({ fileName: `${fileBase}-CMS1500-nobg.pdf`, content: `CMS-1500 Secondary ${secNo} Box 18 X No Background Method ${method}`, format: 'cms1500' })
    }
    const billedFiles = {}
    for (const art of artifacts) {
      const bfId = `bf-${at.toString(36)}-${Math.random().toString(36).slice(2, 6)}`
      billedFiles[bfId] = { id: bfId, fileName: art.fileName, payer: secondary.payer, clientCount: 1, claimCount: 1, claimIds: [secondary.id], date: todayISO(), sendCount: 1, content: art.content, createdAt: at, format: art.format, status: 'sent', billedThrough: secondary.dosTo }
    }
    state.dispatch({ type: 'claimsTx', claimUpserts: [primaryPatched, secondary], billedFiles })
    toast({ message: `${secNo} submitted via ${method} — ${artifacts.length} artifact(s)`, kind: 'ok' })
    setOpenSubmit(null)
  }

  return (
    <div className="sectionpage" data-testid="sb-sec">
      <SectionBar icon="shield" title="Secondary Billing" sub={`${stats.ready} ready · ${stats.submitted} submitted · ${stats.total} total · ${money(stats.totalRemaining)} remaining · ${range.label}`}>
        <RangePicker preset={preset} onPreset={(p) => actions.setUI({ secPreset: p })} onSlide={(d) => actions.setUI({ anchor: isoDate(addDays(parseISO(ui.anchor), d * range.days.length)) })} label={range.label} />
        <div className="viewseg" data-testid="sb-status-filter">
          {['all', 'ready', 'submitted', 'paid', 'denied'].map((s) => (
            <button key={s} className={statusF === s ? 'on' : ''} data-testid={`sb-filter-${s}`} onClick={() => setStatusF(s)}>{s}</button>
          ))}
        </div>
        <div className="sb-search" style={{ minWidth: 200 }}>
          <span className="sic">{Icon.search({ size: 12 })}</span>
          <input placeholder="Search client / claim / payer…" value={q} onChange={(e) => setQ(e.target.value)} data-testid="sb-search" />
        </div>
      </SectionBar>

      <div className="batch-strip" data-testid="sb-kpis" style={{ padding: '12px 16px', gap: 10, flexWrap: 'wrap' }}>
        <div className="rp-sumchip on" data-testid="sb-kpi-ready" style={{ background: 'var(--panel)', border: '1px solid var(--line)', display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ width: 28, height: 28, borderRadius: 8, background: '#f59e0b', color: '#fff', display: 'grid', placeItems: 'center' }}>{Icon.clock({ size: 12 })}</span>
          <div><b>{stats.ready}</b><span>Ready</span><i>Primary settled, COB eligible</i></div>
        </div>
        <div className="rp-sumchip" data-testid="sb-kpi-submitted" style={{ background: 'var(--panel)', border: '1px solid var(--line)', display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ width: 28, height: 28, borderRadius: 8, background: '#0ea5e9', color: '#fff', display: 'grid', placeItems: 'center' }}>{Icon.file({ size: 12 })}</span>
          <div><b>{stats.submitted}</b><span>Submitted</span><i>Secondary filed</i></div>
        </div>
        <div className="rp-sumchip" data-testid="sb-kpi-paid" style={{ background: 'var(--panel)', border: '1px solid var(--line)', display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ width: 28, height: 28, borderRadius: 8, background: '#10b981', color: '#fff', display: 'grid', placeItems: 'center' }}>{Icon.checkCircle({ size: 12 })}</span>
          <div><b>{stats.paid}</b><span>Paid</span><i>Secondary closed</i></div>
        </div>
        <div className="rp-sumchip" data-testid="sb-kpi-denied" style={{ background: 'var(--panel)', border: '1px solid var(--line)', display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ width: 28, height: 28, borderRadius: 8, background: '#ef4444', color: '#fff', display: 'grid', placeItems: 'center' }}>{Icon.ban({ size: 12 })}</span>
          <div><b>{stats.denied}</b><span>Denied</span><i>Needs action</i></div>
        </div>
        <div className="rp-sumchip" data-testid="sb-kpi-remaining" style={{ background: 'var(--panel)', border: '1px solid var(--line)', display: 'flex', gap: 8, alignItems: 'center', marginLeft: 'auto' }}>
          <span style={{ width: 28, height: 28, borderRadius: 8, background: '#6366f1', color: '#fff', display: 'grid', placeItems: 'center' }}>{Icon.dollar({ size: 12 })}</span>
          <div><b>{money(stats.totalRemaining)}</b><span>Remaining</span><i>Total secondary AR</i></div>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="panel" style={{ margin: 16, borderRadius: 12, overflow: 'hidden' }}>
          <div className="py-empty" data-testid="sb-empty" style={{ padding: 48, textAlign: 'center' }}>
            <div style={{ width: 64, height: 64, borderRadius: 16, background: 'var(--panel-2)', display: 'grid', placeItems: 'center', margin: '0 auto 16px', fontSize: 32 }}>🛡️</div>
            <b style={{ fontSize: 14 }}>No secondary claims waiting</b>
            <div className="muted" style={{ fontSize: 12, marginTop: 8, maxWidth: 480, marginInline: 'auto' }}>When a primary payment settles with a payer balance and the client carries secondary coverage, it queues here. Add secondary insurance to a client and partially pay a primary claim to see it here.</div>
          </div>
        </div>
      ) : (
        <div style={{ padding: 16 }}>
          <div className="panel" style={{ borderRadius: 12, overflow: 'hidden', boxShadow: 'var(--shadow-1)' }}>
            <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 8, background: 'var(--panel-2)' }}>
              <span style={{ width: 24, height: 24, borderRadius: 6, background: '#f59e0b', color: '#fff', display: 'grid', placeItems: 'center' }}>{Icon.shield({ size: 12 })}</span>
              <b style={{ fontSize: 12 }}>Secondary Queue — {filtered.length} items</b>
              <span className="tag soft" style={{ marginLeft: 8 }}>{stats.ready} ready</span>
            </div>
            <div className="py-tbl" data-testid="sb-table" style={{ overflow: 'auto' }}>
              <div className="py-thead" style={{ gridTemplateColumns: '1.2fr 1fr 1fr 1fr 0.9fr 0.9fr 0.8fr 0.9fr 0.8fr 0.6fr 1.6fr', background: 'var(--panel-2)', fontSize: 11 }}>
                <span>Client</span><span>Primary #</span><span>Payer (primary)</span><span>Secondary payer</span><span>Member</span><span>Remaining</span><span>DOS</span><span>Submitted</span><span>Auth #</span><span>Status</span><span>Actions</span>
              </div>
              {filtered.slice(0, 100).map((row) => (
                <div key={row.id} className="py-trow" data-testid={`sb-row-${row.id}`} style={{ gridTemplateColumns: '1.2fr 1fr 1fr 1fr 0.9fr 0.9fr 0.8fr 0.9fr 0.8fr 0.6fr 1.6fr', fontSize: 12 }}>
                  <div className="py-idcell"><b>{row.client?.name || '—'}</b><span className="muted" style={{ fontSize: 10 }}>{row.client?.id || ''}</span></div>
                  <div className="py-cell"><span className="ln-code">{row.primary?.no || '—'}</span></div>
                  <div className="py-cell"><span className="tag soft" style={{ fontSize: 10 }}>{row.primary?.payer || '—'}</span></div>
                  <div className="py-cell"><span className="tag" style={{ fontSize: 10 }}>{row.secPayer?.name || row.sec?.payerId || row.secondary?.payer || '—'}</span></div>
                  <div className="py-cell muted" style={{ fontSize: 11 }}>{row.sec?.memberId || '—'}</div>
                  <div className="py-cell num" data-testid={`sb-remaining-${row.id}`}><b>{money(row.remaining)}</b></div>
                  <div className="py-cell muted" style={{ fontSize: 11 }}>{row.primary?.dosFrom || '—'}</div>
                  <div className="py-cell muted" style={{ fontSize: 11 }}>{row.primary?.submittedAt ? fmtDayLabel(isoDate(new Date(row.primary.submittedAt))) : '—'}</div>
                  <div className="py-cell muted" style={{ fontSize: 11 }}>{row.sec?.authNo || '—'}</div>
                  <div className="py-cell"><span className="pill" style={{ background: row.status === 'ready' ? '#fef3c7' : row.status === 'submitted' ? '#e0f2fe' : row.status === 'paid' ? '#d7f5e8' : '#fee2e2', fontSize: 10 }}>{row.status}</span></div>
                  <div className="py-cell" style={{ display: 'flex', gap: 4, flexWrap: 'wrap', position: 'relative' }}>
                    <button className="btn btn-xs" data-testid={`sb-release-${row.id}`} onClick={() => handleRelease(row)}>{Icon.undo({ size: 10 })} Release</button>
                    <button className="btn btn-xs" data-testid={`sb-skip-${row.id}`} onClick={() => handleSkip(row)}>{Icon.x({ size: 10 })} Skip</button>
                    <div style={{ position: 'relative' }}>
                      <button className="btn btn-xs btn-primary" data-testid={`sb-submit-${row.id}`} onClick={() => setOpenSubmit(openSubmit === row.id ? null : row.id)}>{Icon.file({ size: 10 })} Submit ▾</button>
                      {openSubmit === row.id && (
                        <div className="panel" data-testid={`sb-submit-menu-${row.id}`} style={{ position: 'absolute', right: 0, top: '100%', zIndex: 20, width: 260, padding: 10, borderRadius: 10, boxShadow: 'var(--shadow-2)', display: 'flex', flexDirection: 'column', gap: 6 }}>
                          <button className="btn btn-sm" data-testid={`sb-submit-ch-${row.id}`} onClick={() => handleSubmit(row, 'ch')}>{Icon.zap({ size: 11 })} Clearing House (CH)</button>
                          <button className="btn btn-sm" data-testid={`sb-submit-bg-${row.id}`} onClick={() => handleSubmit(row, 'paper_bg')}>{Icon.file({ size: 11 })} Paper with Background</button>
                          <button className="btn btn-sm" data-testid={`sb-submit-nobg-${row.id}`} onClick={() => handleSubmit(row, 'paper_nobg')}>{Icon.file({ size: 11 })} Paper without Background</button>
                          <div className="muted" style={{ fontSize: 10, marginTop: 6, lineHeight: 1.4 }}>Box 18 = X on all · background snapshot only for paper_bg · numbering -S1/-S2</div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
              <div className="py-pager" style={{ padding: '10px 14px', borderTop: '1px solid var(--line)', background: 'var(--panel-2)', fontSize: 11, display: 'flex', justifyContent: 'space-between' }}>
                <span className="muted">Showing {Math.min(filtered.length, 100)} of {filtered.length} · {stats.ready} ready, {stats.submitted} submitted</span>
                <span className="muted">Total remaining {money(stats.totalRemaining)}</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
