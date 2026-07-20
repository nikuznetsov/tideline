import uuid
from datetime import datetime, timezone

from fastapi import Depends, HTTPException, Path, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import SESSION_COOKIE, hash_share_token, read_session_token
from app.db.models import AppUser, Membership, ShareLink, Workspace
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
    try:
        user_id = uuid.UUID(uid)
    except (ValueError, TypeError):
        raise HTTPException(status_code=401, detail="Сессия недействительна")
    user = await db.get(AppUser, user_id)
    if not user:
        raise HTTPException(status_code=401, detail="Пользователь не найден")
    return user


async def get_current_superuser(
    user: AppUser = Depends(get_current_user),
) -> AppUser:
    """Глобальные операции обслуживания (бэкапы): только суперпользователь."""
    if not user.is_superuser:
        raise HTTPException(status_code=403, detail="Доступно только администратору")
    return user


async def _workspace_with_role(
    workspace_slug: str,
    db: AsyncSession,
    user: AppUser,
) -> tuple[Workspace, str]:
    """Пространство по слагу из пути + роль пользователя в нём.

    Отсутствие membership отвечает 404, а не 403: существование чужих
    пространств не раскрывается.
    """
    ws = (
        await db.execute(select(Workspace).where(Workspace.slug == workspace_slug))
    ).scalar_one_or_none()
    if not ws:
        raise HTTPException(status_code=404, detail="Пространство не найдено")
    membership = (
        await db.execute(
            select(Membership).where(
                Membership.workspace_id == ws.id, Membership.user_id == user.id
            )
        )
    ).scalar_one_or_none()
    if not membership:
        raise HTTPException(status_code=404, detail="Пространство не найдено")
    return ws, membership.role


async def get_workspace(
    workspace_slug: str = Path(),
    db: AsyncSession = Depends(get_db),
    user: AppUser = Depends(get_current_user),
) -> Workspace:
    """Любой участник пространства (viewer и выше)."""
    ws, _ = await _workspace_with_role(workspace_slug, db, user)
    return ws


async def get_workspace_editor(
    workspace_slug: str = Path(),
    db: AsyncSession = Depends(get_db),
    user: AppUser = Depends(get_current_user),
) -> Workspace:
    """Мутирующие операции: editor или owner."""
    ws, role = await _workspace_with_role(workspace_slug, db, user)
    if role not in ("owner", "editor"):
        raise HTTPException(
            status_code=403, detail="У вас режим просмотра — изменения недоступны"
        )
    return ws


async def get_workspace_owner(
    workspace_slug: str = Path(),
    db: AsyncSession = Depends(get_db),
    user: AppUser = Depends(get_current_user),
) -> Workspace:
    """Управление пространством: только owner."""
    ws, role = await _workspace_with_role(workspace_slug, db, user)
    if role != "owner":
        raise HTTPException(
            status_code=403, detail="Доступно только владельцу пространства"
        )
    return ws


async def get_my_role(
    workspace_slug: str = Path(),
    db: AsyncSession = Depends(get_db),
    user: AppUser = Depends(get_current_user),
) -> str:
    _, role = await _workspace_with_role(workspace_slug, db, user)
    return role


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
