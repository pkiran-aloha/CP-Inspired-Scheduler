# Cross-module configuration audit — 2026-10-07

**Status:** source-trace audit complete; remediation delivered as PR #37 from branch `arena/e8f5fefe-cp-inspired-scheduler` (2026-10-07; build CI green, landing on `main`). CFG-02 through CFG-09, CFG-11 and CFG-12 are resolved with tests; CFG-05 is resolved by labelling the unpriced controls informational (the calculator/legal review gate stays); CFG-06 and CFG-07 are resolved by disabling/labelling unsupported options and enforcing scopes; REL-01's dependency half is triaged and deferred (documented below); its bundle half is resolved by code-splitting on `perf/lazy-views`. CFG-01 remains open as a production-architecture decision — the local credential-capture mitigation stays as-is.

## Executive result

Configuration is **partially, not consistently, wired through** Aloha ABA. Several core paths are real: appointment status/payroll/billing rules, payer service rates and units, provider identifiers, claim modifiers, MUE/concurrent checks, and weekly payroll overtime have downstream consumers. But a number of controls are either no-ops, apply only in one screen, use mismatched keys, or are not evaluated for every write path. Some UI copy promises stronger enforcement than the code provides.

This remains a local-first prototype, not a production system. Do not enter real PHI or live integration secrets, and do not use the current payroll or claim outputs as production calculations/filings. That boundary is already stated in `PRODUCT.md` and the settings wiki; this audit records the implementation evidence and issues to track.

## What is wired today

| Area | Observed downstream use | Assessment |
|---|---|---|
| Appointment statuses | Active status choices and labels/colors flow into calendar views; cancellation settings affect conflict checks; `pays` affects payroll and `billable` affects claim staging; `noteRequired` and `allowToComplete` are checked in appointment/verification UI. | Wired; Stop-severity validation rules are now enforced at write time on every path (CFG-02, resolved). |
| Payer/service billing rules | Service and payer unit length, rounding, rates, credential requirements, concurrent-billing rules, provider-ID requirements, claim modifiers, POS modifiers, MUEs, and payment terms are read by booking, claims, CMS-1500, and billing views. | Substantial working coverage; the unimplemented Claims Settings fields are now disabled and labelled (CFG-06, resolved). |
| Authorization / appointment rules | Authorization hours and units, payer MUEs, travel, overlaps, assignment, and ABA-hours rules are evaluated in the booking dialog and at write time; series and import paths evaluate every occurrence/row; intake handoff and scheduling-intelligence paths also call the evaluator. | Write-time invariant for Stop rules, per-occurrence series validation, per-row import validation (CFG-02, CFG-03, resolved). |
| Payroll | Weekly overtime threshold/multiplier, office-specific weekly threshold, earning-code eligibility, cancellation pay, and payroll rounding feed payroll calculations. | Weekly rules work; daily/double-time/seventh-day controls are labelled informational and do not price wages (CFG-05, resolved by marking). |
| Local integration/reference rows | Telehealth room links can appear on appointments/ICS exports; a payment link can print on statements; calendar and QuickBooks rows represent local exports. | Honest local/reference use only; no live network integration. The clinical table now has categorized rows (CFG-10, resolved). |

## Findings register

### CFG-01 — **P0 / production blocker: browser-local data and credentials are not production-safe**

- `PRODUCT.md` says workspace data is in browser `localStorage`, there is no backend/authentication yet, and real PHI must not be entered. `src/state/store.jsx` persists the workspace locally; `src/lib/workspaceBackup.js` includes the full `settings` object in a plain JSON backup (recognized integration credential fields are now filtered; see the local mitigation below).
- At audit time, the Integrations editor exposed API-key/token fields for non-reference rows (`src/components/settings/panels-extras.jsx`) and those values could be saved in workspace settings and backups. Nothing connected to a partner, but the UI invited entry of secrets without a server-side vault or protection. The input and persistence paths are now mitigated as detailed below.
- MFA, screen-lock, and auto-logout preferences are saved, but there is no sign-in/lock screen enforcing them (`src/components/settings/SystemPanel.jsx`; `docs/wiki/architecture.md` and `docs/wiki/settings.md` also record this).

