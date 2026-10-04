# Payroll

_Sources: src/lib/payroll.js, src/lib/payrollExport.js, src/components/payroll/PayrollCommon.jsx, src/components/payroll/PayrollCycleView.jsx, src/components/payroll/ProcessPayrollView.jsx, src/components/payroll/ReviewRegisterModal.jsx, src/components/payroll/PayRunsView.jsx, src/components/payroll/PayrollIdMappingView.jsx, src/components/payroll/PayrollSummaryView.jsx, src/components/payroll/PayrollSetupView.jsx, src/components/payroll/TimesheetSubmissionView.jsx, src/components/payroll/QuickBooksPayrollView.jsx, src/components/settings/PayrollPanel.jsx, src/lib/settingsMasters.js, src/state/store.jsx, src/lib/security.js_

_Last synced with main at 50db57a on 2026-10-04 (plus credentials and PDUs)._

[Wiki home](README.md) · Related: [Scheduling](scheduling.md), [Settings](settings.md), [Dashboard and reports](dashboard-and-reports.md)

## User guide

Payroll turns the calendar into pay. Every number is derived from appointments, a pay profile per staff member and the practice's pay policy. **Nothing is paid, filed or transmitted.** The module builds files (register, provider import, journal, bank-shaped draft, stubs) that the practice downloads and hands to its payroll provider or bank. Tax withholding is an editable estimate table, not tax advice or a filing engine. Money is stored in integer cents.

Open **Payroll** in the sidebar (key `9`). The sub-screens:

| Screen | What it is for |
|---|---|
| Cycle Overview | Landing page: which cycle, how far through the four phases, what blocks it, links to every step |
| Process Payroll | The four-phase run wizard |
| Pay Runs | Register of runs: read, reprint, download stubs and files |
| Payroll ID Mapping | Master data: who is included, payroll ID, rate, classification, office |
| Payroll Summary | Read-only cost of a period by office, earning code and employee, plus cost per delivered clinical hour |
| Timesheet Submission | Per-employee timesheets: submit, approve, return, reopen, adjust, print |
| QuickBooks Payroll | Local builder for a QuickBooks-style earnings CSV (no connection) |
| Payroll Setup | Pay policy: frequency, workweek, overtime, rounding, cancellation table, approvals, tax tables |

### Running a cycle

1. **Timesheets.** Hours come from the calendar: every non-cancelled appointment in the period for that staff member, priced by appointment type (service = REG, supervision = SUP, evaluation = EVAL, drive = DRIVE). Admin, training, PTO and holiday blocks map to their own codes; breaks and plain unavailable blocks do not pay unless policy says so. Pay hours come from scheduled start and end, not a clock-in. Supervisors add manual **adjustments** (admin, training, PTO, holiday, bonus, mileage, expense). A timesheet moves open, submitted, approved (or returned). When "separate approver" is on, whoever submitted cannot approve. An approved timesheet must be reopened deliberately.
2. **Select period.** Pick the cycle. Eligible staff are those marked included in Payroll ID Mapping.
3. **Review register.** Gross-to-net per employee plus the **exception gates**. A run with a blocker cannot be approved or processed; a warning is shown to the approver and recorded.
4. **Approve.** A second person signs. The preparer cannot approve their own run when "separate approver" is on.
5. **Process and pay.** The register is **re-priced from the live ledgers** at that moment, locked, and the stubs and files are released. A processed register is immutable; corrections are off-cycle adjustments, and voiding a locked run needs an explicit reversal. Processing is the only path that writes year-to-date history (used for Social Security and unemployment wage caps).

Every step above is one undoable change.

### Exception gates

| Level | Condition |
|---|---|
| Blocker | A pay period already has a run; duplicate payroll IDs; no payroll profile; no hourly rate or no salary; negative net pay; no employees selected; overtime multiplier below 1.5 |
| Warning | No payroll ID; exempt not yet reviewed; no work state; timesheet not approved (when required); no payable time; visits missing EVV evidence (non-exempt, past visits only); average pay below the federal minimum wage; time rounding is on (it may not consistently favour the employee) |

Review Register lets you jump to the affected employees and exclude one from a draft run.

### Overtime and earning codes

Overtime is a **workweek** test, not a pay-period test. Worked hours are bucketed by the practice's workweek start (default Monday). Hours past the weekly threshold (default 40) earn a premium at (multiplier minus 1) times the **regular rate**, where the regular rate is that week's straight-time pay plus any nondiscretionary additions (such as nondiscretionary bonuses) divided by hours worked. Only profiles classified non-exempt accrue the premium; exempt and contractor profiles do not. An office can carry its own weekly threshold under Settings > Payroll > Overtime Rules. The multiplier cannot go below 1.5, the federal minimum.

Cancelled sessions follow the **cancellation decision table** (Payroll Setup): free-notice band in hours, percentage paid for short notice, for a no-show or door cancellation, and for unknown notice. Earning codes (REG, SUP, EVAL, DRIVE, ADMIN, TRAIN, CANC, OT, PTO, HOL, BONUS, BONUSX, MILE, EXP and any the practice adds) carry flags: overtime-eligible, part of the regular rate, taxable, nondiscretionary. Mileage and expense are non-taxable reimbursements. Edit them under Settings > Payroll > Earning Code (see [Settings](settings.md)). A code in use, or one the engine reads, is deactivated instead of deleted.

Behavior-analytic hours (ABA Hours, see [Scheduling](scheduling.md)) ride along on timesheet lines and are tallied separately. They never change a code or a rate.

### Files you can build

