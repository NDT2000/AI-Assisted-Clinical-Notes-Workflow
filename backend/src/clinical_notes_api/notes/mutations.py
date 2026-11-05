"""Changing notes: saving versions, workflow actions and bulk actions.

Each change to one note first locks the note's row, so two requests for the
same note run one after the other: the second sees the first one's result
(a version conflict, or the stored answer for a retried request).
"""

import hashlib
import json
import re
import uuid
from collections.abc import Sequence
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from clinical_notes_api.db import ClientMutation, Note, NoteVersion, ReviewEvent, User
from clinical_notes_api.db.models import MutationKind
from clinical_notes_api.errors import (
    ApiError,
    ensure_allowed,
    invalid_request,
    not_found,
)
from clinical_notes_api.notes import schemas
from clinical_notes_api.notes.queries import event_schema, note_schema, version_schema
from clinical_notes_api.workflow import (
    Actor,
    NoteState,
    SoapContent,
    can_assign_reviewer,
    can_edit_note_content,
    can_manage_reviewer_assignments,
    can_request_regeneration,
    can_transition,
)

SAVE_CONFLICT_MESSAGE = "The note has been updated since this draft was opened."
TRANSITION_CONFLICT_MESSAGE = (
    "The note version is stale. Save or reload the latest version before "
    "running this action."
)

# Who holds the review after each action.
_ASSIGNS_ACTOR = frozenset({"START_REVIEW"})
_RELEASES_REVIEWER = frozenset({"RETURN_TO_QUEUE", "RESUBMIT", "AMEND", "REGENERATE"})


def utc_now() -> datetime:
    """Now, to the millisecond: what the API shows is exactly what is stored."""
    now = datetime.now(UTC)
    return now.replace(microsecond=now.microsecond // 1000 * 1000)


def _actor(user: User) -> Actor:
    return Actor(id=user.id, role=user.role, mfa_verified=user.mfa_enabled)


def _note_state(note: Note) -> NoteState:
    return NoteState(
        status=note.status,
        assigned_reviewer_id=note.assigned_reviewer_id,
        approved_at=note.approved_at,
    )


def _lock_note(session: Session, note_id: str) -> Note:
    note = session.scalar(select(Note).where(Note.id == note_id).with_for_update())
    if note is None:
        raise not_found(f"Note {note_id} was not found.")
    return note


def _current_version(session: Session, note: Note) -> NoteVersion:
    version = (
        session.get(NoteVersion, note.current_version_id)
        if note.current_version_id is not None
        else None
    )
    if version is None:
        raise not_found(f"Note {note.id} has no content yet.")
    return version


# --- Idempotency -----------------------------------------------------------


def _signature(user: User, request: schemas.ApiModel) -> str:
    """Identifies a request and who sent it, to tell a retry from a reuse."""
    payload = {
        "actorId": user.id,
        "actorRole": user.role,
        "request": request.model_dump(mode="json", by_alias=True),
    }
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode()).hexdigest()


def _stored_response(
    session: Session,
    note_id: str,
    kind: MutationKind,
    client_mutation_id: str,
    signature: str,
) -> dict[str, Any] | None:
    record = session.get(ClientMutation, (note_id, kind, client_mutation_id))
    if record is None:
        return None
    if record.request_signature != signature:
        action = "save" if kind == "SAVE_VERSION" else "transition"
        raise ApiError(
            409,
            "idempotency_conflict",
            f"This clientMutationId has already been used for a different "
            f"{action} request.",
        )
    return record.response


def _store_response(
    session: Session,
    note_id: str,
    kind: MutationKind,
    client_mutation_id: str,
    signature: str,
    response: schemas.ApiModel,
    now: datetime,
) -> None:
    session.add(
        ClientMutation(
            note_id=note_id,
            kind=kind,
            client_mutation_id=client_mutation_id,
            request_signature=signature,
            response=response.model_dump(mode="json", by_alias=True),
            created_at=now,
        )
    )
    # Write now, so a database error fails this request, not a later commit.
    session.flush()


# --- Saving a version ------------------------------------------------------


