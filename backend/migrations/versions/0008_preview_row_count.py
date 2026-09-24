"""Add datasets.preview_row_count -- a row count computed at build time for
a derived entity (sort/group-by/join/etc.), before it has ever been Run.

Deliberately separate from row_count, which means "this dataset has an
actual loaded Postgres target table" (set only by runner.py's load
stage) and gates both the Final Datasets list and which datasets are
selectable as a source for building another derived entity. Reusing
row_count for this would let a not-yet-loaded entity look "ready" and
be chained into, failing with a raw SQL error once its target table
turns out not to exist yet.

Revision ID: 0008
Revises: 0007
Create Date: 2026-09-24

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0008"
down_revision: Union[str, None] = "0007"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("datasets", sa.Column("preview_row_count", sa.Integer, nullable=True))


def downgrade() -> None:
    op.drop_column("datasets", "preview_row_count")
