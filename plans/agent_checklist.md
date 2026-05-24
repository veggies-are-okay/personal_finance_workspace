# Agent Checklist — Personal Finance App

> CHANGELOG
> - 2026-05-24: Initial checklist. Phases P0–P9 for the dual-backend parity build. — Foundation pass.

**Single source of truth for tasks.** Work top-to-bottom by subsection (one `###` block = one branch). Mark `- [x]` only when the **Verify** step passes. For blocked/skipped tasks add `> BLOCKED:` / `> SKIPPED:` below the checkbox. Every API/behavior change lands in **both** backends + `contracts/` in the same branch (`.claude/rules/backend-parity.md`). Quality gates and ≥80% coverage are mandatory before merge.

---

## P0 — Foundations

### P0.1 — Repo scaffold, rules & skills
- [x] Monorepo skeleton (`frontend/`, `backend-python/`, `backend-ts/`, `contracts/`, `scripts/`, `config/`, `plans/`, `pull_requests/`).
- [x] `.gitignore` excludes real financial data; `git check-ignore` confirms.
- [x] Rule library in `.claude/rules/` and skill library in `.claude/skills/`.
- [x] `CLAUDE.md`, `docs/STRUCTURE.md`, `.env.example`, `docker-compose.yml`, `config/accounts.example.yaml`.
  - *Verify:* files exist; `CLAUDE.md` describes the parity architecture.

### P0.2 — Statement ingestion (Chase PDFs)
- [x] `scripts/extract_chase_statements.py` parses Chase PDF statements to a normalized CSV.
  - *Verify:* `uv run pytest tests/test_extract_chase_statements.py` passes (parsed purchases == printed summary total).

### P0.3 — Ingestion: remaining sources
- [x] Normalizers for `amex.csv`, `checking.csv`, `elan_credit_card.csv` onto the canonical signed-amount ledger schema (`.claude/rules/api-data-pulls.md`).
  - *Verify:* unit tests on **synthetic** fixtures assert correct sign normalization per source; a combined loader merges all sources into one ledger.

---

## P1 — Infra & scaffolds

### P1.1 — Postgres
- [x] `docker compose up -d` brings up Postgres; connection works from host.
  - *Verify:* `docker compose ps` healthy; `psql`/driver connects with `DATABASE_URL`.

### P1.2 — backend-python scaffold (FastAPI)
- [ ] `app/main.py` FastAPI app, settings via pydantic-settings, `/health` endpoint, Alembic initialized.
  - *Verify:* `uv run uvicorn app.main:app` serves `GET /health` → 200; quality gate (ruff+format+pytest ≥80%) passes.

### P1.3 — backend-ts scaffold (NestJS)
- [ ] Nest app, `@nestjs/config`, global `ValidationPipe`, `@nestjs/swagger`, `GET /health` matching FastAPI.
  - *Verify:* `npm run start:dev` serves `GET /health` → 200 identical shape; `npm run lint && npm run test:cov` (≥80%) passes.

### P1.4 — Parity harness
- [ ] `contracts/` project: canonical OpenAPI doc + parity test runner that hits both backends; `npm run test:parity`.
  - *Verify:* `/health` parity test passes against both; OpenAPI diff clean.

### P1.5 — frontend scaffold
- [ ] Vite + React + Tailwind app; API client reads `VITE_API_BASE_URL`; renders backend `/health`.
  - *Verify:* `npm run dev` loads; `npm run lint && npm run test -- --coverage` (≥80%) passes.

---

## P2 — Data model
### P2.1 — Schema: accounts, transactions, categories, budgets, loans, goals
- [ ] Alembic migration defines the schema (canonical); TypeORM entities mirror it (`synchronize:false`).
  - *Verify:* `alembic upgrade head` applies; TypeORM connects to the same schema; schema-parity check passes.

## P3 — Ingestion → DB
### P3.1 — Load normalized ledger into Postgres (idempotent)
- [ ] Loader writes the normalized ledger to `transactions`; re-import dedupes.
  - *Verify:* loading twice yields no duplicates; counts match the source on synthetic fixtures.

## P4 — Transactions API (both backends + parity)
### P4.1 — List/search/filter transactions
- [ ] Implemented in FastAPI and NestJS; `contracts/` parity test for list/filter/pagination.
  - *Verify:* all three gates + parity pass.
### P4.2 — Categorize transactions
- [ ] Rule-based categorization endpoint in both backends.
  - *Verify:* gates + parity pass.

## P5 — Budgeting API (both + parity)
### P5.1 — Budgets vs. actuals
- [ ] Set per-category budgets; report actual vs. budget. Both backends + parity.
  - *Verify:* gates + parity pass.

## P6 — Net worth API (both + parity)
### P6.1 — Accounts & net worth over time
- [ ] Account balances, net worth snapshots. Both backends + parity.
  - *Verify:* gates + parity pass.

## P7 — Planning API (both + parity)
### P7.1 — Loan tranches & payoff strategies
- [ ] Model tranches; compute payoff strategies (avalanche/min). Both backends + parity.
  - *Verify:* gates + parity pass.
### P7.2 — Goals (e.g. down payment)
- [ ] Goal tracking toward target/date. Both backends + parity.
  - *Verify:* gates + parity pass.

## P8 — Frontend
### P8.1 — Dashboard + Transactions
- [ ] Overview + transactions screen against the API.
  - *Verify:* frontend gate passes; manual/Playwright check.
### P8.2 — Budget, Net Worth, Planning screens
- [ ] Remaining screens.
  - *Verify:* frontend gate passes.

## P9 — Parity harness & hardening
### P9.1 — OpenAPI diff in CI + contract coverage
- [ ] Automated OpenAPI diff; parity tests cover all endpoints incl. error cases.
  - *Verify:* parity gate covers every endpoint; diff clean.
