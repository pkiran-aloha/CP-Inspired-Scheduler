import React, { useEffect, useMemo, useState } from 'react'
import { useStore } from '../../state/store'
import { SectionBar } from '../NavRail'
import { Icon } from '../../ui/Icons'
import { useToast } from '../../ui/Toast'
import { Dropdown } from '../fields'
import { IntakeDetail } from './IntakeDetail'
import { IntakeAvatar, KpiStrip, StagePill, SlaChip, UrgencyChip, fmtDate, pctText, sinceText } from './IntakeCommon'
import {
  INTAKE_STAGES, STAGE_BY_ID, OPEN_STAGES, isTerminal, isWon, isLost, stageDef,
  intakeKpis, intakeMatches, fullName, ageLabel, referralLabel, nextAction, primaryPhone, isStalled, slaState,
} from '../../lib/intake'

const STATUS_OPTS = [
  { value: 'open', label: 'All open requests' },
  { value: 'attention', label: 'Needs attention only' },
  { value: 'all', label: 'All requests (incl. closed)' },
  ...OPEN_STAGES.map((s) => ({ value: s, label: STAGE_BY_ID[s].label })),
  { value: 'converted', label: 'Converted to client' },
  { value: 'closed', label: 'Closed / not admitted' },
]

/** One request card — the board's unit. */
function RequestCard({ req, onOpen, sources }) {
  const na = nextAction(req)
  const stalled = isStalled(req)
  const overdue = slaState(req).key === 'overdue'
  return (
    <button
      type="button"
      className={`iq-card ${overdue ? 'hot' : stalled ? 'warm' : ''}`}
      data-testid={`iq-card-${req.id}`}
      onClick={() => onOpen(req.id)}
    >
      <span className="iq-card-top">
        <IntakeAvatar req={req} size={28} />
        <span className="iq-card-nm">
          <b>{fullName(req)}</b>
          <i>{req.no} · {ageLabel(req.dob)}</i>
        </span>
        <UrgencyChip urgency={req.urgency} />
      </span>
      <span className="iq-card-meta">
        <span>{Icon.pin({ size: 10 })} {referralLabel(req, sources)}</span>
        {req.city && <span>{Icon.house({ size: 10 })} {req.city}</span>}
      </span>
      <span className="iq-card-foot">
        <SlaChip req={req} />
        <span className="iq-card-age">{sinceText(req.createdAt)}</span>
      </span>
      <span className="iq-card-next" data-testid={`iq-card-next-${req.id}`}>
        {Icon.zap({ size: 10 })} {na.label}
      </span>
    </button>
  )
}

