# Billing and claims

_Sources: src/lib/claims.js, src/lib/cms1500.js, src/lib/providerIds.js, src/lib/billingDocs.js, src/components/BillingView.jsx, src/components/BilledFilesView.jsx, src/components/AppealsView.jsx, src/components/ProviderIdView.jsx, src/components/PayerDetail.jsx, src/components/settings/SystemPanel.jsx, src/state/store.jsx, src/lib/master.js_
_Last synced with main at b9955db on 2026-10-05 (plus inbox messages)._

This page covers the claim lifecycle up to the point a payer's money arrives: staging, assembly, submission gates, denial, rebill, void, the CMS-1500 PDF, billed files, appeals, provider IDs and per-payer payment terms. Payments, ERAs and secondary filings are in [era-and-payments](era-and-payments.md). Aging and statements are in [accounts-receivable](accounts-receivable.md).

Nothing in this module reaches a payer. "Submit" changes a claim's status in this browser. The CMS-1500 is a PDF you print. The billed file is a text file you download.

## User guide

### Where to find it

The Billing nav item opens the desk (`Billing`). Its sub-items, in order, are AR Manager, Payment Center, Generate Invoice, Verification Forms, QuickBooks, Secondary Queue, Appeals, Billed Files and Provider Identifier. This page covers the desk, Appeals, Billed Files and Provider Identifier.

### The desk and its tabs

The desk has a range picker, a payer filter, KPI cards (In Staging, Drafts, Awaiting Payer, Denied, Paid for the range) and five tabs.

| Tab | What it shows |
|---|---|
| Staging | Sessions that are ready to bill and not yet on a claim |
| Claim Desk | Every claim, with a status filter, search and sort (date, dollars, aging); the selected claim opens as a form |
| Secondary | Claims eligible for a secondary (COB) draft; the work itself is in the Secondary Queue |
| Blocked | Sessions that cannot be staged yet, with the reason and a link to the appointment |
| Setup | Practice identity printed on forms, rate and numbering policy, and the claim gates |

### Workflow: from sessions to a submitted claim

