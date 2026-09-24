import pathlib

# ============ 1) master.js — load-time master-only migration ============
p = pathlib.Path('src/lib/master.js'); s = p.read_text()
s += '''
/**
 * chunk-37 — THE master-only rule, enforced at load: every custom field that
 * exists anywhere must be defined in the Custom Fields master. Older saves may
 * still carry bare label strings or full inline definitions on payers. Those are
 * reconciled once, silently, at startup:
 *   • a template id already in the master            → kept as-is
 *   • a label string that matches a master template  → re-pointed at the template
 *   • a label string with no template                → dropped (cannot exist)
 *   • an inline definition object                    → promoted into the master and referenced by id
 * After this, no consumer (appointment modal, exports, detail cards) can ever
 * encounter a field that the master doesn't define — pre-population or otherwise.
 */
export function normalizePayerCf(state, mkId) {
  const defs = (state.customFields || []).slice()
  const byLabel = new Map(defs.map((d) => [String(d.label || '').toLowerCase(), d]))
  const idSet = new Set(defs.map((d) => d.id))
  let changed = false
  const payers = (state.payers || []).map((p) => {
    const cf = p.cf || []
    if (!cf.length) return p
    const out = []
    let dirty = false
    for (const entry of cf) {
      if (typeof entry === 'string' && idSet.has(entry)) { out.push(entry); continue }
      dirty = true
      if (typeof entry === 'string') {
        const m = byLabel.get(entry.toLowerCase())
        if (m) out.push(m.id) // else: dangling — a field outside the master cannot exist
      } else if (entry && typeof entry === 'object' && entry.label) {
        let m = byLabel.get(String(entry.label).toLowerCase())
        if (!m) {
          m = { id: mkId('cf'), label: String(entry.label), type: entry.type || 'text', options: entry.options || [], onLabel: entry.onLabel || 'Yes', offLabel: entry.offLabel || 'No', required: Boolean(entry.required), note: entry.note || '', status: 'active' }
          defs.push(m); idSet.add(m.id); byLabel.set(m.label.toLowerCase(), m)
        }
        out.push(m.id)
      }
    }
    return dirty ? { ...p, cf: out } : p
  })
  return changed || payers.some((x, i) => x !== (state.payers || [])[i]) ? { ...state, payers, customFields: defs } : state
}
'''
p.write_text(s)

# ============ 2) store.jsx — run migration at load ============
p = pathlib.Path('src/state/store.jsx'); s = p.read_text()
old = "import { todayISO } from '../lib/date'"
assert old in s; s = s.replace(old, old + "\nimport { normalizePayerCf } from '../lib/master'", 1)
old = """      if (saved && saved.appts) {
        // merge every sub-object against defaults so older saves keep working as the schema grows
        const d = defaultSettings()
        return {"""
new = """      if (saved && saved.appts) {
        // merge every sub-object against defaults so older saves keep working as the schema grows
        const d = defaultSettings()
        const merged = normalizePayerCf({"""
assert old in s; s = s.replace(old, new, 1)
old = """          ui: { ...base.ui, ...(saved.ui || {}), filters: { ...base.ui.filters, ...(saved.ui?.filters || {}) }, section: (saved.ui?.section || 'calendar') === 'payers' ? 'masters' : saved.ui?.section || 'calendar' },
        }
      }"""
new = """          ui: { ...base.ui, ...(saved.ui || {}), filters: { ...base.ui.filters, ...(saved.ui?.filters || {}) }, section: (saved.ui?.section || 'calendar') === 'payers' ? 'masters' : saved.ui?.section || 'calendar' },
        }, uid)
        return merged
      }"""
assert old in s; s = s.replace(old, new, 1)
p.write_text(s)
print('1+2) migration OK')

# ============ 3) AppointmentModal — hard zero-prefill + orphan pruning ============
p = pathlib.Path('src/components/AppointmentModal.jsx'); s = p.read_text()
old = """  const fresh = (keep = {}) => {
    const x = { repeat: 'none', repeatCount: 8, status: 'active', verification: null, custom: {}, pcfs: {}, documents: [], ...initial, ...keep }"""
new = """  const fresh = (keep = {}) => {
    const x = { repeat: 'none', repeatCount: 8, status: 'active', verification: null, custom: {}, pcfs: {}, documents: [], ...initial, ...keep }
    // chunk-37: in NO way may a NEW appointment carry custom fields — even if some entry
    // point (duplicate/series/keep) tried to pass them through, the new modal starts empty.
    if (mode !== 'edit') x.pcfs = {}"""
assert old in s, 'fresh anchor'; s = s.replace(old, new, 1)
old = "  const pcfAdded = pcfDefs.filter((d) => (f.pcfs || {})[d.id] !== undefined)"
new = """  const pcfAdded = pcfDefs.filter((d) => (f.pcfs || {})[d.id] !== undefined)
  // switching client/payer can leave fields captured for the OLD payer — never keep those
  React.useEffect(() => {
    const cur = f.pcfs || {}
    const orphans = Object.keys(cur).filter((k) => !pcfDefs.some((d) => d.id === k))
    if (orphans.length) set({ pcfs: Object.fromEntries(Object.entries(cur).filter(([k]) => !orphans.includes(k))) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [billPayer?.id, showClinic])"""
