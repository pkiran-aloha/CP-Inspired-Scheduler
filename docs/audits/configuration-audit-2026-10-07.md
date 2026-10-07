# Cross-module configuration audit — 2026-10-07

**Status:** source-trace audit complete; remediation has started. CFG-01 has a local credential-capture mitigation, and CFG-02 has a first control/evaluator-alignment slice on the current work branch. The CFG-01 production architecture gate and remaining CFG-02 enforcement gaps, along with the other findings, remain open.

## Executive result

Configuration is **partially, not consistently, wired through** Aloha ABA. Several core paths are real: appointment status/payroll/billing rules, payer service rates and units, provider identifiers, claim modifiers, MUE/concurrent checks, and weekly payroll overtime have downstream consumers. But a number of controls are either no-ops, apply only in one screen, use mismatched keys, or are not evaluated for every write path. Some UI copy promises stronger enforcement than the code provides.

This remains a local-first prototype, not a production system. Do not enter real PHI or live integration secrets, and do not use the current payroll or claim outputs as production calculations/filings. That boundary is already stated in `PRODUCT.md` and the settings wiki; this audit records the implementation evidence and issues to track.

## What is wired today

| Area | Observed downstream use | Assessment |
|---|---|---|
| Appointment statuses | Active status choices and labels/colors flow into calendar views; cancellation settings affect conflict checks; `pays` affects payroll and `billable` affects claim staging; `noteRequired` and `allowToComplete` are checked in appointment/verification UI. | Mostly wired, but UI-only enforcement can be bypassed by alternate writes (CFG-02). |
| Payer/service billing rules | Service and payer unit length, rounding, rates, credential requirements, concurrent-billing rules, provider-ID requirements, claim modifiers, POS modifiers, MUEs, and payment terms are read by booking, claims, CMS-1500, and billing views. | Substantial working coverage; not every Claims Settings field is implemented (CFG-06). |
| Authorization / appointment rules | Authorization hours and units, payer MUEs, travel, overlaps, assignment, and ABA-hours rules are evaluated in the booking dialog; intake handoff and some scheduling-intelligence paths also call the evaluator. | Partial coverage; not a single write-time invariant (CFG-02, CFG-03). |
| Payroll | Weekly overtime threshold/multiplier, office-specific weekly threshold, earning-code eligibility, cancellation pay, and payroll rounding feed payroll calculations. | Weekly rules work; daily/double-time/seventh-day controls do not price wages (CFG-05). |
| Local integration/reference rows | Telehealth room links can appear on appointments/ICS exports; a payment link can print on statements; calendar and QuickBooks rows represent local exports. | Honest local/reference use only; no live network integration. The System Settings clinical table is independently empty (CFG-10). |

## Findings register

### CFG-01 — **P0 / production blocker: browser-local data and credentials are not production-safe**

- `PRODUCT.md` says workspace data is in browser `localStorage`, there is no backend/authentication yet, and real PHI must not be entered. `src/state/store.jsx` persists the workspace locally; `src/lib/workspaceBackup.js` includes the full `settings` object in a plain JSON backup (recognized integration credential fields are now filtered; see the local mitigation below).
- At audit time, the Integrations editor exposed API-key/token fields for non-reference rows (`src/components/settings/panels-extras.jsx`) and those values could be saved in workspace settings and backups. Nothing connected to a partner, but the UI invited entry of secrets without a server-side vault or protection. The input and persistence paths are now mitigated as detailed below.
- MFA, screen-lock, and auto-logout preferences are saved, but there is no sign-in/lock screen enforcing them (`src/components/settings/SystemPanel.jsx`; `docs/wiki/architecture.md` and `docs/wiki/settings.md` also record this).

**Local mitigation started 2026-10-07:** the Integrations editor no longer offers API-key/token inputs; the settings planner rejects recognized credential fields; existing integration credential fields are stripped on workspace normalization, direct settings writes and browser serialization; and plain JSON backup export/import strips them. This prevents the supported integration-settings paths from inviting or retaining those fields, but is **not** a vault or a security boundary: browser storage remains readable and users can still put arbitrary text elsewhere.

