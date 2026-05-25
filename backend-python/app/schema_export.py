"""Export the canonical (Alembic-owned) schema as a normalized JSON snapshot.

This is the **Python side of the schema-parity check** (DA-8): it walks
``Base.metadata`` (populated by importing ``app.models``) and emits a
language-neutral ``{table: {column: {type, nullable}}}`` map. The TypeORM
entities in ``backend-ts`` emit the *same* normalized shape; a ``contracts/``
test deep-compares the two so the two backends can never drift on tables,
columns, or column types (money / datetime / enum / token included).

Column types are reduced to a small set of **canonical tokens** that are
meaningful across both Postgres-via-SQLAlchemy and Postgres-via-TypeORM:

* ``bigint``                 — 64-bit integer PK / FK
* ``text``                   — unbounded string (enums are text + CHECK)
* ``varchar(N)``             — bounded string
* ``money``                  — ``NUMERIC(14, 2)`` (decimal-string on the wire)
* ``percentage``             — bare ``NUMERIC`` (a number 0-100 on the wire)
* ``date``                   — calendar date
* ``timestamptz``            — timezone-aware datetime
* ``boolean``                — boolean
* ``bytea``                  — binary (encrypted Plaid token ciphertext)
* ``text[]``                 — text array (Plaid ``products``)

Run as a script to print the JSON snapshot to stdout (the parity harness shells
out to this): ``python -m app.schema_export``.
"""

from __future__ import annotations

import json
from typing import Any

from sqlalchemy import (
    ARRAY,
    BigInteger,
    Boolean,
    Date,
    DateTime,
    Integer,
    LargeBinary,
    Numeric,
    String,
    Text,
)
from sqlalchemy.sql.schema import Column

from app.db import Base

# Import the models so their tables register on ``Base.metadata``. The import is
# side-effecting; keep it after Base to avoid a circular import surprise.
import app.models  # noqa: F401,E402


def canonical_type(column: Column[Any]) -> str:
    """Reduce a SQLAlchemy column type to a cross-language canonical token."""
    coltype = column.type

    if isinstance(coltype, ARRAY):
        return f"{canonical_scalar(coltype.item_type)}[]"
    return canonical_scalar(coltype)


def canonical_scalar(coltype: Any) -> str:
    """Canonical token for a non-array (scalar) SQLAlchemy type."""
    # Order matters: BigInteger is an Integer subclass, so test it first.
    if isinstance(coltype, BigInteger):
        return "bigint"
    if isinstance(coltype, Integer):
        return "integer"
    if isinstance(coltype, Numeric):
        # NUMERIC(14, 2) is money; bare NUMERIC (no precision) is a percentage.
        if coltype.precision == 14 and coltype.scale == 2:
            return "money"
        if coltype.precision is None and coltype.scale is None:
            return "percentage"
        return f"numeric({coltype.precision},{coltype.scale})"
    if isinstance(coltype, DateTime):
        return "timestamptz" if coltype.timezone else "timestamp"
    if isinstance(coltype, Date):
        return "date"
    if isinstance(coltype, Boolean):
        return "boolean"
    if isinstance(coltype, LargeBinary):
        return "bytea"
    # Text is a String subclass with no length; a bounded String -> varchar(N).
    if isinstance(coltype, Text):
        return "text"
    if isinstance(coltype, String):
        return f"varchar({coltype.length})" if coltype.length is not None else "text"
    raise ValueError(f"Unmapped column type: {coltype!r}")


def export_schema() -> dict[str, dict[str, dict[str, Any]]]:
    """Return ``{table: {column: {"type", "nullable"}}}`` for every model table."""
    snapshot: dict[str, dict[str, dict[str, Any]]] = {}
    for table_name in sorted(Base.metadata.tables):
        table = Base.metadata.tables[table_name]
        columns: dict[str, dict[str, Any]] = {}
        for column in table.columns:
            columns[column.name] = {
                "type": canonical_type(column),
                "nullable": bool(column.nullable),
            }
        snapshot[table_name] = columns
    return snapshot


def main() -> None:
    """Print the normalized schema snapshot as JSON to stdout."""
    print(json.dumps(export_schema(), indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
