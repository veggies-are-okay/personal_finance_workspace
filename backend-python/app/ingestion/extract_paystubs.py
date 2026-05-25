"""Extract 66DEGREES (Rippling) pay-stub PDFs into a single wide CSV for analysis.

**Canonical home** (P8.1): the pure pdfplumber parsing logic lives here under
``app/`` so the FastAPI ingest endpoints (and the Docker image, which copies
only ``app/``) can run it. The repo-root ``scripts/extract_paystubs.py`` is a
thin CLI wrapper that re-exports this module so the root project's tests stay
green.

The stubs live under ``docs/paystubs/<year>/`` and all share the same Rippling layout.
The header (GROSS PAY / NET PAY / PAY DATE) is overprinted with a vertical watermark and
unreliable to parse, but the **SUMMARY** block at the bottom is clean and self-consistent::

    SUMMARY            CURRENT       YTD
    Gross Pay          $7,176.13     $94,848.54
    Reimbursements     $75.00        $450.00
    Deductions         $1,097.00     $14,386.91
    Taxes              $2,087.28     $28,232.70
    Employer Taxes     $543.62       $7,667.63
    Net Pay            $4,066.85     $52,678.93

and satisfies the identity ``Net = Gross - Deductions - Taxes + Reimbursements`` (used to
validate every parse). Itemized employee taxes, 401(k), medical and earnings are also pulled.

Quirks handled deterministically:
* **Label drift by year** — 2026 prints "Medicare Tax" / "California SDI" / "California State
  Tax" where 2024-25 print "Medicare" / "SDI Withholding - CA" / "State Withholding - CA".
* **First-of-year stubs** omit the Reimbursements line (treated as $0).
* **Year-end ``...1231`` stubs** are $0-current employer-tax true-ups that still carry the
  final YTD totals; kept as their own rows.
* Dates come from the **filename** (always present, unambiguous); pay date = period end.
"""

from __future__ import annotations

import argparse
import csv
import re
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path

import pdfplumber

# Repo root is four levels up: backend-python/app/ingestion/extract_paystubs.py.
REPO_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_PDF_DIR = REPO_ROOT / "docs" / "paystubs"
DEFAULT_OUT_CSV = REPO_ROOT / "docs" / "paystubs" / "paystubs.csv"

# Net = Gross - Deductions - Taxes + Reimbursements should hold to within source rounding.
NET_TOLERANCE = Decimal("0.10")

_MONEY = r"\$([\d,]+\.\d{2})"

# label -> regex capturing (current, ytd). Two-amount "summary"/tax lines.
_PAIR_RX = {
    "gross_pay": re.compile(rf"Gross Pay\s+{_MONEY}\s+{_MONEY}"),
    "reimbursements": re.compile(rf"Reimbursements\s+{_MONEY}\s+{_MONEY}"),
    # summary "Deductions" has exactly 2 amounts (itemized "X Deductions" have 4 -> excluded
    # by the negative lookahead); "Employer Taxes" excluded from "Taxes" via lookbehind.
    "deductions": re.compile(rf"Deductions\s+{_MONEY}\s+{_MONEY}(?!\s*\$)"),
    "taxes": re.compile(rf"(?<!Employer )Taxes\s+{_MONEY}\s+{_MONEY}"),
    "employer_taxes": re.compile(rf"Employer Taxes\s+{_MONEY}\s+{_MONEY}"),
    "net_pay": re.compile(rf"Net Pay\s+{_MONEY}\s+{_MONEY}"),
    "federal_income_tax": re.compile(rf"Federal Income Tax\s+{_MONEY}\s+{_MONEY}"),
    "medicare": re.compile(rf"(?<!Employer )Medicare(?: Tax)?\s+{_MONEY}\s+{_MONEY}"),
    # employee Social Security only ("Social Security - Employer" has " - Employer" after it)
    "social_security": re.compile(rf"Social Security\s+{_MONEY}\s+{_MONEY}"),
    "ca_sdi": re.compile(rf"(?:SDI Withholding - CA|California SDI)\s+{_MONEY}\s+{_MONEY}"),
    "ca_state_tax": re.compile(
        rf"(?:State Withholding - CA|California State Tax)\s+{_MONEY}\s+{_MONEY}"
    ),
}
# Four-amount lines: employee-current, company-current, employee-ytd, company-ytd.
_QUAD_RX = {
    "retirement_401k": re.compile(rf"401K \(Pre-tax\)\s+{_MONEY}\s+{_MONEY}\s+{_MONEY}\s+{_MONEY}"),
    "medical": re.compile(rf"Medical Deductions\s+{_MONEY}\s+{_MONEY}\s+{_MONEY}\s+{_MONEY}"),
}
_SALARY_RX = re.compile(rf"Salary\s+-\s+([\d.]+)\s+{_MONEY}\s+{_MONEY}")
_FNAME_RX = re.compile(r"paystub-(?P<emp>.+?)-(?P<d1>\d{8})(?:-(?P<d2>\d{8}))?-")

