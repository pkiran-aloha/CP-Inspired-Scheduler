// ---- Deterministic rich demo data, anchored to the current week ----
import { addDays, isoDate, pad, parseISO, todayISO } from './date'
import { uid, autoBilling, VERIFY_CHECKS, SERVICES, BILL_CODES } from './model'
import { SMART_DEFAULTS } from './smart'
import { AUTH_GUARD_DEFAULTS } from './authBudget'
import { seedCancelNotice, seedCancelReason } from './cancelReasons'
import { stagedAppts, planClaims, assembleClaims, PAYER_POLICY, DENIAL_REASONS, nextClaimSeq, npiOf } from './claims'
import { defaultPayrollSettings, seedPayProfiles, periodsFor, sheetKey, periodFor } from './payroll'

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
  { id: 's1', name: 'Prateek Kiran', initials: 'PK', color: '#6366f1', role: 'BCBA · Clinical Supervisor', cert: 'BCBA #5-12-0034', email: 'prateek.kiran@alohaaba.com', fte: 1, targetWeekH: 32, payrollRate: 52 , avatar: 'fox', phone: '(408) 555-0121', education: "Master's" },
  { id: 's2', name: 'Neha Peyyeti', initials: 'NP', color: '#0ea5e9', role: 'BCaBA · Center Lead', cert: 'BCaBA #5-23-0911', email: 'neha.peyyeti@alohaaba.com', fte: 1, targetWeekH: 34, payrollRate: 41 , avatar: 'panda', phone: '(408) 555-0122', education: "Bachelor's" },
  { id: 's3', name: 'Saija Kotha', initials: 'SK', color: '#10b981', role: 'RBT · EIBI', cert: 'RBT #24-08-1177', email: 'saija.kotha@alohaaba.com', fte: 1, targetWeekH: 36, payrollRate: 27 , avatar: 'cat', phone: '(408) 555-0123', education: "Bachelor's" },
  { id: 's4', name: 'Saumya Chitranshi', initials: 'SC', color: '#f59e0b', role: 'RBT · Home Programs', cert: 'RBT #23-11-0450', email: 'saumya.ch@alohaaba.com', fte: 1, targetWeekH: 36, payrollRate: 26 , avatar: 'bear', phone: '(408) 555-0124', education: "Associate" },
  { id: 's5', name: 'Munna Sala', initials: 'MS', color: '#8b5cf6', role: 'Student Therapist', cert: 'TC-BCBA (trainee)', email: 'munna.sala@alohaaba.com', fte: 0.6, targetWeekH: 22, payrollRate: 18 , avatar: 'owl', phone: '(408) 555-0125', education: "Bachelor's" },
  { id: 's6', name: 'Chandan Gupta', initials: 'CG', color: '#ef4444', role: 'Psychologist · Assessments', cert: 'PsyD #27655', email: 'chandan.gupta@alohaaba.com', fte: 0.8, targetWeekH: 26, payrollRate: 63 , avatar: 'penguin', phone: '(408) 555-0126', education: "Doctoral" },
  { id: 's7', name: 'Dhananjay Masal', initials: 'DM', color: '#06b6d4', role: 'RBT · School-based', cert: 'RBT #22-06-2280', email: 'dhananjay.m@alohaaba.com', fte: 1, targetWeekH: 34, payrollRate: 26 , avatar: 'frog', phone: '(408) 555-0127', education: "HS" },
  { id: 's8', name: 'Rohit Srivastava', initials: 'RS', color: '#14b8a6', role: 'BCBA', cert: 'BCBA #5-14-0788', email: 'rohit.sriv@alohaaba.com', fte: 1, targetWeekH: 30, payrollRate: 49 , avatar: 'bunny', phone: '(408) 555-0128', education: "Master's" },
  { id: 's9', name: 'Shishir Sharma', initials: 'SS', color: '#f97316', role: 'BCBA · Field Coordinator', cert: 'BCBA #5-09-0121', email: 'shishir.sharma@alohaaba.com', fte: 1, targetWeekH: 30, payrollRate: 48 , avatar: 'koala', phone: '(408) 555-0129', education: "Master's" },
  { id: 's10', name: 'Brook Joyce', initials: 'BJ', color: '#a855f7', role: 'Lead RBT', cert: 'RBT #21-03-0904', email: 'brook.joyce@alohaaba.com', fte: 1, targetWeekH: 38, payrollRate: 29 , avatar: 'sloth', phone: '(408) 555-0130', education: "Bachelor's" },
  { id: 's11', name: 'Michael McDonald', initials: 'MM', color: '#22c55e', role: 'Speech-Language Pathologist', cert: 'CCC-SLP #G45-0012', email: 'michael.mcd@alohaaba.com', fte: 0.5, targetWeekH: 18, payrollRate: 55 , avatar: 'octopus', phone: '(408) 555-0131', education: "Master's" },
  { id: 's12', name: 'Anik Gajjar', initials: 'AG', color: '#e11d48', role: 'Scheduler & Billing Coordinator', cert: 'CPC', email: 'anik.gajjar@alohaaba.com', fte: 1, targetWeekH: 20, payrollRate: 34 , avatar: 'unicorn', phone: '(408) 555-0132', education: "Bachelor's" },
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
  ext: { group: '', plan: '', subId: '', ticareId: '', medicaidId: '', bhpnId: '', filingDeadlineDays: null, requiresSecondaryBox18: true },
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
// fictional mailing addresses, so the demo CMS-1500 has a complete item 5 / 7
].map((c, i) => ({ ...c, street: `${120 + i * 37} ${['Orchard', 'Willow', 'Cedar', 'Linden', 'Maple', 'Juniper', 'Aspen', 'Hazel'][i % 8]} Ln`, city: 'San Jose', state: 'CA', zip: `951${String(10 + i).padStart(2, '0')}` }))
export const CLIENTS_BY_ID = Object.fromEntries(CLIENTS.map((c) => [c.id, c]))
// attach payer + authorization window (deterministic by index) + birth demographics for claims
// Fictional chart identifiers so demo claims pass the claim gate: a member ID and an
// authorization number for insured clients, and ICD-10 codes picked by program.
const MEMBER_PREFIX = { 'Blue Shield CA': 'BSC', Aetna: 'AE', 'Regence BCBS': 'RGN', UnitedHealthcare: 'UHC', 'Medicaid (CA)': 'MC' }
const DEMO_DX = [
  [/EIBI/, ['F84.0', 'R41.82']], [/Day program/, ['F84.0', 'F81.0']], [/Home program/, ['F84.0']],
  [/Behavior reduction/, ['F84.0', 'F90.1']], [/Group ·/, ['F84.5', 'F83']], [/School-based/, ['F84.0', 'F81.0']],
  [/Adaptive/, ['F84.0', 'F82']], [/Speech/, ['F80.89', 'F84.0']], [/Center-based/, ['F84.0', 'F90.0']],
]
CLIENTS.forEach((c, i) => {
  const insurer = INSURERS[(i * 5 + 1) % INSURERS.length]
  const prefix = MEMBER_PREFIX[insurer]
  Object.assign(c, {
    insurer,
    status: 'active',
    ...authWin(i),
    dob: isoDate(new Date(2015 + (i % 6), (i * 7 + 2) % 12, 1 + ((i * 41) % 27))),
    sex: i % 2 ? 'F' : 'M',
    memberId: prefix ? `${prefix}-${String(5210337 + i * 70913).slice(-7)}` : '',
    authNo: prefix ? `PA-26-${String(4100 + i * 37)}` : '',
    dxCodes: (DEMO_DX.find(([re]) => re.test(c.program)) || [null, ['F84.0']])[1],
  })
})

// ---- Care teams: randomized (deterministic) distribution of staff & clients ----
const teamRng = mulberry32(777)
export const TEAM_DEFS = [
  { id: 't1', name: 'Care Team · Eastside', color: '#10b981' },
  { id: 't2', name: 'Care Team · Home Programs', color: '#f59e0b' },
  { id: 't3', name: 'Care Team · Schools', color: '#0ea5e9' },
  { id: 't4', name: 'Care Team · Center AM', color: '#6366f1' },
  { id: 't5', name: 'Care Team · Center PM', color: '#8b5cf6' },
]
// Custom Fields master — reusable typed templates; payers only reference these ids
export const CF_DEFS = [
  { id: 'cf-authdept', label: 'Prior auth dept', type: 'select', options: ['Behavioral Intake 2', 'Auth Review Unit 3', 'School Liaison'], required: false, note: 'Which department issued the auth — printed on the claim remarks.', status: 'active', assignedTo: ['appointment', 'payer'] },
  { id: 'cf-waiver', label: 'Service waiver on file', type: 'toggle', onLabel: 'Yes', offLabel: 'No', required: false, note: 'Copay/coinsurance waiver documentation received.', status: 'active', assignedTo: ['appointment', 'payer'] },
  { id: 'cf-present', label: 'Caregiver present', type: 'toggle', onLabel: 'Present', offLabel: 'Not present', required: false, note: '', status: 'active', assignedTo: ['appointment', 'payer'] },
  { id: 'cf-goals', label: 'Session focus areas', type: 'multi', options: ['Mandec', 'Toilet training', 'Sleep routine', 'Play skills', 'Feeding', 'Safety skills'], required: false, note: 'Tick every goal targeted during the session.', status: 'active', assignedTo: ['appointment', 'payer'] },
  { id: 'cf-parentsig', label: 'Parent/Caregiver signature', type: 'signature', required: true, note: 'Capture at the end of any parent-training session.', status: 'active', assignedTo: ['appointment'] },
  { id: 'cf-teleconf', label: 'Telehealth consent confirmed', type: 'text', required: false, note: 'Verbal consent wording or link sent.', status: 'inactive', assignedTo: ['appointment', 'payer'] },
  // chunk-39: the old built-in appointment fields live here now — defined in the master,
  // addable per appointment, NEVER pre-rendered ("Meg Test" deliberately not promoted)
  { id: 'cf-mycare', label: 'My Care', type: 'multi', options: ['Sensory Diet', 'Feeding Therapy', 'Sleep Protocol', 'Toileting Plan', 'Behavior Support', 'AAC Training', 'Mand Training'], required: false, note: 'Focus areas carried over from the old built-in appointment fields.', status: 'active', assignedTo: ['appointment'] },
  { id: 'cf-yesno', label: 'Yes or No', type: 'toggle', onLabel: 'Yes', offLabel: 'No', required: false, note: 'Carried over from the old built-in appointment fields.', status: 'active', assignedTo: ['appointment'] },
  { id: 'cf-grade', label: 'Grade', type: 'select', options: ['A', 'B', 'C', 'D', 'E', 'N/A'], required: false, note: 'Carried over from the old built-in appointment fields.', status: 'active', assignedTo: ['appointment'] },
  { id: 'cf-reval', label: 'Re-eval Notes', type: 'text', required: false, note: 'Carried over from the old built-in appointment fields.', status: 'active', assignedTo: ['appointment'] },
]