**Local mitigation started 2026-10-07:** the Integrations editor no longer offers API-key/token inputs; the settings planner rejects recognized credential fields; existing integration credential fields are stripped on workspace normalization, direct settings writes and browser serialization; and plain JSON backup export/import strips them. This prevents the supported integration-settings paths from inviting or retaining those fields, but is **not** a vault or a security boundary: browser storage remains readable and users can still put arbitrary text elsewhere.

**Resolution gate remains open:** choose and implement the production hosting/data/auth/HIPAA architecture; enforce MFA/session controls there; use a server-side secret store for any future live integrations. Until then, continue to block real PHI and live credentials.

**Remediation status (2026-10-07, final pass):** still open — this is an architecture decision, not a code fix. The local mitigation (no key/token inputs, planner rejection, normalization/serialization/backup stripping) is landed and tested (`integrationSecrets.test.js`, `integrationSecretsUi.test.jsx`, `workspaceBackup.test.js`). No further code change is planned on this branch.

### CFG-02 — **P1 / high: Appointment Validation severity contract and write coverage do not match the settings UI**

- The Validations panel says **Warn requires acknowledgement** and **Flag badges the session** (`src/components/settings/SystemPanel.jsx`). In the booking modal, warnings are displayed in the Checks rail but there is no acknowledgement state or save gate; only stop items are added to `errors` (`src/components/AppointmentModal.jsx`). Validation flags are rendered for the draft but are not saved to the appointment, so they do not become a persistent session badge.
- The evaluator is not a central reducer/write guard. `QuickAdd.jsx` calls `actions.create` directly; calendar/timeline drag handlers call `actions.move`; appointment import plans rows without calling `evaluateAppointmentValidations`. A Stop configured in Settings can therefore be missed by those paths. Intake handoff and density-planning do call checks, so coverage is uneven rather than absent everywhere.
- At audit time there were rule-key/meaning mismatches: the panel edited `client.clientAssignment`, while the evaluator emitted `client.assignment`; `staff.travel` was evaluated and defaulted to Warn but had no visible control; and `staff.serviceProvider` was emitted only alongside a qualification failure rather than enforcing the panel hint about an assigned rendering provider. The current remediation aligns the Client Assignment control with `client.assignment` (and migrates legacy `clientAssignment` settings), exposes the `staff.travel` severity control, and evaluates rendering-provider presence separately from qualification.

**Remediation status (2026-10-07, resolved):** Stop-severity rules are now a write-time invariant in the reducer — `create`, `update` (scheduling writes only; completing/cancelling/billing a flagged session is never blocked) and `move` refuse a draft that trips a Stop rule, so the booking modal, Quick Add, drag-moves, series edits and CSV imports all land on the same guard (`stopViolationsForDraft` in `settingsMasters.js`, wired in `createActions`). Warn requires an acknowledgement tick in the booking dialog, bound to the exact warning ids and re-arming on edit; the acknowledgement persists on the session as `warnsAcked`. Flag-severity items are derived at save time and stored on the appointment as `validationFlags`, surfaced as badges in DetailCard and the TimeGrid. Covered by `writeGuard.test.jsx` (11 tests), the mastersHub warn-ack assertions and the app.test.jsx series tests. Accepted edge: the action-layer guard evaluates against render-time state within one synchronous handler, so a series rebuild/scoped patch can rarely over-refuse when overlap is configured Stop and new dates coincide with being-deleted siblings; the toast plus Undo recovers.

### CFG-03 — **P1 / high: recurring appointments validate only the first occurrence**

`AppointmentModal` computes `valReport` and the authorization checks for the current form date. On create, it builds all `seriesDatesFor(...)` drafts and then checks only `clashFor(...)` per later date (`src/components/AppointmentModal.jsx`). Series rebuilds and multi-occurrence edits similarly perform clash filtering without re-evaluating every configured validation or authorization/unit rule for each date.

