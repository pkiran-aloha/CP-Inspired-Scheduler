# ERA and payments

_Sources: src/lib/era.js, src/lib/eraPosting.js, src/lib/paymentLedger.js, src/lib/secondaryLedger.js, src/lib/claims.js, src/lib/billingDocs.js, src/components/PaymentCenterView.jsx, src/components/SecondaryBillingView.jsx, src/state/store.jsx, src/__tests__/fixtures/835-full.txt_
_Last synced against main 73e0236 plus the perf/lazy-views, fix/workspace-persistence, fix/billingdocs-wiring, fix/cms1500-derived-values and feat/local-screen-lock branches on 2026-10-08; feat/dashboard-landing on 2026-10-08 (Dashboard is the landing page, section keys renumbered); unrelated behavior unchanged; fix/billing-icons on 2026-10-08 (distinct stat-tile glyphs on Payment Center and Secondary Queue)._

This page covers how money gets onto claims in this browser: the Payment Center, 835 ERA import, manual remittances, voids, recoupments, patient receipts, and secondary (COB) filings. Claim lifecycle is in [billing-and-claims](billing-and-claims.md); aging and statements are in [accounts-receivable](accounts-receivable.md).

Nothing here moves real money or contacts a payer. An ERA file is read in the browser and never uploaded. A "payment" is a ledger entry you record. A secondary "filing" is a record that you filed it elsewhere.

## User guide

### The Payment Center

Open Billing, Payment Center. The header has "+ Manual Payment", "+ Patient receipt", "+ Recoupment", a "Patient audit CSV" export, "Upload ERA (835)", a range picker and a search box. Its stat tiles (Total, Check, EFT / ERA, Unapplied receipts, Patient cash, Recouped) and the Secondary Queue tiles each carry a glyph for their own metric, such as a cheque for Check and a return arrow for Recouped.

- **Payments tab.** KPI chips: Total, Check, EFT / ERA, Unapplied receipts (not limited by the range), Patient cash and Recouped. Filters: All, Patient, Check, EFT, ERA, Cash, Recoupments. Columns: date, client, payer, amount (negative in red), method, reference or note, and claim ("Unapplied" if none). The first 100 rows show.
- **ERAs tab.** One row per import: file, date, trace number, counts and status (posted, partial, parked, legacy). Open one to review each line.
- **Online payment link.** If the practice saved a payment link (Settings > Clinical Integrations > Online payment link), statements print it. The app never reads Stripe or any processor, so a family's online payment is recorded by hand: "+ Patient receipt", method Card, with the processor's receipt number as the reference. The patient receipt form says so when a link is set.
- **Void or "Reverse locally"** appears on a row only if it is not itself a reversal, not an ERA-imported payment, not a recoupment and not already reversed.

### Workflow: record a payer remittance by hand

1. Press "+ Manual Payment". Under "Apply to" choose "Payer remittance on open claim".
2. Pick the claim, method (check, EFT, manually keyed ERA), amount, adjustment, optional reported patient responsibility, date and a reference number.
3. Quick presets fill the amount: full open balance, an estimate at the payer's expected share, the estimated copay, or write off the open balance.
4. Save. The claim becomes Paid, or Partially paid if a balance remains. One Undo reverses the whole posting.

Refusals (all leave the data unchanged and show the message in a toast):

| Message (shortened) | Meaning |
|---|---|
| Only an open claim or a documented denial write-off can be posted | The claim must be Submitted or Partially paid; a Denied claim accepts only a zero-payment write-off |
| Payment and adjustment exceed the open claim balance | Overpayment is blocked |
| Use check, EFT or manually recorded ERA for an insurance remittance | Cash and card are patient methods |
| A payment reference is required / reference already posted | References must exist and be unique on the claim |
| Explain adjustment-only postings in the note | An adjustment with no payment needs a reason |
| Patient receipts are already allocated | Reverse the patient receipts first |
| A secondary filing is linked | Review or cancel the secondary before changing the primary |
| Patient receipt ledger does not reconcile | The claim's patient total no longer matches its receipts; review before posting |

### Workflow: import an 835 ERA

1. Press "Upload ERA (835)". Choose "Upload 835" and pick a `.835` or `.txt` file (2 MB limit), or choose "Type ERA lines".
2. The preview lists each claim line with Charges, Allowed, Payer pay, Adjustments, Patient share, and a decision: **Eligible** or **Park** with a reason.
3. Tick the eligible lines you want ("Select visible eligible" helps). Press "Post selected and park the rest", or "Save all as parked".
4. The toast reports "ERA reviewed: N posted, M parked". If the file has provider-level (PLB) adjustments it adds "provider-level PLB not applied".
5. To work parked lines later, open the ERA, review the lines, press "Retry parked lines", tick lines and press "Post selected parked lines". "Export parked CSV" downloads the parked lines for follow-up.

