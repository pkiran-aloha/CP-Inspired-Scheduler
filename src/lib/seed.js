// ---- Deterministic rich demo data, anchored to the current week ----
import { addDays, isoDate, pad, parseISO, todayISO } from './date'
import { uid, autoBilling, VERIFY_CHECKS, SERVICES, BILL_CODES } from './model'
import { SMART_DEFAULTS } from './smart'
import { stagedAppts, planClaims, assembleClaims, PAYER_POLICY, DENIAL_REASONS, nextClaimSeq } from './claims'

function mulberry32(a) {
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const pick = (rnd, arr) => arr[Math.floor(rnd() * arr.length)]

// fte / targetWeekH drive the utilization & payroll analytics; payrollRate feeds the cost report
export const STAFF = [
  { id: 's1', name: 'Prateek Kiran', initials: 'PK', color: '#6366f1', role: 'BCBA · Clinical Supervisor', cert: 'BCBA #5-12-0034', email: 'prateek.kiran@alohaaba.com', fte: 1, targetWeekH: 32, payrollRate: 52 , avatar: 'fox', phone: '(408) 555-0121'},
  { id: 's2', name: 'Neha Peyyeti', initials: 'NP', color: '#0ea5e9', role: 'BCaBA · Center Lead', cert: 'BCaBA #5-23-0911', email: 'neha.peyyeti@alohaaba.com', fte: 1, targetWeekH: 34, payrollRate: 41 , avatar: 'panda', phone: '(408) 555-0122'},
  { id: 's3', name: 'Saija Kotha', initials: 'SK', color: '#10b981', role: 'RBT · EIBI', cert: 'RBT #24-08-1177', email: 'saija.kotha@alohaaba.com', fte: 1, targetWeekH: 36, payrollRate: 27 , avatar: 'cat', phone: '(408) 555-0123'},
  { id: 's4', name: 'Saumya Chitranshi', initials: 'SC', color: '#f59e0b', role: 'RBT · Home Programs', cert: 'RBT #23-11-0450', email: 'saumya.ch@alohaaba.com', fte: 1, targetWeekH: 36, payrollRate: 26 , avatar: 'bear', phone: '(408) 555-0124'},
  { id: 's5', name: 'Munna Sala', initials: 'MS', color: '#8b5cf6', role: 'Student Therapist', cert: 'TC-BCBA (trainee)', email: 'munna.sala@alohaaba.com', fte: 0.6, targetWeekH: 22, payrollRate: 18 , avatar: 'owl', phone: '(408) 555-0125'},
  { id: 's6', name: 'Chandan Gupta', initials: 'CG', color: '#ef4444', role: 'Psychologist · Assessments', cert: 'PsyD #27655', email: 'chandan.gupta@alohaaba.com', fte: 0.8, targetWeekH: 26, payrollRate: 63 , avatar: 'penguin', phone: '(408) 555-0126'},
  { id: 's7', name: 'Dhananjay Masal', initials: 'DM', color: '#06b6d4', role: 'RBT · School-based', cert: 'RBT #22-06-2280', email: 'dhananjay.m@alohaaba.com', fte: 1, targetWeekH: 34, payrollRate: 26 , avatar: 'frog', phone: '(408) 555-0127'},
  { id: 's8', name: 'Rohit Srivastava', initials: 'RS', color: '#14b8a6', role: 'BCBA', cert: 'BCBA #5-14-0788', email: 'rohit.sriv@alohaaba.com', fte: 1, targetWeekH: 30, payrollRate: 49 , avatar: 'bunny', phone: '(408) 555-0128'},
  { id: 's9', name: 'Shishir Sharma', initials: 'SS', color: '#f97316', role: 'BCBA · Field Coordinator', cert: 'BCBA #5-09-0121', email: 'shishir.sharma@alohaaba.com', fte: 1, targetWeekH: 30, payrollRate: 48 , avatar: 'koala', phone: '(408) 555-0129'},
  { id: 's10', name: 'Brook Joyce', initials: 'BJ', color: '#a855f7', role: 'Lead RBT', cert: 'RBT #21-03-0904', email: 'brook.joyce@alohaaba.com', fte: 1, targetWeekH: 38, payrollRate: 29 , avatar: 'sloth', phone: '(408) 555-0130'},
  { id: 's11', name: 'Michael McDonald', initials: 'MM', color: '#22c55e', role: 'Speech-Language Pathologist', cert: 'CCC-SLP #G45-0012', email: 'michael.mcd@alohaaba.com', fte: 0.5, targetWeekH: 18, payrollRate: 55 , avatar: 'octopus', phone: '(408) 555-0131'},
  { id: 's12', name: 'Anik Gajjar', initials: 'AG', color: '#e11d48', role: 'Scheduler & Billing Coordinator', cert: 'CPC', email: 'anik.gajjar@alohaaba.com', fte: 1, targetWeekH: 20, payrollRate: 34 , avatar: 'unicorn', phone: '(408) 555-0132'},
]
export const STAFF_BY_ID = Object.fromEntries(STAFF.map((s) => [s.id, s]))

const G = (n) => 8 * 60 + n * 60 // hour helper

// authorization windows are anchored to "today" so burn-down / expiry analytics are meaningful whenever the demo is seeded
const AUTH_TODAY = new Date()
const authWin = (i) => ({
  authStart: isoDate(new Date(AUTH_TODAY.getFullYear(), AUTH_TODAY.getMonth(), AUTH_TODAY.getDate() - 98)),
  // every 4th authorization expires within 30 days → validation catches it; the rest run 2–7 months out
  authEnd: isoDate(new Date(AUTH_TODAY.getFullYear(), AUTH_TODAY.getMonth(), AUTH_TODAY.getDate() + [18, 122, 88, 26, 151, 60, 140, 21, 97, 130, 74, 33, 118, 92, 45, 156][i % 16])),
})
const INSURERS = ['Blue Shield CA', 'Aetna', 'Regence BCBS', 'UnitedHealthcare', 'Medicaid (CA)', 'Self-pay']

// ---- Payer master ----------------------------------------------------------------
// One directory record per payer. Claims math keeps reading PAYER_POLICY by name
// (untouched); the master adds identity, mailing, contacts and portal data.
// Every INSURERS name below has exactly one master record so nothing dangles.
const py = (name, aka, type, svcList, required, status, o = {}) => ({
  id: 'py-' + name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
  name, aka, type, svcList, required, status,
  street: o.street || '', city: o.city || '', state: o.state || 'CA', zip: o.zip || '', addressNotes: o.addressNotes || '',
  contacts: o.contacts || [{ kind: 'Main', number: o.phone || '' }].filter((c) => c.number || o.phone),
  evvId: o.evvId || '', email: o.email || '', thirdPartyId: o.thirdPartyId || '',
  policy: PAYER_POLICY[name] || { kind: 'commercial', avgDays: 25, timely: 120, coins: 0.8, copay: 0 },
})
export const PAYERS = [
  py('Blue Shield CA', 'BSCA', 'Insurance', 'ABA + related services', 'Yes — after authorization is on file', 'active', { street: '333 Market St', city: 'San Francisco', zip: '94111', phone: '(800) 555-0114', contacts: [{ kind: 'Main', number: '(800) 555-0114' }, { kind: 'Fax', number: '(866) 555-0114' }], email: 'behavioral.reviews@bsca.example.com', evvId: 'BSCA-4471', thirdPartyId: 'TPA-1180' }),
  py('Aetna', 'Aetna Better Health of CA', 'Insurance', 'ABA Standard', 'Yes — after authorization is on file', 'active', { street: '360 W 1st St', city: 'Long Beach', zip: '90802', phone: '(800) 555-0127', contacts: [{ kind: 'Main', number: '(800) 555-0127' }, { kind: 'Fax', number: '(562) 555-0127' }, { kind: 'Claims portal', number: 'auths.aetna.example.com/aba' }], email: 'provider.relations@aetna.example.com', evvId: 'AET-LB-221' }),
  py('Regence BCBS', '', 'Insurance', 'ABA + related services', 'No', 'active', { street: '700 SW 36th Ave', city: 'Tualatin', state: 'OR', zip: '97062', phone: '(800) 555-0136', contacts: [{ kind: 'Main', number: '(800) 555-0136' }, { kind: 'Fax', number: '(503) 555-0136' }], email: 'aba.intake@regence.example.com', evvId: 'REG-OR-830' }),
  py('UnitedHealthcare', 'UHC Community Plan', 'Insurance', 'ABA Standard', 'Yes — after authorization is on file', 'active', { street: '2801 N Main St', city: 'Santa Ana', zip: '92705', phone: '(844) 555-0149', contacts: [{ kind: 'Main', number: '(844) 555-0149' }, { kind: 'Claims portal', number: 'prov-portal.uhc.example.com' }], email: 'ca.medicaidUHCP@uhc.example.com', evvId: 'UHC-CA-115', thirdPartyId: 'FACET-7741' }),
  py('Medicaid (CA)', 'Medi-Cal', 'Government', 'ABA Standard', 'No', 'active', { street: '701 P St', city: 'Sacramento', zip: '95814', phone: '(800) 555-0158', addressNotes: 'Eligibility file via county welfare node, not state line.', email: 'dhcs.provider@ca.example.gov', evvId: 'MEDI-CAL-001' }),
  py('Self-pay', 'Private Pay', 'Self-pay', 'None', 'No', 'active', { addressNotes: 'Family invoice mailed monthly; no payer record on file.', email: 'billing.office@aloha.example.com' }),
  py('Fremont Unified School District', 'FUSD', 'School district', 'School-based', 'No', 'active', { street: '3315 Old Gilman St', city: 'Fremont', zip: '94538', phone: '(510) 555-0171', contacts: [{ kind: 'Main', number: '(510) 555-0171' }, { kind: 'Fax', number: '(510) 555-0172' }], email: 'special.edservices@fusd.example.edu', evvId: 'FUSD-SEPA-9' }),
  py('Northstar Pediatric Network', 'NPN', 'Insurance', 'ABA Standard', 'Yes', 'active', { street: '510 S Buena Vista St', city: 'Burbank', zip: '91505', phone: '(818) 555-0184', email: 'pednet.auths@northstar.example.com', evvId: 'NPN-PED-330' }),
  py('Coastline Specialty Plan', 'CSP', 'Employer plan', 'Telehealth', 'No', 'active', { street: '1 Marina Blvd', city: 'Daly City', zip: '94015', phone: '(650) 555-0193', email: 'specialtycoast@csp.example.com' }),
  py('Valley Children’s Services', 'VCS', 'Government', 'School-based', 'No', 'inactive', { street: '1400 F St', city: 'Fresno', zip: '93721', phone: '(559) 555-0202', addressNotes: 'Contract paused pending FY re-bid.', email: 'contracts@vcs.example.gov' }),
  py('Golden State Health Alliance', 'GSHA', 'Insurance', 'None', 'No', 'inactive', { street: '1120 N Street, Ste 3', city: 'Sacramento', zip: '95814', addressNotes: 'Wound-down plan — keep for legacy claims history.', email: 'legacy@gsha.example.com' }),
  py('Riverside Behavioral Trust', 'RBT-9', 'Employer plan', 'ABA + related services', 'Yes', 'inactive', { street: '3850 La Sierra Ave', city: 'Riverside', zip: '92505', addressNotes: 'Awaiting employer renewal; do not route new auths.' }),
]

export const CLIENTS = [
  { id: 'c1', name: 'Justin Hsu', initials: 'JH', color: '#6366f1', program: 'EIBI · Day program', home: 'Main Center', authWeekly: 20, guardian: 'L. Hsu', geo: [37.33, -122.03] , avatar: 'bunny', phone: '(408) 555-0161'},
  { id: 'c2', name: 'Jimmy Ma', initials: 'JM', color: '#10b981', program: 'Home program · NET', home: "Jimmy Ma's home", authWeekly: 15, guardian: 'R. Ma', geo: [37.29, -121.99] , avatar: 'koala', phone: '(408) 555-0162'},
  { id: 'c3', name: 'Meg Jones', initials: 'MJ', color: '#f59e0b', program: 'Center-based · 1:1', home: 'Northside Center', authWeekly: 18, guardian: 'K. Jones', geo: [37.38, -122.01] , avatar: 'sloth', phone: '(408) 555-0163'},
  { id: 'c4', name: 'Robert Horejsi', initials: 'RH', color: '#ec4899', program: 'School-based · Inclusion', home: 'Jefferson Elementary', authWeekly: 12, guardian: 'M. Horejsi', geo: [37.31, -121.95] , avatar: 'octopus', phone: '(408) 555-0164'},
  { id: 'c5', name: 'David Wiegand', initials: 'DW', color: '#0ea5e9', program: 'Behavior reduction', home: 'Main Center', authWeekly: 16, guardian: 'S. Wiegand', geo: [37.35, -122.05] , avatar: 'unicorn', phone: '(408) 555-0165'},
  { id: 'c6', name: 'Teresa Brown', initials: 'TB', color: '#8b5cf6', program: 'Group · Social skills', home: 'Northside Center', authWeekly: 8, guardian: 'J. Brown', geo: [37.4, -122.0] , avatar: 'robot', phone: '(408) 555-0166'},
  { id: 'c7', name: 'Ankur Israni', initials: 'AI', color: '#14b8a6', program: 'EIBI · Home program', home: "Ankur Israni's home", authWeekly: 22, guardian: 'P. Israni', geo: [37.32, -121.92] , avatar: 'chick', phone: '(408) 555-0167'},
  { id: 'c8', name: 'Sydney Singer', initials: 'SS', color: '#f97316', program: 'Adaptive skills · Center', home: 'Main Center', authWeekly: 10, guardian: 'D. Singer', geo: [37.36, -122.04] , avatar: 'fox', phone: '(408) 555-0168'},
  { id: 'c9', name: 'Gaurang Jadia', initials: 'GJ', color: '#22c55e', program: 'Center-based · 1:1', home: 'Main Center', authWeekly: 20, guardian: 'N. Jadia', geo: [37.34, -122.02] , avatar: 'panda', phone: '(408) 555-0169'},
  { id: 'c10', name: 'Nagashree Ramachandra', initials: 'NR', color: '#e11d48', program: 'EIBI · Home program', home: "Nagashree R's home", authWeekly: 25, guardian: 'V. Ramachandra', geo: [37.28, -121.98] , avatar: 'cat', phone: '(408) 555-0170'},
  { id: 'c11', name: 'Venkatprabhu Nanjappan', initials: 'VN', color: '#06b6d4', program: 'School-based · Inclusion', home: 'Lincoln Elementary', authWeekly: 10, guardian: 'S. Nanjappan', geo: [37.3, -121.94] , avatar: 'bear', phone: '(408) 555-0171'},
  { id: 'c12', name: 'Mitesh Ghiya', initials: 'MG', color: '#a855f7', program: 'Behavior reduction', home: "Mitesh Ghiya's home", authWeekly: 14, guardian: 'A. Ghiya', geo: [37.33, -121.97] , avatar: 'owl', phone: '(408) 555-0172'},
  { id: 'c13', name: 'Sachin Abraham', initials: 'SA', color: '#65a30d', program: 'Group · Play readiness', home: 'Northside Center', authWeekly: 8, guardian: 'E. Abraham', geo: [37.39, -122.01] , avatar: 'penguin', phone: '(408) 555-0173'},
  { id: 'c14', name: 'Sowmya Reddy', initials: 'SR', color: '#d946ef', program: 'EIBI · Day program', home: 'Main Center', authWeekly: 20, guardian: 'K. Reddy', geo: [37.35, -122.03] , avatar: 'frog', phone: '(408) 555-0174'},
  { id: 'c15', name: 'Sylviya Anand', initials: 'SA', color: '#f59e0b', program: 'Speech co-treatment', home: 'Northside Center', authWeekly: 6, guardian: 'T. Anand', geo: [37.4, -121.99] , avatar: 'bunny', phone: '(408) 555-0175'},
  { id: 'c16', name: 'Bharath Reddy', initials: 'BR', color: '#3b82f6', program: 'Assessment / intake', home: 'Main Center', authWeekly: 5, guardian: 'G. Reddy', geo: [37.34, -122.05] , avatar: 'koala', phone: '(408) 555-0176'},
]
export const CLIENTS_BY_ID = Object.fromEntries(CLIENTS.map((c) => [c.id, c]))
// attach payer + authorization window (deterministic by index) + birth demographics for claims
CLIENTS.forEach((c, i) => Object.assign(c, {
  insurer: INSURERS[(i * 5 + 1) % INSURERS.length],
  status: 'active',
  ...authWin(i),
  dob: isoDate(new Date(2015 + (i % 6), (i * 7 + 2) % 12, 1 + ((i * 41) % 27))),
  sex: i % 2 ? 'F' : 'M',
}))

// ---- Care teams: randomized (deterministic) distribution of staff & clients ----
const teamRng = mulberry32(777)
export const TEAM_DEFS = [
  { id: 't1', name: 'Care Team · Eastside', color: '#10b981' },
  { id: 't2', name: 'Care Team · Home Programs', color: '#f59e0b' },
  { id: 't3', name: 'Care Team · Schools', color: '#0ea5e9' },
  { id: 't4', name: 'Care Team · Center AM', color: '#6366f1' },
  { id: 't5', name: 'Care Team · Center PM', color: '#8b5cf6' },
]
export const SVCS = SERVICES.map((s) => {
  const c = BILL_CODES.find((x) => x.id === s.code) || {}
  return { ...s, status: 'active', unitMins: c.unitMins || 30, rate: c.rate || 0, rounding: 'AMA', credentials: s.id === 'sup' ? ['BCBA'] : s.id === 'social' || s.id === 'play' ? ['BCaBA', 'RBT'] : [], note: '' }
})

// master seasoning: routing ids, clearing house and a few showcase payer rules
Object.assign(PAYERS[0], { cmsType: 'Group Health Plan', format: 'None', payerId: '00124', clearingHouse: 'Office Ally', ctList: 'ABA Standard', services: [], cf: [] })
Object.assign(PAYERS[1], { cmsType: 'Group Health Plan', format: 'None', payerId: '87211', clearingHouse: 'Availity', ctList: 'ABA Standard', services: [], cf: [
    { id: 'authdept', label: 'Prior auth dept', type: 'select', options: ['Behavioral Intake 2', 'Auth Review Unit 3'], required: false },
    { id: 'waiver', label: 'Service waiver on file', type: 'toggle', required: false },
  ] })
Object.assign(PAYERS[3], { cmsType: 'Medicaid', format: 'Custom Format 1', payerId: 'MC001', clearingHouse: 'Office Ally', ctList: 'ABA Standard', services: [], cf: [] })
Object.assign(PAYERS[4], { cmsType: 'Medicaid', format: 'None', payerId: 'DHCS-51', clearingHouse: 'Change Healthcare', ctList: '', services: [], cf: [] })
PAYERS[1].rules = {
  ...PAYERS[1].rules,
  concurrent: { allowed: false, rules: [] },
  appt: { sigRequired: true },
  svcOv: {},
}
PAYERS[1].svcOv = { dtt: { charge: 38, contract: 34, modifier: 'U6', dx1: 'F84.0', dx2: 'F84.9', rounding: 'Nearest', effective: '2025-01-01', expiration: '2026-12-31', thirdParty: '4450' } }

export const TEAMS = (() => {
  const teams = TEAM_DEFS.map((t) => ({ ...t, staffIds: [], clientIds: [] }))
  // each client lands on exactly one team, each staff on 1-2 teams (randomized)
  for (const c of CLIENTS) teams[Math.floor(teamRng() * teams.length)].clientIds.push(c.id)
  for (const s of STAFF) {
    const n = teamRng() < 0.45 ? 2 : 1
    const used = new Set()
    while (used.size < n) used.add(Math.floor(teamRng() * teams.length))
    for (const ti of used) teams[ti].staffIds.push(s.id)
  }
  return teams
})()

export const LOCATIONS = [
  'Main Center', 'Northside Center', 'Jefferson Elementary', 'Lincoln Elementary',
  'Community park session', 'Library community session', 'Telehealth (video)', 'Clinic Room 2', 'Assessment Lab',
]

export const defaultSettings = () => ({
  theme: 'light',
  weekStart: 0,
  h24: false,
  apptNameStyle: 'ehr',
  apptTitleExtras: { program: false, location: false, service: false },
  apptNameStaff: false,
  defaultRate: 32,
  mileageRate: 0.7,
  workday: [8, 18],
  smart: SMART_DEFAULTS,
  org: { name: 'Aloha ABA Center', taxId: '94-3172055', npi: '1720418390', address: '1140 Sunset Crest Way, San Jose, CA 95124', phone: '(408) 555-0134' },
  billing: { invoicePrefix: 'INV', claimPrefix: 'CLM', dueDays: 30, requireVerification: true, lateCancelHours: 24, autoUnits: true },
  analytics: { preset: 'last4', gran: 'auto', metric: 'sessions', dim: 'staff', chart: 'line', compare: true, agg: 'sum' },
})

// ---- content pools for rich seeding ----
const SVC_BY_PROGRAM = {
  'EIBI · Day program': 'esdm',
  'Home program · NET': 'net',
  'Center-based · 1:1': 'dtt',
  'School-based · Inclusion': 'behavior',
  'Behavior reduction': 'behavior',
  'Group · Social skills': 'social',
  'Adaptive skills · Center': 'adaptive',
  'Group · Play readiness': 'play',
  'Speech co-treatment': 'speech',
  'Assessment / intake': 'fba',
}
export const SVC_LABEL = Object.fromEntries([
  ['dtt', '1:1 Discrete Trial Training'], ['net', 'Natural Environment Teaching'], ['adaptive', 'Adaptive / Daily Living Skills'],
  ['behavior', 'Behavior Reduction Plan'], ['social', 'Social Skills Group'], ['play', 'Play Readiness Group'],
  ['esdm', 'Early Start Denver Model (EIBI)'], ['fba', 'Functional Assessment (FBA)'], ['sup', 'BCBA Supervision'],
  ['caregiver', 'Parent / Caregiver Training'], ['speech', 'Speech & Language Co-treatment'], ['reassess', 'Re-assessment (VB-MAPP)'], ['253mt', 'Modified Treatment (253MT)'],
])
export const SVC_CODE = Object.fromEntries([
  ['dtt', '97151'], ['net', '97151'], ['adaptive', '97151'], ['behavior', '97151'], ['social', '97153'], ['play', '97154'],
  ['esdm', '0362T'], ['fba', '97152'], ['sup', '97152'], ['caregiver', '97152'], ['speech', '97152'], ['reassess', '97152'], ['253mt', '253MT'],
])
const SVC_POOL = ['dtt', 'net', 'adaptive', 'behavior', '253mt']

const NOTE_POOL = {
  service: [
    'High engagement across DTT block; prompt levels down one step vs last week.',
    'Manding trials 18/20 independent. Generalization into play routine next.',
    'Elopement attempts ×2 during transition — followed BIP, no escape maintained.',
    'Took data live; program revision queued for next supervisor review.',
    'Net training at sandbox; peer proximity tolerance improved.',
    'Caregiver observed final 10 min and received handout.',
    'Session ended 5 min early — client fatigued; makeup proposed for Friday.',
    'New reinforcer assessment completed; updated preference menu.',
  ],
  evaluation: ['Standardized administration, no behavior interruptions.', 'VB-MAPP Level 1-2里程碑 captured; report drafting.'],
  supervision: ['Reviewed RBT session videos + fidelity checklist; 2 programs adjusted.', 'Focused on error correction procedures and inter-trial behavior.'],
  drive: [], break: [], unavailable: [],
}
const DOC_POOL = [
  ['Session Note {d}.pdf', 60, 'Session note'], ['Data Sheet {d}.csv', 12, 'Data export'], ['Parent Debrief Notes.docx', 34, 'Session note'],
  ['VB-MAPP Milestones {d}.pdf', 220, 'Assessment report'], ['Insurance Auth — {y}.pdf', 90, 'Consent / auth'], ['IEP Snapshot.png', 480, 'IEP / IFSP'], ['BIP Revision Draft.pdf', 150, 'Assessment report'],
]
const MYCARE = ['Sensory Diet', 'Feeding Therapy', 'Sleep Protocol', 'Toileting Plan', 'Behavior Support', 'AAC Training', 'Mand Training']
const MEG = ['Not started', 'Baseline', 'Pass 1', 'Pass 2', 'Complete']

function docsFor(rnd, date, title) {
  if (rnd() < 0.45) return []
  const n = 1 + Math.floor(rnd() * 3)
  const out = []
  for (let i = 0; i < n; i++) {
    const [name, kb, tag] = DOC_POOL[Math.floor(rnd() * DOC_POOL.length)]
    out.push({ id: uid(), name: name.replace('{d}', date).replace('{y}', date.slice(0, 4)), size: Math.round(kb * (0.7 + rnd() * 0.8)) * 1024, tag })
  }
  return out
}

export function buildSeed(todayISO) {
  const rnd = mulberry32(20260909)
  const appts = {}
  const [ty, tm, td] = todayISO.split('-').map(Number)
  const today = new Date(ty, tm - 1, td)
  const monday = new Date(today)
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7))
  monday.setHours(0, 0, 0, 0)

  const push = (a) => {
    const id = a.id || uid()
    appts[id] = { id, status: 'active', notes: '', custom: {}, verification: null, documents: [], createdAt: Date.now(), ...a }
  }

  // busy-interval tracker so the demo never seeds genuine double-bookings: every
  // staff-facing placement checks its people are free (same rule the wizard uses).
  const busy = {}
  const ivOv = (a, b) => a[0] < b[1] && b[0] < a[1]
  const fits = (ids, di, s0, e0) => ids.every((id) => !(busy[`${id}|${di}`] || []).some((iv) => ivOv([s0, e0], iv)))
  const occ = (ids, di, s0, e0) => {
    for (const id of ids) (busy[`${id}|${di}`] = busy[`${id}|${di}`] || []).push([s0, e0])
  }
  /** place a `dur`-minute block in the first free slot on that day, snapping to the 15-min grid; null = give up */
  const place = (ids, di, s, dur, latestEnd = 18 * 60) => {
    let start = Math.max(8 * 60, Math.round(s / 15) * 15)
    while (start + dur <= latestEnd) {
      if (fits(ids, di, start, start + dur)) return start
      start += 15
    }
    return null
  }

  // per-client weekly plan: weekday(s), start hour, duration, services
  const plans = {}
  CLIENTS.forEach((c, ci) => {
    const n = c.program.includes('Group') ? 1 : c.program.includes('Assessment') ? 1 : 2 + (rnd() < 0.5 ? 1 : 0)
    const days = []
    let wd = 1 + Math.floor(rnd() * 5)
    for (let i = 0; i < n; i++) {
      while (days.includes(wd)) wd = 1 + ((wd + 2) % 5)
      days.push(wd)
      wd = 1 + ((wd + 2 + ci) % 5)
    }
    const svc = SVC_BY_PROGRAM[c.program] || pick(rnd, SVC_POOL)
    plans[c.id] = {
      sessions: days.map((d, i) => ({
        wd: d,
        start: G(i % 2 === 0 ? 0 : 4) + (i % 2 === 0 ? 0 : 30) + (ci % 3) * 15,
        dur: c.program.includes('EIBI') ? (rnd() < 0.5 ? 150 : 120) : rnd() < 0.3 ? 90 : 120,
        svc: i === 0 ? svc : rnd() < 0.35 ? 'adaptive' : svc,
      })),
    }
    // staff pool per program
    const rbts = ['s3', 's4', 's7', 's10', 's5']
    plans[c.id].staff = plans[c.id].sessions.map((s, i) =>
      s.svc === 'speech' ? ['s11', 's4'] : c.program.includes('Assessment') ? ['s6', 's1'] : c.program.includes('Group') ? [rbts[(ci + i) % 5], 's2'] : [rbts[(ci * 2 + i) % 5]]
    )
  })

  for (let w = -8; w <= 4; w++) {
    const weekStart = addDays(monday, w * 7)
    for (const c of CLIENTS) {
      const plan = plans[c.id]
      plan.sessions.forEach((s, si) => {
        const date = addDays(weekStart, s.wd - 1)
        const di = isoDate(date)
        const past = di < todayISO
        let status = 'active'
        const r = rnd()
        if (di < todayISO) status = r < 0.06 ? 'no-show' : r < 0.11 ? 'cancelled' : 'completed'
        else if (di === todayISO) status = r < 0.5 ? 'confirmed' : 'active'
        else status = r < 0.6 ? 'confirmed' : 'active'
        const staffIds = plan.staff[si]
        const dur = s.dur
        const seriesId = `sr-${c.id}-${si}` // shared across weeks → real recurrence
        const baseStart = s.start
        // seeded exception: occasional +15min shift with edited flag
        const isException = past && rnd() < 0.05
        // find a free slot for this staff pair (collision-free demo data); a day this
        // packed just skips the occurrence rather than seeding a double-book
        const nudged = place(staffIds, di, isException ? baseStart + 15 : baseStart, dur, 19 * 60)
        if (nudged == null) return
        const start = nudged
        occ(staffIds, di, start, start + dur)
        const billing = {
          ...autoBilling({ type: 'service', billing: { code: SVC_CODE[s.svc] } }, dur),
          rate: SVC_CODE[s.svc] === '97152' ? (rnd() < 0.5 ? 74 : 70) : autoBilling({}, dur).rate || 32,
        }
        const notes = status === 'no-show' ? 'Attempted parent contact at scheduled start; documenting for auth.' : status === 'cancelled' ? 'Cancelled by caregiver — reschedule pending.' : past && rnd() < 0.75 ? pick(rnd, NOTE_POOL.service) : ''
        const vSigStaff = STAFF_BY_ID[staffIds[0]]
        const verification =
          status === 'completed'
            ? {
                completedBy: vSigStaff.id,
                checks: Object.fromEntries(VERIFY_CHECKS.map((ch, i) => [ch.id, rnd() < (i === 3 ? 0.7 : 0.95)])),
                verifyStatus: rnd() < 0.8 ? 'verified' : rnd() < 0.6 ? 'flagged' : 'pending',
                note: rnd() < 0.3 ? 'Nice generalization today — carry into school routine.' : '',
                signature: {
                  mode: rnd() < 0.5 ? 'draw' : 'type',
                  text: vSigStaff.name,
                  staffId: vSigStaff.id,
                  staffName: vSigStaff.name,
                  certification: vSigStaff.cert,
                  timestamp: `${di}T${pad(Math.floor((start + dur) / 60))}:${pad((start + dur) % 60)}:0${Math.floor(rnd() * 9)}Z`,
                  geo: { lat: +(c.geo[0] + (rnd() - 0.5) * 0.01).toFixed(4), lng: +(c.geo[1] + (rnd() - 0.5) * 0.01).toFixed(4), accuracy: Math.round(8 + rnd() * 40) },
                },
              }
            : null
        push({
          type: 'service',
          date: di,
          start,
          end: start + dur,
          title: SVC_LABEL[s.svc],
          staffIds,
          clientIds: [c.id],
          status,
          location: c.home === 'Main Center' && rnd() < 0.15 ? 'Clinic Room 2' : c.home,
          service: s.svc,
          notes,
          abaHr: dur >= 90 && rnd() < 0.85,
          recurrence: 'weekly',
          seriesId,
          edited: isException || undefined,
          billing,
          custom: {
            megTest: rnd() < 0.55 ? pick(rnd, MEG) : '',
            myCare: rnd() < 0.5 ? [pick(rnd, MYCARE), ...(rnd() < 0.4 ? [pick(rnd, MYCARE)] : [])].filter((v, i, a) => a.indexOf(v) === i) : [],
            yesNo: rnd() < 0.5,
            grade: rnd() < 0.4 ? pick(rnd, ['A', 'B', 'C', 'B', 'A']) : '',
            reEval: rnd() < 0.12 ? 'Re-eval packet to insurer by month end.' : '',
          },
          documents: docsFor(rnd, di, s.svc),
          verification,
        })

        // drive to/from for home & school visits
        if ((c.home.includes('home') || c.home.includes('Elementary')) && status !== 'cancelled' && rnd() < 0.85) {
          const dist = Math.round(4 + rnd() * 17)
          for (const [off, ttl] of [[-20, 'Drive to session'], [dur + 5, 'Drive home']]) {
            const ds = start + off
            const de = ds + (off < 0 ? 20 : 25)
            if (!fits(staffIds, di, ds, de)) continue // skip legs that would double-book the tech
            occ(staffIds, di, ds, de)
            push({
              type: 'drive', date: di, start: ds, end: de,
              title: `${ttl} — ${c.name.split(' ')[0]}`, staffIds, clientIds: [c.id], status: 'active',
              location: 'En route', recurrence: 'weekly', seriesId: `${seriesId}-d${off < 0 ? 'a' : 'b'}`,
              notes: rnd() < 0.25 ? 'Traffic delay logged — drove straight from previous school site.' : '',
              billing: { code: 'H2019', unitMins: 60, minutes: 20, units: 0, rate: 0, mileage: true, distance: dist, mileageRate: 0.7 },
              custom: rnd() < 0.2 ? { yesNo: rnd() < 0.5, myCare: [] } : {},
            })
          }
        }
        // break after long sessions
        if (dur >= 120 && rnd() < 0.5) {
          const blen = rnd() < 0.5 ? 15 : 30
          const bs = start + dur + 30
          if (fits(staffIds, di, bs, bs + blen)) {
            occ(staffIds, di, bs, bs + blen)
            push({
              type: 'break', date: di, start: bs, end: bs + blen, title: 'Break — reset & restock',
              staffIds, clientIds: [], status: 'active', notes: pick(rnd, ['Reinforcer prep for afternoon block.', 'Water + 5 min decompress.']),
              custom: { yesNo: rnd() < 0.5 },
            })
          }
        }
      })

      // caregiver training (biweekly) & monthly evals for a rotating few
      if (c.id.charCodeAt(1) % 2 === w % 2 && w > -3 && rnd() < 0.4) {
        const date = addDays(weekStart, 3)
        const cdi = isoDate(date)
        const cs = place(['s2'], cdi, G(6) + 30, 60, 19 * 60)
        if (cs != null) occ(['s2'], cdi, cs, cs + 60)
        if (cs != null)
        push({
          type: 'service', date: cdi, start: cs, end: cs + 60, title: SVC_LABEL.caregiver,
          staffIds: ['s2'], clientIds: [c.id], status: date < todayISO ? 'completed' : 'confirmed', location: 'Telehealth (video)', service: 'caregiver',
          notes: 'Parents practiced DRT at home; reviewed token board setup.', billing: autoBilling({}, 60), abaHr: true, recurrence: 'biweekly',
          seriesId: `sr-${c.id}-cg`, custom: { yesNo: true, myCare: ['Behavior Support'] }, documents: [],
          verification: null,
        })
      }
    }

    // weekly team meeting (all staff) as a series — slides later if someone runs long
    const mm = addDays(weekStart, 4)
    const mdi = isoDate(mm)
    const mids = STAFF.map((s) => s.id)
    const ms = place(mids, mdi, G(5), 60, 20 * 60)
    if (ms != null) {
      occ(mids, mdi, ms, ms + 60)
      push({
        type: 'unavailable', date: mdi, start: ms, end: ms + 60, title: 'Team meeting — programming review',
        staffIds: mids, clientIds: [], status: 'active', location: 'Clinic Room 2',
        notes: 'Agenda: caseload moves, auth expirations, safety drill.', recurrence: 'weekly', seriesId: 'sr-meeting', custom: { yesNo: rnd() < 0.5 },
      })
    }
    // supervision slots: BCBA ↔ RBT, weekly series
    for (const [sup, rbt] of [['s1', 's3'], ['s8', 's4'], ['s9', 's10'], ['s2', 's7']]) {
      if (rnd() < 0.25) continue
      const wd = 1 + Math.floor(rnd() * 4)
      const d = addDays(weekStart, wd - 1)
      const sdi = isoDate(d)
      const ss = place([sup, rbt], sdi, G(7), 60, 19 * 60)
      if (ss == null) continue
      occ([sup, rbt], sdi, ss, ss + 60)
      push({
        type: 'supervision', date: sdi, start: ss, end: ss + 60, title: 'Monthly supervision (BCBA→RBT)',
        staffIds: [sup, rbt], clientIds: [], status: d < todayISO ? 'completed' : 'active', location: 'Main Center',
        notes: rnd() < 0.6 ? 'Fidelity 92% — focused feedback on MOT procedures.' : '', billing: { ...autoBilling({ billing: { code: '97152' } }, 60) },
        recurrence: 'weekly', seriesId: `sr-sup-${sup}-${rbt}`, custom: { grade: rnd() < 0.3 ? 'A' : '' },
      })
    }
  }

  // PTO / training blocks scattered over the horizon (per-staff, varied)
  const ptoTitles = ['PTO — family trip', 'Unavail — court date', 'Conference travel (ABAI)', 'Unavail — medical appt', 'Clinic closed — staff training', 'Licence CEU workshop']
  for (const st of STAFF) {
    const n = Math.floor(rnd() * 3)
    for (let i = 0; i <= n; i++) {
      const woff = Math.floor(rnd() * 8) - 3
      const date = addDays(monday, woff * 7 + 1 + Math.floor(rnd() * 4))
      const di = isoDate(date)
      if (di < todayISO) continue
      const half = rnd() < 0.4
      const ptoTitle = pick(rnd, ptoTitles)
      // try to place the block in a genuinely free window; skip PTO entries that would eat booked sessions
      const shapes = (half ? [[G(0), G(5) + 30], [G(1) + 30, G(2) + 15], [G(6) + 15, G(7) + 15]] : [[G(1) + 30, G(2) + 15], [G(6) + 15, G(7) + 15], [G(0), G(5) + 30]])
        .filter(([s0, e0]) => fits([st.id], di, s0, e0))[0]
      if (!shapes) continue
      occ([st.id], di, shapes[0], shapes[1])
      push({
        type: 'unavailable', date: di, start: shapes[0], end: shapes[1],
        title: ptoTitle, staffIds: [st.id], clientIds: [], status: 'active',
        notes: 'Approved by scheduler — covered by float staff.', recurrence: 'none',
        custom: { yesNo: rnd() < 0.5, reEval: rnd() < 0.2 ? 'Make-up hour requested.' : '' },
      })
    }
  }
  // evaluations / re-assessments (one client per week rotating)
  for (let w = -2; w <= 4; w++) {
    const c = CLIENTS[(w + 2) % CLIENTS.length]
    const date = addDays(addDays(monday, w * 7), 2)
    const di = isoDate(date)
    const dur = 90
    const eStaff = rnd() < 0.5 ? 's6' : 's1'
    const eStart = place([eStaff], di, G(5), dur, 19 * 60)
    if (eStart == null) continue
    occ([eStaff], di, eStart, eStart + dur)
    push({
      type: 'evaluation', date: di, start: eStart, end: eStart + dur, title: pick(rnd, ['VB-MAPP Assessment', 'ABLLS-R Re-assessment', 'Functional Assessment (FBA)', 'Intake Observation']),
      staffIds: [eStaff], clientIds: [c.id], status: di < todayISO ? 'completed' : di === todayISO ? 'confirmed' : 'active',
      location: 'Assessment Lab', service: 'reassess', notes: di < todayISO ? 'Report drafted; narrative scoring pending.' : 'Materials printed; reinforcer prefprefs pre-session.',
      abaHr: false, recurrence: 'none',
      billing: { ...autoBilling({ billing: { code: '97152' } }, dur), rate: 74 },
      custom: { megTest: pick(rnd, MEG), grade: pick(rnd, ['A', 'B']), reEval: 'Send re-eval justification to insurer.' },
      documents: di < todayISO ? [{ id: uid(), name: `Assessment Summary ${di}.pdf`, size: 480_000, tag: 'Assessment report' }, { id: uid(), name: 'Scoring Workbook.xlsx', size: 120_000, tag: 'Data export' }] : [],
      verification: di < todayISO ? { completedBy: 's6', checks: { data: true, safety: true, materials: true, caregiver: false }, verifyStatus: 'verified', note: 'Client tolerated full protocol.' } : null,
    })
  }

  return appts
}

