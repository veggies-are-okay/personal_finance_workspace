/**
 * Per-endpoint behaviour/value parity STUBS.
 *
 * P2.2 authors the canonical contract up front (DA-25) and scaffolds — but does
 * NOT implement — a parity test per endpoint. Each `it.todo(...)` below names a
 * concrete value-parity assertion a Stage-4 `BE` branch must fill in once it
 * implements the endpoint in BOTH backends. (Structural OpenAPI conformance is
 * already covered generically in openapi.parity.test.ts once the path is added
 * to IMPLEMENTED_PATHS; these stubs cover SAME-REQUEST -> SAME-BODY behaviour,
 * error/empty/degraded cases, and the Appendix A wire conventions.)
 *
 * How a Stage-4 branch fills a stub:
 *   1. Implement the endpoint in backend-python + backend-ts.
 *   2. Replace the matching `it.todo(name)` with `it(name, async () => { ... })`
 *      that hits the SAME path on `inject('pyBase')` and `inject('tsBase')`
 *      (via getJson from ../src/http) and asserts the two bodies equal each
 *      other AND satisfy Appendix A (money = decimal string, percentages =
 *      number 0-100, datetimes = ...Z, pagination envelope, omit-absent).
 *   3. Add the operation key to IMPLEMENTED_PATHS in src/contract.ts.
 *
 * `it.todo` is reported by vitest as a pending TODO (not a pass, not a fail), so
 * the existing /health parity gate stays GREEN with no backend impl here yet.
 */

import { describe, it } from "vitest";

describe("view endpoints — value parity (TODO: Stage-4 BE branches)", () => {
  // P4.1 — GET /api/v1/transactions
  it.todo(
    "GET /api/v1/transactions: identical paginated bodies; money decimal-string; dates YYYY-MM-DD",
  );
  it.todo(
    "GET /api/v1/transactions: invalid query (limit > 200) -> identical canonical 422 body (DA-1)",
  );
  it.todo(
    "GET /api/v1/transactions: offset past end -> empty data + correct total, identical (DA-4)",
  );
  it.todo(
    "GET /api/v1/transactions: DB unavailable -> identical 503 canonical body (DA-18)",
  );

  // P4.2 — GET /api/v1/budget
  it.todo(
    "GET /api/v1/budget: cross-backend byte-identical body for a seeded DB (DA-9); percentages numeric, money decimal-string",
  );

  // P4.3 — GET /api/v1/networth
  it.todo(
    "GET /api/v1/networth: identical bodies; empty DB -> zeros/empty arrays identical both backends",
  );

  // P4.4 — GET /api/v1/investments
  it.todo(
    "GET /api/v1/investments: identical bodies; concentration/allocation as numeric percentages (Appendix A)",
  );

  // P4.5 — GET /api/v1/debt
  it.todo(
    "GET /api/v1/debt: identical bodies; payoff_strategy/loan_priority enums per registry; avalanche vs minimums",
  );

  // P4.6 — GET /api/v1/goals
  it.todo("GET /api/v1/goals: identical bodies; money decimal-string");
});

describe("source endpoints — value parity (TODO: Stage-4 BE branches)", () => {
  // P6.4 / DA-20 — not-connected behaviour is identical across both backends.
  it.todo(
    "GET /api/v1/sources/transactions: local mode rows identical; api+not-connected -> 200 empty data + source_status=not_connected (DA-20)",
  );
  it.todo(
    "GET /api/v1/sources/income: identical bodies + not-connected parity",
  );
  it.todo(
    "GET /api/v1/sources/holdings: identical bodies + not-connected parity",
  );
  it.todo("GET /api/v1/sources/loans: identical bodies + not-connected parity");
  it.todo(
    "GET /api/v1/sources/listings: identical bodies + not-connected parity",
  );
});

describe("connections endpoints — value parity (TODO: Stage-4 BE branches)", () => {
  // P6.1 — connections lifecycle + webhook.
  it.todo(
    "POST /api/v1/connections/link-token: identical link_token/expiration shape; expiration ISO-8601 Z",
  );
  it.todo(
    "POST /api/v1/connections/exchange: identical {item_id,status}; access_token never returned; encrypted at rest (DA-12)",
  );
  it.todo(
    "GET /api/v1/connections: identical items + per-source mode/status snapshot",
  );
  it.todo(
    "POST /api/v1/connections/webhook: forged/unsigned JWT -> identical 401 canonical body (DA-11); valid -> {status:accepted}",
  );
});
