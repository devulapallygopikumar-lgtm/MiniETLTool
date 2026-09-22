"""transforms.column nullable -- ops like filter/sort/dedupe act on the
whole row set, not one column, and key their config through args_json
instead.

Revision ID: 0005
Revises: 0004
Create Date: 2026-09-23

"""
from typing import Sequence, Union

from alembic import op

revision: str = "0005"
down_revision: Union[str, None] = "0004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column("transforms", "column", nullable=True)


def downgrade() -> None:
    op.alter_column("transforms", "column", nullable=False)
