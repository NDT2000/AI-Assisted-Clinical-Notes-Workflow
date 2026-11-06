"""Database tables. They mirror the frontend's domain types.

Ids are strings (for example "note-002614") so URLs and API payloads stay
the same as with the mock backend.
"""

from datetime import date, datetime
from typing import Any, Literal, get_args

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Identity,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    false,
    func,
    text,
    true,
)
from sqlalchemy.dialects.postgresql import JSONB, TSVECTOR
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

# The two note mutations a client retries with the same clientMutationId.
MutationKind = Literal["SAVE_VERSION", "TRANSITION"]

# What an administrator (or the create-admin command) did to an account.
UserAdminAction = Literal[
    "CREATED",
    "RENAMED",
    "ROLE_CHANGED",
    "DEACTIVATED",
    "REACTIVATED",
    "SETUP_LINK_ISSUED",
    "PASSWORD_SET",
]

NOTE_STATUSES: tuple[str, ...] = get_args(NoteStatus)
USER_ROLES: tuple[str, ...] = get_args(UserRole)
MUTATION_KINDS: tuple[str, ...] = get_args(MutationKind)
USER_ADMIN_ACTIONS: tuple[str, ...] = get_args(UserAdminAction)

# Sign-in names: 3-32 lowercase letters, digits, dots, dashes or underscores.
USERNAME_LENGTH = 32
USERNAME_PATTERN = "^[a-z0-9._-]{3,32}$"

# Longest username a sign-in request may send (longer than a real one, so a
# mistyped name still gets the ordinary "incorrect" answer).
LOGIN_USERNAME_LENGTH = 64

# SHA-256 in hex, for setup links and renewal tokens stored as hashes.
TOKEN_HASH_LENGTH = 64

# Longest clientMutationId the API accepts.
CLIENT_MUTATION_ID_LENGTH = 128

ID_LENGTH = 64


def _one_of(column: str, values: tuple[str, ...]) -> str:
    quoted = ", ".join(f"'{value}'" for value in values)
    return f"{column} IN ({quoted})"


def _timestamp() -> DateTime:
    return DateTime(timezone=True)


class User(Base):
    """A person who signs in. Never deleted: history refers to users."""

    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(ID_LENGTH), primary_key=True)
    # What the person signs in with; the id is internal.
    username: Mapped[str] = mapped_column(String(USERNAME_LENGTH), unique=True)
    display_name: Mapped[str] = mapped_column(String(200))
    role: Mapped[UserRole] = mapped_column(String(32))
    # Argon2 hash; null means the user cannot log in.
    password_hash: Mapped[str | None] = mapped_column(String(255))
    # Stand-in for a real second factor: approving a note requires it.
    mfa_enabled: Mapped[bool] = mapped_column(
        Boolean,
        server_default=false(),
    )
    # Deactivated users keep their history but cannot sign in.
    is_active: Mapped[bool] = mapped_column(Boolean, server_default=true())
    created_at: Mapped[datetime] = mapped_column(
        _timestamp(),
        server_default=func.now(),
    )
    # Null for users made by the seed or the create-admin command.
    created_by_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"))
    last_login_at: Mapped[datetime | None] = mapped_column(_timestamp())

    __table_args__ = (
        CheckConstraint(_one_of("role", USER_ROLES), name="role"),
        CheckConstraint(f"username ~ '{USERNAME_PATTERN}'", name="username_format"),
    )


