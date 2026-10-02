import React, { useMemo, useState } from 'react'
import { useStore } from '../../state/store'
import { Icon } from '../../ui/Icons'
import { useToast } from '../../ui/Toast'
import { Dropdown } from '../fields'
import { isoDate } from '../../lib/date'
import {
  INTAKE_STAGES, GATES, DOC_STATUS, INTAKE_DOCS, CONSENT_KINDS, VOB_FIELDS, VOB_STATUS,
  LOST_REASONS, WAITLIST_REASONS, WAITLIST_PRIORITIES, CONTACT_CHANNELS, CONTACT_OUTCOMES, ASSESSMENT_INSTRUMENTS, ASSESSMENT_OUTCOMES,
  AUTH_DECISIONS, PLAN_TYPES, SUBSCRIBER_RELATIONS, SETTING_PREFS,
  DIAGNOSIS_STATUS, fullName, ageLabel, stageDef, stageIndex, nextStages, isTerminal, isWon, isLost,
  gateBlockers, gateProgress, docProgress, docStatus, requiredDocs, requiredConsents, consentSigned,
  planConversion, referralLabel, primaryPhone, nextAction,
} from '../../lib/intake'
import { Drawer, DrawerHead, GateList, KV, StagePill, SlaChip, UrgencyChip, fmtDate, sinceText } from './IntakeCommon'

const TABS = [
  ['overview', 'Overview', 'clipboard'],
  ['contacts', 'Contacts', 'phone'],
  ['benefits', 'Benefits (VOB)', 'shield'],
  ['clinical', 'Clinical', 'eye'],
  ['docs', 'Docs & consents', 'file'],
  ['timeline', 'Timeline', 'clock'],
]

// --------------------------------------------------------------------- pieces --

/**
 * Pipeline rail. Every reachable step is a button that routes through the same
 * `advanceTo` the "Next" box uses, so a click can never bypass a gate or dead-end
 * on a step that needs more input (waitlist terms, a calendar booking, conversion).
 */
function StageRail({ req, onMove, onClose }) {
  const cur = stageIndex(req.stage)
  const allowed = nextStages(req.stage)
  const lost = isLost(req.stage)
  return (
    <div className="iq-rail" data-testid="iq-rail">
      {INTAKE_STAGES.filter((s) => s.id !== 'closed').map((s, i) => {
        const idx = stageIndex(s.id)
        // a closed request has not "completed" the stages it never reached — only the stage it sits in is marked
        const state = req.stage === s.id ? 'current' : !lost && idx < cur ? 'done' : 'future'
        const canGo = allowed.includes(s.id)
        return (
          <button
            key={s.id}
            type="button"
            className={`iq-rail-step ${state} ${canGo ? 'go' : ''}`}
            data-testid={`iq-rail-${s.id}`}
            data-state={state}
            aria-current={state === 'current' ? 'step' : undefined}
            disabled={!canGo}
            title={canGo ? `Move to ${s.label}` : state === 'current' ? `Current stage — ${s.desc}` : s.desc}
            onClick={() => canGo && onMove(s.id)}
          >
            <span className="iq-rail-n">{state === 'done' ? Icon.check({ size: 10 }) : i + 1}</span>
            <span className="iq-rail-l">{s.short}</span>
          </button>
        )
      })}
      <button type="button" className={`iq-rail-step lost ${lost ? 'current' : ''} ${allowed.includes('closed') ? 'go' : ''}`} data-testid="iq-rail-closed"
        data-state={lost ? 'current' : 'future'} aria-current={lost ? 'step' : undefined}
        disabled={!allowed.includes('closed')} title={lost ? 'Closed — not admitted' : allowed.includes('closed') ? 'Close as not admitted' : 'Only an open request can be closed'}
        onClick={() => allowed.includes('closed') && onClose()}>
        <span className="iq-rail-n">{Icon.x({ size: 10 })}</span>
        <span className="iq-rail-l">Close</span>
      </button>
    </div>
  )
}

/** Waitlist terms — the gate for the waitlist branch, captured in one place. */
function WaitlistForm({ req, onDone, onCancel }) {
  const state = useStore()
  const { actions } = state
  const toast = useToast()
  const [f, setF] = useState({
    reason: req.waitlist?.reason || '',
    priority: req.waitlist?.priority || '',
    reviewBy: req.waitlist?.reviewBy || isoDate(new Date(Date.now() + 14 * 86400000)),
    notes: req.waitlist?.notes || '',
  })
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }))
  const missing = [!f.reason && 'reason', !f.priority && 'priority', !f.reviewBy && 'review date'].filter(Boolean)
  const save = () => {
    const r = actions.moveIntake(req.id, 'waitlist', { waitlist: { ...req.waitlist, ...f, priority: Number(f.priority) }, by: actorOf(state) })
    toast({ message: r.ok ? `On the waitlist — review promised for ${fmtDate(f.reviewBy)}` : r.msg, kind: r.ok ? 'ok' : 'warn' })
    if (r.ok) onDone?.()
  }
  return (
    <div className="iq-inline-form" data-testid="iq-waitlist-form">
      <h4 style={{ marginTop: 0 }}>Place on the waitlist</h4>
      <div className="iq-grid4">
        <label className="iq-fld"><span>Reason</span>
          <Dropdown value={f.reason} onChange={(v) => set('reason', v)} placeholder="Why are we waiting?" options={WAITLIST_REASONS.map((r) => ({ value: r, label: r }))} testid="iq-wl-reason" />
        </label>
        <label className="iq-fld"><span>Priority</span>
          <Dropdown value={f.priority} onChange={(v) => set('priority', v)} placeholder="Set a priority" options={WAITLIST_PRIORITIES.map((p) => ({ value: p.value, label: p.label, sub: p.hint }))} testid="iq-wl-priority" />
        </label>
        <label className="iq-fld"><span>Review by (promised to the family)</span>
          <input className="input" type="date" value={f.reviewBy} onChange={(e) => set('reviewBy', e.target.value)} data-testid="iq-wl-reviewby" />
        </label>
        <label className="iq-fld"><span>Notes</span>
          <input className="input" value={f.notes} placeholder="What the family was told" onChange={(e) => set('notes', e.target.value)} data-testid="iq-wl-notes" />
        </label>
      </div>
      <div className="iq-actions">
        <button className="btn btn-sm btn-primary" disabled={missing.length > 0} onClick={save} data-testid="iq-wl-save">{Icon.clock({ size: 12 })} Move to waitlist</button>
        <button className="btn btn-sm" onClick={onCancel} data-testid="iq-wl-cancel">Cancel</button>
        {missing.length > 0 && <span className="iq-nextbox-hint" data-testid="iq-wl-missing">Needs a {missing.join(', ')}</span>}
      </div>
      <p className="iq-note">A waiting family is a promise — the review date keeps it visible on the board and in the attention list.</p>
    </div>
  )
}