# Output column order (one row per pay stub).
COLUMNS = [
    "source_file",
    "employer",
    "period_start",
    "period_end",
    "pay_date",
    "gross_pay",
    "reimbursements",
    "deductions",
    "taxes",
    "employer_taxes",
    "net_pay",
    "gross_pay_ytd",
    "reimbursements_ytd",
    "deductions_ytd",
    "taxes_ytd",
    "employer_taxes_ytd",
    "net_pay_ytd",
    "federal_income_tax",
    "federal_income_tax_ytd",
    "medicare",
    "medicare_ytd",
    "social_security",
    "social_security_ytd",
    "ca_sdi",
    "ca_sdi_ytd",
    "ca_state_tax",
    "ca_state_tax_ytd",
    "retirement_401k_employee",
    "retirement_401k_employee_ytd",
    "retirement_401k_employer",
    "retirement_401k_employer_ytd",
    "medical_employee",
    "medical_employee_ytd",
    "salary",
    "salary_ytd",
    "salary_hours",
    "other_earnings",
    "other_earnings_ytd",  # bonuses, retro pay, etc. (= gross - base salary)
]


def _money(s: str) -> Decimal:
    return Decimal(s.replace(",", ""))


def _pair(rx: re.Pattern, text: str) -> tuple[Decimal, Decimal] | tuple[None, None]:
    m = rx.search(text)
    return (_money(m.group(1)), _money(m.group(2))) if m else (None, None)


def parse_paystub(path: Path) -> dict:
    """Parse one pay-stub PDF into a flat dict keyed by ``COLUMNS``."""
    fm = _FNAME_RX.search(path.name)
    if not fm:
        raise ValueError(f"Unrecognized pay-stub filename: {path.name}")
    start = datetime.strptime(fm.group("d1"), "%Y%m%d").date()
    end = datetime.strptime(fm.group("d2"), "%Y%m%d").date() if fm.group("d2") else start

    with pdfplumber.open(str(path)) as pdf:
        text = "\n".join((page.extract_text() or "") for page in pdf.pages)

    return parse_paystub_text(
        text,
        source_file=path.name,
        employer=fm.group("emp").replace("-", " "),
        period_start=start,
        period_end=end,
    )


