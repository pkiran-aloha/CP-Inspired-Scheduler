# AGENTS.md — rules for every coding agent on this repo

This file is the single source of truth for any AI coding agent (Claude Code, Codex, Cursor, Copilot, Gemini, Jules, Aider, …) and for humans. `CLAUDE.md`, `GEMINI.md` and `.github/copilot-instructions.md` only point here. If an instruction elsewhere conflicts with this file, this file wins. **Read `docs/HANDOFF.md` first** for current state and next steps.

Aloha ABA Practice Suite: a local-first React 18 + Vite 6 app for ABA practice operations (scheduling, intake, billing/claims/ERA, A/R, payroll, settings). Functional prototype on its way to production. No backend yet. All state lives in the browser's localStorage under `aloha-aba.v3`. Product context (users, purpose, principles): `PRODUCT.md`.

## Non-negotiables

1. **No real PHI.** Seed data is fictional. Never put real names, DOBs, member IDs or notes in code, fixtures, tests, commits or screenshots.
2. **Honest software.** Nothing transmits: no EDI, clearinghouse, SMS, email, payment, calendar sync or video. UI copy must say exactly what happened locally and never imply an external action. A feature that needs a backend ships as an honest local version or not at all.
3. **Guards over warnings, but no hard block by default.** Invalid financial/configuration states are refused; scheduling guards default to Warn, and Stop is a setting the practice chooses.
4. **One action, one Undo.** Every financial or compound change is a single reducer action.
5. **`main` must stay green.** Pushes to `main` run the full test suite + build (GitHub Actions) and deploy to GitHub Pages only if green. Never merge with known failing tests. If `main` goes red, fix it before anything else.
6. **Smallest change that works.** No speculative abstractions, no new dependencies for what a few lines do, no unrelated refactors in a feature change.

## Commands

```sh
npm ci              # install (CI uses Node 22 on ubuntu-24.04)
npm run dev         # http://localhost:5173
npm test            # vitest run, jsdom, src/**/*.test.{js,jsx}
npx vitest run src/__tests__/intake.test.js   # single file
npm run build       # prebuild writes public/version.json, output in dist/
npm run share       # single-file inline build into share/ (POSIX env syntax: use Git Bash on Windows)
```

The maintainer's work PC currently cannot run npm (no execution rights). There, verification is: `node --check` for syntax, pure `src/lib` logic run directly with node (see "Verifying without npm"), then GitHub CI on push to `main`.

## Layout

- `src/state/store.jsx`: seeded workspace (`blankState`), load + migrations (`initial`, `normalizeWorkspace`), the reducer, Undo, `createActions`, localStorage persistence. Large; search it, don't read it whole.
- `src/lib/`: pure domain engines, no React. Key modules:
  - claims, era / eraPosting, paymentLedger (payments, voids, patient receipts, **recoupments**), secondaryLedger, cms1500, billingDocs
  - payroll, payrollExport, intake, settingsMasters (all Settings masters + `planSettingsOp` + appointment validations), workspaceBackup, security
  - reports (every report: `{columns, rows, summary, note}`), analytics, dash, rpTrends
  - scheduling intelligence: `authBudget.js` (hours guard), `authUnits.js` (per-code unit pools, payer unit rules, MUE/weekly caps, credentials; `mergeAuthChecks`), `risk.js`, `insights.js`, `cancelReasons.js`, `abaHours.js`, `bookingChecks.js` (per-candidate verdicts in pickers)
  - billing: `providerIds.js` (payer rule NPI / Medicaid ID / both), `billingKpis.js` (dashboard Billing Health)
- `src/components/`: screens (sub-folders `intake/`, `payroll/`, `settings/`). `BookingChecks.jsx` = the booking dialog's Checks rail + severity glyphs.
- `src/ui/`: shared primitives (Icons — one drawn SVG set, Toast, SignaturePad, avatars).
- `src/styles.css`: the single stylesheet. Tokens on `:root`, redefined under `[data-theme='dark']`. Grew by appended chunks that override earlier ones (some `!important`): check for later overrides before editing a rule. Append new blocks at the end.
- `src/__tests__/`: `*.test.js` (pure) and `*.test.jsx` (Testing Library UI flows).
- `docs/specs/`: design briefs. `scheduling-intelligence-ideas.md` tracks what is shipped vs not. Billing specs are historical, not a statement of what exists.
- `scripts/c3x-*.py`: one-off history. Don't run or extend.

## Architecture rules

