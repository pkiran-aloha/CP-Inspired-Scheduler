# Scheduling intelligence — a research brief and build plan

**Status:** three of the ideas below are implemented in this round (see [Shipped](#shipped-this-round)); the rest are ranked, sized and grounded so they can be picked up directly.

**Scope of this brief.** The question was how to make scheduling *smarter* and *analytically visual*. The answer here is deliberately not "add AI". ABA scheduling already has a well-understood failure taxonomy — authorizations that run dry, clinicians who sit idle while families wait, sessions that evaporate — and every one of those is measurable from data this app already holds. The brief ranks interventions by how much money and clinical continuity they protect per unit of build effort, and marks honestly what the workspace already does.

---

## 1. Method

**Inside the repo.** Read `src/lib/smart.js` (candidate ranking + backfill), `src/lib/analytics.js` and `src/lib/reports.js` (metrics, pivots, burn-down), `src/lib/model.js` (types, billing), `src/lib/settingsMasters.js` (validation severities, settings transactions), `src/components/AppointmentModal.jsx`, `TimeGrid.jsx`, `NeedsCover.jsx`, and the store's planner/transaction pattern in `src/state/store.jsx`.

**Outside the repo.** Teardowns and documentation of what the commercial ABA platforms actually ship (CentralReach ScheduleAI, RethinkBH, AlohaABA, Theralytics, Artemis), plus the general outpatient-scheduling literature (fill-rate targets, no-show prediction, capacity planning) and ABA-specific billing guidance on authorization tracking. Sources are numbered in [§7](#7-sources).

**What this brief does not do.** It does not propose anything that requires a network connection, a payer integration or a machine-learning service. The app is local-first by design and states plainly what it has and has not done; a "smart" feature that implies a transmission would break that promise.

---

## 2. The honest baseline — what the scheduler already does

Ideas are only useful if they are not already built. Today:

| Capability | Where | Coverage |
|---|---|---|
| Ranked staff suggestions (care team, history, role fit, load, turnaround) | `lib/smart.js` → `suggestStaff` | **Strong.** Weights are configurable in Settings. |
| Cancellation backfill inbox with scoring + auto-fill | `NeedsCover.jsx`, `scanNeedsCover` | **Strong.** Explains *why* each candidate ranks. |
| Conflict detection, overlap stacking, series edits | `model.findConflicts`, `TimeGrid` | **Strong.** Warns, never blocks. |
| Utilization, cancellations, no-shows, revenue, pivots, heat | `analytics.js`, `AnalyticsView`, `DashboardView` | **Strong as reporting** — but it lives in Analytics, not where the booking happens. |
| Authorization burn-down, gaps, supervision coverage, re-assessment | `reports.js` | **Present as reports**, computed after the fact. |
| Authorization awareness *at the moment of booking* | — | **Absent.** This is the single biggest gap. |
| Cancellation/no-show risk scoring | — | **Absent.** The ledger knows who misses sessions; nothing reads it. |
| "Where is my capacity, right now" | — | **Absent as a scheduling surface** (a heat widget exists on the dashboard only). |

The pattern in the gap column is the same three times: **the intelligence exists in reports, and reports are read after the decisions are made.** Moving that intelligence into the calendar is the theme of what shipped.

---

## 3. What the evidence says

The findings that actually change design decisions, with the implication each one forces.

**1. Authorization failure is the dominant revenue leak in ABA.** Authorization-related denials are estimated at ~34% of all ABA claim rejections — expired windows, exceeded units, missing reauthorization. [3] The recommended control is explicitly a *scheduling* control: check authorization status at the point of scheduling and either block the session or flag it before delivery, because that "moves the check from 'someone remembers to look' to 'the system won't let it happen'". [5]

> **Implication:** an authorization check that only runs at claim staging is too late. It has to run in the booking dialog, and it has to be *graded* — off / flag / warn / stop — because a hard block on every overage would make the calendar unusable in the messy real cases.

**2. The renewal clock has two triggers, and both are calendar facts.** Standard guidance: alert 30 days before expiry and at 75% of units consumed, and begin the re-authorization packet at whichever comes first. [3][4] ABA authorizations are a *finite pool of 15-minute units tied to a date range*, so a plan can run out of units well before it runs out of calendar days. [5]

> **Implication:** the burn-down must show two numbers per client — the window budget and the weekly pace — plus a projected exhaustion date. A single percentage hides which one is about to break.

**3. Under-delivery is punished as hard as over-delivery.** Authorization utilization is expected to sit at 90–100%; chronic under-delivery is used by payers to justify a *smaller* renewal. [6]

> **Implication:** under-pacing is a real signal and belongs on the board — but it is coaching, not an error, so it must never escalate a booking refusal. (This distinction is enforced in `authBudget.js`: `reasons` escalate, `notes` advise.)

**4. Utilization targets are role-specific and narrower than people assume.** 75–85% billable utilization for RBTs, 65–75% for BCBAs (who carry non-billable supervision and documentation). [6] In the general outpatient literature, an 85–95% *schedule fill* is the healthy band; below it is wasted capacity, above it is burnout and access failure. [7][8][12] In-home practices legitimately run lower (60–70%) because travel consumes the day. [6]

> **Implication:** a single practice-wide fill percentage is misleading. Show fill by weekday × hour so the *shape* of the week is visible, and let the reader see that Friday 4pm is always empty while Tuesday morning is always full. That is what the coverage grid does — and the healthy band is labelled on screen rather than implied.

**5. Cancellation is predictable from a practice's own ledger.** In a multi-specialty study of 245,780 appointments (12.8% no-show rate), the strongest predictors were *the patient's own prior no-shows and historical show rate*, followed by lead time, day of week (Mondays and Fridays worse), age and insurance type. [11] Reported gains from acting on such scores: 20–40% no-show reduction, 5–10% utilization gain [9]; a before/after deployment in primary care reported an 86%-accuracy model with large reductions in no-shows and wait times. [10]

> **Implication:** no ML service is needed — a smoothed, explainable model over the local ledger captures the dominant signal. And because the point is *triage*, the output must be a worklist with a named next action, not a number on a card. Alert fatigue is the failure mode of every reminder system. [9]

**6. Continuity is a clinical variable, not a scheduling nicety.** ABA staff turnover was 77.4–103.3% in 2024, and client progress drops by more than 50% when a child experiences two or more RBT changes in a year. [6]

> **Implication:** "this session has a technician the client has never met" deserves to be visible at booking time, not discovered later. It also belongs in the risk score — with the source labelled as policy rather than as something the data taught.

**7. The commercial platforms converge on the same three moves.** CentralReach's ScheduleAI advertises density-optimised scheduling, credential matching, automated backfill and route scheduling that minimises drive time, with authorization limits and credentialing built into the scheduling workflow. [1][2] RethinkBH emphasises authorization tracking that flags unit shortages *before they affect scheduling* and an operations dashboard that ranks risks by urgency with one-click navigation to the exact place that fixes them. [2]

> **Implication:** two things this codebase can do unusually well, because the data model is unified: (a) every insight links to the record that resolves it, and (b) "flagged for a reason" is explainable rather than a black box. Both are cheap here and expensive in a modular suite.

**8. Every system contains hidden capacity.** A National Academy of Medicine review of scheduling practice found "hidden available capacity throughout most systems" and recommended matching supply to demand using usage data by month, day, time and patient type. [12] Standard templates fill 85–90% of slots a week out and hold 10–15% for same-day needs. [12]

> **Implication:** the most valuable capacity visual is not a KPI, it is *named idle windows* — "Sam is free Tuesday 12:00–18:00". Capacity you cannot put a name to is capacity nobody books into.

---

## 4. The idea catalogue

Grouped by theme. **Effort** is sized against *this* codebase (S ≈ under a day's focused work, M ≈ a few days, L ≈ a week or more with tests and guards). **Coverage** notes where the workspace already does part of the job.

### A. Authorization intelligence

| # | Idea | Evidence | Effort | Status |
|---|---|---|---|---|
| A1 | **Book-time authorization guard.** Graded off/flag/warn/stop. Shows committed → remaining before and after this booking, the weekly pace against the authorized week, days to expiry and a projected exhaustion date. | [3][4][5] | M | **Shipped** |
| A2 | **Unit-level authorization ledger.** Model the authorization as a pool of 15-minute units per CPT code with per-code sub-caps, consumed as sessions are delivered — closer to how payers actually audit than a weekly-hours approximation. | [5][3] | L | Shipped (`authUnits.js`) |
| A3 | **Renewal watchlist and packet builder.** Turn "30 days / 75%" into a worklist that opens a renewal packet (window, hours delivered, latest progress note, expiring codes) as a local export. | [3][4] | M | Partly: alerts + projected exhaustion ship; no packet |
| A4 | **Payer rule packs.** Per-payer weekly caps, daily unit caps, credential modifiers required and concurrent-care rules, applied as scheduling guards the way payer policy tables already drive billing. | [1][2][6] | M | Shipped: MUE daily + weekly caps, credential check (`authUnits.js`) |

### B. Capacity and density

| # | Idea | Evidence | Effort | Status |
|---|---|---|---|---|
| B1 | **Coverage heat + named idle windows.** Weekday × hour fill against the working day, blocked time removed from the denominator, plus a ranked list of contiguous free windows per clinician, each clickable through to that day and that person. | [7][8][12] | M | **Shipped** |
| B2 | **Density optimiser.** Suggest pulling a session into an adjacent idle window so a clinician ends up with a contiguous block instead of a split day — fewer drive legs, more open half-days, better RBT retention. | [1][12] | M | Not built |
| B3 | **Travel feasibility and sequencing.** Use `clients.geo` and existing drive appointments to detect impossible turnarounds and propose a re-ordered day. In-home practices run 60–70% utilization largely because of travel. | [1][6] | M/L | Not built |
| B4 | **Access holdout.** Reserve a configurable share of each week for new starts and same-day needs, and show on the coverage grid where that reservation is being eaten. | [12] | S/M | Not built |
| B5 | **Credential-aware density.** Refuse/suggest against the credential the payer requires for a code (BCBA vs RBT vs BCaBA) using the qualification master that already exists. | [1][6] | S | Partly (`staffSatisfiesCredentials` exists; not wired to booking) |

### C. Risk, continuity and root cause

| # | Idea | Evidence | Effort | Status |
|---|---|---|---|---|
| C1 | **Cancellation risk worklist.** Explainable per-session score fitted on the practice's own resolved appointments, plus policy factors (lead time, unconfirmed, backfilled, rescheduled, new technician), with an intervention and a one-click confirm. | [9][10][11] | M | **Shipped** |
| C2 | **Continuity guard at booking.** Warn when the assigned technician has no history with the client, and track technician churn per client per quarter. | [6] | S | Partly: the factor ships in the risk score |
| C3 | **Cancellation reason codes and root cause.** The workspace already stores cancellation statuses and a payroll cancel policy; capturing a structured reason turns "12% cancellations" into "41% of these are transport, and they cluster on Fridays". | [11] | S/M | Shipped (`cancelReasons.js`) |
| C4 | **Calibrated overbooking guidance.** Given the practice's own no-show rate, show which slots would historically have been safely double-filled — advisory only, never automatic. | [9][11][12] | M | Not built |
| C5 | **Supervision ratio compliance.** Weekly BCBA supervision ratio per technician/caseload, surfaced where sessions are booked rather than only in a report. | [6][2] | M | Partly (`reports.js` has supervision coverage) |
| C6 | **Re-assessment and plan-expiry cadence.** Schedule the re-assessment *before* the authorization that depends on it expires. | [3][4] | M | Partly (`reassess` report exists) |

### D. Demand and planning

| # | Idea | Evidence | Effort | Status |
|---|---|---|---|---|
| D1 | **Caseload ramp forecast.** Project authorized hours demanded 4–12 weeks out from the intake pipeline and each client's authorized week, versus clinician hours available. | [6][12] | M | Not built |
| D2 | **Hire/contract decision support.** "Before you hire, check whether the gap is demand or schedule shape" — the utilization dashboard literature is explicit that low utilization plus long waits means a template problem, not a capacity problem. | [8][12] | S/M | Not built |
| D3 | **Intake → first-session handoff.** Turn an approved authorization into a proposed weekly template with the ranked staff suggestions already computed, so a converted referral does not wait on a scheduler's free moment. | [1][6] | M | Not built |
| D4 | **Scenario planner.** "What if we open Saturdays?" / "What if this client gains 5 h/week?" re-run coverage and authorization burn with hypothetical inputs, without writing them. | [12] | L | Not built |

---

## 5. Shipped this round

Three ideas, chosen because together they answer the three questions a scheduler asks when the week is already full — *where is my capacity, whose authorization is about to break, and which of these sessions will evaporate* — and because all three are computable from data already in the workspace.

### 5.1 `src/lib/authBudget.js` — authorization budget

Pure engine. The authorization on file (`authWeekly` hours across `authStart → authEnd`) becomes a dated, consumable budget.

- `clientAuthWindow(client, today)` → window, weeks, authorized hours, days to expiry.
- `authBurn(state, clientId, { today, exclude, extra, on })` → delivered vs scheduled vs committed hours, remaining, percentage, the *booking week* against the authorized week, and a projected exhaustion date from the recent pace **and** the hours already booked.
- `authCheckFor(state, client, draft, { today })` → `{ severity, blocked, headline, reasons[], notes[], stats }`.
  - `reasons` escalate `flag → warn → stop` and are problems with **this** booking (window lapsed, budget exceeded ≥ the block threshold, week over the cap, expiry imminent).
  - `notes` advise and never escalate (projected exhaustion, under-paced delivery).
  - A clinical session explicitly marked outside ABA hours is **not** silently ignored: the guard says so and offers a one-click `⚡ Count it`. That was a real bug found while testing — every new booking defaults the flag off, so the guard would otherwise have been a no-op exactly when it mattered.
- Only sessions dated **inside** the window draw on it. Consecutive authorizations cannot double-spend.
- `authGuardCfg(settings)` + `AUTH_MODES` — **off / flag / warn / stop**, with warn-at-%, block-at-%, renewal-alert days and the under-pace threshold all configurable in Settings → System Settings → **Authorization guard**. Shipped default is **warn**: the calendar tells you, and you decide.

**Honest scope, stated in the UI:** the window total is weekly hours × weeks on file, which is an estimate of the authorized pool, not a claim about units a payer has granted. The guard never contacts a payer and never changes a claim — claim staging keeps its own independent authorization checks in `claims.js`.

### 5.2 `src/lib/risk.js` — cancellation and no-show risk

- `riskModel(state)` fits, on this workspace's resolved appointments: a Laplace-smoothed base event rate, shrunk per-client rates, and day-of-week / time-of-day cohorts that only report once they have enough support (`minSupport`), otherwise saying so in plain language.
- `riskFor(state, appt, model)` returns a 0–100 score, a band, a named next action, and a **factor list where every factor carries `source: 'model'` (learned here) or `source: 'policy'` (a documented rule the ledger cannot learn)**. The UI renders that distinction rather than hiding it.
- `riskQueue(state, days)` returns the worklist plus the money at stake: expected lost hours and probability-weighted scheduled charge.
- Lead time is applied as policy, not fitted — the workspace stores no booked-at stamp, so fitting a cohort on it would be inventing a number. That is written down in the code.

**Honest scope, stated in the UI:** not machine learning, not clinical judgement, and no reminder is ever sent. Confirming a session here is a local status change (undoable, one Undo step) so the practice knows *who* still needs a phone call.

### 5.3 `src/lib/insights.js` + `SchedulerInsights` — the visual surface

One panel, opened from the calendar toolbar or with `I`, scoped to whatever range the calendar is showing:

- **Four KPIs** — schedule fill (against the 85–95% healthy band, labelled), open capacity in hours, authorizations needing action, at-risk sessions with expected lost hours.
- **Coverage** — a weekday × hour heat grid shaded by fill with a legend, a 42-cell-per-week view for ranges ≥5 days and a per-day strip for shorter ones; below it, **named idle windows** ("Tess Tech · Tue · 08:00–18:00, 10h") that click straight through to that day filtered to that clinician.
- **Authorizations** — burn-down bars with committed/authorized hours, this week against the authorized week, days to expiry, projected exhaustion and a band chip; scope toggle between needs-action and all clients.
- **At risk** — the riskiest sessions with score, factors (history vs policy, colour-coded), the top reason in words, the recommended action, one-click **Confirm** and **Open**.

The pattern of "ranked by urgency, one click to the exact place that fixes it" is deliberately borrowed from what the mature platforms converged on [2]; the difference here is that every number is traceable to records in the same workspace.

**Also wired:** the booking dialog renders the guard verdict and the risk verdict inline before you save, with the same numbers the panel shows; Settings gained the guard controls; a restored backup re-merges the guard defaults rather than losing them; and `setSettings` routes `authGuard`/`risk` to the *calendar* permission rather than the settings desk, because schedulers own this, not administrators.

### Verification

- `authBudget.test.js` (23) — window maths, live/lapsed/missing windows, what does and does not draw on the budget (travel, breaks, non-ABA-marked), week boundaries honouring the practice week start, projections, exclude-on-edit, every guard severity, mode capping, the not-counted advisory, and board ranking.
- `schedulingRisk.test.js` (18) — model fitting and shrinkage, thin-data messaging, refuse-a-ceiling, model vs policy provenance, ordering guarantees (bad history > clean, far > near, unconfirmed > confirmed), continuity, already-recorded outcomes, the disabled switch, and the worklist's hour/charge exposure.
- `schedulerInsights.test.js` (12) — capacity sold vs available, blocked time removed from the denominator, travel counted as sold but never as a session, per-clinician idle windows, the unified board and its KPI tones.
- `schedulerInsights.test.jsx` (12) — the panel opens, the three tabs work, a lapsed authorization is reported and counted, the risk row explains itself and confirms undoably, nothing claims to be transmitted, and the guard is proven end-to-end: it refuses a save in Stop mode, allows it in the shipped Warn mode, and flags an uncounted clinical session.

Full suite: **616 tests across 49 files, green.** `npm run build` passes.

---

## 6. Recommended next three

If the next round takes three of the ideas above, this is the order I would argue for:

1. **A2 + A4 — the unit ledger and payer rule packs.** The guard that shipped works on weekly hours because that is all the workspace stores. The evidence says the money is in *units* and in payer-specific caps. [3][5] Extending the authorization master to per-code unit pools, with per-payer rule rows, keeps the same guard surface and the same panel — it upgrades the arithmetic behind them and closes the biggest single denial category.
2. **B3 — travel feasibility and sequenced routes.** In-home practices lose 30–40 points of utilization to travel [6], and route optimisation is a headline capability of the market leader [1]. The data is already here (`geo` on clients, drive appointments with origin/destination and mileage). The visible output — a day that is physically possible, with the impossible legs called out before someone promises a family a 3:15 start — is the kind of thing that makes a scheduler trust the software.
3. **C3 — cancellation reason codes.** The risk model is only as good as its labels. Structured reasons turn the cancellation status into a root-cause view, sharpen the risk model's client history, and give the practice its first honest answer to "why do we keep losing Friday afternoons?" — which is also the input that makes C4 (overbooking guidance) defensible rather than reckless.

**Worth doing when the surrounding module lands:** B4 and D1 depend on practice decisions (how much capacity to hold back; when a hire is justified) that are better made once the coverage grid and the burn-down have been used for a month.

---

## 7. Non-goals and honesty constraints

These would each be a mistake to build in this codebase today, and the reason is the same one every time: they would make the app claim something it cannot verify.

- **No automated outreach.** No SMS, no email, no robocall. The Text Messaging module is deliberately opt-in and non-transmitting; a "risk" here produces a prompt for a human, and the UI says so in the panel, on the row, and in the toast after confirming.
- **No "AI", no learned models presented as black boxes.** Every score is arithmetic over the workspace's own records, with its factors listed and its provenance labelled. Calling a logistic fit "AI" would be marketing, not engineering.
- **No predicted demand sold as a forecast.** D1 is a ramp from *known* authorizations and the intake pipeline — not a statistical forecast of referrals.
- **No hard blocking by default.** The guard ships in Warn mode because a scheduler mid-crisis must be able to override with intent. Stop is available, and it is a decision the practice makes on purpose.
- **No clinical judgement.** Risk and under-pacing are operations signals. Neither says anything about whether a child should be in a session.
- **PHI.** All of this is computed in the browser and never leaves it. The shipped data is fictional; the app remains a prototype, not a system of record.

---

## 8. How to tell whether it worked

The panel is built to be boring if the practice is healthy, and loud if it is not. The metrics to watch after a month:

| Signal | Healthy direction |
|---|---|
| Authorizations needing action | Trends to zero; renewals start at the 30-day/75% trigger rather than the week of expiry |
| Over/lapsed authorizations | Never non-zero for more than a renewal cycle |
| Expected lost hours | Falls as confirmation effort concentrates on the flagged few |
| Open capacity hours | Falls if demand exists; if it stays high while families wait, the problem is schedule *shape*, not capacity [8] |
| Fill by weekday × hour | Flattens; no cell sits above 95% and none below 50% |

---

## 9. Sources

1. CentralReach — *ABA Practice Management Software* (ScheduleAI: density-optimised scheduling, credential matching, automated backfill, authorization limits built into scheduling). <https://centralreach.com/products/aba-practice-management-software/>
2. RethinkBH — *RethinkBH vs CentralReach* (authorization tracking with pre-emptive unit-shortage flags; urgency-ranked operational dashboard with one-click navigation to the fix). <https://www.rethinkbehavioralhealth.com/resources/rethinkbh-vs-centralreach/>
3. PaceMave — *ABA Billing 2026: CPT, Payer Guidelines & Best Practices* (authorization-related denials ≈34% of ABA denials; alerts at 30 and 14 days; begin reauthorization at 75% of units consumed **or** 30 days before expiry, whichever comes first; log units used vs remaining daily). <https://www.pacemave.com/post/aba-billing-2026-guidelines>
4. Cube Therapy Billing — *Guide to ABA Insurance Authorization* (alerts at 30 days before expiration and at 75% of units used; link trackers to scheduling so staff know the balance before booking). <https://www.cubetherapybilling.com/guidetoabainsuranceauthorization>
5. blueBriX — *ABA billing software: RBT supervision, session notes and authorization tracking* (unit-based authorization consumption in 15-minute increments; threshold alerts; scheduling enforcement as the control point). <https://bluebrix.health/blogs/aba-billing-software-authorization-tracking>
6. Theralytics — *KPIs Every ABA Practice Should Track* (billable utilization 75–85% RBT / 65–75% BCBA; authorization utilization 90–100%; in-home practices 60–70% because of travel; turnover 77.4–103.3%; >50% progress drop with 2+ RBT changes a year). <https://www.theralytics.net/blogs/kpis-every-aba-practice-should-track>
7. CCD Care — *5 Ways to Use Data Analytics to Transform Patient Scheduling* (fill-rate heat maps by provider/day/time; 90–95% ideal; thresholds and drill-down dashboards). <https://ccdcare.com/resource-center/data-analytics-for-patient-scheduling-efficiency/>
8. Healthie — *Provider Utilization Dashboard* (below 65% low, 65–75% healthy, 76–100% near-full; low utilization with long waits means a structure problem, not a capacity problem). <https://www.gethealthie.com/blog/product-spotlight-provider-utilization-dashboard>
9. Digital Scientists — *Patient No-Show Prediction AI* (predictors: patient history, appointment type, lead time, day of week; outputs: smart overbooking and targeted outreach; 20–40% no-show reduction, 5–10% utilization gain claimed; risk stratification beats blanket reminders). <https://digitalscientists.com/healthcare/ai-guides/no-show-prediction/>
10. PMC — *Real-Time Analytics and AI for Managing No-Show Appointments in Primary Health Care (UAE)* (86%-accuracy model, real-time dashboard, proactive outreach for high-risk appointments). <https://pmc.ncbi.nlm.nih.gov/articles/PMC11729783/>
11. The Science Post Journal — *Predicting Patient No-Shows Using Machine Learning* (245,780 appointments, 12.8% no-show rate; strongest predictors are prior no-shows and historical show rate; lead time, day of week with Mondays/Fridays worse, age and insurance type also significant). <https://www.thesciencepostjournal.com/index.php/tsp/article/download/82/62>
12. National Academy of Medicine — *Innovation and Best Practices in Health Care Scheduling* ("hidden available capacity throughout most systems"; match supply to demand using usage by month/day/time/patient type; standard templates fill 85–90% a week out and hold 10–15% for same-day access). <https://nam.edu/wp-content/uploads/2015/06/SchedulingBestPractices.pdf>
