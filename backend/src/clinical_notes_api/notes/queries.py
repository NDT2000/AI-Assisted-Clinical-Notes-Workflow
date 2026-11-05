"""Reading notes: the list, one note's detail, and patient lookup."""

import base64
import binascii
import json
import re
from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, time, timedelta
from typing import Any, Literal

from sqlalchemy import (
    ColumnElement,
    Select,
    case,
    cast,
    exists,
    func,
    literal,
    select,
    tuple_,
)
from sqlalchemy.dialects.postgresql import REGCONFIG
from sqlalchemy.orm import Session, aliased, selectinload

from clinical_notes_api.db import (
    ClinicalSession,
    Note,
    NoteVersion,
    Patient,
    ReviewEvent,
    User,
)
from clinical_notes_api.errors import not_found
from clinical_notes_api.notes import schemas

DEFAULT_LIMIT = 20
MAX_LIMIT = 100
MAX_PATIENT_RESULTS = 20
PREVIEW_MAX_LENGTH = 120
EMPTY_PREVIEW = "No note content available."

SortField = Literal["createdAt", "updatedAt", "patientName", "status"]
SortOrder = Literal["asc", "desc"]

_SORT_COLUMNS: dict[str, Any] = {
    "createdAt": Note.created_at,
    "updatedAt": Note.updated_at,
    "patientName": Patient.display_name,
    "status": Note.status,
}
_TIMESTAMP_SORTS = frozenset({"createdAt", "updatedAt"})

_Reviewer = aliased(User, name="reviewer")


@dataclass(frozen=True)
class NoteFilters:
    """The list filters; an empty list means "any"."""

    statuses: Sequence[str] = ()
    reviewer_ids: Sequence[str] = ()
    patient_ids: Sequence[str] = ()
    created_from: date | None = None
    created_to: date | None = None


@dataclass(frozen=True)
class NoteListQuery:
    filters: NoteFilters = field(default_factory=NoteFilters)
    search: str = ""
    sort_by: SortField = "updatedAt"
    sort_order: SortOrder = "desc"
    limit: int = DEFAULT_LIMIT
    cursor: str | None = None


# --- Content preview -------------------------------------------------------

_WHITESPACE = " \t\n\r"


def content_preview_expression(
    sections: Sequence[ColumnElement[str]] | None = None,
) -> ColumnElement[str]:
    """The list's one-line preview of a note, worked out in SQL.

    The first sentence of the first non-empty SOAP section, cut to 120
    characters. `sections` defaults to the version's four SOAP columns.
    """
    if sections is None:
        sections = (
            NoteVersion.subjective,
            NoteVersion.objective,
            NoteVersion.assessment,
            NoteVersion.plan,
        )
    non_empty = [
        func.nullif(func.btrim(section, _WHITESPACE), "") for section in sections
    ]
    first_section = func.coalesce(*non_empty)
    # Shortest text up to . ! or ? followed by whitespace or the end.
    first_sentence = func.coalesce(
        func.substring(first_section, r"^.*?[.!?](?=\s|$)"),
        first_section,
    )
    return case(
        (first_sentence.is_(None), literal(EMPTY_PREVIEW)),
        (func.length(first_sentence) <= PREVIEW_MAX_LENGTH, first_sentence),
        else_=func.left(first_sentence, PREVIEW_MAX_LENGTH - 3) + "...",
    )


# --- Filters ---------------------------------------------------------------


def _start_of_day(day: date) -> datetime:
    return datetime.combine(day, time.min, tzinfo=UTC)


def _note_filter_conditions(filters: NoteFilters) -> list[ColumnElement[bool]]:
    conditions: list[ColumnElement[bool]] = []
    if filters.statuses:
        conditions.append(Note.status.in_(filters.statuses))
    if filters.reviewer_ids:
        conditions.append(Note.assigned_reviewer_id.in_(filters.reviewer_ids))
    if filters.patient_ids:
        conditions.append(Note.patient_id.in_(filters.patient_ids))
    if filters.created_from is not None:
        conditions.append(Note.created_at >= _start_of_day(filters.created_from))
    if filters.created_to is not None:
        # The whole "to" day is included.
        next_day = _start_of_day(filters.created_to + timedelta(days=1))
        conditions.append(Note.created_at < next_day)
    return conditions


# --- Full-text search ------------------------------------------------------

MAX_SEARCH_TERMS = 10
# Letters and digits only: nothing a user types can change the query syntax.
_SEARCH_TERM = re.compile(r"[^\W_]+")


def search_terms(text: str) -> list[str]:
    return _SEARCH_TERM.findall(text.lower())[:MAX_SEARCH_TERMS]


