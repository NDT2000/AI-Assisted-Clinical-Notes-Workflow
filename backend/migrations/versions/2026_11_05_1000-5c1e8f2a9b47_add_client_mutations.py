"""Add client_mutations: stored answers for retried saves and transitions.

Revision ID: 5c1e8f2a9b47
Revises: 2aa6a822e7be
Create Date: 2026-11-05 10:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "5c1e8f2a9b47"
down_revision: str | Sequence[str] | None = "2aa6a822e7be"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "client_mutations",
        sa.Column("note_id", sa.String(length=64), nullable=False),
        sa.Column("kind", sa.String(length=32), nullable=False),
        sa.Column("client_mutation_id", sa.String(length=128), nullable=False),
        sa.Column("request_signature", sa.String(length=64), nullable=False),
        sa.Column("response", postgresql.JSONB(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "kind IN ('SAVE_VERSION', 'TRANSITION')",
            name=op.f("ck_client_mutations_kind"),
        ),
        sa.ForeignKeyConstraint(
            ["note_id"],
            ["notes.id"],
            name=op.f("fk_client_mutations_note_id_notes"),
        ),
        sa.PrimaryKeyConstraint(
            "note_id",
            "kind",
            "client_mutation_id",
            name=op.f("pk_client_mutations"),
        ),
    )


def downgrade() -> None:
    op.drop_table("client_mutations")
