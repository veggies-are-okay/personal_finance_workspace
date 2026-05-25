# frontend (React + Vite + Tailwind)

**Purpose:** the single, **backend-neutral** UI for the app. It renders the view endpoints (`/api/v1/budget`, `/networth`, `/investments`, `/debt`, `/goals`, `/transactions`) and the Settings/Connections screen, and works against **either** backend by pointing `VITE_API_BASE_URL` at FastAPI (`:8000`) or NestJS (`:3000`). In production it runs as **two docker instances** — `8501` → python, `8502` → ts — for side-by-side parity.

## Run & test (from `frontend/`)

```bash
npm install
npm run dev                       # Vite dev server on :5173 (uses the MSW mock by default)
npm run build                     # production build
npm run lint                      # eslint (flat config)
npm run test -- --coverage        # Vitest + RTL, coverage floor ≥ 80%
```

Quality gate: `npm run lint && npm run test -- --coverage && npm run build`.

### Mock vs. live backend (`VITE_API_BASE_URL`)

The app talks to exactly one network boundary (`src/lib/api.ts`). Its base URL is
`VITE_API_BASE_URL` (default `http://localhost:8000`).

- **Mock (default in dev):** when `VITE_API_BASE_URL` is **unset**, `npm run dev`
  starts an **MSW** worker (`src/mocks/`) that serves synthetic fixtures derived
  from `contracts/openapi.canonical.json`, so every screen renders with **no
  backend running**. Force it on with `VITE_USE_MOCK=true`.
- **Live backend:** set `VITE_API_BASE_URL` to a running backend and the same
  client hits it instead (mock off). The backend's CORS allows `:5173`, so run the
  dev server there:

  ```bash
  VITE_API_BASE_URL=http://localhost:8010 npm run dev -- --port 5173
  ```

Mock scenario control (mock only): append `?scenario=empty` (DA-20 not-connected
empty state) or `?scenario=error` (canonical 503) to any in-app fetch URL via the
handlers — used by the tests to drive each state.

## Key files

| Path | Role |
|------|------|
| `src/lib/api.ts` | The **single network boundary**: reads `VITE_API_BASE_URL`; all fetches go through here. |
| `src/lib/types.ts` | Wire types mirroring the canonical contract (Appendix A). |
| `src/lib/useApi.ts` | The shared async state machine: `loading` / `success` / `error` / `not_connected`. |
| `src/lib/format.ts` | Money-string + percentage-number display helpers. |
| `src/lib/theme.tsx` · `themeContext.ts` | Light/dark theme provider + `useTheme` hook (class strategy). |
| `src/mocks/` | MSW handlers + synthetic fixtures (derived from the contract) + browser/Node setup. |
| `src/components/` | Shared UI: `AppLayout`, `Sidebar`, `ScreenState`, `StatCard`, `MeterRow`, `BarChart`, `DataTable`, `Card`, `Badge`, `InsightCallout`, `PageHeader`. |
| `src/features/` | One module per screen: `story`, `budget`, `networth`, `investments`, `debt`, `goals` (`connections` is P5.2). |
| `src/test/setup.ts` | jest-dom + RTL cleanup; boots the MSW Node server + localStorage/matchMedia polyfills. |
| `vite.config.ts` | Vite + Tailwind v4 plugin + Vitest (jsdom, v8 coverage). |
| `public/mockServiceWorker.js` | MSW service worker (vendored by `msw init`; required for the dev mock). |

## How it fits

Loosely coupled: the frontend codes **only** to the canonical contract (`contracts/openapi.canonical.json`) and is developed/tested against an **MSW mock** of it — no backend needs to be running. It never knows whether a source's data came from a CSV or a live API. See `docs/2026-05-24-data-connectors-and-frontend-design.md` and the wireframes in `pencil/website_wire.pen`. (The design spec calls for a Prism mock; we use MSW instead — in-process, zero extra services, the same handlers power both the dev worker and the Vitest suite.)

**Gotchas:** wire colors/money come from the API as **decimal strings**; percentages are **numbers (0–100)** (contract Appendix A). Cover loading / empty / error states per screen.
