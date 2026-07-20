import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user, get_workspace, get_workspace_editor
from app.db.models import Absence, AppUser, Member, Membership, Workspace
from app.db.session import get_db
from app.schemas import (
    AbsenceCreate,
    AbsenceOut,
    MemberCreate,
    MemberOut,
    MemberPatch,
    ReorderRequest,
)
from app.services.audit import record_audit

router = APIRouter(tags=["members"])


def _member_dict(m: Member) -> dict:
    return {
        "name": m.name,
        "role_title": m.role_title,
        "capacity_per_day": str(m.capacity_per_day),
        "tags": list(m.tags or []),
        "is_active": m.is_active,
    }


@router.get("/members", response_model=list[MemberOut])
async def list_members(
    db: AsyncSession = Depends(get_db),
    ws: Workspace = Depends(get_workspace),
    _user=Depends(get_current_user),
):
    rows = (
        await db.execute(
            select(Member, AppUser.email)
            .outerjoin(AppUser, AppUser.id == Member.user_id)
            .where(Member.workspace_id == ws.id, Member.deleted_at.is_(None))
            .order_by(Member.sort_order, Member.name)
        )
    ).all()
    out = []
    for m, email in rows:
        item = MemberOut.model_validate(m)
        item.email = email
        out.append(item)
    return out


