"""Widen datasets.format and mappings.source_format to fit 'xml-tally-masters'
(17 chars, over the original VARCHAR(16)).

Revision ID: 0002
Revises: 0001
Create Date: 2026-09-22

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0002"
down_revision: Union[str, None] = "0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column("datasets", "format", type_=sa.String(32))
    op.alter_column("mappings", "source_format", type_=sa.String(32))


def downgrade() -> None:
    op.alter_column("mappings", "source_format", type_=sa.String(16))
    op.alter_column("datasets", "format", type_=sa.String(16))
