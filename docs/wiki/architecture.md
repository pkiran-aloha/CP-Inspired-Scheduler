# Architecture

_Sources: AGENTS.md, README.md, package.json, vite.config.js, src/App.jsx, src/test/setup.js, src/lib/exportKit.js, .github/workflows/deploy.yml, scripts/write-version.cjs, scripts/build-share.mjs, src/state/store.jsx, src/lib/security.js, src/lib/workspaceBackup.js, src/lib/master.js, src/lib/wiki.js, src/lib/claims.js, src/lib/billingKpis.js, src/components/HelpView.jsx_
_Last synced against main on 2026-10-08 (Vitest 4, `npm audit` clean; mismatch #10 resolved on fix/cms1500-derived-values); unrelated behavior unchanged._

This page is for developers: where code lives, how a change flows from a click to localStorage, the testing rules, how `main` is built and deployed, and where the existing docs disagree with the code. The rules themselves live in [`../../AGENTS.md`](../../AGENTS.md); this page explains and cites them, and [`../HANDOFF.md`](../HANDOFF.md) holds current state.

## User guide

You do not need this page to use the app. Three things are worth knowing as a user:

- **Everything is local.** Your data is in this browser under `aloha-aba.v3`. Clearing site data erases it; export a backup first (see [security-undo-backup](security-undo-backup.md)).
- **A refusal means nothing changed.** When the app refuses an action (a stop-level message in a toast), it did not write anything. Warnings (caution) let you proceed; flags and to-fill-in marks are informational.
- **Help is built in.** Help & Wiki at the bottom of the navigation rail opens this wiki and its FAQ with search. Every role can open it; it holds no practice data.
- **Inbox.** The envelope in the top bar opens two tabs; nothing is emailed or texted. Code: `src/lib/tasks.js`, `InboxView.jsx`.
  - **Notifications** are read fresh from the workspace each time: your overdue or due-today tasks (for an account not linked to a staff member, such as the practice administrator, the whole team's), Cabinet documents expiring, authorizations ending within 30 days, overdue intake requests, and denied claims. Each item appears only if your role can open that area.
  - **Tasks** are assigned to staff, optionally about a client. Tasks belong to every role and are office-scoped by client or assignee. Each change is one Undo.
  - **Messages** are conversations between signed-in users (`src/lib/messages.js`).
  - **Demo records** (`src/lib/demoRecords.js`): a fresh workspace and "Regenerate demo data" get sample Cabinet documents, CEU and PDU entries, tasks and messages, built through the same planners the screens use and dated relative to today.
    - A conversation is listed only to its participants. A reply goes to everyone else in the thread.
    - Opening a thread marks it read without using an Undo slot. Unread messages add to the envelope's count.
    - Everything is kept in this browser's workspace; nothing is emailed.
- **A new version can appear while a tab is open.** The nav rail compares its build id with `public/version.json` and tells you when a newer deployment is available. Reload to get it; your data stays in the browser.

## How it works

### Folder layout

- `src/main.jsx`, `src/App.jsx`: entry and the shell (nav, routing by `ui.section`, global shortcuts, command palette). The calendar and its dialogs load with the app; every other section (dashboard, analytics, reports, clients, intake, masters, staff, cabinet, billing, payroll, help, settings) is a `React.lazy` chunk fetched on its first visit, behind a calm "Loading this section…" status inside the section error boundary. `preloadViews()` fetches them all up front; the test setup uses it.
- `src/state/store.jsx`: the one store. It holds the seeded workspace (`blankState`), load and migrations (`initial`, `normalizeWorkspace`), the `reducer`, Undo (`pushSnap`), `createActions` and persistence. It is about 1,400 lines; search it, do not read it whole.
- `src/lib/`: pure domain engines with no React. Billing: `claims`, `cms1500`, `providerIds`, `billingDocs`, `billingKpis`, `era`, `eraPosting`, `paymentLedger`, `secondaryLedger`, `master`. Payroll: `payroll`, `payrollExport`. Intake: `intake`. Settings: `settingsMasters`, `dataImport`. Scheduling intelligence: `authBudget`, `authUnits`, `risk`, `insights`, `cancelReasons`, `abaHours`, `bookingChecks`, `smart`, `locationSources`. Reporting: `reports`, `analytics`, `dash`, `rpTrends`. Platform: `security`, `workspaceBackup`, `seed`, `model`, `date`, `exportKit`, `ics`.
- `src/components/`: screens, with sub-folders `intake/`, `payroll/` and `settings/`. `BookingChecks.jsx` is the booking dialog's Checks rail and the severity glyphs. `HelpView.jsx` is the Help & Wiki screen: it bundles `docs/wiki/*.md` with `import.meta.glob` (raw text, at build time, into the Help section's own chunk) and renders and searches it through `src/lib/wiki.js` (an escaping markdown renderer, page ordering from this wiki's home table, and ranked section search).
- `src/ui/`: shared primitives (`Icons.jsx`, `Toast.jsx`, `SignaturePad.jsx`, `avatars.jsx`).
- `src/styles.css`: the single stylesheet. Tokens are on `:root` and redefined under `[data-theme='dark']`. It grew by appended blocks that override earlier ones (some `!important`), so check for later overrides before editing a rule, and append new blocks at the end.
- `src/__tests__/`: `*.test.js` (pure) and `*.test.jsx` (Testing Library flows), plus `fixtures/` (835 files).
- `docs/`: this wiki, `HANDOFF.md`, and `specs/` design briefs. Billing specs there are historical, not a statement of what exists; `scheduling-intelligence-ideas.md` tracks shipped versus not.
- `scripts/`: `write-version.cjs` (stamps `public/version.json`), `build-share.mjs` (single-file build) and one-off Python history files (`c33` to `c37`). Do not run or extend the Python ones.
- `public/version.json`: the build id the running app compares against.

Import cycles to avoid: `seed.js` imports `authBudget.js`, and `master.js` imports `seed.js`, so `authBudget.js` must stay free of `master.js` imports (this is why `authUnits.js` is separate). `claims.js` and `providerIds.js` import each other by design and use each other only at call time.

### Data flow

1. **Click.** A component calls a method from `actions` (built by `createActions`) or dispatches an action.
2. **Plan.** For anything that validates, a pure `plan*` function in `src/lib/` returns `{ok, msg, ...patch}`. The `createActions` method plans once to get the toast message and returns `{ok, msg}` to the screen. A refusal here changes nothing.
3. **Authorize.** Every dispatch goes through `guardedDispatch`, which calls `authorizeAction`. A new action type needs an entry in `actionAreas` and in the record-scope switch in [`security.js`](../../src/lib/security.js), or it is refused (details in [security-undo-backup](security-undo-backup.md)).
4. **Reduce.** The `*Tx` reducer case plans again against live state before applying (a stale preview or a double click cannot write twice) and applies the whole change at once. Financial and compound changes funnel through `claimsTx`, `payrollTx`, `intakeTx` or `settingsTx`, each taking one Undo snapshot with `pushSnap`.
5. **Undo.** `state.history` holds up to 25 snapshots of only the fields a change touched. It lives in this tab's memory and is never persisted.
6. **Persist.** A `StoreProvider` layout effect arms a save 250 ms after the last state change: `serializeForStorage(state)` (the state with `history` emptied) goes to localStorage. A pending save is flushed at once on `pagehide` and on `visibilitychange` to hidden, so a reload right after a click keeps it. If the write throws, a `storage-warning` alert names the reason (storage full, with the size needed) until a later write succeeds.
7. **Other tabs.** A `storage` event for `aloha-aba.v3` means another tab saved: this tab re-loads the workspace and adopts it with one `hydrate` step (keeps its own navigation, drops its Undo steps), so it never writes a stale copy back over the other tab's work.
8. **Load.** `loadWorkspace()` (and `initial()`, its state) reads the saved state, merges it over current defaults, runs `normalizeWorkspace`, and rewrites storage only if something changed. If a save exists but cannot be read, it returns an `error`: the tab opens on the fresh workspace, leaves the save untouched and does not persist until the user picks "Replace it with this workspace".

The D3 handoff uses `intakeHandoff.js` for a pure first-week proposal and `planHandoffSession`, then `bookHandoffSession` → `handoffSessionTx` for one reviewed appointment. It rechecks live state and uses the existing appointment/intake link; proposals are transient and no migration is required. See [intake](intake.md).

Write patterns by area: settings writes go through `settingsTx` and `planSettingsOp`; payroll through `payrollTx`; billing money through the `plan*` and `*Tx` pairs in [era-and-payments](era-and-payments.md); claim lifecycle through pure patch functions and `claimsTx` in [billing-and-claims](billing-and-claims.md).

Money is held in integer cents inside `paymentLedger.js` (`cents()`); values with more than two decimals are refused.

### Migrations

`normalizeWorkspace` chains these in order, then `normalizeSecurity`: `normalizePayerCf`, `normalizeAbaHours`, `normalizeApptPcfs`, `normalizeLegacyCustom`, `normalizeBillingV2` (in `master.js`), `normalizeBillingIds`, `normalizeCobLedger`, `normalizeIntake`, `normalizeVerificationForms`, `normalizeSettingsMasters`, `normalizeAuthUnits`, `normalizeUnitNorms` (once, flag `meta.unitNorm15`; moves untouched 30-minute defaults to 15 minutes and never changes claims), `normalizeStaffEducation` (clears a staff `education` value outside `EDUCATION_LEVELS`; a blank or absent level means "not recorded" and is left alone). A new field on an existing record needs an idempotent migration here that returns the same object when nothing changes. A new durable collection must be added to `WORKSPACE_FIELDS` in `workspaceBackup.js`, validated on import, and given a round-trip test and an Undo test.

### Testing rules

- Cover the UI action and the persisted state for every new workflow, and add pure tests for every `src/lib` change.
- Tests must not depend on the date: build dates relative to `todayISO()`, and never assume a weekday has appointments.
- `blankState()` and `buildSeed()` generate fresh random appointment ids on every call. In a test file build one `const BASE = blankState()` and derive variants with spreads; never mix claims or appointments from separate calls.
- Select elements by `data-testid` with a module prefix (`py-`, `pd-`, `pay-`, `pc-`, `iq-`, `dw-`, `bk-`, `nav-sub-`). There is no shared helper module: seed with `localStorage.setItem('aloha-aba.v3', JSON.stringify(state))`, then render `<App />`.
- When a change alters behaviour on purpose, search the tests for the old assumption in the same change, with `grep -rn "<old text or id>" src/__tests__`.
- Exact-text queries throw on duplicates; panels that echo a message must not render the identical string twice.
- Test setup: Vitest with the jsdom environment, files matching `src/**/*.test.{js,jsx}`, mocks restored between tests (`vite.config.js`). `src/test/setup.js` preloads the code-split sections and the PDF engine before each file, so UI tests render sections synchronously; a test that clicks a PDF button awaits the download (`waitFor`). `npm test` runs `vitest run`.
- The maintainer's work PC (Windows, Node 25) runs the full suite with three workarounds listed in `AGENTS.md` → "Commands": a clone outside `Documents`, npm started through node with `--preserve-symlinks`, and `NODE_OPTIONS=--no-experimental-webstorage`. Where npm cannot run at all, the fallback is `node --check` for syntax, pure `src/lib` logic run with node through a resolve hook, then CI.

### CI and deploy

[`.github/workflows/deploy.yml`](../../.github/workflows/deploy.yml) runs on pushes to `main`, pull requests to `main`, and manual dispatch, on `ubuntu-24.04` with Node 22 and the npm cache.

1. **build job:** install dependencies with `npm ci` (a legacy fallback, kept from an older repo layout, moves a nested `CP-Inspired-Scheduler/` or `aba-scheduler/` folder up and runs `npm install` when no root `package-lock.json` exists; it never fires today), run the full test suite (`npm test -- --run`; the extra flag is redundant with `vitest run` and harmless), then `npm run build`. The `prebuild` script runs `scripts/write-version.cjs`, which stamps `public/version.json` with a build id that the app embeds and compares at runtime. Vite builds into `dist/` with `base: './'`, so the site works on a GitHub Pages sub-path. The build is code-split: the entry chunk (about 1,015 kB minified, 322 kB gzip) holds the calendar, the store and the domain engines its reducer needs; each other section, the bundled wiki and jsPDF are separate chunks. jsPDF (about 390 kB) loads on the first PDF export through `loadPdf()` in `exportKit.js`; if that fetch fails, the export says nothing was downloaded. `chunkSizeWarningLimit` is 1,100 kB as a regrowth tripwire. `npm run share` sets `SHARE_INLINE=1`, which folds every chunk back into one file.
2. **Pages artifact:** uploaded only on non-PR events.
3. **deploy job:** needs the build job, runs only on non-PR events, and publishes to GitHub Pages (environment `github-pages`).

Pull requests get their own concurrency group so a PR check never cancels a deploy from `main`. The rule: `main` must stay green. A red `main` is fixed before any other work, and nothing is merged with known failing tests. `npm run share` (POSIX env syntax, so use Git Bash on Windows) produces a single-file inline build in `share/`.

Git workflow, in short: branch from an up-to-date `main` (`feat/`, `fix/`, `chore/`, `ci/`, `docs/`), use Conventional Commits, land with a no-fast-forward merge, then check CI on the pushed commit. One feature per branch. Never force-push `main`.

## Known doc/code mismatches

Each item below was checked against the code at the sync commit. Items fixed on `main` since the first version of this page (the CMS-1500 invented group number and practice NPI, the 30-minute unit table, empty claim-line modifiers, the Validations Auto-fill button — it now follows the payer unit rule — and the `appealed` claim status — an appeal is now a marker on the claim, not a status) were removed. The former DSO mismatch (#7) is resolved by the DSO-consistency change: Billing Health now reuses the AR Manager's DSO. The two aging engines and the merged AR Manager column are also fixed: there is now one aging clock (`agingSince`) and one five-bucket scheme (`agingBucketFor`) in `claims.js`, shared by the AR Manager, the Billing desk strip, the Claims Register and the claim drawer, and the AR table shows 91–120 and 121+ as separate columns like the KPI strip and the CSV. The remaining items are recorded, not fixed, and each is a candidate for a small cleanup branch.

Docs versus repo:

1. Resolved: `AGENTS.md` now names the Python history files `c33-*` to `c37-*` and the two live scripts.
2. Resolved (documented): the `deploy.yml` legacy install fallback is described under "CI and deploy" above.
3. Resolved (documented): the redundant `--run` flag is noted under "CI and deploy" above.
4. Resolved (2026-10-08): the unused `playwright` / `playwright-core` devDependencies are removed and the lock file regenerated. The test runner is Vitest 4.
5. Resolved: the README now says v3 JSON (v2 files still import).
6. Resolved: the README now says Settings → System → Data & backup.

Billing and A/R behaviour (ERA, payments, secondary, A/R):

7. Resolved: the secondary screen title now reads "Secondary Queue", like the nav item, the Billing desk heading and the README.
8. Billed files are still stored with status `sent` and `billedThrough: 'ch'` (internal keys, kept so saved workspaces need no migration). The screen now shows that status as "Exported" and labels the 837P count "Summary, not X12"; the file content is a pipe-delimited summary.
9. Resolved: the never-set `clientPick` filter and its unreachable "Clear filter" button were removed from `ArManagerView.jsx`; the search box is the AR Manager's client filter.

Other findings from writing these pages:

10. Resolved (`fix/cms1500-derived-values`, 2026-10-08): claims carry only the chart's own values. `memberIdOf`, `authNoOf` and `dxFor` (`claims.js`) return what the client record holds, or blank. `claimChartIssues` holds an insurance draft in the claim gate when the member ID or ICD-10 diagnosis codes (`client.dxCodes`) are missing, or the authorization number is missing while strict authorization is on, and `cms1500Data` refuses the export with the same messages. Item 23 is blank when no authorization number is on file. Item 26 stays the client id: it is the practice's own patient account number, not a payer value.
11. Resolved: new claim history entries read "Marked submitted to <payer>; claim file saved locally, not transmitted" and the Process toast says "marked submitted · file saved in Billed Files, nothing transmitted". History entries already in a saved workspace keep their old text.
12. In `billingDocs.js`, `buildInvoices`, `buildQboCsv`, `buildVerificationForm` and `buildAppealLetter` are imported only by tests; only `build835ErrorReport` is used by a screen.
13. Settings, System stores MFA required, screen-lock minutes and auto-logout minutes, but only the settings editor and its validation touch them, and no code enforces them (there is no sign-in or lock screen).

Found while syncing with the billing-rules work:

14. In Payer, Billing Rules, Claims Settings, Box 17 and 19 options, box 33B ID types, claim file options, appointment time and the taxonomy checkboxes are stored but read by nothing, so the panel shows them disabled and labelled "not available" (listed in `docs/specs/configurable-billing.md`). "Separate Claim By" no longer offers "Supervising Provider" (`separateKey` in `claims.js` returns no key because sessions record no supervisor); both provider choices split by the session's clinician. POS "Hide POS-10" filters telehealth locations from the booking picker for that payer's clients; "Hide POS-02" is disabled because every video location codes POS-10. The merge checkbox label says "same service provider", while `mergeSameDayLines` also requires the same code, modifiers, rate and unit rule.
