# Aloha ABA — Billing Module · Upstream / Downstream Dependency Build Spec

**Companion to:** `docs/specs/billing-module-spec.md` (the end-to-end spec — all section refs below point into it)
**Purpose:** the build plan. Every build is named, ordered, and exits on evidence — so the
module can never "start" before its foundations exist, and no consumer is left half-updated.

---

## 1. Dependency graph (order is law)

```
UPSTREAM (foundations — no UI promises yet)
  U1  state v4 schema + normalizeBillingV2 migration
  U2  Provider Identifier master (settings.providers) + resolveProviders + BILL_CODES→9715x remap
  U3  Payer id extension (payer.ext: group/plan/sub/ticare/medicaid/bhpn/filing days)
  U4  Client COB (client.secondary) + profile card
  U5  Payments ledger (state.payments, immutable, void+reversal) + AR engine (arOf)
  U6  835 parser (parse835) — pure, fixture-driven
  U7  billingDocs builders (invoices, QBO CSV, verification, appeal letter, 835 error report)

CORE (pages, in dependency order)
  C1  Billing Manager grid (per-line rows, provider columns, Generate/Process, gate v2)
  C2  Billed Files (shares the file pipeline w/ C1)
  C3  Payment Center (Payments + ERAs, Add Payment, 835 import flow)
  C4  AR Manager (by client / by payer, drill-in, KPI strip)
  C5  Secondary Billing (COB queue, 3 submit methods, secondary remittance scope)
  C6  Generate Invoice (statement builder + options)
  C7  Verification Forms (3 formats)
  C8  QuickBooks export (QBO CSV + import doc)
  C9  CMS-1500 v2 (consumes U2/U3: real NPIs/taxonomy in 24FI/24JA/24GZ, Secondary flag,
      payer-specific ids; rejection "fix & re-submit" surface)

DOWNSTREAM (consumers — must land WITH or AFTER their core page)
  D1  Reports/Dashboard: AR KPIs, denial-by-CARC, payer mix, DSO, auth watch strip
  D2  Settings: offices, provider defaults, strictAuth/supervisionCheck, invoice seq
  D3  DetailCard / client profile: balance chip + AR status + secondary card + "bill" jump
  D4  Notifications: timely-filing warnings, auth expiring, secondary-ready toasts
  D5  Seed data: coherent billing ledger (payments, ERA fixture, 2ndaries, provider rows,
      billed files) — clean, conflict-free, exercises every screen
  D6  Test suite + probes (per chunk) + 4-viewport sweep
  D7  Share artifact (Aloha-ABA.html) + version stamp bump per chunk
```

**Build-order principles**
1. A build may only depend on builds strictly above it (or in the same chunk, marked ✓).
2. No build ships a UI control whose data source isn't complete (no stubs — standing rule).
3. Every chunk ends on the standing gate: vitest green → probe green (hostile state) →
   build ✓ → share HTML → version-named zip + push block.
4. Migrations (U1) are idempotent and forward-only; probes inject hostile v3 state to prove
   upgrade safety on every chunk that touches state.

---

## 2. Upstream builds

### U1 — state v4 schema + migration
- **What:** collections `payments / invoices / verificationForms / eraImports / billedFiles`;
  claim v2 fields (`method, reject, timelyDue, secondary, lines[].provider`); `meta.billingV2`;
  `normalizeBillingV2(state)` (idempotent; remaps legacy inline remittances → `payments`).
- **Why first:** every other build reads/writes these shapes; locking them prevents churn.
- **Contract:** `store` actions added: `postPayment, voidPayment, setSecondary, submitSecondary,
  recordBilledFile, recordInvoice, recordVerificationForm, recordEraImport, addProvider,
  updateProvider, deactivateProvider, setClientSecondary, setPayerExt` — all undoable (U).
- **Acceptance:** hostile v3 snapshot (claims with inline remittances, no providers) loads →
  ledger rows exist, `meta.billingV2` set, zero data loss, second load is a no-op.

### U2 — Provider Identifier master + resolution
- **What:** `settings.providers[]` schema (§4.1), `resolveProviders(state, claim)` pure fn
  (rendering = line staff or supervising BCBA per credential matrix §7.1; billing/facility =
  role-flagged rows else office default), NPI check-digit validation, taxonomy list §7.2,
  `BILL_CODES` remap to 97151–97158 + 0362T/0373T (EOL-flagged), modifier auto-suggest
  (HO/HN/HP/HM + 25/59/GN) from staff credential.
- **Why before C1:** Billing Manager rows show Rendering/Billing Provider + NPI and
  gate-submit on them; claims must resolve providers at submit, not render.
