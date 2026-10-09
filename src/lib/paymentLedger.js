// Guarded, claim-scoped manual remittances. The reducer calls these plans against
// *live* state so rapid repeat dispatches cannot duplicate money. Secondary receipts
// reduce the linked primary's balance exactly once; secondary adjustments do not
// silently write off the primary/patient balance.
import { dueOf, payPatch, patientLedgerMatches, patientResponsibilityOf, PATIENT_AR_BUCKET } from './claims'

const r2 = (n) => Math.round(n * 100) / 100
const fail = (msg) => ({ ok: false, msg })
const cents = (value) => {
  if (typeof value === 'string' && !/^\d+(?:\.\d{1,2})?$/.test(value.trim())) return null
  const n = Number(value)
  return Number.isFinite(n) && n >= 0 && Number.isSafeInteger(Math.round(n * 100)) &&
    Math.abs(n * 100 - Math.round(n * 100)) < 0.000001 ? Math.round(n * 100) : null
}
const open = (claim) => claim && ['submitted', 'partially_paid'].includes(claim.status)
const validDate = (date) => /^\d{4}-\d{2}-\d{2}$/.test(date) &&
  !Number.isNaN(Date.parse(`${date}T12:00:00Z`)) && new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10) === date
const activeRef = (state, id, ref) => {
  const payments = Object.values(state.payments || {})
  const reversed = new Set(payments.map((p) => p.reversalOf).filter(Boolean))
  return payments.some((p) => p.claimId === id && String(p.ref || '').toUpperCase() === ref.toUpperCase() && !p.reversalOf && !reversed.has(p.id))
}
const claimIsLinked = (state, claim) => claim.secondary && state.claims?.[claim.secondary] && state.claims[claim.secondary].status !== 'void'
const activePatientRef = (state, clientId, ref) => {
  const payments = Object.values(state.payments || {})
  const reversed = new Set(payments.map((p) => p.reversalOf).filter(Boolean))
  return payments.some((p) => p.clientId === clientId && ['patient', 'unapplied'].includes(p.kind) &&
    !p.reversalOf && !reversed.has(p.id) && String(p.ref || '').trim().toUpperCase() === ref.toUpperCase())
}
const invoicePatch = (state, claim, at) => {
  if (claim.mode !== 'selfpay') return {}
  return Object.fromEntries(Object.values(state.invoices || {}).filter((inv) => inv.claimId === claim.id && inv.status !== 'void').map((inv) =>
    [inv.id, { ...inv, due: Math.max(0, dueOf(claim)), status: dueOf(claim) <= 0 ? 'paid' : 'open', updatedAt: at }]))
}

