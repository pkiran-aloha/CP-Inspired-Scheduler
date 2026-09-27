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

### 835 ERA import (this round)

- Payment Center → **Upload ERA (835)** accepts a local `.835`/`.txt` file (2 MB max). It parses a **claim-level subset** of X12, shows exact CLP01 claim matches, amounts, allowed amount, CARC adjustments and reasons for held lines. Nothing posts until you select eligible lines and confirm; you can also save the entire import as parked.
- Posting revalidates the live claim/payment ledger: draft, void and already-paid claims, unmatched or ambiguous claim numbers, repeated claims/lines/traces/files, unsupported service-line SVC allocations, malformed/negative amounts, overpayments, date/charge mismatches and inconsistent payer/patient allocations cannot auto-post. Provider-level PLB is flagged, **never** applied to a claim. A BPR-vs-CLP total difference is displayed for deposit review; it is **not** automatically reconciled or cleared.
- Selected payments, CARC denials, and the ERA audit record are one undoable transaction. The ERAs tab keeps posted/parked decisions, exports parked lines with reasons to CSV, and allows a parked line to be retried only after it becomes eligible. Typed ERA entry remains available but now rejects unsafe lines instead of silently skipping them.
- **Scope:** the 835 importer remains primary-claim-only; it does not perform SVC allocation, secondary 835 allocation, bank reconciliation, payer contact or network transmission. The shipped 835 demo fixture includes contradictory financial fields; those lines are intentionally parked, not force-posted. Use fictional data only, and review original remittances outside this demo before relying on a ledger.

### Linked secondary and reported patient share (current round)

1. Post a primary partial remittance, then use **Secondary Queue → Create COB draft**. The draft snapshots the primary's remaining *claim-level* balance; its copied service lines are reference data, **not** an allocated secondary 837/CMS-1500. Verify coverage, COB, and service allocation outside Aloha. After filing elsewhere, choose **Record external filing** with the correct method. This changes only the local status; it does not send a claim or generate a compliant secondary form. An unremitted filing can be cancelled locally (which does not retract anything already sent externally); a skipped filing does not automatically bill the family.
2. Use **Record payer remittance** to open Payment Center with the secondary selected. The manual form can instead save a receipt as **unapplied** (no claim change). For a claim-linked receipt enter the actual payer amount and reference, any *secondary* adjudication adjustment, and a patient responsibility figure only if the remittance explicitly reports it. The live reducer rejects stale links, out-of-coverage filings, repeated references, bad cents, overpayments and duplicate voids. A secondary receipt is recorded on its child **and** reduces the primary's open balance; secondary adjustments never write off the primary. Payment voids write a signed reversal and restore both sides. Filing, payment, void and cancellation each have one tab-local Undo step.
3. **A/R Manager** counts only primary receivables, and splits each primary balance between the current filing/review bucket and the *reported* patient/self-pay bucket without duplicating dollars. An unknown insurance remainder is **not** patient A/R. Patient share is capped at the open primary balance and a pending secondary draft/submission suppresses the primary's earlier PR report until the secondary reports its own. **Invoices** downloads a clearly marked *draft* patient-share statement, not the whole insurer balance; the document builder likewise uses explicit patient share for client statements and separates payer portions. Review coverage and remittances before sending anything. The legacy QBO charge export excludes active COB pairs because it cannot allocate that balance to service lines.

Existing saved COB pairs with a consistent secondary paid total and no primary `secondaryPaid` are backfilled once; conflicting amounts are flagged `cobReviewNeeded` and block new COB postings or reported-PR billing rather than being silently capped. Original claim and payment histories remain available for manual investigation. The 835 importer deliberately parks secondary CLPs and now parks any primary with an active secondary filing. There is **no** secondary 835 auto-allocation, compliant secondary 837/1500, patient collection/receipt allocation, full EDI or bank reconciliation. This is a fictional-data demo, not a production billing or compliance system.

## Working on this codebase

Keep pure billing/backup calculations in `src/lib/`, financial transitions in a **single** reducer action so one `U` can reverse them, and cover both the UI action and persistence in tests. Do not save Undo snapshots to localStorage: the seeded calendar already contains ~1,000 appointments. When adding a durable collection, add it to `WORKSPACE_FIELDS` in `src/lib/workspaceBackup.js`, validate it on import, and include it in a round-trip/Undo test. Export a backup before destructive migrations or before replacing local storage.

Next useful areas to verify against the older spec are secondary document format fidelity, service-line ERA/PLB-to-deposit reconciliation, and an audited end-to-end COB/patient-collections workflow. No real PHI or live EDI traffic should be used for those tests.

## License

No license granted — demo/portfolio work; “CP-inspired” refers to general scheduling-software UX patterns only.
