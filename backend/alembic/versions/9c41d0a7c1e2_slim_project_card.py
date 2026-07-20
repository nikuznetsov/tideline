"""slim project card: детали проекта живут в Confluence

Revision ID: 9c41d0a7c1e2
Revises: 822f559bdb80
Create Date: 2026-07-20

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "9c41d0a7c1e2"
down_revision: Union[str, None] = "822f559bdb80"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

DROPPED = [
    "out_of_scope_md",
    "architecture_md",
    "dependencies_md",
    "risks_md",
    "decisions_md",
]


def upgrade() -> None:
    with op.batch_alter_table("project") as batch:
        for col in DROPPED:
            batch.drop_column(col)


def downgrade() -> None:
    with op.batch_alter_table("project") as batch:
        for col in reversed(DROPPED):
            batch.add_column(sa.Column(col, sa.Text(), nullable=True))
