# Settings

_Sources: src/lib/settingsMasters.js, src/lib/integrationSecrets.js, src/lib/workspaceBackup.js, src/components/SettingsModal.jsx, src/components/settings/kit.jsx, src/components/settings/panels-practice.jsx, src/components/settings/panels-extras.jsx, src/components/settings/PayrollPanel.jsx, src/components/settings/SystemPanel.jsx, src/components/settings/DataImportPanel.jsx, src/components/PayerDetail.jsx, src/components/PayersView.jsx, src/lib/master.js, src/lib/providerIds.js, src/lib/dataImport.js, src/lib/abaHours.js, src/lib/authBudget.js, src/lib/travel.js, src/lib/security.js, src/state/store.jsx, src/components/NavRail.jsx, src/components/MastersView.jsx_

_Last synced against main 0434a5a plus the recurrence-series branch on 2026-10-07; unrelated behavior unchanged._

[Wiki home](README.md) · Related: [Scheduling](scheduling.md), [Payroll](payroll.md), [Intake](intake.md), [Dashboard and reports](dashboard-and-reports.md)

## User guide

Settings is where a practice decides how the app behaves, so a rule change is a setting and not a code change. Open it from the sidebar (key `0`); the sidebar expands to list the **13 modules** and their sub-tabs, and the chosen panel renders in the main area. Everything is stored in this browser's workspace, travels in the workspace backup, and nothing is transmitted anywhere.

If your account has view-only access to the Workspace settings area, every panel is read-only. Changing the office master needs all-office scope, because offices are shared by every location.

### The 13 modules

| Module | Use it to |
|---|---|
| Appointment Status | Define the statuses a session can have: label, colour, whether it pays, is billable, counts as a cancellation, needs a note, can be completed, and which payroll earning code it earns |
| Custom Lists | General lists (including the **Cancellation reasons** list used by [Scheduling](scheduling.md)) and Service Type lists |
| Custom Fields | Extra fields captured on appointments, client/payer/staff profiles and authorizations — scoped per template |
| Data Import | Bring records in from a CSV file |
| Organization | Practice identity, NPI and tax ID, and the **office and location master** (optional lat/lng for travel time estimates, seeded for demo offices) |
| Payroll | Pay cycle, earning codes, overtime rules (see [Payroll](payroll.md)) |
| Qualification | Degrees, certifications and licences, and expiry. "Covers" makes a higher credential satisfy a lower one (BCBA covers BCaBA and RBT). The staff qualification check reads a person's credential from their cert ("BCBA #…" counts as BCBA), from each part of a "Credential · title" role, and from job titles listed in a qualification's "Applies to" (for example "Lead RBT"). A staff member's own **Education level** (Doctoral, Master's, Bachelor's, Associate, HS — set on the staff record, optional) is what a payer's Qualification Modifiers match; a Teacher, Therapist or Specialist row instead matches a part of the role or credential |
| Services | Service types, billing codes, unit length (new services default to 15 minutes), rates per unit, rounding, required credentials |
| Security | Local demo accounts and role-based access (browser-local, not real authentication) |
| Clinical Integrations | Local export seams: calendar `.ics`, the practice's own telehealth room link (must be a full `https://` address; shown on telehealth appointments and in `.ics` exports by `telehealthRoomFor`), the practice's own online payment link (for example a Stripe Payment Link; printed on client statements by `paymentLinkFor`, never charged or read), a link to the QuickBooks desk, and a record of the last local run. No row accepts API keys, tokens, or other integration credentials: this browser-local prototype has no server-side secret vault, so do not enter live credentials. Legacy credential fields are removed when a workspace loads and excluded from backup files. A workspace saved before a new default row existed still gets it (`integrationsCfg` appends missing defaults) |
| Text Messaging Services | Sender identity, quiet hours, templates, opt-outs. Off by default; **nothing is ever sent** |
| System Settings | Nine tabs (below) |
| Subscription Portal | A plan, seats and renewal record for this workspace |

