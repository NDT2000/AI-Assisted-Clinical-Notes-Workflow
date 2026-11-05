"""The note and patient routes. They mirror the frontend's mock server."""

from datetime import date
from typing import Annotated, Any

from fastapi import APIRouter, Query, status

from clinical_notes_api.db.models import NoteStatus
from clinical_notes_api.dependencies import CurrentUser, DbSession
from clinical_notes_api.errors import ErrorResponse
from clinical_notes_api.notes import mutations, queries, schemas

router = APIRouter(tags=["notes"])


def _errors(*codes: int) -> dict[int | str, dict[str, Any]]:
    return {code: {"model": ErrorResponse} for code in (400, 401, *codes)}


# Repeatable query parameters (?status=A&status=B).
Statuses = Annotated[list[NoteStatus], Query(alias="status")]
ReviewerIds = Annotated[list[str], Query(alias="reviewerId")]
PatientIds = Annotated[list[str], Query(alias="patientId")]
CreatedFrom = Annotated[date | None, Query(alias="createdFrom")]
CreatedTo = Annotated[date | None, Query(alias="createdTo")]


def _clean(values: list[str]) -> list[str]:
    return [value.strip() for value in values if value.strip()]


@router.get("/notes", responses=_errors())
def list_notes(
    _user: CurrentUser,
    session: DbSession,
    statuses: Statuses = [],  # noqa: B006 - FastAPI copies defaults
    reviewer_ids: ReviewerIds = [],  # noqa: B006
    patient_ids: PatientIds = [],  # noqa: B006
    created_from: CreatedFrom = None,
    created_to: CreatedTo = None,
    q: str = "",
    sort_by: Annotated[queries.SortField, Query(alias="sortBy")] = "updatedAt",
    sort_order: Annotated[queries.SortOrder, Query(alias="sortOrder")] = "desc",
    limit: Annotated[int, Query(ge=1, description="At most 100.")] = (
        queries.DEFAULT_LIMIT
    ),
    cursor: str | None = None,
) -> schemas.NoteListResponse:
    """One page of notes, newest change first unless sorted otherwise."""
    return queries.list_notes(
        session,
        queries.NoteListQuery(
            filters=queries.NoteFilters(
                statuses=statuses,
                reviewer_ids=_clean(reviewer_ids),
                patient_ids=_clean(patient_ids),
                created_from=created_from,
                created_to=created_to,
            ),
            search=q,
            sort_by=sort_by,
            sort_order=sort_order,
            limit=min(limit, queries.MAX_LIMIT),
            cursor=cursor,
        ),
    )


@router.get("/notes/{note_id}", responses=_errors(404))
def read_note(
    note_id: str,
    _user: CurrentUser,
    session: DbSession,
) -> schemas.NoteDetail:
    """A note with its patient, session, versions and review history."""
    return queries.get_note_detail(session, note_id)


@router.post(
    "/notes/{note_id}/versions",
    status_code=status.HTTP_201_CREATED,
    responses={
        **_errors(403, 404),
        409: {
            "model": schemas.SaveVersionConflictResponse | ErrorResponse,
            "description": "version_conflict (the note changed since "
            "baseVersionId) or idempotency_conflict.",
        },
    },
)
def save_note_version(
    note_id: str,
    body: schemas.SaveNoteVersionRequest,
    user: CurrentUser,
    session: DbSession,
) -> schemas.SaveNoteVersionResponse:
    """Save edited content as a new version of the note."""
    return mutations.save_version(session, note_id, body, user)


@router.post(
    "/notes/{note_id}/transitions",
    responses={
        **_errors(404),
        409: {
            "model": schemas.TransitionConflictResponse | ErrorResponse,
            "description": "version_conflict or idempotency_conflict.",
        },
        422: {
            "model": ErrorResponse,
            "description": "transition_not_allowed, with the workflow's reason.",
        },
    },
)
def transition_note(
    note_id: str,
    body: schemas.TransitionNoteRequest,
    user: CurrentUser,
    session: DbSession,
) -> schemas.TransitionNoteResponse:
    """Run a workflow action (start review, approve, reject, ...)."""
    return mutations.transition_note(session, note_id, body, user)


@router.post("/notes/bulk/assign-reviewer", responses=_errors(403))
def assign_reviewer(
    body: schemas.AssignReviewerRequest,
    user: CurrentUser,
    session: DbSession,
) -> schemas.AssignReviewerResponse:
    """Assign a reviewer to several notes; notes in other statuses are left."""
    return mutations.assign_reviewer(session, body, user)


@router.post("/notes/bulk/regenerate", responses=_errors(403))
def regenerate_notes(
    body: schemas.RegenerateRequest,
    user: CurrentUser,
    session: DbSession,
) -> schemas.RegenerateResponse:
    """Send failed notes back to generation."""
    return mutations.regenerate(session, body, user)


@router.get("/patients", responses=_errors())
def find_patients(
    _user: CurrentUser,
    session: DbSession,
    q: str = "",
    patient_id: Annotated[str | None, Query(alias="patientId")] = None,
    statuses: Statuses = [],  # noqa: B006
    reviewer_ids: ReviewerIds = [],  # noqa: B006
    created_from: CreatedFrom = None,
    created_to: CreatedTo = None,
) -> schemas.PatientsResponse:
    """Up to 20 patients, by name, who have notes matching the filters."""
    return queries.find_patients(
        session,
        search=q,
        patient_id=patient_id.strip() if patient_id else None,
        filters=queries.NoteFilters(
            statuses=statuses,
            reviewer_ids=_clean(reviewer_ids),
            created_from=created_from,
            created_to=created_to,
        ),
    )