**Resolution gate remains open:** choose and implement the production hosting/data/auth/HIPAA architecture; enforce MFA/session controls there; use a server-side secret store for any future live integrations. Until then, continue to block real PHI and live credentials.

### CFG-02 — **P1 / high: Appointment Validation severity contract and write coverage do not match the settings UI**

- The Validations panel says **Warn requires acknowledgement** and **Flag badges the session** (`src/components/settings/SystemPanel.jsx`). In the booking modal, warnings are displayed in the Checks rail but there is no acknowledgement state or save gate; only stop items are added to `errors` (`src/components/AppointmentModal.jsx`). Validation flags are rendered for the draft but are not saved to the appointment, so they do not become a persistent session badge.
- The evaluator is not a central reducer/write guard. `QuickAdd.jsx` calls `actions.create` directly; calendar/timeline drag handlers call `actions.move`; appointment import plans rows without calling `evaluateAppointmentValidations`. A Stop configured in Settings can therefore be missed by those paths. Intake handoff and density-planning do call checks, so coverage is uneven rather than absent everywhere.
- At audit time there were rule-key/meaning mismatches: the panel edited `client.clientAssignment`, while the evaluator emitted `client.assignment`; `staff.travel` was evaluated and defaulted to Warn but had no visible control; and `staff.serviceProvider` was emitted only alongside a qualification failure rather than enforcing the panel hint about an assigned rendering provider. The current remediation aligns the Client Assignment control with `client.assignment` (and migrates legacy `clientAssignment` settings), exposes the `staff.travel` severity control, and evaluates rendering-provider presence separately from qualification.

**Remediation status (2026-10-07):** the control/evaluator-key and rule-meaning slice is implemented locally and has focused regression tests added. CFG-02 remains open: Stop is not yet a centralized write-time invariant across every create/update/move/import/series path; Warn acknowledgement and persistent/derived Flag badges are not implemented. Add direct coverage for Quick Add, drag, import and series writes, then rerun the full suite/build before marking the finding resolved.

### CFG-03 — **P1 / high: recurring appointments validate only the first occurrence**

`AppointmentModal` computes `valReport` and the authorization checks for the current form date. On create, it builds all `seriesDatesFor(...)` drafts and then checks only `clashFor(...)` per later date (`src/components/AppointmentModal.jsx`). Series rebuilds and multi-occurrence edits similarly perform clash filtering without re-evaluating every configured validation or authorization/unit rule for each date.

A series can therefore pass because its first date is valid while later dates fall outside an authorization window, exceed a unit/MUE limit, violate staff availability/travel/assignment, or fail another configured rule. The current loop also does not add earlier planned occurrences to a cumulative validation state.

**Resolution:** validate each occurrence against live state plus already accepted occurrences, and report which dates were rejected and why. Apply the same logic to series edits/rebuilds.

### CFG-04 — **P1 / high: staff and client signature rules are conflated, bypassable, and have a null-payer crash path**

- Payer settings say **Client Signature required** (`PayerDetail.jsx`), but the shared verification `SignaturePad` captures staff identity/certification and the appointment passes the verifier/assigned staff to it (`src/ui/SignaturePad.jsx`, `AppointmentModal.jsx`). The same `f.verification.signature` boolean satisfies both the payer rule and the system “staff signature” rule; there is no separate client/guardian signature record.
- Calendar **Quick verify + sign** creates a staff signature and can set status to Completed after checking `allowToComplete`, but does not check the payer’s signature-required rule (`src/components/DetailCard.jsx`). This can bypass the modal’s signature gate.
- The system default is `general.staffSigRequiredToComplete: false`, while the Settings control reads/writes `general.staffSignatureRequired` and treats a missing key as on. A fresh workspace can therefore display the toggle as enabled while the default effective check is false.
- If the system-level signature requirement is enabled for a booking with no payer, the Verification note renders `billPayer.name` without a null check (`AppointmentModal.jsx`). The save toast uses optional chaining, but the note does not.

**Resolution:** define distinct client/guardian and staff verification signatures, apply payer/system requirements on every completion path (including Quick Verify), use one canonical system key/default, and render a safe fallback when there is no payer. Add payerless and quick-verify regression tests.

