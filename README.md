# Aloha ABA — Practice Suite

A **local-first demo** for ABA practice operations, built with React, Vite and Vitest. It includes a calendar (day/week/month/agenda/timeline), client/staff/payer/service masters, authorization-aware claim staging, payment and A/R views, reporting, dashboards and document builders. The demo seeds fictional staff, clients and appointments; **it is not a production EHR or a safe place for real PHI**.

## Run locally

```sh
npm ci
npm run dev       # http://localhost:5173
npm test          # Vitest regression suite
npm run build     # static site in dist/
```

Deployment is defined in `.github/workflows/deploy.yml` (tests + build, then GitHub Pages on pushes to `main`). The app needs no backend. State is stored in this browser under `aloha-aba.v3`; browsers/devices do not sync.

## Current development context

- `src/state/store.jsx` owns the seeded workspace, migrations, reducer, undo and browser persistence. `src/lib/` contains the domain engines (claims, documents, reporting, scheduler); `src/components/` holds the screens. `src/__tests__/` exercises both pure logic and UI workflows.
- `docs/specs/` contains the original billing design/build plan. It is historical design context, **not** a guarantee that every listed screen or integration is implemented. The app has no clearinghouse, eligibility or QuickBooks network connection; generated artifacts and manual workflows are local demonstrations.
- The NavRail build id and `public/version.json` let an open tab notice a newer deployment.

### Workspace integrity (previous round)

- **Versioned full-workspace backup (v2 JSON)** via Settings → Data & backup. It includes appointment/claim/payment ledgers, invoices, ERA imports, billed files, verification forms, QBO records, staff/clients/teams, payer/service/custom-field masters, settings, saved reports and dashboard boards. Import validates the file and previews its counts **before** a confirm-to-replace step; Cancel leaves the workspace alone. The older seven-field JSON export can still be imported, with a warning: it omitted masters and financial ledgers, so those cannot be recovered from it.
- **One-step Undo for compound billing edits and restore.** Claim submissions and their generated files are recorded together. Manual claim payments and their claim updates, self-pay invoice numbers and records, document records, regeneration and clearing now restore their dependent collections together. Undo history is kept **in the open tab only** (25 steps), not written into every localStorage save; it disappears on reload.
- **Storage-failure warning.** If a browser refuses a write, an on-screen alert says edits are currently in memory only and links to Settings for an immediate export. Exported JSON is unencrypted; handle it appropriately even though the shipped seed is fictional.
- **Billed Files** now reads the actual billed-file ledger, downloads the stored artifact rather than an invented summary, and can prepare a manual resend (download + increment the undoable send count). Preparing a resend does **not** transmit the file over the network.
- The agenda regression test checks a day’s badge against its rows rather than assuming a demo appointment exists on every day (e.g. Sundays).

### 835 ERA import (prior round)

- Payment Center → **Upload ERA (835)** accepts a local `.835`/`.txt` file (2 MB max). It parses a **claim-level subset** of X12, shows exact CLP01 claim matches, amounts, allowed amount, CARC adjustments and reasons for held lines. Nothing posts until you select eligible lines and confirm; you can also save the entire import as parked.
- Posting revalidates the live claim/payment ledger: draft, void and already-paid claims, unmatched or ambiguous claim numbers, repeated claims/lines/traces/files, unsupported service-line SVC allocations, malformed/negative amounts, overpayments, date/charge mismatches and inconsistent payer/patient allocations cannot auto-post. Provider-level PLB is flagged, **never** applied to a claim. A BPR-vs-CLP total difference is displayed for deposit review; it is **not** automatically reconciled or cleared.
- Selected payments, CARC denials, and the ERA audit record are one undoable transaction. The ERAs tab keeps posted/parked decisions, exports parked lines with reasons to CSV, and allows a parked line to be retried only after it becomes eligible. Typed ERA entry remains available but now rejects unsafe lines instead of silently skipping them.
- **Scope:** the 835 importer remains primary-claim-only; it does not perform SVC allocation, secondary 835 allocation, bank reconciliation, payer contact or network transmission. The shipped 835 demo fixture includes contradictory financial fields; those lines are intentionally parked, not force-posted. Use fictional data only, and review original remittances outside this demo before relying on a ledger.