**System Settings tabs:** General Settings, Clearing House Integration, Billing Settings, Appointment Settings, Appointment Validations, Notification Settings, Clinical Integrations, EVV Integrations, Other Settings. The panel also holds display and money defaults, appointment naming with a live preview, **Smart scheduling** weights, the **Authorization guard**, ABA Hours targets, Analytics defaults, the versioned **Data and backup** export and restore, and **Demo data** reset (two-step arming). Clearing house and EVV settings only store configuration; no claim or visit is transmitted. Notification preferences only change what the local workspace highlights.

**Denial reasons and remittance code hints** (System, Billing Settings): two editable lists. Denial reasons (label and next step) are offered when a claim is marked denied; remittance code hints (a group-reason code such as CO-197, its meaning and the next step) explain ERA denials. Edit the rows, then press **Save reasons and hints**. The save runs through `planReasonLists` (settings op `billing.reasons`): every reason needs a label of at least 3 characters, labels and codes cannot repeat, codes must look like CO-197 (groups CO, PR, OA, PI, CR), and at least one denial reason must remain.

### Guards you will meet

Settings refuses invalid configuration instead of saving it, and tells you why:

- An office name must be unique, an NPI is exactly 10 digits, a tax ID looks like 12-3456789, an email must look like one.
- You cannot delete the last office, or one that staff, clients, appointments, payroll profiles or accounts use, without choosing where those records move. Renaming an office updates every record that used the old name.
- At least one active status must produce payable time. A status with appointments on it needs a reassignment target to be removed. A status can only name an earning code that exists.
- Earning codes need 2-12 letters or digits, a regular-rate code must be taxable, and a code in use is deactivated instead of deleted. Overtime multiplier cannot go below 1.5.
- Text messaging cannot be enabled without a sender identity.

Because validations and the authorization guard are settings, the shared severity language applies here:

- **Appointment Validations** (rendering-provider presence and staff qualification, overlap, missing NPI or Medicaid ID, pay rate, unavailable, travel feasibility, client overlap and team assignment, payer cancelled/no-show, regional center, and the ABA Hours rules) each take None, Flag, Warn or Stop. The Client Assignment control edits the same canonical key the evaluator reads; `staff.travel` has a visible severity control and defaults to Warn. Travel findings say “Needs about 22 min from previous; gap is 10 min” with honest copy “estimated from straight-line distance; not a map route”. Stop rules are enforced on every appointment write path (store-level guard, series and import included); Warn requires an acknowledgement tick in the booking dialog before saving, and Flag items persist on the session as badges.
- **Authorization guard** takes Off, Flag, Warn or Stop. **Warn is the default**; Stop is a choice the practice makes on purpose. Also set here: warn-at percentage (85), stop-at percentage (100, Stop mode only), renewal alert days (30), urgent days (14) and the under-pace threshold (70). **Reset guard** restores the defaults.

See [Scheduling](scheduling.md) for what each finding means at booking time.

### Payer billing rules

Masters > Payers > open a payer. Tabs are Profile, Services (the payer's own contract sheet, including per-service unit size, rounding, modifier and rate overrides) and **Billing Rules**, with these sections: Concurrent Billing, Claims Settings, Appointment Settings (for example signature required), Qualification Modifiers (the first row whose level matches the rendering provider's education level — or a "·" part of their role or cert — adds its modifier pair to the claim line; a blank modifier adds nothing; the panel reports how many staff have no education level recorded), Place of Service Modifiers, **MUEs** (daily and per-code unit maximums, plus a per-code weekly limit used at booking), **Provider IDs** (NPI, Medicaid ID or both) and **Payment Terms** (payer kind, days to pay, payer share, copay, filing deadline). Claim aging, the copay estimate, payment presets and CMS-1500 box 7b read Payment Terms.

