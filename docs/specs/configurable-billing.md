# Configurable billing (hackathon #8): audit and plan

The departments asked for this: "We didn't have to submit hard-code requests for billing." The maintainer's answer was "the need should not arise". So every billing behaviour a payer contract can change should be a setting with a UI, not a constant in code.

This file has two parts: an audit of what was still hard-coded on 2026-10-04, and the order in which we are moving it into settings. Each slice is one branch. Each slice lands green before the next one starts.

## Already configurable and actually read

- **Settings → Billing defaults** (`settings.billing`): claim prefix, require verification, strict authorization, supervision check, invoice prefix and sequence, default filing days.
- **Mileage rate** and **billable appointment statuses**.
- **Payer → Billing Rules:**
  - Provider IDs
  - MUEs, daily and weekly
  - Concurrent billing
  - Signature required to complete
- **Payer → Services:** override charge. Unit size and rounding are read by the authorization ledger only.
- **Payer record:** filing deadline (`ext.filingDeadlineDays`).
- **Services master:** code, unit length, rate, rounding, credentials.

## Slices

| # | Slice | What it replaces | Status |
|---|---|---|---|
| 1 | **Payment Terms** (Payer → Billing Rules → Payment Terms): payer kind, expected days to pay, estimated payer share, copay per line, filing deadline | `PAYER_POLICY` constant read by payer name. The payer record already carried a `policy` that nothing read. Three different filing-day formulas. | Shipped |
| 2 | **Billed units follow the payer's unit rule, with Medicaid / CPT as the baseline.** Claim and appointment units use the same unit size and rounding as the authorization ledger: payer override, then payer service, then service master, then code. | `BILL_CODES.unitMins` of 30 minutes with quarter-unit rounding in `autoBilling`. | Shipped |
| 3 | **Modifiers on claim lines** (box 24D, up to 4), in this order: the payer's service modifier, then the rendering credential modifier (HO / HN / HM / HP, the Medicaid norm, which the payer can switch off in Claims Settings), then the payer's POS modifier. Place of service now uses CMS codes: home is 12 and community is 99. The old list labelled 06 as home. Qualification modifiers wait until staff records have an education level. | `lineFor` always wrote modifier `''`. | Shipped |
| 4 | **CMS-1500 from the payer record:**<br>• box 1 from the payer's CMS type<br>• 7a and 10 from the payer's group and plan IDs, shown as "—" when blank instead of an invented value<br>• box 6 is YES when the client has secondary coverage<br>• box 32 follows Claims Settings. The default leaves it blank, because the service facility is the billing provider.<br>• No invented NPI for the practice.<br>• Fixed: the MEDICARE checkbox was ticked on Medicaid claims.<br>Box 17 (referring provider) waits for referring-provider data on clients. | Regex on the payer name and fabricated values. | Shipped |
| 5 | **Claim split rules.**<br>• **Separate Claim By** splits a client-month by rendering provider (or service provider) or by place of service. Supervising Provider needs supervisor data on sessions, which the app doesn't record yet.<br>• **Merge Same Day** is on by default (the Medicaid norm). Sessions with the same date, code, modifiers, rendering provider, rate and unit rule become one line: minutes are added up and rounded once. The line keeps `apptIds`, and dropping, rebilling, voiding or submitting it acts on every session. A payer can turn it off; Validations then warns where separate rounding bills differently. | Claims were always one per client per DOS-month, one line per session. | Shipped |
| 6 | **Denial reasons and remittance code (CARC) hints are editable lists** in Settings → System → Billing Settings. Both are saved through the `billing.reasons` settings op, which validates them first:<br>• labels must be at least 3 characters and unique<br>• codes must look like CO-197<br>• at least one denial reason is required<br>Recording a denial and posting ERA denials both read these lists. The default hints are now 11 common CARCs: CO-4, 16, 18, 22, 27, 29, 50, 96, 151, 197 and 252. | `DENIAL_REASONS` and the `eraPosting` hint map were constants, with 5 CARCs. | Shipped |

## Compliance baseline: Medicaid norms (maintainer decision, 2026-10-04)

Medicaid is the largest payer, so its norms are the default. A payer's own contract rule overrides them per service.

- **Unit length.** These codes bill **per 15 minutes**:
  - 97151–97158
  - 0362T and 0373T
  - H2019

  Rates in `BILL_CODES` are per 15-minute unit. They were halved from the old 30-minute rates, so the charge per hour did not change. `253MT` is a clinic code and stays at 30 minutes.
- **Counting.** Units use the CPT midpoint rule (`AMA` in `unitsFor`): a 15-minute unit counts at 8 minutes or more. For example, 38 minutes is 3 units and 37 minutes is 2.
- **One code, one client, one date of service.** Minutes for that combination are added up, then rounded once. Until claim lines can merge same-day time (slice 5), Reports → Validations raises a **Billing** warning whenever rounding each session separately bills a different number of units than counting the day once.
- **Saved workspaces** get a one-time migration (`normalizeUnitNorms`, flag `meta.unitNorm15`):
  - Services still on the old default unit length move to 15 minutes. Their rate, and any payer override charge without its own unit size, scale with them.
  - Authorization pools for those codes scale to the new unit.
  - Appointments not yet on a claim are re-counted.
  - Claims are never changed.

  Known limit: a pool is scaled per code, not per payer. A client whose payer sets its own unit size for that code keeps a pool in the wrong unit and needs a manual fix.
- Not verified against the current state Medicaid manuals or payer contracts. The billing lead confirms per payer and sets any difference in Payer → Services.

## Still hard-coded, intentionally

- **X12 status maps (CLP02).** These are the standard, not a contract choice.
- **Claim numbering formats.** These are covered by the claim prefix setting.

## Stored but read by nothing (decide per slice: wire it or remove it)

- `rules.claims.file`, `apptTime`, and the taxonomy flags
- `ext.requiresSecondaryBox18`
- `payer.format`, `clearingHouse`, `payerId`
- `settings.billing.lateCancelHours`
- `TAXONOMIES`, `PAYER_ID_TABS`
