from datetime import timedelta
from decimal import Decimal

from app.db.models import Absence, Allocation, NonWorkingDay
from app.domain.capacity import (
    compute_member_capacity,
    search_capacity,
)


async def test_free_capacity_basic(db, workspace, team, monday):
    """Free capacity: a full day minus the allocation."""
    member = team["members"][0]
    db.add(
        Allocation(
            workspace_id=workspace.id,
            member_id=member.id,
            project_id=team["project"].id,
            day=monday,
            category="most",
        )
    )
    await db.commit()
    result = await search_capacity(
        db, workspace.id, monday, monday, Decimal("1"), today=monday
    )
    candidate = next(c for c in result.candidates if c.member.id == member.id)
    assert candidate.free_total == Decimal("0.25")
    # the other two are fully free
    assert result.total_free == Decimal("2.25")
    assert result.enough


async def test_capacity_excludes_weekends_holidays_absences(db, workspace, team, monday):
    member = team["members"][0]
    tuesday = monday + timedelta(days=1)
    db.add(NonWorkingDay(workspace_id=workspace.id, day=tuesday, title="Holiday"))
    db.add(
        Absence(
            workspace_id=workspace.id,
            member_id=member.id,
            date_from=monday,
            date_to=monday,
            kind="vacation",
        )
    )
    await db.commit()
    # Mon-Sun window: 5 working days, minus the holiday = 4; Anna also minus vacation on Mon = 3
    sunday = monday + timedelta(days=6)
    result = await search_capacity(
        db, workspace.id, monday, sunday, Decimal("100"), today=monday
    )
    anya = next(c for c in result.candidates if c.member.id == member.id)
    assert anya.free_total == Decimal("3")
    others = [c for c in result.candidates if c.member.id != member.id]
    assert all(c.free_total == Decimal("4") for c in others)
    assert not result.enough
    assert result.deficit == Decimal("100") - Decimal("11")


async def test_partial_capacity_rate(db, workspace, team, monday):
    member = team["members"][1]
    member.capacity_per_day = Decimal("0.5")
    await db.commit()
    mc = compute_member_capacity(member, [], [], set(), monday, monday)
    assert mc.total_free == Decimal("0.5")


async def test_overload_free_is_zero_not_negative(db, workspace, team, monday):
    member = team["members"][0]
    for cat in ("full", "half"):
        db.add(
            Allocation(
                workspace_id=workspace.id,
                member_id=member.id,
                project_id=team["project"].id if cat == "full" else team["finished"].id,
                day=monday,
                category=cat,
            )
        )
    await db.commit()
    result = await search_capacity(
        db, workspace.id, monday, monday, Decimal("1"), today=monday
    )
    assert all(c.member.id != member.id for c in result.candidates)


async def test_min_daily_filters_fragments(db, workspace, team, monday):
    """0.25 free per day but the minimum is 0.5 — not counted as a candidate."""
    member = team["members"][0]
    db.add(
        Allocation(
            workspace_id=workspace.id,
            member_id=member.id,
            project_id=team["project"].id,
            day=monday,
            category="most",
        )
    )
    await db.commit()
    result = await search_capacity(
        db,
        workspace.id,
        monday,
        monday,
        Decimal("1"),
        min_daily=Decimal("0.5"),
        today=monday,
    )
    assert all(c.member.id != member.id for c in result.candidates)


async def test_tags_filter(db, workspace, team, monday):
    result = await search_capacity(
        db, workspace.id, monday, monday, Decimal("1"), tags=["ml"], today=monday
    )
    assert len(result.candidates) == 1
    assert result.candidates[0].member.name == "Anna"


async def test_plan_horizon_warning(db, workspace, team, monday):
    far = monday + timedelta(days=30)
    result = await search_capacity(
        db, workspace.id, far, far, Decimal("1"), today=monday
    )
    assert result.plan_horizon_warning
    near = await search_capacity(
        db, workspace.id, monday, monday + timedelta(days=4), Decimal("1"), today=monday
    )
    assert not near.plan_horizon_warning


async def test_candidates_sorted_by_free_desc(db, workspace, team, monday):
    db.add(
        Allocation(
            workspace_id=workspace.id,
            member_id=team["members"][0].id,
            project_id=team["project"].id,
            day=monday,
            category="half",
        )
    )
    await db.commit()
    result = await search_capacity(
        db, workspace.id, monday, monday, Decimal("1"), today=monday
    )
    frees = [c.free_total for c in result.candidates]
    assert frees == sorted(frees, reverse=True)