Claims Settings holds the claim-assembly rules. The optional **Payer mileage code** is a 5-character CPT/HCPCS code the practice copies from that payer's contract; no default is guessed, and CPT `14220` is rejected because it is a surgery code, not mileage. Insurance mileage lines without a valid code are held, and CMS-1500 generation is refused until the code is set or the mileage is removed. Drafts created before the code was set or changed need to be voided and rebuilt. These are read today: **Separate Claim By** (Rendering Provider, Service Provider or Place of Service splits a client's month into several claims — both provider choices split by the session's clinician, and Supervising Provider is not offered because sessions record no supervisor), the **merge same day** checkbox (on by default), the **credential modifier** checkbox (on by default: HO for a BCBA, HN for a BCaBA, HM for an RBT, HP for a psychologist on each line; separate from the payer's own Qualification Modifiers rows, which apply either way) and **Box 32** (the default leaves the service facility blank). Box 17, Box 19, Box 33B, Box 33B2, Claim File Options, Include Appointment Time and the taxonomy / rendering checkboxes are saved but read by nothing, so the panel shows them disabled and labelled "not available". Place of Service Modifiers add a modifier by CMS place-of-service code (02, 10, 11, 03, 12 home, 99); a payer's own service modifier is set on the Services tab. **Hide POS-10** removes telehealth locations (video sessions code POS-10) from the booking picker for that payer's clients; **Hide POS-02** is disabled — every video location codes POS-10, so there are no POS-02 locations to hide. The Profile tab's CMS type and the group and plan identifiers fill CMS-1500 box 1, 7a and 10. The billing consequences are covered in [Billing and claims](billing-and-claims.md).

### Custom Fields

Templates are defined once on the Custom Fields master (label, type, list options, on/off labels, scopes, active). Types: free text, paragraph text (textarea), single select, multi select, toggle, date/time and signature — every declared type renders in the booking dialog, and a text/paragraph field's saved **Text Format** (number, email, phone, URL) is validated when the appointment saves (an empty value stays valid; "required" is a separate rule). Each template carries **scopes** (Client Authorization, Client Profile, Payer Profile, Schedule Appointment, Staff Profile); the booking dialog's "Add Custom Fields" picker offers only Schedule Appointment-scoped templates, and a payer's picker offers only Payer Profile-scoped ones (plus templates that payer already picked, so they can be unlinked). Templates saved before scopes existed carry no scope list and keep their old behaviour — they appear in both pickers. **Required once added**: a required template must be filled in once it is on a session — it is never added to new appointments automatically. A payer picks which templates apply to it, but sessions add fields opt-in from the booking dialog; captured values show on the appointment detail, and no claim, CMS-1500 or export reads them yet.

### Data Import

Pick a type, choose a CSV file or paste text, map the columns (auto-mapped from the header), and review the preview. A template CSV is available for each type. **Nothing is written unless every row validates**; problems list the row number and reason. You choose whether existing matches are skipped or updated. The import commits as one undoable change and is logged on the settings (what came in, what was skipped). Types: Clients, Client Contacts, Client Authorizations, Staff, Staff Qualifications, Staff NPIs, Staff Earning Codes, Payer Profiles, Payer Services, Appointments. Limit: 500 rows per file. Input is CSV only (no Excel, no OCR, no network fetch). Use fictional data only.

### ABA Hours settings

Under System Settings: per-track target hours (graduate student, RBT/BCAT, BCaBA, BCBA, other), whether an activity is required before the flag saves, and whether the badge shows on the calendar. See [Scheduling](scheduling.md) for the rule itself.

## How it works

### Registry and writer

[settingsMasters.js](../../src/lib/settingsMasters.js) is the single settings engine:

