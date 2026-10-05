/**
 * chunk-42 — Settings sub-modules.
 *
 * The Settings module stops being a handful of toggles and becomes the practice
 * configuration surface: appointment statuses, custom lists, an office/location
 * master, qualifications, payroll policy and the integration/messaging records.
 *
 * Everything a control can change is a *durable* value under `settings.*`, so it
 * travels in the workspace backup and survives reload. A module that only looked
 * configured would be worse than no module at all (standing rule: no dead
 * controls), so each op below is validated against the live workspace before the
 * reducer writes it, and the writes that touch other collections (renaming an
 * office, removing an earning code) cascade in the SAME transaction — one Undo
 * reverses the whole change.
 */
import { EARNING_CODES, EARNING_BY_ID, defaultPayrollSettings, earningCodesFor, earningIndex, earningLabel, OFFICES as PAYROLL_OFFICES } from './payroll'
import { STATUSES, STATUS_ORDER, BILL_CODES, TYPES, isServiceAppt, uid } from './model'
import { abaActivityById, abaHoursCfg } from './abaHours'
import { providerIdIssues } from './providerIds'
import { planReasonLists, posFor } from './claims'

/* ── module registry ─────────────────────────────────────────────────────────
 * The sidebar, settings panels and the palette all read this one list, so a
 * module can never exist in one place and be missing from another.
 */
export const SYSTEM_SETTINGS_SECTIONS = [
  { id: 'general', label: 'General Settings' },
  { id: 'clearinghouse', label: 'Clearing House Integration' },
  { id: 'billing', label: 'Billing Settings' },
  { id: 'appointment', label: 'Appointment Settings' },
  { id: 'validations', label: 'Appointment Validations' },
  { id: 'notifications', label: 'Notification Settings' },
  { id: 'clinical-integrations', label: 'Clinical Integrations' },
  { id: 'evv', label: 'EVV Integrations' },
  { id: 'other', label: 'Other Settings' },
]

export const SETTINGS_MODULES = [
  { id: 'appointment-status', label: 'Appointment Status', icon: 'checkCircle', group: 'Scheduling', blurb: 'The status list a session can move through — and what each status pays', tabs: [], subs: [] },
  { id: 'custom-lists', label: 'Custom Lists', icon: 'rows', group: 'Scheduling', blurb: 'General and service-type pick lists used across the suite', tabs: [
    { id: 'general', label: 'General' }, { id: 'service-type', label: 'Service Type' },
  ], subs: [
    { id: 'general', label: 'General' }, { id: 'service-type', label: 'Service Type' },
  ] },
  { id: 'custom-fields', label: 'Custom Fields', icon: 'badge', group: 'Scheduling', blurb: 'Extra fields a payer or program wants captured on appointments', tabs: [], subs: [] },
  { id: 'data-import', label: 'Data Import', icon: 'download', group: 'Data', blurb: 'Bring clients, staff, payers or appointments in from a CSV file', tabs: [], subs: [] },
  { id: 'organization', label: 'Organization', icon: 'house', group: 'Practice', blurb: 'Practice identity, tax/NPI details and the office & location master', tabs: [], subs: [] },
  { id: 'payroll', label: 'Payroll', icon: 'team', group: 'Payroll', blurb: 'Pay cycles, earning codes and overtime rules', tabs: [
    { id: 'general', label: 'General' }, { id: 'earning-codes', label: 'Earning Code' }, { id: 'overtime', label: 'Overtime Rules' },
  ], subs: [
    { id: 'general', label: 'General' }, { id: 'earning-codes', label: 'Earning Code' }, { id: 'overtime', label: 'Overtime Rules' },
  ] },
  { id: 'qualification', label: 'Qualification', icon: 'star', group: 'Staffing', blurb: 'Degrees, certifications and licences staff must hold, and when they expire', tabs: [], subs: [] },
  { id: 'services', label: 'Services', icon: 'clipboard', group: 'Practice', blurb: 'Service types, billing codes, units, rates and required credentials', tabs: [], subs: [] },
  { id: 'security', label: 'Security', icon: 'shield', group: 'Access', blurb: 'Local demo accounts and role-based access', tabs: [
    { id: 'accounts', label: 'User Accounts' }, { id: 'roles', label: 'User Roles' },
  ], subs: [
    { id: 'accounts', label: 'User Accounts' }, { id: 'roles', label: 'User Roles' },
  ] },
  { id: 'clinical-integrations', label: 'Clinical Integrations', icon: 'zap', group: 'Integrations', blurb: 'Local export seams into the tools this practice already uses', tabs: [], subs: [] },
  { id: 'text-messaging', label: 'Text Messaging Services', icon: 'phone', group: 'Integrations', blurb: 'Sender identity, quiet hours, message templates and opt-outs', tabs: [], subs: [] },
  { id: 'system', label: 'System Settings', icon: 'dots', group: 'System', blurb: 'Display, naming, rates, validations, notifications, integrations and backups', tabs: [], subs: [], systemTabs: SYSTEM_SETTINGS_SECTIONS },
  { id: 'subscription', label: 'Subscription Portal', icon: 'dollar', group: 'System', blurb: 'Plan, seats and renewal record for this workspace', tabs: [], subs: [] },
]
export const SETTINGS_MODULE_IDS = SETTINGS_MODULES.map((m) => m.id)
export const settingsModule = (id) => SETTINGS_MODULES.find((m) => m.id === id) || SETTINGS_MODULES[0]

/* ── default masters ───────────────────────────────────────────────────────── */

// The office master is the union of the payroll office list (security scopes
// accounts against it, payroll profiles store it) and the schedulable locations
// the calendar and intake module already use — so no existing value dangles.
const DEFAULT_OFFICE_ROWS = [
  { name: 'Main Center', type: 'Center', isLocation: true, address: '1140 Sunset Crest Way', city: 'San Jose', state: 'CA', zip: '95124', phone: '(408) 555-0134' },
  { name: 'Northside Center', type: 'Center', isLocation: true, address: '880 North First St', city: 'San Jose', state: 'CA', zip: '95112', phone: '(408) 555-0141' },
  { name: 'North Clinic', type: 'Clinic', isLocation: true, address: '2200 Oakland Rd', city: 'San Jose', state: 'CA', zip: '95131', phone: '(408) 555-0148' },
  { name: 'Clinic Room 2', type: 'Treatment room', isLocation: false, parent: 'Main Center', city: 'San Jose', state: 'CA' },
  { name: 'Assessment Lab', type: 'Assessment room', isLocation: false, parent: 'Main Center', city: 'San Jose', state: 'CA' },
  { name: 'Jefferson Elementary', type: 'School', isLocation: true, address: '1201 Jefferson Ave', city: 'San Jose', state: 'CA', zip: '95125' },
  { name: 'Lincoln Elementary', type: 'School', isLocation: true, address: '450 Lincoln Ave', city: 'San Jose', state: 'CA', zip: '95126' },
  { name: 'School-based', type: 'Program', isLocation: false, city: 'San Jose', state: 'CA', note: 'Payroll grouping for itinerant school staff' },
  { name: 'Home programs', type: 'Program', isLocation: false, city: 'San Jose', state: 'CA', note: 'Payroll grouping for in-home staff' },
  { name: 'Community park session', type: 'Community', isLocation: true, city: 'San Jose', state: 'CA' },
  { name: 'Library community session', type: 'Community', isLocation: true, city: 'San Jose', state: 'CA' },
  { name: 'Telehealth (video)', type: 'Telehealth', isLocation: true, city: '', state: '' },
  { name: 'Remote / telehealth', type: 'Program', isLocation: false, city: '', state: '', note: 'Payroll grouping for remote staff' },
]

