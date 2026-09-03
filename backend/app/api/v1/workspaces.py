import re
import secrets
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.deps import (
    get_current_user,
    get_workspace_owner,
)
from app.core.rate_limit import enforce, share_limiter
from app.core.security import generate_share_token, hash_share_token
from app.db.models import (
    Absence,
    Allocation,
    AppUser,
    AuditLog,
    InviteLink,
    Member,
    Membership,
    Milestone,
    NonWorkingDay,
    Project,
    ProjectUpdate,
    ShareLink,
    WeekSnapshot,
    Workspace,
)
from app.db.session import get_db
from app.schemas import (
    InviteLinkCreated,
    InviteLinkOut,
    ParticipantOut,
    ParticipantPatch,
    WorkspaceCreate,
    WorkspaceOut,
    WorkspacePatch,
)
from app.services.audit import record_audit

router = APIRouter(tags=["workspaces"])

SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9-]{1,31}$")


# ---------- my workspaces ----------

@router.get("/workspaces", response_model=list[WorkspaceOut])
async def my_workspaces(
    db: AsyncSession = Depends(get_db),
    user: AppUser = Depends(get_current_user),
):
    rows = (
        await db.execute(
            select(Workspace, Membership.role)
            .join(Membership, Membership.workspace_id == Workspace.id)
            .where(Membership.user_id == user.id)
            .order_by(Workspace.name)
        )
    ).all()
    return [
        WorkspaceOut(
            id=ws.id,
            slug=ws.slug,
            name=ws.name,
            role=role,
            default_member_role=ws.default_member_role,
        )
        for ws, role in rows
    ]


@router.post("/workspaces", response_model=WorkspaceOut)
async def create_workspace(
    body: WorkspaceCreate,
    db: AsyncSession = Depends(get_db),
    user: AppUser = Depends(get_current_user),
):
    slug = body.slug.strip().lower()
    if not SLUG_RE.match(slug):
        raise HTTPException(
            422, "Slug: Latin letters, digits and hyphens, 2 to 32 characters"
        )
    # names may repeat but the slug is unique: if taken, append a random
    # suffix (the first one gets the clean slug)
    final = slug
    while (
        await db.execute(select(Workspace.id).where(Workspace.slug == final))
    ).scalar_one_or_none():
        suffix = secrets.token_hex(3)
        base = slug[: 32 - len(suffix) - 1].rstrip("-")
        final = f"{base}-{suffix}"
    ws = Workspace(slug=final, name=body.name.strip() or final)
    db.add(ws)
    await db.flush()
    db.add(Membership(workspace_id=ws.id, user_id=user.id, role="owner"))
    record_audit(db, ws.id, user.id, "workspace", ws.id, "create",
                 None, {"slug": slug, "name": ws.name})
    await db.commit()
    return WorkspaceOut(
        id=ws.id, slug=ws.slug, name=ws.name, role="owner",
        default_member_role=ws.default_member_role,
    )


@router.patch("/w/{workspace_slug}", response_model=WorkspaceOut)
async def patch_workspace(
    body: WorkspacePatch,
    db: AsyncSession = Depends(get_db),
    ws: Workspace = Depends(get_workspace_owner),
    user: AppUser = Depends(get_current_user),
):
    before = {"name": ws.name, "default_member_role": ws.default_member_role}
    if body.name is not None:
        ws.name = body.name.strip() or ws.name
    if body.default_member_role is not None:
        if body.default_member_role not in ("viewer", "editor"):
            raise HTTPException(422, "Default role must be viewer or editor")
        ws.default_member_role = body.default_member_role
    record_audit(db, ws.id, user.id, "workspace", ws.id, "update",
                 before, {"name": ws.name, "default_member_role": ws.default_member_role})
    await db.commit()
    return WorkspaceOut(
        id=ws.id, slug=ws.slug, name=ws.name, role="owner",
        default_member_role=ws.default_member_role,
    )


