// Claim-level ERA review and posting. All decisions are recomputed against the current
// ledger at posting time; no fuzzy matching, service-line allocation, or auto-application
// of provider-level PLB adjustments. Kept separate from the X12 reader for testability.
import { payPatch, patientLedgerMatches, carcHintsOf } from './claims'
import { uid } from './model'

const toCents = (n) => typeof n === 'number' && Number.isFinite(n) && n >= 0 &&
  Number.isSafeInteger(Math.round(n * 100)) &&
  Math.abs(n * 100 - Math.round(n * 100)) < 0.000001 ? Math.round(n * 100) : null
const dollars = (n) => n / 100
const liveStatuses = new Set(['submitted', 'partially_paid'])
// CLP02 2/3/20 are secondary/tertiary settlements. Never apply them to the
// primary claim ledger until secondary reconciliation is implemented.
const payableStatuses = new Set(['1', '19', 'manual-partial'])

// CARC hints come from Settings → Billing defaults (carcHintsOf), defaults in claims.js
export function eraDenialInfo(line, state) {
  const adjustment = (line.adjustments || []).find((a) => a.group !== 'PR' && /^(?:\d+|[A-Z]\d+)$/i.test(a.reason))
  const carc = adjustment ? `${adjustment.group}-${adjustment.reason}` : 'unavailable'
  const hint = carcHintsOf(state).find((h) => h.code === carc)
  const [reason, fix] = hint ? [hint.label, hint.fix] : [
    adjustment ? `Payer denial ${carc}` : 'Payer denial, no CARC supplied',
    'Review the ERA adjustment and payer guidance before correcting or appealing.',
  ]
  return { code: `carc:${carc}`, reason, fix }
}

// Same financial line under a new envelope/trace must not post twice to an
// open, partially paid claim. A legitimate same-amount repeat is parked for
// human review rather than silently applied a second time.
const lineIdentity = (line, claimId) => JSON.stringify([claimId, line.claimNo, line.statusCode,
  line.charges, line.paid, line.patientResp, line.allowed, line.dosFrom, line.dosTo,
  (line.adjustments || []).map((a) => [a.group, a.reason, a.amount].join(':')).sort()])

