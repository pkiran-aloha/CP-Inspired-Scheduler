# Aloha ABA Practice Suite — marketing copy

_Last synced with main at ba86c3d on 2026-10-05 (small correctness batch: auto-fill unit rule, appeals as a marker, payer-edit Undo)._

Every claim on this page maps to shipped code (see the [Source map](#source-map)). Ground rules for anyone editing it: the app is a local-first prototype with no backend, nothing it does leaves the browser, the bundled data is fictional, and there are no customers, metrics or testimonials to quote. Words to use: *generates, prepares, records, exports, posts locally*. Words never to use: *sends, submits to the payer, syncs, connects, compliant, certified*.

---

## Positioning

**For** ABA practices whose admins, schedulers, billing staff, clinicians and owners currently stitch the day together from a calendar, a spreadsheet of authorizations, a billing tool and a payroll export,

**who** lose revenue when sessions are booked past an authorization, when claims leave with missing provider IDs, and when a remittance is posted to the wrong claim,

**Aloha ABA** is one practice workspace (scheduling, intake, billing, payments, A/R, payroll, reporting and settings) that checks each change against the live state of the practice before it is saved.

**Unlike** tools that flag a problem in a report after the money is gone, Aloha ABA puts the check at the moment of the decision. It refuses invalid financial states outright, it reverses any compound change with a single Undo, and it never claims to have sent something it did not send.

**Today** it is a working, local-first prototype that runs entirely in the browser on fictional data. The plan is to grow it into a production application.

### Tagline

**Checks where decisions happen. One Undo per financial change.**

Alternates:

- The practice suite that checks before it saves.
- Run the whole ABA practice from one honest workspace.

---

## Hero

### Headline

Book, bill and pay with the checks built in.

### Subhead

Aloha ABA brings scheduling, intake, claims, ERA posting, A/R and payroll into one workspace. Bookings made in the booking dialog are checked against your authorizations and payer rules before they are saved, invalid financial entries are refused, and every claim, payment or posting reverses with a single Undo.

### Primary call to action

**Open the live demo**: it runs in your browser, with fictional practice data and nothing to install.

Secondary: *See what's checked before you save* (links to "Why practices trust it").

---

## Features

### Scheduling and scheduling intelligence: see the authorization before you book the session

The booking dialog shows what a booking will do to the client's authorization, the payer's limits and the family's attendance pattern before the session is saved. Your schedulers decide with the numbers in front of them, not after the claim comes back.

- **Book-time authorization guard.** Shows committed and remaining hours, the weekly pace against the authorized week, days to expiry and a projected exhaustion date. Off, flag, warn or stop, chosen by the practice; the default is warn.
- **Per-code unit ledger with payer rules.** Authorizations carry unit pools per CPT code. Minutes convert to units by the payer's own unit size and rounding, with the Medicaid / CPT norm as the default (15-minute units, the 8-minute midpoint rule), and daily MUE limits, weekly per-code limits and credential rules are checked at booking.
- **Know before you pick.** Every staff member and client in the booking pickers carries a verdict chip, and one Checks panel in the dialog shows every issue in a shared severity language.
- **Scheduler Insights panel.** Fill against an 85–95% band, a weekday × hour coverage heat grid, named idle windows per clinician, an authorization burn-down and an at-risk session worklist.
- **Five calendar views:** day, week, month, agenda and timeline, with drag-to-move and resize, a backfill inbox for cancelled sessions a qualified colleague could cover, and a Cmd/Ctrl+K command palette.
- **Your own telehealth room, one click away.** Save the practice's video room link once and it appears on every telehealth booking and in calendar exports. The app links to your room; it does not host or record video.
- **Each clinician's schedule in their own calendar.** One click on the staff roster saves that person's next 90 days as a calendar file for Apple or Google Calendar. It is a file, not a live sync, and the app says so.
- **Travel time check.** When a clinician has a previous or next session the same day, the Checks rail shows “Needs about 22 min from previous; gap is 10 min” or a tight-turnaround warning. Estimated from straight-line distance × 1.3 road factor at 25 mph plus a 5-min buffer; not a map route. Coordinates come from client geo and optional office lat/lng, with unknown places skipped.
- **Per-clinician day route view.** Scheduler Insights has a Travel tab that lists each clinician's day as legs with travel minutes, tight/impossible flags and totals, plus a read-only suggested re-order that saves miles. Nothing moves on the calendar.

### Cancellations: know why sessions are lost, not just how many

A cancellation records a reason from the practice's own list, and each reason is marked as falling on the family's side or the practice's side. The risk score stops blaming families for a technician's sick day.

- A reason is required whenever a status counts as a cancellation; moving the session back to a live status clears it, and Undo restores it.
- **Cancellation Root Cause report:** hours lost, share, side, and the weekday and time band each reason clusters on.
- **Explainable no-show risk:** per-client and day/time patterns fitted on the practice's own history, plus labelled policy factors. Every factor shows whether it came from the data or from policy.
- Confirming an at-risk session is a local, undoable status change. No reminder is sent.

### Intake: turn a referral into a client chart without retyping it

Intake is a pipeline with gates, not a status field. Each stage asks for exactly what the next team needs, and conversion creates the client chart in one step.

- **Eleven stages:** new referral, contact, screening, benefits, clinical review, waitlist or scheduled, assessment, authorization and conversion, plus a closed state that requires a reason. Every move is one Undo.
- **Every blocker has a Fix button** that opens the tab or form where the missing item is recorded, and a first call needs only the essentials (name, date of birth, office, a phone, guardian contact and an owner).
- **Gates that hold:** screening needs the essentials, benefits needs payer and member details, review needs a completed verification of benefits, scheduling needs a real appointment on the calendar, and conversion needs an authorization decision, documents, consents and a verified guardian.
- **Conversion creates the chart**, re-points the booked assessment to it and opens the new client's profile; the roster links back to the originating request.
- **Paperwork in one click.** Download a blank intake packet for families (fill-in fields, the documents to bring, a signature line for each consent) or a PDF summary of any request. Both are generated on your computer; nothing is sent.
- **Nothing is retyped at conversion.** The chart receives the payer's approved units as its authorization pool, plus the member ID, the authorization number and the diagnosis. Claims then print the real member ID and authorization number.
- **Referral Sources register** with owner, dormancy threshold and live volume, conversion and days-to-assessment figures.
- Intake KPIs on the dashboard, in Analytics and in the *Intake Pipeline & Referral Conversion* report.

### Billing, claims and CMS-1500: claims that are checked before they leave your desk

Completed sessions become claim-ready lines and are grouped into claims. Submission gates run the same validation rules as the rest of the app, so a claim with a problem is held with the reason attached.

- **Submission gates** for timely filing, rendering-provider credentials and payer provider-ID rules. Held claims show the specific fix.
- **Provider ID rule per payer:** NPI, Medicaid ID or both. It drives the appointment validation, the claim gate and the CMS-1500 boxes (23b, 33a, 33b), and a readiness line names who cannot yet be billed under it.
- **Medicaid unit norms by default.** The ABA codes bill per 15 minutes under the midpoint rule, and the booking dialog, Quick Add and the claim all count units with the payer's own rule, so the authorization pool and the claim agree.
- **Modifiers on every line, from the payer's settings.** Each insurance claim line carries up to four modifiers: the payer's service modifier, the rendering provider's credential modifier (HO, HN, HM, HP), the payer's qualification modifier for that clinician's education level (first matching row; blanks add nothing) and the payer's place-of-service modifier. The credential modifier can be switched off per payer, and the staff record's education level is optional — the payer panel reports anyone missing one instead of guessing.
- **Same-day merge and claim splitting.** By default, same-day sessions for one client, code and rendering provider become one line with their minutes added up and rounded once, the Medicaid way. A payer can turn that off, or ask for separate claims by rendering provider or place of service.
- **CMS-1500 (02/12) PDF:** a printable facsimile with the form's drop-out red captions and black data, generated from the same field mapping the claim uses. Program, group number, plan ID, other-coverage and service-facility boxes read the payer and client records, and a blank value prints as a dash rather than an invented one. It is a PDF you print; some boxes, such as the member and authorization numbers, are still placeholders in this prototype.
- **Denials, rebills and appeals:** record a denial with a reason and next step from the practice's own list, void and rebill with disputed lines returned to staging, and start appeal letters from templates. An appeal is a mark on the claim, not a new status: a win re-opens the claim awaiting the payer's payment, and the money is posted when it actually arrives.
- **Secondary (COB) queue:** prepares a claim-level COB draft from the primary's remaining balance and records an external filing locally. It does not generate or send a secondary claim.

### ERA posting, payments and recoupments: post what the remittance says, and nothing it doesn't

Load a local 835 file and see each claim match, amount and adjustment before anything posts. Lines that don't match exactly are parked with a reason; they are never guessed onto a claim.

- **835 ERA import** reads a strict claim-level subset of X12: CLP claim matches, allowed amounts, CARC adjustments and reasons for held lines. Nothing posts until you select lines and confirm.
- **Posting rechecks the live ledger:** draft, void and already-paid claims, ambiguous claim numbers, duplicates, overpayments and malformed amounts cannot auto-post. Provider-level PLB is flagged and never applied to a claim.
- **Recoupments** record a payer taking money back on a paid primary claim: the amount (never more than was paid), reason, method and the payer's reference. The balance reopens, the original remittance stays on file, and it is one Undo.
- **Patient receipts** apply to one claim, are capped at the patient share the payer actually reported, and are reversed with a signed local reversal. Payment Center exports a patient audit CSV.
- Payments, denials and the ERA audit record from one import are a single undoable transaction.

### A/R: a receivable you can trust, split the way it is owed

A/R Manager counts each dollar once. Insurance balances and the patient share the payer actually reported sit in separate buckets, and an unknown remainder is never treated as family debt.

- Aging by client or by payer: current, 31–60, 61–90, 91–120 and 121+ days, with an over-90 KPI.
- Patient share is capped at the open primary balance and held while a secondary filing is still pending.
- **Record receipt** directly from a client's claim, and download a clearly marked draft patient-share statement.
- **One inbox for what needs you.** Your overdue tasks, expiring documents and authorizations, late intake requests and denied claims are in one list, each one click from where you fix it. Assign tasks to anyone on the team. All in your workspace; nothing is emailed or texted.
- **Never miss an expiry.** The Cabinet tracks every credential, license, background check, CPR card, insurance policy and consent that expires. Anything expired or due within 30 days shows on the Staff menu. Only the details are recorded; your files stay where you keep them.
- **Client statements with a history.** Issue a numbered statement, download it as a PDF, and record how you delivered it. Its balance updates as the family pays. You deliver it; the app never mails or emails anything.
- **Your payment link on every statement.** Save your own online payment link (a Stripe Payment Link, for example) and statements with a balance print it. Families pay through your processor; you record the receipt, and the app never touches a card.
- CSV export of the aging view.

### Payroll: pay the way an ABA practice actually works

Each paid duty is priced on its own, overtime is tested by workweek, and approval takes a second person. The engine is built around session-delivery pay, not hours × rate.

- **Separate earning codes** for direct treatment, supervision, drive time, documentation, training and cancelled-session pay, all editable in Settings.
- **FLSA-aware overtime:** the workweek test, the regular-rate rule for nondiscretionary additions, and a 1.5× overtime floor the settings will not go below.
- **Cancellation pay by policy:** a decision table for notice bands and late cancellations.
- **Guided four-phase run:** select period, review the register with blocker and exception gates, approve, then process. Approval is refused if the person who prepared the run tries to approve it.
- **Exports are files you hand off:** payroll register (XLS/PDF), a QuickBooks-oriented earnings import, a GL journal, printable pay stubs and a NACHA-shaped direct-deposit draft labelled as a draft. Gross-to-net figures are estimates and say so.

### Dashboard and reports: the numbers behind every decision, one click away

A configurable dashboard and a report library share one metrics engine, so the same figure reads the same everywhere it appears.

- **Dashboard widgets:** Practice Pulse, Volume Trend, Mix, Top Breakdown, Appointment Ledger, Week Heatmap, Intake Pipeline and Billing Health. Each one exports the data behind it.
- **Billing Health:** clean claim rate, denial rate, net collection rate, cash posted, days in A/R, A/R over 90 days, charge lag and recoupments. Each shows its formula and target on hover, plus a delta against the previous period.
- **19 reports** across Operations, Clinical & Compliance, Billing & Claims, People & Payroll and Data Quality. Examples: Authorization Utilization, Staff Utilization vs Target, Claims Register, BCBA Supervision Coverage and Behavior-Analytic Hours.
- **Authorization Utilization:** used, scheduled and remaining units per client and code over the authorization's own window, with a renewal flag at 30 days left or 75% committed.
- Exports to CSV, styled Excel and PDF, each stamped with when it was generated, the date range and the scope.

### Settings and payer rules: configure the practice without filing a ticket

Thirteen settings modules hold the practice's own rules. Masters are edited in one place and read everywhere, and changes that would break existing records are refused.

- **Payer billing rules:** provider-ID rule, MUE daily limits, per-code weekly limits, unit size and rounding overrides per service, qualification modifiers keyed to staff education levels, place-of-service modifiers, the credential-modifier switch, merge-same-day and separate-claim-by rules, and the CMS type, group and plan identifiers the CMS-1500 prints.
- **Denial reasons and remittance code hints** are the practice's own lists: add a payer's denial reason or explain a new adjustment code in Settings, no code change needed.
- **Payment Terms per payer:** payer kind, expected days to pay, estimated payer share, copay and filing deadline. Claim aging, copay estimates, payment presets and timely filing read them, and each save is validated and undoable.
- **Guarded changes:** office names must be unique, an office still in use can't be deleted until its records are moved, a renamed office updates every record that uses it, and a status with appointments on it must be reassigned before removal.
- **Appointment status, custom lists, custom fields, qualifications, services and earning codes**, each a single master.
- **CSV data import** for clients, staff, appointments and other masters: columns map automatically, every row is validated, duplicates are detected, a clean preview is required, and the commit is all-or-nothing. Nothing is uploaded.
- **Help & Wiki inside the app:** every workflow, screen guide and FAQ answer, searchable from the navigation rail and updated with each release.
- **ABA Hours tracking** for behavior-analytic time on non-service appointments, tallied by credential track against targets the practice sets.

### Security, Undo and backup: mistakes are one keystroke from fixed

Every financial or compound change is one reducer transaction, so one Undo reverses all of it. The whole workspace exports to a versioned file you can inspect before you restore it.

- **One action, one Undo:** claim submissions with their files, ERA postings, recoupments, intake conversions and most settings changes each reverse in one step (25 steps, kept in the open tab).
- **Versioned backup and restore (JSON):** covers ledgers, masters, settings, saved reports and dashboards. Import validates the file and previews its counts before you confirm the replace.
- **Roles and office scoping:** role templates, per-area permission levels, office-scoped access and an audit trail, with at least one active administrator always kept. These are local access controls, not authentication, and the app says so.
- **Storage-failure warning:** if the browser refuses a save, an on-screen alert says your edits are in memory only and points you to an immediate export.

---

## Why practices trust it

**Guards over warnings.** Invalid financial and configuration states are refused, not just flagged: an overpayment, a recoupment larger than the payment, an office that records still depend on, an overtime multiplier below 1.5×. Scheduling is different on purpose. Booking guards default to *warn*, because the scheduler knows the family, and *stop* is a setting the practice chooses for itself.

**One action, one Undo.** A claim batch and its billed-file record, an ERA's payments and denials, a conversion that creates a chart and moves an appointment: each is one transaction, and one Undo puts every part of it back. Nothing is left half-applied.

**Honest software.** The interface states exactly what happened on your machine. Generating a billed file is not transmitting it. Confirming a session is not texting the family. Recording an external COB filing is not filing it. Where a real connection would need a backend, the app says so instead of pretending.

**Built for the whole practice.** Schedulers, billing staff, clinicians and owners each find their own work (calendar, payment center, intake requests they own, dashboards) without wading through another role's screens.

**Fictional data, real rules.** The demo ships with an invented practice, so you can explore every workflow safely. Do not enter real client information. The production path (backend, authentication, hosting, compliance) is still open, and the copy will say so until it is chosen.

---

## Short-form assets

### 50-word description

Aloha ABA is a practice suite for ABA providers that brings scheduling, intake, claims, ERA posting, A/R and payroll into one workspace. Bookings are checked against authorizations and payer rules, invalid financial states are refused, and every financial change reverses with one Undo. A local-first prototype that runs on fictional data.

### 25-word description

One workspace for ABA scheduling, intake, billing and payroll. Every change is checked against live authorizations and ledgers, and reverses with a single Undo.

### Social posts

1. Authorization problems are cheapest to fix before the session is booked. Aloha ABA shows remaining units, payer daily and weekly limits, and the projected exhaustion date in the booking dialog, not in next month's denial report.

2. "12% cancellations" tells you nothing. "Most of these are transport, and they cluster on Fridays" tells you what to do. Aloha ABA records a reason on every cancellation and rolls them up by side, weekday and time of day.

3. An ERA line that doesn't match a claim exactly shouldn't be posted on a guess. Aloha ABA parks it with the reason and posts only what you select and confirm, as one undoable step.

4. Payroll for ABA is not hours × rate. Drive time, supervision, documentation and late-cancel pay each get their own earning code; overtime is a workweek test; and the person who prepared the run can't approve it.

5. Our rule for every screen: say exactly what happened. Aloha ABA generates files, prepares drafts and records what you did elsewhere. It never claims to have sent anything, because it doesn't.

### Elevator pitch

ABA practices lose money in the gaps between tools: a session booked past its authorization, a claim missing the provider ID the payer wants, a remittance posted to the wrong claim. Aloha ABA puts scheduling, intake, billing, payments, A/R and payroll in one workspace and runs the checks at the moment of the decision. The booking dialog shows unit usage and payer limits before you save. Claims are held with the specific fix. ERA lines post only on an exact match. Every claim, payment and posting reverses with one Undo. It is a working, local-first prototype on fictional data, built to grow into a production system, and it never claims to have done something it hasn't.

---

## Source map

When a file in the right-hand column changes, re-check the copy in the matching section.

| Section | Backing files |
|---|---|
| Positioning, Tagline, Hero | `PRODUCT.md` (Positioning, Product Principles, Capabilities and Constraints), `AGENTS.md` (Non-negotiables) |
| Scheduling & scheduling intelligence | `src/lib/authBudget.js`, `src/lib/authUnits.js`, `src/lib/bookingChecks.js`, `src/lib/insights.js`, `src/lib/smart.js`, `src/lib/model.js` (unit table, `unitsFor`), `src/lib/travel.js` (travel feasibility), `src/components/AppointmentModal.jsx`, `src/components/QuickAdd.jsx`, `src/components/BookingChecks.jsx`, `src/components/SchedulerInsights.jsx`, `src/components/TimelineView.jsx`, `src/components/MonthView.jsx`, `src/components/AgendaView.jsx`, `src/components/NeedsCover.jsx`, `src/components/CommandPalette.jsx`, `src/lib/settingsMasters.js` (`telehealthRoomFor`, `staff.travel`), `src/lib/ics.js` (`staffCalendar`), `src/components/StaffView.jsx`, `docs/specs/scheduling-intelligence-ideas.md` (status column) |
| Cancellations | `src/lib/cancelReasons.js`, `src/lib/risk.js`, `src/lib/reports.js` (Cancellation Root Cause), `src/components/SchedulerInsights.jsx` |
| Intake | `src/lib/intake.js`, `src/lib/intakeDocs.js` (packet and summary PDFs), `src/components/intake/*`, `src/lib/dash.js` (Intake Pipeline widget), `src/lib/reports.js` (Intake Pipeline & Referral Conversion) |
| Billing, claims & CMS-1500 | `src/lib/claims.js` (`lineModifiers`, `mergeSameDayLines`, `posFor`), `src/lib/authUnits.js` (`unitRuleFor`), `src/lib/providerIds.js`, `src/lib/cms1500.js`, `src/components/BillingView.jsx`, `src/components/AppealsView.jsx`, `src/components/SecondaryBillingView.jsx`, `src/lib/secondaryLedger.js`, `src/components/ProviderIdView.jsx` |
| ERA posting, payments & recoupments | `src/lib/era.js`, `src/lib/eraPosting.js`, `src/lib/paymentLedger.js` (`planRecoupment`, patient receipts), `src/components/PaymentCenterView.jsx` |
| A/R | `src/components/ArManagerView.jsx`, `src/components/GenerateInvoiceView.jsx`, `src/lib/claims.js` (AR engine), `src/lib/statements.js` (client statements), `src/lib/settingsMasters.js` (`paymentLinkFor`), `src/lib/billingDocs.js` |
| Payroll | `src/lib/payroll.js`, `src/lib/payrollExport.js`, `src/components/payroll/*`, `src/lib/settingsMasters.js` (earning codes, overtime floor) |
| Dashboard & reports | `src/lib/dash.js` (`WIDGETS`), `src/lib/billingKpis.js`, `src/lib/reports.js`, `src/lib/analytics.js`, `src/lib/exportKit.js`, `src/components/DashboardView.jsx`, `src/components/ReportsView.jsx`, `src/components/AnalyticsView.jsx` |
| Settings & payer rules | `src/lib/settingsMasters.js` (`planSettingsOp`), `src/lib/dataImport.js`, `src/lib/abaHours.js`, `src/components/settings/*`, `src/components/PayerDetail.jsx`, `src/lib/master.js` (payer rule defaults, POS codes), `src/components/MastersView.jsx`, `src/components/SettingsModal.jsx` |
| Help & Wiki (Settings section bullet) | `src/components/HelpView.jsx`, `src/lib/wiki.js`, `docs/wiki/*` |
| Security, Undo & backup | `src/state/store.jsx` (reducer, Undo, persistence), `src/lib/security.js`, `src/components/SecurityView.jsx`, `src/lib/workspaceBackup.js` |
| Why practices trust it | `PRODUCT.md` (Product Principles), `AGENTS.md` (Non-negotiables 2–4), `src/lib/security.js` (`authorizeAction`) |
| Short-form assets | Derived from the sections above; refresh whenever any of them changes |
| Honesty limits (all sections) | `README.md` ("Current development context"), `docs/HANDOFF.md` (Shipped; Known issues / backlog) |
