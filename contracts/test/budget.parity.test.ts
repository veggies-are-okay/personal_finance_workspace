/**
 * Value parity for `GET /api/v1/budget` (P4.2).
 *
 * The two backends booted by the global setup read the SAME Postgres. Both serve
 * THIN READS of the precomputed aggregate tables (no recompute, DA-23), so for a
 * seeded synthetic DB FastAPI and NestJS must return the SAME body. This is the
 * cross-backend IDENTITY check the checklist calls out (DA-9): we seed a tiny
 * SYNTHETIC fixture (data-privacy.md), hit each backend with the SAME request,
 * and assert the two LIVE responses equal EACH OTHER and obey Appendix A:
 *  - money is a decimal STRING (DA-2);
 *  - percentages are JSON NUMBERS, 0-100 (DA-22);
 *  - dates are YYYY-MM-DD (DA-3), months YYYY-MM;
 *  - deterministic ordering (50/30/20 buckets; categories/monthly/recurring sorted);
 *  - DB unavailable -> identical canonical 503 (DA-18).
 *
 * Structural OpenAPI conformance for this path is covered generically in
 * openapi.parity.test.ts now that it is in IMPLEMENTED_PATHS.
 */

import { inject, afterAll, beforeAll, describe, expect, it } from "vitest";

import { getJson } from "../src/http";
import {
  startDbDownBackends,
  killTree,
  type BackendHandle,
} from "../src/backends";
import {
  seedBudgetFixture,
  cleanupBudgetFixture,
  BUDGET_WINDOW,
} from "../src/db";

const pyBase = inject("pyBase");
const tsBase = inject("tsBase");

const BUDGET_PATH = `/api/v1/budget?window=${BUDGET_WINDOW}`;

beforeAll(async () => {
  await seedBudgetFixture();
});

afterAll(async () => {
  await cleanupBudgetFixture();
});

describe("GET /api/v1/budget — cross-backend identity (DA-9)", () => {
  it("FastAPI and NestJS return the SAME budget body for a seeded DB", async () => {
    const [py, ts] = await Promise.all([
      getJson(`${pyBase}${BUDGET_PATH}`),
      getJson(`${tsBase}${BUDGET_PATH}`),
    ]);

    expect(py.status).toBe(200);
    expect(ts.status).toBe(200);

    // The cross-backend identity assertion (DA-9): both backends, reading the
    // SAME precomputed rows, produce an identical parsed body — proving neither
    // recomputes and the wire conventions match exactly.
    expect(py.json).toEqual(ts.json);

    const body = py.json as {
      savings_rate: number;
      effective_tax_rate: number;
      buckets: Array<Record<string, unknown>>;
      categories: Array<Record<string, unknown>>;
      monthly: Array<Record<string, unknown>>;
      recurring: Array<Record<string, unknown>>;
    };

    // Full design §3 shape (object, not a bare array).
    expect(Object.keys(body).sort()).toEqual([
      "buckets",
      "categories",
      "effective_tax_rate",
      "monthly",
      "recurring",
      "savings_rate",
    ]);

    // Percentages are JSON NUMBERS, 0-100 (DA-22), never strings.
    expect(body.savings_rate).toBe(22);
    expect(body.effective_tax_rate).toBe(18.5);
    expect(typeof body.savings_rate).toBe("number");
    expect(typeof body.effective_tax_rate).toBe("number");

    // Buckets ordered 50/30/20; money is a decimal STRING (DA-2); pct numeric.
    expect(body.buckets.map((b) => b.name)).toEqual([
      "needs",
      "wants",
      "savings",
    ]);
    const needs = body.buckets[0];
    expect(needs.amount).toBe("2400.00");
    expect(typeof needs.amount).toBe("string");
    expect(needs.target_pct).toBe(50);
    expect(typeof needs.target_pct).toBe("number");

    // Categories sorted by name; money string + bucket enum.
    expect(body.categories.map((c) => c.name)).toEqual(["groceries", "rent"]);
    expect(body.categories[0].amount).toBe("420.00");
    expect(body.categories[0].bucket).toBe("needs");

    // Monthly sorted by month; needs/wants money strings.
    expect(body.monthly.map((m) => m.month)).toEqual(["2026-02", "2026-03"]);
    expect(body.monthly[0].needs).toBe("2350.00");

    // Recurring sorted by merchant; YYYY-MM-DD date + decimal-string estimate.
    expect(body.recurring.map((r) => r.merchant)).toEqual([
      "ParityP42 Cloud Backup",
      "ParityP42 Streaming Co",
    ]);
    const streaming = body.recurring.find(
      (r) => r.merchant === "ParityP42 Streaming Co",
    )!;
    expect(streaming.last_charged).toBe("2026-05-01");
    expect(streaming.monthly_est).toBe("15.99");
    expect(streaming.cadence).toBe("monthly");
  });

  it("an unknown window -> identical zeros + empty arrays (no recompute, DA-23)", async () => {
    // recurring_charges is window-independent; the seeded recurring rows persist
    // until afterAll, so clean them first to assert a fully-empty body parity.
    await cleanupBudgetFixture();
    const url = "/api/v1/budget?window=parity-p42-absent";
    const [py, ts] = await Promise.all([
      getJson(`${pyBase}${url}`),
      getJson(`${tsBase}${url}`),
    ]);

    expect(py.status).toBe(200);
    expect(ts.status).toBe(200);
    expect(py.json).toEqual(ts.json);
    expect(py.json).toEqual({
      savings_rate: 0,
      effective_tax_rate: 0,
      buckets: [],
      categories: [],
      monthly: [],
      recurring: [],
    });

    // Re-seed so any later run / re-entrancy sees the fixture again.
    await seedBudgetFixture();
  });
});

describe("GET /api/v1/budget — DB unavailable parity (DA-18)", () => {
  let down: { python: BackendHandle; nest: BackendHandle };

  beforeAll(async () => {
    down = await startDbDownBackends();
  });

  afterAll(() => {
    killTree(down.python.proc);
    killTree(down.nest.proc);
  });

  it("both backends return an identical canonical 503 when the DB is unreachable", async () => {
    const [py, ts] = await Promise.all([
      getJson(`${down.python.base}/api/v1/budget`),
      getJson(`${down.nest.base}/api/v1/budget`),
    ]);

    expect(py.status).toBe(503);
    expect(ts.status).toBe(503);

    // Identical canonical 503 body across both backends.
    expect(py.json).toEqual(ts.json);
    expect(py.json).toEqual({
      error: {
        code: "SERVICE_UNAVAILABLE",
        message: "Database unavailable.",
        details: [],
      },
    });
  });
});
