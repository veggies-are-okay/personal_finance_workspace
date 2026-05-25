# P7.1 — Docker dual-frontend stack

## Summary

`docker compose up --build` runs the **whole stack** in the browser: Postgres, a one-shot Alembic `migrate`, **both** backends, and the **same** frontend image built twice — one per backend for side-by-side parity:

- **localhost:8501** → frontend → `backend-python` (FastAPI)
- **localhost:8502** → frontend → `backend-ts` (NestJS)

Each frontend is `nginx:alpine` serving the SPA and reverse-proxying `/api/` to its backend (same-origin → **no CORS**). INFRA-only plus one tiny FE fix; the API contract is untouched, so backend parity is unaffected.

## Changes (Large tier — by realm)

- **Backend images.** `backend-python/Dockerfile`: multi-stage uv (`uv sync --locked` deps layer → slim runtime with venv + `app/`/`alembic/`; uvicorn `0.0.0.0:8000`, non-root). `backend-ts/Dockerfile`: multi-stage node (`npm ci` + `nest build` → prod-only runtime, `node dist/main.js` on `:3000`). `.dockerignore` excludes venv/`node_modules`/tests/`.env`.
- **Frontend image + proxy.** `frontend/Dockerfile` builds the SPA with `VITE_API_BASE_URL=/api` (MSW off) → `nginx:alpine`. `nginx.conf.template` via built-in envsubst (`NGINX_ENVSUBST_FILTER=^BACKEND_`): SPA history-fallback + reverse-proxy `/api/` → `${BACKEND_UPSTREAM}`; trailing-slash `proxy_pass` strips the `/api` prefix. **One image, two instances.**
- **Compose.** `postgres` (kept; host publish → **5433**, internal `postgres:5432` unchanged) → `migrate` one-shot (`alembic upgrade head`, gated postgres healthy) → both backends (gated on migrate completed + postgres healthy, `/health` healthchecks, `DATABASE_URL` overridden to the `postgres` host, `env_file: .env`) → `frontend-python` (`8501:80`) + `frontend-ts` (`8502:80`). `pf_pgdata` kept. Backends not host-published (host :8000 often busy; reached via `/api`).
- **FE fix (no contract change).** `buildUrl` (`src/lib/api.ts`) resolves a **relative** base (`/api`) against `window.location.origin` so `new URL()` works under the proxy (absolute dev path unchanged); + test. Docs: both READMEs, `docs/STRUCTURE.md`, checklist `[x]`.

## Feature mapping

Delivers **"run the dual-backend stack for real"** — one command, the whole app in a browser, **visual parity** at 8501 (FastAPI) vs 8502 (NestJS) over the same Postgres.

## Happy-path verification

`docker compose build` + `up -d` succeeded end-to-end: `migrate` exited 0, both backends healthy, both frontends served. Proxied `GET /api/health` = `{"status":"ok"}` on **both** ports. Seeded synthetic accounts; Net Worth renders **identically** on both origins; Playwright confirmed each origin calls its own `/api` (8501→python, 8502→ts).

**8501 — frontend wired to backend-python (FastAPI):**

![python 8501](https://raw.githubusercontent.com/veggies-are-okay/personal_finance_workspace/114099ec749f79071cb9b4146e12aefb0bb865b0/pull_requests/evidence/p7-1-docker-dual-frontend/python-8501.png)

**8502 — frontend wired to backend-ts (NestJS):**

![ts 8502](https://raw.githubusercontent.com/veggies-are-okay/personal_finance_workspace/114099ec749f79071cb9b4146e12aefb0bb865b0/pull_requests/evidence/p7-1-docker-dual-frontend/ts-8502.png)

**Stack health (`docker compose ps` + proxied health):**

![compose status](https://raw.githubusercontent.com/veggies-are-okay/personal_finance_workspace/114099ec749f79071cb9b4146e12aefb0bb865b0/pull_requests/evidence/p7-1-docker-dual-frontend/compose-status.png)

Then `docker compose down` (volume kept) to leave the host clean.

## Test plan

- **Frontend gate** (`frontend/`): `npm run lint` clean; `npm run test -- --coverage` green (95% stmts, `api.ts` 100%); `npm run build` clean (the `/api` build).
- **Backend / parity gates:** unaffected — Docker/compose/nginx files + a FE-internal URL fix only; no route/schema/status/error change.

## Checklist

- [x] Full stack via one command; 8501→python, 8502→ts; migrate gates the backends.
- [x] Proxied `/api/health` = `{"status":"ok"}` on both; Net Worth renders identically.
- [x] No secrets committed (`.env` excluded); READMEs + `docs/STRUCTURE.md` + checklist updated.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
