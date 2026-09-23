p = 'src/lib/master.js'
s = open(p).read()

old = s[s.index("export function cfDefs(p) {"):s.index("// every payer read goes through here")]
new = """export function cfDefs(p, defsList = []) {
  // payer.cf holds master template ids now; older saves carried inline defs or bare labels — resolve both
  const raw = (p && p.cf) || []
  const out = []
  for (let i = 0; i < raw.length; i++) {
    const f = raw[i]
    if (typeof f === 'string') {
      const byId = defsList.find((d) => d.id === f)
      if (byId) { out.push({ ...byId, source: 'master', defId: byId.id }); continue }
      out.push({ id: `legacy-${i}`, label: f, type: 'text', options: [], required: false, source: 'inline' })
      continue
    }
    if (f && f.type) { out.push({ options: [], onLabel: 'Yes', offLabel: 'No', required: false, ...f, source: 'inline' }); continue }
    if (f && f.label) { out.push({ id: `legacy-${i}`, label: f.label, type: 'text', options: [], required: false, value: f.value ?? '', source: 'inline' }); continue }
  }
  return out
}
// the fields an appointment must collect for a payer — template defs win over inline legacy entries
export function payerFieldDefs(state, payer) {
  return payer ? cfDefs(payer, state.customFields || []) : []
}
export const cfUsedBy = (defs, payers, id) => payers.filter((x) => (x.cf || []).includes(id)).length
"""
s = s.replace(old, new)
open(p, 'w').write(s)
t = open(p).read()
print('master ok', 'payerFieldDefs' in t, 'cfUsedBy' in t, 'export function cfDefs(p, defsList' in t)
