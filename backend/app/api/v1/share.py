import uuid
from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.deps import get_current_user, get_share_workspace, get_workspace, get_workspace_owner
from app.core.rate_limit import enforce, share_limiter
from app.core.security import generate_share_token, hash_share_token
from app.db.models import AppUser, Project, ShareLink, Workspace
from app.db.session import get_db
from app.domain.calendar import week_start_of
from app.domain.timeline import build_timeline
from app.schemas import (
    ShareLinkCreate,
    ShareLinkCreated,
    ShareLinkOut,
    TimelineResponse,
)
from app.services.audit import record_audit

router = APIRouter(tags=["share"])


@router.get("/share-links", response_model=list[ShareLinkOut])
async def list_share_links(
    db: AsyncSession = Depends(get_db),
    ws: Workspace = Depends(get_workspace_owner),
    _user=Depends(get_current_user),
):
    links = (
        (
            await db.execute(
                select(ShareLink)
                .where(ShareLink.workspace_id == ws.id)
                .order_by(ShareLink.created_at.desc())
            )
        )
        .scalars()
        .all()
    )
    base_url = get_settings().app_base_url
    out = []
    for link in links:
        item = ShareLinkOut.model_validate(link)
        if link.token and link.revoked_at is None:
            item.url = f"{base_url}/s/{link.token}"
        out.append(item)
    return out


@router.post("/share-links", response_model=ShareLinkCreated)
async def create_share_link(
    body: ShareLinkCreate,
    db: AsyncSession = Depends(get_db),
    ws: Workspace = Depends(get_workspace_owner),
    user: AppUser = Depends(get_current_user),
):
    token = generate_share_token()
    link = ShareLink(
        workspace_id=ws.id,
        token_hash=hash_share_token(token),
        token_prefix=token[:8],
        token=token,
        expires_at=body.expires_at,
    )
    db.add(link)
    await db.flush()
    record_audit(db, ws.id, user.id, "share_link", link.id, "create", None,
                 {"token_prefix": link.token_prefix})
    await db.commit()
    out = ShareLinkCreated.model_validate(link)
    out.token = token
    out.url = f"{get_settings().app_base_url}/s/{token}"
    return out


@router.delete("/share-links/{link_id}")
async def revoke_share_link(
    link_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    ws: Workspace = Depends(get_workspace_owner),
    user: AppUser = Depends(get_current_user),
):
    from datetime import datetime, timezone

    link = (
        await db.execute(
            select(ShareLink).where(
                ShareLink.workspace_id == ws.id, ShareLink.id == link_id
            )
        )
    ).scalar_one_or_none()
    if not link:
        raise HTTPException(404, "Ссылка не найдена")
    link.revoked_at = datetime.now(timezone.utc)
    record_audit(db, ws.id, user.id, "share_link", link.id, "revoke",
                 {"token_prefix": link.token_prefix}, None)
    await db.commit()
    return {"ok": True}


# ---------- публичные read-only эндпоинты ----------

public_router = APIRouter(prefix="/s", tags=["public"])


@public_router.get("/{token}/timeline", response_model=TimelineResponse)
async def public_timeline(
    token: str,
    request: Request,
    date_from: date | None = None,
    date_to: date | None = None,
    db: AsyncSession = Depends(get_db),
):
    enforce(share_limiter, request)
    ws = await get_share_workspace(token, db)
    if not date_from:
        date_from = week_start_of(date.today())
    if not date_to:
        date_to = date_from + timedelta(days=13)
    if (date_to - date_from).days > 60:
        raise HTTPException(422, "Слишком большой диапазон")
    return await build_timeline(db, ws.id, date_from, date_to, public=True)


@public_router.get("/{token}/projects")
async def public_projects(
    token: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    enforce(share_limiter, request)
    ws = await get_share_workspace(token, db)
    projects = (
        (
            await db.execute(
                select(Project)
                .where(
                    Project.workspace_id == ws.id,
                    Project.deleted_at.is_(None),
                    Project.lifecycle != "finished",
                )
                .order_by(Project.code)
            )
        )
        .scalars()
        .all()
    )
    # публичный сериализатор: только безопасные поля, никаких заметок и внутренних md
    return [
        {
            "id": str(p.id),
            "code": p.code,
            "name": p.name,
            "lifecycle": p.lifecycle,
            "health": p.health,
        }
        for p in projects
    ]
