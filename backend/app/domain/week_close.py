"""Week close: fact snapshot, comparison with plan, freezing the N+2 plan, reopen."""

import uuid
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Allocation, AuditLog, Member, Project, WeekSnapshot
from app.domain.categories import weight


class WeekCloseError(Exception):
    pass


def _num(v) -> str:
    """Canonical numeric string: no trailing zeros ('0.50' -> '0.5')."""
    d = Decimal(str(v)).normalize()
    return format(d, "f")


async def _week_allocations(
    db: AsyncSession, workspace_id: uuid.UUID, week_start: date
) -> list[Allocation]:
    week_end = week_start + timedelta(days=6)
    return (
        (
            await db.execute(
                select(Allocation).where(
                    Allocation.workspace_id == workspace_id,
                    Allocation.day >= week_start,
                    Allocation.day <= week_end,
                )
            )
        )
        .scalars()
        .all()
    )


async def build_week_payload(
    db: AsyncSession, workspace_id: uuid.UUID, week_start: date
) -> dict:
    """Full snapshot of the week's allocations: independent of the current table state."""
    allocations = await _week_allocations(db, workspace_id, week_start)
    member_ids = {a.member_id for a in allocations}
    project_ids = {a.project_id for a in allocations}
    members = {
        m.id: m
        for m in (
            await db.execute(select(Member).where(Member.workspace_id == workspace_id))
        )
        .scalars()
        .all()
    }
    projects = {
        p.id: p
        for p in (
            await db.execute(select(Project).where(Project.workspace_id == workspace_id))
        )
        .scalars()
        .all()
    }
    return {
        "week_start": week_start.isoformat(),
        "allocations": [
            {
                "member_id": str(a.member_id),
                "member_name": members[a.member_id].name if a.member_id in members else None,
                "project_id": str(a.project_id),
                "project_code": projects[a.project_id].code if a.project_id in projects else None,
                "day": a.day.isoformat(),
                "category": a.category,
                # derived weight: diff/accuracy read "load" — old snapshots stay compatible
                "load": _num(weight(a.category)),
            }
            for a in allocations
        ],
        "member_ids": sorted(str(i) for i in member_ids),
        "project_ids": sorted(str(i) for i in project_ids),
    }


def diff_payloads(plan: dict | None, fact: dict) -> dict:
    """Plan/fact difference keyed by (member, project, day)."""

    def to_map(payload: dict | None) -> dict[tuple, Decimal]:
        result: dict[tuple, Decimal] = {}
        for a in (payload or {}).get("allocations", []):
            key = (a["member_id"], a["project_id"], a["day"])
            result[key] = result.get(key, Decimal(0)) + Decimal(a["load"])
        return result

    plan_map, fact_map = to_map(plan), to_map(fact)
    changes = []
    for key in sorted(set(plan_map) | set(fact_map)):
        p, f = plan_map.get(key, Decimal(0)), fact_map.get(key, Decimal(0))
        if p != f:
            changes.append(
                {
                    "member_id": key[0],
                    "project_id": key[1],
                    "day": key[2],
                    "plan": _num(p),
                    "fact": _num(f),
                    "delta": _num(f - p),
                }
            )
    total_abs = sum(abs(Decimal(c["delta"])) for c in changes)
    return {
        "had_plan": plan is not None,
        "changes": changes,
        "total_abs_delta": _num(total_abs),
    }


async def get_snapshot(
    db: AsyncSession, workspace_id: uuid.UUID, week_start: date, kind: str
) -> WeekSnapshot | None:
    return (
        await db.execute(
            select(WeekSnapshot).where(
                WeekSnapshot.workspace_id == workspace_id,
                WeekSnapshot.week_start == week_start,
                WeekSnapshot.kind == kind,
            )
        )
    ).scalar_one_or_none()


async def close_week(
    db: AsyncSession,
    workspace_id: uuid.UUID,
    week_start: date,
    actor_user_id: uuid.UUID | None = None,
) -> WeekSnapshot:
    """Transactional: fact snapshot + diff against plan + freezing next week's plan."""
    if await get_snapshot(db, workspace_id, week_start, "fact"):
        raise WeekCloseError("Week is already closed")

    fact_payload = await build_week_payload(db, workspace_id, week_start)
    plan_snapshot = await get_snapshot(db, workspace_id, week_start, "plan")
    fact_payload["diff_vs_plan"] = diff_payloads(
        plan_snapshot.payload if plan_snapshot else None, fact_payload
    )

    fact = WeekSnapshot(
        workspace_id=workspace_id,
        week_start=week_start,
        kind="fact",
        payload=fact_payload,
    )
    db.add(fact)

    # freeze the plan for the next week (N+1 from the one being closed) unless already frozen
    next_week = week_start + timedelta(days=7)
    if not await get_snapshot(db, workspace_id, next_week, "plan"):
        plan_payload = await build_week_payload(db, workspace_id, next_week)
        db.add(
            WeekSnapshot(
                workspace_id=workspace_id,
                week_start=next_week,
                kind="plan",
                payload=plan_payload,
            )
        )

    db.add(
        AuditLog(
            workspace_id=workspace_id,
            actor_user_id=actor_user_id,
            entity_type="week",
            entity_id=None,
            action="close_week",
            before=None,
            after={"week_start": week_start.isoformat()},
        )
    )
    await db.commit()
    return fact


async def undo_close_week(
    db: AsyncSession,
    workspace_id: uuid.UUID,
    week_start: date,
    actor_user_id: uuid.UUID | None = None,
) -> None:
    """Reopen within 24 hours of closing: deletes the fact snapshot."""
    fact = await get_snapshot(db, workspace_id, week_start, "fact")
    if not fact:
        raise WeekCloseError("Week is not closed")
    created = fact.created_at
    if created.tzinfo is None:
        created = created.replace(tzinfo=timezone.utc)
    if datetime.now(timezone.utc) - created > timedelta(hours=24):
        raise WeekCloseError("Reopening is only possible within 24 hours of closing")
    await db.delete(fact)
    db.add(
        AuditLog(
            workspace_id=workspace_id,
            actor_user_id=actor_user_id,
            entity_type="week",
            entity_id=None,
            action="undo_close_week",
            before={"week_start": week_start.isoformat()},
            after=None,
        )
    )
    await db.commit()
