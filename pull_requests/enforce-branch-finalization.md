# Enforce: every PR goes through the branch-finalization skill

## Summary
Makes "use the `branch-finalization` skill for every PR" both **documented** and **enforced**. Adds a `PreToolUse(Bash)` hook that reminds the agent to follow the branch-finalization flow whenever a command runs `gh pr create`, mandates it in the PR rule + checklist, and fixes the two checklist runner skills (which still did a local `--no-ff` merge — now rejected by the protected `main`) to route through the CI-gated PR flow.

## Changes (medium PR — by subdirectory)
- **`.claude/hooks/` + `.claude/settings.json`** — new committed `PreToolUse(Bash)` hook (`pr-create-reminder.sh`): non-blocking; greps the command for `gh pr create` (catches compound `git push && gh pr create`) and injects an `additionalContext` reminder of the branch-finalization checklist. Non-blocking by design so it never blocks the skill's *own* `gh pr create`.
- **`.claude/rules/pull-requests.md`** — §5 now mandates that every PR is created/finalized via the `branch-finalization` skill (never hand-rolled), and documents the hook.
- **`.claude/skills/`** — `checklist-phase-runner` and `checklist-phase-runner-parallel` get an **INTEGRATION** note that supersedes their local `git merge --no-ff` / `git push origin main` steps: push → CI-gated PR → merge on green via `branch-finalization` (protection rejects local merges). Frontmatter descriptions updated to match.
- **`plans/agent_checklist.md`** — preamble adds an "Integration" line: every subsection ships via `branch-finalization` as a CI-gated PR.
- **`docs/STRUCTURE.md`** — CHANGELOG entry; **`pull_requests/`** — this doc.

## Feature mapping
Governance/process enforcement: guarantees the protected-`main` + CI-gated-PR workflow is followed for every change (mine and the automated checklist runners) in Waves 1–3, with a harness-level reminder rather than relying on memory.

## Happy-path verification
- **Hook works (pipe-tested):** matching input (`…gh pr create…`) → emits valid hook JSON (`jq -e` on `additionalContext` passes); non-matching input (`ls`) → no output; exit 0 both.
- **Hook fires live (in-turn proof):** after writing `.claude/settings.json`, a Bash command containing `gh pr create` triggered the `PreToolUse:Bash` reminder in this session — the harness picked up the committed hook and injected the branch-finalization reminder.
- **Settings schema valid:** `jq -e '.hooks.PreToolUse[] | select(.matcher=="Bash")'` resolves.
- **No runtime code changed** → the four CI checks are unaffected (must be green before merge).

## Test plan
| Gate | Result |
|------|--------|
| python-backend / ts-backend / frontend / parity | expected PASS (no source changed) — recorded from the PR CI run before merge |

## Checklist
- [x] Hook added (committed `.claude/settings.json` + script), pipe-tested, and proven to fire in-session.
- [x] Rule + checklist + both runner skills mandate the branch-finalization PR flow.
- [x] Runner skills' broken local-merge steps superseded (protection-safe).
- [x] `docs/STRUCTURE.md` updated; synthetic data only.
- [ ] Four CI checks green (verified on the PR before merge).