assert old in s, 'pcfAdded anchor'; s = s.replace(old, new, 1)
p.write_text(s)
print('3) appointment hard-guard OK')

# ============ 4) PayerDetail — inline cell editing on service rows + exact add-button label ============
p = pathlib.Path('src/components/PayerDetail.jsx'); s = p.read_text()
old = "import { Dropdown, InlineSelect } from './fields'"
assert old in s; s = s.replace(old, "import { Dropdown, InlineSelect, InlineText } from './fields'", 1)
old = """  const cards = [
    ...linked.map((s) => ({ kind: 'linked', key: `L${s.id}`, master: s, id: s.id })),
    ...mine.map((s) => ({ kind: 'local', key: `P${s.id}`, local: s, id: s.id })),"""
new = """  const LBL = { billingCode: 'Billing code', dx1: 'Dx 1', dx2: 'Dx 2', unitSize: 'Unit size', charge: 'Charge rate', rounding: 'Rounding', contract: 'Contract rate', modifier: 'Modifier', thirdParty: 'Third-party ID', effective: 'Effective date', expiration: 'Expiration date', label: 'Label' }
  // inline cell write: linked rows upsert their svcOv override, payer-only rows edit their record
  const setCell = (c, key, val) => {
    if (c.kind === 'linked') {
      const prev = (p.svcOv || {})[c.master.id] || {}
      patch({ svcOv: { ...(p.svcOv || {}), [c.master.id]: { ...prev, [key]: val } } }, `${LBL[key] || key} on ${c.master.label} — saved for ${p.name}`)
    } else {
      patch({ svcs: mine.map((x) => (x.id === c.local.id ? { ...x, [key]: val } : x)) }, `${LBL[key] || key} on ${c.local.label} — updated`)
    }
  }
  const cards = [
    ...linked.map((s) => ({ kind: 'linked', key: `L${s.id}`, master: s, id: s.id })),
    ...mine.map((s) => ({ kind: 'local', key: `P${s.id}`, local: s, id: s.id })),"""
assert old in s, 'cards anchor'; s = s.replace(old, new, 1)
old = """              <div className="svc-rows">
                <div><span>Billing Code</span><b>{o.billingCode || o.code || c.master?.code || '—'}</b></div>
                <div><span>Dx Code 1</span><b>{o.dx1 || '—'}</b></div>
                <div><span>Dx Code 2</span><b>{o.dx2 || '—'}</b></div>
                <div><span>Unit Size</span><b>{o.unitSize || (c.master ? `${c.master.unitMins} Minutes` : '—')}</b></div>
                <div><span>Charge Rate</span><b className={hasOvr || c.kind === 'local' ? 'ovr' : ''}>{money(o.charge === '' || o.charge == null ? (c.master ? c.master.rate : 0) : o.charge)}</b></div>
                <div><span>Rounding</span><b>{o.rounding || c.master?.rounding || 'AMA'}</b></div>
                <div><span>Contract Rate</span><b>{o.contract ? money(o.contract) : '—'}</b></div>
                <div><span>Modifier</span><b>{o.modifier || '—'}</b></div>
                <div><span>Third Party ID</span><b>{o.thirdParty || '—'}</b></div>
              </div>"""
