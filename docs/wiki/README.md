# Aloha ABA Practice Suite wiki

The Aloha ABA Practice Suite is a local-first React 18 + Vite 6 prototype for running an ABA (Applied Behavior Analysis) therapy practice: scheduling, intake, billing and claims, ERA and payments, accounts receivable, payroll, reports and settings.

Three facts shape every page in this wiki:

- **Local-first.** There is no backend. All state lives in the browser's localStorage under the key `aloha-aba.v3`. A versioned JSON backup is the only way data leaves the browser.
- **Fictional data.** The seed data is invented. Never put real names, dates of birth, member IDs or notes into the app, tests, fixtures, commits or screenshots.
- **Nothing transmits.** No EDI, clearinghouse, SMS, email, payment, calendar sync or video connection exists. Where the UI says "submitted" or "sent", it means a status was recorded locally. Pages here say "generates", "prepares", "exports" or "records locally" for the same reason.

The rules for contributors and agents are in [`../../AGENTS.md`](../../AGENTS.md). Current state and next steps are in [`../HANDOFF.md`](../HANDOFF.md). Product context is in [`../../PRODUCT.md`](../../PRODUCT.md).

**In the app:** this wiki and its FAQ open from **Help & Wiki** at the bottom of the navigation rail (or Cmd/Ctrl+K, then "wiki"), with search across every page. Help bundles these files at build time, so editing a page here changes Help on the next deploy.

## Pages

| Page | What it covers |
|---|---|
| [README](README.md) | This home page, the glossary and how to keep the wiki current |
| [scheduling](scheduling.md) | Calendar, booking dialog, authorization guards, risk and insights |
| [intake](intake.md) | Referral pipeline, stages, conversion to a client |
| [billing-and-claims](billing-and-claims.md) | Staging, claim assembly, gates, submit/deny/rebill/void, CMS-1500, billed files, appeals, provider IDs, payer terms |
| [era-and-payments](era-and-payments.md) | 835 import and parking, manual payments, voids, recoupments, patient receipts, secondary (COB) filings |
| [accounts-receivable](accounts-receivable.md) | AR Manager, aging buckets, DSO, draft patient statements |
| [payroll](payroll.md) | Timesheets, pay runs, approvals, exports |
| [dashboard-and-reports](dashboard-and-reports.md) | Dashboard boards and widgets, the report registry, analytics |
| [settings](settings.md) | Settings masters, system options, data import |
| [security-undo-backup](security-undo-backup.md) | Demo role-based access, the 25-step Undo, backup and restore, storage warning |
| [architecture](architecture.md) | Folder layout, data flow, testing rules, CI/deploy, known doc/code mismatches |
| [faq](faq.md) | Short answers to common front-desk and billing questions; also searchable in the app under Help & Wiki |

## Glossary

- **Auth (authorization).** A payer's approval for a client to receive a set of services, usually with hours or units per code and a start and end date. Scheduling guards compare bookings against it.
- **Units.** The billing quantity for a CPT/HCPCS code. A unit has a length in minutes (the length depends on the code and the payer's rule). The app follows the Medicaid / CPT norm: the ABA codes (97151 to 97158, 0362T, 0373T) and H2019 are 15-minute units counted by the midpoint rule (8 minutes or more makes a unit), and 253MT is 30 minutes. A payer's own unit size or rounding overrides this. Rates in the code table are per 15-minute unit.
- **CPT / HCPCS.** The procedure codes that name a billed service, for example 97153 (adaptive behavior treatment by protocol). CPT codes are five digits; HCPCS Level II codes begin with a letter, for example H2019.
- **Modifier.** A two-character add-on to a procedure code (for example HO) that a payer uses to tell who delivered the service. Claim lines carry up to four, in this order: the payer's own service modifier, the rendering provider's credential modifier (HO for a BCBA, HN for a BCaBA, HM for an RBT, HP for a psychologist; on by default, a payer can turn it off) and the payer's place-of-service modifier. Self-pay invoices carry none.
- **Place of service (POS).** The CMS code for where the session happened. The app derives it from the session's location: home 12, school 03, telehealth 10, community 99, otherwise office 11.
- **Merge same day.** A payer rule, on by default, that puts same-day sessions for one client, code and rendering provider on one claim line and rounds their combined minutes once. **Separate Claim By** is the opposite control: it splits a client's month into several claims.
- **MUE.** Medically Unlikely Edit: the most units a payer will accept for a code in a day. The app also supports a weekly cap per payer.
- **NPI.** National Provider Identifier, a 10-digit number with a check digit. The app validates the check digit.
- **Medicaid ID.** The provider number a state Medicaid program assigns. Each payer can be set to bill with the NPI, the Medicaid ID, or both.
- **CMS-1500.** The standard paper professional claim form. The app draws a printable PDF of it. It is a printable companion, not an electronic filing.
- **837P.** The electronic professional claim format (an X12 transaction). The app does not produce X12. The file it calls an "837P" billed file is a pipe-delimited .txt summary of claim number, payer and charges.
- **ERA / 835.** The electronic remittance advice a payer sends to explain a payment, as an X12 835 file. The app reads a pasted or uploaded 835 locally.
- **CLP.** The claim payment segment of an 835: one per claim, with claim number, status, charges and paid amount.
- **CAS.** The claim adjustment segment of an 835: a group code (CO, PR and others), a reason code and an amount.
- **CARC.** Claim Adjustment Reason Code, the number inside a CAS that says why an amount was adjusted or denied.
- **PLB.** Provider-level balance segment of an 835: adjustments that are not tied to one claim (for example a recoupment). The app notes that a PLB exists but never applies it.
- **COB / secondary.** Coordination of benefits. When a client has two insurers, the second one (secondary) may owe part of the balance the primary left. The app records the secondary filing locally and does not file it.
- **Patient responsibility.** The part of a charge the payer says the patient owes (copay, coinsurance, deductible), reported as PR adjustments on the remittance.
- **Recoupment.** A payer taking back money it paid earlier, by offsetting a later payment or by asking for a refund.
- **Timely filing.** The deadline, counted in days from the date of service, by which a payer will still accept a claim. Set per payer, with a practice default.
- **DSO.** Days sales outstanding: open A/R divided by average daily charges. The app computes it two different ways; see the [architecture](architecture.md) mismatch list.
- **A/R aging.** Open receivables grouped by how long they have been open: current (0 to 30 days), 31 to 60, 61 to 90, 91 to 120, 121 and over.
- **RBT / BCBA / BCaBA.** Registered Behavior Technician (delivers treatment under supervision), Board Certified Behavior Analyst (designs and supervises treatment), Board Certified Assistant Behavior Analyst (a supervised analyst level between the two).

## Keeping this wiki current

Every page except this one starts with a `_Sources:_` line that lists the repo files it documents, followed by a `_Last synced with main at <sha> on <date>._` line.

- CI enforces part of this: `src/__tests__/wiki.test.js` fails when a `_Sources:_` path no longer exists, when this home page does not link a page, or when a wiki link points at a missing page or heading.

- When a change touches one of the files in a page's `_Sources:_` line, update that page and its Last-synced line in the same branch.
- If a new file starts to matter to a page, add it to that page's `_Sources:_` line.
- Cite code by file path and function name only. Do not paste code blocks; link to `../../src/...` instead. Before committing, check that every function or file name you cite still exists with a search of the repo.
- When a documented limit gets fixed, move it out of "Not yet built". When a doc/code disagreement is found or fixed, update "Known doc/code mismatches" in [architecture](architecture.md).
- Keep the wording honest: say what happened locally, never what an external system did.