def common_ancestor(
    versions: Sequence[NoteVersion],
    first_id: str,
    second_id: str,
) -> NoteVersion | None:
    """The newest version both versions descend from (the merge base)."""
    by_id = {version.version_id: version for version in versions}

    first_line: set[str] = set()
    current = by_id.get(first_id)
    while current is not None and current.version_id not in first_line:
        first_line.add(current.version_id)
        current = by_id.get(current.parent_version_id or "")

    seen: set[str] = set()
    current = by_id.get(second_id)
    while current is not None and current.version_id not in seen:
        if current.version_id in first_line:
            return current
        seen.add(current.version_id)
        current = by_id.get(current.parent_version_id or "")
    return None


def next_version_id(note_id: str, current_version_id: str, revision: int) -> str:
    """Same scheme as the mock server: note-version-12-3 becomes note-version-12-4."""
    prefix = re.sub(r"-\d+$", "", current_version_id)
    if prefix == current_version_id:
        return f"{note_id}-version-{revision}"
    return f"{prefix}-{revision}"


def save_version(
    session: Session,
    note_id: str,
    request: schemas.SaveNoteVersionRequest,
    user: User,
) -> schemas.SaveNoteVersionResponse:
    note = _lock_note(session, note_id)
    signature = _signature(user, request)
    stored = _stored_response(
        session, note_id, "SAVE_VERSION", request.client_mutation_id, signature
    )
    if stored is not None:
        return schemas.SaveNoteVersionResponse.model_validate(stored)

    ensure_allowed(can_edit_note_content(_note_state(note), _actor(user)))
    current = _current_version(session, note)

    if request.base_version_id != current.version_id:
        versions = session.scalars(
            select(NoteVersion).where(NoteVersion.note_id == note_id)
        ).all()
        ancestor = common_ancestor(
            versions, request.base_version_id, current.version_id
        )
        raise ApiError(
            409,
            "version_conflict",
            SAVE_CONFLICT_MESSAGE,
            details={
                "currentVersion": _dump(version_schema(current)),
                "commonAncestor": None
                if ancestor is None
                else _dump(version_schema(ancestor)),
            },
        )

    now = utc_now()
    revision = current.revision_number + 1
    saved = NoteVersion(
        version_id=next_version_id(note_id, current.version_id, revision),
        note_id=note_id,
        revision_number=revision,
        parent_version_id=current.version_id,
        subjective=request.content.subjective,
        objective=request.content.objective,
        assessment=request.content.assessment,
        plan=request.content.plan,
        author_id=user.id,
        author_role=user.role,
        created_at=now,
    )
    session.add(saved)
    session.flush()

    note.current_version_id = saved.version_id
    note.updated_at = now
    session.flush()
    session.refresh(saved, ["author"])

    response = schemas.SaveNoteVersionResponse(
        client_mutation_id=request.client_mutation_id,
        note=note_schema(note),
        saved_version=version_schema(saved),
    )
    _store_response(
        session,
        note_id,
        "SAVE_VERSION",
        request.client_mutation_id,
        signature,
        response,
        now,
    )
    return response


# --- Workflow actions ------------------------------------------------------


