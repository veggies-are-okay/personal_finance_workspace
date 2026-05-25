/**
 * Synthetic-data seeding for parity tests that need a known DB state.
 *
 * The view endpoints read Postgres, so a value-parity test must pin the rows
 * both backends see. This helper inserts a tiny SYNTHETIC fixture (made-up
 * accounts + transactions — never real financial data, per data-privacy.md) and
 * cleans it up afterwards, keyed by a unique `dedupe_key`/id prefix so it never
 * collides with other data.
 *
 * Uses the same `DATABASE_URL` the backends use (the local docker-compose DB,
 * also the CI Postgres service). The schema is created by `alembic upgrade head`
 * before the parity job runs.
 */

import { Client } from "pg";

const DEFAULT_DATABASE_URL =
  "postgresql://pf:pf@localhost:5432/personal_finance";

/** A synthetic transaction row mirrored across both backends. */
export interface SeedTransaction {
  accountId: number;
  date: string; // YYYY-MM-DD
  description: string;
  amount: string; // decimal string
  dedupeKey: string;
  category: string | null;
  bucket: string | null;
  isRecurring: boolean;
}

/** The fixed synthetic fixture both backends serve in the success parity test. */
export const SEED_ACCOUNTS = [
  { id: 990001, name: "Checking", type: "depository" },
  { id: 990002, name: "Credit Card", type: "credit" },
];

export const SEED_TRANSACTIONS: SeedTransaction[] = [
  {
    accountId: 990001,
    date: "2026-05-20",
    description: "Coffee Shop",
    amount: "-4.75",
    dedupeKey: "parity-p41-1",
    category: "dining",
    bucket: "wants",
    isRecurring: false,
  },
  {
    accountId: 990001,
    date: "2026-05-15",
    description: "Paycheck",
    amount: "3100.00",
    dedupeKey: "parity-p41-2",
    category: null, // uncategorized -> category/bucket omitted on the wire
    bucket: null,
    isRecurring: false,
  },
  {
    accountId: 990002,
    date: "2026-05-10",
    description: "Streaming Co",
    amount: "-15.99",
    dedupeKey: "parity-p41-3",
    category: "entertainment",
    bucket: "wants",
    isRecurring: true,
  },
];

function databaseUrl(): string {
  return process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
}

/** Run a callback with a connected pg client, always closing it. */
async function withClient<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: databaseUrl() });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/** Remove any rows this fixture owns (idempotent; safe to call before+after). */
export async function cleanupTransactionsFixture(): Promise<void> {
  await withClient(async (client) => {
    await client.query(
      "DELETE FROM transactions WHERE dedupe_key LIKE 'parity-p41-%'",
    );
    await client.query("DELETE FROM accounts WHERE id = ANY($1::bigint[])", [
      SEED_ACCOUNTS.map((a) => a.id),
    ]);
  });
}

/** Insert the synthetic accounts + transactions fixture (cleans first). */
export async function seedTransactionsFixture(): Promise<void> {
  await cleanupTransactionsFixture();
  await withClient(async (client) => {
    for (const a of SEED_ACCOUNTS) {
      await client.query(
        "INSERT INTO accounts (id, name, type) VALUES ($1, $2, $3)",
        [a.id, a.name, a.type],
      );
    }
    for (const t of SEED_TRANSACTIONS) {
      await client.query(
        `INSERT INTO transactions
           (account_id, date, description, amount, dedupe_key, category, bucket, is_transfer, is_recurring)
         VALUES ($1, $2, $3, $4, $5, $6, $7, false, $8)`,
        [
          t.accountId,
          t.date,
          t.description,
          t.amount,
          t.dedupeKey,
          t.category,
          t.bucket,
          t.isRecurring,
        ],
      );
    }
  });
}

// --- Budget fixture (P4.2) -------------------------------------------------
//
// The Budget view reads the PRECOMPUTED aggregate tables (DA-23), so the
// cross-backend identity test (DA-9) pins those rows. A unique `window`
// selector keeps the fixture isolated, and recurring rows carry a unique
// `merchant` prefix so cleanup never touches other data. Rows are deliberately
// inserted out of canonical order to prove both backends sort identically.

