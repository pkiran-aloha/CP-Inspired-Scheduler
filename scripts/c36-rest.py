import pathlib

# ============ F) PayersList: structural redesign ============
p = pathlib.Path('src/components/PayersView.jsx'); s = p.read_text()
old = """  const filtersOn = activeOnly || q.trim()
  return (
    <div className=\"py-list\">
      <div className=\"py-tools\">
        <span className=\"muted py-toolcount\">{payers.length} payer{payers.length === 1 ? '' : 's'} · {activeOnly ? 'active only' : 'all statuses'} · click any cell to edit inline</span>
        <input className=\"input\" style={{ width: 200, height: 30 }} placeholder=\"Search payers, IDs, cities…\" value={q} onChange={(e) => setQ(e.target.value)} data-testid=\"py-search\" />
        <button className={`btn btn-sm${activeOnly ? ' btn-primary' : ''}`} data-testid=\"py-active-filter\" onClick={() => setActiveOnly((v) => !v)} title=\"Show active payers only\">{Icon.check({ size: 12 })} Active</button>
        <button className=\"btn btn-sm btn-primary\" data-testid=\"py-add\" onClick={() => setModal('new')}>{Icon.plus({ size: 12 })} Add Payer</button>
      </div>
"""
new = """  const filtersOn = activeOnly || q.trim()
  // structural overview for the page band (chunk-36)
  const nActive = payers.filter((x) => x.status !== 'inactive').length
  const nUsed = payers.filter((x) => countFor(x.name) > 0).length
  const nFields = payers.filter((x) => (x.cf || []).length > 0).length
  const nContract = payers.filter((x) => (x.services || []).length > 0).length
  return (
    <div className=\"py-list\">
      <div className=\"py-band\" data-testid=\"py-band\">
        <span className=\"py-band-ic\">{Icon.users({ size: 17 })}</span>
        <div className=\"py-band-t\">
          <h2>Payer directory</h2>
          <p>Every contract the front desk books against. Click a row for the full record — profile, services & billing rules; edit any cell in place.</p>
        </div>
        <span className=\"an-spacer\" />
        <button className=\"btn btn-sm btn-primary\" data-testid=\"py-add\" onClick={() => setModal('new')}>{Icon.plus({ size: 12 })} Add Payer</button>
      </div>
      <div className=\"py-stats\" data-testid=\"py-stats\">
        <button className={`py-stat${!filtersOn ? ' hot' : ''}`} data-testid=\"py-stat-all\" onClick={() => { setQ(''); setActiveOnly(false) }} title=\"Show all payers\"><b>{payers.length}</b> payers</button>
        <button className={`py-stat${activeOnly ? ' hot' : ''}`} data-testid=\"py-stat-active\" onClick={() => setActiveOnly((v) => !v)} title=\"Toggle active-only\"><b>{nActive}</b> active</button>
        <span className=\"py-stat\"><b>{nUsed}</b> in use by clients</span>
        <span className=\"py-stat\"><b>{nFields}</b> with custom fields</span>
        <span className=\"py-stat\"><b>{nContract}</b> with narrowed contracts</span>
      </div>
      <section className=\"py-sec\" data-testid=\"py-sec\">
        <header className=\"py-sech\">
          <span className=\"py-sech-ic\">{Icon.table({ size: 13 })}</span>
          <b>Master list</b>
          <i>sortable · inline-editable</i>
          <span className=\"an-spacer\" />
          <input className=\"input\" style={{ width: 200, height: 29 }} placeholder=\"Search payers, IDs, cities…\" value={q} onChange={(e) => setQ(e.target.value)} data-testid=\"py-search\" />
          <button className={`btn btn-sm${activeOnly ? ' btn-primary' : ''}`} data-testid=\"py-active-filter\" onClick={() => setActiveOnly((v) => !v)} title=\"Show active payers only\">{Icon.check({ size: 12 })} Active</button>
          <span className=\"muted py-toolcount\">{rows.length} of {payers.length}</span>
        </header>
"""
assert old in s; s = s.replace(old, new, 1)
old = """      <div className=\"an-wrap\" style={{ paddingTop: 10 }}>
        <div className=\"py-tbl\" data-testid=\"payers-table\">"""
