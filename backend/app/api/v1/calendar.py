import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user, get_workspace, get_workspace_editor
from app.db.models import AppUser, NonWorkingDay, Workspace
from app.db.session import get_db
from app.domain.calendar import is_weekend
from app.schemas import NonWorkingDayCreate, NonWorkingDayOut
from app.services.audit import record_audit

router = APIRouter(prefix="/non-working-days", tags=["calendar"])


@router.get("", response_model=list[NonWorkingDayOut])
async def list_non_working_days(
    db: AsyncSession = Depends(get_db),
    ws: Workspace = Depends(get_workspace),
    _user=Depends(get_current_user),
):
    return (
        (
            await db.execute(
                select(NonWorkingDay)
                .where(NonWorkingDay.workspace_id == ws.id)
                .order_by(NonWorkingDay.day)
            )
        )
        .scalars()
        .all()
    )


@router.post("", response_model=NonWorkingDayOut)
async def create_non_working_day(
    body: NonWorkingDayCreate,
    db: AsyncSession = Depends(get_db),
    ws: Workspace = Depends(get_workspace_editor),
    user: AppUser = Depends(get_current_user),
):
    if is_weekend(body.day):
        raise HTTPException(422, "This is already a weekend day (Saturday or Sunday)")
    dup = (
        await db.execute(
            select(NonWorkingDay.id).where(
                NonWorkingDay.workspace_id == ws.id, NonWorkingDay.day == body.day
            )
        )
    ).scalar_one_or_none()
    if dup:
        raise HTTPException(422, "This day is already marked as non-working")
    nwd = NonWorkingDay(workspace_id=ws.id, day=body.day, title=body.title)
    db.add(nwd)
    await db.flush()
    record_audit(
        db, ws.id, user.id, "non_working_day", nwd.id, "create",
        None, {"day": body.day.isoformat(), "title": body.title},
    )
    await db.commit()
    return nwd


@router.delete("/{nwd_id}")
async def delete_non_working_day(
    nwd_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    ws: Workspace = Depends(get_workspace_editor),
    user: AppUser = Depends(get_current_user),
):
    nwd = (
        await db.execute(
            select(NonWorkingDay).where(
                NonWorkingDay.workspace_id == ws.id, NonWorkingDay.id == nwd_id
            )
        )
    ).scalar_one_or_none()
    if not nwd:
        raise HTTPException(404, "Day not found")
    record_audit(
        db, ws.id, user.id, "non_working_day", nwd.id, "delete",
        {"day": nwd.day.isoformat(), "title": nwd.title}, None,
    )
    await db.delete(nwd)
    await db.commit()
    return {"ok": True}
