"""Итерация 2: регистрация, пространства, роли, вступление по ссылке."""

from httpx import AsyncClient


async def _register(client: AsyncClient, email: str, password: str = "secret-123"):
    resp = await client.post(
        "/api/v1/auth/register",
        json={
            "first_name": "Пётр",
            "last_name": "Тестов",
            "email": email,
            "password": password,
        },
    )
    return resp


async def test_register_and_me(client, workspace):
    resp = await _register(client, "new@example.com")
    assert resp.status_code == 200, resp.text
    assert resp.json()["name"] == "Пётр Тестов"
    me = await client.get("/api/v1/auth/me")
    assert me.status_code == 200
    assert me.json()["email"] == "new@example.com"


async def test_register_duplicate_email(client, workspace):
    await _register(client, "dup@example.com")
    resp = await _register(client, "dup@example.com")
    assert resp.status_code == 422


async def test_register_short_password(client, workspace):
    resp = await _register(client, "short@example.com", password="123")
    assert resp.status_code == 422


async def test_new_user_has_no_workspaces(client, workspace):
    await _register(client, "lonely@example.com")
    resp = await client.get("/api/v1/workspaces")
    assert resp.status_code == 200
    assert resp.json() == []
    # и чужое пространство отвечает 404, не раскрывая существование
    resp = await client.get("/api/v1/w/xops/projects")
    assert resp.status_code == 404


async def test_create_own_workspace(client, workspace):
    await _register(client, "founder@example.com")
    resp = await client.post(
        "/api/v1/workspaces", json={"name": "Моя команда", "slug": "my-team"}
    )
    assert resp.status_code == 200
    assert resp.json()["role"] == "owner"
    resp = await client.get("/api/v1/w/my-team/projects")
    assert resp.status_code == 200
    # плохой слаг
    resp = await client.post(
        "/api/v1/workspaces", json={"name": "x", "slug": "Плохой слаг!"}
    )
    assert resp.status_code == 422


async def test_join_by_invite_link_default_viewer(auth_client, client2, team, monday):
    # owner создаёт инвайт-ссылку
    resp = await auth_client.post("/api/v1/w/xops/invite-links")
    assert resp.status_code == 200, resp.text
    token = resp.json()["token"]

    # новый пользователь вступает
    await _register(client2, "joiner@example.com")
    info = await client2.get(f"/api/v1/join/{token}")
    assert info.status_code == 200
    assert info.json()["workspace_slug"] == "xops"
    resp = await client2.post(f"/api/v1/join/{token}")
    assert resp.status_code == 200
    assert resp.json()["role"] == "viewer"

    # viewer видит, но не может менять
    resp = await client2.get("/api/v1/w/xops/projects")
    assert resp.status_code == 200
    resp = await client2.post(
        "/api/v1/w/xops/allocations",
        json={
            "member_id": str(team["members"][0].id),
            "project_id": str(team["project"].id),
            "day": monday.isoformat(),
            "load": "1.0",
        },
    )
    assert resp.status_code == 403
    resp = await client2.post(
        "/api/v1/w/xops/projects", json={"code": "X", "name": "x"}
    )
    assert resp.status_code == 403
    # и не управляет пространством
    resp = await client2.get("/api/v1/w/xops/invite-links")
    assert resp.status_code == 403


async def test_default_role_editor(auth_client, client2, workspace):
    resp = await auth_client.patch(
        "/api/v1/w/xops", json={"default_member_role": "editor"}
    )
    assert resp.status_code == 200
    resp = await auth_client.post("/api/v1/w/xops/invite-links")
    token = resp.json()["token"]

    await _register(client2, "editor@example.com")
    resp = await client2.post(f"/api/v1/join/{token}")
    assert resp.json()["role"] == "editor"
    # editor может создавать проекты
    resp = await client2.post(
        "/api/v1/w/xops/projects", json={"code": "EDT", "name": "Проект редактора"}
    )
    assert resp.status_code == 200


async def test_revoked_invite_404(auth_client, client2, workspace):
    resp = await auth_client.post("/api/v1/w/xops/invite-links")
    token, link_id = resp.json()["token"], resp.json()["id"]
    await auth_client.delete(f"/api/v1/w/xops/invite-links/{link_id}")
    await _register(client2, "late@example.com")
    resp = await client2.post(f"/api/v1/join/{token}")
    assert resp.status_code == 404


