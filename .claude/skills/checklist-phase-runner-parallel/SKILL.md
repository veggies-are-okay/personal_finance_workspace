---
name: checklist-phase-runner-parallel
description: Staged parallel runner over plans/agent_checklist.md using plans/checklist_flow.md for the dual-backend personal-finance app. Runs one stage at a time; within each stage launches multiple general-purpose subagents (Agent/Task tool) in parallel for independent subsections (each implements both backends + contracts at strict 1:1 parity and pushes its branch), then the meta-runner ships them as CI-gated pull requests (via the branch-finalization skill), merging on green in the defined order, and updates the checklist_flow running tally. Use when the user wants "run the checklist in parallel," "run by stage," "parallel phase runner," or "checklist flow."
---

# Checklist Phase Runner (Parallel by Stage)

## Overview

This skill executes the **remaining** checklist subsections in **stages** defined in `plans/checklist_flow.md`. Within each stage, multiple **independent** subsections run in **parallel** (one subagent per subsection). Stages run **sequentially**. After all subagents for a stage complete, the meta-runner **merges** their branches to `main` in a fixed order, then **updates** the running tally in `plans/checklist_flow.md`.

The project is a **local-first, single-user personal-finance app** with one frontend and **TWO parallel backends kept at STRICT 1:1 parity** (a learning exercise):

- `frontend/` — React + Vite + Tailwind (TS), backend-neutral via `VITE_API_BASE_URL`.
- `backend-python/` — FastAPI + Pydantic v2, `uv`, SQLAlchemy 2.0 + Alembic (canonical migrations), package `app`.
- `backend-ts/` — NestJS + TypeORM (`synchronize:false`) + class-validator, `npm`, Jest + Supertest.
- `contracts/` — canonical OpenAPI spec + cross-backend parity tests.
- Shared Postgres via `docker-compose.yml` at the repo root.

**RULE #1 — BACKEND PARITY:** every route, request/response schema, validation rule, error shape, and status code is implemented IDENTICALLY in both backends, in the SAME branch. Verified by OpenAPI diff + `contracts/` parity tests. Never let the backends drift.

**INTEGRATION (supersedes the local `git merge --no-ff` / `git push origin main` steps below):** `main` is **protected** — PR-only, and the four CI checks must be green before merge. The meta-runner finalizes each stage's branches via the **`branch-finalization`** skill: push → open a CI-gated PR per branch (`gh pr create --base main`) → **merge on green** in the stage's defined order (`gh pr merge --merge --delete-branch`) → re-verify parity on `main`. **Never local-merge to `main`** (protection rejects it). See `.claude/rules/pull-requests.md`.

**Flow source:** `plans/checklist_flow.md` (stages, merge order, running tally).
**Checklist source:** `plans/agent_checklist.md` (subsection headings, tasks, slugs).

## Meta-runner mode (default)

**You are the meta-runner.** Do not run the full workflow for all stages in one turn.

1. **Read** `plans/checklist_flow.md`. Find the **first stage** whose "Running tally" row is still `- [ ]`.
2. **Resolve stage → subsections.** Use the stage-to-subsections mapping in that file. For the current stage you have a list of subsections and a **merge order**. **Read the real mapping** — do not assume a fixed table.
3. **Derive each subsection's slug and TYPE.** Slug = lowercase the `###` heading from `plans/agent_checklist.md`, spaces/punctuation → hyphens (e.g. `P3.2 -- Budget Rollover` → `p3-2-budget-rollover`). TYPE defaults to **BE** (both backends) for API/behavior changes; use FE/BE-PY/BE-TS/DB/DOCS/DEPLOY/INFRA when the subsection is clearly scoped.
4. **Launch one subagent per subsection in parallel** for that stage:
   - Use the **Agent/Task tool** with `subagent_type: "general-purpose"` for **each** subsection in the stage, in the same turn.
   - **description:** e.g. `Checklist subsection P3.2 Budget Rollover`.
   - **prompt:** Use the **Subagent prompt template (parallel)** below; fill in the subsection heading, slug, TYPE, and branch name. Each subagent **pushes its branch and returns — it does NOT merge to main**.
