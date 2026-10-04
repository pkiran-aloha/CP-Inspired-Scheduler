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
| 2 | **Billed units follow the payer's unit rule.** Claim and appointment units use the same unit size and rounding as the authorization ledger: payer override, then payer service, then service master, then code. | `BILL_CODES.unitMins` with quarter-unit rounding in `autoBilling`. Same root as the 30-minute vs 15-minute backlog item. **Changes billed amounts, so it needs the maintainer's sign-off on the code defaults.** | Next |
| 3 | **Modifiers on claim lines** from the payer's POS modifiers and the service override modifier. Qualification modifiers wait until staff records have an education level. | `lineFor` always writes modifier `''`. | Planned |
| 4 | **CMS-1500 from the payer record:** box 1 from `cmsType`; 7a and 10 from `ext.group` and `ext.plan`; box 17, 32 and 33b rules from Claims Settings; box 6 from the client's secondary. | Regex on the payer name and fabricated values. | Planned |
| 5 | **Claim split rules:** Separate Claim By and Merge Same Day. | Claims are always one per client per DOS-month. | Planned |
| 6 | **Denial reasons and CARC hints as a Settings list.** | `DENIAL_REASONS` and `eraPosting` CARC hints are constants. | Planned |

## Still hard-coded, intentionally

- **X12 status maps (CLP02).** These are the standard, not a contract choice.
- **Claim numbering formats.** These are covered by the claim prefix setting.

## Stored but read by nothing (decide per slice: wire it or remove it)

- `rules.claims.file`, `apptTime`, and the taxonomy flags
- `ext.requiresSecondaryBox18`
- `payer.format`, `clearingHouse`, `payerId`
- `settings.billing.lateCancelHours`
- `TAXONOMIES`, `PAYER_ID_TABS`
