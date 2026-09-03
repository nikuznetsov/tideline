from datetime import date, timedelta


def week_start_of(d: date, week_starts_on: int = 1) -> date:
    """Monday (or another configured start) of the week containing the date."""
    offset = (d.weekday() - (week_starts_on - 1)) % 7
    return d - timedelta(days=offset)


def date_range(date_from: date, date_to: date) -> list[date]:
    return [date_from + timedelta(days=i) for i in range((date_to - date_from).days + 1)]


def is_weekend(d: date) -> bool:
    return d.weekday() >= 5


def working_days(
    date_from: date,
    date_to: date,
    non_working: set[date],
) -> list[date]:
    return [
        d
        for d in date_range(date_from, date_to)
        if not is_weekend(d) and d not in non_working
    ]