A series can therefore pass because its first date is valid while later dates fall outside an authorization window, exceed a unit/MUE limit, violate staff availability/travel/assignment, or fail another configured rule. The current loop also does not add earlier planned occurrences to a cumulative validation state.

**Resolution:** validate each occurrence against live state plus already accepted occurrences, and report which dates were rejected and why. Apply the same logic to series edits/rebuilds.

**Remediation status (2026-10-07, resolved):** series create, series edits and rebuilds now validate every date against the live calendar plus the occurrences already accepted in the same operation, skip rejected dates instead of forcing them, and name them in the result (`Created N occurrences · M rejected (date: reason)`). The per-date check is `occurrenceChecks` in `src/lib/recurrence.js`: time clash, Stop rules (`stopViolationsForDraft`), Warn items (`evaluateAppointmentValidations`) and, for clinical sessions, authorization hours plus unit pools (`mergeAuthChecks` over `authCheckFor` and `unitCheckFor`). `screenOccurrences` runs it in date order; the booking dialog (`AppointmentModal.jsx`, on create) and `planSeriesTx` (series edits and rebuilds, which also refuse the whole change when the edited session itself is rejected) both call it. The store-level Stop guard backs the per-date evaluation. Covered by `recurrence.test.js` (clash/Stop rejection on rebuilds, `occurrenceChecks`), the app.test.jsx series tests and `writeGuard.test.jsx`. (Note updated after the recurrence rewrite replaced the earlier `occurrenceReasons` helper in `AppointmentModal.jsx`.)

### CFG-04 — **P1 / high: staff and client signature rules are conflated, bypassable, and have a null-payer crash path**

- Payer settings say **Client Signature required** (`PayerDetail.jsx`), but the shared verification `SignaturePad` captures staff identity/certification and the appointment passes the verifier/assigned staff to it (`src/ui/SignaturePad.jsx`, `AppointmentModal.jsx`). The same `f.verification.signature` boolean satisfies both the payer rule and the system “staff signature” rule; there is no separate client/guardian signature record.
- Calendar **Quick verify + sign** creates a staff signature and can set status to Completed after checking `allowToComplete`, but does not check the payer’s signature-required rule (`src/components/DetailCard.jsx`). This can bypass the modal’s signature gate.
- The system default is `general.staffSigRequiredToComplete: false`, while the Settings control reads/writes `general.staffSignatureRequired` and treats a missing key as on. A fresh workspace can therefore display the toggle as enabled while the default effective check is false.
- If the system-level signature requirement is enabled for a booking with no payer, the Verification note renders `billPayer.name` without a null check (`AppointmentModal.jsx`). The save toast uses optional chaining, but the note does not.

**Resolution:** define distinct client/guardian and staff verification signatures, apply payer/system requirements on every completion path (including Quick Verify), use one canonical system key/default, and render a safe fallback when there is no payer. Add payerless and quick-verify regression tests.

**Remediation status (2026-10-07, resolved):** client/guardian and staff signatures are separate records with separate pads and save gates; the canonical system key is `staffSigRequiredToComplete` (legacy `staffSignatureRequired` preserved on read); Quick Verify honours the payer's client-signature rule and preserves a captured client signature; the Verification note is null-payer safe. Covered by `signatureRules.test.jsx` (9 tests) and the app.test.jsx signature flows.

### CFG-05 — **P1 / high: daily, double-time, and seventh-day payroll controls do not affect wage calculations**

The Payroll settings editor exposes global daily OT/double-time and per-office daily, double-time, weekly, and seventh-day thresholds (`src/components/settings/PayrollPanel.jsx`). `earningsFor()` in `src/lib/payroll.js` reads the office-specific **weekly** threshold or global weekly threshold and calculates weekly overtime; it does not read the daily or seventh-day thresholds, daily OT switch/multiplier, double-time hours, or the earning-code `doubleTime` flag. The Payroll panel itself says daily rules are saved as a policy note, not priced. Payroll rounding is applied and is **not** a finding.