class UserSetupLink(Base):
    """A one-time link with which a new user chooses their password.

    Only a hash of the link's token is stored, so a database copy cannot be
    used to take over an account.
    """

    __tablename__ = "user_setup_links"

    id: Mapped[str] = mapped_column(String(ID_LENGTH), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    token_hash: Mapped[str] = mapped_column(String(TOKEN_HASH_LENGTH), unique=True)
    created_by_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(_timestamp())
    expires_at: Mapped[datetime] = mapped_column(_timestamp())
    used_at: Mapped[datetime | None] = mapped_column(_timestamp())

    __table_args__ = (
        CheckConstraint("expires_at > created_at", name="expires_after_created"),
    )


class RefreshToken(Base):
    """A renewal token that keeps a user signed in; stored as a hash.

    Each renewal replaces the token with a new one in the same family. A
    replaced token presented again means it was copied: the whole family is
    revoked.
    """

    __tablename__ = "refresh_tokens"

    id: Mapped[str] = mapped_column(String(ID_LENGTH), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    family_id: Mapped[str] = mapped_column(String(ID_LENGTH), index=True)
    token_hash: Mapped[str] = mapped_column(String(TOKEN_HASH_LENGTH), unique=True)
    created_at: Mapped[datetime] = mapped_column(_timestamp())
    expires_at: Mapped[datetime] = mapped_column(_timestamp())
    revoked_at: Mapped[datetime | None] = mapped_column(_timestamp())
    replaced_by_id: Mapped[str | None] = mapped_column(
        ForeignKey("refresh_tokens.id"),
    )

    __table_args__ = (
        CheckConstraint("expires_at > created_at", name="expires_after_created"),
    )


class UserAdminEvent(Base):
    """An append-only record of one change to an account.

    A database trigger rejects updates and deletes.
    """

    __tablename__ = "user_admin_events"

    event_id: Mapped[str] = mapped_column(String(ID_LENGTH), primary_key=True)
    # Null when the change was made by a command, not a signed-in admin.
    actor_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"))
    target_user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    action: Mapped[UserAdminAction] = mapped_column(String(32))
    details: Mapped[dict[str, Any]] = mapped_column(
        JSONB,
        server_default=text("'{}'::jsonb"),
    )
    occurred_at: Mapped[datetime] = mapped_column(_timestamp())

    __table_args__ = (
        CheckConstraint(_one_of("action", USER_ADMIN_ACTIONS), name="action"),
    )


class LoginAttempt(Base):
    """A failed sign-in, kept briefly to slow down password guessing.

    Rows older than the lockout window no longer count and are removed as
    new failures arrive.
    """

    __tablename__ = "login_attempts"

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    # As typed (trimmed and lowercase), whether or not such a user exists.
    username: Mapped[str] = mapped_column(String(LOGIN_USERNAME_LENGTH))
    ip_address: Mapped[str] = mapped_column(String(64))
    attempted_at: Mapped[datetime] = mapped_column(_timestamp())

    __table_args__ = (
        Index("ix_login_attempts_username_attempted_at", "username", "attempted_at"),
        Index(
            "ix_login_attempts_ip_address_attempted_at",
            "ip_address",
            "attempted_at",
        ),
        Index("ix_login_attempts_attempted_at", "attempted_at"),
    )


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
    # Full-text search over the patient's name and the current version.
    # A database trigger keeps it current (migration 8d3f6b1c2e90); deferred,
    # so loading a note does not fetch it.
    search_vector: Mapped[str] = mapped_column(
        TSVECTOR,
        server_default=text("''::tsvector"),
        deferred=True,
    )

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
        Index("ix_notes_search_vector", "search_vector", postgresql_using="gin"),
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


class ClientMutation(Base):
    """The stored answer to one save or transition.

    A client that retries a request with the same clientMutationId gets the
    same answer instead of a second change; reusing the id for a different
    request is refused.
    """

    __tablename__ = "client_mutations"

    note_id: Mapped[str] = mapped_column(ForeignKey("notes.id"), primary_key=True)
    kind: Mapped[MutationKind] = mapped_column(String(32), primary_key=True)
    client_mutation_id: Mapped[str] = mapped_column(
        String(CLIENT_MUTATION_ID_LENGTH),
        primary_key=True,
    )
    # SHA-256 of the request and who sent it.
    request_signature: Mapped[str] = mapped_column(String(64))
    response: Mapped[dict[str, Any]] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(_timestamp())

    __table_args__ = (CheckConstraint(_one_of("kind", MUTATION_KINDS), name="kind"),)
