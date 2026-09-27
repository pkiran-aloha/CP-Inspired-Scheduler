// Guarded, claim-scoped manual remittances. The reducer calls these plans against
// *live* state so rapid repeat dispatches cannot duplicate money. Secondary receipts
// reduce the linked primary's balance exactly once; secondary adjustments do not
// silently write off the primary/patient balance.
import { dueOf, payPatch } from './claims'

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

export function planClaimPayment(state, id, payload = {}, { at = Date.now(), paymentId } = {}) {
  const claim = state.claims?.[id]
  if (!claim) return fail('Claim not found')
  if (!paymentId || state.payments?.[paymentId]) return fail('Payment identifier is missing or already in use')
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
    if (!parent || parent.secondary !== id || !open(parent) || parent.cobReviewNeeded ||
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
    msg: `${patched.no}${patched.status === 'paid' ? ' paid' : ''} — $${paid.toFixed(2)} posted${adjustment ? ` · $${adjustment.toFixed(2)} adjustment` : ''}${parent ? ' (linked primary updated)' : ''}` }
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
  if (payments.some((p) => p.clientId === client.id && !p.claimId && String(p.ref || '').toUpperCase() === ref.toUpperCase() && !p.reversalOf && !reversed.has(p.id))) return fail('This unapplied receipt reference already exists for the client')
  const payment = { id: paymentId, amount: amount / 100, adj: 0, patientResp: 0, clientId: client.id,
    payer: String(payload.payer || client.insurer || 'Unapplied'), date, method: payload.method || 'check',
    ref, note: payload.note || '', kind: 'unapplied', claimId: null, reversalOf: null, createdAt: at,
    reconciled: false, attachments: [], createdBy: 'Aloha (local)' }
  return { ok: true, payments: { [paymentId]: payment }, payment, msg: `Unapplied receipt ${ref} recorded for ${client.name} — not applied to a claim` }
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
    history: [...(claim.history || []), { at, ev: `Payment voided — $${pay.amount.toFixed(2)} reversed (${pay.ref})` }] }
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
    msg: `Payment ${pay.ref} voided — reversal posted${parent ? ' on both COB ledgers' : ''}` }
}
