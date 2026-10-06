# Accounts receivable

_Sources: src/lib/claims.js, src/lib/statements.js, src/lib/billingKpis.js, src/lib/billingDocs.js, src/components/ArManagerView.jsx, src/components/GenerateInvoiceView.jsx, src/components/BillingView.jsx, src/__tests__/billingKpis.test.js_
_Last synced against main 46b43aa plus the feat/family-statement branch on 2026-10-06; unrelated behavior unchanged._

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

**Columns.** Last payment, Current (0 to 30 days), 31 to 60, 61 to 90, 91 to 120, 121 plus and Balance, 25 rows a page. The table, the over-90 KPI and the CSV all use the same five buckets.

**Aging clock.** Days open are counted from when the claim was marked submitted. If it has no submitted date, from the last date of service; if that is missing too, from the date the claim was created.

**Client drill-down.** Click a client for their open claims (claim number, date of service, practice A/R, remaining patient share, status). From there:

- "Record receipt" opens the Payment Center with the patient receipt dialog pointed at that claim.
- "Statement" opens Generate Invoice with "Patient share only" on.
- A per-client CSV export lists the open claims.

### Generate Invoice (draft patient statement)

Open Billing, Generate Invoice. The page title reads "Invoices, draft patient share". Pick clients on the left, tick "Patient share only" to restrict to claims with a reported patient balance, and press "Download draft statement". The file is `Patient-share-draft-<date>.txt`. The preview shows each client's claims and their remaining reported patient share. The statement is a draft you print or hand over yourself; the app does not mail or email it and does not record that you did. Receipts are recorded separately with "Record receipt".

### Client statements

For a numbered statement with history, press **Issue statement** on a client in the preview. The button appears when the family owes something: self-pay charges, or a patient share the payer reported.

The statement is numbered `STM-<year><month>-<nnn>`. It freezes one line per claim with what the family owed that day. It then appears under **Statements** at the bottom of the page, where each row offers four things:
- **PDF** downloads the printed statement (below).
- **Its balance is live.** Patient receipts recorded in the Payment Center reduce it, and it reads *Paid* once nothing on its claims is owed.
- **Mark sent** records how you delivered it: mailed, handed over, emailed from your own email, or posted to your own portal. The app sends nothing.
- **Void** needs a reason and leaves the claims unchanged.

#### The printed statement

The PDF follows HFMA's patient-friendly billing guidance: plain language, the amount and due date at a glance, proof that insurance paid its part, whom to call, and a remittance stub. Letter size, top to bottom:

1. **Header.** The practice name and return address on the left; on the right, "STATEMENT", the statement date, the account number (the client id) and the statement number.
2. **Address block**, placed for a #10 window envelope. It carries only the guardian's name and the client chart's home address, so nothing else shows through the window.
3. **Amount due panel.** The amount, "Please pay by" (statement date plus the practice's due days, 30 by default) and how to pay: the practice's payment link if one is saved, otherwise "mail a check with the stub".
4. **Patient and questions.** The patient's name and the practice phone and email.
5. **Account summary.** Your share of these services, payments and credits since the statement, amount due.
6. **Activity**, one row per claim: dates of service, a plain description ("Therapy services, 8 visits") with the claim number and CPT codes in small type, who it was billed to, charges, insurance paid, adjustments, your share and what is still owed.
7. **How long this has been owed:** current, 31-60, 61-90 and over 90 days, aged from each claim's last date of service.
8. **Messages.** What "your share" means. When a line is self-pay, the No Surprises Act notice of the right to a Good Faith Estimate and to dispute a bill $400 or more above it within 120 days.
9. **Remittance stub** at the foot of page 1, below a dashed tear line. It carries the remit-to address, "Make checks payable to", the guardian's address, account number, statement date, due date, amount due and an "Amount enclosed" box. There are no card fields: the app never collects payment details.

It never prints a diagnosis, member ID or birth date. Longer statements continue the activity on page 2 and keep the stub on page 1; every page is numbered. A void statement is stamped VOID and shows nothing owed. `statementView` computes everything the PDF shows (pure, tested); `statementPdf` draws it.

If the practice saved an online payment link (for example a Stripe Payment Link) in Settings > Clinical Integrations, the amount due panel prints it while the statement has a balance and is not void (`paymentLinkFor`). Paying online changes nothing here until someone records the receipt in the Payment Center.

Issuing, marking sent and voiding are each one Undo. Statements are in workspace backups. The demo data leaves three families owing a payer-reported coinsurance share (`seedFamilyShares` in `src/lib/seed.js`), so statements can be issued straight away; clients with secondary coverage are skipped so the COB demo is unchanged. `src/lib/statements.js`; tests: `statements.test.jsx`.

### The desk's aging indicators

The Billing desk ages claims with the same engine as the AR Manager: one clock and the same five buckets (0 to 30, 31 to 60, 61 to 90, 91 to 120, 121 plus). The strip above the claim list buckets the submitted claims in the selected range, and the claim drawer shows any open primary claim's days out — a denied claim keeps aging while its balance is still owed. "Late" means older than 1.6 times the payer's expected days to pay, which comes from the payer's Payment Terms.

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
  - `agingOf(claim, today, state)` and `claimStats(state, days)` drive the desk's KPI cards, its aging badge and the "late" flag; `payerPolicy` supplies the expected days. They share the AR engine's clock and buckets: `agingSince` (submittedAt, else last date of service, else creation date) and `agingBucketFor` (the five buckets above). Draft, void, closed and zero-balance claims have no age.
- [`billingKpis.js`](../../src/lib/billingKpis.js): the dashboard's Billing Health widget reuses `arOf` for open A/R, DSO and over-90 A/R, so Days in A/R is the same figure as the AR Manager. See [dashboard-and-reports](dashboard-and-reports.md).
- [`reports.js`](../../src/lib/reports.js) uses `agingOf` and `dueOf` in a claim register that labels each row "Primary receivable" or "COB filing (not A/R)".
- Screens: [`ArManagerView.jsx`](../../src/components/ArManagerView.jsx) memoizes `arOf` on `claims`, `payments` and the as-of date. [`GenerateInvoiceView.jsx`](../../src/components/GenerateInvoiceView.jsx) builds the draft text itself from `patientResponsibilityOf`.

### Formulas

- DSO in both `arOf` and Billing Health: `totalAR / (billed90 / 90)`, where `billed90` sums charges of primary non-void claims (drafts included) whose `dosFrom` is on or after the date 90 days before the as-of date. It is null when nothing was billed; both screens show a dash.
- Collections rate: `paid90 / (paid90 + totalAR)` as a percentage, where `paid90` sums payment amounts with a claim and a date in the last 90 days (negative recoupments reduce it).
- Write-off YTD: the `adj` of payments of kind `writeoff` dated since 1 January.

### Write path

The AR Manager is read-only. It changes nothing itself; "Record receipt" and "Record payment" go through the Payment Center and the plan, `*Tx` and Undo path in [era-and-payments](era-and-payments.md). There is no A/R-specific reducer case and no persisted A/R field; everything is derived.

### Tests

[`ar.test.js`](../../src/__tests__/ar.test.js) checks that `arOf` produces five buckets and that the by-client and by-payer totals reconcile; [`claims.test.js`](../../src/__tests__/claims.test.js) checks that the desk buckets reconcile with the AR Manager's for the same claims. [`billingKpis.test.js`](../../src/__tests__/billingKpis.test.js) checks that Billing Health uses the same DSO and that a missing denominator stays empty; [`dashboard.test.jsx`](../../src/__tests__/dashboard.test.jsx) checks that the widget displays that as a dash. [`patientFlow.test.jsx`](../../src/__tests__/patientFlow.test.jsx) and [`patientReceipts.test.js`](../../src/__tests__/patientReceipts.test.js) cover patient share, the statement page and receipt reversal.

## Not yet built

- No collections workflow: no dunning letters, call log, payment plans or send-to-collections status.
- No statement delivery. Statements are downloaded and delivered by the practice; nothing is mailed, emailed or posted by the app, and there is no family portal.
- No payer-level aging by contract terms. Aging buckets are fixed at 30-day steps and do not use the payer's expected days to pay.
- No bad-debt reserve or write-off approval step; write-offs post straight to the ledger.
- No hover formulas on the AR Manager's KPIs (the dashboard widget has them).
- The dashboard and AR Manager share one DSO formula, and the AR Manager, the Billing desk, the Claims Register and the claim drawer share one aging engine: the same clock and the same five buckets.
