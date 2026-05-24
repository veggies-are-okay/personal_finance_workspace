# Branch-finalization upgrade: README + PR-review best practices, CI-gated executor

## Summary
Reworks branch finalization to match reality: `main` is now protected (PR-only, 4 required checks), but the skill still did a local `--no-ff` merge and claimed "never push." This PR moves the **best-practices knowledge** into the rule and makes the **skill the executor** that runs README upkeep → self-review → tiered PR + happy-path proof → reviewer pass → merge-on-green.

## Changes (small PR — by file)
- **`.claude/rules/pull-requests.md`** *(rewritten)* — now the reference for PRs, review, and READMEs. Adds research-backed (Perplexity) **README best practices** (top-level = navigation/map vs component = local operating manual; freshness/link-don't-duplicate; reviewer rubric; anti-patterns) and a **PR-review** section (author self-review checklist; reviewer checklist covering correctness/tests/readability/**parity**/security; Conventional Comments; block-only-on-correctness/security/major-design). Keeps the file-count PR tiers (§2) and happy-path verification matrix (§3); §5 = CI-gated merge.
- **`.claude/skills/branch-finalization/SKILL.md`** *(reworked)* — frontmatter `description` fixed to **triggering-conditions only** (was a workflow summary that also mis-stated "local-only / `--no-ff` / never push"). New 8-step workflow: preflight gates → README upkeep → self-review → PR doc (tiered + happy-path) → commit & **push** → `gh pr create` + reviewer pass → **merge on green** (`gh pr merge`, never override red) → verify/notify. Delegates all checklists to the rule (no duplication).
- **`pull_requests/branch-finalization-upgrade.md`** *(new)* — this doc.

## Feature mapping
Governance / contributor-experience layer: makes the protected-`main`, CI-gated PR workflow self-documenting and executable, and bakes README upkeep + structured review (incl. parity + security) into every future feature PR (Waves 1–3).

## Happy-path verification
Docs/skill only — no runtime code. Evidence:
- **CI green:** the four required checks run on this PR (no source changed → unaffected behavior).
- **Internal consistency:** the skill references rule sections that exist (`pull-requests.md` §1–§5); the new `description` follows `superpowers:writing-skills` (triggers-only, no workflow summary).
- **No real data:** synthetic/abstract only.

## Test plan
| Gate | Result |
|------|--------|
| python-backend / ts-backend / frontend / parity | expected PASS (unchanged source) — recorded from the PR CI run before merge |

## Checklist
- [x] README/PR-review best practices captured in the rule (research-backed).
- [x] Skill reworked to the CI-gated-PR executor; description is triggers-only.
- [x] Skill delegates checklists to the rule (no duplication).
- [x] Synthetic data only.
- [ ] Four CI checks green (verified on the PR before merge).
