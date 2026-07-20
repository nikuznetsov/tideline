"""Расчёт ёмкости и поиск свободного ресурса.

Все функции принимают workspace_id — обязательное условие мультиарендной схемы.
"""

import uuid
from dataclasses import dataclass, field
from datetime import date, timedelta
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Absence, Allocation, Member, NonWorkingDay, Project
from app.domain.calendar import date_range, is_weekend, week_start_of


@dataclass
class DayCapacity:
    day: date
    capacity: Decimal
    allocated: Decimal
    free: Decimal
    is_working: bool
    is_absent: bool


@dataclass
class MemberCapacity:
    member: Member
    days: list[DayCapacity] = field(default_factory=list)

    @property
    def total_free(self) -> Decimal:
        return sum((d.free for d in self.days), Decimal(0))

    @property
    def total_allocated(self) -> Decimal:
        return sum((d.allocated for d in self.days), Decimal(0))

    @property
    def total_capacity(self) -> Decimal:
        return sum((d.capacity for d in self.days), Decimal(0))


async def load_calendar_context(
    db: AsyncSession,
    workspace_id: uuid.UUID,
    date_from: date,
    date_to: date,
):
    """Одним набором запросов достаёт всё для расчёта ёмкости за диапазон."""
    members = (
        (
            await db.execute(
                select(Member)
                .where(
                    Member.workspace_id == workspace_id,
                    Member.deleted_at.is_(None),
                    Member.is_active.is_(True),
                )
                .order_by(Member.sort_order, Member.name)
            )
        )
        .scalars()
        .all()
    )
    allocations = (
        (
            await db.execute(
                select(Allocation).where(
                    Allocation.workspace_id == workspace_id,
                    Allocation.day >= date_from,
                    Allocation.day <= date_to,
                )
            )
        )
        .scalars()
        .all()
    )
    absences = (
        (
            await db.execute(
                select(Absence).where(
                    Absence.workspace_id == workspace_id,
                    Absence.date_from <= date_to,
                    Absence.date_to >= date_from,
                )
            )
        )
        .scalars()
        .all()
    )
    non_working = (
        (
            await db.execute(
                select(NonWorkingDay).where(
                    NonWorkingDay.workspace_id == workspace_id,
                    NonWorkingDay.day >= date_from,
                    NonWorkingDay.day <= date_to,
                )
            )
        )
        .scalars()
        .all()
    )
    return members, allocations, absences, non_working


def absence_days(absences, member_id: uuid.UUID, date_from: date, date_to: date) -> set[date]:
    days: set[date] = set()
    for a in absences:
        if a.member_id != member_id:
            continue
        start = max(a.date_from, date_from)
        end = min(a.date_to, date_to)
        for d in date_range(start, end) if start <= end else []:
            days.add(d)
    return days


def compute_member_capacity(
    member: Member,
    allocations,
    absences,
    non_working_days: set[date],
    date_from: date,
    date_to: date,
) -> MemberCapacity:
    absent = absence_days(absences, member.id, date_from, date_to)
    alloc_by_day: dict[date, Decimal] = {}
    for a in allocations:
        if a.member_id != member.id:
            continue
        alloc_by_day[a.day] = alloc_by_day.get(a.day, Decimal(0)) + Decimal(str(a.load))

    result = MemberCapacity(member=member)
    for d in date_range(date_from, date_to):
        working = not is_weekend(d) and d not in non_working_days
        is_absent = d in absent
        cap = Decimal(str(member.capacity_per_day)) if working and not is_absent else Decimal(0)
        allocated = alloc_by_day.get(d, Decimal(0))
        free = max(Decimal(0), cap - allocated)
        result.days.append(
            DayCapacity(
                day=d,
                capacity=cap,
                allocated=allocated,
                free=free,
                is_working=working,
                is_absent=is_absent,
            )
        )
    return result


@dataclass
class Candidate:
    member: Member
    free_total: Decimal
    free_by_day: dict[date, Decimal]
    warnings: list[dict]


@dataclass
class CapacitySearchResult:
    total_free: Decimal
    needed: Decimal
    enough: bool
    deficit: Decimal
    candidates: list[Candidate]
    plan_horizon_warning: bool


async def search_capacity(
    db: AsyncSession,
    workspace_id: uuid.UUID,
    date_from: date,
    date_to: date,
    needed_person_days: Decimal,
    min_daily: Decimal | None = None,
    tags: list[str] | None = None,
    today: date | None = None,
) -> CapacitySearchResult:
    members, allocations, absences, non_working = await load_calendar_context(
        db, workspace_id, date_from, date_to
    )
    nw_days = {n.day for n in non_working}

    # sole-owner: активные проекты, где сотрудник — единственный носитель экспертизы
    sole_rows = (
        await db.execute(
            select(Allocation.member_id, Project.name)
            .join(Project, Allocation.project_id == Project.id)
            .where(
                Allocation.workspace_id == workspace_id,
                Allocation.is_sole_owner.is_(True),
                Project.lifecycle == "active",
                Project.deleted_at.is_(None),
            )
            .distinct()
        )
    ).all()
    sole_by_member: dict[uuid.UUID, list[str]] = {}
    for member_id, project_name in sole_rows:
        sole_by_member.setdefault(member_id, []).append(project_name)

    candidates: list[Candidate] = []
    total_free = Decimal(0)

    for m in members:
        if tags:
            member_tags = set(m.tags or [])
            if not set(tags) <= member_tags:
                continue
        mc = compute_member_capacity(m, allocations, absences, nw_days, date_from, date_to)
        free_by_day: dict[date, Decimal] = {}
        for dc in mc.days:
            if not dc.is_working:
                continue
            free = dc.free
            if min_daily is not None and free < min_daily:
                free = Decimal(0)  # дробить сильнее бессмысленно
            if free > 0:
                free_by_day[dc.day] = free
        free_total = sum(free_by_day.values(), Decimal(0))
        if free_total <= 0:
            continue

        warnings: list[dict] = []
        if m.id in sole_by_member:
            warnings.append(
                {
                    "kind": "bus_factor",
                    "message": "Единственный носитель экспертизы: "
                    + ", ".join(sole_by_member[m.id]),
                }
            )
        vac = absence_days(absences, m.id, date_from, date_to)
        if vac:
            warnings.append(
                {
                    "kind": "absence",
                    "message": f"Отсутствие внутри диапазона: {len(vac)} дн.",
                }
            )
        # фрагментация: свободное время рассыпано мелкими кусками, цельного дня нет
        if free_by_day and max(free_by_day.values()) < Decimal("0.5"):
            warnings.append(
                {
                    "kind": "fragmentation",
                    "message": "Свободное время фрагментировано: нет блока ≥ 0.5 дня",
                }
            )

        candidates.append(
            Candidate(
                member=m,
                free_total=free_total,
                free_by_day=free_by_day,
                warnings=warnings,
            )
        )
        total_free += free_total

    candidates.sort(key=lambda c: c.free_total, reverse=True)

    today = today or date.today()
    plan_edge = week_start_of(today) + timedelta(days=13)
    plan_horizon_warning = date_to > plan_edge

    deficit = max(Decimal(0), needed_person_days - total_free)
    return CapacitySearchResult(
        total_free=total_free,
        needed=needed_person_days,
        enough=total_free >= needed_person_days,
        deficit=deficit,
        candidates=candidates,
        plan_horizon_warning=plan_horizon_warning,
    )
