import uuid
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import (
    get_current_user,
    get_my_role,
    get_workspace,
    get_workspace_editor,
)
from app.db.models import (
    Allocation,
    AppUser,
    Member,
    Milestone,
    Project,
    ProjectUpdate,
    Workspace,
)
from app.db.session import get_db
from app.domain.calendar import week_start_of
from app.domain.categories import weight_sql
from app.schemas import (
    MemberOut,
    MilestoneIn,
    MilestoneOut,
    ProjectCreate,
    ProjectDetail,
    ProjectListItem,
    ProjectLoadOut,
    ProjectLoadRow,
    ProjectPatch,
    ProjectUpdateIn,
    ProjectUpdateOut,
)
from app.services.audit import record_audit

router = APIRouter(prefix="/projects", tags=["projects"])

STATUS_FIELDS = {"health", "weekly_update"}


@router.get("", response_model=list[ProjectListItem])
async def list_projects(
    lifecycle: str | None = None,
    include_finished: bool = False,
    db: AsyncSession = Depends(get_db),
    ws: Workspace = Depends(get_workspace),
    _user=Depends(get_current_user),
):
    q = select(Project).where(
        Project.workspace_id == ws.id, Project.deleted_at.is_(None)
    )
    if lifecycle:
        q = q.where(Project.lifecycle == lifecycle)
    elif not include_finished:
        q = q.where(Project.lifecycle != "finished")
    projects = (await db.execute(q.order_by(Project.code))).scalars().all()

    # current headcount — for the current week, in one query
    today = date.today()
    week_start = week_start_of(today)
    counts = dict(
        (
            await db.execute(
                select(
                    Allocation.project_id,
                    func.count(func.distinct(Allocation.member_id)),
                )
                .where(
                    Allocation.workspace_id == ws.id,
                    Allocation.day >= week_start,
                    Allocation.day <= week_start + timedelta(days=6),
                )
                .group_by(Allocation.project_id)
            )
        ).all()
    )
    out = []
    for p in projects:
        item = ProjectListItem.model_validate(p)
        item.active_members_count = counts.get(p.id, 0)
        out.append(item)
    return out


