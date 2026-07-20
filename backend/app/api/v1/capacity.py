from datetime import date
from decimal import Decimal

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user, get_workspace
from app.db.models import Workspace
from app.db.session import get_db
from app.domain.capacity import search_capacity
from app.schemas import CandidateOut, CapacitySearchOut, MemberOut

router = APIRouter(prefix="/capacity", tags=["capacity"])


@router.get("/search", response_model=CapacitySearchOut)
async def capacity_search(
    date_from: date = Query(alias="from"),
    date_to: date = Query(alias="to"),
    needed_person_days: Decimal = Query(gt=0),
    min_daily: Decimal | None = Query(default=None, ge=0, le=1),
    tags: str | None = None,
    db: AsyncSession = Depends(get_db),
    ws: Workspace = Depends(get_workspace),
    _user=Depends(get_current_user),
):
    tag_list = [t.strip() for t in tags.split(",") if t.strip()] if tags else None
    result = await search_capacity(
        db, ws.id, date_from, date_to, needed_person_days, min_daily, tag_list
    )
    return CapacitySearchOut(
        total_free=result.total_free,
        needed=result.needed,
        enough=result.enough,
        deficit=result.deficit,
        plan_horizon_warning=result.plan_horizon_warning,
        candidates=[
            CandidateOut(
                member=MemberOut.model_validate(c.member),
                free_total=c.free_total,
                free_by_day=c.free_by_day,
                warnings=c.warnings,
            )
            for c in result.candidates
        ],
    )