def _prefix_query(config: str, term: str) -> ColumnElement[Any]:
    return func.to_tsquery(cast(literal(config), REGCONFIG), f"{term}:*")


def full_text_query(text: str) -> ColumnElement[Any] | None:
    """The search as a tsquery for notes.search_vector, or None if empty.

    Every word must match, as the start of a word, either the patient's name
    or the note's text. Names are matched as typed ("simple"); note text is
    stemmed ("english"), so "improving" finds "improvement".
    """
    terms = search_terms(text)
    if not terms:
        return None

    query: ColumnElement[Any] | None = None
    for term in terms:
        either = _prefix_query("simple", term).op("||")(_prefix_query("english", term))
        query = either if query is None else query.op("&&")(either)
    return query


def _contains(column: ColumnElement[str], text: str) -> ColumnElement[bool]:
    escaped = text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return column.ilike(f"%{escaped}%", escape="\\")


# --- Cursor ----------------------------------------------------------------


def encode_cursor(sort_by: str, sort_value: str, note_id: str) -> str:
    payload = json.dumps({"sortBy": sort_by, "sortValue": sort_value, "id": note_id})
    return base64.urlsafe_b64encode(payload.encode()).decode()


def _decode_cursor(cursor: str, sort_by: str) -> tuple[Any, str] | None:
    """The (sort value, id) to continue after, or None for an unusable cursor.

    As in the mock server, a cursor that cannot be read starts from the
    first page instead of failing.
    """
    try:
        payload = json.loads(base64.urlsafe_b64decode(cursor.encode()))
        sort_value, note_id = payload["sortValue"], payload["id"]
        if payload.get("sortBy") != sort_by:
            return None
        if not isinstance(sort_value, str) or not isinstance(note_id, str):
            return None
        if sort_by in _TIMESTAMP_SORTS:
            return datetime.fromisoformat(sort_value), note_id
        return sort_value, note_id
    except (ValueError, KeyError, TypeError, binascii.Error):
        return None


def _cursor_sort_value(value: Any) -> str:
    return value.isoformat() if isinstance(value, datetime) else str(value)


# --- List ------------------------------------------------------------------


def _with_list_joins(statement: Select[Any]) -> Select[Any]:
    return (
        statement.join(Patient, Note.patient_id == Patient.id)
        .join(NoteVersion, Note.current_version_id == NoteVersion.version_id)
        .outerjoin(_Reviewer, Note.assigned_reviewer_id == _Reviewer.id)
    )


def list_notes(session: Session, query: NoteListQuery) -> schemas.NoteListResponse:
    preview = content_preview_expression().label("content_preview")

    conditions = _note_filter_conditions(query.filters)
    search = full_text_query(query.search)
    if search is not None:
        conditions.append(Note.search_vector.op("@@")(search))

    total = session.scalar(
        _with_list_joins(select(func.count()).select_from(Note)).where(*conditions)
    )

    sort_column = _SORT_COLUMNS[query.sort_by]
    ascending = query.sort_order == "asc"
    page = _with_list_joins(
        select(
            Note,
            Patient.display_name.label("patient_name"),
            NoteVersion.revision_number,
            preview,
            _Reviewer.display_name.label("reviewer_name"),
            sort_column.label("sort_value"),
        ).select_from(Note)
    ).where(*conditions)

    after = _decode_cursor(query.cursor, query.sort_by) if query.cursor else None
    if after is not None:
        position = tuple_(sort_column, Note.id)
        bound = tuple_(literal(after[0], type_=sort_column.type), literal(after[1]))
        page = page.where(position > bound if ascending else position < bound)

    # id breaks ties, so every note has one place in the order.
    if ascending:
        page = page.order_by(sort_column.asc(), Note.id.asc())
    else:
        page = page.order_by(sort_column.desc(), Note.id.desc())

    rows = session.execute(page.limit(query.limit + 1)).all()
    has_more = len(rows) > query.limit
    rows = rows[: query.limit]

    items = [
        schemas.NoteSummary(
            id=row.Note.id,
            patient=schemas.PatientRef(
                id=row.Note.patient_id,
                display_name=row.patient_name,
            ),
            status=row.Note.status,
            current_version=schemas.VersionRef(
                id=row.Note.current_version_id,
                revision=row.revision_number,
            ),
            assigned_reviewer=None
            if row.Note.assigned_reviewer_id is None
            else schemas.ReviewerRef(
                id=row.Note.assigned_reviewer_id,
                display_name=row.reviewer_name,
            ),
            content_preview=row.content_preview,
            created_at=row.Note.created_at,
            updated_at=row.Note.updated_at,
        )
        for row in rows
    ]

    next_cursor = None
    if has_more and rows:
        last = rows[-1]
        next_cursor = encode_cursor(
            query.sort_by,
            _cursor_sort_value(last.sort_value),
            last.Note.id,
        )

    return schemas.NoteListResponse(
        items=items,
        cursor=schemas.NoteListCursor(next=next_cursor, has_more=has_more),
        meta=schemas.NoteListMeta(total=total or 0, returned=len(items)),
    )


