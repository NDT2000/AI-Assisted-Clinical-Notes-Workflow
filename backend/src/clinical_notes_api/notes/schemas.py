"""Request and response bodies for the note endpoints.

They match the frontend's domain types (camelCase JSON, ISO timestamps like
JavaScript's toISOString), so the frontend can switch from the mock server
without changes.
"""

from datetime import UTC, date, datetime
from typing import Annotated, Any, Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    PlainSerializer,
    StringConstraints,
    model_serializer,
)
from pydantic.alias_generators import to_camel

from clinical_notes_api.db.models import (
    CLIENT_MUTATION_ID_LENGTH,
    ID_LENGTH,
    NoteStatus,
    UserRole,
)


def to_iso(value: datetime) -> str:
    """The format of JavaScript's Date.prototype.toISOString()."""
    utc = value.astimezone(UTC)
    return utc.strftime("%Y-%m-%dT%H:%M:%S.") + f"{utc.microsecond // 1000:03d}Z"


Timestamp = Annotated[datetime, PlainSerializer(to_iso, return_type=str)]

# A non-blank string, as the mock server's trim().length > 0 checks.
NonBlankId = Annotated[str, StringConstraints(pattern=r"\S", max_length=ID_LENGTH)]
ClientMutationId = Annotated[
    str,
    StringConstraints(pattern=r"\S", max_length=CLIENT_MUTATION_ID_LENGTH),
]

# The actions a person can take; the others are run by the system.
UserTrigger = Literal[
    "REGENERATE",
    "START_REVIEW",
    "RETURN_TO_QUEUE",
    "APPROVE",
    "REJECT",
    "RESUBMIT",
    "AMEND",
]

MAX_BULK_NOTES = 1_000


class ApiModel(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        validate_by_alias=True,
        validate_by_name=True,
    )


# --- List -----------------------------------------------------------------


class PatientRef(ApiModel):
    id: str
    display_name: str


class ReviewerRef(ApiModel):
    id: str
    display_name: str


class VersionRef(ApiModel):
    id: str
    revision: int


class NoteSummary(ApiModel):
    id: str
    patient: PatientRef
    status: NoteStatus
    current_version: VersionRef
    assigned_reviewer: ReviewerRef | None
    content_preview: str
    created_at: Timestamp
    updated_at: Timestamp


class NoteListCursor(ApiModel):
    next: str | None = Field(description="Pass as `cursor` for the next page.")
    has_more: bool


class NoteListMeta(ApiModel):
    total: int = Field(description="Notes matching the filters, on all pages.")
    returned: int


class NoteListResponse(ApiModel):
    items: list[NoteSummary]
    cursor: NoteListCursor
    meta: NoteListMeta


class PatientOption(ApiModel):
    id: str
    display_name: str


class PatientsResponse(ApiModel):
    items: list[PatientOption]


# --- Detail ---------------------------------------------------------------


class SoapContent(ApiModel):
    subjective: str
    objective: str
    assessment: str
    plan: str


class Note(ApiModel):
    id: str
    patient_id: str
    session_id: str
    status: NoteStatus
    current_version_id: str
    assigned_reviewer_id: str | None
    created_at: Timestamp
    updated_at: Timestamp
    approved_at: Timestamp | None = Field(
        default=None,
        description="Left out until the note is approved.",
    )

    # The frontend type has approvedAt?: string, so leave it out, not null.
    # No return annotation: it keeps the field list in the OpenAPI schema.
    @model_serializer(mode="wrap")
    def _omit_missing_approval(self, handler):
        data = handler(self)
        if self.approved_at is None:
            data.pop("approvedAt", None)
        return data


class UserSummary(ApiModel):
    id: str
    display_name: str
    role: UserRole


class PatientInformation(ApiModel):
    id: str
    display_name: str
    date_of_birth: date
    medical_record_number: str


class SessionInformation(ApiModel):
    id: str
    started_at: Timestamp
    ended_at: Timestamp
    clinician: UserSummary