/** The dedicated synthetic window both backends serve in the budget parity test. */
export const BUDGET_WINDOW = "parity-p42";
const RECURRING_PREFIX = "ParityP42 ";

/** Remove any rows this fixture owns (idempotent; safe to call before+after). */
export async function cleanupBudgetFixture(): Promise<void> {
  await withClient(async (client) => {
    // `window` is a reserved word in Postgres -> quote the identifier.
    await client.query('DELETE FROM budget_aggregates WHERE "window" = $1', [
      BUDGET_WINDOW,
    ]);
    await client.query(
      'DELETE FROM budget_bucket_aggregates WHERE "window" = $1',
      [BUDGET_WINDOW],
    );
    await client.query(
      'DELETE FROM budget_category_aggregates WHERE "window" = $1',
      [BUDGET_WINDOW],
    );
    await client.query(
      'DELETE FROM budget_monthly_aggregates WHERE "window" = $1',
      [BUDGET_WINDOW],
    );
    await client.query("DELETE FROM recurring_charges WHERE merchant LIKE $1", [
      `${RECURRING_PREFIX}%`,
    ]);
  });
}

/** Insert the synthetic budget aggregate fixture (cleans first). */
export async function seedBudgetFixture(): Promise<void> {
  await cleanupBudgetFixture();
  await withClient(async (client) => {
    await client.query(
      `INSERT INTO budget_aggregates ("window", savings_rate, effective_tax_rate)
       VALUES ($1, $2, $3)`,
      [BUDGET_WINDOW, "22.0", "18.5"],
    );
    // Out-of-order (savings, needs, wants) -> both backends must emit 50/30/20.
    for (const b of [
      { name: "savings", target: "20.0", actual: "22.0", amount: "1100.00" },
      { name: "needs", target: "50.0", actual: "48.0", amount: "2400.00" },
      { name: "wants", target: "30.0", actual: "30.0", amount: "1500.00" },
    ]) {
      await client.query(
        `INSERT INTO budget_bucket_aggregates
           ("window", name, target_pct, actual_pct, amount)
         VALUES ($1, $2, $3, $4, $5)`,
        [BUDGET_WINDOW, b.name, b.target, b.actual, b.amount],
      );
    }
    // Out-of-order categories (rent, groceries) -> both must sort by name.
    for (const c of [
      { name: "rent", amount: "1800.00", bucket: "needs" },
      { name: "groceries", amount: "420.00", bucket: "needs" },
    ]) {
      await client.query(
        `INSERT INTO budget_category_aggregates ("window", name, amount, bucket)
         VALUES ($1, $2, $3, $4)`,
        [BUDGET_WINDOW, c.name, c.amount, c.bucket],
      );
    }
    // Out-of-order months (March, February) -> both must sort by month.
    for (const m of [
      { month: "2026-03", needs: "2400.00", wants: "1500.00" },
      { month: "2026-02", needs: "2350.00", wants: "1480.00" },
    ]) {
      await client.query(
        `INSERT INTO budget_monthly_aggregates ("window", month, needs, wants)
         VALUES ($1, $2, $3, $4)`,
        [BUDGET_WINDOW, m.month, m.needs, m.wants],
      );
    }
    // Out-of-order merchants (Streaming, Cloud) -> both must sort by merchant.
    for (const r of [
      {
        merchant: `${RECURRING_PREFIX}Streaming Co`,
        category: "entertainment",
        cadence: "monthly",
        last: "2026-05-01",
        est: "15.99",
      },
      {
        merchant: `${RECURRING_PREFIX}Cloud Backup`,
        category: "software",
        cadence: "monthly",
        last: "2026-05-03",
        est: "9.00",
      },
    ]) {
      await client.query(
        `INSERT INTO recurring_charges
           (merchant, category, cadence, last_charged, monthly_est)
         VALUES ($1, $2, $3, $4, $5)`,
        [r.merchant, r.category, r.cadence, r.last, r.est],
      );
    }
  });
}
