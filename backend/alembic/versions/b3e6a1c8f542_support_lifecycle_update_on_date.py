"""Project status 'support'; weekly update date on_date

Revision ID: b3e6a1c8f542
Revises: a2c5e7f9d813
Create Date: 2026-08-02

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "b3e6a1c8f542"
down_revision: Union[str, None] = "a2c5e7f9d813"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _project_table(lifecycle_check: str) -> sa.Table:
    """Explicit description of project for SQLite: CHECK constraints are not reflected."""
    return sa.Table(
        "project",
        sa.MetaData(),
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("workspace_id", sa.Uuid(), sa.ForeignKey("workspace.id"), nullable=False, index=True),
        sa.Column("code", sa.Text(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column(
            "lifecycle",
            sa.Text(),
            sa.CheckConstraint(lifecycle_check, name="ck_project_lifecycle"),
            nullable=False,
        ),
        sa.Column(
            "health",
            sa.Text(),
            sa.CheckConstraint("health in ('green','amber','red')", name="ck_project_health"),
            nullable=False,
        ),
        sa.Column("weekly_update", sa.Text(), nullable=True),
        sa.Column("goal", sa.Text(), nullable=True),
        sa.Column("scope_md", sa.Text(), nullable=True),
        sa.Column("links_md", sa.Text(), nullable=True),
        sa.Column("status_updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Index(
            "uq_project_workspace_code",
            "workspace_id",
            "code",
            unique=True,
            postgresql_where=sa.text("deleted_at IS NULL"),
            sqlite_where=sa.text("deleted_at IS NULL"),
        ),
    )


OLD_CHECK = "lifecycle in ('active','paused','finished')"
NEW_CHECK = "lifecycle in ('active','support','paused','finished')"


def _ensure_ws_index() -> None:
    """SQLite table recreation loses ix_project_workspace_id — restore it."""
    insp = sa.inspect(op.get_bind())
    names = {ix["name"] for ix in insp.get_indexes("project")}
    if "ix_project_workspace_id" not in names:
        op.create_index("ix_project_workspace_id", "project", ["workspace_id"])


def _replace_lifecycle_check(old_check: str, new_check: str) -> None:
    bind = op.get_bind()
    if bind.dialect.name == "sqlite":
        # SQLite: the check lives in the table DDL; recreate via copy_from
        with op.batch_alter_table("project", copy_from=_project_table(old_check)) as batch:
            batch.drop_constraint("ck_project_lifecycle", type_="check")
            batch.create_check_constraint("ck_project_lifecycle", new_check)
        _ensure_ws_index()
        return
    # Postgres: the check may be named differently or be missing entirely
    # (the production schema was historically created without named checks)
    insp = sa.inspect(bind)
    for ck in insp.get_check_constraints("project"):
        if "lifecycle" in (ck.get("sqltext") or ""):
            op.drop_constraint(ck["name"], "project", type_="check")
    op.create_check_constraint("ck_project_lifecycle", "project", new_check)


def upgrade() -> None:
    _replace_lifecycle_check(OLD_CHECK, NEW_CHECK)
    op.add_column("project_update", sa.Column("on_date", sa.Date(), nullable=True))
    # existing updates get date = creation day
    op.execute("UPDATE project_update SET on_date = date(created_at)")
    with op.batch_alter_table("project_update") as batch:
        batch.alter_column("on_date", nullable=False, existing_type=sa.Date())


def downgrade() -> None:
    with op.batch_alter_table("project_update") as batch:
        batch.drop_column("on_date")
    op.execute("UPDATE project SET lifecycle = 'paused' WHERE lifecycle = 'support'")
    _replace_lifecycle_check(NEW_CHECK, OLD_CHECK)