A line is eligible only when it matches exactly one claim by the claim number, the claim is a submitted or partially paid primary with no active secondary, the payer name matches, the claim status code is one the app supports (secondary and tertiary codes park), charges and dates agree, the patient-responsibility adjustments agree with the reported patient amount, the amount does not exceed the open balance, and nothing was already posted. Anything else parks with its reason. Typical park reasons: no or ambiguous match, secondary claim, service-line detail present, payer name mismatch, secondary or tertiary status, claim not submitted, already posted, charges or dates differ, exceeds balance, denial without a monetary reason code.

File-level problems (missing segments, mismatched control numbers, more than one transaction in the file, a duplicate of an already imported file) stop the whole file with an error. A total in the payment header that disagrees with the sum of the claim lines is a warning, not a stop.

"Type ERA lines" is the manual alternative: claim, paid, adjustment, status (paid, denied, partial) and a reason code for denials. If any typed line would park, the whole batch is refused.

### Workflow: void a payment

Press Void on a payment row (patient receipts say "Reverse locally"). The original stays in the ledger and a signed reversal entry `VOID-<ref>` is added. The claim reopens. Refused when the payment is an ERA import, is already voided, when patient receipts depend on it, or when a secondary filing is linked. "Undo that import" for an ERA only works through the in-memory Undo and is lost on reload.

### Workflow: record a recoupment

Press "+ Recoupment" ("Record a payer recoupment"). Choose a paid primary insurance claim, the amount taken back, the date, why (overpayment, duplicate, eligibility, COB, audit, authorization, other), how the money went back (offset or refund) and the payer's reference (at least three characters). The claim's paid amount goes down, a negative ledger entry is written, and the balance reopens. Refused: more than was paid, a secondary claim, a self-pay invoice, a void claim, a linked secondary filing, a future date, a duplicate reference. The app records that it happened; it does not do the offset or refund.

### Workflow: patient receipt

Press "+ Patient receipt" (or "Record receipt" from the AR Manager drill-down). The amount is capped at the reported patient share that remains. Methods: check, EFT, cash, card. A reference is required and must be unique among active receipts for the client. Card means "you took a card payment elsewhere"; the app never charges a card. "Patient audit CSV" lists receipts and reversals.

### Workflow: unapplied receipt

In "+ Manual Payment" choose "Unapplied receipt" for money you cannot match to a claim yet. It is recorded for the client and changes no claim. There is no later "apply to claim" step.

### Secondary Queue (COB)

Open Billing, Secondary Queue. A primary claim is eligible when it is Partially paid, has a balance, no patient receipts have been taken, the client has active secondary coverage covering the dates, and the secondary payer differs from the primary.

1. **Create COB draft** copies the primary's remaining balance to a new claim `<primary no>-S<n>` with its own timely-filing date.
2. **Record external filing** asks how you filed it: clearinghouse (external), paper with primary EOB, or paper without EOB. The claim history reads "not transmitted by Aloha".
3. **Record payer remittance** opens the Payment Center with the secondary selected, so the money is posted through the same guards.
4. **Skip filing** marks the secondary as not needed; **Cancel locally** cancels a draft and a re-file creates `-S2`.

The balance on a secondary claim is not extra A/R; the footer says "filing balance is not additional A/R". KPIs: Ready, Submitted, Paid, Denied, Remaining. The banner says "verify COB externally".

## How it works

### Modules

- [`era.js`](../../src/lib/era.js): `parse835` splits on `~` and `*` and requires the envelope (ISA, GS, ST 835, SE, GE, IEA), BPR, TRN and CLP. It reads payment amount and date, trace, payer name, per-claim CLP fields, claim-level CAS, allowed amount and dates. SVC only sets a flag. PLB only sets `meta.hasPLB`. It fingerprints the file with FNV-1a for duplicate detection. `matchEraLines` and `denialByCARC` are used by tests.
- [`eraPosting.js`](../../src/lib/eraPosting.js): `previewEra` (decisions per line), `planEraImport`, `planParkedEraPost`, `eraDenialInfo` (turns a denial line's group and reason code into the stored reason and next step, looked up in the practice's remittance code hints via `carcHintsOf` in claims.js; unknown codes get a generic "Payer denial" reason).
- [`paymentLedger.js`](../../src/lib/paymentLedger.js): `planClaimPayment`, `planPatientReceipt`, `planUnappliedReceipt`, `planVoidClaimPayment`, `planRecoupment`, `buildPatientReceiptAudit`, `RECOUP_REASONS`, `RECOUP_METHODS`. Money is held in integer cents internally and values with more than two decimals are refused.
- [`secondaryLedger.js`](../../src/lib/secondaryLedger.js): `planSecondaryFiling`, `planSecondarySkip`, `planSecondaryCancel`, `normalizeCobLedger`, `SECONDARY_METHODS`.
- [`claims.js`](../../src/lib/claims.js): `payPatch`, `dueOf`, `patientResponsibilityOf`, `patientLedgerMatches`, `quickPosts`, `secondaryEligible`, `secondaryClaimPatch`, `paymentsFromClaims`.
- [`billingDocs.js`](../../src/lib/billingDocs.js): `build835ErrorReport` (parked-lines CSV, formula-escaped).
- Screens: [`PaymentCenterView.jsx`](../../src/components/PaymentCenterView.jsx), [`SecondaryBillingView.jsx`](../../src/components/SecondaryBillingView.jsx).