- Write pattern: a pure `plan*` in `src/lib/` validates and returns `{ok, msg, ...patch}`; one `*Tx` reducer case re-plans against live state before applying; a domain action in `createActions` returns `{ok, msg}` for the toast.
- Every dispatch passes `authorizeAction` (`src/lib/security.js`). **A new action type needs an entry in `actionAreas` and in the record-scope switch**, or it is refused.
- Settings writes go through `settingsTx` → `planSettingsOp`.
- New durable collection: add to `WORKSPACE_FIELDS` (`workspaceBackup.js`), validate on import, add a round-trip + Undo test. New fields on existing records need a migration in `normalizeWorkspace` that is idempotent and returns the same object when nothing changes (no needless localStorage rewrites).
- Undo history is tab-local (25 steps). Never persist it.
- Beware import cycles: `seed.js` imports `authBudget.js`; `master.js` imports `seed.js`. Keep `authBudget.js` free of `master.js` imports (that's why `authUnits.js` is separate).
- Money is handled in cents internally (`cents()` in paymentLedger); refuse values with more than 2 decimals.
- A claim line can bill several appointments, because same-day sessions merge under the Medicaid rule. Read a line's appointments with `lineApptIds(line)` from `claims.js`, never `line.apptId` alone.
- Billing compliance baseline is **Medicaid norms**:
  - 15-minute units, counted by the CPT midpoint rule
  - a day's minutes for one code are added up, then rounded once
  - credential modifiers on each line

  A payer's own rule, set in Masters → Payer, overrides these. `docs/specs/configurable-billing.md` has the details.

## Testing rules

- Cover the UI action **and** the persisted state for every new workflow; add pure tests for every `src/lib` change.
- Tests must be date-independent: build dates relative to `todayISO()`; never assume a weekday has appointments.
- **`blankState()` / `buildSeed()` generate fresh random appointment ids per call.** In a test file build one `const BASE = blankState()` and derive variants with spreads; never mix claims/appointments from separate calls.
- Select elements by `data-testid` with module prefixes (`py-`, `pd-`, `pay-`, `pc-`, `iq-`, `dw-`, `bk-`, `nav-sub-`). No shared helper module; seed via `localStorage.setItem('aloha-aba.v3', JSON.stringify(state))` then render `<App />`.
- When a change intentionally alters existing behaviour (default dashboard widgets, a button that now asks first, an always-visible panel), search the tests for the old assumption and update them in the same change: `grep -rn "<old text or id>" src/__tests__`.
- Exact-text queries (`getByText('…')`) throw on duplicates; panels that echo messages must not render the exact same string twice.

## Verifying without npm

`node` works even where npm doesn't. For pure `src/lib` modules: write a resolve hook in a scratch folder that appends `.js` to extension-less relative imports and stubs npm packages (e.g. `jspdf` → `data:text/javascript,export class jsPDF {}; export default {}`), register it with `node --import ./register.mjs check.mjs`, and import `file:///…/src/lib/<mod>.js` to assert behaviour. Use `buildSeed()` / `defaultSettings()` from `seed.js` (`blankState` lives in `store.jsx`, which node can't load). JSX is only verified by CI.

## Git workflow (plain git only — no `gh`)

- Branch from an up-to-date `main` (`git fetch && git switch main && git pull --ff-only`): `feat/…`, `fix/…`, `chore/…`, `ci/…`, `docs/…`.
- Commit messages: Conventional Commits (`feat(scope): …`), body explains *why*. On Windows write multi-line messages from Git Bash: `git commit -F - <<'EOF' … EOF` (PowerShell 5.1 splits arguments on quotes).
- Land: `git push -u origin <branch>; git switch main && git pull --ff-only && git merge --no-ff <branch> && git push origin main`.
- After pushing `main`, check CI before starting the next change. Without `gh`, the public API works: `https://api.github.com/repos/pkiran-aloha/CP-Inspired-Scheduler/actions/runs?head_sha=<sha>` and, for failures, `…/check-runs/<job id>/annotations`.
- One feature per branch, landed and green before the next. Update README "Current development context" and `docs/HANDOFF.md` when a feature lands.
- Never force-push `main`, rewrite published history, or delete branches/data you didn't create without the maintainer's say-so.

## UI conventions

- Operate-mode product UI: scannable, consistent, calm. Severity language is shared: stop sign (must fix), caution (review), flag (noted), pencil (to fill in), check (clear) — `ToneGlyph` / `TONE_ICON` in `BookingChecks.jsx`, tones `.tone-stop|warn|flag|todo|ok`.
- No unicode/emoji as icons (use `src/ui/Icons.jsx`), no thick colored side borders on cards, no gradient text. Theme both light and dark tokens. Respect `prefers-reduced-motion`.
- Responsive: the booking dialog rail stacks above the form below 1180px; never hide the only Save button at any width.