// who acted: the signed-in demo account's staff member, else the account name
const actorOf = (state) => state.currentAccount?.staffId || state.currentAccount?.name || null

function ContactForm({ req, onDone }) {
  const state = useStore()
  const { actions } = state
  const toast = useToast()
  const [f, setF] = useState({ channel: 'Phone', direction: 'outbound', outcome: 'reached', summary: '', nextStepAt: '' })
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }))
  const save = () => {
    const r = actions.logContact(req.id, { ...f, by: actorOf(state) })
    if (r.ok) { toast({ message: r.advanced ? 'Contact logged — request moved to Contacted' : 'Contact attempt logged', kind: 'ok' }); onDone?.() }
    else toast({ message: r.msg || 'Could not log', kind: 'warn' })
  }
  return (
    <div className="iq-inline-form" data-testid="iq-contact-form">
      <div className="iq-grid4">
        <label className="iq-fld"><span>Channel</span>
          <Dropdown value={f.channel} onChange={(v) => set('channel', v)} options={CONTACT_CHANNELS.map((c) => ({ value: c, label: c }))} testid="iq-cf-channel" />
        </label>
        <label className="iq-fld"><span>Direction</span>
          <Dropdown value={f.direction} onChange={(v) => set('direction', v)} options={[{ value: 'outbound', label: 'Outbound (we called)' }, { value: 'inbound', label: 'Inbound (family called)' }]} testid="iq-cf-direction" />
        </label>
        <label className="iq-fld"><span>Outcome</span>
          <Dropdown value={f.outcome} onChange={(v) => set('outcome', v)} options={CONTACT_OUTCOMES.map((c) => ({ value: c.id, label: c.label }))} testid="iq-cf-outcome" />
        </label>
        <label className="iq-fld"><span>Follow-up due</span>
          <input className="input" type="date" value={f.nextStepAt} onChange={(e) => set('nextStepAt', e.target.value)} data-testid="iq-cf-next" />
        </label>
      </div>
      <label className="iq-fld wide"><span>What was said / what happens next</span>
        <input className="input" value={f.summary} placeholder="Spoke with the mother; sending the intake packet and booking the assessment" onChange={(e) => set('summary', e.target.value)} data-testid="iq-cf-summary" />
      </label>
      <div className="iq-actions">
        <button className="btn btn-sm btn-primary" onClick={save} data-testid="iq-cf-save">Log contact</button>
      </div>
    </div>
  )
}

function BenefitsEditor({ req }) {
  const { actions } = useStore()
  const toast = useToast()
  const [vob, setVob] = useState({ ...req.vob })
  const [core, setCore] = useState({ memberId: req.memberId, groupNumber: req.groupNumber, planType: req.planType, subscriberName: req.subscriberName, subscriberDob: req.subscriberDob, subscriberRelation: req.subscriberRelation, payerId: req.payerId })
  const setV = (k, v) => setVob((x) => ({ ...x, [k]: v }))
  const initial = useMemo(() => ({ ...req.vob, memberId: req.memberId, groupNumber: req.groupNumber, planType: req.planType, subscriberName: req.subscriberName, subscriberDob: req.subscriberDob, subscriberRelation: req.subscriberRelation, payerId: req.payerId }), [req])
  const dirty = JSON.stringify(initial) !== JSON.stringify({ ...vob, ...core })
  const save = () => {
    actions.patchIntake(req.id, { ...core, vob: { ...vob, by: req.ownerId || null } }, `Benefits verification updated — status ${VOB_STATUS[vob.status]?.label || vob.status}`)
    toast({ message: 'Benefits record saved', kind: 'ok' })
  }
  return (
    <div className="iq-tab-body" data-testid="iq-benefits">
      <h4>Coverage</h4>
      <div className="iq-grid3">
        <label className="iq-fld"><span>Verification status</span>
          <Dropdown value={vob.status} onChange={(v) => setV('status', v)} options={Object.entries(VOB_STATUS).map(([k, v]) => ({ value: k, label: v.label }))} testid="iq-vob-status" />
        </label>
        <label className="iq-fld"><span>Plan type</span>
          <Dropdown value={core.planType} onChange={(v) => setCore((x) => ({ ...x, planType: v }))} options={PLAN_TYPES.map((p) => ({ value: p, label: p }))} testid="iq-vob-plan" />
        </label>
        <label className="iq-fld"><span>Subscriber relationship</span>
          <Dropdown value={core.subscriberRelation} onChange={(v) => setCore((x) => ({ ...x, subscriberRelation: v }))} options={SUBSCRIBER_RELATIONS.map((p) => ({ value: p, label: p }))} testid="iq-vob-rel" />
        </label>
        <label className="iq-fld"><span>Member ID</span><input className="input" value={core.memberId} onChange={(e) => setCore((x) => ({ ...x, memberId: e.target.value }))} data-testid="iq-vob-member" /></label>
        <label className="iq-fld"><span>Group number</span><input className="input" value={core.groupNumber} onChange={(e) => setCore((x) => ({ ...x, groupNumber: e.target.value }))} data-testid="iq-vob-group" /></label>
        <label className="iq-fld"><span>Subscriber name</span><input className="input" value={core.subscriberName} onChange={(e) => setCore((x) => ({ ...x, subscriberName: e.target.value }))} data-testid="iq-vob-sub" /></label>
        <label className="iq-fld"><span>Subscriber DOB</span><input className="input" type="date" value={core.subscriberDob} onChange={(e) => setCore((x) => ({ ...x, subscriberDob: e.target.value }))} data-testid="iq-vob-subdob" /></label>
      </div>
      <h4>Verified benefits</h4>
      <div className="iq-grid3">
        {VOB_FIELDS.map((f) => (
          <label className="iq-fld" key={f.id}>
            <span>{f.label}{f.required && <em className="iq-req"> required</em>}</span>
            {f.kind === 'bool' ? (
              <Dropdown
                value={vob[f.id] === null || vob[f.id] === undefined ? '' : String(vob[f.id])}
                onChange={(v) => setV(f.id, v === '' ? null : v === 'true')}
                options={[{ value: '', label: 'Not verified' }, { value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }]}
                testid={`iq-vob-${f.id}`}
              />
            ) : (
              <input className="input" type={f.kind === 'text' ? 'text' : 'number'} value={vob[f.id] ?? ''} onChange={(e) => setV(f.id, e.target.value)} data-testid={`iq-vob-${f.id}`} />
            )}
          </label>
        ))}
        <label className="iq-fld"><span>Payer representative</span><input className="input" value={vob.repName} onChange={(e) => setV('repName', e.target.value)} data-testid="iq-vob-rep" /></label>
        <label className="iq-fld"><span>Call reference #</span><input className="input" value={vob.refNo} onChange={(e) => setV('refNo', e.target.value)} data-testid="iq-vob-ref" /></label>
        <label className="iq-fld"><span>Verification date</span><input className="input" type="date" value={vob.at ? isoDate(new Date(vob.at)) : ''} onChange={(e) => setV('at', e.target.value ? new Date(e.target.value).getTime() : null)} data-testid="iq-vob-at" /></label>
        <label className="iq-fld wide"><span>Notes read back to the family</span><input className="input" value={vob.notes} onChange={(e) => setV('notes', e.target.value)} data-testid="iq-vob-notes" /></label>
      </div>
      <div className="iq-actions">
        <button className="btn btn-sm btn-primary" disabled={!dirty} onClick={save} data-testid="iq-vob-save">Save benefits record</button>
        {!dirty && <span className="muted" style={{ fontSize: 11.5 }}>Saved — the VOB snapshot is what the claim denial trail points back to.</span>}
      </div>
    </div>
  )
}

