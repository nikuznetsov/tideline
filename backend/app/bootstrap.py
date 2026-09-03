"""Bootstrap: the workspace and the first user from env."""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.security import hash_password
from app.db.models import AppUser, Membership, Workspace


async def ensure_bootstrap(db: AsyncSession) -> Workspace:
    settings = get_settings()
    ws = (
        await db.execute(
            select(Workspace).where(Workspace.slug == settings.workspace_slug)
        )
    ).scalar_one_or_none()
    if not ws:
        ws = Workspace(
            slug=settings.workspace_slug,
            name=settings.workspace_name,
            timezone=settings.tz,
        )
        db.add(ws)

    user = (
        await db.execute(
            select(AppUser).where(AppUser.email == settings.admin_email.lower())
        )
    ).scalar_one_or_none()
    if not user:
        user = AppUser(
            email=settings.admin_email.lower(),
            name="Team lead",
            password_hash=hash_password(settings.admin_password),
            is_superuser=True,
        )
        db.add(user)
    await db.flush()

    membership = (
        await db.execute(
            select(Membership).where(
                Membership.workspace_id == ws.id, Membership.user_id == user.id
            )
        )
    ).scalar_one_or_none()
    if not membership:
        db.add(Membership(workspace_id=ws.id, user_id=user.id, role="owner"))
    await db.commit()
    return ws
