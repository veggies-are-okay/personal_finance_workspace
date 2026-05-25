"""Thin CLI wrapper: re-exports the canonical Chase PDF extractor from ``app``.

The pure pdfplumber parsing logic now lives at
``backend-python/app/ingestion/extract_chase.py`` so the FastAPI ingest
endpoints and the Docker image (which copies only ``app/``) can run it (P8.1).
This module stays as the repo-root CLI entry point and keeps the root project's
tests (``tests/test_extract_chase_statements.py``) green by re-exporting every
public name — ``import extract_chase_statements`` continues to expose
``parse_statement``, ``extract_all``, ``write_csv``, ``DEFAULT_PDF_DIR``,
``CSV_HEADER``, etc.

Run::

    uv run python scripts/extract_chase_statements.py
    uv run python scripts/extract_chase_statements.py --pdf-dir <dir> --out <file.csv>
"""

from __future__ import annotations

import sys
from pathlib import Path

# Put backend-python/ on the path so ``app`` imports resolve when this script is
# run from the repo-root uv project (mirrors load_local.py's sys.path insert).
_BACKEND_PY = Path(__file__).resolve().parent.parent / "backend-python"
if str(_BACKEND_PY) not in sys.path:
    sys.path.insert(0, str(_BACKEND_PY))

from app.ingestion.extract_chase import (  # noqa: E402
    CSV_HEADER,
    DEFAULT_OUT_CSV,
    DEFAULT_PDF_DIR,
    REPO_ROOT,
    Transaction,
    extract_all,
    main,
    parse_lines,
    parse_statement,
    write_csv,
)

__all__ = [
    "CSV_HEADER",
    "DEFAULT_OUT_CSV",
    "DEFAULT_PDF_DIR",
    "REPO_ROOT",
    "Transaction",
    "extract_all",
    "main",
    "parse_lines",
    "parse_statement",
    "write_csv",
]


if __name__ == "__main__":
    raise SystemExit(main())
