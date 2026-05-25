"""Ingest API router (P8.1) — **Python-only** upload/extract/load surface.

Ingestion is Python-owned and intentionally OUT of the 1:1 read-parity contract
(it depends on pdfplumber/PyYAML/pandas, analogous to Alembic owning
migrations). The NestJS backend does NOT implement these routes and the parity
harness ignores ``/api/v1/ingest/*`` — see ``.claude/rules/backend-parity.md``.

Route: ``POST /api/v1/ingest/{source}`` (multipart ``UploadFile``), where
``source`` is one of ``transactions | income | holdings | accounts | loans``.
Each upload flows raw files through the existing extractors + loaders into the
shared Postgres, then re-runs precompute for the windows the dashboards read.

* **transactions** — one or more mixed bank CSVs + Chase PDFs. Each file's type
  is detected (CSV header signature -> amex/chase/checking/elan; ``.pdf`` ->
  Chase extractor), normalized to the signed-amount ledger, upserted via
  ``load_ledger``, then precompute re-runs for ``12m`` + ``all``.
* **income** — paystub PDF(s) (extracted) or a ``paystubs.csv`` -> ``load_paystubs``
  -> precompute.
* **holdings** — an E*TRADE positions CSV -> holdings snapshot replace.
* **accounts** — an ``accounts.yaml`` -> accounts snapshot replace.
* **loans** — a flexible loan CSV -> loans snapshot replace.

Errors use the canonical envelope: no/empty/unparseable file or unknown source
-> **422**; a DB/connectivity failure -> **503**. File **contents are never
logged** (data-privacy): only filenames, detected types, and row counts.
"""

from __future__ import annotations

from enum import Enum
from typing import Annotated

from fastapi import APIRouter, Depends, File, UploadFile
from fastapi.exceptions import RequestValidationError
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.db import get_db
from app.errors import ServiceUnavailableError
from app.ingestion import (
    accounts_loader,
    extract_chase,
    extract_paystubs,
    holdings_loader,
    income_loader,
    loans_loader,
    normalize_ledger,
)
from app.ingestion.loader import LedgerRow, load_ledger
from app.ingestion.schemas import IngestedFile, IngestSummary
from app.precompute.pipeline import run_precompute

router = APIRouter(prefix="/api/v1/ingest", tags=["ingest"])

# Reject absurdly large uploads early (defense-in-depth; the proxy also caps).
MAX_FILE_BYTES = 25 * 1024 * 1024  # 25 MiB per file

# Windows the dashboards read; re-run after a transactions/income import.
_PRECOMPUTE_WINDOWS = ("12m", "all")


class IngestSource(str, Enum):
    """The ingest sources (path param). An unknown value -> canonical 422."""

    transactions = "transactions"
    income = "income"
    holdings = "holdings"
    accounts = "accounts"
    loans = "loans"


def _validation_error(field: str, message: str) -> RequestValidationError:
    """Build a canonical-422 error (routed through the global handler, DA-1)."""
    return RequestValidationError([{"loc": ("body", field), "msg": message, "type": "value_error"}])


def _read(upload: UploadFile) -> bytes:
    """Read an upload fully, enforcing the size cap (-> 422 if too large)."""
    data = upload.file.read()
    if len(data) > MAX_FILE_BYTES:
        raise _validation_error("file", f"File exceeds the {MAX_FILE_BYTES}-byte limit.")
    return data


def _require_files(files: list[UploadFile] | None) -> list[UploadFile]:
    """Ensure at least one non-empty file was uploaded (-> 422 otherwise)."""
    present = [f for f in (files or []) if f is not None and f.filename]
    if not present:
        raise _validation_error("file", "At least one file is required.")
    return present


def _decode(data: bytes) -> str:
    """Decode upload bytes as UTF-8 text (tolerant of a BOM / bad bytes)."""
    return data.decode("utf-8-sig", errors="replace")


# --- bank-file type detection (transactions source) --------------------------