new = """        <div className=\"py-tbl\" data-testid=\"payers-table\">"""
assert old in s; s = s.replace(old, new, 1)
# close the section after the table (the old an-wrap closing div becomes </section>)
old = """          </div>
        </div>
      </div>

      {modal && ("""
new = """          </div>
      </section>

      {modal && ("""
assert old in s, 'tail anchor'; s = s.replace(old, new, 1)
# empty state wording
old = 'No payers match — clear the filters or add one.'
assert old in s; s = s.replace(old, 'No payers match — clear the filters or add one from the top of the page.', 1)
p.write_text(s)
print('F) payers redesign OK')

# ============ G) styles ============
q = pathlib.Path('src/styles.css'); c = q.read_text()
c += """
/* ================= chunk-36: structural Payers master, aligned CF pickers ================= */
.py-band { display: flex; align-items: center; gap: 13px; padding: 14px 16px; border: 1px solid var(--line);
  border-radius: 14px; background: linear-gradient(135deg, color-mix(in srgb, var(--accent) 8%, var(--panel)), var(--panel) 55%); }
.py-band-ic { display: grid; place-items: center; width: 38px; height: 38px; border-radius: 11px; flex: none;
  background: var(--accent-soft); color: var(--accent); border: 1px solid color-mix(in srgb, var(--accent) 30%, var(--line)); }
.py-band-t h2 { margin: 0; font-size: 16px; font-weight: 750; letter-spacing: -.01em; color: var(--text-1); }
.py-band-t p { margin: 3px 0 0; font-size: 12px; color: var(--muted); max-width: 640px; line-height: 1.45; }
.py-stats { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
.py-stat { display: inline-flex; align-items: center; gap: 5px; padding: 5px 11px; border-radius: 999px;
  border: 1px solid var(--line); background: var(--panel); font-size: 11.6px; color: var(--muted); }
.py-stat b { color: var(--text-1); font-weight: 720; font-size: 12.4px; }
button.py-stat { cursor: pointer; transition: .14s; }
button.py-stat:hover { border-color: color-mix(in srgb, var(--accent) 45%, var(--line)); }
.py-stat.hot { border-color: color-mix(in srgb, var(--accent) 55%, var(--line)); background: var(--accent-soft); color: var(--accent); }
.py-sec { margin-top: 12px; border: 1px solid var(--line); border-radius: 14px; background: var(--panel); overflow: hidden; }
.py-sech { display: flex; align-items: center; gap: 9px; padding: 10px 14px; border-bottom: 1px solid var(--line);
  background: var(--panel-2); font-size: 12.4px; }
.py-sech b { font-weight: 720; color: var(--text-1); }
.py-sech i { font-style: normal; font-size: 11px; color: var(--muted); }
.py-sech-ic { color: var(--accent); display: inline-flex; }
.py-sec .py-tbl { border: 0; border-radius: 0; box-shadow: none; background: transparent; }
.py-sec .py-frow { margin: 10px 14px 0; }
.py-sec .py-thead { position: sticky; top: 0; z-index: 2; }
/* custom-field picker rows — a deliberate aligned list (payer profile + appointment modal) */
.cf-picklist { display: flex; flex-direction: column; gap: 7px; max-height: 50vh; overflow-y: auto; padding: 2px; }
.cf-pickrow { display: grid; grid-template-columns: 16px minmax(0, 1fr) auto; align-items: center; gap: 11px;
  border: 1px solid var(--line); border-radius: 11px; background: var(--panel); padding: 9px 12px; cursor: pointer; transition: .14s; }
.cf-pickrow:hover { border-color: color-mix(in srgb, var(--accent) 38%, var(--line)); background: var(--panel-2); }
.cf-pickrow.on { border-color: color-mix(in srgb, var(--accent) 55%, var(--line)); background: var(--accent-soft); }
.cf-pickrow.dim { opacity: .55; }
.cf-pickrow > input { width: 15px; height: 15px; accent-color: var(--accent); margin: 0; }
.cf-pickmain { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.cf-pickname { display: flex; align-items: center; gap: 7px; flex-wrap: wrap; min-width: 0; }
.cf-pickname b { font-size: 12.5px; font-weight: 660; color: var(--text-1); }
.cf-picksub { display: flex; align-items: center; gap: 5px; flex-wrap: wrap; min-width: 0; }
.cf-picknote { font-size: 10.8px; max-width: 46ch; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-style: normal; }
.cf-pickacts { display: flex; align-items: center; gap: 2px; flex: none; }
.cf-pickacts .iconbtn { width: 24px; height: 24px; }
.py-modal .modal-foot.pm-foot { gap: 8px; }
"""
q.write_text(c)
print('G) styles OK')

