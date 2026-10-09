# Dashboard and reports

_Sources: src/lib/dash.js, src/lib/billingKpis.js, src/lib/reports.js, src/lib/analytics.js, src/lib/rpTrends.js, src/lib/reportViz.js, src/lib/exportKit.js, src/components/DashboardView.jsx, src/components/ReportsView.jsx, src/components/reports/Charts.jsx, src/ui/Icons.jsx, src/components/AnalyticsView.jsx, src/state/store.jsx, src/lib/workspaceBackup.js_

_Last synced against main 73e0236 plus the perf/lazy-views, fix/workspace-persistence, feat/local-screen-lock and feat/reports-revamp branches on 2026-10-08; feat/dashboard-landing on 2026-10-08 (Dashboard is the landing page, section keys renumbered); feat/reports-visuals on 2026-10-08 (one chart per report, KPI sparklines, catalogue icons, table cell meters); unrelated behavior unchanged; fix/billing-icons on 2026-10-08 (new stat-tile icons added to Icons.jsx and every icon now honours its size prop; no report change); feat/copy-and-infotips on 2026-10-09 (copy pass, no em dashes, guidance behind InfoTips); chore/emdash-data on 2026-10-09 (the last stored values with em dashes, the appointment auto-title and export header lines now use plain separators; a workspace migration updates saved data and old backups)._

[Wiki home](README.md) · Related: [Scheduling](scheduling.md), [Payroll](payroll.md), [Intake](intake.md), [Settings](settings.md)

## User guide

Three read-mostly screens turn the workspace into numbers: the **Dashboard** (a board of widgets you arrange), **Analytics** (one metric across one dimension) and **Reports** (a fixed catalogue of tables, each with one chart). Everything is computed in the browser from this workspace's own appointments, claims and payments. Exports are files the user downloads; nothing is emailed or scheduled.

### Dashboard (key `1`)

The app opens on the Dashboard, the first item in the sidebar. A workspace saved before this change that was left on the Calendar opens on the Dashboard once; after that the app reopens on the last section used.

A board of widgets over a date range (the range selector at the top: this week, last 4 weeks, quarter, year to date, and so on). Click a slice of the Mix donut or a bar in Top Breakdown to filter the whole board; clicking a Practice Pulse figure opens the data behind it. Active filters show as chips with a clear button. Every widget can open **the data behind it**, a drawer listing the appointments it summarises with one click into the record, and export that data as CSV.

| Widget | Shows |
|---|---|
| Practice Pulse | Sessions, charge, attendance, no-shows with change against the previous period |
| Volume Trend | Any metric (sessions, client hours, billable units, charge) bucketed by day, week or month |
| Mix | Appointment type or status share |
| Top Breakdown | Leaders by staff, client, program or payer |
| Appointment Ledger | The filtered appointments themselves, with overlap flags |
| Week Heatmap | Delivered minutes by weekday and hour; click a cell to jump to the calendar |
| Intake Pipeline | Referral funnel, conversion rate and requests waiting on a decision |
| Billing Health | Eight revenue-cycle KPIs (below) |

The default board is Pulse, Trend, Mix, Top Breakdown, Heatmap and Billing Health. Ledger and Intake Pipeline are added from the gallery (**Add widget**). Each widget has a menu to resize, change height, clone, remove, set its own range and change its settings. **Save layout** stores the current arrangement as a named board you can load or delete later; **Reset** restores the default.

**Billing Health** tiles, each with its formula and target on hover and a change against the previous equal window:

- Clean claim rate: claims submitted in the window never denied or rebilled, over claims submitted.
- Denial rate: claims denied at least once over claims submitted.
- Net collection rate: payer, secondary and patient payments over charges less contractual adjustments, for claims whose last service date is in the window.
- Cash posted: every ledger line dated in the window, net of reversals and recoupments.
- Days in A/R: the same formula as the AR Manager: open primary A/R over average daily primary charges in the 90-day lookback from service start, with draft charges included (point in time, no change figure). The dashboard uses the range's ending date as its as-of date; at matching as-of dates, both views show the same value. If the lookback has no charges, it displays a dash. See [Accounts receivable](accounts-receivable.md#formulas).
- A/R over 90 days: share of open primary A/R older than 90 days (point in time).
- Charge lag: average days from last service date to submission.
- Recouped: money payers took back (see the Payment Center in [Billing and claims](billing-and-claims.md)).