export function planClaimPayment(state, id, payload = {}, { at = Date.now(), paymentId } = {}) {
  const claim = state.claims?.[id]
  if (!claim) return fail('Claim not found')
  if (!paymentId || state.payments?.[paymentId]) return fail('Payment identifier is missing or already in use')
  if (payload.kind && !['writeoff', 'manual', 'check'].includes(payload.kind)) return fail('Use the dedicated patient receipt or ERA workflow for this payment type')
  if (claim.patientPaid || (claim.method === 'secondary' && state.claims?.[claim.secondary]?.patientPaid)) {
    return fail('Patient receipts are already allocated. Reverse them locally before changing the payer remittance; any real refund must be handled separately.')
  }
  if (claim.method !== 'secondary' && !patientLedgerMatches(state, claim)) return fail('Patient receipt ledger does not reconcile; review before posting')
  const hasPatientReport = payload.patientResp != null && String(payload.patientResp).trim() !== ''
  const amount = cents(payload.amount), adj = cents(payload.adj ?? 0), patientResp = hasPatientReport ? cents(payload.patientResp) : 0
  if (!open(claim) && !(claim.status === 'denied' && payload.kind === 'writeoff' && amount === 0 && adj > 0)) {
    return fail('Only an open claim or a documented denial write-off can be posted')
  }
  if ([amount, adj, patientResp].some((v) => v === null)) return fail('Enter non-negative amounts with at most two decimal places')
  if (!amount && !adj) return fail('Enter a payment or an adjustment to post')
  const outstanding = cents(dueOf(claim))
  if (outstanding === null || !outstanding || amount + adj > outstanding) return fail('Payment and adjustment exceed the open claim balance')
  if (patientResp > outstanding - amount - adj) return fail('Patient responsibility exceeds the remaining balance')
  const method = payload.method || 'check'
  if (!['check', 'eft', 'era', 'cash', 'card'].includes(method) ||
      (claim.mode === 'insurance' && ['cash', 'card'].includes(method))) return fail('Use check, EFT or manually recorded ERA for an insurance remittance')
  const ref = String(payload.checkNo ?? payload.ref ?? '').trim()
  if (!ref) return fail('A payment reference is required')
  if (activeRef(state, id, ref)) return fail('This reference has already been posted to the claim')
  const date = payload.date || new Date(at).toISOString().slice(0, 10)
  if (!validDate(date)) return fail('Enter a valid payment date')
  if (!amount && adj && !String(payload.note || '').trim()) return fail('Explain adjustment-only postings in the note')

  let parent = null
  if (claim.method === 'secondary') {
    parent = state.claims?.[claim.secondary]
    if (!parent || parent.secondary !== id || !open(parent) || parent.cobReviewNeeded || !patientLedgerMatches(state, parent) ||
        cents(parent.secondaryPaid || 0) !== cents(claim.paid || 0)) return fail('Linked primary COB ledger does not reconcile; review it before posting')
    const parentDue = cents(dueOf(parent))
    if (parentDue === null || amount > parentDue) return fail('Secondary payer amount exceeds the remaining primary balance')
  } else if (claimIsLinked(state, claim)) {
    return fail('A secondary filing is linked. Review or cancel it before changing the primary payment.')
  }
  const paid = amount / 100, adjustment = adj / 100, patient = patientResp / 100
  const nextAdj = r2((claim.adj || 0) + adjustment)
  const result = payPatch(claim, { amount: paid, adj: nextAdj, checkNo: ref, note: payload.note || '', paidAt: at }).claim
  const patched = { ...result, remittance: { ...result.remittance, patientResp: hasPatientReport ? patient : (claim.remittance?.patientResp ?? null) } }
  const claimUpserts = [patched]
  if (parent) {
    const nextPaid = r2((parent.secondaryPaid || 0) + paid)
    const remaining = r2(parent.charges - (parent.paid || 0) - (parent.adj || 0) - nextPaid)
    claimUpserts.push({ ...parent, secondaryPaid: nextPaid, status: remaining <= 0 ? 'paid' : 'partially_paid',
      closedAt: remaining <= 0 ? at : null,
      history: [...(parent.history || []), { at, ev: `${patched.no} secondary remittance $${paid.toFixed(2)} received; $${Math.max(0, remaining).toFixed(2)} remains on primary` }] })
  }
  const payment = { id: paymentId, claimId: id, parentClaimId: parent?.id || null,
    clientId: claim.clientId, payer: claim.payer, amount: paid, adj: adjustment, patientResp: hasPatientReport ? patient : null,
    ref, date, method, kind: payload.kind || (ref.toUpperCase().startsWith('CHK') ? 'check' : 'manual'),
    note: payload.note || '', reconciled: !!payload.reconciled, attachments: [], source: payload.source || null,
    reversalOf: null, createdAt: at, createdBy: 'Aloha (local)' }
  return { ok: true, claimUpserts, payments: { [paymentId]: payment }, payment,
    msg: `${patched.no}${patched.status === 'paid' ? ' paid' : ''}: $${paid.toFixed(2)} posted${adjustment ? `, $${adjustment.toFixed(2)} adjustment` : ''}${parent ? ' (linked primary updated)' : ''}` }
}