export const SVCS = SERVICES.map((s) => {
  const c = BILL_CODES.find((x) => x.id === s.code) || {}
  return { ...s, status: 'active', unitMins: c.unitMins || 15, rate: c.rate || 0, rounding: 'AMA', credentials: s.id === 'sup' ? ['BCBA'] : s.id === 'social' || s.id === 'play' ? ['BCaBA', 'RBT'] : [], note: '' }
})

// master seasoning: routing ids, clearing house and a few showcase payer rules
Object.assign(PAYERS[0], { cmsType: 'Group Health Plan', format: 'None', payerId: '00124', clearingHouse: 'Office Ally', ctList: 'ABA Standard', services: [], cf: [] })
Object.assign(PAYERS[1], { cmsType: 'Group Health Plan', format: 'None', payerId: '87211', clearingHouse: 'Availity', ctList: 'ABA Standard', services: [], cf: [] })
Object.assign(PAYERS[3], { cmsType: 'Medicaid', format: 'Custom Format 1', payerId: 'MC001', clearingHouse: 'Office Ally', ctList: 'ABA Standard', services: [], cf: [] })
Object.assign(PAYERS[4], { cmsType: 'Medicaid', format: 'None', payerId: 'DHCS-51', clearingHouse: 'Change Healthcare', ctList: '', services: [], cf: [] })
PAYERS[1].rules = {
  ...PAYERS[1].rules,
  concurrent: { allowed: false, rules: [] },
  appt: { sigRequired: true },
  svcOv: {},
}
PAYERS[1].svcOv = { dtt: { charge: 19, contract: 17, modifier: 'U6', dx1: 'F84.0', dx2: 'F84.9', rounding: 'Nearest', effective: '2025-01-01', expiration: '2026-12-31', thirdParty: '4450' } }

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

// chunk-40 (U2): the provider identifier master — one row per NPI. Offices may carry
// several NPIs (like real ABA offices); staff carry one each with the matching taxonomy.
export function seedProviders(staff, org) {
  const now = Date.now()
  const out = [{
    id: 'pr-org', name: org.name || 'Practice', kind: 'office', refId: null,
    credential: 'Office', degree: '', npi: org.npi || '', taxonomy: '101YP00000X',
    roles: { rendering: false, billing: true, facility: true },
    payerIds: { ticare: '', medicaid: '', bhpn: '', referrers: '' }, active: true, createdAt: now,
  }]
  for (const st of staff) {
    const cred = /BCaBA/.test(st.role) ? 'BCaBA' : /BCBA/.test(st.role) ? 'BCBA' : /Psycholog/.test(st.role) ? 'Psychologist' : 'RBT'
    out.push({
      id: `pr-st-${st.id}`, name: st.name, kind: 'staff', refId: st.id, credential: cred,
      degree: st.cert || '', npi: npiOf(st.id),
      taxonomy: cred === 'RBT' ? '363AP0207X' : cred === 'Psychologist' ? '207Q00000X' : '101YP00000X',
      roles: { rendering: true, billing: cred === 'BCBA', facility: false },
      payerIds: { ticare: '', medicaid: '', bhpn: '', referrers: '' }, active: true, createdAt: now,
    })
  }
  return out
}

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
  practiceDays: [1, 2, 3, 4, 5],
  smart: SMART_DEFAULTS,
  // authorization guard for the calendar: flag/warn/stop a booking that spends
  // past the hours on file. See src/lib/authBudget.js.
  authGuard: AUTH_GUARD_DEFAULTS,
  org: { name: 'Aloha ABA Center', taxId: '94-3172055', npi: '1720418395', address: '1140 Sunset Crest Way, San Jose, CA 95124', phone: '(408) 555-0134' },
  providers: seedProviders(STAFF, { npi: '1720418395', name: 'Aloha ABA Center' }),
  billing: { invoicePrefix: 'INV', claimPrefix: 'CLM', dueDays: 30, requireVerification: true, lateCancelHours: 24, autoUnits: true, defaultBilling: 'pr-org', defaultFacility: 'pr-org', strictAuth: false, supervisionCheck: false, invoiceSeq: 1, defaultFilingDays: 90 },
  analytics: { preset: 'last4', gran: 'auto', metric: 'sessions', dim: 'staff', chart: 'line', compare: true, agg: 'sum' },
  payroll: defaultPayrollSettings(),
})

