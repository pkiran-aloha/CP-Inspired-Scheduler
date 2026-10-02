import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../../state/store'
import { SectionBar } from '../NavRail'
import { Icon } from '../../ui/Icons'
import { useToast } from '../../ui/Toast'
import { Dropdown } from '../fields'
import { AvatarPicker, COLORS } from '../ClientsView'
import { isoDate, todayISO } from '../../lib/date'
import { LOCATIONS } from '../../lib/seed'
import {
  blankIntake, fullName, stageDef, nextStages, gateBlockers,
  URGENCY, URGENCY_IDS, INTAKE_PROGRAMS, SERVICE_LINES, SETTING_PREFS, LIVING_ARRANGEMENTS,
  LANGUAGE_OPTIONS, PHONE_TYPES, GENDERS, RECORD_STATUS, DIAGNOSIS_STATUS, PLAN_TYPES, SUBSCRIBER_RELATIONS,
  CONTACT_CHANNELS, INTAKE_DOCS,
} from '../../lib/intake'

const US_STATES = ['CA', 'OR', 'WA', 'NV', 'AZ', 'TX', 'NY', 'FL', 'IL', 'MA', 'CO', 'GA', 'NC', 'VA', 'MD', 'NJ', 'PA', 'OH', 'MI', 'UT', 'Other']
const PHOTO_MAX_BYTES = 2 * 1024 * 1024

/** One section of the intake form. */
function Sec({ n, title, icon, hint, children, testid }) {
  return (
    <section className="iq-sec" data-testid={testid}>
      <header className="iq-sec-h">
        <span className="iq-sec-n">{n}</span>
        <span className="iq-sec-ic">{Icon[icon]({ size: 13 })}</span>
        <div><b>{title}</b>{hint && <i>{hint}</i>}</div>
      </header>
      <div className="iq-sec-body">{children}</div>
    </section>
  )
}

