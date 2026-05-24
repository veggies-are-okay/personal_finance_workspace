# Devils Advocate - Reference

## Why This Skill Exists

Vibe-coded and AI-assisted apps often fail in production due to **vague requirements**, **unspecified edge cases**, **missing error handling**, **inconsistent data contracts**, **integration gaps**, **untestable structure**, and **mock-heavy tests that do not catch regressions**. Agent checklists compound the problem when they lack **specific, measurable acceptance criteria**, **explicit verification steps**, **coverage thresholds**, **defined interfaces**, and **specified failure modes**.

This project adds a unique, high-value failure surface: a **dual-backend architecture** (FastAPI + NestJS) that must stay at **STRICT 1:1 parity** behind one frontend, sharing one Postgres. Any API, schema, validation, error-shape, status-code, or DB change that lands in one backend but not the other is **cross-backend parity drift** — a first-class failure mode here. This reference summarizes the failure modes and gives a question taxonomy for hardening `plans/agent_checklist.md` and `plans/first_pass_high_level_plan.md`.

---

## Common Problems in Vibe-Coded / AI-Assisted Apps

| Problem | What goes wrong | Hardening focus |
|--------|------------------|-----------------|
| **Vague requirements** | Code matches the prompt's happy path only; unstated assumptions cause production failures. | Explicit preconditions, postconditions, and negative cases per feature. |
| **Unspecified edge cases** | Nulls, empty lists, boundaries, timezones, negative/zero amounts, concurrency not handled. | Enumerate edge cases per domain (transactions, budgets, net-worth snapshots, debt/goal math, statement import). |
| **Missing error handling** | Errors treated as success; no validation, logging, or user-visible feedback. | Define error contracts and behavior (reject, 4xx with body, message). |
| **Inconsistent data contracts** | Same concept as string vs number, Decimal vs float, different date formats, mixed naming across Pydantic/TypeORM/DB/API. | Single normalized schema mirrored in both backends; document money + date conventions. |
| **Scope creep** | "Small" changes add dependencies/patterns never designed. | Explicit phase boundaries and "out of scope for MVP" callouts. |
| **Integration gaps** | Assumptions at boundaries (auth, ordering, idempotency) break. | Document each integration point: schema, errors, idempotency. |
| **Lack of testability** | Hard-coded deps, no injection, untestable flows. | Services behind interfaces; clear mock points; verification = named tests. |
| **Over-mocking** | Tests assert call counts or patched internals instead of real behavior. | Keep schemas/routes/validation/DB real; mock only true boundaries. |
| **Weak coverage discipline** | Tests pass but important paths are still untested. | Named coverage command and hard threshold in Verify steps (both backends + frontend). |
| **Cross-backend parity drift** | A route/schema/validation/error/status/migration change lands in one backend but not the other. | Every API or schema change is mirrored in BOTH backends and proven by `contracts/` parity tests + OpenAPI diff. |

---

## Specificity Gaps in Checklists and Task Lists

| Gap | Consequence | How to fix |
|-----|-------------|------------|
| **Ambiguous acceptance criteria** | Different interpretations; "done" doesn't match reality. | Binary, measurable criteria; map to specific tests. |
| **Missing verification steps** | No way to prove "implement X" actually works. | Pair each task with concrete Verify steps (test name, command, threshold, gate). |
| **Undefined interfaces** | Small changes cascade; unclear contracts. | Request/response schemas, error codes, status codes per boundary — defined once. |
| **Unspecified failure modes** | Only happy path tested; production fails on invalid/partial input. | List failure modes per operation and define behavior (reject, 4xx, message) in both backends. |
| **No parity gate** | Backends silently drift. | Each API/schema task names BOTH-backend implementation + `contracts/` parity test + OpenAPI diff in Verify. |

---

## Question Taxonomy (for generating TODOs)

Use these categories when turning the checklist and plan into a "massive list of questions." Each question should be answerable with code-level evidence (Context7, repo, or Perplexity).

### Acceptance criteria

- Is each "Verify" binary and measurable (not "works" or "correct")?
- Are edge and negative cases explicitly in scope (empty input, invalid token, missing env, zero/negative money, future dates)?
- Can each criterion be mapped to a test or runbook step?

### Verification

- Does every non-trivial task have a **Verify** that names how we check it (test file, `curl`, coverage threshold, gate command)?
- For Python work (from `backend-python/`), does Verify name `uv run ruff check . && uv run ruff format --check . && uv run pytest --cov=app --cov-report=term-missing:skip-covered --cov-branch --cov-fail-under=80`?
- For TS backend work (from `backend-ts/`), does Verify name `npm run lint && npm run format:check && npm run test:cov`?
- For frontend work (from `frontend/`), does Verify name `npm run lint && npm run test -- --coverage`?
- For API/schema work (from `contracts/`), does Verify name `npm run test:parity` and a clean OpenAPI diff?
- Is degraded-mode or failure behavior verified (test or runbook)?

### Interfaces