@router.post("/members", response_model=MemberOut)
async def create_member(
    body: MemberCreate,
    db: AsyncSession = Depends(get_db),
    ws: Workspace = Depends(get_workspace_editor),
    user: AppUser = Depends(get_current_user),
):
    # в команду попадают только участники пространства
    membership = (
        await db.execute(
            select(Membership).where(
                Membership.workspace_id == ws.id, Membership.user_id == body.user_id
            )
        )
    ).scalar_one_or_none()
    if not membership:
        raise HTTPException(
            422, "Этот аккаунт не участник пространства — сначала пригласите его"
        )
    target = await db.get(AppUser, body.user_id)
    existing = (
        await db.execute(
            select(Member.id).where(
                Member.workspace_id == ws.id,
                Member.user_id == body.user_id,
                Member.deleted_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    if existing:
        raise HTTPException(422, f"{target.name} уже в команде")

    max_order = (
        await db.execute(
            select(func.coalesce(func.max(Member.sort_order), 0)).where(
                Member.workspace_id == ws.id
            )
        )
    ).scalar_one()
    member = Member(
        workspace_id=ws.id,
        user_id=body.user_id,
        name=target.name,
        role_title=body.role_title,
        sort_order=max_order + 1,
    )
    db.add(member)
    await db.flush()
    record_audit(db, ws.id, user.id, "member", member.id, "create", None, _member_dict(member))
    await db.commit()
    out = MemberOut.model_validate(member)
    out.email = target.email
    return out


@router.patch("/members/{member_id}", response_model=MemberOut)
async def patch_member(
    member_id: uuid.UUID,
    body: MemberPatch,
    db: AsyncSession = Depends(get_db),
    ws: Workspace = Depends(get_workspace_editor),
    user: AppUser = Depends(get_current_user),
):
    member = (
        await db.execute(
            select(Member).where(
                Member.workspace_id == ws.id,
                Member.id == member_id,
                Member.deleted_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    if not member:
        raise HTTPException(404, "Сотрудник не найден")
    before = _member_dict(member)
    for field in ("role_title", "capacity_per_day", "tags", "is_active"):
        value = getattr(body, field)
        if value is not None:
            setattr(member, field, value)
    record_audit(db, ws.id, user.id, "member", member.id, "update", before, _member_dict(member))
    await db.commit()
    return member


@router.delete("/members/{member_id}")
async def delete_member(
    member_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    ws: Workspace = Depends(get_workspace_editor),
    user: AppUser = Depends(get_current_user),
):
    member = (
        await db.execute(
            select(Member).where(
                Member.workspace_id == ws.id,
                Member.id == member_id,
                Member.deleted_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    if not member:
        raise HTTPException(404, "Сотрудник не найден")
    member.deleted_at = datetime.now(timezone.utc)
    member.is_active = False
    record_audit(db, ws.id, user.id, "member", member.id, "soft_delete",
                 _member_dict(member), None)
    await db.commit()
    return {"ok": True}


@router.post("/members/reorder")
async def reorder_members(
    body: ReorderRequest,
    db: AsyncSession = Depends(get_db),
    ws: Workspace = Depends(get_workspace_editor),
    _user=Depends(get_current_user),
):
    members = (
        (
            await db.execute(
                select(Member).where(
                    Member.workspace_id == ws.id, Member.id.in_(body.member_ids)
                )
            )
        )
        .scalars()
        .all()
    )
    order = {m_id: i for i, m_id in enumerate(body.member_ids)}
    for m in members:
        m.sort_order = order.get(m.id, m.sort_order)
    await db.commit()
    return {"ok": True}


# ---------- absences ----------

@router.get("/absences", response_model=list[AbsenceOut])
async def list_absences(
    db: AsyncSession = Depends(get_db),
    ws: Workspace = Depends(get_workspace),
    _user=Depends(get_current_user),
):
    return (
        (
            await db.execute(
                select(Absence)
                .where(Absence.workspace_id == ws.id)
                .order_by(Absence.date_from.desc())
            )
        )
        .scalars()
        .all()
    )


@router.post("/absences", response_model=AbsenceOut)
async def create_absence(
    body: AbsenceCreate,
    db: AsyncSession = Depends(get_db),
    ws: Workspace = Depends(get_workspace_editor),
    user: AppUser = Depends(get_current_user),
):
    if body.date_to < body.date_from:
        raise HTTPException(422, "Дата окончания раньше даты начала")

    from app.db.models import Allocation

    conflicting = (
        (
            await db.execute(
                select(Allocation).where(
                    Allocation.workspace_id == ws.id,
                    Allocation.member_id == body.member_id,
                    Allocation.day >= body.date_from,
                    Allocation.day <= body.date_to,
                )
            )
        )
        .scalars()
        .all()
    )
    if conflicting and not body.clear_allocations:
        days = sorted({a.day for a in conflicting})
        total = sum(float(a.load) for a in conflicting)
        raise HTTPException(
            409,
            detail={
                "code": "allocations_exist",
                "days": len(days),
                "total_load": round(total, 2),
                "message": (
                    f"В диапазоне уже есть загрузка: {len(days)} дн., "
                    f"суммарно {round(total, 2)} дн."
                ),
            },
        )
    if conflicting and body.clear_allocations:
        for a in conflicting:
            record_audit(
                db, ws.id, user.id, "allocation", a.id, "delete",
                {
                    "member_id": str(a.member_id),
                    "project_id": str(a.project_id),
                    "day": a.day.isoformat(),
                    "load": str(a.load),
                },
                None,
            )
            await db.delete(a)

    absence = Absence(
        workspace_id=ws.id,
        member_id=body.member_id,
        date_from=body.date_from,
        date_to=body.date_to,
        kind=body.kind,
        note=body.note,
    )
    db.add(absence)
    await db.flush()
    record_audit(
        db, ws.id, user.id, "absence", absence.id, "create", None,
        {
            "member_id": str(body.member_id),
            "date_from": body.date_from.isoformat(),
            "date_to": body.date_to.isoformat(),
            "kind": body.kind,
        },
    )
    await db.commit()
    return absence


@router.delete("/absences/{absence_id}")
async def delete_absence(
    absence_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    ws: Workspace = Depends(get_workspace_editor),
    user: AppUser = Depends(get_current_user),
):
    absence = (
        await db.execute(
            select(Absence).where(
                Absence.workspace_id == ws.id, Absence.id == absence_id
            )
        )
    ).scalar_one_or_none()
    if not absence:
        raise HTTPException(404, "Отсутствие не найдено")
    record_audit(
        db, ws.id, user.id, "absence", absence.id, "delete",
        {
            "member_id": str(absence.member_id),
            "date_from": absence.date_from.isoformat(),
            "date_to": absence.date_to.isoformat(),
        },
        None,
    )
    await db.delete(absence)
    await db.commit()
    return {"ok": True}