5. **When all subagents for the stage have returned:** Merge their branches to `main` in the **merge order** from `checklist_flow.md` (see "Merge step"). Resolve conflicts deterministically; the canonical Alembic schema and the `contracts/` OpenAPI spec take precedence when reconciling.
6. **Update** `plans/checklist_flow.md`: in the "Running tally" table, change that stage's row from `- [ ]` to `- [x]` and set "Last updated" to the current date/stage.
7. **Next stage or stop:** If another stage is still `- [ ]`, go to step 2 for the next stage. If the user asked for **one stage only**, stop and report. Otherwise continue until all stages are `- [x]` (or a conditional final stage is intentionally skipped).

**Single-stage mode:** If the user said "this stage only," "stage N only," or "one stage only," run exactly **one** stage (parallel subagents → merge in order → update tally) and then stop.

## Subagent prompt template (parallel)

Use this for each Agent/Task. **Do NOT** include "merge to main"; the meta-runner merges after the stage.

```
You are completing ONE subsection of the agent checklist as part of a PARALLEL stage for a
local-first, single-user personal-finance app. Follow these rules EXACTLY. You run in a fresh
context with no memory of prior turns. Do NOT merge to main — push your branch and return; the
meta-runner merges all stage branches in order afterward.

REPO LAYOUT (dual-backend, strict 1:1 parity — a learning exercise):
- frontend/        React + Vite + Tailwind (TS), backend-neutral via VITE_API_BASE_URL
- backend-python/  FastAPI + Pydantic v2, uv, SQLAlchemy 2.0 + Alembic (canonical migrations), package `app`
- backend-ts/      NestJS + TypeORM (synchronize:false) + class-validator, npm, Jest + Supertest
- contracts/       canonical OpenAPI spec + cross-backend parity tests
- Shared Postgres via docker-compose.yml at repo root.

RULE #1 — BACKEND PARITY: Every route, request/response schema, validation rule, error shape, and
status code MUST be implemented IDENTICALLY in BOTH backends, in THIS branch. Verified by OpenAPI
diff + contracts/ parity tests. Never let the backends drift. Alembic is the canonical schema
source; the TypeORM schema must mirror it.

DATA PRIVACY: Real financial data is gitignored. NEVER commit it or put account numbers, balances,
or transactions into code, tests, PR docs, commits, or queries. Committed/CI tests use SYNTHETIC
fixtures only.

CHECKLIST PATH: plans/agent_checklist.md
SUBSECTION: [e.g. P3.2 -- Budget Rollover]
BRANCH SLUG: [lowercase, hyphens, from the heading — e.g. p3-2-budget-rollover]
BRANCH TYPE: [one of FE, BE-PY, BE-TS, BE, DB, DOCS, DEPLOY, INFRA — default BE for API/behavior changes]
BRANCH NAME: [yyyy]-[mm]-[dd]-[TYPE]/[slug]   (use today's date, e.g. 2026-05-24-BE/p3-2-budget-rollover)

WORKFLOW — do all steps in order:
1. Ensure base is current: git fetch origin main (fall back to local main if no remote).
   Create the branch: git checkout -b [BRANCH NAME] origin/main  (or from local main).
2. Complete every unchecked task in THIS subsection only. Red–green–refactor for code tasks; run
   Verify steps; mark each task [x] in plans/agent_checklist.md ONLY after it is verified. For tasks
   you cannot complete, add "> BLOCKED: <reason>" or "> SKIPPED: <reason>" below the checkbox and do
   NOT mark [x].
3. PARITY — for any API/behavior change (default for BE subsections):
   a. Implement route(s), schema(s), validation, error shape, and status codes IDENTICALLY in
      backend-python/ (FastAPI + Pydantic v2) AND backend-ts/ (NestJS + class-validator).
   b. If the schema changed: add/adjust an Alembic migration in backend-python/ (canonical) AND
      mirror it in the TypeORM entities/migrations in backend-ts/ (synchronize stays false).
   c. Update contracts/: regenerate/update the canonical OpenAPI spec and add/update parity tests so
      the new behavior is covered for BOTH backends.
4. Update docs/STRUCTURE.md and any relevant README if the subsection changed dirs/modules.
5. RUN ALL RELEVANT GATES (all must pass; 80% coverage is a HARD FLOOR each):
   - Python (from backend-python/):
       uv run ruff check . && uv run ruff format --check . && uv run pytest --cov=app --cov-report=term-missing:skip-covered --cov-branch --cov-fail-under=80
   - TS backend (from backend-ts/), if a backend change was made:
       npm run lint && npm run format:check && npm run test:cov          (Jest, coverage >= 80)
   - Frontend (from frontend/), ONLY if frontend was touched:
       npm run lint && npm run test -- --coverage                        (Vitest + RTL, coverage >= 80)
   - Parity (from contracts/), MANDATORY for any API/behavior change:
       npm run test:parity                                               (runs against BOTH backends)
     plus a clean OpenAPI diff (no drift between the two backends or against the canonical spec).
   COVERAGE IS MANDATORY: add/update tests (synthetic fixtures only) until every coverage gate passes
   at >= 80%. Do NOT proceed if any gate is red OR if there is parity drift. Both backend gates AND
   the parity gate must pass.
6. Write pull_requests/[slug].md: H1 title, Summary, Changes (note BOTH backends + contracts), a Test
   plan listing each gate run + result (python, ts-backend, frontend if touched, parity + OpenAPI
   diff), and a short Checklist. Keep under ~4000 chars. No financial data.
7. Commit (stage specific files, not git add -A; never --no-verify; never amend). End the commit
   message with the trailer:
       Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
8. Push your branch: git push -u origin [BRANCH NAME]  (only if the repo tracks a remote). DO NOT
   merge to main — the meta-runner merges stage branches in order. If there is no remote, leave the
   branch locally and report its exact name so the meta-runner can merge it.

RULES: One subsection per branch. One feature per branch. Do not mark [x] until Verify passed. Both
backend gates + the parity gate mandatory before reporting success; coverage >= 80% each. Do NOT
merge — the meta-runner merges in order. PR file at pull_requests/[slug].md. SYNTHETIC fixtures only.

When done, return a short summary: subsection name, EXACT branch name, branch pushed/created yes/no,
results for each gate run (python / ts-backend / frontend / parity with %), and any BLOCKED/SKIPPED
tasks.
```