def parse_paystub_text(
    text: str, *, source_file: str, employer: str, period_start: date, period_end: date
) -> dict:
    """Parse the SUMMARY / earnings / tax fields out of a stub's extracted text.

    Dates and employer come from the filename; this is the layout-dependent core and
    the unit-testable entry point (feed it synthetic text). Pay date is the period end.
    """
    row: dict = {
        "source_file": source_file,
        "employer": employer,
        "period_start": period_start.isoformat(),
        "period_end": period_end.isoformat(),
        "pay_date": period_end.isoformat(),  # semi-monthly: paid on the period-end date
    }

    # Two-amount lines -> <name> (current) and <name>_ytd.
    for name, rx in _PAIR_RX.items():
        cur, ytd = _pair(rx, text)
        # Reimbursements line is absent on $0 stubs; treat as zero.
        if cur is None and name == "reimbursements":
            cur, ytd = Decimal("0.00"), Decimal("0.00")
        row[name] = cur
        row[f"{name}_ytd"] = ytd

    # Four-amount lines -> employee/employer current + ytd (default $0 when absent).
    for name, rx in _QUAD_RX.items():
        m = rx.search(text)
        emp_cur, _co_cur, emp_ytd, co_ytd = (
            (_money(m.group(1)), _money(m.group(2)), _money(m.group(3)), _money(m.group(4)))
            if m
            else (Decimal("0.00"),) * 4
        )
        if name == "retirement_401k":
            row["retirement_401k_employee"] = emp_cur
            row["retirement_401k_employee_ytd"] = emp_ytd
            row["retirement_401k_employer"] = _co_cur
            row["retirement_401k_employer_ytd"] = co_ytd
        else:  # medical: keep the employee deduction columns
            row["medical_employee"] = emp_cur
            row["medical_employee_ytd"] = emp_ytd

    sm = _SALARY_RX.search(text)
    row["salary_hours"] = Decimal(sm.group(1)) if sm else None
    row["salary"] = _money(sm.group(2)) if sm else Decimal("0.00")
    row["salary_ytd"] = _money(sm.group(3)) if sm else Decimal("0.00")

    # Everything above base salary (annual/delivery bonuses, retro pay, ...) lumped together.
    # Robust against the many bonus labels/casing; reimbursements are NOT in gross pay.
    row["other_earnings"] = row["gross_pay"] - row["salary"]
    row["other_earnings_ytd"] = row["gross_pay_ytd"] - row["salary_ytd"]

    return row


def net_pay_residual(row: dict) -> Decimal:
    """Net - (Gross - Deductions - Taxes + Reimbursements); ~0 when the parse is consistent."""
    expected = row["gross_pay"] - row["deductions"] - row["taxes"] + row["reimbursements"]
    return (row["net_pay"] - expected).copy_abs()


def extract_all(pdf_dir: Path = DEFAULT_PDF_DIR) -> list[dict]:
    """Parse every stub under ``pdf_dir`` (recursively), oldest pay date first."""
    rows = [parse_paystub(p) for p in sorted(pdf_dir.glob("**/*.pdf"))]
    rows.sort(key=lambda r: (r["pay_date"], r["period_start"], r["source_file"]))
    return rows


def write_csv(rows: list[dict], out_path: Path = DEFAULT_OUT_CSV) -> None:
    with open(out_path, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(COLUMNS)
        for r in rows:
            w.writerow([_fmt(r.get(c)) for c in COLUMNS])


def _fmt(v) -> str:
    if v is None:
        return ""
    if isinstance(v, Decimal):
        return f"{v:.2f}"
    return str(v)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pdf-dir", type=Path, default=DEFAULT_PDF_DIR)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT_CSV)
    args = parser.parse_args(argv)

    rows = extract_all(args.pdf_dir)
    print(f"{'pay_date':<12}{'gross':>12}{'net':>12}{'401k_emp':>10}  check")
    for r in rows:
        resid = net_pay_residual(r)
        check = "OK" if resid <= NET_TOLERANCE else f"NET OFF {resid:+.2f}"
        print(
            f"{r['pay_date']:<12}{r['gross_pay']:>12,.2f}{r['net_pay']:>12,.2f}"
            f"{r['retirement_401k_employee']:>10,.2f}  {check}"
        )

    write_csv(rows, args.out)
    latest = rows[-1]
    print(f"\nWrote {len(rows)} pay stubs to {args.out}")
    print(
        f"Latest YTD ({latest['pay_date']}): gross ${latest['gross_pay_ytd']:,.2f}, "
        f"net ${latest['net_pay_ytd']:,.2f}, 401k ${latest['retirement_401k_employee_ytd']:,.2f}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
