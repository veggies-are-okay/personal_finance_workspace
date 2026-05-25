"""Tests for the schema exporter (the Python side of the parity check, DA-8)."""

from __future__ import annotations

import json

import pytest
from sqlalchemy import (
    ARRAY,
    BigInteger,
    Boolean,
    Column,
    Date,
    DateTime,
    Integer,
    LargeBinary,
    Numeric,
    String,
    Text,
)

from app.schema_export import canonical_scalar, canonical_type, export_schema, main


def _col(coltype: object) -> Column:
    """A detached Column carrying ``coltype`` (no table needed for type tests)."""
    return Column("c", coltype)  # type: ignore[arg-type]


@pytest.mark.parametrize(
    ("coltype", "expected"),
    [
        (BigInteger(), "bigint"),
        (Integer(), "integer"),
        (Numeric(14, 2), "money"),
        (Numeric(), "percentage"),
        (Numeric(8, 4), "numeric(8,4)"),
        (DateTime(timezone=True), "timestamptz"),
        (DateTime(timezone=False), "timestamp"),
        (Date(), "date"),
        (Boolean(), "boolean"),
        (LargeBinary(), "bytea"),
        (Text(), "text"),
        (String(3), "varchar(3)"),
        (String(), "text"),
    ],
)
def test_canonical_scalar_tokens(coltype: object, expected: str) -> None:
    assert canonical_scalar(coltype) == expected


def test_canonical_type_handles_arrays() -> None:
    assert canonical_type(_col(ARRAY(Text))) == "text[]"


def test_canonical_scalar_rejects_unmapped_type() -> None:
    class Weird:
        pass

    with pytest.raises(ValueError, match="Unmapped column type"):
        canonical_scalar(Weird())


def test_export_schema_shape_and_known_columns() -> None:
    snapshot = export_schema()
    # Every table maps to {column: {type, nullable}}.
    assert "transactions" in snapshot
    amount = snapshot["transactions"]["amount"]
    assert amount == {"type": "money", "nullable": False}
    assert snapshot["plaid_items"]["access_token"] == {
        "type": "bytea",
        "nullable": False,
    }
    assert snapshot["plaid_items"]["products"]["type"] == "text[]"
    assert snapshot["budget_aggregates"]["savings_rate"]["type"] == "percentage"


def test_export_schema_is_sorted() -> None:
    snapshot = export_schema()
    assert list(snapshot.keys()) == sorted(snapshot.keys())


def test_main_prints_valid_json(capsys: pytest.CaptureFixture[str]) -> None:
    main()
    out = capsys.readouterr().out
    parsed = json.loads(out)
    assert "transactions" in parsed