1. **Staging.** A session appears when its type is billable, its status is one the practice marked billable (Settings), it has billable units or mileage, and it is not already on a claim. If "Require session verification" is on, the session must be verified. If strict authorization is on, the date of service must fall inside the client's authorization window.
2. **Assemble.** Select lines (or none for all) and press "Assemble". The Staging tab also has "Export" (a staging CSV), and the Claim Desk has "Ledger" (a claims CSV). One draft claim is created per client per date-of-service month, and a payer's "Separate Claim By" rule can split that month further (see "Line modifiers, same-day merge and claim splitting"). Self-pay clients get one invoice-style claim instead, and an invoice record is created in the same step. Each line carries its units (counted under the payer's unit rule) and its modifiers. The toast ends "press U to dissolve", and U (or the toast's Undo) removes the whole assembly in one step.
3. **Review the gates.** Each draft is checked before it can be submitted. A line that fails shows a stop-level reason on the form. The checks are:
   - the source appointment still exists and is not already billed outside a claim
   - billable units are present
   - the session is verified (when required)
   - timely filing has not passed (`timelyDue`)
   - the authorization window covers the date (when strict authorization is on)
   - an RBT-only session has a BCBA present (when the supervision check is on)
   - the payer's provider-ID rule is satisfied for every rendering staff member (only once the payer has chosen a rule)
4. **Submit.** Submit on one claim, "Submit N ready" (all gate-clean drafts), or "Process". A gated claim is held and the toast says how many were held. Process also records a billed file (see below). Submitting sets the claim to Submitted and stamps the sessions as claimed. It does not contact anyone.
5. **Record the outcome.** From a Submitted claim you can post a payment, record a denial, or void. See [era-and-payments](era-and-payments.md) for payments.

### Statuses

| Status | Meaning |
|---|---|
| Draft | Assembled, not yet submitted |
| Submitted | Marked submitted locally and awaiting a payer outcome |
| Partially paid | A payment left a balance; a secondary draft or patient receipt may follow |
| Paid | Balance reached zero |
| Denied | A denial was recorded |
| Void | Voided; its lines went back to staging |

An eighth value, `appealed`, can appear after "File Appeal"; see "Not yet built".

### Denial, rebill, void, write-off

- **Record denial.** Only a Submitted claim with no pending secondary change. Choose a reason from the practice's denial reason list, kept in Settings, System, Billing Settings (the defaults are not eligible or no auth, documentation requested, coding error, duplicate line, timely filing). Each reason carries a next step, which the toast shows and the claim keeps.
- **Rebill.** Only a Denied primary claim with no secondary link. Tick disputed lines to send them back to staging, then Rebill. The original is voided and a new draft `<no>-R<n>` is created. At least one line must be kept; to drop everything, use Void.
- **Void.** A Draft or Submitted primary claim with no secondary link. All lines go back to staging.
- **Drop a line.** A Draft primary claim only. The last line removed dissolves the claim. A merged same-day line goes back whole: every session it covers returns to staging.
- **Write off.** On a Denied claim, Write off posts an adjustment of the open balance as a documented write-off. It is refused if patient receipts are already allocated.
- **Notes.** A billing note on the claim is saved with a history entry.
- **Edit protection.** Claim fields that hold money (charges, paid, adjustments, secondary and patient paid, remittance) cannot be edited by a generic update. They only change through the payment, ERA and COB workflows.

### Line modifiers, same-day merge and claim splitting

These come from the payer's Billing Rules (Masters, Payer, Billing Rules, Claims Settings and Place of Service Modifiers). Self-pay invoices carry no modifiers and are never merged.

- **Modifiers (box 24D).** Each line gets up to four, in this order, with duplicates removed: the payer's own modifier for the service (Payer, Services), then the rendering provider's credential modifier (HO for a BCBA, HN for a BCaBA, HM for an RBT, HP for a psychologist), then the payer's place-of-service modifier for the session. The credential modifier is the Medicaid norm and is on unless the payer turns off "Add the rendering provider's credential modifier to each line".
- **Place of service.** A session's POS code comes from its location text: home 12, school 03, telehealth 10, community 99, anything else office 11 (`posFor`).
- **Merge same day.** On by default per payer (the Medicaid norm). Sessions on the same date with the same code, modifiers, rendering provider, rate and unit rule become one line. Their minutes are added up and rounded once under the unit rule, so two 37-minute sessions bill 5 units rather than 2 + 2. The line's description says how many sessions it covers, and the claim history notes how many sessions became how many lines. Turn the setting off and each session keeps its own line.
- **Separate Claim By.** A payer setting that splits one client-month into several claims, by Rendering Provider (or Service Provider) or by Place of Service. Supervising Provider is offered in the list but does nothing, because sessions do not record a supervisor.
- **Units.** Billed units use the same rule chain as the authorization ledger: the payer's service override, the payer's own service, the service master, then the code default. The ABA codes, 0362T, 0373T and H2019 default to 15-minute units under the midpoint rule (8 minutes or more makes a unit); 253MT stays at 30 minutes. A billing code picked by hand that differs from the service's own code uses the code default instead of the service's rule.

### CMS-1500 PDF

"CMS-1500" on a primary claim downloads a PDF (`<claim no>-1500.pdf`); "1500 Batch" puts many claims on one PDF. A secondary (COB) claim is refused with a caution because its details are not mapped to a compliant form. The PDF is a printable companion. Several boxes now read the payer and client records:

- Box 1 (program) from the payer's CMS type, with the older name guess only when none is set.
- Boxes 7a (group number) and 10 (plan ID) from the payer's group and plan identifiers. A blank value prints as a dash, never an invented one.
- Box 6 prints YES when the client has a secondary payer, otherwise NO.
- Box 32 follows the payer's box 32 rule. The default leaves it blank because the practice is also the billing provider.
- Boxes 32 and 33 print a dash in place of the practice NPI, never a made-up number, when none is on file.
- Box 24D prints the line's modifiers.

Some boxes are still derived placeholders rather than stored data; see "Not yet built".

### Billed files

Billed Files lists the files recorded by Process, with range, format and status filters and a search. Each file is named like `837P-<date>-<nnn>.txt`.

- The content is a pipe-delimited text summary of `claim no | payer | charges`. It is not an X12 837P and no payer or clearinghouse can read it as one.
- Download gives you the stored content. Resend increments the send count and downloads the file again. Neither action transmits anything.
- Files from older workspaces that stored artifacts on the claim are also listed. A file with no stored content is shown with a disabled download. The app never rebuilds an old artifact from today's data.
- The status column reads "sent" because that is the stored value. It means "recorded", not "received by a payer".

### Appeals

Appeals lists denied claims and claims that have an appeal. Pick a claim, choose a template (medical necessity, authorization not found, timely filing), add a note and press File Appeal. The template is draft wording for you to reuse; the app does not send it. Mark Won and Mark Lost record the outcome locally. Mark Won sets the claim to Paid without posting any money; see "Not yet built".

### Provider Identifier

The provider master (settings providers) holds each rendering provider's NPI, taxonomy, license, role and any Medicaid ID. Add or edit needs a name and an NPI. The KPI strip counts providers missing an NPI.

Which identifier a payer bills with is a payer setting: Masters, Payer, Billing Rules, Provider IDs. The choices are NPI only, Medicaid ID only, or both. The default is NPI only, and the claim gate only enforces the rule once the payer has chosen one explicitly. The rule also controls the CMS-1500 boxes for the rendering provider.

### Payer payment terms

Masters, Payer, Billing Rules, Payment Terms sets, per payer: kind (commercial, Medicaid, other government, self-pay), expected days to pay, estimated payer share, copay per line and filing deadline in days (blank means the practice default). Saving is validated: days must be a whole number from 1 to 365, share 0 to 100 with at most two decimals, copay 0 to 10,000 with at most two decimals, filing 1 to 999. These terms drive:

- the "late" flag on Submitted claims (older than 1.6 times the expected days)
- copay estimates and the quick-post presets in the payment dialog
- the timely-filing date on new claims and on secondary drafts
- CMS-1500 box 7b

Filing days resolve in one order everywhere: the payer record, then the practice default (Setup tab), then the payer kind's built-in default.

## How it works

### Modules

- [`claims.js`](../../src/lib/claims.js) is the pure lifecycle engine. Staging and assembly: `stagedAppts`, `planClaims`, `lineFor`, `nextClaimSeq`, `claimNoAt`, `assembleClaims`, plus `posFor`, `lineModifiers`, `mergeSameDayLines` and `lineApptIds`. Gate: `claimGate`. Transitions return patches: `submitPatch`, `denyPatch`, `releasePatch`, `dropLinePatch`, `rebillPatch`. Money helpers and aging live here too and are documented in [accounts-receivable](accounts-receivable.md) and [era-and-payments](era-and-payments.md). Provider helpers: `npiCheck`, `validNpi`, `resolveProviders`, `credentialIssue`. Payer terms: `payerPolicy`, `filingDaysOf`, `PAYER_KINDS`, `planPayerTerms`. Exports: `claimCsv`, `claimsCsv`.
- [`cms1500.js`](../../src/lib/cms1500.js): `cms1500Data` is a pure field mapping, `claimTo1500` and `claimsTo1500` draw the PDF with jsPDF. Six service rows per page (`LINES_PER_PAGE`). `posFor` is re-exported from `claims.js`.
- [`providerIds.js`](../../src/lib/providerIds.js): `providerIdRule`, `providerFor`, `providerIdsFor`, `providerIdIssues`, `PROVIDER_ID_RULES`. It reads the rule from `payer.rules.providerId`.
- [`billingDocs.js`](../../src/lib/billingDocs.js): `buildInvoices`, `buildQboCsv`, `buildVerificationForm`, `buildAppealLetter`, `build835ErrorReport`. These are pure builders that return file name and content. Only `build835ErrorReport` is called from a screen (the Payment Center); the other four are imported only by tests, so no screen calls them today.
- Screens: [`BillingView.jsx`](../../src/components/BillingView.jsx), [`BilledFilesView.jsx`](../../src/components/BilledFilesView.jsx), [`AppealsView.jsx`](../../src/components/AppealsView.jsx), [`ProviderIdView.jsx`](../../src/components/ProviderIdView.jsx). Payment Terms is a tab inside [`PayerDetail.jsx`](../../src/components/PayerDetail.jsx).

### Action path

Claim lifecycle transitions do not use the plan/Tx pair. Each `createActions` method in [`store.jsx`](../../src/state/store.jsx) builds a patch with the pure functions above and dispatches one `claimsTx` action. `claimsTx` applies appointment patches, claim upserts and deletes, and any ledger collections in one reducer step and takes one Undo snapshot with `pushSnap`. The actions are `generateClaims`, `submitClaims`, `denyClaim`, `rebillClaim`, `voidClaim`, `dropClaimLine`, `addClaimNote`, `fileAppeal` and `updateClaim`.

- `generateClaims` also writes self-pay invoices and advances `settings.billing.invoiceSeq` inside the same `claimsTx`.
- `submitClaims(ids, { recordFile })` runs `claimGate` per claim in the action, then dispatches submitted claims plus an optional `billedFiles` entry as one transaction. The reducer does not re-run the gate.
- Money-moving writes (payments, voids, recoupments, ERAs, secondary filings) do use `plan*` then `*Tx`; see [era-and-payments](era-and-payments.md).
- Payment terms use `setPayerTerms`, which calls `planPayerTerms`, then dispatches `payer` with mode `terms`. The reducer re-plans and snapshots only `payers`.
- Every dispatch passes `authorizeAction`. All claim actions fall under the billing area; payer edits fall under masters.

### State fields

- `claims` (map): `no`, `status`, `mode` (insurance or selfpay), `method` (null, `ch`, `selfpay`, `secondary`), `lines[]` (a line has `apptId`; a merged same-day line also has `apptIds`, so always read a line's sessions through `lineApptIds(l)`, never `l.apptId` alone), `charges`, `paid`, `adj`, `timelyDue`, `version`, `parentNo`, `history[]`, `appeal`, `denial`.
- `billedFiles` (map): `fileName`, `format` (`837p`), `status`, `billedThrough`, `claimIds`, `content`, `sendCount`.
- `invoices` (map) and `settings.billing` (`claimPrefix`, `invoicePrefix`, `invoiceSeq`, `requireVerification`, `strictAuth`, `supervisionCheck`, `defaultFilingDays`).
- `settings.providers` (provider master) and `payers[].policy`, `payers[].ext.filingDeadlineDays`, `payers[].rules.providerId`, `payers[].rules.claims` (`separateBy`, `box32`, `flags.mergeSameDay`, `flags.credentialMods`) and `payers[].rules.posMods`.

Claim numbers are `<prefix>-<YYYYMM>-<nnn>`; rebills append `-R<n>`; secondary drafts append `-S<n>`.

### Migrations

`normalizeBillingV2` and `normalizeBillingIds` in [`master.js`](../../src/lib/master.js) run on load, and `normalizeUnitNorms` in `authUnits.js` runs once (`meta.unitNorm15`) to move untouched 30-minute defaults to 15 minutes; it never changes claims. `normalizeBillingV2` uses `claimV2Defaults` to backfill `method`, `timelyDue`, `secondary` and `lines[].provider`, creates the ledger collections and seeds the provider master. Both are idempotent. The order in `normalizeWorkspace` is documented in [architecture](architecture.md).

### Tests

[`claims.test.js`](../../src/__tests__/claims.test.js), [`claimModifiers.test.jsx`](../../src/__tests__/claimModifiers.test.jsx), [`unitNorms.test.js`](../../src/__tests__/unitNorms.test.js), [`cms1500.test.js`](../../src/__tests__/cms1500.test.js), [`providerIds.test.js`](../../src/__tests__/providerIds.test.js), [`billingDocs.test.js`](../../src/__tests__/billingDocs.test.js), [`billingV2.test.jsx`](../../src/__tests__/billingV2.test.jsx), [`billingIds.test.jsx`](../../src/__tests__/billingIds.test.jsx), [`billingTransactions.test.jsx`](../../src/__tests__/billingTransactions.test.jsx), [`billedFilesFlow.test.jsx`](../../src/__tests__/billedFilesFlow.test.jsx), [`payerTerms.test.jsx`](../../src/__tests__/payerTerms.test.jsx), [`payers.test.jsx`](../../src/__tests__/payers.test.jsx).

## Not yet built

- No transmission of any kind: no 837P X12, no clearinghouse, no payer portal, no eligibility check. The "837P" billed file is a pipe-delimited summary.
- Wording gap: the claim history entry reads "Claim submitted to <payer>", toasts say "submitted", and the billed file status reads "sent". All of these mean a local status change.
- The CMS-1500 PDF still fills some boxes with derived values.
  - **Member ID and authorization number:** box 1a (`memberIdOf`) and boxes 11, 17 and 23 (`authNoOf`) print the client chart's own member ID and authorization number. Intake conversion carries them, or you enter them under Clients > Edit. A secondary filing prints the secondary coverage's values. A hash-derived demo placeholder is printed only when the chart has none.
  - **Other derived values:** the diagnosis comes from the client's program (`dxFor`); the patient account number (box 26) and box 29 are built from the client id; and the rendering NPI falls back to a derived `npiOf` value when the provider has none. Box 17 waits on referring-provider data. The PDF's own note line still says "e-file via ANSI 837P", which the app does not do.
- Modifiers: Qualification Modifiers keyed by education level cannot be derived per staff, so only the service, credential and place-of-service modifiers are applied. Saved payer place-of-service rows keyed `06` (the old home code) need re-picking as `12`.
- "Separate Claim By: Supervising Provider" has no effect because sessions record no supervisor. A merged line takes the first listed staff member of its sessions as the rendering provider.
- The unit migration scales a pool per code, not per payer, so a client whose payer sets its own unit size for that code keeps a pool in the wrong unit; fix it in Clients, Edit.
- Appeals: `fileAppeal` sets the claim status to `appealed`, which is not in `CLAIM_STATUSES`, is not counted by the desk KPIs, and cannot receive a payment (posting needs Submitted or Partially paid). Mark Won sets Paid without posting money, so the balance can stay open in A/R. Appeal templates are text only.
- No auto-void or auto-rebill, no claim-level attachments.
- Stored payer fields that nothing reads yet are listed in the configurable-billing spec.