function DocsEditor({ req }) {
  const state = useStore()
  const { actions } = state
  const toast = useToast()
  const required = requiredDocs(req)
  const prog = docProgress(req)
  const setDoc = (id, status) => {
    const next = { ...req.docs, [id]: { status, at: Date.now(), by: actorOf(state) } }
    actions.patchIntake(req.id, { docs: next }, `Document ${INTAKE_DOCS.find((d) => d.id === id)?.label} → ${DOC_STATUS[status].label}`)
  }
  const toggleConsent = (id) => {
    const has = consentSigned(req, id)
    const next = has ? (req.consents || []).filter((c) => c.id !== id) : [...(req.consents || []), { id, at: Date.now(), by: actorOf(state), method: 'e-sign' }]
    actions.patchIntake(req.id, { consents: next }, `Consent ${CONSENT_KINDS.find((c) => c.id === id)?.label} ${has ? 'removed' : 'captured'}`)
    if (!has) toast({ message: 'Consent captured (e-sign placeholder — no external signature service is connected)', kind: 'ok' })
  }
  return (
    <div className="iq-tab-body" data-testid="iq-docs">
      <div className="iq-prog">
        <b>{prog.done}/{prog.required}</b> required documents on file
        <span className="iq-bar"><i style={{ width: `${prog.pct}%` }} /></span>
      </div>
      <div className="iq-doclist">
        {INTAKE_DOCS.map((d) => {
          const st = docStatus(req, d.id)
          const needed = required.some((x) => x.id === d.id)
          return (
            <div className={`iq-doc ${needed && st === 'missing' ? 'bad' : ''}`} key={d.id} data-testid={`iq-doc-${d.id}`}>
              <span className={`iq-doc-ic ${DOC_STATUS[st].tone}`}>{st === 'received' || st === 'waived' ? Icon.check({ size: 12 }) : Icon.file({ size: 12 })}</span>
              <span className="iq-doc-t">
                <b>{d.label}{needed && <em className="iq-req"> required</em>}{!needed && <em className="iq-opt"> optional</em>}</b>
                <i>{d.hint || `Due by ${stageDef(d.at).label}`}</i>
              </span>
              <span className="iq-doc-st">{DOC_STATUS[st].label}</span>
              <span className="iq-doc-acts">
                {st !== 'received' && <button className="btn btn-sm" data-testid={`iq-doc-${d.id}-received`} onClick={() => setDoc(d.id, 'received')}>Received</button>}
                {st !== 'requested' && st !== 'received' && <button className="btn btn-sm" data-testid={`iq-doc-${d.id}-requested`} onClick={() => setDoc(d.id, 'requested')}>Requested</button>}
                {st !== 'waived' && <button className="btn btn-sm" data-testid={`iq-doc-${d.id}-waived`} onClick={() => setDoc(d.id, 'waived')}>Waive</button>}
              </span>
            </div>
          )
        })}
      </div>
      <h4>Consents</h4>
      <div className="iq-doclist">
        {CONSENT_KINDS.map((c) => {
          const on = consentSigned(req, c.id)
          const needed = requiredConsents(req).some((x) => x.id === c.id)
          return (
            <div className={`iq-doc ${needed && !on ? 'bad' : ''}`} key={c.id} data-testid={`iq-consent-${c.id}`}>
              <span className={`iq-doc-ic ${on ? 'ok' : ''}`}>{on ? Icon.check({ size: 12 }) : Icon.shield({ size: 12 })}</span>
              <span className="iq-doc-t"><b>{c.label}{needed && <em className="iq-req"> required</em>}</b>
                <i>{on ? `Signed ${sinceText((req.consents || []).find((x) => x.id === c.id)?.at)}` : 'Not on file'}</i></span>
              <span className="iq-doc-acts">
                <button className={`btn btn-sm ${on ? '' : 'btn-primary'}`} data-testid={`iq-consent-${c.id}-toggle`} onClick={() => toggleConsent(c.id)}>{on ? 'Remove' : 'Capture'}</button>
              </span>
            </div>
          )
        })}
      </div>
      <p className="iq-note">{Icon.info({ size: 11 })} Consents and documents are recorded locally in this demo — no e-signature, fax or clearinghouse connection is made.</p>
    </div>
  )
}