Self-pay invoices and secondary claims are left out of claim-quality rates. These are arithmetic over the ledgers, not a benchmark or a payer statement.

### Analytics (key `6`)

Pick any **metric** (sessions, client hours, billable units, gross revenue, utilization, cancellations, no-shows, recoverable slots, travel miles) and any **dimension** (staff, care team, client, program, appointment type, billing code, status, site, payer, service line). The range slider moves the window, **Compare** overlays the prior period, and clicking a row drills into that entity and can hand the selection to the calendar or to the Reports builder. It also shows an intake pipeline summary with links to the pipeline and its report.

### Reports (key `7`)

Pick a report from the catalogue on the left: reports are grouped by category, each with an icon, a one-line description and a small glyph for the kind of chart it draws, and **Find a report** narrows the list (saved reports sit on top under **Saved**). The selected report's toolbar stays pinned while you scroll and holds the range preset and an optional **scope** (one staff member, client or care team). Below it: up to four stat tiles from the report's summary. Each tile has an icon, the value, a change chip against the previous equal window (an up or down arrow, green or red by whether that rise is good news; **N more** shows the rest) and, when the number moved, a small line of the same figure over the last six windows of the same length (flat or non-numeric figures get no line). Then a collapsed **Totals vs previous window** comparison, a row filter (plus severity and one-click-fixable filters on the Data Quality report), a **Chart / Table only** switch, the report's one chart and the table. The chart draws the same rows as the table, so filters apply to both; hover or Tab onto any bar, segment or cell to read its value. The table is always there. In the table, status words (Overdue, Due soon, Compliant...) show as pills with the severity glyph, percentages get a small meter, and money columns a faint bar scaled to the largest value on screen. Click a column header to sort it (descending, ascending, then back to the report's order); numbers are right-aligned with a totals row. When nothing matches, the table says so and offers **Clear filters**. The report's note sits under the table as a footnote. Click a row to jump to the underlying record. **Export** (one menu) downloads CSV, XLS (a styled HTML workbook that Excel and Sheets open) or PDF (landscape, nothing clipped) of exactly the rows on screen, each stamped with the organisation, range, scope and generation time, or prints the page. **Save preset** keeps a report plus its range and scope as a shortcut (the most recent 24 are kept).

The Data Quality report adds one-click, undoable fixes for some rows (for example auto-filling billable units from the session length, or verifying and signing a session from the reports desk).

Which chart each report draws (chosen from the shape of its data):

| Chart | Reports |
|---|---|
| Weekday by start-hour heatmap | Attendance & Session Ledger |
| Ranked bars, with a target marker where there is one | Staff Utilization (100%), Authorization Burn-down (100%), Authorization Utilization (where the window should be today), Documentation (100%), ABA Hours (practice target), Cancellation Root Cause, Open Staff Capacity (per person), Intake Pipeline (per stage), Payroll (stacked session, supervision and drive hours) |
| Share-of-total bar with a legend | Data Quality (by severity), Cancellations & Backfill (by outcome), Re-assessment, Supervision and Credentials (by status), Blocked Claims (value by fix), Payer Mix (top four payers plus Other), Claims Register (outstanding primary balance in 30-day aging buckets, drafts not filed yet last) |
| Columns over time | Claim-Ready Lines (charges per day or week), Revenue by Code (per period, top three codes plus Other) |

Catalogue (19 reports):

