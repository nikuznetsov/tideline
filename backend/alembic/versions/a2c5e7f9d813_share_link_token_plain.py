"""share_link.token открытым текстом — повторное копирование read-only ссылок

Revision ID: a2c5e7f9d813
Revises: f1a3d8e6b492
Create Date: 2026-07-20

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "a2c5e7f9d813"
down_revision: Union[str, None] = "f1a3d8e6b492"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # у старых ссылок токен не восстановить из хэша — останется NULL
    op.add_column("share_link", sa.Column("token", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("share_link", "token")
