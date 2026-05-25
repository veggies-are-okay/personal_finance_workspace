# PR evidence standard: inline bodies + Playwright happy-path screenshots

## Summary
Two PR-workflow fixes, codified so they happen automatically going forward: (1) the GitHub PR **body is the full `pull_requests/<slug>.md` inline** (`--body-file`), never just a pointer; (2) every feature-bearing PR **embeds a committed Playwright screenshot** of the happy path (terminal output for backend/DB, the live screen/Swagger for UI/endpoints). Adds a turnkey helper so subagents produce the screenshot in one command.

## Changes (medium PR — by subdirectory)
- **`scripts/`** — `evidence_term_shot.sh`: renders captured terminal output → a styled-terminal PNG via the **Playwright CLI** with bundled Chromium (the Playwright *MCP* is pinned to system Chrome, which needs sudo to install). `+ scripts/README.md` row.
- **`.claude/rules/` + `.claude/skills/`** — `pull-requests.md` §2 now requires `gh pr create --body-file …` (full inline body) and §3 mandates a committed Playwright screenshot embedded via a **commit-SHA raw URL** (SHA, not branch — our branch names contain `/`). `branch-finalization` (steps 4 + 6) and both checklist runner skills' INTEGRATION notes updated to match.
- **`docs/`** — `STRUCTURE.md` CHANGELOG. **`pull_requests/`** — this doc + the demo screenshot.

## Feature mapping
Process/governance: makes the two pieces of PR-quality feedback (inline descriptions, visible proof) self-enforcing for every future feature PR (Waves 1–3) and every checklist-runner subagent.

## Happy-path verification
The helper itself, run on a sample transcript, producing a terminal PNG (dogfooding the standard this PR adds):

![evidence_term_shot.sh demo](https://raw.githubusercontent.com/veggies-are-okay/personal_finance_workspace/0085e4038ec1bcb53dc5a3e9b31af801db65f910/pull_requests/evidence/pr-evidence-standard/helper-demo.png)

Self-test also confirmed: `scripts/evidence_term_shot.sh <txt> out.png "title"` → `PNG image data, … 8-bit/color RGB`. (P3.1's PR #6 already shows the end result — a real loader-test screenshot embedded in the inline body.)

## Test plan
| Gate | Result |
|------|--------|
| python-backend / ts-backend / frontend / parity | expected PASS (docs + a shell helper; no app source changed) — recorded from the PR CI run before merge |

## Checklist
- [x] `--body-file` (full inline body) mandated in rule + branch-finalization + both runners.
- [x] Committed Playwright screenshot (commit-SHA raw URL) mandated for feature PRs; turnkey helper added + self-tested.
- [x] `scripts/README` + `docs/STRUCTURE.md` updated; synthetic content only.
- [ ] Four CI checks green (verified on the PR before merge).
