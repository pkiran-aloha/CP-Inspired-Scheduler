# HANDOFF — where the work stands and what's next

Last updated **2026-10-03** (end of session). Any agent resuming work: read this file, then `AGENTS.md`, then act. Update this file whenever a feature lands.

- Repo: `https://github.com/pkiran-aloha/CP-Inspired-Scheduler` · branch `main` · live: `https://pkiran-aloha.github.io/CP-Inspired-Scheduler/`
- Local clone (maintainer): `C:\Users\PrateekKiran\Documents\GitHub\CP-Inspired-Scheduler` (an older clone at `C:\Users\PrateekKiran\aloha` is stale — ignore it)
- State at handoff: `main` green and deployed; working tree clean.

## How the maintainer works

- **Plain git only, no `gh`.** The maintainer's terminal is **Windows PowerShell 5.1** (no grep/sed). Commands handed to them must be pure git and start with `cd C:\Users\PrateekKiran\Documents\GitHub\CP-Inspired-Scheduler`. Use `git for-each-ref` instead of `git branch | grep`.
- **npm is blocked on the work PC** (`EPERM … systemprofile`, no execution rights). `node` works. Tests run only in GitHub CI on push to `main` — see `AGENTS.md` → "Verifying without npm".
- Delivery style chosen: **one feature at a time** — build, land on `main`, wait for CI green, report, then the next. Ask before starting a new wave.
- The maintainer may use other agents (not only Claude). `AGENTS.md` is the shared rulebook; `CLAUDE.md`, `GEMINI.md`, `.github/copilot-instructions.md` point to it.
- Claude-specific: the ECC "Fact-Forcing Gate" hook blocks the first edit of every file; disable with env `ECC_GATEGUARD=off` (maintainer's call). Memory notes live in Claude's project memory dir.

## Shipped (newest first)

Hackathon wave 6: Integrations, honest partial (#3, #11, #12). In progress.
- **Slice 1, telehealth room link** (`telehealthRoomFor` and `isWebUrl` in `settingsMasters.js`). Reuses the existing `int-telehealth` integration row's `roomUrl`; `integration.patch` now refuses a non-`https://` link. The booking dialog shows it for POS-10 locations and `buildICS` takes an optional `roomFor` to add it to `.ics` events. One practice-wide room; no per-staff rooms yet.

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
  - Gap: the demo's signed-in account has no `staffId`, so "my tasks" notifications never show for it. Link the demo admin account to a staff record in the seed to fix this.

Hackathon wave 4: Records (#4, #10, #13). This wave is complete.
- **Slice 3, Credentials & PDUs** (`credentials.js`, report `credentials`, Cabinet → Training & CEU log).
  - Follows the maintainer's choice: BACB baseline plus practice PDUs.
  - Adds a `pdus` collection (security area `staff`, office scope by staff member) and the settings op `credentials.patch` (`settings.credentials.rbtPduHours`, default 12).
  - The RBT supervision % covers the last 30 days. The renewal date comes from the staff member's latest credential document in the Cabinet.
- **Slice 1, client statements** (`statements.js`, Generate Invoice → Issue statement + Statements list).
  - Uses a new `statements` collection, wired into `WORKSPACE_FIELDS`, backup (an older v3 file starts empty), security (`statement` records are office-scoped by client, billing area) and the `record` reducer.
  - Each statement can be downloaded as a PDF, marked sent with a delivery method, or voided with a reason. Its balance is live.
  - The demo seed has no family balances, so the list starts empty.
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
  - Still open (small): two convert buttons (`iq-advance` at the auth stage and `iq-convert`). The assessment visit is booked without a client and bypasses the booking guards.
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

## Next — remaining hackathon items (ask the maintainer which wave)

| Wave | Items | Notes / open questions |
|---|---|---|
| ~~Configurable billing (#8)~~ (shipped 2026-10-04) | "We didn't have to submit hard-code requests for billing" | All 6 slices have shipped (see Shipped above and `docs/specs/configurable-billing.md`). Medicaid norms are the compliance baseline. Still open, small:<br>• the "stored but unused" list at the end of the spec<br>• box 17 (referring provider) and Supervising Provider: both need data that isn't recorded yet |
| ~~Intake (#5)~~ (shipped 2026-10-04) | Download forms; request → intake → client flow; "make intake easy and convenient UX-wise" | All three slices have shipped (see Shipped above). Still open:<br>• one Convert button instead of two<br>• the assessment visit is booked without a client and bypasses the booking guards<br>• an `impeccable` critique of the intake screens has not been run |
| ~~Inbox, tasks, notifications (#1 + #2)~~ (shipped 2026-10-05) | Message center + task assignment + notifications | Tasks, notifications and messages have shipped. Local, in-workspace only (no delivery off-device, no client portal). Still open: link the demo account to a staff record (see Shipped). |
| ~~Records (#4, #10, #13)~~ (shipped 2026-10-04) | Client statements; Cabinet expirations; RBT PDU report | All three slices have shipped (see Shipped above). Still open:<br>• the demo seed has no family balances, Cabinet documents or CEU entries, so these screens start empty<br>• statements are never delivered by the app, and Cabinet stores no files |
| **Integrations, honest partial (#3, #11, #12)** | Telehealth link; Apple/Google calendar; Stripe | Store the practice's own video link; per-staff `.ics` download; Stripe *payment link* + manual recording. Real sync/charging needs a backend — say so in the UI. |
| Scheduling idea B3 | Travel feasibility & route sequencing | From `docs/specs/scheduling-intelligence-ideas.md` §6; deferred by the maintainer. |
| #15 | "Remove pop-up that payer is not on list" | Not present in this app (it's a production-Aloha complaint). Keep it that way. |

## Known issues / backlog (not yet fixed)

- `staffSatisfiesQualification` may flag BCBAs on BCBA-only codes ("Staff Qualification" chip on a BCBA for 97151) — investigate the qualification `covers` matching.
- Payer "Qualification Modifiers" rows are keyed by education level, but staff have no education field — modifiers can't be derived per staff yet.
- Recoupments: secondary / COB-linked claims refused (scope v1).
- Integrations panel stores API keys in plain local settings (needs the backend).
- `impeccable detect` flags 22 thick colored left-border accents in older CSS (outside recent work).
- Merged remote branches still on GitHub: `docs/agents-handoff` and later feature branches. The maintainer deletes them with `git push origin --delete …`.
- Generic payer edits (the `payer` action, `patch` mode) take no Undo snapshot. Only Payment Terms does.

## Resume prompt (paste into a new session)

> Read `docs/HANDOFF.md` and `AGENTS.md`. Sync with GitHub (`git fetch`, confirm `main` matches `origin/main`, report anything new). Then ask me which hackathon wave to build next, recommending one, and follow the one-feature-at-a-time workflow.