@router.delete("/w/{workspace_slug}")
async def delete_workspace(
    db: AsyncSession = Depends(get_db),
    ws: Workspace = Depends(get_workspace_owner),
    _user: AppUser = Depends(get_current_user),
):
    """Full deletion of a workspace with all its data (owner only).

    Order matters: first the tables referencing member/project, then the
    rest of the workspace data, and the workspace itself last.
    No audit entry — the workspace's log is deleted along with it.
    """
    for model in (
        Allocation, Absence, Milestone, ProjectUpdate,
        WeekSnapshot, NonWorkingDay, ShareLink, InviteLink,
        AuditLog, Membership, Member, Project,
    ):
        await db.execute(delete(model).where(model.workspace_id == ws.id))
    await db.delete(ws)
    await db.commit()
    return {"ok": True}


# ---------- participants ----------

@router.get("/w/{workspace_slug}/participants", response_model=list[ParticipantOut])
async def participants(
    db: AsyncSession = Depends(get_db),
    ws: Workspace = Depends(get_workspace_owner),
):
    rows = (
        await db.execute(
            select(AppUser, Membership.role)
            .join(Membership, Membership.user_id == AppUser.id)
            .where(Membership.workspace_id == ws.id)
            .order_by(AppUser.name)
        )
    ).all()
    return [
        ParticipantOut(user_id=u.id, name=u.name, email=u.email, role=role)
        for u, role in rows
    ]


async def _owners_count(db: AsyncSession, ws_id: uuid.UUID) -> int:
    return (
        await db.execute(
            select(func.count()).select_from(Membership).where(
                Membership.workspace_id == ws_id, Membership.role == "owner"
            )
        )
    ).scalar_one()


@router.patch("/w/{workspace_slug}/participants/{user_id}", response_model=ParticipantOut)
async def change_role(
    user_id: uuid.UUID,
    body: ParticipantPatch,
    db: AsyncSession = Depends(get_db),
    ws: Workspace = Depends(get_workspace_owner),
    actor: AppUser = Depends(get_current_user),
):
    if body.role not in ("owner", "editor", "viewer"):
        raise HTTPException(422, "Role must be owner, editor or viewer")
    membership = (
        await db.execute(
            select(Membership).where(
                Membership.workspace_id == ws.id, Membership.user_id == user_id
            )
        )
    ).scalar_one_or_none()
    if not membership:
        raise HTTPException(404, "Participant not found")
    if (
        membership.role == "owner"
        and body.role != "owner"
        and await _owners_count(db, ws.id) == 1
    ):
        raise HTTPException(422, "Cannot demote the last owner")
    before = membership.role
    membership.role = body.role
    record_audit(db, ws.id, actor.id, "membership", membership.id, "change_role",
                 {"role": before}, {"role": body.role})
    await db.commit()
    target = await db.get(AppUser, user_id)
    return ParticipantOut(
        user_id=user_id, name=target.name, email=target.email, role=body.role
    )


