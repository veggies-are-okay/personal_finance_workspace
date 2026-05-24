---
name: devils-advocate
description: Hardens plans/agent_checklist.md and the high-level plan for the dual-backend personal-finance app by surfacing specificity gaps, weak verification, over-mocking risk, missing coverage, and FastAPI<->NestJS parity gaps. Uses Context7-backed guidance for our stack, writes findings to docs/qa.md, and revises the checklist. Use when the user says "harden the checklist," "run devils advocate," or "validate the plan."
---

# Devils Advocate

Challenge the checklist and high-level plan so they survive contact with real code. This is a local-first, single-user personal finance app (budgeting, net-worth/investment tracking, transaction tracking, debt/goal planning) with ONE frontend and TWO parallel backends kept at STRICT 1:1 parity (FastAPI and NestJS, sharing one Postgres). Use Perplexity and Context7 research on vibe-coded app failures and checklist specificity; then analyze the repo's plans and produce justified, code-level answers, with special attention to backend parity, and write checklist revisions.

## When to Use

- User asks to "harden the checklist," "run devils advocate," or "validate the plan."
- Before major implementation phases.
- Before merging any API change that must land in BOTH backends.
- User attaches files (e.g. specs, ADRs, the canonical OpenAPI in `contracts/`, other plans) that the checklist should represent. These are often spike research on ambiguous outcomes in the plans. Go with the recommended option for all.

## Project Context (embed in every run)