// A preview never mutates the workspace. Rows that cannot be posted explain why;
// they can still be saved as parked work for investigation and later retry.
export function previewEra(state, parsed, { ignoreEraId = null } = {}) {
  const lines = Array.isArray(parsed?.lines) ? parsed.lines : []
  const errors = [...(parsed?.errors || [])]
  if (!lines.length) errors.push('No claim lines to import')
  const lineIds = lines.map((line, i) => line.id || `era-line-${i + 1}`)
  if (new Set(lineIds).size !== lineIds.length) errors.push('Duplicate line identifiers in ERA')
  if (parsed?.fingerprint && Object.values(state.eraImports || {}).some((era) => era.id !== ignoreEraId && era.fingerprint === parsed.fingerprint)) {
    errors.push('This 835 file has already been imported. Undo that import before importing the same file again.')
  }

  const byIdentifier = new Map()
  for (const claim of Object.values(state.claims || {})) {
    for (const key of new Set([claim.no, claim.id].filter(Boolean))) {
      if (!byIdentifier.has(key)) byIdentifier.set(key, new Set())
      byIdentifier.get(key).add(claim)
    }
  }
  // Multiple exact matches are ambiguous; do not silently pick one.
  const matches = lines.map((line) => [...(byIdentifier.get(line.claimNo) || [])])
  const counts = new Map()
  for (const match of matches) if (match.length === 1) counts.set(match[0].id, (counts.get(match[0].id) || 0) + 1)
  const payments = Object.values(state.payments || {})
  const reversed = new Set(payments.map((p) => p.reversalOf).filter(Boolean))
  const postedTraces = new Set(payments.filter((p) => p.ref && p.claimId && !p.reversalOf && !reversed.has(p.id)).map((p) => `${p.claimId}|${p.ref}`))
  const postedLines = new Set(Object.values(state.eraImports || {}).flatMap((era) => (era.detail || [])
    .filter((d) => d.decision === 'posted' && d.claimId).map((d) => lineIdentity(d, d.claimId))))
  const warnings = []
  if (typeof parsed?.meta?.bprAmount === 'number') {
    const clpTotal = lines.reduce((sum, line) => sum + (Number(line.paid) || 0), 0)
    if (Math.abs(parsed.meta.bprAmount - clpTotal) > 0.009) warnings.push(
      `BPR total ($${parsed.meta.bprAmount.toFixed(2)}) differs from the sum of CLP payer payments ($${clpTotal.toFixed(2)}). Reconcile the deposit and any provider-level PLB separately.`)
  }

  const rows = lines.map((line, i) => {
    const claim = matches[i].length === 1 ? matches[i][0] : null
    const reason = (message) => ({ id: line.id || `era-line-${i + 1}`, line, claimId: claim?.id || null, claim, ready: false, reason: message })
    if (!line.claimNo) return reason('Missing claim number')
    if (matches[i].length > 1) return reason('Claim number matches more than one claim')
    if (!claim) return reason('No exact claim number match')
    if (claim.method === 'secondary') return reason('Linked secondary ERA remittance needs manual COB reconciliation; parked')
    if (claim.secondary && state.claims?.[claim.secondary]?.status !== 'void') return reason('A secondary filing is linked; reconcile the primary/COB pair manually')
    if (!patientLedgerMatches(state, claim)) return reason('Patient receipt ledger does not reconcile; review the primary first')
    if ((claim.patientPaid || 0) > 0) return reason('Patient cash is already allocated; reconcile it manually before changing the payer balance')
    if (line.hasSVC) return reason('Service-line SVC allocations need manual reconciliation; claim-level posting is not supported')
    if (counts.get(claim.id) > 1) return reason('Multiple ERA lines match this claim; reconcile manually')
    if (parsed?.meta?.payerName && claim.payer) {
      const fromFile = parsed.meta.payerName.toLowerCase().replace(/[^a-z0-9]/g, '')
      const fromClaim = String(claim.payer).toLowerCase().replace(/[^a-z0-9]/g, '')
      if (!fromFile || !fromClaim || !(fromFile === fromClaim ||
        (fromFile.length >= 5 && fromClaim.length >= 5 && (fromFile.includes(fromClaim) || fromClaim.includes(fromFile))))) {
        return reason(`ERA payer ${parsed.meta.payerName} differs from claim payer ${claim.payer}`)
      }
    }
    if (['2', '3', '20'].includes(String(line.statusCode))) return reason('Secondary/tertiary ERA claim requires separate reconciliation; parked')
    if (!liveStatuses.has(claim.status)) return reason(`Claim is ${claim.status || 'not submitted'}; only submitted or partially paid claims can be posted`)
    if (postedLines.has(lineIdentity(line, claim.id))) return reason('This ERA claim line has already been posted')
    const trace = parsed?.meta?.traceNo
    if (trace && postedTraces.has(`${claim.id}|${trace}`)) return reason('This payment trace has already been posted to the claim')

    const charges = toCents(line.charges), paid = toCents(line.paid), claimCharges = toCents(claim.charges)
    const priorPaid = toCents(claim.paid || 0), priorAdj = toCents(claim.adj || 0)
    const adjustments = (line.adjustments || []).map((a) => ({ ...a, cents: toCents(a.amount) }))
    if ([charges, paid, claimCharges, priorPaid, priorAdj].some((n) => n === null) || adjustments.some((a) => a.cents === null)) return reason('Invalid or negative monetary amount')
    if (charges === 0 || charges !== claimCharges) return reason('ERA charges differ from claim charges')
    if ((line.dosFrom && claim.dosFrom && line.dosFrom !== claim.dosFrom) ||
        (line.dosTo && claim.dosTo && line.dosTo !== claim.dosTo)) return reason('ERA dates of service differ from claim dates')
    const adjustment = adjustments.filter((a) => a.group !== 'PR').reduce((sum, a) => sum + a.cents, 0)
    const casPatient = adjustments.filter((a) => a.group === 'PR').reduce((sum, a) => sum + a.cents, 0)
    const clpPatient = toCents(line.patientResp ?? 0)
    if (clpPatient === null) return reason('Invalid patient responsibility')
    if (casPatient && casPatient !== clpPatient) return reason('CAS patient responsibility differs from CLP')
    const patientResp = Math.max(clpPatient, casPatient)
    const allowed = line.allowed == null ? null : toCents(line.allowed)
    if (line.allowed != null && allowed === null) return reason('Invalid allowed amount')
    if (paid + adjustment + patientResp > charges) return reason('Paid + adjustments + patient responsibility exceed charges')
    if (allowed !== null && (allowed > charges || allowed < paid + patientResp)) return reason('Allowed amount does not cover payer pay and patient responsibility')
    if (paid + adjustment > charges - priorPaid - priorAdj) return reason('Payment and adjustments exceed outstanding claim balance')

    const status = String(line.statusCode || '')
    if (status === '4') {
      if (paid) return reason('Denied claim has a payment; manual review required')
      if (!adjustments.some((a) => a.group !== 'PR' && /^(?:\d+|[A-Z]\d+)$/i.test(a.reason)) || !adjustment) return reason('Denial has no monetary CARC adjustment; manual review required')
    } else {
      if (!payableStatuses.has(status)) return reason(`Unsupported claim status ${status || '(missing)'}`)
      if (!paid && !adjustment) return reason('No payer payment or adjustment to post')
      if (status === '1' && paid + adjustment + patientResp !== charges) return reason('Finalized claim does not reconcile to charges')
    }
    return {
      id: line.id || `era-line-${i + 1}`, line, claimId: claim.id, claim,
      ready: true, reason: '', kind: status === '4' ? 'denial' : 'payment',
      paid: dollars(paid), adj: dollars(priorAdj + adjustment), newAdj: dollars(adjustment), patientResp: dollars(patientResp),
    }
  })
  const ready = rows.filter((r) => r.ready).length
  return { rows, errors, warnings, ready, parked: rows.length - ready }
}

