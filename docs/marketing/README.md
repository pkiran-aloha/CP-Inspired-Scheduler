# Aloha ABA Practice Suite — marketing copy

_Last synced with main at a1e8cdd on 2026-10-04._

Every claim on this page maps to shipped code (see the [Source map](#source-map)). Ground rules for anyone editing it: the app is a local-first prototype with no backend, nothing it does leaves the browser, the bundled data is fictional, and there are no customers, metrics or testimonials to quote. Words to use: *generates, prepares, records, exports, posts locally*. Words never to use: *sends, submits to the payer, syncs, connects, compliant, certified*.

---

## Positioning

**For** ABA practices whose admins, schedulers, billing staff, clinicians and owners currently stitch the day together from a calendar, a spreadsheet of authorizations, a billing tool and a payroll export,

**who** lose revenue when sessions are booked past an authorization, when claims leave with missing provider IDs, and when a remittance is posted to the wrong claim,

**Aloha ABA** is one practice workspace (scheduling, intake, billing, payments, A/R, payroll, reporting and settings) that checks each change against the live state of the practice before it is saved.

**Unlike** tools that flag a problem in a report after the money is gone, Aloha ABA puts the check at the moment of the decision. It refuses invalid financial states outright, it reverses any compound change with a single Undo, and it never claims to have sent something it did not send.

**Today** it is a working, local-first prototype that runs entirely in the browser on fictional data. The plan is to grow it into a production application.

### Tagline

**Every change checked. Every change reversible.**

Alternates:

- The practice suite that checks before it saves.
- Run the whole ABA practice from one honest workspace.

---

## Hero

### Headline

Book, bill and pay with the checks built in.

### Subhead

Aloha ABA brings scheduling, intake, claims, ERA posting, A/R and payroll into one workspace. Each change is validated against your authorizations, payer rules and ledgers before it is saved, and each one comes back with a single Undo.

### Primary call to action

**Open the live demo**: it runs in your browser, with fictional practice data and nothing to install.

Secondary: *See what's checked before you save* (links to "Why practices trust it").

---

## Features

### Scheduling and scheduling intelligence: see the authorization before you book the session

The calendar shows what a booking will do to the client's authorization, the payer's limits and the family's attendance pattern before the session is saved. Your schedulers decide with the numbers in front of them, not after the claim comes back.

- **Book-time authorization guard.** Shows committed and remaining hours, the weekly pace against the authorized week, days to expiry and a projected exhaustion date. Off, flag, warn or stop, chosen by the practice; the default is warn.
- **Per-code unit ledger with payer rules.** Authorizations carry unit pools per CPT code. Minutes convert to units by the payer's own unit size and rounding (AMA 8-minute rule by default), and daily MUE limits, weekly per-code limits and credential rules are checked at booking.
- **Know before you pick.** Every staff member and client in the booking pickers carries a verdict chip, and one Checks panel in the dialog shows every issue in a shared severity language.
- **Scheduler Insights panel.** Fill against an 85–95% band, a weekday × hour coverage heat grid, named idle windows per clinician, an authorization burn-down and an at-risk session worklist.
- **Five calendar views:** day, week, month, agenda and timeline, with drag-to-move and resize, a backfill inbox for cancelled sessions a qualified colleague could cover, and a Cmd/Ctrl+K command palette.

### Cancellations: know why sessions are lost, not just how many

A cancellation records a reason from the practice's own list, and each reason is marked as falling on the family's side or the practice's side. The risk score stops blaming families for a technician's sick day.

- A reason is required whenever a status counts as a cancellation; moving the session back to a live status clears it, and Undo restores it.
- **Cancellation Root Cause report:** hours lost, share, side, and the weekday and time band each reason clusters on.
- **Explainable no-show risk:** per-client and day/time patterns fitted on the practice's own history, plus labelled policy factors. Every factor shows whether it came from the data or from policy.
- Confirming an at-risk session is a local, undoable status change. No reminder is sent.

### Intake: turn a referral into a client chart without retyping it

Intake is a pipeline with gates, not a status field. Each stage asks for exactly what the next team needs, and conversion creates the client chart in one step.

- **Eleven stages:** new referral, contact, screening, benefits, clinical review, waitlist or scheduled, assessment, authorization and conversion, plus a closed state that requires a reason. Every move is one Undo.
- **Gates that hold:** screening needs the essentials, benefits needs payer and member details, review needs a completed verification of benefits, scheduling needs a real appointment on the calendar, and conversion needs an authorization decision, documents, consents and a verified guardian.
- **Conversion creates the chart** and re-points the booked assessment to it, and the roster links back to the originating request.
- **Referral Sources register** with owner, dormancy threshold and live volume, conversion and days-to-assessment figures.
- Intake KPIs on the dashboard, in Analytics and in the *Intake Pipeline & Referral Conversion* report.

### Billing, claims and CMS-1500: claims that are checked before they leave your desk

Completed sessions become claim-ready lines and are grouped into claims. Submission gates run the same validation rules as the rest of the app, so a claim with a problem is held with the reason attached.

- **Submission gates** for timely filing, rendering-provider credentials and payer provider-ID rules. Held claims show the specific fix.
- **Provider ID rule per payer:** NPI, Medicaid ID or both. It drives the appointment validation, the claim gate and the CMS-1500 boxes (23b, 33a, 33b), and a readiness line names who cannot yet be billed under it.
- **CMS-1500 (02/12) PDF:** a printable facsimile with the form's drop-out red captions and black data, generated from the same field mapping the claim uses.
- **Denials, rebills and appeals:** record a denial with its reason and suggested fix, void and rebill with disputed lines returned to staging, and start appeal letters from templates.
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

Thirteen settings modules hold the practice's own rules, and each write is checked before it is saved. Masters are edited in one place and read everywhere.

- **Payer billing rules:** provider-ID rule, MUE daily limits, per-code weekly limits, unit size and rounding overrides per service.
- **Guarded changes:** office names must be unique, an office still in use can't be deleted until its records are moved, a renamed office updates every record that uses it, and a status with appointments on it must be reassigned before removal.
- **Appointment status, custom lists, custom fields, qualifications, services and earning codes**, each a single master.
- **CSV data import** for clients, staff and appointments: columns map automatically, every row is validated, duplicates are detected, a clean preview is required, and the commit is all-or-nothing. Nothing is uploaded.
- **ABA Hours tracking** for behavior-analytic time on non-service appointments, tallied by credential track against targets the practice sets.

### Security, Undo and backup: mistakes are one keystroke from fixed

Every financial or compound change is one reducer transaction, so one Undo reverses all of it. The whole workspace exports to a versioned file you can inspect before you restore it.

- **One action, one Undo:** claim submissions with their files, ERA postings, recoupments, intake conversions and settings changes each reverse in one step (25 steps, kept in the open tab).
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

Aloha ABA is a practice suite for ABA providers that brings scheduling, intake, claims, ERA posting, A/R and payroll into one workspace. Bookings are checked against authorizations and payer rules, invalid financial states are refused, and every compound change reverses with one Undo. A local-first prototype that runs on fictional data.

### 25-word description

One workspace for ABA scheduling, intake, billing and payroll. Every change is checked against live authorizations and ledgers, and reverses with a single Undo.

### Social posts

1. Authorization problems are cheapest to fix before the session is booked. Aloha ABA shows remaining units, payer daily and weekly limits, and the projected exhaustion date in the booking dialog, not in next month's denial report.

2. "12% cancellations" tells you nothing. "Most of these are transport, and they cluster on Fridays" tells you what to do. Aloha ABA records a reason on every cancellation and rolls them up by side, weekday and time of day.

3. An ERA line that doesn't match a claim exactly shouldn't be posted on a guess. Aloha ABA parks it with the reason and posts only what you select and confirm, as one undoable step.

4. Payroll for ABA is not hours × rate. Drive time, supervision, documentation and late-cancel pay each get their own earning code; overtime is a workweek test; and the person who prepared the run can't approve it.

5. Our rule for every screen: say exactly what happened. Aloha ABA generates files, prepares drafts and records what you did elsewhere. It never claims to have sent anything, because it doesn't.

### Elevator pitch

ABA practices lose money in the gaps between tools: a session booked past its authorization, a claim missing the provider ID the payer wants, a remittance posted to the wrong claim. Aloha ABA puts scheduling, intake, billing, payments, A/R and payroll in one workspace and runs the checks at the moment of the decision. The booking dialog shows unit usage and payer limits before you save. Claims are held with the specific fix. ERA lines post only on an exact match. Every compound change reverses with one Undo. It is a working, local-first prototype on fictional data, built to grow into a production system, and it never claims to have done something it hasn't.

---

## Source map

When a file in the right-hand column changes, re-check the copy in the matching section.

| Section | Backing files |
|---|---|
| Positioning, Tagline, Hero | `PRODUCT.md` (Positioning, Product Principles, Capabilities and Constraints), `AGENTS.md` (Non-negotiables) |
| Scheduling & scheduling intelligence | `src/lib/authBudget.js`, `src/lib/authUnits.js`, `src/lib/bookingChecks.js`, `src/lib/insights.js`, `src/lib/smart.js`, `src/components/AppointmentModal.jsx`, `src/components/BookingChecks.jsx`, `src/components/SchedulerInsights.jsx`, `src/components/TimelineView.jsx`, `src/components/MonthView.jsx`, `src/components/AgendaView.jsx`, `src/components/NeedsCover.jsx`, `src/components/CommandPalette.jsx`, `docs/specs/scheduling-intelligence-ideas.md` (status column) |
| Cancellations | `src/lib/cancelReasons.js`, `src/lib/risk.js`, `src/lib/reports.js` (Cancellation Root Cause), `src/components/SchedulerInsights.jsx` |
| Intake | `src/lib/intake.js`, `src/components/intake/*`, `src/lib/dash.js` (Intake Pipeline widget), `src/lib/reports.js` (Intake Pipeline & Referral Conversion) |
| Billing, claims & CMS-1500 | `src/lib/claims.js`, `src/lib/providerIds.js`, `src/lib/cms1500.js`, `src/components/BillingView.jsx`, `src/components/AppealsView.jsx`, `src/components/SecondaryBillingView.jsx`, `src/lib/secondaryLedger.js`, `src/components/ProviderIdView.jsx` |
| ERA posting, payments & recoupments | `src/lib/era.js`, `src/lib/eraPosting.js`, `src/lib/paymentLedger.js` (`planRecoupment`, patient receipts), `src/components/PaymentCenterView.jsx` |
| A/R | `src/components/ArManagerView.jsx`, `src/lib/claims.js` (AR engine), `src/lib/billingDocs.js` (statements) |
| Payroll | `src/lib/payroll.js`, `src/lib/payrollExport.js`, `src/components/payroll/*`, `src/lib/settingsMasters.js` (earning codes, overtime floor) |
| Dashboard & reports | `src/lib/dash.js` (`WIDGETS`), `src/lib/billingKpis.js`, `src/lib/reports.js`, `src/lib/analytics.js`, `src/lib/exportKit.js`, `src/components/DashboardView.jsx`, `src/components/ReportsView.jsx`, `src/components/AnalyticsView.jsx` |
| Settings & payer rules | `src/lib/settingsMasters.js` (`planSettingsOp`), `src/lib/dataImport.js`, `src/lib/abaHours.js`, `src/components/settings/*`, `src/components/PayerDetail.jsx`, `src/components/SettingsModal.jsx` |
| Security, Undo & backup | `src/state/store.jsx` (reducer, Undo, persistence), `src/lib/security.js`, `src/components/SecurityView.jsx`, `src/lib/workspaceBackup.js` |
| Why practices trust it | `PRODUCT.md` (Product Principles), `AGENTS.md` (Non-negotiables 2–4), `src/lib/security.js` (`authorizeAction`) |
| Short-form assets | Derived from the sections above; refresh whenever any of them changes |
| Honesty limits (all sections) | `README.md` ("Current development context"), `docs/HANDOFF.md` (Shipped; Known issues / backlog) |
