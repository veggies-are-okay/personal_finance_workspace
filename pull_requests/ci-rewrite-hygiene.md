# PR: CI rewrite + repo hygiene (P2.1)

**Branch:** `2026-05-24-DEPLOY/ci-rewrite-hygiene`
**Base:** `main`
**Type:** DEPLOY (infra/CI only — no API/behavior change, so no parity code change required)
**Date:** 2026-05-24

## Summary

Replaces the Python-only, path-mismatched `ci.yml` (which used the alpha `ty` type checker and ran `uvicorn app.main:app` / `pytest test/unit` from the repo root) with **four independent jobs**, each pinned to the correct working directory. Adds a Postgres 16 service to the DB-touching jobs and a guarded `alembic upgrade head`. Removes a stray directory and file, and rounds out `.env.example` with the data-connector secret placeholders (DA-15/16/17/26).

## Changes

- **`.github/workflows/ci.yml` rewritten** into four jobs, triggers unchanged (push + PR to `main`):
  - `python-backend` (`working-directory: backend-python/`) — setup-uv @ Python 3.12; `uv sync`; guarded `alembic upgrade head`; Appendix B gate `ruff check && ruff format --check && pytest --cov=app … --cov-fail-under=80`. Note: runs from `backend-python/`, NOT the repo root (the root is the *ingestion* uv project).
  - `ts-backend` (`backend-ts/`) — Node 22; `npm ci`; `lint && format:check && test:cov`.
  - `frontend` (`frontend/`) — Node 22; `npm ci`; `lint && test -- --coverage && build`.
  - `parity` (`contracts/`) — uv + Node 22; syncs backend-python, installs/builds backend-ts, installs the contracts harness, then `npm run test:parity` (boots both backends). Postgres service provided.
  - **Postgres 16 service** (docker-compose defaults, `DATABASE_URL` env) on `python-backend` and `parity`. `alembic upgrade head` is **guarded** (`if ls alembic/versions/*.py`) so it no-ops until migrations exist. Alpha `ty` step removed.
- **Repo hygiene:** deleted stray `backend-ts/src 2/` (held only a `.gitkeep`) and `docs/Untitled`. Both were untracked, so nothing to commit for the deletions — gone from the working tree.
- **`.env.example`:** added server-side connector placeholders — `PLAID_CLIENT_ID`, `PLAID_SECRET`, `PLAID_ENV`, `RENTCAST_API_KEY`, `APP_ENCRYPTION_KEY`. `DATABASE_URL` was already present. Placeholder values only — no real secrets.
- **Checklist:** P2.1 marked `[x]` with a DONE note.

## Test plan

Each Appendix B gate run locally from its directory (Postgres up via `docker compose up -d`):

- [x] **python-backend** — `uv run ruff check . && uv run ruff format --check . && uv run pytest --cov=app … --cov-fail-under=80` → **PASS**, 13 tests, **100%** coverage. `alembic upgrade head` succeeds (no-op, empty `versions/`).
- [x] **ts-backend** — `npm run lint && npm run format:check && npm run test:cov` → **PASS**, 14 tests, **100%** coverage.
- [x] **frontend** — `npm run lint && npm run test -- --coverage && npm run build` → **PASS**, 8 tests, 100% stmts/lines/funcs, **81.25%** branch (≥80), build OK.
- [x] **parity** — `npm run test:parity` → **PASS**, 20 tests (boots both backends + structural OpenAPI diff).
- [x] `git check-ignore .env` → succeeds (`.env` ignored; `!.env.example` un-ignored).
- [x] `backend-ts/src 2/` and `docs/Untitled` gone.

## Branch protection (manual — GitHub repo SETTING, not YAML)

Branch protection cannot be toggled from workflow YAML. **Action required by a repo admin:** under Settings → Branches → `main`, enable "Require status checks to pass before merging" and require all four checks: **`python-backend`**, **`ts-backend`**, **`frontend`**, **`parity`**.

## Checklist

- [x] Four jobs, correct working dirs (backend job from `backend-python/`)
- [x] Postgres service + guarded `alembic upgrade head`
- [x] Alpha `ty` removed; triggers = push + PR to `main`
- [x] `.env.example` keys added; `.env` gitignored; no real secrets
- [x] Stray `src 2/` + `docs/Untitled` removed
- [x] All four gates GREEN locally; P2.1 marked `[x]`
- [ ] Repo admin enables branch protection requiring the 4 checks

🤖 Generated with [Claude Code](https://claude.com/claude-code)
