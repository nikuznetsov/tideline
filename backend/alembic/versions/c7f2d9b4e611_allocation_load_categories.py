"""Загрузка категориями: allocation.load -> allocation.category

Revision ID: c7f2d9b4e611
Revises: b3e6a1c8f542
Create Date: 2026-08-08

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "c7f2d9b4e611"
down_revision: Union[str, None] = "b3e6a1c8f542"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

CAT_CHECK = "category in ('background','half','most','full')"
LOAD_CHECK = "load > 0 AND load <= 1"


def _allocation_table(*, load: str | None, category: str | None) -> sa.Table:
    """Явное описание allocation для SQLite copy_from: CHECK-и не рефлектируются.

    load/category: None — колонки нет, "nullable" — есть без чека,
    "checked" — NOT NULL со своим CHECK-констрейнтом.
    """
    cols: list[sa.schema.SchemaItem] = [
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("workspace_id", sa.Uuid(), sa.ForeignKey("workspace.id"), nullable=False),
        sa.Column("member_id", sa.Uuid(), sa.ForeignKey("member.id"), nullable=False),
        sa.Column("project_id", sa.Uuid(), sa.ForeignKey("project.id"), nullable=False),
        sa.Column("day", sa.Date(), nullable=False),
    ]
    if load == "checked":
        cols.append(
            sa.Column(
                "load",
                sa.Numeric(precision=3, scale=2),
                sa.CheckConstraint(LOAD_CHECK, name="ck_allocation_load"),
                nullable=False,
            )
        )
    elif load == "nullable":
        cols.append(sa.Column("load", sa.Numeric(precision=3, scale=2), nullable=True))
    if category == "checked":
        cols.append(
            sa.Column(
                "category",
                sa.Text(),
                sa.CheckConstraint(CAT_CHECK, name="ck_allocation_category"),
                nullable=False,
            )
        )
    elif category == "nullable":
        cols.append(sa.Column("category", sa.Text(), nullable=True))
    cols += [
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("created_by", sa.Uuid(), sa.ForeignKey("app_user.id"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint(
            "workspace_id", "member_id", "project_id", "day", name="uq_allocation_cell"
        ),
    ]
    return sa.Table("allocation", sa.MetaData(), *cols)


def _ensure_indexes() -> None:
    """SQLite-пересоздание таблицы теряет индексы — вернуть."""
    insp = sa.inspect(op.get_bind())
    names = {ix["name"] for ix in insp.get_indexes("allocation")}
    for name, cols in [
        ("ix_allocation_ws_day", ["workspace_id", "day"]),
        ("ix_allocation_ws_member_day", ["workspace_id", "member_id", "day"]),
        ("ix_allocation_ws_project_day", ["workspace_id", "project_id", "day"]),
    ]:
        if name not in names:
            op.create_index(name, "allocation", cols)


def _drop_checks_mentioning(bind: sa.Connection, needle: str) -> None:
    """Postgres: чек может называться иначе или отсутствовать вовсе."""
    for ck in sa.inspect(bind).get_check_constraints("allocation"):
        if needle in (ck.get("sqltext") or ""):
            op.drop_constraint(ck["name"], "allocation", type_="check")


def upgrade() -> None:
    bind = op.get_bind()
    op.add_column("allocation", sa.Column("category", sa.Text(), nullable=True))
    op.execute(
        """
        UPDATE allocation SET category = CASE
            WHEN load <= 0.25 THEN 'background'
            WHEN load <= 0.5  THEN 'half'
            WHEN load <= 0.75 THEN 'most'
            ELSE 'full' END
        """
    )
    if bind.dialect.name == "sqlite":
        with op.batch_alter_table(
            "allocation",
            copy_from=_allocation_table(load="checked", category="nullable"),
        ) as batch:
            batch.drop_constraint("ck_allocation_load", type_="check")
            batch.drop_column("load")
            batch.alter_column("category", existing_type=sa.Text(), nullable=False)
            batch.create_check_constraint("ck_allocation_category", CAT_CHECK)
        _ensure_indexes()
        return
    _drop_checks_mentioning(bind, "load")
    op.drop_column("allocation", "load")
    op.alter_column("allocation", "category", existing_type=sa.Text(), nullable=False)
    op.create_check_constraint("ck_allocation_category", "allocation", CAT_CHECK)


def downgrade() -> None:
    # с потерей точности: категория -> её вес
    bind = op.get_bind()
    op.add_column(
        "allocation", sa.Column("load", sa.Numeric(precision=3, scale=2), nullable=True)
    )
    op.execute(
        """
        UPDATE allocation SET load = CASE category
            WHEN 'background' THEN 0.25
            WHEN 'half'       THEN 0.5
            WHEN 'most'       THEN 0.75
            ELSE 1.0 END
        """
    )
    if bind.dialect.name == "sqlite":
        with op.batch_alter_table(
            "allocation",
            copy_from=_allocation_table(load="nullable", category="checked"),
        ) as batch:
            batch.drop_constraint("ck_allocation_category", type_="check")
            batch.drop_column("category")
            batch.alter_column(
                "load", existing_type=sa.Numeric(precision=3, scale=2), nullable=False
            )
            batch.create_check_constraint("ck_allocation_load", LOAD_CHECK)
        _ensure_indexes()
        return
    _drop_checks_mentioning(bind, "category")
    op.drop_column("allocation", "category")
    op.alter_column(
        "allocation", "load", existing_type=sa.Numeric(precision=3, scale=2), nullable=False
    )
    op.create_check_constraint("ck_allocation_load", "allocation", LOAD_CHECK)