# ============ H) test updates ============
p = pathlib.Path('src/__tests__/mastersHub.test.jsx'); s = p.read_text()
# 1) payers-only-pick test: single entry + manage lives in the modal
old = """    // there is no designer here any more — only picking and unlinking
    expect(screen.queryByTestId('pd-cf-label')).toBeNull()"""
new = """    // one button, exactly as asked — no separate manage entry on the profile
    expect(screen.getByTestId('pd-cf-pick').textContent).toContain('Add Custom Fields')
    expect(screen.queryByTestId('pd-cf-gomaster')).toBeNull()
    // there is no designer here any more — only picking and unlinking
    expect(screen.queryByTestId('pd-cf-label')).toBeNull()"""
assert old in s; s = s.replace(old, new, 1)
old = """    // and the jump-to-master affordance works
    fireEvent.click(screen.getByTestId('pd-cf-gomaster'))
    expect(await screen.findByTestId('cfdefs-table')).toBeTruthy()"""
new = """    // the manage affordances live INSIDE the picker modal now: create, edit, delete, jump
    fireEvent.click(screen.getByTestId('pd-cf-pick'))
    await screen.findByTestId('pd-cf-picker')
    expect(screen.getByTestId('pd-cfm-new')).toBeTruthy()
    expect(screen.getByTestId('pd-cfm-edit-cf-goals')).toBeTruthy()
    expect(screen.getByTestId('pd-cfm-del-cf-authdept').disabled).toBe(true) // in use → blocked right here
    fireEvent.click(screen.getByTestId('pd-cf-gomaster'))
    expect(await screen.findByTestId('cfdefs-table')).toBeTruthy()"""
assert old in s; s = s.replace(old, new, 1)
# 2) wizard test: payer picks first (fallback removed on purpose)
old = """    // book Justin (Aetna) — field panel with template controls
    fireEvent.click(screen.getByTestId('nav-calendar'))"""
new = """    // chunk-36: appointments only see what the payer profile PICKED — pick them now
    fireEvent.click(screen.getByTestId('masters-tab-payers'))
    await screen.findByTestId('payers-table')
    fireEvent.click(screen.getByTestId('py-row-py-aetna'))
    await screen.findByTestId('payer-detail')
    fireEvent.click(screen.getByTestId('pd-cf-pick'))
    await screen.findByTestId('pd-cf-picker')
    fireEvent.click((await screen.findByTestId('pd-cfpick-cf-authdept')).querySelector('input'))
    fireEvent.click(screen.getByTestId('pd-cfpick-cf-present').querySelector('input'))
    fireEvent.click(screen.getByTestId('pd-cf-picker-close'))
    await waitFor(() => expect(stored().payers.find((x) => x.id === 'py-aetna').cf).toEqual(['cf-authdept', 'cf-present']))
    // book Justin (Aetna) — field panel with template controls
    fireEvent.click(screen.getByTestId('nav-calendar'))"""
assert old in s; s = s.replace(old, new, 1)
# 3) new: structural payers landing
old = "  it('Custom Fields master page: define list options and toggle labels right in the template editor', async () => {"
new = """  it('payers landing: structural band, stats chips and a sectioned list', async () => {
    render(<App />)
    await toMasters()
    const band = await screen.findByTestId('py-band')
    expect(band.textContent).toContain('Payer directory')
    expect(screen.getByTestId('py-stats').textContent).toContain('in use by clients')
    expect(screen.getByTestId('py-stats').textContent).toContain('with custom fields')
    expect(screen.getByTestId('py-sec').textContent).toContain('Master list')
    expect(screen.getByTestId('payers-table')).toBeTruthy()
    expect(screen.getByTestId('py-add').textContent).toContain('Add Payer')
    // stats are interactive: the active chip toggles the filter
    fireEvent.click(screen.getByTestId('py-stat-active'))
    expect(await screen.findByTestId('py-frow')).toBeTruthy()
    fireEvent.click(screen.getByTestId('py-stat-all'))
    expect(screen.queryByTestId('py-frow')).toBeNull()
  })

  it('Custom Fields master page: define list options and toggle labels right in the template editor', async () => {"""