new = """              <div className="svc-rows">
                <div><span>Billing Code</span><InlineText testid={`pd-cell-code-${c.id}`} numeric={false} value={o.billingCode || ''} placeholder={o.code || c.master?.code || 'override master'} onCommit={(v) => setCell(c, 'billingCode', String(v).trim().toUpperCase())} /></div>
                <div><span>Dx Code 1</span><InlineText testid={`pd-cell-dx1-${c.id}`} value={o.dx1 || ''} placeholder="add" onCommit={(v) => setCell(c, 'dx1', String(v).trim().toUpperCase())} /></div>
                <div><span>Dx Code 2</span><InlineText testid={`pd-cell-dx2-${c.id}`} value={o.dx2 || ''} placeholder="add" onCommit={(v) => setCell(c, 'dx2', String(v).trim().toUpperCase())} /></div>
                <div><span>Unit Size</span><InlineSelect testid={`pd-cell-unit-${c.id}`} value={o.unitSize || (c.master ? `${c.master.unitMins} Minutes` : '')} options={UNITS_OPTS.map((u) => ({ value: u, label: u }))} onCommit={(v) => setCell(c, 'unitSize', v)} /></div>
                <div><span>Charge Rate</span><InlineText testid={`pd-cell-charge-${c.id}`} value={o.charge === '' || o.charge == null ? '' : String(o.charge)} placeholder={c.master ? String(c.master.rate) : '0'} onCommit={(v) => { const n = String(v).replace(/[^0-9.]/g, ''); setCell(c, 'charge', n ? Number(n) : '') }} /></div>
                <div><span>Rounding</span><InlineSelect testid={`pd-cell-round-${c.id}`} value={o.rounding || c.master?.rounding || 'AMA'} options={ROUNDINGS.map((r) => ({ value: r, label: r }))} onCommit={(v) => setCell(c, 'rounding', v)} /></div>
                <div><span>Contract Rate</span><InlineText testid={`pd-cell-contract-${c.id}`} value={o.contract == null ? '' : String(o.contract)} placeholder="—" onCommit={(v) => { const n = String(v).replace(/[^0-9.]/g, ''); setCell(c, 'contract', n ? Number(n) : '') }} /></div>
                <div><span>Modifier</span><InlineSelect testid={`pd-cell-mod-${c.id}`} value={o.modifier || ''} options={[{ value: '', label: '—' }, ...MODIFIERS.map((m) => ({ value: m, label: m }))]} onCommit={(v) => setCell(c, 'modifier', v)} /></div>
                <div><span>Third Party ID</span><InlineText testid={`pd-cell-tp-${c.id}`} value={o.thirdParty || ''} placeholder="—" onCommit={(v) => setCell(c, 'thirdParty', String(v).trim())} /></div>
                <div><span>Effective</span><InlineText testid={`pd-cell-eff-${c.id}`} value={o.effective || ''} placeholder="YYYY-MM-DD" onCommit={(v) => setCell(c, 'effective', String(v).trim())} /></div>
                <div><span>Expires</span><InlineText testid={`pd-cell-exp-${c.id}`} value={o.expiration || ''} placeholder="YYYY-MM-DD" onCommit={(v) => setCell(c, 'expiration', String(v).trim())} /></div>
              </div>"""
assert old in s, 'svc-rows anchor'; s = s.replace(old, new, 1)
old = '{Icon.plus({ size: 12 })} Add Service</button>'
assert old in s; s = s.replace(old, '{Icon.plus({ size: 12 })} New Payer-Only Service</button>', 1)
old = 'No services on this payer yet — use “Add Service” above to create a payer-specific one, or “Contract services” to attach service types from the master.'
assert old in s; s = s.replace(old, 'No services on this payer yet — use “New Payer-Only Service” above to create one just for this payer, or “Contract services” to attach master service types.', 1)
p.write_text(s)
print('4) inline service cells OK')

# ============ 5) build stamp + stale-on-load detection ============
v = pathlib.Path('vite.config.js'); s = v.read_text()
old = "import { defineConfig } from 'vite'"
new = """import fs from 'fs'
import { defineConfig } from 'vite'
// the running bundle embeds its own build id so it can detect (and announce) a newer deploy
let APP_BUILD = 'dev'
try { APP_BUILD = String(JSON.parse(fs.readFileSync('public/version.json', 'utf8')).build || 'dev') } catch { /* prebuild not run yet */ }"""
assert old in s; s = s.replace(old, new, 1)
old = "  plugins: [react()],"
assert old in s; s = s.replace(old, "  define: { __APP_BUILD__: JSON.stringify(APP_BUILD) },\n  plugins: [react()],", 1)
v.write_text(s)

p = pathlib.Path('src/components/NavRail.jsx'); s = p.read_text()
old = "            <b>{state.settings?.org?.name || 'Aloha ABA Center'}</b>"
assert old in s
s = s.replace(old, old + '\n            <i className="nr-build" data-testid="app-build" title="Build running in this tab — if the site deploys a newer one, you\u2019ll be prompted to refresh">v12 · build {typeof __APP_BUILD__ !== \'undefined\' ? __APP_BUILD__ : \'dev\'}</i>', 1)
p.write_text(s)

p = pathlib.Path('src/components/BuildWatcher.jsx'); s = p.read_text()
old = """        if (!j || !j.build) return
        if (seen.current == null) { seen.current = j.build; return }
        if (seen.current !== j.build && !dead) setStale(true)"""
new = """        if (!j || !j.build) return
        if (seen.current == null) {
          seen.current = j.build
          // chunk-37: ALSO compare against the id baked into THIS bundle at build time —
          // a tab restored from cache serving an old index.html now self-detects staleness.
          const mine = typeof __APP_BUILD__ !== 'undefined' ? __APP_BUILD__ : null
          if (mine && mine !== 'dev' && j.build !== mine && !dead) setStale(true)
          return
        }
        if (seen.current !== j.build && !dead) setStale(true)"""
assert old in s; s = s.replace(old, new, 1)
p.write_text(s)

q = pathlib.Path('src/styles.css'); c = q.read_text()
c += """
/* ---- chunk-37: build stamp + inline service cells ---- */
.nr-build { display: block; font-style: normal; font-size: 9.5px; color: var(--muted); letter-spacing: .04em; margin-top: 2px; opacity: .8; }
.svc-rows .ile { font-weight: 640; color: var(--text-1); }
.svc-card:focus-within { border-color: color-mix(in srgb, var(--accent) 40%, var(--line)); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 12%, transparent); }
"""
q.write_text(c)
print('5) build stamp OK')
