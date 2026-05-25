# P5.1 — Frontend app shell + six core screens (mock-first, live-wired)

## Summary

Builds the backend-neutral UI: an app shell (sidebar nav + client routing + light/dark theme) and the **six core screens** — Story, Budget, Net Worth, Investments, Debt, Goals — each rendering from its `/api/v1/*` view endpoint, mirroring `pencil/website_wire.pen`. Develops **mock-first** against an MSW mock derived from the canonical contract (no backend needed), and the same client points at a live backend when `VITE_API_BASE_URL` is set (DA-21). Settings/Connections is a disabled nav placeholder for P5.2.

Frontend-only — no API/behavior/contract change, so only the **frontend** CI gate applies (backends and `contracts/` untouched).

## Changes (Large tier — by realm)

- **Data layer (`src/lib/`, `src/mocks/`):** `api.ts` gains typed clients for the six view endpoints + `ApiRequestError` (canonical `{error:{code,message,details}}`); `types.ts` mirrors the contract wire types; `useApi.ts` is the shared state machine (`loading`/`success`/`error`/`not_connected`). **MSW** (chosen over Prism — in-process, no extra service, the *same* handlers power the dev worker and Vitest) serves synthetic fixtures from `openapi.canonical.json`, with `?scenario=empty|error` control.
- **App shell + shared UI (`src/components/`):** `AppLayout` + `Sidebar` (react-router-dom v7 `NavLink`) + reusable `ScreenState`/`StatCard`/`MeterRow`/`BarChart`/`DataTable`/`Card`/`Badge`/`InsightCallout`/`PageHeader`; theme tokens + class-based dark mode.
- **Screens (`src/features/`):** `story`/`budget`/`networth`/`investments`/`debt`/`goals`, each wrapping its body in `ScreenState`. `main.tsx` starts MSW only when `VITE_API_BASE_URL` is unset.
- **Cleanup + docs:** removed the P1.5 `features/health/` placeholder; updated `frontend/README.md`, `docs/STRUCTURE.md`, and ticked P5.1.

## Feature mapping (→ each screen)

- **Story** (`/`) — composes all five domains: KPI row + plain-language insight + "Explore your story" cards linking onward.
- **Budget** (`/budget` → `GET /api/v1/budget`) — 50/30/20 meters, top categories, needs/wants trend, recurring charges.
- **Net Worth** (`/net-worth` → `GET /api/v1/networth`) — totals, net-worth-over-time stack, accounts with signed 30-day deltas.
- **Investments** (`/investments` → `GET /api/v1/investments`) — value/gain, allocation vs target, concentration, holdings.
- **Debt** (`/debt` → `GET /api/v1/debt`) — tranches by rate, avalanche-vs-minimums payoff outlook, loans.
- **Goals** (`/goals` → `GET /api/v1/goals`) — progress meter, funding sources, affordability snapshot.

Every screen handles the **`not_connected`** empty state as a friendly "connect a source" prompt, not an error (DA-20).

## Happy-path verification

**Story home (vs. the MSW mock):**

![Story home rendered against the mock](https://raw.githubusercontent.com/veggies-are-okay/personal_finance_workspace/948379ff6167bf9e25982e446c1e2e64dfd70d99/pull_requests/evidence/p5-1-core-screens/proof.png)

Also committed: `budget.png` (vs. mock) and `wired-networth.png` (the **DA-21 wiring smoke run**) under `pull_requests/evidence/p5-1-core-screens/`. For the wiring run a live FastAPI backend (migrated, seeded with synthetic accounts) served `GET /api/v1/networth`; the same client rendered **$204.3K / 5 accounts / $0.00 deltas / empty series** — materially different from the mock ($312.4K / 6 accounts / non-zero deltas / populated chart) — proving real backend reads. Synthetic rows were deleted after capture; no real data anywhere.

## Test plan

Frontend gate (from `frontend/`): `npm run lint && npm run test -- --coverage && npm run build` — **all green**.

- Vitest + RTL: **43/43 passing**; coverage **96.8% stmts · 84.6% branch · 98.5% funcs · 98.7% lines** (floor 80%). Tests assert rendered behavior — loading→data, the `not_connected` empty state, and the error+retry alert per screen; routing/theme/skip-link for the shell; money/percent formatting; the `useApi` machine.
- Lint clean; `tsc -b && vite build` succeeds; Playwright (bundled chromium) screens render vs. mock + live.

## Checklist

- [x] App shell (sidebar nav + routing + theme) mirrors the wireframe.
- [x] Six screens render from their endpoints; loading / data / not_connected / error states each covered.
- [x] Mock-first (MSW from the canonical contract) + live via `VITE_API_BASE_URL` (DA-21).
- [x] Appendix A on the wire (money strings, percent numbers, enums).
- [x] FE gate green (lint + ≥80% coverage + build); committed Playwright screenshot.
- [x] READMEs + `docs/STRUCTURE.md` + checklist updated; no real financial data.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
