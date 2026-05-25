/**
 * Schema-parity gate (P2.3 / DA-8).
 *
 * Asserts the Alembic-owned canonical schema (backend-python) and the TypeORM
 * entity mirror (backend-ts, `synchronize: false`) are IDENTICAL — same tables,
 * same columns, same canonical column types and nullability — by running each
 * backend's schema exporter and deep-comparing the two JSON snapshots.
 *
 * Runs under `npm run test:parity` alongside the `/health` response/OpenAPI
 * parity checks. Both exporters are hermetic (no DB connection), and the
 * `pretest:parity` step already `uv sync`s and `nest build`s both backends, so
 * the Python module and the built TS script exist when this runs.
 *
 * This is the check P2.3's Verify requires to pass.
 */

import { describe, expect, it } from "vitest";

import {
  diffSchemas,
  exportPythonSchema,
  exportTypeOrmSchema,
  normalizeSnapshot,
  schemasMatch,
  type SchemaSnapshot,
} from "../src/schema";

// Every table P2.3 defines (covers DA-23 budget precompute + DA-12 token store)
// plus the P3.2 `paystubs` income table that feeds precompute.
const EXPECTED_TABLES = [
  "accounts",
  "budget_aggregates",
  "budget_bucket_aggregates",
  "budget_category_aggregates",
  "budget_monthly_aggregates",
  "budgets",
  "categories",
  "goals",
  "holdings",
  "loans",
  "paystubs",
  "plaid_items",
  "recurring_charges",
  "source_config",
  "transactions",
].sort();

describe("schema parity: Alembic head <-> TypeORM entities (DA-8)", () => {
  // Export once; reuse across assertions.
  const python: SchemaSnapshot = normalizeSnapshot(exportPythonSchema());
  const typeorm: SchemaSnapshot = normalizeSnapshot(exportTypeOrmSchema());

  it("both backends declare exactly the same set of tables", () => {
    expect(Object.keys(python).sort()).toEqual(EXPECTED_TABLES);
    expect(Object.keys(typeorm).sort()).toEqual(EXPECTED_TABLES);
  });

  it("the two schema snapshots are byte-identical (no drift)", () => {
    const diff = diffSchemas(python, typeorm);
    // Surface any drift in the failure message before the boolean assertion.
    expect(diff.tablesOnlyInPython).toEqual([]);
    expect(diff.tablesOnlyInTypeOrm).toEqual([]);
    expect(diff.columnDiffs).toEqual([]);
    expect(schemasMatch(diff)).toBe(true);
    // The deep-equality is the strongest single assertion.
    expect(typeorm).toEqual(python);
  });

  it("money columns are NUMERIC(14,2) in BOTH backends (Appendix A)", () => {
    expect(python.transactions.amount.type).toBe("money");
    expect(typeorm.transactions.amount.type).toBe("money");
    expect(python.loans.balance.type).toBe("money");
    expect(typeorm.loans.balance.type).toBe("money");
  });

  it("percentages are bare NUMERIC, distinct from money (DA-22)", () => {
    expect(python.budget_aggregates.savings_rate.type).toBe("percentage");
    expect(typeorm.budget_aggregates.savings_rate.type).toBe("percentage");
    expect(python.loans.rate.type).toBe("percentage");
    expect(typeorm.loans.rate.type).toBe("percentage");
  });

  it("the Plaid access_token column is BYTEA in BOTH backends (DA-12)", () => {
    expect(python.plaid_items.access_token.type).toBe("bytea");
    expect(typeorm.plaid_items.access_token.type).toBe("bytea");
    // And there is no plaintext token column.
    expect(python.plaid_items).not.toHaveProperty("access_token_plaintext");
    expect(typeorm.plaid_items).not.toHaveProperty("access_token_plaintext");
  });

  it("timestamp columns are timestamptz in BOTH backends (Appendix A)", () => {
    expect(python.plaid_items.created_at.type).toBe("timestamptz");
    expect(typeorm.plaid_items.created_at.type).toBe("timestamptz");
    expect(python.plaid_items.updated_at.type).toBe("timestamptz");
    expect(typeorm.plaid_items.updated_at.type).toBe("timestamptz");
  });

  it("the products column is a text array in BOTH backends", () => {
    expect(python.plaid_items.products.type).toBe("text[]");
    expect(typeorm.plaid_items.products.type).toBe("text[]");
  });

  it("the paystubs income table is identical in BOTH backends (P3.2)", () => {
    // The precompute income source: money inputs + Date pay/period columns.
    for (const col of ["gross_pay", "net_pay", "taxes", "deductions"]) {
      expect(python.paystubs[col].type).toBe("money");
      expect(typeorm.paystubs[col].type).toBe("money");
    }
    expect(python.paystubs.retirement_401k_employee.type).toBe("money");
    expect(typeorm.paystubs.retirement_401k_employer.type).toBe("money");
    for (const col of ["period_start", "period_end", "pay_date"]) {
      expect(python.paystubs[col].type).toBe("date");
      expect(typeorm.paystubs[col].type).toBe("date");
    }
  });

  it("budget_aggregates + recurring_charges cover every /budget field (DA-23)", () => {
    // Scalars.
    expect(python.budget_aggregates).toHaveProperty("savings_rate");
    expect(python.budget_aggregates).toHaveProperty("effective_tax_rate");
    // Per-bucket target/actual/amount.
    for (const col of ["target_pct", "actual_pct", "amount", "name"]) {
      expect(python.budget_bucket_aggregates).toHaveProperty(col);
      expect(typeorm.budget_bucket_aggregates).toHaveProperty(col);
    }
    // Per-category amount + bucket.
    for (const col of ["name", "amount", "bucket"]) {
      expect(python.budget_category_aggregates).toHaveProperty(col);
    }
    // Monthly needs/wants.
    for (const col of ["month", "needs", "wants"]) {
      expect(python.budget_monthly_aggregates).toHaveProperty(col);
    }
    // Recurring rows.
    for (const col of [
      "merchant",
      "category",
      "cadence",
      "last_charged",
      "monthly_est",
    ]) {
      expect(python.recurring_charges).toHaveProperty(col);
      expect(typeorm.recurring_charges).toHaveProperty(col);
    }
  });
});
