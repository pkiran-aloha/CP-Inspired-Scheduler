# Intake

_Sources: src/lib/intake.js, src/lib/intakeDocs.js, src/components/intake/IntakeCommon.jsx, src/components/intake/IntakeDetail.jsx, src/components/intake/IntakeFormView.jsx, src/components/intake/IntakeRequestsView.jsx, src/components/intake/ReferralSourcesView.jsx, src/components/NavRail.jsx, src/App.jsx, src/state/store.jsx, src/lib/security.js, src/lib/workspaceBackup.js_

_Last synced with main at c8e666b on 2026-10-04 (plus the Cabinet)._

[Wiki home](README.md) · Related: [Scheduling](scheduling.md), [Settings](settings.md), [Dashboard and reports](dashboard-and-reports.md)

## User guide

Intake is the pre-client pipeline: a family inquires, the team gathers what a payer and a clinician need, and the request becomes a client chart. It lives under **Clients > Intake Manager** in the sidebar, with three entries:

- **Intake Requests**: the pipeline as a board or a list.
- **New Intake**: a blank intake form, never a stale edit. A first call needs only these: name, date of birth, office, a phone, the guardian with a phone or email, and an intake owner. Alias and address can wait.
- **Referral Sources**: the register of who refers families and how well each source converts.

Everything is recorded locally. Logging a contact, recording a verification call, or "submitting" an authorization request keeps a record of what staff did outside the app. The app contacts no family, payer or portal.

### Working the pipeline

The board has one column per stage and a sticky filter toolbar (search, status, owner, source, urgency). The header holds the title, the record count, the board/list toggle and **New intake**. Click a card to open the detail drawer.

Stages, in order, with the working-day budget before a record counts as aging (tightened by urgency):

| Stage | Meaning | Budget |
|---|---|---|
| New referral | Inquiry captured, nothing verified | 1 |
| Contacted | A live conversation happened | 2 |
| Screened | Clinical pre-screen: fit, setting, urgency | 3 |
| Benefits verified | Eligibility and cost share confirmed | 2 |
| Clinical review | BCBA confirms appropriateness | 3 |
| Waitlist (branch) | Ready, but no capacity | 14 |
| Assessment scheduled | A dated visit is on the calendar | 7 |
| Assessment complete | Recommendation recorded | 5 |
| Authorization | Request recorded, decision tracked | 5 |
| Converted to client | Client chart exists | none |
| Closed / not admitted | Disposition recorded with a reason | none |

Urgency (Emergency, Urgent, Routine, Low) scales the budget: Emergency 0.25x, Urgent 0.5x, Routine 1x, Low 2x. A record is **overdue** past its budget and **stalled** when nothing has been logged or changed for 5 days.

Moves follow a fixed graph; a request cannot skip stages. Only Clinical review has a real branch (Waitlist or Assessment scheduled). Any open stage can go to Closed; a closed request can be reopened to New.

**Gates.** Each target stage lists what must be true before a record can enter it. The detail drawer's **Next** box names the one thing to do next ("Log a contact attempt", "Capture the member ID") and the pipeline rail buttons route through the same check, so a click cannot bypass a gate. In outline:

- Contacted: an owner is assigned and one contact attempt is logged with an outcome.
- Screened: child name and DOB, guardian contact, diagnosis status, concerns, setting preference, urgency, and a saved pre-screen fit decision.
- Benefits verified: payer, member ID, subscriber details, plan type, insurance card received.
- Clinical review: verification marked complete with the payer representative, call date and reference recorded, a BCBA assigned, diagnostic report and referral received.
- Waitlist: reason, priority and a next-review date (the promise to the family).
- Assessment scheduled: an assessment appointment booked and a clinician assigned.
- Assessment complete: date, instrument, outcome and recommended hours per week with setting.
- Authorization: submission date and the requested units with a window.
- Converted: payer decision recorded, approved units and window (unless "not required"), all required consents signed, every required document received or waived, guardian identity verified.
- Closed: a not-admitted reason (a note is required for "Other").

