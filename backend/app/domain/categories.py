"""Load categories: the single source of truth for weights.

The user enters and sees only the category; the weight is used
exclusively for aggregates (overload, free capacity, person-days).
"""
from decimal import Decimal

import sqlalchemy as sa

CATEGORY_WEIGHTS: dict[str, Decimal] = {
    "background": Decimal("0.25"),
    "half": Decimal("0.5"),
    "most": Decimal("0.75"),
    "full": Decimal("1"),
}

# order = ascending weight
CATEGORIES: tuple[str, ...] = tuple(CATEGORY_WEIGHTS)

CATEGORY_CHECK = "category in ('background','half','most','full')"

CATEGORY_LABELS: dict[str, str] = {
    "background": "Background",
    "half": "Half day",
    "most": "Most of the day",
    "full": "Full day",
}

XLSX_LETTER: dict[str, str] = {
    "background": "B",
    "half": "H",
    "most": "M",
    "full": "F",
}


def weight(category: str) -> Decimal:
    return CATEGORY_WEIGHTS[category]


def category_for_load(load: Decimal) -> str:
    """Maps the old numeric load to a category (for the migration)."""
    if load <= Decimal("0.25"):
        return "background"
    if load <= Decimal("0.5"):
        return "half"
    if load <= Decimal("0.75"):
        return "most"
    return "full"


def weight_sql(column: sa.ColumnElement) -> sa.Case:
    """CASE expression of the category weight for SQL aggregates."""
    return sa.case(CATEGORY_WEIGHTS, value=column, else_=None)