function recordLine(row, decision, reason = '') {
  // Keep the fields needed to review or retry; never persist raw ISA/NM1 or the
  // entire source file, which may contain unneeded member identifiers/PHI.
  const line = row.line
  return {
    id: row.id, claimNo: line.claimNo, payerClaimCtrl: line.payerClaimCtrl || '',
    status: line.status || '', statusCode: line.statusCode || '', charges: line.charges,
    dosFrom: line.dosFrom || null, dosTo: line.dosTo || null, hasSVC: !!line.hasSVC,
    paid: line.paid, patientResp: line.patientResp || 0, allowed: line.allowed ?? null,
    adjustments: (line.adjustments || []).map((a) => ({ group: a.group, reason: a.reason, amount: a.amount })),
    claimId: row.claimId, decision, reason,
  }
}

function applyRow(row, eraId, trace, date, at, makeId, state) {
  const claim = row.claim
  if (row.kind === 'denial') {
    const denial = { ...eraDenialInfo(row.line, state), note: `ERA ${trace || eraId}`, at }
    return { claim: { ...claim, status: 'denied', denial, history: [...(claim.history || []), { at, ev: `Denied by ERA: ${denial.code} ${denial.reason}` }] } }
  }
  const ref = trace || eraId
  const { claim: paidClaim } = payPatch(claim, { amount: row.paid, adj: row.adj, checkNo: ref, note: '835 ERA remittance', paidAt: at })
  const updated = { ...paidClaim, remittance: { ...paidClaim.remittance, patientResp: row.patientResp } }
  const id = makeId()
  const payment = {
    id, claimId: claim.id, clientId: claim.clientId, payer: claim.payer, amount: row.paid,
    adj: row.newAdj, patientResp: row.patientResp, date, method: 'era', ref,
    note: '835 ERA remittance', kind: 'era835', eraId, eraLineId: row.id, createdAt: at,
  }
  return { claim: updated, payment }
}

function selectedRows(preview, selectedIds) {
  // Never infer consent from eligibility: absent selection means park everything.
  const ids = selectedIds == null ? [] : selectedIds
  const readyIds = new Set(preview.rows.filter((r) => r.ready).map((r) => r.id))
  if (!Array.isArray(ids) || new Set(ids).size !== ids.length || ids.some((id) => !readyIds.has(id))) {
    return { error: 'A selected line is unavailable or no longer safe to post. Review the ERA again.' }
  }
  return { selected: new Set(ids) }
}

