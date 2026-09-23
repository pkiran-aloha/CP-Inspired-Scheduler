import re, pathlib
# ---------- AppointmentModal.jsx ----------
p = pathlib.Path('src/components/AppointmentModal.jsx'); s = p.read_text()
assert 'pcfAdded' not in s, 'already patched'

s = s.replace("import { svcList, payerForAppt, ensurePayer, svcRule, concurrentNote, svcOptionsFor, svcById, payerFieldDefs, pcfsErrors, rateFor } from '../lib/master'",
              "import { svcList, payerForAppt, ensurePayer, svcRule, concurrentNote, svcOptionsFor, svcById, payerFieldDefs, pcfsErrors, rateFor, cfTypeLabel } from '../lib/master'", 1)
assert 'cfTypeLabel' in s

s = s.replace("  const [titleTouched, setTitleTouched] = useState(Boolean(initial.title))",
              "  const [titleTouched, setTitleTouched] = useState(Boolean(initial.title))\n  const [cfPick, setCfPick] = useState(false) // chunk-34: opt-in custom-field picker", 1)

old_defs = "  const pcfDefs = payerFieldDefs(state, billPayer).filter((d) => d.label)\n"
assert old_defs in s
s = s.replace(old_defs, old_defs + "  // chunk-34: custom fields are OPT-IN per appointment — nothing auto-populates.\n  const pcfAdded = pcfDefs.filter((d) => (f.pcfs || {})[d.id] !== undefined)\n", 1)

s = s.replace("  if (showClinic && pcfDefs.length) errors.push(...pcfsErrors(pcfDefs, f.pcfs))",
              "  if (showClinic && pcfAdded.length) errors.push(...pcfsErrors(pcfAdded, f.pcfs))", 1)

old_panel_start = '''                      {showClinic && pcfDefs.length > 0 && (
                        <div className="pcf-card" data-testid="am-pcf">
                          <div className="pcf-head">{Icon.badge({ size: 12 })} Payer fields — {billPayer.name}<i>required by this payer on every session</i></div>
                          {pcfDefs.map((d) => (
                            <div className={`pcf-f pcf-f-${d.type}${(f.pcfs || {})[d.id]?.value ? ' filled' : ''}`} key={d.id} data-testid={`pcf-f-${d.id}`}>
                              <label>{d.label}{d.required && ' *'}</label>'''
new_panel_start = '''                      {showClinic && pcfDefs.length > 0 && (
                        <div className="pcf-card" data-testid="am-pcf">
                          <div className="pcf-head">{Icon.badge({ size: 12 })} Custom fields — {billPayer.name}<i>optional · only fields you add below are captured</i>
                            <button type="button" className="btn btn-sm pcf-addbtn" data-testid="am-pcf-add" onClick={() => setCfPick(true)}>{Icon.plus({ size: 12 })} Add field</button>
                          </div>
                          {pcfAdded.length === 0 && <div className="muted pcf-empty" data-testid="am-pcf-empty">No custom fields on this appointment — pick from {pcfDefs.length} payer template{pcfDefs.length === 1 ? '' : 's'} with “Add field”. Nothing is enforced unless a template itself is required.</div>}
                          {pcfAdded.map((d) => (
                            <div className={`pcf-f pcf-f-${d.type}${(f.pcfs || {})[d.id]?.value ? ' filled' : ''}`} key={d.id} data-testid={`pcf-f-${d.id}`}>
                              <label>{d.label}{d.required && ' *'}</label>'''
assert old_panel_start in s; s = s.replace(old_panel_start, new_panel_start, 1)

old_panel_end = '''                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}'''
new_panel_end = '''                                </div>
                              )}
                              <button type="button" className="iconbtn pcf-x" aria-label="Remove custom field" data-testid={`pcf-del-${d.id}`}
                                onClick={() => { const n = { ...(f.pcfs || {}) }; delete n[d.id]; set({ pcfs: n }) }}>{Icon.x({ size: 12 })}</button>
                            </div>
                          ))}
                        </div>
                      )}
                      {cfPick && showClinic && pcfDefs.length > 0 && (
                        <div className="overlay pm-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) setCfPick(false) }}>
                          <div className="modal pm-modal py-modal" data-testid="am-pcf-picker" role="dialog" aria-modal="true" aria-label="Add custom fields">
                            <div className="modal-head pm-head">
                              <h3>Add custom fields — {billPayer.name}</h3>
                              <span className="muted" style={{ fontSize: 11.5, marginLeft: 10 }}>tick the payer's templates to capture on this session</span>
                              <span className="an-spacer" />
                              <button className="iconbtn modal-x" aria-label="Close" data-testid="am-pcf-picker-close" onClick={() => setCfPick(false)}>{Icon.x({ size: 14 })}</button>
                            </div>
                            <div className="modal-body">
                              <div className="svc-pickrows">
                                {pcfDefs.map((d) => {
                                  const on = (f.pcfs || {})[d.id] !== undefined
                                  return (
                                    <label key={d.id} className={`svc-pickrow${on ? ' on' : ''}`} data-testid={`am-pcf-pick-${d.id}`}>
                                      <input type="checkbox" checked={on} onChange={(e) => {
                                        const n = { ...(f.pcfs || {}) }
                                        if (e.target.checked) n[d.id] = { label: d.label, type: d.type, value: d.type === 'multi' ? [] : '' }
                                        else delete n[d.id]
                                        set({ pcfs: n })
                                      }} />
                                      <b>{d.label}</b>
                                      <span className="pcf-type">{cfTypeLabel(d.type)}</span>
                                      {d.required ? <span className="tag warn">Required</span> : null}
                                      {(d.options || []).length ? <span className="muted">{d.options.join(' · ')}</span> : <span className="muted">{d.note || ''}</span>}
                                    </label>
                                  )
                                })}
                              </div>
                            </div>
                            <div className="modal-foot"><button className="btn btn-sm btn-primary" data-testid="am-pcf-picker-done" onClick={() => setCfPick(false)}>Done</button></div>
                          </div>
                        </div>
                      )}'''
assert old_panel_end in s; s = s.replace(old_panel_end, new_panel_end, 1)
p.write_text(s)

# ---------- styles.css ----------
q = pathlib.Path('src/styles.css'); c = q.read_text()
if 'pcf-addbtn' not in c:
    c += '''
/* ---- chunk-34: opt-in custom fields in the appointment modal ---- */
.pcf-head .pcf-addbtn { margin-left: auto; height: 24px; font-size: 11.5px; padding: 0 10px; flex: 0 0 auto; }
.pcf-empty { font-size: 11.6px; padding: 6px 1px 1px; line-height: 1.5; }
.pcf-f { position: relative; }
.pcf-f > .pcf-chips, .pcf-f > .pcf-sigbox { flex: 1; min-width: 0; }
.pcf-f .pcf-x { flex: 0 0 auto; width: 22px; height: 22px; opacity: .5; }
.pcf-f .pcf-x:hover { opacity: 1; color: var(--danger); }
'''
    q.write_text(c)
print('patched OK')
