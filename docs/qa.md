# QA — Devils Advocate

> Run: 2026-05-24 · Target: `plans/agent_checklist.md` (Connectors pass) + `docs/2026-05-24-data-connectors-and-frontend-design.md`.
> Decisions made autonomously and grounded via Perplexity (FastAPI↔NestJS parity pitfalls; Plaid testing/security). No real financial data appears here. Where a decision implies a checklist edit, see **Checklist impact**; those edits are applied in `plans/agent_checklist.md`.

## Devils Advocate Questions

- [x] **DA-1** (P2.2 / Parity): Is there ONE canonical error envelope, and are FastAPI's default 422 and NestJS `ValidationPipe`'s default 400 both forced to it?
- [x] **DA-2** (P2.2 / Data contract): Is money pinned to a single wire representation (Decimal-string vs minor-units) identically in both backends + DB?
- [x] **DA-3** (P2.2 / Data contract): Are dates/datetimes pinned to ISO-8601 UTC `Z`, naive-datetime policy defined?
- [x] **DA-4** (P4.1 / Interface): Is pagination one convention (params + response envelope) mirrored in both backends?
- [x] **DA-5** (P2.2 / Data contract): Are enums string-valued with identical values across Python/TS (categories, buckets, loan priority, source mode, item status)?
- [x] **DA-6** (P2.2 / Data contract): Is null-vs-absent policy defined and enforced identically?
- [x] **DA-7** (P2.2 / Parity): How is OpenAPI drift detected between FastAPI `/openapi.json` and `@nestjs/swagger` — what's the source of truth and the diff mechanism?
- [x] **DA-8** (P2.3 / Parity): Does every column (incl. encrypted token, money, dates, enums) match between the Alembic head and TypeORM entities, and is there a schema-parity check?
- [x] **DA-9** (P3.2 / Over-mocking/Parity): Is precompute deterministic with golden fixtures, and do BOTH backends return identical view responses for the same DB state (no recompute drift)?
- [x] **DA-10** (P6.2 / Over-mocking): Do Plaid tests assert response→schema MAPPING (recorded Sandbox fixtures) rather than "we called the SDK"?
- [x] **DA-11** (P6.1 / Security/Failure): Is the Plaid webhook verified (JWT/JWKS) and hardened against spoofing?
- [x] **DA-12** (P2.3/P6.1 / Security): Is `access_token` encrypted at rest with a key kept out of the DB?
- [x] **DA-13** (P6.2 / Failure): Are Item error states (`ITEM_LOGIN_REQUIRED`, pending expiration/disconnect, invalid token) handled and surfaced to the Settings UI (update mode)?
- [x] **DA-14** (P6.1 / Security): Is token/PII logging prohibited with redaction?
- [x] **DA-15** (All API phases / Verification): Does every Verify name the EXACT gate commands rather than "gates + parity pass"?
- [x] **DA-16** (All code phases / Coverage): Is ≥80% enforced (not aspirational) for both backends and the frontend, with named commands?
- [x] **DA-17** (P2.1 / Verification): Does CI run each job from the correct working directory (two uv projects!), spin Postgres, and is branch protection's GitHub-side nature acknowledged?
- [x] **DA-18** (P4.* / Failure): When the DB is down or a migration isn't applied, do both backends return the SAME status + canonical error body?
- [x] **DA-19** (P3.1 / Integration): What is the idempotency/dedupe key for transaction re-import?
- [x] **DA-20** (P6.4 / Failure): When a source is in API mode but not connected (no Item), what does `/sources/*` and the view endpoint return — identically in both backends?
- [x] **DA-21** (P5.* / Over-mocking): Does the FE mock derive from the canonical OpenAPI (so it can't drift), and is there a real-backend wiring smoke test?
- [x] **DA-22** (P2.2/P3.2 / Data contract): Are percentages and ratios pinned (number 0–100, fixed dp) distinct from money (decimal string)?
- [x] **DA-23** (P2.3/P4.2 / Coverage): Does the `budget_aggregates` table shape actually cover every field `/budget` serves?
- [x] **DA-24** (P6.2 / Scope): E*TRADE coverage via Plaid Investments is unverified — is this a decision point, not a silent blocker?
- [x] **DA-25** (Stage 4 / Integration): Do parallel endpoint branches avoid editing the frozen OpenAPI (conflict risk)?
- [x] **DA-26** (All / Privacy): Are secrets gitignored with an `.env.example`, and absent from tests/qa/MCP?

---

### DA-1: Canonical error envelope
- **Decision:** Yes — define ONE envelope; both backends conform; **422 for request validation** (keep FastAPI's default status as canonical; make NestJS use 422), error/404/409 use the same body.
- **Justification:**
  - FastAPI default 422 `{"detail":[{loc,msg,type}]}` vs NestJS `ValidationPipe` default 400 `{statusCode,message[],error}` — divergent status AND shape (grounded).
  - Canonical body: `{"error":{"code","message","details":[{"field","location","message","code"}]}}`. FastAPI: override `RequestValidationError` handler. NestJS: `ValidationPipe({ exceptionFactory })` returning the same body with **HTTP 422** (override the default 400) so status matches too.
  - Document the envelope as a reusable `Error` schema in the canonical OpenAPI; parity test asserts identical status+body for a representative bad request.
- **Checklist impact:** P2.2 — add canonical `Error` schema + status table to the contract; new **Appendix A**. P4.* — Verify must include an invalid-payload parity test (same 422 + body).

### DA-2: Money on the wire
- **Decision:** **Decimal string** (e.g. `"123.45"`), not float, not minor-units.
- **Justification:**
  - JS `number` is IEEE-754 (lossy); Python `Decimal` isn't JSON-native. A string is exact and identical across both (grounded).
  - FastAPI: `Decimal` fields + serializer to `format(v,'f')`. NestJS: DTO money fields are `string` (regex `^-?\d+\.\d{2}$`), `decimal.js` internally. DB money columns `NUMERIC(14,2)`.
  - Percentages are NOT money — see DA-22.
- **Checklist impact:** P2.2 Appendix A (money = decimal string). P2.3 — money columns `NUMERIC`. P4.* parity tests assert string form.

### DA-3: Dates/datetimes
- **Decision:** ISO-8601; **datetimes are UTC with `Z`**; dates are `YYYY-MM-DD`. Reject naive datetimes on input (or assume UTC) — documented.
- **Justification:** `2026-05-24T10:00:00Z` vs `+00:00` differ as strings; normalize to `Z` on both. FastAPI `field_serializer` → `.astimezone(utc).isoformat().replace('+00:00','Z')`; NestJS `Date.toISOString()`. DB `timestamptz`.
- **Checklist impact:** P2.2 Appendix A (date/datetime). P2.3 — datetime columns `timestamptz`.

### DA-4: Pagination
- **Decision:** **offset/limit**, response is an object (never a bare array): `{ "data":[…], "pagination":{ "limit","offset","total" } }`. Defaults `limit=50` (max 200), `offset=0`.
- **Justification:** Avoids 0- vs 1-based page drift; object envelope is extensible; both define a shared `Paginated<T>` shape (grounded). Only `/transactions` paginates in v1.
- **Checklist impact:** P2.2 Appendix A (pagination). P4.1 — Verify includes pagination parity + out-of-range (`offset` past end → empty `data`, `total` correct).

### DA-5: Enums
- **Decision:** Yes — string enums, lower_snake, identical values both sides. Pin: `bucket ∈ {needs,wants,savings}`, `source ∈ {transactions,income,holdings,loans,listings}`, `source_mode ∈ {local,api}`, `item_status ∈ {connected,needs_reauth,error,disconnected}`, `loan_priority ∈ {pay_first,then,minimums}`, `payoff_strategy ∈ {avalanche,minimums}`.
- **Justification:** Python `str, Enum` value (not `.name`) ↔ TS string enum; class-validator `@IsEnum`. Divergent casing/numeric enums are a classic drift (grounded).
- **Checklist impact:** P2.2 Appendix A (enum registry). Parity tests assert exact strings.

### DA-6: null vs absent
- **Decision:** **Responses omit absent optional fields** (do not emit `null`) unless `null` carries business meaning. Required fields always present.
- **Justification:** Pydantic `ConfigDict(exclude_none=True)` ↔ NestJS `class-transformer` dropping `undefined` (JSON.stringify drops it). Mismatched null/absent is a silent parity break (grounded).
- **Checklist impact:** P2.2 Appendix A (null policy). Parity tests compare exact key presence.

### DA-7: OpenAPI drift detection
- **Decision:** **Contract-first**: `contracts/openapi.canonical.json` is the single source of truth. CI diffs BOTH generated specs (FastAPI `/openapi.json`, NestJS `@nestjs/swagger`) against the canonical (structural, after normalization), and fails on divergence. Plus response-parity tests.
- **Justification:** Both frameworks are code-first and drift independently; the existing `contracts/` harness already normalizes + diffs for `/health`. Extend that. (Schemathesis/Dredd optional later.)
- **Checklist impact:** P2.2 — canonical doc authored first + per-endpoint structural-diff in the parity job; P7.2 — exhaustive coverage. DA-25 conflict-avoidance below.

### DA-8: DB schema parity
- **Decision:** Yes — Alembic is canonical; TypeORM entities mirror (`synchronize:false`); a schema-parity check compares the Alembic head to the entities, including column types for money (`NUMERIC`), datetime (`timestamptz`), enums (text + CHECK or PG enum), and the encrypted token column (`BYTEA`).
- **Justification:** TypeORM auto-sync must stay off so it can't alter the canonical schema; encrypted token is binary (ciphertext), not text. Aggregate tables (`budget_aggregates`) included.
- **Checklist impact:** P2.3 — Verify names the schema-parity check + enumerates column-type expectations.

### DA-9: Precompute determinism + cross-backend identity
- **Decision:** Yes — port the notebook logic into `scripts/` (productionized, not notebooks), with **golden-fixture tests** (synthetic input → asserted aggregates). Both backends serve the SAME `budget_aggregates` rows; a parity test asserts `/budget` is byte-identical across backends for a seeded DB.
- **Justification:** The categorization/recurring logic is large keyword rule sets — fragile without golden tests. Precompute-once removes the TS-reimplementation parity risk (spec §5). Over-mocking guard: view-endpoint tests hit the real route + real (seeded) DB, not patched services.
- **Checklist impact:** P3.2 — Verify requires golden fixtures + determinism; add a cross-backend `/budget` identity parity test (lives in P4.2).

### DA-10: Plaid over-mocking
- **Decision:** Yes (guarded) — adapter tests inject a fake Plaid client returning **recorded Sandbox fixtures**, and assert the **mapping into our source schema + DB side effects**, never `expect(plaid.x).toHaveBeenCalled()` as the sole assertion.
- **Justification:** Grounded "good vs bad" example: assert stored Item + mapped fields, not that the SDK was called. Fixtures are Sandbox (fake) → safe to commit; regenerate periodically.
- **Checklist impact:** P6.2 — Verify: mapping assertions on recorded fixtures; CI hermetic (respx/nock); no network.

### DA-11: Webhook verification
- **Decision:** Yes — verify Plaid webhook **JWT** against Plaid's JWKS (`/webhook_verification_key/get`), validate body schema, rate-limit, HTTPS only; reject unverified with 401.
- **Justification:** The webhook endpoint is otherwise spoofable (grounded). Verify signature + issuer/exp before acting on `item_id`.
- **Checklist impact:** P6.1 — add webhook JWT verification + schema validation + rejection test to Verify.

### DA-12: Token encryption at rest
- **Decision:** Yes — `access_token` stored as **AES-256-GCM** ciphertext (`BYTEA`: iv‖tag‖ciphertext); key from env/secret-manager (`APP_ENCRYPTION_KEY`), never in the DB or repo; identical scheme in both backends so either can read.
- **Justification:** Plaid tokens are long-lived, sensitive, server-only (grounded). Both backends share one DB → must share the encryption scheme + key. Add a key-rotation note.
- **Checklist impact:** P2.3 — `plaid_items.access_token BYTEA` + scheme documented; P6.1 — encrypt on write/decrypt on read, key from env; round-trip test (no plaintext at rest).

### DA-13: Item error states
- **Decision:** Yes — on `ITEM_LOGIN_REQUIRED` / `PENDING_EXPIRATION` / `PENDING_DISCONNECT` / invalid token (API or webhook), set `item_status` accordingly, block fetches, and surface a **"Reconnect"** CTA in Settings that launches Link in **update mode**.
- **Justification:** Robust integrations must recover via update mode (grounded). The Settings screen already has per-source status; wire it to real states.
- **Checklist impact:** P6.2 — Verify includes an `ITEM_LOGIN_REQUIRED` fixture → status `needs_reauth` → Settings shows reconnect; P5.2 renders `needs_reauth`/`error` states.

### DA-14: No token/PII logging
- **Decision:** Yes — never log `access_token`/`item_id`/`account_id`/`client_id`/`secret`/PII; log only Plaid `request_id`, internal IDs, error codes; redaction at the logging layer; Plaid routes excluded from body-logging middleware.
- **Justification:** Grounded logging rules. Both backends apply identical redaction.
- **Checklist impact:** P6.1 — Verify: a log-scrub test asserts no token appears in logs; P7.3 security review covers it.

### DA-15: Exact gate commands
- **Decision:** Yes — replace every "gates + parity pass" with the literal commands.
- **Justification:** Ambiguous acceptance is the #1 vibe-coded-plan failure. Name: python (`uv run ruff check . && uv run ruff format --check . && uv run pytest --cov=app --cov-report=term-missing:skip-covered --cov-branch --cov-fail-under=80` from `backend-python/`), ts (`npm run lint && npm run format:check && npm run test:cov` from `backend-ts/`), frontend (`npm run lint && npm run test -- --coverage` from `frontend/`), parity (`npm run test:parity` + clean OpenAPI diff from `contracts/`).
- **Checklist impact:** Applied to P2.*–P7.* Verify bullets.

### DA-16: Coverage enforced
- **Decision:** Yes — Python `--cov-fail-under=80`; TS `test:cov` jest `coverageThreshold` global 80; frontend vitest v8 ≥80 (entry/config excluded, per existing scaffold). CI fails under threshold.
- **Justification:** Threshold must be enforced by the command, not a hope.
- **Checklist impact:** P2.1 — CI jobs run the threshold commands; each phase Verify names them (DA-15).

### DA-17: CI working dirs / Postgres / branch protection
- **Decision:** Partial-fix required. CI must: run python job from `backend-python/` (NOT repo root — there are TWO uv projects; root is the ingestion project), ts from `backend-ts/`, frontend from `frontend/`, parity from `contracts/`; provide a **Postgres service container** for jobs needing the DB; run Alembic migrate before backend/integration tests. **Branch protection is a GitHub repo setting** (not in the YAML) — document the required checks in `docs/STRUCTURE.md`/PR doc; CI's job is to expose the 4 checks.
- **Justification:** The current `ci.yml` runs `uvicorn app.main:app` + `pytest test/unit` from root — wrong project + nonexistent paths; uses alpha `ty`. Grounded: per-project working dirs.
- **Checklist impact:** P2.1 — Verify enumerates the 4 jobs, working dirs, Postgres service, migrate-before-test, and "branch protection configured to require all 4 (documented)".

### DA-18: DB down / migration not applied
- **Decision:** Yes — both backends return **503** with the canonical error body (`code:"SERVICE_UNAVAILABLE"`) on DB connectivity failure; a request needing an unmigrated table returns 503 (startup readiness check preferred). Parity test asserts identical behavior.
- **Justification:** Degraded behavior must match; an unhandled 500 with a stack differs across stacks. Add a readiness gate.
- **Checklist impact:** P4.* — add a DB-unavailable parity case; P7.2 covers degraded states.

### DA-19: Re-import idempotency key
- **Decision:** Dedupe on a deterministic natural key: `hash(account, date, signed_amount, normalized_description)` stored unique; re-import upserts.
- **Justification:** Statements have no stable IDs; this matches the existing ingestion's normalized fields. Synthetic-fixture test: load twice → no dupes, counts stable.
- **Checklist impact:** P3.1 — Verify names the dedupe key + double-load assertion.

### DA-20: Source in API mode but not connected
- **Decision:** `/sources/{x}` and the dependent view endpoint return **200 with empty `data` + a `source_status` of `not_connected`** (not an error) so screens render an empty/connect state; identical in both backends.
- **Justification:** Not-connected is a normal state, not a 4xx; the Settings/empty states depend on it. (Distinct from DB-down 503.)
- **Checklist impact:** P6.4 — Verify the not-connected parity behavior; P5.1/P5.2 render empty/connect states.

### DA-21: FE mock fidelity
- **Decision:** Yes — the Prism mock is generated FROM `openapi.canonical.json` (can't drift from contract); plus a **wiring smoke test** (Playwright against one real backend) at the end of P5 to catch contract-vs-reality gaps.
- **Justification:** A hand-written mock would drift; generating from the canonical doc binds FE tests to the same contract both backends must satisfy.
- **Checklist impact:** P5.1 — mock from canonical + a wired smoke run; P2.2 — mock script reads the canonical doc.

### DA-22: Percentages vs money
- **Decision:** Money = decimal string (DA-2). **Percentages/ratios = JSON number, 0–100, one decimal** (e.g. `26.0`); never strings. Document the distinction.
- **Justification:** Mixing `"26"`/`26`/`0.26` is a silent drift across backends and confuses the FE.
- **Checklist impact:** P2.2 Appendix A; P3.2 precompute emits numeric pct; parity tests check numeric form.

### DA-23: Aggregate table covers /budget
- **Decision:** Yes — `budget_aggregates` columns must cover every `/budget` field (savings_rate, effective_tax_rate, per-bucket target/actual/amount, per-category amount+bucket, monthly needs/wants, recurring rows). Recurring may be its own table.
- **Justification:** If precompute doesn't store a field the endpoint serves, a backend would have to compute it → reintroduces the parity risk.
- **Checklist impact:** P2.3 — aggregate columns enumerated to match the render map (spec §3); P4.2 reads only.

### DA-24: E*TRADE coverage
- **Decision:** Treat as a **decision point**: P6.2 runs `/institutions/search?products=investments` for E*TRADE/Morgan Stanley; if absent, open a follow-up for an E*TRADE-direct adapter (OAuth 1.0a, real account) rather than blocking the wave.
- **Justification:** Coverage isn't guaranteed (prior research); the adapter pattern lets holdings stay on CSV until resolved.
- **Checklist impact:** P6.2 — Verify records the coverage result + follow-up; holdings stays on CSV if uncovered.

### DA-25: Parallel branches & the frozen contract
- **Decision:** Stage-4 endpoint branches MUST NOT edit `openapi.canonical.json` (frozen in P2.2). Each adds only its own per-endpoint parity-test file + implementations; the canonical doc already contains all paths.
- **Justification:** Concurrent edits to one contract file = merge conflicts and the exact drift we're preventing. Contract-first removes the need to touch it.
- **Checklist impact:** P2.2 — author ALL paths up front; checklist_flow note already states this; add to P4 preamble.

### DA-26: Secrets & privacy
- **Decision:** Yes — `.env` gitignored; `.env.example` lists `PLAID_CLIENT_ID/SECRET/ENV`, `RENTCAST_API_KEY`, `APP_ENCRYPTION_KEY`, `DATABASE_URL` as placeholders; never in tests/qa/MCP; CI uses GitHub Secrets only for an optional nightly Sandbox job (PR CI is fully mocked).
- **Justification:** `.claude/rules/data-privacy.md` + grounded secret-management practice.
- **Checklist impact:** P2.1 — add `.env.example` keys + `.gitignore` check; P6.* read keys from env only.

---

## Plan amendments

- `first_pass_high_level_plan.md` already updated this pass (live-API integration moved into scope; analysis client deferred). No further amendment required; the **canonical contract conventions** (DA-1…DA-6, DA-22) are added as **Appendix A** in `plans/agent_checklist.md` so every track references one source.
- **Open follow-up (non-blocking):** E*TRADE-direct adapter pending the Plaid coverage check (DA-24).
