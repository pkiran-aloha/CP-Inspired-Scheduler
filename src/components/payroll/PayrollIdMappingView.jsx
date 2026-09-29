import React, { useEffect, useMemo, useState } from 'react'
import { useStore } from '../../state/store'
import { SectionBar } from '../NavRail'
import { Icon } from '../../ui/Icons'
import { useToast } from '../../ui/Toast'
import { StaffCell, Pager, money } from './PayrollCommon'
import { OFFICES, CLASSIFICATIONS, PAY_TYPES, duplicatePayrollIds, defaultProfile, defaultPayrollSettings } from '../../lib/payroll'

const EMPTY_DED = { code: 'MED', label: 'Medical / dental / vision', kind: 'pretax', calc: 'flat', value: 0 }

/**
 * Payroll ID Mapping — the master-data screen.
 *
 * A payroll provider keys on the payroll ID, not on the name. This screen is
 * where the practice decides who is included, what they are paid, and how they
 * are classified — which is why it validates duplicates and refuses to pretend a
 * missing ID is fine.
 */
export default function PayrollIdMappingView() {
  const state = useStore()
  const { actions, staff, payProfiles } = state
  const toast = useToast()
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const [open, setOpen] = useState(null)
  const [draft, setDraft] = useState(null)

  const byStaff = useMemo(() => Object.fromEntries((payProfiles || []).map((p) => [p.staffId, p])), [payProfiles])
  const dupes = useMemo(() => duplicatePayrollIds(payProfiles || []), [payProfiles])
  const dupeStaff = useMemo(() => new Set(dupes.flatMap((d) => d.staffIds)), [dupes])

  // Deep link from the Review Register modal ("Fix this issue"): pre-filter the
  // table to the affected employee and open their pay profile editor.
  const focus = state.ui?.payrollFocus
  useEffect(() => {
    if (!focus) return
    if (focus.name) setQ(focus.name)
    setPage(1)
    if (focus.open === 'profile' && focus.staffId) {
      const s = (staff || []).find((x) => x.id === focus.staffId)
      if (s) { setOpen(s.id); setDraft(byStaff[s.id] || defaultProfile(s, 0)) }
    }
    actions.setUI({ payrollFocus: null })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus])

  const rows = useMemo(() => (staff || [])
    .map((s) => ({ s, p: byStaff[s.id] || defaultProfile(s, 0) }))
    .filter(({ s, p }) => !q.trim() || `${s.name} ${s.role} ${p.payrollId} ${p.office}`.toLowerCase().includes(q.trim().toLowerCase()))
    .sort((a, b) => a.s.name.localeCompare(b.s.name)), [staff, byStaff, q])

  const pageRows = rows.slice((page - 1) * 25, page * 25)
  const includedCount = (payProfiles || []).filter((p) => p.include).length
  const missingIds = (payProfiles || []).filter((p) => p.include && !String(p.payrollId || '').trim()).length

  const save = (patch) => {
    const item = { ...draft, ...patch }
    setDraft(item)
    actions.payrollProfile(item)
  }

  const quickPatch = (s, patch) => {
    const base = byStaff[s.id] || defaultProfile(s, 0)
    actions.payrollProfile({ ...base, ...patch, staffId: s.id })
  }

  const autoAssign = () => {
    let n = 0
    ;(staff || []).forEach((s, i) => {
      const p = byStaff[s.id]
      if (!p || String(p.payrollId || '').trim()) return
      actions.payrollProfile({ ...p, payrollId: `ALOHA-${String(i + 1).padStart(4, '0')}`, staffId: s.id })
      n += 1
    })
    toast({ message: n ? `Assigned ${n} missing payroll ID${n > 1 ? 's' : ''} — replace them with the provider's real IDs before exporting` : 'Every included employee already has a payroll ID', kind: n ? 'ok' : 'info' })
  }

  return (
    <div className="sectionpage" data-testid="pay-idmap-sec" style={{ background: 'var(--bg)' }}>
      <SectionBar icon="badge" title="Payroll ID Mapping" sub={`${includedCount} included · ${missingIds} missing a payroll ID · ${dupes.length} duplicate ID${dupes.length === 1 ? '' : 's'}`}>
        <div className="sb-search" style={{ minWidth: 220, borderRadius: 10 }}>
          <span className="sic">{Icon.search({ size: 12 })}</span>
          <input placeholder="Search staff, payroll ID, office" value={q} onChange={(e) => { setQ(e.target.value); setPage(1) }} data-testid="pay-idmap-search" />
        </div>
        <button className="btn btn-sm" data-testid="pay-idmap-autoassign" onClick={autoAssign}>Assign missing IDs</button>
        <button className="btn btn-sm" data-testid="pay-idmap-include-all" onClick={() => { (payProfiles || []).forEach((p) => actions.payrollProfile({ ...p, include: true })); toast({ message: 'All staff included in payroll', kind: 'ok' }) }}>Include all</button>
      </SectionBar>

      {dupes.length > 0 && (
        <div className="batch-strip" style={{ margin: 16, padding: '12px 16px', background: 'var(--panel)', border: '1px solid var(--danger, #ef4444)', borderRadius: 12 }} data-testid="pay-idmap-dupes">
          <b style={{ color: 'var(--danger, #ef4444)' }}>{Icon.alert({ size: 13 })} Duplicate payroll IDs block processing</b>
          <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
            {dupes.map((d) => `${d.payrollId} → ${d.staffIds.map((id) => staff.find((s) => s.id === id)?.name || id).join(', ')}`).join(' · ')}
          </div>
        </div>
      )}

      <div className="batch-strip" style={{ margin: 16, padding: '12px 16px', background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 12 }}>
        <span className="muted">
          Payroll IDs are what your payroll provider matches on — names are not unique enough. Classification and rates are master data:
          changing them takes effect on the <b>next</b> run and is undoable, never silently retroactive.
        </span>
      </div>

      <div style={{ padding: '0 16px 16px' }}>
        <div className="py-tbl" data-testid="pay-idmap-table" style={{ overflowX: 'auto' }}>
          <div className="py-thead" style={{ gridTemplateColumns: '2fr 1.2fr 1.1fr 120px 110px 110px 92px 44px' }}>
            <span>Staff</span><span>Payroll ID</span><span>Office</span><span>Pay type</span>
            <span className="num">Base rate</span><span>Classification</span><span>Include</span><span />
          </div>
          {pageRows.map(({ s, p }) => (
            <div key={s.id} className={`py-trow ${dupeStaff.has(s.id) ? 'bad' : ''}`} data-testid={`pay-idmap-row-${s.id}`} style={{ gridTemplateColumns: '2fr 1.2fr 1.1fr 120px 110px 110px 92px 44px', minHeight: 56 }}>
              <StaffCell staffId={s.id} sub={s.role} />
              <input className="input pay-inline" value={p.payrollId || ''} placeholder="provider ID"
                data-testid={`pay-idmap-id-${s.id}`}
                onChange={(e) => quickPatch(s, { payrollId: e.target.value })}
                onClick={(e) => e.stopPropagation()} />
              <select className="input pay-inline" value={p.office || ''} data-testid={`pay-idmap-office-${s.id}`} onChange={(e) => quickPatch(s, { office: e.target.value })} onClick={(e) => e.stopPropagation()}>
                <option value="">—</option>
                {OFFICES.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
              <select className="input pay-inline" value={p.payType} data-testid={`pay-idmap-paytype-${s.id}`} onChange={(e) => quickPatch(s, { payType: e.target.value })} onClick={(e) => e.stopPropagation()}>
                {PAY_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>
              <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                {p.payType === 'salary' ? `${money((p.annualSalary || 0) * 100, { cents: false })}/yr` : p.payType === 'session' ? `${money((p.sessionRate || 0) * 100)}/session` : `${money((p.baseRate || 0) * 100)}/h`}
              </span>
              <span className={p.classification === 'exempt' && !p.classificationReviewed ? 'pay-flag bad' : 'pay-flag ok'} title={p.classification === 'exempt' ? 'Exempt status needs a salary-basis + duties review' : 'Overtime applies after 40 hours in a workweek'}>
                {p.classification === 'exempt' ? (p.classificationReviewed ? 'exempt ✓' : 'exempt ⚠') : 'non-exempt'}
              </span>
              <span>
                <input type="checkbox" className="checkbox" checked={!!p.include} data-testid={`pay-idmap-include-${s.id}`} aria-label={`Include ${s.name} in payroll`}
                  onChange={(e) => quickPatch(s, { include: e.target.checked })} onClick={(e) => e.stopPropagation()} />
              </span>
              <button className="iconbtn" title="Open pay profile" data-testid={`pay-idmap-open-${s.id}`} onClick={() => { setOpen(s.id); setDraft(byStaff[s.id] || defaultProfile(s, 0)) }}>{Icon.chevronR({ size: 13 })}</button>
            </div>
          ))}
          {!rows.length && <div className="py-empty" style={{ padding: 44, textAlign: 'center' }} data-testid="pay-idmap-empty"><b>No staff match this search</b></div>}
        </div>
        <Pager page={page} setPage={setPage} total={rows.length} testId="pay-idmap-pager" />
      </div>

      {open && draft && (
        <div className="modal-overlay" onClick={() => setOpen(null)}>
          <div className="modal pay-drawer" data-testid="pay-profile-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Pay profile">
            <div className="modal-head">
              <b>Pay profile · {staff.find((s) => s.id === open)?.name}</b>
              <button className="modal-x" onClick={() => setOpen(null)} aria-label="Close">{Icon.x({ size: 15 })}</button>
            </div>
            <div className="modal-body">
              <div className="pay-form-grid">
                <label className="pay-field"><span>Payroll ID</span><input className="input" value={draft.payrollId || ''} data-testid="pay-prof-id" onChange={(e) => save({ payrollId: e.target.value })} /></label>
                <label className="pay-field"><span>Office / cost centre</span>
                  <select className="input" value={draft.office || ''} data-testid="pay-prof-office" onChange={(e) => save({ office: e.target.value })}>
                    {OFFICES.map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                </label>
                <label className="pay-field"><span>Work state</span><input className="input" value={draft.state || ''} maxLength={2} data-testid="pay-prof-state" onChange={(e) => save({ state: e.target.value.toUpperCase() })} /></label>
                <label className="pay-field"><span>Pay type</span>
                  <select className="input" value={draft.payType} data-testid="pay-prof-paytype" onChange={(e) => save({ payType: e.target.value })}>
                    {PAY_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                  </select>
                </label>
                {draft.payType === 'salary' ? (
                  <label className="pay-field"><span>Annual salary</span><input className="input" type="number" value={draft.annualSalary || 0} data-testid="pay-prof-salary" onChange={(e) => save({ annualSalary: Number(e.target.value) })} /></label>
                ) : draft.payType === 'session' ? (
                  <label className="pay-field"><span>Rate per session</span><input className="input" type="number" value={draft.sessionRate || 0} data-testid="pay-prof-session" onChange={(e) => save({ sessionRate: Number(e.target.value) })} /></label>
                ) : (
                  <label className="pay-field"><span>Base hourly rate</span><input className="input" type="number" value={draft.baseRate || 0} data-testid="pay-prof-rate" onChange={(e) => save({ baseRate: Number(e.target.value) })} /></label>
                )}
                <label className="pay-field"><span>Classification</span>
                  <select className="input" value={draft.classification} data-testid="pay-prof-class" onChange={(e) => save({ classification: e.target.value, classificationReviewed: false })}>
                    {CLASSIFICATIONS.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                  </select>
                </label>
              </div>

              {draft.classification === 'exempt' && (
                <div className={`pay-gate ${draft.classificationReviewed ? 'ok' : 'warn'}`} data-testid="pay-prof-exempt-note">
                  <span className="ic">{draft.classificationReviewed ? Icon.checkCircle({ size: 15 }) : Icon.alert({ size: 15 })}</span>
                  <div>
                    <b>{draft.classificationReviewed ? 'Exempt status recorded as reviewed' : 'Exempt status not yet reviewed'}</b>
                    <div className="why">
                      Treating a salaried clinician as exempt skips overtime. Confirm the salary-basis and duties tests (and your state's rules)
                      before relying on it — the payroll gate keeps warning until this is signed off.
                    </div>
                    {!draft.classificationReviewed && (
                      <button className="pay-link" data-testid="pay-prof-mark-reviewed" onClick={() => save({ classificationReviewed: true })}>Record my review</button>
                    )}
                  </div>
                </div>
              )}

              <h4 className="pay-h4">Duty rates (per hour)</h4>
              <div className="pay-form-grid">
                {['SUP', 'EVAL', 'DRIVE', 'ADMIN', 'TRAIN'].map((code) => (
                  <label key={code} className="pay-field"><span>{code}</span>
                    <input className="input" type="number" value={draft.rates?.[code] ?? ''} data-testid={`pay-prof-rate-${code}`}
                      onChange={(e) => save({ rates: { ...draft.rates, [code]: Number(e.target.value) } })} />
                  </label>
                ))}
              </div>

              <h4 className="pay-h4">Withholding elections (estimates)</h4>
              <div className="pay-form-grid">
                <label className="pay-field"><span>Filing status</span>
                  <select className="input" value={draft.tax?.filingStatus || 'single'} data-testid="pay-prof-filing" onChange={(e) => save({ tax: { ...draft.tax, filingStatus: e.target.value } })}>
                    <option value="single">Single</option>
                    <option value="married">Married</option>
                  </select>
                </label>
                <label className="pay-field"><span>Dependents / credits</span><input className="input" type="number" min="0" value={draft.tax?.dependents || 0} data-testid="pay-prof-dependents" onChange={(e) => save({ tax: { ...draft.tax, dependents: Number(e.target.value) } })} /></label>
                <label className="pay-field"><span>Extra withholding / period ($)</span><input className="input" type="number" min="0" value={draft.tax?.extraWithholding || 0} data-testid="pay-prof-extra" onChange={(e) => save({ tax: { ...draft.tax, extraWithholding: Number(e.target.value) } })} /></label>
                <label className="pay-field pay-check"><span>Exempt from withholding</span>
                  <input type="checkbox" className="checkbox" checked={!!draft.tax?.exempt} data-testid="pay-prof-tax-exempt" onChange={(e) => save({ tax: { ...draft.tax, exempt: e.target.checked } })} />
                </label>
              </div>

              <h4 className="pay-h4">Deductions</h4>
              <div className="pay-lines">
                {(draft.deductions || []).map((d, i) => (
                  <div key={d.id || i} className="pay-line" style={{ gridTemplateColumns: '1.4fr 90px 80px 90px 34px' }}>
                    <span>{d.label}</span>
                    <span className="muted">{d.kind === 'pretax' ? 'pre-tax' : 'post-tax'}</span>
                    <span className="muted">{d.calc === 'percent' ? '% of gross' : 'flat'}</span>
                    <span className="num">{d.calc === 'percent' ? `${d.value}%` : `$${Number(d.value).toFixed(2)}`}</span>
                    <button className="iconbtn" aria-label={`Remove ${d.label}`} data-testid={`pay-prof-ded-del-${i}`}
                      onClick={() => save({ deductions: (draft.deductions || []).filter((x) => x !== d) })}>{Icon.x({ size: 12 })}</button>
                  </div>
                ))}
                {!(draft.deductions || []).length && <div className="pay-line empty">No deductions on this profile.</div>}
              </div>
              <button className="btn btn-sm" data-testid="pay-prof-ded-add" style={{ marginTop: 8 }}
                onClick={() => save({ ...draft, deductions: [...(draft.deductions || []), { ...EMPTY_DED, id: `d-${Date.now()}` }] })}>
                + Add deduction
              </button>

              <h4 className="pay-h4">Bank details (direct deposit)</h4>
              <div className="pay-form-grid">
                <label className="pay-field"><span>Routing number</span><input className="input" value={draft.bankRouting || ''} data-testid="pay-prof-routing" onChange={(e) => save({ bankRouting: e.target.value })} /></label>
                <label className="pay-field"><span>Account number</span><input className="input" value={draft.bankAccount || ''} data-testid="pay-prof-account" onChange={(e) => save({ bankAccount: e.target.value })} /></label>
              </div>
              <div className="pay-hint">
                Demo values only. Search the profiles table for a missing payroll ID before exporting to your provider; the ACH draft this
                workspace builds is NACHA-shaped but has not been validated by any bank.
              </div>
            </div>
            <div className="modal-foot">
              <button className="btn btn-sm" onClick={() => {
                const d = defaultPayrollSettings()
                void d
                save({ rates: { SUP: 0, EVAL: 0, DRIVE: 0, ADMIN: 0, TRAIN: 0 } })
                toast({ message: 'Duty rates cleared — those duties will fall back to the base rate', kind: 'warn' })
              }}>Reset duty rates</button>
              <button className="btn btn-sm btn-primary" onClick={() => { setOpen(null); toast({ message: 'Pay profile saved', kind: 'ok' }) }}>Done</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
