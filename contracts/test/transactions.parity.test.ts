/**
 * Value parity for `GET /api/v1/transactions` (P4.1).
 *
 * The two backends booted by the global setup read the SAME Postgres. We seed a
 * tiny SYNTHETIC fixture (data-privacy.md), hit each backend with the SAME
 * request, and assert the two LIVE responses equal EACH OTHER (drift guard) and
 * satisfy the Appendix A wire conventions. Covers the cases the P4.1 checklist
 * names:
 *  - success: identical paginated body; money = decimal string; dates YYYY-MM-DD;
 *    absent optional fields omitted (DA-6);
 *  - invalid query (limit > 200) -> identical canonical 422 (DA-1);
 *  - offset past the end -> empty `data` + correct `total`, identical (DA-4);
 *  - DB unavailable -> identical canonical 503 (DA-18), proven against a second,
 *    short-lived backend pair pointed at an unreachable database.
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
import { seedTransactionsFixture, cleanupTransactionsFixture } from "../src/db";

const pyBase = inject("pyBase");
const tsBase = inject("tsBase");

const TX_PATH = "/api/v1/transactions";

beforeAll(async () => {
  await seedTransactionsFixture();
});

afterAll(async () => {
  await cleanupTransactionsFixture();
});

describe("GET /api/v1/transactions — value parity", () => {
  it("returns identical paginated bodies obeying Appendix A (money string, date YYYY-MM-DD)", async () => {
    const [py, ts] = await Promise.all([
      getJson(`${pyBase}${TX_PATH}?account=Checking`),
      getJson(`${tsBase}${TX_PATH}?account=Checking`),
    ]);

    expect(py.status).toBe(200);
    expect(ts.status).toBe(200);

    // The two LIVE responses equal each other (drift guard).
    expect(py.json).toEqual(ts.json);

    const body = py.json as {
      data: Array<Record<string, unknown>>;
      pagination: { limit: number; offset: number; total: number };
    };
    // Paginated envelope (DA-4): object, not a bare array.
    expect(Object.keys(body).sort()).toEqual(["data", "pagination"]);
    expect(body.pagination).toEqual({ limit: 50, offset: 0, total: 2 });

    const coffee = body.data.find((r) => r.description === "Coffee Shop")!;
    // Money is a decimal STRING (DA-2), never a JSON number.
    expect(coffee.amount).toBe("-4.75");
    expect(typeof coffee.amount).toBe("string");
    // Date is YYYY-MM-DD (DA-3).
    expect(coffee.date).toBe("2026-05-20");
    expect(coffee.category).toBe("dining");
    expect(coffee.bucket).toBe("wants");
    expect(coffee.is_recurring).toBe(false);

    // Absent optional fields are OMITTED, not null (DA-6).
    const paycheck = body.data.find((r) => r.description === "Paycheck")!;
    expect("category" in paycheck).toBe(false);
    expect("bucket" in paycheck).toBe(false);
  });

  it("invalid query (limit > 200) -> identical canonical 422 body (DA-1)", async () => {
    const [py, ts] = await Promise.all([
      getJson(`${pyBase}${TX_PATH}?limit=201`),
      getJson(`${tsBase}${TX_PATH}?limit=201`),
    ]);

    expect(py.status).toBe(422);
    expect(ts.status).toBe(422);

    const pyErr = py.json as {
      error: { code: string; message: string; details: unknown[] };
    };
    const tsErr = ts.json as {
      error: { code: string; message: string; details: unknown[] };
    };

    // Canonical envelope: same code, message, and detail field/location across both.
    expect(pyErr.error.code).toBe("VALIDATION_ERROR");
    expect(tsErr.error.code).toBe("VALIDATION_ERROR");
    expect(pyErr.error.message).toBe(tsErr.error.message);

    const pyDetail = pyErr.error.details[0] as Record<string, string>;
    const tsDetail = tsErr.error.details[0] as Record<string, string>;
    expect(Object.keys(pyDetail).sort()).toEqual([
      "code",
      "field",
      "location",
      "message",
    ]);
    expect(pyDetail.field).toBe("limit");
    expect(tsDetail.field).toBe("limit");
    expect(pyDetail.location).toBe("query");
    expect(tsDetail.location).toBe("query");
  });

  it("offset past the end -> empty data + correct total, identical (DA-4)", async () => {
    const [py, ts] = await Promise.all([
      getJson(`${pyBase}${TX_PATH}?offset=999`),
      getJson(`${tsBase}${TX_PATH}?offset=999`),
    ]);

    expect(py.status).toBe(200);
    expect(ts.status).toBe(200);
    expect(py.json).toEqual(ts.json);

    const body = py.json as {
      data: unknown[];
      pagination: { offset: number; total: number };
    };
    expect(body.data).toEqual([]);
    expect(body.pagination.offset).toBe(999);
    // total reflects all matching rows ignoring pagination.
    expect(body.pagination.total).toBe(3);
  });
});

describe("GET /api/v1/transactions — DB unavailable parity (DA-18)", () => {
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
      getJson(`${down.python.base}${TX_PATH}`),
      getJson(`${down.nest.base}${TX_PATH}`),
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
