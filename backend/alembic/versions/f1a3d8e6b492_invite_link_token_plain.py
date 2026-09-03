"""invite_link.token in plain text — so the owner can copy it again

Revision ID: f1a3d8e6b492
Revises: e5b1c9a2d7f0
Create Date: 2026-07-20

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "f1a3d8e6b492"
down_revision: Union[str, None] = "e5b1c9a2d7f0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # old links' tokens cannot be recovered from the hash — they stay NULL
    op.add_column("invite_link", sa.Column("token", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("invite_link", "token")