**Resolution:** implement and test the applicable jurisdictional daily/double/seventh-day rules, or remove/clearly mark the controls as informational. Do not rely on these controls for actual payroll until the calculator and legal review cover them.

**Remediation status (2026-10-07, resolved by marking):** the daily/double-time/seventh-day controls are now labelled informational everywhere they appear — the section sub-copy, row hints, a warning banner under the daily rules and a note under the office table — and the copy no longer claims the rules appear on the register (they do not; `officeOvertimeRules` is read only for its `weeklyOtHours` in `earningsFor`). The jurisdictional calculator work and legal review remain the gate before these controls can price wages; that is a payroll-engine project, not a settings fix. Covered by `settingsWrites.test.jsx`.

### CFG-06 — **P1 / high: several payer Claims Settings options are stored but ignored by claim output**

Working examples include same-day merging, credential modifiers, Box 32 behavior, supported claim split keys, POS modifiers, and provider-ID rules. However, `box17`, `box19`, `box33B`, `box33B2`, claim-file grouping, appointment time, `renderProvider`, `renderTaxo`, and `billTaxo` are exposed in `PayerDetail.jsx` but have no downstream readers in claim assembly/CMS-1500 code. `separateBy: Supervising Provider` returns no key because appointments do not record a supervisor (`src/lib/claims.js`). POS `hideTeleOther`/`hideTeleHome` are saved but do not filter appointment locations.

The existing settings wiki already records most claim-field no-ops; the cross-module trace confirms that selecting them does not change the generated output. The app also has no live clearinghouse/837 transmission, so “file options” are not operational today.

**Resolution:** implement the output behavior and required source data, or remove/disable each unsupported control and label it as not available. Add golden claim/CMS-1500 tests proving each visible option changes the intended output.

**Remediation status (2026-10-07, resolved by disabling/labeling + one wiring):** Box 17, Box 19, Box 33B, Box 33B2, Claim File Options, Include Appointment Time and the `renderProvider`/`renderTaxo`/`billTaxo` checkboxes are disabled and labelled "not available", with a banner naming the working options (Box 32, same-day merge, credential modifiers, split keys). "Separate Claim By" no longer offers "Supervising Provider"; both provider choices are labelled as splitting by the session's clinician. POS "Hide POS-10" is now real: telehealth locations (which code POS-10 via `posFor`) leave the booking picker for that payer's clients, while the session's current location stays pickable; "Hide POS-02" is disabled and labelled — every video location codes POS-10, so there are no POS-02 locations to hide. The remaining no-op claim fields stay disabled until claim assembly implements them (no golden-output change is claimed). Covered by mastersHub and telehealthRoom tests.

### CFG-07 — **P1 / high: custom-field scope, type, required, and payer/export contracts are incomplete**

- The template editor stores `assignedTo` scopes, and `customFieldsForScope()` exists, but no operational component calls that helper. The appointment picker filters only by active status and offers every template; the payer picker also iterates every template. Client-, authorization-, or staff-scoped templates can therefore appear in unrelated pickers.
- `textarea` is a defined type but the appointment renderer has no textarea branch. `textFormat` (number/email/phone/URL) is saved but appointment entry uses a plain text input with no format validation. A required template only blocks when its ID is already in `f.pcfs`; a new appointment begins with no selected fields, so a user can omit a required template entirely.
- Payer profile copy says selected templates appear on appointments and exports automatically. In practice, appointment fields are a separate opt-in `f.pcfs` selection; the code comments and `mastersHub` test intentionally prevent payer picks from leaking into bookings. Captured values are displayed on `DetailCard`, but no claim/CMS/export/report consumer was found.

**Resolution:** decide whether payer picks should propagate (do not silently change this: current tests encode the opposite); enforce scopes; render all declared types and formats; define whether Required means auto-required or required only after selection; and correct the Payer copy or implement the promised appointment/export mapping. Test each scope/type and the decided payer contract.

