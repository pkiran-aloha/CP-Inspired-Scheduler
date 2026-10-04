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

Hackathon wave 2: configurable billing (#8). This wave is in progress. The plan and the audit are in `docs/specs/configurable-billing.md`, which lists 6 slices.
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
| **Configurable billing (#8)** (in progress) | "We didn't have to submit hard-code requests for billing" | Slices 1–3 have shipped. Next is slice 4, CMS-1500 boxes from the payer record. Slices 4–6 are in `docs/specs/configurable-billing.md`. Medicaid norms are the compliance baseline for every slice. |
| **Intake (#5)** | Download forms; request → intake → client flow; "make intake easy and convenient UX-wise" | Maintainer picked all three. Downloadable intake packet + filled request as PDF (jsPDF is installed); trace the General Requests → Client Intake → Client List hand-offs end-to-end and fix confusing steps; run `impeccable` critique on the intake screens first. |
| **Inbox, tasks, notifications (#1 + #2)** | Message center + task assignment + notifications | Local, in-workspace only (no delivery off-device, no client portal yet). |
| **Records (#4, #10, #13)** | Client statements; Cabinet expirations; RBT PDU report | Statements: history, PDF, mark sent/paid (no email). Cabinet: documents register with expiry + alerts (metadata only). PDU: log entries per staff vs renewal requirement — confirm requirement per credential with the maintainer. |
| **Integrations, honest partial (#3, #11, #12)** | Telehealth link; Apple/Google calendar; Stripe | Store the practice's own video link; per-staff `.ics` download; Stripe *payment link* + manual recording. Real sync/charging needs a backend — say so in the UI. |
| Scheduling idea B3 | Travel feasibility & route sequencing | From `docs/specs/scheduling-intelligence-ideas.md` §6; deferred by the maintainer. |
| #15 | "Remove pop-up that payer is not on list" | Not present in this app (it's a production-Aloha complaint). Keep it that way. |

## Known issues / backlog (not yet fixed)

- `staffSatisfiesQualification` may flag BCBAs on BCBA-only codes ("Staff Qualification" chip on a BCBA for 97151) — investigate the qualification `covers` matching.
- Payer "Qualification Modifiers" rows are keyed by education level, but staff have no education field — modifiers can't be derived per staff yet.
- Recoupments: secondary / COB-linked claims refused (scope v1).
- Intake conversion doesn't copy approved authorization units into the new client's pool.
- Integrations panel stores API keys in plain local settings (needs the backend).
- `impeccable detect` flags 22 thick colored left-border accents in older CSS (outside recent work).
- Merged remote branches still on GitHub: `docs/agents-handoff` and later feature branches. The maintainer deletes them with `git push origin --delete …`.
- Generic payer edits (the `payer` action, `patch` mode) take no Undo snapshot. Only Payment Terms does.

## Resume prompt (paste into a new session)

> Read `docs/HANDOFF.md` and `AGENTS.md`. Sync with GitHub (`git fetch`, confirm `main` matches `origin/main`, report anything new). Then ask me which hackathon wave to build next, recommending one, and follow the one-feature-at-a-time workflow.
