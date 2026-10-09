/* Rewrites stored values that used to carry an em dash (shipped option values,
 * seed titles, referral source names, auto-titles) to their plain-separator
 * versions, so saved workspaces and old backups match what the app now writes.
 * Pure and idempotent: returns the same object when nothing needs a change.
 * Audit trails (security, importLog, audit) are left as they were recorded. */

// Old text -> new text. Applied as substring replacements, so a value copied
// into a longer string (an intake source label, a workers' comp pay line) moves too.
export const EM_DASH_RENAMES = [
  ['Yes — after authorization is on file', 'Yes, after authorization is on file'],
  ['Regular — direct treatment', 'Regular (direct treatment)'],
  ['Bonus — nondiscretionary', 'Bonus (nondiscretionary)'],
  ['Bonus — discretionary', 'Bonus (discretionary)'],
  ['8810 — Clerical', '8810: Clerical'],
  ['8834 — Home health / therapy', '8834: Home health / therapy'],
  ['6100 Payroll — clinical wages', '6100 Payroll (clinical wages)'],
  ['Consent — treatment', 'Consent: treatment'],
  ['Consent — telehealth', 'Consent: telehealth'],
  ['Urgent — start within 2 weeks', 'Urgent: start within 2 weeks'],
  ['Routine — start within 30 days', 'Routine: start within 30 days'],
  ['Flexible — no target date', 'Flexible: no target date'],
  ['HM — group', 'HM: group'],
  ['HO — masters level', 'HO: masters level'],
  ['HN — bachelors level', 'HN: bachelors level'],
  ['GT — telehealth', 'GT: telehealth'],
  ['95 — synchronous telehealth', '95: synchronous telehealth'],
  ['U6 — hourly', 'U6: hourly'],
  ['Valley Children’s Hospital — Neurodevelopment', 'Valley Children’s Hospital (Neurodevelopment)'],
  ['Autism Society — South Bay chapter', 'Autism Society (South Bay chapter)'],
  ['Insurance Auth — ', 'Insurance Auth '],
  ['Drive to session — ', 'Drive to session · '],
  ['Drive home — ', 'Drive home · '],
  ['Break — reset & restock', 'Break: reset & restock'],
  ['Team meeting — programming review', 'Team meeting: programming review'],
  ['ABA group training — reinforcement & protocol fidelity', 'ABA group training: reinforcement & protocol fidelity'],
  ['PTO — family trip', 'PTO: family trip'],
  ['Unavail — court date', 'Unavail: court date'],
  ['Unavail — medical appt', 'Unavail: medical appt'],
  ['Clinic closed — staff training', 'Clinic closed: staff training'],
  ['Payment posted — ', 'Payment posted: '],
  ['Denied — ', 'Denied: '],
  ['Submission held — ', 'Submission held: '],
]

// The old auto-title "Client — Service · Time": only a title whose dash is
// followed by a middot-separated service and time is treated as generated.
const OLD_AUTO_TITLE = /^([^—]+?) — ([^—]+ · [^—]+)$/

// `history` is skipped only at the top level (the tab-local Undo stack); a claim's
// history entries are migrated.
const SKIP_KEYS = new Set(['importLog', 'audit', 'auditLog'])
const SKIP_TOP = new Set(['security', 'history'])

export function migrateEmDashString(s, key) {
  if (typeof s !== 'string' || !s.includes('—')) return s
  let out = s
  for (const [from, to] of EM_DASH_RENAMES) if (out.includes(from)) out = out.split(from).join(to)
  if (key === 'title') out = out.replace(OLD_AUTO_TITLE, '$1 · $2')
  return out
}

function walk(v, key, top = false) {
  if (typeof v === 'string') return migrateEmDashString(v, key)
  if (!v || typeof v !== 'object') return v
  if (Array.isArray(v)) {
    let next = v
    v.forEach((item, i) => {
      const m = walk(item, key)
      if (m !== item) { if (next === v) next = [...v]; next[i] = m }
    })
    return next
  }
  let next = v
  for (const k of Object.keys(v)) {
    if (SKIP_KEYS.has(k) || (top && SKIP_TOP.has(k))) continue
    const m = walk(v[k], k)
    if (m !== v[k]) { if (next === v) next = { ...v }; next[k] = m }
  }
  return next
}

export const migrateEmDashData = (state) => walk(state, '', true)
