"""Soft delete for datasets (the Trash): datasets.deleted_at.
Non-destructive: nullable, NULL = not trashed.

Revision ID: 0011
Revises: 0010
Create Date: 2026-10-04

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0011"
down_revision: Union[str, None] = "0010"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("datasets", sa.Column("deleted_at", sa.DateTime(timezone=True)))


def downgrade() -> None:
    op.drop_column("datasets", "deleted_at")