// ---- Payroll seeding ----------------------------------------------------------
// Pay profiles come from the roster (role drives the defensible default), and
// timesheets are *derived* from the calendar — the schedule stays the single
// source of truth for worked time, so payroll can never drift from it.
export function seedPayroll(staff = STAFF, settings = defaultSettings()) {
  const payroll = { ...(settings.payroll || defaultPayrollSettings()) }
  // The anchor must sit inside the cycle that contains "today", or the demo
  // would open on a period months away from the seeded calendar.
  payroll.anchor = currentPayrollAnchor(payroll.frequency)
  const profiles = seedPayProfiles(staff).map((p, i) => {
    const s = staff[i]
    return {
      ...p,
      // demo provider IDs so the QuickBooks export is exercisable out of the box
      payrollId: p.payrollId || `ALOHA-${String(i + 1).padStart(4, '0')}`,
      classificationReviewed: i < 4, // first few reviewed; the rest stay flagged for review
      bankRouting: '123456789',
      bankAccount: `0000${String(1000 + i)}`,
      address: s ? '1140 Sunset Crest Way, San Jose, CA 95124' : '',
    }
  })
  const periods = periodsFor(payroll, periodFor(payroll, todayISO())?.start || todayISO(), { back: 2, forward: 1 })
  const current = periodFor(payroll, todayISO(), { back: 2, forward: 1 })
  const idx = periods.findIndex((p) => p.id === current?.id)
  const sheets = {}
  periods.forEach((period, pi) => {
    profiles.forEach((p, si) => {
      // historical periods are approved; the open period is mid-cycle, which is
      // what the approval queue looks like on a real Wednesday
      let status = 'approved'
      if (pi === idx) status = si % 3 === 0 ? 'approved' : si % 3 === 1 ? 'submitted' : 'open'
      else if (pi > idx) status = 'open'
      sheets[sheetKey(p.staffId, period.id)] = {
        id: sheetKey(p.staffId, period.id), staffId: p.staffId, periodId: period.id,
        status, adjustments: [],
        submittedAt: status !== 'open' ? Date.now() - 86400000 * 3 : undefined,
        submittedBy: status !== 'open' ? 'Anik Gajjar' : undefined,
        approvedAt: status === 'approved' ? Date.now() - 86400000 * 2 : undefined,
        approvedBy: status === 'approved' ? 'Prateek Kiran' : undefined,
        audit: [{ at: Date.now() - 86400000 * 4, who: 'system', action: 'sheet seeded', detail: period.label }],
      }
    })
  })
  return { profiles, sheets, periods, current, anchor: payroll.anchor }
}

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

  // 12 back-weeks (not 8): the demo claim ledgers group by calendar month, so the
  // oldest month in the window must always be old enough to reach the paid band
  // (40+ days) — otherwise a re-seed on a Monday can open the billing desk with
  // no paid history at all.
  for (let w = -12; w <= 4; w++) {
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
          rate: SVC_CODE[s.svc] === '97152' ? (rnd() < 0.5 ? 37 : 35) : autoBilling({}, dur).rate || 16,
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
        // when the family told us (deterministic, like the reason): some cancellations
        // carry no time at all, and the engines must not guess for those
        const notice = seedCancelNotice(status, c.id, di, start)
        push({
          type: 'service',
          date: di,
          start,
          end: start + dur,
          title: SVC_LABEL[s.svc],
          staffIds,
          clientIds: [c.id],
          status,
          ...(status === 'cancelled' || status === 'no-show' ? seedCancelReason(status, c.id, di) : {}),
          ...(notice ? { cancelledAt: notice } : {}),
          location: c.home === 'Main Center' && rnd() < 0.15 ? 'Clinic Room 2' : c.home,
          service: s.svc,
          notes,
          recurrence: 'weekly',
          seriesId,
          edited: isException || undefined,
          billing,
          custom: {},
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
              billing: { code: 'H2019', unitMins: 15, minutes: 20, units: 0, rate: 0, mileage: true, distance: dist, mileageRate: 0.7 },
              custom: {},
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
              custom: {},
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
          notes: 'Parents practiced DRT at home; reviewed token board setup.', billing: autoBilling({}, 60), recurrence: 'biweekly',
          seriesId: `sr-${c.id}-cg`, custom: {}, documents: [],
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
        notes: 'Agenda: caseload moves, auth expirations, safety drill.', recurrence: 'weekly', seriesId: 'sr-meeting', custom: {},
      })
    }
    // ⚡ ABA Hours: non-service staff time that is *behavior-analytic*, tracked for
    // RBT / BCAT, graduate-student and state-certification requirements. Group training
    // on behavior-analytic principles, held outside of client sessions.
    const trainees = ['s3', 's4', 's7', 's10', 's5']
    const td = addDays(weekStart, 1)
    const tdi = isoDate(td)
    const ts = place(trainees, tdi, G(7) + 30, 90, 19 * 60)
    if (ts != null) {
      occ(trainees, tdi, ts, ts + 90)
      push({
        type: 'unavailable', date: tdi, start: ts, end: ts + 90,
        title: 'ABA group training — reinforcement & protocol fidelity',
        staffIds: trainees, clientIds: [], status: td < todayISO ? 'completed' : 'active', location: 'Clinic Room 1',
        notes: 'Led by the clinical supervisor: DRA procedures, fidelity checklist review, role-play.',
        recurrence: 'weekly', seriesId: 'sr-aba-training', custom: {},
        abaHr: true, abaActivity: 'group-training',
      })
    }
    // graduate student: designing / reviewing interventions during non-billable time
    const gd = addDays(weekStart, 2)
    const gdi = isoDate(gd)
    const gs = place(['s5'], gdi, G(3), 90, 19 * 60)
    if (gs != null) {
      occ(['s5'], gdi, gs, gs + 90)
      push({
        type: 'unavailable', date: gdi, start: gs, end: gs + 90,
        title: 'Intervention design & review (graduate student)',
        staffIds: ['s5'], clientIds: [], status: gd < todayISO ? 'completed' : 'active', location: 'Main Center',
        notes: 'Drafting and revising skill-acquisition programs under supervision; graphing weekly data.',
        recurrence: 'weekly', seriesId: 'sr-aba-design', custom: {},
        abaHr: true, abaActivity: 'intervention-design',
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
        recurrence: 'weekly', seriesId: `sr-sup-${sup}-${rbt}`, custom: {},
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
      // ABA coursework counts as behavior-analytic time; PTO and personal errands do not.
      const abaAct = /CEU|workshop|staff training/i.test(ptoTitle) ? 'coursework' : ''
      push({
        type: 'unavailable', date: di, start: shapes[0], end: shapes[1],
        title: ptoTitle, staffIds: [st.id], clientIds: [], status: 'active',
        notes: 'Approved by scheduler — covered by float staff.', recurrence: 'none',
        custom: {},
        abaHr: Boolean(abaAct), abaActivity: abaAct || undefined,
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
      recurrence: 'none',
      billing: { ...autoBilling({ billing: { code: '97152' } }, dur), rate: 37 },
      custom: {},
      documents: di < todayISO ? [{ id: uid(), name: `Assessment Summary ${di}.pdf`, size: 480_000, tag: 'Assessment report' }, { id: uid(), name: 'Scoring Workbook.xlsx', size: 120_000, tag: 'Data export' }] : [],
      verification: di < todayISO ? { completedBy: 's6', checks: { data: true, safety: true, materials: true, caregiver: false }, verifyStatus: 'verified', note: 'Client tolerated full protocol.' } : null,
    })
  }

  return appts
}

/** A period-start date that is guaranteed to contain today for the given cycle. */
export function currentPayrollAnchor(frequency = 'biweekly', today = todayISO()) {
  const t = parseISO(today)
  if (frequency === 'monthly') return isoDate(new Date(t.getFullYear(), t.getMonth(), 1))
  if (frequency === 'semimonthly') return isoDate(new Date(t.getFullYear(), t.getMonth(), t.getDate() >= 16 ? 16 : 1))
  const monday = addDays(t, -((t.getDay() + 6) % 7)) // week start, Monday-aligned
  return isoDate(frequency === 'weekly' ? monday : addDays(monday, -7))
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
    if (age >= 40 && rnd() < 0.8) {
      c.submittedAt = stamp(age - 5)
      c.history.push({ at: c.submittedAt, ev: c.mode === 'selfpay' ? 'Invoice marked sent to family; the app sends nothing' : `Marked submitted to ${c.payer}; claim file saved locally, not transmitted` })
      const short = c.mode === 'insurance' && rnd() < 0.45
      c.paid = short ? Math.round(c.charges * (pol.coins ?? 0.85)) : c.charges
      c.adj = Math.round((c.charges - c.paid) * 100) / 100
      c.status = 'paid'
      c.closedAt = Math.max(c.submittedAt + dayMs, Math.min(t0 - dayMs, c.submittedAt + Math.round(pol.avgDays * (0.65 + rnd() * 0.7) + 1) * dayMs))
      c.remittance = { checkNo: `CHK-${isoDate(new Date(c.closedAt)).slice(2, 7).replace('-', '')}-${String(120 + i)}`, amount: c.paid, adj: c.adj, at: c.closedAt, note: short ? 'Contractual adjustment per fee schedule' : '' }
      c.history.push({ at: c.closedAt, ev: `Payment posted — $${c.paid.toLocaleString()} via ${c.remittance.checkNo}${short ? ` (${c.adj.toLocaleString()} adjustment)` : ''}` })
    } else if (age >= 13) {
      c.submittedAt = stamp(Math.max(3, age - 4))
      c.history.push({ at: c.submittedAt, ev: c.mode === 'selfpay' ? 'Invoice marked sent to family; the app sends nothing' : `Marked submitted to ${c.payer}; claim file saved locally, not transmitted` })
      c.status = 'submitted'
      // denial candidates: payer denial reasons never apply to a family's self-pay invoice
      if (c.mode === 'insurance') (age >= 30 ? lateSet : midSet).push(c)
    }
    for (const id of c.lines.flatMap((l) => l.apptIds || [l.apptId])) {
      const a = out[id]
      if (a) out[id] = { ...a, claimId: c.id, billing: { ...(a.billing || {}), status: 'claimed', claimNo: c.no } }
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

// A few paid insurance claims leave a family share (coinsurance the payer reported), so client
// statements and the patient A/R bucket have something to show. One claim per client, at most
// `max`. Clients with secondary coverage are skipped: their open balance belongs to the COB demo.
export function seedFamilyShares(claims, clients, max = 3) {
  const r2 = (n) => Math.round(n * 100) / 100
  const primaryOnly = new Set((clients || []).filter((c) => !c.secondary).map((c) => c.id))
  const picks = Object.values(claims)
    .filter((c) => c.status === 'paid' && c.mode === 'insurance' && c.paid >= 50 && c.remittance && primaryOnly.has(c.clientId))
    .sort((a, b) => String(a.no).localeCompare(String(b.no)))
  const out = { ...claims }
  const done = new Set()
  for (const c of picks) {
    if (done.size >= max) break
    if (done.has(c.clientId)) continue
    done.add(c.clientId)
    // the payer paid less and reported the difference as the family's coinsurance
    const share = Math.max(10, Math.round(c.paid * 0.1))
    const paid = r2(c.paid - share)
    const rem = { ...c.remittance, amount: paid, patientResp: share }
    out[c.id] = {
      ...c, paid, status: 'partially_paid', closedAt: null, remittance: rem,
      history: [...c.history.filter((h) => !/^Payment posted/.test(h.ev)),
        { at: rem.at, ev: `Payment posted — $${paid.toLocaleString()} via ${rem.checkNo}${c.adj ? ` (${c.adj.toLocaleString()} adjustment)` : ''} · $${share} patient responsibility reported` }],
    }
  }
  return out
}

// ---- Intake Manager seeding ---------------------------------------------------
// Referral sources are the upstream relationships the intake pipeline attributes
// to; requests are the pre-client records themselves. Everything here is
// fictional. Demo requests span every stage so the pipeline, the KPIs and the
// conversion flow all have something real to render on a fresh workspace.
const DAY = 86400000
const at = (days, hours = 0) => Date.now() - days * DAY - hours * 3600000
const iso = (ms) => isoDate(new Date(ms))

export const REFERRAL_SOURCES = [
  { id: 'rs-peds', name: 'Sunnyvale Pediatrics', kind: 'Pediatrician', contact: 'Dr. Amelia Ford', phone: '(408) 555-0301', email: 'referrals@sunnyvalepeds.example.com', npi: '1437291055', ownerId: 's12', status: 'active', since: '2024-03-01', dormantDays: 60, notes: 'Prefers a same-day fax acknowledgement; asks for a written plan summary.' },
  { id: 'rs-devpeds', name: 'Bay Area Developmental Pediatrics', kind: 'Developmental pediatrician', contact: 'Dr. Rohan Mehta', phone: '(408) 555-0302', email: 'intake@baydevpeds.example.com', npi: '1780664211', ownerId: 's9', status: 'active', since: '2023-08-14', dormantDays: 60, notes: 'Diagnostic reports usually arrive with the referral — always ask.' },
  { id: 'rs-neuro', name: 'Coast Neurology Associates', kind: 'Neurologist', contact: 'Dr. Priya Nair', phone: '(650) 555-0303', email: 'newpatients@coastneuro.example.com', npi: '1194837260', ownerId: 's9', status: 'active', since: '2025-01-20', dormantDays: 90, notes: 'Wants feedback on assessment outcome for shared patients.' },
  { id: 'rs-fusd', name: 'Fremont Unified School District', kind: 'School district', contact: 'Special Ed Services', phone: '(510) 555-0171', email: 'special.edservices@fusd.example.edu', npi: '', ownerId: 's12', status: 'active', since: '2022-09-06', dormantDays: 120, notes: 'School-year referral waves; IEP must accompany the referral.' },
  { id: 'rs-rc', name: 'Regional Center of the East Bay', kind: 'Regional center', contact: 'Intake desk', phone: '(510) 555-0304', email: 'servicecoord@rceb.example.gov', npi: '', ownerId: 's12', status: 'active', since: '2021-06-01', dormantDays: 120, notes: 'Vendor number required on every authorisation request.' },
  { id: 'rs-slp', name: 'Little Voices Speech & OT', kind: 'Other provider (SLP/OT)', contact: 'Marcy Lin, CCC-SLP', phone: '(408) 555-0305', email: 'hello@littlevoices.example.com', npi: '1558302941', ownerId: 's11', status: 'active', since: '2024-11-11', dormantDays: 90, notes: 'Co-treatment friendly — flag speech co-treatment requests.' },
  { id: 'rs-self', name: 'Family self-referral', kind: 'Self / family', contact: '—', phone: '', email: '', npi: '', ownerId: 's12', status: 'active', since: '2022-01-04', dormantDays: 999, notes: 'Word of mouth and returning families. Ask the family to bring the diagnostic report.' },
  { id: 'rs-web', name: 'Website / online form', kind: 'Web form / marketing', contact: '—', phone: '', email: 'web@alohaaba.example.com', npi: '', ownerId: 's12', status: 'active', since: '2023-02-15', dormantDays: 45, notes: 'Response-time target: 15 minutes in business hours.' },
  { id: 'rs-hospital', name: 'Valley Children’s Hospital — Neurodevelopment', kind: 'Hospital / ED', contact: 'Discharge planning', phone: '(559) 555-0310', email: 'referrals@vch.example.org', npi: '1029384756', ownerId: 's9', status: 'active', since: '2025-04-02', dormantDays: 90, notes: 'Discharge-driven referrals; timeline is tight, escalate on receipt.' },
  { id: 'rs-community', name: 'Autism Society — South Bay chapter', kind: 'Community organisation', contact: 'Helpline volunteers', phone: '(408) 555-0311', email: 'southbay@autismsociety.example.org', npi: '', ownerId: 's12', status: 'active', since: '2024-05-19', dormantDays: 180, notes: 'High-volume, lower-conversion source; expect insurance eligibility issues.' },
  { id: 'rs-legacy-peds', name: 'Evergreen Family Medicine', kind: 'Pediatrician', contact: 'Front office', phone: '(408) 555-0312', email: '', npi: '1338274610', ownerId: null, status: 'dormant', since: '2021-03-10', dormantDays: 60, notes: 'No referrals since the practice changed ownership — relationship owner left.' },
]

// request builder: keeps the seed readable while every record carries the full schema
const req = (id, no, stage, o = {}) => {
  const created = o.createdDays != null ? at(o.createdDays) : at(6)
  return {
    id, no, kind: o.kind || 'general', stage,
    createdAt: created, updatedAt: at(o.touchedDays != null ? o.touchedDays : 1), stageSince: at(o.stageDays != null ? o.stageDays : 2),
    createdBy: o.createdBy || 's12', ownerId: o.ownerId !== undefined ? o.ownerId : 's12',
    urgency: o.urgency || 'routine', tags: o.tags || [],
    firstName: o.first || '', middleName: o.middle || '', lastName: o.last || '', alias: o.alias || '',
    office: o.office || 'Main Center', dob: o.dob || '', gender: o.gender || 'M', status: 'active',
    street: o.street || '', city: o.city || 'San Jose', state: o.state || 'CA', zip: o.zip || '95124', addressNotes: o.addressNotes || '',
    phones: o.phones || [{ id: `${id}-ph1`, type: 'Mobile', number: o.phone || '', ext: '', primary: true }],
    email: o.email || '', preferredLanguage: o.language || 'English', interpreter: Boolean(o.interpreter),
    livingArrangement: o.living || 'Lives with parents / guardians', schoolName: o.school || '', iep: Boolean(o.iep),
    photo: null,
    guardian: o.guardian || { name: '', relation: '', phone: '', email: '', addressSame: true },
    emergency: o.emergency || { name: '', relation: '', phone: '' },
    guardianshipNote: o.guardianshipNote || '',
    referralSourceId: o.source || null, referredByName: o.referredBy || '', referredByOrg: '', referringNpi: o.referringNpi || '',
    referralDate: o.referralDate || iso(created), referralChannel: o.channel || 'Phone', referralNotes: o.referralNotes || '',
    diagnosisStatus: o.dxStatus || 'unknown', diagnosis: o.dx || '', diagnosedBy: o.dxBy || '', diagnosedOn: o.dxOn || '',
    concerns: o.concerns || '', priorTherapy: Boolean(o.priorTherapy), priorTherapyNotes: o.priorNotes || '',
    medications: o.medications || '', allergies: o.allergies || '', safetyRisks: o.safety || '',
    settingPref: o.setting || 'Undecided', serviceLine: o.serviceLine || '', program: o.program || '',
    preferredDays: o.days || '', preferredTimes: o.times || '', availabilityNotes: o.availability || '',
    bcbaAssignedId: o.bcba || null,
    screen: o.screen || { fit: '', at: null, by: null, notes: '' },
    payerId: o.payer || null, secondaryPayerId: o.secondaryPayer || null, memberId: o.memberId || '', groupNumber: o.group || '',
    subscriberName: o.subscriber || '', subscriberDob: o.subDob || '', subscriberRelation: o.subRel || 'Parent',
    planType: o.planType || 'Commercial', policyStatus: o.policyStatus || 'active',
    vob: { status: 'pending', at: null, by: null, repName: '', refNo: '', callPhone: '', effectiveFrom: '',
      deductible: '', deductibleMet: '', oopMax: '', coinsurance: '', copay: '', visitLimit: '',
      abaCovered: null, inNetwork: null, priorAuthRequired: null, telehealthCovered: null, notes: '', ...(o.vob || {}) },
    waitlist: { reason: '', priority: '', since: null, reviewBy: '', position: null, notes: '', ...(o.waitlist || {}) },
    apptId: null, apptDate: '', clinicianId: o.clinician || null,
    assessment: { date: '', instrument: '', outcome: '', recommendedHoursPerWeek: '', recommendedSetting: '', completedBy: null, reportDueBy: '', ...(o.assessment || {}) },
    auth: { submittedAt: '', requestRef: '', unitsRequested: '', units: '', windowStart: '', windowEnd: '', decision: '', decisionAt: '', authNo: '', notes: '', ...(o.auth || {}) },
    docs: o.docs || {}, consents: o.consents || [], contacts: o.contacts || [], tasks: [], events: o.events || [],
    lost: { reason: '', notes: '', at: null, by: null, ...(o.lost || {}) },
    convertedAt: null, clientId: null, firstServiceDate: '', notes: o.notes || '',
  }
}

const received = (days, by = 's12') => ({ status: 'received', at: at(days), by })
const waived = (days, by = 's12', note = '') => ({ status: 'waived', at: at(days), by, note })

/**
 * Build the seeded intake pipeline.
 * @param {object} ctx { appts, clients, staff, payers, today }
 * @returns {{intakeRequests:object, referralSources:array, clientPatches:object}}
 */
export function seedIntake(ctx = {}) {
  const appts = ctx.appts || {}
  const clients = ctx.clients || []
  const payers = ctx.payers || []
  const payerId = (name) => payers.find((p) => p.name === name)?.id || null
  const bsca = payerId('Blue Shield CA')
  const aetna = payerId('Aetna')
  const uhc = payerId('UnitedHealthcare')
  const medi = payerId('Medicaid (CA)')
  // An evaluation already on the calendar becomes the booked assessment for a
  // scheduled request — the calendar stays the single source of truth for time.
  const evals = Object.values(appts).filter((a) => a.type === 'evaluation' && a.date >= todayISO()).sort((x, y) => (x.date < y.date ? -1 : 1))

  const intakeRequests = {}
  const put = (r) => { intakeRequests[r.id] = r; return r }

  put(req('iq-1001', 'INT-1001', 'new', {
    createdDays: 0, stageDays: 0, touchedDays: 0, urgency: 'urgent', source: 'rs-web', channel: 'Web form',
    first: 'Maya', last: 'Ellison', dob: '2021-04-18', gender: 'F', phone: '(408) 555-0321', email: 'r.ellison@example.com', city: 'Santa Clara', zip: '95050',
    guardian: { name: 'Rachel Ellison', relation: 'Mother', phone: '(408) 555-0321', email: 'r.ellison@example.com', addressSame: true },
    concerns: 'Web form: 4-year-old, no diagnosis yet, frequent meltdowns at preschool. Asked about evaluation timelines.',
    notes: 'Overnight web form — first call owed within 15 minutes per source SLA.',
    contacts: [], events: [{ at: at(0), by: null, ev: 'Request created from the website form (unassigned overnight)' }],
  }))

  put(req('iq-1002', 'INT-1002', 'new', {
    createdDays: 0, stageDays: 0, touchedDays: 0, source: 'rs-community', channel: 'Phone', urgency: 'routine',
    first: 'Andre', last: 'Okafor', dob: '2019-11-02', phone: '(408) 555-0322', city: 'Milpitas', zip: '95035',
    guardian: { name: 'Ngozi Okafor', relation: 'Mother', phone: '(408) 555-0322', email: '', addressSame: true },
    concerns: 'Community helpline passed along the family; behaviour concerns at home, has Medi-Cal.',
    contacts: [], events: [{ at: at(0), by: 's12', ev: 'Request captured from the Autism Society helpline call' }],
  }))

  put(req('iq-1003', 'INT-1003', 'new', {
    createdDays: 2, stageDays: 2, touchedDays: 2, source: 'rs-legacy-peds', channel: 'Fax', urgency: 'routine',
    first: 'Liam', last: 'Novak', dob: '2020-07-09', phone: '(408) 555-0323', city: 'Campbell', zip: '95008',
    guardian: { name: 'Petra Novak', relation: 'Mother', phone: '(408) 555-0323', email: 'p.novak@example.com', addressSame: true },
    concerns: 'Faxed referral received; the practice changed ownership and no relationship owner is assigned.',
    referringNpi: '1338274610', notes: 'Source is dormant — confirm the sender before treating this as a live relationship.',
    contacts: [], events: [{ at: at(2), by: 's12', ev: 'Referral fax received' }],
  }))

  put(req('iq-1004', 'INT-1004', 'contacted', {
    createdDays: 5, stageDays: 3, touchedDays: 1, source: 'rs-peds', channel: 'Phone', urgency: 'urgent',
    first: 'Sofia', last: 'Marchetti', dob: '2018-02-27', gender: 'F', phone: '(408) 555-0324', email: 'marchetti.family@example.com', city: 'Sunnyvale', zip: '94086',
    guardian: { name: 'Giulia Marchetti', relation: 'Mother', phone: '(408) 555-0324', email: 'marchetti.family@example.com', addressSame: true },
    referredBy: 'Dr. Amelia Ford', referringNpi: '1437291055',
    concerns: 'Verbal request from Dr. Ford’s office: school reported regression after a move.',
    contacts: [
      { id: 'c1', at: at(1, 3), by: 's12', channel: 'Phone', direction: 'outbound', outcome: 'reached', summary: 'Spoke with mother; collecting the diagnostic report and insurance card.', nextStepAt: iso(at(-2)) },
    ],
    events: [{ at: at(5), by: 's12', ev: 'Referral logged from Sunnyvale Pediatrics' }, { at: at(1, 3), by: 's12', ev: 'Contact attempt logged — reached (Phone)' }],
  }))

  put(req('iq-1005', 'INT-1005', 'contacted', {
    createdDays: 9, stageDays: 6, touchedDays: 6, source: 'rs-self', channel: 'Phone', urgency: 'routine',
    first: 'Noah', last: 'Bergström', dob: '2020-10-14', phone: '(408) 555-0325', city: 'Los Gatos', zip: '95030',
    guardian: { name: 'Elsa Bergström', relation: 'Mother', phone: '(408) 555-0325', email: '', addressSame: true },
    concerns: 'Left voicemail twice; family has not called back.',
    contacts: [
      { id: 'c1', at: at(8), by: 's12', channel: 'Phone', direction: 'outbound', outcome: 'voicemail', summary: 'Left a voicemail with the intake line and hours.', nextStepAt: iso(at(5)) },
      { id: 'c2', at: at(6), by: 's12', channel: 'Text / SMS', direction: 'outbound', outcome: 'email_sent', summary: 'Sent a text asking for the best time to talk.' },
    ],
    events: [{ at: at(9), by: 's12', ev: 'Self-referral logged' }],
  }))

  put(req('iq-1006', 'INT-1006', 'screened', {
    createdDays: 12, stageDays: 4, touchedDays: 2, source: 'rs-devpeds', channel: 'Fax', urgency: 'routine',
    first: 'Ethan', last: 'Park', dob: '2019-06-03', phone: '(408) 555-0326', email: 'park.family@example.com', city: 'Santa Clara', zip: '95051',
    guardian: { name: 'Jisoo Park', relation: 'Mother', phone: '(408) 555-0326', email: 'park.family@example.com', addressSame: true },
    referredBy: 'Dr. Rohan Mehta', referringNpi: '1780664211', dxStatus: 'confirmed', dx: 'Autism Spectrum Disorder, Level 2', dxBy: 'Dr. Rohan Mehta', dxOn: '2026-05-12',
    concerns: 'Diagnostic report received. Limited requesting, transitions are hard, no safety concerns.',
    priorTherapy: true, priorNotes: '6 months of speech therapy at Little Voices; no prior ABA.',
    setting: 'Center-based', serviceLine: 'Center-based 1:1', program: 'Center-based · 1:1', days: 'Mon–Fri mornings', times: '8:30–11:30',
    language: 'English', school: 'Little Star Preschool',
    screen: { fit: 'fit', at: at(2), by: 's12', notes: 'Age and service area confirmed; clinically appropriate for a center-based assessment.' },
    docs: { diagnostic_report: received(4, 's12'), prior_records: { status: 'requested', at: at(2), by: 's12', note: 'ROI sent to Little Voices' } },
    contacts: [{ id: 'c1', at: at(10), by: 's12', channel: 'Phone', direction: 'outbound', outcome: 'reached', summary: 'Completed the intake questionnaire with the mother.' }],
    events: [{ at: at(12), by: 's12', ev: 'Referral logged from Bay Area Developmental Pediatrics' }, { at: at(2), by: 's12', ev: 'Clinical pre-screen saved — fit' }],
  }))

  put(req('iq-1007', 'INT-1007', 'screened', {
    createdDays: 4, stageDays: 1, touchedDays: 0, source: 'rs-fusd', channel: 'Professional referral', urgency: 'urgent',
    first: 'Aaliyah', last: 'Rahman', dob: '2017-08-21', gender: 'F', phone: '(510) 555-0327', city: 'Fremont', zip: '94538',
    guardian: { name: 'Farida Rahman', relation: 'Mother', phone: '(510) 555-0327', email: 'f.rahman@example.com', addressSame: true },
    referredBy: 'FUSD Special Ed Services', dxStatus: 'confirmed', dx: 'Autism Spectrum Disorder', dxOn: '2025-03-04',
    concerns: 'School exclusion risk: two suspensions this term. IEP in place; district is requesting school-based support.',
    priorTherapy: true, priorNotes: 'School-based ABA for one year in another district.',
    setting: 'School-based', serviceLine: 'School-based inclusion', program: 'School-based · Inclusion', iep: true, school: 'Jefferson Elementary',
    guardianNote: '', guardianshipNote: '',
    screen: { fit: 'maybe', at: at(1), by: 's9', notes: 'Clinically appropriate but school-based capacity is tight this term — check staffing before promising a date.' },
    docs: { iep_ifsp: received(3, 's12') },
    contacts: [{ id: 'c1', at: at(3), by: 's12', channel: 'Phone', direction: 'outbound', outcome: 'reached', summary: 'Mother confirmed the district referral and IEP date.' }],
    events: [{ at: at(4), by: 's12', ev: 'District referral received (urgent — school exclusion risk)' }],
  }))

  put(req('iq-1008', 'INT-1008', 'benefits', {
    createdDays: 16, stageDays: 5, touchedDays: 3, source: 'rs-neuro', channel: 'Fax', urgency: 'routine',
    first: 'Lucas', last: 'Ferreira', dob: '2020-01-30', phone: '(650) 555-0328', email: 'ferreira.home@example.com', city: 'Redwood City', zip: '94061',
    guardian: { name: 'Ana Ferreira', relation: 'Mother', phone: '(650) 555-0328', email: 'ferreira.home@example.com', addressSame: true },
    referredBy: 'Dr. Priya Nair', referringNpi: '1194837260', dxStatus: 'confirmed', dx: 'Autism Spectrum Disorder, Level 1',
    concerns: 'Pragmatic language and social skills; neurologist recommends early intervention.',
    setting: 'Home-based', serviceLine: 'Home program (NET)', program: 'Home program · NET',
    payer: bsca, memberId: 'BSC-8841207', group: 'GRP-4410', subscriber: 'Ana Ferreira', subDob: '1991-07-08', subRel: 'Parent', planType: 'Commercial',
    vob: { status: 'in_progress', at: at(1), by: 's12', repName: 'Dana W.', refNo: 'VOB-22841', callPhone: '(800) 555-0114', priorAuthRequired: true, inNetwork: true, abaCovered: true, coinsurance: 20, copay: 0, visitLimit: 'No annual limit; 6-month reviews', notes: 'Representative confirmed ABA coverage; waiting on the deductible balance.' },
    docs: { insurance_card: received(5, 's12'), diagnostic_report: received(9, 's12'), referral: received(9, 's12') },
    contacts: [{ id: 'c1', at: at(12), by: 's12', channel: 'Phone', direction: 'outbound', outcome: 'reached', summary: 'Pre-screen complete.' }, { id: 'c2', at: at(3), by: 's12', channel: 'Phone', direction: 'outbound', outcome: 'reached', summary: 'Called the payer; verification in progress.' }],
    screen: { fit: 'fit', at: at(11), by: 's12', notes: 'Home-based NET is a good fit; family available weekday afternoons.' },
    events: [{ at: at(16), by: 's12', ev: 'Referral logged from Coast Neurology' }, { at: at(1), by: 's12', ev: 'Benefits verification started with Blue Shield CA' }],
  }))

  put(req('iq-1009', 'INT-1009', 'benefits', {
    createdDays: 7, stageDays: 2, touchedDays: 2, source: 'rs-peds', channel: 'Phone', urgency: 'routine',
    first: 'Priya', last: 'Sundaram', dob: '2021-12-11', gender: 'F', phone: '(408) 555-0329', email: 'sundaram.family@example.com', city: 'San Jose', zip: '95128',
    guardian: { name: 'Karthik Sundaram', relation: 'Father', phone: '(408) 555-0329', email: 'sundaram.family@example.com', addressSame: true },
    referredBy: 'Dr. Amelia Ford', dxStatus: 'suspected', concerns: 'Not yet diagnosed; pediatrician is referring while the developmental evaluation is pending.',
    setting: 'Center-based', serviceLine: 'Assessment / reevaluation', program: 'Assessment / intake',
    payer: aetna, memberId: 'AE-5590231', group: 'AE-ABA-02', subscriber: 'Karthik Sundaram', subDob: '1988-05-19', planType: 'Commercial',
    vob: { status: 'pending', notes: 'Member ID captured; card image outstanding.' },
    docs: { insurance_card: { status: 'requested', at: at(2), by: 's12', note: 'Requested a card photo by text' } },
    contacts: [{ id: 'c1', at: at(5), by: 's12', channel: 'Phone', direction: 'outbound', outcome: 'reached', summary: 'Screening call completed; referral is on the way.' }],
    screen: { fit: 'fit', at: at(5), by: 's12', notes: 'Assessment-first pathway; no diagnosis yet so the plan may require an evaluation.' },
    events: [{ at: at(7), by: 's12', ev: 'Referral logged from Sunnyvale Pediatrics' }],
  }))

  put(req('iq-1010', 'INT-1010', 'review', {
    createdDays: 22, stageDays: 6, touchedDays: 4, source: 'rs-rc', channel: 'Professional referral', urgency: 'routine',
    first: 'Diego', last: 'Alvarez', dob: '2018-09-05', phone: '(510) 555-0330', email: 'alvarez.home@example.com', city: 'Oakland', zip: '94611',
    guardian: { name: 'Marisol Alvarez', relation: 'Mother', phone: '(510) 555-0330', email: 'alvarez.home@example.com', addressSame: true },
    dxStatus: 'confirmed', dx: 'Autism Spectrum Disorder, Level 2', dxOn: '2024-10-02',
    concerns: 'Regional center vendor referral. Aggression toward siblings at a low rate; caregiver reports exhaustion.',
    setting: 'Home-based', serviceLine: 'Home program (NET)', program: 'EIBI · Home program', bcba: 's9',
    payer: medi, memberId: 'MC-77410925', subscriber: 'Marisol Alvarez', subDob: '1985-02-14', planType: 'Medicaid',
    vob: { status: 'complete', at: at(8), by: 's12', repName: 'Luis R.', refNo: 'VOB-22910', callPhone: '(800) 555-0158', inNetwork: true, abaCovered: true, coinsurance: 0, copay: 0, deductible: 0, deductibleMet: 0, visitLimit: 'Per authorisation, 6-month window', priorAuthRequired: true, telehealthCovered: false, notes: 'Medi-Cal: no cost share; prior authorisation required for every window.' },
    docs: { diagnostic_report: received(18, 's12'), referral: received(18, 's12'), insurance_card: received(19, 's12'), prior_records: received(12, 's12') },
    contacts: [{ id: 'c1', at: at(20), by: 's12', channel: 'Phone', direction: 'outbound', outcome: 'reached', summary: 'Pre-screen completed with the mother.' }, { id: 'c2', at: at(8), by: 's12', channel: 'Phone', direction: 'outbound', outcome: 'reached', summary: 'Benefits verification completed with the payer.' }],
    screen: { fit: 'fit', at: at(19), by: 's12', notes: 'Home-based services clinically appropriate; needs a BCBA with Spanish-language capacity.' },
    events: [{ at: at(22), by: 's12', ev: 'Regional center referral logged' }, { at: at(8), by: 's12', ev: 'Benefits verified — Medi-Cal, no cost share' }],
  }))

  put(req('iq-1011', 'INT-1011', 'review', {
    createdDays: 30, stageDays: 11, touchedDays: 11, source: 'rs-hospital', channel: 'Email', urgency: 'urgent',
    first: 'Zoe', last: 'Whitfield', dob: '2016-03-17', gender: 'F', phone: '(559) 555-0331', email: 'whitfield.family@example.com', city: 'Fresno', zip: '93720',
    guardian: { name: 'Tanya Whitfield', relation: 'Mother', phone: '(559) 555-0331', email: 'whitfield.family@example.com', addressSame: true },
    dxStatus: 'confirmed', dx: 'Autism Spectrum Disorder, Level 3',
    concerns: 'Hospital discharge referral. Elopement risk; needs a rapid clinical decision.',
    setting: 'Center-based', serviceLine: 'Behavior reduction', program: 'Behavior reduction', bcba: 's8',
    payer: uhc, memberId: 'UHC-3301884', subscriber: 'Tanya Whitfield', subDob: '1983-12-01', planType: 'Medicaid',
    vob: { status: 'complete', at: at(12), by: 's12', repName: 'Priya S.', refNo: 'VOB-22788', callPhone: '(844) 555-0149', inNetwork: true, abaCovered: true, coinsurance: 0, priorAuthRequired: true, notes: 'Authorisation required; plan confirmed intensive hours are medically necessary.' },
    docs: { diagnostic_report: received(25, 's12'), referral: received(25, 's12'), insurance_card: received(26, 's12') },
    contacts: [{ id: 'c1', at: at(28), by: 's12', channel: 'Phone', direction: 'outbound', outcome: 'reached', summary: 'Discharge planner confirmed the referral.' }, { id: 'c2', at: at(14), by: 's12', channel: 'Email', direction: 'outbound', outcome: 'email_sent', summary: 'Sent the service-area confirmation and requested records.' }],
    screen: { fit: 'fit', at: at(27), by: 's9', notes: 'Urgent: safety risk. Clinical review owed — this record is over its stage SLA.' },
    notes: 'Escalated by the clinical director. Clinical review has been open 11 days against a 1-day urgent budget.',
    events: [{ at: at(30), by: 's12', ev: 'Hospital referral received (urgent)' }, { at: at(11), by: 's9', ev: 'Assigned to Dr. Rohit Srivastava for clinical review' }],
  }))

  put(req('iq-1012', 'INT-1012', 'waitlist', {
    createdDays: 40, stageDays: 15, touchedDays: 5, source: 'rs-slp', channel: 'Phone', urgency: 'routine',
    first: 'Mason', last: 'Cole', dob: '2019-02-08', phone: '(408) 555-0332', email: 'cole.family@example.com', city: 'Cupertino', zip: '95014',
    guardian: { name: 'Derek Cole', relation: 'Father', phone: '(408) 555-0332', email: 'cole.family@example.com', addressSame: true },
    referredBy: 'Marcy Lin, CCC-SLP', dxStatus: 'confirmed', dx: 'Autism Spectrum Disorder, Level 1',
    concerns: 'Speech co-treatment recommended alongside ABA; family is flexible about timing.',
    setting: 'Center-based', serviceLine: 'Speech co-treatment', program: 'Speech co-treatment', bcba: 's11',
    payer: bsca, memberId: 'BSC-9912004', subscriber: 'Derek Cole', subDob: '1986-09-30', planType: 'Commercial',
    vob: { status: 'complete', at: at(30), by: 's12', repName: 'Dana W.', refNo: 'VOB-22540', callPhone: '(800) 555-0114', inNetwork: true, abaCovered: true, coinsurance: 20, copay: 25, deductible: 1500, deductibleMet: 900, priorAuthRequired: true, telehealthCovered: true },
    docs: { diagnostic_report: received(35, 's12'), referral: received(35, 's12'), insurance_card: received(36, 's12') },
    waitlist: { reason: 'No assessment slot', priority: '2 · Medium', since: at(15), reviewBy: iso(at(-9)), position: 3, notes: 'Co-treatment slot opens when the SLP returns from leave.' },
    contacts: [{ id: 'c1', at: at(38), by: 's12', channel: 'Phone', direction: 'outbound', outcome: 'reached', summary: 'Pre-screen completed.' }, { id: 'c2', at: at(5), by: 's12', channel: 'Phone', direction: 'outbound', outcome: 'reached', summary: 'Monthly waitlist check-in call; family is still keen.' }],
    screen: { fit: 'fit', at: at(37), by: 's12', notes: 'Clinically ready; capacity-gated.' },
    events: [{ at: at(40), by: 's12', ev: 'Referral logged from Little Voices' }, { at: at(15), by: 's12', ev: 'Placed on the waitlist — No assessment slot' }],
  }))

  put(req('iq-1013', 'INT-1013', 'waitlist', {
    createdDays: 65, stageDays: 34, touchedDays: 34, source: 'rs-community', channel: 'Web form', urgency: 'routine',
    first: 'Ivy', last: 'Nakamura', dob: '2020-06-25', gender: 'F', phone: '(408) 555-0333', email: 'nakamura.family@example.com', city: 'Morgan Hill', zip: '95037',
    guardian: { name: 'Ken Nakamura', relation: 'Father', phone: '(408) 555-0333', email: 'nakamura.family@example.com', addressSame: true },
    dxStatus: 'referral_only', concerns: 'Family self-referred via the community helpline; no diagnosis yet, benefits unverified.',
    setting: 'Home-based', serviceLine: 'Home program (NET)',
    payer: medi, memberId: '', planType: 'Medicaid',
    vob: { status: 'pending', notes: 'No member ID yet — this record is on the waitlist with benefits still open.' },
    waitlist: { reason: 'No technician capacity', priority: '3 · Low', since: at(34), reviewBy: '', position: 7, notes: 'Family cannot start before the school year; benefits also outstanding.' },
    contacts: [{ id: 'c1', at: at(60), by: 's12', channel: 'Email', direction: 'outbound', outcome: 'email_sent', summary: 'Sent the intake packet.' }],
    notes: 'Stalled: 34 days in waitlist with no touch and no promised review date.',
    events: [{ at: at(65), by: 's12', ev: 'Web form request created' }, { at: at(34), by: 's12', ev: 'Placed on the waitlist — No technician capacity' }],
  }))

  const bookedAppt = evals[0]
  put(req('iq-1014', 'INT-1014', 'scheduled', {
    createdDays: 29, stageDays: 4, touchedDays: 2, source: 'rs-peds', channel: 'Phone', urgency: 'routine',
    first: 'Grace', last: 'Osei', dob: '2020-09-12', gender: 'F', phone: '(408) 555-0334', email: 'osei.family@example.com', city: 'Santa Clara', zip: '95054',
    guardian: { name: 'Akosua Osei', relation: 'Mother', phone: '(408) 555-0334', email: 'osei.family@example.com', addressSame: true },
    referredBy: 'Dr. Amelia Ford', dxStatus: 'confirmed', dx: 'Autism Spectrum Disorder, Level 2',
    concerns: 'Limited eye contact and joint attention; pediatrician recommends a VB-MAPP assessment.',
    setting: 'Center-based', serviceLine: 'Center-based 1:1', program: 'Center-based · 1:1', bcba: 's1', clinician: 's1',
    payer: aetna, memberId: 'AE-7710223', subscriber: 'Akosua Osei', subDob: '1990-04-22', planType: 'Commercial',
    vob: { status: 'complete', at: at(20), by: 's12', repName: 'Marcus T.', refNo: 'VOB-22661', callPhone: '(800) 555-0127', inNetwork: true, abaCovered: true, coinsurance: 20, copay: 0, deductible: 2000, deductibleMet: 2000, priorAuthRequired: true, telehealthCovered: true, notes: 'Deductible met; auth required for the assessment and treatment.' },
    docs: { diagnostic_report: received(24, 's12'), referral: received(24, 's12'), insurance_card: received(25, 's12'), consent_treat: received(4, 's12'), hipaa_roi: received(4, 's12') },
    consents: [{ id: 'consent_treat', at: at(4), by: 's12', method: 'e-sign' }, { id: 'hipaa_roi', at: at(4), by: 's12', method: 'e-sign' }],
    apptId: bookedAppt?.id || null, apptDate: bookedAppt?.date || '',
    contacts: [{ id: 'c1', at: at(26), by: 's12', channel: 'Phone', direction: 'outbound', outcome: 'reached', summary: 'Pre-screen completed.' }, { id: 'c2', at: at(4), by: 's12', channel: 'Phone', direction: 'outbound', outcome: 'reached', summary: 'Booked the VB-MAPP assessment and confirmed the address.' }],
    screen: { fit: 'fit', at: at(25), by: 's12', notes: 'Centre-based assessment appropriate.' },
    events: [{ at: at(29), by: 's12', ev: 'Referral logged from Sunnyvale Pediatrics' }, { at: at(4), by: 's12', ev: 'Assessment appointment booked' }],
  }))

  put(req('iq-1015', 'INT-1015', 'assessment', {
    createdDays: 48, stageDays: 6, touchedDays: 3, source: 'rs-devpeds', channel: 'Fax', urgency: 'routine',
    first: 'Owen', last: 'Brennan', dob: '2017-11-23', phone: '(408) 555-0335', email: 'brennan.family@example.com', city: 'San Jose', zip: '95126',
    guardian: { name: 'Siobhan Brennan', relation: 'Mother', phone: '(408) 555-0335', email: 'brennan.family@example.com', addressSame: true },
    referredBy: 'Dr. Rohan Mehta', dxStatus: 'confirmed', dx: 'Autism Spectrum Disorder, Level 1',
    concerns: 'Assessment complete; treatment plan is being written. Needs authorisation for 20 h/week.',
    setting: 'Center-based', serviceLine: 'Center-based 1:1', program: 'Center-based · 1:1', bcba: 's2', clinician: 's2',
    payer: bsca, memberId: 'BSC-4471098', subscriber: 'Siobhan Brennan', subDob: '1987-01-15', planType: 'Commercial',
    vob: { status: 'complete', at: at(40), by: 's12', repName: 'Dana W.', refNo: 'VOB-22402', callPhone: '(800) 555-0114', inNetwork: true, abaCovered: true, coinsurance: 20, copay: 0, deductible: 1000, deductibleMet: 1000, priorAuthRequired: true, telehealthCovered: true },
    docs: { diagnostic_report: received(44, 's12'), referral: received(44, 's12'), insurance_card: received(45, 's12'), consent_treat: received(10, 's12'), hipaa_roi: received(10, 's12') },
    consents: [{ id: 'consent_treat', at: at(10), by: 's12', method: 'e-sign' }, { id: 'hipaa_roi', at: at(10), by: 's12', method: 'e-sign' }],
    assessment: { date: iso(at(6)), instrument: 'VB-MAPP', outcome: 'recommended', recommendedHoursPerWeek: 20, recommendedSetting: 'Center-based · 1:1', completedBy: 's2', reportDueBy: iso(at(-4)) },
    contacts: [{ id: 'c1', at: at(45), by: 's12', channel: 'Phone', direction: 'outbound', outcome: 'reached', summary: 'Pre-screen completed.' }, { id: 'c2', at: at(7), by: 's2', channel: 'Phone', direction: 'outbound', outcome: 'reached', summary: 'Debriefed the assessment findings with the mother.' }],
    screen: { fit: 'fit', at: at(43), by: 's12', notes: 'Centre-based services appropriate.' },
    events: [{ at: at(48), by: 's12', ev: 'Referral logged' }, { at: at(6), by: 's2', ev: 'Assessment completed — VB-MAPP, ABA recommended' }],
  }))

  put(req('iq-1016', 'INT-1016', 'auth', {
    createdDays: 55, stageDays: 8, touchedDays: 4, source: 'rs-neuro', channel: 'Fax', urgency: 'routine',
    first: 'Harper', last: 'Lindqvist', dob: '2018-05-14', gender: 'F', phone: '(650) 555-0336', email: 'lindqvist.family@example.com', city: 'Belmont', zip: '94002',
    guardian: { name: 'Erik Lindqvist', relation: 'Father', phone: '(650) 555-0336', email: 'lindqvist.family@example.com', addressSame: true },
    referredBy: 'Dr. Priya Nair', dxStatus: 'confirmed', dx: 'Autism Spectrum Disorder, Level 2',
    concerns: 'Treatment plan submitted for authorisation; 25 h/week requested.',
    setting: 'Home-based', serviceLine: 'EIBI · Early intervention', program: 'EIBI · Home program', bcba: 's3', clinician: 's3',
    payer: uhc, memberId: 'UHC-8890123', subscriber: 'Erik Lindqvist', subDob: '1984-06-11', planType: 'Commercial',
    vob: { status: 'complete', at: at(48), by: 's12', repName: 'Priya S.', refNo: 'VOB-22388', callPhone: '(844) 555-0149', inNetwork: true, abaCovered: true, coinsurance: 15, copay: 0, deductible: 750, deductibleMet: 750, priorAuthRequired: true, telehealthCovered: false },
    docs: { diagnostic_report: received(50, 's12'), referral: received(50, 's12'), insurance_card: received(51, 's12'), consent_treat: received(20, 's12'), hipaa_roi: received(20, 's12'), financial_resp: received(15, 's12') },
    consents: [{ id: 'consent_treat', at: at(20), by: 's12', method: 'e-sign' }, { id: 'hipaa_roi', at: at(20), by: 's12', method: 'e-sign' }, { id: 'financial_resp', at: at(15), by: 's12', method: 'paper' }],
    assessment: { date: iso(at(22)), instrument: 'VB-MAPP', outcome: 'recommended', recommendedHoursPerWeek: 25, recommendedSetting: 'Home-based', completedBy: 's3', reportDueBy: iso(at(12)) },
    auth: { submittedAt: iso(at(8)), requestRef: 'PA-556123', unitsRequested: 600, windowStart: iso(at(-12)), windowEnd: iso(at(64)), decision: 'pending', notes: 'Payer acknowledged the submission; decision expected within 5 business days.' },
    contacts: [{ id: 'c1', at: at(52), by: 's12', channel: 'Phone', direction: 'outbound', outcome: 'reached', summary: 'Pre-screen completed.' }, { id: 'c2', at: at(4), by: 's12', channel: 'Phone', direction: 'outbound', outcome: 'reached', summary: 'Payer confirmed receipt of the authorisation packet.' }],
    screen: { fit: 'fit', at: at(49), by: 's12', notes: 'Intensive home programme appropriate.' },
    events: [{ at: at(55), by: 's12', ev: 'Referral logged' }, { at: at(8), by: 's12', ev: 'Authorisation request submitted (PA-556123)' }],
  }))

  // ---- one request sitting on the doorstep of conversion: tomorrow's caseload ----
  const ready = put(req('iq-1022', 'INT-1022', 'auth', {
    kind: 'client', createdDays: 39, stageDays: 3, touchedDays: 2, source: 'rs-devpeds', channel: 'Fax', urgency: 'urgent',
    first: 'Ada', last: 'Okonkwo', dob: '2020-11-02', gender: 'F', phone: '(408) 555-0341', email: 'okonkwo.family@example.com', city: 'Santa Clara', zip: '95051',
    guardian: { name: 'Chidi Okonkwo', relation: 'Father', phone: '(408) 555-0341', email: 'okonkwo.family@example.com', addressSame: true },
    referredBy: 'Dr. Rohan Mehta', referringNpi: '1780664211', dxStatus: 'confirmed', dx: 'Autism Spectrum Disorder, Level 1',
    concerns: 'Authorisation approved — the family is ready to start and is waiting on a technician match for the first session.',
    setting: 'Home-based', serviceLine: 'EIBI · Early intervention', program: 'EIBI · Home program', bcba: 's4', clinician: 's4',
    payer: bsca, memberId: 'BSC-7742119', subscriber: 'Chidi Okonkwo', subDob: '1986-02-17', planType: 'Commercial',
    vob: { status: 'complete', at: at(31), by: 's12', repName: 'Denise M.', refNo: 'VOB-22891', callPhone: '(800) 555-0114', inNetwork: true, abaCovered: true, coinsurance: 10, copay: 0, deductible: 500, deductibleMet: 500, priorAuthRequired: true, telehealthCovered: true },
    docs: { diagnostic_report: received(33, 's2'), referral: received(33, 's2'), insurance_card: received(32, 's12'), consent_treat: received(6, 's12'), hipaa_roi: received(6, 's12'), financial_resp: received(5, 's12') },
    consents: [{ id: 'consent_treat', at: at(6), by: 's12', method: 'e-sign' }, { id: 'hipaa_roi', at: at(6), by: 's12', method: 'e-sign' }, { id: 'financial_resp', at: at(5), by: 's12', method: 'portal' }],
    assessment: { date: iso(at(14)), instrument: 'VB-MAPP', outcome: 'recommended', recommendedHoursPerWeek: 20, recommendedSetting: 'Home-based', completedBy: 's4', reportDueBy: iso(at(4)) },
    auth: { submittedAt: iso(at(9)), requestRef: 'PA-559004', unitsRequested: 240, units: 240, windowStart: iso(at(1)), windowEnd: iso(at(85)), decision: 'approved', decisionAt: iso(at(3)), authNo: 'AUTH-1022', notes: 'Approved as requested — 20 h/week for 12 weeks.' },
    contacts: [
      { id: 'c1', at: at(37), by: 's12', channel: 'Phone', direction: 'outbound', outcome: 'reached', summary: 'Intake call with the father; fax referral acknowledged to Dr. Mehta the same day.' },
      { id: 'c2', at: at(3), by: 's12', channel: 'Phone', direction: 'inbound', outcome: 'reached', summary: 'Family called to confirm the approval and asked what happens next.' },
    ],
    screen: { fit: 'fit', at: at(34), by: 's12', notes: 'Early-intervention window; father works from home so daytime sessions are workable.' },
    events: [{ at: at(39), by: 's12', ev: 'Referral logged from Bay Area Developmental Pediatrics' }, { at: at(3), by: 's12', ev: 'Authorisation approved (AUTH-1022) — ready to convert' }],
  }))
  ready.guardianVerifiedAt = at(2)

  // ---- converted: these carry the back-references that prove the mapping ----
  const convertedSeeds = [
    { id: 'iq-1017', no: 'INT-1017', clientId: clients[0]?.id, daysAgo: 96, source: 'rs-devpeds', first: 'Justin', last: 'Hsu', dob: '2015-06-01', gender: 'M', phone: '(408) 555-0161', city: 'San Jose', zip: '95124', guardianName: 'L. Hsu', insurer: 'Blue Shield CA', hours: 20, instrument: 'VB-MAPP' },
    { id: 'iq-1018', no: 'INT-1018', clientId: clients[4]?.id, daysAgo: 74, source: 'rs-peds', first: 'David', last: 'Wiegand', dob: '2016-02-11', gender: 'M', phone: '(408) 555-0165', city: 'San Jose', zip: '95118', guardianName: 'S. Wiegand', insurer: 'Aetna', hours: 16, instrument: 'ABLLS-R' },
    { id: 'iq-1019', no: 'INT-1019', clientId: clients[8]?.id, daysAgo: 58, source: 'rs-fusd', first: 'Gaurang', last: 'Jadia', dob: '2017-04-27', gender: 'M', phone: '(408) 555-0169', city: 'Fremont', zip: '94539', guardianName: 'N. Jadia', insurer: 'Medicaid (CA)', hours: 20, instrument: 'Vineland-3' },
  ]
  const clientPatches = {}
  for (const c of convertedSeeds) {
    if (!c.clientId) continue
    const payer = payerId(c.insurer)
    const created = at(c.daysAgo)
    put(req(c.id, c.no, 'converted', {
      kind: 'client', createdDays: c.daysAgo, stageDays: c.daysAgo - 30, touchedDays: 30,
      source: c.source, channel: 'Phone', first: c.first, last: c.last, dob: c.dob, gender: c.gender,
      phone: c.phone, city: c.city, zip: c.zip, office: 'Main Center',
      guardian: { name: c.guardianName, relation: 'Parent', phone: c.phone, email: '', addressSame: true },
      dxStatus: 'confirmed', dx: 'Autism Spectrum Disorder',
      concerns: 'Converted intake — chart created and linked.', setting: 'Center-based', serviceLine: 'Center-based 1:1',
      bcba: 's1', clinician: 's1', payer, memberId: `MEM-${c.id.slice(-4).toUpperCase()}`, subscriber: c.guardianName, subDob: '1988-01-01', planType: c.insurer === 'Medicaid (CA)' ? 'Medicaid' : 'Commercial',
      vob: { status: 'complete', at: at(c.daysAgo - 60), by: 's12', repName: 'Verified', refNo: `VOB-${1000 + c.daysAgo}`, inNetwork: true, abaCovered: true, priorAuthRequired: true },
      docs: { diagnostic_report: received(c.daysAgo - 70, 's12'), referral: received(c.daysAgo - 70, 's12'), insurance_card: received(c.daysAgo - 65, 's12'), consent_treat: received(c.daysAgo - 40, 's12'), hipaa_roi: received(c.daysAgo - 40, 's12'), financial_resp: received(c.daysAgo - 38, 's12') },
      consents: [{ id: 'consent_treat', at: at(c.daysAgo - 40), by: 's12', method: 'e-sign' }, { id: 'hipaa_roi', at: at(c.daysAgo - 40), by: 's12', method: 'e-sign' }, { id: 'financial_resp', at: at(c.daysAgo - 38), by: 's12', method: 'paper' }],
      assessment: { date: iso(at(c.daysAgo - 45)), instrument: c.instrument, outcome: 'recommended', recommendedHoursPerWeek: c.hours, recommendedSetting: 'Center-based · 1:1', completedBy: 's1', reportDueBy: iso(at(c.daysAgo - 35)) },
      auth: { submittedAt: iso(at(c.daysAgo - 36)), requestRef: `PA-${2000 + c.daysAgo}`, unitsRequested: c.hours * 12, units: c.hours * 12, windowStart: iso(at(c.daysAgo - 30)), windowEnd: iso(at(150 - c.daysAgo)), decision: 'approved', decisionAt: iso(at(c.daysAgo - 32)), authNo: `AUTH-${c.no.slice(-4)}`, notes: 'Approved as requested.' },
      contacts: [{ id: 'c1', at: at(c.daysAgo - 3), by: 's12', channel: 'Phone', direction: 'outbound', outcome: 'reached', summary: 'Completed the intake with the family.' }],
      events: [{ at: created, by: 's12', ev: 'Referral received' }, { at: at(c.daysAgo - 30), by: 's12', ev: `Converted to a client chart (${c.no})` }],
    }))
    const r = intakeRequests[c.id]
    r.convertedAt = at(c.daysAgo - 30)
    r.clientId = c.clientId
    r.firstServiceDate = iso(at(c.daysAgo - 26))
    r.guardianVerifiedAt = at(c.daysAgo - 30)
    clientPatches[c.clientId] = { intakeId: r.id, intakeNo: r.no, referralSourceId: r.referralSourceId, intakeSourceLabel: referralSourceName(r.referralSourceId), intakeConvertedAt: r.convertedAt }
  }

  // ---- closed / not admitted ----
  put(req('iq-1020', 'INT-1020', 'closed', {
    createdDays: 44, stageDays: 40, touchedDays: 40, source: 'rs-community', channel: 'Web form', urgency: 'routine',
    first: 'Jonah', last: 'Weiss', dob: '2014-01-09', phone: '(408) 555-0337', city: 'Gilroy', zip: '95020',
    guardian: { name: 'Ilana Weiss', relation: 'Mother', phone: '(408) 555-0337', email: '', addressSame: true },
    dxStatus: 'suspected', concerns: 'Insurance check came back out of network.',
    payer: null, planType: 'Commercial',
    lost: { reason: 'insurance', notes: 'Plan confirmed out of network for ABA and the family declined self-pay.', at: at(40), by: 's12' },
    docs: {}, notes: 'Tracked as a demand signal — out-of-network plans are the top loss reason this quarter.',
    contacts: [{ id: 'c1', at: at(43), by: 's12', channel: 'Phone', direction: 'outbound', outcome: 'reached', summary: 'Explained network status and self-pay options.' }],
    events: [{ at: at(44), by: 's12', ev: 'Web form request created' }, { at: at(40), by: 's12', ev: 'Closed — insurance not accepted / not active' }],
  }))

  put(req('iq-1021', 'INT-1021', 'closed', {
    createdDays: 21, stageDays: 16, touchedDays: 16, source: 'rs-self', channel: 'Phone', urgency: 'low',
    first: 'Ravi', last: 'Kulkarni', dob: '2019-03-30', phone: '(408) 555-0338', city: 'San Jose', zip: '95123',
    guardian: { name: 'Meera Kulkarni', relation: 'Mother', phone: '(408) 555-0338', email: '', addressSame: true },
    dxStatus: 'unknown', concerns: 'Called once to ask about services; never returned calls or messages.',
    lost: { reason: 'unreachable', notes: 'Three outreach attempts across two channels with no response.', at: at(16), by: 's12' },
    contacts: [
      { id: 'c1', at: at(20), by: 's12', channel: 'Phone', direction: 'outbound', outcome: 'voicemail', summary: 'Left a voicemail.' },
      { id: 'c2', at: at(18), by: 's12', channel: 'Text / SMS', direction: 'outbound', outcome: 'email_sent', summary: 'Texted the intake line and hours.' },
      { id: 'c3', at: at(17), by: 's12', channel: 'Phone', direction: 'outbound', outcome: 'no_answer', summary: 'Final attempt — no answer.' },
    ],
    events: [{ at: at(21), by: 's12', ev: 'Phone request logged' }, { at: at(16), by: 's12', ev: 'Closed — unable to reach the family' }],
  }))

  return { intakeRequests, referralSources: REFERRAL_SOURCES, clientPatches }
}

function referralSourceName(id) {
  return REFERRAL_SOURCES.find((s) => s.id === id)?.name || ''
}
