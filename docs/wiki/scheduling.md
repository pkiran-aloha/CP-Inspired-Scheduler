# Scheduling

_Last synced: 2026-10-08 (feat/reports-revamp and feat/reports-visuals checked: only Reports styles and chart tokens were added to src/styles.css, no scheduling change); fix/billing-icons on 2026-10-08 (fix/billing-icons only appended profile-avatar centring to src/styles.css, no scheduling change); feat/density-modes on 2026-10-08 (view density: relaxed, normal, tight); feat/copy-and-infotips on 2026-10-09 (copy pass, no em dashes, guidance behind InfoTips); chore/emdash-data on 2026-10-09 (the last stored values with em dashes, the appointment auto-title and export header lines now use plain separators; a workspace migration updates saved data and old backups)._

_Sources: src/lib/intakeHandoff.js, src/components/intake/IntakeHandoff.jsx, src/components/ClientsView.jsx, src/lib/authBudget.js, src/lib/authUnits.js, src/lib/bookingChecks.js, src/lib/pickFit.js, src/lib/locationSources.js, src/lib/railGlance.js, src/components/fields.jsx, src/lib/risk.js, src/lib/insights.js, src/lib/density.js, src/lib/overbook.js, src/lib/ramp.js, src/lib/hire.js, src/lib/cancelReasons.js, src/lib/smart.js, src/lib/abaHours.js, src/lib/travel.js, src/lib/settingsMasters.js, src/lib/model.js, src/lib/recurrence.js, src/components/RecurrenceEditor.jsx, src/state/store.jsx, src/components/AppointmentModal.jsx, src/components/BookingChecks.jsx, src/components/SchedulerInsights.jsx, src/components/NeedsCover.jsx, src/components/CommandPalette.jsx, src/components/KeysHelp.jsx, src/components/DetailCard.jsx, src/components/QuickAdd.jsx, src/components/TimeGrid.jsx, src/components/TimelineView.jsx, src/components/MonthView.jsx, src/components/AgendaView.jsx, src/components/settings/SystemPanel.jsx, src/App.jsx, src/lib/ics.js, src/components/StaffView.jsx, src/styles.css, docs/specs/scheduling-intelligence-ideas.md_

_Last synced against main a0142d0 plus the fix/workspace-persistence branch on 2026-10-08; feat/dashboard-landing on 2026-10-08 (Dashboard is the landing page, section keys renumbered); unrelated behavior unchanged._

[Wiki home](README.md) · Related: [Settings](settings.md), [Dashboard and reports](dashboard-and-reports.md), [Payroll](payroll.md)

## User guide

### Intake handoff

Converted intake requests and linked client profiles offer **Plan first week**. The [intake guide](intake.md) describes the proposal controls, ranked staff, authorization limits and reviewed booking. A proposal writes nothing. Each session opens the regular booking dialog and saves through a live-revalidated handoff transaction with one Undo; no recurring series or message is created.


### The calendar

The Calendar section (key `2`; the app opens on the Dashboard) has five views, switched from the top bar or with a key: Day (`D`), Week (`W`), Timeline (`H`), Month (`M`) and Agenda (`G`). `T` jumps to today and the arrow keys move the anchor. `N` or `A` opens the booking picker. `?` lists every shortcut and `U` undoes the last change. Cmd/Ctrl+K opens the command palette: jump to a section, run a report, find a client or staff member, or open the needs-cover inbox.

Dragging on the Day or Week grid opens **Quick Add** (client, service, then book). It shows time clashes but runs none of the authorization or practice-rule guards below; use **More options** to get the full dialog with the Checks rail.

Staff, client and team selectors filter what the calendar shows. They do not change what is saved.

### Calendar files for Apple and Google Calendar

Two `.ics` downloads exist. The top bar's **Export current range (.ics)** saves what the calendar shows. On the Staff Roster, each person's card (and the expanded table row) has a **.ics** button that saves that person's next 90 days of bookings (`staffCalendar` in [ics.js](../../src/lib/ics.js)). Import the file into Apple or Google Calendar. It is a file, not a subscription: nothing syncs, so download it again after the schedule changes. Cancelled bookings are marked cancelled. Client names are left out for roles that cannot open Clients.

### Booking an appointment

Open the picker (`N`, the `+` button, or click an empty slot), choose a type (service, evaluation, supervision, drive, break, unavailable), and the booking dialog opens. The left side is the form. The right side is the **Checks rail**, one panel that replaces the old stacked banners. It re-evaluates on every change.

**Location** is a search box with suggestions grouped by where they come from ([locationSources.js](../../src/lib/locationSources.js)):

