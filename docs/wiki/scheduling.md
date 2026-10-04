# Scheduling

_Sources: src/lib/authBudget.js, src/lib/authUnits.js, src/lib/bookingChecks.js, src/lib/risk.js, src/lib/insights.js, src/lib/cancelReasons.js, src/lib/smart.js, src/lib/abaHours.js, src/lib/settingsMasters.js, src/lib/model.js, src/components/AppointmentModal.jsx, src/components/BookingChecks.jsx, src/components/SchedulerInsights.jsx, src/components/NeedsCover.jsx, src/components/CommandPalette.jsx, src/components/KeysHelp.jsx, src/components/DetailCard.jsx, src/components/QuickAdd.jsx, src/components/TimeGrid.jsx, src/components/TimelineView.jsx, src/components/MonthView.jsx, src/components/AgendaView.jsx, src/components/settings/SystemPanel.jsx, src/App.jsx, docs/specs/scheduling-intelligence-ideas.md_

_Last synced with main at e434bb7 on 2026-10-04._

[Wiki home](README.md) · Related: [Settings](settings.md), [Dashboard and reports](dashboard-and-reports.md), [Payroll](payroll.md)

## User guide

### The calendar

The Calendar section has five views, switched from the top bar or with a key: Day (`D`), Week (`W`), Timeline (`H`), Month (`M`) and Agenda (`G`). `T` jumps to today and the arrow keys move the anchor. `N` or `A` opens the booking picker. `?` lists every shortcut and `U` undoes the last change. Cmd/Ctrl+K opens the command palette: jump to a section, run a report, find a client or staff member, or open the needs-cover inbox.

Dragging on the Day or Week grid opens **Quick Add** (client, service, then book). It shows time clashes but runs none of the authorization or practice-rule guards below; use **More options** to get the full dialog with the Checks rail.

Staff, client and team selectors filter what the calendar shows. They do not change what is saved.

### Booking an appointment

Open the picker (`N`, the `+` button, or click an empty slot), choose a type (service, evaluation, supervision, drive, break, unavailable), and the booking dialog opens. The left side is the form. The right side is the **Checks rail**, one panel that replaces the old stacked banners. It re-evaluates on every change.

Severity language is shared across the whole app:

| Glyph | Meaning | What you do |
|---|---|---|
| Stop sign | Must fix | Save is refused until it is resolved or the practice relaxes the rule |
| Caution | Review | Read it; you can still save |
| Flag | Noted | Recorded and shown; no action needed |
| Pencil | To fill in | A required field is still empty (turns into Stop sign after a failed save attempt) |
| Check | Clear | Nothing in the way |

The rail shows these groups, worst first:

- **Still to fill in / Fix to save.** Required fields: date, end after start, staff, client, required custom fields, a required note for some statuses, and a cancellation reason when the status counts as a cancellation.
- **Time clash.** The staff member or client already has an overlapping booking. Always a caution; you can still save and the booking is flagged on the calendar.
- **Authorization.** One verdict per client on the booking, worst first (see below).
- **Cancellation risk.** A score out of 100 with its top factors. Shown only for Watch and High. It is a prompt to confirm, never a reminder sent.
- **Practice rules.** Your Settings > System > Appointment Validations (qualification, overlap, missing NPI, pay rate, ABA hours, and so on).

**Know before you pick.** Every person in the staff and client pickers carries a verdict chip ("Busy 9:00-10:30", "Credential", "Over authorization") so you can see what adding them would trigger before you add them. The full sentence shows on hover. Nothing appears until the slot has a date and time.

### Guard modes: off, flag, warn, stop

Two independent mechanisms use these words.

**Authorization guard** (Settings > System Settings > Authorization guard). The mode caps how loud an authorization or payer-rule finding may get.

| Mode | Behavior |
|---|---|
| Off | No authorization checks on the calendar. Claim staging still validates separately. |
| Flag | Findings are recorded quietly as a flag; the booking saves as usual. |
| Warn | **Default.** Findings show as caution or flag; the booking still saves. A would-be Stop is capped to caution. |
| Stop | A booking that spends past the authorization, or falls after its end date, is refused. |

Stop is a choice the practice makes on purpose. Nothing hard-blocks by default.

**Appointment Validations** (Settings > System Settings > Appointment Validations). Each rule is set to None, Flag, Warn or Stop independently. A rule set to Stop refuses the save regardless of the authorization guard mode.

What the authorization findings mean:

- **No authorization window on file** (flag): hours cannot be verified. Record the window.
- **After the authorization ends** (would-be stop): the session would not be payable as scheduled.
- **Spends past the authorization**: committed hours exceed the hours on file. Stop at or above the block percentage in Stop mode, otherwise caution.
- **N% committed** (caution): at or above the warn percentage (default 85).
- **Over the weekly hours**: more hours booked in the week than the authorized week.
- **Expires soon**: a flag at the renewal-alert days (default 30), a caution inside the urgent days (default 14).
- **Units, per code**: a code not on the authorization, or committed units over or near the per-code pool. The session's units are shown ("4 units of 97153, 30-min units, AMA rounding").
- **Payer limits**: the payer's per-code daily, all-code daily and per-code weekly maximum units (set under Masters > Payer > Billing Rules > MUEs).
- **Credential**: the booked staff member's credential cannot render the code, or is not one the payer lists for that service.
- **Advisory notes** (never escalate): projected exhaustion date at the current pace, and under-paced delivery.

The authorization window total is weekly hours times weeks on file. It is an estimate of the pool, not a statement of units a payer granted. Check the units against the payer letter.

### Cancelling and skipping

On the detail card, **Cancel** (or **Skip occurrence** for a series) asks for a reason from the practice's Cancellation reasons custom list instead of cancelling immediately. In the form, any status that counts as a cancellation requires a reason. A reason naming staff, a clinician, scheduling or the practice is practice side; everything else is the family's side. Practice-side cancels are excluded from a family's risk history. Reports > Operations > Cancellation Root Cause groups them (see [Dashboard and reports](dashboard-and-reports.md)).

### Needs cover

The needs-cover inbox lists cancelled sessions in the visible range that a qualified, free staff member could take. Each shows ranked candidates with the reasons (care team, history with the client, program fit, load, turnaround). Assigning one reactivates the session with the new staff member as a local change. It does not notify anyone.

### Scheduler Insights

Open it from the calendar toolbar or with `I`. It is scoped to the range on screen and has three tabs:

- **Coverage.** Four KPIs (schedule fill against a labelled 85-95% band, open capacity, authorizations needing action, at-risk sessions), a weekday-by-hour heat grid, and named idle windows per clinician that click through to that day and person.
- **Authorizations.** Burn-down per client: committed against authorized hours, this week against the authorized week, days to expiry, projected exhaustion, with a needs-action or all-clients toggle.
- **At risk.** The riskiest sessions with score, factors, recommended action, **Open** and **Confirm**. Confirm marks the session confirmed locally (one Undo). No reminder is sent to the family.

