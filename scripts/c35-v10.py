import pathlib, json

# ---------- 1) seed: NO pre-selected custom fields anywhere ----------
p = pathlib.Path('src/lib/seed.js'); s = p.read_text()
old1 = "ctList: 'ABA Standard', services: [], cf: ['cf-authdept', 'cf-present'] })"
old2 = "ctList: '', services: [], cf: ['cf-parentsig'] })"
assert old1 in s and old2 in s
s = s.replace(old1, "ctList: 'ABA Standard', services: [], cf: [] })", 1)
s = s.replace(old2, "ctList: '', services: [], cf: [] })", 1)
p.write_text(s)

# ---------- 2) AppointmentModal: fallback picker to all ACTIVE master templates ----------
p = pathlib.Path('src/components/AppointmentModal.jsx'); s = p.read_text()
old = "  const pcfDefs = payerFieldDefs(state, billPayer).filter((d) => d.label)\n"
new = """  const pcfSel = payerFieldDefs(state, billPayer).filter((d) => d.label)
  // chunk-35: fields are selectable everywhere, never pre-selected — if the payer hasn't
  // picked templates yet, the appointment can still add any ACTIVE master template.
  const pcfAll = (state.customFields || []).filter((d) => d.label && d.status !== 'inactive')
  const pcfDefs = pcfSel.length ? pcfSel : pcfAll
"""
assert old in s; s = s.replace(old, new, 1)
old = '<i>optional · only fields you add below are captured</i>'
new = '<i>{(pcfSel.length ? \'optional · only fields you add below are captured\' : pcfDefs.length ? \'optional · pick any active master template\' : \'optional · none defined on Masters → Custom Fields\')}</i>'
assert old in s; s = s.replace(old, new, 1)
p.write_text(s)

# ---------- 3) PayerDetail: unambiguous edit + first-add wording ----------
p = pathlib.Path('src/components/PayerDetail.jsx'); s = p.read_text()
old = '<div className="muted pd-cfempty">Nothing contracted yet — use “+” to attach service types from the master or add one just for this payer.</div>'
new = '<div className="muted pd-cfempty">No services on this payer yet — use “Add Service” above to create a payer-specific one, or “Contract services” to attach service types from the master.</div>'
assert old in s; s = s.replace(old, new, 1)
old = '{Icon.edit({ size: 12 })} Modifier, Charge &amp; Contract Rate{hasOvr || c.kind === \'local\' ? \'\' : \' — none set\'}'
new = '{Icon.edit({ size: 12 })} Edit this service line{hasOvr || c.kind === \'local\' ? \' — overrides active\' : \' — set modifier, charge &amp; contract rate\'}'
assert old in s; s = s.replace(old, new, 1)
p.write_text(s)

# ---------- 4) build-update detection ----------
pathlib.Path('public').mkdir(exist_ok=True)
vf = pathlib.Path('public/version.json')
if not vf.exists() or '"dev"' not in vf.read_text():
    vf.write_text('{ "build": "dev", "note": "stamped by npm run build (scripts/write-version.cjs)" }\n')
wv = pathlib.Path('scripts/write-version.cjs')
wv.write_text("""// stamps public/version.json so the running app can detect a newer deployment
const fs = require('fs'), path = require('path')
const out = path.join(__dirname, '..', 'public', 'version.json')
fs.mkdirSync(path.dirname(out), { recursive: true })
fs.writeFileSync(out, JSON.stringify({ build: Date.now().toString(36), built: new Date().toISOString() }) + '\\n')
""")
bw = pathlib.Path('src/components/BuildWatcher.jsx')
bw.write_text("""import React, { useEffect, useRef, useState } from 'react'
import { Icon } from '../ui/Icons'
// chunk-35: long-lived SPA tabs silently keep the PREVIOUS deployment's bundle.
// Poll the freshly written version.json; when it flips, offer a one-click reload.
export default function BuildWatcher() {
  const [stale, setStale] = useState(false)
  const seen = useRef(null)
  useEffect(() => {
    let dead = false
    const check = async () => {
      try {
        const base = (import.meta.env.BASE_URL || './').replace(/[^/]$/, '$&/')
        const r = await fetch(`${base}version.json?cb=${Date.now()}`, { cache: 'no-store' })
        if (!r.ok) return
        const j = await r.json().catch(() => null)
        if (!j || !j.build) return
        if (seen.current == null) { seen.current = j.build; return }
        if (seen.current !== j.build && !dead) setStale(true)
      } catch { /* dev server / offline — stay quiet */ }
    }
    check()
    const iv = setInterval(check, 120000)
    const onFocus = () => { if (!stale) check() }
    window.addEventListener('focus', onFocus)
    return () => { dead = true; clearInterval(iv); window.removeEventListener('focus', onFocus) }
  }, [stale])
  if (!stale) return null
  return (
    <button type="button" className="build-update" data-testid="app-update" title="A newer build is deployed — click to reload the app"
      onClick={() => window.location.reload()}>
      {Icon.repeat({ size: 13 })} New version deployed — click to refresh
    </button>
  )
}
""")
p = pathlib.Path('src/App.jsx'); s = p.read_text()
old = """<ToastProvider>
      <StoreProvider>
        <Shell />
      </StoreProvider>
    </ToastProvider>"""
new = """<ToastProvider>
      <StoreProvider>
        <Shell />
        <BuildWatcher />
      </StoreProvider>
    </ToastProvider>"""
assert old in s; s = s.replace(old, new, 1)
imp = "export default function App()"
assert imp in s; s = s.replace(imp, "import BuildWatcher from './components/BuildWatcher.jsx'\n\n" + imp, 1)
p.write_text(s)
pkg = pathlib.Path('package.json'); j = pkg.read_text()
old = '"build": "vite build",'
assert old in j; j = j.replace(old, '"prebuild": "node scripts/write-version.cjs",\n    "build": "vite build",', 1)
pkg.write_text(j)

# ---------- 5) styles: pill ----------
q = pathlib.Path('src/styles.css'); c = q.read_text()
if 'build-update' not in c:
    c += """
/* ---- chunk-35: deployed-update notice + service edit affordance copy ---- */
.build-update { position: fixed; right: 18px; bottom: 18px; z-index: 2400; display: inline-flex; align-items: center; gap: 7px;
  border: 1px solid color-mix(in srgb, var(--accent) 45%, var(--line)); background: var(--panel); color: var(--accent);
  font-size: 12px; font-weight: 650; padding: 8px 13px; border-radius: 999px; cursor: pointer;
  box-shadow: 0 10px 28px rgba(11, 16, 32, 0.22); animation: bu-pop .25s ease; }
.build-update:hover { background: var(--accent-soft); }
@keyframes bu-pop { from { transform: translateY(8px); opacity: 0; } to { transform: none; opacity: 1; } }
"""
    q.write_text(c)
print('c35 patched OK')