Specific moves behave as follows:

- **Waitlist** opens an inline form (reason, priority, review date, notes) and moves in one action. A later check-in needs a new review date.
- **Assessment scheduled** opens the booking form. Booking creates an evaluation appointment on the calendar owned by the chosen clinician, and the booking is the move.
- **Converted** opens the conversion modal (below).
- **Escape** closes one layer at a time: menu, then modal or inline form, then drawer.

### The detail drawer

The **Next** box lists what the next stage needs. Each unmet item has a **Fix** button that opens the tab (or the full form) where that item is recorded. Waitlist, booking and close-out items are filled in the inline forms instead. After conversion you land on the new client's profile.

Six tabs: Overview, Contacts, Benefits (VOB), Clinical, Docs and consents, Timeline. Documents have a status (Missing, Requested, Received, Waived, Expired) and only Received or Waived count. Required documents depend on the record: an IEP/IFSP for school-based settings, custody papers when a guardianship note exists. Consents (treat, HIPAA, financial responsibility are required; media, telehealth, records release are optional) are captured on screen, not sent. The Timeline shows every logged event.

**Downloads.** Both are generated in the browser and nothing is sent; print them or attach them to your own email.
- **Summary PDF** (in the drawer header) is everything on the request. It covers child, guardian and emergency contact, referral, clinical, insurance and benefits, assessment and authorization, and the status of every document and consent. It contains client information.
- **Intake packet** (on the worklist toolbar) is a blank packet for families to fill in. It has fill-in fields, a checklist of documents to bring, and a signature line for each consent. The practice supplies its own consent wording; the packet lists which consents are needed.

### Converting to a client

Convert is available only from Authorization with every converted-gate item met. One action creates the client chart, links the request and the client both ways, copies attribution to the referral source, and (if an assessment visit exists) attaches the new client to that appointment and confirms it. One Undo reverses all of it.

Mapping notes:
- **Approved units:** the payer's approved units (15-minute units, the Medicaid norm) become the client's authorization pool under 97153. They are marked *converted, verify against the payer letter*, because the request does not record which codes the units cover. Split them by code under Clients > Edit; saving confirms them. The unit guard in [Scheduling](scheduling.md) uses this pool.
- **Weekly hours:** `authWeekly` is the units × 15 minutes ÷ the window's weeks, capped at 80.
- **Window and payer:** `authStart` and `authEnd` come from the window, and the payer name becomes `insurer`.
- **Other fields carried:** the chart also gets the member ID, group number, authorization number, diagnosis, assigned BCBA and emergency contact. Claims and the CMS-1500 print that member ID and authorization number (see [Billing and claims](billing-and-claims.md)).

### Referral Sources

A register with owner, volume, conversions, conversion rate, median days to assessment and last referral. A source tied to live requests cannot be deleted: it is marked dormant instead. The navigation badge and the header KPIs come from `intakeKpis`: open, new this week, conversion rate, median first-contact days, stalled and overdue counts, waiting families, funnel and lost reasons.

## How it works

### Pure engine

[intake.js](../../src/lib/intake.js) holds everything domain-level:

- Stages and graph: `INTAKE_STAGES`, `NEXT_STAGES`, `nextStages`, `defaultNextStage`, `nextStageFor`, `stageDef`, `isTerminal`, `isWon`, `isLost`, `OPEN_STAGES`, `FUNNEL_STAGES`.
- Timing: `slaDays`, `slaState`, `lastTouchAt`, `isStalled`, `TOUCH_SLA_DAYS`, `URGENCY`.
- Gates: `GATES` keyed by target stage, `gateBlockers`, `gateItems`, `gateProgress`, `readiness`, `nextAction`.
- Documents and consents: `INTAKE_DOCS`, `DOC_STATUS`, `docStatus`, `docSatisfied`, `requiredDocs`, `docProgress`, `CONSENT_KINDS`, `requiredConsents`, `consentSigned`.
- Metrics: `intakeKpis`, `sourceStats`, `firstContactDays`, `referralToAssessmentDays`, `referralToServiceDays`.
- Records: `blankIntake`, `intakeNo`, `normalizeIntake`, `planConversion`.

