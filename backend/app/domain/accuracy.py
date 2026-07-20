"""Экран «Точность планирования»: сравнение plan/fact снимков за N недель."""

import uuid
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Member, Project, WeekSnapshot


async def accuracy_report(
    db: AsyncSession, workspace_id: uuid.UUID, weeks: int = 8
) -> dict:
    snapshots = (
        (
            await db.execute(
                select(WeekSnapshot)
                .where(WeekSnapshot.workspace_id == workspace_id)
                .order_by(WeekSnapshot.week_start.desc())
            )
        )
        .scalars()
        .all()
    )
    by_week: dict[str, dict[str, WeekSnapshot]] = {}
    for s in snapshots:
        by_week.setdefault(s.week_start.isoformat(), {})[s.kind] = s

    paired = sorted(
        (
            (week, kinds["plan"], kinds["fact"])
            for week, kinds in by_week.items()
            if "plan" in kinds and "fact" in kinds
        ),
        key=lambda x: x[0],
        reverse=True,
    )[:weeks]

    members = {
        str(m.id): m.name
        for m in (
            await db.execute(select(Member).where(Member.workspace_id == workspace_id))
        )
        .scalars()
        .all()
    }
    projects = {
        str(p.id): {"code": p.code, "name": p.name}
        for p in (
            await db.execute(select(Project).where(Project.workspace_id == workspace_id))
        )
        .scalars()
        .all()
    }

    def to_member_day(payload: dict) -> dict[tuple[str, str], Decimal]:
        out: dict[tuple[str, str], Decimal] = {}
        for a in payload.get("allocations", []):
            key = (a["member_id"], a["day"])
            out[key] = out.get(key, Decimal(0)) + Decimal(a["load"])
        return out

    def to_project_total(payload: dict) -> dict[str, Decimal]:
        out: dict[str, Decimal] = {}
        for a in payload.get("allocations", []):
            out[a["project_id"]] = out.get(a["project_id"], Decimal(0)) + Decimal(a["load"])
        return out

    week_rows = []
    member_abs_err: dict[str, list[Decimal]] = {}
    project_delta: dict[str, Decimal] = {}
    idle_weeks = 0

    for week, plan_s, fact_s in paired:
        plan_md, fact_md = to_member_day(plan_s.payload), to_member_day(fact_s.payload)
        keys = set(plan_md) | set(fact_md)
        abs_err = sum(
            abs(fact_md.get(k, Decimal(0)) - plan_md.get(k, Decimal(0))) for k in keys
        )
        week_rows.append(
            {
                "week_start": week,
                "plan_total": str(sum(plan_md.values(), Decimal(0))),
                "fact_total": str(sum(fact_md.values(), Decimal(0))),
                "abs_error": str(abs_err),
            }
        )
        # ошибка по сотрудникам
        per_member_keys: dict[str, set] = {}
        for m_id, day in keys:
            per_member_keys.setdefault(m_id, set()).add(day)
        for m_id, days in per_member_keys.items():
            errs = [
                abs(
                    fact_md.get((m_id, d), Decimal(0))
                    - plan_md.get((m_id, d), Decimal(0))
                )
                for d in days
            ]
            member_abs_err.setdefault(m_id, []).extend(errs)
        # «свободный» ресурс так и не был задействован:
        # в плане у сотрудника пусто и в факте тоже пусто, при том что неделя рабочая
        planned_members = {m for m, _ in plan_md}
        fact_members = {m for m, _ in fact_md}
        if (set(members) - planned_members) and (
            set(members) - planned_members - fact_members
        ):
            idle_weeks += 1
        # проекты, съедающие больше плана
        plan_p, fact_p = to_project_total(plan_s.payload), to_project_total(fact_s.payload)
        for p_id in set(plan_p) | set(fact_p):
            delta = fact_p.get(p_id, Decimal(0)) - plan_p.get(p_id, Decimal(0))
            project_delta[p_id] = project_delta.get(p_id, Decimal(0)) + delta

    member_rows = sorted(
        (
            {
                "member_id": m_id,
                "member_name": members.get(m_id, "—"),
                "mean_abs_error": str(
                    (sum(errs, Decimal(0)) / len(errs)).quantize(Decimal("0.01"))
                    if errs
                    else Decimal(0)
                ),
            }
            for m_id, errs in member_abs_err.items()
        ),
        key=lambda r: Decimal(r["mean_abs_error"]),
        reverse=True,
    )
    overrun_projects = sorted(
        (
            {
                "project_id": p_id,
                "code": projects.get(p_id, {}).get("code", "—"),
                "name": projects.get(p_id, {}).get("name", "—"),
                "total_overrun": str(delta),
            }
            for p_id, delta in project_delta.items()
            if delta > 0
        ),
        key=lambda r: Decimal(r["total_overrun"]),
        reverse=True,
    )[:5]

    return {
        "weeks_analyzed": len(paired),
        "weeks": week_rows,
        "members": member_rows,
        "idle_weeks_share": (idle_weeks / len(paired)) if paired else 0,
        "overrun_projects": overrun_projects,
    }