- **API:** OpenAPI defined once (canonical in `contracts/`); status codes and error body shape agreed and identical in both backends? FastAPI `/openapi.json` and `@nestjs/swagger` JSON match?
- **Schemas:** Pydantic v2 model and class-validator DTO express the SAME constraints (required, min/max, formats)?
- **Frontend–API:** Backend-neutral via `VITE_API_BASE_URL`; auth header, error parsing, loading/empty states defined?

### Failure modes

- Per operation: invalid payload, missing required field, wrong type, out-of-range money/date — what status + body in EACH backend, and do they match?
- DB down, migration not applied, unique-constraint violation — state and user message?
- Statement import: malformed file, duplicate import, parsed-sum != printed-total — behavior?

### Data contracts

- Normalized types for transactions, accounts, budgets, snapshots, goals/debts — defined once and used in both backends?
- Null vs omit vs default for optional fields — same in both?
- Money: Python `Decimal` <-> TS representation (string vs number) — one agreed wire format, consistent DB column type?
- Date/datetime: ISO format and timezone for all persisted and API fields, identical across backends?
- Enum values identical (same casing/spelling) in Pydantic and class-validator?

### Integration

- Auth: token handling, expiry, 401 handling — same contract on both backends and handled by the frontend?
- Idempotency: statement re-import idempotent; "create" operations safe to retry?
- Sequencing: migrations applied before app serves traffic?

### Testability

- Can services be tested without real financial data (synthetic fixtures only)?
- Are routes/validation/DB exercised for real, or are tests mostly asserting mocks/call counts?
- Is there a single place that defines "success" for each phase (tests that must pass, gates that must be green)?
- Do `contracts/` parity tests exist for each shared endpoint?

### Cross-backend parity (REQUIRED — at least one per API-touching task)

- (a) **Both backends:** Does this change land in BOTH the FastAPI route AND the NestJS controller/handler? Name both files.
- (b) **Parity tests:** Are `contracts/` parity tests added or updated (`npm run test:parity`), and is the canonical OpenAPI in `contracts/` updated?
- (c) **Error shape + status:** Does the error body shape and HTTP status code match? (Pydantic v2 default 422 vs NestJS `ValidationPipe` default 400 — reconciled to ONE agreed shape and status; verify via diff.)
- (d) **DB schema:** Is the schema change in BOTH the Alembic migration (canonical) AND the TypeORM entities (`synchronize:false`)? Do column types/nullability/defaults match the migration?
- (e) **Cross-language consistency:** Are money (Decimal/string) and date/datetime (ISO) formats consistent across Python and TS in request bodies, response bodies, and DB columns? Are enum values identical?

---

## Suggested Question IDs

Use a short prefix per phase/area so impact is traceable. Map these to the actual phases in `plans/agent_checklist.md`; example scheme:

- `P0-*` — Foundation/scaffold (repo layout, docker-compose, shared Postgres, env)
- `P1-*` — Data model + migrations (Alembic canonical schema, TypeORM entities mirror)
- `P2-*` — Core domain APIs (transactions, accounts, budgets) in BOTH backends
- `P3-*` — Net-worth/investment tracking + snapshots
- `P4-*` — Debt/goal planning logic
- `P5-*` — Statement ingestion (parsing, money, idempotent re-import)
- `P6-*` — Frontend (screens, API integration, states)
- `P7-*` — Testing, coverage, hardening
- `PAR-*` — Cross-backend parity (OpenAPI diff, `contracts/` parity tests, error/status/schema/migration alignment)
- `INF-*` — Cross-cutting (interfaces, env, file layout, docker networking)

Example: `P2-001`, `P5-002`, `PAR-001`, `INF-001`.

---

## Context7 usage

- **resolve-library-id:** `libraryName` = "FastAPI", "Pydantic", "SQLAlchemy", "Alembic", "pytest", "pytest-cov", "NestJS", "class-validator", "TypeORM", "Jest", "Supertest", "React", "Vite", "Vitest", "Tailwind", "PostgreSQL", and OpenAPI/Swagger tooling (`@nestjs/swagger`). Use `query` to describe the task (e.g. "request body validation and error response shape").
- **query-docs:** Use the returned `libraryId` and a specific question (e.g. "How does Pydantic v2 shape 422 validation errors?", "How does NestJS ValidationPipe shape 400 errors?", "How to emit OpenAPI JSON from @nestjs/swagger?").
- Prefer Context7 for code-level patterns; use Perplexity for product/process, openapi-diff tooling, or when no library match exists. No secrets in queries.

---

## docs/qa.md layout

Keep `docs/qa.md` in this shape so runs are comparable and traceable. No real financial data anywhere in this file.

```markdown
# Q&A — Devils Advocate Run (YYYY-MM-DD or run id)

## Devils Advocate Questions
(TODO-style list of all questions, with Q-ID and source; include PAR-* parity questions)

## Answers and justification
(For each Q-ID: Decision, Justification bullets, Checklist impact)

## Plan amendments (if any)
(Edits proposed or applied to first_pass_high_level_plan.md)
```
