"""Aggregated response for the timeline grid — one set of queries, no N+1."""

import uuid
from datetime import date, timedelta
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Project, WeekSnapshot
from app.domain.calendar import week_start_of
from app.domain.capacity import compute_member_capacity, load_calendar_context
from app.schemas import (
    MemberOut,
    TimelineAbsence,
    TimelineAllocation,
    TimelineDayTotal,
    TimelineMember,
    TimelineMemberDay,
    TimelineProject,
    TimelineResponse,
    TimelineWeek,
)


async def build_timeline(
    db: AsyncSession,
    workspace_id: uuid.UUID,
    date_from: date,
    date_to: date,
    today: date | None = None,
    public: bool = False,
) -> TimelineResponse:
    today = today or date.today()
    members, allocations, absences, non_working = await load_calendar_context(
        db, workspace_id, date_from, date_to
    )
    nw_days = {n.day for n in non_working}

    project_ids = {a.project_id for a in allocations}
    projects = (
        (
            await db.execute(
                select(Project).where(
                    Project.workspace_id == workspace_id,
                    Project.deleted_at.is_(None),
                )
            )
        )
        .scalars()
        .all()
    )
    # the response includes active projects (for adding) + those present in allocations
    visible_projects = [
        p for p in projects if p.lifecycle != "finished" or p.id in project_ids
    ]

    timeline_members: list[TimelineMember] = []
    day_totals: dict[date, dict[str, Decimal]] = {}
    for m in members:
        mc = compute_member_capacity(m, allocations, absences, nw_days, date_from, date_to)
        timeline_members.append(
            TimelineMember(
                member=MemberOut.model_validate(m),
                days=[
                    TimelineMemberDay(
                        day=d.day,
                        capacity=d.capacity,
                        allocated=d.allocated,
                        free=d.free,
                        is_working=d.is_working,
                        is_absent=d.is_absent,
                    )
                    for d in mc.days
                ],
                total_allocated=mc.total_allocated,
                total_free=mc.total_free,
            )
        )
        for d in mc.days:
            t = day_totals.setdefault(
                d.day,
                {"free": Decimal(0), "capacity": Decimal(0), "allocated": Decimal(0)},
            )
            t["free"] += d.free
            t["capacity"] += d.capacity
            t["allocated"] += d.allocated

    totals = [
        TimelineDayTotal(
            day=d,
            free=v["free"],
            capacity=v["capacity"],
            allocated=v["allocated"],
            is_working=d.weekday() < 5 and d not in nw_days,
        )
        for d, v in sorted(day_totals.items())
    ]

    # weeks of the window: closed or not (fact snapshot), current/past/future
    week_starts: list[date] = []
    w = week_start_of(date_from)
    while w <= date_to:
        week_starts.append(w)
        w += timedelta(days=7)
    fact_weeks = {
        s.week_start
        for s in (
            await db.execute(
                select(WeekSnapshot).where(
                    WeekSnapshot.workspace_id == workspace_id,
                    WeekSnapshot.kind == "fact",
                    WeekSnapshot.week_start.in_(week_starts),
                )
            )
        )
        .scalars()
        .all()
    }
    current_week = week_start_of(today)
    weeks = []
    for ws in week_starts:
        week_days = [d for d in sorted(day_totals) if ws <= d <= ws + timedelta(days=6)]
        weeks.append(
            TimelineWeek(
                week_start=ws,
                is_closed=ws in fact_weeks,
                is_current=ws == current_week,
                is_past=ws < current_week,
                free_total=sum((day_totals[d]["free"] for d in week_days), Decimal(0)),
            )
        )

    total_cap = sum((t.capacity for t in totals), Decimal(0))
    total_alloc = sum((t.allocated for t in totals), Decimal(0))
    utilization = float(min(total_alloc / total_cap, Decimal(2)) * 100) if total_cap else 0.0

    # reminder: last week is not closed and it is already Tuesday or later
    reminder = None
    prev_week = current_week - timedelta(days=7)
    if today.weekday() >= 1:
        prev_closed = (
            await db.execute(
                select(WeekSnapshot.id).where(
                    WeekSnapshot.workspace_id == workspace_id,
                    WeekSnapshot.kind == "fact",
                    WeekSnapshot.week_start == prev_week,
                )
            )
        ).scalar_one_or_none()
        if not prev_closed:
            reminder = prev_week

    return TimelineResponse(
        date_from=date_from,
        date_to=date_to,
        members=timeline_members,
        allocations=[
            TimelineAllocation(
                id=a.id,
                member_id=a.member_id,
                project_id=a.project_id,
                day=a.day,
                category=a.category,
                note=None if public else a.note,
            )
            for a in allocations
        ],
        projects=[
            TimelineProject(id=p.id, code=p.code, name=p.name, lifecycle=p.lifecycle)
            for p in visible_projects
        ],
        absences=[
            TimelineAbsence(
                member_id=a.member_id,
                date_from=a.date_from,
                date_to=a.date_to,
                kind=a.kind,
            )
            for a in absences
        ],
        non_working_days=sorted(nw_days),
        day_totals=totals,
        weeks=weeks,
        utilization_pct=round(utilization, 1),
        week_close_reminder=None if public else reminder,
    )
