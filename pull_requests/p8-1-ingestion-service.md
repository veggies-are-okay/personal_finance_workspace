# P8.1 — Backend ingestion service (Python-only upload/extract/load)

## Summary

Starts the **file-upload onboarding** epic (P8): `POST /api/v1/ingest/{source}` (`transactions | income | holdings | accounts | loans`) lets the owner upload raw files that flow through the existing extractors → DB → precompute → dashboards.

Per the owner's decision, **ingestion is Python-owned and OUT of the 1:1 read-parity contract** — like Alembic owns migrations. The ingest endpoints exist in **FastAPI ONLY** (they need pdfplumber/PyYAML); NestJS implements none, and the parity harness ignores `/api/v1/ingest/*`. The six read dashboards stay at strict parity.

## Changes (large — by realm)

- **Containerized extraction (`app/ingestion/`):** moved the pure parsing logic into canonical `app/` modules — `extract_chase.py`, `extract_paystubs.py`, `normalize_ledger.py` — so the Docker image (copies only `app/`) can run them. `scripts/{extract_chase_statements,extract_paystubs,ledger}.py` are now **thin CLI wrappers** importing from `app` (root tests stay green). Added `pdfplumber` + `pyyaml` + `python-multipart`.
- **New loaders:** `holdings_loader` (E*TRADE CSV → `holdings`, derives weight), `accounts_loader` (`accounts.yaml` → `accounts`), `loans_loader` (flexible loan CSV → `loans`, header-variant tolerant) — all snapshot-replace — plus `income_loader.parse_paystubs_csv`.
- **Ingest API (`app/ingestion/router.py`):** multipart `UploadFile`. `transactions` detects each file (CSV header → amex/chase/checking/elan; `.pdf` → Chase) → normalize → `load_ledger` → precompute `12m`+`all`. `income` reads paystub PDF(s)/`paystubs.csv` → `load_paystubs` → precompute. `holdings`/`accounts`/`loans` snapshot-replace. Canonical **422** / **503**; 25 MiB cap; **file contents never logged**.
- **Parity carve-out (`contracts/`):** `isIngestPath()`/`INGEST_PATH_PREFIX` in `src/contract.ts`; `openapi.parity.test.ts` subset guard — the carve-out is the *only* allowed FastAPI divergence, and NestJS must expose none of the ingest paths. `/ingest/*` is NOT in `openapi.canonical.json`. Documented in `backend-parity.md`.
- **Docs:** P8 epic in `agent_checklist.md` (P8.1 `[x]`), `backend-python/README.md`, `contracts/README.md`, `docs/STRUCTURE.md`.

## Feature mapping

One upload per source turns raw files into a usable portal: a single `POST /api/v1/ingest/{source}` runs extract → normalize → idempotent load → precompute, so the Budget / Net Worth / Investments / Debt screens populate from the owner's own statements. (Frontend upload UI + nginx routing is P8.2, next PR.)

## Happy-path verification

Local uvicorn against a clean Postgres; synthetic CSVs uploaded; JSON summary + post-load row counts captured:

![P8.1 ingest proof](https://raw.githubusercontent.com/veggies-are-okay/personal_finance_workspace/5cfdd2fee6ae027c76af962910222d0266d32562/pull_requests/evidence/p8-1-ingestion-service/proof.png)

`transactions` → 3 rows (`detected_type: amex`), `holdings` → 2 rows, unknown source → canonical **422**; Postgres confirms `transactions=3`, `holdings=2`.

## Test plan (gate results)

- **Python** (`backend-python/`): ruff check + format clean; `pytest --cov=app` **271 passed, 90.8%** (≥80 gate).
- **Root** (`uv run pytest`): **56 passed** (Chase/paystub/ledger after the wrapper refactor).
- **TS** (`backend-ts/`): lint + format clean; `test:cov` **250 passed** (no TS change).
- **Parity** (`contracts/`): `npm run test:parity` **83 passed** — `/ingest/*` carve-out works, read-contract diff clean; OpenAPI lint clean.
- **Docker**: `docker compose build backend-python` succeeds; extractors importable in the image (pdfplumber 0.11.9).

## Checklist

- [x] Ingest endpoints in FastAPI only; canonical 422/503; no PII logged
- [x] Extractors containerizable under `app/`; `scripts/*` thin wrappers; root tests green
- [x] New loaders idempotent/snapshot; synthetic-fixture tests
- [x] Parity carve-out: `/ingest/*` ignored vs canonical; subset guard; NestJS exposes none; rule documented
- [x] All gates green (python/root/ts/parity); Docker build OK; happy-path screenshot
- [x] No real financial data; `load_local.py` and its outputs not committed
