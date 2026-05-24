# P1.5 — frontend scaffold

**Branch:** `2026-05-24-FE/p1-5-frontend-scaffold` · **Base:** `main` · **Date:** 2026-05-24
**Type:** FE (frontend only — no backend or parity work)

## Summary

Scaffolds the `frontend/` app: Vite 8 + React 19 + TypeScript (strict) with
Tailwind v4 via the official `@tailwindcss/vite` plugin (single
`@import "tailwindcss"` in `src/index.css` — no PostCSS/init flow). The app is
**backend-neutral**: all network access lives in one boundary reading
`VITE_API_BASE_URL` (default `http://localhost:8000`), so it renders `/health`
from whichever backend is pointed at — FastAPI (:8000) or NestJS (:3000), which
serve the identical contract. No backend/`contracts/` files were touched.

## Changes

- **Project config** — `package.json` (scripts `dev`/`build`/`lint`/`test`;
  `test` = `vitest run`, accepts `--coverage`), `package-lock.json`,
  `tsconfig*.json` (project refs, strict), `index.html`, `.gitignore`.
- **`vite.config.ts`** — `@vitejs/plugin-react` + `@tailwindcss/vite`; Vitest:
  jsdom, globals, `setupFiles`, v8 coverage **≥80%** global threshold, excluding
  `src/main.tsx`, `src/test/**`, config/`.d.ts`.
- **`eslint.config.js`** — typescript-eslint + react-refresh + react-hooks
  recommended (plugin registered manually so ESLint 10 flat config accepts it).
- **`src/lib/api.ts`** — single network boundary: `apiBaseUrl` (reads
  `import.meta.env.VITE_API_BASE_URL`, strips trailing slash) + typed
  `getHealth()` → GET `${base}/health` → `{ status }`; throws on non-OK.
- **`src/features/health/HealthStatus.tsx`** — calls `getHealth()` on mount;
  explicit **loading / success (`status: ok`) / error** states; semantic HTML
  (`section`/`h2`), `role="status"` + `role="alert"` on error, text + icon (not
  color-only), dark-mode/focus classes. Shows active `VITE_API_BASE_URL`.
  Rendered from `App.tsx`; Tailwind imported at `main.tsx`/`index.css`.
- **Tests** — HealthStatus loading→success + error (mock the `api` boundary only);
  `App` headings; `getHealth()` URL build + non-OK throw + default base URL (mock
  `fetch`). Synthetic data; queries by role/name/text; no class-string asserts.
- **`plans/agent_checklist.md`** + **`docs/STRUCTURE.md`** — P1.5 done; dated
  CHANGELOG + `frontend/` subtree (`src/lib/`, `src/features/`).

## Test plan

From `frontend/`:

```
$ npm install                       # 264 packages, 0 vulnerabilities
$ npm run build                     # tsc -b && vite build — clean (CSS 9.69 kB → utilities emitted)
$ npm run lint && npm run test -- --coverage
#   eslint clean · Test Files 3 passed · Tests 8 passed
#   Statements 100% · Lines 100% · Functions 100% · Branches 81.25%  (floor 80%)
```

Tailwind applies: built CSS contains real utilities (`min-h-screen`,
`bg-slate-50`, `text-2xl`).

Dev-serve (no live backend needed — network mocked in unit tests):
`npm run dev` → VITE ready on `http://localhost:5173/`;
`curl` of the served root → **200**; server stopped after.

Renders `/health` from `VITE_API_BASE_URL`, works against **either** backend
(FastAPI :8000 or NestJS :3000 — same contract). No secrets/real data;
`node_modules`/`dist`/`coverage` gitignored (verified) and uncommitted.

## Checklist

- [x] Vite + React + TS in `frontend/` (replaced `.gitkeep`); Tailwind v4 via `@tailwindcss/vite`, utility applies in built CSS
- [x] Scripts `dev`/`build`/`lint`/`test`; `test` accepts `--coverage`; Vitest jsdom + RTL; coverage ≥80% (entry/config excluded)
- [x] `src/lib/api.ts` single boundary reads `VITE_API_BASE_URL` (default :8000); typed `getHealth()` → `${base}/health`
- [x] `HealthStatus` loading/success/error, semantic + accessible; shows base URL; rendered from `App`
- [x] Tests mock only the network boundary, assert behavior by role/name/text; `getHealth()` URL test; synthetic
- [x] Build + dev-serve (200) verified; gate green; checklist + STRUCTURE updated; no secrets; build/dep dirs uncommitted