**Remediation status (2026-10-07, resolved):** payer picks do **not** propagate (the encoded contract is kept — sessions add fields opt-in). Scopes are enforced: the appointment picker offers only Schedule Appointment-scoped templates, the payer picker only Payer Profile-scoped ones (plus that payer's picks, so they stay unlinkable); templates saved before scopes existed keep their old appointment+payer behaviour. Every declared type renders — the missing textarea branch is added — and a text/paragraph field's saved Text Format (number/email/phone/URL) is validated at save time (`pcfFormatErrors`), with the expected format shown on the field label. "Required" is decided as **required once added** and labelled as such (it never pulls itself onto new appointments). The payer copy no longer promises automatic appointment/export propagation. Covered by `customFields.test.jsx` (8 tests).

### CFG-08 — **P2 / medium: notification preferences do not control the inbox feed**

`notificationsFor()` in `src/lib/tasks.js` builds alerts from tasks, cabinet documents, authorizations, intake SLAs, and denied claims, but never reads `state.settings.notifications`. The System Settings notification toggles therefore do not suppress or enable those alerts; no browser-toast consumer was found. Several UI property names also differ from defaults (for example `staffClinicalTeam` vs `clinicalTeam`, `staffQualExpiration` vs `qualificationExpiration`, and `staffTimesheetReminder` vs `timesheetSubmission`). The patch path accepts and stores those alternate names, so a successful toast is not evidence that the preference has an effect.

**Resolution:** align the preference schema, gate each alert source by its setting, implement browser toasts or remove that switch, and test on/off behavior for every visible preference.

**Remediation status (2026-10-07, resolved):** `DEFAULT_NOTIFICATIONS` is rewritten to 12 wired keys (adding `staffTasks` and `deniedClaims`); `notificationsFor` gates every alert source by its preference and gained the missing alerts (incomplete appointments, late-filing claims); the six toggles with no alert source were removed from the panel; browser toasts fire once per session for stop-tone alerts only, with honest copy. Covered by `notifications.test.jsx` (21 tests).

### CFG-09 — **P2 / medium: multiple System Settings controls are no-ops or have incompatible schemas**

Exact-key tracing found no runtime consumer for System Billing `enableEra`, `arLoadOnGenerate`, `autoTransferSecondary`, or `newEraPreview`; Appointment `enableClockInOut`, `clockOutCompletesAppt`, or `syncVerifTimeToAppt`; or Other `distanceUnit`, gateway methods, and portal columns. `staffSigCompletesAppt` has a limited Quick Verify consumer, not a general completion-on-sign path. `syncVerificationTime` is the default key while the UI writes `syncVerifTimeToAppt`.

There is also a concrete shape mismatch for gateway methods: defaults and `systemConfigFor()` normalize `paymentGatewayMethods` as an object, while `SystemPanel` expects/writes an array. The array is converted back to an object on read, so the panel falls back to its hard-coded list instead of reliably reflecting the saved selection. The default is `clientPortalColumns`, while the UI reads/writes `portalBalanceColumns`; there is no portal module consuming either.

**Resolution:** for each setting, either wire a tested consumer or hide/label it as a future stub. Normalize each value to one canonical type/key and test save → reload → downstream effect.

**Remediation status (2026-10-07, resolved):** `enableEra` is wired (it gates 835 import in the Payment Center); the gateway methods are normalized to one object shape (`normalizeGatewayMethods`) and the portal columns to `clientPortalColumns` (`normalizePortalColumns`); the appointment/billing sections write the canonical `syncVerificationTime`; `staffSignatureRequired`/`syncVerifTimeToAppt` legacy keys are preserved on read via `systemConfigFor`; and every remaining no-op control (AR Manager, auto-transfer, clock in/out, distance unit, portal columns, etc.) carries an honest stub banner or hint instead of implying an effect. Covered by `settingsWrites.test.jsx`, `settingsMasters.test.js` and the payment-center tests.

### CFG-10 — **P2 / medium: the System Settings clinical-integration table has no default rows**

`clinicalRows` filters `integrationsCfg(settings)` to `category === 'clinical'`, but none of the `DEFAULT_INTEGRATIONS` rows defines `category` (`src/lib/settingsMasters.js`, `SystemPanel.jsx`). The table consequently shows “No clinical integrations configured” even though clinical partners exist in the general Integrations list; it has no rows to edit there. This is a display/configuration gap, not evidence of a live connection (all integrations remain local/offline).

**Resolution:** assign categories to defaults and provide a way to manage them in that table, or remove the redundant empty table.

**Remediation status (2026-10-07, resolved):** all 11 `DEFAULT_INTEGRATIONS` rows now carry a `category`, with a migration in `normalizeSettingsMasters` for older saves, so the clinical table has rows to edit. Covered by the settings-modules tests.

### CFG-11 — **P2 / medium: “Maximum Appointment Length” is a warning, not a hard ceiling**

The General Settings hint calls the value a “Hard ceiling,” but `evaluateAppointmentValidations()` always emits `system.maxAppointmentLength` with severity `warn`. The booking modal only turns Stop items into blocking errors; a booking above the configured maximum can still be saved. The UI has no severity control for this rule.

**Resolution:** either rename the control and copy to say “warn when longer than,” or make it a configurable Stop and enforce it on all appointment write paths.

**Remediation status (2026-10-07, resolved by honest copy):** the General Settings hint no longer calls the value a "Hard ceiling" — the copy now says the booking warns when a session runs longer than the configured maximum, which matches the evaluator (`system.maxAppointmentLength` is always a warn-severity item). Making it a configurable Stop would contradict the repo rule that nothing hard-blocks by default, so the copy fix was chosen.

### CFG-12 — **P2 / auditability: several durable settings writes are not undoable**

The System panel writes Smart scheduling, Authorization guard, ABA Hours and several general settings via `actions.setSettings()` (`src/components/settings/SystemPanel.jsx`), rather than the settings planner/transaction path. The settings wiki documents that those raw writes have no planner/cascade and no Undo snapshot, despite the panel’s top-level comment saying one Undo reverses any single change. This makes important policy edits harder to audit/reverse than other Settings changes.

**Resolution:** move durable configuration changes through the guarded settings transaction/Undo path, or accurately document and visually disclose exceptions. Add persistence and Undo tests for each setting group.

**Remediation status (2026-10-07, resolved):** the `setSettings` reducer case now snapshots the whole `settings` object, so every durable settings write — planner transactions, raw `setSettings` writes (guard, smart scheduling, ABA Hours, System panel fields, theme) and payroll policy — is one undoable transaction: one Undo reverses exactly that write. Two tests that pinned the old no-snapshot contract were updated to the new one. Covered by `settingsWrites.test.jsx`, `payroll.test.js` and `workspaceBackup.test.js`; the wiki write-path section is synced.

### REL-01 — **Release hygiene: dependency audit and bundle warning**

- `npm audit` reports **8 advisories**: 2 critical, 2 high, 3 moderate, 1 low. Seven are in the dev/test dependency tree (including `vitest@2.1.9`, `tinypool@1.1.1`, and nested `vite@5.4.21`); the suggested Vitest remediation is a major upgrade. `npm audit --omit=dev` leaves one low-severity DOMPurify advisory (`dompurify@3.4.15`, via jsPDF). The DOMPurify advisory’s exploitability in this app was not assessed. No dependency changes were made.
- `npm run build` succeeds, but Vite warns the main minified JS bundle is about **2,461 kB (738 kB gzip)**, above its 500 kB warning threshold.

**Resolution:** triage and upgrade the dev/test tree with full test/build verification; review the DOMPurify path; split/lazy-load large areas where practical.

**Remediation status (2026-10-07, triaged and deferred):** counts re-verified on the remediation branch — `npm audit` reports 8 advisories (2 critical, 2 high, 3 moderate, 1 low), all in the dev/test tree (vitest 2.1.9 / tinypool / nested vite 5.4.21, plus esbuild ≤0.24.2); `npm audit --omit=dev` leaves the single low-severity DOMPurify advisory (dompurify ≤3.4.15 via jsPDF 4.2.1). DOMPurify path reviewed: the app never imports DOMPurify and never calls jsPDF's `html()` method (all PDF output uses the text/table API), so the two IN_PLACE-sanitization advisories are not reachable from this codebase; the fix is a jsPDF/dompurify patch release, not an app change. The suggested Vitest remediation is a major upgrade (vitest 5.x) — deferred: it is a dev-only dependency, the suite is green at 95 files / 995 tests, and a major test-runner upgrade is its own project with full verification, not a line-item inside an audit-remediation branch. The bundle warning (≈2,461 kB minified, ≈738 kB gzip) is unchanged; code-splitting the largest views is likewise deferred as a separate performance task. No dependency changes were made on this branch.

**Remediation status (2026-10-07, bundle half resolved on `perf/lazy-views`):** real code-splitting, not `manualChunks`. Measured with `npm run build` at `5f99933`: the single entry chunk was **2,525.24 kB minified / 759.32 kB gzip** (2,916 kB of JS in total). After: the entry chunk is **1,015.46 kB / 322.06 kB gzip** (−60% minified, −58% gzip); total JS is about the same (≈2,924 kB, now in 40 files) because the rest moved into chunks fetched on demand.

- `src/App.jsx`: every non-calendar section (dashboard, analytics, reports, clients, intake, masters, staff, cabinet, all billing and payroll screens, Help & Wiki, Settings) is a `React.lazy` chunk behind a `role="status"` "Loading this section…" fallback inside the existing section error boundary. The calendar, its dialogs and the global overlays stay eager. The bundled `docs/wiki/*.md` now ships inside the Help chunk (≈229 kB), not the entry.
- `src/lib/exportKit.js`: jsPDF (≈391 kB, plus its optional html2canvas/DOMPurify chunks) is a dynamic `import()` through `loadPdf()`. The six PDF builders keep their synchronous API through `newPdf()`; every PDF button awaits `loadPdf()` first and, if the fetch fails, says nothing was downloaded.
- What remains in the entry is the calendar plus `store.jsx` and the domain engines its reducer and seed import (`settingsMasters`, `seed`, `reports`, `security`, `payroll`, `claims`, `intake`, …) and `react-dom`. Splitting further means decoupling the reducer from those engines, which is an architecture change, not a lazy-load. `build.chunkSizeWarningLimit` is set to 1,100 kB as a regrowth tripwire (documented in `vite.config.js`), so the build no longer warns.
- `npm run share` (single file) is unchanged: `SHARE_INLINE=1` already sets `inlineDynamicImports`, so every chunk folds back into `share/Aloha-ABA.html` (verified, ≈3.1 MB, no external asset references).
- Tests: `src/test/setup.js` (Vitest `setupFiles`) preloads every section chunk and the PDF engine via `preloadViews()`/`loadPdf()`, so the existing UI tests still render sections synchronously; four PDF-download tests now `await waitFor(...)` the download. Full suite **99 files / 1,039 tests green**.

## Verification and scope

- `npm test` (audit time): **89 test files, 934 tests passed**.
- `npm test` (after remediation, 2026-10-07): **95 test files, 995 tests passed**.
- `npm run build`: succeeded both times, with the bundle-size warning above; resolved by the REL-01 bundle pass (`perf/lazy-views`), which builds without the warning.
- PR #37 (`arena/e8f5fefe-cp-inspired-scheduler` → `main`): GitHub CI `build` job green on the final head; the `deploy` job runs on `main` only and fires after the merge.
- `npm audit`: results recorded under REL-01; no dependency remediation attempted (deferred, triaged above).
- The build changed only generated `public/version.json`; it was restored before handoff. No behavior changes were made by the audit itself.
- This is a repository/source-trace audit plus automated test/build review. It does not validate external payer contracts, legal payroll requirements, production security controls, or live integrations.
