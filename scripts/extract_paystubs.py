"""Thin CLI wrapper: re-exports the canonical pay-stub extractor from ``app``.

The pure pdfplumber parsing logic now lives at
``backend-python/app/ingestion/extract_paystubs.py`` so the FastAPI ingest
endpoints and the Docker image (which copies only ``app/``) can run it (P8.1).
This module stays as the repo-root CLI entry point and keeps the root project's
tests (``tests/test_extract_paystubs.py``) green by re-exporting every public
name (and the ``_FNAME_RX`` pattern the tests reference) — ``import
extract_paystubs`` continues to expose ``parse_paystub_text``,
``net_pay_residual``, ``write_csv``, ``COLUMNS``, etc.

Run::

    uv run python scripts/extract_paystubs.py
    uv run python scripts/extract_paystubs.py --pdf-dir <dir> --out <file.csv>
"""

from __future__ import annotations

import sys
from pathlib import Path

# Put backend-python/ on the path so ``app`` imports resolve when this script is
# run from the repo-root uv project (mirrors load_local.py's sys.path insert).
_BACKEND_PY = Path(__file__).resolve().parent.parent / "backend-python"
if str(_BACKEND_PY) not in sys.path:
    sys.path.insert(0, str(_BACKEND_PY))

from app.ingestion.extract_paystubs import (  # noqa: E402
    COLUMNS,
    DEFAULT_OUT_CSV,
    DEFAULT_PDF_DIR,
    NET_TOLERANCE,
    REPO_ROOT,
    _FNAME_RX,
    extract_all,
    main,
    net_pay_residual,
    parse_paystub,
    parse_paystub_text,
    write_csv,
)

__all__ = [
    "COLUMNS",
    "DEFAULT_OUT_CSV",
    "DEFAULT_PDF_DIR",
    "NET_TOLERANCE",
    "REPO_ROOT",
    "_FNAME_RX",
    "extract_all",
    "main",
    "net_pay_residual",
    "parse_paystub",
    "parse_paystub_text",
    "write_csv",
]


if __name__ == "__main__":
    raise SystemExit(main())
