# High-Level Plan — Personal Finance App

> CHANGELOG
> - 2026-05-24: Initial plan. Establishes the dual-backend (FastAPI + NestJS) parity architecture, the React/Vite/Tailwind frontend, shared Postgres, and the build phases. — Foundation pass.

## Goal

A local-first, single-user personal finance app covering four capabilities:

1. **Transaction tracking** — ingest bank/credit statements (differing CSV + PDF formats), normalize into one signed-amount ledger, categorize, explore.
2. **Budgeting** — per-category monthly budgets vs. actuals.
3. **Net worth & investments** — account balances, brokerage/retirement, cash; net worth over time.
4. **Debt & goal planning** — student-loan tranches, payoff strategies, and the house down-payment goal.

## Architecture

One **React + Vite + Tailwind** frontend talks to **two backends kept at strict 1:1 parity** (`.claude/rules/backend-parity.md`):

- `backend-python/` — FastAPI + Pydantic v2, SQLAlchemy 2.0 + Alembic (canonical migrations).
- `backend-ts/` — NestJS + TypeORM + class-validator (mirrors the schema; `synchronize:false`).
- Shared **Postgres**. `contracts/` holds the canonical OpenAPI + cross-backend parity tests.

Building each feature twice (Python and TypeScript) is the point — it is how we learn TS backends by comparison with FastAPI.

## Data flow

Raw statements → `scripts/` ingestion (normalize per-source formats + sign conventions; validate against invariants) → normalized CSVs → loaded into Postgres → served by either backend → rendered by the frontend.

## Build phases (see `plans/agent_checklist.md` for tasks)

- **P0 — Foundations:** repo skeleton, rules, skills, ingestion utilities. *(in progress)*
- **P1 — Infra & scaffolds:** Postgres compose, both backend scaffolds, frontend scaffold, healthchecks.
- **P2 — Data model:** Alembic schema (accounts, transactions, categories, budgets, loans, goals) + mirrored TypeORM entities.
- **P3 — Ingestion → DB:** load normalized CSVs into Postgres; idempotent re-import.
- **P4 — Transactions API:** list/search/categorize endpoints in **both** backends + `contracts/` parity tests.
- **P5 — Budgeting API:** budgets vs. actuals, both backends + parity.
- **P6 — Net worth API:** accounts/balances/net-worth-over-time, both backends + parity.
- **P7 — Planning API:** loan tranches, payoff strategies, goals, both backends + parity.
- **P8 — Frontend:** dashboard, transactions, budget, net worth, planning screens.
- **P9 — Parity harness & hardening:** OpenAPI diff in CI, contract coverage, degraded/edge cases.

## Non-goals (MVP)

Multi-user, cloud deployment, live brokerage/bank API integrations (may come later as a spike), and mobile apps.