| Category | Reports |
|---|---|
| Operations and Capacity | Attendance & Session Ledger; Staff Utilization vs Target; Cancellations & Backfill Log; Cancellation Root Cause; Open Staff Capacity (Gaps); Intake Pipeline & Referral Conversion |
| Clinical and Compliance | Authorization Burn-down (weekly hours pace); Authorization Utilization (per client and code across the authorization's own window, with a renewal flag at 30 days left or 75 percent committed, and "Verify" on units converted from weekly hours); Re-assessment Due Dates; BCBA Supervision Coverage; Credentials & PDUs (every clinician against renewal: BCBA 32 and BCaBA 20 CEUs per 2-year cycle, RBT yearly competency assessment, 30-day supervision %, and the practice's RBT PDU target; renewal dates from Staff > Cabinet, entries logged there); Documentation & Verification |
| Billing and Claims | Claim-Ready Lines; Blocked Claims & Fixes; Revenue by Code x Bucket; Claims Register; Payer Mix & Billing Status |
| People and Payroll | Payroll & Session Hours; Behavior-Analytic Hours (ABA time) |
| Data Quality | Data Quality & Validations (live cross-module checks) |

## How it works

### Dashboard

- [dash.js](../../src/lib/dash.js): pure widget engine. `WIDGETS` (the registry: name, blurb, default span and config), `DEFAULT_DASH`, `DASH_METRICS`, `DASH_DIMS`, `FILTER_KEYS`, `apptsFiltered`, `trendSeries`, `topBreakdown`, `mixOf`, `heatGrid`, `pulseKpis`, `flagOverlaps`, `fmtNum`. Only live statuses count as scheduled; "delivered" means completed.
- [billingKpis.js](../../src/lib/billingKpis.js): `billingKpis(state, days, prior, {today})` returns the eight tiles `{k, label, value, fmt, delta, help}`.
- [DashboardView.jsx](../../src/components/DashboardView.jsx) renders widgets; `WidgetBody` switches on the widget type. Test ids use `dw-` and `dash-`.
- State: `state.dash = { widgets, boards }`. The `dash` reducer case handles `add`, `remove`, `move`, `order`, `resize`, `height`, `clone`, `line`, `cfg`, `saveBoard`, `loadBoard`, `delBoard`, `reset`. It maps to the `dashboard` permission area. **Dashboard edits do not take an Undo snapshot.** The range and filters live in `ui` (`dashPreset`, `dashFilter`).
- Adding a widget type means adding it to `WIDGETS` and handling it in `WidgetBody`; the reducer refuses types not in `WIDGETS`. `dash` is in `WORKSPACE_FIELDS`, so boards are backed up and validated on import.

### Reports

