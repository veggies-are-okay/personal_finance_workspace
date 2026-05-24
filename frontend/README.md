# frontend (React + Vite + Tailwind)

**Purpose:** the single, **backend-neutral** UI for the app. It renders the view endpoints (`/api/v1/budget`, `/networth`, `/investments`, `/debt`, `/goals`, `/transactions`) and the Settings/Connections screen, and works against **either** backend by pointing `VITE_API_BASE_URL` at FastAPI (`:8000`) or NestJS (`:3000`). In production it runs as **two docker instances** — `8501` → python, `8502` → ts — for side-by-side parity.

## Run & test (from `frontend/`)

```bash
npm install
npm run dev                       # Vite dev server on :5173
npm run build                     # production build
npm run lint                      # eslint (flat config)
npm run test -- --coverage        # Vitest + RTL, coverage floor ≥ 80%
```

Quality gate: `npm run lint && npm run test -- --coverage && npm run build`.

## Key files

| Path | Role |
|------|------|
| `src/lib/api.ts` | The **single network boundary**: reads `VITE_API_BASE_URL`; all fetches go through here. |
| `src/features/` | Feature modules (one per screen); `features/connections/` is the **only** place that touches Plaid Link. |
| `src/test/setup.ts` | jest-dom + RTL cleanup; tests mock only the `api` boundary. |
| `vite.config.ts` | Vite + Tailwind v4 plugin + Vitest (jsdom, v8 coverage). |

## How it fits

Loosely coupled: the frontend codes **only** to the canonical contract (`contracts/openapi.canonical.json`) and is developed/tested against a **Prism mock** of it — no backend needs to be running. It never knows whether a source's data came from a CSV or a live API. See `docs/2026-05-24-data-connectors-and-frontend-design.md` and the wireframes in `pencil/website_wire.pen`.

**Gotchas:** wire colors/money come from the API as **decimal strings**; percentages are **numbers (0–100)** (contract Appendix A). Cover loading / empty / error states per screen.
