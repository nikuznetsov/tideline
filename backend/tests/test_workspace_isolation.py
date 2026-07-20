"""Изоляция по workspace_id: данные чужого пространства не видны и не редактируются.

Написан сейчас, пока пространство одно, — по требованию ТЗ §14.
"""

from datetime import timedelta
from decimal import Decimal

from app.db.models import Allocation, Member, Project
from app.domain.capacity import search_capacity
from app.domain.timeline import build_timeline


async def test_timeline_does_not_leak_foreign_workspace(
    db, workspace, other_workspace, monday
):
    foreign_member = Member(workspace_id=other_workspace.id, name="Чужой")
    foreign_project = Project(
        workspace_id=other_workspace.id, code="ALIEN", name="Чужой проект"
    )
    db.add(foreign_member)
    db.add(foreign_project)
    await db.flush()
    db.add(
        Allocation(
            workspace_id=other_workspace.id,
            member_id=foreign_member.id,
            project_id=foreign_project.id,
            day=monday,
            load=Decimal("1.0"),
        )
    )
    await db.commit()

    timeline = await build_timeline(
        db, workspace.id, monday, monday + timedelta(days=13)
    )
    assert timeline.members == []
    assert timeline.allocations == []
    assert all(p.code != "ALIEN" for p in timeline.projects)


async def test_capacity_search_does_not_leak(db, workspace, other_workspace, monday):
    db.add(Member(workspace_id=other_workspace.id, name="Чужой"))
    await db.commit()
    result = await search_capacity(
        db, workspace.id, monday, monday, Decimal("1"), today=monday
    )
    assert result.candidates == []
    assert result.total_free == Decimal("0")


async def test_api_cannot_touch_foreign_allocation(
    auth_client, db, other_workspace, team, monday
):
    foreign_member = Member(workspace_id=other_workspace.id, name="Чужой")
    foreign_project = Project(
        workspace_id=other_workspace.id, code="ALIEN", name="Чужой проект"
    )
    db.add(foreign_member)
    db.add(foreign_project)
    await db.flush()
    alloc = Allocation(
        workspace_id=other_workspace.id,
        member_id=foreign_member.id,
        project_id=foreign_project.id,
        day=monday,
        load=Decimal("1.0"),
    )
    db.add(alloc)
    await db.commit()

    resp = await auth_client.patch(
        f"/api/v1/w/xops/allocations/{alloc.id}", json={"load": "0.5"}
    )
    assert resp.status_code == 404
    resp = await auth_client.delete(f"/api/v1/w/xops/allocations/{alloc.id}")
    assert resp.status_code == 404
    # и проект чужого пространства недоступен
    resp = await auth_client.get(f"/api/v1/w/xops/projects/{foreign_project.id}")
    assert resp.status_code == 404