// Patient cash belongs to the primary receivable, even when a secondary filing
// supplied the PR report. Never write it to payer-paid or the child's remittance.
// This records money already received elsewhere; it does not charge a card.
export function planPatientReceipt(state, id, payload = {}, { at = Date.now(), paymentId } = {}) {
  const claim = state.claims?.[id]
  if (!claim || claim.method === 'secondary' || !open(claim) || claim.cobReviewNeeded) {
    return fail('Select an open primary claim with a reviewed patient balance')
  }
  if (payload.clientId && payload.clientId !== claim.clientId) return fail('The selected client does not own this claim')
  if (!(state.clients || []).some((client) => client.id === claim.clientId)) return fail('Claim client is missing; review before collecting')
  if (!paymentId || state.payments?.[paymentId]) return fail('Receipt identifier is missing or already in use')
  if (!patientLedgerMatches(state, claim)) return fail('Patient receipt ledger does not reconcile; review before posting')
  const amount = cents(payload.amount)
  const patientDue = cents(patientResponsibilityOf(state, claim))
  if (amount === null || amount <= 0) return fail('Enter a positive amount with at most two decimal places')
  if (patientDue === null || !patientDue) return fail('No documented, collectible patient share is available on this claim')
  if (amount > patientDue) return fail('Patient receipt exceeds the remaining reported patient share')
  const method = payload.method || 'check'
  if (!['check', 'eft', 'cash', 'card'].includes(method)) return fail('Choose a patient receipt method (not ERA)')
  const ref = String(payload.ref || '').trim()
  if (!ref) return fail('A receipt reference is required')
  if (activeRef(state, id, ref) || activePatientRef(state, claim.clientId, ref)) {
    return fail('This active receipt reference is already recorded for the claim or client')
  }
  const date = payload.date || new Date(at).toISOString().slice(0, 10)
  if (!validDate(date)) return fail('Enter a valid receipt date')
  const linked = state.claims?.[claim.secondary]
  const reportSource = linked?.method === 'secondary' && linked.secondary === id && linked.status !== 'void' ? linked : claim
  const paid = amount / 100
  const updated = { ...claim, patientPaid: r2((claim.patientPaid || 0) + paid),
    history: [...(claim.history || []), { at, ev: `Patient receipt $${paid.toFixed(2)} recorded locally (${ref}); no card charge or bank reconciliation` }] }
  const balance = dueOf(updated)
  updated.status = balance <= 0 ? 'paid' : 'partially_paid'
  updated.closedAt = balance <= 0 ? at : null
  const payment = { id: paymentId, claimId: id, patientSourceClaimId: reportSource.id,
    clientId: claim.clientId, payer: PATIENT_AR_BUCKET, amount: paid, adj: 0, patientResp: null,
    ref, date, method, kind: 'patient', note: String(payload.note || '').trim(),
    reconciled: false, attachments: [], reversalOf: null, createdAt: at, createdBy: 'Aloha (local)' }
  const invoices = invoicePatch(state, updated, at)
  return { ok: true, claimUpserts: [updated], payments: { [paymentId]: payment }, invoices, payment,
    msg: `Patient receipt ${ref}: $${paid.toFixed(2)} recorded for ${claim.no}. $${Math.max(0, balance).toFixed(2)} remains in practice A/R.` }
}

export function planUnappliedReceipt(state, payload = {}, { at = Date.now(), paymentId } = {}) {
  if (payload.claimId) return fail('An unapplied receipt cannot name a claim')
  if (!paymentId || state.payments?.[paymentId]) return fail('Payment identifier is missing or already in use')
  const amount = cents(payload.amount)
  if (amount === null || amount <= 0) return fail('Enter a positive amount with at most two decimal places')
  const client = (state.clients || []).find((c) => c.id === payload.clientId)
  if (!client) return fail('Select a valid client')
  if (!['check', 'eft', 'era', 'cash', 'card'].includes(payload.method || 'check')) return fail('Choose a valid receipt method')
  const ref = String(payload.ref || '').trim()
  if (!ref) return fail('A receipt reference is required')
  const date = payload.date || new Date(at).toISOString().slice(0, 10)
  if (!validDate(date)) return fail('Enter a valid receipt date')
  const payments = Object.values(state.payments || {})
  const reversed = new Set(payments.map((p) => p.reversalOf).filter(Boolean))
  if (payments.some((p) => p.clientId === client.id && !p.claimId && String(p.ref || '').toUpperCase() === ref.toUpperCase() && !p.reversalOf && !reversed.has(p.id)) ||
      activePatientRef(state, client.id, ref)) return fail('This receipt reference is already active for the client')
  const payment = { id: paymentId, amount: amount / 100, adj: 0, patientResp: 0, clientId: client.id,
    payer: String(payload.payer || client.insurer || 'Unapplied'), date, method: payload.method || 'check',
    ref, note: payload.note || '', kind: 'unapplied', claimId: null, reversalOf: null, createdAt: at,
    reconciled: false, attachments: [], createdBy: 'Aloha (local)' }
  return { ok: true, payments: { [paymentId]: payment }, payment, msg: `Unapplied receipt ${ref} recorded for ${client.name}. Not applied to a claim.` }
}