- **Acceptance:** seeded office + staff rows; claim submit with an RBT line on 97151 → gate
  warning (credential mismatch); missing NPI → hard gate; resolution is deterministic
  (same state → same refs, unit-tested).

### U3 — Payer id extension
- **What:** `payer.ext` (§4.2) + Payer profile fields (group/plan/sub-id/ticare/medicaid/
  bhpn + filing days) + migration defaults.
- **Why before C1/C9:** claims + 1500 + QBO read payer ids; filing deadline drives gate.
- **Acceptance:** payer edit persists; `timelyDue` uses ext override when present.

### U4 — Client COB
- **What:** `client.secondary` (§4.3) + Secondary insurance card on client profile (payer
  pick, member, auth, window, notes) + migration (null default).
- **Why before C5:** the secondary queue is driven entirely by this data.
- **Acceptance:** card saves/validates (payer must exist; window dates sane); claims with
  DOS inside window are eligible, outside not (pure fn unit-tested).

### U5 — Payments ledger + AR engine
- **What:** `state.payments` (§4.4, immutable, void+reversal), extended
  `postPayment(id, {amount, adj, patientResp, ref, date, kind, reconciled, source})`,
  `voidPayment`, claim closure math (`due = charges − adj − payerPaid − secondaryPaid`;
  `partially_paid`), `arOf(state, scope, asOf)` (§6.5) incl. lastPayment + 5 buckets.
