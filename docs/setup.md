# Local Setup

> CHANGELOG
> - 2026-05-24: Initial setup doc — Postgres bring-up via docker-compose. — P1.1.

How to bring up the shared Postgres that both backends (`backend-python/` and
`backend-ts/`) read and write. This is the only infrastructure dependency for
the P1+ phases.

## Prerequisites

- Docker (daemon running) — provides `docker compose`.
- `node` / `npm` and `uv` for the backends and data-prep tooling (not needed
  just to run Postgres).

## 1. Environment file

Copy the template and adjust if needed. `.env` is gitignored — never commit it
or any real secret.

```sh
cp .env.example .env
```

Relevant vars (defaults work out of the box):

- `POSTGRES_USER=pf`, `POSTGRES_PASSWORD=pf`, `POSTGRES_DB=personal_finance`
- `DATABASE_URL=postgresql://pf:pf@localhost:5432/personal_finance`

Use `localhost` in `DATABASE_URL` when a backend runs on the host; use the
service name `postgres` when the backend runs inside docker-compose.

## 2. Bring up Postgres

Validate the compose file first (optional), then start it detached:

```sh
docker compose config      # validate
docker compose up -d        # start pf_postgres (postgres:16)
```

## 3. Check health

The `postgres` service has a `pg_isready` healthcheck. Wait for it to report
`healthy`:

```sh
docker compose ps                                              # STATUS shows "(healthy)"
docker inspect --format '{{.State.Health.Status}}' pf_postgres # -> healthy
```

## 4. Connectivity checks

```sh
# In-container readiness probe:
docker compose exec -T postgres pg_isready -U pf -d personal_finance
# -> /var/run/postgresql:5432 - accepting connections

# Run a query through the container's psql:
docker compose exec -T postgres psql -U pf -d personal_finance -c 'select 1;'
# -> returns 1 row

# From the host (if a Postgres client is installed), connect with DATABASE_URL:
psql "postgresql://pf:pf@localhost:5432/personal_finance" -c 'select 1;'
```

The host port `5432` is published, so any host-side client or driver can
connect using `DATABASE_URL`.

## 5. Stop / reset

```sh
docker compose down      # stop and remove the container (data kept in the pf_pgdata volume)
docker compose down -v   # also remove the volume — wipes all DB data (fresh start)
```