// An exportable local audit trail, not proof of a bank deposit or a refund.
// Keep signed reversals and the claim that documented the original PR.
export function buildPatientReceiptAudit(state) {
  const payments = Object.values(state.payments || {}).filter((p) => p.kind === 'patient')
    .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0) || String(a.id).localeCompare(String(b.id)))
  const reversed = new Set(payments.map((p) => p.reversalOf).filter(Boolean))
  const csv = (value) => {
    const text = String(value ?? '')
    const safe = /^\s*[=+@-]/.test(text) ? `'${text}` : text
    return `"${safe.replace(/"/g, '""')}"`
  }
  return [
    '# Local patient receipt audit only. No card processing, bank reconciliation or refund confirmation',
    'payment_id,claim,source_remittance_claim,client,client_id,date,recorded_at,kind,method,reference,amount,reversal_of,note,local_status',
    ...payments.map((p) => [
      p.id, state.claims?.[p.claimId]?.no || p.claimId,
      state.claims?.[p.patientSourceClaimId]?.no || p.patientSourceClaimId,
      (state.clients || []).find((c) => c.id === p.clientId)?.name || p.clientId,
      p.clientId, p.date, Number.isFinite(p.createdAt) ? new Date(p.createdAt).toISOString() : '',
      p.reversalOf ? 'local_reversal' : 'patient_receipt', p.method, p.ref,
      Number(p.amount).toFixed(2), p.reversalOf || '', p.note || '',
      p.reversalOf ? 'reversed_locally' : reversed.has(p.id) ? 'reversed' : 'active',
    ].map((v, i) => i === 10 ? v : csv(v)).join(',')),
  ].join('\n')
}

