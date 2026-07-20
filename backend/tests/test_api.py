from datetime import timedelta
from decimal import Decimal

from app.db.models import Allocation


async def test_login_wrong_password(client, workspace):
    resp = await client.post(
        "/api/v1/auth/login", json={"email": "admin@example.com", "password": "нет"}
    )
    assert resp.status_code == 401


async def test_timeline_requires_auth(client, workspace, monday):
    resp = await client.get(
        f"/api/v1/w/xops/timeline?from={monday}&to={monday + timedelta(days=13)}"
    )
    assert resp.status_code == 401


async def test_allocation_crud_and_timeline(auth_client, team, monday):
    member = team["members"][0]
    project = team["project"]
    resp = await auth_client.post(
        "/api/v1/w/xops/allocations",
        json={
            "member_id": str(member.id),
            "project_id": str(project.id),
            "day": monday.isoformat(),
            "load": "0.5",
        },
    )
    assert resp.status_code == 200, resp.text
    alloc_id = resp.json()["id"]

    # тот же (member, project, day) — апсерт, не дубль
    resp = await auth_client.post(
        "/api/v1/w/xops/allocations",
        json={
            "member_id": str(member.id),
            "project_id": str(project.id),
            "day": monday.isoformat(),
            "load": "0.75",
        },
    )
    assert resp.status_code == 200
    assert resp.json()["id"] == alloc_id
    assert Decimal(resp.json()["load"]) == Decimal("0.75")

    resp = await auth_client.get(
        f"/api/v1/w/xops/timeline?from={monday}&to={monday + timedelta(days=13)}"
    )
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["allocations"]) == 1
    assert data["members"]
    assert data["day_totals"]
    assert len(data["weeks"]) == 2

    resp = await auth_client.delete(f"/api/v1/w/xops/allocations/{alloc_id}")
    assert resp.status_code == 200


async def test_allocation_rejects_weekend(auth_client, team, monday):
    saturday = monday + timedelta(days=5)
    resp = await auth_client.post(
        "/api/v1/w/xops/allocations",
        json={
            "member_id": str(team["members"][0].id),
            "project_id": str(team["project"].id),
            "day": saturday.isoformat(),
            "load": "1.0",
        },
    )
    assert resp.status_code == 422


async def test_allocation_rejects_finished_project(auth_client, team, monday):
    resp = await auth_client.post(
        "/api/v1/w/xops/allocations",
        json={
            "member_id": str(team["members"][0].id),
            "project_id": str(team["finished"].id),
            "day": monday.isoformat(),
            "load": "1.0",
        },
    )
    assert resp.status_code == 422


async def test_allocation_rejects_absence_day(auth_client, team, monday):
    member = team["members"][0]
    resp = await auth_client.post(
        "/api/v1/w/xops/absences",
        json={
            "member_id": str(member.id),
            "date_from": monday.isoformat(),
            "date_to": monday.isoformat(),
            "kind": "vacation",
        },
    )
    assert resp.status_code == 200
    resp = await auth_client.post(
        "/api/v1/w/xops/allocations",
        json={
            "member_id": str(member.id),
            "project_id": str(team["project"].id),
            "day": monday.isoformat(),
            "load": "1.0",
        },
    )
    assert resp.status_code == 422
    assert "отпуск" in resp.json()["detail"].lower() or "отсутств" in resp.json()["detail"].lower()


async def test_absence_over_allocations_requires_confirmation(auth_client, team, monday):
    member = team["members"][0]
    await auth_client.post(
        "/api/v1/w/xops/allocations",
        json={
            "member_id": str(member.id),
            "project_id": str(team["project"].id),
            "day": monday.isoformat(),
            "load": "1.0",
        },
    )
    payload = {
        "member_id": str(member.id),
        "date_from": monday.isoformat(),
        "date_to": monday.isoformat(),
        "kind": "vacation",
    }
    resp = await auth_client.post("/api/v1/w/xops/absences", json=payload)
    assert resp.status_code == 409
    assert resp.json()["detail"]["code"] == "allocations_exist"
    assert resp.json()["detail"]["days"] == 1

    resp = await auth_client.post(
        "/api/v1/w/xops/absences", json=payload | {"clear_allocations": True}
    )
    assert resp.status_code == 200
    # аллокации в диапазоне удалены
    from_iso, to_iso = monday.isoformat(), monday.isoformat()
    timeline = await auth_client.get(f"/api/v1/w/xops/timeline?from={from_iso}&to={to_iso}")
    assert timeline.json()["allocations"] == []