export const DEFAULT_OFFICES = DEFAULT_OFFICE_ROWS.map((row, i) => ({
  id: `off-${row.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
  code: `OF${String(i + 1).padStart(2, '0')}`,
  name: row.name, type: row.type, isLocation: !!row.isLocation, excludeFromLocations: !row.isLocation, parent: row.parent || '',
  address: row.address || '', city: row.city || '', state: row.state || '', zip: row.zip || '',
  addressNotes: row.addressNotes || '', phone: row.phone || '', fax: row.fax || '', email: row.email || '',
  taxIdType: row.taxIdType || 'EIN', ein: row.ein || '', logoDataUrl: row.logoDataUrl || '',
  npi: '', timezone: 'America/Los_Angeles', scope: true, active: true,
  note: row.note || '', createdAt: 1,
}))

export const OFFICE_TYPES = ['Center', 'Clinic', 'School', 'Community', 'Telehealth', 'Treatment room', 'Assessment room', 'Program', 'Administrative']
export const US_STATES = ['CA', 'OR', 'WA', 'TX', 'FL', 'NY', 'AZ', 'NV', 'CO', 'IL', 'MA', 'NJ', 'PA', 'GA', 'NC', 'UT', 'VA']
export const TIMEZONES = ['America/Los_Angeles', 'America/Denver', 'America/Phoenix', 'America/Chicago', 'America/New_York', 'America/Anchorage', 'Pacific/Honolulu']

export const DEFAULT_APPT_STATUSES = [
  { key: 'active', label: 'Active', aka: 'ACT', color: '#6366f1', active: true, system: true, order: 0, pays: true, billable: true, noteRequired: false, isCancellation: false, allowToComplete: true, payrollCode: '', cancelBand: false, note: 'Booked and staffed, not yet confirmed' },
  { key: 'confirmed', label: 'Confirmed', aka: 'CNF', color: '#0ea5e9', active: true, system: true, order: 1, pays: true, billable: true, noteRequired: false, isCancellation: false, allowToComplete: true, payrollCode: '', cancelBand: false, note: 'Family confirmed attendance' },
  { key: 'completed', label: 'Completed', aka: 'CMP', color: '#10b981', active: true, system: true, order: 2, pays: true, billable: true, noteRequired: false, isCancellation: false, allowToComplete: true, payrollCode: '', cancelBand: false, note: 'Session happened — this is the status claims and payroll read' },
  { key: 'no-show', label: 'No Show', aka: 'NSH', color: '#f59e0b', active: true, system: true, order: 3, pays: true, billable: false, noteRequired: true, isCancellation: true, allowToComplete: false, payrollCode: 'CANC', cancelBand: true, note: 'Pays the no-show band from the payroll cancellation policy' },
  { key: 'cancelled', label: 'Cancelled', aka: 'CXC', color: '#ef4444', active: true, system: true, order: 4, pays: true, billable: false, noteRequired: true, isCancellation: true, allowToComplete: false, payrollCode: 'CANC', cancelBand: true, note: 'Pays the short-notice / free-notice band from the cancellation policy' },
]

export const CUSTOM_LIST_GROUPS = [
  { id: 'general', label: 'General', blurb: 'Pick lists shared by scheduling, intake and billing screens' },
  { id: 'service-type', label: 'Service Type', blurb: 'Pick lists that describe how a service is delivered' },
]

const list = (id, group, name, description, options) => ({
  id, group, name, description, status: 'active', editable: true, system: true,
  options: options.map((label, i) => ({ id: `opt-${id}-${i + 1}`, label, active: true, editable: true, order: i })),
})

export const DEFAULT_CUSTOM_LISTS = [
  list('cancel-reasons', 'general', 'Cancellation reasons', 'Offered when a session is cancelled — feeds the no-show/cancellation analytics.', ['Client ill', 'Family emergency', 'School holiday', 'Staff illness', 'Weather', 'Transportation', 'No reason given']),
  list('appt-sources', 'general', 'Appointment sources', 'How the appointment was booked.', ['Parent request', 'School request', 'Clinician scheduled', 'Auto-recurrence', 'Intake conversion']),
  list('contact-methods', 'general', 'Contact methods', 'Preferred way to reach a family or payer.', ['Phone call', 'Text message', 'Email', 'Portal message', 'In person']),
  list('document-types', 'general', 'Document types', 'Documents tracked on the intake checklist and client chart.', ['Diagnostic report', 'Referral', 'IEP / IFSP', 'Insurance card', 'Guardianship paperwork', 'Consent — treatment', 'Consent — telehealth']),
  list('waitlist-priorities', 'general', 'Waitlist priorities', 'How urgently an intake request is waiting for a slot.', ['Urgent — start within 2 weeks', 'Routine — start within 30 days', 'Flexible — no target date']),
  list('service-categories', 'service-type', 'Service categories', 'Grouping used on the service master and rate cards.', ['Direct treatment', 'Assessment', 'Supervision', 'Caregiver training', 'Group treatment', 'School support']),
  list('service-settings', 'service-type', 'Service settings', 'Where the service is delivered.', ['Center', 'Home', 'School', 'Community', 'Telehealth']),
  list('delivery-modes', 'service-type', 'Delivery modes', 'How the session is staffed and delivered.', ['1:1', 'Group', 'Co-treatment', 'Parent-led', 'Remote']),
  list('modifiers', 'service-type', 'Billing modifiers', 'Modifiers offered when a service line needs one.', ['HM — group', 'HO — masters level', 'HN — bachelors level', 'GT — telehealth', '95 — synchronous telehealth', 'U6 — hourly']),
]

export const QUALIFICATION_TYPES = [
  { id: 'educational', label: 'Educational' },
  { id: 'degree', label: 'Degree' },
  { id: 'certification', label: 'Certification' },
  { id: 'license', label: 'Licence' },
  { id: 'training', label: 'Training' },
]

export const DEFAULT_QUALIFICATIONS = [
  { id: 'q-bcbad', name: 'BCBA-D', type: 'certification', authority: 'BACB', code: 'BCBA-D', expires: true, lifeTime: false, covers: ['q-bcba', 'q-bcaba', 'q-rbt', 'q-trainee'], documentRequired: true, appliesTo: ['Clinical Director', 'BCBA-D'], status: 'active' },
  { id: 'q-bcba', name: 'BCBA', type: 'certification', authority: 'BACB', code: 'BCBA', expires: true, lifeTime: false, covers: ['q-bcaba', 'q-rbt', 'q-trainee'], documentRequired: true, appliesTo: ['Clinical Supervisor', 'BCBA'], status: 'active' },
  { id: 'q-bcaba', name: 'BCaBA', type: 'certification', authority: 'BACB', code: 'BCaBA', expires: true, lifeTime: false, covers: ['q-rbt', 'q-trainee'], documentRequired: true, appliesTo: ['BCaBA'], status: 'active' },
  { id: 'q-rbt', name: 'RBT', type: 'certification', authority: 'BACB', code: 'RBT', expires: true, lifeTime: false, covers: ['q-trainee'], documentRequired: true, appliesTo: ['RBT', 'Lead RBT'], status: 'active' },
  { id: 'q-slp', name: 'CCC-SLP', type: 'license', authority: 'ASHA', code: 'CCC-SLP', expires: true, lifeTime: false, covers: [], documentRequired: true, appliesTo: ['Speech-Language Pathologist'], status: 'active' },
  { id: 'q-psy', name: 'Licensed Psychologist', type: 'license', authority: 'State board', code: 'PSY', expires: true, lifeTime: false, covers: ['q-bcbad', 'q-bcba', 'q-bcaba', 'q-rbt'], documentRequired: true, appliesTo: ['Psychologist'], status: 'active' },
  { id: 'q-masters', name: "Master's degree", type: 'degree', authority: '', code: '', expires: false, lifeTime: true, covers: [], documentRequired: true, appliesTo: [], status: 'active' },
  { id: 'q-trainee', name: 'TC-BCBA trainee', type: 'training', authority: 'BACB', code: 'TC', expires: true, lifeTime: false, covers: [], documentRequired: false, appliesTo: ['Student Therapist'], status: 'active' },
  { id: 'q-cpr', name: 'CPR / First aid', type: 'training', authority: 'Red Cross', code: '', expires: true, lifeTime: false, covers: [], documentRequired: true, appliesTo: [], status: 'active' },
]

export const MESSAGE_CATEGORIES = [
  { id: 'appointment', label: 'Appointment' },
  { id: 'reminder', label: 'Reminder' },
  { id: 'billing', label: 'Billing' },
  { id: 'intake', label: 'Intake' },
  { id: 'staff', label: 'Staff' },
]

export const DEFAULT_MESSAGE_TEMPLATES = [
  { id: 'msg-appt-reminder', name: 'Appointment reminder', category: 'reminder', status: 'active',
    body: 'Hi {{guardian}}, this is {{practice}} — reminder for {{client}} on {{date}} at {{time}} with {{staff}} at {{location}}. Reply STOP to opt out.' },
  { id: 'msg-appt-change', name: 'Appointment changed', category: 'appointment', status: 'active',
    body: 'Hi {{guardian}}, {{practice}} here — {{client}}’s session on {{date}} at {{time}} has changed. Please call {{phone}} to confirm. Reply STOP to opt out.' },
  { id: 'msg-intake-welcome', name: 'Intake — first contact', category: 'intake', status: 'active',
    body: 'Hi {{guardian}}, thanks for contacting {{practice}} about {{client}}. Our intake team will call within one business day. Reply STOP to opt out.' },
  { id: 'msg-balance', name: 'Balance reminder', category: 'billing', status: 'draft',
    body: 'Hi {{guardian}}, {{practice}} shows a balance of {{balance}} for {{client}}. Call {{phone}} with questions. Reply STOP to opt out.' },
  { id: 'msg-staff-sheet', name: 'Timesheet due', category: 'staff', status: 'draft',
    body: 'Hi {{staff}}, your timesheet for {{period}} is due {{date}}. Open the practice app to submit it.' },
]

export const MERGE_FIELDS = ['{{practice}}', '{{guardian}}', '{{client}}', '{{staff}}', '{{date}}', '{{time}}', '{{location}}', '{{phone}}', '{{balance}}', '{{period}}']

export const INTEGRATION_STATUSES = {
  off: { label: 'Not connected', tone: 'off' },
  'local-export': { label: 'Local export only', tone: 'local' },
  'manual-sync': { label: 'Manual sync recorded', tone: 'local' },
}

export const DEFAULT_INTEGRATIONS = [
  { id: 'int-calendar', name: 'Calendar feed (ICS)', vendor: 'Local export', status: 'local-export', direction: 'One-way export',
    detail: 'Exports upcoming bookings as an .ics file you can import into Outlook, Apple or Google Calendar. It is a one-off file, not a subscription: nothing syncs.', lastRunAt: null, note: '' },
  { id: 'int-qbo', name: 'QuickBooks (desktop import)', vendor: 'Intuit', status: 'local-export', direction: 'One-way export',
    detail: 'Produces the QBO import CSV and the payroll journal with an import guide. Nothing is posted into QuickBooks from here.', lastRunAt: null, note: '' },
  { id: 'int-ensora', name: 'Ensora Data Collection', vendor: 'Ensora Health', status: 'local-export', direction: 'Clinical data sync',
    detail: 'Maps ABA programs, skill acquisition targets and session mastery records for local clinical export.', lastRunAt: null, note: '' },
  { id: 'int-hirasmus', name: 'Hi Rasmus', vendor: 'Hi Rasmus', status: 'off', direction: 'Clinical data sync',
    detail: 'ABA curriculum, treatment fidelity checklists and session note hand-off adapter.', lastRunAt: null, note: '' },
  { id: 'int-motivity', name: 'Motivity', vendor: 'Motivity', status: 'off', direction: 'Clinical data sync',
    detail: 'Clinical data collection and session verification sync for RBT/BCBA caseloads.', lastRunAt: null, note: '' },
  { id: 'int-welina', name: 'Welina', vendor: 'Welina', status: 'off', direction: 'Clinical documentation',
    detail: 'AI-assisted clinical documentation and payer-compliant session note verification.', lastRunAt: null, note: '' },
  { id: 'int-fhir', name: 'EMR / FHIR hand-off', vendor: 'Configurable', status: 'off', direction: 'Out of scope',
    detail: 'A real FHIR endpoint needs credentials and a server. This demo keeps the data local; the seam is documented for a future adapter.', lastRunAt: null, note: '' },
  { id: 'int-clearinghouse', name: 'Claims clearinghouse', vendor: 'Configurable', status: 'off', direction: 'Out of scope',
    detail: 'No 837 transmission exists in this demo. Claims are staged locally and their files recorded in Billed Files.', lastRunAt: null, note: '' },
  { id: 'int-telehealth', name: 'Telehealth room link', vendor: 'Configurable', status: 'local-export', direction: 'Reference data',
    detail: 'Stores the practice’s own video room link, shows it on telehealth appointments and adds it to .ics exports. The app does not host, open or record a video session.', lastRunAt: null, note: '' },
  { id: 'int-paylink', name: 'Online payment link (Stripe)', vendor: 'Stripe or any processor', status: 'local-export', direction: 'Reference data',
    detail: 'Stores the practice’s own payment link (for example a Stripe Payment Link) and prints it on client statements. The app never charges a card or reads Stripe: when a family pays, record it in the Payment Center as a patient receipt.', lastRunAt: null, note: '' },
  { id: 'int-eligibility', name: 'Eligibility / benefits check', vendor: 'Configurable', status: 'off', direction: 'Out of scope',
    detail: 'Verification Forms capture what staff were told on the phone. There is no live 270/271 exchange.', lastRunAt: null, note: '' },
]

export const DEFAULT_TEXT_MESSAGING = {
  enabled: false, // deliberately opt-in: nothing is ever sent from the demo
  orgCode: 'ALOHA-ABA',
  senderName: '', senderNumber: '', quietStart: '21:00', quietEnd: '07:00',
  sendToStaff: true, staffScope: 'all', selectedStaffIds: [],
  sendToClient: true, clientScope: 'all', selectedClientIds: [],
  scheduleHoursBefore: 24,
  consentNote: 'Families opt in in writing at intake; every template carries an opt-out line.',
  templates: DEFAULT_MESSAGE_TEMPLATES,
  optOuts: [
    { id: 'opt-1', phone: '(408) 555-0162', name: 'R. Ma (guardian)', reason: 'Replied STOP', at: 1 },
  ],
  log: [],
}

export const DEFAULT_SUBSCRIPTION = {
  plan: 'Practice · ABA Suite', seats: 25, seatsUsed: 12, status: 'active',
  renewsOn: '', billingContact: 'billing.office@aloha.example.com', billingCycle: 'annual', monthly: 0, currency: 'USD',
  portalUrl: 'https://subscriptionportal-staging.alohaaba.com/#/invoicepayments',
  invoices: [],
}

export const DEFAULT_NOTIFICATIONS = {
  timelyFiling: true, authExpiry: true, parkedEra: true, secondaryReady: true, intakeSla: true, browserToasts: false,
  staffBirthday: true,
  staffClinicalTeam: true,
  staffSubordinate: true,
  staffSupervisor: true,
  staffQualExpiration: true,
  staffQualFrequencyDays: 30,
  staffIncompleteAppts: true,
  staffIncompleteLookbackDays: 7,
  staffTimesheetReminder: true,
  staffTimesheetDaysBefore: 2,
  staffClientAssignment: true,
}

export const VALIDATION_SEVERITIES = [
  { id: 'none', label: 'None' },
  { id: 'flag', label: 'Flag' },
  { id: 'warn', label: 'Warn' },
  { id: 'stop', label: 'Stop' },
]
export const VALIDATION_LEVELS = VALIDATION_SEVERITIES

export const DEFAULT_APPOINTMENT_VALIDATIONS = {
  staff: {
    qualification: 'warn',
    serviceProvider: 'warn',
    overlap: 'warn',
    missingNpi: 'flag',
    payRate: 'flag',
    unavailable: 'warn',
  },
  client: {
    overlap: 'warn',
    assignment: 'flag',
    clientAssignment: 'flag',
    duplicateOverlap: 'warn',
  },
  payer: {
    cancelledNoShow: 'flag',
    regionalCenter: 'none',
  },
  // ⚡ ABA Hours = behavior-analytic time on non-service appointments (RBT / BCAT,
  // graduate-student and state-certification tracking). It never touches authorizations,
  // so a tick on a *service* appointment is a data error, not a billing decision.
  aba: {
    serviceAppt: 'stop', // ticked on a service appointment — the flag belongs to non-service time
    activity: 'stop', // ticked against a non-qualifying activity (cleaning, general admin)
    missingActivity: 'warn', // ticked with no activity chosen yet
    noStaff: 'warn', // ticked with nobody on the block — the hours cannot be attributed
    clientAttached: 'flag', // ticked while a client is attached (client time is not staff ABA time)
  },
}

export const DEFAULT_CLEARINGHOUSES = [
  { id: 'ch-office-ally', name: 'Office Ally', submitterId: 'OA-94810', receiverId: '04290', username: 'aloha_edi', sftpHost: 'ftp.officeally.com', ansiVersion: '5010A1', productionMode: false, claim837Enabled: true, era835Enabled: true, elig270Enabled: true, status: 'active' },
  { id: 'ch-availity', name: 'Availity', submitterId: 'AV-33019', receiverId: '030240928', username: 'aloha_availity', sftpHost: 'files.availity.com', ansiVersion: '5010A1', productionMode: false, claim837Enabled: true, era835Enabled: true, elig270Enabled: false, status: 'inactive' },
]

export const DEFAULT_EVV_CONFIG = {
  aggregator: 'Sandata',
  agencyId: 'CA-EVV-90412',
  username: 'aloha_evv_sync',
  businessEntityId: 'BE-40811',
  state: 'CA',
  geofenceRadiusFeet: 500,
  requireGpsOnClockIn: true,
  requireClientSignature: true,
  autoSendVerified: false,
  status: 'active',
}

export const DEFAULT_SYSTEM_CONFIG = {
  locale: 'en-US',
  dateFormat: 'MM/DD/YYYY',
  timeFormat: '12h',
  currency: 'USD',
  weekStartSetting: true,
  general: {
    staffSigRequiredToComplete: false,
    mfaRequired: false,
    screenLockMinutes: 15,
    autoLogoutMinutes: 60,
    maxAppointmentLengthMinutes: 480,
    refreshCacheSeconds: 300,
    supervisionJobTitles: ['BCBA', 'BCaBA', 'Clinical Supervisor', 'Psychologist'],
  },
  appointment: {
    enableClockInOut: true,
    clockOutCompletesAppt: false,
    staffSigCompletesAppt: true,
    syncVerificationTime: false,
  },
  other: {
    distanceUnit: 'miles',
    clientPortalColumns: {
      invoiceNo: true,
      serviceDate: true,
      charges: true,
      insurancePaid: true,
      clientPaid: true,
      balanceDue: true,
    },
    paymentGatewayMethods: {
      creditCard: true,
      ach: true,
      hsaFsa: true,
      appleGooglePay: false,
    },
  },
}

/* ── selectors ─────────────────────────────────────────────────────────────── */

const arr = (v) => (Array.isArray(v) ? v : [])
const byOrder = (a, b) => (a.order ?? 0) - (b.order ?? 0) || String(a.label || a.key || '').localeCompare(String(b.label || b.key || ''))

export function settingsOffices(settings) {
  const list = arr(settings?.offices)
  return list.length ? list : DEFAULT_OFFICES
}
export const officeList = settingsOffices
export function officeNames(settings, { activeOnly = true, locationsOnly = false } = {}) {
  return settingsOffices(settings)
    .filter((o) => (!activeOnly || o.active !== false) && (!locationsOnly || (o.isLocation !== false && !o.excludeFromLocations)))
    .map((o) => o.name)
}
export function locationOptions(settings) {
  return officeNames(settings, { activeOnly: true, locationsOnly: true })
}
export const officeByName = (settings, name) => settingsOffices(settings).find((o) => o.name === name) || null
export const officeById = (settings, id) => settingsOffices(settings).find((o) => o.id === id) || null

export function apptStatusList(settings, { activeOnly = false } = {}) {
  const configured = arr(settings?.apptStatuses)
  const base = configured.length ? configured : DEFAULT_APPT_STATUSES
  return base
    .filter((s) => !activeOnly || s.active !== false)
    .slice()
    .sort(byOrder)
}
export const statusMapFor = (settings) => Object.fromEntries(apptStatusList(settings).map((s) => [s.key, s]))
export const statusOrderFor = (settings) => apptStatusList(settings, { activeOnly: true }).map((s) => s.key)
/** A status that exists in the workspace but was deactivated is rendered with a muted dot. */
export const statusFor = (settings, key) => statusMapFor(settings)[key] || STATUSES[key] || { key, label: key, color: '#94a3b8', active: false, pays: true }
/** key → label for every configured status, for engines that only print names. */
export const statusLabels = (settings) => Object.fromEntries(apptStatusList(settings).map((s) => [s.key, s.label]))
/** The dot/colour a status is drawn with (master colour, built-in dot, then slate). */
export const statusColorOf = (settings, key) => statusFor(settings, key).color || STATUSES[key]?.dot || '#94a3b8'
/**
 * True when a status means "the session did not happen", which is what the calendar,
 * conflict detection and the ICS export treat as a dead booking. The five built-in
 * keys keep their historical meaning; a status the practice adds gets the same
 * treatment by ticking "counts as a cancellation" (cancelBand) in Appointment Status.
 */
export const isCancelStatus = (settings, key) => {
  const row = apptStatusList(settings).find((s) => s.key === key)
  if (row) return !!row.cancelBand
  return key === 'cancelled' || key === 'no-show'
}

export function customLists(settings, group) {
  const lists = arr(settings?.customLists).length ? settings.customLists : DEFAULT_CUSTOM_LISTS
  return (group ? lists.filter((l) => l.group === group) : lists).slice().sort(byOrder)
}
export const customListById = (settings, id) => customLists(settings).find((l) => l.id === id) || null
export function listOptions(settings, id, { activeOnly = true, includeCustom = [] } = {}) {
  const l = customListById(settings, id)
  const base = l ? arr(l.options) : []
  const options = [...base, ...arr(includeCustom).filter((label) => !base.some((o) => o.label === label)).map((label, i) => ({ id: `opt-custom-${i}-${String(label).slice(0, 8)}`, label, active: true, order: base.length + i }))]
  return (activeOnly ? options.filter((o) => o.active !== false) : options).slice().sort(byOrder)
}

export function qualificationList(settings, { activeOnly = true } = {}) {
  const rows = arr(settings?.qualifications).length ? settings.qualifications : DEFAULT_QUALIFICATIONS
  return (activeOnly ? rows.filter((q) => q.status !== 'inactive') : rows).slice().sort(byOrder)
}
export const qualificationNames = (settings, opts) => qualificationList(settings, opts).map((q) => q.name)

/**
 * Returns the qualification rows whose `covers` list includes `qualId`.
 */
export function qualificationCoveredBy(settings, qualId) {
  const rows = qualificationList(settings, { activeOnly: false })
  return rows.filter((q) => arr(q.covers).includes(qualId))
}

/**
 * Transitive closure of qualifications covered by `qualId` (returns Set of qualification IDs, names, and codes).
 */
export function qualificationCoversTransitive(settings, qualIdOrName) {
  const rows = qualificationList(settings, { activeOnly: false })
  const byId = Object.fromEntries(rows.map((q) => [q.id, q]))
  const start = rows.find((q) => q.id === qualIdOrName || q.name === qualIdOrName || q.code === qualIdOrName)
  const visitedIds = new Set()
  const tokens = new Set()
  if (!start) {
    if (qualIdOrName) tokens.add(String(qualIdOrName))
    return tokens
  }
  const queue = [start.id]
  while (queue.length) {
    const curId = queue.shift()
    if (visitedIds.has(curId)) continue
    visitedIds.add(curId)
    const q = byId[curId]
    if (!q) continue
    tokens.add(q.id)
    if (q.name) tokens.add(q.name)
    if (q.code) tokens.add(q.code)
    for (const childId of arr(q.covers)) if (!visitedIds.has(childId)) queue.push(childId)
  }
  return tokens
}

/**
 * True when `staffMember` holds `requiredCred` directly OR holds a higher qualification
 * that transitively covers `requiredCred` in `Settings → Qualification`.
 */
export const qualificationSatisfactionFor = (settings, creds = []) => {
  const result = new Set()
  for (const c of creds) {
    const covered = qualificationCoversTransitive(settings, c)
    for (const item of covered) result.add(item)
  }
  return result
}
export const staffSatisfiesCredentials = (settings, staffMember, requiredCreds = []) => {
  return requiredCreds.every((req) => staffSatisfiesQualification(settings, staffMember, req))
}

export function staffSatisfiesQualification(settings, staffMember, requiredCred) {
  if (!requiredCred) return true
  if (!staffMember) return false
  const held = [staffMember.cert, staffMember.role, ...arr(staffMember.qualifications), ...arr(staffMember.credentials)].filter(Boolean)
  if (held.includes(requiredCred)) return true
  for (const h of held) {
    const covered = qualificationCoversTransitive(settings, h)
    if (covered.has(requiredCred)) return true
  }
  return false
}

export function messagesCfg(settings) {
  const cfg = settings?.textMessaging || {}
  return { ...DEFAULT_TEXT_MESSAGING, ...cfg, templates: arr(cfg.templates).length ? cfg.templates : DEFAULT_MESSAGE_TEMPLATES }
}
// Saved rows first, then any default row added since the workspace saved its list.
export const integrationsCfg = (settings) => {
  const saved = arr(settings?.clinicalIntegrations)
  if (!saved.length) return DEFAULT_INTEGRATIONS
  const missing = DEFAULT_INTEGRATIONS.filter((d) => !saved.some((r) => r.id === d.id))
  return missing.length ? [...saved, ...missing] : saved
}
export const integrationById = (settings, id) => integrationsCfg(settings).find((i) => i.id === id) || null
export const isWebUrl = (s) => /^https:\/\/[^\s/]+\.[^\s]+$/i.test(String(s || '').trim())
// The practice's own video room for a telehealth session (POS 10), or '' when the integration is off,
// the room is not set, or the session is not telehealth. The app only links to it; it hosts nothing.
export function telehealthRoomFor(settings, appt) {
  const row = integrationById(settings, 'int-telehealth')
  if (!row || row.status === 'off' || !isWebUrl(row.roomUrl) || posFor(appt) !== '10') return ''
  return row.roomUrl.trim()
}
// The practice's own online payment link (e.g. a Stripe Payment Link) for statements, or ''.
export function paymentLinkFor(settings) {
  const row = integrationById(settings, 'int-paylink')
  return row && row.status !== 'off' && isWebUrl(row.payUrl) ? row.payUrl.trim() : ''
}
export const subscriptionCfg = (settings) => ({ ...DEFAULT_SUBSCRIPTION, ...(settings?.subscription || {}) })
export const notificationsCfg = (settings) => ({ ...DEFAULT_NOTIFICATIONS, ...(settings?.notifications || {}) })
export const clearinghousesCfg = (settings) => (arr(settings?.clearinghouses).length ? settings.clearinghouses : DEFAULT_CLEARINGHOUSES)
export const evvCfg = (settings) => ({ ...DEFAULT_EVV_CONFIG, ...(settings?.evvConfig || {}) })
export const VALIDATION_GROUPS = ['staff', 'client', 'payer', 'aba']
export function appointmentValidationsCfg(settings) {
  const raw = settings?.appointmentValidations || {}
  return {
    staff: { ...DEFAULT_APPOINTMENT_VALIDATIONS.staff, ...(raw.staff || {}) },
    client: { ...DEFAULT_APPOINTMENT_VALIDATIONS.client, ...(raw.client || {}) },
    payer: { ...DEFAULT_APPOINTMENT_VALIDATIONS.payer, ...(raw.payer || {}) },
    aba: { ...DEFAULT_APPOINTMENT_VALIDATIONS.aba, ...(raw.aba || {}) },
  }
}
export function systemConfigFor(settings) {
  const sys = settings?.system || settings?.systemConfig || {}
  return {
    ...DEFAULT_SYSTEM_CONFIG,
    ...sys,
    general: { ...DEFAULT_SYSTEM_CONFIG.general, ...(sys.general || {}) },
    billing: { ...(sys.billing || {}) },
    appointment: { ...DEFAULT_SYSTEM_CONFIG.appointment, ...(sys.appointment || {}) },
    other: {
      ...DEFAULT_SYSTEM_CONFIG.other,
      ...(sys.other || {}),
      clientPortalColumns: { ...DEFAULT_SYSTEM_CONFIG.other.clientPortalColumns, ...(sys.other?.clientPortalColumns || {}) },
      paymentGatewayMethods: { ...DEFAULT_SYSTEM_CONFIG.other.paymentGatewayMethods, ...(sys.other?.paymentGatewayMethods || {}) },
    },
  }
}
export const systemConfigCfg = systemConfigFor

/**
 * Evaluates all configured Appointment Validations (`None` / `Flag` / `Warn` / `Stop`)
 * against a draft or existing appointment.
 * Returns `{ items, stops, warns, flags }` so `AppointmentModal` can block `Stop`
 * violations and surface `Warn`/`Flag` items live.
 */
export function evaluateAppointmentValidations(state, draft = {}) {
  const settings = state?.settings || {}
  const rules = appointmentValidationsCfg(settings)
  const items = []
  const push = (group, key, label, message) => {
    const severity = rules?.[group]?.[key] || 'none'
    if (severity === 'none') return
    items.push({ id: `${group}.${key}`, group, key, severity, label, message })
  }

  const staffById = Object.fromEntries(arr(state?.staff).map((s) => [s.id, s]))
  const clientById = Object.fromEntries(arr(state?.clients).map((c) => [c.id, c]))
  const svcs = arr(state?.svcs)
  const svc = svcs.find((s) => s.id === draft.service || s.code === draft.service || s.label === draft.service) || null
  const appts = Object.values(state?.appts || {})
  const staffIds = arr(draft.staffIds)
  const clientIds = arr(draft.clientIds)
  const isClinic = ['service', 'evaluation', 'supervision'].includes(draft.type || 'service')

  // 1) Staff Qualification & Service Provider
  const reqCerts = svc ? (arr(svc.allowedCerts).length ? arr(svc.allowedCerts) : (arr(svc.credentials).length ? arr(svc.credentials) : arr(BILL_CODES.find((c) => c.id === svc.code)?.cred))) : []
  if (isClinic && svc && reqCerts.length > 0 && staffIds.length > 0) {
    for (const sid of staffIds) {
      const st = staffById[sid]
      if (!st) continue
      const ok = reqCerts.some((req) => staffSatisfiesQualification(settings, st, req))
      if (!ok) {
        push('staff', 'qualification', 'Staff Qualification', `${st.name} (${st.cert || st.role || 'uncredentialed'}) does not hold or cover required qualification (${reqCerts.join(', ')}) for ${svc.label}.`)
        push('staff', 'serviceProvider', 'Service Provider Eligibility', `${st.name} is not an eligible provider for service ${svc.code} (${svc.label}).`)
      }
    }
  }

  // 2) Staff Missing NPI / Medicaid ID (per the payer's provider-ID rule) & Pay Rate.
  // Identifiers live on provider records (Billing → Provider IDs); a staff row only
  // overrides when its own `npi` was explicitly blanked.
  const idPayer = clientIds.length ? arr(state?.payers).find((p) => p.name === clientById[clientIds[0]]?.insurer || p.id === clientById[clientIds[0]]?.payerId) || null : null
  const hasProviders = arr(state?.settings?.providers).length > 0
  for (const sid of staffIds) {
    const st = staffById[sid]
    if (!st) continue
    if (isClinic) {
      const issue = st.npi === '' ? `${st.name} has a blank NPI on file.` : hasProviders ? providerIdIssues(state, idPayer, sid)[0] : null
      if (issue) push('staff', 'missingNpi', 'Missing NPI / Medicaid ID', issue.endsWith('.') ? issue : `${issue}.`)
    }
    const prof = arr(state?.payProfiles).find((p) => p.staffId === sid)
    const rate = Number(prof?.baseRate ?? st.payrollRate ?? st.hourlyCents ?? 0)
    if (rate <= 0) {
      push('staff', 'payRate', 'Missing Staff Pay Rate', `${st.name} does not have a positive base pay rate configured.`)
    }
  }

  // 3) Overlaps (Staff Overlap, Staff Unavailable, Client Overlap, Client Duplicate Overlap)
  if (draft.date && Number.isFinite(draft.start) && Number.isFinite(draft.end) && draft.end > draft.start) {
    for (const other of appts) {
      if (!other || other.id === draft.id || other.date !== draft.date) continue
      if (isCancelStatus(settings, other.status)) continue
      const overlaps = draft.start < other.end && other.start < draft.end
      if (!overlaps) continue

      for (const sid of staffIds) {
        if (arr(other.staffIds).includes(sid)) {
          const stName = staffById[sid]?.name || sid
          if (other.type === 'unavailable') {
            push('staff', 'unavailable', 'Staff Unavailable', `${stName} is marked unavailable during “${other.title || 'Unavailable'}”.`)
          } else {
            push('staff', 'overlap', 'Staff Overlap', `${stName} is already booked on “${other.title}”.`)
          }
        }
      }

      for (const cid of clientIds) {
        if (arr(other.clientIds).includes(cid)) {
          const clName = clientById[cid]?.name || cid
          if (other.service && draft.service && other.service === draft.service) {
            push('client', 'duplicateOverlap', 'Client Duplicate Service Overlap', `${clName} already has an overlapping session for the same service (${other.title}).`)
          } else {
            push('client', 'overlap', 'Client Overlap', `${clName} has an overlapping booking (“${other.title}”).`)
          }
        }
      }
    }
  }

  // 4) Client Assignment (check if staff belongs to client's clinical team when teams are configured)
  if (isClinic && clientIds.length > 0 && staffIds.length > 0 && arr(state?.teams).length > 0) {
    for (const cid of clientIds) {
      const assignedTeam = arr(state.teams).filter((t) => t.clientId === cid)
      if (assignedTeam.length > 0) {
        const assignedStaffIds = new Set(assignedTeam.flatMap((t) => arr(t.staffIds).concat(t.staffId ? [t.staffId] : [])))
        if (assignedStaffIds.size > 0) {
          for (const sid of staffIds) {
            if (!assignedStaffIds.has(sid)) {
              const stName = staffById[sid]?.name || sid
              const clName = clientById[cid]?.name || cid
              push('client', 'assignment', 'Client Team Assignment', `${stName} is not assigned to ${clName}'s primary clinical team.`)
            }
          }
        }
      }
    }
  }

  // 5) Payer Cancelled/No-Show & Regional Center
  if (clientIds.length > 0) {
    const cl = clientById[clientIds[0]]
    const payer = arr(state?.payers).find((p) => p.name === cl?.insurer || p.id === cl?.payerId)
    if (isCancelStatus(settings, draft.status) && payer) {
      push('payer', 'cancelledNoShow', 'Payer Cancelled / No-Show Rule', `${payer.name} does not reimburse cancelled or no-show appointments on 837P claims.`)
    }
    if (payer && /regional/i.test(payer.name || '') && !draft.service) {
      push('payer', 'regionalCenter', 'Regional Center Service Sub-Code', `Regional Center bookings require an authorized service code.`)
    }
  }

  // 6) ⚡ ABA Hours — behavior-analytic time on non-service appointments.
  // The flag is about *staff* credential hours (RBT / BCAT, graduate students, state
  // certification), never about the client's authorization, so every rule here guards the
  // tracking ledger: who it is credited to, whether the activity is behavior-analytic at
  // all, and whether it was placed on an appointment type that may carry it.
  if (draft.abaHr === true) {
    const abaCfg = abaHoursCfg(settings)
    const act = abaActivityById(draft.abaActivity)
    if (isServiceAppt(draft)) {
      push('aba', 'serviceAppt', 'ABA Hours on a Service Appointment',
        `ABA Hours applies to non-service appointments only — “${TYPES[draft.type]?.label || draft.type}” is service delivery, which draws on the client's authorization instead. Untick ⚡ ABA Hr or rebook this as a non-service block.`)
    }
    if (act && !act.qualifies) {
      push('aba', 'activity', 'ABA Hours Activity Not Behavior-Analytic',
        `“${act.label}” is not behavior-analytic time${act.hint ? ` — ${act.hint.toLowerCase()}` : ''}. Pick one of the qualifying activities (group training, intervention design/review, data analysis, coursework) or untick ⚡ ABA Hr.`)
    }
    if (!act && abaCfg.requireActivity) {
      push('aba', 'missingActivity', 'ABA Hours Activity Missing',
        'Choose the behavior-analytic activity these hours belong to (group training, intervention design/review, data analysis, coursework) so the tracking ledger can be audited.')
    }
    if (!staffIds.length) {
      push('aba', 'noStaff', 'ABA Hours Without Staff',
        'No staff member is on this block, so the behavior-analytic hours cannot be credited to anyone.')
    }
    if (clientIds.length) {
      push('aba', 'clientAttached', 'ABA Hours With a Client Attached',
        `A client is attached to this block (${clientIds.map((c) => clientById[c]?.name || c).join(', ')}). Behavior-analytic time is staff time spent outside client sessions.`)
    }
  }

  // Max appointment length from System Settings -> General
  const gen = systemConfigFor(settings).general || {}
  const maxMins = Number(gen.maxAppointmentLengthMins ?? gen.maxAppointmentLengthMinutes) || 0
  if (maxMins > 0 && draft.end - draft.start > maxMins) {
    items.push({
      id: 'system.maxAppointmentLength',
      group: 'system',
      key: 'maxAppointmentLength',
      severity: 'warn',
      label: 'Maximum Appointment Length',
      message: `Session duration (${draft.end - draft.start}m) exceeds the configured maximum appointment length (${maxMins}m).`,
    })
  }

  return {
    items,
    stops: items.filter((i) => i.severity === 'stop'),
    warns: items.filter((i) => i.severity === 'warn'),
    flags: items.filter((i) => i.severity === 'flag'),
  }
}

