/**
 * Value parity for `GET /api/v1/debt` (P4.5).
 *
 * The two backends booted by the global setup read the SAME Postgres. Both serve
 * a THIN READ of the `loans` table and derive the payoff projections with the
 * SAME deterministic integer-cent amortization, so for a seeded synthetic DB
 * FastAPI and NestJS must return the SAME body. This is the cross-backend
 * IDENTITY check the checklist calls out (DA-9): we seed a tiny SYNTHETIC
 * fixture (data-privacy.md), hit each backend with the SAME request, and assert
 * the two LIVE responses equal EACH OTHER and obey Appendix A:
 *  - money is a decimal STRING (DA-2);
 *  - rates are JSON NUMBERS, 0-100 (DA-22);
 *  - `payoff_strategy`/`loan_priority` are the lower_snake registry enums (DA-5);
 *  - BOTH avalanche (highest-rate-first) and minimums payoff views are returned;
 *  - deterministic ordering (loans + tranches by rate desc);
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
import { seedDebtFixture, cleanupDebtFixture } from "../src/db";

const pyBase = inject("pyBase");
const tsBase = inject("tsBase");

const DEBT_PATH = "/api/v1/debt";

interface DebtBody {
  total: string;
  weighted_avg_rate: number;
  monthly_minimum: string;
  tranches: Array<{
    rate: number;
    balance: string;
    loan_count: number;
    priority: string;
  }>;
  payoff: Array<{
    strategy: string;
    debt_free_year: number;
    total_interest: string;
  }>;
  loans: Array<{
    name: string;
    balance: string;
    rate: number;
    minimum_payment: string;
    priority: string;
  }>;
}

beforeAll(async () => {
  await seedDebtFixture();
});

afterAll(async () => {
  await cleanupDebtFixture();
});

describe("GET /api/v1/debt — cross-backend identity (DA-9)", () => {
  it("FastAPI and NestJS return the SAME debt body for a seeded DB", async () => {
    const [py, ts] = await Promise.all([
      getJson(`${pyBase}${DEBT_PATH}`),
      getJson(`${tsBase}${DEBT_PATH}`),
    ]);

    expect(py.status).toBe(200);
    expect(ts.status).toBe(200);

    // The cross-backend identity assertion (DA-9): both backends, reading the
    // SAME loan rows and running the SAME payoff amortization, produce an
    // identical parsed body — proving the derived projections match to the cent.
    expect(py.json).toEqual(ts.json);

    const body = py.json as DebtBody;

    // Full design §3 shape (object, not a bare array).
    expect(Object.keys(body).sort()).toEqual([
      "loans",
      "monthly_minimum",
      "payoff",
      "total",
      "tranches",
      "weighted_avg_rate",
    ]);

    // Totals: money is a decimal STRING (DA-2); rate is a JSON NUMBER (DA-22).
    expect(body.total).toBe("26560.00");
    expect(typeof body.total).toBe("string");
    expect(body.monthly_minimum).toBe("320.00");
    expect(body.weighted_avg_rate).toBe(5.2);
    expect(typeof body.weighted_avg_rate).toBe("number");

    // Loans ordered by rate desc; priority is the registry enum (DA-5).
    expect(body.loans.map((l) => l.name)).toEqual([
      "ParityP45 Loan A",
      "ParityP45 Loan B",
      "ParityP45 Loan C",
    ]);
    const top = body.loans[0];
    expect(top.balance).toBe("12000.00");
    expect(top.minimum_payment).toBe("150.00");
    expect(top.rate).toBe(6.8);
    expect(top.priority).toBe("pay_first");

    // Tranches grouped + ordered by rate desc.
    expect(body.tranches.map((t) => t.rate)).toEqual([6.8, 4.5, 3.2]);
    expect(body.tranches[0].balance).toBe("12000.00");
    expect(body.tranches[0].loan_count).toBe(1);
    expect(body.tranches[0].priority).toBe("pay_first");
  });

  it("returns BOTH avalanche and minimums payoff views per the registry", async () => {
    const [py, ts] = await Promise.all([
      getJson(`${pyBase}${DEBT_PATH}`),
      getJson(`${tsBase}${DEBT_PATH}`),
    ]);
    expect(py.json).toEqual(ts.json);

    const body = py.json as DebtBody;
    const byStrategy = Object.fromEntries(
      body.payoff.map((p) => [p.strategy, p]),
    );

    // payoff_strategy enum registry values present (DA-5), avalanche first.
    expect(body.payoff.map((p) => p.strategy)).toEqual([
      "avalanche",
      "minimums",
    ]);
    expect(byStrategy.avalanche).toBeDefined();
    expect(byStrategy.minimums).toBeDefined();

    // Money is a decimal STRING; year an integer.
    for (const proj of body.payoff) {
      expect(typeof proj.total_interest).toBe("string");
      expect(Number.isInteger(proj.debt_free_year)).toBe(true);
    }

    // Highest-rate-first acceleration clears no later, with no more interest.
    expect(byStrategy.avalanche.debt_free_year).toBeLessThanOrEqual(
      byStrategy.minimums.debt_free_year,
    );
    expect(Number(byStrategy.avalanche.total_interest)).toBeLessThanOrEqual(
      Number(byStrategy.minimums.total_interest),
    );
  });

  it("the strategy query param validates against the registry, body unchanged", async () => {
    // A known strategy is accepted and does NOT change the body (both
    // projections are always returned); an unknown value -> canonical 422.
    const [pyDefault, pyAval, tsAval] = await Promise.all([
      getJson(`${pyBase}${DEBT_PATH}`),
      getJson(`${pyBase}${DEBT_PATH}?strategy=avalanche`),
      getJson(`${tsBase}${DEBT_PATH}?strategy=avalanche`),
    ]);
    expect(pyAval.status).toBe(200);
    expect(tsAval.status).toBe(200);
    expect(pyAval.json).toEqual(tsAval.json);
    expect(pyAval.json).toEqual(pyDefault.json);

    const [pyBad, tsBad] = await Promise.all([
      getJson(`${pyBase}${DEBT_PATH}?strategy=snowball`),
      getJson(`${tsBase}${DEBT_PATH}?strategy=snowball`),
    ]);
    expect(pyBad.status).toBe(422);
    expect(tsBad.status).toBe(422);
    const pyErr = pyBad.json as { error: { code: string } };
    const tsErr = tsBad.json as { error: { code: string } };
    expect(pyErr.error.code).toBe("VALIDATION_ERROR");
    expect(tsErr.error.code).toBe("VALIDATION_ERROR");
  });
});

describe("GET /api/v1/debt — DB unavailable parity (DA-18)", () => {
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
      getJson(`${down.python.base}/api/v1/debt`),
      getJson(`${down.nest.base}/api/v1/debt`),
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
