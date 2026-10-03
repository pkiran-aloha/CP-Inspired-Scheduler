# CLAUDE.md

All project rules live in `AGENTS.md` (shared by every coding agent). Current state and next steps live in `docs/HANDOFF.md` — read it at the start of a session.

@AGENTS.md

## Claude Code only: skills for this project

- Bugs: `mattpocock-skills:diagnosing-bugs`, then `mattpocock-skills:tdd` for the regression test.
- New features or domain changes: `mattpocock-skills:grilling` to settle requirements, `mattpocock-skills:domain-modeling` for new entities.
- Structure and refactors: `mattpocock-skills:codebase-design`.
- UI and visual work: `impeccable:impeccable` (reads `PRODUCT.md`; run its `detect` on changed UI) and `ecc:taste` for preference checks.
- Scope control: ponytail is always on. Prefer the smallest change that keeps the rules in `AGENTS.md`.
- Review before landing: `mattpocock-skills:code-review`.