## Stage and merge-order source

The authoritative list of stages, the subsections in each stage, and the **merge order** live in `plans/checklist_flow.md`. **Read it each run** — do not hardcode a stage table here. Typical structure:

- A **stage-to-subsections mapping** (which `###` subsections run in parallel in each stage).
- A **merge order** per stage (the deterministic order to merge that stage's branches into `main`).
- A **running tally** table (one `- [ ]` / `- [x]` row per stage) plus a "Last updated" line.

For each subsection, derive `SUBSECTION` from the exact `###` heading in `plans/agent_checklist.md` and `BRANCH SLUG` by lowercasing/hyphenating that heading. Use the branch naming convention below.

## Branch naming

`{yyyy}-{mm}-{dd}-<TYPE>/<slug>`, where `TYPE ∈ {FE, BE-PY, BE-TS, BE, DB, DOCS, DEPLOY, INFRA}`. Default to **BE** (both backends) for API/behavior changes; one feature per branch. Example: `2026-05-24-BE/p3-2-budget-rollover`.

## Merge step (meta-runner, after a stage's subagents return)

For the stage just completed, merge each branch into `main` in the stage's **merge order** from `checklist_flow.md`. With a remote:

```bash
git fetch origin
git checkout main
git pull origin main
git merge origin/<branch-name> --no-ff
git push origin main
```

Without a remote (local-only), merge each subagent's local branch in order:

```bash
git checkout main
git merge <branch-name> --no-ff
```

Repeat for each branch in that stage's merge order. If a merge conflicts, resolve it deterministically — the canonical Alembic schema (`backend-python/`) and the `contracts/` OpenAPI spec take precedence; ensure the TypeORM schema still mirrors Alembic and that parity tests still pass after reconciliation. After merging the stage, re-run the parity gate from `contracts/` (`npm run test:parity` + OpenAPI diff) against the merged `main` to confirm the backends still match. Only push (if remote) once parity is clean. Then update the tally.

## Tally update (meta-runner)

In `plans/checklist_flow.md`, in the "Running tally" table:

1. Change the completed stage's row from `- [ ]` to `- [x]`.
2. Update the "Last updated" line (e.g. `*Last updated: 2026-05-24 Stage N*`).

## Conditional final stage

If `checklist_flow.md` marks a final stage as conditional (e.g. a feasibility/PoC stage gated on a "go" decision in a docs/ feasibility report), run it only if the gating doc says "go." Otherwise skip it, leave its tally row `- [ ]` with a short note, or leave it for a manual decision.

## When to use

- User wants to **run the checklist in parallel**, **by stage**, or **using the checklist flow**.
- User says "run checklist-phase-runner-parallel," "run the flow," "execute stages," or "parallel checklist."
- **Whole flow:** run each stage in order (parallel subagents → merge in order → re-verify parity → update tally) until all stages are done or skipped.
- **One stage:** run one stage and stop after updating the tally.

## Scope and conventions

- `plans/checklist_flow.md` is the source of stages, merge order, and running tally; keep it in sync after each stage.
- `plans/agent_checklist.md` remains the source of truth for task checkboxes; subagents update it as they finish tasks.
- Branch naming: `{yyyy}-{mm}-{dd}-<TYPE>/<slug>`. PR descriptions: `pull_requests/<slug>.md`. `docs/STRUCTURE.md` documents layout.
- **Backend parity (RULE #1):** every route/schema/validation/error/status implemented identically in both backends on the SAME branch, verified by OpenAPI diff + `contracts/` parity tests. Alembic canonical; TypeORM mirrors with `synchronize:false`.
- Quality gates and the 80% coverage floor are the same as in the sequential `checklist-phase-runner`: Python (`uv run ruff check . && uv run ruff format --check . && uv run pytest --cov=app --cov-report=term-missing:skip-covered --cov-branch --cov-fail-under=80`), TS backend (`npm run lint && npm run format:check && npm run test:cov`), frontend (`npm run lint && npm run test -- --coverage`), and the parity gate from `contracts/` (`npm run test:parity` + clean OpenAPI diff). Each subagent must satisfy **both backend gates + the parity gate**.
- **Data privacy:** no real financial data anywhere; synthetic fixtures only.
- **Commit trailer:** `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`. Never `--no-verify`; never amend.

## Coordination

- **Agent/Task tool (general-purpose subagent):** launch one Agent/Task with `subagent_type: "general-purpose"` per subsection in the current stage; launch all of a stage's subagents in parallel (same turn). This is Claude Code — use the Agent/Task tool, not Cursor's `mcp_task`/`generalPurpose`.
- **Merge:** only the meta-runner merges to `main`, after all of a stage's subagents have returned, in the order defined in `checklist_flow.md`, then re-verifies parity.
- **checklist-phase-runner:** the sequential alternative (one subsection at a time, subagent merges its own branch). This skill is the parallel-by-stage alternative (subagents push/return; meta-runner merges in order).
- **branch-finalization:** the per-branch finalization workflow each subagent effectively performs through step 7 (gates → PR doc → commit), stopping short of merge.
