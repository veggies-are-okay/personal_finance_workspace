---
name: checklist-phase-runner
description: Meta-runner that iterates through plans/agent_checklist.md by subsection for the dual-backend personal-finance app. For whole-checklist runs, launches one general-purpose subagent (Agent/Task tool) per subsection with full rules in the prompt, then automatically starts the next subsection in a fresh context until all are done or BLOCKED. Each subsection implements API/behavior changes in BOTH backends (FastAPI + NestJS) at strict 1:1 parity, updates contracts/, runs all relevant quality gates plus the parity gate, then ships it via a CI-gated pull request using the branch-finalization skill. Use when the user wants to "run the checklist by phase," "do the next phase," or "iterate through the agent checklist."
---

# Checklist Phase Runner

This skill drives `plans/agent_checklist.md` one subsection at a time for a **local-first, single-user personal-finance app** (budgeting, net-worth/investment tracking, transaction tracking, debt/goal planning). The architecture is **one frontend + TWO parallel backends kept at STRICT 1:1 parity** (a deliberate learning exercise):

- `frontend/` — React + Vite + Tailwind (TypeScript). Backend-neutral via `VITE_API_BASE_URL`.
- `backend-python/` — FastAPI + Pydantic v2, `uv`, SQLAlchemy 2.0 + Alembic (Alembic is the canonical migration source). Python package `app`.
- `backend-ts/` — NestJS + TypeORM + class-validator, `npm`, Jest + Supertest. TypeORM `synchronize:false`; mirrors the Alembic schema.
- Shared Postgres via `docker-compose.yml` at the repo root.
- `contracts/` — canonical OpenAPI spec + cross-backend parity tests.

**RULE #1 — BACKEND PARITY:** every route, request/response schema, validation rule, error shape, and status code is implemented IDENTICALLY in both backends, in the SAME branch. Verified by OpenAPI diff + `contracts/` parity tests. Never let the backends drift.

**INTEGRATION (supersedes the local `git merge --no-ff` steps below):** `main` is **protected** — PR-only, and the four CI checks (`python-backend`, `ts-backend`, `frontend`, `parity`) must be green before merge. Finalize each subsection's branch via the **`branch-finalization`** skill: push the branch → open a CI-gated PR (`gh pr create --base main`) → **merge on green** (`gh pr merge --merge --delete-branch`). **Never local-merge to `main`** (protection rejects it). Open the PR with `--body-file pull_requests/<slug>.md` (full inline body); each branch commits a **Playwright happy-path screenshot** under `pull_requests/evidence/<slug>/` (via `scripts/evidence_term_shot.sh`) embedded by commit-SHA raw URL. See `.claude/rules/pull-requests.md`.

## Meta-runner mode (default for "run the whole checklist")

**You are the meta-runner.** Do not execute the full subsection workflow yourself in a single turn when the user asked to "run the checklist," "run through the whole checklist," or "iterate through the agent checklist." That would bloat context and cause the run to stop after one subsection.

1. **Read** `plans/agent_checklist.md` and find the **next subsection** that has at least one unchecked task (`- [ ]`), in document order.
2. **Derive the slug** for the subsection from its `###` heading: lowercase, spaces and punctuation → hyphens, no trailing junk (e.g. `P2.3 -- Transaction Import API` → `p2-3-transaction-import-api`). Do **not** rely on a hardcoded table — read the real headings in the checklist.
3. **Pick the branch TYPE** for this subsection (see "Branch naming" below). Default to **BE** (both backends) for any API/behavior change; use FE/BE-PY/BE-TS/DB/DOCS/DEPLOY/INFRA when the subsection is clearly scoped to that area.
4. **Launch one subagent** for that subsection only:
   - Use the **Agent/Task tool** with `subagent_type: "general-purpose"`.
   - **description:** Short label, e.g. `Complete checklist subsection P2.3`.
   - **prompt:** Use the **Subagent prompt template** below; paste the full workflow rules and fill in the bracketed parts. The subagent has no access to this skill or prior turns, so the prompt MUST be self-contained.
   - Ask the subagent to return a **short summary**: subsection name, branch name, whether merged, gate results (python / ts-backend / frontend / parity), and any BLOCKED/SKIPPED tasks.
