# PR & README conventions + repo-wide README set

## Summary
Adds a new rule governing every pull request (`.claude/rules/pull-requests.md`) and brings the repo into compliance with it by giving **every first-level directory a README** and authoring a top-level `README.md`. This is the first PR written under the new rule, so it dogfoods the format.

## Changes (large PR — conceptual, by realm)
- **PR convention (the rule).** `.claude/rules/pull-requests.md` codifies three things: (1) READMEs stay current — every first-level dir has one, and a PR updates the READMEs of areas it touches; (2) PR descriptions scale to change size — **≤5 files** walk individual files, **6–10** group by subdirectory, **>10** stay high-level/conceptual — and always map the technical change to the high-level feature it serves; (3) a **happy-path verification** section proves the feature works via the method that fits (Playwright screenshot for frontend; OpenAPI/Swagger + a Playwright-MCP/curl endpoint ping for backends, both backends for parity; docker-compose/app log captures; ad-hoc DB queries). Indexed in `CLAUDE.md`.
- **Documentation surface.** New top-level `README.md` (what/why, parity architecture + Mermaid diagram, quickstart, repo-map table, quality gates + PR rules) and component READMEs for `frontend/`, `backend-python/`, `scripts/`, plus concise READMEs for `tests/`, `config/`, `docs/`, `plans/`. `backend-ts/` and `contracts/` already had good READMEs and were left as-is. `docs/STRUCTURE.md` CHANGELOG updated.

## Feature mapping
Supports the **contributor-experience / governance** layer of the project rather than a product feature: it makes the dual-backend-parity workflow, the CI-gated PR process, and the data-privacy boundary self-documenting, and enforces verification evidence on every future feature PR (Waves 1–3).

## Happy-path verification
Docs-only change (no runtime code). Evidence:
- **CI green:** the four required checks (`python-backend`, `ts-backend`, `frontend`, `parity`) run on this PR and must pass before merge (branch protection). No source changed, so behavior is unaffected.
- **Links resolve:** the top-level README repo-map links point at real, now-present README files in each first-level dir.
- **No real data:** all examples are synthetic; `git grep` finds no real balances/merchants/account numbers in the added files.

## Test plan
| Gate | Result |
|------|--------|
| python-backend | expected PASS (unchanged) |
| ts-backend | expected PASS (unchanged) |
| frontend | expected PASS (unchanged) |
| parity | expected PASS (unchanged) |

(Recorded from the PR's CI run before merge.)

## Checklist
- [x] New rule added + indexed in `CLAUDE.md`.
- [x] Top-level README + a README in every first-level dir.
- [x] `docs/STRUCTURE.md` CHANGELOG updated.
- [x] Synthetic data only.
- [ ] Four CI checks green (verified on the PR before merge).