### Linked secondary and reported patient share (prior round)

1. Post a primary partial remittance, then use **Secondary Queue → Create COB draft**. The draft snapshots the primary's remaining *claim-level* balance; its copied service lines are reference data, **not** an allocated secondary 837/CMS-1500. Verify coverage, COB, and service allocation outside Aloha. After filing elsewhere, choose **Record external filing** with the correct method. This changes only the local status; it does not send a claim or generate a compliant secondary form. An unremitted filing can be cancelled locally (which does not retract anything already sent externally); a skipped filing does not automatically bill the family.
2. Use **Record payer remittance** to open Payment Center with the secondary selected. The manual form can instead save a receipt as **unapplied** (no claim change). For a claim-linked receipt enter the actual payer amount and reference, any *secondary* adjudication adjustment, and a patient responsibility figure only if the remittance explicitly reports it. The live reducer rejects stale links, out-of-coverage filings, repeated references, bad cents, overpayments and duplicate voids. A secondary receipt is recorded on its child **and** reduces the primary's open balance; secondary adjustments never write off the primary. Payment voids write a signed reversal and restore both sides. Filing, payment, void and cancellation each have one tab-local Undo step.
3. **A/R Manager** counts only primary receivables, and splits each primary balance between the current filing/review bucket and the *reported* patient/self-pay bucket without duplicating dollars. An unknown insurance remainder is **not** patient A/R. Patient share is capped at the open primary balance and a pending secondary draft/submission suppresses the primary's earlier PR report until the secondary reports its own. **Invoices** downloads a clearly marked *draft* patient-share statement, not the whole insurer balance; the document builder likewise uses explicit patient share for client statements and separates payer portions. Review coverage and remittances before sending anything. The legacy QBO charge export excludes active COB pairs because it cannot allocate that balance to service lines.

Existing saved COB pairs with a consistent secondary paid total and no primary `secondaryPaid` are backfilled once; conflicting amounts are flagged `cobReviewNeeded` and block new COB postings or reported-PR billing rather than being silently capped. Original claim and payment histories remain available for manual investigation. The 835 importer deliberately parks secondary CLPs and now parks any primary with an active secondary filing. There is **no** secondary 835 auto-allocation, compliant secondary 837/1500, full EDI or bank reconciliation. This is a fictional-data demo, not a production billing or compliance system.

### Payroll cycle overview & phased wizard (current round)

**The payroll phases were unreadable on the landing page and in the wizard.** Three defects, one root cause each, all fixed and re-verified in a real browser:

- **The phase panels were clipped to 36px slivers.** `.pay-phase` was a shrinking flex child (`flex-shrink: 1`) inside the scrolling `.sectionpage` column with `overflow: hidden` — so `PHASE 2 OF 4` rendered as a one-line header and every control inside it (gates, guide, approval form) was scrolled out of a box that could not grow. Phase panels are now `flex: 0 0 auto` with `overflow: visible`; nothing in a payroll page can shrink or clip again (`.sectionpage.pay-hub > *` / `.pay-wizard-body > *` are pinned to their content height).
- **The four phases stacked on top of each other**, so "Approve" sat below the exception list, the KPI strip and an 866px register, and "Process & pay" rendered on the same screen as the approval form it was blocked by. The wizard now renders **one phase at a time**: the active phase in full, completed phases as compact recap rows with a **Change** button back into them, upcoming phases locked in the rail (they say why). The register, KPIs and gates are phase 2's content — they no longer follow the user into phases 3 and 4. New regression tests assert exactly one phase panel is mounted and that recaps navigate back.
- **Clicking Payroll dropped the user mid-wizard with no context.** Payroll now lands on a **cycle overview**: the current pay cycle (period, frequency, pay date, cutoff, eligible employees, worked hours), live checks with "Show n affected employees", the four phases as clickable status cards (done / you are here / next), one primary CTA that opens the wizard at the phase that is *next*, recent pay runs and tiles into every other payroll screen. The phase model is defined once (`PAY_PHASES` + `runProgress` in `PayrollCommon`) and shared by the landing page, the wizard rail and the panels, so the two routes can never disagree.

