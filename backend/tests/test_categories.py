from datetime import timedelta
from decimal import Decimal

from app.db.models import Allocation
from app.domain.categories import (
    CATEGORIES,
    CATEGORY_CHECK,
    CATEGORY_WEIGHTS,
    category_for_load,
    weight,
)


def test_category_for_load_boundaries():
    assert category_for_load(Decimal("0.05")) == "background"
    assert category_for_load(Decimal("0.25")) == "background"
    assert category_for_load(Decimal("0.26")) == "half"
    assert category_for_load(Decimal("0.3")) == "half"
    assert category_for_load(Decimal("0.5")) == "half"
    assert category_for_load(Decimal("0.55")) == "most"
    assert category_for_load(Decimal("0.75")) == "most"
    assert category_for_load(Decimal("0.8")) == "full"
    assert category_for_load(Decimal("1")) == "full"


def test_weights_ascending_and_check_consistent():
    ws = [weight(c) for c in CATEGORIES]
    assert ws == sorted(ws)
    for c in CATEGORY_WEIGHTS:
        assert f"'{c}'" in CATEGORY_CHECK


async def test_garbage_category_rejected_422(auth_client, team, monday):
    resp = await auth_client.post(
        "/api/v1/w/xops/allocations",
        json={
            "member_id": str(team["members"][0].id),
            "project_id": str(team["project"].id),
            "day": monday.isoformat(),
            "category": "0.5",
        },
    )
    assert resp.status_code == 422


async def test_project_load_sums_category_weights(auth_client, db, team, monday):
    """CASE-сумма в /projects/{id}/load: full + background = 1.25 человеко-дня."""
    member = team["members"][0]
    project = team["project"]
    for day, cat in ((monday, "full"), (monday + timedelta(days=1), "background")):
        db.add(
            Allocation(
                workspace_id=project.workspace_id,
                member_id=member.id,
                project_id=project.id,
                day=day,
                category=cat,
            )
        )
    await db.commit()

    resp = await auth_client.get(
        f"/api/v1/w/xops/projects/{project.id}/load",
        params={"from": monday.isoformat(), "to": (monday + timedelta(days=4)).isoformat()},
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert Decimal(data["total_person_days"]) == Decimal("1.25")
    assert Decimal(data["rows"][0]["person_days"]) == Decimal("1.25")


async def test_export_cells_use_category_marks(auth_client, db, team, monday):
    member = team["members"][0]
    project = team["project"]
    db.add(
        Allocation(
            workspace_id=project.workspace_id,
            member_id=member.id,
            project_id=project.id,
            day=monday,
            category="most",
        )
    )
    await db.commit()

    resp = await auth_client.get(
        "/api/v1/w/xops/export/timeline.csv",
        params={"from": monday.isoformat(), "to": (monday + timedelta(days=4)).isoformat()},
    )
    assert resp.status_code == 200
    assert "most" in resp.content.decode("utf-8-sig")