export default function IntakeRequestsView() {
  const state = useStore()
  const { actions, ui, intakeRequests = {}, referralSources = [], staff = [] } = state
  const toast = useToast()

  const [q, setQ] = useState('')
  const [status, setStatus] = useState('open')
  const [owner, setOwner] = useState('all')
  const [source, setSource] = useState('all')
  const [urgency, setUrgency] = useState('all')
  const [mode, setMode] = useState('board')
  const [sel, setSel] = useState(null)

  // the palette, the referral register and the converted-client sheet deep-link in
  useEffect(() => {
    if (ui?.intakeSel) { setSel(ui.intakeSel); actions.setUI({ intakeSel: null }) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ui?.intakeSel])
  useEffect(() => {
    if (ui?.intakeSource) { setSource(ui.intakeSource); setStatus('all'); actions.setUI({ intakeSource: null }) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ui?.intakeSource])
  useEffect(() => {
    if (ui?.intakeAttention) { setStatus('attention'); setMode('list'); actions.setUI({ intakeAttention: null }) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ui?.intakeAttention])
  useEffect(() => {
    // accountability is per person: a staff profile can open the requests they own
    if (ui?.intakeOwner) { setOwner(ui.intakeOwner); setStatus('all'); setMode('list'); actions.setUI({ intakeOwner: null }) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ui?.intakeOwner])

  const all = useMemo(() => Object.values(intakeRequests), [intakeRequests])
  const kpis = useMemo(() => intakeKpis(intakeRequests), [intakeRequests])

  const rows = useMemo(() => all
    .filter((r) => status === 'all' ? true
      : status === 'open' ? !isTerminal(r.stage)
      : status === 'attention' ? !isTerminal(r.stage) && (isStalled(r) || slaState(r).key !== 'ok')
      : r.stage === status)
    .filter((r) => owner === 'all' ? true : owner === 'none' ? !r.ownerId : r.ownerId === owner)
    .filter((r) => source === 'all' ? true : r.referralSourceId === source)
    .filter((r) => urgency === 'all' ? true : r.urgency === urgency)
    .filter((r) => intakeMatches(r, q))
    .sort((a, b) => a.createdAt - b.createdAt), [all, status, owner, source, urgency, q])

  const columns = useMemo(() => {
    const shown = status === 'all' || status === 'converted' || status === 'closed'
      ? INTAKE_STAGES.map((s) => s.id)
      : status === 'attention' ? OPEN_STAGES : status === 'open' ? OPEN_STAGES : [status]
    return shown.map((s) => ({ stage: s, def: STAGE_BY_ID[s], rows: rows.filter((r) => r.stage === s) }))
  }, [rows, status])

  const ownerOpts = [{ value: 'all', label: 'Any owner' }, { value: 'none', label: 'Unassigned' },
    ...staff.map((s) => ({ value: s.id, label: s.name, sub: s.role }))]
  const sourceOpts = [{ value: 'all', label: 'Any source' }, ...referralSources.filter((s) => s.status !== 'inactive').map((s) => ({ value: s.id, label: s.name, sub: s.kind }))]
  const urgencyOpts = [{ value: 'all', label: 'Any urgency' }, { value: 'emergency', label: 'Emergency' }, { value: 'urgent', label: 'Urgent' }, { value: 'routine', label: 'Routine' }, { value: 'low', label: 'Low / exploratory' }]

  const openBlank = () => actions.setUI({ section: 'intake-new', intakeEdit: null })
  const attention = kpis.atRisk.length

  return (
    <div className="sectionpage">
      <SectionBar icon="user" title="Intake Requests" sub={`${kpis.open} open · ${kpis.newThisWeek} new this week · ${kpis.won} converted · conversion ${pctText(kpis.conversionRate)}`}>
        <input className="input" style={{ width: 210, height: 30 }} placeholder="Search name, phone, member ID…" value={q} onChange={(e) => setQ(e.target.value)} data-testid="iq-search" />
        <Dropdown value={status} onChange={setStatus} options={STATUS_OPTS} testid="iq-status" style={{ minWidth: 178 }} />
        <Dropdown value={owner} onChange={setOwner} options={ownerOpts} testid="iq-owner" searchable style={{ minWidth: 130 }} />
        <Dropdown value={source} onChange={setSource} options={sourceOpts} testid="iq-source" searchable style={{ minWidth: 140 }} />
        <Dropdown value={urgency} onChange={setUrgency} options={urgencyOpts} testid="iq-urgency" style={{ minWidth: 120 }} />
        <div className="viewseg" role="group" aria-label="Layout">
          <button className={mode === 'board' ? 'on' : ''} data-testid="iq-mode-board" title="Pipeline board" onClick={() => setMode('board')}>{Icon.rows({ size: 13 })}</button>
          <button className={mode === 'list' ? 'on' : ''} data-testid="iq-mode-list" title="Worklist" onClick={() => setMode('list')}>{Icon.table({ size: 13 })}</button>
        </div>
        <button className="btn btn-sm btn-primary" data-testid="iq-new" onClick={openBlank}>{Icon.plus({ size: 13 })} Intake client</button>
      </SectionBar>

      <div className="sec-body">
        <KpiStrip items={[
          { id: 'open', icon: 'user', value: kpis.open, label: 'In pipeline', sub: `${kpis.waitingFamilies} on the waitlist` },
          { id: 'new', icon: 'zap', value: kpis.newThisWeek, label: 'New this week', sub: 'referrals received' },
          { id: 'conv', icon: 'checkCircle', value: pctText(kpis.conversionRate), label: 'Referral → client', sub: `${kpis.won} of ${kpis.won + kpis.lost} decided`, tone: kpis.conversionRate == null ? undefined : kpis.conversionRate >= 55 ? 'var(--ok)' : 'var(--warn)' },
          { id: 'touch', icon: 'phone', value: kpis.medianFirstContact == null ? '—' : `${kpis.medianFirstContact}d`, label: 'Median time to first contact', sub: 'target: same business day' },
          { id: 'assess', icon: 'cal', value: kpis.medianToAssessment == null ? '—' : `${kpis.medianToAssessment}d`, label: 'Referral → assessment', sub: 'access benchmark: < 10 days' },
          { id: 'risk', icon: 'alert', value: attention, label: 'Need attention', sub: `${kpis.overdue.length} past SLA · ${kpis.stalled.length} stalled`, tone: attention ? 'var(--danger)' : 'var(--ok)' },
        ]} />

        {attention > 0 && (
          <div className="iq-attention" data-testid="iq-attention">
            <span className="iq-att-ic">{Icon.alert({ size: 14 })}</span>
            <div>
              <b>{attention} request{attention > 1 ? 's' : ''} need a decision today.</b>
              <span className="muted">
                {' '}{kpis.overdue.length} past the stage SLA, {kpis.stalled.length} with no logged touch in 5 days.
                {' '}<button className="btn btn-sm" data-testid="iq-show-attention" onClick={() => setStatus('attention')}>Show them</button>
              </span>
            </div>
          </div>
        )}

        {mode === 'board' && (
          <div className="iq-board" data-testid="iq-board">
            {columns.map(({ stage, def, rows: colRows }) => (
              <section key={stage} className={`iq-col ${def.terminal ? 'terminal' : ''}`} data-testid={`iq-col-${stage}`}>
                <header className="iq-col-h">
                  <span className={`iq-col-dot ${def.tone}`}>{Icon[def.icon]({ size: 12 })}</span>
                  <b>{def.label}</b>
                  <span className="iq-col-n">{colRows.length}</span>
                </header>
                <p className="iq-col-desc">{def.desc}</p>
                <div className="iq-col-body">
                  {colRows.map((r) => <RequestCard key={r.id} req={r} sources={referralSources} onOpen={setSel} />)}
                  {!colRows.length && <div className="iq-col-empty">Nothing here</div>}
                </div>
              </section>
            ))}
          </div>
        )}

        {mode === 'list' && (
          rows.length ? (
            <div className="iq-tablewrap">
              <table className="iq-table" data-testid="iq-table">
                <thead>
                  <tr>
                    <th>Child</th><th>Stage</th><th>Urgency</th><th>Source</th><th>Owner</th>
                    <th>Referral age</th><th>Next action</th><th aria-label="Open" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const na = nextAction(r)
                    const ownerS = staff.find((s) => s.id === r.ownerId)
                    return (
                      <tr key={r.id} data-testid={`iq-row-${r.id}`} onClick={() => setSel(r.id)}>
                        <td>
                          <span className="iq-rowname">
                            <IntakeAvatar req={r} size={26} />
                            <span>
                              <b>{fullName(r)}</b>
                              <i>{r.no} · {ageLabel(r.dob)} · {primaryPhone(r) || 'no phone'}</i>
                            </span>
                          </span>
                        </td>
                        <td><StagePill stage={r.stage} short /></td>
                        <td>{r.urgency === 'routine' ? <span className="muted">Routine</span> : <UrgencyChip urgency={r.urgency} />}</td>
                        <td className="iq-td-src">{referralLabel(r, referralSources)}</td>
                        <td>{ownerS ? ownerS.name : <span className="muted">Unassigned</span>}</td>
                        <td>{fmtDate(new Date(r.createdAt).toISOString().slice(0, 10))} <span className="muted">· {sinceText(r.createdAt)}</span></td>
                        <td className="iq-td-next">{na.blocked ? <span style={{ color: 'var(--danger)' }}>{na.label}</span> : na.label}</td>
                        <td><button className="dir-eye" data-testid={`iq-open-${r.id}`} onClick={(e) => { e.stopPropagation(); setSel(r.id) }} aria-label={`Open ${fullName(r)}`}>{Icon.eye({ size: 13 })}</button></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="iq-empty" data-testid="iq-empty">
              <span className="iq-empty-ic">{Icon.file({ size: 26 })}</span>
              <b>No Records Available</b>
              <span className="muted">Nothing matches this filter. Adjust the status filter, or start a new intake.</span>
              <button className="btn btn-sm btn-primary" data-testid="iq-empty-add" onClick={openBlank}>{Icon.plus({ size: 12 })} Add Client</button>
            </div>
          )
        )}

        {mode === 'board' && !rows.length && (
          <div className="iq-empty" data-testid="iq-empty-board">
            <span className="iq-empty-ic">{Icon.file({ size: 26 })}</span>
            <b>No Records Available</b>
            <span className="muted">No requests match the current filters.</span>
            <button className="btn btn-sm btn-primary" data-testid="iq-empty-add-board" onClick={openBlank}>{Icon.plus({ size: 12 })} Add Client</button>
          </div>
        )}
      </div>

      {sel && <IntakeDetail id={sel} onClose={() => setSel(null)} onToast={toast} />}
    </div>
  )
}

export { isWon, isLost }
