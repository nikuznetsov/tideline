import uuid
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user, get_workspace, get_workspace_editor
from app.db.models import (
    Absence,
    Allocation,
    AppUser,
    Member,
    NonWorkingDay,
    Project,
    Workspace,
)
from app.db.session import get_db
from app.domain.calendar import date_range, is_weekend
from app.schemas import (
    AllocationBulkRequest,
    AllocationCreate,
    AllocationOut,
    AllocationPatch,
    CopyWeekRequest,
)
from app.services.audit import record_audit

router = APIRouter(prefix="/allocations", tags=["allocations"])


def _alloc_dict(a: Allocation) -> dict:
    return {
        "member_id": str(a.member_id),
        "project_id": str(a.project_id),
        "day": a.day.isoformat(),
        "load": str(a.load),
    }


async def _validate_day(db: AsyncSession, ws_id: uuid.UUID, member_id: uuid.UUID, day) -> None:
    if is_weekend(day):
        raise HTTPException(422, "Нельзя поставить аллокацию на выходной день")
    nwd = (
        await db.execute(
            select(NonWorkingDay.id).where(
                NonWorkingDay.workspace_id == ws_id, NonWorkingDay.day == day
            )
        )
    ).scalar_one_or_none()
    if nwd:
        raise HTTPException(422, "Нельзя поставить аллокацию на нерабочий день")
    absent = (
        await db.execute(
            select(Absence.id).where(
                Absence.workspace_id == ws_id,
                Absence.member_id == member_id,
                Absence.date_from <= day,
                Absence.date_to >= day,
            )
        )
    ).scalar_one_or_none()
    if absent:
        raise HTTPException(
            422,
            "День попадает в отсутствие сотрудника — сначала снимите отпуск/отсутствие",
        )


