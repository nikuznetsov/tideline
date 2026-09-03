"""Iteration 2: sign-up, workspaces, roles, joining via link."""

from httpx import AsyncClient


async def _register(client: AsyncClient, email: str, password: str = "secret-123"):
    resp = await client.post(
        "/api/v1/auth/register",
        json={
            "first_name": "Peter",
            "last_name": "Tester",
            "email": email,
            "password": password,
        },
    )
    return resp


async def test_register_and_me(client, workspace):
    resp = await _register(client, "new@example.com")
    assert resp.status_code == 200, resp.text
    assert resp.json()["name"] == "Peter Tester"
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
    # and a foreign workspace answers 404 without disclosing its existence
    resp = await client.get("/api/v1/w/acme/projects")
    assert resp.status_code == 404


async def test_create_own_workspace(client, workspace):
    await _register(client, "founder@example.com")
    resp = await client.post(
        "/api/v1/workspaces", json={"name": "My team", "slug": "my-team"}
    )
    assert resp.status_code == 200
    assert resp.json()["role"] == "owner"
    resp = await client.get("/api/v1/w/my-team/projects")
    assert resp.status_code == 200
    # bad slug
    resp = await client.post(
        "/api/v1/workspaces", json={"name": "x", "slug": "Bad slug!"}
    )
    assert resp.status_code == 422


async def test_join_by_invite_link_default_viewer(auth_client, client2, team, monday):
    # owner creates an invite link
    resp = await auth_client.post("/api/v1/w/acme/invite-links")
    assert resp.status_code == 200, resp.text
    token = resp.json()["token"]

    # a new user joins
    await _register(client2, "joiner@example.com")
    info = await client2.get(f"/api/v1/join/{token}")
    assert info.status_code == 200
    assert info.json()["workspace_slug"] == "acme"
    resp = await client2.post(f"/api/v1/join/{token}")
    assert resp.status_code == 200
    assert resp.json()["role"] == "viewer"

    # viewer can see but not change
    resp = await client2.get("/api/v1/w/acme/projects")
    assert resp.status_code == 200
    resp = await client2.post(
        "/api/v1/w/acme/allocations",
        json={
            "member_id": str(team["members"][0].id),
            "project_id": str(team["project"].id),
            "day": monday.isoformat(),
            "category": "full",
        },
    )
    assert resp.status_code == 403
    resp = await client2.post(
        "/api/v1/w/acme/projects", json={"code": "X", "name": "x"}
    )
    assert resp.status_code == 403
    # and does not manage the workspace
    resp = await client2.get("/api/v1/w/acme/invite-links")
    assert resp.status_code == 403


async def test_default_role_editor(auth_client, client2, workspace):
    resp = await auth_client.patch(
        "/api/v1/w/acme", json={"default_member_role": "editor"}
    )
    assert resp.status_code == 200
    resp = await auth_client.post("/api/v1/w/acme/invite-links")
    token = resp.json()["token"]

    await _register(client2, "editor@example.com")
    resp = await client2.post(f"/api/v1/join/{token}")
    assert resp.json()["role"] == "editor"
    # editor can create projects
    resp = await client2.post(
        "/api/v1/w/acme/projects", json={"code": "EDT", "name": "Editor's project"}
    )
    assert resp.status_code == 200


async def test_revoked_invite_404(auth_client, client2, workspace):
    resp = await auth_client.post("/api/v1/w/acme/invite-links")
    token, link_id = resp.json()["token"], resp.json()["id"]
    await auth_client.delete(f"/api/v1/w/acme/invite-links/{link_id}")
    await _register(client2, "late@example.com")
    resp = await client2.post(f"/api/v1/join/{token}")
    assert resp.status_code == 404