# --- Patients --------------------------------------------------------------


def find_patients(
    session: Session,
    search: str,
    patient_id: str | None,
    filters: NoteFilters,
) -> schemas.PatientsResponse:
    """Patients who have at least one note matching the filters."""
    has_matching_note = exists(
        select(Note.id).where(
            Note.patient_id == Patient.id,
            *_note_filter_conditions(filters),
        )
    )
    statement = select(Patient.id, Patient.display_name).where(has_matching_note)

    if patient_id:
        statement = statement.where(Patient.id == patient_id)
    search = search.strip()
    if search:
        statement = statement.where(_contains(Patient.display_name, search))

    rows = session.execute(
        statement.order_by(Patient.display_name, Patient.id).limit(MAX_PATIENT_RESULTS)
    ).all()
    return schemas.PatientsResponse(
        items=[
            schemas.PatientOption(id=row.id, display_name=row.display_name)
            for row in rows
        ]
    )


# --- Detail ----------------------------------------------------------------


def user_summary(user: User) -> schemas.UserSummary:
    return schemas.UserSummary(
        id=user.id,
        display_name=user.display_name,
        role=user.role,
    )


def note_schema(note: Note) -> schemas.Note:
    if note.current_version_id is None:
        raise not_found(f"Note {note.id} has no content yet.")
    return schemas.Note(
        id=note.id,
        patient_id=note.patient_id,
        session_id=note.session_id,
        status=note.status,
        current_version_id=note.current_version_id,
        assigned_reviewer_id=note.assigned_reviewer_id,
        created_at=note.created_at,
        updated_at=note.updated_at,
        approved_at=note.approved_at,
    )


def version_schema(version: NoteVersion) -> schemas.NoteVersionDetail:
    return schemas.NoteVersionDetail(
        version_id=version.version_id,
        note_id=version.note_id,
        revision_number=version.revision_number,
        parent_version_id=version.parent_version_id,
        content=schemas.SoapContent(
            subjective=version.subjective,
            objective=version.objective,
            assessment=version.assessment,
            plan=version.plan,
        ),
        author_id=version.author_id,
        author_role=version.author_role,
        author_display_name=version.author.display_name,
        created_at=version.created_at,
    )


def event_schema(event: ReviewEvent) -> schemas.ReviewTimelineEvent:
    return schemas.ReviewTimelineEvent(
        event_id=event.event_id,
        note_id=event.note_id,
        version_id=event.version_id,
        from_status=event.from_status,
        to_status=event.to_status,
        actor_id=event.actor_id,
        actor_role=event.actor_role,
        actor_display_name=event.actor.display_name,
        reason=event.reason,
        occurred_at=event.occurred_at,
    )


def get_note_detail(session: Session, note_id: str) -> schemas.NoteDetail:
    note = session.scalar(
        select(Note)
        .where(Note.id == note_id)
        .options(
            selectinload(Note.patient),
            selectinload(Note.session).selectinload(ClinicalSession.clinician),
            selectinload(Note.assigned_reviewer),
            selectinload(Note.versions).selectinload(NoteVersion.author),
            selectinload(Note.events).selectinload(ReviewEvent.actor),
        )
    )
    if note is None:
        raise not_found(f"Note {note_id} was not found.")

    versions = [version_schema(version) for version in note.versions]
    current = next(
        (v for v in versions if v.version_id == note.current_version_id),
        None,
    )
    if current is None:
        raise not_found(f"Note {note_id} has no content yet.")

    events = sorted(note.events, key=lambda event: (event.occurred_at, event.event_id))

    return schemas.NoteDetail(
        note=note_schema(note),
        patient=schemas.PatientInformation(
            id=note.patient.id,
            display_name=note.patient.display_name,
            date_of_birth=note.patient.date_of_birth,
            medical_record_number=note.patient.medical_record_number,
        ),
        session=schemas.SessionInformation(
            id=note.session.id,
            started_at=note.session.started_at,
            ended_at=note.session.ended_at,
            clinician=user_summary(note.session.clinician),
        ),
        assigned_reviewer=None
        if note.assigned_reviewer is None
        else user_summary(note.assigned_reviewer),
        current_version=current,
        versions=versions,
        timeline=[event_schema(event) for event in events],
        presence=[],
    )
