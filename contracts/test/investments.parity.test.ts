/**
 * Value parity for `GET /api/v1/investments` (P4.4).
 *
 * The two backends booted by the global setup read the SAME Postgres. Both serve
 * a THIN READ of the `holdings` table (no recompute, DA-23) — applying the SAME
 * deterministic aggregation (portfolio totals + allocation/concentration/
 * holdings) — so for a seeded synthetic DB FastAPI and NestJS must return the
 * SAME body. This is the cross-backend IDENTITY check (DA-9): we seed a tiny
 * SYNTHETIC holdings fixture (data-privacy.md), hit each backend with the SAME
 * request, and assert the two LIVE responses equal EACH OTHER and obey Appendix
 * A:
 *  - market values are decimal STRINGS (DA-2);
 *  - allocation/concentration/holding percentages are JSON NUMBERS, 0-100 (DA-22);
 *  - deterministic ordering (allocation by class; concentration by descending
 *    weight; holdings by symbol);
 *  - empty DB -> "0.00" totals + empty arrays, identical both backends;
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
import { seedInvestmentsFixture, cleanupInvestmentsFixture } from "../src/db";

const pyBase = inject("pyBase");
const tsBase = inject("tsBase");

const INVESTMENTS_PATH = "/api/v1/investments";

interface InvestmentsBody {
  portfolio_value: string;
  unrealized_gain: string;
  allocation: Array<{
    class: string;
    target_pct: number;
    actual_pct: number;
    amount: string;
  }>;
  concentration: Array<{ holding: string; weight: number }>;
  holdings: Array<{
    symbol: string;
    name: string;
    value: string;
    weight: number;
    gain: string;
  }>;
}

describe("GET /api/v1/investments — cross-backend identity (DA-9)", () => {
  beforeAll(async () => {
    await seedInvestmentsFixture();
  });

  afterAll(async () => {
    await cleanupInvestmentsFixture();
  });

  it("FastAPI and NestJS return the SAME investments body for a seeded DB", async () => {
    const [py, ts] = await Promise.all([
      getJson(`${pyBase}${INVESTMENTS_PATH}`),
      getJson(`${tsBase}${INVESTMENTS_PATH}`),
    ]);

    expect(py.status).toBe(200);
    expect(ts.status).toBe(200);

    // The cross-backend identity assertion (DA-9): both backends, reading the
    // SAME holdings rows, produce an identical parsed body — proving neither
    // recomputes and the wire conventions match exactly.
    expect(py.json).toEqual(ts.json);

    const body = py.json as InvestmentsBody;

    // Full design §3 shape (object, not a bare array).
    expect(Object.keys(body).sort()).toEqual([
      "allocation",
      "concentration",
      "holdings",
      "portfolio_value",
      "unrealized_gain",
    ]);

    // Money totals are decimal STRINGS (DA-2).
    expect(body.portfolio_value).toBe("50000.00");
    expect(body.unrealized_gain).toBe("4900.00"); // 3600 + 1500 - 200
    expect(typeof body.portfolio_value).toBe("string");

    // Allocation ordered by class; target_pct (summed weights) vs actual_pct
    // (market share) numeric (DA-22); amount a money string.
    expect(body.allocation.map((a) => a.class)).toEqual(["bonds", "equities"]);
    const equities = body.allocation[1];
    expect(equities.actual_pct).toBe(90); // 45000 / 50000
    expect(equities.target_pct).toBe(80); // 45.0 + 35.0
    expect(equities.amount).toBe("45000.00");
    expect(typeof equities.actual_pct).toBe("number");
    expect(typeof equities.amount).toBe("string");

    // Concentration ranked by descending market-value share (numeric weights).
    expect(body.concentration.map((c) => c.holding)).toEqual([
      "PARITYP44_VTI",
      "PARITYP44_VXUS",
      "PARITYP44_BND",
    ]);
    expect(body.concentration[0].weight).toBe(54);
    expect(body.concentration[1].weight).toBe(36);
    expect(body.concentration[2].weight).toBe(10);
    expect(typeof body.concentration[0].weight).toBe("number");

    // Holdings sorted by symbol; money strings + numeric per-holding weight.
    expect(body.holdings.map((h) => h.symbol)).toEqual([
      "PARITYP44_BND",
      "PARITYP44_VTI",
      "PARITYP44_VXUS",
    ]);
    const vti = body.holdings.find((h) => h.symbol === "PARITYP44_VTI")!;
    expect(vti.value).toBe("27000.00");
    expect(vti.gain).toBe("3600.00");
    expect(vti.weight).toBe(45);
    expect(typeof vti.value).toBe("string");
    expect(typeof vti.weight).toBe("number");
    // Negative gain is a signed money string.
    const bnd = body.holdings.find((h) => h.symbol === "PARITYP44_BND")!;
    expect(bnd.gain).toBe("-200.00");
  });

  it("an empty holdings table -> identical zeros + empty arrays", async () => {
    await cleanupInvestmentsFixture();
    const [py, ts] = await Promise.all([
      getJson(`${pyBase}${INVESTMENTS_PATH}`),
      getJson(`${tsBase}${INVESTMENTS_PATH}`),
    ]);

    expect(py.status).toBe(200);
    expect(ts.status).toBe(200);
    expect(py.json).toEqual(ts.json);
    expect(py.json).toEqual({
      portfolio_value: "0.00",
      unrealized_gain: "0.00",
      allocation: [],
      concentration: [],
      holdings: [],
    });

    // Re-seed so any later run / re-entrancy sees the fixture again.
    await seedInvestmentsFixture();
  });
});

describe("GET /api/v1/investments — DB unavailable parity (DA-18)", () => {
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
      getJson(`${down.python.base}${INVESTMENTS_PATH}`),
      getJson(`${down.nest.base}${INVESTMENTS_PATH}`),
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
