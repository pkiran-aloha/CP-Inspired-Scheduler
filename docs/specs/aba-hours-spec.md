# ⚡ ABA Hours — behavior-analytic time on non-service appointments

Spec and build record for the corrected meaning of the **ABA Hours** checkbox, and for the
tracking ledger that now hangs off it.

## The rule

> An **ABA Hours** checkbox is added to all **non-service** appointments. When selected, this
> appointment will be included as **behavior-analytic time** for tracking RBTs, BCATs,
> graduate students, or state certification requirements.

**Examples of behavior-analytic (non-service) hours**

- Group trainings focused on behavior-analytic principles conducted outside of client sessions
- Graduate students designing or reviewing interventions during non-billable time

**Non-examples**

- Cleaning the clinic
- General administrative tasks such as stimulus preparation

**This has nothing to do with client authorizations.**

## What was wrong

The flag had been wired to the opposite end of the product:

| | before | after |
| --- | --- | --- |
| Where the checkbox appeared | service, evaluation, supervision (`showClinic`) | every **non-service** appointment |
| What it meant | "count this session against the client's authorized ABA hours" | "this block is behavior-analytic staff time" |
| Authorization burn-down | `consumesAuth` skipped any session with `abaHr === false` | drawdown is decided by appointment **type** only |
| Downstream use | none — the flag only gated the authorization guard | staff roster, report, timesheet, data-quality sweep |

So the flag could silently pull a clinical session out of the authorization ledger (a real
billing risk), while the credential hours it was supposed to track were not counted anywhere
at all.

## The model

`src/lib/model.js` now labels each appointment type as service or non-service:

```
service:  service, evaluation, supervision, drive   (client service delivery + its travel)
non-service: break, unavailable, and any type this build has never heard of
```

`isServiceAppt(a)` / `isNonServiceAppt(a)` are the only two predicates. An unknown/custom type
is non-service by default, so a new type gets the checkbox rather than silently losing it.

`src/lib/abaHours.js` owns the semantics:

```js
countsAsAbaHours(a)  // abaHr === true && non-service && not cancelled && activity qualifies
abaHoursOf(a)        // hours credited by one block
abaActivityById(id)  // the activity that makes it behavior-analytic
abaTrackFor(staff)   // student · RBT/BCAT · BCaBA · BCBA · other (state certification)
abaStaffRows(state)  // per person: hours, sessions, activity mix, target, progress
abaTotals(state)     // the workspace number the KPI strips read
normalizeAbaHours()  // one-time migration
```

Every reader — calendar badge, agenda pill, detail card, staff roster, report, payroll line,
data-quality sweep, calendar filter — goes through `countsAsAbaHours`, so the platform cannot
disagree with itself about what an ABA hour is.

### Activities

The booking dialog asks *which* behavior-analytic activity the block is. The practice's
non-examples are named in the picker instead of being silently mis-counted:

| activity | counts |
| --- | --- |
| Group training — behavior-analytic principles | ✅ |
| Designing / reviewing interventions | ✅ |
| Data analysis, graphing & program evaluation | ✅ |
| Assessment / report writing | ✅ |
| Training technicians on ABA procedures | ✅ |
| ABA coursework / CEUs | ✅ |
| Facility upkeep — cleaning the clinic | ❌ |
| General admin — e.g. stimulus preparation | ❌ |

A block with the tick but no activity still counts (legacy rows must not lose hours) and is
reported as *needing an activity*.

### Tracks and targets

Hours are tallied per credential track: **graduate student / trainee**, **RBT / BCAT**,
**BCaBA**, **BCBA**, **other / state certification**. Each track carries a target that the
practice edits in Settings → System Settings → ABA Hours. The defaults follow the usual
requirements (RBT 40-hour initial training, concentrated fieldwork for a graduate student),
and the UI states plainly that these are the practice's numbers, not a board's rule.

## Validations

A new `aba` group in `DEFAULT_APPOINTMENT_VALIDATIONS` (Settings → System Settings →
Appointment Validations), enforced live in the booking dialog where **Stop** blocks the save:

| rule | default | fires when |
| --- | --- | --- |
| `aba.serviceAppt` | Stop | ⚡ ABA Hours ticked on a service appointment |
| `aba.activity` | Stop | the chosen activity is not behavior-analytic |
| `aba.missingActivity` | Warn | ticked with no activity chosen |
| `aba.noStaff` | Warn | nobody is on the block, so nobody can be credited |
| `aba.clientAttached` | Flag | a client is attached — behavior-analytic time is staff time outside client sessions |

The same conditions surface in Reports → Data Quality & Validations as `ABA Hours` issues, so
a record that arrives by import or from an older save is still found.

## Upstream and downstream

- **Booking dialog** (`AppointmentModal.jsx`): checkbox on non-service types only, with the
  explanation, the activity picker, the examples/non-examples and who the hours are credited
  to. `buildAppt` writes `abaHr: false` and no activity for a service appointment, so
  switching type cannot smuggle the flag onto a session. The old "Not drawn against the
  authorization / ⚡ Count it" box is gone.
- **Authorization guard** (`authBudget.js`): `consumesAuth` no longer reads `abaHr`; the
  `skipped` verdict is removed. A clinical session draws on the authorization by type.
- **Calendar** (`TimeGrid`, `AgendaView`, `DetailCard`, `store.visibleApptsFor`, `TopBar`
  filter): badges and the "⚡ ABA hours (behavior-analytic time)" filter read
  `countsAsAbaHours`, and the badge can be switched off in settings.
- **Staff roster** (`StaffView.jsx`): ⚡ hours per person over the same window as
  utilization, with the activity mix, target progress and any excluded time.
- **Payroll** (`payroll.js`): schedule lines carry `meta.abaHr` / `meta.abaActivity` and
  `lineTotals` returns `abaHours`. It is certification currency — it never changes the
  earning code or the rate.
- **Reports** (`reports.js`): *Behavior-Analytic Hours (⚡ ABA Time)*, People & Payroll.
- **Seed data**: weekly ABA group training for the technicians and student, a graduate-student
  intervention-design block, and CEU/workshop blocks marked as coursework. Service sessions
  no longer carry the flag.
- **Migration** (`normalizeAbaHours`, wired into `normalizeWorkspace`): workspaces saved while
  the flag meant "count against the authorization" have it stripped from service
  appointments; every non-service flag is left alone. Idempotent, and it reports what it did
  in `meta.abaHoursStripped`.

## Honest limits

- Nothing here transmits anywhere. No board portal, no CE registry, no state system.
- The engine credits the whole block to **every** staff member on it. Co-present supervision is
  not split, and the practice's own fieldwork log stays the system of record.
- Hours come from the scheduled start/end, not from a clock-in. EVV timestamps are not
  substituted here.
- Targets are the practice's numbers. The suite does not claim to know a certifying body's
  current requirement.