### CFG-05 — **P1 / high: daily, double-time, and seventh-day payroll controls do not affect wage calculations**

The Payroll settings editor exposes global daily OT/double-time and per-office daily, double-time, weekly, and seventh-day thresholds (`src/components/settings/PayrollPanel.jsx`). `earningsFor()` in `src/lib/payroll.js` reads the office-specific **weekly** threshold or global weekly threshold and calculates weekly overtime; it does not read the daily or seventh-day thresholds, daily OT switch/multiplier, double-time hours, or the earning-code `doubleTime` flag. The Payroll panel itself says daily rules are saved as a policy note, not priced. Payroll rounding is applied and is **not** a finding.

**Resolution:** implement and test the applicable jurisdictional daily/double/seventh-day rules, or remove/clearly mark the controls as informational. Do not rely on these controls for actual payroll until the calculator and legal review cover them.

### CFG-06 — **P1 / high: several payer Claims Settings options are stored but ignored by claim output**

Working examples include same-day merging, credential modifiers, Box 32 behavior, supported claim split keys, POS modifiers, and provider-ID rules. However, `box17`, `box19`, `box33B`, `box33B2`, claim-file grouping, appointment time, `renderProvider`, `renderTaxo`, and `billTaxo` are exposed in `PayerDetail.jsx` but have no downstream readers in claim assembly/CMS-1500 code. `separateBy: Supervising Provider` returns no key because appointments do not record a supervisor (`src/lib/claims.js`). POS `hideTeleOther`/`hideTeleHome` are saved but do not filter appointment locations.

The existing settings wiki already records most claim-field no-ops; the cross-module trace confirms that selecting them does not change the generated output. The app also has no live clearinghouse/837 transmission, so “file options” are not operational today.

**Resolution:** implement the output behavior and required source data, or remove/disable each unsupported control and label it as not available. Add golden claim/CMS-1500 tests proving each visible option changes the intended output.

### CFG-07 — **P1 / high: custom-field scope, type, required, and payer/export contracts are incomplete**

- The template editor stores `assignedTo` scopes, and `customFieldsForScope()` exists, but no operational component calls that helper. The appointment picker filters only by active status and offers every template; the payer picker also iterates every template. Client-, authorization-, or staff-scoped templates can therefore appear in unrelated pickers.
- `textarea` is a defined type but the appointment renderer has no textarea branch. `textFormat` (number/email/phone/URL) is saved but appointment entry uses a plain text input with no format validation. A required template only blocks when its ID is already in `f.pcfs`; a new appointment begins with no selected fields, so a user can omit a required template entirely.
- Payer profile copy says selected templates appear on appointments and exports automatically. In practice, appointment fields are a separate opt-in `f.pcfs` selection; the code comments and `mastersHub` test intentionally prevent payer picks from leaking into bookings. Captured values are displayed on `DetailCard`, but no claim/CMS/export/report consumer was found.

**Resolution:** decide whether payer picks should propagate (do not silently change this: current tests encode the opposite); enforce scopes; render all declared types and formats; define whether Required means auto-required or required only after selection; and correct the Payer copy or implement the promised appointment/export mapping. Test each scope/type and the decided payer contract.

### CFG-08 — **P2 / medium: notification preferences do not control the inbox feed**

`notificationsFor()` in `src/lib/tasks.js` builds alerts from tasks, cabinet documents, authorizations, intake SLAs, and denied claims, but never reads `state.settings.notifications`. The System Settings notification toggles therefore do not suppress or enable those alerts; no browser-toast consumer was found. Several UI property names also differ from defaults (for example `staffClinicalTeam` vs `clinicalTeam`, `staffQualExpiration` vs `qualificationExpiration`, and `staffTimesheetReminder` vs `timesheetSubmission`). The patch path accepts and stores those alternate names, so a successful toast is not evidence that the preference has an effect.

**Resolution:** align the preference schema, gate each alert source by its setting, implement browser toasts or remove that switch, and test on/off behavior for every visible preference.

### CFG-09 — **P2 / medium: multiple System Settings controls are no-ops or have incompatible schemas**