async def _validate_member(db: AsyncSession, ws_id: uuid.UUID, member_id: uuid.UUID) -> None:
    member = (
        await db.execute(
            select(Member.id).where(
                Member.workspace_id == ws_id,
                Member.id == member_id,
                Member.deleted_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    if not member:
        raise HTTPException(404, "Сотрудник не найден")


async def _validate_project_active(db: AsyncSession, ws_id: uuid.UUID, project_id: uuid.UUID):
    project = (
        await db.execute(
            select(Project).where(
                Project.workspace_id == ws_id,
                Project.id == project_id,
                Project.deleted_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    if not project:
        raise HTTPException(404, "Проект не найден")
    if project.lifecycle == "finished":
        raise HTTPException(422, "Проект завершён — новые аллокации на него нельзя")


@router.post("", response_model=AllocationOut)
async def create_allocation(
    body: AllocationCreate,
    db: AsyncSession = Depends(get_db),
    ws: Workspace = Depends(get_workspace_editor),
    user: AppUser = Depends(get_current_user),
):
    await _validate_member(db, ws.id, body.member_id)
    await _validate_project_active(db, ws.id, body.project_id)
    await _validate_day(db, ws.id, body.member_id, body.day)

    existing = (
        await db.execute(
            select(Allocation).where(
                Allocation.workspace_id == ws.id,
                Allocation.member_id == body.member_id,
                Allocation.project_id == body.project_id,
                Allocation.day == body.day,
            )
        )
    ).scalar_one_or_none()
    if existing:
        before = _alloc_dict(existing)
        existing.load = body.load
        record_audit(db, ws.id, user.id, "allocation", existing.id, "update",
                     before, _alloc_dict(existing))
        await db.commit()
        return existing

    alloc = Allocation(
        workspace_id=ws.id,
        member_id=body.member_id,
        project_id=body.project_id,
        day=body.day,
        load=body.load,
        created_by=user.id,
    )
    db.add(alloc)
    await db.flush()
    record_audit(db, ws.id, user.id, "allocation", alloc.id, "create", None, _alloc_dict(alloc))
    await db.commit()
    return alloc


@router.post("/bulk")
async def bulk_allocations(
    body: AllocationBulkRequest,
    db: AsyncSession = Depends(get_db),
    ws: Workspace = Depends(get_workspace_editor),
    user: AppUser = Depends(get_current_user),
):
    """Drag-fill / выделение диапазона: массовое проставление или очистка."""
    affected = 0
    for item in body.items:
        await _validate_member(db, ws.id, item.member_id)
        await _validate_project_active(db, ws.id, item.project_id)
        nw = {
            n.day
            for n in (
                await db.execute(
                    select(NonWorkingDay).where(
                        NonWorkingDay.workspace_id == ws.id,
                        NonWorkingDay.day >= item.date_from,
                        NonWorkingDay.day <= item.date_to,
                    )
                )
            ).scalars()
        }
        absences = (
            (
                await db.execute(
                    select(Absence).where(
                        Absence.workspace_id == ws.id,
                        Absence.member_id == item.member_id,
                        Absence.date_from <= item.date_to,
                        Absence.date_to >= item.date_from,
                    )
                )
            )
            .scalars()
            .all()
        )
        absent_days = set()
        for a in absences:
            for d in date_range(max(a.date_from, item.date_from), min(a.date_to, item.date_to)):
                absent_days.add(d)

        existing = {
            a.day: a
            for a in (
                await db.execute(
                    select(Allocation).where(
                        Allocation.workspace_id == ws.id,
                        Allocation.member_id == item.member_id,
                        Allocation.project_id == item.project_id,
                        Allocation.day >= item.date_from,
                        Allocation.day <= item.date_to,
                    )
                )
            ).scalars()
        }
        for day in date_range(item.date_from, item.date_to):
            if is_weekend(day) or day in nw or day in absent_days:
                continue
            cur = existing.get(day)
            if item.load is None:
                if cur:
                    record_audit(db, ws.id, user.id, "allocation", cur.id, "delete",
                                 _alloc_dict(cur), None)
                    await db.delete(cur)
                    affected += 1
            elif cur:
                before = _alloc_dict(cur)
                cur.load = item.load
                record_audit(db, ws.id, user.id, "allocation", cur.id, "update",
                             before, _alloc_dict(cur))
                affected += 1
            else:
                alloc = Allocation(
                    workspace_id=ws.id,
                    member_id=item.member_id,
                    project_id=item.project_id,
                    day=day,
                    load=item.load,
                    created_by=user.id,
                )
                db.add(alloc)
                await db.flush()
                record_audit(db, ws.id, user.id, "allocation", alloc.id, "create",
                             None, _alloc_dict(alloc))
                affected += 1
    await db.commit()
    return {"affected": affected}


@router.patch("/{allocation_id}", response_model=AllocationOut)
async def patch_allocation(
    allocation_id: uuid.UUID,
    body: AllocationPatch,
    db: AsyncSession = Depends(get_db),
    ws: Workspace = Depends(get_workspace_editor),
    user: AppUser = Depends(get_current_user),
):
    alloc = (
        await db.execute(
            select(Allocation).where(
                Allocation.workspace_id == ws.id, Allocation.id == allocation_id
            )
        )
    ).scalar_one_or_none()
    if not alloc:
        raise HTTPException(404, "Аллокация не найдена")
    before = _alloc_dict(alloc) | {"note": alloc.note}
    if body.load is not None:
        alloc.load = body.load
    if body.note is not None:
        alloc.note = body.note or None
    record_audit(
        db, ws.id, user.id, "allocation", alloc.id, "update",
        before, _alloc_dict(alloc) | {"note": alloc.note},
    )
    await db.commit()
    return alloc


@router.delete("/{allocation_id}")
async def delete_allocation(
    allocation_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    ws: Workspace = Depends(get_workspace_editor),
    user: AppUser = Depends(get_current_user),
):
    alloc = (
        await db.execute(
            select(Allocation).where(
                Allocation.workspace_id == ws.id, Allocation.id == allocation_id
            )
        )
    ).scalar_one_or_none()
    if not alloc:
        raise HTTPException(404, "Аллокация не найдена")
    record_audit(db, ws.id, user.id, "allocation", alloc.id, "delete", _alloc_dict(alloc), None)
    await db.delete(alloc)
    await db.commit()
    return {"ok": True}


@router.post("/copy-week")
async def copy_week(
    body: CopyWeekRequest,
    db: AsyncSession = Depends(get_db),
    ws: Workspace = Depends(get_workspace_editor),
    user: AppUser = Depends(get_current_user),
):
    """Продублировать неделю: mode=replace стирает целевую, merge — дополняет."""
    src_end = body.from_week_start + timedelta(days=6)
    dst_end = body.to_week_start + timedelta(days=6)
    shift = (body.to_week_start - body.from_week_start).days

    source = (
        (
            await db.execute(
                select(Allocation).where(
                    Allocation.workspace_id == ws.id,
                    Allocation.day >= body.from_week_start,
                    Allocation.day <= src_end,
                )
            )
        )
        .scalars()
        .all()
    )
    target = (
        (
            await db.execute(
                select(Allocation).where(
                    Allocation.workspace_id == ws.id,
                    Allocation.day >= body.to_week_start,
                    Allocation.day <= dst_end,
                )
            )
        )
        .scalars()
        .all()
    )
    target_keys = {(a.member_id, a.project_id, a.day) for a in target}

    if body.mode == "replace":
        for a in target:
            record_audit(db, ws.id, user.id, "allocation", a.id, "delete", _alloc_dict(a), None)
            await db.delete(a)
        target_keys = set()
        await db.flush()

    nw = {
        n.day
        for n in (
            await db.execute(
                select(NonWorkingDay).where(
                    NonWorkingDay.workspace_id == ws.id,
                    NonWorkingDay.day >= body.to_week_start,
                    NonWorkingDay.day <= dst_end,
                )
            )
        ).scalars()
    }
    absences = (
        (
            await db.execute(
                select(Absence).where(
                    Absence.workspace_id == ws.id,
                    Absence.date_from <= dst_end,
                    Absence.date_to >= body.to_week_start,
                )
            )
        )
        .scalars()
        .all()
    )
    finished = {
        p.id
        for p in (
            await db.execute(
                select(Project).where(
                    Project.workspace_id == ws.id, Project.lifecycle == "finished"
                )
            )
        ).scalars()
    }

    created = 0
    skipped = 0
    for a in source:
        new_day = a.day + timedelta(days=shift)
        key = (a.member_id, a.project_id, new_day)
        is_absent = any(
            ab.member_id == a.member_id and ab.date_from <= new_day <= ab.date_to
            for ab in absences
        )
        if (
            key in target_keys
            or is_weekend(new_day)
            or new_day in nw
            or is_absent
            or a.project_id in finished
        ):
            skipped += 1
            continue
        alloc = Allocation(
            workspace_id=ws.id,
            member_id=a.member_id,
            project_id=a.project_id,
            day=new_day,
            load=a.load,
            created_by=user.id,
        )
        db.add(alloc)
        await db.flush()
        record_audit(db, ws.id, user.id, "allocation", alloc.id, "create",
                     None, _alloc_dict(alloc))
        created += 1
    await db.commit()
    return {"created": created, "skipped": skipped}