function ClinicalEditor({ req }) {
  const { actions } = useStore()
  const toast = useToast()
  const state = useStore()
  const [f, setF] = useState({
    diagnosisStatus: req.diagnosisStatus, diagnosis: req.diagnosis, concerns: req.concerns,
    settingPref: req.settingPref, serviceLine: req.serviceLine, program: req.program, bcbaAssignedId: req.bcbaAssignedId,
    safetyRisks: req.safetyRisks, medications: req.medications, allergies: req.allergies,
    screen: { ...req.screen },
    assessment: { ...req.assessment },
    auth: { ...req.auth },
  })
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }))
  const setSub = (k, kk, v) => setF((x) => ({ ...x, [k]: { ...x[k], [kk]: v } }))
  const staffOpts = (state.staff || []).filter((s) => /BCBA|Psycholog|BCaBA/.test(s.role)).map((s) => ({ value: s.id, label: s.name, sub: s.role }))
  const save = () => {
    actions.patchIntake(req.id, f, 'Clinical screening / assessment updated')
    toast({ message: 'Clinical record saved', kind: 'ok' })
  }
  return (
    <div className="iq-tab-body" data-testid="iq-clinical">
      <h4>Screening</h4>
      <div className="iq-grid3">
        <label className="iq-fld"><span>Diagnosis status</span>
          <Dropdown value={f.diagnosisStatus} onChange={(v) => set('diagnosisStatus', v)} options={Object.entries(DIAGNOSIS_STATUS).map(([k, v]) => ({ value: k, label: v.label }))} testid="iq-cl-dxstatus" />
        </label>
        <label className="iq-fld"><span>Diagnosis</span><input className="input" value={f.diagnosis} onChange={(e) => set('diagnosis', e.target.value)} data-testid="iq-cl-dx" /></label>
        <label className="iq-fld"><span>Preferred setting</span>
          <Dropdown value={f.settingPref} onChange={(v) => set('settingPref', v)} options={SETTING_PREFS.map((s) => ({ value: s, label: s }))} testid="iq-cl-setting" />
        </label>
        <label className="iq-fld"><span>Service line</span><input className="input" value={f.serviceLine} onChange={(e) => set('serviceLine', e.target.value)} data-testid="iq-cl-service" /></label>
        <label className="iq-fld"><span>Program</span><input className="input" value={f.program} onChange={(e) => set('program', e.target.value)} data-testid="iq-cl-program" /></label>
        <label className="iq-fld"><span>Assigned BCBA / assessor</span>
          <Dropdown value={f.bcbaAssignedId || ''} onChange={(v) => set('bcbaAssignedId', v || null)} options={[{ value: '', label: 'Unassigned' }, ...staffOpts]} testid="iq-cl-bcba" searchable />
        </label>
        <label className="iq-fld wide"><span>Caregiver concerns & goals</span><input className="input" value={f.concerns} onChange={(e) => set('concerns', e.target.value)} data-testid="iq-cl-concerns" /></label>
        <label className="iq-fld"><span>Safety risks</span><input className="input" value={f.safetyRisks} onChange={(e) => set('safetyRisks', e.target.value)} data-testid="iq-cl-safety" /></label>
        <label className="iq-fld"><span>Medications</span><input className="input" value={f.medications} onChange={(e) => set('medications', e.target.value)} data-testid="iq-cl-meds" /></label>
        <label className="iq-fld"><span>Allergies</span><input className="input" value={f.allergies} onChange={(e) => set('allergies', e.target.value)} data-testid="iq-cl-allergies" /></label>
        <label className="iq-fld"><span>Pre-screen decision</span>
          <Dropdown value={f.screen.fit} onChange={(v) => setSub('screen', 'fit', v)} options={[{ value: '', label: 'Not screened' }, { value: 'fit', label: 'Fit — proceed' }, { value: 'maybe', label: 'Maybe — needs capacity/clinical call' }, { value: 'not_fit', label: 'Not a fit — close with a reason' }]} testid="iq-cl-fit" />
        </label>
        <label className="iq-fld wide"><span>Pre-screen notes</span><input className="input" value={f.screen.notes} onChange={(e) => setSub('screen', 'notes', e.target.value)} data-testid="iq-cl-screennote" /></label>
      </div>
      <h4>Assessment</h4>
      <div className="iq-grid3">
        <label className="iq-fld"><span>Completed on</span><input className="input" type="date" value={f.assessment.date} onChange={(e) => setSub('assessment', 'date', e.target.value)} data-testid="iq-cl-assessdate" /></label>
        <label className="iq-fld"><span>Instrument</span>
          <Dropdown value={f.assessment.instrument} onChange={(v) => setSub('assessment', 'instrument', v)} options={[{ value: '', label: 'Not recorded' }, ...ASSESSMENT_INSTRUMENTS.map((i) => ({ value: i, label: i }))]} testid="iq-cl-instrument" />
        </label>
        <label className="iq-fld"><span>Outcome</span>
          <Dropdown value={f.assessment.outcome} onChange={(v) => setSub('assessment', 'outcome', v)} options={[{ value: '', label: 'Not recorded' }, ...Object.entries(ASSESSMENT_OUTCOMES).map(([k, v]) => ({ value: k, label: v.label }))]} testid="iq-cl-outcome" />
        </label>
        <label className="iq-fld"><span>Recommended hours / week</span><input className="input" type="number" min="0" value={f.assessment.recommendedHoursPerWeek} onChange={(e) => setSub('assessment', 'recommendedHoursPerWeek', e.target.value)} data-testid="iq-cl-hours" /></label>
        <label className="iq-fld"><span>Recommended setting</span><input className="input" value={f.assessment.recommendedSetting} onChange={(e) => setSub('assessment', 'recommendedSetting', e.target.value)} data-testid="iq-cl-recommended" /></label>
        <label className="iq-fld"><span>Report due</span><input className="input" type="date" value={f.assessment.reportDueBy} onChange={(e) => setSub('assessment', 'reportDueBy', e.target.value)} data-testid="iq-cl-reportdue" /></label>
      </div>
      <h4>Authorisation</h4>
      <div className="iq-grid3">
        <label className="iq-fld"><span>Submitted on</span><input className="input" type="date" value={f.auth.submittedAt} onChange={(e) => setSub('auth', 'submittedAt', e.target.value)} data-testid="iq-cl-authsubmitted" /></label>
        <label className="iq-fld"><span>Request reference</span><input className="input" value={f.auth.requestRef} onChange={(e) => setSub('auth', 'requestRef', e.target.value)} data-testid="iq-cl-authref" /></label>
        <label className="iq-fld"><span>Requested units</span><input className="input" type="number" min="0" value={f.auth.unitsRequested} onChange={(e) => setSub('auth', 'unitsRequested', e.target.value)} data-testid="iq-cl-unitsreq" /></label>
        <label className="iq-fld"><span>Window start</span><input className="input" type="date" value={f.auth.windowStart} onChange={(e) => setSub('auth', 'windowStart', e.target.value)} data-testid="iq-cl-wstart" /></label>
        <label className="iq-fld"><span>Window end</span><input className="input" type="date" value={f.auth.windowEnd} onChange={(e) => setSub('auth', 'windowEnd', e.target.value)} data-testid="iq-cl-wend" /></label>
        <label className="iq-fld"><span>Payer decision</span>
          <Dropdown value={f.auth.decision} onChange={(v) => setSub('auth', 'decision', v)} options={[{ value: '', label: 'Not submitted' }, ...Object.entries(AUTH_DECISIONS).map(([k, v]) => ({ value: k, label: v.label }))]} testid="iq-cl-decision" />
        </label>
        <label className="iq-fld"><span>Approved units</span><input className="input" type="number" min="0" value={f.auth.units} onChange={(e) => setSub('auth', 'units', e.target.value)} data-testid="iq-cl-units" /></label>
        <label className="iq-fld"><span>Authorisation #</span><input className="input" value={f.auth.authNo} onChange={(e) => setSub('auth', 'authNo', e.target.value)} data-testid="iq-cl-authno" /></label>
      </div>
      <div className="iq-actions"><button className="btn btn-sm btn-primary" onClick={save} data-testid="iq-cl-save">Save clinical record</button></div>
    </div>
  )
}

// ------------------------------------------------------------------- drawer ----