Exact-key tracing found no runtime consumer for System Billing `enableEra`, `arLoadOnGenerate`, `autoTransferSecondary`, or `newEraPreview`; Appointment `enableClockInOut`, `clockOutCompletesAppt`, or `syncVerifTimeToAppt`; or Other `distanceUnit`, gateway methods, and portal columns. `staffSigCompletesAppt` has a limited Quick Verify consumer, not a general completion-on-sign path. `syncVerificationTime` is the default key while the UI writes `syncVerifTimeToAppt`.

There is also a concrete shape mismatch for gateway methods: defaults and `systemConfigFor()` normalize `paymentGatewayMethods` as an object, while `SystemPanel` expects/writes an array. The array is converted back to an object on read, so the panel falls back to its hard-coded list instead of reliably reflecting the saved selection. The default is `clientPortalColumns`, while the UI reads/writes `portalBalanceColumns`; there is no portal module consuming either.

**Resolution:** for each setting, either wire a tested consumer or hide/label it as a future stub. Normalize each value to one canonical type/key and test save → reload → downstream effect.

### CFG-10 — **P2 / medium: the System Settings clinical-integration table has no default rows**

`clinicalRows` filters `integrationsCfg(settings)` to `category === 'clinical'`, but none of the `DEFAULT_INTEGRATIONS` rows defines `category` (`src/lib/settingsMasters.js`, `SystemPanel.jsx`). The table consequently shows “No clinical integrations configured” even though clinical partners exist in the general Integrations list; it has no rows to edit there. This is a display/configuration gap, not evidence of a live connection (all integrations remain local/offline).

**Resolution:** assign categories to defaults and provide a way to manage them in that table, or remove the redundant empty table.

### CFG-11 — **P2 / medium: “Maximum Appointment Length” is a warning, not a hard ceiling**

The General Settings hint calls the value a “Hard ceiling,” but `evaluateAppointmentValidations()` always emits `system.maxAppointmentLength` with severity `warn`. The booking modal only turns Stop items into blocking errors; a booking above the configured maximum can still be saved. The UI has no severity control for this rule.

**Resolution:** either rename the control and copy to say “warn when longer than,” or make it a configurable Stop and enforce it on all appointment write paths.

### CFG-12 — **P2 / auditability: several durable settings writes are not undoable**

The System panel writes Smart scheduling, Authorization guard, ABA Hours and several general settings via `actions.setSettings()` (`src/components/settings/SystemPanel.jsx`), rather than the settings planner/transaction path. The settings wiki documents that those raw writes have no planner/cascade and no Undo snapshot, despite the panel’s top-level comment saying one Undo reverses any single change. This makes important policy edits harder to audit/reverse than other Settings changes.

**Resolution:** move durable configuration changes through the guarded settings transaction/Undo path, or accurately document and visually disclose exceptions. Add persistence and Undo tests for each setting group.

### REL-01 — **Release hygiene: dependency audit and bundle warning**

- `npm audit` reports **8 advisories**: 2 critical, 2 high, 3 moderate, 1 low. Seven are in the dev/test dependency tree (including `vitest@2.1.9`, `tinypool@1.1.1`, and nested `vite@5.4.21`); the suggested Vitest remediation is a major upgrade. `npm audit --omit=dev` leaves one low-severity DOMPurify advisory (`dompurify@3.4.15`, via jsPDF). The DOMPurify advisory’s exploitability in this app was not assessed. No dependency changes were made.
- `npm run build` succeeds, but Vite warns the main minified JS bundle is about **2,461 kB (738 kB gzip)**, above its 500 kB warning threshold.

**Resolution:** triage and upgrade the dev/test tree with full test/build verification; review the DOMPurify path; split/lazy-load large areas where practical.

## Verification and scope

- `npm test`: **89 test files, 934 tests passed**.
- `npm run build`: succeeded with the bundle-size warning above.
- `npm audit`: results recorded under REL-01; no dependency remediation attempted.
- The build changed only generated `public/version.json`; it was restored before handoff. No behavior changes were made.
- This is a repository/source-trace audit plus automated test/build review. It does not validate external payer contracts, legal payroll requirements, production security controls, or live integrations.