- Registry: `SETTINGS_MODULES`, `settingsModule`, `SYSTEM_SETTINGS_SECTIONS`. The sidebar, the panels and the palette all read it.
- Defaults and resolvers: `settingsOffices`, `officeById`, `apptStatusList`, `statusFor`, `isCancelStatus`, `customLists`, `listOptions`, `qualificationList`, `earningCodes`, `messagesCfg`, `integrationsCfg`, `clearinghousesCfg`, `evvCfg`, `notificationsCfg`, `systemConfigFor`, `appointmentValidationsCfg`, `DEFAULT_APPOINTMENT_VALIDATIONS`, `VALIDATION_SEVERITIES`.
- `evaluateAppointmentValidations(state, draft)` returns `{items, stops, warns, flags}` for the booking dialog and reports.
- `planSettingsOp(state, op, payload)` is the guarded planner. It returns `{ok, msg, patch, cascades, touched}`. Ops include `office.upsert|remove`, `status.upsert|remove|move`, `list.*` (upsert, remove, optionAdd, optionUpdate, optionRemove, optionMove), `qualification.upsert|remove`, `earningCode.upsert|remove`, `payroll.general|defaults|overtime|officeOvertime`, `org.patch`, `template.upsert|remove`, `messaging.patch`, `optout.add|remove`, `integration.patch|ran`, `clearinghouse.upsert|remove`, `evv.patch`, `appointmentValidations.patch` (alias `validations.patch`), `notifications.patch`, `systemConfig.patch`, `subscription.patch`, `system.patch`, `import.commit`.
- Peer modules: [master.js](../../src/lib/master.js) (payer and service masters: `ensurePayer`, `svcRule` with `DEFAULT_RULES`, `rateFor`, `payerForAppt`, custom field helpers), [providerIds.js](../../src/lib/providerIds.js) (NPI/Medicaid rule per payer), [dataImport.js](../../src/lib/dataImport.js) (`IMPORT_TYPES`, `parseCSV`, `guessMapping`, `validateImport`, `planImport`, `previewRows`, `templateCSV`, `IMPORT_LIMIT`), [abaHours.js](../../src/lib/abaHours.js) (`abaHoursCfg`, `countsAsAbaHours`, tracks and activities).

### Write path

Settings writes follow action, then plan, then Tx:

- `actions.settingsOp(op, payload)` in [store.jsx](../../src/state/store.jsx) checks `canAccess('settings','full')` (and all-office scope for `office.*`), calls `planSettingsOp`, returns `{ok, msg}` for the toast, then dispatches `settingsTx`.
- The `settingsTx` reducer **re-plans against live state**, applies `plan.patch` to `settings`, and applies every cascade (appointments, clients, staff, payroll profiles, intake requests, account office scopes) in the same action. One Undo reverses all of it, and the snapshot covers only the collections touched.
- Data Import: `actions.importRows` calls `planImport`, then `importTx` re-plans and applies creates and patches plus an `importLog` entry in one snapshot.
- Permissions ([security.js](../../src/lib/security.js)): `settingsTx` needs the `settings` area, plus `payroll` for `payroll.*` and `earningCode.*` ops. `importTx` needs `settings` plus `clients`, `staff` or `calendar` depending on type. A new action type needs an entry in `actionAreas` and the record-scope switch or it is refused.

**Not everything goes through `settingsTx`.** The Authorization guard, Smart scheduling weights, ABA Hours config and several System Settings fields are written with `actions.setSettings(patch)`, which dispatches a raw `setSettings` action: no planner and no cascade, but the write **is** one undoable transaction — the reducer snapshots the whole `settings` object, so one Undo reverses exactly that write. Its permission area depends on the key (`authGuard` and `risk` and `smart` map to `calendar`, `billing` and `providers` to `billing`, `payroll` to `payroll`, `analytics` to `analytics`, anything else to `settings`). Payer, service and custom-field master edits use their own `payer`, `svc` and `cfdef` reducer cases (area `masters`). Every payer field or rules save takes one Undo snapshot, and so does Payment Terms (`planPayerTerms`); payer add/remove and service and custom-field edits do not. The payer-contract cleanup that runs as part of deleting a service passes `noSnap` so it cannot leave a half-Undo behind.

### State, migrations, backup

