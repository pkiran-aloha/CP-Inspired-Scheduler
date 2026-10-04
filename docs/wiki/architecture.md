# Architecture

_Sources: AGENTS.md, README.md, package.json, vite.config.js, .github/workflows/deploy.yml, scripts/write-version.cjs, scripts/build-share.mjs, src/state/store.jsx, src/lib/security.js, src/lib/workspaceBackup.js, src/lib/master.js, src/lib/wiki.js, src/components/HelpView.jsx_
_Last synced with main at c8e666b on 2026-10-04 (plus the Cabinet)._

This page is for developers: where code lives, how a change flows from a click to localStorage, the testing rules, how `main` is built and deployed, and where the existing docs disagree with the code. The rules themselves live in [`../../AGENTS.md`](../../AGENTS.md); this page explains and cites them, and [`../HANDOFF.md`](../HANDOFF.md) holds current state.

## User guide

You do not need this page to use the app. Three things are worth knowing as a user:

- **Everything is local.** Your data is in this browser under `aloha-aba.v3`. Clearing site data erases it; export a backup first (see [security-undo-backup](security-undo-backup.md)).
- **A refusal means nothing changed.** When the app refuses an action (a stop-level message in a toast), it did not write anything. Warnings (caution) let you proceed; flags and to-fill-in marks are informational.
- **Help is built in.** Help & Wiki at the bottom of the navigation rail opens this wiki and its FAQ with search. Every role can open it; it holds no practice data.
- **A new version can appear while a tab is open.** The nav rail compares its build id with `public/version.json` and tells you when a newer deployment is available. Reload to get it; your data stays in the browser.

## How it works

### Folder layout

- `src/main.jsx`, `src/App.jsx`: entry and the shell (nav, routing by `ui.section`, global shortcuts, command palette).
- `src/state/store.jsx`: the one store. It holds the seeded workspace (`blankState`), load and migrations (`initial`, `normalizeWorkspace`), the `reducer`, Undo (`pushSnap`), `createActions` and persistence. It is about 1,400 lines; search it, do not read it whole.
- `src/lib/`: pure domain engines with no React. Billing: `claims`, `cms1500`, `providerIds`, `billingDocs`, `billingKpis`, `era`, `eraPosting`, `paymentLedger`, `secondaryLedger`, `master`. Payroll: `payroll`, `payrollExport`. Intake: `intake`. Settings: `settingsMasters`, `dataImport`. Scheduling intelligence: `authBudget`, `authUnits`, `risk`, `insights`, `cancelReasons`, `abaHours`, `bookingChecks`, `smart`. Reporting: `reports`, `analytics`, `dash`, `rpTrends`. Platform: `security`, `workspaceBackup`, `seed`, `model`, `date`, `exportKit`, `ics`.
- `src/components/`: screens, with sub-folders `intake/`, `payroll/` and `settings/`. `BookingChecks.jsx` is the booking dialog's Checks rail and the severity glyphs. `HelpView.jsx` is the Help & Wiki screen: it bundles `docs/wiki/*.md` with `import.meta.glob` (raw text, at build time) and renders and searches it through `src/lib/wiki.js` (an escaping markdown renderer, page ordering from this wiki's home table, and ranked section search).
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
6. **Persist.** A `StoreProvider` effect waits 250 ms after the last state change, then writes `serializeForStorage(state)` (the state with `history` emptied) to localStorage. If the write throws, a `storage-warning` alert appears until a later write succeeds.
7. **Load.** `initial()` reads the saved state, merges it over current defaults, runs `normalizeWorkspace`, and rewrites storage only if something changed.

Write patterns by area: settings writes go through `settingsTx` and `planSettingsOp`; payroll through `payrollTx`; billing money through the `plan*` and `*Tx` pairs in [era-and-payments](era-and-payments.md); claim lifecycle through pure patch functions and `claimsTx` in [billing-and-claims](billing-and-claims.md).

Money is held in integer cents inside `paymentLedger.js` (`cents()`); values with more than two decimals are refused.

### Migrations