export default function IntakeFormView() {
  const state = useStore()
  const { actions, ui, referralSources = [], staff = [], payers = [] } = state
  const toast = useToast()
  const fileRef = useRef(null)

  const editingId = ui?.intakeEdit || null
  const existing = editingId ? state.intakeRequests?.[editingId] : null

  const myStaffId = state.currentAccount?.staffId || null
  const [form, setForm] = useState(() => (existing ? { ...blankIntake(), ...existing } : blankIntake({ office: LOCATIONS[0], ownerId: myStaffId, referralDate: todayISO() })))
  const [errs, setErrs] = useState({})
  const [phase, setPhase] = useState('start')
  const [savedId, setSavedId] = useState(editingId || null)

  // Re-hydrate when the drawer sends the user to a different record.
  useEffect(() => {
    if (existing) setForm({ ...blankIntake(), ...existing })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingId])

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))
  const setSub = (k, kk, v) => setForm((f) => ({ ...f, [k]: { ...f[k], [kk]: v } }))
  const setPhone = (i, k, v) => setForm((f) => {
    const phones = f.phones.map((p, idx) => (idx === i ? { ...p, [k]: v } : p))
    return { ...f, phones }
  })

  const reset = () => {
    setForm(blankIntake({ office: LOCATIONS[0], ownerId: myStaffId, referralDate: todayISO() }))
    setErrs({})
    setSavedId(null)
    actions.setUI({ intakeEdit: null })
  }

  /** Validation runs on the fields a downstream module actually consumes. */
  const validate = () => {
    const e = {}
    if (!form.firstName.trim()) e.firstName = 'First name is required'
    if (!form.lastName.trim()) e.lastName = 'Last name is required'
    if (!form.alias.trim()) e.alias = 'Alias / preferred name is required on the intake record'
    if (!form.office) e.office = 'Select the office'
    if (!form.dob) e.dob = 'Date of birth is required — it drives age eligibility and claims'
    else if (form.dob > todayISO()) e.dob = 'Date of birth cannot be in the future'
    if (!form.street.trim()) e.street = 'Street is required'
    if (!form.city.trim()) e.city = 'City is required'
    if (!form.state) e.state = 'State is required'
    if (!/^\d{5}(-\d{4})?$/.test(form.zip.trim())) e.zip = 'ZIP code must be 5 digits (or ZIP+4)'
    const phone = form.phones.find((p) => p.number.trim())
    if (!phone) e.phone = 'At least one phone number is required'
    else if (phone.number.replace(/\D/g, '').length < 10) e.phone = 'Phone number needs at least 10 digits'
    if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) e.email = 'Email address looks invalid'
    if (!form.guardian.name.trim()) e.guardian = 'Guardian name is required — they are the consenting party'
    if (!form.guardian.phone.trim() && !form.guardian.email.trim()) e.guardianContact = 'Guardian needs a phone or email'
    if (!form.ownerId) e.ownerId = 'Assign an intake owner so the request has an accountable person'
    if (form.referralSourceId && !referralSources.some((s) => s.id === form.referralSourceId)) e.referralSourceId = 'Unknown referral source'
    return e
  }

  const save = ({ openPipeline = false } = {}) => {
    const e = validate()
    setErrs(e)
    if (Object.keys(e).length) {
      toast({ message: `Fix ${Object.keys(e).length} field${Object.keys(e).length > 1 ? 's' : ''} before saving`, kind: 'warn' })
      return null
    }
    const record = actions.saveIntake({ ...form, id: savedId || undefined, kind: 'client' })
    setSavedId(record.id)
    setPhase('saved')
    toast({ message: existing ? `${fullName(record)} updated` : `${fullName(record)} added to the intake pipeline`, kind: 'ok' })
    if (openPipeline) actions.setUI({ section: 'intake', intakeSel: record.id, intakeEdit: null })
    return record
  }

  const pickPhoto = (file) => {
    if (!file) return
    if (!/^image\//.test(file.type)) { toast({ message: 'Profile picture must be an image file', kind: 'warn' }); return }
    if (file.size > PHOTO_MAX_BYTES) { toast({ message: 'Profile picture must be under 2 MB', kind: 'warn' }); return }
    // Local-only metadata. Nothing is uploaded or transmitted anywhere; the
    // demo intentionally keeps binary blobs out of the workspace backup.
    set('photo', { name: file.name, size: file.size, type: file.type, at: Date.now() })
    toast({ message: `${file.name} attached to this intake record (stored locally)`, kind: 'ok' })
  }

  const photo = form.photo
  const filled = useMemo(() => {
    const checks = [form.firstName, form.lastName, form.dob, form.street, form.city, form.zip, form.phones[0]?.number, form.guardian.name, form.referralSourceId, form.concerns, form.settingPref !== 'Undecided']
    return Math.round((checks.filter(Boolean).length / checks.length) * 100)
  }, [form])

  const previewReq = { ...form, id: savedId || 'preview', no: form.no || 'INT-NEW' }
  const next = savedId ? nextStages(form.stage).filter((s) => s !== 'closed')[0] : null
  const blockers = savedId && next ? gateBlockers(form, next) : []

  return (
    <div className="sectionpage">
      <SectionBar icon="user" title={existing ? `Client Intake · ${existing.no}` : 'Client Intake'} sub="Capture the referral once — every downstream module reads from this record">
        <span className="iq-completeness" title="Fields that downstream modules depend on">{filled}% complete</span>
        <button className="btn btn-sm" data-testid="iq-form-cancel" onClick={() => { actions.setUI({ section: 'intake', intakeEdit: null }) }}>Cancel</button>
        <button className="btn btn-sm btn-primary" data-testid="iq-form-save" onClick={() => save()}>{Icon.check({ size: 12 })} Save</button>
        <button className="btn btn-sm" data-testid="iq-form-save-open" onClick={() => save({ openPipeline: true })}>Save &amp; open in pipeline</button>
      </SectionBar>

      <div className="sec-body">
        {phase === 'saved' && (
          <div className="iq-banner ok" data-testid="iq-saved-banner">
            {Icon.checkCircle({ size: 14 })}
            <b>Saved.</b>&nbsp;{fullName(previewReq)} is in the pipeline at <b>{stageDef(form.stage).label}</b>
            {blockers.length ? <> — {blockers.length} requirement{blockers.length > 1 ? 's' : ''} before it can advance.</> : ' — ready to advance.'}
            <button className="btn btn-sm" data-testid="iq-saved-open" onClick={() => actions.setUI({ section: 'intake', intakeSel: savedId, intakeEdit: null })}>Open the request</button>
          </div>
        )}

        {Object.keys(errs).length > 0 && (
          <div className="iq-banner bad" data-testid="iq-form-errors">
            {Icon.alert({ size: 14 })} <b>{Object.keys(errs).length} field{Object.keys(errs).length > 1 ? 's' : ''} need attention.</b>
            <ul className="iq-errlist">{Object.values(errs).map((e) => <li key={e}>{e}</li>)}</ul>
          </div>
        )}

        <div className="iq-formcard">
          <header className="iq-formhead">
            <div>
              <b>{existing ? `Edit intake client — ${existing.no}` : 'Add Intake Client'}</b>
              <span>Demographics, referral attribution, screening and benefits — one pass, no duplicate entry later.</span>
            </div>
            <span className="iq-formbadge" aria-hidden="true">{Icon.user({ size: 18 })}</span>
          </header>

          <div className="iq-form-cols">
            {/* ------------ left: identity, contact ------------- */}
            <div>
              <Sec n={1} title="Child information" icon="user" testid="iq-sec-identity">
                <div className="iq-grid2">
                  <label className={`iq-fld ${errs.firstName ? 'bad' : ''}`}><span>First Name <em className="iq-req">*</em></span>
                    <input className="input" value={form.firstName} onChange={(e) => set('firstName', e.target.value)} data-testid="iq-first" />{errs.firstName && <i className="iq-err">{errs.firstName}</i>}</label>
                  <label className="iq-fld"><span>Middle Name</span>
                    <input className="input" value={form.middleName} onChange={(e) => set('middleName', e.target.value)} data-testid="iq-middle" /></label>
                  <label className={`iq-fld ${errs.lastName ? 'bad' : ''}`}><span>Last Name <em className="iq-req">*</em></span>
                    <input className="input" value={form.lastName} onChange={(e) => set('lastName', e.target.value)} data-testid="iq-last" />{errs.lastName && <i className="iq-err">{errs.lastName}</i>}</label>
                  <label className={`iq-fld ${errs.alias ? 'bad' : ''}`}><span>Alias <em className="iq-req">*</em></span>
                    <input className="input" value={form.alias} placeholder="Name used on the calendar" onChange={(e) => set('alias', e.target.value)} data-testid="iq-alias" />{errs.alias && <i className="iq-err">{errs.alias}</i>}</label>
                  <label className={`iq-fld ${errs.office ? 'bad' : ''}`}><span>Office <em className="iq-req">*</em></span>
                    <Dropdown value={form.office} onChange={(v) => set('office', v)} options={LOCATIONS.map((l) => ({ value: l, label: l }))} testid="iq-office" />{errs.office && <i className="iq-err">{errs.office}</i>}</label>
                  <label className={`iq-fld ${errs.dob ? 'bad' : ''}`}><span>DOB <em className="iq-req">*</em></span>
                    <input className="input" type="date" max={todayISO()} value={form.dob} onChange={(e) => set('dob', e.target.value)} data-testid="iq-dob" />{errs.dob && <i className="iq-err">{errs.dob}</i>}</label>
                </div>
                <div className="iq-inline">
                  <span className="iq-inline-l">Gender</span>
                  <div className="iq-seg" role="group" aria-label="Gender">
                    {Object.entries(GENDERS).map(([k, v]) => (
                      <button key={k} type="button" className={form.gender === k ? 'on' : ''} data-testid={`iq-gender-${k}`} onClick={() => set('gender', k)}>{v}</button>
                    ))}
                  </div>
                  <span className="iq-inline-l">Status</span>
                  <div className="iq-seg" role="group" aria-label="Status">
                    {Object.entries(RECORD_STATUS).map(([k, v]) => (
                      <button key={k} type="button" className={form.status === k ? 'on' : ''} data-testid={`iq-status-${k}`} onClick={() => set('status', k)}>{v}</button>
                    ))}
                  </div>
                </div>
              </Sec>

              <Sec n={2} title="Address" icon="house" testid="iq-sec-address">
                <div className="iq-grid2">
                  <label className={`iq-fld wide ${errs.street ? 'bad' : ''}`}><span>Street <em className="iq-req">*</em></span>
                    <input className="input" value={form.street} onChange={(e) => set('street', e.target.value)} data-testid="iq-street" />{errs.street && <i className="iq-err">{errs.street}</i>}</label>
                  <label className={`iq-fld ${errs.city ? 'bad' : ''}`}><span>City <em className="iq-req">*</em></span>
                    <input className="input" value={form.city} onChange={(e) => set('city', e.target.value)} data-testid="iq-city" />{errs.city && <i className="iq-err">{errs.city}</i>}</label>
                  <div className="iq-cityrow">
                    <label className={`iq-fld ${errs.state ? 'bad' : ''}`}><span>State <em className="iq-req">*</em></span>
                      <Dropdown value={form.state} onChange={(v) => set('state', v)} options={US_STATES.map((s) => ({ value: s, label: s }))} testid="iq-state" /></label>
                    <label className={`iq-fld ${errs.zip ? 'bad' : ''}`}><span>Zip Code <em className="iq-req">*</em></span>
                      <input className="input" value={form.zip} onChange={(e) => set('zip', e.target.value)} data-testid="iq-zip" />{errs.zip && <i className="iq-err">{errs.zip}</i>}</label>
                  </div>
                  <label className="iq-fld wide"><span>Address Notes</span>
                    <input className="input" value={form.addressNotes} placeholder="Gate code, unit, parking, pet on site…" onChange={(e) => set('addressNotes', e.target.value)} data-testid="iq-addressnotes" /></label>
                </div>
              </Sec>

              <Sec n={3} title="Contact" icon="phone" testid="iq-sec-contact">
                <div className="iq-phones">
                  {form.phones.map((p, i) => (
                    <div className="iq-phone-row" key={p.id || i}>
                      <label className="iq-fld"><span>{i === 0 ? 'Type' : 'Type'}</span>
                        <Dropdown value={p.type} onChange={(v) => setPhone(i, 'type', v)} options={PHONE_TYPES.map((t) => ({ value: t, label: t }))} testid={`iq-ptype-${i}`} /></label>
                      <label className={`iq-fld ${errs.phone && i === 0 ? 'bad' : ''}`}><span>Phone Number{errs.phone && i === 0 && <em className="iq-req"> *</em>}</span>
                        <input className="input" value={p.number} placeholder="(408) 555-0100" onChange={(e) => setPhone(i, 'number', e.target.value)} data-testid={`iq-phone-${i}`} />{errs.phone && i === 0 && <i className="iq-err">{errs.phone}</i>}</label>
                      <label className="iq-fld iq-ext"><span>Ext.</span>
                        <input className="input" value={p.ext || ''} onChange={(e) => setPhone(i, 'ext', e.target.value)} data-testid={`iq-pext-${i}`} /></label>
                      <label className="iq-fld iq-primary"><span>Primary</span>
                        <button type="button" className={`iq-toggle ${p.primary ? 'on' : ''}`} data-testid={`iq-pprimary-${i}`} onClick={() => setForm((f) => ({ ...f, phones: f.phones.map((x, idx) => ({ ...x, primary: idx === i })) }))}><span>{p.primary ? 'Yes' : 'No'}</span><i /></button></label>
                    </div>
                  ))}
                  <button className="btn btn-sm" data-testid="iq-add-phone" onClick={() => set('phones', [...form.phones, { id: `ph-${form.phones.length + 1}`, type: 'Other', number: '', ext: '', primary: false }])}>{Icon.plus({ size: 11 })} Add another number</button>
                </div>
                <div className="iq-grid2">
                  <label className={`iq-fld wide ${errs.email ? 'bad' : ''}`}><span>Email Address</span>
                    <input className="input" type="email" value={form.email} onChange={(e) => set('email', e.target.value)} data-testid="iq-email" />{errs.email && <i className="iq-err">{errs.email}</i>}</label>
                </div>
                <div className="iq-grid2">
                  <label className="iq-fld"><span>Preferred language</span>
                    <Dropdown value={form.preferredLanguage} onChange={(v) => set('preferredLanguage', v)} options={LANGUAGE_OPTIONS.map((l) => ({ value: l, label: l }))} testid="iq-language" searchable /></label>
                  <label className="iq-fld"><span>Interpreter needed</span>
                    <button type="button" className={`iq-toggle ${form.interpreter ? 'on' : ''}`} data-testid="iq-interpreter" onClick={() => set('interpreter', !form.interpreter)}><span>{form.interpreter ? 'Yes' : 'No'}</span><i /></button></label>
                </div>
                <div className="iq-photo">
                  <span className="iq-inline-l">Profile picture</span>
                  <button type="button" className="btn btn-sm btn-primary" data-testid="iq-photo-pick" onClick={() => fileRef.current?.click()}>{Icon.file({ size: 12 })} Choose File</button>
                  <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} data-testid="iq-photo-input" onChange={(e) => pickPhoto(e.target.files?.[0])} />
                  <span className="muted" data-testid="iq-photo-name">{photo ? `${photo.name} · ${Math.round(photo.size / 1024)} KB` : 'Upload profile picture'}</span>
                  {photo && <button className="btn btn-sm" data-testid="iq-photo-clear" onClick={() => set('photo', null)}>Remove</button>}
                </div>
                <p className="iq-note">{Icon.info({ size: 11 })} The image is referenced locally in this browser demo — it is never uploaded, and binary content is deliberately excluded from workspace backups.</p>
              </Sec>
            </div>

            {/* ------------ right: guardian, referral, clinical, benefits ------------- */}
            <div>
              <Sec n={4} title="Guardian & emergency contact" icon="heart" testid="iq-sec-guardian">
                <div className="iq-grid2">
                  <label className={`iq-fld ${errs.guardian ? 'bad' : ''}`}><span>Guardian name <em className="iq-req">*</em></span>
                    <input className="input" value={form.guardian.name} onChange={(e) => setSub('guardian', 'name', e.target.value)} data-testid="iq-guardian" />{errs.guardian && <i className="iq-err">{errs.guardian}</i>}</label>
                  <label className="iq-fld"><span>Relationship</span>
                    <input className="input" value={form.guardian.relation} placeholder="Mother / Father / Legal guardian" onChange={(e) => setSub('guardian', 'relation', e.target.value)} data-testid="iq-guardian-rel" /></label>
                  <label className={`iq-fld ${errs.guardianContact ? 'bad' : ''}`}><span>Guardian phone</span>
                    <input className="input" value={form.guardian.phone} onChange={(e) => setSub('guardian', 'phone', e.target.value)} data-testid="iq-guardian-phone" />{errs.guardianContact && <i className="iq-err">{errs.guardianContact}</i>}</label>
                  <label className="iq-fld"><span>Guardian email</span>
                    <input className="input" type="email" value={form.guardian.email} onChange={(e) => setSub('guardian', 'email', e.target.value)} data-testid="iq-guardian-email" /></label>
                  <label className="iq-fld"><span>Emergency contact</span>
                    <input className="input" value={form.emergency.name} onChange={(e) => setSub('emergency', 'name', e.target.value)} data-testid="iq-emergency" /></label>
                  <label className="iq-fld"><span>Emergency phone</span>
                    <input className="input" value={form.emergency.phone} onChange={(e) => setSub('emergency', 'phone', e.target.value)} data-testid="iq-emergency-phone" /></label>
                  <label className="iq-fld wide"><span>Guardianship / custody note</span>
                    <input className="input" value={form.guardianshipNote} placeholder="Only if someone other than the parent consents — this adds a required document" onChange={(e) => set('guardianshipNote', e.target.value)} data-testid="iq-guardianship" /></label>
                </div>
              </Sec>

              <Sec n={5} title="Referral & source" icon="zap" hint="Attribution is carried onto the client chart — it powers the source scorecard." testid="iq-sec-referral">
                <div className="iq-grid2">
                  <label className={`iq-fld ${errs.referralSourceId ? 'bad' : ''}`}><span>Referral source</span>
                    <Dropdown value={form.referralSourceId || ''} onChange={(v) => set('referralSourceId', v || null)} options={[{ value: '', label: 'Not recorded' }, ...referralSources.filter((s) => s.status !== 'inactive').map((s) => ({ value: s.id, label: s.name, sub: `${s.kind}${s.contact && s.contact !== '—' ? ` · ${s.contact}` : ''}` }))]} testid="iq-source" searchable />
                    {errs.referralSourceId && <i className="iq-err">{errs.referralSourceId}</i>}</label>
                  <label className="iq-fld"><span>Channel</span>
                    <Dropdown value={form.referralChannel} onChange={(v) => set('referralChannel', v)} options={CONTACT_CHANNELS.map((c) => ({ value: c, label: c }))} testid="iq-channel" /></label>
                  <label className="iq-fld"><span>Referring person</span>
                    <input className="input" value={form.referredByName} onChange={(e) => set('referredByName', e.target.value)} data-testid="iq-referredby" /></label>
                  <label className="iq-fld"><span>Referring NPI</span>
                    <input className="input" value={form.referringNpi} onChange={(e) => set('referringNpi', e.target.value)} data-testid="iq-referringnpi" /></label>
                  <label className="iq-fld"><span>Referral date</span>
                    <input className="input" type="date" value={form.referralDate} onChange={(e) => set('referralDate', e.target.value)} data-testid="iq-referraldate" /></label>
                  <label className={`iq-fld ${errs.ownerId ? 'bad' : ''}`}><span>Intake owner <em className="iq-req">*</em></span>
                    <Dropdown value={form.ownerId || ''} onChange={(v) => set('ownerId', v || null)} options={staff.map((s) => ({ value: s.id, label: s.name, sub: s.role }))} testid="iq-owner" searchable />{errs.ownerId && <i className="iq-err">{errs.ownerId}</i>}</label>
                  <label className="iq-fld wide"><span>Referral notes</span>
                    <input className="input" value={form.referralNotes} onChange={(e) => set('referralNotes', e.target.value)} data-testid="iq-referralnotes" /></label>
                </div>
              </Sec>

              <Sec n={6} title="Clinical screening" icon="eye" testid="iq-sec-clinical">
                <div className="iq-grid2">
                  <label className="iq-fld"><span>Diagnosis status</span>
                    <Dropdown value={form.diagnosisStatus} onChange={(v) => set('diagnosisStatus', v)} options={Object.entries(DIAGNOSIS_STATUS).map(([k, v]) => ({ value: k, label: v.label }))} testid="iq-dxstatus" /></label>
                  <label className="iq-fld"><span>Urgency</span>
                    <Dropdown value={form.urgency} onChange={(v) => set('urgency', v)} options={URGENCY_IDS.map((u) => ({ value: u, label: URGENCY[u].label, sub: URGENCY[u].hint }))} testid="iq-urgency" /></label>
                  <label className="iq-fld wide"><span>Diagnosis / evaluation on record</span>
                    <input className="input" value={form.diagnosis} onChange={(e) => set('diagnosis', e.target.value)} data-testid="iq-dx" /></label>
                  <label className="iq-fld wide"><span>Caregiver concerns & goals</span>
                    <input className="input" value={form.concerns} onChange={(e) => set('concerns', e.target.value)} data-testid="iq-concerns" /></label>
                  <label className="iq-fld"><span>Preferred setting</span>
                    <Dropdown value={form.settingPref} onChange={(v) => set('settingPref', v)} options={SETTING_PREFS.map((s) => ({ value: s, label: s }))} testid="iq-setting" /></label>
                  <label className="iq-fld"><span>Service line</span>
                    <Dropdown value={form.serviceLine} onChange={(v) => set('serviceLine', v)} options={[{ value: '', label: 'Not decided' }, ...SERVICE_LINES.map((s) => ({ value: s, label: s }))]} testid="iq-serviceline" /></label>
                  <label className="iq-fld"><span>Program (becomes the client program)</span>
                    <Dropdown value={form.program} onChange={(v) => set('program', v)} options={[{ value: '', label: 'Not decided' }, ...INTAKE_PROGRAMS.map((s) => ({ value: s, label: s }))]} testid="iq-program" /></label>
                  <label className="iq-fld"><span>Living situation</span>
                    <Dropdown value={form.livingArrangement} onChange={(v) => set('livingArrangement', v)} options={[{ value: '', label: 'Not recorded' }, ...LIVING_ARRANGEMENTS.map((s) => ({ value: s, label: s }))]} testid="iq-living" /></label>
                  <label className="iq-fld"><span>School / childcare</span>
                    <input className="input" value={form.schoolName} onChange={(e) => set('schoolName', e.target.value)} data-testid="iq-school" /></label>
                  <label className="iq-fld"><span>IEP / IFSP on file</span>
                    <button type="button" className={`iq-toggle ${form.iep ? 'on' : ''}`} data-testid="iq-iep" onClick={() => set('iep', !form.iep)}><span>{form.iep ? 'Yes' : 'No'}</span><i /></button></label>
                  <label className="iq-fld wide"><span>Safety risks / medical notes</span>
                    <input className="input" value={form.safetyRisks} onChange={(e) => set('safetyRisks', e.target.value)} data-testid="iq-safety" /></label>
                  <label className="iq-fld"><span>Availability</span>
                    <input className="input" value={form.availabilityNotes} placeholder="Weekday mornings; school pickup 2pm" onChange={(e) => set('availabilityNotes', e.target.value)} data-testid="iq-availability" /></label>
                </div>
              </Sec>

              <Sec n={7} title="Insurance & benefits" icon="shield" hint="A five-minute VOB here prevents the most common denial later." testid="iq-sec-benefits">
                <div className="iq-grid2">
                  <label className="iq-fld"><span>Primary payer</span>
                    <Dropdown value={form.payerId || ''} onChange={(v) => set('payerId', v || null)} options={[{ value: '', label: 'Not selected (self-pay)' }, ...payers.filter((p) => p.status === 'active').map((p) => ({ value: p.id, label: p.name, sub: p.type }))]} testid="iq-payer" searchable /></label>
                  <label className="iq-fld"><span>Plan type</span>
                    <Dropdown value={form.planType} onChange={(v) => set('planType', v)} options={PLAN_TYPES.map((p) => ({ value: p, label: p }))} testid="iq-plantype" /></label>
                  <label className="iq-fld"><span>Member ID</span>
                    <input className="input" value={form.memberId} onChange={(e) => set('memberId', e.target.value)} data-testid="iq-memberid" /></label>
                  <label className="iq-fld"><span>Group number</span>
                    <input className="input" value={form.groupNumber} onChange={(e) => set('groupNumber', e.target.value)} data-testid="iq-group" /></label>
                  <label className="iq-fld"><span>Subscriber name</span>
                    <input className="input" value={form.subscriberName} onChange={(e) => set('subscriberName', e.target.value)} data-testid="iq-subscriber" /></label>
                  <label className="iq-fld"><span>Subscriber DOB</span>
                    <input className="input" type="date" value={form.subscriberDob} onChange={(e) => set('subscriberDob', e.target.value)} data-testid="iq-subdob" /></label>
                  <label className="iq-fld"><span>Subscriber relationship</span>
                    <Dropdown value={form.subscriberRelation} onChange={(v) => set('subscriberRelation', v)} options={SUBSCRIBER_RELATIONS.map((p) => ({ value: p, label: p }))} testid="iq-subrel" /></label>
                  <label className="iq-fld"><span>Secondary payer (COB)</span>
                    <Dropdown value={form.secondaryPayerId || ''} onChange={(v) => set('secondaryPayerId', v || null)} options={[{ value: '', label: 'None' }, ...payers.filter((p) => p.status === 'active').map((p) => ({ value: p.id, label: p.name }))]} testid="iq-secondary" searchable /></label>
                </div>
                <p className="iq-note">{Icon.info({ size: 11 })} Benefits are verified in full on the request itself (Benefits tab), where the payer representative, call date and reference number are recorded — {INTAKE_DOCS.length} tracked documents follow the same checklist.</p>
              </Sec>

              <Sec n={8} title="Notes & tags" icon="edit" testid="iq-sec-notes">
                <label className="iq-fld wide"><span>Internal notes</span>
                  <textarea className="input iq-textarea" rows={3} value={form.notes} onChange={(e) => set('notes', e.target.value)} data-testid="iq-notes" /></label>
                <div className="iq-photo" style={{ marginTop: 8 }}>
                  <span className="iq-inline-l">Roster colour</span>
                  <div className="pm-swatches" data-testid="iq-colors">
                    {COLORS.map((c) => (
                      <button key={c} type="button" title={c} data-testid={`iq-color-${c}`} className={`pm-sw ${form.avatarColor === c ? 'on' : ''}`} style={{ background: c }} onClick={() => set('avatarColor', c)} />
                    ))}
                  </div>
                </div>
                <AvatarPicker form={form} set={set} idp="iq" />
              </Sec>
            </div>
          </div>

          <footer className="iq-formfoot">
            <label className="iq-fld iq-ownerpick"><span>Intake owner</span>
              <Dropdown value={form.ownerId || ''} onChange={(v) => set('ownerId', v || null)} options={staff.map((s) => ({ value: s.id, label: s.name, sub: s.role }))} testid="iq-owner-foot" searchable /></label>
            <span className={`iq-footmsg ${Object.keys(errs).length ? 'bad' : ''}`} data-testid="iq-foot-msg">
              {Object.keys(errs).length ? `${Object.keys(errs).length} field(s) need attention before saving` : 'Please remember to save your changes'}
            </span>
            <div className="iq-foot-acts">
              <button className="btn btn-sm btn-primary" data-testid="iq-foot-save" onClick={() => save()}>{Icon.check({ size: 12 })} Save</button>
              <button className="btn btn-sm" data-testid="iq-foot-cancel" onClick={() => { actions.setUI({ section: 'intake', intakeEdit: null }) }}>Cancel</button>
              {savedId && <button className="btn btn-sm" data-testid="iq-foot-reset" onClick={reset}>New intake</button>}
            </div>
          </footer>
        </div>
      </div>
    </div>
  )
}