async def test_team_member_is_participant(auth_client, client2, workspace):
    """Команда — подмножество участников: свободного ввода имён нет."""
    # чужой (не участник) — нельзя
    await _register(client2, "outsider@example.com")
    outsider_id = (await client2.get("/api/v1/auth/me")).json()["id"]
    resp = await auth_client.post(
        "/api/v1/w/xops/members", json={"user_id": outsider_id}
    )
    assert resp.status_code == 422

    # участник — можно, имя берётся из аккаунта
    invite = await auth_client.post("/api/v1/w/xops/invite-links")
    await client2.post(f"/api/v1/join/{invite.json()['token']}")
    resp = await auth_client.post(
        "/api/v1/w/xops/members",
        json={"user_id": outsider_id, "role_title": "Инженер"},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["name"] == "Пётр Тестов"
    assert resp.json()["email"] == "outsider@example.com"

    # второй раз — уже в команде
    resp = await auth_client.post(
        "/api/v1/w/xops/members", json={"user_id": outsider_id}
    )
    assert resp.status_code == 422


async def test_removing_access_removes_from_team(auth_client, client2, workspace):
    await _register(client2, "leaver@example.com")
    leaver_id = (await client2.get("/api/v1/auth/me")).json()["id"]
    invite = await auth_client.post("/api/v1/w/xops/invite-links")
    await client2.post(f"/api/v1/join/{invite.json()['token']}")
    await auth_client.post("/api/v1/w/xops/members", json={"user_id": leaver_id})

    members = (await auth_client.get("/api/v1/w/xops/members")).json()
    assert any(m["user_id"] == leaver_id for m in members)

    resp = await auth_client.delete(f"/api/v1/w/xops/participants/{leaver_id}")
    assert resp.status_code == 200
    members = (await auth_client.get("/api/v1/w/xops/members")).json()
    assert all(m["user_id"] != leaver_id for m in members)


async def test_owner_changes_role_and_last_owner_protected(auth_client, client2, workspace):
    resp = await auth_client.post("/api/v1/w/xops/invite-links")
    token = resp.json()["token"]
    await _register(client2, "member@example.com")
    await client2.post(f"/api/v1/join/{token}")

    participants = (await auth_client.get("/api/v1/w/xops/participants")).json()
    target = next(p for p in participants if p["email"] == "member@example.com")
    admin = next(p for p in participants if p["email"] == "admin@example.com")

    # повышение до editor
    resp = await auth_client.patch(
        f"/api/v1/w/xops/participants/{target['user_id']}", json={"role": "editor"}
    )
    assert resp.status_code == 200
    assert resp.json()["role"] == "editor"

    # последний owner защищён
    resp = await auth_client.patch(
        f"/api/v1/w/xops/participants/{admin['user_id']}", json={"role": "viewer"}
    )
    assert resp.status_code == 422
    resp = await auth_client.delete(
        f"/api/v1/w/xops/participants/{admin['user_id']}"
    )
    assert resp.status_code == 422

    # не-owner не управляет участниками
    resp = await client2.patch(
        f"/api/v1/w/xops/participants/{admin['user_id']}", json={"role": "viewer"}
    )
    assert resp.status_code == 403


# ---------- регрессии по security-ревизии ----------

async def test_participants_list_owner_only(auth_client, client2, workspace):
    """Список участников с email — только владельцу (editor/viewer → 403)."""
    await auth_client.patch("/api/v1/w/xops", json={"default_member_role": "editor"})
    resp = await auth_client.post("/api/v1/w/xops/invite-links")
    token = resp.json()["token"]
    await _register(client2, "editor2@example.com")
    await client2.post(f"/api/v1/join/{token}")

    # editor видит таймлайн, но не список доступа
    assert (await client2.get("/api/v1/w/xops/projects")).status_code == 200
    resp = await client2.get("/api/v1/w/xops/participants")
    assert resp.status_code == 403
    # владельцу — доступно
    assert (await auth_client.get("/api/v1/w/xops/participants")).status_code == 200


async def test_backups_superuser_only(auth_client, client2, workspace):
    """/admin/backups доступен только суперпользователю."""
    await _register(client2, "plain@example.com")
    resp = await client2.get("/api/v1/admin/backups")
    assert resp.status_code == 403
    resp = await client2.post("/api/v1/admin/backups/run")
    assert resp.status_code == 403


async def test_spa_path_traversal_blocked(client):
    """SPA-fallback не должен отдавать исходники вне static (обход через %2e%2e).

    Пропускается, если статика не собрана (нет catch-all маршрута)."""
    from pathlib import Path

    from app.core.config import get_settings

    static_dir = (
        Path(__import__("app").__file__).resolve().parent.parent
        / get_settings().static_dir
    )
    if not static_dir.exists():
        import pytest

        pytest.skip("static не собрана")

    for attack in [
        "/%2e%2e/app/main.py",
        "/%2e%2e/%2e%2e/backend/app/core/security.py",
    ]:
        resp = await client.get(attack)
        # ни при каком коде ответа тело не должно содержать серверный исходник
        assert "from fastapi" not in resp.text, attack
        assert "def create_session_token" not in resp.text, attack


async def test_absence_rejects_foreign_member(auth_client, other_workspace, team):
    """Отсутствие нельзя завести на member_id из чужого пространства."""
    import uuid

    resp = await auth_client.post(
        "/api/v1/w/xops/absences",
        json={
            "member_id": str(uuid.uuid4()),
            "date_from": "2026-08-01",
            "date_to": "2026-08-05",
        },
    )
    assert resp.status_code == 404


async def test_milestones_reject_foreign_project_and_member(auth_client, team):
    import uuid

    resp = await auth_client.post(
        "/api/v1/w/xops/projects", json={"code": "MS", "name": "С вехами"}
    )
    assert resp.status_code == 200
    pid = resp.json()["id"]

    # чужой/несуществующий project_id → 404
    resp = await auth_client.put(
        f"/api/v1/w/xops/projects/{uuid.uuid4()}/milestones",
        json=[{"title": "M1"}],
    )
    assert resp.status_code == 404

    # валидный проект, но owner_member_id не из команды → 422
    resp = await auth_client.put(
        f"/api/v1/w/xops/projects/{pid}/milestones",
        json=[{"title": "M1", "owner_member_id": str(uuid.uuid4())}],
    )
    assert resp.status_code == 422

    # корректная веха
    resp = await auth_client.put(
        f"/api/v1/w/xops/projects/{pid}/milestones", json=[{"title": "M1"}]
    )
    assert resp.status_code == 200


async def test_metrics_token_protection(client, monkeypatch):
    from app.core.config import get_settings

    monkeypatch.setenv("METRICS_TOKEN", "s3cret")
    get_settings.cache_clear()
    try:
        assert (await client.get("/metrics")).status_code == 401
        ok = await client.get("/metrics", headers={"Authorization": "Bearer s3cret"})
        assert ok.status_code == 200
        assert (await client.get("/metrics?token=s3cret")).status_code == 200
        assert (await client.get("/metrics?token=wrong")).status_code == 401
    finally:
        get_settings.cache_clear()


# ---------- профиль ----------

async def test_update_profile(auth_client, workspace):
    resp = await auth_client.patch(
        "/api/v1/auth/me", json={"name": "Новое Имя", "email": "newlead@example.com"}
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["name"] == "Новое Имя"
    assert resp.json()["email"] == "newlead@example.com"
    me = await auth_client.get("/api/v1/auth/me")
    assert me.json()["email"] == "newlead@example.com"


async def test_update_profile_email_taken(auth_client, client2, workspace):
    await _register(client2, "taken@example.com")
    resp = await auth_client.patch(
        "/api/v1/auth/me", json={"name": "Тимлид", "email": "taken@example.com"}
    )
    assert resp.status_code == 422


async def test_change_password(client, auth_client, workspace):
    # неверный текущий пароль
    resp = await auth_client.post(
        "/api/v1/auth/me/password",
        json={"current_password": "wrong", "new_password": "brand-new-pass"},
    )
    assert resp.status_code == 400

    # короткий новый пароль
    resp = await auth_client.post(
        "/api/v1/auth/me/password",
        json={"current_password": "admin", "new_password": "short"},
    )
    assert resp.status_code == 422

    # успех, и вход по новому паролю работает
    resp = await auth_client.post(
        "/api/v1/auth/me/password",
        json={"current_password": "admin", "new_password": "brand-new-pass"},
    )
    assert resp.status_code == 200
    login = await client.post(
        "/api/v1/auth/login",
        json={"email": "admin@example.com", "password": "brand-new-pass"},
    )
    assert login.status_code == 200


async def test_profile_requires_auth(client, workspace):
    assert (await client.patch("/api/v1/auth/me", json={"name": "x", "email": "x@y.com"})).status_code == 401
    assert (await client.post("/api/v1/auth/me/password", json={"current_password": "a", "new_password": "abcdefgh"})).status_code == 401