`normalizeWorkspace` chains these in order, then `normalizeSecurity`: `normalizePayerCf`, `normalizeAbaHours`, `normalizeApptPcfs`, `normalizeLegacyCustom`, `normalizeBillingV2` (in `master.js`), `normalizeBillingIds`, `normalizeCobLedger`, `normalizeIntake`, `normalizeVerificationForms`, `normalizeSettingsMasters`, `normalizeAuthUnits`, `normalizeUnitNorms` (once, flag `meta.unitNorm15`; moves untouched 30-minute defaults to 15 minutes and never changes claims). A new field on an existing record needs an idempotent migration here that returns the same object when nothing changes. A new durable collection must be added to `WORKSPACE_FIELDS` in `workspaceBackup.js`, validated on import, and given a round-trip test and an Undo test.

### Testing rules

- Cover the UI action and the persisted state for every new workflow, and add pure tests for every `src/lib` change.
- Tests must not depend on the date: build dates relative to `todayISO()`, and never assume a weekday has appointments.
- `blankState()` and `buildSeed()` generate fresh random appointment ids on every call. In a test file build one `const BASE = blankState()` and derive variants with spreads; never mix claims or appointments from separate calls.
- Select elements by `data-testid` with a module prefix (`py-`, `pd-`, `pay-`, `pc-`, `iq-`, `dw-`, `bk-`, `nav-sub-`). There is no shared helper module: seed with `localStorage.setItem('aloha-aba.v3', JSON.stringify(state))`, then render `<App />`.
- When a change alters behaviour on purpose, search the tests for the old assumption in the same change, with `grep -rn "<old text or id>" src/__tests__`.
- Exact-text queries throw on duplicates; panels that echo a message must not render the identical string twice.
- Test setup: Vitest with the jsdom environment, files matching `src/**/*.test.{js,jsx}`, mocks restored between tests (`vite.config.js`). `npm test` runs `vitest run`.
- Without npm (the maintainer's work PC): `node --check` for syntax, pure `src/lib` logic run directly with node through a resolve hook, then CI. JSX is verified only by CI.

### CI and deploy

[`.github/workflows/deploy.yml`](../../.github/workflows/deploy.yml) runs on pushes to `main`, pull requests to `main`, and manual dispatch, on `ubuntu-24.04` with Node 22 and the npm cache.

1. **build job:** install dependencies (`npm ci` when a lock file exists), run the full test suite, then `npm run build`. The `prebuild` script runs `scripts/write-version.cjs`, which stamps `public/version.json` with a build id that the app embeds and compares at runtime. Vite builds into `dist/` with `base: './'`, so the site works on a GitHub Pages sub-path.
2. **Pages artifact:** uploaded only on non-PR events.
3. **deploy job:** needs the build job, runs only on non-PR events, and publishes to GitHub Pages (environment `github-pages`).

Pull requests get their own concurrency group so a PR check never cancels a deploy from `main`. The rule: `main` must stay green. A red `main` is fixed before any other work, and nothing is merged with known failing tests. `npm run share` (POSIX env syntax, so use Git Bash on Windows) produces a single-file inline build in `share/`.

Git workflow, in short: branch from an up-to-date `main` (`feat/`, `fix/`, `chore/`, `ci/`, `docs/`), use Conventional Commits, land with a no-fast-forward merge, then check CI on the pushed commit. One feature per branch. Never force-push `main`.

## Known doc/code mismatches

Each item below was checked against the code at the sync commit. Items fixed on `main` since the first version of this page (the CMS-1500 invented group number and practice NPI, the 30-minute unit table, empty claim-line modifiers) were removed. They are recorded, not fixed, and each one is a candidate for a small cleanup branch.

Docs versus repo:

1. `AGENTS.md` says `scripts/c3x-*.py`. No file matches that name. The Python files are `c33-*` through `c37-*` (for example `c33-cfpage.py`, `c37-core.py`), and `scripts/` also holds `build-share.mjs` and `write-version.cjs`.
2. `deploy.yml` has an undocumented fallback in its install step: when no `package-lock.json` is at the root, it looks for a nested `CP-Inspired-Scheduler/` or `aba-scheduler/` folder, moves its contents up, and runs `npm install`. This is leftover handling for an older repo layout and is not mentioned in `AGENTS.md` or the README.
3. CI runs `npm test -- --run` while the `test` script is already `vitest run`. The extra flag is harmless.
4. `playwright` and `playwright-core` are devDependencies but nothing in the repository imports them, and `AGENTS.md` and the README do not mention them.
5. `BACKUP_VERSION` is 3 (`workspaceBackup.js`), and version 2 files are still accepted, but the README describes the backup as "v2 JSON".
6. The README points to "Settings → Data & backup", but the section lives in Settings, System (a panel titled "Data & backup").

Billing and A/R behaviour (ERA, payments, secondary, A/R):

7. Two DSO formulas exist. The AR Manager (`arOf`) divides open A/R by charges with a date of service start in the last 90 days, drafts included. The dashboard's Billing Health "Days in A/R" (`billingKpis.js`) divides open A/R by charges whose date of service end falls in the last 90 days, drafts excluded. The two numbers can differ for the same data.
8. Two aging engines exist. `arOf` ages all open primary claims in five buckets (0 to 30, 31 to 60, 61 to 90, 91 to 120, 121 plus). `agingOf` and `claimStats` age only Submitted claims in four (0 to 30, 31 to 60, 61 to 90, 90 plus).
9. The AR Manager table merges 91 to 120 and 121 plus into one "91-120+" column, while the KPI strip and CSV keep them separate.
10. The secondary screen is titled "Secondary Billing", while the nav item, the Billing desk heading and the README call it "Secondary Queue".
11. Billed files are saved with status `sent` and `billedThrough: 'ch'`, and the Billed Files list defaults a missing status to `sent`, although nothing is ever transmitted (`submitClaims` in `store.jsx`, `BilledFilesView.jsx`). The "837P" file content is a pipe-delimited summary, not X12.
12. In `ArManagerView.jsx`, `clientPick` is never set to a non-empty value, so its "Clear filter" button can never appear.

Other findings from writing these pages:

13. `fileAppeal` sets a claim's status to `appealed`, which is not in `CLAIM_STATUSES`. The desk KPIs ignore it, and `planClaimPayment` refuses payments on it (only Submitted and Partially paid are open). Appeals "Mark Won" sets status `paid` through `updateClaim` without posting any money, so the balance can remain in A/R under a Paid claim.
14. The CMS-1500 data mapping still fills some boxes with derived values: the member ID in box 1a (`memberIdOf`), the authorization number in boxes 11, 17 and 23 (`authNoOf`), the diagnosis (`dxFor`, from the client's program), boxes 26 and 29 (built from the client id) and a fallback rendering NPI (`npiOf`). Its note line still says "e-file via ANSI 837P", which the app does not do. Boxes 1, 6, 7a, 10, 32 and 33 were fixed to read the payer and client records or print a dash (configurable-billing slice 4).
15. Claim history reads "Claim submitted to <payer>" and toasts say "submitted", which describes a local status change (honest-software wording gap).
16. In `billingDocs.js`, `buildInvoices`, `buildQboCsv`, `buildVerificationForm` and `buildAppealLetter` are imported only by tests; only `build835ErrorReport` is used by a screen.
17. Settings, System stores MFA required, screen-lock minutes and auto-logout minutes, but only the settings editor and its validation touch them, and no code enforces them (there is no sign-in or lock screen).

Found while syncing with the billing-rules work:

18. The Validations "Auto-fill" button in `ReportsView.jsx` (`autoFill`) sets units to the raw duration divided by the unit size, rounded to two decimals, instead of the payer's unit rule. The booking dialog, Quick Add and the Billing desk's unit fix all use `unitRuleFor` and `unitsFor` (midpoint rule), so the same session can get different units depending on which button fills them. The billing-readiness rows in `reports.js` also estimate with the code's unit size and fractional units.
19. In Payer, Billing Rules, Claims Settings, "Separate Claim By: Supervising Provider" does nothing (`separateKey` in `claims.js` returns no key because sessions record no supervisor). The merge checkbox label says "same service provider", while `mergeSameDayLines` also requires the same code, modifiers, rate and unit rule. Box 17 and 19 options, box 33B ID types, claim file options, appointment time and the taxonomy checkboxes are stored but read by nothing (listed in `docs/specs/configurable-billing.md`).
