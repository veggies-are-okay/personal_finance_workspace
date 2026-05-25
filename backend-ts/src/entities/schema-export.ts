/**
 * Export the TypeORM entity schema as a normalized JSON snapshot.
 *
 * This is the **TypeScript side of the schema-parity check** (DA-8). It builds
 * the TypeORM metadata for every entity WITHOUT connecting to a database
 * (`DataSource.buildMetadatas()` — no `initialize()`, so it runs in CI with no
 * Postgres) and emits the SAME language-neutral
 * `{ table: { column: { type, nullable } } }` map that
 * `backend-python/app/schema_export.py` produces from the Alembic-owned schema.
 *
 * A `contracts/` test deep-compares the two snapshots so the entities and the
 * Alembic head can never drift on tables, columns, or column types (money /
 * datetime / enum / token included).
 *
 * Canonical type tokens (must match schema_export.py):
 *   bigint · integer · text · varchar(N) · money · percentage · date ·
 *   timestamptz · timestamp · boolean · bytea · text[]
 */

import 'reflect-metadata';
import { DataSource } from 'typeorm';
import type { ColumnMetadata } from 'typeorm/metadata/ColumnMetadata';

import { ALL_ENTITIES } from './entities';

type ColumnSnapshot = { type: string; nullable: boolean };
type TableSnapshot = Record<string, ColumnSnapshot>;
export type SchemaSnapshot = Record<string, TableSnapshot>;

/** Reduce a TypeORM column's metadata to a cross-language canonical token. */
export function canonicalType(column: ColumnMetadata): string {
  const base = canonicalScalar(column);
  return column.isArray ? `${base}[]` : base;
}

function canonicalScalar(column: ColumnMetadata): string {
  // `column.type` is the normalized TypeORM/Postgres type (string or ctor).
  const raw = typeof column.type === 'string' ? column.type : column.type.name;
  const type = raw.toLowerCase();

  switch (type) {
    case 'bigint':
      return 'bigint';
    case 'integer':
    case 'int':
    case 'int4':
      return 'integer';
    case 'numeric':
    case 'decimal': {
      // numeric(14,2) is money; bare numeric (no precision) is a percentage.
      if (column.precision === 14 && column.scale === 2) return 'money';
      if (column.precision === undefined && column.scale === undefined) {
        return 'percentage';
      }
      return `numeric(${column.precision},${column.scale})`;
    }
    case 'timestamptz':
    case 'timestamp with time zone':
      return 'timestamptz';
    case 'timestamp':
    case 'timestamp without time zone':
      return 'timestamp';
    case 'date':
      return 'date';
    case 'boolean':
    case 'bool':
      return 'boolean';
    case 'bytea':
      return 'bytea';
    case 'text':
      return 'text';
    case 'varchar':
    case 'character varying':
      return column.length ? `varchar(${column.length})` : 'text';
    default:
      throw new Error(
        `Unmapped TypeORM column type "${raw}" on ${column.entityMetadata.tableName}.${column.databaseName}`,
      );
  }
}

/** Build entity metadata (no DB connection) and return the normalized snapshot. */
export async function exportSchema(): Promise<SchemaSnapshot> {
  // type: 'postgres' so types normalize to the Postgres dialect; no host/port
  // is contacted because we never call initialize().
  const dataSource = new DataSource({
    type: 'postgres',
    entities: ALL_ENTITIES,
    synchronize: false,
  });
  // Build metadata for all entities WITHOUT opening a connection. `initialize()`
  // would connect to Postgres; `buildMetadatas()` only constructs the in-memory
  // EntityMetadata graph (it is `protected` + async, hence the cast + await).
  // This keeps the exporter hermetic — it runs in CI with no database.
  await (
    dataSource as unknown as { buildMetadatas: () => Promise<void> }
  ).buildMetadatas();

  const snapshot: SchemaSnapshot = {};
  for (const meta of dataSource.entityMetadatas) {
    const columns: TableSnapshot = {};
    for (const column of meta.columns) {
      columns[column.databaseName] = {
        type: canonicalType(column),
        nullable: column.isNullable,
      };
    }
    // Sort keys so the JSON is stable/diffable.
    snapshot[meta.tableName] = Object.fromEntries(
      Object.entries(columns).sort(([a], [b]) => a.localeCompare(b)),
    );
  }
  // Sort tables too.
  return Object.fromEntries(
    Object.entries(snapshot).sort(([a], [b]) => a.localeCompare(b)),
  );
}

/** Print the normalized schema snapshot as JSON to stdout (the parity harness
 * shells out to this). Exported so it can be unit-tested. */
export async function main(): Promise<void> {
  const snapshot = await exportSchema();
  process.stdout.write(JSON.stringify(snapshot, null, 2) + '\n');
}

// Run as a script: `node dist/entities/schema-export.js` (the parity harness
// shells out to this). `require.main === module` is the CJS entry guard Nest
// builds to.
if (require.main === module) {
  void main();
}