export function planVoidClaimPayment(state, paymentId, { at = Date.now(), reversalId } = {}) {
  const pay = state.payments?.[paymentId]
  if (!pay) return fail('Payment not found')
  if (pay.reversalOf || Object.values(state.payments || {}).some((p) => p.reversalOf === paymentId)) return fail('Payment already voided')
  if (pay.eraId) return fail('Imported ERA remittances cannot be voided independently of the ERA review')
  if (!reversalId || state.payments?.[reversalId]) return fail('Reversal identifier is missing or already in use')
  if (!pay.claimId) {
    if (pay.kind !== 'unapplied' || cents(pay.amount) === null || pay.amount <= 0) return fail('Receipt cannot be safely reversed')
    const reversal = { ...pay, id: reversalId, amount: r2(-pay.amount), ref: `VOID-${pay.ref}`,
      date: new Date(at).toISOString().slice(0, 10), reversalOf: pay.id, reconciled: false,
      note: `Reversal of unapplied receipt ${pay.ref}`, createdAt: at }
    return { ok: true, claimUpserts: [], payments: { [reversalId]: reversal }, reversal,
      msg: `Unapplied receipt ${pay.ref} reversed` }
  }
  const claim = state.claims?.[pay.claimId]
  if (!claim) return fail('Claim not found')
  if (pay.kind === 'patient') {
    if (claim.method === 'secondary' || claim.status === 'void' || !patientLedgerMatches(state, claim) ||
        cents(pay.amount) === null || pay.amount <= 0 || cents(claim.patientPaid || 0) < cents(pay.amount)) {
      return fail('Patient receipt no longer reconciles with the primary; review before reversing')
    }
    const updated = { ...claim, patientPaid: r2((claim.patientPaid || 0) - pay.amount),
      history: [...(claim.history || []), { at, ev: `Patient receipt ${pay.ref} reversed in this app: $${pay.amount.toFixed(2)}. No bank refund issued.` }] }
    const balance = dueOf(updated)
    updated.status = balance <= 0 ? 'paid' : (updated.paid || updated.secondaryPaid || updated.patientPaid || updated.adj) ? 'partially_paid' : updated.submittedAt ? 'submitted' : 'draft'
    updated.closedAt = balance <= 0 ? claim.closedAt || at : null
    const reversal = { ...pay, id: reversalId, amount: r2(-pay.amount), ref: `VOID-${pay.ref}`,
      date: new Date(at).toISOString().slice(0, 10), reversalOf: pay.id, reconciled: false,
      note: `Local reversal of patient receipt ${pay.ref}; refund not issued`, createdAt: at }
    return { ok: true, claimUpserts: [updated], payments: { [reversalId]: reversal }, invoices: invoicePatch(state, updated, at), reversal,
      msg: `Patient receipt ${pay.ref} reversed in this app. No refund or bank transaction was made.` }
  }
  const parentClaim = claim.method === 'secondary' ? state.claims?.[claim.secondary] : claim
  if ((parentClaim?.patientPaid || 0) > 0) return fail('Reverse allocated patient receipts locally before changing their payer remittance')
  if (parentClaim && !patientLedgerMatches(state, parentClaim)) return fail('Patient receipt ledger does not reconcile; review before voiding')
  if (claim.method !== 'secondary' && claimIsLinked(state, claim)) return fail('Cancel or resolve the linked secondary filing before voiding a primary remittance')
  const amount = cents(pay.amount), adj = cents(pay.adj || 0), patientResp = cents(pay.patientResp || 0)
  if ([amount, adj, patientResp].some((v) => v === null) || amount > cents(claim.paid || 0) || adj > cents(claim.adj || 0)) {
    return fail('Payment no longer reconciles to the claim; review its ledger before voiding')
  }
  let parent = null
  if (claim.method === 'secondary') {
    parent = state.claims?.[claim.secondary]
    if (!parent || parent.secondary !== claim.id || parent.cobReviewNeeded ||
        cents(parent.secondaryPaid || 0) !== cents(claim.paid || 0) || amount > cents(parent.secondaryPaid || 0)) {
      return fail('Linked primary no longer reconciles to the secondary remittance')
    }
  }
  const remainingPaid = r2((claim.paid || 0) - pay.amount)
  const remainingAdj = r2((claim.adj || 0) - (pay.adj || 0))
  const newDue = r2(claim.charges - remainingPaid - remainingAdj)
  const status = claim.status === 'denied' ? 'denied' : newDue <= 0 ? 'paid' :
    remainingPaid || remainingAdj ? 'partially_paid' : claim.submittedAt ? 'submitted' : 'draft'
  const patched = { ...claim, paid: remainingPaid, adj: remainingAdj, status,
    closedAt: status === 'paid' ? claim.closedAt : null,
    remittance: claim.remittance?.checkNo === pay.ref ? null : claim.remittance,
    history: [...(claim.history || []), { at, ev: `Payment voided: $${pay.amount.toFixed(2)} reversed (${pay.ref})` }] }
  const claimUpserts = [patched]
  if (parent) {
    const nextPaid = r2((parent.secondaryPaid || 0) - pay.amount)
    const parentDue = r2(parent.charges - (parent.paid || 0) - (parent.adj || 0) - nextPaid)
    claimUpserts.push({ ...parent, secondaryPaid: nextPaid, status: parentDue <= 0 ? 'paid' : 'partially_paid',
      closedAt: parentDue <= 0 ? parent.closedAt : null,
      history: [...(parent.history || []), { at, ev: `${claim.no} remittance ${pay.ref} reversed; $${Math.max(0, parentDue).toFixed(2)} open` }] })
  }
  const reversal = { ...pay, id: reversalId, amount: r2(-pay.amount), adj: r2(-(pay.adj || 0)),
    patientResp: pay.patientResp == null ? null : r2(-pay.patientResp), ref: `VOID-${pay.ref}`, date: new Date(at).toISOString().slice(0, 10),
    reversalOf: pay.id, reconciled: false, note: `Reversal of ${pay.ref}`, createdAt: at }
  return { ok: true, claimUpserts, payments: { [reversalId]: reversal }, reversal,
    msg: `Payment ${pay.ref} voided. Reversal posted${parent ? ' on both COB ledgers' : ''}.` }
}

