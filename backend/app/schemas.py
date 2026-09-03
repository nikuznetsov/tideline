import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

LoadCategory = Literal["background", "half", "most", "full"]


def validate_capacity(v: Decimal) -> Decimal:
    if not (Decimal("0") < v <= Decimal("1")):
        raise ValueError("Daily capacity must be a fraction in the range (0, 1]")
    return v


# ---------- auth ----------

class LoginRequest(BaseModel):
    email: str
    password: str


class RegisterRequest(BaseModel):
    first_name: str = Field(min_length=1, max_length=60)
    last_name: str = Field(min_length=1, max_length=60)
    email: str = Field(min_length=5, max_length=254)
    password: str = Field(min_length=8, max_length=128)


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    email: str
    name: str


class ProfileUpdate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    email: str = Field(min_length=5, max_length=254)


class PasswordChange(BaseModel):
    current_password: str
    new_password: str = Field(min_length=8, max_length=128)


# ---------- workspaces ----------

class WorkspaceOut(BaseModel):
    id: uuid.UUID
    slug: str
    name: str
    role: str
    default_member_role: str


class WorkspaceCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    slug: str = Field(min_length=2, max_length=32)


class WorkspacePatch(BaseModel):
    name: str | None = None
    default_member_role: str | None = None


class ParticipantOut(BaseModel):
    user_id: uuid.UUID
    name: str
    email: str
    role: str


class ParticipantPatch(BaseModel):
    role: str


class InviteLinkOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    token_prefix: str
    revoked_at: datetime | None
    created_at: datetime
    last_used_at: datetime | None
    # full link for copying again; None for links created before
    # the token was stored in plain text
    url: str | None = None


class InviteLinkCreated(InviteLinkOut):
    token: str = ""


# ---------- members ----------

class MemberOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    user_id: uuid.UUID | None = None
    email: str | None = None
    name: str
    role_title: str | None
    capacity_per_day: Decimal
    tags: list[str]
    sort_order: int
    is_active: bool


class MemberCreate(BaseModel):
    """A team member is a workspace participant: created from an account."""

    user_id: uuid.UUID
    role_title: str | None = None


class MemberPatch(BaseModel):
    role_title: str | None = None
    capacity_per_day: Decimal | None = None
    tags: list[str] | None = None
    is_active: bool | None = None

    @field_validator("capacity_per_day")
    @classmethod
    def _v(cls, v):
        return None if v is None else validate_capacity(v)


class ReorderRequest(BaseModel):
    member_ids: list[uuid.UUID]


# ---------- absences ----------

class AbsenceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    member_id: uuid.UUID
    date_from: date
    date_to: date
    kind: str
    note: str | None


class AbsenceCreate(BaseModel):
    member_id: uuid.UUID
    date_from: date
    date_to: date
    kind: Literal["vacation", "sick", "holiday", "other"] = "vacation"
    note: str | None = None
    # confirmation: delete allocations that fall within the absence range
    clear_allocations: bool = False


# ---------- working calendar ----------

class NonWorkingDayOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    day: date
    title: str | None


class NonWorkingDayCreate(BaseModel):
    day: date
    title: str | None = None


# ---------- allocations ----------

class AllocationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    member_id: uuid.UUID
    project_id: uuid.UUID
    day: date
    category: LoadCategory
    note: str | None


class AllocationCreate(BaseModel):
    member_id: uuid.UUID
    project_id: uuid.UUID
    day: date
    category: LoadCategory


class AllocationBulkSet(BaseModel):
    member_id: uuid.UUID
    project_id: uuid.UUID
    date_from: date
    date_to: date
    category: LoadCategory | None = None  # None => clear the range


class AllocationBulkRequest(BaseModel):
    items: list[AllocationBulkSet]


class AllocationPatch(BaseModel):
    category: LoadCategory | None = None
    note: str | None = None


class CopyWeekRequest(BaseModel):
    from_week_start: date
    to_week_start: date
    mode: str = Field("merge", pattern="^(replace|merge)$")


# ---------- timeline ----------

class TimelineAllocation(BaseModel):
    id: uuid.UUID
    member_id: uuid.UUID
    project_id: uuid.UUID
    day: date
    category: LoadCategory
    note: str | None = None


