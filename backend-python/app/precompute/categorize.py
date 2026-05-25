"""Generic transaction categorization + transfer detection (P3.2).

Maps a transaction description to a **category** (e.g. ``Groceries``) and a
50/30/20 **bucket** (``needs`` / ``wants`` / ``savings``). The keyword rules are
deliberately **generic** — common merchant/category patterns, never the owner's
real merchant lists (privacy). Categorization is **deterministic**: rules are
checked in declared order and the first keyword match wins, so the same input
always yields the same output (DA-9).

Buckets follow the canonical enum registry (``app.models.BUCKET_VALUES``):
``needs`` (essentials), ``wants`` (discretionary), ``savings`` (savings/transfers
to savings / investments).
"""

from __future__ import annotations

import re

from app.models import BUCKET_VALUES

# Category -> 50/30/20 bucket. The single source of truth for the bucket of a
# category; the enum values come from app.models so they can't drift.
NEEDS, WANTS, SAVINGS = BUCKET_VALUES
BUCKET_FOR_CATEGORY: dict[str, str] = {
    "Groceries": NEEDS,
    "Rent": NEEDS,
    "Utilities": NEEDS,
    "Transportation": NEEDS,
    "Insurance": NEEDS,
    "Healthcare": NEEDS,
    "Phone": NEEDS,
    "Dining": WANTS,
    "Entertainment": WANTS,
    "Shopping": WANTS,
    "Travel": WANTS,
    "Subscriptions": WANTS,
    "Fitness": WANTS,
    "Savings": SAVINGS,
    "Investments": SAVINGS,
    "Income": SAVINGS,  # inflows are not spending; bucketed out of needs/wants
    "Transfer": SAVINGS,
    "Uncategorized": WANTS,  # conservative default: discretionary unless matched
}

# Ordered (category, [keywords]) rules. First keyword found in the normalized
# description wins. Generic merchants/keywords only — no real owner data.
_RULES: list[tuple[str, tuple[str, ...]]] = [
    ("Groceries", ("grocery", "supermarket", "trader joe", "safeway", "whole foods", "aldi")),
    ("Transportation", ("uber", "lyft", "transit", "metro", "parking", "gas station", "shell")),
    ("Dining", ("restaurant", "coffee", "cafe", "diner", "pizza", "burger", "doordash")),
    ("Subscriptions", ("netflix", "spotify", "hulu", "subscription", "membership")),
    ("Entertainment", ("cinema", "movie", "theater", "game", "concert")),
    ("Utilities", ("electric", "water", "utility", "power", "internet", "comcast")),
    ("Phone", ("verizon", "at&t", "t-mobile", "wireless", "mobile")),
    ("Rent", ("rent", "landlord", "property mgmt")),
    ("Insurance", ("insurance", "geico", "allstate")),
    ("Healthcare", ("pharmacy", "clinic", "medical", "dental", "doctor")),
    ("Fitness", ("gym", "fitness", "yoga", "peloton")),
    ("Shopping", ("amazon", "target", "walmart", "store", "shop")),
    ("Travel", ("airline", "hotel", "airbnb", "flight", "expedia")),
    ("Savings", ("savings", "ally bank", "marcus")),
    ("Investments", ("vanguard", "fidelity", "brokerage", "401k", "schwab", "etrade")),
    ("Income", ("payroll", "direct deposit", "salary", "paycheck")),
]

# Transfer keywords: a self-transfer / payment between own accounts (not spend).
_TRANSFER_KEYWORDS: tuple[str, ...] = (
    "transfer",
    "xfer",
    "online transfer",
    "payment thank you",
    "autopay",
    "card payment",
    "to savings",
    "from checking",
)

_WS_RE = re.compile(r"\s+")


def _normalize(description: str) -> str:
    """Lower-case + collapse whitespace for stable keyword matching."""
    return _WS_RE.sub(" ", description).strip().lower()


def categorize(description: str) -> str:
    """Return the category for a transaction description (deterministic).

    The first rule whose keyword appears in the normalized description wins;
    falls back to ``"Uncategorized"`` when nothing matches.
    """
    text = _normalize(description)
    for category, keywords in _RULES:
        if any(kw in text for kw in keywords):
            return category
    return "Uncategorized"


def bucket_for_category(category: str) -> str:
    """Map a category to its 50/30/20 bucket (defaults to ``wants``)."""
    return BUCKET_FOR_CATEGORY.get(category, WANTS)


def is_transfer(description: str) -> bool:
    """True when a description looks like an account transfer / card payment.

    Transfers are excluded from needs/wants spending so they don't inflate the
    budget; they are flagged on the transaction and bucketed to ``savings``.
    """
    text = _normalize(description)
    return any(kw in text for kw in _TRANSFER_KEYWORDS)
