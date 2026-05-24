# backend-ts (NestJS)

NestJS backend for the personal-finance app — the **parity twin** of
`backend-python/` (FastAPI). Both backends expose the same API and must behave
identically (see `.claude/rules/backend-parity.md`).

## Stack

- NestJS 11 (Express), TypeScript (strict)
- `@nestjs/config` — reads the gitignored repo-root `.env` (`DATABASE_URL`, `TS_API_PORT`)
- `@nestjs/swagger` — OpenAPI JSON served at **`/openapi.json`** (mirrors FastAPI), UI at `/docs`
- TypeORM (postgres, `synchronize: false` — Alembic owns the schema; entities arrive in P2.1)
- Jest + Supertest (via `@swc/jest`), ESLint + Prettier

## Endpoints

- `GET /health` → `200`, body exactly `{"status":"ok"}`, `content-type: application/json`.
  DB-independent and byte-identical to FastAPI's `/health`.

## Commands (run from `backend-ts/`)

```bash
npm install
npm run start:dev      # watch mode; serves on TS_API_PORT (default 3000)
npm run build          # tsc build → dist/
npm run lint           # eslint
npm run format:check   # prettier --check
npm run test:cov       # jest + coverage (global floor ≥ 80%)
npm run test:e2e       # Supertest e2e (boots without a live DB)
```

## Quality gate

```bash
npm run lint && npm run format:check && npm run test:cov
```

Coverage floor is **≥ 80%** global (statements/branches/functions/lines),
mirroring the Python gate.
