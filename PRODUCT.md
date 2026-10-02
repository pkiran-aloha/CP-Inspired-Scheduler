# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Everyone who runs an ABA (Applied Behavior Analysis) therapy practice, each using a different slice of the suite:

- **Practice admins and schedulers:** manage the calendar, staff, clients, intake and day-to-day operations.
- **Billing staff:** stage claims, post ERAs, work A/R, record patient receipts and secondary (COB) filings.
- **BCBAs and clinicians:** check their own schedules, clients and intake requests they own.
- **Practice owners:** read dashboards and analytics, and approve payroll.

## Product Purpose

An all-in-one practice suite for ABA practices: scheduling, intake, authorization-aware billing, payments/A/R, payroll, reporting and practice settings in one place. Today it is a functional, local-first prototype. It is meant to evolve into a production-ready application.

## Positioning

One workspace where every financial and operational change is validated against live state and reversible in a single Undo step, and where the app never pretends to have done something it did not (no fake transmission, posting or connection).

## Operating Context

- Office desktop use during a working day: dense lists, calendars and ledgers, keyboard use (Cmd/Ctrl+K palette, shortcuts).
- Domain workflows: intake pipeline (new to converted), authorizations, CMS-1500 / 837-style claims, 835 ERA import, COB secondary filing, patient receipts, payroll cycles with second-person approval.
- Data currently lives only in the browser (localStorage); backup/restore is a versioned JSON file.

## Capabilities and Constraints

- Built with React 18, Vite 6 and Vitest; one global stylesheet.
- No backend yet. No clearinghouse, eligibility, payment, SMS or QuickBooks network connection.
- Seed data is fictional. Until a production backend with proper safeguards exists, no real PHI may be entered.
- **Open decision:** production architecture (backend, auth, hosting, HIPAA compliance path) is not chosen yet.

## Brand Commitments

- Product name: Aloha ABA.
- "CP-inspired" refers to general scheduling-software UX patterns only. The current visual design is not binding; the user is open to a redesign.

## Evidence on Hand

- Screenshots: `docs/preview-*.png`, `docs/payroll-*.png`.
- Historical billing specs: `docs/specs/`.
- No customer testimonials, metrics or production users exist. Do not invent them.

## Product Principles

1. Honest software: the UI states exactly what happened locally and never implies an external action.
2. Guards over warnings: invalid financial or configuration states are refused, not just flagged.
3. One action, one Undo: every compound change is a single reversible transaction.
4. Built for the whole practice: each role finds its own work without wading through another role's.
5. Prototype today, production tomorrow: choices should not block a later move to a real backend.