async def test_team_member_is_participant(auth_client, client2, workspace):
    """The team is a subset of participants: no free-form name entry."""
    # an outsider (not a participant) — not allowed
    await _register(client2, "outsider@example.com")
    outsider_id = (await client2.get("/api/v1/auth/me")).json()["id"]
    resp = await auth_client.post(
        "/api/v1/w/acme/members", json={"user_id": outsider_id}
    )
    assert resp.status_code == 422

    # a participant — allowed, the name comes from the account
    invite = await auth_client.post("/api/v1/w/acme/invite-links")
    await client2.post(f"/api/v1/join/{invite.json()['token']}")
    resp = await auth_client.post(
        "/api/v1/w/acme/members",
        json={"user_id": outsider_id, "role_title": "Engineer"},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["name"] == "Peter Tester"
    assert resp.json()["email"] == "outsider@example.com"

    # second time — already in the team
    resp = await auth_client.post(
        "/api/v1/w/acme/members", json={"user_id": outsider_id}
    )
    assert resp.status_code == 422


async def test_removing_access_removes_from_team(auth_client, client2, workspace):
    await _register(client2, "leaver@example.com")
    leaver_id = (await client2.get("/api/v1/auth/me")).json()["id"]
    invite = await auth_client.post("/api/v1/w/acme/invite-links")
    await client2.post(f"/api/v1/join/{invite.json()['token']}")
    await auth_client.post("/api/v1/w/acme/members", json={"user_id": leaver_id})

    members = (await auth_client.get("/api/v1/w/acme/members")).json()
    assert any(m["user_id"] == leaver_id for m in members)

    resp = await auth_client.delete(f"/api/v1/w/acme/participants/{leaver_id}")
    assert resp.status_code == 200
    members = (await auth_client.get("/api/v1/w/acme/members")).json()
    assert all(m["user_id"] != leaver_id for m in members)


async def test_owner_changes_role_and_last_owner_protected(auth_client, client2, workspace):
    resp = await auth_client.post("/api/v1/w/acme/invite-links")
    token = resp.json()["token"]
    await _register(client2, "member@example.com")
    await client2.post(f"/api/v1/join/{token}")

    participants = (await auth_client.get("/api/v1/w/acme/participants")).json()
    target = next(p for p in participants if p["email"] == "member@example.com")
    admin = next(p for p in participants if p["email"] == "admin@example.com")

    # promotion to editor
    resp = await auth_client.patch(
        f"/api/v1/w/acme/participants/{target['user_id']}", json={"role": "editor"}
    )
    assert resp.status_code == 200
    assert resp.json()["role"] == "editor"

    # the last owner is protected
    resp = await auth_client.patch(
        f"/api/v1/w/acme/participants/{admin['user_id']}", json={"role": "viewer"}
    )
    assert resp.status_code == 422
    resp = await auth_client.delete(
        f"/api/v1/w/acme/participants/{admin['user_id']}"
    )
    assert resp.status_code == 422

    # a non-owner does not manage participants
    resp = await client2.patch(
        f"/api/v1/w/acme/participants/{admin['user_id']}", json={"role": "viewer"}
    )
    assert resp.status_code == 403


# ---------- regressions from the security review ----------

async def test_participants_list_owner_only(auth_client, client2, workspace):
    """The participant list with emails is owner-only (editor/viewer → 403)."""
    await auth_client.patch("/api/v1/w/acme", json={"default_member_role": "editor"})
    resp = await auth_client.post("/api/v1/w/acme/invite-links")
    token = resp.json()["token"]
    await _register(client2, "editor2@example.com")
    await client2.post(f"/api/v1/join/{token}")

    # editor sees the timeline but not the access list
    assert (await client2.get("/api/v1/w/acme/projects")).status_code == 200
    resp = await client2.get("/api/v1/w/acme/participants")
    assert resp.status_code == 403
    # the owner has access
    assert (await auth_client.get("/api/v1/w/acme/participants")).status_code == 200


async def test_backups_superuser_only(auth_client, client2, workspace):
    """/admin/backups is superuser-only."""
    await _register(client2, "plain@example.com")
    resp = await client2.get("/api/v1/admin/backups")
    assert resp.status_code == 403
    resp = await client2.post("/api/v1/admin/backups/run")
    assert resp.status_code == 403


async def test_spa_path_traversal_blocked(client):
    """The SPA fallback must not serve sources outside static (traversal via %2e%2e).

    Skipped when the static bundle is not built (no catch-all route)."""
    from pathlib import Path

    from app.core.config import get_settings

    static_dir = (
        Path(__import__("app").__file__).resolve().parent.parent
        / get_settings().static_dir
    )
    if not static_dir.exists():
        import pytest

        pytest.skip("static bundle not built")

    for attack in [
        "/%2e%2e/app/main.py",
        "/%2e%2e/%2e%2e/backend/app/core/security.py",
    ]:
        resp = await client.get(attack)
        # whatever the status code, the body must never contain server source
        assert "from fastapi" not in resp.text, attack
        assert "def create_session_token" not in resp.text, attack


async def test_absence_rejects_foreign_member(auth_client, other_workspace, team):
    """An absence cannot be created for a member_id from a foreign workspace."""
    import uuid

    resp = await auth_client.post(
        "/api/v1/w/acme/absences",
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
        "/api/v1/w/acme/projects", json={"code": "MS", "name": "With milestones"}
    )
    assert resp.status_code == 200
    pid = resp.json()["id"]

    # foreign/non-existent project_id → 404
    resp = await auth_client.put(
        f"/api/v1/w/acme/projects/{uuid.uuid4()}/milestones",
        json=[{"title": "M1"}],
    )
    assert resp.status_code == 404

    # valid project but owner_member_id not from the team → 422
    resp = await auth_client.put(
        f"/api/v1/w/acme/projects/{pid}/milestones",
        json=[{"title": "M1", "owner_member_id": str(uuid.uuid4())}],
    )
    assert resp.status_code == 422

    # a valid milestone
    resp = await auth_client.put(
        f"/api/v1/w/acme/projects/{pid}/milestones", json=[{"title": "M1"}]
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


# ---------- profile ----------

async def test_update_profile(auth_client, workspace):
    resp = await auth_client.patch(
        "/api/v1/auth/me", json={"name": "New Name", "email": "newlead@example.com"}
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["name"] == "New Name"
    assert resp.json()["email"] == "newlead@example.com"
    me = await auth_client.get("/api/v1/auth/me")
    assert me.json()["email"] == "newlead@example.com"


async def test_update_profile_email_taken(auth_client, client2, workspace):
    await _register(client2, "taken@example.com")
    resp = await auth_client.patch(
        "/api/v1/auth/me", json={"name": "Team lead", "email": "taken@example.com"}
    )
    assert resp.status_code == 422


async def test_change_password(client, auth_client, workspace):
    # wrong current password
    resp = await auth_client.post(
        "/api/v1/auth/me/password",
        json={"current_password": "wrong", "new_password": "brand-new-pass"},
    )
    assert resp.status_code == 400

    # new password too short
    resp = await auth_client.post(
        "/api/v1/auth/me/password",
        json={"current_password": "admin", "new_password": "short"},
    )
    assert resp.status_code == 422

    # success, and login with the new password works
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


async def test_duplicate_slug_gets_suffix(client, workspace):
    await _register(client, "founder2@example.com")
    # claim a slug of our own; a second workspace with the same slug must get a suffix
    r1 = await client.post("/api/v1/workspaces", json={"name": "First", "slug": "team"})
    assert r1.status_code == 200
    assert r1.json()["slug"] == "team"
    # a second one with the same slug and the same name — the slug gets a suffix
    r2 = await client.post("/api/v1/workspaces", json={"name": "First", "slug": "team"})
    assert r2.status_code == 200
    assert r2.json()["slug"] != "team"
    assert r2.json()["slug"].startswith("team-")
    assert r2.json()["name"] == "First"  # names may repeat


async def test_delete_workspace_owner_only(auth_client, client2, team, monday):
    # the workspace has a team, projects and allocations
    resp = await auth_client.post(
        "/api/v1/w/acme/allocations",
        json={
            "member_id": str(team["members"][0].id),
            "project_id": str(team["project"].id),
            "day": monday.isoformat(),
            "category": "half",
        },
    )
    assert resp.status_code == 200, resp.text

    # a non-owner participant cannot delete
    await _register(client2, "joiner-del@example.com")
    invite = await auth_client.post("/api/v1/w/acme/invite-links")
    await client2.post(f"/api/v1/join/{invite.json()['token']}")
    assert (await client2.delete("/api/v1/w/acme")).status_code == 403

    # the owner deletes — the workspace disappears for everyone and by slug
    assert (await auth_client.delete("/api/v1/w/acme")).status_code == 200
    assert (await auth_client.get("/api/v1/workspaces")).json() == []
    assert (await client2.get("/api/v1/workspaces")).json() == []
    assert (await auth_client.get("/api/v1/w/acme/projects")).status_code == 404