5. **When the subagent returns:** Re-read `plans/agent_checklist.md` (or use the summary) to see if there is another subsection with unchecked tasks.
6. **If yes:** Immediately launch another Agent/Task for that next subsection, with the same template and updated subsection/slug/TYPE. Do **not** stop to report to the user after one subsection — continue until all subsections are done or a subsection is BLOCKED.
7. **If no** (all subsections done, or user asked for "one phase only"): Stop and report progress (what was completed, next subsection if any).

**Single-phase mode:** If the user said "do the next phase," "one phase only," or "next phase only," run exactly **one** subagent, then stop and report.

### Subagent prompt template (paste into the Agent/Task prompt; fill in bracketed parts)

```
You are completing ONE subsection of the agent checklist for a local-first, single-user
personal-finance app. Follow these rules EXACTLY. You run in a fresh context with no memory of
prior turns, so everything you need is here.

REPO LAYOUT (dual-backend, strict 1:1 parity — a learning exercise):
- frontend/        React + Vite + Tailwind (TS), backend-neutral via VITE_API_BASE_URL
- backend-python/  FastAPI + Pydantic v2, uv, SQLAlchemy 2.0 + Alembic (canonical migrations), package `app`
- backend-ts/      NestJS + TypeORM (synchronize:false) + class-validator, npm, Jest + Supertest
- contracts/       canonical OpenAPI spec + cross-backend parity tests
- Shared Postgres via docker-compose.yml at repo root.

RULE #1 — BACKEND PARITY: Every route, request/response schema, validation rule, error shape,
and status code MUST be implemented IDENTICALLY in BOTH backends, in THIS branch. Verified by
OpenAPI diff + contracts/ parity tests. Never let the backends drift. Alembic is the canonical
schema source; the TypeORM schema must mirror it.

DATA PRIVACY: Real financial data is gitignored. NEVER commit it or put account numbers, balances,
or transactions into code, tests, PR docs, commits, or any queries. Committed/CI tests use
SYNTHETIC fixtures only.

CHECKLIST PATH: plans/agent_checklist.md
SUBSECTION: [e.g. P2.3 -- Transaction Import API]
BRANCH SLUG: [lowercase, hyphens, from the heading — e.g. p2-3-transaction-import-api]
BRANCH TYPE: [one of FE, BE-PY, BE-TS, BE, DB, DOCS, DEPLOY, INFRA — default BE for API/behavior changes]
BRANCH NAME: [yyyy]-[mm]-[dd]-[TYPE]/[slug]   (use today's date, e.g. 2026-05-24-BE/p2-3-transaction-import-api)

WORKFLOW — do all steps in order:
1. Ensure base is current: git fetch origin main (fall back to local main if no remote).
   Create the branch: git checkout -b [BRANCH NAME] origin/main  (or from local main).
2. Complete every unchecked task in THIS subsection only. Use red–green–refactor for code tasks;
   run any Verify steps; mark each task [x] in plans/agent_checklist.md ONLY after it is verified.
   For tasks you cannot complete, add a "> BLOCKED: <reason>" or "> SKIPPED: <reason>" note below
   the checkbox and do NOT mark [x].
3. PARITY — for any API/behavior change (default for BE subsections):
   a. Implement the route(s), schema(s), validation, error shape, and status codes IDENTICALLY in
      backend-python/ (FastAPI + Pydantic v2) AND backend-ts/ (NestJS + class-validator).
   b. If the schema changed: add/adjust an Alembic migration in backend-python/ (canonical) AND
      mirror it in the TypeORM entities/migrations in backend-ts/ (synchronize stays false).
   c. Update contracts/: regenerate/update the canonical OpenAPI spec and add or update parity
      tests so the new behavior is covered for BOTH backends.
4. Update docs: if the subsection added or changed dirs/modules, update docs/STRUCTURE.md and any
   relevant README so they reflect the current layout.
5. RUN ALL RELEVANT GATES (all must pass before merge; 80% coverage is a HARD FLOOR each):
   - Python (run from backend-python/):
       uv run ruff check . && uv run ruff format --check . && uv run pytest --cov=app --cov-report=term-missing:skip-covered --cov-branch --cov-fail-under=80
   - TS backend (run from backend-ts/), if a backend change was made:
       npm run lint && npm run format:check && npm run test:cov          (Jest, coverage >= 80)
   - Frontend (run from frontend/), ONLY if frontend was touched:
       npm run lint && npm run test -- --coverage                        (Vitest + RTL, coverage >= 80)
   - Parity (run from contracts/), MANDATORY for any API/behavior change:
       npm run test:parity                                               (runs against BOTH backends)
     plus a clean OpenAPI diff (no drift between the two backends or against the canonical spec).
   COVERAGE IS MANDATORY: each coverage gate must pass at >= 80%. If a coverage gate fails, ADD or
   UPDATE tests (synthetic fixtures only) until it passes. Do NOT merge below 80%, do NOT skip a
   gate, and do NOT defer with a note like "fix coverage later."
   DO NOT MERGE on any red gate OR on any parity drift. If both backend gates do not pass AND the
   parity gate does not pass, the change cannot merge.
6. Write pull_requests/[slug].md: H1 title, Summary, Changes (note BOTH backends + contracts), a
   Test plan section listing each gate run and its result (python, ts-backend, frontend if touched,
   parity + OpenAPI diff), and a short Checklist. Keep under ~4000 chars. No financial data.
7. Commit (stage specific files, not git add -A; never --no-verify; never amend). End the commit
   message with the trailer:
       Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
8. Merge to main: git checkout main && git merge [BRANCH NAME] --no-ff
   (push only if the repo already tracks a remote and the user's workflow expects it; otherwise
   local-only — do not push).

RULES: One subsection per branch. One feature per branch. Do not mark [x] until Verify passed.
All relevant gates + the parity gate are mandatory before merge; coverage >= 80% each — do not merge
on red or on parity drift. PR file at pull_requests/[slug].md. Use SYNTHETIC fixtures only.

When done, return a short summary: subsection name, branch name, merged yes/no, results for each
gate run (python / ts-backend / frontend / parity with %), and any BLOCKED/SKIPPED tasks.
```