export function IntakeDetail({ id, onClose, onToast }) {
  const state = useStore()
  const { actions, staff = [], payers = [], clients = [] } = state
  const ctxToast = useToast()
  const toast = onToast || ctxToast
  const req = state.intakeRequests?.[id]
  const [tab, setTab] = useState('overview')
  const [logOpen, setLogOpen] = useState(false)
  const [closeOpen, setCloseOpen] = useState(false)
  const [bookOpen, setBookOpen] = useState(false)
  const [wlOpen, setWlOpen] = useState(false)
  const [convertOpen, setConvertOpen] = useState(false)
  const [lostReason, setLostReason] = useState('')
  const [lostNote, setLostNote] = useState('')
  const [book, setBook] = useState({ date: isoDate(new Date(Date.now() + 3 * 86400000)), start: '09:00', end: '11:00', clinicianId: req?.bcbaAssignedId || '' })
  const [wlReview, setWlReview] = useState(() => isoDate(new Date(Date.now() + 14 * 86400000)))

  if (!req) return null

  const target = nextAction(req).to
  const prog = target ? gateProgress(req, target) : { done: 0, total: 0, pct: 100, blockers: [] }
  const convBlockers = gateBlockers(req, 'converted')
  const owner = staff.find((s) => s.id === req.ownerId)
  const source = (state.referralSources || []).find((s) => s.id === req.referralSourceId)
  const payer = payers.find((p) => p.id === req.payerId)
  const linkedClient = req.clientId ? clients.find((c) => c.id === req.clientId) : null
  const linkedAppt = req.apptId ? state.appts[req.apptId] : null
  const assessors = staff.filter((s) => /BCBA|Psycholog/.test(s.role))

  const move = (stage) => {
    const r = actions.moveIntake(id, stage, { by: actorOf(state) })
    toast({ message: r.msg, kind: r.ok ? 'ok' : 'warn' })
    return r.ok
  }
  const openBook = () => { setWlOpen(false); setBookOpen(true); setTab('overview') }
  const openWaitlist = () => { setBookOpen(false); setWlOpen(true); setTab('overview') }
  /**
   * The ONE router for stage changes. Steps that need more than a click (waitlist
   * terms, a calendar booking, the client chart, a not-admitted reason) open
   * their own form; everything else is a plain gated move. Used by the rail and
   * the "Next" box alike so neither can dead-end on a reducer refusal.
   */
  const advanceTo = (stage) => {
    if (stage === 'converted') { setConvertOpen(true); return }
    if (stage === 'closed') { setCloseOpen(true); return }
    if (stage === 'waitlist') { openWaitlist(); return }
    if (stage === 'scheduled' && !req.apptId) { openBook(); return }
    move(stage)
  }
  const doClose = () => {
    if (!lostReason) return
    const r = actions.moveIntake(id, 'closed', { lost: { reason: lostReason, notes: lostNote }, by: actorOf(state) })
    toast({ message: r.ok ? `Closed — ${LOST_REASONS.find((x) => x.id === lostReason)?.label}` : r.msg, kind: r.ok ? 'ok' : 'warn' })
    if (r.ok) { setCloseOpen(false); onClose() }
  }
  const bookMinutes = (t) => { const [h, m] = String(t || '').split(':').map(Number); return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : NaN }
  const bookProblem = !book.date ? 'Pick a date' : !(bookMinutes(book.end) > bookMinutes(book.start)) ? 'End time must be after the start' : !book.clinicianId ? 'Pick the assessing clinician' : ''
  const doBook = () => {
    if (bookProblem) { toast({ message: bookProblem, kind: 'warn' }); return }
    const r = actions.scheduleIntakeAssessment(id, { date: book.date, start: bookMinutes(book.start), end: bookMinutes(book.end), clinicianId: book.clinicianId, by: actorOf(state) })
    toast({ message: r.msg, kind: r.ok ? 'ok' : 'warn' })
    if (r.ok) setBookOpen(false)
  }
  const doConvert = () => {
    const r = actions.convertIntake(id, { by: actorOf(state), program: req.program || req.serviceLine })
    if (!r.ok) { toast({ message: r.msg, kind: 'warn' }); return }
    toast({ message: r.msg, kind: 'ok' })
    setConvertOpen(false)
    actions.setUI({ section: 'clients', cliQ: fullName(req) })
  }
  const verifyGuardian = (on) => {
    const r = actions.patchIntake(id, on
      ? { guardianVerifiedAt: Date.now(), guardianVerifiedBy: actorOf(state) }
      : { guardianVerifiedAt: null, guardianVerifiedBy: null },
    on ? `Guardian identity and contact verified${req.guardian?.name ? ` — ${req.guardian.name}` : ''}` : 'Guardian verification removed')
    toast({ message: r.ok ? (on ? 'Guardian verified' : 'Guardian verification removed') : r.msg, kind: r.ok ? 'ok' : 'warn' })
  }
  // Escape / backdrop peel one layer at a time: modal → inline form → drawer
  const dismiss = () => {
    if (convertOpen) { setConvertOpen(false); return }
    if (closeOpen) { setCloseOpen(false); return }
    if (bookOpen) { setBookOpen(false); return }
    if (wlOpen) { setWlOpen(false); return }
    onClose()
  }

  const planned = planConversion(state, id, { clientId: 'preview', at: Date.now() })
  const verifiedBy = req.guardianVerifiedBy ? staff.find((s) => s.id === req.guardianVerifiedBy)?.name || req.guardianVerifiedBy : null
  const guardianVerify = (
    <span className="iq-verify" data-testid="iq-guardian-verify">
      {req.guardianVerifiedAt ? (
        <>
          <span className="iq-verify-ok" data-testid="iq-guardian-verified">{Icon.checkCircle({ size: 13 })} Verified {sinceText(req.guardianVerifiedAt)}{verifiedBy ? ` by ${verifiedBy}` : ''}</span>
          {!isTerminal(req.stage) && <button type="button" className="iq-verify-undo" data-testid="iq-guardian-unverify" onClick={() => verifyGuardian(false)}>undo</button>}
        </>
      ) : isTerminal(req.stage) ? <span className="muted">Not verified</span> : (
        <button className="btn btn-sm" data-testid="iq-guardian-verify-btn" title="Confirm the guardian's identity and contact details were checked with the family" onClick={() => verifyGuardian(true)}>{Icon.shield({ size: 12 })} Mark verified</button>
      )}
    </span>
  )

  return (
    <Drawer onClose={dismiss} label={`Intake ${req.no}`} width={820}>
      <DrawerHead req={req} onClose={onClose}>
        <button className="btn btn-sm" data-testid="iq-log-contact" onClick={() => { setTab('contacts'); setLogOpen(true) }}>{Icon.phone({ size: 12 })} Log contact</button>
        <button className="btn btn-sm" data-testid="iq-edit-form" onClick={() => actions.setUI({ section: 'intake-new', intakeEdit: id })}>{Icon.edit({ size: 12 })} Edit form</button>
      </DrawerHead>

      <div className="iq-dbody">
        <StageRail req={req} onMove={advanceTo} onClose={() => advanceTo('closed')} />

        {isTerminal(req.stage) ? (
          <div className={`iq-banner ${isWon(req.stage) ? 'ok' : 'bad'}`} data-testid="iq-terminal">
            {isWon(req.stage)
              ? <>{Icon.checkCircle({ size: 14 })} <b>Converted {sinceText(req.convertedAt)}.</b> {linkedClient ? <>Client chart <b>{linkedClient.name}</b> carries this request as its origin{req.firstServiceDate ? ` · first service ${fmtDate(req.firstServiceDate)}` : ''}.</> : 'The linked client record is missing from this workspace.'}
                {linkedClient && <button className="btn btn-sm" data-testid="iq-open-client" onClick={() => { actions.setUI({ section: 'clients', cliQ: linkedClient.name }); onClose() }}>Open client record</button>}</>
              : <>{Icon.x({ size: 14 })} <b>Closed {req.lost?.at ? sinceText(req.lost.at) : ''} — {LOST_REASONS.find((x) => x.id === req.lost?.reason)?.label || 'reason not recorded'}.</b> {req.lost?.notes}
                <button className="btn btn-sm" data-testid="iq-reopen" title="Put the request back in the pipeline as a new referral" onClick={() => move('new')}>{Icon.zap({ size: 12 })} Reopen</button></>}
          </div>
        ) : (
          <div className="iq-nextbox" data-testid="iq-nextbox">
            <div className="iq-nextbox-h">
              <span className="iq-nextbox-ic">{target ? Icon[stageDef(target).icon]({ size: 14 }) : Icon.zap({ size: 14 })}</span>
              <div>
                <b>{req.stage === 'review' ? 'Choose the next branch' : `Next: ${target ? stageDef(target).label : '—'}`}</b>
                <span className="muted">{req.stage === 'review'
                  ? 'Clinically ready — waitlist the family or put the assessment on the calendar.'
                  : target === 'scheduled' && !req.apptId
                    ? 'Booking the visit on the calendar is what moves this request forward.'
                    : `${prog.done}/${prog.total} requirements met${prog.blockers.length ? ` · ${prog.blockers.length} outstanding` : target === 'converted' ? ' · ready to convert' : ' · ready to move'}`}</span>
              </div>
              <div className="iq-nextbox-acts">
                {req.stage === 'review' ? (
                  <>
                    <button className="btn btn-sm" data-testid="iq-branch-waitlist" aria-pressed={wlOpen} onClick={openWaitlist}>{Icon.clock({ size: 12 })} Waitlist</button>
                    <button className="btn btn-sm btn-primary" data-testid="iq-branch-book" aria-pressed={bookOpen} onClick={openBook}>{Icon.cal({ size: 12 })} Book assessment</button>
                  </>
                ) : target === 'scheduled' && !req.apptId ? (
                  <button className="btn btn-sm btn-primary" data-testid="iq-advance" aria-pressed={bookOpen} onClick={openBook}>{Icon.cal({ size: 12 })} Book assessment</button>
                ) : target === 'converted' ? (
                  <button className="btn btn-sm btn-primary" data-testid="iq-advance" disabled={prog.blockers.length > 0}
                    title={prog.blockers.length ? `${prog.blockers.length} requirement${prog.blockers.length > 1 ? 's' : ''} outstanding — see the checklist below` : 'Create the client chart from this request'}
                    onClick={() => advanceTo('converted')}>
                    {Icon.plus({ size: 12 })} Convert to client
                  </button>
                ) : target ? (
                  <button className="btn btn-sm btn-primary" data-testid="iq-advance" disabled={prog.blockers.length > 0}
                    title={prog.blockers.length ? `${prog.blockers.length} requirement${prog.blockers.length > 1 ? 's' : ''} outstanding — see the checklist below` : `Move to ${stageDef(target).label}`}
                    onClick={() => advanceTo(target)}>
                    {Icon.check({ size: 12 })} Advance to {stageDef(target).short}
                  </button>
                ) : null}
              </div>
            </div>
            {!wlOpen && <GateList req={req} target={target} testid="iq-next-gates" />}
            {wlOpen && <WaitlistForm req={req} onDone={() => setWlOpen(false)} onCancel={() => setWlOpen(false)} />}
            {bookOpen && (
              <div className="iq-inline-form" data-testid="iq-book-form">
                <h4 style={{ marginTop: 0 }}>Book the assessment visit</h4>
                <div className="iq-grid4">
                  <label className="iq-fld"><span>Date</span><input className="input" type="date" value={book.date} onChange={(e) => setBook((b) => ({ ...b, date: e.target.value }))} data-testid="iq-bk-date" /></label>
                  <label className="iq-fld"><span>Start</span><input className="input" type="time" value={book.start} onChange={(e) => setBook((b) => ({ ...b, start: e.target.value }))} data-testid="iq-bk-start" /></label>
                  <label className="iq-fld"><span>End</span><input className="input" type="time" value={book.end} onChange={(e) => setBook((b) => ({ ...b, end: e.target.value }))} data-testid="iq-bk-end" /></label>
                  <label className="iq-fld"><span>Assessor <em className="iq-req">required</em></span>
                    <Dropdown value={book.clinicianId} onChange={(v) => setBook((b) => ({ ...b, clinicianId: v }))} placeholder="Pick the clinician" options={assessors.map((s) => ({ value: s.id, label: s.name, sub: s.role }))} testid="iq-bk-clinician" searchable />
                  </label>
                </div>
                <div className="iq-actions">
                  <button className="btn btn-sm btn-primary" disabled={Boolean(bookProblem)} onClick={doBook} data-testid="iq-bk-save" title={bookProblem || 'Create the evaluation visit'}>{Icon.cal({ size: 12 })} Book on the calendar</button>
                  <button className="btn btn-sm" onClick={() => setBookOpen(false)} data-testid="iq-bk-cancel">Cancel</button>
                  {bookProblem && <span className="iq-nextbox-hint" data-testid="iq-bk-problem">{bookProblem}</span>}
                </div>
                <p className="iq-note">The visit lands on the calendar as an Evaluation linked to this request, moves it to {stageDef('scheduled').label}, and re-points at the client chart on conversion.</p>
              </div>
            )}
          </div>
        )}

        <nav className="iq-tabs" role="tablist">
          {TABS.map(([k, label, ic]) => (
            <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} data-testid={`iq-tab-${k}`} onClick={() => setTab(k)}>
              {Icon[ic]({ size: 12 })} {label}
            </button>
          ))}
        </nav>

        {tab === 'overview' && (
          <div className="iq-tab-body" data-testid="iq-overview">
            <div className="iq-grid2">
              <div>
                <h4>Request</h4>
                <KV k="Reference" v={<span className="ln-code">{req.no}</span>} />
                <KV k="Stage" v={<StagePill stage={req.stage} />} />
                <KV k="Urgency" v={<UrgencyChip urgency={req.urgency} />} />
                <KV k="Owner" v={owner ? owner.name : 'Unassigned'} />
                <KV k="Received" v={`${fmtDate(isoDate(new Date(req.createdAt)))} · ${sinceText(req.createdAt)}`} />
                <KV k="Channel" v={req.referralChannel} />
                <KV k="SLA" v={<SlaChip req={req} />} />
                <KV k="Source" v={source ? `${source.name} · ${source.kind}` : referralLabel(req, state.referralSources)} />
                <KV k="Referring provider" v={req.referredByName || '—'} />
                {req.referringNpi && <KV k="Referring NPI" v={<span className="ln-code">{req.referringNpi}</span>} />}
              </div>
              <div>
                <h4>Child & family</h4>
                <KV k="Name" v={fullName(req)} />
                <KV k="Date of birth" v={req.dob ? `${req.dob} · ${ageLabel(req.dob)}` : 'Missing'} tone={req.dob ? undefined : 'var(--warn)'} />
                <KV k="Office" v={req.office} />
                <KV k="Guardian" v={req.guardian?.name ? `${req.guardian.name}${req.guardian.relation ? ` (${req.guardian.relation})` : ''}` : '—'} />
                <KV k="Guardian verified" v={guardianVerify} />
                <KV k="Phone" v={primaryPhone(req) || '—'} />
                <KV k="Email" v={req.email || req.guardian?.email || '—'} />
                <KV k="Language" v={`${req.preferredLanguage}${req.interpreter ? ' · interpreter needed' : ''}`} />
                <KV k="Address" v={[req.street, req.city, req.state, req.zip].filter(Boolean).join(', ')} />
                <KV k="Living situation" v={req.livingArrangement} />
                <KV k="School" v={req.schoolName ? `${req.schoolName}${req.iep ? ' · IEP on file' : ''}` : '—'} />
              </div>
            </div>

            <div className="iq-grid2">
              <div>
                <h4>Payer & authorisation</h4>
                <KV k="Primary payer" v={payer?.name || 'Not selected'} tone={payer ? undefined : 'var(--warn)'} />
                <KV k="Member ID" v={req.memberId || '—'} />
                <KV k="Plan type" v={req.planType} />
                <KV k="Benefits check" v={VOB_STATUS[req.vob?.status]?.label} />
                <KV k="Auth required" v={req.vob?.priorAuthRequired == null ? 'Not verified' : req.vob.priorAuthRequired ? 'Yes' : 'No'} />
                <KV k="Auth decision" v={AUTH_DECISIONS[req.auth?.decision]?.label || 'Not submitted'} />
                <KV k="Approved window" v={req.auth?.windowStart ? `${fmtDate(req.auth.windowStart)} → ${fmtDate(req.auth.windowEnd)}` : '—'} />
              </div>
              <div>
                <h4>Service plan</h4>
                <KV k="Setting preference" v={req.settingPref} />
                <KV k="Service line" v={req.serviceLine || '—'} />
                <KV k="Program" v={req.program || '—'} />
                <KV k="Assigned BCBA" v={staff.find((s) => s.id === req.bcbaAssignedId)?.name || 'Unassigned'} />
                <KV k="Assessment" v={req.assessment?.date ? `${fmtDate(req.assessment.date)} · ${req.assessment.instrument}` : 'Not done'} />
                <KV k="Recommended" v={req.assessment?.recommendedHoursPerWeek ? `${req.assessment.recommendedHoursPerWeek} h/week · ${req.assessment.recommendedSetting}` : '—'} />
                <KV k="Assessment visit" v={linkedAppt
                  ? `${fmtDate(req.apptDate)} · ${staff.find((s) => s.id === req.clinicianId)?.name || 'assessor not set'}`
                  : req.stage === 'scheduled'
                    ? <span className="iq-verify"><span style={{ color: 'var(--warn)' }}>No visit on the calendar</span><button className="btn btn-sm" data-testid="iq-rebook" onClick={openBook}>{Icon.cal({ size: 12 })} Book assessment</button></span>
                    : '—'} />
                <KV k="Waitlist" v={req.stage === 'waitlist'
                  ? `${req.waitlist?.reason || '—'} · priority ${req.waitlist?.priority || '—'} · review ${req.waitlist?.reviewBy ? fmtDate(req.waitlist.reviewBy) : 'not set'}${req.waitlist?.since ? ` · waiting ${sinceText(req.waitlist.since).replace(' ago', '')}` : ''}`
                  : '—'} />
                {req.stage === 'waitlist' && (
                  <div className="iq-inline-form" data-testid="iq-wl-panel" style={{ marginTop: 8 }}>
                    <div className="iq-grid4">
                      <label className="iq-fld"><span>Next check-in with the family</span>
                        <input className="input" type="date" value={wlReview} onChange={(e) => setWlReview(e.target.value)} data-testid="iq-wl-review-date" />
                      </label>
                      <div className="iq-fld" style={{ justifyContent: 'flex-end' }}>
                        <div className="iq-actions" style={{ marginTop: 0 }}>
                          <button className="btn btn-sm" data-testid="iq-wl-review" disabled={!wlReview} onClick={() => { const r = actions.reviewWaitlist(id, { reviewBy: wlReview }); toast({ message: r.msg, kind: r.ok ? 'ok' : 'warn' }) }}>{Icon.check({ size: 12 })} Record check-in</button>
                          <button className="btn btn-sm btn-primary" data-testid="iq-wl-book" onClick={openBook}>{Icon.cal({ size: 12 })} Book assessment</button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="iq-grid2">
              <div>
                <h4>Documents</h4>
                {(() => { const d = docProgress(req); return (
                  <><KV k="Required on file" v={`${d.done}/${d.required}`} tone={d.missing.length ? 'var(--warn)' : 'var(--ok)'} />
                    <KV k="Outstanding" v={d.missing.length ? d.missing.map((m) => m.label).join(', ') : 'None'} /></>
                ) })()}
                <KV k="Consents signed" v={`${requiredConsents(req).filter((c) => consentSigned(req, c.id)).length}/${requiredConsents(req).length}`} />
              </div>
              <div>
                <h4>Conversion readiness</h4>
                <KV k="Requirements met" v={`${GATES.converted.length - convBlockers.length}/${GATES.converted.length}`} tone={convBlockers.length ? 'var(--warn)' : 'var(--ok)'} />
                <KV k="Outstanding" v={convBlockers.length ? convBlockers.map((b) => b.label).join(', ') : 'Ready to convert'} />
                {isWon(req.stage) ? (
                  <div className="iq-actions"><button className="btn btn-sm" disabled data-testid="iq-converted-flag">Already converted</button></div>
                ) : isLost(req.stage) ? null : (
                  <div className="iq-actions">
                    <button className="btn btn-sm btn-primary" disabled={convBlockers.length > 0 || req.stage !== 'auth'} data-testid="iq-convert"
                      title={req.stage !== 'auth' ? `Conversion happens from ${stageDef('auth').label}` : convBlockers.length ? 'Requirements outstanding' : 'Create the client chart'}
                      onClick={() => setConvertOpen(true)}>
                      {Icon.plus({ size: 12 })} Convert to client
                    </button>
                    <span className="muted" style={{ fontSize: 11.5 }}>
                      {req.stage !== 'auth' ? `Available at the ${stageDef('auth').label} step` : convBlockers.length > 0 ? `${convBlockers.length} requirement${convBlockers.length > 1 ? 's' : ''} outstanding` : 'Everything is in place'}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {req.notes && <><h4>Notes</h4><p className="iq-para">{req.notes}</p></>}
          </div>
        )}

        {tab === 'contacts' && (
          <div className="iq-tab-body" data-testid="iq-contacts">
            <div className="iq-tab-head">
              <h4>Outreach log</h4>
              {!logOpen && !isTerminal(req.stage) && <button className="btn btn-sm btn-primary" data-testid="iq-add-contact" onClick={() => setLogOpen(true)}>{Icon.plus({ size: 12 })} Log contact</button>}
            </div>
            {logOpen && <ContactForm req={req} onDone={() => setLogOpen(false)} />}
            <div className="iq-timeline">
              {(req.contacts || []).slice().sort((a, b) => b.at - a.at).map((c) => (
                <div className="iq-tl-row" key={c.id} data-testid={`iq-contact-${c.id}`}>
                  <span className={`iq-tl-dot ${c.outcome === 'reached' ? 'ok' : c.outcome === 'declined' ? 'bad' : 'warn'}`} />
                  <div>
                    <b>{CONTACT_OUTCOMES.find((o) => o.id === c.outcome)?.label || c.outcome} <em className="muted">· {c.channel} · {c.direction}</em></b>
                    <span>{c.summary || 'No notes'}</span>
                    <i className="muted">{sinceText(c.at)}{c.nextStepAt ? ` · follow-up due ${fmtDate(c.nextStepAt)}` : ''}</i>
                  </div>
                </div>
              ))}
              {!(req.contacts || []).length && <div className="iq-col-empty">No outreach logged yet. Every attempt counts — this is what the response-time KPI measures.</div>}
            </div>
          </div>
        )}

        {tab === 'benefits' && <BenefitsEditor req={req} />}
        {tab === 'clinical' && <ClinicalEditor req={req} />}
        {tab === 'docs' && <DocsEditor req={req} />}

        {tab === 'timeline' && (
          <div className="iq-tab-body" data-testid="iq-timeline">
            <h4>Audit trail</h4>
            <div className="iq-timeline">
              {[...(req.events || [])].sort((a, b) => b.at - a.at).map((e, i) => (
                <div className="iq-tl-row" key={i} data-testid={`iq-event-${i}`}>
                  <span className="iq-tl-dot" />
                  <div>
                    <b>{e.ev}</b>
                    <i className="muted">{new Date(e.at).toLocaleString()}{e.by ? ` · ${staff.find((s) => s.id === e.by)?.name || e.by}` : ''}</i>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {closeOpen && (
        <div className="iq-modal" data-testid="iq-close-modal" onMouseDown={(e) => e.target === e.currentTarget && setCloseOpen(false)}>
          <div className="iq-modal-card" role="dialog" aria-modal="true" aria-label="Close request">
            <header className="iq-modal-h"><b>Close {req.no} — not admitted</b><button className="iconbtn" onClick={() => setCloseOpen(false)}>{Icon.x({ size: 13 })}</button></header>
            <div className="iq-tab-body">
              <p className="iq-note">Tracking the reason is what separates true demand loss from a process breakdown — the pipeline report groups these.</p>
              <div className="iq-reasons">
                {LOST_REASONS.map((r) => (
                  <button key={r.id} className={`iq-reason ${lostReason === r.id ? 'on' : ''}`} data-testid={`iq-lost-${r.id}`} onClick={() => setLostReason(r.id)}>
                    {r.label}<em>{r.owner}</em>
                  </button>
                ))}
              </div>
              <label className="iq-fld wide"><span>Disposition note{lostReason === 'other' ? ' (required)' : ''}</span>
                <input className="input" value={lostNote} onChange={(e) => setLostNote(e.target.value)} data-testid="iq-lost-note" placeholder="Who was spoken to, what was offered, what happened next" />
              </label>
              <div className="iq-actions">
                <button className="btn btn-sm btn-primary" disabled={!lostReason || (lostReason === 'other' && !lostNote.trim())} data-testid="iq-lost-save" onClick={doClose}>Close request</button>
                <button className="btn btn-sm" onClick={() => setCloseOpen(false)}>Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {convertOpen && (
        <div className="iq-modal" data-testid="iq-convert-modal" onMouseDown={(e) => e.target === e.currentTarget && setConvertOpen(false)}>
          <div className="iq-modal-card" role="dialog" aria-modal="true" aria-label="Convert to client">
            <header className="iq-modal-h"><b>Convert {fullName(req)} into a client chart</b><button className="iconbtn" onClick={() => setConvertOpen(false)}>{Icon.x({ size: 13 })}</button></header>
            <div className="iq-tab-body">
              <p className="iq-para">This creates the client record and links everything downstream in one step — one Undo reverses all of it.</p>
              <div className="iq-grid2">
                <div>
                  <h4>Client chart will carry</h4>
                  <KV k="Name" v={fullName(req)} />
                  <KV k="Program" v={req.program || req.serviceLine || 'Assessment / intake'} />
                  <KV k="Payer" v={payer?.name || 'Self-pay'} />
                  <KV k="Authorised hours" v={`${planned.ok ? planned.client.authWeekly : '—'} h/week`} />
                  <KV k="Auth window" v={`${req.auth?.windowStart ? fmtDate(req.auth.windowStart) : '—'} → ${req.auth?.windowEnd ? fmtDate(req.auth.windowEnd) : '—'}`} />
                  <KV k="Secondary (COB)" v={planned.ok && planned.client.secondary ? 'Attached' : 'None'} />
                </div>
                <div>
                  <h4>Attribution preserved</h4>
                  <KV k="Intake reference" v={req.no} />
                  <KV k="Referral source" v={referralLabel(req, state.referralSources)} />
                  <KV k="Assessment visit" v={linkedAppt ? `${fmtDate(req.apptDate)} re-points at the new chart` : 'None booked'} />
                  <KV k="First service date" v={req.firstServiceDate ? fmtDate(req.firstServiceDate) : 'Set on first session'} />
                </div>
              </div>
              {!planned.ok && <div className="iq-banner bad" data-testid="iq-convert-blocked">{Icon.alert({ size: 13 })} {planned.msg}</div>}
              <div className="iq-actions">
                <button className="btn btn-sm btn-primary" disabled={!planned.ok} data-testid="iq-convert-confirm" onClick={doConvert}>{Icon.check({ size: 12 })} Create client chart</button>
                <button className="btn btn-sm" onClick={() => setConvertOpen(false)}>Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </Drawer>
  )
}

export default IntakeDetail
