"""итерация 2: роль по умолчанию у пространства и инвайт-ссылки

Revision ID: c9d1e5f7a201
Revises: b7e2f4d90a11
Create Date: 2026-07-20

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "c9d1e5f7a201"
down_revision: Union[str, None] = "b7e2f4d90a11"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("workspace") as batch:
        batch.add_column(
            sa.Column(
                "default_member_role",
                sa.Text(),
                nullable=False,
                server_default="viewer",
            )
        )
        batch.create_check_constraint(
            "ck_ws_default_role", "default_member_role in ('viewer','editor')"
        )
    op.create_table(
        "invite_link",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "workspace_id", sa.Uuid(), sa.ForeignKey("workspace.id"), nullable=False
        ),
        sa.Column("token_hash", sa.Text(), nullable=False, unique=True),
        sa.Column("token_prefix", sa.Text(), nullable=False),
        sa.Column("created_by", sa.Uuid(), sa.ForeignKey("app_user.id"), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_invite_link_workspace_id", "invite_link", ["workspace_id"])


def downgrade() -> None:
    op.drop_table("invite_link")
    with op.batch_alter_table("workspace") as batch:
        batch.drop_constraint("ck_ws_default_role", type_="check")
        batch.drop_column("default_member_role")
