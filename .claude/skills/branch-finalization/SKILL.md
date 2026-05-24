---
name: branch-finalization
description: End-of-branch workflow for the dual-backend personal-finance app. Runs preflight quality gates (both backend gates + frontend gate if touched + the cross-backend parity gate), gathers the diff, writes a PR doc, commits, merges to main with --no-ff, verifies, and optionally notifies. Aborts on any gate failure or backend parity drift. Local-only — never pushes unless the user asks; never amends; never uses --no-verify. Use when the user says "finalize branch," "merge this in," "wrap this up," "branch finalization," or "create a PR and merge."
---

# Branch Finalization

Automates the end-of-branch workflow for a **local-first, single-user personal-finance app**: run quality gates, update documentation, commit, write a PR doc, and merge into `main`.

The repo has one frontend and **TWO parallel backends kept at STRICT 1:1 parity** (a learning exercise):

- `frontend/` — React + Vite + Tailwind (TS), backend-neutral via `VITE_API_BASE_URL`.
- `backend-python/` — FastAPI + Pydantic v2, `uv`, SQLAlchemy 2.0 + Alembic (canonical migrations), package `app`.
- `backend-ts/` — NestJS + TypeORM (`synchronize:false`) + class-validator, `npm`, Jest + Supertest.
- `contracts/` — canonical OpenAPI spec + cross-backend parity tests.
- Shared Postgres via `docker-compose.yml` at the repo root.

**RULE #1 — BACKEND PARITY:** every route, request/response schema, validation rule, error shape, and status code must be implemented IDENTICALLY in both backends on this branch, verified by OpenAPI diff + `contracts/` parity tests. **Do not finalize a branch with API/behavior changes unless both backend gates AND the parity gate pass.**

## When to Use

- User says "finalize branch," "merge this in," "wrap this up," "branch finalization," or "create a PR and merge."
- After completing a feature or fix on a feature branch and wanting to ship it to `main`.
- When the user wants to document, commit, and merge in one step.

## Prerequisites

- You are on a feature branch (not `main`). Branches follow `{yyyy}-{mm}-{dd}-<TYPE>/<slug>` with `TYPE ∈ {FE, BE-PY, BE-TS, BE, DB, DOCS, DEPLOY, INFRA}` (e.g. `2026-05-24-BE/p4-2-debt-payoff-plan`).
- All code changes are complete and ready to ship.
- If the branch made API/behavior changes, they are already implemented in **both** backends and `contracts/` (OpenAPI + parity tests) is updated. If not, fix that before finalizing — parity is non-negotiable.

## Workflow

### Step 1: Preflight Gates (abort on any failure or parity drift)

Run every gate that applies to what the branch touched. **80% coverage is a hard floor on each.** This is local-only — do not push.

```bash
# Python backend gate (run from backend-python/)
cd backend-python && uv run ruff check . && uv run ruff format --check . && \
uv run pytest --cov=app --cov-report=term-missing:skip-covered --cov-branch --cov-fail-under=80

# TS backend gate (run from backend-ts/) — required for any backend change
cd backend-ts && npm run lint && npm run format:check && npm run test:cov

# Frontend gate (run from frontend/) — ONLY if the frontend was touched
cd frontend && npm run lint && npm run test -- --coverage

# Parity gate (run from contracts/) — MANDATORY for any API/behavior change
cd contracts && npm run test:parity
```

Also confirm a **clean OpenAPI diff** (no drift between the two backends or against the canonical `contracts/` spec).

**Mandatory rules:**
- Both backend gates run for any API/behavior change; the frontend gate runs if `frontend/` was touched; the parity gate runs for any API/behavior change.
- **If ANY gate fails, or the OpenAPI diff shows drift, ABORT.** Report the failure and stop — do NOT commit or merge broken code, and do NOT merge with the backends out of parity.
- Coverage below 80% on any gate is a failure: add/update tests (synthetic fixtures only) until it passes, or abort.

### Step 2: Gather Context

Understand what changed on this branch vs `main`:

```bash
git branch --show-current
git status --short
git diff main --stat
git log main..HEAD --oneline
```

### Step 3: Write PR Documentation

Create a PR doc at `pull_requests/<branch-slug>.md` (the `<slug>` portion of the branch name). Structure:

```markdown
# PR: <Title>

**Branch:** `<branch-name>`           (e.g. 2026-05-24-BE/p4-2-debt-payoff-plan)
**Base:** `main`
**Date:** <today>

## Summary
<2-4 sentences: what changed and why, before/after impact>

## Changes
<Grouped by area — note BOTH backends and contracts/ for API changes:
 backend-python/ (FastAPI/Pydantic/Alembic), backend-ts/ (NestJS/TypeORM/class-validator),
 contracts/ (OpenAPI + parity tests), frontend/ if touched>

## Test plan
- [x] Python backend: <N> tests pass, <X>% coverage; ruff lint + format clean
- [x] TS backend: <N> tests pass, <X>% coverage; eslint + format clean
- [x] Frontend (if touched): <N> tests pass, <X>% coverage; lint clean
- [x] Parity: contracts/ parity tests pass against BOTH backends; OpenAPI diff clean
- [x] <specific new tests added>
```

Keep it under ~4000 chars. **No financial data** — no account numbers, balances, or transactions; reference synthetic fixtures only.

### Step 4: Commit

Stage the relevant files and commit with a descriptive message:

```bash
git add <specific files>
git commit -m "$(cat <<'EOF'
<type>: <short description>

<body explaining what and why; note parity across both backends + contracts/ if relevant>

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

Commit types: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`.

**Rules:**
- Stage specific files, not `git add -A`.
- Include the PR doc and any checklist/flow/docs files in the commit.
- **Never** skip hooks (`--no-verify`).
- **Never** amend an existing commit — always create a new one.
- End the commit message with the trailer exactly: `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`.

### Step 5: Merge into Main

```bash
git checkout main
git merge <feature-branch> --no-ff -m "Merge branch '<feature-branch>'"
```

**Rules:**
- Always use `--no-ff` to preserve branch history.
- Do NOT force push.
- Do NOT delete the feature branch automatically (leave that to the user).

### Step 6: Verify

```bash
git log --oneline -3
git branch --show-current   # should be main
```

For an API/behavior change, optionally re-run the parity gate against merged `main` to confirm the backends still match:

```bash
cd contracts && npm run test:parity
```

### Step 7: Notify

Report what was done:
- Branch name and commit hash.
- Number of files changed.
- Gate results summary (python, ts-backend, frontend if touched, parity + OpenAPI diff).
- Merge commit hash.

Then, if the user opts in to the notification sound:

```bash
afplay ~/Downloads/555269__diarchangeli__choir-notification-ringtone-tone-e-major.aiff
```

## Important Notes

- **Local-only.** Never push to a remote unless the user explicitly asks.
- **Backend parity is mandatory.** Do not finalize an API/behavior change unless both backend gates AND the parity gate pass and the OpenAPI diff is clean. The canonical Alembic schema and `contracts/` OpenAPI spec are authoritative; the TypeORM schema must mirror Alembic.
- **Never amend** existing commits. Always create new ones.
- **Never `--no-verify`.**
- **If any preflight gate fails or parity drifts**, stop and report the failure. Do not proceed to merge.
- **If there are merge conflicts**, stop and ask the user how to resolve them.
- **If already on `main`**, ask the user which branch to finalize.
- **Data privacy:** real financial data is gitignored; never put account numbers, balances, or transactions into code, tests, PR docs, commits, or queries. Use synthetic fixtures only.
