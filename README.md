# Aloha ABA — Practice Suite (demo)

A fully client-side single-page app for ABA practice operations: calendar with
30-minute slot-block overlap grouping and a lane-aware timeline, roster, client
lifecycle, authorization-aware billing with CMS-1500-formatted exports, saved
report builder with Excel/PDF output, and a drag-and-drop analytics Dashboard
(custom widget board: resize, reorder, per-widget time ranges, saved layouts,
drill-down ledger).

**Stack:** React + Vite. Zero backend — all data lives in the browser's
`localStorage`, seeded with a fictional demo dataset (16 clients, 12 staff,
~1,053 appointments). No real PHI anywhere.

## Live site
Deployed automatically by `.github/workflows/deploy.yml`: every push to `main`
runs `npm ci → npm test → npm run build` and publishes `dist/` to GitHub Pages.

## Develop
    npm install
    npm run dev        # http://localhost:5173
    npm test           # vitest (176 tests)
    npm run build      # static site in dist/ (asset paths are relative)

## License
No license granted — demo/portfolio work; "CP-inspired" refers to general
scheduling-software UX patterns only.
