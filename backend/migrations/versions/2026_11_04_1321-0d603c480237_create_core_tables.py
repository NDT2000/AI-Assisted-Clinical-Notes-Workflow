"""Create core tables: users, patients, sessions, notes, versions, events.

Revision ID: 0d603c480237
Revises:
Create Date: 2026-11-04 13:21:42.870662

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0d603c480237"
down_revision: str | Sequence[str] | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

NOTE_STATUSES = (
    "'GENERATING', 'FAILED', 'READY_FOR_REVIEW', 'IN_REVIEW', "
    "'REJECTED', 'APPROVED', 'AMENDED', 'LOCKED'"
)
USER_ROLES = "'CLINICIAN', 'REVIEWER', 'ADMIN', 'READONLY_AUDITOR'"

# Versions and review events are history: once written, never changed.
REJECT_CHANGES_FUNCTION = """
CREATE FUNCTION reject_history_change() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION '% rows are immutable; % is not allowed', TG_TABLE_NAME, TG_OP
        USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;
"""

IMMUTABLE_TABLES = ("note_versions", "review_events")


def upgrade() -> None:
    op.create_table(
        "patients",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("display_name", sa.String(length=200), nullable=False),
        sa.Column("date_of_birth", sa.Date(), nullable=False),
        sa.Column("medical_record_number", sa.String(length=32), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_patients")),
        sa.UniqueConstraint(
            "medical_record_number",
            name=op.f("uq_patients_medical_record_number"),
        ),
    )
    op.create_table(
        "users",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("display_name", sa.String(length=200), nullable=False),
        sa.Column("role", sa.String(length=32), nullable=False),
        sa.CheckConstraint(f"role IN ({USER_ROLES})", name=op.f("ck_users_role")),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_users")),
    )
    op.create_table(
        "sessions",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("patient_id", sa.String(length=64), nullable=False),
        sa.Column("clinician_id", sa.String(length=64), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "ended_at >= started_at",
            name=op.f("ck_sessions_ends_after_start"),
        ),
        sa.ForeignKeyConstraint(
            ["clinician_id"],
            ["users.id"],
            name=op.f("fk_sessions_clinician_id_users"),
        ),
        sa.ForeignKeyConstraint(
            ["patient_id"],
            ["patients.id"],
            name=op.f("fk_sessions_patient_id_patients"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_sessions")),
    )
    op.create_index(
        op.f("ix_sessions_patient_id"), "sessions", ["patient_id"], unique=False
    )

    # current_version_id's foreign key is added below, once note_versions
    # exists: the two tables reference each other.
    op.create_table(
        "notes",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("patient_id", sa.String(length=64), nullable=False),
        sa.Column("session_id", sa.String(length=64), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("current_version_id", sa.String(length=64), nullable=True),
        sa.Column("assigned_reviewer_id", sa.String(length=64), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            f"status IN ({NOTE_STATUSES})", name=op.f("ck_notes_status")
        ),
        sa.CheckConstraint(
            "updated_at >= created_at",
            name=op.f("ck_notes_updated_after_created"),
        ),
        sa.ForeignKeyConstraint(
            ["assigned_reviewer_id"],
            ["users.id"],
            name=op.f("fk_notes_assigned_reviewer_id_users"),
        ),
        sa.ForeignKeyConstraint(
            ["patient_id"],
            ["patients.id"],
            name=op.f("fk_notes_patient_id_patients"),
        ),
        sa.ForeignKeyConstraint(
            ["session_id"],
            ["sessions.id"],
            name=op.f("fk_notes_session_id_sessions"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_notes")),
        sa.UniqueConstraint("session_id", name=op.f("uq_notes_session_id")),
    )
    op.create_index(
        op.f("ix_notes_assigned_reviewer_id"),
        "notes",
        ["assigned_reviewer_id"],
        unique=False,
    )
    op.create_index(
        "ix_notes_created_at_id", "notes", ["created_at", "id"], unique=False
    )
    op.create_index(op.f("ix_notes_patient_id"), "notes", ["patient_id"], unique=False)
    op.create_index(op.f("ix_notes_status"), "notes", ["status"], unique=False)
    op.create_index(
        "ix_notes_updated_at_id", "notes", ["updated_at", "id"], unique=False
    )

    op.create_table(
        "note_versions",
        sa.Column("version_id", sa.String(length=64), nullable=False),
        sa.Column("note_id", sa.String(length=64), nullable=False),
        sa.Column("revision_number", sa.Integer(), nullable=False),
        sa.Column("parent_version_id", sa.String(length=64), nullable=True),
        sa.Column("subjective", sa.Text(), nullable=False),
        sa.Column("objective", sa.Text(), nullable=False),
        sa.Column("assessment", sa.Text(), nullable=False),
        sa.Column("plan", sa.Text(), nullable=False),
        sa.Column("author_id", sa.String(length=64), nullable=False),
        sa.Column("author_role", sa.String(length=32), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            f"author_role IN ({USER_ROLES})",
            name=op.f("ck_note_versions_author_role"),
        ),
        sa.CheckConstraint(
            "(revision_number = 1) = (parent_version_id IS NULL)",
            name=op.f("ck_note_versions_only_first_revision_is_root"),
        ),
        sa.CheckConstraint(
            "revision_number >= 1",
            name=op.f("ck_note_versions_revision_positive"),
        ),
        sa.ForeignKeyConstraint(
            ["author_id"],
            ["users.id"],
            name=op.f("fk_note_versions_author_id_users"),
        ),
        sa.ForeignKeyConstraint(
            ["note_id"],
            ["notes.id"],
            name=op.f("fk_note_versions_note_id_notes"),
        ),
        sa.ForeignKeyConstraint(
            ["parent_version_id"],
            ["note_versions.version_id"],
            name=op.f("fk_note_versions_parent_version_id_note_versions"),
        ),
        sa.PrimaryKeyConstraint("version_id", name=op.f("pk_note_versions")),
        sa.UniqueConstraint(
            "note_id",
            "revision_number",
            name="uq_note_versions_note_id_revision_number",
        ),
    )
    op.create_index(
        op.f("ix_note_versions_note_id"), "note_versions", ["note_id"], unique=False
    )
    op.create_foreign_key(
        "fk_notes_current_version_id_note_versions",
        "notes",
        "note_versions",
        ["current_version_id"],
        ["version_id"],
    )

    op.create_table(
        "review_events",
        sa.Column("event_id", sa.String(length=64), nullable=False),
        sa.Column("note_id", sa.String(length=64), nullable=False),
        sa.Column("version_id", sa.String(length=64), nullable=True),
        sa.Column("from_status", sa.String(length=32), nullable=False),
        sa.Column("to_status", sa.String(length=32), nullable=False),
        sa.Column("actor_id", sa.String(length=64), nullable=False),
        sa.Column("actor_role", sa.String(length=32), nullable=False),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            f"actor_role IN ({USER_ROLES})",
            name=op.f("ck_review_events_actor_role"),
        ),
        sa.CheckConstraint(
            f"from_status IN ({NOTE_STATUSES})",
            name=op.f("ck_review_events_from_status"),
        ),
        sa.CheckConstraint(
            f"to_status IN ({NOTE_STATUSES})",
            name=op.f("ck_review_events_to_status"),
        ),
        sa.ForeignKeyConstraint(
            ["actor_id"],
            ["users.id"],
            name=op.f("fk_review_events_actor_id_users"),
        ),
        sa.ForeignKeyConstraint(
            ["note_id"],
            ["notes.id"],
            name=op.f("fk_review_events_note_id_notes"),
        ),
        sa.ForeignKeyConstraint(
            ["version_id"],
            ["note_versions.version_id"],
            name=op.f("fk_review_events_version_id_note_versions"),
        ),
        sa.PrimaryKeyConstraint("event_id", name=op.f("pk_review_events")),
    )
    op.create_index(
        "ix_review_events_note_id_occurred_at",
        "review_events",
        ["note_id", "occurred_at"],
        unique=False,
    )

    op.execute(REJECT_CHANGES_FUNCTION)
    for table in IMMUTABLE_TABLES:
        op.execute(
            f"CREATE TRIGGER {table}_reject_changes "
            f"BEFORE UPDATE OR DELETE ON {table} "
            "FOR EACH ROW EXECUTE FUNCTION reject_history_change();"
        )


def downgrade() -> None:
    for table in IMMUTABLE_TABLES:
        op.execute(f"DROP TRIGGER IF EXISTS {table}_reject_changes ON {table};")
    op.execute("DROP FUNCTION IF EXISTS reject_history_change();")

    op.drop_index("ix_review_events_note_id_occurred_at", table_name="review_events")
    op.drop_table("review_events")
    op.drop_constraint(
        "fk_notes_current_version_id_note_versions", "notes", type_="foreignkey"
    )
    op.drop_index(op.f("ix_note_versions_note_id"), table_name="note_versions")
    op.drop_table("note_versions")
    op.drop_index("ix_notes_updated_at_id", table_name="notes")
    op.drop_index(op.f("ix_notes_status"), table_name="notes")
    op.drop_index(op.f("ix_notes_patient_id"), table_name="notes")
    op.drop_index("ix_notes_created_at_id", table_name="notes")
    op.drop_index(op.f("ix_notes_assigned_reviewer_id"), table_name="notes")
    op.drop_table("notes")
    op.drop_index(op.f("ix_sessions_patient_id"), table_name="sessions")
    op.drop_table("sessions")
    op.drop_table("users")
    op.drop_table("patients")
