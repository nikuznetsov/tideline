"""drop is_sole_owner from allocation (bus factor removed)

Revision ID: e5b1c9a2d7f0
Revises: d4f8a2b6c310
Create Date: 2026-07-20

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "e5b1c9a2d7f0"
down_revision: Union[str, None] = "d4f8a2b6c310"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("allocation") as batch:
        batch.drop_column("is_sole_owner")


def downgrade() -> None:
    with op.batch_alter_table("allocation") as batch:
        batch.add_column(
            sa.Column(
                "is_sole_owner",
                sa.Boolean(),
                nullable=False,
                server_default=sa.false(),
            )
        )
