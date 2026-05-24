---
paths:
  - "frontend/**/*.{ts,tsx}"
---

# Frontend Testing

## Coverage

- Enforce **>= 80%** coverage with `npm run test -- --coverage` or `vitest run --coverage`.
- Treat coverage as a floor, not the goal. Critical screens and stateful hooks should usually exceed it.

## What to test

- Test what the user can observe: rendering, labels, validation messages, loading/error/empty states, navigation intent, and disabled/enabled transitions.
- Prefer queries by **role, name, label, placeholder, and visible text**.
- Cover success and failure states for forms, async fetches, and guarded UI.

## Mocking

- Do **not** mock React internals, component state, or trivial child components by default.
- Mock only boundary concerns: HTTP calls, router/navigation edges, time, and browser APIs not available in the test environment.
- Prefer realistic fixture data over deeply nested mock implementations.
- **Synthetic fixtures only** — never use real financial data in committed or CI tests.

## Avoid brittle tests

- Avoid giant snapshots for normal component tests.
- Avoid asserting long Tailwind class lists.
- Assert only meaningful classes or attributes when they encode state or accessibility behavior (e.g. `hidden`, `sr-only`, `dark:*`, `aria-disabled`).

## Browser-level checks

- Use Playwright or browser-mode tests for focus management, keyboard navigation, responsive layout, dark mode, and other real-browser behaviors.
