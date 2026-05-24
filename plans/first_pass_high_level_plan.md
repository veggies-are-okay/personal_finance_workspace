# High-Level Plan — Personal Finance App

> CHANGELOG
> - 2026-05-24: Initial plan. Establishes the dual-backend (FastAPI + NestJS) parity architecture, the React/Vite/Tailwind frontend, shared Postgres, and the build phases. — Foundation pass.
> - 2026-05-24: Added the **data-connectors & frontend** program — backend-owned Plaid/RentCast adapters behind a stable source/view contract, a loosely-coupled 7-screen frontend, contract-first 3-wave execution. Live API integration moved from "non-goal" into scope (local-first, swappable adapters). See `docs/2026-05-24-data-connectors-and-frontend-design.md`. — Connectors pass.

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

## Build phases (see `plans/agent_checklist.md` for tasks, `plans/checklist_flow.md` for stages)

**P0–P1 (done):** repo skeleton, rules/skills, ingestion utilities, Postgres, both backend scaffolds, parity harness, frontend scaffold.

The data-connectors program runs in **3 waves** (contract-first, vertical slicing, one PR per track):

- **Wave 0 — Foundation (P2):** rewrite CI (4 gated jobs + Postgres + branch protection) + repo hygiene; author the canonical OpenAPI (view + source + connections endpoints) + a Prism mock; DB schema incl. encrypted Plaid Item store.
- **Wave 0.5 — Ingestion + precompute (P3):** load the normalized ledger; **precompute** categorization / 50-30-20 / recurring / aggregates in Python so both backends serve thin reads (keeps parity trivial).
- **Wave 1 — View endpoints + frontend (P4–P5):** six view endpoints (`/transactions`, `/budget`, `/networth`, `/investments`, `/debt`, `/goals`) in **both** backends + parity, served from precomputed tables; the 7 screens grouped into two FE tracks built against the mock, then wired.
- **Wave 2 — Live connectors (P6):** connections/token lifecycle + encrypted Item store; Plaid adapter (transactions/liabilities/investments/income) and RentCast adapter swapped in **behind the same endpoints** via the Settings Local↔API toggle.
- **Wave 3 — Hardening (P7):** docker dual-frontend (8501→python, 8502→ts), exhaustive parity/OpenAPI coverage, security review of token handling.

## In scope vs deferred / non-goals

- **Now in scope:** local-first **live API integration** via swappable backend adapters (Plaid-primary, RentCast), built/CI'd on Plaid Sandbox.
- **Deferred to its own spec:** the **LangGraph + Gemini Flash Lite analysis client** (AI insight cards).
- **Non-goals (MVP):** Plaid Production / hosting, multi-user, cloud deployment, mobile apps.
