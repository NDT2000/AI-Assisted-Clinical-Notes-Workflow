"""Loads the synthetic mock data into the database."""

from collections.abc import Iterable
from dataclasses import dataclass

from sqlalchemy import func, insert, select, text, update
from sqlalchemy.orm import Session

from clinical_notes_api.db import (
    Base,
    ClinicalSession,
    Note,
    NoteVersion,
    Patient,
    ReviewEvent,
    User,
)
from clinical_notes_api.seed.mock_data import (
    CLINICIANS,
    REVIEWERS,
    Json,
    from_iso,
    generate_note_detail,
    generate_note_summaries,
)

# The frontend's demo identities, plus the extra clinicians the mock notes
# use. users is the one source of truth for names (the mock detail
# generator calls admin-1 "Jordan Taylor"; the demo identity is "Jordan Lee").
SEED_USERS: tuple[Json, ...] = (
    *CLINICIANS,
    *({**reviewer, "role": "REVIEWER"} for reviewer in REVIEWERS),
    {"id": "admin-1", "displayName": "Jordan Lee", "role": "ADMIN"},
    {"id": "auditor-1", "displayName": "Taylor Morgan", "role": "READONLY_AUDITOR"},
)

TABLES_IN_DEPENDENCY_ORDER = (
    "review_events",
    "note_versions",
    "notes",
    "sessions",
    "patients",
    "users",
)

BATCH_SIZE = 1_000


class SeedError(RuntimeError):
    pass


@dataclass(frozen=True)
class SeedResult:
    users: int
    patients: int
    notes: int
    versions: int
    events: int


def _batched(rows: list[Json]) -> Iterable[list[Json]]:
    for start in range(0, len(rows), BATCH_SIZE):
        yield rows[start : start + BATCH_SIZE]


def _insert(session: Session, model: type[Base], rows: list[Json]) -> None:
    # Core inserts on the table: one multi-row statement per batch. The ORM
    # bulk path issued one statement per few rows here.
    connection = session.connection()
    for batch in _batched(rows):
        connection.execute(insert(model.__table__), batch)


def clear_all(session: Session) -> None:
    """Empty every table. TRUNCATE skips the history-immutability triggers."""
    session.execute(text(f"TRUNCATE {', '.join(TABLES_IN_DEPENDENCY_ORDER)}"))


def seed_database(
    session: Session,
    count: int = 5_000,
    seed: int = 42,
    reset: bool = False,
) -> SeedResult:
    """Insert `count` synthetic notes; the caller commits."""
    if reset:
        clear_all(session)
    elif session.scalar(select(func.count()).select_from(Note)):
        raise SeedError("The database already has notes.")

    details = [
        generate_note_detail(summary)
        for summary in generate_note_summaries(count, seed)
    ]

    users = [
        {"id": user["id"], "display_name": user["displayName"], "role": user["role"]}
        for user in SEED_USERS
    ]

    patients_by_id: dict[str, Json] = {}
    sessions, notes, versions, events = [], [], [], []

    for detail in details:
        patient = detail["patient"]
        patients_by_id[patient["id"]] = {
            "id": patient["id"],
            "display_name": patient["displayName"],
            "date_of_birth": from_iso(f"{patient['dateOfBirth']}T00:00:00Z").date(),
            "medical_record_number": patient["medicalRecordNumber"],
        }

        clinical_session = detail["session"]
        sessions.append(
            {
                "id": clinical_session["id"],
                "patient_id": patient["id"],
                "clinician_id": clinical_session["clinician"]["id"],
                "started_at": from_iso(clinical_session["startedAt"]),
                "ended_at": from_iso(clinical_session["endedAt"]),
            }
        )

        note = detail["note"]
        notes.append(
            {
                "id": note["id"],
                "patient_id": note["patientId"],
                "session_id": note["sessionId"],
                "status": note["status"],
                # Set after the versions exist; the two tables reference
                # each other.
                "current_version_id": None,
                "assigned_reviewer_id": note["assignedReviewerId"],
                "created_at": from_iso(note["createdAt"]),
                "updated_at": from_iso(note["updatedAt"]),
                "approved_at": from_iso(note["approvedAt"])
                if "approvedAt" in note
                else None,
            }
        )

        for version in detail["versions"]:
            versions.append(
                {
                    "version_id": version["versionId"],
                    "note_id": version["noteId"],
                    "revision_number": version["revisionNumber"],
                    "parent_version_id": version["parentVersionId"],
                    **version["content"],
                    "author_id": version["authorId"],
                    "author_role": version["authorRole"],
                    "created_at": from_iso(version["createdAt"]),
                }
            )

        for event in detail["timeline"]:
            events.append(
                {
                    "event_id": event["eventId"],
                    "note_id": event["noteId"],
                    "version_id": event["versionId"],
                    "from_status": event["fromStatus"],
                    "to_status": event["toStatus"],
                    "actor_id": event["actorId"],
                    "actor_role": event["actorRole"],
                    "reason": event.get("reason"),
                    "occurred_at": from_iso(event["occurredAt"]),
                }
            )

    _insert(session, User, users)
    _insert(session, Patient, list(patients_by_id.values()))
    _insert(session, ClinicalSession, sessions)
    _insert(session, Note, notes)
    _insert(session, NoteVersion, versions)

    # Point each note at its newest version in one statement.
    newest = (
        select(NoteVersion.version_id)
        .where(NoteVersion.note_id == Note.id)
        .order_by(NoteVersion.revision_number.desc())
        .limit(1)
        .scalar_subquery()
    )
    session.execute(update(Note).values(current_version_id=newest))

    _insert(session, ReviewEvent, events)

    return SeedResult(
        users=len(users),
        patients=len(patients_by_id),
        notes=len(notes),
        versions=len(versions),
        events=len(events),
    )
