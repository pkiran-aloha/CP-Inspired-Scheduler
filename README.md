# Aloha ABA — Practice Suite (v27 Billing Complete)

A fully client-side single-page app for ABA practice operations: calendar with 30-minute slot-block overlap grouping and lane-aware timeline, roster, client lifecycle, authorization-aware billing with CMS-1500-formatted exports, saved report builder with Excel/PDF output, and drag-and-drop analytics Dashboard (custom widget board: resize, reorder, per-widget time ranges, saved layouts, drill-down ledger).

**Stack:** React + Vite. Zero backend — all data lives in browser `localStorage`, seeded with fictional demo dataset (16 clients, 12 staff, ~1,053 appointments). No real PHI.

## Live site
Deployed via `.github/workflows/deploy.yml`: every push to `main` runs `npm ci → npm test → npm run build` and publishes `dist/` to GitHub Pages.

## Billing Suite (v22→v27) — Complete
- **Billing Desk**: staging (claim-ready lines, payer filter, Process Billing → 837P), claim desk (draft/submitted/denied/paid/void, gates, CMS-1500 batch, ledger CSV), secondary COB queue, blocked lines, setup (practice identity, rate policy, claim gates)
- **AR Manager**: BY CLIENT / BY PAYER views, aging buckets (Current, 31-60, 61-90, 91-120, 121+), totals reconcile, drill-in → Statement + Export, prefill to Generate Invoice (Balance Only)
- **Payment Center**: manual payments (payer, claim, date, type, ref, amount, adj, ptResp, reconciled), ERA 835 upload (parse835, matched green / unmatched amber, fixture 5 lines), post/park, void, remittance CSV export, ERA detail + unmatched CSV
- **Generate Invoice (C6)**: Invoice for Payer/Client radio (Payer* when Payer), Invoice Format (Standard/Statement/Payment Reminder), From*/To*, Client(s) multiselect, Order By (Date/Client/Payer), Description as (Service/CPT+Desc/Session Title), Doc Format PDF/CSV, Include Tax ID + Tax % (default 0), Top/Bottom Notes, Balance Only, Include Appointment Time (adds Time column), Separated By Client (N files), Include Scheduled, INV-YYYYMM-### sequencing (settings.billing.invoiceSeq), records to billedFiles + invoices with re-download
- **Verification Forms (C7)**: Payer*, Verification Format (Parental/Benefit/Prior Auth Request), From*/To*, Client(s), Appointment State (all/completed/scheduled), Doc Format PDF, Generate+Clear, branded PDF (org letterhead, payer address, client, date range, appt table, signatures), history log
- **QuickBooks (C8)**: Invoice Date*/Due Date*, From*/To*, Client(s), Balance Only, Invoice # Start (4127 default → increments), QBO Name Format (Client Name / Last,First / Client+DOS), Unit Rate table editable + Save → settings.billing.qboRates, QBO CSV header matches Intuit contract (Invoice Number,Customer,Invoice Date,Due Date,Product/Service,Qty,Unit Price,Amount,Memo,Tax Code), no negatives, MM/DD/YYYY, split guard ≤1000 rows / ≤100 invoices → N files, records to billedFiles
- **Secondary Queue (C5)**: ready KPI, queue rows (client + primary#, remaining after primary), Release+Skip+Submit (dropdown 3 methods: CH/paper_bg/paper_nobg), CH artifact Box 18 = X, -S1/-S2 numbering, Paper bg includes background snapshot, Paper nobg no background, Release voids chain, Skip→patient balance secondary=skipped, secondary payment closes paid
- **Appeals Manager (C10)**: denied claims table (search, select), appeal letter (claim, narrative, enclosures comma-separated) → Appeal-{claimNo}.txt with org letterhead + denial CARC + narrative, 835 Error Report (ERA select → 835-Error-{file}.csv with claim_no,status,charges,paid,patient_resp,adjustments,suggested_match), history with re-download
- **Billed Files (C9)**: search, payer filter, format filter (837P/cms1500/invoice/qbo_csv/verification/appeal_letter/835_error_report), From/To date, sort (file/payer/format/date), Generate 837P, Clear, table columns File Name/Payer/Type/Clients/Claims/Billed Through/Send Count/Actions (Download/Resend/View/Void), detail panel (meta + content preview 5000 chars + claimIds), pagination 25/page, void keeps history
- **Provider Identifier (U2)**: NPI (10-digit Luhn), taxonomy (TAXONOMIES + custom), claim roles (rendering/billing/facility), payer-specific IDs (Ticare/Medicaid/BHPN/Referring) per tab, default billing/facility, active filter, office rows can have multiple NPIs, staff missing warning

**Builders (U7) `src/lib/billingDocs.js`**: pure functions `buildInvoices` (for payer/client, taxId/taxPct, top/bottom notes, balanceOnly, inclTime, perClient, inclScheduled, orderBy, descriptionAs, INV-YYYYMM-###), `buildQboCsv` (≤1000 rows / ≤100 invoices split, no negatives, header contract), `buildVerificationForm` (per-client branded PDF), `buildAppealLetter`, `build835ErrorReport` — all wired to exportKit + unit tests 6/6.

## Probes (Playwright)
- c44 Payment Center 26/26
- c45 AR Manager 23/23
- c46 Secondary Billing 21/21
- c47 Generate Invoice + Verification Forms 41/41
- c48 QuickBooks 25/25
- c49 Billed Files 25/25
- c50 Appeals Manager 22/22
- c51 Full Billing Integration 28/28

## Develop
```
npm install
npm run dev        # http://localhost:5173
npm test           # vitest
npm run build      # static site in dist/
```

## License
No license granted — demo/portfolio work; "CP-inspired" refers to general scheduling-software UX patterns only.