- **Why before C3/C4:** Payment Center and AR Manager are thin UIs over these; the math
  must be pure + tested first (it's the financial core — money must reconcile to the cent).
- **Acceptance:** property-style tests — for a ledger of 200 random valid postings,
  Σ(paid+adj+patientResp) per claim = charges at closure; AR by-client and by-payer totals
  reconcile to Σ open dues ± $0.01; void+reversal is an exact inverse.

### U6 — 835 parser
- **What:** `parse835(text)` (§7.5) — pure, returns `{lines, matched, unmatched, errors}`;
  exact-claim-no match first, (code+DOS+units) line match, (code+DOS+amount) flagged review;
  CARC/RARC capture; fixture files in `src/__tests__/fixtures/` (one full: 5 lines incl.
  denial + partial; one malformed: structural errors → friendly report).
- **Why before C3:** the ERAs tab is parse→preview→post; the parser must be rock-solid
  before the UI exists.
- **Acceptance:** fixture suite green (field-level assertions on each parsed line); garbage
  input → `errors[]` non-empty, never throws.

### U7 — billingDocs builders
- **What:** `src/lib/billingDocs.js` — `buildInvoices, buildQboCsv, buildVerificationForm,
  buildAppealLetter, build835ErrorReport` (pure: state+opts → {fileName, content}), wired to
  exportKit (PDF/CSV). QBO contract locked §7.6 (columns, ≤1000 rows / ≤100 invoices, no
  negatives).
- **Why before C2/C6/C7/C8:** those pages are mostly "choose options → builder → download +
  record"; builders centralize the document-grade work (standing rule: document-grade output).
- **Acceptance:** unit tests per builder incl. edge cases (empty range, 1,200 rows → 2 files,
  zero-balance client excluded from statements, tax % applied only when > 0).

---

## 3. Core builds (pages)

### C1 — Billing Manager (`bil-manager`)
- **Depends:** U1–U3. **Fold in:** existing Staging/Claim desk/Blocked/Setup tabs (keep
  testids where unchanged); KPI band +2 (Total A/R, >90d $).
- **Deliverables:** per-line grid (screenshot 5 columns, sortable, 25/page, footer count),
  payer multiselect filter, status chips, Generate / Process Billing / ⤓CSV / ⎙CMS-1500 / ⚙,
  claim drawer (lines, gate v2 report with actionable reasons, history, actions), NPI
  click-through to Provider Identifier row, "Pending" amber states (NPI / auth), timely
  amber "file in Nd".
- **Exit:** probe — hostile state with missing NPI + expired auth + staged lines → grid
  renders every row type; Generate assembles; Process Billing submits only gate-clean;
  U reverts.

### C2 — Billed Files (`bil-files`)
- **Depends:** C1 (file pipeline), U7.
- **Deliverables:** table (screenshot 10 columns), Billed Through/payer/client filters,
  Generate (records artifact for selection or all open in range), Resend (sendCount++),
  re-download, empty state verbatim intent.
- **Exit:** probe — submit 2 claims via CH → 2 file rows; Resend bumps count; CSV + PDF
  artifacts re-download.

### C3 — Payment Center (`bil-payments`)
- **Depends:** U5, U6.
- **Deliverables:** Payments/ERAs tabs; payments table + floating +; Add Payment modal
  (Manual / Upload ERA(835) tabs, screenshot 3 field set); posting (§6.3); void+reversal;
  ERAs tab (imports list + line-level detail + Post/Park + unmatched CSV); Generate
  remittance export.
- **Exit:** probe — manual payment (partial, w/ adj + patientResp) → claim partially_paid,
  AR moves; 835 fixture upload → preview 5 lines → Post → 1 paid, 1 denied (CO-197 w/ hint),
  1 patientResp in AR, unmatched parks; U reverts whole import.

### C4 — AR Manager (`bil-ar`)
- **Depends:** U5 (arOf), C3 (so data exists to age).
- **Deliverables:** BY CLIENT / BY PAYER, client filter + Search, screenshot 4 columns,
  pagination, drill-in panel (open claims + payments + Statement/Export actions), KPI strip
  (Total A/R, >90d, DSO, collections rate, write-off YTD).
- **Exit:** probe — seeded ledger produces all 5 aging buckets in both views; view totals
  reconcile; drill-in Statement opens Generate Invoice pre-filled (Balance Only).

### C5 — Secondary Billing (`bil-secondary`)
- **Depends:** U4, U5, C3 (remittance trigger + post pipeline), C2 (artifact recording).
- **Deliverables:** COB queue (auto-`ready`), Release, Submit Claim ▾ (CH / Paper w/
  Background / Paper w/o Background), secondary no `-S1/-S2`, secondary remittance scope in
  Payment Center, Skip → patient balance, empty state (screenshot 2).
- **Exit:** probe — post primary partial on a COB client → claim appears in queue; each of
  3 submit methods → correct artifact (PDF box 18 = X on all; background snapshot attached
  only for `paper_bg`); secondary payment closes the claim.

### C6 — Generate Invoice (`bil-invoice`)
- **Depends:** U7, U5.
- **Deliverables:** exact screenshot 6 form (all 4 checkboxes functional), Payer/Client
  radio, builder wiring, `INV-YYYYMM-###` sequencing, records + re-download, CSV option.
- **Exit:** probe — Balance Only + Separated By Client → N files, paid lines hidden,
  numbering increments; scheduled rows excluded from totals.

### C7 — Verification Forms (`bil-verify`)
- **Depends:** U7, U3.
- **Deliverables:** screenshot 8 form; 3 formats (Parental / Benefit Verification /
  Prior Auth Request); branded PDF (payer letterhead from `payer.details`); history log.
- **Exit:** probe — multi-client run → multi-page PDF per client; Clear resets form.

### C8 — QuickBooks (`bil-qbo`)
- **Depends:** U7, U3 (payer/office scope), U2 (office rows).
- **Deliverables:** screenshot 7 form, QBO CSV (locked contract §7.6), split guards,
  in-app import instructions panel, Reset.
- **Exit:** probe — generate for 120-invoice fixture → 2 CSVs, row/line counts exact,
  numbering from Start; CSV header matches Intuit column list byte-for-byte.

### C9 — CMS-1500 v2
- **Depends:** U2, U3, C5 (secondary flag).
- **Deliverables:** boxes 24FI (billing NPI), 24JA (rendering NPI), 24GZ (facility) from
  `resolveProviders`; payer-specific ids (group/plan/sub, ticare/medicaid/bhpn per tab);
  Secondary mark (box 18 X, box 11B secondary payer); modifier print; rejection
  "Fix & re-submit" surface (claim `rejected` → editable draft).
- **Exit:** probe — CH claim renders all three provider NPIs correctly; secondary claim
  renders box 18 = X; text-extract assertions on the built PDF (existing pdf test pattern).

---

## 4. Downstream builds

| Id | Scope | Lands with | Evidence |
|---|---|---|---|
| D1 | Reports desk: AR aging report, denials by CARC (top-5 w/ $), payer mix, DSO + clean-claim KPIs; Dashboard: auth watch + secondary-ready strip | C4, C5 | report tests (existing `runReport` pattern) |
| D2 | Settings modal: office list editor, provider role defaults, `strictAuth`, `supervisionCheck`, invoice seq, 837P format choice | C1, C9 | settings round-trip test |
| D3 | DetailCard: client balance chip + AR status (Current/60+/120+), secondary card (read), "Open in Billing" jump (`ui.billPage`+`billSel`) | C1, C4, C5 | detail-card test + probe jump |
| D4 | Notifications/toasts: timely-filing <21d (amber nav badge), auth expiring ≤30d, secondary-ready, ERA parked | C1, C3, C5 | probe toast assertions (scoped selectors — lesson from c39 m5) |
| D5 | Seed: provider rows (office ×5 NPIs + staff), payer ext ids, 2 clients w/ secondary, 250+ postings over 12 months (checks/ERAs/writeoffs), 1 parked ERA fixture, 4 secondary claims across statuses, 30 billed files, invoices + verification forms — zero conflicts (standing rule) | D-end of every core chunk (grown incrementally) | seed hygiene test (pattern: chunk-38/39) |
| D6 | Per-chunk vitest + probes (c40–c49) + 4-viewport sweep | every chunk | standing gate |
| D7 | `share/Aloha-ABA.html` + NavRail version stamp (`v15`…) | every chunk | standing gate |

---

## 5. Cross-cutting contracts (binding on every build)

1. **State versioning:** storage key unchanged (`aloha-aba.v3`); version flags in `meta`
   (`billingV2`…); migrations idempotent, forward-only, no data loss beyond explicit design.
2. **Testids:** per-page roots from spec §3; every interactive control has one; probes use
   them exclusively (no text-fragile selectors — standing lesson).
3. **Money:** integers-of-cents internally, `money()` at render; closure math always
   `r2`-rounded; AR reconciles to ±$0.01 (asserted).
4. **Dates:** ISO (`yyyy-mm-dd`) at rest, `fmtDayLabel` at render; aging = calendar days.
5. **Undo:** every financial transition (post, void, submit, rebill, secondary) is one `U`;
   batch ops (835 post, Process Billing) are single undo units.
6. **Immutability:** payments & file records append-only; corrections = reversal/new record.
7. **Empty states:** always icon + sentence + one primary CTA (screenshot 2/10 tone).
8. **No stubs:** a control that exists does the thing; if a capability needs a future
   backend (real EDI/QBO API), it ships as a documented adapter seam + generated artifact —
   never a dead button.
9. **Performance:** grids paginate at 25; pure fns memoized; no blocking > 16ms on 500 rows.
10. **Documents:** letter size, practice header + confidentiality footer (spec §7.8);
    PDFs verified by text extraction in tests (existing pattern).

## 6. Chunk plan (execution order)

| Chunk | Builds | Deliverable (user-visible) | Exit criteria |
|---|---|---|---|
| 40 | U1 + U2 | Billing v2 schema + provider master (backend of Provider Identifier) | hostile-v3 migration probe; resolution unit tests |
| 41 | U3 + U4 + D2(partial) | Payer ids + client COB card + settings basics | payer/client round-trip tests |
| 42 | U5 + U6 | Payments ledger + AR engine + 835 parser | closure/AR property tests; fixture suite |
| 43 | C1 + C2 + D3(partial) + D5(partial) | **Billing Manager + Billed Files** (screenshot 5, 10) | probes c40/c41; suite green |
| 44 | C3 + D4(partial) | **Payment Center** incl. ERA import (screenshot 3) | probe c42 (835 flow) |
| 45 | C4 + D1(partial) | **AR Manager** (screenshot 4) | probe c43 (aging reconciliation) |
| 46 | C5 + D5(partial) | **Secondary Billing** (screenshot 2) | probe c44 (COB end-to-end) |
| 47 | C6 + C7 | **Generate Invoice + Verification Forms** (screenshots 6, 8) | probe c45 |
| 48 | C8 + C9 | **QuickBooks + CMS-1500 v2** (screenshot 7) | probe c46 (QBO CSV bytes + 1500 boxes) |
| 49 | D1 + D3 + D4 + D5(final) + D7 | Downstream polish, full seed, reports, version v15 | probe c47 (4-viewport + hostile state + full ledger reconciliation) |

**Standing gate per chunk (unchanged):** vitest green → probe green → `npm run build` ✓ →
`npm run share` → version-named zip (`CP-Inspired-Scheduler-vNN-*.zip`) presented + full
PowerShell push block (standing rule — never omitted).

## 7. Risk register

| Risk | Likelihood | Mitigation |
|---|---|---|
| localStorage bloat from ledger (postings/files) | Med | 5k-record cap + age pruning (U1) + names-only attachments |
| 835 format variance across payers | High | parser = strict subset + park-unmatched + error-report CSV; fixture suite expanded per real file the user drops in |
| QBO import contract drift (Intuit changes) | Low | contract locked in §7.6 + column test; worst case = user remaps in QBO UI (documented) |
| COB complexity scope creep | Med | hard scope: one secondary payer, 3 submit methods, no re-identification/COB requests (noted out-of-scope) |
| Money math bugs | Low (property-tested) | U5 property tests + per-chunk reconciliation probe |
| CMS-1500 box placement regressions | Low | existing red-preprint PDF tests extended for 24FI/24JA/24GZ/18 |
| Chunk size vs. context | Med | each chunk self-contained; specs are the source of truth so any chunk can resume cold |

---
*Both docs live in-repo (`docs/specs/`) and ship in the next version zip. When you're ready,
say **start chunk 40** and the build plan above executes — each chunk ends with its zip +
push block as always.*
