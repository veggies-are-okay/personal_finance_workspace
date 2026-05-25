/**
 * Value parity for `GET /api/v1/goals` (P4.6).
 *
 * The two backends booted by the global setup read the SAME Postgres. Both serve
 * a THIN READ of the `goals` table (no recompute, DA-23), so for a seeded
 * synthetic DB FastAPI and NestJS must return the SAME body. This is the
 * cross-backend IDENTITY check the checklist calls out (DA-9): we seed a tiny
 * SYNTHETIC fixture (data-privacy.md), hit each backend with the SAME request,
 * and assert the two LIVE responses equal EACH OTHER and obey Appendix A:
 *  - summed `target`/`saved` + funding `amount` are decimal STRINGS (DA-2);
 *  - `progress_pct`/`income_share` are JSON NUMBERS, 0-100 (DA-22);
 *  - funding is ordered deterministically (by goal name);
 *  - empty DB -> identical well-formed zeros + empty funding;
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
import { seedGoalsFixture, cleanupGoalsFixture } from "../src/db";

const pyBase = inject("pyBase");
const tsBase = inject("tsBase");

const GOALS_PATH = "/api/v1/goals";

const ZERO_AFFORDABILITY = {
  price: "0.00",
  down_payment: "0.00",
  mortgage: "0.00",
  monthly_piti: "0.00",
  income_share: 0,
};

describe("GET /api/v1/goals — cross-backend identity (DA-9)", () => {
  beforeAll(async () => {
    await seedGoalsFixture();
  });

  afterAll(async () => {
    await cleanupGoalsFixture();
  });

  it("FastAPI and NestJS return the SAME goals body for a seeded DB", async () => {
    const [py, ts] = await Promise.all([
      getJson(`${pyBase}${GOALS_PATH}`),
      getJson(`${tsBase}${GOALS_PATH}`),
    ]);

    expect(py.status).toBe(200);
    expect(ts.status).toBe(200);

    // The cross-backend identity assertion (DA-9): both backends, reading the
    // SAME `goals` rows, produce an identical parsed body — proving neither
    // recomputes and the wire conventions match exactly.
    expect(py.json).toEqual(ts.json);

    const body = py.json as {
      target: string;
      saved: string;
      progress_pct: number;
      funding: Array<{ source: string; amount: string }>;
      affordability: Record<string, unknown>;
    };

    // Full design §3 shape (object, not a bare array).
    expect(Object.keys(body).sort()).toEqual([
      "affordability",
      "funding",
      "progress_pct",
      "saved",
      "target",
    ]);

    // Summed money is a decimal STRING (DA-2); progress is numeric (DA-22).
    expect(body.target).toBe("60000.00");
    expect(body.saved).toBe("21000.00");
    expect(typeof body.target).toBe("string");
    expect(body.progress_pct).toBe(35);
    expect(typeof body.progress_pct).toBe("number");

    // Funding ordered by goal name; amount is a decimal string.
    expect(body.funding.map((f) => f.source)).toEqual([
      "ParityP46 Emergency Fund",
      "ParityP46 Vacation",
    ]);
    expect(body.funding[0].amount).toBe("15000.00");
    expect(body.funding[1].amount).toBe("6000.00");
    expect(typeof body.funding[0].amount).toBe("string");

    // Affordability is a fixed zero-filled block (no backing table).
    expect(body.affordability).toEqual(ZERO_AFFORDABILITY);
  });

  it("an empty goals table -> identical zeros + empty funding (DA-23)", async () => {
    await cleanupGoalsFixture();
    const [py, ts] = await Promise.all([
      getJson(`${pyBase}${GOALS_PATH}`),
      getJson(`${tsBase}${GOALS_PATH}`),
    ]);

    expect(py.status).toBe(200);
    expect(ts.status).toBe(200);
    expect(py.json).toEqual(ts.json);
    expect(py.json).toEqual({
      target: "0.00",
      saved: "0.00",
      progress_pct: 0,
      funding: [],
      affordability: ZERO_AFFORDABILITY,
    });

    // Re-seed so any later run / re-entrancy sees the fixture again.
    await seedGoalsFixture();
  });
});

describe("GET /api/v1/goals — DB unavailable parity (DA-18)", () => {
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
      getJson(`${down.python.base}/api/v1/goals`),
      getJson(`${down.nest.base}/api/v1/goals`),
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