- [reports.js](../../src/lib/reports.js): every entry in `REPORTS` has `{id, cat, name, icon, blurb, build(state, ctx)}` and `build` returns `{columns, rows, summary, note}`. `runReport(state, id, ctx)` wraps it with the definition and timing. Also `REPORT_CATS`, `REPORT_BY_ID`, `inScope`, `toCSV`, `validationIssues` (shared by the Data Quality report, Billing and KPI badges). Its Billing checks count units under the session's own unit size (15 minutes by default), and one warning compares sessions of the same code, client and date: when rounding each session separately bills a different total than counting the day once, it raises a **Billing** warning. That warning only fires for payers that turned off "merge same day" in Claims Settings, because claims otherwise merge the day's time and round once. Rows may carry `_link` for drill-through.
- To add a report: append an object to `REPORTS_RAW` with a unique id and an existing category id; the palette and the Reports screen read the registry, so nothing else is needed.
- [rpTrends.js](../../src/lib/rpTrends.js): `priorResult` (re-runs a report over the preceding equal window), `priorResults` (the windows before this one, oldest first: the KPI sparkline history, whose last entry feeds the delta chips), `numericTotals`, `deltaPct`, `pickDateCol`, `numCols`, `seriesFor`.
- [exportKit.js](../../src/lib/exportKit.js): `buildSpec`, `specToXls`, `specToPdf` (jsPDF), `downloadDoc`, and `loadPdf`, which fetches jsPDF on the first PDF export (every PDF button awaits it; the builders stay synchronous through `newPdf`). The payroll register reuses it ([Payroll](payroll.md)). `downloadDoc` accepts text, a Blob or a jsPDF document. `winAnsi` wraps every jsPDF document the app builds (reports, payroll, statements, intake, CMS-1500) so text outside the PDF fonts' WinAnsi set (arrows, minus signs, emoji) is mapped to ASCII or dropped instead of printing as garbled UTF-16. On a multi-page export only the later pages say "continued".
- [reportViz.js](../../src/lib/reportViz.js): pure chart choice. `vizFor(id, result, {days, weekStart})` returns one spec per report (`bars`, `stack`, `columns` or `heat`, each with a `title` and an `alt` sentence) or null when there is nothing to draw; `VIZ_KIND` names each report's kind for the catalogue. Helpers: `statusTone` (status text to stop / warn / flag / ok), `kpiNumber`, `niceScale`, `foldParts` (keep four, fold the rest into Other), `groupSum`, `agingBuckets`, `heatGrid` / `heatStep`, `sparkPoints`. A new report gets a chart by adding an entry to `SPECS` and `VIZ_KIND`.
- [Charts.jsx](../../src/components/reports/Charts.jsx): hand-drawn HTML and SVG charts, no chart library. Every mark is focusable with its value in `aria-label` and a CSS tooltip; status parts carry the severity glyph and word, never colour alone. Colours are the `--viz-*` tokens (a colour-blind-checked blue, orange, aqua order plus grey for Other, and one blue ramp for aging and heat), defined for light and dark at the end of `src/styles.css` (`rpc-` block).
- [ReportsView.jsx](../../src/components/ReportsView.jsx): catalogue, pinned toolbar (range, scope), stat strip, row filters, column sort, export menu, saved reports, in-place fixes via `actions.update`. Styles are the `rpv-` block at the end of `src/styles.css`. Saved reports use `saveReport` / `deleteReport` (`addSavedReport` and `removeSavedReport` actions, area `reports`); `reports.saved` is in the backup.

### Analytics

[analytics.js](../../src/lib/analytics.js): `weekAnalytics`, `rangeMetrics`, `METRICS`, `DIMS`, `seriesFor`, `pivotRows`, `heatMatrix`, `bucketize`, `autoGran`, `delta`, `priorDays`, and `RANGE_PRESETS` with `resolveRange` and `slidePreset`, shared by Dashboard, Analytics and Reports. [AnalyticsView.jsx](../../src/components/AnalyticsView.jsx) is the screen. Analytics defaults come from Settings > System Settings > Analytics defaults ([Settings](settings.md)).

### Tests

`dashboard.test.jsx` (widgets, boards, filters, drawer, default-board lists, Billing Health), `reports.test.js` (every report's shape and key figures), `rpTrends.test.js`, `reportViz.test.js` (chart choice per report, scales, aging, heat grid, sparklines), `exportkit.test.js`, `authUtilization.test.js` (the Authorization Utilization report), `cancelReasons.test.js` (the root-cause report), `abaHours.test.js` (the ABA report), `intake.test.js` and `intakeUi.test.jsx` (intake KPIs), and `sections.test.jsx` / `app.test.jsx` for screen routing. When you change the default board, search the tests for the old widget list.

## Not yet built

- No scheduled or emailed reports, no report builder for custom columns, and no sharing; reports are generated on screen and downloaded.
- Dashboard edits are not undoable, and boards are per workspace (no per-user boards or sharing).
- Billing Health has no benchmark data beyond the fixed targets quoted in each tile's help text. Days in A/R and the over-90 share are point-in-time figures.
- The XLS export is an HTML table that opens in Excel; it is not a native .xlsx workbook.
- Reports rely on what the workspace stores: for example there is no booked-at stamp, so lead-time is policy in the cancellation-risk model (see [Scheduling](scheduling.md)).
- The older Authorization Burn-down is hours-based; the unit-level view is Authorization Utilization.
- Per the scheduling research brief, a statistical forecast is not built. The caseload ramp (D1) and hire/contract strip (D2) are ramps from known work, not forecasts; scenario planning (D4) is not built.
