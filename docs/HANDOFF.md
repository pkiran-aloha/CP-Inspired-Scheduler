# HANDOFF — where the work stands and what's next

Last updated **2026-10-06** (red-main fix, `fix/family-balances-date`). Any agent resuming work: read this file, then `AGENTS.md`, then act. Update this file whenever a feature lands.

- Repo: `https://github.com/pkiran-aloha/CP-Inspired-Scheduler` · branch `main` · live: `https://pkiran-aloha.github.io/CP-Inspired-Scheduler/`
- Local clone (maintainer): `C:\Users\PrateekKiran\Documents\GitHub\CP-Inspired-Scheduler` (an older clone at `C:\Users\PrateekKiran\aloha` is stale — ignore it)
- State at handoff: D3 (PR #26), B2 density (PR #27), the modal/PDF fix, the honest claim wording fix and the small-mismatch fix (#7, #9) and the doc-mismatch fix (#1–6) are on `main`. A parallel agent is working on the CMS-1500 form layout on the local branch `feat/cms1500-standard`; leave `cms1500.js` to that branch. Confirm the latest main/deploy run before choosing another feature.

## How the maintainer works

- **Plain git only, no `gh`.** The maintainer's terminal is **Windows PowerShell 5.1** (no grep/sed). Commands handed to them must be pure git and start with `cd C:\Users\PrateekKiran\Documents\GitHub\CP-Inspired-Scheduler`. Use `git for-each-ref` instead of `git branch | grep`.
- **npm is blocked on the work PC** (`EPERM … systemprofile`, no execution rights). `node` works. Tests run only in GitHub CI on push to `main` — see `AGENTS.md` → "Verifying without npm".
- Delivery style chosen: **one feature at a time** — build, land on `main`, wait for CI green, report, then the next. Ask before starting a new wave.
- The maintainer may use other agents (not only Claude). `AGENTS.md` is the shared rulebook; `CLAUDE.md`, `GEMINI.md`, `.github/copilot-instructions.md` point to it.
- Claude-specific: the ECC "Fact-Forcing Gate" hook blocks the first edit of every file; disable with env `ECC_GATEGUARD=off` (maintainer's call). Memory notes live in Claude's project memory dir.

## Shipped (newest first)

### Fix — date-dependent family-balance test (`fix/family-balances-date`)

- `main` went red on 2026-10-06 (run 37407890514, after a docs-only merge): `familyBalances.test.jsx` expected 3 families with a balance and got 4. Cause: on Tuesdays and Wednesdays the demo seed leaves a self-pay family invoice open (or, before this fix, denied), and an open self-pay invoice is a real family balance. The test meant "families owing a coinsurance share", so it now counts insurance balances only.
- Also fixed in the seed (`buildDemoClaims` in `seed.js`): the two demo denials (timely filing, verification) are payer reasons, and they could land on a self-pay invoice. Only insurance claims are picked now.
- Checked with node across 120 consecutive dates: always 3 coinsurance families and 2 insurance denials.

### CMS-1500 to the NUCC / CMS standard (`feat/cms1500-standard`)

- **Research basis.** NUCC 1500 Reference Instruction Manual v13.0 (07/25) for item content and formats; CMS Pub 100-04 ch. 26 §30 for the print spec (10-pitch pica: 10 characters per inch × 6 lines per inch, column 1 at 0.35 in, first print line 1.33 in down); field positions measured from the CMS 02/12 sample PDF and cross-checked against the CMS print-file table and OpenEMR's 02/12 generator. CMS, NUCC and the MACs accept paper claims only on forms printed in Flint J-6983 red dropout ink; photocopies and black-and-white prints are returned.
- **`src/lib/cms1500.js` rewritten in three layers.** `cms1500Data` returns NUCC item values (`items` keyed by item number). `layout1500` returns `{line, col, text}` on the grid. `claimTo1500` / `claimsTo1500` take `{ mode: 'copy' | 'data' }`. Data prints in black Courier 10 pt with 1.2 pt character spacing, so each character advances exactly 7.2 pt.
- **What was wrong before.** Boxes were misnumbered: timely filing days in "10", balance due in 30 (reserved since 02/12), account subdivision in 29, and the payer's own payment in 29 (it means patient and other payers). Retired qualifier 1D was used (now G2). Rendering IDs went in 33b (billing provider). Dates and money carried punctuation, ICD codes kept the dot, and diagnosis pointers cycled through numbers.
- **Both modes were verified visually.** The data-only print was overlaid on the official CMS sample form (pdf.js in the browser pane): every field and X mark landed inside its box.
- **UI.** The claim header has CMS-1500 (review copy) and Red form print (data only); Claims has 1500 Batch and Batch · red forms. Toasts say which is which and that nothing was sent.
- **Data.** Clients > Edit has Home address / City / State / ZIP (item 5; intake already carried them). The demo clients got fictional addresses. Provider-ID hint says G2.
- **Research also covered other forms:** UB-04, ADA and state Medicaid forms do not apply to ABA (all states sampled use the 1500/837P). Candidates for next slices: a family statement laid out per HFMA guidance (window-safe address, amount-due panel, account summary, aging, tear-off stub, no diagnosis codes), an out-of-network superbill (Cigna's required elements), a No Surprises Act Good Faith Estimate for self-pay families, and a secondary (COB) 1500 profile.
- **Not done:** printer X/Y calibration for the red-form print; per-payer page totals (total prints on the last page only); item 17 (no referring/supervising data); payer claim control number for item 22 (ERA CLP07 is not stored on the claim). The mileage line's code `14220` is a CPT surgery code, not a mileage HCPCS. It needs a payer-specific code, and is flagged for follow-up rather than changed.
- **Verification:** node run of the new assertions with jsPDF 4.2.1 (all pass). `cms1500.test.js` was rewritten, and `providerIds`/`payerTerms` tests were updated; these run in CI.

### Docs — mismatches #1–6 (`docs/mismatch-nits`)

- `AGENTS.md` names the real Python history files (`c33-*` to `c37-*`) and the two live scripts; the README says backup v3 (v2 still imports) at Settings → System → Data & backup; `docs/wiki/architecture.md` documents the `deploy.yml` legacy install fallback and the redundant `--run` flag. Docs only, no code or CI change.
- Still open from that list: #4 (unused `playwright` devDependencies; removal needs npm to regenerate the lock file), #8 (stored keys only), #10, #12, #13.

### Fix — small mismatches #7 and #9 (`fix/small-mismatches`)

- #7: `SecondaryBillingView.jsx`'s title read "Secondary Billing" while the nav, the Billing desk and the README say "Secondary Queue". The title and the Process gate message (`submitClaims` in `store.jsx`) now say "Secondary Queue". The `bil-secondary` route and `sb-` test ids are unchanged.
- #9: `ArManagerView.jsx` held a `clientPick` filter nothing ever set, so its "Clear filter" button (`ar-clear-filter`) could never show. Removed; no test referenced it.
- Remaining architecture mismatches after this and the docs fix: #4, #8 (stored keys only), #10, #12 (`build*` helpers only tests import), #13 (unenforced MFA/lock settings).

### Fix — honest claim wording (`fix/honest-claim-wording`)

- Architecture mismatches #8 and #11 (honest-software gap): Process said "N claims submitted", the claim history said "Claim submitted to <payer>", and Billed Files showed files as "sent" / "Delivered" with an "EDI" 837P count, though nothing ever leaves the browser.
- Now: the toast reads "marked submitted · file saved in Billed Files, nothing transmitted" (`submitClaims` in `store.jsx`); `submitPatch` in `claims.js` and the seed write "Marked submitted to <payer>; claim file saved locally, not transmitted" (self-pay: "Invoice marked sent to family …; the app sends nothing"); `BilledFilesView.jsx` labels stored status `sent` as **Exported**, the KPI "Saved locally", and the 837P KPI "Summary, not X12".
- Copy only: stored keys (`status: 'sent'`, `billedThrough: 'ch'`) are unchanged, so there is no migration; history entries already saved keep their old text. The CMS-1500 PDF note line ("e-file via ANSI 837P") is left to the parallel CMS-1500 layout branch.
- Tests: `claims.test.js` asserts the history wording; `billedFilesFlow.test.jsx` asserts "Exported" / "Saved locally" and that the stored status is still `sent`.

### Fix — modal overflow and PDF exports (`fix/modals-pdf-exports`)

- **Modals.** Cause: `.modal` clips at `max-height` with `overflow: hidden`, and the staff/client edit body (`.pm-body`) and profile body (`.pf-body`) were not scroll containers, so the footer CTAs fell outside the clip; the profile's action row did not wrap and pushed "Edit" off the right edge. Fix (appended block at the end of `styles.css`): those bodies scroll, every `.modal` scrolls as the fallback for any body that still is not a scroll container (deny reason, Quick book, Save report, Add Provider), footers wrap, the profile chips put the value under the label at full width. The avatar picker moved inside the scrolling body (`StaffView.jsx`, `ClientsView.jsx`). `ProviderIdView.jsx`'s Add/Edit Provider dialog used an undefined `.modal-backdrop` class and rendered with no overlay; it now uses `.overlay` + `.modal-head`.
- **PDF exports.** Cause 1: the payroll register (Process Payroll, Pay Runs) and Payroll Summary passed the jsPDF document itself to `downloadDoc`, which wrapped it as text: a 15-byte `[object Object]` file. `downloadDoc` (via `toBlob`) now renders a jsPDF document. Cause 2: jsPDF's standard fonts are WinAnsi; one character outside that set (the `→` in a statement's date range) made the whole line print as spaced UTF-16 gibberish. `winAnsi()` in `exportKit.js` wraps every generated document (reports, payroll, statements, intake, CMS-1500) and maps or drops such characters. Also: 1500 Batch no longer swallows a render error behind a success toast; page 1 of a multi-page export no longer says "continued"; register hours round to 2 decimals.
- **Verification:** reproduced each symptom on the deployed site in the browser pane, then re-measured with the CSS injected (edit footer in view at 1024×600, 1024×768 and 375×812; no horizontal overflow). PDF logic checked with node and a stub jsPDF. New `src/__tests__/pdfExports.test.jsx` covers the download, the encoding, the "continued" label and the payroll summary download; it runs in CI.

### B2 — scheduling density optimiser (PR #27, landed)

- **Density tab in Scheduler Insights.** `src/lib/density.js` ranks same-day moves that pull future, unclaimed clinical sessions into adjacent idle windows so a clinician's day becomes a tighter block instead of a split day. Suggestions keep the same staff, clients and duration; score uses split idle minutes saved, day-span savings, block reduction and newly opened half-days. The panel names the current slot, target slot, adjacent block, warnings and honest limits.
- **Reviewed local move.** `Move here` calls `planDensityMove` against live state before dispatching the existing one-appointment calendar move. It refuses stale suggestions, staff/client conflicts and Stop-level overlap/travel findings; warns are named. One appointment changes and the toast offers Undo. No drive-time records, recurring templates, family availability, messages or map/routing service are touched.
- **Verification:** focused `npx vitest run src/__tests__/schedulerInsights.test.js src/__tests__/schedulerInsights.test.jsx` passed (30 tests); full `npm test` passed (83 files / 844 tests); `npm run build` passed (Vite chunk-size warning only).

### D3 — intake-to-first-week handoff (PR #26)

- **Intake → first-week handoff.** A converted request and its client profile offer **Plan first week**. The conversion still lands on the profile. `intakeHandoff.js` proposes a practice-calendar week from scheduler-selected weekdays/time, session length, active authorized service and location. It subtracts existing clinical bookings, stays within the auth window and remaining unit pool (payer unit rules included), and shows up to three ranked staff per slot using `suggestStaff`, with reasons and practice/auth checks. Empty capacity and unfilled hours are explicit.
- **Reviewed writes only.** `IntakeHandoff.jsx` opens `AppointmentModal` per occurrence; its optional `onCreate` path delegates to `bookHandoffSession` → `planHandoffSession` → `handoffSessionTx`. The reducer replans against live state; Stop refuses, Warn is named, exact duplicate client slots are refused, and one appointment with the existing `intakeId` field is one Undo. Permissions: Calendar Full, Clients/Intake View, office-scoped records. No new durable fields/collections or migration.
- **Honest limits.** Proposals are ephemeral, not recurring series. One slot per selected weekday at the chosen time; this does not search all possible slots or confirm clinician working hours. Family preference text is shown but not parsed. Converted units/code and the weekly target still need payer-letter verification. First service shown in the handoff is derived from non-cancelled service appointments, not the assessment; the legacy intake `firstServiceDate` metric is not rewritten. Nothing is sent.
- **Verification:** focused pure/UI tests cover proposal budgets, ranking, dates, conflicts, empty/invalid states, conversion entry points, reviewed save/cancel, persistence, one Undo, backup round-trip, duplicate/stale writes and access. Local full suite: 83 files / 836 tests passed; after final guard refinements, all 28 D3 tests plus 9 wiki tests passed. Production build passed. GitHub PR tests/build passed (run `37312681223`); final landing-note updates also require green CI before merge. Browser visual check could not run because Chromium download failed in this sandbox (TLS/network).

### Earlier releases

- **Unified A/R aging engine.** The two aging engines are now one: `agingOf` ages claims exactly like `arOf` — any open primary receivable (draft, void, closed and zero-balance claims have no age) counts days from `submittedAt`, else `dosTo`, else `createdAt` (`agingSince`), into one five-bucket scheme (`agingBucketFor`: `current`, `31-60`, `61-90`, `91-120`, `121+`). The Billing desk strip, the claim drawer, the desk's aging sort and the Claims Register's days-out column now follow the same rule as the AR Manager, so a denied claim keeps aging while its balance is still owed. The AR Manager table shows 91–120 and 121+ as separate columns, matching the KPI strip, the drill chips and the CSV export. Covered by `claims.test.js` (desk buckets reconcile with the AR Manager's for the same claims) plus updated `payerTerms.test.jsx`. Architecture mismatches #7 and #8 are resolved.

- **A/R DSO consistency.** Billing Health now takes DSO from `arOf`, the same calculation used by the AR Manager: open primary A/R divided by average daily charges from primary non-void claims whose `dosFrom` is on or after the date 90 days before the as-of date; draft charges are included. The dashboard renders an em dash when there is no denominator, matching the AR Manager. Covered by `billingKpis.test.js` and `dashboard.test.jsx`. DSO mismatch #7 is resolved; the aging engines remain a separate mismatch.

Post-hackathon follow-ups (maintainer's order: 1 demo seed polish, 2 backlog fixes, 3 B3 travel routing, 4 payer qualification modifiers, 5 small correctness batch).
- **5, small correctness batch.** Three fixes. **Reports > Validations Auto-fill** (and the Billing-readiness rows and their `estCharge` in the same report) now use the payer's unit rule — payer override, then payer service, then service master, then the code — and its rounding, through `unitRuleFor`/`unitsFor`, so the number the report suggests is the number that lands; it used to divide the raw duration by the code's unit size and round to two decimals. **Appeals** no longer write a status: `fileAppeal` keeps the claim's own status (a denial stays Denied and stays in A/R) and stores an `appeal` marker; the new `appealOutcome` returns a won claim to Submitted awaiting the payer's payment instead of marking it Paid with no money posted, and Mark Lost leaves it Denied. Every claim status is now a `CLAIM_STATUSES` value, the desk KPIs count the claim again, and a saved workspace that still holds the retired `appealed` status is healed on load by `normalizeAppealedClaims`. **Payer edits** are one Undo — the profile fields, the inline list cells and the Billing Rules panels (Payment Terms already was); the payer-contract cleanup inside a service delete passes `noSnap` so it cannot leave a half-Undo behind, and service and custom-field master edits still take no snapshot. Tests: `autoFillUnits.test.js`, `appeals.test.jsx`, plus new cases in `store.test.js` and `mastersHub.test.jsx`.
- **4a, payer qualification modifiers + staff education** (`education` on staff rows and in the staff form, `qualificationModifiersFor` + `staffQualifierTokens` in `claims.js`, `DEFAULT_QM` moved to `model.js`, `EDUCATION_LEVELS`/`QUAL_MODIFIER_KEYS`, `normalizeStaffEducation` in `master.js`, PayerDetail qual panel readiness line, demo staff educated). Cause: the payer's Qualification Modifiers rows are keyed by education level, but staff records carried no education field, so the setting could never apply. Now the first row whose level matches the rendering provider's education — or a "·" part of their role/cert, so Teacher/Therapist/Specialist rows still work — contributes its pair to the line between the credential and the POS modifier; blank modifiers add nothing, duplicates collapse, the four-modifier cap holds, and a rendering provider with no level recorded gets no qualification modifier (the panel says how many staff that is). The default rows were trimmed to the education code alone (the old `U6` first modifier is an hourly code that should not land on every claim because of a degree); saved payer rows are untouched. Tests: `qualificationModifiers.test.js` (11), updated `claimModifiers`/`mastersHub`/`masters` expectations.
- **1a, demo records** (`src/lib/demoRecords.js`, called by `blankState` and `reseed`). Eight Cabinet documents (one expired, two due within 30 days), eight CEU/PDU entries, five tasks and three messages, built through the real planners and dated relative to today. Tests that need an empty collection now start from `{ ...blankState(), cabinet: {} }` and similar.
- **1b, team task notifications** (`notificationsFor` in `tasks.js`). The demo admin stays unlinked on purpose: `normalizeSecurity` forces `staffId: null` on the system account. Instead, an account with no staff link is told about the whole team's overdue and due-today tasks ("2 team tasks are overdue"). Linked accounts still see only their own.
- **1c, demo family balances** (`seedFamilyShares` in `seed.js`, applied in `blankState` and `reseed`). Three paid insurance claims (one per client, clients without secondary coverage) become partially paid: the payer paid 10% less and reported it as coinsurance. `paymentsFromClaims` now carries `remittance.patientResp` and dates an open claim's payment by `remittance.at`. Item 1 (demo seed polish) is complete.
- **2a, staff qualification matching** (`heldQualifications` in `settingsMasters.js`). Cause: held values were compared whole, so cert "BCBA #5-12-0034" and role "BCBA · Clinical Supervisor" never matched the BCBA qualification; every staff member except one whose role was exactly "BCBA" got the Staff Qualification chip, RBTs on 97153 included. Now each value is also read as its "·" parts, without the "#number", and through the qualifications' "Applies to" job titles.
- **2b, one Convert button** (`IntakeDetail.jsx`). The Overview's "Conversion readiness" panel no longer has its own `iq-convert` button; `iq-advance` in the Next box is the only way in. The panel now shows a status line (`iq-convert-note`).
- **2c, intake booking checks** (`scheduleIntakeAssessment` in `store.jsx`). The visit stays client-less by design, but the draft now goes through `evaluateAppointmentValidations`: Stop items refuse it ("Not booked. Staff Overlap: …"), Warn items are appended to the confirmation ("Review: …"). Client checks cannot apply before conversion. Item 2 (backlog fixes) is complete.
- **3a, B3 travel feasibility Slice1** (`src/lib/travel.js`, `settingsMasters.js`, `panels-practice.jsx`, `bookingChecks.js`). Pure travel engine: haversineMi, estimateTravelMinutes (1.3× road factor at 25 mph +5 min buffer, tight +10), resolveApptLocation (office lat/lng seeded for Main Center etc + client geo [lat,lng], skips telehealth/unknown), travelLeg, travelChecksForStaffDay (prev/next per clinician, severity impossible/tight, message "needs about X min from Y to Z; gap is N min" + honest copy "estimated from straight-line distance; not a map route"), routeForDay and suggestRouteOrder for Slice2 reuse, TRAVEL_DEFAULTS. Office master now has lat/lng optional with validation (both or neither, -90..90/-180..180) and normalization backfills demo coords. DEFAULT_OFFICE_ROWS seeded with San Jose coords. New rule staff.travel defaults Warn, merged in normalizeSettingsMasters. evaluateAppointmentValidations adds travel checks per staff per day. candidateVerdicts inherits via validation. Booking dialog Checks rail shows travel under Practice rules. Tests: travel.test.js (8). Item 3 Slice1 complete.
- **3b, B3 travel route view Slice2** (`SchedulerInsights.jsx`, `styles.css`, `travel.js`). Scheduler Insights (I) new Travel tab: per staff per day route — legs with from→to, gap, travel needed, distance, severity (impossible/tight/ok), totals (miles straight, travel min, counts), suggested re-order read-only (greedy nearest-neighbor) with miles saved, nothing moves. Uses routeForDay and suggestRouteOrder. Honest copy, no map API. Styles si-travel, si-leg, etc. Item 3 (B3) complete.

Hackathon wave 6: Integrations, honest partial (#3, #11, #12). This wave is complete.
- **Slice 1, telehealth room link** (`telehealthRoomFor` and `isWebUrl` in `settingsMasters.js`). Reuses the existing `int-telehealth` integration row's `roomUrl`; `integration.patch` now refuses a non-`https://` link. The booking dialog shows it for POS-10 locations and `buildICS` takes an optional `roomFor` to add it to `.ics` events. One practice-wide room; no per-staff rooms yet.
- **Slice 2, per-staff `.ics`** (`staffCalendar` in `ics.js`, buttons `stf-ics-<id>` in `StaffView.jsx`). Next 90 days, date-ordered, telehealth room included, client names dropped without Clients access. No live feed: a subscribable URL needs a server.
- **Slice 3, online payment link** (`int-paylink` row, `paymentLinkFor` in `settingsMasters.js`, "Pay online" row in `statementDoc`). `integrationsCfg` now appends default rows missing from a saved list, so older workspaces get the row without a migration. Recording stays the existing patient receipt (method Card); no new payment method. Link-only ("Reference data") rows hide the API key fields.

Hackathon wave 5: Inbox (#1 + #2). This wave is complete.
- **Slice 2, messages** (`messages.js`, the Inbox's Messages tab).
  - Uses a `messages` collection, keyed by **account** ids rather than staff ids: the demo admin has no `staffId`.
  - Threads are filtered to their participants in the lib, not by office scope. On a shared device the data is in localStorage anyway.
  - The `record` reducer now accepts `items[]` and `noSnap`; read receipts use both so they take no Undo slot.
  - `areasForUndo` skips `tasks` and `messages`.
- **Slice 1, tasks and notifications** (`tasks.js`, `InboxView.jsx`, opened by the top-bar envelope `inbox-open`, `ui.inboxPanel`).
  - Notifications are derived and not stored, filtered by `canAccess`.
  - Adds a `tasks` collection. Its record action needs no area (`actionAreas` returns `[]`), and an undo of tasks needs no area. Office scope comes from the linked client or the assignee.
  - Note: `ui.inbox` is the older needs-cover panel; this is a separate panel.
  - A security review asked for client names to be hidden from roles without Clients. The picker, the linked label and `planTask` now respect `canAccess` (`4e12be2`).
  - The demo's signed-in account has no `staffId`; since 1b it sees team-wide task notifications instead of "my tasks".

Hackathon wave 4: Records (#4, #10, #13). This wave is complete.
- **Slice 3, Credentials & PDUs** (`credentials.js`, report `credentials`, Cabinet → Training & CEU log).
  - Follows the maintainer's choice: BACB baseline plus practice PDUs.
  - Adds a `pdus` collection (security area `staff`, office scope by staff member) and the settings op `credentials.patch` (`settings.credentials.rbtPduHours`, default 12).
  - The RBT supervision % covers the last 30 days. The renewal date comes from the staff member's latest credential document in the Cabinet.
- **Slice 1, client statements** (`statements.js`, Generate Invoice → Issue statement + Statements list).
  - Uses a new `statements` collection, wired into `WORKSPACE_FIELDS`, backup (an older v3 file starts empty), security (`statement` records are office-scoped by client, billing area) and the `record` reducer.
  - Each statement can be downloaded as a PDF, marked sent with a delivery method, or voided with a reason. Its balance is live.
  - Since follow-up 1c the demo seed has three family balances, so statements can be issued straight away.
- **Slice 2, Cabinet** (`cabinet.js`, `CabinetView.jsx`, Staff → Cabinet sub-section).
  - Uses a new `cabinet` collection.
  - Security: area `staff`, office scope by owner (staff office, client offices, or all for practice documents).
  - Backup: an older v3 file starts empty.
  - Alerts show in a banner and on the Staff rail badge when a document is expired or due within 30 days.
  - Records are archived, not deleted, and only metadata is stored.

Hackathon wave 3: Intake (#5). This wave is complete.
- **Slice 3, intake UX fixes:**
  - The first-call form requires only the essentials.
  - Gate items have a **Fix** button (`gateFixTab` in `IntakeCommon.jsx`).
  - Conversion opens the new client's profile (`ui.cliOpen`).
  - Names are unified to "Intake Requests" / "New Intake".
  - The assessment visit is still booked without a client (by design: the family becomes a client at conversion), but since follow-up 2c it runs the Appointment Validations. The duplicate `iq-convert` button was removed in 2b.
- **Slice 1, conversion carries the data forward** (`planConversion` in `intake.js`).
  - **Approved units:** they now land in the client's unit pool as `{97153: units}`, flagged "verify against the payer letter". They used to be divided as if they were hours.
  - **Weekly hours:** `authWeekly` is units × 15 min ÷ weeks.
  - **Fields carried to the chart:** member ID, group, auth #, diagnosis, BCBA and emergency contact.
  - **Claims:** `memberIdOf` / `authNoOf` print the chart's real values (secondary filings use the secondary's). They fall back to the demo placeholder only when blank.
  - **Client form:** gains Member ID and Authorization # fields.

- **Slice 2, intake PDFs** (`src/lib/intakeDocs.js`). Two downloads, generated locally:
  - **Intake packet** (worklist toolbar): blank fields, a documents checklist and consent signature lines.
  - **Summary PDF** (drawer header): the full record.


- **Help & Wiki screen** (`HelpView.jsx`, `src/lib/wiki.js`): rail footer button + Cmd/Ctrl+K; renders and searches the bundled `docs/wiki` (incl. the FAQ) for every role. `wiki.test.js` also guards the wiki's `_Sources:` and links in CI.
- **Docs: platform wiki + marketing copy** (`docs/wiki/`, `docs/marketing/README.md`). Kept current by the landing rule in `AGENTS.md` (pages list their source files). `docs/wiki/architecture.md` ends with known doc/code mismatches worth fixing.

Hackathon wave 2: configurable billing (#8). This wave is complete: all 6 slices are green on `main` (last one is `f814780`). The plan and the audit are in `docs/specs/configurable-billing.md`.
- **Slice 1, Payment Terms** (Payer → Billing Rules → Payment Terms; `planPayerTerms`, `filingDaysOf` in `claims.js`). The payer record's `policy` now drives:
  - claim aging
  - the copay estimate
  - the payment presets
  - CMS-1500 box 7b

  Filing days use one rule everywhere: payer, then practice default, then policy. Saving is validated and has one Undo.
- **Slice 2, Medicaid unit norms.** The maintainer chose Medicaid norms as the compliance baseline.
  - The ABA codes and H2019 bill in 15-minute units with the midpoint rule. Rates are per 15-minute unit; the charge per hour is unchanged.
  - Billed units use `unitRuleFor`, the same rule chain as the authorization ledger (payer override, then payer service, then service master, then code). `unitsFor` now lives in `model.js`.
  - Reports → Validations warns when same-day sessions for one code and client round to a different total than the day counted once.
  - One-time migration `normalizeUnitNorms` (`meta.unitNorm15`). It never changes claims.
- **Slice 3, claim-line modifiers** (`lineModifiers` in `claims.js`). The order is: payer service modifier, then credential modifier (Medicaid norm; switch `rules.claims.flags.credentialMods`), then payer POS modifier. `posFor` moved to `claims.js` and now uses CMS POS codes: community 99, and 12 replaces the mislabelled 06. No migration was needed. Saved payer POS rows keyed `06` (unlikely) would need re-picking as `12`.
- **Slice 4, CMS-1500 from the payer record.** These boxes now read the payer and client records:
  - box 1 from `cmsType`
  - 7a and 10 from `ext.group` and `ext.plan` ("—" when blank, never invented)
  - box 6 from `client.secondary`
  - box 32 from the `rules.claims.box32` rule

  Other changes: no invented practice NPI, and the MEDICARE checkbox bug is fixed. Box 17 still waits on referring-provider data.
- **Slice 5, claim split rules.**
  - **Merge Same Day** (`mergeSameDayLines`, on by default). A merged line carries `apptIds`. **Always read a line's appointments through `lineApptIds(l)`**, never `l.apptId` alone. This applies to the gate, submit, release, drop, rebill, security scope, the seed and the auth migration.
  - **Separate Claim By** splits the plan key by rendering provider or by POS.
  - The Validations same-day warning now fires only for payers that turned the merge off.
- **Slice 6, editable denial reasons and CARC hints** (Settings → System → Billing Settings).
  - They are saved in `settings.billing.denialReasons` and `carcHints` through the `billing.reasons` settings op (`planReasonLists`).
  - `denialOf(id, state)` and `eraDenialInfo(line, state)` read them.
  - The defaults are in `claims.js`.

Hackathon wave 1 — billing (from the departments' hackathon list):
- **Billing Health dashboard widget** (`billingKpis.js`): clean-claim %, denial %, net collection %, cash posted, days in A/R, A/R >90 %, charge lag, recoupments; formula + target on hover; on the default board (last); saved boards add it from the gallery.
- **Authorization Utilization report** (`reports.js` → `authUtil`): per client × code across the auth window; used / expected / projected %, status, renewal flag (30 days or 75 %), "Verify" for converted units.
- **Recoupments** (`paymentLedger.planRecoupment`, Payment Center → + Recoupment): primary claims only; reopens balance; negative ledger line; one Undo.
- **Provider ID rule — NPI / Medicaid ID / both** (`providerIds.js`, Payer → Billing Rules → Provider IDs): drives validation, claim gate (only once a payer sets it), CMS-1500 23b/33a/33b. Also fixed the false "Missing NPI" flag on every clinician.

Booking dialog UX:
- **Know-before-you-pick** verdict chips on every staff/client in the pickers (`bookingChecks.js`); one **Checks** rail panel replacing four banners (`BookingChecks.jsx`); drawn severity icons; rail no longer hidden ≤1180px (it held the only Save button).

Scheduling intelligence round:
- **Authorization unit ledger + payer rule packs** (`authUnits.js`): per-code unit pools on clients (editor in Clients → Edit), payer unit size/rounding (AMA default), MUE daily + weekly caps, credential check; migration converts weekly hours → units (flagged "verify").
- **Cancellation reasons + root cause** (`cancelReasons.js`): reason required when cancelling; Reports → Cancellation Root Cause; practice-side cancels excluded from risk history.
- CI: Node 22, v5 actions, runner pinned `ubuntu-24.04`, tests run on PRs too.

Fixes: status-removal reassignment, payer template delete crash, send-for-approval, SecurityView import, read-only settings Seg, IntakeDetail hook order, current user from the demo account switcher.

## Next

B2 density, B3 travel, follow-up 4, the small correctness batch, DSO consistency and the unified A/R aging engine are complete or in the current branch as noted above. Remaining open items are in the waves table "Still open" notes and "Known issues / backlog" below, plus the `docs/wiki/architecture.md` mismatch list. D3 is implemented above, not a new selection. Pick one with the maintainer: one of the smaller architecture mismatches (the `build*` document helpers only tests import, or any of the remaining doc/code items), access holdout (B4), overbooking guidance (C4), caseload ramp forecast (D1), hire/contract decision support (D2), scenario planner (D4), or a backlog item. The DSO formula and both aging-engine mismatches are resolved.

Spec reference for B3: `docs/specs/scheduling-intelligence-ideas.md` (§4 B3, §6 item 2, §7 honesty constraints). Shipped: travel.js pure engine (1.3× road factor at 25 mph +5 buffer, honest copy), office lat/lng, staff.travel Warn, booking dialog Checks rail, candidate verdicts, Scheduler Insights Travel tab with legs and suggested re-order read-only.

## Hackathon waves (all shipped)

| Wave | Items | Notes / open questions |
|---|---|---|
| ~~Configurable billing (#8)~~ (shipped 2026-10-04) | "We didn't have to submit hard-code requests for billing" | All 6 slices have shipped (see Shipped above and `docs/specs/configurable-billing.md`). Medicaid norms are the compliance baseline. Still open, small:<br>• the "stored but unused" list at the end of the spec<br>• box 17 (referring provider) and Supervising Provider: both need data that isn't recorded yet |
| ~~Intake (#5)~~ (shipped 2026-10-04) | Download forms; request → intake → client flow; "make intake easy and convenient UX-wise" | All three slices have shipped (see Shipped above). Still open:<br>• an `impeccable` critique of the intake screens has not been run |
| ~~Inbox, tasks, notifications (#1 + #2)~~ (shipped 2026-10-05) | Message center + task assignment + notifications | Tasks, notifications and messages have shipped. Local, in-workspace only (no delivery off-device, no client portal). The demo admin's missing staff link is handled by team-wide task notifications (follow-up 1b). |
| ~~Records (#4, #10, #13)~~ (shipped 2026-10-04) | Client statements; Cabinet expirations; RBT PDU report | All three slices have shipped (see Shipped above). Still open:<br>• demo family balances, Cabinet and CEU data shipped 2026-10-05 (follow-ups 1a, 1c)<br>• statements are never delivered by the app, and Cabinet stores no files |
| ~~Integrations, honest partial (#3, #11, #12)~~ (shipped 2026-10-05) | Telehealth link; Apple/Google calendar; Stripe | All three slices have shipped (see Shipped above). Still open: per-staff video rooms; a subscribable calendar feed and real Stripe reconciliation both need a backend. |
| ~~Scheduling idea B3~~ (shipped 2026-10-05) | Travel feasibility & route sequencing | Both slices shipped: Slice1 travel check in booking dialog (office lat/lng, staff.travel Warn, candidate verdicts), Slice2 per-clinician day route view in Scheduler Insights Travel tab (legs, travel minutes, tight/impossible, suggested re-order read-only with miles saved, nothing moves). Honest copy, no map API. |
| #15 | "Remove pop-up that payer is not on list" | Not present in this app (it's a production-Aloha complaint). Keep it that way. |

## Known issues / backlog (not yet fixed)

- Recoupments: secondary / COB-linked claims refused (scope v1).
- Integrations panel stores API keys in plain local settings (needs the backend).
- `impeccable detect` flags 22 thick colored left-border accents in older CSS (outside recent work).

## Resume prompts (paste into a new session; any agent)

These work in Claude Code, Codex, Cursor, Copilot, Gemini or any agent that can read the repo and run git. Agents without a local clone should first clone `https://github.com/pkiran-aloha/CP-Inspired-Scheduler`.

**Let me pick the next work:**

> Read `docs/HANDOFF.md` and `AGENTS.md`. Sync with GitHub (`git fetch`, confirm `main` matches `origin/main`, report anything new). Then list what is left (HANDOFF "Next", the "Still open" notes in the waves table, and "Known issues / backlog"), recommend one item, ask me which to build, and follow the one-feature-at-a-time workflow.

**Status check only (no code changes):**

> Read `docs/HANDOFF.md` and `AGENTS.md`. Run `git fetch`, compare `main` with `origin/main`, and check the latest CI run for `origin/main` via `https://api.github.com/repos/pkiran-aloha/CP-Inspired-Scheduler/actions/runs?head_sha=<sha>`. Report what changed since HANDOFF was last updated and whether `main` is green. Do not edit anything.

**Fix a red `main`:**

> Read `docs/HANDOFF.md` and `AGENTS.md`. `main` is red. Find the failing CI run for `origin/main` and its annotations (`…/check-runs/<job id>/annotations`), reproduce the failure as narrowly as you can, fix it on a `fix/…` branch with a regression test, land it and confirm CI is green. Touch nothing else.
