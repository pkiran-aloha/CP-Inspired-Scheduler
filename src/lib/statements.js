// ---- Client statements: what a family owes, issued as a numbered record with history ----
// A statement freezes the family's share on the day it is issued (one line per claim). Its
// balance afterwards is live: patient receipts recorded in the Payment Center reduce it, and
// it reads "Paid" once nothing on its claims is still owed. Nothing is mailed or emailed:
// "mark sent" records how the practice delivered it.
import { isPrimaryReceivable, patientResponsibilityOf } from './claims'
import { docToPdf } from './intakeDocs'

const r2 = (n) => Math.round(n * 100) / 100
const money = (n) => `$${(Number(n) || 0).toFixed(2)}`
export const SEND_METHODS = [
  { id: 'mail', label: 'Mailed' },
  { id: 'hand', label: 'Handed to the family' },
  { id: 'email', label: "Emailed from the practice's own email" },
  { id: 'portal', label: "Posted to the practice's own portal" },
]

/** The family's share still owed on each primary claim (payer-reported share or self-pay). */
export function statementLines(state, clientId) {
  return Object.values(state.claims || {})
    .filter((c) => c.clientId === clientId && isPrimaryReceivable(c))
    .map((c) => ({ claimId: c.id, claimNo: c.no, dosFrom: c.dosFrom, dosTo: c.dosTo, payer: c.payer, charges: c.charges, due: r2(patientResponsibilityOf(state, c)) }))
    .filter((l) => l.due > 0)
    .sort((a, b) => (a.dosFrom < b.dosFrom ? -1 : 1))
}

/** Live balance of an issued statement: what is still owed on its claims, capped at the issued amount. */
export function statementBalance(state, st) {
  const owed = st.lines.reduce((t, l) => {
    const c = state.claims?.[l.claimId]
    return t + (c ? Math.min(l.due, patientResponsibilityOf(state, c)) : 0)
  }, 0)
  return r2(owed)
}

export function statementStatus(state, st) {
  if (st.status === 'void') return 'void'
  if (statementBalance(state, st) <= 0) return 'paid'
  return st.sentAt ? 'sent' : 'issued'
}

const nextNo = (state, at) => {
  const ym = new Date(at).toISOString().slice(0, 7).replace('-', '')
  const n = Object.values(state.statements || {}).filter((s) => String(s.no || '').startsWith(`STM-${ym}-`)).length + 1
  return `STM-${ym}-${String(n).padStart(3, '0')}`
}

export function planStatement(state, clientId, { id, at = Date.now(), by = null } = {}) {
  const client = (state.clients || []).find((c) => c.id === clientId)
  if (!client) return { ok: false, msg: 'Client not found.' }
  if (!id) return { ok: false, msg: 'Statement id missing.' }
  const lines = statementLines(state, clientId)
  if (!lines.length) return { ok: false, msg: `${client.name} owes nothing right now, so there is nothing to put on a statement.` }
  const total = r2(lines.reduce((t, l) => t + l.due, 0))
  const no = nextNo(state, at)
  const item = { id, no, clientId, at, lines, total, status: 'issued', sentAt: null, sentVia: null, history: [{ at, by, ev: `Issued for ${money(total)} across ${lines.length} claim${lines.length > 1 ? 's' : ''}` }] }
  return { ok: true, msg: `${no} issued to ${client.name} for ${money(total)}. Download the PDF to print or send it yourself.`, item }
}

export function planStatementSent(state, id, { via, at = Date.now(), by = null } = {}) {
  const st = state.statements?.[id]
  if (!st) return { ok: false, msg: 'Statement not found.' }
  if (st.status === 'void') return { ok: false, msg: `${st.no} is void.` }
  const method = SEND_METHODS.find((m) => m.id === via)
  if (!method) return { ok: false, msg: 'Choose how the statement was delivered.' }
  return { ok: true, msg: `${st.no} marked as sent (${method.label.toLowerCase()}). The app did not send anything.`, item: { ...st, sentAt: at, sentVia: via, history: [...st.history, { at, by, ev: `Marked sent: ${method.label}` }] } }
}

export function planStatementVoid(state, id, { at = Date.now(), by = null, reason = '' } = {}) {
  const st = state.statements?.[id]
  if (!st) return { ok: false, msg: 'Statement not found.' }
  if (st.status === 'void') return { ok: false, msg: `${st.no} is already void.` }
  const why = String(reason || '').trim()
  if (why.length < 3) return { ok: false, msg: 'Give a reason for voiding the statement.' }
  return { ok: true, msg: `${st.no} voided. Its claims are unchanged.`, item: { ...st, status: 'void', history: [...st.history, { at, by, ev: `Voided: ${why}` }] } }
}

/** Printable statement for the family. */
export function statementDoc(state, st) {
  const org = state.settings?.org || {}
  const client = (state.clients || []).find((c) => c.id === st.clientId) || {}
  const balance = statementBalance(state, st)
  return {
    title: `${org.name || 'Practice'} · Statement ${st.no}`,
    subtitle: [org.address, org.phone].filter(Boolean).join(' · '),
    note: `Statement for ${client.name || 'client'} issued ${new Date(st.at).toISOString().slice(0, 10)}. Amounts are the family's share reported by the payer, or the full charge for self-pay services.`,
    sections: [
      { heading: 'Account', rows: [
        { label: 'Client', value: client.name || '—' }, { label: 'Guardian', value: client.guardian || '—' },
        { label: 'Statement total', value: money(st.total) }, { label: 'Balance now', value: money(balance) },
        ...(st.status === 'void' ? [{ label: 'Status', value: 'VOID' }] : []),
      ] },
      { heading: 'Services', rows: st.lines.map((l) => ({ label: `${l.claimNo} · ${l.dosFrom}${l.dosTo && l.dosTo !== l.dosFrom ? ` → ${l.dosTo}` : ''}`, value: `${l.payer} · charges ${money(l.charges)} · your share ${money(l.due)}` })) },
      { heading: 'How to pay', rows: [{ label: 'Questions', value: [org.phone, org.email].filter(Boolean).join(' · ') || 'Contact the practice' }] },
    ],
  }
}
export const statementPdf = (state, st) => docToPdf(statementDoc(state, st))
