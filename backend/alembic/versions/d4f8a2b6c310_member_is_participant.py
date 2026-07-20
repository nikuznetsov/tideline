"""команда = участники: member.user_id → app_user

Revision ID: d4f8a2b6c310
Revises: c9d1e5f7a201
Create Date: 2026-07-20

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "d4f8a2b6c310"
down_revision: Union[str, None] = "c9d1e5f7a201"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("member") as batch:
        batch.add_column(sa.Column("user_id", sa.Uuid(), nullable=True))
        batch.create_foreign_key(
            "fk_member_user_id", "app_user", ["user_id"], ["id"]
        )
    op.create_index(
        "uq_member_ws_user",
        "member",
        ["workspace_id", "user_id"],
        unique=True,
        postgresql_where=sa.text("user_id IS NOT NULL AND deleted_at IS NULL"),
        sqlite_where=sa.text("user_id IS NOT NULL AND deleted_at IS NULL"),
    )


def downgrade() -> None:
    op.drop_index("uq_member_ws_user", table_name="member")
    with op.batch_alter_table("member") as batch:
        batch.drop_constraint("fk_member_user_id", type_="foreignkey")
        batch.drop_column("user_id")
