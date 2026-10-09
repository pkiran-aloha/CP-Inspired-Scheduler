// ---- Which provider identifier a payer bills with: NPI, Medicaid ID, or both ----
//
// Payers differ: commercial plans want the rendering provider's NPI, many state
// Medicaid programs want the Medicaid provider number, and some want both. The rule is
// a payer setting (Masters → Payer → Billing Rules → Provider IDs) the billing team
// sets themselves — no code change per payer. It drives three places:
//   · the appointment validation "Missing NPI / Medicaid ID"
//   · the claim gate (a claim cannot go out without the identifiers its payer requires)
//   · the CMS-1500 boxes 24J / 33a / 33b
// Identifiers live on provider records (Billing → Provider IDs: `npi`, `payerIds.medicaid`).
// Pure: no React, no store.

import { validNpi } from './claims'

export const PROVIDER_ID_RULES = [
  { id: 'npi', label: 'NPI only', hint: 'Box 24J and 33a carry the NPI (most commercial plans).' },
  { id: 'medicaid', label: 'Medicaid ID only', hint: 'Box 24J (shaded, qualifier G2) and 33b carry the Medicaid provider number.' },
  { id: 'both', label: 'NPI and Medicaid ID', hint: 'The NPI in 24J/33a and the Medicaid ID in the shaded 24J/33b, both required.' },
]
const LABEL = Object.fromEntries(PROVIDER_ID_RULES.map((r) => [r.id, r.label]))

/** The rule a payer bills under; `explicit` says whether the payer chose it (vs the NPI default). */
export function providerIdRule(payer) {
  const id = payer?.rules?.providerId
  return { id: LABEL[id] ? id : 'npi', label: LABEL[id] || LABEL.npi, explicit: Boolean(LABEL[id]) }
}

export const providerFor = (state, staffId) =>
  (state?.settings?.providers || []).find((p) => p.kind === 'staff' && p.refId === staffId && p.active !== false) || null

/** The identifiers on file for one staff member, as the payer's rule wants them printed. */
export function providerIdsFor(state, payer, staffId) {
  const prov = providerFor(state, staffId)
  return { rule: providerIdRule(payer).id, npi: prov?.npi || '', medicaid: prov?.payerIds?.medicaid || '', provider: prov }
}

/** What is missing for one staff member under the payer's rule (empty when billable). */
export function providerIdIssues(state, payer, staffId) {
  const rule = providerIdRule(payer)
  const st = (state?.staff || []).find((s) => s.id === staffId)
  const name = st?.name || staffId
  const prov = providerFor(state, staffId)
  const out = []
  if (!prov) return [`${name} has no provider record. Add one in Billing → Provider IDs.`]
  const via = payer?.name ? `${payer.name} bills with ${rule.label}` : `billing uses ${rule.label}`
  if ((rule.id === 'npi' || rule.id === 'both') && !validNpi(prov.npi)) out.push(`${name} has no valid NPI on file (${via})`)
  if ((rule.id === 'medicaid' || rule.id === 'both') && !String(prov.payerIds?.medicaid || '').trim()) out.push(`${name} has no Medicaid ID on file (${via})`)
  return out
}
