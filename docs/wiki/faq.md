# FAQ

_Sources: docs/wiki/README.md, docs/wiki/scheduling.md, docs/wiki/intake.md, docs/wiki/billing-and-claims.md, docs/wiki/era-and-payments.md, docs/wiki/accounts-receivable.md, docs/wiki/payroll.md, docs/wiki/dashboard-and-reports.md, docs/wiki/settings.md, docs/wiki/security-undo-backup.md_
_Last synced with main at 2b51459 on 2026-10-04._

[Wiki home](README.md)

Short answers for front-desk, scheduling and billing staff. Each answer links to the page that explains it in full. Everything here describes what the app does inside this browser: nothing is transmitted to a payer, family, bank or any other outside system.

## Getting started

### What is the Aloha ABA Practice Suite?

It is a local-first prototype for running an ABA practice: scheduling, intake, billing and claims, ERA and payments, accounts receivable, payroll, reports and settings, all in one workspace. It runs entirely in your browser with no backend. [More: Wiki home](README.md)

### Does Aloha send anything to payers, families or banks?

No. There is no EDI, clearinghouse, text message, email, payment, calendar sync or video connection. Where a button or message says "submitted" or "sent", it means a status was recorded in this browser, and the files the app builds are downloads you hand over yourself. [More: Wiki home](README.md)

### Can I enter real client information?

