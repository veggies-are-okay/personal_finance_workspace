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
