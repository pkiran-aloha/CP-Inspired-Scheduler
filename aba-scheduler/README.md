# Aloha ABA · Modern ABA Scheduler

A fully functional, single-page appointment scheduler for Applied Behavior Analysis clinics —
a modern rebuild of the Schedule 2.0 flow shown in your screenshots (type picker → 4-step
wizard → week grid), plus scheduling ergonomics that were missing.

## Run

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # static bundle in dist/
npm test           # vitest: 21 tests (store logic + UI flows)
```

## What's in it

**Calendar core**
- Week & Day time-grid (15-min snapping): **drag on the grid → Quick-book panel** that just asks
  *who the client is and what service*, with staff suggestion, live conflict warning and
  auto-billing — then tap the chip to open details / full edit. **Click a slot** for the type
  picker, **drag events to move** across days/times, **drag edges to resize**.
- Month grid (click "+" on a day, "+N more" drills into Day view) and a 14-day Agenda list.
- Red "now" line, weekend shading, per-day booked-hours + session-count totals.
- The appointment detail sheet is a **wide 920px card with a two-column body** (sections span both
  columns; it collapses to one column on narrow screens) so deep links from Reports use the
  browser width instead of a cramped strip.
- **Overlaps group on a 30-minute rhythm**: every run of time-overlapping appointments is tiled
  into half-hour *slot blocks* snapped to :00/:30. One appointment in a slot renders as a normal
  full-width chip (with a "→ 10:30 AM" hint when the session runs past the block); two or more
  starting in the same slot collapse into a "N overlapping" card that lists every member — the
  old "+n more" truncation is gone. Click the card for the member popover; "Show side-by-side"
  expands the whole cluster into lanes and "⇤ merge" folds it back.
- **The board owns the width**: context-adaptive chrome — the nav rail rests as an icon strip
  (labels via tooltips) while you're on the calendar, and the staff/client/team filter sidebar
  hides to a slim "Filters" handhold below laptop width or via its Hide button. Day columns have
  a **measured floor (~150px)**: when the window can't fit seven comfortable columns the canvas
  spreads into a horizontal scroll (sticky time gutter + weekday header) instead of squishing.
  Hour height, slot-block geometry and chip typography
  all derive from live container size via ResizeObserver + CSS container queries, and long
  titles wrap rather than truncate — verified zero clipped titles from 820px tablets to 1920px
  desktops. Both rail preferences are one click to override and persist.
  Click it for a full popover list (open any member directly), or flip it to **side-by-side lanes**
  with one click and merge back anytime.
- Relaxed, readable sidebar: roomy roster rows (name / role + care-team chip / weekly count on
  their own lines), airy mini-calendar with session dots, 2-column type legend with counts.
- Undo (toast button, user menu, or `U`).

**Domain model (ABA-specific)**
- Master data: 12 staff (with certifications for signatures), 16 clients (program, authorization
  hours, location) and 5 **care teams with a randomized distribution of staff & clients** —
  team selection filters by either membership.
- Appointment types: **Service, Drive Time, Break Time, Unavailable** (your picker) plus
  **Evaluation & Supervision** as extras. Each has its own color, icon and tab set.
- Every session dropdown is the same custom component (search, unified styling, free-text
  creation for locations) — no native select boxes.
- **Conflict detection**: double-booked staff or clients get a ⚠ flag on the chip and a warning
  inside the wizard; recurring series skip conflicting occurrences and report `N skipped`.
- **Full recurrence workflow**: weekly / biweekly / monthly series are materialized occurrences
  sharing a series id. Editing asks the scope (**this occurrence / this & following / all**) —
  a lone edit becomes a flagged exception (✎) with "revert to series default"; changing the
  repeat rule while editing offers **series rebuild** of all future occurrences. Delete asks the
  same scope, and the detail card can jump to the next occurrence. Skip/cancel marks the
  occurrence as an exception so the series continues.
- **Billing step** (like your screen 3): minutes → units from the CPT code (e.g. 60 min ÷ 30 = 2
  units), rate per unit, mileage for drive time, live `Charge` bar. Codes: 97151-4, 0362T,
  H2019, custom 253MT.
- **Verification step**: completed-by, 4-point checklist, verified/flagged status and a
  **Signature pad** — draw on canvas or type; signing embeds staff name + certification/
  designation, ISO timestamp and geocodes (navigator.geolocation, ±accuracy) — plus
  "Quick verify + sign" from the detail card for past sessions.
- **Documents step**: real file picker / drag-drop (names, sizes, tags stored — metadata only).
- Custom fields across every appointment type: single-select (Meg Test, Grade), multi-select
  (My Care), toggles (Yes/No), free text (Re-eval Notes) — all exercised by the seed data.
- ABA Hr ⚡ flag + "ABA hours only" filter; status flow Active/Confirmed/Completed/No-Show/Cancelled.

**Billing & claims desk** (`src/lib/claims.js` engine + Billing section)
- **Staging**: completed, verified, unit-correct sessions gather in a claim-ready pool with a
  live preview of the forms they will become (grouped by client × payer × DOS-month; self-pay
  folds into a single family invoice). Select any subset or take the whole batch.
- **Claim forms**: “Assemble” mints numbered forms (`CLM-YYYYMM-###`, prefix configurable) with
  real charge lines — CPT + per-line ICD pointer, units, rate, rendering staff, mileage line
  (14220) per drive — laid out on an HCFA-style box grid (billing provider, member & payer IDs,
  auth no, diagnosis set, facility, service period), printable and CSV-exportable per claim.