@router.post("", response_model=ProjectDetail)
async def create_project(
    body: ProjectCreate,
    db: AsyncSession = Depends(get_db),
    ws: Workspace = Depends(get_workspace_editor),
    user: AppUser = Depends(get_current_user),
):
    dup = (
        await db.execute(
            select(Project.id).where(
                Project.workspace_id == ws.id,
                Project.code == body.code,
                Project.deleted_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    if dup:
        raise HTTPException(422, f"Project code {body.code} is already taken")
    project = Project(
        workspace_id=ws.id,
        code=body.code,
        name=body.name,
        goal=body.goal,
        status_updated_at=datetime.now(timezone.utc),
    )
    db.add(project)
    await db.flush()
    record_audit(db, ws.id, user.id, "project", project.id, "create",
                 None, {"code": body.code, "name": body.name})
    await db.commit()
    return await get_project(project.id, db, ws, user)


@router.get("/{project_id}", response_model=ProjectDetail)
async def get_project(
    project_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    ws: Workspace = Depends(get_workspace),
    _user=Depends(get_current_user),
):
    project = (
        await db.execute(
            select(Project).where(
                Project.workspace_id == ws.id,
                Project.id == project_id,
                Project.deleted_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    if not project:
        raise HTTPException(404, "Project not found")
    milestones = (
        (
            await db.execute(
                select(Milestone)
                .where(
                    Milestone.workspace_id == ws.id, Milestone.project_id == project_id
                )
                .order_by(Milestone.sort_order, Milestone.due_date)
            )
        )
        .scalars()
        .all()
    )
    updates = (
        await db.execute(
            select(ProjectUpdate, AppUser.name)
            .outerjoin(AppUser, AppUser.id == ProjectUpdate.created_by)
            .where(
                ProjectUpdate.workspace_id == ws.id,
                ProjectUpdate.project_id == project_id,
            )
            .order_by(ProjectUpdate.on_date.desc(), ProjectUpdate.created_at.desc())
        )
    ).all()
    detail = ProjectDetail.model_validate(project)
    detail.milestones = [MilestoneOut.model_validate(m) for m in milestones]
    detail.updates = []
    for u, author_name in updates:
        item = ProjectUpdateOut.model_validate(u)
        item.author_name = author_name
        detail.updates.append(item)
    return detail


@router.patch("/{project_id}", response_model=ProjectDetail)
async def patch_project(
    project_id: uuid.UUID,
    body: ProjectPatch,
    db: AsyncSession = Depends(get_db),
    ws: Workspace = Depends(get_workspace_editor),
    user: AppUser = Depends(get_current_user),
):
    project = (
        await db.execute(
            select(Project).where(
                Project.workspace_id == ws.id,
                Project.id == project_id,
                Project.deleted_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    if not project:
        raise HTTPException(404, "Project not found")
    data = body.model_dump(exclude_unset=True)
    before = {k: _jsonable(getattr(project, k)) for k in data}
    for k, v in data.items():
        setattr(project, k, v)
    if STATUS_FIELDS & set(data):
        project.status_updated_at = datetime.now(timezone.utc)
    record_audit(db, ws.id, user.id, "project", project.id, "update",
                 before, {k: _jsonable(v) for k, v in data.items()})
    await db.commit()
    return await get_project(project_id, db, ws, user)


def _jsonable(v):
    if isinstance(v, (date, datetime)):
        return v.isoformat()
    if isinstance(v, uuid.UUID):
        return str(v)
    return v


@router.delete("/{project_id}")
async def delete_project(
    project_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    ws: Workspace = Depends(get_workspace_editor),
    user: AppUser = Depends(get_current_user),
):
    project = (
        await db.execute(
            select(Project).where(
                Project.workspace_id == ws.id,
                Project.id == project_id,
                Project.deleted_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    if not project:
        raise HTTPException(404, "Project not found")
    project.deleted_at = datetime.now(timezone.utc)
    # a deleted project's load would linger on the timeline as nameless
    # rows — remove it with the project (week history lives in snapshots)
    removed = (
        await db.execute(
            delete(Allocation).where(
                Allocation.workspace_id == ws.id,
                Allocation.project_id == project.id,
            )
        )
    ).rowcount
    record_audit(db, ws.id, user.id, "project", project.id, "soft_delete",
                 {"code": project.code, "name": project.name,
                  "allocations_removed": removed}, None)
    await db.commit()
    return {"ok": True, "allocations_removed": removed}


async def _refresh_weekly_update(
    db: AsyncSession, ws_id: uuid.UUID, project: Project
) -> None:
    """A project's weekly_update is the body of its most recent update (by date)."""
    latest = (
        await db.execute(
            select(ProjectUpdate)
            .where(
                ProjectUpdate.workspace_id == ws_id,
                ProjectUpdate.project_id == project.id,
            )
            .order_by(ProjectUpdate.on_date.desc(), ProjectUpdate.created_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    project.weekly_update = latest.body if latest else None


# any workspace participant, including a viewer, may add a weekly update
@router.post("/{project_id}/updates", response_model=ProjectUpdateOut)
async def add_update(
    project_id: uuid.UUID,
    body: ProjectUpdateIn,
    db: AsyncSession = Depends(get_db),
    ws: Workspace = Depends(get_workspace),
    user: AppUser = Depends(get_current_user),
    role: str = Depends(get_my_role),
):
    project = (
        await db.execute(
            select(Project).where(
                Project.workspace_id == ws.id,
                Project.id == project_id,
                Project.deleted_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    if not project:
        raise HTTPException(404, "Project not found")
    # any participant may write the update text, but a viewer cannot change health
    if body.health_after and role == "viewer":
        raise HTTPException(403, "Only editors and owners can change health")
    update = ProjectUpdate(
        workspace_id=ws.id,
        project_id=project_id,
        body=body.body,
        health_after=body.health_after,
        on_date=body.on_date or date.today(),
        created_by=user.id,
    )
    db.add(update)
    await db.flush()
    await _refresh_weekly_update(db, ws.id, project)
    project.status_updated_at = datetime.now(timezone.utc)
    if body.health_after:
        project.health = body.health_after
    record_audit(db, ws.id, user.id, "project", project.id, "add_update",
                 None, {"body": body.body, "on_date": update.on_date.isoformat()})
    await db.commit()
    out = ProjectUpdateOut.model_validate(update)
    out.author_name = user.name
    return out


@router.delete("/{project_id}/updates/{update_id}")
async def delete_update(
    project_id: uuid.UUID,
    update_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    ws: Workspace = Depends(get_workspace_editor),
    user: AppUser = Depends(get_current_user),
):
    project = (
        await db.execute(
            select(Project).where(
                Project.workspace_id == ws.id,
                Project.id == project_id,
                Project.deleted_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    if not project:
        raise HTTPException(404, "Project not found")
    update = (
        await db.execute(
            select(ProjectUpdate).where(
                ProjectUpdate.workspace_id == ws.id,
                ProjectUpdate.project_id == project_id,
                ProjectUpdate.id == update_id,
            )
        )
    ).scalar_one_or_none()
    if not update:
        raise HTTPException(404, "Update not found")
    record_audit(db, ws.id, user.id, "project", project.id, "delete_update",
                 {"body": update.body, "on_date": update.on_date.isoformat()}, None)
    await db.delete(update)
    await db.flush()
    await _refresh_weekly_update(db, ws.id, project)
    await db.commit()
    return {"ok": True}


@router.put("/{project_id}/milestones", response_model=list[MilestoneOut])
async def replace_milestones(
    project_id: uuid.UUID,
    body: list[MilestoneIn],
    db: AsyncSession = Depends(get_db),
    ws: Workspace = Depends(get_workspace_editor),
    user: AppUser = Depends(get_current_user),
):
    project = (
        await db.execute(
            select(Project.id).where(
                Project.workspace_id == ws.id,
                Project.id == project_id,
                Project.deleted_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    if not project:
        raise HTTPException(404, "Project not found")

    owner_ids = {m.owner_member_id for m in body if m.owner_member_id}
    if owner_ids:
        valid = set(
            (
                await db.execute(
                    select(Member.id).where(
                        Member.workspace_id == ws.id,
                        Member.id.in_(owner_ids),
                        Member.deleted_at.is_(None),
                    )
                )
            )
            .scalars()
            .all()
        )
        if owner_ids - valid:
            raise HTTPException(422, "Milestone owner not found in the team")

    existing = (
        (
            await db.execute(
                select(Milestone).where(
                    Milestone.workspace_id == ws.id, Milestone.project_id == project_id
                )
            )
        )
        .scalars()
        .all()
    )
    for m in existing:
        await db.delete(m)
    out = []
    for i, m_in in enumerate(body):
        m = Milestone(
            workspace_id=ws.id,
            project_id=project_id,
            title=m_in.title,
            due_date=m_in.due_date,
            status=m_in.status,
            owner_member_id=m_in.owner_member_id,
            sort_order=i,
        )
        db.add(m)
        out.append(m)
    record_audit(db, ws.id, user.id, "project", project_id, "replace_milestones",
                 None, {"count": len(body)})
    await db.commit()
    return [MilestoneOut.model_validate(m) for m in out]


@router.get("/{project_id}/load", response_model=ProjectLoadOut)
async def project_load(
    project_id: uuid.UUID,
    date_from: date = Query(alias="from"),
    date_to: date = Query(alias="to"),
    db: AsyncSession = Depends(get_db),
    ws: Workspace = Depends(get_workspace),
    _user=Depends(get_current_user),
):
    rows = (
        await db.execute(
            select(Member, func.sum(weight_sql(Allocation.category)))
            .join(Allocation, Allocation.member_id == Member.id)
            .where(
                Allocation.workspace_id == ws.id,
                Allocation.project_id == project_id,
                Allocation.day >= date_from,
                Allocation.day <= date_to,
            )
            .group_by(Member.id)
            .order_by(func.sum(weight_sql(Allocation.category)).desc())
        )
    ).all()
    load_rows = [
        ProjectLoadRow(member=MemberOut.model_validate(m), person_days=Decimal(str(s)))
        for m, s in rows
    ]
    return ProjectLoadOut(
        date_from=date_from,
        date_to=date_to,
        total_person_days=sum((r.person_days for r in load_rows), Decimal(0)),
        rows=load_rows,
    )