- **Client**: the client's usual site (their chart's home location) and their street address on file, saved as `Home · street, city, state zip`. The "Home" word keeps place of service 12 and lets the travel check use the client's coordinates.
- **Staff**: where each picked staff member was just before: their latest session that ends by this start time on the same day ("After Ana's 9 AM"), else their most recent earlier stop. Cancelled sessions and drive, break and unavailable blocks are skipped.
- **Office** and **Telehealth**: the practice's active offices marked as locations in Settings > Organization (a payer that hides POS-10 still removes telehealth for its clients).

Type anything else and press Enter (or pick **Use "…"**) to keep it exactly as typed. Arrow keys move through the list. Under the field, **Open in Google Maps** opens a Maps search for the current value in a new tab: an office maps to its street address, the client's usual site to the client's address. The app never calls a map service: nothing is looked up, checked or sent, and the value is saved as typed. A typed address that is not an office is treated like any other unrecognized place: place of service 11 unless it says home, school, telehealth or community, and the travel check uses the client's coordinates unless it names a center, clinic or room.

When the location is a telehealth location (place of service 10) and the practice has saved its own video room link in Settings > Clinical Integrations > Telehealth room link, the dialog shows that link under Location. Calendar `.ics` exports put the same link on telehealth events. The app does not host, open or record video; the link is just the practice's own room.

Severity language is shared across the whole app:

| Glyph | Meaning | What you do |
|---|---|---|
| Stop sign | Must fix | Save is refused until it is resolved or the practice relaxes the rule. Enforced on every write path, including outside the dialog |
| Caution | Review | Read it; the dialog asks you to tick “I've reviewed these warnings” before saving (the acknowledgement is recorded on the session) |
| Flag | Noted | Recorded on the session as a badge and shown; no action needed |
| Pencil | To fill in | A required field is still empty (turns into Stop sign after a failed save attempt) |
| Check | Clear | Nothing in the way |

**How the rail reads.** From the top:

1. **Decision line.** One headline for the whole booking: *Fix before booking* (a stop item), *Review before booking* (a caution), *Almost there* (a required field is still empty), *Clear to book* (only notes) or *Ready to book*. Under it, a glyph count per severity ("2 to review", "1 noted").
2. **At a glance.** The numbers behind the checks, drawn small, each with its value in text (screen readers get it as a meter):
   - **Authorized hours** for the first client: a bar split into hours already delivered, hours booked (this session included) and hours left. When the booking goes past the authorization, the bar shows the overage and a mark where the cap is. A thinner bar under it shows this authorization week against the authorized week.
   - **Week load** for each picked clinician: hours this week after this booking against the target hours on their staff record, flagged when over.
   - **Chips:** the modelled cancellation risk (score out of 100 and band), the estimated drive from the clinician's previous appointment that day, and how many past sessions the clinician has had with the client (or "first session together").
3. **The checks.** Each group shows its headline and one line of why or what to do. The rest (more lines, the exact numbers, how it is worked out) sits behind **Details**. Required fields show in full, and practice rules show their first two items. Open slots are time chips you can click, and the warning acknowledgement tick always stays in view.
4. A one-line note at the bottom: everything is worked out on this device from the workspace's own data, and nothing is sent or booked until you save.

The rail shows these groups, worst first:

- **Still to fill in / Fix to save.** Required fields: date, end after start, staff, client, required custom fields, a required note for some statuses, and a cancellation reason when the status counts as a cancellation.
- **Time clash.** The staff member or client already has an overlapping booking. Always a caution; you can still save and the booking is flagged on the calendar.
- **Authorization.** One verdict per client on the booking, worst first (see below).
- **Cancellation risk.** A score out of 100 with its top factors. Shown only for Watch and High. It is a prompt to confirm, never a reminder sent.
- **This block usually loses a session.** A flag on a new service, evaluation or supervision booking whose weekday and time band is marked on the Overbooking tab: how many of the last weeks lost a session there, the share lost and the no-show share. It reminds you that an extra session belongs on a clinician who is free then, never as a second client on the same clinician. It never blocks the save and does not show when editing an existing session.
- **Practice rules.** Your Settings > System > Appointment Validations (qualification, overlap, missing NPI, pay rate, ABA hours, and so on).

**Know before you pick.** Every person in the staff and client pickers carries a verdict chip ("Busy 9:00-10:30", "Credential", "Over authorization") so you can see what adding them would trigger before you add them. The full sentence shows on hover. Nothing appears until the slot has a date and time.

**Pick fit.** Under each name the pickers also show what the workspace already knows, so you can choose the best person, not only a possible one:

- **Staff:** past sessions with the client (or **New to** the client), the hours they would have this week after this booking against the target hours on their staff record (flagged when over), and an estimated drive from their previous appointment that day (straight-line estimate, as in the travel check).
- **Clients** (clinical bookings): authorized hours already booked in this week against the authorized week (flagged when under the authorization guard's under-pace share), days to authorization expiry when inside the renewal window (otherwise the share used), and their usual weekday and time band over the last 8 weeks, marked when this slot matches it.
- **Best fit / Most hours open:** one badge on the strongest candidate nothing stands in the way of. For staff it is the top of the same ranking as **Suggested for this client** (Settings > Smart scheduling weights). For clients it is the one with the most authorized hours still open this week. The **A–Z / Ranked** switch in the list header puts clear candidates first, strongest first; the list opens A–Z.

**Schedule fit (Checks rail).** For a clinical booking, a flag group names (1) a picked clinician who has no past sessions with the client when someone else has had at least 3, and (2) a picked clinician who would go over their weekly target hours, naming a same-tier peer who is free then and under 75% of theirs. When the slot clashes, it lists up to 3 **open slots** in the next 7 practice days where everyone picked is free: inside the working day, from today on, nobody busy or blocked out, never a slot the clinician cannot reach from the neighbouring session (travel check), ranked by same day, closeness to the asked time, joining an existing block, and high cancellation risk last. Clicking a slot only changes the form's date and time; nothing is booked until you save. All of this is advisory and never blocks a save.

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
- **Units, per code**: a code not on the authorization, or committed units over or near the per-code pool. The session's units are shown ("4 units of 97153, 15-min units, AMA rounding").
- **Payer limits**: the payer's per-code daily, all-code daily and per-code weekly maximum units (set under Masters > Payer > Billing Rules > MUEs).
- **Credential**: the booked staff member's credential cannot render the code, or is not one the payer lists for that service.
- **Advisory notes** (never escalate): projected exhaustion date at the current pace, and under-paced delivery.

The authorization window total is weekly hours times weeks on file. It is an estimate of the pool, not a statement of units a payer granted. Check the units against the payer letter.

**How a session's units are counted.** The booking dialog's Billing tab, Quick Add and the one-click unit fix on the Billing desk's Blocked tab all count units with one rule chain (`unitRuleFor` then `unitsFor`): the payer's per-service override, the payer's own service, the service master, then the code default. The default is the Medicaid / CPT norm: 15-minute units for the ABA codes (97151 to 97158, 0362T, 0373T) and H2019, with the midpoint rule (a unit counts at 8 minutes or more; 38 minutes is 3 units, 37 is 2). 253MT stays at 30 minutes. A payer can set its own unit size and rounding (AMA, Nearest, Round Up, Round Down, Truncate). The Billing tab shows the rule it used, for example "45 min in 15-min units (AMA rounding) = 3 units x rate". A billing code picked by hand that differs from the service's own code ignores the service's unit rule and uses the code default. Because the authorization pool and the claim use the same rule, they agree.

### Repeating sessions

The booking dialog's **Repeats** picker offers the same quick picks as Google Calendar: Daily, Every weekday (Mon–Fri), Weekly on the chosen day, Every 2 weeks, Monthly on day N, Monthly on the Nth or last weekday, Annually. Any of them can then be customised:
- **Every** N days, weeks, months or years.
- **On** any set of weekdays (weekly).
- **Monthly** on the day of the month, the Nth weekday, or the last weekday.
- **Ends** never, on a date, or after N times.

A line under the picker says the rule in words (for example "Weekly on Mon, Wed until Dec 31, 2026"), how many sessions it books and the last date.

Honest limits, also shown in the picker:
- A series books **at most 12 months ahead**. "Never" means "for 12 months"; extend the series later.
- Monthly on the 29th–31st **skips months without that day**, as Google does. Annually on Feb 29 only lands in leap years.
- There is no holiday calendar. Dates on weekdays outside the practice's open days are named as a warning, never moved.

Every date is checked before it is booked: clashes, Stop rules and the authorization guard refuse that date (named with its reason), and warnings are listed in the result.

**Editing a series.** Edit asks what to apply the change to:
- **This occurrence**: only this session changes and becomes an exception (pencil badge). A dragged occurrence becomes an exception too and remembers its original date.
- **This & following**: the series splits here. Earlier sessions keep the old pattern and now end the day before.
- **All**: the whole series.

Changing only fields such as title, time, staff or notes copies the changed fields. Each session keeps its own other differences: status, verification, signatures, documents and billing state always stay with their session. A new date or repeat rule rebuilds the upcoming sessions from the rule. Single-session changes in that range are replaced, as in Google. "This occurrence" is disabled when the rule changes. Choosing "Doesn't repeat" for this & following ends the series at that session. Editing a single session's rule turns it into a series.

**Deleting and cancelling.** Delete and Cancel offer the same three scopes. Cancel first asks for the reason, then the scope. A series cancel affects only today and later sessions, because a past session's notice time would be invented. Cancelled sessions stay on the calendar with their reason and cancellation time.

**What a series change never touches.** Sessions that are completed, cancelled or no-show, billed or on a claim, or in an approved or processed pay period are kept as they are, and the result names how many were kept and why. A rebuild never creates or deletes sessions dated before today. Every scoped change is one transaction and one Undo.

### Cancelling and skipping

On the detail card, **Cancel** asks for a reason from the practice's Cancellation reasons custom list instead of cancelling immediately. In the form, any status that counts as a cancellation requires a reason. A reason naming staff, a clinician, scheduling or the practice is practice side; everything else is the family's side. Practice-side cancels are excluded from a family's risk history. Reports > Operations > Cancellation Root Cause groups them (see [Dashboard and reports](dashboard-and-reports.md)).

The moment a session enters a cancellation status, the app records the time (`cancelledAt`); reinstating the session clears it, and changing the reason keeps it. A no-show gets no time. Sessions cancelled before this was recorded keep no time; the app never guesses one.

### Needs cover

The needs-cover inbox lists cancelled sessions in the visible range that a qualified, free staff member could take. Each shows ranked candidates with the reasons (care team, history with the client, program fit, load, turnaround). Assigning one reactivates the session with the new staff member as a local change. It does not notify anyone.

### Scheduler Insights

Open it from the calendar toolbar or with `I`. It is scoped to the range on screen and has seven tabs:

- **Coverage.** Four KPIs (schedule fill against a labelled 85-95% band, open capacity, authorizations needing action, at-risk sessions), a weekday-by-hour heat grid, and named idle windows per clinician that click through to that day and person. **Access holdout** (Off, 10%, 15% or 20%; default 10%) keeps that share of each hour's bookable staff time, from today on, for new starts and same-day needs. The row says how many hours that reserves in the range and how many are already booked; hours where bookings eat into the reserve are outlined on the grid. Changing the share saves it for the practice (calendar permission). It warns only; it never stops a booking.
- **Density.** Same-day optimisation suggestions for future, unclaimed clinical sessions. A row says what to move, where it would land next to an existing block, how much split idle time or day span it saves, and whether any review warnings remain. **Move here** rechecks live staff/client conflicts plus Stop-level overlap/travel rules, then moves that one appointment locally with one Undo. It keeps the same staff, clients and length; it does not move separate Drive Time blocks, send messages, edit a series or call a map service.
- **Authorizations.** Burn-down per client: committed against authorized hours, this week against the authorized week, days to expiry, projected exhaustion, with a needs-action or all-clients toggle.
- **At risk.** The riskiest sessions with score, factors, recommended action, **Open** and **Confirm**. Confirm marks the session confirmed locally (one Undo). No reminder is sent to the family. A family cancellation that gave more notice than the practice's late-cancel threshold is not counted against that family, and a line above the list says how many family cancellations record their notice and how many were spared. Unknown notice is never guessed.
- **Travel.** Per-clinician day routes with legs, travel minutes, tight/impossible legs, totals and a read-only suggested re-order with miles saved. Nothing moves.
- **Overbooking.** Each weekday × time band (split by office when the practice has more than one) with its last 12 weeks: how many weeks had sessions, sessions, the share lost and the no-show share. A **Confidence threshold** picker (70 / 80 / 90, default 80, saved for the practice) sets the bar: a block reads **Room for one extra** (or two) only when both checks clear it: at least that many sessions were lost there in that share of its weeks, and the sessions already booked on its next day give at least the same odds of the same. A block with fewer than 8 weeks of history reads **Not enough history**; one that falls short says how many sessions a week it has and how many it would need. A marked block lists up to three **standby** families who are behind their authorized pace and have nothing in that block yet. **Show** opens the block's next day. Read-only: nothing is booked, moved or sent.
- **Ramp (D1) and hire/contract (D2).** The caseload ramp for the next 12 practice weeks (one row per week): authorized demand (each active client's authorized weekly hours for as long as the authorization window on the chart runs) plus open intake requests at their requested hours in a lighter band from their target date, against clinical supply. Supply is each clinician's working day minus blocked-out time on the practice days selected in System Settings (Monday–Friday by default), split RBT vs BCBA vs other clinical (non-clinical staff are left out). An authorization that ends inside the horizon drops to zero there and the week is marked **renewal pending**. A renewal is never assumed. Weeks where known demand exceeds supply are marked, and the header names the first one. A read-only **hire/contract** strip on the same tab answers “is this an hours gap or a template problem?” from those short weeks plus Coverage fill of the range on screen (85% is the high-fill bar). High fill with a short week → hours gap (hire or contract hours, never a headcount). Low fill with a short week → reshape the schedule first. No bookable hours on screen → it says it cannot tell. Read-only: nothing is booked, moved, hired or sent.

The ramp is a ramp, not a forecast: demand is only hours already on file (authorized hours plus intake requests at their requested hours), intake is never weighted by a conversion rate, and requests without recorded hours are counted as such rather than guessed at. An intake request whose authorization window is already underway or has no dates counts from this week, and the panel says how many of those there are.

Overbooking guidance never suggests a second client on the same clinician: 97153 is one client face to face, and overlapping sessions by one provider are not billable. An extra session belongs on a clinician who is free in that block. Guidance is per block, never a score for a family. Practice cancellations (staff illness and the like) are left out, and so is a family cancellation recorded with more notice than the practice's late-cancel threshold (`settings.billing.lateCancelHours`, 24 hours by default, in Billing → Setup), because the slot could be refilled. The risk model reads the same threshold, so "late" means one thing practice-wide. Cancellations from before the time was recorded still count as lost (the panel says how many are in the window), so the no-show share is the floor.

Risk factors are labelled `history` (learned from this workspace's resolved appointments) or `policy` (a documented rule such as short lead time, unconfirmed, backfilled, first session with a technician).

### ABA Hours

The ABA Hours checkbox exists on non-service appointments only. It marks behavior-analytic staff time for credential tracking (RBT, BCAT, graduate student, state certification). It has nothing to do with client authorizations. The Appointment Validations group `aba` enforces this (service appointments carrying the flag are a Stop by default).

### Travel feasibility and routing (B3)

A clinician cannot be in two places at once. Two slices shipped.

**Slice 1: booking dialog check.** When a booking has a previous or next session the same day for the same staff, the Checks rail shows whether there is enough time to get there.

- **Where coordinates come from:** client `geo` (`[lat,lng]`) for home, school and community sessions, plus optional `lat`/`lng` on Settings > Organization offices for center/clinic sessions (seeded for demo offices). Telehealth and unknown places are skipped, never guessed.
- **How the estimate is made:** straight-line haversine distance × 1.3 road factor at 25 mph plus a 5 min buffer. Honest copy everywhere: “estimated from straight-line distance × 1.3 road factor at 25 mph; not a map route”. No map API, no network.
- **What you see:** “Needs about 22 min from previous; gap is 10 min” (severity **impossible** when gap < travel) or “Tight turnaround: about 18 min from X to Y, gap 22 min” (severity **tight** when gap < travel+10). The booking can still be saved: the rule `staff.travel` defaults to **Warn** in Appointment Validations.
- **Know before you pick:** `candidateVerdicts` calls `evaluateAppointmentValidations`, so adding a staff member who would trigger a travel issue shows a chip in the picker before you add them.

**Slice 2: per-clinician day route view.** Scheduler Insights (I) has a **Travel** tab: for each staff per day in the visible range with 2+ sessions that have resolvable locations, it shows legs (from → to, gap, travel needed, distance, severity), totals (straight-line miles, travel minutes, tight/impossible counts), and a read-only suggested re-order (greedy nearest-neighbor) with miles saved. Nothing moves on the calendar.

- **Code:** `src/lib/travel.js` (`haversineMi`, `estimateTravelMinutes`, `resolveApptLocation`, `travelLeg`, `travelChecksForStaffDay`, `routeForDay`, `suggestRouteOrder`, `TRAVEL_DEFAULTS`). `SchedulerInsights.jsx` builds travelBoard per staff per day. Styles in `styles.css` (`si-travel`, `si-leg`). Tests: `travel.test.js`.

## How it works

### Write path

Calendar writes are mostly plain reducer actions, not plan-then-Tx. `createActions` in [store.jsx](../../src/state/store.jsx) exposes `create`, `update`, `move` and `remove`, which dispatch `upsertMany`, `patch` and `deleteMany`. Each takes one Undo snapshot of `appts`. Series changes follow plan-then-Tx: `actions.seriesTx(input)` plans with `planSeriesTx` in [recurrence.js](../../src/lib/recurrence.js), then dispatches `seriesTx`. The reducer re-plans against live state, reusing the plan's new ids, and applies upserts and deletes under one snapshot. `src/lib/security.js` maps all four to the `calendar` area; `seriesTx` also requires every member of the series and the edited draft to be within the account's office scope. `move` marks a dragged series occurrence `edited` and stamps `originalDate`.

Stop-severity validation rules are a write-time invariant in the reducer itself: `create`, `update` (scheduling writes only; completing, cancelling or billing a flagged session is never blocked) and `move` each evaluate the resulting draft with `stopViolationsForDraft` and refuse with `{ok:false, msg}` when a Stop rule trips, so the booking modal, Quick Add, drag-moves, series edits and CSV imports all land on the same guard. Flag-severity items are derived at save time and stored on the session as `validationFlags` (badges in DetailCard and the TimeGrid). The booking modal additionally refuses to save while unacknowledged warnings stand (a tick bound to the exact warning ids), and the authorization check stays dialog-level: the modal refuses when `errors` is non-empty or an authorization check is `blocked`.

The Density tab is the exception that adds a pure preflight before using the normal move action: `planDensityMove` in [density.js](../../src/lib/density.js) rechecks same-day eligibility, staff/client conflicts and Stop-level overlap/travel findings immediately before **Move here** dispatches `actions.move`.

### Modules

- [pickFit.js](../../src/lib/pickFit.js): pick fit. `staffFit` and `clientFit` (per-candidate `facts`, `score`; `candidateVerdicts` attaches them and marks `best`), `fitNotes` (continuity and caseload-balance lines), `openSlots` and `slotText` (open slots for everyone picked; reuses `suggestStaff`, `authBurn`, `travelChecksForStaffDay`, `riskFor`, `clinicianGroup`, `practiceDaysOf`). Tunables are constants: `FIT_LOOKBACK_WEEKS` 8, `USUAL_MIN` 3, `PEER_UNDER` 0.75, `SLOT_DAYS` 7, `SLOT_LIMIT` 3. Pure and read-only.
- [authBudget.js](../../src/lib/authBudget.js): hours guard. `authGuardCfg`, `AUTH_MODES`, `consumesAuth`, `clientAuthWindow`, `authBurn`, `authBand` (`AUTH_BANDS`), `authCheckFor` (returns `{severity, blocked, headline, reasons, notes, stats}`), `authBoard`. Mode caps severity at the end of `authCheckFor`.
- [authUnits.js](../../src/lib/authUnits.js): per-code unit ledger and payer rule pack. `unitRuleFor` (payer service override, then payer service, then service master, then code default; AMA default), `unitsFor` (rounding; the function lives in `model.js` and is re-exported here), `apptUnits`, `unitLedger`, `unitCheckFor`, `mergeAuthChecks(hours, units, settings)` (folds both verdicts under the same mode cap), `normalizeAuthUnits`, `normalizeUnitNorms` (one-time move of untouched 30-minute defaults to 15 minutes), `seedAuthUnits`, `poolFromWeeklyHours`. Kept separate from `authBudget.js` to avoid an import cycle through `master.js`.
- [bookingChecks.js](../../src/lib/bookingChecks.js): `candidateVerdicts(state, draft, kind, opts)` returns `{personId: {tone, label, detail, count}}`; `authChip`, `TONE_RANK`.
- [risk.js](../../src/lib/risk.js): `riskModel`, `riskFor`, `riskQueue`, `riskOf`, `riskCfg`, `RISK_BANDS`. Settings key `settings.risk`; no Settings panel edits it, so defaults apply. The model counts a session as lost when it was a no-show or any status that counts as a cancellation, except a family-side cancellation with more recorded notice than the shared threshold (`cancelNoticeHoursOf`); `model.notice` `{hours, cancellations, dated, early}` and `model.noticeNote` say how far that rule bites, and practice-side or reason-less cancellations keep behaving as before.
- [insights.js](../../src/lib/insights.js): `coverageBoard` (with `summary.holdout` `{pct, reservedHours, eatenHours, keptPct, eatenCells}` and per-cell `eatenHours`), `holdoutPctOf` (`settings.risk.holdoutPct`, 0–50, default `HOLDOUT_DEFAULT` 10), `insightBoard`, `forwardDays`; it also pulls in the density, overbooking, ramp and hire boards for the Scheduler Insights tabs.
- [hire.js](../../src/lib/hire.js): D2 hire/contract decision. `hireBoard({ ramp, coverage })` returns `verdict` `hire` | `reshape` | `neither` | `thin`, the on-screen fill against `HIRE_HIGH_UTIL` (85), and the first/peak short-week hours. Pure and read-only.
- [overbook.js](../../src/lib/overbook.js): C4 overbooking guidance. `overbookBoard(state, {today})` backtests each office × weekday × time band over the last 12 weeks (`overbookWeeks`), rates blocks with at least 8 weeks (`overbookMinWeeks`), and marks k = 1 or 2 when both the weekly backtest and the binomial odds (`atLeast(k, n, p)`, block rate shrunk toward the practice rate) reach `overbookSafePct`. Family cancellations whose `cancelLeadHours` exceed the practice's notice threshold (`cancelNoticeHoursOf(settings, overbookLateHours)`, read from `settings.billing.lateCancelHours`, 24 by default, whose only UI is the Billing → Setup row) are left out; `summary.early` and `summary.undated` count those left out and those with no time, and `cfg.lateHours` reports the effective threshold. Standby families come from `authBurn` band `under`. `overbookBlockFor(board, draft, office)` returns the marked block a future clinical draft falls in, for the booking dialog's flag (`appt-overbook`). Settings live in `settings.risk`; the tab's confidence picker (`si-ob-threshold`: 70/80/90, default 80, one `setSettings` write like the Coverage holdout picker) is their only UI, and `overbookSafePctOf` keeps any other stored value at 80. `sessionsNeeded(p, safe)` gives the block size a loss rate needs.
- [ramp.js](../../src/lib/ramp.js): D1 caseload ramp. `rampBoard(state, {today, weeks})` builds 12 practice-week buckets (honouring `settings.weekStart`) with `demandHours` (each active client's `authWeekly` for as long as `authStart → authEnd` runs; lapsed, discharged and inactive clients contribute nothing), `intakeHours` (open intake requests via `intakeWeeklyHours`, the assessment's recommended hours or else requested units over their window, from their target date, never weighted by a conversion rate), `supplyHours` (clinicians' working day minus blocked-out time on `settings.practiceDays` (default Monday–Friday), split by `clinicianGroup` into `rbt`/`bcba`/`other`), the balance, and the renewals ending in that week. `summary` carries the first short week. Read-only.
- [density.js](../../src/lib/density.js): B2 density optimiser. `densityBoard(state, days)` ranks same-day moves that pull future unclaimed clinical sessions next to an existing block and reports split idle/span savings; `planDensityMove` rechecks one move before the UI writes it.
- [cancelReasons.js](../../src/lib/cancelReasons.js): `cancelReasonOptions`, `cancelSide`, `isPracticeCancel`, `reasonPatch`, `cancelReasonRows`, `seedCancelReason`, `stampCancelledAt` (the `patch` and `upsertMany` reducer cases run every appointment write through it), `cancelLeadHours`. Appointments store `cancelReasonId`, `cancelReason` and, from 2026-10-06, `cancelledAt` (ISO time). No migration: an old cancellation's notice is unknown and stays blank. Restore refuses a `cancelledAt` that is not a date.
- [smart.js](../../src/lib/smart.js): `suggestStaff`, `scanNeedsCover`, `backfillFor`, `smartCfg` (weights for team, history, fit, load under Settings > System Settings > Smart scheduling).
- [abaHours.js](../../src/lib/abaHours.js): `countsAsAbaHours` is the single predicate; also `abaStaffRows`, `abaTotals`, `normalizeAbaHours`.
- [travel.js](../../src/lib/travel.js): travel feasibility and routing. `haversineMi`, `estimateTravelMinutes`, `travelLeg`, `resolveApptLocation` (office lat/lng or client geo, skips telehealth/unknown), `travelChecksForStaffDay` (prev/next), `routeForDay` (legs, totals, tight/impossible), `suggestRouteOrder` (greedy nearest-neighbor read-only with miles saved), `TRAVEL_DEFAULTS` (1.3×, 25 mph, 5 min buffer, 10 min tight).
- [recurrence.js](../../src/lib/recurrence.js): rule engine and series transactions.
  - Rules: `normalizeRule`, `expandRule(rule, start, {weekStart})` → `{dates, capped, cap}` (12-month `RECURRENCE_MAX_MONTHS` ceiling, start date always included), `describeRule`, `rulePresets`, `presetIdOf`, `retargetRule`, `ruleFromLegacy`, `ruleOf`.
  - Migration: `normalizeRecurrence`.
  - Locks and screening: `lockReason` (completed, cancel status, billed/claimed via `lineApptIds`, approved/processed pay sheet), `occurrenceChecks`/`screenOccurrences` (clash, Stop rules, `mergeAuthChecks`, warnings, closed practice days).
  - Transactions: `planSeriesTx` (edit / remove / cancel with scope `one` | `following` | `all`).
  - Occurrences store `seriesId`, `rrule` (`{freq, interval, byDay, monthBy, end, dtstart}`), `recurrence` (coarse legacy label), and on exceptions `edited` / `originalDate`. [RecurrenceEditor.jsx](../../src/components/RecurrenceEditor.jsx) is the picker.
- [settingsMasters.js](../../src/lib/settingsMasters.js): `DEFAULT_APPOINTMENT_VALIDATIONS` (groups `staff`, `client`, `payer`, `aba` plus `staff.travel`), `appointmentValidationsCfg`, `evaluateAppointmentValidations` returning `{items, stops, warns, flags}`.

### Components

[AppointmentModal.jsx](../../src/components/AppointmentModal.jsx) builds `checkGroups` and feeds [BookingChecks.jsx](../../src/components/BookingChecks.jsx) (`BookingChecks`, `ToneGlyph`, `VerdictChip`, `TONE_ICON`). Views: `TimeGrid.jsx` (Day and Week), `TimelineView.jsx`, `MonthView.jsx`, `AgendaView.jsx`; `App.jsx` owns the key handlers and the visible range. Also `NeedsCover.jsx`, `SchedulerInsights.jsx`, `CommandPalette.jsx`, `QuickAdd.jsx` (which now sets units from the same rule chain), `KeysHelp.jsx`.

### State, permissions, migrations

- Fields: `appts` (map by id), client `authStart`, `authEnd`, `authWeekly`, `authUnits`; `settings.authGuard`, `settings.smart`, `settings.risk`, `settings.appointmentValidations`.
- `setSettings` with `authGuard` or `risk` keys routes to the `calendar` permission area (schedulers own it), not `settings`.
- `normalizeWorkspace` in store.jsx runs `normalizeAuthUnits` (converts weekly hours to per-code units, flagged "converted, verify"), `normalizeUnitNorms` (once, flag `meta.unitNorm15`: untouched 30-minute services, their rates, authorization pools and unbilled appointments move to 15-minute units; claims are never touched) and `normalizeAbaHours` (strips the flag from service appointments, records `meta.abaHoursStripped`), and `normalizeRecurrence` (gives each legacy series a rule read from its old `recurrence` label: weekly, every 2 weeks or monthly on the day, from its first date until its last). All are idempotent.
- Undo history is tab-local, 25 steps, never persisted.

### Tests

`authBudget.test.js`, `authUnits.test.jsx`, `bookingChecks.test.jsx`, `schedulingRisk.test.js`, `schedulerInsights.test.js` (coverage + density), `schedulerInsights.test.jsx` (Insights tabs, density move, overbooking tab, ramp tab, hire strip), `overbook.test.js`, `ramp.test.js`, `hire.test.js`, `cancelReasons.test.js`, `smart.test.js`, `abaHours.test.js`, `abaHoursUi.test.jsx`, `travel.test.js`, `settingsMasters.test.js`, `recurrence.test.js` (rule engine, series transactions, locks, migration, backup), `recurrenceUi.test.jsx` (picker, rule rebuild, scoped delete/cancel, drag exception), `app.test.jsx` (detail-card cancel flow), `palette.test.jsx`.

## Not yet built

From the status column of `docs/specs/scheduling-intelligence-ideas.md`:

- Not built: scenario planner (D4).
- Shipped from the catalogue: access holdout on the coverage grid (B4), density optimiser (B2), calibrated overbooking guidance (C4, read-only), travel feasibility and route view (B3 Slice1+2), intake-to-first-week handoff (D3), the caseload ramp (D1, read-only), and hire/contract decision support (D2, read-only verdict on the Ramp tab).
- Partly built: renewal watchlist has alerts and projected exhaustion but no packet builder (A3); credential check at booking exists but is not credential-aware density (B5); continuity exists only as a risk factor (C2); supervision ratio is a report, not a booking guard (C5); re-assessment is a report (C6).

Honest limits:

- Nothing is sent. Confirming a session, assigning cover or recording a cancellation reason changes local records only. No SMS, email or reminder goes to a family.
- Appointment guards run in the booking dialog, not the reducer, so Quick Add, drag-moves and other non-dialog edits bypass the full guard stack (see the write path). The Density tab rechecks conflicts and Stop-level overlap/travel rules before its move, but it is still a same-day calendar edit, not a full booking-dialog review.
- The density optimiser moves only one appointment occurrence. It keeps the same staff, clients and duration; it does not move separate Drive Time blocks, infer family availability, edit a recurring template or optimize routes.
- The authorization window is an estimate (weekly hours times weeks). `BILL_CODES` now use the 15-minute Medicaid norm; a payer that bills a different unit length is set per payer in the service override. The unit migration scales a pool per code, not per payer, so a client whose payer sets its own unit size for a code keeps a pool in the wrong unit until someone fixes it in Clients, Edit. The payer's qualification-modifier rows are billing-only; they do not drive a scheduling check, and they key off the staff record's education level (see [Billing and claims](billing-and-claims.md#line-modifiers-same-day-merge-and-claim-splitting)).
- Risk configuration (`settings.risk`) has no Settings panel.
- ABA Hours credits a block whole to everyone on it, from scheduled times rather than a clock-in.