- Everything lives under `settings.*` (for example `offices`, `apptStatuses`, `customLists`, `qualifications`, `payroll`, `authGuard`, `smart`, `abaHours`, `appointmentValidations`, `clinicalIntegrations`, `textMessaging`, `importLog`). `settings` is in `WORKSPACE_FIELDS`, so it is exported and validated with the backup, and a restore re-merges the guard defaults instead of dropping them.
- `normalizeSettingsMasters` (called from `normalizeWorkspace`) fills missing masters (for example `appointmentValidations`) idempotently and returns the same object when nothing changed.
- Payer rules: `ensurePayer` fills defaults for `rules` (`concurrent`, `claims` with `separateBy`, `mileageCode`, `box32` and `flags` such as `mergeSameDay` and `credentialMods`, `appt`, `qualMods` — the education-code rows in `DEFAULT_QM` (`model.js`) — `posMods`, `mue` with `daily`, `per`, `weekly`). `POS_CODES` in `master.js` is the place-of-service list the modifier rows use.

### Components

[SettingsModal.jsx](../../src/components/SettingsModal.jsx) picks the panel for the selected module; NavRail owns module and sub-tab navigation. Panels: `panels-practice.jsx` (Organization, Appointment Status, Custom Lists, Qualification), `panels-extras.jsx` (Services, Custom Fields, Security, Integrations, Messaging, Subscription), `PayrollPanel.jsx`, `SystemPanel.jsx`, `DataImportPanel.jsx`; shared controls in `kit.jsx`. Payer rules: [PayerDetail.jsx](../../src/components/PayerDetail.jsx). Test ids use `set-` for settings and `pd-` for payer detail.

### Tests

`settingsMasters.test.js` (registry, resolvers, guards, cascades, normalization), `settingsModules.test.jsx` (all 13 modules and sub-tabs render and keep their selection), `settingsWrites.test.jsx` (each module's write persists, with Undo), `dataImport.test.js`, `abaHours.test.js`, `abaHoursUi.test.jsx`, `providerIds.test.js`, `payerTerms.test.jsx`, `payers.test.jsx`, `masters.test.jsx`, `mastersHub.test.jsx`, `security.test.js`, `securityUi.test.jsx`, `workspaceBackup.test.js`.

## Not yet built

- **No real connections.** Clearing house, EVV, clinical integrations, text messaging and the subscription portal store configuration or run local exports only. The Integrations panel has no API-key/token fields; recognized legacy credential fields are scrubbed on workspace load and excluded from backups. Any future live integration needs a server-side secret store first.
- **No real authentication.** Security is browser-local role-based access for demos.
- **Undo coverage.** Every durable settings write takes one Undo snapshot — planner transactions, raw `setSettings` writes (guard, smart scheduling, ABA, System panel fields, theme) and payroll policy. Payer add/remove and service and custom-field master edits do not (see the write path). Payer edits are undoable.
- **Qualification modifiers are billing-only.** They key off the staff record's education level and appear on claim lines; they do not drive a booking or authorization check.
- **Several Claims Settings fields are disabled as not available**: Box 17 and 19 options, Box 33B ID types, Claim File Options, Include Appointment Time, the taxonomy checkboxes and "Use Service Provider as Rendering Provider" are saved with the payer record but read by nothing, so the panel shows them disabled and labelled. The merge checkbox's label says same service provider, while the code also requires the same code, modifiers, rate and unit rule.
- **Mileage codes are manually verified.** The payer setting checks only that a code has 5 letters/digits and rejects the known-wrong `14220`; it does not determine whether a code is covered or correct for the payer. Verify it against the contract before use; no default is assumed.
- **Appointment Stop rules are write-time.** A Stop-severity validation refuses the write at the store layer — the booking dialog, Quick Add, drag-moves, series edits and CSV imports all land there — and flag-severity items persist on the session as badges. The authorization guard still runs at dialog level.
- Data Import does not parse Excel, run OCR or fetch from a network, caps at 500 rows, and has no per-row undo (a commit is one Undo step).
- Daily overtime and double-time settings are stored but not priced by payroll, and the panel labels them informational (see [Payroll](payroll.md)).
- `settings.risk` (cancellation-risk configuration) has no panel; defaults apply.
