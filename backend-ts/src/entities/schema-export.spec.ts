import 'reflect-metadata';
import type { ColumnMetadata } from 'typeorm/metadata/ColumnMetadata';

import { ALL_ENTITIES } from './entities';
import { canonicalType, exportSchema, main } from './schema-export';

/**
 * Unit tests for the TypeScript side of the schema-parity check (DA-8).
 *
 * `exportSchema()` builds TypeORM metadata WITHOUT a DB connection and emits the
 * same normalized `{ table: { column: { type, nullable } } }` shape as the
 * Python exporter. The cross-backend deep-equality of the two snapshots is
 * asserted in `contracts/test/schema.parity.test.ts`; here we cover the local
 * type-mapping logic and the snapshot shape.
 */

// Build a minimal fake ColumnMetadata for the pure `canonicalType` mapper.
function fakeColumn(over: Partial<ColumnMetadata>): ColumnMetadata {
  return {
    type: 'text',
    isArray: false,
    precision: undefined,
    scale: undefined,
    length: '',
    databaseName: 'c',
    isNullable: false,
    entityMetadata: { tableName: 't' },
    ...over,
  } as unknown as ColumnMetadata;
}

describe('canonicalType', () => {
  it.each<[Partial<ColumnMetadata>, string]>([
    [{ type: 'bigint' }, 'bigint'],
    [{ type: 'integer' }, 'integer'],
    [{ type: 'int4' }, 'integer'],
    [{ type: 'numeric', precision: 14, scale: 2 }, 'money'],
    [{ type: 'numeric' }, 'percentage'],
    [{ type: 'numeric', precision: 8, scale: 4 }, 'numeric(8,4)'],
    [{ type: 'timestamptz' }, 'timestamptz'],
    [{ type: 'timestamp' }, 'timestamp'],
    [{ type: 'date' }, 'date'],
    [{ type: 'boolean' }, 'boolean'],
    [{ type: 'bytea' }, 'bytea'],
    [{ type: 'text' }, 'text'],
    [{ type: 'varchar', length: '3' }, 'varchar(3)'],
    [{ type: 'varchar', length: '' }, 'text'],
  ])('maps %o -> %s', (over, expected) => {
    expect(canonicalType(fakeColumn(over))).toBe(expected);
  });

  it('appends [] for array columns', () => {
    expect(canonicalType(fakeColumn({ type: 'text', isArray: true }))).toBe(
      'text[]',
    );
  });

  it('throws on an unmapped type', () => {
    expect(() => canonicalType(fakeColumn({ type: 'jsonb' }))).toThrow(
      /Unmapped TypeORM column type/,
    );
  });
});

describe('exportSchema', () => {
  it('emits every entity table with the canonical column types', async () => {
    const snapshot = await exportSchema();

    // All 14 P2.3 tables present.
    expect(Object.keys(snapshot)).toHaveLength(ALL_ENTITIES.length);
    expect(snapshot).toHaveProperty('transactions');
    expect(snapshot).toHaveProperty('plaid_items');

    // Representative type assertions (Appendix A).
    expect(snapshot.transactions.amount).toEqual({
      type: 'money',
      nullable: false,
    });
    expect(snapshot.loans.rate.type).toBe('percentage');
    expect(snapshot.plaid_items.access_token.type).toBe('bytea');
    expect(snapshot.plaid_items.created_at.type).toBe('timestamptz');
    expect(snapshot.plaid_items.products.type).toBe('text[]');
    expect(snapshot.accounts.currency.type).toBe('varchar(3)');
  });

  it('sorts tables and columns deterministically', async () => {
    const snapshot = await exportSchema();
    const tables = Object.keys(snapshot);
    expect(tables).toEqual([...tables].sort());
    for (const cols of Object.values(snapshot)) {
      const names = Object.keys(cols);
      expect(names).toEqual([...names].sort());
    }
  });
});

describe('main', () => {
  it('writes a valid JSON snapshot to stdout', async () => {
    const writes: string[] = [];
    const spy = jest
      .spyOn(process.stdout, 'write')
      .mockImplementation((chunk: string | Uint8Array): boolean => {
        writes.push(chunk.toString());
        return true;
      });
    try {
      await main();
    } finally {
      spy.mockRestore();
    }
    const parsed = JSON.parse(writes.join('')) as Record<string, unknown>;
    expect(parsed).toHaveProperty('transactions');
  });
});
