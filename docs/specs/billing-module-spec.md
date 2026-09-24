# Aloha ABA — Billing Module · End-to-End Specification

**Status:** APPROVED-TO-BUILD (pending user sign-off) · **Target:** v15+ · **Date:** 2026-09-24
**Companion doc:** `docs/specs/billing-dependencies-spec.md` (upstream/downstream build plan)

---

## 0. Scope, constraints, honesty boundary

### 0.1 What this module is
A full **revenue-cycle desk** for a local-first ABA practice: stage billable sessions → assemble
claims → submit (primary) → receive remittance (manual / EOB / ERA 835) → manage patient
balances (AR aging) → secondary billing (COB) → denials/appeals/rebills → statements,
invoices, QuickBooks export, coverage-verification documents, and provider/NPI credential
management.

### 0.2 Hard constraints (non-negotiable, inherited)
- **Local-first**: React SPA, no backend, all state in `localStorage` (`aloha-aba.v3`).
- **No stubs** — every control functional; document-grade documents; design system/IA/colors/
  testid conventions preserved (the reference screenshots define *structure*, we render in
  Aloha's design language).
- **Clean demo data** — seed ships a coherent, conflict-free billing ledger (payments, ERAs,
  secondary claims, billed files) that exercises every screen.
- **Undo (U)** must remain one-keystroke for every claim/payment transition.
- Screenshots are the **floor, not the truth** — industry best practice below is in scope too.

### 0.3 Honesty boundary (what local-first can and cannot do)
| Capability | Local-first reality | Spec treatment |
|---|---|---|
| Clearinghouse EDI (837P send / 835 receive) | No network. We **generate** submission-ready files (837P-style CSV + CMS-1500 PDF) and **parse** uploaded 835 files. | Submission = status transition + file artifact; a `SubmissionAdapter` interface is defined so a future backend can plug real EDI without schema change. |
| QuickBooks | No API. Export **QBO-import-compliant CSV** (≤1,000 rows, ≤100 invoices/file, no negative charges; user enables "Custom transaction numbers" in QBO). | Documented in §5.6 + export format locked in §7.6. |
| EOB scanning | No OCR. Paper EOBs are entered **manually** into the same remittance pipeline (kind `eob`). | §5.3 |
| Eligibility 270/271 | Out of scope (no network). Auth tracking is manual per client. | Noted; verification *documents* are in scope (§5.7). |

---

## 1. Screenshot coverage matrix (all 10 — every item is in scope)

| # | Screenshot | Page (section id) | Key elements captured |
|---|---|---|---|
| 1 | Billing nav | all 9 | 7-cycle pages + divider + Provider Identifier, Billed Files |
| 2 | Secondary Billing | `bil-secondary` | Release, Submit Claim → Clearing House / Paper Mail with Background / Paper Mail without Background, empty state |
| 3 | Payment Center | `bil-payments` | Payments / ERAs tabs, range filter, Add Payment (Manual / Upload ERA(835)), source/date/type/ref#/amount/attachments/reconciled, floating + |
| 4 | AR Manager | `bil-ar` | BY CLIENT / BY PAYER, client filter + Search, Last Payment, Current, 31–60, 61–90, 91–120, 121+, Balance, pagination (25/page) |
| 5 | Billing Manager | `bil-manager` | Payer filter (+N more), date range, Generate, Process Billing, 3 export actions, per-line rows: checkbox, lock, Date, Time, Staff, Client, Rendering Provider (NPI), Payer, Authorization, Service Name, Service Facility, Billing Provider, 1–15 of N footer |
| 6 | Generate Invoice | `bil-invoice` | Payer/Client radio, Payer*, Invoice Format, From/To*, Client(s), Order By*, Description as*, Document Format, Include Tax ID, Tax %, Top/Bottom Notes, Balance Only, Include Appointment Time, Separated By Client, Include Scheduled Appointments |
| 7 | QuickBooks | `bil-qbo` | Client Office(s)*, Payer(s)*, Client(s)*, Start/End*, Invoice Date*, Due Date*, Invoice Number Start*, Generate, Reset |
| 8 | Verification Forms | `bil-verify` | Payer*, Verification Format (Parental Verification…), From/To*, Client(s)*, Appointment State, Document Format, Generate, Clear |
| 9 | Provider Identifier | `bil-providers` | Tabs General / Ticare ID / Medicaid ID / BHPN ID / Referring Provider; filters Office/Staff With NPI, Show Active; grouped rows; NPI, Taxonomy, Rendering/Billing/Service-Facility checkboxes, degree/credential column, add-row |
| 10 | Billed Files | `bil-files` | Billed Through filter, Generate, Resend, Client Name, Payer Name, Date of Service, Generated On, Billed Through, Status, File Name, "No claims are billed in the selected Date Range" |

---

## 2. Current-state inventory (what already exists) and the gap

**Exists today (keep, extend):**
- `src/lib/claims.js` — claim lifecycle engine: `stagedAppts` (billable completed appts with units/mileage + verification gate), `planClaims` (client × DOS-month; self-pay = single invoice), `lineFor`, `assembleClaims`, `claimGate` (validation), transitions `submitPatch / payPatch / denyPatch / releasePatch / dropLinePatch / rebillPatch` (version chain `-R2`), `PAYER_POLICY` (avgDays, timely filing days, coins, copay), deterministic `memberIdOf / authNoOf / npiOf / dxFor`, `agingOf` (0–30/31–60/61–90/90+), `claimStats`, `claimCsv/claimsCsv`, `quickPosts`.
- `src/components/BillingView.jsx` — single section, 4 tabs (Staging / Claim desk / Blocked / Setup), KPI band, CMS-1500 batch PDF, ledger CSV, submit-all, auto-fill units.
- `src/lib/cms1500.js` — CMS-1500 red-preprint + black-data PDF (single + batch).
- `settings.org` (name, taxId, npi, address, phone); `settings.billing` (claimPrefix, invoicePrefix, requireVerification); payer details (contacts, fax, portal, EVV id).

**Gaps (this spec fills):**
| Gap | Screenshot | Section |
|---|---|---|
| No 9-page IA (one 4-tab section instead) | 1 | §3 |
| No per-line claim grid w/ provider columns | 5 | §5.1 |
| No patient-level AR (balances, aging, by client/payer) | 4 | §5.3, §6.5 |
| No payment register; payments only as per-claim modal; no 835 upload | 3 | §5.4, §6.3 |
| No secondary insurance / COB at all | 2 | §5.5, §6.4 |
| No invoice/statement builder with options | 6 | §5.6, §6.6 |
| No QuickBooks export | 7 | §5.7, §7.6 |
| No verification documents | 8 | §5.8 |
| NPIs are hash-derived pseudo-values; no taxonomy, roles, payer-specific ids | 9 | §5.9, §4.3 |
| No claim-file tracking (generated/sent/resend) | 10 | §5.10, §6.2 |
| Claim status set lacks processing/rejected/partial/appeal; no CARC-based denials; no timely-filing enforcement | — | §4.5, §6.4, §7.3 |

---

## 3. Information architecture

Billing becomes a **9-item section** in the NavRail (mirrors screenshot 1; rendered in Aloha
design language):

| Order | Page | Section id | Testid root |
|---|---|---|---|
| 1 | Billing Manager | `bil-manager` | `bm-` |
| 2 | AR Manager | `bil-ar` | `ar-` |
| 3 | Payment Center | `bil-payments` | `pc-` |
| 4 | Secondary Billing | `bil-secondary` | `sb-` |
| 5 | Generate Invoice | `bil-invoice` | `gi-` |
| 6 | QuickBooks | `bil-qbo` | `qbo-` |
| 7 | Verification Forms | `bil-verify` | `vf-` |
| — | *divider* | — | — |
| 8 | Provider Identifier | `bil-providers` | `pi-` |
| 9 | Billed Files | `bil-files` | `bf-` |

Rules:
- Existing 4 tabs (Staging / Claim desk / Blocked / Setup) **fold into** Billing Manager
  (staging + desk = manager rows) and keep their testids where unchanged; `bil-setup` remains
  reachable via the manager's ⚙ action (org/billing settings).
- Each page: `SectionBar` with page title + range/filter controls on the right; KPI chips where
  meaningful; empty states always icon + sentence + **one primary action** (standing rule).
- Deep-links: `ui.bilJump` (existing) extended to `ui.billPage` + `ui.billSel` so DetailCard /
  Reports can open a claim on the right page.

---

## 4. Data model (state v4)

Storage key stays `aloha-aba.v3`; new top-level collections + `meta.billingV2` flag. All
migrations are **idempotent normalize functions** (established pattern: `normalizeLegacyCustom`),
run in `initial()` before hydration, never destructive beyond explicit design.

### 4.1 `settings.providers[]` — provider identifier master (new)
```js
{
  id: 'pr-…', name: 'Aloha ABA Center', kind: 'office' | 'staff',
  refId: 'st-…' | null,          // staff id when kind=staff
  credential: 'BCBA' | 'RBT' | 'BCaBA' | 'Office',
  degree: 'M.A.' | 'Ph.D.' | '' ,
  npi: '1720418390' | '',        // 10 digits, validated
  taxonomy: '101YP00000X' | '',  // §7.2 reference
  roles: { rendering: true, billing: false, facility: true },
  payerIds: { ticare: '', medicaid: '', bhpn: '', referrers: '' }, // per-payer identifiers (screenshot 9 tabs)
  active: true, createdAt: ts
}
```
- Seeded from `settings.org` (office row) + every staff member (staff rows) — migration U2.
- **Resolution rules** (pure fn `resolveProviders(state, claim)`, §6.2): rendering provider =
  line's staff (or supervising BCBA when payer requires, §7.1 credential matrix); billing
  provider = staff/office with `roles.billing` for that payer, else office default; service
  facility = `roles.facility`, else office. Missing NPI → claim **gate failure** (blocks
  submit with actionable reason — this is how the reference's "Pending" NPI rows get fixed).

### 4.2 `payer.ext` (extend existing payer)
```js
ext: { group: '', plan: '', subId: '', ticareId: '', medicaidId: '', bhpnId: '',
       filingDeadlineDays: 180,    // overrides PAYER_POLICY.timely
       requiresSecondaryBox18: true }
```

### 4.3 `client.secondary` (new — COB)
```js
secondary: { payerId: 'py-…', memberId: '', authNo: '', relation: 'secondary',
             since: '2026-03-01', until: null, note: '' } | null
```
Client profile (Payers/Clients section) gains a **Secondary insurance** card: payer pick,
member id, auth number, active window. `client.insurer` remains primary.

### 4.4 `state.payments` (new — first-class ledger)
```js
{ id: {
  id: 'pay-…', claimId: 'clm-…' | null, clientId, payer,
  kind: 'check' | 'credit' | 'debit' | 'cash' | 'ach' | 'era835' | 'eob' | 'writeoff',
  amount: 120.5, adj: 18.0, patientResp: 30.0,   // amounts sum to claim.charges at closure
  ref: 'CK-10422', date: '2026-09-24',
  reconciled: false, note: '', attachments: [],
  source: { eraFileId: 'era-…', line: 7 } | null,
  reversalOf: 'pay-…' | null,    // corrections are void+reversal, never in-place edit
  createdAt: ts, createdBy: 'Aloha (local)'
} }
```
Ledger rules: immutable (no edit action exists); `voidPayment(id)` posts a `reversalOf` entry
and releases the claim to its prior open state; every payment carries the claim + client denorm
so the AR engine never depends on claim retention.

### 4.5 Claim v2 (extend existing claim object — backward compatible)
```js
// added fields:
status: 'draft' | 'submitted' | 'processing' | 'rejected' | 'paid' | 'partially_paid' |
        'denied' | 'appeal' | 'void',
method: 'ch' | 'paper' | 'selfpay' | null,        // how submitted
reject: { code: 'REJ-005', reason: '', at: ts } | null,   // clearinghouse hard reject
timelyDue: '2027-03-24' | null,                    // DOS + filing window (warning at 21d left)
secondary: {
  status: 'none' | 'ready' | 'submitted' | 'paid' | 'denied' | 'skipped',
  method: 'ch' | 'paper_bg' | 'paper_nobg' | null,
  submittedAt: ts | null, no: '…-S1', remittance: null, denial: null, at: ts | null
} | null,
lines[].provider: { renderId, billId, facId }       // resolved provider refs (§4.1)
```
`claim.history` stays append-only (audit trail).

### 4.6 `state.invoices` / `state.verificationForms` / `state.eraImports` / `state.billedFiles` (new)
```js
invoices:        { id: { id, no: 'INV-202609-001', for: 'payer'|'client', payerId, clientIds[],
                         from, to, options: { format, orderBy, descriptionAs, doc, taxId, taxPct,
                                              top, bottom, balanceOnly, inclTime, perClient, inclScheduled },
                         status: 'generated', generatedAt, fileName, lines[], total } }
verificationForms: { id: { id, payerId, format: 'parental'|'benefit'|'auth_request',
                           from, to, clientIds[], apptState, doc, generatedAt, fileName } }
eraImports:      { id: { id, fileName, importedAt, linesTotal, matched, unmatched,
                         status: 'posted'|'parked', detail: […line-level…] } }
billedFiles:     { id: { id, claimIds[], clientId, payer, dosFrom, dosTo, billedThrough,
                         generatedAt, fileName, format: 'cms1500'|'csv'|'837p',
                         status: 'generated'|'sent', sentAt, sendCount, note } }
```

### 4.7 Migration (U1)
`normalizeBillingV2(state)` — idempotent, `meta.billingV2` flag:
1. seed `settings.providers` (office + staff rows) if absent (keeps user edits if present);
2. default `payer.ext` (empty ids) for payers missing it;
3. upgrade claims: add `method/timelyDue/secondary/reject/provider` defaults; remap any
   `payPatch`-style inline remittances into `state.payments` entries (kind from context);
4. keep everything else byte-identical. Toast: one-time "Billing v2 — payments & provider IDs
   now tracked on their own ledgers (N records migrated)".

---

## 5. Page functional specifications

Money everywhere: `$1,234.56` (2dp when fraction, 0dp otherwise — existing `money()`).
Dates: existing `fmtDayLabel` / ISO. All lists: sortable columns (▲▼), search, pagination at
25/page where rows > 25, footer `1–25 of N`.

### 5.1 Billing Manager (`bil-manager`)
**Purpose:** the daily work surface — see every billable line and every claim, in one grid.
- **Filters (SectionBar):** payer multiselect ("+N more" collapse like screenshot), date-range
  picker (existing `RangePicker`), search (client/claim #/provider), status chips
  (All / Staging / Draft / Processing / Paid / Denied / Secondary-ready).
- **Actions (right):** `Generate` (assemble staging → claims, existing behavior),
  `Process Billing` (submit all gate-passing drafts — one confirm, undoable), ⤓ CSV,
  ⎙ CMS-1500 batch, ⚙ (setup: org/billing defaults).
- **Grid (per claim line, screenshot 5):** checkbox · lock icon (line already claimed →
  locked, tooltip) · Date · Time (start–end) · Staff · Client · **Rendering Provider**
  (name + NPI, link → provider row; "Pending" in amber when NPI missing) · Payer ·
  **Authorization** (auth # or "Pending" amber when auth window doesn't cover DOS) ·
  Service Name · Service Facility · **Billing Provider** (name + NPI).
- **Row click** → claim drawer (existing claim detail: lines, gate report, history, actions
  submit/void/rebill/drop-line/pay/deny). Staging rows (not yet claimed) show the same grid
  with the **staging** chip; checking them + Generate = assemble.
- **Empty states:** no staging → "Nothing claim-ready in this range — completed billable
  sessions land here automatically." with CTA to Calendar; no claims → CTA Generate.
- **Acceptance:** every row of screenshot 5 reproducible from seed; NPI click-through works;
  Generate/Process both undoable with U.

### 5.2 Billed Files (`bil-files`)  *(built with 5.1 — shares the file pipeline)*
- **Filters:** Billed Through (date), payer, client, search; **Actions:** `Generate` (selected
  or all open claims in range → downloads CMS-1500 PDF / CSV / 837P-style CSV per format
  setting, records file), `Resend` (re-downloads + bumps `sendCount`, sets `sentAt`,
  status `sent`).
- **Table (screenshot 10):** checkbox · Client Name · Payer Name · Date of Service
  (range) · Generated On · Billed Through · Status (chip: generated / sent · ×N) · File Name
  (click = re-download).
- **Empty state:** "No claims are billed in the selected Date Range" (verbatim intent).
- **Acceptance:** Generate from Billing Manager selection lands here with correct
  billedThrough = max DOS; Resend increments count; file re-downloads identical artifact.

### 5.3 AR Manager (`bil-ar`)
**Purpose:** patient-level receivables with standard aging.
- **View toggle:** BY CLIENT / BY PAYER (screenshot 4). BY PAYER groups balances by payer with
  the same columns + payer name; row = client (or payer).
- **Filters:** client multiselect + Search button (existing picker pattern), range (aging
  "as of" date).
- **Columns:** Last Payment (date + method, "—" when none) · **Current** (0–30) · **31–60** ·
  **61–90** · **91–120** · **121+** · **Balance** (bold; red when > 90d share > 50%).
- **Aging basis:** claim `submittedAt` (insurance) or invoice `generatedAt` (self-pay),
  computed by pure `arOf(state, {clientId?, payerId?}, asOf)` in `claims.js` v2.
- **Row click** → drill-in panel: the client's open claims (nos, DOS, charges, paid, due,
  status) + payment history + **actions:** Statement (opens Generate Invoice pre-filled,
  Balance Only), Export AR CSV.
- **KPI strip (top):** Total A/R, >90d $, DSO, collections rate (90d), write-off YTD.
- **Acceptance:** seed produces non-zero aging across ≥4 buckets in both views; totals in
  both views reconcile to sum of open claim dues ± $0.01.

### 5.4 Payment Center (`bil-payments`)
**Purpose:** money-in — manual receipts, EOB entries, ERA 835 imports, reconciliation.
- **Tabs:** `Payments` / `ERAs` (screenshot 3). Range filter applies to both.
- **Payments tab:** table (Date · Client · Payer · Claim # · Method (check/credit/ach/era/eob/
  writeoff) · Ref # · Amount · Adj · Patient resp · Status (open / reconciled) · actions
  [Reconcile] [Void] [View]) + **floating +** button → **Add Payment** modal:
  - tabs **Manual Payment** / **Upload ERA(835)**;
  - Manual: Select Payment Source* (payer → then claim picker scoped to that payer's open
    claims), Payment Date*, Payment Type (Check/Credit/Debit/Cash/ACH), Reference #*,
    Amount*, **Payment Reconciled** checkbox, Attachments (file refs stored as names),
    footer note "Please remember to save your changes", Save/Cancel.
  - Validation: amount ≤ open due (warn on overpay → routes excess to patient credit,
    documented); claim must be open (submitted/processing/partially_paid).
  - **Posting rules:** payer portion → `payPatch` semantics (status → paid when due = 0,
    else `partially_paid`); `adj` = contractual adjustment; `patientResp` → patient
    balance (AR). Secondary-eligible claims: after posting, `secondary.status = 'ready'`
    when payer portion settled and client has secondary (§6.4).
- **ERAs tab:** table of `eraImports` (File · Imported · Lines · Matched · Unmatched ·
  Status (posted/parked)) + row click → **ERA detail**: line-level table (claim #, code, DOS,
  charged, allowed, payer pay, pt resp, adj, CARC) with per-line **Post** / **Park**;
  unmatched lines → "Export unmatched CSV" (error report with suggested match keys).
- **Generate (top-right):** builds a remittance batch export (CSV) of open payables for the
  range — for payers we still owe (write-offs/refunds audit), recorded in Billed Files.
- **Upload ERA(835):** file input → `parse835(text)` (§7.5) → **preview screen** (matched
  green / unmatched amber, per-line CARC) → `Post` (creates `state.payments` kind `era835`,
  applies pays/adj/patientResp, CARC denials → claim `denied` with code+fix, posts
  `eraImports` record). One undo covers the whole import.
- **Acceptance:** seeded 835 fixture posts 5 lines (1 denial CO-197, 1 partial w/ PR-2
  coinsurance), unmatched line parks; AR totals move exactly by posted amounts.

### 5.5 Secondary Billing (`bil-secondary`)
**Purpose:** COB queue — primary settled, secondary eligible.
- **Queue:** claims where `secondary.status === 'ready'` (auto-flagged on primary settlement
  when `client.secondary` active on DOS). Columns: Client · Primary claim # · Payer (primary) ·
  Secondary payer · Member (secondary) · Remaining after primary (payer portion) · DOS ·
  Submitted (primary) · Auth # (secondary) · status chip.
- **Actions:** `Release` (move back to staging — voids the chain, releases appts);
  `Submit Claim ▾` → **Submit to Clearing House** (837P-style CSV + CMS-1500 PDF marked
  Secondary, box 18 "X", `secondary.no` = parent + `-S1`, status `submitted`) ·
  **Paper Mail with Background** (PDF + attached primary remittance snapshot) ·
  **Paper Mail without Background** (PDF only). All recorded in Billed Files; all undoable.
- **Secondary remittance:** same Payment Center pipeline with claim scoped to
  `secondary.status === 'submitted'` (payments post to `secondary.remittance`; claim closes
  when primary + secondary dues = 0).
- **Denials:** secondary denial → `secondary.denial` (CARC) with fix hint; "Re-submit"
  creates `-S2`.
- **Empty state (screenshot 2):** "No secondary claims waiting — when a primary payment
  settles with a payer balance and the client carries secondary coverage, it queues here."
- **Acceptance:** seed includes 2 ready + 1 submitted + 1 paid secondary; all three submit
  methods produce correct artifacts (PDF shows Secondary in box 18/11B).

### 5.6 Generate Invoice (`bil-invoice`)
**Purpose:** direct-bill statements/invoices (self-pay families, patient-resp balances,
payer letters).
- **Form (screenshot 6, exact field set):** Invoice for **Payer/Client radio** · Payer*
  (when Payer) · Invoice Format (Standard Invoice / Statement of Account / Payment Reminder) ·
  From Date* / To Date* · Client(s) (multiselect; optional) · Order By* (Date / Client / Payer) ·
  Description as* (Service Name / CPT + Description / Session Title) · Document Format
  (PDF / CSV) · Include Tax ID (checkbox) · Tax % (number, default 0 — ABA is generally
  tax-exempt; field exists per screenshot) · Top Notes / Bottom Notes (textareas) ·
  **Balance Only** · **Include Appointment Time** · **Separated By Client** ·
  **Include Scheduled Appointments** (checkboxes, all functionally real).
- **Generate:** builds invoice(s) via `buildInvoices(state, opts)` → per-client documents
  when Separated By Client; line items = open dues in range (charges − adj − paid, grouped by
  DOS; time column when included; scheduled rows greyed, excluded from totals unless
  "scheduled estimate" mode); numbering `INV-YYYYMM-###` (settings.billing.invoiceSeq);
  PDF via exportKit (letter, practice header, client/payer block, line table, totals, notes)
  + CSV option; record in `state.invoices`; **Send** action (re-download + toast).
- **Acceptance:** Balance Only hides paid lines; per-client split produces N files; invoice
  #s increment across runs; CSV opens in Excel (quoted fields).

### 5.7 QuickBooks (`bil-qbo`)
**Purpose:** export invoices into QuickBooks Online.
- **Form (screenshot 7):** Client Office(s)* (office picker from `settings.providers`
  kind=office) · Payer(s)* · Client(s)* · Start Date* / End Date* · Invoice Date* ·
  Due Date* · Invoice Number Start* (e.g. `4127`) · **Generate** · **Reset**.
- **Output:** one CSV, **QBO-import-compliant**:
  columns `Invoice Number, Customer, Invoice Date, Due Date, Product/Service, Qty, Unit Price,
  Amount, Memo, Tax Code` — one row per service line; invoices grouped per client (numbering
  sequential from Invoice Number Start); `Customer` = client display name ("Last, First");
  guards: ≤1,000 rows / ≤100 invoices per file (splits + toast when over), **no negative
  lines** (adjustments excluded — documented in toast: "adjustments excluded per QBO import
  rules; post them manually"), Tax Code blank (ABA tax-exempt default).
- **Sidebar note (rendered under form):** exact QBO import steps (Settings → Import data →
  Invoices → enable Custom transaction numbers → Add new customers) — so the export never
  lands in a dead end.
- **Acceptance:** fixture CSV matches Intuit column contract; row counts respect caps;
  numbering continues from Start; file recorded in Billed Files (format `qbo_csv`).

### 5.8 Verification Forms (`bil-verify`)
**Purpose:** coverage-verification + authorization documents.
- **Form (screenshot 8):** Payer* · Verification Format (**Parental Verification** (parent
  attestation of sessions/services) / **Benefit Verification Request** (coverage inquiry
  letter to payer) / **Prior Authorization Request**) · From Date* / To Date* · Client(s)* ·
  Appointment State (All Appointments / Completed / Scheduled) · Document Format (PDF) ·
  **Generate** · **Clear**.
- **Output:** branded PDF per client (letterhead, payer address from `payer.details`,
  client/member block, service table by DOS (code, units, hours), parent signature block for
  Parental Verification, auth fields (units requested, program) for Auth Request).
  Recorded in `state.verificationForms`; "Open log" lists history with re-download.
- **Acceptance:** all 3 formats generate valid multi-page PDFs for multi-client runs;
  payer letterhead uses stored contact data.

### 5.9 Provider Identifier (`bil-providers`)
**Purpose:** NPI/taxonomy/role credentialing per screenshot 9.
- **Tabs:** General (all) · Ticare ID (rows with `payerIds.ticare`) · Medicaid ID · BHPN ID ·
  Referring Provider (rows with `payerIds.referrers`).
- **Filters:** Office/Staff With NPI (Yes/No chip) · Show (Active/All) · Clear All Filters.
- **Table:** grouped rows — Office/Staff (avatar+name+credential; offices group multiple
  NPI rows) · NPI (link-styled, validated 10-digit + check-digit on save) · Taxonomy Code ·
  **Rendering Provider ☑** · **Billing Provider ☑** · **Service Facility ☑** (role matrix
  checkboxes per row) · right rail: degree/credential note or add-row (+) for grouped
  offices.
- **Actions:** inline edit (NPI, taxonomy, roles, payer ids per tab), Add row (office:
  new NPI row; staff: new staff link), Deactivate (active toggle — keeps history),
  "Use as default" per role (one default billing provider, one default facility — used by
  `resolveProviders` fallback).
- **Acceptance:** role changes immediately gate/fix "Pending" NPI rows in Billing Manager;
  invalid NPI (bad check digit) blocks save with hint; tabs filter correctly.

### 5.10 (cross-page) KPI band on Billing Manager
Existing 6 KPIs (staging $, drafts, awaiting payer, denied, paid, avg days to pay) **plus**
Total A/R and >90d $ (click → AR Manager). All KPIs remain clickable filters.

---

## 6. Core domain flows

### 6.1 Staging → assembly (existing, unchanged contract)
`stagedAppts` → `planClaims` → `assembleClaims` (store action `generateClaims`). Staging
gate unchanged (completed + billable + units/mileage + verification cleared).

### 6.2 Submission (v2)
1. `claimGate` v2 adds: **provider resolution** (rendering NPI present per line; billing
   provider + facility resolvable), **auth window** covers DOS (else amber warning — block
   only when `settings.billing.strictAuth`), **timely filing** (DOS + `ext.filingDeadlineDays`
   < today → hard block with appeal-only note).
2. Submit: `method` = `ch` (default; produces 837P-style CSV + CMS-1500 PDF artifact →
   Billed Files, status `sent`) | `paper` (CMS-1500 PDF only) | `selfpay` (invoice auto-
   generated via §5.6, Balance Only off). Status `submitted` → after user posts
   "accepted" (or 835 appears) → `processing` is optional manual step (button on claim).
3. Rejections: `reject` records CH-style error (code + reason); claim stays open at
   `rejected` with "Fix & re-submit" (back to draft, keeps lines).

### 6.3 Remittance processing (the money-in spine)
- **Manual / EOB** (Add Payment): per §5.4; applies `payPatch`-equivalent via
  `actions.postPayment(id, {amount, adj, patientResp, ref, date, kind, …})` (signature
  extended from v1; old calls remain valid — `patientResp` defaults 0).
- **ERA 835**: `parse835` (§7.5) → preview → post (batch = one undo). Denial lines (CARC
  non-PR) → `denyPatch` v2 with `code: 'carc:CO-197'` + `rarc` notes; PR-* → patientResp.
- **Closure math:** `due = charges − adj − payerPaid − secondaryPaid`; claim `paid` only at
  due = 0; `partially_paid` otherwise. Write-off = payment kind `writeoff` (adj or patient
  portion, note required).
- **Corrections:** void payment → reversal entry (`reversalOf`), claim reopens to
  `partially_paid`/`submitted` as math demands.

### 6.4 COB / secondary
Trigger (post-remittance): `primaryDue == 0 (payer portion) && charges > payerPaid + adj
&& client.secondary active on DOS` → `secondary.status = 'ready'` + toast
"Secondary claim ready — {client} ({secondary payer})".
Submit (§5.5) → secondary claim inherits lines + DX + provider refs; 837P CSV flags
`claimFreq=3` (correction/secondary), CMS-1500 box 18 = X, box 11B = secondary payer.
Secondary settlement via Payment Center (scope = secondary). Skip action
("Family declined secondary") → `skipped` + remaining → patient balance.

### 6.5 AR engine
`arOf(state, scope, asOf)`:
- open units = claims with due > 0 (insurance: not void; self-pay: invoices + open dues)
  + patient-resp credits from remits (PR-1/PR-2, PR-204) not yet paid as patient payments;
- buckets by days-open (submittedAt/invoice date): 0–30, 31–60, 61–90, 91–120, 121+;
- `lastPayment` = max payment date per client (any kind except writeoff);
- outputs feed AR Manager, KPI band, and `runReport(state,'ar', ctx)` for Reports.

### 6.6 Denials → appeals → rebills
- Denial records carry **CARC id** (`carc:CO-16` etc.) + RARC notes + payer remark text;
  fix hint from §7.3 table (auto) or free text.
- **Appeal**: from denied claim → Appeal modal (narrative, attach doc names, deadline
  auto = DOS + payer appeal window (default 180d)) → generates **Appeal Letter PDF**
  (org letterhead, claim #, DOS, CARC, narrative, enclosures list) + status `appeal`
  (keeps dues open, excluded from "pending" KPI, own KPI chip).
- **Rebill** (existing `rebillPatch`) unchanged + must re-pass gate v2.

### 6.7 Invoices / statements / QBO / verification
Builders in `src/lib/billingDocs.js` (new): `buildInvoices`, `buildQboCsv`,
`buildVerificationForm`, `buildAppealLetter`, `build835ErrorReport` — pure fns (state +
opts → {fileName, text/html}), rendered via exportKit (PDF/CSV). All record to their
collections; all listed in Billed Files with re-download.

---

## 7. Industry best-practice layer (embedded, referenced by page specs)

### 7.1 ABA CPT + credential matrix (drives code lists + validation)
| Code | Description | 15-min units | Rendered by | Billed under |
|---|---|---|---|---|
| 97151 | Behavior ID assessment | ✓ | BCBA | BCBA NPI |
| 97152 | Supervised behavior treatment | ✓ | BCBA (supervision) | BCBA NPI |
| 97153 | Adaptive behavior treatment by protocol (1:1 tech) | ✓ | RBT/BT | **supervising BCBA** (some payers: RBT NPI 24L) |
| 97154 | Group (2+ clients per tech) | ✓ | RBT/BT | supervising BCBA |
| 97155 | Protocol modification by BCBA | ✓ | BCBA | BCBA NPI |
| 97156 | Family guidance (BCBA-led) | ✓ | BCBA | BCBA NPI |
| 97157 | Family group guidance | ✓ | BCBA | BCBA NPI |
| 97158 | Group protocol modification | ✓ | BCBA | BCBA NPI |
| 0362T / 0373T | Category III (tech + BCBA modification) | ✓ | BT/BCBA | per code — **deleted 2027-01-01**; code list keeps w/ EOL warning |
Existing `BILL_CODES` (model.js) is remapped to this set (migration U2): legacy ids
(90837 etc.) kept only where a user's historical claims use them — new appts offer the
9715x set. Modifiers: **HO** (master's/BCBA), **HN** (bachelor's/BCaBA), **HP**
(doctoral), **HM** (RBT/tech), 25, 59, GN (telehealth) — auto-suggested from staff
credential on line edit; wrong-credential combos (RBT billing 97151/97155 without
supervision) → gate warning (top real-world ABA denial driver).
Supervision: 97153/97154 lines on a claim **require** a matching 97152 (supervision) line
on the same claim or an active supervision relationship — gate warning (payer-specific
strictness in `settings.billing.supervisionCheck`).

### 7.2 Taxonomy reference (Provider Identifier dropdown)
| Taxonomy | Use |
|---|---|
| `101YP00000X` | BCBA / behavior analyst (clinical) — default office billing |
| `101Y01000X` | Behavior analyst (non-clinical) |
| `363AP0207X` | Registered Behavior Technician (RBT) |
| `207Q00000X` | Psychologist (where BCBA-D is psychologist-credentialed) |
| `261QM0800X` | Physical therapist (referring) |
Plus free-text entry (payers vary) — stored, validated 10-char when not free-text.

### 7.3 Denial (CARC) catalogue — top ABA set, each with fix hint + typical action
| CARC | Meaning (ABA context) | Action in app |
|---|---|---|
| CO-16 | Missing info / submission error | Correct & resubmit (rebill) |
| CO-197 | No / expired authorization | Verify auth window → rebill or appeal w/ retro-auth |
| CO-15 | No prior auth required-miss | Same as CO-197 |
| CO-50 | Not deemed medically necessary | Appeal w/ treatment plan + data (Appeal letter) |
| CO-97 | Bundling (e.g. 97153+97155 same day) | Fix modifier sequencing (59) or split → rebill |
| CO-151 | MUE exceeded | Drop/adjust units → rebill remainder |
| CO-119 | Auth units reached | New auth → rebill remainder; else write off |
| CO-29 | Timely filing expired | Appeal w/ proof of timely submit, or write off |
| CO-109 | Not covered by this payer (secondary billed as primary) | Fix COB order → resubmit to correct payer |
| CO-204 / PR-204 | Not in benefit plan (incl. MBHO carve-out) | Eligibility review → re-route or write off (ABN check) |
| PR-1 / PR-2 | Deductible / coinsurance | **Not a denial** — routes to patient balance (AR) |
| CO-4 / CO-11 | Modifier / documentation mismatch | Fix modifier/supervision docs → rebill |
Denial rate benchmark chip: healthy ≤ 10% first-pass (label in KPI tooltip).

### 7.4 Timely filing & auth pipelines
- Every submitted claim computes `timelyDue`; Billing Manager shows amber "file in Nd"
  under the DOS when < 21 days; hard-block per §6.2.3.
- Client auth windows (existing `authStart/authEnd`) → **Auth watch**: claims with DOS in
  last 30d of auth, or auth expiring in 30d, surface on Billing Manager strip + notifications
  ("Renew {payer} auth for {client} — expires {date}").

### 7.5 835 parser contract (X12, minimal-but-correct subset)
Accept: `.835`/`.txt` X12 ERA. Parse: BHT (control), CLP (claim payment: claim no, DOS,
billed/pay amounts), CL1 (line: code, units, billed, allowed, **payer pay, pt pay, adj**),
CAS (CARC/RARC + amount), BPR/PRV (provider, for match context).
**Matching:** exact on claim `no` (CLP-1, incl. `-R2`/`-S1` suffixes) → line-level by
(code + DOS + units); fallback fuzzy on (code + DOS + amount) flagged "review".
Unmatched → parked + error-report CSV. Output: preview model (per §5.4) — never auto-posts
without user Post click.

### 7.6 QuickBooks export contract (locked)
- Columns exactly: `Invoice Number, Customer, Invoice Date, Due Date, Product/Service, Qty,
  Unit Price, Amount, Memo, Tax Code`.
- One CSV per generate run; split at ≤1,000 rows or ≤100 invoices (toast names both files).
- No negative rows; date format `MM/DD/YYYY` (QBO mapping step sets format anyway);
  `Customer` = client display name; `Product/Service` = service name (user adds items in
  QBO once); `Memo` = `DOS {date} · {code} × {units} · claim {no}`.
- In-app doc: QBO requires **Custom transaction numbers** ON to keep our invoice #s.

### 7.7 KPI definitions (KPI band, AR strip, Reports)
| KPI | Definition |
|---|---|
| Denial rate | denied / (paid + denied) in window (first-pass) |
| Clean claim rate | 1 − (denied + rejected) / submitted |
| Avg days to pay | mean(closedAt − submittedAt) over paid |
| DSO | total open AR ÷ (billed in last 90d ÷ 90) |
| Collections rate | paid in 90d ÷ (paid + open) |
| Write-off rate | writeoff $ ÷ billed (YTD) |

### 7.8 Audit & compliance posture
- Append-only `claim.history`; immutable payments (void+reversal); provider edits keep
  `active` history (deactivate, never delete); file artifacts re-downloadable from
  Billed Files (provenance).
- PHI stays in localStorage only; exported PDFs carry practice header + "Confidential —
  contains health information" footer; no network calls (documented).
- Every destructive-looking action (void, rebill, void payment) = confirm + undo (U).

---

## 8. Non-functional requirements
- **Performance:** 500+ claim lines in Billing Manager at 60fps virtualized rows or
  pagination (25/page, existing pattern); AR over 300 clients < 100ms (memoized pure fns).
- **Persistence:** localStorage budget — ledger capped: payments/invoices/billedFiles retain
  newest 5,000 records with age-based pruning + toast (documented); attachments stored as
  file *names/metadata* only (no base64 blobs — standing rule).
- **Design system:** existing tokens/panels/chips/modals/testids; reference screenshots set
  structure only.
- **A11y:** every control keyboard-reachable; grid rows open via Enter; modals focus-trapped
  (existing `cf-modal` stacking fix must not regress — z-index discipline per CSS rule).
- **i18n:** out of scope (English).
- **Tests:** vitest per new lib fn (parser, arOf, builders, gate v2, resolveProviders);
  component tests per page (render + one core flow); probes (Playwright) c40–c49 per chunk
  with hostile-state injection; 4-viewport sweep every chunk; full suite + build + share
  artifact per chunk (standing gate).

## 9. Delivery phases
See `docs/specs/billing-dependencies-spec.md` §6 — chunks 40–49, each: tests green → probe
→ build → share → version-named zip + push block (standing rule).
