# Accounts receivable

_Sources: src/lib/claims.js, src/lib/billingKpis.js, src/lib/billingDocs.js, src/components/ArManagerView.jsx, src/components/GenerateInvoiceView.jsx, src/components/BillingView.jsx_
_Last synced with main at c185259 on 2026-10-04._

This page covers what the practice is still owed and how old it is: the AR Manager, the aging buckets, the numbers beside them (DSO, collections rate, write-offs), and the draft patient statement. How balances are reduced is in [era-and-payments](era-and-payments.md); how claims are created is in [billing-and-claims](billing-and-claims.md).

Everything is computed from the claims and payments held in this browser. Nothing is reported to a payer, a patient or a collections agency. A statement is a text file you download.

## User guide

### AR Manager

Open Billing, AR Manager.

**What counts as A/R.** A primary claim (not a secondary filing, not void, not draft) with a balance above half a cent. The balance is charges, minus adjustments, minus payer payments, minus secondary and patient receipts. A secondary (COB) claim is a filing of the same receivable, so it is never added again; the Secondary Queue footer says "filing balance is not additional A/R".

**Header.** An export button (`AR-<client or payer>-<as-of date>.csv`) and a range picker. The range picker only sets the as-of date; aging is always measured to that date, not over a window.

**KPI strip.**

| KPI | Meaning |
|---|---|
| Total A/R | Sum of open primary balances ("primary ledger only") |
| Remaining patient share | The reported patient responsibility still open after local patient receipts; the sub-line shows how much of A/R is not assigned to the patient |
| >90d | Balance in the 91 to 120 and 121 plus buckets |
| DSO | Total A/R divided by average daily charges over the last 90 days (see "How it works") |
| Collections (90 days) | Payments posted in the last 90 days as a share of those payments plus the open A/R |
| Write-off YTD | Adjustments recorded by write-off postings since 1 January of the as-of year |

**Two views (tabs).**

- **By Client.** One row per client with a balance.
- **By filing / patient bucket.** One row per active filing payer, plus a patient bucket ("Patient / family (reported PR + self-pay)"). A balance is split between the payer's slice and the patient's reported share, so the slices add up to one receivable and are never counted twice. Three review buckets can appear: "Ledger mismatch / review" (the patient receipt ledger does not reconcile, or COB needs review), "COB draft / review" (a secondary draft exists but was not filed) and "COB remainder / review" (a secondary closed with something left).

**Columns.** Last payment, Current (0 to 30 days), 31 to 60, 61 to 90, "91 to 120+" and Balance, 25 rows a page. The table merges 91 to 120 and 121 plus into one column; the KPI, over-90 figures and the CSV keep them separate.

**Aging clock.** Days open are counted from when the claim was marked submitted. If it has no submitted date, from the last date of service; if that is missing too, from the date the claim was created.

**Client drill-down.** Click a client for their open claims (claim number, date of service, practice A/R, remaining patient share, status). From there:

- "Record receipt" opens the Payment Center with the patient receipt dialog pointed at that claim.
- "Statement" opens Generate Invoice with "Patient share only" on.
- A per-client CSV export lists the open claims.

### Generate Invoice (draft patient statement)

Open Billing, Generate Invoice. The page title reads "Invoices, draft patient share". Pick clients on the left, tick "Patient share only" to restrict to claims with a reported patient balance, and press "Download draft statement". The file is `Patient-share-draft-<date>.txt`. The preview shows each client's claims and their remaining reported patient share. The statement is a draft you print or hand over yourself; the app does not mail or email it and does not record that you did. Receipts are recorded separately with "Record receipt".

### The desk's aging indicators

On the Billing desk, a Submitted claim shows an age and a "late" flag. That uses a different engine from the AR Manager (see "How it works"): its buckets are 0 to 30, 31 to 60, 61 to 90 and 90 plus, only for Submitted claims, and "late" means older than 1.6 times the payer's expected days to pay, which comes from the payer's Payment Terms.

### Reading the numbers