- **Gates**: submitting re-runs the live validations — any line that lost its verification flag
  or units since staging holds the claim (⚠ badge on the form), fixable inline via the calendar.
- **Money lifecycle**: post payments with quick presets (full / contract % / copay / write-off)
  and a live balance readout; short-pays stay visible; denials carry reason codes with fix
  hints; disputed lines can be dropped back to staging while rebilling (auto-versioned `-R2`,
  lineage kept); voiding returns every line. The whole desk shares one undo stack (`U`) with
  the calendar, and every charge line deep-links to its session (whose detail card links back).
- **CMS-1500 (02/12) PDF export**: each claim renders as the real box-numbered form on letter
  portrait — boxes 1a–33b mapped from the claim + client demographics (DOB, sex, member ID,
  auth №, facility/rendering NPIs, diagnosis set with per-line pointers) — six service rows per
  page with proper **SUBSTITUTE/CONTINUED** pagination, 24J totals, REPLACEMENT/resubmission
  flag on rebills, and a multi-page **batch PDF** for every claims currently in view. Driven by
  a pure mapper (`cms1500Data`) so the field contract is unit-tested apart from the renderer;
  client records carry the demographics the form needs (editable in the client modal, and the
  client card flags anything missing before filing). The printable form is the image-attachment
  path — the note on the Setup card (and in every generated footer) points e-filers at ANSI 837P,
  derived from the same fields.
- **A/R band**: staging value, drafts, awaiting-payer aging buckets vs each payer's expected
  cycle, denial rate, avg days-to-pay — same window anchor as Analytics/Reports. The Reports
  desk exposes the whole store as a **Claims Register** with CSV export.

**Reports desk**
- Rich landing: gradient hero with live stats, the validation-error count as a jump-to-quality
  chip, and a category rail (Operations, Clinical, Billing, People, Data Quality) with icons,
  counts and a one-click catalog filter over all 15 templates.
- **Trends panel**: the charted metric (Rows / Min / Units / Charge / hours — anything numeric)
  bucketed by day or week across the window. Every summary chip and the prior-window column show
  **deltas vs the previous period** (▲/▼ %). Click any bar to focus the whole table to that
  week/day; the focus chip clears it.
- **Fix issues from the report**: severity pills (Errors/Warnings/Notices), search-within-results
  and an auto-fixable toggle narrow the ledger; flagged-verification rows carry an inline
  **✓ Verify & sign** button and short unit rows an **⚡ Fix** — both write to the store, show an
  undo toast, and the report re-runs instantly, so rows clear for good. Filters flow into the
  Excel / PDF / CSV exports.
- **Every report exports three ways from one table spec** — Excel (.xls workbook with the brand
  header band, zebra rows, real currency/number formats, column widths, frozen table head and a
  totals footer), PDF (letter landscape, repeating header, page numbers, totals band, multi-page
  for long runs) and raw CSV. Exports always match the on-screen rows, scope and totals.


**⌘K command palette & keystroke workflow**
- `Ctrl/⌘K` opens a search-everything palette: sections (1–6), calendar views (D/W/M/H/G), any
  report template, every client and staff member (jump to their roster row or their filtered
  week), plus actions (book, today, needs-cover inbox, clear filters, theme). Token-scored,
  keyboard-first (↑↓ ⏎ esc), reachable from the ⌘K chip in the top bar.
- `?` opens a Keyboard & gestures cheat sheet; every shortcut listed there is real — the global
  layer (1–6, T, N/A, views, arrows to slide the window, U to undo) pauses while typing.
- **Settings → Data & backup**: live storage stats, one-click **Export workspace (.json)** and
  **Restore backup** (validated, replaces ledger + claims + roster in one undoable step). Destructive
  actions use inline two-step confirmation instead of the native `confirm()` dialog. The
  settings sheet is a wide two-column layout; the previously-broken "Week starts on" row is fixed.

**Roster & filters**
- Mini month calendar with per-day load dots; Staff / Clients / Teams tabs with search and
  select-all; selecting people filters the whole calendar (chips + week stats).
- Filter popover for statuses; legend with counts; this-range totals (sessions, units, billed $).

**Quality of life**
- Dark mode, 12/24h, week-start settings, print stylesheet, **.ics export** of the current
  range, keyboard shortcuts (`N` new, `T` today, `←/→` navigate, `D/W/M/G` views, `U` undo),
  unsaved-changes guard, toasts everywhere.
- Everything persists to `localStorage` (debounced) and reseeds a realistic 6-week demo
  schedule (8 staff, 8 clients, 3 teams) on first load — regenerate from the user menu.

## Architecture

```
src/
  lib/date.js        date/time math (minutes-of-day everywhere, no TZ traps)
  lib/model.js       types, CPT codes, billing/verification rules, conflict finder
  lib/seed.js        deterministic demo roster + schedule generator
  lib/ics.js         iCalendar export
  state/store.jsx    reducer store + selectors (filters, lanes, week stats) + persistence
  ui/                icons, toasts
  components/        TopBar, Sidebar, TimeGrid, MonthView, AgendaView,
                     TypePicker, AppointmentModal (wizard), DetailCard, SettingsModal, fields
```

To connect a real backend, replace the persistence effect and `reducer` dispatches in
`state/store.jsx` with API calls — the rest is pure props/state.