class NoteVersionDetail(ApiModel):
    version_id: str
    note_id: str
    revision_number: int
    parent_version_id: str | None
    content: SoapContent
    author_id: str
    author_role: UserRole
    author_display_name: str
    created_at: Timestamp


class ReviewTimelineEvent(ApiModel):
    event_id: str
    note_id: str
    version_id: str | None
    from_status: NoteStatus
    to_status: NoteStatus
    actor_id: str
    actor_role: UserRole
    actor_display_name: str
    reason: str | None = Field(default=None, description="Left out when empty.")
    occurred_at: Timestamp

    @model_serializer(mode="wrap")
    def _omit_missing_reason(self, handler):
        data = handler(self)
        if self.reason is None:
            data.pop("reason", None)
        return data


class PresenceUser(ApiModel):
    user: UserSummary
    activity: Literal["VIEWING", "EDITING"]
    last_seen_at: Timestamp


class NoteDetail(ApiModel):
    note: Note
    patient: PatientInformation
    session: SessionInformation
    assigned_reviewer: UserSummary | None
    current_version: NoteVersionDetail
    versions: list[NoteVersionDetail]
    timeline: list[ReviewTimelineEvent]
    presence: list[PresenceUser] = Field(
        description="Who else has the note open. Always empty until real-time "
        "presence exists.",
    )


# --- Saving a version -----------------------------------------------------


class SaveNoteVersionRequest(ApiModel):
    base_version_id: NonBlankId = Field(
        description="The version the edit started from.",
    )
    client_mutation_id: ClientMutationId = Field(
        description="Retrying with the same id returns the first answer.",
    )
    content: SoapContent


class SaveNoteVersionResponse(ApiModel):
    client_mutation_id: str
    note: Note
    saved_version: NoteVersionDetail


class SaveVersionConflictResponse(ApiModel):
    error: Literal["version_conflict"]
    message: str
    current_version: NoteVersionDetail
    common_ancestor: NoteVersionDetail | None


# --- Transitions ----------------------------------------------------------


class TransitionNoteRequest(ApiModel):
    base_version_id: NonBlankId
    client_mutation_id: ClientMutationId
    trigger: UserTrigger
    rejection_reason: str | None = Field(default=None, max_length=2_000)


class TransitionNoteResponse(ApiModel):
    client_mutation_id: str
    note: Note
    timeline_event: ReviewTimelineEvent
    current_version: NoteVersionDetail


class TransitionConflictResponse(ApiModel):
    error: Literal["version_conflict"]
    message: str
    current_version: NoteVersionDetail


# --- Bulk actions ---------------------------------------------------------

NoteIds = Annotated[
    list[NonBlankId],
    Field(min_length=1, max_length=MAX_BULK_NOTES),
]


class AssignReviewerRequest(ApiModel):
    note_ids: NoteIds
    reviewer_id: NonBlankId | None = Field(
        description="The reviewer to assign, or null to unassign.",
    )
    reviewer_display_name: str | None = Field(
        default=None,
        description="Ignored: the name comes from the user record. Accepted "
        "because the frontend sends it.",
    )


class AssignReviewerResponse(ApiModel):
    updated: list[str]


class RegenerateRequest(ApiModel):
    note_ids: NoteIds


class RegenerateResponse(ApiModel):
    updated: list[str]
    skipped: list[str]


# --- Telemetry ------------------------------------------------------------


class TelemetryEvent(ApiModel):
    # Unknown fields are kept so the clinical-content check sees them too.
    model_config = ConfigDict(extra="allow")

    event_id: str
    name: str
    occurred_at: str
    important: bool
    properties: dict[str, Any]


class TelemetryBatch(ApiModel):
    model_config = ConfigDict(extra="allow")

    schema_version: Literal[1]
    sent_at: str
    reason: str
    events: list[TelemetryEvent] = Field(max_length=500)


class TelemetryAccepted(ApiModel):
    accepted: int
