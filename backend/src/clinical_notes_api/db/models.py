"""Database tables. They mirror the frontend's domain types.

Ids are strings (for example "note-002614") so URLs and API payloads stay
the same as with the mock backend.
"""

from datetime import date, datetime
from typing import Literal, get_args

from sqlalchemy import (
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from clinical_notes_api.db.base import Base

NoteStatus = Literal[
    "GENERATING",
    "FAILED",
    "READY_FOR_REVIEW",
    "IN_REVIEW",
    "REJECTED",
    "APPROVED",
    "AMENDED",
    "LOCKED",
]

UserRole = Literal["CLINICIAN", "REVIEWER", "ADMIN", "READONLY_AUDITOR"]

NOTE_STATUSES: tuple[str, ...] = get_args(NoteStatus)
USER_ROLES: tuple[str, ...] = get_args(UserRole)

ID_LENGTH = 64


def _one_of(column: str, values: tuple[str, ...]) -> str:
    quoted = ", ".join(f"'{value}'" for value in values)
    return f"{column} IN ({quoted})"


def _timestamp() -> DateTime:
    return DateTime(timezone=True)


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(ID_LENGTH), primary_key=True)
    display_name: Mapped[str] = mapped_column(String(200))
    role: Mapped[UserRole] = mapped_column(String(32))

    __table_args__ = (CheckConstraint(_one_of("role", USER_ROLES), name="role"),)


class Patient(Base):
    __tablename__ = "patients"

    id: Mapped[str] = mapped_column(String(ID_LENGTH), primary_key=True)
    display_name: Mapped[str] = mapped_column(String(200))
    date_of_birth: Mapped[date] = mapped_column(Date)
    medical_record_number: Mapped[str] = mapped_column(String(32), unique=True)


class ClinicalSession(Base):
    """A clinician-patient encounter that a note documents."""

    __tablename__ = "sessions"

    id: Mapped[str] = mapped_column(String(ID_LENGTH), primary_key=True)
    patient_id: Mapped[str] = mapped_column(ForeignKey("patients.id"), index=True)
    clinician_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    started_at: Mapped[datetime] = mapped_column(_timestamp())
    ended_at: Mapped[datetime] = mapped_column(_timestamp())

    patient: Mapped[Patient] = relationship()
    clinician: Mapped[User] = relationship()

    __table_args__ = (
        CheckConstraint("ended_at >= started_at", name="ends_after_start"),
    )


class Note(Base):
    """The workflow container: status, ownership and the current version."""

    __tablename__ = "notes"

    id: Mapped[str] = mapped_column(String(ID_LENGTH), primary_key=True)
    patient_id: Mapped[str] = mapped_column(ForeignKey("patients.id"), index=True)
    session_id: Mapped[str] = mapped_column(ForeignKey("sessions.id"), unique=True)
    status: Mapped[NoteStatus] = mapped_column(String(32), index=True)
    # Null while a note is still being generated and has no version yet.
    # use_alter breaks the notes <-> note_versions cycle at creation time.
    current_version_id: Mapped[str | None] = mapped_column(
        ForeignKey(
            "note_versions.version_id",
            use_alter=True,
            name="fk_notes_current_version_id_note_versions",
        ),
    )
    assigned_reviewer_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id"),
        index=True,
    )
    created_at: Mapped[datetime] = mapped_column(_timestamp())
    updated_at: Mapped[datetime] = mapped_column(_timestamp())
    approved_at: Mapped[datetime | None] = mapped_column(_timestamp())

    patient: Mapped[Patient] = relationship()
    session: Mapped[ClinicalSession] = relationship()
    assigned_reviewer: Mapped[User | None] = relationship()
    current_version: Mapped["NoteVersion | None"] = relationship(
        foreign_keys=[current_version_id],
        post_update=True,
    )
    versions: Mapped[list["NoteVersion"]] = relationship(
        back_populates="note",
        foreign_keys="NoteVersion.note_id",
        order_by="NoteVersion.revision_number",
    )
    events: Mapped[list["ReviewEvent"]] = relationship(
        back_populates="note",
        order_by="ReviewEvent.occurred_at",
    )

    __table_args__ = (
        CheckConstraint(_one_of("status", NOTE_STATUSES), name="status"),
        CheckConstraint("updated_at >= created_at", name="updated_after_created"),
        # Stable keyset pagination for the notes list: (sort column, id).
        Index("ix_notes_updated_at_id", "updated_at", "id"),
        Index("ix_notes_created_at_id", "created_at", "id"),
    )


class NoteVersion(Base):
    """An immutable snapshot of a note's SOAP content.

    Saving creates a new row; a database trigger rejects updates and deletes.
    """

    __tablename__ = "note_versions"

    version_id: Mapped[str] = mapped_column(String(ID_LENGTH), primary_key=True)
    note_id: Mapped[str] = mapped_column(ForeignKey("notes.id"), index=True)
    revision_number: Mapped[int] = mapped_column(Integer)
    parent_version_id: Mapped[str | None] = mapped_column(
        ForeignKey("note_versions.version_id"),
    )
    subjective: Mapped[str] = mapped_column(Text)
    objective: Mapped[str] = mapped_column(Text)
    assessment: Mapped[str] = mapped_column(Text)
    plan: Mapped[str] = mapped_column(Text)
    author_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    # The author's role when they wrote it; roles can change later.
    author_role: Mapped[UserRole] = mapped_column(String(32))
    created_at: Mapped[datetime] = mapped_column(_timestamp())

    note: Mapped[Note] = relationship(
        back_populates="versions",
        foreign_keys=[note_id],
    )
    author: Mapped[User] = relationship()

    __table_args__ = (
        UniqueConstraint(
            "note_id",
            "revision_number",
            name="uq_note_versions_note_id_revision_number",
        ),
        CheckConstraint("revision_number >= 1", name="revision_positive"),
        CheckConstraint(
            "(revision_number = 1) = (parent_version_id IS NULL)",
            name="only_first_revision_is_root",
        ),
        CheckConstraint(_one_of("author_role", USER_ROLES), name="author_role"),
    )


class ReviewEvent(Base):
    """An append-only record of one workflow transition."""

    __tablename__ = "review_events"

    event_id: Mapped[str] = mapped_column(String(ID_LENGTH), primary_key=True)
    note_id: Mapped[str] = mapped_column(ForeignKey("notes.id"))
    version_id: Mapped[str | None] = mapped_column(
        ForeignKey("note_versions.version_id"),
    )
    from_status: Mapped[NoteStatus] = mapped_column(String(32))
    to_status: Mapped[NoteStatus] = mapped_column(String(32))
    actor_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    actor_role: Mapped[UserRole] = mapped_column(String(32))
    reason: Mapped[str | None] = mapped_column(Text)
    occurred_at: Mapped[datetime] = mapped_column(_timestamp())

    note: Mapped[Note] = relationship(back_populates="events")
    actor: Mapped[User] = relationship()

    __table_args__ = (
        CheckConstraint(_one_of("from_status", NOTE_STATUSES), name="from_status"),
        CheckConstraint(_one_of("to_status", NOTE_STATUSES), name="to_status"),
        CheckConstraint(_one_of("actor_role", USER_ROLES), name="actor_role"),
        Index("ix_review_events_note_id_occurred_at", "note_id", "occurred_at"),
    )
