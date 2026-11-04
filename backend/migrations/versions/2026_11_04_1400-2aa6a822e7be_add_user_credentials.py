"""Add user credentials: password hash and MFA flag.

Revision ID: 2aa6a822e7be
Revises: 0d603c480237
Create Date: 2026-11-04 14:00:14.026304

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "2aa6a822e7be"
down_revision: str | Sequence[str] | None = "0d603c480237"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("password_hash", sa.String(length=255), nullable=True),
    )
    op.add_column(
        "users",
        sa.Column(
            "mfa_enabled",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=False,
        ),
    )


def downgrade() -> None:
    op.drop_column("users", "mfa_enabled")
    op.drop_column("users", "password_hash")