# Header-cell signatures that uniquely identify each CSV source. The detector
# normalizes the header line then matches on the columns each exporter prints.
def detect_csv_type(text: str) -> str | None:
    """Detect a bank CSV's source from its header line.

    Returns ``"amex" | "chase" | "checking" | "elan"`` or ``None`` if the header
    matches no known source. ``checking`` has metadata lines before the real
    header, so we scan the first several lines for the header signature.
    """
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    for line in lines[:6]:
        lower = line.lower()
        # Chase extractor output: "Date of Transaction,Merchant...,Amount".
        if "date of transaction" in lower and "amount" in lower:
            return "chase"
        # Checking: has both a debit and a credit column.
        if "amount debit" in lower and "amount credit" in lower:
            return "checking"
        # Elan: Date,Transaction,Name,Memo,Amount (has a Transaction + Memo col).
        if lower.startswith("date,") and "transaction" in lower and "memo" in lower:
            return "elan"
        # Amex: Date,Description,Amount (and not one of the more specific ones).
        if lower.startswith("date,") and "description" in lower and "amount" in lower:
            return "amex"
    return None


# Map a detected CSV type to (normalizer, source label). The normalizers parse a
# file PATH, so the route writes each upload to a temp file before normalizing.
_CSV_NORMALIZERS = {
    "amex": normalize_ledger.normalize_amex,
    "chase": normalize_ledger.normalize_chase,
    "checking": normalize_ledger.normalize_checking,
    "elan": normalize_ledger.normalize_elan,
}


def _normalize_csv(detected: str, data: bytes) -> list[LedgerRow]:
    """Normalize a bank CSV (by detected type) into loader-ready ledger rows."""
    import tempfile
    from pathlib import Path

    normalize = _CSV_NORMALIZERS[detected]
    with tempfile.NamedTemporaryFile("wb", suffix=".csv", delete=True) as tmp:
        tmp.write(data)
        tmp.flush()
        entries = normalize(Path(tmp.name))
    return [
        LedgerRow(account=e.source, date=e.date, description=e.description, amount=e.amount)
        for e in entries
    ]


def _extract_chase_pdf(data: bytes) -> list[LedgerRow]:
    """Extract Chase purchases from a PDF upload into ledger rows."""
    import tempfile
    from pathlib import Path

    with tempfile.NamedTemporaryFile("wb", suffix=".pdf", delete=True) as tmp:
        tmp.write(data)
        tmp.flush()
        txns, _summary = extract_chase.parse_statement(Path(tmp.name))
    # Chase PDF purchases are raw-positive money-out; negate to the signed ledger.
    return [
        LedgerRow(account="chase", date=t.date, description=t.description, amount=-t.amount)
        for t in txns
    ]


def _ingest_transactions(
    db: Session, files: list[UploadFile]
) -> tuple[list[IngestedFile], list[LedgerRow]]:
    """Detect + normalize every transaction file into one batch of ledger rows."""
    per_file: list[IngestedFile] = []
    batch: list[LedgerRow] = []
    for upload in files:
        data = _read(upload)
        name = upload.filename or ""
        if name.lower().endswith(".pdf"):
            rows = _extract_chase_pdf(data)
            detected = "chase_pdf"
        else:
            detected = detect_csv_type(_decode(data))
            if detected is None:
                raise _validation_error(
                    "file", f"Could not detect a known bank format for {name!r}."
                )
            rows = _normalize_csv(detected, data)
        batch.extend(rows)
        per_file.append(IngestedFile(filename=name, detected_type=detected, rows=len(rows)))
    return per_file, batch


def _run_precompute_windows(db: Session) -> None:
    """Re-run precompute for every dashboard window after a load."""
    for window in _PRECOMPUTE_WINDOWS:
        run_precompute(db, window=window)


