# HANDOFF — where the work stands and what's next

Last updated **2026-10-07** (payer-specific mileage-code follow-up started after the configuration-audit remediation and D1 practice-days follow-up). Any agent resuming work: read this file, then `AGENTS.md`, then act. Update this file whenever a feature lands.

- Repo: `https://github.com/pkiran-aloha/CP-Inspired-Scheduler` · branch `main` · live: `https://pkiran-aloha.github.io/CP-Inspired-Scheduler/`
- Local clones (maintainer), both tracking `main`:
  - `C:\Users\PrateekKiran\Documents\GitHub\CP-Inspired-Scheduler`: the main checkout. Git works there, but node/npm cannot write under `Documents` (see below).
  - `C:\Users\PrateekKiran\dev\CP-Inspired-Scheduler`: **use this one to run tests, the dev server and builds.** It has `node_modules` and `.claude/launch.json`.
  - An older clone at `C:\Users\PrateekKiran\aloha` is stale. Ignore it.
- State at handoff (2026-10-06): `origin/main` is `83ba96c` — PR #32 (cancellation notice in the risk model, C4 follow-up) merged, CI green (run 37491879917, deployed); before it `8a352cc` (PR #31, C4 confidence-threshold picker). Newest first today: cancellation notice (this branch), C4 confidence-threshold picker, Windows test fix, D2 hire/contract, D1 caseload ramp, B4 access holdout, `cancelledAt`, C4 booking-dialog overbooking flag, C4 overbooking guidance, Good Faith Estimate, superbill, family statement, CMS-1500 rebuild. Either local clone may sit behind: run `git pull --ff-only` in it before building.
- State at handoff (2026-10-07, audit remediation): `origin/main` is `0411c2c` (PR #36). Branch `arena/e8f5fefe-cp-inspired-scheduler` holds the seven remediation commits; PR #37 is open with the `build` CI job green on the final head and lands on `main` as a merge commit (the `deploy` job runs on `main` only, so it fires after the merge).

## How the maintainer works

- **Plain git only, no `gh`.** The maintainer's terminal is **Windows PowerShell 5.1** (no grep/sed). Commands handed to them must be pure git and start with `cd C:\Users\PrateekKiran\Documents\GitHub\CP-Inspired-Scheduler`. Use `git for-each-ref` instead of `git branch | grep`.
- **The full suite runs on the work PC** (verified 2026-10-06: 910/910), with three workarounds documented in `AGENTS.md` → "Commands":
  - work in the `dev` clone, because Windows Controlled Folder Access blocks node writes under `Documents`;
  - start npm through node with `--preserve-symlinks --preserve-symlinks-main`, because `C:\nvm4w\nodejs` links into `systemprofile`;
  - set `NODE_OPTIONS=--no-experimental-webstorage` and pass `--testTimeout=20000`, because Node 25's built-in localStorage hides jsdom's.

  An agent's shell can run the suite directly in the `dev` clone: `NODE_OPTIONS="--no-experimental-webstorage" node node_modules/vitest/vitest.mjs run --testTimeout=20000`. Leave `npm ci` to the maintainer. GitHub CI on `main` is still the gate.
- Delivery style chosen: **one feature at a time** — build, land on `main`, wait for CI green, report, then the next. Ask before starting a new wave.
- The maintainer may use other agents (not only Claude). `AGENTS.md` is the shared rulebook; `CLAUDE.md`, `GEMINI.md`, `.github/copilot-instructions.md` point to it.
- Claude-specific: the ECC "Fact-Forcing Gate" hook blocks the first edit of every file; disable with env `ECC_GATEGUARD=off` (maintainer's call). Memory notes live in Claude's project memory dir.

## Work started (not yet landed)

### Billing follow-up — payer-specific mileage code (2026-10-07)

- **What.** The Billing staging list no longer labels mileage as CPT `14220`. Masters → Payer → Billing Rules → Claims Settings has an optional, payer-specific 5-character CPT/HCPCS mileage code. The app never guesses a code; `14220` is rejected as a surgery code, not mileage.
- **Safety.** An insurance mileage line without a valid payer code is marked **Needs code** and held by the claim gate. CMS-1500 export refuses a missing or invalid mileage code. Set the payer-approved value or remove mileage if it is not covered, then void/rebuild a draft assembled before the setting was saved or changed. Self-pay lines do not get a payer code. Existing claim snapshots are not rewritten; invalid or out-of-date historical mileage codes display as **Needs code** and cannot be exported on a CMS-1500.
- **Verification.** Focused claims/CMS-1500/payer-settings/Billing tests pass. Full `npm test`: **96 files, 1,000 tests passed**. `npm run build` passes; Vite still warns that the main JS bundle is over 500 kB (the existing REL-01 bundle-splitting issue, intentionally out of scope). JSDOM canvas/navigation and payer-list key warnings are pre-existing, unrelated and non-failing.

## Shipped (newest first)

### Visual Checks rail in the booking dialog (`feat/visual-booking-rail`, 2026-10-07)

- **What.** The maintainer asked for the rail to be less texty and more visual, with a crisper note about the analytics and the decision. Same checks and rules; nothing new is estimated.
  - **Decision line** (`booking-checks-status`): *Fix before booking* / *Review before booking* / *Almost there* / *Clear to book* / *Ready to book*, plus glyph counts per tone ("2 to review"). A missing required field never reads as clear, even beside a note (the old header said "Good to book, with notes" in that case).
  - **At a glance** (`bk-glance`): authorized hours as a used / booked / left bar (overage + cap mark when over) and the authorization week (`bk-glance-auth`); each picked clinician's week load vs target (`bk-glance-load`); chips for risk score + band, drive minutes and past sessions together (`bk-chip-risk`, `bk-chip-drive-<id>`, `bk-chip-cont-<id>`). Every bar is `role="meter"` with `aria-valuetext`, and its numbers are printed beside it.
  - **Each group**: headline + one line in view (all to-dos; first two practice rules); more lines, notes, foot and the exact auth numbers / units sit behind **Details** (`aria-expanded`). Open slots are time chips (`bk-slot-<i>` kept). The auth group's own bar moved to the glance block; its numbers ("…h committed · …") stay in the group's details.
  - One footnote at the bottom: worked out on this device from the workspace's data; nothing is sent or booked until you save.
- **Code.** `src/lib/railGlance.js` (pure: `railDecision`, `authMeter`, `loadMeter`, `riskChip`); `staffFit` in `pickFit.js` now also returns raw `hours`, `target`, `travelMin`, `past`; `slotParts` splits a slot for the chip. CSS appended at the end of `styles.css` (both themes via the tone tokens; reduced motion respected).
- **Visual check.** Built app screenshotted with Playwright (Edge) at 1400px in light and dark; the <1180px stacked layout was not captured (the rail placement CSS is unchanged).
- **Verification.** `railGlance.test.js` (8) + one UI case in `bookingChecks.test.jsx` (decision line, week-load meter value text, continuity chip, Details disclosure, nothing saved). Full suite 100 files / 1,047 tests green before the merge of `origin/main`; `npm run build` green (chunk-size warning only).

### Pick fit and open slots — smarter booking pickers (`feat/smart-scheduling-picks`, 2026-10-07)

- **What.** `src/lib/pickFit.js` adds context at the point of decision, reusing existing engines (`suggestStaff`, `authBurn`, `travelChecksForStaffDay`/`travelLeg`, `riskFor`, `clinicianGroup`, `practiceDaysOf`):
  - **Staff rows** (`bk-pick-facts`): past sessions with the client or **New to**; hours this week after the booking vs `targetWeekH` (flag when over; 30 h fallback like StaffView/reports); straight-line drive estimate from the previous appointment that day.
  - **Client rows** (clinical): authorized hours booked this week vs the authorized week (flag under the guard's under-pace %), days to expiry inside `expiryWarnDays` else % used, usual weekday × time band over 8 weeks (marked when this slot matches).
  - **Badge** (`bk-best-fit`): one **Best fit** (top `suggestStaff` score among clear/flag candidates — same ranking as "Suggested for this client") or **Most hours open** (client with the most authorized hours open this week). **A–Z / Ranked** switch (`bk-pick-sort`), A–Z by default so the list order people know (and tests that click item 0) is unchanged.
  - **Checks rail `bk-fit`** (flag): continuity (picked clinician has no past sessions with the client while another has ≥3), caseload balance (over target hours; names a free same-tier peer under 75% of target), and **open slots** (`bk-slot-<i>`) when the slot clashes: ≤3 in the next 7 practice days, inside `settings.workday`, from today, nobody picked busy/blocked, never a slot the travel check calls impossible; ranked same day → near the asked time → joins a block → high risk last. A click only fills date/time; save is the normal path.
- **Fix along the way.** The modal's "Suggested for this client" passed `load: 0` for every clinician, so it claimed "Light week · 0 sessions" for everyone; it now passes `weekLoad` for the booking week.
- **Decisions taken conservatively (maintainer may revisit):** pickers open A–Z, not ranked; tunables are constants (`FIT_LOOKBACK_WEEKS` 8, `USUAL_MIN` 3, `PEER_UNDER` 0.75, `SLOT_DAYS` 7, `SLOT_LIMIT` 3), no Settings UI; QuickAdd untouched (a parallel recurrence branch edits it); open slots only appear when the chosen slot clashes.
- **Verification.** `pickFit.test.js` (11) + 2 UI cases in `bookingChecks.test.jsx` (facts/badge/ranking; clash → slot → saved at the slot's time). Full suite 97 files / 1,013 tests green before docs; `npm run build` green (chunk-size warning only).

### Recurrence — Google-style repeat rules and series edits (`feat/recurrence-series`, 2026-10-07)

- **Bugs fixed (each has a regression test):**
  - Monthly on the 31st clamped to the 30th. It now skips, as Google does.
  - "All/This & following" edits copied the edited session's status, verification signature, documents and billing to every sibling (a completed session marked the whole series completed). They also reset exceptions and rewrote completed or billed sessions.
  - "This & following" never split the series, and a rule change only worked for "this occurrence".
  - A rule rebuild was three dispatches (three Undo steps) and deleted completed, billed or claimed future sessions. Series delete removed claimed, completed and payroll-locked sessions silently.
  - A dragged occurrence was not marked as an exception.
  - A no-show in the slot counted as a clash.
  - The series edit test was pinned to a fixed date.
- **What.**
  - `src/lib/recurrence.js`: the rule engine (daily/weekly/monthly/yearly, interval, weekdays, month day / nth / last weekday, ends never / until / count, a 12-month cap, words, presets), locks, occurrence screening and `planSeriesTx`. `RecurrenceEditor.jsx` is the picker.
  - Scope choices: this occurrence / this & following / all on edit, delete and cancel. The detail card asks for the reason, then the scope.
  - New action `seriesTx`: one Undo, with `actionAreas` and record-scope entries.
  - `rrule` is stored on every occurrence. `normalizeRecurrence` migrates legacy series and is idempotent. Restore refuses a bad `rrule`. The intake handoff refuses an `rrule` or `seriesId`.
  - `model.js` drops `RECURRENCES`, `seriesDatesFor`, `planScopedPatch`, `planSeriesRebuild` and `mapSeriesDate`; `store.jsx` drops `removeSeries`.
- **Decisions taken as Google's behaviour (maintainer may change):**
  - The default end is **Never**, capped at 12 months. It was 8 occurrences before.
  - A rule change replaces single-session exceptions in the rebuilt range.
  - Delete removes the record. There is no EXDATE memory, so a later rule rebuild can bring back a deleted date.
- **Our own safety choices:**
  - Rebuilds never create or delete past dates.
  - A series cancel only touches today and later sessions.
  - Status, verification, documents and billing state never propagate across a series.
  - Completed, cancelled/no-show, billed or claimed sessions and sessions in approved/processed pay sheets are kept and counted.
- **Not done:** no holiday calendar exists (closed weekdays are only warned). Yearly rules inside the 12-month cap yield one date. The ✎ glyph on TimeGrid/TimelineView exception markers is unchanged.
- **Verification.** `recurrence.test.js` (24) + `recurrenceUi.test.jsx` (5); existing app/store tests updated. Full suite 98 files / 1,025 tests green; `vite build` green (bundle-size warning unchanged).

### Audit remediation — configuration-audit findings CFG-02…CFG-12 (branch `arena/e8f5fefe-cp-inspired-scheduler`, 2026-10-07)

- **What.** The open findings from `docs/audits/configuration-audit-2026-10-07.md`, fixed in seven commits on the Arena branch (PR #37 — build CI green; landing on `main`):
  - **CFG-04/10/11** — client/guardian and staff signatures separated (own pads, own gates, Quick Verify honours the payer rule); canonical `staffSigRequiredToComplete` key with legacy read; integration categories on all default rows; "Maximum Appointment Length" copy no longer claims a hard ceiling.
  - **CFG-08/09** — every inbox alert gated by its preference (12 wired keys, 6 no-source toggles removed, browser toasts for stop-tone alerts); `enableEra` wired to the Payment Center; gateway methods / portal columns normalized to one shape; honest stub banners for the remaining no-ops.
  - **CFG-02/03** — Stop-severity validation rules are a write-time invariant in the reducer (`create`/`update`/`move` refuse; cancelling is never blocked); Warn requires an acknowledgement tick (persisted as `warnsAcked`); Flag items persist as session badges; series create/edit/rebuild and CSV import validate every occurrence/row against live state plus already-accepted ones and report rejected dates/rows.
  - **CFG-12/05** — every durable settings write is one undoable transaction (`setSettings` snapshots `settings`); daily/double-time/seventh-day payroll controls labelled informational (the wage engine prices weekly only).
  - **CFG-06** — unimplemented Claims Settings options (Box 17/19, 33B/33B2, file grouping, appointment time, taxonomy/rendering checkboxes) disabled and labelled "not available"; "Separate Claim By" drops "Supervising Provider"; POS "Hide POS-10" now removes telehealth locations from the booking picker for that payer's clients ("Hide POS-02" disabled — no location codes POS-02).
  - **CFG-07** — custom-field scopes enforced in both pickers (appointment / payer; legacy templates keep the old behaviour); textarea renders; saved Text Format (number/email/phone/URL) validated at save; "Required once added" labelled honestly; payer copy no longer promises automatic appointment/export propagation.
- **Verification.** Full suite **95 files / 995 tests green**; `npm run build` green (bundle-size warning unchanged); wiki (`settings`, `payroll`, `scheduling`, `billing-and-claims`, `architecture`), the audit report (per-finding resolution statuses) and this file synced. New tests: `signatureRules.test.jsx`, `notifications.test.jsx`, `writeGuard.test.jsx`, `customFields.test.jsx` plus focused additions.
- **Still open (by design):** CFG-01 production architecture (P0 gate, decision not code); CFG-05 jurisdictional payroll calculator + legal review; REL-01 dependency upgrades (vitest major is a dev-only project) and bundle code-splitting — triaged and documented in the audit report.

### D1 follow-up — configurable practice days (built 2026-10-07)

- **What.** System Settings → Display & workspace now lets the practice select one or more open days (Sunday–Saturday; Monday–Friday by default). The Ramp tab counts clinical supply only on those days, while preserving working-hour and blocked-time calculations. At least one day must stay selected. The selected days are named in the Ramp header and its explanatory note.
- **Compatibility.** Workspaces without `settings.practiceDays` retain the old Monday–Friday behavior. Malformed or empty values also safely fall back to that default.
- **Verification.** `ramp.test.js` covers weekend-only capacity and fallback; `sections.test.jsx` covers changing and persisting the setting and preventing an empty selection. (Run full suite/build before landing.)

### C4 follow-up — cancellation notice in the risk model (PR #32, landed at `83ba96c`)

- **What.** The at-risk worklist now honours the practice's late-cancel notice threshold: a **family-side** cancellation that gave more notice than `settings.billing.lateCancelHours` (24 h by default) stops counting as a lost slot — in the client's own attendance rate, the missed-session streak and the practice-wide base rate alike. No-shows, cancellations under the threshold, cancellations with no time recorded, and cancellations whose reason is missing or practice-side count exactly as before.
- **One threshold, two engines.** `cancelNoticeHoursOf(settings, fallback)` and `cancelledEarly(a, hours)` in `cancelReasons.js` own the rule; `risk.js` reads them, and `overbook.js` now reads the same setting instead of its own `overbookLateHours` constant (the constant stays as the fallback, `cfg.lateHours` reports the effective value). The Billing desk's Setup tab got the row that was missing (`bi-latecancel`, clamped 0–168 h): the setting was stored but editable nowhere before.
- **Honesty.** The Risk tab adds a line (`si-risk-notice`) saying how many family cancellations record their notice and how many were spared; when none carry a time it says the rule has nothing to weigh instead of implying it applied data it does not have. A cancellation's side is read from its reason, never assumed. The model's loss check now uses `isCancelStatus`, matching the backtest, so a practice-defined cancellation status counts.
- **Demo data.** Seeded cancellations get a deterministic notice spread across the 24 h line (hash-based, so the seed RNG stream is untouched) and about one in ten keeps no time at all, so the honest "notice unknown" case stays visible.
- **Verification.** `schedulingRisk.test.js` +6 (neutral / late + undated / the setting and its fallback / practice-side + reason-less / custom cancel status / notice coverage and copy), `cancelReasons.test.js` +3 (sanitized threshold, `cancelledEarly` edges, deterministic seed notice), `overbook.test.js` +1 (12 h vs 48 h moves the line; off-menu falls back), `sections.test.jsx` +1 (the Billing row persists and clamps), `schedulerInsights.test.jsx` +1 (the notice line names the threshold and where it lives). Full local suite 89 files / 932 tests green; `npm run build` passed (chunk-size warning only).
- Closes the "Not done: using `cancelledAt` in the risk model" note and the waves-table C4 "still open"; `settings.billing.lateCancelHours` comes off the "Stored but read by nothing" list in `docs/specs/configurable-billing.md`.

### C4 — confidence-threshold picker (PR #31)

- **What.** Scheduler Insights → Overbooking has a **Confidence threshold** row (`si-ob-threshold`): 70 / 80 / 90 (default 80). Both C4 checks — the weekly backtest and the binomial odds — must clear the chosen bar. The copy names the trade: 70 marks more blocks on weaker evidence, 90 only very reliable ones, 80 is the cost-ratio default (turning a family away costs about 4× an idle hour).
- **Setting.** `settings.risk.overbookSafePct`, one `setSettings` write like the B4 holdout picker on Coverage; no migration (missing means 80). `overbookSafePctOf` (in `overbook.js`) sanitizes: only 70/80/90 are honored, anything else falls back to 80, so a hand-edited workspace cannot smuggle in an off-menu bar.
- **Honest limits.** Advisory only: nothing booked, moved or sent; the picker changes which blocks are marked, never the ledger.
- **Verification.** `overbook.test.js` +2 (sanitization incl. the board's `cfg.safePct`; a 75%-lossy block marked at 70 and left out at 80 on the same ledger) and one UI case in `schedulerInsights.test.jsx` (picker persists and re-renders). Full local suite 89 files / 920 tests green; `npm run build` passed (chunk-size warning only).

### D2 — hire/contract decision support

- **What.** A read-only verdict strip on Scheduler Insights → Ramp (`si-hire-verdict`): **hours gap (hire/contract)**, **template problem (do not hire yet)**, **do not hire on this number**, or **not enough on-screen hours to tell**.
- **Requirements settled with the maintainer first:** decision question = demand vs schedule shape; numbers = ramp short weeks + Coverage fill of the range on screen (85% bar, same as Coverage’s full-day mark); lives on the Ramp tab, not its own tab or a report; thin data is named, never invented.
- **Honesty.** Demand is not split by RBT vs BCBA, so it names hours, never a headcount. Intake is never weighted by a conversion rate. Renewals are never assumed. Fill unknown when the on-screen range has no bookable hours. Advisory: nothing hired, contracted, booked or sent. Supply on the ramp is still Mon–Fri.
- **Code.** `src/lib/hire.js`: `hireBoard({ ramp, coverage })`, `HIRE_HIGH_UTIL`. `insightBoard` returns it as `hire`. `SchedulerInsights.jsx` renders the strip.
- **Verification.** `hire.test.js` (neither / hire at high fill / reshape at low fill / thin / no clinical bench / intake unweighted / insightBoard wiring) plus the Ramp UI test asserts the strip.
### Fix — tests pass on a Windows checkout (`fix/crlf-test-fixtures`)

- **Cause.** Git's `core.autocrlf` checks the 835 fixture out with CRLF on Windows. `eraPosting.test.js` and `paymentCenterEra.test.jsx` edit that text with search strings containing `~\n`, which then never match, so 6 tests failed locally (CI on Linux was fine). The parser itself was not at fault: `parse835` trims each segment, and a CRLF file parses identically (now asserted).
- **Fix.** Both tests normalize the fixture to LF when they read it, and `.gitattributes` keeps `src/__tests__/fixtures/**` LF on checkout. AGENTS.md "Commands" now documents running the suite on the Windows work PC: a clone outside `Documents` (Controlled Folder Access), npm called through node, and `--no-experimental-webstorage` for Node 25.
- **Verification:** full suite on the work PC (Node 25, Windows) with the fixture forced to CRLF: 910/910 passed.

### D1 — caseload ramp (PR #28)

- **What.** Scheduler Insights → **Ramp** tab (`si-tab-ramp`): the next 12 practice weeks (`RAMP_WEEKS`, honouring `settings.weekStart`), one row per week. Demand = each active client's `authWeekly` for as long as `authStart → authEnd` runs, plus open intake requests at their requested hours in a separate lighter band from their target date. Supply = each clinician's working day (`settings.workday`) minus blocked-out time — the Coverage tab's denominator — counted Mon–Fri (no practice-days setting exists yet; the panel says so), split RBT vs BCBA vs other clinical by `clinicianGroup` (free-text role/cert, tolerant matching; non-clinical staff excluded). Weeks where demand+intake exceeds supply are flagged; the header names the first short week.
- **Requirements were settled with the maintainer first** (round-1 grilling): demand definition incl. the intake band, supply definition, 12-week horizon with table + simple bars, expiry handling, read-only Insights tab — all five as recommended in the draft.
- **Honesty (§7).** A ramp from known work, never a statistical forecast: intake is never weighted by a conversion rate; requests without recorded hours are counted as such; an authorization ending inside the horizon drops to zero and the week is marked "renewal pending" — renewals are never assumed; already-lapsed clients contribute nothing. Read-only: no action, field, collection or migration; nothing booked, moved or sent.
- **Code.** `src/lib/ramp.js`: `rampBoard(state, {today, weeks})`, `intakeWeeklyHours` (recommended hours, else requested units over their window, 80 h/week cap like conversion), `clinicianGroup`, `RAMP_OPEN_DOWS`. `insightBoard` returns it as `ramp`; `SchedulerInsights.jsx` renders the tab (rows `si-ramp-w-<start>`, `si-ramp-summary`, `si-ramp-empty`, `si-ramp-renewal-<start>`, `si-ramp-short-<start>`). Styles appended to `styles.css`.
- **Verification.** `ramp.test.js` (14 tests: demand windows, expiry marking, lapsed/discharged exclusion, intake band dates/units/undated/no-hours, terminal stages left out, supply blocking + tier split + non-clinical exclusion, week-start, short weeks, `insightBoard` wiring, grouping) and two UI cases in `schedulerInsights.test.jsx` (12 rows + honest copy, empty state). Full local suite: 88 files / 910 tests green; `npm run build` passed.

### B4 — access holdout (`feat/access-holdout`)

- **What.** Scheduler Insights → Coverage has an **Access holdout** row with Off / 10% / 15% / 20% (default 10%, the 10–15% the NAM scheduling review describes). `coverageBoard` keeps that share of each hour's bookable staff time, from today on, and counts booked time past the remaining share as the holdout eaten: `summary.holdout` `{pct, reservedHours, eatenHours, keptPct, eatenCells}` and per-cell `eatenHours`. Eaten weekday-hours are outlined (dashed warn outline) on the heat grid, with a legend entry and the hours in the cell tooltip.
- **Setting.** `settings.risk.holdoutPct` (0–50; anything else falls back to 10 via `holdoutPctOf`). It lives in `settings.risk` because that block already routes to the calendar permission, so a scheduler can change it without the Settings desk. One `setSettings` write; no migration (missing means 10).
- **Honest limits.** Advisory only: it never refuses a booking and is not a booking-dialog check. Past hours are not counted. It is practice-wide per hour, not per clinician or office, and does not tell new starts apart from other bookings.
- **Tests.** `schedulerInsights.test.js` (3: default share, chosen share and off, past hours) passed in node; `schedulerInsights.test.jsx` (picker persists) runs in CI.

### C4 — calibrated overbooking guidance (`feat/overbooking-guidance`)

- **Research basis (settled with the maintainer before building).** 97153 is one patient face to face; one technician billing two clients for the same minutes is the "overlapping service times" finding in the OIG ABA Medicaid audits (Indiana, Wisconsin, Colorado), and payers such as Anthem Indiana Medicaid refuse it. ABA practices handle losses with floaters, cross-training and waitlist backfill, not clinician double-booking. Overbooking literature (LaGanga & Lawrence; Zeng et al.; NAM *Getting to Now*) treats losses as binomial and sets the threshold as a cost ratio: 80% means turning a family away costs about 4× an idle hour. Scoring families for overbooking overbooks disadvantaged families (Samorani et al.), so guidance is per block only.
- **`src/lib/overbook.js`.** `overbookBoard(state, {today})` groups resolved clinical sessions from the last 12 weeks by office (only when there are several) × weekday × time band (`riskTimeBand`). Lost = no-show or family cancellation; practice cancellations (`isPracticeCancel`) are left out. A block needs 8 weeks with sessions to be rated. It is marked for k = 1 or 2 extra sessions only when both the weekly backtest (lost ≥ k in ≥ 80% of its weeks) and the binomial odds for the sessions booked on its next day (`atLeast`, block rate shrunk toward the practice rate with `shrinkCohort`) reach `settings.risk.overbookSafePct` (80, no Settings UI). Marked blocks list up to three standby clients whose `authBurn` band is `under` and who have nothing in that block. `insightBoard` returns it as `overbook`.
- **UI.** Scheduler Insights → **Overbooking** tab (`si-tab-overbook`, rows `si-ob-[office-]<dow>-<band>`, empty state `si-ob-empty`): weeks, sessions, % lost and % no-shows per block, a status chip, the reason in words, standby names, and **Show** to open the block's next day. Read-only: no new action, field, collection or migration.
- **Demo data.** The demo seed has about 3 sessions per block per week, so no block clears 80% (it would need about 10–18). The tab says so per block; the tests use a dense fixture instead of changing the seed.
- **Verification:** `overbook.test.js` (11) passed in node through a small vitest shim; `schedulerInsights.test.jsx` gained 3 UI tests (tab, empty state, Show), run in CI.
- **Booking-dialog hint (`feat/overbook-booking-hint`).** A new clinical booking whose weekday × time band is marked gets a `flag` group in the Checks rail (`appt-overbook`, built in `AppointmentModal.jsx` from `overbookBlockFor`): the backtest line plus "never as a second client on the same clinician". Create mode only; never blocks. Tests: one pure case in `overbook.test.js`, two UI cases in `schedulerInsights.test.jsx`.
- **Cancellation time (`feat/cancelled-at`).** `stampCancelledAt` in `cancelReasons.js` runs inside the `patch` and `upsertMany` reducer cases: entering a cancellation status (not no-show) stamps `cancelledAt` (ISO), leaving one clears it, staying cancelled keeps what was known (nothing, for an old cancellation). Other appointment writers (claims, settings cascades, data import) do not stamp: they are not a cancellation by a person. Deliberately **no migration**: backfilling would invent a time. Restore refuses a non-date `cancelledAt`. `overbook.js` leaves out family cancellations with `cancelLeadHours` > `overbookLateHours` (24) and counts the undated ones it still includes. Tests: `cancelReasons.test.js`, `store.test.js`, `workspaceBackup.test.js`, `overbook.test.js`.
- **Not done:** nothing outstanding from this slice. (The 70/80/90 threshold picker has since shipped — PR #31 — and the `cancelledAt` notice rate in the risk model shipped after it: see the entry above.)

### Good Faith Estimate (`feat/good-faith-estimate`)

- **What.** A No Surprises Act Good Faith Estimate for uninsured or self-pay families, opened from the client profile (**Good Faith Estimate**, `pf-gfe`). `src/lib/gfe.js` provides:
  - `suggestGfeRows`: units per week per code from the client's sessions booked in the 4 weeks from the start date, falling back to the 4 weeks before.
  - `planGfe` (pure): validates the start date, 1 to 12 months, rows and 2-decimal rates.
  - `gfePdf`.
  - `GFE_DISCLAIMER` and `GFE_SEPARATE_DISCLAIMER`.
  `src/components/GfeDialog.jsx` holds the editable rows, live total and download.
- **Rule check (45 CFR 149.610(c)(1), eCFR 2026-09-01 snapshot, and the CMS standard form OMB 0938-1433):**
  - patient name/DOB
  - primary service in plain language with the date
  - itemized services with diagnosis code, service code, quantity and expected cost
  - provider name, NPI, TIN, location and state
  - the separately-scheduled list with its boxed disclaimer
  - the recurring scope (frequency, period, count; at most 12 months, "valid for 12 months")
  - the model disclaimer verbatim, plus the (c)(1)(viii) and (c)(1)(x) statements the model page omits
  - $25 is the latest published PPDR fee (CY2023 guidance; no newer guidance found); co-provider estimates are still under enforcement discretion
- **Not done:**
  - no stored GFE record: the practice saves the PDF, and the 6-year production duty sits with the practice
  - no comparison of statements to an issued GFE (the $400 dispute threshold)
  - no "right to receive a GFE" notice page for the practice's website and office
  - no language-assistance taglines
- **Verification:** demo estimates were rendered with node + jsPDF and viewed in the browser pane. The pure assertions pass in node. `gfe.test.jsx` (pure + profile-dialog download) runs in CI.

### Superbill for out-of-network families (`feat/superbill`)

- **What.** A superbill (an itemized statement a family submits to its own insurer for services it paid itself). `src/lib/superbill.js` has three functions. `superbillClaims` returns self-pay claims, never draft, void or secondary, with a date of service in the range. `superbillView` is pure; `superbillPdf` draws the letter portrait PDF. The Generate Invoice client row has a **Superbill** button (`gi-superbill-<clientId>`), shown when the client has self-pay services in the page's range.
- **Fields** (Cigna behavioral-health member claim form list plus common payer expectations):
  - provider name, address, phone, tax ID and billing NPI
  - patient name, DOB, address, account number; subscriber (guardian, Child), plan and member ID, printed only when real (blank fill-in lines otherwise)
  - ICD-10-CM codes; rendering providers with certification and NPI
  - per line: DOS, POS, CPT/HCPCS, modifiers, units, pointer, rendering provider and charge
  - totals (charges, paid by patient, balance); attestation and signature/date line; "This is not a bill."
- **Why self-pay only:** services the practice billed to an insurer must not be resubmitted by the family.
- **Verification:** rendered a 24-line demo superbill (2 pages) with node and jsPDF 4.2.1 and viewed it in the browser pane. The pure assertions pass in node. `superbill.test.jsx` (pure + UI download) runs in CI.
- **Not done:** e-signature (the signature line is for a wet signature); a per-line rendering NPI column (NPIs are listed in the rendering-providers block); Good Faith Estimate (next candidate).

### Family statement to HFMA guidance (`feat/family-statement`)

- **Why.** The old statement PDF was a generic key/value document (via `docToPdf`): no due date, no proof of what insurance paid, no envelope-window layout, no remittance stub. Research basis: HFMA patient-friendly billing ("clear, concise, correct"; see at a glance what the plan paid and what you owe; whom to call), HIPAA practice for mailed bills (only the addressee shows through the window; no diagnosis), the No Surprises Act GFE / patient-provider dispute rules (45 CFR 149.610: $400 threshold, 120 days from the bill) for self-pay lines.
- **`src/lib/statements.js`.** `statementDoc` was replaced by `statementView` (pure: guarantor block, due date = statement date + `settings.billing.dueDays`, per-claim charges / insurance paid / adjustments / your share / paid since / you owe, aging buckets from each claim's last DOS, payment link, notices) and `statementPdf`, which draws it with jsPDF (letter; header, #10 window address block at 0.875in, amount-due panel, account summary, activity table, aging, messages, dashed tear line and remittance stub on page 1, continuation pages, page numbers, VOID stamp). It prints no diagnosis, member ID or DOB. A void statement shows nothing owed.
- **Verification:** rendered sample statements with node + jsPDF 4.2.1 and viewed them with pdf.js in the browser pane (1-claim, 4-claim with self-pay notice, 18-claim two-page, void). New assertions run in node; `statements.test.jsx` and `paymentLink.test.jsx` were updated and run in CI.
- **Not done:** Section 1557 language-assistance taglines (needed when the practice takes federal funds; would be a settings block with a per-family opt-out); a per-guarantor "send to" override for confidential communications (45 CFR 164.522(b)); previous-balance carry-forward between statements; a definitions page on the back.

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
- **Not done:** printer X/Y calibration for the red-form print; per-payer page totals (total prints on the last page only); item 17 (no referring/supervising data); payer claim control number for item 22 (ERA CLP07 is not stored on the claim). The mileage-code follow-up is implemented and verified locally but not yet landed (see above); no default is assumed, and each payer must supply a contract-approved mileage code.
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
- **Slice 3, online payment link** (`int-paylink` row, `paymentLinkFor` in `settingsMasters.js`, "Pay online" row in `statementDoc`). `integrationsCfg` now appends default rows missing from a saved list, so older workspaces get the row without a migration. Recording stays the existing patient receipt (method Card); no new payment method. Follow-up: no integration row accepts API keys/tokens; recognized legacy credential fields are scrubbed from local workspace writes and backups (no server-side vault exists).

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

The C4 threshold picker (PR #31) and its cancellation-notice follow-up have shipped, so **C4 has no open items left**. The D1 practice-days follow-up also shipped 2026-10-07, and the **configuration-audit remediation** was delivered the same day as PR #37 from branch `arena/e8f5fefe-cp-inspired-scheduler` (build CI green, merged to `main`) — CFG-02…CFG-09, CFG-11, CFG-12 resolved; CFG-01 (production architecture) and REL-01 (dependency upgrades, bundle splitting) remain open by design, documented in the audit report. The payer-specific mileage-code follow-up is implemented and verified locally but not yet landed; see above. **Recommended next after it:** printer X/Y calibration for red-form print or another billing-form follow-up; D4 scenario planner is large.

Other open items, smaller:
- D1 follow-up: intake conversion tracking once enough history exists (still never a forecast knob).
- D4 scenario planner (L).
- Billing-form follow-ups (each "Not done" in the CMS-1500, statement and GFE entries above):
  - printer X/Y calibration for the red-form print;
  - a secondary (COB) 1500 profile;
  - Section 1557 language taglines on statements (a settings block with a per-family opt-out);
  - a per-guarantor confidential "send to" address;
  - comparing statements against an issued GFE (the $400 dispute threshold).
- Architecture mismatches still listed in `docs/wiki/architecture.md`: #4 unused `playwright` devDependencies (npm now works in the `dev` clone, so the lock file can be regenerated there); #10; #12 `build*` helpers that only tests import; #13 unenforced MFA/lock settings.
- "Known issues / backlog" below.

**How this session built safely alongside a parallel agent:** every feature was built in a scratch git worktree from `origin/main` (`git worktree add -b feat/x <scratch>/dir origin/main`), never in the shared checkout; before landing, `git merge origin/main` into the branch (README/HANDOFF/wiki "Last synced" lines conflict often: keep both new sections, take the newer sync line), then `git checkout --detach origin/main && git merge --no-ff feat/x && git push origin feat/x HEAD:main`, then poll `actions/runs?head_sha=<sha>` until green. Since the end of this session the full suite, JSX included, also runs locally in the `dev` clone (see "How the maintainer works").

## Hackathon waves (all shipped)

| Wave | Items | Notes / open questions |
|---|---|---|
| ~~Configurable billing (#8)~~ (shipped 2026-10-04) | "We didn't have to submit hard-code requests for billing" | All 6 slices have shipped (see Shipped above and `docs/specs/configurable-billing.md`). Medicaid norms are the compliance baseline. Still open, small:<br>• the "stored but unused" list at the end of the spec<br>• box 17 (referring provider) and Supervising Provider: both need data that isn't recorded yet |
| ~~Intake (#5)~~ (shipped 2026-10-04) | Download forms; request → intake → client flow; "make intake easy and convenient UX-wise" | All three slices have shipped (see Shipped above). Still open:<br>• an `impeccable` critique of the intake screens has not been run |
| ~~Inbox, tasks, notifications (#1 + #2)~~ (shipped 2026-10-05) | Message center + task assignment + notifications | Tasks, notifications and messages have shipped. Local, in-workspace only (no delivery off-device, no client portal). The demo admin's missing staff link is handled by team-wide task notifications (follow-up 1b). |
| ~~Records (#4, #10, #13)~~ (shipped 2026-10-04) | Client statements; Cabinet expirations; RBT PDU report | All three slices have shipped (see Shipped above). Still open:<br>• demo family balances, Cabinet and CEU data shipped 2026-10-05 (follow-ups 1a, 1c)<br>• statements are never delivered by the app, and Cabinet stores no files |
| ~~Integrations, honest partial (#3, #11, #12)~~ (shipped 2026-10-05) | Telehealth link; Apple/Google calendar; Stripe | All three slices have shipped (see Shipped above). Still open: per-staff video rooms; a subscribable calendar feed and real Stripe reconciliation both need a backend. |
| ~~Scheduling idea C4~~ (shipped 2026-10-06) | Calibrated overbooking guidance | Read-only Overbooking tab in Scheduler Insights; block-level, never two clients on one clinician. Booking-dialog hint, cancellation time, the 70/80/90 confidence-threshold picker (PR #31) and the late-cancel notice rate in the risk model (2026-10-06, one threshold shared with the backtest) shipped too. Still open: nothing. |
| ~~Scheduling idea B3~~ (shipped 2026-10-05) | Travel feasibility & route sequencing | Both slices shipped: Slice1 travel check in booking dialog (office lat/lng, staff.travel Warn, candidate verdicts), Slice2 per-clinician day route view in Scheduler Insights Travel tab (legs, travel minutes, tight/impossible, suggested re-order read-only with miles saved, nothing moves). Honest copy, no map API. |
| ~~Scheduling idea D1~~ (built 2026-10-06, PR #28; practice-days follow-up 2026-10-07) | Caseload ramp forecast | Read-only Ramp tab in Scheduler Insights: 12 practice weeks of authorized demand plus the intake band (never weighted by a conversion rate) against clinician supply (working day minus blocked time, on the configurable practice days; Monday–Friday default, split RBT vs BCBA); expiry weeks marked renewal pending, renewals never assumed. Practice days are editable in System Settings → Display & workspace. Still open: intake conversion tracking once enough history exists (never a forecast knob). |
| ~~Scheduling idea D2~~ (built 2026-10-06) | Hire/contract decision support | Read-only verdict strip on the Ramp tab: hours gap vs template problem from short weeks + Coverage fill (85%). Hours, never a headcount. Thin data named, never invented. |
| #15 | "Remove pop-up that payer is not on list" | Not present in this app (it's a production-Aloha complaint). Keep it that way. |

## Known issues / backlog (not yet fixed)

- Cross-module configuration audit completed 2026-10-07: see [prioritized findings](audits/configuration-audit-2026-10-07.md). **Remediation landed 2026-10-07 on branch `arena/e8f5fefe-cp-inspired-scheduler`** (see the Shipped entry above): CFG-02…CFG-09, CFG-11 and CFG-12 resolved with tests; CFG-05 resolved by labelling; CFG-06/CFG-07 resolved by disabling/labelling and scope enforcement; REL-01 triaged and deferred (vitest major upgrade and bundle splitting are separate projects). Still open: **CFG-01** — the production hosting/auth/HIPAA architecture gate (P0; a decision, not a code fix) — and the CFG-05 jurisdictional payroll calculator + legal review. Suite on the branch: 95 files / 995 tests green; build green with the bundle-size warning; dependency advisories unremediated by design (documented in REL-01).
- Recoupments: secondary / COB-linked claims refused (scope v1).
- Integration secrets: API-key/token inputs have been removed and recognized legacy fields are scrubbed by the local workspace/backup paths. This does not provide a secret vault; future live integrations still require the production backend architecture.
- `impeccable detect` flags 22 thick colored left-border accents in older CSS (outside recent work).

## Resume prompts (paste into a new session; any agent)

These work in Claude Code, Codex, Cursor, Copilot, Gemini or any agent that can read the repo and run git. Agents without a local clone should first clone `https://github.com/pkiran-aloha/CP-Inspired-Scheduler`. On the work PC, run tests and builds in `C:\Users\PrateekKiran\dev\CP-Inspired-Scheduler` (see "How the maintainer works").

**Let me pick the next work:**

> Read `docs/HANDOFF.md` and `AGENTS.md`. Sync with GitHub (`git fetch`, confirm `main` matches `origin/main`, report anything new). Then list what is left (HANDOFF "Next", the "Still open" notes in the waves table, and "Known issues / backlog"), recommend one item, ask me which to build, and follow the one-feature-at-a-time workflow.

**Continue with the next item in the queue:**

> Read `docs/HANDOFF.md` and `AGENTS.md`. Sync with GitHub (`git fetch`, confirm `main` matches `origin/main` and its latest CI run is green). Then take the next item from HANDOFF "Next" and build it on a `feat/…` branch: settle requirements first, tests (run the full suite locally in the `dev` clone first), wiki/README/HANDOFF/marketing sync, land on `main`, confirm CI green, report.

**Status check only (no code changes):**

> Read `docs/HANDOFF.md` and `AGENTS.md`. Run `git fetch`, compare `main` with `origin/main`, and check the latest CI run for `origin/main` via `https://api.github.com/repos/pkiran-aloha/CP-Inspired-Scheduler/actions/runs?head_sha=<sha>`. Report what changed since HANDOFF was last updated and whether `main` is green. Do not edit anything.

**Fix a red `main`:**

> Read `docs/HANDOFF.md` and `AGENTS.md`. `main` is red. Find the failing CI run for `origin/main` and its annotations (`…/check-runs/<job id>/annotations`), reproduce the failure as narrowly as you can, fix it on a `fix/…` branch with a regression test, land it and confirm CI is green. Touch nothing else.
