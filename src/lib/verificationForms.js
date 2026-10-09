import { todayISO } from './date'

// Demo register entries are pending: seeding must never imply verified coverage.
export function seedVerificationForms(clients = [], payers = []) {
  return Object.fromEntries(clients.slice(0, 6).map((client) => {
    const id = `vf-seed-${client.id}`
    return [id, { id, clientId: client.id, clientName: client.name,
      payer: payers.find((p) => p.id === client.payerId)?.name || '',
      date: todayISO(), status: 'pending', notes: 'Sample verification. Eligibility has not been checked.' }]
  }))
}

export function normalizeVerificationForms(state) {
  let forms = state.verificationForms
  if (Array.isArray(forms)) {
    forms = Object.fromEntries(forms.filter((f) => f && f.id).map((f) => [f.id, f]))
  } else if (!forms || typeof forms !== 'object') forms = {}
  const seeded = state.meta?.verificationFormsSeeded
  if (!seeded && !Object.keys(forms).length) forms = seedVerificationForms(state.clients, state.payers)
  if (seeded && forms === state.verificationForms) return state
  return { ...state, verificationForms: forms, meta: { ...state.meta, verificationFormsSeeded: true } }
}
