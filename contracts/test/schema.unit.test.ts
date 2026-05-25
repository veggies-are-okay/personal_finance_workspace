/**
 * Unit tests for the pure schema-diff helpers in `src/schema.ts`.
 *
 * These exercise `normalizeSnapshot` / `diffSchemas` / `schemasMatch` against
 * hand-built (synthetic) snapshots — no backends, no DB, no subprocess. They run
 * under the fast `npm run test:unit` config (no globalSetup) as well as the full
 * parity gate. The subprocess-driven real-schema comparison lives in
 * `schema.parity.test.ts`.
 */

import { describe, expect, it } from "vitest";

import {
  diffSchemas,
  normalizeSnapshot,
  schemasMatch,
  type SchemaSnapshot,
} from "../src/schema";

const base: SchemaSnapshot = {
  accounts: {
    id: { type: "bigint", nullable: false },
    balance: { type: "money", nullable: true },
  },
  loans: {
    rate: { type: "percentage", nullable: false },
  },
};

describe("normalizeSnapshot", () => {
  it("sorts tables and columns deterministically", () => {
    const unsorted: SchemaSnapshot = {
      loans: { rate: { type: "percentage", nullable: false } },
      accounts: {
        balance: { type: "money", nullable: true },
        id: { type: "bigint", nullable: false },
      },
    };
    const out = normalizeSnapshot(unsorted);
    expect(Object.keys(out)).toEqual(["accounts", "loans"]);
    expect(Object.keys(out.accounts)).toEqual(["balance", "id"]);
  });

  it("keeps only type + nullable per column", () => {
    const withExtra = {
      t: { c: { type: "text", nullable: false, junk: 1 } },
    } as unknown as SchemaSnapshot;
    expect(normalizeSnapshot(withExtra)).toEqual({
      t: { c: { type: "text", nullable: false } },
    });
  });
});

describe("diffSchemas + schemasMatch", () => {
  it("reports no drift for identical schemas", () => {
    const diff = diffSchemas(base, structuredClone(base));
    expect(diff.tablesOnlyInPython).toEqual([]);
    expect(diff.tablesOnlyInTypeOrm).toEqual([]);
    expect(diff.columnDiffs).toEqual([]);
    expect(schemasMatch(diff)).toBe(true);
  });

  it("detects a table present only in Python", () => {
    const ts = structuredClone(base);
    delete (ts as Record<string, unknown>).loans;
    const diff = diffSchemas(base, ts);
    expect(diff.tablesOnlyInPython).toEqual(["loans"]);
    expect(schemasMatch(diff)).toBe(false);
  });

  it("detects a table present only in TypeORM", () => {
    const ts = structuredClone(base);
    ts.extra = { id: { type: "bigint", nullable: false } };
    const diff = diffSchemas(base, ts);
    expect(diff.tablesOnlyInTypeOrm).toEqual(["extra"]);
    expect(schemasMatch(diff)).toBe(false);
  });

  it("detects a column type mismatch (money vs percentage)", () => {
    const ts = structuredClone(base);
    ts.accounts.balance.type = "percentage";
    const diff = diffSchemas(base, ts);
    expect(diff.columnDiffs).toHaveLength(1);
    expect(diff.columnDiffs[0]).toContain("accounts.balance");
    expect(diff.columnDiffs[0]).toContain("money");
    expect(diff.columnDiffs[0]).toContain("percentage");
    expect(schemasMatch(diff)).toBe(false);
  });

  it("detects a nullability mismatch", () => {
    const ts = structuredClone(base);
    ts.accounts.balance.nullable = false;
    const diff = diffSchemas(base, ts);
    expect(diff.columnDiffs).toHaveLength(1);
    expect(diff.columnDiffs[0]).toContain("NOT NULL");
    expect(schemasMatch(diff)).toBe(false);
  });

  it("detects a column only on one side", () => {
    const ts = structuredClone(base);
    ts.accounts.currency = { type: "varchar(3)", nullable: false };
    delete ts.accounts.balance;
    const diff = diffSchemas(base, ts);
    expect(diff.columnDiffs.some((d) => d.includes("only in TypeORM"))).toBe(
      true,
    );
    expect(diff.columnDiffs.some((d) => d.includes("only in Python"))).toBe(
      true,
    );
  });
});