assert old in s; s = s.replace(old, new, 1)
# 4) new: master-only appointment picker (legacy never leaks) — add to chunk33 describe end
old = "  it('payer profile keeps picked templates live: master edit renames everywhere, unlink is cheap', async () => {"
new = """  it('appointment picker is master-only — legacy inline entries never reach it', async () => {
    render(<App />)
    const st = stored()
    st.payers.find((x) => x.id === 'py-aetna').cf = ['cf-waiver', 'Free-text holdover'] // one master id + one legacy string
    localStorage.setItem('aloha-aba.v3', JSON.stringify(st))
    cleanup()
    render(<App />)
    fireEvent.click(screen.getByTestId('nav-calendar'))
    fireEvent.click(screen.getByRole('button', { name: 'Appointment' }))
    fireEvent.click(await screen.findByTestId('type-service'))
    fireEvent.click(screen.getByTestId('pick-Client Name'))
    const item = (await screen.findAllByTestId('people-item')).find((b) => b.textContent.includes('Justin Hsu'))
    fireEvent.click(item)
    fireEvent.mouseDown(document.body)
    fireEvent.click(screen.getByTestId('pick-Staff Name'))
    fireEvent.click((await screen.findAllByTestId('people-item'))[0])
    fireEvent.mouseDown(document.body)
    await screen.findByTestId('am-pcf')
    fireEvent.click(screen.getByTestId('am-pcf-add'))
    await screen.findByTestId('am-pcf-picker')
    expect(screen.getByTestId('am-pcf-pick-cf-waiver')).toBeTruthy() // master-defined → offered
    expect(screen.queryByTestId(/am-pcf-pick-legacy/)).toBeNull() // legacy inline → never offered
  })

  it('payer profile keeps picked templates live: master edit renames everywhere, unlink is cheap', async () => {"""
assert old in s; s = s.replace(old, new, 1)
p.write_text(s)
print('H) tests updated OK')

# ============ I) PDF export test ============
pathlib.Path('src/__tests__/pdf.test.js').write_text("""import { describe, it, expect } from 'vitest'
import { buildSpec, specToPdf } from '../lib/exportKit'

const long = 'Alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima mike november oscar papa quebec romeo sierra tango uniform victor whiskey xray yankee zulu'
const spec = buildSpec({
  org: { name: 'Aloha ABA Therapy Partners' },
  def: { name: 'Service delivery ledger with a genuinely long report title for wrapping' },
  columns: [{ k: 'note', label: 'Session note / remarks' }, { k: 'amt', label: 'Charge $', t: 'money', align: 'r' }],
  rows: Array.from({ length: 160 }, (_, i) => ({ note: `${long} row-${i}`, amt: i })),
  totals: { amt: 12720 },
  days: ['2026-09-01', '2026-09-02'],
  scopeLabel: 'All records',
  note: `Note sentence that goes on and on and must appear in full. `.repeat(6) + 'THE-END-SENTINEL',
})

describe('chunk-36 PDF export', () => {
  const doc = specToPdf(spec)
  const raw = Buffer.from(doc.output('arraybuffer')).toString('latin1')
  it('does not truncate — every row tail is present', () => {
    for (const tail of ['row-0', 'row-79', 'row-159']) expect(raw.includes(tail)).toBe(true)
  })
  it('wraps instead of ellipsising — no trailing … anywhere', () => {
    expect(raw.includes('\\u2026')).toBe(false)
  })
  it('keeps the full note text, sentinel and all', () => {
    expect(raw.includes('THE-END-SENTINEL')).toBe(true)
  })
  it('paginates by measured height and numbers pages', () => {
    expect(doc.getNumberOfPages()).toBeGreaterThan(1)
    expect(raw.includes('Page 1 of')).toBe(true)
  })
  it('totals survive on the final page', () => {
    expect(raw.includes('$12,720.00')).toBe(true)
  })
})
""")
print('I) pdf test written')
