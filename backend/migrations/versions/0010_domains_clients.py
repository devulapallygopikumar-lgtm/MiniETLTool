"""Add domains and clients; users belong to a domain, datasets to a client.
Non-destructive: new columns are nullable.

Revision ID: 0010
Revises: 0009
Create Date: 2026-10-04

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0010"
down_revision: Union[str, None] = "0009"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "domains",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("name", sa.String(255), nullable=False, unique=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_table(
        "clients",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("domain_id", sa.String(36), sa.ForeignKey("domains.id"), nullable=False, index=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("contact_name", sa.String(255)),
        sa.Column("contact_email", sa.String(255)),
        sa.Column("contact_phone", sa.String(64)),
        sa.Column("notes", sa.Text),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.add_column("users", sa.Column("domain_id", sa.String(36), sa.ForeignKey("domains.id")))
    op.create_index("ix_users_domain_id", "users", ["domain_id"])
    op.add_column("datasets", sa.Column("client_id", sa.String(36), sa.ForeignKey("clients.id")))
    op.create_index("ix_datasets_client_id", "datasets", ["client_id"])


def downgrade() -> None:
    op.drop_index("ix_datasets_client_id", "datasets")
    op.drop_column("datasets", "client_id")
    op.drop_index("ix_users_domain_id", "users")
    op.drop_column("users", "domain_id")
    op.drop_table("clients")
    op.drop_table("domains")