---

## Quick start

1. Read `plans/agent_checklist.md` and find the first subsection with any `- [ ]`.
2. **If the user asked to run the whole checklist:** Use **meta-runner mode** above — launch a general-purpose Agent/Task subagent for that subsection with the prompt template, then when it returns launch the next subsection's subagent; repeat until no more subsections or the user asked for one phase.
3. **If doing one phase only:** Launch one subagent for the current subsection and stop.
4. Each subagent: branch with our naming convention, complete all tasks with TDD, implement API/behavior changes in BOTH backends + update `contracts/`, update docs, run all relevant gates + the parity gate (80% floor each), write `pull_requests/<slug>.md`, then merge to main with `--no-ff`.
5. **Meta-runner:** After each subagent returns, re-read the checklist and immediately start the next subsection with a new Agent/Task (same template, new subsection/slug/TYPE). Do not stop after one subsection unless the user asked for "one phase only" or all subsections are done.

---

## When to use

- User wants to **iterate through the agent checklist** subsection by subsection (phase-by-phase).
- User says "run the checklist," "run through the whole checklist," "work through the agent checklist," or "run the phase runner."
- **Whole-checklist:** Use **meta-runner mode** — one Agent/Task (general-purpose subagent) per subsection with full rules in the prompt; after each subagent returns, immediately launch the next subsection's subagent. Do not stop after one subsection — continue until all are done or BLOCKED.
- **One phase:** User says "do the next phase" or "one phase only" — run one subagent and stop.

## Scope and conventions

