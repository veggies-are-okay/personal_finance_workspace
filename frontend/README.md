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

`VITE_API_BASE_URL` may be **absolute** (`http://localhost:8000`, dev pointing
straight at a backend) or **relative** (`/api`, the Docker same-origin model
below). `src/lib/api.ts` resolves a relative base against the document origin so
`new URL()` works either way.

Mock scenario control (mock only): append `?scenario=empty` (DA-20 not-connected
empty state) or `?scenario=error` (canonical 503) to any in-app fetch URL via the
handlers — used by the tests to drive each state.

### Docker: nginx SPA host + same-origin `/api` proxy (P7.1)

`Dockerfile` produces **one** image (reused by both `frontend-python` and
`frontend-ts` in the root `docker-compose.yml`). It is **backend-agnostic**:

- **Build time:** the SPA is built with `VITE_API_BASE_URL=/api`, so the app
  always calls **same-origin** `/api/*` (which also keeps the MSW mock off — it
  only starts when `VITE_API_BASE_URL` is unset). No CORS is involved.
- **Runtime:** the image is `nginx:alpine`. `nginx.conf.template` is processed by
  nginx's built-in `envsubst` at start (`NGINX_ENVSUBST_FILTER=^BACKEND_`, so only
  `${BACKEND_UPSTREAM}` is substituted and nginx's own `$host`/`$uri` survive). It
  (1) serves the SPA with history-fallback (`try_files … /index.html`) and
  (2) reverse-proxies `/api/` to `${BACKEND_UPSTREAM}`. Each compose instance sets
  a different upstream (`http://backend-python:8000` vs `http://backend-ts:3000`),
  so `:8501` is wired to FastAPI and `:8502` to NestJS.
