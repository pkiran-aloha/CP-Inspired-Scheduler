# Aloha ABA — Practice Suite

A **local-first demo** for ABA practice operations, built with React, Vite and Vitest. It includes a calendar (day/week/month/agenda/timeline), client/staff/payer/service masters, an intake pipeline that turns referrals into client charts, authorization-aware claim staging, payment and A/R views, reporting, dashboards and document builders. The demo seeds fictional staff, clients and appointments; **it is not a production EHR or a safe place for real PHI**.

## Run locally

```sh
npm ci
npm run dev       # http://localhost:5173
npm test          # Vitest regression suite
npm run build     # static site in dist/
```

Deployment is defined in `.github/workflows/deploy.yml` (tests + build, then GitHub Pages on pushes to `main`). The app needs no backend. State is stored in this browser under `aloha-aba.v3`; browsers/devices do not sync.

## Current development context

- **Billing documents, one builder each (2026-10-08):** every billing download comes from its tested builder in `src/lib/billingDocs.js` — Generate Invoice's draft statement, Verification Forms, the new QuickBooks **Download import CSV** and the new Appeals **Letter** — so the tested file is the file users get. Unused builder variants were removed.

- **Dependencies (2026-10-08):** test runner upgraded to Vitest 4, unused Playwright packages removed, `npm audit` reports 0 vulnerabilities. Run `npm ci` after pulling.

- `src/state/store.jsx` owns the seeded workspace, migrations, reducer, undo and browser persistence. `src/lib/` contains the domain engines (claims, documents, reporting, scheduler); `src/components/` holds the screens. `src/__tests__/` exercises both pure logic and UI workflows.
- `docs/specs/` contains the original billing design/build plan. It is historical design context, **not** a guarantee that every listed screen or integration is implemented. The app has no clearinghouse, eligibility or QuickBooks network connection; generated artifacts and manual workflows are local demonstrations.
- The NavRail build id and `public/version.json` let an open tab notice a newer deployment.
- The workspace saves to localStorage (`aloha-aba.v3`) 250 ms after each change and at once on reload, close or tab switch. Open tabs adopt each other's saves, so an older tab never overwrites newer work. A failed save or an unreadable saved workspace shows an alert that says why; an unreadable save is never overwritten without asking.
- The build is code-split: the calendar, store and domain engines load first (≈1,015 kB minified, 322 kB gzip, down from 2,525 / 759 kB); every other section, the bundled wiki and jsPDF load on first use. `src/test/setup.js` preloads them so UI tests render synchronously. `npm run share` still produces one self-contained file.
- **Help & Wiki** (rail footer, Cmd/Ctrl+K) shows `docs/wiki/` inside the app with search; the pages are bundled at build time, so the wiki and Help never drift. `docs/marketing/README.md` holds the marketing copy. Both are kept current by the landing rule in `AGENTS.md`.

### Appointment location suggestions

The booking dialog's Location field groups suggestions by source: the client's usual site and street address on file (saved as `Home · …` so place of service stays 12), where each picked staff member was just before this slot (same day, else their latest earlier stop), and the practice's offices and telehealth location. Anything typed is saved as typed, with an **Open in Google Maps** link the user clicks themselves (new tab); no map service is called and nothing is sent. Sources are a plain list in `src/lib/locationSources.js`, so another source is one more function. No new stored field. Tests: `locationSources.test.js`, `locationField.test.jsx`.

### A visual Checks rail in the booking dialog

The booking dialog's Checks rail now leads with one decision line (*Fix before booking*, *Review before booking*, *Almost there*, *Clear to book*, *Ready to book*) and a glyph count per severity. An **at a glance** block draws the numbers behind the checks: authorized hours as used / booked / left (with the overage and cap mark when over) plus the authorization week, each picked clinician's week load against target, and chips for cancellation risk, drive time and past sessions together. Every meter carries its numbers in text and as an accessible meter value. Each check shows its headline and one line; the rest sits behind **Details**. Open slots are clickable time chips. Same checks, same rules, nothing new is estimated. Code: `src/lib/railGlance.js`, `src/components/BookingChecks.jsx`; tests `railGlance.test.js` and `bookingChecks.test.jsx`.

### UI rule cleanup

Calendar cards draw their small markers (series exception pencil, ABA hr, flagged, conflict) from the shared icon set instead of text glyphs; the exception pencil reads "Changed from series" to screen readers. Cards, rows and hints that used a thick colored left stripe now show tone with a 1px tinted border and, for warnings, a light tinted background, in both themes.

### Pick fit and open slots (scheduling intelligence)

The booking dialog's staff and client pickers now show what the workspace knows under each name. Staff: past sessions with the client (or **New to** them), hours this week after the booking against their target hours, and a straight-line drive estimate from their previous appointment that day. Clients: authorized hours booked this week against the authorized week, days to expiry inside the renewal window, and their usual weekday and time band over the last 8 weeks. One **Best fit** badge (staff, the same ranking as "Suggested for this client", which now uses each clinician's real session count for the week) or **Most hours open** badge (clients) marks the strongest clear candidate, and an **A–Z / Ranked** switch reorders the list (A–Z by default). The Checks rail gains a **Schedule fit** flag: a clinician new to the client when someone else has history, a clinician going over target hours with a free same-tier peer under 75% of theirs, and, when the slot clashes, up to 3 open slots in the next 7 practice days that everyone picked is free for and can reach. A slot click only fills the form. Advisory; nothing is booked, moved or blocked. Code: `src/lib/pickFit.js`; tests `pickFit.test.js` and `bookingChecks.test.jsx`.

### Repeating sessions and series edits

The booking dialog's **Repeats** picker offers Google Calendar's options:
- daily, weekdays, weekly on any days, every N days/weeks/months/years;
- monthly by day or by Nth/last weekday, and yearly;
- ends never (capped at 12 months ahead, said in the picker), on a date, or after N times.

Months without a 29th–31st are skipped. Every generated date is screened for clashes, Stop rules and the authorization guard: refused dates and warnings are named in the result.

Edit, Delete and Cancel on a series offer **This occurrence**, **This & following** and **All**:
- "This & following" splits the series.
- Field edits copy only the changed fields and keep each session's own changes.
- A new date or rule rebuilds upcoming sessions.
- A dragged occurrence becomes an exception that remembers its original date.

Completed, cancelled, billed or claimed, and payroll-approved sessions are never changed. Rebuilds never create or delete past dates. Each scoped change is one `seriesTx` transaction and one Undo. Code: `src/lib/recurrence.js`, `src/components/RecurrenceEditor.jsx`; `normalizeRecurrence` migrates legacy weekly, every-2-weeks and monthly series. Tests: `recurrence.test.js`, `recurrenceUi.test.jsx`.

### Access holdout (B4)

Scheduler Insights → Coverage keeps a share of each hour's bookable staff time (Off, 10%, 15% or 20%; default 10%) for new starts and same-day needs, from today on. It says how many hours that holds back in the range and how many are already booked, and outlines the weekday hours where bookings eat into it. The share is saved for the practice (`settings.risk.holdoutPct`). It never blocks a booking. Code: `coverageBoard` in `src/lib/insights.js`.

### Overbooking guidance (C4)

Scheduler Insights has an **Overbooking** tab. For each weekday and time band (per office when there are several) it looks back 12 weeks and marks a block **Room for one extra** only when both checks clear the practice's confidence threshold: a session was lost there in at least that share of its weeks, and the sessions booked on its next day give at least that same odds of a loss. The threshold is the scheduler's pick on the tab: 70 / 80 / 90 (default 80), saved as `settings.risk.overbookSafePct`; higher marks fewer, more reliable blocks. Blocks with under 8 weeks of history say so; blocks that fall short say how many sessions a week they would need. Marked blocks list up to three standby families who are behind their authorized pace. It is read-only and never suggests a second client on the same clinician (97153 is one client face to face). A new clinical booking that lands in a marked block gets a flag in the booking dialog's Checks rail saying so; it never blocks the save. Practice cancellations are left out, and so are family cancellations made with more notice than the practice's late-cancel threshold (24 hours by default, in Billing → Setup): the app records when a session is cancelled (`cancelledAt`), and the risk model reads the same threshold. Cancellations with no time recorded still count. Code: `src/lib/overbook.js`; tests `overbook.test.js` and `schedulerInsights.test.jsx`.

### Cancellation notice in the risk model (C4 follow-up)

