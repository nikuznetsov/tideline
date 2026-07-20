from datetime import date

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user, get_workspace
from app.db.models import Workspace
from app.db.session import get_db
from app.domain.timeline import build_timeline
from app.schemas import TimelineResponse

router = APIRouter(tags=["timeline"])


@router.get("/timeline", response_model=TimelineResponse)
async def timeline(
    date_from: date = Query(alias="from"),
    date_to: date = Query(alias="to"),
    db: AsyncSession = Depends(get_db),
    ws: Workspace = Depends(get_workspace),
    _user=Depends(get_current_user),
):
    return await build_timeline(db, ws.id, date_from, date_to)
