from datetime import datetime, timedelta, timezone
from decimal import Decimal

import pytest

from app.db.models import Allocation, WeekSnapshot
from app.domain.week_close import (
    WeekCloseError,
    close_week,
    diff_payloads,
    get_snapshot,
    undo_close_week,
)


async def _alloc(db, workspace, team, day, load="1.0", member_idx=0):
    a = Allocation(
        workspace_id=workspace.id,
        member_id=team["members"][member_idx].id,
        project_id=team["project"].id,
        day=day,
        load=Decimal(load),
    )
    db.add(a)
    await db.commit()
    return a


async def test_close_week_creates_fact_snapshot(db, workspace, team, monday):
    await _alloc(db, workspace, team, monday)
    snapshot = await close_week(db, workspace.id, monday)
    assert snapshot.kind == "fact"
    assert len(snapshot.payload["allocations"]) == 1
    assert snapshot.payload["diff_vs_plan"]["had_plan"] is False


async def test_close_week_twice_fails(db, workspace, team, monday):
    await close_week(db, workspace.id, monday)
    with pytest.raises(WeekCloseError):
        await close_week(db, workspace.id, monday)


async def test_close_week_fixes_next_week_plan(db, workspace, team, monday):
    next_monday = monday + timedelta(days=7)
    await _alloc(db, workspace, team, next_monday, "0.5")
    await close_week(db, workspace.id, monday)
    plan = await get_snapshot(db, workspace.id, next_monday, "plan")
    assert plan is not None
    assert plan.payload["allocations"][0]["load"] == "0.5"


async def test_close_week_diff_vs_plan(db, workspace, team, monday):
    # план: 1.0 в понедельник; факт: 0.5
    plan_payload = {
        "week_start": monday.isoformat(),
        "allocations": [
            {
                "member_id": str(team["members"][0].id),
                "project_id": str(team["project"].id),
                "day": monday.isoformat(),
                "load": "1.0",
            }
        ],
    }
    db.add(
        WeekSnapshot(
            workspace_id=workspace.id, week_start=monday, kind="plan", payload=plan_payload
        )
    )
    await db.commit()
    await _alloc(db, workspace, team, monday, "0.5")
    snapshot = await close_week(db, workspace.id, monday)
    diff = snapshot.payload["diff_vs_plan"]
    assert diff["had_plan"] is True
    assert len(diff["changes"]) == 1
    assert diff["changes"][0]["delta"] == "-0.5"
    assert diff["total_abs_delta"] == "0.5"


async def test_undo_close_week(db, workspace, team, monday):
    await _alloc(db, workspace, team, monday)
    await close_week(db, workspace.id, monday)
    await undo_close_week(db, workspace.id, monday)
    assert await get_snapshot(db, workspace.id, monday, "fact") is None
    # и можно закрыть снова
    await close_week(db, workspace.id, monday)


async def test_undo_after_24h_fails(db, workspace, team, monday):
    await close_week(db, workspace.id, monday)
    fact = await get_snapshot(db, workspace.id, monday, "fact")
    fact.created_at = datetime.now(timezone.utc) - timedelta(hours=25)
    await db.commit()
    with pytest.raises(WeekCloseError):
        await undo_close_week(db, workspace.id, monday)


async def test_undo_not_closed_fails(db, workspace, monday):
    with pytest.raises(WeekCloseError):
        await undo_close_week(db, workspace.id, monday)


def test_diff_payloads_no_plan():
    fact = {"allocations": [{"member_id": "m", "project_id": "p", "day": "d", "load": "1.0"}]}
    diff = diff_payloads(None, fact)
    assert diff["had_plan"] is False
    assert diff["changes"][0]["plan"] == "0"
