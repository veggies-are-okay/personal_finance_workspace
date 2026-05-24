# P1.1 — Postgres bring-up

**Branch:** `2026-05-24-INFRA/p1-1-postgres`
**Base:** `main`
**Date:** 2026-05-24

## Summary

Infrastructure-only subsection: verify the shared Postgres (`pf_postgres`,
`postgres:16`) comes up via `docker compose up -d` and is connectable, and
document the bring-up. No application code, no API/parity work. The compose
file and `.env.example` already existed; this branch verifies them and adds a
committed setup doc. Postgres is left running for P1.2–P1.4.

## Changes

- **`docs/setup.md`** (new) — prerequisites, `cp .env.example .env`,
  `docker compose up -d`, health check, connectivity checks, and
  `docker compose down` / `down -v` to stop/reset. No secrets or real data.
- **`plans/agent_checklist.md`** — P1.1 checked off.
- **`docs/STRUCTURE.md`** — dated CHANGELOG line; `docs/` entry now lists
  `setup.md`.
- A local `.env` was created from `.env.example` so the documented
  `DATABASE_URL` works. It is **gitignored and not committed**.

## Test plan

Commands (repo root) and their actual output:

```
$ docker compose config        # validated OK (postgres:16, db personal_finance, 5432:5432)

$ docker compose up -d
 Container pf_postgres  Started

$ docker compose ps
NAME          IMAGE         SERVICE    STATUS                    PORTS
pf_postgres   postgres:16   postgres   Up (healthy)              0.0.0.0:5432->5432/tcp

$ docker inspect --format '{{.State.Health.Status}}' pf_postgres
healthy

$ docker compose exec -T postgres pg_isready -U pf -d personal_finance
/var/run/postgresql:5432 - accepting connections

$ docker compose exec -T postgres psql -U pf -d personal_finance -c 'select 1;'
 ?column?
----------
        1
(1 row)
```

Health was polled in a bounded loop on `.State.Health.Status` (no blocking
foreground sleep). A host-side `psql`/psycopg connect was attempted but no host
Postgres client is installed; per the task the in-container `psql` check is
sufficient, and host port `5432` is published for any host client/driver using
`DATABASE_URL`.

## Checklist

- [x] `docker compose config` validates
- [x] `docker compose ps` / `docker inspect` show `healthy`
- [x] `pg_isready` accepting connections
- [x] `select 1;` returns 1 row via container `psql`
- [x] Postgres left running for subsequent subsections
- [x] No `.env`, secrets, or real financial data committed
