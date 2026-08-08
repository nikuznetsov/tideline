"""Категории загрузки: единственный источник истины для весов.

Пользователь вводит и видит только категорию; вес используется
исключительно для агрегатов (перегруз, свободная ёмкость, человеко-дни).
"""
from decimal import Decimal

import sqlalchemy as sa

CATEGORY_WEIGHTS: dict[str, Decimal] = {
    "background": Decimal("0.25"),
    "half": Decimal("0.5"),
    "most": Decimal("0.75"),
    "full": Decimal("1"),
}

# порядок = возрастание веса
CATEGORIES: tuple[str, ...] = tuple(CATEGORY_WEIGHTS)

CATEGORY_CHECK = "category in ('background','half','most','full')"

CATEGORY_LABELS: dict[str, str] = {
    "background": "Фоново",
    "half": "Наполовину",
    "most": "Почти весь день",
    "full": "Весь день",
}

XLSX_LETTER: dict[str, str] = {
    "background": "Ф",
    "half": "Н",
    "most": "П",
    "full": "В",
}


def weight(category: str) -> Decimal:
    return CATEGORY_WEIGHTS[category]


def category_for_load(load: Decimal) -> str:
    """Маппинг старой числовой загрузки в категорию (для миграции)."""
    if load <= Decimal("0.25"):
        return "background"
    if load <= Decimal("0.5"):
        return "half"
    if load <= Decimal("0.75"):
        return "most"
    return "full"


def weight_sql(column: sa.ColumnElement) -> sa.Case:
    """CASE-выражение веса категории для SQL-агрегатов."""
    return sa.case(CATEGORY_WEIGHTS, value=column, else_=None)
