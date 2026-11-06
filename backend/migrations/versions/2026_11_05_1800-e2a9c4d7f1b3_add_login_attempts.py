"""Add login_attempts: recent failed sign-ins, to slow down password guessing.

Revision ID: e2a9c4d7f1b3
Revises: b4e7a2c91d35
Create Date: 2026-11-05 18:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "e2a9c4d7f1b3"
down_revision: str | Sequence[str] | None = "b4e7a2c91d35"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "login_attempts",
        sa.Column("id", sa.BigInteger(), sa.Identity(), nullable=False),
        sa.Column("username", sa.String(length=64), nullable=False),
        sa.Column("ip_address", sa.String(length=64), nullable=False),
        sa.Column("attempted_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_login_attempts")),
    )
    op.create_index(
        "ix_login_attempts_username_attempted_at",
        "login_attempts",
        ["username", "attempted_at"],
    )
    op.create_index(
        "ix_login_attempts_ip_address_attempted_at",
        "login_attempts",
        ["ip_address", "attempted_at"],
    )
    op.create_index(
        "ix_login_attempts_attempted_at",
        "login_attempts",
        ["attempted_at"],
    )


def downgrade() -> None:
    op.drop_table("login_attempts")