Phase semantics are unchanged: blockers still stop approval, exceptions are still recorded on the run, approval still needs a second person, and processing still re-prices and locks the register. Every payroll screen also carries the same module sub-nav (Cycle overview · Process Payroll · Pay Runs · Timesheets · ID Mapping · Summary · QuickBooks · Setup) with the rail ids unchanged, and each payroll page is a plain content-height column so its own tables and pagers lay out normally.

### Payroll Review Register & guided phases (prior round)

1. **Review Register drill-down.** "Show n affected employees" on Process Payroll → Review used to fire a toast; it now opens a list-view modal of every affected employee with the exact issue(s) on their record. Each row has a one-click **fix action that redirects to the module that can resolve it** — Payroll ID Mapping (missing/duplicate payroll IDs, rates, salary, exempt review, deductions, work state) or Timesheet Submission (unapproved sheets, EVV gaps, zero pay) with the employee pre-focused (profile editor or timesheet opens directly), and run-level issues (duplicate run, OT multiplier, rounding policy) link to Pay Runs / Payroll Setup. Draft runs can also **exclude an affected employee in-register** from the modal; excluded staff stay payable in a later off-cycle run. Blockers and exceptions both offer the drill-down.
2. **Guided payroll phases.** The Process Payroll wizard's four phases — Select period → Review register → Approve → Process & pay — are now a designed path: an icon rail with per-phase subtitles and state colouring (done / active / upcoming), and phase panels with a tone-coded icon tile, "Phase n of N" context, a numbered how-to guide and explicit next-step CTAs (Continue to approval →, Approve payroll, Process payroll). Gate semantics are unchanged: blockers still stop approval and exceptions are still recorded on the run.

### Claim-linked patient receipts (previous round)

- In **A/R Manager**, drill into a client and choose **Record receipt** on a primary claim with a remaining patient share. The draft Invoices view has the same shortcut. Alternatively use **Payment Center → + Patient receipt** and select a client and eligible primary claim. The amount must be positive, no more than that claim's **remaining explicitly reported patient responsibility** (or open self-pay balance), in cents, with a valid date, method and unique client receipt reference. A pending secondary filing suppresses patient collection until its own adjudication reports responsibility. One receipt applies to **one claim**; split deposits and allocation of previously unapplied receipts are not supported.
- Patient cash is recorded separately as `patientPaid` on the **primary** and as a payment-ledger entry with its original report source (primary or adjudicated secondary). It reduces the sole practice A/R and remaining patient share **once**; payer `paid`, `secondaryPaid`, secondary adjustments and the child filing remain unchanged. A self-pay invoice tied to that claim updates in the same Undo step. The A/R buckets, draft patient statement, claim register and invoice builder show the net balance rather than treating an unknown insurance remainder as family debt.
- Payment Center shows patient receipts and signed local reversals, with **Patient audit CSV** (references, date, recorded time, claim, source, amount, note, reversal link). A reversal restores the claim/invoice and patient A/R in one Undoable transaction, but **does not refund or move money in a bank/card system**. Duplicate/overprecise payments and mismatched local ledgers are blocked; backups containing torn patient receipt aggregates are rejected. Until allocated patient receipts have been reversed locally, changing the underlying payer remittance or creating a new secondary filing is conservatively held for review. Real-world refunds and adjustments must be verified externally.

No card charge, live patient billing, deposit reconciliation, cross-claim patient allocation, service-line ERA allocation, compliant secondary document, clearinghouse transmission or production accounting connection is provided. Use fictional data only.

## Working on this codebase

Keep pure billing/backup calculations in `src/lib/`, financial transitions in a **single** reducer action so one `U` can reverse them, and cover both the UI action and persistence in tests. Do not save Undo snapshots to localStorage: the seeded calendar already contains ~1,000 appointments. When adding a durable collection, add it to `WORKSPACE_FIELDS` in `src/lib/workspaceBackup.js`, validate it on import, and include it in a round-trip/Undo test. Export a backup before destructive migrations or before replacing local storage.

Next useful areas to verify against the older spec are secondary document format fidelity, service-line ERA/PLB-to-deposit reconciliation, and an end-to-end external COB/deposit/refund reconciliation workflow. No real PHI or live EDI traffic should be used for those tests.

## License

No license granted — demo/portfolio work; “CP-inspired” refers to general scheduling-software UX patterns only.