/** Earning codes: the configured list when present, else the engine defaults.
 *  The resolvers live in payroll.js (the engine owns them); these are the names
 *  the settings panels read. */
export const earningCodes = (payroll) => earningCodesFor(payroll)
export const earningCodeById = (payroll) => earningIndex(payroll)
export const codeLabel = (payroll, code) => earningLabel(payroll, code)

/** Wages used when a profile has no explicit rate — surfaced in Payroll → General. */
export function payrollGeneral(settings) {
  const base = defaultPayrollSettings()
  const p = settings?.payroll || {}
  return {
    ...base,
    ...p,
    processor: p.processor || 'ADP',
    mileageRate: p.mileageRate ?? settings?.mileageRate ?? 0.67,
    defaultEarningCodes: {
      nonService: 'ADMIN',
      drive: 'DRIVE',
      breakTime: 'ADMIN',
      ...(p.defaultEarningCodes || {}),
    },
    officeOvertimeRules: p.officeOvertimeRules || {},
  }
}

/* ── usage index: what would break if a master row disappeared ─────────────── */

export function masterUsage(state) {
  const usage = { offices: {}, statuses: {}, lists: {}, options: {}, qualifications: {}, codes: {} }
  const bump = (bucket, key) => { if (!key) return; usage[bucket][key] = (usage[bucket][key] || 0) + 1 }
  const appts = Object.values(state.appts || {})
  for (const a of appts) {
    bump('statuses', a.status)
    bump('offices', a.location)
  }
  for (const c of state.clients || []) {
    bump('offices', c.home)
    bump('offices', c.office)
    bump('lists', 'service-settings')
  }
  for (const s of state.staff || []) bump('offices', s.office)
  for (const p of state.payProfiles || []) bump('offices', p.office)
  for (const r of Object.values(state.intakeRequests || {})) {
    bump('offices', r.office)
    if (r.referralSourceId) bump('lists', 'referral-sources')
  }
  for (const a of state.security?.accounts || []) for (const o of a.officeIds || []) if (o !== '*') bump('offices', o)
  for (const p of state.settings?.providers || []) if (p.kind === 'office' && p.refId) bump('providers', p.refId)
  for (const q of state.settings?.providers || []) if (q.credential) bump('qualifications', q.credential)
  for (const sheet of Object.values(state.paySheets || {})) for (const adj of sheet.adjustments || []) bump('codes', adj.code)
  for (const run of Object.values(state.payRuns || {})) for (const line of run.lines || []) bump('codes', line.code)
  for (const c of Object.values(state.claims || {})) for (const l of c.lines || []) bump('codes', l.code)
  return usage
}