Risk factors are labelled `history` (learned from this workspace's resolved appointments) or `policy` (a documented rule such as short lead time, unconfirmed, backfilled, first session with a technician).

### ABA Hours

The ABA Hours checkbox exists on non-service appointments only. It marks behavior-analytic staff time for credential tracking (RBT, BCAT, graduate student, state certification). It has nothing to do with client authorizations. The Appointment Validations group `aba` enforces this (service appointments carrying the flag are a Stop by default).

## How it works

### Write path

Calendar writes are plain reducer actions, not plan-then-Tx. `createActions` in [store.jsx](../../src/state/store.jsx) exposes `create`, `update`, `move`, `remove` and `removeSeries`, which dispatch `upsertMany`, `patch` and `deleteMany`. Each takes one Undo snapshot of `appts`. `src/lib/security.js` maps all three to the `calendar` area. There is no `plan*` for appointments.

Consequence: the Stop-level guards live in `AppointmentModal.save`, not in the reducer. The modal refuses when `errors` is non-empty (including `STOP` validation items) or when an authorization check is `blocked`. Quick Add (`actions.create`), drag-moves and `actions.update` calls (NeedsCover, Insights Confirm, DetailCard) do not re-run the guards.

### Modules

- [authBudget.js](../../src/lib/authBudget.js): hours guard. `authGuardCfg`, `AUTH_MODES`, `consumesAuth`, `clientAuthWindow`, `authBurn`, `authBand` (`AUTH_BANDS`), `authCheckFor` (returns `{severity, blocked, headline, reasons, notes, stats}`), `authBoard`. Mode caps severity at the end of `authCheckFor`.
- [authUnits.js](../../src/lib/authUnits.js): per-code unit ledger and payer rule pack. `unitsFor` (rounding), `unitRuleFor` (payer service override, then payer service, then service master, then code default; AMA default), `apptUnits`, `unitLedger`, `unitCheckFor`, `mergeAuthChecks(hours, units, settings)` (folds both verdicts under the same mode cap), `normalizeAuthUnits`, `seedAuthUnits`, `poolFromWeeklyHours`. Kept separate from `authBudget.js` to avoid an import cycle through `master.js`.
- [bookingChecks.js](../../src/lib/bookingChecks.js): `candidateVerdicts(state, draft, kind, opts)` returns `{personId: {tone, label, detail, count}}`; `authChip`, `TONE_RANK`.
- [risk.js](../../src/lib/risk.js): `riskModel`, `riskFor`, `riskQueue`, `riskOf`, `riskCfg`, `RISK_BANDS`. Settings key `settings.risk`; no Settings panel edits it, so defaults apply.
- [insights.js](../../src/lib/insights.js): `coverageBoard`, `insightBoard`, `forwardDays`.
- [cancelReasons.js](../../src/lib/cancelReasons.js): `cancelReasonOptions`, `cancelSide`, `isPracticeCancel`, `reasonPatch`, `cancelReasonRows`, `seedCancelReason`. Appointments store `cancelReasonId` and `cancelReason`.
- [smart.js](../../src/lib/smart.js): `suggestStaff`, `scanNeedsCover`, `backfillFor`, `smartCfg` (weights for team, history, fit, load under Settings > System Settings > Smart scheduling).
- [abaHours.js](../../src/lib/abaHours.js): `countsAsAbaHours` is the single predicate; also `abaStaffRows`, `abaTotals`, `normalizeAbaHours`.
- [settingsMasters.js](../../src/lib/settingsMasters.js): `DEFAULT_APPOINTMENT_VALIDATIONS` (groups `staff`, `client`, `payer`, `aba`), `appointmentValidationsCfg`, `evaluateAppointmentValidations` returning `{items, stops, warns, flags}`.

### Components

[AppointmentModal.jsx](../../src/components/AppointmentModal.jsx) builds `checkGroups` and feeds [BookingChecks.jsx](../../src/components/BookingChecks.jsx) (`BookingChecks`, `ToneGlyph`, `VerdictChip`, `TONE_ICON`). Views: `TimeGrid.jsx` (Day and Week), `TimelineView.jsx`, `MonthView.jsx`, `AgendaView.jsx`; `App.jsx` owns the key handlers and the visible range. Also `NeedsCover.jsx`, `SchedulerInsights.jsx`, `CommandPalette.jsx`, `QuickAdd.jsx`, `KeysHelp.jsx`.

### State, permissions, migrations

- Fields: `appts` (map by id), client `authStart`, `authEnd`, `authWeekly`, `authUnits`; `settings.authGuard`, `settings.smart`, `settings.risk`, `settings.appointmentValidations`.
- `setSettings` with `authGuard` or `risk` keys routes to the `calendar` permission area (schedulers own it), not `settings`.
- `normalizeWorkspace` in store.jsx runs `normalizeAuthUnits` (converts weekly hours to per-code units, flagged "converted, verify") and `normalizeAbaHours` (strips the flag from service appointments, records `meta.abaHoursStripped`). Both are idempotent.
- Undo history is tab-local, 25 steps, never persisted.

### Tests

`authBudget.test.js`, `authUnits.test.jsx`, `bookingChecks.test.jsx`, `schedulingRisk.test.js`, `schedulerInsights.test.js`, `schedulerInsights.test.jsx`, `cancelReasons.test.js`, `smart.test.js`, `abaHours.test.js`, `abaHoursUi.test.jsx`, `settingsMasters.test.js`, `app.test.jsx` (detail-card cancel flow), `palette.test.jsx`.

## Not yet built

From the status column of `docs/specs/scheduling-intelligence-ideas.md`:

- Not built: density optimiser (B2), travel feasibility and route sequencing (B3, deferred), access holdout (B4), calibrated overbooking guidance (C4), caseload ramp forecast (D1), hire/contract decision support (D2), intake-to-first-session handoff (D3), scenario planner (D4).
- Partly built: renewal watchlist has alerts and projected exhaustion but no packet builder (A3); credential check at booking exists but is not credential-aware density (B5); continuity exists only as a risk factor (C2); supervision ratio is a report, not a booking guard (C5); re-assessment is a report (C6).

Honest limits:

- Nothing is sent. Confirming a session, assigning cover or recording a cancellation reason changes local records only. No SMS, email or reminder goes to a family.
- Appointment guards run in the booking dialog, not the reducer, so Quick Add, drag-moves and other non-dialog edits bypass them (see the write path).
- The authorization window is an estimate (weekly hours times weeks). `BILL_CODES` use 30-minute units where real 97153 units are 15 minutes; correct this per payer in the service override. Payer credential rows keyed by education level cannot drive a check because staff have no education field.
- Risk configuration (`settings.risk`) has no Settings panel.
- Known issue from the handoff: `staffSatisfiesQualification` may flag BCBAs on BCBA-only codes.
- An intake conversion does not copy approved units into the new client's pool (see [Intake](intake.md)).
- ABA Hours credits a block whole to everyone on it, from scheduled times rather than a clock-in.
