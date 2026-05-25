# P3.2 — Precompute deterministic analytics + `paystubs` income table

## Summary

Adds the **income source** and the **Python-only precompute pipeline** that powers the `/api/v1/budget` view. Precompute runs once over `transactions` (+ `paystubs` income) and writes the budget aggregate tables; **both backends will only READ these tables — no categorization logic in TypeScript** (spec §5 / DA-9), which keeps FastAPI↔NestJS parity trivial. Type `BE`: the new `paystubs` table lands in both backends + the schema-parity harness; there is no HTTP endpoint, so `/health` parity is unchanged.

All committed tests/fixtures are **synthetic** — no real merchant/person names, balances, or transactions. Categorization rules are deliberately generic (common merchants).

## Changes (Large — > 10 files; by realm)

**Schema (schema-parity kept green — DA-8):** new `paystubs` income table — SQLAlchemy model (`app/models.py`), canonical Alembic migration `ba4cb087cce7`, mirrored TypeORM `PaystubEntity` (`synchronize:false`). Money `NUMERIC(14,2)`, period/pay dates `DATE`, unique `dedupe_key`. `EXPECTED_TABLES`/assertions updated in the Python, TS, and contracts schema-parity suites so the cross-backend snapshot stays byte-identical. `alembic upgrade head` clean; `alembic check` no drift.

**Ingestion + precompute (Python only, `backend-python/app/`):** `ingestion/income_loader.py` idempotently upserts pay stubs on `sha256(employer, pay_date, gross_pay, net_pay)` (mirrors P3.1 — DA-19). The `precompute/` package (`categorize` · `rates` · `recurring` · `pipeline`) does generic categorization + transfer/recurring detection, 50/30/20 buckets, and the two rates; `run_precompute` writes `budget_aggregates` + `budget_{bucket,category,monthly}_aggregates` + `recurring_charges`.

**Tests + docs:** golden-fixture + determinism + pure-logic + income-loader tests; both backend READMEs, `docs/STRUCTURE.md`, checklist P3.2 → `[x]`.

## Feature mapping

Feeds the **Budget screen** (`GET /api/v1/budget`, design §3). The precompute tables cover **every** field that endpoint serves (DA-23): `savings_rate`, `effective_tax_rate`, per-bucket `target/actual_pct/amount`, per-category `amount/bucket`, monthly `needs/wants`, `recurring[]`. Percentages numeric 0–100 (DA-22); money `Decimal` → `NUMERIC(14,2)`. P4.2's cross-backend identity test will assert both backends read these rows identically. **Determinism (DA-9):** first-match rules, `Decimal` money, and a replace-on-re-run write → identical tables across runs.

## Happy-path verification

Ad-hoc precompute over a synthetic `transactions` + `paystubs` fixture (rolled back, nothing persisted) prints the computed `savings_rate` / `effective_tax_rate`, the 50/30/20 bucket %s, categories, and detected recurring rows; run twice to show determinism — plus the 9 golden-fixture tests passing:

![P3.2 precompute golden-fixture proof](https://raw.githubusercontent.com/veggies-are-okay/personal_finance_workspace/0dcbc82550b406e539032361f5f30515148a5306/pull_requests/evidence/p3-2-precompute/proof.png)

`savings_rate=71.4`, `effective_tax_rate=24.0` (numeric 0–100); buckets needs/wants/savings = $300.00 / $65.00 / $7135.00; recurring Groceries + Subscriptions (monthly). Run #1 == run #2.

## Test plan (gate results)

- **Python** (`backend-python/`): `ruff check` + `ruff format --check` clean; `pytest --cov=app --cov-branch --cov-fail-under=80` → **109 passed, 99.70%**.
- **TS** (`backend-ts/`): `npm run lint` + `format:check` clean; `npm run test:cov` → **36 passed, ≥80%**.
- **Parity** (`contracts/`): `npm run test:parity` → **47 passed** (schema-parity incl. new `paystubs`; `/health` unchanged).
- **DB:** `docker compose up -d`; `alembic upgrade head` clean; `alembic check` → no drift; single head `ba4cb087cce7`.

## Checklist

- [x] `paystubs` table in Alembic + SQLAlchemy + mirrored TypeORM entity; schema-parity green (DA-8)
- [x] Idempotent income loader (dedupe-on-key — DA-19)
- [x] Python-only precompute → every `/budget` field (DA-23); percentages numeric 0–100 (DA-22)
- [x] Golden-fixture exact-value + determinism tests (DA-9); synthetic data only
- [x] All three gates + parity green; READMEs / STRUCTURE / checklist updated