class TimelineProject(BaseModel):
    id: uuid.UUID
    code: str
    name: str
    lifecycle: str


class TimelineAbsence(BaseModel):
    member_id: uuid.UUID
    date_from: date
    date_to: date
    kind: str


class TimelineMemberDay(BaseModel):
    day: date
    capacity: Decimal
    allocated: Decimal
    free: Decimal
    is_working: bool
    is_absent: bool


class TimelineMember(BaseModel):
    member: MemberOut
    days: list[TimelineMemberDay]
    total_allocated: Decimal
    total_free: Decimal


class TimelineDayTotal(BaseModel):
    day: date
    free: Decimal
    capacity: Decimal
    allocated: Decimal
    is_working: bool


class TimelineWeek(BaseModel):
    week_start: date
    is_closed: bool
    is_current: bool
    is_past: bool
    free_total: Decimal


class TimelineResponse(BaseModel):
    date_from: date
    date_to: date
    members: list[TimelineMember]
    allocations: list[TimelineAllocation]
    projects: list[TimelineProject]
    absences: list[TimelineAbsence]
    non_working_days: list[date]
    day_totals: list[TimelineDayTotal]
    weeks: list[TimelineWeek]
    utilization_pct: float
    week_close_reminder: date | None = None


# ---------- capacity search ----------

class CandidateOut(BaseModel):
    member: MemberOut
    free_total: Decimal
    free_by_day: dict[date, Decimal]
    warnings: list[dict]


class CapacitySearchOut(BaseModel):
    total_free: Decimal
    needed: Decimal
    enough: bool
    deficit: Decimal
    candidates: list[CandidateOut]
    plan_horizon_warning: bool


# ---------- projects ----------

class MilestoneOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    title: str
    due_date: date | None
    status: str
    owner_member_id: uuid.UUID | None
    sort_order: int


class MilestoneIn(BaseModel):
    title: str
    due_date: date | None = None
    status: Literal["planned", "in_progress", "done", "dropped"] = "planned"
    owner_member_id: uuid.UUID | None = None
    sort_order: int = 0


class ProjectUpdateOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    body: str
    health_after: str | None
    on_date: date
    author_name: str | None = None
    created_at: datetime


class ProjectUpdateIn(BaseModel):
    body: str
    health_after: Literal["green", "amber", "red"] | None = None
    # update date; defaults to today
    on_date: date | None = None


class ProjectOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    code: str
    name: str
    lifecycle: str
    health: str
    weekly_update: str | None
    status_updated_at: datetime | None
    created_at: datetime


class ProjectListItem(ProjectOut):
    active_members_count: int = 0


class ProjectDetail(ProjectOut):
    goal: str | None
    scope_md: str | None
    links_md: str | None
    milestones: list[MilestoneOut] = []
    updates: list[ProjectUpdateOut] = []


class ProjectCreate(BaseModel):
    code: str
    name: str
    goal: str | None = None


class ProjectPatch(BaseModel):
    code: str | None = None
    name: str | None = None
    lifecycle: Literal["active", "support", "paused", "finished"] | None = None
    health: Literal["green", "amber", "red"] | None = None
    weekly_update: str | None = None
    goal: str | None = None
    scope_md: str | None = None
    links_md: str | None = None


class ProjectLoadRow(BaseModel):
    member: MemberOut
    person_days: Decimal


class ProjectLoadOut(BaseModel):
    date_from: date
    date_to: date
    total_person_days: Decimal
    rows: list[ProjectLoadRow]


# ---------- weeks ----------

class CloseWeekRequest(BaseModel):
    week_start: date


# ---------- share links ----------

class ShareLinkOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    token_prefix: str
    scope: str
    expires_at: datetime | None
    revoked_at: datetime | None
    created_at: datetime
    last_accessed_at: datetime | None
    # full link for copying again; None for links created before
    # the token was stored in plain text
    url: str | None = None


class ShareLinkCreated(ShareLinkOut):
    token: str = ""


class ShareLinkCreate(BaseModel):
    expires_at: datetime | None = None
