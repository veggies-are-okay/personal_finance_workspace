# P5.2 — Settings / Data Sources + Plaid Link module (FE)

## Summary

Builds the **Settings / Data Sources** screen and the isolated **Plaid Link**
flow on top of the P5.1 frontend shell. The screen lists each data source with
its **Local↔API mode** and `item_status`, reading `GET /api/v1/connections`
through the existing typed API client. A new `features/connections/` module
embeds `react-plaid-link` behind a single hook (`usePlaidConnect`) and renders
all four connection states with the right affordance. Frontend-only — **no
backend or contract change** (the connections endpoints are P6.1; this codes
against the MSW mock per DA-21).

## Changes (by realm)

- **Connections feature (`src/features/connections/`):** `SettingsScreen`
  (reads `GET /api/v1/connections` via `useApi` + `ScreenState`) renders a
  `SourceCard` per source plus a linked-Items summary. `usePlaidConnect` is the
  **only** `react-plaid-link` coupling — link-token → open Link →
  `onSuccess(public_token)` → exchange. `ConnectButton` shows **Connect**
  (`not_connected`/`disconnected`) or **Reconnect** (`needs_reauth`/`error`,
  Plaid update mode — DA-13); `connected` has no CTA. `ModeToggle` is an
  accessible Local↔API radiogroup that calls the connections API. `sourceMeta`
  maps each source/status to labels, badge tone, and affordance.
- **API client + types (`src/lib/`):** `api.ts` gains a `postJson` helper and
  `getConnections` / `createLinkToken` / `exchangePublicToken` / `setSourceMode`.
  `types.ts` gains the connections wire types (mirroring the canonical schemas).
- **Mock (`src/mocks/`):** connections fixtures covering **every** `item_status`
  + handlers for `GET /connections`, `POST /connections/{link-token,exchange}`,
  and a **mock-only** `POST /connections/source-mode` (the toggle target).
- **Shell wiring:** the Sidebar's disabled Data-sources placeholder is activated
  into a `/settings` `NavLink`; `App.tsx` adds the route.
- **Docs:** `frontend/README.md` (connections/Plaid mock + future real-backend
  swap), `docs/STRUCTURE.md`, and `plans/agent_checklist.md` (P5.2 → `[x]`).

## Feature mapping

- **Settings / Data Sources screen** (portal's 7th screen): per-source mode +
  status, Connect/Reconnect, Local↔API toggle — mirrors `pencil/website_wire.pen`.
- **Future Plaid swap:** `usePlaidConnect` is the seam. When **P6.1** ships the
  real connections endpoints, `VITE_API_BASE_URL` points the same client at the
  backend; a real `link_token` opens real Link with **no module change**. The
  end-to-end adapter swap behind the toggle is **P6.4 (`BE`)** — hence the toggle
  hits a mock-only path here, intentionally absent from the canonical OpenAPI.

## Happy-path verification

Playwright screenshot of `/settings` against the MSW mock — all five source
cards with **Connected / Sync Error / Needs Reconnect / Not Connected** badges,
the Local↔API toggle, Reconnect/Connect CTAs, and the linked-accounts summary:

![Settings / Data Sources screen](https://raw.githubusercontent.com/veggies-are-okay/personal_finance_workspace/1b5bbc7bd90b732588cefa6d42e2d3e61e9a640f/pull_requests/evidence/p5-2-settings-connections/proof.png)

## Test plan (FE gate)

From `frontend/`: `npm run lint && npm run test -- --coverage && npm run build`.

- **lint:** clean.
- **Vitest + RTL:** **68 tests pass.** Coverage **95.3% stmts / 83.5% branch /
  96.4% funcs / 96.7% lines** (gate ≥ 80, threshold-enforced — exit 0).
- **build:** green (`tsc -b && vite build`).

Tests assert the load-bearing behavior: the **mock-driven Link flow** runs
link-token → open → exchange and fires `onConnected`; **all four `item_status`
states** render with the right badge; **Reconnect** appears for
`needs_reauth`/`error` (2 CTAs) and **Connect** for `not_connected` (1 CTA);
**toggling mode fires the API request** (assert the request body, not just a
render) and reloads the snapshot. `react-plaid-link`'s `usePlaidLink` is
`vi.mock`-ed everywhere — no real Plaid Link, no credentials (DATA PRIVACY).

## Checklist

- [x] Settings reads `GET /api/v1/connections`; isolated `features/connections/`.
- [x] All four `item_status` states render; Reconnect CTA for `needs_reauth`/`error`.
- [x] Local↔API toggle calls the connections API (request asserted).
- [x] `react-plaid-link` mocked in tests/dev — synthetic data only, no real tokens.
- [x] FE gate green (lint + Vitest ≥80% + build); Playwright screenshot committed.
- [x] README + `docs/STRUCTURE.md` + checklist updated. No backend/contract change.