- **frontend/** — React + Vite + Tailwind (TS); backend-neutral via `VITE_API_BASE_URL` (points at FastAPI or NestJS).
- **backend-python/** — FastAPI + Pydantic v2, uv, SQLAlchemy 2.0 + Alembic (canonical migrations). Package `app`. Own port (e.g. 8000).
- **backend-ts/** — NestJS + TypeORM + class-validator, npm, Jest + Supertest. `synchronize:false`, mirrors the Alembic schema. Own port (e.g. 3000).
- **Shared Postgres** (docker-compose.yml at root, port 5432). **contracts/** holds the canonical OpenAPI spec + cross-backend parity tests.
- **RULE #1 BACKEND PARITY:** every route, request/response schema, validation rule, error shape, and HTTP status code is implemented IDENTICALLY in both backends. FastAPI serves `/openapi.json`; NestJS exposes OpenAPI via `@nestjs/swagger`. Money is consistent across Python (Decimal) and TS; dates/datetimes are ISO. Verified by OpenAPI diff + `contracts/` parity tests.
- **Data privacy:** real financial data is gitignored (`docs/bank_statements/`, `docs/gemini_investments_conversation/`, `images/`, `config/accounts.yaml`). NEVER put real values in `docs/qa.md`, tests, or MCP queries.

## Prerequisites

- Read [reference.md](reference.md) for the failure-mode taxonomy and question categories (including "Cross-backend parity").
- Have [plans/agent_checklist.md](plans/agent_checklist.md) and [plans/first_pass_high_level_plan.md](plans/first_pass_high_level_plan.md) in context. Skim [docs/STRUCTURE.md](docs/STRUCTURE.md) and the canonical OpenAPI in `contracts/`. If the user attaches files, treat them as additional authority for consistency.

## Workflow

### 1. Refresh research (optional but recommended)

- **Perplexity:** Query for common problems with vibe-coded / AI-assisted apps (vague requirements, edge cases, error handling, data contracts, scope creep, integration gaps, testability). Query for lack of specificity in checklists and agent task lists (ambiguous acceptance criteria, missing verification, undefined interfaces, unspecified failure modes). Query for known pitfalls keeping two backends at 1:1 parity (OpenAPI drift, validation-error shape divergence, Decimal vs number JSON serialization, date/timezone handling). No secrets in queries.
- **Context7:** Before answering technical questions, resolve library IDs and query docs for our stack as needed for code-level justification: FastAPI, Pydantic v2, SQLAlchemy, Alembic, pytest, pytest-cov, NestJS, class-validator, TypeORM, Jest, Supertest, React, Vite, Vitest, Tailwind, and Postgres. Also query OpenAPI/Swagger generation (FastAPI `/openapi.json`, `@nestjs/swagger`) for parity questions.

### 2. Generate questions (TODO format)

- Read `plans/agent_checklist.md` section by section (Preamble, phases, Appendices).
- Cross-check each section against `plans/first_pass_high_level_plan.md`, `docs/STRUCTURE.md`, the canonical OpenAPI in `contracts/`, and any **user-attached files**.
- For each checklist item or plan claim, generate **concrete questions** in this format:

```markdown
- [ ] **Q-ID** (Phase / Area): Question text?  
  - *Rationale:* Which failure mode or specificity gap this addresses.  
  - *Source:* Checklist task ID or plan section.
```

- Cover at least:
  - **Acceptance criteria:** Binary, measurable, testable? Edge/negative cases?
  - **Verification:** Exact steps/tests to prove each task done? Does Python work name its coverage command? Does TS backend work name `npm run test:cov`?
  - **Coverage:** Hard threshold (Python `--cov-fail-under=80`), enforceable not aspirational, for BOTH backends and the frontend?
  - **Over-mocking risk:** Would the proposed tests mostly assert internal calls instead of real behavior (real routes/validation/DB vs patched internals)?
  - **Interfaces:** Request/response schemas, error codes, timeouts, versioning — defined once and mirrored in both backends?
  - **Failure modes:** Invalid payloads, partial updates, DB down, migration not applied — and expected behavior (status + error body) in BOTH backends?
  - **Data contracts:** Normalized types, nullability, date formats, money representation, naming consistency across Pydantic/TypeORM/DB/API?
  - **Integration:** Auth, sequencing, idempotency at boundaries (e.g. statement re-import).
  - **Testability:** Mock points, coverage targets, integration vs unit boundaries; parity tests in `contracts/`.
  - **Cross-backend parity (REQUIRED — at least one per API-touching task):**
    - (a) Does every API change land in **BOTH** backends (FastAPI route + NestJS controller/handler)?
    - (b) Are contract/parity tests in `contracts/` added or updated for the change (`npm run test:parity`)?
    - (c) Do error shapes + HTTP status codes match across backends (Pydantic v2 422 vs NestJS `ValidationPipe` 400 — reconciled to ONE agreed shape)?
    - (d) Is each DB schema change reflected in BOTH the Alembic migration AND the TypeORM entities (with `synchronize:false`)?
    - (e) Are money (Decimal/string) and date/datetime (ISO) formats consistent across Python and TS in requests, responses, and DB columns?

- Output the full list as a **TODO block** (copy-paste friendly) and also write it into `docs/qa.md` under a `## Devils Advocate Questions` section (with timestamp or run id).

### 3. Answer each question with code-level justification

- For each question in `docs/qa.md`:
  - **Find evidence:** Use Context7 (resolve-library-id + query-docs) for frameworks/libraries involved (FastAPI, Pydantic v2, SQLAlchemy, Alembic, pytest, NestJS, class-validator, TypeORM, Jest, Supertest, React, Vite, Vitest, Tailwind, Postgres, OpenAPI/Swagger). Use repo search or Perplexity only when Context7 doesn't cover it.
  - **Decide:** Answer with a clear decision (Yes/No/Partial) and a one-line summary.
  - **Justify:** Add 2–4 bullet points with code-level detail (API shape, config key, test pattern, doc link). For parity questions, cite the SPECIFIC artifact in each backend (FastAPI route file + NestJS controller, Alembic revision + TypeORM entity, both OpenAPI fragments).
  - **Assign to checklist:** If the answer implies a change, note the checklist task ID(s) to add or refine (e.g. "P2.3 — add `npm run test:parity` to Verify", "P3.1 — require matching Alembic + TypeORM entity").

- Append each Q&A under `docs/qa.md` in a consistent block:

```markdown
### Q-ID: Short title
- **Decision:** ...
- **Justification:**
  - ...
- **Checklist impact:** (task IDs and suggested change, or "None")
```

### 4. Revise the checklist

- Apply all "Checklist impact" items to `plans/agent_checklist.md`:
  - Add or tighten **Verify** bullets so they are observable and falsifiable.
  - Add missing verification steps, naming the EXACT gate commands:
    - Python (from `backend-python/`): `uv run ruff check . && uv run ruff format --check . && uv run pytest --cov=app --cov-report=term-missing:skip-covered --cov-branch --cov-fail-under=80`
    - TS backend (from `backend-ts/`): `npm run lint && npm run format:check && npm run test:cov`
    - Frontend (from `frontend/`): `npm run lint && npm run test -- --coverage`
    - Parity (from `contracts/`): `npm run test:parity` + OpenAPI diff clean.
  - For any API-touching task, ensure Verify requires the change in BOTH backends, an updated/added `contracts/` parity test, and a clean OpenAPI diff.
  - For any DB schema change, ensure Verify requires BOTH an Alembic migration AND updated TypeORM entities.
  - Add failure-mode or edge-case notes where the Q&A demanded it. Add or refine coverage expectations.
  - Ensure every **Verify** maps to something testable or documentable (script, test name, or runbook step).
- Preserve checklist structure (phases, owner tags, appendix references). Only add or refine; avoid removing tasks unless the high-level plan explicitly drops scope.
- Cross-check the revised checklist against `first_pass_high_level_plan.md`, `docs/STRUCTURE.md`, the `contracts/` OpenAPI, and user-attached files for consistency; fix contradictions and note any plan update in `docs/qa.md`.

### 5. Optional: Harden the high-level plan

- If Q&A revealed gaps in `first_pass_high_level_plan.md` (missing failure modes, undefined interfaces, parity rules, or acceptance criteria), propose minimal edits and document them in `docs/qa.md` under a "Plan amendments" section. Apply edits only if the user asked to "harden the plan" or "update the high-level plan."

## Outputs

| Output | Location |
|--------|----------|
| Full question list (TODO style) | `docs/qa.md` → "Devils Advocate Questions" |
| Per-question decisions and justification | `docs/qa.md` → one subsection per Q-ID |
| Checklist impact | Applied in `plans/agent_checklist.md` |
| Plan amendments (if any) | `docs/qa.md` → "Plan amendments" + edits to `plans/first_pass_high_level_plan.md` |

## User-attached files

- When the user attaches files (e.g. `@contracts/openapi.yaml`, `@path/to/spec.md`), treat them as **additional context** for consistency.
- During question generation, add questions that check alignment between the checklist and those files (e.g. "Does P2.1 transaction schema match `contracts/openapi.yaml`?", "Do both backends expose the path the spec defines?").
- When revising the checklist, ensure no task contradicts the attached files; if it does, note the conflict in `docs/qa.md` and align the checklist (or flag for user decision).

## Red-flag checklist (quick pass)

Before finishing, confirm:

- [ ] Every new or modified checklist task has a **Verify** that is observable (script, test, or runbook step).
- [ ] Every API-touching task requires the change in **BOTH** backends plus an updated/added `contracts/` parity test and clean OpenAPI diff.
- [ ] Every DB schema change requires BOTH an Alembic migration AND TypeORM entity updates.
- [ ] Money (Decimal/string) and date/datetime (ISO) consistency is asserted where data crosses Python<->TS.
- [ ] Interfaces mentioned in the checklist (routes, schemas, error bodies) have corresponding Q&A about schemas/errors AND parity.
- [ ] At least one question per phase addresses **failure mode** or **degraded behavior**.
- [ ] Coverage and over-mocking were considered for every phase that adds code (both backends + frontend).
- [ ] No real financial data appears in `docs/qa.md` or any test/example.
- [ ] `docs/qa.md` is self-contained enough for a future agent to re-apply or re-check decisions.