The at-risk worklist honours the practice's own late-cancel notice threshold (`settings.billing.lateCancelHours`, 24 hours by default, editable in Billing → Setup → Rate & Numbering Policy). A **family** cancellation that gave more notice than that threshold is the practice being told in time — the slot could be refilled — so it stops counting against that family's attendance rate and the practice-wide base rate alike. Everything else counts exactly as before: no-shows, cancellations under the threshold, cancellations with no time recorded, and cancellations whose reason is missing or practice-side. The Risk tab says how many family cancellations record their notice and how many were spared, so the rule never implies data the workspace does not have. The Overbooking backtest reads the same threshold, so "late" means one thing practice-wide. Code: `src/lib/risk.js`, `src/lib/cancelReasons.js`; tests `schedulingRisk.test.js`, `cancelReasons.test.js`, `overbook.test.js` and the Risk tab case in `schedulerInsights.test.jsx`.

### Caseload ramp (D1)

Scheduler Insights has a **Ramp** tab: the next 12 practice weeks, one row per week. Demand is the authorized weekly hours on each active client's chart for as long as the authorization window runs, plus open intake requests at their requested hours in a lighter band from their target date — never weighted by a conversion rate, so it is a ramp from known work, not a forecast of referrals. Supply is each clinician's working day (`settings.workday`) minus blocked-out time, on the practice days selected in System Settings (Monday–Friday by default), split RBT vs BCBA vs other clinical, the same denominator the Coverage tab uses. An authorization that ends inside the horizon drops to zero and the week is marked **renewal pending**; a renewal is never assumed. Weeks where known demand exceeds supply are flagged, and the header names the first one. Read-only: nothing is booked, moved or sent. Code: `src/lib/ramp.js`; tests `ramp.test.js` and `schedulerInsights.test.jsx`.

### Hire / contract decision (D2)

The Ramp tab also carries a read-only verdict strip: **hours gap (hire/contract)**, **template problem (do not hire)**, **do not hire**, or **not enough on-screen hours to tell**. It uses the ramp’s short weeks plus Coverage fill of the range on screen (bar 85%, the same full-day mark Coverage already uses). Low fill with a short week is a schedule-shape problem, not a capacity problem. Demand is not split by credential, so it names hours, never a headcount. Intake is never weighted by a conversion rate; renewals are never assumed; nothing is hired, contracted, booked or sent. Code: `src/lib/hire.js`; tests `hire.test.js` and `schedulerInsights.test.jsx`.

### Good Faith Estimate (No Surprises Act)

Client profile > **Good Faith Estimate** prepares the written estimate an uninsured or self-pay family is owed under 45 CFR 149.610. It is prefilled from the calendar, editable, and covers up to 12 months of recurring care. It carries the rule's required content and the CMS model disclaimer. The app downloads it and does not keep or send it.

### Superbill for out-of-network families

Generate Invoice > select a client > **Superbill** downloads an itemized superbill of the family's self-pay services in the page's date range, for the family to send to its own insurer. It carries the provider tax ID and NPIs, the rendering clinicians and credentials, ICD-10 diagnoses, and CPT codes with modifiers, units, place of service and charges. Services already billed to an insurer never appear on it.

### Family statement to HFMA guidance

The statement PDF is rebuilt to HFMA's patient-friendly billing guidance. It puts the amount due and due date at the top and the guardian's address in the envelope window. Each claim shows what insurance paid and what is the family's share, followed by aging and a tear-off remittance stub. It prints no diagnosis, member ID or birth date. Self-pay lines carry the No Surprises Act Good Faith Estimate notice.

### CMS-1500 to the NUCC / CMS standard

The CMS-1500 (02/12) now follows the NUCC instruction manual item by item and prints every character on the form's 10-per-inch, 6-lines-per-inch grid. **Red form print** produces the data only, for genuine red-ink forms, which is the paper claim scanning payers accept. The **CMS-1500** download adds the drawn form and is marked as a review copy. Clients > Edit now records the home address the form needs in item 5.

Mileage is not assigned a universal procedure code. **Masters → Payer → Billing Rules → Claims Settings** accepts the payer-approved 5-character CPT/HCPCS mileage code; no default is guessed, and CPT `14220` is rejected because it is a surgery code. Insurance mileage lines without the configured code are held and cannot be exported on the CMS-1500 until the code is saved and the draft is rebuilt; changing a payer's code also makes existing drafts stale. Verify the code against the payer's contract.

### Small consistency fixes

The secondary screen's title now reads **Secondary Queue**, matching its nav item and the Billing desk. The AR Manager lost an unreachable "Clear filter" button (its filter was never set); search remains the client filter.

### Honest claim wording

Process and Submit now say what actually happens. The toast reads "N claims marked submitted · file saved in Billed Files, nothing transmitted". New claim history entries read "Marked submitted to <payer>; claim file saved locally, not transmitted". Billed Files shows a recorded file as **Exported** (saved in this browser), not Sent or Delivered, and labels the 837P count "Summary, not X12". Stored values are unchanged, so saved workspaces need no migration. Old history entries keep their old text.

### Modal overflow and PDF export fixes

Staff and client edit dialogs keep their Save/Cancel footer in view and scroll the form between header and footer. The profile sheet no longer runs off the right edge. Every modal now scrolls rather than clips when its content is taller than the screen. The payroll register and payroll summary PDFs download as real PDFs (they were 15-byte `[object Object]` files). Statement, intake, report and CMS-1500 PDFs map characters the PDF fonts cannot draw instead of printing them as gibberish.

### Scheduling density optimiser (B2)

Scheduler Insights now has a **Density** tab. It scans the visible range for future, unclaimed clinical sessions that could move earlier or later on the same day into an adjacent idle window, so a clinician gets a tighter block instead of a split day. Each suggestion names the session, the current time, the target time next to an existing block, and the split idle time/day span it would save.

**Move here** rechecks live staff/client conflicts plus Stop-level overlap and travel rules, then moves that one appointment locally with one Undo. It keeps the same staff, clients and duration. It does not move separate Drive Time blocks, infer family availability, edit recurring templates, send messages or call a map service. Code: `src/lib/density.js`, wired through `src/lib/insights.js` and `SchedulerInsights.jsx`; tests in `schedulerInsights.test.js` and `schedulerInsights.test.jsx`.

### Intake → first-week handoff (D3)

After conversion, the client profile and converted intake offer **Plan first week**. Choose a week, weekdays, start time, session length, authorized service and location. A local proposal fills the gap against the chart's weekly target, accounts for existing sessions and remaining per-code units, and ranks up to three available staff per slot with reasons and checks. Family preferences are shown verbatim for confirmation, never treated as machine-readable availability.

**Review & book** opens the existing booking dialog; nothing is booked by generating a proposal. Each confirmed session is revalidated against live state, saved locally with its intake link, and reversible with one Undo. Stop rules refuse saves; Warn rules are named in the confirmation. Proposals are ephemeral, one session per selected day, not recurring series or outreach. `src/lib/intakeHandoff.js` holds the proposal and transaction planners; `intakeHandoff.test.js` and `intakeHandoffUi.test.jsx` cover the workflow.

### One A/R aging engine

Every A/R view now ages claims the same way. The AR Manager, the Billing desk strip, the Claims Register and the claim drawer all count days for an open primary receivable from submission (falling back to the last date of service, then the creation date) and sort it into the same five buckets — current, 31–60, 61–90, 91–120 and 121+ days. A denied claim keeps aging while its balance is still owed; draft, void, closed and zero-balance claims show no age. The AR Manager table shows 91–120 and 121+ as separate columns, matching its KPI strip, drill chips and CSV export. `agingSince`, `agingBucketFor` and the rewritten `agingOf` live in `src/lib/claims.js`; `claims.test.js` reconciles the desk's buckets with the AR Manager's for the same claims.

### A/R DSO consistency

Billing Health now reads "Days in A/R" from the same calculation as the AR Manager: open primary A/R divided by average daily primary charges whose service start falls in the 90-day lookback, with draft charges included. At the same as-of date, the two views produce the same DSO; both show a dash when there are no lookback charges. Covered by `billingKpis.test.js` and the dashboard UI test.

### Small correctness batch — auto-fill units, appeals, payer Undo

