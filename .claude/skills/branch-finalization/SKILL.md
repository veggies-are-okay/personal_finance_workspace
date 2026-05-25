---
name: branch-finalization
description: Use when work on a feature branch is complete and ready to integrate into main for the dual-backend personal-finance app — triggers include "finalize branch," "wrap this up," "open a PR," "create a PR and merge," "merge this in," or any point where a branch should become a reviewed, CI-gated pull request into the protected main.
---

# Branch Finalization

Takes a finished feature branch all the way to merged via a **reviewed, CI-gated pull request** into the **protected `main`**: preflight gates → README upkeep → self-review → PR (tiered description + happy-path proof) → reviewer pass → merge on green. This skill is the **executor** of `.claude/rules/pull-requests.md` (the conventions/checklists live there — read it; do not duplicate it here).

The repo has one frontend and **TWO parallel backends at STRICT 1:1 parity**: `frontend/` (React+Vite+Tailwind), `backend-python/` (FastAPI+Pydantic v2, uv, SQLAlchemy+Alembic — canonical schema), `backend-ts/` (NestJS+TypeORM `synchronize:false`+class-validator, npm), `contracts/` (canonical OpenAPI + parity tests), shared Postgres.

**RULE #1 — BACKEND PARITY:** every route/schema/validation/error/status implemented IDENTICALLY in both backends on this branch, verified by OpenAPI diff + `contracts/` parity tests. **Never finalize an API/behavior change unless both backend gates AND the parity gate pass.**

**`main` is protected** (PR-only; the four CI checks must be green before merge) and the repo has an `origin` remote. So this workflow **pushes the branch and merges via `gh`** — it is *not* local-only.

## When to Use

- "Finalize branch," "wrap this up," "open a PR," "create a PR and merge," "merge this in."
- After a checklist subsection / feature / fix is complete on a `{yyyy}-{mm}-{dd}-<TYPE>/<slug>` branch and ready for `main`.

## Prerequisites

- On a feature branch (not `main`). If on `main`, ask which branch to finalize.
- Code changes complete; API/behavior changes already in **both** backends + `contracts/`.

## Workflow

### Step 1 — Preflight gates (abort on any failure or parity drift)

Run every gate that applies to what the branch touched (80% coverage is a hard floor each):

```bash
cd backend-python && uv run ruff check . && uv run ruff format --check . && \
  uv run pytest --cov=app --cov-report=term-missing:skip-covered --cov-branch --cov-fail-under=80
cd ../backend-ts && npm run lint && npm run format:check && npm run test:cov      # any backend change
cd ../frontend && npm run lint && npm run test -- --coverage && npm run build      # only if frontend touched
cd ../contracts && npm run test:parity                                             # any API/behavior change
```

**If any gate fails or the OpenAPI diff drifts, ABORT** — report and stop. Do not commit/push broken or out-of-parity code. (CI re-runs these on the PR, but green-locally-first is the rule.)

### Step 2 — README upkeep (`pull-requests.md` §1)

Update the README of **every area this branch touched** (and the top-level README if structure/usage/commands changed), per the README best practices in the rule. Update `docs/STRUCTURE.md` if layout changed.

### Step 3 — Self-review (`pull-requests.md` §4, author checklist)

Read every changed file as a reviewer would: remove debug/dead code, confirm no unrelated/whitespace churn, ensure new behavior has meaningful tests (bugfix → a test that fails without the fix), and that intent-non-obvious code is commented.

### Step 4 — Gather context & write the PR doc

```bash
git diff --name-only main... | wc -l      # pick the tier (≤5 small / 6–10 medium / >10 large)
git diff main --stat ; git log main..HEAD --oneline
```

Write `pull_requests/<slug>.md` at the tier's granularity (§2): **H1 · Summary · Changes · Feature mapping · Happy-path verification (§3) · Test plan (gate results) · Checklist.** Capture the **happy-path evidence** that fits the change and **commit it as a Playwright screenshot** under `pull_requests/evidence/<slug>/` (run `scripts/evidence_term_shot.sh <captured-output.txt> … "<title>"` for terminal/DB proofs; screenshot the live `/docs`/screen for endpoints/UI), then embed it in the doc via a **commit-SHA raw URL** (`pull-requests.md` §3). No financial data — synthetic only.

### Step 5 — Commit & push the branch

```bash
git add <specific files>          # never git add -A; never --no-verify; never amend
git commit -m "$(cat <<'EOF'
<type>: <short description>

<what & why; note parity across both backends + contracts/ if relevant>

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git push -u origin <branch-name>
```

Commit the PR doc + any README/STRUCTURE/checklist updates in the same commit. Types: `feat`/`fix`/`refactor`/`test`/`docs`/`chore`.

### Step 6 — Open the PR & run the reviewer pass

```bash
gh pr create --base main --head <branch-name> --title "<title>" --body-file pull_requests/<slug>.md
```

Then run the **reviewer checklist** (`pull-requests.md` §4) over the diff — optionally invoke the `code-review` or `pr-review-toolkit:review-pr` skill. Use Conventional Comments; **block only on correctness/security/major-design**, not nits. Resolve any blockers (push fixes to the branch) before merging.

### Step 7 — Merge on green

Wait for the four checks, then merge only when all pass (branch protection enforces this):

```bash
gh pr checks <pr-number> --watch        # run in background; merge only on exit 0 / all "pass"
gh pr merge <pr-number> --merge --delete-branch
```

If a check is **red**: read the failing job logs, fix on the branch, push, and re-watch — do **not** override or merge red.

### Step 8 — Verify & notify

```bash
git checkout main && git pull origin main && git log --oneline -3   # merge commit present
cd contracts && npm run test:parity                                 # optional: parity intact on merged main
```

Report: branch name, PR number/URL, files changed + tier, gate results (python / ts-backend / frontend / parity with %), the happy-path evidence captured, and the merge commit. If the user opts into the sound:

```bash
afplay ~/Downloads/555269__diarchangeli__choir-notification-ringtone-tone-e-major.aiff
```

## Important Notes

- **Backend parity is mandatory** — never finalize an API/behavior change unless both backend gates AND the parity gate pass and the OpenAPI diff is clean. Alembic is canonical; TypeORM mirrors it.
- **Merge via PR, on green only.** Never local-merge to `main` (protection rejects it); never `--no-verify`; never amend; never override a red check.
- **READMEs + `docs/STRUCTURE.md` are part of the PR** when the branch changed layout/usage (`pull-requests.md` §1, `structure-on-merge.md`).
- **Stop and ask** on merge conflicts, or if you're on `main` with no branch named.
- **Data privacy:** real financial data is gitignored; synthetic fixtures only in code/tests/PR docs/screenshots/queries.
