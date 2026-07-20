from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user, get_workspace, get_workspace_editor
from app.db.models import AppUser, Workspace
from app.db.session import get_db
from app.domain.accuracy import accuracy_report
from app.domain.week_close import WeekCloseError, close_week, undo_close_week
from app.schemas import CloseWeekRequest

router = APIRouter(prefix="/weeks", tags=["weeks"])


@router.post("/close")
async def close(
    body: CloseWeekRequest,
    db: AsyncSession = Depends(get_db),
    ws: Workspace = Depends(get_workspace_editor),
    user: AppUser = Depends(get_current_user),
):
    try:
        snapshot = await close_week(db, ws.id, body.week_start, user.id)
    except WeekCloseError as e:
        raise HTTPException(422, str(e))
    return {
        "ok": True,
        "week_start": body.week_start.isoformat(),
        "diff": snapshot.payload.get("diff_vs_plan"),
    }


@router.post("/close/undo")
async def undo(
    body: CloseWeekRequest,
    db: AsyncSession = Depends(get_db),
    ws: Workspace = Depends(get_workspace_editor),
    user: AppUser = Depends(get_current_user),
):
    try:
        await undo_close_week(db, ws.id, body.week_start, user.id)
    except WeekCloseError as e:
        raise HTTPException(422, str(e))
    return {"ok": True}


@router.get("/accuracy")
async def accuracy(
    weeks: int = Query(default=8, ge=1, le=52),
    db: AsyncSession = Depends(get_db),
    ws: Workspace = Depends(get_workspace),
    _user=Depends(get_current_user),
):
    return await accuracy_report(db, ws.id, weeks)
