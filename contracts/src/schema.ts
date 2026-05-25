/**
 * Schema-parity helpers (P2.3 / DA-8).
 *
 * The Alembic head (backend-python) is the CANONICAL Postgres schema; the
 * TypeORM entities (backend-ts) only MIRROR it (`synchronize: false`). To prove
 * they never drift, each backend exports a language-neutral schema snapshot:
 *
 *   - Python: `python -m app.schema_export` walks `Base.metadata`.
 *   - TS:     `node dist/entities/schema-export.js` builds TypeORM metadata
 *             WITHOUT a DB connection.
 *
 * Both emit the SAME JSON shape: `{ table: { column: { type, nullable } } }`,
 * where `type` is a canonical cross-language token (money / percentage / text /
 * timestamptz / date / boolean / bytea / bigint / text[] / varchar(N) ...). This
 * module shells out to both and parses their JSON; the test deep-compares them.
 *
 * Neither exporter touches a database, so this runs hermetically in CI.
 */

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
/** contracts/src -> repo root is two levels up. */
const REPO_ROOT = resolve(HERE, "..", "..");

export interface ColumnSnapshot {
  type: string;
  nullable: boolean;
}
export type TableSnapshot = Record<string, ColumnSnapshot>;
export type SchemaSnapshot = Record<string, TableSnapshot>;

/** Run the Python exporter (from backend-python/) and parse its JSON snapshot. */
export function exportPythonSchema(): SchemaSnapshot {
  const out = execFileSync("uv", ["run", "python", "-m", "app.schema_export"], {
    cwd: resolve(REPO_ROOT, "backend-python"),
    encoding: "utf8",
    env: { ...process.env },
  });
  return JSON.parse(out) as SchemaSnapshot;
}

/** Run the TypeORM exporter (built JS) and parse its JSON snapshot. */
export function exportTypeOrmSchema(): SchemaSnapshot {
  const script = resolve(
    REPO_ROOT,
    "backend-ts",
    "dist",
    "entities",
    "schema-export.js",
  );
  const out = execFileSync("node", [script], {
    cwd: resolve(REPO_ROOT, "backend-ts"),
    encoding: "utf8",
    env: { ...process.env },
  });
  return JSON.parse(out) as SchemaSnapshot;
}

/** Stable, sorted re-serialization so two snapshots compare key-order-independent. */
export function normalizeSnapshot(snapshot: SchemaSnapshot): SchemaSnapshot {
  const tables: SchemaSnapshot = {};
  for (const table of Object.keys(snapshot).sort()) {
    const cols: TableSnapshot = {};
    for (const col of Object.keys(snapshot[table]).sort()) {
      const c = snapshot[table][col];
      cols[col] = { type: c.type, nullable: c.nullable };
    }
    tables[table] = cols;
  }
  return tables;
}

/** A single drift finding between the two schema snapshots. */
export interface SchemaDiff {
  tablesOnlyInPython: string[];
  tablesOnlyInTypeOrm: string[];
  columnDiffs: string[];
}

/** Compute the structural drift between the canonical (py) and mirror (ts) schemas. */
export function diffSchemas(
  python: SchemaSnapshot,
  typeorm: SchemaSnapshot,
): SchemaDiff {
  const py = normalizeSnapshot(python);
  const ts = normalizeSnapshot(typeorm);

  const pyTables = new Set(Object.keys(py));
  const tsTables = new Set(Object.keys(ts));

  const tablesOnlyInPython = [...pyTables].filter((t) => !tsTables.has(t));
  const tablesOnlyInTypeOrm = [...tsTables].filter((t) => !pyTables.has(t));

  const columnDiffs: string[] = [];
  for (const table of [...pyTables].filter((t) => tsTables.has(t)).sort()) {
    const pyCols = py[table];
    const tsCols = ts[table];
    const allCols = new Set([...Object.keys(pyCols), ...Object.keys(tsCols)]);
    for (const col of [...allCols].sort()) {
      const a = pyCols[col];
      const b = tsCols[col];
      if (!a) {
        columnDiffs.push(`${table}.${col}: only in TypeORM (${fmt(b)})`);
      } else if (!b) {
        columnDiffs.push(`${table}.${col}: only in Python (${fmt(a)})`);
      } else if (a.type !== b.type || a.nullable !== b.nullable) {
        columnDiffs.push(`${table}.${col}: python=${fmt(a)} typeorm=${fmt(b)}`);
      }
    }
  }

  return { tablesOnlyInPython, tablesOnlyInTypeOrm, columnDiffs };
}

function fmt(c: ColumnSnapshot): string {
  return `${c.type}${c.nullable ? " NULL" : " NOT NULL"}`;
}

/** True when the two schemas are identical (tables + columns + types + nullability). */
export function schemasMatch(diff: SchemaDiff): boolean {
  return (
    diff.tablesOnlyInPython.length === 0 &&
    diff.tablesOnlyInTypeOrm.length === 0 &&
    diff.columnDiffs.length === 0
  );
}