// ---------- recoupments: the payer takes money back on a claim it already paid ----------
// A recoupment is not a void (the original remittance stays on file, it was real) and
// not a write-off: it reduces what the payer has paid, so the claim's balance reopens
// for rebilling, appeal or a patient decision. Recorded as its own negative ledger line
// with the payer's reference, so it can be matched against the ERA/PLB or refund letter.
export const RECOUP_REASONS = [
  { id: 'overpayment', label: 'Overpayment / paid in error' },
  { id: 'duplicate', label: 'Duplicate payment' },
  { id: 'eligibility', label: 'Retro eligibility / termed coverage' },
  { id: 'cob', label: 'Coordination of benefits: other payer is primary' },
  { id: 'audit', label: 'Audit / medical-record review' },
  { id: 'auth', label: 'No or invalid authorization' },
  { id: 'other', label: 'Other (see note)' },
]
export const RECOUP_METHODS = [
  { id: 'offset', label: 'Offset from a later remittance (ERA / PLB WO)' },
  { id: 'refund', label: 'Refund check sent to the payer' },
]

export function planRecoupment(state, id, payload = {}, { at = Date.now(), paymentId } = {}) {
  const claim = state.claims?.[id]
  if (!claim) return fail('Claim not found')
  if (claim.mode === 'selfpay') return fail('Self-pay invoices have no payer to recoup. Reverse the receipt instead.')
  if (claim.method === 'secondary') return fail('Secondary recoupments are not supported here. Record them on the secondary payer’s remittance outside Aloha.')
  if (claim.status === 'void') return fail('A void claim has nothing to recoup')
  if (claimIsLinked(state, claim)) return fail('Resolve or cancel the linked secondary filing before recording a recoupment on the primary')
  const amount = cents(payload.amount)
  if (amount === null || amount <= 0) return fail('Enter the recouped amount in dollars and cents')
  if (amount > cents(claim.paid || 0)) return fail(`The payer only paid $${r2(claim.paid || 0).toFixed(2)} on this claim. A recoupment cannot exceed that.`)
  const ref = String(payload.ref || '').trim()
  if (ref.length < 3) return fail('Add the payer’s reference (letter, ERA trace or PLB number) so the take-back can be matched')
  if (activeRef(state, id, ref)) return fail(`Reference ${ref} is already on this claim’s ledger`)
  const date = String(payload.date || '')
  if (!validDate(date)) return fail('Enter the date the payer recouped the money')
  if (date > new Date(at).toISOString().slice(0, 10)) return fail('The recoupment date cannot be in the future')
  if (!RECOUP_REASONS.some((r) => r.id === payload.reason)) return fail('Pick why the payer recouped')
  if (!RECOUP_METHODS.some((m) => m.id === payload.method)) return fail('Pick how the money went back to the payer')
  if (!paymentId || state.payments?.[paymentId]) return fail('Recoupment identifier is missing or already in use')
  const reasonLabel = RECOUP_REASONS.find((r) => r.id === payload.reason).label
  const dollars = r2(amount / 100)
  const updated = {
    ...claim,
    paid: r2((cents(claim.paid || 0) - amount) / 100),
    recouped: r2((cents(claim.recouped || 0) + amount) / 100),
    history: [...(claim.history || []), { at, ev: `Recouped by ${claim.payer}: $${dollars.toFixed(2)} (${reasonLabel}, ref ${ref}). Balance reopened.` }],
  }
  const balance = dueOf(updated)
  updated.status = balance <= 0 ? 'paid' : (updated.paid || updated.secondaryPaid || updated.patientPaid || updated.adj) ? 'partially_paid' : updated.submittedAt ? 'submitted' : 'draft'
  updated.closedAt = balance <= 0 ? claim.closedAt || at : null
  const entry = {
    id: paymentId, kind: 'recoupment', claimId: id, clientId: claim.clientId, payer: claim.payer,
    amount: r2(-dollars), ref, date, reason: payload.reason, method: payload.method,
    note: String(payload.note || '').trim().slice(0, 500), reconciled: false, createdAt: at,
  }
  return { ok: true, claimUpserts: [updated], payments: { [paymentId]: entry }, invoices: invoicePatch(state, updated, at), entry,
    msg: `Recoupment of $${dollars.toFixed(2)} recorded on ${claim.no}. $${r2(balance).toFixed(2)} is open again for rebilling or appeal.` }
}
