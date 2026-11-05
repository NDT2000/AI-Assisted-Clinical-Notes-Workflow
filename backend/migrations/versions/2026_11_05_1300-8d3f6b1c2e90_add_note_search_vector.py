"""Add full-text search: notes.search_vector, its trigger and GIN index.

The vector holds the patient's name (weight A, "simple": names are not
stemmed) and the current version's SOAP text (weight B, "english":
stemmed, stop words dropped). A trigger rebuilds it whenever a note gets a
new current version, so every write path keeps it current.

Revision ID: 8d3f6b1c2e90
Revises: 5c1e8f2a9b47
Create Date: 2026-11-05 13:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "8d3f6b1c2e90"
down_revision: str | Sequence[str] | None = "5c1e8f2a9b47"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

BUILD_FUNCTION = """
-- Parameter names differ from column names, which would shadow them.
CREATE FUNCTION note_search_vector(for_patient text, for_version text)
RETURNS tsvector AS $$
    SELECT
        setweight(to_tsvector('simple', coalesce(
            (SELECT p.display_name FROM patients p WHERE p.id = for_patient),
            ''
        )), 'A')
        || setweight(to_tsvector('english', coalesce(
            (SELECT concat_ws(' ', v.subjective, v.objective, v.assessment, v.plan)
             FROM note_versions v WHERE v.version_id = for_version),
            ''
        )), 'B');
$$ LANGUAGE sql STABLE;
"""

TRIGGER_FUNCTION = """
CREATE FUNCTION set_note_search_vector() RETURNS trigger AS $$
BEGIN
    NEW.search_vector := note_search_vector(NEW.patient_id, NEW.current_version_id);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
"""

TRIGGER = """
CREATE TRIGGER notes_search_vector
BEFORE INSERT OR UPDATE OF current_version_id, patient_id ON notes
FOR EACH ROW EXECUTE FUNCTION set_note_search_vector();
"""


def upgrade() -> None:
    op.add_column(
        "notes",
        sa.Column(
            "search_vector",
            postgresql.TSVECTOR(),
            server_default=sa.text("''::tsvector"),
            nullable=False,
        ),
    )
    op.execute(BUILD_FUNCTION)
    op.execute(TRIGGER_FUNCTION)
    op.execute(TRIGGER)
    # Existing notes.
    op.execute(
        "UPDATE notes SET search_vector = "
        "note_search_vector(patient_id, current_version_id)"
    )
    op.create_index(
        "ix_notes_search_vector",
        "notes",
        ["search_vector"],
        postgresql_using="gin",
    )


def downgrade() -> None:
    op.drop_index("ix_notes_search_vector", table_name="notes")
    op.execute("DROP TRIGGER notes_search_vector ON notes")
    op.execute("DROP FUNCTION set_note_search_vector()")
    op.execute("DROP FUNCTION note_search_vector(text, text)")
    op.drop_column("notes", "search_vector")