No. The built-in data is fictional, and this prototype has no real sign-in, no encryption and no server. Do not type real names, dates of birth, member IDs or notes into it. [More: Security, Undo and backup](security-undo-backup.md#security-accounts-and-roles)

### How do I get around quickly?

Press `?` on the calendar for the list of shortcuts, and Cmd or Ctrl plus K for the command palette, which jumps to a section, runs a report or finds a client or staff member. Number keys open sections, for example `6` for Reports, `7` for the Dashboard, `9` for Payroll and `0` for Settings. [More: Scheduling](scheduling.md#the-calendar)

## Scheduling

### Why can't I save this booking?

The Checks rail beside the booking form shows what is in the way. A stop sign must be fixed first: a required field is empty (date, staff, client, a required note, or a cancellation reason), a practice rule set to Stop failed, or the authorization guard is in Stop mode and the session would spend past the authorization. A caution or flag never blocks the save. [More: Scheduling](scheduling.md#booking-an-appointment)

### What does the authorization warning mean?

It compares the session with the client's authorization window and unit pools: hours or units committed against what is on file, the weekly pace, days to expiry, the payer's daily and weekly unit limits and the staff member's credential. In the default Warn mode it shows as a caution and the booking still saves. Check the numbers against the payer's letter, because the pool is an estimate unless someone entered units by code. [More: Scheduling](scheduling.md#guard-modes-off-flag-warn-stop)

### How do I make the authorization guard stricter?

Open Settings, System Settings, Authorization guard and choose Stop. In Stop mode a booking that spends past the authorization or falls after its end date is refused. Nothing hard-blocks by default; Stop is a choice the practice makes. [More: Settings](settings.md#guards-you-will-meet)

### How does Aloha count units for a session?

It uses the payer's unit size and rounding for that service, then the service master, then the code default. The default is the Medicaid and CPT norm: 15-minute units for the ABA codes, counted by the midpoint rule, so 38 minutes is 3 units and 37 minutes is 2. The Billing tab of the booking form shows the rule it used. [More: Scheduling](scheduling.md#guard-modes-off-flag-warn-stop)

### How do I cancel a session?

Use Cancel (or Skip occurrence for a series) on the session's detail card, then pick a reason from the practice's cancellation reasons list. The reason is required, and it feeds the Cancellation Root Cause report. Practice-side reasons, such as staff illness, are kept out of the family's risk history. [More: Scheduling](scheduling.md#cancelling-and-skipping)

### Does Aloha send reminders to families?

No. Confirming a session, assigning cover or recording a cancellation reason changes records in this browser only. The cancellation-risk score is a prompt for you to call or confirm yourself. [More: Scheduling](scheduling.md#scheduler-insights)

## Intake

### How do I add a new referral?

Open Clients, Intake Manager, General Intake Requests and press New intake. The record starts at New referral on the board, and you work it forward stage by stage. [More: Intake](intake.md#working-the-pipeline)

### Why can't I move an intake to the next stage?

Each stage has a gate that lists what must be true first, for example a logged contact attempt before Contacted or a member ID before Benefits verified. The detail drawer's Next box names the one thing to do next. Stages cannot be skipped. [More: Intake](intake.md#working-the-pipeline)

### How do I turn an intake into a client?

Convert is available from the Authorization stage once every item in the converted gate is met. One action creates the client chart and links it both ways, and one Undo reverses it. The approved units are not copied into the client's per-code authorization pool, so enter them under Clients, Edit afterwards. [More: Intake](intake.md#converting-to-a-client)

## Billing and claims

### Why isn't a session showing in Staging?

A session stages only when its type is billable, its status is one the practice marked billable, it has billable units or mileage, and it is not already on a claim. If "Require session verification" is on it must be verified, and if strict authorization is on its date must fall inside the authorization window. The Blocked tab lists sessions that cannot be staged, with the reason. [More: Billing and claims](billing-and-claims.md#workflow-from-sessions-to-a-submitted-claim)

### How do I create a claim?

1. Open Billing and the Staging tab.
2. Select the lines you want, or none for all, and press Assemble.
3. Review each draft on the Claim Desk.

One draft is made per client per month, plus an invoice-style claim for self-pay clients. [More: Billing and claims](billing-and-claims.md#workflow-from-sessions-to-a-submitted-claim)

### Why is my claim held and not submitted?

Each draft passes gates first: the session still exists, billable units are present, the session is verified when required, timely filing has not passed, the authorization covers the date, and the payer's provider ID rule is met for the rendering staff. A held claim shows the reason on the line that failed. [More: Billing and claims](billing-and-claims.md#workflow-from-sessions-to-a-submitted-claim)

### Does Aloha send claims to the payer?

No. "Submit" changes the claim's status to Submitted in this browser and marks its sessions as claimed. Process also records a billed file, which is a pipe-delimited text summary you can download, not an X12 837P that a payer could read. You file the claim yourself through your own channel. [More: Billing and claims](billing-and-claims.md#billed-files)

### Why did two sessions become one claim line?

Medicaid counts one code, one client, one date of service and one rendering provider as a single line, so by default the day's minutes are added up and rounded once. Two 37-minute sessions bill 5 units, not 2 plus 2. A payer can turn this off under Masters, Payers, Billing Rules, Claims Settings, and the same screen has Separate Claim By to split a month into several claims. [More: Billing and claims](billing-and-claims.md#line-modifiers-same-day-merge-and-claim-splitting)

### Where do the modifiers on a claim line come from?

Each insurance line gets up to four, in this order: the payer's own modifier for the service, the rendering provider's credential modifier (HO, HN, HM or HP), then the payer's place-of-service modifier. A payer can switch the credential modifier off in Claims Settings, and self-pay invoices carry none. [More: Billing and claims](billing-and-claims.md#line-modifiers-same-day-merge-and-claim-splitting)

### Can I use the CMS-1500 PDF as it is?

Treat it as a printable draft and check it first. Program, group number, plan ID, other coverage and service facility now come from the payer and client records, but the member ID and authorization number are still placeholder values, and the footer note mentions an electronic filing the app does not perform. [More: Billing and claims](billing-and-claims.md#cms-1500-pdf)

### How do I rebill, void or write off a claim?

A Denied claim can be rebilled: tick the disputed lines to send back to staging and the original is voided and replaced by a new draft ending in -R and a number. A Draft or Submitted primary claim can be voided, which returns its lines to staging. A Denied claim can also be written off, which posts an adjustment for the open balance. [More: Billing and claims](billing-and-claims.md#denial-rebill-void-write-off)

## Payments and ERA

### How do I post an ERA?

1. Open Billing, Payment Center and press Upload ERA (835).
2. Choose a `.835` or `.txt` file (up to 2 MB). It is read in your browser and never uploaded.
3. Review the preview, tick the eligible lines and press Post selected and park the rest.

The toast reports how many were posted and how many parked. [More: ERA and payments](era-and-payments.md#workflow-import-an-835-era)

### Why was an ERA line parked?

A line posts only when it matches exactly one submitted or partially paid primary claim with no active secondary, the payer, charges, dates and patient share agree, and the amount fits the open balance. Anything else parks with its reason, such as no or ambiguous match, a secondary claim, service-line detail or a payer name mismatch. Open the ERA later and use Retry parked lines. [More: ERA and payments](era-and-payments.md#workflow-import-an-835-era)

### How do I record a check or EFT by hand?

Press + Manual Payment, choose Payer remittance on open claim, pick the claim, method, amount, adjustment, date and a reference number. The claim becomes Paid, or Partially paid if a balance remains, and one Undo reverses the posting. [More: ERA and payments](era-and-payments.md#workflow-record-a-payer-remittance-by-hand)

### Can I undo a posted ERA after reloading?

No. Undo keeps the last 25 steps in this browser tab's memory only, so a reload or a second tab starts with none. A payment that came from an ERA also cannot be voided on its own. If you need it reversed later, restore a backup taken before the posting. [More: ERA and payments](era-and-payments.md#workflow-void-a-payment)

### How do I record a family's payment?

Press + Patient receipt, or Record receipt from a client's drill-down in the AR Manager. The amount is capped at the reported patient share still open, and a unique reference is required. Choosing Card only records that you took a card payment elsewhere; the app never charges a card. [More: ERA and payments](era-and-payments.md#workflow-patient-receipt)

### How do I handle secondary insurance?

Open Billing, Secondary Queue. A partially paid primary with a balance and active secondary coverage can get a COB draft, and Record external filing notes how you filed it. The app does not file the secondary for you; its history reads "not transmitted by Aloha". [More: ERA and payments](era-and-payments.md#secondary-queue-cob)

## A/R

### What counts as A/R?

Open primary claims that are not drafts or voids and have a balance: charges less adjustments, payer payments, and secondary and patient receipts. A secondary claim is a filing of the same receivable, so it is never counted twice. [More: Accounts receivable](accounts-receivable.md#ar-manager)

### Why do the dashboard and the AR Manager show different days in A/R?

They use two different formulas. The AR Manager divides open A/R by charges with a date of service start in the last 90 days, drafts included. The Billing Health tile uses charges whose service end falls in the last 90 days, drafts excluded. [More: Architecture](architecture.md#known-doccode-mismatches)

### How do I give a family a statement?

Open Billing, Generate Invoice, pick the clients, tick Patient share only if you want just the reported patient balance, and press Download draft statement. You get a text file named Patient-share-draft with the date. Print it or hand it over yourself, because the app does not mail or email it. [More: Accounts receivable](accounts-receivable.md#generate-invoice-draft-patient-statement)

## Payroll

### Where do pay hours come from?

From the calendar. Every non-cancelled appointment in the period counts, priced by type (service, supervision, evaluation, drive), using scheduled start and end times rather than a clock-in. Supervisors can add manual adjustments. [More: Payroll](payroll.md#running-a-cycle)

### Why can't I approve this pay run?

A blocker stops approval and processing. Blockers include a period that already has a run, duplicate payroll IDs, a missing profile or rate, negative net pay, no employees selected, or an overtime multiplier below 1.5. Warnings, such as an unapproved timesheet, are shown to the approver and recorded. [More: Payroll](payroll.md#exception-gates)

### Does Aloha pay my staff or file payroll taxes?

No. It builds the register, stubs and files (including a QuickBooks-style CSV and a draft bank-shaped file) for you to download and hand to your payroll provider or bank. Withholding is an editable estimate table, not tax advice or a filing. [More: Payroll](payroll.md#files-you-can-build)

## Reports and dashboard

### How do I export a report?

Open Reports (key `6`), run the report, and use Export for CSV, XLS or PDF. The file downloads to your computer; nothing is emailed and no report runs on a schedule. [More: Dashboard and reports](dashboard-and-reports.md)

### What is Billing Health?

A dashboard widget with eight revenue-cycle tiles computed from this workspace's claims and payments: clean claim rate, denial rate, net collection rate, cash posted, days in A/R, A/R over 90 days, charge lag and recouped. Each tile shows its formula and target on hover. They are arithmetic over your own ledgers, not a benchmark. [More: Dashboard and reports](dashboard-and-reports.md)

### Why does Reports warn that same-day sessions bill different units?

For a payer that turned off merge same day, rounding each session on its own can bill a different total than counting the day once. Turn merge same day back on in the payer's Claims Settings, or correct that day's units. Payers with the default setting are merged on the claim, so they do not trigger it. [More: Dashboard and reports](dashboard-and-reports.md)

## Settings

### How do I add a denial reason or a remittance code?

Open Settings, System, Billing Settings. Add or edit rows under Denial reasons (offered when you mark a claim denied) or Remittance code hints (what an ERA code such as CO-197 means and what to do), then press Save reasons and hints. Codes must look like CO-197, and at least one denial reason must remain. [More: Settings](settings.md)

### Where do I set a payer's billing rules?

Open Masters, Payers, choose the payer, and use the Billing Rules tab. It holds provider ID rule, claims settings (merge same day, credential modifiers, separate claim by, box 32), place-of-service modifiers, daily and weekly unit limits, and payment terms. [More: Settings](settings.md#payer-billing-rules)

### How do I import clients or staff from a CSV?

Open Settings, Data Import, pick a type, choose a file or paste text, check the column mapping and review the preview. Nothing is written unless every row validates, and the commit is one Undo step. The limit is 500 rows per file, and only fictional data belongs in it. [More: Settings](settings.md#data-import)

### How do I limit what a staff member can see or change?

Open Settings, Security, give the staff member an account with a role and one or more offices. This is a local demo of access control, not real authentication: there are no passwords, and anyone using the browser can switch account. [More: Security, Undo and backup](security-undo-backup.md#security-accounts-and-roles)

## Data, backup and Undo

### Where is my data stored?

In this browser's localStorage under the key `aloha-aba.v3`, on this computer only. Clearing the site's data erases it, and another browser or device starts empty. A backup file is the only way data leaves the browser. [More: Security, Undo and backup](security-undo-backup.md#backup-and-restore)

### How do I back up my data?

Open Settings, System, Data & backup and press Export workspace (.json). The file `aloha-aba-backup-<date>.json` holds every durable collection but not Undo history. It is not encrypted, so store it with care. [More: Security, Undo and backup](security-undo-backup.md#backup-and-restore)

### How do I restore a backup?

In the same screen, press Restore backup and choose the file. Aloha validates it and shows a preview of counts, and nothing changes until you press Replace workspace. A restore replaces the whole workspace and is one Undo step. [More: Security, Undo and backup](security-undo-backup.md#backup-and-restore)

### How does Undo work?

Press `U` (not while typing in a field) or use the Undo button on a toast. Each action is one step, so assembling claims or posting an ERA reverses in one press. It holds the last 25 steps in this tab only, and some changes, such as plain settings patches and payer edits, take no snapshot. [More: Security, Undo and backup](security-undo-backup.md#undo)

### What does the "Changes aren't saved" alert mean?

The browser refused to write to storage, usually because it is full or unavailable. Until a later save succeeds, your edits exist only in this tab's memory, so export a backup before closing the tab. [More: Security, Undo and backup](security-undo-backup.md#storage-full-alert)

### Can my whole team share one workspace?

No. The workspace lives in one browser on one computer, and there is no sync between users, browsers or devices. A backup file can be restored on another browser, but that is a copy, not a shared workspace. [More: Wiki home](README.md)
