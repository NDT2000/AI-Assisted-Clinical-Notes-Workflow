"""Add note_events: the numbered log of note changes for real-time clients.

Revision ID: f3b8d1e6a274
Revises: e2a9c4d7f1b3
Create Date: 2026-11-07 19:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "f3b8d1e6a274"
down_revision: str | Sequence[str] | None = "e2a9c4d7f1b3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "note_events",
        sa.Column("cursor", sa.BigInteger(), sa.Identity(), nullable=False),
        sa.Column("event_id", sa.String(length=64), nullable=False),
        sa.Column("note_id", sa.String(length=64), nullable=False),
        sa.Column("type", sa.String(length=32), nullable=False),
        sa.Column("trigger", sa.String(length=32), nullable=True),
        sa.Column("payload", postgresql.JSONB(), nullable=False),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "type IN ('note.status_changed', 'note.version_added')",
            name=op.f("ck_note_events_type"),
        ),
        sa.ForeignKeyConstraint(
            ["note_id"],
            ["notes.id"],
            name=op.f("fk_note_events_note_id_notes"),
        ),
        sa.PrimaryKeyConstraint("cursor", name=op.f("pk_note_events")),
        sa.UniqueConstraint("event_id", name=op.f("uq_note_events_event_id")),
    )
    op.create_index(
        "ix_note_events_note_id_cursor",
        "note_events",
        ["note_id", "cursor"],
    )
    op.create_index("ix_note_events_occurred_at", "note_events", ["occurred_at"])

    op.create_table(
        "note_event_log_state",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column(
            "pruned_through",
            sa.BigInteger(),
            server_default="0",
            nullable=False,
        ),
        sa.CheckConstraint("id = 1", name=op.f("ck_note_event_log_state_single_row")),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_note_event_log_state")),
    )


def downgrade() -> None:
    op.drop_table("note_event_log_state")
    op.drop_table("note_events")