export const officeUsage = (state, name) => masterUsage(state).offices[name] || 0
export const statusUsage = (state, key) => masterUsage(state).statuses[key] || 0
export const codeUsage = (state, code) => masterUsage(state).codes[code] || 0

/* ── validation helpers ────────────────────────────────────────────────────── */

const text = (v) => String(v == null ? '' : v).trim()
export const clean = (v, max = 120) => text(v).slice(0, max)
const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)
const isNpi = (v) => /^\d{10}$/.test(v)
const isTaxId = (v) => /^\d{2}-?\d{7}$/.test(v)
const uniqueName = (rows, name, id) => rows.some((r) => r.id !== id && text(r.name).toLowerCase() === text(name).toLowerCase())

/* ── the plan: every settings change is validated here, written in one tx ───── */

/**
 * `planSettingsOp` mirrors the ledger planners: the UI calls it to learn whether
 * an edit is allowed (and gets the human reason when it is not), the reducer calls
 * it again with the live state so a stale dialog can never write an invalid value.
 */
export function planSettingsOp(state, op, payload = {}) {
  const settings = state.settings || {}
  const fail = (msg) => ({ ok: false, msg })
  const done = (msg, extra = {}) => ({ ok: true, msg, patch: extra.patch || {}, cascades: extra.cascades || null, touched: extra.touched || ['settings'], detail: extra.detail || null })

  switch (op) {
    case 'office.upsert': {
      const item = { ...payload.item }
      const name = clean(item.name, 80)
      if (name.length < 2) return fail('Give the office a name of at least 2 characters.')
      const rows = settingsOffices(settings)
      const existing = rows.find((o) => o.id === item.id) || null
      if (uniqueName(rows, name, item.id)) return fail(`An office called “${name}” already exists.`)
      if (item.npi && !isNpi(item.npi)) return fail('An office NPI must be exactly 10 digits (or left blank).')
      if (item.ein && !isTaxId(item.ein)) return fail('An office Tax ID / EIN looks like 12-3456789.')
      if (item.email && !isEmail(item.email)) return fail('That office email address does not look right.')
      const isLocation = item.excludeFromLocations != null ? !item.excludeFromLocations : item.isLocation !== false
      const next = {
        id: existing?.id || item.id || `off-${uid()}`,
        code: clean(item.code, 12) || existing?.code || '',
        name, type: clean(item.type, 40) || 'Center',
        isLocation, excludeFromLocations: !isLocation,
        parent: clean(item.parent, 80),
        address: clean(item.address, 120), city: clean(item.city, 60), state: clean(item.state, 2), zip: clean(item.zip, 10),
        addressNotes: clean(item.addressNotes ?? existing?.addressNotes, 200),
        phone: clean(item.phone, 24), fax: clean(item.fax ?? existing?.fax, 24), email: clean(item.email ?? existing?.email, 80),
        taxIdType: clean(item.taxIdType ?? existing?.taxIdType, 12) || 'EIN',
        ein: clean(item.ein ?? existing?.ein, 20),
        logoDataUrl: clean(item.logoDataUrl ?? existing?.logoDataUrl, 50000),
        npi: clean(item.npi, 10), timezone: clean(item.timezone, 40) || 'America/Los_Angeles',
        scope: item.scope !== false, active: item.active !== false, note: clean(item.note, 240),
        createdAt: existing?.createdAt || Date.now(),
      }
      const offices = existing ? rows.map((o) => (o.id === existing.id ? next : o)) : [...rows, next]
      const cascades = existing && existing.name !== name ? renameOfficeCascade(state, existing.name, name) : null
      const moved = cascades ? Object.keys(cascades).filter((k) => cascades[k]).length : 0
      return done(
        existing ? `“${name}” updated${moved ? ` — ${existing.name} renamed everywhere it was used` : ''}` : `“${name}” added to the office master`,
        { patch: { offices }, cascades },
      )
    }
    case 'office.remove': {
      const target = officeById(settings, payload.id)
      if (!target) return fail('That office no longer exists.')
      const rows = settingsOffices(settings)
      if (rows.length <= 1) return fail('Keep at least one office on file — the practice needs somewhere to work from.')
      const used = officeUsage(state, target.name)
      const reassign = clean(payload.reassignTo, 80)
      if (used && !reassign) return fail(`“${target.name}” is used by ${used} record${used === 1 ? '' : 's'} (staff, clients, appointments, payroll profiles or accounts). Choose another office to move them to first.`)
      if (reassign && !rows.some((o) => o.name === reassign && o.id !== target.id)) return fail('Pick an existing office to move the records to.')
      const cascades = reassign ? renameOfficeCascade(state, target.name, reassign) : null
      return done(`“${target.name}” removed${used ? ` — ${used} record${used === 1 ? '' : 's'} moved to ${reassign}` : ''}`, {
        patch: { offices: rows.filter((o) => o.id !== target.id) }, cascades,
      })
    }
    case 'status.upsert': {
      const item = { ...payload.item }
      const label = clean(item.label, 40)
      if (label.length < 2) return fail('Give the status a label of at least 2 characters.')
      const rows = apptStatusList(settings)
      const existing = rows.find((s) => s.key === item.key) || null
      const key = existing?.key || clean(item.key, 40).toLowerCase().replace(/[^a-z0-9]+/g, '-') || `st-${uid().slice(0, 6)}`
      if (!existing && rows.some((s) => s.key === key)) return fail('Another status already uses that key.')
      if (!existing && rows.some((s) => s.label.toLowerCase() === label.toLowerCase())) return fail(`A status called “${label}” already exists.`)
      const pays = item.pays !== false
      const payrollCode = clean(item.payrollCode, 12)
      if (pays && payrollCode && !earningCodes(settings.payroll).some((c) => c.id === payrollCode)) return fail(`${payrollCode} is not a configured earning code.`)
      const cancelBand = item.isCancellation != null ? !!item.isCancellation : !!item.cancelBand
      const aka = clean(item.aka ?? existing?.aka, 8).toUpperCase() || label.replace(/[^A-Za-z0-9]/g, '').slice(0, 3).toUpperCase() || 'STS'
      const status = {
        key, label, aka, color: clean(item.color, 9) || '#64748b', active: item.active !== false,
        system: !!existing?.system, order: existing?.order ?? rows.length,
        pays,
        billable: item.billable != null ? !!item.billable : existing?.billable ?? !cancelBand,
        noteRequired: item.noteRequired != null ? !!item.noteRequired : existing?.noteRequired ?? cancelBand,
        isCancellation: cancelBand,
        allowToComplete: item.allowToComplete != null ? !!item.allowToComplete : existing?.allowToComplete ?? !cancelBand,
        payrollCode, cancelBand, note: clean(item.note, 240),
      }
      const nextRows = existing ? rows.map((s) => (s.key === key ? status : s)) : [...rows, status]
      const statuses = nextRows.map((s, i) => ({ ...s, order: i }))
      if (!statuses.some((s) => s.active !== false && s.pays)) return fail('At least one active status must produce payable time.')
      return done(existing ? `“${label}” updated` : `“${label}” added to the appointment statuses`, { patch: { apptStatuses: statuses } })
    }
    case 'status.remove': {
      const row = apptStatusList(settings).find((s) => s.key === payload.key)
      if (!row) return fail('That status no longer exists.')
      const used = statusUsage(state, row.key)
      if (used && !payload.reassignTo) return fail(`${used} appointment${used === 1 ? '' : 's'} still carry “${row.label}”. Choose a status to move them to.`)
      const rows = apptStatusList(settings)
      if (rows.length <= 1) return fail('Keep at least one appointment status.')
      if (!rows.some((s) => s.key !== row.key && s.active !== false)) return fail('Keep at least one active appointment status.')
      if (payload.reassignTo && (payload.reassignTo === row.key || !rows.some((s) => s.key === payload.reassignTo))) return fail('Pick another existing status to move the appointments to.')
      const cascades = payload.reassignTo
        ? { appts: { patches: Object.entries(state.appts || {}).filter(([, a]) => a.status === row.key).map(([id]) => ({ id, patch: { status: payload.reassignTo } })) } }
        : null
      return done(`“${row.label}” removed${used ? ` — ${used} appointment${used === 1 ? '' : 's'} moved to ${payload.reassignTo}` : ''}`, {
        patch: { apptStatuses: rows.filter((s) => s.key !== row.key).map((s, i) => ({ ...s, order: i })) }, cascades,
      })
    }
    case 'status.move': {
      const rows = apptStatusList(settings)
      const i = rows.findIndex((s) => s.key === payload.key)
      const j = i + (payload.dir === 'up' ? -1 : 1)
      if (i < 0 || j < 0 || j >= rows.length) return fail('That status is already at the end of the list.')
      const next = rows.slice()
      const [row] = next.splice(i, 1)
      next.splice(j, 0, row)
      return done(`“${row.label}” moved ${payload.dir === 'up' ? 'up' : 'down'}`, { patch: { apptStatuses: next.map((s, idx) => ({ ...s, order: idx })) } })
    }
    case 'list.upsert': {
      const name = clean(payload.item?.name, 60)
      if (name.length < 2) return fail('Give the list a name of at least 2 characters.')
      const group = payload.item?.group === 'service-type' ? 'service-type' : 'general'
      const rows = customLists(settings)
      const existing = rows.find((l) => l.id === payload.item?.id) || null
      if (uniqueName(rows, name, existing?.id)) return fail(`A list called “${name}” already exists.`)
      const row = {
        id: existing?.id || `list-${uid()}`, group, name,
        description: clean(payload.item?.description, 200),
        status: payload.item?.status === 'inactive' ? 'inactive' : 'active',
        editable: payload.item?.editable !== undefined ? !!payload.item.editable : (existing?.editable !== false),
        system: !!existing?.system,
        options: Array.isArray(payload.item?.options)
          ? payload.item.options.map((o, i) => ({ id: o.id || `opt-${existing?.id || 'new'}-${i}`, label: clean(o.label, 60), active: o.active !== false, editable: o.editable !== false, order: i }))
          : (existing?.options || []),
      }
      const next = existing ? rows.map((l) => (l.id === row.id ? row : l)) : [...rows, row]
      return done(existing ? `“${name}” updated` : `“${name}” added`, { patch: { customLists: next } })
    }
    case 'list.remove': {
      const row = customListById(settings, payload.id)
      if (!row) return fail('That list no longer exists.')
      if (row.system) return fail(`“${row.name}” is a built-in list used by other modules; deactivate it instead of deleting it.`)
      if (row.editable === false) return fail(`“${row.name}” is locked for editing. Enable the Edit toggle first.`)
      return done(`“${row.name}” removed`, { patch: { customLists: customLists(settings).filter((l) => l.id !== row.id) } })
    }
    case 'list.optionAdd': {
      const row = customListById(settings, payload.listId)
      if (!row) return fail('Pick a list first.')
      if (row.editable === false) return fail(`“${row.name}” is locked for editing. Enable the Edit toggle on the list first.`)
      const label = clean(payload.label, 60)
      if (label.length < 1) return fail('Type the option text first.')
      if (row.options.some((o) => o.label.toLowerCase() === label.toLowerCase())) return fail(`“${label}” is already on ${row.name}.`)
      const option = { id: `opt-${row.id}-${uid().slice(0, 6)}`, label, active: true, editable: true, order: row.options.length }
      const next = customLists(settings).map((l) => (l.id === row.id ? { ...l, options: [...l.options, option] } : l))
      return done(`“${label}” added to ${row.name}`, { patch: { customLists: next } })
    }
    case 'list.optionUpdate': {
      const row = customListById(settings, payload.listId)
      const option = row?.options.find((o) => o.id === payload.optionId)
      if (!row || !option) return fail('That option no longer exists.')
      if (row.editable === false) return fail(`“${row.name}” is locked for editing.`)
      if (option.editable === false && payload.patch?.editable === undefined) return fail(`“${option.label}” is locked for editing.`)
      const label = payload.patch?.label === undefined ? option.label : clean(payload.patch.label, 60)
      if (!label) return fail('An option needs a label.')
      if (row.options.some((o) => o.id !== option.id && o.label.toLowerCase() === label.toLowerCase())) return fail(`“${label}” is already on ${row.name}.`)
      const next = customLists(settings).map((l) => (l.id === row.id ? {
        ...l, options: l.options.map((o) => (o.id === option.id ? { ...o, ...payload.patch, label } : o)),
      } : l))
      return done(`${row.name} updated`, { patch: { customLists: next } })
    }
    case 'list.optionRemove': {
      const row = customListById(settings, payload.listId)
      if (!row) return fail('That list no longer exists.')
      if (row.editable === false) return fail(`“${row.name}” is locked for editing.`)
      const option = row.options.find((o) => o.id === payload.optionId)
      if (!option) return fail('That option no longer exists.')
      if (option.editable === false) return fail(`“${option.label}” is locked for editing.`)
      const next = customLists(settings).map((l) => (l.id === row.id ? { ...l, options: l.options.filter((o) => o.id !== option.id).map((o, i) => ({ ...o, order: i })) } : l))
      return done(`“${option.label}” removed from ${row.name}`, { patch: { customLists: next } })
    }
    case 'list.optionMove': {
      const row = customListById(settings, payload.listId)
      if (row?.editable === false) return fail(`“${row.name}” is locked for editing.`)
      const options = row ? row.options.slice().sort(byOrder) : []
      const i = options.findIndex((o) => o.id === payload.optionId)
      const j = i + (payload.dir === 'up' ? -1 : 1)
      if (i < 0 || j < 0 || j >= options.length) return fail('That option is already at the end of the list.')
      const [moved] = options.splice(i, 1)
      options.splice(j, 0, moved)
      const next = customLists(settings).map((l) => (l.id === row.id ? { ...l, options: options.map((o, idx) => ({ ...o, order: idx })) } : l))
      return done('Option order updated', { patch: { customLists: next } })
    }
    case 'qualification.upsert': {
      const item = payload.item || {}
      const name = clean(item.name, 60)
      if (name.length < 2) return fail('Give the qualification a name of at least 2 characters.')
      const rows = qualificationList(settings, { activeOnly: false })
      const existing = rows.find((q) => q.id === item.id) || null
      if (uniqueName(rows, name, existing?.id)) return fail(`“${name}” is already in the qualification list.`)
      if (item.type && !QUALIFICATION_TYPES.some((t) => t.id === item.type)) return fail('Pick a qualification type from the list.')
      const lifeTime = item.lifeTime != null ? !!item.lifeTime : (item.expires != null ? !item.expires : !!existing?.lifeTime)
      const expires = item.expires != null ? !!item.expires : !lifeTime
      const targetId = existing?.id || `q-${uid()}`
      const covers = arr(item.covers ?? existing?.covers).filter((cid) => cid && cid !== targetId)
      const row = {
        id: targetId, name,
        type: item.type || 'certification', authority: clean(item.authority, 60), code: clean(item.code, 24),
        expires, lifeTime, covers, documentRequired: !!item.documentRequired,
        appliesTo: arr(item.appliesTo).map((r) => clean(r, 60)).filter(Boolean), status: item.status === 'inactive' ? 'inactive' : 'active',
        order: existing?.order ?? rows.length,
      }
      const next = existing ? rows.map((q) => (q.id === row.id ? row : q)) : [...rows, row]
      return done(existing ? `“${name}” updated` : `“${name}” added to qualifications`, { patch: { qualifications: next } })
    }
    case 'qualification.remove': {
      const rows = qualificationList(settings, { activeOnly: false })
      const row = rows.find((q) => q.id === payload.id)
      if (!row) return fail('That qualification no longer exists.')
      const used = (state.settings?.providers || []).filter((p) => p.credential === row.name).length
      if (used) return fail(`${used} provider record${used === 1 ? '' : 's'} hold “${row.name}”. Rename the provider credential or deactivate the qualification instead.`)
      return done(`“${row.name}” removed`, { patch: { qualifications: rows.filter((q) => q.id !== row.id) } })
    }
    case 'earningCode.upsert': {
      const payroll = settings.payroll || {}
      const rows = earningCodes(payroll)
      const item = payload.item || {}
      const label = clean(item.label, 80)
      const id = clean(item.id || item.code, 12).toUpperCase()
      if (!id || !/^[A-Z0-9]{2,12}$/.test(id)) return fail('An earning code needs 2–12 letters or digits (for example REG or SUP).')
      if (label.length < 2) return fail('Give the earning code a label.')
      const existing = rows.find((c) => c.id === id) || null
      if (item.kind && !['worked', 'premium', 'leave', 'bonus', 'expense', 'cancellation'].includes(item.kind)) return fail('Pick a valid code kind.')
      if (item.regularRate && !item.taxable && item.kind !== 'expense') return fail('A regular-rate code must be taxable.')
      const pto = item.pto != null ? !!item.pto : (item.kind === 'leave' || !!existing?.pto)
      const otEligible = item.overtime != null ? !!item.overtime : (item.otEligible !== false)
      const row = {
        id, label, short: clean(item.short, 24) || label.split('—')[0].trim(),
        kind: item.kind || (pto ? 'leave' : existing?.kind || 'worked'),
        pto,
        mapping: clean(item.mapping ?? existing?.mapping, 32),
        otEligible, overtime: otEligible,
        doubleTime: item.doubleTime != null ? !!item.doubleTime : !!existing?.doubleTime,
        regularRate: item.regularRate !== false,
        taxable: item.taxable !== false, nondisc: !!item.nondisc, duty: clean(item.duty, 60),
        notes: clean(item.notes ?? existing?.notes, 200),
        active: item.active !== false,
        system: !!existing?.system,
      }
      const next = existing ? rows.map((c) => (c.id === id ? { ...c, ...row } : c)) : [...rows, row]
      if (!next.some((c) => c.kind === 'worked')) return fail('Keep at least one worked code — payroll needs something to pay for a session.')
      return done(existing ? `${id} updated` : `${id} added to the earning codes`, { patch: { payroll: { ...payroll, earningCodes: next } } })
    }
    case 'earningCode.remove': {
      const payroll = settings.payroll || {}
      const rows = earningCodes(payroll)
      const row = rows.find((c) => c.id === payload.id)
      if (!row) return fail('That earning code no longer exists.')
      if (row.system) return fail(`${row.id} is read by the payroll engine and the exports. Deactivate it instead of deleting it.`)
      const used = codeUsage(state, row.id)
      if (used) return fail(`${row.id} is used by ${used} timesheet, run or claim line${used === 1 ? '' : 's'}. Remove those first or deactivate the code.`)
      if (rows.filter((c) => c.id !== row.id && c.kind === 'worked').length === 0) return fail('Keep at least one worked code.')
      return done(`${row.id} removed`, { patch: { payroll: { ...payroll, earningCodes: rows.filter((c) => c.id !== row.id) } } })
    }
    case 'payroll.general': {
      const payroll = { ...(settings.payroll || defaultPayrollSettings()), ...payload.patch }
      const p = payload.patch || {}
      if (p.frequency && !['weekly', 'biweekly', 'semimonthly', 'monthly'].includes(p.frequency)) return fail('Pick a valid pay frequency.')
      if (p.payLagDays != null && (p.payLagDays < 0 || p.payLagDays > 30)) return fail('The pay-date lag must be between 0 and 30 days.')
      if (p.workWeekStart != null && (p.workWeekStart < 0 || p.workWeekStart > 6)) return fail('Pick a workweek start day.')
      if (p.mileageRate != null && (Number(p.mileageRate) < 0 || Number(p.mileageRate) > 10)) return fail('Mileage reimbursement rate must be between $0 and $10 per mile.')
      const openRuns = Object.values(state.payRuns || {}).filter((r) => !['processed', 'voided'].includes(r.status))
      if (p.frequency && openRuns.length) return fail(`${openRuns.length} pay run${openRuns.length === 1 ? '' : 's'} are still open on the current cycle — process or void them before changing the pay frequency.`)
      if (p.rounding) {
        payroll.rounding = { ...payroll.rounding, ...p.rounding }
        if (!['none', 'nearest', 'up', 'down'].includes(payroll.rounding.mode)) return fail('Pick a valid rounding mode.')
        if (!(payroll.rounding.mins >= 1 && payroll.rounding.mins <= 60)) return fail('Rounding must be between 1 and 60 minutes.')
      }
      if (p.approvals) payroll.approvals = { ...payroll.approvals, ...p.approvals }
      if (p.cancelPolicy) {
        payroll.cancelPolicy = { ...payroll.cancelPolicy, ...p.cancelPolicy }
        const c = payroll.cancelPolicy
        for (const k of ['freeNoticeHours', 'payShortNoticePct', 'payNoShowPct', 'payUnknownNoticePct']) {
          if (!Number.isFinite(Number(c[k])) || Number(c[k]) < 0 || Number(c[k]) > 168) return fail('Cancellation bands must be numbers between 0 and 168.')
        }
      }
      const extraSettings = p.mileageRate != null ? { mileageRate: Number(p.mileageRate) } : {}
      return done('Payroll general settings updated', { patch: { payroll, ...extraSettings } })
    }
    case 'payroll.defaults': {
      const payroll = { ...(settings.payroll || defaultPayrollSettings()) }
      const codes = earningCodes(payroll)
      const defaults = {
        nonService: 'ADMIN',
        drive: 'DRIVE',
        breakTime: 'ADMIN',
        ...(payroll.defaultEarningCodes || {}),
        ...(payload.patch || {}),
      }
      for (const k of ['nonService', 'drive', 'breakTime']) {
        if (defaults[k] && !codes.some((c) => c.id === defaults[k])) return fail(`${defaults[k]} is not a configured earning code.`)
      }
      return done('Default earning codes updated', { patch: { payroll: { ...payroll, defaultEarningCodes: defaults } } })
    }
    case 'payroll.overtime': {
      const payroll = { ...(settings.payroll || defaultPayrollSettings()) }
      const p = payload.patch || {}
      const next = { ...payroll, ...p }
      if (next.otAfterHours != null && !(Number(next.otAfterHours) >= 1 && Number(next.otAfterHours) <= 168)) return fail('Weekly overtime starts between 1 and 168 hours.')
      if (next.otMultiplier != null && Number(next.otMultiplier) < 1.5) return fail('The federal FLSA minimum is 1.5× — a lower multiplier would under-pay overtime.')
      if (next.otMultiplier != null && Number(next.otMultiplier) > 3) return fail('A multiplier above 3× is unusual — check the policy before saving.')
      if (next.dailyOtHours != null && next.dailyOtHours !== '' && !(Number(next.dailyOtHours) >= 1 && Number(next.dailyOtHours) <= 24)) return fail('Daily overtime starts between 1 and 24 hours.')
      if (next.dailyOtMultiplier != null && next.dailyOtMultiplier !== '' && Number(next.dailyOtMultiplier) < 1.5) return fail('Daily overtime must be at least 1.5×.')
      if (next.workWeekStart != null && (next.workWeekStart < 0 || next.workWeekStart > 6)) return fail('Pick a workweek start day.')
      return done('Overtime rules updated', { patch: { payroll: next } })
    }
    case 'payroll.officeOvertime': {
      const payroll = { ...(settings.payroll || defaultPayrollSettings()) }
      const rule = payload.rule || {}
      const officeId = clean(rule.officeId, 60)
      if (!officeId) return fail('Pick an office for this overtime rule.')
      const numOrNull = (v) => (v === '' || v == null ? null : Number(v))
      const dailyOt = numOrNull(rule.dailyOtHours)
      const dailyDt = numOrNull(rule.dailyDoubleHours)
      const weeklyOt = numOrNull(rule.weeklyOtHours) ?? 40
      const seventhOt = numOrNull(rule.seventhDayOtHours)
      const seventhDt = numOrNull(rule.seventhDayDoubleHours)
      if (dailyOt != null && (dailyOt < 1 || dailyOt > 24)) return fail('Daily overtime threshold must be between 1 and 24 hours.')
      if (dailyDt != null && (dailyDt < 1 || dailyDt > 24)) return fail('Daily double-time threshold must be between 1 and 24 hours.')
      if (dailyOt != null && dailyDt != null && dailyDt <= dailyOt) return fail('Daily double-time threshold must be higher than daily overtime.')
      if (weeklyOt < 1 || weeklyOt > 168) return fail('Weekly overtime threshold must be between 1 and 168 hours.')
      const effectiveDate = clean(rule.effectiveDate, 10)
      const expirationDate = clean(rule.expirationDate, 10)
      if (effectiveDate && expirationDate && expirationDate < effectiveDate) return fail('Expiration date cannot be earlier than the effective date.')
      const officeOvertimeRules = {
        ...(payroll.officeOvertimeRules || {}),
        [officeId]: {
          officeId,
          officeName: clean(rule.officeName, 80),
          dailyOtHours: dailyOt,
          dailyDoubleHours: dailyDt,
          weeklyOtHours: weeklyOt,
          seventhDayOtHours: seventhOt,
          seventhDayDoubleHours: seventhDt,
          effectiveDate,
          expirationDate,
          active: rule.active !== false,
        },
      }
      return done(`Overtime rule saved for ${rule.officeName || officeId}`, { patch: { payroll: { ...payroll, officeOvertimeRules } } })
    }
    case 'org.patch': {
      const org = { ...(settings.org || {}), ...payload.patch }
      if (clean(org.name, 80).length < 2) return fail('The practice needs a name of at least 2 characters.')
      if (org.npi && !isNpi(org.npi)) return fail('An NPI must be exactly 10 digits.')
      if (org.taxId && !isTaxId(org.taxId)) return fail('A tax ID looks like 12-3456789.')
      if (org.email && !isEmail(org.email)) return fail('That email address does not look right.')
      if (org.fiscalYearStart != null && (org.fiscalYearStart < 1 || org.fiscalYearStart > 12)) return fail('Pick a fiscal-year start month.')
      return done('Organization profile updated', { patch: { org } })
    }
    case 'template.upsert': {
      const cfg = messagesCfg(settings)
      const item = payload.item || {}
      const name = clean(item.name, 60)
      if (name.length < 2) return fail('Give the template a name.')
      const body = clean(item.body, 480)
      if (body.length < 10) return fail('A message needs at least 10 characters.')
      const unknown = (body.match(/\{\{[a-z]+\}\}/g) || []).filter((token) => !MERGE_FIELDS.includes(token))
      if (unknown.length) return fail(`${unknown[0]} is not a merge field this demo can fill. Available: ${MERGE_FIELDS.slice(0, 6).join(', ')}…`)
      const existing = cfg.templates.find((t) => t.id === item.id) || null
      const row = { id: existing?.id || `msg-${uid()}`, name, category: clean(item.category, 24) || 'appointment', body, status: item.status === 'inactive' ? 'inactive' : item.status === 'draft' ? 'draft' : 'active' }
      const templates = existing ? cfg.templates.map((t) => (t.id === row.id ? row : t)) : [...cfg.templates, row]
      return done(existing ? `“${name}” updated` : `“${name}” added to the message templates`, { patch: { textMessaging: { ...cfg, templates } } })
    }
    case 'template.remove': {
      const cfg = messagesCfg(settings)
      const row = cfg.templates.find((t) => t.id === payload.id)
      if (!row) return fail('That template no longer exists.')
      return done(`“${row.name}” removed`, { patch: { textMessaging: { ...cfg, templates: cfg.templates.filter((t) => t.id !== row.id) } } })
    }
    case 'messaging.patch': {
      const cfg = messagesCfg(settings)
      const patch = { ...payload.patch }
      if (patch.senderNumber != null && clean(patch.senderNumber) && !/^[+()\-\s\d]{7,20}$/.test(text(patch.senderNumber))) return fail('That sender number does not look like a phone number.')
      if (patch.quietStart && !/^\d{2}:\d{2}$/.test(patch.quietStart)) return fail('Quiet hours use HH:MM.')
      if (patch.quietEnd && !/^\d{2}:\d{2}$/.test(patch.quietEnd)) return fail('Quiet hours use HH:MM.')
      if (patch.orgCode != null && clean(patch.orgCode).length < 2) return fail('Organization Code must be at least 2 characters.')
      const next = { ...cfg, ...patch }
      if (next.enabled && !clean(next.senderName || next.senderNumber)) return fail('Set a sender name or number before enabling texting.')
      return done('Text messaging settings updated', { patch: { textMessaging: next } })
    }
    case 'optout.add': {
      const cfg = messagesCfg(settings)
      const phone = clean(payload.phone, 24)
      if (phone.length < 7) return fail('Enter the phone number that opted out.')
      if (cfg.optOuts.some((o) => o.phone === phone)) return fail(`${phone} is already on the opt-out list.`)
      const row = { id: `opt-${uid()}`, phone, name: clean(payload.name, 60), reason: clean(payload.reason, 80) || 'Manually recorded', at: Date.now() }
      return done(`${phone} added to the opt-out list`, { patch: { textMessaging: { ...cfg, optOuts: [...cfg.optOuts, row] } } })
    }
    case 'optout.remove': {
      const cfg = messagesCfg(settings)
      const row = cfg.optOuts.find((o) => o.id === payload.id)
      if (!row) return fail('That opt-out entry no longer exists.')
      return done(`${row.phone} removed from the opt-out list`, { patch: { textMessaging: { ...cfg, optOuts: cfg.optOuts.filter((o) => o.id !== row.id) } } })
    }
    case 'integration.patch': {
      const rows = integrationsCfg(settings)
      const row = rows.find((i) => i.id === payload.id)
      if (!row) return fail('That integration no longer exists.')
      const patch = { ...payload.patch }
      if (patch.status && !INTEGRATION_STATUSES[patch.status]) return fail('Unknown integration status.')
      for (const k of ['roomUrl', 'payUrl']) {
        if (!(k in patch)) continue
        patch[k] = String(patch[k] || '').trim()
        if (patch[k] && !isWebUrl(patch[k])) return fail('Enter the link as a full https:// address.')
      }
      const next = rows.map((i) => (i.id === row.id ? { ...i, ...patch } : i))
      return done(`${row.name} updated`, { patch: { clinicalIntegrations: next } })
    }
    case 'integration.ran': {
      const rows = integrationsCfg(settings)
      const row = rows.find((i) => i.id === payload.id)
      if (!row) return fail('That integration no longer exists.')
      const next = rows.map((i) => (i.id === row.id ? { ...i, lastRunAt: Date.now(), lastRunBy: clean(payload.who, 60) || 'local user' } : i))
      return done(`${row.name} — export recorded at ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`, { patch: { clinicalIntegrations: next } })
    }
    case 'clearinghouse.upsert': {
      const rows = clearinghousesCfg(settings)
      const item = payload.item || {}
      const name = clean(item.name, 60)
      if (name.length < 2) return fail('Enter a clearinghouse name of at least 2 characters.')
      const submitterId = clean(item.submitterId, 32)
      if (!submitterId) return fail('Enter a Submitter ID for 837P/835 routing.')
      const existing = rows.find((r) => r.id === item.id) || null
      const row = {
        id: existing?.id || `ch-${uid()}`,
        name,
        submitterId,
        receiverId: clean(item.receiverId, 32),
        username: clean(item.username || item.sftpUser, 60),
        sftpUser: clean(item.sftpUser || item.username, 60),
        sftpHost: clean(item.sftpHost, 120),
        ansiVersion: clean(item.ansiVersion, 20) || '5010A1',
        productionMode: item.productionMode != null ? !!item.productionMode : !item.sandbox,
        sandbox: item.sandbox != null ? !!item.sandbox : !item.productionMode,
        isDefault: !!item.isDefault,
        active: item.active !== false && item.status !== 'inactive',
        claim837Enabled: item.claim837Enabled !== false,
        era835Enabled: item.era835Enabled !== false,
        elig270Enabled: !!item.elig270Enabled,
        status: item.status === 'inactive' || item.active === false ? 'inactive' : 'active',
      }
      const next = existing ? rows.map((r) => (r.id === row.id ? row : r)) : [...rows, row]
      return done(existing ? `${name} updated` : `${name} added to clearinghouses`, { patch: { clearinghouses: next } })
    }
    case 'clearinghouse.remove': {
      const rows = clearinghousesCfg(settings)
      const row = rows.find((r) => r.id === payload.id)
      if (!row) return fail('That clearinghouse no longer exists.')
      if (rows.length <= 1) return fail('Keep at least one clearinghouse record configured.')
      return done(`${row.name} removed`, { patch: { clearinghouses: rows.filter((r) => r.id !== row.id) } })
    }
    case 'evv.patch': {
      const cfg = { ...evvCfg(settings), ...(payload.patch || {}) }
      if (cfg.providerId != null && !cfg.agencyId) cfg.agencyId = cfg.providerId
      if (!clean(cfg.agencyId || cfg.providerId, 40)) return fail('EVV Agency / Provider ID is required.')
      const radius = cfg.geofenceRadiusFeet ?? cfg.gpsToleranceFeet
      if (radius != null && (Number(radius) < 50 || Number(radius) > 5280)) {
        return fail('EVV geofence radius must be between 50 and 5,280 feet.')
      }
      return done('EVV integration settings updated', { patch: { evvConfig: cfg } })
    }
    case 'appointmentValidations.patch':
    case 'validations.patch': {
      const cur = appointmentValidationsCfg(settings)
      if (payload.patch && typeof payload.patch === 'object') {
        const next = { ...cur }
        for (const [grp, rules] of Object.entries(payload.patch)) {
          if (!VALIDATION_GROUPS.includes(grp)) return fail('Unknown validation group.')
          next[grp] = { ...(cur[grp] || {}), ...(rules || {}) }
        }
        return done('Appointment validation rules updated', { patch: { appointmentValidations: next } })
      }
      const { group, key, severity } = payload
      if (!VALIDATION_GROUPS.includes(group)) return fail('Unknown validation group.')
      if (!VALIDATION_SEVERITIES.some((s) => s.id === severity)) return fail('Pick None, Flag, Warn or Stop.')
      const next = {
        ...cur,
        [group]: { ...cur[group], [key]: severity },
      }
      return done(`Appointment validation (${group} · ${key}) set to ${severity.toUpperCase()}`, { patch: { appointmentValidations: next } })
    }
    case 'notifications.patch': {
      const next = { ...notificationsCfg(settings), ...(payload.patch || {}) }
      return done('Notification settings updated', { patch: { notifications: next } })
    }
    case 'systemConfig.patch': {
      const cur = systemConfigFor(settings)
      const p = payload.patch || {}
      const next = {
        ...cur,
        ...p,
        general: { ...cur.general, ...(p.general || {}) },
        billing: { ...(cur.billing || {}), ...(p.billing || {}) },
        appointment: { ...cur.appointment, ...(p.appointment || {}) },
        other: { ...cur.other, ...(p.other || {}) },
      }
      return done('System configuration updated', { patch: { system: next } })
    }
    case 'subscription.patch': {
      const cfg = subscriptionCfg(settings)
      const patch = { ...payload.patch }
      if (patch.seats != null && !(Number(patch.seats) >= 1 && Number(patch.seats) <= 5000)) return fail('Seats must be between 1 and 5000.')
      if (patch.billingContact && !isEmail(patch.billingContact)) return fail('That billing contact is not a valid email address.')
      if (patch.portalUrl && !/^https:\/\//.test(patch.portalUrl)) return fail('The portal link must be an https:// address.')
      return done('Subscription record updated', { patch: { subscription: { ...cfg, ...patch } } })
    }
    case 'credentials.patch': {
      const raw = payload.patch?.rbtPduHours
      const n = Number(raw)
      if (raw === '' || raw == null || !Number.isFinite(n) || n < 0 || n > 100 || Math.round(n * 4) !== n * 4) return fail('The RBT PDU target must be 0–100 hours, in quarter hours.')
      return done(`RBT annual PDU target set to ${n} h`, { patch: { credentials: { ...(settings.credentials || {}), rbtPduHours: n } } })
    }
    case 'billing.reasons': {
      const plan = planReasonLists(payload)
      if (!plan.ok) return fail(plan.msg)
      return done(plan.msg, { patch: { billing: { ...(settings.billing || {}), denialReasons: plan.denialReasons, carcHints: plan.carcHints } } })
    }
    case 'system.patch': {
      const patch = { ...payload.patch }
      const next = { ...settings }
      for (const key of ['theme', 'weekStart', 'h24', 'defaultRate', 'mileageRate', 'workday', 'apptNameStyle', 'apptTitleExtras', 'apptNameStaff', 'analytics', 'notifications', 'billing', 'system']) {
        if (key in patch) next[key] = patch[key]
      }
      if (next.theme && !['light', 'dark'].includes(next.theme)) return fail('Pick light or dark.')
      if (next.weekStart != null && ![0, 1, 2, 3, 4, 5, 6].includes(Number(next.weekStart))) return fail('Pick a week-start day.')
      if (next.defaultRate != null && !(Number(next.defaultRate) >= 0 && Number(next.defaultRate) <= 1000)) return fail('Default rate must be between $0 and $1,000 per unit.')
      if (next.mileageRate != null && !(Number(next.mileageRate) >= 0 && Number(next.mileageRate) <= 10)) return fail('Mileage rate must be between $0 and $10 per mile.')
      if (next.workday && (!Array.isArray(next.workday) || next.workday.length !== 2 || next.workday[0] < 0 || next.workday[1] > 24 || next.workday[0] >= next.workday[1])) return fail('Working hours must run from an earlier hour to a later one (0–24).')
      if (next.notifications && Object.keys(patch.notifications || {}).some((k) => !(k in DEFAULT_NOTIFICATIONS))) return fail('Unknown notification preference.')
      const settingsPatch = {}
      for (const key of Object.keys(patch)) if (key in next) settingsPatch[key] = next[key]
      return done('System settings updated', { patch: settingsPatch })
    }
    case 'import.commit':
      return fail('Data Import writes go through the import planner, not a settings op.')
    default:
      return fail(`Unknown settings operation “${op}”.`)
  }
}

/**
 * Renaming/removing an office must not orphan the records that point at it.
 * One cascade object → one snapshot key per collection → one Undo.
 *
 * Cascade contract (shared with Data Import):
 *   { appts: { creates, patches }, clients: { creates, patches }, staff: { creates, patches },
 *     payProfiles: { patches }, intakeRequests: { patches }, security: { accounts } }
 */
export function officeCascade(state, from, to) {
  if (!from || !to || from === to) return null
  const out = {}
  const apptPatches = []
  for (const [id, a] of Object.entries(state.appts || {})) if (a.location === from) apptPatches.push({ id, patch: { location: to } })
  if (apptPatches.length) out.appts = { patches: apptPatches }
  const clientPatches = (state.clients || []).filter((c) => c.home === from || c.office === from)
    .map((c) => ({ id: c.id, patch: { ...(c.home === from ? { home: to } : {}), ...(c.office === from ? { office: to } : {}) } }))
  if (clientPatches.length) out.clients = { patches: clientPatches }
  const payPatches = (state.payProfiles || []).filter((p) => p.office === from).map((p) => ({ staffId: p.staffId, patch: { office: to } }))
  if (payPatches.length) out.payProfiles = { patches: payPatches }
  const intakePatches = Object.values(state.intakeRequests || {}).filter((r) => r.office === from).map((r) => ({ id: r.id, patch: { office: to } }))
  if (intakePatches.length) out.intakeRequests = { patches: intakePatches }
  const accounts = (state.security?.accounts || []).filter((a) => (a.officeIds || []).includes(from))
  if (accounts.length) out.security = { accounts: accounts.map((a) => ({ id: a.id, officeIds: a.officeIds.map((o) => (o === from ? to : o)) })) }
  return Object.keys(out).length ? out : null
}
export const renameOfficeCascade = officeCascade

/* ── normalization: old saves gain the new masters, idempotently ───────────── */

const mergeRows = (configured, defaults, keyOf) => {
  const rows = arr(configured).length ? arr(configured) : defaults
  const seen = new Set(rows.map(keyOf))
  const missing = defaults.filter((d) => !seen.has(keyOf(d)))
  return [...rows, ...missing]
}

export function normalizeSettingsMasters(state) {
  const settings = state.settings
  if (!settings) return state
  let changed = false
  const next = { ...settings }

  if (!arr(settings.offices).length) { next.offices = DEFAULT_OFFICES; changed = true }
  else {
    const offices = settings.offices.map((o) => {
      const isLoc = o.excludeFromLocations != null ? !o.excludeFromLocations : o.isLocation !== false
      return {
        id: o.id || `off-${uid()}`, code: o.code || '', name: clean(o.name, 80), type: o.type || 'Center',
        isLocation: isLoc, excludeFromLocations: !isLoc, parent: o.parent || '',
        address: o.address || '', city: o.city || '', state: o.state || '', zip: o.zip || '',
        addressNotes: o.addressNotes || '', phone: o.phone || '', fax: o.fax || '', email: o.email || '',
        taxIdType: o.taxIdType || 'EIN', ein: o.ein || '', logoDataUrl: o.logoDataUrl || '',
        npi: o.npi || '', timezone: o.timezone || 'America/Los_Angeles',
        scope: o.scope !== false, active: o.active !== false, note: o.note || '', createdAt: o.createdAt || Date.now(),
      }
    })
    // the payroll office names security scopes against must always resolve
    for (const name of PAYROLL_OFFICES) {
      if (!offices.some((o) => o.name === name)) offices.push({ ...DEFAULT_OFFICES.find((d) => d.name === name) || {
        id: `off-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, code: '', name, type: 'Program', isLocation: false, excludeFromLocations: true, parent: '', address: '', city: '', state: '', zip: '', addressNotes: '', phone: '', fax: '', email: '', taxIdType: 'EIN', ein: '', logoDataUrl: '', npi: '', timezone: 'America/Los_Angeles', scope: true, active: true, note: '', createdAt: Date.now(),
      } })
    }
    if (JSON.stringify(offices) !== JSON.stringify(settings.offices)) { next.offices = offices; changed = true }
  }

  const statuses = mergeRows(settings.apptStatuses, DEFAULT_APPT_STATUSES, (s) => s.key)
    .map((s, i) => {
      const def = DEFAULT_APPT_STATUSES.find((d) => d.key === s.key)
      const cancelBand = s.isCancellation != null ? !!s.isCancellation : !!s.cancelBand
      return {
        key: s.key, label: s.label || s.key,
        aka: s.aka || def?.aka || String(s.label || s.key).replace(/[^A-Za-z0-9]/g, '').slice(0, 3).toUpperCase(),
        color: s.color || '#64748b', active: s.active !== false,
        system: !!s.system || !!def, order: s.order ?? i,
        pays: s.pays !== false,
        billable: s.billable != null ? !!s.billable : (def ? def.billable : !cancelBand),
        noteRequired: s.noteRequired != null ? !!s.noteRequired : (def ? def.noteRequired : cancelBand),
        isCancellation: cancelBand,
        allowToComplete: s.allowToComplete != null ? !!s.allowToComplete : (def ? def.allowToComplete : !cancelBand),
        payrollCode: s.payrollCode || '', cancelBand, note: s.note || '',
      }
    })
    .sort(byOrder).map((s, i) => ({ ...s, order: i }))
  if (JSON.stringify(statuses) !== JSON.stringify(settings.apptStatuses || null)) { next.apptStatuses = statuses; changed = true }

  const lists = mergeRows(settings.customLists, DEFAULT_CUSTOM_LISTS, (l) => l.id).map((l) => ({
    id: l.id, group: l.group === 'service-type' ? 'service-type' : 'general', name: l.name || l.id,
    description: l.description || '', status: l.status === 'inactive' ? 'inactive' : 'active',
    editable: l.editable !== false,
    system: !!l.system || DEFAULT_CUSTOM_LISTS.some((d) => d.id === l.id),
    options: arr(l.options).map((o, i) => ({ id: o.id || `opt-${l.id}-${i}`, label: o.label, active: o.active !== false, editable: o.editable !== false, order: o.order ?? i })),
  }))
  if (JSON.stringify(lists) !== JSON.stringify(settings.customLists || null)) { next.customLists = lists; changed = true }

  const quals = mergeRows(settings.qualifications, DEFAULT_QUALIFICATIONS, (q) => q.id).map((q, i) => {
    const def = DEFAULT_QUALIFICATIONS.find((d) => d.id === q.id)
    const lifeTime = q.lifeTime != null ? !!q.lifeTime : (q.expires === false || !!def?.lifeTime)
    return {
      id: q.id, name: q.name || q.id, type: QUALIFICATION_TYPES.some((t) => t.id === q.type) ? q.type : 'certification',
      authority: q.authority || '', code: q.code || '',
      expires: q.expires != null ? !!q.expires : !lifeTime,
      lifeTime,
      covers: Array.isArray(q.covers) ? q.covers : (def?.covers || []),
      documentRequired: !!q.documentRequired,
      appliesTo: arr(q.appliesTo), status: q.status === 'inactive' ? 'inactive' : 'active', order: q.order ?? i,
    }
  })
  if (JSON.stringify(quals) !== JSON.stringify(settings.qualifications || null)) { next.qualifications = quals; changed = true }

  const payroll = settings.payroll || {}
  // Shipped codes are read by the payroll engine and the exports, so they are
  // system rows: the UI can retitle or deactivate them but never delete them.
  const codes = earningCodes(payroll).map((c) => (c.system || !EARNING_BY_ID[c.id] ? c : { ...c, system: true }))
  if (JSON.stringify(codes) !== JSON.stringify(arr(payroll.earningCodes))) { next.payroll = { ...payroll, earningCodes: codes }; changed = true }

  const messaging = settings.textMessaging
  if (!messaging || typeof messaging !== 'object') { next.textMessaging = DEFAULT_TEXT_MESSAGING; changed = true }
  else if (!arr(messaging.templates).length) { next.textMessaging = { ...messagesCfg(settings), templates: DEFAULT_MESSAGE_TEMPLATES }; changed = true }

  if (!arr(settings.clinicalIntegrations).length) { next.clinicalIntegrations = DEFAULT_INTEGRATIONS; changed = true }
  if (!arr(settings.clearinghouses).length) { next.clearinghouses = DEFAULT_CLEARINGHOUSES; changed = true }
  if (!settings.evvConfig) { next.evvConfig = { ...DEFAULT_EVV_CONFIG }; changed = true }
  if (!settings.appointmentValidations) { next.appointmentValidations = { ...DEFAULT_APPOINTMENT_VALIDATIONS }; changed = true }
  if (!settings.subscription) { next.subscription = { ...DEFAULT_SUBSCRIPTION }; changed = true }
  if (!settings.notifications) { next.notifications = { ...DEFAULT_NOTIFICATIONS }; changed = true }
  if (!settings.system) { next.system = { ...DEFAULT_SYSTEM_CONFIG }; changed = true }
  if (!arr(settings.importLog).length) { next.importLog = []; changed = true }

  if (!changed) return state
  return { ...state, settings: next }
}

/* Data-import bookkeeping lives on settings so it travels in the backup. */
export const IMPORT_LOG_LIMIT = 20
export function appendImportLog(settings, entry) {
  const log = arr(settings?.importLog)
  return [...log, entry].slice(-IMPORT_LOG_LIMIT)
}