def transition_note(
    session: Session,
    note_id: str,
    request: schemas.TransitionNoteRequest,
    user: User,
) -> schemas.TransitionNoteResponse:
    note = _lock_note(session, note_id)
    signature = _signature(user, request)
    stored = _stored_response(
        session, note_id, "TRANSITION", request.client_mutation_id, signature
    )
    if stored is not None:
        return schemas.TransitionNoteResponse.model_validate(stored)

    current = _current_version(session, note)
    if request.base_version_id != current.version_id:
        raise ApiError(
            409,
            "version_conflict",
            TRANSITION_CONFLICT_MESSAGE,
            details={"currentVersion": _dump(version_schema(current))},
        )

    now = utc_now()
    decision = can_transition(
        _note_state(note),
        request.trigger,
        _actor(user),
        SoapContent(
            subjective=current.subjective,
            objective=current.objective,
            assessment=current.assessment,
            plan=current.plan,
        ),
        now,
        rejection_reason=request.rejection_reason,
    )
    if not decision.allowed or decision.next_status is None:
        raise ApiError(
            422,
            "transition_not_allowed",
            decision.reason or "This action is not allowed.",
        )

    from_status = note.status
    note.status = decision.next_status
    if request.trigger in _ASSIGNS_ACTOR:
        note.assigned_reviewer_id = user.id
    elif request.trigger in _RELEASES_REVIEWER:
        note.assigned_reviewer_id = None
    if decision.next_status == "APPROVED":
        note.approved_at = now
    note.updated_at = now

    reason = (request.rejection_reason or "").strip()
    event = ReviewEvent(
        event_id=f"event-{uuid.uuid4()}",
        note_id=note_id,
        version_id=current.version_id,
        from_status=from_status,
        to_status=decision.next_status,
        actor_id=user.id,
        actor_role=user.role,
        reason=reason if request.trigger == "REJECT" and reason else None,
        occurred_at=now,
    )
    session.add(event)
    session.flush()
    session.refresh(event, ["actor"])

    response = schemas.TransitionNoteResponse(
        client_mutation_id=request.client_mutation_id,
        note=note_schema(note),
        timeline_event=event_schema(event),
        current_version=version_schema(current),
    )
    _store_response(
        session,
        note_id,
        "TRANSITION",
        request.client_mutation_id,
        signature,
        response,
        now,
    )
    return response


# --- Bulk actions ----------------------------------------------------------


def _unique(ids: Sequence[str]) -> list[str]:
    return list(dict.fromkeys(ids))


def _lock_notes(session: Session, note_ids: Sequence[str]) -> dict[str, Note]:
    # Locked in id order, so two bulk requests cannot deadlock each other.
    notes = session.scalars(
        select(Note).where(Note.id.in_(note_ids)).order_by(Note.id).with_for_update()
    ).all()
    return {note.id: note for note in notes}


def assign_reviewer(
    session: Session,
    request: schemas.AssignReviewerRequest,
    user: User,
) -> schemas.AssignReviewerResponse:
    """Assign (or unassign) a reviewer on every note whose status allows it."""
    ensure_allowed(can_manage_reviewer_assignments(user.role))

    reviewer_id = request.reviewer_id
    if reviewer_id is not None:
        reviewer = session.get(User, reviewer_id)
        if reviewer is None or reviewer.role != "REVIEWER":
            raise invalid_request(f"{reviewer_id} is not a reviewer.")

    note_ids = _unique(request.note_ids)
    notes = _lock_notes(session, note_ids)
    now = utc_now()
    updated = []
    for note_id in note_ids:
        note = notes.get(note_id)
        if note is None or not can_assign_reviewer(note.status, user.role).allowed:
            continue
        note.assigned_reviewer_id = reviewer_id
        note.updated_at = now
        updated.append(note_id)

    session.flush()
    return schemas.AssignReviewerResponse(updated=updated)


def regenerate(
    session: Session,
    request: schemas.RegenerateRequest,
    user: User,
) -> schemas.RegenerateResponse:
    """Send every failed note back to generation; skip the rest."""
    ensure_allowed(can_request_regeneration("FAILED", user.role))

    note_ids = _unique(request.note_ids)
    notes = _lock_notes(session, note_ids)
    now = utc_now()
    updated, skipped = [], []
    for note_id in note_ids:
        note = notes.get(note_id)
        decision = (
            can_request_regeneration(note.status, user.role)
            if note is not None
            else None
        )
        if note is None or decision is None or decision.next_status is None:
            skipped.append(note_id)
            continue

        # Unlike the mock server, the history records bulk regeneration too.
        session.add(
            ReviewEvent(
                event_id=f"event-{uuid.uuid4()}",
                note_id=note_id,
                version_id=note.current_version_id,
                from_status=note.status,
                to_status=decision.next_status,
                actor_id=user.id,
                actor_role=user.role,
                occurred_at=now,
            )
        )
        note.status = decision.next_status
        note.assigned_reviewer_id = None
        note.updated_at = now
        updated.append(note_id)

    session.flush()
    return schemas.RegenerateResponse(updated=updated, skipped=skipped)


def _dump(model: schemas.ApiModel) -> dict[str, Any]:
    return model.model_dump(mode="json", by_alias=True)