@router.post(
    "/{source}",
    response_model=IngestSummary,
    summary="Upload raw financial files for a source; extract, load, recompute.",
)
def ingest(
    source: IngestSource,
    db: Annotated[Session, Depends(get_db)],
    file: Annotated[
        list[UploadFile] | None, File(description="One or more files to ingest.")
    ] = None,
) -> IngestSummary:
    """Ingest uploaded file(s) for ``source`` -> normalize -> load -> recompute."""
    files = _require_files(file)
    try:
        if source is IngestSource.transactions:
            per_file, batch = _ingest_transactions(db, files)
            total = load_ledger(db, batch)
            _run_precompute_windows(db)

        elif source is IngestSource.income:
            per_file, total = _ingest_income(files, db)
            _run_precompute_windows(db)

        elif source is IngestSource.holdings:
            data = _read(files[0])
            rows = holdings_loader.parse_holdings(_decode(data))
            total = holdings_loader.load_holdings(db, rows)
            per_file = [
                IngestedFile(
                    filename=files[0].filename or "", detected_type="etrade_csv", rows=total
                )
            ]

        elif source is IngestSource.accounts:
            data = _read(files[0])
            rows = accounts_loader.parse_accounts(_decode(data))
            total = accounts_loader.load_accounts(db, rows)
            per_file = [
                IngestedFile(
                    filename=files[0].filename or "", detected_type="accounts_yaml", rows=total
                )
            ]

        else:  # IngestSource.loans
            data = _read(files[0])
            rows = loans_loader.parse_loans(_decode(data))
            total = loans_loader.load_loans(db, rows)
            per_file = [
                IngestedFile(filename=files[0].filename or "", detected_type="loan_csv", rows=total)
            ]

        db.commit()
    except RequestValidationError:
        db.rollback()
        raise
    except SQLAlchemyError as exc:  # DB down / table missing / connection refused.
        db.rollback()
        raise ServiceUnavailableError() from exc

    return IngestSummary(source=source.value, files=per_file, total_rows=total)


def _ingest_income(files: list[UploadFile], db: Session) -> tuple[list[IngestedFile], int]:
    """Parse paystub PDF(s) and/or a paystubs.csv, then upsert into ``paystubs``."""
    per_file: list[IngestedFile] = []
    rows: list[income_loader.PaystubRow] = []
    for upload in files:
        data = _read(upload)
        name = upload.filename or ""
        if name.lower().endswith(".pdf"):
            parsed = _parse_paystub_pdf(data, name)
            detected = "paystub_pdf"
            rows.append(parsed)
            count = 1
        else:
            parsed_rows = income_loader.parse_paystubs_csv(_decode(data))
            if not parsed_rows:
                raise _validation_error("file", f"Could not parse pay-stub rows from {name!r}.")
            detected = "paystubs_csv"
            rows.extend(parsed_rows)
            count = len(parsed_rows)
        per_file.append(IngestedFile(filename=name, detected_type=detected, rows=count))
    total = income_loader.load_paystubs(db, rows)
    return per_file, total


def _parse_paystub_pdf(data: bytes, name: str) -> income_loader.PaystubRow:
    """Extract one pay-stub PDF into a ``PaystubRow`` (filename carries the dates)."""
    import os.path
    import tempfile
    from pathlib import Path

    # extract_paystubs.parse_paystub derives employer/dates from the FILENAME, so
    # write the upload under its real basename inside a throwaway temp directory.
    with tempfile.TemporaryDirectory() as tmpdir:
        safe_name = os.path.basename(name) or "upload.pdf"
        path = Path(tmpdir) / safe_name
        path.write_bytes(data)
        try:
            record = extract_paystubs.parse_paystub(path)
        except ValueError as exc:
            raise _validation_error("file", f"Unrecognized pay-stub file {name!r}.") from exc
    return income_loader.PaystubRow(
        employer=record["employer"],
        period_start=_as_date(record["period_start"]),
        period_end=_as_date(record["period_end"]),
        pay_date=_as_date(record["pay_date"]),
        gross_pay=record["gross_pay"],
        net_pay=record["net_pay"],
        taxes=record["taxes"],
        deductions=record["deductions"],
        reimbursements=record["reimbursements"],
        retirement_401k_employee=record["retirement_401k_employee"],
        retirement_401k_employer=record["retirement_401k_employer"],
    )


def _as_date(value):
    """Coerce an ISO date string (extractor emits strings) to ``date``."""
    from datetime import date as date_cls

    if isinstance(value, date_cls):
        return value
    return date_cls.fromisoformat(str(value))
