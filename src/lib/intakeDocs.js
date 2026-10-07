// ---- Intake documents: a filled request summary and a blank intake packet, as PDFs ----
// The builders are pure (a {title, subtitle, note, sections} description that tests can
// read); docToPdf turns one into a jsPDF document. Everything is generated in this
// browser; nothing is sent anywhere.
import { newPdf } from './exportKit'
import {
  INTAKE_DOCS, CONSENT_KINDS, VOB_FIELDS, AUTH_DECISIONS, ASSESSMENT_OUTCOMES,
  fullName, primaryPhone, referralLabel, stageDef, docStatus, requiredDocs, requiredConsents, consentSigned,
} from './intake'

const v = (x) => (x === undefined || x === null || String(x).trim() === '' ? '—' : String(x))
const yn = (b) => (b === true ? 'Yes' : b === false ? 'No' : '—')
const row = (label, value) => ({ label, value })
const blank = (label) => ({ label, value: null })

/** Everything on one intake request, grouped the way the intake team works through it. */
export function intakeSummaryDoc(state, req) {
  const staffName = (id) => (state.staff || []).find((s) => s.id === id)?.name || ''
  const payerName = (id) => (state.payers || []).find((p) => p.id === id)?.name || ''
  const g = req.guardian || {}
  const e = req.emergency || {}
  const vob = req.vob || {}
  const as = req.assessment || {}
  const au = req.auth || {}
  const address = [req.street, req.city, [req.state, req.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ')
  const required = new Set(requiredDocs(req).map((d) => d.id))
  const neededConsents = new Set(requiredConsents(req).map((c) => c.id))
  return {
    title: `Intake request ${v(req.no)} · ${fullName(req)}`,
    subtitle: `${state.settings?.org?.name || 'Practice'} · stage: ${stageDef(req.stage).label}`,
    note: 'Generated in this browser from the intake record. Nothing was sent. Contains client information: store and share it as the practice requires.',
    sections: [
      { heading: 'Child', rows: [
        row('Name', fullName(req)), row('Goes by', v(req.alias)), row('Date of birth', v(req.dob)), row('Gender', v(req.gender)),
        row('Preferred language', `${v(req.preferredLanguage)}${req.interpreter ? ' (interpreter needed)' : ''}`),
        row('Address', v(address)), row('Phone', v(primaryPhone(req))), row('Email', v(req.email)),
        row('School', `${v(req.schoolName)}${req.iep ? ' · IEP on file' : ''}`), row('Living arrangement', v(req.livingArrangement)),
      ] },
      { heading: 'Guardian and emergency contact', rows: [
        row('Guardian', [g.name, g.relation].filter(Boolean).join(' · ') || '—'), row('Guardian phone', v(g.phone)), row('Guardian email', v(g.email)),
        row('Emergency contact', [e.name, e.relation, e.phone].filter(Boolean).join(' · ') || '—'), row('Guardianship note', v(req.guardianshipNote)),
      ] },
      { heading: 'Referral', rows: [
        row('Source', referralLabel(req, state.referralSources)), row('Referred by', [req.referredByName, req.referredByOrg].filter(Boolean).join(' · ') || '—'),
        row('Referring NPI', v(req.referringNpi)), row('Referral date', v(req.referralDate)), row('Channel', v(req.referralChannel)), row('Notes', v(req.referralNotes)),
      ] },
      { heading: 'Clinical', rows: [
        row('Diagnosis', `${v(req.diagnosis)} (${v(req.diagnosisStatus)})`), row('Diagnosed by / on', [req.diagnosedBy, req.diagnosedOn].filter(Boolean).join(' · ') || '—'),
        row('Concerns', v(req.concerns)), row('Prior therapy', `${yn(req.priorTherapy)}${req.priorTherapyNotes ? ` · ${req.priorTherapyNotes}` : ''}`),
        row('Medications', v(req.medications)), row('Allergies', v(req.allergies)), row('Safety risks', v(req.safetyRisks)),
        row('Setting', v(req.settingPref)), row('Service line / program', [req.serviceLine, req.program].filter(Boolean).join(' · ') || '—'),
        row('Availability', [req.preferredDays, req.preferredTimes, req.availabilityNotes].filter(Boolean).join(' · ') || '—'),
        row('Assigned BCBA', v(staffName(req.bcbaAssignedId))), row('Screening fit', v(req.screen?.fit)),
      ] },
      { heading: 'Insurance and benefits', rows: [
        row('Payer', v(payerName(req.payerId))), row('Secondary payer', v(payerName(req.secondaryPayerId))),
        row('Member ID', v(req.memberId)), row('Group number', v(req.groupNumber)), row('Plan type', v(req.planType)),
        row('Subscriber', [req.subscriberName, req.subscriberDob, req.subscriberRelation].filter(Boolean).join(' · ') || '—'),
        row('Benefits check', `${v(vob.status)}${vob.repName ? ` · rep ${vob.repName}` : ''}${vob.refNo ? ` · ref ${vob.refNo}` : ''}`),
        ...VOB_FIELDS.map((f) => row(f.label, f.kind === 'bool' ? yn(vob[f.id]) : v(vob[f.id]))),
      ] },
      { heading: 'Assessment and authorization', rows: [
        row('Assessment visit', [req.apptDate, staffName(req.clinicianId)].filter(Boolean).join(' · ') || '—'),
        row('Assessment', [as.date, as.instrument, ASSESSMENT_OUTCOMES[as.outcome]?.label].filter(Boolean).join(' · ') || '—'),
        row('Recommended', [as.recommendedHoursPerWeek && `${as.recommendedHoursPerWeek} h/week`, as.recommendedSetting].filter(Boolean).join(' · ') || '—'),
        row('Authorization submitted', v(au.submittedAt)), row('Units requested', v(au.unitsRequested)), row('Units approved (15-min)', v(au.units)),
        row('Window', [au.windowStart, au.windowEnd].filter(Boolean).join(' → ') || '—'),
        row('Decision', v(AUTH_DECISIONS[au.decision]?.label)), row('Authorization #', v(au.authNo)),
      ] },
      { heading: 'Documents', rows: INTAKE_DOCS.map((d) => row(`${d.label}${required.has(d.id) ? ' (required)' : ''}`, docStatus(req, d.id))) },
      { heading: 'Consents', rows: CONSENT_KINDS.map((c) => row(`${c.label}${neededConsents.has(c.id) ? ' (required)' : ''}`, consentSigned(req, c.id) ? 'Signed' : 'Not signed')) },
    ],
  }
}

/** The blank packet a family fills in before the first call or visit. */
export function intakePacketDoc(state) {
  const org = state.settings?.org || {}
  return {
    title: `${org.name || 'Practice'} · New client intake packet`,
    subtitle: [org.address, org.phone].filter(Boolean).join(' · '),
    note: 'Please complete every page and bring it, with copies of the documents checked below, to the first visit. The practice provides its own consent wording; this packet lists which consents are needed and collects the signatures.',
    sections: [
      { heading: 'About the child', rows: ['Full name', 'Goes by', 'Date of birth', 'Gender', 'Preferred language / interpreter needed?', 'Home address', 'Phone', 'Email', 'School and grade (IEP / IFSP / 504?)', 'Who the child lives with'].map(blank) },
      { heading: 'Parent or guardian', rows: ['Name and relationship', 'Phone', 'Email', 'Address (if different)', 'Custody or guardianship arrangements'].map(blank) },
      { heading: 'Emergency contact', rows: ['Name and relationship', 'Phone'].map(blank) },
      { heading: 'Referral', rows: ['Who referred you (person / organisation)', 'Referring provider NPI (if known)', 'Referral date'].map(blank) },
      { heading: 'Health and development', rows: ['Diagnosis, who diagnosed, and when', 'Main concerns', 'Prior therapy (what, where, when)', 'Medications', 'Allergies', 'Safety concerns (elopement, aggression, pica, …)', 'Preferred setting (home / center / school / telehealth)', 'Days and times that work'].map(blank) },
      { heading: 'Insurance', rows: ['Primary insurance company', 'Member ID', 'Group number', 'Subscriber name, date of birth, relationship to child', 'Secondary insurance (if any) and member ID'].map(blank) },
      { heading: 'Documents to bring', kind: 'checklist', rows: INTAKE_DOCS.filter((d) => !['consent_treat', 'hipaa_roi', 'financial_resp'].includes(d.id)).map((d) => ({ label: d.label, value: d.hint || '' })) },
      { heading: 'Consents', kind: 'signatures', rows: CONSENT_KINDS.map((c) => ({ label: c.label, value: c.required ? 'Required' : 'Optional' })) },
    ],
  }
}

/** Render a document description as a letter-size PDF. */
export function docToPdf(doc) {
  const pdf = newPdf({ unit: 'pt', format: 'letter' })
  const W = pdf.internal.pageSize.getWidth()
  const H = pdf.internal.pageSize.getHeight()
  const M = 48
  const labelW = 190
  let y = M
  const ensure = (h) => { if (y + h > H - M) { pdf.addPage(); y = M } }
  const text = (s, x, size = 9, style = 'normal', width = W - M - x) => {
    pdf.setFont('helvetica', style); pdf.setFontSize(size)
    const lines = pdf.splitTextToSize(String(s), width)
    pdf.text(lines, x, y)
    return lines.length * size * 1.25
  }

  y += text(doc.title, M, 15, 'bold')
  if (doc.subtitle) y += text(doc.subtitle, M, 9)
  if (doc.note) { y += 4; y += text(doc.note, M, 8, 'italic') }
  y += 8

  for (const sec of doc.sections) {
    ensure(40)
    y += 10
    y += text(sec.heading, M, 11, 'bold')
    pdf.setDrawColor(180); pdf.line(M, y - 6, W - M, y - 6)
    y += 4
    for (const r of sec.rows) {
      if (sec.kind === 'checklist') {
        ensure(24)
        pdf.rect(M, y - 8, 9, 9)
        const h = text(r.label, M + 16, 9, 'bold', labelW + 60)
        if (r.value) text(r.value, M + labelW + 86, 8, 'normal', W - M - (M + labelW + 86))
        y += Math.max(h, 12) + 2
      } else if (sec.kind === 'signatures') {
        ensure(48)
        y += text(`${r.label} (${r.value})`, M, 9, 'bold')
        y += 18
        pdf.line(M, y, M + 260, y); pdf.line(M + 300, y, W - M, y)
        y += 10
        text('Parent / guardian signature', M, 7); text('Date', M + 300, 7)
        y += 12
      } else if (r.value === null) {
        ensure(24)
        text(r.label, M, 9, 'bold', labelW - 8)
        pdf.line(M + labelW, y + 2, W - M, y + 2)
        y += 20
      } else {
        ensure(30)
        const lh = Math.max(text(r.label, M, 9, 'bold', labelW - 8), text(r.value, M + labelW, 9, 'normal'))
        y += lh + 3
      }
    }
  }
  const pages = pdf.getNumberOfPages()
  for (let i = 1; i <= pages; i++) {
    pdf.setPage(i); pdf.setFont('helvetica', 'normal'); pdf.setFontSize(7)
    pdf.text(`${doc.title} · page ${i} of ${pages}`, M, H - 24)
  }
  return pdf
}