export const seedMeta = { staff: STAFF, clients: CLIENTS, teams: TEAMS, locations: LOCATIONS }

// ---- demo claim ledger: run the REAL lifecycle engine over older sessions so the
// billing desk opens with paid / in-flight / denied / draft claims already on file.
// The last ~week of claim-ready lines stays in staging — that's the user's job. ----
export function buildDemoClaims(appts, clients, settings, today) {
  const sim = { appts, clients: clients || CLIENTS, staff: STAFF, settings: { ...defaultSettings(), ...(settings || {}) } }
  const t0 = parseISO(today || todayISO()).getTime()
  const dayMs = 86400000
  const ageOf = (iso) => Math.round((t0 - parseISO(iso).getTime()) / dayMs)
  const stamp = (daysAgo) => t0 - daysAgo * dayMs - 9 * 3600 * 1000
  const staged = stagedAppts(sim, null).filter((a) => ageOf(a.date) >= 9)
  const { claims } = assembleClaims(sim, planClaims(sim, staged), { seqStart: 1, at: stamp(24) })
  const rnd = mulberry32(0xa11ce)
  const out = { ...appts }
  // age bands (weeks back from today) drive the lifecycle story:
  //   40+ days → PAID · 26–39 → SUBMITTED (aging, some past payer's cycle)
  //   14–25 → SUBMITTED (in flight) · 9–13 → DRAFT (the desk's to-do)
  const lateSet = []
  const midSet = []
  for (let i = 0; i < claims.length; i++) {
    const c = claims[i]
    const age = ageOf(c.dosTo)
    const pol = PAYER_POLICY[c.payer] || { avgDays: 22, coins: 0.85 }
    if (age >= 40 && i % 7 < 5) {
      c.submittedAt = stamp(age - 5)
      c.history.push({ at: c.submittedAt, ev: c.mode === 'selfpay' ? 'Invoice sent to family' : `Claim submitted to ${c.payer}` })
      const short = c.mode === 'insurance' && rnd() < 0.45
      c.paid = short ? Math.round(c.charges * (pol.coins ?? 0.85)) : c.charges
      c.adj = Math.round((c.charges - c.paid) * 100) / 100
      c.status = 'paid'
      c.closedAt = Math.max(c.submittedAt + dayMs, Math.min(t0 - dayMs, c.submittedAt + Math.round(pol.avgDays * (0.65 + rnd() * 0.7) + 1) * dayMs))
      c.remittance = { checkNo: `CHK-${isoDate(new Date(c.closedAt)).slice(2, 7).replace('-', '')}-${String(120 + i)}`, amount: c.paid, adj: c.adj, at: c.closedAt, note: short ? 'Contractual adjustment per fee schedule' : '' }
      c.history.push({ at: c.closedAt, ev: `Payment posted — $${c.paid.toLocaleString()} via ${c.remittance.checkNo}${short ? ` (${c.adj.toLocaleString()} adjustment)` : ''}` })
    } else if (age >= 13) {
      c.submittedAt = stamp(Math.max(3, age - 4))
      c.history.push({ at: c.submittedAt, ev: c.mode === 'selfpay' ? 'Invoice sent to family' : `Claim submitted to ${c.payer}` })
      c.status = 'submitted'
      if (age >= 30) lateSet.push(c)
      else midSet.push(c)
    }
    for (const l of c.lines) {
      const a = out[l.apptId]
      if (a) out[l.apptId] = { ...a, claimId: c.id, billing: { ...(a.billing || {}), status: 'claimed', claimNo: c.no } }
    }
  }
  // exactly two denials — a timely-filing bounce on a straggler, a records request on a recent one
  lateSet.sort((a, b) => b.charges - a.charges)
  midSet.sort((a, b) => b.charges - a.charges)
  const pickA = lateSet[0] || midSet[0]
  const pickB = [...midSet, ...lateSet].find((c) => c !== pickA)
  ;[pickA, pickB].forEach((c, di) => {
    if (!c) return
    const d = DENIAL_REASONS.find((x) => x.id === (di === 0 ? 'timely' : 'verif'))
    c.status = 'denied'
    c.denial = { code: d.id, reason: d.label, fix: d.fix, note: '', at: stamp(1) }
    c.history.push({ at: stamp(1), ev: `Denied — ${d.label}` })
  })
  // One draft deliberately held at the submission gate — a flagged-verification line —
  // so Submit demonstrates exactly why the payer would bounce it.
  const flagged = Object.values(out).find(
    (a) => a.status === 'completed' && !a.billing?.status && a.verification?.verifyStatus === 'flagged' && (a.billing?.units > 0) && a.clientIds?.[0] && ageOf(a.date) >= 9
  )
  if (flagged) {
    const simClaims = Object.fromEntries(claims.map((x) => [x.id, x]))
    const held = assembleClaims(sim, planClaims(sim, [flagged]), { seqStart: nextClaimSeq(simClaims), at: t0 - dayMs }).claims[0]
    if (held) {
      held.history.push({ at: t0 - dayMs, ev: 'Submission held — 1 line failed the verification gate' })
      claims.push(held)
      const a0 = out[flagged.id]
      out[flagged.id] = { ...a0, claimId: held.id, billing: { ...(a0.billing || {}), status: 'claimed', claimNo: held.no } }
    }
  }
  return { claims: Object.fromEntries(claims.map((c) => [c.id, c])), appts: out }
}
