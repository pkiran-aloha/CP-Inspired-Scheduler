# CLAUDE.md

Aloha ABA Practice Suite: a local-first React 18 + Vite 6 app for ABA practice operations (scheduling, intake, billing/claims/ERA, A/R, payroll, settings). It is a functional prototype on its way to production. No backend yet. All state lives in the browser's localStorage under `aloha-aba.v3`. Seed data is fictional; never put real PHI in code, fixtures or tests.

Product context (users, purpose, principles) lives in `PRODUCT.md`.

## Commands

```sh
npm ci              # install (CI uses Node 20)
npm run dev         # http://localhost:5173
npm test            # vitest run, jsdom, src/**/*.test.{js,jsx}
npx vitest run src/__tests__/intake.test.js   # single file
npm run build       # prebuild writes public/version.json, output in dist/
npm run share       # single-file inline build into share/
```

Pushes to `main` run tests + build and deploy to GitHub Pages (`.github/workflows/deploy.yml`). A red test blocks the deploy.

## Layout

- `src/state/store.jsx`: seeded workspace, migrations, the reducer, Undo, localStorage persistence. Large file; search it, don't read it whole.
- `src/lib/`: pure domain engines (claims, era/eraPosting, payroll, intake, settingsMasters, workspaceBackup, reports, smart scheduling). No React here.
- `src/components/`: screens. Sub-folders for `intake/`, `payroll/`, `settings/`.
- `src/ui/`: shared primitives (Icons, Toast, SignaturePad, avatars).
- `src/styles.css`: the single stylesheet (~3.6k lines). No CSS modules or Tailwind.
- `src/__tests__/`: pure-logic `*.test.js` and UI-flow `*.test.jsx` (Testing Library).
- `docs/specs/`: historical billing design. It is not a statement of what is implemented.
- `scripts/c3x-*.py`: one-off patch scripts from earlier build rounds. They are history; don't run or extend them.

## Rules that hold the app together

- Keep billing, payroll and backup calculations pure in `src/lib/`.
- Every financial or compound transition is a **single reducer action**, so one Undo reverses it.
- Undo history is tab-local (25 steps). Never write Undo snapshots to localStorage; the seed holds ~1,000 appointments.
- Settings writes go through the store's `settingsTx`, which re-runs `planSettingsOp` (`src/lib/settingsMasters.js`) against live state.
- New durable collection: add it to `WORKSPACE_FIELDS` in `src/lib/workspaceBackup.js`, validate it on import, and add a round-trip + Undo test.
- Integrations are honest: nothing transmits (no EDI, clearinghouse, SMS, payment). UI copy must not claim otherwise.
- Cover both the UI action and the persisted state in tests for any new workflow.
- Tests must be date-independent (no assumption that a given weekday has appointments).

## Workflow

- Branch from `main`. PRs merge into `main`.
- Run `npm test` before every commit. Run `npm run build` before a PR.
- Update the README "Current development context" section when a feature round lands.

## Skills for this project

- Bugs: `mattpocock-skills:diagnosing-bugs`, then `mattpocock-skills:tdd` for the regression test.
- New features or domain changes: `mattpocock-skills:grilling` to settle requirements, `mattpocock-skills:domain-modeling` for new entities.
- Structure and refactors: `mattpocock-skills:codebase-design`.
- UI and visual work: `impeccable:impeccable` (reads the design context file) and `ecc:taste` for preference checks.
- Scope control: ponytail is always on. Prefer the smallest change that keeps the rules above.
- Review before a PR: `mattpocock-skills:code-review`.