**Report Auto-fill follows the payer's unit rule.** Reports > Validations and the Billing-readiness rows estimated units by dividing the visit by the *code's* unit size and rounding to two decimals, so the same session could get different numbers depending on which button filled it. Both now read `unitRuleFor` (payer override, payer service, service master, then code) and `unitsFor` (the rule's rounding) — the same numbers the booking dialog, Quick Add and the Billing desk write.

**An appeal is a mark, not a status.** Filing an appeal used to set the claim to `appealed`, which is not in `CLAIM_STATUSES`: the desk KPIs ignored the claim and no payment could be posted against it; Mark Won set Paid without posting any money. Now the claim keeps its own status (a denial stays Denied and stays in A/R) and carries an `appeal` marker. Mark Won records the outcome and returns the claim to Submitted awaiting the payer's payment; Mark Lost leaves it Denied. Neither invents money, and a saved workspace that still holds the retired `appealed` status is healed on load (`normalizeAppealedClaims`).

**Every payer edit is one Undo.** The profile fields, the inline list cells and the Billing Rules panels each take one snapshot (Payment Terms already did), and the Undo button is on the toast. The contract cleanup that runs when a service is deleted passes `noSnap`, so a delete cannot leave a half-Undo behind; service and custom-field master edits still take no snapshot. Tests: `autoFillUnits.test.js`, `appeals.test.jsx`, plus `store.test.js` and `mastersHub.test.jsx`.

### Follow-up 4 — payer qualification modifiers

**Staff education.** Staff records carry an optional **Education level** (Doctoral, Master's, Bachelor's, Associate, HS), set in Staff > Edit and shown on the profile. It is what a payer's Qualification Modifiers match against.

**Qualification modifiers on claim lines.** Payer > Billing Rules > Qualification Modifiers now applies: the first row whose level matches the rendering provider's education level — or a "·" part of their role or credential, so Teacher/Therapist/Specialist rows keep working — adds its modifier pair to each line, after the credential modifier and before the place-of-service modifier. A blank modifier adds nothing, duplicates collapse, and a line still caps at four. The panel reports how many staff have no level recorded; their lines carry no qualification modifier. The demo staff carry levels, so the demo claims show it. The default rows are the education code alone: the old first modifier, `U6`, is an hourly code that does not belong on every claim because of a degree.

### Follow-ups — demo seed polish

**Demo records.** A fresh workspace (and Regenerate demo data) now includes sample Cabinet documents (one expired, two due within 30 days), CEU and PDU entries, tasks and messages, so the Cabinet, Credentials & PDUs report and Inbox show real examples. All fictional and dated relative to today.

**Team task notifications.** The practice administrator account is not a staff member, so its Inbox now reports the whole team's overdue and due-today tasks. Staff accounts still see only their own.

**Demo family balances.** Three demo families owe a coinsurance share the payer reported, so client statements and the patient A/R bucket have real examples. Clients with secondary coverage are left alone for the COB demo.

### Follow-ups — backlog fixes

**Staff qualification check.** BCBAs (and RBTs on 97153) were wrongly flagged "Staff Qualification" because a cert like "BCBA #5-12-0034" or a role like "BCBA · Clinical Supervisor" was compared as a whole string. The check now reads the credential out of those values and maps job titles through each qualification's "Applies to" list.

**One Convert button.** An intake request had two "Convert to client" buttons. The one in the Next box stays; the Conversion readiness panel now just says what is outstanding.

**Intake assessment booking checks.** Booking an intake assessment now runs the practice's Appointment Validations, like the booking dialog. A rule set to Stop (for example a clinician already booked at that time) refuses the visit; Warn items are named in the confirmation. The visit still has no client until the request is converted.

### Hackathon wave 6 — integrations, honest partial

**Telehealth room link.** Settings > Clinical Integrations > Telehealth room link stores the practice's own video room (a full `https://` address; anything else is refused). Telehealth bookings (place of service 10) show the link under Location, and `.ics` exports add it to those events. The app does not host, open or record video.

**Per-staff calendar file.** Each Staff Roster card (and expanded table row) has a `.ics` button that saves that person's next 90 days of bookings for Apple or Google Calendar. It is a one-off file, not a subscription; the toast says to download again after changes. Client names are left out for roles without Clients access.

**Online payment link.** Settings > Clinical Integrations > Online payment link (Stripe) stores the practice's own payment page (`https://` only). Client statement PDFs with a balance print it under "How to pay". The app never charges a card or reads Stripe; the Payment Center's patient receipt form tells staff to record link payments as Card with the processor's receipt number. No integration row accepts API keys or tokens: this browser-local prototype has no secret vault, so never enter live credentials. Recognized legacy credential fields are removed on workspace load and excluded from backups.

### Follow-up 3 — B3 travel feasibility and routing

**Slice1 — Travel check in the booking dialog.** When a clinician has a previous or next session the same day, the Checks rail now shows whether there is enough time to get there. Message like “Needs about 22 min from previous; gap is 10 min” (impossible when gap < travel) or “Tight turnaround: about 18 min from X to Y, gap 22 min” (tight when gap < travel+10 min). The booking can still be saved — `staff.travel` defaults to Warn in Appointment Validations.

- **Where coordinates come from:** client `geo` `[lat,lng]` for home/school/community, plus optional `lat`/`lng` on Settings > Organization offices (seeded for demo offices). Telehealth and unknown places are skipped, never guessed. Office editor now has Latitude/Longitude fields with validation.
- **How it is estimated:** straight-line haversine × 1.3 road factor at 25 mph + 5 min buffer. Honest copy: “estimated from straight-line distance × 1.3 road factor at 25 mph; not a map route”. No map API.
- **Know before you pick:** `candidateVerdicts` calls `evaluateAppointmentValidations`, so the staff picker shows a travel chip before you add someone.
- **Pure logic:** `src/lib/travel.js` (`haversineMi`, `estimateTravelMinutes`, `resolveApptLocation`, `travelLeg`, `travelChecksForStaffDay`, `routeForDay`, `suggestRouteOrder`, `TRAVEL_DEFAULTS`). Tests: `travel.test.js`.

**Slice2 — Per-clinician day route view.** Scheduler Insights (I) has a new **Travel** tab: for each staff member per day in the visible range, it lists legs (from → to with gap, travel needed, distance, severity), totals (straight-line miles, travel minutes, tight/impossible counts), and a read-only suggested re-order that saves miles (greedy nearest-neighbor, shows miles saved, nothing moves). Honest copy throughout, no map API. Code: `SchedulerInsights.jsx` travelBoard using `routeForDay` and `suggestRouteOrder`, styles in `styles.css`.

### Hackathon wave 5 — inbox

**Messages.** The Inbox's third tab holds conversations between signed-in users of the workspace.
- **Starting and replying:** start one with a subject and recipient. A reply goes to everyone in the thread.
- **Who sees it:** threads are listed only to their participants.
- **Unread:** unread messages show on the thread and add to the envelope count. Opening a thread marks it read without using an Undo slot. Sending is one Undo.
- **Where it lives:** everything stays in this workspace; nothing is emailed or texted. Messages are a new durable collection (`messages`) included in backups.
- **Code and tests:** `src/lib/messages.js`; tests are in `messages.test.jsx`.

**Inbox: tasks and notifications.** The envelope in the top bar opens the Inbox. Its count badge is the number of notifications waiting for you. It has two tabs:
- **Notifications** are read fresh from the workspace each time. They cover:
  - your overdue or due-today tasks
  - Cabinet documents expired or expiring
  - authorizations lapsed or ending within 30 days
  - intake requests past their stage deadline
  - denied claims

  Each one opens the place to act, and only if your role can see that area.
- **Tasks** are assigned to any staff member, with a due date, a priority and an optional client. You can list your own or everyone's, and tick a task done.

Everything stays in this workspace; nothing is emailed or texted. Tasks are a new durable collection (`tasks`), open to every role and office-scoped by client or assignee. Each change is one Undo. Code: `src/lib/tasks.js` and `InboxView.jsx`; tests: `inbox.test.jsx`.

### Hackathon wave 4 — records

**Credentials & PDUs.** Reports → Clinical → **Credentials & PDUs** lists every clinician against what renewal needs. It uses the BACB baseline plus the practice's own target:
- **BCBA and BCaBA:** 32 and 20 CEUs per 2-year cycle.
- **RBTs:** a yearly competency assessment, supervision % over the last 30 days (5% minimum), and the practice's annual RBT PDU target (default 12 h).

Renewal dates come from credential documents in the Cabinet; without one, a rolling window is used. Entries (CEU, PDU, competency) are logged in Staff → Cabinet → *Training & CEU log*, which is also where the practice's RBT PDU target is set. The log is a new durable collection (`pdus`), included in backups, and each entry is one Undo. Code: `src/lib/credentials.js`; tests: `credentials.test.jsx`.

**Cabinet.** Staff → **Cabinet** is a register of documents that expire: credentials, licenses, background checks, CPR, liability insurance, training, client consents and authorization letters, and contracts.
- **What a record holds:** each document belongs to a staff member, a client or the practice, with issued and expiry dates, a reference and notes. Only these details are recorded; no file is stored.
- **Alerts:** documents expired or due within 30 days raise a banner on the screen and a badge on the Staff rail item.
- **Editing:** an edit keeps a history of expiry changes. Archiving (not deleting) stops the alerts.
- **Undo and backups:** each change is one Undo. The register is a new durable collection, included in workspace backups.
- **Code and tests:** `src/lib/cabinet.js` and `CabinetView.jsx`; tests are in `cabinet.test.jsx`.

**Client statements.** Billing → Generate Invoice → **Issue statement** turns what a family owes into a numbered statement. The numbering is `STM-<yyyymm>-<nnn>`, with one line per claim, frozen on the day it is issued.

The **Statements** list underneath gives each statement:
- **PDF:** downloads the statement.
- **Live balance:** patient receipts reduce it, and it reads *Paid* once settled.
- **Mark sent:** records how you delivered it (mailed, handed over, your own email or portal). The app sends nothing.
- **Void:** needs a reason.

Each of these is one Undo. Statements are a new durable collection, included in workspace backups; older backups import with none. Code is in `src/lib/statements.js`, with tests in `statements.test.jsx`.

### Hackathon wave 3 — intake

**Easier intake.**
- **Fewer required fields:** a first call needs only the essentials (name, date of birth, office, a phone, the guardian's contact, an owner). Alias and address can wait.
- **Fix buttons:** every unmet item in the request's **Next** box has a **Fix** button that opens the tab or form where it is recorded.
- **Landing after conversion:** converting opens the new client's profile.
- **Names:** the screens are called *Intake Requests* and *New Intake* everywhere.

**Intake PDFs.** Two downloads, both generated in the browser (nothing is sent). The builders are pure and live in `src/lib/intakeDocs.js`; tests are in `intakeDocs.test.jsx`.
- **Intake packet** (Intake Requests toolbar): a blank packet for families. It has fill-in fields, a checklist of documents to bring, and a signature line for each consent.
- **Summary PDF** (request drawer): everything recorded on the request, including every document and consent status.

**Conversion carries the intake data into the client chart.**
- **Approved units:** these come from the payer's authorization decision and go into the client's unit pool as 15-minute units, under 97153. They are marked to check against the payer letter, because the request does not say which codes they cover. They used to be divided as if they were hours.
- **Weekly hours guard:** derived from those units.
- **IDs and clinical details:** the member ID, group number, authorization number, diagnosis, assigned BCBA and emergency contact go to the chart.
- **Claims and the CMS-1500:** these print the chart's real member ID and authorization number. A secondary filing prints the secondary's. A demo placeholder appears only when the chart has none.
- **Client form:** now has Member ID and Authorization # fields.

### Hackathon wave 2 — configurable billing

The goal is that a payer contract change needs a setting, not a code change. The audit and the slice plan are in `docs/specs/configurable-billing.md`.

**Payment Terms per payer.** Masters → Payer → Billing Rules → **Payment Terms** sets these for each payer:
- payer kind
- expected days to pay
- estimated payer share (%)
- estimated copay per line
- filing deadline (blank uses the practice default)

Claim aging (the *late* flag), the copay estimate, the payment presets, the timely-filing date and CMS-1500 box 7b now read the payer record. They used to read a constant keyed by payer name. There is now one filing-days rule everywhere: payer deadline, then the practice default, then the payer policy. Saving is validated (whole days, percentages and money with at most 2 decimals) and takes one Undo. `planPayerTerms` / `filingDaysOf` are in `src/lib/claims.js`. Tests: `payerTerms.test.jsx`.

**Billed units follow Medicaid norms and the payer's own rule.** Medicaid is the largest payer, so its norms are now the default:
- The ABA codes (97151–97158, 0362T, 0373T) and H2019 bill **per 15 minutes**. Rates in the code table are per 15-minute unit, so the charge per hour is unchanged.
- Units are counted by the CPT midpoint rule: 8 minutes or more makes a unit.

The booking dialog, Quick book and Billing's Auto-fix all count units with the same rule chain as the authorization ledger: payer override, then payer service, then service master, then code. Claims and authorization pools therefore always agree, and the Billing tab shows the rule it used.

Medicaid adds up a day's minutes for one code and one client and rounds them once. When rounding each session separately bills a different total, Reports → Validations raises a **Billing** warning. Merging those lines on the claim is a later slice.

Saved workspaces are migrated once:
- services still on the old 30-minute defaults move to 15 minutes, with their rate and any payer override charge scaled to match
- authorization pools for those codes scale to the new unit
- appointments not yet on a claim are re-counted

Claims are never changed. Details and limits are in `docs/specs/configurable-billing.md`.

**Modifiers on claim lines.** New claims now fill box 24D. Each line gets up to four modifiers, in this order:
1. the payer's own modifier for the service (Payer → Services)
2. the rendering provider's credential modifier: HO for BCBA, HN for BCaBA, HM for RBT, HP for psychologist. This is the Medicaid norm. It is on by default, and a payer can switch it off in Billing Rules → Claims Settings.
3. the payer's place-of-service modifier

Self-pay invoices carry none. Place of service now uses CMS codes (home 12, school 03, office 11, telehealth at home 10, community 99). The old list labelled 06 as home. `lineModifiers` / `posFor` are in `src/lib/claims.js`. Tests: `claimModifiers.test.jsx`.

**CMS-1500 from the payer record.** These boxes now come from the records instead of being guessed or invented:
- **Box 1 (program):** the payer's CMS type.
- **Box 1c / 7a (group number) and box 10 (plan ID):** the payer's billing identifiers. When those are blank the form shows "—"; it used to invent a value.
- **Box 6:** "YES" when the client has secondary coverage. Medicaid is the payer of last resort and must see other coverage.
- **Box 32:** follows the payer's Claims Settings rule. The default leaves it blank, because the service facility is the billing provider.
- **Practice NPI:** an invented NPI is never printed.
- **Fixed:** the MEDICARE checkbox used to be ticked on Medicaid claims.

**Claim split rules.** These live in Payer → Billing Rules → Claims Settings.
- **Merge Same Day** (on by default, the Medicaid norm) puts same-day sessions on one line. To merge, sessions must share the code, modifiers, rendering provider and rate. Their minutes are added up and rounded once, so two 37-minute sessions bill 5 units, not 2 + 2. The line says how many sessions it covers. Dropping, rebilling or voiding it returns every one of them to staging.
- **Separate Claim By** splits a client's month into several claims, by rendering provider or by place of service.

**Denial reasons and remittance hints are editable.** You edit two lists in Settings → System → Billing Settings:
- **Denial reasons:** offered when a claim is marked denied, each with its next step.
- **Remittance code hints:** what an ERA adjustment code such as CO-197 means and what to do about it. The defaults cover 11 common CARCs.

Both lists are validated and saved in one step. Posted ERA denials and recorded denials read them. `planReasonLists` / `CARC_HINTS` are in `src/lib/claims.js`. Tests: `billingReasons.test.jsx`.

Turning Merge Same Day off for a payer brings back one line per session. Reports → Validations then flags the days where that bills a different number of units. `mergeSameDayLines` / `lineApptIds` are in `src/lib/claims.js`.

### Hackathon wave 1 — billing

**Provider IDs: NPI, Medicaid ID or both.** Masters → Payer → Billing Rules → **Provider IDs** lets billing staff choose which identifier a payer expects for the rendering provider, with a readiness line naming who can't be billed under the rule yet. `src/lib/providerIds.js` drives three places: the appointment validation *Missing NPI / Medicaid ID* (which now reads the provider records in Billing → Provider IDs instead of an NPI field staff rows never had, ending the false flag on every clinician), the claim gate (only once a payer chooses a rule, so existing claims are unaffected), and the CMS-1500 (NPI in 23b/33a; Medicaid ID with qualifier 1D in 23b/33b; both). Tests: `providerIds.test.js`.

**Recoupments.** Payment Center → **+ Recoupment** records a payer taking money back on a paid primary claim: amount (never more than the payer paid), date, reason (overpayment, duplicate, retro eligibility, COB, audit, authorization, other), how it went back (offset from a later ERA/PLB, or a refund check) and the payer's reference. The claim's `paid` drops, `recouped` accumulates, the balance reopens for rebilling or appeal, and the history says why; the original remittance stays on file. It is its own negative ledger line (red in Payment Center, its own filter and KPI), one Undo, and is not offered a *Void*. Scope: primary claims only — a claim with a linked secondary filing, or the secondary itself, is refused with the reason. `planRecoupment` in `src/lib/paymentLedger.js`; tests: `recoupments.test.jsx`.

**Authorization Utilization report.** Reports → Clinical → **Authorization Utilization** replaces guesswork about "how much of the auth have we used" with one row per client × code across the authorization's *own* window (not the report range): authorized, used, scheduled and remaining units (payer unit rules applied), Used % against Expected % (how far through the window today is), Projected % (used + scheduled), a status (Not on authorization · Over-committed · Expired · Under-utilized · On track), a *Start renewal* flag at 30 days left or 75% committed, days left, and *Verify* on units converted from weekly hours. The older hours-based *Authorization Burn-down* stays for weekly pacing. Tests: `authUtilization.test.js`.

**Billing Health on the dashboard.** A new **Billing Health** widget (on the default board; add it from the gallery on a saved board) shows eight revenue-cycle KPIs computed from the claims and payments ledgers — clean claim rate, denial rate, net collection rate, cash posted, days in A/R, A/R over 90 days, charge lag and recoupments — each with its formula and target on hover, deltas against the previous equal window, and a CSV export that includes the formulas. `src/lib/billingKpis.js`; tests: dashboard suite.

### Authorization unit ledger & payer rule packs (previous round)

Ideas A2 + A4 from `docs/specs/scheduling-intelligence-ideas.md`. The booking guard used to know only "X hours a week from start to end"; payers audit *units per CPT code*.

- **Per-code unit pools.** A client's authorization now carries `authUnits` (`{ "97153": 960, "97155": 96, … }`) for the window, edited in Clients → Edit → *Authorized units by code*. `src/lib/authUnits.js` owns the ledger.
- **The payer's own unit rule.** A session's minutes become units by the payer's per-service override (unit size + rounding) → the payer's own service → the service master → the code default, with **AMA** (the 8-minute rule) as the default rounding. Nearest, Round Up, Round Down and Truncate are honoured where a payer sets them.
- **Payer rule packs at booking.** Masters → Payer → Billing Rules → **MUEs** (per-code and all-code daily maximums, already configured, previously unused) plus a new per-code **weekly limit** are checked when a session is booked, and so is the credential rule billing already uses (who may render a code, plus any credentials the payer lists on the service).
- **One guard, two views.** The booking dialog merges the hours check (`authBudget.js`) with the unit/payer check and shows the session's units ("4 units of 97153, 30-min units, AMA rounding · 61 of 72 authorized units committed"). Over-pool is *Stop* severity, capped to a warning in the shipped Warn mode; nothing hard-blocks unless the practice chooses Stop.
- **Migration.** Saved workspaces convert each client's weekly hours × window weeks into units, split across the codes the client is actually booked under (all to 97153 when nothing is booked), marked *converted — verify against the payer letter* until someone saves the client. Fresh workspaces seed realistic per-code pools with varied headroom.
- **Honest limits.** The credential rows keyed by education level (Doctoral / Master's / …) can't drive a check: staff records carry no education level. (Since wave 2 the codes use 15-minute units: see Hackathon wave 2.) An intake conversion does not yet copy its approved units into the new client's pool.
- Tests: `src/__tests__/authUnits.test.jsx` (rounding rules, override precedence, ledger, warn/stop/merge, MUE + weekly caps, credentials, migration, seed, the client form).

### Cancellation reasons & root cause (previous round)

Idea C3 from `docs/specs/scheduling-intelligence-ideas.md`. The **Cancellation reasons** Custom List already shipped, but nothing used it. It now does:

- **A cancellation asks why.** The detail card's *Cancel* / *Skip occurrence* opens the practice's reason list instead of cancelling on the spot; the appointment form shows a required *Cancellation reason* whenever the status counts as a cancellation (No Show, Cancelled, or any status with "counts as a cancellation" ticked). The appointment stores `cancelReasonId` and the label at the time (`cancelReason`); moving it back to a live status clears both. Undo restores the previous reason.
- **Whose side it was on.** A reason that names staff, a clinician, scheduling or the practice (e.g. *Staff illness*) is practice side; everything else is the family's side. `src/lib/cancelReasons.js` owns that rule.
- **Root cause, not a percentage.** Reports → Operations → **Cancellation Root Cause** groups cancelled and missed sessions by reason with hours lost, share, side, and the weekday and time band each reason clusters on, plus a "Not recorded" row for older cancellations.
- **Sharper risk scores.** The risk model leaves practice-side cancellations out of a family's attendance history and missed-session streak; a technician's sick day no longer makes the family look unreliable.
- **Seed and scope.** Seeded cancellations get deterministic reasons (Fridays skew to transport so the report has a pattern to show). Older saved cancellations keep no reason and show as "Not recorded". Nothing is sent to families.
- Tests: `src/__tests__/cancelReasons.test.js` (side rule, roll-up, report, risk history, seed) and the detail-card flow in `app.test.jsx`.

### ⚡ ABA Hours — behavior-analytic time on non-service appointments (previous round)

Spec and build record: `docs/specs/aba-hours-spec.md`.

**The rule.** An **ABA Hours** checkbox is added to all **non-service** appointments. When selected, that appointment is included as **behavior-analytic time** for tracking RBTs, BCATs, graduate students or state certification requirements. It counts group trainings on behavior-analytic principles held outside client sessions, and graduate students designing or reviewing interventions in non-billable time. It never counts cleaning the clinic or general admin such as stimulus preparation. **It has nothing to do with client authorizations.**

**What was wrong.** The flag had been wired to the opposite end of the product: it appeared on *clinical* appointments, its tooltip promised it counted toward the client's authorized ABA hours, and `consumesAuth` used it to decide whether a session drew on the authorization at all — so an un-ticked session silently vanished from the burn-down — while the credential hours it was meant to track were counted nowhere.

- **One predicate, one engine.** `src/lib/model.js` now labels each type service or non-service (`service`, `evaluation`, `supervision`, `drive` are service; `break`, `unavailable` and any unknown type are not). `src/lib/abaHours.js` owns the semantics: `countsAsAbaHours` is the single rule every reader goes through — booking dialog, calendar badges, agenda, detail card, roster, report, payroll line, data-quality sweep and the `⚡ ABA hours` calendar filter — so no two surfaces can disagree about what an ABA hour is.
- **The activity makes it count.** The dialog asks which behavior-analytic activity the block is, and the practice's non-examples are *named in the picker* (`✗ Facility upkeep — cleaning the clinic`, `✗ General admin — e.g. stimulus preparation`) rather than silently mis-counted. Hours are tallied per credential track — graduate student / trainee, RBT / BCAT, BCaBA, BCBA, other (state certification) — against targets the practice edits in Settings → System Settings → ABA Hours, labelled as the practice's numbers and not a board's rule.
- **Validations that actually hold.** A new `aba` group in Appointment Validations: `serviceAppt` (Stop — the flag belongs to non-service time), `activity` (Stop — the activity is not behavior-analytic), `missingActivity` (Warn), `noStaff` (Warn — nobody can be credited), `clientAttached` (Flag). Stop blocks the save in the booking dialog, and the same conditions surface in Reports → Data Quality & Validations so an imported or legacy record is still found.
- **Decoupled from authorizations.** `consumesAuth` no longer reads the flag and the "not drawn against the authorization / ⚡ Count it" box is gone; a clinical session draws on the client's authorization by type. `buildAppt` writes `abaHr: false` for any service appointment, so switching type cannot smuggle the flag onto a session.
- **Downstream.** Staff roster shows ⚡ hours with the activity mix and target progress; payroll lines carry `meta.abaHr`/`abaActivity` and `lineTotals` returns `abaHours` (certification currency — it never changes an earning code or a rate); a new *Behavior-Analytic Hours (⚡ ABA Time)* report sits under People & Payroll; seed data carries a weekly group training, a graduate-student design block and CEU/workshop time.
- **Migration.** `normalizeAbaHours` (wired into `normalizeWorkspace`) strips the flag from service appointments in workspaces saved under the old meaning, leaves every non-service flag alone, is idempotent, and records what it did in `meta.abaHoursStripped`.
- **Honest limits.** Nothing is transmitted to any board, registry or state system; a block is credited whole to everyone on it (co-present supervision is not split); hours come from the scheduled start/end, not a clock-in.
- Coverage: `abaHours.test.js` (27 — the predicate, tracks, roll-up, validations, payroll line, report, data-quality sweep, import column, migration), `abaHoursUi.test.jsx` (7 — offered on non-service and never on service, the examples/non-examples on screen, a non-qualifying activity refused then the real one saved, the credited-to line, the calendar filter, and the migration through `initial()`), plus new cases in `settingsWrites.test.jsx` (targets and rule severities persist), `dataImport.test.js` (the ⚡ column refuses service rows and non-qualifying activities) and `workspaceBackup.test.js` (a restore re-runs the migration, so a legacy flag cannot come back).

### Scheduler Insights — authorization, capacity and cancellation intelligence (previous round)

Research and build plan: `docs/specs/scheduling-intelligence-ideas.md` (ranked catalogue, evidence, effort sizing, non-goals). Three ideas from it are implemented here, and the README refuses to claim more than that.

- **Book-time authorization guard** (`src/lib/authBudget.js`). The authorization on file becomes a dated budget: committed vs remaining hours, the booking week against the authorized week, days to expiry and a projected exhaustion date. `authCheckFor` returns one graded verdict — **off / flag / warn / stop** (Settings → System Settings → Authorization guard; shipped default **warn**) — where `reasons` escalate and `notes` (projection, under-paced delivery) never do. Only sessions dated *inside* the window draw on it, so consecutive authorizations cannot double-spend. Drawdown is a property of the appointment **type**: every clinical session inside the window counts, so the `⚡ ABA Hours` flag (which tracks *staff* behavior-analytic time — see the round below) can never quietly remove a session from the ledger. The window total is weekly hours × weeks on file — an estimate, labelled as one — and the guard never contacts a payer or touches a claim; claim staging keeps its own checks in `claims.js`.
- **Cancellation & no-show risk** (`src/lib/risk.js`). A base event rate plus shrunk per-client and day/time cohorts fitted on this workspace's resolved appointments, and a small set of **policy** factors the ledger cannot learn (booking lead time, an unconfirmed slot, a backfilled or rescheduled session, a first session with a technician). Every factor carries `source: 'model'` or `'policy'` and the UI shows which is which; thin data says so instead of pretending. Lead time is policy, not fitted — there is no booked-at stamp to fit it on. `riskQueue` returns the worklist with expected lost hours and probability-weighted charge exposed. Not machine learning, not clinical judgement, and no reminder is ever sent: confirming is a local, undoable status change so the practice still knows who to call.
- **The Scheduler Insights panel** (`src/lib/insights.js` + `components/SchedulerInsights.jsx`), opened from the calendar toolbar or with `I`, scoped to the visible range: four KPIs (fill against the labelled 85–95% band, open capacity, authorizations needing action, at-risk sessions); a **coverage** heat grid by weekday × hour with blocked time removed from the denominator, plus **named idle windows** ("Tess Tech · Tue 08:00–18:00, 10h") that click through to that day filtered to that clinician; a **density** tab that proposes same-day moves into adjacent idle windows and applies one local move after a live preflight; an **authorizations** burn-down table; and the **at-risk** worklist with one-click Confirm/Open. The booking dialog renders the same guard and risk verdicts before you save.
- **Permissions and persistence:** `setSettings` routes `authGuard`/`risk` to the **calendar** area (schedulers own this, not the settings desk), and a restored backup re-merges the guard defaults instead of dropping them.
- Coverage: `authBudget.test.js` (23), `schedulingRisk.test.js` (18), `schedulerInsights.test.js` (17, including density suggestions/preflight and same-day past-time refusal) and `schedulerInsights.test.jsx` (13 — the panel, the tabs, a local density move, an undoable confirm, the "nothing is transmitted" copy, and the guard proven end-to-end: refused in Stop mode, allowed in Warn mode, and identical whatever the `⚡ ABA Hours` flag says).

### Settings sub-modules (previous round)

Settings expands in the main navigation sidebar, with **13 modules and their nested sub-tabs**. The selected configuration panel renders once in the workspace, without a second module menu. Opening Settings also expands a collapsed sidebar so its navigation remains available. Modules appear in the reference order: Appointment Status · Custom Lists (General, Service Type) · Custom Fields · Data Import · Organization · Payroll (General, Earning Code, Overtime Rules) · Qualification · Services · Security (User Accounts, User Roles) · Clinical Integrations · Text Messaging Services · System Settings · Subscription Portal.

- **One engine, no forked masters.** `src/lib/settingsMasters.js` owns the settings registry, the default masters, the resolvers (`settingsOffices`, `apptStatusList`, `statusFor`, `customLists`, `listOptions`, `qualificationList`, `earningCodes`, `messagesCfg`, `integrationsCfg`, `subscriptionCfg`) and the single guarded writer `planSettingsOp`. Every write goes through the store's `settingsTx`, which re-runs the planner against live state, so a stale dialog can never persist an invalid value, and each durable change is exactly one Undo step.
- **Real guards, not decoration.** Office names must be unique (NPI 10 digits), the last office or an office that staff/clients/appointments/payroll profiles/accounts point at cannot be deleted without choosing where those records move, renaming an office cascades into every collection that stored its name, at least one active payable status must survive, a status with appointments on it must be reassigned before removal, unknown payroll codes are refused, shipped earning codes are system rows (deactivate, never delete), overtime cannot go below the FLSA 1.5× floor, merge fields are limited to the ones the renderer fills, and portal links must be `https`.
- **De-forked, not duplicated.** Services ↔ Masters → Service Types, Custom Fields ↔ Masters → Custom Fields, Payroll ↔ `settings.payroll` (+ Payroll → Setup), and Security ↔ the former Security workspace, which is now **embedded in the Security module** — the standalone `section: 'security'` route redirects there, and the rail no longer carries a Security section. Nothing in the new modules is a second copy of an existing editor.
- **Data Import is honest about what it does.** `src/lib/dataImport.js` parses RFC-4180-ish CSV locally (clients, staff or appointments, 500-row cap), auto-maps columns from the header, validates every row (dates, sex, email, office names, FTE/hours/rate ranges, known client and ≥1 known staff, end-after-start, type and status against the status master), detects duplicates in-file and against the roster, then requires a clean preview before one all-or-nothing commit with skip-or-update modes. The commit, its counts and its log entry are one Undo; history lives on `settings.importLog` and travels in the backup. Nothing is uploaded anywhere.
- **Integrations, messaging and the subscription record do not pretend to be connected.** Clinical Integrations only offers exports that actually exist locally (calendar `.ics`, a telehealth room reference card, a deep link to the QuickBooks desk) and records the last local run; Text Messaging is opt-in, refuses to enable without a sender identity, keeps templates/quiet hours/opt-outs locally, and never transmits; the Subscription module edits the local plan/seats/contact record and links out to the external portal — invoices are local reference rows, not payment.
- **System Settings** keeps the tested surfaces: display and money defaults, appointment naming with live preview and title health, smart-scheduling weights, notification preferences (the real keys the guard accepts), analytics/billing defaults, the versioned workspace backup/restore, and demo reset/clear with two-step arming.
- Coverage: `settingsMasters.test.js` (33 assertions over registry, resolvers, guards, cascades, normalization), `dataImport.test.js` (parsing, mapping, validation, duplicates, all-or-nothing commits, limits), `settingsModules.test.jsx` (all 13 modules and sub-tabs render, persist their selection, no undefined labels) and `settingsWrites.test.jsx` (each module's write path actually persists, guarded refusals hold, and one Undo reverses a settings transaction).

### Workspace integrity (previous round)

- **Versioned full-workspace backup (v3 JSON; v2 files still import)** via Settings → System → Data & backup. It includes appointment/claim/payment ledgers, invoices, ERA imports, billed files, verification forms, QBO records, staff/clients/teams, payer/service/custom-field masters, settings, saved reports and dashboard boards. Import validates the file and previews its counts **before** a confirm-to-replace step; Cancel leaves the workspace alone. The older seven-field JSON export can still be imported, with a warning: it omitted masters and financial ledgers, so those cannot be recovered from it.
- **One-step Undo for compound billing edits and restore.** Claim submissions and their generated files are recorded together. Manual claim payments and their claim updates, self-pay invoice numbers and records, document records, regeneration and clearing now restore their dependent collections together. Undo history is kept **in the open tab only** (25 steps), not written into every localStorage save; it disappears on reload.
- **Storage-failure warning.** If a browser refuses a write, an on-screen alert says edits are currently in memory only and links to Settings for an immediate export. Exported JSON is unencrypted; handle it appropriately even though the shipped seed is fictional.
- **Billed Files** now reads the actual billed-file ledger, downloads the stored artifact rather than an invented summary, and can prepare a manual resend (download + increment the undoable send count). Preparing a resend does **not** transmit the file over the network.
- The agenda regression test checks a day’s badge against its rows rather than assuming a demo appointment exists on every day (e.g. Sundays).

### 835 ERA import (prior round)

- Payment Center → **Upload ERA (835)** accepts a local `.835`/`.txt` file (2 MB max). It parses a **claim-level subset** of X12, shows exact CLP01 claim matches, amounts, allowed amount, CARC adjustments and reasons for held lines. Nothing posts until you select eligible lines and confirm; you can also save the entire import as parked.
- Posting revalidates the live claim/payment ledger: draft, void and already-paid claims, unmatched or ambiguous claim numbers, repeated claims/lines/traces/files, unsupported service-line SVC allocations, malformed/negative amounts, overpayments, date/charge mismatches and inconsistent payer/patient allocations cannot auto-post. Provider-level PLB is flagged, **never** applied to a claim. A BPR-vs-CLP total difference is displayed for deposit review; it is **not** automatically reconciled or cleared.
- Selected payments, CARC denials, and the ERA audit record are one undoable transaction. The ERAs tab keeps posted/parked decisions, exports parked lines with reasons to CSV, and allows a parked line to be retried only after it becomes eligible. Typed ERA entry remains available but now rejects unsafe lines instead of silently skipping them.
- **Scope:** the 835 importer remains primary-claim-only; it does not perform SVC allocation, secondary 835 allocation, bank reconciliation, payer contact or network transmission. The shipped 835 demo fixture includes contradictory financial fields; those lines are intentionally parked, not force-posted. Use fictional data only, and review original remittances outside this demo before relying on a ledger.

### Linked secondary and reported patient share (prior round)

1. Post a primary partial remittance, then use **Secondary Queue → Create COB draft**. The draft snapshots the primary's remaining *claim-level* balance; its copied service lines are reference data, **not** an allocated secondary 837/CMS-1500. Verify coverage, COB, and service allocation outside Aloha. After filing elsewhere, choose **Record external filing** with the correct method. This changes only the local status; it does not send a claim or generate a compliant secondary form. An unremitted filing can be cancelled locally (which does not retract anything already sent externally); a skipped filing does not automatically bill the family.
2. Use **Record payer remittance** to open Payment Center with the secondary selected. The manual form can instead save a receipt as **unapplied** (no claim change). For a claim-linked receipt enter the actual payer amount and reference, any *secondary* adjudication adjustment, and a patient responsibility figure only if the remittance explicitly reports it. The live reducer rejects stale links, out-of-coverage filings, repeated references, bad cents, overpayments and duplicate voids. A secondary receipt is recorded on its child **and** reduces the primary's open balance; secondary adjustments never write off the primary. Payment voids write a signed reversal and restore both sides. Filing, payment, void and cancellation each have one tab-local Undo step.
3. **A/R Manager** counts only primary receivables, and splits each primary balance between the current filing/review bucket and the *reported* patient/self-pay bucket without duplicating dollars. An unknown insurance remainder is **not** patient A/R. Patient share is capped at the open primary balance and a pending secondary draft/submission suppresses the primary's earlier PR report until the secondary reports its own. **Invoices** downloads a clearly marked *draft* patient-share statement, not the whole insurer balance; the document builder likewise uses explicit patient share for client statements and separates payer portions. Review coverage and remittances before sending anything. The legacy QBO charge export excludes active COB pairs because it cannot allocate that balance to service lines.

Existing saved COB pairs with a consistent secondary paid total and no primary `secondaryPaid` are backfilled once; conflicting amounts are flagged `cobReviewNeeded` and block new COB postings or reported-PR billing rather than being silently capped. Original claim and payment histories remain available for manual investigation. The 835 importer deliberately parks secondary CLPs and now parks any primary with an active secondary filing. There is **no** secondary 835 auto-allocation, compliant secondary 837/1500, full EDI or bank reconciliation. This is a fictional-data demo, not a production billing or compliance system.

### Intake Manager — header, menus and stage transitions (previous round)

**The intake header kept breaking and the pipeline refused moves it had itself offered.** Every item below was reproduced in a real headless browser at 1280/1366/1440/1920 px, fixed, and re-verified end to end (board → drawer → waitlist → booking → calendar → conversion → client roster, plus the form and the referral register):

- **The top bar wrapped to two or three rows** (100 px at 1440, 138 px at 1280 with the primary button orphaned) because five filter controls lived inside the flex-wrapping `.secbar`. The header now carries only what never wraps — title, record count, board/list toggle and **New intake** — and the search + status/owner/source/urgency filters moved into a sticky **filter toolbar** (`iq-toolbar`) directly under it, with a live "n filters on" count and a one-click **Reset**. The bar is 55 px at every width, so the sticky `--secbar-h` offset holds and the KPI strip no longer jumps.
- **Header dropdown menus opened ~200 px away from their trigger and were clipped**, because the sticky header's `backdrop-filter` makes it the containing block for a `position: fixed` menu. `Popover` (shared by every `Dropdown`, `MultiSelect`, `PeoplePicker` and `InlineSelect`) now portals to `<body>`, opens below its trigger or flips above it when there is no room, closes on **Escape** or any outside click (its own trigger toggles it, and opening another menu closes the first), and sits at z 260 — above the intake drawer (220) and its modals (240), below toasts (300). The trigger also dropped the `.select` class, which painted a second chevron on every dropdown app-wide, and the long-ignored `style` prop now reaches the control.
- **The drawer hid its own stage rail and tabs.** `.iq-dbody` is a scrolling flex column, so the two children with `overflow-x: auto` (the rail and the tab strip) shrank to 4 px and 1 px as soon as the record overflowed the viewport. Drawer children are pinned to their content height, the eleven rail steps share the width without truncating, and disabled actions inside the module finally look disabled (`opacity .5`, `cursor: not-allowed`) — before, a greyed-out "Advance" rendered exactly like a live button.
- **Stage transitions dead-ended.** One `advanceTo(stage)` router now serves the rail *and* the "Next" box: **Waitlist** opens an inline form that captures the gate (reason, priority, review date, notes) and moves in the same action; **Assessment scheduled** opens the booking form instead of toasting "2 requirements outstanding"; **Converted** opens the conversion modal instead of the reducer's "use the conversion step" refusal; **Close** opens the disposition modal. The booking form requires an assessor and an end after the start, and the reducer enforces the same (plus "only from Clinical review / Waitlist", and no second visit while one is on the calendar). The **guardian-verified** conversion gate — previously impossible to satisfy from the UI — has a `Mark verified` control (with undo and an audit event). A waitlisted family gets a dated check-in instead of a blind +14 days, and a scheduled request whose visit disappeared from the calendar can rebook. Reopening a closed request clears the stale disposition and logs *Reopened*; a closed record's rail no longer shows every earlier stage as completed; logging a contact only auto-advances `new → contacted` when the real gate (owner + outcome) passes; conversion is refused from any step other than Authorization, matching `NEXT_STAGES`.
- **Escape peels one layer at a time** — menu, then modal / inline form, then drawer — instead of closing the conversion modal *and* the drawer together; a click on a modal backdrop closes that modal only. The nav's **Client Intake** entry always opens a blank form (it used to reopen whichever record was last edited from the drawer, with its saved id still attached). Relative ages read "6w ago" instead of repeating the date beside itself.
- **Tests.** `intakeUi.test.jsx` gained nine regression flows: header/toolbar shape and body-level menus with Escape, the waitlist form and dated check-in, rail → booking form with time validation and the calendar record it creates, guardian verification flipping the gate, reopening a closed request, Escape layering with the conversion modal, the contacted-gate rule for logged contacts, and a blank form after an edit; `intake.test.js` covers the conversion stage rule. Verified with `npm test` (551 passing) and `npm run build`.

### Intake Manager — the pre-client pipeline (previous round)

**A family used to exist nowhere until someone typed them into the roster.** Intake is now a first-class record with its own workflow: Clients → **Intake Manager** holds *General Intake Requests*, *Client Intake* and *Referral Sources*, and a request carries every fact the downstream modules will need before a chart exists.

- **A workflow, not a status field.** `new → contacted → screened → benefits → review → (waitlist | scheduled) → assessment → auth → converted`, with `closed` reachable from any open stage and requiring a not-admitted reason. The allowed transitions live in one place (`NEXT_STAGES` in `src/lib/intake.js`), the waitlist/book branch out of clinical review is a deliberate choice by a person, a closed request can be reopened, and every move is a single reducer transaction — **one Undo** reverses it.
- **Gates keep the promises downstream modules depend on.** *screened* needs name, DOB, guardian contact, diagnosis status, the caregiver's concern, a preferred setting and a triaged urgency; *benefits* needs payer, member ID, subscriber and plan; *review* needs a completed VOB (representative, call date, reference number) plus the diagnostic report and referral; *scheduled* needs an appointment that actually exists on the calendar and an assigned clinician; *converted* needs an authorisation decision with approved units and window, every required document received or waived, all required consents signed and a verified guardian. Documents are conditional — a school-based request owes an IEP/IFSP, a guardianship note adds custody paperwork — and the checklist only counts a document as satisfied when it is received or waived.
- **Conversion creates the client chart in one step and one Undo.** `Convert to a client chart` writes a real `clients` row that carries `intakeId`, `intakeNo`, `referralSourceId`, `intakeSourceLabel` and `intakeConvertedAt`, derives weekly authorised hours from the approved window, attaches any secondary (COB) coverage captured at intake, and re-points the booked assessment appointment at the new chart. The roster then shows the origin on the client row and opens the request from it, so the mapping reads in both directions and claims, scheduling and authorisation code paths see an ordinary client.
- **Referral Sources is an upstream ledger.** Physicians, developmental paediatricians, school districts, regional centers, hospitals, community organisations, self/family and web referrals each carry a relationship owner, NPI, contact details, a dormancy threshold and live volume/conversion/median-days-to-assessment figures; the pipeline can be filtered by source and the register links into it. Retiring a source that is already attributed to requests removes it from the picker without orphaning history.
- **KPIs follow the intake literature.** Volume and conversion by source, time-to-first-touch, referral→client conversion over *decided* requests, not-admitted by reason, waitlist age, payer mix, stage aging and stalled-record alerts. The UI quotes the benchmarks the design targets: callback within 15 minutes, benefits verification within 30 minutes and an intake appointment offered within 24 hours; roughly 55–70% conversion for a well-run intake and 25–35% for referral pipelines overall; every extra day between referral and appointment costs about 5–7% attendance.
- **Wired into the rest of the suite.** The Clients nav groups Intake Manager (Client List / Add New, then the intake sub-module) and badges the module with its at-risk count; the ⌘K palette jumps to the pipeline, a new intake client, referral sources, the needs-attention filter or a specific request; the client roster and profile show intake origin and link back; the dashboard offers an **Intake Pipeline** widget (funnel, KPIs, at-risk drill-down into the exact request); **Analytics** carries a pipeline band (conversion, time-to-first-contact, time-to-assessment, at-risk, top source) that opens the worklist or the full report; **staff profiles** show the requests a person owns and filter the pipeline to them; the layout/payer context flows through the request's office and payer ids; Reports has *Intake Pipeline & Referral Conversion*; and requests, sources and the converted charts are all inside the versioned workspace backup, validated on import (`normalizeIntake` drops dangling links rather than inventing records).
- **Scope & safety.** Everything is local to this browser and seeded with fictional families. There is no fax, portal, e-signature or payer connection: document actions record that something was received, requested or waived — they do not store the document — and the profile-picture control keeps local file metadata only, with binary content deliberately excluded from backups. Use fictional data only; this remains a demo, not a safe place for real PHI.
- **Tests.** `src/__tests__/intake.test.js` covers the state machine, every gate, SLA/aging/stalling, conversion planning, KPI denominators, normalisation and the seed's own integrity; `src/__tests__/intakeUi.test.jsx` drives the nav shape, the empty state, form validation and save, the referral register, the convert-into-roster flow and the dashboard/palette integrations.

### Payroll cycle overview & phased wizard (prior round)

**The payroll phases were unreadable on the landing page and in the wizard.** Three defects, one root cause each, all fixed and re-verified in a real browser:

- **The phase panels were clipped to 36px slivers.** `.pay-phase` was a shrinking flex child (`flex-shrink: 1`) inside the scrolling `.sectionpage` column with `overflow: hidden` — so `PHASE 2 OF 4` rendered as a one-line header and every control inside it (gates, guide, approval form) was scrolled out of a box that could not grow. Phase panels are now `flex: 0 0 auto` with `overflow: visible`; nothing in a payroll page can shrink or clip again (`.sectionpage.pay-hub > *` / `.pay-wizard-body > *` are pinned to their content height).
- **The four phases stacked on top of each other**, so "Approve" sat below the exception list, the KPI strip and an 866px register, and "Process & pay" rendered on the same screen as the approval form it was blocked by. The wizard now renders **one phase at a time**: the active phase in full, completed phases as compact recap rows with a **Change** button back into them, upcoming phases locked in the rail (they say why). The register, KPIs and gates are phase 2's content — they no longer follow the user into phases 3 and 4. New regression tests assert exactly one phase panel is mounted and that recaps navigate back.
- **Clicking Payroll dropped the user mid-wizard with no context.** Payroll now lands on a **cycle overview**: the current pay cycle (period, frequency, pay date, cutoff, eligible employees, worked hours), live checks with "Show n affected employees", the four phases as clickable status cards (done / you are here / next), one primary CTA that opens the wizard at the phase that is *next*, recent pay runs and tiles into every other payroll screen. The phase model is defined once (`PAY_PHASES` + `runProgress` in `PayrollCommon`) and shared by the landing page, the wizard rail and the panels, so the two routes can never disagree.

Phase semantics are unchanged: blockers still stop approval, exceptions are still recorded on the run, approval still needs a second person, and processing still re-prices and locks the register. Every payroll screen also carries the same module sub-nav (Cycle overview · Process Payroll · Pay Runs · Timesheets · ID Mapping · Summary · QuickBooks · Setup) with the rail ids unchanged, and each payroll page is a plain content-height column so its own tables and pagers lay out normally.

### Payroll Review Register & guided phases (prior round)

1. **Review Register drill-down.** "Show n affected employees" on Process Payroll → Review used to fire a toast; it now opens a list-view modal of every affected employee with the exact issue(s) on their record. Each row has a one-click **fix action that redirects to the module that can resolve it** — Payroll ID Mapping (missing/duplicate payroll IDs, rates, salary, exempt review, deductions, work state) or Timesheet Submission (unapproved sheets, EVV gaps, zero pay) with the employee pre-focused (profile editor or timesheet opens directly), and run-level issues (duplicate run, OT multiplier, rounding policy) link to Pay Runs / Payroll Setup. Draft runs can also **exclude an affected employee in-register** from the modal; excluded staff stay payable in a later off-cycle run. Blockers and exceptions both offer the drill-down.
2. **Guided payroll phases.** The Process Payroll wizard's four phases — Select period → Review register → Approve → Process & pay — are now a designed path: an icon rail with per-phase subtitles and state colouring (done / active / upcoming), and phase panels with a tone-coded icon tile, "Phase n of N" context, a numbered how-to guide and explicit next-step CTAs (Continue to approval →, Approve payroll, Process payroll). Gate semantics are unchanged: blockers still stop approval and exceptions are still recorded on the run.

### Claim-linked patient receipts (previous round)

- In **A/R Manager**, drill into a client and choose **Record receipt** on a primary claim with a remaining patient share. The draft Invoices view has the same shortcut. Alternatively use **Payment Center → + Patient receipt** and select a client and eligible primary claim. The amount must be positive, no more than that claim's **remaining explicitly reported patient responsibility** (or open self-pay balance), in cents, with a valid date, method and unique client receipt reference. A pending secondary filing suppresses patient collection until its own adjudication reports responsibility. One receipt applies to **one claim**; split deposits and allocation of previously unapplied receipts are not supported.
- Patient cash is recorded separately as `patientPaid` on the **primary** and as a payment-ledger entry with its original report source (primary or adjudicated secondary). It reduces the sole practice A/R and remaining patient share **once**; payer `paid`, `secondaryPaid`, secondary adjustments and the child filing remain unchanged. A self-pay invoice tied to that claim updates in the same Undo step. The A/R buckets, draft patient statement, claim register and invoice builder show the net balance rather than treating an unknown insurance remainder as family debt.
- Payment Center shows patient receipts and signed local reversals, with **Patient audit CSV** (references, date, recorded time, claim, source, amount, note, reversal link). A reversal restores the claim/invoice and patient A/R in one Undoable transaction, but **does not refund or move money in a bank/card system**. Duplicate/overprecise payments and mismatched local ledgers are blocked; backups containing torn patient receipt aggregates are rejected. Until allocated patient receipts have been reversed locally, changing the underlying payer remittance or creating a new secondary filing is conservatively held for review. Real-world refunds and adjustments must be verified externally.

No card charge, live patient billing, deposit reconciliation, cross-claim patient allocation, service-line ERA allocation, compliant secondary document, clearinghouse transmission or production accounting connection is provided. Use fictional data only.

## Working on this codebase

Keep pure billing/backup calculations in `src/lib/`, financial transitions in a **single** reducer action so one `U` can reverse them, and cover both the UI action and persistence in tests. Do not save Undo snapshots to localStorage: the seeded calendar already contains ~1,000 appointments. When adding a durable collection, add it to `WORKSPACE_FIELDS` in `src/lib/workspaceBackup.js`, validate it on import, and include it in a round-trip/Undo test. Export a backup before destructive migrations or before replacing local storage.

Next useful areas to verify against the older spec are secondary document format fidelity, service-line ERA/PLB-to-deposit reconciliation, and an end-to-end external COB/deposit/refund reconciliation workflow. No real PHI or live EDI traffic should be used for those tests.

For the scheduling line specifically, the intended next three are ranked in `docs/specs/scheduling-intelligence-ideas.md` §6: the unit-level authorization ledger with per-payer rule packs, travel feasibility and route sequencing, and structured cancellation reason codes.

## License

No license granted — demo/portfolio work; “CP-inspired” refers to general scheduling-software UX patterns only.
