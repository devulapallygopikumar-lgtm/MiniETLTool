"""Add runs.created_at -- the stable sort key for a dataset's run history.
started_at isn't usable for this: it's null for a still-queued run and,
looking back, doesn't distinguish "not started yet" from "never got a
mapping_version to start with." Backfills existing rows from whatever
timestamp they do have.

Revision ID: 0006
Revises: 0005
Create Date: 2026-09-23

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0006"
down_revision: Union[str, None] = "0005"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("runs", sa.Column("created_at", sa.DateTime(timezone=True), nullable=True))
    op.execute("UPDATE runs SET created_at = COALESCE(started_at, finished_at, now())")
    op.alter_column("runs", "created_at", nullable=False, server_default=sa.func.now())


def downgrade() -> None:
    op.drop_column("runs", "created_at")
