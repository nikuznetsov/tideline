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
