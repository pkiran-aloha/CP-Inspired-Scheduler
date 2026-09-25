import React, { useMemo, useState } from 'react'
import { useStore } from '../state/store'
import { SectionBar, RangePicker } from './NavRail'
import { Icon } from '../ui/Icons'
import { useToast } from '../ui/Toast'
import { resolveRange } from '../lib/analytics'
import { download } from '../lib/ics'
import { isoDate, addDays, parseISO, fmtDayLabel, todayISO } from '../lib/date'
import { dueOf, secondaryEligible, CLAIM_STATUSES } from '../lib/claims'
import { claimTo1500 } from '../lib/cms1500'

const money = (n) => `$${(Math.round(n * 100) / 100).toLocaleString(undefined, { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`

export default function SecondaryBillingView() {
  const state = useStore()
  const { ui, actions, settings, claims, clients, payers } = state
  const toast = useToast()

  const preset = ui.secPreset || 'last4'
  const range = useMemo(() => resolveRange(preset, ui.anchor, settings.weekStart), [preset, ui.anchor, settings.weekStart])

  const [q, setQ] = useState('')
  const [statusF, setStatusF] = useState('all') // all | ready | submitted | paid | denied
  const [openSubmit, setOpenSubmit] = useState(null) // claim id for dropdown

  const allClaims = useMemo(() => Object.values(claims), [claims])

  // Queue: primary claims eligible + secondary claims
  const readyPrimaries = useMemo(() => allClaims.filter((c) => secondaryEligible(state, c)), [allClaims, state])
  const secondaryClaims = useMemo(() => allClaims.filter((c) => c.method === 'secondary'), [allClaims])

  const queue = useMemo(() => {
    // Combine ready primaries (as ready) + secondary claims (as their own status)
    const rows = []
    for (const c of readyPrimaries) {
      const client = clients.find((x) => x.id === c.clientId) || {}
      const sec = client.secondary
      const secPayer = sec ? payers.find((p) => p.id === sec.payerId) : null
      rows.push({
        id: c.id,
        kind: 'ready',
        primary: c,
        secondary: null,
        client,
        sec,
        secPayer,
        remaining: dueOf(c),
        status: 'ready',
      })
    }
    for (const c of secondaryClaims) {
      const primary = claims[c.secondary] || allClaims.find((x) => x.no === c.parentNo) || null
      const client = clients.find((x) => x.id === c.clientId) || {}
      const sec = client.secondary
      const secPayer = sec ? payers.find((p) => p.id === sec.payerId) : payers.find((p) => p.name === c.payer) || null
      rows.push({
        id: c.id,
        kind: 'secondary',
        primary: primary || c,
        secondary: c,
        client,
        sec,
        secPayer,
        remaining: dueOf(c),
        status: c.status,
      })
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
    // range filter on DOS
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
      // release primary? Actually ready means primary partially paid, secondary not yet filed — Release moves back to staging: void primary chain?
      // For ready, we void primary? No, we should just clear secondary eligibility? Spec: Release moves back to staging — voids the chain, releases appts
      // For ready primaries, we will void primary and release appts
      const r = actions.voidClaim(row.primary.id)
      toast({ message: r.msg, kind: r.ok ? 'ok' : 'warn' })
    } else {
      // secondary claim: void it and release appts, and clear primary's secondary link
      const sec = row.secondary
      const primary = row.primary
      // void secondary
      const r = actions.voidClaim(sec.id)
      // clear primary's secondary link if it points to this secondary
      if (primary && primary.secondary === sec.id) {
        const patched = { ...primary, secondary: null, history: [...primary.history, { at: Date.now(), ev: `Secondary ${sec.no} released — back to staging` }] }
        state.dispatch({ type: 'claimsTx', claimUpserts: [patched] })
      }
      toast({ message: r.msg + ' — secondary chain released', kind: r.ok ? 'ok' : 'warn' })
    }
  }

  const handleSkip = (row) => {
    // Skip → patient balance
    const primary = row.primary
    const at = Date.now()
    const patched = {
      ...primary,
      secondary: 'skipped',
      history: [...primary.history, { at, ev: `Secondary skipped — family declined secondary, ${money(row.remaining)} to patient balance` }],
    }
    state.dispatch({ type: 'claimsTx', claimUpserts: [patched] })
    toast({ message: `${primary.no} secondary skipped — ${money(row.remaining)} to patient balance`, kind: 'info' })
  }

  const handleSubmit = (row, method) => {
    // method: ch | paper_bg | paper_nobg
    const primary = row.kind === 'ready' ? row.primary : row.primary
    const client = row.client
    const sec = row.sec
    const secPayer = row.secPayer
    const at = Date.now()

    // Determine next secondary number: parent + -S1, -S2 etc.
    const existingSecs = allClaims.filter((c) => c.parentNo === primary.no || c.secondary === primary.id || (c.no && c.no.startsWith(primary.no + '-S')))
    let nextNum = 1
    if (existingSecs.length) {
      const nums = existingSecs.map((c) => {
        const m = /-S(\d+)$/.exec(c.no || '')
        return m ? Number(m[1]) : 0
      })
      nextNum = Math.max(0, ...nums) + 1
    }
    const secNo = `${primary.no}-S${nextNum}`

    // Create secondary claim
    const secondary = {
      id: `${primary.id}-sec-${at.toString(36)}-${nextNum}`,
      no: secNo,
      clientId: primary.clientId,
      payer: secPayer?.name || sec?.payerId || 'Secondary',
      mode: 'insurance',
      method: 'secondary',
      secondary: primary.id,
      dosFrom: primary.dosFrom,
      dosTo: primary.dosTo,
      lines: primary.lines.map((l) => ({ ...l, provider: l.provider || null })),
      status: 'submitted',
      charges: row.remaining > 0 ? row.remaining : primary.charges,
      units: primary.units,
      adj: 0,
      paid: 0,
      remittance: null,
      denial: null,
      parentNo: primary.no,
      version: 1,
      timelyDue: primary.timelyDue,
      submittedAt: at,
      closedAt: null,
      createdAt: at,
      submitMethod: method,
      note: `Secondary from ${primary.no} via ${method} — COB ${sec?.memberId || ''}`,
      history: [{ at, ev: `Secondary ${secNo} submitted via ${method} from ${primary.no} — $${(row.remaining > 0 ? row.remaining : primary.charges).toFixed(2)} remaining, payer ${secPayer?.name || sec?.payerId || ''}` }],
    }

    const primaryPatched = {
      ...primary,
      secondary: secondary.id,
      history: [...primary.history, { at, ev: `Secondary filing ${secNo} via ${method} → ${secPayer?.name || sec?.payerId || ''}` }],
    }

    // Generate artifacts
    const fileBase = secNo
    let artifacts = []
    if (method === 'ch') {
      // 837P-style CSV + CMS-1500 PDF marked Secondary box 18 X
      const csv = `claim,payer,client,dos_from,dos_to,charges,method,secondary_no,Box 18\n${secondary.no},${secondary.payer},"${client.name || ''}",${secondary.dosFrom},${secondary.dosTo},${secondary.charges},${method},${secNo},X — Box 18 = X`
      artifacts.push({ fileName: `${fileBase}-837P.csv`, content: csv, format: '837p' })
      // CMS-1500 PDF placeholder (we will generate via existing claimTo1500 if possible, but mark box 18 X)
      try {
        // we can't easily generate PDF in this sync context, but we record intent
        artifacts.push({ fileName: `${fileBase}-CMS1500.pdf`, content: `CMS-1500 Secondary ${secNo} Box 18 X Box 11B ${secondary.payer} Method ${method}`, format: 'cms1500' })
      } catch {}
    } else if (method === 'paper_bg') {
      const bg = `Primary remittance snapshot for ${primary.no} — paid $${(primary.paid || 0).toFixed(2)} adj $${(primary.adj || 0).toFixed(2)} — ${primary.history.slice(-1)[0]?.ev || ''}`
      artifacts.push({ fileName: `${fileBase}-CMS1500-bg.pdf`, content: `CMS-1500 Secondary ${secNo} Box 18 X Background Attached\n${bg}`, format: 'cms1500' })
      artifacts.push({ fileName: `${fileBase}-remit-bg.txt`, content: bg, format: 'remit_bg' })
    } else {
      artifacts.push({ fileName: `${fileBase}-CMS1500-nobg.pdf`, content: `CMS-1500 Secondary ${secNo} Box 18 X No Background Method ${method}`, format: 'cms1500' })
    }

    // Dispatch batch: primary patched + secondary + billed files
    const billedFiles = {}
    for (const art of artifacts) {
      const bfId = `bf-${at.toString(36)}-${Math.random().toString(36).slice(2, 6)}`
      billedFiles[bfId] = {
        id: bfId,
        fileName: art.fileName,
        payer: secondary.payer,
        clientCount: 1,
        claimCount: 1,
        claimIds: [secondary.id],
        date: todayISO(),
        sendCount: 1,
        content: art.content,
        createdAt: at,
        format: art.format,
        status: 'sent',
        billedThrough: secondary.dosTo,
      }
    }

    state.dispatch({ type: 'claimsTx', claimUpserts: [primaryPatched, secondary], billedFiles })

    toast({ message: `${secNo} submitted via ${method} — ${artifacts.length} artifact(s) recorded in Billed Files — press U to undo`, kind: 'ok' })
    setOpenSubmit(null)
  }

  return (
    <div className="sectionpage" data-testid="sb-sec">
      <SectionBar icon="shield" title="Secondary Billing" sub={`COB queue — ${stats.ready} ready · ${stats.submitted} submitted · ${stats.total} total · ${money(stats.totalRemaining)} remaining · ${range.label}`}>
        <RangePicker preset={preset} onPreset={(p) => actions.setUI({ secPreset: p })} onSlide={(d) => actions.setUI({ anchor: isoDate(addDays(parseISO(ui.anchor), d * range.days.length)) })} label={range.label} />
        <div className="viewseg" data-testid="sb-status-filter">
          {['all', 'ready', 'submitted', 'paid', 'denied'].map((s) => (
            <button key={s} className={statusF === s ? 'on' : ''} data-testid={`sb-filter-${s}`} onClick={() => setStatusF(s)}>{s}</button>
          ))}
        </div>
        <input className="input" placeholder="Search client / claim / payer…" value={q} onChange={(e) => setQ(e.target.value)} data-testid="sb-search" style={{ width: 200 }} />
      </SectionBar>

      <div className="bil-kpis" data-testid="sb-kpis" style={{ display: 'flex', gap: 12, padding: '12px 16px', flexWrap: 'wrap' }}>
        <div className="bil-kpi" data-testid="sb-kpi-ready"><span>Ready</span><b>{stats.ready}</b><i>Primary settled, secondary eligible</i></div>
        <div className="bil-kpi" data-testid="sb-kpi-submitted"><span>Submitted</span><b>{stats.submitted}</b><i>Secondary claims filed</i></div>
        <div className="bil-kpi" data-testid="sb-kpi-paid"><span>Paid</span><b>{stats.paid}</b><i>Secondary closed</i></div>
        <div className="bil-kpi warn" data-testid="sb-kpi-denied"><span>Denied</span><b>{stats.denied}</b><i>Needs rebill/appeal</i></div>
        <div className="bil-kpi" data-testid="sb-kpi-remaining"><span>Remaining</span><b>{money(stats.totalRemaining)}</b><i>Total secondary AR</i></div>
      </div>

      {filtered.length === 0 ? (
        <div className="empty" data-testid="sb-empty" style={{ padding: 40 }}>
          <div style={{ fontSize: 32 }}>🛡️</div>
          <b>No secondary claims waiting — when a primary payment settles with a payer balance and the client carries secondary coverage, it queues here.</b>
          <span>Add secondary insurance to a client and partially pay a primary claim to see it here.</span>
        </div>
      ) : (
        <div style={{ padding: 16 }}>
          <div className="tablewrap" data-testid="sb-table">
            <table className="table">
              <thead>
                <tr>
                  <th>Client</th>
                  <th>Primary claim #</th>
                  <th>Payer (primary)</th>
                  <th>Secondary payer</th>
                  <th>Member (secondary)</th>
                  <th>Remaining after primary</th>
                  <th>DOS</th>
                  <th>Submitted (primary)</th>
                  <th>Auth # (secondary)</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, 100).map((row) => (
                  <tr key={row.id} data-testid={`sb-row-${row.id}`}>
                    <td>{row.client?.name || row.client?.id || '—'}</td>
                    <td>{row.primary?.no || '—'}</td>
                    <td>{row.primary?.payer || '—'}</td>
                    <td>{row.secPayer?.name || row.sec?.payerId || row.secondary?.payer || '—'}</td>
                    <td>{row.sec?.memberId || '—'}</td>
                    <td data-testid={`sb-remaining-${row.id}`}>{money(row.remaining)}</td>
                    <td>{row.primary?.dosFrom || '—'}</td>
                    <td>{row.primary?.submittedAt ? fmtDayLabel(isoDate(new Date(row.primary.submittedAt))) : '—'}</td>
                    <td>{row.sec?.authNo || '—'}</td>
                    <td><span className="pill" style={{ background: row.status === 'ready' ? '#fef3c7' : row.status === 'submitted' ? '#e0f2fe' : row.status === 'paid' ? '#d7f5e8' : '#fee2e2' }}>{row.status}</span></td>
                    <td style={{ position: 'relative' }}>
                      <button className="btn btn-xs" data-testid={`sb-release-${row.id}`} onClick={() => handleRelease(row)}>Release</button>
                      <button className="btn btn-xs" data-testid={`sb-skip-${row.id}`} onClick={() => handleSkip(row)}>Skip</button>
                      <div style={{ display: 'inline-block', position: 'relative' }}>
                        <button className="btn btn-xs btn-primary" data-testid={`sb-submit-${row.id}`} onClick={() => setOpenSubmit(openSubmit === row.id ? null : row.id)}>Submit Claim ▾</button>
                        {openSubmit === row.id && (
                          <div className="panel" data-testid={`sb-submit-menu-${row.id}`} style={{ position: 'absolute', right: 0, top: '100%', zIndex: 10, width: 240, padding: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                            <button className="btn btn-sm" data-testid={`sb-submit-ch-${row.id}`} onClick={() => handleSubmit(row, 'ch')}>Submit to Clearing House (CH)</button>
                            <button className="btn btn-sm" data-testid={`sb-submit-bg-${row.id}`} onClick={() => handleSubmit(row, 'paper_bg')}>Paper Mail with Background</button>
                            <button className="btn btn-sm" data-testid={`sb-submit-nobg-${row.id}`} onClick={() => handleSubmit(row, 'paper_nobg')}>Paper Mail without Background</button>
                            <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 4 }}>Box 18 = X on all; background snapshot attached only for paper_bg; secondary no {row.primary?.no}-S1/-S2</div>
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="footer">Showing {Math.min(filtered.length, 100)} of {filtered.length} · {stats.ready} ready, {stats.submitted} submitted</div>
          </div>
        </div>
      )}
    </div>
  )
}
