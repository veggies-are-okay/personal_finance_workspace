---
paths:
  - "backend-ts/**/*.ts"
---


# TypeScript / NestJS Conventions

`backend-ts/` is a **NestJS** backend that mirrors `backend-python/` (FastAPI) at strict 1:1 parity (see `.claude/rules/backend-parity.md`). NestJS was chosen because it maps cleanly onto FastAPI concepts, which makes the side-by-side comparison the point of this project:

| FastAPI (Python) | NestJS (TypeScript) |
|------------------|---------------------|
| Router / `APIRouter` | Module + Controller |
| Pydantic v2 model | DTO class + `class-validator` decorators |
| Dependency (`Depends`) | Provider + dependency injection |
| `response_model` | DTO + `@nestjs/swagger` `@ApiResponse` |
| `/openapi.json` | `@nestjs/swagger` document |
| SQLAlchemy 2.0 model | TypeORM entity |

## Environment & tooling

- **Package manager:** npm. Commands run from `backend-ts/`.
- **Install:** `npm install`. **Add dep:** `npm install <pkg>`. **Dev dep:** `npm install -D <pkg>`.
- **Run (dev):** `npm run start:dev`. **Build:** `npm run build`.
- **Lint/format:** ESLint + Prettier — `npm run lint`, `npm run format` (write) / `npm run format:check` (verify).

## Quality gate (from `backend-ts/`)

```bash
npm run lint && npm run format:check && npm run test:cov
```

- `test:cov` runs Jest with coverage; the floor is **≥ 80%** (mirrors the Python gate).
- Testing style: see `.claude/rules/testing_typescript.md` — meaningful behavior tests (Test.createTestingModule, Supertest e2e, real DTO validation), mock only true boundaries.
- Do not mark TS backend work done unless the gate passes with coverage ≥ 80%.

## Conventions

- **Strict TypeScript.** `strict: true` in `tsconfig.json`; no `any` without justification.
- **Validation:** every request body/query is a DTO with `class-validator` decorators; enable a global `ValidationPipe` (`whitelist`, `transform`). DTO rules must match the Python Pydantic model field-for-field.
- **OpenAPI:** annotate controllers/DTOs with `@nestjs/swagger` so the generated document matches the canonical contract in `contracts/`.
- **Persistence:** TypeORM with `synchronize: false`. Entities mirror the Alembic-owned schema; never auto-sync. Schema changes are `DB`-type branches that update the Alembic migration **and** the entity together.
- **Errors:** conform to the canonical error contract shared with FastAPI (see `backend-parity.md`) rather than NestJS defaults, so error bodies/status codes match.
- **Config:** `@nestjs/config`; read connection strings/ports from env (`.env`), never hard-code secrets.

## Parity reminder

Any change here that affects the API contract or behavior must be mirrored in `backend-python/` **in the same branch**, with `contracts/` parity tests updated and the parity gate green. See `.claude/rules/backend-parity.md`. Use **Context7** for current NestJS, class-validator, TypeORM, Jest, and Supertest docs before assuming APIs.
