"""Add auth -- users, refresh_tokens, and the created_by/approved_by
attribution columns maker-checker needs (Mini ETL RBAC Prompt.md,
ARCHITECTURE.md §11.1). Non-destructive: every new column on an existing
table is nullable and backfills NULL -- there's no user to retroactively
attribute existing datasets/runs to.

Also seeds exactly one Admin user, idempotently, iff the `users` table is
empty AND both ADMIN_EMAIL and ADMIN_PASSWORD are set in the environment
this migration runs in. No env vars set -> seeding is skipped (not a
failure) and `backend/scripts/create_admin.py` is the documented
fallback -- this migration never hardcodes a password.

Revision ID: 0009
Revises: 0008
Create Date: 2026-09-26

"""

import os
import uuid
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0009"
down_revision: Union[str, None] = "0008"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("tenant_id", sa.String(64), nullable=False, index=True),
        sa.Column("email", sa.String(255), nullable=False, unique=True, index=True),
        sa.Column("password_hash", sa.String(255), nullable=False),
        sa.Column("role", sa.String(32), nullable=False),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_table(
        "refresh_tokens",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id"), nullable=False, index=True),
        sa.Column("token_hash", sa.String(64), nullable=False, unique=True, index=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )

    op.add_column("datasets", sa.Column("created_by", sa.String(36), sa.ForeignKey("users.id"), nullable=True))
    op.add_column("runs", sa.Column("created_by", sa.String(36), sa.ForeignKey("users.id"), nullable=True))
    op.add_column("runs", sa.Column("approved_by", sa.String(36), sa.ForeignKey("users.id"), nullable=True))
    op.add_column("runs", sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True))

    _seed_admin_if_configured()


def _seed_admin_if_configured() -> None:
    email = os.environ.get("ADMIN_EMAIL")
    password = os.environ.get("ADMIN_PASSWORD")
    if not email or not password:
        return  # no env vars set -- backend/scripts/create_admin.py is the fallback

    bind = op.get_bind()
    users = sa.table(
        "users",
        sa.column("id", sa.String),
        sa.column("tenant_id", sa.String),
        sa.column("email", sa.String),
        sa.column("password_hash", sa.String),
        sa.column("role", sa.String),
        sa.column("is_active", sa.Boolean),
    )
    existing = bind.execute(sa.select(sa.func.count()).select_from(users)).scalar_one()
    if existing:
        return  # already has at least one user -- not this migration's job to add more

    from app.config import settings
    from app.security import hash_password

    bind.execute(
        users.insert().values(
            id=str(uuid.uuid4()),
            tenant_id=settings.default_tenant_id,
            email=email,
            password_hash=hash_password(password),
            role="admin",
            is_active=True,
        )
    )


def downgrade() -> None:
    op.drop_column("runs", "approved_at")
    op.drop_column("runs", "approved_by")
    op.drop_column("runs", "created_by")
    op.drop_column("datasets", "created_by")
    op.drop_table("refresh_tokens")
    op.drop_table("users")
