import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_superuser, get_current_user, get_workspace
from app.db.models import AppUser, AuditLog, Workspace
from app.db.session import get_db
from app.services.backups import list_backups, run_backup_now

router = APIRouter(tags=["admin"])
audit_router = APIRouter(tags=["audit"])


@router.get("/admin/backups")
async def backups(_user=Depends(get_current_superuser)):
    try:
        return await list_backups()
    except RuntimeError as e:
        raise HTTPException(503, str(e))


@router.post("/admin/backups/run")
async def backup_now(_user=Depends(get_current_superuser)):
    try:
        return await run_backup_now()
    except RuntimeError as e:
        raise HTTPException(503, str(e))


@audit_router.get("/audit")
async def audit(
    entity_type: str | None = None,
    entity_id: uuid.UUID | None = None,
    limit: int = Query(default=50, le=200),
    db: AsyncSession = Depends(get_db),
    ws: Workspace = Depends(get_workspace),
    _user=Depends(get_current_user),
):
    q = (
        select(AuditLog, AppUser.name)
        .outerjoin(AppUser, AppUser.id == AuditLog.actor_user_id)
        .where(AuditLog.workspace_id == ws.id)
        .order_by(AuditLog.created_at.desc())
        .limit(limit)
    )
    if entity_type:
        q = q.where(AuditLog.entity_type == entity_type)
    if entity_id:
        q = q.where(AuditLog.entity_id == entity_id)
    rows = (await db.execute(q)).all()
    return [
        {
            "id": r.id,
            "entity_type": r.entity_type,
            "entity_id": str(r.entity_id) if r.entity_id else None,
            "action": r.action,
            "actor_name": actor_name,
            "before": r.before,
            "after": r.after,
            "created_at": r.created_at.isoformat(),
        }
        for r, actor_name in rows
    ]