| You see | Read it as |
|---|---|
| A balance on a client with no payer owing it | Reported patient share or self-pay; collect from the family |
| A claim older than 90 days | Over 90; check whether a payer remittance, denial or secondary is still outstanding |
| A review bucket | The ledger needs a person to look at it before more money is posted |
| Total A/R differs from the desk's "Awaiting Payer" | The desk counts Submitted claims only, A/R counts every open primary claim |

## How it works

### Modules

- [`claims.js`](../../src/lib/claims.js):
  - `arOf(state, asOfISO)` builds `{byClient, byPayer, totals}`. Open claims are those where `isPrimaryReceivable` holds, the status is not draft, and `dueOf` is above 0.005. Buckets are `current`, `31-60`, `61-90`, `91-120`, `121+`. Totals carry `totalAR`, `patientAR`, `over90`, `unassignedAR`, `dso`, `collectionsRate`, `writeOffYTD`, `billed90` and `paid90`.
  - `dueOf` is charges minus adjustments minus paid, and for a primary also minus `secondaryPaid` and `patientPaid`.
  - `receivableBucketOf` chooses the payer slice or a review bucket; `PATIENT_AR_BUCKET` names the patient slice; `patientResponsibilityOf` returns the remaining reported patient share; `patientLedgerMatches` checks that `patientPaid` equals the active, non-reversed patient receipts.
  - `agingOf(claim, today, state)` and `claimStats(state, days)` drive the desk's KPI cards, its aging badge and the "late" flag; `payerPolicy` supplies the expected days.
- [`billingKpis.js`](../../src/lib/billingKpis.js): the dashboard's Billing Health widget reuses `arOf` for open A/R and computes its own "Days in A/R". See [dashboard-and-reports](dashboard-and-reports.md).
- [`reports.js`](../../src/lib/reports.js) uses `agingOf` and `dueOf` in a claim register that labels each row "Primary receivable" or "COB filing (not A/R)".
- Screens: [`ArManagerView.jsx`](../../src/components/ArManagerView.jsx) memoizes `arOf` on `claims`, `payments` and the as-of date. [`GenerateInvoiceView.jsx`](../../src/components/GenerateInvoiceView.jsx) builds the draft text itself from `patientResponsibilityOf`.

### Formulas

- DSO in `arOf`: `totalAR / (billed90 / 90)`, where `billed90` sums charges of primary non-void claims (drafts included) whose `dosFrom` is in the last 90 days. It is null when nothing was billed.
- Collections rate: `paid90 / (paid90 + totalAR)` as a percentage, where `paid90` sums payment amounts with a claim and a date in the last 90 days (negative recoupments reduce it).
- Write-off YTD: the `adj` of payments of kind `writeoff` dated since 1 January.

### Write path

The AR Manager is read-only. It changes nothing itself; "Record receipt" and "Record payment" go through the Payment Center and the plan, `*Tx` and Undo path in [era-and-payments](era-and-payments.md). There is no A/R-specific reducer case and no persisted A/R field; everything is derived.

### Tests

[`ar.test.js`](../../src/__tests__/ar.test.js) checks that `arOf` produces five buckets and that the by-client and by-payer totals reconcile. [`patientFlow.test.jsx`](../../src/__tests__/patientFlow.test.jsx) and [`patientReceipts.test.js`](../../src/__tests__/patientReceipts.test.js) cover patient share, the statement page and receipt reversal. The dashboard's Billing Health widget (`billingKpis.js`) has no test file named after it; [`dashboard.test.jsx`](../../src/__tests__/dashboard.test.jsx) only lists it among the default widgets.

## Not yet built

- No collections workflow: no dunning letters, call log, payment plans or send-to-collections status.
- No statement history and no "mark as sent". The statement is a text download with no record that it was given to anyone. A PDF statement is on the backlog in [`../HANDOFF.md`](../HANDOFF.md).
- No payer-level aging by contract terms. Aging buckets are fixed at 30-day steps and do not use the payer's expected days to pay.
- No bad-debt reserve or write-off approval step; write-offs post straight to the ledger.
- No hover formulas on the AR Manager's KPIs (the dashboard widget has them).
- Two DSO figures and two aging engines exist and can disagree; see [architecture](architecture.md), "Known doc/code mismatches".