From Process Payroll, Pay Runs or QuickBooks Payroll. Each download is also recorded as an export record with its run, so there is an audit trail of what was handed off:

- Payroll register as CSV, XLS or PDF.
- QuickBooks-style earnings and tax CSV (keyed by payroll ID).
- GL journal CSV and deductions CSV.
- Printable pay stubs and printable timesheets (HTML).
- An ACH-shaped file. It is a **local draft**, labelled as such, built from placeholder bank details; it is not bank-validated and is not meant to be uploaded as is.

## How it works

### Engine

[payroll.js](../../src/lib/payroll.js) is pure (no React, no network, cents throughout):

- Periods: `PAY_FREQUENCIES`, `periodsFor`, `periodFor`, `periodFromId`, `workweeksOf`.
- Profiles and rates: `defaultProfile`, `seedPayProfiles`, `profileFor`, `duplicatePayrollIds`, `rateFor`, `CLASSIFICATIONS`, `PAY_TYPES`.
- Time capture: `scheduleLines`, `adjustmentLines`, `timesheet`, `applyRounding`, `evvStatus`, `isEvvVerified`, `lineTotals`.
- Pricing: `earningsFor` (salary baseline, per-session pay, grouped straight-time rows, reimbursements, derived weekly OT), `federalEstimate`, `grossToNet`, `ytdCents`.
- Runs: `runGate` (blockers and warnings), `computeRun`, `runTotals`, `runBreakdown`, `newRun`, `nextRunNo`, `RUN_STATUSES`.
- Transactions: `planSheet` (submit, approve, reject, revert, adjust, removeAdjustment) and `planRun` (create, preview, submit, approve, process, void, exclude, include, reopen).
- Reports: `stubFor`, `annualSummary`, `contractorReview` (flags contractors for review; classification is a counsel decision).
- Policy defaults: `defaultPayrollSettings` (biweekly, Monday workweek, 40-hour threshold, 1.5x, rounding none, approvals, cancel policy, tax tables, GL accounts) and the earning-code resolvers `earningCodesFor`, `earningIndex`, `earningLabel`.

[payrollExport.js](../../src/lib/payrollExport.js) only builds files: `registerRows`, `registerCsv`, `registerSpec` (feeds the XLS/PDF kit), `qboRows`, `qboCsv`, `deductionRows`, `glJournalRows`, `achFile`, `stubHtml`, `timesheetHtml`, `toCsv`, `payrollCsv`, `periodLabel`.

### Write path

Payroll follows action, then plan, then Tx:

- `createActions` in [store.jsx](../../src/state/store.jsx): `payrollSheet`, `payrollProfile`, `removePayrollProfile`, `createPayRun`, `payrollRun`, `recordPayExport`, `reviewPayExport`, `payrollSettings`.
- Each domain action calls the pure `planSheet` or `planRun` first and returns `{ok, msg}` for the toast, then dispatches `payrollTx` with `scope` (`sheet`, `profile`, `run`, `export`, `settings`).
- The `payrollTx` reducer **re-plans against live state** (`planSheet` / `planRun`) and applies the result, so a stale click cannot bypass the plan. Run creation uses `newRun`. One snapshot per transaction.
- Permissions (`src/lib/security.js`): `payrollTx` maps to the `payroll` area, or `payrollQbo` for QuickBooks exports. Payroll-owned settings stay behind the payroll area.
- Pay policy edits through Settings use `settingsTx` and `planSettingsOp`: `earningCode.upsert`, `earningCode.remove`, `payroll.general`, `payroll.defaults`, `payroll.overtime`, `payroll.officeOvertime` in [settingsMasters.js](../../src/lib/settingsMasters.js). They refuse a multiplier under 1.5, a weekly threshold outside 1 to 168 hours, an unknown rounding mode, and removing the last worked code.

### State

`payProfiles` (list), `paySheets` (keyed `staffId|periodId`), `payRuns`, `payExports` (maps), `settings.payroll`. All four collections are in `WORKSPACE_FIELDS` ([workspaceBackup.js](../../src/lib/workspaceBackup.js)). Run lines are a frozen copy at process time; the rest is derived live from `appts`. Undo history is tab-local (25 steps).

### Tests

`payroll.test.js` (engine: periods, OT, regular rate, cancellations, gates, lifecycle, exports), `payrollFlow.test.jsx` (navigation, the full wizard, segregation of duties, timesheets, ID mapping), `quickBooksView.test.jsx`, `reviewRegister.test.jsx`, plus the earning-code and overtime writes in `settingsWrites.test.jsx` and `settingsMasters.test.js`. Test ids use `pay-`.

## Not yet built

- **No payment, filing or connection.** No direct deposit, payroll provider API, QuickBooks sync or tax filing. Withholding is an editable estimate table; the Setup screen says it is not a compliance guarantee.
- **Daily overtime, double time and seventh-day rules are stored but not priced.** Settings accepts a daily threshold, a daily multiplier, a double-time threshold and per-office daily and seventh-day values, and Payroll Setup tells the user the engine prices weekly and office weekly rules only. `earningsFor` reads only the weekly threshold (`otAfterHours`, or an office's `weeklyOtHours`) and the multiplier. A state with daily overtime (such as California) is not covered.
- Pay is from the schedule, not clock-in or timesheet punches. EVV is read from the verification signature already on a completed visit; there is no separate time clock.
- The ACH file uses placeholder bank details unless set, and no real bank validation exists.
- The 1099-NEC review list only flags contractors; no 1099 or W-2 forms are generated.
- Void of a processed run needs an explicit reversal decision; there is no automated reversal or off-cycle run builder beyond adjustments.