async def test_bulk_fill_skips_weekend(auth_client, team, monday):
    resp = await auth_client.post(
        "/api/v1/w/xops/allocations/bulk",
        json={
            "items": [
                {
                    "member_id": str(team["members"][0].id),
                    "project_id": str(team["project"].id),
                    "date_from": monday.isoformat(),
                    "date_to": (monday + timedelta(days=6)).isoformat(),
                    "load": "1.0",
                }
            ]
        },
    )
    assert resp.status_code == 200
    assert resp.json()["affected"] == 5  # только будни


async def test_copy_week(auth_client, team, monday):
    await auth_client.post(
        "/api/v1/w/xops/allocations",
        json={
            "member_id": str(team["members"][0].id),
            "project_id": str(team["project"].id),
            "day": monday.isoformat(),
            "load": "1.0",
        },
    )
    resp = await auth_client.post(
        "/api/v1/w/xops/allocations/copy-week",
        json={
            "from_week_start": monday.isoformat(),
            "to_week_start": (monday + timedelta(days=7)).isoformat(),
            "mode": "merge",
        },
    )
    assert resp.status_code == 200
    assert resp.json()["created"] == 1


async def test_capacity_search_endpoint(auth_client, team, monday):
    resp = await auth_client.get(
        "/api/v1/w/xops/capacity/search",
        params={
            "from": monday.isoformat(),
            "to": (monday + timedelta(days=4)).isoformat(),
            "needed_person_days": "15",
        },
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["enough"] is True  # 3 человека * 5 дней = 15
    assert Decimal(data["total_free"]) == Decimal("15")
    assert len(data["candidates"]) == 3


async def test_project_registry_and_card(auth_client, team):
    resp = await auth_client.get("/api/v1/w/xops/projects")
    assert resp.status_code == 200
    codes = [p["code"] for p in resp.json()]
    assert "TEST" in codes
    assert "OLD" not in codes  # завершённые скрыты по умолчанию

    resp = await auth_client.get("/api/v1/w/xops/projects", params={"include_finished": "true"})
    assert "OLD" in [p["code"] for p in resp.json()]

    project_id = [p for p in resp.json() if p["code"] == "TEST"][0]["id"]
    resp = await auth_client.post(
        f"/api/v1/w/xops/projects/{project_id}/updates",
        json={"body": "Новый апдейт", "health_after": "amber"},
    )
    assert resp.status_code == 200
    resp = await auth_client.get(f"/api/v1/w/xops/projects/{project_id}")
    detail = resp.json()
    assert detail["health"] == "amber"
    assert detail["updates"][0]["body"] == "Новый апдейт"


async def test_week_close_endpoint(auth_client, team, monday):
    await auth_client.post(
        "/api/v1/w/xops/allocations",
        json={
            "member_id": str(team["members"][0].id),
            "project_id": str(team["project"].id),
            "day": monday.isoformat(),
            "load": "1.0",
        },
    )
    resp = await auth_client.post(
        "/api/v1/w/xops/weeks/close", json={"week_start": monday.isoformat()}
    )
    assert resp.status_code == 200
    resp = await auth_client.post(
        "/api/v1/w/xops/weeks/close", json={"week_start": monday.isoformat()}
    )
    assert resp.status_code == 422
    resp = await auth_client.post(
        "/api/v1/w/xops/weeks/close/undo", json={"week_start": monday.isoformat()}
    )
    assert resp.status_code == 200


async def test_export_xlsx(auth_client, team, monday):
    resp = await auth_client.get(
        "/api/v1/w/xops/export/timeline.xlsx",
        params={"from": monday.isoformat(), "to": (monday + timedelta(days=13)).isoformat()},
    )
    assert resp.status_code == 200
    assert resp.content[:2] == b"PK"  # zip-контейнер xlsx
    resp = await auth_client.get("/api/v1/w/xops/export/projects.xlsx")
    assert resp.status_code == 200


def test_export_escapes_formula_cells():
    from app.services.export import _safe

    assert _safe("=1+1") == "'=1+1"
    assert _safe("+cmd") == "'+cmd"
    assert _safe("-2") == "'-2"
    assert _safe("@x") == "'@x"
    assert _safe("\tHACK") == "'\tHACK"
    # безопасные значения не трогаем
    assert _safe("TEST") == "TEST"
    assert _safe("Аня") == "Аня"
    assert _safe(None) is None


async def test_export_csv_escapes_injection(auth_client, db, team, monday):
    """Код проекта с ведущим = не должен попасть в CSV как формула."""
    from app.db.models import Project

    evil = Project(workspace_id=team["project"].workspace_id, code="=SUM(A1)", name="Злой")
    db.add(evil)
    await db.flush()
    db.add(
        Allocation(
            workspace_id=evil.workspace_id,
            member_id=team["members"][0].id,
            project_id=evil.id,
            day=monday,
            load=Decimal("0.5"),
        )
    )
    await db.commit()

    resp = await auth_client.get(
        "/api/v1/w/xops/export/timeline.csv",
        params={"from": monday.isoformat(), "to": (monday + timedelta(days=13)).isoformat()},
    )
    assert resp.status_code == 200
    body = resp.content.decode("utf-8-sig")
    assert "'=SUM(A1)" in body
    assert ",=SUM(A1)" not in body


async def test_share_link_lifecycle(auth_client, client, team, monday):
    resp = await auth_client.post("/api/v1/w/xops/share-links", json={})
    assert resp.status_code == 200
    token = resp.json()["token"]
    link_id = resp.json()["id"]

    resp = await client.get(f"/api/v1/s/{token}/timeline")
    assert resp.status_code == 200
    data = resp.json()
    assert "week_close_reminder" not in data or data["week_close_reminder"] is None

    resp = await client.get(f"/api/v1/s/{token}/projects")
    assert resp.status_code == 200
    # публичный сериализатор не отдаёт внутренние поля
    if resp.json():
        assert "links_md" not in resp.json()[0]
        assert "goal" not in resp.json()[0]

    resp = await auth_client.delete(f"/api/v1/w/xops/share-links/{link_id}")
    assert resp.status_code == 200
    resp = await client.get(f"/api/v1/s/{token}/timeline")
    assert resp.status_code == 404


async def test_invalid_share_token_404(client, workspace):
    resp = await client.get("/api/v1/s/deadbeef/timeline")
    assert resp.status_code == 404


async def test_input_validation_returns_422_not_500(auth_client, team):
    pid = str(team["project"].id)
    mid = str(team["members"][0].id)

    # невалидные enum-значения → 422 (раньше доходили до CHECK и роняли 500)
    assert (await auth_client.patch(
        f"/api/v1/w/xops/projects/{pid}", json={"lifecycle": "banana"}
    )).status_code == 422
    assert (await auth_client.patch(
        f"/api/v1/w/xops/projects/{pid}", json={"health": "blue"}
    )).status_code == 422
    assert (await auth_client.post(
        f"/api/v1/w/xops/projects/{pid}/updates",
        json={"body": "x", "health_after": "blue"},
    )).status_code == 422
    assert (await auth_client.post(
        "/api/v1/w/xops/absences",
        json={"member_id": mid, "date_from": "2026-08-01", "date_to": "2026-08-02", "kind": "nonsense"},
    )).status_code == 422
    assert (await auth_client.put(
        f"/api/v1/w/xops/projects/{pid}/milestones",
        json=[{"title": "M", "status": "weird"}],
    )).status_code == 422

    # capacity_per_day вне (0, 1] → 422 (в т.ч. переполнение Numeric и отрицательное)
    for bad in ["99.5", "-1", "0", "1.5"]:
        r = await auth_client.patch(
            f"/api/v1/w/xops/members/{mid}", json={"capacity_per_day": bad}
        )
        assert r.status_code == 422, bad
    r = await auth_client.patch(
        f"/api/v1/w/xops/members/{mid}", json={"capacity_per_day": "0.5"}
    )
    assert r.status_code == 200


async def test_login_trims_email(client, workspace):
    resp = await client.post(
        "/api/v1/auth/login",
        json={"email": "  admin@example.com  ", "password": "admin"},
    )
    assert resp.status_code == 200


async def test_integrity_error_maps_to_409():
    from sqlalchemy.exc import IntegrityError

    from app.main import _integrity_error

    resp = await _integrity_error(None, IntegrityError("stmt", {}, Exception("dup")))
    assert resp.status_code == 409


def test_rate_limiter_evicts_stale_keys():
    """Словарь лимитера не растёт бесконечно: протухшие ключи выселяются."""
    import time

    from app.core.rate_limit import SlidingWindowLimiter

    lim = SlidingWindowLimiter(max_requests=5, window_seconds=0.01)
    for i in range(3000):
        lim.check(f"ip-{i}")  # много уникальных IP (как публичный трафик)
    time.sleep(0.02)  # окно истекло — все хиты протухли
    for _ in range(SlidingWindowLimiter._SWEEP_EVERY):
        lim.check("trigger")  # серия запросов гарантированно вызывает sweep
    assert len(lim._hits) <= 2, len(lim._hits)


def test_rate_limiter_still_limits():
    """Уборка не ломает сам лимит."""
    from app.core.rate_limit import SlidingWindowLimiter

    lim = SlidingWindowLimiter(max_requests=3, window_seconds=60)
    assert [lim.check("ip") for _ in range(5)] == [True, True, True, False, False]