@router.delete("/w/{workspace_slug}/participants/{user_id}")
async def remove_participant(
    user_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    ws: Workspace = Depends(get_workspace_owner),
    actor: AppUser = Depends(get_current_user),
):
    membership = (
        await db.execute(
            select(Membership).where(
                Membership.workspace_id == ws.id, Membership.user_id == user_id
            )
        )
    ).scalar_one_or_none()
    if not membership:
        raise HTTPException(404, "Participant not found")
    if membership.role == "owner" and await _owners_count(db, ws.id) == 1:
        raise HTTPException(422, "Cannot remove the last owner")
    record_audit(db, ws.id, actor.id, "membership", membership.id, "remove",
                 {"user_id": str(user_id), "role": membership.role}, None)
    await db.delete(membership)

    # the team is a subset of participants: no access means no timeline row either
    from app.db.models import Member

    linked = (
        await db.execute(
            select(Member).where(
                Member.workspace_id == ws.id,
                Member.user_id == user_id,
                Member.deleted_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    if linked:
        linked.deleted_at = datetime.now(timezone.utc)
        linked.is_active = False
        record_audit(db, ws.id, actor.id, "member", linked.id, "soft_delete",
                     {"name": linked.name, "reason": "access_removed"}, None)
    await db.commit()
    return {"ok": True}


# ---------- invite links ----------

@router.get("/w/{workspace_slug}/invite-links", response_model=list[InviteLinkOut])
async def list_invite_links(
    db: AsyncSession = Depends(get_db),
    ws: Workspace = Depends(get_workspace_owner),
):
    links = (
        (
            await db.execute(
                select(InviteLink)
                .where(InviteLink.workspace_id == ws.id)
                .order_by(InviteLink.created_at.desc())
            )
        )
        .scalars()
        .all()
    )
    base_url = get_settings().app_base_url
    out = []
    for link in links:
        item = InviteLinkOut.model_validate(link)
        if link.token and link.revoked_at is None:
            item.url = f"{base_url}/join/{link.token}"
        out.append(item)
    return out


@router.post("/w/{workspace_slug}/invite-links", response_model=InviteLinkCreated)
async def create_invite_link(
    db: AsyncSession = Depends(get_db),
    ws: Workspace = Depends(get_workspace_owner),
    user: AppUser = Depends(get_current_user),
):
    token = generate_share_token()
    link = InviteLink(
        workspace_id=ws.id,
        token_hash=hash_share_token(token),
        token_prefix=token[:8],
        token=token,
        created_by=user.id,
    )
    db.add(link)
    await db.flush()
    record_audit(db, ws.id, user.id, "invite_link", link.id, "create",
                 None, {"token_prefix": link.token_prefix})
    await db.commit()
    out = InviteLinkCreated.model_validate(link)
    out.token = token
    out.url = f"{get_settings().app_base_url}/join/{token}"
    return out


@router.delete("/w/{workspace_slug}/invite-links/{link_id}")
async def revoke_invite_link(
    link_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    ws: Workspace = Depends(get_workspace_owner),
    user: AppUser = Depends(get_current_user),
):
    link = (
        await db.execute(
            select(InviteLink).where(
                InviteLink.workspace_id == ws.id, InviteLink.id == link_id
            )
        )
    ).scalar_one_or_none()
    if not link:
        raise HTTPException(404, "Link not found")
    link.revoked_at = datetime.now(timezone.utc)
    record_audit(db, ws.id, user.id, "invite_link", link.id, "revoke",
                 {"token_prefix": link.token_prefix}, None)
    await db.commit()
    return {"ok": True}


# ---------- joining via link ----------

async def _valid_invite(db: AsyncSession, token: str) -> InviteLink:
    link = (
        await db.execute(
            select(InviteLink).where(InviteLink.token_hash == hash_share_token(token))
        )
    ).scalar_one_or_none()
    if not link or link.revoked_at is not None:
        raise HTTPException(404, "Invite not found or revoked")
    return link


@router.get("/join/{token}")
async def join_info(token: str, request: Request, db: AsyncSession = Depends(get_db)):
    """Public info for the join page: where the user is being invited."""
    enforce(share_limiter, request)
    link = await _valid_invite(db, token)
    ws = await db.get(Workspace, link.workspace_id)
    return {"workspace_name": ws.name, "workspace_slug": ws.slug}


@router.post("/join/{token}")
async def join_workspace(
    token: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: AppUser = Depends(get_current_user),
):
    enforce(share_limiter, request)
    link = await _valid_invite(db, token)
    ws = await db.get(Workspace, link.workspace_id)
    existing = (
        await db.execute(
            select(Membership).where(
                Membership.workspace_id == ws.id, Membership.user_id == user.id
            )
        )
    ).scalar_one_or_none()
    if not existing:
        membership = Membership(
            workspace_id=ws.id, user_id=user.id, role=ws.default_member_role
        )
        db.add(membership)
        await db.flush()
        record_audit(db, ws.id, user.id, "membership", membership.id, "join",
                     None, {"role": ws.default_member_role})
    link.last_used_at = datetime.now(timezone.utc)
    await db.commit()
    return {"workspace_slug": ws.slug, "role": existing.role if existing else ws.default_member_role}