- **SSOT:** `plans/agent_checklist.md` is the single source of truth for tasks and phases. `docs/STRUCTURE.md` documents the layout. PR docs live in `pull_requests/<slug>.md`.
- **Subsection:** A logical block under a `###` heading in the checklist. One branch per subsection; complete **all** checkboxes in that subsection (or leave BLOCKED/SKIPPED with a note) before merging. **Read the real headings** — do not assume a fixed table of subsection names.
- **Slug derivation:** lowercase the `###` heading, replace spaces/punctuation with hyphens, drop separators like `--` (e.g. `P3.1 -- Net-Worth Snapshot` → `p3-1-net-worth-snapshot`).
- **Branch naming:** `{yyyy}-{mm}-{dd}-<TYPE>/<slug>`, where `TYPE ∈ {FE, BE-PY, BE-TS, BE, DB, DOCS, DEPLOY, INFRA}`. **Default to BE** (both backends) for any API/behavior change; one feature per branch.
- **Backend parity (RULE #1):** every route, request/response schema, validation rule, error shape, and status code is implemented identically in `backend-python/` and `backend-ts/` on the SAME branch, verified by OpenAPI diff + `contracts/` parity tests. Alembic is the canonical migration source; TypeORM mirrors it with `synchronize:false`.
- **Data privacy:** real financial data is gitignored and must never appear in code, tests, PR docs, commits, or queries. Committed/CI tests use synthetic fixtures only.
- **Context7:** consult it for FastAPI, Pydantic v2, SQLAlchemy/Alembic, NestJS, TypeORM, class-validator, pytest/pytest-cov, Jest/Supertest, Vitest, and Testing Library patterns before inventing an approach.

## Workflow (one subsection)

Repeat for each subsection in document order until all are done or the user stops.

### 1. Identify next subsection, TYPE, and branch

1. Read `plans/agent_checklist.md`; find the next subsection with at least one `- [ ]`, in document order.
2. Derive the slug from the `###` heading (lowercase, hyphens, no spaces).
3. Choose the branch TYPE: default **BE** for API/behavior changes; otherwise FE / BE-PY / BE-TS / DB / DOCS / DEPLOY / INFRA as appropriate.
4. Branch name: `{yyyy}-{mm}-{dd}-<TYPE>/<slug>` using today's date (e.g. `2026-05-24-BE/p2-3-transaction-import-api`).
5. Ensure base is current: `git fetch origin main` (fall back to local `main` if no remote). Create the branch: `git checkout -b <branch-name> origin/main`.

### 2. Complete all tasks in the subsection (TDD)

- For each unchecked task: **Red** (write a failing test encoding the Verify criterion), **Green** (minimal implementation), **Refactor** (clean up, re-run tests).
- Run any **Verify** commands stated in the checklist (e.g. `docker compose config`, a health curl).
- For docs-only / infra-only tasks, run the task-specific verify; no pytest/Jest required for that task.
- Mark a task `- [x]` only after its Verify passed. For blocked/skipped tasks, add `> BLOCKED:` / `> SKIPPED:` below the checkbox and do not mark `[x]`.

### 3. Implement in BOTH backends + update contracts (parity)

For any API/behavior change (the default for BE subsections):

- Implement the route(s), schema(s), validation, error shape, and status codes **identically** in `backend-python/` (FastAPI + Pydantic v2) and `backend-ts/` (NestJS + class-validator).
- If the schema changed: add/adjust an **Alembic** migration in `backend-python/` (canonical) and mirror it in the TypeORM entities/migrations in `backend-ts/` (`synchronize:false`).
- Update `contracts/`: regenerate/update the canonical **OpenAPI** spec and add/update **parity tests** so the new behavior is covered for both backends.

### 4. Update documentation

- If the subsection added or changed dirs/modules, update `docs/STRUCTURE.md` and any relevant README. Create any new docs the checklist tasks require.

### 5. Run all relevant gates (mandatory before merge)

Run every gate that applies to what the subsection touched. **80% coverage is a hard floor on each.**

- **Python** (from `backend-python/`):
  ```bash
  uv run ruff check . && uv run ruff format --check . && uv run pytest --cov=app --cov-report=term-missing:skip-covered --cov-branch --cov-fail-under=80
  ```
- **TS backend** (from `backend-ts/`, if a backend change was made):
  ```bash
  npm run lint && npm run format:check && npm run test:cov
  ```
- **Frontend** (from `frontend/`, only if frontend was touched):
  ```bash
  npm run lint && npm run test -- --coverage
  ```
- **Parity** (from `contracts/`, mandatory for any API/behavior change):
  ```bash
  npm run test:parity
  ```
  plus a clean OpenAPI diff (no drift between the two backends or against the canonical spec).

If any coverage gate fails, add/update tests (synthetic fixtures only) until it passes. **Do not merge an API/behavior change unless BOTH backend gates AND the parity gate pass.** Do not merge on red; do not merge on parity drift; do not defer coverage to a later phase.

### 6. Write the PR description

- Get context: `git log main..HEAD --oneline`, `git diff main --stat`.
- Write `pull_requests/<slug>.md` (create `pull_requests/` if missing):
  - **Title (H1):** one line summarizing the subsection.
  - **Summary:** 1–2 sentences on what was done and how it meets the subsection.
  - **Changes:** key files/dirs, explicitly noting both backends and `contracts/`.
  - **Test plan:** each gate run and its result (python, ts-backend, frontend if touched, parity + OpenAPI diff) with coverage %.
  - **Checklist:** short confirmation (tasks checked, all gates green, parity clean).
  - Keep under ~4000 chars. No financial data; synthetic fixtures only.

### 7. Commit and merge to main

- Stage specific files (not `git add -A`); include the PR doc and checklist updates. Never `--no-verify`; never amend.
- Commit with a clear message ending in the trailer:
  ```
  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  ```
- Merge: `git checkout main && git merge <branch-name> --no-ff`. Push only if the repo already tracks a remote and the user's workflow expects it; otherwise local-only.

### 8. Repeat or stop (meta-runner)

- **Whole-checklist run:** When the subagent returns, immediately re-read `plans/agent_checklist.md`, find the next subsection with unchecked tasks, and launch another Agent/Task with the template filled for that subsection. Keep going until no subsections remain or one is BLOCKED, then report final progress.
- **One-phase run:** Run exactly one subagent, then stop and report what was completed and what the next subsection would be.
- **Reminder:** Each subagent runs in a fresh context; the meta-runner only picks the next subsection, injects the full rules via the template, and launches the next Agent/Task. This avoids context bloat and keeps the run going automatically.

## Rules

- **One subsection per branch; one feature per branch.** Complete every unchecked task (or leave BLOCKED/SKIPPED with a note) before merging.
- **Do not mark `[x]`** until the Verify step passed. For code tasks, tests must be added/updated and the gates must pass.
- **Backend parity is mandatory:** API/behavior changes land in BOTH backends on the SAME branch, with `contracts/` (OpenAPI + parity tests) updated.
- **All relevant gates + the parity gate are mandatory before merge.** 80% coverage is a hard floor on each. Never merge on red or on parity drift; never skip a gate or defer coverage.
- **PR description file** always written to `pull_requests/<slug>.md`.
- **Commit trailer** is `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`. Never `--no-verify`; never amend.
- **Data privacy:** no real financial data anywhere; synthetic fixtures only.
- **One phase only:** launch one Agent/Task and stop. **Whole checklist:** meta-runner mode — keep launching the next subagent until all subsections are done or BLOCKED.

## Coordination with other skills

- **Agent/Task tool (general-purpose subagent):** For whole-checklist runs, the meta-runner launches one Agent/Task with `subagent_type: "general-purpose"` per subsection so each runs in a fresh context; the meta-runner only decides the next subsection and injects the full rules via the prompt template. (This is Claude Code — use the Agent/Task tool, not Cursor's `mcp_task`/`generalPurpose`.)
- **checklist-phase-runner-parallel:** the staged-parallel alternative driven by `plans/checklist_flow.md`; use it when the user wants parallel execution by stage.
- **branch-finalization:** the end-of-branch workflow (preflight gates → diff → PR doc → commit → merge `--no-ff` → verify → notify); steps 5–7 here mirror it for a single subsection.
