# P1.3 — backend-ts scaffold (NestJS)

**Branch:** `2026-05-24-BE-TS/p1-3-backend-ts-scaffold` · **Base:** `main` · **Date:** 2026-05-24
**Type:** BE-TS (TypeScript backend only; mirrors the `/health` contract FastAPI defines)

## Summary

Scaffolds the NestJS backend under `backend-ts/` as the parity twin of the
FastAPI backend: `@nestjs/config` (repo-root `.env`), global `ValidationPipe`
(`whitelist` + `transform`), `@nestjs/swagger` serving OpenAPI JSON at
**`/openapi.json`** (same path as FastAPI), TypeORM with `synchronize: false`
and `entities: []` (schema is P2.1), and the canonical `GET /health`. `/health`
is DB-independent and boots without a live database. The parity harness
(`contracts/`) is the next subsection (P1.4) and is untouched here.

## Changes

- **`backend-ts/`** — NestJS 11 project config (TS strict, ESLint + Prettier,
  Jest, Supertest): `package.json`, `tsconfig*.json`, `nest-cli.json`,
  `eslint.config.mjs`, `.prettierrc`, `.gitignore`, project-specific `README.md`,
  `package-lock.json`.
- **`src/main.ts`** — global `ValidationPipe({ whitelist, transform })`, Swagger
  with `jsonDocumentUrl: 'openapi.json'` (UI at `/docs`), listens on
  `TS_API_PORT ?? 3000`. No global route prefix (root paths, like FastAPI).
- **`src/app.module.ts`** — `ConfigModule.forRoot` (global, repo-root `.env`),
  `TypeOrmModule.forRootAsync` (postgres, `synchronize: false`, `entities: []`,
  `retryAttempts: 0` so startup never blocks). `buildTypeOrmOptions(config)`
  extracted as a pure, unit-tested function.
- **`src/health/`** — `HealthModule`, `HealthController` (`@Get` + `@HttpCode(200)`
  + `@ApiOkResponse`), `HealthService` (`{ status: 'ok' }`), `HealthResponseDto`,
  with `*.spec.ts` units alongside.
- **`test/health.e2e-spec.ts`** — Supertest e2e: 200, body deep-equals
  `{ status: 'ok' }`, JSON content-type, serializes to exactly `{"status":"ok"}`.
  Overrides the TypeORM `DataSource` with an inert stub so it **boots without a live DB**.
- **Jest** — via `@swc/jest` (avoids TS's decorator-emit branch artifact);
  coverage from `src/**` excluding `main.ts`; global threshold **80%**.
- **`plans/agent_checklist.md`** + **`docs/STRUCTURE.md`** — P1.3 done; dated CHANGELOG + `backend-ts/` subtree.

## Test plan

From `backend-ts/` — gate green:

```
$ npm run lint            # eslint clean
$ npm run format:check    # all files use Prettier code style
$ npm run test:cov        # 14 passed; coverage 100% (floor 80%)
$ npm run build           # nest build (tsc) clean
$ npm run test:e2e        # 3 passed
```

DB-independence (e2e against an unreachable DB still passes):

```
$ DATABASE_URL="postgresql://nope:nope@127.0.0.1:1/x" npx jest health.e2e-spec   # 3 passed
```

Live server (`node dist/main.js`, port 3000):

```
$ curl -s localhost:3000/health        # {"status":"ok"} ; 200 ; Content-Type: application/json
$ curl -s localhost:3000/openapi.json  # openapi 3.0.0; paths["/health"] -> $ref HealthResponseDto
#   HealthResponseDto: properties.status.type=string, required:[status]
```

`/health` body byte-matches FastAPI's `{"status":"ok"}` (e2e asserts
`res.text === '{"status":"ok"}'`). All synthetic; no real data/secrets;
`.env`/`node_modules`/`dist`/`coverage` not committed; `contracts/` untouched (P1.4).

## Checklist

- [x] NestJS scaffolded in `backend-ts/` (replaced `src/.gitkeep`); `GET /health` → 200 `{"status":"ok"}`, typed DTO, in `/openapi.json`, no DB dep
- [x] Global `ValidationPipe`; `@nestjs/config` reads repo-root `.env`; Swagger JSON at `/openapi.json`
- [x] TypeORM `synchronize: false`, `entities: []`, `retryAttempts: 0`; app + e2e boot without a DB
- [x] Scripts `lint`/`format:check`/`test:cov`/`start:dev`/`build`; gate green, coverage 100% (≥80%)
- [x] Checklist + STRUCTURE.md updated; PR doc added; no secrets/real data; `node_modules`/`dist`/`coverage` uncommitted; `contracts/` untouched
