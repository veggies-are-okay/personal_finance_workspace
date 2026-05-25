/**
 * Value parity for `GET /api/v1/networth` (P4.3).
 *
 * The two backends booted by the global setup read the SAME Postgres. Both
 * compose the `accounts` table the SAME way (signed-balance convention, no
 * recompute, no synthesized history — DA-23), so for a seeded synthetic DB
 * FastAPI and NestJS must return the SAME body. This is the cross-backend
 * IDENTITY check the checklist calls out (DA-9): we seed a tiny SYNTHETIC
 * fixture (data-privacy.md), hit each backend with the SAME request, and assert
 * the two LIVE responses equal EACH OTHER and obey Appendix A:
 *  - money is a decimal STRING (DA-2);
 *  - totals follow the signed-balance convention (assets = positive balances,
 *    liabilities = abs of negative, net_worth = their net);
 *  - accounts are sorted by name (then id); `delta_30d` is "0.00" (no history);
 *  - `series` is empty (no history source);
 *  - empty DB -> identical zeros + empty arrays;
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
import { seedNetworthFixture, cleanupNetworthFixture } from "../src/db";

const pyBase = inject("pyBase");
const tsBase = inject("tsBase");

const NETWORTH_PATH = "/api/v1/networth";

beforeAll(async () => {
  await seedNetworthFixture();
});

afterAll(async () => {
  await cleanupNetworthFixture();
});

describe("GET /api/v1/networth — cross-backend identity (DA-9)", () => {
  it("FastAPI and NestJS return the SAME net-worth body for a seeded DB", async () => {
    const [py, ts] = await Promise.all([
      getJson(`${pyBase}${NETWORTH_PATH}`),
      getJson(`${tsBase}${NETWORTH_PATH}`),
    ]);

    expect(py.status).toBe(200);
    expect(ts.status).toBe(200);

    // The cross-backend identity assertion (DA-9): both backends, reading the
    // SAME accounts rows, produce an identical parsed body — proving neither
    // recomputes and the wire conventions match exactly.
    expect(py.json).toEqual(ts.json);

    const body = py.json as {
      net_worth: string;
      assets: string;
      liabilities: string;
      series: unknown[];
      accounts: Array<Record<string, unknown>>;
    };

    // Full design §3 shape (object, not a bare array).
    expect(Object.keys(body).sort()).toEqual([
      "accounts",
      "assets",
      "liabilities",
      "net_worth",
      "series",
    ]);

    // Totals follow the signed-balance convention; money is a STRING (DA-2).
    // assets = 60000 + 28900 + 90000 = 178900; liabilities = abs(-26560) = 26560.
    expect(body.assets).toBe("178900.00");
    expect(body.liabilities).toBe("26560.00");
    expect(body.net_worth).toBe("152340.00");
    expect(typeof body.assets).toBe("string");
    expect(typeof body.net_worth).toBe("string");

    // Accounts sorted by name; null balance -> "0.00"; delta_30d a zero string.
    expect(body.accounts.map((a) => a.name)).toEqual([
      "Brokerage",
      "Checking",
      "Roth IRA",
      "Unfunded",
      "Visa",
    ]);
    const brokerage = body.accounts[0];
    expect(brokerage.type).toBe("investment");
    expect(brokerage.balance).toBe("60000.00");
    expect(brokerage.delta_30d).toBe("0.00");
    const unfunded = body.accounts.find((a) => a.name === "Unfunded")!;
    expect(unfunded.balance).toBe("0.00");
    const visa = body.accounts.find((a) => a.name === "Visa")!;
    expect(visa.balance).toBe("-26560.00");

    // No history source -> empty series, identical across both backends.
    expect(body.series).toEqual([]);
  });

  it("an empty accounts table -> identical zeros + empty arrays (DA-23)", async () => {
    // Remove the seeded accounts so the table is empty for this assertion.
    await cleanupNetworthFixture();
    const [py, ts] = await Promise.all([
      getJson(`${pyBase}${NETWORTH_PATH}`),
      getJson(`${tsBase}${NETWORTH_PATH}`),
    ]);

    expect(py.status).toBe(200);
    expect(ts.status).toBe(200);
    expect(py.json).toEqual(ts.json);
    expect(py.json).toEqual({
      net_worth: "0.00",
      assets: "0.00",
      liabilities: "0.00",
      series: [],
      accounts: [],
    });

    // Re-seed so any later run / re-entrancy sees the fixture again.
    await seedNetworthFixture();
  });
});

describe("GET /api/v1/networth — DB unavailable parity (DA-18)", () => {
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
      getJson(`${down.python.base}${NETWORTH_PATH}`),
      getJson(`${down.nest.base}${NETWORTH_PATH}`),
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
