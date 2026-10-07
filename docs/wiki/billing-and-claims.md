# Billing and claims

_Sources: src/lib/claims.js, src/lib/cms1500.js, src/lib/providerIds.js, src/lib/billingDocs.js, src/components/BillingView.jsx, src/components/BilledFilesView.jsx, src/components/AppealsView.jsx, src/components/ProviderIdView.jsx, src/components/PayerDetail.jsx, src/components/settings/SystemPanel.jsx, src/state/store.jsx, src/lib/master.js_
_Last synced against main 8a352cc plus the cancellation-notice branch on 2026-10-06; unrelated behavior unchanged._

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
| Setup | Practice identity printed on forms, rate and numbering policy (including the **late-cancel notice** hours the risk model and overbooking backtest both read), and the claim gates |

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

Filing an appeal does not add a status: the claim keeps Denied and records an `appeal` marker, so it still counts in the desk KPIs, denial rate and A/R. A won appeal returns the claim to Submitted awaiting the payer's payment.

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

- **Modifiers (box 24D).** Each line gets up to four, in this order, with duplicates removed: the payer's own modifier for the service (Payer, Services), then the rendering provider's credential modifier (HO for a BCBA, HN for a BCaBA, HM for an RBT, HP for a psychologist), then the payer's **Qualification Modifiers** pair, then the payer's place-of-service modifier for the session. The credential modifier is the Medicaid norm and is on unless the payer turns off "Add the rendering provider's credential modifier to each line"; it is separate from the qualification rows, which are the payer's own and apply even when the credential checkbox is off. The qualification pair comes from the first row whose level matches the rendering provider's **education level** on the staff record — or a "·" part of their role or credential, which is how a Teacher, Therapist or Specialist row matches a job title. A row with a blank modifier adds nothing, and a rendering provider with no education level recorded gets no qualification modifier (the payer panel reports how many staff that is).
- **Place of service.** A session's POS code comes from its location text: home 12, school 03, telehealth 10, community 99, anything else office 11 (`posFor`).
- **Merge same day.** On by default per payer (the Medicaid norm). Sessions on the same date with the same code, modifiers, rendering provider, rate and unit rule become one line. Their minutes are added up and rounded once under the unit rule, so two 37-minute sessions bill 5 units rather than 2 + 2. The line's description says how many sessions it covers, and the claim history notes how many sessions became how many lines. Turn the setting off and each session keeps its own line.
- **Separate Claim By.** A payer setting that splits one client-month into several claims, by Rendering Provider (or Service Provider — both split by the session's clinician, since a session records one provider) or by Place of Service. "Supervising Provider" is not offered, because sessions do not record a supervisor.
- **Units.** Billed units use the same rule chain as the authorization ledger: the payer's service override, the payer's own service, the service master, then the code default. The ABA codes, 0362T, 0373T and H2019 default to 15-minute units under the midpoint rule (8 minutes or more makes a unit); 253MT stays at 30 minutes. A billing code picked by hand that differs from the service's own code uses the code default instead of the service's rule.

### CMS-1500 PDF

The form follows the NUCC 1500 Claim Form Reference Instruction Manual (v13.0, 07/25) for what goes in each item, and the CMS print grid (Pub 100-04 ch. 26 §30) for where it goes. The 02/12 form is laid out for 10-pitch pica type: 10 characters per inch across, 6 lines per inch down. Every value prints in black Courier at 10 pt on that grid, so it lands inside the boxes of a genuine form.

Two downloads, on a claim and for the claims in view:

- **CMS-1500** / **1500 Batch**: a review copy. It is the red form drawn from the CMS 02/12 geometry with the data on it, marked "REVIEW COPY - NOT FOR OCR SUBMISSION". Payers that scan paper claims accept only originals printed in Flint J-6983 red dropout ink and return photocopies and black-and-white prints, so a laser-printed replica is for checking and filing, or for a payer that takes images.
- **Red form print** / **Batch · red forms**: the data only (`<claim no>-1500-red-form.pdf`). Load genuine red CMS-1500 (02/12) forms in the printer and print at actual size (100%). This is the paper claim.

A secondary (COB) claim is refused with a caution because its service lines are not allocated for a compliant secondary claim. If a PDF cannot be built, a caution names the error and no success message shows.

What prints, item by item (NUCC formats: uppercase, no punctuation, no `$` or decimal point, dates in their `MM DD YY` sub-fields):

- **Carrier block:** the payer's name and mailing address from the payer master.
- **1 / 1a:** the program box from the payer's CMS type; the member ID with no hyphens or spaces.
- **2-7:** patient and insured names as `LAST, FIRST, M` (accents folded, e.g. BERGSTROM); birth date `MM DD YYYY` and sex; the patient's home address from the client chart (Clients > Edit > Home address, or carried from intake); ZIP without the hyphen. A client with a guardian is insured under the guardian's policy: item 4 is the guardian, item 6 is Child, item 7 repeats the home address.
- **9 / 9a / 9d and 11d:** filled only when the client has secondary coverage (11d YES): the other plan's insured, policy number and plan name.
- **10a-c:** NO. **11 / 11c:** the payer's group number and plan name.
- **12 / 13 / 31:** SIGNATURE ON FILE; item 31 also carries the date.
- **21:** ICD indicator 0 and up to 12 ICD-10-CM codes without the decimal point (F84.0 prints as F840). Every service line points at A, the primary diagnosis.
- **22:** a replacement claim prints frequency code 7 and the original reference number.
- **23:** the prior authorization number, no hyphens or spaces.
- **24, six lines a page:** dates of service, place of service, CPT/HCPCS and up to four modifiers in their own slots, pointer, charges split into dollars and cents, units, and the rendering provider. 24J carries the rendering NPI and the shaded 24I/24J the qualifier G2 plus the Medicaid ID, as the payer's provider-ID rule asks. Both are left blank when they match the billing provider (NUCC). Qualifier 1D no longer exists on the 02/12 form.
- **25-30:** tax ID with EIN marked, the patient account number, accept assignment YES, total charge, and in 29 what the patient or other payers paid. A claim's own payer payment never goes in 29. Item 30 is reserved and stays blank.
- **32:** follows the payer's box 32 rule; the default leaves it blank because the practice is also the billing provider.
- **33 / 33a / 33b:** the billing provider's name, street and `CITY ST ZIP`, the phone in the parentheses, its NPI, and G2 plus its Medicaid ID under a Medicaid ID rule.
- **More than six lines:** each page repeats the claim data and prints `PAGE 1 OF 2` on line 8; the total charge prints on the last page only, so the pages read as one claim.

### Billed files

Billed Files lists the files recorded by Process, with range, format and status filters and a search. Each file is named like `837P-<date>-<nnn>.txt`.

- The content is a pipe-delimited text summary of `claim no | payer | charges`. It is not an X12 837P and no payer or clearinghouse can read it as one.
- Download gives you the stored content. Resend increments the send count and downloads the file again. Neither action transmits anything.
- Files from older workspaces that stored artifacts on the claim are also listed. A file with no stored content is shown with a disabled download. The app never rebuilds an old artifact from today's data.
- The status column reads "Exported" (the stored value is still `sent`). It means the file was recorded and saved in this browser, not received by a payer. The 837P count says "Summary, not X12".

### Appeals

Appeals lists denied claims and claims that have an appeal. Pick a claim, choose a template (medical necessity, authorization not found, timely filing), add a note and press File Appeal. The template is draft wording for you to reuse; the app does not send it. Filing keeps the claim in its own status — a denial stays Denied and stays in A/R — and marks it with the appeal. Mark Won records the outcome and returns the claim to Submitted, awaiting the payer's payment: post the money when it arrives. Mark Lost leaves the claim Denied. Neither outcome posts money, and both are local record-keeping; see "Not yet built".

### Provider Identifier

The provider master (settings providers) holds each rendering provider's NPI, taxonomy, license, role and any Medicaid ID. Add or edit needs a name and an NPI. The KPI strip counts providers missing an NPI.

Which identifier a payer bills with is a payer setting: Masters, Payer, Billing Rules, Provider IDs. The choices are NPI only, Medicaid ID only, or both. The default is NPI only, and the claim gate only enforces the rule once the payer has chosen one explicitly. The rule also controls the CMS-1500 boxes for the rendering provider.

### Payer payment terms

Masters, Payer, Billing Rules, Payment Terms sets, per payer: kind (commercial, Medicaid, other government, self-pay), expected days to pay, estimated payer share, copay per line and filing deadline in days (blank means the practice default). Saving is validated: days must be a whole number from 1 to 365, share 0 to 100 with at most two decimals, copay 0 to 10,000 with at most two decimals, filing 1 to 999. These terms drive:

- the "late" flag on Submitted claims (older than 1.6 times the expected days)
- copay estimates and the quick-post presets in the payment dialog
- the timely-filing date on new claims and on secondary drafts

Filing days resolve in one order everywhere: the payer record, then the practice default (Setup tab), then the payer kind's built-in default.

## How it works

### Modules

- [`claims.js`](../../src/lib/claims.js) is the pure lifecycle engine. Staging and assembly: `stagedAppts`, `planClaims`, `lineFor`, `nextClaimSeq`, `claimNoAt`, `assembleClaims`, plus `posFor`, `lineModifiers`, `mergeSameDayLines` and `lineApptIds`. Gate: `claimGate`. Transitions return patches: `submitPatch`, `denyPatch`, `releasePatch`, `dropLinePatch`, `rebillPatch`. Money helpers and aging live here too and are documented in [accounts-receivable](accounts-receivable.md) and [era-and-payments](era-and-payments.md). Provider helpers: `npiCheck`, `validNpi`, `resolveProviders`, `credentialIssue`. Payer terms: `payerPolicy`, `filingDaysOf`, `PAYER_KINDS`, `planPayerTerms`. Exports: `claimCsv`, `claimsCsv`.
- [`cms1500.js`](../../src/lib/cms1500.js): three layers. `cms1500Data` returns the NUCC item values (`items`, keyed by item number) and the service lines in pages of six (`LINES_PER_PAGE`). `layout1500` turns them into `{ line, col, text }` placements on the pica grid (`colX`, `lineY`). `claimTo1500` / `claimsTo1500` draw the PDF with jsPDF, with `{ mode: 'copy' | 'data' }`. The NUCC format helpers (`nameLFM`, `plain`, `compact`, `moneyParts`, `splitAddress`) are exported for tests. `posFor` is re-exported from `claims.js`.
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

- `claims` (map): `no`, `status`, `mode` (insurance or selfpay), `method` (null, `ch`, `selfpay`, `secondary`), `lines[]` (a line has `apptId`; a merged same-day line also has `apptIds`, so always read a line's sessions through `lineApptIds(l)`, never `l.apptId` alone), `charges`, `paid`, `adj`, `timelyDue`, `version`, `parentNo`, `history[]`, `appeal` (filed date, template, note, outcome), `denial`.
- `billedFiles` (map): `fileName`, `format` (`837p`), `status`, `billedThrough`, `claimIds`, `content`, `sendCount`.
- `invoices` (map) and `settings.billing` (`claimPrefix`, `invoicePrefix`, `invoiceSeq`, `requireVerification`, `strictAuth`, `supervisionCheck`, `defaultFilingDays`).
- `settings.providers` (provider master) and `payers[].policy`, `payers[].ext.filingDeadlineDays`, `payers[].rules.providerId`, `payers[].rules.claims` (`separateBy`, `box32`, `flags.mergeSameDay`, `flags.credentialMods`), `payers[].rules.qualMods` (`{qual, m1, m2}` keyed by education level or a role/title part) and `payers[].rules.posMods`. Staff rows carry the optional `education` this reads.

Claim numbers are `<prefix>-<YYYYMM>-<nnn>`; rebills append `-R<n>`; secondary drafts append `-S<n>`.

### Migrations

`normalizeBillingV2` and `normalizeBillingIds` in [`master.js`](../../src/lib/master.js) run on load, and `normalizeUnitNorms` in `authUnits.js` runs once (`meta.unitNorm15`) to move untouched 30-minute defaults to 15 minutes; it never changes claims. `normalizeBillingV2` uses `claimV2Defaults` to backfill `method`, `timelyDue`, `secondary` and `lines[].provider`, creates the ledger collections and seeds the provider master. Both are idempotent. The order in `normalizeWorkspace` is documented in [architecture](architecture.md).

### Tests

[`claims.test.js`](../../src/__tests__/claims.test.js), [`claimModifiers.test.jsx`](../../src/__tests__/claimModifiers.test.jsx), [`qualificationModifiers.test.js`](../../src/__tests__/qualificationModifiers.test.js), [`unitNorms.test.js`](../../src/__tests__/unitNorms.test.js), [`cms1500.test.js`](../../src/__tests__/cms1500.test.js), [`providerIds.test.js`](../../src/__tests__/providerIds.test.js), [`billingDocs.test.js`](../../src/__tests__/billingDocs.test.js), [`billingV2.test.jsx`](../../src/__tests__/billingV2.test.jsx), [`billingIds.test.jsx`](../../src/__tests__/billingIds.test.jsx), [`billingTransactions.test.jsx`](../../src/__tests__/billingTransactions.test.jsx), [`billedFilesFlow.test.jsx`](../../src/__tests__/billedFilesFlow.test.jsx), [`payerTerms.test.jsx`](../../src/__tests__/payerTerms.test.jsx), [`payers.test.jsx`](../../src/__tests__/payers.test.jsx).

## Not yet built

- No transmission of any kind: no 837P X12, no clearinghouse, no payer portal, no eligibility check. The "837P" billed file is a pipe-delimited summary.
- The CMS-1500 still has derived or missing values.
  - **Member ID and authorization number:** item 1a (`memberIdOf`) and item 23 (`authNoOf`) print the client chart's own values. Intake conversion carries them, or you enter them under Clients > Edit. A hash-derived demo placeholder prints only when the chart has none.
  - **Diagnosis** comes from the client's program (`dxFor`), not a clinical record. **Item 26** is the client id. Items 12, 13 and 31 assume signatures are on file. Item 17 (referring or supervising provider) is blank: there is no referring-provider data, and sessions record no supervisor. Item 22's original reference is the prior claim number, because the payer's claim control number from an ERA is not stored on the claim.
  - **No print calibration:** the red-form print has no X/Y offset setting yet; a printer that shifts the page needs its own margin adjustment.
  - **Per-payer page rules:** the total always prints on the last page; a payer that wants each page totalled on its own (or no more than six lines per claim) is not configurable yet.
- Modifiers: a rendering provider whose staff record has no education level recorded gets no qualification modifier from the payer's Qualification Modifiers rows — the panel in Payer > Billing Rules says how many staff that is. Saved payer place-of-service rows keyed `06` (the old home code) need re-picking as `12`; default qualification rows are the education code alone, so a saved workspace keeps whatever rows it had.
- "Separate Claim By: Supervising Provider" is not offered because sessions record no supervisor. A merged line takes the first listed staff member of its sessions as the rendering provider.
- The unit migration scales a pool per code, not per payer, so a client whose payer sets its own unit size for that code keeps a pool in the wrong unit; fix it in Clients, Edit.
- Appeals never transmit and never move money: templates are text only, a win re-opens the claim for the payer's payment rather than inventing one, and nothing re-submits automatically. `fileAppeal` keeps the claim's own status (it writes an `appeal` marker, not a status) and a saved workspace that still holds the retired `appealed` status is healed on load (`normalizeAppealedClaims`).
- No auto-void or auto-rebill, no claim-level attachments.
- Stored payer fields that nothing reads yet are listed in the configurable-billing spec.
