"""Schema, constraints and seeding, against a real Postgres database."""

from datetime import UTC, datetime

import pytest
from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from sqlalchemy import Engine, func, select, text, update
from sqlalchemy.exc import DBAPIError, IntegrityError
from sqlalchemy.orm import Session

from clinical_notes_api.db import Base, Note, NoteVersion, ReviewEvent, User
from clinical_notes_api.seed.load import SeedError, seed_database
from clinical_notes_api.seed.mock_data import (
    from_iso,
    generate_note_detail,
    generate_note_summaries,
)
from tests.conftest import alembic_config

SEED_COUNT = 200


@pytest.fixture
def seeded(session: Session) -> Session:
    seed_database(session, count=SEED_COUNT, reset=True)
    session.flush()
    return session


def test_migrations_match_the_models(engine: Engine) -> None:
    with engine.connect() as connection:
        context = MigrationContext.configure(
            connection,
            opts={"compare_type": True},
        )
        differences = compare_metadata(context, Base.metadata)

    assert differences == []


def test_migrations_downgrade_and_upgrade_cleanly(test_database_url: str) -> None:
    config = alembic_config(test_database_url)

    command.downgrade(config, "base")
    command.upgrade(config, "head")


def test_seed_loads_every_note_with_its_history(seeded: Session) -> None:
    assert seeded.scalar(select(func.count()).select_from(Note)) == SEED_COUNT
    assert seeded.scalar(select(func.count()).select_from(User)) == 10

    notes_without_current_version = seeded.scalar(
        select(func.count()).select_from(Note).where(Note.current_version_id.is_(None))
    )
    assert notes_without_current_version == 0


@pytest.mark.parametrize("note_index", [0, 1, 57, SEED_COUNT - 1])
def test_seeded_rows_match_the_generator(seeded: Session, note_index: int) -> None:
    # The generated data depends on the note count, so compare against the
    # generator run with the same count.
    summary = generate_note_summaries(SEED_COUNT)[note_index]
    expected = generate_note_detail(summary)

    note = seeded.get(Note, summary["id"])

    assert note is not None
    assert note.status == expected["note"]["status"]
    assert note.patient.display_name == expected["patient"]["displayName"]
    assert note.assigned_reviewer_id == expected["note"]["assignedReviewerId"]
    assert note.current_version_id == expected["note"]["currentVersionId"]
    assert [version.version_id for version in note.versions] == [
        version["versionId"] for version in expected["versions"]
    ]
    assert [(event.event_id, event.to_status) for event in note.events] == [
        (event["eventId"], event["toStatus"]) for event in expected["timeline"]
    ]
    assert note.created_at == from_iso(expected["note"]["createdAt"])
    expected_approved_at = expected["note"].get("approvedAt")
    assert note.approved_at == (
        from_iso(expected_approved_at) if expected_approved_at else None
    )


def test_seeding_twice_requires_reset(seeded: Session) -> None:
    with pytest.raises(SeedError):
        seed_database(seeded, count=SEED_COUNT)


@pytest.mark.parametrize(
    "statement",
    [
        update(NoteVersion).values(plan="Rewritten history"),
        text("DELETE FROM note_versions"),
        update(ReviewEvent).values(reason="Rewritten history"),
        text("DELETE FROM review_events"),
    ],
    ids=["update version", "delete version", "update event", "delete event"],
)
def test_history_rows_are_immutable(seeded: Session, statement: object) -> None:
    with pytest.raises(DBAPIError, match="immutable"):
        seeded.execute(statement)  # type: ignore[call-overload]


def test_rejects_an_unknown_status(seeded: Session) -> None:
    with pytest.raises(IntegrityError, match="ck_notes_status"):
        seeded.execute(
            update(Note).where(Note.id == "note-000001").values(status="ARCHIVED")
        )


def test_rejects_a_duplicate_revision_number(seeded: Session) -> None:
    note = seeded.get(Note, "note-000001")
    assert note is not None
    current = note.current_version
    assert current is not None

    seeded.add(
        NoteVersion(
            version_id="duplicate-revision",
            note_id=note.id,
            revision_number=current.revision_number,
            parent_version_id=current.version_id,
            subjective="S",
            objective="O",
            assessment="A",
            plan="P",
            author_id=current.author_id,
            author_role=current.author_role,
            created_at=current.created_at,
        )
    )

    with pytest.raises(IntegrityError, match="uq_note_versions_note_id_revision"):
        seeded.flush()


def test_only_the_first_revision_may_have_no_parent(seeded: Session) -> None:
    seeded.add(
        NoteVersion(
            version_id="orphan-revision",
            note_id="note-000001",
            revision_number=9,
            parent_version_id=None,
            subjective="S",
            objective="O",
            assessment="A",
            plan="P",
            author_id="reviewer-3",
            author_role="REVIEWER",
            created_at=datetime(2026, 7, 1, tzinfo=UTC),
        )
    )

    with pytest.raises(IntegrityError, match="only_first_revision_is_root"):
        seeded.flush()