- **Path mapping:** `proxy_pass …/` (trailing slash) strips the `/api/` prefix, so
  `/api/health` → backend `/health` and `/api/api/v1/transactions` → backend
  `/api/v1/transactions` (the api client prefixes the `/api` base onto paths that
  already include the backend's `/api/v1/...`).

### Settings / Data Sources + Plaid Link (P5.2)

The **Settings** screen (`/settings`, `src/features/connections/`) reads
`GET /api/v1/connections` and lists each source with its **Local↔API mode** and
`item_status`, rendering all four states (`connected` / `needs_reauth` / `error`
/ `not_connected`) with the right affordance — `needs_reauth`/`error` get a
**Reconnect** CTA (Plaid update mode), `not_connected` gets **Connect**.

- **Plaid is mocked in dev & tests.** `usePlaidConnect` is the *only* coupling to
  `react-plaid-link`; it runs link-token → open Link → exchange. In tests
  `usePlaidLink` is `vi.mock`-ed so **no real Plaid Link opens and no credentials
  are needed** (DATA PRIVACY). In dev the connections endpoints are served by the
  MSW mock (the backend connections endpoints are **P6.1**, not built yet).
- **The Local↔API toggle** (`ModeToggle`) POSTs to `/api/v1/connections/source-mode`
  — a **mock-only, frontend-side placeholder** (intentionally NOT in the canonical
  OpenAPI). Wiring the adapter swap end-to-end is **P6.4 (`BE`)**; until then the
  toggle just exercises the UI against the mock.
- **Pointing at a real backend later:** once P6.1 ships the real connections
  endpoints, set `VITE_API_BASE_URL` to the backend and the same `src/lib/api.ts`
  calls hit it (mock off). To open the *real* Plaid Link, provide a real
  `link_token` from the backend (Sandbox in CI; Trial locally) — no code change in
  the connections module is required.

### File-upload onboarding — drop your raw files (P8.2)

The Settings screen has a **per-source upload control** (`UploadControl`,
`src/features/connections/`) so the owner can drop their raw statements/exports
and have them flow through the backend ingest pipeline into the DB and on into
the dashboards. There is one control per **ingest source**:

| Source | `accept` | Multiple? | Powers |
|--------|----------|-----------|--------|
| `transactions` | `.csv,.pdf` | yes | Budget, spending, recurring |
| `income` | `.pdf,.csv` | yes | savings rate, effective tax rate |
| `holdings` | `.csv` | no | Investments allocation/concentration |
| `accounts` | `.yaml,.yml` | no | Net Worth cash balances (standalone card; not a Plaid source) |
| `loans` | `.csv` | no | Debt tranches + payoff |

Each control is a labelled file picker that doubles as a **drag-and-drop** target;
"Upload & ingest" → loading → **success** (per-file detected type + rows loaded,
`role="status"`) or **error** (the canonical message, `role="alert"`). On success
the screen invalidates its data (`useApi({ keepDataOnReload: true })` so the
success summary survives the background refetch instead of remounting away).

**Ingestion is Python-ONLY and always routes to the FastAPI backend.** The client
POSTs `multipart/form-data` (files under the `file` field; the browser sets the
boundary — we never set `Content-Type`) to `POST /api/v1/ingest/{source}`
(`ingestSource()` in `src/lib/api.ts`). In Docker this is a same-origin
`/api/api/v1/ingest/{source}` request, and `nginx.conf.template` has a
**more-specific** `location /api/api/v1/ingest/` (before the general `/api/`)
that proxies to `http://backend-python:8000` **regardless of which frontend
instance served the SPA** — so uploads from `:8502` (the NestJS-reads instance)
still hit FastAPI, because NestJS does not implement ingestion. The proxy also
sets `client_max_body_size 25m` for PDF statements.

## Key files

| Path | Role |
|------|------|
| `src/lib/api.ts` | The **single network boundary**: reads `VITE_API_BASE_URL` (absolute or relative `/api`); all fetches go through here. Includes `ingestSource()` (multipart upload). |
| `Dockerfile` · `nginx.conf.template` | Multi-stage build → nginx SPA host + same-origin `/api` reverse proxy (one image, two compose instances). Has a Python-only `/api/api/v1/ingest/` route + 25m body cap. |
| `src/features/connections/UploadControl.tsx` | Per-source file-upload control (drag-or-pick) that drives the Python-only ingest endpoint and renders loading/success/error. |
| `src/lib/types.ts` | Wire types mirroring the canonical contract (Appendix A). |
| `src/lib/useApi.ts` | The shared async state machine: `loading` / `success` / `error` / `not_connected`. |
| `src/lib/format.ts` | Money-string + percentage-number display helpers. |
| `src/lib/theme.tsx` · `themeContext.ts` | Light/dark theme provider + `useTheme` hook (class strategy). |
| `src/mocks/` | MSW handlers + synthetic fixtures (derived from the contract) + browser/Node setup. |
| `src/components/` | Shared UI: `AppLayout`, `Sidebar`, `ScreenState`, `StatCard`, `MeterRow`, `BarChart`, `DataTable`, `Card`, `Badge`, `InsightCallout`, `PageHeader`. |
| `src/features/` | One module per screen: `story`, `budget`, `networth`, `investments`, `debt`, `goals`, `connections` (Settings + the isolated Plaid Link flow). |
| `src/test/setup.ts` | jest-dom + RTL cleanup; boots the MSW Node server + localStorage/matchMedia polyfills. |
| `vite.config.ts` | Vite + Tailwind v4 plugin + Vitest (jsdom, v8 coverage). |
| `public/mockServiceWorker.js` | MSW service worker (vendored by `msw init`; required for the dev mock). |

## How it fits

Loosely coupled: the frontend codes **only** to the canonical contract (`contracts/openapi.canonical.json`) and is developed/tested against an **MSW mock** of it — no backend needs to be running. It never knows whether a source's data came from a CSV or a live API. See `docs/2026-05-24-data-connectors-and-frontend-design.md` and the wireframes in `pencil/website_wire.pen`. (The design spec calls for a Prism mock; we use MSW instead — in-process, zero extra services, the same handlers power both the dev worker and the Vitest suite.)

**Gotchas:** wire colors/money come from the API as **decimal strings**; percentages are **numbers (0–100)** (contract Appendix A). Cover loading / empty / error states per screen.
