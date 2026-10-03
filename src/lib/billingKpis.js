// ---- Billing KPIs for the dashboard: revenue-cycle health from the claims ledger ----
//
// Every figure is arithmetic over this workspace's claims and payments, and each tile
// carries its formula (`help`) so a biller can check the number instead of trusting it.
// Rates compare against the previous equal window; point-in-time figures (A/R, DSO)
// have no delta. Self-pay invoices are left out of claim-quality rates.
// Pure: no React, no store.

import { arOf, dueOf, isPrimaryReceivable } from './claims'
import { addDays, isoDate, parseISO } from './date'

const isoOf = (t) => (t ? isoDate(new Date(t)) : '')
const pct = (n, d) => (d ? Math.round((n / d) * 100) : 0)
const r2 = (n) => Math.round(n * 100) / 100
const deniedEver = (c) => c.status === 'denied' || Boolean(c.denial) || (c.history || []).some((h) => /^Denied/.test(h.ev || ''))

function windowFigures(state, days) {
  const set = new Set(days)
  const claims = Object.values(state.claims || {}).filter((c) => c.status !== 'void' && c.mode !== 'selfpay' && c.method !== 'secondary')
  const submitted = claims.filter((c) => set.has(isoOf(c.submittedAt)))
  const denied = submitted.filter(deniedEver)
  const clean = submitted.filter((c) => !deniedEver(c) && !(c.version > 1))
  const lag = submitted.filter((c) => c.dosTo).map((c) => Math.max(0, Math.round((new Date(c.submittedAt) - parseISO(c.dosTo)) / 86400000)))
  // net collection: what was collected on claims for services in this window, against what was collectible
  const served = claims.filter((c) => c.status !== 'draft' && set.has(c.dosTo))
  const collected = served.reduce((t, c) => t + (c.paid || 0) + (c.secondaryPaid || 0) + (c.patientPaid || 0), 0)
  const collectible = served.reduce((t, c) => t + Math.max(0, (c.charges || 0) - (c.adj || 0)), 0)
  const pays = Object.values(state.payments || {}).filter((p) => set.has(p.date) && p.kind !== 'writeoff')
  return {
    submitted: submitted.length,
    charges: r2(submitted.reduce((t, c) => t + (c.charges || 0), 0)),
    cleanRate: pct(clean.length, submitted.length),
    denialRate: pct(denied.length, submitted.length),
    netCollection: pct(collected, collectible),
    cash: r2(pays.reduce((t, p) => t + (p.amount || 0), 0)),
    recouped: r2(-pays.filter((p) => p.kind === 'recoupment').reduce((t, p) => t + p.amount, 0)),
    lag: lag.length ? Math.round(lag.reduce((t, n) => t + n, 0) / lag.length) : 0,
  }
}

/** KPI tiles for the dashboard's Billing widget, current window vs the prior equal window. */
export function billingKpis(state, days, prior, { today } = {}) {
  const asOf = today || days[days.length - 1]
  const cur = windowFigures(state, days)
  const prev = windowFigures(state, prior)
  const d = (c, p) => (p ? Math.round(((c - p) / Math.abs(p)) * 100) : c ? 100 : 0)
  const ar = arOf(state, asOf)
  const last90 = new Set(Array.from({ length: 90 }, (_, i) => isoDate(addDays(parseISO(asOf), -i))))
  const dailyCharges = Object.values(state.claims || {})
    .filter((c) => isPrimaryReceivable(c) && c.status !== 'draft' && last90.has(c.dosTo))
    .reduce((t, c) => t + (c.charges || 0), 0) / 90
  const open = ar.totals.totalAR || Object.values(state.claims || {}).filter((c) => isPrimaryReceivable(c) && c.status !== 'draft').reduce((t, c) => t + Math.max(0, dueOf(c)), 0)
  const dso = dailyCharges ? Math.round(open / dailyCharges) : 0
  return [
    { k: 'cleanRate', label: 'Clean claim rate', value: cur.cleanRate, fmt: 'pct', delta: d(cur.cleanRate, prev.cleanRate),
      help: `Claims submitted in the window that were never denied or rebilled ÷ claims submitted (${cur.submitted}). Target 95%+.` },
    { k: 'denialRate', label: 'Denial rate', value: cur.denialRate, fmt: 'pct', delta: d(cur.denialRate, prev.denialRate), invert: true,
      help: `Claims submitted in the window that were denied at least once ÷ claims submitted (${cur.submitted}). Target under 5–10%.` },
    { k: 'netCollection', label: 'Net collection rate', value: cur.netCollection, fmt: 'pct', delta: d(cur.netCollection, prev.netCollection),
      help: 'Payer + secondary + patient payments ÷ (charges − contractual adjustments), for claims whose last service date is in the window. Target 95%+.' },
    { k: 'cash', label: 'Cash posted', value: Math.round(cur.cash), fmt: 'money', delta: d(cur.cash, prev.cash),
      help: 'Every ledger line dated in the window: remittances and receipts, net of reversals and recoupments.' },
    { k: 'dso', label: 'Days in A/R', value: dso, delta: null,
      help: `Open primary A/R today ($${Math.round(open).toLocaleString()}) ÷ average daily charges over the last 90 days. Target under 35–45 days.` },
    { k: 'ar90', label: 'A/R over 90 days', value: pct(ar.totals.over90 || 0, ar.totals.totalAR || 0), fmt: 'pct', delta: null, invert: true,
      help: 'Share of open primary A/R older than 90 days, as of today. Target under 10–15%.' },
    { k: 'lag', label: 'Charge lag (days)', value: cur.lag, delta: d(cur.lag, prev.lag), invert: true,
      help: 'Average days from the last service date to submission, for claims submitted in the window.' },
    { k: 'recouped', label: 'Recouped', value: Math.round(cur.recouped), fmt: 'money', delta: d(cur.recouped, prev.recouped), invert: true,
      help: 'Money payers took back in the window (Payment Center → Recoupments).' },
  ]
}
