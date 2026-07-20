from datetime import timedelta
from decimal import Decimal

from app.db.models import WeekSnapshot
from app.domain.accuracy import accuracy_report


def _payload(week_start, allocations):
    return {
        "week_start": week_start.isoformat(),
        "allocations": allocations,
    }


async def test_accuracy_report(db, workspace, team, monday):
    m0, m1 = team["members"][0], team["members"][1]
    p = team["project"]
    for w in (2, 1):
        ws_date = monday - timedelta(weeks=w)
        plan = [
            {
                "member_id": str(m0.id),
                "project_id": str(p.id),
                "day": ws_date.isoformat(),
                "load": "1.0",
            }
        ]
        fact = [
            {
                "member_id": str(m0.id),
                "project_id": str(p.id),
                "day": ws_date.isoformat(),
                "load": "0.5",
            },
            {
                "member_id": str(m1.id),
                "project_id": str(p.id),
                "day": ws_date.isoformat(),
                "load": "1.0",
            },
        ]
        db.add(WeekSnapshot(workspace_id=workspace.id, week_start=ws_date,
                            kind="plan", payload=_payload(ws_date, plan)))
        db.add(WeekSnapshot(workspace_id=workspace.id, week_start=ws_date,
                            kind="fact", payload=_payload(ws_date, fact)))
    await db.commit()

    report = await accuracy_report(db, workspace.id, weeks=8)
    assert report["weeks_analyzed"] == 2
    assert len(report["weeks"]) == 2
    week = report["weeks"][0]
    assert Decimal(week["plan_total"]) == Decimal("1.0")
    assert Decimal(week["fact_total"]) == Decimal("1.5")
    assert Decimal(week["abs_error"]) == Decimal("1.5")  # |0.5-1| + |1-0|
    # у обоих сотрудников есть ошибка, сортировка по убыванию
    errors = [Decimal(r["mean_abs_error"]) for r in report["members"]]
    assert errors == sorted(errors, reverse=True)
    # проект стабильно съедает больше плана: fact 1.5 vs plan 1.0 за неделю
    assert report["overrun_projects"][0]["code"] == "TEST"
    assert Decimal(report["overrun_projects"][0]["total_overrun"]) == Decimal("1.0")


async def test_accuracy_empty(db, workspace):
    report = await accuracy_report(db, workspace.id)
    assert report["weeks_analyzed"] == 0
    assert report["weeks"] == []
