// Manual COB workflow for a single primary/secondary pair. No network submission,
// service-line allocation or automatic secondary-835 application is implied.
import { dueOf, secondaryClaimPatch, secondaryEligible, patientLedgerMatches } from './claims'

export const SECONDARY_METHODS = { ch: 'clearinghouse', paper_bg: 'paper with primary remittance', paper_nobg: 'paper without background' }
const fail = (msg) => ({ ok: false, msg })
const r2 = (n) => Math.round(n * 100) / 100

// One-time, idempotent compatibility for saved workspaces made before secondary
// receipts reduced the primary. Never silently cap or invent a conflicting amount.
export function normalizeCobLedger(state) {
  let claims = state.claims || {}
  let changed = false
  for (const child of Object.values(claims)) {
    if (child.method !== 'secondary' || child.status === 'void') continue
    const parent = claims[child.secondary]
    if (!parent || parent.secondary !== child.id) continue
    const paid = r2(child.paid || 0)
    if (parent.secondaryPaid == null && paid > 0 && paid <= dueOf(parent)) {
      const balance = r2(dueOf(parent) - paid)
      const at = Date.now()
      claims = { ...claims, [parent.id]: { ...parent, secondaryPaid: paid,
        status: balance <= 0 ? 'paid' : 'partially_paid', closedAt: balance <= 0 ? at : null,
        history: [...(parent.history || []), { at, ev: `Legacy COB receipt $${paid.toFixed(2)} reconciled from ${child.no}` }] } }
      changed = true
    } else if (paid > 0 && (parent.secondaryPaid == null || r2(parent.secondaryPaid) !== paid) && !parent.cobReviewNeeded) {
      claims = { ...claims, [parent.id]: { ...parent, cobReviewNeeded: true } }
      changed = true
    }
  }
  return changed ? { ...state, claims } : state
}

export function planSecondaryFiling(state, id, { submit = false, method = 'ch', at = Date.now(), newId } = {}) {
  if (submit && !SECONDARY_METHODS[method]) return fail('Choose a supported manual filing method')
  const claim = state.claims?.[id]
  if (!claim) return fail('Claim not found')
  if (claim.method === 'secondary') {
    if (!submit || claim.status !== 'draft') return fail('Only a secondary draft can be marked submitted')
    const parent = state.claims?.[claim.secondary]
    const coverage = (state.clients || []).find((c) => c.id === claim.clientId)?.secondary
    const payer = (state.payers || []).find((p) => p.id === coverage?.payerId)
    if (!parent || parent.cobReviewNeeded || !patientLedgerMatches(state, parent) || (parent.patientPaid || 0) > 0 ||
        parent.method === 'secondary' || parent.status !== 'partially_paid' || parent.secondary !== claim.id ||
        dueOf(parent) <= 0 || r2(claim.charges) !== dueOf(parent) || claim.paid || claim.adj ||
        !payer || (payer.status && payer.status !== 'active') || payer.name !== claim.payer || !coverage?.memberId?.trim() ||
        (coverage.since && parent.dosFrom < coverage.since) || (coverage.until && parent.dosTo > coverage.until)) {
      return fail('Primary balance, COB coverage or links changed; review before recording a filing')
    }
    const filed = { ...claim, status: 'submitted', submittedAt: at, submitMethod: method,
      history: [...(claim.history || []), { at, ev: `Manual ${SECONDARY_METHODS[method]} filing recorded. Not transmitted by Aloha.` }] }
    return { ok: true, claimUpserts: [filed], secondaryId: filed.id,
      msg: `${filed.no} recorded as filed via ${SECONDARY_METHODS[method]} (no network transmission)` }
  }
  if (!secondaryEligible(state, claim)) return fail('Primary is not eligible: check balance, secondary coverage and existing filings')
  const past = Object.values(state.claims || {}).filter((c) => c.method === 'secondary' && c.secondary === id)
  const sequence = Math.max(0, ...past.map((c) => Number(c.no?.match(/-S(\d+)$/)?.[1]) || 1)) + 1
  const pair = secondaryClaimPatch(state, claim, { id: newId, at, sequence })
  if (!pair || state.claims?.[pair.secondary.id] || Object.values(state.claims || {}).some((c) => c.no === pair.secondary.no)) return fail('A secondary identifier already exists')
  if (submit) {
    pair.secondary = { ...pair.secondary, status: 'submitted', submittedAt: at, submitMethod: method,
      history: [...pair.secondary.history, { at, ev: `Manual ${SECONDARY_METHODS[method]} filing recorded. Not transmitted by Aloha.` }] }
  }
  return { ok: true, claimUpserts: [pair.primary, pair.secondary], secondaryId: pair.secondary.id,
    msg: submit
      ? `${pair.secondary.no} recorded as filed via ${SECONDARY_METHODS[method]} (no network transmission)`
      : `${pair.secondary.no} drafted for ${pair.secondary.payer}: $${pair.secondary.charges.toFixed(2)} to review` }
}

export function planSecondarySkip(state, id, { at = Date.now() } = {}) {
  const claim = state.claims?.[id]
  if (!secondaryEligible(state, claim)) return fail('Only an eligible, unfiled primary balance can be skipped')
  return { ok: true, claimUpserts: [{ ...claim, secondarySkipped: true,
    history: [...(claim.history || []), { at, ev: 'Secondary filing skipped. The remaining balance was not reassigned.' }] }],
  msg: `${claim.no} secondary filing skipped; outstanding balance still requires review` }
}

export function planSecondaryCancel(state, id, { at = Date.now() } = {}) {
  const child = state.claims?.[id]
  const parent = child?.method === 'secondary' && state.claims?.[child.secondary]
  if (!parent || parent.secondary !== id || !['draft', 'submitted'].includes(child.status)) return fail('Only an open, linked secondary filing can be cancelled')
  if (child.paid || child.adj || Object.values(state.payments || {}).some((p) => p.claimId === id)) {
    return fail('Secondary has remittance history; void or resolve it before cancelling')
  }
  const cancelled = { ...child, status: 'void', closedAt: at, history: [...(child.history || []), { at, ev: 'Secondary filing cancelled; no payer transmission by Aloha' }] }
  const reopened = { ...parent, secondary: null, history: [...(parent.history || []), { at, ev: `Secondary filing ${child.no} cancelled` }] }
  return { ok: true, claimUpserts: [reopened, cancelled], msg: `${child.no} cancelled locally. This does not retract any external payer filing.` }
}
