from datetime import date

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user, get_workspace
from app.db.models import Workspace
from app.db.session import get_db
from app.services.export import (
    export_projects_xlsx,
    export_timeline_csv,
    export_timeline_xlsx,
)

router = APIRouter(prefix="/export", tags=["export"])

XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


@router.get("/timeline.xlsx")
async def timeline_xlsx(
    date_from: date = Query(alias="from"),
    date_to: date = Query(alias="to"),
    db: AsyncSession = Depends(get_db),
    ws: Workspace = Depends(get_workspace),
    _user=Depends(get_current_user),
):
    data = await export_timeline_xlsx(db, ws.id, date_from, date_to)
    return Response(
        content=data,
        media_type=XLSX_MIME,
        headers={
            "Content-Disposition": f"attachment; filename=tideline_{date_from}_{date_to}.xlsx"
        },
    )


@router.get("/timeline.csv")
async def timeline_csv(
    date_from: date = Query(alias="from"),
    date_to: date = Query(alias="to"),
    db: AsyncSession = Depends(get_db),
    ws: Workspace = Depends(get_workspace),
    _user=Depends(get_current_user),
):
    data = await export_timeline_csv(db, ws.id, date_from, date_to)
    return Response(
        content=data.encode("utf-8-sig"),
        media_type="text/csv; charset=utf-8",
        headers={
            "Content-Disposition": f"attachment; filename=tideline_{date_from}_{date_to}.csv"
        },
    )


@router.get("/projects.xlsx")
async def projects_xlsx(
    db: AsyncSession = Depends(get_db),
    ws: Workspace = Depends(get_workspace),
    _user=Depends(get_current_user),
):
    data = await export_projects_xlsx(db, ws.id)
    return Response(
        content=data,
        media_type=XLSX_MIME,
        headers={"Content-Disposition": "attachment; filename=tideline_projects.xlsx"},
    )
