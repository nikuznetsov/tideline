"""rag_status -> health; drop phase, owner and milestone from project

Revision ID: b7e2f4d90a11
Revises: 9c41d0a7c1e2
Create Date: 2026-07-20

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "b7e2f4d90a11"
down_revision: Union[str, None] = "9c41d0a7c1e2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("project") as batch:
        batch.alter_column("rag_status", new_column_name="health")
        batch.drop_column("phase")
        batch.drop_column("next_milestone")
        batch.drop_column("next_milestone_date")
        batch.drop_column("owner_member_id")
    with op.batch_alter_table("project_update") as batch:
        batch.alter_column("rag_status_after", new_column_name="health_after")


def downgrade() -> None:
    with op.batch_alter_table("project_update") as batch:
        batch.alter_column("health_after", new_column_name="rag_status_after")
    with op.batch_alter_table("project") as batch:
        batch.alter_column("health", new_column_name="rag_status")
        batch.add_column(sa.Column("phase", sa.Text(), nullable=True))
        batch.add_column(sa.Column("next_milestone", sa.Text(), nullable=True))
        batch.add_column(sa.Column("next_milestone_date", sa.Date(), nullable=True))
        batch.add_column(
            sa.Column(
                "owner_member_id",
                sa.Uuid(),
                sa.ForeignKey("member.id"),
                nullable=True,
            )
        )