### Write path

Intake does not follow the strict plan-then-Tx pattern. Domain actions in `createActions` ([store.jsx](../../src/state/store.jsx)) do the validation and dispatch one `intakeTx` action, which the reducer applies without re-planning:

- `saveIntake` (a form save keeps the current stage; stage changes go only through `moveIntake`), `patchIntake`, `logContact`, `moveIntake` (gate enforcement inline), `reviewWaitlist`, `scheduleIntakeAssessment`, `convertIntake`, `deleteIntake`, `saveReferralSource`, `removeReferralSource`.
- Only conversion has a pure planner: `planConversion` returns `{ok, msg, client, intake, apptPatch}`, and `convertIntake` dispatches `intakeTx` with `upserts`, `clients` and `apptPatches` so one Undo reverses everything.
- The `intakeTx` reducer case writes `intakeRequests`, `referralSources`, `clients` and `appts` and takes one snapshot of the touched collections.
- Permissions (`src/lib/security.js`): `intakeTx` needs the `intake` area, plus `clients` when it adds a client and `calendar` when it touches appointments.

### State and migration

- Collections: `intakeRequests` (map by id), `referralSources` (list); both are in `WORKSPACE_FIELDS` in [workspaceBackup.js](../../src/lib/workspaceBackup.js) and validated on import.
- `normalizeIntake` (wired into `normalizeWorkspace`) keys records by their own id, nulls dangling client, source, staff, payer and appointment links rather than re-pointing them, gives a missing reference number `INT-####`, and returns the same state object when nothing changes. A won request with no client is flagged `convertedClientMissing`.
- New fields on clients: `intakeId`, `intakeNo`, `referralSourceId`, `intakeSourceLabel`, `intakeConvertedAt`. New field on appointments: `intakeId`.

### Components

[IntakeRequestsView.jsx](../../src/components/intake/IntakeRequestsView.jsx) (board, list, toolbar), [IntakeDetail.jsx](../../src/components/intake/IntakeDetail.jsx) (rail, `advanceTo`, tabs, conversion, booking and waitlist forms), [IntakeFormView.jsx](../../src/components/intake/IntakeFormView.jsx), [ReferralSourcesView.jsx](../../src/components/intake/ReferralSourcesView.jsx), [IntakeCommon.jsx](../../src/components/intake/IntakeCommon.jsx). Routes are `intake`, `intake-new` and `referrals` in `App.jsx`. Test ids use the `iq-` prefix.

### Tests

`intake.test.js` (pure engine: graph, gates, SLA, KPIs, normalization, conversion), `intakeDocs.test.jsx` (summary and packet content, real PDF output, both downloads) and `intakeUi.test.jsx` (header and toolbar shape, menus, waitlist form, rail to booking, guardian gate, reopen, Escape layering, conversion). Backup coverage is in `workspaceBackup.test.js`.

## Not yet built

- **No e-signature or fillable PDF.** The intake packet is printed and signed on paper; signed consents are then recorded on screen. The assessment visit and the client chart are still separate records until conversion (see below).
- **Nothing is transmitted.** Benefits verification is a recorded call and reference, not an eligibility query. Authorization is recorded, not submitted. Consents are captured on screen, with no e-signature service or portal.
- The assessment appointment is created without a client and bypasses the scheduling guards in [Scheduling](scheduling.md).
- No intake task or message center yet (planned with inbox and notifications). The `tasks` field on a request exists but has no screen.
- The intake guard strength is fixed: gates always block. There is no off/flag/warn/stop setting for intake gates.