### Action to plan to reducer

Every write follows the repo pattern: a pure `plan*` returns `{ok, msg, ...patch}`; the `createActions` method plans once to produce the toast; the reducer `*Tx` case plans again against live state before applying, so a stale preview or a double click cannot post twice. Each `*Tx` case ends in one `claimsTx`, which is one Undo snapshot.

| Action | Plan | Reducer case |
|---|---|---|
| `postPayment`, `recordPayment` (with a claim) | `planClaimPayment` | `claimPaymentTx` |
| `recordPayment` (no claim) | `planUnappliedReceipt` | `unappliedPaymentTx` |
| `recordPatientReceipt` | `planPatientReceipt` | `patientReceiptTx` |
| `voidPayment` | `planVoidClaimPayment` | `claimVoidPaymentTx` |
| `recordRecoupment` | `planRecoupment` | `claimRecoupTx` |
| `import835`, `importEra` | `planEraImport` | `eraImportTx` |
| `retryEra` | `planParkedEraPost` | `eraRetryTx` |
| `fileSecondaryClaim`, `submitSecondaryClaim` | `planSecondaryFiling` | `secondaryFilingTx` |
| `skipSecondary` | `planSecondarySkip` | `secondarySkipTx` |
| `cancelSecondaryClaim` | `planSecondaryCancel` | `secondaryCancelTx` |

All of these reducer case names are listed in `actionAreas` in [`security.js`](../../src/lib/security.js) under the billing area; a new action needs an entry there or it is refused. For ERAs, `authorizeAction` also checks that every line's claim is inside the account's office scope.

### State

- `payments` (map). Entry: `id`, `claimId` (or null), `clientId`, `payer`, `amount` (signed), `adj`, `patientResp`, `date`, `method`, `ref`, `note`, `kind`, `reversalOf`, `reconciled`, `attachments`, `createdAt`, `createdBy`. Kinds: `check`, `manual`, `writeoff`, `era835`, `patient`, `unapplied`, `recoupment`.
- `eraImports` (map): the import record with a `detail[]` per line (decision, reason, claim) and a trace and fingerprint. Segment-level patient data (NM1, ISA) is not stored.
- Claim fields: `paid`, `adj`, `secondaryPaid`, `patientPaid`, `recouped`, `remittance`, `denial`; for COB `secondary`, `method: 'secondary'`, `parentNo`, `secondarySkipped`, `cobReviewNeeded`, `submitMethod`, `timelyDue`. ERA denials set status Denied with a `denial.code` of the form `carc:<group>-<reason>`.
- `reconciled` is always false; there is no bank reconciliation.

### Migrations

`normalizeCobLedger` runs inside `normalizeWorkspace`; `paymentsFromClaims` derives ledger entries from legacy inline remittances in `normalizeBillingV2`. Order and idempotency rules are in [architecture](architecture.md).

### Tests

[`era.test.js`](../../src/__tests__/era.test.js), [`eraPosting.test.js`](../../src/__tests__/eraPosting.test.js), [`paymentCenterEra.test.jsx`](../../src/__tests__/paymentCenterEra.test.jsx), [`recoupments.test.jsx`](../../src/__tests__/recoupments.test.jsx), [`patientReceipts.test.js`](../../src/__tests__/patientReceipts.test.js), [`patientFlow.test.jsx`](../../src/__tests__/patientFlow.test.jsx), [`secondaryLedger.test.js`](../../src/__tests__/secondaryLedger.test.js), [`secondaryFlow.test.jsx`](../../src/__tests__/secondaryFlow.test.jsx), [`billingSecondary.test.jsx`](../../src/__tests__/billingSecondary.test.jsx). Fixtures: [`835-full.txt`](../../src/__tests__/fixtures/835-full.txt) and [`835-malformed.txt`](../../src/__tests__/fixtures/835-malformed.txt).

## Not yet built

- No service-line (SVC) allocation; a file with line detail parks the claim.
- PLB adjustments are never applied; the toast only says they were not.
- No bank or deposit reconciliation (`reconciled` is always false) and no match of the payment header amount to a deposit.
- No refunds and no card charging; "card" only records that it happened elsewhere.
- No secondary 835 posting; a secondary remittance is keyed by hand. Recoupment is primary insurance claims only.
- No split receipts, and no later step to apply an unapplied receipt to a claim.
- One ST transaction per 835 file.
- ERA-posted payments cannot be voided on their own, and "Undo that import" is the in-memory Undo only (lost on reload, 25 steps, this tab).
- An ERA denial does not post a CARC adjustment; it sets the claim to Denied with the code. The reason and next step come from the remittance code hints in Settings, System, Billing Settings (defaults cover 11 common codes such as CO-16, CO-197 and CO-252).
- No un-skip for a secondary filing except Undo.
- No EDI transmission of any file in either direction.
