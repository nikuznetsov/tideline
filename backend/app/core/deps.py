import uuid
from datetime import datetime, timezone

from fastapi import Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.security import SESSION_COOKIE, hash_share_token, read_session_token
from app.db.models import AppUser, ShareLink, Workspace
from app.db.session import get_db


async def get_current_user(
    request: Request, db: AsyncSession = Depends(get_db)
) -> AppUser:
    token = request.cookies.get(SESSION_COOKIE)
    if not token:
        raise HTTPException(status_code=401, detail="Не авторизован")
    uid = read_session_token(token)
    if not uid:
        raise HTTPException(status_code=401, detail="Сессия истекла")
    user = await db.get(AppUser, uuid.UUID(uid))
    if not user:
        raise HTTPException(status_code=401, detail="Пользователь не найден")
    return user


async def get_workspace(db: AsyncSession = Depends(get_db)) -> Workspace:
    slug = get_settings().workspace_slug
    ws = (
        await db.execute(select(Workspace).where(Workspace.slug == slug))
    ).scalar_one_or_none()
    if not ws:
        raise HTTPException(status_code=500, detail="Пространство не инициализировано")
    return ws


async def get_share_workspace(
    token: str, db: AsyncSession = Depends(get_db)
) -> Workspace:
    """Разрешает read-only доступ по токену ссылки. 404 на всё невалидное."""
    link = (
        await db.execute(
            select(ShareLink).where(ShareLink.token_hash == hash_share_token(token))
        )
    ).scalar_one_or_none()
    now = datetime.now(timezone.utc)
    if (
        not link
        or link.revoked_at is not None
        or (link.expires_at is not None and _aware(link.expires_at) < now)
    ):
        raise HTTPException(status_code=404, detail="Ссылка не найдена")
    link.last_accessed_at = now
    await db.commit()
    ws = await db.get(Workspace, link.workspace_id)
    if not ws:
        raise HTTPException(status_code=404, detail="Ссылка не найдена")
    return ws


def _aware(dt: datetime) -> datetime:
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