// Returns a complete patch for one claimsTx (one Undo step), or an error. Even
// unselected/unsafe rows are persisted as parked so they remain visible and exportable.
export function planEraImport(state, parsed, opts = {}) {
  const preview = previewEra(state, parsed)
  if (preview.errors.length) return { ok: false, msg: preview.errors.join('; '), preview }
  const { selected, error } = selectedRows(preview, opts.selectedIds)
  if (error) return { ok: false, msg: error, preview }
  const makeId = opts.makeId || uid
  const at = opts.at ?? Date.now()
  const id = opts.eraId || makeId()
  if (state.eraImports?.[id]) return { ok: false, msg: 'ERA import ID already exists', preview }
  const trace = parsed.meta?.traceNo || ''
  const date = parsed.meta?.paymentDate || new Date(at).toISOString().slice(0, 10)
  const claimUpserts = [], payments = {}, detail = []
  for (const row of preview.rows) {
    if (!selected.has(row.id)) { detail.push(recordLine(row, 'parked', row.reason || 'Deferred for manual review')); continue }
    const applied = applyRow(row, id, trace, date, at, makeId, state)
    claimUpserts.push(applied.claim)
    if (applied.payment) {
      if (state.payments?.[applied.payment.id] || payments[applied.payment.id]) return { ok: false, msg: 'Payment identifier already exists', preview }
      payments[applied.payment.id] = applied.payment
    }
    detail.push(recordLine(row, 'posted'))
  }
  const posted = selected.size, parked = detail.length - posted
  const fileName = String(opts.fileName || 'Imported.835').split(/[\\/]/).pop().slice(0, 120)
  const era = {
    id, fileName, source: opts.source || '835', fingerprint: parsed.fingerprint || null,
    traceNo: trace, payerName: parsed.meta?.payerName || '', paymentDate: date, bprAmount: parsed.meta?.bprAmount ?? null,
    hasPLB: !!parsed.meta?.hasPLB, warnings: preview.warnings, createdAt: at, status: parked ? (posted ? 'partial' : 'parked') : 'posted',
    lines: detail.length, matched: preview.rows.length - preview.rows.filter((r) => !r.claimId).length,
    unmatched: preview.rows.filter((r) => !r.claimId).length, posted, parked, detail,
  }
  return { ok: true, claimUpserts, payments, eraImports: { [id]: era }, era,
    msg: `ERA reviewed: ${posted} posted, ${parked} parked${era.hasPLB ? '. Provider level PLB not applied' : ''}` }
}

// Retry *only* explicitly chosen parked lines. The existing record is updated
// rather than importing its fingerprint again; old decisions remain auditable.
export function planParkedEraPost(state, eraId, selectedIds, opts = {}) {
  const era = (state.eraImports || {})[eraId]
  if (!era) return { ok: false, msg: 'ERA import no longer exists' }
  const parked = (era.detail || []).filter((d) => d.decision === 'parked')
  if (!Array.isArray(selectedIds) || !selectedIds.length || selectedIds.some((id) => !parked.some((d) => d.id === id))) return { ok: false, msg: 'Select parked lines to retry' }
  const parsed = {
    lines: parked.map((d) => ({ ...d })), errors: [], fingerprint: era.fingerprint,
    meta: { traceNo: era.traceNo, paymentDate: era.paymentDate, payerName: era.payerName },
  }
  const preview = previewEra(state, parsed, { ignoreEraId: eraId })
  if (preview.errors.length) return { ok: false, msg: preview.errors.join('; '), preview }
  const { selected, error } = selectedRows(preview, selectedIds)
  if (error) return { ok: false, msg: error, preview }
  const at = opts.at ?? Date.now()
  const makeId = opts.makeId || uid
  const claimUpserts = [], payments = {}
  const updates = new Map()
  for (const row of preview.rows) {
    if (selected.has(row.id)) {
      const applied = applyRow(row, era.id, era.traceNo, era.paymentDate, at, makeId, state)
      claimUpserts.push(applied.claim)
      if (applied.payment) {
        if (state.payments?.[applied.payment.id] || payments[applied.payment.id]) return { ok: false, msg: 'Payment identifier already exists', preview }
        payments[applied.payment.id] = applied.payment
      }
      updates.set(row.id, recordLine(row, 'posted'))
    } else if (!row.ready) updates.set(row.id, recordLine(row, 'parked', row.reason))
  }
  const detail = era.detail.map((d) => updates.get(d.id) || d)
  const posted = detail.filter((d) => d.decision === 'posted').length
  const nextEra = { ...era, detail, posted, parked: detail.length - posted, status: posted === detail.length ? 'posted' : posted ? 'partial' : 'parked' }
  return { ok: true, claimUpserts, payments, eraImports: { [era.id]: nextEra }, era: nextEra,
    msg: `ERA updated: ${selected.size} posted, ${nextEra.parked} still parked` }
}
